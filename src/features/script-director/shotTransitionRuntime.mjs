const DEFAULT_DURATION_SECONDS = 0.6;

const transitionId = (sequenceId, fromShotId, toShotId) =>
  `shot-transition:${encodeURIComponent(JSON.stringify([sequenceId, fromShotId, toShotId]))}`;

export function createDefaultShotTransition(sequenceId, fromShotId, toShotId, options = {}) {
  const ceiling = Number.isFinite(options.maxDurationSeconds)
    ? Math.max(0, options.maxDurationSeconds)
    : DEFAULT_DURATION_SECONDS;
  return {
    id: transitionId(sequenceId, fromShotId, toShotId),
    sequenceId,
    fromShotId,
    toShotId,
    type: "continuous",
    durationSeconds: Math.min(DEFAULT_DURATION_SECONDS, ceiling),
    frameDependency: "previous_tail",
    actionContinuity: "",
    characterPosition: "",
    cameraDirection: "",
    notes: ""
  };
}

export function reconcileLinearTransitions({ sequenceId, orderedShots, existingTransitions }) {
  const existingByPair = new Map();
  for (const item of existingTransitions) {
    if (item.sequenceId !== sequenceId) continue;
    let byToShotId = existingByPair.get(item.fromShotId);
    if (!byToShotId) {
      byToShotId = new Map();
      existingByPair.set(item.fromShotId, byToShotId);
    }
    byToShotId.set(item.toShotId, item);
  }
  return orderedShots.slice(0, -1).map((fromShot, index) => {
    const toShot = orderedShots[index + 1];
    const ceiling = Math.min(fromShot.durationSeconds, toShot.durationSeconds);
    const existing = existingByPair.get(fromShot.id)?.get(toShot.id);
    if (!existing) return createDefaultShotTransition(sequenceId, fromShot.id, toShot.id, { maxDurationSeconds: ceiling });
    const existingDuration = Number.isFinite(existing.durationSeconds)
      ? existing.durationSeconds
      : DEFAULT_DURATION_SECONDS;
    const durationSeconds = existing.type === "hard_cut"
      ? 0
      : Math.min(Math.max(0, existingDuration), ceiling);
    return { ...existing, durationSeconds };
  });
}

export function moveShotInLinearSequence(input) {
  const sourceIndex = input.orderedShots.findIndex(({ id }) => id === input.shotId);
  if (sourceIndex < 0) return { orderedShots: input.orderedShots, transitions: input.transitions };
  const targetIndex = Math.max(0, Math.min(input.targetIndex, input.orderedShots.length - 1));
  const orderedShots = [...input.orderedShots];
  const [moving] = orderedShots.splice(sourceIndex, 1);
  orderedShots.splice(targetIndex, 0, moving);
  return {
    orderedShots,
    transitions: reconcileLinearTransitions({
      sequenceId: input.sequenceId,
      orderedShots,
      existingTransitions: input.transitions
    })
  };
}

export function removeShotFromLinearSequence(input) {
  const orderedShots = input.orderedShots.filter(({ id }) => id !== input.shotId);
  return {
    orderedShots,
    transitions: reconcileLinearTransitions({
      sequenceId: input.sequenceId,
      orderedShots,
      existingTransitions: input.transitions
    })
  };
}
