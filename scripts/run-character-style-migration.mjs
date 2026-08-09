import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rmdir,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  CINEMATIC_3D_DONGHUA_CONTRACT,
  computeCharacterStyleContractDigest
} from "../src/modules/comfy-pipeline/characterStyleContractRuntime.mjs";

const PROVIDER = "flux2_klein_4b";
const MODEL_NAME = "flux-2-klein-4b-fp8.safetensors";
const MANIFEST_NAME = "migration-manifest.json";
const MAX_OUTPUT_BYTES = 40 * 1024 * 1024;
const REQUIRED_ARGUMENTS = Object.freeze(["project", "character", "provider", "base-url", "workflow", "output"]);
const OPTIONAL_ARGUMENTS = Object.freeze(["revision"]);
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

const NODE_SCHEMAS = Object.freeze({
  LoadImage: Object.freeze({ inputs: Object.freeze({}), outputs: Object.freeze(["IMAGE", "MASK"]) }),
  UNETLoader: Object.freeze({ inputs: Object.freeze({}), outputs: Object.freeze(["MODEL"]) }),
  CLIPLoader: Object.freeze({ inputs: Object.freeze({}), outputs: Object.freeze(["CLIP"]) }),
  VAELoader: Object.freeze({ inputs: Object.freeze({}), outputs: Object.freeze(["VAE"]) }),
  ImageScaleToTotalPixels: Object.freeze({ inputs: Object.freeze({ image: "IMAGE" }), outputs: Object.freeze(["IMAGE"]) }),
  GetImageSize: Object.freeze({ inputs: Object.freeze({ image: "IMAGE" }), outputs: Object.freeze(["INT", "INT"]) }),
  CLIPTextEncode: Object.freeze({ inputs: Object.freeze({ clip: "CLIP" }), outputs: Object.freeze(["CONDITIONING"]) }),
  ConditioningZeroOut: Object.freeze({ inputs: Object.freeze({ conditioning: "CONDITIONING" }), outputs: Object.freeze(["CONDITIONING"]) }),
  VAEEncode: Object.freeze({ inputs: Object.freeze({ pixels: "IMAGE", vae: "VAE" }), outputs: Object.freeze(["LATENT"]) }),
  ReferenceLatent: Object.freeze({ inputs: Object.freeze({ conditioning: "CONDITIONING", latent: "LATENT" }), outputs: Object.freeze(["CONDITIONING"]) }),
  EmptyFlux2LatentImage: Object.freeze({ inputs: Object.freeze({ width: "INT", height: "INT" }), outputs: Object.freeze(["LATENT"]) }),
  RandomNoise: Object.freeze({ inputs: Object.freeze({}), outputs: Object.freeze(["NOISE"]) }),
  CFGGuider: Object.freeze({ inputs: Object.freeze({ model: "MODEL", positive: "CONDITIONING", negative: "CONDITIONING" }), outputs: Object.freeze(["GUIDER"]) }),
  KSamplerSelect: Object.freeze({ inputs: Object.freeze({}), outputs: Object.freeze(["SAMPLER"]) }),
  Flux2Scheduler: Object.freeze({ inputs: Object.freeze({ width: "INT", height: "INT" }), outputs: Object.freeze(["SIGMAS"]) }),
  SamplerCustomAdvanced: Object.freeze({ inputs: Object.freeze({ noise: "NOISE", guider: "GUIDER", sampler: "SAMPLER", sigmas: "SIGMAS", latent_image: "LATENT" }), outputs: Object.freeze(["LATENT"]) }),
  VAEDecode: Object.freeze({ inputs: Object.freeze({ samples: "LATENT", vae: "VAE" }), outputs: Object.freeze(["IMAGE"]) }),
  SaveImage: Object.freeze({ inputs: Object.freeze({ images: "IMAGE" }), outputs: Object.freeze([]) })
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

function statIdentity(stats) {
  return `${String(stats?.dev)}:${String(stats?.ino)}:${String(stats?.birthtimeMs)}`;
}

async function createOutputDirectoryGuard(outputDirectory, workspaceRoot, dependencies = {}) {
  const safeOutputDirectory = resolveWorkspaceArgument(outputDirectory, "output", workspaceRoot);
  const statPath = dependencies.lstat ?? lstat;
  const canonicalize = dependencies.realpath ?? realpath;
  const read = dependencies.readFile ?? readFile;
  const write = dependencies.writeFile ?? writeFile;
  const removeFile = dependencies.unlink ?? unlink;
  const canonicalRoot = await canonicalize(workspaceRoot);
  await assertNoReparseComponents(safeOutputDirectory, dependencies);
  const initialStats = await statPath(safeOutputDirectory);
  if (!initialStats.isDirectory() || initialStats.isSymbolicLink()) throw new Error("Migration output directory must be a regular directory.");
  const canonicalOutput = await canonicalize(safeOutputDirectory);
  if (!isPathInside(canonicalRoot, canonicalOutput)) throw new Error("Migration output directory escaped the workspace.");
  const identity = statIdentity(initialStats);
  const nonce = randomUUID();
  const sentinelBytes = Buffer.from(`character-style-migration:${nonce}\n`, "utf8");
  const sentinelPath = join(safeOutputDirectory, `.migration-run-${nonce}.sentinel`);
  let sentinelCreated = false;

  const verifyDirectoryIdentity = async () => {
    await assertNoReparseComponents(safeOutputDirectory, dependencies);
    const currentStats = await statPath(safeOutputDirectory);
    if (!currentStats.isDirectory() || currentStats.isSymbolicLink()) throw new Error("Migration output directory reparse replacement detected.");
    const currentCanonical = await canonicalize(safeOutputDirectory);
    if (currentCanonical !== canonicalOutput || !isPathInside(canonicalRoot, currentCanonical) || statIdentity(currentStats) !== identity) {
      throw new Error("Migration output directory identity or workspace containment changed.");
    }
    return currentCanonical;
  };

  const verify = async () => {
    const currentCanonical = await verifyDirectoryIdentity();
    await assertNoReparseComponents(sentinelPath, dependencies);
    const sentinelStats = await statPath(sentinelPath);
    if (!sentinelStats.isFile() || sentinelStats.isSymbolicLink()) throw new Error("Migration output sentinel identity changed.");
    const canonicalSentinel = await canonicalize(sentinelPath);
    if (dirname(canonicalSentinel) !== currentCanonical || !isPathInside(canonicalRoot, canonicalSentinel)) {
      throw new Error("Migration output sentinel escaped its run-owned directory.");
    }
    const currentSentinel = Buffer.from(await read(sentinelPath));
    if (!currentSentinel.equals(sentinelBytes)) throw new Error("Migration output sentinel nonce mismatch.");
  };

  const cleanupOwnedFile = async (target, expectedBytes) => {
    try {
      const stats = await statPath(target);
      if (!stats.isFile() || stats.isSymbolicLink()) return false;
      const current = Buffer.from(await read(target));
      if (!current.equals(expectedBytes)) return false;
      await removeFile(target);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return true;
      return false;
    }
  };

  try {
    await verifyDirectoryIdentity();
    await write(sentinelPath, sentinelBytes, { flag: "wx" });
    sentinelCreated = true;
    await verify();
  } catch (error) {
    if (sentinelCreated) await cleanupOwnedFile(sentinelPath, sentinelBytes);
    throw error;
  }

  return {
    outputDirectory: safeOutputDirectory,
    async verify() { await verify(); },
    async writeOwnedExclusive(fileName, bytes) {
      if (!/^[A-Za-z0-9._-]+$/.test(fileName) || fileName.startsWith(".")) throw new Error("Unsafe migration output filename.");
      const payload = Buffer.from(bytes);
      const target = join(safeOutputDirectory, fileName);
      let created = false;
      try {
        await verify();
        await write(target, payload, { flag: "wx" });
        created = true;
        await verify();
        await assertNoReparseComponents(target, dependencies);
        const canonicalTarget = await canonicalize(target);
        if (dirname(canonicalTarget) !== canonicalOutput || !isPathInside(canonicalRoot, canonicalTarget)) {
          throw new Error("Migration output file escaped the guarded directory.");
        }
        const targetStats = await statPath(target);
        if (!targetStats.isFile() || targetStats.isSymbolicLink() || !Buffer.from(await read(target)).equals(payload)) {
          throw new Error("Migration output file identity changed after exclusive write.");
        }
        return target;
      } catch (error) {
        if (created) {
          const cleaned = await cleanupOwnedFile(target, payload);
          if (!cleaned) throw new Error(`Migration output directory changed and run-owned file cleanup failed: ${error?.message ?? "unknown error"}`);
        }
        throw error;
      }
    },
    async removeSentinel() {
      if (!sentinelCreated) return;
      await verify();
      const removed = await cleanupOwnedFile(sentinelPath, sentinelBytes);
      if (!removed) throw new Error("Failed to remove the run-owned migration sentinel safely.");
      sentinelCreated = false;
      await verifyDirectoryIdentity();
    },
    async cleanupSentinel() {
      if (!sentinelCreated) return;
      const removed = await cleanupOwnedFile(sentinelPath, sentinelBytes);
      if (removed) sentinelCreated = false;
    }
  };
}

async function createTemporaryDirectoryGuard(dependencies = {}) {
  const systemTemp = resolve(dependencies.tmpdir?.() ?? tmpdir());
  const createTemp = dependencies.mkdtemp ?? mkdtemp;
  const statPath = dependencies.lstat ?? lstat;
  const canonicalize = dependencies.realpath ?? realpath;
  const read = dependencies.readFile ?? readFile;
  const write = dependencies.writeFile ?? writeFile;
  const removeFile = dependencies.unlink ?? unlink;
  const removeDirectory = dependencies.rmdir ?? rmdir;
  const listDirectory = dependencies.readdir ?? readdir;
  const directory = resolve(await createTemp(join(systemTemp, "character-style-migration-")));
  if (!isPathInside(systemTemp, directory) || basename(directory).length <= "character-style-migration-".length || !basename(directory).startsWith("character-style-migration-")) {
    throw new Error("Temporary directory provider returned an unowned path.");
  }
  const canonicalSystemTemp = await canonicalize(systemTemp);
  await assertNoReparseComponents(directory, dependencies);
  const initialStats = await statPath(directory);
  if (!initialStats.isDirectory() || initialStats.isSymbolicLink()) throw new Error("Run-owned temporary path is not a regular directory.");
  const canonicalDirectory = await canonicalize(directory);
  if (!isPathInside(canonicalSystemTemp, canonicalDirectory)) throw new Error("Run-owned temporary directory escaped the system temp root.");
  const identity = statIdentity(initialStats);
  const nonce = randomUUID();
  const sentinelBytes = Buffer.from(`character-style-migration-temp:${nonce}\n`, "utf8");
  const sentinelPath = join(directory, `.migration-temp-${nonce}.sentinel`);
  let sentinelMayExist = false;
  let cleaned = false;
  const ownedFiles = new Map();

  const verifyDirectoryIdentity = async () => {
    await assertNoReparseComponents(directory, dependencies);
    const currentStats = await statPath(directory);
    if (!currentStats.isDirectory() || currentStats.isSymbolicLink()) throw new Error("Run-owned temp directory replacement detected.");
    const currentCanonical = await canonicalize(directory);
    if (currentCanonical !== canonicalDirectory || !isPathInside(canonicalSystemTemp, currentCanonical) || statIdentity(currentStats) !== identity) {
      throw new Error("Run-owned temp directory identity changed; replacement cleanup refused.");
    }
  };

  const verifyOwnedFile = async (target, expectedBytes) => {
    await verifyDirectoryIdentity();
    await assertNoReparseComponents(target, dependencies);
    const stats = await statPath(target);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("Run-owned temporary file identity changed.");
    const canonicalTarget = await canonicalize(target);
    if (dirname(canonicalTarget) !== canonicalDirectory || !isPathInside(canonicalSystemTemp, canonicalTarget)) {
      throw new Error("Run-owned temporary file escaped its guarded directory.");
    }
    if (!Buffer.from(await read(target)).equals(expectedBytes)) throw new Error("Run-owned temporary file bytes changed.");
  };

  const removeExactOwnedFile = async (target, expectedBytes) => {
    try {
      await verifyOwnedFile(target, expectedBytes);
      await removeFile(target);
      await verifyDirectoryIdentity();
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  };

  const cleanup = async () => {
    if (cleaned) return;
    await verifyDirectoryIdentity();
    for (const [target, bytes] of ownedFiles) await removeExactOwnedFile(target, bytes);
    ownedFiles.clear();
    if (sentinelMayExist) {
      await removeExactOwnedFile(sentinelPath, sentinelBytes);
      sentinelMayExist = false;
    }
    await verifyDirectoryIdentity();
    if ((await listDirectory(directory)).length !== 0) throw new Error("Run-owned temporary directory contains an untracked file; cleanup refused.");
    await verifyDirectoryIdentity();
    await removeDirectory(directory);
    cleaned = true;
  };

  try {
    await verifyDirectoryIdentity();
    await write(sentinelPath, sentinelBytes, { flag: "wx" });
    sentinelMayExist = true;
    await verifyOwnedFile(sentinelPath, sentinelBytes);
  } catch (error) {
    try { await cleanup(); } catch (cleanupError) { throw cleanupError; }
    throw error;
  }

  return {
    directory,
    async writeOwnedExclusive(fileName, bytes) {
      if (!/^[A-Za-z0-9._-]+$/.test(fileName) || fileName.startsWith(".")) throw new Error("Unsafe run-owned temporary filename.");
      const payload = Buffer.from(bytes);
      const target = join(directory, fileName);
      await verifyDirectoryIdentity();
      try {
        await write(target, payload, { flag: "wx" });
        ownedFiles.set(target, payload);
        await verifyOwnedFile(target, payload);
        return target;
      } catch (error) {
        throw error;
      }
    },
    async cleanup() { await cleanup(); }
  };
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

function buildTypedWorkflowGraph(entries) {
  const nodes = new Map(entries.map(([id, node]) => [String(id), node]));
  const edges = new Map([...nodes.keys()].map((id) => [id, new Set()]));
  const inputSources = new Map([...nodes.keys()].map((id) => [id, new Map()]));
  for (const [targetId, node] of entries) {
    const schema = NODE_SCHEMAS[node?.class_type];
    if (!schema) throw new Error(`Unsupported workflow class_type schema: ${String(node?.class_type)}.`);
    for (const [inputName, value] of Object.entries(node?.inputs ?? {})) {
      if (!Array.isArray(value)) continue;
      const expectedType = schema.inputs[inputName];
      if (!expectedType) throw new Error(`Workflow schema rejects linked input ${node.class_type}.${inputName}.`);
      if (value.length !== 2 || !Number.isInteger(value[1]) || !nodes.has(String(value[0]))) {
        throw new Error(`Workflow schema rejects malformed link ${node.class_type}.${inputName}.`);
      }
      const sourceId = String(value[0]);
      const sourceSchema = NODE_SCHEMAS[nodes.get(sourceId)?.class_type];
      const outputType = sourceSchema?.outputs?.[value[1]];
      if (outputType !== expectedType) {
        throw new Error(`Workflow schema type mismatch for ${node.class_type}.${inputName}; expected ${expectedType}.`);
      }
      edges.get(sourceId).add(String(targetId));
      inputSources.get(String(targetId)).set(inputName, sourceId);
    }
  }
  return { nodes, edges, inputSources };
}

function proveSelectedOutputGraph(entries, loaders, modelNodeId, outputNodeId, tokenEncoderId) {
  const graph = buildTypedWorkflowGraph(entries);
  const reachesSelectedOutput = (startId, requiredType) => {
    const pending = [[String(startId), false]];
    const seen = new Set();
    while (pending.length) {
      const [current, priorMatch] = pending.pop();
      const matched = priorMatch || !requiredType || graph.nodes.get(current)?.class_type === requiredType;
      const state = `${current}:${matched}`;
      if (seen.has(state)) continue;
      seen.add(state);
      if (current === String(outputNodeId) && matched) return true;
      for (const next of graph.edges.get(current) ?? []) pending.push([next, matched]);
    }
    return false;
  };
  const reachable = (startId, targetId) => {
    const pending = [String(startId)];
    const seen = new Set();
    while (pending.length) {
      const current = pending.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      if (current === String(targetId)) return true;
      for (const next of graph.edges.get(current) ?? []) pending.push(next);
    }
    return false;
  };
  const reachesTargetThroughType = (startId, targetId, requiredType) => {
    const pending = [[String(startId), false]];
    const seen = new Set();
    while (pending.length) {
      const [current, priorMatch] = pending.pop();
      const matched = priorMatch || graph.nodes.get(current)?.class_type === requiredType;
      const state = `${current}:${matched}`;
      if (seen.has(state)) continue;
      seen.add(state);
      if (current === String(targetId) && matched) return true;
      for (const next of graph.edges.get(current) ?? []) pending.push([next, matched]);
    }
    return false;
  };
  if (loaders.some(([id]) => !reachesSelectedOutput(id, "ReferenceLatent"))) {
    throw new Error("Active reference binding failed: every loader must reach the selected SaveImage through a character reference sink.");
  }
  if (!reachesSelectedOutput(modelNodeId)) throw new Error("The authoritative Klein model must reach the selected SaveImage terminal.");
  if (!reachesSelectedOutput(tokenEncoderId)) throw new Error("Active CLIPTextEncode conditioning tokens must reach the selected SaveImage generation chain.");
  const activeGuiders = entries.filter(([id, node]) => node?.class_type === "CFGGuider" && reachesSelectedOutput(id));
  if (activeGuiders.length !== 1) throw new Error("Workflow must have exactly one active CFGGuider reaching the selected SaveImage.");
  const guiderSources = graph.inputSources.get(String(activeGuiders[0][0]));
  const positiveSource = guiderSources.get("positive");
  if (!positiveSource) throw new Error("CFGGuider positive conditioning must be an authoritative typed link.");
  let conditioningCursor = positiveSource;
  const conditioningSeen = new Set();
  const positiveReferenceNodes = new Set();
  while (conditioningCursor !== String(tokenEncoderId)) {
    if (conditioningSeen.has(conditioningCursor)) throw new Error("Authoritative positive conditioning contains a cycle.");
    conditioningSeen.add(conditioningCursor);
    const nodeType = graph.nodes.get(conditioningCursor)?.class_type;
    if (nodeType === "ConditioningZeroOut") throw new Error("Authoritative positive conditioning must not pass through ConditioningZeroOut.");
    if (nodeType !== "ReferenceLatent") throw new Error("Authoritative positive conditioning may only preserve canonical tokens through ReferenceLatent nodes.");
    positiveReferenceNodes.add(conditioningCursor);
    const priorConditioning = graph.inputSources.get(conditioningCursor)?.get("conditioning");
    if (!priorConditioning) throw new Error("Authoritative positive conditioning chain is incomplete.");
    conditioningCursor = priorConditioning;
  }
  if (!reachable(tokenEncoderId, positiveSource)) throw new Error("Canonical token encoder must dominate authoritative positive conditioning.");
  const contributesIdentityPixels = (loaderId, referenceNodeId) => {
    const latentSource = graph.inputSources.get(referenceNodeId)?.get("latent");
    if (!latentSource || graph.nodes.get(latentSource)?.class_type !== "VAEEncode") return false;
    let pixelCursor = graph.inputSources.get(latentSource)?.get("pixels");
    const pixelSeen = new Set();
    while (pixelCursor && pixelCursor !== String(loaderId)) {
      if (pixelSeen.has(pixelCursor)) return false;
      pixelSeen.add(pixelCursor);
      if (graph.nodes.get(pixelCursor)?.class_type !== "ImageScaleToTotalPixels") return false;
      pixelCursor = graph.inputSources.get(pixelCursor)?.get("image");
    }
    return pixelCursor === String(loaderId);
  };
  for (const [loaderId] of loaders) {
    const validPixelReference = [...positiveReferenceNodes].some((referenceNodeId) => contributesIdentityPixels(loaderId, referenceNodeId));
    if (!validPixelReference || !reachesTargetThroughType(loaderId, positiveSource, "ReferenceLatent")) {
      throw new Error("Both distinct identity LoadImage pixel chains must enter VAEEncode.pixels and a ReferenceLatent on the authoritative positive conditioning source.");
    }
  }
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
  const requiredConditioningTokens = ["PROMPT", "VIEW", "STYLE_CONTRACT_ID", "STYLE_CONTRACT_VERSION", "CHARACTER_ASSET_ID"];
  const tokenEncoders = entries.filter(([, node]) => node?.class_type === "CLIPTextEncode" && requiredConditioningTokens.every((token) => String(node?.inputs?.text ?? "").includes(`{{${token}}}`)));
  if (tokenEncoders.length !== 1) {
    throw new Error("Exactly one active CLIPTextEncode must contain every required conditioning token.");
  }
  proveSelectedOutputGraph(entries, loaders, models[0][0], outputs[0][0], tokenEncoders[0][0]);
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
    if (![...REQUIRED_ARGUMENTS, ...OPTIONAL_ARGUMENTS].includes(key)) throw new Error(`Unknown argument --${key}.`);
    if (hasOwn(values, key)) throw new Error(`Duplicate argument --${key}.`);
    values[key] = value.trim();
  }
  for (const key of REQUIRED_ARGUMENTS) if (!hasOwn(values, key)) throw new Error(`Missing --${key}.`);
  const revision = hasOwn(values, "revision") ? Number(values.revision) : 1;
  if (!Number.isSafeInteger(revision) || revision < 1 || String(revision) !== String(values.revision ?? "1")) {
    throw new Error("--revision must be a positive integer.");
  }
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
    output,
    revision
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
  if (species !== "human") {
    throw new Error("Style migration is human-only; Shen Yan metadata must resolve to human.");
  }
  if (hasOwn(identityPack, "speciesTraits") && (!Array.isArray(identityPack.speciesTraits) || identityPack.speciesTraits.length !== 0)) {
    throw new Error("Human speciesTraits must be an empty array when present; legacy omission is the only compatibility case.");
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
  return compiled;
}

function normalizeTraitText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

const JUVENILE_AGE_TRAIT_PATTERN = /\b(?:child(?:like|ish)?|children|kid(?:s|like)?|baby|babies|toddler(?:s)?|juvenile|youthful|teen(?:ager|aged|s)?|adolescent(?:s)?)\b/i;

function extractKnownIdentityFacts(source) {
  const facts = [];
  const add = (fact) => { if (!facts.includes(fact)) facts.push(fact); };
  const eyeColor = source.match(/\b(blue|green|brown|gray|grey|amber|hazel)\s*(?:-eyed\b|eyes?\b)/i)?.[1]?.toLowerCase();
  if (eyeColor) add(/\b(?:large|oversized|big|huge|enlarged)\b.*\beyes?\b/i.test(source)
    ? `natural-sized ${eyeColor === "grey" ? "gray" : eyeColor} eyes`
    : `${eyeColor === "grey" ? "gray" : eyeColor} eyes`);
  if (/\bshort\s+dark[- ]brown\s+side[- ]swept\s+hair\b/i.test(source)) add("short dark brown side-swept hair");
  if (/\bteal(?:\s+long-sleeve)?\s+tunic\b/i.test(source)) add(/\blong-sleeve\b/i.test(source) ? "teal long-sleeve tunic" : "teal tunic");
  if (/\b(?:dark\s+)?navy(?:\s+sleeveless)?\s+long\s+coat\b/i.test(source)) {
    add(/\bdark\s+navy\s+sleeveless\b/i.test(source) ? "dark navy sleeveless long coat" : "navy long coat");
  }
  if (/\bbrown belt\b/i.test(source)) add("brown belt");
  if (/\b(?:knee-high\s+)?brown boots\b/i.test(source)) add(/\bknee-high\b/i.test(source) ? "knee-high brown boots" : "brown boots");
  return facts;
}

export function classifyMigrationTrait(value, kind = "immutable") {
  const source = normalizeTraitText(value);
  if (!source) throw new Error("Migration traits must be non-empty strings.");
  if (!["immutable", "forbidden"].includes(kind)) throw new Error("Migration trait kind must be immutable or forbidden.");
  const normalized = source.toLowerCase();

  if (kind === "immutable") {
    if (/^(?:large|oversized|big|huge|enlarged)\s+blue eyes$/i.test(source)) return {
      action: "rewrite", source, canonicalFacts: ["natural-sized blue eyes"], reason: "preserve_eye_color_without_juvenile_scale"
    };
    if (normalized === "clean youthful animated male face") return {
      action: "rewrite", source, canonicalFacts: ["established adult male identity"], reason: "remove_juvenile_style_coupling"
    };
    if (JUVENILE_AGE_TRAIT_PATTERN.test(source) || /\b(chibi|pixar|disney|toy-like|clean 2d|flat 2d|large|oversized|big|huge|enlarged)\b/i.test(source)) {
      const canonicalFacts = extractKnownIdentityFacts(source);
      if (/\bface\b/i.test(source)) canonicalFacts.push("established adult face identity");
      if (canonicalFacts.length > 0) return {
        action: "rewrite", source, canonicalFacts, reason: "extract_identity_facts_remove_age_or_style_coupling"
      };
      return { action: "exclude", source, canonicalFacts: [], reason: "exclude_age_or_style_coupled_trait" };
    }
    return { action: "preserve", source, canonicalFacts: [source], reason: "identity_fact" };
  }

  if (/\bage\b.*\bbody proportions\b|\bbody proportions\b.*\bage\b/i.test(source)) return {
    action: "exclude", source, canonicalFacts: [], reason: "exclude_age_and_proportion_lock"
  };
  if (/\b(2d|photoreal|pixar|disney|western cartoon|toy-like|chibi)\b/i.test(source)) return {
    action: "exclude", source, canonicalFacts: [], reason: "exclude_source_rendering_lock"
  };
  if (JUVENILE_AGE_TRAIT_PATTERN.test(source)) {
    const canonicalFacts = extractKnownIdentityFacts(source);
    if (/\bface\b/i.test(source)) canonicalFacts.push("established adult face identity");
    if (canonicalFacts.length > 0) return {
      action: "rewrite", source, canonicalFacts, reason: "extract_identity_facts_remove_age_or_style_coupling"
    };
    return { action: "exclude", source, canonicalFacts: [], reason: "exclude_age_or_style_coupled_constraint" };
  }
  const preservationRewrites = Object.freeze({
    "do not change face shape or blue eye color": "preserve established face shape and blue eye color",
    "do not change hair color, length, fringe, or silhouette": "preserve hair color, length, fringe, and silhouette",
    "do not change the teal tunic, navy long coat, brown belt, or brown boots": "preserve the teal tunic, navy long coat, brown belt, and brown boots"
  });
  if (hasOwn(preservationRewrites, normalized)) return {
    action: "rewrite", source, canonicalFacts: [preservationRewrites[normalized]], reason: "identity_preservation_constraint"
  };
  const canonical = source.replace(/^do not change\s+/i, "preserve ");
  return { action: canonical === source ? "preserve" : "rewrite", source, canonicalFacts: [canonical], reason: "identity_preservation_constraint" };
}

export function sanitizeMigrationTraits(identityPack) {
  if (!isPlainObject(identityPack) || !Array.isArray(identityPack.immutableTraits) || identityPack.immutableTraits.length === 0) {
    throw new Error("Migration requires immutableTraits.");
  }
  if (hasOwn(identityPack, "forbiddenChanges") && !Array.isArray(identityPack.forbiddenChanges)) {
    throw new Error("Migration forbiddenChanges must be an array when present.");
  }
  const immutable = identityPack.immutableTraits.map((trait) => classifyMigrationTrait(trait, "immutable"));
  const forbidden = (identityPack.forbiddenChanges ?? []).map((trait) => classifyMigrationTrait(trait, "forbidden"));
  const traitDecisions = Object.freeze([
    ...immutable.map((entry) => Object.freeze({ kind: "immutable", ...entry, canonicalFacts: Object.freeze([...entry.canonicalFacts]) })),
    ...forbidden.map((entry) => Object.freeze({ kind: "forbidden", ...entry, canonicalFacts: Object.freeze([...entry.canonicalFacts]) }))
  ]);
  return Object.freeze({
    identityTraits: Object.freeze(traitDecisions.filter(({ kind }) => kind === "immutable").flatMap(({ canonicalFacts }) => canonicalFacts)),
    preservationConstraints: Object.freeze(traitDecisions.filter(({ kind }) => kind === "forbidden").flatMap(({ canonicalFacts }) => canonicalFacts)),
    excludedSourceTraits: Object.freeze(traitDecisions.filter(({ action }) => action === "exclude")),
    traitDecisions
  });
}

export function buildMigrationIdentityDescriptor(subject) {
  if (!isPlainObject(subject) || subject.species !== "human") throw new Error("Migration identity descriptor is human-only.");
  const sanitized = sanitizeMigrationTraits(subject.identityPack);
  return [...sanitized.identityTraits, ...sanitized.preservationConstraints].join("; ");
}

export function buildPassPrompt(subject, pass) {
  const descriptor = buildMigrationIdentityDescriptor(subject);
  return [
    `Canonical identity descriptor: ${descriptor}.`,
    `Generate the exact ${pass.id} view of the same adult male character, approximately 25-30 years old, with mature facial bone structure.`,
    "Use natural-sized almond-shaped blue eyes with normal iris proportions, a restrained expression, and slender adult body proportions.",
    "Rendering target: cinematic semi-realistic Chinese 3D donghua, refined adult anime facial anatomy, detailed hair strands and skin, physically readable costume materials, cinematic depth of field and controlled rim light; stylized and semi-realistic, not Pixar-style, not Disney-style, not western family animation, not chibi, not toy-like, not juvenile, not a child.",
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
  const suppliedGuard = dependencies.outputGuard;
  const guard = suppliedGuard ?? await createOutputDirectoryGuard(safeOutputDirectory, workspaceRoot, dependencies);
  const payload = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  try {
    return await guard.writeOwnedExclusive(MANIFEST_NAME, payload);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("Migration manifest already exists; exclusive publication refused.");
    throw error;
  } finally {
    if (!suppliedGuard) await guard.removeSentinel();
  }
}

export async function runCharacterStyleMigration(options, dependencies = {}) {
  if (!isPlainObject(options)) throw new Error("Migration options are required.");
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const projectPath = resolveWorkspaceArgument(options.project, "project", workspaceRoot);
  const workflowPath = resolveWorkspaceArgument(options.workflow, "workflow", workspaceRoot);
  const outputDirectory = resolveWorkspaceArgument(options.output, "output", workspaceRoot);
  if (options.provider !== PROVIDER) throw new Error(`Migration provider must be ${PROVIDER}.`);
  if (!nonEmptyString(options.character)) throw new Error("Migration character is required.");
  const revision = options.revision ?? 1;
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Migration revision must be a positive integer.");
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

  let outputGuard;
  let temporaryGuard;
  try {
    outputGuard = await createOutputDirectoryGuard(outputDirectory, workspaceRoot, dependencies);
    temporaryGuard = await createTemporaryDirectoryGuard(dependencies);
    const transport = dependencies.transport ?? createDefaultTransport(parsedEndpoint.href, dependencies);
    const candidates = [];
    for (const pass of PASSES) {
      const uploaded = [];
      const sourceDigests = [];
      for (let index = 0; index < pass.sourceSlots.length; index += 1) {
        const slot = pass.sourceSlots[index];
        const originalBytes = subject.sourceBytes[slot];
        const sourceFormat = subject.sourceFormats[slot];
        const extension = sourceFormat === "jpeg" ? "jpg" : sourceFormat;
        const contentType = sourceFormat === "jpeg" ? "image/jpeg" : `image/${sourceFormat}`;
        const stagedName = `${pass.id}-${index + 1}.${extension}`;
        await assertNoReparseComponents(subject.sourcePaths[slot], dependencies);
        const currentSourceBytes = Buffer.from(await (dependencies.readFile ?? readFile)(subject.sourcePaths[slot]));
        if (!currentSourceBytes.equals(originalBytes)) throw new Error(`Source image changed while staging ${slot}.`);
        const stagedPath = await temporaryGuard.writeOwnedExclusive(stagedName, originalBytes);
        const stagedBytes = Buffer.from(await (dependencies.readFile ?? readFile)(stagedPath));
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
      await outputGuard.writeOwnedExclusive(outputName, outputBytes);
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
      proposedIdentityPackVersion: `${subject.identityPack.version}-cinematic3d-v${revision}`,
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
    await writeMigrationManifestExclusive(outputDirectory, manifest, { ...dependencies, workspaceRoot, outputGuard });
    await outputGuard.removeSentinel();
    return manifest;
  } finally {
    let cleanupFailure;
    if (outputGuard) {
      try {
        await outputGuard.cleanupSentinel();
      } catch (error) {
        cleanupFailure = error;
      }
    }
    if (temporaryGuard) {
      try {
        await temporaryGuard.cleanup();
      } catch (error) {
        cleanupFailure ??= error;
      }
    }
    if (cleanupFailure) throw cleanupFailure;
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
