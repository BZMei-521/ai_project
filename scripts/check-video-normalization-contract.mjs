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
  stage_video_segment: {
    stagedPath: "C:\\project\\assets\\video-staging\\stage-a.mp4",
    projectAssetsDir: "C:\\project\\assets",
    stagingReceiptId: "c".repeat(64)
  },
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
      hasMonotonicTimestamps: true,
      hasConstantFrameTimestamps: true,
      decodedFrameCount: 24
    },
    anomalies: { blackIntervals: [], freezeIntervals: [] }
  },
  normalize_video_segment: {
    credential: {
      schemaVersion: 1,
      receiptId: "f".repeat(64),
      normalizedPath: "C:\\project\\assets\\video-normalized\\shot-1.mp4",
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
  },
  cleanup_video_assembly_assets: null,
  gc_video_continuity_assets: { receiptsRemoved: 2, assetsRemoved: 8 }
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

const rustMainPath = path.join(repoRoot, "src-tauri/src/main.rs");
const rustMainSource = fs.readFileSync(rustMainPath, "utf8");
for (const functionName of ["write_base64_file", "copy_file_to"]) {
  const match = rustMainSource.match(new RegExp(`fn ${functionName}\\([\\s\\S]*?\\n\\}`));
  assert.ok(match, `${functionName} command must remain registered production code`);
  const guardCalls = match[0].match(/reject_authority_file_command_path/g) ?? [];
  assert.equal(guardCalls.length, functionName === "copy_file_to" ? 2 : 1, `${functionName} must guard every authority source/target`);
}

function loadIsolatedConcatShotVideos(options = {}) {
  const servicePath = path.join(repoRoot, "src/modules/comfy-pipeline/comfyService.ts");
  const serviceSource = fs.readFileSync(servicePath, "utf8");
  const sourceFile = ts.createSourceFile(servicePath, serviceSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = sourceFile.statements.find((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "concatShotVideos"
  );
  assert.ok(declaration, "real production concatShotVideos function must exist");
  const transpiled = ts.transpileModule(declaration.getText(sourceFile), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true
  });
  const state = { stage: [], normalize: [], review: [], concat: [], cleanup: [], legacy: [] };
  const dependencies = {
    isTauriRuntime: () => true,
    stageVideoSegment: async (request) => {
      state.stage.push(structuredClone(request));
      return {
        stagedPath: `C:\\project\\assets\\video-staging\\stage-${state.stage.length}.mp4`,
        projectAssetsDir,
        stagingReceiptId: String(state.stage.length).repeat(64)
      };
    },
    normalizeVideoSegment: async (request) => {
      state.normalize.push(structuredClone(request));
      if (state.normalize.length === options.failNormalizeAt) throw new Error("injected_second_segment_failure");
      return {
        credential: { ...credential, normalizedPath: `C:\\project\\assets\\video-normalized\\${request.segmentId}.mp4` },
        probe: credential.probe,
        anomalies: { blackIntervals: [], freezeIntervals: [] }
      };
    },
    extractVideoReviewFrames: async (request) => {
      state.review.push(structuredClone(request));
      return { firstFramePath: "first.png", middleFramePath: "middle.png", lastFramePath: "last.png" };
    },
    concatNormalizedVideoSegments: async (request) => {
      state.concat.push(structuredClone(request));
      return { outputPath: "C:\\project\\assets\\video-assembled\\final.mp4", probe: credential.probe };
    },
    cleanupVideoAssemblyAssets: async (request) => {
      state.cleanup.push(structuredClone(request));
    },
    invokeDesktop: async (command, args) => {
      state.legacy.push({ command, args });
      return { outputPath: "legacy.mp4" };
    }
  };
  const names = Object.keys(dependencies);
  const factory = new Function(...names, `${transpiled.outputText.replace(/\bexport\s+/g, "")}\nreturn concatShotVideos;`);
  return { concatShotVideos: factory(...Object.values(dependencies)), state };
}

function loadPanelConcatHandler() {
  const panelPath = path.join(repoRoot, "src/modules/comfy-pipeline/ComfyPipelinePanel.tsx");
  const panelSource = fs.readFileSync(panelPath, "utf8");
  const sourceFile = ts.createSourceFile(panelPath, panelSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === "onConcatVideos") declaration = node;
    if (!declaration) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(declaration?.initializer, "real Panel onConcatVideos handler must exist");
  const transpiled = ts.transpileModule(`const onConcatVideos = ${declaration.initializer.getText(sourceFile)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true
  });
  const captured = [];
  const dependencies = {
    getScopedShotsSnapshot: () => [{ id: "shot-1", generatedVideoPath: "C:\\ComfyUI\\output\\shot-1.mp4", durationFrames: 24 }],
    looksLikeVideoPath: () => true,
    appendLog: () => {},
    setPipelineState: () => {},
    pushToast: () => {},
    settings: { outputDir: "C:\\ComfyUI\\output" },
    project: { width: 1280, height: 720, fps: 24 },
    concatShotVideos: async (request) => { captured.push(structuredClone(request)); return null; }
  };
  const names = Object.keys(dependencies);
  const factory = new Function(...names, `${transpiled.outputText}\nreturn onConcatVideos;`);
  return { onConcatVideos: factory(...Object.values(dependencies)), captured };
}

const projectAssetsDir = "C:\\project\\assets";
const inputPath = "C:\\project\\assets\\raw\\shot-1.mp4";
const credential = {
  schemaVersion: 1,
  receiptId: "a".repeat(64),
  normalizedPath: "C:\\project\\assets\\video-normalized\\shot-1.mp4",
  sha256: "a".repeat(64),
  byteLength: 100,
  modifiedUnixMillis: 1,
  projectWidth: 1280,
  projectHeight: 720,
  durationFrames: 24,
  probe: representative.probe_video_segment.probe
};

assert.equal(typeof bridge.probeVideoSegment, "function");
assert.equal(typeof bridge.stageVideoSegment, "function");
assert.equal(typeof bridge.normalizeVideoSegment, "function");
assert.equal(typeof bridge.extractVideoReviewFrames, "function");
assert.equal(typeof bridge.concatNormalizedVideoSegments, "function");
assert.equal(typeof bridge.cleanupVideoAssemblyAssets, "function");
assert.equal(typeof bridge.gcVideoContinuityAssets, "function");

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
    segments: [{ ...credential, receiptId: "" }]
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
      receiptId: "b".repeat(64),
      normalizedPath: "C:\\project\\assets\\video-normalized\\shot-2.mp4",
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
assert.deepEqual(await bridge.stageVideoSegment({ inputPath: "C:\\ComfyUI\\output\\shot-1.mp4" }), representative.stage_video_segment);
assert.deepEqual(calls.at(-1), {
  command: "stage_video_segment",
  args: { inputPath: "C:\\ComfyUI\\output\\shot-1.mp4" }
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
const stagedSegment = {
  stagedPath: "C:\\project\\assets\\video-staging\\stage-" + "c".repeat(64) + ".media",
  projectAssetsDir,
  stagingReceiptId: "c".repeat(64)
};
const reviewFrames = representative.extract_video_review_frames;
await bridge.cleanupVideoAssemblyAssets({ projectAssetsDir, stagedSegments: [stagedSegment], credentials: [credential], reviewFrames: [reviewFrames] });
assert.deepEqual(calls.at(-1), {
  command: "cleanup_video_assembly_assets",
  args: { projectAssetsDir, stagedSegments: [stagedSegment], credentials: [credential], reviewFrames: [reviewFrames] }
});
assert.deepEqual(await bridge.gcVideoContinuityAssets(projectAssetsDir, 3600), representative.gc_video_continuity_assets);
assert.deepEqual(calls.at(-1), { command: "gc_video_continuity_assets", args: { projectAssetsDir, ttlSeconds: 3600 } });

const production = loadIsolatedConcatShotVideos();
const productionResult = await production.concatShotVideos({
  projectWidth: 1280,
  projectHeight: 720,
  segments: [
    { inputPath, segmentId: "shot-1", durationFrames: 24 },
    { inputPath: "C:\\project\\assets\\raw\\shot-2.mp4", segmentId: "shot-2", durationFrames: 48 }
  ]
});
assert.equal(productionResult, "C:\\project\\assets\\video-assembled\\final.mp4");
assert.equal(production.state.stage.length, 2, "every external H3/Comfy source must be staged by the backend first");
assert.ok(production.state.normalize.every((request, index) => request.inputPath === `C:\\project\\assets\\video-staging\\stage-${index + 1}.mp4`));
assert.equal(production.state.legacy.length, 0, "new production assembly must never call concat_video_segments");
assert.equal(production.state.normalize.length, 2, "every production segment must be normalized");
assert.equal(production.state.review.length, 2, "every production segment must extract review frames from its credential");
assert.equal(production.state.concat.length, 1);
assert.deepEqual(
  production.state.concat[0].segments,
  production.state.review.map((call) => call.credential),
  "concat and review must receive the exact backend-issued credentials"
);
assert.equal(await production.concatShotVideos({
  projectWidth: 1280,
  projectHeight: 720,
  segments: [
    { inputPath, segmentId: "shot-1", durationFrames: 24 },
    { inputPath: "C:\\project\\assets\\raw\\shot-2.mp4", segmentId: "shot-2", durationFrames: 48 }
  ]
}), "C:\\project\\assets\\video-assembled\\final.mp4");
assert.equal(production.state.stage.length, 4, "repeated production click must start a fresh nonce-staged run");
assert.equal(production.state.cleanup.length, 2, "successful runs must each clean only their own intermediates");

const panel = loadPanelConcatHandler();
assert.equal(await panel.onConcatVideos(), false);
assert.equal(panel.captured.length, 1, "the real Panel concat handler must call the production orchestrator");
assert.equal("projectAssetsDir" in panel.captured[0], false, "Panel must not manufacture a project asset root from Comfy output");
assert.equal(JSON.stringify(panel.captured[0]).includes(".storyboard-cache"), false);

const failedProduction = loadIsolatedConcatShotVideos({ failNormalizeAt: 2 });
await assert.rejects(
  () => failedProduction.concatShotVideos({
    projectWidth: 1280,
    projectHeight: 720,
    segments: [
      { inputPath, segmentId: "shot-1", durationFrames: 24 },
      { inputPath: "C:\\ComfyUI\\output\\shot-2.mp4", segmentId: "shot-2", durationFrames: 24 }
    ]
  }),
  /injected_second_segment_failure/
);
assert.equal(failedProduction.state.cleanup.length, 1, "second-segment failure must compensate this run exactly once");
assert.equal(failedProduction.state.cleanup[0].stagedSegments.length, 2);
assert.equal(failedProduction.state.cleanup[0].credentials.length, 1);

function loadWindowsWebInvokeCommand() {
  const serverPath = path.join(repoRoot, "scripts/windows-web-server.mjs");
  const serverSource = fs.readFileSync(serverPath, "utf8");
  const sourceFile = ts.createSourceFile(serverPath, serverSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declaration = sourceFile.statements.find((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "invokeCommand"
  );
  assert.ok(declaration, "Windows Web must expose its real invokeCommand dispatcher to the contract");
  return new Function(`${declaration.getText(sourceFile)}\nreturn invokeCommand;`)();
}

const windowsInvokeCommand = loadWindowsWebInvokeCommand();
for (const command of [
  "probe_video_segment",
  "stage_video_segment",
  "normalize_video_segment",
  "extract_video_review_frames",
  "concat_normalized_video_segments",
  "cleanup_video_assembly_assets",
  "gc_video_continuity_assets"
]) {
  await assert.rejects(
    () => windowsInvokeCommand(command, {}),
    /video_normalization_requires_tauri_runtime/,
    `Windows Web invokeCommand must explicitly and safely block ${command}`
  );
}

const webModule = { exports: {} };
globalThis.window = {
  __STORYBOARD_WEB_BRIDGE__: true,
  location: { hostname: "127.0.0.1", port: "3210" }
};
new Function("require", "module", "exports", compiled.outputText)(
  (specifier) => {
    if (specifier !== "@tauri-apps/api/core") throw new Error(`unexpected require: ${specifier}`);
    return { convertFileSrc: (value) => value, isTauri: () => false, invoke: async () => assert.fail("Tauri invoke unavailable") };
  },
  webModule,
  webModule.exports
);
await assert.rejects(
  () => webModule.exports.probeVideoSegment({ inputPath, projectAssetsDir }),
  /video_normalization_requires_tauri_runtime/,
  "Windows Web frontend wrapper must block before fetch/dispatch"
);
delete globalThis.window;

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
