import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const MODULE_PATH = fileURLToPath(import.meta.url);
const MODULE_DIR = path.dirname(MODULE_PATH);
const WORKER_PATH = path.join(MODULE_DIR, "siglip2-character-worker.py");
const POLICY_PATH = path.resolve(MODULE_DIR, "../../examples/character-consistency-benchmark/siglip2-evaluator.example.json");
const DEFAULT_COMFY_PYTHON = "C:\\Users\\Administrator\\AppData\\Local\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI\\ComfyUI\\.venv\\Scripts\\python.exe";
const DIMENSIONS = Object.freeze(["face", "hair", "outfit", "body", "quality"]);
const MODEL_REVISION = "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2";
const POLICY_BYTES = readFileSync(POLICY_PATH);
const DEFAULT_POLICY = Object.freeze(JSON.parse(POLICY_BYTES.toString("utf8")));
const digest = (chunks) => crypto.createHash("sha256").update(Buffer.concat(chunks.map((value) => Buffer.isBuffer(value) ? value : Buffer.from(value)))).digest("hex");
const error = (code, message) => Object.assign(new Error(message), { code });
const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finiteUnit = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const rounded = (value) => Number(value.toFixed(6));

export const evaluatorId = DEFAULT_POLICY.evaluatorId;
export const evaluatorVersion = DEFAULT_POLICY.evaluatorVersion;
export const modelId = DEFAULT_POLICY.modelId;
export const modelRevision = MODEL_REVISION;
export const evaluatorPolicy = DEFAULT_POLICY;
export const evaluatorDimensionThreshold = Math.min(...Object.values(DEFAULT_POLICY.dimensionFloors));
export const evaluatorPolicyHash = digest([POLICY_BYTES, MODEL_REVISION]);
export const evaluatorImplementationHash = digest([readFileSync(MODULE_PATH), readFileSync(WORKER_PATH), POLICY_BYTES, MODEL_REVISION]);
export const requiresLocalOutput = true;

function validatePolicy(policy) {
  if (!plain(policy) || policy.evaluatorId !== evaluatorId || policy.evaluatorVersion !== evaluatorVersion || policy.modelId !== modelId || policy.modelRevision !== modelRevision) throw error("EPOLICY", "SigLIP2 evaluator policy model revision or identity is invalid");
  if (!plain(policy.dimensionFloors) || DIMENSIONS.some((dimension) => !finiteUnit(policy.dimensionFloors[dimension]))) throw error("EPOLICY", "SigLIP2 evaluator dimension floors are invalid");
  if (!plain(policy.weightsByScale)) throw error("EPOLICY", "SigLIP2 evaluator scale weights are invalid");
  for (const scale of ["close", "medium", "full_body"]) {
    const weights = policy.weightsByScale[scale];
    if (!plain(weights) || DIMENSIONS.some((dimension) => !finiteUnit(weights[dimension])) || Math.abs(DIMENSIONS.reduce((sum, dimension) => sum + weights[dimension], 0) - 1) > 1e-9) throw error("EPOLICY", `SigLIP2 evaluator ${scale} weights must be finite and sum to one`);
  }
  return policy;
}

function resolvePython() {
  const configured = process.env.COMFYUI_PYTHON?.trim();
  if (configured) return { command: configured, prefix: [] };
  if (existsSync(DEFAULT_COMFY_PYTHON)) return { command: DEFAULT_COMFY_PYTHON, prefix: [] };
  return process.platform === "win32" ? { command: "py", prefix: ["-3"] } : { command: "python3", prefix: [] };
}

export function createPersistentSiglip2Worker({ spawnImpl = spawn, python = resolvePython(), workerPath = WORKER_PATH } = {}) {
  const command = typeof python === "string" ? python : python.command;
  const prefix = typeof python === "string" ? [] : python.prefix ?? [];
  const child = spawnImpl(command, [...prefix, workerPath], { cwd: path.resolve(MODULE_DIR, "../.."), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child.stderr?.resume?.();
  const pending = new Map();
  let sequence = 0;
  let closed = false;

  const rejectAll = (reason) => {
    for (const request of pending.values()) request.reject(reason);
    pending.clear();
  };
  const terminate = (reason = error("EWORKER_CLOSED", "SigLIP2 worker closed")) => {
    if (closed) return;
    closed = true;
    rejectAll(reason);
    try { child.kill(); } catch { /* process events finalize shutdown */ }
  };
  const protocolFailure = () => {
    const reason = error("EWORKER_PROTOCOL", "malformed NDJSON response from SigLIP2 worker");
    terminate(reason);
  };

  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let response;
    try { response = JSON.parse(line); } catch { protocolFailure(); return; }
    if (!plain(response) || !pending.has(response.id)) { protocolFailure(); return; }
    const request = pending.get(response.id);
    pending.delete(response.id);
    if (response.ok !== true) {
      const code = typeof response.errorCode === "string" && /^E[A-Z0-9_]{1,40}$/.test(response.errorCode) ? response.errorCode : "EWORKER";
      request.reject(error(code, `SigLIP2 worker rejected request (${code})`));
      return;
    }
    request.resolve(response);
  });
  child.once("error", () => terminate(error("EWORKER_START", "SigLIP2 worker could not start")));
  child.once("close", () => terminate(error("EWORKER_CLOSED", "SigLIP2 worker exited")));

  return {
    request(message) {
      if (closed) return Promise.reject(error("EWORKER_CLOSED", "SigLIP2 worker is closed"));
      const id = `siglip2-${process.pid}-${++sequence}`;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ ...message, id })}\n`, (writeError) => {
          if (writeError && pending.delete(id)) reject(error("EWORKER_WRITE", "SigLIP2 worker request failed"));
        });
      });
    },
    async close() {
      lines.close();
      terminate();
    }
  };
}

function normalizedEmbedding(value, expectedLength = null) {
  if (!Array.isArray(value) || value.length < 2 || (expectedLength !== null && value.length !== expectedLength) || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) throw error("EEMBEDDING", "SigLIP2 worker returned an invalid embedding");
  const norm = Math.sqrt(value.reduce((sum, item) => sum + item * item, 0));
  if (!Number.isFinite(norm) || norm < 1e-12) throw error("EEMBEDDING", "SigLIP2 worker returned a zero or non-finite embedding");
  return value.map((item) => item / norm);
}

function similarity(output, reference) {
  const cosine = output.reduce((sum, value, index) => sum + value * reference[index], 0);
  if (!Number.isFinite(cosine)) throw error("EEMBEDDING", "SigLIP2 cosine similarity is non-finite");
  return Math.min(1, Math.max(0, (Math.min(1, Math.max(-1, cosine)) + 1) / 2));
}

function mean(values) {
  if (!values.length) throw error("EREFERENCE", "no routed reference can score this dimension");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function slotsForDimension(entries, dimension) {
  const matches = entries.filter(({ reference }) => {
    const slot = String(reference.requestedSlot ?? reference.slot ?? "");
    if (dimension === "face") return /^(?:face_|expression_)/.test(slot);
    if (dimension === "hair") return /^(?:hair_|face_|expression_)/.test(slot);
    return /^body_/.test(slot);
  });
  return matches.length ? matches : entries;
}

function requestWithDeadline(worker, message, { signal, timeoutMs }) {
  if (signal?.aborted) return Promise.reject(error("ECANCELLED", "SigLIP2 evaluation cancelled"));
  let timer;
  let abort;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(error("ETIMEOUT", "SigLIP2 worker request timed out")), timeoutMs); });
  const cancelled = new Promise((_, reject) => {
    if (!signal) return;
    abort = () => reject(signal.reason?.code ? signal.reason : error("ECANCELLED", "SigLIP2 evaluation cancelled"));
    signal.addEventListener("abort", abort, { once: true });
  });
  return Promise.race([Promise.resolve().then(() => worker.request(message, { signal, timeoutMs })), timeout, cancelled]).finally(() => {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
  });
}

export function createSiglip2Evaluator({ worker = null, workerFactory = createPersistentSiglip2Worker, policy = DEFAULT_POLICY, requestTimeoutMs = 30_000 } = {}) {
  const activePolicy = validatePolicy(policy);
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) throw error("EPOLICY", "SigLIP2 request timeout is invalid");
  let activeWorker = worker;
  let terminated = false;
  const getWorker = () => {
    if (terminated) throw error("EWORKER_CLOSED", "SigLIP2 evaluator is closed");
    activeWorker ??= workerFactory();
    if (!activeWorker || typeof activeWorker.request !== "function" || typeof activeWorker.close !== "function") throw error("EWORKER", "SigLIP2 worker interface is invalid");
    return activeWorker;
  };
  const close = async () => {
    if (terminated) return;
    terminated = true;
    if (activeWorker) await activeWorker.close();
  };
  const failClosed = async (reason) => {
    await close().catch(() => undefined);
    throw reason;
  };

  return {
    async evaluateCharacterShot(context) {
      try {
        if (!plain(context) || typeof context.outputPath !== "string" || !context.outputPath.trim()) throw error("EOUTPUT", "a staged local output path is required");
        if (!Array.isArray(context.references) || !context.references.length) throw error("EREFERENCE", "at least one routed local reference is required");
        if (context.references.some((reference) => !plain(reference) || typeof reference.sourcePath !== "string" || !reference.sourcePath.trim())) throw error("EREFERENCE", "every routed reference requires a local source path");
        if (context.workerModelRevision !== undefined && context.workerModelRevision !== modelRevision) throw error("EMODEL_REVISION", "worker model revision does not match the pinned SigLIP2 revision");
        const shot = context.shot;
        if (!plain(shot) || typeof shot.id !== "string" || !shot.id.trim() || typeof shot.expectedView !== "string" || !shot.expectedView.trim() || !activePolicy.weightsByScale[shot.scale] || !plain(shot.evaluation) || !Array.isArray(shot.evaluation.requiredDimensions) || shot.evaluation.requiredDimensions.some((dimension) => !DIMENSIONS.includes(dimension)) || !finiteUnit(shot.evaluation.minimumScore)) throw error("ECONTEXT", "shot ID, scale, view, and evaluation policy are required");
        const provider = context.providerProof?.providerId;
        if (typeof provider !== "string" || !provider.trim()) throw error("EPROVIDER", "terminal provider proof is required");
        const liveWorker = getWorker();
        const outputResponse = await requestWithDeadline(liveWorker, { type: "embed", path: context.outputPath }, { signal: context.signal, timeoutMs: requestTimeoutMs });
        const verifyResponse = (response) => {
          if (!plain(response) || response.ok !== true) throw error("EWORKER_PROTOCOL", "malformed NDJSON response from SigLIP2 worker");
          if (response.modelId !== modelId || response.modelRevision !== modelRevision) throw error("EMODEL_REVISION", "worker model revision does not match the pinned SigLIP2 revision");
          return response;
        };
        verifyResponse(outputResponse);
        const outputEmbedding = normalizedEmbedding(outputResponse.embedding);
        if (!finiteUnit(outputResponse.quality)) throw error("EQUALITY", "SigLIP2 worker returned an invalid independent quality score");
        const scoredReferences = [];
        for (const reference of context.references) {
          const response = verifyResponse(await requestWithDeadline(liveWorker, { type: "embed", path: reference.sourcePath }, { signal: context.signal, timeoutMs: requestTimeoutMs }));
          const embedding = normalizedEmbedding(response.embedding, outputEmbedding.length);
          scoredReferences.push({ reference, score: similarity(outputEmbedding, embedding) });
        }
        const dimensionScores = {
          face: rounded(mean(slotsForDimension(scoredReferences, "face").map(({ score }) => score))),
          hair: rounded(mean(slotsForDimension(scoredReferences, "hair").map(({ score }) => score))),
          outfit: rounded(mean(slotsForDimension(scoredReferences, "outfit").map(({ score }) => score))),
          body: rounded(mean(slotsForDimension(scoredReferences, "body").map(({ score }) => score))),
          quality: rounded(outputResponse.quality)
        };
        const weights = activePolicy.weightsByScale[shot.scale];
        const score = rounded(DIMENSIONS.reduce((sum, dimension) => sum + dimensionScores[dimension] * weights[dimension], 0));
        const failureDimensions = shot.evaluation.requiredDimensions.filter((dimension) => dimensionScores[dimension] < activePolicy.dimensionFloors[dimension]);
        if (score < shot.evaluation.minimumScore && !failureDimensions.length) failureDimensions.push("score");
        return {
          status: failureDimensions.length ? "needs_review" : "accepted",
          provenance: "model_generation",
          actualProvider: provider,
          score,
          dimensionScores,
          failureDimensions,
          failureReason: failureDimensions.length ? "one or more evaluator thresholds were not met" : null,
          references: typeof context.output === "string" ? [context.output] : [],
          bestPreview: typeof context.output === "string" ? context.output : null,
          retries: 0,
          evaluatorId,
          evaluatorVersion,
          evaluatorPolicyHash,
          evaluatorImplementationHash,
          modelId,
          modelRevision
        };
      } catch (reason) {
        return failClosed(reason?.code ? reason : error("EEVALUATOR", String(reason?.message ?? reason)));
      }
    },
    closeEvaluator: close
  };
}

const productionEvaluator = createSiglip2Evaluator();
export const evaluateCharacterShot = productionEvaluator.evaluateCharacterShot;
export const closeEvaluator = productionEvaluator.closeEvaluator;
