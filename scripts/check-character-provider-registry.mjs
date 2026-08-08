import assert from "node:assert/strict";
import {
  CHARACTER_GENERATION_PROVIDERS,
  inspectCharacterProvider,
  selectCharacterProvider
} from "../src/modules/comfy-pipeline/characterProviderRegistryRuntime.mjs";

const readyEnvironment = {
  commercialRequired: true,
  models: ["qwen_image_edit_2511_bf16.safetensors", "flux2_klein_4b_fp8.safetensors"],
  nodes: ["TextEncodeQwenImageEdit", "ReferenceLatent", "FluxGuidance"]
};

assert.equal(selectCharacterProvider(readyEnvironment).selected?.id, "qwen_image_edit_2511");
assert.equal(selectCharacterProvider({
  ...readyEnvironment,
  models: ["flux2_klein_4b_fp8.safetensors"],
  nodes: ["ReferenceLatent", "FluxGuidance"]
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
console.log("PASS commercial character provider registry");
