import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ENDPOINT_SEEDS,
  EXPERIMENT_ROOT,
  assertAuthoritativeUnchanged,
  assertExperimentReportInvariant,
  markEndpointTechnical
} from "./lib/wan-flf2v-experiment.mjs";
import { buildHalfStepTarget, writePoseEvidence } from "./lib/wan-flf2v-pose-guide.mjs";

export const SOURCE_WIDTH = 1152;
export const SOURCE_HEIGHT = 640;
export const MASK_FEATHER_PIXELS = 12;
export const LOWER_BODY_POLYGONS = Object.freeze([
  Object.freeze([[420, 250], [515, 250], [530, 420], [405, 420]]),
  Object.freeze([[375, 400], [565, 400], [570, 625], [370, 625]])
]);

const PRESET_PATH = resolve("src/modules/comfy-pipeline/presets/image-qwen-half-step-endpoint-v1.json");
const POSE_PRESET_PATH = resolve("src/modules/comfy-pipeline/presets/image-qwen-half-step-pose-endpoint-v2.json");
const DWPOSE_PRESET_PATH = resolve("src/modules/comfy-pipeline/presets/dwpose-half-step-extract-v1.json");
const RIVER_SHOT_CONTRACT_PATH = resolve("src/modules/comfy-pipeline/presets/wan-flf2v-river-shot-contract-v1.json");
const DEFAULT_REPORT_PATH = resolve(EXPERIMENT_ROOT, "wan-flf2v-report.json");
const DEFAULT_SHEN_YAN_PRIMARY_PATH = resolve("logs/shen-yan-zimage-hero-v1/hero-2026080913.png");
const OUTPUT_NODE_ID = "20";
const ALLOWED_FLAGS = new Set(["--candidate", "--report"]);

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

function probeImage(path) {
  assertFile(path, "image");
  const result = run("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,pix_fmt", "-of", "json", path
  ]);
  const stream = JSON.parse(result.stdout)?.streams?.[0];
  if (!stream) throw new Error(`image is not decodable: ${path}`);
  return stream;
}

function assertSourceGeometry(path, label) {
  const stream = probeImage(path);
  if (Number(stream.width) !== SOURCE_WIDTH || Number(stream.height) !== SOURCE_HEIGHT) {
    throw new Error(`${label} must be ${SOURCE_WIDTH}x${SOURCE_HEIGHT}: ${stream.width}x${stream.height}`);
  }
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const [currentX, currentY] = polygon[current];
    const [previousX, previousY] = polygon[previous];
    if ((currentY > y) !== (previousY > y) && x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX) {
      inside = !inside;
    }
  }
  return inside;
}

function writeUnionPgm(path) {
  const pixels = Buffer.alloc(SOURCE_WIDTH * SOURCE_HEIGHT);
  for (let y = 0; y < SOURCE_HEIGHT; y += 1) {
    for (let x = 0; x < SOURCE_WIDTH; x += 1) {
      if (LOWER_BODY_POLYGONS.some((polygon) => pointInPolygon(x + 0.5, y + 0.5, polygon))) {
        pixels[y * SOURCE_WIDTH + x] = 255;
      }
    }
  }
  writeFileSync(path, Buffer.concat([Buffer.from(`P5\n${SOURCE_WIDTH} ${SOURCE_HEIGHT}\n255\n`, "ascii"), pixels]));
}

export function parseEndpointArguments(argumentsList) {
  if (argumentsList.length < 2 || argumentsList.length > 4 || argumentsList.length % 2 !== 0) {
    throw new Error("usage: --candidate 1|2|3 [--report PATH]");
  }
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!ALLOWED_FLAGS.has(flag) || value === undefined || values.has(flag)) {
      throw new Error("usage: --candidate 1|2|3 [--report PATH]");
    }
    values.set(flag, value);
  }
  if (!values.has("--candidate")) throw new Error("exactly one --candidate 1|2|3 is required");
  const candidate = Number(values.get("--candidate"));
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > ENDPOINT_SEEDS.length) {
    throw new Error(`candidate must be 1..${ENDPOINT_SEEDS.length}`);
  }
  return { candidate, reportPath: resolve(values.get("--report") || DEFAULT_REPORT_PATH) };
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

export function compileEndpointWorkflow(preset, tokens) {
  const workflow = replaceTokens(preset, tokens);
  const unresolved = JSON.stringify(workflow).match(/\{\{[A-Z0-9_]+\}\}/g);
  if (unresolved) throw new Error(`unresolved preset tokens: ${[...new Set(unresolved)].join(", ")}`);
  return workflow;
}

export function compileDWPoseWorkflow(preset, tokens) {
  return compileEndpointWorkflow(preset, tokens);
}

export function normalizeDWPoseHistoryJson(value) {
  let normalized = value;
  if (Array.isArray(normalized)) {
    if (normalized.length !== 1) throw new Error("Comfy DWPose openpose_json must contain exactly one payload");
    [normalized] = normalized;
  }
  if (typeof normalized === "string") {
    try { normalized = JSON.parse(normalized); }
    catch { throw new Error("Comfy DWPose openpose_json is not valid JSON"); }
  }
  if (Array.isArray(normalized)) {
    if (normalized.length !== 1) throw new Error("Comfy DWPose openpose_json must contain exactly one image result");
    [normalized] = normalized;
  }
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    throw new Error("Comfy DWPose openpose_json must resolve to one object");
  }
  return normalized;
}

function inputDefinition(objectInfo, classType, inputName) {
  const definition = objectInfo?.[classType];
  if (!definition) throw new Error(`Comfy object_info is missing required class ${classType}`);
  const inputs = { ...(definition.input?.required || {}), ...(definition.input?.optional || {}) };
  if (!Object.hasOwn(inputs, inputName)) {
    throw new Error(`Comfy object_info contract for ${classType} is missing input ${inputName}`);
  }
  return inputs[inputName];
}

function validateGraphReferences(preset, objectInfo) {
  for (const [targetId, node] of Object.entries(preset)) {
    for (const [inputName, value] of Object.entries(node.inputs || {})) {
      if (!(Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && Number.isInteger(value[1]))) continue;
      const source = preset[value[0]];
      if (!source) throw new Error(`Comfy graph input ${targetId}.${inputName} references missing node ${value[0]}`);
      const outputs = objectInfo?.[source.class_type]?.output;
      if (!Array.isArray(outputs) || typeof outputs[value[1]] !== "string") {
        throw new Error(`Comfy graph input ${targetId}.${inputName} references invalid output ${value[0]}:${value[1]}`);
      }
      const expectedType = inputDefinition(objectInfo, node.class_type, inputName)?.[0];
      if (typeof expectedType === "string" && outputs[value[1]] !== expectedType) {
        throw new Error(`Comfy graph type mismatch at ${targetId}.${inputName}: expected ${expectedType}, received ${outputs[value[1]]}`);
      }
    }
  }
}

export function validatePresetObjectInfo(preset, objectInfo) {
  for (const node of Object.values(preset)) {
    for (const inputName of Object.keys(node.inputs || {})) inputDefinition(objectInfo, node.class_type, inputName);
  }
  for (const [classType, inputName, expected] of [
    ["UNETLoader", "unet_name", "qwen_image_edit_2511_fp8mixed.safetensors"],
    ["LoraLoaderModelOnly", "lora_name", "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"],
    ["CLIPLoader", "clip_name", "qwen_2.5_vl_7b_fp8_scaled.safetensors"],
    ["VAELoader", "vae_name", "qwen_image_vae.safetensors"]
  ]) {
    const specification = inputDefinition(objectInfo, classType, inputName);
    const choices = Array.isArray(specification?.[0]) ? specification[0] : [];
    if (!choices.includes(expected)) throw new Error(`Comfy ${classType}.${inputName} does not offer ${expected}`);
  }
  validateGraphReferences(preset, objectInfo);
  return true;
}

export function validateDWPoseObjectInfo(preset, objectInfo) {
  const entries = Object.entries(preset);
  if (entries.length !== 3 || entries.map(([, node]) => node.class_type).join(",") !== "LoadImage,DWPreprocessor,SaveImage") {
    throw new Error("DWPose preset must contain exactly LoadImage, DWPreprocessor, and SaveImage");
  }
  for (const node of Object.values(preset)) for (const inputName of Object.keys(node.inputs || {})) inputDefinition(objectInfo, node.class_type, inputName);
  const processor = entries.find(([, node]) => node.class_type === "DWPreprocessor")?.[1];
  const expected = {
    detect_hand: "disable", detect_body: "enable", detect_face: "disable", resolution: 640,
    bbox_detector: "yolox_l.torchscript.pt", pose_estimator: "dw-ll_ucoco_384_bs5.torchscript.pt", scale_stick_for_xinsr_cn: "disable"
  };
  for (const [inputName, literal] of Object.entries(expected)) {
    if (processor?.inputs?.[inputName] !== literal) throw new Error(`DWPose ${inputName} must be ${literal}`);
    const specification = inputDefinition(objectInfo, "DWPreprocessor", inputName);
    if (Array.isArray(specification?.[0])) {
      if (!specification[0].includes(literal)) throw new Error(`Comfy DWPreprocessor.${inputName} does not offer ${literal}`);
    } else if (inputName === "resolution") {
      if (specification?.[0] !== "INT" || Number(specification?.[1]?.min) > literal || Number(specification?.[1]?.max) < literal) {
        throw new Error("Comfy DWPreprocessor.resolution does not accept 640");
      }
    }
  }
  validateGraphReferences(preset, objectInfo);
  return true;
}

export function validatePoseEndpointPresetObjectInfo(preset, objectInfo) {
  validatePresetObjectInfo(preset, objectInfo);
  const loadImages = Object.values(preset).filter((node) => node.class_type === "LoadImage").map((node) => node.inputs.image).sort();
  const expectedImages = ["{{POSE_GUIDE_PATH}}", "{{SHEN_YAN_PRIMARY_PATH}}", "{{START_FRAME_PATH}}"].sort();
  if (JSON.stringify(loadImages) !== JSON.stringify(expectedImages)) throw new Error("pose endpoint must load start, Shen Yan identity, and pose guide exactly once");
  const encoder = Object.values(preset).find((node) => node.class_type === "TextEncodeQwenImageEditPlus");
  for (const phrase of [
    "Picture 3 is the authoritative target body-pose guide", "Exactly two human characters", "one short grounded half-step",
    "Jiang Lan must remain unchanged", "Do not create a lunge, split, crossed legs, floating foot, or extra limb"
  ]) if (!String(encoder?.inputs?.prompt || "").includes(phrase)) throw new Error(`pose endpoint prompt is missing ${phrase}`);
  return true;
}

function canonicalPromptBlock(name, block) {
  if (!block || typeof block.text !== "string" || !block.text.trim()) throw new Error(`river shot block ${name} is invalid`);
  return JSON.stringify({ name, text: block.text });
}

export function compileRiverShotPrompt(contract) {
  const expectedBlockNames = ["identity", "lighting", "performance", "spatialLayout", "style"];
  if (JSON.stringify(Object.keys(contract?.blocks || {}).sort()) !== JSON.stringify(expectedBlockNames)) {
    throw new Error("river shot contract must contain exactly five immutable blocks");
  }
  for (const [name, block] of Object.entries(contract.blocks)) {
    const actual = createHash("sha256").update(canonicalPromptBlock(name, block)).digest("hex");
    if (block.sha256 !== actual) throw new Error(`river shot block hash mismatch: ${name}`);
  }
  const referenceValues = Object.values(contract.references || {});
  if (referenceValues.length !== 3 || new Set(referenceValues.map((item) => item?.role)).size !== 3) {
    throw new Error("river shot references must have three distinct roles");
  }
  const action = contract.sections?.action;
  const actionSentenceCount = String(action?.text || "").split(/[.!?]+/).map((item) => item.trim()).filter(Boolean).length;
  if (action?.primaryAction !== "Shen Yan takes one short grounded half-step" || actionSentenceCount < 1 || actionSentenceCount > 3) {
    throw new Error("river shot action must be one grounded half-step in at most three sentences");
  }
  const textByHeader = {
    "ASSET ROLES": referenceValues.map((item) => item.description).join(" "),
    "IDENTITY": contract.blocks.identity.text,
    "SPATIAL LAYOUT": contract.blocks.spatialLayout.text,
    "FIRST FRAME": contract.sections.startFrame.text,
    "ACTION": action.text,
    "CAMERA": contract.sections.camera.text,
    "CONTACT PHYSICS": contract.sections.contactPhysics.text,
    "LIGHTING": contract.blocks.lighting.text,
    "PERFORMANCE": contract.blocks.performance.text,
    "STYLE": contract.blocks.style.text,
    "POSITIVE CONSTRAINTS": contract.sections.positiveConstraints.text
  };
  const order = contract.compileOrder;
  if (!Array.isArray(order) || order.length !== Object.keys(textByHeader).length || new Set(order).size !== order.length || order.some((header) => !textByHeader[header])) {
    throw new Error("river shot compile order is incomplete or invalid");
  }
  const compiled = order.map((header) => `${header}\n${textByHeader[header]}`).join("\n\n");
  if (/Higgsfield|Soul ID|@HERO/i.test(compiled)) throw new Error("river shot prompt contains a cloud-only reference handle");
  return compiled;
}

export function createLowerBodyMaskArtifacts({ outputDir }) {
  mkdirSync(outputDir, { recursive: true });
  const baseMaskPath = resolve(outputDir, ".lower_body_union.pgm");
  const maskPath = resolve(outputDir, "mask.png");
  const lockedMaskPath = resolve(outputDir, "locked_region_mask.png");
  writeUnionPgm(baseMaskPath);
  try {
    run("ffmpeg", [
      "-y", "-v", "error", "-i", baseMaskPath,
      "-vf", `boxblur=${MASK_FEATHER_PIXELS}:1,format=rgb24`,
      "-frames:v", "1", "-pix_fmt", "rgb24", maskPath
    ]);
    run("ffmpeg", [
      "-y", "-v", "error", "-i", maskPath,
      "-vf", "lutrgb=r='if(gt(val,0),0,255)':g='if(gt(val,0),0,255)':b='if(gt(val,0),0,255)',format=rgb24",
      "-frames:v", "1", "-pix_fmt", "rgb24", lockedMaskPath
    ]);
  } finally {
    rmSync(baseMaskPath, { force: true });
  }
  for (const path of [maskPath, lockedMaskPath]) {
    const stream = probeImage(path);
    if (Number(stream.width) !== SOURCE_WIDTH || Number(stream.height) !== SOURCE_HEIGHT || stream.pix_fmt !== "rgb24") {
      throw new Error(`mask must be ${SOURCE_WIDTH}x${SOURCE_HEIGHT} RGB-encoded grayscale: ${path}`);
    }
  }
  return { maskPath, lockedMaskPath };
}

export function hardComposeMasked({ sourcePath, editedPath, maskPath, outputPath }) {
  assertSourceGeometry(sourcePath, "approved start");
  assertSourceGeometry(editedPath, "raw edit");
  assertSourceGeometry(maskPath, "feathered mask");
  run("ffmpeg", [
    "-y", "-v", "error", "-i", sourcePath, "-i", editedPath, "-i", maskPath,
    "-filter_complex", "[0:v][1:v][2:v]maskedmerge[out]",
    "-map", "[out]", "-frames:v", "1", "-pix_fmt", "rgb24", outputPath
  ]);
  assertSourceGeometry(outputPath, "hard composite");
  return outputPath;
}

export function assertLockedRegionUnchanged({ sourcePath, compositePath, lockedMaskPath }) {
  assertSourceGeometry(sourcePath, "approved start");
  assertSourceGeometry(compositePath, "hard composite");
  assertSourceGeometry(lockedMaskPath, "locked-region mask");
  const result = run("ffmpeg", [
    "-v", "error", "-i", sourcePath, "-i", compositePath, "-i", lockedMaskPath,
    "-filter_complex",
    `[0:v][1:v]blend=all_mode=difference[diff];color=c=black:s=${SOURCE_WIDTH}x${SOURCE_HEIGHT}[black];[black][diff][2:v]maskedmerge,format=rgb24[out]`,
    "-map", "[out]", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"
  ], { encoding: null });
  const changedByte = result.stdout.find((byte) => byte !== 0);
  if (changedByte !== undefined) {
    throw new Error(`locked-region raw difference contains a non-zero channel byte (${changedByte})`);
  }
  return { maximumChannelDifference: 0 };
}

function createStartEndEvidence({ sourcePath, compositePath, outputPath }) {
  run("ffmpeg", [
    "-y", "-v", "error", "-i", sourcePath, "-i", compositePath,
    "-filter_complex", "[0:v][1:v]hstack=inputs=2[out]",
    "-map", "[out]", "-frames:v", "1", "-pix_fmt", "rgb24", outputPath
  ]);
  const stream = probeImage(outputPath);
  if (Number(stream.width) !== SOURCE_WIDTH * 2 || Number(stream.height) !== SOURCE_HEIGHT) {
    throw new Error(`endpoint evidence must be ${SOURCE_WIDTH * 2}x${SOURCE_HEIGHT}`);
  }
}

export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function validateReportBeforeGeneration(report, candidate) {
  assertExperimentReportInvariant(report);
  if (report.approvedEndpoint) throw new Error("an approved endpoint already exists");
  if (report.endpointCandidates.some((item) => item.candidate === candidate)) {
    throw new Error(`endpoint candidate ${candidate} already exists`);
  }
  assertFile(report.authoritativeReportPath, "authoritative one-take report");
  assertAuthoritativeUnchanged(report, sha256File);
  assertFile(report.startFrame?.path, "approved start frame");
  if (sha256File(report.startFrame.path) !== report.startFrame.sha256) {
    throw new Error("approved start frame hash does not match the experiment snapshot");
  }
  if (Number(report.startFrame.width) !== SOURCE_WIDTH || Number(report.startFrame.height) !== SOURCE_HEIGHT) {
    throw new Error(`experiment start frame metadata must be ${SOURCE_WIDTH}x${SOURCE_HEIGHT}`);
  }
  assertSourceGeometry(report.startFrame.path, "approved start frame");
}

function commitCandidateReport({ reportPath, reportStateSha256, candidateRecord }) {
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
      throw new Error("FLF2V experiment report state changed during endpoint generation");
    }
    const lockedReport = JSON.parse(lockedBytes.toString("utf8"));
    assertExperimentReportInvariant(lockedReport);
    assertAuthoritativeUnchanged(lockedReport, sha256File);
    if (sha256File(lockedReport.startFrame.path) !== lockedReport.startFrame.sha256) {
      throw new Error("approved start frame hash changed during endpoint generation");
    }
    const committedReport = markEndpointTechnical(lockedReport, candidateRecord);
    assertExperimentReportInvariant(committedReport);
    temporaryPath = `${reportPath}.tmp-${process.pid}-${randomUUID()}`;
    writeFileSync(temporaryPath, `${JSON.stringify(committedReport, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, reportPath);
    temporaryPath = undefined;
    return committedReport;
  } finally {
    if (temporaryPath) rmSync(temporaryPath, { force: true });
    if (lockDescriptor !== undefined) closeSync(lockDescriptor);
    if (ownsLock) rmSync(lockPath, { force: true });
  }
}

function normalizeUploadedImage(uploaded, role) {
  if (typeof uploaded === "string" && uploaded.trim()) return uploaded.trim().replace(/\\/g, "/");
  const name = String(uploaded?.name || "").trim();
  const subfolder = String(uploaded?.subfolder || "").trim().replace(/\\/g, "/");
  if (!name) throw new Error(`Comfy upload returned no filename for ${role}`);
  return subfolder ? `${subfolder}/${name}` : name;
}

function defaultComfyAdapter(baseUrl, candidatePadded) {
  const endpoint = String(baseUrl).replace(/\/+$/, "");
  return {
    async fetchObjectInfo() {
      const response = await fetch(`${endpoint}/object_info`);
      if (!response.ok) throw new Error(`Comfy object_info failed ${response.status}: ${await response.text()}`);
      return response.json();
    },
    async uploadImage({ path, role }) {
      const form = new FormData();
      form.append("image", new Blob([readFileSync(path)], { type: "image/png" }), `${role}.png`);
      form.append("type", "input");
      form.append("subfolder", `wan-flf2v-endpoint/candidate_${candidatePadded}`);
      form.append("overwrite", "false");
      const response = await fetch(`${endpoint}/upload/image`, { method: "POST", body: form });
      if (!response.ok) throw new Error(`Comfy upload failed ${response.status}: ${await response.text()}`);
      return response.json();
    },
    async extractDWPose({ workflow, poseImagePath }) {
      const queued = await fetch(`${endpoint}/prompt`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: `wan-flf2v-dwpose-${candidatePadded}` })
      });
      if (!queued.ok) throw new Error(`Comfy DWPose queue failed ${queued.status}: ${await queued.text()}`);
      const promptId = String((await queued.json())?.prompt_id || "").trim();
      if (!promptId) throw new Error("Comfy DWPose queue returned no prompt_id");
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        const response = await fetch(`${endpoint}/history/${encodeURIComponent(promptId)}`);
        if (!response.ok) throw new Error(`Comfy DWPose history failed ${response.status}: ${await response.text()}`);
        const history = (await response.json())?.[promptId];
        if (history) {
          const rawOpenposeJson = history.outputs?.["2"]?.openpose_json;
          const openposeJson = rawOpenposeJson === undefined ? undefined : normalizeDWPoseHistoryJson(rawOpenposeJson);
          const images = history.outputs?.["3"]?.images;
          if (openposeJson && Array.isArray(images) && images.length === 1) {
            const image = images[0];
            const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || "", type: image.type || "output" });
            const view = await fetch(`${endpoint}/view?${query}`);
            if (!view.ok) throw new Error(`Comfy DWPose preview download failed ${view.status}: ${await view.text()}`);
            writeFileSync(poseImagePath, Buffer.from(await view.arrayBuffer()));
            return { promptId, openposeJson };
          }
          const status = String(history.status?.status_str || "").toLowerCase();
          if (history.status?.completed || ["success", "failed", "error"].includes(status)) throw new Error("Comfy DWPose completed without matching OpenPose JSON and preview");
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
      }
      throw new Error(`Comfy DWPose timed out: ${promptId}`);
    },
    async generateRawEdit({ workflow, outputPath }) {
      const queued = await fetch(`${endpoint}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: `wan-flf2v-endpoint-${candidatePadded}` })
      });
      if (!queued.ok) throw new Error(`Comfy queue failed ${queued.status}: ${await queued.text()}`);
      const queuedPayload = await queued.json();
      const promptId = String(queuedPayload?.prompt_id || "").trim();
      if (!promptId) throw new Error("Comfy queue returned no prompt_id");
      const deadline = Date.now() + 20 * 60 * 1000;
      while (Date.now() < deadline) {
        const historyResponse = await fetch(`${endpoint}/history/${encodeURIComponent(promptId)}`);
        if (!historyResponse.ok) throw new Error(`Comfy history failed ${historyResponse.status}: ${await historyResponse.text()}`);
        const history = (await historyResponse.json())?.[promptId];
        if (history) {
          const images = history.outputs?.[OUTPUT_NODE_ID]?.images;
          if (Array.isArray(images) && images.length === 1) {
            const image = images[0];
            const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || "", type: image.type || "output" });
            const view = await fetch(`${endpoint}/view?${query}`);
            if (!view.ok) throw new Error(`Comfy output download failed ${view.status}: ${await view.text()}`);
            writeFileSync(outputPath, Buffer.from(await view.arrayBuffer()));
            return { promptId };
          }
          const status = String(history.status?.status_str || "").toLowerCase();
          if (history.status?.completed || ["success", "failed", "error"].includes(status)) {
            throw new Error("Comfy prompt completed without exactly one raw SaveImage output");
          }
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 3000));
      }
      throw new Error(`Comfy prompt timed out: ${promptId}`);
    }
  };
}

export async function runEndpointCandidate(options, dependencies = {}) {
  const candidate = Number(options?.candidate);
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > ENDPOINT_SEEDS.length) {
    throw new Error(`candidate must be 1..${ENDPOINT_SEEDS.length}`);
  }
  const seed = ENDPOINT_SEEDS[candidate - 1];
  const reportPath = resolve(options.reportPath || DEFAULT_REPORT_PATH);
  const experimentRoot = resolve(options.experimentRoot || EXPERIMENT_ROOT);
  const shenYanPrimaryPath = resolve(options.shenYanPrimaryPath || DEFAULT_SHEN_YAN_PRIMARY_PATH);
  assertFile(reportPath, "FLF2V experiment report");
  const reportStateSha256 = sha256File(reportPath);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  validateReportBeforeGeneration(report, candidate);
  assertFile(shenYanPrimaryPath, "Shen Yan primary reference");

  const candidatePadded = String(candidate).padStart(3, "0");
  const endpointRoot = resolve(experimentRoot, "endpoint");
  const candidateDir = resolve(endpointRoot, `candidate_${candidatePadded}`);
  const candidateRelativePath = relative(endpointRoot, candidateDir);
  if (!candidateRelativePath || isAbsolute(candidateRelativePath) || candidateRelativePath === ".." || candidateRelativePath.startsWith(`..${sep}`)) {
    throw new Error("candidate output directory escaped the endpoint root");
  }
  if (existsSync(candidateDir)) throw new Error(`endpoint candidate ${candidate} output directory already exists`);
  mkdirSync(dirname(candidateDir), { recursive: true });
  mkdirSync(candidateDir, { recursive: false });
  const rawEditPath = resolve(candidateDir, "raw_edit.png");
  const compositePath = resolve(candidateDir, "composite.png");
  const evidencePath = resolve(candidateDir, "start_end.png");
  const { maskPath, lockedMaskPath } = createLowerBodyMaskArtifacts({ outputDir: candidateDir });

  const poseGuided = options.poseGuided === true;
  const preset = JSON.parse(readFileSync(poseGuided ? POSE_PRESET_PATH : PRESET_PATH, "utf8"));
  const comfy = dependencies.fetchObjectInfo && dependencies.uploadImage && dependencies.generateRawEdit && (!poseGuided || dependencies.extractDWPose)
    ? dependencies
    : defaultComfyAdapter(options.comfyUrl || process.env.COMFYUI_URL || "http://127.0.0.1:8188", candidatePadded);
  const objectInfo = await comfy.fetchObjectInfo();
  let workflow;
  let poseMetadata = null;
  if (poseGuided) {
    const dwposePreset = JSON.parse(readFileSync(DWPOSE_PRESET_PATH, "utf8"));
    const riverContract = JSON.parse(readFileSync(RIVER_SHOT_CONTRACT_PATH, "utf8"));
    validateDWPoseObjectInfo(dwposePreset, objectInfo);
    validatePoseEndpointPresetObjectInfo(preset, objectInfo);
    const uploadedStart = normalizeUploadedImage(await comfy.uploadImage({ path: report.startFrame.path, role: "start" }), "start");
    const dwposeWorkflow = compileDWPoseWorkflow(dwposePreset, { START_FRAME_PATH: uploadedStart, CANDIDATE_PADDED: candidatePadded });
    const dwposePreviewPath = resolve(candidateDir, "dwpose_preview.png");
    const extracted = await comfy.extractDWPose({ workflow: dwposeWorkflow, poseImagePath: dwposePreviewPath });
    assertFile(dwposePreviewPath, "DWPose preview");
    const transformed = buildHalfStepTarget(extracted.openposeJson);
    const poseEvidence = writePoseEvidence({ ...transformed, outputDir: candidateDir });
    const compiledPrompt = compileRiverShotPrompt(riverContract);
    const promptBlockHashes = Object.fromEntries(Object.entries(riverContract.blocks).map(([name, block]) => [name, block.sha256]));
    const compiledPromptSha256 = createHash("sha256").update(compiledPrompt).digest("hex");
    const uploadedReference = normalizeUploadedImage(await comfy.uploadImage({ path: shenYanPrimaryPath, role: "shen_yan_primary" }), "Shen Yan reference");
    const uploadedPose = normalizeUploadedImage(await comfy.uploadImage({ path: poseEvidence.poseGuidePath, role: "pose_guide" }), "pose guide");
    workflow = compileDWPoseWorkflow(preset, {
      START_FRAME_PATH: uploadedStart, SHEN_YAN_PRIMARY_PATH: uploadedReference, POSE_GUIDE_PATH: uploadedPose,
      RIVER_SHOT_PROMPT: compiledPrompt, SEED: seed, CANDIDATE_PADDED: candidatePadded
    });
    poseMetadata = {
      poseGuided: true, dwposePromptId: extracted.promptId, qwenPromptId: null, motion: transformed.motion,
      ...poseEvidence, promptBlockHashes, compiledPromptSha256,
      startFrameSha256: report.startFrame.sha256, shenYanPrimarySha256: sha256File(shenYanPrimaryPath),
      maskInvariantSha256: sha256File(maskPath)
    };
    const firstPose = report.endpointCandidates.find((item) => item.poseGuided === true);
    if (firstPose) for (const field of ["targetPoseSha256", "poseGuideSha256", "startFrameSha256", "shenYanPrimarySha256", "maskInvariantSha256", "compiledPromptSha256"]) {
      if (firstPose[field] !== poseMetadata[field]) throw new Error(`pose retry invariant changed: ${field}`);
    }
    if (firstPose && JSON.stringify(firstPose.promptBlockHashes) !== JSON.stringify(promptBlockHashes)) throw new Error("pose retry prompt block hashes changed");
  } else {
    validatePresetObjectInfo(preset, objectInfo);
    const uploadedStart = normalizeUploadedImage(await comfy.uploadImage({ path: report.startFrame.path, role: "start" }), "start");
    const uploadedReference = normalizeUploadedImage(await comfy.uploadImage({ path: shenYanPrimaryPath, role: "shen_yan_primary" }), "Shen Yan reference");
    const uploadedMask = normalizeUploadedImage(await comfy.uploadImage({ path: maskPath, role: "lower_body_mask" }), "lower-body mask");
    workflow = compileEndpointWorkflow(preset, { START_FRAME_PATH: uploadedStart, SHEN_YAN_PRIMARY_PATH: uploadedReference, LOWER_BODY_MASK_PATH: uploadedMask, SEED: seed, CANDIDATE_PADDED: candidatePadded });
  }
  const generation = await comfy.generateRawEdit({ workflow, outputPath: rawEditPath });
  assertSourceGeometry(rawEditPath, "Qwen raw edit");
  hardComposeMasked({ sourcePath: report.startFrame.path, editedPath: rawEditPath, maskPath, outputPath: compositePath });
  const lockedRegion = assertLockedRegionUnchanged({ sourcePath: report.startFrame.path, compositePath, lockedMaskPath });
  createStartEndEvidence({ sourcePath: report.startFrame.path, compositePath, outputPath: evidencePath });

  const candidateRecord = {
    candidate,
    seed,
    promptId: generation?.promptId || null,
    rawEditPath,
    rawEditPath,
    rawEditSha256: sha256File(rawEditPath),
    maskPath,
    maskSha256: sha256File(maskPath),
    lockedRegionMaskPath: lockedMaskPath,
    lockedRegionMaskSha256: sha256File(lockedMaskPath),
    lockedRegionMaximumChannelDifference: lockedRegion.maximumChannelDifference,
    endpointPath: compositePath,
    endpointSha256: sha256File(compositePath),
    compositePath,
    compositeSha256: sha256File(compositePath),
    evidencePath,
    evidenceSha256: sha256File(evidencePath),
    ...(poseMetadata ? { ...poseMetadata, qwenPromptId: generation?.promptId || null } : {})
  };
  const proposedReport = markEndpointTechnical(report, candidateRecord);
  assertAuthoritativeUnchanged(report, sha256File);
  if (typeof dependencies.beforeReportWrite === "function") await dependencies.beforeReportWrite(proposedReport);
  const updatedReport = commitCandidateReport({ reportPath, reportStateSha256, candidateRecord });
  return { candidate: updatedReport.endpointCandidates.at(-1), report: updatedReport, reportPath };
}

async function main() {
  const parsed = parseEndpointArguments(process.argv.slice(2));
  const result = await runEndpointCandidate(parsed);
  process.stdout.write(`${JSON.stringify({ reportPath: result.reportPath, candidate: result.candidate }, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
