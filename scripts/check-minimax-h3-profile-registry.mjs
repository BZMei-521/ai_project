import assert from "node:assert/strict";
import {
  MINIMAX_H3_PROFILES,
  preflightVideoAcceleration,
  preflightVideoProfile
} from "../src/modules/video-production/workflowProfilesRuntime.mjs";

const MODELS = {
  fl2va: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  ref2va: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  clip: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  videoVae: "minimax_h3_video_vae_fp16.safetensors",
  audioVae: "minimax_h3_audio_vae_fp32.safetensors"
};
const BASE_NODES = [
  "UNETLoader", "CLIPLoader", "VAELoader", "RandomNoise", "KSamplerSelect",
  "BasicScheduler", "BasicGuider", "SamplerCustomAdvanced", "VAEDecode",
  "VAEDecodeAudio", "CreateVideo", "SaveVideo"
];
const EXPECTED = [
  {
    id: "minimax_h3_t2v",
    presetPath: "src/modules/comfy-pipeline/presets/minimax-h3-t2v-v1.json",
    requiredNodes: [...BASE_NODES, "MiniMaxH3ImageToVideo"],
    requiredModels: [MODELS.fl2va, MODELS.clip, MODELS.videoVae, MODELS.audioVae]
  },
  {
    id: "minimax_h3_i2v",
    presetPath: "src/modules/comfy-pipeline/presets/minimax-h3-i2v-v1.json",
    requiredNodes: [...BASE_NODES, "MiniMaxH3ImageToVideo", "LoadImage"],
    requiredModels: [MODELS.fl2va, MODELS.clip, MODELS.videoVae, MODELS.audioVae]
  },
  {
    id: "minimax_h3_flf2v",
    presetPath: "src/modules/comfy-pipeline/presets/minimax-h3-flf2v-v1.json",
    requiredNodes: [...BASE_NODES, "MiniMaxH3ImageToVideo", "LoadImage"],
    requiredModels: [MODELS.fl2va, MODELS.clip, MODELS.videoVae, MODELS.audioVae]
  },
  {
    id: "minimax_h3_r2v",
    presetPath: "src/modules/comfy-pipeline/presets/minimax-h3-r2v-v1.json",
    requiredNodes: [...BASE_NODES, "MiniMaxH3ReferenceToVideo", "LoadImage"],
    requiredModels: [MODELS.ref2va, MODELS.clip, MODELS.videoVae, MODELS.audioVae]
  }
];

assert.deepEqual(MINIMAX_H3_PROFILES.map(({ id }) => id), EXPECTED.map(({ id }) => id), "profile ids must be stable");
for (const expected of EXPECTED) {
  const profile = MINIMAX_H3_PROFILES.find(({ id }) => id === expected.id);
  assert.equal(profile.presetPath, expected.presetPath, `${expected.id}: preset path mismatch`);
  assert.deepEqual(profile.requiredNodes, expected.requiredNodes, `${expected.id}: required node contract mismatch`);
  assert.deepEqual(profile.requiredModels, [
    { kind: "diffusion_models", name: expected.requiredModels[0] },
    { kind: "text_encoders", name: expected.requiredModels[1] },
    { kind: "vae", name: expected.requiredModels[2] },
    { kind: "vae", name: expected.requiredModels[3] }
  ], `${expected.id}: required model contract mismatch`);
}

const verifiedInventory = {
  nodes: [...new Set(EXPECTED.flatMap(({ requiredNodes }) => requiredNodes))],
  models: {
    diffusion_models: [MODELS.fl2va, MODELS.ref2va],
    text_encoders: [MODELS.clip],
    vae: [MODELS.videoVae, MODELS.audioVae]
  }
};

for (const profile of MINIMAX_H3_PROFILES) {
  assert.deepEqual(preflightVideoProfile(profile, verifiedInventory), {
    profileId: profile.id, available: true, missingNodes: [], missingModels: [], warnings: []
  }, `${profile.id}: verified inventory must be available`);
}

const withoutReferenceNode = {
  ...verifiedInventory,
  nodes: verifiedInventory.nodes.filter((node) => node !== "MiniMaxH3ReferenceToVideo")
};
for (const profile of MINIMAX_H3_PROFILES) {
  const report = preflightVideoProfile(profile, withoutReferenceNode);
  assert.equal(report.available, profile.id !== "minimax_h3_r2v", `${profile.id}: only R2V requires reference node`);
}

const withoutRef2va = {
  ...verifiedInventory,
  models: { ...verifiedInventory.models, diffusion_models: [MODELS.fl2va] }
};
assert.deepEqual(preflightVideoProfile(MINIMAX_H3_PROFILES[3], withoutRef2va).missingModels, [
  { kind: "diffusion_models", name: MODELS.ref2va }
], "R2V must report the missing ref2va model");

const withoutTeSpeed = { ...verifiedInventory, nodes: [...verifiedInventory.nodes] };
assert.deepEqual(preflightVideoAcceleration("te_speed_preview", "draft", withoutTeSpeed), {
  available: false, warnings: ["missing_node:TESpeedMiniMaxH3"]
}, "TE Speed overlay must be unavailable when its node is absent");
assert.deepEqual(preflightVideoAcceleration("standard", MINIMAX_H3_PROFILES[0].qualityTier, withoutTeSpeed), {
  available: true, warnings: []
}, "standard acceleration must not depend on the TE Speed overlay node");
assert.equal(preflightVideoProfile(MINIMAX_H3_PROFILES[0], withoutTeSpeed).available, true,
  "base profile must remain available in standard mode");

console.log("PASS minimax h3 profile registry");
