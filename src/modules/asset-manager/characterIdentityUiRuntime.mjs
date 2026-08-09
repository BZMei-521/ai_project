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

const INVALIDATION_KINDS = new Set(["identity", "reference", "provider", "model", "workflow", "fixture", "evaluator", "lora"]);
const invalidatedText = (value, kind) => `${String(value ?? "current").trim() || "current"}::invalidated:${kind}`;
const copyContext = (context) => plainObject(context) ? { ...context, workflowProof: plainObject(context.workflowProof) ? { ...context.workflowProof } : context.workflowProof } : undefined;

function invalidateEvidenceContext(context, changeKind) {
  const next = copyContext(context);
  if (!next) return next;
  if (changeKind === "identity") next.identityPackVersion = invalidatedText(next.identityPackVersion, changeKind);
  if (changeKind === "reference" || changeKind === "fixture") next.referenceManifestDigest = invalidatedText(next.referenceManifestDigest, changeKind);
  if (changeKind === "provider") next.provider = invalidatedText(next.provider, changeKind);
  if (changeKind === "model") next.modelName = invalidatedText(next.modelName, changeKind);
  if (changeKind === "workflow") {
    next.workflowProof = { ...(plainObject(next.workflowProof) ? next.workflowProof : {}), workflowDigest: invalidatedText(next.workflowProof?.workflowDigest, changeKind) };
  }
  if (changeKind === "evaluator") next.evaluatorPolicyHash = invalidatedText(next.evaluatorPolicyHash, changeKind);
  if (changeKind === "lora") next.loraVersion = invalidatedText(next.loraVersion, changeKind);
  return next;
}

export function invalidateCharacterGenerationEvidence(asset = {}, changeKind) {
  if (!INVALIDATION_KINDS.has(changeKind)) return { ...asset };
  const currentZeroContext = copyContext(asset.currentZeroContext ?? asset.currentEvidenceContext);
  const currentLoraContext = copyContext(asset.currentLoraContext);
  const lora = plainObject(asset.characterLora) ? asset.characterLora : undefined;
  const next = { ...asset, currentZeroContext, currentLoraContext };
  if (changeKind === "lora") {
    next.currentLoraContext = invalidateEvidenceContext(currentLoraContext, changeKind);
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
    characterAssetId: context?.characterAssetId,
    identityPackVersion: context?.identityPackVersion,
    provider: context?.provider,
    modelName: context?.modelName,
    loraName: context?.loraName,
    loraVersion: context?.loraVersion,
    loraStrength: context?.loraStrength,
    candidateStatus: context?.candidateStatus,
    workflowProof: context?.workflowProof,
    referenceManifestDigest: context?.referenceManifestDigest,
    evaluatorId: context?.evaluatorId,
    evaluatorVersion: context?.evaluatorVersion,
    evaluatorImplementationHash: context?.evaluatorImplementationHash,
    evaluatorPolicyHash: context?.evaluatorPolicyHash
  };
}

function hasValidLegacyLoraContext(context) {
  return [context?.loraName, context?.loraVersion, context?.modelName, context?.characterAssetId, context?.identityPackVersion, context?.provider].every(nonEmptyText) && Number.isFinite(context?.loraStrength) && context.loraStrength > 0;
}

function hasCurrentEvidenceContext(context) {
  return [context?.referenceManifestDigest, context?.evaluatorId, context?.evaluatorVersion, context?.evaluatorImplementationHash, context?.evaluatorPolicyHash].every(nonEmptyText);
}

export function importCharacterBenchmarkEvidence(report, context, options) {
  if (!plainObject(report) || !nonEmptyText(report.generationMode)) return { valid: false, reason: "legacy_report_not_importable" };
  if (report.generationMode !== "lora_augmented") return { valid: false, reason: "compatibility_mode_not_lora" };
  if (!hasValidLegacyLoraContext(context)) return { valid: false, reason: "legacy_lora_context_invalid" };
  if (!hasCurrentEvidenceContext(context)) return { valid: false, reason: "evidence_context_incomplete" };
  return importCharacterGenerationEvidence(report, buildLoraCompatibilityContext(context), options);
}

export function validateStoredCharacterBenchmarkEvidence(evidence, context) {
  if (!plainObject(evidence)) return { valid: false, reason: "evidence_missing", expectedDigest: null };
  if (!hasValidLegacyLoraContext(context)) return { valid: false, reason: "legacy_lora_context_invalid" };
  if (!nonEmptyText(evidence.generationMode)) return validateStoredCharacterGenerationEvidence(evidence, buildLoraCompatibilityContext(context));
  if (evidence.generationMode !== "lora_augmented") return { valid: false, reason: "compatibility_mode_not_lora" };
  if (!hasCurrentEvidenceContext(context)) return { valid: false, reason: "evidence_context_incomplete" };
  return validateStoredCharacterGenerationEvidence(evidence, buildLoraCompatibilityContext(context));
}

export {
  recomputeCharacterWorkflowDigest,
  recomputeStoredCharacterBenchmarkEvidenceDigest,
};
