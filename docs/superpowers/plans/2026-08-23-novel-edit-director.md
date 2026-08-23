# Novel Edit Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user has disallowed subagents, so execute inline with checkpoints.

**Goal:** Create a `novel-edit-director` skill that designs validated inter-segment transition and audio-bridge contracts compatible with the existing storyboard workbench.

**Architecture:** Keep the application's four `VideoBoundaryKind` values as the execution layer and express the learned transition vocabulary through six semantic methods. The CLI consumes `storyboard.json`, validates every adjacent segment boundary, exports existing `ShotTransition` fields, and preserves richer edit intent in extension metadata.

**Tech Stack:** Node.js 18+ standard library, ES modules, Markdown, JSON, existing TypeScript transition contract used only as an external compatibility target.

## Global Constraints

- Edit only boundaries between adjacent generated segments; segment-internal cuts remain storyboard-owned.
- Do not use transitions to hide broken action, asset, screen-direction, or spatial continuity.
- Keep `type` within `continuous|match_cut|hard_cut|scene_change`.
- No video compositing, FFmpeg rendering, model invocation, or provider mutation.
- Preserve the current workbench transition schema and regression tests.

---

### Task 1: Scaffold and RED public API

**Files:**
- Create: `.agents/skills/novel-edit-director/scripts/selftest.mjs`
- Create: `.agents/skills/novel-edit-director/examples/fixtures/storyboard.json`

**Interfaces:**
- Desired exports: `BOUNDARY_TYPES`, `EDIT_METHODS`, `seedFromStoryboard`, `gateReport`, `validateEdit`, `buildWorkbenchTransitions`, `renderMarkdown`, `renderHtml`, `runCli`.

- [ ] **Step 1: Create a three-segment storyboard fixture**

Use sequential IDs `E01-01`, `E01-02`, `E01-03`; include sceneIndex, cuts, boundaries, camera direction, characters, and durations sufficient to test continuity and scene change.

- [ ] **Step 2: Write initial assertions**

```js
assert.deepEqual(BOUNDARY_TYPES, ['continuous', 'match_cut', 'hard_cut', 'scene_change']);
assert.deepEqual(EDIT_METHODS, [
  'occlusion-bridge', 'motion-bridge', 'action-match',
  'visual-match', 'time-space-jump', 'emotion-audio-trigger',
]);
const seed = seedFromStoryboard(STORYBOARD);
assert.equal(seed.boundaries.length, 2);
assert.deepEqual(seed.boundaries.map((x) => [x.from, x.to]),
  [['E01-01', 'E01-02'], ['E01-02', 'E01-03']]);
```

- [ ] **Step 3: Run RED**

Expected: module-not-found for `novel-edit-director.mjs`.

- [ ] **Step 4: Commit RED**

```powershell
git add -- .agents/skills/novel-edit-director/scripts/selftest.mjs .agents/skills/novel-edit-director/examples/fixtures/storyboard.json
git commit -m "test: define edit director public contract"
```

### Task 2: GREEN seed and adjacency model

**Files:**
- Create: `.agents/skills/novel-edit-director/scripts/novel-edit-director.mjs`
- Test: `.agents/skills/novel-edit-director/scripts/selftest.mjs`

**Interfaces:**
- Produces: edit document version 1 with exactly one boundary per adjacent segment pair.

- [ ] **Step 1: Add constants**

```js
export const BOUNDARY_TYPES = ['continuous', 'match_cut', 'hard_cut', 'scene_change'];
export const EDIT_METHODS = [
  'occlusion-bridge', 'motion-bridge', 'action-match',
  'visual-match', 'time-space-jump', 'emotion-audio-trigger',
];
```

- [ ] **Step 2: Flatten segments deterministically**

Preserve episode and segment order. Reject duplicate segment IDs. Create adjacency only within the authored sequence; a new episode starts a new sequence unless the storyboard explicitly sets `continuousAcrossEpisodes: true`.

- [ ] **Step 3: Seed neutral boundaries**

Return each boundary with `type: "hard_cut"`, `method: null`, empty anchors, `bridge.duration: 0`, empty match/change lists, and copies of outgoing/incoming boundary facts for authoring reference. Do not silently choose a decorative transition.

- [ ] **Step 4: Run GREEN and commit**

```powershell
git add -- .agents/skills/novel-edit-director/scripts
git commit -m "feat: seed edit boundary plans"
```

### Task 3: RED/GREEN edit quality gates

**Files:**
- Modify: `.agents/skills/novel-edit-director/scripts/selftest.mjs`
- Modify: `.agents/skills/novel-edit-director/scripts/novel-edit-director.mjs`

**Interfaces:**
- Produces: 12 deterministic gates.

- [ ] **Step 1: Create a valid edit fixture**

Use one `continuous` motion bridge and one `scene_change` time-space jump. Populate purpose, type, method, outgoing/incoming anchors, visual/audio bridge, duration, execution, `mustMatch`, `intentionalChange`, frame dependency, character position, and camera direction.

- [ ] **Step 2: Add one mutation per gate**

```text
source-reference       unknown segment
adjacent-boundary      non-adjacent from/to
one-boundary-per-pair  duplicate or missing edge
boundary-type          unsupported type
method-compatibility   scene-change semantics under continuous without declared change
anchor-complete        match method missing outgoing/incoming anchor
continuity-evidence    continuous edge contradicts end/start state
occlusion-direction    occlusion bridge lacks entry/exit direction
audio-authority        invented dialogue or music cue not in board/director plan
duration-bounds        negative/nonfinite or longer than shorter segment
risky-morph-routing    continuous age/city/era/world morph requested in one generation
workbench-compat       invalid frameDependency or hard_cut duration not zero
```

- [ ] **Step 3: Verify RED**

Run selftest. Expected: missing gate IDs/count.

- [ ] **Step 4: Implement core validation**

Validate types and pair coverage. Require anchors for `action-match|visual-match|motion-bridge`; require an occluder plus `entryDirection` and `exitDirection` for `occlusion-bridge`; require trigger and audio source for `emotion-audio-trigger`.

- [ ] **Step 5: Implement continuity and morph routing**

For `continuous`, compare the source segment's last cut `endBoundary` with the destination's first cut `startBoundary`, allowing only differences listed in `intentionalChange`. Reject `年龄连续变化|城市生长|时代连续变形|跨世界一镜到底|四季连续变形` unless the plan uses `hard_cut|match_cut|scene_change` and declares stable endpoint assets.

- [ ] **Step 6: Implement workbench limits**

`frameDependency` must be `none|previous_tail|shared_frame`; hard cut duration must be 0; other durations must be finite, nonnegative, and no longer than the shorter neighboring segment.

- [ ] **Step 7: Run GREEN and commit**

Expected: valid edit passes all 12; every mutation fails at the intended gate.

```powershell
git add -- .agents/skills/novel-edit-director/scripts
git commit -m "feat: validate edit boundary contracts"
```

### Task 4: Workbench export, render, CLI, and example

**Files:**
- Modify: `.agents/skills/novel-edit-director/scripts/selftest.mjs`
- Modify: `.agents/skills/novel-edit-director/scripts/novel-edit-director.mjs`
- Create: `.agents/skills/novel-edit-director/examples/渡口-edit.json`

**Interfaces:**
- Produces: `ShotTransition[]` compatible objects.

- [ ] **Step 1: Write failing adapter assertions**

```js
const [transition] = buildWorkbenchTransitions(VALID_EDIT, STORYBOARD, 'sequence-1');
assert.equal(transition.type, 'match_cut');
assert.equal(transition.durationSeconds, 0.18);
assert.equal(transition.frameDependency, 'shared_frame');
assert.equal(transition.fromShotId, 'E01-01');
assert.equal(transition.toShotId, 'E01-02');
assert.match(transition.notes, /method=action-match/);
```

- [ ] **Step 2: Implement the adapter**

Map fields exactly to `ShotTransition`: `sequenceId`, `fromShotId`, `toShotId`, `type`, `durationSeconds`, `frameDependency`, `actionContinuity`, `characterPosition`, `cameraDirection`, `notes`. Store method, anchors, execution, and intentional changes as a stable JSON object in `notes` prefixed by `edit-director:v1 `.

- [ ] **Step 3: Implement reports**

Markdown and HTML show adjacent segments, purpose, visual/audio anchors, continuity facts, intentional changes, duration, and gate outcomes. Escape HTML.

- [ ] **Step 4: Implement CLI**

```text
seed <storyboard.json>
validate <edit.json> --storyboard <storyboard.json>
render <edit.json> --storyboard <storyboard.json> (--md|--html)
export <edit.json> --storyboard <storyboard.json> --sequence <id> --out <transitions.json>
```

- [ ] **Step 5: Add example and run smoke tests**

Run all four commands in a temporary directory with an explicit 60-second total timeout. Expected: zero exit code and parseable outputs.

- [ ] **Step 6: Commit**

```powershell
git add -- .agents/skills/novel-edit-director
git commit -m "feat: export edit plans to workbench"
```

### Task 5: Skill instructions, metadata, routing, and deployment

**Files:**
- Create: `.agents/skills/novel-edit-director/SKILL.md`
- Create: `.agents/skills/novel-edit-director/references/schema.md`
- Create: `.agents/skills/novel-edit-director/references/edit-pass.md`
- Create: `.agents/skills/novel-edit-director/references/transition-methods.md`
- Create: `.agents/skills/novel-edit-director/references/audio-bridges.md`
- Create: `.agents/skills/novel-edit-director/references/risk-routing.md`
- Create: `.agents/skills/novel-edit-director/agents/openai.yaml`
- Modify: `AGENTS.md`
- Create: `docs/superpowers/verification/2026-08-23-novel-edit-director.md`

**Interfaces:**
- Produces: discoverable `$novel-edit-director` skill.

- [ ] **Step 1: Write concise SKILL.md and references**

Trigger on 转场、剪辑衔接、动作匹配、遮挡桥接、声音桥、蒙太奇 and hard cuts that feel abrupt. Keep the six method definitions and high-risk routing in references, not the entrypoint.

- [ ] **Step 2: Add metadata and route**

```yaml
interface:
  display_name: "Novel Edit Director"
  short_description: "设计镜头段之间的转场、匹配剪辑与声音桥"
  default_prompt: "Use $novel-edit-director to create a validated edit.json for this storyboard."
policy:
  allow_implicit_invocation: true
```

- [ ] **Step 3: Validate skill and behavior**

Run quick validation, selftest, and four CLI smoke commands. Expected: all succeed.

- [ ] **Step 4: Deploy and compare hashes**

Copy to `C:\Users\Administrator\.codex\skills\novel-edit-director`; compare all relative path/hash pairs.

- [ ] **Step 5: Run workbench regressions**

```powershell
npm run test:script-transitions
npm run test:video-continuity-planner
```

Expected: all checks pass and the exported fixture satisfies the existing import/runtime contract.

- [ ] **Step 6: Record verification and commit**

```powershell
git add -- .agents/skills/novel-edit-director AGENTS.md docs/superpowers/verification/2026-08-23-novel-edit-director.md
git commit -m "docs: deploy novel edit director skill"
```

### Task 6: End-to-end contract verification

**Files:**
- Create: `scripts/check-novel-directing-skills.mjs`
- Create: `docs/superpowers/verification/2026-08-23-ai-drama-directing-skills.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: action, effects, storyboard, edit CLIs.
- Produces: one deterministic integration command.

- [ ] **Step 1: Write the failing package command check**

Add a check script that expects `package.json.scripts['test:novel-directing-skills']` and verifies all four project skill entrypoints exist. Run it before changing package.json and confirm failure.

- [ ] **Step 2: Implement the integration runner**

Use `spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60000 })` for each selftest and fixture validation. Fail on nonzero status, timeout, missing output, or malformed exported JSON.

- [ ] **Step 3: Add package script**

```json
"test:novel-directing-skills": "node scripts/check-novel-directing-skills.mjs"
```

- [ ] **Step 4: Run final suite**

```powershell
npm run test:novel-directing-skills
npm run test:script-transitions
npm run test:video-continuity-planner
```

Expected: all commands pass within their explicit timeouts.

- [ ] **Step 5: Verify four global deployments**

Compare project/global hashes for all project-owned skill files and ensure `$novel-action-director`, `$novel-storyboard`, `$novel-fantasy-vfx`, and `$novel-edit-director` all pass quick validation.

- [ ] **Step 6: Record results and commit**

```powershell
git add -- scripts/check-novel-directing-skills.mjs package.json docs/superpowers/verification/2026-08-23-ai-drama-directing-skills.md
git commit -m "test: verify ai drama directing skills"
```
