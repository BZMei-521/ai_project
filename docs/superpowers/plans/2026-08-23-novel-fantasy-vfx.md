# Novel Fantasy VFX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user has disallowed subagents, so execute inline with checkpoints.

**Goal:** Create a production-usable `novel-fantasy-vfx` skill that converts supernatural script beats into validated `effects.json` plans and storyboard summaries.

**Architecture:** Follow the established action-director CLI shape (`seed`, `validate`, `render`, `export`) while keeping the effect lifecycle and energy topology independent from body motion and camera decisions. Deterministic gates enforce source fidelity, lifecycle continuity, topology coherence, scale, and generation risks.

**Tech Stack:** Node.js 18+ standard library, ES modules, Markdown, JSON, Codex skill metadata.

## Global Constraints

- `script.json` is the only source of supernatural abilities and outcomes.
- Optional `action.json` supplies casting gestures and backlash facts; optional `art.json` supplies scene anchors.
- Do not choose camera moves, cuts, compositing nodes, or model/provider settings.
- Do not infer damage, healing, sealing, summoning, or transformation solely from a formation/spell name.
- Complete and deploy this skill before starting `novel-edit-director`.

---

### Task 1: Scaffold and RED public API

**Files:**
- Create: `.agents/skills/novel-fantasy-vfx/scripts/selftest.mjs`
- Create: `.agents/skills/novel-fantasy-vfx/examples/fixtures/script.json`

**Interfaces:**
- Desired exports: `EFFECT_KINDS`, `LIFECYCLE_PHASES`, `parseEpisodeRange`, `expandScript`, `seedFromScript`, `gateReport`, `validateEffects`, `buildStoryboardSummary`, `renderMarkdown`, `renderHtml`, `runCli`.

- [ ] **Step 1: Create script fixture**

Use three beats: one ground formation explicitly described as defensive, one sword-rain attack, and one ordinary dialogue/action beat. Include only characters and props actually used.

- [ ] **Step 2: Write the initial import and seed assertions**

```js
import {
  EFFECT_KINDS, LIFECYCLE_PHASES, expandScript, gateReport,
  seedFromScript, validateEffects, buildStoryboardSummary,
  renderMarkdown, renderHtml,
} from './novel-fantasy-vfx.mjs';

assert.ok(EFFECT_KINDS.includes('formation'));
assert.deepEqual(LIFECYCLE_PHASES,
  ['dormant', 'charging', 'forming', 'active', 'impact', 'dissipating', 'residue']);
assert.equal(seedFromScript(SCRIPT).episodes[0].seedScenes[0].beats.length, 3);
assert.deepEqual(seedFromScript(SCRIPT).episodes[0].effects, []);
```

- [ ] **Step 3: Run RED**

Run: `node .agents/skills/novel-fantasy-vfx/scripts/selftest.mjs`

Expected: module-not-found for `novel-fantasy-vfx.mjs`.

- [ ] **Step 4: Commit RED**

```powershell
git add -- .agents/skills/novel-fantasy-vfx/scripts/selftest.mjs .agents/skills/novel-fantasy-vfx/examples/fixtures/script.json
git commit -m "test: define fantasy vfx public contract"
```

### Task 2: GREEN seed and source model

**Files:**
- Create: `.agents/skills/novel-fantasy-vfx/scripts/novel-fantasy-vfx.mjs`
- Test: `.agents/skills/novel-fantasy-vfx/scripts/selftest.mjs`

**Interfaces:**
- Produces: deterministic seed document version 1.

- [ ] **Step 1: Add constants and cloning helpers**

```js
export const EFFECT_KINDS = [
  'formation', 'elemental', 'sword-control', 'barrier', 'seal', 'healing',
  'purification', 'illusion', 'clone', 'invisibility', 'summoning',
  'spatial', 'astral', 'alchemy', 'environmental',
];
export const LIFECYCLE_PHASES = [
  'dormant', 'charging', 'forming', 'active', 'impact', 'dissipating', 'residue',
];
```

- [ ] **Step 2: Implement script normalization and episode range**

Use the action-director's accepted script shapes (`beats` and `flow`) but write the functions independently. Normalize every beat to `{ ep, sceneIndex, beat, kind, text, speaker?, delivery? }`.

- [ ] **Step 3: Implement `seedFromScript`**

Return:

```js
{
  source: script.source,
  version: 1,
  params: { maxMajorEffectsPerBeat: 1 },
  ordinaryBeatsPreserved: true,
  episodes: [{ ep, seedScenes, effects: [] }],
}
```

- [ ] **Step 4: Run GREEN and commit**

Run the selftest. Expected: seed assertions pass; later validation assertions may still be absent.

```powershell
git add -- .agents/skills/novel-fantasy-vfx/scripts
git commit -m "feat: seed fantasy effect plans"
```

### Task 3: RED/GREEN effects schema and gates

**Files:**
- Modify: `.agents/skills/novel-fantasy-vfx/scripts/selftest.mjs`
- Modify: `.agents/skills/novel-fantasy-vfx/scripts/novel-fantasy-vfx.mjs`

**Interfaces:**
- Produces: 12 deterministic quality gates.

- [ ] **Step 1: Define a fully valid formation fixture**

Include sourceBeat fidelity, `kind`, `function`, participants, complete start/end states, topology shape/origin/nodes/circuits, ordered phases, environment response, cameraIntent.mustShow, generationRisk, and optional actionRefs.

- [ ] **Step 2: Add one failing mutation per gate**

Use these IDs and failures:

```text
source-reference        nonexistent scene/beat
source-fidelity         rewritten source text
one-major-effect        duplicate effect on same beat
boundary-complete       missing startState/endState
lifecycle-order         active before forming
topology-coherence      nodes present but circuits absent
activation-continuity   phase state jumps without declared transition
effect-result-authority adds attack/heal/seal result absent from source
environment-scale       world-scale response for hand-scale effect
action-boundary         body gesture written into effect phases instead of actionRefs
camera-boundary         camera move/lens written into cameraIntent
generation-risk        mirror/particle/crowd risk not marked
```

- [ ] **Step 3: Verify RED**

Run the selftest. Expected: gate count and IDs fail before implementation.

- [ ] **Step 4: Implement `GATE_DEFINITIONS` and checks**

Use pure functions that return localized details. Lifecycle rank must follow `LIFECYCLE_PHASES`; repeated `active` is permitted, reverse transitions are not. `active` may be the final phase only when `endState.persistence === "continuing"`.

- [ ] **Step 5: Implement authority and boundary checks**

Compare result verbs (`攻击/命中/治愈/净化/封印/召唤/变身`) against `sourceBeat.text`. Forbid `camera`, `cameraMove`, `lens`, `shotSize` inside `cameraIntent`. Forbid `hands`, `supportFoot`, `weightShift`, or `bodyPose` in effect phases; those belong to action refs.

- [ ] **Step 6: Implement risk derivation**

Require flags for `multi-layer-mirror`, `dense-particles`, `multi-person-occlusion`, `large-scale-environment`, and `fine-symbols` when the corresponding structure requests them.

- [ ] **Step 7: Run GREEN and commit**

Expected: all gate mutations fail at the intended gate and the valid fixture passes all 12.

```powershell
git add -- .agents/skills/novel-fantasy-vfx/scripts
git commit -m "feat: validate fantasy effect lifecycle"
```

### Task 4: Export, render, CLI, and example

**Files:**
- Modify: `.agents/skills/novel-fantasy-vfx/scripts/selftest.mjs`
- Modify: `.agents/skills/novel-fantasy-vfx/scripts/novel-fantasy-vfx.mjs`
- Create: `.agents/skills/novel-fantasy-vfx/examples/阵法-effects.json`

**Interfaces:**
- Produces: `storyboard-effects.json` keyed by `E01-S02-B05`.

- [ ] **Step 1: Write failing export/render assertions**

Assert the summary contains function, topology, phaseSummary, environmentResponse, endState, mustShow, actionRefs, and generationRisk. Assert Markdown/HTML contain lifecycle and topology sections.

- [ ] **Step 2: Implement `buildStoryboardSummary`**

Call validation first and throw on failure. Export facts only; omit general spell knowledge and concrete camera moves.

- [ ] **Step 3: Implement Markdown and HTML renderers**

Display source beat, lifecycle, topology, environment response, persistence, risk, and all gate outcomes. Escape HTML from user data.

- [ ] **Step 4: Implement CLI**

Support exact commands:

```text
seed <script.json> [--eps 1-3]
validate <effects.json> --script <script.json> [--actions action.json] [--art art.json]
render <effects.json> --script <script.json> (--md|--html)
export <effects.json> --script <script.json> --out <storyboard-effects.json>
```

Unknown commands, missing required paths, malformed JSON, and validation failure must return a nonzero exit code and a readable error.

- [ ] **Step 5: Add a complete example and run smoke commands**

Use the fixture script as its source. Run seed, validate, Markdown render, HTML render, and export into a temporary directory with an explicit total timeout of 60 seconds.

- [ ] **Step 6: Commit**

```powershell
git add -- .agents/skills/novel-fantasy-vfx
git commit -m "feat: render and export fantasy effects"
```

### Task 5: Skill instructions, metadata, routing, and deployment

**Files:**
- Create: `.agents/skills/novel-fantasy-vfx/SKILL.md`
- Create: `.agents/skills/novel-fantasy-vfx/references/schema.md`
- Create: `.agents/skills/novel-fantasy-vfx/references/effect-pass.md`
- Create: `.agents/skills/novel-fantasy-vfx/references/formations.md`
- Create: `.agents/skills/novel-fantasy-vfx/references/spell-families.md`
- Create: `.agents/skills/novel-fantasy-vfx/references/continuity.md`
- Create: `.agents/skills/novel-fantasy-vfx/agents/openai.yaml`
- Modify: `AGENTS.md`
- Create: `docs/superpowers/verification/2026-08-23-novel-fantasy-vfx.md`

**Interfaces:**
- Produces: discoverable `$novel-fantasy-vfx` skill.

- [ ] **Step 1: Write concise SKILL.md**

Frontmatter description begins `Use when...` and triggers on 仙侠/玄幻法术、阵法、结界、召唤、能量生命周期. Route to only the reference needed for the current effect family.

- [ ] **Step 2: Write focused references**

`schema.md` contains exact fields; `effect-pass.md` contains selection order; `formations.md` contains topology grammar; `spell-families.md` contains the 24 learned families as decision cues, not automatic outcomes; `continuity.md` defines lifecycle and cross-beat persistence.

- [ ] **Step 3: Add metadata and AGENTS route**

```yaml
interface:
  display_name: "Novel Fantasy VFX"
  short_description: "设计并校验仙侠法术、阵法与能量生命周期"
  default_prompt: "Use $novel-fantasy-vfx to create a validated effects.json from this script."
policy:
  allow_implicit_invocation: true
```

- [ ] **Step 4: Validate and deploy**

Run quick validation, selftest, and all CLI smoke commands. Copy the complete project skill to `C:\Users\Administrator\.codex\skills\novel-fantasy-vfx` and compare all relative-path SHA-256 hashes.

- [ ] **Step 5: Record verification and commit**

Record assertion count, CLI commands, gate count, quick validation result, and hash comparison.

```powershell
git add -- .agents/skills/novel-fantasy-vfx AGENTS.md docs/superpowers/verification/2026-08-23-novel-fantasy-vfx.md
git commit -m "docs: deploy novel fantasy vfx skill"
```
