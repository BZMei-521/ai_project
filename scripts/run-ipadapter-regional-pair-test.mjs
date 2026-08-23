#!/usr/bin/env node

import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";

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

function toNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

const args = parseArgs(process.argv.slice(2));
const comfyRoot =
  args.comfyRoot || "C:/Users/Administrator/Desktop/AiProject/ComfyUI_JM_windows_portable";
const comfyBaseUrl = String(args.baseUrl || "http://127.0.0.1:8188").replace(/\/+$/, "");
const comfyInputDir = path.join(comfyRoot, "ComfyUI", "input");
const comfyOutputDir = path.join(comfyRoot, "ComfyUI", "output");
const targetPath = String(args.target || path.join(comfyRoot, "target.png")).trim();
const shotPrefix = String(args.shot || "shot_river_continuity_001").trim();
const width = Math.max(512, toNumber(args.width, 1344));
const height = Math.max(512, toNumber(args.height, 896));
const mode = String(args.mode || "scene_inpaint").trim();
const seed = Math.max(1, Math.floor(toNumber(args.seed, Date.now())));
const steps = Math.max(8, Math.floor(toNumber(args.steps, 30)));
const cfg = Math.max(1, toNumber(args.cfg, 6));
const denoise = Math.min(1, Math.max(0, toNumber(args.denoise, mode === "scene_inpaint" ? 0.78 : 1)));
const samplerName = String(args.sampler || "dpmpp_2m").trim();
const scheduler = String(args.scheduler || "karras").trim();
const checkpoint = String(args.checkpoint || "animagine-xl-4.0.safetensors").trim();
const ipAdapterPreset = String(args.ipAdapterPreset || "PLUS (high strength)").trim();
const tag = String(args.tag || `regional_pair_${Date.now()}`).trim();
const scoreEnabled = String(args.score || "0").trim() === "1";
const scoreScriptPath = path.join(repoRoot, "scripts", "score-storyboard-target.ps1");

let sceneFile = String(args.scene || `${shotPrefix}_scene_ref_path.png`).trim();
let maleRefFile = String(args.male || `${shotPrefix}_char1_front_path.png`).trim();
let femaleRefFile = String(args.female || `${shotPrefix}_char2_front_path.png`).trim();
let maleSideFile = String(args.maleSide || `${shotPrefix}_char1_side_path.png`).trim();
let femaleSideFile = String(args.femaleSide || `${shotPrefix}_char2_side_path.png`).trim();
let poseRefFile = String(args.poseRef || "").trim();
const poseRefIsMap = String(args.poseRefIsMap || "0").trim() === "1";

const compositionWeight = toNumber(args.compositionWeight, 0.72);
const compositionBoost = toNumber(args.compositionBoost, 0.32);
const backgroundImageWeight = toNumber(args.backgroundWeight, 1.0);
const backgroundPromptWeight = toNumber(args.backgroundPromptWeight, 1.0);
const maleImageWeight = toNumber(args.maleWeight, 0.96);
const malePromptWeight = toNumber(args.malePromptWeight, 1.18);
const femaleImageWeight = toNumber(args.femaleWeight, 0.96);
const femalePromptWeight = toNumber(args.femalePromptWeight, 1.18);
const charEndAt = toNumber(args.charEndAt, 0.92);
const backgroundWeightType = String(args.backgroundWeightType || "composition precise").trim();
const maleWeightType = String(args.maleWeightType || "style and composition").trim();
const femaleWeightType = String(args.femaleWeightType || "style and composition").trim();
const maleSideWeight = toNumber(args.maleSideWeight, 0.32);
const femaleSideWeight = toNumber(args.femaleSideWeight, 0.32);
const sidePromptWeight = toNumber(args.sidePromptWeight, 0.55);
const sideWeightType = String(args.sideWeightType || "linear").trim();
const useSideRefs = String(args.useSideRefs || "1").trim() !== "0";
const growMaskBy = Math.max(0, Math.floor(toNumber(args.growMaskBy, 32)));
const poseStrength = toNumber(args.poseStrength, 0.68);
const poseEndAt = toNumber(args.poseEndAt, 0.82);
const layout = String(args.layout || "zones").trim();
const cropFaceRefs = String(args.cropFaceRefs || "1").trim() !== "0";
const faceCropSize = Math.max(96, Math.floor(toNumber(args.faceCropSize, 224)));
const faceCropYOffset = Math.floor(toNumber(args.faceCropYOffset, 84));
let maskFile = String(args.mask || `regional_pair_mask_${layout}_${width}x${height}.png`).trim();
const outputPrefix = `Storyboard/${tag}`;

const scenePrompt =
  String(args.scenePrompt || "").trim() ||
  [
    "clean anime storyboard background",
    "stone arch bridge over a calm riverside canal at sunset",
    "weeping willow trees and a curved stone path",
    "soft dusk light, warm sky reflection on the water",
    "coherent perspective, detailed environment, gentle painterly shading"
  ].join(", ");

const malePrompt =
  String(args.malePrompt || "").trim() ||
  [
    "young man on the right",
    "short black hair",
    "dark navy long coat with a brown waist sash",
    "white shirt collar visible",
    "black pants and dark shoes",
    "full body from head to feet",
    "natural anatomy",
    "slight three-quarter turn toward the woman",
    "left hand reaching inward naturally",
    "gentle calm expression"
  ].join(", ");

const femalePrompt =
  String(args.femalePrompt || "").trim() ||
  [
    "young woman on the left",
    "very long straight black hair with bangs",
    "large blue eyes",
    "dusty blue long sleeve dress with white collar",
    "black shoes",
    "full body from head to feet",
    "natural anatomy",
    "slight three-quarter turn toward the man",
    "right hand reaching inward naturally",
    "gentle warm expression"
  ].join(", ");

const globalPrompt =
  String(args.prompt || "").trim() ||
  [
    "anime storyboard illustration",
    "two young adults beside the riverside bridge at sunset",
    "the woman stands on the left and the man stands on the right",
    "they are close together and gently holding hands at the center",
    "both characters must be complete full body from head to toe",
    "natural proportions and complete hands",
    "clean line art, soft cinematic dusk lighting, detailed but clean shading",
    "the characters are naturally integrated into the environment and not pasted on top",
    "romantic quiet mood"
  ].join(", ");

const negativePrompt =
  String(args.negative || "").trim() ||
  [
    "extra people",
    "cropped body",
    "cut off feet",
    "missing limbs",
    "extra arms",
    "extra legs",
    "duplicate body",
    "duplicate face",
    "deformed hands",
    "bad anatomy",
    "sticker cutout",
    "pasted character",
    "white outline",
    "white background",
    "halo",
    "floating character",
    "collage",
    "messy artifacts",
    "text",
    "watermark",
    "lowres",
    "blurry"
  ].join(", ");

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
      const dx = (xx + 0.5 - cx) / rx;
      const dy = (yy + 0.5 - cy) / ry;
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

async function ensureRegionalMask(filePath, widthPx, heightPx) {
  if (fssync.existsSync(filePath)) return;
  const rgba = Buffer.alloc(widthPx * heightPx * 4, 255);
  const black = [0, 0, 0, 255];
  const green = [0, 255, 0, 255];
  const red = [255, 0, 0, 255];

  fillRect(rgba, widthPx, heightPx, 0, 0, widthPx, heightPx, black);

  if (layout === "female_only") {
    const femaleCx = Math.round(widthPx * 0.365);
    fillEllipse(rgba, widthPx, heightPx, femaleCx, Math.round(heightPx * 0.18), Math.round(widthPx * 0.034), Math.round(heightPx * 0.068), green);
    fillRect(rgba, widthPx, heightPx, femaleCx - Math.round(widthPx * 0.044), Math.round(heightPx * 0.24), Math.round(widthPx * 0.088), Math.round(heightPx * 0.155), green);
    fillPolygon(
      rgba,
      widthPx,
      heightPx,
      [
        [femaleCx - Math.round(widthPx * 0.082), Math.round(heightPx * 0.39)],
        [femaleCx + Math.round(widthPx * 0.084), Math.round(heightPx * 0.39)],
        [femaleCx + Math.round(widthPx * 0.058), Math.round(heightPx * 0.88)],
        [femaleCx - Math.round(widthPx * 0.066), Math.round(heightPx * 0.88)]
      ],
      green
    );
    fillRect(rgba, widthPx, heightPx, femaleCx - Math.round(widthPx * 0.102), Math.round(heightPx * 0.32), Math.round(widthPx * 0.030), Math.round(heightPx * 0.25), green);
    fillPolygon(
      rgba,
      widthPx,
      heightPx,
      [
        [femaleCx + Math.round(widthPx * 0.05), Math.round(heightPx * 0.30)],
        [femaleCx + Math.round(widthPx * 0.084), Math.round(heightPx * 0.32)],
        [femaleCx + Math.round(widthPx * 0.10), Math.round(heightPx * 0.42)],
        [femaleCx + Math.round(widthPx * 0.088), Math.round(heightPx * 0.50)],
        [femaleCx + Math.round(widthPx * 0.044), Math.round(heightPx * 0.46)],
        [femaleCx + Math.round(widthPx * 0.026), Math.round(heightPx * 0.36)]
      ],
      green
    );
    fillRect(rgba, widthPx, heightPx, femaleCx - Math.round(widthPx * 0.032), Math.round(heightPx * 0.88), Math.round(widthPx * 0.018), Math.round(heightPx * 0.08), green);
    fillRect(rgba, widthPx, heightPx, femaleCx + Math.round(widthPx * 0.006), Math.round(heightPx * 0.88), Math.round(widthPx * 0.018), Math.round(heightPx * 0.08), green);
  } else if (layout === "heads") {
    fillEllipse(rgba, widthPx, heightPx, Math.round(widthPx * 0.36), Math.round(heightPx * 0.17), Math.round(widthPx * 0.06), Math.round(heightPx * 0.09), green);
    fillEllipse(rgba, widthPx, heightPx, Math.round(widthPx * 0.56), Math.round(heightPx * 0.165), Math.round(widthPx * 0.06), Math.round(heightPx * 0.09), red);
  } else if (layout === "silhouette") {
    const femaleCx = Math.round(widthPx * 0.36);
    const maleCx = Math.round(widthPx * 0.56);

    fillEllipse(rgba, widthPx, heightPx, femaleCx, Math.round(heightPx * 0.18), Math.round(widthPx * 0.038), Math.round(heightPx * 0.07), green);
    fillRect(rgba, widthPx, heightPx, femaleCx - Math.round(widthPx * 0.05), Math.round(heightPx * 0.24), Math.round(widthPx * 0.10), Math.round(heightPx * 0.16), green);
    fillPolygon(
      rgba,
      widthPx,
      heightPx,
      [
        [femaleCx - Math.round(widthPx * 0.10), Math.round(heightPx * 0.39)],
        [femaleCx + Math.round(widthPx * 0.10), Math.round(heightPx * 0.39)],
        [femaleCx + Math.round(widthPx * 0.07), Math.round(heightPx * 0.86)],
        [femaleCx - Math.round(widthPx * 0.08), Math.round(heightPx * 0.86)]
      ],
      green
    );
    fillRect(rgba, widthPx, heightPx, femaleCx - Math.round(widthPx * 0.12), Math.round(heightPx * 0.32), Math.round(widthPx * 0.035), Math.round(heightPx * 0.27), green);
    fillPolygon(
      rgba,
      widthPx,
      heightPx,
      [
        [femaleCx + Math.round(widthPx * 0.06), Math.round(heightPx * 0.30)],
        [femaleCx + Math.round(widthPx * 0.10), Math.round(heightPx * 0.32)],
        [femaleCx + Math.round(widthPx * 0.12), Math.round(heightPx * 0.43)],
        [femaleCx + Math.round(widthPx * 0.10), Math.round(heightPx * 0.51)],
        [femaleCx + Math.round(widthPx * 0.05), Math.round(heightPx * 0.47)],
        [femaleCx + Math.round(widthPx * 0.03), Math.round(heightPx * 0.36)]
      ],
      green
    );
    fillRect(rgba, widthPx, heightPx, femaleCx - Math.round(widthPx * 0.04), Math.round(heightPx * 0.86), Math.round(widthPx * 0.022), Math.round(heightPx * 0.10), green);
    fillRect(rgba, widthPx, heightPx, femaleCx + Math.round(widthPx * 0.01), Math.round(heightPx * 0.86), Math.round(widthPx * 0.022), Math.round(heightPx * 0.10), green);

    fillEllipse(rgba, widthPx, heightPx, maleCx, Math.round(heightPx * 0.17), Math.round(widthPx * 0.038), Math.round(heightPx * 0.07), red);
    fillRect(rgba, widthPx, heightPx, maleCx - Math.round(widthPx * 0.05), Math.round(heightPx * 0.23), Math.round(widthPx * 0.10), Math.round(heightPx * 0.18), red);
    fillPolygon(
      rgba,
      widthPx,
      heightPx,
      [
        [maleCx - Math.round(widthPx * 0.08), Math.round(heightPx * 0.40)],
        [maleCx + Math.round(widthPx * 0.09), Math.round(heightPx * 0.40)],
        [maleCx + Math.round(widthPx * 0.06), Math.round(heightPx * 0.88)],
        [maleCx - Math.round(widthPx * 0.05), Math.round(heightPx * 0.88)]
      ],
      red
    );
    fillPolygon(
      rgba,
      widthPx,
      heightPx,
      [
        [maleCx - Math.round(widthPx * 0.06), Math.round(heightPx * 0.30)],
        [maleCx - Math.round(widthPx * 0.10), Math.round(heightPx * 0.32)],
        [maleCx - Math.round(widthPx * 0.12), Math.round(heightPx * 0.42)],
        [maleCx - Math.round(widthPx * 0.10), Math.round(heightPx * 0.51)],
        [maleCx - Math.round(widthPx * 0.05), Math.round(heightPx * 0.47)],
        [maleCx - Math.round(widthPx * 0.03), Math.round(heightPx * 0.36)]
      ],
      red
    );
    fillRect(rgba, widthPx, heightPx, maleCx + Math.round(widthPx * 0.07), Math.round(heightPx * 0.32), Math.round(widthPx * 0.032), Math.round(heightPx * 0.27), red);
    fillRect(rgba, widthPx, heightPx, maleCx - Math.round(widthPx * 0.03), Math.round(heightPx * 0.88), Math.round(widthPx * 0.022), Math.round(heightPx * 0.08), red);
    fillRect(rgba, widthPx, heightPx, maleCx + Math.round(widthPx * 0.01), Math.round(heightPx * 0.88), Math.round(widthPx * 0.022), Math.round(heightPx * 0.08), red);
  } else {
    fillPolygon(
      rgba,
      widthPx,
      heightPx,
      [
        [Math.round(widthPx * 0.10), Math.round(heightPx * 0.14)],
        [Math.round(widthPx * 0.35), Math.round(heightPx * 0.14)],
        [Math.round(widthPx * 0.45), Math.round(heightPx * 0.48)],
        [Math.round(widthPx * 0.42), Math.round(heightPx * 0.95)],
        [Math.round(widthPx * 0.08), Math.round(heightPx * 0.95)],
        [Math.round(widthPx * 0.12), Math.round(heightPx * 0.56)]
      ],
      green
    );

    fillPolygon(
      rgba,
      widthPx,
      heightPx,
      [
        [Math.round(widthPx * 0.43), Math.round(heightPx * 0.14)],
        [Math.round(widthPx * 0.72), Math.round(heightPx * 0.14)],
        [Math.round(widthPx * 0.78), Math.round(heightPx * 0.95)],
        [Math.round(widthPx * 0.48), Math.round(heightPx * 0.95)],
        [Math.round(widthPx * 0.44), Math.round(heightPx * 0.54)],
        [Math.round(widthPx * 0.40), Math.round(heightPx * 0.48)]
      ],
      red
    );
  }

  await fs.writeFile(filePath, encodePngRgba(widthPx, heightPx, rgba));
}

async function ensureComfyInputFile(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const looksLikePath = /[\\/]/.test(trimmed) || /^[A-Za-z]:/.test(trimmed);
  if (!looksLikePath) return trimmed;
  const resolved = path.resolve(trimmed);
  const targetName = path.basename(resolved);
  const targetPath = path.join(comfyInputDir, targetName);
  if (!fssync.existsSync(resolved)) {
    throw new Error(`Input image not found: ${resolved}`);
  }
  if (!fssync.existsSync(targetPath)) {
    await fs.copyFile(resolved, targetPath);
  }
  return targetName;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${await response.text()}`);
  }
  return response.json();
}

async function queuePrompt(prompt) {
  const payload = await fetchJson(`${comfyBaseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, client_id: "run-ipadapter-regional-pair-test" })
  });
  const promptId = String(payload?.prompt_id || "").trim();
  if (!promptId) throw new Error("Comfy returned no prompt_id");
  return promptId;
}

function collectNodeOutputImages(historyEntry, nodeId) {
  const nodeOutput = historyEntry?.outputs?.[String(nodeId)];
  const images = nodeOutput?.images;
  if (!Array.isArray(images)) return [];
  return images
    .filter((asset) => asset && typeof asset === "object" && String(asset.filename || "").trim())
    .map((asset) => ({
      filename: String(asset.filename).trim(),
      subfolder: String(asset.subfolder || "").trim(),
      type: String(asset.type || "output").trim() || "output"
    }));
}

async function waitPromptOutputs(promptId, nodeIds, timeoutMs = 15 * 60 * 1000, pollMs = 1200) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const history = await fetchJson(`${comfyBaseUrl}/history/${encodeURIComponent(promptId)}`);
    const entry = history?.[promptId];
    if (entry) {
      const result = {};
      for (const nodeId of nodeIds) {
        const assets = collectNodeOutputImages(entry, nodeId);
        if (assets.length > 0) result[nodeId] = assets;
      }
      if (Object.keys(result).length > 0) return result;
      const status = entry?.status;
      const statusText = String(status?.status_str || "").toLowerCase();
      if (status?.completed === true || statusText === "success" || statusText === "failed" || statusText === "error") {
        throw new Error(`Prompt completed but no expected output image was found (status=${statusText || "unknown"})`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Timed out waiting for prompt ${promptId}`);
}

function runScore(candidatePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell",
      [
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scoreScriptPath,
        "-Target",
        targetPath,
        "-Candidate",
        candidatePath
      ],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`score script failed with code ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function buildPrompt() {
  const prompt = {
    "1": {
      class_type: "LoadImage",
      inputs: { image: sceneFile }
    },
    "2": {
      class_type: "LoadImage",
      inputs: { image: maleRefFile }
    },
    "3": {
      class_type: "LoadImage",
      inputs: { image: femaleRefFile }
    },
    "4": {
      class_type: "LoadImage",
      inputs: { image: maskFile }
    },
    "5": {
      class_type: "MaskFromRGBCMYBW+",
      inputs: {
        image: ["4", 0],
        threshold_r: 0.12,
        threshold_g: 0.12,
        threshold_b: 0.12
      }
    },
    "6": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: checkpoint }
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: globalPrompt,
        clip: ["6", 1]
      }
    },
    "8": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: negativePrompt,
        clip: ["6", 1]
      }
    },
    "9": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: scenePrompt,
        clip: ["6", 1]
      }
    },
    "10": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: malePrompt,
        clip: ["6", 1]
      }
    },
    "11": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: femalePrompt,
        clip: ["6", 1]
      }
    },
    "12": {
      class_type: "EmptyLatentImage",
      inputs: {
        width,
        height,
        batch_size: 1
      }
    },
    "13": {
      class_type: "IPAdapterUnifiedLoader",
      inputs: {
        model: ["6", 0],
        preset: ipAdapterPreset
      }
    },
    "16": {
      class_type: "IPAdapterRegionalConditioning",
      inputs: {
        image: ["2", 0],
        mask: ["5", 0],
        positive: ["10", 0],
        negative: ["8", 0],
        image_weight: maleImageWeight,
        prompt_weight: malePromptWeight,
        weight_type: maleWeightType,
        start_at: 0,
        end_at: charEndAt
      }
    },
    "17": {
      class_type: "IPAdapterRegionalConditioning",
      inputs: {
        image: ["3", 0],
        mask: ["5", 1],
        positive: ["11", 0],
        negative: ["8", 0],
        image_weight: femaleImageWeight,
        prompt_weight: femalePromptWeight,
        weight_type: femaleWeightType,
        start_at: 0,
        end_at: charEndAt
      }
    },
    "18": {
      class_type: "IPAdapterCombineParams",
      inputs: {
        params_1: ["16", 0],
        params_2: ["17", 0]
      }
    },
    "19": {
      class_type: "IPAdapterFromParams",
      inputs: {
        model: ["13", 0],
        ipadapter: ["13", 1],
        ipadapter_params: ["18", 0],
        combine_embeds: "concat",
        embeds_scaling: "K+mean(V) w/ C penalty"
      }
    },
    "20": {
      class_type: "ConditioningCombineMultiple+",
      inputs: {
        conditioning_1: ["16", 1],
        conditioning_2: ["17", 1],
        conditioning_3: ["7", 0]
      }
    },
    "21": {
      class_type: "ConditioningCombineMultiple+",
      inputs: {
        conditioning_1: ["16", 2],
        conditioning_2: ["17", 2],
        conditioning_3: ["8", 0]
      }
    },
    "22": {
      class_type: "KSampler",
      inputs: {
        model: ["19", 0],
        seed,
        steps,
        cfg,
        sampler_name: samplerName,
        scheduler,
        positive: ["20", 0],
        negative: ["21", 0],
        latent_image: ["12", 0],
        denoise
      }
    },
    "23": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["22", 0],
        vae: ["6", 2]
      }
    },
    "24": {
      class_type: "SaveImage",
      inputs: {
        images: ["23", 0],
        filename_prefix: outputPrefix
      }
    }
  };

  if (layout === "heads" && cropFaceRefs) {
    prompt["35"] = {
      class_type: "ImageCrop+",
      inputs: {
        image: ["2", 0],
        width: faceCropSize,
        height: faceCropSize,
        position: "top-center",
        x_offset: 0,
        y_offset: faceCropYOffset
      }
    };
    prompt["36"] = {
      class_type: "ImageCrop+",
      inputs: {
        image: ["3", 0],
        width: faceCropSize,
        height: faceCropSize,
        position: "top-center",
        x_offset: 0,
        y_offset: faceCropYOffset
      }
    };
    prompt["16"].inputs.image = ["35", 0];
    prompt["17"].inputs.image = ["36", 0];
  }

  if (useSideRefs) {
    prompt["31"] = {
      class_type: "LoadImage",
      inputs: { image: maleSideFile }
    };
    prompt["32"] = {
      class_type: "LoadImage",
      inputs: { image: femaleSideFile }
    };
    prompt["33"] = {
      class_type: "IPAdapterRegionalConditioning",
      inputs: {
        image: ["31", 0],
        mask: ["5", 0],
        positive: ["10", 0],
        negative: ["8", 0],
        image_weight: maleSideWeight,
        prompt_weight: sidePromptWeight,
        weight_type: sideWeightType,
        start_at: 0,
        end_at: Math.min(charEndAt, 0.8)
      }
    };
    prompt["34"] = {
      class_type: "IPAdapterRegionalConditioning",
      inputs: {
        image: ["32", 0],
        mask: ["5", 1],
        positive: ["11", 0],
        negative: ["8", 0],
        image_weight: femaleSideWeight,
        prompt_weight: sidePromptWeight,
        weight_type: sideWeightType,
        start_at: 0,
        end_at: Math.min(charEndAt, 0.8)
      }
    };
  }

  if (mode === "scene_inpaint") {
    delete prompt["12"];
    prompt["25"] = {
      class_type: "MaskComposite",
      inputs: {
        destination: ["5", 0],
        source: ["5", 1],
        x: 0,
        y: 0,
        operation: "add"
      }
    };
    prompt["26"] = {
      class_type: "VAEEncodeForInpaint",
      inputs: {
        pixels: ["1", 0],
        vae: ["6", 2],
        mask: ["25", 0],
        grow_mask_by: growMaskBy
      }
    };
    prompt["22"].inputs.latent_image = ["26", 0];
  } else if (mode === "img2img_preserve") {
    prompt["26"] = {
      class_type: "VAEEncode",
      inputs: {
        pixels: ["1", 0],
        vae: ["6", 2]
      }
    };
    prompt["22"].inputs.latent_image = ["26", 0];
  } else {
    prompt["14"] = {
      class_type: "IPAdapterPreciseComposition",
      inputs: {
        model: ["13", 0],
        ipadapter: ["13", 1],
        image: ["1", 0],
        weight: compositionWeight,
        composition_boost: compositionBoost,
        combine_embeds: "concat",
        start_at: 0,
        end_at: 1,
        embeds_scaling: "K+mean(V) w/ C penalty"
      }
    };
    prompt["15"] = {
      class_type: "IPAdapterRegionalConditioning",
      inputs: {
        image: ["1", 0],
        mask: ["5", 6],
        positive: ["9", 0],
        negative: ["8", 0],
        image_weight: backgroundImageWeight,
        prompt_weight: backgroundPromptWeight,
        weight_type: backgroundWeightType,
        start_at: 0,
        end_at: 1
      }
    };
    prompt["18"].inputs = useSideRefs
      ? {
          params_1: ["15", 0],
          params_2: ["16", 0],
          params_3: ["17", 0],
          params_4: ["33", 0],
          params_5: ["34", 0]
        }
      : {
          params_1: ["15", 0],
          params_2: ["16", 0],
          params_3: ["17", 0]
        };
    prompt["19"].inputs.model = ["14", 0];
    prompt["20"].inputs = {
      conditioning_1: ["15", 1],
      conditioning_2: ["16", 1],
      conditioning_3: ["17", 1],
      conditioning_4: ["7", 0]
    };
    prompt["21"].inputs = {
      conditioning_1: ["15", 2],
      conditioning_2: ["16", 2],
      conditioning_3: ["17", 2],
      conditioning_4: ["8", 0]
    };
  }

  if (mode === "scene_inpaint" && useSideRefs) {
    prompt["18"].inputs = {
      params_1: ["16", 0],
      params_2: ["17", 0],
      params_3: ["33", 0],
      params_4: ["34", 0]
    };
  }

  if (poseRefFile) {
    prompt["27"] = {
      class_type: "LoadImage",
      inputs: { image: poseRefFile }
    };
    prompt["29"] = {
      class_type: "ControlNetLoader",
      inputs: {
        control_net_name:
          checkpoint.toLowerCase().includes("xl") || checkpoint.toLowerCase().includes("sd_xl")
            ? "OpenPoseXL2.safetensors"
            : "control_v11p_sd15_openpose_fp16.safetensors"
      }
    };
    const poseControlImage = poseRefIsMap ? ["27", 0] : ["28", 0];
    if (!poseRefIsMap) {
      prompt["28"] = {
        class_type: "OpenposePreprocessor",
        inputs: {
          image: ["27", 0],
          detect_hand: "enable",
          detect_body: "enable",
          detect_face: "enable",
          resolution: 1024,
          scale_stick_for_xinsr_cn: "disable"
        }
      };
    }
    prompt["30"] = {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive: ["20", 0],
        negative: ["21", 0],
        control_net: ["29", 0],
        image: poseControlImage,
        strength: poseStrength,
        start_percent: 0,
        end_percent: poseEndAt,
        vae: ["6", 2]
      }
    };
    prompt["22"].inputs.positive = ["30", 0];
    prompt["22"].inputs.negative = ["30", 1];
  }

  return prompt;
}

async function main() {
  await fs.mkdir(comfyInputDir, { recursive: true });
  sceneFile = await ensureComfyInputFile(sceneFile);
  maleRefFile = await ensureComfyInputFile(maleRefFile);
  femaleRefFile = await ensureComfyInputFile(femaleRefFile);
  maleSideFile = await ensureComfyInputFile(maleSideFile);
  femaleSideFile = await ensureComfyInputFile(femaleSideFile);
  maskFile = await ensureComfyInputFile(maskFile);
  poseRefFile = await ensureComfyInputFile(poseRefFile);
  const maskPath = path.join(comfyInputDir, maskFile);
  await ensureRegionalMask(maskPath, width, height);

  const prompt = buildPrompt();
  const promptId = await queuePrompt(prompt);
  const outputs = await waitPromptOutputs(promptId, [24]);
  const firstOutput = outputs?.[24]?.[0];
  if (!firstOutput) throw new Error("No image returned from SaveImage node");
  const outputPath = path.join(comfyOutputDir, firstOutput.subfolder || "", firstOutput.filename);

  const result = {
    promptId,
    outputPath,
    maskPath,
    settings: {
      width,
      height,
      mode,
      seed,
      steps,
      cfg,
      denoise,
      samplerName,
      scheduler,
      checkpoint,
      ipAdapterPreset,
      compositionWeight,
      compositionBoost,
      backgroundImageWeight,
      backgroundPromptWeight,
      backgroundWeightType,
      maleImageWeight,
      malePromptWeight,
      maleWeightType,
      maleSideWeight,
      femaleImageWeight,
      femalePromptWeight,
      femaleWeightType,
      femaleSideWeight,
      sidePromptWeight,
      sideWeightType,
      useSideRefs,
      charEndAt,
      growMaskBy,
      poseRefFile,
      poseStrength,
      poseEndAt,
      layout,
      cropFaceRefs,
      faceCropSize,
      faceCropYOffset
    }
  };

  if (scoreEnabled) {
    result.scoreOutput = await runScore(outputPath);
  }

  console.log(JSON.stringify(result, null, 2));
}

await main();
