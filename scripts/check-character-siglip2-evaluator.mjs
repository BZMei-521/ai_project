import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  createPersistentSiglip2Worker,
  createSiglip2Evaluator,
  dimensionThreshold,
  evaluatorId,
  evaluatorImplementationHash,
  evaluatorPolicyHash,
  evaluatorSnapshotManifestHash,
  evaluatorVersion,
  modelRevision
} from "./evaluators/siglip2-character-evaluator.mjs";
import { createFetchTransport, installBenchmarkSignalHandlers, loadTrustedEvaluator, stageComfyOutputForEvaluation } from "./run-character-consistency-benchmark.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(await readFile(path.join(repoRoot, "examples/character-consistency-benchmark/siglip2-evaluator.example.json"), "utf8"));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const comfyPython = "C:\\Users\\Administrator\\AppData\\Local\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI\\ComfyUI\\.venv\\Scripts\\python.exe";

async function runChild(command, args, { input = null } = {}) {
  const child = spawn(command, args, { cwd: repoRoot, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
  if (input === null) child.stdin.end(); else child.stdin.end(input);
  const [code] = await once(child, "close"); return { code, stdout, stderr };
}

function fakeChild({ closeOnEnd = false, closeOnKill = true, writeError = null } = {}) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.writes = []; child.kills = [];
  const originalWrite = child.stdin.write.bind(child.stdin); child.stdin.write = (chunk, callback) => { child.writes.push(String(chunk)); if (writeError) { queueMicrotask(() => callback?.(writeError)); return false; } return originalWrite(chunk, callback); };
  const originalEnd = child.stdin.end.bind(child.stdin); child.stdin.end = (...args) => { const result = originalEnd(...args); if (closeOnEnd) queueMicrotask(() => child.emit("close", 0, null)); return result; };
  child.kill = (signal = "SIGTERM") => { child.kills.push(signal); if (closeOnKill) queueMicrotask(() => child.emit("close", null, signal)); return true; };
  return child;
}

function workerResponse(embedding, quality = 0.9, extra = {}) {
  return { ok: true, embedding, quality, modelId: policy.modelId, modelRevision: policy.modelRevision, snapshotManifestHash: evaluatorSnapshotManifestHash, ...extra };
}

function expectedImageDigest(imagePath) {
  const name = path.basename(imagePath, path.extname(imagePath));
  return sha256(name === "output" ? "trusted output bytes" : name);
}

function fakeWorkerFor({ output = [1, 0], face = [1, 0], body = [0.8, 0.6], quality = 0.9, response = null } = {}) {
  const calls = [];
  let closed = 0;
  return {
    calls,
    get closed() { return closed; },
    async request(message) {
      calls.push(structuredClone(message));
      const raw = response ? await response(message) : message.path.endsWith("output.png") ? workerResponse(output, quality) : message.path.endsWith("face.png") ? workerResponse(face) : workerResponse(body);
      return { ...raw, imageSha256: raw.imageSha256 ?? expectedImageDigest(message.path) };
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
      { requestedSlot: "face_master", slot: "face_master", sourcePath: path.join(root, "face.png"), sourceSha256: sha256("face") },
      { requestedSlot: "body_side", slot: "body_side", sourcePath: path.join(root, "body.png"), sourceSha256: sha256("body") }
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
  assert.equal(dimensionThreshold, Math.min(...Object.values(policy.dimensionFloors)));
  assert.match(evaluatorPolicyHash, /^[a-f0-9]{64}$/);
  assert.match(evaluatorImplementationHash, /^[a-f0-9]{64}$/);
  const implementationBytes = Buffer.concat([
    await readFile(path.join(repoRoot, "scripts/evaluators/siglip2-character-evaluator.mjs")),
    await readFile(path.join(repoRoot, "scripts/evaluators/siglip2-character-worker.py")),
    await readFile(path.join(repoRoot, "examples/character-consistency-benchmark/siglip2-evaluator.example.json")),
    Buffer.from(policy.modelRevision),
    await readFile(path.join(repoRoot, "examples/character-consistency-benchmark/siglip2-snapshot-manifest.json")),
    Buffer.from(evaluatorSnapshotManifestHash)
  ]);
  assert.equal(evaluatorImplementationHash, sha256(implementationBytes), "implementation proof covers exact ESM, Python, policy, and revision bytes");
  assert.equal(evaluatorSnapshotManifestHash, sha256(JSON.stringify(JSON.parse(await readFile(path.join(repoRoot, "examples/character-consistency-benchmark/siglip2-snapshot-manifest.json"), "utf8")))));
  assert.equal(evaluatorPolicyHash, sha256(await readFile(path.join(repoRoot, "examples/character-consistency-benchmark/siglip2-evaluator.example.json"))), "production policy hash is the exact policy file hash");

  const normalizedWorker = fakeWorkerFor({ output: [10, 0], face: [20, 0], body: [8, 6] });
  const normalized = await createSiglip2Evaluator({ worker: normalizedWorker, policy }).evaluateCharacterShot(context(tempRoot));
  assert.deepEqual(normalized.dimensionScores, result.dimensionScores, "finite embeddings are normalized before cosine scoring");

  const mutablePolicy = structuredClone(policy); mutablePolicy.dimensionFloors.face = 0.1;
  const customPolicyWorker = fakeWorkerFor(); const customEvaluator = createSiglip2Evaluator({ worker: customPolicyWorker, policy: mutablePolicy });
  const capturedCustomHash = customEvaluator.evaluatorPolicyHash; mutablePolicy.dimensionFloors.face = 0.99; mutablePolicy.weightsByScale.medium.face = 0;
  assert.equal(customEvaluator.evaluatorPolicy.dimensionFloors.face, 0.1, "factory deep-clones the active policy");
  assert.equal(Object.isFrozen(customEvaluator.evaluatorPolicy), true); assert.equal(Object.isFrozen(customEvaluator.evaluatorPolicy.dimensionFloors), true); assert.equal(Object.isFrozen(customEvaluator.evaluatorPolicy.weightsByScale.medium), true);
  assert.notEqual(capturedCustomHash, evaluatorPolicyHash, "a custom active policy cannot report the production policy hash");
  const customResult = await customEvaluator.evaluateCharacterShot(context(tempRoot)); assert.equal(customResult.evaluatorPolicyHash, capturedCustomHash);

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

  const slotWorker = fakeWorkerFor({ response: ({ path: imagePath }) => {
    if (imagePath.endsWith("output.png") || /face|hair/.test(path.basename(imagePath))) return workerResponse([1, 0], 0.95);
    return workerResponse([0, 1], 0.95);
  } });
  const fullBodyContext = context(tempRoot, {
    shot: { ...context(tempRoot).shot, id: "full_body_action", scale: "full_body", evaluation: { minimumScore: 0.1, requiredDimensions: ["hair", "body"] } },
    references: [
      { slot: "face_master", sourcePath: path.join(tempRoot, "face.png"), sourceSha256: sha256("face") },
      { slot: "hair_back", sourcePath: path.join(tempRoot, "hair.png"), sourceSha256: sha256("hair") },
      { slot: "body_front", sourcePath: path.join(tempRoot, "body.png"), sourceSha256: sha256("body") }
    ]
  });
  await writeFile(path.join(tempRoot, "hair.png"), "hair");
  const fullBodySlots = await createSiglip2Evaluator({ worker: slotWorker, policy }).evaluateCharacterShot(fullBodyContext);
  assert.equal(fullBodySlots.dimensionScores.hair, 1, "full-body hair uses face/hair references, never body fallback"); assert.equal(fullBodySlots.dimensionScores.body, 0.5);

  const profileSlots = await createSiglip2Evaluator({ worker: fakeWorkerFor({ response: ({ path: imagePath }) => workerResponse(imagePath.endsWith("body.png") ? [0, 1] : [1, 0], 0.95) }), policy }).evaluateCharacterShot(context(tempRoot, {
    shot: { ...context(tempRoot).shot, id: "left_profile", expectedView: "left_profile", evaluation: { minimumScore: 0.1, requiredDimensions: ["face", "body"] } },
    references: [{ slot: "face_left", sourcePath: path.join(tempRoot, "face.png"), sourceSha256: sha256("face") }, { slot: "body_side", sourcePath: path.join(tempRoot, "body.png"), sourceSha256: sha256("body") }]
  }));
  assert.equal(profileSlots.dimensionScores.face, 1); assert.equal(profileSlots.dimensionScores.body, 0.5, "profile uses explicit face_left/body_side mappings");

  const backSlots = await createSiglip2Evaluator({ worker: fakeWorkerFor({ response: ({ path: imagePath }) => workerResponse(imagePath.endsWith("body.png") ? [0, 1] : [1, 0], 0.95) }), policy }).evaluateCharacterShot(context(tempRoot, {
    shot: { ...context(tempRoot).shot, id: "back_view", expectedView: "back", evaluation: { minimumScore: 0.1, requiredDimensions: ["hair", "outfit", "body"] } },
    references: [{ slot: "hair_back", sourcePath: path.join(tempRoot, "hair.png"), sourceSha256: sha256("hair") }, { slot: "body_back", sourcePath: path.join(tempRoot, "body.png"), sourceSha256: sha256("body") }]
  }));
  assert.equal(backSlots.dimensionScores.hair, 1); assert.equal(backSlots.dimensionScores.outfit, 0.5); assert.equal(backSlots.dimensionScores.body, 0.5);

  await assert.rejects(() => createSiglip2Evaluator({ worker: fakeWorkerFor(), policy }).evaluateCharacterShot(context(tempRoot, {
    shot: { ...context(tempRoot).shot, evaluation: { minimumScore: 0.1, requiredDimensions: ["outfit"] } }, references: [{ slot: "face_master", sourcePath: path.join(tempRoot, "face.png"), sourceSha256: sha256("face") }]
  })), (reason) => reason?.code === "EREFERENCE_DIMENSION", "a required dimension without a canonical slot fails closed");

  await assert.rejects(() => evaluator.evaluateCharacterShot(context(tempRoot, { outputPath: "" })), /output/i);
  await assert.rejects(() => evaluator.evaluateCharacterShot(context(tempRoot, { references: [] })), /reference/i);
  await assert.rejects(() => evaluator.evaluateCharacterShot(context(tempRoot, { references: [{ requestedSlot: "face_master", sourcePath: "" }] })), /reference/i);
  const missingView = context(tempRoot); delete missingView.shot.expectedView;
  await assert.rejects(() => evaluator.evaluateCharacterShot(missingView), /view/i);
  await assert.rejects(() => evaluator.evaluateCharacterShot(context(tempRoot, { workerModelRevision: "wrong" })), /revision/i);

  const wrongRevisionWorker = fakeWorkerFor({ response: (message) => workerResponse([1, 0], 0.9, { modelRevision: "wrong", id: message.id }) });
  await assert.rejects(() => createSiglip2Evaluator({ worker: wrongRevisionWorker, policy }).evaluateCharacterShot(context(tempRoot)), /revision/i);
  assert.equal(wrongRevisionWorker.closed, 1, "model revision mismatch closes the untrusted worker");

  const swappedOutputWorker = fakeWorkerFor({ response: ({ path: imagePath }) => workerResponse([1, 0], 0.9, { imageSha256: imagePath.endsWith("output.png") ? sha256("swapped output bytes") : expectedImageDigest(imagePath) }) });
  await assert.rejects(() => createSiglip2Evaluator({ worker: swappedOutputWorker, policy }).evaluateCharacterShot(context(tempRoot)), (reason) => reason?.code === "EOUTPUT_INTEGRITY", "output swapped after staging hash fails closed");

  const swappedReferenceWorker = fakeWorkerFor({ response: ({ path: imagePath }) => workerResponse([1, 0], 0.9, { imageSha256: imagePath.endsWith("face.png") ? sha256("swapped reference bytes") : expectedImageDigest(imagePath) }) });
  await assert.rejects(() => createSiglip2Evaluator({ worker: swappedReferenceWorker, policy }).evaluateCharacterShot(context(tempRoot)), (reason) => reason?.code === "EREFERENCE_INTEGRITY", "canonical reference swap/tamper fails closed");

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

  const strictModuleSource = ({ id = "strict-character-evaluator", version = "1.2.3", implementationHash = "a".repeat(64), policyHash = "b".repeat(64), threshold = 0.5, omit = null, requiresLocalOutput = true } = {}) => [
    omit === "evaluatorId" ? "" : `export const evaluatorId = ${JSON.stringify(id)};`,
    omit === "evaluatorVersion" ? "" : `export const evaluatorVersion = ${JSON.stringify(version)};`,
    omit === "evaluatorImplementationHash" ? "" : `export const evaluatorImplementationHash = ${JSON.stringify(implementationHash)};`,
    omit === "evaluatorPolicyHash" ? "" : `export const evaluatorPolicyHash = ${JSON.stringify(policyHash)};`,
    omit === "dimensionThreshold" ? "" : `export const dimensionThreshold = ${JSON.stringify(threshold)};`,
    omit === "requiresLocalOutput" ? "" : `export const requiresLocalOutput = ${JSON.stringify(requiresLocalOutput)};`,
    "export async function evaluateCharacterShot() { return {}; }",
    omit === "closeEvaluator" ? "" : "export async function closeEvaluator() {}"
  ].join("\n");
  for (const missing of ["evaluatorId", "evaluatorVersion", "evaluatorImplementationHash", "evaluatorPolicyHash", "dimensionThreshold", "closeEvaluator", "requiresLocalOutput"]) {
    const modulePath = path.join(tempRoot, `missing-${missing}.mjs`); await writeFile(modulePath, strictModuleSource({ omit: missing }));
    await assert.rejects(() => loadTrustedEvaluator(modulePath, { trustedRoot: tempRoot }), (reason) => reason?.code === "EEVALUATOR" && new RegExp(missing, "i").test(reason.message), `missing ${missing} fails closed`);
  }
  for (const [name, overrides] of [
    ["reserved-id", { id: "programmatic" }], ["reserved-version", { version: "unversioned" }], ["bad-implementation", { implementationHash: "short" }], ["bad-policy", { policyHash: "not-a-hash" }], ["zero-threshold", { threshold: 0 }], ["large-threshold", { threshold: 1.1 }], ["local-output-false", { requiresLocalOutput: false }]
  ]) {
    const modulePath = path.join(tempRoot, `${name}.mjs`); await writeFile(modulePath, strictModuleSource(overrides));
    await assert.rejects(() => loadTrustedEvaluator(modulePath, { trustedRoot: tempRoot }), (reason) => reason?.code === "EEVALUATOR", `${name} evaluator proof fails closed`);
  }

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

  for (const declaredLength of [null, String(1024)]) {
    let reads = 0; let cancelledStream = false; let arrayBufferCalled = false; const oneMiB = new Uint8Array(1024 * 1024);
    const streamingTransport = createFetchTransport(async () => ({
      ok: true,
      headers: { get: (name) => name === "content-type" ? "image/png" : declaredLength },
      body: { getReader: () => ({ async read() { reads += 1; return { done: false, value: oneMiB }; }, async cancel() { cancelledStream = true; } }) },
      async arrayBuffer() { arrayBufferCalled = true; return pngBytes; }
    }));
    await assert.rejects(() => streamingTransport.getBytes("http://127.0.0.1:8188/view?filename=x.png&subfolder=&type=output"), /40 MiB|large/i);
    assert.equal(reads, 41, "stream stops on the first chunk beyond 40 MiB"); assert.equal(cancelledStream, true); assert.equal(arrayBufferCalled, false, "streaming output never invokes unbounded arrayBuffer");
  }

  const orderedChild = fakeChild({ closeOnEnd: true }); const client = createPersistentSiglip2Worker({ spawnImpl: () => orderedChild, python: "python", workerPath: "worker.py", closeTimeoutMs: 20 });
  const firstRequest = client.request({ type: "embed", path: "a" }); const secondRequest = client.request({ type: "embed", path: "b" }); await new Promise((resolve) => setImmediate(resolve));
  const [firstId, secondId] = orderedChild.writes.map((line) => JSON.parse(line).id);
  orderedChild.stdout.write(`${JSON.stringify({ id: secondId, ok: true, embedding: [0, 1] })}\n`); orderedChild.stdout.write(`${JSON.stringify({ id: firstId, ok: true, embedding: [1, 0] })}\n`);
  assert.deepEqual((await secondRequest).embedding, [0, 1]); assert.deepEqual((await firstRequest).embedding, [1, 0]); assert.equal(client.pendingCount, 0, "out-of-order IDs resolve exactly once");
  let closeSettled = false; const closing = client.close().then(() => { closeSettled = true; }); assert.equal(closeSettled, false); await closing; assert.equal(client.pendingCount, 0);

  for (const protocolCase of ["unknown", "duplicate"]) {
    const child = fakeChild(); const protocolClient = createPersistentSiglip2Worker({ spawnImpl: () => child, python: "python", workerPath: "worker.py", closeTimeoutMs: 5 });
    const pending = protocolClient.request({ type: "embed", path: "x" }); await new Promise((resolve) => setImmediate(resolve)); const id = JSON.parse(child.writes[0]).id;
    if (protocolCase === "unknown") child.stdout.write(`${JSON.stringify({ id: "unknown-id", ok: true })}\n`);
    else { child.stdout.write(`${JSON.stringify({ id, ok: true, embedding: [1, 0] })}\n`); await pending; child.stdout.write(`${JSON.stringify({ id, ok: true, embedding: [1, 0] })}\n`); }
    if (protocolCase === "unknown") await assert.rejects(pending, /NDJSON|protocol/i);
    await new Promise((resolve) => setImmediate(resolve)); assert.equal(protocolClient.closed, true, `${protocolCase} ID closes the client`); assert.equal(protocolClient.pendingCount, 0); await protocolClient.close();
  }

  const lateChild = fakeChild({ closeOnEnd: false, closeOnKill: false }); const lateClient = createPersistentSiglip2Worker({ spawnImpl: () => lateChild, python: "python", workerPath: "worker.py", closeTimeoutMs: 20 });
  const latePending = lateClient.request({ type: "embed", path: "late" }); await new Promise((resolve) => setImmediate(resolve)); const lateId = JSON.parse(lateChild.writes[0]).id;
  const lateClosing = lateClient.close(); await assert.rejects(latePending, /closed/i); lateChild.stdout.write(`${JSON.stringify({ id: lateId, ok: true, embedding: [1, 0] })}\n`); lateChild.emit("close", 0, null); await lateClosing;
  assert.equal(lateClient.closed, true); assert.equal(lateClient.pendingCount, 0, "late response cannot resurrect a closed request");

  const writeFailureChild = fakeChild({ writeError: new Error("broken pipe") }); const writeFailureClient = createPersistentSiglip2Worker({ spawnImpl: () => writeFailureChild, python: "python", workerPath: "worker.py", closeTimeoutMs: 5 });
  await assert.rejects(writeFailureClient.request({ type: "embed", path: "x" }), /write|worker/i); assert.equal(writeFailureClient.closed, true); assert.equal(writeFailureClient.pendingCount, 0); await writeFailureClient.close();

  const slowCloseChild = fakeChild({ closeOnEnd: false, closeOnKill: true }); const slowCloseClient = createPersistentSiglip2Worker({ spawnImpl: () => slowCloseChild, python: "python", workerPath: "worker.py", closeTimeoutMs: 5 });
  await slowCloseClient.close(); assert.ok(slowCloseChild.kills.length >= 1, "bounded graceful close escalates to process kill"); assert.equal(slowCloseClient.pendingCount, 0);

  const processLike = new EventEmitter(); const signalController = new AbortController(); const signalLifecycle = installBenchmarkSignalHandlers(signalController, processLike);
  processLike.emit("SIGTERM"); assert.equal(signalController.signal.aborted, true); assert.equal(signalController.signal.reason?.code, "ECANCELLED"); assert.equal(signalLifecycle.exitCode(), 143);
  signalLifecycle.dispose(); assert.equal(processLike.listenerCount("SIGINT"), 0); assert.equal(processLike.listenerCount("SIGTERM"), 0);

  const integrityRoot = path.join(tempRoot, "integrity"); await mkdir(integrityRoot); const miniA = Buffer.from("alpha"); const miniB = Buffer.from("beta"); await writeFile(path.join(integrityRoot, "a.json"), miniA); await writeFile(path.join(integrityRoot, "b.bin"), miniB);
  const miniManifest = { manifestVersion: 1, modelId: policy.modelId, modelRevision: policy.modelRevision, files: [{ path: "a.json", size: miniA.length, sha256: sha256(miniA) }, { path: "b.bin", size: miniB.length, sha256: sha256(miniB) }] };
  const miniManifestPath = path.join(tempRoot, "mini-manifest.json"); const miniManifestBytes = Buffer.from(`${JSON.stringify(miniManifest)}\n`); const miniManifestHash = sha256(JSON.stringify(miniManifest)); await writeFile(miniManifestPath, miniManifestBytes);
  const verifyArgs = [path.join(repoRoot, "scripts/evaluators/siglip2-character-worker.py"), "--verify-snapshot", integrityRoot, miniManifestPath, miniManifestHash];
  const verifiedMini = await runChild(comfyPython, verifyArgs); assert.equal(verifiedMini.code, 0, verifiedMini.stderr); assert.equal(JSON.parse(verifiedMini.stdout).snapshotManifestHash, miniManifestHash);
  await unlink(path.join(integrityRoot, "b.bin")); const missingMini = await runChild(comfyPython, verifyArgs); assert.equal(JSON.parse(missingMini.stdout).errorCode, "EMODEL_REVISION");
  await writeFile(path.join(integrityRoot, "b.bin"), "tampered"); const tamperedMini = await runChild(comfyPython, verifyArgs); assert.equal(JSON.parse(tamperedMini.stdout).errorCode, "EMODEL_INTEGRITY");
  await writeFile(miniManifestPath, `${JSON.stringify({ ...miniManifest, modelRevision: "tampered" })}\n`); const tamperedManifest = await runChild(comfyPython, verifyArgs); assert.equal(JSON.parse(tamperedManifest.stdout).errorCode, "EMODEL_INTEGRITY");

  await evaluator.closeEvaluator();
  assert.equal(worker.closed, 1);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("PASS trusted local SigLIP2 evaluator protocol, scoring, provenance, and fail-closed controls");
