# Chained One-Take Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a six-segment Wan 2.1 chain in which every segment after the first starts from the previous segment's real final frame, then assemble the segments without cuts, dissolves, duplicated boundary frames, or black frames.

**Architecture:** A pure chain-contract module defines segment lineage, deterministic seeds, SHA-256 boundary checks, and the FFmpeg no-transition filter graph. A command-line runner performs ComfyUI upload, queue, polling, output discovery, final-frame extraction, retry isolation, evidence reporting, and final assembly. The existing Wan 2.1 I2V production preset remains the only generation workflow.

**Tech Stack:** Node.js 22 ESM, ComfyUI REST API, Wan 2.1 I2V FP8, FFmpeg/FFprobe, JSON evidence reports, existing StoryboardPro scripts.

## Global Constraints

- Only `河边远景建立_klein_ref_00006_.png` is allowed as the initial visual frame.
- Segments 2–6 must use the previous accepted segment's extracted final frame; the other storyboard images are prompt references only.
- Generation settings remain 832×480, 17 frames, 16 FPS, 20 steps, CFG 5, `uni_pc`, `normal`.
- Exactly two human characters must remain visible: 沈砚 and 江岚; no beast traits, duplicate people, background pedestrians, or identity swaps.
- The chain stops on an unaccepted segment. A failed segment may retry up to three times; its failed final frame must never seed the next segment.
- Assembly keeps all 17 frames of segment 1, removes frame 0 from segments 2–6, produces exactly 97 native frames, and does not use `xfade`.
- The delivery output is H.264, 832×480, 24 FPS, approximately 6.06 seconds.

---

### Task 1: Pure chain lineage and assembly contract

**Files:**
- Create: `scripts/lib/wan-one-take-chain.mjs`
- Create: `scripts/check-wan-one-take-chain.mjs`

**Interfaces:**
- Produces: `buildOneTakeSegments({ initialFramePath, prompts, baseSeed })`
- Produces: `assertBoundaryHash(previousFinalHash, nextInputHash, segmentId)`
- Produces: `buildOneTakeConcatFilter({ segmentCount, framesPerSegment, inputFps, outputFps })`
- Consumes: no project state or external services.

- [ ] **Step 1: Write the failing contract test**

```js
import assert from "node:assert/strict";
import {
  assertBoundaryHash,
  buildOneTakeConcatFilter,
  buildOneTakeSegments
} from "./lib/wan-one-take-chain.mjs";

const prompts = Array.from({ length: 6 }, (_, index) => `beat-${index + 1}`);
const segments = buildOneTakeSegments({
  initialFramePath: "first.png",
  prompts,
  baseSeed: 26083000
});
assert.equal(segments.length, 6);
assert.equal(segments[0].input.kind, "initial_frame");
assert.equal(segments[0].input.path, "first.png");
assert.equal(segments[1].input.kind, "previous_final_frame");
assert.equal(segments[5].seed, 26083006);
assert.doesNotThrow(() => assertBoundaryHash("abc", "abc", "segment_002"));
assert.throws(() => assertBoundaryHash("abc", "def", "segment_002"), /boundary hash mismatch/);

const assembly = buildOneTakeConcatFilter({
  segmentCount: 6,
  framesPerSegment: 17,
  inputFps: 16,
  outputFps: 24
});
assert.equal(assembly.nativeFrameCount, 97);
assert.match(assembly.filterGraph, /trim=start_frame=1:end_frame=17/);
assert.match(assembly.filterGraph, /concat=n=6:v=1:a=0/);
assert.match(assembly.filterGraph, /minterpolate=fps=24/);
assert.doesNotMatch(assembly.filterGraph, /xfade/);
console.log("Wan chained one-take contract: PASS");
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/check-wan-one-take-chain.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/lib/wan-one-take-chain.mjs`.

- [ ] **Step 3: Implement the minimal pure module**

```js
export function buildOneTakeSegments({ initialFramePath, prompts, baseSeed }) {
  if (!initialFramePath?.trim()) throw new Error("initialFramePath is required");
  if (!Array.isArray(prompts) || prompts.length !== 6) throw new Error("exactly six prompts are required");
  return prompts.map((prompt, index) => ({
    id: `segment_${String(index + 1).padStart(3, "0")}`,
    order: index + 1,
    prompt,
    seed: baseSeed + index + 1,
    input: index === 0
      ? { kind: "initial_frame", path: initialFramePath }
      : { kind: "previous_final_frame", fromSegmentId: `segment_${String(index).padStart(3, "0")}` }
  }));
}

export function assertBoundaryHash(previousFinalHash, nextInputHash, segmentId) {
  if (!previousFinalHash || previousFinalHash !== nextInputHash) {
    throw new Error(`boundary hash mismatch for ${segmentId}: ${previousFinalHash} != ${nextInputHash}`);
  }
}

export function buildOneTakeConcatFilter({ segmentCount, framesPerSegment, inputFps, outputFps }) {
  const filters = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const startFrame = index === 0 ? 0 : 1;
    filters.push(
      `[${index}:v]fps=${inputFps},trim=start_frame=${startFrame}:end_frame=${framesPerSegment},setpts=PTS-STARTPTS[v${index}]`
    );
  }
  const inputs = Array.from({ length: segmentCount }, (_, index) => `[v${index}]`).join("");
  filters.push(`${inputs}concat=n=${segmentCount}:v=1:a=0[native]`);
  filters.push(`[native]minterpolate=fps=${outputFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,format=yuv420p[outv]`);
  return {
    filterGraph: filters.join(";"),
    nativeFrameCount: framesPerSegment + (segmentCount - 1) * (framesPerSegment - 1)
  };
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node scripts/check-wan-one-take-chain.mjs`

Expected: `Wan chained one-take contract: PASS`.

---

### Task 2: Serial ComfyUI chain runner with isolated retries

**Files:**
- Create: `scripts/run-wan-one-take-chain.mjs`
- Create: `scripts/check-wan-one-take-runner.mjs`
- Reuse: `scripts/lib/comfy-output-media.mjs`
- Reuse: `src/modules/comfy-pipeline/presets/video-wan21-i2v-14b-fp8.json`

**Interfaces:**
- Consumes: Task 1 `buildOneTakeSegments` and `assertBoundaryHash`.
- Produces: `logs/video-quality-one-take/wan-one-take-report.json`.
- Produces: six MP4 paths and six extracted final-frame paths recorded in the report.

- [ ] **Step 1: Write the failing runner source contract**

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let source = "";
try {
  source = readFileSync("scripts/run-wan-one-take-chain.mjs", "utf8");
} catch {
  assert.fail("one-take runner is missing");
}
assert.match(source, /for \(const segment of segments\)/);
assert.match(source, /previousAcceptedFinalFrame/);
assert.match(source, /assertBoundaryHash/);
assert.match(source, /extractFinalFrame/);
assert.match(source, /maxAttempts = 3/);
assert.match(source, /wan-one-take-report\.json/);
assert.match(source, /video-wan21-i2v-14b-fp8\.json/);
console.log("Wan chained one-take runner contract: PASS");
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/check-wan-one-take-runner.mjs`

Expected: FAIL with `one-take runner is missing`.

- [ ] **Step 3: Implement runner configuration and six motion beats**

The runner must define the initial frame exactly as:

```js
const initialFramePath = "C:/Users/Administrator/AppData/Local/Comfy-Desktop/ComfyUI-Shared/output/Storyboard/河边远景建立_klein_ref_00006_.png";
const maxAttempts = 3;
const motionPrompts = [
  "Continuous single-take riverside shot. Shen Yan and Jiang Lan begin moving naturally from their existing positions. Very slow stabilized forward tracking, same side of the action axis, subtle breathing and grounded weight shift.",
  "Continue the exact same uninterrupted shot. Jiang Lan turns her head toward Shen Yan and begins speaking while both keep the same grounded direction. The camera continues its existing slow forward tracking without reframing.",
  "Continue without a cut. Both take one slow grounded step. Jiang Lan raises one hand slightly while thinking; Shen Yan keeps watching the bridge. Preserve the current camera path and positions.",
  "Continue the same take. Shen Yan slows slightly, nods once and raises his right hand in a restrained warning gesture. Jiang Lan reacts without changing sides. No camera cut or sudden zoom.",
  "Continue the same stabilized tracking shot. Both walk slowly toward the bridge with natural foot contact, arm swing and cloth motion. Preserve exact identities, outfits and screen-side relationship.",
  "Continue to the end of the same take. Both naturally slow near the bridge. Jiang Lan leans slightly toward the water while Shen Yan plants his feet and scans the surroundings. End on a stable held composition."
];
```

Use the existing token replacement, upload, queue, polling, and output extraction patterns from `scripts/run-wan-six-shot-benchmark.mjs`. For each accepted segment:

```js
const inputFramePath = segment.order === 1 ? initialFramePath : previousAcceptedFinalFrame;
const inputHash = sha256(readFileSync(inputFramePath));
if (segment.order > 1) assertBoundaryHash(previousAcceptedFinalHash, inputHash, segment.id);
// Queue the existing Wan I2V workflow with 17 frames.
// On success, run extractFinalFrame(videoPath, finalFramePath).
previousAcceptedFinalFrame = finalFramePath;
previousAcceptedFinalHash = sha256(readFileSync(finalFramePath));
```

`extractFinalFrame` must execute FFmpeg without a shell:

```js
function extractFinalFrame(videoPath, outputPath) {
  const result = spawnSync("ffmpeg", [
    "-y", "-v", "error", "-i", videoPath,
    "-vf", "select=eq(n\\,16)", "-frames:v", "1", outputPath
  ], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`final-frame extraction failed: ${result.stderr}`);
}
```

Each attempt uses `segment.seed + (attempt - 1) * 1000`. The report is rewritten after every attempt. Only a successful attempt updates `previousAcceptedFinalFrame`. If all three attempts fail, throw and stop the loop.

- [ ] **Step 4: Run the runner contract and existing workflow tests**

Run:

```powershell
node scripts/check-wan-one-take-runner.mjs
node scripts/check-wan-i2v-production-preset.mjs
node scripts/check-comfy-save-video-output.mjs
```

Expected: all three commands print `PASS` and exit 0.

---

### Task 3: No-transition one-take assembly

**Files:**
- Modify: `scripts/run-wan-one-take-chain.mjs`
- Create: `scripts/check-wan-one-take-assembly.mjs`

**Interfaces:**
- Consumes: Task 1 `buildOneTakeConcatFilter` and the six accepted MP4 files from Task 2.
- Produces: `logs/video-quality-one-take/river_one_take_native16.mp4`.
- Produces: `logs/video-quality-one-take/river_one_take_delivery24.mp4`.

- [ ] **Step 1: Write the failing assembly contract**

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync("scripts/run-wan-one-take-chain.mjs", "utf8");
assert.match(source, /buildOneTakeConcatFilter/);
assert.match(source, /river_one_take_native16\.mp4/);
assert.match(source, /river_one_take_delivery24\.mp4/);
assert.match(source, /nativeFrameCount !== 97/);
assert.doesNotMatch(source, /xfade=transition/);
console.log("Wan one-take assembly contract: PASS");
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node scripts/check-wan-one-take-assembly.mjs`

Expected: FAIL because the runner does not yet contain the assembly paths and frame-count guard.

- [ ] **Step 3: Add deterministic FFmpeg assembly**

After all six segments are accepted, call `buildOneTakeConcatFilter` and execute:

```js
function runFfmpeg(args) {
  const result = spawnSync("ffmpeg", args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
}

function probeVideo(filePath) {
  const result = spawnSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,r_frame_rate,nb_frames:format=duration,size",
    "-of", "json", filePath
  ], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`ffprobe failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  return { ...parsed.streams[0], format: parsed.format };
}

const nativePath = resolve(reportDir, "river_one_take_native16.mp4");
const deliveryPath = resolve(reportDir, "river_one_take_delivery24.mp4");
const nativeGraph = assembly.filterGraph.replace(
  /;\[native\]minterpolate[\s\S]*$/,
  ";[native]format=yuv420p[outv]"
);
runFfmpeg([...segmentInputs, "-filter_complex", nativeGraph, "-map", "[outv]", "-an", "-c:v", "libx264", "-crf", "18", nativePath]);
runFfmpeg([...segmentInputs, "-filter_complex", assembly.filterGraph, "-map", "[outv]", "-an", "-c:v", "libx264", "-crf", "18", deliveryPath]);
const nativeFrameCount = Number(probeVideo(nativePath).nb_frames);
if (nativeFrameCount !== 97) throw new Error(`nativeFrameCount !== 97: ${nativeFrameCount}`);
```

Store both paths and FFprobe metadata in the final report. Do not call StoryboardPro's transition-based `concat_video_segments` endpoint for this mode.

- [ ] **Step 4: Run all one-take unit contracts**

Run:

```powershell
node scripts/check-wan-one-take-chain.mjs
node scripts/check-wan-one-take-runner.mjs
node scripts/check-wan-one-take-assembly.mjs
```

Expected: all three commands print `PASS`.

---

### Task 4: Real six-segment generation and evidence-based acceptance

**Files:**
- Generate: `logs/video-quality-one-take/wan-one-take-report.json`
- Generate: `logs/video-quality-one-take/river_one_take_native16.mp4`
- Generate: `logs/video-quality-one-take/river_one_take_delivery24.mp4`
- Generate: `logs/video-quality-one-take/contact-sheets/segment_001.png` through `segment_006.png`
- Generate: `logs/video-quality-one-take/contact-sheets/one_take_97_frames.png`

**Interfaces:**
- Consumes: running ComfyUI at `http://127.0.0.1:8188` and Tasks 1–3.
- Produces: accepted one-take media and audit evidence.

- [ ] **Step 1: Run segment 1 only as a smoke test**

Run: `node scripts/run-wan-one-take-chain.mjs --max-segments 1`

Expected: one successful 17-frame H.264 MP4, one extracted final PNG, and a partial report with `acceptedSegments: 1`.

- [ ] **Step 2: Inspect segment 1 contact sheet**

Run:

```powershell
$report=Get-Content -LiteralPath 'logs/video-quality-one-take/wan-one-take-report.json' -Raw | ConvertFrom-Json
$segment1=$report.segments[0].videoPath
ffmpeg -y -v error -i $segment1 -vf "scale=277:160,tile=3x6" -frames:v 1 'logs/video-quality-one-take/contact-sheets/segment_001.png'
```

Expected: exactly two people; no duplicate background person, face drift, beast traits, color blocks, or severe anatomy errors.

- [ ] **Step 3: Run the complete chain**

Run: `node scripts/run-wan-one-take-chain.mjs`

Expected: `One-take chain complete: 6/6`, with every report segment containing `inputSha256`, `finalFrameSha256`, `promptId`, `seed`, `elapsedSeconds`, and one MP4 output.

- [ ] **Step 4: Verify boundary lineage and media metadata**

Run a report verifier that asserts for segments 2–6:

```js
assert.equal(report.segments[index].inputSha256, report.segments[index - 1].finalFrameSha256);
```

Run FFprobe on the native and delivery files.

Expected native: H.264, 832×480, 16 FPS, 97 frames, approximately 6.0625 seconds.

Expected delivery: H.264, 832×480, 24 FPS, approximately 6.0 seconds.

- [ ] **Step 5: Generate visual audit sheets**

For each segment, tile frames 0, 8, and 16. For the final native video, tile all 97 frames at reduced resolution. Inspect:

- exactly two characters in every sampled frame;
- continuous camera side and motion direction;
- no duplicated boundary frame;
- no one-frame composition jump at the five boundaries;
- stable face, hair, outfit, species, color and environment.

- [ ] **Step 6: Run regression and production build verification**

Run:

```powershell
node --check scripts/run-wan-one-take-chain.mjs
node scripts/check-wan-one-take-chain.mjs
node scripts/check-wan-one-take-runner.mjs
node scripts/check-wan-one-take-assembly.mjs
node scripts/check-wan-i2v-production-preset.mjs
npm.cmd run build
```

Expected: every Node command exits 0 with `PASS`; Vite reports `✓ built`.

## Self-Review

- Spec coverage: all generation lineage, retry isolation, 97-frame assembly, no-transition boundary behavior, evidence reporting, media probing, and visual checks map to Tasks 1–4.
- Placeholder scan: no unfinished marker, deferred implementation, or undefined interface remains.
- Type consistency: `buildOneTakeSegments`, `assertBoundaryHash`, and `buildOneTakeConcatFilter` are defined once in Task 1 and consumed under the same names in Tasks 2–3.
- Scope: dialogue, lip sync, RIFE installation, FaceDetailer, multi-person layering, and model downloads remain explicitly excluded.
