import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const sourcePath = path.join(root, "src/modules/video-production/videoGeneration.ts");
const preset = async (name) => JSON.parse(await readFile(path.join(
  root,
  "src/modules/comfy-pipeline/presets",
  name
), "utf8"));

async function loadExecutableRuntime() {
  const source = await readFile(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true
    },
    fileName: sourcePath,
    reportDiagnostics: true
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  assert.deepEqual(errors, [], "videoGeneration.ts must transpile without diagnostics");

  const runtimeDir = await mkdtemp(path.join(tmpdir(), "minimax-h3-binding-"));
  const runtimeSource = transpiled.outputText.replace(
    /(["'])\.\.\/comfy-pipeline\/comfyService\1/g,
    '"./comfyService.mjs"'
  );
  await writeFile(path.join(runtimeDir, "videoGeneration.mjs"), runtimeSource, "utf8");
  await writeFile(path.join(runtimeDir, "comfyService.mjs"), `
    export async function generateShotAsset(...args) {
      return globalThis.__MINIMAX_H3_EXECUTOR__(...args);
    }
  `, "utf8");
  const runtime = await import(`${new URL(`file:///${path.join(runtimeDir, "videoGeneration.mjs").replace(/\\/g, "/")}`).href}?v=${Date.now()}`);
  return { runtime, runtimeDir };
}

async function loadIsolatedGenerateShotAsset() {
  const source = await readFile(path.join(root, "src/modules/comfy-pipeline/comfyService.ts"), "utf8");
  const sourceFile = ts.createSourceFile("comfyService.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = new Map();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, statement.getText(sourceFile));
    }
  }
  const generateSource = declarations.get("generateShotAsset");
  assert.ok(generateSource, "generateShotAsset implementation must exist");
  const decisionSource = declarations.get("workflowConsumesVideoFrameTokens") ?? "";
  const transpiled = ts.transpileModule(`${decisionSource}\n${generateSource}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  assert.deepEqual(errors, [], "isolated generateShotAsset runtime must transpile");

  let stagedFrames = 0;
  const stopAfterStaging = new Error("stop_after_staging_probe");
  const dependencies = {
    inferAssetOutputContextFromShot: () => null,
    ensureWorkflowJson: (value) => JSON.parse(value),
    inspectWorkflowLipSyncSupportFromObject: () => null,
    inferPromptTokens: () => ({}),
    applyCharacterStyleContractForRequest: ({ tokens }) => tokens,
    stageVideoFrameTokens: async (_settings, _shot, tokens) => {
      stagedFrames += 1;
      return tokens;
    },
    fetchObjectInfo: async () => undefined,
    applyDynamicCharacterRefsForImageWorkflow: () => undefined,
    coerceWorkflowLiteralValues: (value) => value,
    deepReplaceTokens: (value) => value,
    applyFisherWorkflowBindings: () => undefined,
    queueComfyPrompt: async () => { throw stopAfterStaging; },
    isRequestTimeoutError: () => false,
    shouldFallbackToLocalVideo: () => false,
    readComfyServerLogTail: async () => ""
  };
  const names = Object.keys(dependencies);
  const values = Object.values(dependencies);
  const executableSource = transpiled.outputText.replace(/\bexport\s+/g, "");
  const factory = new Function(...names, `${executableSource}\nreturn generateShotAsset;`);
  const generateShotAsset = factory(...values);
  return async (workflow) => {
    stagedFrames = 0;
    await assert.rejects(
      () => generateShotAsset(
        { baseUrl: "http://isolated.invalid", videoGenerationMode: "workflow", videoWorkflowJson: "", tokenMapping: {} },
        { id: "probe", title: "probe" },
        0,
        "video",
        [],
        [],
        { workflowJsonOverride: JSON.stringify(workflow) }
      ),
      (error) => error === stopAfterStaging
    );
    return stagedFrames;
  };
}

const { runtime, runtimeDir } = await loadExecutableRuntime();
try {
  const {
    generateRoutedVideoShot,
    prepareH3VideoGeneration,
    secondsToH3Length,
    selectH3ReferenceImages
  } = runtime;

  assert.equal(secondsToH3Length(2), 124);
  assert.equal(secondsToH3Length(2.5), 124);
  assert.equal(secondsToH3Length(5), 124);
  assert.equal(secondsToH3Length(10), 243);
  assert.equal(secondsToH3Length(15), 362);
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => secondsToH3Length(invalid), /invalid_video_duration/);
  }
  assert.throws(() => secondsToH3Length(15.01), /h3_shot_too_long/);

  const observeFrameStaging = await loadIsolatedGenerateShotAsset();
  assert.equal(await observeFrameStaging(await preset("minimax-h3-t2v-v1.json")), 0,
    "H3 T2V must not invoke unrelated frame staging");
  assert.equal(await observeFrameStaging(await preset("minimax-h3-r2v-v1.json")), 0,
    "H3 R2V must not invoke unrelated frame staging");
  assert.equal(await observeFrameStaging(await preset("minimax-h3-i2v-v1.json")), 1,
    "H3 I2V must retain first-frame staging");
  assert.equal(await observeFrameStaging(await preset("minimax-h3-flf2v-v1.json")), 1,
    "H3 FLF2V must retain endpoint-frame staging");
  assert.equal(await observeFrameStaging({
    "1": { class_type: "LoadImage", inputs: { image: "{{FRAME_IMAGE_PATH}}" } },
    "2": { class_type: "WanImageToVideo", inputs: { start_image: ["1", 0] } }
  }), 1, "existing Wan-style FRAME_IMAGE_PATH workflows must retain staging");

  const selectedReferences = selectH3ReferenceImages([
    { kind: "key_prop", path: "props/sword.png" },
    { kind: "scene", path: "scenes/courtyard.png" },
    { kind: "character_body", path: "characters/lan-body.png" },
    { kind: "character_face", path: "characters/lan-face.png" },
    { kind: "character_face", path: "characters/wei-face.png" },
    { kind: "key_prop", path: "PROPS\\SWORD.PNG" },
    { kind: "key_prop", path: "props/lantern.png" }
  ]);
  assert.deepEqual(selectedReferences.map(({ kind, path: referencePath }) => [kind, referencePath]), [
    ["character_face", "characters/lan-face.png"],
    ["character_face", "characters/wei-face.png"],
    ["character_body", "characters/lan-body.png"],
    ["scene", "scenes/courtyard.png"]
  ], "references must be stable, ranked, deduplicated, and capped at four");

  const settings = { marker: "same-settings-object" };
  const shot = {
    id: "shot-7",
    sequenceId: "sequence-1",
    order: 7,
    title: "Courtyard duel",
    durationFrames: 240,
    dialogue: "",
    notes: "",
    tags: [],
    videoPrompt: "A precise lateral tracking shot",
    seed: 9123
  };
  const allShots = [shot];
  const assets = [{ id: "prop-1", type: "prop", name: "Sword", filePath: "props/sword.png" }];
  const signal = new AbortController().signal;
  const progressEvents = [];
  const calls = [];
  globalThis.__MINIMAX_H3_EXECUTOR__ = async (...args) => {
    calls.push(args);
    args[6].onPromptQueued("prompt-h3-001");
    args[6].onProgress?.(0.5, "sampling");
    return { previewUrl: "http://127.0.0.1/view/h3.mp4", localPath: "D:/renders/h3.mp4" };
  };

  const r2vWorkflow = await preset("minimax-h3-r2v-v1.json");
  const request = {
    settings,
    shot,
    index: 7,
    allShots,
    assets,
    routeDecision: { status: "selected", profileId: "minimax_h3_r2v", reason: "strong_reference_constraints" },
    profileWorkflowJson: JSON.stringify(r2vWorkflow),
    durationSeconds: 10,
    width: 1280,
    height: 720,
    qualityTier: "production",
    accelerationMode: "standard",
    references: [
      { kind: "key_prop", path: "props/sword.png" },
      { kind: "scene", path: "scenes/courtyard.png" },
      { kind: "character_body", path: "characters/lan-body.png" }
    ],
    generatedAt: "2026-08-18T09:30:00.000Z",
    onProgress: (...event) => progressEvents.push(event),
    signal
  };
  const generated = await generateRoutedVideoShot(request);
  assert.equal(calls.length, 1, "generation must delegate exactly once to the existing executor");
  const [actualSettings, actualShot, actualIndex, actualKind, actualShots, actualAssets, options] = calls[0];
  assert.equal(actualSettings, settings);
  assert.equal(actualShot, shot);
  assert.equal(actualIndex, 7);
  assert.equal(actualKind, "video");
  assert.equal(actualShots, allShots);
  assert.equal(actualAssets, assets);
  assert.equal(options.onProgress, request.onProgress);
  assert.equal(options.signal, signal);
  assert.deepEqual(progressEvents, [[0.5, "sampling"]]);

  assert.deepEqual(options.tokenOverrides, {
    VIDEO_PROMPT: "A precise lateral tracking shot",
    VIDEO_WIDTH: "1280",
    VIDEO_HEIGHT: "720",
    H3_LENGTH: "243",
    SEED: "9123",
    REF_IMAGE_1_PATH: "characters/lan-body.png",
    REF_IMAGE_2_PATH: "scenes/courtyard.png",
    REF_IMAGE_3_PATH: "props/sword.png"
  }, "the executor must receive the complete effective profile token set");

  const boundR2v = JSON.parse(options.workflowJsonOverride);
  assert.equal(boundR2v["18"], undefined, "unused reference LoadImage must be removed");
  assert.equal(boundR2v["5"].inputs["ref_images.ref_image_3"], undefined, "unused reference connection must be removed");
  assert.equal(options.workflowJsonOverride.includes("REF_IMAGE_4_PATH"), false, "pruned workflow must not retain an unused token");
  for (const node of Object.values(boundR2v)) {
    for (const value of Object.values(node.inputs ?? {})) {
      if (Array.isArray(value) && typeof value[0] === "string") {
        assert.ok(boundR2v[value[0]], `workflow link must not target removed node ${value[0]}`);
      }
    }
  }

  assert.equal(generated.previewUrl, "http://127.0.0.1/view/h3.mp4");
  assert.equal(generated.localPath, "D:/renders/h3.mp4");
  assert.deepEqual(generated.videoGenerationReceipt, {
    profileId: "minimax_h3_r2v",
    accelerationMode: "standard",
    workflowDigest: generated.videoGenerationReceipt.workflowDigest,
    inputDigest: generated.videoGenerationReceipt.inputDigest,
    promptId: "prompt-h3-001",
    normalizedPath: "D:/renders/h3.mp4",
    generatedAt: "2026-08-18T09:30:00.000Z"
  });
  assert.match(generated.videoGenerationReceipt.workflowDigest, /^[a-f0-9]{64}$/);
  assert.match(generated.videoGenerationReceipt.inputDigest, /^[a-f0-9]{64}$/);

  calls.length = 0;
  const repeated = await generateRoutedVideoShot(request);
  assert.deepEqual(repeated.videoGenerationReceipt, generated.videoGenerationReceipt,
    "identical effective inputs and executor identity must reproduce the receipt");

  const changedPromptPlan = await prepareH3VideoGeneration({ ...request, prompt: "A different move" });
  assert.equal(changedPromptPlan.workflowDigest, generated.videoGenerationReceipt.workflowDigest);
  assert.notEqual(changedPromptPlan.inputDigest, generated.videoGenerationReceipt.inputDigest,
    "the input digest must bind the effective prompt and token set");

  await assert.rejects(() => prepareH3VideoGeneration({
    ...request,
    routeDecision: { status: "selected", profileId: "minimax_h3_t2v", reason: "manual_override" },
    profileWorkflowJson: JSON.stringify(r2vWorkflow),
    references: []
  }), /h3_profile_workflow_mismatch/,
  "a receipt profile must not be paired with a different profile workflow");

  const t2vWorkflow = await preset("minimax-h3-t2v-v1.json");
  const draftPlan = await prepareH3VideoGeneration({
    ...request,
    routeDecision: { status: "selected", profileId: "minimax_h3_t2v", reason: "manual_override" },
    profileWorkflowJson: JSON.stringify(t2vWorkflow),
    qualityTier: "draft",
    accelerationMode: "te_speed_preview",
    references: []
  });
  const draftWorkflow = JSON.parse(draftPlan.profileWorkflowJson);
  const teNodes = Object.entries(draftWorkflow).filter(([, node]) => node.class_type === "TESpeedMiniMaxH3");
  assert.equal(teNodes.length, 1);
  const [teNodeId, teNode] = teNodes[0];
  assert.deepEqual(teNode.inputs.model, ["1", 0]);
  assert.deepEqual(draftWorkflow["8"].inputs.model, [teNodeId, 0]);
  assert.deepEqual(draftWorkflow["9"].inputs.model, [teNodeId, 0]);

  calls.length = 0;
  await assert.rejects(() => generateRoutedVideoShot({
    ...request,
    routeDecision: { status: "selected", profileId: "minimax_h3_t2v", reason: "manual_override" },
    profileWorkflowJson: JSON.stringify(t2vWorkflow),
    qualityTier: "production",
    accelerationMode: "te_speed_preview",
    references: []
  }), /te_speed_draft_only/);
  assert.equal(calls.length, 0, "production TE Speed must block before executor upload/queue side effects");

  const i2vPlan = await prepareH3VideoGeneration({
    ...request,
    routeDecision: { status: "selected", profileId: "minimax_h3_i2v", reason: "storyboard_anchor" },
    profileWorkflowJson: JSON.stringify(await preset("minimax-h3-i2v-v1.json")),
    firstFramePath: "frames/first.png",
    references: []
  });
  assert.equal(i2vPlan.tokenOverrides.FIRST_FRAME_PATH, "frames/first.png");
  assert.equal("LAST_FRAME_PATH" in i2vPlan.tokenOverrides, false);

  const flf2vPlan = await prepareH3VideoGeneration({
    ...request,
    routeDecision: { status: "selected", profileId: "minimax_h3_flf2v", reason: "explicit_endpoints" },
    profileWorkflowJson: JSON.stringify(await preset("minimax-h3-flf2v-v1.json")),
    firstFramePath: "frames/first.png",
    lastFramePath: "frames/last.png",
    references: []
  });
  assert.equal(flf2vPlan.tokenOverrides.FIRST_FRAME_PATH, "frames/first.png");
  assert.equal(flf2vPlan.tokenOverrides.LAST_FRAME_PATH, "frames/last.png");

  await assert.rejects(() => prepareH3VideoGeneration({
    ...request,
    routeDecision: { status: "blocked", reason: "no_safe_video_profile" }
  }), /no_safe_video_profile/);

  console.log("PASS minimax h3 binding");
} finally {
  delete globalThis.__MINIMAX_H3_EXECUTOR__;
  await rm(runtimeDir, { recursive: true, force: true });
}
