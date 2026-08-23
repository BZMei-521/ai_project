import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendCandidate, assertRunInvariant, sha256File, writeJsonAtomic } from "./layered-compositing-run.mjs";
import { assertLayout, createRiverLayout } from "./layered-compositing-layout.mjs";
import { assertWorkflowObjectInfo, compileWorkflow, createComfyAdapter } from "./layered-compositing-comfy.mjs";

const PRESET = new URL("../../src/modules/comfy-pipeline/presets/layered-birefnet-matte-v1.json", import.meta.url);
const OUTPUT_NODE = "6";
const CHARACTERS = new Set(["shen_yan", "jiang_lan"]);
const CANDIDATES = new Set([1, 2, 3]);

function fail(message) { throw new Error(`Layered compositing media invariant: ${message}`); }

function run(command, args, encoding = "utf8") {
  const result = spawnSync(command, args, { encoding, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) fail(`${command} could not run: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} decode failed: ${String(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

function rawPixels(filePath, pixelFormat) {
  return run("ffmpeg", ["-v", "error", "-i", filePath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", pixelFormat, "pipe:1"], null);
}

export function probeImage(filePath) {
  const resolved = path.resolve(filePath ?? "");
  if (!existsSync(resolved) || !statSync(resolved).isFile() || statSync(resolved).size <= 0) fail(`image is missing or empty: ${resolved}`);
  let decoded;
  try {
    decoded = JSON.parse(run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type,codec_name,width,height,pix_fmt", "-of", "json", resolved]));
  } catch (error) {
    fail(`image ffprobe decode failed: ${error.message}`);
  }
  const stream = decoded?.streams?.[0];
  if (stream?.codec_type !== "video" || !Number.isInteger(stream.width) || !Number.isInteger(stream.height) || stream.width <= 0 || stream.height <= 0 || typeof stream.codec_name !== "string" || typeof stream.pix_fmt !== "string") fail(`image has no decodable video stream: ${resolved}`);
  run("ffmpeg", ["-v", "error", "-i", resolved, "-frames:v", "1", "-f", "null", "-"]);
  return { path: resolved, codecName: stream.codec_name, width: stream.width, height: stream.height, pixelFormat: stream.pix_fmt };
}

export function compareProtectedRegion(beforePath, afterPath, protectedMaskPath) {
  const before = probeImage(beforePath); const after = probeImage(afterPath); const mask = probeImage(protectedMaskPath);
  for (const [value, label] of [[before, "before image"], [after, "after image"], [mask, "protected mask"]]) {
    if (value.codecName !== "png") fail(`${label} codec must be png, got ${value.codecName}`);
  }
  if (before.width !== after.width || before.height !== after.height || before.width !== mask.width || before.height !== mask.height) fail("protected comparison image and mask geometry must match");
  if (!/^gray/.test(mask.pixelFormat)) fail(`protected mask pixel format must be gray, got ${mask.pixelFormat}`);
  const beforeRgb = rawPixels(before.path, "rgb24"); const afterRgb = rawPixels(after.path, "rgb24"); const maskGray = rawPixels(mask.path, "gray");
  if (beforeRgb.length !== afterRgb.length || beforeRgb.length !== maskGray.length * 3) fail("protected comparison decoded byte lengths do not match");
  let protectedPixels = 0; let changedPixels = 0; let absoluteDelta = 0;
  for (let pixel = 0; pixel < maskGray.length; pixel += 1) {
    if (maskGray[pixel] < 128) continue;
    protectedPixels += 1; let changed = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(beforeRgb[pixel * 3 + channel] - afterRgb[pixel * 3 + channel]);
      absoluteDelta += delta; if (delta > 2) changed = true;
    }
    if (changed) changedPixels += 1;
  }
  if (!protectedPixels) fail("protected mask is empty");
  const mae = absoluteDelta / (protectedPixels * 3); const changedPixelRatio = changedPixels / protectedPixels;
  if (!Number.isFinite(mae) || !Number.isFinite(changedPixelRatio)) fail("protected comparison metrics must be finite");
  return { mae, changedPixelRatio, protectedPixels, width: before.width, height: before.height };
}

function expectedContract(expected) {
  if (!expected || !Number.isInteger(expected.width) || !Number.isInteger(expected.height)) fail("expected mask geometry is required");
  const minCoverage = expected.minCoverage ?? 0.01;
  const maxCoverage = expected.maxCoverage ?? 0.25;
  if (!(minCoverage >= 0 && maxCoverage <= 1 && minCoverage < maxCoverage)) fail("expected coverage bounds are invalid");
  if (!expected.allowedBounds || !expected.head || !expected.feet?.left || !expected.feet?.right) fail("expected Task 2 head, feet, and allowed bounds are required");
  return { ...expected, minCoverage, maxCoverage, boundsInsetPx: expected.boundsInsetPx ?? 8 };
}

const FOREGROUND_THRESHOLD = 128;
const LEAK_THRESHOLD = 4;
const MAX_LEAK_PIXEL_COUNT = 256;
const MAX_LEAK_ALPHA_MASS = 64;
const ZONE_RADIUS = 8;
const MIN_ZONE_PIXELS = 12;
const MIN_ZONE_FILL_RATIO = 0.04;
const MIN_ZONE_MEAN_OPACITY = 192;
function pixelSelected(value) { return value >= FOREGROUND_THRESHOLD; }
function leakSelected(value) { return value >= LEAK_THRESHOLD; }
function indexOf(width, x, y) { return y * width + x; }

function zoneFacts(pixels, labels, dominantLabel, width, height, point, radius = ZONE_RADIUS) {
  const left = Math.max(0, Math.floor(point.x - radius)); const right = Math.min(width - 1, Math.ceil(point.x + radius));
  const top = Math.max(0, Math.floor(point.y - radius)); const bottom = Math.min(height - 1, Math.ceil(point.y + radius));
  let count = 0; let opacity = 0; const area = (right - left + 1) * (bottom - top + 1);
  for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) {
    const index = indexOf(width, x, y);
    if (labels[index] === dominantLabel) { count += 1; opacity += pixels[index]; }
  }
  return { count, fillRatio: count / area, meanOpacity: count ? opacity / count : 0 };
}

function foregroundFacts(pixels, width, height) {
  let count = 0; let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!pixelSelected(pixels[indexOf(width, x, y)])) continue;
    count += 1; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { count, bounds: { minX, minY, maxX, maxY } };
}

function leakFacts(pixels, width, height, allowedBounds, inset) {
  const left = allowedBounds.x + inset; const top = allowedBounds.y + inset;
  const right = allowedBounds.x + allowedBounds.width - inset; const bottom = allowedBounds.y + allowedBounds.height - inset;
  let totalAlpha = 0; let outsideCount = 0; let outsideAlpha = 0; let edgeCount = 0; let edgeAlpha = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const value = pixels[indexOf(width, x, y)]; totalAlpha += value;
    if (!leakSelected(value)) continue;
    if (x < left || y < top || x > right || y > bottom) { outsideCount += 1; outsideAlpha += value; }
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) { edgeCount += 1; edgeAlpha += value; }
  }
  return { weightedCoverage: totalAlpha / (255 * pixels.length), outsideCount, outsideAlphaMass: outsideAlpha / 255, edgeCount, edgeAlphaMass: edgeAlpha / 255 };
}

function assertNoMeaningfulLeak(leaks) {
  if (leaks.outsideCount > MAX_LEAK_PIXEL_COUNT || leaks.outsideAlphaMass > MAX_LEAK_ALPHA_MASS) fail(`mask has meaningful low-alpha leak outside Task 2 permitted bounds: pixels=${leaks.outsideCount}, alpha mass=${leaks.outsideAlphaMass}`);
  if (leaks.edgeCount > MAX_LEAK_PIXEL_COUNT || leaks.edgeAlphaMass > MAX_LEAK_ALPHA_MASS) fail(`mask is cropped or leaking at a forbidden canvas edge: pixels=${leaks.edgeCount}, alpha mass=${leaks.edgeAlphaMass}`);
}

function componentFacts(pixels, width, height) {
  const labels = new Uint32Array(pixels.length); let largest = 0; let dominantLabel = 0; let label = 0;
  for (let start = 0; start < pixels.length; start += 1) {
    if (labels[start] || !pixelSelected(pixels[start])) continue;
    label += 1; const queue = [start]; labels[start] = label; let cursor = 0;
    while (cursor < queue.length) {
      const current = queue[cursor++]; const x = current % width; const y = Math.floor(current / width);
      const neighbors = [x > 0 ? current - 1 : -1, x + 1 < width ? current + 1 : -1, y > 0 ? current - width : -1, y + 1 < height ? current + width : -1];
      for (const neighbor of neighbors) if (neighbor >= 0 && !labels[neighbor] && pixelSelected(pixels[neighbor])) { labels[neighbor] = label; queue.push(neighbor); }
    }
    if (queue.length > largest) { largest = queue.length; dominantLabel = label; }
  }
  return { labels, largest, dominantLabel };
}

function assertDominantZone(pixels, components, width, height, point, label) {
  const facts = zoneFacts(pixels, components.labels, components.dominantLabel, width, height, point);
  if (facts.count < MIN_ZONE_PIXELS || facts.fillRatio < MIN_ZONE_FILL_RATIO || facts.meanOpacity < MIN_ZONE_MEAN_OPACITY) fail(`dominant component ${label} presence is not meaningful: count=${facts.count}, fill=${facts.fillRatio}, opacity=${facts.meanOpacity}`);
  return facts;
}

export function assertMaskArtifact(maskPath, expectedInput) {
  const expected = expectedContract(expectedInput);
  const probe = probeImage(maskPath);
  if (probe.codecName !== "png") fail(`mask codec must be png, got ${probe.codecName}`);
  if (probe.width !== expected.width || probe.height !== expected.height) fail(`mask geometry must be ${expected.width}x${expected.height}, got ${probe.width}x${probe.height}`);
  if (!/^gray/.test(probe.pixelFormat)) fail(`mask pixel format must be gray, got ${probe.pixelFormat}`);
  const pixels = rawPixels(probe.path, "gray");
  if (pixels.length !== expected.width * expected.height) fail("mask decoded byte length is invalid");
  const facts = foregroundFacts(pixels, expected.width, expected.height);
  const coverage = facts.count / pixels.length;
  if (coverage < expected.minCoverage || coverage > expected.maxCoverage) fail(`mask coverage must be between ${expected.minCoverage} and ${expected.maxCoverage}, got ${coverage}`);
  const leaks = leakFacts(pixels, expected.width, expected.height, expected.allowedBounds, expected.boundsInsetPx);
  if (leaks.weightedCoverage < expected.minCoverage || leaks.weightedCoverage > expected.maxCoverage) fail(`mask weighted alpha coverage must be between ${expected.minCoverage} and ${expected.maxCoverage}, got ${leaks.weightedCoverage}`);
  assertNoMeaningfulLeak(leaks);
  const b = expected.allowedBounds;
  const inset = expected.boundsInsetPx;
  if (facts.bounds.minX < b.x + inset || facts.bounds.minY < b.y + inset || facts.bounds.maxX > b.x + b.width - inset || facts.bounds.maxY > b.y + b.height - inset) fail(`mask foreground violates Task 2 permitted bounds with ${inset}px inset`);
  if (facts.bounds.minX === 0 || facts.bounds.minY === 0 || facts.bounds.maxX === expected.width - 1 || facts.bounds.maxY === expected.height - 1) fail("mask is cropped at a forbidden canvas edge");
  const components = componentFacts(pixels, expected.width, expected.height);
  const headZone = assertDominantZone(pixels, components, expected.width, expected.height, expected.head, "head");
  const leftFootZone = assertDominantZone(pixels, components, expected.width, expected.height, expected.feet.left, "left foot");
  const rightFootZone = assertDominantZone(pixels, components, expected.width, expected.height, expected.feet.right, "right foot");
  const largestComponentRatio = components.largest / facts.count;
  if (largestComponentRatio < (expected.minLargestComponentRatio ?? 0.85)) fail(`mask foreground connectivity is implausible: ${largestComponentRatio}`);
  return { ...probe, coverage, weightedCoverage: leaks.weightedCoverage, foregroundPixels: facts.count, bounds: facts.bounds, largestComponentRatio, leakMetrics: { threshold: LEAK_THRESHOLD, outsideCount: leaks.outsideCount, outsideAlphaMass: leaks.outsideAlphaMass, edgeCount: leaks.edgeCount, edgeAlphaMass: leaks.edgeAlphaMass }, zones: { head: headZone, leftFoot: leftFootZone, rightFoot: rightFootZone } };
}

export function assertAlphaArtifact(rgbaPath, maskPath, expectedInput) {
  const expected = expectedContract(expectedInput);
  const mask = assertMaskArtifact(maskPath, expected);
  const probe = probeImage(rgbaPath);
  if (probe.codecName !== "png") fail(`alpha image codec must be png, got ${probe.codecName}`);
  if (probe.width !== expected.width || probe.height !== expected.height) fail(`alpha image geometry must be ${expected.width}x${expected.height}, got ${probe.width}x${probe.height}`);
  if (!/^(?:rgba|bgra|argb|abgr|yuva|gbrap|ya)/.test(probe.pixelFormat)) fail(`alpha image must use an alpha-capable RGBA pixel format, got ${probe.pixelFormat}`);
  const rgba = rawPixels(probe.path, "rgba"); const gray = rawPixels(mask.path, "gray");
  if (rgba.length !== gray.length * 4) fail("alpha and mask decoded byte lengths do not match");
  let maxAlphaDelta = 0;
  for (let pixel = 0; pixel < gray.length; pixel += 1) {
    const delta = Math.abs(rgba[pixel * 4 + 3] - gray[pixel]); maxAlphaDelta = Math.max(maxAlphaDelta, delta);
    if (delta > 1) fail(`alpha/mask mismatch at pixel ${pixel}: delta ${delta}`);
  }
  return { ...probe, maxAlphaDelta };
}

function artifact(filePath) { const stats = statSync(filePath); return { path: path.resolve(filePath), size: stats.size, sha256: sha256File(filePath) }; }
function hashJson(value) { return createHash("sha256").update(`${JSON.stringify(value)}\n`).digest("hex"); }
function loadReport(reportPath) {
  let report;
  try { report = JSON.parse(readFileSync(reportPath, "utf8")); } catch { fail(`report is missing or malformed: ${reportPath}`); }
  assertRunInvariant(report, { isDecodable(filePath) { try { probeImage(filePath); return true; } catch { return false; } } });
  return report;
}

function normalizeObjectInfo(objectInfo) {
  const next = structuredClone(objectInfo);
  for (const node of Object.values(next)) for (const group of [node?.input?.required, node?.input?.optional]) for (const specification of Object.values(group ?? {})) {
    if (specification?.[0] === "COMBO" && Array.isArray(specification?.[1]?.options)) specification[0] = [...specification[1].options];
  }
  return next;
}

export function assertMatteWorkflowTopology(workflow) {
  const nodes = Object.entries(workflow ?? {});
  const byClass = (name) => nodes.filter(([, node]) => node?.class_type === name);
  const remove = byClass("RemoveBackground"); const invert = byClass("InvertMask"); const join = byClass("JoinImageWithAlpha"); const save = byClass("SaveImage");
  if (remove.length !== 1 || invert.length !== 1 || join.length !== 1 || save.length !== 1) fail("matte workflow requires exactly one RemoveBackground, InvertMask, JoinImageWithAlpha, and SaveImage");
  if (JSON.stringify(invert[0][1].inputs.mask) !== JSON.stringify([remove[0][0], 0])) fail("InvertMask must consume the RemoveBackground foreground mask");
  if (JSON.stringify(join[0][1].inputs.alpha) !== JSON.stringify([invert[0][0], 0])) fail("JoinImageWithAlpha must consume the inverted foreground mask");
  if (JSON.stringify(save[0][1].inputs.images) !== JSON.stringify([join[0][0], 0])) fail("SaveImage must consume the alpha-joined image");
  return true;
}

function publishCopy(source, destination) {
  if (existsSync(destination)) fail(`destination exists; refusing to overwrite: ${destination}`);
  copyFileSync(source, destination, constants.COPYFILE_EXCL);
}

function writeExclusiveJson(filePath, value) {
  const descriptor = openSync(filePath, "wx", 0o600);
  try { writeFileSync(descriptor, `${JSON.stringify(value)}\n`, "utf8"); } finally { closeSync(descriptor); }
}

async function acquireRunLock(reportPath, timeoutMs = 5000) {
  const lockPath = `${reportPath}.generation.lock`; const deadline = Date.now() + timeoutMs;
  while (true) {
    try { return { descriptor: openSync(lockPath, "wx", 0o600), lockPath }; }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) fail("run-wide generation lock timed out before queue");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

export async function extractMatte(args = {}) {
  const reportPath = path.resolve(args.reportPath ?? ""); const character = args.character; const candidate = Number(args.candidate);
  if (!CHARACTERS.has(character)) fail("character must be shen_yan or jiang_lan");
  if (!CANDIDATES.has(candidate)) fail("candidate must be 1, 2, or 3");
  const report = loadReport(reportPath); const id = `candidate_${String(candidate).padStart(3, "0")}`;
  const source = report.stages[character].candidates.find((item) => item.id === id);
  if (!source || source.state !== "accepted" || source.creativeAcceptance !== "accepted" || source.review?.decision !== "accepted") fail(`${character} ${id} must be creatively accepted before matte extraction`);
  const sourceProbe = probeImage(source.artifact.path);
  if (sourceProbe.codecName !== "png" || sourceProbe.width !== 1152 || sourceProbe.height !== 640) fail("accepted character artifact must be a real 1152x640 PNG");
  if (statSync(source.artifact.path).size !== source.artifact.size || sha256File(source.artifact.path) !== source.artifact.sha256) fail("accepted character artifact does not match its frozen hash");
  const layout = args.layout ?? createRiverLayout(); assertLayout(layout);
  const expected = { width: 1152, height: 640, minCoverage: 0.01, maxCoverage: 0.25, ...layout.people[character] };
  const stage = `${character}_matte`; const stageRoot = path.join(path.dirname(reportPath), stage); const directory = path.join(stageRoot, id);
  const lockPath = path.join(stageRoot, `.${id}.lock`); const queuedPath = path.join(stageRoot, `.${id}.queued`);
  if (report.stages[stage].candidates.some((item) => item.id === id) || existsSync(directory) || existsSync(queuedPath)) fail(`${stage} ${id} exists or was already queued`);
  const presetPath = args.presetPath ? path.resolve(args.presetPath) : fileURLToPath(PRESET);
  const presetBytes = readFileSync(presetPath); const presetSha256 = createHash("sha256").update(presetBytes).digest("hex");
  const preset = JSON.parse(presetBytes.toString("utf8"));
  const adapter = args.adapter ?? createComfyAdapter({ baseUrl: args.baseUrl ?? process.env.COMFYUI_URL ?? "http://127.0.0.1:8188" });
  const objectInfo = normalizeObjectInfo(await adapter.objectInfo());
  const prefix = `${stage}/${id}/transparent`;
  const placeholderWorkflow = compileWorkflow(preset, { INPUT_IMAGE: "input.png", FILENAME_PREFIX: prefix });
  assertWorkflowObjectInfo(placeholderWorkflow, objectInfo); assertMatteWorkflowTopology(placeholderWorkflow);
  mkdirSync(stageRoot, { recursive: true });
  let lock;
  try { lock = openSync(lockPath, "wx", 0o600); } catch (error) { if (error?.code === "EEXIST") fail(`${stage} ${id} is already reserved`); throw error; }
  const attemptDirectory = path.join(stageRoot, "attempts", id, `${Date.now()}-${process.pid}-${randomUUID()}`);
  let queued; let runLock; let attempt = { stage, candidateId: id, status: "reserved", createdAt: Date.now() };
  mkdirSync(attemptDirectory, { recursive: true }); const journalPath = path.join(attemptDirectory, "attempt.json"); writeJsonAtomic(journalPath, attempt);
  try {
    if (existsSync(directory) || existsSync(queuedPath)) fail(`${stage} ${id} exists or was already queued`);
    runLock = await acquireRunLock(reportPath);
    const latestBeforeQueue = loadReport(reportPath);
    const latestSource = latestBeforeQueue.stages[character].candidates.find((item) => item.id === id);
    if (!latestSource || latestSource.state !== "accepted" || latestSource.artifact.sha256 !== source.artifact.sha256) fail("accepted character changed while waiting for the generation lock");
    if (latestBeforeQueue.stages[stage].candidates.some((item) => item.id === id) || existsSync(directory) || existsSync(queuedPath)) fail(`${stage} ${id} exists or was already queued`);
    const uploaded = await adapter.uploadImage({ filePath: source.artifact.path, role: `${character}_accepted_candidate`, subfolder: `layered-compositing/${stage}/${id}` });
    const workflow = compileWorkflow(preset, { INPUT_IMAGE: uploaded, FILENAME_PREFIX: prefix });
    assertWorkflowObjectInfo(workflow, objectInfo); assertMatteWorkflowTopology(workflow);
    const workflowSha256 = hashJson(workflow);
    queued = await adapter.queue(workflow, { onQueued: ({ promptId, queuedAt }) => {
      writeExclusiveJson(queuedPath, { promptId, queuedAt });
      args.afterQueuedMarker?.({ promptId, queuedAt, markerPath: queuedPath });
      attempt = { ...attempt, status: "queued", promptId, queuedAt, presetSha256, workflowSha256 }; writeJsonAtomic(journalPath, attempt);
    } });
    const captured = path.join(attemptDirectory, "transparent.png");
    await adapter.capture({ promptId: queued.promptId, outputNodeId: OUTPUT_NODE, filenamePrefix: "transparent", expectedSubfolder: `${stage}/${id}`, destination: captured, expectedGeometry: { width: 1152, height: 640 } });
    const extractedMask = path.join(attemptDirectory, "raw-mask.png");
    run("ffmpeg", ["-y", "-v", "error", "-i", captured, "-vf", "alphaextract,format=gray", "-frames:v", "1", extractedMask]);
    assertMaskArtifact(extractedMask, expected); assertAlphaArtifact(captured, extractedMask, expected);
    mkdirSync(directory, { recursive: false });
    const rawMaskPath = path.join(directory, "raw-mask.png"); const revisedMaskPath = path.join(directory, "revised-mask.png"); const transparentPath = path.join(directory, "transparent.png");
    publishCopy(extractedMask, rawMaskPath); publishCopy(extractedMask, revisedMaskPath); publishCopy(captured, transparentPath);
    const record = { id, artifact: artifact(transparentPath), character, sourceCandidateId: id, sourceArtifact: structuredClone(source.artifact), rawMask: artifact(rawMaskPath), revisedMask: artifact(revisedMaskPath), transparentPng: artifact(transparentPath), promptId: queued.promptId, workflowVersion: 1, presetSha256, workflowSha256, model: "birefnet.safetensors", technicalValidation: { mask: assertMaskArtifact(revisedMaskPath, expected), alpha: assertAlphaArtifact(transparentPath, revisedMaskPath, expected) } };
    const reportLockPath = `${reportPath}.lock`; let reportLock;
    try { reportLock = openSync(reportLockPath, "wx", 0o600); } catch (error) { fail(`run report lock unavailable: ${error.message}`); }
    let next;
    try { const latest = loadReport(reportPath); next = appendCandidate(latest, stage, record); writeJsonAtomic(reportPath, next); } finally { closeSync(reportLock); rmSync(reportLockPath, { force: true }); }
    attempt = { ...attempt, status: "completed", artifact: record.artifact }; writeJsonAtomic(journalPath, attempt);
    return { candidate: next.stages[stage].candidates.at(-1), report: next, reportPath };
  } catch (error) {
    if (!queued && error?.promptId) {
      queued = { promptId: error.promptId };
      if (!existsSync(queuedPath)) writeExclusiveJson(queuedPath, { promptId: error.promptId, queuedAt: Date.now() });
    }
    attempt = { ...attempt, status: queued ? "failed-postqueue" : "failed-prequeue", promptId: queued?.promptId, error: error.message }; writeJsonAtomic(journalPath, attempt);
    throw error;
  } finally {
    if (runLock) { closeSync(runLock.descriptor); rmSync(runLock.lockPath, { force: true }); }
    if (lock !== undefined) closeSync(lock); rmSync(lockPath, { force: true });
  }
}
