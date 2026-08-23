import fs from "node:fs/promises";
import path from "node:path";

const arg = (name, fallback = "") => {
  const index = process.argv.findIndex((value) => value === name || value.startsWith(`${name}=`));
  if (index < 0) return fallback;
  const hit = process.argv[index];
  return hit.includes("=") ? hit.slice(name.length + 1) : process.argv[index + 1] ?? fallback;
};
const baseUrl = arg("--base-url", "http://127.0.0.1:8188").replace(/\/+$/, "");
const rootDir = arg("--root", "");
const requiredModels = process.argv.filter((value) => value.startsWith("--require-model=")).map((value) => value.slice("--require-model=".length));
const scanDirs = ["models/checkpoints", "models/vae", "models/controlnet", "models/ipadapter", "models/clip_vision", "models/diffusion_models", "models/loras", "models/clip", "models/text_encoders", "models/unet", "custom_nodes"];
const diagnostics = [];
const models = {};
const customNodes = [];
const missingPaths = [];

async function walk(dir, relative = "") {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const next = path.join(dir, entry.name);
    const rel = path.join(relative, entry.name).replaceAll("\\", "/").toLowerCase();
    if (entry.isDirectory()) files.push(...await walk(next, rel));
    else files.push(rel);
  }
  return files;
}

function normalizeModelName(value) {
  return String(value).replaceAll("\\", "/").split("/").pop().trim().toLowerCase();
}

if (process.argv.includes("--self-test")) {
  const fixture = await fs.mkdtemp(path.join(process.cwd(), ".tmp-comfy-scan-"));
  try {
    const checkpointDir = path.join(fixture, "models", "checkpoints");
    await fs.mkdir(checkpointDir, { recursive: true });
    await fs.writeFile(path.join(checkpointDir, "CaseModel.SAFETENSORS"), "fixture");
    const discovered = (await walk(checkpointDir, "models/checkpoints")).map(normalizeModelName);
    const missing = ["casemodel.safetensors", "missing-model.safetensors"].filter((name) => !discovered.includes(normalizeModelName(name)));
    if (missing.length !== 1 || missing[0] !== "missing-model.safetensors") throw new Error("normalized missing-model assertion failed");
    console.log(JSON.stringify({ ok: true, normalized: discovered, diagnostics: [{ code: "missing_model", name: missing[0] }] }, null, 2));
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
  process.exit(0);
}

let resolvedRootDir = rootDir;
if (rootDir) {
  try {
    await fs.access(path.join(rootDir, "checkpoints"));
    resolvedRootDir = path.dirname(rootDir);
  } catch {
    // Use a conventional ComfyUI base directory when checkpoints is absent.
  }
}

if (rootDir) {
  for (const relative of scanDirs) {
    const target = path.join(resolvedRootDir, relative);
    try {
      if (relative === "custom_nodes") {
        const entries = await fs.readdir(target, { withFileTypes: true });
        customNodes.push(
          ...entries
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
            .map((entry) => `${relative}/${entry.name}`.replaceAll("\\", "/").toLowerCase())
        );
      } else {
        models[relative] = await walk(target, relative);
      }
    } catch {
      if (relative === "custom_nodes" && resolvedRootDir !== rootDir) continue;
      missingPaths.push(relative);
    }
  }
}

const endpoints = {};
let online = true;
for (const endpoint of ["/system_stats", "/object_info", "/queue"]) {
  try {
    const response = await fetch(`${baseUrl}${endpoint}`);
    endpoints[endpoint] = { ok: response.ok, statusCode: response.status };
    online &&= response.ok;
    if (!response.ok) diagnostics.push({ code: "offline", name: endpoint, message: `ComfyUI endpoint failed: ${endpoint} HTTP ${response.status}` });
  } catch (error) {
    endpoints[endpoint] = { ok: false, message: String(error?.message ?? error) };
    online = false;
    diagnostics.push({ code: "offline", name: endpoint, message: `ComfyUI endpoint failed: ${endpoint}` });
  }
}
if (!online) diagnostics.push({ code: "offline", message: `ComfyUI is offline or partially unavailable at ${baseUrl}` });
for (const relative of missingPaths) diagnostics.push({ code: "missing_path", path: relative, message: `Missing scan directory: ${relative}` });
const availableModelNames = new Set(Object.values(models).flat().map(normalizeModelName));
for (const name of requiredModels) {
  if (!availableModelNames.has(normalizeModelName(name))) diagnostics.push({ code: "missing_model", name, message: `Required model is missing: ${name}` });
}

console.log(JSON.stringify({ online, rootDir, resolvedRootDir, models, customNodes, missingPaths, endpoints, diagnostics, checkedAt: new Date().toISOString() }, null, 2));
if (diagnostics.some((item) => item.code === "offline")) process.exitCode = 2;
else if (diagnostics.some((item) => item.code === "missing_model")) process.exitCode = 3;
