import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const value = (name, fallback = "") => {
  const i = args.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
  if (i < 0) return fallback;
  return args[i].includes("=") ? args[i].slice(name.length + 1) : args[i + 1] ?? fallback;
};
const baseUrl = value("--base-url", "http://127.0.0.1:8188").replace(/\/+$/, "");
const comfyRoot = value("--comfy-root");
const workflowId = value("--workflow-id", "storyboard-qwen-stageA");
const shotScript = value("--shot-script", "examples/river-dialogue-5s/river_dialogue_5s_shot_script.json");
const dryRun = args.includes("--dry-run");
const presets = {
  "storyboard-qwen-stageA": "src/modules/comfy-pipeline/presets/storyboard-image-qwen-stageA-v1.json",
  "storyboard-qwen-stageB": "src/modules/comfy-pipeline/presets/storyboard-image-qwen-stageB-v1.json",
  "storyboard-zimage-turbo": "src/modules/comfy-pipeline/presets/storyboard-image-zimage-turbo-v1.json",
  "storyboard-single-pass-fallback": "src/modules/comfy-pipeline/presets/storyboard-image-storyboard-composer-v1.json"
};
const diagnostics = [];
const report = { ok: false, dryRun, baseUrl, comfyRoot, workflowId, shotScript, diagnostics, mapping: null };
const fail = (code, message, status) => { diagnostics.push({ code, message }); report.checkedAt = new Date().toISOString(); console.log(JSON.stringify(report, null, 2)); process.exit(status); };

let script;
try { script = JSON.parse(await fs.readFile(path.resolve(shotScript), "utf8")); }
catch (error) { fail("missing_dependency", `Shot script could not be read: ${error.message}`, 3); }
const shot = script.shots?.[0];
if (!shot?.id) fail("missing_dependency", "Shot script contains no usable example shot", 3);
if (!presets[workflowId]) fail("missing_dependency", `Unknown workflow id: ${workflowId}`, 3);

for (const endpoint of ["/system_stats", "/object_info", "/queue"]) {
  try {
    const response = await fetch(`${baseUrl}${endpoint}`);
    if (!response.ok) diagnostics.push({ code: "offline", endpoint, message: `HTTP ${response.status}` });
  } catch (error) { diagnostics.push({ code: "offline", endpoint, message: error.message }); }
}
if (diagnostics.some((item) => item.code === "offline")) fail("offline", `ComfyUI is unavailable at ${baseUrl}`, 2);

const workflow = JSON.parse(await fs.readFile(path.resolve(presets[workflowId]), "utf8"));
const raw = JSON.stringify(workflow);
const models = [...new Set(raw.match(/[A-Za-z0-9_.-]+\.(?:safetensors|ckpt|pt|pth|bin)/gi) ?? [])];
const modelFiles = new Set();
if (comfyRoot) {
  let modelBase = comfyRoot;
  try {
    await fs.access(path.join(comfyRoot, "checkpoints"));
    modelBase = path.dirname(comfyRoot);
  } catch {
    // Use a conventional ComfyUI base directory when checkpoints is absent.
  }
  for (const folder of ["models/checkpoints", "models/vae", "models/controlnet", "models/ipadapter", "models/clip_vision", "models/diffusion_models", "models/loras", "models/clip", "models/text_encoders"]) {
    try { for (const file of await fs.readdir(path.join(modelBase, folder))) modelFiles.add(file.toLowerCase()); } catch {
      if (folder !== "models/ipadapter") diagnostics.push({ code: "missing_path", path: folder });
    }
  }
}
for (const model of models) if (comfyRoot && !modelFiles.has(model.toLowerCase())) diagnostics.push({ code: "missing_model", name: model });
if (diagnostics.some((item) => item.code === "missing_model" || item.code === "missing_path")) fail("missing_dependency", "Required workflow files are unresolved", 3);

if (!dryRun) {
  const prompt = {};
  for (const [id, node] of Object.entries(workflow)) {
    prompt[id] = { ...node, inputs: { ...node.inputs } };
    for (const [key, item] of Object.entries(prompt[id].inputs)) {
      if (typeof item === "string") {
        prompt[id].inputs[key] = item
          .replaceAll("{{PROMPT}}", shot.prompt ?? "")
          .replaceAll("{{SHOT_TITLE}}", shot.title ?? shot.id)
          .replaceAll("{{SEED}}", String(42));
      }
    }
  }
  const queued = await fetch(`${baseUrl}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }) });
  if (!queued.ok) fail("queue_failed", `Queue request failed: HTTP ${queued.status}`, 3);
  const queuedBody = await queued.json();
  const promptId = queuedBody.prompt_id;
  let history = null;
  for (let attempt = 0; attempt < 36; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const historyResponse = await fetch(`${baseUrl}/history/${promptId}`);
    if (historyResponse.ok) {
      const candidate = await historyResponse.json();
      if (candidate?.[promptId]) {
        history = candidate;
        break;
      }
    }
  }
  const outputs = history?.[promptId]?.outputs ?? {};
  const image = Object.values(outputs).flatMap((item) => item.images ?? [])[0];
  if (!image?.filename) fail("output_missing", "History did not contain an image output", 3);
  const view = `${baseUrl}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder ?? "")}&type=${encodeURIComponent(image.type ?? "output")}`;
  report.mapping = { shotId: shot.id, promptId, filename: image.filename, view };
}
report.ok = true;
report.checkedAt = new Date().toISOString();
console.log(JSON.stringify(report, null, 2));
