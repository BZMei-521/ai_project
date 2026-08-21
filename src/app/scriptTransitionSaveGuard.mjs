function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) result[key] = canonicalize(value[key]);
  }
  return result;
}

export function createScriptTransitionPersistenceFingerprint(state) {
  return JSON.stringify(canonicalize({
    shots: state.shots,
    shotTransitions: state.shotTransitions
  }));
}

export function shouldClearScriptTransitionDirtyAfterSave({
  saved,
  revisionAtSaveStart,
  currentRevision,
  fingerprintAtSaveStart,
  currentFingerprint
}) {
  return (
    saved === true &&
    currentRevision === revisionAtSaveStart &&
    currentFingerprint === fingerprintAtSaveStart
  );
}
