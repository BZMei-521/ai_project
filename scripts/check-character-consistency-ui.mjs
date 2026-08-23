import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { build } from "esbuild";
import ts from "typescript";
import {
  createSequentialArtifactLedger,
  planSequentialArtifactCleanup,
  planSequentialArtifactRetainedPaths,
  registerSequentialArtifact
} from "../src/modules/comfy-pipeline/sequentialCharacterPassRuntime.mjs";
import { verifyCompiledCharacterReferenceBindings } from "../src/modules/comfy-pipeline/characterEvidenceContextRuntime.mjs";

const panelPath = new URL("../src/modules/comfy-pipeline/ComfyPipelinePanel.tsx", import.meta.url);
const inspectorPath = new URL("../src/modules/editor-shell/ShotInspectorPanel.tsx", import.meta.url);
const taskPreviewRuntimePath = new URL("../src/modules/editor-shell/characterRedrawTaskPreviewRuntime.mjs", import.meta.url);
const servicePath = new URL("../src/modules/comfy-pipeline/comfyService.ts", import.meta.url);
const assetPanelPath = new URL("../src/modules/asset-manager/AssetPanel.tsx", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);

const panel = fs.readFileSync(panelPath, "utf8");
const inspector = fs.readFileSync(inspectorPath, "utf8");
const service = fs.readFileSync(servicePath, "utf8");
const assetPanel = fs.readFileSync(assetPanelPath, "utf8");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const ui = `${panel}\n${inspector}`;
const redrawHandler = /const redrawSelectedCharacter[\s\S]*?\n\s*const upsertProvisionPreview/.exec(panel)?.[0] ?? "";
const failures = [];

const check = (description, predicate) => {
  try {
    assert.ok(predicate(), description);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
};

const kleinReferenceWorkflow = {
  identityFace: { class_type: "LoadImage", inputs: { image: "klein-face.png" } },
  identityBody: { class_type: "LoadImage", inputs: { image: "klein-body.png" } },
  reference: {
    class_type: "ReferenceLatent",
    inputs: { face: ["identityFace", 0], body: ["identityBody", 0] }
  },
  output: { class_type: "SaveImage", inputs: { images: ["reference", 0] } }
};
const compiledKleinReferenceLoaders = Object.values(kleinReferenceWorkflow).filter(
  (node) => node.class_type === "LoadImage"
);
assert.equal(compiledKleinReferenceLoaders.length, 2);
assert.equal(
  compiledKleinReferenceLoaders.some((node) => /codex-clipboard|style.reference/i.test(node.inputs.image)),
  false
);
assert.deepEqual(
  verifyCompiledCharacterReferenceBindings(kleinReferenceWorkflow, ["klein-face.png", "klein-body.png"]),
  { valid: true, reason: "ok" }
);
const styleImageReferenceWorkflow = {
  ...kleinReferenceWorkflow,
  styleImage: { class_type: "LoadImage", inputs: { image: "style.reference.png" } },
  reference: {
    ...kleinReferenceWorkflow.reference,
    inputs: { ...kleinReferenceWorkflow.reference.inputs, style: ["styleImage", 0] }
  }
};
assert.deepEqual(
  verifyCompiledCharacterReferenceBindings(styleImageReferenceWorkflow, ["klein-face.png", "klein-body.png"]),
  { valid: false, reason: "compiled_reference_binding_mismatch" },
  "a style LoadImage reaching ReferenceLatent must be rejected"
);

check("zero-shot and LoRA evidence imports must remain separate", () =>
  assetPanel.includes("导入零样本基准证据") &&
  assetPanel.includes("导入 LoRA 基准证据") &&
  /onImportCharacterGenerationEvidence\(asset, "zero_shot_multi_reference"/.test(assetPanel) &&
  /onImportCharacterGenerationEvidence\(asset, "lora_augmented"/.test(assetPanel)
);
check("panel visual-style defaults must come from the canonical contract", () =>
  /import\s*\{[\s\S]*?CINEMATIC_3D_DONGHUA_CONTRACT[\s\S]*?\}\s*from\s*["']\.\/characterStyleContract["']/.test(panel) &&
  /const\s+DEFAULT_GLOBAL_VISUAL_STYLE_PROMPT\s*=\s*CINEMATIC_3D_DONGHUA_CONTRACT\.positivePrompt/.test(panel) &&
  /const\s+DEFAULT_GLOBAL_STYLE_NEGATIVE_PROMPT\s*=\s*CINEMATIC_3D_DONGHUA_CONTRACT\.negativePrompt/.test(panel)
);
check("custom operator style text must be preserved but diagnosed as non-versioned", () =>
  panel.includes("鑷畾涔夐鏍兼湭鐗堟湰鍖栵紝涓嶈兘鐢熸垚鍙戝竷璇佹嵁") &&
  /settings\.globalVisualStylePrompt[\s\S]*?CINEMATIC_3D_DONGHUA_CONTRACT\.positivePrompt/.test(panel) &&
  /settings\.globalStyleNegativePrompt[\s\S]*?CINEMATIC_3D_DONGHUA_CONTRACT\.negativePrompt/.test(panel)
);
check("unversioned custom style must be blocked from trusted sequential publication evidence", () =>
  /shouldRunSequentialCharacterPasses[\s\S]*?resolveVisualStyleSettings\(settings\)[\s\S]*?unversioned_visual_style_evidence_blocked/.test(service)
);
check("panel character generation must supply the exact style identity Asset", () =>
  /export function resolveCharacterAssetGenerationStyleAssets/.test(panel) &&
  /generateShotAsset(?:Outputs)?\([\s\S]*?makeAssetGenerationShot\([\s\S]*?resolveCharacterAssetGenerationStyleAssets\(/.test(panel) &&
  /character_asset_identity_missing_persisted/.test(panel) &&
  /character_asset_identity_ambiguous_persisted/.test(panel) &&
  !/provisional_character_/.test(panel) &&
  !/makeAssetGenerationShot\([\s\S]{0,500}?\n\s*0,\n\s*"image",\n\s*\[\],\n\s*\[\],/.test(panel)
);
check("dual-track evidence states must be read-only and independently derived", () =>
  assetPanel.includes("零样本已验证") &&
  assetPanel.includes("LoRA 已验证") &&
  assetPanel.includes("待复核") &&
  assetPanel.includes("证据已失效") &&
  !/设为已就绪|手动就绪/.test(assetPanel)
);
check("production generation must use freshly hashed trusted contexts", () =>
  /stageImmutableCharacterReferenceSnapshot\(\{[\s\S]*?identity:\s*activeAsset\.characterIdentityPack[\s\S]*?hashIdentity:\s*loadCharacterIdentityReferenceSourceHashes/.test(service) &&
  /currentZeroContext:\s*trustedZeroContext/.test(service) &&
  /currentLoraContext:\s*trustedLoraContext/.test(service) &&
  /verifyImmutableCharacterReferenceSnapshot\([\s\S]*?queueComfyPrompt/.test(service)
);
check("trusted receipts are freshly verified at the compiled workflow queue gate", () =>
  /const\s+attemptTrackInput[\s\S]*?stagedReferenceSnapshot[\s\S]*?trackInput:\s*attemptTrackInput/.test(service) &&
  /verifyFreshCharacterEvidenceReceipts\([\s\S]*?verifyCharacterEvidenceReceipt\([\s\S]*?resolveCharacterGenerationTrack\(\{[\s\S]*?\.\.\.freshReceiptVerifications,[\s\S]*?compiledWorkflow:\s*built/.test(service) &&
  !/const\s+attemptTrackInput[\s\S]*?trustedZeroReceiptVerification,[\s\S]*?trustedLoraReceiptVerification/.test(service)
);

for (const label of ["脸部一致性", "发型一致性", "服装一致性", "身体一致性", "质量一致性", "总体一致性"]) {
  check(`selected-shot inspection is missing visible label: ${label}`, () => ui.includes(label));
}
for (const label of ["只重绘脸和头发", "重绘上半身", "重绘完整人物"]) {
  check(`scoped redraw is missing accessible action: ${label}`, () => ui.includes(label));
}
for (const label of ["身份版本", "LoRA 版本", "引用", "重试次数", "状态", "需要人工审核"]) {
  check(`character layer inspection is missing metadata/status label: ${label}`, () => ui.includes(label));
}

check("missing metrics must render as an em dash", () => /["'`]—["'`]/.test(ui));
check("character status must be exposed as accessible text", () => /aria-live=["']polite["']/.test(ui));
check(
  "package.json is missing the focused Task 8 script",
  () => packageJson.scripts?.["test:character-consistency-ui"] === "node scripts/check-character-consistency-ui.mjs"
);
check(
  "StoryboardGenerationRequest must carry one structured characterRedraw target and scope",
  () => /characterRedraw\?:\s*CharacterRedrawRequest/.test(service) && /characterAssetId:\s*string;[\s\S]*?scope:\s*CharacterRedrawScope/.test(service)
);
check(
  "queued generation must route characterRedraw into staged generation",
  () => /generateStoryboardImageStaged\([\s\S]*?characterRedraw:\s*current\.characterRedraw/.test(service)
);
check(
  "the UI redraw request must carry the selected shot and exactly one character target/scope object",
  () => /queueStoryboardShot\(\{[\s\S]*?shot:\s*selectedShot[\s\S]*?characterRedraw:\s*\{\s*characterAssetId,\s*scope\s*\}/.test(redrawHandler)
);
check(
  "redraw controls must be disabled while generation is active",
  () => /const\s+disabled\s*=\s*phase\s*===\s*["']running["']\s*\|\|\s*redrawActive\s*!==\s*null/.test(panel) && /disabled=\{disabled\}/.test(panel)
);
check(
  "scoped redraw must not regenerate legacy Stage B",
  () => /characterRedrawPlan[\s\S]*?redrawCharacterPasses/.test(service) && /if\s*\(characterRedrawPlan\)/.test(service)
);
check(
  "generation tasks must persist a serializable exact retry snapshot",
  () => /retrySnapshot\?:\s*StoryboardGenerationRetrySnapshot/.test(fs.readFileSync(new URL("../src/modules/storyboard-core/types.ts", import.meta.url), "utf8")) && /createStoryboardRetrySnapshot\(/.test(service)
);
check(
  "retry must refuse a missing snapshot rather than downgrade to generic generation",
  () => /retry_snapshot_missing/.test(service)
);
check(
  "failed and cancelled tasks must retain optional best-preview state",
  () => /markGenerationTaskCancelled/.test(service) && /bestPreviewPath/.test(service) && /reviewReasons/.test(service)
);
check(
  "the selected-shot inspection must select scoped-redraw previews and render them under the matching character layer",
  () => /selectCharacterRedrawReviewPreviews/.test(inspector) &&
    /selectedCharacterLayers\.map[\s\S]*?characterAssetId[\s\S]*?scopedRedrawReviewPreviews[\s\S]*?scope/.test(inspector) &&
    /需要人工审核/.test(inspector) && /已取消/.test(inspector)
);
check(
  "the UI must refuse redraw before queueing when another accepted character mask is missing",
  () => /character_redraw_protected_mask_missing/.test(redrawHandler) && /return;[\s\S]*?queueStoryboardShot/.test(redrawHandler)
);

try {
  const { selectCharacterRedrawReviewPreviews } = await import(taskPreviewRuntimePath.href);
  const scopedTask = ({
    id,
    characterAssetId,
    scope,
    status,
    bestPreviewPath,
    shotId = "shot-1",
    snapshotShotId = shotId
  }) => ({
    id,
    shotId,
    status,
    bestPreviewPath,
    retrySnapshot: {
      shot: { id: snapshotShotId },
      characterRedraw: { characterAssetId, scope }
    }
  });
  const genericFailure = {
    id: "generic-failure",
    shotId: "shot-1",
    status: "failed",
    bestPreviewPath: "generic.png",
    retrySnapshot: { shot: { id: "shot-1" } }
  };
  assert.deepEqual(
    selectCharacterRedrawReviewPreviews([genericFailure], { shotId: "shot-1", characterAssetId: "char-a" }),
    [],
    "a generic failed generation task must never appear as character-redraw review"
  );

  const faceReview = scopedTask({
    id: "face-review",
    characterAssetId: "char-a",
    scope: "face_hair",
    status: "needs_review",
    bestPreviewPath: "face-review.png"
  });
  assert.deepEqual(
    selectCharacterRedrawReviewPreviews([genericFailure, faceReview], { shotId: "shot-1", characterAssetId: "char-a" })
      .map((item) => [item.scope, item.task.id]),
    [["face_hair", "face-review"]],
    "a scoped needs_review task must be visible under its exact character target"
  );

  const otherCharacterFaceFailure = scopedTask({
    id: "char-b-face-failure",
    characterAssetId: "char-b",
    scope: "face_hair",
    status: "failed",
    bestPreviewPath: "char-b-face.png"
  });
  const upperBodyFailure = scopedTask({
    id: "upper-body-failure",
    characterAssetId: "char-a",
    scope: "upper_body",
    status: "cancelled",
    bestPreviewPath: "upper-body.png"
  });
  const otherShotUpperSuccess = scopedTask({
    id: "other-shot-upper-success",
    characterAssetId: "char-a",
    scope: "upper_body",
    status: "completed",
    shotId: "shot-2"
  });
  const faceSuccess = scopedTask({
    id: "face-success",
    characterAssetId: "char-a",
    scope: "face_hair",
    status: "completed"
  });
  const tasks = [
    genericFailure,
    faceReview,
    otherCharacterFaceFailure,
    upperBodyFailure,
    otherShotUpperSuccess,
    faceSuccess
  ];
  assert.deepEqual(
    selectCharacterRedrawReviewPreviews(tasks, { shotId: "shot-1", characterAssetId: "char-a" })
      .map((item) => [item.scope, item.task.id]),
    [["upper_body", "upper-body-failure"]],
    "the latest successful retry must suppress stale review only for the same shot, target, and scope"
  );
  assert.deepEqual(
    selectCharacterRedrawReviewPreviews(tasks, { shotId: "shot-1", characterAssetId: "char-b" })
      .map((item) => [item.scope, item.task.id]),
    [["face_hair", "char-b-face-failure"]],
    "tasks for a different character must remain independently visible"
  );
} catch (error) {
  failures.push(`character redraw task-preview selection failed: ${error instanceof Error ? error.message : String(error)}`);
}

try {
  const ledger = createSequentialArtifactLedger("task8-review-ledger");
  registerSequentialArtifact(ledger, { path: "run/temp.png", retention: "disposable" });
  registerSequentialArtifact(ledger, { path: "run/accepted.png", retention: "persisted" });
  registerSequentialArtifact(ledger, { path: "run/review.png", retention: "review" });
  assert.deepEqual(
    planSequentialArtifactCleanup(ledger, "failure").sort(),
    ["run/accepted.png", "run/temp.png"],
    "failure cleanup must delete incomplete run artifacts but exclude the designated review preview"
  );
  assert.deepEqual(
    planSequentialArtifactRetainedPaths(ledger).sort(),
    ["run/accepted.png", "run/review.png"],
    "the review preview must be a declared retained artifact"
  );
} catch (error) {
  failures.push(`review artifact ledger behavior failed: ${error instanceof Error ? error.message : String(error)}`);
}

const runtimeMatch = /\/\* CHARACTER_REDRAW_RUNTIME_START \*\/([\s\S]*?)\/\* CHARACTER_REDRAW_RUNTIME_END \*\//.exec(service);
if (!runtimeMatch) {
  failures.push("missing executable CHARACTER_REDRAW_RUNTIME seam");
} else {
  try {
    const source = ts.transpileModule(runtimeMatch[1].replace(/\bexport\s+/g, ""), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None }
    }).outputText;
    const sandbox = {};
    vm.runInNewContext(
      `${source}\nglobalThis.characterRedrawRuntime = { planCharacterRedrawSelection, planCharacterRedrawMaskBounds, planCharacterRedrawLayerTransition };`,
      sandbox
    );
    const {
      planCharacterRedrawSelection,
      planCharacterRedrawMaskBounds,
      planCharacterRedrawLayerTransition
    } = sandbox.characterRedrawRuntime;

    const targetLayer = {
      id: "layer-b",
      shotId: "shot-1",
      bitmapPath: "b.png",
      maskPath: "b-mask.png",
      acceptedCompositePath: "accepted-b.png",
      characterGenerationMetadata: { characterAssetId: "char-b", status: "accepted" }
    };
    const otherLayer = {
      id: "layer-a",
      shotId: "shot-1",
      bitmapPath: "a.png",
      maskPath: "a-mask.png",
      acceptedCompositePath: "accepted-a.png",
      characterGenerationMetadata: { characterAssetId: "char-a", status: "accepted" }
    };
    const unrelatedLayer = {
      id: "layer-other-shot",
      shotId: "shot-2",
      bitmapPath: "other.png",
      maskPath: "other-mask.png",
      characterGenerationMetadata: { characterAssetId: "char-b", status: "accepted" }
    };
    const passes = [
      { characterAssetId: "char-a", roleIndex: 0 },
      { characterAssetId: "char-b", roleIndex: 1 }
    ];
    const selection = planCharacterRedrawSelection({
      shotId: "shot-1",
      characterAssetId: "char-b",
      passes,
      layers: [otherLayer, targetLayer, unrelatedLayer]
    });
    assert.equal(selection.ok, true, "one valid target must be selected");
    assert.equal(selection.targetPass.characterAssetId, "char-b");
    assert.equal(selection.targetLayer.id, "layer-b");
    assert.deepEqual(Array.from(selection.protectedMaskPaths), ["a-mask.png"], "only other accepted character masks are protected");
    assert.deepEqual(Array.from(selection.passes, (pass) => pass.characterAssetId), ["char-b"], "redraw plans exactly one pass");

    const missingMask = planCharacterRedrawSelection({
      shotId: "shot-1",
      characterAssetId: "char-b",
      passes,
      layers: [{ ...targetLayer, maskPath: "" }]
    });
    assert.equal(missingMask.ok, false);
    assert.equal(missingMask.reason, "character_redraw_target_mask_missing");

    const layersWithMissingProtectedMask = [{ ...otherLayer, maskPath: "" }, targetLayer, unrelatedLayer];
    const missingProtectedMask = planCharacterRedrawSelection({
      shotId: "shot-1",
      characterAssetId: "char-b",
      passes,
      layers: layersWithMissingProtectedMask
    });
    assert.equal(missingProtectedMask.ok, false, "a missing accepted non-target mask must block redraw planning");
    assert.equal(missingProtectedMask.reason, "character_redraw_protected_mask_missing:layer-a");
    assert.equal(layersWithMissingProtectedMask[0].maskPath, "", "blocked planning must not mutate layer state");

    const rect = { x: 10, y: 20, width: 80, height: 100 };
    assert.deepEqual(
      JSON.parse(JSON.stringify(planCharacterRedrawMaskBounds({ scope: "face_hair", placementRect: rect }))),
      { x: 10, y: 20, width: 80, height: 35 }
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(planCharacterRedrawMaskBounds({ scope: "upper_body", placementRect: rect }))),
      { x: 10, y: 20, width: 80, height: 62 }
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(planCharacterRedrawMaskBounds({ scope: "full_character", placementRect: rect }))),
      rect
    );

    const replacementLayer = {
      ...targetLayer,
      bitmapPath: "b-redrawn.png",
      maskPath: "run/scoped-face-mask.png",
      acceptedCompositePath: "accepted-redraw.png",
      characterGenerationMetadata: {
        ...targetLayer.characterGenerationMetadata,
        retryCount: 2,
        consistencyScore: 0.91
      }
    };
    const accepted = planCharacterRedrawLayerTransition({
      layers: [otherLayer, targetLayer, unrelatedLayer],
      targetLayerId: targetLayer.id,
      previousShotPath: "accepted-shot.png",
      outcome: { status: "accepted", layer: replacementLayer, shotPath: "accepted-redraw.png" }
    });
    assert.equal(accepted.changed, true);
    assert.equal(accepted.layers[0], otherLayer, "accepted redraw must preserve non-target layer identity and paths");
    assert.equal(accepted.layers[1].bitmapPath, "b-redrawn.png", "accepted redraw must replace the target image");
    assert.equal(accepted.layers[1].acceptedCompositePath, "accepted-redraw.png", "accepted redraw must replace the target composite");
    assert.equal(accepted.layers[1].characterGenerationMetadata.retryCount, 2, "accepted redraw must replace target metadata");
    assert.equal(accepted.layers[1].maskPath, "b-mask.png", "face/upper redraw must preserve the canonical full-character mask");
    assert.equal(accepted.layers[2], unrelatedLayer, "accepted redraw must preserve layers for other shots");
    assert.equal(accepted.shotPath, "accepted-redraw.png");

    const review = planCharacterRedrawLayerTransition({
      layers: [otherLayer, targetLayer, unrelatedLayer],
      targetLayerId: targetLayer.id,
      previousShotPath: "accepted-shot.png",
      outcome: { status: "needs_review", bestPreviewPath: "best-preview.png" }
    });
    assert.equal(review.changed, false);
    assert.equal(review.layers[0], otherLayer);
    assert.equal(review.layers[1], targetLayer, "needs_review must keep the previous accepted target layer");
    assert.equal(review.shotPath, "accepted-shot.png", "needs_review must keep the accepted shot path");
    assert.equal(review.bestPreviewPath, "best-preview.png", "needs_review must retain its inspection preview");
  } catch (error) {
    failures.push(`character redraw executable behavior failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

try {
  const repoRoot = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)));
  const bundleResult = await build({
    entryPoints: [path.join(repoRoot, "src/modules/comfy-pipeline/comfyService.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    write: false
  });
  const bundledService = await import(
    `data:text/javascript;base64,${Buffer.from(bundleResult.outputFiles[0].text).toString("base64")}`
  );
  const store = bundledService.storyboardGenerationStore;
  const initialState = store.getState();
  const shot = initialState.shots[0];
  const originalShotPath = shot.generatedImagePath;
  const settings = {
    imageWorkflowJson: "main-workflow-json",
    characterGenerationProvider: "flux2_klein_4b",
    characterGenerationWorkflowJson: "selected-provider-workflow",
    characterGenerationWorkflowJsonByProvider: { qwen_image_edit_2511: "qwen-workflow" },
    baseUrl: "http://mock",
    outputDir: "mock-output",
    comfyInputDir: "mock-input",
    comfyRootDir: "mock-root"
  };
  const assets = initialState.assets.slice(0, 2).map((asset, index) => ({ ...asset, filePath: `reference-${index}.png` }));
  const redraw = { characterAssetId: assets[0]?.id ?? "character-a", scope: "face_hair" };
  const failed = await bundledService.queueStoryboardShot({
    settings,
    shot: { ...shot },
    index: 7,
    allShots: [{ ...shot }],
    assets,
    stageAWorkflowJson: "stage-a-workflow",
    stageBWorkflowJson: "stage-b-workflow",
    workflowId: "character-redraw-face-hair",
    globalStyle: "retry-style",
    negativePrompt: "retry-negative",
    characterRedraw: redraw,
    signal: new AbortController().signal,
    runStage: async () => {
      throw Object.assign(new Error("redraw failed after preview"), {
        errorCode: "redraw_failed",
        bestPreviewPath: "run/review-face.png",
        reviewReasons: ["face", "quality"]
      });
    }
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.bestPreviewPath, "run/review-face.png", "failed task must retain a valid review preview");
  assert.deepEqual(failed.reviewReasons, ["face", "quality"]);
  assert.ok(failed.retrySnapshot, "failed redraw must retain its exact retry snapshot");
  const serializedSnapshot = JSON.stringify(failed.retrySnapshot);
  assert.deepEqual(JSON.parse(serializedSnapshot), failed.retrySnapshot, "retry snapshot must be JSON round-trippable");
  for (const liveControlKey of ["signal", "controller", "runStage", "preflight"]) {
    assert.equal(
      Object.hasOwn(failed.retrySnapshot, liveControlKey),
      false,
      `retry snapshot must exclude live control: ${liveControlKey}`
    );
  }

  const retriedRequests = [];
  const retried = await bundledService.retryStoryboardTask(failed.id, undefined, {
    runStage: async (_stage, current) => {
      retriedRequests.push(current);
      return { status: "accepted", previewUrl: "retry-face.png", localPath: "retry-face.png" };
    }
  });
  assert.equal(retried.status, "completed");
  assert.ok(retriedRequests.length >= 1);
  for (const current of retriedRequests) {
    assert.equal(current.shot.id, shot.id);
    assert.deepEqual(current.characterRedraw, redraw, "retry must preserve the exact target and face_hair scope");
    assert.deepEqual(current.assets, assets, "retry must preserve exact reference assets");
    assert.equal(current.stageAWorkflowJson, "stage-a-workflow");
    assert.equal(current.stageBWorkflowJson, "stage-b-workflow");
    assert.equal(current.settings.characterGenerationProvider, "flux2_klein_4b");
    assert.equal(current.settings.characterGenerationWorkflowJson, "selected-provider-workflow");
  }

  store.setState((state) => ({
    generationTasks: state.generationTasks.map((task) =>
      task.id === failed.id ? { ...task, retrySnapshot: undefined } : task
    )
  }));
  await assert.rejects(
    () => bundledService.retryStoryboardTask(failed.id, settings, { runStage: async () => ({ status: "accepted", previewUrl: "x", localPath: "x" }) }),
    /retry_snapshot_missing/,
    "retry must refuse a task whose exact snapshot is unavailable"
  );

  const cancelController = new AbortController();
  const cancelled = await bundledService.queueStoryboardShot({
    settings,
    shot: { ...shot },
    assets,
    characterRedraw: redraw,
    signal: cancelController.signal,
    runStage: async () => {
      cancelController.abort();
      throw Object.assign(new Error("cancelled after candidate"), {
        bestPreviewPath: "run/cancel-review.png",
        reviewReasons: ["cancelled_after_candidate"]
      });
    }
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.bestPreviewPath, "run/cancel-review.png");
  assert.deepEqual(cancelled.reviewReasons, ["cancelled_after_candidate"]);
  assert.equal(
    store.getState().shots.find((item) => item.id === shot.id)?.generatedImagePath,
    "retry-face.png",
    "failed/cancelled preview retention must not publish to the accepted shot path"
  );
  store.setState(initialState, true);
  assert.equal(originalShotPath, shot.generatedImagePath);
} catch (error) {
  failures.push(`retry/task preview executable behavior failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (failures.length > 0) {
  throw new Error(`Character consistency UI/redraw checks failed:\n- ${failures.join("\n- ")}`);
}

console.log("Character consistency UI/redraw checks passed.");
