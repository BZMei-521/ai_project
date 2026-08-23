import assert from "node:assert/strict";
import fs from "node:fs/promises";

const presetPath = "src/modules/comfy-pipeline/presets/video-wan21-i2v-14b-fp8.json";
let workflow;
try {
  workflow = JSON.parse(await fs.readFile(presetPath, "utf8"));
} catch {
  assert.fail("production Wan 2.1 I2V preset must exist");
}

const panel = await fs.readFile("src/modules/comfy-pipeline/ComfyPipelinePanel.tsx", "utf8");
const nodes = Object.values(workflow);
const types = nodes.map((node) => node.class_type);
const raw = JSON.stringify(workflow);

for (const type of [
  "UNETLoader",
  "ModelSamplingSD3",
  "CLIPLoader",
  "VAELoader",
  "CLIPVisionLoader",
  "LoadImage",
  "CLIPVisionEncode",
  "CLIPTextEncode",
  "WanImageToVideo",
  "KSampler",
  "VAEDecode",
  "CreateVideo",
  "SaveVideo"
]) {
  assert.ok(types.includes(type), `Wan production preset must include ${type}`);
}
for (const value of [
  "Wan2_1-I2V-ATI-14B_fp8_e4m3fn.safetensors",
  "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
  "wan_2.1_vae.safetensors",
  "clip_vision_h.safetensors",
  "{{FRAME_IMAGE_PATH}}",
  "{{VIDEO_PROMPT}}",
  "{{NEGATIVE_PROMPT}}",
  "{{SEED}}",
  "{{WAN_FRAME_COUNT}}",
  "Video/{{SHOT_TITLE}}_wan21_i2v"
]) {
  assert.ok(raw.includes(value), `Wan production preset must use ${value}`);
}
assert.doesNotMatch(raw, /smoothMixWan22|Qwen-Rapid-AIO|WanMoeKSampler|RIFE VFI|VHS_VideoCombine/);
assert.match(panel, /import WAN21_I2V_WORKFLOW_OBJECT from "\.\/presets\/video-wan21-i2v-14b-fp8\.json";/);
assert.match(panel, /workflowLooksLikeProductionWanI2v[\s\S]*?Wan2_1-I2V-ATI-14B_fp8_e4m3fn\.safetensors/);
assert.match(
  panel,
  /workflowContainsWanSamplerNodes\([\s\S]*?!workflowLooksLikeProductionWanI2v/,
  "supported Wan I2V must not be downgraded to local motion"
);
assert.match(panel, /写入 Wan 2\.1 I2V 高质量模板/);

console.log("Wan 2.1 I2V production preset contract: PASS");
