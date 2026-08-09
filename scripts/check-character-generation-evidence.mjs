import assert from "node:assert/strict";
import {
  importCharacterGenerationEvidence,
  recomputeCharacterGenerationEvidenceDigest,
  recomputeStoredCharacterGenerationEvidenceDigest,
  validateCharacterGenerationReport,
  validateStoredCharacterGenerationEvidence
} from "../src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs";

const shotIds = ["front_close", "three_quarter_medium", "left_profile", "right_profile", "back_view", "full_body_action", "strong_expression", "different_lighting"];
const slots = ["face_master", "face_left", "face_right", "hair_back", "body_front", "body_side", "body_back", "expression_neutral"];
const hash = (character) => String(character).slice(-1).repeat(64);
const dimensions = { face: 0.95, hair: 0.94, outfit: 0.93, body: 0.92, quality: 0.96 };
const referenceManifestDigest = hash("a");
const workflowDigest = hash("b");
const fixtureDigest = hash("c");
const generationParametersDigest = hash("d");
const evaluatorImplementationHash = hash("7");
const evaluatorPolicyHash = hash("f");
const modelName = "flux-2-klein-4b-fp8.safetensors";

const zeroShotContext = {
  generationMode: "zero_shot_multi_reference",
  characterAssetId: "asset_ada",
  identityPackVersion: "identity-v1",
  provider: "flux2_klein_4b",
  modelName,
  referenceManifestDigest,
  evaluatorId: "identity-scorer",
  evaluatorVersion: "v1",
  evaluatorImplementationHash,
  evaluatorPolicyHash,
  workflowProof: { workflowDigest, terminalOutputNode: "6", authoritativeModelBindings: [{ model: modelName }], authoritativeLoraBindings: [] }
};
const loraContext = {
  ...zeroShotContext,
  generationMode: "lora_augmented",
  loraName: "ada-v1.safetensors",
  loraVersion: "lora-v1",
  loraStrength: 0.9,
  candidateStatus: "dataset_ready"
};

function makeReport(mode) {
  const isLora = mode === "lora_augmented";
  const report = {
    generationMode: mode,
    benchmarkVersion: "benchmark-v2",
    promptTemplateVersion: "prompt-v2",
    fixtureDigest,
    generationParametersDigest,
    character: zeroShotContext.characterAssetId,
    provider: zeroShotContext.provider,
    referenceManifestDigest,
    references: shotIds.map((shotId, index) => ({ shotId, slot: slots[index], sourceSha256: hash(String(index + 1)), transformedSha256: hash(String(index + 2)), transform: index === 1 ? "mirror_x" : index === 2 ? "head_shoulders_crop" : "none" })),
    subject: {
      characterAssetId: zeroShotContext.characterAssetId,
      provider: zeroShotContext.provider,
      identityPackVersion: zeroShotContext.identityPackVersion,
      modelName,
      ...(isLora ? { loraName: loraContext.loraName, loraVersion: loraContext.loraVersion, loraStrength: loraContext.loraStrength, candidateStatus: loraContext.candidateStatus } : {})
    },
    evaluatorProof: { id: zeroShotContext.evaluatorId, version: zeroShotContext.evaluatorVersion, implementationHash: evaluatorImplementationHash, policyHash: evaluatorPolicyHash, dimensionThreshold: 0.9 },
    preflight: {
      fallbackUsed: false,
      cutoutFallbackUsed: false,
      providerProof: {
        providerId: zeroShotContext.provider,
        workflowDigest,
        terminalOutputNode: "6",
        authoritativeModelBindings: [{ id: "1", classType: "UNETLoader", field: "unet_name", model: modelName }],
        authoritativeLoraBindings: isLora ? [{ id: "4", classType: "LoraLoader", field: "lora_name", loraName: loraContext.loraName, strengthModel: 0.9, strengthClip: 0.9, clipStrengthPolicy: "equal_to_model", modelPathNodeIds: ["4", "2"], modelPathEdges: [{ fromNodeId: "4", fromOutputIndex: 0, toNodeId: "2", toInput: "model" }] }] : []
      }
    },
    aggregate: { status: "accepted", accepted: 8, score: 0.94 },
    shots: shotIds.map((id, index) => ({ id, outputSha256: hash(String(index + 3)), score: 0.95, dimensionScores: { ...dimensions }, retries: 0, finalStatus: "accepted", provenance: "model_generation", actualProvider: zeroShotContext.provider, terminalOutputNode: "6" }))
  };
  report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report);
  return report;
}

const validZeroShotReport = makeReport("zero_shot_multi_reference");
const validLoraReport = makeReport("lora_augmented");
assert.equal(validateCharacterGenerationReport(validZeroShotReport).valid, true);
const zeroShotImport = importCharacterGenerationEvidence(validZeroShotReport, zeroShotContext, { now: () => "2026-08-09T08:00:00.000Z" });
assert.equal(zeroShotImport.valid, true);
assert.equal(zeroShotImport.evidence.generationMode, "zero_shot_multi_reference");
assert.equal(validateCharacterGenerationReport({ ...validZeroShotReport, preflight: { providerProof: validLoraReport.preflight.providerProof } }).valid, false, "zero-shot evidence rejects any active terminal LoRA");
assert.equal(importCharacterGenerationEvidence(validLoraReport, loraContext, { now: () => "2026-08-09T08:00:00.000Z" }).valid, true);
const legacyLoraReport = structuredClone(validLoraReport);
delete legacyLoraReport.generationMode;
legacyLoraReport.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(legacyLoraReport);
assert.equal(importCharacterGenerationEvidence(legacyLoraReport, loraContext).reason, "legacy_report_not_importable", "legacy reports are never imported");
assert.equal(
  importCharacterGenerationEvidence(legacyLoraReport, { ...zeroShotContext, loraName: loraContext.loraName, loraVersion: loraContext.loraVersion, loraStrength: loraContext.loraStrength, candidateStatus: loraContext.candidateStatus }).reason,
  "legacy_report_not_importable",
  "zero-shot contexts cannot use legacy LoRA reports"
);
for (const [label, mutate] of [
  ["fallback", (report) => { report.preflight.fallbackUsed = true; }],
  ["cutout fallback", (report) => { report.preflight.cutoutFallbackUsed = true; }],
  ["conflicting final-path model", (report) => { report.preflight.providerProof.authoritativeModelBindings.push({ id: "9", classType: "UNETLoader", field: "unet_name", model: "conflicting-model.safetensors" }); }]
]) {
  const mutated = structuredClone(validZeroShotReport);
  mutate(mutated);
  mutated.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(mutated);
  assert.equal(validateCharacterGenerationReport(mutated).valid, false, `report-level ${label} is rejected`);
}
const validZeroShotEvidence = zeroShotImport.evidence;
assert.equal(validateStoredCharacterGenerationEvidence(validZeroShotEvidence, { ...zeroShotContext, identityPackVersion: "v2" }).reason, "identity_version_mismatch");
assert.equal(validateStoredCharacterGenerationEvidence(validZeroShotEvidence, { ...zeroShotContext, referenceManifestDigest: hash("f") }).reason, "reference_manifest_mismatch");
assert.equal(validateStoredCharacterGenerationEvidence(validZeroShotEvidence, { ...zeroShotContext, evaluatorImplementationHash: hash("e") }).reason, "evaluator_implementation_mismatch");
assert.equal(
  validateStoredCharacterGenerationEvidence(validZeroShotEvidence, { ...zeroShotContext, workflowProof: { ...zeroShotContext.workflowProof, authoritativeModelBindings: [{ model: modelName }, { model: "conflicting-model.safetensors" }] } }).reason,
  "workflow_model_mismatch",
  "stored evidence rejects a conflicting final-path model binding"
);

function storedMutation(label, mutate, reason) {
  const evidence = structuredClone(validZeroShotEvidence);
  mutate(evidence);
  evidence.evidenceDigest = recomputeStoredCharacterGenerationEvidenceDigest(evidence);
  assert.equal(validateStoredCharacterGenerationEvidence(evidence, zeroShotContext).reason, reason, label);
}
storedMutation("generation mode", (evidence) => { evidence.generationMode = "lora_augmented"; }, "generation_mode_mismatch");
storedMutation("provider", (evidence) => { evidence.provider = "qwen_image_edit_2511"; }, "provider_mismatch");
storedMutation("exact model", (evidence) => { evidence.modelName = "other.safetensors"; evidence.terminalModel = "other.safetensors"; }, "model_mismatch");
storedMutation("workflow digest", (evidence) => { evidence.workflowDigest = hash("9"); }, "workflow_digest_mismatch");
storedMutation("fixture digest", (evidence) => { evidence.fixtureDigest = "not-a-hash"; }, "evidence_shape_invalid");
storedMutation("reference source digest", (evidence) => { evidence.references[0].sourceSha256 = "not-a-hash"; }, "reference_shape_invalid");
storedMutation("reference transformed digest", (evidence) => { evidence.references[0].transformedSha256 = "not-a-hash"; }, "reference_shape_invalid");
storedMutation("reference transform", (evidence) => { evidence.references[0].transform = "rotate"; }, "reference_shape_invalid");
storedMutation("evaluator id", (evidence) => { evidence.evaluatorId = "other-scorer"; }, "evaluator_id_mismatch");
storedMutation("evaluator version", (evidence) => { evidence.evaluatorVersion = "v2"; }, "evaluator_version_mismatch");
storedMutation("evaluator policy hash", (evidence) => { evidence.evaluatorPolicyHash = hash("9"); }, "evaluator_policy_mismatch");
storedMutation("shot status", (evidence) => { evidence.shots[0].finalStatus = "rejected"; }, "shot_shape_invalid");
storedMutation("provenance", (evidence) => { evidence.shots[0].provenance = "fallback"; }, "shot_shape_invalid");
storedMutation("dimension threshold", (evidence) => { evidence.dimensionThreshold = 0.99; }, "dimension_threshold_not_met");
const tamperedDigest = { ...validZeroShotEvidence, evidenceDigest: hash("0") };
assert.equal(validateStoredCharacterGenerationEvidence(tamperedDigest, zeroShotContext).reason, "evidence_digest_mismatch", "evidence digest");

const frozenLegacyLoraEvidence = {
  reportLabel: "legacy.json", evidenceDigest: "", benchmarkVersion: "benchmark-v1", fixtureDigest, characterAssetId: "asset_ada", provider: "flux2_klein_4b", identityPackVersion: "identity-v1", loraName: "ada-v1.safetensors", loraVersion: "lora-v1", modelName, loraStrength: 0.9, candidateStatus: "dataset_ready", workflowDigest, terminalOutputNode: "6", terminalModel: modelName, terminalLoraName: "ada-v1.safetensors", terminalLoraStrengthModel: 0.9, terminalLoraStrengthClip: 0.9, terminalLoraClassType: "LoraLoader", terminalLoraClipPolicy: "equal_to_model", evaluatorHash: evaluatorImplementationHash, evaluatorVersion: "v1", acceptedShots: 8, verifiedAt: "2026-08-09T08:00:00.000Z", importedAt: "2026-08-09T08:00:00.000Z"
};
// This frozen shape intentionally has no generationMode and therefore only remains usable for LoRA migration.
frozenLegacyLoraEvidence.evidenceDigest = recomputeStoredCharacterGenerationEvidenceDigest(frozenLegacyLoraEvidence);
assert.equal(validateStoredCharacterGenerationEvidence(frozenLegacyLoraEvidence, loraContext).valid, true);
assert.equal(validateStoredCharacterGenerationEvidence(frozenLegacyLoraEvidence, loraContext).legacy, true);
assert.equal(validateStoredCharacterGenerationEvidence(frozenLegacyLoraEvidence, zeroShotContext).reason, "legacy_evidence_not_zero_shot");

console.log("character generation evidence checks passed");
