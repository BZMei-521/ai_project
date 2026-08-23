# Novel Storyboard Camera and Impact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user has disallowed subagents, so execute inline with checkpoints.

**Goal:** Version `novel-storyboard` in the repository and add structured camera motivation plus impact presentation without changing the H3 camera enum.

**Architecture:** Copy the verified global skill as the project baseline, prove its 221 assertions still pass, then add optional `cameraPlan` and action-derived `impactPresentation` gates. The existing H3 prompt phrases remain authoritative for model commands.

**Tech Stack:** Node.js 18+ standard library, ES modules, Markdown, JSON, MiniMax H3 prompt contract.

## Global Constraints

- Preserve all existing 18 base gates and 4 optional action gates.
- Keep `CAMERA_MOVES` unchanged.
- Old boards without `cameraPlan` remain valid; impact presentation is required only when an imported action summary contains `impactEvidence`.
- Do not add editing transitions to storyboard; inter-segment edits belong to `novel-edit-director`.
- Do not include the global skill's README files or report image unless a runtime caller requires them.

---

### Task 1: Establish the project-owned baseline

**Files:**
- Create: `.agents/skills/novel-storyboard/SKILL.md`
- Create: `.agents/skills/novel-storyboard/references/*.md`
- Create: `.agents/skills/novel-storyboard/scripts/*.mjs`
- Create: `.agents/skills/novel-storyboard/examples/渡口-storyboard.json`

**Interfaces:**
- Consumes: the current global `C:\Users\Administrator\.codex\skills\novel-storyboard` tree.
- Produces: a repository source tree with identical runtime files.

- [ ] **Step 1: Copy only runtime-owned files**

Copy `SKILL.md`, `references`, `scripts`, and `examples` into `.agents/skills/novel-storyboard`. Exclude `README.md`, `README.en.md`, and `assets/report.webp` because they are not required by the skill runtime.

- [ ] **Step 2: Verify the baseline before edits**

Run: `node .agents/skills/novel-storyboard/scripts/selftest.mjs`

Expected: `221 项断言全部通过`.

- [ ] **Step 3: Compare source hashes**

Compare copied files to the corresponding global files by SHA-256. Expected: every copied relative path matches.

- [ ] **Step 4: Commit baseline**

```powershell
git add -- .agents/skills/novel-storyboard
git commit -m "chore: version novel storyboard skill"
```

### Task 2: RED camera-plan and impact-presentation contracts

**Files:**
- Modify: `.agents/skills/novel-storyboard/scripts/selftest.mjs`

**Interfaces:**
- Consumes: `gateReport(board, ctx)` and action summaries with `impactEvidence`.
- Produces: two new base/optional gates.

- [ ] **Step 1: Add a valid optional camera plan**

```js
cut.cameraPlan = {
  purpose: '逐步暴露人物压抑情绪',
  path: 'push-in',
  speed: 'slow',
  amplitude: 'short',
  subjectRelation: 'approach',
  stabilization: 'stable',
  foregroundOcclusion: 'none',
  startSize: 'medium',
  endSize: 'close',
};
```

- [ ] **Step 2: Add failing camera assertions**

Verify `camera-plan` fails for a missing `purpose`, an unknown `speed`, or `startSize/endSize` outside the existing shot-size keys.

- [ ] **Step 3: Add impact presentation fixture**

Extend one imported action summary with `impactEvidence`. Add this cut field:

```js
impactPresentation: {
  actionId: 'E01-S01-B01-A01',
  contactVisibility: 'clear',
  impactPulse: 'brief',
  informationOrder: ['contact', 'latency', 'imbalance'],
  overlapReplays: 1,
  slowMotionPhase: 'post-contact',
}
```

- [ ] **Step 4: Add failing impact assertions**

Verify `impact-presentation` fails when the field is absent, `overlapReplays > 2`, information order omits contact/feedback, or slow motion is `full-action`.

- [ ] **Step 5: Run RED and commit**

Run: `node .agents/skills/novel-storyboard/scripts/selftest.mjs`

Expected: FAIL because `camera-plan` and `impact-presentation` gates do not exist.

```powershell
git add -- .agents/skills/novel-storyboard/scripts/selftest.mjs
git commit -m "test: define storyboard camera impact contracts"
```

### Task 3: GREEN validator and action adapter

**Files:**
- Modify: `.agents/skills/novel-storyboard/scripts/novel-storyboard.mjs`
- Test: `.agents/skills/novel-storyboard/scripts/selftest.mjs`

**Interfaces:**
- Produces: `camera-plan` base gate and `impact-presentation` optional action gate.

- [ ] **Step 1: Add camera-plan enums**

```js
const CAMERA_PLAN_SPEEDS = new Set(['very-slow', 'slow', 'moderate', 'fast']);
const CAMERA_PLAN_AMPLITUDES = new Set(['micro', 'short', 'medium', 'large']);
const CAMERA_PLAN_STABILIZATION = new Set(['locked', 'stable', 'gimbal', 'handheld']);
```

- [ ] **Step 2: Validate optional camera plans**

When the field exists, require all nine fields from the fixture. Validate speed, amplitude, stabilization, and both sizes. Do not require a camera plan on every cut.

- [ ] **Step 3: Carry impact evidence through action summary lookup**

Preserve `impactEvidence` in `actionSummaryOf` and seed `actionIntent`; do not translate it into a camera move.

- [ ] **Step 4: Validate impact presentation**

For every action ref with impact evidence, require a matching `impactPresentation.actionId`. Allow `contactVisibility` values `clear|occluded-with-alternative`; `impactPulse` values `none|brief`; `overlapReplays` integers 0–2; `slowMotionPhase` values `none|opportunity|post-contact|aftermath`. Require `informationOrder` to include `contact` plus one of `latency|support-change|center-of-mass|imbalance`.

- [ ] **Step 5: Run GREEN**

Run: `node .agents/skills/novel-storyboard/scripts/selftest.mjs`

Expected: all prior assertions plus new cases pass.

- [ ] **Step 6: Commit**

```powershell
git add -- .agents/skills/novel-storyboard/scripts
git commit -m "feat: validate storyboard camera and impact plans"
```

### Task 4: References, report, and export

**Files:**
- Create: `.agents/skills/novel-storyboard/references/camera-language.md`
- Modify: `.agents/skills/novel-storyboard/references/schema.md`
- Modify: `.agents/skills/novel-storyboard/references/storyboard-pass.md`
- Modify: `.agents/skills/novel-storyboard/references/h3-prompt.md`
- Modify: `.agents/skills/novel-storyboard/SKILL.md`
- Modify: `.agents/skills/novel-storyboard/scripts/novel-storyboard.mjs`
- Test: `.agents/skills/novel-storyboard/scripts/selftest.mjs`

**Interfaces:**
- Produces: rendered/exported camera and impact fields.

- [ ] **Step 1: Add failing render/export assertions**

Assert Markdown and HTML contain `镜头动机` and `打击呈现`; assert `exportPack` preserves both fields in its segment prompt package.

- [ ] **Step 2: Implement report/export display**

Render compact key/value blocks below each cut. Keep H3 prompt generation unchanged except that the authored prompt may use the validated plan to select an existing official camera phrase.

- [ ] **Step 3: Write camera-language.md**

Separate shot size, angle, camera movement, optics, stabilization, composition, editing, and blocking. Include the decision order from the design and mark emotional mappings as heuristics rather than gates.

- [ ] **Step 4: Document schemas and workflow**

Add exact `cameraPlan` and `impactPresentation` tables to `schema.md`; add a selection pass to `storyboard-pass.md`; add the brief impact pulse and slow-motion limits to `h3-prompt.md`; link `camera-language.md` from SKILL.md only when advanced movement is needed.

- [ ] **Step 5: Run tests and commit**

Run: `node .agents/skills/novel-storyboard/scripts/selftest.mjs`

Expected: all assertions pass.

```powershell
git add -- .agents/skills/novel-storyboard
git commit -m "docs: add storyboard camera language"
```

### Task 5: Metadata, routing, deployment, and regression

**Files:**
- Create: `.agents/skills/novel-storyboard/agents/openai.yaml`
- Modify: `AGENTS.md`
- Create: `docs/superpowers/verification/2026-08-23-novel-storyboard-camera-impact.md`

**Interfaces:**
- Produces: discoverable project/global skill and compatibility evidence.

- [ ] **Step 1: Add metadata and route**

Use display name `Novel Storyboard`, a 25–64 character short description, an implicit invocation policy, and a default prompt explicitly mentioning `$novel-storyboard`. Add `$novel-storyboard` to the project route table without changing unrelated rows.

- [ ] **Step 2: Validate skill**

Run `quick_validate.py` and the complete selftest. Expected: both succeed.

- [ ] **Step 3: Deploy project source globally**

Replace only the matching global runtime files after confirming the destination is `novel-storyboard`; retain unrelated global README/assets. Copy project `SKILL.md`, `references`, `scripts`, `examples`, and `agents` into the global directory.

- [ ] **Step 4: Run project regressions**

```powershell
npm run test:script-transitions
npm run test:video-continuity-planner
```

Expected: all existing transition and continuity checks pass.

- [ ] **Step 5: Compare hashes and record verification**

Compare every project-owned relative path with the global destination and record assertion counts, regression results, and hashes.

- [ ] **Step 6: Commit**

```powershell
git add -- .agents/skills/novel-storyboard/agents/openai.yaml AGENTS.md docs/superpowers/verification/2026-08-23-novel-storyboard-camera-impact.md
git commit -m "docs: deploy storyboard camera update"
```
