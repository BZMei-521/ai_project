import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { attestCharacterGenerationReport, verifyCharacterEvidenceReceiptFromRegistry } from "./character-evidence-attestation.mjs";

const tauriConfig = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
assert.equal(
  tauriConfig.bundle.resources["../scripts/prepare-character-reference.py"],
  "scripts/prepare-character-reference.py",
  "the reference transformer used by the packaged attestor must be a Tauri resource"
);
const packagedAttestor = tauriConfig.bundle.resources["../scripts/evaluators/siglip2-character-attestor.py"];
const packagedPreparerFromAttestor = path.posix.normalize(path.posix.join(path.posix.dirname(packagedAttestor), "..", "prepare-character-reference.py"));
assert.equal(packagedPreparerFromAttestor, tauriConfig.bundle.resources["../scripts/prepare-character-reference.py"], "the packaged attestor's HERE.parent lookup must resolve to the packaged transformer target");
assert.equal(
  existsSync(new URL("./prepare-character-reference.py", import.meta.url)),
  true,
  "the configured attestor reference transformer must exist at its development path"
);
import { buildCharacterEvidenceReceiptClaims } from "../src/modules/comfy-pipeline/characterEvidenceReceiptRuntime.mjs";
import { Readable } from "node:stream";
import { readLimitedJsonBody } from "./windows-web-request-body.mjs";

const hashes = Array.from({ length: 8 }, (_, index) => String(index + 1).repeat(64));
const report = {
  evidenceDigest: "a".repeat(64), generationMode: "zero_shot_multi_reference", fixtureDigest: "b".repeat(64), referenceManifestDigest: "9".repeat(64), references: [],
  subject: { characterAssetId: "asset_ada", identityPackVersion: "v1", identityMetadataDigest: "c".repeat(64) },
  evaluatorProof: { implementationHash: "d".repeat(64), policyHash: "e".repeat(64) },
  shots: hashes.map((outputSha256, index) => ({ id: `shot-${index}`, outputSha256 }))
};
const claims = buildCharacterEvidenceReceiptClaims(report, report.evidenceDigest);
const root = await mkdtemp(path.join(os.tmpdir(), "character-receipts-"));
try {
  await assert.rejects(readLimitedJsonBody(Object.assign(Readable.from([Buffer.alloc(6), Buffer.alloc(6)]), { headers: {} }), 10), (error) => error?.statusCode === 413, "chunked web requests fail closed when their streamed body crosses the cap");
  await assert.rejects(readLimitedJsonBody(Object.assign(Readable.from([]), { headers: { "content-length": "11" } }), 10), (error) => error?.statusCode === 413, "declared oversized web requests receive 413 before body buffering");
  const receipt = await attestCharacterGenerationReport(report, { registryRoot: root, verifyArtifacts: async () => claims, randomBytes: () => Buffer.alloc(32, 7), now: () => "2026-08-09T00:00:00.000Z" });
  const evidence = { ...report, sourceReportDigest: report.evidenceDigest, trustedReceipt: receipt };
  const verification = await verifyCharacterEvidenceReceiptFromRegistry({ receipt, evidence }, { registryRoot: root });
  assert.equal(verification.valid, true, "registry-backed receipt verifies its exact claims");
  assert.equal(verification.receiptId, receipt.receiptId, "registry verification returns the receipt ID required by the importer");
  assert.equal(verification.claimsDigest, receipt.claimsDigest, "registry verification returns the claims digest required by the importer");
  assert.equal((await verifyCharacterEvidenceReceiptFromRegistry({ receipt: { ...receipt, generationMode: "lora_augmented" }, evidence }, { registryRoot: root })).valid, false, "edited receipt cannot replay its registry ID");
  assert.equal((await verifyCharacterEvidenceReceiptFromRegistry({ receipt, evidence: { ...evidence, subject: { ...evidence.subject, identityMetadataDigest: "f".repeat(64) } } }, { registryRoot: root })).valid, false, "identity metadata edits invalidate a receipt");
  assert.equal((await verifyCharacterEvidenceReceiptFromRegistry({ receipt, evidence: { ...evidence, shots: evidence.shots.map((shot, index) => index ? shot : { ...shot, outputSha256: "f".repeat(64) }) } }, { registryRoot: root })).valid, false, "output-byte hash edits invalidate a receipt");
  assert.equal((await verifyCharacterEvidenceReceiptFromRegistry({ receipt: { ...receipt, receiptId: "../" + "a".repeat(61) }, evidence }, { registryRoot: root })).reason, "trusted_receipt_invalid", "registry lookup rejects path traversal receipt IDs");
  assert.equal((await verifyCharacterEvidenceReceiptFromRegistry({ receipt: { ...receipt, receiptId: "A".repeat(64) }, evidence }, { registryRoot: root })).reason, "trusted_receipt_invalid", "registry lookup accepts only canonical lowercase hex IDs");
  assert.equal((await verifyCharacterEvidenceReceiptFromRegistry({ receipt, evidence: { ...evidence, referenceManifestDigest: "8".repeat(64) } }, { registryRoot: root })).valid, false, "reference binding edits invalidate a receipt");
  const record = JSON.parse(await readFile(path.join(root, `${receipt.receiptId}.json`), "utf8"));
  assert.equal(record.receipt.claimsDigest, receipt.claimsDigest, "the atomically published registry record contains the exact receipt");
  const comfyPython = process.env.COMFYUI_PYTHON || "C:\\Users\\Administrator\\AppData\\Local\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI\\ComfyUI\\.venv\\Scripts\\python.exe";
  if (existsSync(comfyPython)) {
    const crossRuntime = spawnSync(comfyPython, [path.resolve("scripts/evaluators/siglip2-character-attestor.py"), "verify", root], { input: JSON.stringify({ receipt, evidence }), encoding: "utf8", windowsHide: true });
    assert.equal(crossRuntime.status, 0, crossRuntime.stderr);
    assert.equal(JSON.parse(crossRuntime.stdout).valid, true, "Tauri Python attestor verifies the same canonical receipt claims as the Windows Node bridge");
    for (const invalidId of ["../" + "a".repeat(61), "A".repeat(64), "g".repeat(64)]) {
      const invalid = spawnSync(comfyPython, [path.resolve("scripts/evaluators/siglip2-character-attestor.py"), "verify", root], { input: JSON.stringify({ receipt: { ...receipt, receiptId: invalidId }, evidence }), encoding: "utf8", windowsHide: true });
      assert.equal(invalid.status, 0, invalid.stderr);
      assert.equal(JSON.parse(invalid.stdout).reason, "trusted_receipt_invalid", `Python rejects non-canonical receipt id ${invalidId.slice(0, 4)}`);
    }
  }
} finally { await rm(root, { recursive: true, force: true }); }
console.log("PASS desktop character evidence receipt registry and anti-replay claims");
