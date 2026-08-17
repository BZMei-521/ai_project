import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

const selected = (profileId, reason) => ({ status: "selected", profileId, reason });
const unavailable = (profileId) => ({ status: "blocked", profileId, reason: `profile_unavailable:${profileId}` });
const expectDecision = (name, input, expected) => assert.deepEqual(
  routeVideoWorkflow(input), expected, name
);

const automaticRoutes = [
  ["T2V empty establishing", {}, selected("minimax_h3_t2v", "unconstrained_establishing_shot")],
  ["I2V storyboard", { hasStoryboardFrame: true }, selected("minimax_h3_i2v", "storyboard_anchor")],
  ["FLF2V endpoints", { hasFirstFrame: true, hasLastFrame: true }, selected("minimax_h3_flf2v", "explicit_endpoints")],
  ["R2V strong references", { namedCharacterCount: 2, identityReferenceCount: 2 }, selected("minimax_h3_r2v", "strong_reference_constraints")]
];
for (const [name, overrides, expected] of automaticRoutes) {
  expectDecision(name, { ...baseInput, ...overrides }, expected);
  expectDecision(`${name} unavailable`, {
    ...baseInput,
    ...overrides,
    availableProfileIds: ALL_PROFILES.filter((id) => id !== expected.profileId)
  }, unavailable(expected.profileId));
}

const priorityCases = [
  ["manual override precedes identity block", {
    manualProfileId: "minimax_h3_i2v", namedCharacterCount: 1, identityReferenceCount: 0
  }, selected("minimax_h3_i2v", "manual_override")],
  ["identity block precedes strong references", {
    namedCharacterCount: 2, identityReferenceCount: 0, extraReferenceCount: 3,
    hasFirstFrame: true, hasLastFrame: true, hasStoryboardFrame: true
  }, { status: "blocked", reason: "named_character_missing_identity_reference" }],
  ["strong references precede endpoints", {
    namedCharacterCount: 2, identityReferenceCount: 2, hasFirstFrame: true, hasLastFrame: true, hasStoryboardFrame: true
  }, selected("minimax_h3_r2v", "strong_reference_constraints")],
  ["endpoints precede storyboard", {
    namedCharacterCount: 1, identityReferenceCount: 1, hasFirstFrame: true, hasLastFrame: true, hasStoryboardFrame: true
  }, selected("minimax_h3_flf2v", "explicit_endpoints")],
  ["storyboard precedes establishing", {
    hasStoryboardFrame: true
  }, selected("minimax_h3_i2v", "storyboard_anchor")],
  ["dialogue storyboard has stable anchor reason", {
    namedCharacterCount: 1, identityReferenceCount: 1, hasStoryboardFrame: true, hasDialogue: true
  }, selected("minimax_h3_i2v", "stable_dialogue_anchor")]
];
for (const [name, overrides, expected] of priorityCases) {
  expectDecision(name, { ...baseInput, ...overrides }, expected);
}

expectDecision("unavailable manual profile blocks without fallback", {
  ...baseInput, manualProfileId: "minimax_h3_i2v", availableProfileIds: ["minimax_h3_t2v"]
}, unavailable("minimax_h3_i2v"));

expectDecision("hard cut cannot borrow a boundary frame for FLF2V", {
  ...baseInput,
  boundaryKind: "hard_cut",
  hasFirstFrame: true,
  hasApprovedBoundaryFrame: true,
  hasStoryboardFrame: true
}, selected("minimax_h3_i2v", "storyboard_anchor"));
expectDecision("continuous approved boundary selects FLF2V", {
  ...baseInput, boundaryKind: "continuous", hasApprovedBoundaryFrame: true
}, selected("minimax_h3_flf2v", "explicit_endpoints"));
expectDecision("other boundary kinds do not select FLF2V from an approved frame", {
  ...baseInput, boundaryKind: "match_cut", hasApprovedBoundaryFrame: true, hasStoryboardFrame: true
}, selected("minimax_h3_i2v", "storyboard_anchor"));

for (const accelerationMode of ["standard", "te_speed_preview"]) {
  expectDecision(`production ${accelerationMode} cannot change T2V routing`, {
    ...baseInput, qualityTier: "production", accelerationMode
  }, selected("minimax_h3_t2v", "unconstrained_establishing_shot"));
  expectDecision(`production ${accelerationMode} cannot return a TE profile`, {
    ...baseInput,
    qualityTier: "production",
    accelerationMode,
    hasStoryboardFrame: true
  }, selected("minimax_h3_i2v", "storyboard_anchor"));
}

const defaultCases = [
  ["undefined input defaults to unavailable T2V", undefined, unavailable("minimax_h3_t2v")],
  ["empty input defaults to unavailable T2V", {}, unavailable("minimax_h3_t2v")],
  ["partial manual input preserves requested profile while blocked", { manualProfileId: "minimax_h3_i2v" }, unavailable("minimax_h3_i2v")],
  ["partial named character input blocks for identity", { namedCharacterCount: 1 }, { status: "blocked", reason: "named_character_missing_identity_reference" }],
  ["partial continuous boundary preserves FLF2V profile while blocked", {
    boundaryKind: "continuous", hasApprovedBoundaryFrame: true
  }, unavailable("minimax_h3_flf2v")],
  ["non-array available profiles normalize to empty", { availableProfileIds: "minimax_h3_t2v" }, unavailable("minimax_h3_t2v")]
];
for (const [name, input, expected] of defaultCases) expectDecision(name, input, expected);

const runtimeSource = await readFile(new URL("../src/modules/video-production/videoRouterRuntime.mjs", import.meta.url), "utf8");
async function mutatedRouter(search, replacement) {
  assert.ok(runtimeSource.includes(search), `mutation target must exist: ${search}`);
  const mutated = runtimeSource.replace(search, replacement);
  return (await import(`data:text/javascript,${encodeURIComponent(mutated)}`)).routeVideoWorkflow;
}
async function proveMutationDetected(name, search, replacement, input, expected) {
  const mutatedRoute = await mutatedRouter(search, replacement);
  assert.notDeepEqual(mutatedRoute(input), expected, `${name}: matrix must reject this negative implementation`);
}

await proveMutationDetected(
  "manual-before-identity mutation",
  'if (input.manualProfileId && input.manualProfileId !== "auto") {',
  "if (false) {",
  { ...baseInput, manualProfileId: "minimax_h3_i2v", namedCharacterCount: 1 },
  selected("minimax_h3_i2v", "manual_override")
);
await proveMutationDetected(
  "strong-reference-before-endpoints mutation",
  "if (input.namedCharacterCount > 1 || input.identityReferenceCount + input.extraReferenceCount >= 3) {",
  "if (false) {",
  { ...baseInput, namedCharacterCount: 2, identityReferenceCount: 2, hasFirstFrame: true, hasLastFrame: true },
  selected("minimax_h3_r2v", "strong_reference_constraints")
);

console.log("PASS video workflow router");
