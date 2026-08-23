# Novel Action Impact and Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user has disallowed subagents, so execute inline with checkpoints.

**Goal:** Extend `novel-action-director` with observable impact evidence and a reusable performance-channel reference without changing its ownership of action facts.

**Architecture:** Add six deterministic gates to the existing validator, project the new evidence through export/render, and keep the format backward compatible for combat actions whose source beat does not describe a hit or block. Documentation remains progressively disclosed through focused references.

**Tech Stack:** Node.js 18+ standard library, ES modules, Markdown, JSON, Codex skill metadata.

## Global Constraints

- Do not modify script facts, dialogue, participants, props, damage results, or rating-sensitive content.
- Do not add camera moves to `cameraIntent`.
- VFX, blur, shake, blood, and deformation are never accepted as substitutes for body feedback.
- Touch only this skill, its tests/examples, the route entry if needed, and verification documents.
- Stage and commit exact paths; do not include unrelated dirty-worktree files.

---

### Task 1: RED fixtures for impact evidence

**Files:**
- Modify: `.agents/skills/novel-action-director/scripts/selftest.mjs`

**Interfaces:**
- Consumes: existing `gateReport(doc, { script })`.
- Produces: failing assertions for six new gates.

- [ ] **Step 1: Add an impact-required combat fixture**

Add a seventh source beat, `C01 的刀刃命中 C02 肩甲。`, and a matching valid combat action whose contact phase includes `outcome: "hit"` and whose `impactEvidence` contains all seven fields from the design spec.

- [ ] **Step 2: Add exact failing assertions**

```js
check(() => assert.equal(gateReport(IMPACT_VALID, { script: IMPACT_SCRIPT }).length, 24));
check(() => assert.ok(gateReport(IMPACT_VALID, { script: IMPACT_SCRIPT }).every((item) => item.ok)));

const impactFailures = [
  ['impact-required', (doc) => { delete doc.episodes[0].actions[0].impactEvidence; }],
  ['impact-contact-consistency', (doc) => { doc.episodes[0].actions[0].impactEvidence.contactPoint = 'wrong-point'; }],
  ['impact-target-feedback', (doc) => {
    const e = doc.episodes[0].actions[0].impactEvidence;
    e.targetLatency = ''; e.supportChange = ''; e.centerOfMassShift = ''; e.wholeBodyResult = '';
  }],
  ['impact-causal-result', (doc) => { doc.episodes[0].actions[0].impactEvidence.wholeBodyResult = '向受力反方向无因飞起'; }],
  ['impact-not-vfx-only', (doc) => { doc.episodes[0].actions[0].impactEvidence = { contactPoint: 'blade/armor', contactVisible: true, vfx: 'sparks and shake' }; }],
  ['impact-content-authority', (doc) => { doc.episodes[0].actions[0].impactEvidence.wholeBodyResult = '肩部断裂并喷血'; }],
];
for (const [id, mutate] of impactFailures) {
  check(() => assert.equal(gate(brokenImpact(mutate), id).ok, false, `${id} 应失败`));
}
```

- [ ] **Step 3: Run RED**

Run: `node .agents/skills/novel-action-director/scripts/selftest.mjs`

Expected: FAIL because the report still has 18 gates and the six new IDs do not exist.

- [ ] **Step 4: Commit the RED fixture**

```powershell
git add -- .agents/skills/novel-action-director/scripts/selftest.mjs
git commit -m "test: define action impact evidence gates"
```

### Task 2: GREEN impact gates

**Files:**
- Modify: `.agents/skills/novel-action-director/scripts/novel-action-director.mjs`
- Test: `.agents/skills/novel-action-director/scripts/selftest.mjs`

**Interfaces:**
- Produces: `impactRequired(action)`, six gate IDs, 24 total gates.

- [ ] **Step 1: Add the six gate definitions**

```js
['impact-required', '命中或格挡动作提供可观察打击证据'],
['impact-contact-consistency', '打击证据与 contact 阶段接触点一致'],
['impact-target-feedback', '受击方有停顿、支撑、重心或全身反馈'],
['impact-causal-result', '全身结果可由力方向与支撑关系推导'],
['impact-not-vfx-only', '特效不替代身体反馈'],
['impact-content-authority', '血液、断裂与变形有源剧本授权'],
```

- [ ] **Step 2: Add the requirement predicate**

```js
const IMPACT_OUTCOMES = new Set(['hit', 'block']);
const IMPACT_SOURCE = /(命中|击中|打中|砍中|刺中|撞中|格挡|挡住攻击|接下攻击)/;

function impactRequired(action) {
  const contact = phaseOf(action, 'contact');
  return action.kind === 'combat'
    && (IMPACT_OUTCOMES.has(contact?.outcome) || IMPACT_SOURCE.test(String(action.sourceBeat?.text ?? '')));
}
```

- [ ] **Step 3: Implement structural and consistency checks**

Require the seven fields when `impactRequired` is true; compare `impactEvidence.contactPoint` with the contact phase; accept target feedback only when at least one of `targetLatency`, `supportChange`, `centerOfMassShift`, or `wholeBodyResult` is non-empty.

- [ ] **Step 4: Implement causal and content checks**

Reject VFX-only objects. Reject `喷血|流血|断裂|折断|肢解|变形` in evidence unless the same concept appears in `sourceBeat.text`. For causal result, require non-empty `forceDirection`, a support/weight field, and `wholeBodyResult` when displacement or collapse is claimed.

- [ ] **Step 5: Register checks and run GREEN**

Run: `node .agents/skills/novel-action-director/scripts/selftest.mjs`

Expected: the complete self-test suite passes and the CLI exits with code `0`.

- [ ] **Step 6: Commit**

```powershell
git add -- .agents/skills/novel-action-director/scripts/novel-action-director.mjs .agents/skills/novel-action-director/scripts/selftest.mjs
git commit -m "feat: validate action impact evidence"
```

### Task 3: Export, render, and references

**Files:**
- Modify: `.agents/skills/novel-action-director/scripts/novel-action-director.mjs`
- Modify: `.agents/skills/novel-action-director/references/schema.md`
- Modify: `.agents/skills/novel-action-director/references/combat.md`
- Create: `.agents/skills/novel-action-director/references/performance-channels.md`
- Modify: `.agents/skills/novel-action-director/SKILL.md`
- Modify: `.agents/skills/novel-action-director/examples/渡口-action.json`
- Test: `.agents/skills/novel-action-director/scripts/selftest.mjs`

**Interfaces:**
- Produces: `storyboard-actions.json.actions[key].impactEvidence`.

- [ ] **Step 1: Write failing export/render assertions**

```js
check(() => assert.equal(buildStoryboardSummary(IMPACT_VALID, IMPACT_SCRIPT)
  .actions['E01-S01-B01'].impactEvidence.contactVisible, true));
check(() => assert.match(renderMarkdown(IMPACT_VALID, { script: IMPACT_SCRIPT }), /打击证据/));
check(() => assert.match(renderHtml(IMPACT_VALID, { script: IMPACT_SCRIPT }), /centerOfMassShift/));
```

Run the selftest and verify these fail because evidence is not exported or rendered.

- [ ] **Step 2: Project evidence without inventing camera choices**

Add `impactEvidence: clone(action.impactEvidence)` to `buildStoryboardSummary`; add a compact “打击证据” block to Markdown and HTML timelines.

- [ ] **Step 3: Document schema and judgment rules**

In `schema.md`, define all seven fields and the `contact.outcome` values `hit|block|evade|miss`. In `combat.md`, add the visible momentum-transfer rule and explicitly mark blur, shake, slow motion, flash, blood, and deformation as conditional.

- [ ] **Step 4: Add the performance-channel reference**

Organize eye/eyelid, brow, mouth/jaw, breath, shoulder/torso, hand/self-contact, gaze target, and relational distance by observable change. Include combinations for controlled joy, suppressed anger, held-back grief, fear, and surprise; do not prescribe gender-specific poses.

- [ ] **Step 5: Link the reference from SKILL.md and update example**

Add a single routing bullet for complex emotional performance. Update one example combat action with a valid `impactEvidence` block while preserving source facts.

- [ ] **Step 6: Run the complete selftest**

Run: `node .agents/skills/novel-action-director/scripts/selftest.mjs`

Expected: all assertions pass.

- [ ] **Step 7: Commit**

```powershell
git add -- .agents/skills/novel-action-director
git commit -m "docs: teach impact and performance channels"
```

### Task 4: Skill metadata, validation, and deployment

**Files:**
- Create: `.agents/skills/novel-action-director/agents/openai.yaml`
- Create: `docs/superpowers/verification/2026-08-23-novel-action-impact-performance.md`

**Interfaces:**
- Produces: project and global copies with matching SHA-256 hashes.

- [ ] **Step 1: Add UI metadata**

```yaml
interface:
  display_name: "Novel Action Director"
  short_description: "深化人物表演、互动、战斗受力与打击证据"
  default_prompt: "Use $novel-action-director to turn this script into a validated action.json."
policy:
  allow_implicit_invocation: true
```

- [ ] **Step 2: Run skill and behavior validation**

```powershell
python C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py .agents\skills\novel-action-director
node .agents\skills\novel-action-director\scripts\selftest.mjs
node .agents\skills\novel-action-director\scripts\novel-action-director.mjs validate .agents\skills\novel-action-director\examples\渡口-action.json --script C:\Users\Administrator\.codex\skills\novel-script\examples\渡口-script.json
```

Expected: quick validation succeeds, selftest is green, and the example reports all 24 gates passing against `C:\Users\Administrator\.codex\skills\novel-script\examples\渡口-script.json`.

- [ ] **Step 3: Deploy exact copy globally**

Use `Copy-Item -Recurse -Force` from the project skill directory to `C:\Users\Administrator\.codex\skills\novel-action-director`, after confirming the destination is the previously deployed copy of the same skill.

- [ ] **Step 4: Verify hashes and record evidence**

Hash every file in both trees with `Get-FileHash -Algorithm SHA256`, compare relative-path/hash pairs, and write commands, counts, and results to the verification document.

- [ ] **Step 5: Commit**

```powershell
git add -- .agents/skills/novel-action-director/agents/openai.yaml docs/superpowers/verification/2026-08-23-novel-action-impact-performance.md
git commit -m "docs: verify action impact deployment"
```
