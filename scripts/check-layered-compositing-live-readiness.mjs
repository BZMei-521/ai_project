import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertWorkflowObjectInfo, compileWorkflow } from "./lib/layered-compositing-comfy.mjs";
import { assertRunInvariant, sha256File } from "./lib/layered-compositing-run.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PRESET_ROOT = path.join(ROOT, "src", "modules", "comfy-pipeline", "presets");
const OUTPUT_ROOT = path.join(ROOT, "logs", "layered-two-character-sample");
const REPORT_PATH = path.join(OUTPUT_ROOT, "run-report.json");
const APPROVED_ROOT = "C:/Users/Administrator/Desktop/ai_project/logs";
const MIN_FREE_BYTES = 10 * 1024 ** 3;

const INPUTS = Object.freeze([
  { key: "mother_frame", path: "C:/Users/Administrator/AppData/Local/Comfy-Desktop/ComfyUI-Shared/output/Storyboard/河边远景建立_klein_ref_00006_.png", sha256: "58b8909ca4dc0d94a53e7bda09e46d134fc2f5b9246f04679aac4d585df7a620", width: 1152, height: 640 },
  { key: "shen_face_body", path: `${APPROVED_ROOT}/shen-yan-zimage-hero-v1/hero-2026080913.png`, sha256: "bb93213df418213e41cb1206e397056cbb45e34ed446274307f531f658713043" },
  { key: "shen_front", path: `${APPROVED_ROOT}/shen-yan-hybrid-v5/front.png`, sha256: "725d59ac4598898dcfda080f505a77b9acf31ea046426ed2322ce15596cbb40e" },
  { key: "shen_side", path: `${APPROVED_ROOT}/shen-yan-hybrid-v5/side.png`, sha256: "2a0ed3ef0dd1ce290f2f66d1f558d754d37a1e239b092c3189a431bf7ba2b861" },
  { key: "shen_back", path: `${APPROVED_ROOT}/shen-yan-hybrid-v5/back.png`, sha256: "2abafd0d96d0beb77441760a37872f367f4f3af0fcea4721176a313bd0a76195" },
  { key: "jiang_face_body", path: `${APPROVED_ROOT}/jiang-lan-zimage-hero-v2/hero-2026080931.png`, sha256: "a3a6aaf2dee6a3e64f2b34867752eb54d2b9a941ea97c0f30958d2deb21a3fb6" },
  { key: "jiang_front", path: `${APPROVED_ROOT}/jiang-lan-hybrid-v1/front.png`, sha256: "200f1e4a36dda8afac7b0b345fcf00e74bbc345638d02a3fc854b2775c3b079f" },
  { key: "jiang_side", path: `${APPROVED_ROOT}/jiang-lan-hybrid-v1/side.png`, sha256: "1d4f36800a4115047dcbbc98b4ed100f5d9be414247b04c5bac62c13ccbf5bb2" },
  { key: "jiang_back", path: `${APPROVED_ROOT}/jiang-lan-hybrid-v1/back.png`, sha256: "9d77dac1faaa23c444fc04fc27469c8fdfdc0bf4c5f4261252ab9fed1c7e3075" },
]);

const PRESETS = Object.freeze([
  { name: "Task2 pose", file: "layered-pose-sdpose-v1.json", outputs: { "3": "PreviewImage", "4": "SavePoseKpsAsJsonFile" } },
  { name: "Task3 empty plate", file: "layered-empty-plate-qwen-v1.json", outputs: { "20": "SaveImage" } },
  { name: "Task3 character", file: "layered-character-qwen-v1.json", outputs: { "30": "SaveImage" } },
  { name: "Task4 matte", file: "layered-birefnet-matte-v1.json", outputs: { "6": "SaveImage" } },
  { name: "Task6 local repair", file: "layered-local-repair-qwen-v1.json", outputs: { "20": "SaveImage" } },
]);

function fail(message) { throw new Error(`Layered live readiness: ${message}`); }
function readJson(filePath, label) { try { return JSON.parse(readFileSync(filePath, "utf8")); } catch { fail(`${label} is missing or malformed: ${filePath}`); } }
function exactHash(filePath, expected, label) { if (!existsSync(filePath) || !statSync(filePath).isFile() || statSync(filePath).size <= 0) fail(`${label} is missing or empty: ${filePath}`); const actual = sha256File(filePath); if (actual !== expected) fail(`${label} hash mismatch: expected ${expected}, got ${actual}`); return { path: path.resolve(filePath), size: statSync(filePath).size, sha256: actual }; }
function run(command, args) { const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 }); if (result.error || result.status !== 0) fail(`${command} failed: ${String(result.error?.message ?? result.stderr ?? result.stdout).trim()}`); return result.stdout; }
function toolVersion(command) { return run(command, ["-version"]).split(/\r?\n/, 1)[0].trim(); }
function probePng(filePath, expected = null) { const stream = readJsonOutput(run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "json", filePath]), filePath)?.streams?.[0]; if (stream?.codec_type !== "video" || stream.codec_name !== "png" || !Number.isSafeInteger(stream.width) || !Number.isSafeInteger(stream.height) || stream.width <= 0 || stream.height <= 0) fail(`resource is not a real decodable PNG: ${filePath}`); if (expected && (stream.width !== expected.width || stream.height !== expected.height)) fail(`${filePath} must be ${expected.width}x${expected.height}, got ${stream.width}x${stream.height}`); run("ffmpeg", ["-v", "error", "-i", filePath, "-frames:v", "1", "-f", "null", "-"]); return { codec: stream.codec_name, width: stream.width, height: stream.height }; }
function readJsonOutput(value, label) { try { return JSON.parse(value); } catch { fail(`${label} returned malformed JSON`); } }
function manifestCandidate(manifest, outputPath, sha256, label) { if (manifest?.schemaVersion !== 1 || manifest?.species !== "human" || typeof manifest.characterAssetId !== "string" || !manifest.characterAssetId) fail(`${label} identity metadata/species is invalid`); const item = manifest.candidates?.find((candidate) => candidate.outputPath === outputPath); if (!item || item.sha256 !== sha256) fail(`${label} does not freeze ${outputPath} at the approved hash`); }

function validateIdentityMetadata() {
  const shenHero = readJson(`${APPROVED_ROOT}/shen-yan-zimage-hero-v1/hero-manifest.json`, "Shen hero manifest");
  const shenPack = readJson(`${APPROVED_ROOT}/shen-yan-hybrid-v5/hybrid-candidate-manifest.json`, "Shen approved pack manifest");
  const shenMigration = readJson(`${APPROVED_ROOT}/shen-yan-hybrid-v5/migration-manifest.json`, "Shen structure manifest");
  const jiangHero = readJson(`${APPROVED_ROOT}/jiang-lan-zimage-hero-v2/hero-manifest.json`, "Jiang hero manifest");
  const jiangPack = readJson(`${APPROVED_ROOT}/jiang-lan-hybrid-v1/manifest.json`, "Jiang approved pack manifest");
  manifestCandidate(shenHero, "hero-2026080913.png", INPUTS[1].sha256, "Shen hero manifest");
  manifestCandidate(jiangHero, "hero-2026080931.png", INPUTS[5].sha256, "Jiang hero manifest");
  if (shenPack.status !== "approved" || shenPack.species !== "human" || shenPack.characterAssetId !== shenHero.characterAssetId) fail("Shen approved pack identity metadata mismatch");
  if (shenMigration.species !== "human" || shenMigration.characterAssetId !== shenHero.characterAssetId) fail("Shen structure identity metadata mismatch");
  for (const input of INPUTS.slice(2, 5)) { const name = path.basename(input.path); const item = shenMigration.candidates?.find((candidate) => candidate.outputPath === name); if (!item || item.outputSha256 !== input.sha256) fail(`Shen structure manifest hash mismatch for ${name}`); }
  if (jiangPack.status !== "approved_for_project_import" || jiangPack.species !== "human" || jiangPack.characterAssetId !== jiangHero.characterAssetId) fail("Jiang approved pack identity metadata mismatch");
  for (const input of INPUTS.slice(6, 9)) { const name = path.basename(input.path); const item = jiangPack.candidates?.find((candidate) => candidate.outputPath === name); if (!item || item.sha256 !== input.sha256) fail(`Jiang structure manifest hash mismatch for ${name}`); }
  return { shen: { species: "human", characterAssetId: shenHero.characterAssetId, pack: shenPack.proposedIdentityPackVersion }, jiang: { species: "human", characterAssetId: jiangHero.characterAssetId, pack: jiangPack.proposedIdentityPackVersion } };
}

function tokensFor(preset) { const names = [...new Set([...JSON.stringify(preset).matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((match) => match[1]))]; const tokens = {}; for (const name of names) { if (name === "SEED") tokens[name] = 1; else if (name === "FILENAME_PREFIX") tokens[name] = "layered-readiness/output"; else if (name === "PROMPT") tokens[name] = "readiness validation"; else tokens[name] = "layered-readiness.png"; } return tokens; }
function validatePresets(objectInfo) { const result = []; for (const definition of PRESETS) { const presetPath = path.join(PRESET_ROOT, definition.file); const bytes = readFileSync(presetPath); const workflow = compileWorkflow(JSON.parse(bytes), tokensFor(JSON.parse(bytes))); assertWorkflowObjectInfo(workflow, objectInfo); for (const [nodeId, classType] of Object.entries(definition.outputs)) if (workflow[nodeId]?.class_type !== classType || !objectInfo[classType]) fail(`${definition.name} output node ${nodeId} must be ${classType}`); result.push({ name: definition.name, file: definition.file, sha256: createHash("sha256").update(bytes).digest("hex"), nodes: Object.keys(workflow).length, outputs: definition.outputs }); }
  const required = ["DWPreprocessor", "LoadBackgroundRemovalModel", "RemoveBackground", "InvertMask", "JoinImageWithAlpha", "UNETLoader", "LoraLoaderModelOnly", "ModelSamplingAuraFlow", "CLIPLoader", "VAELoader", "TextEncodeQwenImageEditPlus", "SaveImage"];
  for (const className of required) if (!objectInfo[className]) fail(`required live class is missing: ${className}`);
  return { presets: result, requiredClasses: required, poseModels: { bbox: "yolox_l.onnx", estimator: "dw-ll_ucoco_384.onnx" }, backgroundRemovalModel: "birefnet.safetensors", qwenModels: { unet: "qwen_image_edit_2511_fp8mixed.safetensors", clip: "qwen_2.5_vl_7b_fp8_scaled.safetensors", vae: "qwen_image_vae.safetensors", lora: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors" } };
}

function activeQueueCount(queue) { const running = Array.isArray(queue?.queue_running) ? queue.queue_running.length : NaN; const pending = Array.isArray(queue?.queue_pending) ? queue.queue_pending.length : NaN; if (!Number.isSafeInteger(running) || !Number.isSafeInteger(pending)) fail("queue response is malformed"); return { running, pending }; }
function assertIdleQueue(queue) { if (queue.running || queue.pending) fail(`Comfy queue is not idle (running=${queue.running}, pending=${queue.pending}); refusing to interrupt or clear it`); }
function same(value, expected) { return JSON.stringify(value) === JSON.stringify(expected); }
function plain(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactRecord(record, label, expectedPath = null) {
  if (!plain(record) || typeof record.path !== "string" || !path.isAbsolute(record.path) || !Number.isSafeInteger(record.size) || record.size <= 0 || !/^[a-f0-9]{64}$/.test(record.sha256 ?? "")) fail(`${label} record is invalid`);
  const resolved = path.resolve(record.path); if (expectedPath !== null && resolved !== path.resolve(expectedPath)) fail(`${label} path is not the exact current path`);
  if (!existsSync(resolved) || !statSync(resolved).isFile()) fail(`${label} path is missing or not a file`);
  const stats = statSync(resolved); if (stats.size !== record.size || sha256File(resolved) !== record.sha256) fail(`${label} current size/hash mismatch`);
  return { path: resolved, size: record.size, sha256: record.sha256 };
}
function coreRecord(record) { return record && { path: path.resolve(record.path), size: record.size, sha256: record.sha256 }; }
function selectedModels(workflow) {
  const models = { unet: null, clip: null, vae: null, lora: null };
  for (const node of Object.values(workflow)) { if (node?.class_type === "UNETLoader") models.unet = node.inputs?.unet_name; if (node?.class_type === "CLIPLoader") models.clip = node.inputs?.clip_name; if (node?.class_type === "VAELoader") models.vae = node.inputs?.vae_name; if (/LoraLoader/.test(node?.class_type ?? "")) models.lora = node.inputs?.lora_name ?? null; }
  return models;
}
const TERMINAL_STAGE = Object.freeze({
  empty_plate: { outputNode: "20", filename: "empty_plate", artifactName: "empty_plate.png", comfyName: "comfy-output.png", promptNode: "14", seedNode: "16" },
  shen_yan: { outputNode: "30", filename: "shen_yan", artifactName: "shen_yan.png", comfyName: "comfy-output.png", promptNode: "24", seedNode: "27" },
  jiang_lan: { outputNode: "30", filename: "jiang_lan", artifactName: "jiang_lan.png", comfyName: "comfy-output.png", promptNode: "24", seedNode: "27" },
  shen_yan_matte: { outputNode: "6", filename: "transparent", comfyField: "transparentPng" },
  jiang_lan_matte: { outputNode: "6", filename: "transparent", comfyField: "transparentPng" },
  final: { outputNode: "20", filename: "raw-repair", comfyField: "rawRepair" },
});
function terminal(candidate, stage) {
  if (!plain(candidate) || candidate.invalidations?.length) return false;
  if (stage.endsWith("_matte")) return candidate.state === "technical" && candidate.technicalAcceptance === "accepted";
  return ["accepted", "rejected"].includes(candidate.state) && candidate.creativeAcceptance === candidate.state && candidate.technicalAcceptance === "accepted" && candidate.review?.decision === candidate.state;
}
function validateHistory({ history, promptId, candidate, stage, id, config }) {
  if (!plain(history) || Object.keys(history).length !== 1 || !plain(history[promptId])) fail(`terminal marker history for ${promptId} is missing or ambiguous`);
  const entry = history[promptId]; if (entry.status?.completed !== true || entry.status?.status_str !== "success") fail(`terminal marker history for ${promptId} is not completed/success`);
  const prompt = entry.prompt; if (!Array.isArray(prompt) || prompt[1] !== promptId || !plain(prompt[2]) || !plain(prompt[3]) || !Number.isSafeInteger(prompt[3].create_time)) fail("terminal marker history prompt provenance is invalid");
  const workflow = prompt[2]; const workflowSha256 = createHash("sha256").update(`${JSON.stringify(workflow)}\n`).digest("hex"); if (workflowSha256 !== candidate.workflowSha256) fail("terminal marker workflow hash does not match current history bytes");
  if (stage.endsWith("_matte")) { const removers = Object.values(workflow).filter((node) => node?.class_type === "LoadBackgroundRemovalModel"); if (removers.length !== 1 || removers[0].inputs?.bg_removal_name !== candidate.model) fail("terminal marker background-removal model does not match history workflow"); }
  else if (!same(selectedModels(workflow), candidate.models)) fail("terminal marker model selections do not match history workflow");
  if (workflow[config.outputNode]?.class_type !== "SaveImage" || workflow[config.outputNode]?.inputs?.filename_prefix !== `${stage}/${id}/${config.filename}`) fail("terminal marker SaveImage node/prefix binding is invalid");
  if (!Array.isArray(prompt[4]) || prompt[4].length !== 1 || String(prompt[4][0]) !== config.outputNode) fail("terminal marker history output-node binding is invalid");
  const outputs = entry.outputs; if (!plain(outputs) || Object.keys(outputs).length !== 1 || !plain(outputs[config.outputNode])) fail("terminal marker history SaveImage output is missing or duplicated");
  const images = outputs[config.outputNode].images; if (!Array.isArray(images) || images.length !== 1) fail("terminal marker history image descriptor is missing or duplicated");
  const image = images[0]; const subfolder = String(image?.subfolder ?? "").replaceAll("\\", "/"); if (image?.type !== "output" || subfolder !== `${stage}/${id}` || typeof image.filename !== "string" || path.basename(image.filename) !== image.filename || !new RegExp(`^${config.filename}_[^/\\\\]+\\.png$`).test(image.filename)) fail("terminal marker history SaveImage descriptor binding is invalid");
  if (candidate.seed !== undefined && workflow[config.seedNode]?.inputs?.seed !== candidate.seed) fail("terminal marker seed provenance does not match history workflow");
  if (candidate.prompt !== undefined && workflow[config.promptNode]?.inputs?.prompt !== candidate.prompt) fail("terminal marker prompt provenance does not match history workflow");
}
async function validateTerminalMarker({ markerPath, outputRoot, report, journals, baseUrl, fetchImpl }) {
  const resolvedMarker = path.resolve(markerPath); const relative = path.relative(path.resolve(outputRoot), resolvedMarker); const parts = relative.split(path.sep); const match = /^\.(candidate_00[1-3])\.queued$/.exec(parts.at(-1) ?? "");
  if (parts.length !== 2 || relative.startsWith("..") || path.isAbsolute(relative) || !match || !statSync(resolvedMarker).isFile()) fail(`queued marker path is unsafe or not a regular stage marker: ${markerPath}`);
  const stage = parts[0]; const id = match[1]; const config = TERMINAL_STAGE[stage]; if (!config || !plain(report.stages?.[stage]) || !Array.isArray(report.stages[stage].candidates)) fail(`queued marker stage is unsupported: ${stage}`);
  const marker = readJson(resolvedMarker, "queued marker"); if (!plain(marker) || Object.keys(marker).length !== 2 || typeof marker.promptId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(marker.promptId) || !Number.isSafeInteger(marker.queuedAt) || marker.queuedAt <= 0) fail("queued marker JSON is not the strict promptId/queuedAt contract");
  const candidates = report.stages[stage].candidates.filter((value) => value.id === id && terminal(value, stage)); if (candidates.length !== 1 || report.stages[stage].candidates.filter((value) => value.id === id).length !== 1) fail(`queued marker requires exactly one terminal report candidate for ${stage}/${id}`); const candidate = candidates[0];
  if (candidate.promptId !== marker.promptId || candidate.workflowVersion !== 1 || !/^[a-f0-9]{64}$/.test(candidate.presetSha256 ?? "") || !/^[a-f0-9]{64}$/.test(candidate.workflowSha256 ?? "")) fail("queued marker candidate prompt/workflow provenance is invalid");
  const completed = journals.filter((journal) => journal.value.status === "completed" && journal.value.stage === stage && journal.value.candidateId === id); if (completed.length !== 1) fail(`queued marker requires exactly one completed journal for ${stage}/${id}`); const journal = completed[0];
  if (journal.value.stage !== stage || journal.value.candidateId !== id || journal.value.promptId !== marker.promptId || journal.value.queuedAt !== marker.queuedAt || journal.value.presetSha256 !== candidate.presetSha256 || journal.value.workflowSha256 !== candidate.workflowSha256 || !same(journal.value.artifact, candidate.artifact)) fail("queued marker journal provenance does not exactly match marker/candidate");
  exactRecord(candidate.artifact, "terminal candidate artifact", path.join(outputRoot, stage, id, config.artifactName ?? path.basename(candidate.artifact.path)));
  const captured = config.comfyField ? candidate[config.comfyField] : candidate.comfyOutput; if (!captured) fail("terminal candidate lacks its captured Comfy output record");
  const expectedCaptured = config.comfyName ? path.join(path.dirname(journal.path), config.comfyName) : captured.path; exactRecord(captured, "terminal candidate Comfy output", expectedCaptured);
  if (stage === "empty_plate") {
    exactRecord(report.source, "terminal source"); exactRecord(candidate.removalMask, "terminal removal mask");
    if (!same(coreRecord(candidate.references?.source), coreRecord(report.source)) || !same(coreRecord(candidate.references?.removalMask), coreRecord(candidate.removalMask))) fail("terminal empty-plate input provenance does not match current source/mask records");
  }
  const history = await getJson(baseUrl, `/history/${encodeURIComponent(marker.promptId)}`, fetchImpl); validateHistory({ history, promptId: marker.promptId, candidate, stage, id, config });
  return { path: resolvedMarker, stage, candidateId: id, promptId: marker.promptId, queuedAt: marker.queuedAt, journalPath: journal.path, status: "terminal-owned" };
}
function scanResumabilityEntries(outputRoot) {
  const ambiguous = []; const markers = []; const journals = []; const knownStatuses = new Set(["reserved", "queued", "ready-to-publish", "published", "completed", "failed", "failed-prequeue", "failed-postqueue", "abandoned"]); const activeStatuses = new Set(["reserved", "queued", "ready-to-publish", "published", "failed-postqueue"]);
  const walk = (directory) => { for (const entry of readdirSync(directory, { withFileTypes: true })) { const child = path.join(directory, entry.name); if (/\.lock$|\.queue-entry$/.test(entry.name)) ambiguous.push({ path: child, status: "marker-or-lock" }); else if (entry.name.endsWith(".queued")) { if (entry.isFile()) markers.push(child); else ambiguous.push({ path: child, status: "marker-or-lock" }); } else if (entry.isDirectory()) walk(child); else if (entry.name === "attempt.json") { const relative = path.relative(path.resolve(outputRoot), path.resolve(child)).split(path.sep); const canonical = relative.length === 5 && relative[1] === "attempts" && /^candidate_00[1-3]$/.test(relative[2]) && relative[3].length > 0 && relative[4] === "attempt.json"; const attempt = readJson(child, "attempt journal"); if (!canonical || !plain(attempt) || !knownStatuses.has(attempt.status)) ambiguous.push({ path: child, status: canonical ? "unknown-attempt-status" : "noncanonical-attempt-journal" }); else { const expectedStage = relative[0]; const expectedCandidate = relative[2]; if (attempt.stage !== expectedStage || attempt.candidateId !== expectedCandidate) ambiguous.push({ path: child, status: "mismatched-attempt-provenance" }); else { journals.push({ path: child, value: attempt }); if (activeStatuses.has(attempt.status)) ambiguous.push({ path: child, status: attempt.status }); } } } } };
  walk(outputRoot);
  const completed = new Map(); for (const journal of journals.filter((value) => value.value.status === "completed")) { const key = `${journal.value.stage}:${journal.value.candidateId}`; const values = completed.get(key) ?? []; values.push(journal.path); completed.set(key, values); }
  for (const [key, paths] of completed) if (paths.length !== 1) for (const journalPath of paths) ambiguous.push({ path: journalPath, status: `duplicate-completed-journal:${key}` });
  return { ambiguous, markers, journals };
}
async function validateResumability(outputRoot = OUTPUT_ROOT, { queue, baseUrl, fetchImpl } = {}) {
  assertIdleQueue(queue); if (!existsSync(outputRoot)) return { decision: "fresh", path: outputRoot, reason: "output directory is absent" }; if (!statSync(outputRoot).isDirectory() || !existsSync(path.join(outputRoot, "run-report.json"))) fail("output path is unknown or lacks run-report.json; refusing overwrite"); const reportPath = path.join(outputRoot, "run-report.json"); const report = readJson(reportPath, "existing run report"); const pending = structuredClone(report); pending.overallStatus = "pending"; try { assertRunInvariant(pending, { isDecodable(filePath) { try { probePng(filePath); return true; } catch { return false; } } }); } catch (error) { fail(`existing report is not invariant-valid/current: ${error.message}`); }
  const { ambiguous, markers, journals } = scanResumabilityEntries(outputRoot); if (ambiguous.length) fail(`existing run has ambiguous active attempts/markers: ${ambiguous.map((item) => `${item.status}:${item.path}`).join(", ")}`);
  const terminalMarkers = []; for (const markerPath of markers) terminalMarkers.push(await validateTerminalMarker({ markerPath, outputRoot, report, journals, baseUrl, fetchImpl }));
  return { decision: "resume", path: outputRoot, reportPath, reportSha256: sha256File(reportPath), overallStatus: report.overallStatus, terminalMarkers, reason: `report is invariant-valid/current; ${terminalMarkers.length} retained queue marker(s) are terminal and fully bound` };
}

function nearestExisting(directory) { let current = path.resolve(directory); while (!existsSync(current)) { const parent = path.dirname(current); if (parent === current) fail(`cannot resolve output volume for ${directory}`); current = parent; } return current; }
function sanitizeEndpoint(value) { let url; try { url = new URL(value); } catch { fail("COMFYUI_URL must be a valid HTTP URL"); } if (!/^https?:$/.test(url.protocol)) fail("COMFYUI_URL must use HTTP(S)"); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString().replace(/\/$/, ""); }
async function getJson(baseUrl, route, fetchImpl) { const response = await fetchImpl(`${baseUrl}${route}`, { method: "GET", signal: AbortSignal.timeout(15000) }); if (!response?.ok) fail(`GET ${route} failed with HTTP ${response?.status ?? "unknown"}`); return response.json(); }

export async function checkReadiness({ endpoint = process.env.COMFYUI_URL ?? "http://127.0.0.1:8188", fetchImpl = fetch, outputRoot = OUTPUT_ROOT } = {}) {
  const result = { status: "CHECKING", checkedAt: new Date().toISOString(), endpoint: null, system: null, disk: null, tools: null, inputs: [], identities: null, inventory: null, queue: null, resumability: null };
  try {
    const safeEndpoint = sanitizeEndpoint(endpoint); result.endpoint = safeEndpoint;
    result.tools = { ffmpeg: toolVersion("ffmpeg"), ffprobe: toolVersion("ffprobe") };
    for (const input of INPUTS) result.inputs.push({ ...exactHash(input.path, input.sha256, input.key), ...probePng(input.path, input.width ? { width: input.width, height: input.height } : null), key: input.key });
    result.identities = validateIdentityMetadata();
    const diskStats = statfsSync(nearestExisting(outputRoot), { bigint: true }); const diskFreeBytes = Number(diskStats.bavail * diskStats.bsize); result.disk = { path: path.resolve(outputRoot), freeBytes: diskFreeBytes, minimumBytes: MIN_FREE_BYTES }; if (!Number.isSafeInteger(diskFreeBytes) || diskFreeBytes < MIN_FREE_BYTES) fail(`output volume needs at least 10 GiB free; found ${diskFreeBytes} bytes`);
    const systemStats = await getJson(safeEndpoint, "/system_stats", fetchImpl); const devices = Array.isArray(systemStats?.devices) ? systemStats.devices.map((device) => ({ name: String(device?.name ?? "unknown"), type: String(device?.type ?? "unknown"), vramTotalBytes: Number(device?.vram_total ?? 0), vramFreeBytes: Number(device?.vram_free ?? 0) })) : []; result.system = { os: String(systemStats?.system?.os ?? "unknown"), comfyuiVersion: String(systemStats?.system?.comfyui_version ?? "unknown"), devices }; if (!devices.length) fail("system_stats returned no compute devices");
    const objectInfo = await getJson(safeEndpoint, "/object_info", fetchImpl);
    result.queue = activeQueueCount(await getJson(safeEndpoint, "/queue", fetchImpl)); assertIdleQueue(result.queue);
    result.resumability = await validateResumability(outputRoot, { queue: result.queue, baseUrl: safeEndpoint, fetchImpl });
    result.inventory = validatePresets(objectInfo);
    result.status = "READY";
  } catch (error) { result.status = "NOT_READY"; result.failure = error.message; }
  return result;
}

async function selfTest() {
  assert.equal(activeQueueCount({ queue_running: [], queue_pending: [] }).running, 0);
  assert.throws(() => activeQueueCount({ queue_running: [{}], queue_pending: "bad" }), /malformed/);
  assert.equal(sanitizeEndpoint("http://user:secret@127.0.0.1:8188/?token=secret"), "http://127.0.0.1:8188");
  assert.equal((await validateResumability(path.join(ROOT, `.readiness-self-test-missing-${process.pid}`), { queue: { running: 0, pending: 0 }, baseUrl: "http://127.0.0.1", fetchImpl: async () => { throw new Error("fresh run must not fetch history"); } })).decision, "fresh");

  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "layered-readiness-terminal-"));
  const promptId = "11111111-2222-4333-8444-555555555555";
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const current = (filePath) => { const bytes = readFileSync(filePath); return { path: path.resolve(filePath), size: bytes.length, sha256: sha(bytes) }; };
  let fixtureIndex = 0;
  const fixture = (mutate = () => {}) => {
    fixtureIndex += 1;
    const outputRoot = path.join(temporaryRoot, `fixture-${fixtureIndex}`); const stage = "empty_plate"; const id = "candidate_001"; const stageRoot = path.join(outputRoot, stage);
    const artifactPath = path.join(stageRoot, id, "empty_plate.png"); const attemptDirectory = path.join(stageRoot, "attempts", id, "attempt-one"); const comfyPath = path.join(attemptDirectory, "comfy-output.png"); const sourcePath = path.join(outputRoot, "source.png"); const maskPath = path.join(outputRoot, "mask.png");
    for (const directory of [path.dirname(artifactPath), attemptDirectory]) mkdirSync(directory, { recursive: true });
    writeFileSync(artifactPath, "published-artifact"); writeFileSync(comfyPath, "captured-comfy-output"); writeFileSync(sourcePath, "mother"); writeFileSync(maskPath, "mask");
    const workflow = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: "qwen.safetensors" } },
      "2": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "lightning.safetensors" } },
      "4": { class_type: "CLIPLoader", inputs: { clip_name: "clip.safetensors" } },
      "5": { class_type: "VAELoader", inputs: { vae_name: "vae.safetensors" } },
      "6": { class_type: "LoadImage", inputs: { image: `layered-compositing/${stage}/${id}/mother_frame.png` } },
      "7": { class_type: "LoadImage", inputs: { image: `layered-compositing/${stage}/${id}/two_person_removal_mask.png` } },
      "14": { class_type: "TextEncodeQwenImageEditPlus", inputs: { image1: ["6", 0], image2: ["7", 0], prompt: "remove people" } },
      "16": { class_type: "KSampler", inputs: { seed: 61034001 } },
      "20": { class_type: "SaveImage", inputs: { images: ["17", 0], filename_prefix: `${stage}/${id}/empty_plate` } },
    };
    const workflowSha256 = sha(Buffer.from(`${JSON.stringify(workflow)}\n`));
    const candidate = { id, artifact: current(artifactPath), comfyOutput: current(comfyPath), promptId, seed: 61034001, workflowVersion: 1, presetSha256: "a".repeat(64), workflowSha256, models: { unet: "qwen.safetensors", clip: "clip.safetensors", vae: "vae.safetensors", lora: "lightning.safetensors" }, removalMask: { ...current(maskPath), role: "fixed-two-person-removal-mask" }, references: { source: { ...current(sourcePath), role: "immutable-mother-frame" }, removalMask: { ...current(maskPath), role: "fixed-two-person-removal-mask" } }, prompt: "remove people", state: "rejected", technicalAcceptance: "accepted", creativeAcceptance: "rejected", review: { decision: "rejected", note: "fixture terminal rejection" } };
    const report = { source: current(sourcePath), stages: { [stage]: { candidates: [candidate] } } };
    const marker = { promptId, queuedAt: 1700000000000 }; const markerPath = path.join(stageRoot, `.${id}.queued`);
    const journal = { attemptId: "attempt-one", stage, candidateId: id, status: "completed", promptId, queuedAt: marker.queuedAt, presetSha256: candidate.presetSha256, workflowSha256, artifact: structuredClone(candidate.artifact) }; const journalPath = path.join(attemptDirectory, "attempt.json");
    const historyEntry = { prompt: [1, promptId, workflow, { create_time: marker.queuedAt }, ["20"]], outputs: { "20": { images: [{ filename: "empty_plate_00001_.png", subfolder: `${stage}\\${id}`, type: "output" }] } }, status: { status_str: "success", completed: true } };
    const state = { outputRoot, stage, id, markerPath, marker, journalPath, journal, report, candidate, history: { [promptId]: historyEntry }, workflow };
    mutate(state);
    writeFileSync(markerPath, `${JSON.stringify(state.marker)}\n`); writeFileSync(journalPath, `${JSON.stringify(state.journal)}\n`);
    const methods = [];
    const fetchImpl = async (url, options) => { methods.push(options?.method); const requested = decodeURIComponent(new URL(url).pathname.split("/").at(-1)); return { ok: true, status: 200, async json() { return state.historyResponse ?? state.history[requested] ? { [requested]: state.history[requested] } : {}; } }; };
    return { ...state, methods, fetchImpl };
  };
  const verify = async (value) => { const scanned = scanResumabilityEntries(value.outputRoot); if (scanned.ambiguous.length) fail(`fixture has ambiguous attempt state: ${scanned.ambiguous.map((item) => item.status).join(",")}`); return validateTerminalMarker({ markerPath: value.markerPath, outputRoot: value.outputRoot, report: value.report, journals: scanned.journals, baseUrl: "http://127.0.0.1", fetchImpl: value.fetchImpl }); };
  const positive = fixture(); const owned = await verify(positive); assert.equal(owned.status, "terminal-owned"); assert.deepEqual(positive.methods, ["GET"]);
  const rejects = async (label, mutation, pattern = /terminal|marker|journal|candidate|history|artifact|workflow|model|output|provenance|attempt|ambiguous|queued|status/i) => { const value = fixture(mutation); await assert.rejects(() => verify(value), pattern, label); assert.equal(value.methods.every((method) => method === "GET"), true, `${label} must remain GET-only`); };
  await rejects("marker prompt mismatch", (value) => { value.marker.promptId = "99999999-2222-4333-8444-555555555555"; });
  await rejects("marker queuedAt mismatch", (value) => { value.marker.queuedAt += 1; });
  await rejects("nonterminal candidate", (value) => { value.candidate.state = "technical"; value.candidate.creativeAcceptance = "pending"; delete value.candidate.review; });
  await rejects("missing completed journal", (value) => { value.journal.status = "queued"; });
  await rejects("duplicate completed journal", (value) => { const duplicate = path.join(path.dirname(path.dirname(value.journalPath)), "attempt-two"); mkdirSync(duplicate, { recursive: true }); writeFileSync(path.join(duplicate, "attempt.json"), `${JSON.stringify({ ...value.journal, attemptId: "attempt-two" })}\n`); });
  await rejects("nested completed journal", (value) => { const nested = path.join(path.dirname(value.journalPath), "nested"); mkdirSync(nested, { recursive: true }); writeFileSync(path.join(nested, "attempt.json"), `${JSON.stringify({ ...value.journal, attemptId: "nested" })}\n`); });
  await rejects("unknown direct journal status", (value) => { value.journal.status = "complete"; });
  await rejects("journal workflow mismatch", (value) => { value.journal.workflowSha256 = "b".repeat(64); });
  await rejects("candidate model mismatch", (value) => { value.candidate.models.unet = "other.safetensors"; });
  await rejects("artifact record mismatch", (value) => { value.candidate.artifact.sha256 = "c".repeat(64); });
  await rejects("comfy output record mismatch", (value) => { value.candidate.comfyOutput.size += 1; });
  await rejects("missing history", (value) => { value.history = {}; });
  await rejects("noncompleted history", (value) => { value.history[promptId].status.completed = false; });
  await rejects("failed history", (value) => { value.history[promptId].status.status_str = "error"; });
  await rejects("history output node mismatch", (value) => { value.history[promptId].outputs = { "99": value.history[promptId].outputs["20"] }; });
  await rejects("history subfolder mismatch", (value) => { value.history[promptId].outputs["20"].images[0].subfolder = "other\\candidate_001"; });
  await rejects("history descriptor mismatch", (value) => { value.history[promptId].outputs["20"].images[0].filename = "wrong_00001_.png"; });
  for (const name of ["live.queue-entry", "legacy.lock", "directory.queued"]) { const entryRoot = path.join(temporaryRoot, `control-${name}`); mkdirSync(path.join(entryRoot, name), { recursive: true }); const scanned = scanResumabilityEntries(entryRoot); assert.equal(scanned.ambiguous.length, 1, `${name} directory must be ambiguous before recursive traversal`); assert.equal(scanned.markers.length, 0); }
  assert.throws(() => assertIdleQueue({ running: 1, pending: 0 }), /not idle/); assert.throws(() => assertIdleQueue({ running: 0, pending: 1 }), /not idle/);
  rmSync(temporaryRoot, { recursive: true, force: true });
  console.log("Layered live readiness checker self-test: PASS (terminal marker provenance; read-only GET contract)");
}

async function main() { if (process.argv.slice(2).length === 1 && process.argv[2] === "--self-test") return selfTest(); if (process.argv.length !== 2) fail("usage: node scripts/check-layered-compositing-live-readiness.mjs [--self-test]"); const result = await checkReadiness(); console.log(JSON.stringify(result, null, 2)); if (result.status !== "READY") process.exitCode = 1; }
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
