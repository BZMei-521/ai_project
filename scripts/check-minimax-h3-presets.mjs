import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const presetsDirectory = path.join(root, "src", "modules", "comfy-pipeline", "presets");
const manifest = JSON.parse(fs.readFileSync(path.join(presetsDirectory, "minimax-h3-source-manifest.json"), "utf8"));
const MODELS = {
  fl2va: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  ref2va: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  clip: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  videoVae: "minimax_h3_video_vae_fp16.safetensors",
  audioVae: "minimax_h3_audio_vae_fp32.safetensors"
};
const cases = [
  ["minimax-h3-t2v-v1.json", "t2v", "MiniMaxH3ImageToVideo"],
  ["minimax-h3-i2v-v1.json", "i2v", "MiniMaxH3ImageToVideo"],
  ["minimax-h3-flf2v-v1.json", "flf2v", "MiniMaxH3ImageToVideo"],
  ["minimax-h3-r2v-v1.json", "r2v", "MiniMaxH3ReferenceToVideo"]
];

function assertInput(inputs, name, expected, label) {
  assert.deepEqual(inputs[name], expected, `${label}: ${name} link/value mismatch`);
}

function collectTokens(value) {
  return [...JSON.stringify(value).matchAll(/\{\{[A-Z0-9_]+\}\}/g)].map((match) => match[0]).sort();
}

function assertBaseGraph(prompt, mode, conditioningType, name) {
  const nodes = Object.values(prompt);
  assert.ok(nodes.length >= 12, `${name}: expected complete API prompt`);
  assert.equal(prompt["1"].class_type, "UNETLoader", `${name}: missing UNETLoader`);
  assert.equal(prompt["1"].inputs.unet_name, mode === "r2v" ? MODELS.ref2va : MODELS.fl2va, `${name}: wrong UNET model`);
  assert.equal(prompt["2"].class_type, "CLIPLoader", `${name}: missing CLIPLoader`);
  assert.equal(prompt["2"].inputs.clip_name, MODELS.clip, `${name}: wrong CLIP model`);
  assert.equal(prompt["3"].inputs.vae_name, MODELS.videoVae, `${name}: wrong video VAE`);
  assert.equal(prompt["4"].inputs.vae_name, MODELS.audioVae, `${name}: wrong audio VAE`);
  assert.equal(prompt["5"].class_type, conditioningType, `${name}: wrong conditioning node`);
  assert.equal(prompt["6"].class_type, "RandomNoise", `${name}: missing noise node`);
  assert.equal(prompt["7"].class_type, "KSamplerSelect", `${name}: missing sampler selector`);
  assert.equal(prompt["7"].inputs.sampler_name, "res_multistep", `${name}: wrong sampler`);
  assert.equal(prompt["8"].class_type, "BasicScheduler", `${name}: missing scheduler`);
  assertInput(prompt["8"].inputs, "model", ["1", 0], name);
  assert.equal(prompt["8"].inputs.scheduler, "simple", `${name}: wrong scheduler`);
  assert.equal(prompt["8"].inputs.steps, 20, `${name}: wrong step count`);
  assert.equal(prompt["8"].inputs.denoise, 1, `${name}: wrong scheduler denoise`);
  assert.equal(prompt["9"].class_type, "BasicGuider", `${name}: missing guider`);
  assertInput(prompt["9"].inputs, "model", ["1", 0], name);
  assertInput(prompt["9"].inputs, "conditioning", ["5", 0], name);
  assert.equal(prompt["10"].class_type, "SamplerCustomAdvanced", `${name}: missing sampler`);
  assertInput(prompt["10"].inputs, "noise", ["6", 0], name);
  assertInput(prompt["10"].inputs, "guider", ["9", 0], name);
  assertInput(prompt["10"].inputs, "sampler", ["7", 0], name);
  assertInput(prompt["10"].inputs, "sigmas", ["8", 0], name);
  assertInput(prompt["10"].inputs, "latent_image", ["5", 1], name);
  assert.equal(prompt["11"].class_type, "VAEDecode", `${name}: missing video decode`);
  assertInput(prompt["11"].inputs, "samples", ["10", 0], name);
  assertInput(prompt["11"].inputs, "vae", ["3", 0], name);
  assert.equal(prompt["12"].class_type, "VAEDecodeAudio", `${name}: missing audio decode`);
  assertInput(prompt["12"].inputs, "samples", ["10", 0], name);
  assertInput(prompt["12"].inputs, "vae", ["4", 0], name);
  assert.equal(prompt["13"].class_type, "CreateVideo", `${name}: missing video mux`);
  assertInput(prompt["13"].inputs, "images", ["11", 0], name);
  assertInput(prompt["13"].inputs, "audio", ["12", 0], name);
  assert.equal(prompt["13"].inputs.fps, 24, `${name}: wrong FPS`);
  assert.equal(prompt["14"].class_type, "SaveVideo", `${name}: missing video save`);
  assertInput(prompt["14"].inputs, "video", ["13", 0], name);
  assert.equal(nodes.some((node) => node.class_type === "TESpeedMiniMaxH3"), false);
}

function assertModeContract(prompt, mode, name) {
  const inputs = prompt["5"].inputs;
  assertInput(inputs, "clip", ["2", 0], name);
  assertInput(inputs, "vae", ["3", 0], name);
  assert.equal(inputs.prompt, "{{VIDEO_PROMPT}}", `${name}: prompt token must be consumed by conditioning`);
  assert.equal(inputs.width, "{{VIDEO_WIDTH}}", `${name}: width token must be consumed by conditioning`);
  assert.equal(inputs.height, "{{VIDEO_HEIGHT}}", `${name}: height token must be consumed by conditioning`);
  assert.equal(inputs.length, "{{H3_LENGTH}}", `${name}: length token must be consumed by conditioning`);
  assert.equal(prompt["6"].inputs.noise_seed, "{{SEED}}", `${name}: seed token must be consumed by noise`);

  const expectedTokens = ["{{H3_LENGTH}}", "{{SEED}}", "{{VIDEO_HEIGHT}}", "{{VIDEO_PROMPT}}", "{{VIDEO_WIDTH}}"];
  if (mode === "t2v") {
    assert.equal("first_frame" in inputs, false, `${name}: T2V must not bind a first frame`);
    assert.equal("last_frame" in inputs, false, `${name}: T2V must not bind a last frame`);
  }
  if (mode === "i2v" || mode === "flf2v") {
    assert.equal(prompt["15"].class_type, "LoadImage", `${name}: missing first-frame loader`);
    assert.equal(prompt["15"].inputs.image, "{{FIRST_FRAME_PATH}}", `${name}: first frame token must be consumed by loader`);
    assertInput(inputs, "first_frame", ["15", 0], name);
    expectedTokens.push("{{FIRST_FRAME_PATH}}");
  }
  if (mode === "i2v") {
    assert.equal("last_frame" in inputs, false, `${name}: I2V must not bind a last frame`);
  }
  if (mode === "flf2v") {
    assert.equal(prompt["16"].class_type, "LoadImage", `${name}: missing last-frame loader`);
    assert.equal(prompt["16"].inputs.image, "{{LAST_FRAME_PATH}}", `${name}: last frame token must be consumed by loader`);
    assertInput(inputs, "last_frame", ["16", 0], name);
    expectedTokens.push("{{LAST_FRAME_PATH}}");
  }
  if (mode === "r2v") {
    assertInput(inputs, "audio_vae", ["4", 0], name);
    assert.equal(inputs.ref_image_size, "match", `${name}: R2V must use match reference sizing`);
    assert.equal("first_frame" in inputs, false, `${name}: R2V must not bind a first frame`);
    assert.equal("last_frame" in inputs, false, `${name}: R2V must not bind a last frame`);
    for (let index = 0; index < 4; index += 1) {
      const nodeId = String(15 + index);
      const token = `{{REF_IMAGE_${index + 1}_PATH}}`;
      assert.equal(prompt[nodeId].class_type, "LoadImage", `${name}: missing reference loader ${index + 1}`);
      assert.equal(prompt[nodeId].inputs.image, token, `${name}: reference token ${index + 1} must be consumed by loader`);
      assertInput(inputs, `ref_images.ref_image_${index}`, [nodeId, 0], name);
      expectedTokens.push(token);
    }
  }

  assert.deepEqual(collectTokens(prompt), expectedTokens.sort(), `${name}: incomplete or unrelated token surface`);
}

assert.equal(manifest.nativeFps, 24, "manifest: H3 native FPS must be 24");
assert.deepEqual(manifest.h3LengthRange, [124, 362], "manifest: H3 length range mismatch");
assert.equal(manifest.h3LengthGrid, "17k+5", "manifest: H3 length grid mismatch");
for (const length of manifest.h3LengthRange) {
  assert.equal(length % 17, 5, `manifest: ${length} is not on the 17k+5 grid`);
}

for (const [name, mode, conditioningType] of cases) {
  const raw = fs.readFileSync(path.join(presetsDirectory, name), "utf8");
  const prompt = JSON.parse(raw);
  assertBaseGraph(prompt, mode, conditioningType, name);
  assertModeContract(prompt, mode, name);
}

const generatedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "minimax-h3-presets-"));
try {
  const generated = childProcess.spawnSync(process.execPath, ["scripts/build-minimax-h3-presets.mjs", `--output-dir=${generatedDirectory}`], {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(generated.status, 0, `preset builder failed: ${generated.stderr}`);
  for (const [name] of cases) {
    assert.equal(
      fs.readFileSync(path.join(generatedDirectory, name), "utf8"),
      fs.readFileSync(path.join(presetsDirectory, name), "utf8"),
      `${name}: checked-in preset drifted from deterministic builder output`
    );
  }
} finally {
  fs.rmSync(generatedDirectory, { recursive: true, force: true });
}

console.log("PASS minimax h3 API presets");
