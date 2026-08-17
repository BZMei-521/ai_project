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

const canonicalizeForCheck = (value) => {
  if (Array.isArray(value)) return value.map(canonicalizeForCheck);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalizeForCheck(item)]));
  }
  return value;
};
const canonicalJsonForCheck = (value) => JSON.stringify(canonicalizeForCheck(value));
const sha256ForCheck = async (value) => Array.from(new Uint8Array(
  await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
), (byte) => byte.toString(16).padStart(2, "0")).join("");
const replaceTokensForCheck = (value, tokens) => {
  if (Array.isArray(value)) return value.map((item) => replaceTokensForCheck(item, tokens));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTokensForCheck(item, tokens)]));
  }
  if (typeof value !== "string") return value;
  return value.replace(/\{\{([^{}]*)\}\}/g, (_match, token) => String(tokens[token] ?? ""));
};

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
  const canonicalPresets = Object.fromEntries(await Promise.all([
    "minimax-h3-t2v-v1.json",
    "minimax-h3-i2v-v1.json",
    "minimax-h3-flf2v-v1.json",
    "minimax-h3-r2v-v1.json"
  ].map(async (name) => [name, await preset(name)])));
  const runtimeSource = transpiled.outputText
    .replace(/(["'])\.\.\/comfy-pipeline\/comfyService\1/g, '"./comfyService.mjs"')
    .replace(
      /import\s+(\w+)\s+from\s+["']\.\.\/comfy-pipeline\/presets\/([^"']+\.json)["'];?/g,
      (_statement, binding, name) => `const ${binding} = ${JSON.stringify(canonicalPresets[name])};`
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
  const helperSources = [
    "workflowConsumesVideoFrameTokens",
    "canonicalizeComfyExecutionValue",
    "canonicalizeComfyQueuedWorkflow",
    "assertNoUnresolvedWorkflowTokens"
  ].map((name) => declarations.get(name) ?? "").join("\n");
  const transpiled = ts.transpileModule(`${helperSources}\n${generateSource}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  assert.deepEqual(errors, [], "isolated generateShotAsset runtime must transpile");

  let scenario = {};
  let state = {};
  const reset = (nextScenario = {}) => {
    scenario = nextScenario;
    state = {
      stagedFrames: 0,
      queueCalls: 0,
      promptQueuedCallbacks: 0,
      queuedGraph: null,
      queuedAttestations: [],
      localFallbackCalls: 0
    };
  };
  reset();
  const replaceTokens = (value, tokens) => {
    if (Array.isArray(value)) return value.map((item) => replaceTokens(item, tokens));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTokens(item, tokens)]));
    }
    if (typeof value !== "string") return value;
    return value.replace(/\{\{([^{}]*)\}\}/g, (_match, token) => String(tokens[token] ?? ""));
  };
  const coerceValues = (value) => {
    if (Array.isArray(value)) return value.map(coerceValues);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, coerceValues(item)]));
    }
    if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
    return value;
  };
  const dependencies = {
    inferAssetOutputContextFromShot: () => null,
    ensureWorkflowJson: (value) => JSON.parse(value),
    inspectWorkflowLipSyncSupportFromObject: () => null,
    inferPromptTokens: () => ({ VIDEO_PROMPT: "inferred prompt", FIRST_FRAME_PATH: "", LAST_FRAME_PATH: "" }),
    applyCharacterStyleContractForRequest: ({ tokens }) => ({
      ...tokens,
      VIDEO_PROMPT: scenario.stylePrompt ?? tokens.VIDEO_PROMPT
    }),
    stageVideoFrameTokens: async (_settings, _shot, tokens) => {
      state.stagedFrames += 1;
      return {
        ...tokens,
        FIRST_FRAME_PATH: tokens.FIRST_FRAME_PATH ? (scenario.stagedFirstPath ?? "staged_first.png") : "",
        LAST_FRAME_PATH: tokens.LAST_FRAME_PATH ? (scenario.stagedLastPath ?? "staged_last.png") : "",
        FRAME_IMAGE_PATH: tokens.FRAME_IMAGE_PATH ? (scenario.stagedFramePath ?? "staged_frame.png") : ""
      };
    },
    fetchObjectInfo: async () => ({ isolated_object_info: true }),
    applyDynamicCharacterRefsForImageWorkflow: () => undefined,
    coerceWorkflowLiteralValues: coerceValues,
    deepReplaceTokens: replaceTokens,
    applyFisherWorkflowBindings: () => undefined,
    applyComfyModelOptionBindings: (workflow) => {
      if (workflow["1"]?.inputs) workflow["1"].inputs.object_info_bound = true;
    },
    queueComfyPrompt: async (_baseUrl, workflow) => {
      state.queueCalls += 1;
      state.queuedGraph = structuredClone(workflow);
      if (scenario.queueError) throw scenario.queueError;
      return "prompt-real-queued-001";
    },
    waitForComfyOutput: async () => {
      if (scenario.abortController) scenario.abortController.abort();
      if (scenario.terminalError) throw scenario.terminalError;
      return [{ filename: "h3.mp4", subfolder: "Video", type: "output" }];
    },
    attemptComfyMemoryRelief: async () => undefined,
    selectOutputAsset: (outputs) => outputs[0] ?? null,
    materializeOutputAssetPath: async () => "D:/renders/actual-h3.mp4",
    isStoryboardCharacterDropout: async () => false,
    maybeFallbackToStoryboardComposite: async () => null,
    toComfyViewUrl: () => "http://isolated.invalid/view/actual-h3.mp4",
    isRequestTimeoutError: () => false,
    shouldFallbackToLocalVideo: () => scenario.allowLegacyFallback === true,
    generateLocalCompatibleVideo: async () => {
      state.localFallbackCalls += 1;
      return { previewUrl: "local-preview", localPath: "D:/renders/local-fallback.mp4" };
    },
    readComfyServerLogTail: async () => "",
    summarizeComfyServerLogFailure: () => null
  };
  const names = Object.keys(dependencies);
  const values = Object.values(dependencies);
  const executableSource = transpiled.outputText.replace(/\bexport\s+/g, "");
  const factory = new Function(...names, `${executableSource}\nreturn generateShotAsset;`);
  const generateShotAsset = factory(...values);
  const execute = async ({ workflow, tokenOverrides = {}, options = {}, nextScenario = {}, settingsOverrides = {} }) => {
    reset(nextScenario);
    const result = await generateShotAsset(
      {
        baseUrl: "http://isolated.invalid",
        videoGenerationMode: "workflow",
        videoWorkflowJson: "",
        tokenMapping: {},
        outputDir: "D:/outputs",
        comfyRootDir: "D:/ComfyUI",
        ...settingsOverrides
      },
      { id: "probe", title: "probe", tags: [], durationFrames: 120, dialogue: "", notes: "", sequenceId: "s", order: 0 },
      0,
      "video",
      [],
      [],
      {
        workflowJsonOverride: JSON.stringify(workflow),
        tokenOverrides,
        onPromptQueued: () => { state.promptQueuedCallbacks += 1; },
        onQueuedPromptAttested: (attestation) => state.queuedAttestations.push(structuredClone(attestation)),
        ...options
      }
    );
    return { result, state };
  };
  const observeFrameStaging = async (workflow) => {
    const stopAfterStaging = new Error("stop_after_staging_probe");
    await assert.rejects(
      () => execute({ workflow, nextScenario: { queueError: stopAfterStaging } }),
      (error) => error === stopAfterStaging
    );
    return state.stagedFrames;
  };
  const runArgs = async (nextScenario, ...args) => {
    reset(nextScenario);
    const wrappedArgs = [...args];
    const originalOptions = wrappedArgs[6] ?? {};
    wrappedArgs[6] = {
      ...originalOptions,
      onPromptQueued: (promptId) => {
        state.promptQueuedCallbacks += 1;
        originalOptions.onPromptQueued?.(promptId);
      },
      onQueuedPromptAttested: (attestation) => {
        state.queuedAttestations.push(structuredClone(attestation));
        originalOptions.onQueuedPromptAttested?.(attestation);
      }
    };
    const result = await generateShotAsset(...wrappedArgs);
    state.lastResult = result;
    return result;
  };
  return { execute, observeFrameStaging, runArgs, getState: () => state };
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

  const isolatedExecutor = await loadIsolatedGenerateShotAsset();
  const observeFrameStaging = isolatedExecutor.observeFrameStaging;
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

  const isolatedI2vWorkflow = await preset("minimax-h3-i2v-v1.json");
  const isolatedSuccess = await isolatedExecutor.execute({
    workflow: isolatedI2vWorkflow,
    tokenOverrides: {
      VIDEO_PROMPT: "raw requested prompt",
      VIDEO_WIDTH: "1280",
      VIDEO_HEIGHT: "720",
      H3_LENGTH: "124",
      SEED: "77",
      FIRST_FRAME_PATH: "C:/frames/first.png"
    },
    options: { strictComfyExecution: true },
    nextScenario: { stylePrompt: "styled prompt after contract" }
  });
  assert.equal(isolatedSuccess.state.queuedAttestations.length, 1,
    "the real executor must attest the accepted queued graph");
  const queuedAttestation = isolatedSuccess.state.queuedAttestations[0];
  assert.equal(queuedAttestation.promptId, "prompt-real-queued-001");
  assert.equal(queuedAttestation.provenance, "comfy");
  assert.equal(queuedAttestation.effectiveInputs.VIDEO_PROMPT, "styled prompt after contract");
  assert.equal(queuedAttestation.effectiveInputs.FIRST_FRAME_PATH, "staged_first.png");
  assert.equal(queuedAttestation.canonicalWorkflowJson,
    canonicalJsonForCheck(isolatedSuccess.state.queuedGraph));
  assert.equal(isolatedSuccess.state.queuedGraph["5"].inputs.prompt, "styled prompt after contract");
  assert.equal(isolatedSuccess.state.queuedGraph["5"].inputs.first_frame[0], 15);
  assert.equal(isolatedSuccess.state.queuedGraph["15"].inputs.image, "staged_first.png");
  assert.equal(isolatedSuccess.state.queuedGraph["5"].inputs.width, 1280,
    "the attested graph must be post-coercion");
  assert.equal(isolatedSuccess.state.queuedGraph["1"].inputs.object_info_bound, true,
    "the attested graph must include object-info binding");
  assert.notEqual(queuedAttestation.canonicalWorkflowJson, canonicalJsonForCheck(isolatedI2vWorkflow),
    "the actual queued graph must differ from the unexecuted plan template");
  assert.equal(isolatedSuccess.result.executionProof.status, "succeeded");
  assert.equal(isolatedSuccess.result.executionProof.promptId, queuedAttestation.promptId);
  assert.deepEqual(isolatedSuccess.result.executionProof.outputIdentity, {
    previewUrl: "http://isolated.invalid/view/actual-h3.mp4",
    localPath: "D:/renders/actual-h3.mp4"
  });

  const isolatedFlf2vWorkflow = await preset("minimax-h3-flf2v-v1.json");
  const isolatedFlf2v = await isolatedExecutor.execute({
    workflow: isolatedFlf2vWorkflow,
    tokenOverrides: {
      VIDEO_PROMPT: "endpoint motion",
      VIDEO_WIDTH: "1280",
      VIDEO_HEIGHT: "720",
      H3_LENGTH: "124",
      SEED: "78",
      FIRST_FRAME_PATH: "C:/frames/first.png",
      LAST_FRAME_PATH: "C:/frames/last.png"
    },
    options: { strictComfyExecution: true },
    nextScenario: { stylePrompt: "styled endpoint motion" }
  });
  assert.equal(isolatedFlf2v.result.executionProof.effectiveInputs.FIRST_FRAME_PATH, "staged_first.png");
  assert.equal(isolatedFlf2v.result.executionProof.effectiveInputs.LAST_FRAME_PATH, "staged_last.png");
  assert.equal(isolatedFlf2v.state.queuedGraph["15"].inputs.image, "staged_first.png");
  assert.equal(isolatedFlf2v.state.queuedGraph["16"].inputs.image, "staged_last.png");

  for (const [label, nextScenario] of [
    ["queue failure", { queueError: new Error("missing_node_type") }],
    ["terminal failure", { terminalError: new Error("status=error; completed=false") }]
  ]) {
    await assert.rejects(() => isolatedExecutor.execute({
      workflow: isolatedI2vWorkflow,
      tokenOverrides: isolatedSuccess.state.queuedAttestations[0].effectiveInputs,
      options: { strictComfyExecution: true },
      nextScenario: { ...nextScenario, allowLegacyFallback: true }
    }), /missing_node_type|status=error/,
    `strict H3 ${label} must reject instead of returning local video`);
    assert.equal(isolatedExecutor.getState().localFallbackCalls, 0,
      `strict H3 ${label} must not enter legacy local fallback`);
  }

  const abortController = new AbortController();
  await assert.rejects(() => isolatedExecutor.execute({
    workflow: isolatedI2vWorkflow,
    tokenOverrides: isolatedSuccess.state.queuedAttestations[0].effectiveInputs,
    options: { strictComfyExecution: true, signal: abortController.signal },
    nextScenario: {
      terminalError: new Error("operation was aborted"),
      abortController,
      allowLegacyFallback: true
    }
  }), /operation was aborted/);
  assert.equal(isolatedExecutor.getState().localFallbackCalls, 0,
    "strict aborted H3 execution must not enter local fallback");

  const legacyFallback = await isolatedExecutor.execute({
    workflow: isolatedI2vWorkflow,
    tokenOverrides: isolatedSuccess.state.queuedAttestations[0].effectiveInputs,
    nextScenario: {
      terminalError: new Error("status=error; completed=false"),
      allowLegacyFallback: true
    }
  });
  assert.equal(legacyFallback.result.localPath, "D:/renders/local-fallback.mp4");
  assert.equal(legacyFallback.result.executionProof, undefined,
    "legacy non-strict fallback remains available but is not a Comfy success proof");
  assert.equal(legacyFallback.state.localFallbackCalls, 1,
    "strict mode must remain opt-in for non-H3 legacy callers");

  await assert.rejects(() => isolatedExecutor.execute({
    workflow: isolatedI2vWorkflow,
    tokenOverrides: isolatedSuccess.state.queuedAttestations[0].effectiveInputs,
    options: { strictComfyExecution: true },
    settingsOverrides: { videoGenerationMode: "local_motion" }
  }), /strict_comfy_execution_required/);
  assert.equal(isolatedExecutor.getState().localFallbackCalls, 0,
    "strict H3 execution must reject settings-level local motion before fallback");

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
  let fakeQueuedAttestation;
  const fakeExecutor = async (...args) => {
    calls.push(args);
    const options = args[6];
    const effectiveInputs = { ...options.tokenOverrides, VIDEO_PROMPT: "styled actual queued prompt" };
    const queuedWorkflow = replaceTokensForCheck(JSON.parse(options.workflowJsonOverride), effectiveInputs);
    queuedWorkflow["1"].inputs.object_info_bound = true;
    fakeQueuedAttestation = {
      promptId: "prompt-h3-001",
      provenance: "comfy",
      canonicalWorkflowJson: canonicalJsonForCheck(queuedWorkflow),
      effectiveInputs
    };
    options.onPromptQueued?.("prompt-h3-001");
    options.onQueuedPromptAttested?.(fakeQueuedAttestation);
    options.onProgress?.(0.5, "sampling");
    return {
      previewUrl: "http://127.0.0.1/view/h3.mp4",
      localPath: "D:/renders/h3.mp4",
      executionProof: {
        ...fakeQueuedAttestation,
        status: "succeeded",
        outputIdentity: {
          previewUrl: "http://127.0.0.1/view/h3.mp4",
          localPath: "D:/renders/h3.mp4"
        }
      }
    };
  };
  globalThis.__MINIMAX_H3_EXECUTOR__ = fakeExecutor;

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
  assert.equal(options.strictComfyExecution, true,
    "routed H3 must disable every legacy local-video fallback path");
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
  assert.equal(generated.videoGenerationReceipt.workflowDigest,
    await sha256ForCheck(fakeQueuedAttestation.canonicalWorkflowJson),
    "receipt workflow digest must hash the exact accepted queued graph");
  const expectedActualInputDigest = await sha256ForCheck(canonicalJsonForCheck({
    version: 2,
    profileId: "minimax_h3_r2v",
    qualityTier: "production",
    accelerationMode: "standard",
    workflowDigest: generated.videoGenerationReceipt.workflowDigest,
    shotId: "shot-7",
    index: 7,
    effectiveInputs: fakeQueuedAttestation.effectiveInputs
  }));
  assert.equal(generated.videoGenerationReceipt.inputDigest, expectedActualInputDigest,
    "receipt input digest must bind the executor's post-staging/post-style effective inputs");

  calls.length = 0;
  const repeated = await generateRoutedVideoShot(request);
  assert.deepEqual(repeated.videoGenerationReceipt, generated.videoGenerationReceipt,
    "identical effective inputs and executor identity must reproduce the receipt");

  const changedPromptPlan = await prepareH3VideoGeneration({ ...request, prompt: "A different move" });
  assert.notEqual(changedPromptPlan.plannedWorkflowDigest, generated.videoGenerationReceipt.workflowDigest,
    "the unexecuted plan digest must not be mistaken for the actual queued graph digest");
  assert.notEqual(changedPromptPlan.plannedInputDigest, generated.videoGenerationReceipt.inputDigest,
    "the input digest must bind the effective prompt and token set");

  const realExecutorI2vRequest = {
    ...request,
    routeDecision: { status: "selected", profileId: "minimax_h3_i2v", reason: "storyboard_anchor" },
    profileWorkflowJson: JSON.stringify(await preset("minimax-h3-i2v-v1.json")),
    firstFramePath: "C:/frames/first.png",
    references: []
  };
  globalThis.__MINIMAX_H3_EXECUTOR__ = (...args) => isolatedExecutor.runArgs(
    { stylePrompt: "real executor styled prompt" },
    ...args
  );
  const realExecutorGenerated = await generateRoutedVideoShot(realExecutorI2vRequest);
  const realExecutorState = isolatedExecutor.getState();
  const actualExecutionProof = realExecutorState.lastResult.executionProof;
  assert.equal(realExecutorState.queuedGraph["15"].inputs.image, "staged_first.png");
  assert.equal(realExecutorState.queuedGraph["5"].inputs.prompt, "real executor styled prompt");
  assert.equal(realExecutorGenerated.videoGenerationReceipt.workflowDigest,
    await sha256ForCheck(actualExecutionProof.canonicalWorkflowJson));
  assert.notEqual(realExecutorGenerated.videoGenerationReceipt.workflowDigest,
    await sha256ForCheck(canonicalJsonForCheck(await preset("minimax-h3-i2v-v1.json"))),
    "end-to-end receipt must bind the actual staged/coerced graph, not the plan preset");

  const canonicalT2vRequest = {
    ...request,
    routeDecision: { status: "selected", profileId: "minimax_h3_t2v", reason: "manual_override" },
    profileWorkflowJson: JSON.stringify(await preset("minimax-h3-t2v-v1.json")),
    references: []
  };
  const unresolvedInjectionCases = [
    {
      label: "request prompt",
      request: { ...canonicalT2vRequest, prompt: "camera move {{untrusted_path}}" },
      scenario: {}
    },
    {
      label: "style-contract prompt",
      request: { ...canonicalT2vRequest, prompt: "safe camera move" },
      scenario: { stylePrompt: "styled camera {{Mixed_Style_Token}}" }
    },
    {
      label: "staged frame basename",
      request: { ...realExecutorI2vRequest, prompt: "safe anchored move" },
      scenario: { stagedFirstPath: "staged_{{lower_Path_Token}}.png" }
    }
  ];
  for (const injectionCase of unresolvedInjectionCases) {
    globalThis.__MINIMAX_H3_EXECUTOR__ = (...args) => isolatedExecutor.runArgs(
      injectionCase.scenario,
      ...args
    );
    await assert.rejects(
      () => generateRoutedVideoShot(injectionCase.request),
      /unresolved_workflow_token/,
      `${injectionCase.label} unresolved token must be rejected before queue`
    );
    const rejectedState = isolatedExecutor.getState();
    assert.equal(rejectedState.queueCalls, 0, `${injectionCase.label}: queue must remain untouched`);
    assert.equal(rejectedState.promptQueuedCallbacks, 0, `${injectionCase.label}: prompt callback must remain untouched`);
    assert.equal(rejectedState.queuedAttestations.length, 0, `${injectionCase.label}: attestation must remain untouched`);
    assert.equal(rejectedState.localFallbackCalls, 0, `${injectionCase.label}: local fallback must remain untouched`);
    assert.equal(rejectedState.lastResult, undefined, `${injectionCase.label}: no executor success/receipt source may exist`);
  }

  const legacyUnresolved = await isolatedExecutor.execute({
    workflow: await preset("minimax-h3-t2v-v1.json"),
    tokenOverrides: {
      VIDEO_PROMPT: "legacy literal {{kept_for_compatibility}}",
      VIDEO_WIDTH: "1280",
      VIDEO_HEIGHT: "720",
      H3_LENGTH: "124",
      SEED: "79"
    }
  });
  assert.equal(legacyUnresolved.state.queueCalls, 1,
    "non-strict legacy execution must retain its previous queue behavior");

  globalThis.__MINIMAX_H3_EXECUTOR__ = (...args) => isolatedExecutor.runArgs(
    {
      stylePrompt: "failed actual prompt",
      terminalError: new Error("status=error; completed=false"),
      allowLegacyFallback: true
    },
    ...args
  );
  await assert.rejects(() => generateRoutedVideoShot(realExecutorI2vRequest), /status=error; completed=false/,
    "a queued terminal failure must not produce an H3 receipt");
  assert.equal(isolatedExecutor.getState().localFallbackCalls, 0,
    "routed H3 terminal failure must not return a local fallback receipt");

  globalThis.__MINIMAX_H3_EXECUTOR__ = async (...args) => {
    const options = args[6];
    const fabricatedAttestation = {
      promptId: "prompt-failed-then-local",
      provenance: "comfy",
      canonicalWorkflowJson: canonicalJsonForCheck(JSON.parse(options.workflowJsonOverride)),
      effectiveInputs: { ...options.tokenOverrides }
    };
    options.onPromptQueued?.(fabricatedAttestation.promptId);
    options.onQueuedPromptAttested?.(fabricatedAttestation);
    return { previewUrl: "local-preview", localPath: "D:/renders/local-fallback.mp4" };
  };
  await assert.rejects(() => generateRoutedVideoShot(realExecutorI2vRequest), /h3_execution_proof_missing/,
    "a local-looking return after prompt acceptance cannot fabricate an H3 receipt without success proof");

  globalThis.__MINIMAX_H3_EXECUTOR__ = fakeExecutor;

  await assert.rejects(() => prepareH3VideoGeneration({
    ...request,
    routeDecision: { status: "selected", profileId: "minimax_h3_t2v", reason: "manual_override" },
    profileWorkflowJson: JSON.stringify(r2vWorkflow),
    references: []
  }), /h3_noncanonical_workflow/,
  "a receipt profile must not be paired with a different profile workflow");

  const t2vWorkflow = await preset("minimax-h3-t2v-v1.json");
  const canonicalDriftCases = [
    ["UNET model", (workflow) => { workflow["1"].inputs.unet_name = "minimax_h3_ref2va_pruned_int8_convrot.safetensors"; }],
    ["text encoder", (workflow) => { workflow["2"].inputs.clip_name = "different_encoder.safetensors"; }],
    ["video VAE", (workflow) => { workflow["3"].inputs.vae_name = "different_video_vae.safetensors"; }],
    ["sampler", (workflow) => { workflow["7"].inputs.sampler_name = "euler"; }],
    ["scheduler", (workflow) => { workflow["8"].inputs.scheduler = "normal"; }],
    ["CreateVideo output", (workflow) => { workflow["13"].inputs.fps = 30; }],
    ["SaveVideo output", (workflow) => { workflow["14"].inputs.codec = "hevc"; }],
    ["unknown node", (workflow) => { workflow["99"] = { class_type: "UnknownNode", inputs: {} }; }],
    ["changed connection", (workflow) => { workflow["9"].inputs.model = ["2", 0]; }],
    ["lowercase residual token", (workflow) => { workflow["14"].inputs.extra = "{{untrusted_path}}"; }]
  ];
  for (const [label, mutate] of canonicalDriftCases) {
    const drifted = structuredClone(t2vWorkflow);
    mutate(drifted);
    calls.length = 0;
    await assert.rejects(() => generateRoutedVideoShot({
      ...request,
      routeDecision: { status: "selected", profileId: "minimax_h3_t2v", reason: "manual_override" },
      profileWorkflowJson: JSON.stringify(drifted),
      references: []
    }), /h3_noncanonical_workflow|h3_token_unbound/,
    `${label} drift must be rejected as non-canonical`);
    assert.equal(calls.length, 0, `${label} drift must fail before executor side effects`);
  }
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
