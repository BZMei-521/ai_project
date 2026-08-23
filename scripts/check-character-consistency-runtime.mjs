import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  inferCharacterView,
  inferShotScale,
  routeCharacterReferences,
  selectQueueCharacterReferences,
  buildCharacterPassPlan,
  resolvePreviousCharacterContinuityPaths,
  scoreCharacterConsistency,
  nextCharacterRetryDecision,
  createStoryboardAcceptedResult,
  createStoryboardFallbackReviewResult,
  createStoryboardNeedsReviewResult,
  planStoryboardOutcomeTransition
} from "../src/modules/comfy-pipeline/characterConsistencyRuntime.mjs";

const continuityByShotOrder = resolvePreviousCharacterContinuityPaths({
  currentShotIndex: 3,
  allShots: [{ id: "shot-0" }, { id: "shot-1" }, { id: "shot-2" }, { id: "shot-3" }],
  characterIds: ["hero", "sidekick"],
  layers: [
    {
      shotId: "shot-2",
      acceptedCompositePath: "nearest-hero.png",
      bitmapPath: "nearest-hero-layer.png",
      characterGenerationMetadata: { characterAssetId: "hero", status: "accepted" }
    },
    {
      shotId: "shot-2",
      bitmapPath: "nearest-sidekick-layer.png",
      characterGenerationMetadata: { characterAssetId: "sidekick", status: "accepted" }
    },
    {
      shotId: "shot-1",
      acceptedCompositePath: "regenerated-older-hero.png",
      characterGenerationMetadata: { characterAssetId: "hero", status: "accepted" }
    },
    {
      shotId: "shot-0",
      acceptedCompositePath: "newest-insertion-but-oldest-shot.png",
      characterGenerationMetadata: { characterAssetId: "hero", status: "accepted" }
    }
  ]
});
assert.deepEqual(
  continuityByShotOrder,
  { hero: "nearest-hero.png", sidekick: "nearest-sidekick-layer.png" },
  "continuity must choose the nearest prior storyboard shot, independent of out-of-order layer insertion"
);

const service = readFileSync(new URL("../src/modules/comfy-pipeline/comfyService.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/modules/comfy-pipeline/ComfyPipelinePanel.tsx", import.meta.url), "utf8");
assert.match(
  service,
  /resolvePreviousCharacterContinuityPaths\(\{[\s\S]*?currentShotIndex:\s*index[\s\S]*?allShots[\s\S]*?layers:\s*redrawLayerSnapshot/,
  "production continuity selection must use the shot-order resolver"
);
const between = (source, start, end, label) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `${label}: missing ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `${label}: missing ${end}`);
  return source.slice(startIndex, endIndex);
};
const approximately = (actual, expected, label) => {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${label}: expected ${expected}, received ${actual}`);
};

const identityPack = {
  version: "v1",
  triggerWord: "char_shen",
  faceMasterPath: "face.png",
  faceLeftPath: "left.png",
  faceRightPath: "right.png",
  hairBackPath: "hair-back.png",
  bodyFrontPath: "front.png",
  bodySidePath: "side.png",
  bodyBackPath: "back.png",
  immutableTraits: [],
  forbiddenChanges: [],
  approvedHeroFramePaths: [],
  updatedAt: "2026-08-08"
};

for (const [yaw, view] of [
  [-136, "back"], [-135, "left_profile"], [-51, "left_profile"],
  [-50, "left_three_quarter"], [-26, "left_three_quarter"], [-25, "front"],
  [0, "front"], [25, "front"], [26, "right_three_quarter"],
  [50, "right_three_quarter"], [51, "right_profile"], [135, "right_profile"],
  [136, "back"], [170, "back"]
]) {
  assert.equal(inferCharacterView(yaw), view, `yaw ${yaw}`);
}
assert.equal(inferCharacterView(360), "front");

for (const [text, scale] of [
  ["面部特写，眼神变化", "close"], ["close-up portrait", "close"],
  ["close", "close"],
  ["河边远景，两人全身", "wide"], ["establishing long shot", "wide"],
  ["wide", "wide"], ["long", "wide"],
  ["两人对话", "medium"]
]) assert.equal(inferShotScale(text), scale, text);

assert.deepEqual(
  routeCharacterReferences({ identityPack, view: "left_profile", shotScale: "close" }).map((item) => item.kind),
  ["face_angle", "face_master", "body_view"]
);
assert.deepEqual(
  routeCharacterReferences({ identityPack, view: "right_three_quarter", shotScale: "medium" }).map((item) => item.kind),
  ["body_view", "face_angle", "face_master"]
);
assert.deepEqual(
  routeCharacterReferences({ identityPack, view: "back", shotScale: "wide" }).map((item) => item.kind),
  ["body_view", "hair_back", "face_master"]
);
assert.deepEqual(
  selectQueueCharacterReferences({
    references: routeCharacterReferences({ identityPack, view: "left_profile", shotScale: "medium" }),
    providerId: "flux2_klein_4b"
  }).map((item) => item.kind),
  ["body_view", "face_angle"],
  "Klein profile shots must map deterministically onto its two reference inputs"
);
assert.deepEqual(
  selectQueueCharacterReferences({
    references: routeCharacterReferences({ identityPack, view: "back", shotScale: "wide" }),
    providerId: "flux2_klein_4b"
  }).map((item) => item.kind),
  ["body_view", "hair_back"],
  "Klein back shots must keep the body-back and hair-back pair"
);
assert.equal(
  selectQueueCharacterReferences({
    references: routeCharacterReferences({ identityPack, view: "right_three_quarter", shotScale: "medium" }),
    providerId: "qwen_image_edit_2511"
  }).length,
  3,
  "Qwen keeps its three-reference capacity"
);
assert.deepEqual(
  routeCharacterReferences({
    identityPack: { ...identityPack, faceLeftPath: "face.png", bodySidePath: "" },
    view: "left_profile", shotScale: "close", continuityPath: "previous.png"
  }),
  [
    { kind: "face_angle", path: "face.png" },
    { kind: "continuity", path: "previous.png" }
  ]
);
assert.deepEqual(
  routeCharacterReferences({ identityPack, view: "front", shotScale: "close", continuityPath: "previous.png" }).map((item) => item.kind),
  ["face_angle", "body_view", "continuity"]
);
assert.equal(
  routeCharacterReferences({ identityPack: { ...identityPack, faceMasterPath: "same.png", bodyFrontPath: "same.png" }, view: "front", shotScale: "medium", continuityPath: "same.png" }).length,
  1
);

const passes = buildCharacterPassPlan({
  shot: { id: "s1", cameraYaw: 0, title: "双人近景" },
  characters: [
    { id: "a", name: "A", characterIdentityPack: identityPack },
    { id: "missing", name: "Missing" },
    { id: "b", name: "B", characterIdentityPack: { ...identityPack, triggerWord: "char_b" } }
  ],
  provider: "qwen_image_edit_2511"
});
assert.deepEqual(passes.map((item) => item.characterAssetId), ["a", "b"]);
assert.deepEqual(passes.map((item) => item.roleIndex), [0, 1]);
assert.equal(passes.every((item) => item.references.length <= 3), true);
assert.equal(passes[0].protectPreviousCharacters, false);
assert.equal(passes[1].protectPreviousCharacters, true);
assert.equal(passes[0].refineHead, true);
assert.equal(buildCharacterPassPlan({ shot: { id: "wide", cameraYaw: 170, title: "wide shot" }, characters: [passes[0] && { id: "a", name: "A", characterIdentityPack: identityPack }], provider: "qwen_image_edit_2511" })[0].refineHead, false);

const sparseIdentityPack = {
  ...identityPack,
  faceLeftPath: "",
  faceRightPath: "",
  bodyFrontPath: "",
  bodySidePath: "",
  bodyBackPath: "",
  hairBackPath: ""
};
const continuityPasses = buildCharacterPassPlan({
  shot: { id: "s2", cameraYaw: 0, title: "medium shot" },
  characters: [
    { id: "a", name: "A", characterIdentityPack: sparseIdentityPack },
    { id: "b", name: "B", characterIdentityPack: { ...sparseIdentityPack, triggerWord: "char_b" } }
  ],
  provider: "qwen_image_edit_2511",
  continuityPathsByCharacterId: { a: "previous-a.png", b: "previous-b.png" }
});
assert.deepEqual(
  continuityPasses.map((pass) => pass.references.filter((reference) => reference.kind === "continuity").map((reference) => reference.path)),
  [["previous-a.png"], ["previous-b.png"]],
  "each pass may use only the latest accepted composite for the same character"
);
assert.equal(continuityPasses.every((pass) => pass.references.length <= 3), true, "continuity references must preserve the three-reference cap");

const completeMetrics = { face: 0.8, hair: 0.7, outfit: 0.6, body: 0.5, quality: 0.9 };
const close = scoreCharacterConsistency(completeMetrics, { shotScale: "close", view: "front", threshold: 0.7 });
assert.deepEqual(close.weights, { face: 0.38, hair: 0.3, outfit: 0.12, body: 0.05, quality: 0.15 });
approximately(close.total, 0.746, "close weighted score");
assert.equal(close.passed, true);
assert.ok(close.weights.face + close.weights.hair > close.weights.outfit + close.weights.body, "close shots must emphasize face and hair");
assert.deepEqual(close.failedDimensions, ["outfit", "body"]);

const closeWithoutFace = scoreCharacterConsistency(
  { ...completeMetrics, face: null },
  { shotScale: "close", view: "front", threshold: 0.7 }
);
assert.equal(closeWithoutFace.weights.face, 0);
approximately(closeWithoutFace.weights.hair, 0.3 / 0.62, "null face hair renormalization");
approximately(closeWithoutFace.weights.quality, 0.15 / 0.62, "null face quality renormalization");
approximately(Object.values(closeWithoutFace.weights).reduce((sum, weight) => sum + weight, 0), 1, "null metric normalized weight total");

const closeBack = scoreCharacterConsistency(completeMetrics, { shotScale: "close", view: "back", threshold: 0.7 });
assert.deepEqual(closeBack.weights, { face: 0, hair: 0.49, outfit: 0.31, body: 0.05, quality: 0.15 });
assert.equal(closeBack.missingDimensions.includes("face"), false, "a back view omits face by profile rather than missing data");

const medium = scoreCharacterConsistency(completeMetrics, { shotScale: "medium", view: "front", threshold: 0.5 });
assert.deepEqual(medium.weights, { face: 0.25, hair: 0.25, outfit: 0.2, body: 0.12, quality: 0.18 });

const wide = scoreCharacterConsistency(
  { face: null, hair: 0.9, outfit: 0.85, body: 0.8, quality: 0.9 },
  { shotScale: "wide", view: "front", threshold: 0.75 }
);
assert.equal(wide.passed, true);
assert.deepEqual(wide.weights, { face: 0, hair: 0.3, outfit: 0.28, body: 0.22, quality: 0.2 });
assert.equal(wide.failedDimensions.includes("face"), false);

const sparse = scoreCharacterConsistency(
  { face: null, hair: null, outfit: 0.8, body: null, quality: null },
  { shotScale: "medium", view: "front", threshold: 0.8 }
);
assert.deepEqual(sparse.weights, { face: 0, hair: 0, outfit: 1, body: 0, quality: 0 });
assert.equal(sparse.total, 0.8);
assert.equal(sparse.passed, true, "threshold equality must pass");
assert.deepEqual(sparse.missingDimensions, ["face", "hair", "body", "quality"]);
const noMetrics = scoreCharacterConsistency(
  { face: null, hair: null, outfit: null, body: null, quality: null },
  { shotScale: "medium", view: "front", threshold: 0.1 }
);
assert.equal(noMetrics.total, 0);
assert.equal(noMetrics.passed, false);
assert.equal(noMetrics.availableWeight, 0);

const clamped = scoreCharacterConsistency(
  { face: 2, hair: -1, outfit: Number.NaN, body: Number.POSITIVE_INFINITY, quality: 0.5 },
  { shotScale: "medium", view: "front", threshold: 0.5 }
);
approximately(clamped.weights.face, 0.25 / 0.68, "clamped face weight");
approximately(clamped.weights.hair, 0.25 / 0.68, "clamped hair weight");
assert.equal(clamped.weights.outfit, 0);
assert.equal(clamped.weights.body, 0);
approximately(clamped.weights.quality, 0.18 / 0.68, "clamped quality weight");
approximately(clamped.total, (0.25 + 0.18 * 0.5) / 0.68, "invalid numeric clamp score");
assert.deepEqual(clamped.missingDimensions, ["outfit", "body"]);

const belowThreshold = scoreCharacterConsistency(
  { face: 0.74, hair: 0.74, outfit: 0.74, body: 0.74, quality: 0.74 },
  { shotScale: "medium", view: "front", threshold: 0.75 }
);
assert.equal(belowThreshold.passed, false);
assert.deepEqual(belowThreshold.failedDimensions, ["face", "hair", "outfit", "body", "quality"]);

for (const attempt of [0, 1]) {
  assert.deepEqual(nextCharacterRetryDecision({ attempt, hasHeroReference: false, hasFallbackProvider: false }), { action: "retry_seed" });
}
assert.deepEqual(nextCharacterRetryDecision({ attempt: 2, hasHeroReference: false, hasFallbackProvider: false }), { action: "expand_head_crop" });
assert.deepEqual(nextCharacterRetryDecision({ attempt: 3, hasHeroReference: true, hasFallbackProvider: true }), { action: "add_hero_reference" });
assert.deepEqual(nextCharacterRetryDecision({ attempt: 3, hasHeroReference: false, hasFallbackProvider: true }), { action: "switch_provider" });
assert.deepEqual(nextCharacterRetryDecision({ attempt: 3, hasHeroReference: false, hasFallbackProvider: false }), { action: "needs_review" });
assert.deepEqual(nextCharacterRetryDecision({ attempt: 4, hasHeroReference: true, hasFallbackProvider: true }), { action: "switch_provider" });
assert.deepEqual(nextCharacterRetryDecision({ attempt: 4, hasHeroReference: true, hasFallbackProvider: false }), { action: "needs_review" });
assert.deepEqual(nextCharacterRetryDecision({ attempt: 5, hasHeroReference: true, hasFallbackProvider: true }), { action: "needs_review" });
assert.deepEqual(nextCharacterRetryDecision({ attempt: 500, hasHeroReference: true, hasFallbackProvider: true }), { action: "needs_review" });
assert.deepEqual(
  nextCharacterRetryDecision({ attempt: 4, hasHeroReference: false, fallbackProvider: "flux2_klein_4b" }),
  { action: "switch_provider", provider: "flux2_klein_4b" }
);
assert.deepEqual(
  nextCharacterRetryDecision({ attempt: 4, hasHeroReference: false, fallbackProvider: "unlicensed_cloud_model" }),
  { action: "needs_review" },
  "retry routing must reject providers outside the commercial provider union"
);
for (const attempt of [0, 1, 2, 3, 4, 5, 12]) {
  for (const hasHeroReference of [false, true]) {
    for (const hasFallbackProvider of [false, true]) {
      const decision = nextCharacterRetryDecision({ attempt, hasHeroReference, hasFallbackProvider });
      const expected = attempt <= 1
        ? "retry_seed"
        : attempt === 2
          ? "expand_head_crop"
          : attempt === 3 && hasHeroReference
            ? "add_hero_reference"
            : (attempt === 3 || attempt === 4) && hasFallbackProvider
              ? "switch_provider"
              : "needs_review";
      assert.equal(decision.action, expected, `retry matrix attempt=${attempt} hero=${hasHeroReference} fallback=${hasFallbackProvider}`);
    }
  }
}

const acceptedOutcome = createStoryboardAcceptedResult({ previewUrl: "accepted-preview.png", localPath: "accepted.png" });
assert.deepEqual(acceptedOutcome, { status: "accepted", previewUrl: "accepted-preview.png", localPath: "accepted.png" });
assert.deepEqual(planStoryboardOutcomeTransition(acceptedOutcome), { action: "complete", outputPath: "accepted.png" });
assert.deepEqual(
  planStoryboardOutcomeTransition(createStoryboardAcceptedResult({ previewUrl: "preview-only.png" })),
  { action: "complete", outputPath: "preview-only.png" },
  "accepted preview-only outputs must retain their publishable path"
);
const reviewOutcome = createStoryboardNeedsReviewResult("best-preview.png", ["face", "quality"]);
assert.deepEqual(reviewOutcome, { status: "needs_review", bestPreviewPath: "best-preview.png", reasons: ["face", "quality"] });
assert.deepEqual(
  planStoryboardOutcomeTransition(reviewOutcome),
  { action: "needs_review", bestPreviewPath: "best-preview.png", reasons: ["face", "quality"] }
);
assert.deepEqual(
  createStoryboardFallbackReviewResult("fallback-preview.png", "stageB_validation_failed"),
  { status: "needs_review", bestPreviewPath: "fallback-preview.png", reasons: ["stageB_validation_failed"] },
  "fallback previews must be review-only outcomes"
);

const sequentialBranch = between(
  service,
  "const validateSequentialCharacterOutput",
  "character_consistency_skip=missing_identity_pack",
  "sequential validation and consistency branch"
);
assert.match(service, /import\s*\{[^}]*scoreCharacterConsistency[^}]*nextCharacterRetryDecision[^}]*\}\s*from\s*["']\.\/characterConsistency["']/, "service must import scoring and retry APIs");
assert.match(service, /characterConsistencyBaseline/, "scoring must use the character's Task 1 scale thresholds");
assert.match(sequentialBranch, /scoreCharacterConsistency\(/, "existing validator metrics must feed the consistency scorer");
assert.match(sequentialBranch, /nextCharacterRetryDecision\(/, "validation failure must follow the bounded retry ladder");
assert.match(sequentialBranch, /consistencyScore:/, "persisted metadata must store the consistency score");
assert.match(sequentialBranch, /failureDimensions:/, "persisted metadata must store failure dimensions");
assert.match(sequentialBranch, /status:\s*"needs_review"/, "retry exhaustion must persist needs_review");
assert.match(sequentialBranch, /bestPreviewPath/, "retry exhaustion must retain the best preview");
assert.match(
  sequentialBranch,
  /lastAttempt\s*=\s*attempt[\s\S]*?retryCount:\s*lastAttempt/,
  "needs_review retryCount must record the bounded run's final attempt, not the attempt that produced the best preview"
);
assert.doesNotMatch(sequentialBranch, /storyboard_composite_still_fallback/, "validation failures must never publish fallback stills as success");
assert.match(service, /Promise<StoryboardStagedGenerationResult>/, "staged generation must expose a discriminated result");
assert.match(service, /planStoryboardOutcomeTransition\(/, "queue routing must consume the discriminated outcome transition");
assert.match(service, /markGenerationTaskNeedsReview\(/, "queue routing must persist review without completing the task");
assert.match(service, /fallback[\s\S]*?createStoryboardFallbackReviewResult\(/, "fallback previews must be wrapped as needs_review");
assert.match(sequentialBranch, /generated\.status\s*===\s*"needs_review"/, "sequential publication must bypass accepted-frame publication for review outcomes");
assert.match(panel, /currentOutput\.status\s*===\s*"needs_review"/, "the direct staged caller must branch before normal shot publication");
console.log("PASS character reference routing and pass planning");
