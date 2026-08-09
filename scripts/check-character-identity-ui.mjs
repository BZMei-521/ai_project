import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CHARACTER_LORA_PROVIDER_OPTIONS,
  clampCharacterLoraStrength,
  countCharacterIdentityCompleteness,
  importCharacterBenchmarkEvidence,
  invalidateCharacterLoraEvidence,
  normalizeCharacterTriggerWord,
  parseCharacterIdentityList,
  resolveCharacterLoraProvider,
  validateStoredCharacterBenchmarkEvidence
} from "../src/modules/asset-manager/characterIdentityUiRuntime.mjs";
import {
  recomputeCharacterBenchmarkEvidenceDigest,
  recomputeStoredCharacterBenchmarkEvidenceDigest
} from "../src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs";

assert.equal(clampCharacterLoraStrength(), 1, "default LoRA strength is finite");
assert.equal(clampCharacterLoraStrength(Number.NaN), 1, "NaN LoRA strength falls back safely");
assert.equal(clampCharacterLoraStrength(Number.POSITIVE_INFINITY), 1, "infinite LoRA strength falls back safely");
assert.equal(clampCharacterLoraStrength(Number.NEGATIVE_INFINITY), 1, "negative infinite LoRA strength falls back safely");
assert.equal(clampCharacterLoraStrength(-0.1), 0, "LoRA strength clamps at zero");
assert.equal(clampCharacterLoraStrength(2), 1.5, "LoRA strength clamps at 1.5");
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

const evidenceContext = {
  generationMode: "lora_augmented",
  characterAssetId: "asset_ada",
  identityPackVersion: "identity-v3",
  provider: "qwen_image_edit_2511",
  loraName: "ada-v3.safetensors",
  loraVersion: "lora-v3",
  modelName: "qwen_image_edit_2511_bf16.safetensors",
  loraStrength: 0.9,
  candidateStatus: "dataset_ready",
  referenceManifestDigest: "c".repeat(64),
  evaluatorId: "identity-scorer",
  evaluatorVersion: "evaluator-v1",
  evaluatorImplementationHash: "d".repeat(64),
  evaluatorPolicyHash: "e".repeat(64),
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
    references: evidenceShotIds.map((shotId, index) => ({
      shotId,
      slot: evidenceSlots[index],
      sourceSha256: String(index + 1).repeat(64),
      transformedSha256: String(index + 2).repeat(64),
      transform: index === 1 ? "mirror_x" : index === 2 ? "head_shoulders_crop" : "none"
    })),
    subject: {
      characterAssetId: evidenceContext.characterAssetId,
      provider: evidenceContext.provider,
      identityPackVersion: evidenceContext.identityPackVersion,
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
const assetPanelLoraContext = {
  characterAssetId: evidenceContext.characterAssetId,
  identityPackVersion: evidenceContext.identityPackVersion,
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
const missingModeReport = makeEvidenceReport();
delete missingModeReport.generationMode;
missingModeReport.evidenceDigest = recomputeCharacterBenchmarkEvidenceDigest(missingModeReport);
assert.equal(importCharacterBenchmarkEvidence(missingModeReport, evidenceContext).reason, "legacy_report_not_importable", "missing-mode reports are never imported");
const legacyStoredEvidence = {
  reportLabel: "legacy-lora.json", evidenceDigest: "", benchmarkVersion: "benchmark-v0", fixtureDigest: "a".repeat(64), characterAssetId: evidenceContext.characterAssetId, provider: evidenceContext.provider, identityPackVersion: evidenceContext.identityPackVersion, loraName: evidenceContext.loraName, loraVersion: evidenceContext.loraVersion, modelName: evidenceContext.modelName, loraStrength: evidenceContext.loraStrength, candidateStatus: evidenceContext.candidateStatus, workflowDigest: evidenceContext.workflowProof.workflowDigest, terminalOutputNode: evidenceContext.workflowProof.terminalOutputNode, terminalModel: evidenceContext.modelName, terminalLoraName: evidenceContext.loraName, terminalLoraStrengthModel: evidenceContext.loraStrength, terminalLoraStrengthClip: evidenceContext.loraStrength, terminalLoraClassType: "LoraLoader", terminalLoraClipPolicy: "equal_to_model", evaluatorHash: "d".repeat(64), evaluatorVersion: "evaluator-v1", acceptedShots: 8, verifiedAt: "2026-08-08T08:00:00.000Z", importedAt: "2026-08-08T08:00:00.000Z"
};
legacyStoredEvidence.evidenceDigest = recomputeStoredCharacterBenchmarkEvidenceDigest(legacyStoredEvidence);
assert.equal(validateStoredCharacterBenchmarkEvidence(legacyStoredEvidence, evidenceContext).legacy, true, "stored legacy LoRA evidence remains separately compatible");
assert.equal(validateStoredCharacterBenchmarkEvidence(legacyStoredEvidence, assetPanelLoraContext).legacy, true, "stored legacy LoRA evidence remains compatible with the old UI context");
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
assert.deepEqual(invalidateCharacterLoraEvidence({ loraName: "ada.safetensors", status: "ready", benchmarkEvidence: importedEvidence.evidence }), { loraName: "ada.safetensors", status: "dataset_ready" }, "candidate LoRA invalidation removes evidence and downgrades readiness");
assert.deepEqual(invalidateCharacterLoraEvidence({ loraName: "", status: "ready", benchmarkEvidence: importedEvidence.evidence }), { loraName: "", status: "unconfigured" }, "missing candidate LoRA invalidation becomes unconfigured");

const source = await readFile(new URL("../src/modules/asset-manager/AssetPanel.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/styles/global.css", import.meta.url), "utf8");
const editorMatch = source.match(/<section[^>]*className="character-identity-editor">[\s\S]*?<\/section>/);
assert.ok(editorMatch, "missing character identity editor section");
const editor = editorMatch[0];

assert.match(source, /asset\.type === "character" && \(\(\) => \{[\s\S]*?<section[^>]*className="character-identity-editor">/, "identity editor must be placed on character cards only");
for (const [label, id] of [
  ["身份版本", "identity-version"], ["触发词", "identity-trigger-word"], ["主脸参考", "identity-face-master"],
  ["左脸参考", "identity-face-left"], ["右脸参考", "identity-face-right"], ["后发参考", "identity-hair-back"],
  ["正面身体路径", "identity-body-front"], ["侧面身体路径", "identity-body-side"], ["背面身体路径", "identity-body-back"],
  ["LoRA 文件", "character-lora-file"], ["LoRA 强度", "character-lora-strength"], ["供应商", "character-lora-provider"],
  ["训练状态", "character-lora-status"], ["不可变特征", "identity-immutable-traits"], ["禁止改变", "identity-forbidden-changes"]
]) {
  assert.match(editor, new RegExp(`<label[^>]*htmlFor=\\{identityControlId\\(asset, "${id}"\\)\\}>\\s*${label}`), `missing accessible ${label} label`);
  assert.match(editor, new RegExp(`id=\\{identityControlId\\(asset, "${id}"\\)\\}`), `missing ${label} control binding`);
}

const strengthControl = editor.match(/<label htmlFor=\{identityControlId\(asset, "character-lora-strength"\)\}>[\s\S]*?<\/label>/)?.[0] ?? "";
assert.match(strengthControl, /type="number"/, "LoRA strength must use a numeric input");
assert.match(strengthControl, /min="0"/, "LoRA strength needs a minimum of 0");
assert.match(strengthControl, /max="1\.5"/, "LoRA strength needs a maximum of 1.5");
assert.match(strengthControl, /step="0\.05"/, "LoRA strength needs a 0.05 step");
assert.match(source, /addAsset\(\{[\s\S]*characterIdentityPack:[\s\S]*characterLora:/, "new character assets must persist identity and LoRA payloads");
assert.match(source, /updateAsset\(asset\.id, \{\s*characterIdentityPack:/, "identity edits must persist through updateAsset");
assert.match(source, /updateAsset\(asset\.id, \{\s*characterLora:/, "LoRA edits must persist through updateAsset");
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
assert.match(editor, /htmlFor=\{identityControlId\(asset, "character-lora-evidence"\)\}[\s\S]*导入基准证据/, "benchmark evidence import needs an accessible label");
const evidenceInput = editor.match(/<input[\s\S]*?id=\{identityControlId\(asset, "character-lora-evidence"\)\}[\s\S]*?\/>/)?.[0] ?? "";
assert.match(evidenceInput, /accept="\.json,application\/json"/, "benchmark evidence import must accept JSON");
assert.match(evidenceInput, /type="file"/, "benchmark evidence import needs a file control");
assert.match(editor, /onChange=\{\(event\) => void onImportCharacterBenchmarkEvidence\(asset, event\.target\.files\?\.\[0\]\)\}/, "benchmark evidence files must route through validated import");
assert.match(editor, /role="alert"[\s\S]*benchmarkEvidenceErrorByAsset/, "invalid benchmark evidence needs a specific accessible error");
assert.match(editor, /evidenceValidation\.valid[\s\S]*基准证据已验证[\s\S]*证据失效/, "ready and stale evidence must be derived read-only states");
assert.match(source, /<button[^>]*type="button"/, "asset actions must declare button types");
assert.match(editor, /role="status"/, "identity status must have status semantics");
assert.match(css, /\.character-identity-grid\s*\{/, "missing focused identity grid CSS");
assert.match(css, /\.character-identity-status-chip\s*\{/, "missing focused identity status-chip CSS");

console.log("PASS character identity runtime and editor controls, persistence, defaults, and status presentation");
