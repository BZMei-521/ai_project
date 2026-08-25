import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const REFERENCE_ROLES = ["environment", "character", "depth", "normal", "character_id", "prop_id", "pose"];
export const PROFILE_FLOORS = {
  "storyboard-composer-v1": 12 * 1024 ** 3,
  "flux2-klein-multiref": 14 * 1024 ** 3,
  "qwen-stageA-v1": 14 * 1024 ** 3
};
const PROFILE_ORDER = Object.keys(PROFILE_FLOORS);
const SAFETY_MARGIN_BYTES = 2 * 1024 ** 3;
const PROFILE_PRESETS = {
  "storyboard-composer-v1": "src/modules/comfy-pipeline/presets/storyboard-image-storyboard-composer-v1.json",
  "flux2-klein-multiref": "src/modules/comfy-pipeline/presets/storyboard-image-flux2-klein-multiref.json",
  "qwen-stageA-v1": "src/modules/comfy-pipeline/presets/storyboard-image-qwen-stageA-v1.json"
};
const MODEL_INPUTS = {
  CheckpointLoaderSimple: ["ckpt_name"],
  UNETLoader: ["unet_name"],
  CLIPLoader: ["clip_name"],
  VAELoader: ["vae_name"],
  LoraLoaderModelOnly: ["lora_name"]
};

function codedError(code, details) {
  const error = new Error(details ? `${code}:${details}` : code);
  error.code = code;
  error.details = details;
  return error;
}

function sha256(value) {
  const bytes = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(bytes).digest("hex");
}

export function selectConstrainedProfile(inventory) {
  const profiles = Array.isArray(inventory?.profiles) ? inventory.profiles : [];
  for (const id of PROFILE_ORDER) {
    const profile = profiles.find((item) => item?.id === id);
    if (!profile?.available) continue;
    const roles = new Set(profile.referenceRoles ?? []);
    if (REFERENCE_ROLES.every((role) => roles.has(role))) return profile;
  }
  const reasons = profiles.map((profile) => `${profile.id}:${(profile.reasons ?? []).join("|") || "missing_required_reference_roles"}`).join(",");
  throw codedError("LOCAL_PROFILE_UNAVAILABLE", reasons || "no constrained local profile");
}

export function preflightLocalTrial(status) {
  const queueRunning = Number(status?.queueRunning ?? 0);
  const queuePending = Number(status?.queuePending ?? 0);
  if (queueRunning > 0 || queuePending > 0) throw codedError("COMFY_QUEUE_BUSY", `running=${queueRunning},pending=${queuePending}`);
  const floor = Number(status?.profile?.loadFloorBytes ?? PROFILE_FLOORS["storyboard-composer-v1"]);
  const freeVramBytes = Number(status?.freeVramBytes ?? 0);
  if (!Number.isFinite(freeVramBytes) || freeVramBytes < floor + SAFETY_MARGIN_BYTES) {
    throw codedError("LOCAL_VRAM_UNSAFE", `free=${freeVramBytes},required=${floor + SAFETY_MARGIN_BYTES}`);
  }
  return { ok: true, queueRunning, queuePending, freeVramBytes, requiredVramBytes: floor + SAFETY_MARGIN_BYTES };
}

function replaceTokens(value, bindings) {
  if (Array.isArray(value)) return value.map((item) => replaceTokens(item, bindings));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTokens(item, bindings)]));
  }
  if (typeof value !== "string") return value;
  const exact = value.match(/^\{\{([A-Z0-9_]+)\}\}$/);
  if (exact && Object.hasOwn(bindings, exact[1])) return bindings[exact[1]];
  return value.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, token) => Object.hasOwn(bindings, token) ? String(bindings[token]) : match);
}

function forceFrameDimensions(workflow) {
  for (const node of Object.values(workflow)) {
    if (!node?.inputs || typeof node.inputs !== "object") continue;
    if (typeof node.inputs.width === "number") node.inputs.width = 1280;
    if (typeof node.inputs.height === "number") node.inputs.height = 720;
  }
}

export function bindShotWorkflow(profile, input) {
  const roles = new Set(profile?.referenceRoles ?? []);
  for (const role of REFERENCE_ROLES) {
    if (!roles.has(role)) throw codedError("LOCAL_PROFILE_UNAVAILABLE", `${profile?.id ?? "unknown"}:missing_role:${role}`);
    if (!String(input?.references?.[role] ?? "").trim()) throw codedError("SHOT_REFERENCE_MISSING", role);
  }
  const bindings = {
    PROMPT: input.prompt,
    SHOT_TITLE: input.shotId,
    SEED: input.seed,
    ENVIRONMENT_PATH: input.references.environment,
    CHARACTER_PATH: input.references.character,
    DEPTH_PATH: input.references.depth,
    NORMAL_PATH: input.references.normal,
    CHARACTER_ID_PATH: input.references.character_id,
    PROP_ID_PATH: input.references.prop_id,
    POSE_PATH: input.references.pose
  };
  const workflow = replaceTokens(structuredClone(profile.workflow), bindings);
  forceFrameDimensions(workflow);
  return { workflow, referenceRoles: [...REFERENCE_ROLES], bindings };
}

export async function runShotCandidate({ shotId, workflow, journal, transport }) {
  const workflowDigest = sha256(workflow);
  const existing = await journal.readQueued();
  let promptId;
  if (existing) {
    if (existing.shotId !== shotId || existing.workflowDigest !== workflowDigest) {
      throw codedError("QUEUED_JOURNAL_MISMATCH", shotId);
    }
    promptId = existing.promptId;
  } else {
    await journal.writeAttempt({ shotId, workflowDigest, createdAt: new Date().toISOString() });
    const queued = await transport.queuePrompt(workflow);
    promptId = String(queued?.promptId ?? "").trim();
    if (!promptId) throw codedError("COMFY_PROMPT_ID_MISSING");
    await journal.writeQueued({ shotId, workflowDigest, promptId, queuedAt: new Date().toISOString() });
  }
  const output = await transport.waitForOutput(promptId);
  const completed = { ...output, shotId, workflowDigest, promptId, completedAt: new Date().toISOString() };
  await journal.writeCompleted(completed);
  return completed;
}

function workflowNodes(workflow) {
  if (Array.isArray(workflow?.nodes)) return workflow.nodes.map((node) => ({ id: String(node.id), classType: String(node.type ?? ""), inputs: {}, raw: node }));
  return Object.entries(workflow ?? {}).map(([id, node]) => ({ id, classType: String(node?.class_type ?? ""), inputs: node?.inputs ?? {}, raw: node }));
}

function isApiPrompt(workflow) {
  const entries = Object.values(workflow ?? {});
  return entries.length > 0 && entries.every((node) => node && typeof node === "object" && typeof node.class_type === "string");
}

function optionValues(objectInfo, classType, inputName) {
  const raw = objectInfo?.[classType]?.input?.required?.[inputName] ?? objectInfo?.[classType]?.input?.optional?.[inputName];
  if (!Array.isArray(raw)) return [];
  if (Array.isArray(raw[0])) return raw[0].map(String);
  return raw.filter((value) => typeof value === "string").map(String);
}

function inferReferenceRoles(profileId, workflow) {
  const serialized = JSON.stringify(workflow);
  const roles = new Set();
  if (/SCENE_REF_PATH|FRAME_IMAGE_PATH|put_your_scene_image_here/.test(serialized)) roles.add("environment");
  if (/CHAR\d+_PRIMARY_PATH|hero_front|support_front|observer_front/.test(serialized)) roles.add("character");
  if (/DEPTH_PATH/.test(serialized)) roles.add("depth");
  if (/NORMAL_PATH/.test(serialized)) roles.add("normal");
  if (/CHARACTER_ID_PATH/.test(serialized)) roles.add("character_id");
  if (/PROP_ID_PATH/.test(serialized)) roles.add("prop_id");
  if (/POSE_PATH/.test(serialized)) roles.add("pose");
  return [...roles];
}

export async function inspectLocalProfiles({ repoRoot, objectInfo }) {
  const profiles = [];
  for (const id of PROFILE_ORDER) {
    const presetPath = path.join(repoRoot, ...PROFILE_PRESETS[id].split("/"));
    const workflow = JSON.parse(await readFile(presetPath, "utf8"));
    const nodes = workflowNodes(workflow);
    const missingNodes = [...new Set(nodes.map((node) => node.classType).filter((type) => type && !objectInfo?.[type]))];
    const missingModels = [];
    for (const node of nodes) {
      for (const inputName of MODEL_INPUTS[node.classType] ?? []) {
        const selected = node.inputs?.[inputName] ?? (Array.isArray(node.raw?.widgets_values) ? node.raw.widgets_values[0] : undefined);
        if (typeof selected !== "string" || selected.includes("{{") || selected.startsWith("put_your_")) continue;
        const options = optionValues(objectInfo, node.classType, inputName);
        if (options.length > 0 && !options.includes(selected)) missingModels.push(`${node.classType}.${inputName}:${selected}`);
      }
    }
    const referenceRoles = inferReferenceRoles(id, workflow);
    const missingRoles = REFERENCE_ROLES.filter((role) => !referenceRoles.includes(role));
    const reasons = [];
    if (!isApiPrompt(workflow)) reasons.push("workflow_not_api_prompt");
    if (missingNodes.length) reasons.push(`missing_nodes:${missingNodes.join(",")}`);
    if (missingModels.length) reasons.push(`missing_models:${missingModels.join(",")}`);
    if (missingRoles.length) reasons.push(`missing_reference_roles:${missingRoles.join(",")}`);
    profiles.push({
      id,
      presetPath,
      loadFloorBytes: PROFILE_FLOORS[id],
      workflow: isApiPrompt(workflow) ? workflow : null,
      referenceRoles,
      missingNodes,
      missingModels,
      missingRoles,
      reasons,
      available: reasons.length === 0
    });
  }
  return profiles;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw codedError("COMFY_HTTP_ERROR", `${response.status}:${url}`);
  return response.json();
}

function queueCount(value) {
  if (Array.isArray(value)) return value.length;
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export async function discoverLiveInventory({ baseUrl, repoRoot }) {
  const root = baseUrl.replace(/\/$/, "");
  const [systemStats, queue, objectInfo] = await Promise.all([
    fetchJson(`${root}/system_stats`),
    fetchJson(`${root}/queue`),
    fetchJson(`${root}/object_info`)
  ]);
  const device = systemStats?.devices?.[0] ?? {};
  const profiles = await inspectLocalProfiles({ repoRoot, objectInfo });
  return {
    checkedAt: new Date().toISOString(),
    baseUrl: root,
    system: {
      comfyuiVersion: systemStats?.system?.comfyui_version ?? "unknown",
      gpu: device.name ?? "unknown",
      vramTotalBytes: Number(device.vram_total ?? 0),
      vramFreeBytes: Number(device.vram_free ?? 0)
    },
    queue: {
      running: queueCount(queue?.queue_running),
      pending: queueCount(queue?.queue_pending)
    },
    nodeCount: Object.keys(objectInfo ?? {}).length,
    profiles
  };
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

export function createFileJournal({ attemptPath, queuedPath, completedPath }) {
  return {
    async readQueued() {
      try { return JSON.parse(await readFile(queuedPath, "utf8")); }
      catch (error) { if (error?.code === "ENOENT") return null; throw error; }
    },
    writeAttempt: (value) => writeJsonAtomic(attemptPath, value),
    writeQueued: (value) => writeJsonAtomic(queuedPath, value),
    writeCompleted: (value) => writeJsonAtomic(completedPath, value)
  };
}

function collectOutput(historyEntry) {
  for (const [outputNodeId, output] of Object.entries(historyEntry?.outputs ?? {})) {
    const image = Array.isArray(output?.images) ? output.images[0] : null;
    if (image?.filename) return { filename: image.filename, subfolder: image.subfolder ?? "", type: image.type ?? "output", outputNodeId };
  }
  return null;
}

export function createComfyHttpTransport({ baseUrl, pollMs = 5000, timeoutMs = 10 * 60 * 1000 }) {
  const root = baseUrl.replace(/\/$/, "");
  return {
    async queuePrompt(workflow) {
      const payload = await fetchJson(`${root}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: "e01-spatial-storyboard-local" })
      });
      return { promptId: String(payload?.prompt_id ?? "") };
    },
    async waitForOutput(promptId) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const history = await fetchJson(`${root}/history/${encodeURIComponent(promptId)}`);
        const entry = history?.[promptId];
        const output = collectOutput(entry);
        if (output) return { promptId, ...output };
        const status = String(entry?.status?.status_str ?? "").toLowerCase();
        if (entry?.status?.completed === true || status === "error" || status === "failed") throw codedError("COMFY_OUTPUT_MISSING", status || promptId);
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      throw codedError("COMFY_PROMPT_TIMEOUT", promptId);
    },
    async uploadImage(filePath, subfolder = "e01-spatial-storyboard") {
      const form = new FormData();
      form.set("image", new Blob([await readFile(filePath)]), path.basename(filePath));
      form.set("subfolder", subfolder);
      form.set("type", "input");
      const payload = await fetchJson(`${root}/upload/image`, { method: "POST", body: form });
      return [payload?.subfolder, payload?.name].filter(Boolean).join("/");
    },
    async downloadOutput(asset) {
      const query = new URLSearchParams({ filename: asset.filename, subfolder: asset.subfolder ?? "", type: asset.type ?? "output" });
      const response = await fetch(`${root}/view?${query}`);
      if (!response.ok) throw codedError("COMFY_OUTPUT_DOWNLOAD_FAILED", String(response.status));
      return new Uint8Array(await response.arrayBuffer());
    }
  };
}

export function inspectPng(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || signature.some((value, index) => bytes[index] !== value)) throw codedError("OUTPUT_PNG_INVALID");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20), sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function writePreflightReport(filePath, report) {
  await writeJsonAtomic(path.resolve(filePath), report);
}
