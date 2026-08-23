import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  appendCandidate,
  assertRunInvariant,
  createRunReport,
  reviewCandidate,
  sha256File,
} from "./lib/layered-compositing-run.mjs";

const fixtureDir = mkdtempSync(path.join(tmpdir(), "layered-compositing-run-"));
const MOTHER_FRAME = "C:/Users/Administrator/AppData/Local/Comfy-Desktop/ComfyUI-Shared/output/Storyboard/河边远景建立_klein_ref_00006_.png";
const VALID_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+5yJ+mwAAAABJRU5ErkJggg==", "base64");

function isDecodableImage(filePath) {
  try {
    const output = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type,width,height", "-of", "default=noprint_wrappers=1", filePath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return /codec_type=video/.test(output) && /width=[1-9]/.test(output) && /height=[1-9]/.test(output);
  } catch {
    return false;
  }
}

try {
  const writeFixture = (name, contents) => {
    const filePath = path.join(fixtureDir, name);
    writeFileSync(filePath, contents);
    return {
      path: filePath,
      size: Buffer.byteLength(contents),
      sha256: sha256File(filePath),
    };
  };

  const source = writeFixture("mother-frame.png", "mother-frame");
  const shenFace = writeFixture("shen-face.png", "shen-face");
  const shenBody = writeFixture("shen-body.png", "shen-body");
  const jiangFace = writeFixture("jiang-face.png", "jiang-face");
  const jiangBody = writeFixture("jiang-body.png", "jiang-body");
  const artifact = writeFixture("candidate.png", "candidate-artifact");
  const validImage = writeFixture("valid-candidate.png", VALID_PNG);
  const corruptImage = writeFixture("corrupt-candidate.png", "not an image");
  const io = { isDecodable: (filePath) => filePath.endsWith(".png") };

  const input = {
    source: { ...source, width: 1152, height: 640 },
    characters: {
      shen_yan: { name: "Shen Yan", species: "human", faceMaster: shenFace, bodyFront: shenBody },
      jiang_lan: { name: "Jiang Lan", species: "human", faceMaster: jiangFace, bodyFront: jiangBody },
    },
    lighting: {
      key: "warm sunset from screen-right/rear",
      fill: "soft fill from screen-left/front",
      shadow: "screen-left/front",
    },
  };

  const report = createRunReport(input);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.overallStatus, "pending");
  assert.equal(report.source.path, path.resolve(source.path));
  assertRunInvariant(report, io);

  const reviewFindings = [];
  const expectReviewFailure = (label, action) => {
    try {
      action();
      reviewFindings.push(label);
    } catch {
      // The pre-fix checker intentionally records every correctly failing new assertion.
    }
  };
  const initializerSource = readFileSync(new URL("./init-layered-compositing-sample.mjs", import.meta.url), "utf8");
  if (!initializerSource.includes(`const MOTHER_FRAME = "${MOTHER_FRAME}";`) || !existsSync(MOTHER_FRAME)) reviewFindings.push("initializer must contain the exact existing UTF-8 mother-frame literal");
  const initializerPath = path.resolve(new URL("./init-layered-compositing-sample.mjs", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)));
  const absentParent = path.join(fixtureDir, "initializer-parent-absent");
  const nestedOutput = path.join(absentParent, "nested-run");
  execFileSync(process.execPath, [initializerPath, "--output", nestedOutput], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const initializedReportPath = path.join(nestedOutput, "run-report.json");
  assert.equal(existsSync(initializedReportPath), true, "initializer must create a nested target when its parent is absent");
  const initializedReport = JSON.parse(readFileSync(initializedReportPath, "utf8"));
  assertRunInvariant(initializedReport);
  assert.deepEqual(Object.fromEntries(Object.entries(initializedReport.stages).map(([stage, value]) => [stage, value.candidates.length])), { empty_plate: 0, shen_yan: 0, jiang_lan: 0, shen_yan_matte: 0, jiang_lan_matte: 0, composite: 0, final: 0 });
  assert.deepEqual(readdirSync(absentParent), ["nested-run"], "recursive creation must create only the explicitly requested target ancestry");
  const initializedBytes = readFileSync(initializedReportPath);
  assert.throws(() => execFileSync(process.execPath, [initializerPath, "--output", nestedOutput], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), /status|initializer/i, "initializer must refuse an existing target");
  assert.deepEqual(readFileSync(initializedReportPath), initializedBytes, "existing target/report bytes must not be overwritten");
  const raceOutput = path.join(fixtureDir, "initializer-race-parent", "nested-run");
  const raceReportPath = path.join(raceOutput, "run-report.json");
  const raceReportBytes = Buffer.from("concurrent creator owns these exact report bytes\n");
  const raceHookPath = path.join(fixtureDir, "initializer-race-hook.mjs");
  writeFileSync(raceHookPath, `import fs from "node:fs";\nimport path from "node:path";\nimport { syncBuiltinESMExports } from "node:module";\nconst target = path.resolve(process.env.LAYERED_INITIALIZER_RACE_TARGET);\nconst originalMkdirSync = fs.mkdirSync;\nlet injected = false;\nfs.mkdirSync = (candidate, options) => {\n  if (!injected && path.resolve(candidate) === target) {\n    injected = true;\n    originalMkdirSync(target, { recursive: true });\n    fs.writeFileSync(path.join(target, "run-report.json"), Buffer.from(process.env.LAYERED_INITIALIZER_RACE_REPORT, "base64"));\n  }\n  return originalMkdirSync(candidate, options);\n};\nsyncBuiltinESMExports();\n`);
  let raceChildError = null;
  try {
    execFileSync(process.execPath, ["--import", pathToFileURL(raceHookPath).href, initializerPath, "--output", raceOutput], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LAYERED_INITIALIZER_RACE_TARGET: raceOutput, LAYERED_INITIALIZER_RACE_REPORT: raceReportBytes.toString("base64") },
    });
  } catch (error) { raceChildError = error; }
  assert.equal(existsSync(raceReportPath), true, `race hook must install the concurrent creator fixture: ${String(raceChildError?.stderr ?? raceChildError?.message ?? "child succeeded")}`);
  assert.match(String(raceChildError?.stderr ?? raceChildError?.message ?? ""), /EEXIST|exists|initializer/i, "initializer must atomically refuse a target created after its initial existence check");
  assert.deepEqual(readFileSync(raceReportPath), raceReportBytes, "concurrent creator report bytes must not be replaced");
  expectReviewFailure("wrong lighting must be rejected", () => createRunReport({ ...input, lighting: { ...input.lighting, key: "different" } }));
  expectReviewFailure("extra character keys must be rejected", () => createRunReport({ ...input, characters: { ...input.characters, extra: input.characters.shen_yan } }));
  const forgedAccepted = appendCandidate(report, "empty_plate", { id: "forged_accepted", artifact });
  forgedAccepted.stages.empty_plate.candidates[0].state = "accepted";
  forgedAccepted.stages.empty_plate.candidates[0].creativeAcceptance = "accepted";
  expectReviewFailure("persisted accepted candidate without review evidence must be rejected", () => assertRunInvariant(forgedAccepted));
  const forgedOverall = structuredClone(report);
  forgedOverall.overallStatus = "accepted";
  expectReviewFailure("overall status must remain pending before the later final-review API", () => assertRunInvariant(forgedOverall));
  const corruptReport = appendCandidate(report, "empty_plate", { id: "corrupt_001", artifact: corruptImage });
  expectReviewFailure("accepted review without a decoder must fail closed", () => reviewCandidate(corruptReport, "empty_plate", "corrupt_001", { decision: "accepted", evidence: corruptImage, note: "looks fine" }));
  expectReviewFailure("corrupt image evidence must be rejected by a real decoder", () => reviewCandidate(corruptReport, "empty_plate", "corrupt_001", { decision: "accepted", evidence: corruptImage, note: "looks fine" }, { isDecodable: isDecodableImage }));
  const validReport = appendCandidate(report, "empty_plate", { id: "valid_001", artifact: validImage });
  const persistedAccepted = reviewCandidate(validReport, "empty_plate", "valid_001", { decision: "accepted", evidence: validImage, note: "looks fine" }, { isDecodable: isDecodableImage });
  writeFileSync(validImage.path, VALID_PNG.subarray(0, VALID_PNG.length - 1));
  expectReviewFailure("accepted persisted evidence must be hash-revalidated", () => assertRunInvariant(persistedAccepted, { isDecodable: isDecodableImage }));
  unlinkSync(validImage.path);
  expectReviewFailure("deleted accepted persisted evidence must be rejected", () => assertRunInvariant(persistedAccepted, { isDecodable: isDecodableImage }));
  if (reviewFindings.length > 0) throw new Error(`Review regression(s) unexpectedly passed: ${reviewFindings.join("; ")}`);

  assert.throws(
    () => createRunReport({ ...input, source: { ...input.source, width: 1151 } }),
    /1152.*640/i,
  );
  assert.throws(
    () => createRunReport({ ...input, characters: { ...input.characters, shen_yan: { ...input.characters.shen_yan, faceMaster: null } } }),
    /face.*resource/i,
  );
  assert.throws(
    () => createRunReport({ ...input, characters: { ...input.characters, jiang_lan: { ...input.characters.jiang_lan, bodyFront: null } } }),
    /body.*resource/i,
  );
  assert.throws(() => appendCandidate(report, "shen_yan", { id: "candidate_001" }), /artifact/i);

  const withCandidate = appendCandidate(report, "shen_yan", { id: "candidate_001", artifact });
  assert.equal(report.stages.shen_yan.candidates.length, 0, "append must not mutate the prior report");
  assert.equal(withCandidate.stages.shen_yan.candidates[0].state, "technical");
  assert.equal(withCandidate.overallStatus, "pending");
  assert.throws(
    () => appendCandidate(withCandidate, "shen_yan", { id: "candidate_001", artifact }),
    /already exists/i,
  );
  assert.throws(
    () => appendCandidate(withCandidate, "shen_yan", { id: "candidate_001", artifact: { ...artifact, path: source.path } }),
    /already exists/i,
  );
  assert.throws(
    () => reviewCandidate(withCandidate, "shen_yan", "candidate_001", { decision: "accepted", evidence: { ...artifact, sha256: "0".repeat(64) }, note: "identity matches" }, io),
    /hash/i,
  );
  const accepted = reviewCandidate(withCandidate, "shen_yan", "candidate_001", { decision: "accepted", evidence: artifact, note: "identity matches" }, io);
  assert.equal(accepted.stages.shen_yan.candidates[0].state, "accepted");
  assert.equal(accepted.overallStatus, "pending");

  const technicallyComplete = appendCandidate(accepted, "jiang_lan", { id: "candidate_001", artifact });
  assert.equal(technicallyComplete.overallStatus, "pending");
  assert.equal(technicallyComplete.stages.jiang_lan.candidates[0].state, "technical");

  const artifactRemoved = appendCandidate(report, "jiang_lan", { id: "candidate_002", artifact });
  unlinkSync(artifact.path);
  const rejected = reviewCandidate(artifactRemoved, "jiang_lan", "candidate_002", { decision: "rejected", note: "visible edge halo" }, io);
  assert.equal(rejected.stages.jiang_lan.candidates[0].state, "rejected");
  assert.equal(rejected.overallStatus, "pending");
  assert.throws(
    () => reviewCandidate(artifactRemoved, "jiang_lan", "candidate_002", { decision: "accepted", evidence: artifact, note: "identity matches" }, io),
    /evidence|artifact/i,
  );

  console.log("Layered compositing run contract: PASS");
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}
