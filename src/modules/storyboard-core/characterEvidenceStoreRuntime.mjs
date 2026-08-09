const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// This is the evidence-specific portion of updateAsset. Keeping it executable in
// plain ESM lets the production store and the security harness exercise the same
// import -> persisted asset -> generation-gate transition.
export function applyCharacterEvidencePatch(asset, patch = {}) {
  if (!plain(asset) || !plain(patch) || (patch.type ?? asset.type) !== "character") return asset;
  return {
    ...asset,
    characterLora: patch.characterLora ?? asset.characterLora,
    characterZeroShotEvidence: patch.characterZeroShotEvidence ?? asset.characterZeroShotEvidence,
    currentZeroContext: patch.currentZeroContext ?? asset.currentZeroContext,
    currentLoraContext: patch.currentLoraContext ?? asset.currentLoraContext
  };
}
