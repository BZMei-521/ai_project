import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  CINEMATIC_3D_DONGHUA_CONTRACT,
  computeCharacterStyleContractDigest
} from "../src/modules/comfy-pipeline/characterStyleContractRuntime.mjs";
import { verifyCompiledCharacterReferenceBindings } from "../src/modules/comfy-pipeline/characterEvidenceContextRuntime.mjs";

const PROVIDER = "flux2_klein_4b";
const MODEL_NAME = "flux-2-klein-4b-fp8.safetensors";
const MANIFEST_NAME = "migration-manifest.json";
const MAX_OUTPUT_BYTES = 40 * 1024 * 1024;
const REQUIRED_ARGUMENTS = Object.freeze(["project", "character", "provider", "base-url", "workflow", "output"]);
const WORKFLOW_TOKENS = Object.freeze([
  "REFERENCE_IMAGE_A",
  "REFERENCE_IMAGE_B",
  "PROMPT",
  "VIEW",
  "STYLE_CONTRACT_ID",
  "STYLE_CONTRACT_VERSION",
  "CHARACTER_ASSET_ID",
  "SEED"
]);

export const PASSES = Object.freeze([
  Object.freeze({ id: "front", sourceSlots: Object.freeze(["face_master", "body_front"]), seed: 2026080901 }),
  Object.freeze({ id: "side", sourceSlots: Object.freeze(["face_left", "body_side"]), seed: 2026080902 }),
  Object.freeze({ id: "back", sourceSlots: Object.freeze(["hair_back", "body_back"]), seed: 2026080903 })
]);

const IDENTITY_PATHS = Object.freeze({
  face_master: "faceMasterPath",
  body_front: "bodyFrontPath",
  face_left: "faceLeftPath",
  body_side: "bodySidePath",
  hair_back: "hairBackPath",
  body_back: "bodyBackPath"
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const nonEmptyString = (value) => typeof value === "string" && Boolean(value.trim());

function isPathInside(root, target) {
  const child = relative(root, target);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function resolveWorkspaceArgument(value, label, workspaceRoot = process.cwd()) {
  if (!nonEmptyString(value)) throw new Error(`Missing --${label}.`);
  const root = resolve(workspaceRoot);
  const target = resolve(root, value);
  if (!isPathInside(root, target) || target === root) throw new Error(`${label} path must stay inside the workspace.`);
  return target;
}

async function assertNoReparseComponents(targetPath, dependencies = {}) {
  const statPath = dependencies.lstat ?? lstat;
  const absolute = resolve(targetPath);
  const parsed = parse(absolute);
  const parts = absolute.slice(parsed.root.length).split(sep).filter(Boolean);
  let current = parsed.root;
  for (const part of parts) {
    current = join(current, part);
    let stats;
    try {
      stats = await statPath(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (stats.isSymbolicLink()) throw new Error(`Symlink or reparse point is not allowed: ${current}`);
  }
}

async function assertExistingWorkspaceFile(targetPath, workspaceRoot, label, dependencies = {}) {
  const statPath = dependencies.lstat ?? lstat;
  const canonicalize = dependencies.realpath ?? realpath;
  await assertNoReparseComponents(targetPath, dependencies);
  const stats = await statPath(targetPath);
  if (!stats.isFile()) throw new Error(`${label} must be an existing regular file.`);
  const canonicalRoot = await canonicalize(workspaceRoot);
  const canonicalTarget = await canonicalize(targetPath);
  if (!isPathInside(canonicalRoot, canonicalTarget)) throw new Error(`${label} path must stay inside the workspace.`);
}

function imageMagic(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes ?? []);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

function assertPng(bytes, label) {
  if (imageMagic(bytes) !== "png") throw new Error(`${label} has malformed PNG image magic.`);
}

function collectNodeReferences(value, knownNodeIds, found = new Set()) {
  if (Array.isArray(value)) {
    if (value.length === 2 && knownNodeIds.has(String(value[0]))) found.add(String(value[0]));
    else for (const item of value) collectNodeReferences(item, knownNodeIds, found);
  } else if (isPlainObject(value)) {
    for (const item of Object.values(value)) collectNodeReferences(item, knownNodeIds, found);
  }
  return found;
}

function proveSelectedOutputGraph(entries, loaders, modelNodeId, outputNodeId) {
  const nodes = new Map(entries.map(([id, node]) => [String(id), node]));
  const edges = new Map([...nodes.keys()].map((id) => [id, new Set()]));
  for (const [targetId, node] of entries) {
    for (const sourceId of collectNodeReferences(node?.inputs, new Set(nodes.keys()))) edges.get(sourceId)?.add(String(targetId));
  }
  const reachesSelectedOutput = (startId, requireReferenceSink) => {
    const pending = [[String(startId), false]];
    const seen = new Set();
    while (pending.length) {
      const [current, priorSink] = pending.pop();
      const sink = priorSink || /^(?:ReferenceLatent|TextEncodeQwenImageEdit)|IPAdapter|InstantID|PuLID|PhotoMaker|FaceID/i.test(String(nodes.get(current)?.class_type ?? ""));
      const state = `${current}:${sink}`;
      if (seen.has(state)) continue;
      seen.add(state);
      if (current === String(outputNodeId) && (!requireReferenceSink || sink)) return true;
      for (const next of edges.get(current) ?? []) pending.push([next, sink]);
    }
    return false;
  };
  if (loaders.some(([id]) => !reachesSelectedOutput(id, true))) {
    throw new Error("Active reference binding failed: every loader must reach the selected SaveImage through a character reference sink.");
  }
  if (!reachesSelectedOutput(modelNodeId, false)) throw new Error("The authoritative Klein model must reach the selected SaveImage terminal.");
}

function validateWorkflowTemplate(template) {
  if (!isPlainObject(template)) throw new Error("Workflow template must be a JSON object.");
  const entries = Object.entries(template);
  const loaders = entries.filter(([, node]) => node?.class_type === "LoadImage");
  if (loaders.length !== 2) throw new Error("Workflow must contain exactly two active LoadImage reference loaders.");
  const loaderImages = loaders.map(([, node]) => node?.inputs?.image);
  if (loaderImages.some((value) => /screenshot|style[ _.-]?reference|codex[ _.-]?clipboard/i.test(String(value)))) {
    throw new Error("Screenshot or style reference loaders are forbidden.");
  }
  if (new Set(loaderImages).size !== 2 || !loaderImages.includes("{{REFERENCE_IMAGE_A}}") || !loaderImages.includes("{{REFERENCE_IMAGE_B}}")) {
    throw new Error("The two LoadImage nodes must be reserved for REFERENCE_IMAGE_A and REFERENCE_IMAGE_B.");
  }
  const models = entries.filter(([, node]) => node?.class_type === "UNETLoader");
  if (models.length !== 1 || models[0][1]?.inputs?.unet_name !== MODEL_NAME || models[0][1]?.inputs?.weight_dtype !== "default") {
    throw new Error(`Invalid Klein model binding; expected ${MODEL_NAME} with default weight dtype.`);
  }
  if (entries.some(([, node]) => /lora/i.test(String(node?.class_type ?? "")))) throw new Error("LoRA nodes are forbidden in style migration.");
  const outputs = entries.filter(([, node]) => node?.class_type === "SaveImage");
  if (outputs.length !== 1) throw new Error("Workflow must contain exactly one selected SaveImage terminal.");
  const allTerminals = entries.filter(([, node]) => /^(?:SaveImage|PreviewImage|VHS_VideoCombine|SaveAnimatedWEBP)$/i.test(String(node?.class_type ?? "")));
  if (allTerminals.length !== 1) throw new Error("The selected SaveImage must be the workflow's only output terminal.");
  proveSelectedOutputGraph(entries, loaders, models[0][0], outputs[0][0]);
  const encoded = JSON.stringify(template);
  for (const token of ["PROMPT", "VIEW", "STYLE_CONTRACT_ID", "STYLE_CONTRACT_VERSION", "CHARACTER_ASSET_ID"]) {
    if (!encoded.includes(`{{${token}}}`)) throw new Error(`Workflow is missing required token {{${token}}}.`);
  }
  return { outputNodeId: outputs[0][0] };
}

function replaceWorkflowTokens(value, tokens) {
  if (Array.isArray(value)) return value.map((item) => replaceWorkflowTokens(item, tokens));
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceWorkflowTokens(item, tokens)]));
  if (typeof value !== "string") return value;
  const exact = value.match(/^\{\{([A-Z0-9_]+)\}\}$/);
  if (exact && hasOwn(tokens, exact[1])) return tokens[exact[1]];
  return value.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, token) => hasOwn(tokens, token) ? String(tokens[token]) : match);
}

export function parseStyleMigrationArgs(argv) {
  if (!Array.isArray(argv)) throw new Error("Arguments must be an array.");
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!nonEmptyString(flag) || !flag.startsWith("--") || !nonEmptyString(value)) throw new Error(`Invalid argument near ${String(flag)}.`);
    const key = flag.slice(2);
    if (!REQUIRED_ARGUMENTS.includes(key)) throw new Error(`Unknown argument --${key}.`);
    if (hasOwn(values, key)) throw new Error(`Duplicate argument --${key}.`);
    values[key] = value.trim();
  }
  for (const key of REQUIRED_ARGUMENTS) if (!hasOwn(values, key)) throw new Error(`Missing --${key}.`);
  if (values.provider !== PROVIDER) throw new Error(`--provider must be ${PROVIDER}.`);
  let endpoint;
  try {
    endpoint = new URL(values["base-url"]);
  } catch {
    throw new Error("--base-url must be a valid HTTP(S) URL.");
  }
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error("--base-url must be a credential-free HTTP(S) URL.");
  }
  const project = resolveWorkspaceArgument(values.project, "project");
  const workflow = resolveWorkspaceArgument(values.workflow, "workflow");
  const output = resolveWorkspaceArgument(values.output, "output");
  if (output === project || output === workflow) throw new Error("Output must not target an input file.");
  return {
    project,
    character: values.character,
    provider: values.provider,
    baseUrl: endpoint.href.replace(/\/$/, ""),
    workflow,
    output
  };
}

export async function loadStyleMigrationSubject(projectPath, character, dependencies = {}) {
  const workspaceRoot = resolve(dependencies.workspaceRoot ?? process.cwd());
  const inputPath = resolveWorkspaceArgument(projectPath, "project", workspaceRoot);
  await assertExistingWorkspaceFile(inputPath, workspaceRoot, "Project", dependencies);
  const read = dependencies.readFile ?? readFile;
  const projectBytes = await read(inputPath);
  let document;
  try {
    document = JSON.parse(Buffer.from(projectBytes).toString("utf8"));
  } catch {
    throw new Error("Project JSON is malformed.");
  }
  const assets = Array.isArray(document?.snapshot?.assets) ? document.snapshot.assets : Array.isArray(document?.assets) ? document.assets : [];
  const matches = assets.filter((asset) => asset?.id === character);
  if (matches.length !== 1 || matches[0]?.type !== "character") throw new Error("Project must contain exactly one matching character asset.");
  const asset = matches[0];
  const identityPack = asset.characterIdentityPack;
  if (!isPlainObject(identityPack) || !nonEmptyString(identityPack.version) || !Array.isArray(identityPack.immutableTraits) || identityPack.immutableTraits.length === 0 || identityPack.immutableTraits.some((trait) => !nonEmptyString(trait))) {
    throw new Error("Character requires a complete versioned identity pack with immutable traits.");
  }
  const species = nonEmptyString(identityPack.species) ? identityPack.species.trim().toLowerCase() : "human";
  if (species !== "human" || (Array.isArray(identityPack.speciesTraits) && identityPack.speciesTraits.some(nonEmptyString))) {
    throw new Error("Style migration is human-only; Shen Yan metadata must resolve to human.");
  }
  const sourcePaths = {};
  const sourceBytes = {};
  const sourceFormats = {};
  for (const [slot, field] of Object.entries(IDENTITY_PATHS)) {
    const value = identityPack[field];
    if (!nonEmptyString(value)) throw new Error(`Identity pack is missing ${field}.`);
    const sourcePath = isAbsolute(value) ? resolve(value) : resolve(dirname(inputPath), value);
    await assertNoReparseComponents(sourcePath, dependencies);
    const stats = await (dependencies.lstat ?? lstat)(sourcePath);
    if (!stats.isFile()) throw new Error(`${field} must be a regular source image.`);
    const bytes = Buffer.from(await read(sourcePath));
    const format = imageMagic(bytes);
    if (!format) throw new Error(`${field} has malformed image magic.`);
    sourcePaths[slot] = sourcePath;
    sourceBytes[slot] = bytes;
    sourceFormats[slot] = format;
  }
  return {
    asset,
    characterAssetId: asset.id,
    identityPack,
    species,
    sourcePaths,
    sourceBytes,
    sourceFormats,
    projectPath: inputPath,
    projectBytes: Buffer.from(projectBytes)
  };
}

export function compileStyleMigrationWorkflow(template, tokens) {
  validateWorkflowTemplate(template);
  const supplied = isPlainObject(tokens) ? tokens : {};
  for (const token of WORKFLOW_TOKENS) if (!hasOwn(supplied, token)) {
    const encoded = JSON.stringify(template);
    if (encoded.includes(`{{${token}}}`)) throw new Error(`Missing workflow token ${token}.`);
  }
  const compiled = replaceWorkflowTokens(template, supplied);
  if (/\{\{[^{}]+\}\}/.test(JSON.stringify(compiled))) throw new Error("Compiled workflow contains unresolved tokens.");
  const activeReferenceProof = verifyCompiledCharacterReferenceBindings(compiled, [
    String(supplied.REFERENCE_IMAGE_A),
    String(supplied.REFERENCE_IMAGE_B)
  ]);
  if (!activeReferenceProof.valid) throw new Error("Workflow active reference binding proof failed.");
  return compiled;
}

function buildPassPrompt(subject, pass) {
  return [
    `Preserve immutable character traits exactly: ${subject.identityPack.immutableTraits.map((trait) => trait.trim()).join("; ")}.`,
    `Generate the exact ${pass.id} view of the same youthful adult human character.`,
    `${CINEMATIC_3D_DONGHUA_CONTRACT.id} ${CINEMATIC_3D_DONGHUA_CONTRACT.version}: ${CINEMATIC_3D_DONGHUA_CONTRACT.positivePrompt}.`,
    "Human-only anatomy constraint: human ears only, no animal ears, no tail, no horns, no animal muzzle.",
    "Return one clean model-generated character image; do not create a collage, character sheet, fallback cutout, or copied screenshot."
  ].join(" ");
}

function assertModelOutput(result) {
  if (!isPlainObject(result) || result.kind !== "model_generation" || result.fallback === true || result.isFallback === true) {
    throw new Error("Fallback output is forbidden; a proven model generation is required.");
  }
  const contentType = String(result.contentType ?? "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "image/png") throw new Error("Migration candidate output must be image/png.");
  const bytes = Buffer.from(result.bytes ?? []);
  if (bytes.length === 0 || bytes.length > MAX_OUTPUT_BYTES) throw new Error("Migration candidate output size is invalid.");
  assertPng(bytes, "Migration candidate output");
  return bytes;
}

function sanitizeComfyImageArtifact(image) {
  if (!isPlainObject(image) || !nonEmptyString(image.filename)) throw new Error("ComfyUI did not return a selected SaveImage artifact.");
  for (const value of [image.filename, image.subfolder ?? "", image.type ?? "output"]) {
    if (String(value).includes("..") || /[\\/]/.test(String(value)) && value === image.filename) throw new Error("ComfyUI returned an unsafe output artifact path.");
  }
  return { filename: image.filename, subfolder: String(image.subfolder ?? ""), type: String(image.type ?? "output") };
}

function createDefaultTransport(baseUrl, dependencies = {}) {
  const request = dependencies.fetch ?? globalThis.fetch;
  if (typeof request !== "function") throw new Error("A fetch implementation is required.");
  const endpoint = baseUrl.replace(/\/$/, "");
  const clientId = randomUUID();
  return {
    async uploadImage({ fileName, bytes, contentType = "image/png" }) {
      const form = new FormData();
      form.append("image", new Blob([bytes], { type: contentType }), fileName);
      form.append("type", "input");
      form.append("overwrite", "false");
      const response = await request(`${endpoint}/upload/image`, { method: "POST", body: form });
      if (!response.ok) throw new Error(`ComfyUI upload failed with HTTP ${response.status}.`);
      const body = await response.json();
      if (!nonEmptyString(body?.name) || String(body.name).includes("..") || /[\\/]/.test(body.name)) throw new Error("ComfyUI returned an unsafe upload name.");
      const subfolder = nonEmptyString(body.subfolder) ? `${String(body.subfolder).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")}/` : "";
      if (subfolder.includes("..")) throw new Error("ComfyUI returned an unsafe upload subfolder.");
      return `${subfolder}${body.name}`;
    },
    async queueWorkflow({ workflow, outputNodeId }) {
      const queued = await request(`${endpoint}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: workflow, client_id: clientId })
      });
      if (!queued.ok) throw new Error(`ComfyUI queue failed with HTTP ${queued.status}.`);
      const queuedBody = await queued.json();
      if (!nonEmptyString(queuedBody?.prompt_id)) throw new Error("ComfyUI queue response omitted prompt_id.");
      let historyEntry;
      for (let attempt = 0; attempt < 1200; attempt += 1) {
        const history = await request(`${endpoint}/history/${encodeURIComponent(queuedBody.prompt_id)}`);
        if (!history.ok) throw new Error(`ComfyUI history failed with HTTP ${history.status}.`);
        const body = await history.json();
        historyEntry = body?.[queuedBody.prompt_id];
        if (historyEntry) break;
        await new Promise((finish) => setTimeout(finish, 500));
      }
      if (!historyEntry) throw new Error("Timed out waiting for ComfyUI migration output.");
      if (historyEntry?.status?.status_str && historyEntry.status.status_str !== "success") throw new Error("ComfyUI migration execution failed.");
      const images = historyEntry?.outputs?.[outputNodeId]?.images;
      if (!Array.isArray(images) || images.length !== 1) throw new Error("Selected SaveImage terminal must produce exactly one output.");
      const artifact = sanitizeComfyImageArtifact(images[0]);
      const query = new URLSearchParams(artifact);
      const response = await request(`${endpoint}/view?${query.toString()}`);
      if (!response.ok) throw new Error(`ComfyUI output download failed with HTTP ${response.status}.`);
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(contentLength) && contentLength > MAX_OUTPUT_BYTES) throw new Error("ComfyUI output exceeds the 40 MiB limit.");
      return {
        kind: "model_generation",
        contentType: response.headers.get("content-type") ?? "",
        bytes: Buffer.from(await response.arrayBuffer()),
        artifact
      };
    }
  };
}

async function assertProjectUnchanged(subject, dependencies = {}) {
  const current = Buffer.from(await (dependencies.readFile ?? readFile)(subject.projectPath));
  if (!current.equals(subject.projectBytes)) throw new Error("Project JSON was mutated during migration; manifest publication is blocked.");
}

export async function writeMigrationManifestExclusive(outputDirectory, manifest, dependencies = {}) {
  if (!isPlainObject(manifest) || manifest.status !== "awaiting_operator_approval") {
    throw new Error("Migration manifest status must be awaiting_operator_approval.");
  }
  const workspaceRoot = resolve(dependencies.workspaceRoot ?? process.cwd());
  const safeOutputDirectory = resolveWorkspaceArgument(outputDirectory, "output", workspaceRoot);
  await assertNoReparseComponents(safeOutputDirectory, dependencies);
  const stats = await (dependencies.lstat ?? lstat)(safeOutputDirectory);
  if (!stats.isDirectory()) throw new Error("Migration output directory must exist.");
  const target = join(safeOutputDirectory, MANIFEST_NAME);
  try {
    await (dependencies.writeFile ?? writeFile)(target, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Migration manifest already exists; exclusive publication refused.");
    throw error;
  }
  return target;
}

export async function runCharacterStyleMigration(options, dependencies = {}) {
  if (!isPlainObject(options)) throw new Error("Migration options are required.");
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const projectPath = resolveWorkspaceArgument(options.project, "project", workspaceRoot);
  const workflowPath = resolveWorkspaceArgument(options.workflow, "workflow", workspaceRoot);
  const outputDirectory = resolveWorkspaceArgument(options.output, "output", workspaceRoot);
  if (options.provider !== PROVIDER) throw new Error(`Migration provider must be ${PROVIDER}.`);
  if (!nonEmptyString(options.character)) throw new Error("Migration character is required.");
  if (outputDirectory === projectPath || outputDirectory === workflowPath) throw new Error("Output must not target an input file.");
  let parsedEndpoint;
  try { parsedEndpoint = new URL(options.baseUrl); } catch { throw new Error("Migration base URL must be valid."); }
  if (!["http:", "https:"].includes(parsedEndpoint.protocol) || parsedEndpoint.username || parsedEndpoint.password || parsedEndpoint.hash) {
    throw new Error("Migration base URL must be a credential-free HTTP(S) URL.");
  }

  await assertExistingWorkspaceFile(projectPath, workspaceRoot, "Project", dependencies);
  await assertExistingWorkspaceFile(workflowPath, workspaceRoot, "Workflow", dependencies);
  await assertNoReparseComponents(dirname(outputDirectory), dependencies);
  const subject = await loadStyleMigrationSubject(projectPath, options.character, { ...dependencies, workspaceRoot });
  const workflowBytes = Buffer.from(await (dependencies.readFile ?? readFile)(workflowPath));
  let template;
  try { template = JSON.parse(workflowBytes.toString("utf8")); } catch { throw new Error("Workflow JSON is malformed."); }
  const { outputNodeId } = validateWorkflowTemplate(template);
  compileStyleMigrationWorkflow(template, {
    REFERENCE_IMAGE_A: "preflight-a.png",
    REFERENCE_IMAGE_B: "preflight-b.png",
    PROMPT: "preflight",
    VIEW: "front",
    STYLE_CONTRACT_ID: CINEMATIC_3D_DONGHUA_CONTRACT.id,
    STYLE_CONTRACT_VERSION: CINEMATIC_3D_DONGHUA_CONTRACT.version,
    CHARACTER_ASSET_ID: subject.characterAssetId,
    SEED: PASSES[0].seed
  });

  try {
    await (dependencies.mkdir ?? mkdir)(outputDirectory, { recursive: false });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Migration output already exists; exclusive creation refused.");
    throw error;
  }

  const temporaryRoot = await (dependencies.mkdtemp ?? mkdtemp)(join(dependencies.tmpdir?.() ?? tmpdir(), "character-style-migration-"));
  const transport = dependencies.transport ?? createDefaultTransport(parsedEndpoint.href, dependencies);
  const candidates = [];
  try {
    for (const pass of PASSES) {
      const uploaded = [];
      const sourceDigests = [];
      for (let index = 0; index < pass.sourceSlots.length; index += 1) {
        const slot = pass.sourceSlots[index];
        const originalBytes = subject.sourceBytes[slot];
        const sourceFormat = subject.sourceFormats[slot];
        const extension = sourceFormat === "jpeg" ? "jpg" : sourceFormat;
        const contentType = sourceFormat === "jpeg" ? "image/jpeg" : `image/${sourceFormat}`;
        const stagedPath = join(temporaryRoot, `${pass.id}-${index + 1}.${extension}`);
        await assertNoReparseComponents(subject.sourcePaths[slot], dependencies);
        await (dependencies.copyFile ?? copyFile)(subject.sourcePaths[slot], stagedPath, fsConstants.COPYFILE_EXCL);
        const stagedBytes = Buffer.from(await (dependencies.readFile ?? readFile)(stagedPath));
        if (!stagedBytes.equals(originalBytes)) throw new Error(`Source image changed while staging ${slot}.`);
        const digest = sha256(stagedBytes);
        sourceDigests.push(digest);
        const remoteName = await transport.uploadImage({
          sourcePath: subject.sourcePaths[slot],
          stagedPath,
          fileName: `${pass.id}-${index + 1}-${digest.slice(0, 12)}.${extension}`,
          bytes: stagedBytes,
          contentType,
          pass,
          slot
        });
        if (!nonEmptyString(remoteName) || String(remoteName).includes("..")) throw new Error("Transport returned an unsafe uploaded reference name.");
        uploaded.push(remoteName);
      }
      const prompt = buildPassPrompt(subject, pass);
      const compiled = compileStyleMigrationWorkflow(template, {
        REFERENCE_IMAGE_A: uploaded[0],
        REFERENCE_IMAGE_B: uploaded[1],
        PROMPT: prompt,
        VIEW: pass.id,
        STYLE_CONTRACT_ID: CINEMATIC_3D_DONGHUA_CONTRACT.id,
        STYLE_CONTRACT_VERSION: CINEMATIC_3D_DONGHUA_CONTRACT.version,
        CHARACTER_ASSET_ID: subject.characterAssetId,
        SEED: pass.seed
      });
      const result = await transport.queueWorkflow({ workflow: compiled, outputNodeId, pass });
      await assertProjectUnchanged(subject, dependencies);
      const outputBytes = assertModelOutput(result);
      const outputName = `${pass.id}.png`;
      await assertNoReparseComponents(outputDirectory, dependencies);
      const outputStats = await (dependencies.lstat ?? lstat)(outputDirectory);
      if (!outputStats.isDirectory()) throw new Error("Migration output directory is no longer a regular directory.");
      await (dependencies.writeFile ?? writeFile)(join(outputDirectory, outputName), outputBytes, { flag: "wx" });
      candidates.push({
        view: pass.id,
        sourceSha256: sha256(sourceDigests.join(":")),
        sourceReferences: pass.sourceSlots.map((slot, index) => ({ slot, sha256: sourceDigests[index] })),
        outputSha256: sha256(outputBytes),
        outputPath: outputName,
        seed: pass.seed
      });
    }
    await assertProjectUnchanged(subject, dependencies);
    const manifest = {
      schemaVersion: 1,
      status: "awaiting_operator_approval",
      characterAssetId: subject.characterAssetId,
      sourceIdentityPackVersion: subject.identityPack.version,
      proposedIdentityPackVersion: `${subject.identityPack.version}-cinematic3d-v1`,
      styleContract: {
        id: CINEMATIC_3D_DONGHUA_CONTRACT.id,
        version: CINEMATIC_3D_DONGHUA_CONTRACT.version,
        digest: computeCharacterStyleContractDigest(CINEMATIC_3D_DONGHUA_CONTRACT)
      },
      species: "human",
      provider: PROVIDER,
      modelName: MODEL_NAME,
      workflowDigest: sha256(workflowBytes),
      candidates
    };
    await writeMigrationManifestExclusive(outputDirectory, manifest, { ...dependencies, workspaceRoot });
    return manifest;
  } finally {
    const ownedRoot = resolve(temporaryRoot);
    const systemTemp = resolve(dependencies.tmpdir?.() ?? tmpdir());
    if (!isPathInside(systemTemp, ownedRoot) || basename(ownedRoot).length <= "character-style-migration-".length || !basename(ownedRoot).startsWith("character-style-migration-")) {
      throw new Error("Refused to clean an unowned migration temporary directory.");
    }
    await (dependencies.rm ?? rm)(ownedRoot, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseStyleMigrationArgs(process.argv.slice(2));
  const manifest = await runCharacterStyleMigration(options);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`Character style migration failed: ${error?.message ?? "unknown error"}\n`);
    process.exitCode = 1;
  });
}
