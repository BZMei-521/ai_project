import { useEffect, useMemo, useRef, useState } from "react";
import { selectShotStartFrame, useStoryboardStore } from "../storyboard-core/store";
import type { Asset, AudioTrack, Shot } from "../storyboard-core/types";
import { pushToast } from "../ui/toastStore";
import { invokeDesktopCommand, isWebBridgeRuntime, toDesktopMediaSource } from "../platform/desktopBridge";
import {
  checkComfyModelHealth,
  concatShotVideos,
  defaultVideoGenerationMode,
  discoverComfyLocalDirs,
  discoverComfyEndpoints,
  DEFAULT_TOKEN_MAPPING,
  explainStoryboardVideoModeByMatureCase,
  extractLocalMotionPresetFromText,
  generateShotAsset,
  generateSkyboxFaces,
  inferComfyRootDir,
  inferStoryboardVideoModeByMatureCase,
  inspectVideoWorkflowLipSyncSupport,
  installSuggestedPlugins,
  inspectWorkflowDependencies,
  listComfyCheckpointOptions,
  pingComfyWithDetail,
  stripLocalMotionPresetToken,
  validateWorkflowJsonSyntax,
  validateWorkflowTemplate,
  type ComfySettings,
  type LocalMotionPreset,
  type WorkflowDependencyHint,
  type WorkflowDependencyReport,
  type SkyboxGenerationResult
} from "./comfyService";
import FISHER_WORKFLOW_OBJECT from "./presets/fisher-nextscene-v1.json";
import STORYBOARD_IMAGE_WORKFLOW_OBJECT from "./presets/storyboard-image-fisher-light-v1.json";
import STORYBOARD_IMAGE_ASSET_GUIDED_WORKFLOW_OBJECT from "./presets/storyboard-image-asset-guided-v1.json";
import CHARACTER_THREEVIEW_WORKFLOW_OBJECT from "./presets/asset-character-threeview-default.json";
import CHARACTER_MVADAPTER_WORKFLOW_OBJECT from "./presets/asset-character-mvadapter-default.json";
import SKYBOX_WORKFLOW_OBJECT from "./presets/asset-skybox-default.json";
import SKYBOX_PANORAMA_WORKFLOW_OBJECT from "./presets/asset-skybox-panorama-default.json";

const FISHER_WORKFLOW_JSON = JSON.stringify(FISHER_WORKFLOW_OBJECT);
const STORYBOARD_IMAGE_WORKFLOW_JSON = JSON.stringify(STORYBOARD_IMAGE_WORKFLOW_OBJECT);
const STORYBOARD_IMAGE_ASSET_GUIDED_WORKFLOW_JSON = JSON.stringify(STORYBOARD_IMAGE_ASSET_GUIDED_WORKFLOW_OBJECT);
const LEGACY_MIXED_STORYBOARD_WORKFLOW_ID = "90596592-7443-4610-984d-a080d1daa650";
type CharacterAssetWorkflowMode = "basic_builtin" | "advanced_multiview";
type SkyboxAssetWorkflowMode = "basic_builtin" | "advanced_panorama";
type StoryboardImageWorkflowMode = "builtin_qwen" | "mature_asset_guided";

type AssetWorkflowModeSpec = {
  label: string;
  summary: string;
  requiredNodes: string[];
  requiredModels: string[];
  recommendedPlugins: string[];
  notes: string[];
};

const DEFAULT_CHARACTER_ASSET_MODEL = "sd_xl_base_1.0.safetensors";
const DEFAULT_SKYBOX_ASSET_MODEL = "sd_xl_base_1.0.safetensors";
const DEFAULT_STORYBOARD_IMAGE_WORKFLOW_MODE: StoryboardImageWorkflowMode = "mature_asset_guided";
const DEFAULT_STORYBOARD_IMAGE_MODEL = "sd_xl_base_1.0.safetensors";
const ONE_CLICK_SD15_STORYBOARD_MODEL = "v1-5-pruned-emaonly-fp16.safetensors";
const ONE_CLICK_SD15_CHARACTER_MODEL = "v1-5-pruned-emaonly-fp16.safetensors";
const ONE_CLICK_SD15_SKYBOX_MODEL = "dreamshaper_8.safetensors";
const ONE_CLICK_SDXL_STORYBOARD_MODEL = "animagine-xl-4.0.safetensors";
const ONE_CLICK_SDXL_CHARACTER_MODEL = "animagine-xl-4.0.safetensors";
const ONE_CLICK_SDXL_SKYBOX_MODEL = "sd_xl_base_1.0.safetensors";
const CHARACTER_ASSET_MODEL_OPTIONS = [
  "v1-5-pruned-emaonly-fp16.safetensors",
  "sd_xl_base_1.0.safetensors",
  "juggernautXL_v8Rundiffusion.safetensors",
  "realisticVisionV60B1_v51VAE.safetensors",
  "animagine-xl-4.0.safetensors",
  "Qwen-Rapid-AIO-SFW-v5.safetensors"
] as const;
const SKYBOX_ASSET_MODEL_OPTIONS = [
  "sd_xl_base_1.0.safetensors",
  "architecturerealmix_v11.safetensors",
  "interiordesignsuperm_v2.safetensors",
  "dreamshaper_8.safetensors",
  "Qwen-Rapid-AIO-SFW-v5.safetensors"
] as const;
const CHARACTER_ASSET_MODEL_RECOMMEND_ORDER = [...CHARACTER_ASSET_MODEL_OPTIONS];
const SKYBOX_ASSET_MODEL_RECOMMEND_ORDER = [...SKYBOX_ASSET_MODEL_OPTIONS];
const DEFAULT_CHARACTER_ASSET_WORKFLOW_MODE: CharacterAssetWorkflowMode = "basic_builtin";
const DEFAULT_SKYBOX_ASSET_WORKFLOW_MODE: SkyboxAssetWorkflowMode = "basic_builtin";
const DEFAULT_CHARACTER_ADVANCED_VAE = "sdxl.vae.safetensors";
const DEFAULT_CHARACTER_ADVANCED_ADAPTER = "mvadapter_i2mv_sdxl_beta.safetensors";
const DEFAULT_SKYBOX_LORA = "View360.safetensors";
const CHARACTER_ADVANCED_NODE_TYPES = [
  "LdmPipelineLoader",
  "LdmVaeLoader",
  "DiffusersMVSchedulerLoader",
  "DiffusersMVModelMakeup",
  "ViewSelector",
  "DiffusersMVSampler",
  "SaveImage"
] as const;
const SKYBOX_ADVANCED_NODE_TYPES = [
  "CheckpointLoaderSimple",
  "LoraLoader",
  "Apply Circular Padding Model",
  "Apply Circular Padding VAE",
  "KSampler",
  "VAEDecode",
  "Equirectangular to Face",
  "SaveImage"
] as const;
const DEFAULT_CHARACTER_NEGATIVE_PROMPT =
  "multiple people, two people, extra person, crowd, group shot, scene background, fighting pose, weapon action, cut off body, half body, close-up crop, props blocking body, multiple angles, two angles, multi view, multiview, turnaround sheet, character sheet, contact sheet, split screen, diptych, triptych, collage, duplicated body, mirrored body, nude, naked, nsfw, underwear, lingerie, bikini, topless, shirtless, bare chest, exposed breasts, exposed nipples";
const CHARACTER_BACKGROUND_PRESET_TEXT: Record<"white" | "gray" | "studio", string> = {
  white: "纯白背景，无地面杂物，无环境叙事元素，标准设定板展示",
  gray: "中性浅灰背景，无地面杂物，无环境叙事元素，标准设定板展示",
  studio: "中性影棚背景，柔和棚拍补光，干净地面，无环境叙事元素"
};
const SKYBOX_PROMPT_PRESET_TEXT: Record<"day_exterior" | "night_exterior" | "interior", string> = {
  day_exterior: "日景外景，空间开阔，自然光明确，远中近层次清晰，适合建立镜头和动作调度",
  night_exterior: "夜景外景，夜间环境光与主光方向清晰，暗部稳定，适合夜戏镜头复用",
  interior: "室内空间，墙面/门窗/家具结构明确，光源位置稳定，适合对白和调度镜头复用"
};
const SKYBOX_NEGATIVE_PRESET_TEXT: Record<"day_exterior" | "night_exterior" | "interior", string> = {
  day_exterior:
    "person, people, character, crowd, group shot, portrait, close-up, actor, animal, fighting, action pose, silhouette, dialogue scene, stage performance, poster, signage with faces",
  night_exterior:
    "person, people, character, crowd, group shot, portrait, close-up, actor, animal, fighting, action pose, silhouette, dialogue scene, car interior, neon character signage, stage light performer",
  interior:
    "person, people, character, crowd, group shot, portrait, close-up, actor, animal, fighting, action pose, silhouette, dialogue scene, mirror reflection of people, television host, poster portrait"
};
const DEFAULT_SKYBOX_NEGATIVE_PROMPT = SKYBOX_NEGATIVE_PRESET_TEXT.day_exterior;
const CHARACTER_RENDER_PRESET_CONFIG: Record<
  "stable_fullbody" | "clean_reference",
  { label: string; seed: number; steps: number; cfg: number; sampler_name: string; scheduler: string }
> = {
  stable_fullbody: {
    label: "稳定全身",
    seed: 101001,
    steps: 28,
    cfg: 5.5,
    sampler_name: "euler",
    scheduler: "normal"
  },
  clean_reference: {
    label: "干净设定",
    seed: 202002,
    steps: 32,
    cfg: 6,
    sampler_name: "dpmpp_2m",
    scheduler: "karras"
  }
};
const CHARACTER_VIEW_HASH_SIZE = 8;
const CHARACTER_VIEW_DUPLICATE_HAMMING_THRESHOLD = 8;

function isLegacyMixedStoryboardImageWorkflow(workflowJson: string): boolean {
  const normalized = workflowJson.replace(/\s+/g, "");
  if (!normalized) return false;
  return (
    normalized.includes(LEGACY_MIXED_STORYBOARD_WORKFLOW_ID) &&
    normalized.includes("WanMoeKSampler") &&
    normalized.includes("TextEncodeQwenImageEditPlusAdvance_lrzjason")
  );
}

function buildCharacterAssetModeSpec(mode: CharacterAssetWorkflowMode, selectedModel: string): AssetWorkflowModeSpec {
  if (mode === "advanced_multiview") {
    return {
      label: "高级多视角角色工作流",
      summary:
        "推荐用 ComfyUI-MVAdapter 做 image-to-multi-view，一次从单张参考图稳定产出 front/right/back，而不是三次独立 txt2img。",
      requiredNodes: [
        "ComfyUI-MVAdapter 节点组（Diffusers Model Makeup / MV-Adapter / View Selector 等）",
        "主模型加载节点（CheckpointLoaderSimple 或 Diffusers 模型加载节点）",
        "文本编码节点（CLIPTextEncode 或等价节点）",
        "视角选择节点（front / right / back 或 front / left / back）",
        "单张图片输出节点（SaveImage / PreviewImage）"
      ],
      requiredModels: [
        `主模型：${selectedModel}`,
        "MV-Adapter 权重：mvadapter_i2mv_sdxl.safetensors（推荐）或 mvadapter_i2mv_sdxl_beta.safetensors",
        "VAE：sdxl.vae.safetensors（推荐）",
        "可选：OpenPose/Depth ControlNet，用于后续单张修姿"
      ],
      recommendedPlugins: ["ComfyUI-MVAdapter", "可选：ComfyUI-Advanced-ControlNet"],
      notes: [
        "当前项目已内置一套基于 MVAdapter i2mv 的高级模板，可直接写入。",
        "高级模式会先生成一张正面参考图，再用 MVAdapter 生成 front / side / back。",
        "高级模板已强制使用方形分辨率（square token grid），避免 MVAdapter 在非方形尺寸下触发 einops rearrange 报错。",
        "MV-Adapter 官方仓库明确支持 text/image-to-multi-view，并支持视角选择与 ControlNet 集成。",
        "目标是标准 front / side / back 视角一致性，而不是三次独立随机出图。"
      ]
    };
  }
  return {
    label: "基础正交三视图模板",
    summary: "内置纯文生图模板，按 front / side / back 三次单独调用。适合先跑通标准设定板，但一致性依赖提示词和固定 seed。",
    requiredNodes: [
      "CheckpointLoaderSimple",
      "CLIPTextEncode",
      "EmptyLatentImage",
      "KSampler",
      "VAEDecode",
      "SaveImage"
    ],
    requiredModels: [`主模型：${selectedModel}`],
    recommendedPlugins: [],
    notes: [
      "不依赖 LoadImage、视频节点或音频节点。",
      "适合没有多视角插件时先做标准 front / side / back 设定图。"
    ]
  };
}

function buildSkyboxAssetModeSpec(mode: SkyboxAssetWorkflowMode, selectedModel: string): AssetWorkflowModeSpec {
  if (mode === "advanced_panorama") {
    return {
      label: "高级全景转六面工作流",
      summary:
        "推荐先用 SDXL + 360Redmond 生成 2:1 equirectangular panorama，再用 ComfyUI_pytorch360convert 拆 front/right/back/left/up/down。",
      requiredNodes: [
        "主模型加载节点（CheckpointLoaderSimple 或等价节点）",
        "LoRA 加载节点（加载 360Redmond 一类全景 LoRA）",
        "文本编码节点（CLIPTextEncode 或等价节点）",
        "全景修缝节点（E2E / Roll Image / Create Seam Mask，来自 pytorch360convert）",
        "cubemap 六面拆分节点（E2C / E2Face，来自 pytorch360convert）",
        "单张图片输出节点（SaveImage / PreviewImage）"
      ],
      requiredModels: [
        `主模型：${selectedModel}`,
        "全景 LoRA：360Redmond（基于 SDXL 1.0）",
        "可选：放大模型 / Inpaint 模型，用于接缝修复"
      ],
      recommendedPlugins: ["ComfyUI_pytorch360convert", "可选：ComfyUI_preview360panorama"],
      notes: [
        "当前项目已内置一套 Panorama -> 六面拆分模板，可直接写入。",
        "高级模式会先生成一张 2:1 全景，再拆成 front/right/back/left/up/down。",
        "360Redmond 模型卡明确建议先生成 1600x800 的 2:1 全景，再做放大。",
        "目标是先得到连贯全景，再拆成 front/right/back/left/up/down 六面。"
      ]
    };
  }
  return {
    label: "基础六次文生图模板",
    summary: "内置纯文生图模板，按 front / right / back / left / up / down 六次单独调用。适合先跑通纯环境参考，但不是真正的全景转 cubemap。",
    requiredNodes: [
      "CheckpointLoaderSimple",
      "CLIPTextEncode",
      "EmptyLatentImage",
      "KSampler",
      "VAEDecode",
      "SaveImage"
    ],
    requiredModels: [`主模型：${selectedModel}`],
    recommendedPlugins: [],
    notes: [
      "不依赖人物参考链和视频/音频节点。",
      "更适合先建立纯环境资产，后续可再升级为全景转六面工作流。"
    ]
  };
}

function workflowLooksLikeBuiltinStoryboardImageWorkflow(workflowJson: string): boolean {
  const normalized = workflowJson.replace(/\s+/g, "");
  if (!normalized) return false;
  return (
    normalized.includes("\"id\":\"storyboard-image-fisher-light-v1\"") ||
    normalized.includes("TextEncodeQwenImageEditPlusAdvance_lrzjason") ||
    normalized.includes("PowerLoraLoader") ||
    normalized.includes("easypromptLine")
  );
}

function buildStoryboardImageModeSpec(mode: StoryboardImageWorkflowMode): AssetWorkflowModeSpec {
  if (mode === "mature_asset_guided") {
    return {
      label: "成熟资产约束分镜工作流",
      summary:
        "内置模板改成 scene-first img2img + IPAdapter 多角色一致性。先锁天空盒主面，再叠角色参考，是当前更成熟、更可控的连续分镜基础链路；ControlNet / InstantID / PuLID 作为第二层增强可再加。",
      requiredNodes: [
        "基础图生图链：CheckpointLoaderSimple / LoadImage / ImageScale / VAEEncode / KSampler / VAEDecode / SaveImage",
        "IPAdapterUnifiedLoader",
        "IPAdapterAdvanced"
      ],
      requiredModels: [
        "主模型：建议 SDXL 写实底模",
        "IPAdapter Plus：自动走 PLUS 预设，对应 SDXL 需 ip-adapter-plus_sdxl_vit-h.safetensors",
        "CLIP Vision：clip_vision_h.safetensors"
      ],
      recommendedPlugins: [
        "comfyui_ipadapter_plus",
        "可选：ComfyUI-Advanced-ControlNet",
        "可选：ComfyUI_InstantID 或 PuLID_ComfyUI"
      ],
      notes: [
        "内置成熟模板已经是 scene-first：先吃天空盒主面/场景底图，再叠角色参考。",
        "双人/远景镜头会自动降低角色权重、提高场景保持；单人镜头会提高主角色权重。",
        "如果还需要更硬的姿态/构图控制，再在这套模板外层加 ControlNet；当前内置 Qwen 模板只保留兼容用途。"
      ]
    };
  }
  return {
    label: "兼容内置 Qwen 分镜模板",
    summary: "内置 Qwen/Fisher 模板便于快速出图，但对角色三视图和天空盒的绑定能力有限，只适合作为兼容兜底。",
    requiredNodes: [
      "TextEncodeQwenImageEditPlusAdvance_lrzjason",
      "CheckpointLoaderSimple",
      "KSampler",
      "VAEDecode",
      "SaveImage"
    ],
    requiredModels: ["Qwen-Rapid-AIO-SFW-v5.safetensors（或同类兼容底模）"],
    recommendedPlugins: ["qweneditutils", "rgthree-comfy", "ComfyUI-KJNodes（部分模板）"],
    notes: [
      "优点是现成可跑，缺点是参考图约束弱。",
      "高一致性项目不建议继续依赖此模式。"
    ]
  };
}

function buildAssetIssueSummary(args: {
  kind: "character" | "skybox";
  mode: CharacterAssetWorkflowMode | SkyboxAssetWorkflowMode;
  modeSpec: AssetWorkflowModeSpec;
  workflowConfigured: boolean;
  strictMode: boolean;
  selectedModel: string;
  modelVisible: boolean | null;
  diagnostic: AssetWorkflowDiagnostic | null;
}): string[] {
  const lines: string[] = [];
  const label = args.kind === "character" ? "角色三视图" : "天空盒";
  if (
    ((args.kind === "character" && args.mode === "advanced_multiview") ||
      (args.kind === "skybox" && args.mode === "advanced_panorama")) &&
    !args.workflowConfigured
  ) {
    lines.push(`${label}当前已切到高级资产模式，但尚未配置专用工作流 JSON。`);
  }
  if (args.strictMode && !args.workflowConfigured) {
    lines.push(`${label}严格资产模式已开启，未配置专用工作流时正式生成会被拦截。`);
  }
  if (args.modelVisible === false) {
    lines.push(`${label}当前选中模型未出现在 Comfy checkpoint 下拉：${args.selectedModel}`);
  }
  if (args.diagnostic?.templateValid === false && args.diagnostic.templateMissing.length > 0) {
    lines.push(`${label}工作流缺少 token：${args.diagnostic.templateMissing.join("、")}`);
  }
  if (args.diagnostic?.dependencyReport?.missingNodeTypes.length) {
    lines.push(`${label}缺失节点：${args.diagnostic.dependencyReport.missingNodeTypes.join("、")}`);
  }
  if (args.diagnostic?.modeSpec.recommendedPlugins.length) {
    lines.push(`${label}推荐插件：${args.diagnostic.modeSpec.recommendedPlugins.join("、")}`);
  }
  if (lines.length === 0) {
    lines.push(`${label}当前模式：${args.modeSpec.label}。当前没有阻塞项。`);
  }
  return lines;
}
const loadExportService = () => import("../export-service/animaticExport");

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function pickFirstAvailableModel(preferred: readonly string[], available: string[]): string | null {
  for (const name of preferred) {
    if (available.includes(name)) return name;
  }
  return available[0] ?? null;
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
    template["4"].inputs.width = preset === "square" ? 1024 : 832;
    template["4"].inputs.height = preset === "square" ? 1024 : 1216;
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
  checkpointName: string,
  preset: "portrait" | "square",
  renderPreset: "stable_fullbody" | "clean_reference"
): string {
  const template = cloneJson(CHARACTER_MVADAPTER_WORKFLOW_OBJECT) as Record<string, { inputs?: Record<string, unknown> }>;
  if (template["1"]?.inputs) {
    template["1"].inputs.ckpt_name = checkpointName;
  }
  if (template["3"]?.inputs) {
    template["3"].inputs.vae_name = DEFAULT_CHARACTER_ADVANCED_VAE;
  }
  if (template["4"]?.inputs) {
    template["4"].inputs.num_views = 1;
    template["4"].inputs.adapter_name = DEFAULT_CHARACTER_ADVANCED_ADAPTER;
  }
  if (template["7"]?.inputs) {
    const config = CHARACTER_RENDER_PRESET_CONFIG[renderPreset];
    // MVAdapter self-attention assumes square token grids (ih == iw).
    // Non-square sizes like 832x1216 can trigger einops rearrange failures.
    const side = preset === "square" ? 1024 : 896;
    template["7"].inputs.num_views = 1;
    template["7"].inputs.width = side;
    template["7"].inputs.height = side;
    template["7"].inputs.steps = config.steps;
    template["7"].inputs.cfg = config.cfg;
  }
  return JSON.stringify(template, null, 2);
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


function pickCheckpointFromWorkflowJson(workflowJson: string): string {
  const text = workflowJson.trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (Array.isArray((parsed as { nodes?: unknown }).nodes)) {
      return "";
    }
    for (const entry of Object.values(parsed)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const node = entry as Record<string, unknown>;
      if (String(node.class_type ?? "") !== "CheckpointLoaderSimple") continue;
      const ckpt = (node.inputs as Record<string, unknown> | undefined)?.ckpt_name;
      if (typeof ckpt === "string" && ckpt.trim()) return ckpt.trim();
    }
    return "";
  } catch {
    return "";
  }
}

function buildEmergencyStoryboardImageWorkflowTemplateJson(checkpointName: string, width: number, height: number): string {
  const safeWidth = Math.max(256, Math.round(width / 64) * 64);
  const safeHeight = Math.max(256, Math.round(height / 64) * 64);
  const template: Record<string, { inputs: Record<string, unknown>; class_type: string }> = {
    "1": {
      inputs: { ckpt_name: checkpointName },
      class_type: "CheckpointLoaderSimple"
    },
    "2": {
      inputs: { text: "{{PROMPT}}", clip: ["1", 1] },
      class_type: "CLIPTextEncode"
    },
    "3": {
      inputs: { text: "{{NEGATIVE_PROMPT}}", clip: ["1", 1] },
      class_type: "CLIPTextEncode"
    },
    "4": {
      inputs: { width: safeWidth, height: safeHeight, batch_size: 1 },
      class_type: "EmptyLatentImage"
    },
    "5": {
      inputs: {
        seed: "{{SEED}}",
        steps: 28,
        cfg: 5.5,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0]
      },
      class_type: "KSampler"
    },
    "6": {
      inputs: { samples: ["5", 0], vae: ["1", 2] },
      class_type: "VAEDecode"
    },
    "7": {
      inputs: { filename_prefix: "Storyboard/shot_fallback", images: ["6", 0] },
      class_type: "SaveImage"
    }
  };
  return JSON.stringify(template, null, 2);
}

function mergePromptFragments(parts: Array<string | null | undefined>): string {
  return parts
    .map((item) => item?.trim() ?? "")
    .filter((item) => item.length > 0)
    .join("，");
}

function appendNegativePrompt(base: string, extras: string[]): string {
  const normalized = base
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const seen = new Set(normalized.map((item) => item.toLowerCase()));
  for (const extra of extras) {
    const item = extra.trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
  }
  return normalized.join(", ");
}

type GenerationPhase = "idle" | "running";
type AssetStatus = "idle" | "running" | "success" | "failed";
type PipelineLogLevel = "info" | "error";

type PipelineLogItem = {
  id: number;
  timestamp: string;
  level: PipelineLogLevel;
  message: string;
};

type ProvisionPreviewItem = {
  key: string;
  kind: "character" | "skybox";
  name: string;
  status: "pending" | "running" | "success" | "reused" | "failed" | "skipped";
  detail: string;
  thumbs: string[];
};

type ProvisionCreateResult = {
  assetId: string;
  previewPaths: string[];
};

type ShotReferencePreview = {
  characters: Array<{ id: string; name: string; thumbs: string[]; views: string[] }>;
  scene?: { id: string; name: string; thumbs: string[]; faces: string[] };
};

type SoundCueKind = "ambience" | "character" | "prop";
type SoundCueSpec = {
  kind: SoundCueKind;
  prompt: string;
  gain: number;
};

type DialogueSegment = {
  speaker: string;
  text: string;
  voiceProfile: string;
  emotion: string;
  deliveryStyle: string;
  speechRate: string;
};

type ParsedScriptShot = {
  id: string;
  title: string;
  prompt: string;
  negative_prompt: string;
  video_prompt: string;
  video_mode: "auto" | "single_frame" | "first_last_frame";
  duration_sec: number;
  dialogue: string;
  notes: string;
  tags: string[];
  character_names?: string[];
  scene_name?: string;
  scene_prompt?: string;
};

type AssetWorkflowHeuristicReport = {
  warnings: string[];
  notes: string[];
};

type AssetWorkflowDiagnostic = {
  kind: "character" | "skybox" | "storyboard";
  mode: CharacterAssetWorkflowMode | SkyboxAssetWorkflowMode | StoryboardImageWorkflowMode;
  modeSpec: AssetWorkflowModeSpec;
  workflowConfigured: boolean;
  strictMode: boolean;
  selectedModel: string;
  modelVisible: boolean | null;
  templateValid: boolean;
  templateMissing: string[];
  usedTokens: string[];
  dependencyReport: WorkflowDependencyReport | null;
  heuristic: AssetWorkflowHeuristicReport;
};

const SETTINGS_KEY = "storyboard-pro/comfy-settings/v1";
const IMPORT_PRESETS_KEY = "storyboard-pro/import-provision-presets/v1";
const IMPORT_PRESET_AUTO_APPLY_KEY = "storyboard-pro/import-provision-presets/auto-apply";

type ImportProvisionPreset = {
  id: string;
  name: string;
  note: string;
  scope: "all" | "characters" | "skyboxes";
  pinned: boolean;
  updatedAt: number;
  lastUsedAt: number;
  characterOverrides: Record<string, string>;
  skyboxOverrides: Record<string, string>;
};
const LOCAL_MOTION_PRESET_OPTIONS: Array<{ value: LocalMotionPreset; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "still", label: "静帧" },
  { value: "fade", label: "淡入淡出" },
  { value: "push_in", label: "推近" },
  { value: "push_out", label: "推远" },
  { value: "pan_left", label: "左移" },
  { value: "pan_right", label: "右移" }
];

function normalizeStoryInput(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/\u3000/g, " ").trim();
}

function splitStorySentences(raw: string): string[] {
  return normalizeStoryInput(raw)
    .split(/(?<=[。！？!?；;])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function splitStoryBlocks(raw: string): Array<{ heading: string; body: string }> {
  const text = normalizeStoryInput(raw);
  if (!text) return [];
  const lines = text.split("\n").map((line) => line.trim());
  const headingPattern = /^(?:镜头|shot|scene|场景)\s*[\d一二三四五六七八九十]*[:：.\-、\s]*/i;
  const numberedPattern = /^\d+\s*[.)、．]\s*/;
  const blocks: Array<{ heading: string; body: string }> = [];
  let currentHeading = "";
  let currentLines: string[] = [];

  const flush = () => {
    const body = currentLines.join("\n").trim();
    if (!body) return;
    blocks.push({ heading: currentHeading.trim(), body });
    currentHeading = "";
    currentLines = [];
  };

  for (const line of lines) {
    if (!line) {
      if (currentLines.length > 0) {
        currentLines.push("");
      } else {
        flush();
      }
      continue;
    }
    const isHeading = headingPattern.test(line) || numberedPattern.test(line);
    if (isHeading && currentLines.length > 0) {
      flush();
    }
    if (isHeading) {
      currentHeading = line.replace(headingPattern, "").replace(numberedPattern, "").trim();
      continue;
    }
    currentLines.push(line);
  }
  flush();

  const nonEmpty = blocks.filter((item) => item.body.trim().length > 0);
  if (nonEmpty.length > 1) return nonEmpty;

  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (paragraphs.length > 1) {
    return paragraphs.map((body, index) => ({ heading: `段落 ${index + 1}`, body }));
  }

  const sentences = splitStorySentences(text);
  if (sentences.length <= 3) return [{ heading: "段落 1", body: text }];

  const grouped: Array<{ heading: string; body: string }> = [];
  for (let index = 0; index < sentences.length; index += 3) {
    grouped.push({
      heading: `段落 ${grouped.length + 1}`,
      body: sentences.slice(index, index + 3).join("")
    });
  }
  return grouped;
}

function extractDialogueLines(raw: string): string[] {
  return normalizeStoryInput(raw)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /[:：]/.test(line) || /[“"].+[”"]/.test(line));
}

function stripDialogueLines(raw: string): string {
  return normalizeStoryInput(raw)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/[:：]/.test(line))
    .join(" ");
}

function inferShotScale(text: string, index: number, total: number): string {
  if (/特写|细节|表情|眼神|手部|嘴角|指尖/.test(text)) return "特写";
  if (/远处|全貌|整体|街道|建筑|河边|天空|外景/.test(text)) return "大全景";
  if (/对话|交谈|面对面|并肩|两人|多人/.test(text)) return "中景";
  if (index === 0 && total > 1) return "建立镜头";
  if (index === total - 1 && total > 1) return "近景收束";
  return "中近景";
}

function inferShotTitle(text: string, heading: string, index: number, total: number): string {
  if (heading && heading !== `段落 ${index + 1}`) return heading;
  if (/对话|说道|问道|回答|看着.*说|[:：]/.test(text)) return total > 1 && index === 0 ? "对话开场" : "对话推进";
  if (/走|跑|转身|打开|进入|离开|抬手|放下|靠近|远离/.test(text)) return total > 1 && index === 0 ? "动作起势" : "动作推进";
  if (index === 0) return "开场建立";
  if (index === total - 1) return "情绪收束";
  return `叙事镜头 ${index + 1}`;
}

function inferShotTags(text: string, dialogue: string): string[] {
  const tags = new Set<string>();
  if (/夜|黑夜|凌晨|月光/.test(text)) tags.add("夜景");
  if (/清晨|早晨|黎明|日出/.test(text)) tags.add("晨景");
  if (/室内|房间|客厅|门厅|走廊|楼梯/.test(text)) tags.add("室内");
  if (/街道|河边|庭院|广场|外景|天空/.test(text)) tags.add("外景");
  if (dialogue.trim()) tags.add("对白");
  if (/走|跑|转身|推门|开门|抬手|进入|离开/.test(text)) tags.add("动作");
  return [...tags];
}

function inferDurationSec(text: string, dialogue: string): number {
  const length = text.length + dialogue.length;
  if (dialogue.trim()) return Math.min(6, Math.max(3, Math.round(length / 28)));
  if (length <= 40) return 2;
  if (length <= 90) return 3;
  if (length <= 160) return 4;
  return 5;
}

function chunkNarrationForShots(text: string, dialogue: string): string[] {
  const narration = stripDialogueLines(text) || normalizeStoryInput(text);
  const sentences = splitStorySentences(narration);
  if (sentences.length <= 2 || dialogue.trim()) {
    return [narration.trim()];
  }
  const chunkSize = sentences.length >= 6 ? 3 : 2;
  const chunks: string[] = [];
  for (let index = 0; index < sentences.length; index += chunkSize) {
    chunks.push(sentences.slice(index, index + chunkSize).join(""));
  }
  return chunks.filter((item) => item.trim().length > 0);
}

function splitDialogueTurns(raw: string): Array<{ speaker: string; text: string }> {
  return extractDialogueLines(raw)
    .map((line) => {
      const parsed = matchSpeakerLine(line);
      if (parsed) {
        return {
          speaker: parsed.speaker.trim(),
          text: parsed.text.trim()
        };
      }
      return {
        speaker: "",
        text: line.trim()
      };
    })
    .filter((item) => item.text.length > 0);
}

function normalizeEntityKey(value: string): string {
  return value.replace(/\s+/g, "").replace(/[【】[\]（）()《》"'“”‘’]/g, "").trim().toLowerCase();
}

function uniqueEntities(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalizeEntityKey(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

const CHARACTER_ROLE_HINTS = [
  "女主",
  "男主",
  "主角",
  "女孩",
  "男孩",
  "女人",
  "男人",
  "老人",
  "孩子",
  "母亲",
  "父亲",
  "警察",
  "医生",
  "司机",
  "服务员",
  "老板",
  "记者",
  "老师",
  "学生"
];

const GENERIC_CHARACTER_LABELS = new Set([
  "主体",
  "角色",
  "人物",
  "主角",
  "配角",
  "路人",
  "群像",
  "镜头",
  "动作",
  "场景",
  "环境",
  "美术",
  "构图",
  "光线",
  "光影",
  "色调",
  "机位",
  "景别",
  "画面",
  "提示词",
  "备注"
]);

const GENERIC_SCENE_LABELS = new Set([
  "主体",
  "角色",
  "人物",
  "动作",
  "镜头",
  "美术",
  "构图",
  "光线",
  "光影",
  "色调",
  "机位",
  "景别",
  "画面",
  "场景",
  "环境",
  "地点",
  "提示词",
  "备注"
]);

function sanitizeCharacterCandidate(value: string): string {
  const trimmed = value
    .trim()
    .replace(/^[\[【(（]\s*/, "")
    .replace(/[\]】)）]\s*$/, "")
    .replace(/^(主体|角色|人物|主角|配角|场景|环境|动作|镜头|美术|构图|光线|光影|色调|机位|景别|画面|提示词|备注)\s*[:：]\s*/g, "")
    .replace(/\s+/g, "");
  if (!trimmed) return "";
  if (GENERIC_CHARACTER_LABELS.has(trimmed)) return "";
  if (/[，。；、,.!！?？]/.test(trimmed)) return "";
  if (trimmed.length > 8) return "";
  return trimmed;
}

function sanitizeSceneCandidate(value: string): string {
  let trimmed = value
    .trim()
    .replace(/^[\[【(（]\s*/, "")
    .replace(/[\]】)）]\s*$/, "")
    .replace(/^(主体|角色|人物|主角|场景|环境|地点|动作|镜头|美术|构图|光线|光影|色调|机位|景别|画面|提示词|备注)\s*[:：]\s*/g, "")
    .replace(/\s+/g, "");
  const locationVariants = Array.from(
    trimmed.matchAll(
      /(清晨|傍晚|夜晚|黄昏|白天|夜里|雨夜|雪夜)?(河边|桥上|街道|巷子|庭院|门厅|走廊|楼梯|房间|客厅|卧室|办公室|教室|酒吧|餐厅|咖啡馆|车内|车站|天台|仓库)/g
    )
  )
    .map((match) => `${match[1] ?? ""}${match[2] ?? ""}`.trim())
    .filter(Boolean);
  if (locationVariants.length > 0 && locationVariants[locationVariants.length - 1]!.length <= trimmed.length) {
    trimmed = locationVariants[locationVariants.length - 1]!;
  }
  const locationSuffix = /(河边|桥上|街道|巷子|庭院|门厅|走廊|楼梯|房间|客厅|卧室|办公室|教室|酒吧|餐厅|咖啡馆|车内|车站|天台|仓库)$/;
  if (locationSuffix.test(trimmed)) {
    const markers = ["站在", "走到", "来到", "进入", "到", "于", "在"];
    for (const marker of markers) {
      const markerIndex = trimmed.lastIndexOf(marker);
      if (markerIndex >= 0) {
        const candidate = trimmed.slice(markerIndex + marker.length).trim();
        if (locationSuffix.test(candidate)) {
          trimmed = candidate;
          break;
        }
      }
    }
  }
  if (!trimmed) return "";
  if (GENERIC_SCENE_LABELS.has(trimmed)) return "";
  if (trimmed.length > 24) return "";
  return trimmed;
}

function isSuspiciousCharacterCandidate(value: string): boolean {
  const name = sanitizeCharacterCandidate(value);
  if (!name) return true;
  if (GENERIC_CHARACTER_LABELS.has(name)) return true;
  if (/(河边|走廊|门厅|房间|卧室|客厅|街道|巷子|庭院|办公室|教室|酒吧|餐厅|咖啡馆|车内|车站|天台|仓库)$/.test(name)) {
    return true;
  }
  if (/(主体|场景|环境|动作|镜头|构图|美术|光线|景别|机位)/.test(name)) return true;
  if (name.length > 6) return true;
  if (/(与|和).+(在|于)/.test(name)) return true;
  return false;
}

function isSuspiciousSceneCandidate(value: string): boolean {
  const name = sanitizeSceneCandidate(value);
  if (!name) return true;
  if (GENERIC_SCENE_LABELS.has(name)) return true;
  if (/(主体|角色|人物|动作|镜头|构图|美术|光线|景别|机位)/.test(name)) return true;
  return false;
}

function extractCharacterCandidates(text: string): string[] {
  const explicitCandidates: string[] = [];
  const roleCandidates: string[] = [];
  const dialogueTurns = splitDialogueTurns(text);
  for (const item of dialogueTurns) {
    if (item.speaker && !/旁白|内心|心声|独白|narration|voice[- ]?over|vo/i.test(item.speaker)) {
      explicitCandidates.push(item.speaker);
    }
  }
  for (const label of CHARACTER_ROLE_HINTS) {
    if (text.includes(label)) roleCandidates.push(label);
  }
  const nameMatches = text.match(/[\u4e00-\u9fa5]{2,4}(?=说|问|答|看向|转身|走向|站在|坐在)/g) ?? [];
  explicitCandidates.push(...nameMatches);
  const normalizedExplicit = uniqueEntities(explicitCandidates.map(sanitizeCharacterCandidate).filter(Boolean));
  if (normalizedExplicit.length > 0) return normalizedExplicit;
  return uniqueEntities(roleCandidates.map(sanitizeCharacterCandidate).filter(Boolean));
}

const SCENE_TIME_QUALIFIER_PATTERN =
  "(清晨|凌晨|黎明|早晨|早上|上午|中午|午后|下午|傍晚|黄昏|暮色|夜晚|夜里|夜间|深夜|午夜|白天|日间|雨夜|雪夜)";

function stripSceneTemporalQualifier(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  let normalized = raw;
  const prefixPattern = new RegExp(`^(?:${SCENE_TIME_QUALIFIER_PATTERN})(?:时分|时候|阶段)?(?:的)?`, "g");
  const suffixPattern = new RegExp(`(?:的)?(?:${SCENE_TIME_QUALIFIER_PATTERN})(?:时分|时候|阶段|氛围|版本|版|景)?$`, "g");
  normalized = normalized.replace(prefixPattern, "");
  normalized = normalized.replace(suffixPattern, "");
  normalized = normalized.replace(/^[-_，,。·\s]+|[-_，,。·\s]+$/g, "");
  return normalized || raw;
}

function canonicalAssetName(type: "character" | "scene" | "skybox", value: string): string {
  let normalized = normalizeEntityKey(value);
  if (type === "character") {
    normalized = normalized
      .replace(/^(角色|人物|主角)/, "")
      .replace(/(角色|人物|主角|形象|设定图|三视图)$/g, "");
  } else {
    normalized = normalized
      .replace(/^(场景|环境|地点)/, "")
      .replace(/(场景|场景图|环境图|设定图)$/g, "");
    normalized = stripSceneTemporalQualifier(normalized);
  }
  return normalized.trim();
}

function computeAssetNameScore(type: "character" | "scene" | "skybox", input: string, candidate: string): number {
  const a = canonicalAssetName(type, input);
  const b = canonicalAssetName(type, candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  const charsA = new Set(a.split(""));
  const charsB = new Set(b.split(""));
  let overlap = 0;
  for (const char of charsA) {
    if (charsB.has(char)) overlap += 1;
  }
  return overlap / Math.max(charsA.size, charsB.size);
}

function findMatchingAssetId(
  assets: Asset[],
  type: "character" | "scene" | "skybox",
  name: string
): string {
  const sourceName = name.trim();
  if (!sourceName) return "";
  const allAssets = assets.filter((asset) => asset.type === type);
  const exact = allAssets.find((asset) => canonicalAssetName(type, asset.name) === canonicalAssetName(type, sourceName));
  if (exact) return exact.id;
  const scored = allAssets
    .map((asset) => ({
      id: asset.id,
      score: computeAssetNameScore(type, sourceName, asset.name)
    }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const threshold = type === "character" ? 0.72 : 0.58;
  return best && best.score >= threshold ? best.id : "";
}

function summarizeAssetProvisionPlan(
  assets: Asset[],
  items: Array<{ characterNames: string[]; sceneName: string }>
): {
  reusedCharacters: string[];
  newCharacters: string[];
  reusedSkyboxes: string[];
  newSkyboxes: string[];
} {
  const characterNames = uniqueEntities(items.flatMap((item) => item.characterNames));
  const sceneNames = uniqueEntities(items.map((item) => item.sceneName).filter(Boolean));
  const reusedCharacters: string[] = [];
  const newCharacters: string[] = [];
  const reusedSkyboxes: string[] = [];
  const newSkyboxes: string[] = [];

  for (const name of characterNames) {
    if (findMatchingAssetId(assets, "character", name)) {
      reusedCharacters.push(name);
    } else {
      newCharacters.push(name);
    }
  }
  for (const name of sceneNames) {
    if (findMatchingAssetId(assets, "skybox", name)) {
      reusedSkyboxes.push(name);
    } else {
      newSkyboxes.push(name);
    }
  }

  return {
    reusedCharacters,
    newCharacters,
    reusedSkyboxes,
    newSkyboxes
  };
}

type AssetProvisionChoice = {
  key: string;
  name: string;
  matchedAssetId: string;
  matchedAssetName: string;
};

function listAssetProvisionChoices(
  assets: Asset[],
  items: Array<{ characterNames: string[]; sceneName: string }>
): {
  characters: AssetProvisionChoice[];
  skyboxes: AssetProvisionChoice[];
} {
  const characterNames = uniqueEntities(items.flatMap((item) => item.characterNames));
  const sceneNames = uniqueEntities(items.map((item) => item.sceneName).filter(Boolean));
  return {
    characters: characterNames.map((name) => {
      const matchedAssetId = findMatchingAssetId(assets, "character", name);
      const matchedAssetName = assets.find((asset) => asset.id === matchedAssetId)?.name ?? "";
      return {
        key: normalizeEntityKey(name),
        name,
        matchedAssetId,
        matchedAssetName
      };
    }),
    skyboxes: sceneNames.map((name) => {
      const matchedAssetId = findMatchingAssetId(assets, "skybox", name);
      const matchedAssetName = assets.find((asset) => asset.id === matchedAssetId)?.name ?? "";
      return {
        key: normalizeEntityKey(name),
        name,
        matchedAssetId,
        matchedAssetName
      };
    })
  };
}

function inferSceneName(text: string): string {
  const patterns = [
    /(?:在|来到|走到|进入|站在)([^，。；\n]{2,16}?(?:河边|桥上|街道|巷子|庭院|门厅|走廊|楼梯|房间|客厅|卧室|办公室|教室|酒吧|餐厅|咖啡馆|车内|车站|天台|仓库))/,
    /([^，。；\n]{2,16}?(?:河边|桥上|街道|巷子|庭院|门厅|走廊|楼梯|房间|客厅|卧室|办公室|教室|酒吧|餐厅|咖啡馆|车内|车站|天台|仓库))/,
    /(?:外景|室内)[：: ]?([^，。；\n]{2,16})/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = sanitizeSceneCandidate(match?.[1]?.trim() ?? "");
    if (value) return value;
  }
  if (/河边/.test(text)) return "河边";
  if (/走廊/.test(text)) return "走廊";
  if (/门厅/.test(text)) return "门厅";
  if (/房间|卧室|客厅/.test(text)) return "室内房间";
  if (/街道|巷子/.test(text)) return "街道";
  if (/庭院/.test(text)) return "庭院";
  return "";
}

function stripCharacterMentions(text: string, names: string[]): string {
  let output = normalizeStoryInput(text).replace(/\n+/g, " ").trim();
  for (const name of names) {
    const safe = name.trim();
    if (!safe) continue;
    output = output.split(safe).join("");
  }
  output = output
    .replace(/(女主|男主|主角|配角|角色|人物)\s*/g, "")
    .replace(/\s+/g, " ")
    .replace(/[，,]{2,}/g, "，")
    .trim();
  return output;
}

function buildScenePrompt(text: string, sceneName: string, characterNames: string[] = []): string {
  const clean = stripCharacterMentions(text, characterNames);
  const sceneLabel = sceneName.trim() || "该场景";
  return `${sceneLabel} 场景设定图，无人物，环境一致，材质统一，空间关系清晰。${clean}`;
}

function buildStoryShotPrompt(text: string, scale: string): string {
  const clean = normalizeStoryInput(text).replace(/\n+/g, " ").trim();
  return `${clean}。电影分镜，${scale}，主体明确，环境连续，镜头语言清晰，光影自然，构图稳定。`;
}

function buildStoryVideoPrompt(text: string): string {
  if (/走|跑|转身|抬手|放下|靠近|远离|打开|进入|离开/.test(text)) {
    return `${normalizeStoryInput(text)}。主体产生连续动作，镜头保持平稳推进。`;
  }
  return `${normalizeStoryInput(text)}。主体有轻微呼吸感动作，镜头稳定。`;
}

function inferVideoModeForStory(text: string, dialogue: string): "auto" | "single_frame" | "first_last_frame" {
  return inferStoryboardVideoModeByMatureCase(text, dialogue, { preferAutoWhenAmbiguous: true });
}

function explainShotVideoMode(shot: Shot): string {
  if (shot.videoMode === "single_frame") {
    return "当前手动指定为单帧图生视频。适合对白、反应、特写和轻动作镜头。";
  }
  if (shot.videoMode === "first_last_frame") {
    return "当前手动指定为首尾帧生成视频。适合有明确起点和终点变化的动作或转场镜头。";
  }
  const explanation = explainStoryboardVideoModeByMatureCase(
    [shot.storyPrompt ?? "", shot.videoPrompt ?? "", shot.notes ?? "", ...(shot.tags ?? [])].join(" "),
    shot.dialogue ?? "",
    { preferAutoWhenAmbiguous: true }
  );
  const label =
    explanation.mode === "first_last_frame"
      ? "自动建议：首尾帧生成视频。"
      : explanation.mode === "single_frame"
        ? "自动建议：单帧图生视频。"
        : "自动建议：暂未命中强规则。";
  return `${label}${explanation.reason}`;
}

function inferDialogueShotTitle(speaker: string, index: number, total: number): string {
  if (speaker) {
    if (total === 1) return `${speaker} 对白`;
    if (index === 0) return `${speaker} 起话`;
    if (index === total - 1) return `${speaker} 收尾`;
    return `${speaker} 反应`;
  }
  return total === 1 ? "对白镜头" : `对白镜头 ${index + 1}`;
}

function buildDialogueShotPrompt(context: string, speaker: string, line: string): string {
  const speakerPart = speaker ? `角色 ${speaker}` : "角色";
  const normalizedContext = normalizeStoryInput(context).replace(/\n+/g, " ").trim();
  return `${normalizedContext}。${speakerPart} 说：“${line}”。电影对白分镜，中近景或近景，人物表情清晰，视线关系明确，镜头稳定，光影自然。`;
}

function parseStoryToShotScript(raw: string): { shots: ParsedScriptShot[] } {
  const blocks = splitStoryBlocks(raw);
  if (blocks.length === 0) {
    throw new Error("故事内容为空");
  }
  const shots: ParsedScriptShot[] = [];
  let shotIndex = 1;
  for (const block of blocks) {
    const characterNames = extractCharacterCandidates(block.body);
    const sceneName = inferSceneName(block.body);
    const scenePrompt = sceneName ? buildScenePrompt(block.body, sceneName, characterNames) : "";
    const dialogueLines = splitDialogueTurns(block.body);
    const dialogue = dialogueLines.map((item) => (item.speaker ? `${item.speaker}: ${item.text}` : item.text)).join("\n");
    const chunks = chunkNarrationForShots(block.body, dialogue);
    const shouldSplitDialogueShots = dialogueLines.length >= 2;

    chunks.forEach((chunk, chunkIndex) => {
      const scale = inferShotScale(chunk, chunkIndex, chunks.length);
      const title = inferShotTitle(chunk, block.heading, chunkIndex, chunks.length);
      const prompt = buildStoryShotPrompt(chunk, scale);
      const videoPrompt = buildStoryVideoPrompt(chunk);
      shots.push({
        id: `story_shot_${shotIndex}`,
        title,
        prompt,
        negative_prompt: "",
        video_prompt: videoPrompt,
        video_mode: inferVideoModeForStory(chunk, shouldSplitDialogueShots ? "" : chunkIndex === 0 ? dialogue : ""),
        duration_sec: inferDurationSec(chunk, shouldSplitDialogueShots ? "" : chunkIndex === 0 ? dialogue : ""),
        dialogue: shouldSplitDialogueShots ? "" : chunkIndex === 0 ? dialogue : "",
        notes: normalizeStoryInput(chunk),
        tags: inferShotTags(chunk, shouldSplitDialogueShots ? "" : chunkIndex === 0 ? dialogue : ""),
        character_names: characterNames,
        scene_name: sceneName || undefined,
        scene_prompt: scenePrompt || undefined
      });
      shotIndex += 1;
    });

    if (shouldSplitDialogueShots) {
      const narrationContext = stripDialogueLines(block.body) || block.body;
      dialogueLines.forEach((item, dialogueIndex) => {
        const text = item.text.trim();
        const title = inferDialogueShotTitle(item.speaker, dialogueIndex, dialogueLines.length);
        const prompt = buildDialogueShotPrompt(narrationContext, item.speaker, text);
        shots.push({
          id: `story_shot_${shotIndex}`,
          title,
          prompt,
          negative_prompt: "",
          video_prompt: `${normalizeStoryInput(text)}。对白镜头，人物保持轻微表情和视线变化。`,
          video_mode: inferVideoModeForStory("", text),
          duration_sec: inferDurationSec("", text),
          dialogue: item.speaker ? `${item.speaker}: ${text}` : text,
          notes: normalizeStoryInput(narrationContext),
          tags: inferShotTags(narrationContext, text),
          character_names: uniqueEntities([item.speaker, ...characterNames]),
          scene_name: sceneName || undefined,
          scene_prompt: scenePrompt || undefined
        });
        shotIndex += 1;
      });
    }
  }
  return { shots };
}

function withLocalMotionToken(prompt: string, preset: LocalMotionPreset): string {
  const base = stripLocalMotionPresetToken(prompt).trim();
  if (preset === "auto") return base;
  return base ? `${base}\n[motion:${preset}]` : `[motion:${preset}]`;
}

function collectWorkflowNodeTypesForHeuristics(workflowJson: string): string[] {
  try {
    const parsed = JSON.parse(workflowJson) as Record<string, unknown>;
    if (Array.isArray((parsed as { nodes?: unknown }).nodes)) {
      return ((parsed as { nodes: Array<{ type?: unknown }> }).nodes ?? [])
        .map((node) => String(node.type ?? "").trim())
        .filter(Boolean);
    }
    return Object.values(parsed)
      .map((entry) =>
        entry && typeof entry === "object" && "class_type" in (entry as Record<string, unknown>)
          ? String((entry as Record<string, unknown>).class_type ?? "").trim()
          : ""
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

function workflowHasBrokenApiPromptReferences(workflowJson: string): boolean {
  try {
    const parsed = JSON.parse(workflowJson) as Record<string, unknown>;
    if (Array.isArray((parsed as { nodes?: unknown }).nodes)) return false;
    const nodeIds = new Set(
      Object.entries(parsed)
        .filter(([, entry]) => entry && typeof entry === "object" && "class_type" in (entry as Record<string, unknown>))
        .map(([key]) => String(key))
    );
    for (const entry of Object.values(parsed)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const node = entry as Record<string, unknown>;
      const inputs = node.inputs;
      if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) continue;
      for (const value of Object.values(inputs as Record<string, unknown>)) {
        if (!Array.isArray(value) || value.length < 2) continue;
        const refNodeId = value[0];
        if (typeof refNodeId !== "string" && typeof refNodeId !== "number") continue;
        if (!nodeIds.has(String(refNodeId))) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function workflowIncludesAllNodeTypes(workflowJson: string, requiredNodeTypes: readonly string[]): boolean {
  const nodeTypes = new Set(collectWorkflowNodeTypesForHeuristics(workflowJson));
  return requiredNodeTypes.every((item) => nodeTypes.has(item));
}

function workflowLooksLikeLegacyBasicAssetWorkflow(workflowJson: string, kind: "character" | "skybox"): boolean {
  const trimmed = workflowJson.trim();
  if (!trimmed) return false;
  const nodeTypes = new Set(collectWorkflowNodeTypesForHeuristics(trimmed));
  const hasBasicCore =
    nodeTypes.has("CheckpointLoaderSimple") &&
    nodeTypes.has("CLIPTextEncode") &&
    nodeTypes.has("EmptyLatentImage") &&
    nodeTypes.has("KSampler") &&
    nodeTypes.has("VAEDecode") &&
    nodeTypes.has("SaveImage");
  if (!hasBasicCore) return false;
  const hasAdvancedCharacterNode = CHARACTER_ADVANCED_NODE_TYPES.some((item) => nodeTypes.has(item));
  const hasAdvancedSkyboxNode = SKYBOX_ADVANCED_NODE_TYPES.some(
    (item) => item !== "CheckpointLoaderSimple" && item !== "KSampler" && item !== "VAEDecode" && item !== "SaveImage" && nodeTypes.has(item)
  );
  if (kind === "character" && hasAdvancedCharacterNode) return false;
  if (kind === "skybox" && hasAdvancedSkyboxNode) return false;
  const legacyPrefix = kind === "character" ? "Storyboard/character_threeview" : "Storyboard/skybox";
  return trimmed.includes(legacyPrefix);
}

function resolveEffectiveAssetWorkflowMode(
  kind: "character" | "skybox",
  mode: CharacterAssetWorkflowMode | SkyboxAssetWorkflowMode,
  workflowJson: string
): CharacterAssetWorkflowMode | SkyboxAssetWorkflowMode {
  // Respect user-selected mode directly. Workflow content mismatch is handled by shouldAutoRewriteAssetWorkflow.
  return mode;
}

function shouldAutoRewriteAssetWorkflow(
  workflowJson: string,
  mode: CharacterAssetWorkflowMode | SkyboxAssetWorkflowMode,
  kind: "character" | "skybox"
): boolean {
  const trimmed = workflowJson.trim();
  if (!trimmed) return true;
  if (workflowHasBrokenApiPromptReferences(trimmed)) return true;
  const nodeTypes = new Set(collectWorkflowNodeTypesForHeuristics(trimmed));
  const hasBasicImageCore =
    nodeTypes.has("CheckpointLoaderSimple") &&
    nodeTypes.has("CLIPTextEncode") &&
    nodeTypes.has("EmptyLatentImage") &&
    nodeTypes.has("KSampler") &&
    nodeTypes.has("VAEDecode") &&
    nodeTypes.has("SaveImage");
  const hasAllAdvancedCharacterViewTokens = [
    "{{FRAME_IMAGE_PATH}}",
    "{{CHARACTER_FRONT_VIEW}}",
    "{{CHARACTER_RIGHT_VIEW}}",
    "{{CHARACTER_BACK_VIEW}}"
  ].every((token) => trimmed.includes(token));
  const hasAdvancedCharacterNode = ["LdmPipelineLoader", "DiffusersMVModelMakeup", "ViewSelector", "DiffusersMVSampler"].some((type) =>
    nodeTypes.has(type)
  );
  const hasAdvancedSkyboxNode = ["LoraLoader", "Equirectangular to Face", "Apply Circular Padding Model", "Apply Circular Padding VAE"].some(
    (type) => nodeTypes.has(type)
  );
  if (kind === "character" && mode === "advanced_multiview") {
    return (
      !workflowIncludesAllNodeTypes(trimmed, CHARACTER_ADVANCED_NODE_TYPES) ||
      !hasAllAdvancedCharacterViewTokens ||
      trimmed.includes("\"num_views\": 6") ||
      trimmed.includes("\"width\": 832") ||
      trimmed.includes("\"height\": 1216")
    );
  }
  if (kind === "character" && mode === "basic_builtin") {
    return hasAdvancedCharacterNode || !hasBasicImageCore || !workflowLooksLikeLegacyBasicAssetWorkflow(trimmed, "character");
  }
  if (kind === "skybox" && mode === "advanced_panorama") {
    return !workflowIncludesAllNodeTypes(trimmed, SKYBOX_ADVANCED_NODE_TYPES);
  }
  if (kind === "skybox" && mode === "basic_builtin") {
    return hasAdvancedSkyboxNode || !hasBasicImageCore || !workflowLooksLikeLegacyBasicAssetWorkflow(trimmed, "skybox");
  }
  return false;
}

function inspectAssetWorkflowHeuristics(
  workflowJson: string,
  kind: "character" | "skybox"
): AssetWorkflowHeuristicReport {
  const nodeTypes = collectWorkflowNodeTypesForHeuristics(workflowJson);
  const warnings: string[] = [];
  const notes: string[] = [];
  const hasFixedLoadImage = nodeTypes.includes("LoadImage");
  const usesFrameImageToken = workflowJson.includes("{{FRAME_IMAGE_PATH}}");
  const hasVideoNode = nodeTypes.some((type) => /VideoCombine|VFI|WanImageToVideo|FrameInterpolation|RIFE/i.test(type));
  const hasAudioNode = nodeTypes.some((type) => /Audio|TTS|Whisper|EdgeTTS/i.test(type));
  const hasImageOutput = nodeTypes.some((type) => /SaveImage|PreviewImage/i.test(type));

  if (hasFixedLoadImage && !usesFrameImageToken) {
    warnings.push("检测到固定 LoadImage 节点。资产工作流不应依赖模板内写死的参考图。");
  } else if (hasFixedLoadImage && usesFrameImageToken) {
    notes.push("检测到 LoadImage + {{FRAME_IMAGE_PATH}}，说明该模板会在运行时动态喂参考图。");
  }
  if (hasVideoNode) {
    warnings.push("检测到视频相关节点。角色三视图/天空盒工作流应该只输出单张图片。");
  }
  if (hasAudioNode) {
    warnings.push("检测到音频相关节点。资产工作流不应包含配音或音效节点。");
  }
  if (!hasImageOutput) {
    notes.push("未检测到明显的 SaveImage/PreviewImage 节点，请确认工作流最终会产出图片。");
  }
  if (kind === "character") {
    notes.push("角色三视图会按 正/侧/背 三次单独调用工作流。每次必须只输出一个角色的一张角度图。");
  } else {
    notes.push("天空盒会按六个面分别调用工作流。每次必须只输出纯环境图，不允许出现人物。");
  }
  return { warnings, notes };
}

function inspectStoryboardWorkflowHeuristics(workflowJson: string): AssetWorkflowHeuristicReport {
  const nodeTypes = collectWorkflowNodeTypesForHeuristics(workflowJson);
  const warnings: string[] = [];
  const notes: string[] = [];
  const hasLoadImage = nodeTypes.includes("LoadImage");
  const hasVaeEncode = nodeTypes.includes("VAEEncode");
  const hasIpAdapter = nodeTypes.some((type) => /IPAdapter/i.test(type));
  const hasControlNet = nodeTypes.some((type) => /ControlNet/i.test(type));
  const hasInstantId = nodeTypes.some((type) => /InstantID/i.test(type));
  const hasPulid = nodeTypes.some((type) => /PuLID/i.test(type));
  const hasQwenTemplateNode = nodeTypes.some((type) => /Qwen|ImageEditPlus|promptLine/i.test(type));
  const usesSceneToken = workflowJson.includes("{{SCENE_REF_PATH}}");
  const usesCharacterToken =
    workflowJson.includes("{{CHAR1_PRIMARY_PATH}}") || workflowJson.includes("{{CHARACTER_FRONT_PATHS}}");

  if (hasQwenTemplateNode) {
    warnings.push("检测到 Qwen/Fisher 图编辑节点。高一致性分镜不建议继续把它作为主链路。");
  }
  if (!hasLoadImage || !usesSceneToken) {
    warnings.push("未检测到场景底图注入（LoadImage + {{SCENE_REF_PATH}}）。场景一致性会明显变弱。");
  }
  if (!hasVaeEncode) {
    warnings.push("未检测到 VAEEncode。scene-first img2img 链路通常应先把天空盒主面编码为 latent 再低 denoise 重绘。");
  }
  if (!hasIpAdapter || !usesCharacterToken) {
    warnings.push("未检测到角色 IPAdapter 参考注入。人物一致性会明显变弱。");
  }
  if (!nodeTypes.some((type) => /SaveImage|PreviewImage/i.test(type))) {
    warnings.push("未检测到明显图片输出节点，请确认工作流最终会产出分镜图。");
  }
  notes.push("成熟分镜模板的核心顺序应是：场景底图优先，角色参考其次，文本只补镜头动作和构图。");
  if (hasControlNet) notes.push("检测到 ControlNet，可用于第二阶段增强姿态或空间稳定性。");
  if (hasInstantId || hasPulid) notes.push("检测到 InstantID / PuLID，可用于正脸镜头进一步锁脸。");
  return { warnings, notes };
}

function loadSettings(): ComfySettings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    return {
      baseUrl: "http://127.0.0.1:8188",
      outputDir: "",
      comfyInputDir: "",
      comfyRootDir: "",
      imageWorkflowJson: STORYBOARD_IMAGE_ASSET_GUIDED_WORKFLOW_JSON,
      storyboardImageWorkflowMode: DEFAULT_STORYBOARD_IMAGE_WORKFLOW_MODE,
      storyboardImageModelName: DEFAULT_STORYBOARD_IMAGE_MODEL,
      videoWorkflowJson: FISHER_WORKFLOW_JSON,
      characterWorkflowJson: "",
      skyboxWorkflowJson: "",
      characterAssetWorkflowMode: DEFAULT_CHARACTER_ASSET_WORKFLOW_MODE,
      skyboxAssetWorkflowMode: DEFAULT_SKYBOX_ASSET_WORKFLOW_MODE,
      requireDedicatedCharacterWorkflow: true,
      requireDedicatedSkyboxWorkflow: true,
      characterAssetModelName: DEFAULT_CHARACTER_ASSET_MODEL,
      skyboxAssetModelName: DEFAULT_SKYBOX_ASSET_MODEL,
      characterTemplatePreset: "portrait",
      characterRenderPreset: "stable_fullbody",
      characterBackgroundPreset: "gray",
      skyboxTemplatePreset: "wide",
      skyboxPromptPreset: "day_exterior",
      skyboxNegativePreset: "day_exterior",
      characterAssetNegativePrompt: DEFAULT_CHARACTER_NEGATIVE_PROMPT,
      skyboxAssetNegativePrompt: DEFAULT_SKYBOX_NEGATIVE_PROMPT,
      audioWorkflowJson: "",
      soundWorkflowJson: "",
      globalVisualStylePrompt: "",
      globalStyleNegativePrompt: "",
      videoGenerationMode: defaultVideoGenerationMode(),
      tokenMapping: { ...DEFAULT_TOKEN_MAPPING }
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ComfySettings>;
    const parsedCharacterWorkflowJson =
      typeof parsed.characterWorkflowJson === "string" ? parsed.characterWorkflowJson : "";
    const parsedSkyboxWorkflowJson =
      typeof parsed.skyboxWorkflowJson === "string" ? parsed.skyboxWorkflowJson : "";
    const resolvedCharacterMode = resolveEffectiveAssetWorkflowMode(
      "character",
      parsed.characterAssetWorkflowMode === "advanced_multiview" || parsed.characterAssetWorkflowMode === "basic_builtin"
        ? parsed.characterAssetWorkflowMode
        : DEFAULT_CHARACTER_ASSET_WORKFLOW_MODE,
      parsedCharacterWorkflowJson
    ) as CharacterAssetWorkflowMode;
    const resolvedSkyboxMode = resolveEffectiveAssetWorkflowMode(
      "skybox",
      parsed.skyboxAssetWorkflowMode === "advanced_panorama" || parsed.skyboxAssetWorkflowMode === "basic_builtin"
        ? parsed.skyboxAssetWorkflowMode
        : DEFAULT_SKYBOX_ASSET_WORKFLOW_MODE,
      parsedSkyboxWorkflowJson
    ) as SkyboxAssetWorkflowMode;
    const shouldUpgradeCharacterMode = resolvedCharacterMode === "advanced_multiview" && parsed.characterAssetWorkflowMode !== "advanced_multiview";
    const shouldUpgradeSkyboxMode = resolvedSkyboxMode === "advanced_panorama" && parsed.skyboxAssetWorkflowMode !== "advanced_panorama";
    const resolvedStoryboardMode =
      parsed.storyboardImageWorkflowMode === "builtin_qwen" || parsed.storyboardImageWorkflowMode === "mature_asset_guided"
        ? parsed.storyboardImageWorkflowMode
        : DEFAULT_STORYBOARD_IMAGE_WORKFLOW_MODE;
    const effectiveCharacterMode = resolvedCharacterMode;
    const parsedImageWorkflowJson = typeof parsed.imageWorkflowJson === "string" ? parsed.imageWorkflowJson : "";
    const shouldUpgradeStoryboardWorkflow =
      resolvedStoryboardMode === "mature_asset_guided" &&
      (!parsedImageWorkflowJson.trim() ||
        isLegacyMixedStoryboardImageWorkflow(parsedImageWorkflowJson) ||
        workflowLooksLikeBuiltinStoryboardImageWorkflow(parsedImageWorkflowJson));
    const resolvedImageWorkflowJson =
      shouldUpgradeStoryboardWorkflow
        ? STORYBOARD_IMAGE_ASSET_GUIDED_WORKFLOW_JSON
        : parsedImageWorkflowJson.trim().length > 0
          ? parsedImageWorkflowJson
          : resolvedStoryboardMode === "mature_asset_guided"
            ? STORYBOARD_IMAGE_ASSET_GUIDED_WORKFLOW_JSON
            : STORYBOARD_IMAGE_WORKFLOW_JSON;
    const resolvedVideoWorkflowJson =
      typeof parsed.videoWorkflowJson === "string" && parsed.videoWorkflowJson.trim().length > 0
        ? parsed.videoWorkflowJson
        : FISHER_WORKFLOW_JSON;
    const shouldResetCharacterWorkflowJson = shouldUpgradeCharacterMode;
    return {
      baseUrl: parsed.baseUrl ?? "http://127.0.0.1:8188",
      outputDir: parsed.outputDir ?? "",
      comfyInputDir: parsed.comfyInputDir ?? "",
      comfyRootDir: parsed.comfyRootDir ?? "",
      imageWorkflowJson: resolvedImageWorkflowJson,
      storyboardImageWorkflowMode: resolvedStoryboardMode,
      storyboardImageModelName:
        typeof parsed.storyboardImageModelName === "string" && parsed.storyboardImageModelName.trim()
          ? parsed.storyboardImageModelName.trim()
          : DEFAULT_STORYBOARD_IMAGE_MODEL,
      videoWorkflowJson: resolvedVideoWorkflowJson,
      characterWorkflowJson: shouldResetCharacterWorkflowJson ? "" : parsedCharacterWorkflowJson,
      skyboxWorkflowJson: shouldUpgradeSkyboxMode ? "" : parsedSkyboxWorkflowJson,
      characterAssetWorkflowMode: effectiveCharacterMode,
      skyboxAssetWorkflowMode: resolvedSkyboxMode,
      requireDedicatedCharacterWorkflow:
        typeof parsed.requireDedicatedCharacterWorkflow === "boolean" ? parsed.requireDedicatedCharacterWorkflow : true,
      requireDedicatedSkyboxWorkflow:
        typeof parsed.requireDedicatedSkyboxWorkflow === "boolean" ? parsed.requireDedicatedSkyboxWorkflow : true,
      characterAssetModelName:
        typeof parsed.characterAssetModelName === "string" && parsed.characterAssetModelName.trim()
          ? parsed.characterAssetModelName.trim()
          : DEFAULT_CHARACTER_ASSET_MODEL,
      skyboxAssetModelName:
        typeof parsed.skyboxAssetModelName === "string" && parsed.skyboxAssetModelName.trim()
          ? parsed.skyboxAssetModelName.trim()
          : DEFAULT_SKYBOX_ASSET_MODEL,
      characterTemplatePreset:
        parsed.characterTemplatePreset === "square" || parsed.characterTemplatePreset === "portrait"
          ? parsed.characterTemplatePreset
          : "portrait",
      characterRenderPreset:
        parsed.characterRenderPreset === "clean_reference" || parsed.characterRenderPreset === "stable_fullbody"
          ? parsed.characterRenderPreset
          : "stable_fullbody",
      characterBackgroundPreset:
        parsed.characterBackgroundPreset === "white" ||
        parsed.characterBackgroundPreset === "studio" ||
        parsed.characterBackgroundPreset === "gray"
          ? parsed.characterBackgroundPreset
          : "gray",
      skyboxTemplatePreset:
        parsed.skyboxTemplatePreset === "square" || parsed.skyboxTemplatePreset === "wide"
          ? parsed.skyboxTemplatePreset
          : "wide",
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
      skyboxAssetNegativePrompt:
        typeof parsed.skyboxAssetNegativePrompt === "string"
          ? parsed.skyboxAssetNegativePrompt
          : DEFAULT_SKYBOX_NEGATIVE_PROMPT,
      audioWorkflowJson: typeof parsed.audioWorkflowJson === "string" ? parsed.audioWorkflowJson : "",
      soundWorkflowJson: typeof parsed.soundWorkflowJson === "string" ? parsed.soundWorkflowJson : "",
      globalVisualStylePrompt:
        typeof parsed.globalVisualStylePrompt === "string" ? parsed.globalVisualStylePrompt : "",
      globalStyleNegativePrompt:
        typeof parsed.globalStyleNegativePrompt === "string" ? parsed.globalStyleNegativePrompt : "",
      videoGenerationMode: parsed.videoGenerationMode ?? defaultVideoGenerationMode(),
      tokenMapping: {
        ...DEFAULT_TOKEN_MAPPING,
        ...(parsed.tokenMapping ?? {})
      }
    };
  } catch {
    return {
      baseUrl: "http://127.0.0.1:8188",
      outputDir: "",
      comfyInputDir: "",
      comfyRootDir: "",
      imageWorkflowJson: STORYBOARD_IMAGE_ASSET_GUIDED_WORKFLOW_JSON,
      storyboardImageWorkflowMode: DEFAULT_STORYBOARD_IMAGE_WORKFLOW_MODE,
      storyboardImageModelName: DEFAULT_STORYBOARD_IMAGE_MODEL,
      videoWorkflowJson: FISHER_WORKFLOW_JSON,
      characterWorkflowJson: "",
      skyboxWorkflowJson: "",
      characterAssetWorkflowMode: DEFAULT_CHARACTER_ASSET_WORKFLOW_MODE,
      skyboxAssetWorkflowMode: DEFAULT_SKYBOX_ASSET_WORKFLOW_MODE,
      requireDedicatedCharacterWorkflow: true,
      requireDedicatedSkyboxWorkflow: true,
      characterAssetModelName: DEFAULT_CHARACTER_ASSET_MODEL,
      skyboxAssetModelName: DEFAULT_SKYBOX_ASSET_MODEL,
      characterTemplatePreset: "portrait",
      characterRenderPreset: "stable_fullbody",
      characterBackgroundPreset: "gray",
      skyboxTemplatePreset: "wide",
      skyboxPromptPreset: "day_exterior",
      skyboxNegativePreset: "day_exterior",
      characterAssetNegativePrompt: DEFAULT_CHARACTER_NEGATIVE_PROMPT,
      skyboxAssetNegativePrompt: DEFAULT_SKYBOX_NEGATIVE_PROMPT,
      audioWorkflowJson: "",
      soundWorkflowJson: "",
      globalVisualStylePrompt: "",
      globalStyleNegativePrompt: "",
      videoGenerationMode: defaultVideoGenerationMode(),
      tokenMapping: { ...DEFAULT_TOKEN_MAPPING }
    };
  }
}

function loadImportPresets(): ImportProvisionPreset[] {
  const raw = localStorage.getItem(IMPORT_PRESETS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ImportProvisionPreset[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.name === "string" && typeof item.id === "string")
      .map((item) => ({
        id: item.id,
        name: item.name,
        note: typeof item.note === "string" ? item.note : "",
        scope:
          item.scope === "characters" || item.scope === "skyboxes" || item.scope === "all"
            ? item.scope
            : "all",
        pinned: item.pinned === true,
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : 0,
        lastUsedAt: typeof item.lastUsedAt === "number" ? item.lastUsedAt : 0,
        characterOverrides:
          item.characterOverrides && typeof item.characterOverrides === "object" ? item.characterOverrides : {},
        skyboxOverrides:
          item.skyboxOverrides && typeof item.skyboxOverrides === "object" ? item.skyboxOverrides : {}
      }));
  } catch {
    return [];
  }
}

function persistImportPresets(presets: ImportProvisionPreset[]): void {
  localStorage.setItem(IMPORT_PRESETS_KEY, JSON.stringify(presets));
}

function loadImportPresetAutoApply(): boolean {
  return localStorage.getItem(IMPORT_PRESET_AUTO_APPLY_KEY) === "1";
}

function formatImportPresetScope(scope: ImportProvisionPreset["scope"]): string {
  if (scope === "characters") return "仅角色";
  if (scope === "skyboxes") return "仅天空盒";
  return "全量";
}

function summarizeImportPreset(preset: ImportProvisionPreset): string {
  const characterCount = Object.keys(preset.characterOverrides).length;
  const skyboxCount = Object.keys(preset.skyboxOverrides).length;
  return `角色 ${characterCount} / 天空盒 ${skyboxCount}`;
}

function sortImportPresets(items: ImportProvisionPreset[]): ImportProvisionPreset[] {
  return [...items].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    if (left.lastUsedAt !== right.lastUsedAt) return right.lastUsedAt - left.lastUsedAt;
    if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
    return left.name.localeCompare(right.name, "zh-Hans-CN");
  });
}

function normalizeImportPresetRecords(raw: unknown): ImportProvisionPreset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const record = item as Partial<ImportProvisionPreset>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      return {
        id:
          typeof record.id === "string" && record.id.trim().length > 0
            ? record.id
            : `import_preset_${Date.now()}_${index}`,
        name,
        note: typeof record.note === "string" ? record.note.trim() : "",
        scope:
          record.scope === "characters" || record.scope === "skyboxes" || record.scope === "all"
            ? record.scope
            : "all",
        pinned: record.pinned === true,
        updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
        lastUsedAt: typeof record.lastUsedAt === "number" ? record.lastUsedAt : 0,
        characterOverrides:
          record.characterOverrides && typeof record.characterOverrides === "object"
            ? (record.characterOverrides as Record<string, string>)
            : {},
        skyboxOverrides:
          record.skyboxOverrides && typeof record.skyboxOverrides === "object"
            ? (record.skyboxOverrides as Record<string, string>)
            : {}
      };
    })
    .filter((item) => item.name.length > 0);
}

function formatAssetStatus(status: AssetStatus): string {
  if (status === "running") return "生成中";
  if (status === "success") return "成功";
  if (status === "failed") return "失败";
  return "待生成";
}

function resolveShotReferencePreview(shot: Shot, assets: Asset[]): ShotReferencePreview {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const characterAssets = assets.filter((asset) => asset.type === "character");
  const skyboxAssets = assets.filter((asset) => asset.type === "skybox");
  const context = compactTextParts(
    shot.title,
    shot.storyPrompt,
    shot.notes,
    shot.dialogue,
    shot.sourceCharacterNames?.join("、"),
    shot.sourceSceneName
  );
  const matchedCharacterIds = uniqueEntities([
    ...(shot.characterRefs ?? []).filter((id) => assetById.get(id)?.type === "character"),
    ...(shot.sourceCharacterNames ?? [])
      .map((name) => findMatchingAssetId(assets, "character", name))
      .filter(Boolean),
    ...extractCharacterCandidates(context)
      .map((name) => findMatchingAssetId(assets, "character", name))
      .filter(Boolean),
    ...characterAssets
      .filter((asset) => context.includes(asset.name))
      .map((asset) => asset.id)
  ]);
  if (matchedCharacterIds.length === 0 && shotLooksCharacterDriven(shot) && characterAssets.length > 0 && characterAssets.length <= 2) {
    matchedCharacterIds.push(...characterAssets.map((asset) => asset.id));
  }
  const dedupCharacterAssets: Asset[] = [];
  const seenCharacterNameKeys = new Set<string>();
  for (const id of matchedCharacterIds) {
    const asset = assets.find((item) => item.id === id && item.type === "character");
    if (!asset) continue;
    const nameKey = normalizeEntityKey(asset.name || asset.id);
    if (nameKey && seenCharacterNameKeys.has(nameKey)) continue;
    if (nameKey) seenCharacterNameKeys.add(nameKey);
    dedupCharacterAssets.push(asset);
  }
  const characters = dedupCharacterAssets.map((asset) => {
    const thumbs = [asset.characterFrontPath, asset.characterSidePath, asset.characterBackPath].filter(
      (item): item is string => Boolean(item?.trim())
    );
    const views = [
      asset.characterFrontPath?.trim() ? "front" : "",
      asset.characterSidePath?.trim() ? "side" : "",
      asset.characterBackPath?.trim() ? "back" : ""
    ].filter((item) => item.length > 0);
    return { id: asset.id, name: asset.name, thumbs, views };
  });
  const inferredSceneName = sanitizeSceneCandidate(shot.sourceSceneName?.trim() || inferSceneName(context));
  const resolvedSceneId =
    (shot.sceneRefId?.trim() &&
    assets.some((item) => item.id === shot.sceneRefId && (item.type === "scene" || item.type === "skybox"))
      ? shot.sceneRefId
      : "") ||
    (inferredSceneName ? findMatchingAssetId(assets, "skybox", inferredSceneName) : "") ||
    (skyboxAssets.length === 1 ? skyboxAssets[0]?.id ?? "" : "");
  const sceneAsset = assets.find(
    (item) => item.id === resolvedSceneId && (item.type === "scene" || item.type === "skybox")
  );
  if (!sceneAsset) return { characters };
  if (sceneAsset.type === "skybox") {
    const faceOrder = [
      ...(shot.skyboxFaces ?? []),
      "front",
      "right",
      "back",
      "left",
      "up",
      "down"
    ].filter((face, index, list) => list.indexOf(face) === index);
    const thumbs = faceOrder
      .map((face) => sceneAsset.skyboxFaces?.[face as keyof NonNullable<Asset["skyboxFaces"]>] ?? "")
      .filter((item): item is string => Boolean(item.trim()));
    const faces = faceOrder.filter(
      (face) => Boolean(sceneAsset.skyboxFaces?.[face as keyof NonNullable<Asset["skyboxFaces"]>]?.trim())
    );
    return {
      characters,
      scene: { id: sceneAsset.id, name: sceneAsset.name, thumbs, faces }
    };
  }
  return {
    characters,
    scene: {
      id: sceneAsset.id,
      name: sceneAsset.name,
      thumbs: sceneAsset.filePath?.trim() ? [sceneAsset.filePath] : [],
      faces: []
    }
  };
}

function describeShotReferencePreview(preview: ShotReferencePreview): string {
  const parts: string[] = [];
  if (preview.characters.length > 0) {
    parts.push(
      `角色 ${preview.characters
        .map((item) => `${item.name}${item.views.length > 0 ? `(${item.views.join("/")})` : ""}`)
        .join("、")}`
    );
  }
  if (preview.scene) {
    parts.push(
      `场景 ${preview.scene.name}${preview.scene.faces.length > 0 ? `(${preview.scene.faces.join("/")})` : ""}`
    );
  }
  return parts.length > 0 ? parts.join("；") : "未绑定角色三视图或天空盒";
}

function shotLooksCharacterDriven(shot: Shot): boolean {
  const corpus = compactTextParts(
    shot.title,
    shot.storyPrompt,
    shot.notes,
    shot.dialogue,
    shot.tags.join("、"),
    shot.sourceCharacterNames?.join("、")
  );
  return (
    Boolean(shot.dialogue.trim()) ||
    (shot.characterRefs?.length ?? 0) > 0 ||
    (shot.sourceCharacterNames?.length ?? 0) > 0 ||
    /人物|角色|对白|对峙|挥拳|冲拳|出拳|闪避|反击|回头|看向|转身|走向|逼近|交手|fight|punch|kick|dodge|duel|face[- ]?off/i.test(corpus)
  );
}

function deriveShotBindingRepairs(
  shots: Shot[],
  assets: Asset[]
): {
  patches: Array<{ shotId: string; fields: { characterRefs: string[]; sceneRefId: string } }>;
  repairedCharacterShots: number;
  repairedSceneShots: number;
} {
  const characterAssets = assets.filter((asset) => asset.type === "character");
  const skyboxAssets = assets.filter((asset) => asset.type === "skybox");
  const skyboxCanonicalPrimaryMap = new Map<string, string>();
  for (const asset of skyboxAssets) {
    const canonicalKey = canonicalAssetName("skybox", asset.name);
    if (!canonicalKey || skyboxCanonicalPrimaryMap.has(canonicalKey)) continue;
    skyboxCanonicalPrimaryMap.set(canonicalKey, asset.id);
  }
  const normalizeSceneRefId = (sceneRefId?: string): string => {
    const raw = sceneRefId?.trim() ?? "";
    if (!raw) return "";
    const asset = assets.find((item) => item.id === raw && (item.type === "scene" || item.type === "skybox"));
    if (!asset) return "";
    if (asset.type !== "skybox") return raw;
    const canonicalKey = canonicalAssetName("skybox", asset.name);
    if (!canonicalKey) return raw;
    return skyboxCanonicalPrimaryMap.get(canonicalKey) ?? raw;
  };
  const patches: Array<{ shotId: string; fields: { characterRefs: string[]; sceneRefId: string } }> = [];
  let repairedCharacterShots = 0;
  let repairedSceneShots = 0;

  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index]!;
    const previousShot = index > 0 ? shots[index - 1] : undefined;
    const context = compactTextParts(
      shot.title,
      shot.storyPrompt,
      shot.notes,
      shot.dialogue,
      shot.sourceCharacterNames?.join("、"),
      shot.sourceSceneName
    );

    const nextCharacterRefs = uniqueEntities([
      ...(shot.characterRefs ?? []).filter((id) => assets.some((asset) => asset.id === id && asset.type === "character")),
      ...(shot.sourceCharacterNames ?? [])
        .map((name) => findMatchingAssetId(assets, "character", name))
        .filter(Boolean),
      ...extractCharacterCandidates(context)
        .map((name) => findMatchingAssetId(assets, "character", name))
        .filter(Boolean),
      ...characterAssets
        .filter((asset) => context.includes(asset.name))
        .map((asset) => asset.id)
    ]);

    if (nextCharacterRefs.length === 0 && shotLooksCharacterDriven(shot)) {
      if ((previousShot?.characterRefs?.length ?? 0) > 0) {
        nextCharacterRefs.push(...(previousShot?.characterRefs ?? []));
      } else if (characterAssets.length > 0 && characterAssets.length <= 2) {
        nextCharacterRefs.push(...characterAssets.map((asset) => asset.id));
      }
    }

    const inferredSceneName = sanitizeSceneCandidate(shot.sourceSceneName?.trim() || inferSceneName(context));
    const inferredSceneCanonicalKey = inferredSceneName ? canonicalAssetName("skybox", inferredSceneName) : "";
    const inferredSceneCanonicalRefId =
      inferredSceneCanonicalKey ? skyboxCanonicalPrimaryMap.get(inferredSceneCanonicalKey) ?? "" : "";
    const nextSceneRefId =
      inferredSceneCanonicalRefId ||
      normalizeSceneRefId(shot.sceneRefId) ||
      (inferredSceneName ? findMatchingAssetId(assets, "skybox", inferredSceneName) : "") ||
      normalizeSceneRefId(previousShot?.sceneRefId) ||
      (skyboxAssets.length === 1 ? skyboxAssets[0]?.id ?? "" : "");

    const fields: { characterRefs: string[]; sceneRefId: string } = {
      characterRefs: shot.characterRefs ?? [],
      sceneRefId: shot.sceneRefId ?? ""
    };
    const normalizedCharacterRefs = (() => {
      const characterOrder = new Map(characterAssets.map((asset, order) => [asset.id, order] as const));
      const seenNameKeys = new Set<string>();
      const output: string[] = [];
      for (const refId of uniqueEntities(nextCharacterRefs)) {
        const asset = assets.find((item) => item.id === refId && item.type === "character");
        if (!asset) continue;
        const key = normalizeEntityKey(asset.name || asset.id);
        if (key && seenNameKeys.has(key)) continue;
        if (key) seenNameKeys.add(key);
        output.push(refId);
      }
      output.sort((left, right) => (characterOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (characterOrder.get(right) ?? Number.MAX_SAFE_INTEGER));
      return output;
    })();
    if (
      normalizedCharacterRefs.length > 0 &&
      normalizedCharacterRefs.join(",") !== uniqueEntities(shot.characterRefs ?? []).join(",")
    ) {
      fields.characterRefs = normalizedCharacterRefs;
      repairedCharacterShots += 1;
    }
    if (nextSceneRefId && nextSceneRefId !== (shot.sceneRefId ?? "")) {
      fields.sceneRefId = nextSceneRefId;
      repairedSceneShots += 1;
    }
    if (
      fields.characterRefs.join(",") !== uniqueEntities(shot.characterRefs ?? []).join(",") ||
      fields.sceneRefId !== (shot.sceneRefId ?? "")
    ) {
      patches.push({ shotId: shot.id, fields });
    }
  }

  return { patches, repairedCharacterShots, repairedSceneShots };
}

function formatPipelineLogText(items: PipelineLogItem[]): string {
  return items.map((item) => `[${item.timestamp}] [${item.level.toUpperCase()}] ${item.message}`).join("\n");
}

function looksLikeVideoPath(path: string): boolean {
  const value = path.trim().toLowerCase();
  if (!value) return false;
  const pure = (value.split("?")[0] ?? value).trim();
  return [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".gif"].some((ext) =>
    pure.endsWith(ext)
  );
}

function looksLikeAudioPath(path: string): boolean {
  const value = path.trim().toLowerCase();
  if (!value) return false;
  const pure = (value.split("?")[0] ?? value).trim();
  return [".wav", ".mp3", ".aac", ".flac", ".ogg", ".m4a", ".opus"].some((ext) =>
    pure.endsWith(ext)
  );
}

function ttsTrackIdForShot(shotId: string): string {
  return `audio_tts_${shotId}`;
}

function ttsTrackIdForSegment(shotId: string, index: number): string {
  return `${ttsTrackIdForShot(shotId)}_${index}`;
}

function isNarrationSpeaker(speaker: string): boolean {
  const normalized = normalizeSpeakerKey(speaker);
  return ["旁白", "内心", "心声", "独白", "narration", "voiceover", "voice-over", "vo"].includes(normalized);
}

function summarizeDialogueSegments(segments: DialogueSegment[]): {
  total: number;
  dialogue: number;
  narration: number;
} {
  return segments.reduce(
    (summary, segment) => {
      summary.total += 1;
      if (isNarrationSpeaker(segment.speaker)) {
        summary.narration += 1;
      } else {
        summary.dialogue += 1;
      }
      return summary;
    },
    { total: 0, dialogue: 0, narration: 0 }
  );
}

function normalizeSpeakerKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function splitDialogueLines(raw: string): string[] {
  return raw
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function inferSpeechRate(text: string): string {
  const normalized = text.trim();
  if (!normalized) return "1.00";
  if (/急促|加快|飞快|赶紧|立刻|马上|快点|喘|跑|危险|紧张|激动|兴奋/.test(normalized)) return "1.12";
  if (/低声|压低|耳语|悄声|缓慢|停顿|迟疑|犹豫|哽咽|哭腔|旁白|沉稳|冷静|平静|慢慢/.test(normalized)) return "0.90";
  if (/[!！]{2,}/.test(normalized)) return "1.08";
  if (/[?？].*[?？]/.test(normalized)) return "1.04";
  if (/…|\.\.\./.test(normalized)) return "0.92";
  return "1.00";
}

function inferDialogueDelivery(
  text: string,
  speaker: string,
  explicitHint = ""
): { emotion: string; deliveryStyle: string; speechRate: string } {
  const combined = `${speaker} ${explicitHint} ${text}`.trim();
  const isNarration = /^(旁白|内心|心声|narration|voice over|vo)$/i.test(speaker.trim());
  let emotion = isNarration ? "平静" : "自然";
  let deliveryStyle = isNarration ? "旁白" : "自然口语";

  if (/怒|生气|愤怒|咬牙|厉声|吼|喊|咆哮/.test(combined)) {
    emotion = "愤怒";
    deliveryStyle = explicitHint.trim() || "爆发感";
  } else if (/哭|哽咽|抽泣|伤心|难过|悲伤|泣不成声/.test(combined)) {
    emotion = "悲伤";
    deliveryStyle = explicitHint.trim() || "哽咽";
  } else if (/笑|轻笑|苦笑|打趣|调侃|轻松|温柔/.test(combined)) {
    emotion = "轻松";
    deliveryStyle = explicitHint.trim() || "带笑意";
  } else if (/紧张|着急|急促|危险|快点|马上|立刻|跑|喘/.test(combined) || /[!！]/.test(text)) {
    emotion = "紧张";
    deliveryStyle = explicitHint.trim() || "急促";
  } else if (/疑惑|困惑|怀疑|试探|怎么|为什么/.test(combined) || /[?？]/.test(text)) {
    emotion = "疑惑";
    deliveryStyle = explicitHint.trim() || "试探";
  } else if (/低声|压低|耳语|悄声/.test(combined)) {
    emotion = isNarration ? "平静" : "克制";
    deliveryStyle = explicitHint.trim() || "压低声音";
  } else if (/冷静|平静|沉稳|冷声|克制/.test(combined)) {
    emotion = "克制";
    deliveryStyle = explicitHint.trim() || "冷静";
  } else if (/…|\.\.\.|迟疑|犹豫|顿了顿/.test(combined)) {
    emotion = "迟疑";
    deliveryStyle = explicitHint.trim() || "停顿明显";
  } else if (explicitHint.trim()) {
    deliveryStyle = explicitHint.trim();
  }

  return {
    emotion,
    deliveryStyle,
    speechRate: inferSpeechRate(`${explicitHint} ${text}`)
  };
}

function parseSpeakerSpec(raw: string): { speaker: string; hint: string } {
  const trimmed = raw.trim();
  const paren = trimmed.match(/^(.+?)\s*[（(]\s*([^()（）]+?)\s*[)）]\s*$/);
  if (paren) {
    return {
      speaker: paren[1]!.trim(),
      hint: paren[2]!.trim()
    };
  }
  const parts = trimmed.split(/[|｜]/).map((item) => item.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      speaker: parts[0]!,
      hint: parts.slice(1).join(" ")
    };
  }
  return { speaker: trimmed, hint: "" };
}

function matchSpeakerLine(raw: string): { speaker: string; text: string; hint: string } | null {
  const colon = raw.match(/^([^:：]{1,24})\s*[:：]\s*(.+)$/);
  if (colon) {
    const parsedSpeaker = parseSpeakerSpec(colon[1]!.trim());
    return {
      speaker: parsedSpeaker.speaker,
      hint: parsedSpeaker.hint,
      text: colon[2]!.trim()
    };
  }
  const bracket = raw.match(/^[\[【](.+?)[\]】]\s*(.+)$/);
  if (bracket) {
    const parsedSpeaker = parseSpeakerSpec(bracket[1]!.trim());
    return {
      speaker: parsedSpeaker.speaker,
      hint: parsedSpeaker.hint,
      text: bracket[2]!.trim()
    };
  }
  return null;
}

function resolveVoiceProfileForSpeaker(
  speaker: string,
  shot: Shot,
  assets: Asset[]
): string {
  const selectedCharacters = (shot.characterRefs ?? [])
    .map((id) => assets.find((item) => item.id === id && item.type === "character"))
    .filter((item): item is Asset => Boolean(item));
  const allCharacters = assets.filter((item) => item.type === "character");
  const pool = selectedCharacters.length > 0 ? selectedCharacters : allCharacters;
  const normalizedSpeaker = normalizeSpeakerKey(speaker);
  const matched = pool.find((item) => normalizeSpeakerKey(item.name) === normalizedSpeaker);
  if (matched?.voiceProfile?.trim()) return matched.voiceProfile.trim();
  return selectedCharacters[0]?.voiceProfile?.trim() || "";
}

function parseDialogueSegments(
  shot: Shot,
  assets: Asset[]
): DialogueSegment[] {
  const raw = shot.dialogue.trim();
  if (!raw) return [];
  const lines = splitDialogueLines(raw);
  const segments: DialogueSegment[] = [];
  for (const line of lines) {
    const parsed = matchSpeakerLine(line);
    if (parsed) {
      const delivery = inferDialogueDelivery(parsed.text, parsed.speaker, parsed.hint);
      segments.push({
        speaker: parsed.speaker,
        text: parsed.text,
        voiceProfile: resolveVoiceProfileForSpeaker(parsed.speaker, shot, assets),
        emotion: delivery.emotion,
        deliveryStyle: delivery.deliveryStyle,
        speechRate: delivery.speechRate
      });
      continue;
    }
    const delivery = inferDialogueDelivery(line, "", "");
    segments.push({
      speaker: "",
      text: line,
      voiceProfile: resolveVoiceProfileForSpeaker("", shot, assets),
      emotion: delivery.emotion,
      deliveryStyle: delivery.deliveryStyle,
      speechRate: delivery.speechRate
    });
  }
  return segments.filter((item) => item.text.trim().length > 0);
}

function allocateSegmentDurations(totalFrames: number, segments: DialogueSegment[]): number[] {
  if (segments.length === 0) return [];
  if (segments.length === 1) return [Math.max(1, totalFrames)];
  const safeTotal = Math.max(segments.length, totalFrames);
  const weights = segments.map((item) => Math.max(1, item.text.replace(/\s+/g, "").length));
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  const durations = weights.map((weight) => Math.max(1, Math.floor((weight / weightSum) * safeTotal)));
  let current = durations.reduce((sum, value) => sum + value, 0);
  while (current < safeTotal) {
    let targetIndex = 0;
    let bestGap = -Infinity;
    for (let index = 0; index < weights.length; index += 1) {
      const gap = weights[index]! / weightSum - durations[index]! / safeTotal;
      if (gap > bestGap) {
        bestGap = gap;
        targetIndex = index;
      }
    }
    durations[targetIndex] += 1;
    current += 1;
  }
  while (current > safeTotal) {
    let targetIndex = durations.findIndex((value) => value > 1);
    if (targetIndex < 0) break;
    durations[targetIndex] -= 1;
    current -= 1;
  }
  return durations;
}

function soundTrackIdForShot(shotId: string, kind: SoundCueKind): string {
  return `audio_${kind}_${shotId}`;
}

const PROP_SOUND_RULES: Array<{ pattern: RegExp; prompt: string }> = [
  { pattern: /枪|手枪|步枪|gun|rifle|shot|shoot|fire/i, prompt: "枪械金属碰撞、上膛、开火或余响" },
  { pattern: /门|door|开门|关门/i, prompt: "门把手、开门、关门、门轴摩擦" },
  { pattern: /电话|手机|phone|mobile/i, prompt: "手机提示音、震动、接听或按键" },
  { pattern: /车|汽车|car|engine|brake/i, prompt: "引擎、轮胎、驶过、刹车或车门" },
  { pattern: /杯|玻璃|glass|bottle/i, prompt: "玻璃杯、瓶子、轻碰撞或放置桌面" },
  { pattern: /纸|信|书|paper|book/i, prompt: "纸张翻动、书页摩擦或文件落桌" },
  { pattern: /刀|剑|knife|sword/i, prompt: "刀剑出鞘、金属摩擦、挥动破风" },
  { pattern: /包|箱|bag|box|case/i, prompt: "包袋、箱体开合、拉链、硬物碰撞" }
];

function compactTextParts(...parts: Array<string | undefined>): string {
  return parts
    .map((item) => item?.trim() ?? "")
    .filter((item) => item.length > 0)
    .join("；");
}

function buildShotSoundCues(shot: Shot): SoundCueSpec[] {
  const context = compactTextParts(shot.title, shot.storyPrompt, shot.notes, shot.dialogue, shot.tags.join("、"));
  const cues: SoundCueSpec[] = [
    {
      kind: "ambience",
      gain: 0.42,
      prompt: `为该镜头生成纯环境氛围声与空间底噪，不要对白，不要音乐，不要夸张拟音。镜头内容：${context || shot.title}。`
    }
  ];

  const hasCharacterActivity =
    Boolean(shot.dialogue.trim()) || (shot.characterRefs?.length ?? 0) > 0 || shot.tags.some((tag) => /dialogue|人物|角色/i.test(tag));
  if (hasCharacterActivity) {
    cues.push({
      kind: "character",
      gain: 0.68,
      prompt: `为该镜头生成人物细微动作音效，如呼吸、衣料摩擦、站立重心变化、轻微脚步或转身，不要对白，不要音乐。镜头内容：${context || shot.title}。`
    });
  }

  const propPrompts = PROP_SOUND_RULES
    .filter((rule) => rule.pattern.test(context))
    .map((rule) => rule.prompt);
  if (propPrompts.length > 0) {
    cues.push({
      kind: "prop",
      gain: 0.82,
      prompt: `为该镜头生成道具/事件音效：${[...new Set(propPrompts)].join("、")}。不要对白，不要音乐。镜头内容：${context || shot.title}。`
    });
  }
  return cues;
}

function hasUsableGeneratedAsset(
  kind: "image" | "video",
  shot: { generatedImagePath?: string; generatedVideoPath?: string }
): boolean {
  if (kind === "image") {
    return Boolean(shot.generatedImagePath?.trim());
  }
  return looksLikeVideoPath(shot.generatedVideoPath ?? "");
}

type NormalizedImportedShot = {
  id: string;
  title: string;
  prompt: string;
  negativePrompt: string;
  videoPrompt: string;
  videoMode: "auto" | "single_frame" | "first_last_frame";
  videoStartFramePath: string;
  videoEndFramePath: string;
  skyboxFace: "auto" | "front" | "right" | "back" | "left" | "up" | "down";
  skyboxFaces: Array<"front" | "right" | "back" | "left" | "up" | "down">;
  skyboxFaceWeights: Record<string, number>;
  cameraYaw?: number;
  cameraPitch?: number;
  cameraFov?: number;
  durationSec?: number;
  durationFrames?: number;
  seed?: number;
  characterRefs: string[];
  sceneRefId: string;
  dialogue: string;
  notes: string;
  tags: string[];
  characterNames: string[];
  sceneName: string;
  scenePrompt: string;
};

function normalizeImportedShots(parsed: { shots?: Array<Record<string, unknown>> }): NormalizedImportedShot[] {
  const list = Array.isArray(parsed.shots) ? parsed.shots : [];
  const parseNumber = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : undefined;
    }
    return undefined;
  };
  return list.map((item, index) => ({
    id: typeof item.id === "string" ? item.id : `shot_import_${index + 1}`,
    title: String(item.title ?? `镜头 ${index + 1}`),
    prompt: String(item.prompt ?? ""),
    negativePrompt: String(item.negative_prompt ?? item.negativePrompt ?? ""),
    videoPrompt: String(item.video_prompt ?? item.videoPrompt ?? ""),
    videoMode:
      item.video_mode === "single_frame" || item.videoMode === "single_frame"
        ? "single_frame"
        : item.video_mode === "first_last_frame" || item.videoMode === "first_last_frame"
          ? "first_last_frame"
          : "auto",
    videoStartFramePath: String(item.video_start_frame_path ?? item.videoStartFramePath ?? ""),
    videoEndFramePath: String(item.video_end_frame_path ?? item.videoEndFramePath ?? ""),
    skyboxFace:
      item.skybox_face === "front" ||
      item.skybox_face === "right" ||
      item.skybox_face === "back" ||
      item.skybox_face === "left" ||
      item.skybox_face === "up" ||
      item.skybox_face === "down" ||
      item.skybox_face === "auto"
        ? item.skybox_face
        : item.skyboxFace === "front" ||
            item.skyboxFace === "right" ||
            item.skyboxFace === "back" ||
            item.skyboxFace === "left" ||
            item.skyboxFace === "up" ||
            item.skyboxFace === "down" ||
            item.skyboxFace === "auto"
          ? item.skyboxFace
          : "auto",
    skyboxFaces: Array.isArray(item.skybox_faces)
      ? item.skybox_faces.filter(
          (face): face is "front" | "right" | "back" | "left" | "up" | "down" =>
            face === "front" ||
            face === "right" ||
            face === "back" ||
            face === "left" ||
            face === "up" ||
            face === "down"
        )
      : Array.isArray(item.skyboxFaces)
        ? item.skyboxFaces.filter(
            (face): face is "front" | "right" | "back" | "left" | "up" | "down" =>
              face === "front" ||
              face === "right" ||
              face === "back" ||
              face === "left" ||
              face === "up" ||
              face === "down"
          )
        : [],
    skyboxFaceWeights:
      item.skybox_face_weights && typeof item.skybox_face_weights === "object"
        ? (item.skybox_face_weights as Record<string, number>)
        : item.skyboxFaceWeights && typeof item.skyboxFaceWeights === "object"
          ? (item.skyboxFaceWeights as Record<string, number>)
          : {},
    cameraYaw: parseNumber(item.camera_yaw ?? item.cameraYaw),
    cameraPitch: parseNumber(item.camera_pitch ?? item.cameraPitch),
    cameraFov: parseNumber(item.camera_fov ?? item.cameraFov),
    durationSec:
      typeof item.duration_sec === "number"
        ? item.duration_sec
        : typeof item.durationSec === "number"
          ? item.durationSec
          : undefined,
    durationFrames:
      typeof item.duration_frames === "number"
        ? item.duration_frames
        : typeof item.durationFrames === "number"
          ? item.durationFrames
          : undefined,
    seed: typeof item.seed === "number" ? item.seed : undefined,
    characterRefs: Array.isArray(item.character_refs)
      ? (item.character_refs as string[])
      : Array.isArray(item.characterRefs)
        ? (item.characterRefs as string[])
        : [],
    sceneRefId: String(item.scene_ref_id ?? item.sceneRefId ?? ""),
    dialogue: typeof item.dialogue === "string" ? item.dialogue : "",
    notes: typeof item.notes === "string" ? item.notes : "",
    tags: Array.isArray(item.tags) ? (item.tags as string[]) : [],
    characterNames: Array.isArray(item.character_names)
      ? uniqueEntities((item.character_names as string[]).map((value) => sanitizeCharacterCandidate(String(value))).filter(Boolean))
      : Array.isArray(item.characterNames)
        ? uniqueEntities((item.characterNames as string[]).map((value) => sanitizeCharacterCandidate(String(value))).filter(Boolean))
        : [],
    sceneName: sanitizeSceneCandidate(String(item.scene_name ?? item.sceneName ?? "").trim()),
    scenePrompt: String(item.scene_prompt ?? item.scenePrompt ?? "").trim()
  }));
}

export function ComfyPipelinePanel() {
  const project = useStoryboardStore((state) => state.project);
  const shots = useStoryboardStore((state) => state.shots);
  const assets = useStoryboardStore((state) => state.assets);
  const audioTracks = useStoryboardStore((state) => state.audioTracks);
  const currentSequenceId = useStoryboardStore((state) => state.currentSequenceId);
  const replaceShotsForCurrentSequence = useStoryboardStore((state) => state.replaceShotsForCurrentSequence);
  const updateShotFields = useStoryboardStore((state) => state.updateShotFields);
  const addAsset = useStoryboardStore((state) => state.addAsset);
  const setShotDuration = useStoryboardStore((state) => state.setShotDuration);
  const upsertAudioTrack = useStoryboardStore((state) => state.upsertAudioTrack);
  const updateAudioTrack = useStoryboardStore((state) => state.updateAudioTrack);
  const removeAudioTrack = useStoryboardStore((state) => state.removeAudioTrack);
  const [storyText, setStoryText] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [autoProvisionAssets, setAutoProvisionAssets] = useState(true);
  const [storyCharacterOverrides, setStoryCharacterOverrides] = useState<Record<string, string>>({});
  const [storySkyboxOverrides, setStorySkyboxOverrides] = useState<Record<string, string>>({});
  const [scriptCharacterOverrides, setScriptCharacterOverrides] = useState<Record<string, string>>({});
  const [scriptSkyboxOverrides, setScriptSkyboxOverrides] = useState<Record<string, string>>({});
  const [importPresets, setImportPresets] = useState<ImportProvisionPreset[]>(() => loadImportPresets());
  const [storySelectedPresetId, setStorySelectedPresetId] = useState("");
  const [scriptSelectedPresetId, setScriptSelectedPresetId] = useState("");
  const [autoApplyImportedPreset, setAutoApplyImportedPreset] = useState<boolean>(() => loadImportPresetAutoApply());
  const [phase, setPhase] = useState<GenerationPhase>("idle");
  const [pipelineState, setPipelineState] = useState("空闲");
  const [runAllActive, setRunAllActive] = useState(false);
  const [runAllProgress, setRunAllProgress] = useState(0);
  const [runAllStage, setRunAllStage] = useState("");
  const [previewVideoPath, setPreviewVideoPath] = useState("");
  const characterProvisionInFlightRef = useRef<Map<string, Promise<ProvisionCreateResult>>>(new Map());
  const skyboxProvisionInFlightRef = useRef<Map<string, Promise<ProvisionCreateResult>>>(new Map());
  const [settings, setSettings] = useState<ComfySettings>(() => loadSettings());
  const [skipExisting, setSkipExisting] = useState(true);
  const [imageStatusByShot, setImageStatusByShot] = useState<Record<string, AssetStatus>>({});
  const [videoStatusByShot, setVideoStatusByShot] = useState<Record<string, AssetStatus>>({});
  const [audioStatusByShot, setAudioStatusByShot] = useState<Record<string, AssetStatus>>({});
  const [lastErrorByShot, setLastErrorByShot] = useState<Record<string, string>>({});
  const [expandedShotId, setExpandedShotId] = useState("");
  const [logs, setLogs] = useState<PipelineLogItem[]>([]);
  const [provisionPreviews, setProvisionPreviews] = useState<ProvisionPreviewItem[]>([]);
  const [connectionLabel, setConnectionLabel] = useState("待检测");
  const [availableCheckpointOptions, setAvailableCheckpointOptions] = useState<string[]>([]);
  const [showShotEditor, setShowShotEditor] = useState(false);
  const [shotFilter, setShotFilter] = useState<"all" | "failed">("all");
  const [lastDependencyHints, setLastDependencyHints] = useState<WorkflowDependencyHint[]>([]);
  const [lastModelChecklist, setLastModelChecklist] = useState("");
  const [characterWorkflowDiagnostic, setCharacterWorkflowDiagnostic] = useState<AssetWorkflowDiagnostic | null>(null);
  const [skyboxWorkflowDiagnostic, setSkyboxWorkflowDiagnostic] = useState<AssetWorkflowDiagnostic | null>(null);
  const [storyboardWorkflowDiagnostic, setStoryboardWorkflowDiagnostic] = useState<AssetWorkflowDiagnostic | null>(null);
  const checkingRef = useRef(false);
  const characterModelVisible = useMemo(() => {
    const selected = settings.characterAssetModelName?.trim();
    if (!selected) return null;
    if (availableCheckpointOptions.length === 0) return null;
    return availableCheckpointOptions.includes(selected);
  }, [availableCheckpointOptions, settings.characterAssetModelName]);
  const characterAssetWorkflowMode = settings.characterAssetWorkflowMode ?? DEFAULT_CHARACTER_ASSET_WORKFLOW_MODE;
  const characterAssetModeSpec = useMemo(
    () =>
      buildCharacterAssetModeSpec(
        characterAssetWorkflowMode,
        settings.characterAssetModelName?.trim() || DEFAULT_CHARACTER_ASSET_MODEL
      ),
    [characterAssetWorkflowMode, settings.characterAssetModelName]
  );
  const skyboxModelVisible = useMemo(() => {
    const selected = settings.skyboxAssetModelName?.trim();
    if (!selected) return null;
    if (availableCheckpointOptions.length === 0) return null;
    return availableCheckpointOptions.includes(selected);
  }, [availableCheckpointOptions, settings.skyboxAssetModelName]);
  const skyboxAssetWorkflowMode = settings.skyboxAssetWorkflowMode ?? DEFAULT_SKYBOX_ASSET_WORKFLOW_MODE;
  const skyboxAssetModeSpec = useMemo(
    () =>
      buildSkyboxAssetModeSpec(
        skyboxAssetWorkflowMode,
        settings.skyboxAssetModelName?.trim() || DEFAULT_SKYBOX_ASSET_MODEL
      ),
    [skyboxAssetWorkflowMode, settings.skyboxAssetModelName]
  );
  const storyboardImageWorkflowMode = settings.storyboardImageWorkflowMode ?? DEFAULT_STORYBOARD_IMAGE_WORKFLOW_MODE;
  const storyboardModelVisible = useMemo(() => {
    const selected = settings.storyboardImageModelName?.trim();
    if (!selected) return null;
    if (availableCheckpointOptions.length === 0) return null;
    return availableCheckpointOptions.includes(selected);
  }, [availableCheckpointOptions, settings.storyboardImageModelName]);
  const storyboardImageModeSpec = useMemo(
    () => buildStoryboardImageModeSpec(storyboardImageWorkflowMode),
    [storyboardImageWorkflowMode]
  );
  const characterIssueSummary = useMemo(
    () =>
      buildAssetIssueSummary({
        kind: "character",
        mode: characterAssetWorkflowMode,
        modeSpec: characterAssetModeSpec,
        workflowConfigured: Boolean(settings.characterWorkflowJson?.trim()),
        strictMode: settings.requireDedicatedCharacterWorkflow !== false,
        selectedModel: settings.characterAssetModelName?.trim() || DEFAULT_CHARACTER_ASSET_MODEL,
        modelVisible: characterModelVisible,
        diagnostic: characterWorkflowDiagnostic
      }),
    [
      characterAssetWorkflowMode,
      characterAssetModeSpec,
      settings.characterWorkflowJson,
      settings.requireDedicatedCharacterWorkflow,
      settings.characterAssetModelName,
      characterModelVisible,
      characterWorkflowDiagnostic
    ]
  );
  const skyboxIssueSummary = useMemo(
    () =>
      buildAssetIssueSummary({
        kind: "skybox",
        mode: skyboxAssetWorkflowMode,
        modeSpec: skyboxAssetModeSpec,
        workflowConfigured: Boolean(settings.skyboxWorkflowJson?.trim()),
        strictMode: settings.requireDedicatedSkyboxWorkflow !== false,
        selectedModel: settings.skyboxAssetModelName?.trim() || DEFAULT_SKYBOX_ASSET_MODEL,
        modelVisible: skyboxModelVisible,
        diagnostic: skyboxWorkflowDiagnostic
      }),
    [
      skyboxAssetWorkflowMode,
      skyboxAssetModeSpec,
      settings.skyboxWorkflowJson,
      settings.requireDedicatedSkyboxWorkflow,
      settings.skyboxAssetModelName,
      skyboxModelVisible,
      skyboxWorkflowDiagnostic
    ]
  );

  const storyNormalizedItems = useMemo(() => {
    const text = storyText.trim();
    if (!text) return [] as NormalizedImportedShot[];
    try {
      const parsed = parseStoryToShotScript(text);
      return normalizeImportedShots(parsed as unknown as { shots?: Array<Record<string, unknown>> });
    } catch {
      return [] as NormalizedImportedShot[];
    }
  }, [storyText]);

  const storyParsePreview = useMemo(() => {
    if (storyNormalizedItems.length === 0) return null;
    const totalSec = storyNormalizedItems.reduce((sum, item) => sum + Number(item.durationSec || 0), 0);
    return {
      count: storyNormalizedItems.length,
      totalSec
    };
  }, [storyNormalizedItems]);

  const scopedShots = useMemo(
    () =>
      shots
        .filter((shot) => shot.sequenceId === currentSequenceId)
        .sort((a, b) => a.order - b.order),
    [currentSequenceId, shots]
  );

  const visibleShots = useMemo(() => {
    const list = scopedShots.slice(0, 12);
    if (shotFilter === "all") return list;
    return list.filter(
      (shot) =>
        imageStatusByShot[shot.id] === "failed" ||
        videoStatusByShot[shot.id] === "failed" ||
        audioStatusByShot[shot.id] === "failed"
    );
  }, [audioStatusByShot, imageStatusByShot, scopedShots, shotFilter, videoStatusByShot]);

  const shotReferencePreviewById = useMemo(() => {
    const next = new Map<string, ShotReferencePreview>();
    for (const shot of scopedShots) {
      next.set(shot.id, resolveShotReferencePreview(shot, assets));
    }
    return next;
  }, [assets, scopedShots]);

  const getScopedShotsSnapshot = () =>
    useStoryboardStore
      .getState()
      .shots.filter((shot) => shot.sequenceId === currentSequenceId)
      .sort((a, b) => a.order - b.order);

  const inferInputDirFromSettings = (value: ComfySettings): string => {
    const explicitInput = value.comfyInputDir.trim().replace(/\/+$/, "");
    if (explicitInput) return explicitInput;
    const root = value.comfyRootDir.trim().replace(/\/+$/, "");
    if (root) return `${root}/input`;
    const output = value.outputDir.trim().replace(/\/+$/, "");
    if (!output) return "";
    const index = output.lastIndexOf("/");
    if (index <= 0) return "";
    return `${output.slice(0, index)}/input`;
  };

  const monitorSummary = useMemo(() => {
    let imageSuccess = 0;
    let imageFailed = 0;
    let videoSuccess = 0;
    let videoFailed = 0;
    let audioSuccess = 0;
    let audioFailed = 0;
    for (const shot of scopedShots) {
      const imageStatus = imageStatusByShot[shot.id] ?? "idle";
      const videoStatus = videoStatusByShot[shot.id] ?? "idle";
      const audioStatus = audioStatusByShot[shot.id] ?? "idle";
      if (imageStatus === "success") imageSuccess += 1;
      if (imageStatus === "failed") imageFailed += 1;
      if (videoStatus === "success") videoSuccess += 1;
      if (videoStatus === "failed") videoFailed += 1;
      if (audioStatus === "success") audioSuccess += 1;
      if (audioStatus === "failed") audioFailed += 1;
    }
    const errorLogCount = logs.reduce((count, item) => count + (item.level === "error" ? 1 : 0), 0);
    return {
      totalShots: scopedShots.length,
      imageSuccess,
      imageFailed,
      videoSuccess,
      videoFailed,
      audioSuccess,
      audioFailed,
      errorLogCount
    };
  }, [audioStatusByShot, imageStatusByShot, logs, scopedShots, videoStatusByShot]);

  const persistSettings = (next: ComfySettings | ((previous: ComfySettings) => ComfySettings)) => {
    setSettings((previous) => {
      const resolved = typeof next === "function" ? (next as (prev: ComfySettings) => ComfySettings)(previous) : next;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(resolved));
      return resolved;
    });
  };

  const appendLog = (message: string, level: PipelineLogLevel = "info") => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const item: PipelineLogItem = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      timestamp: `${hh}:${mm}:${ss}`,
      level,
      message
    };
    setLogs((previous) => [...previous.slice(-499), item]);
  };

  const upsertProvisionPreview = (nextItem: ProvisionPreviewItem) => {
    setProvisionPreviews((previous) => {
      const existingIndex = previous.findIndex((item) => item.key === nextItem.key);
      if (existingIndex < 0) return [...previous, nextItem];
      const next = previous.slice();
      next[existingIndex] = nextItem;
      return next;
    });
  };

  const scriptNormalizedItems = useMemo(() => {
    const text = scriptText.trim();
    if (!text) return [] as NormalizedImportedShot[];
    try {
      const parsed = JSON.parse(text) as { shots?: Array<Record<string, unknown>> };
      return normalizeImportedShots(parsed);
    } catch {
      return [] as NormalizedImportedShot[];
    }
  }, [scriptText]);

  const storyProvisionChoices = useMemo(
    () => (storyNormalizedItems.length > 0 ? listAssetProvisionChoices(assets, storyNormalizedItems) : null),
    [assets, storyNormalizedItems]
  );

  const scriptProvisionChoices = useMemo(
    () => (scriptNormalizedItems.length > 0 ? listAssetProvisionChoices(assets, scriptNormalizedItems) : null),
    [assets, scriptNormalizedItems]
  );

  const summarizeProvisionWithOverrides = (
    choices: { characters: AssetProvisionChoice[]; skyboxes: AssetProvisionChoice[] } | null,
    characterOverrides: Record<string, string>,
    skyboxOverrides: Record<string, string>
  ) => {
    if (!choices) return null;
    const reusedCharacters = choices.characters
      .filter((item) => {
        const override = characterOverrides[item.key];
        if (override === "__new__") return false;
        if (override) return true;
        return Boolean(item.matchedAssetId);
      })
      .map((item) => item.name);
    const newCharacters = choices.characters
      .filter((item) => {
        const override = characterOverrides[item.key];
        if (override === "__new__") return true;
        if (override) return false;
        return !item.matchedAssetId;
      })
      .map((item) => item.name);
    const reusedSkyboxes = choices.skyboxes
      .filter((item) => {
        const override = skyboxOverrides[item.key];
        if (override === "__new__") return false;
        if (override) return true;
        return Boolean(item.matchedAssetId);
      })
      .map((item) => item.name);
    const newSkyboxes = choices.skyboxes
      .filter((item) => {
        const override = skyboxOverrides[item.key];
        if (override === "__new__") return true;
        if (override) return false;
        return !item.matchedAssetId;
      })
      .map((item) => item.name);
    return {
      reusedCharacters,
      newCharacters,
      reusedSkyboxes,
      newSkyboxes
    };
  };

  const storyAssetPreview = useMemo(
    () => summarizeProvisionWithOverrides(storyProvisionChoices, storyCharacterOverrides, storySkyboxOverrides),
    [storyCharacterOverrides, storyProvisionChoices, storySkyboxOverrides]
  );

  const scriptAssetPreview = useMemo(
    () => summarizeProvisionWithOverrides(scriptProvisionChoices, scriptCharacterOverrides, scriptSkyboxOverrides),
    [scriptCharacterOverrides, scriptProvisionChoices, scriptSkyboxOverrides]
  );

  const characterAssetOptions = useMemo(
    () => assets.filter((asset) => asset.type === "character"),
    [assets]
  );

  const skyboxAssetOptions = useMemo(
    () => assets.filter((asset) => asset.type === "skybox"),
    [assets]
  );

  const storySelectedPreset = useMemo(
    () => importPresets.find((item) => item.id === storySelectedPresetId) ?? null,
    [importPresets, storySelectedPresetId]
  );

  const scriptSelectedPreset = useMemo(
    () => importPresets.find((item) => item.id === scriptSelectedPresetId) ?? null,
    [importPresets, scriptSelectedPresetId]
  );

  const sortedImportPresets = useMemo(() => sortImportPresets(importPresets), [importPresets]);

  const applyBatchOverrides = (
    keys: string[],
    setter: (updater: (previous: Record<string, string>) => Record<string, string>) => void,
    value: string
  ) => {
    setter((previous) => {
      const next = { ...previous };
      for (const key of keys) {
        if (!key) continue;
        if (!value) {
          delete next[key];
        } else {
          next[key] = value;
        }
      }
      return next;
    });
  };

  const buildPresetPayload = (
    scope: ImportProvisionPreset["scope"],
    choices: { characters: AssetProvisionChoice[]; skyboxes: AssetProvisionChoice[] } | null,
    characterOverrides: Record<string, string>,
    skyboxOverrides: Record<string, string>
  ) => {
    if (!choices) {
      return {
        characterOverrides: {},
        skyboxOverrides: {}
      };
    }
    const nextCharacterOverrides: Record<string, string> = {};
    const nextSkyboxOverrides: Record<string, string> = {};
    if (scope !== "skyboxes") {
      for (const item of choices.characters) {
        const value = characterOverrides[item.key];
        if (value) nextCharacterOverrides[item.key] = value;
      }
    }
    if (scope !== "characters") {
      for (const item of choices.skyboxes) {
        const value = skyboxOverrides[item.key];
        if (value) nextSkyboxOverrides[item.key] = value;
      }
    }
    return {
      characterOverrides: nextCharacterOverrides,
      skyboxOverrides: nextSkyboxOverrides
    };
  };

  const applyImportPresetRecord = (
    preset: ImportProvisionPreset,
    choices: { characters: AssetProvisionChoice[]; skyboxes: AssetProvisionChoice[] } | null,
    setCharacterOverrides: (value: Record<string, string>) => void,
    setSkyboxOverrides: (value: Record<string, string>) => void
  ) => {
    if (!choices) return;
    const characterAssetIds = new Set(characterAssetOptions.map((asset) => asset.id));
    const skyboxAssetIds = new Set(skyboxAssetOptions.map((asset) => asset.id));
    const nextCharacterOverrides: Record<string, string> = {};
    const nextSkyboxOverrides: Record<string, string> = {};

    if (preset.scope !== "skyboxes") {
      for (const item of choices.characters) {
        const value = preset.characterOverrides[item.key];
        if (!value) continue;
        if (value === "__new__" || characterAssetIds.has(value)) {
          nextCharacterOverrides[item.key] = value;
        }
      }
    }
    if (preset.scope !== "characters") {
      for (const item of choices.skyboxes) {
        const value = preset.skyboxOverrides[item.key];
        if (!value) continue;
        if (value === "__new__" || skyboxAssetIds.has(value)) {
          nextSkyboxOverrides[item.key] = value;
        }
      }
    }

    if (preset.scope !== "skyboxes") {
      setCharacterOverrides(nextCharacterOverrides);
    }
    if (preset.scope !== "characters") {
      setSkyboxOverrides(nextSkyboxOverrides);
    }
    pushToast(`已应用导入预设：${preset.name}`, "success");
  };

  const applyImportPreset = (
    presetId: string,
    choices: { characters: AssetProvisionChoice[]; skyboxes: AssetProvisionChoice[] } | null,
    setCharacterOverrides: (value: Record<string, string>) => void,
    setSkyboxOverrides: (value: Record<string, string>) => void
  ) => {
    const preset = importPresets.find((item) => item.id === presetId);
    if (!preset) return;
    applyImportPresetRecord(preset, choices, setCharacterOverrides, setSkyboxOverrides);
    setImportPresets((previous) => {
      const now = Date.now();
      const next = previous.map((item) =>
        item.id === presetId ? { ...item, lastUsedAt: now, updatedAt: Math.max(item.updatedAt, now) } : item
      );
      persistImportPresets(next);
      return next;
    });
  };

  const saveImportPreset = (
    presetName: string,
    presetNote: string,
    presetScope: ImportProvisionPreset["scope"],
    choices: { characters: AssetProvisionChoice[]; skyboxes: AssetProvisionChoice[] } | null,
    characterOverrides: Record<string, string>,
    skyboxOverrides: Record<string, string>
  ) => {
    const payload = buildPresetPayload(presetScope, choices, characterOverrides, skyboxOverrides);
    if (
      Object.keys(payload.characterOverrides).length === 0 &&
      Object.keys(payload.skyboxOverrides).length === 0
    ) {
      pushToast("当前没有可保存的手工映射", "warning");
      return "";
    }
    const name = presetName.trim();
    if (!name) return "";
    const nextPreset: ImportProvisionPreset = {
      id: `import_preset_${Date.now()}`,
      name,
      note: presetNote.trim(),
      scope: presetScope,
      pinned: false,
      updatedAt: Date.now(),
      lastUsedAt: 0,
      characterOverrides: payload.characterOverrides,
      skyboxOverrides: payload.skyboxOverrides
    };
    setImportPresets((previous) => {
      const filtered = previous.filter((item) => item.name !== name);
      const next = [...filtered, nextPreset];
      persistImportPresets(next);
      return next;
    });
    pushToast(`导入预设已保存：${name}`, "success");
    return nextPreset.id;
  };

  const deleteImportPreset = (presetId: string) => {
    const preset = importPresets.find((item) => item.id === presetId);
    if (!preset) return;
    if (!window.confirm(`确定删除导入预设「${preset.name}」吗？`)) return;
    setImportPresets((previous) => {
      const next = previous.filter((item) => item.id !== presetId);
      persistImportPresets(next);
      return next;
    });
    setStorySelectedPresetId((previous) => (previous === presetId ? "" : previous));
    setScriptSelectedPresetId((previous) => (previous === presetId ? "" : previous));
    pushToast(`已删除导入预设：${preset.name}`, "success");
  };

  const renameImportPreset = (presetId: string) => {
    const preset = importPresets.find((item) => item.id === presetId);
    if (!preset) return;
    const nextName = window.prompt("输入新的预设名称", preset.name)?.trim() ?? "";
    if (!nextName || nextName === preset.name) return;
    setImportPresets((previous) => {
      const now = Date.now();
      const next = previous.map((item) => (item.id === presetId ? { ...item, name: nextName, updatedAt: now } : item));
      persistImportPresets(next);
      return next;
    });
    pushToast(`预设已重命名为：${nextName}`, "success");
  };

  const editImportPresetNote = (presetId: string) => {
    const preset = importPresets.find((item) => item.id === presetId);
    if (!preset) return;
    const nextNote = window.prompt("输入预设备注", preset.note)?.trim() ?? "";
    setImportPresets((previous) => {
      const now = Date.now();
      const next = previous.map((item) => (item.id === presetId ? { ...item, note: nextNote, updatedAt: now } : item));
      persistImportPresets(next);
      return next;
    });
    pushToast(nextNote ? `已更新预设备注：${preset.name}` : `已清空预设备注：${preset.name}`, "success");
  };

  const editImportPresetScope = (presetId: string) => {
    const preset = importPresets.find((item) => item.id === presetId);
    if (!preset) return;
    const scopeInput =
      window.prompt("输入新的预设作用域：all / characters / skyboxes", preset.scope)?.trim() ?? "";
    let scope: ImportProvisionPreset["scope"] | "" = "";
    if (scopeInput === "all" || scopeInput === "characters" || scopeInput === "skyboxes") {
      scope = scopeInput;
    }
    if (!scope || scope === preset.scope) return;
    setImportPresets((previous) => {
      const now = Date.now();
      const next = previous.map((item) => (item.id === presetId ? { ...item, scope, updatedAt: now } : item));
      persistImportPresets(next);
      return next;
    });
    pushToast(`已更新预设作用域：${preset.name}`, "success");
  };

  const toggleImportPresetPinned = (presetId: string) => {
    const preset = importPresets.find((item) => item.id === presetId);
    if (!preset) return;
    setImportPresets((previous) => {
      const now = Date.now();
      const next = previous.map((item) =>
        item.id === presetId ? { ...item, pinned: !item.pinned, updatedAt: now } : item
      );
      persistImportPresets(next);
      return next;
    });
    pushToast(preset.pinned ? `已取消置顶：${preset.name}` : `已置顶预设：${preset.name}`, "success");
  };

  const duplicateImportPreset = (presetId: string) => {
    const preset = importPresets.find((item) => item.id === presetId);
    if (!preset) return "";
    const suggestedName = `${preset.name} 副本`;
    const nextName = window.prompt("输入复制后的预设名称", suggestedName)?.trim() ?? "";
    if (!nextName) return "";
    const now = Date.now();
    const nextPreset: ImportProvisionPreset = {
      ...preset,
      id: `import_preset_${now}`,
      name: nextName,
      pinned: false,
      updatedAt: now,
      lastUsedAt: 0
    };
    setImportPresets((previous) => {
      const filtered = previous.filter((item) => item.name !== nextName);
      const next = [...filtered, nextPreset];
      persistImportPresets(next);
      return next;
    });
    pushToast(`已复制预设：${nextName}`, "success");
    return nextPreset.id;
  };

  const exportImportPreset = async (presetId: string) => {
    const preset = importPresets.find((item) => item.id === presetId);
    if (!preset) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(preset, null, 2));
      pushToast(`预设 JSON 已复制：${preset.name}`, "success");
    } catch (error) {
      pushToast(`复制预设失败：${String(error)}`, "error");
    }
  };

  const importImportPresets = () => {
    const input = window.prompt("粘贴导入预设 JSON（支持单个对象或数组）", "");
    if (!input || !input.trim()) return;
    try {
      const parsed = JSON.parse(input) as ImportProvisionPreset | ImportProvisionPreset[];
      const normalized = normalizeImportPresetRecords(Array.isArray(parsed) ? parsed : [parsed]);
      if (normalized.length === 0) {
        pushToast("未识别到有效导入预设", "warning");
        return;
      }
      let lastImportedId = "";
      let lastImportedPreset: ImportProvisionPreset | null = null;
      const importBatchId = Date.now();
      setImportPresets((previous) => {
        const deduped = previous.filter(
          (item) => !normalized.some((incoming) => incoming.name.trim() === item.name.trim())
        );
        const imported = normalized.map((item, index) => {
          lastImportedId = `import_preset_${importBatchId}_${index}`;
          lastImportedPreset = {
            ...item,
            id: `import_preset_${importBatchId}_${index}`,
            updatedAt: importBatchId + index,
            lastUsedAt: autoApplyImportedPreset ? importBatchId + index : item.lastUsedAt,
            pinned: item.pinned === true
          };
          return lastImportedPreset;
        });
        const next = [...deduped, ...imported];
        persistImportPresets(next);
        return next;
      });
      if (lastImportedId) {
        setStorySelectedPresetId(lastImportedId);
        setScriptSelectedPresetId(lastImportedId);
      }
      if (autoApplyImportedPreset && lastImportedPreset) {
        if (storyProvisionChoices) {
          applyImportPresetRecord(
            lastImportedPreset,
            storyProvisionChoices,
            setStoryCharacterOverrides,
            setStorySkyboxOverrides
          );
        }
        if (scriptProvisionChoices) {
          applyImportPresetRecord(
            lastImportedPreset,
            scriptProvisionChoices,
            setScriptCharacterOverrides,
            setScriptSkyboxOverrides
          );
        }
      }
      pushToast(`已导入 ${normalized.length} 个预设`, "success");
    } catch (error) {
      pushToast(`导入预设失败：${String(error)}`, "error");
    }
  };

  useEffect(() => {
    localStorage.setItem(IMPORT_PRESET_AUTO_APPLY_KEY, autoApplyImportedPreset ? "1" : "0");
  }, [autoApplyImportedPreset]);

  useEffect(() => {
    const buildId =
      typeof window !== "undefined" && "__STORYBOARD_WEB_BUILD_ID__" in window
        ? String((window as Window & { __STORYBOARD_WEB_BUILD_ID__?: string }).__STORYBOARD_WEB_BUILD_ID__ || "").trim()
        : "";
    if (buildId) {
      appendLog(`AI 流水线已加载，当前构建：${buildId}`);
    }
  }, []);

  useEffect(() => {
    if (!isWebBridgeRuntime()) return;
    const timer = window.setTimeout(() => {
      void invokeDesktopCommand("save_pipeline_logs", {
        text: formatPipelineLogText(logs)
      }).catch(() => {
        // Ignore bridge log sync failures. The local UI log remains the source of truth.
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [logs]);

  useEffect(() => {
    if (!isWebBridgeRuntime()) return;
    const timer = window.setTimeout(() => {
      void invokeDesktopCommand("save_comfy_runtime_config", {
        config: {
          baseUrl: settings.baseUrl,
          comfyRootDir: settings.comfyRootDir,
          comfyInputDir: settings.comfyInputDir,
          outputDir: settings.outputDir,
          videoGenerationMode: settings.videoGenerationMode,
          imageWorkflowJson: settings.imageWorkflowJson,
          videoWorkflowJson: settings.videoWorkflowJson,
          characterWorkflowJson: settings.characterWorkflowJson,
          skyboxWorkflowJson: settings.skyboxWorkflowJson,
          audioWorkflowJson: settings.audioWorkflowJson,
          soundWorkflowJson: settings.soundWorkflowJson
        }
      }).catch(() => {
        // Ignore bridge config sync failures. Diagnostics is best-effort only.
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [
    settings.baseUrl,
    settings.audioWorkflowJson,
    settings.characterWorkflowJson,
    settings.comfyInputDir,
    settings.comfyRootDir,
    settings.imageWorkflowJson,
    settings.outputDir,
    settings.soundWorkflowJson,
    settings.skyboxWorkflowJson,
    settings.videoWorkflowJson,
    settings.videoGenerationMode
  ]);

  const copyLogs = async () => {
    if (logs.length === 0) {
      pushToast("暂无日志可复制", "warning");
      return;
    }
    const text = formatPipelineLogText(logs);
    try {
      await navigator.clipboard.writeText(text);
      pushToast("日志已复制", "success");
    } catch (error) {
      pushToast(`复制失败：${String(error)}`, "error");
    }
  };

  const setAssetStatus = (kind: "image" | "video" | "audio", shotId: string, status: AssetStatus) => {
    if (kind === "image") {
      setImageStatusByShot((previous) => ({ ...previous, [shotId]: status }));
    } else if (kind === "audio") {
      setAudioStatusByShot((previous) => ({ ...previous, [shotId]: status }));
    } else {
      setVideoStatusByShot((previous) => ({ ...previous, [shotId]: status }));
    }
  };

  const audioSummaryByShot = useMemo(() => {
    const map: Record<string, { count: number; dialogueCount: number; narrationCount: number; firstPath: string }> = {};
    for (const track of audioTracks) {
      const ttsMatch = /^audio_tts_(.+?)(?:_(\d+))?$/.exec(track.id);
      if (!ttsMatch) continue;
      const shotId = ttsMatch[1] ?? "";
      if (!shotId) continue;
      const current = map[shotId] ?? { count: 0, dialogueCount: 0, narrationCount: 0, firstPath: "" };
      const valid = looksLikeAudioPath(track.filePath);
      if (valid) {
        current.count += 1;
        if (track.kind === "narration") {
          current.narrationCount += 1;
        } else {
          current.dialogueCount += 1;
        }
      }
      if (!current.firstPath && track.filePath.trim()) current.firstPath = track.filePath;
      map[shotId] = current;
    }
    return map;
  }, [audioTracks]);

  const resolveDialogueAudioTracksForShot = (shotId: string): AudioTrack[] =>
    useStoryboardStore
      .getState()
      .audioTracks
      .filter((track) => {
        const isShotTrack = track.id === ttsTrackIdForShot(shotId) || track.id.startsWith(`${ttsTrackIdForShot(shotId)}_`);
        if (!isShotTrack) return false;
        if (track.kind === "narration") return false;
        return looksLikeAudioPath(track.filePath);
      })
      .sort((left, right) => left.startFrame - right.startFrame || left.id.localeCompare(right.id));

  const stableAssetSeed = (key: string) => {
    let hash = 2166136261;
    for (let index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0);
  };

  const loadImageForHash = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`加载图片失败：${src}`));
      image.src = src;
    });

  const computeImageAverageHash = async (pathOrUrl: string): Promise<bigint | null> => {
    if (typeof window === "undefined" || typeof document === "undefined") return null;
    const src = toDesktopMediaSource(pathOrUrl);
    if (!src) return null;
    try {
      const image = await loadImageForHash(src);
      const canvas = document.createElement("canvas");
      canvas.width = CHARACTER_VIEW_HASH_SIZE;
      canvas.height = CHARACTER_VIEW_HASH_SIZE;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(image, 0, 0, CHARACTER_VIEW_HASH_SIZE, CHARACTER_VIEW_HASH_SIZE);
      const data = context.getImageData(0, 0, CHARACTER_VIEW_HASH_SIZE, CHARACTER_VIEW_HASH_SIZE).data;
      const grayValues: number[] = [];
      for (let index = 0; index < data.length; index += 4) {
        const gray = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
        grayValues.push(gray);
      }
      const avg = grayValues.reduce((sum, value) => sum + value, 0) / grayValues.length;
      let hash = 0n;
      grayValues.forEach((value, bitIndex) => {
        if (value >= avg) hash |= 1n << BigInt(bitIndex);
      });
      return hash;
    } catch {
      return null;
    }
  };

  const hammingDistance64 = (left: bigint, right: bigint): number => {
    let value = left ^ right;
    let count = 0;
    while (value !== 0n) {
      count += Number(value & 1n);
      value >>= 1n;
    }
    return count;
  };

  const detectLowDiversityThreeViews = async (paths: string[]) => {
    const targets = paths.slice(0, 3);
    if (targets.length < 3) return { inspected: false, lowDiversity: false, distances: [] as number[] };
    const hashes = await Promise.all(targets.map((path) => computeImageAverageHash(path)));
    if (hashes.some((value) => value === null)) return { inspected: false, lowDiversity: false, distances: [] as number[] };
    const [frontHash, sideHash, backHash] = hashes as [bigint, bigint, bigint];
    const distances = [
      hammingDistance64(frontHash, sideHash),
      hammingDistance64(frontHash, backHash),
      hammingDistance64(sideHash, backHash)
    ];
    const nearDuplicatePairs = distances.filter((distance) => distance <= CHARACTER_VIEW_DUPLICATE_HAMMING_THRESHOLD).length;
    const lowDiversity = nearDuplicatePairs >= 2 || Math.max(...distances) <= CHARACTER_VIEW_DUPLICATE_HAMMING_THRESHOLD + 4;
    return { inspected: true, lowDiversity, distances };
  };

  const makeAssetGenerationShot = (id: string, title: string, prompt: string, negativePrompt = "", seed?: number): Shot => ({
    id,
    sequenceId: currentSequenceId,
    order: 1,
    title,
    durationFrames: Math.max(1, project.fps || 24),
    dialogue: "",
    notes: "",
    tags: [],
    storyPrompt: prompt,
    negativePrompt,
    videoPrompt: "",
    videoMode: "single_frame",
    seed,
    characterRefs: [],
    sceneRefId: ""
  });

  const sanitizeCharacterViewContext = (context: string) =>
    normalizeStoryInput(context)
      .replace(
        /(三视图|三面图|多视图|多角度|设定板|角色设定板|角色表|转面设定板|front[\s_-]*view|side[\s_-]*view|back[\s_-]*view|turnaround|character sheet|model sheet|multi[\s_-]*view|split[\s_-]*screen|diptych|triptych|collage)/gi,
        " "
      )
      .replace(/\s{2,}/g, " ")
      .trim();

  const buildCharacterViewPrompt = (name: string, context: string, view: "front" | "side" | "back") => {
    const viewLabel = view === "front" ? "正视图" : view === "side" ? "右侧正交侧视图" : "正后方背视图";
    const backgroundPrompt = CHARACTER_BACKGROUND_PRESET_TEXT[settings.characterBackgroundPreset ?? "gray"];
    const sanitizedContext = sanitizeCharacterViewContext(context);
    const angleInstruction =
      view === "front"
        ? "正面 0 度，身体朝向镜头，双脚完整落地，只允许正面单角度。front view, body yaw 0 degree, facing camera, single-view only."
        : view === "side"
          ? "右侧 90 度正交侧视，人物严格侧身，头部和身体朝向画面右侧，只允许右侧单角度。strict right profile, body yaw 90 degree, side view only, no front-facing."
          : "背面 180 度，人物背对镜头，完整展示后背、发型后部、服装背面和鞋跟，只允许背面单角度。strict back view, body yaw 180 degree, back-facing only, face not visible.";
    const core = mergePromptFragments([
      "single character, solo",
      "single-view full-body orthographic character reference",
      "orthographic view",
      "single panel character reference, no sheet layout, no split layout",
      "full body centered, exactly one person",
      "character occupies about 75% to 90% of frame height",
      "fully clothed",
      "complete outfit",
      "top, bottom or robe, and shoes clearly visible",
      viewLabel,
      `角色：${name}`,
      angleInstruction,
      "只保留角色设定信息与服装设计",
      "不要叙事场景",
      "不要与他人互动",
      sanitizedContext
    ]);
    const constraints = mergePromptFragments([
      backgroundPrompt,
      "A-pose 或自然站姿",
      "站立稳定",
      "单张图只允许一个角色",
      "单张图只允许一个角度",
      "画面只允许一个人体实体，禁止并排双人、镜像双人、克隆分身",
      "exactly one person, no clone, no mirrored twin, no duplicate body",
      "禁止同画面出现第二角度、第二姿态、第二个分身",
      "禁止 front+back 同画面、side+back 同画面、left+right 同画面",
      "禁止多视图拼版、转面设定板、拼图排版、分屏",
      "无第二人物",
      "无群像",
      "无场景叙事",
      "无武打动作",
      "无道具遮挡",
      "无裁切",
      "no three-quarter view",
      "no 3/4 view",
      "完整穿衣",
      "完整服装设计",
      "上衣、下装或长袍、鞋子都要清楚可见",
      "全身完整入镜，头顶到鞋底必须全部在画面内，保留上下边距",
      "镜头距离为中远景，禁止半身、胸像、特写构图",
      "同一角色三视图必须保持同一张脸、同一发型、同一体型比例、同一服装款式与配色",
      "必须与参考正视图为同一角色身份，不允许变成另一个人",
      "不允许在 front/side/back 之间换装、换脸、换发型、换年龄、换体型",
      "禁止裸露、内衣态、泳装态、赤膊",
      "服装统一且前后侧一致",
      "面部与体型一致",
      view === "front" ? "front-only, not side, not back" : "",
      view === "side" ? "strict side-only, not front, not back, not looking at camera" : "",
      view === "back" ? "strict back-only, no visible face, no looking back, no side face" : "",
      "写实角色参考图",
      "美术统一"
    ]);
    return `${core}。严格要求：${constraints}。`;
  };

  const buildCharacterViewNegativePrompt = (view: "front" | "side" | "back", baseNegativePrompt: string) => {
    const viewConstraint =
      view === "front"
        ? "side profile, side view, back view, rear view, three quarter view, 3/4 view, turned torso"
        : view === "side"
          ? "front view, facing camera, back view, rear view, three quarter view, 3/4 view, turned torso, both eyes frontal"
          : "front view, facing camera, side profile, looking at camera, face visible, three quarter back view, over shoulder";
    const multiCharacterConstraint =
      "two characters, two bodies, duplicate character, cloned person, mirrored twin, side by side characters, split composition, front and back in one image, side and back in one image, multi pose sheet, turnaround sheet, character sheet layout";
    const identityDriftConstraint =
      "different face, another person, different hairstyle, hair length changed, costume change, outfit change, color palette changed, body shape changed, age changed";
    const cropConstraint =
      "portrait crop, bust shot, upper body only, close-up portrait, headshot, cowboy shot, cut off head, cut off feet, cropped body, selfie framing";
    return `${baseNegativePrompt}, ${viewConstraint}, ${multiCharacterConstraint}, ${identityDriftConstraint}, ${cropConstraint}`;
  };

  const buildSceneImagePrompt = (sceneName: string, scenePrompt: string) => {
    const prompt = scenePrompt.trim() || `${sceneName} 场景设定图`;
    return `${prompt}。无人物，无角色，无动物，无群像，无主体表演，仅保留环境本身。不要出现打斗、对白、姿态、剪影或任何人的痕迹。空间关系清晰，环境一致，材质稳定，光影明确，场景设定图，写实电影美术。`;
  };

  const buildSkyboxDescription = (sceneName: string, scenePrompt: string) => {
    const prompt = scenePrompt.trim() || `${sceneName} 场景设定`;
    const presetPrompt = SKYBOX_PROMPT_PRESET_TEXT[settings.skyboxPromptPreset ?? "day_exterior"];
    return `${prompt}。${presetPrompt}。生成可复用天空盒六面。严格要求：六张图都不得出现任何人物、角色、动物、群像、道具持有人物表演；只保留纯环境空间。要求空间结构统一、材质一致、光照一致、可支撑不同镜头角度下的场景一致性。`;
  };

  const buildCharacterViewSelectionTokenOverrides = (
    view: "front" | "side" | "back",
    frameImagePath: string,
    negativePrompt: string
  ) => ({
    FRAME_IMAGE_PATH: frameImagePath,
    NEGATIVE_PROMPT: negativePrompt,
    CHARACTER_FRONT_VIEW: view === "front" ? "true" : "false",
    CHARACTER_FRONT_RIGHT_VIEW: "false",
    CHARACTER_RIGHT_VIEW: view === "side" ? "true" : "false",
    CHARACTER_BACK_VIEW: view === "back" ? "true" : "false",
    CHARACTER_LEFT_VIEW: "false",
    CHARACTER_FRONT_LEFT_VIEW: "false"
  });

  const shouldFallbackAssetWorkflow = (error: unknown): boolean => {
    const text = String(error ?? "").toLowerCase();
    if (!text) return false;
    const isComfyQueueFailure =
      text.includes("提交 comfy 任务失败") ||
      text.includes("http 400") ||
      text.includes("/prompt") ||
      text.includes("queue prompt") ||
      text.includes("node_errors");
    if (!isComfyQueueFailure) return false;
    return (
      text.includes("missing_node_type") ||
      text.includes("custom node may not be installed") ||
      text.includes("prompt_outputs_failed_validation") ||
      text.includes("exception when validating node") ||
      (text.includes("keyerror") && text.includes("validating node"))
    );
  };

  const shouldRetryEmergencyImageWorkflow = (error: unknown): boolean => {
    const text = String(error ?? "").toLowerCase();
    if (!text) return false;
    return (
      shouldFallbackAssetWorkflow(error) ||
      text.includes("missing_node_type") ||
      text.includes("prompt_outputs_failed_validation") ||
      text.includes("custom node may not be installed")
    );
  };

  const resolveCharacterWorkflowJson = (runtimeSettings: ComfySettings): string => {
    const existing = runtimeSettings.characterWorkflowJson?.trim();
    const mode = resolveEffectiveAssetWorkflowMode(
      "character",
      runtimeSettings.characterAssetWorkflowMode ?? DEFAULT_CHARACTER_ASSET_WORKFLOW_MODE,
      existing ?? ""
    ) as CharacterAssetWorkflowMode;
    const selectedModel = runtimeSettings.characterAssetModelName?.trim() || DEFAULT_CHARACTER_ASSET_MODEL;
    if (existing && !shouldAutoRewriteAssetWorkflow(existing, mode, "character")) return existing;
    const builtIn =
      mode === "advanced_multiview"
        ? buildCharacterAdvancedWorkflowTemplateJson(
            selectedModel,
            runtimeSettings.characterTemplatePreset ?? "portrait",
            runtimeSettings.characterRenderPreset ?? "stable_fullbody"
          )
        : buildCharacterWorkflowTemplateJson(
            selectedModel,
            runtimeSettings.characterTemplatePreset ?? "portrait",
            runtimeSettings.characterRenderPreset ?? "stable_fullbody"
          );
    persistSettings((previous) => ({ ...previous, characterWorkflowJson: builtIn }));
    appendLog(
      existing
        ? mode === "advanced_multiview"
          ? "检测到旧版或断链角色工作流，已自动改写为内置高级多视角模板"
          : "检测到断链角色工作流，已自动改写为内置角色三视图模板"
        : mode === "advanced_multiview"
          ? "未配置专用角色三视图工作流，已自动写入内置高级多视角模板"
          : "未配置专用角色三视图工作流，已自动写入当前内置三视图模板"
    );
    return builtIn;
  };

  const resolveSkyboxWorkflowJson = (runtimeSettings: ComfySettings): string => {
    const existing = runtimeSettings.skyboxWorkflowJson?.trim();
    const mode = resolveEffectiveAssetWorkflowMode(
      "skybox",
      runtimeSettings.skyboxAssetWorkflowMode ?? DEFAULT_SKYBOX_ASSET_WORKFLOW_MODE,
      existing ?? ""
    ) as SkyboxAssetWorkflowMode;
    const selectedModel = runtimeSettings.skyboxAssetModelName?.trim() || DEFAULT_SKYBOX_ASSET_MODEL;
    if (existing && !shouldAutoRewriteAssetWorkflow(existing, mode, "skybox")) return existing;
    const builtIn =
      mode === "advanced_panorama"
        ? buildSkyboxPanoramaWorkflowTemplateJson(selectedModel, runtimeSettings.skyboxTemplatePreset ?? "wide")
        : buildSkyboxWorkflowTemplateJson(
            selectedModel,
            runtimeSettings.skyboxTemplatePreset ?? "wide"
          );
    persistSettings((previous) => ({ ...previous, skyboxWorkflowJson: builtIn }));
    appendLog(
      existing
        ? mode === "advanced_panorama"
          ? "检测到旧版或断链天空盒工作流，已自动改写为内置高级全景转六面模板"
          : "检测到断链天空盒工作流，已自动改写为内置天空盒模板"
        : mode === "advanced_panorama"
          ? "未配置专用天空盒工作流，已自动写入内置高级全景转六面模板"
          : "未配置专用天空盒工作流，已自动写入当前内置天空盒模板"
    );
    return builtIn;
  };

  const generateCharacterThreeViews = async (
    runtimeSettings: ComfySettings,
    name: string,
    context: string,
    baseSeed: number
  ) => {
    const mode = resolveEffectiveAssetWorkflowMode(
      "character",
      runtimeSettings.characterAssetWorkflowMode ?? DEFAULT_CHARACTER_ASSET_WORKFLOW_MODE,
      runtimeSettings.characterWorkflowJson?.trim() ?? ""
    ) as CharacterAssetWorkflowMode;
    const workflowOverride = resolveCharacterWorkflowJson(runtimeSettings);
    const negativePrompt = appendNegativePrompt(
      runtimeSettings.characterAssetNegativePrompt?.trim() || DEFAULT_CHARACTER_NEGATIVE_PROMPT,
      [
        "single angle only",
        "multiple angles",
        "two angles",
        "multi view",
        "multiview",
        "turnaround sheet",
        "character sheet",
        "contact sheet",
        "split screen",
        "diptych",
        "triptych",
        "collage",
        "front and back in one image",
        "side and back in one image",
        "two bodies one frame",
        "duplicate character",
        "mirrored twin",
        "duplicate pose",
        "duplicate body",
        "mirrored body"
      ]
    );
    const runBasicThreeViews = async (workflowJsonOverride: string, seedBase: number) => {
      const [front, side, back] = await Promise.all([
        generateShotAsset(
          runtimeSettings,
          makeAssetGenerationShot(`asset_char_${name}_front`, `${name} 正视图`, buildCharacterViewPrompt(name, context, "front"), "", seedBase),
          0,
          "image",
          [],
          [],
          {
            workflowJsonOverride,
            tokenOverrides: { NEGATIVE_PROMPT: buildCharacterViewNegativePrompt("front", negativePrompt) }
          }
        ),
        generateShotAsset(
          runtimeSettings,
          makeAssetGenerationShot(
            `asset_char_${name}_side`,
            `${name} 侧视图`,
            buildCharacterViewPrompt(name, context, "side"),
            "",
            seedBase + 101
          ),
          0,
          "image",
          [],
          [],
          {
            workflowJsonOverride,
            tokenOverrides: { NEGATIVE_PROMPT: buildCharacterViewNegativePrompt("side", negativePrompt) }
          }
        ),
        generateShotAsset(
          runtimeSettings,
          makeAssetGenerationShot(
            `asset_char_${name}_back`,
            `${name} 背视图`,
            buildCharacterViewPrompt(name, context, "back"),
            "",
            seedBase + 202
          ),
          0,
          "image",
          [],
          [],
          {
            workflowJsonOverride,
            tokenOverrides: { NEGATIVE_PROMPT: buildCharacterViewNegativePrompt("back", negativePrompt) }
          }
        )
      ]);
      return { front, side, back };
    };

    if (mode !== "advanced_multiview") {
      return runBasicThreeViews(workflowOverride, baseSeed);
    }

    const referenceWorkflow = buildCharacterWorkflowTemplateJson(
      runtimeSettings.characterAssetModelName?.trim() || DEFAULT_CHARACTER_ASSET_MODEL,
      runtimeSettings.characterTemplatePreset ?? "portrait",
      runtimeSettings.characterRenderPreset ?? "stable_fullbody"
    );
    const referenceFront = await generateShotAsset(
      runtimeSettings,
      makeAssetGenerationShot(`asset_char_${name}_reference`, `${name} 参考正视图`, buildCharacterViewPrompt(name, context, "front"), "", baseSeed),
      0,
      "image",
      [],
      [],
      {
        workflowJsonOverride: referenceWorkflow,
        tokenOverrides: { NEGATIVE_PROMPT: negativePrompt }
      }
    );
    const referencePath = referenceFront.localPath || referenceFront.previewUrl;
    try {
      const mvSeed = baseSeed + 11;
      const front = await generateShotAsset(
        runtimeSettings,
        makeAssetGenerationShot(`asset_char_${name}_front`, `${name} 正视图`, buildCharacterViewPrompt(name, context, "front"), "", mvSeed),
        0,
        "image",
        [],
        [],
        {
          workflowJsonOverride: workflowOverride,
          tokenOverrides: buildCharacterViewSelectionTokenOverrides(
            "front",
            referencePath,
            buildCharacterViewNegativePrompt("front", negativePrompt)
          )
        }
      );
      const frontAnchorPath = front.localPath || referencePath;
      const side = await generateShotAsset(
        runtimeSettings,
        makeAssetGenerationShot(`asset_char_${name}_side`, `${name} 侧视图`, buildCharacterViewPrompt(name, context, "side"), "", mvSeed),
        0,
        "image",
        [],
        [],
        {
          workflowJsonOverride: workflowOverride,
          tokenOverrides: buildCharacterViewSelectionTokenOverrides(
            "side",
            frontAnchorPath,
            buildCharacterViewNegativePrompt("side", negativePrompt)
          )
        }
      );
      const back = await generateShotAsset(
        runtimeSettings,
        makeAssetGenerationShot(`asset_char_${name}_back`, `${name} 背视图`, buildCharacterViewPrompt(name, context, "back"), "", mvSeed),
        0,
        "image",
        [],
        [],
        {
          workflowJsonOverride: workflowOverride,
          tokenOverrides: buildCharacterViewSelectionTokenOverrides(
            "back",
            frontAnchorPath,
            buildCharacterViewNegativePrompt("back", negativePrompt)
          )
        }
      );
      return { front, side, back };
    } catch (error) {
      if (!shouldFallbackAssetWorkflow(error)) throw error;
      throw new Error(
        `角色高级多视角工作流不可用，已禁止自动降级基础三视图模板：${String(error)}。` +
          `当前已强制 MVAdapter 使用方形分辨率（避免非方形触发 einops rearrange 失败）。` +
          `请确认 ComfyUI-MVAdapter 版本与模型权重匹配后重试。`
      );
    }
  };

  const characterPromptPreviewContext = "黑色长风衣，短发，身形修长，服装与体型统一，鞋靴完整可见";
  const characterPromptPreviews = {
    front: buildCharacterViewPrompt("示例角色", characterPromptPreviewContext, "front"),
    side: buildCharacterViewPrompt("示例角色", characterPromptPreviewContext, "side"),
    back: buildCharacterViewPrompt("示例角色", characterPromptPreviewContext, "back")
  };
  const skyboxPromptPreviewBase = buildSkyboxDescription(
    "河边",
    "傍晚河边，桥梁与浅滩清晰，可供人物调度，环境纯净，无人物"
  );
  const skyboxFacePromptPreviews: Array<{ face: string; prompt: string }> = [
    { face: "front", prompt: `场景天空盒 front 面，正前方主参考方向，空间朝前展开，纯环境。${skyboxPromptPreviewBase}` },
    { face: "right", prompt: `场景天空盒 right 面，相对 front 右转 90 度，展示右侧连续空间，纯环境。${skyboxPromptPreviewBase}` },
    { face: "back", prompt: `场景天空盒 back 面，相对 front 反向 180 度，展示后方连续空间，纯环境。${skyboxPromptPreviewBase}` },
    { face: "left", prompt: `场景天空盒 left 面，相对 front 左转 90 度，展示左侧连续空间，纯环境。${skyboxPromptPreviewBase}` },
    { face: "up", prompt: `场景天空盒 up 面，抬头仰视顶部空间，只保留天空或天花结构，纯环境。${skyboxPromptPreviewBase}` },
    { face: "down", prompt: `场景天空盒 down 面，俯视地面或底部结构，只保留底部环境，纯环境。${skyboxPromptPreviewBase}` }
  ];

  const summarizeDependencyReport = (report: WorkflowDependencyReport | null): string => {
    if (!report) return "未执行节点体检";
    return `${report.availableNodeTypes}/${report.totalNodeTypes} 节点可用`;
  };

  const formatMissingNodes = (report: WorkflowDependencyReport | null): string =>
    report && report.missingNodeTypes.length > 0 ? report.missingNodeTypes.join("、") : "无";

  const formatHintPlugins = (report: WorkflowDependencyReport | null): string =>
    report && report.hints.length > 0 ? report.hints.map((item) => item.plugin).join("、") : "无";

  const copyAssetModeSummary = async (kind: "character" | "skybox") => {
    const spec = kind === "character" ? characterAssetModeSpec : skyboxAssetModeSpec;
    const text = [
      `${kind === "character" ? "角色三视图" : "天空盒"}模式：${spec.label}`,
      `说明：${spec.summary}`,
      `必需节点：${spec.requiredNodes.join("；") || "无"}`,
      `模型要求：${spec.requiredModels.join("；") || "无"}`,
      `推荐插件：${spec.recommendedPlugins.join("；") || "无"}`,
      `备注：${spec.notes.join("；") || "无"}`
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      pushToast(`${kind === "character" ? "角色三视图" : "天空盒"}模式清单已复制`, "success");
    } catch (error) {
      pushToast(`复制模式清单失败：${String(error)}`, "error");
    }
  };

  const copyStoryboardModeSummary = async () => {
    const text = [
      `分镜工作流模式：${storyboardImageModeSpec.label}`,
      `当前基模：${settings.storyboardImageModelName?.trim() || DEFAULT_STORYBOARD_IMAGE_MODEL}`,
      `说明：${storyboardImageModeSpec.summary}`,
      `必需节点：${storyboardImageModeSpec.requiredNodes.join("；") || "无"}`,
      `模型要求：${storyboardImageModeSpec.requiredModels.join("；") || "无"}`,
      `推荐插件：${storyboardImageModeSpec.recommendedPlugins.join("；") || "无"}`,
      `备注：${storyboardImageModeSpec.notes.join("；") || "无"}`
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      pushToast("分镜工作流模式清单已复制", "success");
    } catch (error) {
      pushToast(`复制分镜工作流清单失败：${String(error)}`, "error");
    }
  };

  const writeBuiltinStoryboardWorkflow = (mode: StoryboardImageWorkflowMode) => {
    persistSettings((previous) => ({
      ...previous,
      storyboardImageWorkflowMode: mode,
      imageWorkflowJson:
        mode === "mature_asset_guided"
          ? STORYBOARD_IMAGE_ASSET_GUIDED_WORKFLOW_JSON
          : STORYBOARD_IMAGE_WORKFLOW_JSON
    }));
    pushToast(
      mode === "mature_asset_guided" ? "已写入内置成熟分镜模板" : "已写入内置 Qwen 兼容分镜模板",
      "success"
    );
    appendLog(
      mode === "mature_asset_guided"
        ? "已写入内置成熟分镜模板：scene-first img2img + IPAdapter"
        : "已写入内置 Qwen 兼容分镜模板",
      "info"
    );
  };

  const applyOneClickProfile = async (profile: "sd15" | "sdxl") => {
    const discovered = await discoverComfyLocalDirs().catch(() => ({
      rootDir: "",
      inputDir: "",
      outputDir: ""
    }));
    const storyboardModel = profile === "sd15" ? ONE_CLICK_SD15_STORYBOARD_MODEL : ONE_CLICK_SDXL_STORYBOARD_MODEL;
    const characterModel = profile === "sd15" ? ONE_CLICK_SD15_CHARACTER_MODEL : ONE_CLICK_SDXL_CHARACTER_MODEL;
    const skyboxModel = profile === "sd15" ? ONE_CLICK_SD15_SKYBOX_MODEL : ONE_CLICK_SDXL_SKYBOX_MODEL;
    persistSettings((previous) => {
      const previousRoot = previous.comfyRootDir.trim();
      const discoveredRoot = discovered.rootDir.trim();
      const comfyRootDir = previousRoot || discoveredRoot;
      const previousInput = previous.comfyInputDir.trim();
      const discoveredInput = discovered.inputDir.trim();
      const comfyInputDir =
        previousInput ||
        discoveredInput ||
        (comfyRootDir ? `${comfyRootDir.replace(/[\\/]+$/, "")}/input` : "");
      const outputDir = previous.outputDir.trim() || discovered.outputDir.trim() || previous.outputDir;
      return {
        ...previous,
        comfyRootDir,
        comfyInputDir,
        outputDir,
        storyboardImageWorkflowMode: "mature_asset_guided",
        imageWorkflowJson: STORYBOARD_IMAGE_ASSET_GUIDED_WORKFLOW_JSON,
        storyboardImageModelName: storyboardModel,
        characterAssetWorkflowMode: "basic_builtin",
        skyboxAssetWorkflowMode: "basic_builtin",
        requireDedicatedCharacterWorkflow: false,
        requireDedicatedSkyboxWorkflow: false,
        characterAssetModelName: characterModel,
        skyboxAssetModelName: skyboxModel,
        characterWorkflowJson: buildCharacterWorkflowTemplateJson(
          characterModel,
          previous.characterTemplatePreset ?? "portrait",
          previous.characterRenderPreset ?? "stable_fullbody"
        ),
        skyboxWorkflowJson: buildSkyboxWorkflowTemplateJson(
          skyboxModel,
          previous.skyboxTemplatePreset ?? "wide"
        ),
        videoGenerationMode: "local_motion"
      };
    });
    const label = profile === "sd15" ? "SD1.5" : "SDXL";
    appendLog(`已应用 ${label} 一键整片配置：成熟分镜模板 + 基础资产模板 + 本地视频模式`);
    pushToast(`已应用 ${label} 一键整片配置`, "success");
  };

  const copyAssetDiagnosticSummary = async (kind: "character" | "skybox") => {
    const diagnostic = kind === "character" ? characterWorkflowDiagnostic : skyboxWorkflowDiagnostic;
    const spec = kind === "character" ? characterAssetModeSpec : skyboxAssetModeSpec;
    const issues = kind === "character" ? characterIssueSummary : skyboxIssueSummary;
    const label = kind === "character" ? "角色三视图" : "天空盒";
    const lines = [
      `${label}当前模式：${spec.label}`,
      `工作流配置：${diagnostic?.workflowConfigured ? "已配置专用工作流" : "未配置专用工作流"}`,
      `问题摘要：${issues.join("；")}`
    ];
    if (diagnostic) {
      lines.push(`Token 预检：${diagnostic.templateValid ? "通过" : `缺少 ${diagnostic.templateMissing.join("、")}`}`);
      lines.push(`节点体检：${summarizeDependencyReport(diagnostic.dependencyReport)}`);
      lines.push(`缺失节点：${formatMissingNodes(diagnostic.dependencyReport)}`);
      lines.push(`建议插件：${formatHintPlugins(diagnostic.dependencyReport)}`);
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      pushToast(`${label}体检结论已复制`, "success");
    } catch (error) {
      pushToast(`复制体检结论失败：${String(error)}`, "error");
    }
  };

  const copyStoryboardDiagnosticSummary = async () => {
    const diagnostic = storyboardWorkflowDiagnostic;
    const lines = [
      `分镜图当前模式：${storyboardImageModeSpec.label}`,
      `工作流配置：${settings.imageWorkflowJson.trim() ? "已配置" : "未配置"}`,
      `基础模型：${settings.storyboardImageModelName?.trim() || DEFAULT_STORYBOARD_IMAGE_MODEL}`
    ];
    if (diagnostic) {
      lines.push(`Token 预检：${diagnostic.templateValid ? "通过" : `缺少 ${diagnostic.templateMissing.join("、")}`}`);
      lines.push(`节点体检：${summarizeDependencyReport(diagnostic.dependencyReport)}`);
      lines.push(`缺失节点：${formatMissingNodes(diagnostic.dependencyReport)}`);
      lines.push(`建议插件：${formatHintPlugins(diagnostic.dependencyReport)}`);
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      pushToast("分镜模板体检结论已复制", "success");
    } catch (error) {
      pushToast(`复制分镜体检结论失败：${String(error)}`, "error");
    }
  };

  const buildAssetDiagnostic = async (kind: "character" | "skybox"): Promise<AssetWorkflowDiagnostic> => {
    const workflowConfigured = kind === "character" ? Boolean(settings.characterWorkflowJson?.trim()) : Boolean(settings.skyboxWorkflowJson?.trim());
    const strictMode =
      kind === "character" ? settings.requireDedicatedCharacterWorkflow !== false : settings.requireDedicatedSkyboxWorkflow !== false;
    const mode =
      kind === "character"
        ? settings.characterAssetWorkflowMode ?? DEFAULT_CHARACTER_ASSET_WORKFLOW_MODE
        : settings.skyboxAssetWorkflowMode ?? DEFAULT_SKYBOX_ASSET_WORKFLOW_MODE;
    const modeSpec =
      kind === "character"
        ? buildCharacterAssetModeSpec(mode as CharacterAssetWorkflowMode, settings.characterAssetModelName?.trim() || DEFAULT_CHARACTER_ASSET_MODEL)
        : buildSkyboxAssetModeSpec(mode as SkyboxAssetWorkflowMode, settings.skyboxAssetModelName?.trim() || DEFAULT_SKYBOX_ASSET_MODEL);
    const workflowText =
      (kind === "character" ? settings.characterWorkflowJson?.trim() : settings.skyboxWorkflowJson?.trim()) ||
      settings.imageWorkflowJson;
    const selectedModel =
      kind === "character"
        ? settings.characterAssetModelName?.trim() || DEFAULT_CHARACTER_ASSET_MODEL
        : settings.skyboxAssetModelName?.trim() || DEFAULT_SKYBOX_ASSET_MODEL;
    let options = availableCheckpointOptions;
    if (options.length === 0) {
      try {
        options = await listComfyCheckpointOptions(settings.baseUrl);
        setAvailableCheckpointOptions(options);
      } catch {
        options = [];
      }
    }
    const modelVisible = options.length > 0 ? options.includes(selectedModel) : null;
    const templateCheck = validateWorkflowTemplate(workflowText, settings.tokenMapping);
    const heuristic = inspectAssetWorkflowHeuristics(workflowText, kind);
    if (
      ((kind === "character" && mode === "advanced_multiview") || (kind === "skybox" && mode === "advanced_panorama")) &&
      !workflowConfigured
    ) {
      heuristic.warnings.unshift("当前已选择高级资产模式，但尚未配置专用工作流 JSON。");
    }
    let dependencyReport: WorkflowDependencyReport | null = null;
    try {
      dependencyReport = await inspectWorkflowDependencies(settings.baseUrl, workflowText);
    } catch (error) {
      appendLog(`${kind === "character" ? "角色三视图" : "天空盒"}节点体检失败：${String(error)}`, "error");
    }
    return {
      kind,
      mode,
      modeSpec,
      workflowConfigured,
      strictMode,
      selectedModel,
      modelVisible,
      templateValid: templateCheck.ok,
      templateMissing: templateCheck.missing,
      usedTokens: templateCheck.used,
      dependencyReport,
      heuristic
    };
  };

  const buildStoryboardDiagnostic = async (): Promise<AssetWorkflowDiagnostic> => {
    let options = availableCheckpointOptions;
    if (options.length === 0) {
      try {
        options = await listComfyCheckpointOptions(settings.baseUrl);
        setAvailableCheckpointOptions(options);
      } catch {
        options = [];
      }
    }
    const selectedModel = settings.storyboardImageModelName?.trim() || DEFAULT_STORYBOARD_IMAGE_MODEL;
    const modelVisible = options.length > 0 ? options.includes(selectedModel) : null;
    const templateCheck = validateWorkflowTemplate(settings.imageWorkflowJson, settings.tokenMapping);
    const heuristic = inspectStoryboardWorkflowHeuristics(settings.imageWorkflowJson);
    let dependencyReport: WorkflowDependencyReport | null = null;
    try {
      dependencyReport = await inspectWorkflowDependencies(settings.baseUrl, settings.imageWorkflowJson);
    } catch (error) {
      appendLog(`分镜节点体检失败：${String(error)}`, "error");
    }
    return {
      kind: "storyboard",
      mode: storyboardImageWorkflowMode,
      modeSpec: storyboardImageModeSpec,
      workflowConfigured: Boolean(settings.imageWorkflowJson.trim()),
      strictMode: storyboardImageWorkflowMode === "mature_asset_guided",
      selectedModel,
      modelVisible,
      templateValid: templateCheck.ok,
      templateMissing: templateCheck.missing,
      usedTokens: templateCheck.used,
      dependencyReport,
      heuristic
    };
  };

  const buildProvisionItemsFromShots = (items: Shot[]): NormalizedImportedShot[] =>
    items.map((shot) => {
      const prompt = shot.storyPrompt?.trim() ?? "";
      const dialogue = shot.dialogue ?? "";
      const notes = shot.notes ?? "";
      const context = [shot.title, prompt, dialogue, notes].filter(Boolean).join("\n");
      const inferredCharacterNames =
        (shot.characterRefs?.length ?? 0) > 0 ? [] : extractCharacterCandidates(context);
      const sceneName =
        shot.sourceSceneName?.trim() ||
        (shot.sceneRefId?.trim() ? "" : inferSceneName(context));
      const scenePrompt =
        shot.sourceScenePrompt?.trim() ||
        (sceneName ? buildScenePrompt(context, sceneName, inferredCharacterNames) : "");
      return {
        id: shot.id,
        title: shot.title,
        prompt,
        negativePrompt: shot.negativePrompt?.trim() ?? "",
        videoPrompt: shot.videoPrompt?.trim() ?? "",
        videoMode: shot.videoMode ?? "auto",
        videoStartFramePath: shot.videoStartFramePath?.trim() ?? "",
        videoEndFramePath: shot.videoEndFramePath?.trim() ?? "",
        skyboxFace: shot.skyboxFace ?? "auto",
        skyboxFaces: shot.skyboxFaces ?? [],
        skyboxFaceWeights: shot.skyboxFaceWeights ?? {},
        durationFrames: shot.durationFrames,
        seed: shot.seed,
        characterRefs: shot.characterRefs ?? [],
        sceneRefId: shot.sceneRefId ?? "",
        dialogue,
        notes,
        tags: shot.tags ?? [],
        characterNames:
          shot.sourceCharacterNames && shot.sourceCharacterNames.length > 0
            ? uniqueEntities(shot.sourceCharacterNames.map(sanitizeCharacterCandidate).filter(Boolean))
            : inferredCharacterNames,
        sceneName: sanitizeSceneCandidate(sceneName),
        scenePrompt
      };
    });

  const findAssetIdByName = (type: "character" | "scene" | "skybox", name: string) => {
    return findMatchingAssetId(useStoryboardStore.getState().assets, type, name);
  };

  const applyProvisionOverrides = (
    items: NormalizedImportedShot[],
    characterOverrides: Record<string, string>,
    skyboxOverrides: Record<string, string>
  ) =>
    items.map((item) => {
      const nextCharacterRefs = [...item.characterRefs];
      const nextCharacterNames: string[] = [];
      for (const name of item.characterNames) {
        const key = normalizeEntityKey(name);
        const override = characterOverrides[key] ?? "";
        if (override === "__new__") {
          nextCharacterNames.push(name);
          continue;
        }
        const resolved = override || findAssetIdByName("character", name);
        if (resolved) {
          nextCharacterRefs.push(resolved);
        } else {
          nextCharacterNames.push(name);
        }
      }

      let nextSceneRefId = item.sceneRefId;
      let nextSceneName = item.sceneName;
      let nextScenePrompt = item.scenePrompt;
      if (item.sceneName) {
        const key = normalizeEntityKey(item.sceneName);
        const override = skyboxOverrides[key] ?? "";
        if (override !== "__new__") {
          const resolved = override || findAssetIdByName("skybox", item.sceneName);
          if (resolved) {
            nextSceneRefId = resolved;
            nextSceneName = "";
            nextScenePrompt = "";
          }
        }
      }

      return {
        ...item,
        characterRefs: uniqueEntities(nextCharacterRefs),
        characterNames: uniqueEntities(nextCharacterNames),
        sceneRefId: nextSceneRefId,
        sceneName: nextSceneName,
        scenePrompt: nextScenePrompt
      };
    });

  const createCharacterAssetIfMissing = async (
    runtimeSettings: ComfySettings,
    name: string,
    context: string
  ): Promise<ProvisionCreateResult> => {
    const nameKey = normalizeEntityKey(name);
    const inFlight = nameKey ? characterProvisionInFlightRef.current.get(nameKey) : undefined;
    if (inFlight) return inFlight;

    const task: Promise<ProvisionCreateResult> = (async () => {
      const existingId = findAssetIdByName("character", name);
      if (existingId) {
        const asset = useStoryboardStore.getState().assets.find((item) => item.id === existingId);
        const front = asset?.characterFrontPath?.trim() || "";
        const side = asset?.characterSidePath?.trim() || "";
        const back = asset?.characterBackPath?.trim() || "";
        const threeViewPaths = [front, side, back].filter((value) => value.length > 0);
        const mode = resolveEffectiveAssetWorkflowMode(
          "character",
          runtimeSettings.characterAssetWorkflowMode ?? DEFAULT_CHARACTER_ASSET_WORKFLOW_MODE,
          runtimeSettings.characterWorkflowJson?.trim() ?? ""
        ) as CharacterAssetWorkflowMode;
        const strictAdvancedMode = mode === "advanced_multiview";
        const hasDistinctThreeViews = new Set(threeViewPaths).size >= 3;
        const hasLegacyBasicPrefix = threeViewPaths.some((value) => /character_threeview/i.test(value));
        const hasLegacyMvPrefix = threeViewPaths.some((value) => /character_mv_/i.test(value));
        const diversityCheck = await detectLowDiversityThreeViews(threeViewPaths);
        const hasLowVisualDiversity = diversityCheck.inspected && diversityCheck.lowDiversity;
        const shouldForceRegenerate =
          (strictAdvancedMode &&
            (threeViewPaths.length < 3 || !hasDistinctThreeViews || hasLegacyBasicPrefix || hasLowVisualDiversity)) ||
          (!strictAdvancedMode &&
            (threeViewPaths.length < 3 || !hasDistinctThreeViews || hasLegacyMvPrefix || hasLowVisualDiversity));
        if (!shouldForceRegenerate) {
          return {
            assetId: existingId,
            previewPaths: threeViewPaths
          };
        }
        if (hasLowVisualDiversity) {
          appendLog(
            `检测到角色三视图过于相似（哈希距离：${diversityCheck.distances.join("/") || "unknown"}），已自动重建：${name}`,
            "info"
          );
        }
        appendLog(`检测到旧版或异常角色三视图资产，已自动重建：${name}`, "info");
      }
      const safeContext = stripCharacterMentions(context.trim() || `${name} 的角色设定`, extractCharacterCandidates(context));
      const baseSeed = stableAssetSeed(`${name}|${safeContext}|character`);
      appendLog(`开始生成角色三视图：${name}`);
      appendLog(`角色三视图使用专用工作流：${name}`);
      const { front, side, back } = await generateCharacterThreeViews(runtimeSettings, name, safeContext, baseSeed);

      const beforeIds = new Set(useStoryboardStore.getState().assets.map((asset) => asset.id));
      addAsset({
        type: "character",
        name,
        filePath: front.localPath || front.previewUrl,
        characterFrontPath: front.localPath || front.previewUrl,
        characterSidePath: side.localPath || side.previewUrl,
        characterBackPath: back.localPath || back.previewUrl
      });
      const created =
        useStoryboardStore
          .getState()
          .assets.find((asset) => !beforeIds.has(asset.id) && asset.type === "character" && normalizeEntityKey(asset.name) === normalizeEntityKey(name))
          ?.id ?? findAssetIdByName("character", name);
      appendLog(`角色三视图生成成功：${name}`);
      return {
        assetId: created,
        previewPaths: [
          front.localPath || front.previewUrl,
          side.localPath || side.previewUrl,
          back.localPath || back.previewUrl
        ].filter((value): value is string => Boolean(value))
      };
    })();

    if (nameKey) {
      characterProvisionInFlightRef.current.set(nameKey, task);
    }
    try {
      return await task;
    } finally {
      if (nameKey && characterProvisionInFlightRef.current.get(nameKey) === task) {
        characterProvisionInFlightRef.current.delete(nameKey);
      }
    }
  };

  const createSkyboxAssetIfMissing = async (
    runtimeSettings: ComfySettings,
    sceneName: string,
    scenePrompt: string,
    characterNames: string[] = []
  ): Promise<ProvisionCreateResult> => {
    const sceneKey = normalizeEntityKey(sceneName);
    const inFlight = sceneKey ? skyboxProvisionInFlightRef.current.get(sceneKey) : undefined;
    if (inFlight) return inFlight;

    const task: Promise<ProvisionCreateResult> = (async () => {
      const existingId = findAssetIdByName("skybox", sceneName);
      if (existingId) {
        const asset = useStoryboardStore.getState().assets.find((item) => item.id === existingId);
        return {
          assetId: existingId,
          previewPaths: [
            asset?.skyboxFaces?.front,
            asset?.skyboxFaces?.right,
            asset?.skyboxFaces?.left,
            asset?.skyboxFaces?.back
          ].filter((value): value is string => Boolean(value))
        };
      }
      const sanitizedScenePrompt = stripCharacterMentions(scenePrompt, characterNames);
      const description = buildSkyboxDescription(
        sceneName,
        sanitizedScenePrompt || buildSceneImagePrompt(sceneName, sanitizedScenePrompt)
      );
      const skyboxWorkflow = resolveSkyboxWorkflowJson(runtimeSettings);
      const resolvedSkyboxMode = resolveEffectiveAssetWorkflowMode(
        "skybox",
        runtimeSettings.skyboxAssetWorkflowMode ?? DEFAULT_SKYBOX_ASSET_WORKFLOW_MODE,
        runtimeSettings.skyboxWorkflowJson?.trim() ?? ""
      ) as SkyboxAssetWorkflowMode;
      appendLog(`开始生成场景天空盒：${sceneName}`);
      appendLog(`场景天空盒使用专用工作流：${sceneName}`);
      let result: SkyboxGenerationResult;
      try {
        result = await generateSkyboxFaces(
          {
            ...runtimeSettings,
            skyboxWorkflowJson: skyboxWorkflow
          },
          description
        );
      } catch (error) {
        if (resolvedSkyboxMode !== "advanced_panorama" || !shouldFallbackAssetWorkflow(error)) throw error;
        throw new Error(
          `天空盒高级全景工作流不可用，已停止自动降级基础六面模板：${String(error)}。当前基础六面模板只能生成六次近似文生图，不能稳定产出真正四面八方连续的天空盒。请先修复 ComfyUI_pytorch360convert / Apply Circular Padding Model 节点加载。`
        );
      }
      const primaryPath =
        result.faces.front ||
        result.faces.right ||
        result.faces.back ||
        result.faces.left ||
        result.faces.up ||
        result.faces.down ||
        "";
      if (!primaryPath) {
        throw new Error("天空盒生成完成但未拿到任何可用面");
      }
      const beforeIds = new Set(useStoryboardStore.getState().assets.map((asset) => asset.id));
      addAsset({
        type: "skybox",
        name: sceneName,
        filePath: primaryPath,
        skyboxDescription: description,
        skyboxFaces: result.faces,
        skyboxUpdateEvents: []
      });
      const created =
        useStoryboardStore
          .getState()
          .assets.find((asset) => !beforeIds.has(asset.id) && asset.type === "skybox" && normalizeEntityKey(asset.name) === normalizeEntityKey(sceneName))
          ?.id ?? findAssetIdByName("skybox", sceneName);
      appendLog(`场景天空盒生成成功：${sceneName}`);
      return {
        assetId: created,
        previewPaths: [
          result.faces.front,
          result.faces.right,
          result.faces.left,
          result.faces.back
        ].filter((value): value is string => Boolean(value))
      };
    })();

    if (sceneKey) {
      skyboxProvisionInFlightRef.current.set(sceneKey, task);
    }
    try {
      return await task;
    } finally {
      if (sceneKey && skyboxProvisionInFlightRef.current.get(sceneKey) === task) {
        skyboxProvisionInFlightRef.current.delete(sceneKey);
      }
    }
  };

  const provisionAssetsForItems = async (
    items: NormalizedImportedShot[],
    runtimeSettings: ComfySettings,
    options?: { bindShots?: boolean; onProgress?: (current: number, total: number, message: string) => void }
  ) => {
    const characterIdMap = new Map<string, string>();
    const sceneIdMap = new Map<string, string>();
    let reusedCharacters = 0;
    let createdCharacters = 0;
    let reusedSkyboxes = 0;
    let createdSkyboxes = 0;
    const tasks: Array<{ kind: "character" | "skybox"; name: string }> = [];
    for (const item of items) {
      for (const name of item.characterNames) {
        const key = normalizeEntityKey(name);
        if (!key || tasks.some((task) => task.kind === "character" && normalizeEntityKey(task.name) === key)) continue;
        tasks.push({ kind: "character", name });
      }
      if (item.sceneName) {
        const key = normalizeEntityKey(item.sceneName);
        if (!key || tasks.some((task) => task.kind === "skybox" && normalizeEntityKey(task.name) === key)) continue;
        tasks.push({ kind: "skybox", name: item.sceneName });
      }
    }
    for (const task of tasks) {
      upsertProvisionPreview({
        key: `${task.kind}:${normalizeEntityKey(task.name)}`,
        kind: task.kind,
        name: task.name,
        status: "pending",
        detail: task.kind === "character" ? "已识别，等待生成角色三视图" : "已识别，等待生成场景天空盒",
        thumbs: []
      });
    }
    let progressIndex = 0;

    for (const item of items) {
      for (const name of item.characterNames) {
        const key = normalizeEntityKey(name);
        if (!key || characterIdMap.has(key)) continue;
        if (isSuspiciousCharacterCandidate(name)) {
          appendLog(`角色三视图跳过：${name}（名称可疑，已拦截）`, "error");
          upsertProvisionPreview({
            key: `character:${key}`,
            kind: "character",
            name,
            status: "skipped",
            detail: "名称可疑，已跳过角色三视图生成",
            thumbs: []
          });
          continue;
        }
        progressIndex += 1;
        options?.onProgress?.(progressIndex, tasks.length, `角色三视图：${name}`);
        upsertProvisionPreview({
          key: `character:${key}`,
          kind: "character",
          name,
          status: "running",
          detail: "正在生成三视图",
          thumbs: []
        });
        try {
          const context = [item.prompt, item.notes, item.dialogue].filter(Boolean).join(" ");
          const reusedId = findAssetIdByName("character", name);
          if (reusedId) {
            characterIdMap.set(key, reusedId);
            reusedCharacters += 1;
            appendLog(`复用已有角色资产：${name}`);
            const asset = useStoryboardStore.getState().assets.find((assetItem) => assetItem.id === reusedId);
            upsertProvisionPreview({
              key: `character:${key}`,
              kind: "character",
              name,
              status: "reused",
              detail: "复用已有角色三视图",
              thumbs: [asset?.characterFrontPath, asset?.characterSidePath, asset?.characterBackPath].filter(
                (value): value is string => Boolean(value)
              )
            });
            continue;
          }
          const result = await createCharacterAssetIfMissing(runtimeSettings, name, context);
          if (result.assetId) {
            characterIdMap.set(key, result.assetId);
            createdCharacters += 1;
            upsertProvisionPreview({
              key: `character:${key}`,
              kind: "character",
              name,
              status: "success",
              detail: "角色三视图生成完成",
              thumbs: result.previewPaths
            });
          }
        } catch (error) {
          appendLog(`角色三视图生成失败：${name}，${String(error)}`, "error");
          upsertProvisionPreview({
            key: `character:${key}`,
            kind: "character",
            name,
            status: "failed",
            detail: `生成失败：${String(error)}`,
            thumbs: []
          });
        }
      }
      if (item.sceneName) {
        const key = normalizeEntityKey(item.sceneName);
        if (!sceneIdMap.has(key)) {
          if (isSuspiciousSceneCandidate(item.sceneName)) {
            appendLog(`场景天空盒跳过：${item.sceneName}（名称可疑，已拦截）`, "error");
            upsertProvisionPreview({
              key: `skybox:${key}`,
              kind: "skybox",
              name: item.sceneName,
              status: "skipped",
              detail: "名称可疑，已跳过天空盒生成",
              thumbs: []
            });
            continue;
          }
          progressIndex += 1;
          options?.onProgress?.(progressIndex, tasks.length, `场景天空盒：${item.sceneName}`);
          upsertProvisionPreview({
            key: `skybox:${key}`,
            kind: "skybox",
            name: item.sceneName,
            status: "running",
            detail: "正在生成天空盒六面",
            thumbs: []
          });
          try {
            const reusedId = findAssetIdByName("skybox", item.sceneName);
            if (reusedId) {
              sceneIdMap.set(key, reusedId);
              reusedSkyboxes += 1;
              appendLog(`复用已有场景天空盒：${item.sceneName}`);
              const asset = useStoryboardStore.getState().assets.find((assetItem) => assetItem.id === reusedId);
              upsertProvisionPreview({
                key: `skybox:${key}`,
                kind: "skybox",
                name: item.sceneName,
                status: "reused",
                detail: "复用已有场景天空盒",
                thumbs: [
                  asset?.skyboxFaces?.front,
                  asset?.skyboxFaces?.right,
                  asset?.skyboxFaces?.left,
                  asset?.skyboxFaces?.back
                ].filter((value): value is string => Boolean(value))
              });
              continue;
            }
            const result = await createSkyboxAssetIfMissing(
              runtimeSettings,
              item.sceneName,
              item.scenePrompt || item.prompt || item.notes,
              item.characterNames
            );
            if (result.assetId) {
              sceneIdMap.set(key, result.assetId);
              createdSkyboxes += 1;
              upsertProvisionPreview({
                key: `skybox:${key}`,
                kind: "skybox",
                name: item.sceneName,
                status: "success",
                detail: "场景天空盒生成完成",
                thumbs: result.previewPaths
              });
            }
          } catch (error) {
            appendLog(`场景天空盒生成失败：${item.sceneName}，${String(error)}`, "error");
            upsertProvisionPreview({
              key: `skybox:${key}`,
              kind: "skybox",
              name: item.sceneName,
              status: "failed",
              detail: `生成失败：${String(error)}`,
              thumbs: []
            });
          }
        }
      }
    }

    if (options?.bindShots) {
      for (const item of items) {
        const characterRefs = uniqueEntities(
          [
            ...item.characterRefs,
            ...item.characterNames
              .map((name) => characterIdMap.get(normalizeEntityKey(name)) ?? findAssetIdByName("character", name))
              .filter((value): value is string => Boolean(value))
          ].filter(Boolean)
        );
        const sceneRefId =
          item.sceneRefId ||
          (item.sceneName
            ? sceneIdMap.get(normalizeEntityKey(item.sceneName)) || findAssetIdByName("skybox", item.sceneName)
            : "");
        updateShotFields(item.id, {
          characterRefs,
          sceneRefId
        });
      }
    }

    return {
      reusedCharacters,
      createdCharacters,
      reusedSkyboxes,
      createdSkyboxes,
      totalTasks: tasks.length
    };
  };

  const ensureProvisionedAssetsForCurrentShots = async (
    shotsForRun: Shot[],
    runtimeSettings: ComfySettings,
    sourceLabel: string
  ) => {
    const items = buildProvisionItemsFromShots(shotsForRun).filter(
      (item) => item.characterNames.length > 0 || Boolean(item.sceneName)
    );
    if (items.length === 0) {
      appendLog(`${sourceLabel}跳过：当前镜头没有待识别的新角色或新场景元数据`);
      return true;
    }
    const detectedCharacterNames = uniqueEntities(items.flatMap((item) => item.characterNames));
    const detectedSceneNames = uniqueEntities(items.map((item) => item.sceneName).filter(Boolean));
    if (!(await ensureComfyReady())) {
      appendLog(`${sourceLabel}中断：ComfyUI 未连接`, "error");
      setPipelineState(`${sourceLabel}中断：ComfyUI 未连接`);
      return false;
    }
    setProvisionPreviews([]);
    appendLog(
      `${sourceLabel}识别结果：角色 ${detectedCharacterNames.length > 0 ? detectedCharacterNames.join("、") : "无"}；场景 ${detectedSceneNames.length > 0 ? detectedSceneNames.join("、") : "无"}`
    );
    appendLog(`${sourceLabel}开始`);
    try {
      const summary = await provisionAssetsForItems(items, runtimeSettings, {
        bindShots: true,
        onProgress: (current, total, message) => {
          const prefix = total > 0 ? `(${current}/${total})` : "";
          setPipelineState(`${sourceLabel}${prefix} ${message}`);
          if (runAllActive) {
            const base = 8;
            const span = 14;
            const ratio = total > 0 ? current / total : 1;
            setRunAllProgress(base + span * ratio);
            setRunAllStage(`步骤 1/6 资产预生成 · ${message}`);
          }
        }
      });
      appendLog(
        `${sourceLabel}完成：新建角色 ${summary.createdCharacters} / 复用角色 ${summary.reusedCharacters} / 新建天空盒 ${summary.createdSkyboxes} / 复用天空盒 ${summary.reusedSkyboxes}`
      );
      return true;
    } catch (error) {
      const message = String(error);
      appendLog(`${sourceLabel}失败：${message}`, "error");
      setPipelineState(`${sourceLabel}失败：${message}`);
      return false;
    }
  };

  const autoProvisionAssetsForImportedShots = async (items: NormalizedImportedShot[], runtimeSettings: ComfySettings) => {
    if (!autoProvisionAssets || items.length === 0) return;
    if (phase === "running") {
      appendLog("自动资产生成跳过：当前已有任务在运行", "error");
      return;
    }
    if (!(await ensureComfyReady())) {
      appendLog("自动资产生成跳过：ComfyUI 未连接", "error");
      return;
    }
    setPhase("running");
    setPipelineState("自动资产生成：预生成角色三视图与场景天空盒");
    try {
      const summary = await provisionAssetsForItems(items, runtimeSettings, { bindShots: true });
      appendLog(
        `自动资产生成与镜头绑定完成：新建角色 ${summary.createdCharacters} / 复用角色 ${summary.reusedCharacters} / 新建天空盒 ${summary.createdSkyboxes} / 复用天空盒 ${summary.reusedSkyboxes}`
      );
    } finally {
      setPhase("idle");
      setPipelineState("空闲");
    }
  };

  const onPreGenerateProvisionAssets = async (
    sourceLabel: string,
    items: NormalizedImportedShot[],
    characterOverrides: Record<string, string>,
    skyboxOverrides: Record<string, string>,
    mode: "all" | "characters" | "skyboxes"
  ) => {
    if (phase === "running") {
      appendLog(`${sourceLabel}预生成被跳过：当前已有任务在运行`, "error");
      return;
    }
    if (items.length === 0) {
      appendLog(`${sourceLabel}预生成被跳过：当前没有可处理的镜头`, "error");
      return;
    }
    const appliedItems = applyProvisionOverrides(items, characterOverrides, skyboxOverrides)
      .map((item) => {
        if (mode === "characters") {
          return {
            ...item,
            sceneName: "",
            scenePrompt: "",
            sceneRefId: ""
          };
        }
        if (mode === "skyboxes") {
          return {
            ...item,
            characterNames: [],
            characterRefs: []
          };
        }
        return item;
      })
      .filter((item) => {
        if (mode === "characters") {
          return item.characterNames.length > 0;
        }
        if (mode === "skyboxes") {
          return Boolean(item.sceneName);
        }
        return item.characterNames.length > 0 || Boolean(item.sceneName);
      });

    if (appliedItems.length === 0) {
      appendLog(`${sourceLabel}预生成跳过：当前映射结果没有缺失资产需要创建`);
      pushToast("当前映射结果没有缺失资产需要生成", "warning");
      return;
    }
    if (!(await ensureComfyReady())) {
      appendLog(`${sourceLabel}预生成中断：ComfyUI 未连接`, "error");
      return;
    }

    const label =
      mode === "characters"
        ? `${sourceLabel}预生成角色三视图`
        : mode === "skyboxes"
          ? `${sourceLabel}预生成场景天空盒`
          : `${sourceLabel}预生成缺失资产`;
    setPhase("running");
    setPipelineState(label);
    try {
      appendLog(`${label}开始，共 ${appliedItems.length} 条镜头上下文`);
      const summary = await provisionAssetsForItems(appliedItems, settings, { bindShots: false });
      appendLog(
        `${label}完成：新建角色 ${summary.createdCharacters} / 复用角色 ${summary.reusedCharacters} / 新建天空盒 ${summary.createdSkyboxes} / 复用天空盒 ${summary.reusedSkyboxes}`
      );
      pushToast(`${label}完成`, "success");
    } catch (error) {
      appendLog(`${label}失败：${String(error)}`, "error");
      pushToast(`${label}失败：${String(error)}`, "error");
    } finally {
      setPhase("idle");
      setPipelineState("空闲");
    }
  };

  const applyImportedShots = (parsed: { shots?: Array<Record<string, unknown>> }) => {
    const normalizedItems = normalizeImportedShots(parsed);
    return applyImportedShotItems(normalizedItems);
  };

  const applyImportedShotItems = (normalizedItems: NormalizedImportedShot[]) => {
    if (normalizedItems.length === 0) {
      throw new Error("脚本格式无效：缺少 shots 数组");
    }
    replaceShotsForCurrentSequence(
      normalizedItems.map((item) => ({
        id: item.id,
        title: item.title,
        prompt: item.prompt,
        negativePrompt: item.negativePrompt,
        videoPrompt: item.videoPrompt,
        videoMode: item.videoMode,
        videoStartFramePath: item.videoStartFramePath,
        videoEndFramePath: item.videoEndFramePath,
        skyboxFace: item.skyboxFace,
        skyboxFaces: item.skyboxFaces,
        skyboxFaceWeights: item.skyboxFaceWeights,
        cameraYaw: item.cameraYaw,
        cameraPitch: item.cameraPitch,
        cameraFov: item.cameraFov,
        durationSec: item.durationSec,
        durationFrames: item.durationFrames,
        seed: item.seed,
        characterRefs: item.characterRefs,
        sceneRefId: item.sceneRefId,
        sourceCharacterNames: item.characterNames,
        sourceSceneName: item.sceneName,
        sourceScenePrompt: item.scenePrompt,
        dialogue: item.dialogue,
        notes: item.notes,
        tags: item.tags
      }))
    );
    return normalizedItems;
  };

  const onImportScript = async () => {
    try {
      const parsed = JSON.parse(scriptText) as { shots?: Array<Record<string, unknown>> };
      const normalized = normalizeImportedShots(parsed);
      const items = applyImportedShotItems(
        applyProvisionOverrides(normalized, scriptCharacterOverrides, scriptSkyboxOverrides)
      );
      pushToast(`已导入 ${items.length} 个镜头`, "success");
      appendLog(`导入镜头脚本成功，共 ${items.length} 条`);
      await autoProvisionAssetsForImportedShots(items, settings);
    } catch (error) {
      pushToast(`导入失败：${String(error)}`, "error");
      appendLog(`导入镜头脚本失败：${String(error)}`, "error");
    }
  };

  const onParseStory = async (shouldImport = false) => {
    try {
      const parsed = parseStoryToShotScript(storyText);
      const formatted = JSON.stringify(parsed, null, 2);
      setScriptText(formatted);
      appendLog(`故事解析成功，共生成 ${parsed.shots.length} 条镜头脚本`);
      if (shouldImport) {
        const normalized = normalizeImportedShots(parsed as unknown as { shots?: Array<Record<string, unknown>> });
        const items = applyImportedShotItems(
          applyProvisionOverrides(normalized, storyCharacterOverrides, storySkyboxOverrides)
        );
        pushToast(`故事已解析并导入 ${items.length} 个镜头`, "success");
        appendLog(`故事解析并导入成功，共 ${items.length} 条`);
        await autoProvisionAssetsForImportedShots(items, settings);
      } else {
        pushToast(`故事解析成功，共 ${parsed.shots.length} 个镜头`, "success");
      }
    } catch (error) {
      pushToast(`故事解析失败：${String(error)}`, "error");
      appendLog(`故事解析失败：${String(error)}`, "error");
    }
  };

  const onCheckConnection = async () => {
    try {
      const result = await pingComfyWithDetail(settings.baseUrl);
      setConnectionLabel(result.ok ? "已连接" : "未连接");
      if (result.ok) {
        try {
          const options = await listComfyCheckpointOptions(settings.baseUrl);
          setAvailableCheckpointOptions(options);
          appendLog(`已读取 Comfy checkpoint 下拉，共 ${options.length} 项`);
        } catch (error) {
          setAvailableCheckpointOptions([]);
          appendLog(`读取 Comfy checkpoint 下拉失败：${String(error)}`, "error");
        }
      } else {
        setAvailableCheckpointOptions([]);
      }
      pushToast(result.ok ? "ComfyUI 连接正常" : result.message, result.ok ? "success" : "warning");
      appendLog(result.ok ? "ComfyUI 连接正常" : `ComfyUI 连接失败：${result.message}`, result.ok ? "info" : "error");
    } catch (error) {
      setConnectionLabel("未连接");
      setAvailableCheckpointOptions([]);
      pushToast(`连接失败：${String(error)}`, "error");
      appendLog(`ComfyUI 连接失败：${String(error)}`, "error");
    }
  };

  const onInspectWorkflows = async () => {
    try {
      setPipelineState("体检工作流依赖中");
      appendLog("开始体检工作流依赖（图片 + 视频 + 配音）");
      setLastDependencyHints([]);
      const reports = await Promise.all([
        inspectWorkflowDependencies(settings.baseUrl, settings.imageWorkflowJson),
        inspectWorkflowDependencies(settings.baseUrl, settings.videoWorkflowJson),
        settings.audioWorkflowJson?.trim()
          ? inspectWorkflowDependencies(settings.baseUrl, settings.audioWorkflowJson)
          : Promise.resolve(null)
      ]);
      const [imageReport, videoReport, audioReport] = reports;

      const reportLines = [
        `图片工作流节点: ${imageReport.availableNodeTypes}/${imageReport.totalNodeTypes} 可用`,
        `视频工作流节点: ${videoReport.availableNodeTypes}/${videoReport.totalNodeTypes} 可用`
      ];
      if (audioReport) {
        reportLines.push(`配音工作流节点: ${audioReport.availableNodeTypes}/${audioReport.totalNodeTypes} 可用`);
      }
      appendLog(reportLines.join("；"));

      const missing = [...imageReport.missingNodeTypes, ...videoReport.missingNodeTypes, ...(audioReport?.missingNodeTypes ?? [])];
      if (missing.length === 0) {
        pushToast("体检通过：未发现缺失节点", "success");
        appendLog("体检通过：未发现缺失节点");
        return;
      }

      const uniqueMissing = [...new Set(missing)];
      appendLog(`缺失节点类型：${uniqueMissing.join(", ")}`, "error");

      const hints = [...imageReport.hints, ...videoReport.hints, ...(audioReport?.hints ?? [])].filter(
        (item, index, all) => all.findIndex((cur) => cur.plugin === item.plugin) === index
      );
      setLastDependencyHints(hints);
      if (hints.length > 0) {
        for (const hint of hints) {
          appendLog(`建议安装插件：${hint.plugin} (${hint.repo})`, "error");
        }
      }
      pushToast(`发现 ${uniqueMissing.length} 个缺失节点类型，详情见日志`, "warning");
    } catch (error) {
      pushToast(`体检失败：${String(error)}`, "error");
      appendLog(`体检工作流失败：${String(error)}`, "error");
    } finally {
      setPipelineState("空闲");
    }
  };

  const onInstallSuggestedPlugins = async () => {
    try {
      if (lastDependencyHints.length === 0) {
        pushToast("当前没有可安装建议，请先体检工作流", "warning");
        return;
      }
      const comfyRoot = inferComfyRootDir(settings);
      if (!comfyRoot) {
        pushToast("请先填写 ComfyUI 根目录（或正确配置 output/input 目录）", "error");
        appendLog("安装建议插件失败：未能推断 ComfyUI 根目录", "error");
        return;
      }
      setPipelineState("安装建议插件中");
      appendLog(`开始安装建议插件，Comfy 根目录：${comfyRoot}`);
      const result = await installSuggestedPlugins(comfyRoot, lastDependencyHints);
      if (result.installed.length > 0) {
        appendLog(`已安装/更新：${result.installed.join(", ")}`);
      }
      if (result.skipped.length > 0) {
        appendLog(`已跳过：${result.skipped.join(", ")}`);
      }
      if (result.failed.length > 0) {
        for (const item of result.failed) {
          appendLog(`安装失败：${item.repo} -> ${item.error}`, "error");
        }
      }
      if (result.failed.length === 0) {
        pushToast("建议插件安装完成", "success");
      } else {
        pushToast(`建议插件安装完成，失败 ${result.failed.length} 项`, "warning");
      }

      appendLog("开始安装后自动复检");
      const reports = await Promise.all([
        inspectWorkflowDependencies(settings.baseUrl, settings.imageWorkflowJson),
        inspectWorkflowDependencies(settings.baseUrl, settings.videoWorkflowJson),
        settings.audioWorkflowJson?.trim()
          ? inspectWorkflowDependencies(settings.baseUrl, settings.audioWorkflowJson)
          : Promise.resolve(null)
      ]);
      const [imageReport, videoReport, audioReport] = reports;
      const remainMissing = [
        ...imageReport.missingNodeTypes,
        ...videoReport.missingNodeTypes,
        ...(audioReport?.missingNodeTypes ?? [])
      ];
      const uniqueRemain = [...new Set(remainMissing)];
      if (uniqueRemain.length === 0) {
        appendLog("安装后复检通过：未发现缺失节点");
      } else {
        appendLog(`安装后仍缺失节点：${uniqueRemain.join(", ")}`, "error");
      }
    } catch (error) {
      pushToast(`安装建议插件失败：${String(error)}`, "error");
      appendLog(`安装建议插件失败：${String(error)}`, "error");
    } finally {
      setPipelineState("空闲");
    }
  };

  const onCheckModelHealth = async () => {
    try {
      const comfyRoot = inferComfyRootDir(settings);
      if (!comfyRoot) {
        pushToast("请先填写 ComfyUI 根目录（或正确配置 output/input 目录）", "error");
        appendLog("模型体检失败：未能推断 ComfyUI 根目录", "error");
        return;
      }
      setPipelineState("体检模型文件中");
      appendLog(`开始体检模型目录：${comfyRoot}`);
      const report = await checkComfyModelHealth(comfyRoot);
      const checklistLines: string[] = [];
      let hardFail = false;
      for (const item of report.checks) {
        const status = item.exists ? `存在(${item.fileCount})` : "缺失";
        appendLog(`模型检查 - ${item.label}: ${status} @ ${item.path}`, item.required && !item.exists ? "error" : "info");
        if (item.required && !item.exists) hardFail = true;
        if (!item.exists || item.fileCount === 0) {
          checklistLines.push(`- ${item.label}`);
          checklistLines.push(`  目标目录: ${item.path}`);
          if (item.key === "checkpoints") {
            checklistLines.push("  建议模型: SDXL / SD1.5 主模型（.safetensors）");
            checklistLines.push("  建议来源: https://civitai.com/ 或 https://huggingface.co/");
          } else if (item.key === "vae") {
            checklistLines.push("  建议模型: 通用 VAE（与底模匹配）");
            checklistLines.push("  建议来源: https://huggingface.co/");
          } else if (item.key === "controlnet") {
            checklistLines.push("  建议模型: ControlNet 常用权重（lineart/depth/openpose）");
            checklistLines.push("  建议来源: https://huggingface.co/lllyasviel");
          } else if (item.key === "ipadapter" || item.key === "clip_vision") {
            checklistLines.push("  建议模型: IPAdapter 权重 + CLIP Vision");
            checklistLines.push("  建议来源: https://huggingface.co/h94/IP-Adapter");
          } else if (item.key === "animatediff_models" || item.key === "animatediff_models_plugin") {
            checklistLines.push("  建议模型: AnimateDiff motion module");
            checklistLines.push("  建议来源: https://huggingface.co/guoyww/animatediff");
          } else if (item.key === "loras") {
            checklistLines.push("  建议模型: 角色/风格 LoRA");
            checklistLines.push("  建议来源: https://civitai.com/ 或 https://huggingface.co/");
          }
        }
      }
      const motion = report.checks.find((item) => item.key === "animatediff_models");
      const motionPlugin = report.checks.find((item) => item.key === "animatediff_models_plugin");
      const motionCount = (motion?.fileCount ?? 0) + (motionPlugin?.fileCount ?? 0);
      if (motionCount === 0) {
        appendLog("AnimateDiff 未检测到 motion model（可选）。需要时请放入 models/animatediff_models 或插件 models 目录。", "error");
      }
      const checklistText =
        checklistLines.length === 0
          ? "当前模型体检未发现缺失项。"
          : `模型缺失下载清单\n${checklistLines.join("\n")}`;
      setLastModelChecklist(checklistText);
      if (hardFail) {
        pushToast("模型体检完成：存在必需目录缺失，详情见日志", "warning");
      } else {
        pushToast("模型体检完成", "success");
      }
    } catch (error) {
      pushToast(`模型体检失败：${String(error)}`, "error");
      appendLog(`模型体检失败：${String(error)}`, "error");
    } finally {
      setPipelineState("空闲");
    }
  };

  const runAssetWorkflowDiagnostic = async (kind: "character" | "skybox" | "storyboard") => {
    const label = kind === "character" ? "角色三视图" : kind === "skybox" ? "天空盒" : "分镜图";
    try {
      setPipelineState(`${label}体检中`);
      appendLog(`开始${label}专用工作流体检`);
      const diagnostic =
        kind === "storyboard" ? await buildStoryboardDiagnostic() : await buildAssetDiagnostic(kind);
      if (kind === "character") {
        setCharacterWorkflowDiagnostic(diagnostic);
      } else if (kind === "skybox") {
        setSkyboxWorkflowDiagnostic(diagnostic);
      } else {
        setStoryboardWorkflowDiagnostic(diagnostic);
      }
      appendLog(
        `${label}体检完成：模式 ${diagnostic.modeSpec.label}；${diagnostic.workflowConfigured ? "已配置专用工作流" : "未配置专用工作流"}；模型 ${
          diagnostic.modelVisible == null ? "未读取可见性" : diagnostic.modelVisible ? "已命中 Comfy 下拉" : "未命中 Comfy 下拉"
        }；节点 ${summarizeDependencyReport(diagnostic.dependencyReport)}`
      );
      appendLog(`${label}模式要求：节点 ${diagnostic.modeSpec.requiredNodes.join(" / ")}；模型 ${diagnostic.modeSpec.requiredModels.join(" / ")}`);
      if (diagnostic.modeSpec.recommendedPlugins.length > 0) {
        appendLog(`${label}模式推荐插件：${diagnostic.modeSpec.recommendedPlugins.join(" / ")}`);
      }
      if (!diagnostic.templateValid) {
        appendLog(`${label}体检失败：缺少 token ${diagnostic.templateMissing.join(", ")}`, "error");
        pushToast(`${label}体检失败：缺少 ${diagnostic.templateMissing.join(", ")}`, "error");
        return;
      }
      if (!diagnostic.workflowConfigured && diagnostic.strictMode) {
        appendLog(`${label}严格资产模式已开启：未配置专用工作流时正式生成会被拦截`, "error");
      }
      if (diagnostic.dependencyReport?.missingNodeTypes.length) {
        appendLog(`${label}缺失节点：${diagnostic.dependencyReport.missingNodeTypes.join(", ")}`, "error");
      }
      diagnostic.heuristic.warnings.forEach((item) => appendLog(`${label}工作流警告：${item}`, "error"));
      diagnostic.heuristic.notes.forEach((item) => appendLog(`${label}工作流说明：${item}`));
      pushToast(`${label}体检完成`, diagnostic.dependencyReport?.missingNodeTypes.length ? "warning" : "success");
    } catch (error) {
      pushToast(`${label}体检失败：${String(error)}`, "error");
      appendLog(`${label}体检失败：${String(error)}`, "error");
    } finally {
      setPipelineState("空闲");
    }
  };

  const onTrialCharacterWorkflow = async () => {
    try {
      if (!(await ensureComfyReady())) return;
      const runtimeSettings = {
        ...settings,
        renderWidth: project.width,
        renderHeight: project.height,
        renderFps: project.fps
      };
      setPipelineState("试跑角色三视图模板");
      appendLog("开始单步试跑角色三视图模板");
      upsertProvisionPreview({
        key: "character:__trial__",
        kind: "character",
        name: "模板试跑角色",
        status: "running",
        detail: "正在试跑正/侧/背三张角色设定图",
        thumbs: []
      });
      const sampleName = "模板试跑角色";
      const sampleContext = stripCharacterMentions(
        "黑色长风衣，短发，身形修长，鞋靴完整可见，服装统一，标准角色设定",
        [sampleName]
      );
      const { front, side, back } = await generateCharacterThreeViews(
        runtimeSettings,
        sampleName,
        sampleContext,
        stableAssetSeed(`trial|${sampleName}|${sampleContext}`)
      );
      upsertProvisionPreview({
        key: "character:__trial__",
        kind: "character",
        name: "模板试跑角色",
        status: "success",
        detail: "角色三视图模板试跑完成",
        thumbs: [
          front.localPath || front.previewUrl,
          side.localPath || side.previewUrl,
          back.localPath || back.previewUrl
        ].filter((value): value is string => Boolean(value))
      });
      appendLog("角色三视图模板试跑成功");
      pushToast("角色三视图模板试跑成功", "success");
    } catch (error) {
      upsertProvisionPreview({
        key: "character:__trial__",
        kind: "character",
        name: "模板试跑角色",
        status: "failed",
        detail: `试跑失败：${String(error)}`,
        thumbs: []
      });
      pushToast(`角色三视图模板试跑失败：${String(error)}`, "error");
      appendLog(`角色三视图模板试跑失败：${String(error)}`, "error");
    } finally {
      setPipelineState("空闲");
    }
  };

  const onTrialSkyboxWorkflow = async () => {
    try {
      if (!(await ensureComfyReady())) return;
      const runtimeSettings = {
        ...settings,
        renderWidth: project.width,
        renderHeight: project.height,
        renderFps: project.fps
      };
      setPipelineState("试跑天空盒模板");
      appendLog("开始单步试跑天空盒模板");
      upsertProvisionPreview({
        key: "skybox:__trial__",
        kind: "skybox",
        name: "模板试跑天空盒",
        status: "running",
        detail: "正在试跑天空盒六面环境图",
        thumbs: []
      });
      const description = buildSkyboxDescription(
        "模板试跑河边",
        "傍晚河边，桥梁与浅滩清晰，纯环境，无人物，可供镜头调度"
      );
      const skyboxWorkflow = resolveSkyboxWorkflowJson(runtimeSettings);
      const result = await generateSkyboxFaces(
        {
          ...runtimeSettings,
          skyboxWorkflowJson: skyboxWorkflow || runtimeSettings.imageWorkflowJson
        },
        description
      );
      upsertProvisionPreview({
        key: "skybox:__trial__",
        kind: "skybox",
        name: "模板试跑天空盒",
        status: "success",
        detail: "天空盒模板试跑完成",
        thumbs: [
          result.faces.front,
          result.faces.right,
          result.faces.back,
          result.faces.left
        ].filter((value): value is string => Boolean(value))
      });
      appendLog("天空盒模板试跑成功");
      pushToast("天空盒模板试跑成功", "success");
    } catch (error) {
      upsertProvisionPreview({
        key: "skybox:__trial__",
        kind: "skybox",
        name: "模板试跑天空盒",
        status: "failed",
        detail: `试跑失败：${String(error)}`,
        thumbs: []
      });
      pushToast(`天空盒模板试跑失败：${String(error)}`, "error");
      appendLog(`天空盒模板试跑失败：${String(error)}`, "error");
    } finally {
      setPipelineState("空闲");
    }
  };

  const onCopyModelChecklist = async () => {
    if (!lastModelChecklist.trim()) {
      pushToast("暂无模型下载清单，请先点体检模型文件", "warning");
      return;
    }
    try {
      await navigator.clipboard.writeText(lastModelChecklist);
      pushToast("模型下载清单已复制", "success");
      appendLog("已复制模型下载清单");
    } catch (error) {
      pushToast(`复制失败：${String(error)}`, "error");
      appendLog(`复制模型下载清单失败：${String(error)}`, "error");
    }
  };

  const onAutoDetectComfy = async (quiet = false) => {
    try {
      const found = await discoverComfyEndpoints();
      if (found.length === 0) {
        if (!quiet) pushToast("未探测到可用 ComfyUI 地址，请确认桌面版已启动", "warning");
        setConnectionLabel("未连接");
        appendLog("自动探测 Comfy 地址失败：未发现可用端口", "error");
        return;
      }
      const first = found[0];
      persistSettings((previous) => ({ ...previous, baseUrl: first }));
      const localDirs = await discoverComfyLocalDirs();
      const changedLabels: string[] = [];
      persistSettings((previous) => {
        const next = { ...previous };
        if (!next.comfyRootDir.trim() && localDirs.rootDir) {
          next.comfyRootDir = localDirs.rootDir;
          changedLabels.push(`根目录: ${localDirs.rootDir}`);
        }
        if (!next.comfyInputDir.trim() && localDirs.inputDir) {
          next.comfyInputDir = localDirs.inputDir;
          changedLabels.push(`input: ${localDirs.inputDir}`);
        }
        if (!next.outputDir.trim() && localDirs.outputDir) {
          next.outputDir = localDirs.outputDir;
          changedLabels.push(`output: ${localDirs.outputDir}`);
        }
        return next;
      });
      if (!quiet) pushToast(`已探测到 ComfyUI：${first}`, "success");
      appendLog(`自动探测成功，已切换 Comfy 地址：${first}`);
      if (changedLabels.length > 0) {
        appendLog(`已自动补全 Comfy 路径：${changedLabels.join("；")}`);
      }
      const ping = await pingComfyWithDetail(first);
      setConnectionLabel(ping.ok ? "已连接" : "未连接");
      if (ping.ok) {
        try {
          const options = await listComfyCheckpointOptions(first);
          setAvailableCheckpointOptions(options);
          appendLog(`已读取 Comfy checkpoint 下拉，共 ${options.length} 项`);
        } catch (error) {
          setAvailableCheckpointOptions([]);
          appendLog(`读取 Comfy checkpoint 下拉失败：${String(error)}`, "error");
        }
      } else {
        setAvailableCheckpointOptions([]);
      }
    } catch (error) {
      if (!quiet) pushToast(`自动探测失败：${String(error)}`, "error");
      setConnectionLabel("未连接");
      setAvailableCheckpointOptions([]);
      appendLog(`自动探测 Comfy 地址失败：${String(error)}`, "error");
    }
  };

  const ensureComfyReady = async (): Promise<boolean> => {
    if (checkingRef.current) return false;
    checkingRef.current = true;
    try {
      const current = await pingComfyWithDetail(settings.baseUrl);
      if (current.ok) {
        setConnectionLabel("已连接");
        try {
          const options = await listComfyCheckpointOptions(settings.baseUrl);
          setAvailableCheckpointOptions(options);
        } catch {
          setAvailableCheckpointOptions([]);
        }
        return true;
      }
      const found = await discoverComfyEndpoints();
      const first = found[0];
      if (!first) {
        setConnectionLabel("未连接");
        appendLog("ComfyUI 未就绪：未探测到可用地址", "error");
        return false;
      }
      persistSettings((previous) => ({ ...previous, baseUrl: first }));
      const localDirs = await discoverComfyLocalDirs();
      const changedLabels: string[] = [];
      persistSettings((previous) => {
        const next = { ...previous };
        if (!next.comfyRootDir.trim() && localDirs.rootDir) {
          next.comfyRootDir = localDirs.rootDir;
          changedLabels.push(`根目录: ${localDirs.rootDir}`);
        }
        if (!next.comfyInputDir.trim() && localDirs.inputDir) {
          next.comfyInputDir = localDirs.inputDir;
          changedLabels.push(`input: ${localDirs.inputDir}`);
        }
        if (!next.outputDir.trim() && localDirs.outputDir) {
          next.outputDir = localDirs.outputDir;
          changedLabels.push(`output: ${localDirs.outputDir}`);
        }
        return next;
      });
      if (changedLabels.length > 0) {
        appendLog(`已自动补全 Comfy 路径：${changedLabels.join("；")}`);
      }
      const next = await pingComfyWithDetail(first);
      setConnectionLabel(next.ok ? "已连接" : "未连接");
      if (next.ok) {
        try {
          const options = await listComfyCheckpointOptions(first);
          setAvailableCheckpointOptions(options);
        } catch {
          setAvailableCheckpointOptions([]);
        }
      } else {
        setAvailableCheckpointOptions([]);
      }
      if (!next.ok) appendLog(`ComfyUI 连接失败：${next.message}`, "error");
      return next.ok;
    } finally {
      checkingRef.current = false;
    }
  };

  useEffect(() => {
    void onAutoDetectComfy(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onUploadWorkflow = async (kind: "image" | "video" | "audio", file?: File) => {
    if (!file) return;
    const text = await file.text();
    try {
      validateWorkflowJsonSyntax(text);
    } catch (error) {
      const label = kind === "image" ? "图片工作流" : kind === "video" ? "视频工作流" : "配音工作流";
      pushToast(`${label}加载失败：${String(error)}`, "error");
      appendLog(`${label}加载失败：${String(error)}`, "error");
      return;
    }
    const next = {
      ...settings,
      imageWorkflowJson: kind === "image" ? text : settings.imageWorkflowJson,
      videoWorkflowJson: kind === "video" ? text : settings.videoWorkflowJson,
      audioWorkflowJson: kind === "audio" ? text : settings.audioWorkflowJson
    };
    persistSettings(next);
    const check =
      kind === "audio"
        ? validateWorkflowTemplate(text, settings.tokenMapping, [
            settings.tokenMapping.dialogue.trim() || "DIALOGUE"
          ])
        : validateWorkflowTemplate(text, settings.tokenMapping);
    if (!check.ok) {
      pushToast("工作流已加载，但未检测到提示词 token，请检查高级设置映射", "warning");
      appendLog(`工作流已加载，但预检提示缺少 token：${check.missing.join(", ")}`, "error");
      return;
    }
    pushToast(
      kind === "image" ? "已加载图片工作流" : kind === "video" ? "已加载视频工作流" : "已加载配音工作流",
      "success"
    );
    appendLog(kind === "image" ? "已加载图片工作流" : kind === "video" ? "已加载视频工作流" : "已加载配音工作流");
  };

  const onUpdateTokenMapping = (key: keyof ComfySettings["tokenMapping"], value: string) => {
    persistSettings({
      ...settings,
      tokenMapping: {
        ...settings.tokenMapping,
        [key]: value.trim().toUpperCase().replace(/[{}]/g, "")
      }
    });
  };

  const generateDialogueTracksForShot = async (
    shot: Shot,
    shotIndex: number,
    runtimeSettings: ComfySettings,
    force: boolean
  ): Promise<boolean> => {
    const latestScopedShots = getScopedShotsSnapshot();
    const latestAssets = useStoryboardStore.getState().assets;
    const assetRuntimeSettings: ComfySettings = {
      ...runtimeSettings,
      renderWidth: project.width,
      renderHeight: project.height,
      renderFps: project.fps
    };
    const existingTracks = useStoryboardStore
      .getState()
      .audioTracks.filter((track) => track.id === ttsTrackIdForShot(shot.id) || track.id.startsWith(`${ttsTrackIdForShot(shot.id)}_`));
    const hasUsableAudio = existingTracks.some((track) => looksLikeAudioPath(track.filePath));
    if (!force && hasUsableAudio) return true;

    for (const track of existingTracks) {
      removeAudioTrack(track.id);
    }

    const segments = parseDialogueSegments(shot, latestAssets);
    if (segments.length === 0) return false;
    const durations = allocateSegmentDurations(shot.durationFrames, segments);
    const startFrame = selectShotStartFrame(useStoryboardStore.getState(), shot.id);
    let frameCursor = 0;

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segment = segments[segmentIndex]!;
      const segmentDuration = durations[segmentIndex] ?? 1;
      const label = segment.speaker ? `${shot.title} / ${segment.speaker}` : shot.title;
      const output = await generateShotAsset(
        assetRuntimeSettings,
        shot,
        shotIndex,
        "audio",
        latestScopedShots,
        latestAssets,
        {
          tokenOverrides: {
            DIALOGUE: segment.text,
            SPEAKER_NAME: segment.speaker,
            EMOTION: segment.emotion,
            DELIVERY_STYLE: segment.deliveryStyle,
            SPEECH_RATE: segment.speechRate,
            VOICE_PROFILE: segment.voiceProfile,
            CHARACTER_VOICE_PROFILES: segment.voiceProfile,
            SHOT_TITLE: label,
            DURATION_FRAMES: String(segmentDuration),
            DURATION_SEC: String((segmentDuration / Math.max(1, project.fps)).toFixed(2))
          },
          onProgress: (progress, message) => {
            const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
            const speakerLabel = segment.speaker ? ` / ${segment.speaker}` : "";
            setPipelineState(`镜头配音生成中：${shot.title}${speakerLabel}（${pct}%）${message ? ` · ${message}` : ""}`);
          }
        }
      );
      upsertAudioTrack({
        id: ttsTrackIdForSegment(shot.id, segmentIndex),
        projectId: project.id,
        filePath: output.localPath || output.previewUrl,
        startFrame: startFrame + frameCursor,
        gain: 1,
        kind: isNarrationSpeaker(segment.speaker) ? "narration" : "dialogue",
        label: segment.speaker
          ? `${isNarrationSpeaker(segment.speaker) ? "旁白" : "对白"} / ${segment.speaker}`
          : "对白"
      });
      frameCursor += segmentDuration;
    }
    return true;
  };

  const onGenerateSingle = async (
    kind: "image" | "video" | "audio",
    shotId: string,
    force = false,
    runtimeSettings: ComfySettings = settings
  ) => {
    const latestScopedShots = getScopedShotsSnapshot();
    const shot = latestScopedShots.find((item) => item.id === shotId);
    if (!shot) return false;
    if (kind === "video" && shot.generatedVideoPath?.trim() && !looksLikeVideoPath(shot.generatedVideoPath)) {
      updateShotFields(shot.id, { generatedVideoPath: "" });
      appendLog(`检测到历史遗留的非视频路径，已清空并重新生成：${shot.title}`, "error");
    }
    if (
      kind === "audio" &&
      audioTracks.some(
        (track) =>
          (track.id === ttsTrackIdForShot(shot.id) || track.id.startsWith(`${ttsTrackIdForShot(shot.id)}_`)) &&
          track.filePath.trim() &&
          !looksLikeAudioPath(track.filePath)
      )
    ) {
      audioTracks
        .filter(
          (track) =>
            track.id === ttsTrackIdForShot(shot.id) || track.id.startsWith(`${ttsTrackIdForShot(shot.id)}_`)
        )
        .forEach((track) => updateAudioTrack(track.id, { filePath: "" }));
      appendLog(`检测到历史遗留的非音频路径，已清空并重新生成：${shot.title}`, "error");
    }
    if (!force) {
      if (kind === "audio") {
        if ((audioSummaryByShot[shot.id]?.count ?? 0) > 0) return true;
      } else if (hasUsableGeneratedAsset(kind, shot)) {
        return true;
      }
    }
    const shotIndex = latestScopedShots.findIndex((item) => item.id === shotId);
    if (shotIndex < 0) return false;
    const latestAssets = useStoryboardStore.getState().assets;
    const assetRuntimeSettings: ComfySettings = {
      ...runtimeSettings,
      renderWidth: project.width,
      renderHeight: project.height,
      renderFps: project.fps
    };
    setAssetStatus(kind, shotId, "running");
    appendLog(`开始生成${kind === "image" ? "分镜图" : kind === "video" ? "视频" : "配音"}：${shot.title}`);
    try {
      if (kind === "image") {
        appendLog(`分镜参考预览：${shot.title} -> ${describeShotReferencePreview(resolveShotReferencePreview(shot, latestAssets))}`);
      }
      if (kind === "audio") {
        const ok = await generateDialogueTracksForShot(shot, shotIndex, runtimeSettings, force);
        if (!ok) throw new Error("未生成任何对白分段");
        setAssetStatus(kind, shotId, "success");
        setLastErrorByShot((previous) => ({ ...previous, [shotId]: "" }));
        const summary = summarizeDialogueSegments(parseDialogueSegments(shot, assets));
        appendLog(
          `生成成功：${shot.title} -> 已输出 ${summary.total || 1} 段配音（对白 ${summary.dialogue} / 旁白 ${summary.narration}）`
        );
        return true;
      }
      let dialogueAudioTracksForVideo: AudioTrack[] = [];
      if (kind === "video" && runtimeSettings.videoGenerationMode !== "local_motion" && runtimeSettings.videoWorkflowJson.trim()) {
        const lipSync = inspectVideoWorkflowLipSyncSupport(runtimeSettings.videoWorkflowJson, runtimeSettings.tokenMapping);
        if (shot.dialogue.trim()) {
          if (lipSync.usesDialogueAudioPathToken) {
            if (!runtimeSettings.audioWorkflowJson?.trim()) {
              appendLog(`镜头 ${shot.title} 含对白，但未配置配音工作流，当前无法自动生成口型同步音频`, "error");
            } else {
              const audioOk = await generateDialogueTracksForShot(shot, shotIndex, assetRuntimeSettings, force);
              if (!audioOk) {
                appendLog(`镜头 ${shot.title} 含对白，但未产出可用于口型同步的对白音频`, "error");
              }
            }
            dialogueAudioTracksForVideo = resolveDialogueAudioTracksForShot(shot.id);
            if (dialogueAudioTracksForVideo.length === 0) {
              appendLog(`镜头 ${shot.title} 当前没有可注入视频工作流的角色对白音频，视频会继续生成但无法保证口型同步`, "error");
            }
          } else {
            appendLog(`镜头 ${shot.title} 含对白，但当前视频工作流未引用对白音频 token，无法保证口型同步`, "error");
          }
        }
      }
      const output = await generateShotAsset(assetRuntimeSettings, shot, shotIndex, kind, latestScopedShots, latestAssets, {
        dialogueAudioTracks: kind === "video" ? dialogueAudioTracksForVideo : undefined,
        onProgress: (progress, message) => {
          const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
          const label = kind === "image" ? "分镜图" : kind === "video" ? "镜头视频" : "镜头配音";
          setPipelineState(`${label}生成中：${shot.title}（${pct}%）${message ? ` · ${message}` : ""}`);
        }
      });
      if (kind === "image") {
        updateShotFields(shot.id, { generatedImagePath: output.previewUrl });
      } else if (kind === "video") {
        updateShotFields(shot.id, { generatedVideoPath: output.localPath || output.previewUrl });
      }
      setAssetStatus(kind, shotId, "success");
      setLastErrorByShot((previous) => ({ ...previous, [shotId]: "" }));
      appendLog(
        `生成成功：${shot.title} -> ${kind === "image" ? output.previewUrl : output.localPath || output.previewUrl}`
      );
      return true;
    } catch (error) {
      const currentStoryboardMode =
        runtimeSettings.storyboardImageWorkflowMode ?? DEFAULT_STORYBOARD_IMAGE_WORKFLOW_MODE;
      if (kind === "image" && shouldRetryEmergencyImageWorkflow(error)) {
        if (currentStoryboardMode === "mature_asset_guided") {
          const strictErrorMessage =
            `成熟资产约束模式已禁止自动降级到应急纯文生图模板，否则会丢失角色三视图/天空盒参考并产出随机图。` +
            `请先修复分镜工作流节点与模型依赖后重试。原始错误：${String(error)}`;
          setAssetStatus(kind, shotId, "failed");
          setLastErrorByShot((previous) => ({ ...previous, [shotId]: strictErrorMessage }));
          pushToast(`分镜图生成失败：${shot.title}`, "error");
          appendLog(`生成失败：${shot.title}，${strictErrorMessage}`, "error");
          return false;
        }
        appendLog(`分镜图工作流不可用，尝试使用应急基础模板重试：${shot.title}，${String(error)}`, "error");
        try {
          const fallbackCheckpoint =
            pickCheckpointFromWorkflowJson(runtimeSettings.imageWorkflowJson) ||
            runtimeSettings.characterAssetModelName?.trim() ||
            DEFAULT_CHARACTER_ASSET_MODEL;
          const fallbackWorkflow = buildEmergencyStoryboardImageWorkflowTemplateJson(
            fallbackCheckpoint,
            assetRuntimeSettings.renderWidth ?? project.width,
            assetRuntimeSettings.renderHeight ?? project.height
          );
          const output = await generateShotAsset(assetRuntimeSettings, shot, shotIndex, "image", latestScopedShots, latestAssets, {
            workflowJsonOverride: fallbackWorkflow,
            onProgress: (progress, message) => {
              const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
              setPipelineState(`分镜图应急重试中：${shot.title}（${pct}%）${message ? ` · ${message}` : ""}`);
            }
          });
          updateShotFields(shot.id, { generatedImagePath: output.previewUrl });
          setAssetStatus(kind, shotId, "success");
          setLastErrorByShot((previous) => ({ ...previous, [shotId]: "" }));
          appendLog(`应急模板生成成功：${shot.title} -> ${output.previewUrl}`);
          return true;
        } catch (retryError) {
          const retryMessage = `${String(error)}；应急重试失败：${String(retryError)}`;
          setAssetStatus(kind, shotId, "failed");
          setLastErrorByShot((previous) => ({ ...previous, [shotId]: retryMessage }));
          pushToast(`分镜图生成失败：${shot.title}`, "error");
          appendLog(`生成失败：${shot.title}，${retryMessage}`, "error");
          return false;
        }
      }
      setAssetStatus(kind, shotId, "failed");
      const message = String(error);
      setLastErrorByShot((previous) => ({ ...previous, [shotId]: message }));
      pushToast(`${kind === "image" ? "分镜图" : kind === "video" ? "镜头视频" : "镜头配音"}生成失败：${shot.title}`, "error");
      appendLog(`生成失败：${shot.title}，${message}`, "error");
      return false;
    }
  };

  const onGenerateAudios = async (retryFailedOnly = false): Promise<boolean> => {
    try {
      if (phase === "running") {
        appendLog("镜头配音生成被跳过：当前已有任务在运行", "error");
        return false;
      }
      if (scopedShots.length === 0) {
        appendLog("镜头配音生成被跳过：当前没有镜头", "error");
        return false;
      }
      let runtimeSettings = settings;
      if (!runtimeSettings.audioWorkflowJson?.trim()) {
        pushToast("请先在高级设置里粘贴配音工作流 JSON", "warning");
        appendLog("镜头配音生成中断：未配置配音工作流", "error");
        return false;
      }
      if (!(await ensureComfyReady())) {
        pushToast("ComfyUI 未连接，请先启动 ComfyUI 桌面版", "error");
        setPipelineState("镜头配音生成中断：ComfyUI 未连接");
        appendLog("镜头配音生成中断：ComfyUI 未连接", "error");
        return false;
      }
      const check = validateWorkflowTemplate(runtimeSettings.audioWorkflowJson, runtimeSettings.tokenMapping, [
        runtimeSettings.tokenMapping.dialogue.trim() || "DIALOGUE"
      ]);
      if (!check.ok) {
        pushToast(`配音工作流缺少必需 token：${check.missing.join(", ")}`, "error");
        appendLog(`配音工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
        setPipelineState("镜头配音生成中断：配音工作流预检失败");
        return false;
      }

      const shotsForRun = getScopedShotsSnapshot();
      setPhase("running");
      let successCount = 0;
      let attemptedCount = 0;
      let skippedCount = 0;
      let skippedEmptyDialogue = 0;
      appendLog(retryFailedOnly ? "开始重试失败镜头配音" : "开始生成镜头配音");
      for (let index = 0; index < shotsForRun.length; index += 1) {
        const shot = shotsForRun[index];
        if (!shot.dialogue.trim()) {
          skippedEmptyDialogue += 1;
          continue;
        }
        if (retryFailedOnly && audioStatusByShot[shot.id] !== "failed") continue;
        if (skipExisting && !retryFailedOnly && (audioSummaryByShot[shot.id]?.count ?? 0) > 0) {
          skippedCount += 1;
          continue;
        }
        attemptedCount += 1;
        setPipelineState(`生成镜头配音：${shot.title} (${index + 1}/${shotsForRun.length})`);
        const ok = await onGenerateSingle("audio", shot.id, retryFailedOnly, runtimeSettings);
        if (ok) successCount += 1;
      }
      setPipelineState(retryFailedOnly ? "镜头配音失败项重试完成" : "镜头配音生成完成");
      appendLog(
        retryFailedOnly
          ? `镜头配音失败重试完成，成功 ${successCount} 条，尝试 ${attemptedCount} 条`
          : `镜头配音生成完成，成功 ${successCount} 条，尝试 ${attemptedCount} 条，跳过 ${skippedCount} 条，无对白跳过 ${skippedEmptyDialogue} 条`
      );
      if (successCount > 0) {
        appendLog("配音已自动加入时间轴音轨。当前“拼接整片预览”仍为纯视频拼接，如需带音频版本请使用导出功能。");
      }
      if (!retryFailedOnly && attemptedCount === 0 && skippedCount > 0) {
        appendLog("本轮镜头配音未重新生成：全部对白镜头已存在配音且启用了“跳过已生成”", "error");
      }
      if (attemptedCount === 0 && skippedEmptyDialogue > 0 && skippedCount === 0) {
        pushToast("当前镜头都没有对白，已跳过配音生成", "warning");
      } else {
        pushToast(
          retryFailedOnly ? `镜头配音重试完成，成功 ${successCount} 条` : `镜头配音生成完成，成功 ${successCount} 条`,
          "success"
        );
      }
      return successCount > 0 || skippedCount > 0;
    } catch (error) {
      const message = String(error);
      setPipelineState(`镜头配音生成异常：${message}`);
      appendLog(`镜头配音生成异常：${message}`, "error");
      pushToast(`镜头配音生成异常：${message}`, "error");
      return false;
    } finally {
      setPhase("idle");
    }
  };

  const onGenerateImages = async (retryFailedOnly = false, skipProvision = false): Promise<boolean> => {
    try {
      if (phase === "running") {
        appendLog("分镜图生成被跳过：当前已有任务在运行", "error");
        return false;
      }
      if (scopedShots.length === 0) {
        appendLog("分镜图生成被跳过：当前没有镜头", "error");
        return false;
      }
      const shotsForRun = getScopedShotsSnapshot();
      let runtimeSettings = settings;
      if (
        (runtimeSettings.storyboardImageWorkflowMode ?? DEFAULT_STORYBOARD_IMAGE_WORKFLOW_MODE) === "mature_asset_guided" &&
        (!runtimeSettings.imageWorkflowJson.trim() || workflowLooksLikeBuiltinStoryboardImageWorkflow(runtimeSettings.imageWorkflowJson))
      ) {
        runtimeSettings = { ...runtimeSettings, imageWorkflowJson: STORYBOARD_IMAGE_ASSET_GUIDED_WORKFLOW_JSON };
        persistSettings((previous) => ({
          ...previous,
          imageWorkflowJson: STORYBOARD_IMAGE_ASSET_GUIDED_WORKFLOW_JSON
        }));
        appendLog("成熟分镜模式检测到旧 Qwen 模板，已自动写入内置 scene-first + IPAdapter 分镜模板", "info");
        pushToast("已自动切换为内置成熟分镜模板", "success");
      }
      if (isLegacyMixedStoryboardImageWorkflow(runtimeSettings.imageWorkflowJson)) {
        runtimeSettings = { ...runtimeSettings, imageWorkflowJson: STORYBOARD_IMAGE_ASSET_GUIDED_WORKFLOW_JSON };
        persistSettings((previous) => ({ ...previous, imageWorkflowJson: STORYBOARD_IMAGE_ASSET_GUIDED_WORKFLOW_JSON }));
        appendLog("检测到旧版混合 Wan 分镜图工作流，已自动切换为内置成熟分镜模板", "info");
        pushToast("已将旧版重型分镜图工作流切换为内置成熟分镜模板", "warning");
      }
      if (!runtimeSettings.imageWorkflowJson.trim()) {
        const fallbackWorkflow =
          (runtimeSettings.storyboardImageWorkflowMode ?? DEFAULT_STORYBOARD_IMAGE_WORKFLOW_MODE) === "mature_asset_guided"
            ? STORYBOARD_IMAGE_ASSET_GUIDED_WORKFLOW_JSON
            : STORYBOARD_IMAGE_WORKFLOW_JSON;
        runtimeSettings = { ...runtimeSettings, imageWorkflowJson: fallbackWorkflow };
        persistSettings((previous) => ({ ...previous, imageWorkflowJson: fallbackWorkflow }));
        appendLog("图片工作流为空，已自动恢复为当前模式对应的内置分镜工作流", "info");
        pushToast("图片工作流为空，已自动恢复当前模式默认模板", "warning");
      }
      const inferredInput = inferInputDirFromSettings(runtimeSettings);
      const hasReferenceNeed = shotsForRun.some((shot) => (shot.characterRefs?.length ?? 0) > 0 || Boolean(shot.sceneRefId?.trim()));
      if (!inferredInput && hasReferenceNeed) {
        if ((runtimeSettings.storyboardImageWorkflowMode ?? DEFAULT_STORYBOARD_IMAGE_WORKFLOW_MODE) === "mature_asset_guided") {
          appendLog("分镜图生成中断：内置成熟分镜模板需要 ComfyUI input 目录来注入角色三视图和天空盒参考图", "error");
          pushToast("成熟分镜模板需要 ComfyUI input 目录", "error");
          setPipelineState("分镜图生成中断：缺少 ComfyUI input 目录");
          return false;
        }
        appendLog("未配置 ComfyUI input 目录：将跳过角色/场景参考图注入，仅使用文本提示生成", "error");
        pushToast("未配置 ComfyUI input 目录：本轮将忽略参考图注入", "warning");
      }
      if (!(await ensureComfyReady())) {
        pushToast("ComfyUI 未连接，请先启动 ComfyUI 桌面版", "error");
        setPipelineState("分镜图生成中断：ComfyUI 未连接");
        appendLog("分镜图生成中断：ComfyUI 未连接", "error");
        return false;
      }
      const check = validateWorkflowTemplate(runtimeSettings.imageWorkflowJson, runtimeSettings.tokenMapping);
      if (!check.ok) {
        pushToast(`图片工作流缺少必需 token：${check.missing.join(", ")}`, "error");
        appendLog(`图片工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
        setPipelineState("分镜图生成中断：图片工作流预检失败");
        return false;
      }
      if ((runtimeSettings.storyboardImageWorkflowMode ?? DEFAULT_STORYBOARD_IMAGE_WORKFLOW_MODE) === "mature_asset_guided") {
        const dependencyReport = await inspectWorkflowDependencies(settings.baseUrl, runtimeSettings.imageWorkflowJson);
        if (dependencyReport.missingNodeTypes.length > 0) {
          setLastDependencyHints(dependencyReport.hints);
          setStoryboardWorkflowDiagnostic((previous) =>
            previous
              ? {
                  ...previous,
                  dependencyReport
                }
              : previous
          );
          const hintPlugins =
            dependencyReport.hints.length > 0
              ? dependencyReport.hints.map((item) => item.plugin).join("、")
              : "无";
          appendLog(
            `分镜图生成中断：成熟资产约束模板缺少节点 ${dependencyReport.missingNodeTypes.join("、")}；建议先安装 ${hintPlugins}`,
            "error"
          );
          pushToast("成熟分镜模板缺少必需节点，请先体检并安装建议插件", "error");
          setPipelineState("分镜图生成中断：成熟分镜模板缺少节点");
          return false;
        }
      }
      setPhase("running");
      if (!skipProvision) {
        appendLog("分镜图前置资产阶段已启用：将先检查角色三视图与场景天空盒");
        setPipelineState("分镜图前置：准备生成角色三视图与场景天空盒");
        const provisionOk = await ensureProvisionedAssetsForCurrentShots(shotsForRun, runtimeSettings, "分镜图前置资产生成");
        if (!provisionOk) {
          appendLog("分镜图生成中断：前置资产生成未完成", "error");
          return false;
        }
      }
      const bindingRepair = deriveShotBindingRepairs(getScopedShotsSnapshot(), useStoryboardStore.getState().assets);
      if (bindingRepair.patches.length > 0) {
        bindingRepair.patches.forEach((patch) => updateShotFields(patch.shotId, patch.fields));
        appendLog(
          `分镜资产绑定修复：补回角色引用 ${bindingRepair.repairedCharacterShots} 条 / 场景引用 ${bindingRepair.repairedSceneShots} 条`
        );
      }
      const latestShotsForRun = getScopedShotsSnapshot();
      let successCount = 0;
      let attemptedCount = 0;
      let skippedCount = 0;
      appendLog(retryFailedOnly ? "开始重试失败分镜图" : "开始生成分镜图");
      for (let index = 0; index < latestShotsForRun.length; index += 1) {
        const shot = latestShotsForRun[index];
        if (retryFailedOnly && imageStatusByShot[shot.id] !== "failed") continue;
        if (skipExisting && !retryFailedOnly && shot.generatedImagePath?.trim()) {
          skippedCount += 1;
          continue;
        }
        attemptedCount += 1;
        setPipelineState(`生成分镜图：${shot.title} (${index + 1}/${latestShotsForRun.length})`);
        const ok = await onGenerateSingle("image", shot.id, retryFailedOnly, runtimeSettings);
        if (ok) successCount += 1;
      }
      setPipelineState(retryFailedOnly ? "分镜图失败项重试完成" : "分镜图生成完成");
      appendLog(
        retryFailedOnly
          ? `分镜图失败重试完成，成功 ${successCount} 条，尝试 ${attemptedCount} 条`
          : `分镜图生成完成，成功 ${successCount} 条，尝试 ${attemptedCount} 条，跳过 ${skippedCount} 条`
      );
      if (!retryFailedOnly && attemptedCount === 0 && skippedCount > 0) {
        appendLog("本轮分镜图未重新生成：全部镜头已存在分镜图且启用了“跳过已生成”", "error");
      }
      pushToast(
        retryFailedOnly ? `分镜图重试完成，成功 ${successCount} 条` : `分镜图生成完成，成功 ${successCount} 条`,
        "success"
      );
      const readyImageCount = getScopedShotsSnapshot().filter((item) => item.generatedImagePath?.trim()).length;
      if (readyImageCount === 0) {
        setPipelineState("分镜图阶段未产出可用图片");
        appendLog("分镜图阶段未产出可用图片，已中断后续步骤", "error");
        if (attemptedCount > 0) {
          pushToast("分镜图全部失败，请先修复 input 目录或工作流问题", "error");
        } else {
          pushToast("没有可用分镜图，请先生成分镜图", "warning");
        }
        return false;
      }
      return true;
    } catch (error) {
      const message = String(error);
      setPipelineState(`分镜图生成异常：${message}`);
      appendLog(`分镜图生成异常：${message}`, "error");
      pushToast(`分镜图生成异常：${message}`, "error");
      return false;
    } finally {
      setPhase("idle");
    }
  };

  const onGenerateVideos = async (retryFailedOnly = false): Promise<boolean> => {
    try {
      if (phase === "running") {
        appendLog("镜头视频生成被跳过：当前已有任务在运行", "error");
        return false;
      }
      if (scopedShots.length === 0) {
        appendLog("镜头视频生成被跳过：当前没有镜头", "error");
        return false;
      }
      const shotsForRun = getScopedShotsSnapshot();
      let runtimeSettings = settings;
      if (!runtimeSettings.videoWorkflowJson.trim()) {
        runtimeSettings = { ...runtimeSettings, videoWorkflowJson: FISHER_WORKFLOW_JSON };
        persistSettings((previous) => ({ ...previous, videoWorkflowJson: FISHER_WORKFLOW_JSON }));
        appendLog("视频工作流为空，已自动恢复为内置默认工作流", "error");
        pushToast("视频工作流为空，已自动恢复默认工作流", "warning");
      }
      if (runtimeSettings.videoGenerationMode !== "local_motion") {
        if (!(await ensureComfyReady())) {
          pushToast("ComfyUI 未连接，请先启动 ComfyUI 桌面版", "error");
          setPipelineState("镜头视频生成中断：ComfyUI 未连接");
          appendLog("镜头视频生成中断：ComfyUI 未连接", "error");
          return false;
        }
        const check = validateWorkflowTemplate(runtimeSettings.videoWorkflowJson, runtimeSettings.tokenMapping);
        if (!check.ok) {
          pushToast(`视频工作流缺少必需 token：${check.missing.join(", ")}`, "error");
          appendLog(`视频工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
          setPipelineState("镜头视频生成中断：视频工作流预检失败");
          return false;
        }
        const lipSync = inspectVideoWorkflowLipSyncSupport(runtimeSettings.videoWorkflowJson, runtimeSettings.tokenMapping);
        const dialogueShotCount = shotsForRun.filter((shot) => shot.dialogue.trim().length > 0).length;
        if (dialogueShotCount > 0) {
          if (lipSync.usesDialogueAudioPathToken) {
            appendLog(
              `检测到 ${dialogueShotCount} 条含对白镜头，视频工作流已接入对白音频 token：${lipSync.matchedPathTokens.join(", ")}`
            );
          } else {
            appendLog(
              `检测到 ${dialogueShotCount} 条含对白镜头，但当前视频工作流未引用对白音频 token，无法保证口型与文字同步`,
              "error"
            );
            pushToast("当前视频工作流未接入口型同步音频 token，对白镜头无法保证口型同步", "warning");
          }
        }
      } else {
        appendLog("当前视频生成方式：Mac 兼容本地视频，不依赖 Comfy 视频工作流");
        if (shotsForRun.some((shot) => shot.dialogue.trim().length > 0)) {
          appendLog("当前视频生成方式为本地单帧/首尾帧推演，对白镜头无法做真正的逐字口型同步", "error");
        }
      }
      setPhase("running");
      let successCount = 0;
      let attemptedCount = 0;
      let skippedCount = 0;
      appendLog(retryFailedOnly ? "开始重试失败镜头视频" : "开始生成镜头视频");
      for (let index = 0; index < shotsForRun.length; index += 1) {
        const shot = shotsForRun[index];
        if (retryFailedOnly && videoStatusByShot[shot.id] !== "failed") continue;
        const hasLegacyInvalidVideoPath =
          Boolean(shot.generatedVideoPath?.trim()) && !looksLikeVideoPath(shot.generatedVideoPath ?? "");
        if (hasLegacyInvalidVideoPath) {
          updateShotFields(shot.id, { generatedVideoPath: "" });
          appendLog(`镜头视频路径不是可播放视频，已自动清空并重新生成：${shot.title}`, "error");
        }
        if (skipExisting && !retryFailedOnly && hasUsableGeneratedAsset("video", shot)) {
          skippedCount += 1;
          continue;
        }
        attemptedCount += 1;
        setPipelineState(`生成镜头视频：${shot.title} (${index + 1}/${shotsForRun.length})`);
        const ok = await onGenerateSingle("video", shot.id, retryFailedOnly, runtimeSettings);
        if (ok) successCount += 1;
      }
      setPipelineState(retryFailedOnly ? "镜头视频失败项重试完成" : "镜头视频生成完成");
      appendLog(
        retryFailedOnly
          ? `镜头视频失败重试完成，成功 ${successCount} 条，尝试 ${attemptedCount} 条`
          : `镜头视频生成完成，成功 ${successCount} 条，尝试 ${attemptedCount} 条，跳过 ${skippedCount} 条`
      );
      if (!retryFailedOnly && attemptedCount === 0 && skippedCount > 0) {
        appendLog("本轮镜头视频未重新生成：全部镜头已存在视频且启用了“跳过已生成”", "error");
      }
      pushToast(
        retryFailedOnly ? `镜头视频重试完成，成功 ${successCount} 条` : `镜头视频生成完成，成功 ${successCount} 条`,
        "success"
      );
      const readyVideoCount = getScopedShotsSnapshot().filter((item) =>
        hasUsableGeneratedAsset("video", item)
      ).length;
      if (readyVideoCount === 0) {
        setPipelineState("镜头视频阶段未产出可用视频");
        appendLog("镜头视频阶段未产出可用视频，已中断拼接步骤", "error");
        if (attemptedCount > 0) {
          pushToast("镜头视频全部失败，请检查 Comfy 工作流与模型", "error");
        }
        return false;
      }
      return true;
    } catch (error) {
      const message = String(error);
      setPipelineState(`镜头视频生成异常：${message}`);
      appendLog(`镜头视频生成异常：${message}`, "error");
      pushToast(`镜头视频生成异常：${message}`, "error");
      return false;
    } finally {
      setPhase("idle");
    }
  };

  const onGenerateSoundDesign = async (retryFailedOnly = false): Promise<boolean> => {
    try {
      if (phase === "running") {
        appendLog("环境/音效生成被跳过：当前已有任务在运行", "error");
        return false;
      }
      if (scopedShots.length === 0) {
        appendLog("环境/音效生成被跳过：当前没有镜头", "error");
        return false;
      }
      if (!settings.soundWorkflowJson?.trim()) {
        appendLog("环境/音效生成跳过：未配置环境/音效工作流", "error");
        return false;
      }
      if (!(await ensureComfyReady())) {
        pushToast("ComfyUI 未连接，请先启动 ComfyUI 桌面版", "error");
        setPipelineState("环境/音效生成中断：ComfyUI 未连接");
        appendLog("环境/音效生成中断：ComfyUI 未连接", "error");
        return false;
      }
      const check = validateWorkflowTemplate(settings.soundWorkflowJson, settings.tokenMapping, [
        settings.tokenMapping.prompt.trim() || "PROMPT"
      ]);
      if (!check.ok) {
        pushToast(`环境/音效工作流缺少必需 token：${check.missing.join(", ")}`, "error");
        appendLog(`环境/音效工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
        setPipelineState("环境/音效生成中断：工作流预检失败");
        return false;
      }

      const shotsForRun = getScopedShotsSnapshot();
      const latestAssets = useStoryboardStore.getState().assets;
      const assetRuntimeSettings: ComfySettings = {
        ...settings,
        renderWidth: project.width,
        renderHeight: project.height,
        renderFps: project.fps
      };
      setPhase("running");
      let successCount = 0;
      let attemptedCount = 0;
      let skippedCount = 0;
      appendLog(retryFailedOnly ? "开始重试失败环境/音效" : "开始生成环境/音效");
      for (let index = 0; index < shotsForRun.length; index += 1) {
        const shot = shotsForRun[index]!;
        const cues = buildShotSoundCues(shot);
        if (cues.length === 0) continue;
        if (retryFailedOnly && audioStatusByShot[shot.id] !== "failed") continue;

        const startFrame = selectShotStartFrame(useStoryboardStore.getState(), shot.id);
        const existingForShot = cues.every((cue) =>
          looksLikeAudioPath(audioTracks.find((track) => track.id === soundTrackIdForShot(shot.id, cue.kind))?.filePath ?? "")
        );
        if (skipExisting && !retryFailedOnly && existingForShot) {
          skippedCount += 1;
          continue;
        }

        attemptedCount += 1;
        setAssetStatus("audio", shot.id, "running");
        let shotSuccess = true;
        for (const cue of cues) {
          try {
            const output = await generateShotAsset(
              assetRuntimeSettings,
              shot,
              index,
              "audio",
              shotsForRun,
              latestAssets,
              {
                workflowJsonOverride: settings.soundWorkflowJson,
                tokenOverrides: {
                  PROMPT: cue.prompt,
                  DIALOGUE: "",
                  SHOT_TITLE: `${shot.title} ${cue.kind}`
                },
                onProgress: (progress, message) => {
                  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
                  setPipelineState(
                    `生成环境/音效：${shot.title} / ${cue.kind}（${pct}%）${message ? ` · ${message}` : ""}`
                  );
                }
              }
            );
            upsertAudioTrack({
              id: soundTrackIdForShot(shot.id, cue.kind),
              projectId: project.id,
              filePath: output.localPath || output.previewUrl,
              startFrame,
              gain: cue.gain,
              kind:
                cue.kind === "ambience"
                  ? "ambience"
                  : cue.kind === "character"
                    ? "character_sfx"
                    : "prop_sfx",
              label:
                cue.kind === "ambience"
                  ? `${shot.title} / 环境音`
                  : cue.kind === "character"
                    ? `${shot.title} / 人物音效`
                    : `${shot.title} / 道具音效`
            });
            appendLog(`环境/音效生成成功：${shot.title} / ${cue.kind} -> ${output.localPath || output.previewUrl}`);
          } catch (error) {
            shotSuccess = false;
            const message = String(error);
            setLastErrorByShot((previous) => ({ ...previous, [shot.id]: message }));
            appendLog(`环境/音效生成失败：${shot.title} / ${cue.kind}，${message}`, "error");
          }
        }
        setAssetStatus("audio", shot.id, shotSuccess ? "success" : "failed");
        if (shotSuccess) successCount += 1;
      }

      setPipelineState(retryFailedOnly ? "环境/音效失败项重试完成" : "环境/音效生成完成");
      appendLog(
        retryFailedOnly
          ? `环境/音效失败重试完成，成功 ${successCount} 条，尝试 ${attemptedCount} 条`
          : `环境/音效生成完成，成功 ${successCount} 条，尝试 ${attemptedCount} 条，跳过 ${skippedCount} 条`
      );
      if (successCount > 0) {
        appendLog("环境音、人物动作音、道具音已自动加入时间轴音轨。");
      }
      return successCount > 0 || skippedCount > 0;
    } catch (error) {
      const message = String(error);
      setPipelineState(`环境/音效生成异常：${message}`);
      appendLog(`环境/音效生成异常：${message}`, "error");
      pushToast(`环境/音效生成异常：${message}`, "error");
      return false;
    } finally {
      setPhase("idle");
    }
  };

  const onConcatVideos = async (): Promise<boolean> => {
    try {
      const allPaths = getScopedShotsSnapshot()
        .map((shot) => shot.generatedVideoPath?.trim() ?? "")
        .filter((path) => path.length > 0);
      const paths = allPaths.filter((path) => looksLikeVideoPath(path));
      const skippedNonVideo = allPaths.length - paths.length;
      if (skippedNonVideo > 0) {
        appendLog(`拼接前已跳过 ${skippedNonVideo} 条非视频路径（历史遗留图片路径）`, "error");
      }
      if (paths.length === 0) {
        pushToast("没有可拼接的视频路径", "warning");
        appendLog("视频拼接跳过：没有可用视频路径", "error");
        setPipelineState("视频拼接中断：没有可用视频路径");
        return false;
      }
      setPipelineState("拼接整片视频中...");
      appendLog(`开始拼接整片视频，共 ${paths.length} 段`);
      const output = await concatShotVideos(paths);
      if (!output) {
        pushToast("拼接失败：未返回输出路径", "error");
        appendLog("视频拼接失败：未返回输出路径", "error");
        setPipelineState("视频拼接失败：未返回输出路径");
        return false;
      }
      let finalOutput = output;
      const usableAudioTracks = useStoryboardStore
        .getState()
        .audioTracks.filter((track) => looksLikeAudioPath(track.filePath));
      if (usableAudioTracks.length > 0) {
        appendLog(`开始融合整片音频，共 ${usableAudioTracks.length} 条音轨`);
        const { muxVideoWithAudioTracks } = await loadExportService();
        const muxed = await muxVideoWithAudioTracks({
          videoPath: output,
          fps: project.fps,
          audioTracks: usableAudioTracks
        });
        if (muxed) {
          finalOutput = muxed;
          appendLog(`整片音频融合成功：${muxed}`);
        }
      }
      setPreviewVideoPath(finalOutput);
      setPipelineState(`整片预览已生成：${finalOutput}`);
      pushToast("整片预览视频已生成", "success");
      appendLog(`整片视频拼接成功：${finalOutput}`);
      return true;
    } catch (error) {
      setPipelineState(`视频拼接失败：${String(error)}`);
      pushToast(`视频拼接失败：${String(error)}`, "error");
      appendLog(`视频拼接失败：${String(error)}`, "error");
      return false;
    }
  };

  const onGenerateAll = async () => {
    if (phase === "running" || runAllActive) {
      pushToast("已有生成任务在运行中，请稍后再试", "warning");
      appendLog("一键生成整片被忽略：已有任务在运行中", "error");
      return;
    }
    const shotsForRun = getScopedShotsSnapshot();
    if (shotsForRun.length === 0) {
      pushToast("请先导入分镜脚本", "warning");
      setPipelineState("一键生成中断：没有可用镜头");
      appendLog("一键生成中断：没有可用镜头", "error");
      return;
    }
    setRunAllActive(true);
    setRunAllProgress(3);
    setRunAllStage("准备开始");
    appendLog(`一键生成整片开始，共 ${shotsForRun.length} 个镜头`);
    pushToast("已开始一键生成整片", "success");
    try {
      setPipelineState("一键生成整片：步骤 1/6 预生成角色三视图与场景天空盒");
      setRunAllProgress(8);
      setRunAllStage("步骤 1/6 预生成角色三视图与场景天空盒");
      appendLog("一键生成前置资产阶段已启用：将先检查角色三视图与场景天空盒");
      const provisionOk = await ensureProvisionedAssetsForCurrentShots(shotsForRun, settings, "一键生成前置资产生成");
      if (!provisionOk) {
        appendLog("一键生成提示：前置资产阶段未完成，继续执行后续分镜/视频流程", "error");
        pushToast("前置资产未完成：本轮继续生成分镜与视频", "warning");
      }

      setPipelineState("一键生成整片：步骤 2/6 生成分镜图");
      setRunAllProgress(24);
      setRunAllStage("步骤 2/6 生成分镜图");
      const imageOk = await onGenerateImages(false, true);
      if (!imageOk) {
        setPipelineState("一键生成中断：分镜图阶段未完成");
        appendLog("一键生成中断：分镜图阶段未完成", "error");
        return;
      }

      setPipelineState("一键生成整片：步骤 3/6 生成镜头视频");
      setRunAllProgress(44);
      setRunAllStage("步骤 3/6 生成镜头视频");
      const videoOk = await onGenerateVideos(false);
      if (!videoOk) {
        setPipelineState("一键生成中断：镜头视频阶段未完成");
        appendLog("一键生成中断：镜头视频阶段未完成", "error");
        return;
      }

      setPipelineState("一键生成整片：步骤 4/6 生成镜头配音");
      setRunAllProgress(62);
      setRunAllStage("步骤 4/6 生成镜头配音");
      if (settings.audioWorkflowJson?.trim()) {
        const audioOk = await onGenerateAudios(false);
        if (!audioOk) {
          appendLog("一键生成提示：镜头配音阶段未产出可用结果，继续后续流程", "error");
        }
      } else {
        appendLog("一键生成提示：未配置配音工作流，已跳过镜头配音");
      }

      setPipelineState("一键生成整片：步骤 5/6 生成环境/音效");
      setRunAllProgress(78);
      setRunAllStage("步骤 5/6 生成环境/音效");
      if (settings.soundWorkflowJson?.trim()) {
        const soundOk = await onGenerateSoundDesign(false);
        if (!soundOk) {
          appendLog("一键生成提示：环境/音效阶段未产出可用结果，继续后续流程", "error");
        }
      } else {
        appendLog("一键生成提示：未配置环境/音效工作流，已跳过环境/音效生成");
      }

      setPipelineState("一键生成整片：步骤 6/6 拼接整片并融合音频");
      setRunAllProgress(92);
      setRunAllStage("步骤 6/6 拼接整片并融合音频");
      const concatOk = await onConcatVideos();
      if (!concatOk) {
        setPipelineState("一键生成中断：整片拼接未完成");
        appendLog("一键生成中断：整片拼接未完成", "error");
        return;
      }

      setRunAllProgress(100);
      setRunAllStage("全部完成");
      appendLog("一键生成整片完成");
    } catch (error) {
      const message = String(error);
      setPipelineState(`一键生成异常：${message}`);
      appendLog(`一键生成异常：${message}`, "error");
      pushToast(`一键生成异常：${message}`, "error");
    } finally {
      setRunAllActive(false);
    }
  };

  const onUpdateShotPrompt = (shotId: string, value: string) => {
    updateShotFields(shotId, { storyPrompt: value });
  };

  const onUpdateShotVideoPrompt = (shotId: string, value: string) => {
    const currentPrompt = shots.find((item) => item.id === shotId)?.videoPrompt ?? "";
    const preset = extractLocalMotionPresetFromText(currentPrompt);
    updateShotFields(shotId, { videoPrompt: withLocalMotionToken(value, preset) });
  };

  const onUpdateShotVideoMode = (shotId: string, value: string) => {
    if (value !== "auto" && value !== "single_frame" && value !== "first_last_frame") return;
    updateShotFields(shotId, { videoMode: value });
  };

  const onUpdateShotLocalMotionPreset = (shotId: string, value: string) => {
    if (
      value !== "auto" &&
      value !== "still" &&
      value !== "fade" &&
      value !== "push_in" &&
      value !== "push_out" &&
      value !== "pan_left" &&
      value !== "pan_right"
    ) {
      return;
    }
    const currentPrompt = shots.find((item) => item.id === shotId)?.videoPrompt ?? "";
    updateShotFields(shotId, {
      videoPrompt: withLocalMotionToken(currentPrompt, value)
    });
  };

  const onUpdateShotVideoFramePath = (shotId: string, key: "videoStartFramePath" | "videoEndFramePath", value: string) => {
    updateShotFields(shotId, { [key]: value } as { videoStartFramePath?: string; videoEndFramePath?: string });
  };

  const onUpdateShotSeed = (shotId: string, value: string) => {
    const trimmed = value.trim();
    const seed = trimmed.length === 0 ? undefined : Number(trimmed);
    if (seed !== undefined && !Number.isFinite(seed)) return;
    updateShotFields(shotId, { seed });
  };

  const onUpdateShotDurationSec = (shotId: string, value: string) => {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const fps = 24;
    setShotDuration(shotId, Math.max(1, Math.round(seconds * fps)));
  };

  return (
    <section className="panel comfy-panel">
      <header className="panel-header">
        <div className="comfy-title-block">
          <h2>AI 流水线</h2>
          <small>连接 ComfyUI · 导入分镜 · 一键生成整片</small>
        </div>
      </header>
      <section className="comfy-stage">
        <div className="comfy-stage-head">
          <span className="comfy-stage-index">01</span>
          <h3>连接与路径</h3>
        </div>
        <div className="timeline-meta comfy-status-bar">
          <span className={`comfy-status-chip ${connectionLabel === "已连接" ? "is-ok" : "is-bad"}`}>{connectionLabel}</span>
          <span className="comfy-status-text">{pipelineState}</span>
        </div>
        {runAllActive && (
          <div className="comfy-run-progress" role="status" aria-live="polite">
            <div className="comfy-run-progress-meta">
              <strong>{runAllStage || "执行中"}</strong>
              <span>{Math.max(0, Math.min(100, Math.round(runAllProgress)))}%</span>
            </div>
            <progress max={100} value={Math.max(0, Math.min(100, runAllProgress))} />
            {provisionPreviews.length > 0 && (
              <div className="comfy-provision-preview-grid">
                {provisionPreviews.map((item) => (
                  <article key={item.key} className={`comfy-provision-preview-card is-${item.status}`}>
                    <div className="comfy-provision-preview-head">
                      <strong>{item.kind === "character" ? "角色" : "天空盒"} · {item.name}</strong>
                      <span>
                        {item.status === "pending"
                          ? "待生成"
                          : item.status === "running"
                            ? "生成中"
                            : item.status === "success"
                              ? "已生成"
                              : item.status === "reused"
                                ? "已复用"
                                : "失败"}
                      </span>
                    </div>
                    <small>{item.detail}</small>
                    <div className="comfy-provision-thumb-row">
                      {item.thumbs.length > 0 ? (
                        item.thumbs.slice(0, 4).map((thumb, index) => (
                          <img
                            key={`${item.key}_${index}`}
                            alt={`${item.name}_${index + 1}`}
                            loading="lazy"
                            src={toDesktopMediaSource(thumb)}
                          />
                        ))
                      ) : (
                        <div className="comfy-provision-thumb-empty">等待图像</div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="comfy-path-grid">
          <label>
            ComfyUI 输出目录（用于视频拼接）
            <input
              onChange={(event) => persistSettings((previous) => ({ ...previous, outputDir: event.target.value }))}
              placeholder="/path/to/ComfyUI/output"
              type="text"
              value={settings.outputDir}
            />
          </label>
          <label>
            ComfyUI input 目录（用于自动喂图）
            <input
              onChange={(event) => persistSettings((previous) => ({ ...previous, comfyInputDir: event.target.value }))}
              placeholder="/path/to/ComfyUI/input（留空将按 output 同级推断）"
              type="text"
              value={settings.comfyInputDir}
            />
          </label>
        </div>
        <details className="export-panel comfy-advanced-panel">
          <summary>高级连接与工作流设置</summary>
          <div className="timeline-actions comfy-connection-actions">
            <button className="btn-ghost" onClick={() => void onAutoDetectComfy()} type="button">自动探测地址</button>
            <button className="btn-ghost" onClick={onCheckConnection} type="button">检测连接</button>
          </div>
          <label>
            ComfyUI 根目录（用于自动安装插件）
            <input
              onChange={(event) => persistSettings((previous) => ({ ...previous, comfyRootDir: event.target.value }))}
              placeholder="/path/to/ComfyUI（留空将按 output/input 推断）"
              type="text"
              value={settings.comfyRootDir}
            />
          </label>
        <label>
          ComfyUI 地址（手动覆盖）
          <input
            onChange={(event) => persistSettings((previous) => ({ ...previous, baseUrl: event.target.value }))}
            placeholder="http://127.0.0.1:8000"
            type="text"
            value={settings.baseUrl}
          />
        </label>
        <label>
          视频生成方式
          <select
            onChange={(event) =>
              persistSettings((previous) => ({
                ...previous,
                videoGenerationMode: event.target.value as "comfy" | "local_motion"
              }))
            }
            value={settings.videoGenerationMode ?? defaultVideoGenerationMode()}
          >
            <option value="local_motion">Mac 兼容本地视频</option>
            <option value="comfy">ComfyUI 视频工作流</option>
          </select>
        </label>
        {settings.videoGenerationMode === "local_motion" && (
          <div className="timeline-meta">
            本模式不依赖 ComfyUI 视频模型。会用当前分镜图或首尾帧在本地生成可拼接的镜头视频，适合 Mac。
          </div>
        )}
        <div className="timeline-actions">
          <button className="btn-secondary" onClick={() => void applyOneClickProfile("sd15")} type="button">
            应用 SD1.5 一键整片配置
          </button>
          <button className="btn-ghost" onClick={() => void applyOneClickProfile("sdxl")} type="button">
            应用 SDXL 一键整片配置
          </button>
        </div>
        <div className="timeline-meta">
          一键配置会自动设置分镜模板、角色/天空盒资产模板、模型和本地视频模式，减少整片直跑的节点依赖。
        </div>
        <label className="comfy-script-block">
          全局视觉风格锚点
          <textarea
            onChange={(event) =>
              persistSettings((previous) => ({ ...previous, globalVisualStylePrompt: event.target.value }))
            }
            placeholder="例如：写实电影质感，暖棕低饱和，35mm 胶片颗粒，柔和侧光，真实材质，统一镜头语言。会自动注入角色、天空盒、分镜图和视频。"
            rows={3}
            value={settings.globalVisualStylePrompt ?? ""}
          />
        </label>
        <label className="comfy-script-block">
          全局反风格约束
          <textarea
            onChange={(event) =>
              persistSettings((previous) => ({ ...previous, globalStyleNegativePrompt: event.target.value }))
            }
            placeholder="例如：二次元，卡通，赛博霓虹，高饱和，夸张磨皮，过曝，廉价 CG，风格漂移。会自动并入负面提示词。"
            rows={3}
            value={settings.globalStyleNegativePrompt ?? ""}
          />
        </label>
        <label className="comfy-script-block">
          分镜图工作流（JSON）
          <textarea
            onChange={(event) =>
              persistSettings((previous) => ({ ...previous, imageWorkflowJson: event.target.value }))
            }
            placeholder='粘贴分镜图 ComfyUI API 工作流 JSON。高一致性项目建议不要继续使用内置 Qwen 兼容模板。'
            rows={6}
            value={settings.imageWorkflowJson}
          />
        </label>
        <label>
          分镜图基础模型（checkpoint）
          <input
            list="comfy-checkpoint-options"
            onChange={(event) =>
              persistSettings((previous) => ({ ...previous, storyboardImageModelName: event.target.value }))
            }
            placeholder={DEFAULT_STORYBOARD_IMAGE_MODEL}
            type="text"
            value={settings.storyboardImageModelName ?? DEFAULT_STORYBOARD_IMAGE_MODEL}
          />
        </label>
        {storyboardModelVisible === false && (
          <div className="timeline-meta comfy-inline-warning">
            当前分镜基模未出现在 Comfy checkpoint 下拉里：{settings.storyboardImageModelName}
          </div>
        )}
        <label>
          分镜图工作流模式
          <select
            onChange={(event) =>
              persistSettings((previous) => ({
                ...previous,
                storyboardImageWorkflowMode: event.target.value as StoryboardImageWorkflowMode
              }))
            }
            value={storyboardImageWorkflowMode}
          >
            <option value="mature_asset_guided">成熟资产约束流程（推荐）</option>
            <option value="builtin_qwen">兼容内置 Qwen 模板</option>
          </select>
        </label>
        <div className="comfy-asset-mode-card">
          <div className="comfy-asset-mode-head">
            <strong>{storyboardImageModeSpec.label}</strong>
            <div className="timeline-actions">
              <button
                className="btn-secondary"
                onClick={() => writeBuiltinStoryboardWorkflow(storyboardImageWorkflowMode)}
                type="button"
              >
                {storyboardImageWorkflowMode === "mature_asset_guided" ? "写入内置成熟分镜模板" : "写入内置兼容模板"}
              </button>
              <button className="btn-ghost" onClick={() => void copyStoryboardModeSummary()} type="button">
                复制模式清单
              </button>
              <button className="btn-ghost" onClick={() => void copyStoryboardDiagnosticSummary()} type="button">
                复制当前体检结论
              </button>
            </div>
          </div>
          <p>{storyboardImageModeSpec.summary}</p>
          <div className="comfy-asset-mode-grid">
            <div>
              <strong>必需节点</strong>
              <ul>
                {storyboardImageModeSpec.requiredNodes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <strong>模型要求</strong>
              <ul>
                {storyboardImageModeSpec.requiredModels.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="comfy-asset-mode-grid">
            <div>
              <strong>推荐插件</strong>
              <ul>
                {storyboardImageModeSpec.recommendedPlugins.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <strong>备注</strong>
              <ul>
                {storyboardImageModeSpec.notes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <div className="timeline-meta">
          当前分镜模式：
          {storyboardImageWorkflowMode === "mature_asset_guided"
            ? "当前内置成熟模板会先吃天空盒主面/场景底图，再叠 IPAdapter 角色参考；如果还不够，再在这套模板外层加 ControlNet / InstantID。"
            : "继续使用内置 Qwen/Fisher 兼容模板，出图速度快，但一致性较弱。"}
        </div>
        {storyboardImageWorkflowMode === "mature_asset_guided" && workflowLooksLikeBuiltinStoryboardImageWorkflow(settings.imageWorkflowJson) && (
          <div className="timeline-meta comfy-inline-warning">
            当前图片工作流仍是内置 Qwen 兼容模板。建议点上面的“写入内置成熟分镜模板”，或导入你自己的成熟资产约束工作流。
          </div>
        )}
        <div className="timeline-actions">
          <button className="btn-ghost" onClick={() => void runAssetWorkflowDiagnostic("storyboard")} type="button">
            体检当前分镜模板
          </button>
        </div>
        {storyboardWorkflowDiagnostic && (
          <div className="comfy-asset-diagnostic-card">
            <div className="comfy-asset-diagnostic-head">
              <strong>分镜模板体检</strong>
              <span>{storyboardWorkflowDiagnostic.workflowConfigured ? "已配置工作流" : "未配置工作流"}</span>
            </div>
            <div className="comfy-asset-diagnostic-grid">
              <div>当前模式</div>
              <div>{storyboardWorkflowDiagnostic.modeSpec.label}</div>
              <div>基础模型</div>
              <div>{storyboardWorkflowDiagnostic.selectedModel}</div>
              <div>模型可见性</div>
              <div>
                {storyboardWorkflowDiagnostic.modelVisible == null
                  ? "未读取 Comfy 下拉"
                  : storyboardWorkflowDiagnostic.modelVisible
                    ? "已命中 Comfy 下拉"
                    : "未命中 Comfy 下拉"}
              </div>
              <div>Token 预检</div>
              <div>
                {storyboardWorkflowDiagnostic.templateValid
                  ? `通过（${storyboardWorkflowDiagnostic.usedTokens.length} 个 token）`
                  : `失败：缺少 ${storyboardWorkflowDiagnostic.templateMissing.join("、")}`}
              </div>
              <div>节点体检</div>
              <div>{summarizeDependencyReport(storyboardWorkflowDiagnostic.dependencyReport)}</div>
              <div>缺失节点</div>
              <div>{formatMissingNodes(storyboardWorkflowDiagnostic.dependencyReport)}</div>
              <div>建议插件</div>
              <div>{formatHintPlugins(storyboardWorkflowDiagnostic.dependencyReport)}</div>
            </div>
            <div className="comfy-asset-diagnostic-list">
              <div>模式说明：{storyboardWorkflowDiagnostic.modeSpec.summary}</div>
              <div>模式必需节点：{storyboardWorkflowDiagnostic.modeSpec.requiredNodes.join("、")}</div>
              <div>模式模型要求：{storyboardWorkflowDiagnostic.modeSpec.requiredModels.join("、")}</div>
              <div>
                模式推荐插件：
                {storyboardWorkflowDiagnostic.modeSpec.recommendedPlugins.length > 0
                  ? storyboardWorkflowDiagnostic.modeSpec.recommendedPlugins.join("、")
                  : "无"}
              </div>
            </div>
            {storyboardWorkflowDiagnostic.heuristic.warnings.length > 0 && (
              <div className="comfy-asset-diagnostic-list is-warning">
                {storyboardWorkflowDiagnostic.heuristic.warnings.map((item) => (
                  <div key={item}>警告：{item}</div>
                ))}
              </div>
            )}
            {storyboardWorkflowDiagnostic.heuristic.notes.length > 0 && (
              <div className="comfy-asset-diagnostic-list">
                {storyboardWorkflowDiagnostic.heuristic.notes.map((item) => (
                  <div key={item}>说明：{item}</div>
                ))}
              </div>
            )}
          </div>
        )}
        {availableCheckpointOptions.length > 0 && (
          <datalist id="comfy-checkpoint-options">
            {availableCheckpointOptions.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        )}
        <label className="comfy-script-block">
          角色三视图工作流（JSON）
          <textarea
            onChange={(event) =>
              persistSettings((previous) => ({ ...previous, characterWorkflowJson: event.target.value }))
            }
            placeholder='可选。粘贴专用于角色三视图的 ComfyUI API 工作流 JSON；留空则回退到图片工作流。'
            rows={5}
            value={settings.characterWorkflowJson ?? ""}
          />
        </label>
        <label>
          角色三视图工作流模式
          <select
            onChange={(event) =>
              persistSettings((previous) => ({
                ...previous,
                characterAssetWorkflowMode: event.target.value as CharacterAssetWorkflowMode
              }))
            }
            value={characterAssetWorkflowMode}
          >
            <option value="basic_builtin">基础正交三视图模板</option>
            <option value="advanced_multiview">高级多视角角色工作流</option>
          </select>
        </label>
        <div className="comfy-asset-mode-card">
          <div className="comfy-asset-mode-head">
            <strong>{characterAssetModeSpec.label}</strong>
            <div className="timeline-actions">
              <button className="btn-ghost" onClick={() => void copyAssetModeSummary("character")} type="button">
                复制模式清单
              </button>
              <button className="btn-ghost" onClick={() => void copyAssetDiagnosticSummary("character")} type="button">
                复制当前体检结论
              </button>
            </div>
          </div>
          <p>{characterAssetModeSpec.summary}</p>
          <div className="comfy-asset-mode-grid">
            <div>
              <strong>必需节点</strong>
              <ul>
                {characterAssetModeSpec.requiredNodes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <strong>模型要求</strong>
              <ul>
                {characterAssetModeSpec.requiredModels.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="comfy-asset-mode-grid">
            <div>
              <strong>推荐插件</strong>
              <ul>
                {(characterAssetModeSpec.recommendedPlugins.length > 0
                  ? characterAssetModeSpec.recommendedPlugins
                  : ["无额外插件要求"]).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <strong>备注</strong>
              <ul>
                {characterAssetModeSpec.notes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <div className="comfy-asset-alert-strip">
          <strong>角色三视图当前摘要</strong>
          <div className={`comfy-asset-alert-list ${characterIssueSummary.some((item) => item.includes("缺失") || item.includes("拦截") || item.includes("未配置") || item.includes("未出现在")) ? "is-error" : "is-ok"}`}>
            {characterIssueSummary.map((item) => (
              <div key={item}>{item}</div>
            ))}
          </div>
        </div>
        <label>
          角色三视图主模型
          <select
            onChange={(event) =>
              persistSettings((previous) => ({
                ...previous,
                characterAssetModelName: event.target.value
              }))
            }
            value={settings.characterAssetModelName ?? DEFAULT_CHARACTER_ASSET_MODEL}
          >
            {CHARACTER_ASSET_MODEL_OPTIONS.map((modelName) => (
              <option key={modelName} value={modelName}>
                {modelName}
              </option>
            ))}
          </select>
        </label>
        <div className="timeline-actions">
          <button
            className="btn-ghost"
            onClick={async () => {
              try {
                const options =
                  availableCheckpointOptions.length > 0
                    ? availableCheckpointOptions
                    : await listComfyCheckpointOptions(settings.baseUrl);
                setAvailableCheckpointOptions(options);
                const next = pickFirstAvailableModel(CHARACTER_ASSET_MODEL_RECOMMEND_ORDER, options);
                if (!next) {
                  pushToast("未从 ComfyUI 读取到可用 checkpoint 下拉", "warning");
                  appendLog("角色三视图推荐模型失败：未读取到可用 checkpoint 下拉", "error");
                  return;
                }
                persistSettings((previous) => ({ ...previous, characterAssetModelName: next }));
                appendLog(`角色三视图已切换推荐模型：${next}`);
                pushToast(`角色三视图已切换推荐模型：${next}`, "success");
              } catch (error) {
                pushToast(`读取 Comfy checkpoint 下拉失败：${String(error)}`, "error");
                appendLog(`读取 Comfy checkpoint 下拉失败：${String(error)}`, "error");
              }
            }}
            type="button"
          >
            一键推荐角色模型
          </button>
          <button
            className="btn-ghost"
            onClick={async () => {
              try {
                const options = await listComfyCheckpointOptions(settings.baseUrl);
                setAvailableCheckpointOptions(options);
                appendLog(`已刷新 Comfy checkpoint 下拉，共 ${options.length} 项`);
                pushToast(`已刷新 Comfy checkpoint 下拉，共 ${options.length} 项`, "success");
              } catch (error) {
                pushToast(`读取 Comfy checkpoint 下拉失败：${String(error)}`, "error");
                appendLog(`读取 Comfy checkpoint 下拉失败：${String(error)}`, "error");
              }
            }}
            type="button"
          >
            刷新可用模型
          </button>
        </div>
        <div className="timeline-meta">
          当前模型可见性：{characterModelVisible == null ? "未读取 Comfy 下拉" : characterModelVisible ? "已命中 Comfy 下拉" : "当前模型未出现在 Comfy 下拉"}
        </div>
        <label>
          角色三视图内置模板比例
          <select
            onChange={(event) =>
              persistSettings((previous) => ({
                ...previous,
                characterTemplatePreset: event.target.value as "portrait" | "square"
              }))
            }
            value={settings.characterTemplatePreset ?? "portrait"}
          >
            <option value="portrait">竖版全身（832x1216）</option>
            <option value="square">方版设定（1024x1024）</option>
          </select>
        </label>
        <label>
          角色三视图采样预设
          <select
            onChange={(event) =>
              persistSettings((previous) => ({
                ...previous,
                characterRenderPreset: event.target.value as "stable_fullbody" | "clean_reference"
              }))
            }
            value={settings.characterRenderPreset ?? "stable_fullbody"}
          >
            <option value="stable_fullbody">稳定全身（Euler / 28 steps / cfg 5.5）</option>
            <option value="clean_reference">干净设定（DPM++ 2M / 32 steps / cfg 6）</option>
          </select>
        </label>
        <label>
          角色三视图背景模板
          <select
            onChange={(event) =>
              persistSettings((previous) => ({
                ...previous,
                characterBackgroundPreset: event.target.value as "white" | "gray" | "studio"
              }))
            }
            value={settings.characterBackgroundPreset ?? "gray"}
          >
            <option value="gray">中性灰背景</option>
            <option value="white">纯白背景</option>
            <option value="studio">影棚背景</option>
          </select>
        </label>
        <label className="comfy-script-block">
          角色三视图默认负面词
          <textarea
            onChange={(event) =>
              persistSettings((previous) => ({ ...previous, characterAssetNegativePrompt: event.target.value }))
            }
            placeholder="用于角色三视图的默认 NEGATIVE_PROMPT"
            rows={3}
            value={settings.characterAssetNegativePrompt ?? DEFAULT_CHARACTER_NEGATIVE_PROMPT}
          />
        </label>
        <div className="timeline-actions">
          <button
            className="btn-ghost"
            onClick={() => {
              persistSettings((previous) => ({
                ...previous,
                characterWorkflowJson:
                  characterAssetWorkflowMode === "advanced_multiview"
                    ? buildCharacterAdvancedWorkflowTemplateJson(
                        previous.characterAssetModelName?.trim() || DEFAULT_CHARACTER_ASSET_MODEL,
                        previous.characterTemplatePreset ?? "portrait",
                        previous.characterRenderPreset ?? "stable_fullbody"
                      )
                    : buildCharacterWorkflowTemplateJson(
                        previous.characterAssetModelName?.trim() || DEFAULT_CHARACTER_ASSET_MODEL,
                        previous.characterTemplatePreset ?? "portrait",
                        previous.characterRenderPreset ?? "stable_fullbody"
                      )
              }));
              appendLog(
                characterAssetWorkflowMode === "advanced_multiview"
                  ? "已写入内置高级多视角角色工作流模板"
                  : "已写入内置角色三视图默认工作流模板"
              );
              pushToast(
                characterAssetWorkflowMode === "advanced_multiview"
                  ? "已写入内置高级多视角角色工作流模板"
                  : "已写入内置角色三视图默认工作流模板",
                "success"
              );
            }}
            type="button"
          >
            {characterAssetWorkflowMode === "advanced_multiview" ? "写入内置高级多视角模板" : "写入内置角色三视图模板"}
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              persistSettings((previous) => ({ ...previous, characterWorkflowJson: previous.imageWorkflowJson }));
              appendLog("已将当前图片工作流复制为角色三视图工作流");
              pushToast("已将当前图片工作流复制为角色三视图工作流", "success");
            }}
            type="button"
          >
            从图片工作流复制
          </button>
          <button className="btn-ghost" onClick={() => void runAssetWorkflowDiagnostic("character")} type="button">
            体检当前三视图模板
          </button>
          <button className="btn-ghost" onClick={() => void onTrialCharacterWorkflow()} type="button">
            单步试跑三视图模板
          </button>
        </div>
        <div className="timeline-meta">
          角色三视图会强制使用单角色、单角度、纯背景约束。建议使用专门的角色设定工作流，而不是普通分镜图工作流。
        </div>
        <div className="timeline-meta">
          要求：一张图只能有一个角色、一个角度；不要输出拼图或三联图；
          {characterAssetWorkflowMode === "advanced_multiview"
            ? "允许使用动态参考图 {{FRAME_IMAGE_PATH}}，但不要写死固定 LoadImage。"
            : "不要依赖固定 LoadImage；"}
          最终必须稳定产出单张图片。
        </div>
        <div className="timeline-meta">
          {characterAssetWorkflowMode === "advanced_multiview"
            ? "内置高级模板节点：LdmPipelineLoader / LdmVaeLoader / DiffusersMVSchedulerLoader / DiffusersMVModelMakeup / ViewSelector / DiffusersMVSampler / SaveImage"
            : "内置模板节点：CheckpointLoaderSimple / CLIPTextEncode / EmptyLatentImage / KSampler / VAEDecode / SaveImage"}
        </div>
        <div className="timeline-meta">
          {characterAssetWorkflowMode === "advanced_multiview"
            ? `内置高级模板会使用 ${DEFAULT_CHARACTER_ASSET_MODEL} + ${DEFAULT_CHARACTER_ADVANCED_VAE} + ${DEFAULT_CHARACTER_ADVANCED_ADAPTER}。`
            : `内置模板模型：1 个主模型。基于你当前 Windows 已有模型，默认推荐 ${DEFAULT_CHARACTER_ASSET_MODEL}；可替换为 realisticVisionV60B1_v51VAE.safetensors 或 animagine-xl-4.0.safetensors。`}
        </div>
        <div className="timeline-meta">
          当前采样预设：{CHARACTER_RENDER_PRESET_CONFIG[settings.characterRenderPreset ?? "stable_fullbody"].label} /
          seed {CHARACTER_RENDER_PRESET_CONFIG[settings.characterRenderPreset ?? "stable_fullbody"].seed} /
          steps {CHARACTER_RENDER_PRESET_CONFIG[settings.characterRenderPreset ?? "stable_fullbody"].steps} /
          cfg {CHARACTER_RENDER_PRESET_CONFIG[settings.characterRenderPreset ?? "stable_fullbody"].cfg}
        </div>
        <div className="timeline-meta">
          当前背景模板：{settings.characterBackgroundPreset === "white"
            ? "纯白背景"
            : settings.characterBackgroundPreset === "studio"
              ? "影棚背景"
              : "中性灰背景"}
        </div>
        <div className="comfy-preview-grid">
          <label className="comfy-script-block comfy-preview-block">
            三视图喂词预览 · 正视图
            <textarea readOnly rows={5} value={characterPromptPreviews.front} />
          </label>
          <label className="comfy-script-block comfy-preview-block">
            三视图喂词预览 · 侧视图
            <textarea readOnly rows={5} value={characterPromptPreviews.side} />
          </label>
          <label className="comfy-script-block comfy-preview-block">
            三视图喂词预览 · 背视图
            <textarea readOnly rows={5} value={characterPromptPreviews.back} />
          </label>
        </div>
        {characterWorkflowDiagnostic && (
          <div className="comfy-asset-diagnostic-card">
            <div className="comfy-asset-diagnostic-head">
              <strong>角色三视图模板体检</strong>
              <span>{characterWorkflowDiagnostic.workflowConfigured ? "已配置专用工作流" : "未配置专用工作流"}</span>
            </div>
            <div className="comfy-asset-diagnostic-grid">
              <div>当前模式</div>
              <div>{characterWorkflowDiagnostic.modeSpec.label}</div>
              <div>模型</div>
              <div>{characterWorkflowDiagnostic.selectedModel}</div>
              <div>模型可见性</div>
              <div>
                {characterWorkflowDiagnostic.modelVisible == null
                  ? "未读取 Comfy 下拉"
                  : characterWorkflowDiagnostic.modelVisible
                    ? "已命中 Comfy 下拉"
                    : "未命中 Comfy 下拉"}
              </div>
              <div>Token 预检</div>
              <div>
                {characterWorkflowDiagnostic.templateValid
                  ? `通过（${characterWorkflowDiagnostic.usedTokens.length} 个 token）`
                  : `失败：缺少 ${characterWorkflowDiagnostic.templateMissing.join("、")}`}
              </div>
              <div>节点体检</div>
              <div>{summarizeDependencyReport(characterWorkflowDiagnostic.dependencyReport)}</div>
              <div>缺失节点</div>
              <div>{formatMissingNodes(characterWorkflowDiagnostic.dependencyReport)}</div>
              <div>建议插件</div>
              <div>{formatHintPlugins(characterWorkflowDiagnostic.dependencyReport)}</div>
            </div>
            <div className="comfy-asset-diagnostic-list">
              <div>模式说明：{characterWorkflowDiagnostic.modeSpec.summary}</div>
              <div>模式必需节点：{characterWorkflowDiagnostic.modeSpec.requiredNodes.join("、")}</div>
              <div>模式模型要求：{characterWorkflowDiagnostic.modeSpec.requiredModels.join("、")}</div>
              <div>
                模式推荐插件：
                {characterWorkflowDiagnostic.modeSpec.recommendedPlugins.length > 0
                  ? characterWorkflowDiagnostic.modeSpec.recommendedPlugins.join("、")
                  : "无"}
              </div>
            </div>
            {characterWorkflowDiagnostic.heuristic.warnings.length > 0 && (
              <div className="comfy-asset-diagnostic-list is-warning">
                {characterWorkflowDiagnostic.heuristic.warnings.map((item) => (
                  <div key={item}>警告：{item}</div>
                ))}
              </div>
            )}
            {characterWorkflowDiagnostic.heuristic.notes.length > 0 && (
              <div className="comfy-asset-diagnostic-list">
                {characterWorkflowDiagnostic.heuristic.notes.map((item) => (
                  <div key={item}>说明：{item}</div>
                ))}
              </div>
            )}
          </div>
        )}
        <label className="checkbox-row">
          <input
            checked={settings.requireDedicatedCharacterWorkflow !== false}
            onChange={(event) =>
              persistSettings((previous) => ({
                ...previous,
                requireDedicatedCharacterWorkflow: event.target.checked
              }))
            }
            type="checkbox"
          />
          严格资产模式：角色三视图未配置专用工作流时，禁止回退普通分镜工作流
        </label>
        <label className="comfy-script-block">
          场景天空盒工作流（JSON）
          <textarea
            onChange={(event) =>
              persistSettings((previous) => ({ ...previous, skyboxWorkflowJson: event.target.value }))
            }
            placeholder='可选。粘贴专用于天空盒六面的 ComfyUI API 工作流 JSON；留空则回退到图片工作流。'
            rows={5}
            value={settings.skyboxWorkflowJson ?? ""}
          />
        </label>
        <label>
          天空盒工作流模式
          <select
            onChange={(event) =>
              persistSettings((previous) => ({
                ...previous,
                skyboxAssetWorkflowMode: event.target.value as SkyboxAssetWorkflowMode
              }))
            }
            value={skyboxAssetWorkflowMode}
          >
            <option value="basic_builtin">基础六次文生图模板</option>
            <option value="advanced_panorama">高级全景转六面工作流</option>
          </select>
        </label>
        <div className="comfy-asset-mode-card">
          <div className="comfy-asset-mode-head">
            <strong>{skyboxAssetModeSpec.label}</strong>
            <div className="timeline-actions">
              <button className="btn-ghost" onClick={() => void copyAssetModeSummary("skybox")} type="button">
                复制模式清单
              </button>
              <button className="btn-ghost" onClick={() => void copyAssetDiagnosticSummary("skybox")} type="button">
                复制当前体检结论
              </button>
            </div>
          </div>
          <p>{skyboxAssetModeSpec.summary}</p>
          <div className="comfy-asset-mode-grid">
            <div>
              <strong>必需节点</strong>
              <ul>
                {skyboxAssetModeSpec.requiredNodes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <strong>模型要求</strong>
              <ul>
                {skyboxAssetModeSpec.requiredModels.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="comfy-asset-mode-grid">
            <div>
              <strong>推荐插件</strong>
              <ul>
                {(skyboxAssetModeSpec.recommendedPlugins.length > 0 ? skyboxAssetModeSpec.recommendedPlugins : ["无额外插件要求"]).map(
                  (item) => (
                    <li key={item}>{item}</li>
                  )
                )}
              </ul>
            </div>
            <div>
              <strong>备注</strong>
              <ul>
                {skyboxAssetModeSpec.notes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <div className="comfy-asset-alert-strip">
          <strong>天空盒当前摘要</strong>
          <div className={`comfy-asset-alert-list ${skyboxIssueSummary.some((item) => item.includes("缺失") || item.includes("拦截") || item.includes("未配置") || item.includes("未出现在")) ? "is-error" : "is-ok"}`}>
            {skyboxIssueSummary.map((item) => (
              <div key={item}>{item}</div>
            ))}
          </div>
        </div>
        <label>
          天空盒主模型
          <select
            onChange={(event) =>
              persistSettings((previous) => ({
                ...previous,
                skyboxAssetModelName: event.target.value
              }))
            }
            value={settings.skyboxAssetModelName ?? DEFAULT_SKYBOX_ASSET_MODEL}
          >
            {SKYBOX_ASSET_MODEL_OPTIONS.map((modelName) => (
              <option key={modelName} value={modelName}>
                {modelName}
              </option>
            ))}
          </select>
        </label>
        <div className="timeline-actions">
          <button
            className="btn-ghost"
            onClick={async () => {
              try {
                const options =
                  availableCheckpointOptions.length > 0
                    ? availableCheckpointOptions
                    : await listComfyCheckpointOptions(settings.baseUrl);
                setAvailableCheckpointOptions(options);
                const next = pickFirstAvailableModel(SKYBOX_ASSET_MODEL_RECOMMEND_ORDER, options);
                if (!next) {
                  pushToast("未从 ComfyUI 读取到可用 checkpoint 下拉", "warning");
                  appendLog("天空盒推荐模型失败：未读取到可用 checkpoint 下拉", "error");
                  return;
                }
                persistSettings((previous) => ({ ...previous, skyboxAssetModelName: next }));
                appendLog(`天空盒已切换推荐模型：${next}`);
                pushToast(`天空盒已切换推荐模型：${next}`, "success");
              } catch (error) {
                pushToast(`读取 Comfy checkpoint 下拉失败：${String(error)}`, "error");
                appendLog(`读取 Comfy checkpoint 下拉失败：${String(error)}`, "error");
              }
            }}
            type="button"
          >
            一键推荐天空盒模型
          </button>
        </div>
        <div className="timeline-meta">
          当前模型可见性：{skyboxModelVisible == null ? "未读取 Comfy 下拉" : skyboxModelVisible ? "已命中 Comfy 下拉" : "当前模型未出现在 Comfy 下拉"}
        </div>
        <label>
          天空盒内置模板比例
          <select
            onChange={(event) =>
              persistSettings((previous) => ({
                ...previous,
                skyboxTemplatePreset: event.target.value as "wide" | "square"
              }))
            }
            value={settings.skyboxTemplatePreset ?? "wide"}
          >
            <option value="wide">横版环境（1344x768）</option>
            <option value="square">方版环境（1024x1024）</option>
          </select>
        </label>
        <label>
          天空盒正向场景模板
          <select
            onChange={(event) =>
              persistSettings((previous) => ({
                ...previous,
                skyboxPromptPreset: event.target.value as "day_exterior" | "night_exterior" | "interior"
              }))
            }
            value={settings.skyboxPromptPreset ?? "day_exterior"}
          >
            <option value="day_exterior">日景外景</option>
            <option value="night_exterior">夜景外景</option>
            <option value="interior">室内空间</option>
          </select>
        </label>
        <label>
          天空盒负面词模板
          <select
            onChange={(event) =>
              persistSettings((previous) => ({
                ...previous,
                skyboxNegativePreset: event.target.value as "day_exterior" | "night_exterior" | "interior"
              }))
            }
            value={settings.skyboxNegativePreset ?? "day_exterior"}
          >
            <option value="day_exterior">日景外景</option>
            <option value="night_exterior">夜景外景</option>
            <option value="interior">室内空间</option>
          </select>
        </label>
        <label className="comfy-script-block">
          天空盒默认负面词
          <textarea
            onChange={(event) =>
              persistSettings((previous) => ({ ...previous, skyboxAssetNegativePrompt: event.target.value }))
            }
            placeholder="用于天空盒的默认 NEGATIVE_PROMPT"
            rows={3}
            value={settings.skyboxAssetNegativePrompt ?? DEFAULT_SKYBOX_NEGATIVE_PROMPT}
          />
        </label>
        <div className="timeline-actions">
          <button
            className="btn-ghost"
            onClick={() => {
              persistSettings((previous) => ({
                ...previous,
                skyboxWorkflowJson:
                  skyboxAssetWorkflowMode === "advanced_panorama"
                    ? buildSkyboxPanoramaWorkflowTemplateJson(
                        previous.skyboxAssetModelName?.trim() || DEFAULT_SKYBOX_ASSET_MODEL,
                        previous.skyboxTemplatePreset ?? "wide"
                      )
                    : buildSkyboxWorkflowTemplateJson(
                        previous.skyboxAssetModelName?.trim() || DEFAULT_SKYBOX_ASSET_MODEL,
                        previous.skyboxTemplatePreset ?? "wide"
                      )
              }));
              appendLog(
                skyboxAssetWorkflowMode === "advanced_panorama"
                  ? "已写入内置高级全景转六面工作流模板"
                  : "已写入内置天空盒默认工作流模板"
              );
              pushToast(
                skyboxAssetWorkflowMode === "advanced_panorama"
                  ? "已写入内置高级全景转六面工作流模板"
                  : "已写入内置天空盒默认工作流模板",
                "success"
              );
            }}
            type="button"
          >
            {skyboxAssetWorkflowMode === "advanced_panorama" ? "写入内置高级全景转六面模板" : "写入内置天空盒模板"}
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              persistSettings((previous) => ({
                ...previous,
                skyboxAssetNegativePrompt: SKYBOX_NEGATIVE_PRESET_TEXT[previous.skyboxNegativePreset ?? "day_exterior"]
              }));
              appendLog("已套用天空盒负面词模板");
              pushToast("已套用天空盒负面词模板", "success");
            }}
            type="button"
          >
            套用负面词模板
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              persistSettings((previous) => ({ ...previous, skyboxWorkflowJson: previous.imageWorkflowJson }));
              appendLog("已将当前图片工作流复制为天空盒工作流");
              pushToast("已将当前图片工作流复制为天空盒工作流", "success");
            }}
            type="button"
          >
            从图片工作流复制
          </button>
          <button className="btn-ghost" onClick={() => void runAssetWorkflowDiagnostic("skybox")} type="button">
            体检当前天空盒模板
          </button>
          <button className="btn-ghost" onClick={() => void onTrialSkyboxWorkflow()} type="button">
            单步试跑天空盒模板
          </button>
        </div>
        <div className="timeline-meta">
          天空盒工作流必须只生成环境，不允许出现人物。建议使用去人物、去叙事主体的专用场景工作流。
        </div>
        <div className="timeline-meta">
          {skyboxAssetWorkflowMode === "advanced_panorama"
            ? "要求：高级模式会先生成单张 2:1 全景，再自动拆成六面；禁止人物、动物、群像、主体表演；不要混入视频/音频节点。"
            : "要求：系统会按六个面逐次调用；每次必须只输出纯环境图；禁止人物、动物、群像、主体表演；不要混入视频/音频节点。"}
        </div>
        <div className="timeline-meta">
          {skyboxAssetWorkflowMode === "advanced_panorama"
            ? "内置高级模板节点：CheckpointLoaderSimple / LoraLoader / Apply Circular Padding Model / Apply Circular Padding VAE / Equirectangular to Face / SaveImage"
            : "内置模板节点：CheckpointLoaderSimple / CLIPTextEncode / EmptyLatentImage / KSampler / VAEDecode / SaveImage"}
        </div>
        <div className="timeline-meta">
          {skyboxAssetWorkflowMode === "advanced_panorama"
            ? `内置高级模板会使用 ${DEFAULT_SKYBOX_ASSET_MODEL} + ${DEFAULT_SKYBOX_LORA}。`
            : `内置模板模型：1 个主模型。基于你当前 Windows 已有模型，默认推荐 ${DEFAULT_SKYBOX_ASSET_MODEL}；室内可切到 interiordesignsuperm_v2.safetensors，通用环境可切到 dreamshaper_8.safetensors。`}
        </div>
        <div className="timeline-meta">
          当前正向模板：{settings.skyboxPromptPreset === "night_exterior"
            ? "夜景外景"
            : settings.skyboxPromptPreset === "interior"
              ? "室内空间"
              : "日景外景"}
        </div>
        <div className="timeline-meta">
          当前负面词模板：{settings.skyboxNegativePreset === "night_exterior"
            ? "夜景外景"
            : settings.skyboxNegativePreset === "interior"
              ? "室内空间"
              : "日景外景"}
        </div>
        <div className="comfy-preview-grid">
          {skyboxFacePromptPreviews.map((item) => (
            <label className="comfy-script-block comfy-preview-block" key={item.face}>
              天空盒喂词预览 · {item.face}
              <textarea readOnly rows={5} value={item.prompt} />
            </label>
          ))}
        </div>
        {skyboxWorkflowDiagnostic && (
          <div className="comfy-asset-diagnostic-card">
            <div className="comfy-asset-diagnostic-head">
              <strong>天空盒模板体检</strong>
              <span>{skyboxWorkflowDiagnostic.workflowConfigured ? "已配置专用工作流" : "未配置专用工作流"}</span>
            </div>
            <div className="comfy-asset-diagnostic-grid">
              <div>当前模式</div>
              <div>{skyboxWorkflowDiagnostic.modeSpec.label}</div>
              <div>模型</div>
              <div>{skyboxWorkflowDiagnostic.selectedModel}</div>
              <div>模型可见性</div>
              <div>
                {skyboxWorkflowDiagnostic.modelVisible == null
                  ? "未读取 Comfy 下拉"
                  : skyboxWorkflowDiagnostic.modelVisible
                    ? "已命中 Comfy 下拉"
                    : "未命中 Comfy 下拉"}
              </div>
              <div>Token 预检</div>
              <div>
                {skyboxWorkflowDiagnostic.templateValid
                  ? `通过（${skyboxWorkflowDiagnostic.usedTokens.length} 个 token）`
                  : `失败：缺少 ${skyboxWorkflowDiagnostic.templateMissing.join("、")}`}
              </div>
              <div>节点体检</div>
              <div>{summarizeDependencyReport(skyboxWorkflowDiagnostic.dependencyReport)}</div>
              <div>缺失节点</div>
              <div>{formatMissingNodes(skyboxWorkflowDiagnostic.dependencyReport)}</div>
              <div>建议插件</div>
              <div>{formatHintPlugins(skyboxWorkflowDiagnostic.dependencyReport)}</div>
            </div>
            <div className="comfy-asset-diagnostic-list">
              <div>模式说明：{skyboxWorkflowDiagnostic.modeSpec.summary}</div>
              <div>模式必需节点：{skyboxWorkflowDiagnostic.modeSpec.requiredNodes.join("、")}</div>
              <div>模式模型要求：{skyboxWorkflowDiagnostic.modeSpec.requiredModels.join("、")}</div>
              <div>
                模式推荐插件：
                {skyboxWorkflowDiagnostic.modeSpec.recommendedPlugins.length > 0
                  ? skyboxWorkflowDiagnostic.modeSpec.recommendedPlugins.join("、")
                  : "无"}
              </div>
            </div>
            {skyboxWorkflowDiagnostic.heuristic.warnings.length > 0 && (
              <div className="comfy-asset-diagnostic-list is-warning">
                {skyboxWorkflowDiagnostic.heuristic.warnings.map((item) => (
                  <div key={item}>警告：{item}</div>
                ))}
              </div>
            )}
            {skyboxWorkflowDiagnostic.heuristic.notes.length > 0 && (
              <div className="comfy-asset-diagnostic-list">
                {skyboxWorkflowDiagnostic.heuristic.notes.map((item) => (
                  <div key={item}>说明：{item}</div>
                ))}
              </div>
            )}
          </div>
        )}
        <label className="checkbox-row">
          <input
            checked={settings.requireDedicatedSkyboxWorkflow !== false}
            onChange={(event) =>
              persistSettings((previous) => ({
                ...previous,
                requireDedicatedSkyboxWorkflow: event.target.checked
              }))
            }
            type="checkbox"
          />
          严格资产模式：天空盒未配置专用工作流时，禁止回退普通分镜工作流
        </label>
        <label className="comfy-script-block">
          配音工作流（JSON）
          <textarea
            onChange={(event) =>
              persistSettings((previous) => ({ ...previous, audioWorkflowJson: event.target.value }))
            }
            placeholder='粘贴 ComfyUI TTS API 工作流 JSON，建议至少使用 {{DIALOGUE}} 占位'
            rows={5}
            value={settings.audioWorkflowJson ?? ""}
          />
        </label>
        <div className="timeline-meta">
          对白支持写法：角色名: 台词、角色名(压低声音,急促): 台词、【旁白|低沉】内容。配音工作流可选 token：
          {" {{SPEAKER_NAME}} / {{EMOTION}} / {{DELIVERY_STYLE}} / {{SPEECH_RATE}}"}
        </div>
        <label className="comfy-script-block">
          环境/音效工作流（JSON）
          <textarea
            onChange={(event) =>
              persistSettings((previous) => ({ ...previous, soundWorkflowJson: event.target.value }))
            }
            placeholder='粘贴 ComfyUI 音效生成工作流 JSON，建议至少使用 {{PROMPT}} 占位'
            rows={5}
            value={settings.soundWorkflowJson ?? ""}
          />
        </label>
        <div className="timeline-actions">
          <button
            className="btn-ghost"
            onClick={() => {
              const workflowText = settings.characterWorkflowJson?.trim() || settings.imageWorkflowJson;
              const advancedMode = (settings.characterAssetWorkflowMode ?? DEFAULT_CHARACTER_ASSET_WORKFLOW_MODE) === "advanced_multiview";
              const check = validateWorkflowTemplate(workflowText, settings.tokenMapping);
              const heuristic = inspectAssetWorkflowHeuristics(workflowText, "character");
              if (!check.ok) {
                pushToast(`角色三视图工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
                appendLog(`角色三视图工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
              } else {
                if (settings.characterWorkflowJson?.trim()) {
                  appendLog(`角色三视图工作流预检通过，检测到 ${check.used.length} 个 token`);
                } else if (advancedMode) {
                  appendLog("角色三视图当前处于高级多视角角色工作流模式，但尚未配置专用工作流 JSON。", "error");
                } else {
                  appendLog(`角色三视图工作流未单独配置，当前会使用基础内置模板，检测到 ${check.used.length} 个 token`);
                }
                if (settings.requireDedicatedCharacterWorkflow !== false && !settings.characterWorkflowJson?.trim()) {
                  appendLog("角色三视图严格资产模式已开启：当前未配置专用工作流时，正式生成会被拦截。", "error");
                }
                heuristic.warnings.forEach((item) => appendLog(`角色三视图工作流警告：${item}`, "error"));
                heuristic.notes.forEach((item) => appendLog(`角色三视图工作流说明：${item}`));
                pushToast("角色三视图工作流预检通过", "success");
              }
            }}
            type="button"
          >
            预检角色三视图工作流
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              const workflowText = settings.skyboxWorkflowJson?.trim() || settings.imageWorkflowJson;
              const advancedMode = (settings.skyboxAssetWorkflowMode ?? DEFAULT_SKYBOX_ASSET_WORKFLOW_MODE) === "advanced_panorama";
              const check = validateWorkflowTemplate(workflowText, settings.tokenMapping);
              const heuristic = inspectAssetWorkflowHeuristics(workflowText, "skybox");
              if (!check.ok) {
                pushToast(`天空盒工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
                appendLog(`天空盒工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
              } else {
                if (settings.skyboxWorkflowJson?.trim()) {
                  appendLog(`天空盒工作流预检通过，检测到 ${check.used.length} 个 token`);
                } else if (advancedMode) {
                  appendLog("天空盒当前处于高级全景转六面模式，但尚未配置专用工作流 JSON。", "error");
                } else {
                  appendLog(`天空盒工作流未单独配置，当前会使用基础内置模板，检测到 ${check.used.length} 个 token`);
                }
                if (settings.requireDedicatedSkyboxWorkflow !== false && !settings.skyboxWorkflowJson?.trim()) {
                  appendLog("天空盒严格资产模式已开启：当前未配置专用工作流时，正式生成会被拦截。", "error");
                }
                heuristic.warnings.forEach((item) => appendLog(`天空盒工作流警告：${item}`, "error"));
                heuristic.notes.forEach((item) => appendLog(`天空盒工作流说明：${item}`));
                pushToast("天空盒工作流预检通过", "success");
              }
            }}
            type="button"
          >
            预检天空盒工作流
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              const check = validateWorkflowTemplate(settings.imageWorkflowJson, settings.tokenMapping);
              if (!check.ok) {
                pushToast(`图片工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
                appendLog(`图片工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
              } else {
                if (check.used.length === 0) {
                  pushToast("图片工作流预检通过（未检测到 token，占位由节点绑定处理）", "success");
                  appendLog("图片工作流预检通过：未检测到 token，将使用节点绑定模式");
                } else {
                  pushToast(`图片工作流预检通过（检测到 ${check.used.length} 个 token）`, "success");
                  appendLog(`图片工作流预检通过，检测到 ${check.used.length} 个 token`);
                }
              }
            }}
            type="button"
          >
            预检图片工作流
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              const check = validateWorkflowTemplate(settings.videoWorkflowJson, settings.tokenMapping);
              if (!check.ok) {
                pushToast(`视频工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
                appendLog(`视频工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
              } else {
                const lipSync = inspectVideoWorkflowLipSyncSupport(settings.videoWorkflowJson, settings.tokenMapping);
                if (check.used.length === 0) {
                  pushToast("视频工作流预检通过（未检测到 token，占位由节点绑定处理）", "success");
                  appendLog("视频工作流预检通过：未检测到 token，将使用节点绑定模式");
                } else {
                  pushToast(`视频工作流预检通过（检测到 ${check.used.length} 个 token）`, "success");
                  appendLog(`视频工作流预检通过，检测到 ${check.used.length} 个 token`);
                }
                if (lipSync.usesDialogueAudioPathToken) {
                  appendLog(`视频工作流口型同步预检通过：已检测到对白音频 token ${lipSync.matchedPathTokens.join(", ")}`);
                } else {
                  appendLog(
                    `视频工作流口型同步提示：未检测到对白音频 token（建议至少使用 {{${lipSync.candidatePathTokens[0]}}}）`,
                    "error"
                  );
                }
              }
            }}
            type="button"
          >
            预检视频工作流
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              if (!settings.audioWorkflowJson?.trim()) {
                pushToast("请先粘贴配音工作流 JSON", "warning");
                appendLog("配音工作流预检跳过：未配置工作流 JSON", "error");
                return;
              }
              const check = validateWorkflowTemplate(settings.audioWorkflowJson, settings.tokenMapping, [
                settings.tokenMapping.dialogue.trim() || "DIALOGUE"
              ]);
              if (!check.ok) {
                pushToast(`配音工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
                appendLog(`配音工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
              } else {
                if (check.used.length === 0) {
                  pushToast("配音工作流预检通过（未检测到 token，占位由节点绑定处理）", "success");
                  appendLog("配音工作流预检通过：未检测到 token，将使用节点绑定模式");
                } else {
                  pushToast(`配音工作流预检通过（检测到 ${check.used.length} 个 token）`, "success");
                  appendLog(`配音工作流预检通过，检测到 ${check.used.length} 个 token`);
                }
              }
            }}
            type="button"
          >
            预检配音工作流
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              if (!settings.soundWorkflowJson?.trim()) {
                pushToast("请先粘贴环境/音效工作流 JSON", "warning");
                appendLog("环境/音效工作流预检跳过：未配置工作流 JSON", "error");
                return;
              }
              const check = validateWorkflowTemplate(settings.soundWorkflowJson, settings.tokenMapping, [
                settings.tokenMapping.prompt.trim() || "PROMPT"
              ]);
              if (!check.ok) {
                pushToast(`环境/音效工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
                appendLog(`环境/音效工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
              } else {
                if (check.used.length === 0) {
                  pushToast("环境/音效工作流预检通过（未检测到 token，占位由节点绑定处理）", "success");
                  appendLog("环境/音效工作流预检通过：未检测到 token，将使用节点绑定模式");
                } else {
                  pushToast(`环境/音效工作流预检通过（检测到 ${check.used.length} 个 token）`, "success");
                  appendLog(`环境/音效工作流预检通过，检测到 ${check.used.length} 个 token`);
                }
              }
            }}
            type="button"
          >
            预检环境/音效工作流
          </button>
        </div>
        <h3>工作流字段映射</h3>
        <div className="comfy-mapping-grid">
          <label>
            Prompt Token
            <input
              onChange={(event) => onUpdateTokenMapping("prompt", event.target.value)}
              placeholder="PROMPT"
              type="text"
              value={settings.tokenMapping.prompt}
            />
          </label>
          <label>
            NextScene Token
            <input
              onChange={(event) => onUpdateTokenMapping("nextScenePrompt", event.target.value)}
              placeholder="NEXT_SCENE_PROMPT"
              type="text"
              value={settings.tokenMapping.nextScenePrompt}
            />
          </label>
          <label>
            VideoPrompt Token
            <input
              onChange={(event) => onUpdateTokenMapping("videoPrompt", event.target.value)}
              placeholder="VIDEO_PROMPT"
              type="text"
              value={settings.tokenMapping.videoPrompt}
            />
          </label>
          <label>
            VideoMode Token
            <input
              onChange={(event) => onUpdateTokenMapping("videoMode", event.target.value)}
              placeholder="VIDEO_MODE"
              type="text"
              value={settings.tokenMapping.videoMode}
            />
          </label>
          <label>
            Negative Token
            <input
              onChange={(event) => onUpdateTokenMapping("negativePrompt", event.target.value)}
              placeholder="NEGATIVE_PROMPT"
              type="text"
              value={settings.tokenMapping.negativePrompt}
            />
          </label>
          <label>
            Seed Token
            <input
              onChange={(event) => onUpdateTokenMapping("seed", event.target.value)}
              placeholder="SEED"
              type="text"
              value={settings.tokenMapping.seed}
            />
          </label>
          <label>
            Title Token
            <input
              onChange={(event) => onUpdateTokenMapping("title", event.target.value)}
              placeholder="SHOT_TITLE"
              type="text"
              value={settings.tokenMapping.title}
            />
          </label>
          <label>
            Dialogue Token
            <input
              onChange={(event) => onUpdateTokenMapping("dialogue", event.target.value)}
              placeholder="DIALOGUE"
              type="text"
              value={settings.tokenMapping.dialogue}
            />
          </label>
          <label>
            DialogueAudioPath Token
            <input
              onChange={(event) => onUpdateTokenMapping("dialogueAudioPath", event.target.value)}
              placeholder="DIALOGUE_AUDIO_PATH"
              type="text"
              value={settings.tokenMapping.dialogueAudioPath}
            />
          </label>
          <label>
            DialogueAudioPaths Token
            <input
              onChange={(event) => onUpdateTokenMapping("dialogueAudioPaths", event.target.value)}
              placeholder="DIALOGUE_AUDIO_PATHS"
              type="text"
              value={settings.tokenMapping.dialogueAudioPaths}
            />
          </label>
          <label>
            DialogueAudioCount Token
            <input
              onChange={(event) => onUpdateTokenMapping("dialogueAudioCount", event.target.value)}
              placeholder="DIALOGUE_AUDIO_COUNT"
              type="text"
              value={settings.tokenMapping.dialogueAudioCount}
            />
          </label>
          <label>
            HasDialogueAudio Token
            <input
              onChange={(event) => onUpdateTokenMapping("hasDialogueAudio", event.target.value)}
              placeholder="HAS_DIALOGUE_AUDIO"
              type="text"
              value={settings.tokenMapping.hasDialogueAudio}
            />
          </label>
          <label>
            SpeakerName Token
            <input
              onChange={(event) => onUpdateTokenMapping("speakerName", event.target.value)}
              placeholder="SPEAKER_NAME"
              type="text"
              value={settings.tokenMapping.speakerName}
            />
          </label>
          <label>
            Emotion Token
            <input
              onChange={(event) => onUpdateTokenMapping("emotion", event.target.value)}
              placeholder="EMOTION"
              type="text"
              value={settings.tokenMapping.emotion}
            />
          </label>
          <label>
            DeliveryStyle Token
            <input
              onChange={(event) => onUpdateTokenMapping("deliveryStyle", event.target.value)}
              placeholder="DELIVERY_STYLE"
              type="text"
              value={settings.tokenMapping.deliveryStyle}
            />
          </label>
          <label>
            SpeechRate Token
            <input
              onChange={(event) => onUpdateTokenMapping("speechRate", event.target.value)}
              placeholder="SPEECH_RATE"
              type="text"
              value={settings.tokenMapping.speechRate}
            />
          </label>
          <label>
            VoiceProfile Token
            <input
              onChange={(event) => onUpdateTokenMapping("voiceProfile", event.target.value)}
              placeholder="VOICE_PROFILE"
              type="text"
              value={settings.tokenMapping.voiceProfile}
            />
          </label>
          <label>
            CharacterVoiceProfiles Token
            <input
              onChange={(event) => onUpdateTokenMapping("characterVoiceProfiles", event.target.value)}
              placeholder="CHARACTER_VOICE_PROFILES"
              type="text"
              value={settings.tokenMapping.characterVoiceProfiles}
            />
          </label>
          <label>
            DurationFrames Token
            <input
              onChange={(event) => onUpdateTokenMapping("durationFrames", event.target.value)}
              placeholder="DURATION_FRAMES"
              type="text"
              value={settings.tokenMapping.durationFrames}
            />
          </label>
          <label>
            DurationSec Token
            <input
              onChange={(event) => onUpdateTokenMapping("durationSec", event.target.value)}
              placeholder="DURATION_SEC"
              type="text"
              value={settings.tokenMapping.durationSec}
            />
          </label>
          <label>
            CharacterRefs Token
            <input
              onChange={(event) => onUpdateTokenMapping("characterRefs", event.target.value)}
              placeholder="CHARACTER_REFS"
              type="text"
              value={settings.tokenMapping.characterRefs}
            />
          </label>
          <label>
            SceneRefPath Token
            <input
              onChange={(event) => onUpdateTokenMapping("sceneRefPath", event.target.value)}
              placeholder="SCENE_REF_PATH"
              type="text"
              value={settings.tokenMapping.sceneRefPath}
            />
          </label>
          <label>
            SceneRefName Token
            <input
              onChange={(event) => onUpdateTokenMapping("sceneRefName", event.target.value)}
              placeholder="SCENE_REF_NAME"
              type="text"
              value={settings.tokenMapping.sceneRefName}
            />
          </label>
          <label>
            CharacterRefPaths Token
            <input
              onChange={(event) => onUpdateTokenMapping("characterRefPaths", event.target.value)}
              placeholder="CHARACTER_REF_PATHS"
              type="text"
              value={settings.tokenMapping.characterRefPaths}
            />
          </label>
          <label>
            CharacterRefNames Token
            <input
              onChange={(event) => onUpdateTokenMapping("characterRefNames", event.target.value)}
              placeholder="CHARACTER_REF_NAMES"
              type="text"
              value={settings.tokenMapping.characterRefNames}
            />
          </label>
          <label>
            CharacterFrontPaths Token
            <input
              onChange={(event) => onUpdateTokenMapping("characterFrontPaths", event.target.value)}
              placeholder="CHARACTER_FRONT_PATHS"
              type="text"
              value={settings.tokenMapping.characterFrontPaths}
            />
          </label>
          <label>
            CharacterSidePaths Token
            <input
              onChange={(event) => onUpdateTokenMapping("characterSidePaths", event.target.value)}
              placeholder="CHARACTER_SIDE_PATHS"
              type="text"
              value={settings.tokenMapping.characterSidePaths}
            />
          </label>
          <label>
            CharacterBackPaths Token
            <input
              onChange={(event) => onUpdateTokenMapping("characterBackPaths", event.target.value)}
              placeholder="CHARACTER_BACK_PATHS"
              type="text"
              value={settings.tokenMapping.characterBackPaths}
            />
          </label>
          <label>
            Char1Name Token
            <input
              onChange={(event) => onUpdateTokenMapping("character1Name", event.target.value)}
              placeholder="CHAR1_NAME"
              type="text"
              value={settings.tokenMapping.character1Name}
            />
          </label>
          <label>
            Char1Front Token
            <input
              onChange={(event) => onUpdateTokenMapping("character1FrontPath", event.target.value)}
              placeholder="CHAR1_FRONT_PATH"
              type="text"
              value={settings.tokenMapping.character1FrontPath}
            />
          </label>
          <label>
            Char1Side Token
            <input
              onChange={(event) => onUpdateTokenMapping("character1SidePath", event.target.value)}
              placeholder="CHAR1_SIDE_PATH"
              type="text"
              value={settings.tokenMapping.character1SidePath}
            />
          </label>
          <label>
            Char1Back Token
            <input
              onChange={(event) => onUpdateTokenMapping("character1BackPath", event.target.value)}
              placeholder="CHAR1_BACK_PATH"
              type="text"
              value={settings.tokenMapping.character1BackPath}
            />
          </label>
          <label>
            Char2Name Token
            <input
              onChange={(event) => onUpdateTokenMapping("character2Name", event.target.value)}
              placeholder="CHAR2_NAME"
              type="text"
              value={settings.tokenMapping.character2Name}
            />
          </label>
          <label>
            Char2Front Token
            <input
              onChange={(event) => onUpdateTokenMapping("character2FrontPath", event.target.value)}
              placeholder="CHAR2_FRONT_PATH"
              type="text"
              value={settings.tokenMapping.character2FrontPath}
            />
          </label>
          <label>
            Char2Side Token
            <input
              onChange={(event) => onUpdateTokenMapping("character2SidePath", event.target.value)}
              placeholder="CHAR2_SIDE_PATH"
              type="text"
              value={settings.tokenMapping.character2SidePath}
            />
          </label>
          <label>
            Char2Back Token
            <input
              onChange={(event) => onUpdateTokenMapping("character2BackPath", event.target.value)}
              placeholder="CHAR2_BACK_PATH"
              type="text"
              value={settings.tokenMapping.character2BackPath}
            />
          </label>
          <label>
            Char3Name Token
            <input
              onChange={(event) => onUpdateTokenMapping("character3Name", event.target.value)}
              placeholder="CHAR3_NAME"
              type="text"
              value={settings.tokenMapping.character3Name}
            />
          </label>
          <label>
            Char3Front Token
            <input
              onChange={(event) => onUpdateTokenMapping("character3FrontPath", event.target.value)}
              placeholder="CHAR3_FRONT_PATH"
              type="text"
              value={settings.tokenMapping.character3FrontPath}
            />
          </label>
          <label>
            Char3Side Token
            <input
              onChange={(event) => onUpdateTokenMapping("character3SidePath", event.target.value)}
              placeholder="CHAR3_SIDE_PATH"
              type="text"
              value={settings.tokenMapping.character3SidePath}
            />
          </label>
          <label>
            Char3Back Token
            <input
              onChange={(event) => onUpdateTokenMapping("character3BackPath", event.target.value)}
              placeholder="CHAR3_BACK_PATH"
              type="text"
              value={settings.tokenMapping.character3BackPath}
            />
          </label>
          <label>
            Char4Name Token
            <input
              onChange={(event) => onUpdateTokenMapping("character4Name", event.target.value)}
              placeholder="CHAR4_NAME"
              type="text"
              value={settings.tokenMapping.character4Name}
            />
          </label>
          <label>
            Char4Front Token
            <input
              onChange={(event) => onUpdateTokenMapping("character4FrontPath", event.target.value)}
              placeholder="CHAR4_FRONT_PATH"
              type="text"
              value={settings.tokenMapping.character4FrontPath}
            />
          </label>
          <label>
            Char4Side Token
            <input
              onChange={(event) => onUpdateTokenMapping("character4SidePath", event.target.value)}
              placeholder="CHAR4_SIDE_PATH"
              type="text"
              value={settings.tokenMapping.character4SidePath}
            />
          </label>
          <label>
            Char4Back Token
            <input
              onChange={(event) => onUpdateTokenMapping("character4BackPath", event.target.value)}
              placeholder="CHAR4_BACK_PATH"
              type="text"
              value={settings.tokenMapping.character4BackPath}
            />
          </label>
          <label>
            FrameImagePath Token
            <input
              onChange={(event) => onUpdateTokenMapping("frameImagePath", event.target.value)}
              placeholder="FRAME_IMAGE_PATH"
              type="text"
              value={settings.tokenMapping.frameImagePath}
            />
          </label>
          <label>
            FirstFrame Token
            <input
              onChange={(event) => onUpdateTokenMapping("firstFramePath", event.target.value)}
              placeholder="FIRST_FRAME_PATH"
              type="text"
              value={settings.tokenMapping.firstFramePath}
            />
          </label>
          <label>
            LastFrame Token
            <input
              onChange={(event) => onUpdateTokenMapping("lastFramePath", event.target.value)}
              placeholder="LAST_FRAME_PATH"
              type="text"
              value={settings.tokenMapping.lastFramePath}
            />
          </label>
        </div>
        <small>
          {"工作流里使用 {{TOKEN}} 占位。分镜建议用 {{NEXT_SCENE_PROMPT}}，视频建议用 {{VIDEO_PROMPT}}、{{VIDEO_MODE}} 和 {{DIALOGUE_AUDIO_PATH}}，配音建议用 {{DIALOGUE}}，环境/音效建议用 {{PROMPT}}。"}
        </small>
        </details>
      </section>

      <section className="comfy-stage">
        <div className="comfy-stage-head">
          <span className="comfy-stage-index">02</span>
          <h3>生成执行</h3>
        </div>
        <label className="comfy-script-block">
          原始故事文本
          <textarea
            onChange={(event) => setStoryText(event.target.value)}
            placeholder={"输入故事正文、分段剧情或对白文本。我会先按段落/句子拆成镜头，再生成可导入的 shots JSON。"}
            rows={6}
            value={storyText}
          />
        </label>
        <div className="comfy-primary-actions">
          <button className="btn-ghost" onClick={() => void onParseStory(false)} type="button">
            解析故事为镜头脚本
          </button>
          <button className="btn-ghost" onClick={() => void onParseStory(true)} type="button">
            解析并直接导入
          </button>
          <label className="timeline-snap-toggle">
            <input
              checked={autoProvisionAssets}
              onChange={(event) => setAutoProvisionAssets(event.target.checked)}
              type="checkbox"
            />
            新角色三视图 / 新场景天空盒自动生成并绑定
          </label>
        </div>
        {storyParsePreview && (
          <small>
            预计解析为 {storyParsePreview.count} 个镜头，预估总时长 {storyParsePreview.totalSec.toFixed(1)} 秒
          </small>
        )}
        {storyAssetPreview && (
          <div className="comfy-import-asset-preview">
            <small>
              故事资产预判：复用角色 {storyAssetPreview.reusedCharacters.length} / 新建角色 {storyAssetPreview.newCharacters.length}；
              复用天空盒 {storyAssetPreview.reusedSkyboxes.length} / 新建天空盒 {storyAssetPreview.newSkyboxes.length}
            </small>
            <div className="shot-tags">
              {storyAssetPreview.reusedCharacters.map((name) => (
                <span key={`story_reuse_char_${name}`}>复用角色 · {name}</span>
              ))}
              {storyAssetPreview.newCharacters.map((name) => (
                <span key={`story_new_char_${name}`}>新建角色 · {name}</span>
              ))}
              {storyAssetPreview.reusedSkyboxes.map((name) => (
                <span key={`story_reuse_skybox_${name}`}>复用天空盒 · {name}</span>
              ))}
              {storyAssetPreview.newSkyboxes.map((name) => (
                <span key={`story_new_skybox_${name}`}>新建天空盒 · {name}</span>
              ))}
            </div>
            {storyProvisionChoices && (
              <div className="comfy-import-override-grid">
                <div className="comfy-import-override-actions">
                  <button
                    className="btn-ghost"
                    disabled={(storyAssetPreview?.newCharacters.length ?? 0) === 0}
                    onClick={() =>
                      void onPreGenerateProvisionAssets(
                        "故事导入",
                        storyNormalizedItems,
                        storyCharacterOverrides,
                        storySkyboxOverrides,
                        "characters"
                      )
                    }
                    type="button"
                  >
                    预生成缺失角色三视图
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={(storyAssetPreview?.newSkyboxes.length ?? 0) === 0}
                    onClick={() =>
                      void onPreGenerateProvisionAssets(
                        "故事导入",
                        storyNormalizedItems,
                        storyCharacterOverrides,
                        storySkyboxOverrides,
                        "skyboxes"
                      )
                    }
                    type="button"
                  >
                    预生成缺失场景天空盒
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={
                      (storyAssetPreview?.newCharacters.length ?? 0) + (storyAssetPreview?.newSkyboxes.length ?? 0) === 0
                    }
                    onClick={() =>
                      void onPreGenerateProvisionAssets(
                        "故事导入",
                        storyNormalizedItems,
                        storyCharacterOverrides,
                        storySkyboxOverrides,
                        "all"
                      )
                    }
                    type="button"
                  >
                    预生成全部缺失资产
                  </button>
                </div>
                <div className="comfy-import-preset-actions">
                  <label>
                    导入预设
                    <select
                      onChange={(event) => setStorySelectedPresetId(event.target.value)}
                      value={storySelectedPresetId}
                    >
                      <option value="">选择已保存预设…</option>
                      {sortedImportPresets.map((preset) => (
                        <option key={`story_import_preset_${preset.id}`} value={preset.id}>
                          {preset.pinned ? "置顶 · " : ""}{preset.name} · {formatImportPresetScope(preset.scope)} · {summarizeImportPreset(preset)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="timeline-snap-toggle">
                    <input
                      checked={autoApplyImportedPreset}
                      onChange={(event) => setAutoApplyImportedPreset(event.target.checked)}
                      type="checkbox"
                    />
                    导入 JSON 后自动应用
                  </label>
                  <button
                    className="btn-ghost"
                    disabled={!storySelectedPresetId}
                    onClick={() =>
                      applyImportPreset(
                        storySelectedPresetId,
                        storyProvisionChoices,
                        setStoryCharacterOverrides,
                        setStorySkyboxOverrides
                      )
                    }
                    type="button"
                  >
                    应用预设
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      const name = window.prompt("输入导入预设名称", "故事导入预设");
                      if (!name) return;
                      const note = window.prompt("输入预设备注（可选）", storySelectedPreset?.note ?? "") ?? "";
                      const scopeInput =
                        window.prompt("输入预设作用域：all / characters / skyboxes", storySelectedPreset?.scope ?? "all") ??
                        "";
                      const scope =
                        scopeInput.trim() === "characters" || scopeInput.trim() === "skyboxes"
                          ? (scopeInput.trim() as "characters" | "skyboxes")
                          : "all";
                      const presetId = saveImportPreset(
                        name,
                        note,
                        scope,
                        storyProvisionChoices,
                        storyCharacterOverrides,
                        storySkyboxOverrides
                      );
                      if (presetId) setStorySelectedPresetId(presetId);
                    }}
                    type="button"
                  >
                    保存当前为预设
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={!storySelectedPresetId}
                    onClick={() => deleteImportPreset(storySelectedPresetId)}
                    type="button"
                  >
                    删除预设
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={!storySelectedPresetId}
                    onClick={() => renameImportPreset(storySelectedPresetId)}
                    type="button"
                  >
                    重命名预设
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={!storySelectedPresetId}
                    onClick={() => {
                      const nextId = duplicateImportPreset(storySelectedPresetId);
                      if (nextId) setStorySelectedPresetId(nextId);
                    }}
                    type="button"
                  >
                    复制一份
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={!storySelectedPresetId}
                    onClick={() => toggleImportPresetPinned(storySelectedPresetId)}
                    type="button"
                  >
                    {storySelectedPreset?.pinned ? "取消置顶" : "置顶预设"}
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={!storySelectedPresetId}
                    onClick={() => editImportPresetScope(storySelectedPresetId)}
                    type="button"
                  >
                    编辑作用域
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={!storySelectedPresetId}
                    onClick={() => editImportPresetNote(storySelectedPresetId)}
                    type="button"
                  >
                    编辑备注
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={!storySelectedPresetId}
                    onClick={() => void exportImportPreset(storySelectedPresetId)}
                    type="button"
                  >
                    导出预设 JSON
                  </button>
                  <button className="btn-ghost" onClick={() => importImportPresets()} type="button">
                    导入预设 JSON
                  </button>
                </div>
                {storySelectedPreset && (
                  <small>
                    当前预设作用域：{formatImportPresetScope(storySelectedPreset.scope)}；摘要：
                    {summarizeImportPreset(storySelectedPreset)}；排序：{storySelectedPreset.pinned ? "置顶" : "普通"} / 最近使用
                  </small>
                )}
                {storySelectedPreset?.note && <small>当前预设备注：{storySelectedPreset.note}</small>}
                {(storyProvisionChoices.characters.length > 0 || storyProvisionChoices.skyboxes.length > 0) && (
                  <div className="comfy-import-override-actions">
                    {storyProvisionChoices.characters.length > 0 && (
                      <>
                        <button
                          className="btn-ghost"
                          onClick={() =>
                            applyBatchOverrides(
                              storyProvisionChoices.characters.map((item) => item.key),
                              setStoryCharacterOverrides,
                              ""
                            )
                          }
                          type="button"
                        >
                          角色全部按系统
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={() =>
                            applyBatchOverrides(
                              storyProvisionChoices.characters.map((item) => item.key),
                              setStoryCharacterOverrides,
                              "__new__"
                            )
                          }
                          type="button"
                        >
                          角色全部新建
                        </button>
                        <label>
                          角色批量复用
                          <select
                            onChange={(event) =>
                              applyBatchOverrides(
                                storyProvisionChoices.characters.map((item) => item.key),
                                setStoryCharacterOverrides,
                                event.target.value
                              )
                            }
                            value=""
                          >
                            <option value="">选择现有角色资产…</option>
                            {characterAssetOptions.map((asset) => (
                              <option key={`story_char_batch_${asset.id}`} value={asset.id}>
                                复用 · {asset.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                    {storyProvisionChoices.skyboxes.length > 0 && (
                      <>
                        <button
                          className="btn-ghost"
                          onClick={() =>
                            applyBatchOverrides(
                              storyProvisionChoices.skyboxes.map((item) => item.key),
                              setStorySkyboxOverrides,
                              ""
                            )
                          }
                          type="button"
                        >
                          天空盒全部按系统
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={() =>
                            applyBatchOverrides(
                              storyProvisionChoices.skyboxes.map((item) => item.key),
                              setStorySkyboxOverrides,
                              "__new__"
                            )
                          }
                          type="button"
                        >
                          天空盒全部新建
                        </button>
                        <label>
                          天空盒批量复用
                          <select
                            onChange={(event) =>
                              applyBatchOverrides(
                                storyProvisionChoices.skyboxes.map((item) => item.key),
                                setStorySkyboxOverrides,
                                event.target.value
                              )
                            }
                            value=""
                          >
                            <option value="">选择现有天空盒资产…</option>
                            {skyboxAssetOptions.map((asset) => (
                              <option key={`story_skybox_batch_${asset.id}`} value={asset.id}>
                                复用 · {asset.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                  </div>
                )}
                {storyProvisionChoices.characters.map((item) => (
                  <label key={`story_char_override_${item.key}`}>
                    角色映射 · {item.name}
                    <select
                      onChange={(event) =>
                        setStoryCharacterOverrides((previous) => ({
                          ...previous,
                          [item.key]: event.target.value
                        }))
                      }
                      value={storyCharacterOverrides[item.key] ?? ""}
                    >
                      <option value="">
                        {item.matchedAssetId ? `按系统判断（复用 ${item.matchedAssetName}）` : "按系统判断（将新建）"}
                      </option>
                      <option value="__new__">强制新建角色</option>
                      {characterAssetOptions.map((asset) => (
                        <option key={`story_char_option_${item.key}_${asset.id}`} value={asset.id}>
                          复用 · {asset.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                {storyProvisionChoices.skyboxes.map((item) => (
                  <label key={`story_skybox_override_${item.key}`}>
                    场景映射 · {item.name}
                    <select
                      onChange={(event) =>
                        setStorySkyboxOverrides((previous) => ({
                          ...previous,
                          [item.key]: event.target.value
                        }))
                      }
                      value={storySkyboxOverrides[item.key] ?? ""}
                    >
                      <option value="">
                        {item.matchedAssetId ? `按系统判断（复用 ${item.matchedAssetName}）` : "按系统判断（将新建天空盒）"}
                      </option>
                      <option value="__new__">强制新建天空盒</option>
                      {skyboxAssetOptions.map((asset) => (
                        <option key={`story_skybox_option_${item.key}_${asset.id}`} value={asset.id}>
                          复用 · {asset.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        <label className="comfy-script-block">
          已分镜脚本（JSON）
          <textarea
            onChange={(event) => setScriptText(event.target.value)}
            placeholder='{"shots":[{"title":"镜头1","prompt":"...","duration_sec":3}]}'
            rows={6}
            value={scriptText}
          />
        </label>
        {scriptAssetPreview && (
          <div className="comfy-import-asset-preview">
            <small>
              脚本资产预判：复用角色 {scriptAssetPreview.reusedCharacters.length} / 新建角色 {scriptAssetPreview.newCharacters.length}；
              复用天空盒 {scriptAssetPreview.reusedSkyboxes.length} / 新建天空盒 {scriptAssetPreview.newSkyboxes.length}
            </small>
            <div className="shot-tags">
              {scriptAssetPreview.reusedCharacters.map((name) => (
                <span key={`script_reuse_char_${name}`}>复用角色 · {name}</span>
              ))}
              {scriptAssetPreview.newCharacters.map((name) => (
                <span key={`script_new_char_${name}`}>新建角色 · {name}</span>
              ))}
              {scriptAssetPreview.reusedSkyboxes.map((name) => (
                <span key={`script_reuse_skybox_${name}`}>复用天空盒 · {name}</span>
              ))}
              {scriptAssetPreview.newSkyboxes.map((name) => (
                <span key={`script_new_skybox_${name}`}>新建天空盒 · {name}</span>
              ))}
            </div>
            {scriptProvisionChoices && (
              <div className="comfy-import-override-grid">
                <div className="comfy-import-override-actions">
                  <button
                    className="btn-ghost"
                    disabled={(scriptAssetPreview?.newCharacters.length ?? 0) === 0}
                    onClick={() =>
                      void onPreGenerateProvisionAssets(
                        "脚本导入",
                        scriptNormalizedItems,
                        scriptCharacterOverrides,
                        scriptSkyboxOverrides,
                        "characters"
                      )
                    }
                    type="button"
                  >
                    预生成缺失角色三视图
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={(scriptAssetPreview?.newSkyboxes.length ?? 0) === 0}
                    onClick={() =>
                      void onPreGenerateProvisionAssets(
                        "脚本导入",
                        scriptNormalizedItems,
                        scriptCharacterOverrides,
                        scriptSkyboxOverrides,
                        "skyboxes"
                      )
                    }
                    type="button"
                  >
                    预生成缺失场景天空盒
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={
                      (scriptAssetPreview?.newCharacters.length ?? 0) + (scriptAssetPreview?.newSkyboxes.length ?? 0) === 0
                    }
                    onClick={() =>
                      void onPreGenerateProvisionAssets(
                        "脚本导入",
                        scriptNormalizedItems,
                        scriptCharacterOverrides,
                        scriptSkyboxOverrides,
                        "all"
                      )
                    }
                    type="button"
                  >
                    预生成全部缺失资产
                  </button>
                </div>
                <div className="comfy-import-preset-actions">
                  <label>
                    导入预设
                    <select
                      onChange={(event) => setScriptSelectedPresetId(event.target.value)}
                      value={scriptSelectedPresetId}
                    >
                      <option value="">选择已保存预设…</option>
                      {sortedImportPresets.map((preset) => (
                        <option key={`script_import_preset_${preset.id}`} value={preset.id}>
                          {preset.pinned ? "置顶 · " : ""}{preset.name} · {formatImportPresetScope(preset.scope)} · {summarizeImportPreset(preset)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="timeline-snap-toggle">
                    <input
                      checked={autoApplyImportedPreset}
                      onChange={(event) => setAutoApplyImportedPreset(event.target.checked)}
                      type="checkbox"
                    />
                    导入 JSON 后自动应用
                  </label>
                  <button
                    className="btn-ghost"
                    disabled={!scriptSelectedPresetId}
                    onClick={() =>
                      applyImportPreset(
                        scriptSelectedPresetId,
                        scriptProvisionChoices,
                        setScriptCharacterOverrides,
                        setScriptSkyboxOverrides
                      )
                    }
                    type="button"
                  >
                    应用预设
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      const name = window.prompt("输入导入预设名称", "脚本导入预设");
                      if (!name) return;
                      const note = window.prompt("输入预设备注（可选）", scriptSelectedPreset?.note ?? "") ?? "";
                      const scopeInput =
                        window.prompt("输入预设作用域：all / characters / skyboxes", scriptSelectedPreset?.scope ?? "all") ??
                        "";
                      const scope =
                        scopeInput.trim() === "characters" || scopeInput.trim() === "skyboxes"
                          ? (scopeInput.trim() as "characters" | "skyboxes")
                          : "all";
                      const presetId = saveImportPreset(
                        name,
                        note,
                        scope,
                        scriptProvisionChoices,
                        scriptCharacterOverrides,
                        scriptSkyboxOverrides
                      );
                      if (presetId) setScriptSelectedPresetId(presetId);
                    }}
                    type="button"
                  >
                    保存当前为预设
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={!scriptSelectedPresetId}
                    onClick={() => deleteImportPreset(scriptSelectedPresetId)}
                    type="button"
                  >
                    删除预设
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={!scriptSelectedPresetId}
                    onClick={() => renameImportPreset(scriptSelectedPresetId)}
                    type="button"
                  >
                    重命名预设
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={!scriptSelectedPresetId}
                    onClick={() => {
                      const nextId = duplicateImportPreset(scriptSelectedPresetId);
                      if (nextId) setScriptSelectedPresetId(nextId);
                    }}
                    type="button"
                  >
                    复制一份
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={!scriptSelectedPresetId}
                    onClick={() => toggleImportPresetPinned(scriptSelectedPresetId)}
                    type="button"
                  >
                    {scriptSelectedPreset?.pinned ? "取消置顶" : "置顶预设"}
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={!scriptSelectedPresetId}
                    onClick={() => editImportPresetScope(scriptSelectedPresetId)}
                    type="button"
                  >
                    编辑作用域
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={!scriptSelectedPresetId}
                    onClick={() => editImportPresetNote(scriptSelectedPresetId)}
                    type="button"
                  >
                    编辑备注
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={!scriptSelectedPresetId}
                    onClick={() => void exportImportPreset(scriptSelectedPresetId)}
                    type="button"
                  >
                    导出预设 JSON
                  </button>
                  <button className="btn-ghost" onClick={() => importImportPresets()} type="button">
                    导入预设 JSON
                  </button>
                </div>
                {scriptSelectedPreset && (
                  <small>
                    当前预设作用域：{formatImportPresetScope(scriptSelectedPreset.scope)}；摘要：
                    {summarizeImportPreset(scriptSelectedPreset)}；排序：{scriptSelectedPreset.pinned ? "置顶" : "普通"} / 最近使用
                  </small>
                )}
                {scriptSelectedPreset?.note && <small>当前预设备注：{scriptSelectedPreset.note}</small>}
                {(scriptProvisionChoices.characters.length > 0 || scriptProvisionChoices.skyboxes.length > 0) && (
                  <div className="comfy-import-override-actions">
                    {scriptProvisionChoices.characters.length > 0 && (
                      <>
                        <button
                          className="btn-ghost"
                          onClick={() =>
                            applyBatchOverrides(
                              scriptProvisionChoices.characters.map((item) => item.key),
                              setScriptCharacterOverrides,
                              ""
                            )
                          }
                          type="button"
                        >
                          角色全部按系统
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={() =>
                            applyBatchOverrides(
                              scriptProvisionChoices.characters.map((item) => item.key),
                              setScriptCharacterOverrides,
                              "__new__"
                            )
                          }
                          type="button"
                        >
                          角色全部新建
                        </button>
                        <label>
                          角色批量复用
                          <select
                            onChange={(event) =>
                              applyBatchOverrides(
                                scriptProvisionChoices.characters.map((item) => item.key),
                                setScriptCharacterOverrides,
                                event.target.value
                              )
                            }
                            value=""
                          >
                            <option value="">选择现有角色资产…</option>
                            {characterAssetOptions.map((asset) => (
                              <option key={`script_char_batch_${asset.id}`} value={asset.id}>
                                复用 · {asset.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                    {scriptProvisionChoices.skyboxes.length > 0 && (
                      <>
                        <button
                          className="btn-ghost"
                          onClick={() =>
                            applyBatchOverrides(
                              scriptProvisionChoices.skyboxes.map((item) => item.key),
                              setScriptSkyboxOverrides,
                              ""
                            )
                          }
                          type="button"
                        >
                          天空盒全部按系统
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={() =>
                            applyBatchOverrides(
                              scriptProvisionChoices.skyboxes.map((item) => item.key),
                              setScriptSkyboxOverrides,
                              "__new__"
                            )
                          }
                          type="button"
                        >
                          天空盒全部新建
                        </button>
                        <label>
                          天空盒批量复用
                          <select
                            onChange={(event) =>
                              applyBatchOverrides(
                                scriptProvisionChoices.skyboxes.map((item) => item.key),
                                setScriptSkyboxOverrides,
                                event.target.value
                              )
                            }
                            value=""
                          >
                            <option value="">选择现有天空盒资产…</option>
                            {skyboxAssetOptions.map((asset) => (
                              <option key={`script_skybox_batch_${asset.id}`} value={asset.id}>
                                复用 · {asset.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                  </div>
                )}
                {scriptProvisionChoices.characters.map((item) => (
                  <label key={`script_char_override_${item.key}`}>
                    角色映射 · {item.name}
                    <select
                      onChange={(event) =>
                        setScriptCharacterOverrides((previous) => ({
                          ...previous,
                          [item.key]: event.target.value
                        }))
                      }
                      value={scriptCharacterOverrides[item.key] ?? ""}
                    >
                      <option value="">
                        {item.matchedAssetId ? `按系统判断（复用 ${item.matchedAssetName}）` : "按系统判断（将新建）"}
                      </option>
                      <option value="__new__">强制新建角色</option>
                      {characterAssetOptions.map((asset) => (
                        <option key={`script_char_option_${item.key}_${asset.id}`} value={asset.id}>
                          复用 · {asset.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                {scriptProvisionChoices.skyboxes.map((item) => (
                  <label key={`script_skybox_override_${item.key}`}>
                    场景映射 · {item.name}
                    <select
                      onChange={(event) =>
                        setScriptSkyboxOverrides((previous) => ({
                          ...previous,
                          [item.key]: event.target.value
                        }))
                      }
                      value={scriptSkyboxOverrides[item.key] ?? ""}
                    >
                      <option value="">
                        {item.matchedAssetId ? `按系统判断（复用 ${item.matchedAssetName}）` : "按系统判断（将新建天空盒）"}
                      </option>
                      <option value="__new__">强制新建天空盒</option>
                      {skyboxAssetOptions.map((asset) => (
                        <option key={`script_skybox_option_${item.key}_${asset.id}`} value={asset.id}>
                          复用 · {asset.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="comfy-primary-actions">
          <button className="btn-ghost" onClick={() => void onImportScript()} type="button">导入镜头脚本</button>
          <button className="btn-primary comfy-action-main" disabled={phase === "running" || runAllActive} onClick={() => void onGenerateAll()} type="button">
            一键生成整片
          </button>
          <label className="timeline-snap-toggle">
            <input
              checked={skipExisting}
              onChange={(event) => setSkipExisting(event.target.checked)}
              type="checkbox"
            />
            跳过已生成
          </label>
        </div>
        <details className="export-panel comfy-advanced-tools">
          <summary>高级动作（单步生成 / 重试 / 环境体检）</summary>
          <div className="timeline-actions comfy-main-actions">
            <button className="btn-ghost" disabled={phase === "running"} onClick={() => void onGenerateImages()} type="button">
              生成分镜图
            </button>
            <button className="btn-ghost" disabled={phase === "running"} onClick={() => void onGenerateVideos()} type="button">
              生成镜头视频
            </button>
            <button className="btn-ghost" disabled={phase === "running"} onClick={() => void onGenerateAudios()} type="button">
              生成镜头配音
            </button>
            <button className="btn-ghost" disabled={phase === "running"} onClick={() => void onGenerateSoundDesign()} type="button">
              生成环境/音效
            </button>
            <button className="btn-ghost" onClick={() => void onConcatVideos()} type="button">拼接整片预览</button>
            <button className="btn-ghost" disabled={phase === "running"} onClick={() => void onGenerateImages(true)} type="button">
              重试失败分镜图
            </button>
            <button className="btn-ghost" disabled={phase === "running"} onClick={() => void onGenerateVideos(true)} type="button">
              重试失败镜头视频
            </button>
            <button className="btn-ghost" disabled={phase === "running"} onClick={() => void onGenerateAudios(true)} type="button">
              重试失败镜头配音
            </button>
            <button className="btn-ghost" disabled={phase === "running"} onClick={() => void onGenerateSoundDesign(true)} type="button">
              重试失败环境/音效
            </button>
            <button className="btn-ghost" onClick={() => void onInspectWorkflows()} type="button">体检工作流依赖</button>
            <button className="btn-ghost" onClick={() => void onInstallSuggestedPlugins()} type="button">一键安装建议插件</button>
            <button className="btn-ghost" onClick={() => void onCheckModelHealth()} type="button">体检模型文件</button>
            <button className="btn-ghost" onClick={() => void onCopyModelChecklist()} type="button">复制模型下载清单</button>
          </div>
        </details>
        {previewVideoPath && (
          <div className="timeline-actions comfy-preview-actions">
            <small>{previewVideoPath}</small>
            <button
              onClick={async () => {
                const { openPathInOS } = await loadExportService();
                await openPathInOS(previewVideoPath);
              }}
              type="button"
            >
              打开预览视频
            </button>
          </div>
        )}
      </section>

      <section className="comfy-stage">
        <div className="comfy-stage-head">
          <span className="comfy-stage-index">03</span>
          <h3>运行监控</h3>
        </div>
        <div className="comfy-monitor-summary">
          <div className="comfy-summary-card">
            <small>镜头总数</small>
            <strong>{monitorSummary.totalShots}</strong>
          </div>
          <div className="comfy-summary-card">
            <small>分镜图 成功/失败</small>
            <strong>{monitorSummary.imageSuccess} / {monitorSummary.imageFailed}</strong>
          </div>
          <div className="comfy-summary-card">
            <small>视频 成功/失败</small>
            <strong>{monitorSummary.videoSuccess} / {monitorSummary.videoFailed}</strong>
          </div>
          <div className="comfy-summary-card">
            <small>配音 成功/失败</small>
            <strong>{monitorSummary.audioSuccess} / {monitorSummary.audioFailed}</strong>
          </div>
          <div className="comfy-summary-card">
            <small>错误日志</small>
            <strong>{monitorSummary.errorLogCount}</strong>
          </div>
        </div>
        <div className="comfy-monitor-grid">
          <details className="export-panel comfy-subpanel comfy-collapsible-panel">
            <summary>运行日志</summary>
            <div className="comfy-section-head">
              <h3>运行日志</h3>
            </div>
            <div className="timeline-actions comfy-log-actions">
              <button className="btn-ghost" onClick={() => void copyLogs()} type="button">复制日志</button>
              <button className="btn-ghost" onClick={() => setLogs([])} type="button">清空日志</button>
            </div>
            <div className="comfy-log-box">
              {logs.length === 0 ? (
                <div className="comfy-log-empty">暂无日志</div>
              ) : (
                logs.slice().reverse().map((item) => (
                  <div className={`comfy-log-line ${item.level === "error" ? "is-error" : ""}`} key={item.id}>
                    <code>[{item.timestamp}] [{item.level.toUpperCase()}]</code> {item.message}
                  </div>
                ))
              )}
            </div>
          </details>
          <details className="export-panel comfy-subpanel comfy-collapsible-panel">
            <summary>镜头状态（{visibleShots.length}）</summary>
            <div className="comfy-section-head">
              <h3>镜头状态</h3>
            </div>
            <div className="timeline-actions comfy-log-actions">
              <label className="timeline-snap-toggle">
                <input
                  checked={showShotEditor}
                  onChange={(event) => setShowShotEditor(event.target.checked)}
                  type="checkbox"
                />
                显示镜头参数编辑
              </label>
              <select onChange={(event) => setShotFilter(event.target.value as "all" | "failed")} value={shotFilter}>
                <option value="all">显示全部</option>
                <option value="failed">仅显示失败</option>
              </select>
            </div>
            <ul className="export-list comfy-shot-list">
            {visibleShots.map((shot) => (
              <li key={`pipeline_${shot.id}`}>
                {(() => {
                  const referencePreview = shotReferencePreviewById.get(shot.id) ?? { characters: [] };
                  return (
                    <>
                <div><strong>{shot.order}. {shot.title}</strong></div>
                <div className="comfy-shot-reference-summary">
                  参考：{describeShotReferencePreview(referencePreview)}
                </div>
                {(referencePreview.characters.length > 0 || referencePreview.scene) && (
                  <div className="comfy-shot-reference-block">
                    {referencePreview.characters.map((item) => (
                      <div className="comfy-shot-reference-group" key={`${shot.id}_${item.id}`}>
                        <small>角色参考 · {item.name}{item.views.length > 0 ? ` · ${item.views.join("/")}` : ""}</small>
                        <div className="comfy-provision-thumb-row is-shot-reference">
                          {item.thumbs.length > 0 ? (
                            item.thumbs.slice(0, 3).map((thumb, index) => (
                              <img
                                key={`${item.id}_${index}`}
                                alt={`${item.name}_${index + 1}`}
                                loading="lazy"
                                src={toDesktopMediaSource(thumb)}
                              />
                            ))
                          ) : (
                            <div className="comfy-provision-thumb-empty">未找到三视图</div>
                          )}
                        </div>
                      </div>
                    ))}
                    {referencePreview.scene && (
                      <div className="comfy-shot-reference-group" key={`${shot.id}_${referencePreview.scene.id}`}>
                        <small>
                          场景参考 · {referencePreview.scene.name}
                          {referencePreview.scene.faces.length > 0 ? ` · ${referencePreview.scene.faces.join("/")}` : ""}
                        </small>
                        <div className="comfy-provision-thumb-row is-shot-reference">
                          {referencePreview.scene.thumbs.length > 0 ? (
                            referencePreview.scene.thumbs.slice(0, 4).map((thumb, index) => (
                              <img
                                key={`${referencePreview.scene?.id}_${index}`}
                                alt={`${referencePreview.scene?.name}_${index + 1}`}
                                loading="lazy"
                                src={toDesktopMediaSource(thumb)}
                              />
                            ))
                          ) : (
                            <div className="comfy-provision-thumb-empty">未找到场景图</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <details className="comfy-shot-details">
                  <summary>镜头信息</summary>
                  <div className="comfy-shot-readonly-grid">
                    <label>
                      分镜 Prompt
                      <textarea readOnly rows={4} value={shot.storyPrompt ?? ""} />
                    </label>
                    <label>
                      备注
                      <textarea readOnly rows={3} value={shot.notes ?? ""} />
                    </label>
                    <label>
                      对白
                      <textarea readOnly rows={2} value={shot.dialogue ?? ""} />
                    </label>
                    <label>
                      绑定资产摘要
                      <textarea readOnly rows={3} value={describeShotReferencePreview(referencePreview)} />
                    </label>
                  </div>
                </details>
                <div>
                  图：{shot.generatedImagePath || "未生成"} · 状态：{formatAssetStatus(imageStatusByShot[shot.id] ?? "idle")}
                </div>
                {toDesktopMediaSource(shot.generatedImagePath) && (
                  <a
                    className="comfy-shot-preview"
                    href={toDesktopMediaSource(shot.generatedImagePath)}
                    rel="noreferrer"
                    target="_blank"
                    title="点击在新窗口查看分镜图"
                  >
                    <img alt={`${shot.title} 分镜图`} loading="lazy" src={toDesktopMediaSource(shot.generatedImagePath)} />
                  </a>
                )}
                <div>
                  视频：{shot.generatedVideoPath || "未生成"} · 状态：{formatAssetStatus(videoStatusByShot[shot.id] ?? "idle")}
                </div>
                <div>
                  配音：
                  {audioSummaryByShot[shot.id]?.count
                    ? `对白 ${audioSummaryByShot[shot.id]!.dialogueCount} 段 / 旁白 ${audioSummaryByShot[shot.id]!.narrationCount} 段`
                    : "未生成"} · 状态：{formatAssetStatus(audioStatusByShot[shot.id] ?? "idle")}
                </div>
                {lastErrorByShot[shot.id] && <small>错误：{lastErrorByShot[shot.id]}</small>}
                {showShotEditor && (
                  <details className="comfy-shot-details" open={expandedShotId === shot.id}>
                    <summary
                      onClick={() => setExpandedShotId((id) => (id === shot.id ? "" : shot.id))}
                    >
                      镜头参数
                    </summary>
                  <div className="comfy-shot-edit">
                    <label>
                      Prompt
                      <textarea
                        onChange={(event) => onUpdateShotPrompt(shot.id, event.target.value)}
                        rows={3}
                        value={shot.storyPrompt ?? ""}
                      />
                    </label>
                    <label>
                      视频 Prompt
                      <textarea
                        onChange={(event) => onUpdateShotVideoPrompt(shot.id, event.target.value)}
                        placeholder={
                          settings.videoGenerationMode === "local_motion"
                            ? "留空则沿用分镜 Prompt；运动样式用下方下拉框控制"
                            : "留空则沿用分镜 Prompt"
                        }
                        rows={3}
                        value={stripLocalMotionPresetToken(shot.videoPrompt ?? "")}
                      />
                    </label>
                    <label>
                      视频模式
                      <select
                        onChange={(event) => onUpdateShotVideoMode(shot.id, event.target.value)}
                        value={shot.videoMode ?? "auto"}
                      >
                        <option value="auto">自动判断</option>
                        <option value="single_frame">单帧图生视频</option>
                        <option value="first_last_frame">首尾帧生成视频</option>
                      </select>
                    </label>
                    <div className="field-help">{explainShotVideoMode(shot)}</div>
                    {settings.videoGenerationMode === "local_motion" && (
                      <label>
                        本地运动样式
                        <select
                          onChange={(event) =>
                            onUpdateShotLocalMotionPreset(shot.id, event.target.value)
                          }
                          value={extractLocalMotionPresetFromText(shot.videoPrompt ?? "")}
                        >
                          {LOCAL_MOTION_PRESET_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className="audio-row">
                      <label>
                        Seed
                        <input
                          onChange={(event) => onUpdateShotSeed(shot.id, event.target.value)}
                          placeholder="留空则随机"
                          type="text"
                          value={shot.seed?.toString() ?? ""}
                        />
                      </label>
                      <label>
                        时长(秒)
                        <input
                          min={0.1}
                          onChange={(event) => onUpdateShotDurationSec(shot.id, event.target.value)}
                          step={0.1}
                          type="number"
                          value={(shot.durationFrames / 24).toFixed(1)}
                        />
                      </label>
                    </div>
                    <div className="audio-row">
                      <label>
                        首帧路径
                        <input
                          onChange={(event) => onUpdateShotVideoFramePath(shot.id, "videoStartFramePath", event.target.value)}
                          placeholder="留空则用当前镜头分镜图"
                          type="text"
                          value={shot.videoStartFramePath ?? ""}
                        />
                      </label>
                      <label>
                        尾帧路径
                        <input
                          onChange={(event) => onUpdateShotVideoFramePath(shot.id, "videoEndFramePath", event.target.value)}
                          placeholder="留空则自动推断"
                          type="text"
                          value={shot.videoEndFramePath ?? ""}
                        />
                      </label>
                    </div>
                  </div>
                  </details>
                )}
                <details className="comfy-shot-details">
                  <summary>单镜头重试</summary>
                  <div className="timeline-actions">
                    <button
                      className="btn-ghost"
                      disabled={phase === "running"}
                      onClick={() => void onGenerateSingle("image", shot.id, true)}
                      type="button"
                    >
                      重生图像
                    </button>
                    <button
                      className="btn-ghost"
                      disabled={phase === "running"}
                      onClick={() => void onGenerateSingle("video", shot.id, true)}
                      type="button"
                    >
                      重生视频
                    </button>
                    <button
                      className="btn-ghost"
                      disabled={phase === "running"}
                      onClick={() => void onGenerateSingle("audio", shot.id, true)}
                      type="button"
                    >
                      重生配音
                    </button>
                  </div>
                </details>
                    </>
                  );
                })()}
              </li>
            ))}
            </ul>
          </details>
        </div>
      </section>
    </section>
  );
}
