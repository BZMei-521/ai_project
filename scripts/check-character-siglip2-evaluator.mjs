import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSiglip2Evaluator,
  evaluatorId,
  evaluatorImplementationHash,
  evaluatorPolicyHash,
  evaluatorVersion,
  modelRevision
} from "./evaluators/siglip2-character-evaluator.mjs";
import { createFetchTransport, loadTrustedEvaluator, stageComfyOutputForEvaluation } from "./run-character-consistency-benchmark.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(await readFile(path.join(repoRoot, "examples/character-consistency-benchmark/siglip2-evaluator.example.json"), "utf8"));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function workerResponse(embedding, quality = 0.9, extra = {}) {
  return { ok: true, embedding, quality, modelId: policy.modelId, modelRevision: policy.modelRevision, ...extra };
}

function fakeWorkerFor({ output = [1, 0], face = [1, 0], body = [0.8, 0.6], quality = 0.9, response = null } = {}) {
  const calls = [];
  let closed = 0;
  return {
    calls,
    get closed() { return closed; },
    async request(message) {
      calls.push(structuredClone(message));
      if (response) return response(message);
      if (message.path.endsWith("output.png")) return workerResponse(output, quality);
      if (message.path.endsWith("face.png")) return workerResponse(face);
      return workerResponse(body);
    },
    async close() { closed += 1; }
  };
}

function context(root, overrides = {}) {
  return {
    outputPath: path.join(root, "output.png"),
    outputSha256: sha256("trusted output bytes"),
    shot: {
      id: "three_quarter_medium",
      scale: "medium",
      expectedView: "three_quarter",
      evaluation: { minimumScore: 0.75, requiredDimensions: ["face", "hair", "outfit", "body", "quality"] }
    },
    references: [
      { requestedSlot: "face_master", slot: "face_master", sourcePath: path.join(root, "face.png") },
      { requestedSlot: "body_side", slot: "body_side", sourcePath: path.join(root, "body.png") }
    ],
    providerProof: { providerId: "flux2_klein_4b", terminalOutputNode: "6" },
    score: 0,
    dimensionScores: { face: 0 },
    workerModelRevision: policy.modelRevision,
    ...overrides
  };
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "siglip2-evaluator-test-"));
try {
  for (const name of ["output.png", "face.png", "body.png"]) await writeFile(path.join(tempRoot, name), "test image placeholder");

  const worker = fakeWorkerFor();
  const evaluator = createSiglip2Evaluator({ worker, policy, requestTimeoutMs: 100 });
  const result = await evaluator.evaluateCharacterShot(context(tempRoot));
  assert.deepEqual(Object.keys(result.dimensionScores).sort(), ["body", "face", "hair", "outfit", "quality"]);
  assert.equal(result.provenance, "model_generation");
  assert.equal(result.actualProvider, "flux2_klein_4b");
  assert.equal(result.status, "accepted");
  assert.equal(result.score, 0.952, "medium scale weights are applied to independently computed dimensions");
  assert.deepEqual(result.dimensionScores, { face: 1, hair: 1, outfit: 0.9, body: 0.9, quality: 0.9 });
  assert.notEqual(result.score, 0, "caller score is ignored");
  assert.notDeepEqual(result.dimensionScores, context(tempRoot).dimensionScores, "caller dimension scores are ignored");
  assert.equal(result.evaluatorId, evaluatorId);
  assert.equal(result.evaluatorVersion, evaluatorVersion);
  assert.equal(result.evaluatorPolicyHash, evaluatorPolicyHash);
  assert.equal(result.evaluatorImplementationHash, evaluatorImplementationHash);
  assert.equal(result.modelRevision, modelRevision);
  assert.match(evaluatorPolicyHash, /^[a-f0-9]{64}$/);
  assert.match(evaluatorImplementationHash, /^[a-f0-9]{64}$/);
  const implementationBytes = Buffer.concat([
    await readFile(path.join(repoRoot, "scripts/evaluators/siglip2-character-evaluator.mjs")),
    await readFile(path.join(repoRoot, "scripts/evaluators/siglip2-character-worker.py")),
    await readFile(path.join(repoRoot, "examples/character-consistency-benchmark/siglip2-evaluator.example.json")),
    Buffer.from(policy.modelRevision)
  ]);
  assert.equal(evaluatorImplementationHash, sha256(implementationBytes), "implementation proof covers exact ESM, Python, policy, and revision bytes");
  assert.equal(evaluatorPolicyHash, sha256(Buffer.concat([await readFile(path.join(repoRoot, "examples/character-consistency-benchmark/siglip2-evaluator.example.json")), Buffer.from(policy.modelRevision)])));

  const normalizedWorker = fakeWorkerFor({ output: [10, 0], face: [20, 0], body: [8, 6] });
  const normalized = await createSiglip2Evaluator({ worker: normalizedWorker, policy }).evaluateCharacterShot(context(tempRoot));
  assert.deepEqual(normalized.dimensionScores, result.dimensionScores, "finite embeddings are normalized before cosine scoring");

  const closeWorker = fakeWorkerFor({ quality: 0.9 });
  const closeScale = await createSiglip2Evaluator({ worker: closeWorker, policy }).evaluateCharacterShot(context(tempRoot, { shot: { ...context(tempRoot).shot, scale: "close" } }));
  assert.equal(closeScale.score, 0.97, "close scale uses its own declared weights");

  const floorWorker = fakeWorkerFor({ face: [0.5, Math.sqrt(0.75)], body: [1, 0], quality: 1 });
  const floorResult = await createSiglip2Evaluator({ worker: floorWorker, policy }).evaluateCharacterShot(context(tempRoot, { shot: { ...context(tempRoot).shot, evaluation: { minimumScore: 0.7, requiredDimensions: ["face"] } } }));
  assert.ok(floorResult.score > 0.7, "weighted average remains above the shot minimum");
  assert.equal(floorResult.status, "needs_review", "a required dimension below its policy floor fails closed");
  assert.deepEqual(floorResult.failureDimensions, ["face"]);

  const lowQualityWorker = fakeWorkerFor({ quality: 0.5 });
  const lowQuality = await createSiglip2Evaluator({ worker: lowQualityWorker, policy }).evaluateCharacterShot(context(tempRoot));
  assert.equal(lowQuality.status, "needs_review");
  assert.deepEqual(lowQuality.failureDimensions, ["quality"]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(lowQuality.dimensionScores).filter(([key]) => key !== "quality")),
    Object.fromEntries(Object.entries(result.dimensionScores).filter(([key]) => key !== "quality")),
    "quality is independent of reference similarity"
  );

  await assert.rejects(() => evaluator.evaluateCharacterShot(context(tempRoot, { outputPath: "" })), /output/i);
  await assert.rejects(() => evaluator.evaluateCharacterShot(context(tempRoot, { references: [] })), /reference/i);
  await assert.rejects(() => evaluator.evaluateCharacterShot(context(tempRoot, { references: [{ requestedSlot: "face_master", sourcePath: "" }] })), /reference/i);
  const missingView = context(tempRoot); delete missingView.shot.expectedView;
  await assert.rejects(() => evaluator.evaluateCharacterShot(missingView), /view/i);
  await assert.rejects(() => evaluator.evaluateCharacterShot(context(tempRoot, { workerModelRevision: "wrong" })), /revision/i);

  const wrongRevisionWorker = fakeWorkerFor({ response: (message) => workerResponse([1, 0], 0.9, { modelRevision: "wrong", id: message.id }) });
  await assert.rejects(() => createSiglip2Evaluator({ worker: wrongRevisionWorker, policy }).evaluateCharacterShot(context(tempRoot)), /revision/i);
  assert.equal(wrongRevisionWorker.closed, 1, "model revision mismatch closes the untrusted worker");

  for (const embedding of [[Number.NaN, 0], [Number.POSITIVE_INFINITY, 0], [0, 0], [1]]) {
    const invalidWorker = fakeWorkerFor({ response: () => workerResponse(embedding) });
    await assert.rejects(() => createSiglip2Evaluator({ worker: invalidWorker, policy }).evaluateCharacterShot(context(tempRoot)), /embedding/i);
    assert.equal(invalidWorker.closed, 1, "invalid embeddings terminate the worker");
  }

  const malformedWorker = fakeWorkerFor({ response: async () => { const error = Object.assign(new Error("malformed NDJSON response"), { code: "EWORKER_PROTOCOL" }); throw error; } });
  await assert.rejects(() => createSiglip2Evaluator({ worker: malformedWorker, policy }).evaluateCharacterShot(context(tempRoot)), /NDJSON|protocol/i);
  assert.equal(malformedWorker.closed, 1, "malformed NDJSON fails closed and terminates the worker");

  const hangingWorker = { killed: 0, async request() { return new Promise(() => {}); }, async close() { this.killed += 1; } };
  await assert.rejects(() => createSiglip2Evaluator({ worker: hangingWorker, policy, requestTimeoutMs: 10 }).evaluateCharacterShot(context(tempRoot)), /timed out/i);
  assert.equal(hangingWorker.killed, 1, "timeout kills the persistent worker");

  const cancelledWorker = { killed: 0, async request() { return new Promise(() => {}); }, async close() { this.killed += 1; } };
  const controller = new AbortController();
  const cancelled = createSiglip2Evaluator({ worker: cancelledWorker, policy, requestTimeoutMs: 1_000 }).evaluateCharacterShot(context(tempRoot, { signal: controller.signal }));
  controller.abort(Object.assign(new Error("cancelled"), { code: "ECANCELLED" }));
  await assert.rejects(cancelled, /cancel/i);
  assert.equal(cancelledWorker.killed, 1, "cancellation kills the persistent worker");

  const trusted = await loadTrustedEvaluator(path.join(repoRoot, "scripts/evaluators/siglip2-character-evaluator.mjs"));
  assert.equal(trusted.proof.id, evaluatorId);
  assert.equal(trusted.proof.version, evaluatorVersion);
  assert.equal(trusted.proof.policyHash, evaluatorPolicyHash);
  assert.equal(trusted.proof.implementationHash, evaluatorImplementationHash, "runner trusts the exported multi-file content hash");
  assert.equal(trusted.requiresLocalOutput, true);
  await trusted.closeEvaluator();

  const pngBytes = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63606060f80f0001040100fca2c88f0000000049454e44ae426082", "hex");
  const artifactRoot = path.join(tempRoot, "report-artifacts");
  const staged = await stageComfyOutputForEvaluation({ response: { bytes: pngBytes, contentType: "image/png" }, artifactRoot, shotId: "front_close" });
  assert.equal(await readFile(staged.outputPath, "hex"), pngBytes.toString("hex"));
  assert.equal(staged.outputSha256, sha256(pngBytes));
  assert.match(staged.outputPath, /report-artifacts[\\/]front_close-[a-f0-9]{16}\.png$/);
  await assert.rejects(() => stageComfyOutputForEvaluation({ response: { bytes: pngBytes, contentType: "text/html" }, artifactRoot, shotId: "bad_mime" }), /content.?type|image/i);
  await assert.rejects(() => stageComfyOutputForEvaluation({ response: { bytes: pngBytes, contentType: null }, artifactRoot, shotId: "missing_mime" }), /content.?type|image/i);
  await assert.rejects(() => stageComfyOutputForEvaluation({ response: { bytes: Buffer.alloc(40 * 1024 * 1024 + 1), contentType: "image/png" }, artifactRoot, shotId: "too_large" }), /40 MiB|large/i);
  await assert.rejects(() => stageComfyOutputForEvaluation({ response: { bytes: pngBytes, contentType: "image/png" }, artifactRoot, shotId: "front_close" }), /exist|overwrite/i, "exclusive creation refuses an existing staged artifact");
  let oversizedBodyRead = false;
  const oversizedTransport = createFetchTransport(async () => ({ ok: true, headers: { get: (name) => name === "content-length" ? String(40 * 1024 * 1024 + 1) : "image/png" }, async arrayBuffer() { oversizedBodyRead = true; return pngBytes; } }));
  await assert.rejects(() => oversizedTransport.getBytes("http://127.0.0.1:8188/view?filename=x.png&subfolder=&type=output"), /40 MiB|large/i);
  assert.equal(oversizedBodyRead, false, "declared oversized output is rejected before buffering the body");

  await evaluator.closeEvaluator();
  assert.equal(worker.closed, 1);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("PASS trusted local SigLIP2 evaluator protocol, scoring, provenance, and fail-closed controls");
