const uniqueReferences = (items) => {
  const seen = new Set();
  return items.flatMap((item) => {
    const path = String(item?.path ?? "").trim();
    if (!path || seen.has(path)) return [];
    seen.add(path);
    return [{ ...item, path }];
  }).slice(0, 3);
};

export function inferCharacterView(yaw = 0) {
  const normalized = ((((Number(yaw) || 0) + 180) % 360) + 360) % 360 - 180;
  if (normalized >= -25 && normalized <= 25) return "front";
  if (normalized > 25 && normalized <= 50) return "right_three_quarter";
  if (normalized < -25 && normalized >= -50) return "left_three_quarter";
  if (normalized > 50 && normalized <= 135) return "right_profile";
  if (normalized < -50 && normalized >= -135) return "left_profile";
  return "back";
}

export function inferShotScale(text = "") {
  const value = String(text).toLowerCase();
  if (/特写|近景|close(?:[- ]?up| shot)?|portrait/.test(value)) return "close";
  if (/远景|全景|建立镜头|wide(?: shot)?|long(?: shot)?|establishing/.test(value)) return "wide";
  return "medium";
}

export function routeCharacterReferences({ identityPack, view, shotScale, continuityPath = "" }) {
  const anglePath = view.startsWith("left")
    ? identityPack.faceLeftPath
    : view.startsWith("right")
      ? identityPack.faceRightPath
      : view === "back"
        ? identityPack.hairBackPath
        : identityPack.faceMasterPath;
  const bodyPath = view === "back"
    ? identityPack.bodyBackPath
    : view === "front"
      ? identityPack.bodyFrontPath
      : identityPack.bodySidePath;
  const candidates = shotScale === "close"
    ? [
        { kind: "face_angle", path: anglePath },
        { kind: "face_master", path: identityPack.faceMasterPath },
        { kind: "body_view", path: bodyPath }
      ]
    : shotScale === "wide"
      ? [
          { kind: "body_view", path: bodyPath },
          { kind: "hair_back", path: view === "back" ? identityPack.hairBackPath : "" },
          { kind: "face_master", path: identityPack.faceMasterPath }
        ]
      : [
          { kind: "body_view", path: bodyPath },
          { kind: "face_angle", path: anglePath },
          { kind: "face_master", path: identityPack.faceMasterPath }
        ];
  const canonical = uniqueReferences(candidates);
  return uniqueReferences([
    ...canonical,
    ...(canonical.length < 3 ? [{ kind: "continuity", path: continuityPath }] : [])
  ]);
}

export function selectQueueCharacterReferences({ references = [], providerId = "" }) {
  const capacity = providerId === "flux2_klein_4b" ? 2 : 3;
  return uniqueReferences(Array.isArray(references) ? references : []).slice(0, capacity);
}

export function resolvePreviousCharacterContinuityPaths({ currentShotIndex, allShots = [], layers = [], characterIds = [] }) {
  const priorShotsNearestFirst = allShots.slice(0, Math.max(0, Number(currentShotIndex) || 0)).reverse();
  return Object.fromEntries(characterIds.flatMap((characterId) => {
    for (const shot of priorShotsNearestFirst) {
      const layer = layers.find((candidate) =>
        candidate?.shotId === shot?.id &&
        candidate?.characterGenerationMetadata?.status === "accepted" &&
        candidate.characterGenerationMetadata.characterAssetId === characterId &&
        Boolean(String(candidate.acceptedCompositePath ?? candidate.bitmapPath ?? "").trim())
      );
      const path = String(layer?.acceptedCompositePath ?? layer?.bitmapPath ?? "").trim();
      if (path) return [[characterId, path]];
    }
    return [];
  }));
}

export function buildCharacterPassPlan({ shot, characters, provider, continuityPath = "", continuityPathsByCharacterId = {} }) {
  const shotText = [shot.title, shot.storyPrompt, shot.notes, ...(shot.tags ?? [])].filter(Boolean).join(" ");
  const view = inferCharacterView(shot.cameraYaw);
  const shotScale = inferShotScale(shotText);
  return characters
    .filter((character) => character.characterIdentityPack)
    .map((character, roleIndex) => ({
      characterAssetId: character.id,
      characterName: character.name,
      roleIndex,
      provider,
      view,
      shotScale,
      references: routeCharacterReferences({
        identityPack: character.characterIdentityPack,
        view,
        shotScale,
        continuityPath: character.continuityPath ?? continuityPathsByCharacterId[character.id] ?? continuityPath
      }),
      triggerWord: character.characterIdentityPack.triggerWord,
      protectPreviousCharacters: roleIndex > 0,
      refineHead: shotScale !== "wide"
    }));
}

const CONSISTENCY_DIMENSIONS = Object.freeze(["face", "hair", "outfit", "body", "quality"]);
const CONSISTENCY_WEIGHTS = Object.freeze({
  close: Object.freeze({ face: 0.38, hair: 0.3, outfit: 0.12, body: 0.05, quality: 0.15 }),
  medium: Object.freeze({ face: 0.25, hair: 0.25, outfit: 0.2, body: 0.12, quality: 0.18 }),
  wide: Object.freeze({ face: 0, hair: 0.3, outfit: 0.28, body: 0.22, quality: 0.2 })
});
const COMMERCIAL_CHARACTER_PROVIDERS = new Set(["qwen_image_edit_2511", "flux2_klein_4b"]);

const normalizedMetric = (value) => {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric));
};

export function scoreCharacterConsistency(metrics, profile) {
  const shotScale = Object.hasOwn(CONSISTENCY_WEIGHTS, profile?.shotScale) ? profile.shotScale : "medium";
  const threshold = Math.max(0, Math.min(1, Number(profile?.threshold) || 0));
  const adjustedWeights = { ...CONSISTENCY_WEIGHTS[shotScale] };
  if (profile?.view === "back") {
    const originalFaceWeight = adjustedWeights.face;
    adjustedWeights.face = 0;
    adjustedWeights.hair += originalFaceWeight / 2;
    adjustedWeights.outfit += originalFaceWeight / 2;
  }
  const values = Object.fromEntries(
    CONSISTENCY_DIMENSIONS.map((dimension) => [dimension, normalizedMetric(metrics?.[dimension])])
  );
  const availableWeight = CONSISTENCY_DIMENSIONS.reduce(
    (sum, dimension) => sum + (adjustedWeights[dimension] > 0 && values[dimension] !== null ? adjustedWeights[dimension] : 0),
    0
  );
  const weights = Object.fromEntries(
    CONSISTENCY_DIMENSIONS.map((dimension) => [
      dimension,
      availableWeight > 0 && adjustedWeights[dimension] > 0 && values[dimension] !== null
        ? adjustedWeights[dimension] / availableWeight
        : 0
    ])
  );
  const total = availableWeight > 0
    ? CONSISTENCY_DIMENSIONS.reduce((sum, dimension) => sum + (values[dimension] ?? 0) * weights[dimension], 0)
    : 0;
  return {
    total,
    passed: availableWeight > 0 && total >= threshold,
    weights,
    availableWeight,
    failedDimensions: CONSISTENCY_DIMENSIONS.filter(
      (dimension) => weights[dimension] > 0 && values[dimension] !== null && values[dimension] < threshold
    ),
    missingDimensions: CONSISTENCY_DIMENSIONS.filter(
      (dimension) => adjustedWeights[dimension] > 0 && values[dimension] === null
    )
  };
}

export function nextCharacterRetryDecision(input) {
  const attempt = Math.max(0, Math.floor(Number(input?.attempt) || 0));
  if (attempt <= 1) return { action: "retry_seed" };
  if (attempt === 2) return { action: "expand_head_crop" };
  const fallbackProviderSupplied = input?.fallbackProvider !== undefined;
  const fallbackProvider = COMMERCIAL_CHARACTER_PROVIDERS.has(input?.fallbackProvider)
    ? input.fallbackProvider
    : undefined;
  const hasFallbackProvider = fallbackProviderSupplied
    ? Boolean(fallbackProvider)
    : input?.hasFallbackProvider === true;
  if (attempt === 3 && input?.hasHeroReference === true) return { action: "add_hero_reference" };
  if ((attempt === 3 || attempt === 4) && hasFallbackProvider) {
    return fallbackProvider
      ? { action: "switch_provider", provider: fallbackProvider }
      : { action: "switch_provider" };
  }
  return { action: "needs_review" };
}

export function createStoryboardAcceptedResult(output) {
  return {
    status: "accepted",
    previewUrl: String(output?.previewUrl ?? "").trim(),
    localPath: String(output?.localPath ?? "").trim()
  };
}

export function createStoryboardNeedsReviewResult(bestPreviewPath, reasons = []) {
  return {
    status: "needs_review",
    bestPreviewPath: String(bestPreviewPath ?? "").trim(),
    reasons: [...new Set(reasons.map((reason) => String(reason ?? "").trim()).filter(Boolean))]
  };
}

export function createStoryboardFallbackReviewResult(bestPreviewPath, reason) {
  return createStoryboardNeedsReviewResult(bestPreviewPath, [reason]);
}

export function planStoryboardOutcomeTransition(outcome) {
  if (outcome?.status === "needs_review") {
    const review = createStoryboardNeedsReviewResult(outcome.bestPreviewPath, outcome.reasons);
    return { action: "needs_review", bestPreviewPath: review.bestPreviewPath, reasons: review.reasons };
  }
  return {
    action: "complete",
    outputPath: String(outcome?.localPath || outcome?.previewUrl || "").trim()
  };
}
