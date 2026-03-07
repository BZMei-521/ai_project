import { useMemo, useState } from "react";
import {
  DEFAULT_TOKEN_MAPPING,
  generateShotAsset,
  generateSkyboxFaceUpdate,
  generateSkyboxFaces,
  splitCharacterThreeViewSheet,
  type ComfySettings
} from "../comfy-pipeline/comfyService";
import CHARACTER_THREEVIEW_WORKFLOW_OBJECT from "../comfy-pipeline/presets/asset-character-threeview-default.json";
import CHARACTER_KONTEXT_THREEVIEW_WORKFLOW_OBJECT from "../comfy-pipeline/presets/asset-character-kontext-threeview-default.json";
import CHARACTER_THREEVIEW_LAYOUT_REF_DATA_URL from "../comfy-pipeline/presets/assets/character-threeview-layout-ref.png?inline";
import SKYBOX_WORKFLOW_OBJECT from "../comfy-pipeline/presets/asset-skybox-default.json";
import SKYBOX_PANORAMA_WORKFLOW_OBJECT from "../comfy-pipeline/presets/asset-skybox-panorama-default.json";
import { invokeDesktopCommand, toDesktopMediaSource } from "../platform/desktopBridge";
import { useStoryboardStore } from "../storyboard-core/store";
import type { AssetType, Shot, SkyboxFace } from "../storyboard-core/types";
import { confirmDialog } from "../ui/dialogStore";
import { pushToast } from "../ui/toastStore";

const SETTINGS_KEY = "storyboard-pro/comfy-settings/v1";
const DEFAULT_CHARACTER_ASSET_MODEL = "sd_xl_base_1.0.safetensors";
const DEFAULT_SKYBOX_ASSET_MODEL = "sd_xl_base_1.0.safetensors";
const DEFAULT_CHARACTER_ADVANCED_UNET = "flux1-kontext-dev.safetensors";
const DEFAULT_CHARACTER_ADVANCED_CLIP_L = "clip_l.safetensors";
const DEFAULT_CHARACTER_ADVANCED_CLIP_T5 = "t5xxl_fp16.safetensors";
const DEFAULT_CHARACTER_ADVANCED_VAE = "ae.safetensors";
const CHARACTER_THREEVIEW_LAYOUT_INPUT_FILENAME = "storyboard_character_threeview_layout_ref.png";
const CHARACTER_THREEVIEW_LAYOUT_TOKEN = "THREEVIEW_LAYOUT_IMAGE_PATH";
const CHARACTER_THREEVIEW_OUTPUT_PREFIX = "Storyboard/character_orthoview_{{SHOT_ID}}";
const DEFAULT_SKYBOX_LORA = "View360.safetensors";
const DEFAULT_CHARACTER_NEGATIVE_PROMPT =
  "multiple people, two people, extra person, crowd, group shot, scene background, fighting pose, weapon action, cut off body, half body, close-up crop, props blocking body, multiple angles, two angles, multi view, multiview, turnaround sheet, character sheet, contact sheet, split screen, diptych, triptych, collage, duplicated body, mirrored body, deformed anatomy, bad anatomy, bad proportions, warped body, twisted torso, extra limbs, malformed hands, fused fingers, long neck, asymmetrical eyes";

type CharacterAssetWorkflowMode = "advanced_multiview";
type SkyboxAssetWorkflowMode = "basic_builtin" | "advanced_panorama";

const CHARACTER_RENDER_PRESET_CONFIG: Record<
  "stable_fullbody" | "clean_reference",
  { steps: number; cfg: number; sampler_name: string; scheduler: string }
> = {
  stable_fullbody: {
    steps: 30,
    cfg: 5.4,
    sampler_name: "dpmpp_2m",
    scheduler: "karras"
  },
  clean_reference: {
    steps: 34,
    cfg: 5.6,
    sampler_name: "dpmpp_2m",
    scheduler: "karras"
  }
};

const SKYBOX_FACES: SkyboxFace[] = ["front", "right", "back", "left", "up", "down"];

function normalizeStoryInput(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/\u3000/g, " ").trim();
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function looksLikeSdxlCheckpoint(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  return /sd[_-]?xl|animagine[-_]?xl|juggernautxl|(?:^|[^a-z0-9])xl(?:[^a-z0-9]|$)/.test(normalized);
}

function resolveMvAdapterCharacterModel(name: string): string {
  return looksLikeSdxlCheckpoint(name) ? name : DEFAULT_CHARACTER_ASSET_MODEL;
}

function resolveMvAdapterFallbackModel(_name: string): string {
  return resolveMvAdapterCharacterModel(_name);
}

function resolveCharacterTemplateSize(
  checkpointName: string,
  preset: "portrait" | "square"
): { width: number; height: number } {
  const isSdxl = looksLikeSdxlCheckpoint(checkpointName);
  if (preset === "square") {
    return isSdxl ? { width: 1024, height: 1024 } : { width: 832, height: 832 };
  }
  return isSdxl ? { width: 896, height: 1344 } : { width: 768, height: 1152 };
}

function resolveCharacterFallbackSheetSize(checkpointName: string): { width: number; height: number } {
  const isSdxl = looksLikeSdxlCheckpoint(checkpointName);
  return isSdxl ? { width: 1536, height: 1024 } : { width: 1344, height: 896 };
}

function buildCharacterWorkflowTemplateJson(
  checkpointName: string,
  preset: "portrait" | "square",
  renderPreset: "stable_fullbody" | "clean_reference"
): string {
  const template = cloneJson(CHARACTER_THREEVIEW_WORKFLOW_OBJECT) as Record<string, { inputs?: Record<string, unknown> }>;
  if (template["1"]?.inputs) {
    template["1"].inputs.ckpt_name = checkpointName;
  }
  if (template["4"]?.inputs) {
    const { width, height } = resolveCharacterTemplateSize(checkpointName, preset);
    template["4"].inputs.width = width;
    template["4"].inputs.height = height;
  }
  if (template["5"]?.inputs) {
    const config = CHARACTER_RENDER_PRESET_CONFIG[renderPreset];
    template["5"].inputs.seed = "{{SEED}}";
    template["5"].inputs.steps = config.steps;
    template["5"].inputs.cfg = config.cfg;
    template["5"].inputs.sampler_name = config.sampler_name;
    template["5"].inputs.scheduler = config.scheduler;
  }
  return JSON.stringify(template, null, 2);
}

function buildCharacterAdvancedWorkflowTemplateJson(
  renderPreset: "stable_fullbody" | "clean_reference"
): string {
  const template = cloneJson(CHARACTER_KONTEXT_THREEVIEW_WORKFLOW_OBJECT) as {
    nodes?: Array<{ id?: number; widgets_values?: unknown[] }>;
  };
  const config = CHARACTER_RENDER_PRESET_CONFIG[renderPreset];
  const setNodeWidgets = (nodeId: number, values: unknown[]) => {
    const node = template.nodes?.find((item) => item.id === nodeId);
    if (!node) return;
    node.widgets_values = values;
  };
  setNodeWidgets(133, ["{{FRAME_IMAGE_PATH}}", "image", ""]);
  setNodeWidgets(152, [`{{${CHARACTER_THREEVIEW_LAYOUT_TOKEN}}}`, "image", ""]);
  setNodeWidgets(281, [DEFAULT_CHARACTER_ADVANCED_UNET, "fp8_e4m3fn_fast"]);
  setNodeWidgets(280, [DEFAULT_CHARACTER_ADVANCED_CLIP_L, DEFAULT_CHARACTER_ADVANCED_CLIP_T5, "flux", "default"]);
  setNodeWidgets(279, [DEFAULT_CHARACTER_ADVANCED_VAE]);
  setNodeWidgets(315, ["weight_patch_first", "auto"]);
  setNodeWidgets(335, ["RMBG-2.0", 1, 1024, 0, 0, "#808080", false, "Color", false]);
  setNodeWidgets(286, ["{{PROMPT}}"]);
  setNodeWidgets(301, ["{{SEED}}", "fixed"]);
  setNodeWidgets(302, [Math.max(20, config.steps), "fixed"]);
  setNodeWidgets(294, ["{{SEED}}", "fixed", Math.max(20, config.steps), 1, "euler", "simple", 1]);
  setNodeWidgets(316, [CHARACTER_THREEVIEW_OUTPUT_PREFIX, ""]);
  return JSON.stringify(template, null, 2);
}

function buildCharacterReferenceEditFallbackWorkflowTemplateJson(checkpointName: string): string {
  const fallbackModel = resolveMvAdapterFallbackModel(checkpointName);
  const { width, height } = resolveCharacterFallbackSheetSize(fallbackModel);
  const template: Record<string, { inputs: Record<string, unknown>; class_type: string }> = {
    "1": {
      inputs: { ckpt_name: fallbackModel },
      class_type: "CheckpointLoaderSimple"
    },
    "2": {
      inputs: { image: "{{FRAME_IMAGE_PATH}}", upload: "image" },
      class_type: "LoadImage"
    },
    "3": {
      inputs: {
        image: ["2", 0],
        upscale_method: "lanczos",
        width,
        height,
        crop: "disabled"
      },
      class_type: "ImageScale"
    },
    "4": {
      inputs: { pixels: ["3", 0], vae: ["1", 2] },
      class_type: "VAEEncode"
    },
    "5": {
      inputs: { text: "{{PROMPT}}", clip: ["1", 1] },
      class_type: "CLIPTextEncode"
    },
    "6": {
      inputs: { text: "{{NEGATIVE_PROMPT}}", clip: ["1", 1] },
      class_type: "CLIPTextEncode"
    },
    "7": {
      inputs: {
        seed: "{{SEED}}",
        steps: 32,
        cfg: 5.6,
        sampler_name: "dpmpp_2m",
        scheduler: "karras",
        denoise: 0.56,
        model: ["1", 0],
        positive: ["5", 0],
        negative: ["6", 0],
        latent_image: ["4", 0]
      },
      class_type: "KSampler"
    },
    "8": {
      inputs: { samples: ["7", 0], vae: ["1", 2] },
      class_type: "VAEDecode"
    },
    "9": {
      inputs: { filename_prefix: CHARACTER_THREEVIEW_OUTPUT_PREFIX, images: ["8", 0] },
      class_type: "SaveImage"
    }
  };
  return JSON.stringify(template, null, 2);
}

function workflowGraphNodes(workflowJson: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(workflowJson) as { nodes?: unknown };
    return Array.isArray(parsed.nodes) ? (parsed.nodes as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

function workflowHasKnownBrokenCharacterAdvancedDefaults(workflowJson: string): boolean {
  const trimmed = workflowJson.trim();
  if (!trimmed) return false;
  if (!trimmed.includes(`{{${CHARACTER_THREEVIEW_LAYOUT_TOKEN}}}`) || !trimmed.includes(CHARACTER_THREEVIEW_OUTPUT_PREFIX)) {
    return false;
  }
  const nodes = workflowGraphNodes(trimmed);
  if (nodes.length <= 0) return false;
  const rmbgNode = nodes.find((node) => node.id === 335 || node.type === "RMBG");
  if (Array.isArray(rmbgNode?.widgets_values)) {
    const backgroundColor = rmbgNode.widgets_values[5];
    const background = rmbgNode.widgets_values[7];
    if (typeof backgroundColor === "string" && backgroundColor.trim() && !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(backgroundColor.trim())) {
      return true;
    }
    if (typeof background === "string" && !/^(Color|Alpha)$/i.test(background.trim())) {
      return true;
    }
  }
  const patchNode = nodes.find((node) => node.id === 315 || node.type === "PatchModelPatcherOrder");
  if (Array.isArray(patchNode?.widgets_values)) {
    const fullLoad = patchNode.widgets_values[1];
    if (typeof fullLoad === "string" && !/^(enabled|disabled|auto)$/i.test(fullLoad.trim())) {
      return true;
    }
  }
  return false;
}

function buildSkyboxWorkflowTemplateJson(checkpointName: string, preset: "wide" | "square"): string {
  const template = cloneJson(SKYBOX_WORKFLOW_OBJECT) as Record<string, { inputs?: Record<string, unknown> }>;
  if (template["1"]?.inputs) {
    template["1"].inputs.ckpt_name = checkpointName;
  }
  if (template["4"]?.inputs) {
    template["4"].inputs.width = preset === "square" ? 1024 : 1600;
    template["4"].inputs.height = preset === "square" ? 1024 : 900;
  }
  return JSON.stringify(template, null, 2);
}

function buildSkyboxPanoramaWorkflowTemplateJson(checkpointName: string, preset: "wide" | "square"): string {
  const template = cloneJson(SKYBOX_PANORAMA_WORKFLOW_OBJECT) as Record<string, { inputs?: Record<string, unknown> }>;
  const width = preset === "square" ? 1536 : 1920;
  const height = Math.max(512, Math.round(width / 2));
  if (template["1"]?.inputs) {
    template["1"].inputs.ckpt_name = checkpointName;
  }
  if (template["2"]?.inputs) {
    template["2"].inputs.lora_name = DEFAULT_SKYBOX_LORA;
  }
  if (template["7"]?.inputs) {
    template["7"].inputs.width = width;
    template["7"].inputs.height = height;
  }
  for (const nodeId of ["11", "13", "15", "17", "19", "21"]) {
    if (template[nodeId]?.inputs) {
      template[nodeId].inputs.face_width = height;
    }
  }
  return JSON.stringify(template, null, 2);
}

function makeAssetGenerationShot(
  sequenceId: string,
  id: string,
  title: string,
  prompt: string,
  negativePrompt = "",
  seed?: number
): Shot {
  return {
    id,
    sequenceId,
    order: 1,
    title,
    durationFrames: 24,
    dialogue: "",
    notes: "",
    tags: [],
    storyPrompt: prompt,
    negativePrompt,
    videoPrompt: "",
    videoMode: "single_frame",
    characterRefs: [],
    sceneRefId: "",
    seed
  };
}

function buildCharacterViewPrompt(name: string, context: string, view: "front" | "side" | "back") {
  const viewLabel = view === "front" ? "正视图" : view === "side" ? "标准右侧视图" : "背视图";
  const viewConstraint =
    view === "front"
      ? "strict front orthographic view, facing camera, shoulders level, feet parallel"
      : view === "side"
        ? "strict right profile orthographic view, nose points right, only one eye visible, shoulders and hips stacked in profile"
        : "strict back orthographic view, facing away from camera, no visible face, shoulders level";
  return [
    `角色设定三视图，${viewLabel}，单人全身，角色：${name}。`,
    normalizeStoryInput(context),
    "设定板用途，标准正交视角，完整服装，完整鞋靴，头顶到脚底完整入镜。",
    "中性站姿，双臂自然下垂且略微离开身体，双腿自然站立，禁止剧情动作和时装摆拍。",
    "纯净中性背景，无道具，无环境叙事，无其他人物，无拼版，无分屏。",
    "同一角色身份稳定，脸型、发型、体型、服装款式与配色必须一致。",
    viewConstraint
  ].join(" ");
}

function buildCharacterViewNegativePrompt(view: "front" | "side" | "back", baseNegativePrompt: string) {
  const viewConstraint =
    view === "front"
      ? "side profile, side view, back view, rear view, three quarter view, 3/4 view, turned torso"
      : view === "side"
        ? "front view, facing camera, back view, rear view, three quarter view, 3/4 view, turned torso, visible far eye, both eyes frontal, frontal shoulders, frontal chest, over shoulder"
        : "front view, facing camera, side profile, looking back, face visible, over shoulder, three quarter back view";
  return [
    baseNegativePrompt,
    viewConstraint,
    "two characters, two bodies, clone, mirrored twin, duplicate body, split composition, character sheet layout, turnaround sheet, collage",
    "close-up portrait, bust shot, upper body only, cowboy shot, cropped body, cut off head, cut off feet, oversized subject",
    "deformed anatomy, bad anatomy, bad proportions, warped body, twisted torso, extra arms, extra legs, malformed hands, fused fingers",
    "crossed arms, folded arms, hands behind back, hands in pockets, leaning pose, contrapposto, runway pose, bent knee, tilted shoulders, tilted hips",
    "dramatic perspective, foreshortening, fisheye, dutch angle, low angle shot, high angle shot, scene background clutter"
  ]
    .filter((item) => item.trim().length > 0)
    .join(", ");
}

function buildCharacterViewSelectionTokenOverrides(
  view: "front" | "side" | "back",
  frameImagePath: string,
  negativePrompt: string
) {
  return {
    FRAME_IMAGE_PATH: frameImagePath,
    NEGATIVE_PROMPT: negativePrompt,
    CHARACTER_FRONT_VIEW: view === "front" ? "true" : "false",
    CHARACTER_FRONT_RIGHT_VIEW: "false",
    CHARACTER_RIGHT_VIEW: view === "side" ? "true" : "false",
    CHARACTER_BACK_VIEW: view === "back" ? "true" : "false",
    CHARACTER_LEFT_VIEW: "false",
    CHARACTER_FRONT_LEFT_VIEW: "false"
  };
}

function isGeneratedCharacterViewPath(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return false;
  return (
    trimmed.includes("character_threeview") ||
    trimmed.includes("character_mv_") ||
    trimmed.includes("character_orthoview_")
  );
}

function stripInlineDataUrlPrefix(raw: string): string {
  return raw.replace(/^data:[^,]+,/, "");
}

async function encodeFetchedAssetAsBase64(assetRef: string): Promise<string> {
  const trimmed = assetRef.trim();
  if (!trimmed) throw new Error("角色三视图版式参考资源为空");
  if (trimmed.startsWith("data:")) {
    return stripInlineDataUrlPrefix(trimmed);
  }
  const response = await fetch(trimmed);
  if (!response.ok) {
    throw new Error(`读取角色三视图版式参考失败：HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function ensureCharacterThreeViewLayoutReferenceFilename(comfySettings: ComfySettings): Promise<string> {
  const inputDir = comfySettings.comfyInputDir.trim().replace(/[\\/]+$/, "");
  if (!inputDir) {
    throw new Error("角色三视图工作流需要 ComfyUI input 目录，但当前设置里没有 input 路径。");
  }
  const targetPath = `${inputDir}/${CHARACTER_THREEVIEW_LAYOUT_INPUT_FILENAME}`;
  const base64Data = await encodeFetchedAssetAsBase64(CHARACTER_THREEVIEW_LAYOUT_REF_DATA_URL);
  await invokeDesktopCommand<{ filePath: string }>("write_base64_file", {
    filePath: targetPath,
    base64Data
  });
  return CHARACTER_THREEVIEW_LAYOUT_INPUT_FILENAME;
}

function buildCharacterThreeViewSheetPrompt(name: string, context: string, backgroundPreset: "white" | "gray" | "studio" = "gray"): string {
  const backgroundText =
    backgroundPreset === "white"
      ? "pure white background"
      : backgroundPreset === "studio"
        ? "neutral studio background"
        : "grey background";
  return [
    "Recreate the same character from the first image into exactly three full-body orthographic views: front, strict right side profile, and back.",
    "Match the exact layout, spacing, pose family, framing, and anatomical orientation of the second reference image.",
    `Character identity: ${name}`,
    normalizeStoryInput(context),
    "Preserve the same face, hairstyle, body proportions, costume structure, accessories, and silhouette from the first image.",
    "One character only, one front view, one side view, one back view, full body, head and feet visible, no crop, no extra panels, no text, no watermark.",
    "The side view must be a strict right-facing profile. The back view must show no face. The front view must face camera.",
    `${backgroundText}, clean character turnaround sheet, production-ready reference board`
  ]
    .filter((item) => item.trim().length > 0)
    .join(" ");
}

function buildCharacterViewEditRetryPrompt(name: string, context: string, view: "side" | "back", attempt: number): string {
  const retryTuning =
    attempt <= 0
      ? "Keep generous blank margin around the whole body. Full body must be entirely inside frame."
      : attempt === 1
        ? "Zoom out slightly. Character should occupy less frame area. Keep one clean silhouette only and remove any duplicate limbs or duplicate figure."
        : "Strict orthographic reference image, one angle only, one person only, plain studio sheet, full body centered, no crop, no decorative effects.";
  return [
    buildCharacterViewPrompt(name, context, view),
    "Use the reference image as the exact identity source. Keep the same face, hairstyle, body proportions, clothing structure, accessories, colors, and silhouette. Do not redesign the character.",
    "Render exactly one isolated human character on a plain light grey background. No lineup, no character sheet, no extra panel, no annotation, no frame, no scenery.",
    retryTuning
  ]
    .filter((item) => item.trim().length > 0)
    .join(" ");
}

function buildCharacterFallbackSheetPrompt(name: string, context: string, attempt: number): string {
  const retryTuning =
    attempt <= 0
      ? "Three figures must be evenly spaced in three equal vertical panels. Each full body stays entirely inside its own panel."
      : attempt === 1
        ? "Zoom out slightly so all three bodies have larger blank margins. Keep all heads and feet comfortably inside the canvas."
        : "Minimal grey-background turnaround sheet only. Keep exactly three isolated full-body figures and nothing else.";
  return [
    "masterpiece, best quality, high detail, clean character turnaround sheet",
    `Character identity: ${name}`,
    normalizeStoryInput(context),
    "exactly three equal vertical panels on a plain light grey background",
    "left panel front view, middle panel strict right side profile, right panel back view",
    "preserve the exact same face, hairstyle, body proportions, costume structure, accessories, silhouette, and colors from the reference image",
    "all three figures fully visible from head to toe, no crop, no text, no watermark, no icons, no decorative border, no scenery",
    retryTuning
  ]
    .filter((item) => item.trim().length > 0)
    .join(" ");
}

function buildCharacterFallbackSheetNegativePrompt(baseNegativePrompt: string): string {
  return [
    baseNegativePrompt,
    "single centered figure only, two figures only, four figures, five figures, crowd, lineup with many tiny characters",
    "character poster, fashion poster, decorative border, flower border, magic circle, text, annotation, watermark, logo, inset portrait, extra face icon",
    "cropped side figure, overlapping figures, merged bodies, duplicate front view, three quarter view, dramatic perspective",
    "robot armor mannequin, faceless mannequin, wireframe body, silhouette only, statue, vehicle, building"
  ]
    .filter((item) => item.trim().length > 0)
    .join(", ");
}

function buildCharacterFallbackTriptychInputPath(sourcePath: string, attempt: number): string {
  const trimmed = sourcePath.trim();
  if (!trimmed) return "";
  return trimmed.replace(/(\.[^.\\/]+)?$/, `_triptych_input_${attempt + 1}.png`);
}

async function buildCharacterFallbackTriptychInput(
  sourcePath: string,
  checkpointName: string,
  attempt: number
): Promise<string> {
  const trimmed = sourcePath.trim();
  if (!trimmed || typeof document === "undefined") return sourcePath;
  const sourceUrl = /^data:/.test(trimmed) ? trimmed : toDesktopMediaSource(trimmed);
  if (!sourceUrl) return sourcePath;
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("加载角色正视锚点失败"));
    element.src = sourceUrl;
  });
  const { width, height } = resolveCharacterFallbackSheetSize(checkpointName);
  const panelWidth = Math.floor(width / 3);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return sourcePath;
  context.fillStyle = "rgb(236,236,236)";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const targetHeightRatios = [0.78, 0.74, 0.7];
  const targetHeightRatio = targetHeightRatios[Math.max(0, Math.min(targetHeightRatios.length - 1, attempt))] ?? 0.7;
  const scale = Math.min((panelWidth * 0.72) / image.width, (height * targetHeightRatio) / image.height);
  if (!Number.isFinite(scale) || scale <= 0) return sourcePath;
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const y = Math.round((height - drawHeight) / 2);
  for (let panelIndex = 0; panelIndex < 3; panelIndex += 1) {
    const x = Math.round(panelIndex * panelWidth + (panelWidth - drawWidth) / 2);
    context.drawImage(image, x, y, drawWidth, drawHeight);
  }
  const filePath = buildCharacterFallbackTriptychInputPath(trimmed, attempt);
  if (!filePath) return sourcePath;
  const result = await invokeDesktopCommand<{ filePath: string }>("write_base64_file", {
    filePath,
    base64Data: canvas.toDataURL("image/png").replace(/^data:[^,]+,/, "")
  });
  return result.filePath || sourcePath;
}

function resolveManualCharacterAnchor(frontPath: string, filePath: string): string {
  const front = frontPath.trim();
  if (front && !isGeneratedCharacterViewPath(front)) return front;
  const file = filePath.trim();
  if (file && !isGeneratedCharacterViewPath(file)) return file;
  return "";
}

function loadComfySettingsFromLocalStorage(): ComfySettings | null {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ComfySettings>;
    if (!parsed.baseUrl) return null;
    const characterAssetWorkflowMode: CharacterAssetWorkflowMode = "advanced_multiview";
    const skyboxAssetWorkflowMode: SkyboxAssetWorkflowMode =
      parsed.skyboxAssetWorkflowMode === "advanced_panorama" ? "advanced_panorama" : "basic_builtin";
    const characterTemplatePreset =
      parsed.characterTemplatePreset === "square" || parsed.characterTemplatePreset === "portrait"
        ? parsed.characterTemplatePreset
        : "portrait";
    const characterRenderPreset =
      parsed.characterRenderPreset === "stable_fullbody" || parsed.characterRenderPreset === "clean_reference"
        ? parsed.characterRenderPreset
        : "clean_reference";
    const skyboxTemplatePreset =
      parsed.skyboxTemplatePreset === "square" || parsed.skyboxTemplatePreset === "wide"
        ? parsed.skyboxTemplatePreset
        : "wide";
    const requestedCharacterModel =
      typeof parsed.characterAssetModelName === "string" && parsed.characterAssetModelName.trim()
        ? parsed.characterAssetModelName.trim()
        : DEFAULT_CHARACTER_ASSET_MODEL;
    const characterAssetModelName = resolveMvAdapterCharacterModel(requestedCharacterModel);
    const skyboxAssetModelName =
      typeof parsed.skyboxAssetModelName === "string" && parsed.skyboxAssetModelName.trim()
        ? parsed.skyboxAssetModelName.trim()
        : DEFAULT_SKYBOX_ASSET_MODEL;
    const parsedCharacterWorkflowJson = typeof parsed.characterWorkflowJson === "string" ? parsed.characterWorkflowJson : "";
    const characterWorkflowJson =
      parsedCharacterWorkflowJson.trim() && !workflowHasKnownBrokenCharacterAdvancedDefaults(parsedCharacterWorkflowJson)
        ? parsedCharacterWorkflowJson
        : buildCharacterAdvancedWorkflowTemplateJson(characterRenderPreset);
    const skyboxWorkflowJson =
      typeof parsed.skyboxWorkflowJson === "string" && parsed.skyboxWorkflowJson.trim()
        ? parsed.skyboxWorkflowJson
        : skyboxAssetWorkflowMode === "advanced_panorama"
          ? buildSkyboxPanoramaWorkflowTemplateJson(skyboxAssetModelName, skyboxTemplatePreset)
          : buildSkyboxWorkflowTemplateJson(skyboxAssetModelName, skyboxTemplatePreset);
    return {
      baseUrl: parsed.baseUrl,
      outputDir: parsed.outputDir ?? "",
      comfyInputDir: parsed.comfyInputDir ?? "",
      comfyRootDir: parsed.comfyRootDir ?? "",
      imageWorkflowJson: parsed.imageWorkflowJson ?? "",
      storyboardImageWorkflowMode:
        parsed.storyboardImageWorkflowMode === "builtin_qwen" || parsed.storyboardImageWorkflowMode === "mature_asset_guided"
          ? parsed.storyboardImageWorkflowMode
          : "mature_asset_guided",
      storyboardImageModelName: parsed.storyboardImageModelName ?? DEFAULT_CHARACTER_ASSET_MODEL,
      videoWorkflowJson: parsed.videoWorkflowJson ?? parsed.imageWorkflowJson ?? "",
      characterWorkflowJson,
      skyboxWorkflowJson,
      characterAssetWorkflowMode,
      skyboxAssetWorkflowMode,
      requireDedicatedCharacterWorkflow:
        typeof parsed.requireDedicatedCharacterWorkflow === "boolean" ? parsed.requireDedicatedCharacterWorkflow : true,
      requireDedicatedSkyboxWorkflow:
        typeof parsed.requireDedicatedSkyboxWorkflow === "boolean" ? parsed.requireDedicatedSkyboxWorkflow : true,
      characterAssetModelName,
      skyboxAssetModelName,
      characterTemplatePreset,
      characterRenderPreset,
      characterBackgroundPreset:
        parsed.characterBackgroundPreset === "white" ||
        parsed.characterBackgroundPreset === "gray" ||
        parsed.characterBackgroundPreset === "studio"
          ? parsed.characterBackgroundPreset
          : "gray",
      skyboxTemplatePreset,
      skyboxPromptPreset:
        parsed.skyboxPromptPreset === "night_exterior" ||
        parsed.skyboxPromptPreset === "interior" ||
        parsed.skyboxPromptPreset === "day_exterior"
          ? parsed.skyboxPromptPreset
          : "day_exterior",
      skyboxNegativePreset:
        parsed.skyboxNegativePreset === "night_exterior" ||
        parsed.skyboxNegativePreset === "interior" ||
        parsed.skyboxNegativePreset === "day_exterior"
          ? parsed.skyboxNegativePreset
          : "day_exterior",
      characterAssetNegativePrompt:
        typeof parsed.characterAssetNegativePrompt === "string"
          ? parsed.characterAssetNegativePrompt
          : DEFAULT_CHARACTER_NEGATIVE_PROMPT,
      skyboxAssetNegativePrompt: typeof parsed.skyboxAssetNegativePrompt === "string" ? parsed.skyboxAssetNegativePrompt : "",
      audioWorkflowJson: typeof parsed.audioWorkflowJson === "string" ? parsed.audioWorkflowJson : "",
      soundWorkflowJson: typeof parsed.soundWorkflowJson === "string" ? parsed.soundWorkflowJson : "",
      globalVisualStylePrompt: typeof parsed.globalVisualStylePrompt === "string" ? parsed.globalVisualStylePrompt : "",
      globalStyleNegativePrompt: typeof parsed.globalStyleNegativePrompt === "string" ? parsed.globalStyleNegativePrompt : "",
      videoGenerationMode: parsed.videoGenerationMode ?? "comfy",
      renderWidth: typeof parsed.renderWidth === "number" ? parsed.renderWidth : undefined,
      renderHeight: typeof parsed.renderHeight === "number" ? parsed.renderHeight : undefined,
      renderFps: typeof parsed.renderFps === "number" ? parsed.renderFps : undefined,
      tokenMapping: {
        ...DEFAULT_TOKEN_MAPPING,
        ...(parsed.tokenMapping ?? {})
      }
    };
  } catch {
    return null;
  }
}

export function AssetPanel() {
  const assets = useStoryboardStore((state) => state.assets);
  const addAsset = useStoryboardStore((state) => state.addAsset);
  const updateAsset = useStoryboardStore((state) => state.updateAsset);
  const removeAsset = useStoryboardStore((state) => state.removeAsset);
  const currentSequenceId = useStoryboardStore((state) => state.currentSequenceId);
  const [tab, setTab] = useState<AssetType>("character");
  const [name, setName] = useState("");
  const [filePath, setFilePath] = useState("");
  const [frontPath, setFrontPath] = useState("");
  const [sidePath, setSidePath] = useState("");
  const [backPath, setBackPath] = useState("");
  const [voiceProfile, setVoiceProfile] = useState("");
  const [characterDescription, setCharacterDescription] = useState("");
  const [skyboxDescription, setSkyboxDescription] = useState("");
  const [skyboxTagsInput, setSkyboxTagsInput] = useState("");
  const [skyboxFacePaths, setSkyboxFacePaths] = useState<Partial<Record<SkyboxFace, string>>>({});
  const [eventFaceByAsset, setEventFaceByAsset] = useState<Record<string, SkyboxFace>>({});
  const [eventPromptByAsset, setEventPromptByAsset] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const scopedAssets = useMemo(
    () => assets.filter((asset) => asset.type === tab),
    [assets, tab]
  );

  const onAdd = () => {
    const skyboxTags = skyboxTagsInput
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const skyboxMainPath = skyboxFacePaths.front || filePath;
    addAsset({
      type: tab,
      name,
      filePath: tab === "character" ? frontPath : tab === "skybox" ? skyboxMainPath : filePath,
      characterFrontPath: tab === "character" ? frontPath : undefined,
      characterSidePath: tab === "character" ? sidePath : undefined,
      characterBackPath: tab === "character" ? backPath : undefined,
      voiceProfile: tab === "character" ? voiceProfile : undefined,
      skyboxDescription: tab === "skybox" ? skyboxDescription : undefined,
      skyboxTags: tab === "skybox" ? skyboxTags : undefined,
      skyboxFaces: tab === "skybox" ? skyboxFacePaths : undefined,
      skyboxUpdateEvents: tab === "skybox" ? [] : undefined
    });
    setName("");
    setFilePath("");
    setFrontPath("");
    setSidePath("");
    setBackPath("");
    setVoiceProfile("");
    setCharacterDescription("");
    setSkyboxDescription("");
    setSkyboxTagsInput("");
    setSkyboxFacePaths({});
  };

  const onGenerateCharacterViews = async () => {
    const comfySettings = loadComfySettingsFromLocalStorage();
    if (!comfySettings) {
      pushToast("请先在 AI 流水线配置并保存 Comfy 设置", "error");
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      pushToast("请先填写角色名称", "warning");
      return;
    }
    const context = characterDescription.trim() || `${trimmedName} 的角色设定`;
    try {
      setBusy(true);
      const batchId = Date.now();
      const characterModel = resolveMvAdapterCharacterModel(
        comfySettings.characterAssetModelName?.trim() || DEFAULT_CHARACTER_ASSET_MODEL
      );
      const characterRenderPreset = comfySettings.characterRenderPreset ?? "clean_reference";
      const characterTemplatePreset = comfySettings.characterTemplatePreset ?? "portrait";
      const baseNegativePrompt = comfySettings.characterAssetNegativePrompt?.trim() || DEFAULT_CHARACTER_NEGATIVE_PROMPT;
      const referenceWorkflow = buildCharacterWorkflowTemplateJson(
        characterModel,
        characterTemplatePreset,
        characterRenderPreset
      );
      const referenceEditWorkflow = buildCharacterReferenceEditFallbackWorkflowTemplateJson(
        comfySettings.characterAssetModelName?.trim() || DEFAULT_CHARACTER_ASSET_MODEL
      );
      const referenceEditModel = resolveMvAdapterFallbackModel(
        comfySettings.characterAssetModelName?.trim() || DEFAULT_CHARACTER_ASSET_MODEL
      );
      const advancedWorkflow =
        comfySettings.characterWorkflowJson?.trim() || buildCharacterAdvancedWorkflowTemplateJson(characterRenderPreset);
      const layoutFilename = await ensureCharacterThreeViewLayoutReferenceFilename(comfySettings);
      const manualAnchorPath = resolveManualCharacterAnchor(frontPath, filePath);
      const front =
        manualAnchorPath.length > 0
          ? {
              localPath: manualAnchorPath,
              previewUrl: manualAnchorPath
            }
          : await generateShotAsset(
              comfySettings,
              makeAssetGenerationShot(
                currentSequenceId,
                `asset_panel_char_${batchId}_front`,
                `${trimmedName} 正视图`,
                buildCharacterViewPrompt(trimmedName, context, "front"),
                buildCharacterViewNegativePrompt("front", baseNegativePrompt),
                batchId
              ),
              0,
              "image",
              [],
              [],
              {
                workflowJsonOverride: referenceWorkflow,
                tokenOverrides: {
                  NEGATIVE_PROMPT: buildCharacterViewNegativePrompt("front", baseNegativePrompt)
                }
              }
            );
      const frontAnchorPath = front.localPath || front.previewUrl;
      if (!frontAnchorPath) {
        throw new Error("角色正视参考图生成成功，但没有可用输出路径");
      }
      try {
        const sheet = await generateShotAsset(
          comfySettings,
          makeAssetGenerationShot(
            currentSequenceId,
            `asset_panel_char_${batchId}_threeview_sheet`,
            `${trimmedName} 三视图整板`,
            buildCharacterThreeViewSheetPrompt(trimmedName, context, comfySettings.characterBackgroundPreset ?? "gray"),
            "",
            batchId + 101
          ),
          0,
          "image",
          [],
          [],
          {
            workflowJsonOverride: advancedWorkflow,
            tokenOverrides: {
              FRAME_IMAGE_PATH: frontAnchorPath,
              [CHARACTER_THREEVIEW_LAYOUT_TOKEN]: layoutFilename
            }
          }
        );
        const sheetPath = sheet.localPath || sheet.previewUrl;
        if (!sheetPath) {
          throw new Error("角色三视图整板生成成功，但没有可用输出路径");
        }
        const split = await splitCharacterThreeViewSheet(sheetPath);
        setFrontPath(split.frontPath);
        setSidePath(split.sidePath);
        setBackPath(split.backPath);
        setFilePath(split.frontPath);
        pushToast(
          manualAnchorPath.length > 0
            ? "角色三视图生成完成，已使用现有人物正视图和固定版式参考"
            : "角色三视图生成完成，已按正视锚点和固定版式参考生成并拆图",
          "success"
        );
      } catch (advancedError) {
        let fallbackError: unknown = null;
        let resolvedSplit: Awaited<ReturnType<typeof splitCharacterThreeViewSheet>> | null = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const fallbackInputPath = await buildCharacterFallbackTriptychInput(frontAnchorPath, referenceEditModel, attempt);
            const prompt = buildCharacterFallbackSheetPrompt(trimmedName, context, attempt);
            const generated = await generateShotAsset(
              comfySettings,
              makeAssetGenerationShot(
                currentSequenceId,
                `asset_panel_char_${batchId}_fallback_sheet_${attempt + 1}`,
                `${trimmedName} 简化三视图整板`,
                prompt,
                "",
                batchId + 9000 + attempt * 997
              ),
              0,
              "image",
              [],
              [],
              {
                workflowJsonOverride: referenceEditWorkflow,
                tokenOverrides: {
                  STORYBOARD_IMAGE_MODEL: referenceEditModel,
                  PROMPT: prompt,
                  FRAME_IMAGE_PATH: fallbackInputPath,
                  NEGATIVE_PROMPT: buildCharacterFallbackSheetNegativePrompt(baseNegativePrompt)
                }
              }
            );
            const sheetPath = generated.localPath || generated.previewUrl;
            if (!sheetPath) {
              throw new Error("简化三视图整板生成成功，但没有可用输出路径");
            }
            resolvedSplit = await splitCharacterThreeViewSheet(sheetPath);
            break;
          } catch (error) {
            fallbackError = error;
          }
        }
        if (!resolvedSplit) {
          throw (fallbackError instanceof Error ? fallbackError : new Error("简化三视图整板补全失败"));
        }
        setFrontPath(frontAnchorPath);
        setSidePath(resolvedSplit.sidePath);
        setBackPath(resolvedSplit.backPath);
        setFilePath(frontAnchorPath);
        pushToast(`高级整板失败，已切换简化整板补全：${String(advancedError)}`, "warning");
      }
    } catch (error) {
      pushToast(`角色三视图生成失败：${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const onGenerateSkybox = async () => {
    const comfySettings = loadComfySettingsFromLocalStorage();
    if (!comfySettings) {
      pushToast("请先在 AI 流水线配置并保存 Comfy 设置", "error");
      return;
    }
    const desc = skyboxDescription.trim();
    if (!desc) {
      pushToast("请先填写场景描述", "warning");
      return;
    }
    try {
      setBusy(true);
      const result = await generateSkyboxFaces(comfySettings, desc);
      setSkyboxFacePaths(result.faces);
      if (result.faces.front) setFilePath(result.faces.front);
      pushToast("天空盒六面生成完成", "success");
    } catch (error) {
      pushToast(`天空盒生成失败：${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const onUpdateSkyboxFace = async (assetId: string) => {
    const asset = assets.find((item) => item.id === assetId && item.type === "skybox");
    if (!asset) return;
    const face = eventFaceByAsset[assetId] ?? "front";
    const eventPrompt = (eventPromptByAsset[assetId] ?? "").trim();
    if (!eventPrompt) {
      pushToast("请填写事件描述（例如：墙面出现弹孔）", "warning");
      return;
    }
    const comfySettings = loadComfySettingsFromLocalStorage();
    if (!comfySettings) {
      pushToast("请先在 AI 流水线配置并保存 Comfy 设置", "error");
      return;
    }
    try {
      setBusy(true);
      const description = asset.skyboxDescription?.trim() || asset.name;
      const generated = await generateSkyboxFaceUpdate(comfySettings, description, face, eventPrompt);
      const nextFaces = { ...(asset.skyboxFaces ?? {}), [face]: generated.filePath };
      const nextEvents = [
        ...(asset.skyboxUpdateEvents ?? []),
        {
          id: `skybox_evt_${Date.now()}`,
          face,
          prompt: eventPrompt,
          filePath: generated.filePath,
          createdAt: new Date().toISOString()
        }
      ];
      updateAsset(assetId, {
        filePath: nextFaces.front || generated.filePath,
        skyboxFaces: nextFaces,
        skyboxUpdateEvents: nextEvents
      });
      setEventPromptByAsset((prev) => ({ ...prev, [assetId]: "" }));
      pushToast(`已更新天空盒 ${face} 面`, "success");
    } catch (error) {
      pushToast(`更新天空盒失败：${String(error)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (assetId: string) => {
    const ok = await confirmDialog({
      title: "删除人物",
      message: "删除后会从镜头引用中移除，是否继续？",
      confirmText: "删除",
      danger: true
    });
    if (!ok) return;
    removeAsset(assetId);
  };

  return (
    <section className="panel asset-panel">
      <header className="panel-header">
        <h2>人物/场景库</h2>
      </header>
      <div className="timeline-actions">
        <button className={tab === "character" ? "btn-primary" : "btn-ghost"} onClick={() => setTab("character")} type="button">
          人物
        </button>
        <button className={tab === "scene" ? "btn-primary" : "btn-ghost"} onClick={() => setTab("scene")} type="button">
          场景
        </button>
        <button className={tab === "prop" ? "btn-primary" : "btn-ghost"} onClick={() => setTab("prop")} type="button">
          道具
        </button>
        <button className={tab === "skybox" ? "btn-primary" : "btn-ghost"} onClick={() => setTab("skybox")} type="button">
          天空盒
        </button>
      </div>
      <div className="shot-batch-grid">
        <label>
          名称
          <input onChange={(event) => setName(event.target.value)} placeholder="例如：女主" type="text" value={name} />
        </label>
        <button className="btn-primary" onClick={onAdd} type="button">添加</button>
        {tab === "character" ? (
          <>
            <label>
              正视图
              <input
                onChange={(event) => setFrontPath(event.target.value)}
                placeholder="/Users/.../character_front.png"
                type="text"
                value={frontPath}
              />
            </label>
            <label>
              侧视图
              <input
                onChange={(event) => setSidePath(event.target.value)}
                placeholder="/Users/.../character_side.png"
                type="text"
                value={sidePath}
              />
            </label>
            <label>
              背视图
              <input
                onChange={(event) => setBackPath(event.target.value)}
                placeholder="/Users/.../character_back.png"
                type="text"
                value={backPath}
              />
            </label>
            <label>
              角色描述
              <textarea
                onChange={(event) => setCharacterDescription(event.target.value)}
                placeholder="例如：黑色短发，深色风衣，冷静克制，东亚女性，写实电影感"
                rows={3}
                value={characterDescription}
              />
            </label>
            <div className="timeline-actions">
              <button className="btn-ghost" disabled={busy} onClick={() => void onGenerateCharacterViews()} type="button">
                用 Comfy 生成角色三视图
              </button>
            </div>
            <label>
              音色绑定
              <input
                onChange={(event) => setVoiceProfile(event.target.value)}
                placeholder="例如：young_female_calm 或具体音色提示"
                type="text"
                value={voiceProfile}
              />
            </label>
          </>
        ) : tab === "skybox" ? (
          <>
            <label>
              场景描述
              <textarea
                onChange={(event) => setSkyboxDescription(event.target.value)}
                placeholder="例如：赛博朋克室内酒吧，霓虹灯、木质吧台、雨夜窗外反光..."
                rows={4}
                value={skyboxDescription}
              />
            </label>
            <label>
              标签（逗号分隔）
              <input
                onChange={(event) => setSkyboxTagsInput(event.target.value)}
                placeholder="室内,霓虹,夜景"
                type="text"
                value={skyboxTagsInput}
              />
            </label>
            <div className="timeline-actions">
              <button className="btn-ghost" disabled={busy} onClick={() => void onGenerateSkybox()} type="button">
                用 Comfy 生成天空盒六面
              </button>
            </div>
            {SKYBOX_FACES.map((face) => (
              <label key={face}>
                {face.toUpperCase()} 面路径
                <input
                  onChange={(event) => setSkyboxFacePaths((prev) => ({ ...prev, [face]: event.target.value }))}
                  placeholder={`/Users/.../skybox_${face}.png`}
                  type="text"
                  value={skyboxFacePaths[face] ?? ""}
                />
              </label>
            ))}
          </>
        ) : (
          <label>
            图片路径
            <input
              onChange={(event) => setFilePath(event.target.value)}
              placeholder="/Users/.../scene_or_prop.png"
              type="text"
              value={filePath}
            />
          </label>
        )}
      </div>
      <ul className="asset-list">
        {scopedAssets.map((asset) => (
          <li key={asset.id}>
            <div>
              <strong>{asset.name}</strong>
              <small>
                {asset.type === "character"
                  ? `正:${asset.characterFrontPath || "-"} | 侧:${asset.characterSidePath || "-"} | 背:${asset.characterBackPath || "-"} | 音色:${asset.voiceProfile || "-"}`
                  : asset.type === "skybox"
                    ? `标签:${(asset.skyboxTags ?? []).join("、") || "-"} | 描述:${asset.skyboxDescription || "-"}`
                  : asset.filePath}
              </small>
            </div>
            {asset.type === "character" && (
              <label>
                音色绑定
                <input
                  onChange={(event) => updateAsset(asset.id, { voiceProfile: event.target.value })}
                  placeholder="例如：young_female_calm"
                  type="text"
                  value={asset.voiceProfile ?? ""}
                />
              </label>
            )}
            {asset.type === "skybox" && (
              <div className="shot-batch-grid">
                <small>
                  六面：{SKYBOX_FACES.map((face) => `${face}:${asset.skyboxFaces?.[face] ? "✓" : "-"}`).join(" | ")}
                </small>
                <label>
                  事件作用面
                  <select
                    onChange={(event) =>
                      setEventFaceByAsset((prev) => ({ ...prev, [asset.id]: event.target.value as SkyboxFace }))
                    }
                    value={eventFaceByAsset[asset.id] ?? "front"}
                  >
                    {SKYBOX_FACES.map((face) => (
                      <option key={face} value={face}>
                        {face.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  事件描述
                  <input
                    onChange={(event) =>
                      setEventPromptByAsset((prev) => ({ ...prev, [asset.id]: event.target.value }))
                    }
                    placeholder="例如：墙上出现子弹孔和碎裂涂层"
                    type="text"
                    value={eventPromptByAsset[asset.id] ?? ""}
                  />
                </label>
                <button className="btn-ghost" disabled={busy} onClick={() => void onUpdateSkyboxFace(asset.id)} type="button">
                  更新该面
                </button>
              </div>
            )}
            <button className="btn-ghost" onClick={() => void onDelete(asset.id)} type="button">删除</button>
          </li>
        ))}
        {scopedAssets.length === 0 && <li><small>暂无条目</small></li>}
      </ul>
    </section>
  );
}
