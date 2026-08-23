import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appendCandidate, assertRunInvariant, sha256File, writeJsonAtomic } from "./lib/layered-compositing-run.mjs";
import { assertWorkflowObjectInfo, compileWorkflow, createComfyAdapter } from "./lib/layered-compositing-comfy.mjs";
import { compareProtectedRegion, probeImage } from "./lib/layered-compositing-media.mjs";
import { acquireReportMutationLock, releaseReportMutationLock, validateCurrentCompositeChain } from "./lib/layered-compositing-compose.mjs";
export { acquireReportMutationLock, releaseReportMutationLock } from "./lib/layered-compositing-compose.mjs";

const PRESET_PATH = fileURLToPath(new URL("../src/modules/comfy-pipeline/presets/layered-local-repair-qwen-v1.json", import.meta.url));
const OUTPUT_NODE = "20"; const WIDTH = 1152; const HEIGHT = 640;
export const REPAIR_PROMPT = "Picture 1 is the accepted deterministic composite and Picture 2 is its exact editable mask. Harmonize only hair and clothing outer edges, foot-stone contact, local occlusion and contact shadow, and weak river/sunset environmental spill. Preserve the exact faces, primary hairstyles, primary garments, key accessories, camera, geometry, character count, human-only identities, and background. Do not edit outside the editable mask.";
export const REPAIR_NEGATIVE = "No changed face, skin contour, primary hair mass, primary garment, accessory, camera, geometry, character count, species, human identity, or background; no unmasked edit.";
const SEEDS = Object.freeze([90261001, 90261002, 90261003]);

function fail(message) { throw new Error(`Layered local repair invariant: ${message}`); }
function run(command, args, options = {}) { const result = spawnSync(command, args, { windowsHide: true, maxBuffer: 128 * 1024 * 1024, ...options }); if (result.error) fail(`${command} could not run: ${result.error.message}`); if (result.status !== 0) fail(`${command} failed: ${String(result.stderr || result.stdout).trim()}`); return result.stdout; }
function raw(filePath, format) { return run("ffmpeg", ["-v", "error", "-i", filePath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", format, "pipe:1"], { encoding: null }); }
function artifact(filePath) { const stats = statSync(filePath); return { path: path.resolve(filePath), size: stats.size, sha256: sha256File(filePath) }; }
function exact(record, label, { gray = false } = {}) { if (!record?.path || !Number.isInteger(record.size) || !/^[a-f0-9]{64}$/i.test(record.sha256 ?? "")) fail(`${label} record is invalid`); const resolved = path.resolve(record.path); if (!existsSync(resolved) || statSync(resolved).size !== record.size || sha256File(resolved) !== record.sha256.toLowerCase()) fail(`${label} frozen bytes changed`); const probe = probeImage(resolved); if (probe.codecName !== "png" || probe.width !== WIDTH || probe.height !== HEIGHT || (gray && !/^gray/.test(probe.pixelFormat))) fail(`${label} must be a real ${gray ? "grayscale " : ""}${WIDTH}x${HEIGHT} PNG`); return { ...structuredClone(record), path: resolved }; }
function accepted(report, stage) { const values = report.stages[stage].candidates.filter((value) => value.state === "accepted" && value.creativeAcceptance === "accepted" && !value.invalidations?.length); if (values.length !== 1) fail(`${stage} requires exactly one accepted candidate`); return values[0]; }
function currentComposite(report, reportPath) { const value = accepted(report, "composite"); validateCurrentCompositeChain(report, value, { reportPath }); return { candidate: value, source: exact(value.unrepairedComposite ?? value.artifact, "accepted deterministic composite"), editable: exact(value.editableMask, "editable mask", { gray: true }), protected: exact(value.protectedMask, "protected mask", { gray: true }) }; }
function loadPendingReport(reportPath) { let report; try { report = JSON.parse(readFileSync(reportPath, "utf8")); } catch { fail("report is missing or malformed"); } assertRunInvariant(report); return report; }
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function hashJson(value) { return createHash("sha256").update(`${stable(value)}\n`).digest("hex"); }
function writeExclusiveJson(filePath, value) { const fd = openSync(filePath, "wx", 0o600); try { writeFileSync(fd, `${JSON.stringify(value)}\n`); } finally { closeSync(fd); } }
async function acquire(filePath, timeoutMs = 5000) { const deadline = Date.now() + timeoutMs; while (true) { try { return openSync(filePath, "wx", 0o600); } catch (error) { if (error?.code !== "EEXIST") throw error; if (Date.now() >= deadline) fail("run-wide repair lock timed out before queue"); await new Promise((resolve) => setTimeout(resolve, 10)); } } }
export function mergeEditableMask({ sourcePath, repairPath, editableMaskPath, outputPath, differencePath }) {
  for (const [file, label] of [[sourcePath, "source"], [repairPath, "repair"], [editableMaskPath, "editable mask"]]) { const p = probeImage(file); if (p.codecName !== "png" || p.width !== WIDTH || p.height !== HEIGHT || (label === "editable mask" && !/^gray/.test(p.pixelFormat))) fail(`${label} must be a real ${WIDTH}x${HEIGHT} PNG`); }
  if (existsSync(outputPath) || existsSync(differencePath)) fail("repair destination exists; refusing overwrite");
  const source = raw(sourcePath, "rgb24"); const repair = raw(repairPath, "rgb24"); const mask = raw(editableMaskPath, "gray"); const merged = Buffer.alloc(source.length); const difference = Buffer.alloc(source.length);
  if (source.length !== repair.length || source.length !== mask.length * 3) fail("masked merge decoded lengths do not match");
  for (let pixel = 0; pixel < mask.length; pixel += 1) for (let channel = 0; channel < 3; channel += 1) { const offset = pixel * 3 + channel; merged[offset] = Math.round((source[offset] * (255 - mask[pixel]) + repair[offset] * mask[pixel]) / 255); difference[offset] = Math.abs(merged[offset] - source[offset]); }
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const encode = (bytes, target) => run("ffmpeg", ["-y", "-v", "error", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", `${WIDTH}x${HEIGHT}`, "-i", "pipe:0", "-frames:v", "1", "-threads", "1", "-c:v", "png", target], { input: bytes });
  encode(merged, outputPath); encode(difference, differencePath);
  const check = raw(outputPath, "rgb24"); for (let pixel = 0; pixel < mask.length; pixel += 1) if (mask[pixel] === 0) for (let channel = 0; channel < 3; channel += 1) if (check[pixel * 3 + channel] !== source[pixel * 3 + channel]) fail(`masked merge changed outside-editable RGB at pixel ${pixel}`);
  return { finalImage: artifact(outputPath), differenceImage: artifact(differencePath) };
}

function baselineThreshold(sourcePath, protectedPath, calibrationPath) { try { run("ffmpeg", ["-y", "-v", "error", "-i", sourcePath, "-frames:v", "1", "-threads", "1", "-c:v", "png", calibrationPath]); const metrics = compareProtectedRegion(sourcePath, calibrationPath, protectedPath); return { schemaVersion: 1, calibration: "png-encode-decode-raw-rgb-v1", maxProtectedMae: metrics.mae, maxProtectedChangedRatio: metrics.changedPixelRatio, changedChannelDelta: 2 }; } finally { rmSync(calibrationPath, { force: true }); } }
function hasAttemptsOrCandidates(report, stageRoot) { return report.stages.final.candidates.length > 0 || existsSync(path.join(stageRoot, "attempts")); }
function fileIdentity(filePath) { const stats = statSync(filePath); return { device: String(stats.dev), inode: String(stats.ino), birthtimeMs: stats.birthtimeMs }; }
function thresholdJournalRecords(stageRoot) {
  const attempts = path.join(stageRoot, "attempts"); if (!existsSync(attempts)) return [];
  const records = [];
  for (const candidate of readFileTree(attempts)) if (path.basename(candidate) === "attempt.json") { try { const value = JSON.parse(readFileSync(candidate, "utf8")); if (value.provenance?.threshold) records.push(value.provenance.threshold); if (value.candidate?.threshold) records.push(value.candidate.threshold); } catch { fail("repair attempt journal is malformed"); } }
  return records;
}
function readFileTree(root) { const output = []; for (const entry of readdirSync(root, { withFileTypes: true })) { const target = path.join(root, entry.name); if (entry.isDirectory()) output.push(...readFileTree(target)); else output.push(target); } return output; }
export function freezeRepairThreshold(reportPath, report, composite) {
  const stageRoot = path.join(path.dirname(reportPath), "final"); mkdirSync(stageRoot, { recursive: true }); const manifestPath = path.join(path.dirname(reportPath), "layered-repair-threshold.json"); const expected = baselineThreshold(composite.source.path, composite.protected.path, path.join(stageRoot, `.threshold-calibration-${process.pid}-${randomUUID()}.png`)); const bytes = Buffer.from(`${JSON.stringify(expected)}\n`);
  if (existsSync(manifestPath)) {
    const current = readFileSync(manifestPath); if (!current.equals(bytes)) fail("frozen repair threshold bytes changed");
    const manifest = { ...artifact(manifestPath), bytesSha256: createHash("sha256").update(current).digest("hex"), fileIdentity: fileIdentity(manifestPath) };
    for (const recorded of thresholdJournalRecords(stageRoot)) if (stable(recorded) !== stable(manifest)) fail("frozen repair threshold file was deleted, replaced, or changed after a repair attempt");
    for (const candidate of report.stages.final.candidates) if (stable(candidate.threshold) !== stable(manifest)) fail("frozen repair threshold does not match an existing final candidate");
    return { ...expected, manifest };
  }
  if (hasAttemptsOrCandidates(report, stageRoot)) fail("frozen repair threshold is missing after a repair attempt or candidate");
  const fd = openSync(manifestPath, "wx", 0o600); try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
  return { ...expected, manifest: { ...artifact(manifestPath), bytesSha256: createHash("sha256").update(bytes).digest("hex"), fileIdentity: fileIdentity(manifestPath) } };
}
function validateThreshold(reportPath, report, composite, frozen) { const current = freezeRepairThreshold(reportPath, report, composite); if (stable(current) !== stable(frozen)) fail("frozen repair threshold changed during repair"); return current; }
function modelSelections(workflow) { const output = {}; for (const node of Object.values(workflow)) for (const key of ["unet_name", "clip_name", "vae_name", "lora_name"]) if (node.inputs?.[key]) output[key] = node.inputs[key]; return output; }
function exactSamePrerequisites(current, recorded) { return stable({ source: current.source, editableMask: current.editable, protectedMask: current.protected, compositeCandidateId: current.candidate.id }) === stable({ source: recorded.source, editableMask: recorded.editableMask, protectedMask: recorded.protectedMask, compositeCandidateId: recorded.compositeCandidateId }); }
function queuedAttempt(stageRoot, id) {
  const candidateRoot = path.join(stageRoot, "attempts", id); if (!existsSync(candidateRoot)) return null;
  const matches = [];
  for (const filePath of readFileTree(candidateRoot).filter((value) => path.basename(value) === "attempt.json")) { let value; try { value = JSON.parse(readFileSync(filePath, "utf8")); } catch { fail("repair attempt journal is malformed"); } if (value.status === "queued" && value.promptId) matches.push({ journalPath: filePath, attemptDirectory: path.dirname(filePath), value }); }
  if (matches.length > 1) fail(`final ${id} has ambiguous queued recovery journals`); return matches[0] ?? null;
}
function recoverCompleted(reportPath, report, stageRoot, id, composite, threshold) {
  const candidateRoot = path.join(stageRoot, "attempts", id); if (!existsSync(candidateRoot)) return null;
  for (const filePath of readFileTree(candidateRoot).filter((value) => path.basename(value) === "attempt.json")) {
    let journal; try { journal = JSON.parse(readFileSync(filePath, "utf8")); } catch { fail("repair attempt journal is malformed"); }
    if (!["ready-to-publish", "published"].includes(journal.status) || !journal.candidate) continue;
    if (!exactSamePrerequisites(composite, journal.provenance) || stable(journal.provenance.threshold) !== stable(threshold.manifest) || stable(journal.candidate.threshold) !== stable(threshold.manifest)) fail("published repair recovery prerequisites or threshold are stale");
    for (const [record, label] of [[journal.candidate.finalImage, "recovery final image"], [journal.candidate.differenceImage, "recovery difference image"], [journal.candidate.rawRepair, "recovery raw repair"]]) exact(record, label);
    if (report.stages.final.candidates.some((value) => value.id === id)) fail(`final ${id} already exists`);
    const next = appendCandidate(report, "final", journal.candidate); writeJsonAtomic(reportPath, next); writeJsonAtomic(filePath, { ...journal, status: "completed" }); return { candidate: next.stages.final.candidates.at(-1), report: next, reportPath };
  }
  return null;
}

function completeCapturedRepair({ reportPath, composite, threshold, id, promptId, rawPath, attemptDirectory, journalPath, provenance, technical, args }) {
  const stageRoot = path.join(path.dirname(reportPath), "final"); const outputDirectory = path.join(stageRoot, id); const attemptOutput = path.join(attemptDirectory, "output"); mkdirSync(attemptOutput, { recursive: false });
  const temporaryFinal = path.join(attemptOutput, "final.png"); const temporaryDifference = path.join(attemptOutput, "difference.png"); const merged = mergeEditableMask({ sourcePath: composite.source.path, repairPath: rawPath, editableMaskPath: composite.editable.path, outputPath: temporaryFinal, differencePath: temporaryDifference }); const metrics = compareProtectedRegion(composite.source.path, temporaryFinal, composite.protected.path);
  if (metrics.mae > threshold.maxProtectedMae || metrics.changedPixelRatio > threshold.maxProtectedChangedRatio) fail("protected-region metrics exceed frozen threshold");
  const report = loadPendingReport(reportPath); const current = currentComposite(report, reportPath); validateThreshold(reportPath, report, current, threshold); if (!exactSamePrerequisites(current, provenance)) fail("repair prerequisites changed before append");
  const finalImage = { ...merged.finalImage, path: path.join(outputDirectory, "final.png") }; const differenceImage = { ...merged.differenceImage, path: path.join(outputDirectory, "difference.png") };
  const record = { id, artifact: structuredClone(finalImage), finalImage, differenceImage, rawRepair: artifact(rawPath), protectedMae: metrics.mae, protectedChangedRatio: metrics.changedPixelRatio, protectedMetrics: metrics, threshold: threshold.manifest, sourceComposite: composite.source, editableMask: composite.editable, protectedMask: composite.protected, compositeCandidateId: composite.candidate.id, ...technical, promptId };
  writeJsonAtomic(journalPath, { status: "ready-to-publish", stage: "final", candidateId: id, promptId, provenance, technical, candidate: record }); renameSync(attemptOutput, outputDirectory); args.afterArtifactDirectoryPublished?.({ journalPath, candidate: structuredClone(record), outputDirectory });
  writeJsonAtomic(journalPath, { status: "published", stage: "final", candidateId: id, promptId, provenance, technical, candidate: record }); args.afterPublishedJournal?.({ journalPath, candidate: structuredClone(record) });
  const next = appendCandidate(report, "final", record); writeJsonAtomic(reportPath, next); writeJsonAtomic(journalPath, { status: "completed", stage: "final", candidateId: id, promptId, provenance, technical, candidate: record }); return { candidate: next.stages.final.candidates.at(-1), report: next, reportPath };
}

export async function repairLocally(args = {}) {
  const reportPath = path.resolve(args.reportPath ?? ""); const candidate = Number(args.candidate); if (![1, 2, 3].includes(candidate)) fail("candidate must be 1, 2, or 3"); const id = `candidate_${String(candidate).padStart(3, "0")}`;
  const stageRoot = path.join(path.dirname(reportPath), "final"); mkdirSync(stageRoot, { recursive: true }); const lock = await acquireReportMutationLock(reportPath, { timeoutMs: args.lockTimeoutMs, processIdentityProvider: args.processIdentityProvider, purpose: `final-repair:${id}` }); let queued = null; let journalPath = null;
  try {
    let report = loadPendingReport(reportPath); const composite = currentComposite(report, reportPath); const threshold = freezeRepairThreshold(reportPath, report, composite); const outputDirectory = path.join(stageRoot, id); const queuedPath = path.join(stageRoot, `.${id}.queued`);
    if (report.stages.final.candidates.some((value) => value.id === id)) fail(`final ${id} already exists`);
    if (existsSync(outputDirectory)) { const recovered = recoverCompleted(reportPath, report, stageRoot, id, composite, threshold); if (recovered) return recovered; fail(`final ${id} output exists without validated published recovery journal`); }
    if (existsSync(queuedPath)) {
      const recovery = queuedAttempt(stageRoot, id); if (!recovery) fail(`final ${id} was queued and is burned`); if (!exactSamePrerequisites(composite, recovery.value.provenance) || stable(recovery.value.provenance.threshold) !== stable(threshold.manifest)) fail("queued repair recovery prerequisites or threshold are stale");
      const adapter = args.adapter ?? createComfyAdapter({ baseUrl: args.baseUrl ?? process.env.COMFYUI_URL ?? "http://127.0.0.1:8188" }); const rawPath = path.join(recovery.attemptDirectory, "raw-repair.png"); if (!existsSync(rawPath)) await adapter.capture({ promptId: recovery.value.promptId, outputNodeId: OUTPUT_NODE, filenamePrefix: "raw-repair", expectedSubfolder: `final/${id}`, destination: rawPath, expectedGeometry: { width: WIDTH, height: HEIGHT } }); else exact(artifact(rawPath), "recovered raw repair");
      return completeCapturedRepair({ reportPath, composite, threshold, id, promptId: recovery.value.promptId, rawPath, attemptDirectory: recovery.attemptDirectory, journalPath: recovery.journalPath, provenance: recovery.value.provenance, technical: recovery.value.technical, args });
    }
    const attemptDirectory = path.join(stageRoot, "attempts", id, `${Date.now()}-${process.pid}-${randomUUID()}`); mkdirSync(attemptDirectory, { recursive: true }); journalPath = path.join(attemptDirectory, "attempt.json");
    const provenance = { source: composite.source, editableMask: composite.editable, protectedMask: composite.protected, compositeCandidateId: composite.candidate.id, threshold: threshold.manifest };
    writeJsonAtomic(journalPath, { status: "reserved", stage: "final", candidateId: id, provenance });
    const presetPath = path.resolve(args.presetPath ?? PRESET_PATH); const presetBytes = readFileSync(presetPath); const preset = JSON.parse(presetBytes); const adapter = args.adapter ?? createComfyAdapter({ baseUrl: args.baseUrl ?? process.env.COMFYUI_URL ?? "http://127.0.0.1:8188" }); const objectInfo = await adapter.objectInfo();
    const prefix = `final/${id}/raw-repair`; const uploads = { SOURCE_IMAGE: await adapter.uploadImage({ filePath: composite.source.path, role: "accepted_composite", subfolder: `layered-compositing/final/${id}` }), EDITABLE_MASK: await adapter.uploadImage({ filePath: composite.editable.path, role: "frozen_editable_mask", subfolder: `layered-compositing/final/${id}` }) };
    report = loadPendingReport(reportPath); const latestComposite = currentComposite(report, reportPath); validateThreshold(reportPath, report, latestComposite, threshold); if (stable({ source: latestComposite.source, editable: latestComposite.editable, protected: latestComposite.protected, id: latestComposite.candidate.id }) !== stable({ source: composite.source, editable: composite.editable, protected: composite.protected, id: composite.candidate.id })) fail("repair prerequisites changed before queue");
    const workflow = compileWorkflow(preset, { ...uploads, PROMPT: REPAIR_PROMPT, SEED: SEEDS[candidate - 1], FILENAME_PREFIX: prefix }); assertWorkflowObjectInfo(workflow, objectInfo); const workflowSha256 = hashJson(workflow); const presetSha256 = createHash("sha256").update(presetBytes).digest("hex");
    const technical = { preset: { path: presetPath, sha256: presetSha256 }, workflowSha256, models: modelSelections(workflow), prompt: REPAIR_PROMPT, negativeConstraints: REPAIR_NEGATIVE, seed: SEEDS[candidate - 1] };
    queued = await adapter.queue(workflow, { onQueued: ({ promptId, queuedAt }) => { writeExclusiveJson(queuedPath, { promptId, queuedAt }); writeJsonAtomic(journalPath, { status: "queued", stage: "final", candidateId: id, promptId, queuedAt, provenance, technical }); args.afterQueuedMarker?.({ promptId, markerPath: queuedPath, journalPath }); } });
    const rawPath = path.join(attemptDirectory, "raw-repair.png"); await adapter.capture({ promptId: queued.promptId, outputNodeId: OUTPUT_NODE, filenamePrefix: "raw-repair", expectedSubfolder: `final/${id}`, destination: rawPath, expectedGeometry: { width: WIDTH, height: HEIGHT } });
    return completeCapturedRepair({ reportPath, composite, threshold, id, promptId: queued.promptId, rawPath, attemptDirectory, journalPath, provenance, technical, args });
  } catch (error) { if (!queued && error?.promptId) queued = { promptId: error.promptId }; throw error; }
  finally { releaseReportMutationLock(lock); }
}

function usage() { throw new Error("usage: --candidate 1|2|3 --report PATH"); }
export function parseArguments(args) { if (args.length !== 4) usage(); const values = new Map(); for (let i = 0; i < args.length; i += 2) { if (!["--candidate", "--report"].includes(args[i]) || !args[i + 1] || values.has(args[i])) usage(); values.set(args[i], args[i + 1]); } if (!/^[123]$/.test(values.get("--candidate") ?? "") || !values.has("--report")) usage(); return { candidate: Number(values.get("--candidate")), reportPath: path.resolve(values.get("--report")) }; }
async function main() { const result = await repairLocally(parseArguments(process.argv.slice(2))); process.stdout.write(`${JSON.stringify({ reportPath: result.reportPath, candidate: result.candidate }, null, 2)}\n`); }
if ((process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "") === import.meta.url) main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
