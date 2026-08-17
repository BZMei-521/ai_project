import assert from "node:assert/strict";
import { routeVideoWorkflow } from "../src/modules/video-production/videoRouterRuntime.mjs";

const ALL_PROFILES = [
  "minimax_h3_t2v",
  "minimax_h3_i2v",
  "minimax_h3_flf2v",
  "minimax_h3_r2v"
];

const baseInput = {
  manualProfileId: "auto",
  qualityTier: "production",
  accelerationMode: "standard",
  availableProfileIds: ALL_PROFILES,
  namedCharacterCount: 0,
  identityReferenceCount: 0,
  extraReferenceCount: 0,
  hasSceneContinuity: false,
  hasStoryboardFrame: false,
  hasFirstFrame: false,
  hasLastFrame: false,
  hasApprovedBoundaryFrame: false,
  hasDialogue: false,
  boundaryKind: "scene_change"
};

const cases = [
  ["named character without refs", { namedCharacterCount: 1 }, "blocked"],
  ["empty establishing shot", { namedCharacterCount: 0, hasSceneContinuity: false }, "minimax_h3_t2v"],
  ["dialogue closeup", { namedCharacterCount: 1, identityReferenceCount: 1, hasStoryboardFrame: true, hasDialogue: true }, "minimax_h3_i2v"],
  ["explicit endpoint", { namedCharacterCount: 1, identityReferenceCount: 1, hasFirstFrame: true, hasLastFrame: true }, "minimax_h3_flf2v"],
  ["two characters", { namedCharacterCount: 2, identityReferenceCount: 2, hasStoryboardFrame: true }, "minimax_h3_r2v"],
  ["strong style refs", { namedCharacterCount: 1, identityReferenceCount: 1, extraReferenceCount: 2 }, "minimax_h3_r2v"]
];

for (const [name, overrides, expected] of cases) {
  const decision = routeVideoWorkflow({ ...baseInput, ...overrides });
  if (expected === "blocked") {
    assert.equal(decision.status, "blocked", `${name}: must block`);
  } else {
    assert.deepEqual(decision, {
      status: "selected",
      profileId: expected,
      reason: expected === "minimax_h3_t2v" ? "unconstrained_establishing_shot"
        : expected === "minimax_h3_i2v" ? "stable_dialogue_anchor"
          : expected === "minimax_h3_flf2v" ? "explicit_endpoints"
            : "strong_reference_constraints"
    }, `${name}: must select the exact workflow`);
  }
}

assert.deepEqual(
  routeVideoWorkflow({ ...baseInput, manualProfileId: "minimax_h3_i2v" }),
  { status: "selected", profileId: "minimax_h3_i2v", reason: "manual_override" },
  "manual profile must take priority"
);
assert.deepEqual(
  routeVideoWorkflow({ ...baseInput, manualProfileId: "minimax_h3_i2v", availableProfileIds: ["minimax_h3_t2v"] }),
  { status: "blocked", profileId: "minimax_h3_i2v", reason: "profile_unavailable:minimax_h3_i2v" },
  "an unavailable manual profile must block without fallback"
);
assert.deepEqual(
  routeVideoWorkflow({ ...baseInput, qualityTier: "production", accelerationMode: "te_speed_preview" }),
  { status: "selected", profileId: "minimax_h3_t2v", reason: "unconstrained_establishing_shot" },
  "production routing must never choose TE Speed"
);
assert.deepEqual(
  routeVideoWorkflow({
    ...baseInput,
    boundaryKind: "hard_cut",
    hasFirstFrame: true,
    hasLastFrame: false,
    hasApprovedBoundaryFrame: true,
    hasStoryboardFrame: true
  }),
  { status: "selected", profileId: "minimax_h3_i2v", reason: "storyboard_anchor" },
  "a hard cut must not borrow the next shot boundary frame for FLF2V"
);
assert.deepEqual(
  routeVideoWorkflow({
    ...baseInput,
    boundaryKind: "continuous",
    hasApprovedBoundaryFrame: true
  }),
  { status: "selected", profileId: "minimax_h3_flf2v", reason: "explicit_endpoints" },
  "a continuous boundary with an approved shared frame must use FLF2V"
);
assert.deepEqual(
  routeVideoWorkflow({ ...baseInput, namedCharacterCount: 2, identityReferenceCount: 2, availableProfileIds: ["minimax_h3_i2v"] }),
  { status: "blocked", profileId: "minimax_h3_r2v", reason: "profile_unavailable:minimax_h3_r2v" },
  "unavailable strong-reference profile must block rather than downgrade"
);

console.log("PASS video workflow router");
