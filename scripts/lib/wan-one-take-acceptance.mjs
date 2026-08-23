import assert from "node:assert/strict";

const decisions = new Set(["accepted", "rejected"]);

function requireReview({ decision, note, evidencePath, reviewedAt }) {
  if (!decisions.has(decision)) throw new Error(`invalid creative decision: ${decision}`);
  if (!note?.trim()) throw new Error("review note is required");
  if (!evidencePath?.trim()) throw new Error("review evidencePath is required");
  if (!reviewedAt?.trim()) throw new Error("reviewedAt is required");
}

export function markTechnicalAccepted(segment, attempt) {
  for (const field of ["inputSha256", "finalFrameSha256", "promptId", "videoPath", "finalFramePath"]) {
    if (!attempt?.[field]) throw new Error(`technical attempt is missing ${field}`);
  }
  return {
    ...segment,
    technicalAccepted: true,
    creativeAcceptance: { status: "pending" },
    accepted: false,
    acceptedAttempt: attempt.attempt,
    seed: attempt.seed,
    inputSha256: attempt.inputSha256,
    finalFrameSha256: attempt.finalFrameSha256,
    promptId: attempt.promptId,
    elapsedSeconds: attempt.elapsedSeconds,
    videoPath: attempt.videoPath,
    finalFramePath: attempt.finalFramePath
  };
}

export function applyCreativeReview(segment, review) {
  requireReview(review);
  if (!segment?.technicalAccepted) throw new Error(`technical acceptance is required for ${segment?.id || "segment"}`);
  const status = review.decision;
  return {
    ...segment,
    creativeAcceptance: {
      status,
      note: review.note.trim(),
      evidencePath: review.evidencePath,
      reviewedAt: review.reviewedAt
    },
    accepted: status === "accepted"
  };
}

export function assertAcceptedPrefix({ segments, expectedCount, initialFrameHash, hashFile, existsFile }) {
  assert.equal(typeof existsFile, "function", "existsFile is required");
  assert.equal(segments.length, expectedCount, `accepted prefix must contain ${expectedCount} segments`);
  for (const [index, segment] of segments.entries()) {
    const expectedId = `segment_${String(index + 1).padStart(3, "0")}`;
    assert.equal(segment.id, expectedId);
    assert.equal(segment.order, index + 1);
    assert.equal(segment.technicalAccepted, true, `${expectedId} technical acceptance is required`);
    assert.equal(segment.creativeAcceptance?.status, "accepted", `${expectedId} creative acceptance is required`);
    assert.equal(segment.accepted, true, `${expectedId} combined acceptance is required`);
    assert.ok(segment.videoPath && segment.finalFramePath && segment.finalFrameSha256);
    assert.equal(existsFile(segment.videoPath), true, `accepted prefix file does not exist: ${segment.videoPath}`);
    assert.equal(existsFile(segment.finalFramePath), true, `accepted prefix file does not exist: ${segment.finalFramePath}`);
    assert.equal(hashFile(segment.finalFramePath), segment.finalFrameSha256, `${expectedId} final-frame hash mismatch`);
    if (index === 0) assert.equal(segment.inputSha256, initialFrameHash);
    else assert.equal(segment.inputSha256, segments[index - 1].finalFrameSha256);
  }
}

export function canAssemble(segments) {
  return Array.isArray(segments) && segments.length === 6 && segments.every((segment) =>
    segment.technicalAccepted === true &&
    segment.creativeAcceptance?.status === "accepted" &&
    segment.accepted === true
  );
}

function frameRateEquals(value, expected) {
  const [numerator, denominator] = String(value).split("/").map(Number);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 && numerator / denominator === expected;
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

export function assertFinalReviewAssembly(report) {
  if (!canAssemble(report?.segments)) throw new Error("six accepted segments are required for final review");
  const assembly = report?.assembly;
  if (!assembly?.nativePath?.trim() || !assembly?.deliveryPath?.trim()) {
    throw new Error("assembled native and delivery media are required for final review");
  }
  const native = assembly.nativeMetadata;
  const delivery = assembly.deliveryMetadata;
  const boundarySheetPaths = assembly.evidence?.boundarySheetPaths;
  const boundarySheetSha256s = assembly.integrity?.boundarySheetSha256s;
  const complete =
    native?.codec_name === "h264" &&
    Number(native?.width) === 832 &&
    Number(native?.height) === 480 &&
    frameRateEquals(native?.r_frame_rate, 16) &&
    Number(native?.nb_frames) === 97 &&
    Number(assembly.nativeFrameCount) === 97 &&
    Number(assembly.expectedNativeFrameCount) === 97 &&
    delivery?.codec_name === "h264" &&
    Number(delivery?.width) === 832 &&
    Number(delivery?.height) === 480 &&
    frameRateEquals(delivery?.r_frame_rate, 24) &&
    Boolean(assembly.evidence?.fullContactSheetPath?.trim()) &&
    Array.isArray(boundarySheetPaths) &&
    boundarySheetPaths.length === 5 &&
    boundarySheetPaths.every((path) => Boolean(path?.trim())) &&
    isSha256(assembly.integrity?.nativeSha256) &&
    isSha256(assembly.integrity?.deliverySha256) &&
    isSha256(assembly.integrity?.fullContactSheetSha256) &&
    Array.isArray(boundarySheetSha256s) &&
    boundarySheetSha256s.length === 5 &&
    boundarySheetSha256s.every(isSha256);
  if (!complete) throw new Error("complete assembly metadata and evidence are required for final review");
  return assembly;
}

export function markFinalReviewPending(report) {
  assertFinalReviewAssembly(report);
  return {
    ...report,
    finalAcceptance: { status: "pending" },
    overallAccepted: false
  };
}

export function applyFinalReview(report, review) {
  requireReview(review);
  if (review.decision === "rejected") {
    if (!["pending", "accepted"].includes(report?.finalAcceptance?.status)) {
      throw new Error("pending or accepted final acceptance is required before rejecting final review");
    }
    return {
      ...report,
      finalAcceptance: {
        status: "rejected",
        note: review.note.trim(),
        evidencePath: review.evidencePath,
        reviewedAt: review.reviewedAt
      },
      overallAccepted: false
    };
  }
  if (report?.finalAcceptance?.status !== "pending") {
    throw new Error("pending final acceptance is required before accepting final review");
  }
  assertFinalReviewAssembly(report);
  return {
    ...report,
    finalAcceptance: {
      status: review.decision,
      note: review.note.trim(),
      evidencePath: review.evidencePath,
      reviewedAt: review.reviewedAt
    },
    overallAccepted: true
  };
}
