const SEMANTIC_REVIEW_ITEMS = Object.freeze([
  "character_identity",
  "scene_anchor",
  "costume_prop",
  "motion_boundary",
  "color_continuity"
]);

const CONTINUITY_BOUNDARY_KINDS = new Set(["continuous", "match_cut"]);

export function evaluateVideoQuality(input = {}) {
  const source = isRecord(input) ? input : {};
  const issues = [];
  if (source.normalized !== true) issues.push("segment_not_normalized");

  const inspection = isRecord(source.inspection) ? source.inspection : {};
  const probe = isRecord(inspection.probe) ? inspection.probe : {};
  const anomalies = isRecord(inspection.anomalies) ? inspection.anomalies : {};
  const blackIntervals = Array.isArray(anomalies.blackIntervals) ? anomalies.blackIntervals : [];
  const freezeIntervals = Array.isArray(anomalies.freezeIntervals) ? anomalies.freezeIntervals : [];
  const blackFrameCount = positiveNumber(source.blackFrameCount) + blackIntervals.length;
  const longestFreeze = Math.max(
    positiveNumber(source.freezeDurationSeconds),
    0,
    ...freezeIntervals.map((interval) => positiveNumber(interval?.durationSeconds))
  );
  const timestampErrors = positiveNumber(source.timestampErrors);

  if (blackFrameCount > 0) issues.push("black_frames_detected");
  if (longestFreeze > 0.5) issues.push("freeze_exceeds_0_5_seconds");
  if (
    timestampErrors > 0 ||
    probe.hasMonotonicTimestamps === false ||
    probe.hasConstantFrameTimestamps === false
  ) issues.push("timestamp_discontinuity");

  inspectSuppliedReceipt(source.normalizationReceipt, "normalization_receipt", issues);
  inspectSuppliedReceipt(source.assemblyReceipt, "assembly_receipt", issues);

  return {
    status: issues.length > 0 ? "rejected" : "needs_review",
    structuralIssues: sortedUnique(issues),
    semanticReviewItems: [...SEMANTIC_REVIEW_ITEMS]
  };
}

export function createVideoQualityReport(shotId, input = {}) {
  const source = isRecord(input) ? input : {};
  const evaluation = evaluateVideoQuality(source);
  const frames = isRecord(source.reviewFrames) ? source.reviewFrames : {};
  const report = {
    shotId: cleanText(shotId),
    status: evaluation.status,
    structuralIssues: [...evaluation.structuralIssues],
    semanticReviewItems: [...evaluation.semanticReviewItems],
    reviewFrames: {
      first: cleanText(frames.first ?? frames.firstFramePath),
      middle: cleanText(frames.middle ?? frames.middleFramePath),
      last: cleanText(frames.last ?? frames.lastFramePath)
    }
  };
  const boundaryFrame = cleanText(source.boundaryFrame);
  if (boundaryFrame) report.boundaryFrame = boundaryFrame;
  return report;
}

export function applyVideoQualityDecision(report, decision = {}) {
  const current = normalizeReport(report);
  const action = isRecord(decision) ? decision : {};
  if (action.decision === "approve") {
    if (current.status === "rejected" || current.structuralIssues.length > 0) return current;
    const reviewedAt = normalizeReviewTimestamp(action.reviewedAt);
    return { ...current, status: "approved", reviewedByUserAt: reviewedAt };
  }
  if (action.decision === "reject") {
    const reason = cleanText(action.reason);
    if (!reason) throw new Error("rejection_reason_required");
    const reviewedAt = normalizeReviewTimestamp(action.reviewedAt);
    return {
      ...current,
      status: "rejected",
      rejectionReason: reason,
      reviewedByUserAt: reviewedAt
    };
  }
  throw new Error("video_quality_decision_invalid");
}

export function planVideoRebuildRequest(input = {}) {
  const source = isRecord(input) ? input : {};
  const shotId = cleanText(source.shotId);
  const reason = cleanText(source.reason);
  const orderedShotIds = normalizeOrderedShotIds(source.orderedShotIds);
  if (!shotId || !orderedShotIds.includes(shotId)) throw new Error("rebuild_shot_not_found");
  if (!reason) throw new Error("rejection_reason_required");

  const fallback = { kind: "shot", shotIds: [shotId], reason };
  if (reason !== "motion_boundary" || !isRecord(source.boundary)) return fallback;
  const boundary = source.boundary;
  if (!CONTINUITY_BOUNDARY_KINDS.has(boundary.kind)) return fallback;
  const fromShotId = cleanText(boundary.fromShotId);
  const toShotId = cleanText(boundary.toShotId);
  if (!fromShotId || !toShotId || (shotId !== fromShotId && shotId !== toShotId)) return fallback;
  const fromIndex = orderedShotIds.indexOf(fromShotId);
  const toIndex = orderedShotIds.indexOf(toShotId);
  if (fromIndex < 0 || toIndex < 0 || Math.abs(fromIndex - toIndex) !== 1) {
    throw new Error("boundary_shots_not_adjacent");
  }
  const pair = fromIndex < toIndex ? [fromShotId, toShotId] : [toShotId, fromShotId];
  return { kind: "adjacent_pair", shotIds: pair, reason };
}

function inspectSuppliedReceipt(receipt, label, issues) {
  if (receipt === undefined || receipt === null) return;
  if (!isRecord(receipt)) {
    issues.push(`${label}_invalid`);
    return;
  }
  const status = cleanText(receipt.status);
  const hasNativeIdentity = receipt.schemaVersion === 1 && (
    cleanText(receipt.receiptId) || cleanText(receipt.transactionId)
  );
  const statusKnown = status === "verified" || (!status && hasNativeIdentity);
  if (
    !statusKnown ||
    receipt.tampered === true ||
    receipt.valid === false ||
    receipt.verified === false
  ) issues.push(`${label}_invalid`);
}

function normalizeReport(report) {
  const source = isRecord(report) ? report : {};
  const frames = isRecord(source.reviewFrames) ? source.reviewFrames : {};
  const status = ["rejected", "needs_review", "approved"].includes(source.status)
    ? source.status
    : "rejected";
  return {
    shotId: cleanText(source.shotId),
    status,
    structuralIssues: sortedUnique(Array.isArray(source.structuralIssues) ? source.structuralIssues.map(cleanText).filter(Boolean) : []),
    semanticReviewItems: normalizeSemanticItems(source.semanticReviewItems),
    reviewFrames: {
      first: cleanText(frames.first),
      middle: cleanText(frames.middle),
      last: cleanText(frames.last)
    },
    ...(cleanText(source.boundaryFrame) ? { boundaryFrame: cleanText(source.boundaryFrame) } : {}),
    ...(cleanText(source.reviewedByUserAt) ? { reviewedByUserAt: cleanText(source.reviewedByUserAt) } : {}),
    ...(cleanText(source.rejectionReason) ? { rejectionReason: cleanText(source.rejectionReason) } : {})
  };
}

function normalizeSemanticItems(value) {
  if (!Array.isArray(value)) return [...SEMANTIC_REVIEW_ITEMS];
  const requested = new Set(value.map(cleanText));
  return SEMANTIC_REVIEW_ITEMS.filter((item) => requested.has(item));
}

function normalizeOrderedShotIds(value) {
  const ids = Array.isArray(value) ? value.map(cleanText).filter(Boolean) : [];
  if (new Set(ids).size !== ids.length) throw new Error("duplicate_rebuild_shot_id");
  return ids;
}

function normalizeReviewTimestamp(value) {
  const supplied = cleanText(value);
  if (!supplied) return new Date().toISOString();
  if (!Number.isFinite(Date.parse(supplied))) throw new Error("review_timestamp_invalid");
  return new Date(supplied).toISOString();
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareText);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
