import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildOneTakeConcatFilter } from "./lib/wan-one-take-chain.mjs";
import { assertFinalReviewAssembly, canAssemble } from "./lib/wan-one-take-acceptance.mjs";

const concat = buildOneTakeConcatFilter({
  segmentCount: 6,
  framesPerSegment: 17,
  inputFps: 16,
  outputFps: 24
});
assert.equal(concat.nativeFrameCount, 97);
assert.match(concat.filterGraph, /\[0:v\]fps=16,trim=start_frame=0:end_frame=17/);
assert.equal(concat.filterGraph.match(/trim=start_frame=1:end_frame=17/g)?.length, 5);
assert.match(concat.filterGraph, /concat=n=6:v=1:a=0\[native\]/);
assert.match(concat.filterGraph, /\[native\]minterpolate=fps=24/);
assert.doesNotMatch(concat.filterGraph, /xfade/);

const acceptedSegments = Array.from({ length: 6 }, (_, index) => ({
  id: `segment_${String(index + 1).padStart(3, "0")}`,
  order: index + 1,
  technicalAccepted: true,
  creativeAcceptance: { status: "accepted" },
  accepted: true
}));
assert.equal(canAssemble(acceptedSegments), true);
assert.equal(canAssemble(acceptedSegments.map((segment, index) => index === 5 ? { ...segment, accepted: false } : segment)), false);

const completeAssembly = {
  nativePath: "native.mp4",
  deliveryPath: "delivery.mp4",
  nativeMetadata: { codec_name: "h264", width: 832, height: 480, r_frame_rate: "16/1", nb_frames: "97" },
  deliveryMetadata: { codec_name: "h264", width: 832, height: 480, r_frame_rate: "24/1" },
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
assert.equal(assertFinalReviewAssembly({ segments: acceptedSegments, assembly: completeAssembly }), completeAssembly);
assert.throws(
  () => assertFinalReviewAssembly({
    segments: acceptedSegments,
    assembly: {
      ...completeAssembly,
      evidence: { ...completeAssembly.evidence, boundarySheetPaths: completeAssembly.evidence.boundarySheetPaths.slice(0, 4) }
    }
  }),
  /complete assembly metadata and evidence are required/
);
assert.throws(
  () => assertFinalReviewAssembly({
    segments: acceptedSegments,
    assembly: {
      ...completeAssembly,
      integrity: { ...completeAssembly.integrity, boundarySheetSha256s: completeAssembly.integrity.boundarySheetSha256s.slice(0, 4) }
    }
  }),
  /complete assembly metadata and evidence are required/
);

const source = readFileSync("scripts/run-wan-one-take-chain.mjs", "utf8");
assert.match(source, /const assembleMode = process\.argv\.includes\("--assemble"\);/);
assert.match(source, /if \(!canAssemble\(report\.segments\)\) throw new Error\("six technically and creatively accepted segments are required"\)/);
assert.match(source, /assertAcceptedPrefix\(\{/);
assert.match(source, /finalAcceptance: \{ status: "pending" \}/);
assert.match(source, /overallAccepted: false/);
assert.match(source, /createBoundarySheets\(report\.segments/);
assert.match(source, /createFullContactSheet\(nativePath/);
assert.match(source, /buildOneTakeConcatFilter/);
assert.match(source, /river_one_take_native16\.mp4/);
assert.match(source, /river_one_take_delivery24\.mp4/);
assert.match(source, /nativeFrameCount !== 97/);
assert.match(source, /runFfmpeg\(\[\s*"-y",\s*\.\.\.segmentInputs,[\s\S]*?nativePath\s*\]\);/);
assert.match(source, /runFfmpeg\(\[\s*"-y",\s*\.\.\.segmentInputs,[\s\S]*?deliveryPath\s*\]\);/);
assert.match(
  source,
  /assertVideoMetadata\(deliveryMetadata, \{\s*label: "delivery output",\s*codecName: "h264",\s*width: 832,\s*height: 480,\s*fps: 24,\s*minDuration: 5\.8,\s*maxDuration: 6\.3\s*\}\);/
);
assert.match(source, /parseFrameRate/);
assert.doesNotMatch(source, /overallAccepted: true/);
assert.doesNotMatch(source, /xfade=transition/);

const assemblyStart = source.indexOf("function assembleAcceptedSegments()");
const assemblyEnd = source.indexOf("async function main()", assemblyStart);
const assemblySource = source.slice(assemblyStart, assemblyEnd);
const acceptedGateIndex = assemblySource.indexOf("if (!canAssemble(report.segments))");
const recoveryIndex = assemblySource.indexOf("createRecoverySnapshot();");
const deleteAssemblyIndex = assemblySource.indexOf("delete report.assembly;");
const deleteFinalAcceptanceIndex = assemblySource.indexOf("delete report.finalAcceptance;");
const resetOverallIndex = assemblySource.indexOf("report.overallAccepted = false;");
const resetWriteIndex = assemblySource.indexOf("writeReport(report);");
const firstFfmpegIndex = assemblySource.indexOf("runFfmpeg([");
assert.ok(acceptedGateIndex >= 0, "assembly must validate accepted segments before resetting stale state");
assert.ok(recoveryIndex > acceptedGateIndex, "assembly must snapshot the accepted report before resetting stale state");
assert.ok(deleteAssemblyIndex > recoveryIndex, "assembly must clear stale assembly after the snapshot");
assert.ok(deleteFinalAcceptanceIndex > deleteAssemblyIndex, "assembly must clear stale final acceptance");
assert.ok(resetOverallIndex > deleteFinalAcceptanceIndex, "assembly must reset overall acceptance");
assert.ok(resetWriteIndex > resetOverallIndex, "assembly must persist the reset report");
assert.ok(firstFfmpegIndex > resetWriteIndex, "assembly must persist stale-state reset before overwriting fixed media");
console.log("Wan one-take assembly contract: PASS");
