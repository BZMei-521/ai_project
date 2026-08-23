import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildCharacterEvidenceReceiptClaims,
  computeCharacterEvidenceReceiptClaimsDigest,
  validateCharacterEvidenceReceipt
} from "../src/modules/comfy-pipeline/characterEvidenceReceiptRuntime.mjs";
import { validateCharacterGenerationReport } from "../src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs";
import { canonicalizeReferenceSources, expandCanonicalReferenceSources } from "./character-reference-binding.mjs";
import { computeReferenceManifestDigest, routeShotIdentityReferences, transformReferenceWithPython } from "./run-character-consistency-benchmark.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_PATH = path.join(ROOT, "examples/character-consistency-benchmark/benchmark.json");
const EVALUATOR_PATH = path.join(ROOT, "scripts/evaluators/siglip2-character-evaluator.mjs");
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(",")}]` : plain(value) ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}` : JSON.stringify(value);
const fail = (code) => Object.assign(new Error(code), { code });

async function regularRealPath(value, { root = null } = {}) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw fail("receipt_path_invalid");
  const real = await fs.realpath(path.resolve(value));
  const metadata = await fs.stat(real);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_IMAGE_BYTES) throw fail("receipt_artifact_invalid");
  const extension = path.extname(real).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) throw fail("receipt_artifact_invalid");
  const header = await fs.readFile(real).then((bytes) => bytes.subarray(0, 12));
  const format = header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "png"
    : header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff ? "jpeg"
      : header.length >= 12 && header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP" ? "webp" : null;
  const expected = extension === ".png" ? "png" : extension === ".webp" ? "webp" : "jpeg";
  if (format !== expected) throw fail("receipt_artifact_invalid");
  if (root) {
    const relative = path.relative(root, real);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw fail("receipt_path_invalid");
  }
  return real;
}

async function loadProductionEvaluator() {
  const loaded = await import(`${pathToFileURL(EVALUATOR_PATH).href}?attest=${Date.now()}`);
  return {
    evaluateShot: loaded.evaluateCharacterShot,
    closeEvaluator: loaded.closeEvaluator,
    proof: {
      id: loaded.evaluatorId,
      version: loaded.evaluatorVersion,
      implementationHash: loaded.evaluatorImplementationHash,
      policyHash: loaded.evaluatorPolicyHash,
      dimensionThreshold: loaded.dimensionThreshold
    }
  };
}

const sameNumber = (left, right) => typeof left === "number" && typeof right === "number" && Math.abs(left - right) <= 1e-6;

export async function verifyCharacterReportArtifacts(report, dependencies = {}) {
  const reportValidation = validateCharacterGenerationReport(report);
  if (!reportValidation.valid || !reportValidation.eligible) throw fail(reportValidation.valid ? "report_not_evidence_eligible" : "report_digest_mismatch");
  const bundle = report?.verificationBundle;
  if (!plain(bundle) || bundle.schemaVersion !== 1 || !Array.isArray(bundle.outputs) || bundle.outputs.length !== 8 || !Array.isArray(bundle.references) || bundle.references.length !== 3) throw fail("receipt_verification_bundle_missing");
  const fixture = dependencies.fixture ?? JSON.parse(await fs.readFile(FIXTURE_PATH, "utf8"));
  if (!Array.isArray(fixture?.shots) || fixture.shots.length !== 8) throw fail("receipt_fixture_invalid");
  const evaluator = dependencies.evaluator ?? await loadProductionEvaluator();
  const proof = evaluator.proof;
  for (const [field, reportField] of [["id", "id"], ["version", "version"], ["implementationHash", "implementationHash"], ["policyHash", "policyHash"], ["dimensionThreshold", "dimensionThreshold"]]) {
    if (proof?.[field] !== report?.evaluatorProof?.[reportField]) throw fail("receipt_evaluator_mismatch");
  }
  const artifactRoot = await fs.realpath(path.resolve(bundle.artifactRoot));
  const outputById = new Map(bundle.outputs.map((item) => [item?.id, item]));
  if (bundle.references.map((item) => item?.slot).join(",") !== "front,side,back") throw fail("receipt_reference_invalid");
  const canonicalSources = [];
  for (const item of bundle.references) {
    if (!plain(item) || !/^[a-f0-9]{64}$/.test(item.sourceSha256 ?? "")) throw fail("receipt_reference_invalid");
    const sourcePath = await regularRealPath(item.sourcePath);
    const bytes = await fs.readFile(sourcePath);
    if (sha(bytes) !== item.sourceSha256.toLowerCase()) throw fail("receipt_reference_hash_mismatch");
    canonicalSources.push({ slot: item.slot, sourcePath, sourceSha256: item.sourceSha256, logicalLabel: item.slot });
  }
  const references = expandCanonicalReferenceSources(canonicalizeReferenceSources(canonicalSources));
  const identityContext = bundle.identityContext;
  if (!plain(identityContext) || identityContext.characterAssetId !== report.subject?.characterAssetId || identityContext.identityPackVersion !== report.subject?.identityPackVersion || identityContext.identityMetadataDigest !== report.subject?.identityMetadataDigest) throw fail("receipt_identity_context_mismatch");
  const expectedManifest = references.map(({ slot, sourceSha256, logicalLabel }) => ({ slot, sourceSha256, logicalLabel })).sort((a, b) => a.slot.localeCompare(b.slot));
  if (stable(report.referenceManifest) !== stable(expectedManifest) || report.referenceManifestDigest !== computeReferenceManifestDigest(fixture, references)) throw fail("receipt_reference_manifest_mismatch");
  if (!Array.isArray(report.references) || report.references.length !== 16) throw fail("receipt_reference_evidence_mismatch");
  const recomputedReferenceEvidence = [];
  const transformRoot = await fs.mkdtemp(path.join(os.tmpdir(), "character-attestation-reference-"));
  try {
    for (const shot of fixture.shots) {
      for (const [index, routed] of routeShotIdentityReferences(shot, references).entries()) {
        const outputPath = path.join(transformRoot, `${shot.id}-${index}.png`);
        await (dependencies.transformReference ?? transformReferenceWithPython)({ inputPath: routed.sourcePath, outputPath, transform: routed.transform, signal: new AbortController().signal });
        const transformedSha256 = sha(await fs.readFile(outputPath));
        recomputedReferenceEvidence.push({ shotId: shot.id, slot: routed.requestedSlot, sourceSha256: routed.sourceSha256, transformedSha256, transform: routed.transform });
      }
    }
  } finally { await fs.rm(transformRoot, { recursive: true, force: true }).catch(() => undefined); }
  if (stable(report.references) !== stable(recomputedReferenceEvidence)) throw fail("receipt_reference_evidence_mismatch");
  try {
    for (const shot of report.shots) {
      const declared = outputById.get(shot.id);
      const fixtureShot = fixture.shots.find((item) => item.id === shot.id);
      if (!plain(declared) || !fixtureShot) throw fail("receipt_shot_invalid");
      const outputPath = await regularRealPath(declared.outputPath, { root: artifactRoot });
      const bytes = await fs.readFile(outputPath);
      const outputSha256 = sha(bytes);
      if (outputSha256 !== shot.outputSha256 || outputSha256 !== declared.outputSha256) throw fail("receipt_output_hash_mismatch");
      const result = await evaluator.evaluateShot({
        outputPath,
        outputSha256,
        shot: structuredClone(fixtureShot),
        providerProof: structuredClone(report.preflight.providerProof),
        references: structuredClone(references),
        signal: new AbortController().signal
      });
      if (!plain(result) || result.status !== "accepted" || result.actualProvider !== shot.actualProvider || result.provenance !== shot.provenance || !sameNumber(result.score, shot.score)) throw fail("receipt_evaluation_mismatch");
      for (const dimension of ["face", "hair", "outfit", "body", "quality"]) if (!sameNumber(result.dimensionScores?.[dimension], shot.dimensionScores?.[dimension])) throw fail("receipt_evaluation_mismatch");
    }
  } finally {
    await evaluator.closeEvaluator?.().catch(() => undefined);
  }
  const claims = buildCharacterEvidenceReceiptClaims(report, report.evidenceDigest);
  if (!claims) throw fail("trusted_receipt_claims_invalid");
  return claims;
}

async function secureRegistryRoot(registryRoot) {
  const root = path.resolve(String(registryRoot ?? ""));
  if (!path.isAbsolute(root) || root.includes("\0")) throw fail("receipt_registry_invalid");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.chmod(root, 0o700).catch(() => undefined);
  return await fs.realpath(root);
}

export async function attestCharacterGenerationReport(report, { registryRoot, verifyArtifacts = verifyCharacterReportArtifacts, randomBytes = crypto.randomBytes, now = () => new Date().toISOString() } = {}) {
  const claims = await verifyArtifacts(report);
  const root = await secureRegistryRoot(registryRoot);
  const receiptId = randomBytes(32).toString("hex");
  if (!/^[a-f0-9]{64}$/.test(receiptId)) throw fail("trusted_receipt_invalid");
  const receipt = { schemaVersion: 1, issuer: "storyboard-desktop-character-evidence-v1", receiptId, ...claims, claimsDigest: computeCharacterEvidenceReceiptClaimsDigest(claims) };
  const record = { receipt, issuedAt: now() };
  const target = path.join(root, `${receiptId}.json`);
  const temporary = path.join(root, `.${receiptId}.${process.pid}.tmp`);
  await fs.writeFile(temporary, `${JSON.stringify(record)}\n`, { flag: "wx", mode: 0o600 });
  try { await fs.rename(temporary, target); } finally { await fs.rm(temporary, { force: true }).catch(() => undefined); }
  await fs.chmod(target, 0o600).catch(() => undefined);
  return receipt;
}

export async function verifyCharacterEvidenceReceiptFromRegistry({ receipt, evidence }, { registryRoot } = {}) {
  if (!plain(receipt) || !/^[a-f0-9]{64}$/.test(receipt.receiptId ?? "")) return { valid: false, reason: "trusted_receipt_invalid" };
  const root = await secureRegistryRoot(registryRoot);
  const target = path.resolve(root, `${receipt.receiptId}.json`);
  if (path.dirname(target) !== root) return { valid: false, reason: "trusted_receipt_invalid" };
  let record;
  try {
    const canonicalTarget = await fs.realpath(target);
    if (path.dirname(canonicalTarget) !== root) return { valid: false, reason: "trusted_receipt_invalid" };
    record = JSON.parse(await fs.readFile(canonicalTarget, "utf8"));
  } catch { return { valid: false, reason: "trusted_receipt_unknown" }; }
  if (!plain(record?.receipt) || stable(record.receipt) !== stable(receipt)) return { valid: false, reason: "trusted_receipt_registry_mismatch" };
  const validation = validateCharacterEvidenceReceipt(receipt, evidence, { valid: true, receiptId: receipt.receiptId, claimsDigest: receipt.claimsDigest }, evidence?.sourceReportDigest ?? evidence?.evidenceDigest);
  return validation.valid ? { ...validation, receiptId: receipt.receiptId } : validation;
}
