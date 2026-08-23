import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const presetDir = path.join(root, "src", "modules", "comfy-pipeline", "presets");
const presetNames = [
  "minimax-h3-t2v-v1.json",
  "minimax-h3-i2v-v1.json",
  "minimax-h3-flf2v-v1.json",
  "minimax-h3-r2v-v1.json"
];
const modelNames = [
  "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  "minimax_h3_video_vae_fp16.safetensors",
  "minimax_h3_audio_vae_fp32.safetensors"
];

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const item = process.argv[index];
  if (!item.startsWith("--")) continue;
  const [key, ...rest] = item.slice(2).split("=");
  if (rest.length > 0) args.set(key, rest.join("="));
  else if (process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) args.set(key, process.argv[++index]);
  else args.set(key, true);
}
const generate = args.has("generate");
const offline = args.has("offline");
const selfTest = args.has("self-test");
const requestedTimeoutMs = Number(args.get("timeout-ms") || process.env.COMFY_TIMEOUT_MS || 5000);
const timeoutMs = Number.isFinite(requestedTimeoutMs) ? Math.min(120000, Math.max(250, requestedTimeoutMs)) : 5000;
const reportPath = path.resolve(root, String(args.get("report") || ".superpowers/sdd/minimax-h3-video-smoke-report.json"));
const outputRoot = path.resolve(root, String(args.get("output-dir") || ".superpowers/sdd/minimax-h3-video-smoke-output"));
const outputDir = path.join(outputRoot, `run-${crypto.randomUUID()}`);

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function resolveBaseUrl() {
  if (args.get("base-url")) return { url: String(args.get("base-url")), source: "cli:--base-url" };
  if (process.env.MINIMAX_H3_COMFY_URL) return { url: process.env.MINIMAX_H3_COMFY_URL, source: "env:MINIMAX_H3_COMFY_URL" };
  return { url: "http://127.0.0.1:8188", source: "default:127.0.0.1:8188" };
}

async function requestJson(baseUrl, endpoint, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${endpoint}`, { ...options, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!response.ok) throw new Error(`HTTP ${response.status} ${endpoint}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function replaceTokens(value, tokens) {
  if (typeof value === "string") {
    return value.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
      if (!(key in tokens)) throw new Error(`unbound_token:${key}`);
      return String(tokens[key]);
    });
  }
  if (Array.isArray(value)) return value.map((item) => replaceTokens(item, tokens));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTokens(item, tokens)]));
  }
  return value;
}

function validatePrompt(name, prompt) {
  const nodes = Object.values(prompt).filter((node) => node && typeof node === "object" && typeof node.class_type === "string");
  const classes = new Set(nodes.map((node) => node.class_type));
  const required = ["CreateVideo", "SaveVideo", "VAEDecode", "VAEDecodeAudio", "BasicGuider"];
  const missing = required.filter((item) => !classes.has(item));
  if (name.includes("r2v")) {
    if (!classes.has("MiniMaxH3ReferenceToVideo")) missing.push("MiniMaxH3ReferenceToVideo");
  } else if (!classes.has("MiniMaxH3ImageToVideo")) missing.push("MiniMaxH3ImageToVideo");
  if (classes.has("TESpeedMiniMaxH3")) throw new Error(`${name}: TE Speed overlay is not production-enabled`);
  const unresolved = JSON.stringify(prompt).match(/\{\{[A-Z0-9_]+\}\}/g) || [];
  if (unresolved.length) throw new Error(`${name}: unresolved tokens ${unresolved.join(",")}`);
  if (missing.length) throw new Error(`${name}: missing ${missing.join(",")}`);
  return { nodeCount: nodes.length, nodeTypes: [...classes].sort() };
}

function tokensFor(name, overrides = {}) {
  return {
    VIDEO_PROMPT: "A restrained cinematic motion test with stable identity and natural breathing.",
    VIDEO_WIDTH: 512,
    VIDEO_HEIGHT: 512,
    H3_LENGTH: 124,
    SEED: 99173,
    FIRST_FRAME_PATH: overrides.firstFrame || "smoke-first-frame.png",
    LAST_FRAME_PATH: overrides.lastFrame || "smoke-last-frame.png",
    REF_IMAGE_1_PATH: "smoke-ref-1.png",
    REF_IMAGE_2_PATH: "smoke-ref-2.png",
    REF_IMAGE_3_PATH: "smoke-ref-3.png",
    REF_IMAGE_4_PATH: "smoke-ref-4.png"
  };
}

async function compilePresets(overrides = {}) {
  const compiled = {};
  for (const name of presetNames) {
    const template = await readJson(path.join(presetDir, name));
    const prompt = replaceTokens(template, tokensFor(name, overrides));
    compiled[name] = { prompt, validation: validatePrompt(name, prompt) };
  }
  return compiled;
}

function inventoryFromObjectInfo(objectInfo) {
  return { nodes: objectInfo && typeof objectInfo === "object" ? Object.keys(objectInfo) : [] };
}

function inventoryFromModels(models) {
  const out = [];
  if (Array.isArray(models)) out.push(...models.flatMap((item) => typeof item === "string" ? [item] : [item?.name, item?.filename].filter(Boolean)));
  else if (models && typeof models === "object") {
    for (const value of Object.values(models)) out.push(...inventoryFromModels(value).models);
  }
  return { models: [...new Set(out)] };
}

function relativePath(targetPath) {
  return path.relative(root, targetPath).replace(/\\/g, "/");
}

async function selfTestBaseUrlResolution() {
  const savedEnv = {
    MINIMAX_H3_COMFY_URL: process.env.MINIMAX_H3_COMFY_URL,
    COMFY_BASE_URL: process.env.COMFY_BASE_URL
  };
  try {
    process.env.MINIMAX_H3_COMFY_URL = "http://127.0.0.1:8199";
    delete process.env.COMFY_BASE_URL;
    const resolved = await resolveBaseUrl();
    assert.equal(resolved.source, "env:MINIMAX_H3_COMFY_URL");
    assert.equal(resolved.url, "http://127.0.0.1:8199");
  } finally {
    if (savedEnv.MINIMAX_H3_COMFY_URL === undefined) delete process.env.MINIMAX_H3_COMFY_URL;
    else process.env.MINIMAX_H3_COMFY_URL = savedEnv.MINIMAX_H3_COMFY_URL;
    if (savedEnv.COMFY_BASE_URL === undefined) delete process.env.COMFY_BASE_URL;
    else process.env.COMFY_BASE_URL = savedEnv.COMFY_BASE_URL;
  }
}

async function main() {
  const resolved = await resolveBaseUrl();
  const reportPathRelative = relativePath(reportPath);
  const outputDirRelative = relativePath(outputDir);
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: resolved.url.replace(/\/+$/, ""),
    baseUrlSource: resolved.source,
    mode: generate ? "generate" : "preflight",
    offline,
    timeoutMs,
    paths: {
      reportPath: reportPathRelative,
      outputDir: outputDirRelative
    },
    profiles: {},
    live: { status: offline ? "offline" : "not_attempted" },
    acceleration: { mode: "te_speed_preview", status: "draft_only" }
  };

  const compiled = await compilePresets(generate ? { firstFrame: args.get("first-frame") } : {});
  for (const [name, value] of Object.entries(compiled)) report.profiles[name] = value.validation;

  if (!offline) {
    try {
      const [systemStats, objectInfo, vaeModels, diffusionModels, textEncoderModels] = await Promise.all([
        requestJson(report.baseUrl, "/system_stats"),
        requestJson(report.baseUrl, "/object_info"),
        requestJson(report.baseUrl, "/models/vae"),
        requestJson(report.baseUrl, "/models/diffusion_models"),
        requestJson(report.baseUrl, "/models/text_encoders")
      ]);
      const nodeInventory = inventoryFromObjectInfo(objectInfo);
      const modelInventory = inventoryFromModels({ vae: vaeModels, diffusion_models: diffusionModels, text_encoders: textEncoderModels });
      report.live = {
        status: "online",
        systemStats: Boolean(systemStats),
        objectInfo: true,
        modelInventory: true,
        nodeCount: nodeInventory.nodes.length,
        modelCount: modelInventory.models.length,
        modelFolders: {
          vae: vaeModels,
          diffusion_models: diffusionModels,
          text_encoders: textEncoderModels
        },
        missingModels: modelNames.filter((name) => !modelInventory.models.some((item) => String(item).endsWith(name)))
      };
      if (report.live.missingModels.length > 0) report.live.status = "online_missing_models";
    } catch (error) {
      report.live = { status: "offline", warning: String(error?.message || error) };
      if (args.has("require-live")) throw error;
    }
  }

  if (generate) {
    const firstFrame = String(args.get("first-frame") || "").trim();
    if (!firstFrame) throw new Error("--generate requires --first-frame=<Comfy-visible filename>");
    const clientId = `minimax-h3-smoke-${crypto.randomUUID()}`;
    const i2v = compiled["minimax-h3-i2v-v1.json"].prompt;
    await fs.mkdir(outputDir, { recursive: true });
    try {
      const queued = await requestJson(report.baseUrl, "/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: clientId, prompt: i2v })
      });
      const promptId = queued?.prompt_id || queued?.promptId;
      const cancelled = queued?.status === "cancelled" || queued?.status === "canceled";
      if (!promptId || cancelled) {
        throw new Error(cancelled ? "generate was cancelled" : "generate did not return prompt_id");
      }
      report.generation = {
        clientId,
        promptId,
        profile: "minimax_h3_i2v",
        length: 124,
        isolated: true,
        firstFrame,
        outputDir: outputDirRelative
      };
    } catch (error) {
      report.cleanup = {
        status: "removed",
        outputDir: outputDirRelative,
        reason: String(error?.message || error)
      };
      await fs.rm(outputDir, { recursive: true, force: true });
      await fs.mkdir(path.dirname(reportPath), { recursive: true });
      await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      throw error;
    }
  }

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`PASS minimax h3 video smoke (${offline ? "offline" : report.live.status})`);
  console.log(`Report: ${reportPathRelative}`);
  console.log(`Output dir: ${outputDirRelative}`);
  if (report.generation) console.log(`Queued exactly one isolated sample: ${report.generation.promptId}`);
}

if (selfTest) {
  await selfTestBaseUrlResolution();
  console.log("PASS minimax h3 video smoke self-test");
  process.exit(0);
}

main().catch((error) => {
  console.error(`FAIL minimax h3 video smoke: ${error.message}`);
  process.exitCode = 1;
});
