const shotPairKey = (fromShotId, toShotId) => JSON.stringify([fromShotId, toShotId]);

export function createShotTransitionBoundaryResolver(input = {}) {
  const sequenceId = cleanText(input.sequenceId);
  const transitionByPair = new Map();
  for (const item of Array.isArray(input.transitions) ? input.transitions : []) {
    if (!item || typeof item !== "object") continue;
    const itemSequenceId = cleanText(item.sequenceId);
    if (itemSequenceId !== sequenceId) continue;
    transitionByPair.set(
      shotPairKey(cleanText(item.fromShotId), cleanText(item.toShotId)),
      item
    );
  }
  return (fromShotValue, toShotValue) => resolveIndexedBoundary({
    fromShotValue,
    toShotValue,
    transitionByPair
  });
}

export function resolveShotTransitionBoundary(input = {}) {
  return createShotTransitionBoundaryResolver(input)(input.fromShot, input.toShot);
}

function resolveIndexedBoundary({ fromShotValue, toShotValue, transitionByPair }) {
  const fromShot = fromShotValue && typeof fromShotValue === "object" ? fromShotValue : {};
  const toShot = toShotValue && typeof toShotValue === "object" ? toShotValue : {};
  const fromShotId = cleanText(fromShot.id);
  const toShotId = cleanText(toShot.id);
  const configured = transitionByPair.get(shotPairKey(fromShotId, toShotId));
  if (!configured) {
    const legacySharedFramePath = cleanText(fromShot.approvedBoundaryFramePath);
    return {
      fromShotId,
      toShotId,
      kind: fromShot.videoBoundaryKind ?? "hard_cut",
      ...(legacySharedFramePath ? {
        sharedFramePath: legacySharedFramePath,
        sharedFrameSource: "independent",
        approvalStatus: "pending"
      } : { approvalStatus: "pending" })
    };
  }

  const frameDependency = configured.type === "hard_cut" ? "none" : configured.frameDependency;
  const sharedFramePath = frameDependency === "shared_frame"
    ? cleanText(configured.sharedFramePath)
    : "";
  return {
    fromShotId,
    toShotId,
    kind: configured.type,
    durationSeconds: configured.durationSeconds,
    ...optionalText("prompt", configured.prompt),
    ...optionalText("negativePrompt", configured.negativePrompt),
    frameDependency,
    ...optionalText("actionContinuity", configured.actionContinuity),
    ...optionalText("characterPosition", configured.characterPosition),
    ...optionalText("cameraDirection", configured.cameraDirection),
    ...optionalText("notes", configured.notes),
    ...(sharedFramePath ? { sharedFramePath } : {}),
    ...(frameDependency === "shared_frame" ? { sharedFrameSource: "independent" } : {}),
    approvalStatus: frameDependency === "shared_frame"
      ? "pending"
      : frameDependency === "previous_tail" && cleanText(fromShot.approvedBoundaryFramePath)
        ? "approved"
        : "pending"
  };
}

function optionalText(key, value) {
  return typeof value === "string" ? { [key]: value } : {};
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}
