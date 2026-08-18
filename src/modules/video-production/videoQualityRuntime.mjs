const SEMANTIC_REVIEW_ITEMS = Object.freeze([
  "character_identity", "scene_anchor", "costume_prop", "motion_boundary", "color_continuity"
]);
const HEX64 = /^[a-f0-9]{64}$/;
const CONTINUITY_KINDS = new Set(["continuous", "match_cut"]);

export function evaluateVideoQuality(input = {}) {
  const source = record(input);
  const issues = [];
  if (source.normalized !== true) issues.push("segment_not_normalized");
  const credential = validateCredential(source.normalizationCredential, issues);
  const inspection = validateInspection(source.inspection, issues);
  validateReviewFrames(source.reviewFrames, issues);
  validateMetric(source, "blackFrameCount", issues);
  validateMetric(source, "freezeDurationSeconds", issues);
  validateMetric(source, "timestampErrors", issues);
  if (source.blackFrameCount > 0) issues.push("black_frames_detected");
  if (source.freezeDurationSeconds > 0.5) issues.push("freeze_exceeds_0_5_seconds");
  if (source.timestampErrors > 0) issues.push("timestamp_discontinuity");
  if (credential && inspection && stable(credential.probe) !== stable(inspection.probe)) issues.push("credential_inspection_mismatch");
  if (source.assemblyReceipt !== undefined) validateAssemblyReceipt(source.assemblyReceipt, issues);
  return {
    status: issues.length ? "rejected" : "needs_review",
    structuralIssues: sortedUnique(issues),
    semanticReviewItems: [...SEMANTIC_REVIEW_ITEMS]
  };
}

export function createVideoArtifactBinding(input = {}) {
  const issues = [];
  const source = record(input);
  const credential = validateCredential(source.normalizationCredential, issues);
  const inspection = validateInspection(source.inspection, issues);
  const frames = validateReviewFrames(source.reviewFrames, issues);
  const assembly = source.assemblyReceipt === undefined ? null : validateAssemblyReceipt(source.assemblyReceipt, issues);
  if (credential && inspection && stable(credential.probe) !== stable(inspection.probe)) issues.push("credential_inspection_mismatch");
  if (issues.length || !credential || !inspection || !frames) throw new Error(`artifact_binding_invalid:${sortedUnique(issues).join(",")}`);
  return {
    schemaVersion: 1,
    receiptId: credential.receiptId,
    normalizedPath: credential.normalizedPath,
    sha256: credential.sha256,
    byteLength: credential.byteLength,
    modifiedUnixMillis: credential.modifiedUnixMillis,
    width: credential.projectWidth,
    height: credential.projectHeight,
    durationFrames: credential.durationFrames,
    decodedFrameCount: credential.probe.decodedFrameCount,
    reviewFramesDigest: digest64(stable(frames)),
    ...(assembly ? {
      assemblyTransactionId: assembly.transactionId,
      assemblySha256: assembly.sha256,
      assemblyOutputPath: assembly.outputPath
    } : {})
  };
}

export function createVideoQualityReport(shotId, input = {}) {
  const source = record(input);
  const evaluation = evaluateVideoQuality(source);
  const rawFrames = record(source.reviewFrames);
  const report = {
    shotId: text(shotId),
    status: evaluation.status,
    structuralIssues: [...evaluation.structuralIssues],
    semanticReviewItems: [...SEMANTIC_REVIEW_ITEMS],
    reviewFrames: {
      first: text(rawFrames.first ?? rawFrames.firstFramePath),
      middle: text(rawFrames.middle ?? rawFrames.middleFramePath),
      last: text(rawFrames.last ?? rawFrames.lastFramePath)
    }
  };
  if (!evaluation.structuralIssues.length) report.artifactBinding = createVideoArtifactBinding(source);
  const boundaryFrame = text(source.boundaryFrame);
  if (boundaryFrame) report.boundaryFrame = boundaryFrame;
  return report;
}

export function applyVideoQualityDecision(report, decision = {}) {
  const current = normalizeReport(report);
  const action = record(decision);
  if (action.decision === "approve") {
    if (current.status === "rejected" || current.structuralIssues.length || !current.artifactBinding) return current;
    const decided = { decision: "approved", reviewedAt: timestamp(action.reviewedAt), artifactBinding: clone(current.artifactBinding) };
    return { ...current, status: "approved", reviewedByUserAt: decided.reviewedAt, decision: decided };
  }
  if (action.decision === "reject") {
    const reason = text(action.reason);
    if (!reason) throw new Error("rejection_reason_required");
    if (!current.artifactBinding) throw new Error("artifact_binding_required");
    const decided = { decision: "rejected", reviewedAt: timestamp(action.reviewedAt), reason, artifactBinding: clone(current.artifactBinding) };
    return { ...current, status: "rejected", reviewedByUserAt: decided.reviewedAt, rejectionReason: reason, decision: decided };
  }
  throw new Error("video_quality_decision_invalid");
}

export function resolvePersistedVideoDecision(report, decision) {
  const current = normalizeReport(report);
  const saved = record(decision);
  if (current.status === "rejected" || current.structuralIssues.length || !current.artifactBinding) return { ...current, decision: undefined };
  if (!validDecision(saved) || !artifactBindingsEqual(current.artifactBinding, saved.artifactBinding)) {
    return { ...current, status: "needs_review", decision: undefined, reviewedByUserAt: undefined, rejectionReason: undefined };
  }
  return saved.decision === "approved"
    ? { ...current, status: "approved", reviewedByUserAt: saved.reviewedAt, decision: clone(saved) }
    : { ...current, status: "rejected", reviewedByUserAt: saved.reviewedAt, rejectionReason: saved.reason, decision: clone(saved) };
}

export function artifactBindingsEqual(left, right) {
  return validBinding(left) && validBinding(right) && stable(left) === stable(right);
}

export function planVideoRebuildRequest(input = {}) {
  const source = record(input);
  const shotId = text(source.shotId);
  const reason = text(source.reason);
  const ids = Array.isArray(source.orderedShotIds) ? source.orderedShotIds.map(text).filter(Boolean) : [];
  if (!shotId || !ids.includes(shotId)) throw new Error("rebuild_shot_not_found");
  if (!reason) throw new Error("rejection_reason_required");
  if (new Set(ids).size !== ids.length) throw new Error("duplicate_rebuild_shot_id");
  const single = { kind: "shot", shotIds: [shotId], reason };
  if (reason !== "motion_boundary") return single;
  const boundary = record(source.boundary);
  if (!CONTINUITY_KINDS.has(boundary.kind)) return single;
  const from = text(boundary.fromShotId), to = text(boundary.toShotId);
  if (!text(boundary.id) || boundary.requiresApproval !== true || boundary.approvalStatus !== "approved") throw new Error("boundary_not_approved");
  if (!text(boundary.sharedFramePath)) throw new Error("boundary_frame_missing");
  if (from !== shotId) throw new Error("boundary_direction_invalid");
  const fromIndex = ids.indexOf(from), toIndex = ids.indexOf(to);
  if (fromIndex < 0 || toIndex !== fromIndex + 1) throw new Error("boundary_shots_not_adjacent");
  return { kind: "adjacent_pair", shotIds: [from, to], reason };
}

function validateCredential(value, issues) {
  const item = record(value);
  if (!item || item.schemaVersion !== 1 || !HEX64.test(text(item.receiptId)) || !absolute(item.normalizedPath) || !HEX64.test(text(item.sha256)) || !positiveInt(item.byteLength) || !positiveInt(item.modifiedUnixMillis) || !positiveInt(item.projectWidth) || !positiveInt(item.projectHeight) || !positiveInt(item.durationFrames) || item.tampered === true || item.replayed === true) {
    issues.push("normalization_credential_invalid");
    return null;
  }
  const probe = validateProbe(item.probe, issues, "credential_probe_invalid");
  if (!probe || probe.width !== item.projectWidth || probe.height !== item.projectHeight || probe.decodedFrameCount !== item.durationFrames) issues.push("credential_media_mismatch");
  return probe ? item : null;
}

function validateInspection(value, issues) {
  const item = record(value);
  if (!item) { issues.push("inspection_invalid"); return null; }
  const probe = validateProbe(item.probe, issues, "inspection_probe_invalid");
  const anomalies = record(item.anomalies);
  if (!anomalies || !Array.isArray(anomalies.blackIntervals) || !Array.isArray(anomalies.freezeIntervals)) { issues.push("inspection_anomalies_invalid"); return null; }
  let valid = true;
  for (const interval of [...anomalies.blackIntervals, ...anomalies.freezeIntervals]) valid = validateInterval(interval) && valid;
  if (!valid) issues.push("inspection_anomalies_invalid");
  if (anomalies.blackIntervals.length) issues.push("black_frames_detected");
  if (anomalies.freezeIntervals.some((item) => item.durationSeconds > 0.5)) issues.push("freeze_exceeds_0_5_seconds");
  return probe && valid ? item : null;
}

function validateProbe(value, issues, code) {
  const item = record(value);
  const valid = item && positiveInt(item.width) && positiveInt(item.height) && item.fpsNum === 24 && item.fpsDen === 1 && finiteNonnegative(item.durationSeconds) && item.videoCodec === "h264" && item.pixelFormat === "yuv420p" && item.audioSampleRate === 48000 && item.audioChannels === 2 && item.hasMonotonicTimestamps === true && item.hasConstantFrameTimestamps === true && positiveInt(item.decodedFrameCount);
  if (!valid) issues.push(code);
  return valid ? item : null;
}

function validateReviewFrames(value, issues) {
  const item = record(value);
  const frames = { first: text(item.first ?? item.firstFramePath), middle: text(item.middle ?? item.middleFramePath), last: text(item.last ?? item.lastFramePath) };
  if (!absolute(frames.first) || !absolute(frames.middle) || !absolute(frames.last) || new Set(Object.values(frames)).size !== 3) { issues.push("review_frames_invalid"); return null; }
  return frames;
}

function validateAssemblyReceipt(value, issues) {
  const item = record(value);
  if (!item || item.schemaVersion !== 1 || !HEX64.test(text(item.keyId)) || !HEX64.test(text(item.transactionId)) || !HEX64.test(text(item.runId)) || !absolute(item.canonicalProjectRoot) || !absolute(item.outputPath) || !HEX64.test(text(item.sha256)) || !positiveInt(item.byteLength) || !positiveInt(item.modifiedUnixMillis) || !validateProbe(item.probe, issues, "assembly_probe_invalid") || !Array.isArray(item.orderedReceiptIds) || !item.orderedReceiptIds.length || item.orderedReceiptIds.some((id) => !HEX64.test(text(id))) || !HEX64.test(text(item.mac))) {
    issues.push("assembly_receipt_invalid");
    return null;
  }
  return item;
}

function validateMetric(source, key, issues) {
  if (source[key] !== undefined && !finiteNonnegative(source[key])) issues.push(`invalid_metric:${key}`);
}
function validateInterval(value) { const item = record(value); return item && finiteNonnegative(item.startSeconds) && finiteNonnegative(item.endSeconds) && finiteNonnegative(item.durationSeconds) && item.endSeconds >= item.startSeconds && Math.abs((item.endSeconds - item.startSeconds) - item.durationSeconds) < 0.01; }
function normalizeReport(value) { const item = record(value); return { shotId: text(item.shotId), status: ["rejected", "needs_review", "approved"].includes(item.status) ? item.status : "rejected", structuralIssues: sortedUnique(Array.isArray(item.structuralIssues) ? item.structuralIssues.map(text).filter(Boolean) : ["report_invalid"]), semanticReviewItems: [...SEMANTIC_REVIEW_ITEMS], reviewFrames: { first: text(item.reviewFrames?.first), middle: text(item.reviewFrames?.middle), last: text(item.reviewFrames?.last) }, ...(validBinding(item.artifactBinding) ? { artifactBinding: clone(item.artifactBinding) } : {}), ...(text(item.boundaryFrame) ? { boundaryFrame: text(item.boundaryFrame) } : {}) }; }
function validBinding(value) { const item = record(value); const hasAssembly = item.assemblyTransactionId !== undefined || item.assemblySha256 !== undefined || item.assemblyOutputPath !== undefined; return item?.schemaVersion === 1 && HEX64.test(text(item.receiptId)) && absolute(item.normalizedPath) && HEX64.test(text(item.sha256)) && positiveInt(item.byteLength) && positiveInt(item.modifiedUnixMillis) && positiveInt(item.width) && positiveInt(item.height) && positiveInt(item.durationFrames) && item.decodedFrameCount === item.durationFrames && HEX64.test(text(item.reviewFramesDigest)) && (!hasAssembly || (HEX64.test(text(item.assemblyTransactionId)) && HEX64.test(text(item.assemblySha256)) && absolute(item.assemblyOutputPath))); }
function validDecision(value) { const item = record(value); return (item.decision === "approved" || (item.decision === "rejected" && text(item.reason))) && Number.isFinite(Date.parse(text(item.reviewedAt))) && validBinding(item.artifactBinding); }
function digest64(value) { const seeds = [1469598103934665603n, 1099511628211n, 7809847782465536322n, 9650029242287828579n]; return seeds.map((seed) => { let hash = seed; for (const ch of value) hash = BigInt.asUintN(64, (hash ^ BigInt(ch.codePointAt(0))) * 1099511628211n); return hash.toString(16).padStart(16, "0"); }).join(""); }
function timestamp(value) { const raw = text(value) || new Date().toISOString(); if (!Number.isFinite(Date.parse(raw))) throw new Error("review_timestamp_invalid"); return new Date(raw).toISOString(); }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function text(value) { return typeof value === "string" ? value.trim() : ""; }
function absolute(value) { const raw = text(value); return raw.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(raw) || /^\\\\[^\\]+\\[^\\]+/.test(raw); }
function positiveInt(value) { return Number.isSafeInteger(value) && value > 0; }
function finiteNonnegative(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function stable(value) { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; }
function sortedUnique(values) { return [...new Set(values)].sort(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
