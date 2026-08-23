import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendCandidate, assertRunInvariant, sha256File, writeJsonAtomic } from "./layered-compositing-run.mjs";
import { assertLayout, createRiverLayout } from "./layered-compositing-layout.mjs";

const EMPTY_PRESET = new URL("../../src/modules/comfy-pipeline/presets/layered-empty-plate-qwen-v1.json", import.meta.url);
const CHARACTER_PRESET = new URL("../../src/modules/comfy-pipeline/presets/layered-character-qwen-v1.json", import.meta.url);
const EMPTY_OUTPUT_NODE = "20";
const CHARACTER_OUTPUT_NODE = "30";
const CANDIDATES = new Set([1, 2, 3]);
const CHARACTER_SEEDS = Object.freeze({
  shen_yan: Object.freeze([73112001, 73112002, 73112003]),
  jiang_lan: Object.freeze([82423001, 82423002, 82423003]),
});
const EMPTY_SEEDS = Object.freeze([61034001, 61034002, 61034003]);
const MODEL_INPUT_NAMES = new Set(["ckpt_name", "unet_name", "clip_name", "vae_name", "lora_name"]);
const PRIMITIVE_TYPES = new Set(["STRING", "INT", "FLOAT", "NUMBER", "BOOLEAN"]);

function fail(message) { throw new Error(`Layered compositing Comfy invariant: ${message}`); }
function isLink(value) { return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && Number.isInteger(value[1]); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function replaceTokens(value, tokens) {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{([A-Z0-9_]+)\}\}$/);
    if (exact && Object.hasOwn(tokens, exact[1])) return structuredClone(tokens[exact[1]]);
    let next = value;
    for (const [name, replacement] of Object.entries(tokens)) next = next.split(`{{${name}}}`).join(String(replacement));
    return next;
  }
  if (Array.isArray(value)) return value.map((item) => replaceTokens(item, tokens));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTokens(item, tokens)]));
  return value;
}

export function compileWorkflow(preset, tokens = {}) {
  if (!preset || typeof preset !== "object" || Array.isArray(preset)) fail("preset must be a workflow object");
  const inventory = [...new Set([...JSON.stringify(preset).matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1]))].sort();
  const supplied = Object.keys(tokens).sort();
  if (JSON.stringify(inventory) !== JSON.stringify(supplied)) fail(`unresolved token inventory mismatch: expected ${inventory.join(", ")}; received ${supplied.join(", ")}`);
  const workflow = replaceTokens(preset, tokens);
  const unresolved = JSON.stringify(workflow).match(/\{\{[^{}]*\}\}/g);
  if (unresolved) fail(`unresolved tokens: ${[...new Set(unresolved)].join(", ")}`);
  return workflow;
}

function definitionsFor(nodeInfo) {
  return { ...(nodeInfo?.input?.required ?? {}), ...(nodeInfo?.input?.optional ?? {}) };
}

function literalTypeMatches(type, value) {
  if (type === "STRING") return typeof value === "string";
  if (type === "INT") return Number.isSafeInteger(value);
  if (type === "FLOAT" || type === "NUMBER") return typeof value === "number" && Number.isFinite(value);
  if (type === "BOOLEAN") return typeof value === "boolean";
  return value !== undefined;
}

function assertComboMetadata(nodeId, inputName, specification) {
  if (specification?.[0] !== "COMBO") return null;
  const options = specification?.[1]?.options;
  if (typeof specification?.[1]?.multiselect !== "boolean") fail(`${nodeId}.${inputName} COMBO must declare boolean multiselect metadata`);
  if (!Array.isArray(options) || options.length === 0) fail(`${nodeId}.${inputName} COMBO must declare a nonempty options enum`);
  return { options, multiselect: specification[1].multiselect };
}

function assertLiteral(nodeId, classType, inputName, value, specification, comboMetadata) {
  const declared = specification?.[0];
  if (declared === "COMBO") {
    const { options, multiselect } = comboMetadata;
    const values = multiselect ? value : [value];
    if (multiselect && !Array.isArray(value)) fail(`${nodeId}.${inputName} multiselect COMBO literal must be an array`);
    if (!multiselect && typeof value !== "string") fail(`${nodeId}.${inputName} single-select COMBO literal must be a string`);
    if (!values.every((item) => typeof item === "string" && options.includes(item))) fail(`${nodeId}.${inputName} literal COMBO option is invalid`);
    return;
  }
  if (Array.isArray(declared)) {
    if (classType === "LoadImage" && inputName === "image" && specification?.[1]?.image_upload === true) {
      if (typeof value !== "string" || !value) fail(`${nodeId}.${inputName} upload path must be a string`);
      return;
    }
    if (!declared.includes(value)) fail(`${nodeId}.${inputName} literal enum is invalid`);
    return;
  }
  if (!literalTypeMatches(declared, value)) fail(`${nodeId}.${inputName} literal type must be ${declared}`);
  const constraints = specification?.[1];
  if (typeof value === "number" && constraints) {
    if (Number.isFinite(constraints.min) && value < constraints.min) fail(`${nodeId}.${inputName} is below its minimum`);
    if (Number.isFinite(constraints.max) && value > constraints.max) fail(`${nodeId}.${inputName} is above its maximum`);
  }
}

export function assertWorkflowObjectInfo(workflow, objectInfo) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) fail("workflow must be an object");
  if (!objectInfo || typeof objectInfo !== "object") fail("object_info must be an object");
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!node || typeof node !== "object" || typeof node.class_type !== "string" || !node.inputs || typeof node.inputs !== "object") fail(`node ${nodeId} is malformed`);
    const nodeInfo = objectInfo[node.class_type];
    if (!nodeInfo) fail(`object_info is missing class ${node.class_type}`);
    const definitions = definitionsFor(nodeInfo);
    for (const requiredName of Object.keys(nodeInfo.input?.required ?? {})) {
      if (!Object.hasOwn(node.inputs, requiredName)) fail(`${nodeId} is missing required input ${requiredName}`);
    }
    for (const [inputName, value] of Object.entries(node.inputs)) {
      const specification = definitions[inputName];
      if (!specification) fail(`${nodeId}.${inputName} is not a declared input`);
      const comboMetadata = assertComboMetadata(nodeId, inputName, specification);
      if (isLink(value)) {
        const source = workflow[value[0]];
        if (!source) fail(`${nodeId}.${inputName} source does not resolve`);
        const outputs = objectInfo[source.class_type]?.output;
        if (!Array.isArray(outputs) || typeof outputs[value[1]] !== "string") fail(`${nodeId}.${inputName} output index does not resolve`);
        const expected = specification[0];
        if (typeof expected === "string" && outputs[value[1]] !== expected) fail(`${nodeId}.${inputName} link type mismatch: expected ${expected}, got ${outputs[value[1]]}`);
      } else {
        if (typeof specification[0] === "string" && !PRIMITIVE_TYPES.has(specification[0]) && specification[0] !== "COMBO") fail(`${nodeId}.${inputName} nonprimitive connection type requires a valid link`);
        assertLiteral(nodeId, node.class_type, inputName, value, specification, comboMetadata);
        if (MODEL_INPUT_NAMES.has(inputName) && !Array.isArray(specification[0]) && specification[0] !== "COMBO") fail(`${nodeId}.${inputName} model selection is not enumerated by object_info`);
      }
    }
  }
  return true;
}

async function checkedResponse(response, label) {
  if (!response?.ok) fail(`${label} failed ${response?.status ?? "without status"}: ${await response?.text?.()}`);
  return response;
}

function uploadedName(payload, role) {
  const name = String(payload?.name ?? "").trim();
  const subfolder = String(payload?.subfolder ?? "").trim().replaceAll("\\", "/");
  if (!safeSegment(name) || !safeSubfolder(subfolder) || payload?.type !== "input") fail(`upload returned unsafe descriptor for ${role}`);
  return subfolder ? `${subfolder}/${name}` : name;
}

function safeSegment(value) { return typeof value === "string" && value.length > 0 && !path.isAbsolute(value) && !value.includes("/") && !value.includes("\\") && !value.includes(":") && value !== "." && value !== ".."; }
function safeSubfolder(value) { return typeof value === "string" && !path.isAbsolute(value) && !value.includes("\\") && value.split("/").every((part) => part && part !== "." && part !== ".." && !part.includes(":")); }

function run(command, args, encoding = "utf8") {
  const result = spawnSync(command, args, { encoding, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${command} decode failed: ${String(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

function probeImage(filePath, expectedGeometry) {
  if (!existsSync(filePath) || !statSync(filePath).isFile() || statSync(filePath).size <= 0) fail(`image is missing or empty: ${filePath}`);
  const stream = JSON.parse(run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "json", filePath]))?.streams?.[0];
  if (stream?.codec_type !== "video" || stream.codec_name !== "png" || !Number.isInteger(stream.width) || !Number.isInteger(stream.height) || stream.width <= 0 || stream.height <= 0) fail(`image codec must be real-decodable png: ${filePath}`);
  if (expectedGeometry && (stream.width !== expectedGeometry.width || stream.height !== expectedGeometry.height)) fail(`image geometry must be ${expectedGeometry.width}x${expectedGeometry.height}, got ${stream.width}x${stream.height}`);
  run("ffmpeg", ["-v", "error", "-i", filePath, "-frames:v", "1", "-f", "null", "-"]);
  return stream;
}

function rawPixels(filePath, pixelFormat) {
  return run("ffmpeg", ["-v", "error", "-i", filePath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", pixelFormat, "pipe:1"], null);
}

function assertMaskedCompositePixels(sourcePath, fillPath, maskPath, outputPath) {
  const source = rawPixels(sourcePath, "rgb24"); const fill = rawPixels(fillPath, "rgb24");
  const mask = rawPixels(maskPath, "gray"); const output = rawPixels(outputPath, "rgb24");
  if (source.length !== output.length || fill.length !== output.length || mask.length * 3 !== output.length) fail("masked composite raw pixel lengths do not match");
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 3;
    if (mask[pixel] === 0 && (output[offset] !== source[offset] || output[offset + 1] !== source[offset + 1] || output[offset + 2] !== source[offset + 2])) fail(`masked composite changed outside-mask RGB at pixel ${pixel}`);
    if (mask[pixel] === 255 && (output[offset] !== fill[offset] || output[offset + 1] !== fill[offset + 1] || output[offset + 2] !== fill[offset + 2])) fail(`masked composite did not transfer inside-mask RGB at pixel ${pixel}`);
  }
}

function publishNoReplace(temporary, destination) {
  if (existsSync(destination)) fail(`destination exists; refusing to overwrite: ${destination}`);
  try { linkSync(temporary, destination); }
  catch (error) { if (error?.code === "EEXIST") fail(`destination exists; refusing to overwrite: ${destination}`); throw error; }
  unlinkSync(temporary);
}

function assertPngGeometry(bytes, expected) {
  const signature = "89504e470d0a1a0a";
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== signature || bytes.subarray(12, 16).toString("ascii") !== "IHDR") fail("configured output file is not a PNG");
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  if (width !== expected.width || height !== expected.height) fail(`output geometry must be ${expected.width}x${expected.height}, got ${width}x${height}`);
}

function assertPngFileGeometry(filePath, expected, label) {
  const bytes = readFileSync(filePath).subarray(0, 24);
  try { assertPngGeometry(bytes, expected); }
  catch (error) { fail(`${label} ${error.message.replace(/^Layered compositing Comfy invariant:\s*/, "")}`); }
}

export function compositeEmptyPlate({ sourcePath, fillPath, maskPath, outputPath }) {
  const geometry = { width: 1152, height: 640 };
  probeImage(sourcePath, geometry); probeImage(fillPath, geometry); probeImage(maskPath, geometry);
  if (existsSync(outputPath)) fail(`destination exists; refusing to overwrite: ${outputPath}`);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporary = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${process.pid}.${randomUUID()}.png`);
  try {
    run("ffmpeg", ["-y", "-v", "error", "-i", sourcePath, "-i", fillPath, "-i", maskPath, "-filter_complex", "[1:v]format=rgb24[fill];[2:v]format=gray[mask];[fill][mask]alphamerge[fg];[0:v][fg]overlay=0:0:format=rgb,format=rgb24[out]", "-map", "[out]", "-frames:v", "1", temporary]);
    probeImage(temporary, geometry);
    assertMaskedCompositePixels(sourcePath, fillPath, maskPath, temporary);
    publishNoReplace(temporary, outputPath);
  } finally { rmSync(temporary, { force: true }); }
  return outputPath;
}

export function createComfyAdapter({ baseUrl, fetchImpl = fetch, now = Date.now, wait = sleep } = {}) {
  if (typeof baseUrl !== "string" || !/^https?:\/\//i.test(baseUrl)) fail("baseUrl must be an HTTP URL");
  if (typeof fetchImpl !== "function" || typeof now !== "function" || typeof wait !== "function") fail("adapter dependencies are invalid");
  const endpoint = baseUrl.replace(/\/+$/, "");
  return {
    async objectInfo() {
      const response = await checkedResponse(await fetchImpl(`${endpoint}/object_info`), "object_info");
      return response.json();
    },
    async uploadImage({ filePath, role, subfolder = "layered-compositing" }) {
      if (!existsSync(filePath) || !statSync(filePath).isFile() || statSync(filePath).size <= 0) fail(`${role} upload source is missing or empty`);
      const form = new FormData();
      form.append("image", new Blob([readFileSync(filePath)], { type: "image/png" }), `${role}.png`);
      form.append("type", "input");
      form.append("subfolder", subfolder);
      form.append("overwrite", "false");
      const response = await checkedResponse(await fetchImpl(`${endpoint}/upload/image`, { method: "POST", body: form }), `upload ${role}`);
      const uploaded = await response.json();
      const normalized = uploadedName(uploaded, role);
      if (String(uploaded.subfolder).replaceAll("\\", "/") !== subfolder) fail(`upload returned unexpected subfolder for ${role}`);
      return normalized;
    },
    async queue(workflow, { onQueued, clientId = `layered-${randomUUID()}` } = {}) {
      const response = await checkedResponse(await fetchImpl(`${endpoint}/prompt`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      }), "prompt queue");
      const promptId = String((await response.json())?.prompt_id ?? "").trim();
      if (!promptId) fail("prompt queue returned no prompt_id");
      if (onQueued) {
        try { await onQueued({ promptId, queuedAt: now() }); }
        catch (error) { error.promptId = promptId; throw error; }
      }
      return { promptId, queuedAt: now() };
    },
    async capture({ promptId, outputNodeId, filenamePrefix, expectedSubfolder, destination, expectedGeometry, expectedWorkflow, timeoutMs = 20 * 60 * 1000, pollIntervalMs = 2000 }) {
      if (existsSync(destination)) fail(`destination exists; refusing to overwrite: ${destination}`);
      const deadline = now() + timeoutMs;
      while (now() <= deadline) {
        const response = await checkedResponse(await fetchImpl(`${endpoint}/history/${encodeURIComponent(promptId)}`), "prompt history");
        const item = (await response.json())?.[promptId];
        if (item) {
          if (expectedWorkflow !== undefined && (item.status?.completed !== true || item.status?.status_str !== "success" || JSON.stringify(item.prompt?.[2]) !== JSON.stringify(expectedWorkflow))) fail("history prompt/workflow is not the exact successful queued graph");
          const imageOutputs = Object.entries(item.outputs ?? {}).filter(([, output]) => Array.isArray(output?.images) && output.images.length > 0);
          if (imageOutputs.length > 0) {
            if (imageOutputs.length !== 1 || imageOutputs[0][0] !== String(outputNodeId)) fail("history returned image files from an unconfigured output node");
            const images = imageOutputs[0][1].images;
            if (images.length !== 1) fail("configured output node must return exactly one file");
            const descriptor = images[0];
            const filename = String(descriptor?.filename ?? "");
            const subfolder = String(descriptor?.subfolder ?? "").replaceAll("\\", "/");
            if (!safeSegment(filename) || path.extname(filename).toLowerCase() !== ".png" || (filenamePrefix && !filename.startsWith(filenamePrefix))) fail("configured output filename descriptor is unsafe or has the wrong prefix");
            if (!safeSubfolder(subfolder) || (expectedSubfolder !== undefined && subfolder !== expectedSubfolder)) fail("configured output subfolder descriptor is unsafe or unexpected");
            if (descriptor.type !== "output") fail("configured output file type must be output");
            const query = new URLSearchParams({ filename, subfolder: descriptor.subfolder ?? "", type: descriptor.type ?? "output" });
            const view = await checkedResponse(await fetchImpl(`${endpoint}/view?${query}`), "output view");
            const bytes = Buffer.from(await view.arrayBuffer());
            if (bytes.length === 0) fail("output view returned an empty file");
            mkdirSync(path.dirname(destination), { recursive: true });
            const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${process.pid}.${randomUUID()}.png`);
            try {
              writeFileSync(temporary, bytes, { flag: "wx" });
              probeImage(temporary, expectedGeometry);
              publishNoReplace(temporary, destination);
            } finally {
              rmSync(temporary, { force: true });
            }
            return { promptId, descriptor: structuredClone(descriptor), destination };
          }
          const status = String(item.status?.status_str ?? "").toLowerCase();
          if (item.status?.completed || ["success", "failed", "error"].includes(status)) fail("prompt completed without the configured output file");
        }
        await wait(pollIntervalMs);
      }
      fail(`prompt timed out: ${promptId}`);
    },
  };
}

function readReport(reportPath) {
  let report;
  try { report = JSON.parse(readFileSync(reportPath, "utf8")); }
  catch { fail(`report is missing or malformed: ${reportPath}`); }
  assertRunInvariant(report);
  return report;
}

function assertCandidate(candidate) {
  if (!CANDIDATES.has(candidate)) fail("candidate must be 1, 2, or 3");
}

function assertResource(resource, label) {
  if (!resource?.path || !existsSync(resource.path) || !statSync(resource.path).isFile() || statSync(resource.path).size <= 0) fail(`${label} is missing or empty`);
  if (statSync(resource.path).size !== resource.size || sha256File(resource.path) !== resource.sha256) fail(`${label} does not match the frozen report resource`);
  probeImage(resource.path);
}

function candidatePaths(reportPath, stage, candidate, filename) {
  const id = `candidate_${String(candidate).padStart(3, "0")}`;
  const stageRoot = path.resolve(path.dirname(reportPath), stage);
  const directory = path.join(stageRoot, id);
  const lockPath = path.join(stageRoot, `.${id}.lock`);
  const queuedMarkerPath = path.join(stageRoot, `.${id}.queued`);
  const attemptId = `${Date.now()}-${process.pid}-${randomUUID()}`;
  const attemptDirectory = path.join(stageRoot, "attempts", id, attemptId);
  return { id, stageRoot, directory, artifactPath: path.join(directory, filename), lockPath, queuedMarkerPath, attemptDirectory, journalPath: path.join(attemptDirectory, "attempt.json") };
}

function loadPreset(url) { return JSON.parse(readFileSync(url, "utf8")); }
function artifact(filePath) { const stats = statSync(filePath); return { path: path.resolve(filePath), size: stats.size, sha256: sha256File(filePath) }; }
function hashBuffer(buffer) { return createHash("sha256").update(buffer).digest("hex"); }

function modelSelections(workflow) {
  const selected = { unet: null, clip: null, vae: null, lora: null };
  for (const node of Object.values(workflow)) {
    if (node.class_type === "UNETLoader") selected.unet = node.inputs.unet_name;
    if (node.class_type === "CLIPLoader") selected.clip = node.inputs.clip_name;
    if (node.class_type === "VAELoader") selected.vae = node.inputs.vae_name;
    if (/LoraLoader/.test(node.class_type)) selected.lora = node.inputs.lora_name ?? null;
  }
  return selected;
}

function writeAttempt(paths, value) { mkdirSync(paths.attemptDirectory, { recursive: true }); writeJsonAtomic(paths.journalPath, value); }

function writeJsonExclusive(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const descriptor = openSync(filePath, "wx", 0o600);
  try { writeFileSync(descriptor, `${JSON.stringify(value)}\n`, "utf8"); }
  finally { closeSync(descriptor); }
}

function acquireExclusive(filePath, label) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  try { return openSync(filePath, "wx", 0o600); }
  catch (error) { if (error?.code === "EEXIST") fail(`${label} is already reserved`); throw error; }
}

async function acquireRunLock(reportPath, { wait = sleep, timeoutMs = 5000, pollMs = 10 } = {}) {
  const lockPath = `${reportPath}.generation.lock`;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try { return { descriptor: openSync(lockPath, "wx", 0o600), lockPath }; }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) fail("run-wide generation lock timed out before queue");
      await wait(pollMs);
    }
  }
}

function appendReportLocked(reportPath, stage, record) {
  const lockPath = `${reportPath}.lock`;
  const descriptor = acquireExclusive(lockPath, "run report");
  try {
    const latest = readReport(reportPath);
    const next = appendCandidate(latest, stage, record);
    writeJsonAtomic(reportPath, next);
    return next;
  } finally { closeSync(descriptor); rmSync(lockPath, { force: true }); }
}

function maskCoverage(maskPath) {
  const pixels = rawPixels(maskPath, "gray");
  let selected = 0;
  for (const value of pixels) if (value > 127) selected += 1;
  return selected / pixels.length;
}

function freezeRemovalMask(reportPath, removalMaskPath) {
  const manifestPath = path.join(path.dirname(reportPath), "layered-removal-mask.json");
  const lockPath = `${manifestPath}.lock`;
  const descriptor = acquireExclusive(lockPath, "removal mask manifest");
  try {
    const coverage = maskCoverage(removalMaskPath);
    if (coverage < 0.01 || coverage > 0.25) fail(`removal mask coverage must be between 0.01 and 0.25, got ${coverage}`);
    const expected = { path: path.resolve(removalMaskPath), sha256: sha256File(removalMaskPath), width: 1152, height: 640, coverage };
    if (existsSync(manifestPath)) {
      const frozen = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (frozen.path !== expected.path || frozen.sha256 !== expected.sha256 || frozen.width !== expected.width || frozen.height !== expected.height || frozen.coverage !== expected.coverage) fail("frozen removal mask hash/path/geometry/coverage mismatch");
      return frozen;
    }
    writeJsonAtomic(manifestPath, expected);
    return expected;
  } finally { closeSync(descriptor); rmSync(lockPath, { force: true }); }
}

async function executeGeneration({ reportPath, report, stage, candidate, preset, presetSha256, tokens, uploads, outputNodeId, outputFilename, adapter, metadata, finalize, afterQueuedMarker }) {
  const paths = candidatePaths(reportPath, stage, candidate, outputFilename);
  const reservation = acquireExclusive(paths.lockPath, `${stage} ${paths.id}`);
  let runLock;
  let queued = null;
  let attempt = { attemptId: path.basename(paths.attemptDirectory), stage, candidateId: paths.id, status: "reserved", createdAt: Date.now() };
  writeAttempt(paths, attempt);
  try {
    if (existsSync(paths.queuedMarkerPath) || existsSync(paths.directory) || report.stages[stage].candidates.some((item) => item.id === paths.id)) fail(`${stage} ${paths.id} queued candidate ID is not reusable`);
    const objectInfo = await adapter.objectInfo();
    const placeholderUploads = Object.fromEntries(uploads.map(([token]) => [token, `${token.toLowerCase()}.png`]));
    const filenamePrefix = `${stage}/${paths.id}/${path.parse(outputFilename).name}`;
    assertWorkflowObjectInfo(compileWorkflow(preset, { ...tokens, ...placeholderUploads, FILENAME_PREFIX: filenamePrefix }), objectInfo);
    runLock = await acquireRunLock(reportPath);
    const uploaded = {};
    for (const [token, resource, role] of uploads) uploaded[token] = await adapter.uploadImage({ filePath: resource.path, role, subfolder: `layered-compositing/${stage}/${paths.id}` });
    const workflow = compileWorkflow(preset, { ...tokens, ...uploaded, FILENAME_PREFIX: filenamePrefix });
    const workflowBytes = Buffer.from(`${JSON.stringify(workflow)}\n`);
    queued = await adapter.queue(workflow, { onQueued: ({ promptId, queuedAt }) => {
      writeJsonExclusive(paths.queuedMarkerPath, { promptId, queuedAt });
      afterQueuedMarker?.({ promptId, queuedAt, markerPath: paths.queuedMarkerPath });
      attempt = { ...attempt, status: "queued", promptId, queuedAt, presetSha256, workflowSha256: hashBuffer(workflowBytes) };
      writeAttempt(paths, attempt);
    } });
    const rawPath = path.join(paths.attemptDirectory, "comfy-output.png");
    await adapter.capture({ promptId: queued.promptId, outputNodeId, filenamePrefix: path.parse(outputFilename).name, expectedSubfolder: `${stage}/${paths.id}`, destination: rawPath, expectedGeometry: { width: 1152, height: 640 } });
    mkdirSync(paths.directory, { recursive: false });
    let comfyOutput;
    if (finalize) { comfyOutput = artifact(rawPath); finalize({ rawPath, outputPath: paths.artifactPath }); }
    else { publishNoReplace(rawPath, paths.artifactPath); comfyOutput = artifact(paths.artifactPath); }
    probeImage(paths.artifactPath, { width: 1152, height: 640 });
    const record = { id: paths.id, artifact: artifact(paths.artifactPath), comfyOutput, promptId: queued.promptId, seed: tokens.SEED, workflowVersion: 1, presetSha256: attempt.presetSha256, workflowSha256: attempt.workflowSha256, models: modelSelections(workflow), ...metadata };
    const next = appendReportLocked(reportPath, stage, record);
    attempt = { ...attempt, status: "completed", artifact: record.artifact };
    writeAttempt(paths, attempt);
    return { candidate: next.stages[stage].candidates.at(-1), report: next, reportPath: path.resolve(reportPath) };
  } catch (error) {
    if (!queued && error?.promptId) {
      queued = { promptId: error.promptId };
      if (!existsSync(paths.queuedMarkerPath)) writeJsonExclusive(paths.queuedMarkerPath, { promptId: error.promptId, queuedAt: Date.now() });
    }
    attempt = { ...attempt, status: queued ? "failed-postqueue" : "failed-prequeue", error: error.message };
    writeAttempt(paths, attempt);
    throw error;
  } finally {
    if (runLock) { closeSync(runLock.descriptor); rmSync(runLock.lockPath, { force: true }); }
    closeSync(reservation); rmSync(paths.lockPath, { force: true });
  }
}

export async function generateEmptyPlate(args = {}) {
  const reportPath = path.resolve(args.reportPath ?? "");
  const candidate = Number(args.candidate);
  assertCandidate(candidate);
  const report = readReport(reportPath);
  assertResource(report.source, "mother frame");
  probeImage(report.source.path, { width: 1152, height: 640 });
  const removalMask = { path: path.resolve(args.removalMaskPath ?? "") };
  if (!existsSync(removalMask.path) || !statSync(removalMask.path).isFile() || statSync(removalMask.path).size <= 0) fail("fixed two-person removal mask is missing or empty");
  probeImage(removalMask.path, { width: 1152, height: 640 });
  const removalMaskManifest = freezeRemovalMask(reportPath, removalMask.path);
  const adapter = args.adapter ?? createComfyAdapter({ baseUrl: args.baseUrl ?? process.env.COMFYUI_URL ?? "http://127.0.0.1:8188" });
  const preset = loadPreset(EMPTY_PRESET);
  return executeGeneration({
    reportPath, report, stage: "empty_plate", candidate, adapter, preset, presetSha256: sha256File(fileURLToPath(EMPTY_PRESET)), outputNodeId: EMPTY_OUTPUT_NODE, outputFilename: "empty_plate.png",
    uploads: [["SOURCE_IMAGE", report.source, "mother_frame"], ["REMOVAL_MASK", removalMask, "two_person_removal_mask"]],
    tokens: { SEED: EMPTY_SEEDS[candidate - 1] },
    metadata: { removalMask: { ...artifact(removalMask.path), ...removalMaskManifest, role: "fixed-two-person-removal-mask" }, references: { source: { ...structuredClone(report.source), role: "immutable-mother-frame" }, removalMask: { ...artifact(removalMask.path), role: "fixed-two-person-removal-mask" } }, prompt: preset["14"].inputs.prompt, negativeConstraints: "No change outside the fixed removal mask; no people; no camera, geometry, lighting, palette, or canvas change." },
    finalize: ({ rawPath, outputPath }) => compositeEmptyPlate({ sourcePath: report.source.path, fillPath: rawPath, maskPath: removalMask.path, outputPath }), afterQueuedMarker: args.afterQueuedMarker,
  });
}

function characterPrompt(character, contract, lighting) {
  const costume = character === "shen_yan"
    ? "Shen Yan, exact approved face and hairstyle, dark-blue costume construction and key accessories"
    : "Jiang Lan, exact approved face, long dark hair, light gray-blue dress construction and key accessories";
  return `Picture 1 is the sole face identity authority; use no other face. Picture 2 controls body proportions, primary costume construction, materials, colors, and accessories only, never face identity. Picture 3 controls front-view hairstyle and costume structure only, never face identity. Generate exactly one human: ${costume}. Full body including both feet, entirely visible. Neutral removable background. Inward gaze toward screen-${contract.screenSide === "left" ? "right" : "left"}, with target ${contract.gazeTarget.x.toFixed(3)},${contract.gazeTarget.y.toFixed(3)}. Preserve the fixed single-person layout: target height ${contract.pixelHeight.toFixed(3)}px, allowed source bounds x=${contract.allowedBounds.x}, y=${contract.allowedBounds.y}, width=${contract.allowedBounds.width}, height=${contract.allowedBounds.height}. Match mother-frame lighting: ${lighting.key}; ${lighting.fill}; shadow toward ${lighting.shadow}. No other person, no duplicate, no cropped head or feet, no beast traits, animal ears, horns, tail, fur, claws, or non-human anatomy.`;
}

export async function generateCharacter(args = {}) {
  const reportPath = path.resolve(args.reportPath ?? "");
  const character = args.character;
  if (!Object.hasOwn(CHARACTER_SEEDS, character)) fail("character must be shen_yan or jiang_lan");
  const candidate = Number(args.candidate);
  assertCandidate(candidate);
  const report = readReport(reportPath);
  assertResource(report.source, "mother frame");
  probeImage(report.source.path, { width: 1152, height: 640 });
  const layout = args.layout ?? createRiverLayout();
  assertLayout(layout);
  const resources = report.characters[character];
  for (const [field, label] of [["faceMaster", "face master"], ["bodyFront", "body front"], ["structureFront", "structure front"]]) assertResource(resources[field], `${character} ${label}`);
  const prompt = characterPrompt(character, layout.people[character], report.lighting);
  const adapter = args.adapter ?? createComfyAdapter({ baseUrl: args.baseUrl ?? process.env.COMFYUI_URL ?? "http://127.0.0.1:8188" });
  const preset = loadPreset(CHARACTER_PRESET);
  return executeGeneration({
    reportPath, report, stage: character, candidate, adapter, preset, presetSha256: sha256File(fileURLToPath(CHARACTER_PRESET)), outputNodeId: CHARACTER_OUTPUT_NODE, outputFilename: `${character}.png`,
    uploads: [["FACE_MASTER", resources.faceMaster, `${character}_face`], ["BODY_FRONT", resources.bodyFront, `${character}_body_front`], ["STRUCTURE_FRONT", resources.structureFront, `${character}_structure_front`]],
    tokens: { PROMPT: prompt, SEED: CHARACTER_SEEDS[character][candidate - 1] },
    metadata: { character, prompt, negativeConstraints: "No other person, duplicate, cropped head or feet, beast traits, animal ears, horns, tail, fur, claws, or non-human anatomy.", layout: structuredClone(layout.people[character]), references: { faceMaster: { ...structuredClone(resources.faceMaster), role: "sole-face-authority" }, bodyFront: { ...structuredClone(resources.bodyFront), role: "body-costume-only" }, structureFront: { ...structuredClone(resources.structureFront), role: "front-structure-only" } } },
  });
}
