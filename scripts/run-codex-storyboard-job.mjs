#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmod, lstat, link, mkdir, mkdtemp, opendir, readFile, realpath, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";

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
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_IMAGE_BYTES = 512 * 1024 * 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

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

function inspectPng(bytes, invalidCode, exitCode) {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) fail(invalidCode, exitCode);
  let offset = 8;
  let width = 0;
  let height = 0;
  let expectedScanlines = 0;
  let seenIhdr = false;
  let seenIdat = false;
  let seenIend = false;
  const idat = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail(invalidCode, exitCode);
    const length = bytes.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (dataEnd < dataStart || crcEnd > bytes.length) fail(invalidCode, exitCode);
    const type = bytes.subarray(typeStart, dataStart).toString("ascii");
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(typeStart, dataEnd)) !== bytes.readUInt32BE(dataEnd)) fail(invalidCode, exitCode);
    const data = bytes.subarray(dataStart, dataEnd);
    if (!seenIhdr && type !== "IHDR") fail(invalidCode, exitCode);
    if (type === "IHDR") {
      if (seenIhdr || length !== 13) fail(invalidCode, exitCode);
      seenIhdr = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      if (!width || !height || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) fail(invalidCode, exitCode);
      const samples = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
      const allowedDepths = colorType === 3 ? [1, 2, 4, 8] : [8, 16];
      if (!samples || !allowedDepths.includes(bitDepth)) fail(invalidCode, exitCode);
      const rowBytes = Math.ceil((width * samples * bitDepth) / 8);
      expectedScanlines = height * (rowBytes + 1);
      if (!Number.isSafeInteger(expectedScanlines) || expectedScanlines > MAX_IMAGE_BYTES) fail(invalidCode, exitCode);
    } else if (type === "IDAT") {
      if (!seenIhdr || seenIend) fail(invalidCode, exitCode);
      seenIdat = true;
      idat.push(data);
    } else if (type === "IEND") {
      if (!seenIhdr || !seenIdat || seenIend || length !== 0 || crcEnd !== bytes.length) fail(invalidCode, exitCode);
      seenIend = true;
    } else if (seenIend) {
      fail(invalidCode, exitCode);
    }
    offset = crcEnd;
  }
  if (!seenIhdr || !seenIdat || !seenIend || offset !== bytes.length) fail(invalidCode, exitCode);
  try {
    if (inflateSync(Buffer.concat(idat), { maxOutputLength: expectedScanlines }).length !== expectedScanlines) fail(invalidCode, exitCode);
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail(invalidCode, exitCode);
  }
  return { width, height, mimeType: "image/png" };
}

const isSof = (marker) => (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
function inspectJpeg(bytes, invalidCode, exitCode) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail(invalidCode, exitCode);
  let offset = 2;
  let inEntropy = false;
  let sawSos = false;
  let dimensions = null;
  while (offset < bytes.length) {
    if (inEntropy) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
      if (offset + 1 >= bytes.length) fail(invalidCode, exitCode);
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) fail(invalidCode, exitCode);
      const entropyMarker = bytes[offset];
      offset += 1;
      if (entropyMarker === 0x00 || (entropyMarker >= 0xd0 && entropyMarker <= 0xd7)) continue;
      if (entropyMarker === 0xd9) {
        if (offset !== bytes.length || !dimensions || !sawSos) fail(invalidCode, exitCode);
        return { ...dimensions, mimeType: "image/jpeg" };
      }
      offset -= 2;
      inEntropy = false;
      continue;
    }
    if (bytes[offset] !== 0xff) fail(invalidCode, exitCode);
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) fail(invalidCode, exitCode);
    const marker = bytes[offset++];
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) fail(invalidCode, exitCode);
    if (marker === 0xd9) {
      if (offset !== bytes.length || !dimensions || !sawSos) fail(invalidCode, exitCode);
      return { ...dimensions, mimeType: "image/jpeg" };
    }
    if (marker === 0x01) continue;
    if (offset + 2 > bytes.length) fail(invalidCode, exitCode);
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) fail(invalidCode, exitCode);
    const dataStart = offset + 2;
    const dataEnd = offset + length;
    if (isSof(marker)) {
      if (length < 8) fail(invalidCode, exitCode);
      const height = bytes.readUInt16BE(dataStart + 1);
      const width = bytes.readUInt16BE(dataStart + 3);
      const components = bytes[dataStart + 5];
      if (!width || !height || !components || length !== 8 + components * 3) fail(invalidCode, exitCode);
      if (dimensions && (dimensions.width !== width || dimensions.height !== height)) fail(invalidCode, exitCode);
      dimensions = { width, height };
    }
    offset = dataEnd;
    if (marker === 0xda) {
      if (!dimensions || length < 6) fail(invalidCode, exitCode);
      sawSos = true;
      inEntropy = true;
    }
  }
  fail(invalidCode, exitCode);
}

function inspectImage(bytes, invalidCode, exitCode) {
  return bytes.subarray(0, 8).equals(PNG_SIGNATURE)
    ? inspectPng(bytes, invalidCode, exitCode)
    : inspectJpeg(bytes, invalidCode, exitCode);
}

async function assertNoLinkComponents(filePath, code, exitCode, allowMissingLeaf = false) {
  const parsed = path.parse(path.resolve(filePath));
  let current = parsed.root;
  const components = path.relative(parsed.root, path.resolve(filePath)).split(path.sep).filter(Boolean);
  for (const [index, component] of components.entries()) {
    current = path.join(current, component);
    let details;
    try { details = await lstat(current); } catch (error) {
      if (allowMissingLeaf && index === components.length - 1 && error?.code === "ENOENT") return;
      fail(code, exitCode);
    }
    if (details.isSymbolicLink()) fail(code, exitCode);
  }
}

const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino;
async function stableRead(filePath, root, code, exitCode) {
  try {
    await assertNoLinkComponents(filePath, "codex_storyboard_cli_reference_path_invalid", EXIT.path, true);
    const before = await lstat(filePath);
    if (!before.isFile() || before.isSymbolicLink()) fail(code, exitCode);
    const canonical = await realpath(filePath);
    if (!hasContainedPath(root, canonical)) fail("codex_storyboard_cli_reference_path_invalid", EXIT.path);
    const bytes = await readFile(filePath);
    const after = await lstat(filePath);
    if (!after.isFile() || after.isSymbolicLink() || !sameIdentity(before, after) || before.size !== after.size || before.mtimeMs !== after.mtimeMs) fail(code, exitCode);
    await assertNoLinkComponents(filePath, "codex_storyboard_cli_reference_path_invalid", EXIT.path);
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
    await assertNoLinkComponents(packageArgument, "codex_storyboard_cli_package_invalid", EXIT.path);
    packagePath = await realpath(packageArgument);
    const packageDetails = await lstat(packagePath);
    if (!packageDetails.isDirectory() || packageDetails.isSymbolicLink()) fail("codex_storyboard_cli_package_invalid", EXIT.path);
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

async function stageSnapshots(job) {
  const inspectionRoot = await mkdtemp(path.join(tmpdir(), "codex-storyboard-inspection-"));
  try {
    await chmod(inspectionRoot, 0o700);
    const canonicalInspectionRoot = await realpath(inspectionRoot);
    const referencedImagePaths = [];
    for (const [index, snapshot] of job.snapshots.entries()) {
      const extension = snapshot.reference.mimeType === "image/jpeg" ? ".jpg" : ".png";
      const stagedPath = path.join(canonicalInspectionRoot, `${String(index + 1).padStart(2, "0")}-${snapshot.reference.id}${extension}`);
      await writeFile(stagedPath, snapshot.bytes, { flag: "wx", mode: 0o400 });
      await chmod(stagedPath, 0o400);
      const stagedBytes = await stableRead(stagedPath, canonicalInspectionRoot, "codex_storyboard_cli_reference_snapshot_invalid", EXIT.reference);
      const image = inspectImage(stagedBytes, "codex_storyboard_cli_reference_snapshot_invalid", EXIT.reference);
      if (sha256(stagedBytes) !== snapshot.reference.sha256 || image.width !== snapshot.reference.width || image.height !== snapshot.reference.height || image.mimeType !== snapshot.reference.mimeType) fail("codex_storyboard_cli_reference_snapshot_invalid", EXIT.reference);
      referencedImagePaths.push(stagedPath);
    }
    return { inspectionRoot: canonicalInspectionRoot, referencedImagePaths };
  } catch (error) {
    await rm(inspectionRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function compilePrompt(request) {
  return [...request.references.map((reference, index) => `Picture ${index + 1} [${reference.usage}]: ${reference.instruction}`), request.prompt.primaryRequest].join("\n");
}

async function pathExists(filePath) {
  try { await lstat(filePath); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

async function assertStableOutputs(guard) {
  await assertNoLinkComponents(guard.outputPath, "codex_storyboard_cli_publish_failed", EXIT.publish);
  const details = await lstat(guard.outputPath);
  if (!details.isDirectory() || details.isSymbolicLink() || !sameIdentity(details, guard.identity) || !hasContainedPath(guard.packagePath, await realpath(guard.outputPath))) fail("codex_storyboard_cli_publish_failed", EXIT.publish);
}

async function publishExclusive(guard, filename, bytes, injectFailure = false) {
  const { outputPath: directory } = guard;
  const finalPath = path.join(directory, filename);
  await assertStableOutputs(guard);
  if (await pathExists(finalPath)) fail("codex_storyboard_cli_output_exists", EXIT.outputExists);
  const temporary = path.join(directory, `.${filename}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    if (process.env.NODE_ENV === "test" && process.env.CODEX_STORYBOARD_TEST_SWAP_OUTPUTS_BEFORE_LINK === "1" && filename === "candidate.png") {
      await rm(directory, { recursive: true, force: true });
      await mkdir(directory, { recursive: false, mode: 0o700 });
    }
    await assertStableOutputs(guard);
    if (injectFailure) fail("codex_storyboard_cli_publish_failed", EXIT.publish);
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
  await assertStableOutputs(guard);
  const identity = await lstat(finalPath);
  if (!identity.isFile() || identity.isSymbolicLink() || sha256(await readFile(finalPath)) !== sha256(bytes)) fail("codex_storyboard_cli_publish_failed", EXIT.publish);
  return { finalPath, identity, digest: sha256(bytes) };
}

async function ensureOutputs(packagePath) {
  const outputPath = path.join(packagePath, "outputs");
  try {
    await mkdir(outputPath, { recursive: true });
    await assertNoLinkComponents(outputPath, "codex_storyboard_cli_publish_failed", EXIT.publish);
    const details = await lstat(outputPath);
    if (!details.isDirectory() || details.isSymbolicLink() || !hasContainedPath(packagePath, await realpath(outputPath))) fail("codex_storyboard_cli_publish_failed", EXIT.publish);
    const directory = await opendir(outputPath);
    return { packagePath, outputPath, identity: details, directory };
  } catch (error) {
    if (error instanceof CliError) throw error;
    fail("codex_storyboard_cli_publish_failed", EXIT.publish);
  }
}

async function rollbackPublishedCandidate(guard, candidate) {
  try {
    await assertStableOutputs(guard);
    const current = await lstat(candidate.finalPath);
    if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(current, candidate.identity)) return;
    if (sha256(await readFile(candidate.finalPath)) !== candidate.digest) return;
    await assertStableOutputs(guard);
    const beforeDelete = await lstat(candidate.finalPath);
    if (sameIdentity(beforeDelete, candidate.identity) && sha256(await readFile(candidate.finalPath)) === candidate.digest) await unlink(candidate.finalPath);
  } catch {
    // A changed output path or candidate belongs to another writer; never delete it.
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
    const staged = await stageSnapshots(job);
    process.stdout.write(`${JSON.stringify({
      jobId: job.request.jobId,
      projectId: job.request.projectId,
      episodeId: job.request.episodeId,
      shotId: job.request.shotId,
      requestDigest: job.requestDigest,
      inspectionRoot: staged.inspectionRoot,
      referencedImagePaths: staged.referencedImagePaths,
      referenceUsages: job.request.references.map(({ usage }) => usage),
      referenceInstructions: job.request.references.map(({ instruction }) => instruction),
      compiledPrompt
    }, null, 2)}\n`);
    return;
  }
  if (!path.isAbsolute(candidateArgument)) fail("codex_storyboard_cli_candidate_path_invalid", EXIT.candidate);
  let candidate;
  try {
    const candidatePath = await realpath(candidateArgument);
    candidate = await stableRead(candidatePath, path.dirname(candidatePath), "codex_storyboard_cli_candidate_missing", EXIT.candidate);
  } catch {
    fail("codex_storyboard_cli_candidate_missing", EXIT.candidate);
  }
  const image = inspectImage(candidate, "codex_storyboard_cli_candidate_invalid", EXIT.candidate);
  if (image.mimeType !== "image/png") fail("codex_storyboard_cli_candidate_invalid", EXIT.candidate);
  const outputs = await ensureOutputs(job.packagePath);
  try {
    await assertStableOutputs(outputs);
    if (await pathExists(path.join(outputs.outputPath, "candidate.png")) || await pathExists(path.join(outputs.outputPath, "result.json"))) fail("codex_storyboard_cli_output_exists", EXIT.outputExists);
    const publishedCandidate = await publishExclusive(outputs, "candidate.png", candidate);
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
    try {
      await publishExclusive(outputs, "result.json", Buffer.from(`${JSON.stringify(result, null, 2)}\n`), process.env.NODE_ENV === "test" && process.env.CODEX_STORYBOARD_TEST_FAIL_RESULT_PUBLISH === "1");
    } catch (error) {
      await rollbackPublishedCandidate(outputs, publishedCandidate);
      throw error;
    }
    await assertStableOutputs(outputs);
    process.stdout.write(`${JSON.stringify({ jobId: result.jobId, resultPath: path.join(outputs.outputPath, "result.json") })}\n`);
  } finally {
    await outputs.directory.close().catch(() => {});
  }
}

main().catch((error) => {
  const known = error instanceof CliError;
  process.stderr.write(`${known ? error.message : "codex_storyboard_cli_failed"}\n`);
  process.exitCode = known ? error.exitCode : EXIT.publish;
});
