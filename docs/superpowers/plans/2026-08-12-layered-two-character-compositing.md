# Layered Two-Character Compositing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and visually validate one traceable 1152×640 riverside image by generating Shen Yan and Jiang Lan independently, extracting alpha masks, compositing them deterministically, and limiting AI repair to non-identity regions.

**Architecture:** A small Node ESM domain library owns immutable run reports, layout contracts, artifact hashes, and acceptance state. Separate ComfyUI API presets/runners produce the empty plate, one character at a time, and BiRefNet mattes; an FFmpeg-based deterministic compositor handles placement, lighting approximation, and contact shadows. A final optional repair stage is mask-limited and may never auto-accept creative quality.

**Tech Stack:** Node.js ESM, ComfyUI HTTP API at `http://127.0.0.1:8188`, ComfyUI API workflow JSON, Qwen Image Edit 2511/Klein character references already installed in the workspace, core BiRefNet background removal, SDPose, FFmpeg/FFprobe, SHA-256 artifact manifests.

## Global Constraints

- The formal design is `docs/superpowers/specs/2026-08-12-layered-two-character-compositing-design.md`.
- The authoritative source image is exactly `C:/Users/Administrator/AppData/Local/Comfy-Desktop/ComfyUI-Shared/output/Storyboard/河边远景建立_klein_ref_00006_.png`, and formal output geometry is exactly 1152×640.
- The first sample contains exactly two human characters, Shen Yan and Jiang Lan, standing apart and looking at one another; no touch, embrace, hand-holding, duplicate person, third person, or beast traits.
- Identity is the first acceptance gate. A failed face, hairstyle, or primary costume candidate is rejected before compositing.
- The empty plate and accepted per-character candidates are immutable versioned artifacts; reruns append candidates and never overwrite accepted files.
- Final repair may modify only hair/clothing outer edges, foot-ground contact, local occlusion, contact shadows, and low-strength environmental spill. Face, primary hair mass, primary costume, and key accessories are protected.
- No StoryboardPro UI integration, video generation, MiniMax H3 local deployment, LoRA training, paid API, large model download, or new third-party node installation is in scope.
- Any need for a new third-party node, paid call, or model download stops execution and requires separate user approval.
- Live ComfyUI generation is strictly serial. A preflight artifact may not be recorded as the formal 1152×640 sample.
- Do not modify, delete, stage, or reset unrelated dirty-worktree files. Every task stages only its explicit file list.

## File Structure

- `scripts/lib/layered-compositing-run.mjs` — report schema, immutable artifact records, state transitions, hashing, and acceptance gates.
- `scripts/lib/layered-compositing-layout.mjs` — fixed two-character geometry, pose/layout validation, and mask relationship checks.
- `scripts/lib/layered-compositing-media.mjs` — FFprobe image validation, raw-pixel comparisons, alpha/mask validation, and protected-region metrics.
- `scripts/lib/layered-compositing-comfy.mjs` — token substitution, object-info validation, queue/history/view adapter, and atomic Comfy output capture.
- `scripts/lib/layered-compositing-compose.mjs` — deterministic alpha placement, background spill, and contact-shadow FFmpeg graph construction.
- `scripts/check-layered-compositing-run.mjs` — domain/report contract tests.
- `scripts/check-layered-compositing-layout.mjs` — layout and geometry contract tests.
- `scripts/check-layered-compositing-comfy.mjs` — injected Comfy adapter and preset contract tests.
- `scripts/check-layered-compositing-matte.mjs` — real FFmpeg fixture tests for mask and alpha output.
- `scripts/check-layered-compositing-compose.mjs` — real deterministic compositor and protection-mask tests.
- `scripts/check-layered-compositing-review.mjs` — review CLI transition and immutable evidence tests.
- `scripts/check-layered-compositing-live-readiness.mjs` — read-only inventory, input, and model readiness checks.
- `scripts/init-layered-compositing-sample.mjs` — create the isolated report and freeze source/character resource hashes.
- `scripts/run-layered-empty-plate.mjs` — generate one append-only empty-plate candidate.
- `scripts/run-layered-character.mjs` — generate one append-only candidate for exactly one named character.
- `scripts/run-layered-matte.mjs` — run core BiRefNet on one accepted character candidate.
- `scripts/run-layered-compose.mjs` — deterministic full-resolution composite and diagnostic masks.
- `scripts/run-layered-local-repair.mjs` — optional Qwen masked repair, with identity protection verification.
- `scripts/review-layered-compositing.mjs` — explicit accept/reject CLI for plate, characters, composite, and final sample.
- `src/modules/comfy-pipeline/presets/layered-empty-plate-qwen-v1.json` — Qwen removal/inpaint API graph.
- `src/modules/comfy-pipeline/presets/layered-character-qwen-v1.json` — isolated identity/full-body character API graph.
- `src/modules/comfy-pipeline/presets/layered-birefnet-matte-v1.json` — core BiRefNet API graph.
- `src/modules/comfy-pipeline/presets/layered-local-repair-qwen-v1.json` — mask-restricted edge/contact repair API graph.
- `logs/layered-two-character-sample/` — live run only; immutable candidates, diagnostics, report, and review evidence.

---

### Task 1: Immutable Run Contract and Input Preflight

**Files:**
- Create: `scripts/lib/layered-compositing-run.mjs`
- Create: `scripts/check-layered-compositing-run.mjs`
- Create: `scripts/init-layered-compositing-sample.mjs`

**Interfaces:**
- Produces: `createRunReport(input): RunReport`, `assertRunInvariant(report, io): void`, `appendCandidate(report, stage, candidate): RunReport`, `reviewCandidate(report, stage, id, review, io): RunReport`, `sha256File(path): string`, and `writeJsonAtomic(path, value): void`.
- Produces report states `pending | technical | accepted | rejected`; `overallStatus` remains `pending` until explicit final review.
- Consumes no feature code from later tasks.

- [ ] **Step 1: Write the failing domain contract test**

Create a test that constructs a report with the exact source geometry and two isolated character packages, then asserts malformed geometry, missing face/full-body resources, duplicate candidate IDs, in-place candidate replacement, evidence hash mismatch, and technical-to-final auto-accept all throw. Include a positive rejection test proving rejection remains possible after a candidate artifact is removed.

```js
const report = createRunReport({
  source: { path: sourcePath, sha256: sha256File(sourcePath), width: 1152, height: 640 },
  characters: {
    shen_yan: { name: "沈砚", species: "human", faceMaster: faceA, bodyFront: bodyA },
    jiang_lan: { name: "江岚", species: "human", faceMaster: faceB, bodyFront: bodyB }
  }
});
assert.equal(report.overallStatus, "pending");
assert.throws(() => appendCandidate(report, "shen_yan", { id: "candidate_001" }), /artifact/i);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/check-layered-compositing-run.mjs`  
Expected: exit 1 with `ERR_MODULE_NOT_FOUND` for `scripts/lib/layered-compositing-run.mjs`.

- [ ] **Step 3: Implement the minimal immutable report library**

Use `structuredClone`, exact schema version `1`, path normalization with `path.resolve`, and SHA-256 checks. `appendCandidate` must reject an existing `{stage,id}` pair. `reviewCandidate(... accepted ...)` must require a currently stored, decodable evidence artifact; `rejected` must remain fail-safe and require only a note plus the candidate ID.

```js
export function appendCandidate(report, stage, candidate) {
  const next = structuredClone(report);
  const list = next.stages[stage].candidates;
  if (list.some((item) => item.id === candidate.id)) throw new Error("candidate id already exists");
  list.push({ ...candidate, technicalAcceptance: "accepted", creativeAcceptance: "pending" });
  return next;
}
```

- [ ] **Step 4: Add the initializer and preflight behavior**

The initializer accepts `--output logs/layered-two-character-sample`. It reads the exact mother frame and resolves the current approved workspace packages, rejecting stale paths from old backups: Shen Yan face/body source `logs/shen-yan-zimage-hero-v1/hero-2026080913.png`, structure refs `logs/shen-yan-hybrid-v5/front.png`, `side.png`, `back.png`; Jiang Lan face/body source `logs/jiang-lan-zimage-hero-v2/hero-2026080931.png`, structure refs `logs/jiang-lan-hybrid-v1/front.png`, `side.png`, `back.png`. It must fail before creating the run directory when any required face/body file is missing or empty. It records absolute paths, file sizes, hashes, species `human`, and the fixed lighting contract.

- [ ] **Step 5: Run focused GREEN checks**

Run: `node --check scripts/lib/layered-compositing-run.mjs`  
Expected: exit 0.  
Run: `node --check scripts/init-layered-compositing-sample.mjs`  
Expected: exit 0.  
Run: `node scripts/check-layered-compositing-run.mjs`  
Expected: `Layered compositing run contract: PASS`.

- [ ] **Step 6: Commit Task 1 only**

```powershell
git add -- scripts/lib/layered-compositing-run.mjs scripts/check-layered-compositing-run.mjs scripts/init-layered-compositing-sample.mjs
git commit -m "feat: add layered compositing run contract"
```

### Task 2: Fixed Layout and Pose Contract

**Files:**
- Create: `scripts/lib/layered-compositing-layout.mjs`
- Create: `scripts/check-layered-compositing-layout.mjs`
- Create: `src/modules/comfy-pipeline/presets/layered-pose-sdpose-v1.json`

**Interfaces:**
- Consumes: `RunReport.source` and immutable character keys from Task 1.
- Produces: `createRiverLayout(): LayoutContract`, `assertLayout(layout): void`, `splitPose(openposeJson, layout): {shen_yan, jiang_lan}`, and `assertNoBodyOverlap(maskA, maskB, options): void`.

- [ ] **Step 1: Write the failing layout tests**

Use fixed mother-frame coordinates derived from the current composition: Shen Yan occupies screen-left and Jiang Lan screen-right. Test exact canvas size, distinct foot anchors, positive person heights, inward gaze targets, `human` species, bounds rejection, swapped IDs rejection, and forbidden torso/leg overlap. Permit only an explicitly configured soft-edge overlap ratio no greater than `0.005` of the smaller foreground mask.

```js
const layout = createRiverLayout();
assert.deepEqual(layout.canvas, { width: 1152, height: 640 });
assert.equal(layout.people.shen_yan.screenSide, "left");
assert.equal(layout.people.jiang_lan.screenSide, "right");
assert.ok(layout.people.shen_yan.gazeTarget.x > layout.people.shen_yan.head.x);
assert.ok(layout.people.jiang_lan.gazeTarget.x < layout.people.jiang_lan.head.x);
```

- [ ] **Step 2: Run RED**

Run: `node scripts/check-layered-compositing-layout.mjs`  
Expected: exit 1 because the layout module does not exist.

- [ ] **Step 3: Implement the fixed layout contract and validators**

Store all points in source-pixel coordinates and include `heightTolerancePx: 12`, `footTolerancePx: 8`, and `maxSoftOverlapRatio: 0.005`. Use the mother frame only as the coordinate authority; do not infer new positions from generated candidates.

- [ ] **Step 4: Add the core SDPose extraction preset**

Build an API-format graph using installed `LoadImage`, `DWPreprocessor`, and the installed OpenPose JSON output node discovered through `/object_info`. Tokens are exactly `{{SOURCE_IMAGE}}` and `{{FILENAME_PREFIX}}`. The preset must not include a sampler or a generative model.

- [ ] **Step 5: Run GREEN and regression checks**

Run: `node scripts/check-layered-compositing-layout.mjs`  
Expected: `Layered compositing layout contract: PASS`.  
Run: `node scripts/check-dwpose-controlnet-aux.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit Task 2 only**

```powershell
git add -- scripts/lib/layered-compositing-layout.mjs scripts/check-layered-compositing-layout.mjs src/modules/comfy-pipeline/presets/layered-pose-sdpose-v1.json
git commit -m "feat: define layered river layout contract"
```

### Task 3: Comfy Adapter, Empty Plate, and Isolated Character Presets

**Files:**
- Create: `scripts/lib/layered-compositing-comfy.mjs`
- Create: `scripts/check-layered-compositing-comfy.mjs`
- Create: `scripts/run-layered-empty-plate.mjs`
- Create: `scripts/run-layered-character.mjs`
- Create: `src/modules/comfy-pipeline/presets/layered-empty-plate-qwen-v1.json`
- Create: `src/modules/comfy-pipeline/presets/layered-character-qwen-v1.json`

**Interfaces:**
- Consumes: Task 1 report API and Task 2 layout contract.
- Produces: `compileWorkflow(preset, tokens)`, `assertWorkflowObjectInfo(workflow, objectInfo)`, `createComfyAdapter({baseUrl, fetchImpl, now})`, `generateEmptyPlate(args)`, and `generateCharacter(args)`.

- [ ] **Step 1: Write failing injected-adapter tests**

Use fake `fetch` responses for `/object_info`, `/upload/image`, `/prompt`, `/history/{promptId}`, and `/view`. Assert the runner records the prompt ID immediately after queueing, accepts only the expected output node, rejects unresolved tokens/dangling links/model enum drift, and writes candidate files under append-only paths.

```js
const adapter = createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: fakeFetch, now: () => 1000 });
const queued = await adapter.queue(workflow, { onQueued: ({ promptId }) => journal.push(promptId) });
assert.equal(journal[0], queued.promptId);
```

- [ ] **Step 2: Run RED**

Run: `node scripts/check-layered-compositing-comfy.mjs`  
Expected: exit 1 because the Comfy module and presets do not exist.

- [ ] **Step 3: Implement the adapter and strict graph validation**

Port only the proven queue/history/view behavior from `scripts/run-wan-flf2v-endpoint.mjs`; do not import its mask geometry or experiment state. Validate every graph class and input against live/fake `/object_info`, validate all links resolve, and validate selected model/CLIP/VAE/LoRA values are present in enumerations before queueing.

- [ ] **Step 4: Build the empty-plate graph**

The graph takes the mother frame plus a fixed two-person removal mask. Its prompt must state that only the masked people are removed and the riverbank, stone perspective, trees, river outline, sunset direction, palette, camera, and 1152×640 canvas are preserved. Save one candidate per invocation and append its hash to stage `empty_plate`; never auto-accept it.

- [ ] **Step 5: Build the isolated-character graph and CLI guard**

The CLI syntax is exactly `--character shen_yan|jiang_lan --candidate 1|2|3 --report PATH`. Compile only that character's face master, body front, optional side/back structure refs, fixed description, and Task 2 single-person layout. Prompt requirements: one human only, full body including both feet, neutral removable background, inward gaze, mother-frame light direction, no other person, no beast traits. Seeds are fixed per character and candidate and cannot be overridden.

- [ ] **Step 6: Run GREEN and existing Qwen regressions**

Run: `node --check scripts/run-layered-empty-plate.mjs`  
Expected: exit 0.  
Run: `node --check scripts/run-layered-character.mjs`  
Expected: exit 0.  
Run: `node scripts/check-layered-compositing-comfy.mjs`  
Expected: `Layered compositing Comfy contract: PASS`.  
Run: `node scripts/check-wan-flf2v-endpoint.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit Task 3 only**

```powershell
git add -- scripts/lib/layered-compositing-comfy.mjs scripts/check-layered-compositing-comfy.mjs scripts/run-layered-empty-plate.mjs scripts/run-layered-character.mjs src/modules/comfy-pipeline/presets/layered-empty-plate-qwen-v1.json src/modules/comfy-pipeline/presets/layered-character-qwen-v1.json
git commit -m "feat: add isolated layered generation workflows"
```

### Task 4: Core BiRefNet Matte Extraction

**Files:**
- Create: `scripts/lib/layered-compositing-media.mjs`
- Create: `scripts/check-layered-compositing-matte.mjs`
- Create: `scripts/run-layered-matte.mjs`
- Create: `src/modules/comfy-pipeline/presets/layered-birefnet-matte-v1.json`

**Interfaces:**
- Consumes: an accepted character candidate from Task 1 and Task 3.
- Produces: `probeImage(path)`, `assertMaskArtifact(mask, expected)`, `assertAlphaArtifact(rgba, mask, expected)`, `extractMatte(args)` and report artifacts `rawMask`, `revisedMask`, `transparentPng`.

- [ ] **Step 1: Write a real-media failing test**

Create FFmpeg fixtures for a full-body colored silhouette on a neutral background. The test must reject zero-byte, undecodable, wrong-size, empty, full-white, head-cropped, foot-cropped, and alpha/mask-mismatch outputs. It must pass a 1152×640 RGBA image whose alpha bytes match the gray mask within one quantization level.

```js
const result = assertMaskArtifact(maskPath, { width: 1152, height: 640, minCoverage: 0.05, maxCoverage: 0.60 });
assert.equal(result.width, 1152);
assert.throws(() => assertMaskArtifact(emptyMask, expected), /coverage/i);
```

- [ ] **Step 2: Run RED**

Run: `node scripts/check-layered-compositing-matte.mjs`  
Expected: exit 1 because the media module is missing.

- [ ] **Step 3: Implement media probes and mask contracts**

Use FFprobe for dimensions/pixel format and FFmpeg raw `gray`/`rgba` output for coverage and alpha comparison. Head/foot completeness is validated against the Task 2 permitted character bounds with an 8-pixel inset. Never classify an undecodable image as merely an empty mask.

- [ ] **Step 4: Build and run the core BiRefNet graph**

The preset uses the installed core `RemoveBackground` model pipeline and returns both mask and RGBA-equivalent image outputs. The runner syntax is exactly `--character shen_yan|jiang_lan --candidate N --report PATH`; it refuses a character candidate not creatively accepted, queues one matte job, validates output, saves raw and revised mask separately even when identical, and appends hashes without overwriting.

- [ ] **Step 5: Run GREEN**

Run: `node --check scripts/run-layered-matte.mjs`  
Expected: exit 0.  
Run: `node scripts/check-layered-compositing-matte.mjs`  
Expected: `Layered compositing matte contract: PASS`.

- [ ] **Step 6: Commit Task 4 only**

```powershell
git add -- scripts/lib/layered-compositing-media.mjs scripts/check-layered-compositing-matte.mjs scripts/run-layered-matte.mjs src/modules/comfy-pipeline/presets/layered-birefnet-matte-v1.json
git commit -m "feat: add BiRefNet character matte stage"
```

### Task 5: Deterministic Composite, Environmental Spill, and Contact Shadows

**Files:**
- Create: `scripts/lib/layered-compositing-compose.mjs`
- Create: `scripts/check-layered-compositing-compose.mjs`
- Create: `scripts/run-layered-compose.mjs`

**Interfaces:**
- Consumes: accepted empty plate, accepted Shen Yan/Jiang Lan mattes, Task 2 layout, and Task 4 media probes.
- Produces: `buildCompositeFilter(inputs, layout, lighting): string`, `composeDeterministically(args)`, `buildEditableMask(args)`, and artifacts `unrepairedComposite`, `editableMask`, `protectedMask`, `contactShadowMask`.

- [ ] **Step 1: Write failing FFmpeg behavior tests**

Generate a background and two synthetic RGBA people. Assert fixed feet anchors, fixed layer order, inward separation, exact 1152×640 output, no protected/editable overlap, shadow displacement toward screen-left/front, and byte-identical output on two identical runs. Deliberately swap people, overlap torso masks, move a foot outside tolerance, and mutate the protected area; every case must fail.

- [ ] **Step 2: Run RED**

Run: `node scripts/check-layered-compositing-compose.mjs`  
Expected: exit 1 because the compositor module is missing.

- [ ] **Step 3: Implement a deterministic FFmpeg graph**

Use alpha-aware `scale`, `overlay`, `colorchannelmixer`, `gblur`, and masked blend filters. Derive contact shadows from the bottom portion of each matte, blur them, reduce opacity, and offset them left/front according to the frozen lighting contract. Sample environment color numerically once from the mother-frame manifest and store those numeric values in the report; do not resample per candidate.

```js
const filter = buildCompositeFilter(inputs, layout, lighting);
assert.match(filter, /overlay=.*:format=auto/);
assert.doesNotMatch(filter, /xfade|tblend/);
```

- [ ] **Step 4: Build editable and protected masks**

Protected mask includes face ellipse, eroded primary hair mass, eroded costume/body matte, and accessory boxes declared in each character package. Editable mask is the union of outer matte rings, foot contact regions, local occlusion, and shadow regions, then subtracts the protected mask. Assert their raw gray intersection is exactly zero.

- [ ] **Step 5: Run GREEN**

Run: `node --check scripts/run-layered-compose.mjs`  
Expected: exit 0.  
Run: `node scripts/check-layered-compositing-compose.mjs`  
Expected: `Layered deterministic composite: PASS`.

- [ ] **Step 6: Commit Task 5 only**

```powershell
git add -- scripts/lib/layered-compositing-compose.mjs scripts/check-layered-compositing-compose.mjs scripts/run-layered-compose.mjs
git commit -m "feat: add deterministic layered compositor"
```

### Task 6: Restricted Local Repair and Explicit Review CLI

**Files:**
- Create: `scripts/run-layered-local-repair.mjs`
- Create: `scripts/review-layered-compositing.mjs`
- Create: `scripts/check-layered-compositing-review.mjs`
- Create: `src/modules/comfy-pipeline/presets/layered-local-repair-qwen-v1.json`

**Interfaces:**
- Consumes: Task 1 state transitions, Task 3 Comfy adapter, Task 4 media comparisons, and Task 5 composite/masks.
- Produces: final repair candidate with `finalImage`, `differenceImage`, `protectedMae`, `protectedChangedRatio`; review commands for `empty_plate`, `shen_yan`, `jiang_lan`, `composite`, and `final`.

- [ ] **Step 1: Write failing repair/review tests**

Test CLI accept/reject, wrong-stage review, missing evidence, mismatched hash, acceptance before prerequisites, and fail-safe rejection after evidence deletion. Use synthetic images to prove a one-pixel protected-mask edit is detected and a change exclusively inside the editable mask is allowed. Technical completion must leave final creative status `pending` and `overallStatus: pending`.

- [ ] **Step 2: Run RED**

Run: `node scripts/check-layered-compositing-review.mjs`  
Expected: exit 1 because the review CLI and repair preset do not exist.

- [ ] **Step 3: Add protected-region metrics**

Extend `scripts/lib/layered-compositing-media.mjs` with `compareProtectedRegion(before, after, protectedMask)`. The fixed metrics are raw RGB mean absolute error and changed-pixel ratio where a pixel is changed if any channel differs by more than 2. Calibrate acceptance against an unmodified encode/decode baseline fixture; store the resulting immutable threshold in the run manifest before live repair and forbid changing it after any candidate exists.

- [ ] **Step 4: Build the restricted repair graph**

Inputs are the unrepaired composite and editable mask only. Prompt: harmonize hair/clothing outer edges, foot-stone contact, local occlusion, contact shadow, and weak river/sunset spill; preserve the exact faces, primary hairstyles, primary garments, accessories, camera, geometry, character count, and background. A graph output is rejected if any modified raw pixel lies outside the editable mask after accounting for the frozen encode/decode baseline threshold.

- [ ] **Step 5: Implement explicit review transitions**

CLI syntax:

```text
node scripts/review-layered-compositing.mjs --stage shen_yan --candidate candidate_001 --decision accepted --evidence PATH --note "identity matches"
node scripts/review-layered-compositing.mjs --stage final --candidate candidate_001 --decision rejected --note "visible edge halo"
```

Final acceptance requires accepted plate, both accepted characters, valid mattes, technically accepted deterministic composite, stored final/difference images, protected metrics within threshold, and evidence exactly matching the stored final image. Only that transition sets `overallStatus: accepted`.

- [ ] **Step 6: Run GREEN and full non-live contracts**

Run: `node scripts/check-layered-compositing-review.mjs`  
Expected: `Layered compositing review contract: PASS`.  
Run: `node scripts/check-layered-compositing-run.mjs`  
Expected: PASS.  
Run: `node scripts/check-layered-compositing-compose.mjs`  
Expected: PASS.  
Run: `node scripts/check-layered-compositing-matte.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit Task 6 only**

```powershell
git add -- scripts/lib/layered-compositing-media.mjs scripts/run-layered-local-repair.mjs scripts/review-layered-compositing.mjs scripts/check-layered-compositing-review.mjs src/modules/comfy-pipeline/presets/layered-local-repair-qwen-v1.json
git commit -m "feat: gate layered repair behind identity protection"
```

### Task 7: Readiness Audit and One Strictly Serial Live Sample

**Files:**
- Create: `scripts/check-layered-compositing-live-readiness.mjs`
- Create: `.superpowers/sdd/layered-two-character-live-report.md`
- Generate only after readiness passes: `logs/layered-two-character-sample/**`

**Interfaces:**
- Consumes every prior task.
- Produces one auditable run report and the artifacts specified by the design; does not change application code.

- [ ] **Step 1: Write and run the read-only readiness checker**

It verifies the exact mother frame exists and is 1152×640; hashes both approved character packages; queries `/object_info`; validates every preset class/input/model enumeration; confirms core BiRefNet and SDPose classes; confirms `ffmpeg` and `ffprobe`; checks free disk space is at least 10 GiB; and confirms the output directory either does not exist or contains a valid resumable report.

Run: `node scripts/check-layered-compositing-live-readiness.mjs`  
Expected: `Layered compositing live readiness: PASS`, otherwise stop without queueing.

- [ ] **Step 2: Initialize and review the frozen run manifest**

Run: `node scripts/init-layered-compositing-sample.mjs --output logs/layered-two-character-sample`  
Expected: report created with source and two character resource hashes, `overallStatus: pending`, zero candidates. Inspect the manifest before queueing.

- [ ] **Step 3: Generate and manually accept one empty plate**

Run candidates serially, at most three. After each, inspect a side-by-side mother-frame/plate comparison for river geometry, stone perspective, trees, sunset, and palette. Accept exactly one or stop after three rejected candidates.

- [ ] **Step 4: Generate and manually accept Shen Yan**

Run at most three fixed-seed candidates. Review face, hairstyle, dark-blue costume construction, accessories, full-body completeness, inward gaze, and human-only traits. Do not generate Jiang Lan until Shen Yan is explicitly accepted.

- [ ] **Step 5: Generate and manually accept Jiang Lan**

Run at most three fixed-seed candidates. Review face, long dark hair, light gray-blue dress construction, accessories, full-body completeness, inward gaze, and human-only traits. Stop the experiment if three candidates fail.

- [ ] **Step 6: Extract and review both BiRefNet mattes**

Run one matte job per accepted character, serially. Inspect hair, sleeves, skirt/coat edges, both feet, alpha holes, and background remnants. Preserve raw and revised masks even if no SAM3 correction is needed.

- [ ] **Step 7: Build the deterministic composite**

Run `scripts/run-layered-compose.mjs`. Inspect identity again before assessing grounding. Confirm fixed feet, scale, gaze, no overlap, no edge halo, contact shadows, and matching sunset/river spill. Rejecting this stage must not delete accepted plate/character/matte artifacts.

- [ ] **Step 8: Run at most one local-repair candidate if needed**

Skip Qwen repair when the deterministic composite already passes visual fusion. If repair is needed, run exactly one mask-restricted candidate, verify the difference/protected diagnostics, and reject it if identity changes. Do not install IC-Light or use a paid relight node in this task.

- [ ] **Step 9: Complete manual final review and report**

Review references, raw people, transparent PNGs, masks, unrepaired composite, final image, and protected difference image together. Record `accepted` or `rejected` with concrete observations in `.superpowers/sdd/layered-two-character-live-report.md`. Never describe a technical pass as creative acceptance.

- [ ] **Step 10: Run final verification**

Run all seven new check scripts, `node --check` on all new runners/libraries, the existing WAN endpoint regression, and `npm.cmd run build`. Expected: all contract checks PASS, all syntax checks exit 0, and Vite build succeeds. Record exact commands, outputs, candidate IDs, seeds, prompt IDs, hashes, durations, and any stopped condition in the live report.

- [ ] **Step 11: Commit code and the live report without generated media**

Stage the readiness checker and live report. Do not stage `logs/` media or reports unless the user explicitly requests artifact versioning.

```powershell
git add -- scripts/check-layered-compositing-live-readiness.mjs .superpowers/sdd/layered-two-character-live-report.md
git commit -m "test: validate layered two-character sample"
```

## Final Acceptance Checklist

- [ ] Exactly two human characters are present and correspond to the approved Shen Yan and Jiang Lan packages.
- [ ] Face, hairstyle, costume, and key accessories pass manual identity review before composite review.
- [ ] The empty plate preserves the mother frame's camera, geometry, sunset direction, palette, and stone perspective.
- [ ] Both people are full-body, separated, grounded, inward-looking, and within fixed layout tolerances.
- [ ] Raw/revised masks and alpha PNGs are decodable, complete, and traceable by hash.
- [ ] The deterministic composite is byte-repeatable and has plausible contact shadows and environmental spill.
- [ ] Editable and protected masks have zero illegal overlap.
- [ ] Any AI repair remains within the frozen protected-region threshold and does not alter identity.
- [ ] Every technical and creative transition is explicit, evidence-backed, and append-only.
- [ ] Final manual review alone decides `overallStatus: accepted`; otherwise the truthful result is `rejected` or `pending`.
