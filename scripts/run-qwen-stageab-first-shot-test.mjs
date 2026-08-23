#!/usr/bin/env node

import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sanitizeSegment(value, fallback = "shot") {
  const normalized = String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function normalizeJsonText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  const direct = (() => {
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      return "";
    }
  })();
  if (direct) return direct;
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace < 0) return "";
  for (let index = firstBrace; index < trimmed.length; index += 1) {
    if (trimmed[index] !== "{") continue;
    const candidate = trimmed.slice(index).trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Continue.
    }
  }
  return "";
}

function normalizePromptText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function appendNegativePrompt(base, extra) {
  const left = String(base || "").trim();
  const right = String(extra || "").trim();
  if (!left) return right;
  if (!right) return left;
  return `${left}, ${right}`;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildStageAPrompt(fullPrompt, char1Name, char2Name) {
  const char1 = String(char1Name || "角色A").trim();
  const char2 = String(char2Name || "角色B").trim();
  const baseRaw = normalizePromptText(fullPrompt);
  const char2Pattern = char2 ? new RegExp(escapeRegExp(char2), "gi") : null;
  let base = baseRaw
    .replace(char2Pattern ?? /$^/, "")
    .replace(/\bexact(?:ly)?\s*two\b/gi, "")
    .replace(/\bboth characters?\b/gi, "")
    .replace(/\btwo characters?\b/gi, "")
    .replace(/\btwo people\b/gi, "")
    .replace(/\bsecond character\b/gi, "")
    .replace(/\bpartner\b/gi, "")
    .replace(/双人|两人|2人|二人|第二人|同伴|搭档|且只能有2人/g, "")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const hardDualPattern =
    /(?:\b(?:exact(?:ly)?\s*two|two\s*(?:people|characters?)|both\s*characters?|second\s*character|third\s*person|crowd)\b|[2\u4e8c\u4e24\u4fe9]\s*\u4eba|\u53cc\u4eba|\u4e24\u4eba|\u4e8c\u4eba|\u786c\u6027\u4eba\u6570|\u7b2c\u4e09\u4eba)/iu;
  const clauses = base
    .split(/[\n,，。;；]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const filteredClauses = clauses.filter((clause) => {
    if (char2Pattern?.test(clause)) return false;
    if (hardDualPattern.test(clause)) return false;
    return true;
  });
  base = (filteredClauses.length > 0 ? filteredClauses : clauses)
    .join(", ")
    .replace(char2Pattern ?? /$^/, "")
    .replace(/[ ]{2,}/g, " ")
    .replace(/,\s*,/g, ", ")
    .replace(/^,\s*|,\s*$/g, "")
    .trim();
  const stageABrief =
    "Keep camera framing and scene continuity from the scene/frame references, but render only one visible person.";
  const adaptedShotDescriptionLine = base
    ? `Stage A adapted shot description (single-character rewrite, keep camera/blocking cues): ${base}`
    : "";
  return [
    stageABrief,
    adaptedShotDescriptionLine,
    `Stage A target: render exactly one visible person only, ${char1}.`,
    `Do not draw ${char2} in this pass.`,
    "Place the visible character strictly inside the pass-A mask slot and keep the original slot position.",
    "Do not place any person in the pass-B mask slot during Stage A.",
    "Follow camera framing, blocking, and action timing from the shot script for the visible character.",
    "Reserve partner space according to the shot script, but keep that space empty in Stage A.",
    "Hard rule: one and only one person in the final Stage A frame.",
    "The visible character must be full body from head to toe with grounded feet, readable face, and stable identity."
  ]
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function buildStageANegativePrompt(fullNegativePrompt, char2Name) {
  const extra = [
    "second person",
    "another person",
    "two people",
    "crowd",
    "bystander",
    "duplicate body",
    "duplicate head",
    "extra arms",
    "extra legs",
    "ghost limbs",
    "empty scenery",
    "scenery only",
    "missing character"
  ];
  if (String(char2Name || "").trim()) {
    extra.push(String(char2Name).trim(), `character ${String(char2Name).trim()}`);
  }
  return appendNegativePrompt(fullNegativePrompt, extra.join(", "));
}

function buildStageBPrompt(fullPrompt, char1Name, char2Name) {
  const char1 = String(char1Name || "角色A").trim();
  const char2 = String(char2Name || "角色B").trim();
  const base = normalizePromptText(fullPrompt);
  return [
    base,
    `Stage B target: keep ${char1} unchanged and add exactly one new visible person only, ${char2}.`,
    `Character A (${char1}) identity, outfit, pose rhythm, and scale must stay stable.`,
    `Character B (${char2}) must match primary references for face, hairstyle, outfit, silhouette, and color palette.`,
    "Place Character B strictly inside the pass-B mask slot; do not move Character B to a different slot.",
    "Keep Character A anchored in the pass-A slot; do not relocate either character and do not recenter camera.",
    "Hard rule: final Stage B frame contains exactly two people, no more and no less.",
    "Both people must be full body from head to toe with grounded feet, complete limbs, readable expressions, and natural scene integration.",
    "No third person, no duplicate body, no identity swap, no sticker-like cutout."
  ]
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function buildStageBNegativePrompt(fullNegativePrompt, char1Name, char2Name) {
  const extra = [
    "one person only",
    "missing second character",
    "third person",
    "crowd",
    "bystander",
    "duplicate body",
    "duplicate head",
    "extra arms",
    "extra legs",
    "ghost limbs",
    "cropped body",
    "cut off feet",
    "sticker-like cutout",
    "hard white edge",
    "identity drift",
    "outfit drift",
    "empty scenery"
  ];
  extra.push("character B outside reserved slot", "recentered composition", "character slot swap");
  if (String(char1Name || "").trim()) {
    extra.push(`${String(char1Name).trim()} changed`, `${String(char1Name).trim()} missing`);
  }
  if (String(char2Name || "").trim()) {
    extra.push(`${String(char2Name).trim()} missing`);
  }
  return appendNegativePrompt(fullNegativePrompt, extra.join(", "));
}

function orderCharactersByPromptMention(characterNames, promptText) {
  const names = Array.isArray(characterNames)
    ? characterNames.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (names.length <= 1) return names;
  const prompt = String(promptText || "");
  const mapped = names.map((name, index) => ({
    name,
    index,
    mentionAt: prompt.indexOf(name)
  }));
  const mentioned = mapped
    .filter((item) => item.mentionAt >= 0)
    .sort((left, right) => left.mentionAt - right.mentionAt || left.index - right.index);
  if (mentioned.length === 0) return names;
  const mentionedSet = new Set(mentioned.map((item) => item.name));
  const unmentioned = mapped.filter((item) => !mentionedSet.has(item.name));
  return [...mentioned.map((item) => item.name), ...unmentioned.map((item) => item.name)];
}

const args = parseArgs(process.argv.slice(2));
const comfyRoot = String(
  args.comfyRoot || "C:/Users/Administrator/Desktop/AiProject/ComfyUI_JM_windows_portable"
).trim();
const comfyBaseUrl = String(args.baseUrl || "http://127.0.0.1:8188").replace(/\/+$/, "");
const comfyInputDir = path.join(comfyRoot, "ComfyUI", "input");
const comfyOutputDir = path.join(comfyRoot, "ComfyUI", "output");
const shotScriptPath = path.resolve(
  String(args.shotScript || "examples/river-continuity-test/river_continuity_test_shot_script.json")
);
const shotId = String(args.shotId || "river_continuity_001").trim();
const shotPrefix = String(args.shotPrefix || `shot_${shotId}`).trim();
const stageAWorkflowPath = path.resolve(
  String(
    args.stageA ||
      "src/modules/comfy-pipeline/presets/river_pair_qwen_custom_stageA_2511_minref.json"
  )
);
const stageBWorkflowPath = path.resolve(
  String(
    args.stageB ||
      "src/modules/comfy-pipeline/presets/river_pair_qwen_custom_stageB_2511_from_stageA.json"
  )
);
const timeoutMs = Math.max(10_000, Number(args.timeoutMs || 20 * 60 * 1000));
const pollMs = Math.max(500, Number(args.pollMs || 1200));
const seed = Math.max(1, Math.floor(toNumber(args.seed, Date.now())));
const maxSize = Math.max(512, Math.floor(toNumber(args.maxSize, 896)));
const refEdge = Math.max(256, Math.floor(toNumber(args.refEdge, 512)));
const vlSize = Math.max(384, Math.floor(toNumber(args.vlSize, 384)));
const steps = Math.max(2, Math.floor(toNumber(args.steps, 4)));
const cfg = Math.max(0.1, toNumber(args.cfg, 1));
const denoise = Math.max(0, Math.min(1, toNumber(args.denoise, 1)));
const scoreEnabled = String(args.score || "1").trim() !== "0";
const twoStageArg = String(args.twoStage || "auto").trim().toLowerCase();
const targetPath = String(args.target || path.join(comfyRoot, "target.png")).trim();
const scoreScriptPath = path.join(repoRoot, "scripts", "score-storyboard-target.ps1");
const runTag = sanitizeSegment(String(args.tag || `stageab_firstshot_${Date.now()}`).trim(), "stageab_test");
const stageASanitizeScriptPath = path.join(repoRoot, "scripts", "storyboard_sanitize_stagea.py");
const pythonExe = path.resolve(
  String(args.python || path.join(comfyRoot, "python_embeded", "python.exe"))
);
const retryProfilesStageA = (() => {
  const fallbackDenoiseL1 = clamp(Math.min(denoise, 0.9), 0.72, 0.96);
  const fallbackDenoiseL2 = clamp(Math.min(denoise, 0.88), 0.7, 0.94);
  const fallbackDenoiseL3 = clamp(Math.min(denoise, 0.84), 0.68, 0.92);
  const fallbackCfgL1 = clamp(Math.min(cfg, 1.0), 0.9, 1.08);
  const fallbackCfgL2 = clamp(Math.min(cfg, 0.98), 0.88, 1.06);
  const fallbackCfgL3 = clamp(Math.min(cfg, 0.95), 0.86, 1.04);
  const profiles = [
    { maxSize, refEdge, steps, cfg, denoise },
    {
      maxSize: Math.round(clamp(Math.min(maxSize, 832), 704, 1024)),
      refEdge: Math.round(clamp(Math.min(refEdge, 480), 384, 640)),
      steps: Math.round(clamp(Math.min(steps, 6), 4, 8)),
      cfg: fallbackCfgL1,
      denoise: fallbackDenoiseL1
    },
    {
      maxSize: Math.round(clamp(Math.min(maxSize, 768), 704, 1024)),
      refEdge: Math.round(clamp(Math.min(refEdge, 448), 384, 640)),
      steps: Math.round(clamp(Math.min(steps, 5), 4, 8)),
      cfg: fallbackCfgL2,
      denoise: fallbackDenoiseL2
    },
    {
      maxSize: Math.round(clamp(Math.min(maxSize, 704), 640, 1024)),
      refEdge: Math.round(clamp(Math.min(refEdge, 416), 352, 640)),
      steps: Math.round(clamp(Math.min(steps, 4), 3, 8)),
      cfg: fallbackCfgL3,
      denoise: fallbackDenoiseL3
    }
  ];
  const seen = new Set();
  return profiles.filter((item) => {
    const key = `${item.maxSize}|${item.refEdge}|${item.steps}|${item.cfg}|${item.denoise}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
})();

const retryProfilesStageB = (() => {
  const fallbackDenoiseL1 = clamp(Math.min(denoise, 0.9), 0.72, 0.96);
  const fallbackDenoiseL2 = clamp(Math.min(denoise, 0.88), 0.7, 0.94);
  const fallbackDenoiseL3 = clamp(Math.min(denoise, 0.84), 0.68, 0.92);
  const fallbackCfgL1 = clamp(Math.min(cfg, 1.0), 0.9, 1.08);
  const fallbackCfgL2 = clamp(Math.min(cfg, 0.98), 0.88, 1.06);
  const fallbackCfgL3 = clamp(Math.min(cfg, 0.95), 0.86, 1.04);
  const profiles = [
    { maxSize, refEdge, steps, cfg, denoise },
    {
      maxSize: Math.round(clamp(Math.min(maxSize, 832), 704, 1024)),
      refEdge: Math.round(clamp(Math.min(refEdge, 480), 384, 640)),
      steps: Math.round(clamp(Math.min(steps, 6), 4, 8)),
      cfg: fallbackCfgL1,
      denoise: fallbackDenoiseL1
    },
    {
      maxSize: Math.round(clamp(Math.min(maxSize, 768), 704, 1024)),
      refEdge: Math.round(clamp(Math.min(refEdge, 448), 384, 640)),
      steps: Math.round(clamp(Math.min(steps, 5), 3, 8)),
      cfg: fallbackCfgL2,
      denoise: fallbackDenoiseL2
    },
    {
      maxSize: Math.round(clamp(Math.min(maxSize, 704), 640, 1024)),
      refEdge: Math.round(clamp(Math.min(refEdge, 416), 352, 640)),
      steps: Math.round(clamp(Math.min(steps, 4), 3, 8)),
      cfg: fallbackCfgL3,
      denoise: fallbackDenoiseL3
    }
  ];
  const seen = new Set();
  return profiles.filter((item) => {
    const key = `${item.maxSize}|${item.refEdge}|${item.steps}|${item.cfg}|${item.denoise}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
})();

function deepReplaceTokens(value, tokens) {
  if (typeof value === "string") {
    return value.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => String(tokens[key] ?? ""));
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepReplaceTokens(item, tokens));
  }
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, inner] of Object.entries(value)) {
      output[key] = deepReplaceTokens(inner, tokens);
    }
    return output;
  }
  return value;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${await response.text()}`);
  }
  return response.json();
}

async function queuePrompt(prompt, clientId) {
  const payload = await fetchJson(`${comfyBaseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, client_id: clientId })
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

async function waitPromptOutput(promptId, nodeId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const history = await fetchJson(`${comfyBaseUrl}/history/${encodeURIComponent(promptId)}`);
    const entry = history?.[promptId];
    if (entry) {
      const assets = collectNodeOutputImages(entry, nodeId);
      if (assets.length > 0) return assets[0];
      const status = entry?.status;
      const statusText = String(status?.status_str || "").toLowerCase();
      if (status?.completed === true || statusText === "success" || statusText === "failed" || statusText === "error") {
        throw new Error(`Prompt completed but no expected output found (status=${statusText || "unknown"})`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Timed out waiting for prompt ${promptId}`);
}

function assetToLocalPath(asset) {
  return path.join(comfyOutputDir, asset.subfolder || "", asset.filename);
}

async function stageToComfyInput(filePath, targetName) {
  await fs.mkdir(comfyInputDir, { recursive: true });
  const targetPath = path.join(comfyInputDir, targetName);
  await fs.copyFile(filePath, targetPath);
  return targetName;
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

async function runCommand(command, args, options = {}) {
  const { cwd = repoRoot, env = process.env, streamOutput = true } = options;
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk ?? "");
      stdout += text;
      if (streamOutput) process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk ?? "");
      stderr += text;
      if (streamOutput) process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function sanitizeStageABaseForDualCharacter(args) {
  const { stageAPath, scenePath, char1MaskPath, safeShotId } = args;
  if (!fssync.existsSync(stageAPath) || !fssync.existsSync(scenePath) || !fssync.existsSync(char1MaskPath)) {
    return null;
  }
  if (!fssync.existsSync(stageASanitizeScriptPath) || !fssync.existsSync(pythonExe)) {
    return null;
  }
  const sanitizedOutputPath = path.join(comfyInputDir, `shot_${safeShotId}_stageA_base_cli_sanitized.png`);
  const result = await runCommand(
    pythonExe,
    [
      stageASanitizeScriptPath,
      "--stageA",
      stageAPath,
      "--scene",
      scenePath,
      "--mask",
      char1MaskPath,
      "--output",
      sanitizedOutputPath
    ],
    {
      cwd: repoRoot,
      streamOutput: false
    }
  );
  if (result.code !== 0) {
    throw new Error(`stageA sanitize failed (${result.code}): ${result.stderr || result.stdout}`);
  }
  const jsonText = normalizeJsonText(result.stdout);
  if (!jsonText) {
    throw new Error(`stageA sanitize returned non-json output: ${result.stdout.slice(0, 300)}`);
  }
  const payload = JSON.parse(jsonText);
  const outputPath = String(payload?.outputPath || sanitizedOutputPath).trim();
  if (!outputPath || !fssync.existsSync(outputPath)) {
    throw new Error(`stageA sanitize output missing: ${outputPath || sanitizedOutputPath}`);
  }
  return {
    outputPath,
    stats: payload
  };
}

async function loadJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function isLikelyOutOfMemoryError(error) {
  const text = String(error ?? "").toLowerCase();
  if (!text) return false;
  return (
    text.includes("out of memory") ||
    text.includes("outofmemoryerror") ||
    text.includes("allocation on device") ||
    text.includes("insufficient memory") ||
    text.includes("memory") ||
    text.includes("oom") ||
    text.includes("prompt completed but no expected output found")
  );
}

async function runStageWithRetry(stageName, workflowTemplate, baseTokens, clientIdPrefix) {
  const retryProfiles = stageName === "Stage B" ? retryProfilesStageB : retryProfilesStageA;
  let lastError = null;
  for (let index = 0; index < retryProfiles.length; index += 1) {
    const profile = retryProfiles[index];
    const stageTokens = {
      ...baseTokens,
      STORYBOARD_QWEN_MAX_SIZE: String(profile.maxSize),
      STORYBOARD_QWEN_REF_EDGE: String(profile.refEdge),
      STORYBOARD_QWEN_VL_SIZE: String(vlSize),
      STORYBOARD_QWEN_STEPS: String(profile.steps),
      STORYBOARD_QWEN_CFG: String(profile.cfg),
      STORYBOARD_QWEN_DENOISE: String(profile.denoise)
    };
    try {
      const prompt = deepReplaceTokens(workflowTemplate, stageTokens);
      const promptId = await queuePrompt(prompt, `${clientIdPrefix}_${index}`);
      const outputAsset = await waitPromptOutput(promptId, 20);
      const outputPath = assetToLocalPath(outputAsset);
      if (!fssync.existsSync(outputPath)) {
        throw new Error(`${stageName} output file missing: ${outputPath}`);
      }
      return { promptId, outputAsset, outputPath, profile, stageTokens };
    } catch (error) {
      lastError = error;
      if (!isLikelyOutOfMemoryError(error) || index >= retryProfiles.length - 1) {
        throw error;
      }
    }
  }
  throw (lastError instanceof Error ? lastError : new Error(String(lastError ?? `${stageName} failed`)));
}

async function main() {
  const shotScript = await loadJson(shotScriptPath);
  const shots = Array.isArray(shotScript?.shots) ? shotScript.shots : [];
  const shot = shots.find((item) => String(item?.id || "").trim() === shotId);
  if (!shot) {
    throw new Error(`Shot not found in script: ${shotId}`);
  }

  const characterNames = Array.isArray(shot.character_names)
    ? shot.character_names.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const char1Name = String(args.char1Name || characterNames[0] || "角色A").trim();
  const char2Name = String(args.char2Name || characterNames[1] || "角色B").trim();
  const shotPrompt = String(args.prompt || shot.prompt || shot.notes || shot.title || "").trim();
  const orderedCharacterNames = orderCharactersByPromptMention(characterNames, shotPrompt);
  const resolvedChar1Name = String(
    args.char1Name || orderedCharacterNames[0] || characterNames[0] || "角色A"
  ).trim();
  const resolvedChar2Name = String(
    args.char2Name || orderedCharacterNames[1] || characterNames[1] || "角色B"
  ).trim();
  const shotNegativePrompt = String(args.negativePrompt || shot.negative_prompt || shot.negativePrompt || "").trim();
  const stageAPromptText = String(
    args.stageAPrompt || buildStageAPrompt(shotPrompt, resolvedChar1Name, resolvedChar2Name)
  ).trim();
  const stageBPromptText = String(
    args.stageBPrompt || buildStageBPrompt(shotPrompt, resolvedChar1Name, resolvedChar2Name)
  ).trim();
  const stageANegativePrompt = String(
    args.stageANegative || buildStageANegativePrompt(shotNegativePrompt, resolvedChar2Name)
  ).trim();
  const stageBNegativePrompt = String(
    args.stageBNegative || buildStageBNegativePrompt(shotNegativePrompt, resolvedChar1Name, resolvedChar2Name)
  ).trim();
  const shotTitleToken = sanitizeSegment(String(args.shotTitle || `image_asset_guided_${shotId}`).trim(), `image_asset_guided_${sanitizeSegment(shotId)}`);
  const safeShotId = sanitizeSegment(shotId);
  const frameImagePath = String(args.framePath || `${shotPrefix}_frame.png`).trim();
  const char1PrimaryPath = String(args.char1Path || `${shotPrefix}_char1_primary_path.png`).trim();
  const char2PrimaryPath = String(args.char2Path || `${shotPrefix}_char2_primary_path.png`).trim();
  const passAMaskPath = String(args.passAMask || `${shotPrefix}_char1_mask.png`).trim();
  const passBMaskPath = String(args.passBMask || `${shotPrefix}_char2_mask.png`).trim();
  const resolvedPassBMaskPath = (() => {
    const directMaskPath = path.join(comfyInputDir, passBMaskPath);
    if (passBMaskPath && fssync.existsSync(directMaskPath)) return passBMaskPath;
    return passAMaskPath;
  })();
  const requestedStageB =
    twoStageArg === "1" || twoStageArg === "true"
      ? true
      : twoStageArg === "0" || twoStageArg === "false"
        ? false
        : orderedCharacterNames.length >= 2;
  const shouldRunStageB = requestedStageB && Boolean(resolvedChar2Name);

  const baseTokens = {
    SHOT_TITLE: `${shotTitleToken}_${runTag}`,
    PROMPT: shotPrompt,
    SEED: String(seed),
    CHAR1_NAME: resolvedChar1Name,
    CHAR2_NAME: resolvedChar2Name,
    SCENE_REF_PATH: `${shotPrefix}_scene_ref_path.png`,
    CHAR1_PRIMARY_PATH: char1PrimaryPath,
    CHAR2_PRIMARY_PATH: char2PrimaryPath,
    PASS_A_CHARACTER_MASK_PATH: passAMaskPath,
    PASS_B_CHARACTER_MASK_PATH: resolvedPassBMaskPath
  };
  const resolvedStageAFramePath = (() => {
    const candidate = String(frameImagePath || "").trim();
    if (!candidate) return baseTokens.SCENE_REF_PATH;
    const absolute = path.join(comfyInputDir, candidate);
    return fssync.existsSync(absolute) ? candidate : baseTokens.SCENE_REF_PATH;
  })();

  const stageATemplate = await loadJson(stageAWorkflowPath);
  const stageATokens = {
    ...baseTokens,
    PROMPT: stageAPromptText,
    NEGATIVE_PROMPT: stageANegativePrompt,
    FRAME_IMAGE_PATH: resolvedStageAFramePath,
    CHAR1_PRIMARY_WEIGHT: String(args.char1PrimaryWeight || "0.96"),
    PASS_B_CHARACTER_MASK_PATH: passAMaskPath,
    CHAR2_PRIMARY_WEIGHT: "0",
    CHAR2_SECONDARY_WEIGHT: "0"
  };
  const stageAResult = await runStageWithRetry(
    "Stage A",
    stageATemplate,
    stageATokens,
    "run-qwen-stageab-first-shot-stageA"
  );
  const stageALocalPath = stageAResult.outputPath;
  let stageABaseLocalPath = stageALocalPath;
  let stageASanitizeStats = null;
  if (shouldRunStageB) {
    try {
      const sanitized = await sanitizeStageABaseForDualCharacter({
        stageAPath: stageALocalPath,
        scenePath: path.join(comfyInputDir, `${shotPrefix}_scene_ref_path.png`),
        char1MaskPath: path.join(comfyInputDir, passAMaskPath),
        safeShotId
      });
      if (sanitized?.outputPath) {
        stageABaseLocalPath = sanitized.outputPath;
        stageASanitizeStats = sanitized.stats ?? null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[stageA-sanitize] skip due to error: ${message}`);
    }
  }

  const stageAExt = path.extname(stageABaseLocalPath) || ".png";
  const stageAInputName = `shot_${safeShotId}_stageA_base_cli${stageAExt}`;
  await stageToComfyInput(stageABaseLocalPath, stageAInputName);

  let stageBResult = null;
  let stageBLocalPath = stageABaseLocalPath;
  let finalTokens = stageAResult.stageTokens;
  if (shouldRunStageB) {
    const stageBTemplate = await loadJson(stageBWorkflowPath);
    const stageBBaseTokens = {
      ...stageAResult.stageTokens,
      CHAR2_NAME: resolvedChar2Name,
      CHAR2_PRIMARY_PATH: char2PrimaryPath,
      PASS_B_CHARACTER_MASK_PATH: resolvedPassBMaskPath,
      CHAR1_PRIMARY_WEIGHT: String(args.char1PrimaryWeight || "0.96"),
      CHAR2_PRIMARY_WEIGHT: String(args.char2PrimaryWeight || "0.9"),
      CHAR2_SECONDARY_WEIGHT: String(args.char2SecondaryWeight || "0.34"),
      PROMPT: stageBPromptText,
      NEGATIVE_PROMPT: stageBNegativePrompt,
      FRAME_IMAGE_PATH: stageAInputName
    };
    stageBResult = await runStageWithRetry(
      "Stage B",
      stageBTemplate,
      stageBBaseTokens,
      "run-qwen-stageab-first-shot-stageB"
    );
    stageBLocalPath = stageBResult.outputPath;
    finalTokens = stageBResult.stageTokens;
  }

  const result = {
    shotId,
    shotTitle: String(shot.title || ""),
    requestedStageB,
    executedStageB: Boolean(stageBResult),
    stageA: {
      promptId: stageAResult.promptId,
      outputPath: stageABaseLocalPath,
      rawOutputPath: stageALocalPath,
      outputAsset: stageAResult.outputAsset,
      stagedInputName: stageAInputName,
      profile: stageAResult.profile,
      maskPath: passAMaskPath,
      sanitized: Boolean(stageASanitizeStats),
      sanitizeStats: stageASanitizeStats
    },
    stageB: stageBResult
      ? {
          promptId: stageBResult.promptId,
          outputPath: stageBLocalPath,
          outputAsset: stageBResult.outputAsset,
          profile: stageBResult.profile,
          maskPath: resolvedPassBMaskPath,
          maskFallbackToPassA: resolvedPassBMaskPath === passAMaskPath && passBMaskPath !== passAMaskPath
        }
      : {
          skipped: true,
          reason: requestedStageB ? "stageb_disabled" : "single_character_mode",
          outputPath: stageABaseLocalPath
        },
    tokens: finalTokens
  };

  if (scoreEnabled) {
    result.scoreOutput = await runScore(stageBLocalPath);
  }

  console.log(JSON.stringify(result, null, 2));
}

await main();
