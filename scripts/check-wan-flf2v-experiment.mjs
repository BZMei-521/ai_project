import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  ENDPOINT_SEEDS,
  EXPERIMENT_ROOT,
  AUTHORITATIVE_REPORT_PATH,
  VIDEO_SEEDS,
  applyEndpointReview,
  applyVideoReview,
  assertApprovedEndpoint,
  assertAuthoritativeUnchanged,
  assertExperimentReportInvariant,
  createExperimentReport,
  markEndpointTechnical,
  markVideoTechnical
} from "./lib/wan-flf2v-experiment.mjs";
import { buildHalfStepTarget } from "./lib/wan-flf2v-pose-guide.mjs";

const experimentRoot = mkdtempSync(join(tmpdir(), "wan-flf2v-contract-"));
const authoritativeReportPath = resolve(experimentRoot, "authoritative", "wan-one-take-report.json");
const startFramePath = resolve(experimentRoot, "inputs", "start.png");
const authoritySnapshot = (report) => ({
  path: report.authoritativeReportPath,
  sha256: report.authoritativeReportSha256
});

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function runFfmpeg(argumentsList) {
  const result = spawnSync("ffmpeg", argumentsList, { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}

function makeImage(path, color) {
  mkdirSync(dirname(path), { recursive: true });
  runFfmpeg(["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=16x16`, "-frames:v", "1", "-update", "1", path]);
}

function makeVideo(path) {
  mkdirSync(dirname(path), { recursive: true });
  runFfmpeg(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=16x16:r=16", "-frames:v", "17", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
}

function decode(path, label) {
  const result = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-frames:v", "1", "-f", "null", "-"], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `${label}: ${result.stderr}`);
}

const io = {
  existsFile: (path) => existsSync(path) && statSync(path).size > 0,
  hashFile: sha256File,
  readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
  assertDecodableImage: (path) => decode(path, "image must decode"),
  assertDecodableVideo: (path) => decode(path, "video must decode")
};

try {
  mkdirSync(dirname(authoritativeReportPath), { recursive: true });
  writeFileSync(authoritativeReportPath, "authoritative report fixture\n", "utf8");
  makeImage(startFramePath, "white");
  const endpointPath = resolve(experimentRoot, "endpoint-1.png");
  const compositePath = resolve(experimentRoot, "endpoint-1-composite.png");
  const videoPath = resolve(experimentRoot, "video-1.mp4");
  const videoEvidencePath = resolve(experimentRoot, "video-1-contact-sheet.png");
  makeImage(endpointPath, "green");
  makeImage(compositePath, "blue");
  makeVideo(videoPath);
  makeImage(videoEvidencePath, "yellow");
  const authorityHash = sha256File(authoritativeReportPath);
  const startHash = sha256File(startFramePath);
  const endpointHash = sha256File(endpointPath);
  const compositeHash = sha256File(compositePath);
  const videoHash = sha256File(videoPath);
  const videoEvidenceHash = sha256File(videoEvidencePath);
  const requiredRootReport = createExperimentReport({
    experimentRoot: EXPERIMENT_ROOT,
    authoritativeReportPath,
    authoritativeReportSha256: "authority-hash",
    startFramePath,
    startFrameSha256: "start-hash",
    startWidth: 1152,
    startHeight: 640
  });
  assert.equal(requiredRootReport.overallStatus, "endpoint-required");
  assert.throws(() => createExperimentReport({
    experimentRoot: resolve(dirname(AUTHORITATIVE_REPORT_PATH), "nested-experiment"),
    authoritativeReportPath,
    authoritativeReportSha256: "authority-hash",
    startFramePath,
    startFrameSha256: "start-hash"
  }), /must not overlap/);
  assert.throws(() => createExperimentReport({
    experimentRoot: resolve(dirname(AUTHORITATIVE_REPORT_PATH)).toUpperCase(),
    authoritativeReportPath: AUTHORITATIVE_REPORT_PATH.toUpperCase(),
    authoritativeReportSha256: "authority-hash",
    startFramePath,
    startFrameSha256: "start-hash"
  }), /must not overlap/);
  const initial = createExperimentReport({
    experimentRoot,
    authoritativeReportPath,
    authoritativeReportSha256: authorityHash,
    startFramePath,
    startFrameSha256: startHash,
    startWidth: 1152,
    startHeight: 640
  });
  assert.deepEqual(ENDPOINT_SEEDS, [271011, 272011, 273011]);
  assert.deepEqual(VIDEO_SEEDS, [281011, 282011, 283011]);
  assert.deepEqual(initial.geometry, {
    source: { width: 1152, height: 640 },
    flf: { scaledWidth: 1296, scaledHeight: 720, cropLeft: 8, cropRight: 8, width: 1280, height: 720 },
    chain: { scaledWidth: 854, scaledHeight: 480, cropLeft: 11, cropRight: 11, width: 832, height: 480 }
  });
  assert.equal(initial.authoritativeReportPath, authoritativeReportPath);
  assert.equal(initial.overallStatus, "endpoint-required");
  assert.doesNotThrow(() => assertExperimentReportInvariant(initial));
  for (const [malformed, pattern] of [
    [{ ...initial, schemaVersion: 2 }, /schemaVersion/],
    [{ ...initial, experimentType: "wrong" }, /experimentType/],
    [{ ...initial, geometry: { ...initial.geometry, source: { width: 1, height: 640 } } }, /geometry/],
    [{ ...initial, authoritativeReportPath: "" }, /authoritative.*path/],
    [{ ...initial, authoritativeReportSha256: "" }, /authoritative.*hash/],
    [{ ...initial, endpointCandidates: {} }, /endpointCandidates/],
    [{ ...initial, videoCandidates: [{}] }, /approved endpoint.*video|video candidates/i],
    [{ ...initial, overallStatus: "accepted" }, /overallStatus/]
  ]) assert.throws(() => assertExperimentReportInvariant(malformed), pattern);

  const technicalEndpoint = markEndpointTechnical(initial, {
    candidate: 1,
    seed: 271011,
    endpointPath,
    endpointSha256: endpointHash,
    compositePath,
    compositeSha256: compositeHash
  });

  const posePerson = (pelvisX, firstAnkleX, secondAnkleX) => {
    const points = Array.from({ length: 18 }, (_, index) => [pelvisX, 80 + index * 20, 1]);
    points[9] = [pelvisX - 20, 360, 1]; points[10] = [pelvisX - 25, 455, 1]; points[11] = [firstAnkleX, 565, 1];
    points[12] = [pelvisX + 20, 360, 1]; points[13] = [pelvisX + 25, 455, 1]; points[14] = [secondAnkleX, 565, 1];
    return { pose_keypoints_2d: points.flat() };
  };
  const transformedPose = buildHalfStepTarget({ canvas_width: 1152, canvas_height: 640, people: [posePerson(390, 340, 430), posePerson(735, 700, 770)] });
  const sourcePosePath = resolve(experimentRoot, "source-pose.json");
  const targetPosePath = resolve(experimentRoot, "target-pose.json");
  const poseGuidePath = resolve(experimentRoot, "target-pose.png");
  const poseDiagnosticPath = resolve(experimentRoot, "pose-diagnostic.png");
  writeFileSync(sourcePosePath, `${JSON.stringify(transformedPose.source)}\n`);
  writeFileSync(targetPosePath, `${JSON.stringify(transformedPose.target)}\n`);
  makeImage(poseGuidePath, "red"); makeImage(poseDiagnosticPath, "purple");
  const poseTechnical = markEndpointTechnical(initial, {
    candidate: 1, seed: ENDPOINT_SEEDS[0], endpointPath, endpointSha256: endpointHash,
    compositePath, compositeSha256: compositeHash, evidencePath: compositePath, evidenceSha256: compositeHash,
    poseGuided: true, sourcePosePath, sourcePoseSha256: sha256File(sourcePosePath), targetPosePath, targetPoseSha256: sha256File(targetPosePath),
    poseGuidePath, poseGuideSha256: sha256File(poseGuidePath), poseDiagnosticPath, poseDiagnosticSha256: sha256File(poseDiagnosticPath),
    dwposePromptId: "dwpose-prompt", qwenPromptId: "qwen-prompt", motion: transformedPose.motion,
    promptBlockHashes: { identity: "1".repeat(64), spatialLayout: "2".repeat(64), lighting: "3".repeat(64), style: "4".repeat(64), performance: "5".repeat(64) },
    compiledPromptSha256: "6".repeat(64)
  });
  assert.doesNotThrow(() => assertExperimentReportInvariant(poseTechnical));
  assert.throws(() => assertExperimentReportInvariant({ ...poseTechnical, endpointCandidates: [{ ...poseTechnical.endpointCandidates[0], targetPoseSha256: undefined }] }), /target pose.*hash|required/i);
  assert.doesNotThrow(() => applyEndpointReview(poseTechnical, {
    candidate: 1, decision: "accepted", note: "pose artifacts revalidated",
    evidencePath: compositePath, evidenceSha256: compositeHash
  }, io));
  assert.equal(technicalEndpoint.endpointCandidates[0].creativeAcceptance.status, "pending");
  assert.doesNotThrow(() => assertExperimentReportInvariant(technicalEndpoint));
  assert.throws(() => assertExperimentReportInvariant({
    ...technicalEndpoint,
    endpointCandidates: [technicalEndpoint.endpointCandidates[0], technicalEndpoint.endpointCandidates[0]]
  }), /duplicate endpoint candidate/i);
  assert.deepEqual(authoritySnapshot(technicalEndpoint), authoritySnapshot(initial));

  assert.throws(() => applyEndpointReview(technicalEndpoint, {
    candidate: 1,
    decision: "accepted",
    note: "promotion requires actual artifact validators",
    evidencePath: technicalEndpoint.endpointCandidates[0].evidencePath,
    evidenceSha256: compositeHash
  }), /validators are required/);

  assert.throws(() => applyEndpointReview(technicalEndpoint, {
    candidate: 1,
    decision: "accepted",
    note: "",
    evidencePath: technicalEndpoint.endpointCandidates[0].compositePath,
    evidenceSha256: compositeHash
  }), /note is required/);
  const nonTechnicalEndpoint = {
    ...initial,
    endpointCandidates: [{
      ...technicalEndpoint.endpointCandidates[0],
      technicalAcceptance: { status: "pending" }
    }]
  };
  assert.throws(() => applyEndpointReview(nonTechnicalEndpoint, {
    candidate: 1,
    decision: "accepted",
    note: "cannot skip technical acceptance",
    evidencePath: compositePath,
    evidenceSha256: compositeHash
  }), /technical acceptance is required/);
  assert.throws(() => applyEndpointReview({
    ...technicalEndpoint,
    endpointCandidates: [{ ...technicalEndpoint.endpointCandidates[0], seed: 999999 }]
  }, {
    candidate: 1,
    decision: "accepted",
    note: "persisted endpoint seed must be revalidated",
    evidencePath: technicalEndpoint.endpointCandidates[0].evidencePath,
    evidenceSha256: compositeHash
  }), /fixed seed policy/);

  const rejectedEndpoint = applyEndpointReview(technicalEndpoint, {
    candidate: 1,
    decision: "rejected",
    note: "foot contact is unclear",
    evidencePath: technicalEndpoint.endpointCandidates[0].compositePath,
    evidenceSha256: compositeHash
  });
  assert.equal(rejectedEndpoint.approvedEndpoint, null);
  assert.equal(rejectedEndpoint.endpointCandidates[0].creativeAcceptance.status, "rejected");
  assert.doesNotThrow(() => assertExperimentReportInvariant(rejectedEndpoint));
  assert.throws(() => assertApprovedEndpoint(rejectedEndpoint, {}), /approved endpoint is required/);
  assert.deepEqual(authoritySnapshot(rejectedEndpoint), authoritySnapshot(initial));

  const acceptedEndpoint = applyEndpointReview(technicalEndpoint, {
    candidate: 1,
    decision: "accepted",
    note: "readable grounded half-step",
    evidencePath: technicalEndpoint.endpointCandidates[0].compositePath,
    evidenceSha256: compositeHash
  }, io);
  assert.equal(acceptedEndpoint.approvedEndpoint.candidate, 1);
  assert.equal(acceptedEndpoint.overallStatus, "video-required");
  assert.doesNotThrow(() => assertExperimentReportInvariant(acceptedEndpoint));
  assert.throws(() => assertExperimentReportInvariant({ ...acceptedEndpoint, approvedEndpoint: null }), /accepted endpoint.*pointer|approvedEndpoint/i);
  assert.throws(() => assertExperimentReportInvariant({ ...acceptedEndpoint, overallStatus: "endpoint-required" }), /overallStatus/);
  assert.throws(() => assertApprovedEndpoint({
    ...acceptedEndpoint,
    approvedEndpoint: { ...acceptedEndpoint.approvedEndpoint, compositeSha256: "wrong-hash" },
    endpointCandidates: [{ ...acceptedEndpoint.endpointCandidates[0], compositeSha256: "wrong-hash" }]
  }, io), /hash mismatch/);
  assert.throws(() => assertApprovedEndpoint({
    ...acceptedEndpoint,
    approvedEndpoint: {
      ...acceptedEndpoint.approvedEndpoint,
      evidenceSha256: "wrong-shared-path-hash",
      creativeAcceptance: { ...acceptedEndpoint.approvedEndpoint.creativeAcceptance, evidenceSha256: "wrong-shared-path-hash" }
    },
    endpointCandidates: [{
      ...acceptedEndpoint.endpointCandidates[0],
      evidenceSha256: "wrong-shared-path-hash",
      creativeAcceptance: { ...acceptedEndpoint.endpointCandidates[0].creativeAcceptance, evidenceSha256: "wrong-shared-path-hash" }
    }]
  }, io), /hash mismatch/);
  assert.doesNotThrow(() => assertApprovedEndpoint(acceptedEndpoint, io));
  assert.deepEqual(assertApprovedEndpoint(acceptedEndpoint, io), acceptedEndpoint.endpointCandidates[0]);
  assert.throws(() => assertApprovedEndpoint({ ...acceptedEndpoint, endpointCandidates: [] }, io), /exactly one accepted endpoint history candidate/);
  assert.throws(() => assertApprovedEndpoint({
    ...acceptedEndpoint,
    endpointCandidates: [{ ...acceptedEndpoint.endpointCandidates[0], endpointSha256: "detached-pointer-hash" }]
  }, io), /does not match its accepted history candidate/);
  assert.throws(() => assertApprovedEndpoint({
    ...acceptedEndpoint,
    endpointCandidates: [
      acceptedEndpoint.endpointCandidates[0],
      { ...acceptedEndpoint.endpointCandidates[0], candidate: 2, seed: 272011 }
    ]
  }, io), /exactly one accepted endpoint history candidate/);
  assert.throws(() => assertApprovedEndpoint({
    ...acceptedEndpoint,
    approvedEndpoint: {
      ...acceptedEndpoint.approvedEndpoint,
      creativeAcceptance: { ...acceptedEndpoint.approvedEndpoint.creativeAcceptance, note: "" }
    },
    endpointCandidates: [{
      ...acceptedEndpoint.endpointCandidates[0],
      creativeAcceptance: { ...acceptedEndpoint.endpointCandidates[0].creativeAcceptance, note: "" }
    }]
  }, io), /accepted endpoint creative note is required/);
  assert.throws(() => assertApprovedEndpoint({
    ...acceptedEndpoint,
    approvedEndpoint: {
      ...acceptedEndpoint.approvedEndpoint,
      creativeAcceptance: {
        ...acceptedEndpoint.approvedEndpoint.creativeAcceptance,
        evidencePath: endpointPath,
        evidenceSha256: endpointHash
      }
    },
    endpointCandidates: [{
      ...acceptedEndpoint.endpointCandidates[0],
      creativeAcceptance: {
        ...acceptedEndpoint.endpointCandidates[0].creativeAcceptance,
        evidencePath: endpointPath,
        evidenceSha256: endpointHash
      }
    }]
  }, io), /creative evidence must match candidate evidence/);
  assert.deepEqual(authoritySnapshot(acceptedEndpoint), authoritySnapshot(initial));

  const secondTechnicalEndpoint = markEndpointTechnical(technicalEndpoint, {
    candidate: 2,
    seed: 272011,
    endpointPath: resolve(experimentRoot, "endpoint-2.png"),
    endpointSha256: "endpoint-2-hash",
    compositePath: resolve(experimentRoot, "endpoint-2-composite.png"),
    compositeSha256: "composite-2-hash"
  });
  const malformedEndpointHistory = {
    ...secondTechnicalEndpoint,
    endpointCandidates: [
      { ...technicalEndpoint.endpointCandidates[0], creativeAcceptance: { status: "accepted" } },
      secondTechnicalEndpoint.endpointCandidates[1]
    ]
  };
  assert.throws(() => applyEndpointReview(malformedEndpointHistory, {
    candidate: 2,
    decision: "accepted",
    note: "must not bypass an earlier accepted candidate",
    evidencePath: secondTechnicalEndpoint.endpointCandidates[1].evidencePath,
    evidenceSha256: "composite-2-hash"
  }), /already been accepted/);

  const technicalVideo = markVideoTechnical(acceptedEndpoint, {
    candidate: 1,
    seed: 281011,
    endpointCandidate: 1,
    endpointSha256: endpointHash,
    videoPath,
    videoSha256: videoHash,
    evidencePath: videoEvidencePath,
    evidenceSha256: videoEvidenceHash
  });
  assert.equal(technicalVideo.videoCandidates[0].creativeAcceptance.status, "pending");
  assert.doesNotThrow(() => assertExperimentReportInvariant(technicalVideo));
  assert.deepEqual(authoritySnapshot(technicalVideo), authoritySnapshot(initial));
  assert.throws(() => markVideoTechnical(acceptedEndpoint, {
    candidate: 1, seed: 281011, endpointCandidate: 2, endpointSha256: "wrong", videoPath: "video.mp4", videoSha256: "video", evidencePath: "sheet.png", evidenceSha256: "sheet"
  }), /approved endpoint version/);
  assert.throws(() => applyVideoReview({
    ...technicalVideo,
    videoCandidates: [{ ...technicalVideo.videoCandidates[0], probeOnly: true }]
  }, {
    candidate: 1,
    decision: "accepted",
    note: "persisted probe output must never be accepted",
    evidencePath: technicalVideo.videoCandidates[0].evidencePath,
    evidenceSha256: videoEvidenceHash
  }), /probe-only/);

  const rejectedVideo = applyVideoReview(technicalVideo, {
    candidate: 1,
    decision: "rejected",
    note: "the landing slides",
    evidencePath: technicalVideo.videoCandidates[0].evidencePath,
    evidenceSha256: videoEvidenceHash
  });
  assert.equal(rejectedVideo.approvedVideo, null);
  assert.equal(rejectedVideo.videoCandidates[0].creativeAcceptance.status, "rejected");
  assert.doesNotThrow(() => assertExperimentReportInvariant(rejectedVideo));
  assert.deepEqual(authoritySnapshot(rejectedVideo), authoritySnapshot(initial));
  const acceptedVideoReview = {
    candidate: 1,
    decision: "accepted",
    note: "motion and identity remain stable",
    evidencePath: technicalVideo.videoCandidates[0].evidencePath,
    evidenceSha256: videoEvidenceHash
  };
  assert.throws(() => applyVideoReview({
    ...technicalVideo,
    approvedEndpoint: { ...technicalVideo.approvedEndpoint, compositePath: resolve(experimentRoot, "deleted-composite.png") },
    endpointCandidates: [{ ...technicalVideo.endpointCandidates[0], compositePath: resolve(experimentRoot, "deleted-composite.png") }]
  }, acceptedVideoReview, io), /does not exist/);
  assert.throws(() => applyVideoReview({
    ...technicalVideo,
    approvedEndpoint: { ...technicalVideo.approvedEndpoint, compositeSha256: "drifted-endpoint-hash" },
    endpointCandidates: [{ ...technicalVideo.endpointCandidates[0], compositeSha256: "drifted-endpoint-hash" }]
  }, acceptedVideoReview, io), /hash mismatch/);

  const secondTechnicalVideo = markVideoTechnical(technicalVideo, {
    candidate: 2,
    seed: 282011,
    endpointCandidate: 1,
    endpointSha256: endpointHash,
    videoPath: resolve(experimentRoot, "video-2.mp4"),
    videoSha256: "video-2-hash",
    evidencePath: resolve(experimentRoot, "video-2-contact-sheet.png"),
    evidenceSha256: "video-2-evidence-hash"
  });
  const malformedVideoHistory = {
    ...secondTechnicalVideo,
    videoCandidates: [
      { ...technicalVideo.videoCandidates[0], creativeAcceptance: { status: "accepted" } },
      secondTechnicalVideo.videoCandidates[1]
    ]
  };
  assert.throws(() => applyVideoReview(malformedVideoHistory, {
    candidate: 2,
    decision: "accepted",
    note: "must not bypass an earlier accepted video",
    evidencePath: secondTechnicalVideo.videoCandidates[1].evidencePath,
    evidenceSha256: "video-2-evidence-hash"
  }), /already been accepted/);

  const acceptedVideo = applyVideoReview(technicalVideo, acceptedVideoReview, io);
  assert.equal(acceptedVideo.approvedVideo.candidate, 1);
  assert.equal(acceptedVideo.overallStatus, "accepted");
  assert.doesNotThrow(() => assertExperimentReportInvariant(acceptedVideo));
  assert.throws(() => assertExperimentReportInvariant({ ...acceptedVideo, approvedVideo: null }), /accepted video.*pointer|approvedVideo/i);
  assert.deepEqual(authoritySnapshot(acceptedVideo), authoritySnapshot(initial));

  assert.doesNotThrow(() => assertAuthoritativeUnchanged(acceptedVideo, (path) => {
    assert.equal(path, authoritativeReportPath);
    return authorityHash;
  }));
  assert.throws(() => assertAuthoritativeUnchanged(acceptedVideo, () => "changed-hash"), /changed/);

  const cliPath = resolve("scripts/review-wan-flf2v-experiment.mjs");
  const runCli = (argumentsList) => spawnSync(process.execPath, [cliPath, ...argumentsList], { encoding: "utf8", windowsHide: true });
  const writeReport = (name, value) => {
    const path = resolve(experimentRoot, name);
    const contents = JSON.stringify(value, null, 2);
    writeFileSync(path, contents, "utf8");
    return { path, contents };
  };
  const endpointCli = writeReport("endpoint-cli.json", technicalEndpoint);
  for (const argumentsList of [
    ["--report", endpointCli.path, "--decision", "accepted", "--note", "missing mode", "--evidence", compositePath],
    ["--report", endpointCli.path, "--endpoint-candidate", "1", "--video-candidate", "1", "--decision", "accepted", "--note", "two modes", "--evidence", compositePath],
    ["--report", endpointCli.path, "--endpoint-candidate", "1", "--decision", "accepted", "--note", "unknown flag", "--evidence", compositePath, "--extra", "x"],
    ["--report", endpointCli.path, "--endpoint-candidate", "1", "--decision", "accepted", "--note", "missing evidence", "--evidence", resolve(experimentRoot, "missing.png")]
  ]) {
    assert.notEqual(runCli(argumentsList).status, 0);
    assert.equal(readFileSync(endpointCli.path, "utf8"), endpointCli.contents);
  }
  const endpointSuccess = runCli([
    "--report", endpointCli.path,
    "--endpoint-candidate", "1",
    "--decision", "accepted",
    "--note", "atomic endpoint review",
    "--evidence", compositePath
  ]);
  assert.equal(endpointSuccess.status, 0, endpointSuccess.stderr);
  assert.equal(existsSync(`${endpointCli.path}.tmp`), false);
  assert.equal(JSON.parse(readFileSync(endpointCli.path, "utf8")).approvedEndpoint.candidate, 1);

  const poseCli = writeReport("pose-endpoint-cli.json", poseTechnical);
  const poseSuccess = runCli([
    "--report", poseCli.path,
    "--endpoint-candidate", "1",
    "--decision", "accepted",
    "--note", "atomic pose endpoint review",
    "--evidence", compositePath
  ]);
  assert.equal(poseSuccess.status, 0, poseSuccess.stderr);
  assert.equal(JSON.parse(readFileSync(poseCli.path, "utf8")).approvedEndpoint.poseGuided, true);

  const videoCli = writeReport("video-cli.json", technicalVideo);
  const videoSuccess = runCli([
    "--report", videoCli.path,
    "--video-candidate", "1",
    "--decision", "accepted",
    "--note", "atomic video review",
    "--evidence", videoEvidencePath
  ]);
  assert.equal(videoSuccess.status, 0, videoSuccess.stderr);
  assert.equal(existsSync(`${videoCli.path}.tmp`), false);
  assert.equal(JSON.parse(readFileSync(videoCli.path, "utf8")).approvedVideo.candidate, 1);

  const driftCli = writeReport("drift-cli.json", technicalEndpoint);
  writeFileSync(authoritativeReportPath, "authoritative report drift\n", "utf8");
  const driftResult = runCli([
    "--report", driftCli.path,
    "--endpoint-candidate", "1",
    "--decision", "accepted",
    "--note", "must reject authoritative drift",
    "--evidence", compositePath
  ]);
  assert.notEqual(driftResult.status, 0);
  assert.equal(readFileSync(driftCli.path, "utf8"), driftCli.contents);
  console.log("Wan FLF2V experiment contract: PASS");
} finally {
  rmSync(experimentRoot, { recursive: true, force: true });
}
