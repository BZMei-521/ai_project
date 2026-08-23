import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  EXPERIMENT_ROOT,
  VIDEO_SEEDS,
  assertApprovedEndpoint,
  assertAuthoritativeUnchanged,
  assertExperimentReportInvariant,
  markVideoTechnical
} from "./lib/wan-flf2v-experiment.mjs";

export const FLF2V_MODEL_NAME = "wan2.1_flf2v_720p_14B_fp8_e4m3fn.safetensors";
export const MIN_AVAILABLE_RAM_BYTES = 20 * 1024 ** 3;
export const MAX_TECHNICAL_ATTEMPTS = 3;
export const ATTEMPT_JOURNAL_FILENAME = "attempt-journal.json";

const PRESET_PATH = resolve("src/modules/comfy-pipeline/presets/video-wan21-flf2v-14b-fp8.json");
const DEFAULT_REPORT_PATH = resolve(EXPERIMENT_ROOT, "wan-flf2v-report.json");
const OUTPUT_NODE_ID = "16";
const ALLOWED_FLAGS = new Set(["--candidate", "--report", "--probe-resolution"]);
const PROBE_LABEL = "960x544";
const VIDEO_PROMPT = "Continue as one uninterrupted take from the supplied first keyframe to the supplied accepted end keyframe.";
const NEGATIVE_PROMPT = "whole-character translation without leg articulation, stationary leading foot, missing foot lift, missing landing, implausible weight transfer";
export const FLF2V_POSITIVE_PRESET_TEXT = "{{VIDEO_PROMPT}}\nPreserve the exact identities, faces, hairstyles, clothing construction, clothing colors, body proportions, screen sides and human anatomy from both keyframes. Exactly two human characters: Shen Yan and Jiang Lan. Shen Yan alone performs one grounded half-step toward the bridge with visible foot lift, travel, landing and a small pelvis weight transfer. Jiang Lan remains planted with relaxed lowered hands. Maintain one extremely slow continuous forward camera push and a stable riverside scene.";
export const FLF2V_NEGATIVE_PRESET_TEXT = "{{NEGATIVE_PROMPT}}, identity drift, face morphing, hairstyle change, clothing change, body-shape change, species change, duplicated person, missing person, extra person, extra limbs, deformed hands, stretched legs, sliding feet, floating feet, both characters stepping, synchronized gesture, raised hands, screen-side swap, background change, lighting change, flicker, temporal jitter, abrupt camera motion, fast zoom, pan, reverse movement, scene cut, duplicated frame, black frame, severe color block";
const PRODUCTION_RESOLUTION = Object.freeze({ width: 1280, height: 720, label: "1280x720" });

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function canonicalWorkflowSha256(workflow) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) throw new Error("workflow must be an API workflow object");
  return createHash("sha256").update(canonicalJson(workflow), "utf8").digest("hex");
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error(`${label} does not exist or is empty: ${path}`);
  }
}

function run(command, args, { encoding = "utf8" } = {}) {
  const result = spawnSync(command, args, { encoding, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result;
}

function parseFrameRate(frameRate) {
  const [numerator, denominator] = String(frameRate).split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return NaN;
  return numerator / denominator;
}

function assertImageGeometry(path, width, height, label) {
  assertFile(path, label);
  const result = run("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "json", path
  ]);
  const stream = JSON.parse(result.stdout)?.streams?.[0];
  if (!stream) throw new Error(`${label} is not a decodable image: ${path}`);
  if (Number(stream.width) !== width || Number(stream.height) !== height) {
    throw new Error(`${label} must be ${width}x${height}: ${stream.width}x${stream.height}`);
  }
  return stream;
}

function imageIo() {
  return {
    existsFile(path) {
      return existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;
    },
    hashFile: sha256File,
    assertDecodableImage(path) {
      assertFile(path, "approved endpoint artifact");
      const result = run("ffprobe", [
        "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "json", path
      ]);
      if (!JSON.parse(result.stdout)?.streams?.[0]) throw new Error(`approved endpoint artifact is not a decodable image: ${path}`);
    }
  };
}

export function parseSegment1Arguments(argumentsList) {
  if (argumentsList.length < 2 || argumentsList.length > 6 || argumentsList.length % 2 !== 0) {
    throw new Error("usage: --candidate 1|2|3 [--report PATH] [--probe-resolution 960x544]");
  }
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!ALLOWED_FLAGS.has(flag) || value === undefined || values.has(flag)) {
      throw new Error("usage: --candidate 1|2|3 [--report PATH] [--probe-resolution 960x544]");
    }
    values.set(flag, value);
  }
  if (!values.has("--candidate")) throw new Error("exactly one --candidate 1|2|3 is required");
  const candidate = Number(values.get("--candidate"));
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > VIDEO_SEEDS.length) {
    throw new Error(`candidate must be 1..${VIDEO_SEEDS.length}`);
  }
  let probeResolution = null;
  if (values.has("--probe-resolution")) {
    if (values.get("--probe-resolution") !== PROBE_LABEL) {
      throw new Error(`--probe-resolution accepts only ${PROBE_LABEL}`);
    }
    probeResolution = { width: 960, height: 544, label: PROBE_LABEL };
  }
  return {
    candidate,
    reportPath: resolve(values.get("--report") || DEFAULT_REPORT_PATH),
    probeResolution
  };
}

function replaceTokens(value, tokens) {
  if (typeof value === "string") {
    const exactToken = value.match(/^\{\{([A-Z0-9_]+)\}\}$/);
    if (exactToken && Object.hasOwn(tokens, exactToken[1])) return tokens[exactToken[1]];
    let output = value;
    for (const [name, replacement] of Object.entries(tokens)) {
      output = output.split(`{{${name}}}`).join(String(replacement));
    }
    return output;
  }
  if (Array.isArray(value)) return value.map((item) => replaceTokens(item, tokens));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTokens(item, tokens)]));
  }
  return value;
}

export function compileFlfWorkflow(preset, tokens, resolution = null) {
  const workflow = replaceTokens(preset, tokens);
  const unresolved = JSON.stringify(workflow).match(/\{\{[A-Z0-9_]+\}\}/g);
  if (unresolved) throw new Error(`unresolved preset tokens: ${[...new Set(unresolved)].join(", ")}`);
  if (resolution) {
    workflow["10"] = {
      ...workflow["10"],
      inputs: { ...workflow["10"].inputs, width: resolution.width, height: resolution.height }
    };
  }
  return workflow;
}

function inputDefinitions(objectInfo, classType) {
  const definition = objectInfo?.[classType];
  if (!definition) throw new Error(`Comfy object_info is missing required class ${classType}`);
  return {
    definition,
    required: definition.input?.required || {},
    optional: definition.input?.optional || {},
    all: { ...(definition.input?.required || {}), ...(definition.input?.optional || {}) }
  };
}

function isConnectionTuple(value) {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && Number.isInteger(value[1]);
}

function isConnection(value, preset) {
  return isConnectionTuple(value) && Object.hasOwn(preset, value[0]);
}

function portType(specification) {
  return typeof specification?.[0] === "string" ? specification[0] : null;
}

function assertCanonicalValue(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`canonical FLF2V preset mismatch: ${label}`);
}

export function assertCanonicalFlfPreset(preset) {
  if (!preset || typeof preset !== "object" || Array.isArray(preset)) throw new Error("canonical FLF2V preset must be an API workflow object");
  assertCanonicalValue(Object.keys(preset), Array.from({ length: 16 }, (_, index) => String(index + 1)), "node set");
  const expected = {
    "1": ["UNETLoader", { unet_name: FLF2V_MODEL_NAME, weight_dtype: "fp8_e4m3fn" }],
    "2": ["ModelSamplingSD3", { model: ["1", 0], shift: 8 }],
    "3": ["CLIPLoader", { clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan", device: "cpu" }],
    "4": ["VAELoader", { vae_name: "wan_2.1_vae.safetensors" }],
    "5": ["CLIPVisionLoader", { clip_name: "clip_vision_h.safetensors" }],
    "6": ["LoadImage", { image: "{{START_IMAGE_PATH}}" }],
    "7": ["LoadImage", { image: "{{END_IMAGE_PATH}}" }],
    "8": ["CLIPVisionEncode", { clip_vision: ["5", 0], image: ["6", 0], crop: "none" }],
    "9": ["CLIPVisionEncode", { clip_vision: ["5", 0], image: ["7", 0], crop: "none" }],
    "10": ["WanFirstLastFrameToVideo", {
      positive: ["12", 0], negative: ["13", 0], vae: ["4", 0], width: 1280, height: 720, length: 17, batch_size: 1,
      clip_vision_start_image: ["8", 0], clip_vision_end_image: ["9", 0], start_image: ["6", 0], end_image: ["7", 0]
    }],
    "11": ["KSampler", {
      model: ["2", 0], seed: "{{SEED}}", steps: 20, cfg: 5, sampler_name: "uni_pc", scheduler: "normal",
      positive: ["10", 0], negative: ["10", 1], latent_image: ["10", 2], denoise: 1
    }],
    "14": ["VAEDecode", { samples: ["11", 0], vae: ["4", 0] }],
    "15": ["CreateVideo", { images: ["14", 0], fps: 16, bit_depth: 8 }],
    "16": ["SaveVideo", {
      video: ["15", 0],
      filename_prefix: "Video/wan21_flf2v_segment1_{{RUN_MODE_PREFIX}}_candidate_{{CANDIDATE_PADDED}}",
      format: "mp4",
      codec: "h264"
    }]
  };
  for (const [nodeId, [classType, inputs]] of Object.entries(expected)) {
    assertCanonicalValue(preset[nodeId]?.class_type, classType, `node ${nodeId} class_type`);
    assertCanonicalValue(preset[nodeId]?.inputs, inputs, `node ${nodeId} inputs`);
  }
  for (const [nodeId, text, clip] of [["12", FLF2V_POSITIVE_PRESET_TEXT, ["3", 0]], ["13", FLF2V_NEGATIVE_PRESET_TEXT, ["3", 0]]]) {
    assertCanonicalValue(preset[nodeId]?.class_type, "CLIPTextEncode", `node ${nodeId} class_type`);
    assertCanonicalValue(preset[nodeId]?.inputs?.clip, clip, `node ${nodeId} clip binding`);
    assertCanonicalValue(preset[nodeId]?.inputs?.text, text, `node ${nodeId} prompt body`);
  }
  return true;
}

function hasUnresolvedToken(value) {
  return typeof value === "string" && /\{\{[A-Z0-9_]+\}\}/.test(value);
}

function validateLiteralAgainstSpecification(value, specification, classType, inputName) {
  if (hasUnresolvedToken(value)) return;
  const kind = specification?.[0];
  const constraints = specification?.[1] || {};
  if (Array.isArray(kind)) {
    if (!kind.includes(value)) throw new Error(`Comfy ${classType}.${inputName} does not offer ${value}`);
    return;
  }
  const validType = kind === "INT" ? Number.isInteger(value)
    : kind === "FLOAT" ? typeof value === "number" && Number.isFinite(value)
      : kind === "STRING" ? typeof value === "string"
        : kind === "BOOLEAN" ? typeof value === "boolean"
          : true;
  if (!validType) throw new Error(`Comfy ${classType}.${inputName} literal type must be ${kind}`);
  if ((kind === "INT" || kind === "FLOAT") && Number.isFinite(constraints.min) && value < constraints.min) {
    throw new Error(`Comfy ${classType}.${inputName} literal is outside the allowed range`);
  }
  if ((kind === "INT" || kind === "FLOAT") && Number.isFinite(constraints.max) && value > constraints.max) {
    throw new Error(`Comfy ${classType}.${inputName} literal is outside the allowed range`);
  }
}

export function validateFlfPresetObjectInfo(preset, objectInfo) {
  if (!preset || typeof preset !== "object" || Array.isArray(preset)) throw new Error("FLF2V preset must be an API workflow object");
  const saveNodes = Object.entries(preset).filter(([, node]) => node?.class_type === "SaveVideo");
  if (saveNodes.length !== 1) throw new Error("FLF2V preset requires exactly one SaveVideo terminal");
  for (const [nodeId, workflowNode] of Object.entries(preset)) {
    const definitions = inputDefinitions(objectInfo, workflowNode.class_type);
    for (const requiredInput of Object.keys(definitions.required)) {
      if (!Object.hasOwn(workflowNode.inputs || {}, requiredInput)) {
        throw new Error(`preset node ${nodeId} ${workflowNode.class_type} is missing required input ${requiredInput}`);
      }
    }
    for (const [inputName, value] of Object.entries(workflowNode.inputs || {})) {
      if (!Object.hasOwn(definitions.all, inputName)) {
        throw new Error(`Comfy object_info contract for ${workflowNode.class_type} is missing input ${inputName}`);
      }
      if (!isConnectionTuple(value)) {
        validateLiteralAgainstSpecification(value, definitions.all[inputName], workflowNode.class_type, inputName);
        continue;
      }
      const [sourceId, outputIndex] = value;
      if (!Object.hasOwn(preset, sourceId)) {
        throw new Error(`preset node ${nodeId} input ${inputName} references missing source node ${sourceId}`);
      }
      const sourceNode = preset[sourceId];
      const sourceDefinition = inputDefinitions(objectInfo, sourceNode.class_type).definition;
      const outputs = Array.isArray(sourceDefinition.output) ? sourceDefinition.output : [];
      if (outputIndex < 0 || outputIndex >= outputs.length) {
        throw new Error(`preset node ${nodeId} input ${inputName} uses invalid output index ${outputIndex} from node ${sourceId}`);
      }
      const expectedType = portType(definitions.all[inputName]);
      const actualType = outputs[outputIndex];
      if (expectedType && actualType && expectedType !== "*" && actualType !== "*" && expectedType !== actualType) {
        throw new Error(`preset node ${nodeId} input ${inputName} type mismatch: expected ${expectedType}, got ${actualType}`);
      }
    }
  }

  const reachable = new Set();
  const visit = (nodeId) => {
    if (reachable.has(nodeId)) return;
    reachable.add(nodeId);
    for (const value of Object.values(preset[nodeId]?.inputs || {})) {
      if (isConnection(value, preset)) visit(value[0]);
    }
  };
  visit(saveNodes[0][0]);
  const disconnected = Object.keys(preset).filter((nodeId) => !reachable.has(nodeId));
  if (disconnected.length) throw new Error(`FLF2V preset contains disconnected nodes: ${disconnected.join(", ")}`);

  for (const [classType, inputName, expected] of [
    ["UNETLoader", "unet_name", FLF2V_MODEL_NAME],
    ["CLIPLoader", "clip_name", "umt5_xxl_fp8_e4m3fn_scaled.safetensors"],
    ["VAELoader", "vae_name", "wan_2.1_vae.safetensors"],
    ["CLIPVisionLoader", "clip_name", "clip_vision_h.safetensors"]
  ]) {
    const specification = inputDefinitions(objectInfo, classType).all[inputName];
    const choices = Array.isArray(specification?.[0]) ? specification[0] : [];
    if (!choices.includes(expected)) throw new Error(`Comfy ${classType}.${inputName} does not offer ${expected}`);
  }
  return true;
}

export function normalizeBoundaryImage({ inputPath, outputPath, geometry = null }) {
  assertFile(inputPath, "boundary image");
  const flf = geometry?.flf || { scaledWidth: 1296, scaledHeight: 720, cropLeft: 8, width: 1280, height: 720 };
  run("ffmpeg", [
    "-y", "-v", "error", "-i", inputPath,
    "-vf", `scale=${flf.scaledWidth}:${flf.scaledHeight},crop=${flf.width}:${flf.height}:${flf.cropLeft}:0`,
    "-frames:v", "1", outputPath
  ]);
  assertImageGeometry(outputPath, flf.width, flf.height, "normalized boundary image");
  return outputPath;
}

export function probeVideo(filePath) {
  assertFile(filePath, "video");
  const result = run("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,pix_fmt:format=duration,size,format_name",
    "-of", "json", filePath
  ]);
  const parsed = JSON.parse(result.stdout);
  const stream = parsed?.streams?.[0];
  if (!stream) throw new Error(`video is not decodable: ${filePath}`);
  return { ...stream, format: parsed.format || {} };
}

function assertVideoMetadata(metadata, { label, width, height }) {
  if (metadata?.codec_name !== "h264") throw new Error(`${label} codec must be h264: ${metadata?.codec_name}`);
  if (Number(metadata.width) !== width || Number(metadata.height) !== height) {
    throw new Error(`${label} dimensions must be ${width}x${height}: ${metadata?.width}x${metadata?.height}`);
  }
  const fps = parseFrameRate(metadata.r_frame_rate);
  if (!Number.isFinite(fps) || Math.abs(fps - 16) > 0.01) {
    throw new Error(`${label} frame rate must be 16 FPS: ${metadata?.r_frame_rate}`);
  }
  const averageFps = parseFrameRate(metadata.avg_frame_rate);
  if (!Number.isFinite(averageFps) || Math.abs(averageFps - 16) > 0.01) {
    throw new Error(`${label} average effective frame rate must be 16 FPS: ${metadata?.avg_frame_rate}`);
  }
  if (Number(metadata.nb_frames) !== 17) throw new Error(`${label} must contain exactly 17 frames: ${metadata?.nb_frames}`);
  const duration = Number(metadata.format?.duration);
  if (!Number.isFinite(duration) || duration < 1 || duration > 1.2) {
    throw new Error(`${label} duration must be 1.0-1.2 seconds: ${metadata.format?.duration}`);
  }
  return true;
}

export function assertRawFlfVideo(metadata, { width = 1280, height = 720 } = {}) {
  return assertVideoMetadata(metadata, { label: "raw FLF video", width, height });
}

export function transcodeChainCandidate({ inputPath, outputPath }) {
  assertFile(inputPath, "raw FLF video");
  run("ffmpeg", [
    "-y", "-v", "error", "-i", inputPath,
    "-vf", "scale=-2:480,crop=832:480:11:0",
    "-an", "-c:v", "libx264", "-crf", "18", outputPath
  ]);
  return outputPath;
}

export function assertChainVideo(metadata) {
  return assertVideoMetadata(metadata, { label: "chain candidate", width: 832, height: 480 });
}

export function extractFinalFrame({ inputPath, outputPath }) {
  assertFile(inputPath, "chain candidate");
  run("ffmpeg", [
    "-y", "-v", "error", "-i", inputPath,
    "-vf", "select=eq(n\\,16)", "-frames:v", "1", outputPath
  ]);
  assertImageGeometry(outputPath, 832, 480, "frame 16");
  return outputPath;
}

export function createNineFrameContactSheet({ inputPath, outputPath }) {
  assertFile(inputPath, "chain candidate");
  run("ffmpeg", [
    "-y", "-v", "error", "-i", inputPath,
    "-vf", "select=eq(n\\,0)+eq(n\\,2)+eq(n\\,4)+eq(n\\,6)+eq(n\\,8)+eq(n\\,10)+eq(n\\,12)+eq(n\\,14)+eq(n\\,16),scale=416:240,tile=3x3",
    "-frames:v", "1", outputPath
  ]);
  assertImageGeometry(outputPath, 1248, 720, "nine-frame contact sheet");
  return outputPath;
}

function normalizeUploadedImage(uploaded, role) {
  if (typeof uploaded === "string" && uploaded.trim()) return uploaded.trim().replace(/\\/g, "/");
  const name = String(uploaded?.name || "").trim();
  const subfolder = String(uploaded?.subfolder || "").trim().replace(/\\/g, "/");
  if (!name) throw new Error(`Comfy upload returned no filename for ${role}`);
  return subfolder ? `${subfolder}/${name}` : name;
}

function assertLoopbackBaseUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname)) {
    throw new Error("FLF2V runner permits only a local ComfyUI endpoint");
  }
  return parsed.href.replace(/\/$/, "");
}

export async function unloadComfyModels(baseUrl, fetchImpl = fetch) {
  const endpoint = assertLoopbackBaseUrl(baseUrl);
  const response = await fetchImpl(`${endpoint}/free`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ unload_models: true, free_memory: true })
  });
  if (!response.ok) {
    const details = typeof response.text === "function" ? await response.text() : "";
    throw new Error(`Comfy model unload failed ${response.status}: ${details}`);
  }
  return { unloaded: true };
}

function structuredHistoryDiagnostics(history) {
  const messages = Array.isArray(history?.status?.messages) ? history.status.messages : [];
  return messages.flatMap((entry) => {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || !entry[1] || typeof entry[1] !== "object" || Array.isArray(entry[1])) return [];
    return [{ event: entry[0], data: structuredClone(entry[1]) }];
  });
}

export function classifyStructuredOom(diagnostics) {
  if (!Array.isArray(diagnostics)) return false;
  return diagnostics.some((diagnostic) => {
    if (!diagnostic || typeof diagnostic !== "object" || !/execution_error|oom/i.test(String(diagnostic.event || ""))) return false;
    const data = diagnostic.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    const types = [data.exception_type, data.error_type, data.code, data.error_code, data.classification]
      .filter((value) => typeof value === "string")
      .map((value) => value.trim().toLowerCase());
    return types.some((value) => /(?:^|[._])(?:cuda)?outofmemoryerror$/.test(value) || ["oom", "cuda_oom", "out_of_memory", "cuda_out_of_memory"].includes(value));
  });
}

function outputRefsFromHistory(history) {
  const output = history?.outputs?.[OUTPUT_NODE_ID];
  return [...(output?.videos || []), ...(output?.images || [])]
    .filter((item) => typeof item?.filename === "string" && /\.(?:mp4|mov|mkv|webm)$/i.test(item.filename))
    .map((item) => ({ filename: item.filename, subfolder: item.subfolder || "", type: item.type || "output" }));
}

function storedWorkflowFromHistory(history) {
  const prompt = history?.prompt;
  if (Array.isArray(prompt)) {
    const workflow = prompt[2];
    return workflow && typeof workflow === "object" && !Array.isArray(workflow) ? structuredClone(workflow) : null;
  }
  return prompt && typeof prompt === "object" && !Array.isArray(prompt) ? structuredClone(prompt) : null;
}

function normalizePromptHistory(promptId, history) {
  if (!history || typeof history !== "object" || Array.isArray(history)) return null;
  return {
    promptId,
    storedWorkflow: storedWorkflowFromHistory(history),
    diagnostics: structuredHistoryDiagnostics(history),
    outputRefs: outputRefsFromHistory(history),
    status: String(history.status?.status_str || "").toLowerCase(),
    completed: history.status?.completed === true
  };
}

function generationError(message, { promptId = null, diagnostics = [], outputRefs = [], cause } = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = "ComfyGenerationError";
  error.promptId = promptId;
  error.diagnostics = structuredClone(diagnostics);
  error.outputRefs = structuredClone(outputRefs);
  error.isOom = classifyStructuredOom(diagnostics);
  return error;
}

export function createDefaultComfyAdapter({
  baseUrl,
  candidatePadded,
  runMode,
  fetchImpl = fetch,
  clock = { now: () => Date.now(), sleep: (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)) }
}) {
  const endpoint = assertLoopbackBaseUrl(baseUrl);
  if (!["production", "probe"].includes(runMode)) throw new Error("Comfy adapter runMode must be production or probe");
  async function responseJson(url, options) {
    const response = await fetchImpl(url, options);
    if (!response.ok) throw new Error(`Comfy request failed ${response.status}: ${await response.text()}`);
    return response.json();
  }
  async function fetchPromptHistory(promptId) {
    const normalizedPromptId = String(promptId || "").trim();
    if (!normalizedPromptId) throw new Error("Comfy promptId is required for history lookup");
    const payload = await responseJson(`${endpoint}/history/${encodeURIComponent(normalizedPromptId)}`);
    return normalizePromptHistory(normalizedPromptId, payload?.[normalizedPromptId]);
  }
  return {
    async fetchObjectInfo() {
      return responseJson(`${endpoint}/object_info`);
    },
    async unloadModels() {
      return unloadComfyModels(endpoint, fetchImpl);
    },
    async getSystemStats() {
      return responseJson(`${endpoint}/system_stats`);
    },
    fetchPromptHistory,
    async uploadImage({ path, role }) {
      const form = new FormData();
      form.append("image", new Blob([readFileSync(path)], { type: "image/png" }), `${role}.png`);
      form.append("type", "input");
      form.append("subfolder", `wan-flf2v-segment1/${runMode}/candidate_${candidatePadded}`);
      form.append("overwrite", "false");
      const response = await fetchImpl(`${endpoint}/upload/image`, { method: "POST", body: form });
      if (!response.ok) throw new Error(`Comfy upload failed ${response.status}: ${await response.text()}`);
      return response.json();
    },
    async generateVideo({ workflow, outputPath, onQueued }) {
      const queued = await responseJson(`${endpoint}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: `wan-flf2v-segment1-${runMode}-${candidatePadded}` })
      });
      const promptId = String(queued?.prompt_id || "").trim();
      if (!promptId) throw generationError("Comfy queue returned no prompt_id");
      try {
        if (typeof onQueued !== "function") throw new Error("onQueued callback is required");
        await onQueued({ promptId });
      } catch (error) {
        throw generationError(`failed to persist queued Comfy prompt ${promptId}: ${error instanceof Error ? error.message : String(error)}`, { promptId, cause: error });
      }
      const deadline = clock.now() + 20 * 60 * 1000;
      let lastDiagnostics = [];
      let lastOutputRefs = [];
      try {
        while (clock.now() < deadline) {
          const history = await fetchPromptHistory(promptId);
          if (history) {
            lastDiagnostics = history.diagnostics;
            lastOutputRefs = history.outputRefs;
            const status = history.status;
            const terminalError = ["failed", "error", "cancelled"].includes(status)
              || lastDiagnostics.some((diagnostic) => diagnostic.event === "execution_error");
            if (terminalError) {
              throw generationError(`Comfy prompt failed: ${promptId}`, { promptId, diagnostics: lastDiagnostics, outputRefs: lastOutputRefs });
            }
            if (lastOutputRefs.length === 1) {
              const item = lastOutputRefs[0];
              const query = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder, type: item.type });
              const response = await fetchImpl(`${endpoint}/view?${query}`);
              if (!response.ok) throw new Error(`Comfy video download failed ${response.status}: ${await response.text()}`);
              writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
              return { promptId, diagnostics: lastDiagnostics, isOom: false, outputRefs: lastOutputRefs };
            }
            if (history.completed || status === "success") {
              throw generationError("Comfy prompt completed without exactly one SaveVideo output from node 16", {
                promptId, diagnostics: lastDiagnostics, outputRefs: lastOutputRefs
              });
            }
          }
          await clock.sleep(3000);
        }
        throw generationError(`Comfy prompt timed out: ${promptId}`, { promptId, diagnostics: lastDiagnostics, outputRefs: lastOutputRefs });
      } catch (error) {
        if (error?.name === "ComfyGenerationError") throw error;
        throw generationError(error instanceof Error ? error.message : String(error), {
          promptId, diagnostics: lastDiagnostics, outputRefs: lastOutputRefs, cause: error
        });
      }
    }
  };
}

function extractAvailableRamBytes(stats) {
  const value = stats?.system?.ram_free ?? stats?.ram_free ?? stats?.system?.available_memory;
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) throw new Error("Comfy system_stats did not report available system RAM");
  return bytes;
}

function validateReportBeforeGeneration(report, candidate, probeOnly) {
  assertExperimentReportInvariant(report);
  assertFile(report.authoritativeReportPath, "authoritative one-take report");
  assertAuthoritativeUnchanged(report, sha256File);
  if (!probeOnly && report.videoCandidates.some((item) => item.candidate === candidate)) {
    throw new Error(`video candidate ${candidate} already exists`);
  }
  if (!probeOnly && report.approvedVideo) throw new Error("an approved video already exists");
}

function assertStartArtifact(report) {
  assertFile(report.startFrame.path, "approved start frame");
  if (sha256File(report.startFrame.path) !== report.startFrame.sha256) {
    throw new Error("approved start frame hash does not match the experiment snapshot");
  }
  assertImageGeometry(report.startFrame.path, report.geometry.source.width, report.geometry.source.height, "approved start frame");
}

function assertContainedChild(root, child, label) {
  const difference = relative(resolve(root), resolve(child));
  if (!difference || isAbsolute(difference) || difference === ".." || difference.startsWith(`..${sep}`)) {
    throw new Error(`${label} escaped its isolated root`);
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeJson(temporaryPath, value);
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function createAttemptJournal(path, candidate, seed) {
  if (existsSync(path)) throw new Error(`attempt journal already exists: ${path}`);
  const journal = {
    schemaVersion: 1,
    candidate,
    seed,
    productionResolution: { ...PRODUCTION_RESOLUTION },
    attempts: [],
    probeAttempts: []
  };
  writeJsonAtomic(path, journal);
  return journal;
}

function readAttemptJournal(path) {
  assertFile(path, "production attempt journal");
  const journal = JSON.parse(readFileSync(path, "utf8"));
  if (!journal || journal.schemaVersion !== 1 || !Array.isArray(journal.attempts) || !Array.isArray(journal.probeAttempts)) {
    throw new Error("production attempt journal schema is invalid");
  }
  return journal;
}

function withAttemptJournalLock(path, update) {
  const lockPath = `${path}.lock`;
  let descriptor;
  let ownsLock = false;
  try {
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
      ownsLock = true;
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error(`attempt journal lock is contended: ${lockPath}`);
      throw error;
    }
    writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, "utf8");
    const current = readAttemptJournal(path);
    const next = update(structuredClone(current));
    writeJsonAtomic(path, next);
    return next;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (ownsLock) rmSync(lockPath, { force: true });
  }
}

function upsertJournalAttempt(path, collection, record) {
  return withAttemptJournalLock(path, (journal) => {
    const entries = journal[collection];
    const index = entries.findIndex((item) => item.attempt === record.attempt);
    if (index >= 0) entries[index] = { ...entries[index], ...structuredClone(record) };
    else entries.push(structuredClone(record));
    return journal;
  });
}

function diagnosticMatchesPrompt(diagnostic, promptId) {
  return diagnostic?.data?.prompt_id === promptId && classifyStructuredOom([diagnostic]);
}

function assertProbeAuthorized(journal, candidate, seed) {
  if (journal.candidate !== candidate) throw new Error("probe journal candidate must match the same candidate");
  if (journal.seed !== seed) throw new Error("probe journal seed must match the same fixed seed");
  if (!isDeepStrictEqual(journal.productionResolution, PRODUCTION_RESOLUTION)) {
    throw new Error("probe requires a prior 1280x720 production attempt");
  }
  if (journal.probeAttempts.length !== 0) throw new Error("exactly one probe is allowed and this candidate already has a probe attempt");
  const structuredOomAttempts = journal.attempts.filter((attempt) => classifyStructuredOom(attempt.diagnostics));
  if (structuredOomAttempts.some((attempt) => !String(attempt.promptId || "").trim())) {
    throw new Error("queued promptId is required to authorize a probe");
  }
  const authorized = [...journal.attempts].reverse().find((attempt) => {
    const promptId = String(attempt.promptId || "").trim();
    return attempt.mode === "production"
      && attempt.candidate === candidate
      && attempt.seed === seed
      && isDeepStrictEqual(attempt.resolution, PRODUCTION_RESOLUTION)
      && attempt.status === "failed"
      && promptId
      && attempt.isOom === true
      && classifyStructuredOom(attempt.diagnostics)
      && attempt.diagnostics.some((diagnostic) => diagnosticMatchesPrompt(diagnostic, promptId))
      && /^[a-f0-9]{64}$/.test(String(attempt.workflowSha256 || ""))
      && typeof attempt.workflowInputs?.startImage === "string"
      && attempt.workflowInputs.startImage.length > 0
      && typeof attempt.workflowInputs?.endImage === "string"
      && attempt.workflowInputs.endImage.length > 0;
  });
  if (!authorized) throw new Error("a prior queued production attempt with a matching structured Comfy OOM diagnostic, workflow hash, and inputs is required before probe");
  return authorized;
}

function compileCanonicalProductionWorkflow(preset, candidatePadded, seed, workflowInputs) {
  return compileFlfWorkflow(preset, {
    START_IMAGE_PATH: workflowInputs.startImage,
    END_IMAGE_PATH: workflowInputs.endImage,
    VIDEO_PROMPT,
    NEGATIVE_PROMPT,
    SEED: seed,
    RUN_MODE_PREFIX: "production",
    CANDIDATE_PADDED: candidatePadded
  });
}

async function verifyProbeHistory({ comfy, preset, journal, candidate, candidatePadded, seed }) {
  const attempt = assertProbeAuthorized(journal, candidate, seed);
  const promptId = String(attempt.promptId).trim();
  const history = await comfy.fetchPromptHistory(promptId);
  if (!history) throw new Error(`Comfy history is missing the probe-authorizing prompt ${promptId}`);
  if (String(history.promptId || "").trim() !== promptId) throw new Error("Comfy history prompt identity does not match the journal promptId");
  if (!["failed", "error", "cancelled"].includes(String(history.status || "").toLowerCase())) {
    throw new Error("probe authorization requires a terminal failed Comfy history record");
  }
  if (!Array.isArray(history.diagnostics) || !history.diagnostics.some((diagnostic) => diagnosticMatchesPrompt(diagnostic, promptId))) {
    throw new Error("Comfy history must contain a structured OOM diagnostic matching the queued promptId");
  }
  if (!history.storedWorkflow || typeof history.storedWorkflow !== "object" || Array.isArray(history.storedWorkflow)) {
    throw new Error("Comfy history is missing the stored submitted workflow");
  }
  const historyWorkflowInputs = {
    startImage: history.storedWorkflow?.["6"]?.inputs?.image,
    endImage: history.storedWorkflow?.["7"]?.inputs?.image
  };
  if (typeof historyWorkflowInputs.startImage !== "string" || !historyWorkflowInputs.startImage
    || typeof historyWorkflowInputs.endImage !== "string" || !historyWorkflowInputs.endImage) {
    throw new Error("Comfy history workflow is missing canonical hydrated boundary-image inputs");
  }
  if (!isDeepStrictEqual(attempt.workflowInputs, historyWorkflowInputs)) {
    throw new Error("journal workflow input fields do not match the fetched Comfy history workflow");
  }
  const expectedWorkflow = compileCanonicalProductionWorkflow(preset, candidatePadded, seed, historyWorkflowInputs);
  const expectedHash = canonicalWorkflowSha256(expectedWorkflow);
  const historyHash = canonicalWorkflowSha256(history.storedWorkflow);
  if (attempt.workflowSha256 !== expectedHash || historyHash !== expectedHash || !isDeepStrictEqual(history.storedWorkflow, expectedWorkflow)) {
    throw new Error("probe-authorizing Comfy history workflow/hash does not match the exact canonical production workflow");
  }
  return {
    attempt: attempt.attempt,
    promptId,
    workflowSha256: expectedHash,
    workflowInputs: structuredClone(historyWorkflowInputs)
  };
}

function reserveProbeAttempt(path, candidate, seed, verification) {
  const record = {
    attempt: 1,
    mode: "probe",
    candidate,
    seed,
    resolution: { width: 960, height: 544, label: PROBE_LABEL },
    status: "reserved",
    reservedAt: new Date().toISOString(),
    promptId: null,
    diagnostics: [],
    isOom: false,
    outputRefs: [],
    authorizedProductionPromptId: verification.promptId,
    authorizedProductionWorkflowSha256: verification.workflowSha256,
    authorizedProductionWorkflowInputs: structuredClone(verification.workflowInputs),
    historyVerifiedAt: new Date().toISOString()
  };
  withAttemptJournalLock(path, (journal) => {
    const attempt = assertProbeAuthorized(journal, candidate, seed);
    if (attempt.attempt !== verification.attempt
      || attempt.promptId !== verification.promptId
      || attempt.workflowSha256 !== verification.workflowSha256
      || !isDeepStrictEqual(attempt.workflowInputs, verification.workflowInputs)) {
      throw new Error("probe authorization changed before atomic reservation");
    }
    journal.probeAttempts.push(record);
    return journal;
  });
  return record;
}

function commitCandidateReport({ reportPath, reportStateSha256, candidateRecord }) {
  if (candidateRecord.probeOnly) throw new Error("probe-only video output cannot be promoted");
  const lockPath = `${reportPath}.lock`;
  let lockDescriptor;
  let temporaryPath;
  let ownsLock = false;
  try {
    try {
      lockDescriptor = openSync(lockPath, "wx", 0o600);
      ownsLock = true;
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error(`FLF2V report lock is contended: ${lockPath}`);
      throw error;
    }
    writeFileSync(lockDescriptor, `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, "utf8");
    const lockedBytes = readFileSync(reportPath);
    const lockedSha256 = createHash("sha256").update(lockedBytes).digest("hex");
    if (lockedSha256 !== reportStateSha256) {
      throw new Error("FLF2V experiment report state changed during segment-1 generation");
    }
    const lockedReport = JSON.parse(lockedBytes.toString("utf8"));
    assertExperimentReportInvariant(lockedReport);
    assertAuthoritativeUnchanged(lockedReport, sha256File);
    assertStartArtifact(lockedReport);
    assertApprovedEndpoint(lockedReport, imageIo());
    const committedReport = markVideoTechnical(lockedReport, candidateRecord);
    assertExperimentReportInvariant(committedReport);
    temporaryPath = `${reportPath}.tmp-${process.pid}-${randomUUID()}`;
    writeJson(temporaryPath, committedReport);
    renameSync(temporaryPath, reportPath);
    temporaryPath = undefined;
    return committedReport;
  } finally {
    if (temporaryPath) rmSync(temporaryPath, { force: true });
    if (lockDescriptor !== undefined) closeSync(lockDescriptor);
    if (ownsLock) rmSync(lockPath, { force: true });
  }
}

function adapterFor(options, dependencies, candidatePadded, runMode) {
  const required = ["fetchObjectInfo", "fetchPromptHistory", "unloadModels", "getSystemStats", "uploadImage", "generateVideo"];
  const supplied = required.filter((name) => typeof dependencies?.[name] === "function");
  if (supplied.length === 0) {
    return createDefaultComfyAdapter({
      baseUrl: options.comfyUrl || process.env.COMFYUI_URL || "http://127.0.0.1:8188",
      candidatePadded,
      runMode,
      fetchImpl: options.fetchImpl || fetch,
      clock: options.clock
    });
  }
  if (supplied.length !== required.length) {
    throw new Error(`injected Comfy adapter requires ${required.join(", ")}`);
  }
  return dependencies;
}

export async function runSegment1Candidate(options, dependencies = {}) {
  const candidate = Number(options?.candidate);
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > VIDEO_SEEDS.length) {
    throw new Error(`candidate must be 1..${VIDEO_SEEDS.length}`);
  }
  const probeResolution = options?.probeResolution || null;
  if (probeResolution && (probeResolution.width !== 960 || probeResolution.height !== 544 || probeResolution.label !== PROBE_LABEL)) {
    throw new Error(`probe-resolution must be ${PROBE_LABEL}`);
  }
  const probeOnly = Boolean(probeResolution);
  const seed = VIDEO_SEEDS[candidate - 1];
  const reportPath = resolve(options.reportPath || DEFAULT_REPORT_PATH);
  const experimentRoot = resolve(options.experimentRoot || EXPERIMENT_ROOT);
  assertFile(reportPath, "FLF2V experiment report");
  const reportStateSha256 = sha256File(reportPath);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  validateReportBeforeGeneration(report, candidate, probeOnly);

  const candidatePadded = String(candidate).padStart(3, "0");
  const productionOutputDir = resolve(experimentRoot, "video", `candidate_${candidatePadded}`);
  const attemptJournalPath = resolve(productionOutputDir, ATTEMPT_JOURNAL_FILENAME);
  if (probeOnly) {
    if (!existsSync(attemptJournalPath)) throw new Error("a prior structured Comfy OOM production attempt journal is required before probe");
    assertProbeAuthorized(readAttemptJournal(attemptJournalPath), candidate, seed);
  }
  const presetPath = resolve(options.presetPath || PRESET_PATH);
  assertFile(presetPath, "dedicated FLF2V preset");
  const preset = JSON.parse(readFileSync(presetPath, "utf8"));
  assertCanonicalFlfPreset(preset);
  const runMode = probeOnly ? "probe" : "production";
  const comfy = adapterFor(options, dependencies, candidatePadded, runMode);
  const objectInfo = await comfy.fetchObjectInfo();
  validateFlfPresetObjectInfo(preset, objectInfo);
  const probeVerification = probeOnly
    ? await verifyProbeHistory({ comfy, preset, journal: readAttemptJournal(attemptJournalPath), candidate, candidatePadded, seed })
    : null;
  const endpoint = assertApprovedEndpoint(report, imageIo());
  assertStartArtifact(report);
  assertImageGeometry(endpoint.endpointPath, report.geometry.source.width, report.geometry.source.height, "approved end frame");

  await comfy.unloadModels();
  const stats = await comfy.getSystemStats();
  const availableRamBytes = extractAvailableRamBytes(stats);
  if (availableRamBytes < MIN_AVAILABLE_RAM_BYTES) {
    throw new Error(`at least 20 GiB available system RAM is required after unload; found ${(availableRamBytes / 1024 ** 3).toFixed(2)} GiB`);
  }

  if (probeOnly) reserveProbeAttempt(attemptJournalPath, candidate, seed, probeVerification);
  const categoryRoot = probeOnly ? resolve(experimentRoot, "video", "probes") : resolve(experimentRoot, "video");
  const outputDir = resolve(categoryRoot, `candidate_${candidatePadded}`);
  assertContainedChild(categoryRoot, outputDir, "segment-1 candidate output directory");
  if (existsSync(outputDir)) throw new Error(`${probeOnly ? "probe" : "video"} candidate ${candidate} output directory already exists`);
  mkdirSync(dirname(outputDir), { recursive: true });
  mkdirSync(outputDir, { recursive: false });
  if (!probeOnly) createAttemptJournal(attemptJournalPath, candidate, seed);

  const normalizedStartPath = resolve(outputDir, "normalized_start.png");
  const normalizedEndPath = resolve(outputDir, "normalized_end.png");
  normalizeBoundaryImage({ inputPath: report.startFrame.path, outputPath: normalizedStartPath, geometry: report.geometry });
  normalizeBoundaryImage({ inputPath: endpoint.endpointPath, outputPath: normalizedEndPath, geometry: report.geometry });
  const uploadedStart = normalizeUploadedImage(await comfy.uploadImage({ path: normalizedStartPath, role: "normalized_start" }), "normalized start");
  const uploadedEnd = normalizeUploadedImage(await comfy.uploadImage({ path: normalizedEndPath, role: "normalized_end" }), "normalized end");
  const resolution = probeResolution || { width: report.geometry.flf.width, height: report.geometry.flf.height, label: `${report.geometry.flf.width}x${report.geometry.flf.height}` };

  const attempts = [];
  let successfulAttempt;
  let successfulRawPath;
  const attemptLimit = probeOnly ? 1 : MAX_TECHNICAL_ATTEMPTS;
  const journalCollection = probeOnly ? "probeAttempts" : "attempts";
  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    const rawAttemptPath = resolve(outputDir, `raw_attempt_${String(attempt).padStart(3, "0")}.mp4`);
    const attemptRecord = {
      attempt,
      mode: runMode,
      candidate,
      seed,
      resolution: { ...resolution },
      startedAt: new Date().toISOString(),
      promptId: null,
      diagnostics: [],
      isOom: false,
      outputRefs: []
    };
    attempts.push(attemptRecord);
    let generation;
    let queuedPromptId = null;
    const workflow = compileFlfWorkflow(preset, {
      START_IMAGE_PATH: uploadedStart,
      END_IMAGE_PATH: uploadedEnd,
      VIDEO_PROMPT,
      NEGATIVE_PROMPT,
      SEED: seed,
      RUN_MODE_PREFIX: runMode,
      CANDIDATE_PADDED: candidatePadded
    }, probeResolution);
    Object.assign(attemptRecord, {
      workflowInputs: { startImage: uploadedStart, endImage: uploadedEnd },
      workflowSha256: canonicalWorkflowSha256(workflow)
    });
    try {
      generation = await comfy.generateVideo({
        workflow,
        outputPath: rawAttemptPath,
        attempt,
        seed,
        probeOnly,
        onQueued: async ({ promptId }) => {
          const normalizedPromptId = String(promptId || "").trim();
          if (!normalizedPromptId) throw new Error("queued promptId is required");
          queuedPromptId = normalizedPromptId;
          Object.assign(attemptRecord, { promptId: normalizedPromptId, queuedAt: new Date().toISOString(), status: "queued" });
          upsertJournalAttempt(attemptJournalPath, journalCollection, attemptRecord);
        }
      });
      const returnedPromptId = String(generation?.promptId || "").trim();
      if (!queuedPromptId || returnedPromptId !== queuedPromptId) {
        throw new Error("Comfy adapter must preserve the queued promptId through terminal media validation");
      }
      const rawMetadata = probeVideo(rawAttemptPath);
      assertRawFlfVideo(rawMetadata, { width: resolution.width, height: resolution.height });
      Object.assign(attemptRecord, {
        promptId: queuedPromptId,
        diagnostics: Array.isArray(generation?.diagnostics) ? structuredClone(generation.diagnostics) : [],
        isOom: false,
        outputRefs: Array.isArray(generation?.outputRefs) ? structuredClone(generation.outputRefs) : [],
        rawPath: rawAttemptPath,
        rawSha256: sha256File(rawAttemptPath),
        metadata: rawMetadata,
        status: "accepted",
        completedAt: new Date().toISOString()
      });
      upsertJournalAttempt(attemptJournalPath, journalCollection, attemptRecord);
      successfulAttempt = attemptRecord;
      successfulRawPath = rawAttemptPath;
      break;
    } catch (error) {
      const diagnostics = Array.isArray(error?.diagnostics) ? structuredClone(error.diagnostics)
        : Array.isArray(generation?.diagnostics) ? structuredClone(generation.diagnostics) : [];
      const outputRefs = Array.isArray(error?.outputRefs) ? structuredClone(error.outputRefs)
        : Array.isArray(generation?.outputRefs) ? structuredClone(generation.outputRefs) : [];
      const promptId = String(error?.promptId || generation?.promptId || queuedPromptId || "").trim() || null;
      Object.assign(attemptRecord, {
        status: "failed",
        failedAt: new Date().toISOString(),
        promptId,
        diagnostics,
        isOom: classifyStructuredOom(diagnostics),
        outputRefs,
        error: error instanceof Error ? error.message : String(error)
      });
      if (existsSync(rawAttemptPath) && statSync(rawAttemptPath).isFile() && statSync(rawAttemptPath).size > 0) {
        attemptRecord.rawPath = rawAttemptPath;
        attemptRecord.rawSha256 = sha256File(rawAttemptPath);
      }
      upsertJournalAttempt(attemptJournalPath, journalCollection, attemptRecord);
    }
  }
  if (!successfulAttempt) {
    writeJsonAtomic(resolve(outputDir, "metadata.json"), { candidate, seed, probeOnly, resolution, availableRamBytes, attemptJournalPath, attempts });
    throw new Error(`FLF2V candidate ${candidate} failed after ${attemptLimit} technical attempt${attemptLimit === 1 ? "" : "s"} with retained seed ${seed}`);
  }

  const rawFlfPath = resolve(outputDir, probeOnly ? "probe_raw.mp4" : "raw_flf_1280x720.mp4");
  copyFileSync(successfulRawPath, rawFlfPath);
  const rawMetadata = probeVideo(rawFlfPath);
  assertRawFlfVideo(rawMetadata, { width: resolution.width, height: resolution.height });

  if (probeOnly) {
    const probeMetadataPath = resolve(outputDir, "metadata.json");
    const probe = {
      candidate,
      seed,
      probeOnly: true,
      resolution: resolution.label,
      promptId: successfulAttempt.promptId,
      rawFlfPath,
      rawFlfSha256: sha256File(rawFlfPath),
      normalizedStartPath,
      normalizedStartSha256: sha256File(normalizedStartPath),
      normalizedEndPath,
      normalizedEndSha256: sha256File(normalizedEndPath),
      metadata: rawMetadata,
      availableRamBytes,
      attemptJournalPath,
      attemptJournalSha256: sha256File(attemptJournalPath),
      attempts
    };
    writeJsonAtomic(probeMetadataPath, probe);
    probe.metadataPath = probeMetadataPath;
    probe.metadataSha256 = sha256File(probeMetadataPath);
    return { probeOnly: true, probe, reportPath };
  }

  const chainPath = resolve(outputDir, "chain_832x480.mp4");
  transcodeChainCandidate({ inputPath: rawFlfPath, outputPath: chainPath });
  const chainMetadata = probeVideo(chainPath);
  assertChainVideo(chainMetadata);
  const finalFramePath = resolve(outputDir, "frame_016.png");
  extractFinalFrame({ inputPath: chainPath, outputPath: finalFramePath });
  const evidencePath = resolve(outputDir, "contact_sheet_9.png");
  createNineFrameContactSheet({ inputPath: chainPath, outputPath: evidencePath });
  const metadataPath = resolve(outputDir, "metadata.json");
  const metadataDocument = {
    candidate,
    seed,
    probeOnly: false,
    endpointCandidate: endpoint.candidate,
    endpointPath: endpoint.endpointPath,
    endpointSha256: endpoint.endpointSha256 || endpoint.compositeSha256,
    startFramePath: report.startFrame.path,
    startFrameSha256: report.startFrame.sha256,
    normalizedStartPath,
    normalizedStartSha256: sha256File(normalizedStartPath),
    normalizedEndPath,
    normalizedEndSha256: sha256File(normalizedEndPath),
    rawFlfPath,
    rawFlfSha256: sha256File(rawFlfPath),
    rawMetadata,
    videoPath: chainPath,
    videoSha256: sha256File(chainPath),
    metadata: chainMetadata,
    finalFramePath,
    finalFrameSha256: sha256File(finalFramePath),
    evidencePath,
    evidenceSha256: sha256File(evidencePath),
    promptId: successfulAttempt.promptId,
    availableRamBytes,
    attemptJournalPath,
    attemptJournalSha256: sha256File(attemptJournalPath),
    attempts
  };
  writeJsonAtomic(metadataPath, metadataDocument);
  const candidateRecord = {
    ...metadataDocument,
    metadataPath,
    metadataSha256: sha256File(metadataPath)
  };
  const proposedReport = markVideoTechnical(report, candidateRecord);
  assertExperimentReportInvariant(proposedReport);
  assertAuthoritativeUnchanged(report, sha256File);
  assertStartArtifact(report);
  assertApprovedEndpoint(report, imageIo());
  if (typeof dependencies.beforeReportWrite === "function") await dependencies.beforeReportWrite(proposedReport);
  const updatedReport = commitCandidateReport({ reportPath, reportStateSha256, candidateRecord });
  const committedCandidate = updatedReport.videoCandidates.find((item) => item.candidate === candidate);
  return { candidate: committedCandidate, report: updatedReport, reportPath };
}

async function main() {
  const parsed = parseSegment1Arguments(process.argv.slice(2));
  const result = await runSegment1Candidate(parsed);
  process.stdout.write(`${JSON.stringify(result.probeOnly ? result.probe : result.candidate, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
