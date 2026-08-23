import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  assertWorkflowObjectInfo,
  compileWorkflow,
  createComfyAdapter,
} from "./layered-compositing-comfy.mjs";
import {
  acquireReportMutationLock,
  releaseReportMutationLock,
} from "./layered-compositing-compose.mjs";
import {
  assertOutsideEditableIdentity,
  assertSurfaceMaskManifest,
} from "./surface-empty-plate-v2-masks.mjs";
import {
  SURFACE_SEEDS,
  appendSurfaceCandidate,
  assertSurfaceRun,
  sha256File,
  writeSurfaceReportAtomic,
} from "./surface-empty-plate-v2-run.mjs";

const PRESET_URL = new URL("../../src/modules/comfy-pipeline/presets/surface-empty-plate-qwen-v2.json", import.meta.url);
const PRESET_PATH = fileURLToPath(PRESET_URL);
const OUTPUT_NODE_ID = "20";
const RECONSTRUCTION_STAGES = Object.freeze(["upper_background", "middle_background", "lower_background"]);
const CANDIDATE_LEXEMES = new Set(["1", "2"]);
const ATTEMPT_ID = /^\d{13}-[1-9]\d*-[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HEX_SHA256 = /^[a-f0-9]{64}$/i;
const CANVAS = Object.freeze({ width: 1152, height: 640 });
const EVICTED_ATTESTATION_FILENAME = "evicted-capture-attestation.json";
const EVICTED_ATTESTATION_KIND = "surface-evicted-capture-attestation";
const EVICTED_ATTESTATION_VERSION = "surface-evicted-capture-attestation-v1";
const APPROVED_MODELS = Object.freeze({
  unet: "qwen_image_edit_2511_fp8mixed.safetensors",
  lora: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
  clip: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
  vae: "qwen_image_vae.safetensors",
});

export const STAGE_PROMPTS = Object.freeze({
  upper_background: "Reconstruct only continuous sunset sky, atmospheric haze, and the existing tree line. Preserve the same camera and light direction. The image contains no people, silhouettes, statues, signs, plates, rings, blocks, or new objects.",
  middle_background: "Reconstruct only the continuous river, far bank, shore geometry, reflections, haze, and existing foliage. Preserve camera, palette, and water direction. The image contains no people, vertical seams, columns, floating objects, circular objects, or duplicated vegetation.",
  lower_background: "Reconstruct only perspective-correct stone road, continuous stone joints, matching wear, grass boundary, and environment-only shadows. The image contains no people, human shadows, feet marks, body contours, plates, rings, blocks, or inserted props.",
});

export const STAGE_NEGATIVE_PROMPT = "Do not alter protected pixels, accepted predecessor surfaces, camera geometry, canvas, lighting direction, or palette. No people, human remnants, seams, plates, rings, blocks, props, text, or new objects.";

function fail(message) { throw new Error(`Surface empty plate V2 Comfy invariant: ${message}`); }
function clone(value) { return structuredClone(value); }
function hashBytes(value) { return createHash("sha256").update(value).digest("hex"); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== keys.slice().sort().join(",")) fail(`${label} schema is noncanonical`);
  return value;
}

function safeTimestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} timestamp is noncanonical`);
  return value;
}

function safeComfyEndpoint(value) { let parsed; try { parsed = new URL(value); } catch { fail("Comfy endpoint is invalid"); } if (!/^https?:$/.test(parsed.protocol)) fail("Comfy endpoint must use HTTP(S)"); parsed.username = ""; parsed.password = ""; parsed.search = ""; parsed.hash = ""; return parsed.toString().replace(/\/$/, ""); }
async function exactGetJson(endpoint, route, fetchImpl) { const response = await fetchImpl(`${safeComfyEndpoint(endpoint)}${route}`, { method: "GET" }); if (!response?.ok) fail(`GET ${route} failed with HTTP ${response?.status ?? "unknown"}`); return response.json(); }
async function assertEvictedRecoveryRemoteState({ endpoint, fetchImpl, promptId }) { const queue = await exactGetJson(endpoint, "/queue", fetchImpl); if (!Array.isArray(queue?.queue_running) || !Array.isArray(queue?.queue_pending) || queue.queue_running.length !== 0 || queue.queue_pending.length !== 0) fail("evicted recovery requires exact queue 0/0"); const history = await exactGetJson(endpoint, `/history/${encodeURIComponent(promptId)}`, fetchImpl); if (!history || typeof history !== "object" || Array.isArray(history) || Object.keys(history).length !== 0) fail("evicted recovery requires the prompt history to remain exactly absent"); return true; }

function exactResource(filePath, label, geometry = null) {
  const resolved = path.resolve(filePath ?? "");
  if (!path.isAbsolute(filePath ?? "") || resolved !== filePath || !existsSync(resolved)) fail(`${label} path is not canonical`);
  const link = lstatSync(resolved);
  if (!link.isFile() || link.isSymbolicLink() || realpathSync(resolved) !== resolved) fail(`${label} must be a real canonical file`);
  if (geometry) probePng(resolved, geometry);
  return artifact(resolved);
}

let crcTable;
function crc32(bytes) {
  crcTable ??= Array.from({ length: 256 }, (_, value) => { let current = value; for (let bit = 0; bit < 8; bit += 1) current = (current & 1) ? (0xedb88320 ^ (current >>> 1)) : (current >>> 1); return current >>> 0; });
  let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0;
}

function embeddedPrompt(filePath, recovery, label) {
  const bytes = readFileSync(filePath); const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) fail(`${label} is not a canonical PNG`);
  let offset = 8; let width; let height; let ended = false; const prompts = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail(`${label} PNG chunk framing is truncated`);
    const length = bytes.readUInt32BE(offset); const type = bytes.subarray(offset + 4, offset + 8); const dataStart = offset + 8; const dataEnd = dataStart + length; const crcOffset = dataEnd;
    if (dataEnd + 4 > bytes.length) fail(`${label} PNG chunk framing is truncated`);
    const expectedCrc = bytes.readUInt32BE(crcOffset); const actualCrc = crc32(Buffer.concat([type, bytes.subarray(dataStart, dataEnd)])); if (expectedCrc !== actualCrc) fail(`${label} PNG chunk CRC is invalid`);
    const typeText = type.toString("ascii");
    if (typeText === "IHDR") { if (offset !== 8 || length !== 13) fail(`${label} PNG IHDR is noncanonical`); width = bytes.readUInt32BE(dataStart); height = bytes.readUInt32BE(dataStart + 4); }
    if (typeText === "tEXt") { const data = bytes.subarray(dataStart, dataEnd); const separator = data.indexOf(0); if (separator > 0 && data.subarray(0, separator).toString("latin1") === "prompt") prompts.push(data.subarray(separator + 1)); }
    if (typeText === "zTXt" || typeText === "iTXt") { const data = bytes.subarray(dataStart, dataEnd); const separator = data.indexOf(0); if (separator > 0 && data.subarray(0, separator).toString("latin1") === "prompt") fail(`${label} embedded prompt must be an uncompressed tEXt chunk`); }
    offset = dataEnd + 4; if (typeText === "IEND") { if (length !== 0 || offset !== bytes.length) fail(`${label} PNG IEND is noncanonical`); ended = true; break; }
  }
  if (!ended || width !== CANVAS.width || height !== CANVAS.height || prompts.length !== 1) fail(`${label} must contain one 1152x640 PNG prompt tEXt chunk`);
  let workflow; try { workflow = JSON.parse(prompts[0].toString("utf8")); } catch { fail(`${label} embedded prompt JSON is malformed`); }
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) fail(`${label} embedded prompt workflow is malformed`);
  const hashes = { "6": recovery.journal.queueBinding.resources.currentInput.sha256, "7": recovery.journal.queueBinding.resources.editableMask.sha256 };
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!Object.hasOwn(node ?? {}, "is_changed")) continue;
    if (!Object.hasOwn(hashes, nodeId)) fail(`${label} embeds an unauthorized is_changed field`);
    if (!Array.isArray(node.is_changed) || node.is_changed.length !== 1 || typeof node.is_changed[0] !== "string" || node.is_changed[0] !== hashes[nodeId]) fail(`${label} ${nodeId}.is_changed does not exactly bind the frozen resource hash`);
  }
  for (const nodeId of ["6", "7"]) if (!Object.hasOwn(workflow[nodeId] ?? {}, "is_changed")) fail(`${label} must contain both exact Comfy is_changed resource bindings`);
  const canonical = clone(workflow); delete canonical["6"].is_changed; delete canonical["7"].is_changed;
  if (stableJson(canonical) !== stableJson(recovery.workflow)) fail(`${label} embedded prompt differs from the exact frozen workflow`);
  return { rawEmbeddedPromptSha256: hashBytes(prompts[0]), canonicalWorkflowSha256: hashBytes(Buffer.from(stableJson(canonical))), workflow: canonical };
}

function run(command, args, encoding = "utf8", input) {
  const result = spawnSync(command, args, { encoding, input, windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
  if (result.error) fail(`${command} could not run: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} failed: ${String(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

function probePng(filePath, expected = CANVAS) {
  const resolved = path.resolve(filePath ?? "");
  if (!existsSync(resolved) || !statSync(resolved).isFile() || statSync(resolved).size <= 0) fail(`PNG is missing or empty: ${resolved}`);
  let stream;
  try {
    stream = JSON.parse(run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "json", resolved]))?.streams?.[0];
  } catch (error) { fail(`PNG probe failed: ${error.message}`); }
  if (stream?.codec_type !== "video" || stream.codec_name !== "png") fail(`image codec must be PNG: ${resolved}`);
  if (expected && (stream.width !== expected.width || stream.height !== expected.height)) fail(`PNG geometry must be ${expected.width}x${expected.height}`);
  run("ffmpeg", ["-v", "error", "-i", resolved, "-frames:v", "1", "-f", "null", "-"]);
  return { path: resolved, width: stream.width, height: stream.height };
}

function pixels(filePath, format) {
  return Buffer.from(run("ffmpeg", ["-v", "error", "-i", filePath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", format, "pipe:1"], null));
}

function writeRawPng(bytes, pixelFormat, width, height, destination) {
  if (existsSync(destination)) fail(`destination exists; refusing to overwrite: ${destination}`);
  run("ffmpeg", ["-y", "-v", "error", "-f", "rawvideo", "-pixel_format", pixelFormat, "-video_size", `${width}x${height}`, "-i", "pipe:0", "-frames:v", "1", "-pix_fmt", pixelFormat, destination], "utf8", bytes);
  probePng(destination, { width, height });
}

function artifact(filePath) {
  const resolved = path.resolve(filePath);
  const stats = statSync(resolved);
  return { path: resolved, size: stats.size, sha256: sha256File(resolved) };
}

function assertResource(item, label, geometry = CANVAS) {
  if (!item || typeof item.path !== "string" || !Number.isInteger(item.size) || item.size <= 0 || !HEX_SHA256.test(item.sha256 ?? "")) fail(`${label} resource is malformed`);
  const resolved = path.resolve(item.path);
  if (!existsSync(resolved) || !statSync(resolved).isFile() || statSync(resolved).size !== item.size || sha256File(resolved) !== item.sha256.toLowerCase()) fail(`${label} resource hash/size no longer matches`);
  if (geometry) probePng(resolved, geometry);
  return { ...clone(item), path: resolved, sha256: item.sha256.toLowerCase() };
}

function readJson(filePath, label) {
  try { return JSON.parse(readFileSync(filePath, "utf8")); }
  catch { fail(`${label} is missing or malformed: ${filePath}`); }
}

function fsyncDirectory(directory) {
  let descriptor;
  try { descriptor = openSync(directory, "r"); fsyncSync(descriptor); }
  catch (error) { if (!["EACCES", "EBADF", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(error?.code)) throw error; }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function writeJsonAtomic(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600); writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined;
    renameSync(temporary, filePath);
    fsyncDirectory(path.dirname(filePath));
  } finally { if (descriptor !== undefined) closeSync(descriptor); rmSync(temporary, { force: true }); }
}

function writeJsonExclusive(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const descriptor = openSync(filePath, "wx", 0o600);
  try { writeFileSync(descriptor, `${JSON.stringify(value)}\n`, "utf8"); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  fsyncDirectory(path.dirname(filePath));
}

function exactLink(node, input, expected) {
  return Array.isArray(node?.inputs?.[input]) && node.inputs[input].length === 2 && node.inputs[input][0] === expected[0] && node.inputs[input][1] === expected[1];
}

export function assertSurfaceWorkflowGraph(workflow) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) fail("workflow must be an object");
  const wanted = [
    ["14", "image1", ["6", 0]], ["18", "pixels", ["6", 0]], ["8", "image", ["7", 0]],
    ["18", "mask", ["8", 0]], ["18", "vae", ["5", 0]], ["16", "latent_image", ["18", 0]],
    ["17", "samples", ["16", 0]], ["17", "vae", ["5", 0]], ["20", "images", ["17", 0]],
  ];
  for (const [nodeId, input, expected] of wanted) if (!exactLink(workflow[nodeId], input, expected)) fail(`graph ancestry mismatch at ${nodeId}.${input}`);
  if (workflow["6"]?.class_type !== "LoadImage" || workflow["7"]?.class_type !== "LoadImage" || workflow["8"]?.class_type !== "ImageToMask" || workflow["18"]?.class_type !== "VAEEncodeForInpaint" || workflow["16"]?.class_type !== "KSampler" || workflow["17"]?.class_type !== "VAEDecode" || workflow["20"]?.class_type !== "SaveImage") fail("graph uses an unexpected node class");
  const saveNodes = Object.entries(workflow).filter(([, node]) => node?.class_type === "SaveImage");
  if (saveNodes.length !== 1 || saveNodes[0][0] !== OUTPUT_NODE_ID) fail("graph must contain exactly one configured SaveImage output node");
  if (workflow["8"].inputs.channel !== "red") fail("stage mask must use the red channel");
  if (workflow["18"].inputs.grow_mask_by !== 0) fail("grow_mask_by must be 0");
  if (workflow["16"].inputs.denoise !== 1.0) fail("denoise must be 1.0");
  const encoder = workflow["14"];
  if (encoder?.class_type !== "TextEncodeQwenImageEditPlus") fail("Qwen encoder is missing");
  const visualInputs = Object.keys(encoder.inputs).filter((name) => /^image\d+$/.test(name));
  if (visualInputs.length !== 1 || visualInputs[0] !== "image1" || !exactLink(encoder, "image1", ["6", 0])) fail("Qwen must receive current input as image1 only");
  const maskNodes = new Set(["7", "8"]);
  for (const name of visualInputs) if (maskNodes.has(encoder.inputs[name]?.[0])) fail("mask nodes must never connect to Qwen visual references");
  return true;
}

export function compileSurfaceWorkflow(preset, tokens) {
  const workflow = compileWorkflow(preset, tokens);
  assertSurfaceWorkflowGraph(workflow);
  return workflow;
}

function assertStage(stage) {
  if (!RECONSTRUCTION_STAGES.includes(stage)) fail(`stage must be ${RECONSTRUCTION_STAGES.join("|")}`);
}

function candidateNumber(value) {
  if (typeof value !== "string" || !CANDIDATE_LEXEMES.has(value)) fail("candidate must be lexical string 1 or 2");
  return Number(value);
}

function currentAccepted(report, stage) {
  const invalidated = new Set(report.invalidations.filter((item) => item.descendantStage === stage).map((item) => item.descendantCandidateId));
  return report.stages[stage].filter((item) => item.state === "accepted" && !invalidated.has(item.id));
}

function expectedAncestorsAndInput(report, stage) {
  const index = RECONSTRUCTION_STAGES.indexOf(stage);
  const ancestors = [];
  let input = report.source;
  for (const predecessor of RECONSTRUCTION_STAGES.slice(0, index)) {
    const accepted = currentAccepted(report, predecessor);
    if (accepted.length !== 1) fail(`${predecessor} must have exactly one current accepted candidate before ${stage}`);
    ancestors.push({ stage: predecessor, candidateId: accepted[0].id });
    input = accepted[0].output;
  }
  if (currentAccepted(report, stage).length !== 0) fail(`${stage} already has a current accepted candidate`);
  return { ancestors, input: clone(input) };
}

function assertReport(report) {
  assertSurfaceRun(report, { isDecodable: (filePath) => { try { probePng(filePath, null); return true; } catch { return false; } } });
  assertResource(report.source, "mother image", CANVAS);
  return report;
}

function maskManifestPath(reportPath, provided) {
  return path.resolve(provided ?? path.join(path.dirname(reportPath), "surface-masks", "surface-mask-manifest.json"));
}

function equalSource(left, right) {
  return left?.path === right?.path && left?.size === right?.size && left?.sha256 === right?.sha256 && left?.width === 1152 && left?.height === 640;
}

function selectedOverlap(manifest, stage) {
  return stage === "lower_background" ? manifest.overlaps?.middleLower : manifest.overlaps?.upperMiddle;
}

function exactStageMasks(manifest, stage) {
  return {
    editable: assertResource(manifest.masks?.[stage], `${stage} editable mask`, CANVAS),
    protected: assertResource(manifest.protectedMasks?.[stage], `${stage} protected mask`, CANVAS),
    overlap: assertResource(selectedOverlap(manifest, stage), `${stage} frozen overlap mask`, CANVAS),
  };
}

function loadExternalOverlayReview(manifestPath, manifestResource, manifest) {
  const reviewPath = path.join(path.dirname(manifestPath), "surface-mask-review.json");
  const review = readJson(reviewPath, "external surface mask overlay review");
  if (review?.schema !== 1 || review.kind !== "surface-mask-overlay-review" || review.currentDecision !== "accepted" || !Array.isArray(review.history) || review.history.length !== 1) fail("external surface mask overlay review must contain one immutable accepted decision");
  if (stableJson(review.manifest) !== stableJson(manifestResource)) fail("external surface mask overlay review is bound to a stale manifest");
  const latest = review.history[0];
  if (latest?.decision !== "accepted" || typeof latest.note !== "string" || !latest.note.trim() || stableJson(latest.evidence) !== stableJson(manifest.combinedOverlay)) fail("external surface mask overlay review evidence is stale");
  assertResource(latest.evidence, "external surface mask overlay review evidence", CANVAS);
  return { kind: "external-overlay-review", artifact: artifact(reviewPath), manifestSha256: manifestResource.sha256, evidence: clone(latest.evidence), decision: "accepted" };
}

export function assertCurrentSurfaceMaskManifest(manifest, report) {
  const structural = clone(manifest);
  const semantic = structural.v1Evidence?.semanticCastShadowCoverage; const review = structural.v1Evidence?.reviewStatus;
  if (semantic === "accepted" && review === "accepted") { structural.v1Evidence.semanticCastShadowCoverage = "pending_user_review"; structural.v1Evidence.reviewStatus = "pending"; }
  try { assertSurfaceMaskManifest(structural); return manifest; }
  catch (error) {
    if (!/Task 2\/V1 provenance is not exact/.test(error.message)) throw error;
    const initial = { schema: report.schema, experiment: report.experiment, source: clone(report.source), legacyEvidence: clone(report.legacyEvidence), stages: Object.fromEntries(["upper_background", "middle_background", "lower_background", "final_empty_plate"].map((name) => [name, []])), overallStatus: "pending", invalidations: [] };
    const bytes = Buffer.from(`${JSON.stringify(initial, null, 2)}\n`); const frozen = structural.task2RunReport;
    if (!frozen || frozen.size !== bytes.length || frozen.sha256 !== hashBytes(bytes)) throw error;
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "surface-task2-validation-")); const snapshotPath = path.join(temporaryRoot, "run-report.json");
    try {
      writeFileSync(snapshotPath, bytes, { flag: "wx" }); const validation = clone(structural); validation.task2RunReport = { ...validation.task2RunReport, path: snapshotPath }; assertSurfaceMaskManifest(validation); return manifest;
    } finally { rmSync(temporaryRoot, { recursive: true, force: true }); }
  }
}

function loadMaskContext({ reportPath, report, stage, manifestPath }) {
  const resolved = maskManifestPath(reportPath, manifestPath);
  const manifestResource = artifact(resolved);
  const manifest = readJson(resolved, "surface mask manifest");
  assertCurrentSurfaceMaskManifest(manifest, report);
  if (!equalSource(manifest.source, report.source)) fail("mask manifest mother image provenance does not match the current report");
  if (manifest.legacyEvidence?.reportPath !== report.legacyEvidence.reportPath || manifest.legacyEvidence?.reportSha256 !== report.legacyEvidence.reportSha256 || manifest.legacyEvidence?.stoppedReason !== report.legacyEvidence.stoppedReason) fail("mask manifest legacy provenance does not match the current report");
  const externalReview = loadExternalOverlayReview(resolved, manifestResource, manifest);
  const selected = exactStageMasks(manifest, stage);
  const editable = selected.editable;
  const protectedMask = selected.protected;
  const overlap = selected.overlap;
  const maskBytes = pixels(editable.path, "gray");
  if (maskBytes.length !== CANVAS.width * CANVAS.height || [...maskBytes].some((value) => value !== 0 && value !== 255)) fail(`${stage} editable mask must be binary grayscale`);
  const protectedBytes = pixels(protectedMask.path, "gray");
  if (protectedBytes.length !== maskBytes.length || [...protectedBytes].some((value) => value !== 0 && value !== 255)) fail(`${stage} protected mask must be binary grayscale`);
  return { manifest, manifestResource, editable, protected: protectedMask, overlap, source: clone(manifest.source), reviewAttestation: externalReview };
}

function maskContextBinding(context) {
  return {
    manifestResource: context.manifestResource,
    editable: context.editable,
    protected: context.protected,
    overlap: context.overlap,
    source: context.source,
    reviewAttestation: context.reviewAttestation,
  };
}

function pathsFor(reportPath, stage, candidate) {
  const id = `candidate_${String(candidate).padStart(3, "0")}`;
  const stageRoot = path.join(path.dirname(reportPath), stage);
  const attemptsRoot = path.join(stageRoot, "attempts", id);
  const queuedMarkerPath = path.join(stageRoot, `.${id}.queued`);
  const candidateDirectory = path.join(stageRoot, id);
  return { id, stageRoot, attemptsRoot, queuedMarkerPath, candidateDirectory };
}

function createAttempt(paths) {
  const attemptId = `${String(Date.now()).padStart(13, "0")}-${process.pid}-${randomUUID()}`;
  if (!ATTEMPT_ID.test(attemptId)) fail("generated attempt ID is not canonical");
  const directory = path.join(paths.attemptsRoot, attemptId);
  mkdirSync(directory, { recursive: false });
  return { attemptId, directory, journalPath: path.join(directory, "attempt.json"), rawPath: path.join(directory, "comfy-output.png") };
}

function readMarker(paths) {
  if (!existsSync(paths.queuedMarkerPath)) return null;
  const marker = readJson(paths.queuedMarkerPath, "queued prompt marker");
  if (Object.keys(marker).sort().join(",") !== "attemptId,promptId,queueBinding,queuedAt" || !ATTEMPT_ID.test(marker.attemptId ?? "") || typeof marker.promptId !== "string" || !marker.promptId.trim() || !Number.isSafeInteger(marker.queuedAt) || marker.queuedAt < 0) fail("queued prompt marker is malformed");
  const binding = marker.queueBinding;
  if (!binding || binding.version !== "surface-queue-binding-v1" || binding.stage !== path.basename(paths.stageRoot) || binding.candidateId !== paths.id || binding.attemptId !== marker.attemptId) fail("queued prompt marker binding identity is malformed");
  const directory = path.join(paths.attemptsRoot, marker.attemptId);
  const journalPath = path.join(directory, "attempt.json");
  const journal = readJson(journalPath, "queued attempt journal");
  if (journal.attemptId !== marker.attemptId || (journal.promptId !== undefined && journal.promptId !== marker.promptId) || journal.stageRoot !== paths.stageRoot || journal.candidateId !== paths.id || stableJson(journal.queueBinding) !== stableJson(binding)) fail("queued marker binding and attempt provenance do not match");
  return { marker, attempt: { attemptId: marker.attemptId, directory, journalPath, rawPath: path.join(directory, "comfy-output.png") }, journal };
}

function canonicalCaptureSubfolder(value) {
  if (typeof value !== "string" || !value || value.includes("\0")) fail("capture output subfolder descriptor is unsafe");
  const canonical = value.replaceAll("\\", "/");
  if (canonical.startsWith("/") || /^[A-Za-z]:/.test(canonical) || path.posix.isAbsolute(canonical) || canonical.split("/").some((part) => !part || part === "." || part === ".." || part.includes(":"))) fail("capture output subfolder descriptor is unsafe");
  return canonical;
}
export function canonicalSurfaceCaptureDescriptor(descriptor, expectedSubfolder) {
  if (!descriptor || Object.keys(descriptor).sort().join(",") !== "filename,subfolder,type" || typeof descriptor.filename !== "string" || !descriptor.filename.startsWith("surface") || path.extname(descriptor.filename).toLowerCase() !== ".png" || descriptor.type !== "output" || descriptor.filename.includes("/") || descriptor.filename.includes("\\") || descriptor.filename.includes("\0") || descriptor.filename.includes(":")) fail("capture must return exactly one configured PNG output descriptor and subfolder");
  const subfolder = canonicalCaptureSubfolder(descriptor.subfolder); if (subfolder !== expectedSubfolder) fail("capture must return exactly one configured PNG output descriptor and subfolder");
  return { filename: descriptor.filename, subfolder, type: descriptor.type };
}
function captureBinding({ descriptor, expectedSubfolder, attemptId, promptId, workflowSha256, queueBinding, evictedAttestation }) { const binding = { version: evictedAttestation ? "surface-capture-binding-v2" : "surface-capture-binding-v1", attemptId, promptId, outputNodeId: OUTPUT_NODE_ID, outputCount: 1, filenamePrefix: "surface", expectedSubfolder, workflowSha256, queueBindingSha256: hashBytes(Buffer.from(stableJson(queueBinding))), descriptor: canonicalSurfaceCaptureDescriptor(descriptor, expectedSubfolder) }; if (evictedAttestation) binding.evictedAttestation = queueResourceIdentity(evictedAttestation, "evicted capture attestation"); return binding; }
function assertStoredCaptureProvenance(journal, expectedSubfolder, label) { const expected = captureBinding({ descriptor: journal?.descriptor, expectedSubfolder, attemptId: journal?.attemptId, promptId: journal?.promptId, workflowSha256: journal?.workflowSha256, queueBinding: journal?.queueBinding, evictedAttestation: journal?.captureBinding?.evictedAttestation }); if (stableJson(journal?.descriptor) !== stableJson(expected.descriptor) || stableJson(journal?.captureBinding) !== stableJson(expected) || !Number.isSafeInteger(journal?.capturedAt) || journal.capturedAt < journal.queuedAt) fail(`${label} canonical capture descriptor provenance is missing or stale`); return expected.descriptor; }
function assertCapture(captured, promptId, destination, expectedSubfolder) {
  if (captured?.promptId !== promptId || path.resolve(captured.destination ?? "") !== path.resolve(destination)) fail("capture prompt/destination provenance is invalid");
  const descriptor = canonicalSurfaceCaptureDescriptor(captured.descriptor, expectedSubfolder); probePng(destination, CANVAS); return descriptor;
}

function legacyCaptureMigration(value) {
  if (value === undefined) return null;
  if (!value || Object.keys(value).sort().join(",") !== "attemptId,promptId,rawSha256,rawSize" || !ATTEMPT_ID.test(value.attemptId ?? "") || typeof value.promptId !== "string" || !value.promptId.trim() || !Number.isSafeInteger(value.rawSize) || value.rawSize <= 0 || !HEX_SHA256.test(value.rawSha256 ?? "")) fail("legacy capture migration identity is malformed");
  return { attemptId: value.attemptId, promptId: value.promptId, rawSize: value.rawSize, rawSha256: value.rawSha256.toLowerCase() };
}

function exactLegacyPrebindingJournal(journal) {
  const keys = ["attemptId", "candidateId", "createdAt", "error", "failedAt", "presetSha256", "promptId", "queueBinding", "queuedAt", "stage", "stageRoot", "status", "uploads", "workflow", "workflowSha256"].sort().join(",");
  return journal?.status === "failed-postqueue" && Object.keys(journal).sort().join(",") === keys && Number.isSafeInteger(journal.createdAt) && Number.isSafeInteger(journal.queuedAt) && Number.isSafeInteger(journal.failedAt) && journal.createdAt >= 0 && journal.queuedAt >= 0 && journal.failedAt >= 0 && journal.createdAt <= journal.queuedAt && journal.queuedAt <= journal.failedAt && journal.error === "Surface empty plate V2 Comfy invariant: capture must return exactly one configured PNG output descriptor and subfolder";
}

function renderPublishedArtifacts({ input, raw, mask, paths, attempt, candidateRecordBase, workflow }) {
  const stageDirectory = paths.candidateDirectory;
  const staging = path.join(paths.stageRoot, `.${paths.id}.${attempt.attemptId}.publish`);
  if (existsSync(stageDirectory) || existsSync(staging)) fail("candidate publication already exists; refusing to overwrite");
  mkdirSync(staging, { recursive: false });
  try {
    const inputRgb = pixels(input.path, "rgb24");
    const rawRgb = pixels(raw, "rgb24");
    const maskGray = pixels(mask.path, "gray");
    if (inputRgb.length !== rawRgb.length || inputRgb.length !== maskGray.length * 3) fail("postmerge pixel lengths are inconsistent");
    const merged = Buffer.from(inputRgb);
    const difference = Buffer.alloc(inputRgb.length);
    const overlay = Buffer.from(inputRgb);
    for (let pixel = 0; pixel < maskGray.length; pixel += 1) {
      if (maskGray[pixel] !== 0 && maskGray[pixel] !== 255) fail("postmerge mask must be binary");
      for (let channel = 0; channel < 3; channel += 1) {
        const offset = pixel * 3 + channel;
        if (maskGray[pixel] === 255) merged[offset] = rawRgb[offset];
        difference[offset] = Math.abs(merged[offset] - inputRgb[offset]);
      }
      if (maskGray[pixel] === 255) {
        const offset = pixel * 3;
        overlay[offset] = Math.round(inputRgb[offset] * 0.58 + 255 * 0.42);
        overlay[offset + 1] = Math.round(inputRgb[offset + 1] * 0.58);
        overlay[offset + 2] = Math.round(inputRgb[offset + 2] * 0.58);
      }
    }
    const comparison = Buffer.alloc(CANVAS.width * 2 * CANVAS.height * 3);
    for (let y = 0; y < CANVAS.height; y += 1) {
      const sourceStart = y * CANVAS.width * 3;
      const targetStart = y * CANVAS.width * 2 * 3;
      inputRgb.copy(comparison, targetStart, sourceStart, sourceStart + CANVAS.width * 3);
      merged.copy(comparison, targetStart + CANVAS.width * 3, sourceStart, sourceStart + CANVAS.width * 3);
    }
    const files = {
      output: path.join(staging, "surface.png"), difference: path.join(staging, "difference.png"),
      comparison: path.join(staging, "comparison.png"), maskOverlay: path.join(staging, "mask-overlay.png"),
      workflow: path.join(staging, "workflow.json"), raw: path.join(staging, "comfy-output.png"),
    };
    writeRawPng(merged, "rgb24", CANVAS.width, CANVAS.height, files.output);
    writeRawPng(difference, "rgb24", CANVAS.width, CANVAS.height, files.difference);
    writeRawPng(comparison, "rgb24", CANVAS.width * 2, CANVAS.height, files.comparison);
    writeRawPng(overlay, "rgb24", CANVAS.width, CANVAS.height, files.maskOverlay);
    writeFileSync(files.workflow, `${JSON.stringify(workflow, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    copyFileSync(raw, files.raw, constants.COPYFILE_EXCL);
    assertOutsideEditableIdentity(input.path, files.output, mask.path);
    const final = Object.fromEntries(Object.entries(files).map(([key, temporary]) => [key, path.join(stageDirectory, path.basename(temporary))]));
    const record = {
      ...candidateRecordBase,
      workflow: { path: final.workflow, sha256: sha256File(files.workflow) },
      output: { ...artifact(files.output), path: final.output },
      evidence: {
        comparison: { ...artifact(files.comparison), path: final.comparison },
        difference: { ...artifact(files.difference), path: final.difference },
        maskOverlay: { ...artifact(files.maskOverlay), path: final.maskOverlay },
      },
      rawComfyOutput: { ...artifact(files.raw), path: final.raw },
    };
    writeFileSync(path.join(staging, "publication.json"), `${JSON.stringify({ attemptId: attempt.attemptId, record }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(staging, stageDirectory);
    fsyncDirectory(paths.stageRoot);
    return record;
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

function loadPublished(paths, attemptId) {
  if (!existsSync(paths.candidateDirectory)) return null;
  const publication = readJson(path.join(paths.candidateDirectory, "publication.json"), "candidate publication journal");
  if (publication.attemptId !== attemptId || publication.record?.id !== paths.id) fail("published candidate attempt provenance is inconsistent");
  assertResource(publication.record.output, "published output", CANVAS);
  assertResource(publication.record.evidence?.difference, "published difference", CANVAS);
  assertResource(publication.record.evidence?.comparison, "published comparison", { width: 2304, height: 640 });
  assertResource(publication.record.evidence?.maskOverlay, "published mask overlay", CANVAS);
  assertResource(publication.record.rawComfyOutput, "published raw Comfy output", CANVAS);
  if (!existsSync(publication.record.workflow?.path) || sha256File(publication.record.workflow.path) !== publication.record.workflow.sha256) fail("published workflow hash no longer matches");
  return publication.record;
}

export function assertPublishedBinding({ record, journal, marker, current, maskContext, stage, candidate, paths }) {
  if (!journal?.recordBase || !journal?.workflow || !journal?.workflowSha256 || !journal?.presetSha256) fail("published recovery journal lacks complete frozen provenance");
  const recoveredBase = clone(record);
  for (const key of ["workflow", "output", "evidence", "rawComfyOutput"]) delete recoveredBase[key];
  if (stableJson(recoveredBase) !== stableJson(journal.recordBase)) fail("published recovery record provenance does not bind to its attempt journal");
  assertStoredCaptureProvenance(journal, `${stage}/${paths.id}`, `${stage}/${paths.id} published capture`); if (stableJson(record.capture) !== stableJson(journal.captureBinding)) fail("published recovery capture descriptor binding changed");
  const expected = {
    id: paths.id,
    input: current.input,
    masks: { editable: maskContext.editable, protected: maskContext.protected, overlap: maskContext.overlap },
    maskManifest: maskContext.manifestResource,
    prompt: STAGE_PROMPTS[stage],
    negativePrompt: STAGE_NEGATIVE_PROMPT,
    seed: SURFACE_SEEDS[stage][candidate - 1],
    promptId: marker.promptId,
    ancestors: current.ancestors,
  };
  for (const [key, value] of Object.entries(expected)) if (stableJson(record[key]) !== stableJson(value)) fail(`published recovery ${key} binding changed`);
  if (record.preset?.path !== PRESET_PATH || record.preset?.sha256 !== journal.presetSha256 || sha256File(PRESET_PATH) !== journal.presetSha256) fail("published recovery preset binding changed");
  const frozenWorkflow = readJson(record.workflow.path, "published workflow");
  if (stableJson(frozenWorkflow) !== stableJson(journal.workflow) || hashBytes(Buffer.from(`${JSON.stringify(frozenWorkflow)}\n`)) !== journal.workflowSha256) fail("published recovery workflow binding changed");
  const selected = assertApprovedCompiledWorkflow(frozenWorkflow, { stage, candidate, uploads: record.uploads, id: paths.id });
  if (stableJson(record.models) !== stableJson(selected) || record.model?.name !== selected.unet || record.model?.sha256 !== hashBytes(Buffer.from(stableJson(selected)))) fail("published recovery model binding changed");
}

function models(workflow) {
  const selected = {};
  for (const node of Object.values(workflow)) {
    if (node.class_type === "UNETLoader") selected.unet = node.inputs.unet_name;
    if (node.class_type === "LoraLoaderModelOnly") selected.lora = node.inputs.lora_name;
    if (node.class_type === "CLIPLoader") selected.clip = node.inputs.clip_name;
    if (node.class_type === "VAELoader") selected.vae = node.inputs.vae_name;
  }
  if (Object.keys(selected).sort().join(",") !== "clip,lora,unet,vae") fail("workflow model selections are incomplete");
  return selected;
}

function assertApprovedModels(selected, label) {
  if (stableJson(selected) !== stableJson(APPROVED_MODELS)) fail(`${label} model selections are not the exact approved Qwen enums`);
}

export function assertApprovedCompiledWorkflow(workflow, { stage, candidate, uploads, id }) {
  if (!uploads || typeof uploads.inputImage !== "string" || !uploads.inputImage || typeof uploads.editableMask !== "string" || !uploads.editableMask) fail(`${stage} ${id} frozen upload provenance is missing`);
  const approvedPreset = JSON.parse(readFileSync(PRESET_PATH, "utf8"));
  const expected = compileSurfaceWorkflow(approvedPreset, {
    ...placeholderTokens(stage, candidate), INPUT_IMAGE: uploads.inputImage, EDITABLE_MASK: uploads.editableMask,
  });
  if (stableJson(workflow) !== stableJson(expected)) fail(`${stage} ${id} workflow is not the exact independently recompiled approved graph`);
  if (workflow["16"].inputs.steps !== 4 || workflow["16"].inputs.cfg !== 1.0 || workflow["16"].inputs.sampler_name !== "euler" || workflow["16"].inputs.scheduler !== "beta" || workflow["16"].inputs.denoise !== 1.0 || workflow["20"].inputs.filename_prefix !== `${stage}/${id}/surface`) fail(`${stage} ${id} sampler or output prefix drifted`);
  const selected = models(workflow); assertApprovedModels(selected, `${stage} ${id}`); return selected;
}

function assertAcceptedTask4Chain(report, requestedStage, maskContext) {
  const index = RECONSTRUCTION_STAGES.indexOf(requestedStage);
  let expectedInput = report.source;
  const expectedAncestors = [];
  for (const stage of RECONSTRUCTION_STAGES.slice(0, index)) {
    const accepted = currentAccepted(report, stage);
    if (accepted.length !== 1) fail(`${stage} accepted ancestor chain is incomplete`);
    const candidate = accepted[0]; const number = Number(candidate.id.slice(-3));
    if (![1, 2].includes(number)) fail(`${stage} accepted ancestor candidate ID is invalid`);
    if (stableJson(candidate.input) !== stableJson(expectedInput) || stableJson(candidate.ancestors) !== stableJson(expectedAncestors)) fail(`${stage} accepted ancestor input/provenance chain drifted`);
    if (candidate.prompt !== STAGE_PROMPTS[stage] || candidate.negativePrompt !== STAGE_NEGATIVE_PROMPT || candidate.seed !== SURFACE_SEEDS[stage][number - 1]) fail(`${stage} accepted ancestor fixed prompt/seed drifted`);
    if (candidate.preset?.path !== PRESET_PATH || candidate.preset?.sha256 !== sha256File(PRESET_PATH)) fail(`${stage} accepted ancestor preset hash/path drifted`);
    const exactMasks = exactStageMasks(maskContext.manifest, stage);
    if (stableJson(candidate.masks) !== stableJson(exactMasks) || stableJson(candidate.maskManifest) !== stableJson(maskContext.manifestResource)) fail(`${stage} accepted ancestor mask/manifest provenance drifted`);
    assertResource(candidate.output, `${stage} accepted output`, CANVAS);
    assertResource(candidate.rawComfyOutput, `${stage} accepted raw Comfy output`, CANVAS);
    assertResource(candidate.evidence?.difference, `${stage} accepted difference`, CANVAS);
    assertResource(candidate.evidence?.comparison, `${stage} accepted comparison`, { width: 2304, height: 640 });
    assertResource(candidate.evidence?.maskOverlay, `${stage} accepted mask overlay`, CANVAS);
    if (!candidate.workflow?.path || !existsSync(candidate.workflow.path) || sha256File(candidate.workflow.path) !== candidate.workflow.sha256) fail(`${stage} accepted ancestor workflow file/hash drifted`);
    const selected = assertApprovedCompiledWorkflow(readJson(candidate.workflow.path, `${stage} accepted workflow`), { stage, candidate: number, uploads: candidate.uploads, id: candidate.id });
    if (stableJson(candidate.models) !== stableJson(selected) || candidate.model?.name !== selected.unet || candidate.model?.sha256 !== hashBytes(Buffer.from(stableJson(selected)))) fail(`${stage} accepted ancestor model provenance drifted`);
    expectedAncestors.push({ stage, candidateId: candidate.id }); expectedInput = candidate.output;
  }
}

function placeholderTokens(stage, candidate) {
  return {
    INPUT_IMAGE: "current-input.png", EDITABLE_MASK: "editable-mask.png", PROMPT: STAGE_PROMPTS[stage],
    NEGATIVE_PROMPT: STAGE_NEGATIVE_PROMPT, SEED: SURFACE_SEEDS[stage][candidate - 1],
    FILENAME_PREFIX: `${stage}/candidate_${String(candidate).padStart(3, "0")}/surface`,
  };
}

function queueResourceIdentity(item, label) {
  if (!item || typeof item.path !== "string" || !Number.isInteger(item.size) || item.size <= 0 || !HEX_SHA256.test(item.sha256 ?? "")) fail(`${label} queue resource identity is malformed`);
  return { path: path.resolve(item.path), size: item.size, sha256: item.sha256.toLowerCase() };
}

function assertBoundUploadDescriptor(value, subfolder, role, label) {
  const expected = `${subfolder}/${role}.png`;
  if (value !== expected || path.isAbsolute(value) || value.includes("\\") || value.split("/").some((part) => !part || part === "." || part === "..")) fail(`${label} upload descriptor violates the exact subfolder/role/basename policy`);
  return value;
}

export function createQueueBinding({ stage, candidate, id, attemptId, currentInput, editableMask, uploadRoot, descriptors, presetSha256, workflow }) {
  const inputRole = "current_accepted_input"; const maskRole = `${stage}_editable_mask`;
  const boundDescriptors = {
    inputImage: assertBoundUploadDescriptor(descriptors?.inputImage, uploadRoot, inputRole, "current input"),
    editableMask: assertBoundUploadDescriptor(descriptors?.editableMask, uploadRoot, maskRole, "editable mask"),
  };
  const tokens = placeholderTokens(stage, candidate);
  return {
    version: "surface-queue-binding-v1", stage, candidateId: id, attemptId,
    resources: { currentInput: queueResourceIdentity(currentInput, "current input"), editableMask: queueResourceIdentity(editableMask, "editable mask") },
    uploadPolicy: { subfolder: uploadRoot, input: { role: inputRole, basename: `${inputRole}.png` }, mask: { role: maskRole, basename: `${maskRole}.png` } },
    descriptors: boundDescriptors,
    presetSha256,
    approvedWorkflowSha256: hashBytes(Buffer.from(`${JSON.stringify(workflow)}\n`)),
    fixedTokens: { prompt: tokens.PROMPT, negativePrompt: tokens.NEGATIVE_PROMPT, seed: tokens.SEED, filenamePrefix: tokens.FILENAME_PREFIX },
  };
}

export function assertCompletedSurfaceAttemptJournal(journal, marker, label = "completed surface attempt") {
  if (journal?.status !== "completed" || typeof journal.promptId !== "string" || !journal.promptId.trim()) fail(`${label} prompt identity is noncanonical`); const times = [journal.createdAt, journal.queuedAt, journal.capturedAt, journal.publishedAt, journal.completedAt]; if (times.some((value) => !Number.isSafeInteger(value) || value < 0) || !(times[0] <= times[1] && times[1] <= times[2] && times[2] <= times[3] && times[3] <= times[4])) fail(`${label} timestamps are noncanonical or out of order`); if (marker && (journal.promptId !== marker.promptId || journal.queuedAt !== marker.queuedAt)) fail(`${label} prompt/queuedAt does not exactly match its marker`); assertStoredCaptureProvenance(journal, `${journal.stage}/${journal.candidateId}`, label); return journal;
}

export function assertSurfaceTask4TerminalProvenance({ reportPath, stage, candidate, workflow }) {
  const number = Number(candidate?.id?.slice(-3)); if (!RECONSTRUCTION_STAGES.includes(stage) || ![1, 2].includes(number)) fail("terminal provenance stage/candidate is invalid");
  const paths = pathsFor(path.resolve(reportPath), stage, number); const queued = readMarker(paths); if (!queued) fail(`${stage}/${candidate.id} has no terminal marker`);
  const { marker } = queued; const journal = queued.journal; const uploadRoot = `surface-empty-plate-v2/${stage}/${candidate.id}`;
  const completedAttempts = readdirSync(paths.attemptsRoot, { withFileTypes: true }).map((entry) => { if (!entry.isDirectory() || !ATTEMPT_ID.test(entry.name)) fail(`${stage}/${candidate.id} attempt directory is noncanonical`); const value = readJson(path.join(paths.attemptsRoot, entry.name, "attempt.json"), `${stage}/${candidate.id} attempt journal`); if (value.attemptId !== entry.name || value.stage !== stage || value.candidateId !== candidate.id || path.resolve(value.stageRoot ?? "") !== paths.stageRoot) fail(`${stage}/${candidate.id} attempt journal identity is noncanonical`); return value; }).filter((value) => value.status === "completed");
  if (completedAttempts.length !== 1 || completedAttempts[0].attemptId !== marker.attemptId) fail(`${stage}/${candidate.id} must have exactly one marker-owned completed attempt`);
  const trustedBinding = createQueueBinding({ stage, candidate: number, id: candidate.id, attemptId: marker.attemptId, currentInput: candidate.input, editableMask: candidate.masks?.editable, uploadRoot, descriptors: candidate.uploads, presetSha256: candidate.preset?.sha256, workflow });
  if (stableJson(marker.queueBinding) !== stableJson(trustedBinding) || stableJson(journal.queueBinding) !== stableJson(trustedBinding) || stableJson(journal.uploads) !== stableJson(candidate.uploads) || stableJson(journal.workflow) !== stableJson(workflow) || journal.workflowSha256 !== trustedBinding.approvedWorkflowSha256 || journal.presetSha256 !== candidate.preset?.sha256) fail(`${stage}/${candidate.id} terminal queue binding is stale`);
  assertCompletedSurfaceAttemptJournal(journal, marker, `${stage}/${candidate.id} completed attempt journal`); if (journal.promptId !== candidate.promptId || stableJson(journal.output) !== stableJson(candidate.output)) fail(`${stage}/${candidate.id} completed attempt journal is stale`);
  const published = loadPublished(paths, marker.attemptId); if (!published) fail(`${stage}/${candidate.id} publication is missing`);
  const canonicalEvidence = canonicalSurfaceRejectionEvidence({ reportPath, stage, candidate }); for (const [key, value] of Object.entries(canonicalEvidence)) if (stableJson(queueResourceIdentity(published.evidence?.[key], `${stage}/${candidate.id} published ${key}`)) !== stableJson(queueResourceIdentity(value, `${stage}/${candidate.id} canonical ${key}`))) fail(`${stage}/${candidate.id} publication evidence path policy changed`);
  assertPublishedBinding({ record: published, journal, marker, current: { input: candidate.input, ancestors: candidate.ancestors }, maskContext: { editable: candidate.masks.editable, protected: candidate.masks.protected, overlap: candidate.masks.overlap, manifestResource: candidate.maskManifest }, stage, candidate: number, paths });
  const reportRecord = clone(candidate); for (const key of ["state", "technicalAcceptance", "creativeAcceptance", "reviewHistory"]) delete reportRecord[key];
  if (stableJson(reportRecord) !== stableJson(published)) fail(`${stage}/${candidate.id} publication record differs from the report candidate`); const evictedAttestation = validateCompletedSurfaceEvictedAttestation({ reportPath, stage, candidate, journal, marker }); return { marker, journal, publication: published, queueBinding: trustedBinding, evictedAttestation };
}

export function canonicalSurfaceRejectionEvidence({ reportPath, stage, candidate }) {
  const number = Number(candidate?.id?.slice(-3)); if (!RECONSTRUCTION_STAGES.includes(stage) || ![1, 2].includes(number)) fail("rejection evidence stage/candidate is invalid"); const paths = pathsFor(path.resolve(reportPath), stage, number); const publication = readJson(path.join(paths.candidateDirectory, "publication.json"), `${stage}/${candidate.id} immutable publication`); if (publication.record?.id !== candidate.id) fail("rejection evidence publication identity changed"); const specifications = { difference: ["difference.png", CANVAS], comparison: ["comparison.png", { width: 2304, height: 640 }], maskOverlay: ["mask-overlay.png", CANVAS] };
  return Object.fromEntries(Object.entries(specifications).map(([key, [filename, geometry]]) => { const expectedPath = path.join(paths.candidateDirectory, filename); const frozen = publication.record.evidence?.[key]; if (path.resolve(frozen?.path ?? "") !== expectedPath) fail(`${stage}/${candidate.id} immutable publication ${key} path policy changed`); const current = artifact(expectedPath); assertResource(current, `${stage}/${candidate.id} canonical ${key}`, geometry); if (stableJson(queueResourceIdentity(frozen, `${stage}/${candidate.id} frozen ${key}`)) !== stableJson(queueResourceIdentity(current, `${stage}/${candidate.id} current ${key}`))) fail(`${stage}/${candidate.id} current ${key} bytes differ from immutable publication evidence`); return [key, current]; }));
}

export function inspectSurfaceRecoveryAttempt({ reportPath, manifestPath, stage, candidate }) {
  const resolvedReportPath = path.resolve(reportPath ?? ""); assertStage(stage); const number = candidateNumber(String(candidate));
  const report = assertReport(readJson(resolvedReportPath, "surface run report")); const maskContext = loadMaskContext({ reportPath: resolvedReportPath, report, stage, manifestPath }); const current = validateCurrent({ report, stage, candidate: number, maskContext });
  const paths = pathsFor(resolvedReportPath, stage, number); const queued = readMarker(paths); if (!queued) fail(`${stage}/${paths.id} has no durable queued recovery marker`);
  const { marker, attempt } = queued; const journal = queued.journal; const presetBytes = readFileSync(PRESET_PATH); const presetSha256 = hashBytes(presetBytes); const preset = JSON.parse(presetBytes.toString("utf8"));
  const uploadRoot = `surface-empty-plate-v2/${stage}/${paths.id}`; const uploads = clone(marker.queueBinding?.descriptors); const workflow = compileSurfaceWorkflow(preset, { ...placeholderTokens(stage, number), INPUT_IMAGE: uploads?.inputImage, EDITABLE_MASK: uploads?.editableMask });
  const trustedBinding = createQueueBinding({ stage, candidate: number, id: paths.id, attemptId: attempt.attemptId, currentInput: current.input, editableMask: maskContext.editable, uploadRoot, descriptors: uploads, presetSha256, workflow });
  if (stableJson(marker.queueBinding) !== stableJson(trustedBinding) || stableJson(journal.queueBinding) !== stableJson(trustedBinding) || stableJson(journal.uploads) !== stableJson(uploads) || stableJson(journal.workflow) !== stableJson(workflow) || journal.workflowSha256 !== trustedBinding.approvedWorkflowSha256 || journal.presetSha256 !== presetSha256) fail(`${stage}/${paths.id} queued recovery binding is stale`);
  assertApprovedCompiledWorkflow(workflow, { stage, candidate: number, uploads, id: paths.id });
  const published = loadPublished(paths, attempt.attemptId); const unpublishedStatuses = new Set(["queueing", "queued", "captured", "ready-to-publish", "failed-postqueue"]); const publishedStatuses = new Set(["ready-to-publish", "published", "failed-postqueue"]);
  if (published) { if (!publishedStatuses.has(journal.status)) fail(`${stage}/${paths.id} published recovery journal status is invalid`); assertPublishedBinding({ record: published, journal, marker, current, maskContext, stage, candidate: number, paths }); }
  else if (!unpublishedStatuses.has(journal.status)) fail(`${stage}/${paths.id} queued recovery journal status is invalid`);
  return { stage, candidateId: paths.id, promptId: marker.promptId, attemptId: marker.attemptId, workflow, journal, publication: published, status: published ? "published-recovery" : "queued-recovery" };
}

export function inspectSurfaceLegacyCaptureMigration({ reportPath, manifestPath, stage, candidate, migration } = {}) {
  const recovery = inspectSurfaceRecoveryAttempt({ reportPath, manifestPath, stage, candidate }); const number = candidateNumber(String(candidate)); const paths = pathsFor(path.resolve(reportPath ?? ""), stage, number); const queued = readMarker(paths);
  if (!queued || recovery.publication || existsSync(paths.candidateDirectory) || !exactLegacyPrebindingJournal(recovery.journal) || recovery.journal.queuedAt !== queued.marker.queuedAt || recovery.promptId !== queued.marker.promptId) fail(`${stage}/${paths.id} is not the exact unpublished legacy pre-binding capture state`);
  const rawPath = queued.attempt.rawPath; probePng(rawPath, CANVAS); const rawStats = statSync(rawPath); const identity = { attemptId: recovery.attemptId, promptId: recovery.promptId, rawSize: rawStats.size, rawSha256: sha256File(rawPath) };
  if (migration !== undefined && stableJson(legacyCaptureMigration(migration)) !== stableJson(identity)) fail("legacy capture migration identity does not match the exact frozen raw attempt");
  return { ...recovery, status: "legacy-capture-migration", raw: { path: rawPath, size: rawStats.size, sha256: identity.rawSha256 }, migration: identity };
}

function evictedAttestationPath(reportPath, stage, candidate) {
  const paths = pathsFor(path.resolve(reportPath), stage, candidateNumber(String(candidate))); const queued = readMarker(paths);
  if (!queued) fail(`${stage}/${paths.id} has no marker-owned attempt for evicted capture attestation`);
  return path.join(queued.attempt.directory, EVICTED_ATTESTATION_FILENAME);
}

function canonicalComfyOutput(filePath, recovery) {
  const resource = exactResource(filePath, "canonical Comfy output", CANVAS); const parts = resource.path.split(path.sep); const tail = parts.slice(-5);
  if (tail.length !== 5 || tail[0] !== "ComfyUI-Shared" || tail[1] !== "output" || tail[2] !== recovery.stage || tail[3] !== recovery.candidateId) fail("canonical Comfy output path does not bind ComfyUI-Shared/output/stage/candidate");
  const descriptor = canonicalSurfaceCaptureDescriptor({ filename: tail[4], subfolder: `${tail[2]}/${tail[3]}`, type: "output" }, `${recovery.stage}/${recovery.candidateId}`);
  return { resource, descriptor };
}

function attestationCurrent(recovery) {
  const preset = exactResource(PRESET_PATH, "approved preset");
  return {
    preset,
    workflowSha256: recovery.journal.workflowSha256,
    currentInput: clone(recovery.journal.queueBinding.resources.currentInput),
    editableMask: clone(recovery.journal.queueBinding.resources.editableMask),
  };
}

function composeEvictedAttestation({ recovery, paths, queued, failedJournal, canonicalOutputPath, historyEvicted, queueObserved, humanReview, attestedAt }) {
  exactKeys(historyEvicted, ["observedAt", "status"], "historyEvicted"); exactKeys(queueObserved, ["observedAt", "pending", "running"], "queueObserved"); exactKeys(humanReview, ["date", "decision", "note"], "humanReview");
  safeTimestamp(historyEvicted.observedAt, "historyEvicted observedAt"); safeTimestamp(queueObserved.observedAt, "queueObserved observedAt"); safeTimestamp(attestedAt, "attestedAt");
  if (historyEvicted.status !== "absent" || queueObserved.running !== 0 || queueObserved.pending !== 0) fail("evicted attestation observations must record absent history and queue 0/0");
  if (humanReview.decision !== "accepted" || typeof humanReview.note !== "string" || !humanReview.note.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(humanReview.date)) fail("evicted attestation requires an explicit dated accepted human decision and note");
  if (attestedAt < historyEvicted.observedAt || attestedAt < queueObserved.observedAt) fail("attestedAt precedes its observations");
  const marker = exactResource(paths.queuedMarkerPath, "queued marker"); const rawCapture = exactResource(queued.attempt.rawPath, "frozen raw capture", CANVAS); const canonical = canonicalComfyOutput(canonicalOutputPath, recovery);
  if (rawCapture.size !== canonical.resource.size || rawCapture.sha256 !== canonical.resource.sha256) fail("canonical Comfy output bytes do not exactly match the frozen raw capture");
  const embeddedRaw = embeddedPrompt(rawCapture.path, recovery, "frozen raw capture"); const embeddedOutput = embeddedPrompt(canonical.resource.path, recovery, "canonical Comfy output");
  if (embeddedRaw.rawEmbeddedPromptSha256 !== embeddedOutput.rawEmbeddedPromptSha256 || embeddedRaw.canonicalWorkflowSha256 !== embeddedOutput.canonicalWorkflowSha256) fail("raw and canonical output embedded prompt provenance differs");
  const error = recovery.journal.error;
  return {
    schema: 1,
    kind: EVICTED_ATTESTATION_KIND,
    version: EVICTED_ATTESTATION_VERSION,
    stage: recovery.stage,
    candidateId: recovery.candidateId,
    attemptId: recovery.attemptId,
    promptId: recovery.promptId,
    marker,
    queueBindingSha256: hashBytes(Buffer.from(stableJson(recovery.journal.queueBinding))),
    failedJournal,
    errorFingerprint: { message: error, sha256: hashBytes(Buffer.from(error)) },
    rawCapture: { ...rawCapture, width: CANVAS.width, height: CANVAS.height },
    canonicalOutput: { ...canonical.resource, width: CANVAS.width, height: CANVAS.height },
    descriptor: { outputNodeId: OUTPUT_NODE_ID, outputCount: 1, filenamePrefix: "surface", ...canonical.descriptor },
    rawEmbeddedPromptSha256: embeddedRaw.rawEmbeddedPromptSha256,
    canonicalWorkflowSha256: embeddedRaw.canonicalWorkflowSha256,
    current: attestationCurrent(recovery),
    historyEvicted: clone(historyEvicted),
    queueObserved: clone(queueObserved),
    humanReview: clone(humanReview),
    attestedAt,
  };
}

function buildEvictedAttestation({ reportPath, manifestPath, stage, candidate, canonicalOutputPath, historyEvicted, queueObserved, humanReview, attestedAt }) {
  const recovery = inspectSurfaceLegacyCaptureMigration({ reportPath, manifestPath, stage, candidate }); const number = candidateNumber(String(candidate)); const paths = pathsFor(path.resolve(reportPath), stage, number); const queued = readMarker(paths);
  if (!queued || recovery.publication || existsSync(paths.candidateDirectory)) fail("evicted capture attestation requires the exact unpublished legacy attempt");
  return composeEvictedAttestation({ recovery, paths, queued, failedJournal: exactResource(queued.attempt.journalPath, "failed journal"), canonicalOutputPath, historyEvicted, queueObserved, humanReview, attestedAt });
}

function assertEvictedAttestationShape(value) {
  exactKeys(value, ["attemptId", "attestedAt", "candidateId", "canonicalOutput", "canonicalWorkflowSha256", "current", "descriptor", "errorFingerprint", "failedJournal", "historyEvicted", "humanReview", "kind", "marker", "promptId", "queueBindingSha256", "queueObserved", "rawCapture", "rawEmbeddedPromptSha256", "schema", "stage", "version"], "evicted capture attestation");
  exactKeys(value.marker, ["path", "sha256", "size"], "attestation marker"); exactKeys(value.failedJournal, ["path", "sha256", "size"], "attestation failed journal"); exactKeys(value.errorFingerprint, ["message", "sha256"], "attestation error fingerprint");
  exactKeys(value.rawCapture, ["height", "path", "sha256", "size", "width"], "attestation raw capture"); exactKeys(value.canonicalOutput, ["height", "path", "sha256", "size", "width"], "attestation canonical output");
  exactKeys(value.descriptor, ["filename", "filenamePrefix", "outputCount", "outputNodeId", "subfolder", "type"], "attestation descriptor"); exactKeys(value.current, ["currentInput", "editableMask", "preset", "workflowSha256"], "attestation current binding");
  if (value.schema !== 1 || value.kind !== EVICTED_ATTESTATION_KIND || value.version !== EVICTED_ATTESTATION_VERSION) fail("evicted capture attestation version is not approved");
  return value;
}

function failedJournalSnapshotResource(journal, journalPath) {
  const snapshot = clone(journal); for (const key of ["capturedAt", "descriptor", "captureBinding", "recordBase", "publishedAt", "output", "completedAt"]) delete snapshot[key]; snapshot.status = "failed-postqueue";
  if (!exactLegacyPrebindingJournal(snapshot)) fail("completed evicted recovery cannot reconstruct its exact failed journal provenance");
  const bytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`); return { path: path.resolve(journalPath), size: bytes.length, sha256: hashBytes(bytes) };
}

export function validateCompletedSurfaceEvictedAttestation({ reportPath, stage, candidate, journal, marker } = {}) {
  const frozen = journal?.captureBinding?.evictedAttestation; if (!frozen) return null; const number = candidateNumber(String(Number(candidate?.id?.slice(-3)))); const paths = pathsFor(path.resolve(reportPath), stage, number); const queued = readMarker(paths);
  if (!queued || queued.marker.attemptId !== journal.attemptId || stableJson(queued.marker) !== stableJson(marker) || frozen.path !== path.join(queued.attempt.directory, EVICTED_ATTESTATION_FILENAME)) fail(`${stage}/${candidate.id} completed evicted attestation ownership is noncanonical`);
  const resource = exactResource(frozen.path, "completed evicted capture attestation"); if (stableJson(queueResourceIdentity(resource, "completed evicted capture attestation")) !== stableJson(queueResourceIdentity(frozen, "frozen evicted capture attestation"))) fail(`${stage}/${candidate.id} completed evicted attestation bytes changed`);
  const value = assertEvictedAttestationShape(readJson(resource.path, "completed evicted capture attestation")); const recovery = { stage, candidateId: candidate.id, attemptId: journal.attemptId, promptId: journal.promptId, workflow: journal.workflow, journal };
  const expected = composeEvictedAttestation({ recovery, paths, queued, failedJournal: failedJournalSnapshotResource(journal, queued.attempt.journalPath), canonicalOutputPath: value.canonicalOutput.path, historyEvicted: value.historyEvicted, queueObserved: value.queueObserved, humanReview: value.humanReview, attestedAt: value.attestedAt });
  if (stableJson(value) !== stableJson(expected)) fail(`${stage}/${candidate.id} completed evicted attestation differs from terminal immutable provenance`);
  return resource;
}

export function createSurfaceEvictedCaptureAttestation(args = {}) {
  const number = candidateNumber(String(args.candidate)); const destination = evictedAttestationPath(args.reportPath, args.stage, String(number));
  if (args.attestationPath !== undefined && path.resolve(args.attestationPath) !== destination) fail("evicted attestation destination is not the canonical marker-owned attempt path");
  if (existsSync(destination)) fail("evicted capture attestation already exists; refusing to overwrite");
  const value = buildEvictedAttestation({ ...args, candidate: String(number), attestedAt: args.attestedAt ?? Date.now() });
  writeJsonExclusive(destination, value);
  const validated = validateSurfaceEvictedCaptureAttestation({ reportPath: args.reportPath, manifestPath: args.manifestPath, stage: args.stage, candidate: String(number), attestationPath: destination });
  return { attestation: validated.attestation, resource: exactResource(destination, "evicted capture attestation") };
}

export function validateSurfaceEvictedCaptureAttestation(args = {}) {
  const number = candidateNumber(String(args.candidate)); const expectedPath = evictedAttestationPath(args.reportPath, args.stage, String(number)); const suppliedPath = path.resolve(args.attestationPath ?? expectedPath);
  if (!path.isAbsolute(args.attestationPath ?? expectedPath) || suppliedPath !== (args.attestationPath ?? expectedPath) || suppliedPath !== expectedPath) fail("evicted capture attestation path is not the canonical marker-owned path");
  exactResource(suppliedPath, "evicted capture attestation"); const value = assertEvictedAttestationShape(readJson(suppliedPath, "evicted capture attestation"));
  const expected = buildEvictedAttestation({ reportPath: args.reportPath, manifestPath: args.manifestPath, stage: args.stage, candidate: String(number), canonicalOutputPath: value.canonicalOutput.path, historyEvicted: value.historyEvicted, queueObserved: value.queueObserved, humanReview: value.humanReview, attestedAt: value.attestedAt });
  if (stableJson(value) !== stableJson(expected)) fail("evicted capture attestation differs from current immutable provenance");
  return { attestation: value, resource: exactResource(suppliedPath, "evicted capture attestation"), recovery: inspectSurfaceLegacyCaptureMigration({ reportPath: args.reportPath, manifestPath: args.manifestPath, stage: args.stage, candidate: String(number) }) };
}

function validateCurrent({ report, stage, candidate, maskContext }) {
  assertAcceptedTask4Chain(report, stage, maskContext);
  const { ancestors, input } = expectedAncestorsAndInput(report, stage);
  assertResource(input, `${stage} current accepted input`, CANVAS);
  if (report.stages[stage].length !== candidate - 1) fail(`${stage} candidate attempts must serialize as candidate_001 then candidate_002`);
  return { ancestors, input };
}

export async function generateSurfaceStage(args = {}) {
  const reportPath = path.resolve(args.reportPath ?? "");
  const stage = args.stage;
  assertStage(stage);
  const candidate = candidateNumber(args.candidate);
  const migration = legacyCaptureMigration(args.legacyCaptureMigration);
  const evictedAttestationPath = args.evictedAttestationPath === undefined ? null : path.resolve(args.evictedAttestationPath);
  if (migration && evictedAttestationPath) fail("legacy capture migration and evicted attestation recovery are mutually exclusive");
  let report = assertReport(readJson(reportPath, "surface run report"));
  let maskContext = loadMaskContext({ reportPath, report, stage, manifestPath: args.manifestPath });
  validateCurrent({ report, stage, candidate, maskContext });
  const paths = pathsFor(reportPath, stage, candidate);
  if ((migration || evictedAttestationPath) && !existsSync(paths.queuedMarkerPath)) fail(migration ? "legacy capture migration requires its exact durable queued marker" : "evicted capture recovery requires its exact durable queued marker");
  if (!migration && !evictedAttestationPath) mkdirSync(paths.attemptsRoot, { recursive: true });
  const reportLock = await acquireReportMutationLock(reportPath, { timeoutMs: args.lockTimeoutMs ?? 5000, processIdentityProvider: args.processIdentityProvider, purpose: `surface-stage:${stage}:${paths.id}` });
  let attempt;
  let journal;
  let migrationCapturePersisted = false;
  let evictedCapturePersisted = false;
  let trustedCapturePath;
  try {
    report = assertReport(readJson(reportPath, "surface run report"));
    maskContext = loadMaskContext({ reportPath, report, stage, manifestPath: args.manifestPath });
    const current = validateCurrent({ report, stage, candidate, maskContext });
    let queued = readMarker(paths);
    if (existsSync(paths.candidateDirectory) && !queued) fail("published candidate has no durable queued prompt marker");
    if (queued) {
      attempt = queued.attempt;
      journal = queued.journal;
      if (migration) inspectSurfaceLegacyCaptureMigration({ reportPath, manifestPath: args.manifestPath, stage, candidate: String(candidate), migration });
      if (evictedAttestationPath) validateSurfaceEvictedCaptureAttestation({ reportPath, manifestPath: args.manifestPath, stage, candidate: String(candidate), attestationPath: evictedAttestationPath });
      const published = loadPublished(paths, attempt.attemptId);
      if (published) {
        const latest = assertReport(readJson(reportPath, "surface run report"));
        const latestMasks = loadMaskContext({ reportPath, report: latest, stage, manifestPath: args.manifestPath });
        if (stableJson(maskContextBinding(latestMasks)) !== stableJson(maskContextBinding(maskContext))) fail("complete mask context changed before published recovery append");
        const latestCurrent = validateCurrent({ report: latest, stage, candidate, maskContext: latestMasks });
        if (stableJson(latestCurrent) !== stableJson(current)) fail("current chain changed before published recovery append");
        assertPublishedBinding({ record: published, journal, marker: queued.marker, current: latestCurrent, maskContext: latestMasks, stage, candidate, paths });
        const next = appendSurfaceCandidate(latest, stage, published);
        writeSurfaceReportAtomic(reportPath, next);
        const publicationStat = statSync(path.join(paths.candidateDirectory, "publication.json"));
        const publishedAt = journal.publishedAt ?? Math.max(journal.createdAt, Math.floor(publicationStat.mtimeMs));
        writeJsonAtomic(attempt.journalPath, { ...journal, status: "completed", promptId: queued.marker.promptId, queuedAt: queued.marker.queuedAt, publishedAt, completedAt: Date.now(), output: published.output });
        return { report: next, candidate: next.stages[stage].at(-1) };
      }
    } else {
      if (migration || evictedAttestationPath) fail(migration ? "legacy capture migration requires its exact durable queued marker" : "evicted capture recovery requires its exact durable queued marker");
      attempt = createAttempt(paths);
      journal = { attemptId: attempt.attemptId, stage, stageRoot: paths.stageRoot, candidateId: paths.id, status: "reserved", createdAt: Date.now() };
      writeJsonAtomic(attempt.journalPath, journal);
    }
    const presetBytes = readFileSync(PRESET_PATH);
    const presetSha256 = hashBytes(presetBytes);
    const preset = JSON.parse(presetBytes.toString("utf8"));
    const uploadRoot = `surface-empty-plate-v2/${stage}/${paths.id}`;
    let adapter;
    let workflow;
    let uploadProvenance;
    let queueBinding;
    let promptId;
    let queuedAt;
    if (queued) {
      promptId = queued.marker.promptId;
      queuedAt = queued.marker.queuedAt;
      if (!journal.workflow || !journal.workflowSha256 || !journal.presetSha256) fail("queued recovery journal lacks frozen workflow provenance");
      queueBinding = queued.marker.queueBinding;
      uploadProvenance = clone(queueBinding.descriptors);
      workflow = compileSurfaceWorkflow(preset, { ...placeholderTokens(stage, candidate), INPUT_IMAGE: uploadProvenance.inputImage, EDITABLE_MASK: uploadProvenance.editableMask });
      const trustedBinding = createQueueBinding({ stage, candidate, id: paths.id, attemptId: attempt.attemptId, currentInput: current.input, editableMask: maskContext.editable, uploadRoot, descriptors: uploadProvenance, presetSha256, workflow });
      if (stableJson(queueBinding) !== stableJson(trustedBinding) || stableJson(journal.queueBinding) !== stableJson(trustedBinding) || stableJson(journal.uploads) !== stableJson(uploadProvenance) || stableJson(journal.workflow) !== stableJson(workflow) || journal.workflowSha256 !== trustedBinding.approvedWorkflowSha256 || journal.presetSha256 !== presetSha256) fail("queued recovery marker/upload/resource/workflow binding changed");
      assertApprovedCompiledWorkflow(workflow, { stage, candidate, uploads: uploadProvenance, id: paths.id });
      if (migration) {
        probePng(attempt.rawPath, CANVAS); const rawStats = statSync(attempt.rawPath); const rawSha256 = sha256File(attempt.rawPath); if (rawStats.size !== migration.rawSize || rawSha256 !== migration.rawSha256) fail("legacy capture migration raw size/hash changed");
        adapter = args.adapter ?? createComfyAdapter({ baseUrl: args.baseUrl ?? process.env.COMFYUI_URL ?? "http://127.0.0.1:8188" }); const temporaryCapture = path.join(attempt.directory, `.legacy-capture.${process.pid}.${randomUUID()}.png`);
        let keepTemporaryCapture = false;
        try {
          const captured = await adapter.capture({ promptId, outputNodeId: OUTPUT_NODE_ID, filenamePrefix: "surface", expectedSubfolder: `${stage}/${paths.id}`, destination: temporaryCapture, expectedGeometry: CANVAS, expectedWorkflow: workflow }); const descriptor = assertCapture(captured, promptId, temporaryCapture, `${stage}/${paths.id}`); const temporaryStats = statSync(temporaryCapture); const temporarySha256 = sha256File(temporaryCapture); if (temporaryStats.size !== rawStats.size || temporarySha256 !== rawSha256) fail("legacy capture migration temp bytes do not exactly match the frozen raw PNG"); const currentRawStats = statSync(attempt.rawPath); if (currentRawStats.size !== rawStats.size || sha256File(attempt.rawPath) !== rawSha256) fail("legacy capture migration raw changed during GET capture");
          journal = { ...journal, capturedAt: Date.now(), descriptor, captureBinding: captureBinding({ descriptor, expectedSubfolder: `${stage}/${paths.id}`, attemptId: attempt.attemptId, promptId, workflowSha256: journal.workflowSha256, queueBinding: journal.queueBinding }) }; writeJsonAtomic(attempt.journalPath, journal); migrationCapturePersisted = true; trustedCapturePath = temporaryCapture; keepTemporaryCapture = true;
        } finally { if (!keepTemporaryCapture) rmSync(temporaryCapture, { force: true }); }
      }
      if (evictedAttestationPath) {
        let validated = validateSurfaceEvictedCaptureAttestation({ reportPath, manifestPath: args.manifestPath, stage, candidate: String(candidate), attestationPath: evictedAttestationPath });
        await assertEvictedRecoveryRemoteState({ endpoint: args.baseUrl ?? process.env.COMFYUI_URL ?? "http://127.0.0.1:8188", fetchImpl: args.fetchImpl ?? fetch, promptId });
        validated = validateSurfaceEvictedCaptureAttestation({ reportPath, manifestPath: args.manifestPath, stage, candidate: String(candidate), attestationPath: evictedAttestationPath });
        const descriptor = canonicalSurfaceCaptureDescriptor({ filename: validated.attestation.descriptor.filename, subfolder: validated.attestation.descriptor.subfolder, type: validated.attestation.descriptor.type }, `${stage}/${paths.id}`);
        journal = { ...journal, capturedAt: Date.now(), descriptor, captureBinding: captureBinding({ descriptor, expectedSubfolder: `${stage}/${paths.id}`, attemptId: attempt.attemptId, promptId, workflowSha256: journal.workflowSha256, queueBinding: journal.queueBinding, evictedAttestation: validated.resource }) };
        writeJsonAtomic(attempt.journalPath, journal); evictedCapturePersisted = true;
      }
      if (existsSync(attempt.rawPath)) assertStoredCaptureProvenance(journal, `${stage}/${paths.id}`, `${stage}/${paths.id} raw capture recovery`);
      journal = { ...journal, status: "queued", promptId, queuedAt };
      writeJsonAtomic(attempt.journalPath, journal);
      if (!evictedAttestationPath) { adapter ??= args.adapter ?? createComfyAdapter({ baseUrl: args.baseUrl ?? process.env.COMFYUI_URL ?? "http://127.0.0.1:8188" }); const objectInfo = await adapter.objectInfo(); assertWorkflowObjectInfo(workflow, objectInfo); }
    } else {
      adapter = args.adapter ?? createComfyAdapter({ baseUrl: args.baseUrl ?? process.env.COMFYUI_URL ?? "http://127.0.0.1:8188" });
      const objectInfo = await adapter.objectInfo();
      const preflight = compileSurfaceWorkflow(preset, placeholderTokens(stage, candidate));
      assertWorkflowObjectInfo(preflight, objectInfo);
      const inputUpload = await adapter.uploadImage({ filePath: current.input.path, role: "current_accepted_input", subfolder: uploadRoot });
      const maskUpload = await adapter.uploadImage({ filePath: maskContext.editable.path, role: `${stage}_editable_mask`, subfolder: uploadRoot });
      uploadProvenance = { inputImage: inputUpload, editableMask: maskUpload };
      workflow = compileSurfaceWorkflow(preset, { ...placeholderTokens(stage, candidate), INPUT_IMAGE: inputUpload, EDITABLE_MASK: maskUpload });
      assertWorkflowObjectInfo(workflow, objectInfo);
      const workflowSha256 = hashBytes(Buffer.from(`${JSON.stringify(workflow)}\n`));
      queueBinding = createQueueBinding({ stage, candidate, id: paths.id, attemptId: attempt.attemptId, currentInput: current.input, editableMask: maskContext.editable, uploadRoot, descriptors: uploadProvenance, presetSha256, workflow });
      journal = { ...journal, status: "queueing", presetSha256, workflowSha256, workflow, uploads: uploadProvenance, queueBinding };
      writeJsonAtomic(attempt.journalPath, journal);
      try {
        const queuedResult = await adapter.queue(workflow, { onQueued: async (facts) => {
          promptId = String(facts?.promptId ?? "").trim(); queuedAt = facts?.queuedAt;
          if (!promptId || !Number.isSafeInteger(queuedAt) || queuedAt < 0) fail("queue returned invalid prompt provenance");
          writeJsonExclusive(paths.queuedMarkerPath, { attemptId: attempt.attemptId, promptId, queuedAt, queueBinding });
          args.afterQueuedMarkerFsync?.({ markerPath: paths.queuedMarkerPath, promptId, queuedAt, attemptId: attempt.attemptId });
          args.afterQueuedMarker?.({ markerPath: paths.queuedMarkerPath, promptId, queuedAt, attemptId: attempt.attemptId });
          journal = { ...journal, status: "queued", promptId, queuedAt, presetSha256, workflowSha256, workflow };
          writeJsonAtomic(attempt.journalPath, journal);
        } });
        if (!promptId) { promptId = String(queuedResult?.promptId ?? "").trim(); queuedAt = queuedResult?.queuedAt; }
      } catch (error) {
        if (!existsSync(paths.queuedMarkerPath) && typeof error?.promptId === "string" && error.promptId.trim()) {
          promptId = error.promptId.trim(); queuedAt = Number.isSafeInteger(error.queuedAt) ? error.queuedAt : Date.now();
          writeJsonExclusive(paths.queuedMarkerPath, { attemptId: attempt.attemptId, promptId, queuedAt, queueBinding });
          journal = { ...journal, status: "queued", promptId, queuedAt, presetSha256, workflowSha256, workflow };
        }
        throw error;
      }
      const marker = readMarker(paths);
      if (!marker || marker.marker.promptId !== promptId) fail("prompt ID was not durably persisted immediately after queue");
    }
    if (!existsSync(attempt.rawPath)) {
      if (evictedAttestationPath) fail("evicted recovery attestation does not own a frozen raw capture");
      const captured = await adapter.capture({ promptId, outputNodeId: OUTPUT_NODE_ID, filenamePrefix: "surface", expectedSubfolder: `${stage}/${paths.id}`, destination: attempt.rawPath, expectedGeometry: CANVAS });
      const descriptor = assertCapture(captured, promptId, attempt.rawPath, `${stage}/${paths.id}`);
      journal = { ...journal, status: "captured", capturedAt: Date.now(), descriptor, captureBinding: captureBinding({ descriptor, expectedSubfolder: `${stage}/${paths.id}`, attemptId: attempt.attemptId, promptId, workflowSha256: journal.workflowSha256, queueBinding: journal.queueBinding }) };
      writeJsonAtomic(attempt.journalPath, journal);
    } else { probePng(attempt.rawPath, CANVAS); assertStoredCaptureProvenance(journal, `${stage}/${paths.id}`, `${stage}/${paths.id} raw capture recovery`); }
    const selectedModels = models(workflow);
    assertApprovedModels(selectedModels, `${stage} ${paths.id}`);
    const recordBase = {
      id: paths.id,
      input: clone(current.input),
      masks: { editable: clone(maskContext.editable), protected: clone(maskContext.protected), overlap: clone(maskContext.overlap) },
      maskManifest: clone(maskContext.manifestResource),
      prompt: STAGE_PROMPTS[stage], negativePrompt: STAGE_NEGATIVE_PROMPT,
      seed: SURFACE_SEEDS[stage][candidate - 1],
      preset: { path: PRESET_PATH, sha256: presetSha256 },
      model: { name: selectedModels.unet, sha256: hashBytes(Buffer.from(stableJson(selectedModels))) },
      models: selectedModels,
      uploads: uploadProvenance,
      capture: clone(journal.captureBinding),
      promptId,
      ancestors: current.ancestors,
    };
    journal = { ...journal, status: "ready-to-publish", recordBase };
    writeJsonAtomic(attempt.journalPath, journal);
    const record = renderPublishedArtifacts({ input: current.input, raw: trustedCapturePath ?? attempt.rawPath, mask: maskContext.editable, paths, attempt, candidateRecordBase: recordBase, workflow });
    args.afterPublication?.({ candidateDirectory: paths.candidateDirectory, attemptId: attempt.attemptId });
    journal = { ...journal, status: "published", publishedAt: Date.now(), output: record.output };
    writeJsonAtomic(attempt.journalPath, journal);
    const latest = assertReport(readJson(reportPath, "surface run report"));
    const latestMasks = loadMaskContext({ reportPath, report: latest, stage, manifestPath: args.manifestPath });
    const latestCurrent = validateCurrent({ report: latest, stage, candidate, maskContext: latestMasks });
    if (stableJson(latestCurrent.input) !== stableJson(current.input) || stableJson(latestCurrent.ancestors) !== stableJson(current.ancestors) || stableJson(maskContextBinding(latestMasks)) !== stableJson(maskContextBinding(maskContext))) fail("complete source/mask/review/report state changed before append");
    const next = appendSurfaceCandidate(latest, stage, record);
    writeSurfaceReportAtomic(reportPath, next);
    journal = { ...journal, status: "completed", completedAt: Date.now(), output: record.output };
    writeJsonAtomic(attempt.journalPath, journal);
    return { report: next, candidate: next.stages[stage].at(-1) };
  } catch (error) {
    if (!(migration && !migrationCapturePersisted) && !(evictedAttestationPath && !evictedCapturePersisted) && attempt?.journalPath && existsSync(attempt.journalPath)) {
      const currentJournal = readJson(attempt.journalPath, "attempt journal");
      if (!['completed', 'published'].includes(currentJournal.status)) writeJsonAtomic(attempt.journalPath, { ...currentJournal, status: existsSync(paths.queuedMarkerPath) ? "failed-postqueue" : "failed-prequeue", failedAt: Date.now(), error: error.message });
    }
    throw error;
  } finally { if (trustedCapturePath) rmSync(trustedCapturePath, { force: true }); releaseReportMutationLock(reportLock); }
}
