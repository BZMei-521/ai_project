import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { applyCreativeReview, applyFinalReview, assertFinalReviewAssembly } from "./lib/wan-one-take-acceptance.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function probeVideo(path) {
  const result = spawnSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,r_frame_rate,nb_frames:format=duration,size",
    "-of", "json", path
  ], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`ffprobe failed for ${path}: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  return { stream: parsed.streams?.[0] || {}, format: parsed.format || {} };
}

function frameRate(value) {
  const [numerator, denominator] = String(value).split("/").map(Number);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? numerator / denominator : NaN;
}

function assertActualVideo(path, { label, fps, frameCount, minDuration, maxDuration }) {
  const { stream: metadata, format } = probeVideo(path);
  if (metadata.codec_name !== "h264") throw new Error(`${label} actual codec must be h264: ${metadata.codec_name}`);
  if (Number(metadata.width) !== 832 || Number(metadata.height) !== 480) {
    throw new Error(`${label} actual dimensions must be 832x480: ${metadata.width}x${metadata.height}`);
  }
  if (frameRate(metadata.r_frame_rate) !== fps) {
    throw new Error(`${label} actual frame rate must be ${fps}: ${metadata.r_frame_rate}`);
  }
  if (frameCount !== undefined && Number(metadata.nb_frames) !== frameCount) {
    throw new Error(`${label} actual frame count must be ${frameCount}: ${metadata.nb_frames}`);
  }
  const duration = Number(format.duration);
  if (!Number.isFinite(duration) || duration < minDuration || duration > maxDuration) {
    throw new Error(`${label} actual duration must be ${minDuration}-${maxDuration}: ${format.duration}`);
  }
  if (!(Number(format.size) > 0)) throw new Error(`${label} actual size must be greater than zero: ${format.size}`);
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertDecodableImage(path) {
  if (statSync(path).size <= 0) throw new Error(`stored image is empty: ${path}`);
  const result = spawnSync("ffmpeg", [
    "-v", "error", "-i", path, "-frames:v", "1", "-f", "null", "-"
  ], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`stored image is not decodable: ${path}: ${result.stderr}`);
}

function assertStoredAssemblyContent(report) {
  const assembly = assertFinalReviewAssembly(report);
  const imagePaths = [assembly.evidence.fullContactSheetPath, ...assembly.evidence.boundarySheetPaths];
  const storedPaths = [assembly.nativePath, assembly.deliveryPath, ...imagePaths];
  for (const path of storedPaths) {
    if (!existsSync(resolve(path))) throw new Error(`assembled media or evidence does not exist: ${path}`);
  }
  const integrityChecks = [
    [assembly.nativePath, assembly.integrity.nativeSha256],
    [assembly.deliveryPath, assembly.integrity.deliverySha256],
    [assembly.evidence.fullContactSheetPath, assembly.integrity.fullContactSheetSha256],
    ...assembly.evidence.boundarySheetPaths.map((path, index) => [path, assembly.integrity.boundarySheetSha256s[index]])
  ];
  for (const [path, expectedHash] of integrityChecks) {
    const actualHash = sha256File(resolve(path));
    if (actualHash !== expectedHash) throw new Error(`assembled media or evidence hash mismatch: ${path}`);
  }
  assertActualVideo(resolve(assembly.nativePath), {
    label: "native", fps: 16, frameCount: 97, minDuration: 6.0, maxDuration: 6.2
  });
  assertActualVideo(resolve(assembly.deliveryPath), {
    label: "delivery", fps: 24, minDuration: 5.8, maxDuration: 6.3
  });
  for (const path of imagePaths) assertDecodableImage(resolve(path));
}

const reportPath = resolve(valueAfter("--report") || "logs/video-quality-one-take/wan-one-take-report.json");
const segmentNumber = valueAfter("--segment") === null ? null : Number(valueAfter("--segment"));
const segmentDecision = valueAfter("--decision");
const finalDecision = valueAfter("--final-decision");
const note = valueAfter("--note");
const evidencePath = valueAfter("--evidence");

if (!existsSync(reportPath)) throw new Error(`report does not exist: ${reportPath}`);
if (!evidencePath || !existsSync(resolve(evidencePath))) throw new Error(`review evidence does not exist: ${evidencePath}`);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const review = {
  decision: segmentDecision || finalDecision,
  note,
  evidencePath: resolve(evidencePath),
  reviewedAt: new Date().toISOString()
};

let updated;
if (segmentNumber !== null) {
  if (!Number.isInteger(segmentNumber) || segmentNumber < 1 || segmentNumber > 6 || !segmentDecision || finalDecision) {
    throw new Error("segment review requires --segment 1..6 and --decision accepted|rejected");
  }
  const index = report.segments.findIndex((segment) => segment.order === segmentNumber);
  if (index < 0) throw new Error(`segment ${segmentNumber} is missing from report`);
  let segments = [...report.segments];
  segments[index] = applyCreativeReview(segments[index], review);
  if (segmentDecision === "rejected") segments = segments.slice(0, index + 1);
  updated = {
    ...report,
    segments,
    technicalAcceptedSegments: segments.filter((segment) => segment.technicalAccepted).length,
    acceptedSegments: segments.filter((segment) => segment.accepted).length,
    overallAccepted: false
  };
  if (segmentDecision === "rejected") {
    delete updated.assembly;
    delete updated.finalAcceptance;
  }
} else {
  if (!finalDecision || segmentDecision) throw new Error("final review requires --final-decision accepted|rejected");
  if (finalDecision === "accepted") {
    const assembly = assertFinalReviewAssembly(report);
    if (resolve(evidencePath) !== resolve(assembly.evidence.fullContactSheetPath)) {
      throw new Error("accepted final review evidence must be the stored full contact sheet");
    }
    assertStoredAssemblyContent(report);
  }
  updated = applyFinalReview(report, review);
}

const temporaryPath = `${reportPath}.tmp`;
writeFileSync(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
renameSync(temporaryPath, reportPath);
console.log(segmentNumber === null ? `Final creative review: ${finalDecision}` : `Segment ${segmentNumber} creative review: ${segmentDecision}`);
