# One-Take Motion Quality Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the technically successful but visually frozen six-segment result with a gated Wan 2.1 chain that advances only after both technical and creative approval, then produce a naturally moving, identity-stable one-take delivery.

**Architecture:** A pure acceptance module owns segment/final acceptance state and validates accepted prefixes. A small review CLI records human or agent visual decisions atomically. The Wan runner becomes an explicit single-segment generator or assembler: it never queues the next segment while creative status is pending/rejected, and it never marks an assembly deliverable until a final review accepts it.

**Tech Stack:** Node.js 22 ESM, ComfyUI REST API, Wan 2.1 I2V FP8, FFmpeg/FFprobe, JSON evidence reports, existing StoryboardPro scripts.

## Global Constraints

- Continue using the existing Wan 2.1 I2V FP8 workflow; do not replace the model.
- Generation remains 832×480, 17 frames, 16 FPS, 20 steps, CFG 5, `uni_pc`, `normal`.
- Only the approved riverside storyboard frame may seed segment 1.
- Segments 2–6 may use only the previous segment whose technical and creative acceptance both passed.
- Exactly two human characters remain visible: Shen Yan and Jiang Lan; no beast traits, duplicates, background pedestrians, or identity swaps.
- The camera performs one continuous extremely slow forward push; no pan, reverse angle, sudden zoom, or reframing.
- One segment performs one primary action once, then returns toward a natural pose.
- Native assembly remains `17 + 5 × 16 = 97` frames and must not use `xfade`; delivery remains H.264 832×480 at 24 FPS for approximately six seconds.
- A failed candidate's final frame must never seed a later segment. Each segment receives at most three candidate seeds.
- Preserve unrelated changes in the shared dirty `main` workspace. Do not run broad staging, cleanup, reset, checkout, or commit operations.

---

### Task 1: Pure technical and creative acceptance contract

**Files:**
- Create: `scripts/lib/wan-one-take-acceptance.mjs`
- Create: `scripts/check-wan-one-take-acceptance.mjs`

**Interfaces:**
- Produces: `markTechnicalAccepted(segment, attempt)`.
- Produces: `applyCreativeReview(segment, review)`.
- Produces: `assertAcceptedPrefix({ segments, expectedCount, initialFrameHash, hashFile })`.
- Produces: `canAssemble(segments)`.
- Produces: `applyFinalReview(report, review)`.
- Consumes: no project state; `hashFile(path)` is injected by callers.

- [ ] **Step 1: Write the failing acceptance contract test**

Create `scripts/check-wan-one-take-acceptance.mjs`:

```js
import assert from "node:assert/strict";
import {
  applyCreativeReview,
  applyFinalReview,
  assertAcceptedPrefix,
  canAssemble,
  markTechnicalAccepted
} from "./lib/wan-one-take-acceptance.mjs";

const baseSegment = {
  id: "segment_001",
  order: 1,
  prompt: "beat-1",
  attempts: []
};
const attempt = {
  attempt: 1,
  seed: 26081011,
  inputSha256: "initial-hash",
  finalFrameSha256: "final-1",
  promptId: "prompt-1",
  elapsedSeconds: 10,
  videoPath: "segment-1.mp4",
  finalFramePath: "segment-1-final.png"
};

const technical = markTechnicalAccepted(baseSegment, attempt);
assert.equal(technical.technicalAccepted, true);
assert.equal(technical.accepted, false);
assert.equal(technical.creativeAcceptance.status, "pending");
assert.equal(technical.finalFrameSha256, "final-1");

const accepted = applyCreativeReview(technical, {
  decision: "accepted",
  note: "clear half-step and slow push",
  evidencePath: "segment_001.png",
  reviewedAt: "2026-08-11T00:00:00.000Z"
});
assert.equal(accepted.accepted, true);
assert.equal(accepted.creativeAcceptance.status, "accepted");

const rejected = applyCreativeReview(technical, {
  decision: "rejected",
  note: "motion is frozen",
  evidencePath: "segment_001.png",
  reviewedAt: "2026-08-11T00:00:00.000Z"
});
assert.equal(rejected.accepted, false);
assert.equal(rejected.creativeAcceptance.status, "rejected");

assert.throws(
  () => applyCreativeReview(baseSegment, {
    decision: "accepted",
    note: "invalid",
    evidencePath: "segment_001.png",
    reviewedAt: "2026-08-11T00:00:00.000Z"
  }),
  /technical acceptance is required/
);

const six = Array.from({ length: 6 }, (_, index) => ({
  ...accepted,
  id: `segment_${String(index + 1).padStart(3, "0")}`,
  order: index + 1,
  inputSha256: index === 0 ? "initial-hash" : `final-${index}`,
  finalFrameSha256: `final-${index + 1}`,
  videoPath: `segment-${index + 1}.mp4`,
  finalFramePath: `segment-${index + 1}-final.png`
}));
const hashes = new Map(six.map((segment) => [segment.finalFramePath, segment.finalFrameSha256]));
assert.doesNotThrow(() => assertAcceptedPrefix({
  segments: six,
  expectedCount: 6,
  initialFrameHash: "initial-hash",
  hashFile: (path) => hashes.get(path)
}));
assert.equal(canAssemble(six), true);
assert.equal(canAssemble([...six.slice(0, 5), rejected]), false);

const assembledReport = { segments: six, assembly: { nativePath: "native.mp4", deliveryPath: "delivery.mp4" } };
const finalAccepted = applyFinalReview(assembledReport, {
  decision: "accepted",
  note: "all six beats and boundaries pass",
  evidencePath: "one_take_97_frames.png",
  reviewedAt: "2026-08-11T00:00:00.000Z"
});
assert.equal(finalAccepted.overallAccepted, true);
assert.equal(finalAccepted.finalAcceptance.status, "accepted");
console.log("Wan one-take acceptance contract: PASS");
```

- [ ] **Step 2: Run the contract and verify RED**

Run:

```powershell
node scripts/check-wan-one-take-acceptance.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `scripts/lib/wan-one-take-acceptance.mjs`.

- [ ] **Step 3: Implement the minimal pure acceptance module**

Create `scripts/lib/wan-one-take-acceptance.mjs`:

```js
import assert from "node:assert/strict";

const decisions = new Set(["accepted", "rejected"]);

function requireReview({ decision, note, evidencePath, reviewedAt }) {
  if (!decisions.has(decision)) throw new Error(`invalid creative decision: ${decision}`);
  if (!note?.trim()) throw new Error("review note is required");
  if (!evidencePath?.trim()) throw new Error("review evidencePath is required");
  if (!reviewedAt?.trim()) throw new Error("reviewedAt is required");
}

export function markTechnicalAccepted(segment, attempt) {
  for (const field of ["inputSha256", "finalFrameSha256", "promptId", "videoPath", "finalFramePath"]) {
    if (!attempt?.[field]) throw new Error(`technical attempt is missing ${field}`);
  }
  return {
    ...segment,
    technicalAccepted: true,
    creativeAcceptance: { status: "pending" },
    accepted: false,
    acceptedAttempt: attempt.attempt,
    seed: attempt.seed,
    inputSha256: attempt.inputSha256,
    finalFrameSha256: attempt.finalFrameSha256,
    promptId: attempt.promptId,
    elapsedSeconds: attempt.elapsedSeconds,
    videoPath: attempt.videoPath,
    finalFramePath: attempt.finalFramePath
  };
}

export function applyCreativeReview(segment, review) {
  requireReview(review);
  if (!segment?.technicalAccepted) throw new Error(`technical acceptance is required for ${segment?.id || "segment"}`);
  const status = review.decision;
  return {
    ...segment,
    creativeAcceptance: {
      status,
      note: review.note.trim(),
      evidencePath: review.evidencePath,
      reviewedAt: review.reviewedAt
    },
    accepted: status === "accepted"
  };
}

export function assertAcceptedPrefix({ segments, expectedCount, initialFrameHash, hashFile }) {
  assert.equal(segments.length, expectedCount, `accepted prefix must contain ${expectedCount} segments`);
  for (const [index, segment] of segments.entries()) {
    const expectedId = `segment_${String(index + 1).padStart(3, "0")}`;
    assert.equal(segment.id, expectedId);
    assert.equal(segment.order, index + 1);
    assert.equal(segment.technicalAccepted, true, `${expectedId} technical acceptance is required`);
    assert.equal(segment.creativeAcceptance?.status, "accepted", `${expectedId} creative acceptance is required`);
    assert.equal(segment.accepted, true, `${expectedId} combined acceptance is required`);
    assert.ok(segment.videoPath && segment.finalFramePath && segment.finalFrameSha256);
    assert.equal(hashFile(segment.finalFramePath), segment.finalFrameSha256, `${expectedId} final-frame hash mismatch`);
    if (index === 0) assert.equal(segment.inputSha256, initialFrameHash);
    else assert.equal(segment.inputSha256, segments[index - 1].finalFrameSha256);
  }
}

export function canAssemble(segments) {
  return Array.isArray(segments) && segments.length === 6 && segments.every((segment) =>
    segment.technicalAccepted === true &&
    segment.creativeAcceptance?.status === "accepted" &&
    segment.accepted === true
  );
}

export function applyFinalReview(report, review) {
  requireReview(review);
  if (!canAssemble(report?.segments)) throw new Error("six accepted segments are required for final review");
  if (!report?.assembly?.nativePath || !report?.assembly?.deliveryPath) {
    throw new Error("assembled native and delivery media are required for final review");
  }
  return {
    ...report,
    finalAcceptance: {
      status: review.decision,
      note: review.note.trim(),
      evidencePath: review.evidencePath,
      reviewedAt: review.reviewedAt
    },
    overallAccepted: review.decision === "accepted"
  };
}
```

- [ ] **Step 4: Run GREEN verification**

Run:

```powershell
node scripts/check-wan-one-take-acceptance.mjs
node scripts/check-wan-one-take-chain.mjs
```

Expected:

```text
Wan one-take acceptance contract: PASS
Wan chained one-take contract: PASS
```

---

### Task 2: Atomic segment and final creative-review CLI

**Files:**
- Create: `scripts/review-wan-one-take.mjs`
- Create: `scripts/check-review-wan-one-take.mjs`
- Reuse: `scripts/lib/wan-one-take-acceptance.mjs`

**Interfaces:**
- Consumes: Task 1 `applyCreativeReview(segment, review)` and `applyFinalReview(report, review)`.
- Produces: atomic updates to a report selected by `--report`.
- Produces CLI modes:
  - `--segment N --decision accepted|rejected --note TEXT --evidence PATH`.
  - `--final-decision accepted|rejected --note TEXT --evidence PATH`.

- [ ] **Step 1: Write a failing end-to-end CLI check**

Create `scripts/check-review-wan-one-take.mjs`. The test must create a temporary report and evidence file, invoke the real CLI, and read back the updated JSON:

```js
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const dir = mkdtempSync(resolve(tmpdir(), "wan-review-"));
const reportPath = resolve(dir, "report.json");
const evidencePath = resolve(dir, "segment_001.png");
writeFileSync(evidencePath, "evidence");
writeFileSync(reportPath, JSON.stringify({
  segments: [{
    id: "segment_001",
    order: 1,
    technicalAccepted: true,
    creativeAcceptance: { status: "pending" },
    accepted: false
  }],
  overallAccepted: false
}));

const result = spawnSync(process.execPath, [
  "scripts/review-wan-one-take.mjs",
  "--report", reportPath,
  "--segment", "1",
  "--decision", "accepted",
  "--note", "clear half-step and slow push",
  "--evidence", evidencePath
], { encoding: "utf8", windowsHide: true });
assert.equal(result.status, 0, result.stderr);
const updated = JSON.parse(readFileSync(reportPath, "utf8"));
assert.equal(updated.segments[0].creativeAcceptance.status, "accepted");
assert.equal(updated.segments[0].accepted, true);
assert.equal(updated.overallAccepted, false);
console.log("Wan one-take review CLI: PASS");
```

- [ ] **Step 2: Run the check and verify RED**

Run: `node scripts/check-review-wan-one-take.mjs`

Expected: nonzero child exit because `scripts/review-wan-one-take.mjs` is missing.

- [ ] **Step 3: Implement the review CLI**

Create `scripts/review-wan-one-take.mjs` with these exact behaviors:

```js
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyCreativeReview, applyFinalReview } from "./lib/wan-one-take-acceptance.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

const reportPath = resolve(valueAfter("--report") || "logs/video-quality-one-take/wan-one-take-report.json");
const segmentNumber = valueAfter("--segment") === null ? null : Number(valueAfter("--segment"));
const segmentDecision = valueAfter("--decision");
const finalDecision = valueAfter("--final-decision");
const note = valueAfter("--note");
const evidencePath = valueAfter("--evidence");

if (!existsSync(reportPath)) throw new Error(`report does not exist: ${reportPath}`);
if (!evidencePath || !existsSync(resolve(evidencePath))) throw new Error(`review evidence does not exist: ${evidencePath}`);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const review = {
  decision: segmentDecision || finalDecision,
  note,
  evidencePath: resolve(evidencePath),
  reviewedAt: new Date().toISOString()
};

let updated;
if (segmentNumber !== null) {
  if (!Number.isInteger(segmentNumber) || segmentNumber < 1 || segmentNumber > 6 || !segmentDecision || finalDecision) {
    throw new Error("segment review requires --segment 1..6 and --decision accepted|rejected");
  }
  const index = report.segments.findIndex((segment) => segment.order === segmentNumber);
  if (index < 0) throw new Error(`segment ${segmentNumber} is missing from report`);
  const segments = [...report.segments];
  segments[index] = applyCreativeReview(segments[index], review);
  updated = { ...report, segments, acceptedSegments: segments.filter((segment) => segment.accepted).length, overallAccepted: false };
} else {
  if (!finalDecision || segmentDecision) throw new Error("final review requires --final-decision accepted|rejected");
  updated = applyFinalReview(report, review);
}

const temporaryPath = `${reportPath}.tmp`;
writeFileSync(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
renameSync(temporaryPath, reportPath);
console.log(segmentNumber === null ? `Final creative review: ${finalDecision}` : `Segment ${segmentNumber} creative review: ${segmentDecision}`);
```

- [ ] **Step 4: Run the focused CLI and acceptance checks**

Run:

```powershell
node scripts/check-review-wan-one-take.mjs
node scripts/check-wan-one-take-acceptance.mjs
```

Expected: both print `PASS` and exit 0.

---

### Task 3: Single-segment generation gate and identity-first motion prompts

**Files:**
- Modify: `scripts/run-wan-one-take-chain.mjs`
- Modify: `scripts/check-wan-one-take-runner.mjs`
- Reuse: `scripts/lib/wan-one-take-acceptance.mjs`

**Interfaces:**
- Consumes: Task 1 `markTechnicalAccepted` and `assertAcceptedPrefix`.
- Produces CLI mode: `--generate-segment 1..6 --seed-offset 0|1000|2000`.
- Produces: exactly one newly generated segment with `technicalAccepted=true`, `creativeAcceptance.status="pending"`, `accepted=false`.
- Produces: `logs/video-quality-one-take/contact-sheets/segment_001.png` through `segment_006.png`, using frames 0, 8, and 16.

- [ ] **Step 1: Replace the old runner source contract with a failing gated-run contract**

Update `scripts/check-wan-one-take-runner.mjs` to retain exact initial-frame, hash, retry, preset, human-only and media checks, and add these assertions:

```js
assert.match(source, /const generateSegment = Number\(valueAfter\("--generate-segment"\)\);/);
assert.match(source, /if \(!Number\.isInteger\(generateSegment\) \|\| generateSegment < 1 \|\| generateSegment > 6\)/);
assert.doesNotMatch(source, /for \(const segment of segments\)/);
assert.match(source, /const segment = segments\[generateSegment - 1\];/);
assert.match(source, /assertAcceptedPrefix\(\{/);
assert.match(source, /markTechnicalAccepted\(segmentReport, item\)/);
assert.match(source, /createSegmentContactSheet\(videoPath, contactSheetPath\)/);
assert.match(source, /report\.overallAccepted = false/);
assert.equal((source.match(/Exactly two human characters/g) || []).length, 6);
assert.match(source, /extremely slow continuous forward camera push/);
assert.match(source, /synchronized gestures, both characters raising hands/);
```

- [ ] **Step 2: Run the runner contract and verify RED**

Run: `node scripts/check-wan-one-take-runner.mjs`

Expected: FAIL because the current runner still supports an automatic multi-segment loop and immediate assembly.

- [ ] **Step 3: Replace motion prompts with the approved six single-action beats**

Use these exact prompts in `motionPrompts`:

```js
const motionPrompts = [
  "Continue as one uninterrupted take. Extremely slow continuous forward camera push. Shen Yan makes one clearly visible small half-step forward with grounded foot contact while Jiang Lan performs only a subtle natural weight shift. Exactly two human characters: Shen Yan and Jiang Lan. One primary action once, then settle toward a natural pose. Preserve exact faces, hair, outfits and screen sides.",
  "Continue the exact same take and the same extremely slow forward camera push. Jiang Lan only turns her head toward Shen Yan and makes subtle natural speaking motion; both bodies stay on the same screen sides with grounded feet. Exactly two human characters. One primary action once, then settle naturally.",
  "Continue without a cut with the same extremely slow forward push. Jiang Lan makes one small single-hand explanatory gesture and then lowers that hand toward a relaxed position. Shen Yan only watches. Exactly two human characters; no synchronized gesture.",
  "Continue the same take and camera motion. Only Shen Yan raises his right hand once in a restrained warning gesture and begins lowering it. Jiang Lan keeps both hands relaxed and reacts only with her face and head. Exactly two human characters; no mirrored or synchronized gesture.",
  "Continue the uninterrupted extremely slow forward push. Shen Yan and Jiang Lan each take one clear small grounded step forward, with hands lowered and slight natural arm swing. Preserve exact identities, outfits, screen sides and human anatomy. Exactly two human characters. One walking action once, then settle.",
  "Continue to the end of the same take. Both characters naturally stop and plant their feet. Jiang Lan only looks toward the water while Shen Yan calmly scans the surroundings; both hands remain lowered. The extremely slow forward push eases into a stable final composition. Exactly two human characters."
];
```

Replace `negativePrompt` with the prior identity/anatomy negatives plus:

```text
both hands raised, arms held overhead, synchronized gestures, both characters raising hands, mirrored action, repeated gesture, gesture loop, prolonged held gesture, frozen pose, static pose, no visible motion, motionless body, sudden camera motion, fast push-in
```

- [ ] **Step 4: Implement explicit single-segment mode**

Add `valueAfter(flag)` and require `--generate-segment 1..6`. Remove the default automatic full-chain path. Use this control flow:

```js
const generateSegment = Number(valueAfter("--generate-segment"));
const seedOffset = Number(valueAfter("--seed-offset") || 0);
if (!Number.isInteger(generateSegment) || generateSegment < 1 || generateSegment > 6) {
  throw new Error("--generate-segment must be an integer from 1 to 6");
}
if (!Number.isInteger(seedOffset) || seedOffset < 0) throw new Error("--seed-offset must be a non-negative integer");

const segments = buildOneTakeSegments({ initialFramePath, prompts: motionPrompts, baseSeed: 26081010 });
const segment = segments[generateSegment - 1];
let report;
let preservedSegments = [];
if (generateSegment === 1) {
  if (existsSync(reportPath)) createRecoverySnapshot();
  report = { schemaVersion: 2, startedAt: new Date().toISOString(), segments: [], overallAccepted: false };
} else {
  if (!existsSync(reportPath)) throw new Error(`cannot generate segment ${generateSegment} without a report`);
  createRecoverySnapshot();
  report = JSON.parse(readFileSync(reportPath, "utf8"));
  preservedSegments = report.segments.slice(0, generateSegment - 1);
  assertAcceptedPrefix({
    segments: preservedSegments,
    expectedCount: generateSegment - 1,
    initialFrameHash: sha256(readFileSync(initialFramePath)),
    hashFile: (path) => sha256(readFileSync(path))
  });
  report.segments = preservedSegments;
  report.overallAccepted = false;
  delete report.assembly;
  delete report.finalAcceptance;
}
```

Generate only `segment`. Do not append it to the accepted prefix until the media and contact-sheet gates in Step 5 succeed.

- [ ] **Step 5: Generate the current segment contact sheet before returning**

Add:

```js
function createSegmentContactSheet(videoPath, outputPath) {
  mkdirSync(resolve(reportDir, "contact-sheets"), { recursive: true });
  runFfmpeg([
    "-y", "-v", "error", "-i", videoPath,
    "-vf", "select=eq(n\\,0)+eq(n\\,8)+eq(n\\,16),scale=416:240,tile=3x1",
    "-frames:v", "1", outputPath
  ]);
}
```

After final-frame extraction:

```js
const segmentMetadata = probeVideo(videoPath);
assertVideoMetadata(segmentMetadata, {
  label: `${segment.id} output`,
  codecName: "h264",
  width: 832,
  height: 480,
  fps: 16,
  minDuration: 1.0,
  maxDuration: 1.2
});
if (Number(segmentMetadata.nb_frames) !== 17) {
  throw new Error(`${segment.id} frame count must be 17: ${segmentMetadata.nb_frames}`);
}
const contactSheetPath = resolve(reportDir, "contact-sheets", `${segment.id}.png`);
createSegmentContactSheet(videoPath, contactSheetPath);
item.contactSheetPath = contactSheetPath;
item.videoMetadata = segmentMetadata;
```

When building the technically accepted segment, store both evidence fields explicitly:

```js
const technicallyAccepted = {
  ...markTechnicalAccepted(segmentReport, item),
  attempts: segmentReport.attempts,
  contactSheetPath,
  videoMetadata: segmentMetadata
};
report.segments = [...preservedSegments, technicallyAccepted];
report.technicalAcceptedSegments = report.segments.filter((entry) => entry.technicalAccepted).length;
report.acceptedSegments = report.segments.filter((entry) => entry.accepted).length;
report.overallAccepted = false;
```

Print the real runtime path:

```js
console.log(`Segment ${generateSegment} technically accepted; creative review is pending: ${contactSheetPath}`);
```

- [ ] **Step 6: Run focused contracts**

Run:

```powershell
node --check scripts/run-wan-one-take-chain.mjs
node scripts/check-wan-one-take-runner.mjs
node scripts/check-wan-one-take-acceptance.mjs
node scripts/check-wan-i2v-production-preset.mjs
node scripts/check-comfy-save-video-output.mjs
```

Expected: syntax exits 0 and all four checks print `PASS`.

---

### Task 4: Assembly and final-acceptance gate

**Files:**
- Modify: `scripts/run-wan-one-take-chain.mjs`
- Modify: `scripts/check-wan-one-take-assembly.mjs`
- Modify: `scripts/check-review-wan-one-take.mjs`
- Reuse: `scripts/lib/wan-one-take-acceptance.mjs`

**Interfaces:**
- Consumes: Task 1 `assertAcceptedPrefix`, `canAssemble`, and Task 2 final review mode.
- Produces CLI mode: `--assemble`.
- Produces: native/delivery media with `finalAcceptance.status="pending"` and `overallAccepted=false`.
- Produces: five boundary sheets and one 97-frame contact sheet.
- Final review CLI is the only path that may set `overallAccepted=true`.

- [ ] **Step 1: Write failing assembly/final-gate assertions**

Extend `scripts/check-wan-one-take-assembly.mjs`:

```js
assert.match(source, /const assembleMode = process\.argv\.includes\("--assemble"\);/);
assert.match(source, /if \(!canAssemble\(report\.segments\)\) throw new Error\("six technically and creatively accepted segments are required"\)/);
assert.match(source, /assertAcceptedPrefix\(\{/);
assert.match(source, /finalAcceptance: \{ status: "pending" \}/);
assert.match(source, /overallAccepted: false/);
assert.match(source, /createBoundarySheets\(report\.segments/);
assert.match(source, /createFullContactSheet\(nativePath/);
assert.doesNotMatch(source, /overallAccepted: true/);
assert.doesNotMatch(source, /xfade=transition/);
```

- [ ] **Step 2: Run the assembly check and verify RED**

Run: `node scripts/check-wan-one-take-assembly.mjs`

Expected: FAIL because the current assembly is still coupled to automatic full generation and lacks pending final acceptance.

- [ ] **Step 3: Add an explicit assembly mode**

At startup, distinguish exactly one mode:

```js
const assembleMode = process.argv.includes("--assemble");
const hasGenerateMode = process.argv.includes("--generate-segment");
if (Number(assembleMode) + Number(hasGenerateMode) !== 1) {
  throw new Error("choose exactly one mode: --generate-segment 1..6 or --assemble");
}
```

Assembly mode reads the report, verifies the full accepted prefix, and uses the existing no-transition filter:

```js
if (!canAssemble(report.segments)) throw new Error("six technically and creatively accepted segments are required");
assertAcceptedPrefix({
  segments: report.segments,
  expectedCount: 6,
  initialFrameHash: sha256(readFileSync(initialFramePath)),
  hashFile: (path) => sha256(readFileSync(path))
});
```

Retain the existing 97-frame native and 24 FPS delivery FFmpeg/FFprobe guards. After both files pass:

```js
report.assembly = {
  nativePath,
  deliveryPath,
  nativeMetadata,
  deliveryMetadata,
  nativeFrameCount,
  expectedNativeFrameCount: assembly.nativeFrameCount
};
report.finalAcceptance = { status: "pending" };
report.overallAccepted = false;
```

- [ ] **Step 4: Generate final visual evidence in assembly mode**

Implement `createBoundarySheets(segments, directory)` to create five 2-cell images from previous frame 16 and next frame 0, and `createFullContactSheet(nativePath, outputPath)` to tile all 97 frames:

```js
function createBoundarySheets(segments, directory) {
  mkdirSync(directory, { recursive: true });
  const paths = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    const outputPath = resolve(
      directory,
      `boundary_${String(index + 1).padStart(3, "0")}_${String(index + 2).padStart(3, "0")}.png`
    );
    runFfmpeg([
      "-y", "-v", "error",
      "-i", segments[index].videoPath,
      "-i", segments[index + 1].videoPath,
      "-filter_complex",
      "[0:v]select=eq(n\\,16),scale=416:240,setpts=PTS-STARTPTS[left];[1:v]select=eq(n\\,0),scale=416:240,setpts=PTS-STARTPTS[right];[left][right]hstack=inputs=2[outv]",
      "-map", "[outv]", "-frames:v", "1", outputPath
    ]);
    paths.push(outputPath);
  }
  return paths;
}

function createFullContactSheet(nativePath, outputPath) {
  runFfmpeg([
    "-y", "-v", "error", "-i", nativePath,
    "-vf", "scale=158:92,tile=10x10:padding=1:margin=1",
    "-frames:v", "1", outputPath
  ]);
}
```

Store:

```js
report.assembly.evidence = {
  fullContactSheetPath,
  boundarySheetPaths
};
```

Use fixed paths under `logs/video-quality-one-take/contact-sheets/` so the review CLI can record them.

- [ ] **Step 5: Ensure final review is the only overall acceptance path**

Keep Task 2 `--final-decision` mode. Extend `scripts/check-review-wan-one-take.mjs` with this complete final-review check after the segment-review assertions:

```js
const acceptedSegments = Array.from({ length: 6 }, (_, index) => ({
  id: `segment_${String(index + 1).padStart(3, "0")}`,
  order: index + 1,
  technicalAccepted: true,
  creativeAcceptance: { status: "accepted" },
  accepted: true
}));
writeFileSync(reportPath, JSON.stringify({
  segments: acceptedSegments,
  assembly: { nativePath: "native.mp4", deliveryPath: "delivery.mp4" },
  finalAcceptance: { status: "pending" },
  overallAccepted: false
}));

const finalAcceptedResult = spawnSync(process.execPath, [
  "scripts/review-wan-one-take.mjs",
  "--report", reportPath,
  "--final-decision", "accepted",
  "--note", "all six actions, identities and boundaries pass",
  "--evidence", evidencePath
], { encoding: "utf8", windowsHide: true });
assert.equal(finalAcceptedResult.status, 0, finalAcceptedResult.stderr);
assert.equal(JSON.parse(readFileSync(reportPath, "utf8")).overallAccepted, true);

const finalRejectedResult = spawnSync(process.execPath, [
  "scripts/review-wan-one-take.mjs",
  "--report", reportPath,
  "--final-decision", "rejected",
  "--note", "motion freezes before the final beat",
  "--evidence", evidencePath
], { encoding: "utf8", windowsHide: true });
assert.equal(finalRejectedResult.status, 0, finalRejectedResult.stderr);
assert.equal(JSON.parse(readFileSync(reportPath, "utf8")).overallAccepted, false);
```

- [ ] **Step 6: Run all non-live contracts and build**

Run:

```powershell
node --check scripts/run-wan-one-take-chain.mjs
node scripts/check-wan-one-take-chain.mjs
node scripts/check-wan-one-take-acceptance.mjs
node scripts/check-review-wan-one-take.mjs
node scripts/check-wan-one-take-runner.mjs
node scripts/check-wan-one-take-assembly.mjs
node scripts/check-wan-i2v-production-preset.mjs
npm.cmd run build
```

Expected: every Node check prints `PASS`; Vite reports `✓ built` with only the existing chunk-size warning allowed.

---

### Task 5: Live identity-first six-segment acceptance run

**Files:**
- Generate/modify: `logs/video-quality-one-take/wan-one-take-report.json`
- Generate: `logs/video-quality-one-take/river_one_take_native16.mp4`
- Generate: `logs/video-quality-one-take/river_one_take_delivery24.mp4`
- Generate: `logs/video-quality-one-take/contact-sheets/segment_001.png` through `segment_006.png`
- Generate: `logs/video-quality-one-take/contact-sheets/boundary_001_002.png` through `boundary_005_006.png`
- Generate: `logs/video-quality-one-take/contact-sheets/one_take_97_frames.png`
- Generate: `.superpowers/sdd/one-take-motion-remediation-live-report.md`

**Interfaces:**
- Consumes: running ComfyUI at `http://127.0.0.1:8188` and Tasks 1–4.
- Produces: a final report whose six segments have both acceptance gates and whose `overallAccepted` truthfully reflects final visual review.

- [ ] **Step 1: Preflight without generating media**

Verify ComfyUI, initial frame, FFmpeg, and contracts:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8188/system_stats' -TimeoutSec 10
Test-Path -LiteralPath 'C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Shared\output\Storyboard\河边远景建立_klein_ref_00006_.png'
ffmpeg -version
ffprobe -version
node scripts/check-wan-one-take-acceptance.mjs
node scripts/check-review-wan-one-take.mjs
node scripts/check-wan-one-take-runner.mjs
node scripts/check-wan-one-take-assembly.mjs
```

Expected: HTTP 200, frame path `True`, tools available, all checks `PASS`.

- [ ] **Step 2: Generate and judge segment 1 before any later segment**

Candidate 1:

```powershell
node scripts/run-wan-one-take-chain.mjs --generate-segment 1 --seed-offset 0
```

Open `contact-sheets/segment_001.png`. Accept only if Shen Yan makes a visible grounded half-step, the camera pushes forward extremely slowly, both identities remain stable, and Jiang Lan does not mirror the step or raise both hands.

If accepted:

```powershell
node scripts/review-wan-one-take.mjs --segment 1 --decision accepted --note "visible grounded half-step, identity stable, slow push continuous" --evidence logs/video-quality-one-take/contact-sheets/segment_001.png
```

If rejected, record rejection with the actual reason, then retry offsets `1000` and `2000`. Stop after the third rejected candidate; do not generate segment 2.

- [ ] **Step 3: Generate and judge segments 2–6 serially**

Run these commands one at a time. After each command, stop for its creative review; do not queue the next line until the current segment is accepted:

```powershell
node scripts/run-wan-one-take-chain.mjs --generate-segment 2 --seed-offset 0
node scripts/run-wan-one-take-chain.mjs --generate-segment 3 --seed-offset 0
node scripts/run-wan-one-take-chain.mjs --generate-segment 4 --seed-offset 0
node scripts/run-wan-one-take-chain.mjs --generate-segment 5 --seed-offset 0
node scripts/run-wan-one-take-chain.mjs --generate-segment 6 --seed-offset 0
```

Inspect the matching `contact-sheets/segment_002.png` through `segment_006.png` for the exact approved beat, identity, human species, screen sides, natural pose recovery, and continued extremely slow push. Record acceptance or rejection using the review CLI. If a segment is rejected, rerun only that same segment with seed offset `1000`; if rejected again, use `2000`; never proceed while status is pending/rejected.

Accepted review commands are:

```powershell
node scripts/review-wan-one-take.mjs --segment 2 --decision accepted --note "Jiang Lan turns and speaks once; identity, sides and slow push pass" --evidence logs/video-quality-one-take/contact-sheets/segment_002.png
node scripts/review-wan-one-take.mjs --segment 3 --decision accepted --note "Jiang Lan makes and lowers one single-hand gesture; Shen Yan does not mirror" --evidence logs/video-quality-one-take/contact-sheets/segment_003.png
node scripts/review-wan-one-take.mjs --segment 4 --decision accepted --note "only Shen Yan makes one restrained right-hand warning gesture and begins lowering it" --evidence logs/video-quality-one-take/contact-sheets/segment_004.png
node scripts/review-wan-one-take.mjs --segment 5 --decision accepted --note "both take one grounded small step with lowered hands and stable identities" --evidence logs/video-quality-one-take/contact-sheets/segment_005.png
node scripts/review-wan-one-take.mjs --segment 6 --decision accepted --note "both stop naturally with lowered hands and the slow push reaches a stable end" --evidence logs/video-quality-one-take/contact-sheets/segment_006.png
```

Beat-specific acceptance:

- Segment 2: only Jiang Lan turns/speaks; no body swap or hand raise.
- Segment 3: Jiang Lan makes one small single-hand gesture and lowers it; Shen Yan does not mirror it.
- Segment 4: only Shen Yan raises the right hand once and starts lowering it; Jiang Lan keeps hands relaxed.
- Segment 5: both take one small grounded step with lowered hands and natural arm swing.
- Segment 6: both stop; Jiang Lan looks at water, Shen Yan scans; both hands remain lowered and the push eases to a stable end.

- [ ] **Step 4: Assemble only after all six segment reviews pass**

Run:

```powershell
node scripts/run-wan-one-take-chain.mjs --assemble
```

Expected: native/delivery media are generated, `finalAcceptance.status` is `pending`, and `overallAccepted` remains `false`.

- [ ] **Step 5: Perform final visual and lineage review**

Inspect all six segment sheets, five boundary sheets, and the 97-frame sheet. Verify:

- every intended action beat is visible and happens once;
- no extended frozen interval or synchronized raised-hand pose;
- exactly two human characters in every sampled frame;
- stable faces, hair, outfits, body shape, screen sides, camera direction and environment;
- no black frame, severe color block, duplicated frame at boundaries, or one-frame composition jump;
- report segment `N` input SHA-256 equals segment `N-1` final-frame SHA-256.

If final review passes:

```powershell
node scripts/review-wan-one-take.mjs --final-decision accepted --note "six action beats, identities, slow push, hashes and five boundaries pass" --evidence logs/video-quality-one-take/contact-sheets/one_take_97_frames.png
```

If any final criterion fails, use `--final-decision rejected` with the exact reason and do not present the delivery as accepted.

- [ ] **Step 6: Verify final media, report semantics, and production build**

Assert:

```js
assert.equal(report.segments.length, 6);
assert.ok(report.segments.every((segment) => segment.technicalAccepted));
assert.ok(report.segments.every((segment) => segment.creativeAcceptance.status === "accepted"));
assert.ok(report.segments.every((segment) => segment.accepted));
assert.equal(report.overallAccepted, true);
for (let index = 1; index < 6; index += 1) {
  assert.equal(report.segments[index].inputSha256, report.segments[index - 1].finalFrameSha256);
}
```

Run FFprobe. Expected native: H.264, 832×480, 16 FPS, 97 frames, about 6.0625 seconds. Expected delivery: H.264, 832×480, 24 FPS, about six seconds.

Run the full non-live command list from Task 4 Step 6. Record commands, media metadata, seeds, Prompt IDs, hashes, per-segment visual decisions, retry reasons, and final decision in `.superpowers/sdd/one-take-motion-remediation-live-report.md`.

## Self-Review

- Spec coverage: Tasks 1–4 implement independent technical/creative state, atomic reviews, one-segment queuing, rejected-prefix blocking, final assembly gating, evidence generation, and truthful overall acceptance. Task 5 performs the required live generation and visual/media audit.
- Placeholder scan: clean; no unfinished markers, deferred implementation, undefined interface, or cross-task shorthand remains.
- Interface consistency: `markTechnicalAccepted`, `applyCreativeReview`, `assertAcceptedPrefix`, `canAssemble`, and `applyFinalReview` are defined once in Task 1 and consumed under identical names in later tasks.
- Scope: model replacement, longer clips, dialogue lip-sync, audio, FaceDetailer, RIFE installation, multi-person layering, and new storyboard images remain excluded.
- Safety: every generation command produces only one candidate; no rejected or pending segment can seed the next; assembly and overall acceptance are separate explicit modes.
- Git: commit steps are intentionally omitted because this plan continues in the user-authorized shared dirty `main` workspace with overlapping uncommitted assets and scripts.
