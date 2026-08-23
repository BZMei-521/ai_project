export function recommendRunningHub(input = {}) {
  const reasons = [];

  if (
    Number(input.namedCharacterCount) >= 2
    && (input.hasCharacterContact || input.hasOcclusionExchange || input.hasPropTransfer)
  ) {
    reasons.push("character_contact");
  }
  if (Number(input.orderedActionBeatCount) >= 2) reasons.push("ordered_fast_actions");
  if (input.hasCharacterMotion && input.hasCameraMotion) reasons.push("combined_subject_camera_motion");
  if (input.hasCrowdAction) reasons.push("crowd_spatial_action");
  if (
    Number(input.localRetryLimit) > 0
    && Number(input.localQualityFailureCount) >= Number(input.localRetryLimit)
  ) {
    reasons.push("local_quality_exhausted");
  }

  return {
    status: reasons.length ? "cloud_recommended" : "local_default",
    reasons: [...new Set(reasons)]
  };
}
