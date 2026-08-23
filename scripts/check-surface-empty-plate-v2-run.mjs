import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SURFACE_SEEDS,
  SURFACE_STAGES,
  appendSurfaceCandidate,
  assertSurfaceRun,
  createSurfaceRun,
  reviewSurfaceCandidate,
  sha256File,
  writeSurfaceReportAtomic,
} from "./lib/surface-empty-plate-v2-run.mjs";

const root = mkdtempSync(path.join(tmpdir(), "surface-empty-plate-v2-run-"));

function resource(name, contents = name) {
  const filePath = path.join(root, name);
  writeFileSync(filePath, contents);
  return { path: filePath, size: Buffer.byteLength(contents), sha256: sha256File(filePath) };
}

function candidate(stage, id, artifact, overrides = {}) {
  const index = Number(id.slice(-3)) - 1;
  const input = overrides.input ?? artifact;
  return {
    id,
    input,
    masks: { editable: artifact, protected: artifact, overlap: artifact },
    prompt: `${stage} prompt`,
    negativePrompt: "no people",
    ...(stage === "final_empty_plate" ? {} : { seed: SURFACE_SEEDS[stage][index] }),
    preset: { path: `presets/${stage}.json`, sha256: "1".repeat(64) },
    workflow: { path: `workflows/${stage}.json`, sha256: "2".repeat(64) },
    model: { name: "qwen-image", sha256: "3".repeat(64) },
    promptId: `${stage}-${id}`,
    output: artifact,
    evidence: { comparison: artifact, difference: artifact, maskOverlay: artifact },
    ...overrides,
  };
}

function accept(report, stage, id, artifact, io) {
  return reviewSurfaceCandidate(report, stage, id, { decision: "accepted", note: `${stage} explicitly approved`, evidence: artifact }, io);
}

try {
  const mother = resource("mother.png", "mother-frame");
  const legacy = resource("v1-report.json", "stopped V1 evidence");
  const artifact = resource("candidate.png", "surface candidate");
  const io = { isDecodable: () => true };
  const input = {
    source: { ...mother, width: 1152, height: 640 },
    legacyEvidence: { reportPath: legacy.path, reportSha256: legacy.sha256, stoppedReason: "empty_plate_max_three_rejected" },
  };

  assert.deepEqual(SURFACE_STAGES, ["upper_background", "middle_background", "lower_background", "final_empty_plate"]);
  assert.deepEqual(SURFACE_SEEDS.upper_background, [71014001, 71014002]);
  assert.deepEqual(SURFACE_SEEDS.middle_background, [72025001, 72025002]);
  assert.deepEqual(SURFACE_SEEDS.lower_background, [73036001, 73036002]);
  assert.equal(createSurfaceRun(input).overallStatus, "pending");

  const report = createSurfaceRun(input);
  const upperCandidate = candidate("upper_background", "candidate_001", artifact, { input: mother });
  const middleCandidate = candidate("middle_background", "candidate_001", artifact);
  assert.throws(() => appendSurfaceCandidate(report, "middle_background", middleCandidate), /upper_background.*accepted/i);
  let upper = appendSurfaceCandidate(report, "upper_background", upperCandidate);
  assert.throws(() => appendSurfaceCandidate(upper, "upper_background", { ...upperCandidate, id: "candidate_003" }), /candidate_001.*candidate_002/i);
  assert.throws(() => reviewSurfaceCandidate(upper, "upper_background", "candidate_001", { decision: "accepted" }, io), /evidence/i);
  assert.throws(() => appendSurfaceCandidate(upper, "upper_background", upperCandidate), /duplicate|exists/i);
  assert.throws(() => appendSurfaceCandidate(upper, "upper_background", { ...candidate("upper_background", "candidate_002", artifact, { input: mother }), seed: 99 }), /seed/i);
  assert.throws(() => appendSurfaceCandidate(upper, "upper_background", candidate("upper_background", "candidate_002", artifact, { input: { ...mother, sha256: "0".repeat(64) } })), /input.*hash|source.*hash/i);
  assert.equal(upper.stages.upper_background.length, 1, "append must not replace its input report");
  assert.throws(() => assertSurfaceRun({ ...upper, source: { ...upper.source, sha256: "0".repeat(64) } }, io), /source.*sha|source.*hash/i);
  assert.throws(() => assertSurfaceRun({ ...upper, stages: { ...upper.stages, upper_background: [upper.stages.upper_background[0], upper.stages.upper_background[0]] } }), /duplicate/i);
  assert.throws(() => assertSurfaceRun({ ...upper, stages: { ...upper.stages, upper_background: [{ ...upper.stages.upper_background[0], state: "accepted", technicalAcceptance: "accepted", creativeAcceptance: "accepted", reviewHistory: [] }] } }), /review|creative/i);
  const multipleCurrentAccepted = structuredClone(upper);
  const firstAccepted = multipleCurrentAccepted.stages.upper_background[0];
  firstAccepted.state = "accepted";
  firstAccepted.creativeAcceptance = "accepted";
  firstAccepted.reviewHistory = [{ decision: "accepted", note: "explicit review", evidence: artifact }];
  const secondAccepted = structuredClone(firstAccepted);
  secondAccepted.id = "candidate_002";
  secondAccepted.seed = SURFACE_SEEDS.upper_background[1];
  multipleCurrentAccepted.stages.upper_background.push(secondAccepted);
  assert.throws(() => assertSurfaceRun(multipleCurrentAccepted), /multiple current accepted/i);

  upper = accept(upper, "upper_background", "candidate_001", artifact, io);
  assert.throws(() => appendSurfaceCandidate(upper, "upper_background", candidate("upper_background", "candidate_002", artifact)), /current.*accepted|replacement/i);
  let middle = appendSurfaceCandidate(upper, "middle_background", candidate("middle_background", "candidate_001", artifact, { ancestors: [{ stage: "upper_background", candidateId: "candidate_001" }], input: artifact }));
  middle = accept(middle, "middle_background", "candidate_001", artifact, io);
  let lower = appendSurfaceCandidate(middle, "lower_background", candidate("lower_background", "candidate_001", artifact, { ancestors: [{ stage: "upper_background", candidateId: "candidate_001" }, { stage: "middle_background", candidateId: "candidate_001" }], input: artifact }));
  lower = accept(lower, "lower_background", "candidate_001", artifact, io);
  let finalReport = appendSurfaceCandidate(lower, "final_empty_plate", candidate("final_empty_plate", "candidate_001", artifact, { ancestors: [{ stage: "upper_background", candidateId: "candidate_001" }, { stage: "middle_background", candidateId: "candidate_001" }, { stage: "lower_background", candidateId: "candidate_001" }], input: artifact }));
  finalReport = accept(finalReport, "final_empty_plate", "candidate_001", artifact, io);
  assert.equal(finalReport.overallStatus, "accepted");
  const persistedForgedInvalidation = JSON.parse(JSON.stringify(finalReport));
  for (const descendantStage of ["middle_background", "lower_background", "final_empty_plate"]) {
    persistedForgedInvalidation.invalidations.push({
      ancestorStage: "upper_background",
      ancestorCandidateId: "candidate_001",
      descendantStage,
      descendantCandidateId: "candidate_001",
      reason: "forged invalidation of an accepted ancestor",
    });
  }
  persistedForgedInvalidation.overallStatus = "pending";
  assert.equal(persistedForgedInvalidation.stages.middle_background[0].state, "accepted", "forged invalidation must not rewrite the descendant review history");
  assert.throws(() => assertSurfaceRun(persistedForgedInvalidation), /invalidation.*ancestor.*rejected|rejected.*invalidation.*ancestor/i);
  assert.throws(() => writeSurfaceReportAtomic(path.join(root, "forged-accepted-ancestor.json"), persistedForgedInvalidation), /invalidation.*ancestor.*rejected|rejected.*invalidation.*ancestor/i);
  const invalidated = reviewSurfaceCandidate(finalReport, "upper_background", "candidate_001", { decision: "rejected", note: "later review found a seam" }, io);
  assert.equal(invalidated.invalidations.length, 3, "each exact downstream dependent must be invalidated");
  assert.doesNotThrow(() => assertSurfaceRun(invalidated), "invalidated descendants remain structurally representable as history");
  assert.throws(() => assertSurfaceRun({ ...invalidated, overallStatus: "accepted" }), /invalidat|overall/i);
  assert.throws(() => reviewSurfaceCandidate(invalidated, "final_empty_plate", "candidate_001", { decision: "accepted", note: "must not revive downstream" }, io), /invalidat|upstream/i);
  let replacementWithHistory = appendSurfaceCandidate(invalidated, "upper_background", candidate("upper_background", "candidate_002", artifact, { input: mother }));
  replacementWithHistory = accept(replacementWithHistory, "upper_background", "candidate_002", artifact, io);
  assert.doesNotThrow(() => assertSurfaceRun(replacementWithHistory), "a current replacement may coexist with exact invalidated descendant history");
  assert.equal(replacementWithHistory.overallStatus, "pending");

  let rejectionRun = appendSurfaceCandidate(report, "upper_background", upperCandidate);
  rejectionRun = reviewSurfaceCandidate(rejectionRun, "upper_background", "candidate_001", { decision: "rejected", note: "visible seam" }, io);
  rejectionRun = appendSurfaceCandidate(rejectionRun, "upper_background", candidate("upper_background", "candidate_002", artifact, { input: mother }));
  rejectionRun = reviewSurfaceCandidate(rejectionRun, "upper_background", "candidate_002", { decision: "rejected", note: "retained contour" }, io);
  assert.throws(() => appendSurfaceCandidate(rejectionRun, "upper_background", candidate("upper_background", "candidate_003", artifact)), /candidate_001.*candidate_002|two.*rejected/i);

  const missingFirst = structuredClone(rejectionRun);
  missingFirst.stages.upper_background = [missingFirst.stages.upper_background[1]];
  assert.throws(() => assertSurfaceRun(missingFirst), /candidate_001.*candidate_002|position|order/i);
  assert.throws(() => writeSurfaceReportAtomic(path.join(root, "missing-first.json"), missingFirst), /candidate_001.*candidate_002|position|order/i);
  const reversedCandidates = structuredClone(rejectionRun);
  reversedCandidates.stages.upper_background.reverse();
  assert.throws(() => assertSurfaceRun(reversedCandidates), /candidate_001.*candidate_002|position|order/i);
  assert.throws(() => writeSurfaceReportAtomic(path.join(root, "reversed.json"), reversedCandidates), /candidate_001.*candidate_002|position|order/i);

  const upperOneOutput = resource("upper-one.png", "upper candidate one");
  const upperTwoOutput = resource("upper-two.png", "upper candidate two");
  const middleOutput = resource("middle.png", "middle candidate");
  const lowerOutput = resource("lower.png", "lower candidate");
  const finalOutput = resource("final.png", "final candidate");
  let currentChain = appendSurfaceCandidate(report, "upper_background", candidate("upper_background", "candidate_001", upperOneOutput, { input: mother }));
  currentChain = reviewSurfaceCandidate(currentChain, "upper_background", "candidate_001", { decision: "rejected", note: "first upper rejected" }, io);
  currentChain = appendSurfaceCandidate(currentChain, "upper_background", candidate("upper_background", "candidate_002", upperTwoOutput, { input: mother }));
  currentChain = accept(currentChain, "upper_background", "candidate_002", upperTwoOutput, io);
  const currentMiddle = appendSurfaceCandidate(currentChain, "middle_background", candidate("middle_background", "candidate_001", middleOutput, { input: upperTwoOutput, ancestors: [{ stage: "upper_background", candidateId: "candidate_002" }] }));
  assert.equal(accept(currentMiddle, "middle_background", "candidate_001", middleOutput, io).stages.middle_background[0].state, "accepted", "the exact current replacement chain remains reviewable");
  const persistedStaleMiddle = structuredClone(currentMiddle);
  persistedStaleMiddle.stages.middle_background[0].input = upperOneOutput;
  persistedStaleMiddle.stages.middle_background[0].ancestors = [{ stage: "upper_background", candidateId: "candidate_001" }];
  assert.throws(() => assertSurfaceRun(persistedStaleMiddle), /ancestor|current.*accepted|input/i);
  assert.throws(() => reviewSurfaceCandidate(persistedStaleMiddle, "middle_background", "candidate_001", { decision: "accepted", note: "must reject stale provenance", evidence: middleOutput }, io), /ancestor|current.*accepted|input/i);
  assert.throws(() => writeSurfaceReportAtomic(path.join(root, "stale-middle.json"), persistedStaleMiddle), /ancestor|current.*accepted|input/i);
  assert.throws(() => {
    let staleChain = appendSurfaceCandidate(currentChain, "middle_background", candidate("middle_background", "candidate_001", middleOutput, { input: upperOneOutput, ancestors: [{ stage: "upper_background", candidateId: "candidate_001" }] }));
    staleChain = accept(staleChain, "middle_background", "candidate_001", middleOutput, io);
    staleChain = appendSurfaceCandidate(staleChain, "lower_background", candidate("lower_background", "candidate_001", lowerOutput, { input: middleOutput, ancestors: [{ stage: "upper_background", candidateId: "candidate_001" }, { stage: "middle_background", candidateId: "candidate_001" }] }));
    staleChain = accept(staleChain, "lower_background", "candidate_001", lowerOutput, io);
    staleChain = appendSurfaceCandidate(staleChain, "final_empty_plate", candidate("final_empty_plate", "candidate_001", finalOutput, { input: lowerOutput, ancestors: [{ stage: "upper_background", candidateId: "candidate_001" }, { stage: "middle_background", candidateId: "candidate_001" }, { stage: "lower_background", candidateId: "candidate_001" }] }));
    staleChain = accept(staleChain, "final_empty_plate", "candidate_001", finalOutput, io);
    assert.equal(staleChain.overallStatus, "accepted", "pre-fix stale chain reaches accepted");
  }, /ancestor|current.*accepted|input/i);

  const deleted = appendSurfaceCandidate(report, "upper_background", upperCandidate);
  unlinkSync(artifact.path);
  const rejectedAfterDeletion = reviewSurfaceCandidate(deleted, "upper_background", "candidate_001", { decision: "rejected", note: "artifact no longer available" }, io);
  assert.equal(rejectedAfterDeletion.stages.upper_background[0].state, "rejected");
  assert.throws(() => reviewSurfaceCandidate(deleted, "upper_background", "candidate_001", { decision: "accepted", note: "requires evidence", evidence: artifact }, io), /evidence|missing|artifact/i);

  const atomicPath = path.join(root, "nested", "run-report.json");
  writeSurfaceReportAtomic(atomicPath, report);
  assert.deepEqual(JSON.parse(readFileSync(atomicPath, "utf8")), report);
  console.log("Surface empty plate V2 run contract: PASS");
} finally {
  rmSync(root, { recursive: true, force: true });
}
