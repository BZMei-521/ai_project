# Wan FLF2V Full-Body Context Mask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seam-prone lower-body composite boundary with a deterministic full-Shen-Yan context mask, obtain user approval for its diagnostic image, and then generate at most one isolated Qwen endpoint candidate without starting video generation.

**Architecture:** Keep the approved DWPose transform, Qwen preset, prompt blocks, and review state machine unchanged. Add a focused mask module that owns fixed 1152×640 geometry, a Jiang Lan exclusion zone, feathered mask artifacts, and a visual diagnostic; select it from the existing endpoint runner through an explicit `maskProfile`. A new isolated experiment and one-candidate wrapper prevent the three rejected pose candidates or either protected report from being overwritten.

**Tech Stack:** Node.js ES modules, FFmpeg/FFprobe, ComfyUI HTTP API, Qwen Image Edit 2511, DWPose, JSON atomic reports, SHA-256 evidence.

## Global Constraints

- Source geometry is exactly `1152×640`; every mask artifact is RGB-encoded grayscale PNG.
- Do not install a segmentation model, add a ComfyUI node, change DWPose joint deltas, train a LoRA, modify StoryboardPro UI, or delete prior evidence.
- Fixed DWPose delta remains hip `(-4,0)`, knee `(-14,-1)`, ankle `(-30,-2)` on Shen Yan screen-left leg.
- The new root is `logs/video-quality-one-take-flf2v-fullbody`; it must not write into `logs/video-quality-one-take-flf2v-pose`.
- Preserve `logs/video-quality-one-take-flf2v/wan-flf2v-report.json` at SHA-256 `32881c951a6383ed6464db3c149b4e189f50e0cb228c9c6a6cb5a679eec20253`.
- Preserve `logs/video-quality-one-take/wan-one-take-report.json` at SHA-256 `31133a95b32ba6d1673b9c07bfa7e41c21010e811a39def5e4328b5e2a6b76a4`.
- The mask diagnostic requires explicit user approval before any Qwen queue call.
- Only candidate `1`, seed `271011`, is authorized in this iteration. A failure stops the iteration; it does not unlock candidate 2.
- No FLF2V video queue call is authorized by this plan.
- Work in the existing checkout, but do not stage, commit, switch branches, or alter Git history.

---

## File Structure

- Create `scripts/lib/wan-flf2v-fullbody-mask.mjs`: fixed shot geometry, PGM rasterization, feathering, Jiang exclusion, locked complement, diagnostic generation, and artifact hashes.
- Create `scripts/check-wan-flf2v-fullbody-mask.mjs`: independent geometry oracle and real FFmpeg/FFprobe contract.
- Modify `scripts/run-wan-flf2v-endpoint.mjs`: select the existing lower-body builder or the new full-body builder through a closed `maskProfile` enum and persist the profile in candidate evidence.
- Create `scripts/init-wan-flf2v-fullbody-experiment.mjs`: atomically initialize the isolated experiment from the authoritative start frame.
- Create `scripts/run-wan-flf2v-fullbody-mask-preflight.mjs`: produce only local mask diagnostics; it contains no Comfy queue, Qwen, or video call.
- Create `scripts/check-wan-flf2v-fullbody-mask-preflight.mjs`: prove preflight isolation, evidence hashes, and protected-report immutability.
- Create `scripts/run-wan-flf2v-fullbody-endpoint.mjs`: one-candidate CLI wrapper around the existing pose-guided endpoint runner.
- Create `scripts/check-wan-flf2v-fullbody-endpoint.mjs`: injected-adapter contract proving profile selection, one-candidate limit, call order, and zero video behavior.
- Modify `.superpowers/sdd/wan-flf2v-pose-guided-implementation-report.md`: append RED/GREEN evidence, diagnostic approval, live Prompt IDs, hashes, and the final decision.

---

### Task 1: Deterministic Full-Body Context Mask

**Files:**
- Create: `scripts/lib/wan-flf2v-fullbody-mask.mjs`
- Create: `scripts/check-wan-flf2v-fullbody-mask.mjs`

**Interfaces:**
- Produces: `FULLBODY_MASK_PROFILE = "full-body-context-v1"`.
- Produces: `createFullBodyContextMaskArtifacts({ outputDir, sourcePath }) -> { maskPath, lockedMaskPath, diagnosticPath, maskSha256, lockedMaskSha256, diagnosticSha256 }`.
- Consumes: a decodable `1152×640` source PNG and local `ffmpeg`/`ffprobe` executables.

- [ ] **Step 1: Write the independent failing geometry contract**

Define an oracle inside `scripts/check-wan-flf2v-fullbody-mask.mjs` that rasterizes these fixed shot-space regions without importing production constants:

```js
const expectedEditableEnvelope = [
  [330, 18], [505, 18], [570, 92], [590, 230],
  [590, 632], [300, 632], [300, 230], [315, 92]
];
const expectedJiangProtection = [
  [590, 45], [850, 45], [875, 630], [580, 630]
];
const expectedFeatherPixels = 28;
```

The contract must assert all of the following using decoded mask bytes, not source-text matching:

```js
assert.equal(maskAt(440, 40), 255, "hair is fully editable");
assert.equal(maskAt(350, 300), 255, "screen-left sleeve is fully editable");
assert.equal(maskAt(535, 315), 255, "screen-right hand is fully editable");
assert.equal(maskAt(410, 590), 255, "screen-left boot is fully editable");
assert.equal(maskAt(530, 590), 255, "screen-right boot is fully editable");
assert.equal(maskAt(710, 250), 0, "Jiang Lan is excluded");
assert.equal(maskAt(720, 575), 0, "Jiang Lan lower body is excluded");
assert.equal(maskAt(1000, 320), 0, "far background is locked");
assert.ok(maskAt(305, 200) > 0 && maskAt(305, 200) < 255, "outer boundary is feathered");
```

Also assert the old cut points `(420,250)`, `(515,250)`, `(405,420)`, and `(570,625)` are not the new polygon, and that the diagnostic is a decodable `1152×640` RGB PNG.

- [ ] **Step 2: Run the contract and record the expected RED**

Run:

```powershell
node scripts/check-wan-flf2v-fullbody-mask.mjs
```

Expected: exit `1` with `ERR_MODULE_NOT_FOUND` for `scripts/lib/wan-flf2v-fullbody-mask.mjs`.

- [ ] **Step 3: Implement the minimal mask module**

Implement the module with these closed constants and exports:

```js
export const FULLBODY_MASK_PROFILE = "full-body-context-v1";
export const FULLBODY_FEATHER_PIXELS = 28;
export const FULLBODY_EDITABLE_ENVELOPE = Object.freeze([
  [330, 18], [505, 18], [570, 92], [590, 230],
  [590, 632], [300, 632], [300, 230], [315, 92]
].map(Object.freeze));
export const JIANG_PROTECTION_POLYGON = Object.freeze([
  [590, 45], [850, 45], [875, 630], [580, 630]
].map(Object.freeze));
```

Raster rules are exact:

```js
editable = inside(FULLBODY_EDITABLE_ENVELOPE) && !inside(JIANG_PROTECTION_POLYGON);
baseMask[pixel] = editable ? 255 : 0;
```

Create `mask.png` by applying `boxblur=28:1,format=rgb24`. Re-apply the Jiang protection polygon after feathering so every protected pixel is exactly zero. Create `locked_region_mask.png` from the final mask with `255` only where the final mask value equals zero. Create `mask_diagnostic.png` from the source image with these colors at 45% opacity: editable core cyan, feather transition amber, Jiang protection red, locked area unchanged. Use unique temporary paths containing PID and `randomUUID()`, remove only owned temporaries in `finally`, and compute SHA-256 after successful FFprobe validation.

The module must reject a missing, empty, undecodable, or non-`1152×640` source before creating the output directory.

- [ ] **Step 4: Run the focused GREEN contract twice**

Run twice:

```powershell
node scripts/check-wan-flf2v-fullbody-mask.mjs
```

Expected each time: exit `0`, `Wan FLF2V full-body mask contract: PASS`.

- [ ] **Step 5: Record the no-Git checkpoint**

Record Task 1 RED and both GREEN outputs in the implementation report. Do not run `git add` or `git commit`.

---

### Task 2: Closed Mask-Profile Integration and Isolated Experiment

**Files:**
- Modify: `scripts/run-wan-flf2v-endpoint.mjs`
- Create: `scripts/init-wan-flf2v-fullbody-experiment.mjs`
- Create: `scripts/run-wan-flf2v-fullbody-endpoint.mjs`
- Create: `scripts/check-wan-flf2v-fullbody-endpoint.mjs`

**Interfaces:**
- Consumes: `createFullBodyContextMaskArtifacts({ outputDir, sourcePath })` from Task 1.
- Extends: `runEndpointCandidate(options, dependencies)` with `options.maskProfile` restricted to `lower-body-v1` or `full-body-context-v1`.
- Produces: `initializeFullBodyExperiment(options)` and `runFullBodyEndpointCandidate(options, dependencies)`.

- [ ] **Step 1: Write the failing integration contract**

The new checker must use injected Comfy functions and assert:

```js
assert.equal(result.candidate.candidate, 1);
assert.equal(result.candidate.seed, 271011);
assert.equal(result.candidate.maskProfile, "full-body-context-v1");
assert.equal(result.candidate.lockedRegionMaximumChannelDifference, 0);
assert.deepEqual(callOrder, [
  "object_info", "upload:start", "DWPose",
  "upload:identity", "upload:pose", "Qwen"
]);
assert.equal(videoQueueCalls, 0);
```

Negative cases must reject candidate `2`, an unknown profile, an existing output directory, a changed start-frame hash, a non-empty prior endpoint history, or any report path inside either protected experiment root. Each failure must occur before adapter calls and before creating a candidate directory.

- [ ] **Step 2: Run the checker and verify RED**

Run:

```powershell
node scripts/check-wan-flf2v-fullbody-endpoint.mjs
```

Expected: exit `1` because `run-wan-flf2v-fullbody-endpoint.mjs` does not exist.

- [ ] **Step 3: Add the explicit profile selector**

In `scripts/run-wan-flf2v-endpoint.mjs`, preserve the existing default exactly and add a closed selector:

```js
const LOWER_BODY_MASK_PROFILE = "lower-body-v1";

function createMaskArtifacts({ maskProfile, outputDir, sourcePath }) {
  if (maskProfile === LOWER_BODY_MASK_PROFILE) {
    return { maskProfile, ...createLowerBodyMaskArtifacts({ outputDir }) };
  }
  if (maskProfile === FULLBODY_MASK_PROFILE) {
    return { maskProfile, ...createFullBodyContextMaskArtifacts({ outputDir, sourcePath }) };
  }
  throw new Error(`unsupported endpoint mask profile: ${maskProfile}`);
}
```

Resolve the profile before creating `candidateDir`; call it with `report.startFrame.path`; persist `maskProfile` and, when present, `maskDiagnosticPath` plus `maskDiagnosticSha256` in the candidate record. Keep the existing Qwen workflow, DWPose workflow, prompt blocks, seed table, `hardComposeMasked`, and locked-region comparison unchanged.

- [ ] **Step 4: Implement atomic isolated initialization**

`scripts/init-wan-flf2v-fullbody-experiment.mjs` must follow the existing pose initializer but use:

```js
export const FULLBODY_EXPERIMENT_ROOT = resolve("logs/video-quality-one-take-flf2v-fullbody");
export const FULLBODY_REPORT_PATH = resolve(FULLBODY_EXPERIMENT_ROOT, "wan-flf2v-report.json");
```

It must refuse an existing report, hash the authoritative report and start frame, create the standard experiment schema atomically with a UUID temporary file, and verify both protected report hashes again after rename.

- [ ] **Step 5: Implement the one-candidate wrapper**

The wrapper exposes:

```js
export async function runFullBodyEndpointCandidate(options = {}, dependencies = {}) {
  if (Number(options.candidate ?? 1) !== 1) {
    throw new Error("full-body mask iteration authorizes only endpoint candidate 1");
  }
  return runEndpointCandidate({
    ...options,
    candidate: 1,
    reportPath: options.reportPath || FULLBODY_REPORT_PATH,
    experimentRoot: options.experimentRoot || FULLBODY_EXPERIMENT_ROOT,
    poseGuided: true,
    maskProfile: FULLBODY_MASK_PROFILE
  }, dependencies);
}
```

The CLI accepts only `--candidate 1`, optional `--report`, and optional `--comfy-url`. It must not import a video runner or expose an assembly flag.

- [ ] **Step 6: Run focused and regression GREEN checks**

Run:

```powershell
node --check scripts/run-wan-flf2v-endpoint.mjs
node --check scripts/run-wan-flf2v-fullbody-endpoint.mjs
node scripts/check-wan-flf2v-fullbody-endpoint.mjs
node scripts/check-wan-flf2v-pose-endpoint.mjs
node scripts/check-wan-flf2v-endpoint.mjs
node scripts/check-wan-flf2v-experiment.mjs
```

Expected: all exit `0`; the new checker prints `Wan FLF2V full-body endpoint contract: PASS`, and all three existing contracts retain their original PASS messages.

- [ ] **Step 7: Record the no-Git checkpoint**

Append Task 2 RED/GREEN evidence and the exact changed-file list to the implementation report. Do not stage or commit.

---

### Task 3: Local Mask Diagnostic Approval Gate

**Files:**
- Create: `scripts/run-wan-flf2v-fullbody-mask-preflight.mjs`
- Create: `scripts/check-wan-flf2v-fullbody-mask-preflight.mjs`

**Interfaces:**
- Consumes: the isolated report and `createFullBodyContextMaskArtifacts` from Task 1.
- Produces: `runFullBodyMaskPreflight(options) -> { status, maskProfile, maskPath, lockedMaskPath, diagnosticPath, hashes, protectedReports }`.

- [ ] **Step 1: Write the failing preflight contract**

The checker must inspect the runner source and execute it against fixtures. It must prove the runner contains no `/prompt`, `generateRawEdit`, Qwen preset, Wan preset, video runner, or Comfy queue write. It must assert successful output contains exact artifact hashes and both protected hashes, while a changed start-frame hash, non-empty preflight directory, invalid source geometry, or protected hash drift fails atomically.

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node scripts/check-wan-flf2v-fullbody-mask-preflight.mjs
```

Expected: exit `1` because the preflight runner is missing.

- [ ] **Step 3: Implement the no-Comfy preflight**

The runner reads the isolated report, verifies its start-frame hash and both protected report hashes, then writes only:

```text
logs/video-quality-one-take-flf2v-fullbody/mask-preflight/mask.png
logs/video-quality-one-take-flf2v-fullbody/mask-preflight/locked_region_mask.png
logs/video-quality-one-take-flf2v-fullbody/mask-preflight/mask_diagnostic.png
logs/video-quality-one-take-flf2v-fullbody/mask-preflight/preflight-result.json
```

`preflight-result.json` is written atomically and contains `schemaVersion: 1`, `status: "pending-user-approval"`, `maskProfile: "full-body-context-v1"`, absolute paths, SHA-256 values, source-frame hash, and both protected hashes.

- [ ] **Step 4: Run the focused GREEN twice**

Run twice with fresh temporary fixture roots:

```powershell
node scripts/check-wan-flf2v-fullbody-mask-preflight.mjs
```

Expected each time: exit `0`, `Wan FLF2V full-body mask preflight contract: PASS`.

- [ ] **Step 5: Initialize the real isolated experiment and generate only the diagnostic**

First verify the new root is absent. Then run:

```powershell
node scripts/init-wan-flf2v-fullbody-experiment.mjs
node scripts/run-wan-flf2v-fullbody-mask-preflight.mjs
```

Expected: the experiment report and four preflight files exist; ComfyUI queue remains running `0`, pending `0`; protected hashes remain exact.

- [ ] **Step 6: Stop for user review**

Display `mask_diagnostic.png` and explain cyan core, amber transition, red Jiang exclusion, and unchanged background. Do not run Task 4 until the user explicitly approves this exact diagnostic image.

---

### Task 4: One Live Endpoint Candidate and Hard Stop

**Files:**
- Modify: `.superpowers/sdd/wan-flf2v-pose-guided-implementation-report.md`
- Runtime outputs only: `logs/video-quality-one-take-flf2v-fullbody/endpoint/candidate_001/*`

**Interfaces:**
- Consumes: user approval of the Task 3 diagnostic and `runFullBodyEndpointCandidate` from Task 2.
- Produces: one candidate with technical and creative review evidence; produces no video.

- [ ] **Step 1: Re-check live preconditions immediately before queueing**

Verify ComfyUI running and pending queues are both empty, required Qwen/DWPose classes and selected models are still present in `/object_info`, candidate directory is absent, isolated report history is empty, diagnostic hash matches the user-approved file, and protected report hashes are exact.

- [ ] **Step 2: Generate exactly candidate 1**

Run:

```powershell
node scripts/run-wan-flf2v-fullbody-endpoint.mjs --candidate 1
```

Expected: exactly one DWPose prompt followed by exactly one Qwen prompt; candidate seed `271011`; `maskProfile` is `full-body-context-v1`; locked-region maximum channel difference is `0`; creative status is `pending`.

- [ ] **Step 3: Perform technical and visual review before changing state**

Inspect `raw_edit.png`, `composite.png`, `start_end.png`, `mask_diagnostic.png`, and `pose_diagnostic.png`. Reject if any required gate from the design fails, especially face/hair/clothes identity, readable restrained half-step, grounded feet, hand/coat/boot integrity, Jiang stability, or visible mask boundary.

- [ ] **Step 4: Persist the decision atomically**

For rejection:

```powershell
node scripts/review-wan-flf2v-experiment.mjs --endpoint-candidate 1 --decision rejected --evidence "C:\Users\Administrator\Desktop\ai_project\logs\video-quality-one-take-flf2v-fullbody\endpoint\candidate_001\start_end.png" --note "完整人物蒙版候选未通过既定身份、动作、结构或融合边界视觉门禁；详见首尾证据图" --report "C:\Users\Administrator\Desktop\ai_project\logs\video-quality-one-take-flf2v-fullbody\wan-flf2v-report.json"
```

For a visually passing endpoint, show the evidence to the user first. Only after explicit approval, run:

```powershell
node scripts/review-wan-flf2v-experiment.mjs --endpoint-candidate 1 --decision accepted --evidence "C:\Users\Administrator\Desktop\ai_project\logs\video-quality-one-take-flf2v-fullbody\endpoint\candidate_001\start_end.png" --note "用户已确认完整人物蒙版端点通过身份、动作、结构和融合边界视觉门禁" --report "C:\Users\Administrator\Desktop\ai_project\logs\video-quality-one-take-flf2v-fullbody\wan-flf2v-report.json"
```

Acceptance still does not authorize video generation.

- [ ] **Step 5: Enforce the stop boundary**

Confirm endpoint candidate count is exactly `1`, video candidate count is `0`, Comfy queues are empty, and no `video` output directory exists. If rejected, stop this iteration. If accepted, report that a separate video-generation approval is required; do not run a video command.

---

### Task 5: Final Verification and Report

**Files:**
- Modify: `.superpowers/sdd/wan-flf2v-pose-guided-implementation-report.md`

**Interfaces:**
- Consumes: all Task 1–4 artifacts and reports.
- Produces: fresh verification evidence and a truthful final status.

- [ ] **Step 1: Run syntax checks**

```powershell
node --check scripts/lib/wan-flf2v-fullbody-mask.mjs
node --check scripts/run-wan-flf2v-endpoint.mjs
node --check scripts/init-wan-flf2v-fullbody-experiment.mjs
node --check scripts/run-wan-flf2v-fullbody-mask-preflight.mjs
node --check scripts/run-wan-flf2v-fullbody-endpoint.mjs
```

Expected: every command exits `0` with no output.

- [ ] **Step 2: Run the full focused contract suite**

```powershell
node scripts/check-wan-flf2v-fullbody-mask.mjs
node scripts/check-wan-flf2v-fullbody-mask-preflight.mjs
node scripts/check-wan-flf2v-fullbody-endpoint.mjs
node scripts/check-wan-flf2v-pose-preflight.mjs
node scripts/check-wan-flf2v-pose-guide.mjs
node scripts/check-wan-flf2v-pose-endpoint.mjs
node scripts/check-wan-flf2v-endpoint.mjs
node scripts/check-wan-flf2v-experiment.mjs
```

Expected: all eight commands exit `0` and print their PASS messages.

- [ ] **Step 3: Verify runtime truth**

Read the isolated report and independently recalculate every referenced artifact hash. Confirm one or zero endpoint candidates according to the reached gate, zero video candidates, no approved video, and empty Comfy queues. Recalculate the two protected hashes and compare them with the Global Constraints.

- [ ] **Step 4: Update the implementation report**

Append the exact RED and GREEN commands, live Prompt IDs if Task 4 ran, artifact hashes, review decision, queue counts, protected hashes, and remaining risks. State explicitly whether the work stopped at diagnostic, rejected endpoint, or accepted endpoint pending separate video approval.

- [ ] **Step 5: Record the final no-Git checkpoint**

List modified and created files with `git diff --name-only` and `git status --short` for inspection only. Do not stage, commit, push, or alter history.
