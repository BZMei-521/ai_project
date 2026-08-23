import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertAlphaArtifact, assertMaskArtifact, assertMatteWorkflowTopology, extractMatte, probeImage } from "./lib/layered-compositing-media.mjs";
import { appendCandidate, createRunReport, reviewCandidate, sha256File, writeJsonAtomic } from "./lib/layered-compositing-run.mjs";
import { createRiverLayout } from "./lib/layered-compositing-layout.mjs";
import { compileWorkflow, assertWorkflowObjectInfo } from "./lib/layered-compositing-comfy.mjs";

const root = path.join(tmpdir(), `layered-matte-${process.pid}-${Date.now()}`);
const presetPath = path.resolve("src/modules/comfy-pipeline/presets/layered-birefnet-matte-v1.json");

function run(command, args, encoding = "utf8") {
  return execFileSync(command, args, { encoding, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

function png(filePath, filter, size = "1152x640") {
  mkdirSync(path.dirname(filePath), { recursive: true });
  run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=black:s=${size}:d=0.04`, "-vf", `format=gray,${filter}`, "-pix_fmt", "gray", "-frames:v", "1", filePath]);
  return filePath;
}

function maskFor(contract, filePath, omitted = "") {
  const { allowedBounds: b, head, feet } = contract;
  const centerX = Math.round(b.x + b.width / 2);
  const torsoTop = Math.round(head.y + 18);
  const torsoBottom = Math.round(Math.min(feet.left.y, feet.right.y) - 80);
  const commands = [
    omitted === "head" ? "" : `drawbox=x=${Math.round(head.x - 15)}:y=${Math.max(Math.round(head.y - 8), b.y + 8)}:w=30:h=30:color=white:t=fill`,
    `drawbox=x=${centerX - 25}:y=${torsoTop}:w=50:h=${torsoBottom - torsoTop + 1}:color=white:t=fill`,
    omitted === "leftFoot" ? "" : `drawbox=x=${Math.round(Math.min(centerX - 10, feet.left.x - 5))}:y=${torsoBottom}:w=${Math.round(Math.abs(feet.left.x - (centerX - 10)) + 11)}:h=${Math.round(feet.left.y - torsoBottom + 1)}:color=white:t=fill`,
    omitted === "rightFoot" ? "" : `drawbox=x=${Math.round(Math.min(centerX + 9, feet.right.x - 5))}:y=${torsoBottom}:w=${Math.round(Math.abs(feet.right.x - (centerX + 9)) + 11)}:h=${Math.round(feet.right.y - torsoBottom + 1)}:color=white:t=fill`,
  ].filter(Boolean);
  return png(filePath, `lut=y=0,${commands.join(",")}`);
}

function rgbaFromMask(maskPath, outputPath) {
  run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x527aa1:s=1152x640:d=0.04", "-i", maskPath, "-filter_complex", "[0:v]format=rgb24[rgb];[1:v]format=gray[a];[rgb][a]alphamerge,format=rgba[out]", "-map", "[out]", "-frames:v", "1", outputPath]);
  return outputPath;
}

function renderFakeMatteWorkflow(workflow, foregroundMask, outputPath) {
  const saveEntry = Object.entries(workflow).find(([, node]) => node.class_type === "SaveImage");
  const join = workflow[saveEntry[1].inputs.images[0]]; const alphaSource = workflow[join.inputs.alpha[0]];
  let pngAlpha = foregroundMask;
  if (alphaSource.class_type !== "InvertMask") {
    pngAlpha = path.join(path.dirname(outputPath), `${path.parse(outputPath).name}-wrong-alpha.png`);
    run("ffmpeg", ["-y", "-v", "error", "-i", foregroundMask, "-vf", "negate,format=gray", "-pix_fmt", "gray", "-frames:v", "1", pngAlpha]);
  }
  return rgbaFromMask(pngAlpha, outputPath);
}

function artifact(filePath) {
  const bytes = readFileSync(filePath);
  return { path: path.resolve(filePath), size: bytes.length, sha256: sha256File(filePath) };
}

function pinnedObjectInfo() {
  const string = ["STRING"];
  return {
    LoadImage: { input: { required: { image: [["uploaded.png"], { image_upload: true }] } }, output: ["IMAGE", "MASK"] },
    LoadBackgroundRemovalModel: { input: { required: { bg_removal_name: [["birefnet.safetensors"]] } }, output: ["BACKGROUND_REMOVAL"] },
    RemoveBackground: { input: { required: { bg_removal_model: ["BACKGROUND_REMOVAL"], image: ["IMAGE"] } }, output: ["MASK"] },
    InvertMask: { input: { required: { mask: ["MASK"] } }, output: ["MASK"] },
    JoinImageWithAlpha: { input: { required: { image: ["IMAGE"], alpha: ["MASK"] } }, output: ["IMAGE"] },
    SaveImage: { input: { required: { images: ["IMAGE"], filename_prefix: string } }, output: ["IMAGE"] },
  };
}

function createReportFixture(directory, sourcePng) {
  mkdirSync(directory, { recursive: true });
  const resource = artifact(sourcePng);
  let report = createRunReport({
    source: { ...resource, width: 1152, height: 640 },
    characters: {
      shen_yan: { name: "Shen Yan", species: "human", faceMaster: resource, bodyFront: resource },
      jiang_lan: { name: "Jiang Lan", species: "human", faceMaster: resource, bodyFront: resource },
    },
    lighting: { key: "warm sunset from screen-right/rear", fill: "soft fill from screen-left/front", shadow: "screen-left/front" },
  });
  report = appendCandidate(report, "shen_yan", { id: "candidate_001", artifact: resource, character: "shen_yan" });
  report = appendCandidate(report, "jiang_lan", { id: "candidate_001", artifact: resource, character: "jiang_lan" });
  const technical = structuredClone(report);
  report = reviewCandidate(report, "shen_yan", "candidate_001", { decision: "accepted", note: "identity approved", evidence: resource }, { isDecodable: () => true });
  report = reviewCandidate(report, "jiang_lan", "candidate_001", { decision: "accepted", note: "identity approved", evidence: resource }, { isDecodable: () => true });
  const reportPath = path.join(directory, "report.json");
  writeJsonAtomic(reportPath, report);
  return { reportPath, report, technical };
}

function fakeAdapter(sourcePng, foregroundMask, { objectInfo = pinnedObjectInfo(), onObjectInfo, throwPromptIdWithoutCallback = false } = {}) {
  const calls = []; let queuedWorkflow;
  return {
    calls,
    get queuedWorkflow() { return structuredClone(queuedWorkflow); },
    async objectInfo() { calls.push("objectInfo"); onObjectInfo?.(); return structuredClone(objectInfo); },
    async uploadImage({ filePath }) { calls.push("uploadImage"); assert.equal(sha256File(filePath), sha256File(sourcePng)); return "layered-compositing/input.png"; },
    async queue(workflow, { onQueued } = {}) {
      calls.push("queue"); queuedWorkflow = structuredClone(workflow);
      if (throwPromptIdWithoutCallback) { const error = new Error("transport failed after prompt accepted"); error.promptId = "orphan-prompt-2"; throw error; }
      try { await onQueued?.({ promptId: "matte-prompt-1", queuedAt: 1234 }); }
      catch (error) { error.promptId = "matte-prompt-1"; throw error; }
      return { promptId: "matte-prompt-1", queuedAt: 1234 };
    },
    async capture({ destination, outputNodeId, expectedGeometry }) {
      calls.push("capture"); assert.equal(String(outputNodeId), "6"); assert.deepEqual(expectedGeometry, { width: 1152, height: 640 });
      mkdirSync(path.dirname(destination), { recursive: true }); renderFakeMatteWorkflow(queuedWorkflow, foregroundMask, destination); return { promptId: "matte-prompt-1", destination };
    },
  };
}

mkdirSync(root, { recursive: true });
try {
  const layout = createRiverLayout();
  const contract = layout.people.shen_yan;
  const expected = { width: 1152, height: 640, minCoverage: 0.01, maxCoverage: 0.20, ...contract };
  const validMask = maskFor(contract, path.join(root, "valid-mask.png"));
  const validRgba = rgbaFromMask(validMask, path.join(root, "valid-rgba.png"));

  const probe = probeImage(validMask);
  assert.equal(probe.codecName, "png"); assert.equal(probe.width, 1152); assert.equal(probe.height, 640); assert.match(probe.pixelFormat, /^gray/);
  const maskResult = assertMaskArtifact(validMask, expected);
  assert.equal(maskResult.width, 1152); assert.ok(maskResult.coverage > expected.minCoverage); assert.ok(maskResult.largestComponentRatio > 0.90);
  const alphaResult = assertAlphaArtifact(validRgba, validMask, expected);
  assert.equal(alphaResult.maxAlphaDelta <= 1, true);

  const zero = path.join(root, "zero.png"); writeFileSync(zero, "");
  const corrupt = path.join(root, "corrupt.png"); writeFileSync(corrupt, "not an image");
  const wrongCodec = path.join(root, "jpeg-named-png.png"); run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=1152x640:d=0.04", "-frames:v", "1", "-c:v", "mjpeg", "-f", "image2", wrongCodec]);
  const wrongSize = png(path.join(root, "wrong-size.png"), "lut=y=255", "1024x640");
  const empty = png(path.join(root, "empty.png"), "lut=y=0");
  const full = png(path.join(root, "full.png"), "lut=y=255");
  const connectedForSplit = maskFor(contract, path.join(root, "connected-for-split.png"));
  const disconnected = path.join(root, "disconnected.png");
  run("ffmpeg", ["-y", "-v", "error", "-i", connectedForSplit, "-vf", "drawbox=x=387:y=300:w=161:h=24:color=black:t=fill,format=gray", "-pix_fmt", "gray", "-frames:v", "1", disconnected]);
  const headMissing = maskFor(contract, path.join(root, "head-missing.png"), "head");
  const leftFootMissing = maskFor(contract, path.join(root, "left-foot-missing.png"), "leftFoot");
  const rightFootMissing = maskFor(contract, path.join(root, "right-foot-missing.png"), "rightFoot");
  const canvasCropped = png(path.join(root, "canvas-cropped.png"), "lut=y=0,drawbox=x=0:y=0:w=100:h=640:color=white:t=fill");
  const speckZones = png(path.join(root, "speck-zones.png"), `lut=y=0,drawbox=x=430:y=160:w=55:h=320:color=white:t=fill,drawbox=x=${Math.round(contract.head.x)}:y=${Math.round(contract.head.y)}:w=1:h=1:color=white:t=fill,drawbox=x=${Math.round(contract.feet.left.x)}:y=${Math.round(contract.feet.left.y)}:w=1:h=1:color=white:t=fill,drawbox=x=${Math.round(contract.feet.right.x)}:y=${Math.round(contract.feet.right.y)}:w=1:h=1:color=white:t=fill`);
  const hazeZones = path.join(root, "haze-zones.png");
  run("ffmpeg", ["-y", "-v", "error", "-i", validMask, "-vf", `drawbox=x=${Math.round(contract.head.x - 8)}:y=${Math.round(contract.head.y - 8)}:w=16:h=16:color=0xa0a0a0:t=fill,drawbox=x=${Math.round(contract.feet.left.x - 8)}:y=${Math.round(contract.feet.left.y - 8)}:w=16:h=9:color=0xa0a0a0:t=fill,drawbox=x=${Math.round(contract.feet.right.x - 8)}:y=${Math.round(contract.feet.right.y - 8)}:w=16:h=9:color=0xa0a0a0:t=fill,format=gray`, "-pix_fmt", "gray", "-frames:v", "1", hazeZones]);
  const fullCanvasHaze = path.join(root, "full-canvas-haze.png");
  run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x7f7f7f:s=1152x640:d=0.04", "-i", validMask, "-filter_complex", "[0:v]format=gray[h];[1:v]format=gray[m];[h][m]blend=all_mode=lighten,format=gray[out]", "-map", "[out]", "-pix_fmt", "gray", "-frames:v", "1", fullCanvasHaze]);
  const outsideBoundsHaze = path.join(root, "outside-bounds-haze.png");
  run("ffmpeg", ["-y", "-v", "error", "-i", validMask, "-vf", "drawbox=x=300:y=200:w=20:h=20:color=0x404040:t=fill,format=gray", "-pix_fmt", "gray", "-frames:v", "1", outsideBoundsHaze]);
  const softEdge = path.join(root, "soft-edge.png");
  run("ffmpeg", ["-y", "-v", "error", "-i", validMask, "-vf", "gblur=sigma=0.7,format=gray", "-pix_fmt", "gray", "-frames:v", "1", softEdge]);
  for (const file of [zero, corrupt]) assert.throws(() => assertMaskArtifact(file, expected), /decode|missing|empty|ffprobe|image/i);
  assert.throws(() => assertMaskArtifact(wrongCodec, expected), /codec|png/i);
  assert.throws(() => assertMaskArtifact(wrongSize, expected), /1152.*640|geometry|size/i);
  for (const file of [empty, full]) assert.throws(() => assertMaskArtifact(file, expected), /coverage/i);
  assert.throws(() => assertMaskArtifact(disconnected, expected), /connect|dominant/i);
  assert.throws(() => assertMaskArtifact(headMissing, expected), /head/i);
  assert.throws(() => assertMaskArtifact(leftFootMissing, expected), /left.*foot|foot.*left/i);
  assert.throws(() => assertMaskArtifact(rightFootMissing, expected), /right.*foot|foot.*right/i);
  assert.throws(() => assertMaskArtifact(canvasCropped, expected), /edge|canvas|bounds/i);
  assert.throws(() => assertMaskArtifact(speckZones, expected), /dominant.*(?:head|foot)|(?:head|foot).*dominant|meaningful/i);
  assert.throws(() => assertMaskArtifact(hazeZones, expected), /head|foot|opacity|meaningful/i);
  assert.throws(() => assertMaskArtifact(fullCanvasHaze, expected), /coverage|alpha mass|haze/i, "opaque silhouette over full-canvas gray127 haze must reject");
  assert.throws(() => assertMaskArtifact(outsideBoundsHaze, expected), /bounds|leak/i, "meaningful sub128 haze outside Task 2 bounds must reject");
  assert.doesNotThrow(() => assertMaskArtifact(softEdge, expected), "legitimate antialiased silhouette edge remains valid");

  const mismatchedMask = png(path.join(root, "mismatch-mask.png"), "lut=y=0,drawbox=x=420:y=110:w=100:h=440:color=white:t=fill");
  assert.throws(() => assertAlphaArtifact(validRgba, mismatchedMask, expected), /alpha.*mask|mismatch/i);
  assert.throws(() => assertAlphaArtifact(validMask, validMask, expected), /rgba|alpha|pixel/i);

  const preset = JSON.parse(readFileSync(presetPath, "utf8"));
  const workflow = compileWorkflow(preset, { INPUT_IMAGE: "uploaded.png", FILENAME_PREFIX: "shen_yan_matte/candidate_001/transparent" });
  assert.doesNotThrow(() => assertWorkflowObjectInfo(workflow, pinnedObjectInfo()));
  assert.doesNotThrow(() => assertMatteWorkflowTopology(workflow));
  assert.equal(workflow["2"].inputs.bg_removal_name, "birefnet.safetensors");
  assert.deepEqual(workflow["3"].inputs.bg_removal_model, ["2", 0]);
  assert.deepEqual(workflow["4"].inputs.mask, ["3", 0]);
  assert.deepEqual(workflow["5"].inputs.alpha, ["4", 0]);
  assert.equal(workflow["6"].class_type, "SaveImage");
  const directMask = structuredClone(workflow); directMask["5"].inputs.alpha = ["3", 0];
  assert.throws(() => assertMatteWorkflowTopology(directMask), /invert/i);
  const wrongSave = structuredClone(workflow); wrongSave["6"].inputs.images = ["1", 0];
  assert.throws(() => assertMatteWorkflowTopology(wrongSave), /SaveImage/i);
  const missingInvert = structuredClone(workflow); delete missingInvert["4"];
  assert.throws(() => assertMatteWorkflowTopology(missingInvert), /exactly one.*InvertMask/i);
  const semanticGood = renderFakeMatteWorkflow(workflow, validMask, path.join(root, "semantic-good.png"));
  assert.doesNotThrow(() => assertAlphaArtifact(semanticGood, validMask, expected));
  const semanticDirect = renderFakeMatteWorkflow(directMask, validMask, path.join(root, "semantic-direct.png"));
  assert.throws(() => assertAlphaArtifact(semanticDirect, validMask, expected), /alpha.*mask|mismatch/i, "direct foreground-mask link produces inverted PNG alpha under JoinImageWithAlpha semantics");
  const badInfo = pinnedObjectInfo(); badInfo.LoadBackgroundRemovalModel.input.required.bg_removal_name = [["other.safetensors"]];
  assert.throws(() => assertWorkflowObjectInfo(workflow, badInfo), /enum/i);

  const source = path.join(root, "accepted-source.png"); copyFileSync(validRgba, source);
  const accepted = createReportFixture(path.join(root, "accepted"), source);
  const adapter = fakeAdapter(source, validMask);
  const result = await extractMatte({ reportPath: accepted.reportPath, character: "shen_yan", candidate: 1, adapter, layout });
  assert.deepEqual(adapter.calls, ["objectInfo", "uploadImage", "queue", "capture"]);
  assert.equal(result.candidate.id, "candidate_001"); assert.equal(result.candidate.state, "technical"); assert.equal(result.candidate.creativeAcceptance, "pending");
  assert.equal(result.report.overallStatus, "pending");
  for (const key of ["rawMask", "revisedMask", "transparentPng"]) {
    const stored = result.candidate[key]; assert.equal(sha256File(stored.path), stored.sha256); assert.ok(stored.size > 0);
  }
  assert.notEqual(result.candidate.rawMask.path, result.candidate.revisedMask.path); assert.equal(result.candidate.rawMask.sha256, result.candidate.revisedMask.sha256);
  assertAlphaArtifact(result.candidate.transparentPng.path, result.candidate.revisedMask.path, expected);
  await assert.rejects(() => extractMatte({ reportPath: accepted.reportPath, character: "shen_yan", candidate: 1, adapter: fakeAdapter(source, validMask), layout }), /exists|queued|candidate/i);

  const jiangMask = maskFor(layout.people.jiang_lan, path.join(root, "jiang-valid-mask.png"));
  const jiangFixture = createReportFixture(path.join(root, "jiang"), source); const jiangAdapter = fakeAdapter(source, jiangMask);
  const jiang = await extractMatte({ reportPath: jiangFixture.reportPath, character: "jiang_lan", candidate: 1, adapter: jiangAdapter, layout });
  assert.equal(jiang.candidate.character, "jiang_lan"); assert.equal(jiang.candidate.technicalValidation.mask.width, 1152); assert.equal(jiang.candidate.technicalValidation.mask.height, 640);

  const unacceptedPath = path.join(root, "unaccepted", "report.json"); mkdirSync(path.dirname(unacceptedPath), { recursive: true }); writeJsonAtomic(unacceptedPath, accepted.technical);
  const unacceptedAdapter = fakeAdapter(source, validMask);
  await assert.rejects(() => extractMatte({ reportPath: unacceptedPath, character: "shen_yan", candidate: 1, adapter: unacceptedAdapter, layout }), /creative|accepted/i);
  assert.deepEqual(unacceptedAdapter.calls, [], "creative gate fails before object_info, upload, or queue");

  const mutationSource = path.join(root, "mutation-source.png"); copyFileSync(validRgba, mutationSource);
  const mutationFixture = createReportFixture(path.join(root, "mutation"), mutationSource);
  const mutationAdapter = fakeAdapter(mutationSource, validMask, { onObjectInfo: () => writeFileSync(mutationSource, "mutated after initial validation") });
  await assert.rejects(() => extractMatte({ reportPath: mutationFixture.reportPath, character: "shen_yan", candidate: 1, adapter: mutationAdapter, layout }), /artifact (?:size|hash) mismatch|accepted character.*hash|frozen hash/i);
  assert.deepEqual(mutationAdapter.calls, ["objectInfo"], "post-object-info source mutation fails before upload and queue");

  const recoveryFixture = createReportFixture(path.join(root, "recovery"), source); const recoveryAdapter = fakeAdapter(source, validMask);
  let markerWasFirst = false;
  await assert.rejects(() => extractMatte({ reportPath: recoveryFixture.reportPath, character: "shen_yan", candidate: 1, adapter: recoveryAdapter, layout, afterQueuedMarker: ({ markerPath }) => { markerWasFirst = JSON.parse(readFileSync(markerPath, "utf8")).promptId === "matte-prompt-1"; throw new Error("injected post-prompt boundary failure"); } }), /injected post-prompt/i);
  assert.equal(markerWasFirst, true, "prompt marker is durable before later post-prompt work");
  const recoveryMarker = path.join(path.dirname(recoveryFixture.reportPath), "shen_yan_matte", ".candidate_001.queued");
  assert.deepEqual(JSON.parse(readFileSync(recoveryMarker, "utf8")), { promptId: "matte-prompt-1", queuedAt: 1234 });
  const recoveryAttempts = path.join(path.dirname(recoveryFixture.reportPath), "shen_yan_matte", "attempts", "candidate_001");
  const recoveryJournal = JSON.parse(readFileSync(path.join(recoveryAttempts, readdirSync(recoveryAttempts)[0], "attempt.json"), "utf8"));
  assert.equal(recoveryJournal.status, "failed-postqueue"); assert.equal(recoveryJournal.promptId, "matte-prompt-1");
  const retryAdapter = fakeAdapter(source, validMask);
  await assert.rejects(() => extractMatte({ reportPath: recoveryFixture.reportPath, character: "shen_yan", candidate: 1, adapter: retryAdapter, layout }), /queued|not reusable|burned/i);
  assert.equal(retryAdapter.calls.includes("queue"), false, "burned candidate rejects before a second prompt");

  const orphanFixture = createReportFixture(path.join(root, "orphan-recovery"), source); const orphanAdapter = fakeAdapter(source, validMask, { throwPromptIdWithoutCallback: true });
  await assert.rejects(() => extractMatte({ reportPath: orphanFixture.reportPath, character: "shen_yan", candidate: 1, adapter: orphanAdapter, layout }), /transport failed after prompt/i);
  const orphanMarker = path.join(path.dirname(orphanFixture.reportPath), "shen_yan_matte", ".candidate_001.queued");
  assert.equal(JSON.parse(readFileSync(orphanMarker, "utf8")).promptId, "orphan-prompt-2", "error.promptId burns and records the candidate even without onQueued callback");

  const presetFixturePath = path.join(root, "frozen-preset.json"); copyFileSync(presetPath, presetFixturePath);
  const frozenBytes = readFileSync(presetFixturePath); const frozenHash = createHash("sha256").update(frozenBytes).digest("hex");
  const freezeFixture = createReportFixture(path.join(root, "preset-freeze"), source); const freezeAdapter = fakeAdapter(source, validMask);
  const frozenResult = await extractMatte({ reportPath: freezeFixture.reportPath, character: "shen_yan", candidate: 1, adapter: freezeAdapter, layout, presetPath: presetFixturePath, afterQueuedMarker: () => writeFileSync(presetFixturePath, "{}") });
  const queuedWorkflowHash = createHash("sha256").update(`${JSON.stringify(freezeAdapter.queuedWorkflow)}\n`).digest("hex");
  assert.equal(frozenResult.candidate.presetSha256, frozenHash); assert.equal(frozenResult.candidate.workflowSha256, queuedWorkflowHash);

  const runner = path.resolve("scripts/run-layered-matte.mjs");
  for (const args of [
    ["--character", "unknown", "--candidate", "1", "--report", accepted.reportPath],
    ["--character", "shen_yan", "--candidate", "0", "--report", accepted.reportPath],
    ["--character", "shen_yan", "--candidate", "01", "--report", accepted.reportPath],
    ["--character", "shen_yan", "--candidate", "1.0", "--report", accepted.reportPath],
    ["--character", "shen_yan", "--candidate", "1"],
    ["--character", "shen_yan", "--candidate", "1", "--report", accepted.reportPath, "--seed", "9"],
    ["--character", "shen_yan", "--character", "jiang_lan", "--candidate", "1", "--report", accepted.reportPath],
  ]) assert.throws(() => run(process.execPath, [runner, ...args]), /usage|candidate|character|unknown|duplicate/i);
  await import(`${pathToFileURL(runner).href}?import-check=1`);

  console.log("Layered compositing matte contract: PASS");
} finally {
  rmSync(root, { recursive: true, force: true });
}
