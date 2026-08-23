import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { assertHalfStepTarget } from "./wan-flf2v-pose-guide.mjs";

export const EXPERIMENT_ROOT = resolve("logs/video-quality-one-take-flf2v");
export const ENDPOINT_SEEDS = Object.freeze([271011, 272011, 273011]);
export const VIDEO_SEEDS = Object.freeze([281011, 282011, 283011]);
export const AUTHORITATIVE_REPORT_PATH = resolve("logs/video-quality-one-take/wan-one-take-report.json");

const GEOMETRY = Object.freeze({
  source: { width: 1152, height: 640 },
  flf: { scaledWidth: 1296, scaledHeight: 720, cropLeft: 8, cropRight: 8, width: 1280, height: 720 },
  chain: { scaledWidth: 854, scaledHeight: 480, cropLeft: 11, cropRight: 11, width: 832, height: 480 }
});

function cloneGeometry() {
  return structuredClone(GEOMETRY);
}

function requireValue(value, message) {
  if (value === undefined || value === null || value === "") throw new Error(message);
  return value;
}

function requireCandidateNumber(number, seeds, label) {
  if (!Number.isInteger(number) || number < 1 || number > seeds.length) {
    throw new Error(`${label} candidate must be 1..${seeds.length}`);
  }
}

function matchingPath(left, right) {
  return Boolean(left && right) && resolve(left).toLocaleLowerCase() === resolve(right).toLocaleLowerCase();
}

function isSameOrDescendant(path, directory) {
  const normalizedPath = resolve(path).toLocaleLowerCase();
  const normalizedDirectory = resolve(directory).toLocaleLowerCase();
  const difference = relative(normalizedDirectory, normalizedPath);
  return difference === "" || (!isAbsolute(difference) && difference !== ".." && !difference.startsWith(`..${sep}`));
}

function assertReview(review, candidate) {
  if (!review || !["accepted", "rejected"].includes(review.decision)) {
    throw new Error("review decision must be accepted or rejected");
  }
  requireValue(review.note?.trim(), "review note is required");
  requireValue(review.evidencePath, "review evidence is required");
  requireValue(review.evidenceSha256, "review evidence hash is required");
  if (!matchingPath(review.evidencePath, candidate.evidencePath)) {
    throw new Error("review evidence must match the stored candidate evidence");
  }
  if (review.evidenceSha256 !== candidate.evidenceSha256) {
    throw new Error("review evidence hash must match the stored candidate hash");
  }
}

function assertTechnicalCandidate(candidate, label) {
  if (!candidate || candidate.technicalAcceptance?.status !== "accepted") {
    throw new Error(`${label} technical acceptance is required`);
  }
  if (candidate.creativeAcceptance?.status !== "pending") {
    throw new Error(`${label} creative review must be pending`);
  }
}

function assertImageValidators(io) {
  if (!io || typeof io.existsFile !== "function" || typeof io.hashFile !== "function" || typeof io.assertDecodableImage !== "function") {
    throw new Error("artifact validators are required: existsFile, hashFile, and assertDecodableImage");
  }
}

function assertVideoValidator(io) {
  assertImageValidators(io);
  if (typeof io.assertDecodableVideo !== "function") {
    throw new Error("artifact validators are required: assertDecodableVideo");
  }
}

function assertImageArtifact(path, expectedHash, label, io) {
  assertImageValidators(io);
  if (!io.existsFile(path)) throw new Error(`${label} does not exist: ${path}`);
  if (io.hashFile(path) !== expectedHash) throw new Error(`${label} hash mismatch: ${path}`);
  io.assertDecodableImage(path);
}

function assertVideoArtifact(path, expectedHash, label, io) {
  assertVideoValidator(io);
  if (!io.existsFile(path)) throw new Error(`${label} does not exist: ${path}`);
  if (io.hashFile(path) !== expectedHash) throw new Error(`${label} hash mismatch: ${path}`);
  io.assertDecodableVideo(path);
}

function findCandidate(candidates, number, label) {
  const candidate = candidates.find((item) => item.candidate === number);
  if (!candidate) throw new Error(`${label} candidate ${number} is missing from report`);
  return candidate;
}

function rejectDuplicateCandidate(candidates, candidate, label) {
  if (candidates.some((item) => item.candidate === candidate)) {
    throw new Error(`${label} candidate ${candidate} already exists`);
  }
}

function hasAcceptedCandidate(candidates) {
  return candidates.some((candidate) => candidate.creativeAcceptance?.status === "accepted");
}

function hashForEndpoint(endpoint) {
  return endpoint.endpointSha256 || endpoint.compositeSha256;
}

function assertReviewedCreativeState(candidate, label) {
  const creative = candidate.creativeAcceptance;
  if (!creative || !["pending", "rejected", "accepted"].includes(creative.status)) {
    throw new Error(`${label} creative acceptance status is invalid`);
  }
  if (creative.status === "pending") return;
  requireValue(creative.note?.trim(), `${label} creative review note is required`);
  requireValue(creative.evidencePath, `${label} creative review evidence path is required`);
  requireValue(creative.evidenceSha256, `${label} creative review evidence hash is required`);
  if (!matchingPath(creative.evidencePath, candidate.evidencePath) || creative.evidenceSha256 !== candidate.evidenceSha256) {
    throw new Error(`${label} creative review evidence must match candidate evidence`);
  }
}

function normalizeEndpointCandidate(candidate) {
  requireCandidateNumber(candidate?.candidate, ENDPOINT_SEEDS, "endpoint");
  if (candidate.seed !== ENDPOINT_SEEDS[candidate.candidate - 1]) {
    throw new Error("endpoint candidate seed must match the fixed seed policy");
  }
  const compositePath = resolve(requireValue(candidate.compositePath, "endpoint composite path is required"));
  const compositeSha256 = requireValue(candidate.compositeSha256, "endpoint composite hash is required");
  const endpointPath = resolve(candidate.endpointPath || compositePath);
  const endpointSha256 = candidate.endpointSha256 || compositeSha256;
  const evidencePath = resolve(candidate.evidencePath || compositePath);
  const evidenceSha256 = candidate.evidenceSha256 || compositeSha256;
  return {
    ...candidate,
    endpointPath,
    endpointSha256,
    compositePath,
    compositeSha256,
    evidencePath,
    evidenceSha256,
    technicalAcceptance: { status: "accepted" },
    creativeAcceptance: { status: "pending" }
  };
}

function assertStoredEndpointCandidate(candidate) {
  requireCandidateNumber(candidate?.candidate, ENDPOINT_SEEDS, "endpoint");
  if (candidate.seed !== ENDPOINT_SEEDS[candidate.candidate - 1]) {
    throw new Error("endpoint candidate seed must match the fixed seed policy");
  }
  requireValue(candidate.endpointPath, "endpoint image path is required");
  requireValue(candidate.endpointSha256, "endpoint image hash is required");
  requireValue(candidate.compositePath, "endpoint composite path is required");
  requireValue(candidate.compositeSha256, "endpoint composite hash is required");
  requireValue(candidate.evidencePath, "endpoint evidence path is required");
  requireValue(candidate.evidenceSha256, "endpoint evidence hash is required");
  if (candidate.poseGuided === true) assertStoredPoseCandidate(candidate);
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} is required and must be a lowercase SHA-256`);
}

function assertStoredPoseCandidate(candidate) {
  for (const [field, label] of [
    ["sourcePosePath", "source pose path"], ["targetPosePath", "target pose path"],
    ["poseGuidePath", "pose guide path"], ["poseDiagnosticPath", "pose diagnostic path"],
    ["dwposePromptId", "DWPose Prompt ID"], ["qwenPromptId", "Qwen Prompt ID"]
  ]) requireValue(candidate[field], `${label} is required`);
  for (const [field, label] of [
    ["sourcePoseSha256", "source pose hash"], ["targetPoseSha256", "target pose hash"],
    ["poseGuideSha256", "pose guide hash"], ["poseDiagnosticSha256", "pose diagnostic hash"],
    ["compiledPromptSha256", "compiled prompt hash"]
  ]) requireSha256(candidate[field], label);
  if (!candidate.motion || typeof candidate.motion !== "object" || Array.isArray(candidate.motion)) throw new Error("pose motion is required");
  const blockHashes = candidate.promptBlockHashes;
  const expected = ["identity", "lighting", "performance", "spatialLayout", "style"];
  if (!blockHashes || JSON.stringify(Object.keys(blockHashes).sort()) !== JSON.stringify(expected)) throw new Error("five prompt block hashes are required");
  for (const name of expected) requireSha256(blockHashes[name], `${name} prompt block hash`);
}

function assertPoseArtifacts(candidate, io) {
  assertImageValidators(io);
  if (typeof io.readJson !== "function") throw new Error("pose artifact validator readJson is required");
  for (const [path, hash, label] of [
    [candidate.sourcePosePath, candidate.sourcePoseSha256, "source pose JSON"],
    [candidate.targetPosePath, candidate.targetPoseSha256, "target pose JSON"]
  ]) {
    if (!io.existsFile(path)) throw new Error(`${label} does not exist: ${path}`);
    if (io.hashFile(path) !== hash) throw new Error(`${label} hash mismatch: ${path}`);
  }
  assertImageArtifact(candidate.poseGuidePath, candidate.poseGuideSha256, "pose guide", io);
  assertImageArtifact(candidate.poseDiagnosticPath, candidate.poseDiagnosticSha256, "pose diagnostic", io);
  assertHalfStepTarget(io.readJson(candidate.sourcePosePath), io.readJson(candidate.targetPosePath), candidate.motion);
}

function normalizeVideoCandidate(report, candidate) {
  requireCandidateNumber(candidate?.candidate, VIDEO_SEEDS, "video");
  if (candidate.seed !== VIDEO_SEEDS[candidate.candidate - 1]) {
    throw new Error("video candidate seed must match the fixed seed policy");
  }
  if (candidate.probeOnly) throw new Error("probe-only video output cannot enter the production experiment");
  const endpoint = assertApprovedEndpoint(report);
  if (candidate.endpointCandidate !== endpoint.candidate || candidate.endpointSha256 !== hashForEndpoint(endpoint)) {
    throw new Error("video candidate must use the approved endpoint version and hash");
  }
  return {
    ...candidate,
    videoPath: resolve(requireValue(candidate.videoPath, "video path is required")),
    videoSha256: requireValue(candidate.videoSha256, "video hash is required"),
    evidencePath: resolve(requireValue(candidate.evidencePath, "video evidence path is required")),
    evidenceSha256: requireValue(candidate.evidenceSha256, "video evidence hash is required"),
    technicalAcceptance: { status: "accepted" },
    creativeAcceptance: { status: "pending" }
  };
}

function assertStoredVideoCandidate(report, candidate) {
  requireCandidateNumber(candidate?.candidate, VIDEO_SEEDS, "video");
  if (candidate.seed !== VIDEO_SEEDS[candidate.candidate - 1]) {
    throw new Error("video candidate seed must match the fixed seed policy");
  }
  if (candidate.probeOnly) throw new Error("probe-only video output cannot enter the production experiment");
  const endpoint = assertApprovedEndpoint(report);
  if (candidate.endpointCandidate !== endpoint.candidate || candidate.endpointSha256 !== hashForEndpoint(endpoint)) {
    throw new Error("video candidate must use the approved endpoint version and hash");
  }
  requireValue(candidate.videoPath, "video path is required");
  requireValue(candidate.videoSha256, "video hash is required");
  requireValue(candidate.evidencePath, "video evidence path is required");
  requireValue(candidate.evidenceSha256, "video evidence hash is required");
}

export function createExperimentReport(input) {
  if (isSameOrDescendant(input.experimentRoot, dirname(AUTHORITATIVE_REPORT_PATH))) {
    throw new Error("FLF2V experiment root must not overlap the authoritative one-take directory");
  }
  return {
    schemaVersion: 1,
    experimentType: "wan21-flf2v-controlled-half-step",
    createdAt: new Date().toISOString(),
    authoritativeReportPath: resolve(input.authoritativeReportPath),
    authoritativeReportSha256: input.authoritativeReportSha256,
    startFrame: { path: resolve(input.startFramePath), sha256: input.startFrameSha256, width: 1152, height: 640 },
    geometry: cloneGeometry(),
    endpointCandidates: [],
    videoCandidates: [],
    approvedEndpoint: null,
    approvedVideo: null,
    overallStatus: "endpoint-required"
  };
}

export function assertExperimentReportInvariant(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) throw new Error("experiment report must be an object");
  if (report.schemaVersion !== 1) throw new Error("experiment report schemaVersion must be 1");
  if (report.experimentType !== "wan21-flf2v-controlled-half-step") throw new Error("experiment report experimentType is invalid");
  requireValue(report.createdAt, "experiment report createdAt is required");
  if (!isAbsolute(report.authoritativeReportPath || "")) throw new Error("authoritative report path must be absolute");
  requireValue(report.authoritativeReportSha256, "authoritative report hash is required");
  if (!report.startFrame || !isAbsolute(report.startFrame.path || "")) throw new Error("start frame path must be absolute");
  requireValue(report.startFrame.sha256, "start frame hash is required");
  if (report.startFrame.width !== GEOMETRY.source.width || report.startFrame.height !== GEOMETRY.source.height) {
    throw new Error("start frame geometry is invalid");
  }
  if (!isDeepStrictEqual(report.geometry, GEOMETRY)) throw new Error("experiment report geometry is invalid");
  if (!Array.isArray(report.endpointCandidates)) throw new Error("endpointCandidates must be an array");
  if (!Array.isArray(report.videoCandidates)) throw new Error("videoCandidates must be an array");
  if (report.endpointCandidates.length > ENDPOINT_SEEDS.length) throw new Error("too many endpoint candidates");
  if (report.videoCandidates.length > VIDEO_SEEDS.length) throw new Error("too many video candidates");

  const endpointNumbers = new Set();
  for (const candidate of report.endpointCandidates) {
    assertStoredEndpointCandidate(candidate);
    if (endpointNumbers.has(candidate.candidate)) throw new Error(`duplicate endpoint candidate ${candidate.candidate}`);
    endpointNumbers.add(candidate.candidate);
    if (candidate.technicalAcceptance?.status !== "accepted") throw new Error("stored endpoint technical acceptance must be accepted");
    assertReviewedCreativeState(candidate, "endpoint");
  }
  const acceptedEndpoints = report.endpointCandidates.filter((candidate) => candidate.creativeAcceptance.status === "accepted");
  if (acceptedEndpoints.length > 1) throw new Error("exactly one accepted endpoint history candidate is allowed");
  if (acceptedEndpoints.length === 0) {
    if (report.approvedEndpoint !== null) throw new Error("approvedEndpoint requires an accepted endpoint history candidate");
    if (report.videoCandidates.length !== 0 || report.approvedVideo !== null) throw new Error("an approved endpoint is required before video candidates");
    if (report.overallStatus !== "endpoint-required") throw new Error("overallStatus must be endpoint-required");
    return report;
  }

  if (!report.approvedEndpoint) throw new Error("accepted endpoint history requires an approvedEndpoint pointer");
  const approvedEndpoint = assertApprovedEndpoint(report);
  if (!isDeepStrictEqual(report.approvedEndpoint, approvedEndpoint)) throw new Error("approvedEndpoint pointer must equal accepted endpoint history");

  const videoNumbers = new Set();
  for (const candidate of report.videoCandidates) {
    assertStoredVideoCandidate(report, candidate);
    if (videoNumbers.has(candidate.candidate)) throw new Error(`duplicate video candidate ${candidate.candidate}`);
    videoNumbers.add(candidate.candidate);
    if (candidate.technicalAcceptance?.status !== "accepted") throw new Error("stored video technical acceptance must be accepted");
    assertReviewedCreativeState(candidate, "video");
  }
  const acceptedVideos = report.videoCandidates.filter((candidate) => candidate.creativeAcceptance.status === "accepted");
  if (acceptedVideos.length > 1) throw new Error("exactly one accepted video history candidate is allowed");
  if (acceptedVideos.length === 0) {
    if (report.approvedVideo !== null) throw new Error("approvedVideo requires an accepted video history candidate");
    if (report.overallStatus !== "video-required") throw new Error("overallStatus must be video-required");
    return report;
  }
  if (!report.approvedVideo) throw new Error("accepted video history requires an approvedVideo pointer");
  const acceptedVideo = acceptedVideos[0];
  if (!isDeepStrictEqual(report.approvedVideo, acceptedVideo)) throw new Error("approvedVideo pointer must equal accepted video history");
  if (report.overallStatus !== "accepted") throw new Error("overallStatus must be accepted");
  return report;
}

export function markEndpointTechnical(report, candidate) {
  if (report.approvedEndpoint) throw new Error("an approved endpoint already exists");
  const normalized = normalizeEndpointCandidate(candidate);
  rejectDuplicateCandidate(report.endpointCandidates, normalized.candidate, "endpoint");
  return { ...report, endpointCandidates: [...report.endpointCandidates, normalized] };
}

export function applyEndpointReview(report, review, io) {
  requireCandidateNumber(review?.candidate, ENDPOINT_SEEDS, "endpoint");
  const candidate = findCandidate(report.endpointCandidates, review.candidate, "endpoint");
  assertStoredEndpointCandidate(candidate);
  assertTechnicalCandidate(candidate, "endpoint");
  assertReview(review, candidate);
  if (review.decision === "accepted" && (report.approvedEndpoint || hasAcceptedCandidate(report.endpointCandidates))) {
    throw new Error("an endpoint has already been accepted");
  }
  if (review.decision === "accepted") {
    assertImageArtifact(candidate.endpointPath, candidate.endpointSha256, "endpoint image", io);
    assertImageArtifact(candidate.compositePath, candidate.compositeSha256, "endpoint composite", io);
    assertImageArtifact(candidate.evidencePath, candidate.evidenceSha256, "endpoint evidence", io);
    if (candidate.poseGuided === true) assertPoseArtifacts(candidate, io);
  }
  const reviewed = {
    ...candidate,
    creativeAcceptance: {
      status: review.decision,
      note: review.note.trim(),
      evidencePath: resolve(review.evidencePath),
      evidenceSha256: review.evidenceSha256,
      reviewedAt: review.reviewedAt || new Date().toISOString()
    }
  };
  const endpointCandidates = report.endpointCandidates.map((item) => item.candidate === reviewed.candidate ? reviewed : item);
  if (review.decision === "rejected") return { ...report, endpointCandidates };
  return {
    ...report,
    endpointCandidates,
    approvedEndpoint: reviewed,
    approvedVideo: null,
    overallStatus: "video-required"
  };
}

export function assertApprovedEndpoint(report, io) {
  const pointer = report?.approvedEndpoint;
  if (!pointer || pointer.creativeAcceptance?.status !== "accepted" || pointer.technicalAcceptance?.status !== "accepted") {
    throw new Error("approved endpoint is required");
  }
  const acceptedHistory = (report.endpointCandidates || []).filter((candidate) => candidate.creativeAcceptance?.status === "accepted");
  if (acceptedHistory.length !== 1) {
    throw new Error("exactly one accepted endpoint history candidate is required");
  }
  const endpoint = acceptedHistory[0];
  assertStoredEndpointCandidate(endpoint);
  if (endpoint.technicalAcceptance?.status !== "accepted") {
    throw new Error("accepted endpoint history candidate must have technical acceptance");
  }
  const creativeAcceptance = endpoint.creativeAcceptance;
  if (!creativeAcceptance.note?.trim()) {
    throw new Error("accepted endpoint creative note is required");
  }
  if (!creativeAcceptance.evidencePath || !creativeAcceptance.evidenceSha256) {
    throw new Error("accepted endpoint creative evidence path and hash are required");
  }
  if (!matchingPath(creativeAcceptance.evidencePath, endpoint.evidencePath) || creativeAcceptance.evidenceSha256 !== endpoint.evidenceSha256) {
    throw new Error("accepted endpoint creative evidence must match candidate evidence");
  }
  const matchingFields = [
    pointer.candidate === endpoint.candidate,
    pointer.seed === endpoint.seed,
    matchingPath(pointer.endpointPath, endpoint.endpointPath),
    pointer.endpointSha256 === endpoint.endpointSha256,
    matchingPath(pointer.compositePath, endpoint.compositePath),
    pointer.compositeSha256 === endpoint.compositeSha256,
    matchingPath(pointer.evidencePath, endpoint.evidencePath),
    pointer.evidenceSha256 === endpoint.evidenceSha256,
    pointer.creativeAcceptance?.status === endpoint.creativeAcceptance?.status,
    pointer.creativeAcceptance?.note === endpoint.creativeAcceptance?.note,
    matchingPath(pointer.creativeAcceptance?.evidencePath, endpoint.creativeAcceptance?.evidencePath),
    pointer.creativeAcceptance?.evidenceSha256 === endpoint.creativeAcceptance?.evidenceSha256,
    pointer.creativeAcceptance?.reviewedAt === endpoint.creativeAcceptance?.reviewedAt
  ];
  if (matchingFields.some((matches) => !matches)) {
    throw new Error("approved endpoint does not match its accepted history candidate");
  }
  if (!io) return endpoint;
  assertImageValidators(io);
  const artifacts = [
    [endpoint.endpointPath, endpoint.endpointSha256],
    [endpoint.compositePath, endpoint.compositeSha256],
    [endpoint.evidencePath, endpoint.evidenceSha256]
  ];
  for (const [path, expectedHash] of artifacts) {
    assertImageArtifact(path, expectedHash, "approved endpoint artifact", io);
  }
  if (endpoint.poseGuided === true) assertPoseArtifacts(endpoint, io);
  return endpoint;
}

export function markVideoTechnical(report, candidate) {
  if (report.approvedVideo) throw new Error("an approved video already exists");
  const normalized = normalizeVideoCandidate(report, candidate);
  rejectDuplicateCandidate(report.videoCandidates, normalized.candidate, "video");
  return { ...report, videoCandidates: [...report.videoCandidates, normalized] };
}

export function applyVideoReview(report, review, io) {
  requireCandidateNumber(review?.candidate, VIDEO_SEEDS, "video");
  const candidate = findCandidate(report.videoCandidates, review.candidate, "video");
  assertStoredVideoCandidate(report, candidate);
  assertTechnicalCandidate(candidate, "video");
  assertReview(review, candidate);
  const endpoint = assertApprovedEndpoint(report);
  if (candidate.endpointCandidate !== endpoint.candidate || candidate.endpointSha256 !== hashForEndpoint(endpoint)) {
    throw new Error("video candidate must use the approved endpoint version and hash");
  }
  if (review.decision === "accepted" && (report.approvedVideo || hasAcceptedCandidate(report.videoCandidates))) {
    throw new Error("a video has already been accepted");
  }
  if (review.decision === "accepted") {
    assertApprovedEndpoint(report, io);
    assertVideoArtifact(candidate.videoPath, candidate.videoSha256, "candidate video", io);
    assertImageArtifact(candidate.evidencePath, candidate.evidenceSha256, "video evidence", io);
  }
  const reviewed = {
    ...candidate,
    creativeAcceptance: {
      status: review.decision,
      note: review.note.trim(),
      evidencePath: resolve(review.evidencePath),
      evidenceSha256: review.evidenceSha256,
      reviewedAt: review.reviewedAt || new Date().toISOString()
    }
  };
  const videoCandidates = report.videoCandidates.map((item) => item.candidate === reviewed.candidate ? reviewed : item);
  if (review.decision === "rejected") return { ...report, videoCandidates };
  return { ...report, videoCandidates, approvedVideo: reviewed, overallStatus: "accepted" };
}

export function assertAuthoritativeUnchanged(report, hashFile) {
  if (typeof hashFile !== "function") throw new Error("hashFile is required");
  const actualHash = hashFile(report.authoritativeReportPath);
  if (actualHash !== report.authoritativeReportSha256) {
    throw new Error("authoritative one-take report has changed since this experiment began");
  }
}
