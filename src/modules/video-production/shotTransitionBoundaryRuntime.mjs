const sequencePairKey = (sequenceId, fromShotId, toShotId) =>
  `${sequenceId}\u0000${fromShotId}\u0000${toShotId}`;

export function resolveShotTransitionBoundary(input = {}) {
  const sequenceId = cleanText(input.sequenceId);
  const fromShot = input.fromShot && typeof input.fromShot === "object" ? input.fromShot : {};
  const toShot = input.toShot && typeof input.toShot === "object" ? input.toShot : {};
  const fromShotId = cleanText(fromShot.id);
  const toShotId = cleanText(toShot.id);
  const transitionBySequencePair = new Map(
    (Array.isArray(input.transitions) ? input.transitions : [])
      .filter((item) => item && typeof item === "object")
      .map((item) => [
        sequencePairKey(cleanText(item.sequenceId), cleanText(item.fromShotId), cleanText(item.toShotId)),
        item
      ])
  );
  const configured = transitionBySequencePair.get(sequencePairKey(sequenceId, fromShotId, toShotId));
  if (!configured) {
    const legacySharedFramePath = cleanText(fromShot.approvedBoundaryFramePath);
    return {
      fromShotId,
      toShotId,
      kind: fromShot.videoBoundaryKind ?? "hard_cut",
      ...(legacySharedFramePath ? {
        sharedFramePath: legacySharedFramePath,
        sharedFrameSource: "independent",
        approvalStatus: "approved"
      } : { approvalStatus: "pending" })
    };
  }

  const frameDependency = configured.frameDependency;
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
      ? sharedFramePath ? "approved" : "pending"
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
