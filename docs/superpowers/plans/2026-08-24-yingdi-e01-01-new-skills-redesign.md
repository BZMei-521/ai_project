# E01-01 New-Skills Storyboard Remake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a validated five-cut E01-01 remake and five new comparison frames using the new action-director and storyboard skills without overwriting the existing version.

**Architecture:** Build a mechanically scoped five-beat script for storyboard duration/coverage, while validating the five selected action plans against the complete original script so the action director can preserve ordinary beats. Treat `action.json` as the physical/performance authority and project its five summaries into one 14.2083-second storyboard segment. Validate every stage with the skill-owned CLI; because edit-director only owns boundaries between segments, run it as an explicit zero-boundary compatibility check instead of inventing four false segment transitions.

**Tech Stack:** JSON, Node.js 22 standard-library CLIs supplied by `novel-action-director`, `novel-storyboard`, and `novel-edit-director`; Codex image generation with local identity references; static HTML for A/B review.

## Global Constraints

- Process only E01-01: episode 1, scene 1, beats 1–5.
- Preserve 5 cuts at 24 fps with frame counts `72, 63, 72, 62, 72`, totaling 341 frames / 14.2083 seconds.
- Preserve the established dual timing authority: production/import frame counts remain exact, while official storyboard/H3 display seconds are `3.0, 2.6, 3.0, 2.6, 3.0`; never derive replacement frame counts from the rounded display seconds.
- Preserve the exact source dialogue, voiceover, cast, setting, and props; show no person outside the coffin and add no fantasy VFX.
- Never overwrite `分镜/E01-01/`, `分镜/work/episode-01.storyboard.json`, existing imports, or existing videos.
- Write every generated artifact under `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/`.
- Use `影帝他总想对我图谋不轨_漫剧改编/人物/images/李宝珠-sheet.png` as the character identity reference for every new frame.
- Treat the source script as story authority; use old frames only as A/B baselines and scene-orientation references.
- Do not use `novel-fantasy-vfx`; this segment contains no authorized supernatural visual event.

---

## File Map

- Create `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/source.script.json`: exact episode/scene/beat projection used by storyboard duration and beat-coverage validation; action validation uses the complete original script.
- Create `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/action.json`: observable action, performance channels, physical phases, and state boundaries.
- Create `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/storyboard-actions.json`: official compact action export consumed by storyboard validation.
- Create `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/storyboard.json`: one segment `E01-01` with five cuts and full boundary chain; version isolation comes from the parent directory because the official validator requires sequential `E01-01` segment IDs.
- Create `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/edit.json`: official edit seed with an empty `boundaries` array.
- Create `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/transitions.json`: official workbench export, expected to be `[]`.
- Create `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/reports/action.md`, `storyboard.md`, and `edit.md`: human-readable validation evidence.
- Create `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/E01-01/f1.png` through `f5.png`: new keyframes.
- Create `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/comparison/index.html`: five-row old/new review page.

### Task 1: Create the scoped authoritative input

**Files:**
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/source.script.json`
- Read: `影帝他总想对我图谋不轨_漫剧改编/剧本/影帝他总想对我图谋不轨-script.json`

**Interfaces:**
- Consumes: the original top-level `source`, `version`, `params`, episode 1 metadata, scene 1 metadata, and `flow[0..4]`.
- Produces: a valid `script.json` with one episode, one scene, and five unchanged beats for downstream storyboard validation.

- [ ] **Step 1: Create the output directories**

Create only these directories: the output root, `reports`, `E01-01`, and `comparison`. Confirm `分镜/E01-01/f1.png` through `f5.png` remain outside the output root.

- [ ] **Step 2: Write the scoped script projection**

Copy the original script’s top-level `source`, `version`, and `params`; copy episode 1 and scene 1 metadata; retain exactly the first five `flow` entries without rewriting any `action`, `line`, `speaker`, or `delivery`; set that projected episode’s `targetSeconds` to `14.2083`. Do not renumber the retained flow entries.

- [ ] **Step 3: Verify source fidelity mechanically**

Run a read-only comparison that asserts the projected `flow` equals `original.episodes[0].scenes[0].flow.slice(0, 5)`, the projected episode count is 1, scene count is 1, and `targetSeconds === 14.2083`.

Expected: one line, `PASS source scope: E01 S01 beats 1-5, target 14.2083s`.

- [ ] **Step 4: Commit the scoped source**

```powershell
git add -- "影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/source.script.json"
git commit -m "chore: scope E01-01 storyboard source"
```

### Task 2: Author and validate the action plan

**Files:**
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/action.json`
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/storyboard-actions.json`
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/reports/action.md`

**Interfaces:**
- Consumes: the complete original `影帝他总想对我图谋不轨_漫剧改编/剧本/影帝他总想对我图谋不轨-script.json` and `影帝他总想对我图谋不轨_漫剧改编/人物/影帝他总想对我图谋不轨-cast.json`.
- Produces: five action summaries keyed `E01-S01-B01` through `E01-S01-B05`, with exact source beats and compatible adjacent states.

- [ ] **Step 1: Generate the deterministic action seed**

```powershell
node "C:\Users\Administrator\.codex\skills\novel-action-director\scripts\novel-action-director.mjs" seed "影帝他总想对我图谋不轨_漫剧改编/剧本/影帝他总想对我图谋不轨-script.json" --eps 1 --physics realistic --out "影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/action.json"
```

Expected: `action.json` with `physicsProfile: "realistic"`, one episode, copied `seedScenes`, and no authored actions.

- [ ] **Step 2: Author five source-faithful actions**

Use one action per beat and these required intents:

```json
[
  {"id":"E01-S01-B01-A01","kind":"performance","intent":"从昏迷中惊醒并本能撑向近在咫尺的棺盖"},
  {"id":"E01-S01-B02-A01","kind":"performance","intent":"在受限呼吸中呼救并把撑顶升级为拍击预备"},
  {"id":"E01-S01-B03-A01","kind":"performance","intent":"以右掌击中棺盖并从闷响和回弹确认棺盖无法推动"},
  {"id":"E01-S01-B04-A01","kind":"performance","intent":"在回声后的静默中压住恐慌并辨认陌生寒冷环境"},
  {"id":"E01-S01-B05-A01","kind":"performance","intent":"以左手确认身下绸缎、右手确认头顶铜钉后僵住"}
]
```

For every action, copy `sourceBeat` exactly; declare C01 as the only participant; keep `propRefs` empty because the source scene declares no prop IDs; use complete character start and end states; end with a `recovery` phase containing `stablePose`. All five performance actions must include `trigger`, `gazeTarget`, `control`, 2–4 observable `channels`, `leak`, and `release`. For B03 and B05 record exact left/right-hand contact, recoil or tactile confirmation inside phases, boundaries, and `cameraIntent.mustShow`; do not claim a prop state change. Mark fine hands and cramped occlusion in `generationRisk`. Make each action’s end state equal the next action’s start state.

- [ ] **Step 3: Run the official action validator**

```powershell
node "C:\Users\Administrator\.codex\skills\novel-action-director\scripts\novel-action-director.mjs" validate "影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/action.json" --script "影帝他总想对我图谋不轨_漫剧改编/剧本/影帝他总想对我图谋不轨-script.json" --cast "影帝他总想对我图谋不轨_漫剧改编/人物/影帝他总想对我图谋不轨-cast.json"
```

Expected: `PASS · 24/24 门禁通过 · 5 个动作计划`.

- [ ] **Step 4: Export the storyboard action summary**

```powershell
node "C:\Users\Administrator\.codex\skills\novel-action-director\scripts\novel-action-director.mjs" export "影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/action.json" --script "影帝他总想对我图谋不轨_漫剧改编/剧本/影帝他总想对我图谋不轨-script.json" --out "影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/storyboard-actions.json"
```

Expected: exactly five keys, `E01-S01-B01` through `E01-S01-B05`.

- [ ] **Step 5: Render the action report**

```powershell
node "C:\Users\Administrator\.codex\skills\novel-action-director\scripts\novel-action-director.mjs" render "影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/action.json" --script "影帝他总想对我图谋不轨_漫剧改编/剧本/影帝他总想对我图谋不轨-script.json" --md --out "影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/reports/action.md"
```

Expected: report shows five actions and all 24 gates passing.

- [ ] **Step 6: Commit the validated action artifacts**

Stage only `action.json`, `storyboard-actions.json`, and `reports/action.md`, then commit with `feat: direct E01-01 physical performance`.

### Task 3: Author and validate the five-cut storyboard

**Files:**
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/storyboard.json`
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/reports/storyboard.md`

**Interfaces:**
- Consumes: `source.script.json`, `storyboard-actions.json`, cast, and the approved five frame counts.
- Produces: one segment `E01-01` whose five cuts each claim one beat and project one action summary.

- [ ] **Step 1: Generate the storyboard seed with actions**

```powershell
node "C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\novel-storyboard.mjs" seed "影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/source.script.json" --eps 1 --actions "影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/storyboard-actions.json"
```

Save stdout as `storyboard.json`. Expected: one episode with `seedScenes`, no completed segment, and action references attached to beats 1–5.

- [ ] **Step 2: Replace the seed scene with one authored segment**

Create segment `E01-01` with official storyboard/H3 durations `3.0, 2.6, 3.0, 2.6, 3.0`; retain the independent production-frame authority `72, 63, 72, 62, 72` at 24 fps. Claim beats `[1,1]` through `[5,5]`; attach the matching action reference and `actionStateProjection` to each cut; remove `seedScenes` only after all five beats are covered.

Use this visual progression:

1. Close, restrained push-in: eyes open first, shoulders wedge, palms brace with visible asymmetry.
2. Close, controlled handheld: breath and cry lead, right hand begins to lift for the strike while left hand keeps spatial orientation.
3. Extreme close insert, static: right palm contact, wood compression/dust, wrist recoil; left hand stays out of the impact insert.
4. Close, micro push-in: motion stops, lips close for VO, gaze listens upward, jaw and breath expose suppressed panic.
5. Tactile close insert, static: left fingertips compress burial silk below while right fingertips find the bronze nail above, followed by a full-body freeze.

Every previous `endBoundary` must equal the next `startBoundary` byte-for-byte. The H3 prompt must use English outside `<d>` blocks, preserve the exact Chinese dialogue and VO, derive cut marks from the five durations, and use no character names outside dialogue blocks.

- [ ] **Step 3: Run official storyboard validation**

```powershell
node "C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\novel-storyboard.mjs" validate "影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/storyboard.json" --script "影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/source.script.json" --cast "影帝他总想对我图谋不轨_漫剧改编/人物/影帝他总想对我图谋不轨-cast.json" --actions "影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/storyboard-actions.json"
```

Expected: `1 集 / 1 段 / 5 个分镜全部通过校验`, total `14.2s` after tool rounding.

- [ ] **Step 4: Run the official quality checkup**

Run the same arguments with command `checkup` instead of `validate`.

Expected: every quality gate prints `✓` and the final line is `✓ 全部通过`.

- [ ] **Step 5: Render the storyboard report**

Run `render ... --md` with script, cast, and actions context, and save stdout to `reports/storyboard.md`.

Expected: the report lists one segment, five cuts, five frame prompts, five action projections, and no missing beat.

- [ ] **Step 6: Commit the validated storyboard artifacts**

Stage only `storyboard.json` and `reports/storyboard.md`, then commit with `feat: storyboard E01-01 with action continuity`.

### Task 4: Prove edit-director compatibility without false transitions

**Files:**
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/edit.json`
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/transitions.json`
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/reports/edit.md`

**Interfaces:**
- Consumes: the one-segment `storyboard.json`.
- Produces: an explicit, validator-approved statement that there is no inter-segment boundary in this scope.

- [ ] **Step 1: Seed edit boundaries**

```powershell
node "C:\Users\Administrator\.codex\skills\novel-edit-director\scripts\novel-edit-director.mjs" seed "影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/storyboard.json"
```

Save stdout as `edit.json`. Expected exact structural result: `{"source":"影帝他总想对我图谋不轨","version":1,"boundaries":[]}`.

- [ ] **Step 2: Validate the empty boundary set**

```powershell
node "C:\Users\Administrator\.codex\skills\novel-edit-director\scripts\novel-edit-director.mjs" validate "影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/edit.json" --storyboard "影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/storyboard.json"
```

Expected: `✓ 通过 12 项剪辑门禁`.

- [ ] **Step 3: Render and export**

Render Markdown to `reports/edit.md`, then export with `--sequence E01-01 --out transitions.json`.

Expected: `reports/edit.md` contains the 12 passing gates and `transitions.json` equals `[]`.

- [ ] **Step 4: Commit compatibility evidence**

Stage only `edit.json`, `transitions.json`, and `reports/edit.md`, then commit with `test: verify E01-01 edit boundary compatibility`.

### Task 5: Generate five new keyframes

**Files:**
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/E01-01/f1.png`
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/E01-01/f2.png`
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/E01-01/f3.png`
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/E01-01/f4.png`
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/E01-01/f5.png`

**Interfaces:**
- Consumes: each cut’s validated `frame`, boundary state, and `李宝珠-sheet.png`.
- Produces: five identity-consistent 16:9 cinematic CG storyboard frames aligned to cuts 1–5.

- [ ] **Step 1: Inspect references before generation**

Visually inspect `李宝珠-sheet.png` and all five old E01-01 frames. Record stable identity anchors—face shape, hair, ceremonial robe, palette—and reject any old-frame anatomy or hand mistake as a reference constraint.

- [ ] **Step 2: Generate f1**

Use the character sheet as the identity reference and the old f1 only for coffin orientation. Generate a restrained close-up: eyes just opened, shoulders pinned, both palms braced asymmetrically under a lid inches above, cold slit light, readable compression, correct two-hand anatomy, no other person.

- [ ] **Step 3: Generate f2**

Use the character sheet plus new f1 for identity/scene continuity. Generate the breathless cry state: mouth open mid-call, chest and neck visibly strained, left palm maintaining contact, right hand beginning to withdraw for a strike, same costume/light/coffin geometry, no extra hands.

- [ ] **Step 4: Generate f3**

Use the character sheet plus new f2. Generate an extreme close insert of the right palm at wooden-lid contact with believable wrist alignment, slight dust/compression and imminent recoil; exclude the left hand from the insert and avoid gore, sparks, or camera-shake artifacts.

- [ ] **Step 5: Generate f4**

Use the character sheet plus new f3 for palette continuity. Generate a close reaction with lips fully closed, upward listening gaze, jaw held, shallow breath, shoulders still wedged, right hand recovering from impact and left hand orienting against the interior.

- [ ] **Step 6: Generate f5**

Use the character sheet plus new f4. Generate a tactile diagonal composition that makes both contacts legible without impossible anatomy: left fingertips compress silk below; right fingertips touch a large fixed bronze nail above; her eyes lock and body freezes; preserve the same face, robe, light direction, and coffin dimensions.

- [ ] **Step 7: Verify the image set**

Confirm five non-empty PNG files exist; inspect each at original resolution; reject identity drift, extra fingers/limbs, swapped hands, missing bronze nail/silk, inconsistent costume, changed light direction, or visible external characters. Regenerate only failed frames while preserving passed frames.

- [ ] **Step 8: Commit the five approved frames**

Stage only the five new PNG files, then commit with `feat: generate E01-01 comparison keyframes`.

### Task 6: Build and verify the A/B comparison

**Files:**
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/rework-e01-01-new-skills/comparison/index.html`

**Interfaces:**
- Consumes: five old frames, five new frames, and cut purpose text from `storyboard.json`.
- Produces: a self-contained review page with five rows and no copied image assets.

- [ ] **Step 1: Write the comparison page**

Create one row per cut with columns `旧版`, `新版`, and `检查重点`. Use relative image references to `../../E01-01/fN.png` for old frames and `../E01-01/fN.png` for new frames. The five check labels are: `惊醒与受限`, `呼救到蓄力`, `接触与回弹`, `静默认知`, `左右手触觉证据`.

- [ ] **Step 2: Verify every image reference**

Parse the ten `<img src>` values, resolve them relative to `comparison/index.html`, and assert all ten files exist and have non-zero size.

Expected: `PASS comparison: 5 old + 5 new images resolved`.

- [ ] **Step 3: Open the page and visually review it**

Open the local comparison page in the current in-app browser. Confirm each row displays the correct cut number and that old/new framing is large enough to compare hands, face, light, and coffin geometry.

- [ ] **Step 4: Final end-to-end verification**

Re-run action validate, storyboard validate, storyboard checkup, and edit validate. Recheck the frame total equals 341 and the five image files exist.

Expected: all official gates pass, total frames `341`, duration `14.2083`, images `5/5`.

- [ ] **Step 5: Commit the comparison page**

Stage only `comparison/index.html`, then commit with `docs: add E01-01 old-new storyboard comparison`.
