import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const bridgePath = path.join(repoRoot, "src/modules/platform/desktopBridge.ts");
const source = fs.readFileSync(bridgePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  },
  fileName: bridgePath,
  reportDiagnostics: true
});
assert.deepEqual(compiled.diagnostics ?? [], [], "desktop bridge must transpile cleanly");

const representative = {
  probe_video_segment: {
    probe: {
      width: 1280,
      height: 720,
      fpsNum: 24,
      fpsDen: 1,
      durationSeconds: 1,
      videoCodec: "h264",
      pixelFormat: "yuv420p",
      audioSampleRate: 48000,
      audioChannels: 2,
      hasMonotonicTimestamps: true
    },
    anomalies: { blackIntervals: [], freezeIntervals: [] }
  },
  normalize_video_segment: {
    credential: {
      schemaVersion: 1,
      normalizedPath: "C:\\project\\assets\\video-normalized\\shot-1.mp4",
      receiptPath: "C:\\project\\assets\\video-normalized\\shot-1.normalized.json",
      sha256: "a".repeat(64),
      byteLength: 100,
      modifiedUnixMillis: 1,
      projectWidth: 1280,
      projectHeight: 720,
      durationFrames: 24,
      probe: null
    },
    probe: null,
    anomalies: { blackIntervals: [], freezeIntervals: [] }
  },
  extract_video_review_frames: {
    firstFramePath: "C:\\project\\assets\\video-review\\first.png",
    middleFramePath: "C:\\project\\assets\\video-review\\middle.png",
    lastFramePath: "C:\\project\\assets\\video-review\\last.png"
  },
  concat_normalized_video_segments: {
    outputPath: "C:\\project\\assets\\video-assembled\\assembled.mp4",
    probe: null
  }
};

const calls = [];
const module = { exports: {} };
const requireStub = (specifier) => {
  if (specifier === "@tauri-apps/api/core") {
    return {
      convertFileSrc: (value) => value,
      isTauri: () => true,
      invoke: async (command, args) => {
        calls.push({ command, args });
        return structuredClone(representative[command]);
      }
    };
  }
  throw new Error(`unexpected require: ${specifier}`);
};
new Function("require", "module", "exports", compiled.outputText)(
  requireStub,
  module,
  module.exports
);
const bridge = module.exports;

const projectAssetsDir = "C:\\project\\assets";
const inputPath = "C:\\project\\assets\\raw\\shot-1.mp4";
const credential = {
  schemaVersion: 1,
  normalizedPath: "C:\\project\\assets\\video-normalized\\shot-1.mp4",
  receiptPath: "C:\\project\\assets\\video-normalized\\shot-1.normalized.json",
  sha256: "a".repeat(64),
  byteLength: 100,
  modifiedUnixMillis: 1,
  projectWidth: 1280,
  projectHeight: 720,
  durationFrames: 24,
  probe: representative.probe_video_segment.probe
};

assert.equal(typeof bridge.probeVideoSegment, "function");
assert.equal(typeof bridge.normalizeVideoSegment, "function");
assert.equal(typeof bridge.extractVideoReviewFrames, "function");
assert.equal(typeof bridge.concatNormalizedVideoSegments, "function");

assert.throws(
  () => bridge.createProbeVideoSegmentRequest({ inputPath: " ", projectAssetsDir }),
  /video_input_path_missing/
);
assert.throws(
  () => bridge.createNormalizeVideoSegmentRequest({
    inputPath: "relative.mp4",
    projectAssetsDir,
    segmentId: "shot-1",
    projectWidth: 1280,
    projectHeight: 720,
    durationFrames: 24
  }),
  /video_path_must_be_absolute/
);
assert.throws(
  () => bridge.createConcatNormalizedVideoSegmentsRequest({
    projectAssetsDir,
    segments: [{ ...credential, receiptPath: "" }]
  }),
  /normalization_credential_missing/
);
assert.throws(
  () => bridge.createConcatNormalizedVideoSegmentsRequest({
    projectAssetsDir,
    segments: [{ ...credential, probe: { ...credential.probe, fpsNum: 30 } }]
  }),
  /normalized_segment_fps_invalid/
);
assert.throws(
  () => bridge.createConcatNormalizedVideoSegmentsRequest({
    projectAssetsDir,
    segments: [credential, {
      ...credential,
      normalizedPath: "C:\\project\\assets\\video-normalized\\shot-2.mp4",
      receiptPath: "C:\\project\\assets\\video-normalized\\shot-2.normalized.json",
      projectWidth: 1920,
      probe: { ...credential.probe, width: 1920 }
    }]
  }),
  /normalized_segment_dimensions_mismatch/
);

assert.deepEqual(await bridge.probeVideoSegment({ inputPath, projectAssetsDir }), representative.probe_video_segment);
assert.deepEqual(calls.at(-1), {
  command: "probe_video_segment",
  args: { inputPath, projectAssetsDir }
});
assert.deepEqual(await bridge.normalizeVideoSegment({
  inputPath,
  projectAssetsDir,
  segmentId: "shot-1",
  projectWidth: 1280,
  projectHeight: 720,
  durationFrames: 24
}), representative.normalize_video_segment);
assert.deepEqual(calls.at(-1), {
  command: "normalize_video_segment",
  args: {
    inputPath,
    projectAssetsDir,
    segmentId: "shot-1",
    projectWidth: 1280,
    projectHeight: 720,
    durationFrames: 24
  }
});
assert.deepEqual(await bridge.extractVideoReviewFrames({ projectAssetsDir, credential }), representative.extract_video_review_frames);
assert.deepEqual(calls.at(-1), {
  command: "extract_video_review_frames",
  args: { projectAssetsDir, credential }
});
assert.deepEqual(await bridge.concatNormalizedVideoSegments({ projectAssetsDir, segments: [credential] }), representative.concat_normalized_video_segments);
assert.deepEqual(calls.at(-1), {
  command: "concat_normalized_video_segments",
  args: { projectAssetsDir, segments: [credential] }
});

const rust = spawnSync("cargo", [
  "test",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "video_continuity::tests",
  "--",
  "--nocapture"
], { cwd: repoRoot, encoding: "utf8" });
if (rust.status !== 0) {
  process.stderr.write(rust.stdout);
  process.stderr.write(rust.stderr);
  process.exit(rust.status ?? 1);
}

console.log("PASS video normalization contract");
