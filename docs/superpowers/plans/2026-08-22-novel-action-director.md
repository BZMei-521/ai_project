# Novel Action Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a `novel-action-director` skill that turns selected script beats into validated `action.json` performance/action plans and exposes an optional, backward-compatible `--actions` contract to `novel-storyboard`.

**Architecture:** Develop the new skill as versioned project source under `.agents/skills/novel-action-director`, with one zero-dependency Node.js module providing seed, validation, render, and export functions. Deploy the verified folder to `C:\Users\Administrator\.codex\skills\novel-action-director`, then apply a narrow optional action-context adapter to the existing global `novel-storyboard`; without `--actions`, all existing storyboard behavior and tests must remain byte-for-byte compatible at the public interface.

**Tech Stack:** Node.js 18+ ESM, standard library only, JSON, Markdown/HTML, PowerShell, Codex skill Markdown.

## Global Constraints

- Do not create subagents; execute inline with bounded commands.
- `script.json` is required; `cast.json` and `art.json` are optional context.
- Deep-plan only action/performance-critical beats; ordinary beats remain authoritative in `script.json`.
- Never modify dialogue, add characters/props, or invent plot outcomes.
- Supported physics profiles are exactly `realistic`, `wuxia`, `xianxia`, and `stylized`.
- `cameraIntent` states visibility/information needs only; it must not prescribe a concrete storyboard camera move.
- New code uses only Node.js standard-library modules and remains usable on Windows.
- Test-first: every new exported behavior must be observed failing before implementation.
- Preserve unrelated dirty worktree changes and stage only task-owned files.
- Global-skill deployment requires explicit filesystem approval and happens only after project-source tests pass.

## File Map

### Versioned project source

- Create `.agents/skills/novel-action-director/SKILL.md` — concise routing and workflow entrypoint.
- Create `.agents/skills/novel-action-director/references/schema.md` — complete `action.json` contract.
- Create `.agents/skills/novel-action-director/references/action-pass.md` — selection, state-chain, risk, and export rules.
- Create `.agents/skills/novel-action-director/references/performance.md` — emotion/micro-expression process rules.
- Create `.agents/skills/novel-action-director/references/interaction.md` — two-person contact and response rules.
- Create `.agents/skills/novel-action-director/references/combat.md` — attack/contact/reaction/recovery choreography.
- Create `.agents/skills/novel-action-director/references/physics-profiles.md` — genre-specific exaggeration limits.
- Create `.agents/skills/novel-action-director/scripts/novel-action-director.mjs` — seed, gate, validate, render, export, and CLI.
- Create `.agents/skills/novel-action-director/scripts/selftest.mjs` — deterministic unit/contract tests.
- Create `.agents/skills/novel-action-director/examples/渡口-action.json` — valid test and usage fixture.
- Modify `AGENTS.md` — add `$novel-action-director` routing without changing existing story routes.

### Deployed global runtime

- Create `C:\Users\Administrator\.codex\skills\novel-action-director\...` as an exact verified copy of the project source.
- Modify `C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\novel-storyboard.mjs` — optional action loading, validation, and seed projection.
- Modify `C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\selftest.mjs` — action-adapter regression tests.
- Modify `C:\Users\Administrator\.codex\skills\novel-storyboard\SKILL.md` — document optional `--actions` usage.
- Modify `C:\Users\Administrator\.codex\skills\novel-storyboard\references\schema.md` — define action provenance fields consumed by cuts.
- Modify `C:\Users\Administrator\.codex\skills\novel-storyboard\references\storyboard-pass.md` — explain projection without camera override.

---

### Task 1: Core schema, script expansion, and deterministic seed

**Files:**
- Create: `.agents/skills/novel-action-director/scripts/selftest.mjs`
- Create: `.agents/skills/novel-action-director/scripts/novel-action-director.mjs`

**Interfaces:**
- Consumes: `script.json`; optional episode range string such as `1-3`.
- Produces: `PHYSICS_PROFILES`, `ACTION_KINDS`, `DEFAULT_PARAMS`, `expandScript(script)`, `parseEpisodeRange(text)`, and `seedFromScript(script, epRange)`.

- [ ] **Step 1: Write failing seed and expansion tests**

Create `selftest.mjs` with a minimal in-memory script fixture and assertions equivalent to:

```js
import assert from 'node:assert/strict';
import {
  ACTION_KINDS,
  PHYSICS_PROFILES,
  expandScript,
  parseEpisodeRange,
  seedFromScript,
} from './novel-action-director.mjs';

const SCRIPT = {
  source: '测试剧',
  episodes: [{
    ep: 1,
    scenes: [{
      index: 1,
      characters: ['C01', 'C02'],
      props: ['P01'],
      beats: [
        { kind: 'action', text: '她挡在同伴身前。', seconds: 2.5 },
        { kind: 'dialogue', speaker: 'C02', line: '小心！', seconds: 1.2 }
      ]
    }]
  }]
};

assert.deepEqual(PHYSICS_PROFILES, ['realistic', 'wuxia', 'xianxia', 'stylized']);
assert.ok(ACTION_KINDS.includes('combat'));
assert.equal(expandScript(SCRIPT).get(1).scenes[0].beats[0].text, '她挡在同伴身前。');
assert.deepEqual([...parseEpisodeRange('1-2')], [1, 2]);
const seed = seedFromScript(SCRIPT);
assert.equal(seed.version, 1);
assert.equal(seed.physicsProfile, 'realistic');
assert.equal(seed.episodes[0].seedScenes[0].beats.length, 2);
assert.deepEqual(seed.episodes[0].actions, []);
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node .agents/skills/novel-action-director/scripts/selftest.mjs
```

Expected: FAIL because `novel-action-director.mjs` or its exports do not exist.

- [ ] **Step 3: Implement the minimal seed API**

In `novel-action-director.mjs`, add:

```js
export const PHYSICS_PROFILES = ['realistic', 'wuxia', 'xianxia', 'stylized'];
export const ACTION_KINDS = ['performance', 'interaction', 'combat', 'prop-operation', 'locomotion'];
export const DEFAULT_PARAMS = { maxMajorActionsPerBeat: 1, requireRecoveryPose: true };

export function parseEpisodeRange(text) {
  if (!text) return null;
  const match = /^(\d+)(?:-(\d+))?$/.exec(text);
  if (!match) throw new Error(`无效集数范围：${text}`);
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (end < start) throw new Error(`无效集数范围：${text}`);
  return new Set(Array.from({ length: end - start + 1 }, (_, i) => start + i));
}
```

Implement `expandScript` as a non-mutating normalizer keyed by episode number. Implement `seedFromScript` so it copies exact scene/beat facts into `seedScenes`, writes empty `actions`, defaults to `realistic`, and filters only by the optional range.

- [ ] **Step 4: Run the test and verify GREEN**

Run the same command. Expected: all initial assertions pass and the script prints a positive assertion count.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- .agents/skills/novel-action-director/scripts
git commit -m "feat: seed novel action plans from scripts"
```

---

### Task 2: Action gates, physics rules, and storyboard summary export

**Files:**
- Modify: `.agents/skills/novel-action-director/scripts/selftest.mjs`
- Modify: `.agents/skills/novel-action-director/scripts/novel-action-director.mjs`

**Interfaces:**
- Consumes: `action.json` plus `{ script, cast?, art? }` context.
- Produces: `gateReport(doc, ctx)`, `validateAction(doc, ctx)`, `buildStoryboardSummary(doc, script)`.

- [ ] **Step 1: Add a valid action fixture and failing gate tests**

Extend the test with one `combat` action whose `sourceBeat` exactly matches the script and whose phases contain `setup`, `anticipation`, `action`, `contact`, `reaction`, and `recovery`. Assert a green baseline, then clone and independently break each contract:

```js
const gate = (doc, id) => gateReport(doc, { script: SCRIPT }).find((item) => item.id === id);
assert.ok(gateReport(VALID, { script: SCRIPT }).every((item) => item.ok));

const changedDialogue = structuredClone(VALID);
changedDialogue.episodes[0].actions[0].sourceBeat.text = '改写后的剧情';
assert.equal(gate(changedDialogue, 'source-fidelity').ok, false);

const noReaction = structuredClone(VALID);
noReaction.episodes[0].actions[0].phases = noReaction.episodes[0].actions[0].phases.filter((p) => p.phase !== 'reaction');
assert.equal(gate(noReaction, 'combat-causality').ok, false);

const cameraOverride = structuredClone(VALID);
cameraOverride.episodes[0].actions[0].cameraIntent.camera = 'Push In';
assert.equal(gate(cameraOverride, 'camera-boundary').ok, false);
```

Add separate failures for duplicate action-per-beat, missing start/end state, missing contact force, displacement without support/path/landing, one-sided interaction, prop operation without hand/state change, micro-expression without trigger/gaze, label-only emotion, missing recovery, profile violation, adjacent-state mismatch, contradictory summary, and unmarked generation risk.

- [ ] **Step 2: Run tests and verify RED**

Expected: FAIL because `gateReport`, `validateAction`, and `buildStoryboardSummary` are not implemented.

- [ ] **Step 3: Implement eighteen named gates**

`gateReport` must return stable objects:

```js
{
  id: 'combat-causality',
  label: '战斗攻防与受力链',
  ok: false,
  detail: 'E01-S01-B01-A01 缺少 reaction 阶段'
}
```

Use these exact IDs:

```text
source-reference, source-fidelity, one-major-action, boundary-complete,
combat-causality, contact-force, displacement-grounding,
interaction-bilateral, prop-hands-state, performance-trigger-gaze,
emotion-process, recovery-pose, physics-profile, adjacent-continuity,
camera-boundary, summary-consistency, generation-risk, ordinary-beat-preservation
```

`validateAction` returns a flat problem list derived from failed gate details. It does not mutate the document.

`buildStoryboardSummary` returns:

```js
{
  version: 1,
  source: doc.source,
  physicsProfile: doc.physicsProfile,
  actions: {
    'E01-S01-B01': {
      actionId: 'E01-S01-B01-A01',
      kind: 'combat',
      intent: '保护同伴',
      startState: {},
      endState: {},
      phaseSummary: [],
      cameraIntent: { mustShow: ['接触点', '目标后退'] },
      generationRisk: ['multi-person-occlusion']
    }
  }
}
```

Ordinary beats remain authoritative through `script.json`; the preservation gate confirms that export keys are a strict subset of real beats and that no script beat is rewritten.

- [ ] **Step 4: Run tests and verify GREEN**

Expected: every baseline and individual gate-break assertion passes.

- [ ] **Step 5: Commit Task 2**

```powershell
git add -- .agents/skills/novel-action-director/scripts
git commit -m "feat: validate action causality and continuity"
```

---

### Task 3: CLI, reports, example, and skill instructions

**Files:**
- Modify: `.agents/skills/novel-action-director/scripts/selftest.mjs`
- Modify: `.agents/skills/novel-action-director/scripts/novel-action-director.mjs`
- Create: `.agents/skills/novel-action-director/examples/渡口-action.json`
- Create: `.agents/skills/novel-action-director/SKILL.md`
- Create: `.agents/skills/novel-action-director/references/schema.md`
- Create: `.agents/skills/novel-action-director/references/action-pass.md`
- Create: `.agents/skills/novel-action-director/references/performance.md`
- Create: `.agents/skills/novel-action-director/references/interaction.md`
- Create: `.agents/skills/novel-action-director/references/combat.md`
- Create: `.agents/skills/novel-action-director/references/physics-profiles.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: JSON paths passed to CLI commands.
- Produces: `renderMarkdown`, `renderHtml`, CLI `seed|validate|render|export`, and discoverable `$novel-action-director` routing.

- [ ] **Step 1: Add failing render/CLI assertions**

Add tests that assert:

```js
assert.match(renderMarkdown(VALID, { script: SCRIPT }), /动作时间线/);
assert.match(renderMarkdown(VALID, { script: SCRIPT }), /接触点/);
assert.match(renderHtml(VALID, { script: SCRIPT }), /<!doctype html>/i);
assert.match(renderHtml(VALID, { script: SCRIPT }), /physicsProfile/);
```

Add bounded subprocess checks:

```powershell
node .agents/skills/novel-action-director/scripts/novel-action-director.mjs validate `
  .agents/skills/novel-action-director/examples/渡口-action.json `
  --script C:\Users\Administrator\.codex\skills\novel-script\examples\渡口-script.json
```

Expected before implementation: FAIL because render functions, CLI, or fixture are missing.

- [ ] **Step 2: Implement render and CLI**

Export `renderMarkdown(doc, ctx)` and `renderHtml(doc, ctx)`. The report must show KPI counts, physics profile, selected-vs-ordinary beats, action phases, participant/contact relationships, state changes, camera intent, risk warnings, failed gates, and copyable storyboard summary.

Implement exact CLI forms:

```text
seed <script.json> [--eps 1-3] [--physics realistic|wuxia|xianxia|stylized]
validate <action.json> --script <script.json> [--cast <cast.json>] [--art <art.json>]
render <action.json> --script <script.json> [--html|--md]
export <action.json> --script <script.json> [--out <summary.json>]
```

All JSON reading uses UTF-8. Validation exits `1` with one problem per line; valid input prints a PASS summary and exits `0`.

- [ ] **Step 3: Add a complete example and references**

Create `渡口-action.json` from the existing `渡口-script.json`. Include at least:

- one `performance` plan with trigger, gaze, breath, and controlled emotional leakage;
- one `interaction` plan with initiator, responder, contact, distance, and both end states;
- one action using a prop with explicit left/right hand and state transition;
- one movement plan with support, path, and landing.

Write `SKILL.md` with a discriminating description starting with “Use when…”, the `script → action → storyboard` boundary, workflow commands, required validation, and routing to each reference only when that mode applies.

References must internalize the supplied material as decision rules, not copied prompt catalogs. Remove gender stereotypes; keep effects/motion blur/camera shake optional.

- [ ] **Step 4: Add project routing**

Add one row to `AGENTS.md`:

```markdown
| `$novel-action-director`、人物动作/表演导演 | novel-action-director | 动作、微表情、互动、战斗与受力设计 |
```

- [ ] **Step 5: Run full source validation**

Run:

```powershell
node .agents/skills/novel-action-director/scripts/selftest.mjs
python C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py .agents/skills/novel-action-director
```

Expected: selftests PASS and skill validation PASS with no scaffold placeholders. If `python` is not on `PATH`, resolve the bundled Python path with `codex_app__load_workspace_dependencies` and rerun the same script with that executable.

- [ ] **Step 6: Commit Task 3**

```powershell
git add -- AGENTS.md .agents/skills/novel-action-director
git commit -m "feat: add novel action director skill"
```

---

### Task 4: Optional `novel-storyboard --actions` adapter

**Files:**
- Modify: `C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\selftest.mjs`
- Modify: `C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\novel-storyboard.mjs`
- Modify: `C:\Users\Administrator\.codex\skills\novel-storyboard\SKILL.md`
- Modify: `C:\Users\Administrator\.codex\skills\novel-storyboard\references\schema.md`
- Modify: `C:\Users\Administrator\.codex\skills\novel-storyboard\references\storyboard-pass.md`
- Create: `.superpowers/sdd/novel-action-director-storyboard-adapter.md`

**Interfaces:**
- Consumes: the summary returned by `buildStoryboardSummary`.
- Produces: `actionSummaryOf(actions, ep, sceneIndex, beatStart, beatEnd)`, optional action context in `seedFromScript`, and action-aware validation.

- [ ] **Step 1: Back up exact global files and add failing adapter tests**

Before editing, copy the five target files into a timestamped directory under `.superpowers/sdd/novel-action-director-global-backup/`; do not overwrite an existing backup.

Extend storyboard selftests with:

```js
const ACTIONS = {
  version: 1,
  source: SCRIPT.source,
  physicsProfile: 'realistic',
  actions: {
    'E01-S01-B01': {
      actionId: 'E01-S01-B01-A01',
      kind: 'interaction',
      intent: '阻止对方前进',
      startState: { characters: {}, props: {} },
      endState: { characters: {}, props: {} },
      phaseSummary: [],
      cameraIntent: { mustShow: ['双方接触'] },
      generationRisk: []
    }
  }
};

assert.equal(actionSummaryOf(ACTIONS, 1, 1, 1, 1).length, 1);
assert.deepEqual(seedFromScript(SCRIPT, null, ACTIONS).episodes[0].seedScenes[0].beats[0].actionRefs, ['E01-S01-B01-A01']);
```

Add a valid storyboard cut with `actionRefs` and `actionStateProjection`, then assert failures for missing action ownership, changed end state, changed hand/contact fact, and `cameraIntent` copied into the cut's concrete `camera` field.

- [ ] **Step 2: Run storyboard selftests and verify RED**

Run:

```powershell
node C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\selftest.mjs
```

Expected: FAIL because `actionSummaryOf` and action-aware arguments/gates do not exist.

- [ ] **Step 3: Implement the minimal adapter**

Add exported `actionSummaryOf(actions, ep, sceneIndex, beatStart, beatEnd)` that returns only real action entries whose beat keys fall inside the cut's claimed range.

Change the seed signature compatibly:

```js
export function seedFromScript(script, epRange = null, actions = null)
```

When actions are present, add only `actionRefs` and compact `actionIntent` to matching seed beats. With `actions = null`, return the exact existing shape.

Add optional cut fields:

```json
{
  "actionRefs": ["E01-S01-B01-A01"],
  "actionStateProjection": {
    "startState": {},
    "endState": {},
    "mustShow": ["双方接触"]
  }
}
```

Action-aware validation must:

- require all actions in claimed beats to be referenced once;
- compare projected start/end state to action summary facts;
- reject changed hand, prop, contact, and result facts;
- reject automatic use of `cameraIntent` as a concrete camera move;
- skip all action gates with an explicit “未提供 action.json，跳过” detail when absent.

CLI parsing loads `--actions <path>` into context for `seed`, `validate`, and `render`.

- [ ] **Step 4: Verify adapter and legacy regression**

Run storyboard selftests twice through the same suite: once with new action fixtures and once using the untouched existing `渡口-storyboard.json` context without actions. Expected: all prior 207 assertions plus new adapter assertions pass.

Run:

```powershell
node C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\novel-storyboard.mjs validate `
  C:\Users\Administrator\.codex\skills\novel-storyboard\examples\渡口-storyboard.json `
  --script C:\Users\Administrator\.codex\skills\novel-script\examples\渡口-script.json
```

Expected: PASS without `--actions`.

- [ ] **Step 5: Update storyboard documentation**

Document the optional CLI parameter, `actionRefs`, `actionStateProjection`, action-result immutability, and camera-intent boundary in the three listed Markdown files. Do not change unrelated storyboard rules.

- [ ] **Step 6: Record reviewable global-adapter evidence**

Because the global skills directory is not a Git repository, inspect the exact backup-to-runtime change:

```powershell
git diff --no-index -- .superpowers/sdd/novel-action-director-global-backup/novel-storyboard C:\Users\Administrator\.codex\skills\novel-storyboard
```

Then create `.superpowers/sdd/novel-action-director-storyboard-adapter.md` with `apply_patch`. Include these exact sections: `Backup Path`, `Changed Global Files`, `Before/After SHA256`, `Public Interface Changes`, `Legacy Regression`, `Action Adapter Tests`, and `Reviewed Diff Summary`. Record all five target files and the assertion counts/CLI exit codes from Step 4; summarize only the reviewed hunks shown by `git diff --no-index`.

Commit only that evidence file:

```powershell
git add -- .superpowers/sdd/novel-action-director-storyboard-adapter.md
git commit -m "docs: record storyboard action adapter"
```

---

### Task 5: Deploy, cross-skill acceptance, and final evidence

**Files:**
- Create: `C:\Users\Administrator\.codex\skills\novel-action-director\...`
- Create: `.superpowers/sdd/novel-action-director-acceptance.md`

**Interfaces:**
- Consumes: verified project skill source and patched global storyboard.
- Produces: discoverable global skill, validated end-to-end sample, and acceptance evidence.

- [ ] **Step 1: Verify deployment target safety**

Resolve the source and destination absolute paths. Abort if the source is not inside the current worktree or if the destination is not exactly `C:\Users\Administrator\.codex\skills\novel-action-director`. If the destination exists, compare hashes and stop for review rather than overwriting differing files.

- [ ] **Step 2: Copy the verified skill to the global directory**

Copy only after project-source selftests and `quick_validate.py` pass. Preserve the project source as the versioned authority.

- [ ] **Step 3: Run global skill verification**

Run:

```powershell
node C:\Users\Administrator\.codex\skills\novel-action-director\scripts\selftest.mjs
python C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py C:\Users\Administrator\.codex\skills\novel-action-director
```

Expected: both PASS.

- [ ] **Step 4: Run the end-to-end contract**

Use the existing `渡口-script.json`:

```powershell
node C:\Users\Administrator\.codex\skills\novel-action-director\scripts\novel-action-director.mjs validate `
  C:\Users\Administrator\.codex\skills\novel-action-director\examples\渡口-action.json `
  --script C:\Users\Administrator\.codex\skills\novel-script\examples\渡口-script.json

node C:\Users\Administrator\.codex\skills\novel-action-director\scripts\novel-action-director.mjs export `
  C:\Users\Administrator\.codex\skills\novel-action-director\examples\渡口-action.json `
  --script C:\Users\Administrator\.codex\skills\novel-script\examples\渡口-script.json `
  --out $env:TEMP\渡口-storyboard-actions.json

node C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\novel-storyboard.mjs seed `
  C:\Users\Administrator\.codex\skills\novel-script\examples\渡口-script.json `
  --actions $env:TEMP\渡口-storyboard-actions.json `
  --eps 1
```

Expected: action validation PASS; export contains only real critical beats; storyboard seed contains matching `actionRefs` and compact intent while ordinary beats remain present.

- [ ] **Step 5: Run regression suites**

Run:

```powershell
node C:\Users\Administrator\.codex\skills\novel-script\scripts\selftest.mjs
node C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\selftest.mjs
node C:\Users\Administrator\.codex\skills\novel-action-director\scripts\selftest.mjs
```

Expected: all three suites PASS with zero failed assertions.

- [ ] **Step 6: Write and commit acceptance evidence**

Record exact commands, assertion counts, skill validation results, global source/deployment hashes, storyboard legacy regression, known limitations, and the final file list in `.superpowers/sdd/novel-action-director-acceptance.md`.

```powershell
git add -- .superpowers/sdd/novel-action-director-acceptance.md
git commit -m "docs: verify novel action director deployment"
```

---

## Final Verification Checklist

- [ ] Project source and deployed global skill hashes match.
- [ ] `quick_validate.py` passes on both source and deployed skill.
- [ ] New action-director selftests pass.
- [ ] All eighteen gates have a passing baseline and an individual failing fixture.
- [ ] Example validates, renders, and exports.
- [ ] Storyboard accepts correct action summaries and rejects changed action facts.
- [ ] Storyboard without `--actions` retains legacy behavior and passes all existing assertions.
- [ ] Script selftests remain green.
- [ ] `git diff --check` passes for all project-owned changes.
- [ ] No unrelated dirty or staged files enter task commits.
