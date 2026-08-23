# Wan FLF2V Controlled Half-Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an isolated, evidence-backed FLF2V experiment in which Shen Yan completes one readable grounded half-step toward the bridge while Jiang Lan, both identities, the scene, and the extremely slow camera push remain stable.

**Architecture:** A pure experiment-state module owns endpoint/video acceptance and guarantees isolation from the authoritative one-take report. A resumable verified model installer supplies the dedicated Wan 2.1 FLF2V FP8 weight. A masked Qwen endpoint runner hard-composites only Shen Yan's lower body, and a separate FLF2V runner binds the accepted start/end pair at 1280×720 before producing a chain-compatible 832×480 candidate.

**Tech Stack:** Node.js ES modules, PowerShell 7/Windows PowerShell, ComfyUI HTTP API, Qwen Image Edit, Wan 2.1 FLF2V 14B FP8, FFmpeg/FFprobe, SHA-256.

## Global Constraints

- Do not modify or replace `logs/video-quality-one-take/wan-one-take-report.json` or any existing ATI/I2V preset.
- The approved source is `C:/Users/Administrator/AppData/Local/Comfy-Desktop/ComfyUI-Shared/output/Storyboard/河边远景建立_klein_ref_00006_.png`, measured as 1152×640.
- The dedicated model is `wan2.1_flf2v_720p_14B_fp8_e4m3fn.safetensors`, official SHA-256 `d68ca694a695274e48e00974128337e06e497d95a1dc09e86fd2a01a405f455f`.
- Download from `https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_flf2v_720p_14B_fp8_e4m3fn.safetensors?download=true` with resume and atomic promotion.
- FLF2V generation is 1280×720, 17 frames, 16 FPS, 20 steps, CFG 5, `uni_pc`, `normal`, batch size 1.
- Normalize 1152×640 inputs by scaling to 1296×720 and center-cropping 8 pixels from each horizontal edge.
- Produce chain output with `scale=-2:480,crop=832:480`, which scales to 854×480 and center-crops 11 pixels from each horizontal edge.
- Endpoint editing may change only Shen Yan's pelvis, legs, boots, local contact shadow, and the minimum surrounding path required for a grounded step.
- Hard-composite edited pixels over the original; pixels outside the editable mask plus 8–16-pixel feather band must remain original.
- Use at most three endpoint candidates and three fixed video seeds. Technical retries reuse the same creative seed.
- Generate only experimental segment 1. Do not generate segments 2–6, assemble a delivery, activate ATI fallback, or import the result into the authoritative report.
- Preserve unrelated changes in the shared dirty `main` worktree. Do not run broad staging, cleanup, reset, checkout, or commit operations; task commits are intentionally omitted because new files depend on existing uncommitted one-take work.

---

## File Structure

- `scripts/lib/wan-flf2v-experiment.mjs` — pure paths, report schema, resolution geometry, acceptance transitions, fixed seeds, and isolation assertions.
- `scripts/check-wan-flf2v-experiment.mjs` — pure contract and state-transition tests.
- `scripts/review-wan-flf2v-experiment.mjs` — atomic endpoint/video creative review CLI.
- `src/modules/comfy-pipeline/presets/wan-flf2v-model-manifest.json` — canonical filename, URL, SHA-256, and disk-space floor.
- `scripts/download-wan-flf2v-model.ps1` — resumable, hash-verified, atomic model acquisition.
- `scripts/check-wan-flf2v-model-download.mjs` — dry-run and local tiny-file acquisition tests.
- `src/modules/comfy-pipeline/presets/image-qwen-half-step-endpoint-v1.json` — isolated masked Qwen edit preset.
- `scripts/run-wan-flf2v-endpoint.mjs` — mask, Qwen candidate, hard composite, locked-region check, evidence, and report writes.
- `scripts/check-wan-flf2v-endpoint.mjs` — endpoint preset/runner contract tests.
- `src/modules/comfy-pipeline/presets/video-wan21-flf2v-14b-fp8.json` — dedicated start/end-bound FLF2V API preset.
- `scripts/run-wan-flf2v-segment1.mjs` — approved-pair normalization, Comfy queue, media gates, downsample, and nine-frame evidence.
- `scripts/check-wan-flf2v-segment1.mjs` — FLF preset/runner and rejection-isolation tests.
- `logs/video-quality-one-take-flf2v/` — experimental report, candidates, normalized frames, contact sheets, and media only.
- `.superpowers/sdd/wan-flf2v-half-step-live-report.md` — commands, hashes, Prompt IDs, metadata, visual decisions, and final experiment verdict.

### Task 1: Isolated experiment state and atomic review

**Files:**
- Create: `scripts/lib/wan-flf2v-experiment.mjs`
- Create: `scripts/check-wan-flf2v-experiment.mjs`
- Create: `scripts/review-wan-flf2v-experiment.mjs`
- Create: `.superpowers/sdd/wan-flf2v-task-1-report.md`

**Interfaces:**
- Produces `EXPERIMENT_ROOT`, `AUTHORITATIVE_REPORT_PATH`, `ENDPOINT_SEEDS`, and `VIDEO_SEEDS`.
- Produces `createExperimentReport(input)`, `markEndpointTechnical(report, candidate)`, `applyEndpointReview(report, review)`, `assertApprovedEndpoint(report, io)`, `markVideoTechnical(report, candidate)`, `applyVideoReview(report, review)`, and `assertAuthoritativeUnchanged(report, hashFile)`.
- The review CLI accepts exactly one mode: `--endpoint-candidate N` or `--video-candidate N`, plus `--decision accepted|rejected`, `--note`, `--evidence`, and optional `--report`.

- [ ] **Step 1: Write the failing pure contract**

Create tests with a temporary experiment root and these assertions:

```js
const initial = createExperimentReport({
  experimentRoot,
  authoritativeReportPath,
  authoritativeReportSha256: "authority-hash",
  startFramePath,
  startFrameSha256: "start-hash",
  startWidth: 1152,
  startHeight: 640
});
assert.deepEqual(ENDPOINT_SEEDS, [271011, 272011, 273011]);
assert.deepEqual(VIDEO_SEEDS, [281011, 282011, 283011]);
assert.deepEqual(initial.geometry, {
  source: { width: 1152, height: 640 },
  flf: { scaledWidth: 1296, scaledHeight: 720, cropLeft: 8, cropRight: 8, width: 1280, height: 720 },
  chain: { scaledWidth: 854, scaledHeight: 480, cropLeft: 11, cropRight: 11, width: 832, height: 480 }
});
assert.equal(initial.authoritativeReportPath, authoritativeReportPath);
assert.equal(initial.overallStatus, "endpoint-required");
```

Also test technical endpoint → pending, rejected endpoint cannot be approved, accepted endpoint requires an existing composite/evidence and matching hash, technical video → pending, accepted video requires the approved endpoint version, and every transition preserves the authoritative path/hash snapshot.

- [ ] **Step 2: Run the contract and verify RED**

Run: `node scripts/check-wan-flf2v-experiment.mjs`  
Expected: `ERR_MODULE_NOT_FOUND` for `scripts/lib/wan-flf2v-experiment.mjs`.

- [ ] **Step 3: Implement the pure module**

Use this report shape and fail-closed review rule:

```js
export const ENDPOINT_SEEDS = Object.freeze([271011, 272011, 273011]);
export const VIDEO_SEEDS = Object.freeze([281011, 282011, 283011]);
export const AUTHORITATIVE_REPORT_PATH = resolve("logs/video-quality-one-take/wan-one-take-report.json");

export function createExperimentReport(input) {
  if (resolve(input.experimentRoot).startsWith(dirname(AUTHORITATIVE_REPORT_PATH))) {
    throw new Error("FLF2V experiment root must not overlap the authoritative one-take directory");
  }
  return {
    schemaVersion: 1,
    experimentType: "wan21-flf2v-controlled-half-step",
    createdAt: new Date().toISOString(),
    authoritativeReportPath: resolve(input.authoritativeReportPath),
    authoritativeReportSha256: input.authoritativeReportSha256,
    startFrame: { path: resolve(input.startFramePath), sha256: input.startFrameSha256, width: 1152, height: 640 },
    geometry: {
      source: { width: 1152, height: 640 },
      flf: { scaledWidth: 1296, scaledHeight: 720, cropLeft: 8, cropRight: 8, width: 1280, height: 720 },
      chain: { scaledWidth: 854, scaledHeight: 480, cropLeft: 11, cropRight: 11, width: 832, height: 480 }
    },
    endpointCandidates: [],
    videoCandidates: [],
    approvedEndpoint: null,
    approvedVideo: null,
    overallStatus: "endpoint-required"
  };
}
```

Accepted reviews require `note`, existing decodable image/video evidence, candidate technical acceptance, matching stored hashes, and no earlier accepted candidate of the same type. Rejected reviews never promote downstream state.

- [ ] **Step 4: Implement the atomic review CLI**

Parse exactly one candidate mode, load the report, apply only the pure transition, write `<report>.tmp`, then `renameSync` it over the report. Before every write call `assertAuthoritativeUnchanged` using SHA-256 of the current authoritative report.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
node --check scripts/lib/wan-flf2v-experiment.mjs
node --check scripts/review-wan-flf2v-experiment.mjs
node scripts/check-wan-flf2v-experiment.mjs
node scripts/check-wan-one-take-acceptance.mjs
```

Expected: syntax exits 0; both checks print `PASS`.

### Task 2: Resumable verified FLF2V model acquisition

**Files:**
- Create: `src/modules/comfy-pipeline/presets/wan-flf2v-model-manifest.json`
- Create: `scripts/download-wan-flf2v-model.ps1`
- Create: `scripts/check-wan-flf2v-model-download.mjs`
- Create: `.superpowers/sdd/wan-flf2v-task-2-report.md`

**Interfaces:**
- Manifest fields: `schemaVersion`, `fileName`, `downloadUrl`, `sha256`, `minimumFreeBytes`, `targetSubdirectory`.
- Downloader parameters: `-ManifestPath`, `-TargetDir`, and `-DryRun`.
- Produces the final verified model only after `.part` SHA-256 matches.

- [ ] **Step 1: Write the failing manifest/downloader test**

The test must assert the production manifest exactly:

```js
assert.equal(manifest.fileName, "wan2.1_flf2v_720p_14B_fp8_e4m3fn.safetensors");
assert.equal(manifest.sha256, "d68ca694a695274e48e00974128337e06e497d95a1dc09e86fd2a01a405f455f");
assert.equal(manifest.minimumFreeBytes, 26843545600);
assert.equal(manifest.targetSubdirectory, "diffusion_models");
```

Create a tiny local source file, a temporary manifest with its SHA-256 and `file:///` URL, then run the downloader. Assert successful final promotion, no `.part`, idempotent second run, and that a wrong hash leaves only the partial file and never creates the final path.

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/check-wan-flf2v-model-download.mjs`  
Expected: FAIL because the manifest and downloader do not exist.

- [ ] **Step 3: Add the production manifest**

```json
{
  "schemaVersion": 1,
  "fileName": "wan2.1_flf2v_720p_14B_fp8_e4m3fn.safetensors",
  "downloadUrl": "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/diffusion_models/wan2.1_flf2v_720p_14B_fp8_e4m3fn.safetensors?download=true",
  "sha256": "d68ca694a695274e48e00974128337e06e497d95a1dc09e86fd2a01a405f455f",
  "minimumFreeBytes": 26843545600,
  "targetSubdirectory": "diffusion_models"
}
```

- [ ] **Step 4: Implement the downloader**

The PowerShell flow must be:

```powershell
$manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
$finalPath = Join-Path $TargetDir $manifest.fileName
$partialPath = "$finalPath.part"
if ($DryRun) { [pscustomobject]@{ finalPath=$finalPath; partialPath=$partialPath; sha256=$manifest.sha256 } | ConvertTo-Json; exit 0 }
$drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($TargetDir).TrimEnd(':\'))
if ($drive.Free -lt [int64]$manifest.minimumFreeBytes) { throw "at least 25 GiB free space is required" }
curl.exe --location --fail --retry 5 --continue-at - --output $partialPath $manifest.downloadUrl
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $partialPath).Hash.ToLowerInvariant()
if ($actual -ne $manifest.sha256) { throw "FLF2V model SHA-256 mismatch" }
Move-Item -LiteralPath $partialPath -Destination $finalPath
```

If a valid final file already exists, exit successfully. If an invalid final file exists, stop without overwriting it.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
node scripts/check-wan-flf2v-model-download.mjs
powershell -NoProfile -File scripts/download-wan-flf2v-model.ps1 -DryRun
```

Expected: test prints `PASS`; dry run prints the final and `.part` paths without creating either file.

### Task 3: Strict masked end-keyframe generation

**Files:**
- Create: `src/modules/comfy-pipeline/presets/image-qwen-half-step-endpoint-v1.json`
- Create: `scripts/run-wan-flf2v-endpoint.mjs`
- Create: `scripts/check-wan-flf2v-endpoint.mjs`
- Create: `.superpowers/sdd/wan-flf2v-task-3-report.md`

**Interfaces:**
- Consumes Task 1 report and `ENDPOINT_SEEDS`.
- CLI: `--candidate 1|2|3`; optional `--report`; no batch/all mode.
- Produces `endpoint/candidate_00N/raw_edit.png`, `mask.png`, `locked_region_mask.png`, `composite.png`, `start_end.png`, and a technically accepted pending endpoint record.

- [ ] **Step 1: Write the failing endpoint contract**

Assert the preset uses the existing Qwen image-edit model, the approved start as main image, Shen Yan reference inputs, a supplied lower-body mask, and no full-scene replacement reference. Assert the runner contains exactly-one candidate validation, approved seed lookup, authoritative SHA check, hard `maskedmerge`, locked-region raw-difference validation, and `markEndpointTechnical`.

Add a real FFmpeg fixture: use two solid-color PNGs and a generated mask; verify the composite uses edited pixels inside the mask and source pixels outside the expanded feather region.

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/check-wan-flf2v-endpoint.mjs`  
Expected: FAIL because the preset/runner do not exist.

- [ ] **Step 3: Add the experimental Qwen preset**

Derive it from `storyboard-image-qwen-stageB-v1.json`, but bind:

```json
{
  "main_image": "{{START_FRAME_PATH}}",
  "character_reference": "{{SHEN_YAN_PRIMARY_PATH}}",
  "mask": "{{LOWER_BODY_MASK_PATH}}",
  "prompt": "Edit only the masked lower body of Shen Yan. Move his screen-left boot one short grounded half-step diagonally up-left along the riverside path toward the bridge. Show a slight knee bend and a small pelvis weight transfer; keep the screen-right boot planted. Preserve his exact coat construction, trousers, boots, body proportions, face and upper body. Jiang Lan and every unmasked pixel must remain unchanged."
}
```

Use the existing Qwen model, CLIP, VAE, Lightning LoRA, 4 steps, CFG 1, Euler, beta scheduler. Save only the raw edit; hard composition occurs outside ComfyUI.

- [ ] **Step 4: Implement the endpoint runner**

For the 1152×640 source, generate a grayscale mask from the union of these polygons, then feather it by 12 pixels:

```js
const upper = [[420,250],[515,250],[530,420],[405,420]];
const lower = [[375,400],[565,400],[570,625],[370,625]];
```

The runner must upload the start/reference/mask, queue exactly one Qwen edit, then hard-compose:

```text
[0:v][1:v][2:v]maskedmerge[out]
```

where input 0 is the approved start, input 1 is the raw edit, and input 2 is the feathered mask. Generate a binary locked-region mask outside the feather band, difference start versus composite there, and reject technical acceptance if any locked-region channel byte is non-zero.

Write the candidate and evidence only under `logs/video-quality-one-take-flf2v/endpoint/candidate_00N/`, then call `markEndpointTechnical` and leave creative status pending.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
node --check scripts/run-wan-flf2v-endpoint.mjs
node scripts/check-wan-flf2v-endpoint.mjs
node scripts/check-wan-flf2v-experiment.mjs
node scripts/check-wan-i2v-production-preset.mjs
```

Expected: syntax exits 0 and all checks print `PASS`.

### Task 4: Dedicated FLF2V preset and isolated segment-1 runner

**Files:**
- Create: `src/modules/comfy-pipeline/presets/video-wan21-flf2v-14b-fp8.json`
- Create: `scripts/run-wan-flf2v-segment1.mjs`
- Create: `scripts/check-wan-flf2v-segment1.mjs`
- Create: `.superpowers/sdd/wan-flf2v-task-4-report.md`

**Interfaces:**
- Consumes Task 1 `assertApprovedEndpoint`, `VIDEO_SEEDS`, and geometry.
- CLI: `--candidate 1|2|3`; optional `--report`; optional `--probe-resolution 960x544` is technical feasibility only and cannot be reviewed as production.
- Produces normalized start/end, 1280×720 raw FLF video, 832×480 chain candidate, final frame, nine-frame sheet, metadata, hashes, Prompt ID, and pending creative state.

- [ ] **Step 1: Write the failing FLF preset/runner contract**

Assert the preset includes:

```js
assert.equal(preset["1"].inputs.unet_name, "wan2.1_flf2v_720p_14B_fp8_e4m3fn.safetensors");
assert.equal(preset["10"].class_type, "WanFirstLastFrameToVideo");
assert.deepEqual(preset["10"].inputs.start_image, ["6", 0]);
assert.deepEqual(preset["10"].inputs.end_image, ["7", 0]);
assert.deepEqual(preset["10"].inputs.clip_vision_start_image, ["8", 0]);
assert.deepEqual(preset["10"].inputs.clip_vision_end_image, ["9", 0]);
assert.equal(preset["10"].inputs.width, 1280);
assert.equal(preset["10"].inputs.height, 720);
assert.equal(preset["10"].inputs.length, 17);
assert.equal(preset["11"].inputs.steps, 20);
assert.equal(preset["11"].inputs.cfg, 5);
assert.equal(preset["11"].inputs.sampler_name, "uni_pc");
assert.equal(preset["11"].inputs.scheduler, "normal");
```

Assert the runner rejects an unaccepted endpoint, missing model dropdown entry, a changed authoritative hash, an invalid candidate, or probe output promotion. Assert technical retries reuse `VIDEO_SEEDS[candidate - 1]`.

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/check-wan-flf2v-segment1.mjs`  
Expected: FAIL because the preset/runner do not exist.

- [ ] **Step 3: Add the FLF2V preset**

Use separate start/end `LoadImage` and `CLIPVisionEncode` nodes. Bind both image and CLIP Vision outputs into `WanFirstLastFrameToVideo`. Use the exact production parameters in Global Constraints and `SaveVideo` H.264 at 16 FPS.

- [ ] **Step 4: Implement isolated normalization and generation**

Before queuing:

1. verify the authoritative report SHA-256 still matches the experiment snapshot;
2. verify the dedicated model appears in `/object_info/UNETLoader`;
3. verify the accepted endpoint file/hash/evidence;
4. unload prior Comfy models with the local memory-free endpoint;
5. require at least 20 GiB available system RAM after unload or stop with an actionable message.

Normalize both images with:

```powershell
ffmpeg -y -i input.png -vf "scale=1296:720,crop=1280:720:8:0" normalized.png
```

After the 1280×720 FLF output passes H.264/17-frame/16-FPS checks, create the chain candidate with:

```powershell
ffmpeg -y -i raw.mp4 -vf "scale=-2:480,crop=832:480:11:0" -an -c:v libx264 -crf 18 chain.mp4
```

Require the chain candidate to be H.264, 832×480, 16 FPS, exactly 17 frames, and 1.0–1.2 seconds. Extract frame 16 and make the 0/2/4/6/8/10/12/14/16 contact sheet. Call `markVideoTechnical`; creative status remains pending.

- [ ] **Step 5: Run focused tests and build**

Run:

```powershell
node --check scripts/run-wan-flf2v-segment1.mjs
node scripts/check-wan-flf2v-segment1.mjs
node scripts/check-wan-flf2v-endpoint.mjs
node scripts/check-wan-flf2v-experiment.mjs
node scripts/check-wan-one-take-runner.mjs
node scripts/check-wan-one-take-assembly.mjs
npm.cmd run build
```

Expected: all checks print `PASS`; build succeeds with only the existing chunk-size warning allowed.

### Task 5: Live isolated model, endpoint, and FLF2V experiment

**Files:**
- Generate/modify: `logs/video-quality-one-take-flf2v/**`
- Generate: `.superpowers/sdd/wan-flf2v-half-step-live-report.md`

**Interfaces:**
- Consumes Tasks 1–4 and running ComfyUI at `http://127.0.0.1:8188`.
- Produces a truthful experimental verdict only; never imports into the authoritative one-take report.

- [ ] **Step 1: Preflight without mutation**

Record:

```powershell
Get-PSDrive -Name C
Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8188/system_stats' -TimeoutSec 10
Test-Path -LiteralPath 'C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Shared\output\Storyboard\河边远景建立_klein_ref_00006_.png'
Get-FileHash -Algorithm SHA256 -LiteralPath 'logs\video-quality-one-take\wan-one-take-report.json'
node scripts/check-wan-flf2v-experiment.mjs
node scripts/check-wan-flf2v-model-download.mjs
node scripts/check-wan-flf2v-endpoint.mjs
node scripts/check-wan-flf2v-segment1.mjs
```

Expected: at least 25 GiB disk free, HTTP 200, start exists, authoritative hash recorded, and all checks pass.

- [ ] **Step 2: Download and verify the model**

With explicit filesystem/network approval, run the downloader against:

`C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models\diffusion_models`

Record elapsed time, final byte count, and SHA-256. Refresh ComfyUI model inventory; if restart is required, obtain approval before restarting the desktop service. Verify the exact filename appears in `UNETLoader`.

- [ ] **Step 3: Generate and judge endpoint candidates serially**

Run candidate 1 only:

```powershell
node scripts/run-wan-flf2v-endpoint.mjs --candidate 1
```

Inspect original, raw edit, mask, composite, and start/end evidence. Accept only if the half-step endpoint is readable and all locked regions are unchanged. Record the decision:

```powershell
node scripts/review-wan-flf2v-experiment.mjs --endpoint-candidate 1 --decision accepted --note "Shen Yan has one grounded half-step toward the bridge; Jiang Lan, identities and locked scene regions pass" --evidence logs/video-quality-one-take-flf2v/endpoint/candidate_001/start_end.png
```

If rejected, use candidates 2 then 3 serially with exact reasons. Stop before FLF if all three reject.

- [ ] **Step 4: Run one VRAM probe and up to three production seeds**

Unload Qwen before FLF. Confirm at least 20 GiB free RAM. Generate production candidate 1 at 1280×720. A 960×544 command is permitted only after an actual OOM and is labeled `probeOnly=true`; it cannot be accepted.

For each production candidate, inspect the nine-frame sheet for lift, travel, landing, weight transfer, Jiang Lan stability, two-human identity, scene stability, and extremely slow push. Record accept/reject with the review CLI. Stop after the first accepted candidate or after three rejections.

- [ ] **Step 5: Verify experimental success or truthful rejection**

On acceptance, verify:

```js
assert.equal(report.approvedEndpoint.creativeAcceptance.status, "accepted");
assert.equal(report.approvedVideo.creativeAcceptance.status, "accepted");
assert.equal(report.approvedVideo.metadata.codec_name, "h264");
assert.equal(report.approvedVideo.metadata.width, 832);
assert.equal(report.approvedVideo.metadata.height, 480);
assert.equal(report.approvedVideo.metadata.nb_frames, "17");
assert.equal(report.authoritativeReportSha256, sha256(readFileSync(report.authoritativeReportPath)));
```

On rejection, assert `approvedVideo === null` and the authoritative hash still matches. In both cases run the full Task 4 non-live checks and production build, then write all model hashes, image/video hashes, seeds, Prompt IDs, media metadata, visual decisions, retry reasons, OOM events, and the final experimental verdict to `.superpowers/sdd/wan-flf2v-half-step-live-report.md`.

## Plan Self-Review

- Spec coverage: model acquisition, strict endpoint edit, deterministic locked pixels, 1280×720 FLF, 832×480 conversion, state isolation, fixed retries, OOM handling, evidence, and live stop rules are each assigned to Tasks 1–5.
- Placeholder scan: no `TBD`, `TODO`, deferred implementation, unnamed function, or unspecified command remains.
- Interface consistency: Tasks 3 and 4 consume only the Task 1 function names and seed arrays declared in their interface blocks; Task 5 uses the exact CLI modes produced by Tasks 2–4.
- Scope: ATI fallback, segment 2–6 generation, assembly, import into the authoritative report, RIFE, FaceDetailer, audio, and additional control models remain excluded.
- Git safety: commit steps are intentionally omitted because this shared dirty `main` contains overlapping uncommitted one-take dependencies.
