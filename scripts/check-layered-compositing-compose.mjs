import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendCandidate,
  createRunReport,
  reviewCandidate,
  sha256File,
  writeJsonAtomic,
} from "./lib/layered-compositing-run.mjs";
import { createRiverLayout } from "./lib/layered-compositing-layout.mjs";
import { probeImage } from "./lib/layered-compositing-media.mjs";
import {
  assertMaskDisjoint,
  buildCompositeFilter,
  buildEditableMask,
  composeDeterministically,
  parseLinuxProcessStatStartIdentity,
  validateCurrentCompositeChain,
} from "./lib/layered-compositing-compose.mjs";
import { parseArguments } from "./run-layered-compose.mjs";

const WIDTH = 1152;
const HEIGHT = 640;
const PIXELS = WIDTH * HEIGHT;
const LIGHTING = Object.freeze({
  environmentRgb: [196, 126, 78],
  spillOpacity: 0.035,
  shadowOpacity: 0.18,
  shadowOffsetX: -14,
  shadowOffsetY: 7,
  shadowBlurRadius: 5,
});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed: ${String(result.stderr || result.stdout)}`);
  return result.stdout;
}

function child(commandArgs, options = {}) {
  const processHandle = spawn(process.execPath, commandArgs, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...options });
  let stdout = ""; let stderr = "";
  processHandle.stdout?.on("data", (chunk) => { stdout += chunk; }); processHandle.stderr?.on("data", (chunk) => { stderr += chunk; });
  processHandle.result = new Promise((resolve, reject) => { processHandle.once("error", reject); processHandle.once("exit", (code) => resolve({ code, stdout, stderr })); });
  return processHandle;
}

function queueEntryName(owner) {
  return `${owner.pid}~${owner.createdAt}~${owner.nonce}~${encodeURIComponent(owner.processStartIdentity)}~${encodeURIComponent(owner.purpose)}.queue-entry`;
}

function writeQueueEntry(queueDirectory, owner, number = 1) {
  mkdirSync(queueDirectory, { recursive: true });
  const entryPath = path.join(queueDirectory, queueEntryName(owner)); mkdirSync(entryPath, { recursive: false });
  writeFileSync(path.join(entryPath, `number-${String(number).padStart(16, "0")}`), "\n", { flag: "wx" });
  return entryPath;
}

async function childResult(processHandle) {
  return processHandle.result;
}

async function waitForPath(filePath, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(filePath)) {
    if (Date.now() >= deadline) assert.fail(`timed out waiting for ${filePath}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForCondition(predicate, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForPathOrTimeout(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(filePath) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  return existsSync(filePath);
}

function encodeRaw(raw, pixelFormat, outputPath) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  run("ffmpeg", [
    "-y", "-v", "error", "-f", "rawvideo", "-pixel_format", pixelFormat,
    "-video_size", `${WIDTH}x${HEIGHT}`, "-i", "pipe:0", "-frames:v", "1",
    "-threads", "1", "-c:v", "png", outputPath,
  ], { input: raw });
  return outputPath;
}

function decodeRaw(filePath, pixelFormat = "gray") {
  return run("ffmpeg", [
    "-v", "error", "-i", filePath, "-frames:v", "1", "-f", "rawvideo",
    "-pix_fmt", pixelFormat, "pipe:1",
  ], { encoding: null });
}

function fillCircle(buffer, cx, cy, radius, value) {
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(HEIGHT - 1, Math.ceil(cy + radius)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(WIDTH - 1, Math.ceil(cx + radius)); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) buffer[y * WIDTH + x] = value;
    }
  }
}

function fillRect(buffer, left, top, right, bottom, value) {
  for (let y = Math.max(0, top); y <= Math.min(HEIGHT - 1, bottom); y += 1) {
    buffer.fill(value, y * WIDTH + Math.max(0, left), y * WIDTH + Math.min(WIDTH, right + 1));
  }
}

function thickLine(buffer, from, to, radius, value) {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  for (let step = 0; step <= steps; step += 1) {
    const t = steps ? step / steps : 0;
    fillCircle(buffer, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, radius, value);
  }
}

function personMask(character, mutation = {}) {
  const mask = Buffer.alloc(PIXELS);
  if (character === "shen_yan") {
    fillCircle(mask, 496, 118, 14, 255);
    thickLine(mask, { x: 496, y: 125 }, { x: 472, y: 180 }, 16, 255);
    fillRect(mask, 438, 165, 510, 355, 255);
    thickLine(mask, { x: 457, y: 340 }, mutation.leftFoot ?? { x: 505, y: 547 }, 9, 255);
    thickLine(mask, { x: 486, y: 340 }, mutation.rightFoot ?? { x: 415, y: 551 }, 9, 255);
  } else {
    fillCircle(mask, 690, 151, 14, 255);
    thickLine(mask, { x: 690, y: 160 }, { x: 715, y: 212 }, 15, 255);
    fillRect(mask, 680, 200, 748, 390, 255);
    thickLine(mask, { x: 700, y: 378 }, mutation.leftFoot ?? { x: 735, y: 555 }, 9, 255);
    thickLine(mask, { x: 727, y: 378 }, mutation.rightFoot ?? { x: 710, y: 555 }, 9, 255);
  }
  if (mutation.overlapBox) fillRect(mask, ...mutation.overlapBox, 255);
  if (mutation.lowAlphaBox) fillRect(mask, ...mutation.lowAlphaBox, mutation.lowAlphaValue ?? 12);
  return mask;
}

function rgbaFromMask(mask, rgb) {
  const rgba = Buffer.alloc(PIXELS * 4);
  for (let index = 0; index < PIXELS; index += 1) {
    rgba[index * 4] = rgb[0]; rgba[index * 4 + 1] = rgb[1]; rgba[index * 4 + 2] = rgb[2]; rgba[index * 4 + 3] = mask[index];
  }
  return rgba;
}

function resource(filePath) {
  return { path: path.resolve(filePath), size: statSync(filePath).size, sha256: sha256File(filePath) };
}

function centroid(pixels, predicate = (value) => value > 0) {
  let count = 0; let xTotal = 0; let yTotal = 0;
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    if (!predicate(pixels[y * WIDTH + x])) continue;
    count += 1; xTotal += x; yTotal += y;
  }
  assert.ok(count > 0, "centroid requires nonempty pixels");
  return { x: xTotal / count, y: yTotal / count, count };
}

function pixel(rgba, x, y) { return [...rgba.subarray((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4)]; }

function accepted(report, stage, id, artifact) {
  const technical = appendCandidate(report, stage, { id, artifact });
  return reviewCandidate(technical, stage, id, { decision: "accepted", note: `${stage} approved`, evidence: artifact }, { isDecodable: (filePath) => { try { probeImage(filePath); return true; } catch { return false; } } });
}

function reviewedProtectionContract() {
  return {
    schemaVersion: 1,
    review: { reviewer: "identity-art-review", note: "Approved identity regions and named key costume accessories for Shen Yan and Jiang Lan." },
    characters: {
      shen_yan: {
        faceRegion: { kind: "ellipse", cx: 0.677, cy: 0.045, rx: 0.112, ry: 0.043 },
        primaryHairRegion: { kind: "ellipse", cx: 0.677, cy: 0.045, rx: 0.137, ry: 0.04 },
        bodyCostumeProtection: { strategy: "eroded-matte", erosionPx: 4, minCoverageRatio: 0.25 },
        accessoryBoxes: [{ name: "Shen Yan jade waist clasp", x: 0.472, y: 0.303, width: 0.1, height: 0.043, note: "Reviewed key costume clasp." }],
      },
      jiang_lan: {
        faceRegion: { kind: "ellipse", cx: 0.316, cy: 0.05, rx: 0.12, ry: 0.045 },
        primaryHairRegion: { kind: "ellipse", cx: 0.316, cy: 0.05, rx: 0.16, ry: 0.045 },
        bodyCostumeProtection: { strategy: "eroded-matte", erosionPx: 4, minCoverageRatio: 0.25 },
        accessoryBoxes: [{ name: "Jiang Lan blue sash ornament", x: 0.422, y: 0.3, width: 0.125, height: 0.05, note: "Reviewed key costume ornament." }],
      },
    },
  };
}

function makeFixture(root, options = {}) {
  const layout = createRiverLayout();
  const backgroundRaw = Buffer.alloc(PIXELS * 4);
  for (let index = 0; index < PIXELS; index += 1) {
    backgroundRaw[index * 4] = 35; backgroundRaw[index * 4 + 1] = 55; backgroundRaw[index * 4 + 2] = 75; backgroundRaw[index * 4 + 3] = 255;
  }
  const backgroundPath = encodeRaw(backgroundRaw, "rgba", path.join(root, "background.png"));
  const shenMask = personMask("shen_yan", options.shenMutation);
  const jiangMask = personMask("jiang_lan", options.jiangMutation);
  const shenMaskPath = encodeRaw(shenMask, "gray", path.join(root, "shen-mask.png"));
  const jiangMaskPath = encodeRaw(jiangMask, "gray", path.join(root, "jiang-mask.png"));
  const shenPath = encodeRaw(rgbaFromMask(shenMask, [220, 40, 40]), "rgba", path.join(root, "shen.png"));
  const jiangPath = encodeRaw(rgbaFromMask(jiangMask, [40, 80, 220]), "rgba", path.join(root, "jiang.png"));
  const plate = resource(backgroundPath); const shen = resource(shenPath); const jiang = resource(jiangPath);
  const shenMatte = resource(shenMaskPath); const jiangMatte = resource(jiangMaskPath);
  const inputs = {
    emptyPlate: plate,
    layerOrder: ["shen_yan", "jiang_lan"],
    shen_yan: { identity: "shen_yan", transparentPng: shen, matte: shenMatte },
    jiang_lan: { identity: "jiang_lan", transparentPng: jiang, matte: jiangMatte },
  };

  let report = createRunReport({
    source: { ...plate, width: WIDTH, height: HEIGHT },
    characters: {
      shen_yan: { name: "Shen Yan", species: "human", faceMaster: shen, bodyFront: shen, accessoryBoxes: [{ x: 463, y: 190, width: 12, height: 18 }] },
      jiang_lan: { name: "Jiang Lan", species: "human", faceMaster: jiang, bodyFront: jiang, accessoryBoxes: [{ x: 704, y: 215, width: 14, height: 16 }] },
    },
    lighting: { key: "warm sunset from screen-right/rear", fill: "soft fill from screen-left/front", shadow: "screen-left/front" },
  });
  report = accepted(report, "empty_plate", "candidate_001", plate);
  report = accepted(report, "shen_yan", "candidate_001", shen);
  report = accepted(report, "jiang_lan", "candidate_001", jiang);
  report = appendCandidate(report, "shen_yan_matte", { id: "candidate_001", artifact: shen, character: "shen_yan", sourceCandidateId: "candidate_001", sourceArtifact: shen, transparentPng: shen, revisedMask: shenMatte });
  report = appendCandidate(report, "jiang_lan_matte", { id: "candidate_001", artifact: jiang, character: "jiang_lan", sourceCandidateId: "candidate_001", sourceArtifact: jiang, transparentPng: jiang, revisedMask: jiangMatte });
  const reportPath = path.join(root, "run-report.json"); writeJsonAtomic(reportPath, report);
  const protectionContract = reviewedProtectionContract(); const protectionContractPath = path.join(root, "reviewed-protection-contract.json");
  writeFileSync(protectionContractPath, `${JSON.stringify(protectionContract, null, 2)}\n`);
  return { layout, inputs, report, reportPath, protectionContract, protectionContractPath, paths: { backgroundPath, shenPath, jiangPath, shenMaskPath, jiangMaskPath } };
}

function renderAdjacentSpillOracle(root, layout) {
  const background = Buffer.alloc(PIXELS * 4); const shenMask = Buffer.alloc(PIXELS); const jiangMask = Buffer.alloc(PIXELS);
  for (let index = 0; index < PIXELS; index += 1) { background[index * 4] = 35; background[index * 4 + 1] = 55; background[index * 4 + 2] = 75; background[index * 4 + 3] = 255; }
  fillRect(shenMask, 560, 240, 575, 280, 255); fillRect(jiangMask, 576, 240, 591, 280, 255);
  const plate = encodeRaw(background, "rgba", path.join(root, "plate.png")); const shen = encodeRaw(rgbaFromMask(shenMask, [220, 40, 40]), "rgba", path.join(root, "shen.png")); const jiang = encodeRaw(rgbaFromMask(jiangMask, [40, 80, 220]), "rgba", path.join(root, "jiang.png"));
  const shenMatte = encodeRaw(shenMask, "gray", path.join(root, "shen-matte.png")); const jiangMatte = encodeRaw(jiangMask, "gray", path.join(root, "jiang-matte.png")); const output = path.join(root, "adjacent.png");
  const inputs = { emptyPlate: resource(plate), layerOrder: ["shen_yan", "jiang_lan"], shen_yan: { identity: "shen_yan", transparentPng: resource(shen), matte: resource(shenMatte) }, jiang_lan: { identity: "jiang_lan", transparentPng: resource(jiang), matte: resource(jiangMatte) } };
  run("ffmpeg", ["-y", "-v", "error", "-i", plate, "-i", shen, "-i", jiang, "-i", shenMatte, "-i", jiangMatte, "-filter_complex", buildCompositeFilter(inputs, layout, LIGHTING), "-map", "[composite]", "-frames:v", "1", "-threads", "1", "-c:v", "png", output]);
  return decodeRaw(output, "rgba");
}

const root = mkdtempSync(path.join(os.tmpdir(), "layered-compose-check-"));
try {
  if (process.env.LAYERED_COMPOSE_CHILD === "review-unrelated") {
    const { reviewLayeredCandidate } = await import("./review-layered-compositing.mjs");
    await reviewLayeredCandidate({ reportPath: process.env.LAYERED_REPORT_PATH, stage: "empty_plate", candidate: "candidate_002", decision: "rejected", note: "concurrent unrelated alternate plate rejection", async afterSnapshot() { writeFileSync(process.env.LAYERED_REVIEW_READY_PATH, "ready\n", { flag: "wx" }); await waitForPath(process.env.LAYERED_REVIEW_RELEASE_PATH, 10000); } });
    process.exit(0);
  }
  if (process.env.LAYERED_COMPOSE_CHILD === "crash") {
    await composeDeterministically({
      reportPath: process.env.LAYERED_REPORT_PATH,
      candidate: Number(process.env.LAYERED_CANDIDATE),
      lighting: LIGHTING,
      protectionContractPath: process.env.LAYERED_PROTECTION_PATH,
      afterArtifactDirectoryPublished() { process.exit(86); },
    });
    process.exit(87);
  }
  if (process.env.LAYERED_COMPOSE_CHILD === "crash-before-publication") {
    await composeDeterministically({
      reportPath: process.env.LAYERED_REPORT_PATH,
      candidate: Number(process.env.LAYERED_CANDIDATE),
      lighting: LIGHTING,
      protectionContractPath: process.env.LAYERED_PROTECTION_PATH,
      afterAttemptReserved() { process.exit(85); },
    });
    process.exit(87);
  }
  if (process.env.LAYERED_COMPOSE_CHILD === "crash-ready-before-rename") {
    await composeDeterministically({
      reportPath: process.env.LAYERED_REPORT_PATH,
      candidate: Number(process.env.LAYERED_CANDIDATE),
      lighting: LIGHTING,
      protectionContractPath: process.env.LAYERED_PROTECTION_PATH,
      afterReadyToPublishJournal() { process.exit(84); },
    });
    process.exit(87);
  }
  if (process.env.LAYERED_COMPOSE_CHILD === "compose") {
    let activeMarker;
    let scanHookRan = false;
    try {
      const result = await composeDeterministically({
        reportPath: process.env.LAYERED_REPORT_PATH,
        candidate: Number(process.env.LAYERED_CANDIDATE),
        lighting: LIGHTING,
        protectionContractPath: process.env.LAYERED_PROTECTION_PATH,
        lockTimeoutMs: 120000,
        ticketCreatedAt: process.env.LAYERED_TICKET_CREATED_AT ? Number(process.env.LAYERED_TICKET_CREATED_AT) : undefined,
        ticketNonce: process.env.LAYERED_TICKET_NONCE,
        afterRunLockAcquired: async () => {
          if (process.env.LAYERED_STARTED_PATH) writeFileSync(process.env.LAYERED_STARTED_PATH, `${Date.now()}\n`, { flag: "wx" });
          if (process.env.LAYERED_ACTIVITY_PATH) {
            mkdirSync(process.env.LAYERED_ACTIVITY_PATH, { recursive: true });
            activeMarker = path.join(process.env.LAYERED_ACTIVITY_PATH, `active-${process.pid}`);
            writeFileSync(activeMarker, "active\n", { flag: "wx" });
            const activeCount = readdirSync(process.env.LAYERED_ACTIVITY_PATH).filter((name) => name.startsWith("active-")).length;
            writeFileSync(path.join(process.env.LAYERED_ACTIVITY_PATH, `observed-${activeCount}-${process.pid}-${Date.now()}`), "\n", { flag: "wx" });
          }
          if (process.env.LAYERED_ACTIVE_RELEASE_PATH) await waitForPathOrTimeout(process.env.LAYERED_ACTIVE_RELEASE_PATH, 10000);
          if (process.env.LAYERED_HOLD_MS) await new Promise((resolve) => setTimeout(resolve, Number(process.env.LAYERED_HOLD_MS)));
        },
        afterNumberSelectionSnapshot: async ({ entryPaths, ticketPath }) => {
          if (process.env.LAYERED_SCAN_PHASE !== "selection" || scanHookRan || entryPaths.length < 2) return;
          scanHookRan = true; const predecessorPath = entryPaths.find((entryPath) => entryPath !== ticketPath); assert.ok(predecessorPath);
          writeFileSync(process.env.LAYERED_SCAN_HOOK_PATH, "selection\n", { flag: "wx" });
          writeFileSync(process.env.LAYERED_ACTIVE_RELEASE_PATH, "release\n", { flag: "wx" });
          await waitForCondition(() => !existsSync(predecessorPath), "selection-snapshot predecessor release");
        },
        afterAdmissionSnapshot: async ({ entryPaths, ticketPath }) => {
          if (process.env.LAYERED_SCAN_PHASE !== "admission" || scanHookRan || entryPaths.length < 2) return;
          scanHookRan = true; const predecessorPath = entryPaths.find((entryPath) => entryPath !== ticketPath); assert.ok(predecessorPath);
          writeFileSync(process.env.LAYERED_SCAN_HOOK_PATH, "admission\n", { flag: "wx" });
          writeFileSync(process.env.LAYERED_ACTIVE_RELEASE_PATH, "release\n", { flag: "wx" });
          await waitForCondition(() => !existsSync(predecessorPath), "admission-snapshot predecessor release");
        },
        afterTicketTemporaryFsynced: process.env.LAYERED_SAME_NUMBER_READY_DIRECTORY ? async ({ temporaryPath, owner }) => {
          mkdirSync(process.env.LAYERED_SAME_NUMBER_READY_DIRECTORY, { recursive: true });
          const readyPath = path.join(process.env.LAYERED_SAME_NUMBER_READY_DIRECTORY, `candidate_${String(process.env.LAYERED_CANDIDATE).padStart(3, "0")}.json`);
          writeFileSync(readyPath, `${JSON.stringify({ candidate: Number(process.env.LAYERED_CANDIDATE), pid: process.pid, processStartIdentity: owner.processStartIdentity, number: Number(readFileSync(temporaryPath, "utf8").trim()) })}\n`, { flag: "wx" });
          await waitForPath(process.env.LAYERED_SAME_NUMBER_RELEASE_PATH, 10000);
        } : undefined,
      });
      process.stdout.write(`${result.candidate.id}\n`);
      if (activeMarker) rmSync(activeMarker, { force: true });
      if (process.env.LAYERED_AFTER_COMPOSE_HOLD_MS) await new Promise((resolve) => setTimeout(resolve, Number(process.env.LAYERED_AFTER_COMPOSE_HOLD_MS)));
      process.exit(0);
    } finally {
      if (activeMarker) rmSync(activeMarker, { force: true });
    }
  }
  if (process.env.LAYERED_COMPOSE_CHILD === "observe-ticket-publication") {
    await composeDeterministically({
      reportPath: process.env.LAYERED_REPORT_PATH,
      candidate: Number(process.env.LAYERED_CANDIDATE),
      lighting: LIGHTING,
      protectionContractPath: process.env.LAYERED_PROTECTION_PATH,
      afterTicketTemporaryFsynced: async ({ queueDirectory, temporaryPath, ticketPath }) => {
        const visible = readdirSync(queueDirectory).filter((name) => name.endsWith(".queue-entry"));
        assert.equal(visible.length, 1, "single immutable queue entry must already be visible before number publication");
        assert.equal(existsSync(temporaryPath), true); assert.equal(ticketPath, path.join(queueDirectory, visible[0]));
        await new Promise((resolve) => setTimeout(resolve, 150));
      },
    });
    process.exit(0);
  }
  if (process.env.LAYERED_COMPOSE_CHILD === "crash-ticket-publication") {
    await composeDeterministically({
      reportPath: process.env.LAYERED_REPORT_PATH,
      candidate: Number(process.env.LAYERED_CANDIDATE),
      lighting: LIGHTING,
      protectionContractPath: process.env.LAYERED_PROTECTION_PATH,
      afterTicketTemporaryFsynced: ({ queueDirectory, temporaryPath }) => {
        assert.equal(path.basename(temporaryPath).endsWith(".tmp"), true);
        assert.equal(readdirSync(queueDirectory).filter((name) => name.endsWith(".queue-entry")).length, 1);
        process.exit(83);
      },
    });
    process.exit(87);
  }
  if (process.env.LAYERED_COMPOSE_CHILD === "ordered-compose") {
    const result = await composeDeterministically({
      reportPath: process.env.LAYERED_REPORT_PATH,
      candidate: Number(process.env.LAYERED_CANDIDATE),
      lighting: LIGHTING,
      protectionContractPath: process.env.LAYERED_PROTECTION_PATH,
      lockTimeoutMs: 120000,
      ticketCreatedAt: Number(process.env.LAYERED_TICKET_CREATED_AT),
      ticketNonce: process.env.LAYERED_TICKET_NONCE,
      afterRunLockAcquired: async () => {
        if (process.env.LAYERED_STARTED_PATH) writeFileSync(process.env.LAYERED_STARTED_PATH, `${Date.now()}\n`, { flag: "wx" });
        if (process.env.LAYERED_HOLD_MS) await new Promise((resolve) => setTimeout(resolve, Number(process.env.LAYERED_HOLD_MS)));
      },
      afterTicketPublished: process.env.LAYERED_TICKET_PUBLISHED_PATH ? async () => {
        writeFileSync(process.env.LAYERED_TICKET_PUBLISHED_PATH, `${Date.now()}\n`, { flag: "wx" });
        if (process.env.LAYERED_AFTER_TICKET_HOLD_MS) await new Promise((resolve) => setTimeout(resolve, Number(process.env.LAYERED_AFTER_TICKET_HOLD_MS)));
      } : undefined,
    });
    process.stdout.write(`${result.candidate.id}\n`); process.exit(0);
  }
  if (process.env.LAYERED_COMPOSE_CHILD === "sequence-window") {
    let sequenceActiveMarker;
    await composeDeterministically({
      reportPath: process.env.LAYERED_REPORT_PATH,
      candidate: Number(process.env.LAYERED_CANDIDATE),
      lighting: LIGHTING,
      protectionContractPath: process.env.LAYERED_PROTECTION_PATH,
      lockTimeoutMs: 120000,
      ticketCreatedAt: process.env.LAYERED_TICKET_CREATED_AT ? Number(process.env.LAYERED_TICKET_CREATED_AT) : undefined,
      ticketNonce: process.env.LAYERED_TICKET_NONCE,
      afterRunLockAcquired: process.env.LAYERED_ACTIVITY_PATH ? async () => { mkdirSync(process.env.LAYERED_ACTIVITY_PATH, { recursive: true }); sequenceActiveMarker = path.join(process.env.LAYERED_ACTIVITY_PATH, `active-${process.pid}`); writeFileSync(sequenceActiveMarker, "active\n", { flag: "wx" }); const activeCount = readdirSync(process.env.LAYERED_ACTIVITY_PATH).filter((name) => name.startsWith("active-")).length; writeFileSync(path.join(process.env.LAYERED_ACTIVITY_PATH, `observed-${activeCount}-${process.pid}-${Date.now()}`), "\n", { flag: "wx" }); await new Promise((resolve) => setTimeout(resolve, 200)); } : undefined,
      afterSequenceReserved: async ({ sequencePath }) => {
        assert.match(path.basename(sequencePath), /\.queue-entry$/, "claim must be the one immutable self-describing queue-entry path");
        assert.equal(path.basename(sequencePath).startsWith(`${process.pid}~`), true);
        writeFileSync(process.env.LAYERED_SEQUENCE_RESERVED_PATH, "reserved\n", { flag: "wx" });
        if (process.env.LAYERED_CRASH_SEQUENCE === "1") process.exit(84);
        if (process.env.LAYERED_SEQUENCE_RELEASE_PATH) await waitForPath(process.env.LAYERED_SEQUENCE_RELEASE_PATH);
        else await new Promise((resolve) => setTimeout(resolve, 600));
      },
      afterTicketTemporaryFsynced: process.env.LAYERED_SEQUENCE_FACT_PATH ? ({ temporaryPath, owner }) => { writeFileSync(process.env.LAYERED_SEQUENCE_FACT_PATH, `${JSON.stringify({ candidate: Number(process.env.LAYERED_CANDIDATE), pid: process.pid, processStartIdentity: owner.processStartIdentity, number: Number(readFileSync(temporaryPath, "utf8").trim()) })}\n`, { flag: "wx" }); } : undefined,
    });
    if (sequenceActiveMarker) rmSync(sequenceActiveMarker, { force: true });
    process.exit(0);
  }
  const fixture = makeFixture(path.join(root, "fixture"));
  const linuxStat = "4242 (worker (frame scan)) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 987654321 20";
  assert.equal(parseLinuxProcessStatStartIdentity(linuxStat), "linux-starttime:987654321", "Linux stat parser must locate the final ')' before counting field 22");
  const linuxReuseProvider = async () => ({ alive: true, startIdentity: parseLinuxProcessStatStartIdentity(linuxStat.replace("987654321", "987654322")) });
  assert.equal((await linuxReuseProvider()).startIdentity === parseLinuxProcessStatStartIdentity(linuxStat), false, "Linux PID reuse detection must distinguish changed robustly parsed starttime");
  const ticketPublicationFixture = makeFixture(path.join(root, "ticket-publication"));
  const ticketPublicationChild = child([path.resolve(process.argv[1])], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "observe-ticket-publication", LAYERED_REPORT_PATH: ticketPublicationFixture.reportPath, LAYERED_CANDIDATE: "1", LAYERED_PROTECTION_PATH: ticketPublicationFixture.protectionContractPath } });
  const ticketPublicationResult = await childResult(ticketPublicationChild); assert.equal(ticketPublicationResult.code, 0, ticketPublicationResult.stderr);
  const ticketPublicationQueue = path.join(path.dirname(ticketPublicationFixture.reportPath), "composite", ".compose-run.queue");
  assert.equal(readdirSync(ticketPublicationQueue).some((name) => name.endsWith(".tmp") || name.endsWith(".queue-entry")), false, "published queue drain must not retain entry/temp files");
  const crashedTicketFixture = makeFixture(path.join(root, "crashed-ticket-publication")); const crashedTicketQueue = path.join(path.dirname(crashedTicketFixture.reportPath), "composite", ".compose-run.queue");
  const crashedTicketChild = child([path.resolve(process.argv[1])], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "crash-ticket-publication", LAYERED_REPORT_PATH: crashedTicketFixture.reportPath, LAYERED_CANDIDATE: "1", LAYERED_PROTECTION_PATH: crashedTicketFixture.protectionContractPath } });
  const crashedTicketResult = await childResult(crashedTicketChild); assert.equal(crashedTicketResult.code, 83, crashedTicketResult.stderr);
  const publicationOrphans = readdirSync(crashedTicketQueue); assert.equal(publicationOrphans.some((name) => name.endsWith(".queue-entry")), true, "real publication crash must leave one self-describing owner entry");
  const publicationCrashRecovered = await composeDeterministically({ reportPath: crashedTicketFixture.reportPath, candidate: 1, lighting: LIGHTING, protectionContractPath: crashedTicketFixture.protectionContractPath }); assert.equal(publicationCrashRecovered.candidate.id, "candidate_001");
  assert.equal(readdirSync(crashedTicketQueue).some((name) => name.endsWith(".tmp") || name.endsWith(".queue-entry")), false, "recovery must clean dead queue entry/temp without tombstones");
  const orderingFixture = makeFixture(path.join(root, "ticket-ordering")); const orderingStage = path.join(path.dirname(orderingFixture.reportPath), "composite"); const orderingQueue = path.join(orderingStage, ".compose-run.queue");
  const predecessorTicketPublished = path.join(root, "predecessor-ticket-published.txt"); const predecessorStarted = path.join(root, "predecessor-started.txt"); const successorStarted = path.join(root, "successor-started.txt");
  const predecessor = child([path.resolve(process.argv[1])], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "ordered-compose", LAYERED_REPORT_PATH: orderingFixture.reportPath, LAYERED_CANDIDATE: "1", LAYERED_PROTECTION_PATH: orderingFixture.protectionContractPath, LAYERED_TICKET_CREATED_AT: "2000", LAYERED_TICKET_NONCE: "ffffffff-ffff-ffff-ffff-ffffffffffff", LAYERED_TICKET_PUBLISHED_PATH: predecessorTicketPublished, LAYERED_AFTER_TICKET_HOLD_MS: "3000", LAYERED_STARTED_PATH: predecessorStarted, LAYERED_HOLD_MS: "500" } });
  await waitForPath(predecessorTicketPublished); await waitForPath(orderingQueue);
  const successor = child([path.resolve(process.argv[1])], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "ordered-compose", LAYERED_REPORT_PATH: orderingFixture.reportPath, LAYERED_CANDIDATE: "2", LAYERED_PROTECTION_PATH: orderingFixture.protectionContractPath, LAYERED_TICKET_CREATED_AT: "1000", LAYERED_TICKET_NONCE: "00000000-0000-0000-0000-000000000000", LAYERED_STARTED_PATH: successorStarted } });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(existsSync(successorStarted), false, "a later successor whose lexical token sorts earlier must not pass an active predecessor");
  assert.equal(readdirSync(orderingQueue).some((name) => name.endsWith(".queue-entry")), true, "arrival-safe predecessor entry must remain visible during rollback wait");
  const [predecessorResult, successorResult] = await Promise.all([childResult(predecessor), childResult(successor)]); assert.equal(predecessorResult.code, 0, predecessorResult.stderr); assert.equal(successorResult.code, 0, successorResult.stderr);
  assert.ok(Number(readFileSync(predecessorStarted, "utf8")) < Number(readFileSync(successorStarted, "utf8")), "predecessor must enter before rollback/lower-nonce successor");
  assert.equal(readdirSync(orderingQueue).some((name) => name.endsWith(".tmp") || name.endsWith(".queue-entry")), false, "successful drain must leave no queue entries/temps");
  const sequenceWindowFixture = makeFixture(path.join(root, "sequence-window")); const sequenceWindowStage = path.join(path.dirname(sequenceWindowFixture.reportPath), "composite"); const sequenceReserved = path.join(root, "sequence-reserved.txt"); const sequenceRelease = path.join(root, "sequence-release.txt"); const sequenceFactDirectory = path.join(root, "sequence-facts"); mkdirSync(sequenceFactDirectory, { recursive: true }); const sequencePredecessorFact = path.join(sequenceFactDirectory, "candidate_001.json"); const sequenceSuccessorFact = path.join(sequenceFactDirectory, "candidate_002.json"); const sequenceActivity = path.join(root, "sequence-activity");
  const sequencePredecessor = child([path.resolve(process.argv[1])], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "sequence-window", LAYERED_REPORT_PATH: sequenceWindowFixture.reportPath, LAYERED_CANDIDATE: "1", LAYERED_PROTECTION_PATH: sequenceWindowFixture.protectionContractPath, LAYERED_SEQUENCE_RESERVED_PATH: sequenceReserved, LAYERED_SEQUENCE_RELEASE_PATH: sequenceRelease, LAYERED_SEQUENCE_FACT_PATH: sequencePredecessorFact, LAYERED_ACTIVITY_PATH: sequenceActivity, LAYERED_TICKET_CREATED_AT: "2000", LAYERED_TICKET_NONCE: "ffffffff-ffff-ffff-ffff-ffffffffffff" } });
  await waitForPath(sequenceReserved);
  assert.equal(readdirSync(path.join(sequenceWindowStage, ".compose-run.queue")).some((name) => name.endsWith(".queue-entry")), true, "live claim must be scanner-visible before its number exists");
  const sequenceSuccessor = child([path.resolve(process.argv[1])], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "compose", LAYERED_REPORT_PATH: sequenceWindowFixture.reportPath, LAYERED_CANDIDATE: "2", LAYERED_PROTECTION_PATH: sequenceWindowFixture.protectionContractPath, LAYERED_TICKET_CREATED_AT: "1000", LAYERED_TICKET_NONCE: "00000000-0000-0000-0000-000000000000", LAYERED_SAME_NUMBER_READY_DIRECTORY: sequenceFactDirectory, LAYERED_SAME_NUMBER_RELEASE_PATH: sequenceRelease, LAYERED_ACTIVITY_PATH: sequenceActivity } });
  const sequenceQueue = path.join(sequenceWindowStage, ".compose-run.queue");
  const bothClaimsDeadline = Date.now() + 10000;
  while (readdirSync(sequenceQueue).filter((name) => name.endsWith(".queue-entry")).length < 2) { if (Date.now() >= bothClaimsDeadline) assert.fail("successor immutable queue entry did not become visible in the predecessor choosing window"); await new Promise((resolve) => setTimeout(resolve, 20)); }
  assert.equal(existsSync(path.join(sequenceWindowStage, "candidate_002")), false, "successor must wait behind a live post-sequence/pre-ticket reservation");
  await waitForPath(sequenceSuccessorFact); writeFileSync(sequenceRelease, "release\n", { flag: "wx" });
  const [sequencePredecessorResult, sequenceSuccessorResult] = await Promise.all([childResult(sequencePredecessor), childResult(sequenceSuccessor)]); assert.equal(sequencePredecessorResult.code, 0, sequencePredecessorResult.stderr); assert.equal(sequenceSuccessorResult.code, 0, sequenceSuccessorResult.stderr);
  const sequenceFacts = [JSON.parse(readFileSync(sequencePredecessorFact, "utf8")), JSON.parse(readFileSync(sequenceSuccessorFact, "utf8"))]; const expectedSequenceOrder = sequenceFacts.toSorted((left, right) => left.number - right.number || `${String(left.pid).padStart(12, "0")}\0${left.processStartIdentity}`.localeCompare(`${String(right.pid).padStart(12, "0")}\0${right.processStartIdentity}`)).map((fact) => `candidate_${String(fact.candidate).padStart(3, "0")}`); assert.deepEqual(JSON.parse(readFileSync(sequenceWindowFixture.reportPath, "utf8")).stages.composite.candidates.map((candidate) => candidate.id), expectedSequenceOrder, "post-choosing admission must follow actual bakery number then stable owner key"); assert.equal(readdirSync(sequenceActivity).some((name) => name.startsWith("observed-2-")), false, "choosing-window contenders must keep max active compose at one");

  const crashedSequenceFixture = makeFixture(path.join(root, "crashed-sequence-window")); const crashedSequenceReserved = path.join(root, "crashed-sequence-reserved.txt");
  const crashedSequence = child([path.resolve(process.argv[1])], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "sequence-window", LAYERED_REPORT_PATH: crashedSequenceFixture.reportPath, LAYERED_CANDIDATE: "1", LAYERED_PROTECTION_PATH: crashedSequenceFixture.protectionContractPath, LAYERED_SEQUENCE_RESERVED_PATH: crashedSequenceReserved, LAYERED_CRASH_SEQUENCE: "1" } });
  const crashedSequenceResult = await childResult(crashedSequence); assert.equal(crashedSequenceResult.code, 84, crashedSequenceResult.stderr);
  const afterSequenceCrash = await composeDeterministically({ reportPath: crashedSequenceFixture.reportPath, candidate: 1, lighting: LIGHTING, protectionContractPath: crashedSequenceFixture.protectionContractPath });
  assert.equal(afterSequenceCrash.candidate.id, "candidate_001", "dead sequence reservation must be pruned for a fresh append-only attempt");

  for (const scanPhase of ["selection", "admission"]) {
    const scanFixture = makeFixture(path.join(root, `vanished-${scanPhase}`)); const scanStage = path.join(path.dirname(scanFixture.reportPath), "composite"); const scanQueue = path.join(scanStage, ".compose-run.queue");
    const scanRelease = path.join(root, `${scanPhase}-release.txt`); const scanStarted = path.join(root, `${scanPhase}-started.txt`); const scanHook = path.join(root, `${scanPhase}-hook.txt`);
    const scanPredecessor = child([path.resolve(process.argv[1])], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "compose", LAYERED_REPORT_PATH: scanFixture.reportPath, LAYERED_CANDIDATE: "1", LAYERED_PROTECTION_PATH: scanFixture.protectionContractPath, LAYERED_STARTED_PATH: scanStarted, LAYERED_ACTIVE_RELEASE_PATH: scanRelease, LAYERED_AFTER_COMPOSE_HOLD_MS: "2000" } });
    await waitForPath(scanStarted);
    const scanContender = child([path.resolve(process.argv[1])], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "compose", LAYERED_REPORT_PATH: scanFixture.reportPath, LAYERED_CANDIDATE: "2", LAYERED_PROTECTION_PATH: scanFixture.protectionContractPath, LAYERED_SCAN_PHASE: scanPhase, LAYERED_SCAN_HOOK_PATH: scanHook, LAYERED_ACTIVE_RELEASE_PATH: scanRelease } });
    const [scanPredecessorResult, scanContenderResult] = await Promise.all([childResult(scanPredecessor), childResult(scanContender)]);
    assert.equal(scanPredecessorResult.code, 0, scanPredecessorResult.stderr); assert.equal(scanContenderResult.code, 0, scanContenderResult.stderr);
    assert.equal(existsSync(scanHook), true, `${scanPhase} race hook must force predecessor removal after the contender snapshots its exact entry path`);
    assert.deepEqual(JSON.parse(readFileSync(scanFixture.reportPath, "utf8")).stages.composite.candidates.map((candidate) => candidate.id), ["candidate_001", "candidate_002"], `${scanPhase} ENOENT rescan must preserve both appends`);
    assert.equal(readdirSync(scanQueue).filter((name) => name.endsWith(".queue-entry")).length, 0, `${scanPhase} ENOENT rescan must drain the queue`);
  }

  const sameNumberFixture = makeFixture(path.join(root, "same-number")); const sameNumberStage = path.join(path.dirname(sameNumberFixture.reportPath), "composite"); const sameNumberQueue = path.join(sameNumberStage, ".compose-run.queue");
  const sameNumberReady = path.join(root, "same-number-ready"); const sameNumberRelease = path.join(root, "same-number-release.txt"); const sameNumberActivity = path.join(root, "same-number-activity");
  const sameNumberChildren = [1, 2].map((candidate) => child([path.resolve(process.argv[1])], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "compose", LAYERED_REPORT_PATH: sameNumberFixture.reportPath, LAYERED_CANDIDATE: String(candidate), LAYERED_PROTECTION_PATH: sameNumberFixture.protectionContractPath, LAYERED_SAME_NUMBER_READY_DIRECTORY: sameNumberReady, LAYERED_SAME_NUMBER_RELEASE_PATH: sameNumberRelease, LAYERED_ACTIVITY_PATH: sameNumberActivity, LAYERED_HOLD_MS: "300" } }));
  await waitForCondition(() => existsSync(sameNumberReady) && readdirSync(sameNumberReady).filter((name) => name.endsWith(".json")).length === 2, "both same-number contenders to fsync their unpublished numbers", 10000);
  const sameNumberFacts = readdirSync(sameNumberReady).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(readFileSync(path.join(sameNumberReady, name), "utf8")));
  assert.deepEqual(sameNumberFacts.map((fact) => fact.number), [1, 1], "both contenders must independently choose the same max+1 before either number is published");
  writeFileSync(sameNumberRelease, "release\n", { flag: "wx" });
  const sameNumberResults = await Promise.all(sameNumberChildren.map((processHandle) => childResult(processHandle))); for (const result of sameNumberResults) assert.equal(result.code, 0, result.stderr);
  const stableSameNumberCandidates = sameNumberFacts.toSorted((left, right) => `${String(left.pid).padStart(12, "0")}\0${left.processStartIdentity}`.localeCompare(`${String(right.pid).padStart(12, "0")}\0${right.processStartIdentity}`)).map((fact) => `candidate_${String(fact.candidate).padStart(3, "0")}`);
  assert.deepEqual(JSON.parse(readFileSync(sameNumberFixture.reportPath, "utf8")).stages.composite.candidates.map((candidate) => candidate.id), stableSameNumberCandidates, "same-number admission order must be the stable PID/process-start owner order");
  assert.equal(readdirSync(sameNumberActivity).some((name) => name.startsWith("observed-2-")), false, "same-number contenders must keep max active compose at one");
  assert.equal(readdirSync(sameNumberQueue).filter((name) => name.endsWith(".queue-entry")).length, 0, "same-number success must drain the queue");

  const filter = buildCompositeFilter(fixture.inputs, fixture.layout, LIGHTING);
  assert.match(filter, /scale=1152:640/);
  assert.match(filter, /dilation=.*alphamerge/s, "spill must be an outer matte layer beneath accepted RGBA");
  assert.match(filter, /blend=all_expr='max\(A-B,0\)'/, "spill mask must subtract the accepted matte interior to form only the outer ring");
  assert.match(filter, /\[with_jiang_spill\]\[shen_yan_layer\].*\[with_shen_yan\].*\[with_shen_yan\]\[jiang_lan_layer\]/s, "both spill rings must be below both untouched accepted RGBA layers");
  assert.doesNotMatch(filter, /colorchannelmixer=/, "accepted RGBA interior must never be recolored");
  assert.match(filter, /overlay=.*format=auto/);
  assert.match(filter, /crop=1138:132:14:501/, "Shen Yan shadow source uses only his frozen lower-matte region");
  assert.match(filter, /crop=1138:123:14:510/, "Jiang Lan shadow source uses only her frozen lower-matte region");
  assert.doesNotMatch(filter, /xfade|tblend/);

  const first = await composeDeterministically({ inputs: fixture.inputs, outputDirectory: path.join(root, "first"), layout: fixture.layout, lighting: LIGHTING, protectionContract: fixture.protectionContract });
  const second = await composeDeterministically({ inputs: fixture.inputs, outputDirectory: path.join(root, "second"), layout: fixture.layout, lighting: LIGHTING, protectionContract: fixture.protectionContract });
  for (const key of ["unrepairedComposite", "editableMask", "protectedMask", "contactShadowMask"]) {
    const a = probeImage(first[key]); const b = probeImage(second[key]);
    assert.deepEqual([a.codecName, a.width, a.height], ["png", WIDTH, HEIGHT]);
    assert.deepEqual(readFileSync(first[key]), readFileSync(second[key]), `${key} must be byte deterministic`);
  }
  assertMaskDisjoint(first.protectedMask, first.editableMask);
  const composite = decodeRaw(first.unrepairedComposite, "rgba");
  assert.deepEqual(pixel(composite, 496, 118).slice(0, 3), [220, 40, 40], "protected Shen Yan interior RGB must remain byte-identical");
  assert.deepEqual(pixel(composite, 690, 151).slice(0, 3), [40, 80, 220], "protected Jiang Lan interior RGB must remain byte-identical");
  assert.notDeepEqual(pixel(composite, 437, 250).slice(0, 3), [35, 55, 75], "outer edge spill must be visible beneath the untouched Shen Yan RGBA");
  const adjacentComposite = renderAdjacentSpillOracle(path.join(root, "adjacent-spill"), fixture.layout);
  assert.deepEqual(pixel(adjacentComposite, 575, 260).slice(0, 3), [220, 40, 40], "Jiang spill lands beneath but must not alter the adjacent Shen edge pixel");
  assert.deepEqual(pixel(adjacentComposite, 576, 260).slice(0, 3), [40, 80, 220], "Shen spill lands beneath but must not alter the adjacent Jiang edge pixel");
  const shadowCenter = centroid(decodeRaw(first.contactShadowMask));
  const lowerUnion = Buffer.alloc(PIXELS);
  const shenRaw = decodeRaw(fixture.paths.shenMaskPath); const jiangRaw = decodeRaw(fixture.paths.jiangMaskPath);
  const shenLowerY = Math.floor(Math.min(fixture.layout.people.shen_yan.feet.left.y, fixture.layout.people.shen_yan.feet.right.y) - 45);
  const jiangLowerY = Math.floor(Math.min(fixture.layout.people.jiang_lan.feet.left.y, fixture.layout.people.jiang_lan.feet.right.y) - 45);
  for (let y = Math.min(shenLowerY, jiangLowerY); y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    lowerUnion[y * WIDTH + x] = Math.max(y >= shenLowerY ? shenRaw[y * WIDTH + x] : 0, y >= jiangLowerY ? jiangRaw[y * WIDTH + x] : 0);
  }
  const footCenter = centroid(lowerUnion);
  assert.ok(shadowCenter.x < footCenter.x, "contact shadow must displace screen-left");
  assert.ok(shadowCenter.y > footCenter.y, "contact shadow must displace toward screen-front/down");

  const maskOnly = await buildEditableMask({ inputs: fixture.inputs, outputDirectory: path.join(root, "mask-only"), layout: fixture.layout, lighting: LIGHTING, protectionContract: fixture.protectionContract });
  assertMaskDisjoint(maskOnly.protectedMask, maskOnly.editableMask);
  const protectedContractPixels = decodeRaw(maskOnly.protectedMask);
  for (const [label, point] of [["Shen face", [496, 118]], ["Shen hair", [496, 108]], ["Shen body", [470, 250]], ["Shen accessory", [470, 250]], ["Jiang face", [690, 151]], ["Jiang hair", [690, 141]], ["Jiang body", [715, 280]], ["Jiang accessory", [710, 280]]]) {
    assert.ok(protectedContractPixels[point[1] * WIDTH + point[0]] > 0, `${label} declared protection must have meaningful matte intersection`);
  }
  await assert.rejects(() => composeDeterministically({ inputs: fixture.inputs, outputDirectory: path.join(root, "missing-contract"), layout: fixture.layout, lighting: LIGHTING }), /protection contract.*required/i);
  const invalidContract = structuredClone(fixture.protectionContract); invalidContract.characters.shen_yan.accessoryBoxes = [];
  await assert.rejects(() => composeDeterministically({ inputs: fixture.inputs, outputDirectory: path.join(root, "invalid-contract"), layout: fixture.layout, lighting: LIGHTING, protectionContract: invalidContract }), /accessor|review.*note/i);

  await assert.rejects(() => composeDeterministically({ inputs: { ...fixture.inputs, shen_yan: { ...fixture.inputs.jiang_lan } }, outputDirectory: path.join(root, "swapped"), layout: fixture.layout, lighting: LIGHTING, protectionContract: fixture.protectionContract }), /identity|swapped/i);
  const overlapFixture = makeFixture(path.join(root, "overlap"), { jiangMutation: { overlapBox: [500, 250, 700, 280] } });
  await assert.rejects(() => composeDeterministically({ inputs: overlapFixture.inputs, outputDirectory: path.join(root, "overlap-output"), layout: fixture.layout, lighting: LIGHTING, protectionContract: overlapFixture.protectionContract }), /overlap/i);
  const footFixture = makeFixture(path.join(root, "foot"), { shenMutation: { leftFoot: { x: 535, y: 547 } } });
  await assert.rejects(() => composeDeterministically({ inputs: footFixture.inputs, outputDirectory: path.join(root, "foot-output"), layout: fixture.layout, lighting: LIGHTING, protectionContract: footFixture.protectionContract }), /foot|feet|anchor/i);
  const leakFixture = makeFixture(path.join(root, "leak"), { shenMutation: { lowAlphaBox: [560, 100, 590, 120], lowAlphaValue: 12 } });
  await assert.rejects(() => composeDeterministically({ inputs: leakFixture.inputs, outputDirectory: path.join(root, "leak-output"), layout: fixture.layout, lighting: LIGHTING, protectionContract: leakFixture.protectionContract }), /leak|bounds/i);

  const protectedPixels = decodeRaw(first.protectedMask); const editablePixels = Buffer.from(decodeRaw(first.editableMask));
  const protectedIndex = protectedPixels.findIndex((value) => value > 0); assert.ok(protectedIndex >= 0);
  editablePixels[protectedIndex] = 255;
  const overlappingEditable = encodeRaw(editablePixels, "gray", path.join(root, "overlapping-editable.png"));
  assert.throws(() => assertMaskDisjoint(first.protectedMask, overlappingEditable), /intersection|overlap/i);

  const corruptFixture = makeFixture(path.join(root, "corrupt"));
  writeFileSync(corruptFixture.paths.backgroundPath, Buffer.from("not a png"));
  await assert.rejects(() => composeDeterministically({ inputs: corruptFixture.inputs, outputDirectory: path.join(root, "corrupt-output"), layout: fixture.layout, lighting: LIGHTING, protectionContract: corruptFixture.protectionContract }), /hash|size|decode/i);
  const wrongGeometry = path.join(root, "wrong-geometry.png");
  run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=black:s=32x32", "-frames:v", "1", wrongGeometry]);
  await assert.rejects(() => composeDeterministically({ inputs: { ...fixture.inputs, emptyPlate: resource(wrongGeometry) }, outputDirectory: path.join(root, "wrong-output"), layout: fixture.layout, lighting: LIGHTING, protectionContract: fixture.protectionContract }), /1152x640|geometry/i);

  const reportResult = await composeDeterministically({ reportPath: fixture.reportPath, candidate: 1, lighting: LIGHTING, protectionContractPath: fixture.protectionContractPath });
  assert.equal(reportResult.candidate.state, "technical");
  assert.equal(reportResult.candidate.creativeAcceptance, "pending");
  assert.equal(reportResult.report.overallStatus, "pending");
  assert.equal(reportResult.candidate.artifact.sha256, sha256File(reportResult.unrepairedComposite));
  await assert.rejects(() => composeDeterministically({ reportPath: fixture.reportPath, candidate: 1, lighting: LIGHTING, protectionContractPath: fixture.protectionContractPath }), /exists|already/i);
  const independentCompositeSlot = await composeDeterministically({ reportPath: fixture.reportPath, candidate: 2, lighting: LIGHTING, protectionContractPath: fixture.protectionContractPath });
  assert.equal(independentCompositeSlot.candidate.id, "candidate_002", "composite slot ID is independent from accepted per-character IDs");
  const frozenLightingPath = path.join(path.dirname(fixture.reportPath), "composite", "numeric-lighting.json");
  assert.deepEqual(JSON.parse(readFileSync(frozenLightingPath, "utf8")).lighting, LIGHTING);
  const frozenProtectionPath = path.join(path.dirname(fixture.reportPath), "composite", "protection-contract.json");
  assert.deepEqual(readFileSync(frozenProtectionPath), readFileSync(fixture.protectionContractPath), "protection contract exact source bytes must be frozen at run root");
  assert.equal(reportResult.candidate.protectionContract.manifest.sha256, sha256File(frozenProtectionPath));
  assert.ok(reportResult.candidate.protectionContract.derived.characters.shen_yan.faceRegion.radiusX > 0, "derived person-local region parameters must be frozen in candidate record");
  await assert.rejects(
    () => composeDeterministically({ reportPath: fixture.reportPath, candidate: 3, lighting: { ...LIGHTING, environmentRgb: [190, 120, 70] }, protectionContractPath: fixture.protectionContractPath }),
    /lighting.*(?:frozen|drift|match)/i,
  );

  const mutationFixture = makeFixture(path.join(root, "contract-mutation"));
  await assert.rejects(
    () => composeDeterministically({
      reportPath: mutationFixture.reportPath,
      candidate: 1,
      lighting: LIGHTING,
      protectionContractPath: mutationFixture.protectionContractPath,
      afterArtifactDirectoryPublished() {
        const changed = structuredClone(mutationFixture.protectionContract); changed.review.note += " mutated during render";
        writeFileSync(mutationFixture.protectionContractPath, `${JSON.stringify(changed, null, 2)}\n`);
        throw new Error("pause after protection mutation");
      },
    }),
    /pause after protection mutation/i,
  );
  await assert.rejects(() => composeDeterministically({ reportPath: mutationFixture.reportPath, candidate: 1, lighting: LIGHTING, protectionContractPath: mutationFixture.protectionContractPath }), /protection contract.*(?:bytes|match|changed)/i);

  const concurrentFixture = makeFixture(path.join(root, "concurrent"));
  const concurrentStage = path.join(path.dirname(concurrentFixture.reportPath), "composite"); mkdirSync(concurrentStage, { recursive: true });
  const runQueue = path.join(concurrentStage, ".compose-run.queue");
  const liveTicket = writeQueueEntry(runQueue, { pid: process.pid, processStartIdentity: "same-start", nonce: "00000000-0000-0000-0000-000000000001", createdAt: 1, purpose: "composite-run:candidate_999" });
  await assert.rejects(() => composeDeterministically({ reportPath: concurrentFixture.reportPath, candidate: 1, lighting: LIGHTING, protectionContractPath: concurrentFixture.protectionContractPath, lockTimeoutMs: 60, processIdentityProvider: async (pid) => ({ alive: pid === process.pid, startIdentity: pid === process.pid ? "same-start" : null }) }), /live|timed out|queue/i);
  assert.equal(existsSync(liveTicket), true, "same-PID/same-start owner ticket must never be pruned");
  rmSync(liveTicket, { recursive: true, force: true });

  const reusedTicket = writeQueueEntry(runQueue, { pid: process.pid, processStartIdentity: "old-start", nonce: "00000000-0000-0000-0000-000000000002", createdAt: 1, purpose: "composite-run:candidate_999" });
  const reuseRecovered = await composeDeterministically({ reportPath: concurrentFixture.reportPath, candidate: 1, lighting: LIGHTING, protectionContractPath: concurrentFixture.protectionContractPath, processIdentityProvider: async (pid) => ({ alive: pid === process.pid, startIdentity: pid === process.pid ? "new-start" : null }) });
  assert.equal(reuseRecovered.candidate.id, "candidate_001");
  assert.equal(existsSync(reusedTicket), false, "same-PID/different-start stale ticket must be pruned as PID reuse");

  const indeterminateFixture = makeFixture(path.join(root, "indeterminate-identity")); const indeterminateQueue = path.join(path.dirname(indeterminateFixture.reportPath), "composite", ".compose-run.queue");
  const indeterminateTicket = writeQueueEntry(indeterminateQueue, { pid: 987654, processStartIdentity: "unknown-start", nonce: "00000000-0000-0000-0000-000000000003", createdAt: 1, purpose: "composite-run:candidate_999" });
  await assert.rejects(() => composeDeterministically({ reportPath: indeterminateFixture.reportPath, candidate: 1, lighting: LIGHTING, protectionContractPath: indeterminateFixture.protectionContractPath, lockTimeoutMs: 60, processIdentityProvider: async (pid) => (pid === process.pid ? { alive: true, startIdentity: "self-start" } : { alive: null, startIdentity: null }) }), /indeterminate|timed out/i);
  assert.equal(existsSync(indeterminateTicket), true, "indeterminate owner identity must fail closed without pruning its exact ticket");

  const abruptFixture = makeFixture(path.join(root, "abrupt-child"));
  const abrupt = child([path.resolve(process.argv[1])], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "crash", LAYERED_REPORT_PATH: abruptFixture.reportPath, LAYERED_CANDIDATE: "1", LAYERED_PROTECTION_PATH: abruptFixture.protectionContractPath } });
  const abruptResult = await childResult(abrupt); assert.equal(abruptResult.code, 86, `abrupt child must exit inside compositor: ${abruptResult.stderr}`);
  const abruptStage = path.join(path.dirname(abruptFixture.reportPath), "composite"); const abruptOutput = path.join(abruptStage, "candidate_001");
  const abruptQueue = path.join(abruptStage, ".compose-run.queue"); const abruptTickets = readdirSync(abruptQueue).filter((name) => name.endsWith(".queue-entry"));
  assert.equal(abruptTickets.length, 1); const abruptParts = abruptTickets[0].split("~");
  assert.equal(Number(abruptParts[0]), abrupt.pid); assert.equal(typeof decodeURIComponent(abruptParts[3]), "string"); assert.match(decodeURIComponent(abruptParts[4].replace(/\.queue-entry$/, "")), /candidate_001/);
  const abruptHashes = Object.fromEntries(Object.values({ unrepairedComposite: "unrepaired-composite.png", editableMask: "editable-mask.png", protectedMask: "protected-mask.png", contactShadowMask: "contact-shadow-mask.png" }).map((name) => [name, sha256File(path.join(abruptOutput, name))]));
  const abruptAttemptsBefore = readdirSync(path.join(abruptStage, "attempts", "candidate_001")).length;
  const abruptRecovered = await composeDeterministically({ reportPath: abruptFixture.reportPath, candidate: 1, lighting: LIGHTING, protectionContractPath: abruptFixture.protectionContractPath, lockTimeoutMs: 5000 });
  assert.equal(abruptRecovered.candidate.id, "candidate_001");
  assert.equal(readdirSync(path.join(abruptStage, "attempts", "candidate_001")).length, abruptAttemptsBefore, "dead-owner recovery must not rerender");
  for (const [name, hash] of Object.entries(abruptHashes)) assert.equal(sha256File(path.join(abruptOutput, name)), hash, `dead-owner recovery must not overwrite ${name}`);
  assert.equal(readdirSync(abruptQueue).filter((name) => name.endsWith(".queue-entry")).length, 0, "recovered dead-owner entry must be pruned");

  const prePublishFixture = makeFixture(path.join(root, "pre-publish-child"));
  const prePublish = child([path.resolve(process.argv[1])], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "crash-before-publication", LAYERED_REPORT_PATH: prePublishFixture.reportPath, LAYERED_CANDIDATE: "1", LAYERED_PROTECTION_PATH: prePublishFixture.protectionContractPath } });
  const prePublishResult = await childResult(prePublish); assert.equal(prePublishResult.code, 85, prePublishResult.stderr);
  const prePublishStage = path.join(path.dirname(prePublishFixture.reportPath), "composite"); const prePublishAttempts = path.join(prePublishStage, "attempts", "candidate_001");
  const prePublishRecovered = await composeDeterministically({ reportPath: prePublishFixture.reportPath, candidate: 1, lighting: LIGHTING, protectionContractPath: prePublishFixture.protectionContractPath });
  assert.equal(prePublishRecovered.candidate.id, "candidate_001");
  const prePublishJournals = readdirSync(prePublishAttempts, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => JSON.parse(readFileSync(path.join(prePublishAttempts, entry.name, "attempt.json"), "utf8")));
  assert.equal(prePublishJournals.some((journal) => journal.status === "abandoned"), true, "pre-publication crash attempt must be durably archived as abandoned");
  assert.equal(prePublishJournals.some((journal) => journal.status === "completed"), true, "retry must create a fresh append-only completed attempt");

  const readyCrashFixture = makeFixture(path.join(root, "ready-before-rename-child")); const readyCrashOriginalReportBytes = readFileSync(readyCrashFixture.reportPath); const readyCrash = child([path.resolve(process.argv[1])], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "crash-ready-before-rename", LAYERED_REPORT_PATH: readyCrashFixture.reportPath, LAYERED_CANDIDATE: "1", LAYERED_PROTECTION_PATH: readyCrashFixture.protectionContractPath } }); const readyCrashResult = await childResult(readyCrash); assert.equal(readyCrashResult.code, 84, readyCrashResult.stderr);
  const readyCrashStage = path.join(path.dirname(readyCrashFixture.reportPath), "composite"); const readyCrashOutput = path.join(readyCrashStage, "candidate_001"); const readyCrashAttempts = path.join(readyCrashStage, "attempts", "candidate_001"); const crashedReadyJournals = readdirSync(readyCrashAttempts, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => JSON.parse(readFileSync(path.join(readyCrashAttempts, entry.name, "attempt.json"), "utf8"))); assert.equal(crashedReadyJournals.length, 1); assert.equal(crashedReadyJournals[0].status, "ready-to-publish", "crash must occur after the durable ready journal"); assert.equal(existsSync(readyCrashOutput), false, "crash must occur before atomic output directory publication"); assert.deepEqual(readFileSync(readyCrashFixture.reportPath), readyCrashOriginalReportBytes, "pre-publication crash cannot mutate report bytes");
  const readyCrashRecovered = await composeDeterministically({ reportPath: readyCrashFixture.reportPath, candidate: 1, lighting: LIGHTING, protectionContractPath: readyCrashFixture.protectionContractPath }); assert.equal(readyCrashRecovered.candidate.id, "candidate_001"); const recoveredReadyJournals = readdirSync(readyCrashAttempts, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => JSON.parse(readFileSync(path.join(readyCrashAttempts, entry.name, "attempt.json"), "utf8"))); assert.equal(recoveredReadyJournals.filter((journal) => journal.status === "abandoned").length, 1, "the exact unpublished ready attempt must be archived once"); assert.equal(recoveredReadyJournals.filter((journal) => journal.status === "completed").length, 1, "retry must leave exactly one completed matching attempt"); assert.equal(readyCrashRecovered.report.stages.composite.candidates.filter((candidate) => candidate.id === "candidate_001").length, 1, "retry must append exactly one candidate"); const acceptedReadyReport = structuredClone(readyCrashRecovered.report); acceptedReadyReport.stages.composite.candidates[0].state = "accepted"; acceptedReadyReport.stages.composite.candidates[0].creativeAcceptance = "accepted"; validateCurrentCompositeChain(acceptedReadyReport, acceptedReadyReport.stages.composite.candidates[0], { reportPath: readyCrashFixture.reportPath }); assert.equal(readdirSync(path.join(readyCrashStage, ".compose-run.queue")).filter((name) => name.endsWith(".queue-entry")).length, 0, "ready-window recovery must drain its run queue");

  const serializedFixture = makeFixture(path.join(root, "serialized-children")); const serializedStage = path.join(path.dirname(serializedFixture.reportPath), "composite"); const activityPath = path.join(root, "serialized-activity");
  const childScript = path.resolve(process.argv[1]);
  const deadPredecessor = child([childScript], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "crash-before-publication", LAYERED_REPORT_PATH: serializedFixture.reportPath, LAYERED_CANDIDATE: "1", LAYERED_PROTECTION_PATH: serializedFixture.protectionContractPath } });
  const deadPredecessorResult = await childResult(deadPredecessor); assert.equal(deadPredecessorResult.code, 85, deadPredecessorResult.stderr);
  assert.equal(readdirSync(path.join(serializedStage, ".compose-run.queue")).filter((name) => name.endsWith(".queue-entry")).length, 1, "three successors must begin behind one real dead-owner entry");
  const firstChild = child([childScript], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "compose", LAYERED_REPORT_PATH: serializedFixture.reportPath, LAYERED_CANDIDATE: "1", LAYERED_PROTECTION_PATH: serializedFixture.protectionContractPath, LAYERED_HOLD_MS: "700", LAYERED_ACTIVITY_PATH: activityPath } });
  await waitForPath(path.join(serializedStage, ".compose-run.queue"));
  const secondChild = child([childScript], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "compose", LAYERED_REPORT_PATH: serializedFixture.reportPath, LAYERED_CANDIDATE: "2", LAYERED_PROTECTION_PATH: serializedFixture.protectionContractPath, LAYERED_ACTIVITY_PATH: activityPath } });
  const thirdChild = child([childScript], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "compose", LAYERED_REPORT_PATH: serializedFixture.reportPath, LAYERED_CANDIDATE: "3", LAYERED_PROTECTION_PATH: serializedFixture.protectionContractPath, LAYERED_ACTIVITY_PATH: activityPath } });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(existsSync(path.join(serializedStage, "candidate_002")), false, "second process must wait before rendering any output");
  const [firstChildResult, secondChildResult, thirdChildResult] = await Promise.all([childResult(firstChild), childResult(secondChild), childResult(thirdChild)]);
  assert.equal(firstChildResult.code, 0, firstChildResult.stderr); assert.equal(secondChildResult.code, 0, secondChildResult.stderr); assert.equal(thirdChildResult.code, 0, thirdChildResult.stderr);
  const serializedReport = JSON.parse(readFileSync(serializedFixture.reportPath, "utf8"));
  assert.deepEqual(serializedReport.stages.composite.candidates.map((candidate) => candidate.id).sort(), ["candidate_001", "candidate_002", "candidate_003"], "serialized distinct candidates must all append without loss");
  assert.equal(readdirSync(activityPath).some((name) => name.startsWith("observed-2-") || name.startsWith("observed-3-")), false, "max active compose critical sections must remain one");

  const crossWriterFixture = makeFixture(path.join(root, "composer-review-cross-writer")); const alternatePlate = resource(encodeRaw(Buffer.alloc(PIXELS * 4, 31), "rgba", path.join(root, "alternate-plate.png"))); let crossWriterReport = JSON.parse(readFileSync(crossWriterFixture.reportPath, "utf8")); crossWriterReport = appendCandidate(crossWriterReport, "empty_plate", { id: "candidate_002", artifact: alternatePlate }); writeJsonAtomic(crossWriterFixture.reportPath, crossWriterReport);
  const reviewReady = path.join(root, "review-ready"); const reviewRelease = path.join(root, "review-release"); const reviewChild = child([childScript], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "review-unrelated", LAYERED_REPORT_PATH: crossWriterFixture.reportPath, LAYERED_REVIEW_READY_PATH: reviewReady, LAYERED_REVIEW_RELEASE_PATH: reviewRelease } }); await waitForPath(reviewReady);
  const composeChild = child([childScript], { env: { ...process.env, LAYERED_COMPOSE_CHILD: "compose", LAYERED_REPORT_PATH: crossWriterFixture.reportPath, LAYERED_CANDIDATE: "1", LAYERED_PROTECTION_PATH: crossWriterFixture.protectionContractPath } }); await new Promise((resolve) => setTimeout(resolve, 150)); assert.equal(existsSync(path.join(path.dirname(crossWriterFixture.reportPath), "composite", "candidate_001")), false, "real composer must wait before rendering while review holds the shared report protocol"); writeFileSync(reviewRelease, "release\n", { flag: "wx" }); const [reviewCrossResult, composeCrossResult] = await Promise.all([childResult(reviewChild), childResult(composeChild)]); assert.equal(reviewCrossResult.code, 0, reviewCrossResult.stderr); assert.equal(composeCrossResult.code, 0, composeCrossResult.stderr); const crossWriterFinal = JSON.parse(readFileSync(crossWriterFixture.reportPath, "utf8")); assert.equal(crossWriterFinal.stages.empty_plate.candidates.find((item) => item.id === "candidate_002").state, "rejected", "concurrent review mutation must survive composer append"); assert.equal(crossWriterFinal.stages.composite.candidates.some((item) => item.id === "candidate_001"), true, "composer append must survive concurrent review mutation");

  const recoveryFixture = makeFixture(path.join(root, "recovery"));
  await assert.rejects(
    () => composeDeterministically({
      reportPath: recoveryFixture.reportPath,
      candidate: 1,
      lighting: LIGHTING,
      protectionContractPath: recoveryFixture.protectionContractPath,
      afterPublishedJournal() { throw new Error("injected crash after exclusive publication"); },
    }),
    /injected crash/i,
  );
  const interruptedReport = JSON.parse(readFileSync(recoveryFixture.reportPath, "utf8"));
  assert.equal(interruptedReport.stages.composite.candidates.length, 0, "crash occurs before report append");
  const publishedBeforeRecovery = path.join(path.dirname(recoveryFixture.reportPath), "composite", "candidate_001", "unrepaired-composite.png");
  const publishedHash = sha256File(publishedBeforeRecovery);
  let ambiguousRecovery = appendCandidate(interruptedReport, "empty_plate", { id: "candidate_002", artifact: recoveryFixture.report.stages.empty_plate.candidates[0].artifact });
  ambiguousRecovery = reviewCandidate(ambiguousRecovery, "empty_plate", "candidate_002", { decision: "accepted", note: "second plate", evidence: recoveryFixture.report.stages.empty_plate.candidates[0].artifact }, { isDecodable: () => true });
  writeJsonAtomic(recoveryFixture.reportPath, ambiguousRecovery);
  await assert.rejects(() => composeDeterministically({ reportPath: recoveryFixture.reportPath, candidate: 1, lighting: LIGHTING, protectionContractPath: recoveryFixture.protectionContractPath }), /exactly one empty plate|prerequisite/i);
  writeJsonAtomic(recoveryFixture.reportPath, interruptedReport);
  const recovered = await composeDeterministically({ reportPath: recoveryFixture.reportPath, candidate: 1, lighting: LIGHTING, protectionContractPath: recoveryFixture.protectionContractPath });
  assert.equal(recovered.candidate.state, "technical");
  assert.equal(recovered.candidate.creativeAcceptance, "pending");
  assert.equal(sha256File(publishedBeforeRecovery), publishedHash, "recovery must not overwrite published bytes");

  const atomicRecoveryFixture = makeFixture(path.join(root, "atomic-recovery"));
  await assert.rejects(
    () => composeDeterministically({
      reportPath: atomicRecoveryFixture.reportPath,
      candidate: 1,
      lighting: LIGHTING,
      protectionContractPath: atomicRecoveryFixture.protectionContractPath,
      afterArtifactDirectoryPublished() { throw new Error("injected crash after atomic directory publication"); },
    }),
    /atomic directory publication/i,
  );
  const atomicPublished = path.join(path.dirname(atomicRecoveryFixture.reportPath), "composite", "candidate_001", "unrepaired-composite.png");
  const atomicPublishedHash = sha256File(atomicPublished);
  const atomicallyRecovered = await composeDeterministically({ reportPath: atomicRecoveryFixture.reportPath, candidate: 1, lighting: LIGHTING, protectionContractPath: atomicRecoveryFixture.protectionContractPath });
  assert.equal(atomicallyRecovered.candidate.state, "technical");
  assert.equal(sha256File(atomicPublished), atomicPublishedHash, "pre-journal recovery must not overwrite atomically published bytes");

  const corruptRecoveryFixture = makeFixture(path.join(root, "corrupt-recovery"));
  await assert.rejects(
    () => composeDeterministically({
      reportPath: corruptRecoveryFixture.reportPath,
      candidate: 1,
      lighting: LIGHTING,
      protectionContractPath: corruptRecoveryFixture.protectionContractPath,
      afterArtifactDirectoryPublished() { throw new Error("pause recovery for corruption"); },
    }),
    /pause recovery/i,
  );
  writeFileSync(corruptRecoveryFixture.paths.shenMaskPath, Buffer.from("corrupt matte"));
  await assert.rejects(() => composeDeterministically({ reportPath: corruptRecoveryFixture.reportPath, candidate: 1, lighting: LIGHTING, protectionContractPath: corruptRecoveryFixture.protectionContractPath }), /matte.*(?:size|hash|decode)|artifact.*(?:size|hash)/i);

  const missingFixture = makeFixture(path.join(root, "missing"));
  missingFixture.report.stages.empty_plate.candidates = [];
  writeJsonAtomic(missingFixture.reportPath, missingFixture.report);
  await assert.rejects(() => composeDeterministically({ reportPath: missingFixture.reportPath, candidate: 1, lighting: LIGHTING, protectionContractPath: missingFixture.protectionContractPath }), /empty.plate.*accepted|prerequisite/i);

  for (const args of [
    [], ["--candidate", "0", "--report", fixture.reportPath], ["--candidate", "01", "--report", fixture.reportPath],
    ["--candidate", "1", "--report"], ["--candidate", "1", "--report", fixture.reportPath],
    ["--candidate", "1", "--report", fixture.reportPath, "--extra", "x"],
  ]) assert.throws(() => parseArguments(args), /usage/i);
  assert.deepEqual(
    parseArguments(["--candidate", "2", "--report", fixture.reportPath, "--protection-contract", fixture.protectionContractPath]),
    { candidate: 2, reportPath: path.resolve(fixture.reportPath), protectionContractPath: path.resolve(fixture.protectionContractPath) },
  );

  console.log("Layered deterministic composite: PASS");
} finally {
  rmSync(root, { recursive: true, force: true });
}
