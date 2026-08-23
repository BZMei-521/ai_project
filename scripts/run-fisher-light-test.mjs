#!/usr/bin/env node

import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const repoRoot = process.cwd();

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [key, inlineValue] = token.split("=", 2);
    const name = key.slice(2);
    if (inlineValue !== undefined) {
      output[name] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      output[name] = next;
      index += 1;
      continue;
    }
    output[name] = "1";
  }
  return output;
}

const args = parseArgs(process.argv.slice(2));
const comfyBaseUrl = String(args.baseUrl || "http://127.0.0.1:8188").replace(/\/+$/, "");
const timeoutMs = Math.max(10_000, Number(args.timeoutMs || 15 * 60 * 1000));
const pollMs = Math.max(500, Number(args.pollMs || 1200));
const shotPrefix = String(args.shot || "shot_river_continuity_001").trim();
const runTag = String(args.tag || `fisher_pair_${Date.now()}`).trim();
const seed = Number.isFinite(Number(args.seed)) ? Number(args.seed) : 2026040701;
const steps = Number.isFinite(Number(args.steps)) ? Number(args.steps) : 10;
const cfg = Number.isFinite(Number(args.cfg)) ? Number(args.cfg) : 1.5;
const denoise = Number.isFinite(Number(args.denoise)) ? Number(args.denoise) : 0.32;
const samplerName = String(args.sampler || "sa_solver").trim();
const scheduler = String(args.scheduler || "beta").trim();
const passASeed = Number.isFinite(Number(args.passASeed)) ? Number(args.passASeed) : seed;
const passASteps = Math.max(4, Number(args.passASteps || 7));
const passACfg = Math.max(0.1, Number(args.passACfg || 1.2));
const passADenoise = Math.max(0, Math.min(1, Number(args.passADenoise || 0.82)));
const passASamplerName = String(args.passASampler || samplerName).trim();
const passAScheduler = String(args.passAScheduler || scheduler).trim();
const stageAPositiveMode = String(args.stageAPositiveMode || "full_ref").trim().toLowerCase();
const stageAFrontOnlyRefs = String(args.stageAFrontOnlyRefs || "0").trim() === "1";
const stageBFrontOnlyRefs = String(args.stageBFrontOnlyRefs || "0").trim() === "1";
const stageAMainImageIndex = Math.max(1, Math.min(5, Number(args.stageAMainImageIndex || 1)));
const stageBMainImageIndex = Math.max(1, Math.min(5, Number(args.stageBMainImageIndex || 1)));
const stageBMaskedInpaint = String(args.stageBMaskedInpaint || "0").trim() === "1";
const maskLayout = String(args.maskLayout || "female_target").trim();
const maskedLatentMode = String(args.maskedLatentMode || "noise_mask").trim().toLowerCase();
const maskWidth = Math.max(512, Number(args.maskWidth || 1024));
const maskHeight = Math.max(512, Number(args.maskHeight || 576));
const growMaskBy = Math.max(0, Number(args.growMaskBy || 28));
const passBSeed = Number.isFinite(Number(args.passBSeed)) ? Number(args.passBSeed) : seed;
const passBSteps = Math.max(6, Number(args.passBSteps || steps));
const passBCfg = Math.max(0.1, Number(args.passBCfg || cfg));
const passBDenoise = Math.max(0, Math.min(1, Number(args.passBDenoise || denoise)));
const passBSamplerName = String(args.passBSampler || samplerName).trim();
const passBScheduler = String(args.passBScheduler || scheduler).trim();
const maskFile = String(args.maskFile || `${runTag}_${maskLayout}_${maskWidth}x${maskHeight}.png`).trim();
const char1SideRef = String(args.char1SideRef || "side").trim().toLowerCase();
const char1BackRef = String(args.char1BackRef || "front").trim().toLowerCase();
const char2SideRef = String(args.char2SideRef || "side").trim().toLowerCase();
const char2BackRef = String(args.char2BackRef || "front").trim().toLowerCase();
const presetPath = path.join(
  repoRoot,
  "src",
  "modules",
  "comfy-pipeline",
  "presets",
  "storyboard-image-fisher-light-v1.json"
);
const comfyRoot =
  args.comfyRoot || "C:/Users/Administrator/Desktop/AiProject/ComfyUI_JM_windows_portable";
const comfyInputDir = path.join(comfyRoot, "ComfyUI", "input");
const comfyOutputDir = path.join(comfyRoot, "ComfyUI", "output");

const promptA =
  String(args.promptA || "").trim() ||
  [
    "Next Scene: clean cinematic riverside storyboard frame, exactly one person only.",
    "Character A is the young man in a dark blue long coat and stands on the right side of the frame.",
    "He must be full body from head to feet in a left-facing front three-quarter view with the face clearly visible, not a back view, and not a profile-only view.",
    "His left hand gently reaches inward toward the empty center as if ready to hold someone else's hand, and his right arm stays relaxed.",
    "Keep the stone bridge dusk environment clean and leave open standing space on the left side for Character B.",
    "No other people, no duplicate limbs, no crop, no poster layout, and no dirty artifacts."
  ].join(" ");

const promptB =
  String(args.promptB || "").trim() ||
  [
    "Next Scene: preserve the clean riverside frame and preserve Character A exactly on the right.",
    "Add Character B on the left beside Character A inside the empty left-side space only.",
    "Generate exactly two people only.",
    "Character A is a young man in a dark blue long coat, Character B is a young woman in a light blue dress.",
    "They stand close together, gently facing each other in soft front three-quarter view, naturally holding hands at the centerline.",
    "Both people must be full body from head to feet, with natural anatomy, complete hands, grounded feet, readable faces, clean silhouettes, and no halos.",
    "Do not change the existing background or Character A outside the new masked insertion region.",
    "No extra people, no extra arms, no extra legs, no duplicate heads, no warped anatomy, and no messy artifacts."
  ].join(" ");

const customInstructionAInput = String(args.instructionA || "").trim();
const customInstructionBInput = String(args.instructionB || "").trim();

const instructionA =
  customInstructionAInput ||
  [
    "Picture 1 is the clean riverside scene and must stay clean.",
    "Picture 2 is Character A front view and is the primary identity reference.",
    "Picture 3 is Character A side view and is only for coat silhouette support.",
    "Picture 4 is Character A outfit support and must not force the character to turn away from camera.",
    "Generate exactly one human only in this pass.",
    "Character A is the young man in a dark blue long coat and must appear on the right side of the frame.",
    "Use a left-facing front three-quarter view with the face clearly visible and the body gently turned left toward the open space.",
    "Do not use a back-facing pose and do not hide the face.",
    "Character A must be full body from head to feet, with natural anatomy, clear hands, grounded feet, and stable identity details from the turnaround views.",
    "His left hand should reach slightly inward toward the empty center as if ready to meet another hand later.",
    "Keep the bridge, riverbank, camera framing, perspective, and dusk lighting consistent.",
    "Leave clear open standing space on the left side for Character B.",
    "No extra people, no duplicate body parts, no cutout look, and no dirty artifacts."
  ].join("\n");

const instructionB =
  customInstructionBInput ||
  [
    "Picture 1 is the already-composed storyboard frame containing the clean scene and Character A.",
    "Picture 2 is Character A identity lock and must preserve Character A face, hairstyle, outfit, and body shape.",
    "Picture 3 is Character B front view and is the primary identity reference.",
    "Picture 4 is Character B side view and is only for silhouette support.",
    "Picture 5 is Character B outfit support and must not force a back-facing pose.",
    "Generate exactly two people only.",
    "Keep Character A on the right and add Character B on the left beside Character A.",
    "Only create Character B inside the empty left-side region and keep everything outside that insertion region unchanged.",
    "Character B must face right in a front three-quarter view with the face clearly visible, and her right hand should meet Character A left hand at the centerline.",
    "Both people must be full body from head to feet, standing close together in gentle three-quarter view, naturally holding hands at the centerline.",
    "Preserve readable faces, complete hands, grounded feet, natural anatomy, and clean silhouettes.",
    "Keep the riverbank environment, perspective, ground plane, and dusk lighting from Picture 1.",
    "No extra people, no extra limbs, no duplicate heads, no sticker edges, no white halo, and no dirty artifacts."
  ].join("\n");

const instructionAFrontOnly =
  customInstructionAInput ||
  [
    "Picture 1 is the clean riverside scene and must stay clean.",
    "Picture 2 is Character A front view and is the primary identity reference.",
    "Generate exactly one human only in this pass.",
    "Character A is the young man in a dark blue long coat and must appear on the right side of the frame.",
    "Use a left-facing front three-quarter view with the face clearly visible.",
    "Character A must be full body from head to feet, with natural anatomy, clear hands, grounded feet, and stable identity details from Picture 2.",
    "His left hand should reach slightly inward toward the empty center as if ready to meet another hand later.",
    "Keep the bridge, riverbank, camera framing, perspective, and dusk lighting consistent.",
    "Leave clear open standing space on the left side for Character B.",
    "No extra people, no duplicate body parts, no cutout look, and no dirty artifacts."
  ].join("\n");

const instructionBFrontOnly =
  customInstructionBInput ||
  [
    "Picture 1 is the already-composed storyboard frame containing the clean scene and Character A.",
    "Picture 2 is Character A identity lock and must preserve Character A face, hairstyle, outfit, and body shape.",
    "Picture 3 is Character B front view and is the primary identity reference.",
    "Generate exactly two people only.",
    "Keep Character A on the right and add Character B on the left beside Character A.",
    "Only create Character B inside the empty left-side region and keep everything outside that insertion region unchanged.",
    "Character B must face right in a front three-quarter view with the face clearly visible, and her right hand should meet Character A left hand at the centerline.",
    "Both people must be full body from head to feet, standing close together in gentle three-quarter view, naturally holding hands at the centerline.",
    "Preserve readable faces, complete hands, grounded feet, natural anatomy, and clean silhouettes.",
    "Keep the riverbank environment, perspective, ground plane, and dusk lighting from Picture 1.",
    "No extra people, no extra limbs, no duplicate heads, no sticker edges, no white halo, and no dirty artifacts."
  ].join("\n");

function workflowNodes(workflow) {
  return Array.isArray(workflow.nodes) ? workflow.nodes : [];
}

function workflowLinks(workflow) {
  if (!Array.isArray(workflow.links)) workflow.links = [];
  return workflow.links;
}

function isNodeDisabled(node) {
  return typeof node?.mode === "number" && node.mode === 4;
}

function setNodeWidgetValue(node, index, value) {
  if (!node || !Array.isArray(node.widgets_values) || index < 0) return;
  while (node.widgets_values.length <= index) node.widgets_values.push(null);
  node.widgets_values[index] = value;
}

function isKSamplerControlAfterGenerateValue(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "fixed" || normalized === "randomize" || normalized === "increment" || normalized === "decrement";
}

function setKSamplerWidgetValues(node, values) {
  if (!node || !Array.isArray(node.widgets_values) || node.widgets_values.length === 0) return;
  const hasControlAfterGenerateSlot =
    node.widgets_values.length >= 7 && isKSamplerControlAfterGenerateValue(node.widgets_values[1]);
  setNodeWidgetValue(node, 0, values.seed);
  if (hasControlAfterGenerateSlot) {
    setNodeWidgetValue(node, 1, values.controlAfterGenerate ?? "fixed");
    setNodeWidgetValue(node, 2, values.steps);
    setNodeWidgetValue(node, 3, values.cfg);
    setNodeWidgetValue(node, 4, values.samplerName);
    setNodeWidgetValue(node, 5, values.scheduler);
    setNodeWidgetValue(node, 6, values.denoise);
    return;
  }
  setNodeWidgetValue(node, 1, values.steps);
  setNodeWidgetValue(node, 2, values.cfg);
  setNodeWidgetValue(node, 3, values.samplerName);
  setNodeWidgetValue(node, 4, values.scheduler);
  setNodeWidgetValue(node, 5, values.denoise);
}

function getNodeByIdMap(workflow) {
  const map = new Map();
  for (const node of workflowNodes(workflow)) {
    if (typeof node?.id === "number") map.set(node.id, node);
  }
  return map;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    value = CRC_TABLE[(value ^ buffer[index]) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function encodePngRgba(widthPx, heightPx, rgba) {
  const raw = Buffer.alloc((widthPx * 4 + 1) * heightPx);
  for (let y = 0; y < heightPx; y += 1) {
    const rowStart = y * (widthPx * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * widthPx * 4, (y + 1) * widthPx * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(widthPx, 0);
  header.writeUInt32BE(heightPx, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function setPixel(buffer, widthPx, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= widthPx) return;
  const offset = (y * widthPx + x) * 4;
  buffer[offset] = r;
  buffer[offset + 1] = g;
  buffer[offset + 2] = b;
  buffer[offset + 3] = a;
}

function fillRect(buffer, widthPx, heightPx, x, y, w, h, color) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(widthPx, Math.ceil(x + w));
  const y1 = Math.min(heightPx, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy += 1) {
    for (let xx = x0; xx < x1; xx += 1) {
      setPixel(buffer, widthPx, xx, yy, color[0], color[1], color[2], color[3] ?? 255);
    }
  }
}

function fillEllipse(buffer, widthPx, heightPx, cx, cy, rx, ry, color) {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const x1 = Math.min(widthPx, Math.ceil(cx + rx));
  const y1 = Math.min(heightPx, Math.ceil(cy + ry));
  for (let yy = y0; yy < y1; yy += 1) {
    for (let xx = x0; xx < x1; xx += 1) {
      const dx = (xx + 0.5 - cx) / Math.max(1, rx);
      const dy = (yy + 0.5 - cy) / Math.max(1, ry);
      if (dx * dx + dy * dy <= 1) {
        setPixel(buffer, widthPx, xx, yy, color[0], color[1], color[2], color[3] ?? 255);
      }
    }
  }
}

function fillPolygon(buffer, widthPx, heightPx, points, color) {
  const ys = points.map((point) => point[1]);
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(heightPx - 1, Math.ceil(Math.max(...ys)));
  for (let yy = minY; yy <= maxY; yy += 1) {
    const scanY = yy + 0.5;
    const intersections = [];
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if ((a[1] <= scanY && b[1] > scanY) || (b[1] <= scanY && a[1] > scanY)) {
        const t = (scanY - a[1]) / (b[1] - a[1]);
        intersections.push(a[0] + (b[0] - a[0]) * t);
      }
    }
    intersections.sort((left, right) => left - right);
    for (let index = 0; index < intersections.length; index += 2) {
      const x0 = Math.max(0, Math.floor(intersections[index]));
      const x1 = Math.min(widthPx - 1, Math.ceil(intersections[index + 1] ?? intersections[index]));
      for (let xx = x0; xx <= x1; xx += 1) {
        setPixel(buffer, widthPx, xx, yy, color[0], color[1], color[2], color[3] ?? 255);
      }
    }
  }
}

async function ensureMaskFile(filePath, widthPx, heightPx, layout) {
  if (fssync.existsSync(filePath)) return;
  const rgba = Buffer.alloc(widthPx * heightPx * 4, 255);
  const black = [0, 0, 0, 255];
  const green = [0, 255, 0, 255];
  fillRect(rgba, widthPx, heightPx, 0, 0, widthPx, heightPx, black);

  if (layout === "female_target") {
    const cx = Math.round(widthPx * 0.31);
    fillEllipse(rgba, widthPx, heightPx, cx, Math.round(heightPx * 0.20), Math.round(widthPx * 0.055), Math.round(heightPx * 0.085), green);
    fillPolygon(
      rgba,
      widthPx,
      heightPx,
      [
        [cx - Math.round(widthPx * 0.055), Math.round(heightPx * 0.28)],
        [cx + Math.round(widthPx * 0.052), Math.round(heightPx * 0.28)],
        [cx + Math.round(widthPx * 0.075), Math.round(heightPx * 0.70)],
        [cx + Math.round(widthPx * 0.040), Math.round(heightPx * 0.96)],
        [cx - Math.round(widthPx * 0.070), Math.round(heightPx * 0.96)],
        [cx - Math.round(widthPx * 0.082), Math.round(heightPx * 0.72)]
      ],
      green
    );
    fillPolygon(
      rgba,
      widthPx,
      heightPx,
      [
        [cx + Math.round(widthPx * 0.020), Math.round(heightPx * 0.36)],
        [cx + Math.round(widthPx * 0.118), Math.round(heightPx * 0.42)],
        [cx + Math.round(widthPx * 0.158), Math.round(heightPx * 0.53)],
        [cx + Math.round(widthPx * 0.128), Math.round(heightPx * 0.60)],
        [cx + Math.round(widthPx * 0.062), Math.round(heightPx * 0.56)],
        [cx + Math.round(widthPx * 0.004), Math.round(heightPx * 0.46)]
      ],
      green
    );
    fillPolygon(
      rgba,
      widthPx,
      heightPx,
      [
        [cx - Math.round(widthPx * 0.012), Math.round(heightPx * 0.35)],
        [cx - Math.round(widthPx * 0.094), Math.round(heightPx * 0.42)],
        [cx - Math.round(widthPx * 0.118), Math.round(heightPx * 0.53)],
        [cx - Math.round(widthPx * 0.090), Math.round(heightPx * 0.59)],
        [cx - Math.round(widthPx * 0.036), Math.round(heightPx * 0.54)],
        [cx + Math.round(widthPx * 0.010), Math.round(heightPx * 0.46)]
      ],
      green
    );
  } else {
    const cx = Math.round(widthPx * 0.30);
    fillEllipse(rgba, widthPx, heightPx, cx, Math.round(heightPx * 0.19), Math.round(widthPx * 0.05), Math.round(heightPx * 0.08), green);
    fillRect(rgba, widthPx, heightPx, cx - Math.round(widthPx * 0.06), Math.round(heightPx * 0.27), Math.round(widthPx * 0.12), Math.round(heightPx * 0.46), green);
    fillRect(rgba, widthPx, heightPx, cx - Math.round(widthPx * 0.08), Math.round(heightPx * 0.35), Math.round(widthPx * 0.16), Math.round(heightPx * 0.16), green);
    fillRect(rgba, widthPx, heightPx, cx - Math.round(widthPx * 0.05), Math.round(heightPx * 0.73), Math.round(widthPx * 0.03), Math.round(heightPx * 0.20), green);
    fillRect(rgba, widthPx, heightPx, cx + Math.round(widthPx * 0.02), Math.round(heightPx * 0.73), Math.round(widthPx * 0.03), Math.round(heightPx * 0.20), green);
  }

  await fs.writeFile(filePath, encodePngRgba(widthPx, heightPx, rgba));
}

async function ensureComfyInputImage(filename) {
  const trimmed = String(filename || "").trim();
  if (!trimmed) return "";
  if (!/[\\/]/.test(trimmed) && !/^[A-Za-z]:/.test(trimmed)) {
    return trimmed;
  }
  const sourcePath = path.resolve(trimmed);
  const targetPath = path.join(comfyInputDir, path.basename(sourcePath));
  if (!fssync.existsSync(sourcePath)) {
    throw new Error(`Input image not found: ${sourcePath}`);
  }
  if (!fssync.existsSync(targetPath)) {
    await fs.copyFile(sourcePath, targetPath);
  }
  return path.basename(targetPath);
}

function resolveCharacterViewRef(shotPrefix, charIndex, choice) {
  const normalized = String(choice || "").trim().toLowerCase();
  const suffix = normalized === "front" || normalized === "side" || normalized === "back" ? normalized : "front";
  return `${shotPrefix}_char${charIndex}_${suffix}_path.png`;
}

function hasWidgetMeta(input) {
  return Boolean(input?.widget) && typeof input.widget === "object" && !Array.isArray(input.widget);
}

function isNumericString(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && !Number.isNaN(Number(trimmed));
}

function isValueCompatibleForInputType(value, type) {
  if (Array.isArray(type)) return type.length === 0 || type.some((item) => String(item) === String(value));
  if (typeof type !== "string") return true;
  const normalized = type.toUpperCase();
  if (normalized === "INT") {
    return typeof value === "number" ? Number.isInteger(value) : isNumericString(value) && Number.isInteger(Number(value));
  }
  if (normalized === "FLOAT" || normalized === "DOUBLE" || normalized === "NUMBER") {
    return typeof value === "number" || isNumericString(value);
  }
  if (normalized === "BOOLEAN") {
    if (typeof value === "boolean") return true;
    if (typeof value === "number") return value === 0 || value === 1;
    if (typeof value === "string") {
      const lower = value.trim().toLowerCase();
      return lower === "true" || lower === "false" || lower === "0" || lower === "1";
    }
    return false;
  }
  return true;
}

function buildWidgetValuesByInputName(node) {
  const output = {};
  const nodeInputs = Array.isArray(node.inputs) ? node.inputs : [];
  const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : [];
  let cursor = 0;
  const widgetInputs = nodeInputs.filter((input) => input && hasWidgetMeta(input) && typeof input.name === "string");
  for (const input of widgetInputs) {
    const name = String(input.name).trim();
    if (!name) continue;
    if (
      (node?.type ?? "") === "KSampler" &&
      name === "steps" &&
      cursor === 1 &&
      widgets.length > 1 &&
      isKSamplerControlAfterGenerateValue(widgets[1])
    ) {
      cursor = 2;
    }
    const expectedType = input.type;
    let chosenIndex = -1;
    for (let idx = cursor; idx < widgets.length; idx += 1) {
      if (isValueCompatibleForInputType(widgets[idx], expectedType)) {
        chosenIndex = idx;
        break;
      }
    }
    if (chosenIndex < 0) {
      if (cursor >= widgets.length) break;
      chosenIndex = cursor;
    }
    output[name] = widgets[chosenIndex];
    cursor = chosenIndex + 1;
  }
  return output;
}

function graphWorkflowToApiPrompt(workflow) {
  const nodes = workflowNodes(workflow);
  const activeNodeIds = new Set();
  for (const node of nodes) {
    if (isNodeDisabled(node)) continue;
    const id = typeof node.id === "number" || typeof node.id === "string" ? String(node.id) : "";
    if (id) activeNodeIds.add(id);
  }

  const links = workflowLinks(workflow);
  const linkById = new Map();
  const linkedNodeIds = new Set();
  for (const link of links) {
    if (!Array.isArray(link) || link.length < 5) continue;
    const sourceNodeId = String(link[1]);
    const targetNodeId = String(link[3]);
    if (!activeNodeIds.has(sourceNodeId) || !activeNodeIds.has(targetNodeId)) continue;
    linkById.set(Number(link[0]), link);
    linkedNodeIds.add(sourceNodeId);
    linkedNodeIds.add(targetNodeId);
  }

  const prompt = {};
  for (const node of nodes) {
    if (isNodeDisabled(node)) continue;
    const nodeType = typeof node.type === "string" ? node.type.trim() : "";
    const nodeId = typeof node.id === "number" || typeof node.id === "string" ? String(node.id) : "";
    if (!nodeType || !nodeId || !linkedNodeIds.has(nodeId)) continue;
    const inputValues = {};
    const nodeInputs = Array.isArray(node.inputs) ? node.inputs : [];
    const widgetByInputName = buildWidgetValuesByInputName(node);
    for (const rawInput of nodeInputs) {
      if (!rawInput || typeof rawInput !== "object") continue;
      const name = typeof rawInput.name === "string" ? rawInput.name.trim() : "";
      if (!name) continue;
      if (typeof rawInput.link === "number") {
        const link = linkById.get(rawInput.link);
        if (link) {
          inputValues[name] = [String(link[1]), Number(link[2])];
          continue;
        }
      }
      if (Object.prototype.hasOwnProperty.call(widgetByInputName, name)) {
        inputValues[name] = widgetByInputName[name];
      }
    }
    for (const [name, value] of Object.entries(widgetByInputName)) {
      if (!Object.prototype.hasOwnProperty.call(inputValues, name)) inputValues[name] = value;
    }
    prompt[nodeId] = { class_type: nodeType, inputs: inputValues };
  }
  return prompt;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${await response.text()}`);
  }
  return response.json();
}

function collectNodeOutputImages(historyEntry, nodeId) {
  const nodeOutput = historyEntry?.outputs?.[String(nodeId)];
  const maybeImages = nodeOutput?.images;
  if (!Array.isArray(maybeImages)) return [];
  return maybeImages
    .filter((asset) => asset && typeof asset === "object" && String(asset.filename || "").trim())
    .map((asset) => ({
      filename: String(asset.filename).trim(),
      subfolder: String(asset.subfolder || "").trim(),
      type: String(asset.type || "output").trim() || "output"
    }));
}

async function queuePrompt(baseUrl, prompt) {
  const payload = await fetchJson(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, client_id: "run-fisher-light-test" })
  });
  const promptId = String(payload?.prompt_id || "").trim();
  if (!promptId) throw new Error("Comfy returned no prompt_id");
  return promptId;
}

async function waitPromptOutputs(baseUrl, promptId, nodeIds) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const history = await fetchJson(`${baseUrl}/history/${encodeURIComponent(promptId)}`);
    const entry = history?.[promptId];
    if (entry) {
      const outputMap = {};
      for (const nodeId of nodeIds) {
        const assets = collectNodeOutputImages(entry, nodeId);
        if (assets.length > 0) outputMap[nodeId] = assets;
      }
      if (Object.keys(outputMap).length > 0) return outputMap;
      const status = entry?.status;
      const statusText = String(status?.status_str || "").toLowerCase();
      if (status?.completed === true || statusText === "success" || statusText === "failed" || statusText === "error") {
        throw new Error(`Prompt completed but no expected image outputs found (status=${statusText || "unknown"})`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Timed out waiting for prompt ${promptId}`);
}

const workflow = JSON.parse(await fs.readFile(presetPath, "utf8"));
const byId = getNodeByIdMap(workflow);

await fs.mkdir(comfyInputDir, { recursive: true });
const sceneRef = await ensureComfyInputImage(`${shotPrefix}_scene_ref_path.png`);
const char1Front = await ensureComfyInputImage(resolveCharacterViewRef(shotPrefix, 1, "front"));
const char1Side = await ensureComfyInputImage(resolveCharacterViewRef(shotPrefix, 1, char1SideRef));
const char1Back = await ensureComfyInputImage(resolveCharacterViewRef(shotPrefix, 1, char1BackRef));
const char2Front = await ensureComfyInputImage(resolveCharacterViewRef(shotPrefix, 2, "front"));
const char2Side = await ensureComfyInputImage(resolveCharacterViewRef(shotPrefix, 2, char2SideRef));
const char2Back = await ensureComfyInputImage(resolveCharacterViewRef(shotPrefix, 2, char2BackRef));
const char1Identity = char1Front;

setNodeWidgetValue(byId.get(297), 0, sceneRef);
setNodeWidgetValue(byId.get(299), 0, char1Front);
setNodeWidgetValue(byId.get(300), 0, char1Side);
setNodeWidgetValue(byId.get(302), 0, char1Back);
setNodeWidgetValue(byId.get(305), 0, char2Front);
setNodeWidgetValue(byId.get(306), 0, char2Side);
setNodeWidgetValue(byId.get(307), 0, char2Back);
setNodeWidgetValue(byId.get(308), 0, char1Identity);

setNodeWidgetValue(byId.get(298), 0, promptA);
setNodeWidgetValue(byId.get(304), 0, promptB);
setNodeWidgetValue(byId.get(303), 2, stageAMainImageIndex);
setNodeWidgetValue(byId.get(309), 2, stageBMainImageIndex);
setNodeWidgetValue(byId.get(303), 7, stageAFrontOnlyRefs ? instructionAFrontOnly : instructionA);
setNodeWidgetValue(byId.get(309), 7, stageBFrontOnlyRefs ? instructionBFrontOnly : instructionB);
setNodeWidgetValue(byId.get(313), 0, `Storyboard/${runTag}_passA`);
setNodeWidgetValue(byId.get(283), 0, `Storyboard/${runTag}_final`);
setNodeWidgetValue(byId.get(235), 0, steps);
setKSamplerWidgetValues(byId.get(218), {
  seed: passASeed,
  steps: passASteps,
  cfg: passACfg,
  samplerName: passASamplerName,
  scheduler: passAScheduler,
  denoise: passADenoise,
  controlAfterGenerate: "fixed"
});
setKSamplerWidgetValues(byId.get(311), {
  seed: passBSeed,
  steps: passBSteps,
  cfg: passBCfg,
  samplerName: passBSamplerName,
  scheduler: passBScheduler,
  denoise: passBDenoise,
  controlAfterGenerate: "fixed"
});

const prompt = graphWorkflowToApiPrompt(workflow);
if (stageAFrontOnlyRefs && prompt["303"]?.inputs) {
  delete prompt["303"].inputs.image3;
  delete prompt["303"].inputs.image4;
}
if (stageBFrontOnlyRefs && prompt["309"]?.inputs) {
  delete prompt["309"].inputs.image4;
  delete prompt["309"].inputs.image5;
}
if (prompt["218"]?.inputs) {
  prompt["218"].inputs.seed = passASeed;
  prompt["218"].inputs.steps = passASteps;
  prompt["218"].inputs.cfg = passACfg;
  prompt["218"].inputs.sampler_name = passASamplerName;
  prompt["218"].inputs.scheduler = passAScheduler;
  prompt["218"].inputs.denoise = passADenoise;
  prompt["218"].inputs.positive = stageAPositiveMode === "main_ref" ? ["303", 7] : ["303", 0];
}
if (stageBMaskedInpaint) {
  const comfyMaskFile = await ensureComfyInputImage(maskFile);
  const comfyMaskPath = path.join(comfyInputDir, comfyMaskFile);
  await ensureMaskFile(comfyMaskPath, maskWidth, maskHeight, maskLayout);
  prompt["500"] = {
    class_type: "LoadImage",
    inputs: { image: comfyMaskFile }
  };
  prompt["501"] = {
    class_type: "MaskFromRGBCMYBW+",
    inputs: {
      image: ["500", 0],
      threshold_r: 0.12,
      threshold_g: 0.12,
      threshold_b: 0.12
    }
  };
  prompt["502"] =
    maskedLatentMode === "vae_inpaint"
      ? {
          class_type: "VAEEncodeForInpaint",
          inputs: {
            pixels: ["217", 0],
            vae: ["277", 2],
            mask: ["501", 1],
            grow_mask_by: growMaskBy
          }
        }
      : {
          class_type: "SetLatentNoiseMask",
          inputs: {
            samples: ["309", 1],
            mask: ["501", 1]
          }
        };
  if (prompt["311"]?.inputs) {
    prompt["311"].inputs.latent_image = ["502", 0];
    prompt["311"].inputs.seed = passBSeed;
    prompt["311"].inputs.steps = passBSteps;
    prompt["311"].inputs.cfg = passBCfg;
    prompt["311"].inputs.sampler_name = passBSamplerName;
    prompt["311"].inputs.scheduler = passBScheduler;
    prompt["311"].inputs.denoise = passBDenoise;
  }
}
const promptId = await queuePrompt(comfyBaseUrl, prompt);
const outputs = await waitPromptOutputs(comfyBaseUrl, promptId, [313, 283]);

function assetToPath(asset) {
  return path.join(comfyOutputDir, asset.subfolder || "", asset.filename);
}

const result = {
  promptId,
  passA: (outputs[313] || []).map(assetToPath),
  final: (outputs[283] || []).map(assetToPath),
  settings: {
    shotPrefix,
    runTag,
    seed,
    steps,
    cfg,
    denoise,
    samplerName,
    scheduler,
    passASeed,
    passASteps,
    passACfg,
    passADenoise,
    passASamplerName,
    passAScheduler,
    stageAPositiveMode,
    stageAFrontOnlyRefs,
    stageBFrontOnlyRefs,
    stageAMainImageIndex,
    stageBMainImageIndex,
    stageBMaskedInpaint,
    maskLayout,
    maskedLatentMode,
    maskWidth,
    maskHeight,
    growMaskBy,
    passBSeed,
    passBSteps,
    passBCfg,
    passBDenoise,
    passBSamplerName,
    passBScheduler,
    char1SideRef,
    char1BackRef,
    char2SideRef,
    char2BackRef
  }
};

console.log(JSON.stringify(result, null, 2));
