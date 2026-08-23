import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import {
  importCharacterGenerationEvidence,
  recomputeCharacterGenerationEvidenceDigest,
  recomputeStoredCharacterGenerationEvidenceDigest,
  validateCharacterGenerationReport,
  validateStoredCharacterGenerationEvidence
} from "../src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs";
import {
  buildCharacterEvidenceReceiptClaims,
  computeCharacterEvidenceReceiptClaimsDigest,
  validateCharacterEvidenceReceipt
} from "../src/modules/comfy-pipeline/characterEvidenceReceiptRuntime.mjs";
import { computeCharacterIdentityMetadataDigest } from "../src/modules/comfy-pipeline/characterIdentityMetadataRuntime.mjs";
import {
  CINEMATIC_3D_DONGHUA_CONTRACT,
  computeCharacterStyleContractDigest
} from "../src/modules/comfy-pipeline/characterStyleContractRuntime.mjs";

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
const identity = {
  triggerWord: "char_ada",
  immutableTraits: ["amber eyes", "short black bob"],
  forbiddenChanges: ["blue eyes", "long hair"],
  species: "human",
  speciesTraits: [],
  styleContractId: "cinematic_3d_donghua_v1",
  styleContractVersion: "1.0.0",
  styleContractDigest: computeCharacterStyleContractDigest(CINEMATIC_3D_DONGHUA_CONTRACT)
};
const identityMetadataDigest = computeCharacterIdentityMetadataDigest(identity);
const modelName = "flux-2-klein-4b-fp8.safetensors";

const zeroShotContext = {
  generationMode: "zero_shot_multi_reference",
  benchmarkVersion: "benchmark-v2",
  promptTemplateVersion: "prompt-v2",
  characterAssetId: "asset_ada",
  identityPackVersion: "identity-v1",
  identityMetadataDigest,
  ...identity,
  provider: "flux2_klein_4b",
  modelName,
  fixtureDigest,
  referenceManifestDigest,
  evaluatorId: "identity-scorer",
  evaluatorVersion: "v1",
  evaluatorImplementationHash,
  evaluatorPolicyHash,
  dimensionThreshold: 0.9,
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
    references: shotIds.flatMap((shotId, index) => [
      { shotId, slot: slots[index], sourceSha256: hash(String(index + 1)), transformedSha256: hash(String(index + 2)), transform: index === 1 ? "mirror_x" : index === 2 ? "head_shoulders_crop" : "none" },
      { shotId, slot: slots[(index + 1) % slots.length], sourceSha256: hash(String(index + 3)), transformedSha256: hash(String(index + 4)), transform: index === 3 ? "mirror_x" : "none" }
    ]),
    subject: {
      characterAssetId: zeroShotContext.characterAssetId,
      provider: zeroShotContext.provider,
      identityPackVersion: zeroShotContext.identityPackVersion,
      identityMetadataDigest,
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
const comfyPython = process.env.COMFYUI_PYTHON || "C:\\Users\\Administrator\\AppData\\Local\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI\\ComfyUI\\.venv\\Scripts\\python.exe";
if (existsSync(comfyPython)) {
  const parityRoot = mkdtempSync(path.join(os.tmpdir(), "character-validator-parity-"));
  const validateWithPython = (report) => spawnSync(comfyPython, [path.resolve("scripts/evaluators/siglip2-character-attestor.py"), "validate-report", parityRoot], { input: JSON.stringify({ report }), encoding: "utf8", windowsHide: true });
  for (const report of [validZeroShotReport, validLoraReport]) {
    const result = validateWithPython(report); assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).valid, true, "Python and Node accept the same canonical report corpus");
  }
  const strictMutations = [
    ["evidence digest", (report) => { report.evidenceDigest = hash("9"); }],
    ["generation mode", (report) => { report.generationMode = "unknown"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["benchmark version", (report) => { delete report.benchmarkVersion; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["prompt template version", (report) => { delete report.promptTemplateVersion; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["fixture digest", (report) => { report.fixtureDigest = "bad"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["generation parameters digest", (report) => { report.generationParametersDigest = "bad"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["character binding", (report) => { report.character = "other"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["provider binding", (report) => { report.subject.provider = "other"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["identity version", (report) => { delete report.subject.identityPackVersion; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["identity metadata digest", (report) => { report.subject.identityMetadataDigest = "bad"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["model name", (report) => { delete report.subject.modelName; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["reference manifest digest", (report) => { report.referenceManifestDigest = "bad"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["workflow provider", (report) => { report.preflight.providerProof.providerId = "other"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["workflow digest", (report) => { report.preflight.providerProof.workflowDigest = "bad"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["terminal output", (report) => { delete report.preflight.providerProof.terminalOutputNode; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["model binding", (report) => { report.preflight.providerProof.authoritativeModelBindings[0].model = "wrong.safetensors"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["evaluator id", (report) => { delete report.evaluatorProof.id; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["evaluator version", (report) => { delete report.evaluatorProof.version; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["evaluator implementation", (report) => { report.evaluatorProof.implementationHash = "bad"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["evaluator policy", (report) => { report.evaluatorProof.policyHash = "bad"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["evaluator threshold", (report) => { report.evaluatorProof.dimensionThreshold = 0; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["fallback", (report) => { report.preflight.fallbackUsed = true; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["cutout fallback", (report) => { report.preflight.cutoutFallbackUsed = true; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["reference count", (report) => { report.references.pop(); report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["reference source hash", (report) => { report.references[0].sourceSha256 = "bad"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["reference transformed hash", (report) => { report.references[0].transformedSha256 = "bad"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["reference transform", (report) => { report.references[0].transform = "rotate"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["shot output hash", (report) => { report.shots[0].outputSha256 = "bad"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["shot score", (report) => { report.shots[0].score = -1; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["shot dimensions", (report) => { report.shots[0].dimensionScores.face = 0.1; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["shot retries", (report) => { report.shots[0].retries = true; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["shot status", (report) => { report.shots[0].finalStatus = "rejected"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["shot provenance", (report) => { report.shots[0].provenance = "fixture"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["shot provider", (report) => { report.shots[0].actualProvider = "other"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["shot terminal", (report) => { report.shots[0].terminalOutputNode = "other"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["aggregate status", (report) => { report.aggregate.status = "rejected"; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["aggregate accepted", (report) => { report.aggregate.accepted = 7; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }],
    ["aggregate score", (report) => { report.aggregate.score = -1; report.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(report); }]
  ];
  for (const [label, mutate] of strictMutations) {
    const attacked = structuredClone(validZeroShotReport); mutate(attacked);
    assert.equal(validateCharacterGenerationReport(attacked).valid, false, `Node rejects shared attack corpus: ${label}`);
    assert.notEqual(validateWithPython(attacked).status, 0, `Python rejects shared attack corpus: ${label}`);
  }
  const strictLoraMutations = [
    ["LoRA version", (report) => { delete report.subject.loraVersion; }],
    ["LoRA name", (report) => { report.subject.loraName = "other.safetensors"; }],
    ["LoRA candidate status", (report) => { report.subject.candidateStatus = "ready"; }],
    ["LoRA provider", (report) => { report.subject.provider = "other"; }],
    ["LoRA model", (report) => { report.subject.modelName = "other.safetensors"; }],
    ["LoRA subject strength", (report) => { delete report.subject.loraStrength; }],
    ["LoRA workflow provider", (report) => { report.preflight.providerProof.providerId = "other"; }],
    ["LoRA authoritative model", (report) => { report.preflight.providerProof.authoritativeModelBindings[0].model = "other.safetensors"; }],
    ["LoRA binding id", (report) => { report.preflight.providerProof.authoritativeLoraBindings[0].id = "9"; }],
    ["LoRA binding class", (report) => { report.preflight.providerProof.authoritativeLoraBindings[0].classType = "UnknownLoader"; }],
    ["LoRA binding name", (report) => { report.preflight.providerProof.authoritativeLoraBindings[0].loraName = "other.safetensors"; }],
    ["LoRA binding field", (report) => { report.preflight.providerProof.authoritativeLoraBindings[0].field = "other"; }],
    ["LoRA path node ids", (report) => { report.preflight.providerProof.authoritativeLoraBindings[0].modelPathNodeIds[1] = "9"; }],
    ["LoRA path from node", (report) => { report.preflight.providerProof.authoritativeLoraBindings[0].modelPathEdges[0].fromNodeId = "9"; }],
    ["LoRA path output index", (report) => { report.preflight.providerProof.authoritativeLoraBindings[0].modelPathEdges[0].fromOutputIndex = 1; }],
    ["LoRA path to node", (report) => { report.preflight.providerProof.authoritativeLoraBindings[0].modelPathEdges[0].toNodeId = "9"; }],
    ["LoRA binding path", (report) => { report.preflight.providerProof.authoritativeLoraBindings[0].modelPathEdges[0].toInput = "clip"; }],
    ["LoRA clip policy", (report) => { report.preflight.providerProof.authoritativeLoraBindings[0].clipStrengthPolicy = "not_applicable"; }],
    ["LoRA model strength", (report) => { report.preflight.providerProof.authoritativeLoraBindings[0].strengthModel = 0.8; }],
    ["LoRA clip strength", (report) => { report.preflight.providerProof.authoritativeLoraBindings[0].strengthClip = 0.8; }],
    ["LoRA strength outside tolerance", (report) => { report.preflight.providerProof.authoritativeLoraBindings[0].strengthClip += 2e-9; }]
  ];
  for (const [label, mutate] of strictLoraMutations) {
    const attacked = structuredClone(validLoraReport);
    mutate(attacked);
    attacked.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(attacked);
    assert.equal(validateCharacterGenerationReport(attacked).valid, false, `Node rejects shared LoRA attack corpus: ${label}`);
    assert.notEqual(validateWithPython(attacked).status, 0, `Python rejects shared LoRA attack corpus: ${label}`);
  }
  const uppercaseHashReport = structuredClone(validZeroShotReport);
  uppercaseHashReport.fixtureDigest = uppercaseHashReport.fixtureDigest.toUpperCase();
  uppercaseHashReport.references[0].sourceSha256 = uppercaseHashReport.references[0].sourceSha256.toUpperCase();
  uppercaseHashReport.shots[0].outputSha256 = uppercaseHashReport.shots[0].outputSha256.toUpperCase();
  uppercaseHashReport.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(uppercaseHashReport);
  assert.equal(validateCharacterGenerationReport(uppercaseHashReport).valid, true, "Node accepts canonical SHA-256 values case-insensitively");
  const uppercasePython = validateWithPython(uppercaseHashReport);
  assert.equal(uppercasePython.status, 0, uppercasePython.stderr || "Python must match Node hash case semantics");
  const tolerantLoraReport = structuredClone(validLoraReport);
  tolerantLoraReport.preflight.providerProof.authoritativeLoraBindings[0].strengthClip += 5e-10;
  tolerantLoraReport.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(tolerantLoraReport);
  assert.equal(validateCharacterGenerationReport(tolerantLoraReport).valid, true, "Node accepts LoRA strength differences within the canonical tolerance");
  const tolerantPython = validateWithPython(tolerantLoraReport);
  assert.equal(tolerantPython.status, 0, tolerantPython.stderr || "Python must match Node LoRA strength tolerance");
  const modelOnlyLoraReport = structuredClone(validLoraReport);
  Object.assign(modelOnlyLoraReport.preflight.providerProof.authoritativeLoraBindings[0], {
    classType: "LoraLoaderModelOnly",
    strengthClip: null,
    clipStrengthPolicy: "not_applicable"
  });
  modelOnlyLoraReport.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(modelOnlyLoraReport);
  assert.equal(validateCharacterGenerationReport(modelOnlyLoraReport).valid, true, "Node accepts a fully bound model-only LoRA loader");
  const modelOnlyPython = validateWithPython(modelOnlyLoraReport);
  assert.equal(modelOnlyPython.status, 0, modelOnlyPython.stderr || "Python must match Node model-only LoRA semantics");
  rmSync(parityRoot, { recursive: true, force: true });
}
const trustedHarness = (report) => {
  const claims = buildCharacterEvidenceReceiptClaims(report, report.evidenceDigest);
  const receipt = {
    schemaVersion: 1,
    issuer: "storyboard-desktop-character-evidence-v1",
    receiptId: hash("a"),
    ...claims,
    claimsDigest: computeCharacterEvidenceReceiptClaimsDigest(claims)
  };
  return { receipt, verification: { valid: true, receiptId: receipt.receiptId, claimsDigest: receipt.claimsDigest } };
};
for (const report of [validZeroShotReport, validLoraReport]) Object.assign(report, { trustedReceipt: trustedHarness(report).receipt });
assert.equal(validZeroShotReport.references.length, 16);
assert.equal(validateCharacterGenerationReport(validZeroShotReport).valid, true);
const preMetadataDigestReport = structuredClone(validZeroShotReport); delete preMetadataDigestReport.subject.identityMetadataDigest; preMetadataDigestReport.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(preMetadataDigestReport); assert.equal(validateCharacterGenerationReport(preMetadataDigestReport).eligible, false, "pre-digest mode-aware reports fail closed instead of self-validating");
const secondaryReferenceTamper = structuredClone(validZeroShotReport); secondaryReferenceTamper.references[1].transformedSha256 = hash("9"); assert.equal(validateCharacterGenerationReport(secondaryReferenceTamper).valid, false, "secondary transformed digest is evidence-bound"); assert.notEqual(recomputeCharacterGenerationEvidenceDigest(secondaryReferenceTamper), validZeroShotReport.evidenceDigest);
const duplicateShotSlot = structuredClone(validZeroShotReport); duplicateShotSlot.references[1].slot = duplicateShotSlot.references[0].slot; duplicateShotSlot.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(duplicateShotSlot); assert.equal(validateCharacterGenerationReport(duplicateShotSlot).eligible, false, "each shot requires two unique reference slots");
const missingSecondary = structuredClone(validZeroShotReport); missingSecondary.references.splice(1, 1); missingSecondary.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(missingSecondary); assert.equal(validateCharacterGenerationReport(missingSecondary).eligible, false, "all eight shots require exactly two references");
const forgedPerfectReport = makeReport("zero_shot_multi_reference");
assert.equal(importCharacterGenerationEvidence(forgedPerfectReport, zeroShotContext).reason, "trusted_receipt_missing", "a perfect eight-shot report with a public recomputed digest cannot unlock production without a desktop receipt");
const zeroHarness = trustedHarness(validZeroShotReport);
validZeroShotReport.trustedReceipt = zeroHarness.receipt;
const trustedPositive = validateCharacterEvidenceReceipt(zeroHarness.receipt, validZeroShotReport, zeroHarness.verification, validZeroShotReport.evidenceDigest);
assert.equal(trustedPositive.valid, true, `a backend-verified receipt unlocks its exact report: ${JSON.stringify(trustedPositive)}`);
for (const [label, mutate] of [
  ["report digest", (report) => { report.evidenceDigest = hash("9"); }],
  ["output hash", (report) => { report.shots[0].outputSha256 = hash("8"); }],
  ["identity metadata", (report) => { report.subject.identityMetadataDigest = hash("7"); }],
  ["mode", (report) => { report.generationMode = "lora_augmented"; }]
]) {
  const changed = structuredClone(validZeroShotReport); mutate(changed);
  assert.equal(validateCharacterEvidenceReceipt(zeroHarness.receipt, changed, zeroHarness.verification, changed.evidenceDigest).valid, false, `${label} cannot replay a receipt`);
}
const zeroShotImport = importCharacterGenerationEvidence(validZeroShotReport, zeroShotContext, { now: () => "2026-08-09T08:00:00.000Z", trustedReceiptVerification: zeroHarness.verification });
assert.equal(zeroShotImport.valid, true);
assert.equal(zeroShotImport.evidence.generationMode, "zero_shot_multi_reference");
assert.equal(validateCharacterGenerationReport({ ...validZeroShotReport, preflight: { providerProof: validLoraReport.preflight.providerProof } }).valid, false, "zero-shot evidence rejects any active terminal LoRA");
const loraHarness = trustedHarness(validLoraReport); validLoraReport.trustedReceipt = loraHarness.receipt;
assert.equal(importCharacterGenerationEvidence(validLoraReport, loraContext, { now: () => "2026-08-09T08:00:00.000Z", trustedReceiptVerification: loraHarness.verification }).valid, true);
const legacyLoraReport = structuredClone(validLoraReport);
delete legacyLoraReport.generationMode;
legacyLoraReport.evidenceDigest = recomputeCharacterGenerationEvidenceDigest(legacyLoraReport);
assert.equal(importCharacterGenerationEvidence(legacyLoraReport, loraContext).reason, "legacy_requires_rebenchmark", "legacy reports are audit-only and require a fresh benchmark");
assert.equal(
  importCharacterGenerationEvidence(legacyLoraReport, { ...zeroShotContext, loraName: loraContext.loraName, loraVersion: loraContext.loraVersion, loraStrength: loraContext.loraStrength, candidateStatus: loraContext.candidateStatus }).reason,
  "legacy_requires_rebenchmark",
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
const preMetadataDigestEvidence = structuredClone(validZeroShotEvidence); delete preMetadataDigestEvidence.identityMetadataDigest; preMetadataDigestEvidence.evidenceDigest = recomputeStoredCharacterGenerationEvidenceDigest(preMetadataDigestEvidence); assert.equal(validateStoredCharacterGenerationEvidence(preMetadataDigestEvidence, zeroShotContext).reason, "identity_metadata_mismatch", "pre-digest mode-aware stored evidence fails closed");
assert.equal(validateStoredCharacterGenerationEvidence(validZeroShotEvidence, { ...zeroShotContext, identityPackVersion: "v2" }).reason, "identity_version_mismatch");
assert.equal(validateStoredCharacterGenerationEvidence(validZeroShotEvidence, { ...zeroShotContext, identityMetadataDigest: hash("5") }).reason, "identity_metadata_mismatch", "identity metadata edits permanently stale stored evidence even when the identity version is unchanged");
assert.equal(validateStoredCharacterGenerationEvidence(validZeroShotEvidence, { ...zeroShotContext, species: "catfolk" }).reason, "identity_metadata_mismatch", "species edits cannot retain evidence bound to the prior identity metadata digest");
assert.equal(validateStoredCharacterGenerationEvidence(validZeroShotEvidence, { ...zeroShotContext, fixtureDigest: hash("f") }).reason, "fixture_digest_mismatch");
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
storedMutation("fixture digest", (evidence) => { evidence.fixtureDigest = "not-a-hash"; }, "fixture_digest_mismatch");
storedMutation("reference source digest", (evidence) => { evidence.references[0].sourceSha256 = "not-a-hash"; }, "reference_shape_invalid");
storedMutation("reference transformed digest", (evidence) => { evidence.references[0].transformedSha256 = "not-a-hash"; }, "reference_shape_invalid");
storedMutation("secondary reference transformed digest", (evidence) => { evidence.references[1].transformedSha256 = "not-a-hash"; }, "reference_shape_invalid");
storedMutation("reference transform", (evidence) => { evidence.references[0].transform = "rotate"; }, "reference_shape_invalid");
storedMutation("evaluator id", (evidence) => { evidence.evaluatorId = "other-scorer"; }, "evaluator_id_mismatch");
storedMutation("evaluator version", (evidence) => { evidence.evaluatorVersion = "v2"; }, "evaluator_version_mismatch");
storedMutation("evaluator policy hash", (evidence) => { evidence.evaluatorPolicyHash = hash("9"); }, "evaluator_policy_mismatch");
storedMutation("shot status", (evidence) => { evidence.shots[0].finalStatus = "rejected"; }, "shot_shape_invalid");
storedMutation("provenance", (evidence) => { evidence.shots[0].provenance = "fallback"; }, "shot_shape_invalid");
storedMutation("dimension threshold", (evidence) => { evidence.dimensionThreshold = 0.99; }, "dimension_threshold_mismatch");
const tamperedDigest = { ...validZeroShotEvidence, evidenceDigest: hash("0") };
assert.equal(validateStoredCharacterGenerationEvidence(tamperedDigest, zeroShotContext).reason, "evidence_digest_mismatch", "evidence digest");

const frozenLegacyLoraEvidence = {
  reportLabel: "legacy.json", evidenceDigest: "", benchmarkVersion: "benchmark-v1", fixtureDigest, characterAssetId: "asset_ada", provider: "flux2_klein_4b", identityPackVersion: "identity-v1", loraName: "ada-v1.safetensors", loraVersion: "lora-v1", modelName, loraStrength: 0.9, candidateStatus: "dataset_ready", workflowDigest, terminalOutputNode: "6", terminalModel: modelName, terminalLoraName: "ada-v1.safetensors", terminalLoraStrengthModel: 0.9, terminalLoraStrengthClip: 0.9, terminalLoraClassType: "LoraLoader", terminalLoraClipPolicy: "equal_to_model", evaluatorHash: evaluatorImplementationHash, evaluatorVersion: "v1", acceptedShots: 8, verifiedAt: "2026-08-09T08:00:00.000Z", importedAt: "2026-08-09T08:00:00.000Z"
};
// This frozen shape intentionally has no generationMode and therefore only remains usable for LoRA migration.
frozenLegacyLoraEvidence.evidenceDigest = recomputeStoredCharacterGenerationEvidenceDigest(frozenLegacyLoraEvidence);
assert.equal(validateStoredCharacterGenerationEvidence(frozenLegacyLoraEvidence, loraContext).reason, "legacy_requires_rebenchmark", "legacy evidence without identity metadata is audit-only");
assert.equal(validateStoredCharacterGenerationEvidence(frozenLegacyLoraEvidence, { ...loraContext, candidateStatus: "training" }).reason, "legacy_requires_rebenchmark");
assert.equal(validateStoredCharacterGenerationEvidence(frozenLegacyLoraEvidence, zeroShotContext).reason, "legacy_evidence_not_zero_shot");

console.log("character generation evidence checks passed");
