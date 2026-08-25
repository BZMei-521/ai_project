import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  bindShotWorkflow,
  createComfyHttpTransport,
  createFileJournal,
  discoverLiveInventory,
  inspectPng,
  preflightLocalTrial,
  runShotCandidate,
  selectConstrainedProfile,
  writePreflightReport
} from "./lib/e01-spatial-storyboard-local.mjs";

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  const options = { command };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) throw new Error(`unknown argument: ${token}`);
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${token}`);
    options[token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return options;
}

function requireOption(options, key) {
  const value = String(options[key] ?? "").trim();
  if (!value) throw new Error(`missing --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  return value;
}

function findCut(board, shotId) {
  for (const episode of board.episodes ?? []) {
    for (const segment of episode.segments ?? []) {
      const cut = (segment.cuts ?? []).find((item) => item.shotId === shotId);
      if (cut) return cut;
    }
  }
  throw new Error(`shot not found: ${shotId}`);
}

function deterministicSeed(shotId) {
  let value = 2166136261;
  for (const character of shotId) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
}

async function livePreflight(options) {
  const baseUrl = options.baseUrl ?? "http://127.0.0.1:8188";
  const inventory = await discoverLiveInventory({ baseUrl, repoRoot: process.cwd() });
  let selectedProfile;
  let gate;
  try {
    selectedProfile = selectConstrainedProfile(inventory);
    gate = preflightLocalTrial({
      queueRunning: inventory.queue.running,
      queuePending: inventory.queue.pending,
      freeVramBytes: inventory.system.vramFreeBytes,
      profile: selectedProfile
    });
  } catch (error) {
    const report = {
      ok: false,
      error: error?.code ?? (error instanceof Error ? error.message : String(error)),
      detail: error?.details ?? "",
      checkedAt: inventory.checkedAt,
      baseUrl,
      system: inventory.system,
      queue: inventory.queue,
      nodeCount: inventory.nodeCount,
      profiles: inventory.profiles.map(({ workflow, ...profile }) => profile),
      promptQueued: false
    };
    if (options.output) await writePreflightReport(options.output, report);
    const failure = new Error(report.error);
    failure.code = report.error;
    failure.report = report;
    throw failure;
  }
  const report = {
    ok: true,
    checkedAt: inventory.checkedAt,
    baseUrl,
    system: inventory.system,
    queue: inventory.queue,
    nodeCount: inventory.nodeCount,
    selectedProfile: { id: selectedProfile.id, loadFloorBytes: selectedProfile.loadFloorBytes, referenceRoles: selectedProfile.referenceRoles },
    gate,
    promptQueued: false
  };
  if (options.output) await writePreflightReport(options.output, report);
  return { report, selectedProfile };
}

async function runShot(options) {
  const shotId = requireOption(options, "shot");
  const storyboardPath = path.resolve(requireOption(options, "storyboard"));
  const controlsPath = path.resolve(requireOption(options, "controls"));
  const characterPath = path.resolve(requireOption(options, "character"));
  const outputPath = path.resolve(requireOption(options, "output"));
  const { selectedProfile } = await livePreflight(options);
  const [board, controlPack] = await Promise.all([
    readFile(storyboardPath, "utf8").then(JSON.parse),
    readFile(controlsPath, "utf8").then(JSON.parse)
  ]);
  await access(characterPath);
  if (controlPack.shotId !== shotId) throw new Error("control pack shot mismatch");
  const artifacts = Object.fromEntries((controlPack.artifacts ?? []).map((item) => [item.kind, item.filePath]));
  for (const kind of ["color", "depth", "normal", "character_id", "prop_id", "pose"]) {
    if (!artifacts[kind]) throw new Error(`control artifact missing: ${kind}`);
  }
  const cut = findCut(board, shotId);
  const transport = createComfyHttpTransport({ baseUrl: options.baseUrl ?? "http://127.0.0.1:8188" });
  const uploaded = {};
  for (const [role, filePath] of Object.entries({
    environment: artifacts.color,
    character: characterPath,
    depth: artifacts.depth,
    normal: artifacts.normal,
    character_id: artifacts.character_id,
    prop_id: artifacts.prop_id,
    pose: artifacts.pose
  })) uploaded[role] = await transport.uploadImage(filePath, `e01-spatial-storyboard/${shotId}`);
  const prompt = `${cut.frame}. ${cut.purpose}. ${cut.actionStateProjection?.mustShow?.join("; ") ?? ""}. Exactly five fingers on every visible hand, credible shoulder girdle and wrist structure, preserve the supplied character identity and spatial controls.`;
  const bound = bindShotWorkflow(selectedProfile, { shotId, prompt, seed: deterministicSeed(shotId), references: uploaded });
  const outputDir = path.dirname(outputPath);
  await mkdir(outputDir, { recursive: true });
  const journal = createFileJournal({
    attemptPath: path.join(outputDir, `${shotId}.attempt.json`),
    queuedPath: path.join(outputDir, `${shotId}.queued.json`),
    completedPath: path.join(outputDir, `${shotId}.completed.json`)
  });
  const completed = await runShotCandidate({ shotId, workflow: bound.workflow, journal, transport });
  const bytes = await transport.downloadOutput(completed);
  const png = inspectPng(bytes);
  if (png.width !== 1280 || png.height !== 720) throw new Error(`output dimensions mismatch: ${png.width}x${png.height}`);
  await writeFile(outputPath, bytes, { flag: "wx" });
  return { ok: true, shotId, outputPath, ...png, promptId: completed.promptId, outputNodeId: completed.outputNodeId, subfolder: completed.subfolder };
}

async function repairShot(options) {
  const allowed = new Set(["identity", "hand_anatomy", "shoulder_girdle", "spatial_structure", "prop_count", "shot_semantics"]);
  const shotId = requireOption(options, "shot");
  const reason = requireOption(options, "reason");
  const attempt = Number(requireOption(options, "attempt"));
  if (!allowed.has(reason)) throw new Error(`unsupported repair reason: ${reason}`);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 2) throw new Error("repair attempt must be 1 or 2");
  const outputRoot = path.resolve(requireOption(options, "outputRoot"));
  const report = { shotId, reason, attempt, immutable: ["camera", "beat", "boundary", "identity_reference", "prop_count"], createdAt: new Date().toISOString() };
  const reportPath = path.join(outputRoot, "rejected", shotId, `attempt-${attempt}.repair.json`);
  await writePreflightReport(reportPath, report);
  return { ok: true, reportPath };
}

try {
  const options = parseArgs(process.argv.slice(2));
  let result;
  if (options.command === "preflight") result = (await livePreflight(options)).report;
  else if (options.command === "run-shot") result = await runShot(options);
  else if (options.command === "repair-shot") result = await repairShot(options);
  else throw new Error(`unknown command: ${options.command ?? ""}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const code = error?.code ?? (error instanceof Error ? error.message : String(error));
  const report = error?.report ?? { ok: false, error: code };
  process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = ["LOCAL_PROFILE_UNAVAILABLE", "COMFY_QUEUE_BUSY", "LOCAL_VRAM_UNSAFE"].includes(code) ? 4 : 1;
}
