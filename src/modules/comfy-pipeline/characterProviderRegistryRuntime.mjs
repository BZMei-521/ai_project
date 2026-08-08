const modelBasename = (model) => String(model ?? "").trim().split(/[\\/]/).pop();

const hasRequiredValues = (required, available, normalize = (value) => value) =>
  required.every((value) => available.has(normalize(value)));

export const CHARACTER_GENERATION_PROVIDERS = Object.freeze([
  Object.freeze({
    id: "qwen_image_edit_2511",
    displayName: "Qwen-Image-Edit-2511",
    commercialUse: true,
    license: "Apache-2.0",
    requiredModels: ["qwen_image_edit_2511_bf16.safetensors"],
    requiredNodes: ["TextEncodeQwenImageEdit"],
    referenceMode: "native_edit",
    score: 100,
    hardwareNote: "Preferred default on 16GB VRAM with model CPU offload."
  }),
  Object.freeze({
    id: "flux2_klein_4b",
    displayName: "FLUX.2 Klein 4B",
    commercialUse: true,
    license: "Apache-2.0",
    requiredModels: ["flux2_klein_4b_fp8.safetensors"],
    requiredNodes: ["ReferenceLatent", "FluxGuidance"],
    referenceMode: "multi_reference",
    score: 80,
    hardwareNote: "Multi-reference candidate; requires at least 10GB VRAM."
  })
]);

export function inspectCharacterProvider(provider, environment = {}) {
  const models = new Set((environment.models ?? []).map(modelBasename));
  const nodes = new Set((environment.nodes ?? []).map((node) => String(node ?? "").trim()));
  const reasons = [];
  if (environment.commercialRequired && !provider.commercialUse) reasons.push("license_blocked");
  if (!hasRequiredValues(provider.requiredModels ?? [], models, modelBasename)) reasons.push("missing_model");
  if (!hasRequiredValues(provider.requiredNodes ?? [], nodes)) reasons.push("missing_node");
  return {
    provider,
    available: reasons.length === 0,
    reasons,
    missingModels: (provider.requiredModels ?? []).filter((model) => !models.has(modelBasename(model))),
    missingNodes: (provider.requiredNodes ?? []).filter((node) => !nodes.has(node))
  };
}

export function selectCharacterProvider(environment = {}) {
  const inspections = [...CHARACTER_GENERATION_PROVIDERS]
    .map((provider) => inspectCharacterProvider(provider, environment))
    .sort((left, right) => right.provider.score - left.provider.score);
  return { selected: inspections.find((inspection) => inspection.available)?.provider, inspections };
}
