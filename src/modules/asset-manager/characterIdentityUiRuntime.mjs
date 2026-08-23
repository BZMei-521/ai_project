import {
  CINEMATIC_3D_DONGHUA_CONTRACT,
  computeCharacterStyleContractDigest
} from "../comfy-pipeline/characterStyleContractRuntime.mjs";

export const CHARACTER_SPECIES_OPTIONS = Object.freeze([
  Object.freeze({ value: "human", label: "human" }),
  Object.freeze({ value: "beastfolk", label: "beastfolk" }),
  Object.freeze({ value: "catfolk", label: "catfolk" }),
  Object.freeze({ value: "foxfolk", label: "foxfolk" }),
  Object.freeze({ value: "wolffolk", label: "wolffolk" })
]);

export const CHARACTER_IDENTITY_STYLE_CONTRACT = Object.freeze({
  id: CINEMATIC_3D_DONGHUA_CONTRACT.id,
  version: CINEMATIC_3D_DONGHUA_CONTRACT.version,
  digest: computeCharacterStyleContractDigest(CINEMATIC_3D_DONGHUA_CONTRACT)
});

export const CHARACTER_LORA_PROVIDER_OPTIONS = Object.freeze([
  Object.freeze({
    value: "qwen_image_edit_2511",
    label: "Qwen Image Edit 2511",
    modelName: "qwen_image_edit_2511_bf16.safetensors"
  }),
  Object.freeze({
    value: "flux2_klein_4b",
    label: "FLUX.2 Klein 4B",
    modelName: "flux-2-klein-4b-fp8.safetensors"
  })
]);

const DEFAULT_LORA_PROVIDER = CHARACTER_LORA_PROVIDER_OPTIONS[0];
const CANONICAL_IDENTITY_PATH_FIELDS = Object.freeze([
  "faceMasterPath",
  "faceLeftPath",
  "faceRightPath",
  "hairBackPath",
  "bodyFrontPath",
  "bodySidePath",
  "bodyBackPath"
]);

export function resolveCharacterLoraProvider(provider) {
  return CHARACTER_LORA_PROVIDER_OPTIONS.find((item) => item.value === provider) ?? DEFAULT_LORA_PROVIDER;
}

export function clampCharacterLoraStrength(value = 1) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1.5, Math.max(0, value));
}

export function normalizeCharacterTriggerWord(name) {
  const normalized = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `char_${normalized || "character"}`;
}

export function parseCharacterIdentityList(value) {
  return Array.from(
    new Set(
      String(value ?? "")
        .split(/[\n,，]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export function countCharacterIdentityCompleteness(identity = {}) {
  return CANONICAL_IDENTITY_PATH_FIELDS.filter((field) => String(identity[field] ?? "").trim()).length;
}

export function invalidateCharacterLoraEvidence(lora = {}) {
  return {
    ...lora,
    status: String(lora.loraName ?? "").trim() ? "dataset_ready" : "unconfigured"
  };
}

export function inferCharacterLoraEvidenceInvalidationReason(patch = {}) {
  if (!plainObject(patch)) return "lora_version_mismatch";
  if (Object.prototype.hasOwnProperty.call(patch, "provider")) return "provider_mismatch";
  if (Object.prototype.hasOwnProperty.call(patch, "modelName")) return "model_mismatch";
  if (Object.prototype.hasOwnProperty.call(patch, "loraName")) return "lora_name_mismatch";
  if (Object.prototype.hasOwnProperty.call(patch, "strength")) return "strength_mismatch";
  if (Object.prototype.hasOwnProperty.call(patch, "status")) return "candidate_status_mismatch";
  if (Object.prototype.hasOwnProperty.call(patch, "version")) return "lora_version_mismatch";
  return "lora_version_mismatch";
}

const INVALIDATION_KINDS = new Set(["identity", "reference", "provider", "model", "workflow", "fixture", "evaluator", "lora"]);
const invalidatedText = (value, kind) => `${String(value ?? "current").trim() || "current"}::invalidated:${kind}`;
const copyContext = (context) => plainObject(context) ? { ...context, workflowProof: plainObject(context.workflowProof) ? { ...context.workflowProof } : context.workflowProof } : undefined;

function invalidateEvidenceContext(context, changeKind) {
  const next = copyContext(context);
  if (!next) return next;
  if (changeKind === "identity") next.identityPackVersion = invalidatedText(next.identityPackVersion, changeKind);
  if (changeKind === "reference") next.referenceManifestDigest = invalidatedText(next.referenceManifestDigest, changeKind);
  if (changeKind === "fixture") next.fixtureDigest = invalidatedText(next.fixtureDigest, changeKind);
  if (changeKind === "provider") next.provider = invalidatedText(next.provider, changeKind);
  if (changeKind === "model") next.modelName = invalidatedText(next.modelName, changeKind);
  if (changeKind === "workflow") {
    next.workflowProof = { ...(plainObject(next.workflowProof) ? next.workflowProof : {}), workflowDigest: invalidatedText(next.workflowProof?.workflowDigest, changeKind) };
  }
  if (changeKind === "evaluator") next.evaluatorPolicyHash = invalidatedText(next.evaluatorPolicyHash, changeKind);
  if (changeKind === "lora") {
    const status = context?.candidateStatus;
    next.candidateStatus = ["dataset_ready", "training"].includes(status) ? status : undefined;
  }
  return next;
}

export function invalidateCharacterGenerationEvidence(asset = {}, changeKind) {
  if (!INVALIDATION_KINDS.has(changeKind)) return { ...asset };
  const currentZeroContext = copyContext(asset.currentZeroContext ?? asset.currentEvidenceContext);
  const currentLoraContext = copyContext(asset.currentLoraContext);
  const lora = plainObject(asset.characterLora) ? asset.characterLora : undefined;
  const next = { ...asset, currentZeroContext, currentLoraContext };
  if (changeKind === "lora") {
    next.currentLoraContext = invalidateEvidenceContext({ ...currentLoraContext, candidateStatus: lora?.status }, changeKind);
    if (lora) next.characterLora = invalidateCharacterLoraEvidence(lora);
    return next;
  }
  next.currentZeroContext = invalidateEvidenceContext(currentZeroContext, changeKind);
  next.currentLoraContext = invalidateEvidenceContext(currentLoraContext, changeKind);
  return next;
}
import {
  importCharacterGenerationEvidence,
  recomputeCharacterWorkflowDigest,
  recomputeStoredCharacterBenchmarkEvidenceDigest,
  validateStoredCharacterGenerationEvidence
} from "../comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs";

const nonEmptyText = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
const plainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function buildLoraCompatibilityContext(context) {
  return {
    generationMode: "lora_augmented",
    benchmarkVersion: context?.benchmarkVersion,
    promptTemplateVersion: context?.promptTemplateVersion,
    characterAssetId: context?.characterAssetId,
    identityPackVersion: context?.identityPackVersion,
    identityMetadataDigest: context?.identityMetadataDigest,
    triggerWord: context?.triggerWord,
    immutableTraits: context?.immutableTraits,
    forbiddenChanges: context?.forbiddenChanges,
    species: context?.species,
    speciesTraits: context?.speciesTraits,
    styleContractId: context?.styleContractId,
    styleContractVersion: context?.styleContractVersion,
    styleContractDigest: context?.styleContractDigest,
    provider: context?.provider,
    modelName: context?.modelName,
    loraName: context?.loraName,
    loraVersion: context?.loraVersion,
    loraStrength: context?.loraStrength,
    candidateStatus: context?.candidateStatus,
    workflowProof: context?.workflowProof,
    fixtureDigest: context?.fixtureDigest,
    referenceManifestDigest: context?.referenceManifestDigest,
    evaluatorId: context?.evaluatorId,
    evaluatorVersion: context?.evaluatorVersion,
    evaluatorImplementationHash: context?.evaluatorImplementationHash,
    evaluatorPolicyHash: context?.evaluatorPolicyHash,
    dimensionThreshold: context?.dimensionThreshold
  };
}

function hasValidLegacyLoraContext(context) {
  return [context?.loraName, context?.loraVersion, context?.modelName, context?.characterAssetId, context?.identityPackVersion, context?.provider].every(nonEmptyText) && Number.isFinite(context?.loraStrength) && context.loraStrength > 0;
}

function hasCurrentEvidenceContext(context) {
  return [context?.benchmarkVersion, context?.promptTemplateVersion, context?.fixtureDigest, context?.referenceManifestDigest, context?.evaluatorId, context?.evaluatorVersion, context?.evaluatorImplementationHash, context?.evaluatorPolicyHash].every(nonEmptyText) && Number.isFinite(context?.dimensionThreshold) && context.dimensionThreshold > 0 && context.dimensionThreshold <= 1;
}

export function importCharacterBenchmarkEvidence(report, context, options) {
  if (!plainObject(report) || !nonEmptyText(report.generationMode)) return { valid: false, reason: "legacy_requires_rebenchmark" };
  if (report.generationMode !== "lora_augmented") return { valid: false, reason: "compatibility_mode_not_lora" };
  if (!hasValidLegacyLoraContext(context)) return { valid: false, reason: "legacy_lora_context_invalid" };
  if (!hasCurrentEvidenceContext(context)) return { valid: false, reason: "evidence_context_incomplete" };
  return importCharacterGenerationEvidence(report, buildLoraCompatibilityContext(context), options);
}

export function validateStoredCharacterBenchmarkEvidence(evidence, context, options = {}) {
  if (!plainObject(evidence)) return { valid: false, reason: "evidence_missing", expectedDigest: null };
  if (!hasValidLegacyLoraContext(context)) return { valid: false, reason: "legacy_lora_context_invalid" };
  if (!nonEmptyText(evidence.generationMode)) return validateStoredCharacterGenerationEvidence(evidence, buildLoraCompatibilityContext(context), options);
  if (evidence.generationMode !== "lora_augmented") return { valid: false, reason: "compatibility_mode_not_lora" };
  if (!hasCurrentEvidenceContext(context)) return { valid: false, reason: "evidence_context_incomplete" };
  return validateStoredCharacterGenerationEvidence(evidence, buildLoraCompatibilityContext(context), options);
}

export {
  recomputeCharacterWorkflowDigest,
  recomputeStoredCharacterBenchmarkEvidenceDigest,
};
