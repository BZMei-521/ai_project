import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createExperimentReport } from "./lib/wan-flf2v-experiment.mjs";

const root = resolve(import.meta.dirname, "..");
const runnerPath = resolve(root, "scripts/run-wan-flf2v-endpoint.mjs");
const dwposePath = resolve(root, "src/modules/comfy-pipeline/presets/dwpose-half-step-extract-v1.json");
const qwenPath = resolve(root, "src/modules/comfy-pipeline/presets/image-qwen-half-step-pose-endpoint-v2.json");
const contractPath = resolve(root, "src/modules/comfy-pipeline/presets/wan-flf2v-river-shot-contract-v1.json");
const poseRunnerPath = resolve(root, "scripts/run-wan-flf2v-pose-endpoint.mjs");
const poseInitializerPath = resolve(root, "scripts/init-wan-flf2v-pose-experiment.mjs");

assert.ok(existsSync(dwposePath), "DWPose extraction preset must exist");
assert.ok(existsSync(qwenPath), "pose-guided Qwen preset must exist");
assert.ok(existsSync(contractPath), "river shot contract must exist");
assert.ok(existsSync(poseRunnerPath), "pose endpoint wrapper must exist");
assert.ok(existsSync(poseInitializerPath), "pose experiment initializer must exist");

const endpoint = await import(`${pathToFileURL(runnerPath).href}?pose-contract=${Date.now()}`);
const poseRunner = await import(`${pathToFileURL(poseRunnerPath).href}?pose-wrapper=${Date.now()}`);
for (const name of ["compileDWPoseWorkflow", "validateDWPoseObjectInfo", "validatePoseEndpointPresetObjectInfo", "compileRiverShotPrompt", "normalizeDWPoseHistoryJson"]) {
  assert.equal(typeof endpoint[name], "function", `${name} must be exported`);
}

const livePoseFixture = { canvas_width: 1152, canvas_height: 640, people: [] };
assert.deepEqual(endpoint.normalizeDWPoseHistoryJson(livePoseFixture), livePoseFixture);
assert.deepEqual(endpoint.normalizeDWPoseHistoryJson(JSON.stringify(livePoseFixture)), livePoseFixture);
assert.deepEqual(endpoint.normalizeDWPoseHistoryJson([JSON.stringify(livePoseFixture)]), livePoseFixture);
assert.deepEqual(endpoint.normalizeDWPoseHistoryJson([JSON.stringify([livePoseFixture])]), livePoseFixture);
assert.throws(() => endpoint.normalizeDWPoseHistoryJson([]), /openpose_json/i);
assert.throws(() => endpoint.normalizeDWPoseHistoryJson(["{}", "{}"]), /openpose_json/i);
assert.throws(() => endpoint.normalizeDWPoseHistoryJson(JSON.stringify([livePoseFixture, livePoseFixture])), /openpose_json/i);
assert.throws(() => endpoint.normalizeDWPoseHistoryJson("not-json"), /openpose_json/i);

const dwpose = JSON.parse(readFileSync(dwposePath, "utf8"));
const qwen = JSON.parse(readFileSync(qwenPath, "utf8"));
const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const node = (required, optional = {}, output = []) => ({ input: { required, optional }, output });
function objectInfoFixture() {
  return {
    LoadImage: node({ image: [["input.png"]] }, {}, ["IMAGE", "MASK"]),
    DWPreprocessor: node({ image: ["IMAGE"] }, {
      detect_hand: [["enable", "disable"]], detect_body: [["enable", "disable"]], detect_face: [["enable", "disable"]],
      resolution: ["INT", { min: 64, max: 2048 }], bbox_detector: [["yolox_l.torchscript.pt"]],
      pose_estimator: [["dw-ll_ucoco_384_bs5.torchscript.pt"]], scale_stick_for_xinsr_cn: [["enable", "disable"]]
    }, ["IMAGE", "POSE_KEYPOINT"]),
    SaveImage: node({ images: ["IMAGE"], filename_prefix: ["STRING"] }, {}, ["IMAGE"]),
    UNETLoader: node({ unet_name: [["qwen_image_edit_2511_fp8mixed.safetensors"]], weight_dtype: [["default"]] }, {}, ["MODEL"]),
    LoraLoaderModelOnly: node({ model: ["MODEL"], lora_name: [["Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"]], strength_model: ["FLOAT"] }, {}, ["MODEL"]),
    ModelSamplingAuraFlow: node({ model: ["MODEL"], shift: ["FLOAT"] }, {}, ["MODEL"]),
    CLIPLoader: node({ clip_name: [["qwen_2.5_vl_7b_fp8_scaled.safetensors"]], type: [["qwen_image"]] }, { device: [["default"]] }, ["CLIP"]),
    VAELoader: node({ vae_name: [["qwen_image_vae.safetensors"]] }, {}, ["VAE"]),
    TextEncodeQwenImageEditPlus: node({ clip: ["CLIP"], prompt: ["STRING"] }, { vae: ["VAE"], image1: ["IMAGE"], image2: ["IMAGE"], image3: ["IMAGE"] }, ["CONDITIONING"]),
    ConditioningZeroOut: node({ conditioning: ["CONDITIONING"] }, {}, ["CONDITIONING"]),
    VAEEncode: node({ pixels: ["IMAGE"], vae: ["VAE"] }, {}, ["LATENT"]),
    KSampler: node({ model: ["MODEL"], positive: ["CONDITIONING"], negative: ["CONDITIONING"], latent_image: ["LATENT"], seed: ["INT"], steps: ["INT"], cfg: ["FLOAT"], sampler_name: [["euler"]], scheduler: [["beta"]], denoise: ["FLOAT"] }, {}, ["LATENT"]),
    VAEDecode: node({ samples: ["LATENT"], vae: ["VAE"] }, {}, ["IMAGE"])
  };
}

assert.deepEqual(Object.values(dwpose).map((item) => item.class_type), ["LoadImage", "DWPreprocessor", "SaveImage"]);
assert.deepEqual(dwpose["2"].inputs, {
  image: ["1", 0], detect_hand: "disable", detect_body: "enable", detect_face: "disable", resolution: 640,
  bbox_detector: "yolox_l.torchscript.pt", pose_estimator: "dw-ll_ucoco_384_bs5.torchscript.pt", scale_stick_for_xinsr_cn: "disable"
});
assert.deepEqual(dwpose["3"].inputs.images, ["2", 0]);
endpoint.validateDWPoseObjectInfo(dwpose, objectInfoFixture());
for (const input of ["image", "detect_hand", "detect_body", "detect_face", "resolution", "bbox_detector", "pose_estimator", "scale_stick_for_xinsr_cn"]) {
  const fixture = objectInfoFixture();
  delete fixture.DWPreprocessor.input.required[input];
  delete fixture.DWPreprocessor.input.optional[input];
  assert.throws(() => endpoint.validateDWPoseObjectInfo(dwpose, fixture), new RegExp(input, "i"));
}

const qwenNodes = Object.values(qwen);
const byClass = (type) => qwenNodes.filter((item) => item.class_type === type);
assert.equal(byClass("UNETLoader")[0].inputs.unet_name, "qwen_image_edit_2511_fp8mixed.safetensors");
assert.equal(byClass("LoraLoaderModelOnly")[0].inputs.lora_name, "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors");
assert.equal(byClass("CLIPLoader")[0].inputs.clip_name, "qwen_2.5_vl_7b_fp8_scaled.safetensors");
assert.equal(byClass("VAELoader")[0].inputs.vae_name, "qwen_image_vae.safetensors");
assert.deepEqual(byClass("LoadImage").map((item) => item.inputs.image).sort(), ["{{POSE_GUIDE_PATH}}", "{{SHEN_YAN_PRIMARY_PATH}}", "{{START_FRAME_PATH}}"].sort());
const qwenPrompt = byClass("TextEncodeQwenImageEditPlus")[0].inputs.prompt;
for (const phrase of [
  "Picture 3 is the authoritative target body-pose guide", "Exactly two human characters", "one short grounded half-step",
  "Jiang Lan must remain unchanged", "Do not create a lunge, split, crossed legs, floating foot, or extra limb"
]) assert.ok(qwenPrompt.includes(phrase), `Qwen pose prompt must contain: ${phrase}`);
const sampler = byClass("KSampler")[0].inputs;
assert.deepEqual({ steps: sampler.steps, cfg: sampler.cfg, sampler: sampler.sampler_name, scheduler: sampler.scheduler }, { steps: 4, cfg: 1, sampler: "euler", scheduler: "beta" });
endpoint.validatePoseEndpointPresetObjectInfo(qwen, objectInfoFixture());

assert.deepEqual(Object.keys(contract.blocks).sort(), ["identity", "lighting", "performance", "spatialLayout", "style"]);
for (const [name, block] of Object.entries(contract.blocks)) {
  const expected = createHash("sha256").update(JSON.stringify({ name, text: block.text })).digest("hex");
  assert.equal(block.sha256, expected, `${name} block hash must be canonical`);
}
assert.deepEqual(Object.keys(contract.references).sort(), ["poseGuide", "shenYanPrimary", "startFrame"]);
assert.equal(new Set(Object.values(contract.references).map((item) => item.role)).size, 3, "every reference has one distinct role");
const contractText = JSON.stringify(contract);
for (const phrase of ["stone bridge", "riverside path", "waterline", "Shen Yan remains screen-left", "Jiang Lan remains screen-right", "180-degree axis", "cinematic 3D donghua", "low grounded center of gravity"]) {
  assert.ok(contractText.includes(phrase), `river contract must contain ${phrase}`);
}
assert.equal(/Higgsfield|Soul ID|@HERO/i.test(contractText), false, "local contract must not depend on Higgsfield cloud handles");
const actionSentences = contract.sections.action.text.split(/[.!?]+/).map((item) => item.trim()).filter(Boolean);
assert.ok(actionSentences.length <= 3, "single action must contain at most three sentences");
assert.equal(contract.sections.action.primaryAction, "Shen Yan takes one short grounded half-step");

const compiledPrompt = endpoint.compileRiverShotPrompt(contract);
for (const header of contract.compileOrder) assert.ok(compiledPrompt.includes(`${header}\n`), `compiled prompt must include ${header}`);
const commonTokens = { START_FRAME_PATH: "start.png", SHEN_YAN_PRIMARY_PATH: "shen.png", POSE_GUIDE_PATH: "pose.png", CANDIDATE_PADDED: "001", RIVER_SHOT_PROMPT: compiledPrompt };
const workflow1 = endpoint.compileDWPoseWorkflow(qwen, { ...commonTokens, SEED: 271011 });
const workflow2 = endpoint.compileDWPoseWorkflow(qwen, { ...commonTokens, SEED: 272011 });
assert.equal(workflow1["16"].inputs.seed, 271011);
assert.equal(workflow2["16"].inputs.seed, 272011);
workflow2["16"].inputs.seed = workflow1["16"].inputs.seed;
assert.deepEqual(workflow2, workflow1, "pose candidates may differ only by seed");
assert.throws(() => endpoint.compileDWPoseWorkflow(dwpose, {}), /unresolved/i);

assert.deepEqual(poseRunner.parsePoseEndpointArguments(["--candidate", "2"]), { candidate: 2 });
for (const args of [[], ["--candidate", "0"], ["--candidate", "4"], ["--candidate", "all"], ["--candidate", "1", "--all"], ["--candidate", "1", "--candidate", "2"]]) {
  assert.throws(() => poseRunner.parsePoseEndpointArguments(args), /usage|candidate/i);
}

function hashBytes(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function makeSolid(path, color) {
  const result = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=1152x640:d=1`, "-frames:v", "1", path], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}
function posePerson(pelvisX, firstAnkleX, secondAnkleX) {
  const points = Array.from({ length: 18 }, (_, index) => [pelvisX, 80 + index * 20, 1]);
  points[9] = [pelvisX - 20, 360, 1]; points[10] = [pelvisX - 25, 455, 1]; points[11] = [firstAnkleX, 565, 1];
  points[12] = [pelvisX + 20, 360, 1]; points[13] = [pelvisX + 25, 455, 1]; points[14] = [secondAnkleX, 565, 1];
  return { pose_keypoints_2d: points.flat() };
}
const goodPose = { canvas_width: 1152, canvas_height: 640, people: [posePerson(390, 340, 430), posePerson(735, 700, 770)] };

const temp = mkdtempSync(join(tmpdir(), "wan-pose-endpoint-e2e-"));
try {
  const authoritativePath = join(temp, "authority", "one-take.json");
  const startPath = join(temp, "start.png");
  const referencePath = join(temp, "shen.png");
  mkdirSync(join(temp, "authority"), { recursive: true });
  const authoritativeBytes = Buffer.from('{"authority":true}\n');
  writeFileSync(authoritativePath, authoritativeBytes);
  makeSolid(startPath, "0x304050"); makeSolid(referencePath, "0x506070");

  function createReport(name) {
    const experimentRoot = join(temp, name);
    const reportPath = join(experimentRoot, "wan-flf2v-report.json");
    mkdirSync(experimentRoot, { recursive: true });
    const report = createExperimentReport({ experimentRoot, authoritativeReportPath: authoritativePath, authoritativeReportSha256: hashBytes(authoritativeBytes), startFramePath: startPath, startFrameSha256: hashBytes(readFileSync(startPath)) });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return { experimentRoot, reportPath };
  }

  function adapter(pose, calls) {
    return {
      async fetchObjectInfo() { calls.push("object_info"); return objectInfoFixture(); },
      async uploadImage({ role }) { calls.push(`upload:${role}`); return `${role}.png`; },
      async extractDWPose({ poseImagePath }) { calls.push("dwpose"); copyFileSync(startPath, poseImagePath); return { promptId: "dwpose-prompt-1", openposeJson: pose }; },
      async generateRawEdit({ outputPath }) { calls.push("qwen"); copyFileSync(startPath, outputPath); return { promptId: "qwen-prompt-1" }; }
    };
  }

  const successful = createReport("successful");
  const calls = [];
  const oldAuthorityHash = hashBytes(readFileSync(authoritativePath));
  const run = await endpoint.runEndpointCandidate({ candidate: 1, reportPath: successful.reportPath, experimentRoot: successful.experimentRoot, shenYanPrimaryPath: referencePath, poseGuided: true }, adapter(goodPose, calls));
  assert.deepEqual(calls, ["object_info", "upload:start", "dwpose", "upload:shen_yan_primary", "upload:pose_guide", "qwen"]);
  assert.equal(hashBytes(readFileSync(authoritativePath)), oldAuthorityHash, "authoritative report bytes stay unchanged");
  const candidate = run.candidate;
  assert.equal(candidate.poseGuided, true);
  assert.equal(candidate.dwposePromptId, "dwpose-prompt-1");
  assert.equal(candidate.qwenPromptId, "qwen-prompt-1");
  assert.deepEqual(Object.keys(candidate.promptBlockHashes).sort(), ["identity", "lighting", "performance", "spatialLayout", "style"]);
  assert.match(candidate.compiledPromptSha256, /^[a-f0-9]{64}$/);
  for (const key of ["sourcePosePath", "targetPosePath", "poseGuidePath", "poseDiagnosticPath", "rawEditPath", "maskPath", "lockedRegionMaskPath", "compositePath", "evidencePath"]) assert.ok(existsSync(candidate[key]), `${key} exists`);
  for (const key of ["sourcePoseSha256", "targetPoseSha256", "poseGuideSha256", "poseDiagnosticSha256"]) assert.match(candidate[key], /^[a-f0-9]{64}$/);

  const rejectedPreflight = createReport("rejected-preflight");
  const badCalls = [];
  await assert.rejects(
    endpoint.runEndpointCandidate({ candidate: 1, reportPath: rejectedPreflight.reportPath, experimentRoot: rejectedPreflight.experimentRoot, shenYanPrimaryPath: referencePath, poseGuided: true }, adapter({ ...goodPose, people: goodPose.people.slice(0, 1) }, badCalls)),
    /exactly two/i
  );
  assert.equal(badCalls.includes("qwen"), false, "failed DWPose preflight must not call Qwen");
  assert.equal(JSON.parse(readFileSync(rejectedPreflight.reportPath, "utf8")).endpointCandidates.length, 0);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

console.log("Wan FLF2V pose endpoint contract: PASS");
