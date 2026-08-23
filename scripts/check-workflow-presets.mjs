import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const presetsDir = path.join(repoRoot, "src", "modules", "comfy-pipeline", "presets");
const searchDirs = ["src", "scripts"].map((value) => path.join(repoRoot, value));

const presetRules = {
  "asset-character-kontext-threeview-default.json": {
    level: "optional",
    expectNodeTypes: ["UNETLoader", "KSampler", "RMBG", "ImageStitch"],
    expectTokens: ["{{PROMPT}}"]
  },
  "asset-character-mvadapter-default.json": {
    level: "optional",
    expectTokens: ["{{PROMPT}}", "{{NEGATIVE_PROMPT}}"]
  },
  "asset-character-threeview-default.json": {
    level: "core",
    expectNodeTypes: ["CheckpointLoaderSimple", "KSampler", "SaveImage"],
    expectTokens: ["{{PROMPT}}", "{{NEGATIVE_PROMPT}}"]
  },
  "asset-skybox-default.json": {
    level: "core",
    expectNodeTypes: ["CheckpointLoaderSimple", "KSampler", "SaveImage"],
    expectTokens: ["{{PROMPT}}", "{{NEGATIVE_PROMPT}}"]
  },
  "asset-skybox-panorama-default.json": {
    level: "core",
    expectNodeTypes: ["CheckpointLoaderSimple", "KSampler", "SaveImage"],
    expectTokens: ["{{PROMPT}}", "{{NEGATIVE_PROMPT}}"]
  },
  "fisher-nextscene-v1.json": {
    level: "core",
    expectNodeTypesAny: [
      "TextEncodeQwenImageEditPlusPro_lrzjason",
      "TextEncodeQwenImageEditPlusAdvance_lrzjason"
    ],
    expectNodeTypes: ["KSampler", "VAEDecode"]
  },
  "storyboard-image-qwen-backside-v11.json": {
    level: "core",
    expectNodeTypesAny: ["TextEncodeQwenImageEditPlusCustom_lrzjason"],
    expectNodeTypes: ["KSampler", "VAEDecode", "SaveImage"],
    expectTokens: ["{{PROMPT}}", "{{SCENE_REF_PATH}}", "{{CHAR1_PRIMARY_PATH}}", "{{CHAR2_PRIMARY_PATH}}"]
  },
  "storyboard-image-fisher-light-v1.json": {
    level: "optional",
    expectNodeTypesAny: [
      "TextEncodeQwenImageEditPlusPro_lrzjason",
      "TextEncodeQwenImageEditPlusAdvance_lrzjason"
    ],
    expectNodeTypes: ["KSampler", "VAEDecode", "SaveImage"]
  },
  "minimax-h3-t2v-v1.json": {
    level: "core",
    h3Binding: true,
    expectNodeTypes: [
      "UNETLoader", "CLIPLoader", "VAELoader", "MiniMaxH3ImageToVideo",
      "BasicGuider", "VAEDecode", "VAEDecodeAudio", "CreateVideo", "SaveVideo"
    ],
    expectTokens: ["{{VIDEO_PROMPT}}", "{{VIDEO_WIDTH}}", "{{VIDEO_HEIGHT}}", "{{H3_LENGTH}}", "{{SEED}}"],
    expectModels: [
      "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
      "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
      "minimax_h3_video_vae_fp16.safetensors",
      "minimax_h3_audio_vae_fp32.safetensors"
    ]
  },
  "minimax-h3-i2v-v1.json": {
    level: "core",
    h3Binding: true,
    expectNodeTypes: [
      "UNETLoader", "CLIPLoader", "VAELoader", "MiniMaxH3ImageToVideo", "LoadImage",
      "BasicGuider", "VAEDecode", "VAEDecodeAudio", "CreateVideo", "SaveVideo"
    ],
    expectTokens: ["{{VIDEO_PROMPT}}", "{{VIDEO_WIDTH}}", "{{VIDEO_HEIGHT}}", "{{H3_LENGTH}}", "{{SEED}}", "{{FIRST_FRAME_PATH}}"],
    expectModels: [
      "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
      "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
      "minimax_h3_video_vae_fp16.safetensors",
      "minimax_h3_audio_vae_fp32.safetensors"
    ]
  },
  "minimax-h3-flf2v-v1.json": {
    level: "core",
    h3Binding: true,
    expectNodeTypes: [
      "UNETLoader", "CLIPLoader", "VAELoader", "MiniMaxH3ImageToVideo", "LoadImage",
      "BasicGuider", "VAEDecode", "VAEDecodeAudio", "CreateVideo", "SaveVideo"
    ],
    expectTokens: ["{{VIDEO_PROMPT}}", "{{VIDEO_WIDTH}}", "{{VIDEO_HEIGHT}}", "{{H3_LENGTH}}", "{{SEED}}", "{{FIRST_FRAME_PATH}}", "{{LAST_FRAME_PATH}}"],
    expectModels: [
      "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
      "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
      "minimax_h3_video_vae_fp16.safetensors",
      "minimax_h3_audio_vae_fp32.safetensors"
    ]
  },
  "minimax-h3-r2v-v1.json": {
    level: "core",
    h3Binding: true,
    expectNodeTypes: [
      "UNETLoader", "CLIPLoader", "VAELoader", "MiniMaxH3ReferenceToVideo", "LoadImage",
      "BasicGuider", "VAEDecode", "VAEDecodeAudio", "CreateVideo", "SaveVideo"
    ],
    expectTokens: [
      "{{VIDEO_PROMPT}}", "{{VIDEO_WIDTH}}", "{{VIDEO_HEIGHT}}", "{{H3_LENGTH}}", "{{SEED}}",
      "{{REF_IMAGE_1_PATH}}", "{{REF_IMAGE_2_PATH}}", "{{REF_IMAGE_3_PATH}}", "{{REF_IMAGE_4_PATH}}"
    ],
    expectModels: [
      "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
      "minimax_h3_video_vae_fp16.safetensors",
      "minimax_h3_audio_vae_fp32.safetensors"
    ]
  }
};

function collectWorkflowStats(parsed, raw) {
  const stats = {
    shape: "unknown",
    nodeCount: 0,
    nodeTypes: [],
    tokens: [...new Set(raw.match(/\{\{[A-Z0-9_]+\}\}/g) || [])].sort(),
    models: []
  };

  if (parsed && typeof parsed === "object" && Array.isArray(parsed.nodes)) {
    const enabledNodes = parsed.nodes.filter((node) => node && typeof node === "object" && Number(node?.mode) !== 4);
    const nodesById = new Map(
      enabledNodes
        .filter((node) => typeof node.id === "number" || typeof node.id === "string")
        .map((node) => [String(node.id), node])
    );
    const linkedNodeIds = new Set();
    const links = Array.isArray(parsed.links) ? parsed.links : [];
    for (const link of links) {
      if (!Array.isArray(link) || link.length < 4) continue;
      const sourceId = String(link[1] ?? "");
      const targetId = String(link[3] ?? "");
      if (nodesById.has(sourceId)) linkedNodeIds.add(sourceId);
      if (nodesById.has(targetId)) linkedNodeIds.add(targetId);
    }
    const effectiveNodes =
      linkedNodeIds.size > 0
        ? enabledNodes.filter((node) => linkedNodeIds.has(String(node.id)))
        : enabledNodes;
    stats.shape = "graph";
    stats.nodeCount = effectiveNodes.length;
    stats.nodeTypes = [...new Set(effectiveNodes.map((node) => node?.type || node?.class_type).filter(Boolean))].sort();
    stats.models = [...new Set(raw.match(/[A-Za-z0-9_-]+\.safetensors/g) || [])].sort();
    return stats;
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const promptEntries = Object.entries(parsed).filter(([key, value]) => {
      if (key === "extra_data" || key === "client_id") return false;
      return value && typeof value === "object" && !Array.isArray(value) && typeof value.class_type === "string";
    });
    if (promptEntries.length > 0) {
      stats.shape = "api_prompt";
      stats.nodeCount = promptEntries.length;
      stats.nodeTypes = [...new Set(promptEntries.map(([, value]) => value.class_type).filter(Boolean))].sort();
      stats.models = [...new Set(raw.match(/[A-Za-z0-9_-]+\.safetensors/g) || [])].sort();
      return stats;
    }
  }

  return stats;
}

async function* walkFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
      continue;
    }
    yield fullPath;
  }
}

async function collectSourceMentions(target) {
  const matches = [];
  for (const rootDir of searchDirs) {
    for await (const filePath of walkFiles(rootDir)) {
      if (!/\.(ts|tsx|js|mjs|json)$/i.test(filePath)) continue;
      const raw = await fs.readFile(filePath, "utf8");
      if (!raw.includes(target)) continue;
      const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, "/");
      if (relativePath === "scripts/check-workflow-presets.mjs") continue;
      matches.push(relativePath);
    }
  }
  return matches.sort();
}

async function fetchObjectInfo(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) return null;
  const controller = new AbortController();
  const requestedTimeout = Number(process.env.COMFY_WORKFLOW_AUDIT_TIMEOUT_MS || 3000);
  const timeoutMs = Number.isFinite(requestedTimeout) ? Math.min(30000, Math.max(250, requestedTimeout)) : 3000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${normalized}/object_info`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function formatList(values) {
  return values.length > 0 ? values.join(", ") : "-";
}

function buildH3BindingWarnings(parsed, rule) {
  if (!rule?.h3Binding || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const entries = Object.entries(parsed).filter(([, value]) => value && typeof value === "object" && typeof value.class_type === "string");
  const conditioning = entries.filter(([, value]) => /^MiniMaxH3(?:ImageToVideo|ReferenceToVideo)$/.test(value.class_type));
  const create = entries.filter(([, value]) => value.class_type === "CreateVideo");
  const save = entries.filter(([, value]) => value.class_type === "SaveVideo");
  const warnings = [];
  if (conditioning.length !== 1) warnings.push(`H3 conditioning 节点数量应为 1，实际 ${conditioning.length}`);
  if (create.length !== 1) warnings.push(`CreateVideo 节点数量应为 1，实际 ${create.length}`);
  if (save.length !== 1) warnings.push(`SaveVideo 节点数量应为 1，实际 ${save.length}`);
  if (create.length === 1) {
    const inputs = create[0][1].inputs || {};
    if (!Array.isArray(inputs.images) || inputs.images.length !== 2) warnings.push("CreateVideo.images 未连接到视频帧输出");
    if (!Array.isArray(inputs.audio) || inputs.audio.length !== 2) warnings.push("CreateVideo.audio 未连接到音频输出");
  }
  if (save.length === 1 && create.length === 1) {
    const video = save[0][1].inputs?.video;
    if (!Array.isArray(video) || video[0] !== create[0][0]) warnings.push("SaveVideo.video 未连接到 CreateVideo");
  }
  return warnings;
}

function buildWarnings(name, parsed, stats, rule, mentions, missingNodeTypes) {
  const warnings = [];
  if (stats.shape === "unknown") warnings.push("无法识别为 graph 或 Comfy API prompt 格式");
  if (stats.nodeCount <= 0) warnings.push("未检测到有效节点");
  if (rule?.expectNodeTypes) {
    const missingExpected = rule.expectNodeTypes.filter((item) => !stats.nodeTypes.includes(item));
    if (missingExpected.length > 0) {
      warnings.push(`缺少预期节点: ${missingExpected.join(", ")}`);
    }
  }
  if (rule?.expectNodeTypesAny && !rule.expectNodeTypesAny.some((item) => stats.nodeTypes.includes(item))) {
    warnings.push(`缺少候选节点组之一: ${rule.expectNodeTypesAny.join(" / ")}`);
  }
  if (rule?.expectTokens) {
    const missingTokens = rule.expectTokens.filter((item) => !stats.tokens.includes(item));
    if (missingTokens.length > 0) {
      warnings.push(`缺少预期占位符: ${missingTokens.join(", ")}`);
    }
  }
  if (rule?.expectModels) {
    const missingModels = rule.expectModels.filter((item) => !stats.models.includes(item));
    if (missingModels.length > 0) warnings.push(`缺少预期模型: ${missingModels.join(", ")}`);
  }
  if (mentions.length === 0) warnings.push("当前代码未直接引用此 preset");
  if (missingNodeTypes.length > 0) {
    warnings.push(`当前 ComfyUI 缺少节点: ${missingNodeTypes.join(", ")}`);
  }
  warnings.push(...buildH3BindingWarnings(parsed, rule));
  if (
    name === "storyboard-image-fisher-light-v1.json" &&
    stats.nodeTypes.some((item) => /Wan|RIFE|VHS_VideoCombine/i.test(item))
  ) {
    warnings.push("包含视频/补帧相关节点，建议仅作为兼容工作流使用");
  }
  return warnings;
}

const baseUrlArg = process.argv.find((item) => item.startsWith("--base-url="));
const comfyBaseUrl = baseUrlArg ? baseUrlArg.slice("--base-url=".length) : "http://127.0.0.1:8188";

const objectInfo = await fetchObjectInfo(comfyBaseUrl).catch((error) => {
  console.warn(`[workflow-audit] 无法读取 ${comfyBaseUrl}/object_info: ${error.message}`);
  return null;
});
const comfyNodeTypes = objectInfo ? new Set(Object.keys(objectInfo)) : null;
const presetNames = (await fs.readdir(presetsDir)).filter((name) => name.endsWith(".json")).sort();

const results = [];
for (const name of presetNames) {
  const filePath = path.join(presetsDir, name);
  const raw = await fs.readFile(filePath, "utf8");
  const mentions = await collectSourceMentions(name);
  const rule = presetRules[name] ?? { level: "optional" };
  try {
    const parsed = JSON.parse(raw);
    const stats = collectWorkflowStats(parsed, raw);
    const missingNodeTypes = comfyNodeTypes ? stats.nodeTypes.filter((item) => !comfyNodeTypes.has(item)) : [];
    const warnings = buildWarnings(name, parsed, stats, rule, mentions, missingNodeTypes);
    const blockingWarnings = warnings.filter(
      (item) => !item.includes("当前代码未直接引用此 preset") && !item.includes("包含视频/补帧相关节点")
    );
    results.push({
      name,
      level: rule.level,
      shape: stats.shape,
      nodeCount: stats.nodeCount,
      tokens: stats.tokens,
      models: stats.models,
      mentions,
      warnings,
      ok: rule.level !== "core" || blockingWarnings.length === 0
    });
  } catch (error) {
    results.push({
      name,
      level: rule.level,
      shape: "parse_error",
      nodeCount: 0,
      tokens: [],
      models: [],
      mentions,
      warnings: [`JSON 解析失败: ${error.message}`],
      ok: false
    });
  }
}

let failed = false;
for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name} [${result.level}] shape=${result.shape} nodes=${result.nodeCount}`);
  console.log(`  refs: ${formatList(result.mentions)}`);
  console.log(`  tokens: ${result.tokens.length > 0 ? result.tokens.join(", ") : "-"}`);
  if (result.warnings.length > 0) {
    console.log(`  notes: ${result.warnings.join(" | ")}`);
  }
  if (!result.ok) failed = true;
}

const referencedOptional = results.filter((item) => item.level === "optional" && item.mentions.length > 0).map((item) => item.name);
const unreferencedOptional = results.filter((item) => item.level === "optional" && item.mentions.length === 0).map((item) => item.name);

console.log("");
console.log(`Optional presets referenced by code: ${formatList(referencedOptional)}`);
console.log(`Optional presets currently orphaned: ${formatList(unreferencedOptional)}`);
console.log(`Comfy object_info checked: ${objectInfo ? "yes" : "no"}`);

if (failed) {
  process.exitCode = 1;
}
