import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  CHARACTER_SPECIES_OPTIONS,
  CHARACTER_LORA_PROVIDER_OPTIONS,
  clampCharacterLoraStrength,
  countCharacterIdentityCompleteness,
  importCharacterBenchmarkEvidence as importCharacterBenchmarkEvidenceRuntime,
  inferCharacterLoraEvidenceInvalidationReason,
  invalidateCharacterGenerationEvidence,
  invalidateCharacterLoraEvidence,
  normalizeCharacterTriggerWord,
  parseCharacterIdentityList,
  resolveCharacterLoraProvider,
  validateStoredCharacterBenchmarkEvidence as validateStoredCharacterBenchmarkEvidenceRuntime
} from "../src/modules/asset-manager/characterIdentityUiRuntime.mjs";
import {
  importCharacterGenerationEvidence as importCharacterGenerationEvidenceRuntime,
  recomputeCharacterBenchmarkEvidenceDigest,
  recomputeStoredCharacterBenchmarkEvidenceDigest,
  validateStoredCharacterGenerationEvidence as validateStoredCharacterGenerationEvidenceRuntime
} from "../src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs";
import { resolveCharacterGenerationTrack as resolveCharacterGenerationTrackRuntime } from "../src/modules/comfy-pipeline/sequentialCharacterPassRuntime.mjs";
import { buildCharacterEvidenceReceiptClaims, computeCharacterEvidenceReceiptClaimsDigest } from "../src/modules/comfy-pipeline/characterEvidenceReceiptRuntime.mjs";
import {
  TRUSTED_CHARACTER_EVIDENCE_METADATA,
  applyCharacterGenerationEvidenceImport,
  buildTrustedCharacterGenerationEvidenceContext
} from "../src/modules/comfy-pipeline/characterEvidenceContextRuntime.mjs";
import { applyCharacterEvidencePatch } from "../src/modules/storyboard-core/characterEvidenceStoreRuntime.mjs";
import { computeCharacterIdentityMetadataDigest } from "../src/modules/comfy-pipeline/characterIdentityMetadataRuntime.mjs";
import {
  CINEMATIC_3D_DONGHUA_CONTRACT,
  computeCharacterStyleContractDigest
} from "../src/modules/comfy-pipeline/characterStyleContractRuntime.mjs";

function trustedHarness(source) {
  if (!source || typeof source !== "object" || !source.generationMode || !source.evidenceDigest) return null;
  if (!source.trustedReceipt) {
    const claims = buildCharacterEvidenceReceiptClaims(source, source.sourceReportDigest ?? source.evidenceDigest);
    source.trustedReceipt = { schemaVersion: 1, issuer: "storyboard-desktop-character-evidence-v1", receiptId: "e".repeat(64), ...claims, claimsDigest: computeCharacterEvidenceReceiptClaimsDigest(claims) };
  }
  return { valid: true, receiptId: source.trustedReceipt.receiptId, claimsDigest: source.trustedReceipt.claimsDigest };
}
const importCharacterGenerationEvidence = (report, context, options = {}) => importCharacterGenerationEvidenceRuntime(report, context, { ...options, trustedReceiptVerification: trustedHarness(report) });
const importCharacterBenchmarkEvidence = (report, context, options = {}) => importCharacterBenchmarkEvidenceRuntime(report, context, { ...options, trustedReceiptVerification: trustedHarness(report) });
const validateStoredCharacterGenerationEvidence = (evidence, context) => validateStoredCharacterGenerationEvidenceRuntime(evidence, context, { trustedReceiptVerification: trustedHarness(evidence) });
const validateStoredCharacterBenchmarkEvidence = (evidence, context) => validateStoredCharacterBenchmarkEvidenceRuntime(evidence, context, { trustedReceiptVerification: trustedHarness(evidence) });
const resolveCharacterGenerationTrack = (input) => resolveCharacterGenerationTrackRuntime({ ...input, trustedZeroReceiptVerification: trustedHarness(input?.characterZeroShotEvidence), trustedLoraReceiptVerification: trustedHarness(input?.characterLora?.benchmarkEvidence ?? input?.lora?.benchmarkEvidence) });

assert.equal(clampCharacterLoraStrength(), 1, "default LoRA strength is finite");
assert.equal(clampCharacterLoraStrength(Number.NaN), 1, "NaN LoRA strength falls back safely");
assert.equal(clampCharacterLoraStrength(Number.POSITIVE_INFINITY), 1, "infinite LoRA strength falls back safely");
assert.equal(clampCharacterLoraStrength(Number.NEGATIVE_INFINITY), 1, "negative infinite LoRA strength falls back safely");
assert.equal(clampCharacterLoraStrength(-0.1), 0, "LoRA strength clamps at zero");
assert.equal(clampCharacterLoraStrength(2), 1.5, "LoRA strength clamps at 1.5");
for (const [patch, expected] of [
  [{ loraName: "hero-v2.safetensors" }, "lora_name_mismatch"],
  [{ strength: 0.7 }, "strength_mismatch"],
  [{ provider: "flux2_klein_4b" }, "provider_mismatch"],
  [{ status: "training" }, "candidate_status_mismatch"],
  [{ version: "v2" }, "lora_version_mismatch"]
]) assert.equal(inferCharacterLoraEvidenceInvalidationReason(patch), expected, `LoRA edit reason must identify ${Object.keys(patch)[0]}`);
assert.deepEqual(
  CHARACTER_LORA_PROVIDER_OPTIONS.map(({ value, modelName }) => ({ value, modelName })),
  [
    { value: "qwen_image_edit_2511", modelName: "qwen_image_edit_2511_bf16.safetensors" },
    { value: "flux2_klein_4b", modelName: "flux-2-klein-4b-fp8.safetensors" }
  ],
  "only the two commercial production providers and models are exposed"
);
assert.deepEqual(resolveCharacterLoraProvider(), CHARACTER_LORA_PROVIDER_OPTIONS[0], "the safe Qwen provider is the default");
assert.deepEqual(resolveCharacterLoraProvider("flux2_klein_4b"), CHARACTER_LORA_PROVIDER_OPTIONS[1], "Klein maps to its commercial model");
assert.equal(resolveCharacterLoraProvider("flux2_klein_9b").value, "qwen_image_edit_2511", "unsupported providers fall back to Qwen");
assert.equal(normalizeCharacterTriggerWord(" Shen Yan "), "char_shen_yan", "trigger words normalize Latin names");
assert.equal(normalizeCharacterTriggerWord("沈砚"), "char_character", "non-Latin names receive the safe trigger fallback");
assert.deepEqual(parseCharacterIdentityList("黑发, 蓝瞳\n 长风衣， 黑发"), ["黑发", "蓝瞳", "长风衣"], "identity lists trim and deduplicate saved entries");
assert.equal(countCharacterIdentityCompleteness({
  faceMasterPath: "master",
  faceLeftPath: "left",
  faceRightPath: "right",
  hairBackPath: "hair",
  bodyFrontPath: "front",
  bodySidePath: "side",
  bodyBackPath: "back"
}), 7, "all seven canonical identity slots count as complete");
assert.equal(countCharacterIdentityCompleteness({ faceMasterPath: "master", bodyFrontPath: "front" }), 2, "only canonical populated slots count toward N/7");

const canonicalIdentityMetadata = {
  triggerWord: "char_ada",
  immutableTraits: ["amber eyes", "short black bob"],
  forbiddenChanges: ["blue eyes", "long hair"],
  species: "human",
  speciesTraits: [],
  styleContractId: "cinematic_3d_donghua_v1",
  styleContractVersion: "1.0.0",
  styleContractDigest: computeCharacterStyleContractDigest(CINEMATIC_3D_DONGHUA_CONTRACT)
};

const evidenceContext = {
  generationMode: "lora_augmented",
  benchmarkVersion: "benchmark-v1",
  promptTemplateVersion: "prompt-v1",
  characterAssetId: "asset_ada",
  identityPackVersion: "identity-v3",
  identityMetadataDigest: computeCharacterIdentityMetadataDigest(canonicalIdentityMetadata),
  ...canonicalIdentityMetadata,
  provider: "qwen_image_edit_2511",
  loraName: "ada-v3.safetensors",
  loraVersion: "lora-v3",
  modelName: "qwen_image_edit_2511_bf16.safetensors",
  loraStrength: 0.9,
  candidateStatus: "dataset_ready",
  fixtureDigest: "a".repeat(64),
  referenceManifestDigest: "c".repeat(64),
  evaluatorId: "identity-scorer",
  evaluatorVersion: "evaluator-v1",
  evaluatorImplementationHash: "d".repeat(64),
  evaluatorPolicyHash: "e".repeat(64),
  dimensionThreshold: 0.9,
  workflowProof: {
    workflowDigest: "b".repeat(64),
    terminalOutputNode: "3",
    authoritativeModelBindings: [{ model: "qwen_image_edit_2511_bf16.safetensors" }],
    authoritativeLoraBindings: []
  }
};
const evidenceShotIds = ["front_close", "three_quarter_medium", "left_profile", "right_profile", "back_view", "full_body_action", "strong_expression", "different_lighting"];
const evidenceSlots = ["face_master", "face_left", "face_right", "hair_back", "body_front", "body_side", "body_back", "expression_neutral"];
const makeEvidenceReport = () => {
  const report = {
    generationMode: "lora_augmented",
    benchmarkVersion: "benchmark-v1",
    promptTemplateVersion: "prompt-v1",
    fixtureDigest: "a".repeat(64),
    generationParametersDigest: "b".repeat(64),
    character: evidenceContext.characterAssetId,
    provider: evidenceContext.provider,
    referenceManifestDigest: evidenceContext.referenceManifestDigest,
    references: evidenceShotIds.flatMap((shotId, index) => [
      {
        shotId,
        slot: evidenceSlots[index],
        sourceSha256: "a".repeat(64),
        transformedSha256: "b".repeat(64),
        transform: index === 1 ? "mirror_x" : index === 2 ? "head_shoulders_crop" : "none"
      },
      {
        shotId,
        slot: evidenceSlots[(index + 1) % evidenceSlots.length],
        sourceSha256: "c".repeat(64),
        transformedSha256: "d".repeat(64),
        transform: "none"
      }
    ]),
    subject: {
      characterAssetId: evidenceContext.characterAssetId,
      provider: evidenceContext.provider,
      identityPackVersion: evidenceContext.identityPackVersion,
      identityMetadataDigest: evidenceContext.identityMetadataDigest,
      loraName: evidenceContext.loraName,
      loraVersion: evidenceContext.loraVersion,
      modelName: evidenceContext.modelName,
      loraStrength: evidenceContext.loraStrength,
      candidateStatus: evidenceContext.candidateStatus
    },
    evaluatorProof: {
      id: evidenceContext.evaluatorId,
      version: evidenceContext.evaluatorVersion,
      implementationHash: evidenceContext.evaluatorImplementationHash,
      policyHash: evidenceContext.evaluatorPolicyHash,
      dimensionThreshold: 0.9
    },
    preflight: {
      fallbackUsed: false,
      cutoutFallbackUsed: false,
      providerProof: {
        providerId: evidenceContext.provider,
        workflowDigest: evidenceContext.workflowProof.workflowDigest,
        terminalOutputNode: evidenceContext.workflowProof.terminalOutputNode,
        authoritativeModelBindings: [{ id: "1", classType: "UNETLoader", field: "unet_name", model: evidenceContext.modelName }],
        authoritativeLoraBindings: [{
          id: "4",
          classType: "LoraLoader",
          field: "lora_name",
          loraName: evidenceContext.loraName,
          strengthModel: 0.9,
          strengthClip: 0.9,
          clipStrengthPolicy: "equal_to_model",
          modelPathNodeIds: ["4", "2"],
          modelPathEdges: [{ fromNodeId: "4", fromOutputIndex: 0, toNodeId: "2", toInput: "model" }]
        }]
      }
    },
    aggregate: { status: "accepted", accepted: 8, score: 0.95 },
    shots: evidenceShotIds.map((id, index) => ({
      id,
      outputSha256: "12345678"[index].repeat(64),
      finalStatus: "accepted",
      score: 0.95,
      dimensionScores: { face: 0.95, hair: 0.95, outfit: 0.95, body: 0.95, quality: 0.95 },
      retries: 0,
      actualProvider: evidenceContext.provider,
      provenance: "model_generation",
      terminalOutputNode: "3"
    }))
  };
  report.evidenceDigest = recomputeCharacterBenchmarkEvidenceDigest(report);
  return report;
};
const importedEvidence = importCharacterBenchmarkEvidence(makeEvidenceReport(), evidenceContext, {
  reportLabel: "C:\\benchmarks\\ada-ready.json",
  now: () => "2026-08-08T08:00:00.000Z"
});
assert.equal(importedEvidence.valid, true, "eligible Task 10 evidence imports");
assert.equal(importedEvidence.evidence.reportLabel, "ada-ready.json", "only a safe report label is stored");
assert.equal(importedEvidence.evidence.acceptedShots, 8);
assert.equal(importedEvidence.evidence.candidateStatus, "dataset_ready", "stored evidence retains the pre-ready candidate status");
assert.equal(validateStoredCharacterBenchmarkEvidence(importedEvidence.evidence, evidenceContext).valid, true, "stored evidence revalidates against the current subject");
for (const [reason, evidencePatch] of [
  ["benchmark_version_mismatch", { benchmarkVersion: "evil-benchmark-v999" }],
  ["prompt_template_version_mismatch", { promptTemplateVersion: "evil-prompt-v999" }]
]) {
  const tampered = { ...importedEvidence.evidence, ...evidencePatch };
  tampered.evidenceDigest = recomputeStoredCharacterBenchmarkEvidenceDigest(tampered);
  assert.equal(validateStoredCharacterBenchmarkEvidence(tampered, evidenceContext).reason, reason, `${reason} remains rejected after an attacker recomputes the envelope digest`);
}
const zeroThresholdEvidence = { ...importedEvidence.evidence, dimensionThreshold: 0 };
zeroThresholdEvidence.evidenceDigest = recomputeStoredCharacterBenchmarkEvidenceDigest(zeroThresholdEvidence);
assert.equal(validateStoredCharacterBenchmarkEvidence(zeroThresholdEvidence, { ...evidenceContext, dimensionThreshold: 0 }).valid, false, "a zero dimension threshold is never a trusted acceptance policy");
const assetPanelLoraContext = {
  characterAssetId: evidenceContext.characterAssetId,
  identityPackVersion: evidenceContext.identityPackVersion,
  identityMetadataDigest: evidenceContext.identityMetadataDigest,
  ...canonicalIdentityMetadata,
  provider: evidenceContext.provider,
  loraName: evidenceContext.loraName,
  loraVersion: evidenceContext.loraVersion,
  modelName: evidenceContext.modelName,
  loraStrength: evidenceContext.loraStrength,
  candidateStatus: evidenceContext.candidateStatus,
  workflowProof: {
    workflowDigest: evidenceContext.workflowProof.workflowDigest,
    terminalOutputNode: evidenceContext.workflowProof.terminalOutputNode,
    authoritativeModelBindings: evidenceContext.workflowProof.authoritativeModelBindings
  }
};
const assetPanelImportedEvidence = importCharacterBenchmarkEvidence(makeEvidenceReport(), assetPanelLoraContext, {
  now: () => "2026-08-08T08:00:00.000Z"
});
assert.equal(assetPanelImportedEvidence.reason, "evidence_context_incomplete", "legacy UI context cannot import a new LoRA envelope without current proof context");
assert.equal(validateStoredCharacterBenchmarkEvidence(importedEvidence.evidence, assetPanelLoraContext).reason, "evidence_context_incomplete", "legacy UI context cannot revalidate new stored evidence without current proof context");
for (const [label, contextPatch] of [
  ["reference manifest", { referenceManifestDigest: "f".repeat(64) }],
  ["evaluator ID", { evaluatorId: "other-scorer" }],
  ["evaluator version", { evaluatorVersion: "evaluator-v2" }],
  ["evaluator implementation", { evaluatorImplementationHash: "f".repeat(64) }],
  ["evaluator policy", { evaluatorPolicyHash: "f".repeat(64) }]
]) {
  assert.equal(validateStoredCharacterBenchmarkEvidence(importedEvidence.evidence, { ...evidenceContext, ...contextPatch }).valid, false, `changed ${label} is rejected`);
}
const zeroShotCompatibilityReport = makeEvidenceReport();
zeroShotCompatibilityReport.generationMode = "zero_shot_multi_reference";
zeroShotCompatibilityReport.subject = { ...zeroShotCompatibilityReport.subject };
delete zeroShotCompatibilityReport.subject.loraName;
delete zeroShotCompatibilityReport.subject.loraVersion;
delete zeroShotCompatibilityReport.subject.loraStrength;
delete zeroShotCompatibilityReport.subject.candidateStatus;
zeroShotCompatibilityReport.preflight.providerProof.authoritativeLoraBindings = [];
zeroShotCompatibilityReport.evidenceDigest = recomputeCharacterBenchmarkEvidenceDigest(zeroShotCompatibilityReport);
assert.equal(importCharacterBenchmarkEvidence(zeroShotCompatibilityReport, assetPanelLoraContext).reason, "compatibility_mode_not_lora", "legacy UI context is never a zero-shot shortcut");
const zeroShotContext = {
  generationMode: "zero_shot_multi_reference",
  benchmarkVersion: evidenceContext.benchmarkVersion,
  promptTemplateVersion: evidenceContext.promptTemplateVersion,
  benchmarkVersion: evidenceContext.benchmarkVersion,
  promptTemplateVersion: evidenceContext.promptTemplateVersion,
  characterAssetId: evidenceContext.characterAssetId,
  identityPackVersion: evidenceContext.identityPackVersion,
  identityMetadataDigest: evidenceContext.identityMetadataDigest,
  ...canonicalIdentityMetadata,
  provider: evidenceContext.provider,
  modelName: evidenceContext.modelName,
  fixtureDigest: "a".repeat(64),
  referenceManifestDigest: evidenceContext.referenceManifestDigest,
  evaluatorId: evidenceContext.evaluatorId,
  evaluatorVersion: evidenceContext.evaluatorVersion,
  evaluatorImplementationHash: evidenceContext.evaluatorImplementationHash,
  evaluatorPolicyHash: evidenceContext.evaluatorPolicyHash,
  dimensionThreshold: evidenceContext.dimensionThreshold,
  dimensionThreshold: evidenceContext.dimensionThreshold,
  workflowProof: evidenceContext.workflowProof
};
const importedZeroShotEvidence = importCharacterGenerationEvidence(zeroShotCompatibilityReport, zeroShotContext, {
  reportLabel: "ada-zero-shot.json",
  now: () => "2026-08-08T08:00:00.000Z"
});
assert.equal(importedZeroShotEvidence.valid, true, "a complete zero-shot envelope imports against its own current context");
const validZeroAsset = {
  characterAssetId: evidenceContext.characterAssetId,
  identityPackVersion: evidenceContext.identityPackVersion,
  providerId: evidenceContext.provider,
  modelName: evidenceContext.modelName,
  characterZeroShotEvidence: importedZeroShotEvidence.evidence,
  currentEvidenceContext: zeroShotContext
};
assert.deepEqual(resolveCharacterGenerationTrack(validZeroAsset), {
  mode: "zero_shot_multi_reference",
  providerId: "qwen_image_edit_2511",
  modelName: "qwen_image_edit_2511_bf16.safetensors",
  appliedLora: null
}, "a valid zero-shot track resolves its proven provider and model");
assert.equal(
  resolveCharacterGenerationTrack({ ...validZeroAsset, currentEvidenceContext: { ...zeroShotContext, identityPackVersion: "identity-v4" } }),
  null,
  "stale zero-shot evidence fails closed"
);
const assetWithBoth = {
  ...validZeroAsset,
  characterLora: {
    provider: evidenceContext.provider,
    modelName: evidenceContext.modelName,
    loraName: evidenceContext.loraName,
    strength: evidenceContext.loraStrength,
    version: evidenceContext.loraVersion,
    status: "ready",
    benchmarkEvidence: importedEvidence.evidence
  },
  currentLoraContext: evidenceContext
};
assert.equal(validateStoredCharacterGenerationEvidence(assetWithBoth.characterLora.benchmarkEvidence, assetWithBoth.currentLoraContext).valid, true, "LoRA evidence has a valid full current context before priority resolution");
assert.equal(resolveCharacterGenerationTrack(assetWithBoth).mode, "lora_augmented", "a valid LoRA track wins over valid zero-shot evidence");
assert.equal(
  resolveCharacterGenerationTrack({ ...assetWithBoth, identityPackVersion: "identity-v4" }),
  null,
  "canonical generation identity cannot be overridden by an older LoRA context"
);
for (const [label, input] of [
  ["provider", { ...assetWithBoth, providerId: "flux2_klein_4b" }],
  ["model", { ...assetWithBoth, modelName: "other-model.safetensors" }],
  ["LoRA filename", { ...assetWithBoth, characterLora: { ...assetWithBoth.characterLora, loraName: "ada-v4.safetensors" } }],
  ["LoRA version", { ...assetWithBoth, characterLora: { ...assetWithBoth.characterLora, version: "lora-v4" } }]
]) {
  assert.equal(resolveCharacterGenerationTrack(input), null, `canonical ${label} cannot be overridden by older LoRA context`);
}
assert.deepEqual(
  resolveCharacterGenerationTrack({ characterZeroShotEvidence: importedZeroShotEvidence.evidence, currentEvidenceContext: zeroShotContext }),
  {
    mode: "zero_shot_multi_reference",
    providerId: evidenceContext.provider,
    modelName: evidenceContext.modelName,
    appliedLora: null
  },
  "zero-shot resolution returns the provider and model it actually validated"
);
assert.equal(
  resolveCharacterGenerationTrack({
    ...assetWithBoth,
    characterLora: { ...assetWithBoth.characterLora, benchmarkEvidence: { ...importedEvidence.evidence, evidenceDigest: "0".repeat(64) } },
    compiledWorkflow: { active: { class_type: "LoraLoader", inputs: { lora_name: evidenceContext.loraName, strength_model: 0.9, strength_clip: 0.9 } } }
  }),
  null,
  "an active compiled LoRA blocks unsafe zero-shot fallback when its evidence is invalid"
);
const zeroDigest = importedZeroShotEvidence.evidence.evidenceDigest;
const loraDigest = importedEvidence.evidence.evidenceDigest;
const afterLoraEdit = invalidateCharacterGenerationEvidence(assetWithBoth, "lora");
assert.equal(afterLoraEdit.characterZeroShotEvidence.evidenceDigest, zeroDigest, "LoRA edits retain zero-shot audit evidence");
assert.equal(afterLoraEdit.characterLora.benchmarkEvidence.evidenceDigest, loraDigest, "stale LoRA evidence remains auditable");
assert.equal(validateStoredCharacterGenerationEvidence(afterLoraEdit.characterZeroShotEvidence, afterLoraEdit.currentZeroContext).valid, true, "LoRA edits preserve valid zero-shot context");
assert.equal(validateStoredCharacterGenerationEvidence(afterLoraEdit.characterLora.benchmarkEvidence, afterLoraEdit.currentLoraContext).valid, false, "LoRA edits stale only LoRA evidence");
assert.equal(afterLoraEdit.characterLora.status, "dataset_ready", "LoRA edits downgrade readiness without deleting evidence");
const afterIdentityEdit = invalidateCharacterGenerationEvidence(assetWithBoth, "identity");
assert.equal(afterIdentityEdit.characterZeroShotEvidence.evidenceDigest, zeroDigest, "identity edits retain zero-shot audit evidence");
assert.equal(afterIdentityEdit.characterLora.benchmarkEvidence.evidenceDigest, loraDigest, "identity edits retain LoRA audit evidence");
assert.equal(validateStoredCharacterGenerationEvidence(afterIdentityEdit.characterZeroShotEvidence, afterIdentityEdit.currentZeroContext).valid, false, "identity edits stale zero-shot evidence");
assert.equal(validateStoredCharacterGenerationEvidence(afterIdentityEdit.characterLora.benchmarkEvidence, afterIdentityEdit.currentLoraContext).valid, false, "identity edits stale LoRA evidence");
assert.equal(resolveCharacterGenerationTrack(afterIdentityEdit), null, "track resolution uses invalidated zero-shot context rather than stale input context");
for (const changeKind of ["reference", "provider", "model", "workflow", "fixture", "evaluator"]) {
  const invalidated = invalidateCharacterGenerationEvidence(assetWithBoth, changeKind);
  assert.equal(invalidated.characterZeroShotEvidence.evidenceDigest, zeroDigest, `${changeKind} retains zero-shot history`);
  assert.equal(invalidated.characterLora.benchmarkEvidence.evidenceDigest, loraDigest, `${changeKind} retains LoRA history`);
  assert.equal(validateStoredCharacterGenerationEvidence(invalidated.characterZeroShotEvidence, invalidated.currentZeroContext).valid, false, `${changeKind} stales zero-shot evidence`);
  assert.equal(validateStoredCharacterGenerationEvidence(invalidated.characterLora.benchmarkEvidence, invalidated.currentLoraContext).valid, false, `${changeKind} stales LoRA evidence`);
}
const afterFixtureEdit = invalidateCharacterGenerationEvidence(assetWithBoth, "fixture");
assert.equal(afterFixtureEdit.currentZeroContext.fixtureDigest, `${zeroShotContext.fixtureDigest}::invalidated:fixture`, "fixture invalidation changes the fixture context only");
assert.equal(validateStoredCharacterGenerationEvidence(afterFixtureEdit.characterZeroShotEvidence, afterFixtureEdit.currentZeroContext).reason, "fixture_digest_mismatch", "fixture invalidation reports its own mismatch reason");
assert.equal(validateStoredCharacterGenerationEvidence(afterFixtureEdit.characterLora.benchmarkEvidence, afterFixtureEdit.currentLoraContext).reason, "fixture_digest_mismatch", "fixture invalidation reports the same exact reason for LoRA evidence");
for (const [label, patch] of [["filename", { loraName: "ada-v4.safetensors" }], ["strength", { strength: 0.8 }], ["status", { status: "training" }]]) {
  const invalidated = invalidateCharacterGenerationEvidence({ ...assetWithBoth, characterLora: { ...assetWithBoth.characterLora, ...patch } }, "lora");
  assert.equal(validateStoredCharacterGenerationEvidence(invalidated.characterZeroShotEvidence, invalidated.currentZeroContext).valid, true, `${label} edits leave zero-shot evidence valid`);
  assert.equal(validateStoredCharacterGenerationEvidence(invalidated.characterLora.benchmarkEvidence, invalidated.currentLoraContext).valid, false, `${label} edits stale LoRA evidence`);
}
const missingModeReport = makeEvidenceReport();
delete missingModeReport.generationMode;
missingModeReport.evidenceDigest = recomputeCharacterBenchmarkEvidenceDigest(missingModeReport);
assert.equal(importCharacterBenchmarkEvidence(missingModeReport, evidenceContext).reason, "legacy_requires_rebenchmark", "missing-mode reports are audit-only");
const legacyStoredEvidence = {
  reportLabel: "legacy-lora.json", evidenceDigest: "", benchmarkVersion: "benchmark-v0", fixtureDigest: "a".repeat(64), characterAssetId: evidenceContext.characterAssetId, provider: evidenceContext.provider, identityPackVersion: evidenceContext.identityPackVersion, loraName: evidenceContext.loraName, loraVersion: evidenceContext.loraVersion, modelName: evidenceContext.modelName, loraStrength: evidenceContext.loraStrength, candidateStatus: evidenceContext.candidateStatus, workflowDigest: evidenceContext.workflowProof.workflowDigest, terminalOutputNode: evidenceContext.workflowProof.terminalOutputNode, terminalModel: evidenceContext.modelName, terminalLoraName: evidenceContext.loraName, terminalLoraStrengthModel: evidenceContext.loraStrength, terminalLoraStrengthClip: evidenceContext.loraStrength, terminalLoraClassType: "LoraLoader", terminalLoraClipPolicy: "equal_to_model", evaluatorHash: "d".repeat(64), evaluatorVersion: "evaluator-v1", acceptedShots: 8, verifiedAt: "2026-08-08T08:00:00.000Z", importedAt: "2026-08-08T08:00:00.000Z"
};
legacyStoredEvidence.evidenceDigest = recomputeStoredCharacterBenchmarkEvidenceDigest(legacyStoredEvidence);
assert.equal(validateStoredCharacterBenchmarkEvidence(legacyStoredEvidence, evidenceContext).reason, "legacy_requires_rebenchmark", "stored legacy LoRA evidence remains audit-only");
assert.equal(validateStoredCharacterBenchmarkEvidence(legacyStoredEvidence, assetPanelLoraContext).reason, "legacy_requires_rebenchmark", "legacy LoRA evidence cannot unlock through the old UI context");
assert.equal(
  validateStoredCharacterBenchmarkEvidence(legacyStoredEvidence, { ...evidenceContext, fixtureDigest: "f".repeat(64) }).reason,
  "legacy_requires_rebenchmark",
  "legacy LoRA evidence always requires a new authenticated benchmark"
);
assert.equal(
  importCharacterBenchmarkEvidence(makeEvidenceReport(), { ...evidenceContext, candidateStatus: "training" }).valid,
  false,
  "report candidate status must match the current pre-ready profile at import"
);
const trainingReport = makeEvidenceReport();
trainingReport.subject.candidateStatus = "training";
trainingReport.evidenceDigest = recomputeCharacterBenchmarkEvidenceDigest(trainingReport);
assert.equal(
  importCharacterBenchmarkEvidence(trainingReport, { ...evidenceContext, candidateStatus: "training" }).valid,
  true,
  "training candidates may import evidence when report and profile statuses match"
);
for (const invalidStatus of ["ready", "unconfigured", "failed", undefined]) {
  const invalidCandidate = makeEvidenceReport();
  invalidCandidate.subject.candidateStatus = invalidStatus;
  invalidCandidate.evidenceDigest = recomputeCharacterBenchmarkEvidenceDigest(invalidCandidate);
  assert.equal(
    importCharacterBenchmarkEvidence(invalidCandidate, { ...evidenceContext, candidateStatus: invalidStatus }).valid,
    false,
    `invalid benchmark candidate status ${String(invalidStatus)} fails closed`
  );
}
const tamperedStoredStatus = { ...importedEvidence.evidence, candidateStatus: "training" };
assert.equal(
  validateStoredCharacterBenchmarkEvidence(tamperedStoredStatus, evidenceContext).valid,
  false,
  "stored evidence digest binds the candidate status"
);
const tamperedDigest = makeEvidenceReport(); tamperedDigest.evidenceDigest = "0".repeat(64);
assert.equal(importCharacterBenchmarkEvidence(tamperedDigest, evidenceContext).valid, false, "tampered report digests fail closed");
for (const [label, mutate] of [
  ["character", (report) => { report.subject.characterAssetId = "asset_other"; report.character = "asset_other"; }],
  ["provider", (report) => { report.subject.provider = "flux2_klein_4b"; report.provider = "flux2_klein_4b"; report.preflight.providerProof.providerId = "flux2_klein_4b"; report.shots.forEach((shot) => { shot.actualProvider = "flux2_klein_4b"; }); }],
  ["identity", (report) => { report.subject.identityPackVersion = "identity-v4"; }],
  ["LoRA name", (report) => { report.subject.loraName = "other.safetensors"; report.preflight.providerProof.authoritativeLoraBindings[0].loraName = "other.safetensors"; }],
  ["LoRA version", (report) => { report.subject.loraVersion = "lora-v4"; }],
  ["model", (report) => { report.subject.modelName = "other.safetensors"; report.preflight.providerProof.authoritativeModelBindings[0].model = "other.safetensors"; }],
  ["strength", (report) => { report.subject.loraStrength = 0.8; report.preflight.providerProof.authoritativeLoraBindings[0].strengthModel = 0.8; report.preflight.providerProof.authoritativeLoraBindings[0].strengthClip = 0.8; }],
  ["workflow", (report) => { report.preflight.providerProof.workflowDigest = "d".repeat(64); }]
]) {
  const mismatch = makeEvidenceReport(); mutate(mismatch); mismatch.evidenceDigest = recomputeCharacterBenchmarkEvidenceDigest(mismatch);
  assert.equal(importCharacterBenchmarkEvidence(mismatch, evidenceContext).valid, false, `wrong ${label} evidence is rejected`);
}
const wrongEvaluator = makeEvidenceReport(); wrongEvaluator.evaluatorProof.implementationHash = "not-a-hash"; wrongEvaluator.evidenceDigest = recomputeCharacterBenchmarkEvidenceDigest(wrongEvaluator);
assert.equal(importCharacterBenchmarkEvidence(wrongEvaluator, evidenceContext).valid, false, "invalid evaluator proof is rejected");
const sevenAccepted = makeEvidenceReport(); sevenAccepted.aggregate.accepted = 7; sevenAccepted.shots = sevenAccepted.shots.slice(0, 7); sevenAccepted.evidenceDigest = recomputeCharacterBenchmarkEvidenceDigest(sevenAccepted);
assert.equal(importCharacterBenchmarkEvidence(sevenAccepted, evidenceContext).valid, false, "7/8 accepted evidence is rejected");
assert.equal(validateStoredCharacterBenchmarkEvidence(importedEvidence.evidence, { ...evidenceContext, identityPackVersion: "identity-v4" }).valid, false, "identity edits stale stored evidence");
assert.deepEqual(invalidateCharacterLoraEvidence({ loraName: "ada.safetensors", status: "ready", benchmarkEvidence: importedEvidence.evidence }), { loraName: "ada.safetensors", status: "dataset_ready", benchmarkEvidence: importedEvidence.evidence }, "candidate LoRA invalidation retains auditable evidence and downgrades readiness");
assert.deepEqual(invalidateCharacterLoraEvidence({ loraName: "", status: "ready", benchmarkEvidence: importedEvidence.evidence }), { loraName: "", status: "unconfigured", benchmarkEvidence: importedEvidence.evidence }, "missing candidate LoRA invalidation retains evidence and becomes unconfigured");

const source = await readFile(new URL("../src/modules/asset-manager/AssetPanel.tsx", import.meta.url), "utf8");
const storeSource = await readFile(new URL("../src/modules/storyboard-core/store.ts", import.meta.url), "utf8");
const comfyServiceSource = await readFile(new URL("../src/modules/comfy-pipeline/comfyService.ts", import.meta.url), "utf8");
const evidenceContextFacadeSource = await readFile(new URL("../src/modules/comfy-pipeline/characterEvidenceContext.ts", import.meta.url), "utf8");
const desktopBridgeSource = await readFile(new URL("../src/modules/platform/desktopBridge.ts", import.meta.url), "utf8");
const tauriSource = await readFile(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8");
const css = await readFile(new URL("../src/styles/global.css", import.meta.url), "utf8");
const editorMatch = source.match(/<section[^>]*className="character-identity-editor">[\s\S]*?<\/section>/);
assert.ok(editorMatch, "missing character identity editor section");
const editor = editorMatch[0];

for (const label of ["导入零样本基准证据", "导入 LoRA 基准证据", "零样本已验证", "LoRA 已验证", "待复核", "证据已失效"]) {
  assert.match(editor, new RegExp(label), `dual-track UI is missing ${label}`);
}
assert.match(editor, /reference_manifest_mismatch/, "the UI must expose exact reference invalidation reasons");
assert.match(editor, /evaluator_implementation_mismatch/, "the UI must expose exact evaluator invalidation reasons");
assert.doesNotMatch(editor, /设为已就绪|手动就绪/, "readiness must not be manually asserted");
assert.match(editor, /onImportCharacterGenerationEvidence\(asset, "zero_shot_multi_reference"/, "zero-shot files must use the strict mode-aware importer");
assert.match(editor, /onImportCharacterGenerationEvidence\(asset, "lora_augmented"/, "LoRA files must use the strict mode-aware importer");

const trustedSourceHashes = Object.fromEntries([
  "face_master", "face_left", "face_right", "hair_back", "body_front", "body_side", "body_back", "expression_neutral"
].map((slot, index) => [slot, String(index + 1).repeat(64)]));
const trustedAsset = {
  id: evidenceContext.characterAssetId,
  type: "character",
  characterIdentityPack: {
    version: evidenceContext.identityPackVersion,
    ...canonicalIdentityMetadata,
    faceMasterPath: "face.png",
    faceLeftPath: "left.png",
    faceRightPath: "right.png",
    hairBackPath: "hair.png",
    bodyFrontPath: "front.png",
    bodySidePath: "side.png",
    bodyBackPath: "back.png",
    neutralExpressionPath: "neutral.png"
  },
  characterLora: {
    provider: evidenceContext.provider,
    modelName: evidenceContext.modelName,
    loraName: evidenceContext.loraName,
    version: evidenceContext.loraVersion,
    strength: evidenceContext.loraStrength,
    status: "dataset_ready"
  }
};
const buildTrustedContext = (mode) => buildTrustedCharacterGenerationEvidenceContext({
  asset: trustedAsset,
  mode,
  providerId: evidenceContext.provider,
  modelName: evidenceContext.modelName,
  workflowProof: evidenceContext.workflowProof,
  referenceSourceHashes: trustedSourceHashes
});
const trustedZeroContextResult = buildTrustedContext("zero_shot_multi_reference");
const trustedLoraContextResult = buildTrustedContext("lora_augmented");
assert.equal(trustedZeroContextResult.ok, true, "the app must independently build a complete current zero-shot context");
assert.equal(trustedLoraContextResult.ok, true, "the app must independently build a complete current LoRA context");
for (const field of ["triggerWord", "immutableTraits", "forbiddenChanges", "species", "speciesTraits", "styleContractId", "styleContractVersion", "styleContractDigest"]) {
  assert.deepEqual(trustedZeroContextResult.context[field], canonicalIdentityMetadata[field], `trusted context binds canonical ${field}`);
}
assert.equal(buildTrustedCharacterGenerationEvidenceContext({
  asset: {
    ...trustedAsset,
    characterIdentityPack: { ...trustedAsset.characterIdentityPack, styleContractDigest: "0".repeat(64) }
  },
  mode: "zero_shot_multi_reference",
  providerId: evidenceContext.provider,
  modelName: evidenceContext.modelName,
  workflowProof: evidenceContext.workflowProof,
  referenceSourceHashes: trustedSourceHashes
}).reason, "style_contract_mismatch", "trusted evidence context rejects a non-canonical style digest");
const editedMetadataAsset = structuredClone(trustedAsset);
editedMetadataAsset.characterIdentityPack.immutableTraits = ["long silver hair", "amber eyes"];
const editedMetadataContext = buildTrustedCharacterGenerationEvidenceContext({
  asset: editedMetadataAsset,
  mode: "zero_shot_multi_reference",
  providerId: evidenceContext.provider,
  modelName: evidenceContext.modelName,
  workflowProof: evidenceContext.workflowProof,
  referenceSourceHashes: trustedSourceHashes
});
assert.equal(editedMetadataContext.ok, true);
assert.notEqual(editedMetadataContext.context.identityMetadataDigest, trustedZeroContextResult.context.identityMetadataDigest, "identity metadata changes must rebuild a different trusted digest without relying on a version bump");
assert.equal(buildTrustedCharacterGenerationEvidenceContext({
  asset: trustedAsset,
  mode: "zero_shot_multi_reference",
  providerId: "flux2_klein_4b",
  modelName: "flux-2-klein-4b-fp8.safetensors",
  workflowProof: { ...evidenceContext.workflowProof, authoritativeModelBindings: [{ model: "flux-2-klein-4b-fp8.safetensors" }] },
  referenceSourceHashes: trustedSourceHashes
}).ok, true, "zero-shot context does not couple generation provider selection to the asset's LoRA profile provider");
for (const result of [trustedZeroContextResult, trustedLoraContextResult]) {
  assert.equal(result.context.fixtureDigest, TRUSTED_CHARACTER_EVIDENCE_METADATA.fixtureDigest);
  assert.equal(result.context.evaluatorImplementationHash, TRUSTED_CHARACTER_EVIDENCE_METADATA.evaluatorImplementationHash);
  assert.notEqual(result.context.referenceManifestDigest, zeroShotCompatibilityReport.referenceManifestDigest, "current reference proof is computed from the asset, not copied from the report");
}

const makeTrustedReport = (mode, context) => {
  const report = makeEvidenceReport();
  report.generationMode = mode;
  report.benchmarkVersion = context.benchmarkVersion;
  report.promptTemplateVersion = context.promptTemplateVersion;
  report.fixtureDigest = context.fixtureDigest;
  report.referenceManifestDigest = context.referenceManifestDigest;
  report.subject.identityMetadataDigest = context.identityMetadataDigest;
  report.evaluatorProof = {
    id: context.evaluatorId,
    version: context.evaluatorVersion,
    implementationHash: context.evaluatorImplementationHash,
    policyHash: context.evaluatorPolicyHash,
    dimensionThreshold: TRUSTED_CHARACTER_EVIDENCE_METADATA.dimensionThreshold
  };
  if (mode === "zero_shot_multi_reference") {
    delete report.subject.loraName;
    delete report.subject.loraVersion;
    delete report.subject.loraStrength;
    delete report.subject.candidateStatus;
    report.preflight.providerProof.authoritativeLoraBindings = [];
  }
  report.evidenceDigest = recomputeCharacterBenchmarkEvidenceDigest(report);
  return report;
};
const trustedZeroReport = makeTrustedReport("zero_shot_multi_reference", trustedZeroContextResult.context);
const trustedLoraReport = makeTrustedReport("lora_augmented", trustedLoraContextResult.context);
const trustedZeroVerification = trustedHarness(trustedZeroReport);
const trustedLoraVerification = trustedHarness(trustedLoraReport);
assert.equal(
  applyCharacterGenerationEvidenceImport({ asset: trustedAsset, mode: "lora_augmented", report: trustedZeroReport, context: trustedLoraContextResult.context }).reason,
  "generation_mode_mismatch",
  "zero-shot reports cannot mutate the LoRA slot"
);
assert.equal(
  applyCharacterGenerationEvidenceImport({ asset: trustedAsset, mode: "zero_shot_multi_reference", report: trustedLoraReport, context: trustedZeroContextResult.context }).reason,
  "generation_mode_mismatch",
  "LoRA reports cannot mutate the zero-shot slot"
);
const zeroImport = applyCharacterGenerationEvidenceImport({ asset: trustedAsset, mode: "zero_shot_multi_reference", report: trustedZeroReport, context: trustedZeroContextResult.context, reportLabel: "zero.json", now: () => "2026-08-09T00:00:00.000Z", trustedReceiptVerification: trustedZeroVerification });
assert.equal(zeroImport.valid, true, JSON.stringify(zeroImport));
assert.equal(validateStoredCharacterGenerationEvidence(zeroImport.evidence, editedMetadataContext.context).reason, "identity_metadata_mismatch", "an async trusted-context rebuild after metadata editing must not revive old evidence");
const assetAfterZero = applyCharacterEvidencePatch(trustedAsset, zeroImport.patch);
assert.equal(resolveCharacterGenerationTrack({
  characterAssetId: editedMetadataAsset.id,
  identityPackVersion: editedMetadataAsset.characterIdentityPack.version,
  providerId: evidenceContext.provider,
  modelName: evidenceContext.modelName,
  characterZeroShotEvidence: assetAfterZero.characterZeroShotEvidence,
  currentZeroContext: editedMetadataContext.context,
  workflowProof: evidenceContext.workflowProof
}), null, "production generation remains gated after identity metadata editing and async trusted-context reconstruction");
const loraImport = applyCharacterGenerationEvidenceImport({ asset: assetAfterZero, mode: "lora_augmented", report: trustedLoraReport, context: trustedLoraContextResult.context, reportLabel: "lora.json", now: () => "2026-08-09T00:00:00.000Z", trustedReceiptVerification: trustedLoraVerification });
assert.equal(loraImport.valid, true, JSON.stringify(loraImport));
const assetAfterBoth = applyCharacterEvidencePatch(assetAfterZero, loraImport.patch);
assert.ok(assetAfterBoth.characterZeroShotEvidence, "zero-shot evidence persists independently");
assert.ok(assetAfterBoth.currentZeroContext, "the trusted zero-shot current context persists");
assert.ok(assetAfterBoth.characterLora.benchmarkEvidence, "LoRA evidence persists independently");
assert.ok(assetAfterBoth.currentLoraContext, "the trusted LoRA current context persists");
assert.equal(resolveCharacterGenerationTrack({
  characterAssetId: assetAfterBoth.id,
  identityPackVersion: assetAfterBoth.characterIdentityPack.version,
  providerId: evidenceContext.provider,
  modelName: evidenceContext.modelName,
  characterLora: assetAfterBoth.characterLora,
  characterZeroShotEvidence: assetAfterBoth.characterZeroShotEvidence,
  currentZeroContext: assetAfterBoth.currentZeroContext,
  currentLoraContext: assetAfterBoth.currentLoraContext,
  workflowProof: evidenceContext.workflowProof
}).mode, "lora_augmented", "the AssetPanel import patch reaches the production generation gate");
const afterImportedLoraEdit = invalidateCharacterGenerationEvidence(assetAfterBoth, "lora");
assert.equal(validateStoredCharacterGenerationEvidence(afterImportedLoraEdit.characterZeroShotEvidence, afterImportedLoraEdit.currentZeroContext).valid, true, "LoRA edits preserve the displayed zero-shot badge");
assert.equal(validateStoredCharacterGenerationEvidence(afterImportedLoraEdit.characterLora.benchmarkEvidence, afterImportedLoraEdit.currentLoraContext).valid, false, "LoRA edits stale only the LoRA badge");

assert.match(source, /asset\.type === "character" && \(\(\) => \{[\s\S]*?<section[^>]*className="character-identity-editor">/, "identity editor must be placed on character cards only");
for (const [label, id] of [
  ["species", "identity-species"],
  ["身份版本", "identity-version"], ["触发词", "identity-trigger-word"], ["主脸参考", "identity-face-master"],
  ["左脸参考", "identity-face-left"], ["右脸参考", "identity-face-right"], ["后发参考", "identity-hair-back"],
  ["正面身体路径", "identity-body-front"], ["侧面身体路径", "identity-body-side"], ["背面身体路径", "identity-body-back"],
  ["LoRA 文件", "character-lora-file"], ["LoRA 强度", "character-lora-strength"], ["供应商", "character-lora-provider"],
  ["训练状态", "character-lora-status"], ["不可变特征", "identity-immutable-traits"], ["禁止改变", "identity-forbidden-changes"]
]) {
  assert.match(editor, new RegExp(`<label[^>]*htmlFor=\\{identityControlId\\(asset, "${id}"\\)\\}>\\s*${label}`), `missing accessible ${label} label`);
  assert.match(editor, new RegExp(`id=\\{identityControlId\\(asset, "${id}"\\)\\}`), `missing ${label} control binding`);
}

const speciesControl = editor.match(/<select[\s\S]*?id=\{identityControlId\(asset, "identity-species"\)\}[\s\S]*?<\/select>/)?.[0] ?? "";
assert.deepEqual(CHARACTER_SPECIES_OPTIONS.map((option) => option.value), ["human", "beastfolk", "catfolk", "foxfolk", "wolffolk"], "species selector exposes exactly the five supported IDs");
assert.match(speciesControl, /CHARACTER_SPECIES_OPTIONS\.map/, "species selector renders the canonical supported option list");
assert.match(editor, /displaySpecies !== "human"[\s\S]*identity-species-traits/, "non-human identities expose a species-traits editor");
assert.match(source, /const displaySpecies = CHARACTER_SPECIES_OPTIONS[\s\S]*\? identity\.species : "human"/, "old stored assets display a missing species as human without mutating the identity pack");
assert.match(editor, /styleContractId[\s\S]*styleContractVersion[\s\S]*styleContractDigest[\s\S]*\.slice\(0, 12\)/, "identity editor shows canonical style status and digest prefix");

const strengthControl = editor.match(/<label htmlFor=\{identityControlId\(asset, "character-lora-strength"\)\}>[\s\S]*?<\/label>/)?.[0] ?? "";
assert.match(strengthControl, /type="number"/, "LoRA strength must use a numeric input");
assert.match(strengthControl, /min="0"/, "LoRA strength needs a minimum of 0");
assert.match(strengthControl, /max="1\.5"/, "LoRA strength needs a maximum of 1.5");
assert.match(strengthControl, /step="0\.05"/, "LoRA strength needs a 0.05 step");
assert.match(source, /addAsset\(\{[\s\S]*characterIdentityPack:[\s\S]*characterLora:/, "new character assets must persist identity and LoRA payloads");
assert.match(source, /updateAsset\(asset\.id, \{\s*characterIdentityPack:/, "identity edits must persist through updateAsset");
assert.match(source, /updateAsset\(asset\.id, \{\s*characterLora:/, "LoRA edits must persist through updateAsset");
assert.match(source, /referenceChanged[\s\S]*?invalidateCharacterGenerationEvidence\(\{[\s\S]*?characterIdentityPack:\s*nextIdentity[\s\S]*?\}, referenceChanged \? "reference" : "identity"\)/, "reference edits must invalidate reference digests while identity metadata edits invalidate both contexts");
assert.match(source, /invalidateCharacterGenerationEvidence\(\{\s*\.\.\.asset, characterLora: nextProfile \}, "lora"\)/, "LoRA edits must use independent invalidation");
assert.match(storeSource, /characterZeroShotEvidence:[\s\S]*?currentZeroContext:[\s\S]*?currentLoraContext:/, "asset store must retain both evidence contexts for character assets");
assert.match(comfyServiceSource, /stageImmutableCharacterReferenceSnapshot\(\{[\s\S]*?identity:\s*activeAsset\.characterIdentityPack[\s\S]*?hashIdentity:\s*loadCharacterIdentityReferenceSourceHashes/, "production generation must stage and then hash immutable current identity bytes before resolving a track");
assert.match(comfyServiceSource, /verifyImmutableCharacterReferenceSnapshot\([\s\S]*?stagedReferenceSnapshot[\s\S]*?queueComfyPrompt/, "production generation must rehash the immutable staged bytes immediately before queueing");
assert.match(source, /useEffect\([\s\S]*resolveEvidenceContext\(asset, mode[\s\S]*setEvidenceBadgeChecks/, "evidence badges asynchronously rebuild context from current reference bytes");
assert.match(source, /state:\s*"loading"[\s\S]*待复核/, "loading reference checks render pending review rather than verified readiness");
assert.match(storeSource, /applyCharacterEvidencePatch\(/, "the production updateAsset transition uses the same evidence patch harness as integration tests");
assert.match(source, /file\.size[\s\S]*MAX_CHARACTER_EVIDENCE_REPORT_BYTES[\s\S]*report_file_size_invalid/, "report size is bounded before File.text parses it");
assert.doesNotMatch(evidenceContextFacadeSource, /toDesktopMediaSource|fetch\(/, "trusted reference hashing never reads arbitrary local paths through the asset protocol");
assert.match(evidenceContextFacadeSource, /readTrustedCharacterReference\(path\)/, "frontend reference hashing uses the narrow desktop command");
assert.match(desktopBridgeSource, /read_trusted_character_reference/, "desktop bridge exposes the narrow trusted-reference command");
assert.match(tauriSource, /fn read_trusted_character_reference/, "Tauri registers a narrow trusted-reference command");
assert.match(tauriSource, /fs::canonicalize\(&requested\)/, "Tauri canonicalizes the requested reference path");
assert.match(tauriSource, /file_type\(\)\.is_file\(\)/, "Tauri requires a regular file");
assert.match(tauriSource, /40 \* 1024 \* 1024/, "Tauri enforces the 40 MiB limit");
assert.match(tauriSource, /trusted_character_image_format\(&bytes\)/, "Tauri validates image magic from the bytes it returns");
assert.match(comfyServiceSource, /buildTrustedCharacterGenerationEvidenceContext\([\s\S]*?mode:\s*"zero_shot_multi_reference"[\s\S]*?currentZeroContext:\s*trustedZeroContext/, "production generation must rebuild the zero-shot context from trusted app metadata");
assert.match(comfyServiceSource, /buildTrustedCharacterGenerationEvidenceContext\([\s\S]*?mode:\s*"lora_augmented"[\s\S]*?currentLoraContext:\s*trustedLoraContext/, "production generation must rebuild the LoRA context from trusted app metadata");
assert.match(source, /faceMasterPath: front,[\s\S]*faceLeftPath: side[\s\S]*faceRightPath: side[\s\S]*hairBackPath: back[\s\S]*bodyFrontPath: front[\s\S]*bodySidePath: side[\s\S]*bodyBackPath: back/, "identity defaults must seed all canonical paths from existing views");
assert.match(source, /triggerWord: patch\.triggerWord \?\? current\.triggerWord,[\s\S]*approvedHeroFramePaths: patch\.approvedHeroFramePaths \?\? current\.approvedHeroFramePaths,[\s\S]*updatedAt: new Date\(\)\.toISOString\(\)/, "identity saves preserve user trigger and hero frames while refreshing updatedAt");
assert.match(source, /resolveCharacterLoraProvider\(patch\.provider \?\? current\.provider\)[\s\S]*provider: resolvedProvider\.value,[\s\S]*modelName: resolvedProvider\.modelName/, "provider changes must synchronize provider and model atomically");
assert.match(editor, /onBlur=\{\(event\) => persistCharacterIdentity\(asset, \{ immutableTraits: parseCharacterIdentityList\(event\.target\.value\) \}\)\}/, "immutable traits must persist parsed text on blur");
assert.match(editor, /onBlur=\{\(event\) => persistCharacterIdentity\(asset, \{ forbiddenChanges: parseCharacterIdentityList\(event\.target\.value\) \}\)\}/, "forbidden changes must persist parsed text on blur");
assert.doesNotMatch(editor, /onChange=\{\(event\) => persistCharacterIdentity\(asset, \{ (immutableTraits|forbiddenChanges):/, "multi-item text must not parse while typing");
assert.match(editor, /defaultValue=\{identity\.immutableTraits\.join\("\\n"\)\}/, "immutable trait textarea needs an uncontrolled draft value");
assert.match(editor, /defaultValue=\{identity\.forbiddenChanges\.join\("\\n"\)\}/, "forbidden change textarea needs an uncontrolled draft value");
assert.match(editor, /已完成 \{identityCompleteness\}\/7/, "identity completeness must show the seven canonical slots");
assert.match(editor, /身份 \{formatCharacterVersion\(identity\.version\)\}[\s\S]*LoRA \{formatCharacterVersion\(lora\.version\)\}[\s\S]*供应商：[\s\S]*训练：[\s\S]*回归分：/, "status text must include non-duplicated versions, provider, training status, and score");
assert.match(source, /function formatCharacterVersion\(version: string\)[\s\S]*startsWith\("v"\)/, "version display must not duplicate v prefixes");
const statusStart = source.indexOf("const CHARACTER_LORA_STATUSES");
const statusBlock = statusStart >= 0 ? source.slice(statusStart, source.indexOf("\n];", statusStart) + 3) : "";
assert.deepEqual(Array.from(statusBlock.matchAll(/value: "([^"]+)"/g), (match) => match[1]), ["unconfigured", "dataset_ready", "training", "failed"], "ready must not be manually selectable");
assert.match(editor, /htmlFor=\{identityControlId\(asset, "character-zero-shot-evidence"\)\}[\s\S]*导入零样本基准证据/, "zero-shot evidence import needs an accessible label");
assert.match(editor, /htmlFor=\{identityControlId\(asset, "character-lora-evidence"\)\}[\s\S]*导入 LoRA 基准证据/, "LoRA evidence import needs an accessible label");
const evidenceInput = editor.match(/<input[\s\S]*?id=\{identityControlId\(asset, "character-lora-evidence"\)\}[\s\S]*?\/>/)?.[0] ?? "";
assert.match(evidenceInput, /accept="\.json,application\/json"/, "benchmark evidence import must accept JSON");
assert.match(evidenceInput, /type="file"/, "benchmark evidence import needs a file control");
assert.match(editor, /onChange=\{\(event\) => void onImportCharacterGenerationEvidence\(asset, "lora_augmented", event\.target\.files\?\.\[0\]\)\}/, "LoRA evidence files must route through strict validated import");
assert.match(editor, /role="alert"[\s\S]*benchmarkEvidenceErrorByAsset/, "invalid benchmark evidence needs a specific accessible error");
assert.match(editor, /zeroEvidenceValidation\.valid[\s\S]*零样本已验证[\s\S]*loraEvidenceValidation\.valid[\s\S]*LoRA 已验证[\s\S]*证据已失效/, "ready and stale evidence must be independently derived read-only states");
assert.match(source, /<button[^>]*type="button"/, "asset actions must declare button types");
assert.match(editor, /role="status"/, "identity status must have status semantics");
assert.match(css, /\.character-identity-grid\s*\{/, "missing focused identity grid CSS");
assert.match(css, /\.character-identity-status-chip\s*\{/, "missing focused identity status-chip CSS");
assert.match(css, /\.character-evidence-badge\.is-verified\s*\{/, "missing verified evidence badge CSS");

const stable = (value) => Array.isArray(value)
  ? `[${value.map(stable).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const sha256 = (values) => crypto.createHash("sha256").update(Buffer.concat(values.map((value) => Buffer.isBuffer(value) ? value : Buffer.from(value)))).digest("hex");
const fixtureBytes = await readFile(new URL("../examples/character-consistency-benchmark/benchmark.json", import.meta.url));
assert.equal(TRUSTED_CHARACTER_EVIDENCE_METADATA.fixtureDigest, sha256([stable(JSON.parse(fixtureBytes.toString("utf8")))]), "trusted UI fixture metadata must match the current benchmark fixture bytes");
const policyBytes = await readFile(new URL("../examples/character-consistency-benchmark/siglip2-evaluator.example.json", import.meta.url));
assert.equal(TRUSTED_CHARACTER_EVIDENCE_METADATA.evaluatorPolicyHash, sha256([policyBytes]), "trusted UI evaluator policy hash must match the current policy bytes");
const evaluatorBytes = await readFile(new URL("../scripts/evaluators/siglip2-character-evaluator.mjs", import.meta.url));
const workerBytes = await readFile(new URL("../scripts/evaluators/siglip2-character-worker.py", import.meta.url));
const manifestBytes = await readFile(new URL("../examples/character-consistency-benchmark/siglip2-snapshot-manifest.json", import.meta.url));
const manifestHash = sha256([JSON.stringify(JSON.parse(manifestBytes.toString("utf8")))]);
assert.equal(
  TRUSTED_CHARACTER_EVIDENCE_METADATA.evaluatorImplementationHash,
  sha256([evaluatorBytes, workerBytes, policyBytes, "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2", manifestBytes, manifestHash]),
  "trusted UI evaluator implementation metadata must match the exact evaluator, worker, policy, revision, and manifest bytes"
);

console.log("PASS character identity runtime and editor controls, persistence, defaults, and status presentation");
