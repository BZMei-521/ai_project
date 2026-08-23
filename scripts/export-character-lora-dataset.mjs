import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, rmdir, rm, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ALLOWED_VIEWS = new Set(["front", "three_quarter", "profile", "back"]);
const ALLOWED_SCALES = new Set(["close", "medium", "full_body"]);
const REQUIRED_VIEWS = ["front", "profile", "back"];
const REQUIRED_SCALES = ["close", "medium", "full_body"];
const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const QWEN_MODEL = "Qwen/Qwen-Image-Edit-2511";
const KLEIN_MODEL = "black-forest-labs/FLUX.2-klein-base-4B";
const PROVIDERS = Object.freeze({ qwen_image_edit_2511: QWEN_MODEL, flux2_klein_4b: KLEIN_MODEL });

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function newCleanupResult() {
  return { failures: [], unexpectedEntries: new Set(), completionMarkerMayRemain: false };
}

function sanitizedCleanupCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "ECLEANUP";
}

function sanitizedRelativePath(path) {
  return String(path || ".").replace(/\.character-lora-owner-[^/\\]+/g, ".character-lora-owner").replaceAll("\\", "/");
}

function sanitizedImmediateEntryName(name) {
  const sanitized = String(name).replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, 128);
  return sanitized || "unnamed_entry";
}

function addCleanupFailure(result, operation, relativePath, error) {
  result.failures.push({ operation, relativePath: sanitizedRelativePath(relativePath), code: sanitizedCleanupCode(error) });
}

function mergeCleanupResult(error, result) {
  const failures = [...(error.cleanupFailures ?? []), ...result.failures];
  const unexpectedEntries = [...new Set([...(error.cleanupUnexpectedEntries ?? []), ...result.unexpectedEntries].map(sanitizedRelativePath))].sort((left, right) => left.localeCompare(right, "en"));
  if (failures.length > 0) error.cleanupFailures = failures;
  if (unexpectedEntries.length > 0) error.cleanupUnexpectedEntries = unexpectedEntries;
  if (result.completionMarkerMayRemain) error.cleanupCompletionMarkerMayRemain = true;
  if (failures.length > 0 || unexpectedEntries.length > 0 || error.cleanupCompletionMarkerMayRemain) error.cleanupIncomplete = true;
  return error;
}

function comparisonPath(path) {
  const withoutNamespace = path.replace(/^\\\\\?\\/, "").replaceAll("\\", "/").replace(/\/+$/, "");
  return process.platform === "win32" ? withoutNamespace.toLowerCase() : withoutNamespace;
}

export function isContainedPath(childPath, parentPath) {
  const child = comparisonPath(childPath);
  const parent = comparisonPath(parentPath);
  return child === parent || child.startsWith(`${parent}/`);
}

function asNonEmptyString(value, code, field) {
  if (typeof value !== "string" || value.trim() === "") fail(code, `${field} must be a non-empty string`);
  return value.trim();
}

function canonicalRelativePath(value, code, field) {
  const requested = asNonEmptyString(value, code, field);
  if (isAbsolute(requested)) fail(code, `${field} must be relative to the project backup`);
  const path = requested.replaceAll("\\", "/");
  if (path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail(code, `${field} must be a canonical relative path without aliases`);
  }
  return path;
}

function validateIdentityPath(value, field) {
  const path = asNonEmptyString(value, "EIDENTITY", field);
  if (isAbsolute(path) || path.replaceAll("\\", "/").split("/").some((segment) => segment === ".." || segment === "")) {
    fail("EIDENTITY", `${field} must be a safe non-empty path`);
  }
  return path;
}

function validateNonEmptyStringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0) fail("EIDENTITY", `${field} must be a non-empty array`);
  return value.map((item) => asNonEmptyString(item, "EIDENTITY", field));
}

function validateIdentityPack(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) fail("EIDENTITY", "character must have a complete identity pack");
  const version = asNonEmptyString(identity.version, "EVERSION", "identity pack version");
  const triggerWord = asNonEmptyString(identity.triggerWord, "ETRIGGER", "identity pack trigger word");
  validateIdentityPath(identity.faceMasterPath, "identity pack faceMasterPath");
  validateIdentityPath(identity.bodyFrontPath, "identity pack bodyFrontPath");
  for (const field of ["faceLeftPath", "faceRightPath", "hairBackPath", "bodySidePath", "bodyBackPath", "neutralExpressionPath"]) {
    if (identity[field] !== undefined) validateIdentityPath(identity[field], `identity pack ${field}`);
  }
  const immutableTraits = validateNonEmptyStringArray(identity.immutableTraits, "identity pack immutableTraits");
  validateNonEmptyStringArray(identity.forbiddenChanges, "identity pack forbiddenChanges");
  const approvedHeroFramePaths = validateNonEmptyStringArray(identity.approvedHeroFramePaths, "identity pack approvedHeroFramePaths");
  approvedHeroFramePaths.forEach((path) => validateIdentityPath(path, "identity pack approvedHeroFramePaths"));
  const updatedAt = asNonEmptyString(identity.updatedAt, "EIDENTITY", "identity pack updatedAt");
  if (Number.isNaN(Date.parse(updatedAt))) fail("EIDENTITY", "identity pack updatedAt must be a valid timestamp");
  return { identity, version, triggerWord, immutableTraits };
}

function validateProviders(manifest) {
  const providers = manifest.commercialProviders;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) fail("EPROVIDER", "manifest commercialProviders is required");
  const actualKeys = Object.keys(providers).sort();
  const expectedKeys = Object.keys(PROVIDERS).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    fail("EPROVIDER", "manifest commercialProviders must contain exactly qwen_image_edit_2511 and flux2_klein_4b");
  }
  for (const [key, model] of Object.entries(PROVIDERS)) {
    if (providers[key] !== model) fail("EPROVIDER", `manifest commercialProviders.${key} must be ${model}`);
  }
}

export function buildDatasetPlan({ project, characterId, manifest }) {
  const snapshot = project?.snapshot ?? project;
  const assets = Array.isArray(snapshot?.assets) ? snapshot.assets : [];
  const requestedAssets = assets.filter((asset) => asset?.id === characterId);
  if (requestedAssets.length !== 1 || requestedAssets[0]?.type !== "character") {
    fail("ECHARACTER", "--character must select exactly one character asset");
  }
  const character = requestedAssets[0];
  const { identity, version, triggerWord, immutableTraits } = validateIdentityPack(character.characterIdentityPack);
  const triggerMatches = assets.filter((asset) => asset?.type === "character" && asset.characterIdentityPack?.triggerWord === triggerWord);
  if (triggerMatches.length !== 1) fail("ETRIGGER", "character trigger word must be unique within the project");

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) fail("EMANIFEST", "manifest must be an object");
  if (manifest.characterId !== characterId) fail("ECHARACTER", "manifest characterId must match --character");
  if (manifest.identityPackVersion !== version) fail("EVERSION", "manifest identityPackVersion must match the character identity pack");
  validateProviders(manifest);
  if (!Array.isArray(manifest.sourceRoots) || manifest.sourceRoots.length === 0) fail("EPATH", "manifest sourceRoots is required");
  const sourceRoots = manifest.sourceRoots.map((root) => canonicalRelativePath(root, "EPATH", "sourceRoots entry"));
  if (new Set(sourceRoots.map(comparisonPath)).size !== sourceRoots.length) fail("EDUPLICATE", "sourceRoots may not contain aliases");
  if (!Array.isArray(manifest.approvedImages)) fail("EMANIFEST", "manifest approvedImages must be an array");
  if (manifest.approvedImages.length < 15 || manifest.approvedImages.length > 30) fail("ECOUNT", "approvedImages must contain 15 to 30 images");

  const lexicalPaths = new Set();
  const views = new Set();
  const scales = new Set();
  const images = manifest.approvedImages.map((image, index) => {
    if (!image || typeof image !== "object" || Array.isArray(image) || image.approved !== true) fail("EAPPROVAL", `approvedImages[${index}] is not explicitly approved`);
    const path = canonicalRelativePath(image.path, "EPATH", `approvedImages[${index}].path`);
    const pathKey = comparisonPath(path);
    if (lexicalPaths.has(pathKey)) fail("EDUPLICATE", `duplicate approved image path: ${path}`);
    lexicalPaths.add(pathKey);
    const extension = extname(path).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) fail("EENUM", `unsupported image extension: ${extension || "(none)"}`);
    const view = asNonEmptyString(image.view, "EENUM", "image view");
    const scale = asNonEmptyString(image.scale, "EENUM", "image scale");
    if (!ALLOWED_VIEWS.has(view) || !ALLOWED_SCALES.has(scale)) fail("EENUM", "view/scale enum is invalid");
    if (image.identityPackVersion !== version) fail("EVERSION", "every approved image must declare the selected identityPackVersion");
    if (!Array.isArray(image.visibleImmutableTraits) || image.visibleImmutableTraits.length === 0) fail("ETRAIT", "each approved image must declare visibleImmutableTraits");
    const visibleImmutableTraits = image.visibleImmutableTraits.map((trait) => asNonEmptyString(trait, "ETRAIT", "visible immutable trait"));
    if (visibleImmutableTraits.some((trait) => !immutableTraits.includes(trait))) fail("ETRAIT", "captions may only use immutable traits declared by the identity pack");
    views.add(view);
    scales.add(scale);
    return { path, view, scale, extension, visibleImmutableTraits };
  });
  for (const view of REQUIRED_VIEWS) if (!views.has(view)) fail("ECOVERAGE", `required ${view} view coverage is missing`);
  for (const scale of REQUIRED_SCALES) if (!scales.has(scale)) fail("ECOVERAGE", `required ${scale} scale coverage is missing`);
  const generatedFrames = manifest.generatedFramePaths ?? [];
  if (!Array.isArray(generatedFrames) || generatedFrames.some((path) => typeof path !== "string" || !lexicalPaths.has(comparisonPath(path)))) {
    fail("EAPPROVAL", "every generated frame must be explicitly included in approvedImages");
  }
  return { character, identity, version, triggerWord, immutableTraits, sourceRoots, images };
}

function captionFor(triggerWord, visibleImmutableTraits) {
  return `${triggerWord}, ${visibleImmutableTraits.join(", ")}`;
}

export function buildTrainingConfigs({ version, triggerWord }) {
  const shared = { commercial_compatible: true, identity_pack_version: version, trigger_word: triggerWord, dataset_metadata: "dataset/metadata.jsonl" };
  return {
    qwen: { provider: "qwen_image_edit_2511", model: QWEN_MODEL, ...shared, cpu_offload: true, lora_rank: 16, batch_size: 1, gradient_accumulation_steps: 4, resolution: 768, seed: 20260808 },
    klein: { provider: "flux2_klein_4b", model: KLEIN_MODEL, ...shared, training_host_requirement: "24GB VRAM minimum", desktop_inference_target: "16GB VRAM desktop", lora_rank: 16, batch_size: 1, resolution: 768, steps: 1800, seed: 20260808 }
  };
}

async function readJson(path, label) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { fail("EJSON", `cannot read ${label}: ${error.message}`); }
}

async function resolveAuthorizedRoots(projectDirectory, sourceRoots) {
  return Promise.all(sourceRoots.map(async (root) => {
    const lexical = resolve(projectDirectory, root);
    let real;
    try {
      real = await realpath(lexical);
      if (!(await stat(real)).isDirectory()) fail("ESOURCE", `authorized source root is not a directory: ${root}`);
    } catch (error) {
      if (error?.code === "ESOURCE") throw error;
      fail("ESOURCE", `authorized source root does not exist: ${root}`);
    }
    if (!isContainedPath(real, projectDirectory)) fail("EPATH", `authorized source root escapes the real project directory: ${root}`);
    return { lexical, real };
  }));
}

function fileIdentity(fileStat) {
  if (typeof fileStat.dev === "bigint" && typeof fileStat.ino === "bigint") {
    return fileStat.ino === 0n ? null : `${fileStat.dev}:${fileStat.ino}`;
  }
  return Number.isSafeInteger(fileStat.dev) && Number.isSafeInteger(fileStat.ino) && fileStat.ino !== 0 ? `${fileStat.dev}:${fileStat.ino}` : null;
}

async function currentArtifactIdentity(path) {
  try { return fileIdentity(await lstat(path, { bigint: true })); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

async function contentDigest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function resolveApprovedSources({ images, roots, projectDirectory }) {
  const seenRealPaths = new Set();
  const seenPhysicalFiles = new Set();
  const resolved = [];
  for (const image of images) {
    const lexical = resolve(projectDirectory, image.path);
    if (!roots.some((root) => isContainedPath(lexical, root.lexical))) fail("EPATH", `approved image is outside authorized source roots: ${image.path}`);
    let source;
    let sourceStat;
    try { source = await realpath(lexical); sourceStat = await stat(source, { bigint: true }); }
    catch { fail("ESOURCE", `approved image is missing or unreadable: ${image.path}`); }
    if (!sourceStat.isFile() || !roots.some((root) => isContainedPath(source, root.real))) fail("EPATH", `approved image escapes an authorized source root: ${image.path}`);
    const realKey = comparisonPath(source);
    const physicalKey = fileIdentity(sourceStat);
    if (seenRealPaths.has(realKey) || (physicalKey && seenPhysicalFiles.has(physicalKey))) fail("EDUPLICATE", `approved image aliases a previously approved physical file: ${image.path}`);
    seenRealPaths.add(realKey);
    if (physicalKey) seenPhysicalFiles.add(physicalKey);
    resolved.push({ ...image, source });
  }
  return resolved.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

async function nearestExistingAncestor(path) {
  let candidate = path;
  while (true) {
    try { await lstat(candidate); return candidate; }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) fail("EPATH", "output has no existing ancestor");
      candidate = parent;
    }
  }
}

async function assertMissing(path) {
  try { await lstat(path); fail("EOUTPUT_EXISTS", "output directory already exists; choose a new directory"); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
}

async function resolveSafeOutput(outputDirectory, projectDirectory, roots) {
  const lexicalOutput = resolve(outputDirectory);
  await assertMissing(lexicalOutput);
  const ancestor = await nearestExistingAncestor(lexicalOutput);
  const realAncestor = await realpath(ancestor);
  const realOutput = resolve(realAncestor, relative(ancestor, lexicalOutput));
  if (!isContainedPath(realOutput, projectDirectory)) fail("EPATH", "output directory must remain under the real project directory");
  if (roots.some((root) => isContainedPath(realOutput, root.real))) fail("EPATH", "output directory must not be inside an authorized source root");
  return { lexicalOutput, realOutput };
}

async function removeCreatedParents(createdParents) {
  const cleanup = newCleanupResult();
  for (const path of [...createdParents].reverse()) {
    try { await rmdir(path); }
    catch (error) {
      if (error?.code === "ENOENT") continue;
      const relativePath = `output_parent/${sanitizedImmediateEntryName(basename(path))}`;
      addCleanupFailure(cleanup, "rmdir_parent", relativePath, error);
      if (["ENOTEMPTY", "EEXIST"].includes(error?.code)) {
        try {
          const entries = await readdir(path);
          for (const entry of entries.slice(0, 32)) cleanup.unexpectedEntries.add(sanitizedImmediateEntryName(entry));
          if (entries.length > 32) cleanup.unexpectedEntries.add("more_entries");
        } catch (readError) {
          if (readError?.code !== "ENOENT") addCleanupFailure(cleanup, "readdir_parent", relativePath, readError);
        }
      }
    }
  }
  return cleanup;
}

async function createSafeOutputParents(outputPath, projectDirectory, roots) {
  const outputParent = dirname(outputPath);
  const existingAncestor = await nearestExistingAncestor(outputParent);
  const suffix = relative(existingAncestor, outputParent);
  if (!suffix) return [];
  const segments = suffix.split(/[\\/]/).filter(Boolean);
  const createdParents = [];
  let current = existingAncestor;
  try {
    for (const segment of segments) {
      current = resolve(current, segment);
      try {
        await mkdir(current, { recursive: false });
        createdParents.push(current);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      const realCurrent = await realpath(current);
      if (!isContainedPath(realCurrent, projectDirectory) || roots.some((root) => isContainedPath(realCurrent, root.real))) {
        fail("EPATH", "output parent escaped the real project directory or entered an authorized source root");
      }
    }
    return createdParents;
  } catch (error) {
    throw mergeCleanupResult(error, await removeCreatedParents(createdParents));
  }
}

async function writeTextExclusive(path, content) {
  const handle = await open(path, "wx");
  try { await handle.writeFile(content); await syncHandle(handle); } finally { await handle.close(); }
}

async function syncHandle(handle) {
  try { await handle.sync(); }
  catch (error) {
    if (!["EPERM", "EINVAL", "ENOTSUP", "ENOSYS"].includes(error?.code)) throw error;
  }
}

async function syncFile(path) {
  const handle = await open(path, "r");
  try { await syncHandle(handle); } finally { await handle.close(); }
}

async function createStagingDirectory(outputPath) {
  const parent = dirname(outputPath);
  for (let attempts = 0; attempts < 8; attempts += 1) {
    const staging = resolve(parent, `.${randomUUID()}.character-lora-staging`);
    try { await mkdir(staging, { recursive: false }); return staging; }
    catch (error) { if (error?.code !== "EEXIST") throw error; }
  }
  fail("EOUTPUT", "could not create an exclusive staging directory");
}

async function cleanupStagingRoot(stagingPath, stagingRealPath, failureInjector) {
  const cleanup = newCleanupResult();
  try {
    const currentRealPath = await realpath(stagingPath);
    if (!stagingRealPath || comparisonPath(currentRealPath) !== comparisonPath(stagingRealPath)) {
      cleanup.unexpectedEntries.add("staging_root_changed");
      return cleanup;
    }
    await failureInjector?.({ phase: "cleanup_staging_rm", relativePath: "staging", staging: stagingPath });
    await rm(stagingPath, { recursive: true, force: true });
    return cleanup;
  } catch (error) {
    if (error?.code !== "ENOENT") addCleanupFailure(cleanup, "rm_staging", "staging", error);
    return cleanup;
  }
}

async function writeOwnerTokenExclusive(reservation, failureInjector) {
  const { outputPath, ownerTokenPath, ownerToken } = reservation;
  let operationError;
  let closeError;
  try {
    await failureInjector?.({ phase: "owner_token", step: "open", outputDirectory: outputPath, ownerTokenPath });
    reservation.ownerTokenHandle = await open(ownerTokenPath, "wx");
    reservation.ownerTokenHandleAcquired = true;
    reservation.files.push({ path: ownerTokenPath, relativePath: basename(ownerTokenPath), identity: fileIdentity(await reservation.ownerTokenHandle.stat({ bigint: true })), tokenProof: ownerToken });
    await failureInjector?.({ phase: "owner_token_open", outputDirectory: outputPath, ownerTokenPath });
    await failureInjector?.({ phase: "owner_token_write", outputDirectory: outputPath, ownerTokenPath });
    await reservation.ownerTokenHandle.writeFile(`${ownerToken}\n`);
    await failureInjector?.({ phase: "owner_token_sync", outputDirectory: outputPath, ownerTokenPath });
    await syncHandle(reservation.ownerTokenHandle);
  } catch (error) {
    operationError = error;
  } finally {
    if (reservation.ownerTokenHandle) {
      try { await failureInjector?.({ phase: "owner_token_close", outputDirectory: outputPath, ownerTokenPath }); }
      catch (error) { closeError = error; }
      try { await reservation.ownerTokenHandle.close(); }
      catch (error) { if (!closeError) closeError = error; }
      reservation.ownerTokenHandle = undefined;
    }
  }
  if (operationError) throw operationError;
  if (closeError) throw closeError;
}

async function tokenArtifactStillOwned(artifact) {
  if (!artifact.tokenProof) return true;
  try {
    const tokenText = await readFile(artifact.path, "utf8");
    return tokenText === "" || tokenText === `${artifact.tokenProof}\n` || artifact.tokenProof.startsWith(tokenText);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function collectUnexpectedEntries(rootPath, relativePrefix = "") {
  let entries;
  try { entries = await readdir(rootPath, { withFileTypes: true }); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const unexpected = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const nested = await collectUnexpectedEntries(resolve(rootPath, entry.name), relativePath);
      if (nested.length === 0) unexpected.push(relativePath);
      else unexpected.push(...nested);
    } else {
      unexpected.push(relativePath);
    }
  }
  return unexpected;
}

async function cleanupPreHandleReservation(reservation, failureInjector) {
  const cleanup = newCleanupResult();
  let identity;
  try { identity = await currentArtifactIdentity(reservation.outputPath); }
  catch (error) { addCleanupFailure(cleanup, "stat", ".", error); return cleanup; }
  if (identity === null) return cleanup;
  if (identity !== reservation.directories[0]?.identity) {
    cleanup.unexpectedEntries.add(".");
    return cleanup;
  }
  let entries;
  try { entries = await readdir(reservation.outputPath); }
  catch (error) { addCleanupFailure(cleanup, "readdir", ".", error); return cleanup; }
  if (entries.length > 0) {
    for (const entry of entries) cleanup.unexpectedEntries.add(sanitizedRelativePath(entry));
    return cleanup;
  }
  try {
    await failureInjector?.({ phase: "cleanup_rmdir", relativePath: ".", outputDirectory: reservation.outputPath });
    await rmdir(reservation.outputPath);
  } catch (error) {
    addCleanupFailure(cleanup, "rmdir", ".", error);
    try { for (const entry of await collectUnexpectedEntries(reservation.outputPath)) cleanup.unexpectedEntries.add(entry); } catch (scanError) { addCleanupFailure(cleanup, "scan", ".", scanError); }
  }
  return cleanup;
}

async function cleanupReservationArtifacts(reservation, failureInjector) {
  if (!reservation.ownerTokenHandleAcquired) return cleanupPreHandleReservation(reservation, failureInjector);
  const cleanup = newCleanupResult();
  for (const artifact of [...reservation.files].reverse()) {
    const isCompletionMarker = artifact.relativePath === "dataset/.character-lora-complete.json";
    let identity;
    try { identity = await currentArtifactIdentity(artifact.path); }
    catch (error) {
      addCleanupFailure(cleanup, "stat", artifact.relativePath, error);
      if (isCompletionMarker) cleanup.completionMarkerMayRemain = true;
      continue;
    }
    if (identity === null) continue;
    let contentMatches;
    try { contentMatches = artifact.contentHash ? await contentDigest(artifact.path) === artifact.contentHash : await tokenArtifactStillOwned(artifact); }
    catch (error) {
      addCleanupFailure(cleanup, "verify", artifact.relativePath, error);
      if (isCompletionMarker) cleanup.completionMarkerMayRemain = true;
      continue;
    }
    if (identity !== artifact.identity || !contentMatches) {
      cleanup.unexpectedEntries.add(artifact.relativePath);
      if (isCompletionMarker) cleanup.completionMarkerMayRemain = true;
      continue;
    }
    try {
      await failureInjector?.({ phase: "cleanup_unlink", relativePath: artifact.relativePath, path: artifact.path, outputDirectory: reservation.outputPath });
      await unlink(artifact.path);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        addCleanupFailure(cleanup, "unlink", artifact.relativePath, error);
        if (isCompletionMarker) cleanup.completionMarkerMayRemain = true;
      }
    }
  }
  for (const artifact of [...reservation.directories].reverse()) {
    let identity;
    try { identity = await currentArtifactIdentity(artifact.path); }
    catch (error) { addCleanupFailure(cleanup, "stat", artifact.relativePath || ".", error); continue; }
    if (identity === null) continue;
    if (identity !== artifact.identity) {
      cleanup.unexpectedEntries.add(artifact.relativePath || ".");
      continue;
    }
    try {
      await failureInjector?.({ phase: "cleanup_rmdir", relativePath: artifact.relativePath || ".", path: artifact.path, outputDirectory: reservation.outputPath });
      await rmdir(artifact.path);
    }
    catch (error) {
      if (error?.code !== "ENOENT") addCleanupFailure(cleanup, "rmdir", artifact.relativePath || ".", error);
    }
  }
  try { for (const entry of await collectUnexpectedEntries(reservation.outputPath)) cleanup.unexpectedEntries.add(entry); }
  catch (error) { addCleanupFailure(cleanup, "scan", ".", error); }
  return cleanup;
}

async function reserveOutputDirectory(outputPath, failureInjector) {
  const ownerToken = randomUUID();
  const ownerTokenPath = resolve(outputPath, `.character-lora-owner-${ownerToken}`);
  const reservation = { outputPath, ownerToken, ownerTokenPath, ownerTokenHandleAcquired: false, ownerTokenHandle: undefined, files: [], directories: [] };
  let created = false;
  try {
    await mkdir(outputPath, { recursive: false });
    created = true;
    reservation.directories.push({ path: outputPath, relativePath: "", identity: await currentArtifactIdentity(outputPath) });
    await writeOwnerTokenExclusive(reservation, failureInjector);
    return reservation;
  } catch (error) {
    if (created) mergeCleanupResult(error, await cleanupReservationArtifacts(reservation, failureInjector));
    if (error?.code === "EEXIST") {
      error.code = "EOUTPUT_EXISTS";
      error.message = "output directory already exists; choose a new directory";
    }
    throw error;
  }
}

async function writePublishedFile(reservation, path, relativePath, content) {
  const handle = await open(path, "wx");
  reservation.files.push({
    path,
    relativePath,
    identity: fileIdentity(await handle.stat({ bigint: true })),
    contentHash: createHash("sha256").update(content).digest("hex")
  });
  try {
    await handle.writeFile(content);
    await syncHandle(handle);
  } finally {
    await handle.close();
  }
}

async function publishStagingPayload({ staging, reservation, records, failureInjector }) {
  const datasetDirectory = resolve(reservation.outputPath, "dataset");
  await mkdir(datasetDirectory, { recursive: false });
  reservation.directories.push({ path: datasetDirectory, relativePath: "dataset", identity: await currentArtifactIdentity(datasetDirectory) });
  const payload = [
    ...records.map((record) => ({ source: resolve(staging, "dataset", record.file_name), target: resolve(datasetDirectory, record.file_name) })),
    { source: resolve(staging, "dataset", "metadata.jsonl"), target: resolve(datasetDirectory, "metadata.jsonl") },
    { source: resolve(staging, "qwen-diffsynth-training.json"), target: resolve(reservation.outputPath, "qwen-diffsynth-training.json") },
    { source: resolve(staging, "klein-ai-toolkit-training.json"), target: resolve(reservation.outputPath, "klein-ai-toolkit-training.json") }
  ];
  for (const [index, entry] of payload.entries()) {
    await failureInjector?.({ phase: "publish", index, source: entry.source, target: entry.target, outputDirectory: reservation.outputPath });
    await writePublishedFile(reservation, entry.target, relative(reservation.outputPath, entry.target).replaceAll("\\", "/"), await readFile(entry.source));
  }
  const completionPath = resolve(datasetDirectory, ".character-lora-complete.json");
  await writePublishedFile(reservation, completionPath, "dataset/.character-lora-complete.json", "{\"complete\":true,\"schemaVersion\":1}\n");
}

export async function exportCharacterLoraDataset({ projectPath, characterId, manifestPath, outputDirectory, failureInjector } = {}) {
  const safeProjectPath = resolve(asNonEmptyString(projectPath, "ECLI", "projectPath"));
  const safeManifestPath = resolve(asNonEmptyString(manifestPath, "ECLI", "manifestPath"));
  const realProjectPath = await realpath(safeProjectPath).catch(() => fail("EJSON", "cannot resolve project backup"));
  const projectDirectory = dirname(realProjectPath);
  const plan = buildDatasetPlan({ project: await readJson(realProjectPath, "project backup"), characterId: asNonEmptyString(characterId, "ECLI", "characterId"), manifest: await readJson(safeManifestPath, "dataset manifest") });
  const roots = await resolveAuthorizedRoots(projectDirectory, plan.sourceRoots);
  const sources = await resolveApprovedSources({ images: plan.images, roots, projectDirectory });
  const { lexicalOutput } = await resolveSafeOutput(asNonEmptyString(outputDirectory, "ECLI", "outputDirectory"), projectDirectory, roots);
  const records = sources.map((image, index) => {
    const digest = createHash("sha256").update(image.path).digest("hex").slice(0, 12);
    return { source: image.source, file_name: `${String(index + 1).padStart(3, "0")}-${image.view}-${image.scale}-${digest}${image.extension}`, caption: captionFor(plan.triggerWord, image.visibleImmutableTraits), view: image.view, scale: image.scale, identity_pack_version: plan.version, approved: true };
  });
  const configs = buildTrainingConfigs(plan);
  let staging;
  let stagingRealPath;
  let reservation;
  let createdParents = [];
  try {
    createdParents = await createSafeOutputParents(lexicalOutput, projectDirectory, roots);
    staging = await createStagingDirectory(lexicalOutput);
    stagingRealPath = await realpath(staging);
    const datasetDirectory = resolve(staging, "dataset");
    await mkdir(datasetDirectory, { recursive: false });
    for (const [index, record] of records.entries()) {
      await failureInjector?.({ phase: "copy", index, source: record.source });
      const target = resolve(datasetDirectory, record.file_name);
      await copyFile(record.source, target, constants.COPYFILE_EXCL);
      await syncFile(target);
    }
    await writeTextExclusive(resolve(datasetDirectory, "metadata.jsonl"), `${records.map(({ source, ...record }) => JSON.stringify(record)).join("\n")}\n`);
    await writeTextExclusive(resolve(staging, "qwen-diffsynth-training.json"), `${JSON.stringify(configs.qwen, null, 2)}\n`);
    await writeTextExclusive(resolve(staging, "klein-ai-toolkit-training.json"), `${JSON.stringify(configs.klein, null, 2)}\n`);
    await failureInjector?.({ phase: "before_reservation", staging, outputDirectory: lexicalOutput });
    reservation = await reserveOutputDirectory(lexicalOutput, failureInjector);
    await failureInjector?.({ phase: "after_reservation", staging, outputDirectory: lexicalOutput, ownerTokenPath: reservation.ownerTokenPath });
    await publishStagingPayload({ staging, reservation, records, failureInjector });
    await failureInjector?.({ phase: "after_completion", staging, outputDirectory: lexicalOutput });
    const stagingCleanup = await cleanupStagingRoot(staging, stagingRealPath, failureInjector);
    if (stagingCleanup.failures.length > 0 || stagingCleanup.unexpectedEntries.size > 0) {
      const cleanupError = new Error("staging cleanup incomplete");
      cleanupError.code = "ECLEANUP";
      throw mergeCleanupResult(cleanupError, stagingCleanup);
    }
    staging = undefined;
  } catch (error) {
    if (reservation) mergeCleanupResult(error, await cleanupReservationArtifacts(reservation, failureInjector));
    if (staging) mergeCleanupResult(error, await cleanupStagingRoot(staging, stagingRealPath, failureInjector));
    mergeCleanupResult(error, await removeCreatedParents(createdParents));
    throw error;
  }
  return { input: { projectPath: safeProjectPath, characterId, manifestPath: safeManifestPath }, imageCount: records.length, outputDirectory: lexicalOutput, files: records.map(({ source, ...record }) => record.file_name) };
}

export function parseCliArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined || values[key]) fail("ECLI", "usage: --project <path> --character <id> --manifest <path> --output <directory>");
    values[key] = value;
  }
  if (Object.keys(values).length !== 4 || !values["--project"] || !values["--character"] || !values["--manifest"] || !values["--output"]) fail("ECLI", "usage: --project <path> --character <id> --manifest <path> --output <directory>");
  return { projectPath: values["--project"], characterId: values["--character"], manifestPath: values["--manifest"], outputDirectory: values["--output"] };
}

async function main() {
  try { console.log(JSON.stringify(await exportCharacterLoraDataset(parseCliArguments(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(`${error.code ?? "EEXPORT"}: ${error.message}`); process.exitCode = 1; }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
