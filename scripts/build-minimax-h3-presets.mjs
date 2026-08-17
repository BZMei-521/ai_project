import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultPresetsDirectory = path.join(process.cwd(), "src", "modules", "comfy-pipeline", "presets");

export const MODELS = {
  fl2va: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  ref2va: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  clip: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  videoVae: "minimax_h3_video_vae_fp16.safetensors",
  audioVae: "minimax_h3_audio_vae_fp32.safetensors"
};

const samplerInputs = {
  sampler_name: "res_multistep"
};

const schedulerInputs = {
  model: ["1", 0],
  scheduler: "simple",
  steps: 20,
  denoise: 1
};

export function buildBase({ mode, teSpeed }) {
  if (teSpeed) throw new Error("TE Speed overlays are not part of production presets");

  const isReferenceMode = mode === "r2v";
  const conditioningType = isReferenceMode ? "MiniMaxH3ReferenceToVideo" : "MiniMaxH3ImageToVideo";
  const conditioningInputs = isReferenceMode
    ? {
        clip: ["2", 0],
        vae: ["3", 0],
        audio_vae: ["4", 0],
        prompt: "{{VIDEO_PROMPT}}",
        width: "{{VIDEO_WIDTH}}",
        height: "{{VIDEO_HEIGHT}}",
        length: "{{H3_LENGTH}}",
        ref_image_size: "match"
      }
    : {
        clip: ["2", 0],
        vae: ["3", 0],
        prompt: "{{VIDEO_PROMPT}}",
        width: "{{VIDEO_WIDTH}}",
        height: "{{VIDEO_HEIGHT}}",
        length: "{{H3_LENGTH}}"
      };

  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: isReferenceMode ? MODELS.ref2va : MODELS.fl2va, weight_dtype: "default" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: MODELS.clip, type: "minimax", device: "default" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: MODELS.videoVae } },
    "4": { class_type: "VAELoader", inputs: { vae_name: MODELS.audioVae } },
    "5": { class_type: conditioningType, inputs: conditioningInputs },
    "6": { class_type: "RandomNoise", inputs: { noise_seed: "{{SEED}}" } },
    "7": { class_type: "KSamplerSelect", inputs: samplerInputs },
    "8": { class_type: "BasicScheduler", inputs: schedulerInputs },
    "9": { class_type: "BasicGuider", inputs: { model: ["1", 0], conditioning: ["5", 0] } },
    "10": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["6", 0], guider: ["9", 0], sampler: ["7", 0], sigmas: ["8", 0], latent_image: ["5", 1] } },
    "11": { class_type: "VAEDecode", inputs: { samples: ["10", 0], vae: ["3", 0] } },
    "12": { class_type: "VAEDecodeAudio", inputs: { samples: ["10", 0], vae: ["4", 0] } },
    "13": { class_type: "CreateVideo", inputs: { images: ["11", 0], audio: ["12", 0], fps: 24, bit_depth: 8 } },
    "14": { class_type: "SaveVideo", inputs: { video: ["13", 0], filename_prefix: "Video/minimax_h3", format: "mp4", codec: "h264" } }
  };
}

export function buildPrompt(mode) {
  const prompt = buildBase({ mode, teSpeed: false });
  if (mode === "i2v" || mode === "flf2v") {
    prompt["15"] = { class_type: "LoadImage", inputs: { image: "{{FIRST_FRAME_PATH}}" } };
    prompt["5"].inputs.first_frame = ["15", 0];
  }
  if (mode === "flf2v") {
    prompt["16"] = { class_type: "LoadImage", inputs: { image: "{{LAST_FRAME_PATH}}" } };
    prompt["5"].inputs.last_frame = ["16", 0];
  }
  if (mode === "r2v") {
    for (let index = 0; index < 4; index += 1) {
      const nodeId = String(15 + index);
      prompt[nodeId] = { class_type: "LoadImage", inputs: { image: `{{REF_IMAGE_${index + 1}_PATH}}` } };
      prompt["5"].inputs[`ref_images.ref_image_${index}`] = [nodeId, 0];
    }
  }
  return prompt;
}

export const presets = [
  ["minimax-h3-t2v-v1.json", "t2v"],
  ["minimax-h3-i2v-v1.json", "i2v"],
  ["minimax-h3-flf2v-v1.json", "flf2v"],
  ["minimax-h3-r2v-v1.json", "r2v"]
];

export function writePresets(presetsDirectory = defaultPresetsDirectory) {
  fs.mkdirSync(presetsDirectory, { recursive: true });
  for (const [name, mode] of presets) {
    fs.writeFileSync(path.join(presetsDirectory, name), `${JSON.stringify(buildPrompt(mode), null, 2)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputDirectoryArg = process.argv.find((argument) => argument.startsWith("--output-dir="));
  const outputDirectory = outputDirectoryArg
    ? path.resolve(process.cwd(), outputDirectoryArg.slice("--output-dir=".length))
    : defaultPresetsDirectory;
  writePresets(outputDirectory);
}
