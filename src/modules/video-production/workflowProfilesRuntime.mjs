const preset = (name) => `src/modules/comfy-pipeline/presets/${name}`;

const BASE_NODES = [
  "UNETLoader", "CLIPLoader", "VAELoader", "RandomNoise", "KSamplerSelect",
  "BasicScheduler", "BasicGuider", "SamplerCustomAdvanced", "VAEDecode",
  "VAEDecodeAudio", "CreateVideo", "SaveVideo"
];
const BASE_MODELS = [
  { kind: "text_encoders", name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors" },
  { kind: "vae", name: "minimax_h3_video_vae_fp16.safetensors" },
  { kind: "vae", name: "minimax_h3_audio_vae_fp32.safetensors" }
];
const supports = (overrides = {}) => ({
  textOnly: false, firstFrame: false, lastFrame: false, referenceImages: 0,
  referenceVideo: false, referenceAudio: false, ...overrides
});
const imageToVideoModels = [
  { kind: "diffusion_models", name: "minimax_h3_fl2va_pruned_int8_convrot.safetensors" },
  ...BASE_MODELS
];

export const MINIMAX_H3_PROFILES = [
  {
    id: "minimax_h3_t2v", presetPath: preset("minimax-h3-t2v-v1.json"), qualityTier: "production",
    supports: supports({ textOnly: true }),
    requiredNodes: [...BASE_NODES, "MiniMaxH3ImageToVideo"], requiredModels: imageToVideoModels
  },
  {
    id: "minimax_h3_i2v", presetPath: preset("minimax-h3-i2v-v1.json"), qualityTier: "production",
    supports: supports({ firstFrame: true }),
    requiredNodes: [...BASE_NODES, "MiniMaxH3ImageToVideo", "LoadImage"], requiredModels: imageToVideoModels
  },
  {
    id: "minimax_h3_flf2v", presetPath: preset("minimax-h3-flf2v-v1.json"), qualityTier: "production",
    supports: supports({ firstFrame: true, lastFrame: true }),
    requiredNodes: [...BASE_NODES, "MiniMaxH3ImageToVideo", "LoadImage"], requiredModels: imageToVideoModels
  },
  {
    id: "minimax_h3_r2v", presetPath: preset("minimax-h3-r2v-v1.json"), qualityTier: "production",
    supports: supports({ referenceImages: 4 }),
    requiredNodes: [...BASE_NODES, "MiniMaxH3ReferenceToVideo", "LoadImage"],
    requiredModels: [
      { kind: "diffusion_models", name: "minimax_h3_ref2va_pruned_int8_convrot.safetensors" },
      ...BASE_MODELS
    ]
  }
];

export function preflightVideoProfile(profile, inventory) {
  const nodes = new Set(inventory.nodes ?? []);
  const missingNodes = profile.requiredNodes.filter((name) => !nodes.has(name));
  const missingModels = profile.requiredModels.filter(
    ({ kind, name }) => !(inventory.models?.[kind] ?? []).includes(name)
  );
  return {
    profileId: profile.id,
    available: missingNodes.length === 0 && missingModels.length === 0,
    missingNodes,
    missingModels,
    warnings: []
  };
}

export function preflightVideoAcceleration(mode, qualityTier, inventory) {
  if (mode === "standard") return { available: true, warnings: [] };
  if (qualityTier !== "draft") return { available: false, warnings: ["te_speed_draft_only"] };
  return inventory.nodes?.includes("TESpeedMiniMaxH3")
    ? { available: true, warnings: ["te_speed_draft_only"] }
    : { available: false, warnings: ["missing_node:TESpeedMiniMaxH3"] };
}
