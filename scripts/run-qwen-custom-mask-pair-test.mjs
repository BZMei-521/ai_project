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
const comfyBaseUrl = String(args.baseUrl || "http://127.0.0.1:8188").replace(/\/+$/, "");
const timeoutMs = Math.max(10_000, Number(args.timeoutMs || 15 * 60 * 1000));
const pollMs = Math.max(500, Number(args.pollMs || 1200));
const shotPrefix = String(args.shot || "shot_river_continuity_001").trim();
const tag = String(args.tag || `qwen_custom_mask_pair_${Date.now()}`).trim();
const comfyRoot =
  args.comfyRoot || "C:/Users/Administrator/Desktop/AiProject/ComfyUI_JM_windows_portable";
const comfyInputDir = path.join(comfyRoot, "ComfyUI", "input");
const comfyOutputDir = path.join(comfyRoot, "ComfyUI", "output");
const targetPath = String(args.target || path.join(comfyRoot, "target.png")).trim();
const scoreScriptPath = path.join(repoRoot, "scripts", "score-storyboard-target.ps1");
const scoreEnabled = String(args.score || "1").trim() !== "0";
const width = Math.max(512, Math.round(toNumber(args.width, 1024)));
const height = Math.max(512, Math.round(toNumber(args.height, 576)));
const seed = Math.max(1, Math.floor(toNumber(args.seed, Date.now())));
const steps = Math.max(4, Math.floor(toNumber(args.steps, 4)));
const cfg = Math.max(0.1, toNumber(args.cfg, 1));
const denoise = Math.max(0, Math.min(1, toNumber(args.denoise, 1)));
const samplerName = String(args.sampler || "euler").trim();
const scheduler = String(args.scheduler || "beta").trim();
const maxRefEdge = Math.max(512, Math.round(toNumber(args.maxRefEdge, 1536)));
const loraName = String(args.loraName || "Qwen-Image-Lightning-4steps-V1.0.safetensors").trim();
const loraStrength = toNumber(args.loraStrength, 1);
const disableLora = String(args.disableLora || "0").trim() === "1";
const promptText =
  String(args.prompt || "").trim() ||
  [
    "Repaint only the masked region of Picture 1 into one coherent anime storyboard frame.",
    "Preserve the exact identity of the woman from Picture 2 and the man from Picture 3.",
    "If later pictures provide side-view references, use them to keep profile features, hairstyle silhouette, and outfit side shape consistent.",
    "Keep the riverside stone bridge background outside the mask unchanged.",
    "The woman stands on the left and the man stands on the right.",
    "Both characters must be full body from head to toe with natural proportions, complete limbs, grounded feet, soft dusk lighting, gentle mutual attention, and clean scene integration.",
    "Let them turn slightly toward each other and bring their inner hands close together in a natural almost-hand-holding interaction.",
    "No white halo, no pasted cutout look, no extra limbs, no duplicate people, and no cropped bodies."
  ].join(" ");

let sceneFile = String(args.scene || `${shotPrefix}_scene_ref_path.png`).trim();
let femaleRefFile = String(args.female || `${shotPrefix}_char2_front_path.png`).trim();
let maleRefFile = String(args.male || `${shotPrefix}_char1_front_path.png`).trim();
let femaleSideFile = String(args.femaleSide || `${shotPrefix}_char2_side_path.png`).trim();
let maleSideFile = String(args.maleSide || `${shotPrefix}_char1_side_path.png`).trim();
let poseRefFile = String(args.poseRef || `${shotPrefix}_pose_map.png`).trim();
let maskFile = String(args.mask || `qwen_pair_union_mask_${width}x${height}.png`).trim();
const useSideRefs = String(args.useSideRefs || "1").trim() !== "0";
const usePoseRef = String(args.usePoseRef || "1").trim() !== "0";
const maskStyle = String(args.maskStyle || "default").trim().toLowerCase();

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

async function ensureUnionAlphaMask(filePath, widthPx, heightPx, style = "default") {
  if (fssync.existsSync(filePath)) return;
  const rgba = Buffer.alloc(widthPx * heightPx * 4, 0);
  const white = [255, 255, 255, 255];

  if (style === "compact_fullbody" || style === "compact_center_fullbody") {
    const centered = style === "compact_center_fullbody";
    const femaleCx = Math.round(widthPx * (centered ? 0.42 : 0.34));
    const maleCx = Math.round(widthPx * (centered ? 0.58 : 0.62));

    fillEllipse(rgba, widthPx, heightPx, femaleCx, Math.round(heightPx * 0.20), Math.round(widthPx * 0.045), Math.round(heightPx * 0.075), white);
    fillRect(rgba, widthPx, heightPx, femaleCx - Math.round(widthPx * 0.05), Math.round(heightPx * 0.27), Math.round(widthPx * 0.10), Math.round(heightPx * 0.14), white);
    fillPolygon(
      rgba,
      widthPx,
      heightPx,
      [
        [femaleCx - Math.round(widthPx * 0.082), Math.round(heightPx * 0.40)],
        [femaleCx + Math.round(widthPx * 0.082), Math.round(heightPx * 0.40)],
        [femaleCx + Math.round(widthPx * 0.062), Math.round(heightPx * 0.84)],
        [femaleCx - Math.round(widthPx * 0.062), Math.round(heightPx * 0.84)]
      ],
      white
    );
    fillPolygon(
      rgba,
      widthPx,
      heightPx,
      [
        [femaleCx - Math.round(widthPx * 0.072), Math.round(heightPx * 0.32)],
        [femaleCx - Math.round(widthPx * 0.12), Math.round(heightPx * 0.37)],
        [femaleCx - Math.round(widthPx * 0.12), Math.round(heightPx * 0.52)],
        [femaleCx - Math.round(widthPx * 0.088), Math.round(heightPx * 0.54)],
        [femaleCx - Math.round(widthPx * 0.05), Math.round(heightPx * 0.45)]
      ],
      white
    );
    fillPolygon(
      rgba,
      widthPx,
      heightPx,
      [
        [femaleCx + Math.round(widthPx * 0.060), Math.round(heightPx * 0.34)],
        [femaleCx + Math.round(widthPx * 0.14), Math.round(heightPx * 0.38)],
        [femaleCx + Math.round(widthPx * 0.14), Math.round(heightPx * 0.52)],
        [femaleCx + Math.round(widthPx * 0.10), Math.round(heightPx * 0.54)],
        [femaleCx + Math.round(widthPx * 0.055), Math.round(heightPx * 0.46)]
      ],
      white
    );
    fillRect(rgba, widthPx, heightPx, femaleCx - Math.round(widthPx * 0.040), Math.round(heightPx * 0.84), Math.round(widthPx * 0.026), Math.round(heightPx * 0.11), white);
    fillRect(rgba, widthPx, heightPx, femaleCx + Math.round(widthPx * 0.014), Math.round(heightPx * 0.84), Math.round(widthPx * 0.026), Math.round(heightPx * 0.11), white);

    fillEllipse(rgba, widthPx, heightPx, maleCx, Math.round(heightPx * 0.20), Math.round(widthPx * 0.045), Math.round(heightPx * 0.075), white);
    fillRect(rgba, widthPx, heightPx, maleCx - Math.round(widthPx * 0.05), Math.round(heightPx * 0.27), Math.round(widthPx * 0.10), Math.round(heightPx * 0.14), white);
    fillPolygon(
      rgba,
      widthPx,
      heightPx,
      [
        [maleCx - Math.round(widthPx * 0.078), Math.round(heightPx * 0.40)],
        [maleCx + Math.round(widthPx * 0.078), Math.round(heightPx * 0.40)],
        [maleCx + Math.round(widthPx * 0.058), Math.round(heightPx * 0.84)],
        [maleCx - Math.round(widthPx * 0.058), Math.round(heightPx * 0.84)]
      ],
      white
    );
    fillPolygon(
      rgba,
      widthPx,
      heightPx,
      [
        [maleCx + Math.round(widthPx * 0.062), Math.round(heightPx * 0.33)],
        [maleCx + Math.round(widthPx * 0.12), Math.round(heightPx * 0.38)],
        [maleCx + Math.round(widthPx * 0.12), Math.round(heightPx * 0.53)],
        [maleCx + Math.round(widthPx * 0.088), Math.round(heightPx * 0.55)],
        [maleCx + Math.round(widthPx * 0.05), Math.round(heightPx * 0.46)]
      ],
      white
    );
    fillPolygon(
      rgba,
      widthPx,
      heightPx,
      [
        [maleCx - Math.round(widthPx * 0.062), Math.round(heightPx * 0.34)],
        [maleCx - Math.round(widthPx * 0.14), Math.round(heightPx * 0.38)],
        [maleCx - Math.round(widthPx * 0.14), Math.round(heightPx * 0.52)],
        [maleCx - Math.round(widthPx * 0.10), Math.round(heightPx * 0.54)],
        [maleCx - Math.round(widthPx * 0.055), Math.round(heightPx * 0.46)]
      ],
      white
    );
    fillRect(rgba, widthPx, heightPx, maleCx - Math.round(widthPx * 0.038), Math.round(heightPx * 0.84), Math.round(widthPx * 0.024), Math.round(heightPx * 0.11), white);
    fillRect(rgba, widthPx, heightPx, maleCx + Math.round(widthPx * 0.012), Math.round(heightPx * 0.84), Math.round(widthPx * 0.024), Math.round(heightPx * 0.11), white);

    const bridgeX0 = Math.round(widthPx * 0.47);
    const bridgeY0 = Math.round(heightPx * 0.42);
    fillRect(rgba, widthPx, heightPx, bridgeX0, bridgeY0, Math.round(widthPx * 0.08), Math.round(heightPx * 0.12), white);

    await fs.writeFile(filePath, encodePngRgba(widthPx, heightPx, rgba));
    return;
  }

  const femaleCx = Math.round(widthPx * 0.36);
  const maleCx = Math.round(widthPx * 0.60);

  fillEllipse(rgba, widthPx, heightPx, femaleCx, Math.round(heightPx * 0.17), Math.round(widthPx * 0.05), Math.round(heightPx * 0.09), white);
  fillRect(rgba, widthPx, heightPx, femaleCx - Math.round(widthPx * 0.06), Math.round(heightPx * 0.24), Math.round(widthPx * 0.12), Math.round(heightPx * 0.18), white);
  fillPolygon(
    rgba,
    widthPx,
    heightPx,
    [
      [femaleCx - Math.round(widthPx * 0.10), Math.round(heightPx * 0.40)],
      [femaleCx + Math.round(widthPx * 0.10), Math.round(heightPx * 0.40)],
      [femaleCx + Math.round(widthPx * 0.07), Math.round(heightPx * 0.92)],
      [femaleCx - Math.round(widthPx * 0.08), Math.round(heightPx * 0.92)]
    ],
    white
  );
  fillRect(rgba, widthPx, heightPx, femaleCx - Math.round(widthPx * 0.13), Math.round(heightPx * 0.31), Math.round(widthPx * 0.04), Math.round(heightPx * 0.30), white);
  fillPolygon(
    rgba,
    widthPx,
    heightPx,
    [
      [femaleCx + Math.round(widthPx * 0.05), Math.round(heightPx * 0.30)],
      [femaleCx + Math.round(widthPx * 0.11), Math.round(heightPx * 0.32)],
      [femaleCx + Math.round(widthPx * 0.13), Math.round(heightPx * 0.44)],
      [femaleCx + Math.round(widthPx * 0.11), Math.round(heightPx * 0.53)],
      [femaleCx + Math.round(widthPx * 0.05), Math.round(heightPx * 0.49)],
      [femaleCx + Math.round(widthPx * 0.03), Math.round(heightPx * 0.37)]
    ],
    white
  );
  fillRect(rgba, widthPx, heightPx, femaleCx - Math.round(widthPx * 0.04), Math.round(heightPx * 0.90), Math.round(widthPx * 0.025), Math.round(heightPx * 0.10), white);
  fillRect(rgba, widthPx, heightPx, femaleCx + Math.round(widthPx * 0.01), Math.round(heightPx * 0.90), Math.round(widthPx * 0.025), Math.round(heightPx * 0.10), white);

  fillEllipse(rgba, widthPx, heightPx, maleCx, Math.round(heightPx * 0.16), Math.round(widthPx * 0.05), Math.round(heightPx * 0.09), white);
  fillRect(rgba, widthPx, heightPx, maleCx - Math.round(widthPx * 0.06), Math.round(heightPx * 0.23), Math.round(widthPx * 0.12), Math.round(heightPx * 0.20), white);
  fillPolygon(
    rgba,
    widthPx,
    heightPx,
    [
      [maleCx - Math.round(widthPx * 0.08), Math.round(heightPx * 0.41)],
      [maleCx + Math.round(widthPx * 0.09), Math.round(heightPx * 0.41)],
      [maleCx + Math.round(widthPx * 0.06), Math.round(heightPx * 0.94)],
      [maleCx - Math.round(widthPx * 0.05), Math.round(heightPx * 0.94)]
    ],
    white
  );
  fillPolygon(
    rgba,
    widthPx,
    heightPx,
    [
      [maleCx - Math.round(widthPx * 0.06), Math.round(heightPx * 0.30)],
      [maleCx - Math.round(widthPx * 0.12), Math.round(heightPx * 0.32)],
      [maleCx - Math.round(widthPx * 0.14), Math.round(heightPx * 0.43)],
      [maleCx - Math.round(widthPx * 0.12), Math.round(heightPx * 0.54)],
      [maleCx - Math.round(widthPx * 0.05), Math.round(heightPx * 0.50)],
      [maleCx - Math.round(widthPx * 0.03), Math.round(heightPx * 0.37)]
    ],
    white
  );
  fillRect(rgba, widthPx, heightPx, maleCx + Math.round(widthPx * 0.07), Math.round(heightPx * 0.31), Math.round(widthPx * 0.04), Math.round(heightPx * 0.30), white);
  fillRect(rgba, widthPx, heightPx, maleCx - Math.round(widthPx * 0.03), Math.round(heightPx * 0.92), Math.round(widthPx * 0.025), Math.round(heightPx * 0.08), white);
  fillRect(rgba, widthPx, heightPx, maleCx + Math.round(widthPx * 0.01), Math.round(heightPx * 0.92), Math.round(widthPx * 0.025), Math.round(heightPx * 0.08), white);

  const bridgeX0 = Math.round(widthPx * 0.44);
  const bridgeY0 = Math.round(heightPx * 0.34);
  fillRect(rgba, widthPx, heightPx, bridgeX0, bridgeY0, Math.round(widthPx * 0.12), Math.round(heightPx * 0.28), white);

  await fs.writeFile(filePath, encodePngRgba(widthPx, heightPx, rgba));
}

async function ensureComfyInputFile(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  const normalized = trimmed.replace(/\\/g, "/");
  const maybeAbsolute = normalized.match(/^[A-Za-z]:\//);
  if (!maybeAbsolute) return normalized;

  const srcPath = path.resolve(trimmed);
  const stat = await fs.stat(srcPath);
  if (!stat.isFile()) throw new Error(`Input file is not a file: ${srcPath}`);
  const targetPath = path.join(comfyInputDir, path.basename(srcPath));
  await fs.copyFile(srcPath, targetPath);
  return path.basename(targetPath);
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
    body: JSON.stringify({ prompt, client_id: "run-qwen-custom-mask-pair-test" })
  });
  const promptId = String(payload?.prompt_id || "").trim();
  if (!promptId) throw new Error("Comfy returned no prompt_id");
  return promptId;
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

async function waitPromptOutputs(promptId, nodeIds) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const history = await fetchJson(`${comfyBaseUrl}/history/${encodeURIComponent(promptId)}`);
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

function assetToPath(asset) {
  return path.join(comfyOutputDir, asset.subfolder || "", asset.filename);
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

async function main() {
  await fs.mkdir(comfyInputDir, { recursive: true });
  sceneFile = await ensureComfyInputFile(sceneFile);
  femaleRefFile = await ensureComfyInputFile(femaleRefFile);
  maleRefFile = await ensureComfyInputFile(maleRefFile);
  femaleSideFile = await ensureComfyInputFile(femaleSideFile);
  maleSideFile = await ensureComfyInputFile(maleSideFile);
  if (usePoseRef) {
    poseRefFile = await ensureComfyInputFile(poseRefFile);
  }
  maskFile = await ensureComfyInputFile(maskFile);
  const maskPath = path.join(comfyInputDir, maskFile);
  await ensureUnionAlphaMask(maskPath, width, height, maskStyle);

  const prompt = {
    "1": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "qwen_image_edit_2511_fp8mixed.safetensors",
        weight_dtype: "default"
      }
    },
    "2": {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: ["1", 0],
        lora_name: loraName,
        strength_model: loraStrength
      }
    },
    "4": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
        type: "qwen_image",
        device: "default"
      }
    },
    "5": {
      class_type: "VAELoader",
      inputs: {
        vae_name: "qwen_image_vae.safetensors"
      }
    },
    "6": {
      class_type: "LoadImage",
      inputs: { image: sceneFile }
    },
    "7": {
      class_type: "LoadImage",
      inputs: { image: femaleRefFile }
    },
    "8": {
      class_type: "LoadImage",
      inputs: { image: maleRefFile }
    },
    "9": {
      class_type: "LoadImageMask",
      inputs: {
        image: maskFile,
        channel: "red"
      }
    },
    "21": {
      class_type: "LoadImage",
      inputs: { image: femaleSideFile }
    },
    "22": {
      class_type: "LoadImage",
      inputs: { image: maleSideFile }
    },
    "10": {
      class_type: "QwenEditAdaptiveLongestEdge",
      inputs: {
        image: ["6", 0],
        max_size: maxRefEdge
      }
    },
    "11": {
      class_type: "QwenEditConfigPreparer",
      inputs: {
        image: ["6", 0],
        mask: ["9", 0],
        to_ref: true,
        ref_main_image: true,
        ref_longest_edge: ["10", 0],
        ref_crop: "pad",
        ref_upscale: "lanczos",
        to_vl: true,
        vl_resize: true,
        vl_target_size: 384,
        vl_crop: "center",
        vl_upscale: "bicubic"
      }
    },
    "12": {
      class_type: "QwenEditConfigPreparer",
      inputs: {
        image: ["7", 0],
        configs: ["11", 0],
        to_ref: true,
        ref_main_image: false,
        ref_longest_edge: 768,
        ref_crop: "center",
        ref_upscale: "lanczos",
        to_vl: true,
        vl_resize: true,
        vl_target_size: 384,
        vl_crop: "center",
        vl_upscale: "bicubic"
      }
    },
    "13": {
      class_type: "QwenEditConfigPreparer",
      inputs: {
        image: ["8", 0],
        configs: ["12", 0],
        to_ref: true,
        ref_main_image: false,
        ref_longest_edge: 768,
        ref_crop: "center",
        ref_upscale: "lanczos",
        to_vl: true,
        vl_resize: true,
        vl_target_size: 384,
        vl_crop: "center",
        vl_upscale: "bicubic"
      }
    },
    "14": {
      class_type: "TextEncodeQwenImageEditPlusCustom_lrzjason",
      inputs: {
        clip: ["4", 0],
        vae: ["5", 0],
        configs: ["13", 0],
        prompt: promptText,
        return_full_refs_cond: true,
        instruction:
          usePoseRef
            ? "Describe identity and clothing from character references, use the pose reference to preserve standing interaction, then rewrite only the masked region of the main image so the result stays one natural scene with preserved character identity and natural full-body anatomy."
            : "Describe the identity, clothing, and pose cues from the reference images, then rewrite only the masked region of the main image so the edited result remains a single natural scene with preserved character identity."
      }
    },
    "15": {
      class_type: "ConditioningZeroOut",
      inputs: {
        conditioning: ["14", 0]
      }
    },
    "16": {
      class_type: "KSampler",
      inputs: {
        model: ["2", 0],
        positive: ["14", 0],
        negative: ["15", 0],
        latent_image: ["14", 1],
        seed,
        steps,
        cfg,
        sampler_name: samplerName,
        scheduler,
        denoise
      }
    },
    "17": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["16", 0],
        vae: ["5", 0]
      }
    },
    "18": {
      class_type: "QwenEditOutputExtractor",
      inputs: {
        custom_output: ["14", 2]
      }
    },
    "19": {
      class_type: "CropWithPadInfo",
      inputs: {
        image: ["17", 0],
        pad_info: ["18", 0]
      }
    },
    "20": {
      class_type: "SaveImage",
      inputs: {
        images: ["19", 0],
        filename_prefix: `Storyboard/${tag}`
      }
    }
  };

  if (disableLora && prompt["16"]?.inputs) {
    prompt["16"].inputs.model = ["1", 0];
  }

  let lastConfigNode = "13";
  if (useSideRefs) {
    prompt["23"] = {
      class_type: "QwenEditConfigPreparer",
      inputs: {
        image: ["21", 0],
        configs: ["13", 0],
        to_ref: true,
        ref_main_image: false,
        ref_longest_edge: 640,
        ref_crop: "center",
        ref_upscale: "lanczos",
        to_vl: true,
        vl_resize: true,
        vl_target_size: 384,
        vl_crop: "center",
        vl_upscale: "bicubic"
      }
    };
    prompt["24"] = {
      class_type: "QwenEditConfigPreparer",
      inputs: {
        image: ["22", 0],
        configs: ["23", 0],
        to_ref: true,
        ref_main_image: false,
        ref_longest_edge: 640,
        ref_crop: "center",
        ref_upscale: "lanczos",
        to_vl: true,
        vl_resize: true,
        vl_target_size: 384,
        vl_crop: "center",
        vl_upscale: "bicubic"
      }
    };
    lastConfigNode = "24";
  }

  if (usePoseRef) {
    prompt["25"] = {
      class_type: "LoadImage",
      inputs: { image: poseRefFile }
    };
    prompt["26"] = {
      class_type: "QwenEditConfigPreparer",
      inputs: {
        image: ["25", 0],
        configs: [lastConfigNode, 0],
        to_ref: false,
        ref_main_image: false,
        ref_longest_edge: 640,
        ref_crop: "center",
        ref_upscale: "lanczos",
        to_vl: true,
        vl_resize: true,
        vl_target_size: 384,
        vl_crop: "center",
        vl_upscale: "bicubic"
      }
    };
    lastConfigNode = "26";
  }
  prompt["14"].inputs.configs = [lastConfigNode, 0];

  const promptId = await queuePrompt(prompt);
  const outputs = await waitPromptOutputs(promptId, [20]);
  const outputPath = assetToPath(outputs[20][0]);

  const result = {
    promptId,
    outputPath,
    maskPath,
    settings: {
      shotPrefix,
      tag,
      seed,
      steps,
      cfg,
      denoise,
      samplerName,
      scheduler,
      disableLora,
      loraName,
      loraStrength,
      width,
      height,
      usePoseRef,
      poseRefFile: usePoseRef ? poseRefFile : "",
      maskStyle,
      promptText
    }
  };

  if (scoreEnabled) {
    result.scoreOutput = await runScore(outputPath);
  }

  console.log(JSON.stringify(result, null, 2));
}

await main();
