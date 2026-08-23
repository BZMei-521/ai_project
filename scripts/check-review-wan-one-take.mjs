import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const dir = mkdtempSync(resolve(tmpdir(), "wan-review-"));
const cliPath = resolve("scripts/review-wan-one-take.mjs");

function runFfmpeg(args) {
  const result = spawnSync("ffmpeg", args, { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}

const fixtureNativePath = resolve(dir, "fixture-native.mp4");
const fixtureAlternateNativePath = resolve(dir, "fixture-alternate-native.mp4");
const fixtureDeliveryPath = resolve(dir, "fixture-delivery.mp4");
const fixtureShortDeliveryPath = resolve(dir, "fixture-short-delivery.mp4");
const fixtureImagePath = resolve(dir, "fixture-evidence.png");
runFfmpeg([
  "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=832x480:r=16",
  "-frames:v", "97", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", fixtureNativePath
]);
runFfmpeg([
  "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=832x480:r=16",
  "-frames:v", "97", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", fixtureAlternateNativePath
]);
runFfmpeg([
  "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=832x480:r=24",
  "-t", "6", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", fixtureDeliveryPath
]);
runFfmpeg([
  "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=832x480:r=24",
  "-t", "1", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", fixtureShortDeliveryPath
]);
runFfmpeg([
  "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=32x32",
  "-frames:v", "1", "-update", "1", fixtureImagePath
]);

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value), "utf8");
}

function segment(order, status = "pending") {
  return {
    id: `segment_${String(order).padStart(3, "0")}`,
    order,
    technicalAccepted: true,
    creativeAcceptance: { status },
    accepted: status === "accepted",
    videoPath: `segment-${order}.mp4`,
    finalFramePath: `segment-${order}.png`,
    finalFrameSha256: `hash-${order}`
  };
}

function run(args) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8", windowsHide: true });
}

function makeEvidence(name = "evidence.png") {
  const path = resolve(dir, name);
  writeFileSync(path, "evidence");
  return path;
}

function makeCompleteAssembly(name, missing = new Set()) {
  const nativePath = resolve(dir, `${name}-native.mp4`);
  const deliveryPath = resolve(dir, `${name}-delivery.mp4`);
  const fullContactSheetPath = resolve(dir, `${name}-one_take_97_frames.png`);
  const boundarySheetPaths = Array.from(
    { length: 5 },
    (_, index) => resolve(dir, `${name}-boundary-${index + 1}.png`)
  );
  const files = [
    ["native", nativePath, fixtureNativePath],
    ["delivery", deliveryPath, fixtureDeliveryPath],
    ["full", fullContactSheetPath, fixtureImagePath],
    ...boundarySheetPaths.map((path, index) => [`boundary-${index + 1}`, path, fixtureImagePath])
  ];
  for (const [key, path, fixturePath] of files) {
    if (!missing.has(key)) copyFileSync(fixturePath, path);
  }
  return {
    nativePath,
    deliveryPath,
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
    evidence: { fullContactSheetPath, boundarySheetPaths },
    integrity: {
      nativeSha256: sha256File(fixtureNativePath),
      deliverySha256: sha256File(fixtureDeliveryPath),
      fullContactSheetSha256: sha256File(fixtureImagePath),
      boundarySheetSha256s: Array.from({ length: 5 }, () => sha256File(fixtureImagePath))
    }
  };
}

const acceptedSegments = Array.from({ length: 6 }, (_, index) => ({
  id: `segment_${String(index + 1).padStart(3, "0")}`,
  order: index + 1,
  technicalAccepted: true,
  creativeAcceptance: { status: "accepted" },
  accepted: true
}));

// Required end-to-end segment acceptance check.
{
  const reportPath = resolve(dir, "report.json");
  const evidencePath = makeEvidence("segment_001.png");
  writeJson(reportPath, { segments: [segment(1)], overallAccepted: false });
  const result = run(["--report", reportPath, "--segment", "1", "--decision", "accepted", "--note", "clear half-step and slow push", "--evidence", evidencePath]);
  assert.equal(result.status, 0, result.stderr);
  const updated = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(updated.segments[0].creativeAcceptance.status, "accepted");
  assert.equal(updated.segments[0].accepted, true);
  assert.equal(updated.overallAccepted, false);
}

// Segment rejection remains non-accepted and preserves a valid JSON report.
{
  const reportPath = resolve(dir, "segment-rejected.json");
  const evidencePath = makeEvidence("segment-rejected.png");
  writeJson(reportPath, { segments: [segment(1)], overallAccepted: true });
  const result = run(["--report", reportPath, "--segment", "1", "--decision", "rejected", "--note", "foot slide", "--evidence", evidencePath]);
  assert.equal(result.status, 0, result.stderr);
  const updated = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(updated.segments[0].creativeAcceptance.status, "rejected");
  assert.equal(updated.segments[0].accepted, false);
  assert.equal(updated.overallAccepted, false);
}

// Rejecting an earlier segment invalidates its suffix and every assembled/final state derived from it.
{
  const reportPath = resolve(dir, "segment-rejected-truncates.json");
  const evidencePath = makeEvidence("segment-rejected-truncates.png");
  writeJson(reportPath, {
    segments: Array.from({ length: 6 }, (_, index) => segment(index + 1, "accepted")),
    technicalAcceptedSegments: 6,
    acceptedSegments: 6,
    assembly: { nativePath: "stale-native.mp4", deliveryPath: "stale-delivery.mp4" },
    finalAcceptance: { status: "accepted" },
    overallAccepted: true
  });
  const result = run([
    "--report", reportPath,
    "--segment", "3",
    "--decision", "rejected",
    "--note", "identity drift begins here",
    "--evidence", evidencePath
  ]);
  assert.equal(result.status, 0, result.stderr);
  const updated = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.deepEqual(updated.segments.map((entry) => entry.order), [1, 2, 3]);
  assert.equal(updated.segments[2].creativeAcceptance.status, "rejected");
  assert.equal(updated.segments[2].accepted, false);
  assert.equal(updated.technicalAcceptedSegments, 3);
  assert.equal(updated.acceptedSegments, 2);
  assert.equal("assembly" in updated, false);
  assert.equal("finalAcceptance" in updated, false);
  assert.equal(updated.overallAccepted, false);
}

// Final review is the only authority that can flip overall acceptance.
{
  const reportPath = resolve(dir, "final-review.json");
  const assembly = makeCompleteAssembly("final-review");
  const evidencePath = assembly.evidence.fullContactSheetPath;
  writeFileSync(reportPath, JSON.stringify({
    segments: acceptedSegments,
    assembly,
    finalAcceptance: { status: "pending" },
    overallAccepted: false
  }));

  const finalAcceptedResult = spawnSync(process.execPath, [
    "scripts/review-wan-one-take.mjs",
    "--report", reportPath,
    "--final-decision", "accepted",
    "--note", "all six actions, identities and boundaries pass",
    "--evidence", evidencePath
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(finalAcceptedResult.status, 0, finalAcceptedResult.stderr);
  const acceptedReport = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(acceptedReport.overallAccepted, true);
  for (const path of [
    acceptedReport.assembly.nativePath,
    acceptedReport.assembly.deliveryPath,
    acceptedReport.assembly.evidence.fullContactSheetPath,
    ...acceptedReport.assembly.evidence.boundarySheetPaths
  ]) unlinkSync(path);

  const finalRejectedResult = spawnSync(process.execPath, [
    "scripts/review-wan-one-take.mjs",
    "--report", reportPath,
    "--final-decision", "rejected",
    "--note", "motion freezes before the final beat",
    "--evidence", makeEvidence("final-rejected-review.png")
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(finalRejectedResult.status, 0, finalRejectedResult.stderr);
  assert.equal(JSON.parse(readFileSync(reportPath, "utf8")).overallAccepted, false);
}

// Final review requires pending state, complete metadata, and every stored media/evidence path to exist.
{
  const reviewEvidencePath = makeEvidence("gate-review-evidence.png");
  const cases = [
    {
      name: "mismatched-final-evidence",
      report: { segments: acceptedSegments, assembly: makeCompleteAssembly("mismatched-final-evidence"), finalAcceptance: { status: "pending" }, overallAccepted: false },
      evidencePath: reviewEvidencePath
    },
    {
      name: "missing-pending",
      report: { segments: acceptedSegments, assembly: makeCompleteAssembly("missing-pending"), overallAccepted: false }
    },
    {
      name: "incomplete",
      report: (() => {
        const assembly = makeCompleteAssembly("incomplete");
        delete assembly.deliveryMetadata;
        return { segments: acceptedSegments, assembly, finalAcceptance: { status: "pending" }, overallAccepted: false };
      })()
    },
    {
      name: "path-only",
      report: (() => {
        const nativePath = makeEvidence("path-only-native.mp4");
        const deliveryPath = makeEvidence("path-only-delivery.mp4");
        return { segments: acceptedSegments, assembly: { nativePath, deliveryPath }, finalAcceptance: { status: "pending" }, overallAccepted: false };
      })()
    },
    {
      name: "missing-actual-media",
      report: { segments: acceptedSegments, assembly: makeCompleteAssembly("missing-actual-media", new Set(["native"])), finalAcceptance: { status: "pending" }, overallAccepted: false }
    },
    {
      name: "missing-evidence",
      report: { segments: acceptedSegments, assembly: makeCompleteAssembly("missing-evidence", new Set(["boundary-3"])), finalAcceptance: { status: "pending" }, overallAccepted: false }
    },
    {
      name: "empty-native",
      report: (() => {
        const assembly = makeCompleteAssembly("empty-native");
        writeFileSync(assembly.nativePath, "");
        return { segments: acceptedSegments, assembly, finalAcceptance: { status: "pending" }, overallAccepted: false };
      })()
    },
    {
      name: "truncated-delivery",
      report: (() => {
        const assembly = makeCompleteAssembly("truncated-delivery");
        writeFileSync(assembly.deliveryPath, readFileSync(assembly.deliveryPath).subarray(0, 64));
        return { segments: acceptedSegments, assembly, finalAcceptance: { status: "pending" }, overallAccepted: false };
      })()
    },
    {
      name: "replaced-native",
      report: (() => {
        const assembly = makeCompleteAssembly("replaced-native");
        copyFileSync(assembly.deliveryPath, assembly.nativePath);
        return { segments: acceptedSegments, assembly, finalAcceptance: { status: "pending" }, overallAccepted: false };
      })()
    },
    {
      name: "same-spec-replaced-native",
      report: (() => {
        const assembly = makeCompleteAssembly("same-spec-replaced-native");
        copyFileSync(fixtureAlternateNativePath, assembly.nativePath);
        return { segments: acceptedSegments, assembly, finalAcceptance: { status: "pending" }, overallAccepted: false };
      })()
    },
    {
      name: "short-delivery-duration",
      report: (() => {
        const assembly = makeCompleteAssembly("short-delivery-duration");
        copyFileSync(fixtureShortDeliveryPath, assembly.deliveryPath);
        assembly.integrity.deliverySha256 = sha256File(assembly.deliveryPath);
        return { segments: acceptedSegments, assembly, finalAcceptance: { status: "pending" }, overallAccepted: false };
      })()
    },
    {
      name: "empty-evidence",
      report: (() => {
        const assembly = makeCompleteAssembly("empty-evidence");
        writeFileSync(assembly.evidence.fullContactSheetPath, "");
        return { segments: acceptedSegments, assembly, finalAcceptance: { status: "pending" }, overallAccepted: false };
      })()
    },
    {
      name: "truncated-evidence",
      report: (() => {
        const assembly = makeCompleteAssembly("truncated-evidence");
        const path = assembly.evidence.boundarySheetPaths[1];
        writeFileSync(path, readFileSync(path).subarray(0, 8));
        return { segments: acceptedSegments, assembly, finalAcceptance: { status: "pending" }, overallAccepted: false };
      })()
    },
    {
      name: "replaced-evidence",
      report: (() => {
        const assembly = makeCompleteAssembly("replaced-evidence");
        writeFileSync(assembly.evidence.boundarySheetPaths[4], "not a decodable image");
        return { segments: acceptedSegments, assembly, finalAcceptance: { status: "pending" }, overallAccepted: false };
      })()
    }
  ];
  for (const { name, report, evidencePath } of cases) {
    const reportPath = resolve(dir, `${name}.json`);
    const before = JSON.stringify(report);
    writeFileSync(reportPath, before, "utf8");
    const result = run([
      "--report", reportPath,
      "--final-decision", "accepted",
      "--note", "must satisfy the complete final gate",
      "--evidence", evidencePath || report.assembly?.evidence?.fullContactSheetPath || reviewEvidencePath
    ]);
    assert.notEqual(result.status, 0, `${name} must fail final review`);
    assert.equal(readFileSync(reportPath, "utf8"), before, `${name} must leave the report unchanged`);
  }
}

// Invalid invocation, missing report/evidence, and mixed authority leave reports unchanged.
{
  const reportPath = resolve(dir, "unchanged.json");
  const before = JSON.stringify({ segments: [segment(1)], overallAccepted: false });
  writeFileSync(reportPath, before, "utf8");
  const evidencePath = makeEvidence("unchanged.png");
  for (const args of [
    ["--report", reportPath, "--segment", "7", "--decision", "accepted", "--note", "bad", "--evidence", evidencePath],
    ["--report", reportPath, "--segment", "1", "--decision", "accepted", "--final-decision", "accepted", "--note", "bad", "--evidence", evidencePath],
    ["--report", resolve(dir, "missing.json"), "--segment", "1", "--decision", "accepted", "--note", "bad", "--evidence", evidencePath],
    ["--report", reportPath, "--segment", "1", "--decision", "accepted", "--note", "bad", "--evidence", resolve(dir, "missing.png")]
  ]) {
    assert.notEqual(run(args).status, 0);
    assert.equal(readFileSync(reportPath, "utf8"), before);
  }
}

// A rejected final review outside the allowed acceptance state cannot overwrite the report.
{
  const reportPath = resolve(dir, "unauthorized-final.json");
  const before = JSON.stringify({ segments: Array.from({ length: 6 }, (_, index) => segment(index + 1)), assembly: { nativePath: "a.mov", deliveryPath: "a.mp4" } });
  writeFileSync(reportPath, before, "utf8");
  const result = run(["--report", reportPath, "--final-decision", "rejected", "--note", "not ready", "--evidence", makeEvidence("unauthorized.png")]);
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(reportPath, "utf8"), before);
}

// Successful updates replace the report atomically and leave no temporary file behind.
{
  const reportPath = resolve(dir, "atomic.json");
  writeJson(reportPath, { segments: [segment(1)], overallAccepted: false });
  const result = run(["--report", reportPath, "--segment", "1", "--decision", "accepted", "--note", "atomic update", "--evidence", makeEvidence("atomic.png")]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(`${reportPath}.tmp`), false);
  assert.doesNotThrow(() => JSON.parse(readFileSync(reportPath, "utf8")));
}

console.log("Wan one-take review CLI: PASS");
