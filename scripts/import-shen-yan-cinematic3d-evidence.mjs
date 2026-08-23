import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  applyCharacterGenerationEvidenceImport,
  buildTrustedCharacterGenerationEvidenceContext
} from "../src/modules/comfy-pipeline/characterEvidenceContextRuntime.mjs";
import { validateStoredCharacterGenerationEvidence } from "../src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs";
import { resolveCharacterGenerationTrack } from "../src/modules/comfy-pipeline/sequentialCharacterPassRuntime.mjs";
import {
  attestCharacterGenerationReport,
  verifyCharacterEvidenceReceiptFromRegistry
} from "./character-evidence-attestation.mjs";

const PROJECT_PATH = resolve("examples/character-consistency-benchmark/current-project-klein-release-subject-cinematic3d.json");
const REPORT_PATH = resolve("logs/character-consistency-benchmark-klein-cinematic3d-zero-shot-quality-v4.json");
const WORKFLOW_PATH = resolve("examples/character-consistency-benchmark/workflows/flux2-klein-4b-reference-smoke-api.json");
const OUTPUT_PATH = resolve("examples/character-consistency-benchmark/current-project-klein-release-subject-cinematic3d-evidence.json");
const EXPECTED_ASSET_ID = "asset_1774017261433_390";
const EXPECTED_IDENTITY_VERSION = "shen-yan-hybrid-v5";
const EXPECTED_REPORT_DIGEST = "72e97696826412ccc8b5bfa5ac7d6e274ae59909b83e17144f64addb5660408c";
const PROVIDER_ID = "flux2_klein_4b";
const MODEL_NAME = "flux-2-klein-4b-fp8.safetensors";

const referenceFields = {
  face_master: "faceMasterPath",
  face_left: "faceLeftPath",
  face_right: "faceRightPath",
  hair_back: "hairBackPath",
  body_front: "bodyFrontPath",
  body_side: "bodySidePath",
  body_back: "bodyBackPath",
  expression_neutral: "neutralExpressionPath"
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const sha256File = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const registryRoot = process.argv[2]
  ? resolve(process.argv[2])
  : join(process.env.APPDATA ?? "", "StoryboardProWeb", "character-evidence", "receipts");
assert(process.env.APPDATA || process.argv[2], "receipt_registry_missing");

const [project, sourceReport, workflow] = await Promise.all([
  readJson(PROJECT_PATH),
  readJson(REPORT_PATH),
  readJson(WORKFLOW_PATH)
]);
const assetIndex = project?.snapshot?.assets?.findIndex((item) => item?.id === EXPECTED_ASSET_ID);
assert(Number.isInteger(assetIndex) && assetIndex >= 0, "approved_character_asset_missing");
const asset = project.snapshot.assets[assetIndex];
const identity = asset.characterIdentityPack;
assert(identity?.version === EXPECTED_IDENTITY_VERSION, "identity_pack_version_mismatch");
assert(identity?.species === "human" && Array.isArray(identity.speciesTraits) && identity.speciesTraits.length === 0, "human_species_contract_mismatch");
assert(sourceReport?.evidenceEligible === true && sourceReport?.aggregate?.status === "accepted" && sourceReport?.aggregate?.accepted === 8, "report_not_accepted");
assert(sourceReport?.evidenceDigest === EXPECTED_REPORT_DIGEST, "report_digest_mismatch");
assert(sourceReport?.subject?.characterAssetId === asset.id && sourceReport?.subject?.identityPackVersion === identity.version, "report_subject_mismatch");
assert(sourceReport?.preflight?.providerProof?.providerId === PROVIDER_ID, "report_provider_mismatch");
assert(basename(sourceReport?.subject?.modelName ?? "") === MODEL_NAME, "report_model_mismatch");
assert((sourceReport?.preflight?.providerProof?.authoritativeLoraBindings ?? []).length === 0, "unexpected_lora_binding");

const referenceSourceHashes = {};
for (const [slot, field] of Object.entries(referenceFields)) {
  const path = identity?.[field];
  assert(typeof path === "string" && path.trim(), `reference_path_missing:${slot}`);
  referenceSourceHashes[slot] = await sha256File(path);
}

const contextResult = buildTrustedCharacterGenerationEvidenceContext({
  asset,
  mode: "zero_shot_multi_reference",
  providerId: PROVIDER_ID,
  modelName: MODEL_NAME,
  workflowProof: sourceReport.preflight.providerProof,
  referenceSourceHashes
});
assert(contextResult.ok, `trusted_context_invalid:${contextResult.reason}`);

const report = structuredClone(sourceReport);
report.trustedReceipt = await attestCharacterGenerationReport(report, { registryRoot });
const reportReceiptVerification = await verifyCharacterEvidenceReceiptFromRegistry(
  { receipt: report.trustedReceipt, evidence: report },
  { registryRoot }
);
assert(reportReceiptVerification.valid, `report_receipt_invalid:${reportReceiptVerification.reason}`);

const imported = applyCharacterGenerationEvidenceImport({
  asset,
  mode: "zero_shot_multi_reference",
  report,
  context: contextResult.context,
  reportLabel: basename(REPORT_PATH),
  trustedReceiptVerification: reportReceiptVerification
});
assert(imported.valid && imported.patch, `evidence_import_failed:${imported.reason}`);

const evidenceReceiptVerification = await verifyCharacterEvidenceReceiptFromRegistry(
  { receipt: imported.evidence.trustedReceipt, evidence: imported.evidence },
  { registryRoot }
);
assert(evidenceReceiptVerification.valid, `stored_receipt_invalid:${evidenceReceiptVerification.reason}`);
const storedValidation = validateStoredCharacterGenerationEvidence(imported.evidence, contextResult.context, {
  trustedReceiptVerification: evidenceReceiptVerification
});
assert(storedValidation.valid, `stored_evidence_invalid:${storedValidation.reason}`);

const changedReferenceHashes = { ...referenceSourceHashes, face_master: "0".repeat(64) };
const changedContext = buildTrustedCharacterGenerationEvidenceContext({
  asset,
  mode: "zero_shot_multi_reference",
  providerId: PROVIDER_ID,
  modelName: MODEL_NAME,
  workflowProof: sourceReport.preflight.providerProof,
  referenceSourceHashes: changedReferenceHashes
});
assert(changedContext.ok, `changed_context_invalid:${changedContext.reason}`);
const mismatchValidation = validateStoredCharacterGenerationEvidence(imported.evidence, changedContext.context, {
  trustedReceiptVerification: evidenceReceiptVerification
});
assert(mismatchValidation.reason === "reference_manifest_mismatch", `reference_invalidation_failed:${mismatchValidation.reason}`);

const importedAsset = { ...asset, ...imported.patch };
const track = resolveCharacterGenerationTrack({
  characterAssetId: importedAsset.id,
  identityPackVersion: identity.version,
  providerId: PROVIDER_ID,
  modelName: MODEL_NAME,
  characterLora: importedAsset.characterLora,
  characterZeroShotEvidence: importedAsset.characterZeroShotEvidence,
  currentZeroContext: importedAsset.currentZeroContext,
  trustedZeroReceiptVerification: evidenceReceiptVerification,
  compiledWorkflow: JSON.stringify(workflow)
});
assert(track?.mode === "zero_shot_multi_reference" && track?.providerId === PROVIDER_ID && track?.appliedLora === null, "production_track_resolution_failed");

const outputProject = structuredClone(project);
outputProject.snapshot.assets[assetIndex] = importedAsset;
await writeFile(OUTPUT_PATH, `${JSON.stringify(outputProject, null, 2)}\n`, { flag: "wx" });

process.stdout.write(`${JSON.stringify({
  status: "PASS",
  outputProject: OUTPUT_PATH,
  registryRoot,
  receiptId: report.trustedReceipt.receiptId,
  evidenceDigest: imported.evidence.evidenceDigest,
  sourceReportDigest: imported.evidence.sourceReportDigest,
  referenceManifestDigest: imported.evidence.referenceManifestDigest,
  aggregateScore: imported.evidence.aggregateScore,
  acceptedShots: imported.evidence.acceptedShots,
  mismatchReason: mismatchValidation.reason,
  generationTrack: track
}, null, 2)}\n`);
