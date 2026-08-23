# Wan FLF2V Pose-Guided Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a low-VRAM DWPose-guided Qwen Image Edit 2511 endpoint path that moves only Shen Yan's screen-left leg by one natural half-step while preserving Jiang Lan, identity, background, and every locked pixel.

**Architecture:** DWPose runs once per endpoint candidate as a preprocessor and returns OpenPose-format JSON. A deterministic local module validates exactly two people, identifies screen-left Shen Yan, shifts only the screen-left leg within fixed limits, and renders a target pose guide; Qwen receives the original frame, Shen Yan reference, and target pose guide, while the existing external 12px-feathered mask remains the final pixel authority. The old rejected experiment remains read-only and a new isolated report/root holds at most three pose-guided candidates.

**Tech Stack:** Node.js ESM, PowerShell 7/Windows PowerShell, ComfyUI HTTP API, `comfyui_controlnet_aux` DWPose, Qwen Image Edit 2511, FFmpeg/FFprobe, JSON, SHA-256.

## Global Constraints

- Preserve `logs/video-quality-one-take-flf2v` byte-for-byte; use only `logs/video-quality-one-take-flf2v-pose` for the new experiment.
- Preserve the authoritative report and its recorded SHA-256; never write beneath `logs/video-quality-one-take`.
- Keep `ENDPOINT_SEEDS = [271011, 272011, 273011]`; exactly one candidate per command and at most three candidates total.
- Work at 1152×640; scale motion parameters proportionally only when an explicit fixture tests another resolution.
- Move the selected ankle/foot 24–36px, knee 10–18px, hip no more than 6px, and keep ground-contact vertical error at or below 4px.
- Jiang Lan and all non-selected Shen Yan keypoints must be unchanged in target JSON.
- The external editable mask remains the existing polygon union with 12px feather; locked-region maximum channel difference must be 0.
- Install only DWPose auxiliary code and its two TorchScript detector files; do not install InstantX ControlNet or Qwen 2512.
- Use `DWPreprocessor` with `detect_hand=disable`, `detect_body=enable`, `detect_face=disable`, `resolution=640`, `bbox_detector=yolox_l.torchscript.pt`, `pose_estimator=dw-ll_ucoco_384_bs5.torchscript.pt`, and `scale_stick_for_xinsr_cn=disable`.
- Strictly serialize live ComfyUI jobs. A failed pose preflight must not queue Qwen, and a rejected endpoint must not queue FLF2V.
- Do not run a real Qwen endpoint generation until the DWPose preflight evidence is shown to and approved by the user.
- Persist and SHA-256 hash five immutable prompt blocks for every pose candidate: `identity`, `spatialLayout`, `lighting`, `style`, and `performance`; retry candidates may change only the fixed seed.
- Bind the river scene to the stone bridge, riverside path, and waterline; keep Shen Yan screen-left, Jiang Lan screen-right, and the camera on the same side of the 180-degree axis.
- The endpoint action block contains at most three sentences and exactly one primary action: Shen Yan takes one short grounded half-step; Jiang Lan has no primary action.
- Describe performance through observable weight, contact, breathing, gaze, and timing. Do not use abstract emotion words as substitutes for physical behavior.

## File Structure

- Create `src/modules/comfy-pipeline/presets/dwpose-half-step-extract-v1.json`: minimal LoadImage → DWPreprocessor → SaveImage API workflow.
- Create `src/modules/comfy-pipeline/presets/image-qwen-half-step-pose-endpoint-v2.json`: current Qwen 2511 graph with target pose as Picture 3.
- Create `src/modules/comfy-pipeline/presets/dwpose-install-manifest.json`: pinned source, node class, model URLs and hashes.
- Create `scripts/install-dwpose-controlnet-aux.ps1`: idempotent, hash-verifying install into ComfyUI Desktop.
- Create `scripts/check-dwpose-controlnet-aux.mjs`: dry-run installer and manifest contract.
- Create `scripts/lib/wan-flf2v-pose-guide.mjs`: OpenPose validation, half-step transform, rendering, motion assertions, artifact hashes.
- Create `scripts/check-wan-flf2v-pose-guide.mjs`: independent keypoint oracle and negative tests.
- Create `scripts/init-wan-flf2v-pose-experiment.mjs`: initialize the isolated report without modifying the old experiment.
- Create `scripts/run-wan-flf2v-pose-endpoint.mjs`: user-facing single-candidate CLI for the new root.
- Create `scripts/check-wan-flf2v-pose-endpoint.mjs`: injected Comfy adapter end-to-end contract.
- Create `src/modules/comfy-pipeline/presets/wan-flf2v-river-shot-contract-v1.json`: immutable asset-role, spatial, lighting, style and performance prompt blocks.
- Modify `scripts/run-wan-flf2v-endpoint.mjs:32-36, 135-182, 332-461`: add opt-in DWPose extraction and pose artifact flow while preserving the legacy CLI path.
- Modify `scripts/lib/wan-flf2v-experiment.mjs:122-162, 274-321`: validate pose-guided artifact metadata and recheck those files at acceptance.
- Modify `scripts/check-wan-flf2v-experiment.mjs`: cover pose artifact integrity without changing legacy candidate behavior.
- Modify `scripts/check-wan-flf2v-endpoint.mjs:94-146, 214-265`: keep the existing mask-guided endpoint regression green and prove pose mode is not entered implicitly.
- Create `.superpowers/sdd/wan-flf2v-pose-guided-implementation-report.md`: RED/GREEN evidence, install inventory, hashes, live preflight and user decisions.

---

### Task 1: Reproducible DWPose Installation Contract

**Files:**
- Create: `src/modules/comfy-pipeline/presets/dwpose-install-manifest.json`
- Create: `scripts/install-dwpose-controlnet-aux.ps1`
- Create: `scripts/check-dwpose-controlnet-aux.mjs`

**Interfaces:**
- Consumes: ComfyUI root and Python path supplied as PowerShell parameters.
- Produces: installed commit `59b027e088c1c8facf7258f6e392d16d204b4d27`, `DWPreprocessor`, two verified TorchScript assets, and `dwpose-install-report.json`.

- [ ] **Step 1: Write the failing install-contract check**

Create a check that loads the manifest and asserts these exact values:

```js
assert.equal(manifest.repository, "https://github.com/Fannovel16/comfyui_controlnet_aux.git");
assert.equal(manifest.commit, "59b027e088c1c8facf7258f6e392d16d204b4d27");
assert.equal(manifest.nodeClass, "DWPreprocessor");
assert.deepEqual(manifest.models.map(({ file, sha256 }) => [file, sha256]), [
  ["yolox_l.torchscript.pt", "80bc14b13c260c24b3014cd42c02994bf52296ab8fa2d80a60b6afe08c93ef42"],
  ["dw-ll_ucoco_384_bs5.torchscript.pt", "d86a0b2b59fddc0901a7076e9f59c9f8602602133ed72511c693fd11eea23d91"]
]);
```

Invoke the installer with `-DryRun`; assert it names only the pinned repo, commit, Comfy Python, `requirements.txt`, and two model downloads. Also assert an existing wrong-hash fixture is rejected before rename.

- [ ] **Step 2: Run the check and verify RED**

Run: `node scripts/check-dwpose-controlnet-aux.mjs`  
Expected: FAIL because the manifest or installer does not exist.

- [ ] **Step 3: Add the pinned manifest and minimal idempotent installer**

The manifest must contain:

```json
{
  "schemaVersion": 1,
  "repository": "https://github.com/Fannovel16/comfyui_controlnet_aux.git",
  "commit": "59b027e088c1c8facf7258f6e392d16d204b4d27",
  "nodeClass": "DWPreprocessor",
  "models": [
    {
      "file": "yolox_l.torchscript.pt",
      "url": "https://huggingface.co/hr16/yolox-onnx/resolve/main/yolox_l.torchscript.pt?download=true",
      "sha256": "80bc14b13c260c24b3014cd42c02994bf52296ab8fa2d80a60b6afe08c93ef42"
    },
    {
      "file": "dw-ll_ucoco_384_bs5.torchscript.pt",
      "url": "https://huggingface.co/hr16/DWPose-TorchScript-BatchSize5/resolve/main/dw-ll_ucoco_384_bs5.torchscript.pt?download=true",
      "sha256": "d86a0b2b59fddc0901a7076e9f59c9f8602602133ed72511c693fd11eea23d91"
    }
  ]
}
```

The installer must default to:

```powershell
param(
  [string]$ComfyRoot = 'C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI',
  [string]$ComfyPython = 'C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\.venv\Scripts\python.exe',
  [switch]$DryRun
)
$plugin = Join-Path $ComfyRoot 'custom_nodes\comfyui_controlnet_aux'
$ckpts = Join-Path $plugin 'ckpts'
```

For each download, write to a unique `.partial.<guid>` path, verify `Get-FileHash -Algorithm SHA256`, then `Move-Item` into place. Clone only when absent; otherwise verify the existing remote and checkout the pinned commit. Run `& $ComfyPython -s -m pip install -r (Join-Path $plugin 'requirements.txt')`. Emit a JSON report containing repository, commit, model path, byte count and SHA-256. Never delete or rewrite an unrelated custom node directory.

- [ ] **Step 4: Run focused GREEN checks**

Run: `node scripts/check-dwpose-controlnet-aux.mjs`  
Expected: `DWPose install contract: PASS`.

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-dwpose-controlnet-aux.ps1 -DryRun`  
Expected: exit 0 and JSON listing exactly two model files; no filesystem mutation.

- [ ] **Step 5: Commit the reproducible install contract**

```powershell
git add src/modules/comfy-pipeline/presets/dwpose-install-manifest.json scripts/install-dwpose-controlnet-aux.ps1 scripts/check-dwpose-controlnet-aux.mjs
git commit -m "build: add pinned dwpose installation contract"
```

---

### Task 2: Deterministic Half-Step Pose Transform

**Files:**
- Create: `scripts/lib/wan-flf2v-pose-guide.mjs`
- Create: `scripts/check-wan-flf2v-pose-guide.mjs`

**Interfaces:**
- Consumes: DWPose OpenPose JSON `{canvas_width, canvas_height, people[]}` with 18 body keypoints per person.
- Produces:
  - `parseDWPoseJson(value): PoseDocument`
  - `buildHalfStepTarget(source, options?): {source, target, motion}`
  - `assertHalfStepTarget(source, target, motion): true`
  - `renderPoseGuide(pose, outputPath): string`
  - `writePoseEvidence({source, target, outputDir}): PoseArtifacts`

- [ ] **Step 1: Write independent fixture and negative tests**

Build two 18-keypoint people with confidence `1`. Place Shen Yan's pelvis centroid at x=390 and Jiang Lan's at x=735. Make Shen Yan's two ankles x=340 and x=430 so the selected screen-left ankle is unambiguous.

Assert the default transform performs exactly:

```js
assert.deepEqual(result.motion, {
  shenPersonIndex: 0,
  selectedLeg: "screen-left",
  hipIndex: 9,
  kneeIndex: 10,
  ankleIndex: 11,
  delta: { hip: { x: -4, y: 0 }, knee: { x: -14, y: -1 }, ankle: { x: -30, y: -2 } }
});
```

Independently compare every scalar in source and target: only indices 9, 10 and 11 of person 0 may differ; person 1 must be deeply equal. Add rejection cases for one/three people, missing pelvis/ankle, ankle x-distance under 8px, confidence below `0.5`, dx outside 24–36px, knee dx outside 10–18px, hip dx over 6px, vertical ground change over 4px, and a target that modifies Jiang Lan.

- [ ] **Step 2: Run the check and verify RED**

Run: `node scripts/check-wan-flf2v-pose-guide.mjs`  
Expected: FAIL with module-not-found for `scripts/lib/wan-flf2v-pose-guide.mjs`.

- [ ] **Step 3: Implement the minimum transform**

Use COCO-18 body indices and select the leg by ankle x-coordinate, not anatomical naming:

```js
const LEGS = [
  { hip: 9, knee: 10, ankle: 11 },
  { hip: 12, knee: 13, ankle: 14 }
];
const DEFAULT_DELTA = Object.freeze({
  hip: { x: -4, y: 0 },
  knee: { x: -14, y: -1 },
  ankle: { x: -30, y: -2 }
});
```

Parse flat triplets into `{x,y,confidence}`; reject non-finite values. Identify Shen Yan as the person with the smaller valid pelvis x; require at least 40px separation between character pelvis centroids. Require the selected and stationary ankle x values to differ by at least 8px. Clone with `structuredClone`, apply only the three deltas, then run `assertHalfStepTarget` before returning.

Render all original body segments for both people on a black 1152×640 PPM buffer using deterministic integer Bresenham lines and filled circles, then convert to PNG with:

```js
spawnSync("ffmpeg", ["-y", "-v", "error", "-i", ppmPath, "-frames:v", "1", outputPath], { stdio: "pipe" });
```

The renderer must not call ComfyUI or an image-generation model.

- [ ] **Step 4: Run GREEN and deterministic byte checks**

Run twice: `node scripts/check-wan-flf2v-pose-guide.mjs`  
Expected both times: `Wan FLF2V pose guide contract: PASS`, with identical target JSON and PNG SHA-256 across runs.

- [ ] **Step 5: Commit the deterministic pose module**

```powershell
git add scripts/lib/wan-flf2v-pose-guide.mjs scripts/check-wan-flf2v-pose-guide.mjs
git commit -m "feat: add deterministic half-step pose guide"
```

---

### Task 3: DWPose and Qwen Pose Presets

**Files:**
- Create: `src/modules/comfy-pipeline/presets/dwpose-half-step-extract-v1.json`
- Create: `src/modules/comfy-pipeline/presets/image-qwen-half-step-pose-endpoint-v2.json`
- Create: `src/modules/comfy-pipeline/presets/wan-flf2v-river-shot-contract-v1.json`
- Modify: `scripts/run-wan-flf2v-endpoint.mjs:135-182`
- Test: `scripts/check-wan-flf2v-pose-endpoint.mjs`

**Interfaces:**
- Consumes: live or fixture `/object_info` and uploaded start/reference/pose images.
- Produces:
  - `compileDWPoseWorkflow(preset, tokens)`
  - `validateDWPoseObjectInfo(preset, objectInfo)`
  - `validatePoseEndpointPresetObjectInfo(preset, objectInfo)`

- [ ] **Step 1: Write preset contract tests first**

Assert the DWPose preset contains exactly `LoadImage`, `DWPreprocessor`, and `SaveImage`; assert the exact `DWPreprocessor` literals from Global Constraints and that output 0 feeds `SaveImage`. Build an object-info fixture with `DWPreprocessor` optional inputs and outputs `IMAGE, POSE_KEYPOINT`; remove each required input in turn and expect a failure naming that input.

Assert the Qwen v2 preset preserves the current UNET, LoRA, CLIP, VAE, 4 steps, CFG 1, Euler/Beta, and fixed seed token. Its third `LoadImage` token must be `{{POSE_GUIDE_PATH}}`; the prompt must contain all of:

```js
[
  "Picture 3 is the authoritative target body-pose guide",
  "Exactly two human characters",
  "one short grounded half-step",
  "Jiang Lan must remain unchanged",
  "Do not create a lunge, split, crossed legs, floating foot, or extra limb"
]
```

Add a river shot contract with exactly five named immutable blocks: `identity`, `spatialLayout`, `lighting`, `style`, and `performance`. Assert it gives each reference a single role, names the stone bridge/riverside path/waterline anchors, fixes Shen Yan screen-left and Jiang Lan screen-right, forbids crossing the 180-degree axis, preserves the approved cinematic 3D donghua style, and describes Shen Yan's step as low-center-of-gravity physical behavior. Canonicalize each block independently and store its SHA-256.

- [ ] **Step 2: Run the new checker and verify RED**

Run: `node scripts/check-wan-flf2v-pose-endpoint.mjs`  
Expected: FAIL because both pose presets and exported validators are missing.

- [ ] **Step 3: Add the exact DWPose preset**

```json
{
  "1": {"class_type":"LoadImage","inputs":{"image":"{{START_FRAME_PATH}}"}},
  "2": {"class_type":"DWPreprocessor","inputs":{"image":["1",0],"detect_hand":"disable","detect_body":"enable","detect_face":"disable","resolution":640,"bbox_detector":"yolox_l.torchscript.pt","pose_estimator":"dw-ll_ucoco_384_bs5.torchscript.pt","scale_stick_for_xinsr_cn":"disable"}},
  "3": {"class_type":"SaveImage","inputs":{"images":["2",0],"filename_prefix":"FLF2V/pose_extract_candidate_{{CANDIDATE_PADDED}}"}}
}
```

Copy the current Qwen preset to v2, replace the mask image token with `{{POSE_GUIDE_PATH}}`, and replace the prompt with the exact constraints asserted by the test. The lower-body mask remains external and must not appear as a Qwen input in v2.

Compile the final prompt in this fixed order: asset roles, spatial layout, start-frame staging, single action, camera, contact physics, lighting, performance, style, positive constraints. The single action section must contain no more than three sentences. Candidate 1/2/3 must compile to identical prompt bytes; only the sampler seed may differ.

- [ ] **Step 4: Implement object-info validation and compile helpers**

Validate the live combo values include both TorchScript filenames and validate each literal against its declared type/range. Reject unresolved `{{...}}` tokens before queueing. Keep legacy `validatePresetObjectInfo` unchanged so the existing endpoint contract remains meaningful.

- [ ] **Step 5: Run focused and legacy checks**

Run:

```powershell
node scripts/check-wan-flf2v-pose-endpoint.mjs
node scripts/check-wan-flf2v-endpoint.mjs
```

Expected: both print `PASS`.

- [ ] **Step 6: Commit the two workflows**

```powershell
git add src/modules/comfy-pipeline/presets/dwpose-half-step-extract-v1.json src/modules/comfy-pipeline/presets/image-qwen-half-step-pose-endpoint-v2.json scripts/run-wan-flf2v-endpoint.mjs scripts/check-wan-flf2v-pose-endpoint.mjs
git commit -m "feat: add dwpose-guided qwen endpoint presets"
```

---

### Task 4: Pose-Guided Runner and Isolated Report

**Files:**
- Create: `scripts/init-wan-flf2v-pose-experiment.mjs`
- Create: `scripts/run-wan-flf2v-pose-endpoint.mjs`
- Modify: `scripts/run-wan-flf2v-endpoint.mjs:332-461`
- Modify: `scripts/lib/wan-flf2v-experiment.mjs:122-162, 274-321`
- Modify: `scripts/check-wan-flf2v-experiment.mjs`
- Modify: `scripts/check-wan-flf2v-pose-endpoint.mjs`

**Interfaces:**
- Consumes: `runEndpointCandidate({... poseGuided: true}, dependencies)` and a Comfy adapter with `extractDWPose({workflow, poseImagePath})` plus existing upload/generate methods.
- Produces: a technical-accepted/pending-creative endpoint record containing immutable pose artifacts and hashes under `logs/video-quality-one-take-flf2v-pose/endpoint/candidate_NNN`.

- [ ] **Step 1: Extend the injected end-to-end test and verify RED**

Use a temporary old report with three rejected endpoints and a separate empty new report. Assert running pose candidate 1:

- leaves every byte beneath the old root and old report unchanged;
- calls `extractDWPose` before any Qwen upload/generation;
- performs no Qwen call when DWPose returns one person, three people, ambiguous ankles, or low-confidence required joints;
- uploads roles in order `start`, `shen_yan_primary`, `pose_guide`;
- writes `source_pose.json`, `target_pose.json`, `target_pose.png`, `pose_diagnostic.png`, `raw_edit.png`, `mask.png`, `locked_region_mask.png`, `composite.png`, and `start_end.png`;
- stores and rechecks SHA-256 for all nine artifacts;
- stores `poseGuided: true`, DWPose Prompt ID, Qwen Prompt ID and the exact motion object;
- stores the five immutable prompt-block hashes and the full compiled-prompt SHA-256, identical across all three candidate seeds;
- leaves creative status `pending` and does not invoke FLF2V.

- [ ] **Step 2: Run RED**

Run: `node scripts/check-wan-flf2v-pose-endpoint.mjs`  
Expected: FAIL because `poseGuided` execution and isolated initialization are absent.

- [ ] **Step 3: Add isolated report initialization**

The initializer must read the authoritative one-take report and approved start frame, hash both, and call `createExperimentReport` with:

```js
{
  experimentRoot: resolve("logs/video-quality-one-take-flf2v-pose"),
  authoritativeReportPath: resolve("logs/video-quality-one-take/wan-one-take-report.json"),
  authoritativeReportSha256,
  startFramePath,
  startFrameSha256
}
```

Refuse to overwrite an existing new report. Write via unique temporary file plus rename. Before and after initialization, hash the old `logs/video-quality-one-take-flf2v/wan-flf2v-report.json` and fail if it changed.

- [ ] **Step 4: Implement opt-in pose flow in the existing runner**

When `options.poseGuided !== true`, execute the current path unchanged. In pose mode:

1. Load and validate both new presets against one `/object_info` snapshot.
2. Upload the start frame and queue DWPose.
3. Require `openpose_json` and a decodable pose preview from DWPose history.
4. Call `buildHalfStepTarget` and `writePoseEvidence`.
5. Upload start, identity and `target_pose.png` to Qwen.
6. Generate raw edit with v2, then use the existing `createLowerBodyMaskArtifacts`, `hardComposeMasked`, and `assertLockedRegionUnchanged` unchanged.
7. Write the full candidate record and commit it through the existing report lock.

Before queueing, recompute the five block hashes and compiled-prompt hash. Reject any retry whose non-seed workflow bytes, target-pose hash, mask hash, asset hashes or prompt-block hashes differ from the first pose-guided candidate in the isolated report.

The default adapter's DWPose history parser must accept only the Prompt ID it queued and read `outputs["2"].openpose_json`; it must download the saved image from `outputs["3"].images[0]`. Missing/mismatched history is a hard failure.

- [ ] **Step 5: Require pose integrity in the report library**

For `candidate.poseGuided === true`, require:

```js
const requiredPoseFields = [
  "sourcePosePath", "sourcePoseSha256",
  "targetPosePath", "targetPoseSha256",
  "poseGuidePath", "poseGuideSha256",
  "poseDiagnosticPath", "poseDiagnosticSha256",
  "dwposePromptId", "qwenPromptId", "motion"
];
```

At endpoint acceptance, verify the JSON files exist and hash-match, verify both PNGs exist/hash/decode, rerun `assertHalfStepTarget` on stored JSON, and require the stored `motion` to equal the recomputed motion. Rejection must remain fail-safe even if artifacts were later deleted. Legacy candidates without `poseGuided: true` retain their current contract.

- [ ] **Step 6: Add the single-candidate wrapper CLI**

Support only:

```text
node scripts/run-wan-flf2v-pose-endpoint.mjs --candidate 1|2|3
```

Hard-code the new report and experiment root. Reject `--all`, duplicate flags, candidate 0/4, custom roots, and unknown flags before contacting ComfyUI.

- [ ] **Step 7: Run GREEN and regression suite**

Run:

```powershell
node --check scripts/run-wan-flf2v-endpoint.mjs
node --check scripts/run-wan-flf2v-pose-endpoint.mjs
node scripts/check-wan-flf2v-pose-guide.mjs
node scripts/check-wan-flf2v-pose-endpoint.mjs
node scripts/check-wan-flf2v-endpoint.mjs
node scripts/check-wan-flf2v-experiment.mjs
node scripts/check-wan-flf2v-segment1.mjs
```

Expected: syntax exit 0 and every contract prints `PASS`.

- [ ] **Step 8: Commit the isolated runner**

```powershell
git add scripts/init-wan-flf2v-pose-experiment.mjs scripts/run-wan-flf2v-pose-endpoint.mjs scripts/run-wan-flf2v-endpoint.mjs scripts/lib/wan-flf2v-experiment.mjs scripts/check-wan-flf2v-experiment.mjs scripts/check-wan-flf2v-pose-endpoint.mjs
git commit -m "feat: run isolated pose-guided endpoint candidates"
```

---

### Task 5: Non-Live Full Verification and Implementation Report

**Files:**
- Create: `.superpowers/sdd/wan-flf2v-pose-guided-implementation-report.md`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: evidence that no installation or live generation is needed for the contract suite and that old experiment bytes remain unchanged.

- [ ] **Step 1: Record pre-verification hashes**

Record SHA-256 for the old FLF2V report and authoritative one-take report. Record `git status --short` without modifying unrelated files.

- [ ] **Step 2: Run the complete non-live suite**

Run:

```powershell
node scripts/check-dwpose-controlnet-aux.mjs
node scripts/check-wan-flf2v-pose-guide.mjs
node scripts/check-wan-flf2v-pose-endpoint.mjs
node scripts/check-wan-flf2v-endpoint.mjs
node scripts/check-wan-flf2v-experiment.mjs
node scripts/check-wan-flf2v-segment1.mjs
node scripts/check-wan-one-take-runner.mjs
node scripts/check-wan-one-take-assembly.mjs
npm.cmd run build
```

Expected: all checks print `PASS`; Vite build exits 0 with at most the existing chunk-size advisory.

- [ ] **Step 3: Recheck protected hashes and write the report**

The old FLF2V and authoritative report hashes must equal Step 1. Document each RED, each GREEN command/output, files changed, model source links, fixed hashes, remaining live risks, and the explicit statement `No live ComfyUI prompt was queued in Tasks 1–5`.

- [ ] **Step 4: Commit verification evidence**

```powershell
git add .superpowers/sdd/wan-flf2v-pose-guided-implementation-report.md
git commit -m "docs: record pose-guided endpoint verification"
```

---

### Task 6: Authorized Installation and DWPose-Only Live Preflight

**Files:**
- Modify: `.superpowers/sdd/wan-flf2v-pose-guided-implementation-report.md`
- Create at runtime: `logs/video-quality-one-take-flf2v-pose/preflight/*`

**Interfaces:**
- Consumes: user authorization for external installation, running local ComfyUI at `http://127.0.0.1:8188`, and the approved start frame.
- Produces: registered `DWPreprocessor`, verified local model hashes, source/target pose JSON, target guide and diagnostic evidence; no Qwen image.

- [ ] **Step 1: Install with the already granted external-write/network authorization**

Run the installer with the exact ComfyUI Desktop root from Task 1. If sandbox policy requests approval, request it for the pinned clone, Python requirements, and two model downloads only. Do not install any ControlNet weight.

- [ ] **Step 2: Verify files and live node inventory**

Verify plugin `git rev-parse HEAD`, both model byte counts/SHA-256, and Python imports. Request a ComfyUI Desktop restart only if `/object_info` does not yet contain `DWPreprocessor`; do not restart without approval. After restart, assert the live node advertises every exact input and combo from Global Constraints.

- [ ] **Step 3: Queue one DWPose-only workflow**

Initialize the new report if absent, then queue only `dwpose-half-step-extract-v1.json` against the approved start frame. Save the original OpenPose JSON, transformed JSON, pose guide and diagnostic side-by-side evidence under `logs/video-quality-one-take-flf2v-pose/preflight`.

- [ ] **Step 4: Apply the live preflight gate**

Require exactly two detected people, unambiguous screen-left Shen Yan, unambiguous screen-left ankle, required keypoint confidence at least `0.5`, and all motion bounds. Rehash the old experiment and authoritative report. On any failure, stop before Qwen.

- [ ] **Step 5: Show the diagnostic image and request live endpoint approval**

Present the absolute diagnostic image and summarize measured hip/knee/ankle deltas. The next task may begin only after the user explicitly approves this pose evidence.

---

### Task 7: Serial Pose-Guided Endpoint Candidates and FLF2V Gate

**Files:**
- Modify at runtime: `logs/video-quality-one-take-flf2v-pose/wan-flf2v-report.json`
- Modify: `.superpowers/sdd/wan-flf2v-pose-guided-implementation-report.md`

**Interfaces:**
- Consumes: explicit user approval from Task 6.
- Produces: zero or one creatively accepted endpoint; only an accepted endpoint can unlock the existing FLF2V segment-1 runner.

- [ ] **Step 1: Generate candidate 1 only**

Run: `node scripts/run-wan-flf2v-pose-endpoint.mjs --candidate 1`  
Expected: one technical candidate with seed `271011`, locked-region maximum difference `0`, and creative status `pending`.

- [ ] **Step 2: Perform technical and visual review**

Inspect raw edit, composite, start/end evidence, pose guide and diagnostic. Reject if the half-step is unreadable, becomes a lunge/split/crossed leg, produces floating feet, changes leg length, damages identity/clothes, changes Jiang Lan, or changes background. Use the existing review CLI/report transition only after pose artifacts and hashes revalidate.

- [ ] **Step 3: Continue serially only after rejection**

If candidate 1 is rejected, run candidate 2 with seed `272011`; if candidate 2 is rejected, run candidate 3 with seed `273011`. Never queue two candidates concurrently. Stop immediately on the first accepted endpoint or after all three are rejected.

- [ ] **Step 4: Enforce the FLF2V boundary**

If all three are rejected, report truthful failure and do not run segment 1. If one endpoint is accepted, show its evidence and ask the user before starting the expensive FLF2V video candidate. The video prompt remains `极慢向前推镜`; the existing video technical/creative acceptance contracts remain unchanged.

- [ ] **Step 5: Final verification**

Rerun the complete Task 5 suite, verify protected hashes, and append all live Prompt IDs, elapsed times, artifact hashes, decisions and stop/continue reason to the implementation report.

## Source Notes

- The upstream auxiliary repository documents `DWPreprocessor`, TorchScript operation without extra ONNXRuntime requirements, and both selected assets: https://github.com/Fannovel16/comfyui_controlnet_aux
- Current upstream `DWPreprocessor` schema and output JSON behavior: https://raw.githubusercontent.com/Fannovel16/comfyui_controlnet_aux/main/node_wrappers/dwpose.py
- YOLOX TorchScript SHA-256 and size metadata: https://huggingface.co/hr16/yolox-onnx/blob/main/yolox_l.torchscript.pt
- DWPose TorchScript SHA-256 and size metadata: https://huggingface.co/hr16/DWPose-TorchScript-BatchSize5/blob/main/dw-ll_ucoco_384_bs5.torchscript.pt
