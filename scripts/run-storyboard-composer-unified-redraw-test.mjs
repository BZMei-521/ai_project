#!/usr/bin/env node

import fs from "node:fs/promises";
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

const args = parseArgs(process.argv.slice(2));
const comfyBaseUrl = String(args.baseUrl || "http://127.0.0.1:8188").replace(/\/+$/, "");
const timeoutMs = Math.max(10_000, Number(args.timeoutMs || 15 * 60 * 1000));
const pollMs = Math.max(500, Number(args.pollMs || 1200));
const shotPrefix = String(args.shot || "shot_river_continuity_001").trim();
const tag = String(args.tag || `storyboard_composer_unified_redraw_${Date.now()}`).trim();
const checkpoint = String(args.checkpoint || "AbyssOrangeMix2_hard.safetensors").trim();
const controlnet = String(args.controlnet || "control_v11p_sd15_openpose_fp16.safetensors").trim();
const seed = Number.isFinite(Number(args.seed)) ? Number(args.seed) : 223344556677;
const steps = Math.max(8, Number(args.steps || 28));
const cfg = Math.max(1, Number(args.cfg || 6));
const denoise = Math.max(0, Math.min(1, Number(args.denoise || 0.38)));
const samplerName = String(args.sampler || "dpmpp_2m").trim();
const scheduler = String(args.scheduler || "karras").trim();
const width = Math.max(512, Number(args.width || 1024));
const height = Math.max(512, Number(args.height || 576));
const characterBgColor = String(args.characterBgColor || "#E6DCE6").trim();
const comfyRoot =
  args.comfyRoot || "C:/Users/Administrator/Desktop/AiProject/ComfyUI_JM_windows_portable";
const comfyOutputDir = path.join(comfyRoot, "ComfyUI", "output");
const scoreEnabled = String(args.score || "1").trim() !== "0";
const targetPath = String(args.target || path.join(comfyRoot, "target.png")).trim();
const scoreScriptPath = path.join(repoRoot, "scripts", "score-storyboard-target.ps1");
const examplePath = path.join(
  comfyRoot,
  "ComfyUI",
  "custom_nodes",
  "ComfyUI-StoryboardComposer",
  "examples",
  "storyboard_two_character_unified_redraw.json"
);

function workflowNodes(workflow) {
  return Array.isArray(workflow.nodes) ? workflow.nodes : [];
}

function isLikelyComfyApiPrompt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length === 0) return false;
  return entries.every(([key, node]) => /^\d+$/.test(key) && node && typeof node === "object" && "class_type" in node);
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

function getNodeByIdMap(workflow) {
  const map = new Map();
  for (const node of workflowNodes(workflow)) {
    if (typeof node?.id === "number") map.set(node.id, node);
  }
  return map;
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
  }
  return true;
}

function isKSamplerControlAfterGenerateValue(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "fixed" || normalized === "randomize" || normalized === "increment" || normalized === "decrement";
}

function objectInfoInputOrderNames(objectInfo, classType) {
  if (!objectInfo || !classType || typeof objectInfo !== "object") return [];
  const classInfo = objectInfo[classType];
  if (!classInfo || typeof classInfo !== "object" || Array.isArray(classInfo)) return [];
  const ordered = [];
  const pushBucket = (container, bucket) => {
    if (!container || typeof container !== "object" || Array.isArray(container)) return;
    const names = container[bucket];
    if (!Array.isArray(names)) return;
    for (const item of names) {
      if (typeof item === "string" && item.trim()) ordered.push(item.trim());
    }
  };
  if (classInfo.input_order && typeof classInfo.input_order === "object" && !Array.isArray(classInfo.input_order)) {
    pushBucket(classInfo.input_order, "required");
    pushBucket(classInfo.input_order, "optional");
  }
  if (ordered.length > 0) return ordered;
  if (classInfo.input && typeof classInfo.input === "object" && !Array.isArray(classInfo.input)) {
    pushBucket(classInfo.input, "required");
    pushBucket(classInfo.input, "optional");
  }
  return ordered;
}

function buildWidgetValuesByInputNameWithObjectInfo(node, objectInfo) {
  const output = {};
  const nodeInputs = Array.isArray(node.inputs) ? node.inputs : [];
  const nodeType = typeof node?.type === "string" ? node.type.trim() : "";
  const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : [];

  if (node.widgets_values && typeof node.widgets_values === "object" && !Array.isArray(node.widgets_values)) {
    for (const rawInput of nodeInputs) {
      if (!rawInput || typeof rawInput !== "object") continue;
      const name = typeof rawInput.name === "string" ? rawInput.name.trim() : "";
      if (!name || !hasWidgetMeta(rawInput)) continue;
      if (Object.prototype.hasOwnProperty.call(node.widgets_values, name)) {
        output[name] = node.widgets_values[name];
      }
    }
    return output;
  }

  let cursor = 0;
  const widgetInputs = nodeInputs.filter((input) => input && hasWidgetMeta(input) && typeof input.name === "string");
  for (const input of widgetInputs) {
    const name = String(input.name).trim();
    if (!name) continue;
    if (
      nodeType === "KSampler" &&
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

  if (objectInfo && node.type) {
    const ordered = objectInfoInputOrderNames(objectInfo, String(node.type).trim());
    const used = new Set(Object.keys(output));
    for (const rawInput of nodeInputs) {
      const name = typeof rawInput?.name === "string" ? rawInput.name.trim() : "";
      if (!name) continue;
      if (typeof rawInput.link === "number" || hasWidgetMeta(rawInput)) used.add(name);
    }
    const missing = ordered.filter((name) => !used.has(name));
    for (const name of missing) {
      if (cursor >= widgets.length) break;
      output[name] = widgets[cursor];
      cursor += 1;
    }
  }

  return output;
}

function graphWorkflowToApiPrompt(workflow, objectInfo) {
  if (isLikelyComfyApiPrompt(workflow)) return workflow;

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
    if (!nodeType || nodeType === "SetNode" || nodeType === "GetNode" || !nodeId || !linkedNodeIds.has(nodeId)) continue;
    const inputValues = {};
    const nodeInputs = Array.isArray(node.inputs) ? node.inputs : [];
    const widgetByInputName = buildWidgetValuesByInputNameWithObjectInfo(node, objectInfo);
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

async function queuePrompt(prompt) {
  const payload = await fetchJson(`${comfyBaseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, client_id: "run-storyboard-composer-unified-redraw-test" })
  });
  const promptId = String(payload?.prompt_id || "").trim();
  if (!promptId) throw new Error("Comfy returned no prompt_id");
  return promptId;
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

function assetToPath(asset) {
  return path.join(comfyOutputDir, asset.subfolder || "", asset.filename);
}

const workflow = JSON.parse(await fs.readFile(examplePath, "utf8"));
const byId = getNodeByIdMap(workflow);

setNodeWidgetValue(byId.get(1), 0, `${shotPrefix}_scene_ref_path.png`);

setNodeWidgetValue(byId.get(3), 0, `${shotPrefix}_char2_front_path.png`);
setNodeWidgetValue(byId.get(4), 0, `${shotPrefix}_char2_side_path.png`);
setNodeWidgetValue(byId.get(5), 0, `${shotPrefix}_char2_back_path.png`);

setNodeWidgetValue(byId.get(11), 0, `${shotPrefix}_char1_front_path.png`);
setNodeWidgetValue(byId.get(12), 0, `${shotPrefix}_char1_side_path.png`);
setNodeWidgetValue(byId.get(13), 0, `${shotPrefix}_char1_back_path.png`);

setNodeWidgetValue(byId.get(2), 0, width);
setNodeWidgetValue(byId.get(2), 1, height);
setNodeWidgetValue(byId.get(2), 3, "medium full shot, eye-level camera, riverside stone bridge path at sunset");

setNodeWidgetValue(byId.get(6), 0, "jiang_lan");
setNodeWidgetValue(byId.get(6), 1, "preserve exact turnaround character appearance, elegant anime lineart, young woman with long straight black hair, straight bangs, large blue eyes");
setNodeWidgetValue(byId.get(6), 3, "dusty blue long-sleeve dress, white collar, black shoes");
setNodeWidgetValue(byId.get(6), 4, "gentle warm expression");

setNodeWidgetValue(byId.get(14), 0, "shen_yan");
setNodeWidgetValue(byId.get(14), 1, "preserve exact turnaround character appearance, elegant anime lineart, young man with black hair and calm dark eyes");
setNodeWidgetValue(byId.get(14), 3, "dark navy long coat, brown waist sash, dark trousers, dark shoes");
setNodeWidgetValue(byId.get(14), 4, "soft affectionate expression");

setNodeWidgetValue(byId.get(7), 0, "walk_right");
setNodeWidgetValue(byId.get(7), 1, "front");
setNodeWidgetValue(byId.get(7), 2, "happy");
setNodeWidgetValue(byId.get(7), 3, "walking naturally while turning slightly toward her partner, inner right hand gently reaching for hand holding, grounded feet, natural anatomy");
setNodeWidgetValue(byId.get(7), 4, "warm soft smile");

setNodeWidgetValue(byId.get(15), 0, "walk_left");
setNodeWidgetValue(byId.get(15), 1, "front");
setNodeWidgetValue(byId.get(15), 2, "happy");
setNodeWidgetValue(byId.get(15), 3, "walking naturally while turning slightly toward his partner, inner left hand gently reaching for hand holding, grounded feet, natural anatomy");
setNodeWidgetValue(byId.get(15), 4, "soft affectionate smile");

setNodeWidgetValue(byId.get(9), 0, "turnaround_pose_fit");
setNodeWidgetValue(byId.get(9), 1, 384);
setNodeWidgetValue(byId.get(9), 2, 1024);
setNodeWidgetValue(byId.get(9), 3, characterBgColor);
setNodeWidgetValue(byId.get(9), 4, toNumber(args.femalePoseFit, 0.54));

setNodeWidgetValue(byId.get(17), 0, "turnaround_pose_fit");
setNodeWidgetValue(byId.get(17), 1, 384);
setNodeWidgetValue(byId.get(17), 2, 1024);
setNodeWidgetValue(byId.get(17), 3, characterBgColor);
setNodeWidgetValue(byId.get(17), 4, toNumber(args.malePoseFit, 0.52));

setNodeWidgetValue(byId.get(10), 0, Math.round(toNumber(args.femaleFeetX, width * 0.36)));
setNodeWidgetValue(byId.get(10), 1, Math.round(toNumber(args.femaleGroundY, height * 0.97)));
setNodeWidgetValue(byId.get(10), 4, toNumber(args.femaleRatio, 0.84));
setNodeWidgetValue(byId.get(10), 7, toNumber(args.femaleFeather, 7));
setNodeWidgetValue(byId.get(10), 8, toNumber(args.femaleShadow, 0.30));
setNodeWidgetValue(byId.get(10), 9, "jiang_lan");

setNodeWidgetValue(byId.get(18), 0, Math.round(toNumber(args.maleFeetX, width * 0.60)));
setNodeWidgetValue(byId.get(18), 1, Math.round(toNumber(args.maleGroundY, height * 0.97)));
setNodeWidgetValue(byId.get(18), 4, toNumber(args.maleRatio, 0.88));
setNodeWidgetValue(byId.get(18), 7, toNumber(args.maleFeather, 7));
setNodeWidgetValue(byId.get(18), 8, toNumber(args.maleShadow, 0.30));
setNodeWidgetValue(byId.get(18), 9, "shen_yan");

setNodeWidgetValue(byId.get(19), 0, Math.round(toNumber(args.minGapPx, 16)));
setNodeWidgetValue(byId.get(19), 1, toNumber(args.allowedOverlapRatio, 0.12));
setNodeWidgetValue(byId.get(19), 2, Math.round(toNumber(args.edgePadding, 28)));
setNodeWidgetValue(byId.get(19), 4, toNumber(args.centerPreservation, 0.94));

setNodeWidgetValue(byId.get(20), 0, checkpoint);
setNodeWidgetValue(byId.get(21), 0, controlnet);

setNodeWidgetValue(byId.get(22), 0, width);
setNodeWidgetValue(byId.get(22), 1, height);
setNodeWidgetValue(
  byId.get(22),
  3,
  "cinematic anime storyboard illustration, coherent single frame, preserved turnaround character identity, riverside bridge at sunset, two young adults walking hand in hand, natural body proportions, grounded feet, clean linework, soft reflected dusk light, integrated environment shading"
);
setNodeWidgetValue(
  byId.get(22),
  5,
  "sticker look, pasted collage, disconnected characters, duplicate people, extra limbs, broken hands, missing limbs, cropped body, white halo, cutout edges, floating feet, malformed anatomy, noisy artifacts"
);
setNodeWidgetValue(
  byId.get(22),
  6,
  "the pair walk side by side along the path, turn their faces toward each other, gently hold their inner hands, keep outer arms relaxed, and maintain a calm intimate rhythm"
);

setNodeWidgetValue(byId.get(23), 0, toNumber(args.controlStrength, 0.82));
setNodeWidgetValue(byId.get(23), 1, toNumber(args.controlStart, 0));
setNodeWidgetValue(byId.get(23), 2, toNumber(args.controlEnd, 1));

setKSamplerWidgetValues(byId.get(26), {
  seed,
  steps,
  cfg,
  samplerName,
  scheduler,
  denoise,
  controlAfterGenerate: "fixed"
});

setNodeWidgetValue(byId.get(28), 0, `Storyboard/${tag}`);

const objectInfo = await fetchJson(`${comfyBaseUrl}/object_info`);
const prompt = graphWorkflowToApiPrompt(workflow, objectInfo);

if (prompt["26"]?.inputs) {
  prompt["26"].inputs.seed = seed;
  prompt["26"].inputs.steps = steps;
  prompt["26"].inputs.cfg = cfg;
  prompt["26"].inputs.sampler_name = samplerName;
  prompt["26"].inputs.scheduler = scheduler;
  prompt["26"].inputs.denoise = denoise;
}
if (prompt["28"]?.inputs) {
  prompt["28"].inputs.filename_prefix = `Storyboard/${tag}`;
}

prompt["900"] = {
  class_type: "SaveImage",
  inputs: {
    images: ["22", 6],
    filename_prefix: `Storyboard/${tag}_composite_preview`
  }
};
prompt["901"] = {
  class_type: "SaveImage",
  inputs: {
    images: ["22", 4],
    filename_prefix: `Storyboard/${tag}_pose_preview`
  }
};

const promptId = await queuePrompt(prompt);
const outputs = await waitPromptOutputs(promptId, [28, 900, 901]);
const outputPath = assetToPath(outputs[28][0]);

const result = {
  promptId,
  outputPath,
  compositePreviewPath: outputs[900]?.[0] ? assetToPath(outputs[900][0]) : "",
  posePreviewPath: outputs[901]?.[0] ? assetToPath(outputs[901][0]) : "",
  settings: {
    shotPrefix,
    tag,
    checkpoint,
    controlnet,
    seed,
    steps,
    cfg,
    denoise,
    samplerName,
    scheduler,
    width,
    height,
    characterBgColor
  }
};

if (scoreEnabled) {
  result.scoreOutput = await runScore(outputPath);
}

console.log(JSON.stringify(result, null, 2));
