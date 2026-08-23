import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ENDPOINT_SEEDS,
  createExperimentReport
} from "./lib/wan-flf2v-experiment.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runnerPath = resolve(root, "scripts/run-wan-flf2v-endpoint.mjs");
const presetPath = resolve(root, "src/modules/comfy-pipeline/presets/image-qwen-half-step-endpoint-v1.json");
const expectedPrompt = "Picture 1 is the immutable main frame. Picture 2 is only Shen Yan's identity and costume reference. Picture 3 is a black-and-white editable-region guide: white marks the only region that may change and black marks locked pixels. Edit only the guided lower body of Shen Yan. Move his screen-left boot one short grounded half-step diagonally up-left along the riverside path toward the bridge. Show a slight knee bend and a small pelvis weight transfer; keep the screen-right boot planted. Preserve his exact coat construction, trousers, boots, body proportions, face and upper body. Jiang Lan and every locked scene region must remain unchanged.";

assert.ok(existsSync(runnerPath), "endpoint runner must exist");
assert.ok(existsSync(presetPath), "endpoint preset must exist");

const endpoint = await import(`${pathToFileURL(runnerPath).href}?contract=${Date.now()}`);
const preset = JSON.parse(readFileSync(presetPath, "utf8"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function makeSolid(path, color, size = "1152x640") {
  run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=${size}:d=1`, "-frames:v", "1", path]);
}

function rawRgb(path) {
  const result = run("ffmpeg", ["-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { encoding: null });
  return result.stdout;
}

function probe(path) {
  return JSON.parse(run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,pix_fmt", "-of", "json", path]).stdout).streams[0];
}

function oraclePointInPolygon(x, y, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const [currentX, currentY] = polygon[current];
    const [previousX, previousY] = polygon[previous];
    if ((currentY > y) !== (previousY > y) && x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX) inside = !inside;
  }
  return inside;
}

function createIndependentMaskOracle(outputDir) {
  const polygons = [
    [[420, 250], [515, 250], [530, 420], [405, 420]],
    [[375, 400], [565, 400], [570, 625], [370, 625]]
  ];
  const width = 1152;
  const height = 640;
  const raster = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      raster[y * width + x] = polygons.some((polygon) => oraclePointInPolygon(x + 0.5, y + 0.5, polygon)) ? 255 : 0;
    }
  }
  mkdirSync(outputDir, { recursive: true });
  const pgmPath = join(outputDir, "oracle-union.pgm");
  const oraclePath = join(outputDir, "oracle-mask.png");
  writeFileSync(pgmPath, Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`, "ascii"), raster]));
  run("ffmpeg", ["-y", "-v", "error", "-i", pgmPath, "-vf", "boxblur=12:1,format=rgb24", "-frames:v", "1", "-pix_fmt", "rgb24", oraclePath]);
  return { oraclePath, raster };
}

function objectInfoFixture() {
  const node = (required, optional = {}, output = []) => ({ input: { required, optional }, output });
  return {
    UNETLoader: node({ unet_name: [["qwen_image_edit_2511_fp8mixed.safetensors"]], weight_dtype: [["default"]] }, {}, ["MODEL"]),
    LoraLoaderModelOnly: node({ model: ["MODEL"], lora_name: [["Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"]], strength_model: ["FLOAT"] }, {}, ["MODEL"]),
    ModelSamplingAuraFlow: node({ model: ["MODEL"], shift: ["FLOAT"] }, {}, ["MODEL"]),
    CLIPLoader: node({ clip_name: [["qwen_2.5_vl_7b_fp8_scaled.safetensors"]], type: [["qwen_image"]] }, { device: [["default"]] }, ["CLIP"]),
    VAELoader: node({ vae_name: [["qwen_image_vae.safetensors"]] }, {}, ["VAE"]),
    LoadImage: node({ image: [["input.png"]] }, {}, ["IMAGE", "MASK"]),
    TextEncodeQwenImageEditPlus: node({ clip: ["CLIP"], prompt: ["STRING"] }, { vae: ["VAE"], image1: ["IMAGE"], image2: ["IMAGE"], image3: ["IMAGE"] }, ["CONDITIONING"]),
    ConditioningZeroOut: node({ conditioning: ["CONDITIONING"] }, {}, ["CONDITIONING"]),
    VAEEncode: node({ pixels: ["IMAGE"], vae: ["VAE"] }, {}, ["LATENT"]),
    KSampler: node({ model: ["MODEL"], positive: ["CONDITIONING"], negative: ["CONDITIONING"], latent_image: ["LATENT"], seed: ["INT"], steps: ["INT"], cfg: ["FLOAT"], sampler_name: [["euler"]], scheduler: [["beta"]], denoise: ["FLOAT"] }, {}, ["LATENT"]),
    VAEDecode: node({ samples: ["LATENT"], vae: ["VAE"] }, {}, ["IMAGE"]),
    SaveImage: node({ images: ["IMAGE"], filename_prefix: ["STRING"] }, {}, ["IMAGE"])
  };
}

// Preset: exactly one main frame, one Shen Yan identity reference, and one supplied mask.
const nodes = Object.entries(preset);
const byClass = (classType) => nodes.filter(([, node]) => node.class_type === classType);
assert.equal(byClass("UNETLoader")[0][1].inputs.unet_name, "qwen_image_edit_2511_fp8mixed.safetensors");
assert.equal(byClass("LoraLoaderModelOnly")[0][1].inputs.lora_name, "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors");
assert.deepEqual(byClass("LoadImage").map(([, node]) => node.inputs.image).sort(), ["{{LOWER_BODY_MASK_PATH}}", "{{SHEN_YAN_PRIMARY_PATH}}", "{{START_FRAME_PATH}}"].sort());
assert.equal(JSON.stringify(preset).includes("SCENE_REF"), false, "full-scene replacement references are forbidden");
assert.equal(byClass("QwenEditAdaptiveLongestEdge").length, 0);
assert.equal(byClass("QwenEditConfigPreparer").length, 0);
assert.equal(byClass("TextEncodeQwenImageEditPlusCustom_lrzjason").length, 0);
const encoder = byClass("TextEncodeQwenImageEditPlus")[0][1];
assert.equal(encoder.inputs.prompt, expectedPrompt);
assert.deepEqual(encoder.inputs.image1, ["6", 0]);
assert.deepEqual(encoder.inputs.image2, ["7", 0]);
assert.deepEqual(encoder.inputs.image3, ["9", 0]);
assert.deepEqual(byClass("VAEEncode")[0][1].inputs.pixels, ["6", 0]);
assert.equal(byClass("ModelSamplingAuraFlow")[0][1].inputs.shift, 3.1);
const sampler = byClass("KSampler")[0][1].inputs;
assert.deepEqual({ steps: sampler.steps, cfg: sampler.cfg, sampler: sampler.sampler_name, scheduler: sampler.scheduler }, { steps: 4, cfg: 1, sampler: "euler", scheduler: "beta" });
assert.equal(byClass("SaveImage").length, 1, "Comfy must save only the raw edit");
assert.equal(byClass("ImageCompositeMasked").length, 0, "hard composition must happen outside Comfy");
endpoint.validatePresetObjectInfo(preset, objectInfoFixture());
assert.throws(() => endpoint.validatePresetObjectInfo(preset, { ...objectInfoFixture(), KSampler: undefined }), /KSampler/);
const badContract = objectInfoFixture();
delete badContract.TextEncodeQwenImageEditPlus.input.optional.image3;
assert.throws(() => endpoint.validatePresetObjectInfo(preset, badContract), /TextEncodeQwenImageEditPlus.*image3/i);
const missingLiveModels = objectInfoFixture();
missingLiveModels.UNETLoader.input.required.unet_name[0] = ["flux-2-klein-4b-fp8.safetensors"];
missingLiveModels.LoraLoaderModelOnly.input.required.lora_name[0] = [];
assert.throws(() => endpoint.validatePresetObjectInfo(preset, missingLiveModels), /does not offer qwen_image_edit_2511/i);
const badType = objectInfoFixture();
badType.VAEEncode.output = ["IMAGE"];
assert.throws(() => endpoint.validatePresetObjectInfo(preset, badType), /type mismatch.*latent_image/i);

// CLI is exactly one candidate and an optional report; no batch/all or duplicate mode.
assert.deepEqual(endpoint.parseEndpointArguments(["--candidate", "2"]), {
  candidate: 2,
  reportPath: resolve("logs/video-quality-one-take-flf2v/wan-flf2v-report.json")
});
assert.equal(endpoint.parseEndpointArguments(["--candidate", "3", "--report", "x.json"]).reportPath, resolve("x.json"));
for (const args of [[], ["--candidate", "all"], ["--candidate", "0"], ["--candidate", "4"], ["--candidate", "1", "--candidate", "2"], ["--candidate", "1", "--all"]]) {
  assert.throws(() => endpoint.parseEndpointArguments(args), /usage|candidate|exactly/i);
}

const tempRoot = mkdtempSync(join(tmpdir(), "wan-flf2v-endpoint-"));
try {
  const sourcePath = join(tempRoot, "source.png");
  const editedPath = join(tempRoot, "edited.png");
  const referencePath = join(tempRoot, "shen.png");
  makeSolid(sourcePath, "0xE01020");
  makeSolid(editedPath, "0x1030E0");
  makeSolid(referencePath, "0x20C040");

  // Real mask + FFmpeg maskedmerge fixture.
  const fixtureDir = join(tempRoot, "fixture");
  const { maskPath, lockedMaskPath } = endpoint.createLowerBodyMaskArtifacts({ outputDir: fixtureDir });
  assert.deepEqual(probe(maskPath), { width: 1152, height: 640, pix_fmt: "rgb24" });
  assert.deepEqual(probe(lockedMaskPath), { width: 1152, height: 640, pix_fmt: "rgb24" });
  const oracle = createIndependentMaskOracle(join(tempRoot, "oracle"));
  const maskRgb = rawRgb(maskPath);
  const oracleRgb = rawRgb(oracle.oraclePath);
  const lockedRgb = rawRgb(lockedMaskPath);
  assert.deepEqual(maskRgb, oracleRgb, "production mask must exactly match the independent polygon-union and 12px-feather oracle");
  assert.equal(oracle.raster[300 * 1152 + 450], 255, "upper polygon interior is selected");
  assert.equal(oracle.raster[500 * 1152 + 450], 255, "lower polygon interior is selected");
  assert.equal(oracle.raster[200 * 1152 + 450], 0, "area above the upper boundary is excluded");
  assert.equal(oracle.raster[500 * 1152 + 350], 0, "area left of the lower boundary is excluded");
  for (let offset = 0; offset < maskRgb.length; offset += 3) {
    const maskValue = maskRgb[offset];
    assert.equal(maskRgb[offset + 1], maskValue);
    assert.equal(maskRgb[offset + 2], maskValue);
    const expectedLocked = maskValue === 0 ? 255 : 0;
    assert.equal(lockedRgb[offset], expectedLocked, `locked complement red byte ${offset}`);
    assert.equal(lockedRgb[offset + 1], expectedLocked, `locked complement green byte ${offset}`);
    assert.equal(lockedRgb[offset + 2], expectedLocked, `locked complement blue byte ${offset}`);
  }
  const compositePath = join(fixtureDir, "composite.png");
  endpoint.hardComposeMasked({ sourcePath, editedPath, maskPath, outputPath: compositePath });
  endpoint.assertLockedRegionUnchanged({ sourcePath, compositePath, lockedMaskPath });

  const source = rawRgb(sourcePath);
  const edited = rawRgb(editedPath);
  const composite = rawRgb(compositePath);
  const mask = run("ffmpeg", ["-v", "error", "-i", maskPath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"], { encoding: null }).stdout;
  let insidePixels = 0;
  let outsidePixels = 0;
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 3;
    if (mask[pixel] === 255) {
      insidePixels += 1;
      assert.deepEqual(composite.subarray(offset, offset + 3), edited.subarray(offset, offset + 3), `edited pixel ${pixel}`);
    } else if (mask[pixel] === 0) {
      outsidePixels += 1;
      assert.deepEqual(composite.subarray(offset, offset + 3), source.subarray(offset, offset + 3), `locked source pixel ${pixel}`);
    }
  }
  assert.ok(insidePixels > 1000 && outsidePixels > 1000, "fixture must exercise inside and locked pixels");

  const tamperedPath = join(fixtureDir, "tampered.png");
  copyFileSync(editedPath, tamperedPath);
  assert.throws(() => endpoint.assertLockedRegionUnchanged({ sourcePath, compositePath: tamperedPath, lockedMaskPath }), /locked-region.*non-zero|locked region.*changed/i);

  // Non-live candidate run: adapters perform uploads and create the raw edit without /prompt.
  const authorityPath = join(tempRoot, "authoritative.json");
  writeFileSync(authorityPath, "authority-v1\n");
  const experimentRoot = join(tempRoot, "experiment");
  const reportPath = join(experimentRoot, "wan-flf2v-report.json");
  const initialReport = createExperimentReport({
    experimentRoot,
    authoritativeReportPath: authorityPath,
    authoritativeReportSha256: sha256File(authorityPath),
    startFramePath: sourcePath,
    startFrameSha256: sha256File(sourcePath)
  });
  endpoint.writeJsonAtomic(reportPath, initialReport);
  const fixedTempSentinelPath = `${reportPath}.tmp`;
  writeFileSync(fixedTempSentinelPath, "unrelated-fixed-temp-owner\n");

  const uploads = [];
  const generations = [];
  const result = await endpoint.runEndpointCandidate({ candidate: 2, reportPath, experimentRoot, shenYanPrimaryPath: referencePath }, {
    fetchObjectInfo: async () => objectInfoFixture(),
    uploadImage: async ({ path, role }) => {
      uploads.push({ path, role });
      return `contract/${role}.png`;
    },
    generateRawEdit: async ({ workflow, outputPath }) => {
      generations.push(structuredClone(workflow));
      copyFileSync(editedPath, outputPath);
      return { promptId: "offline-contract-prompt" };
    }
  });
  assert.equal(generations.length, 1, "runner must queue exactly one edit");
  assert.deepEqual(uploads.map(({ role }) => role), ["start", "shen_yan_primary", "lower_body_mask"]);
  assert.equal(generations[0]["16"].inputs.seed, ENDPOINT_SEEDS[1], "candidate must use the approved fixed seed lookup");
  assert.equal(generations[0]["6"].inputs.image, "contract/start.png");
  assert.equal(generations[0]["7"].inputs.image, "contract/shen_yan_primary.png");
  assert.equal(generations[0]["9"].inputs.image, "contract/lower_body_mask.png");
  assert.equal(result.candidate.seed, ENDPOINT_SEEDS[1]);
  assert.equal(result.candidate.technicalAcceptance.status, "accepted");
  assert.equal(result.candidate.creativeAcceptance.status, "pending");
  assert.equal(result.report.endpointCandidates.length, 1);
  assert.equal(result.report.endpointCandidates[0].candidate, 2, "candidate state must stay isolated");
  const candidateDir = join(experimentRoot, "endpoint", "candidate_002");
  for (const name of ["raw_edit.png", "mask.png", "locked_region_mask.png", "composite.png", "start_end.png"]) {
    assert.ok(existsSync(join(candidateDir, name)), `${name} must be written under the candidate directory`);
  }
  assert.equal(existsSync(join(experimentRoot, "endpoint", "candidate_001")), false);
  assert.equal(existsSync(join(experimentRoot, "endpoint", "candidate_003")), false);
  assert.deepEqual(probe(join(candidateDir, "start_end.png")).width, 2304);
  assert.equal(sha256File(result.candidate.compositePath), result.candidate.compositeSha256);
  assert.equal(sha256File(result.candidate.evidencePath), result.candidate.evidenceSha256);
  assert.deepEqual(JSON.parse(readFileSync(reportPath, "utf8")), result.report, "committed report bytes must equal the returned report");
  assert.deepEqual(JSON.parse(readFileSync(reportPath, "utf8")).endpointCandidates.at(-1), result.candidate, "committed candidate must equal the returned candidate");
  assert.equal(readFileSync(fixedTempSentinelPath, "utf8"), "unrelated-fixed-temp-owner\n", "commit must use a unique temp and preserve unrelated fixed-temp bytes");
  assert.equal(existsSync(`${reportPath}.lock`), false, "successful commit releases its report lock");
  assert.deepEqual(readdirSync(dirname(reportPath)).filter((name) => name.startsWith(`${basename(reportPath)}.tmp-`)), [], "successful commit cleans unique temporary files");
  await assert.rejects(endpoint.runEndpointCandidate({ candidate: 2, reportPath, experimentRoot, shenYanPrimaryPath: referencePath }, {
    fetchObjectInfo: async () => objectInfoFixture(),
    uploadImage: async () => "unused.png",
    generateRawEdit: async () => { throw new Error("duplicate candidate reached generation"); }
  }), /already exists/);

  // Authoritative drift rejects before upload/queue and preserves report bytes.
  const driftReportPath = join(tempRoot, "drift", "report.json");
  const driftAuthorityPath = join(tempRoot, "drift-authority.json");
  writeFileSync(driftAuthorityPath, "authority-original\n");
  endpoint.writeJsonAtomic(driftReportPath, createExperimentReport({
    experimentRoot: join(tempRoot, "drift-experiment"),
    authoritativeReportPath: driftAuthorityPath,
    authoritativeReportSha256: sha256File(driftAuthorityPath),
    startFramePath: sourcePath,
    startFrameSha256: sha256File(sourcePath)
  }));
  const reportBefore = readFileSync(driftReportPath);
  writeFileSync(driftAuthorityPath, "authority-drifted\n");
  let forbiddenCalls = 0;
  await assert.rejects(endpoint.runEndpointCandidate({ candidate: 1, reportPath: driftReportPath, experimentRoot: join(tempRoot, "drift-experiment"), shenYanPrimaryPath: referencePath }, {
    fetchObjectInfo: async () => { forbiddenCalls += 1; return objectInfoFixture(); },
    uploadImage: async () => { forbiddenCalls += 1; return "forbidden.png"; },
    generateRawEdit: async () => { forbiddenCalls += 1; }
  }), /authoritative.*changed/i);
  assert.equal(forbiddenCalls, 0);
  assert.deepEqual(readFileSync(driftReportPath), reportBefore);

  // A concurrent experiment-state update during generation must never be overwritten.
  const concurrentRoot = join(tempRoot, "concurrent-experiment");
  const concurrentReportPath = join(concurrentRoot, "wan-flf2v-report.json");
  const concurrentReport = createExperimentReport({
    experimentRoot: concurrentRoot,
    authoritativeReportPath: authorityPath,
    authoritativeReportSha256: sha256File(authorityPath),
    startFramePath: sourcePath,
    startFrameSha256: sha256File(sourcePath)
  });
  endpoint.writeJsonAtomic(concurrentReportPath, concurrentReport);
  const concurrentBytes = Buffer.from('{"concurrentWriter":true}\n');
  await assert.rejects(endpoint.runEndpointCandidate({ candidate: 3, reportPath: concurrentReportPath, experimentRoot: concurrentRoot, shenYanPrimaryPath: referencePath }, {
    fetchObjectInfo: async () => objectInfoFixture(),
    uploadImage: async ({ role }) => `contract/${role}.png`,
    generateRawEdit: async ({ outputPath }) => { copyFileSync(editedPath, outputPath); return { promptId: "offline-concurrent" }; },
    beforeReportWrite: async () => writeFileSync(concurrentReportPath, concurrentBytes)
  }), /experiment report.*changed|report state.*changed/i);
  assert.deepEqual(readFileSync(concurrentReportPath), concurrentBytes, "runner must preserve the concurrent writer's state");
  assert.equal(existsSync(`${concurrentReportPath}.lock`), false, "stale-base rejection releases its owned lock");
  assert.deepEqual(readdirSync(dirname(concurrentReportPath)).filter((name) => name.startsWith(`${basename(concurrentReportPath)}.tmp-`)), [], "stale-base rejection cleans unique temporary files");

  // Lock contention fails closed without deleting or rewriting another owner's lock.
  const contentionRoot = join(tempRoot, "contention-experiment");
  const contentionReportPath = join(contentionRoot, "wan-flf2v-report.json");
  endpoint.writeJsonAtomic(contentionReportPath, createExperimentReport({
    experimentRoot: contentionRoot,
    authoritativeReportPath: authorityPath,
    authoritativeReportSha256: sha256File(authorityPath),
    startFramePath: sourcePath,
    startFrameSha256: sha256File(sourcePath)
  }));
  const contentionReportBytes = readFileSync(contentionReportPath);
  const contentionLockPath = `${contentionReportPath}.lock`;
  const otherOwner = "other-owner-lock\n";
  writeFileSync(contentionLockPath, otherOwner);
  await assert.rejects(endpoint.runEndpointCandidate({ candidate: 1, reportPath: contentionReportPath, experimentRoot: contentionRoot, shenYanPrimaryPath: referencePath }, {
    fetchObjectInfo: async () => objectInfoFixture(),
    uploadImage: async ({ role }) => `contract/${role}.png`,
    generateRawEdit: async ({ outputPath }) => { copyFileSync(editedPath, outputPath); return { promptId: "offline-contention" }; }
  }), /report lock.*contended|lock.*exists|EEXIST/i);
  assert.deepEqual(readFileSync(contentionReportPath), contentionReportBytes);
  assert.equal(readFileSync(contentionLockPath, "utf8"), otherOwner, "runner must not delete another owner's lock");
  assert.deepEqual(readdirSync(dirname(contentionReportPath)).filter((name) => name.startsWith(`${basename(contentionReportPath)}.tmp-`)), [], "contention creates no temporary report");

  // The approved start snapshot is rechecked after generation, before state is committed.
  const startDriftRoot = join(tempRoot, "start-drift-experiment");
  const startDriftReportPath = join(startDriftRoot, "wan-flf2v-report.json");
  const mutableStartPath = join(tempRoot, "mutable-start.png");
  copyFileSync(sourcePath, mutableStartPath);
  endpoint.writeJsonAtomic(startDriftReportPath, createExperimentReport({
    experimentRoot: startDriftRoot,
    authoritativeReportPath: authorityPath,
    authoritativeReportSha256: sha256File(authorityPath),
    startFramePath: mutableStartPath,
    startFrameSha256: sha256File(mutableStartPath)
  }));
  const startDriftReportBytes = readFileSync(startDriftReportPath);
  await assert.rejects(endpoint.runEndpointCandidate({ candidate: 1, reportPath: startDriftReportPath, experimentRoot: startDriftRoot, shenYanPrimaryPath: referencePath }, {
    fetchObjectInfo: async () => objectInfoFixture(),
    uploadImage: async ({ role }) => `contract/${role}.png`,
    generateRawEdit: async ({ outputPath }) => { copyFileSync(editedPath, outputPath); return { promptId: "offline-start-drift" }; },
    beforeReportWrite: async () => copyFileSync(editedPath, mutableStartPath)
  }), /approved start frame.*changed|start frame hash/i);
  assert.deepEqual(readFileSync(startDriftReportPath), startDriftReportBytes);
  assert.equal(existsSync(`${startDriftReportPath}.lock`), false, "start-drift rejection releases its owned lock");
  assert.deepEqual(readdirSync(dirname(startDriftReportPath)).filter((name) => name.startsWith(`${basename(startDriftReportPath)}.tmp-`)), [], "start-drift rejection cleans unique temporary files");

  // Canonical report invariants reject before candidate directory creation or any adapter call.
  const invalidRoot = join(tempRoot, "invalid-experiment");
  const invalidReportPath = join(invalidRoot, "wan-flf2v-report.json");
  endpoint.writeJsonAtomic(invalidReportPath, { ...createExperimentReport({
    experimentRoot: invalidRoot,
    authoritativeReportPath: authorityPath,
    authoritativeReportSha256: sha256File(authorityPath),
    startFramePath: sourcePath,
    startFrameSha256: sha256File(sourcePath)
  }), schemaVersion: 999 });
  let invalidAdapterCalls = 0;
  await assert.rejects(endpoint.runEndpointCandidate({ candidate: 1, reportPath: invalidReportPath, experimentRoot: invalidRoot, shenYanPrimaryPath: referencePath }, {
    fetchObjectInfo: async () => { invalidAdapterCalls += 1; return objectInfoFixture(); },
    uploadImage: async () => { invalidAdapterCalls += 1; return "forbidden.png"; },
    generateRawEdit: async () => { invalidAdapterCalls += 1; }
  }), /schemaVersion|report invariant/i);
  assert.equal(invalidAdapterCalls, 0);
  assert.equal(existsSync(join(invalidRoot, "endpoint")), false, "invalid report must not create an endpoint directory");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("Wan FLF2V endpoint contract: PASS");
