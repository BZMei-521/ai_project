import assert from "node:assert/strict";
import {
  applyCreativeReview,
  applyFinalReview,
  assertAcceptedPrefix,
  canAssemble,
  markFinalReviewPending,
  markTechnicalAccepted
} from "./lib/wan-one-take-acceptance.mjs";

const baseSegment = {
  id: "segment_001",
  order: 1,
  prompt: "beat-1",
  attempts: []
};
const attempt = {
  attempt: 1,
  seed: 26081011,
  inputSha256: "initial-hash",
  finalFrameSha256: "final-1",
  promptId: "prompt-1",
  elapsedSeconds: 10,
  videoPath: "segment-1.mp4",
  finalFramePath: "segment-1-final.png"
};

const technical = markTechnicalAccepted(baseSegment, attempt);
assert.equal(technical.technicalAccepted, true);
assert.equal(technical.accepted, false);
assert.equal(technical.creativeAcceptance.status, "pending");
assert.equal(technical.finalFrameSha256, "final-1");

const accepted = applyCreativeReview(technical, {
  decision: "accepted",
  note: "clear half-step and slow push",
  evidencePath: "segment_001.png",
  reviewedAt: "2026-08-11T00:00:00.000Z"
});
assert.equal(accepted.accepted, true);
assert.equal(accepted.creativeAcceptance.status, "accepted");

const rejected = applyCreativeReview(technical, {
  decision: "rejected",
  note: "motion is frozen",
  evidencePath: "segment_001.png",
  reviewedAt: "2026-08-11T00:00:00.000Z"
});
assert.equal(rejected.accepted, false);
assert.equal(rejected.creativeAcceptance.status, "rejected");

assert.throws(
  () => applyCreativeReview(baseSegment, {
    decision: "accepted",
    note: "invalid",
    evidencePath: "segment_001.png",
    reviewedAt: "2026-08-11T00:00:00.000Z"
  }),
  /technical acceptance is required/
);

const six = Array.from({ length: 6 }, (_, index) => ({
  ...accepted,
  id: `segment_${String(index + 1).padStart(3, "0")}`,
  order: index + 1,
  inputSha256: index === 0 ? "initial-hash" : `final-${index}`,
  finalFrameSha256: `final-${index + 1}`,
  videoPath: `segment-${index + 1}.mp4`,
  finalFramePath: `segment-${index + 1}-final.png`
}));
const hashes = new Map(six.map((segment) => [segment.finalFramePath, segment.finalFrameSha256]));
const existingPaths = new Set(six.flatMap((segment) => [segment.videoPath, segment.finalFramePath]));
assert.throws(() => assertAcceptedPrefix({
  segments: six,
  expectedCount: 6,
  initialFrameHash: "initial-hash",
  hashFile: (path) => hashes.get(path)
}), /existsFile is required/);
assert.doesNotThrow(() => assertAcceptedPrefix({
  segments: six,
  expectedCount: 6,
  initialFrameHash: "initial-hash",
  hashFile: (path) => hashes.get(path),
  existsFile: (path) => existingPaths.has(path)
}));
for (const [label, missingPath] of [
  ["video", six[2].videoPath],
  ["final frame", six[4].finalFramePath]
]) {
  assert.throws(() => assertAcceptedPrefix({
    segments: six,
    expectedCount: 6,
    initialFrameHash: "initial-hash",
    hashFile: (path) => hashes.get(path),
    existsFile: (path) => existingPaths.has(path) && path !== missingPath
  }), /accepted prefix file does not exist/, label);
}
assert.equal(canAssemble(six), true);
assert.equal(canAssemble([...six.slice(0, 5), rejected]), false);

const completeAssembly = {
  nativePath: "native.mp4",
  deliveryPath: "delivery.mp4",
  nativeMetadata: {
    codec_name: "h264",
    width: 832,
    height: 480,
    r_frame_rate: "16/1",
    nb_frames: "97",
    format: { duration: "6.062500", size: "1000" }
  },
  deliveryMetadata: {
    codec_name: "h264",
    width: 832,
    height: 480,
    r_frame_rate: "24/1",
    format: { duration: "6.000000", size: "1000" }
  },
  nativeFrameCount: 97,
  expectedNativeFrameCount: 97,
  evidence: {
    fullContactSheetPath: "one_take_97_frames.png",
    boundarySheetPaths: Array.from({ length: 5 }, (_, index) => `boundary-${index + 1}.png`)
  },
  integrity: {
    nativeSha256: "a".repeat(64),
    deliverySha256: "b".repeat(64),
    fullContactSheetSha256: "c".repeat(64),
    boundarySheetSha256s: Array.from({ length: 5 }, (_, index) => String(index + 1).repeat(64))
  }
};
assert.throws(
  () => markFinalReviewPending({ segments: six, assembly: { nativePath: "native.mp4", deliveryPath: "delivery.mp4" } }),
  /complete assembly metadata and evidence are required/
);
const incompleteAssemblies = [
  { label: "integrity", mutate: (assembly) => { delete assembly.integrity; } },
  { label: "native integrity", mutate: (assembly) => { assembly.integrity.nativeSha256 = ""; } },
  { label: "delivery integrity", mutate: (assembly) => { assembly.integrity.deliverySha256 = ""; } },
  { label: "full evidence integrity", mutate: (assembly) => { assembly.integrity.fullContactSheetSha256 = ""; } },
  { label: "boundary integrity count", mutate: (assembly) => { assembly.integrity.boundarySheetSha256s.pop(); } },
  { label: "boundary integrity value", mutate: (assembly) => { assembly.integrity.boundarySheetSha256s[0] = ""; } },
  { label: "native codec", mutate: (assembly) => { assembly.nativeMetadata.codec_name = "hevc"; } },
  { label: "native width", mutate: (assembly) => { assembly.nativeMetadata.width = 640; } },
  { label: "native height", mutate: (assembly) => { assembly.nativeMetadata.height = 360; } },
  { label: "native fps", mutate: (assembly) => { assembly.nativeMetadata.r_frame_rate = "24/1"; } },
  { label: "native metadata frames", mutate: (assembly) => { assembly.nativeMetadata.nb_frames = "96"; } },
  { label: "native frames", mutate: (assembly) => { assembly.nativeFrameCount = 96; } },
  { label: "expected native frames", mutate: (assembly) => { assembly.expectedNativeFrameCount = 96; } },
  { label: "delivery metadata", mutate: (assembly) => { delete assembly.deliveryMetadata; } },
  { label: "delivery codec", mutate: (assembly) => { assembly.deliveryMetadata.codec_name = "hevc"; } },
  { label: "delivery width", mutate: (assembly) => { assembly.deliveryMetadata.width = 640; } },
  { label: "delivery height", mutate: (assembly) => { assembly.deliveryMetadata.height = 360; } },
  { label: "delivery fps", mutate: (assembly) => { assembly.deliveryMetadata.r_frame_rate = "16/1"; } },
  { label: "full contact sheet", mutate: (assembly) => { assembly.evidence.fullContactSheetPath = ""; } },
  { label: "boundary evidence count", mutate: (assembly) => { assembly.evidence.boundarySheetPaths.pop(); } },
  { label: "boundary evidence path", mutate: (assembly) => { assembly.evidence.boundarySheetPaths[0] = ""; } }
];
for (const { label, mutate } of incompleteAssemblies) {
  const assembly = structuredClone(completeAssembly);
  mutate(assembly);
  assert.throws(
    () => markFinalReviewPending({ segments: six, assembly }),
    /complete assembly metadata and evidence are required/,
    label
  );
}

const assembledReport = { segments: six, assembly: completeAssembly };
const pendingFinalReview = markFinalReviewPending(assembledReport);
assert.equal(pendingFinalReview.overallAccepted, false);
assert.equal(pendingFinalReview.finalAcceptance.status, "pending");
assert.throws(
  () => markFinalReviewPending({ segments: six }),
  /assembled native and delivery media are required/
);
assert.throws(
  () => markFinalReviewPending({ ...assembledReport, segments: [...six.slice(0, 5), rejected] }),
  /six accepted segments are required/
);

const acceptedFinalReview = {
  decision: "accepted",
  note: "all six beats and boundaries pass",
  evidencePath: "one_take_97_frames.png",
  reviewedAt: "2026-08-11T00:00:00.000Z"
};
assert.throws(
  () => applyFinalReview(assembledReport, acceptedFinalReview),
  /pending final acceptance is required/
);

const finalAccepted = applyFinalReview(pendingFinalReview, acceptedFinalReview);
assert.equal(finalAccepted.overallAccepted, true);
assert.equal(finalAccepted.finalAcceptance.status, "accepted");
assert.throws(
  () => applyFinalReview(finalAccepted, acceptedFinalReview),
  /pending final acceptance is required/
);
let finalRejected;
assert.doesNotThrow(() => {
  finalRejected = applyFinalReview({ ...finalAccepted, segments: [], assembly: undefined }, {
    decision: "rejected",
    note: "boundary pacing needs another pass",
    evidencePath: "one_take_97_frames.png",
    reviewedAt: "2026-08-11T00:00:00.000Z"
  });
});
assert.equal(finalRejected.overallAccepted, false);
assert.equal(finalRejected.finalAcceptance.status, "rejected");
console.log("Wan one-take acceptance contract: PASS");
