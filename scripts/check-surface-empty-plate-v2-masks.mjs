import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SURFACE_MASK_LAYOUT_VERSION,
  assertOutsideEditableIdentity,
  assertSurfaceMaskManifest,
  buildSurfaceMasks,
  deriveProtectedMask,
} from "./lib/surface-empty-plate-v2-masks.mjs";

function run(command, args, encoding = "utf8") {
  const result = spawnSync(command, args, { encoding, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${String(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

function png(destination, filter, size = "1152x640") {
  run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=0x203040:s=${size}:d=0.04`, "-vf", filter, "-frames:v", "1", destination]);
  return destination;
}

function fixtureMutation(source, destination, filter) {
  run("ffmpeg", ["-y", "-v", "error", "-i", source, "-vf", filter, "-pix_fmt", "gray", "-frames:v", "1", destination]);
  return destination;
}

function grayPixels(filePath) {
  const result = spawnSync("ffmpeg", ["-v", "error", "-i", filePath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"], { encoding: null, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${String(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

function expectReject(work, pattern, label) {
  assert.throws(work, pattern, label);
}

function sha256(filePath) { return createHash("sha256").update(readFileSync(filePath)).digest("hex"); }
function replaceMask(manifest, name, filePath) {
  const next = structuredClone(manifest);
  next.masks[name].path = filePath;
  next.masks[name].size = statSync(filePath).size;
  next.masks[name].sha256 = sha256(filePath);
  return next;
}
function artifact(filePath) { return { path: filePath, size: statSync(filePath).size, sha256: sha256(filePath) }; }
function task2Report(sourcePath, directory) {
  const removalMaskPath = fixtureMutation(sourcePath, path.join(directory, "v1-removal-mask.png"), "format=gray,lut=y=0,drawbox=x=400:y=440:w=110:h=150:color=white:t=fill,drawbox=x=690:y=440:w=90:h=140:color=white:t=fill,gblur=sigma=3:steps=2,format=gray");
  const decoded = grayPixels(removalMaskPath);
  assert.ok(decoded.some((value) => value > 0 && value < 128), "V1 evidence fixture includes sub-threshold feather pixels");
  assert.ok(decoded.some((value) => value >= 128 && value < 255), "V1 evidence fixture includes selected intermediate feather pixels");
  const coverage = [...decoded].filter((value) => value > 127).length / decoded.length;
  const removalMask = { ...artifact(removalMaskPath), width: 1152, height: 640, coverage };
  const legacyPath = path.join(directory, "v1-stopped-report.json"); writeFileSync(legacyPath, `${JSON.stringify({ stages: { empty_plate: { candidates: [1, 2, 3].map(() => ({ state: "rejected", removalMask, references: { removalMask } })) } } })}\n`);
  const source = { ...artifact(sourcePath), width: 1152, height: 640 };
  const report = {
    schema: 1, experiment: "surface-aligned-empty-plate-v2", source,
    legacyEvidence: { reportPath: legacyPath, reportSha256: sha256(legacyPath), stoppedReason: "empty_plate_max_three_rejected" },
    stages: { upper_background: [], middle_background: [], lower_background: [], final_empty_plate: [] }, overallStatus: "pending", invalidations: [],
  };
  const reportPath = path.join(directory, "task2-run-report.json"); writeFileSync(reportPath, `${JSON.stringify(report)}\n`); return reportPath;
}
function task2ReportWithLegacyMutation(reportPath, directory, label, mutate) {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const legacy = JSON.parse(readFileSync(report.legacyEvidence.reportPath, "utf8"));
  mutate(legacy);
  const legacyPath = path.join(directory, `${label}-v1-report.json`); writeFileSync(legacyPath, `${JSON.stringify(legacy)}\n`);
  report.legacyEvidence.reportPath = legacyPath; report.legacyEvidence.reportSha256 = sha256(legacyPath);
  const nextReportPath = path.join(directory, `${label}-task2-report.json`); writeFileSync(nextReportPath, `${JSON.stringify(report)}\n`); return nextReportPath;
}
function task2ReportWithLegacyRemoval(reportPath, directory, label, removalMask) { return task2ReportWithLegacyMutation(reportPath, directory, label, (legacy) => { legacy.stages.empty_plate.candidates = legacy.stages.empty_plate.candidates.map((candidate) => ({ ...candidate, removalMask, references: { ...candidate.references, removalMask } })); }); }
function replaceOverlap(manifest, name, filePath, rows, bounds) {
  const next = structuredClone(manifest); next.overlaps[name] = { ...next.overlaps[name], ...artifact(filePath), rows, bounds }; return next;
}
function replaceProtected(manifest, name, filePath) { const next = structuredClone(manifest); next.protectedMasks[name] = { ...next.protectedMasks[name], ...artifact(filePath) }; return next; }
function replaceOverlay(manifest, filePath) { const next = structuredClone(manifest); next.combinedOverlay = artifact(filePath); return next; }

const root = mkdtempSync(path.join(tmpdir(), "surface-empty-plate-v2-masks-"));
try {
  const source = png(path.join(root, "mother.png"), "format=rgb24");
  const reportPath = task2Report(source, root);
  const outputRoot = path.join(root, "built");
  const manifest = buildSurfaceMasks({ reportPath, outputRoot });
  assert.equal(manifest.version, "surface_empty_plate_v2_masks_v1");
  assert.equal(manifest.version, SURFACE_MASK_LAYOUT_VERSION);
  assert.equal(manifest.task2RunReport.sha256, sha256(reportPath), "manifest freezes the Task 2 run report");
  assert.deepEqual(manifest.source, { ...artifact(source), width: 1152, height: 640 }, "manifest source is exactly the report-pinned mother frame");
  assert.equal(manifest.masks.upper_background.coverage, 504 * 232 / (1152 * 640));
  assert.equal(manifest.masks.middle_background.coverage, 504 * 252 / (1152 * 640));
  assert.equal(manifest.masks.lower_background.coverage, 570 * 200 / (1152 * 640));
  assert.equal(manifest.overlaps.upperMiddle.rows, 32);
  assert.equal(manifest.overlaps.middleLower.rows, 32);
  assert.deepEqual(manifest.v1Evidence.foregroundThreshold, { operator: ">", value: 127 }, "V1 feather evidence freezes its threshold semantics");
  assert.equal(manifest.v1Evidence.removalMask.coverage, JSON.parse(readFileSync(JSON.parse(readFileSync(reportPath, "utf8")).legacyEvidence.reportPath, "utf8")).stages.empty_plate.candidates[0].removalMask.coverage, "manifest retains the thresholded frozen V1 coverage");
  assert.ok(existsSync(manifest.overlaps.upperMiddle.path), "upper/middle overlap has an exact raster mask");
  assert.ok(existsSync(manifest.overlaps.middleLower.path), "middle/lower overlap has an exact raster mask");
  assert.deepEqual(manifest.masks.upper_background.bounds, { minX: 336, minY: 20, maxX: 839, maxY: 251 });
  assert.deepEqual(manifest.masks.middle_background.bounds, { minX: 336, minY: 220, maxX: 839, maxY: 471 });
  assert.deepEqual(manifest.masks.lower_background.bounds, { minX: 280, minY: 440, maxX: 849, maxY: 639 });
  for (const item of Object.values(manifest.masks)) assert.equal(item.polarity, "white-editable_black-protected");
  for (const item of Object.values(manifest.protectedMasks)) assert.equal(item.polarity, "white-protected_black-editable", "consumer-facing protected masks must declare their actual white=protected polarity");
  assert.ok(existsSync(manifest.combinedOverlay.path), "combined source overlay is persisted");
  assert.doesNotThrow(() => assertSurfaceMaskManifest(manifest));
  const alteredOverlay = path.join(root, "altered-overlay.png"); run("ffmpeg", ["-y", "-v", "error", "-i", manifest.combinedOverlay.path, "-vf", "drawbox=x=2:y=2:w=1:h=1:color=blue:t=fill,format=rgb24", "-frames:v", "1", alteredOverlay]);
  expectReject(() => assertSurfaceMaskManifest(replaceOverlay(manifest, alteredOverlay)), /overlay.*pinned source|overlay.*red surface/i, "overlay mutation is rejected against the deterministic source-band render");
  const forgedPending = structuredClone(manifest); forgedPending.v1Evidence.reviewStatus = "accepted";
  expectReject(() => assertSurfaceMaskManifest(forgedPending), /V1.*provenance|review/i, "semantic shadow review cannot be self-accepted in the mask manifest");

  const manifestPath = path.join(outputRoot, "surface-mask-manifest.json");
  assert.ok(existsSync(manifestPath));
  assert.deepEqual(JSON.parse(readFileSync(manifestPath, "utf8")), manifest, "atomic manifest is the frozen return value");
  expectReject(() => buildSurfaceMasks({ reportPath, outputRoot }), /overwrite|exists/i, "a build may never overwrite an existing frozen artifact");

  const corrupted = structuredClone(manifest); corrupted.masks.upper_background.sha256 = "0".repeat(64);
  expectReject(() => assertSurfaceMaskManifest(corrupted), /hash/i, "changed hash is rejected");
  const corruptPath = path.join(root, "corrupt.png"); writeFileSync(corruptPath, "not a PNG");
  const corrupt = replaceMask(manifest, "upper_background", corruptPath);
  expectReject(() => assertSurfaceMaskManifest(corrupt), /decode|probe|png/i, "corrupt PNG is rejected");
  const rgbPath = path.join(root, "rgb.png"); run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=white:s=1152x640:d=0.04", "-pix_fmt", "rgb24", "-frames:v", "1", rgbPath]);
  const rgb = replaceMask(manifest, "upper_background", rgbPath);
  expectReject(() => assertSurfaceMaskManifest(rgb), /gray|pixel/i, "RGB mask is rejected before it can be used");
  const gray16Path = path.join(root, "gray16.png"); run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=white:s=1152x640:d=0.04", "-pix_fmt", "gray16be", "-frames:v", "1", gray16Path]);
  expectReject(() => assertSurfaceMaskManifest(replaceMask(manifest, "upper_background", gray16Path)), /pixel.*gray|gray.*exact/i, "gray16 is rejected; only 8-bit gray is allowed");
  const invertedPath = fixtureMutation(manifest.masks.upper_background.path, path.join(root, "inverted.png"), "negate,format=gray");
  const inverted = replaceMask(manifest, "upper_background", invertedPath);
  expectReject(() => assertSurfaceMaskManifest(inverted), /white|polarity|rectangle|outside/i, "inverted polarity is rejected");
  const wrongSizePath = fixtureMutation(manifest.masks.upper_background.path, path.join(root, "wrong-size.png"), "scale=1151:640,format=gray");
  const wrongSize = replaceMask(manifest, "upper_background", wrongSizePath);
  expectReject(() => assertSurfaceMaskManifest(wrongSize), /1152.*640|geometry/i, "wrong-size mask is rejected");
  const silhouettePath = fixtureMutation(manifest.masks.upper_background.path, path.join(root, "silhouette.png"), "drawbox=x=336:y=20:w=504:h=232:color=black:t=fill,drawbox=x=560:y=30:w=45:h=210:color=white:t=fill,format=gray");
  const silhouette = replaceMask(manifest, "upper_background", silhouettePath);
  expectReject(() => assertSurfaceMaskManifest(silhouette), /solidity|rectangle|coverage/i, "person-silhouette-like low-solidity mask is rejected");
  const noShadowPath = fixtureMutation(manifest.masks.lower_background.path, path.join(root, "no-shadow.png"), "drawbox=x=280:y=560:w=570:h=80:color=black:t=fill,format=gray");
  const noShadow = replaceMask(manifest, "lower_background", noShadowPath);
  expectReject(() => assertSurfaceMaskManifest(noShadow), /shadow|rectangle|solidity/i, "lower mask must include its frozen cast-shadow region");
  const protectedMutationPath = fixtureMutation(manifest.protectedMasks.upper_background.path, path.join(root, "protected-mutation.png"), "drawbox=x=400:y=80:w=1:h=1:color=white:t=fill,format=gray");
  expectReject(() => assertSurfaceMaskManifest(replaceProtected(manifest, "upper_background", protectedMutationPath)), /protected.*rule|protected.*inverse/i, "protected-mask mutation is rejected against the executable union rule");
  for (const rows of [31, 33]) {
    const changedPath = fixtureMutation(manifest.overlaps.upperMiddle.path, path.join(root, `overlap-${rows}.png`), rows === 31 ? "drawbox=x=336:y=251:w=504:h=1:color=black:t=fill,format=gray" : "pad=1152:641:0:0:color=black,crop=1152:640:0:0,drawbox=x=336:y=252:w=504:h=1:color=white:t=fill,format=gray");
    const changedOverlap = replaceOverlap(manifest, "upperMiddle", changedPath, rows, rows === 31 ? { minX: 336, minY: 220, maxX: 839, maxY: 250 } : { minX: 336, minY: 220, maxX: 839, maxY: 252 });
    expectReject(() => assertSurfaceMaskManifest(changedOverlap), /overlap|32/i, `${rows}-row overlap is rejected`);
  }
  const forgedReportPath = path.join(root, "forged-task2-run-report.json");
  const forgedReport = JSON.parse(readFileSync(reportPath, "utf8")); forgedReport.source.sha256 = "0".repeat(64); writeFileSync(forgedReportPath, `${JSON.stringify(forgedReport)}\n`);
  expectReject(() => buildSurfaceMasks({ reportPath: forgedReportPath, outputRoot: path.join(root, "forged-build") }), /source.*hash|report.*source/i, "report-pinned mother source hash must match the actual media");
  const invalidRunPath = path.join(root, "invalid-task2-run-report.json"); const invalidRun = JSON.parse(readFileSync(reportPath, "utf8")); invalidRun.stages.middle_background = [{ id: "candidate_001" }]; writeFileSync(invalidRunPath, `${JSON.stringify(invalidRun)}\n`);
  const invalidOutput = path.join(root, "invalid-run-output"); expectReject(() => buildSurfaceMasks({ reportPath: invalidRunPath, outputRoot: invalidOutput }), /run report invariant|masks|required|candidate/i, "invalid Task 2 stage chain fails before any output is created"); assert.equal(existsSync(invalidOutput), false, "invalid Task 2 reports create zero output");
  const tamperedLegacyPath = path.join(root, "tampered-v1-report.json"); const tamperedLegacy = JSON.parse(readFileSync(JSON.parse(readFileSync(reportPath, "utf8")).legacyEvidence.reportPath, "utf8")); tamperedLegacy.stages.empty_plate.candidates[0].removalMask.sha256 = "0".repeat(64); writeFileSync(tamperedLegacyPath, `${JSON.stringify(tamperedLegacy)}\n`);
  const tamperedTask2Path = path.join(root, "tampered-v1-task2-report.json"); const tamperedTask2 = JSON.parse(readFileSync(reportPath, "utf8")); tamperedTask2.legacyEvidence.reportPath = tamperedLegacyPath; tamperedTask2.legacyEvidence.reportSha256 = sha256(tamperedLegacyPath); writeFileSync(tamperedTask2Path, `${JSON.stringify(tamperedTask2)}\n`);
  expectReject(() => buildSurfaceMasks({ reportPath: tamperedTask2Path, outputRoot: path.join(root, "tampered-v1-output") }), /V1 removal mask.*hash|removal mask.*hash/i, "tampered immutable V1 removal-mask provenance is rejected");
  const legacy = JSON.parse(readFileSync(JSON.parse(readFileSync(reportPath, "utf8")).legacyEvidence.reportPath, "utf8")); const frozenRemoval = legacy.stages.empty_plate.candidates[0].removalMask;
  const divergentReferencePath = path.join(root, "divergent-reference-v1-removal.png"); cpSync(frozenRemoval.path, divergentReferencePath); const divergentReference = { ...artifact(divergentReferencePath), width: 1152, height: 640, coverage: frozenRemoval.coverage };
  const divergentReferenceReportPath = task2ReportWithLegacyMutation(reportPath, root, "divergent-reference-v1", (next) => { next.stages.empty_plate.candidates[0].references.removalMask = divergentReference; });
  expectReject(() => buildSurfaceMasks({ reportPath: divergentReferenceReportPath, outputRoot: path.join(root, "divergent-reference-v1-output") }), /V1 candidate 1.*reference|reference.*provenance/i, "each V1 nested removal-mask reference must match its top-level frozen resource");
  const missingTopLevelReportPath = task2ReportWithLegacyMutation(reportPath, root, "missing-top-level-v1", (next) => { delete next.stages.empty_plate.candidates[1].removalMask; });
  expectReject(() => buildSurfaceMasks({ reportPath: missingTopLevelReportPath, outputRoot: path.join(root, "missing-top-level-v1-output") }), /V1 candidate 2.*top-level|removal mask.*missing/i, "every V1 candidate must retain its top-level frozen removal-mask record");
  const missingReferenceReportPath = task2ReportWithLegacyMutation(reportPath, root, "missing-reference-v1", (next) => { delete next.stages.empty_plate.candidates[2].references.removalMask; });
  expectReject(() => buildSurfaceMasks({ reportPath: missingReferenceReportPath, outputRoot: path.join(root, "missing-reference-v1-output") }), /V1 candidate 3.*reference|removal mask.*missing/i, "every V1 candidate must retain its nested frozen removal-mask reference");
  const rgbV1Path = path.join(root, "rgb-v1-removal.png"); run("ffmpeg", ["-y", "-v", "error", "-i", frozenRemoval.path, "-vf", "format=rgb24", "-pix_fmt", "rgb24", "-frames:v", "1", rgbV1Path]);
  const rgbV1ReportPath = task2ReportWithLegacyRemoval(reportPath, root, "rgb-v1", { ...artifact(rgbV1Path), width: 1152, height: 640, coverage: frozenRemoval.coverage });
  expectReject(() => buildSurfaceMasks({ reportPath: rgbV1ReportPath, outputRoot: path.join(root, "rgb-v1-output") }), /V1 removal mask.*gray|pixel format.*gray/i, "immutable V1 evidence must remain exact 8-bit grayscale");
  const wrongSizeV1Path = fixtureMutation(frozenRemoval.path, path.join(root, "wrong-size-v1-removal.png"), "scale=1151:640,format=gray");
  const wrongSizeV1ReportPath = task2ReportWithLegacyRemoval(reportPath, root, "wrong-size-v1", { ...artifact(wrongSizeV1Path), width: 1152, height: 640, coverage: frozenRemoval.coverage });
  expectReject(() => buildSurfaceMasks({ reportPath: wrongSizeV1ReportPath, outputRoot: path.join(root, "wrong-size-v1-output") }), /V1 removal mask.*1152.*640|geometry/i, "immutable V1 evidence must retain exact geometry");
  const wrongCoverageV1ReportPath = task2ReportWithLegacyRemoval(reportPath, root, "wrong-coverage-v1", { ...frozenRemoval, coverage: frozenRemoval.coverage + (1 / (1152 * 640)) });
  expectReject(() => buildSurfaceMasks({ reportPath: wrongCoverageV1ReportPath, outputRoot: path.join(root, "wrong-coverage-v1-output") }), /V1 candidate.*coverage|frozen coverage/i, "candidate-frozen V1 coverage must exactly equal the decoded >127 coverage");

  const before = png(path.join(root, "before.png"), "format=rgb24");
  const changedInside = path.join(root, "changed-inside.png");
  run("ffmpeg", ["-y", "-v", "error", "-i", before, "-vf", "drawbox=x=400:y=80:w=20:h=20:color=red:t=fill,format=rgb24", "-frames:v", "1", changedInside]);
  assert.doesNotThrow(() => assertOutsideEditableIdentity(before, changedInside, manifest.masks.upper_background.path));
  const changedOutside = path.join(root, "changed-outside.png");
  run("ffmpeg", ["-y", "-v", "error", "-i", before, "-vf", "drawbox=x=5:y=5:w=20:h=20:color=red:t=fill,format=rgb24", "-frames:v", "1", changedOutside]);
  expectReject(() => assertOutsideEditableIdentity(before, changedOutside, manifest.masks.upper_background.path), /protected|outside|identity/i, "protected pixels remain byte-identical");
  const nonbinaryPath = fixtureMutation(manifest.masks.upper_background.path, path.join(root, "nonbinary.png"), "drawbox=x=400:y=80:w=1:h=1:color=0x808080:t=fill,format=gray");
  expectReject(() => assertOutsideEditableIdentity(before, changedInside, nonbinaryPath), /binary|0.*255/i, "identity checking rejects nonbinary editable masks");
  const protectedOutput = path.join(root, "derived-protected.png");
  const currentForProtection = fixtureMutation(manifest.masks.upper_background.path, path.join(root, "current-for-protection.png"), "lut=y=255,format=gray");
  const previousInterior = fixtureMutation(manifest.masks.upper_background.path, path.join(root, "previous-interior.png"), "lut=y=0,drawbox=x=400:y=80:w=5:h=5:color=white:t=fill,format=gray");
  const frozenOverlap = fixtureMutation(manifest.masks.upper_background.path, path.join(root, "frozen-overlap.png"), "lut=y=0,drawbox=x=402:y=80:w=3:h=5:color=white:t=fill,format=gray");
  deriveProtectedMask({ currentEditableMask: currentForProtection, previousAcceptedInterior: previousInterior, frozenOverlapMask: frozenOverlap, outputPath: protectedOutput });
  const editableFromProtected = fixtureMutation(protectedOutput, path.join(root, "editable-from-protected.png"), "negate,format=gray");
  const previousProtectedChange = path.join(root, "previous-protected-change.png");
  run("ffmpeg", ["-y", "-v", "error", "-i", before, "-vf", "drawbox=x=400:y=80:w=1:h=1:color=red:t=fill,format=rgb24", "-frames:v", "1", previousProtectedChange]);
  expectReject(() => assertOutsideEditableIdentity(before, previousProtectedChange, editableFromProtected), /protected|outside/i, "previous accepted interior is unioned into the executable protected mask");

  const manifestCopy = path.join(root, "manifest-copy.json"); cpSync(manifestPath, manifestCopy);
  assert.ok(readFileSync(manifestCopy).length > 0);
  const builder = path.resolve("scripts/build-surface-empty-plate-v2-masks.mjs");
  run(process.execPath, [builder, "--report", reportPath]);
  assert.ok(existsSync(path.join(path.dirname(reportPath), "surface-masks", "surface-mask-manifest.json")), "CLI derives a safe report-adjacent output root");
  const escapedRoot = path.join(root, "escaped-output"); const symlinkRoot = path.join(root, "linked-output"); mkdirSync(escapedRoot);
  try {
    symlinkSync(escapedRoot, symlinkRoot, "junction");
    const escaped = spawnSync(process.execPath, [builder, "--report", reportPath, "--output", symlinkRoot], { encoding: "utf8", windowsHide: true });
    assert.notEqual(escaped.status, 0, "CLI fails closed when an output junction escapes the report directory");
  } catch (error) { if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error; }
  console.log("Surface empty plate V2 mask contract: PASS");
} finally {
  rmSync(root, { recursive: true, force: true });
}
