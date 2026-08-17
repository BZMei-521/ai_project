export function routeVideoWorkflow(input) {
  if (input.manualProfileId && input.manualProfileId !== "auto") {
    return availableOrBlocked(input.manualProfileId, "manual_override", input.availableProfileIds);
  }
  if (input.namedCharacterCount > 0 && input.identityReferenceCount === 0) {
    return { status: "blocked", reason: "named_character_missing_identity_reference" };
  }
  if (input.namedCharacterCount > 1 || input.identityReferenceCount + input.extraReferenceCount >= 3) {
    return availableOrBlocked("minimax_h3_r2v", "strong_reference_constraints", input.availableProfileIds);
  }
  if ((input.boundaryKind === "continuous" && input.hasApprovedBoundaryFrame) || (input.hasFirstFrame && input.hasLastFrame)) {
    return availableOrBlocked("minimax_h3_flf2v", "explicit_endpoints", input.availableProfileIds);
  }
  if (input.hasStoryboardFrame) {
    return availableOrBlocked("minimax_h3_i2v", input.hasDialogue ? "stable_dialogue_anchor" : "storyboard_anchor", input.availableProfileIds);
  }
  if (input.namedCharacterCount === 0 && !input.hasSceneContinuity) {
    return availableOrBlocked("minimax_h3_t2v", "unconstrained_establishing_shot", input.availableProfileIds);
  }
  return { status: "blocked", reason: "no_safe_video_profile" };
}

function availableOrBlocked(profileId, reason, availableProfileIds) {
  return availableProfileIds.includes(profileId)
    ? { status: "selected", profileId, reason }
    : { status: "blocked", profileId, reason: `profile_unavailable:${profileId}` };
}
