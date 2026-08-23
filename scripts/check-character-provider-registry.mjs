import assert from "node:assert/strict";
import {
  CHARACTER_GENERATION_PROVIDERS,
  inspectCharacterProvider,
  selectCharacterProvider
} from "../src/modules/comfy-pipeline/characterProviderRegistryRuntime.mjs";

const readyEnvironment = {
  commercialRequired: true,
  models: ["qwen_image_edit_2511_bf16.safetensors", "flux-2-klein-4b-fp8.safetensors"],
  nodes: ["TextEncodeQwenImageEdit", "ReferenceLatent", "CFGGuider", "Flux2Scheduler"]
};

assert.equal(selectCharacterProvider(readyEnvironment).selected?.id, "qwen_image_edit_2511");
assert.equal(selectCharacterProvider({
  ...readyEnvironment,
  models: ["flux-2-klein-4b-fp8.safetensors"],
  nodes: ["ReferenceLatent", "CFGGuider", "Flux2Scheduler"]
}).selected?.id, "flux2_klein_4b");

const licenseBlocked = inspectCharacterProvider(
  { ...CHARACTER_GENERATION_PROVIDERS[0], commercialUse: false },
  readyEnvironment
);
assert.equal(licenseBlocked.available, false);
assert.deepEqual(licenseBlocked.reasons, ["license_blocked"]);

const missingModel = inspectCharacterProvider(CHARACTER_GENERATION_PROVIDERS[0], {
  ...readyEnvironment,
  models: []
});
assert.deepEqual(missingModel.reasons, ["missing_model"]);

const missingNode = inspectCharacterProvider(CHARACTER_GENERATION_PROVIDERS[0], {
  ...readyEnvironment,
  nodes: []
});
assert.deepEqual(missingNode.reasons, ["missing_node"]);

assert.equal(inspectCharacterProvider(CHARACTER_GENERATION_PROVIDERS[0], {
  ...readyEnvironment,
  models: ["models/qwen_image_edit_2511_bf16.safetensors"]
}).available, true, "models match by their exact basename");
assert.deepEqual(inspectCharacterProvider(CHARACTER_GENERATION_PROVIDERS[0], {
  ...readyEnvironment,
  nodes: ["textencodeqwenimageedit"]
}).reasons, ["missing_node"], "node names match exactly");

assert.deepEqual(CHARACTER_GENERATION_PROVIDERS.map((provider) => provider.id), [
  "qwen_image_edit_2511",
  "flux2_klein_4b"
]);

const injectedNineB = {
  id: "flux2_klein_9b",
  displayName: "FLUX.2 Klein 9B",
  commercialUse: true,
  license: "Apache-2.0",
  requiredModels: [],
  requiredNodes: [],
  referenceMode: "multi_reference",
  score: 999,
  hardwareNote: "Must not be selectable."
};
const canonicalSelection = selectCharacterProvider(readyEnvironment, [injectedNineB]);
assert.equal(canonicalSelection.selected?.id, "qwen_image_edit_2511");
assert.equal(canonicalSelection.inspections.some((inspection) => inspection.provider.id === "flux2_klein_9b"), false);
console.log("PASS commercial character provider registry");
