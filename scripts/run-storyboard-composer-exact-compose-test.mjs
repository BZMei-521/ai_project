#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

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
const timeoutMs = Math.max(10_000, Number(args.timeoutMs || 10 * 60 * 1000));
const pollMs = Math.max(500, Number(args.pollMs || 1200));
const shotPrefix = String(args.shot || "shot_river_continuity_001").trim();
const tag = String(args.tag || `storyboard_composer_exact_${Date.now()}`).trim();
const comfyRoot =
  args.comfyRoot || "C:/Users/Administrator/Desktop/AiProject/ComfyUI_JM_windows_portable";
const comfyOutputDir = path.join(comfyRoot, "ComfyUI", "output");
const examplePath = path.join(
  comfyRoot,
  "ComfyUI",
  "custom_nodes",
  "ComfyUI-StoryboardComposer",
  "examples",
  "storyboard_two_character_exact_compose.json"
);

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

function buildWidgetValuesByInputName(node, objectInfo) {
  const output = {};
  const nodeInputs = Array.isArray(node.inputs) ? node.inputs : [];
  const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : [];
  let cursor = 0;
  const widgetInputs = nodeInputs.filter((input) => input && hasWidgetMeta(input) && typeof input.name === "string");
  for (const input of widgetInputs) {
    const name = String(input.name).trim();
    if (!name) continue;
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${await response.text()}`);
  }
  return response.json();
}

function graphWorkflowToApiPrompt(workflow, objectInfo) {
  const nodes = workflowNodes(workflow);
  const activeNodeIds = new Set();
  for (const node of nodes) {
    if (isNodeDisabled(node)) continue;
    const id = typeof node.id === "number" || typeof node.id === "string" ? String(node.id) : "";
    if (id) activeNodeIds.add(id);
  }

  const linkById = new Map();
  const linkedNodeIds = new Set();
  for (const link of workflowLinks(workflow)) {
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
    const widgetByInputName = buildWidgetValuesByInputName(node, objectInfo);
    for (const rawInput of Array.isArray(node.inputs) ? node.inputs : []) {
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

async function queuePrompt(prompt) {
  const payload = await fetchJson(`${comfyBaseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, client_id: "run-storyboard-composer-exact-compose-test" })
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

function assetToPath(asset) {
  return path.join(comfyOutputDir, asset.subfolder || "", asset.filename);
}

const workflow = JSON.parse(await fs.readFile(examplePath, "utf8"));
const byId = getNodeByIdMap(workflow);

setNodeWidgetValue(byId.get(1), 0, `${shotPrefix}_scene_ref_path.png`);
setNodeWidgetValue(byId.get(3), 0, `${shotPrefix}_char2_front_path.png`);
setNodeWidgetValue(byId.get(9), 0, `${shotPrefix}_char1_front_path.png`);

setNodeWidgetValue(byId.get(2), 0, 1024);
setNodeWidgetValue(byId.get(2), 1, 576);
setNodeWidgetValue(byId.get(2), 3, "medium wide shot, eye-level camera, riverside stone bridge at sunset");

setNodeWidgetValue(byId.get(5), 0, "江岚");
setNodeWidgetValue(byId.get(5), 1, "preserve source character appearance, young woman with long straight black hair, straight bangs, large blue eyes");
setNodeWidgetValue(byId.get(5), 4, "gentle warm expression");

setNodeWidgetValue(byId.get(11), 0, "沈砚");
setNodeWidgetValue(byId.get(11), 1, "preserve source character appearance, young man with black hair and calm dark eyes");
setNodeWidgetValue(byId.get(11), 4, "soft affectionate expression");

setNodeWidgetValue(byId.get(8), 0, 360);
setNodeWidgetValue(byId.get(8), 1, 560);
setNodeWidgetValue(byId.get(8), 4, 0.80);
setNodeWidgetValue(byId.get(8), 9, "江岚");

setNodeWidgetValue(byId.get(14), 0, 690);
setNodeWidgetValue(byId.get(14), 1, 570);
setNodeWidgetValue(byId.get(14), 4, 0.88);
setNodeWidgetValue(byId.get(14), 9, "沈砚");

setNodeWidgetValue(byId.get(16), 0, `Storyboard/${tag}`);

const objectInfo = await fetchJson(`${comfyBaseUrl}/object_info`);
const prompt = graphWorkflowToApiPrompt(workflow, objectInfo);
if (prompt["7"]?.inputs) {
  prompt["7"].inputs.pose_fit_strength = 0.5;
}
if (prompt["13"]?.inputs) {
  prompt["13"].inputs.pose_fit_strength = 0.5;
}
if (prompt["16"]?.inputs) {
  prompt["16"].inputs.filename_prefix = `Storyboard/${tag}`;
}

const promptId = await queuePrompt(prompt);
const outputs = await waitPromptOutputs(promptId, [16]);
const outputPath = assetToPath(outputs[16][0]);

console.log(
  JSON.stringify(
    {
      promptId,
      outputPath,
      settings: {
        shotPrefix,
        tag
      }
    },
    null,
    2
  )
);
