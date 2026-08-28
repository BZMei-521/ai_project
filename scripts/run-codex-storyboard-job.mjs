#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, link, mkdir, readFile, realpath, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const PROVIDER = "codex_task_package";
const USAGES = new Set([
  "spatial_authority", "pose_reference", "face_identity", "body_costume",
  "prop_detail", "style_only", "lighting_only", "negative_example"
]);
const EXIT = Object.freeze({
  request: 10,
  reference: 11,
  path: 12,
  outputExists: 13,
  candidate: 14,
  publish: 15,
  usage: 16
});

class CliError extends Error {
  constructor(code, exitCode) {
    super(code);
    this.exitCode = exitCode;
  }
}

const fail = (code, exitCode) => { throw new CliError(code, exitCode); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys, code, exitCode = EXIT.request) => {
  if (!isPlainObject(value) || Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) fail(code, exitCode);
};
const validDigest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const validIdentifier = (value, maximum) => typeof value === "string" && new RegExp(`^[a-zA-Z0-9_-]{1,${maximum}}$`).test(value);
const safeRelativePath = (value) => typeof value === "string" && value.length > 0
  && !/^(?:[a-zA-Z]:|[\\/])/.test(value)
  && value.split(/[\\/]/).every((part) => part && part !== "." && part !== "..");
const canonicalize = (value) => Array.isArray(value)
  ? value.map(canonicalize)
  : isPlainObject(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    : value;
const canonicalRequestDigest = (request) => sha256(Buffer.from(JSON.stringify(canonicalize(request))));
const hasContainedPath = (root, target) => target === root || target.startsWith(`${root}${path.sep}`);

function validateRequest(value) {
  exactKeys(value, ["schemaVersion", "jobId", "projectId", "episodeId", "shotId", "provider", "createdAt", "prompt", "references", "acceptedImagePath", "expectedOutput"], "codex_storyboard_cli_request_invalid");
  if (value.schemaVersion !== 1 || value.provider !== PROVIDER) fail("codex_storyboard_cli_request_invalid", EXIT.request);
  for (const field of ["jobId", "projectId", "episodeId", "shotId"]) {
    if (!validIdentifier(value[field], 96)) fail("codex_storyboard_cli_request_invalid", EXIT.request);
  }
  if (typeof value.createdAt !== "string" || !value.createdAt.trim()) fail("codex_storyboard_cli_request_invalid", EXIT.request);
  if (!isPlainObject(value.prompt) || value.prompt.useCase !== "stylized-concept" || !String(value.prompt.primaryRequest ?? "").trim()) fail("codex_storyboard_cli_request_invalid", EXIT.request);
  if (!Array.isArray(value.references) || value.references.length === 0 || value.references.length > 16) fail("codex_storyboard_cli_request_invalid", EXIT.request);
  const ids = new Set();
  let hasSpatial = false;
  let hasIdentity = false;
  for (const reference of value.references) {
    exactKeys(reference, ["id", "usage", "instruction", "relativePath", "sha256", "width", "height", "mimeType"], "codex_storyboard_cli_request_invalid");
    if (!validIdentifier(reference.id, 64) || ids.has(reference.id) || !USAGES.has(reference.usage)
      || !String(reference.instruction ?? "").trim() || !validDigest(reference.sha256)
      || !Number.isSafeInteger(reference.width) || reference.width <= 0
      || !Number.isSafeInteger(reference.height) || reference.height <= 0
      || !["image/png", "image/jpeg"].includes(reference.mimeType)) {
      fail("codex_storyboard_cli_request_invalid", EXIT.request);
    }
    if (!safeRelativePath(reference.relativePath)) fail("codex_storyboard_cli_reference_path_invalid", EXIT.path);
    ids.add(reference.id);
    hasSpatial ||= reference.usage === "spatial_authority";
    hasIdentity ||= reference.usage === "face_identity" || reference.usage === "body_costume";
  }
  if (!hasSpatial || !hasIdentity || (value.acceptedImagePath !== null && typeof value.acceptedImagePath !== "string")) fail("codex_storyboard_cli_request_invalid", EXIT.request);
  exactKeys(value.expectedOutput, ["candidatePath", "resultPath", "mimeTypes"], "codex_storyboard_cli_request_invalid");
  if (value.expectedOutput.candidatePath !== "outputs/candidate.png" || value.expectedOutput.resultPath !== "outputs/result.json"
    || JSON.stringify(value.expectedOutput.mimeTypes) !== JSON.stringify(["image/png"])) fail("codex_storyboard_cli_request_invalid", EXIT.request);
  return value;
}

function inspectImage(bytes, invalidCode, exitCode) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.readUInt32BE(8) === 13 && bytes.subarray(12, 16).toString("ascii") === "IHDR") {
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width > 0 && height > 0) return { width, height, mimeType: "image/png" };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      offset += 2;
      while (marker === 0xff && bytes[offset] === 0xff) offset += 1;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        const height = bytes.readUInt16BE(offset + 3);
        const width = bytes.readUInt16BE(offset + 5);
        if (width > 0 && height > 0) return { width, height, mimeType: "image/jpeg" };
        break;
      }
      offset += length;
    }
  }
  fail(invalidCode, exitCode);
}

async function stableRead(filePath, root, code, exitCode) {
  let before;
  try {
    before = await stat(filePath);
    if (!before.isFile()) fail(code, exitCode);
    const canonical = await realpath(filePath);
    if (!hasContainedPath(root, canonical)) fail("codex_storyboard_cli_reference_path_invalid", EXIT.path);
    const bytes = await readFile(filePath);
    const after = await stat(filePath);
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) fail(code, exitCode);
    return bytes;
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail(code, exitCode);
  }
}

async function loadPackage(packageArgument) {
  if (!path.isAbsolute(packageArgument ?? "")) fail("codex_storyboard_cli_package_invalid", EXIT.path);
  let packagePath;
  try {
    packagePath = await realpath(packageArgument);
    if (!(await stat(packagePath)).isDirectory()) fail("codex_storyboard_cli_package_invalid", EXIT.path);
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail("codex_storyboard_cli_package_invalid", EXIT.path);
  }
  const requestPath = path.join(packagePath, "request.json");
  let request;
  try {
    request = JSON.parse((await stableRead(requestPath, packagePath, "codex_storyboard_cli_request_missing", EXIT.request)).toString("utf8"));
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail("codex_storyboard_cli_request_invalid", EXIT.request);
  }
  validateRequest(request);
  const snapshots = [];
  for (const reference of request.references) {
    const filePath = path.resolve(packagePath, reference.relativePath);
    if (!hasContainedPath(packagePath, filePath)) fail("codex_storyboard_cli_reference_path_invalid", EXIT.path);
    const bytes = await stableRead(filePath, packagePath, "codex_storyboard_cli_reference_missing", EXIT.reference);
    const image = inspectImage(bytes, "codex_storyboard_cli_reference_image_invalid", EXIT.reference);
    if (sha256(bytes) !== reference.sha256) fail("codex_storyboard_cli_reference_digest_mismatch", EXIT.reference);
    if (image.width !== reference.width || image.height !== reference.height || image.mimeType !== reference.mimeType) fail("codex_storyboard_cli_reference_snapshot_mismatch", EXIT.reference);
    snapshots.push({ reference, filePath, bytes });
  }
  return { packagePath, request, snapshots, requestDigest: canonicalRequestDigest(request) };
}

function compilePrompt(request) {
  return [...request.references.map((reference, index) => `Picture ${index + 1} [${reference.usage}]: ${reference.instruction}`), request.prompt.primaryRequest].join("\n");
}

async function pathExists(filePath) {
  try { await lstat(filePath); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

async function publishExclusive(directory, filename, bytes) {
  const finalPath = path.join(directory, filename);
  if (await pathExists(finalPath)) fail("codex_storyboard_cli_output_exists", EXIT.outputExists);
  const temporary = path.join(directory, `.${filename}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    try {
      await link(temporary, finalPath);
    } catch (error) {
      if (error?.code === "EEXIST") fail("codex_storyboard_cli_output_exists", EXIT.outputExists);
      throw error;
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail("codex_storyboard_cli_publish_failed", EXIT.publish);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
  return finalPath;
}

async function ensureOutputs(packagePath) {
  const outputPath = path.join(packagePath, "outputs");
  try {
    await mkdir(outputPath, { recursive: true });
    const details = await lstat(outputPath);
    if (!details.isDirectory() || details.isSymbolicLink() || !hasContainedPath(packagePath, await realpath(outputPath))) fail("codex_storyboard_cli_publish_failed", EXIT.publish);
    return outputPath;
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail("codex_storyboard_cli_publish_failed", EXIT.publish);
  }
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!/^--(?:package|candidate)$/.test(key ?? "") || !value || options[key]) fail("codex_storyboard_cli_usage", EXIT.usage);
    options[key] = value;
  }
  if (!command || !options["--package"] || (command === "complete" && !options["--candidate"]) || (command === "inspect" && options["--candidate"]) || !["inspect", "complete"].includes(command)) fail("codex_storyboard_cli_usage", EXIT.usage);
  return { command, packageArgument: options["--package"], candidateArgument: options["--candidate"] };
}

async function main() {
  const { command, packageArgument, candidateArgument } = parseArguments(process.argv.slice(2));
  const job = await loadPackage(packageArgument);
  const compiledPrompt = compilePrompt(job.request);
  if (command === "inspect") {
    process.stdout.write(`${JSON.stringify({
      jobId: job.request.jobId,
      projectId: job.request.projectId,
      episodeId: job.request.episodeId,
      shotId: job.request.shotId,
      requestDigest: job.requestDigest,
      referencedImagePaths: job.snapshots.map(({ filePath }) => filePath),
      referenceUsages: job.request.references.map(({ usage }) => usage),
      referenceInstructions: job.request.references.map(({ instruction }) => instruction),
      compiledPrompt
    }, null, 2)}\n`);
    return;
  }
  if (!path.isAbsolute(candidateArgument)) fail("codex_storyboard_cli_candidate_path_invalid", EXIT.candidate);
  let candidate;
  try {
    candidate = await readFile(candidateArgument);
  } catch {
    fail("codex_storyboard_cli_candidate_missing", EXIT.candidate);
  }
  const image = inspectImage(candidate, "codex_storyboard_cli_candidate_invalid", EXIT.candidate);
  if (image.mimeType !== "image/png") fail("codex_storyboard_cli_candidate_invalid", EXIT.candidate);
  const outputs = await ensureOutputs(job.packagePath);
  await publishExclusive(outputs, "candidate.png", candidate);
  const result = {
    schemaVersion: 1,
    jobId: job.request.jobId,
    projectId: job.request.projectId,
    episodeId: job.request.episodeId,
    shotId: job.request.shotId,
    provider: PROVIDER,
    requestDigest: job.requestDigest,
    referenceDigests: job.request.references.map(({ id, sha256 }) => ({ id, sha256 })),
    generationMode: "codex_builtin_imagegen",
    finalPrompt: compiledPrompt,
    output: { relativePath: "outputs/candidate.png", sha256: sha256(candidate), width: image.width, height: image.height, mimeType: "image/png" },
    completedAt: new Date().toISOString(),
    state: "completed"
  };
  await publishExclusive(outputs, "result.json", Buffer.from(`${JSON.stringify(result, null, 2)}\n`));
  process.stdout.write(`${JSON.stringify({ jobId: result.jobId, resultPath: path.join(outputs, "result.json") })}\n`);
}

main().catch((error) => {
  const known = error instanceof CliError;
  process.stderr.write(`${known ? error.message : "codex_storyboard_cli_failed"}\n`);
  process.exitCode = known ? error.exitCode : EXIT.publish;
});
