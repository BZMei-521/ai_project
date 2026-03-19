import type { Asset, AudioTrack, Shot, SkyboxFace } from "../storyboard-core/types";
import { invokeDesktopCommand, isDesktopRuntime, toDesktopMediaSource } from "../platform/desktopBridge";
import STORYBOARD_IMAGE_FISHER_LIGHT_WORKFLOW_OBJECT from "./presets/storyboard-image-fisher-light-v1.json";

function normalizeEntityKey(value: string): string {
  return value.trim().replace(/\s+/g, "").toLowerCase();
}

function stripSceneTemporalQualifier(name: string): string {
  return name
    .replace(/^(清晨|早晨|上午|中午|下午|黄昏|傍晚|夜晚|深夜|凌晨)/g, "")
    .replace(/(清晨|早晨|上午|中午|下午|黄昏|傍晚|夜晚|深夜|凌晨)$/g, "")
    .replace(/^(白天|夜间|夜里|日间)/g, "")
    .replace(/(白天|夜间|夜里|日间)$/g, "");
}

function canonicalAssetName(type: "character" | "scene" | "skybox", name: string): string {
  let normalized = normalizeEntityKey(name);
  if (!normalized) return "";
  if (type === "character") {
    normalized = normalized.replace(/(角色|人物|主角|配角|立绘|设定|三视图|正视图|侧视图|背视图)$/g, "");
  } else {
    normalized = normalized
      .replace(/(天空盒|skybox|panorama|全景|环境图)$/g, "")
      .replace(/(场景|场景图|环境图|设定图)$/g, "");
    normalized = stripSceneTemporalQualifier(normalized);
  }
  return normalized.trim();
}

const CHARACTER_ASSET_OUTPUT_PREFIX_TEMPLATE = ".storyboard-cache/人物/{{ASSET_NAME_DIR}}";
const SCENE_ASSET_OUTPUT_PREFIX_TEMPLATE = "场景/{{ASSET_NAME_DIR}}";

type AssetOutputContext =
  | {
      kind: "character";
      assetName: string;
    }
  | {
      kind: "scene";
      assetName: string;
    };

const STORYBOARD_IMAGE_FISHER_LIGHT_WORKFLOW_JSON = JSON.stringify(STORYBOARD_IMAGE_FISHER_LIGHT_WORKFLOW_OBJECT);

export function sanitizeOutputAssetFolderName(value: string, fallback = "未命名资源"): string {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!cleaned) return fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) {
    return `${fallback}_${cleaned}`;
  }
  return cleaned;
}

function extractCharacterAssetNameFromShot(shot: Shot): string {
  const shotId = shot.id.trim();
  if (!/^(asset_char_|asset_panel_char_|import_char_anchor_)/.test(shotId)) return "";
  const fromTitle = shot.title
    .trim()
    .replace(
      /\s*(正视参考修复|参考正视图|正视锚点|正视图|三视图整板|三视图|侧视补全|背视补全|侧视|背视)\s*$/u,
      ""
    )
    .trim();
  if (fromTitle) return fromTitle;
  const fromId =
    shotId.match(/^asset_char_(.+?)_(?:fallback_.+|reference(?:_\d+)?|threeview_sheet)$/)?.[1] ??
    shotId.match(/^asset_panel_char_\d+_(.+)$/)?.[1] ??
    "";
  return fromId.trim();
}

function inferAssetOutputContextFromShot(shot: Shot): AssetOutputContext | null {
  const characterName = extractCharacterAssetNameFromShot(shot);
  if (characterName) {
    return {
      kind: "character",
      assetName: sanitizeOutputAssetFolderName(characterName, "未命名人物")
    };
  }
  return null;
}

function characterAssetReferenceScore(asset: Asset): number {
  let score = 0;
  if ((asset.characterFrontPath?.trim() || asset.filePath?.trim() || "").length > 0) score += 3;
  if ((asset.characterSidePath?.trim() || "").length > 0) score += 4;
  if ((asset.characterBackPath?.trim() || "").length > 0) score += 4;
  return score;
}

function buildCanonicalPrimaryCharacterMap(assets: Asset[]): Map<string, string> {
  const chosen = new Map<string, { id: string; score: number; index: number }>();
  assets.forEach((asset, index) => {
    if (asset.type !== "character") return;
    const canonicalKey = canonicalAssetName("character", asset.name);
    if (!canonicalKey) return;
    const nextScore = characterAssetReferenceScore(asset);
    const previous = chosen.get(canonicalKey);
    if (!previous || nextScore > previous.score || (nextScore === previous.score && index < previous.index)) {
      chosen.set(canonicalKey, { id: asset.id, score: nextScore, index });
    }
  });
  return new Map(Array.from(chosen.entries(), ([key, value]) => [key, value.id] as const));
}

function normalizeCharacterAssetRefId(
  assets: Asset[],
  canonicalCharacterMap: Map<string, string>,
  refId?: string
): string {
  const raw = refId?.trim() ?? "";
  if (!raw) return "";
  const asset = assets.find((item) => item.id === raw && item.type === "character");
  if (!asset) return "";
  const canonicalKey = canonicalAssetName("character", asset.name);
  return (canonicalKey && canonicalCharacterMap.get(canonicalKey)) || asset.id;
}

function compactTextParts(...parts: Array<string | string[] | undefined>): string {
  return parts
    .flatMap((part) => (Array.isArray(part) ? part : [part]))
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0)
    .join("\n");
}

function resolveCharacterAssetIdByName(
  assets: Asset[],
  canonicalCharacterMap: Map<string, string>,
  candidate?: string
): string {
  const raw = candidate?.trim() ?? "";
  if (!raw) return "";
  const normalizedRaw = normalizeEntityKey(raw);
  const canonicalKey = canonicalAssetName("character", raw);
  for (const asset of assets) {
    if (asset.type !== "character") continue;
    if (normalizeEntityKey(asset.name) === normalizedRaw) {
      return normalizeCharacterAssetRefId(assets, canonicalCharacterMap, asset.id);
    }
  }
  if (canonicalKey && canonicalCharacterMap.has(canonicalKey)) {
    return canonicalCharacterMap.get(canonicalKey) ?? "";
  }
  for (const asset of assets) {
    if (asset.type !== "character") continue;
    const assetCanonical = canonicalAssetName("character", asset.name);
    if (!assetCanonical) continue;
    if (
      assetCanonical === canonicalKey ||
      assetCanonical.includes(canonicalKey) ||
      canonicalKey.includes(assetCanonical)
    ) {
      return normalizeCharacterAssetRefId(assets, canonicalCharacterMap, asset.id);
    }
  }
  return "";
}

function shotLooksCharacterDrivenInComfy(shot: Shot): boolean {
  const corpus = compactTextParts(
    shot.title,
    shot.storyPrompt,
    shot.notes,
    shot.dialogue,
    shot.tags,
    shot.sourceCharacterNames
  );
  return (
    Boolean(shot.dialogue.trim()) ||
    (shot.characterRefs?.length ?? 0) > 0 ||
    (shot.sourceCharacterNames?.length ?? 0) > 0 ||
    /人物|角色|对白|对峙|挥拳|冲拳|出拳|闪避|反击|回头|看向|转身|走向|逼近|交手|fight|punch|kick|dodge|duel|face[- ]?off/i.test(
      corpus
    )
  );
}

export type ComfySettings = {
  baseUrl: string;
  outputDir: string;
  comfyInputDir: string;
  comfyRootDir: string;
  imageWorkflowJson: string;
  storyboardImageWorkflowMode?: "builtin_qwen" | "mature_asset_guided";
  storyboardImageModelName?: string;
  videoWorkflowJson: string;
  characterWorkflowJson?: string;
  skyboxWorkflowJson?: string;
  characterAssetWorkflowMode?: "advanced_multiview";
  skyboxAssetWorkflowMode?: "basic_builtin" | "advanced_panorama";
  requireDedicatedCharacterWorkflow?: boolean;
  requireDedicatedSkyboxWorkflow?: boolean;
  characterAssetModelName?: string;
  skyboxAssetModelName?: string;
  characterTemplatePreset?: "portrait" | "square";
  characterRenderPreset?: "stable_fullbody" | "clean_reference" | "strict_anchor";
  characterBackgroundPreset?: "white" | "gray" | "studio";
  skyboxTemplatePreset?: "wide" | "square";
  skyboxPromptPreset?: "day_exterior" | "night_exterior" | "interior";
  skyboxNegativePreset?: "day_exterior" | "night_exterior" | "interior";
  characterAssetNegativePrompt?: string;
  skyboxAssetNegativePrompt?: string;
  audioWorkflowJson?: string;
  soundWorkflowJson?: string;
  globalVisualStylePrompt?: string;
  globalStyleNegativePrompt?: string;
  videoGenerationMode?: "comfy" | "local_motion";
  renderWidth?: number;
  renderHeight?: number;
  renderFps?: number;
  tokenMapping: {
    prompt: string;
    nextScenePrompt: string;
    videoPrompt: string;
    videoMode: string;
    negativePrompt: string;
    seed: string;
    title: string;
    dialogue: string;
    speakerName: string;
    emotion: string;
    deliveryStyle: string;
    speechRate: string;
    voiceProfile: string;
    characterVoiceProfiles: string;
    durationFrames: string;
    durationSec: string;
    characterRefs: string;
    sceneRefPath: string;
    sceneRefName: string;
    characterRefPaths: string;
    characterRefNames: string;
    characterFrontPaths: string;
    characterSidePaths: string;
    characterBackPaths: string;
    character1Name: string;
    character1FrontPath: string;
    character1SidePath: string;
    character1BackPath: string;
    character2Name: string;
    character2FrontPath: string;
    character2SidePath: string;
    character2BackPath: string;
    character3Name: string;
    character3FrontPath: string;
    character3SidePath: string;
    character3BackPath: string;
    character4Name: string;
    character4FrontPath: string;
    character4SidePath: string;
    character4BackPath: string;
    frameImagePath: string;
    firstFramePath: string;
    lastFramePath: string;
    dialogueAudioPath: string;
    dialogueAudioPaths: string;
    dialogueAudioCount: string;
    hasDialogueAudio: string;
  };
};

export const DEFAULT_TOKEN_MAPPING: ComfySettings["tokenMapping"] = {
  prompt: "PROMPT",
  nextScenePrompt: "NEXT_SCENE_PROMPT",
  videoPrompt: "VIDEO_PROMPT",
  videoMode: "VIDEO_MODE",
  negativePrompt: "NEGATIVE_PROMPT",
  seed: "SEED",
  title: "SHOT_TITLE",
  dialogue: "DIALOGUE",
  speakerName: "SPEAKER_NAME",
  emotion: "EMOTION",
  deliveryStyle: "DELIVERY_STYLE",
  speechRate: "SPEECH_RATE",
  voiceProfile: "VOICE_PROFILE",
  characterVoiceProfiles: "CHARACTER_VOICE_PROFILES",
  durationFrames: "DURATION_FRAMES",
  durationSec: "DURATION_SEC",
  characterRefs: "CHARACTER_REFS",
  sceneRefPath: "SCENE_REF_PATH",
  sceneRefName: "SCENE_REF_NAME",
  characterRefPaths: "CHARACTER_REF_PATHS",
  characterRefNames: "CHARACTER_REF_NAMES",
  characterFrontPaths: "CHARACTER_FRONT_PATHS",
  characterSidePaths: "CHARACTER_SIDE_PATHS",
  characterBackPaths: "CHARACTER_BACK_PATHS",
  character1Name: "CHAR1_NAME",
  character1FrontPath: "CHAR1_FRONT_PATH",
  character1SidePath: "CHAR1_SIDE_PATH",
  character1BackPath: "CHAR1_BACK_PATH",
  character2Name: "CHAR2_NAME",
  character2FrontPath: "CHAR2_FRONT_PATH",
  character2SidePath: "CHAR2_SIDE_PATH",
  character2BackPath: "CHAR2_BACK_PATH",
  character3Name: "CHAR3_NAME",
  character3FrontPath: "CHAR3_FRONT_PATH",
  character3SidePath: "CHAR3_SIDE_PATH",
  character3BackPath: "CHAR3_BACK_PATH",
  character4Name: "CHAR4_NAME",
  character4FrontPath: "CHAR4_FRONT_PATH",
  character4SidePath: "CHAR4_SIDE_PATH",
  character4BackPath: "CHAR4_BACK_PATH",
  frameImagePath: "FRAME_IMAGE_PATH",
  firstFramePath: "FIRST_FRAME_PATH",
  lastFramePath: "LAST_FRAME_PATH",
  dialogueAudioPath: "DIALOGUE_AUDIO_PATH",
  dialogueAudioPaths: "DIALOGUE_AUDIO_PATHS",
  dialogueAudioCount: "DIALOGUE_AUDIO_COUNT",
  hasDialogueAudio: "HAS_DIALOGUE_AUDIO"
};

type VideoMode = "single_frame" | "first_last_frame";
export type StoryboardVideoModeChoice = VideoMode | "auto";

type ComfyOutputAsset = {
  filename: string;
  subfolder?: string;
  type?: string;
  mediaKind?: "image" | "video" | "audio";
};

type ComfyHistoryNode = {
  images?: ComfyOutputAsset[];
  gifs?: ComfyOutputAsset[];
  videos?: ComfyOutputAsset[];
  audio?: ComfyOutputAsset[];
  audios?: ComfyOutputAsset[];
};

type ComfyPromptStatusMessage = {
  type?: string;
  message?: unknown;
};

type ComfyPromptStatus = {
  completed?: boolean;
  status_str?: string;
  messages?: ComfyPromptStatusMessage[];
};

type ComfyProgressEventPayload = {
  prompt_id?: string;
  value?: number;
  max?: number;
  node?: string | null;
  queue_remaining?: number;
  exception_message?: string;
};

type ComfyProgressMessage = {
  type?: string;
  data?: ComfyProgressEventPayload;
};

type PromptProgressSnapshot = {
  progress: number;
  message: string;
};

type PromptProgressListener = (snapshot: PromptProgressSnapshot) => void;

type ConcatResult = {
  outputPath: string;
};

type FileWriteResult = {
  filePath: string;
};

type DeleteGeneratedFileFamiliesResult = {
  deletedPaths: string[];
};

type ThreeViewSplitResult = {
  frontPath: string;
  sidePath: string;
  backPath: string;
};

type LocalVideoRenderResult = {
  outputPath: string;
};

type AudioMixResult = {
  outputPath: string;
};

export type VideoWorkflowLipSyncSupport = {
  usesTokenPlaceholders: boolean;
  usesDialogueAudioPathToken: boolean;
  matchedPathTokens: string[];
  matchedAuxTokens: string[];
  candidatePathTokens: string[];
  candidateAuxTokens: string[];
};

export type LocalMotionPreset =
  | "auto"
  | "still"
  | "fade"
  | "push_in"
  | "push_out"
  | "pan_left"
  | "pan_right";

type ComfyPingResult = {
  ok: boolean;
  statusCode?: number;
  message: string;
};

type ComfyDiscoverResult = {
  found: string[];
};

type ComfyLocalDirsResult = {
  rootDir?: string;
  inputDir?: string;
  outputDir?: string;
};

export type WorkflowDependencyHint = {
  plugin: string;
  repo: string;
};

export type WorkflowDependencyReport = {
  totalNodeTypes: number;
  availableNodeTypes: number;
  missingNodeTypes: string[];
  hints: WorkflowDependencyHint[];
};

export type PluginInstallReport = {
  installed: string[];
  skipped: string[];
  failed: Array<{ repo: string; error: string }>;
};

export type ComfyModelCheckItem = {
  key: string;
  label: string;
  path: string;
  exists: boolean;
  fileCount: number;
  required: boolean;
};

export type ComfyModelHealthReport = {
  checks: ComfyModelCheckItem[];
};

export const SKYBOX_FACES: SkyboxFace[] = ["front", "right", "back", "left", "up", "down"];
const STORYBOARD_SD15_MAX_SIDE = 960;
const STORYBOARD_SDXL_MAX_SIDE = 1280;
const STORYBOARD_SD15_MIN_SIDE = 512;
const STORYBOARD_SDXL_MIN_SIDE = 640;

export type SkyboxGenerationResult = {
  faces: Partial<Record<SkyboxFace, string>>;
  previews: Partial<Record<SkyboxFace, string>>;
};

function hasDesktopInvoke(): boolean {
  return isDesktopRuntime();
}

async function invokeDesktop<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasDesktopInvoke()) {
    throw new Error("未检测到桌面运行环境。请使用 Tauri 桌面版或 Windows Web 启动脚本。");
  }
  return invokeDesktopCommand<T>(cmd, args);
}

export async function deleteGeneratedFileFamilies(sourcePaths: string[], excludePaths: string[] = []) {
  if (!hasDesktopInvoke()) {
    return { deletedPaths: [] };
  }
  const normalizedSourcePaths = sourcePaths
    .map((value) => String(value || "").trim())
    .filter((value): value is string => Boolean(value));
  if (normalizedSourcePaths.length <= 0) {
    return { deletedPaths: [] };
  }
  const normalizedExcludePaths = excludePaths
    .map((value) => String(value || "").trim())
    .filter((value): value is string => Boolean(value));
  return invokeDesktop<DeleteGeneratedFileFamiliesResult>("delete_generated_file_families", {
    sourcePaths: normalizedSourcePaths,
    excludePaths: normalizedExcludePaths
  });
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : "http://127.0.0.1:8188";
}

function looksLikeSdxlCheckpoint(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  if (/sd[_-]?xl/.test(normalized)) return true;
  if (/animagine[-_]?xl/.test(normalized)) return true;
  if (/juggernautxl/.test(normalized)) return true;
  return /(?:^|[^a-z0-9])xl(?:[^a-z0-9]|$)/.test(normalized);
}

function looksLikeFluxOrSd3Model(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  return /flux|sd3|sd[_ -]?3\.?5|stable[_ -]?diffusion[_ -]?3|xlabs/.test(normalized);
}

function looksLikeControlNetLoRA(name: string): boolean {
  const normalized = basenameModelChoice(name);
  if (!normalized) return false;
  return /control[-_]?lora|rank\d+/.test(normalized);
}

function looksLikeSdxlControlNet(name: string): boolean {
  const normalized = basenameModelChoice(name);
  if (!normalized) return false;
  if (looksLikeFluxOrSd3Model(normalized)) return false;
  return /sd[_-]?xl|openposexl\d*|posexl\d*|cannyxl\d*|depthxl\d*|scribblexl\d*|(?:^|[^a-z0-9])xl\d*(?:[^a-z0-9]|$)|xinsir|mistoline|union|thibaud.*xl|kohya.*xl/.test(normalized);
}

function looksLikeSd15ControlNet(name: string): boolean {
  const normalized = basenameModelChoice(name);
  if (!normalized) return false;
  if (looksLikeFluxOrSd3Model(normalized) || looksLikeSdxlControlNet(normalized)) return false;
  return /sd15|control[_-]?v11|(?:^|[^a-z0-9])v11(?:[^a-z0-9]|$)|11p|11f1|t2i[_-]?adapter/.test(normalized);
}

function preferControlNetOption(
  options: string[],
  matchers: Array<(value: string) => boolean>
): string | null {
  for (const matcher of matchers) {
    const matched = options.find((value) => matcher(value));
    if (matched) return matched;
  }
  return null;
}

function resolveStoryboardControlNetChoice(
  storyboardModel: string,
  usePoseGuide: boolean,
  objectInfo?: Record<string, unknown>
): {
  controlNetName: string | null;
  checkpointOverride: string | null;
  qualityError: string | null;
} {
  const requestedTask = usePoseGuide ? /openpose/i : /canny/i;
  const requestedTaskLabel = usePoseGuide ? "OpenPose" : "Canny";
  const preferredDefault = usePoseGuide ? "control_v11p_sd15_openpose.pth" : "control_v11p_sd15_canny.pth";
  const isSdxl = looksLikeSdxlCheckpoint(storyboardModel);
  const options =
    objectInfo && typeof objectInfo === "object"
      ? extractComboOptionsFromObjectInfo(objectInfo, "ControlNetLoader", "control_net_name")
      : [];
  const taskOptions = options.filter((value) => requestedTask.test(value));

  if (taskOptions.length === 0) {
    return {
      controlNetName: preferredDefault,
      checkpointOverride: isSdxl ? "realisticVisionV60B1_v51VAE.safetensors" : null,
      qualityError:
        isSdxl && objectInfo
          ? `当前分镜基模“${storyboardModel}”属于 SDXL，但 ComfyUI 未检测到任何可用的 ${requestedTaskLabel} ControlNet。为保证最终质量，请先下载 SDXL 版 ${requestedTaskLabel} ControlNet；文件名建议包含 “${usePoseGuide ? "openpose" : "canny"}” 和 “sdxl/xl” 或 “xinsir”。`
          : null
    };
  }

  if (isSdxl) {
    const sdxlChoice = preferControlNetOption(taskOptions, [
      (value) => looksLikeSdxlControlNet(value) && !looksLikeControlNetLoRA(value) && /\.safetensors$/i.test(value),
      (value) => looksLikeSdxlControlNet(value) && !looksLikeControlNetLoRA(value),
      (value) => looksLikeSdxlControlNet(value) && /\.safetensors$/i.test(value),
      (value) => looksLikeSdxlControlNet(value)
    ]);
    if (sdxlChoice) {
      return { controlNetName: sdxlChoice, checkpointOverride: null, qualityError: null };
    }
    const sd15Fallback = preferControlNetOption(taskOptions, [
      (value) => looksLikeSd15ControlNet(value) && /\.safetensors$/i.test(value),
      (value) => looksLikeSd15ControlNet(value),
      () => true
    ]);
    return {
      controlNetName: sd15Fallback,
      checkpointOverride: "realisticVisionV60B1_v51VAE.safetensors",
      qualityError: objectInfo
        ? `当前分镜基模“${storyboardModel}”属于 SDXL，但当前 ComfyUI 里只有 SD1.5 系的 ${requestedTaskLabel} ControlNet（例如：${taskOptions.slice(0, 3).join(" / ")}）。这会导致你刚才看到的维度报错或被迫降级到低质量兜底。要保住 SDXL 质量，请下载 SDXL 版 ${requestedTaskLabel} ControlNet；文件名建议包含 “${usePoseGuide ? "openpose" : "canny"}” 和 “sdxl/xl” 或 “xinsir”。`
        : null
    };
  }

  const sd15Choice = preferControlNetOption(taskOptions, [
    (value) => looksLikeSd15ControlNet(value) && /\.safetensors$/i.test(value),
    (value) => looksLikeSd15ControlNet(value),
    (value) => !looksLikeSdxlControlNet(value) && !looksLikeFluxOrSd3Model(value),
    () => true
  ]);
  return {
    controlNetName: sd15Choice,
    checkpointOverride: null,
    qualityError: null
  };
}

function snapRenderSize(value: number): number {
  const clamped = Math.max(320, Math.round(value));
  return Math.max(320, Math.round(clamped / 64) * 64);
}

function normalizeStoryboardStillRenderSize(
  settings: ComfySettings,
  width: number,
  height: number
): { width: number; height: number } {
  const storyboardMode = settings.storyboardImageWorkflowMode ?? "mature_asset_guided";
  if (storyboardMode !== "mature_asset_guided") {
    return { width: snapRenderSize(width), height: snapRenderSize(height) };
  }
  const modelName = resolveStoryboardImageModel(settings);
  const isSdxl = looksLikeSdxlCheckpoint(modelName);
  const maxSide = isSdxl ? STORYBOARD_SDXL_MAX_SIDE : STORYBOARD_SD15_MAX_SIDE;
  const minSide = isSdxl ? STORYBOARD_SDXL_MIN_SIDE : STORYBOARD_SD15_MIN_SIDE;

  let outWidth = Math.max(320, Math.round(width));
  let outHeight = Math.max(320, Math.round(height));

  const downScale = Math.min(1, maxSide / Math.max(outWidth, outHeight));
  outWidth = Math.round(outWidth * downScale);
  outHeight = Math.round(outHeight * downScale);

  if (Math.min(outWidth, outHeight) < minSide) {
    const upScale = minSide / Math.max(1, Math.min(outWidth, outHeight));
    outWidth = Math.round(outWidth * upScale);
    outHeight = Math.round(outHeight * upScale);
  }

  const finalScale = Math.min(1, maxSide / Math.max(outWidth, outHeight));
  outWidth = snapRenderSize(outWidth * finalScale);
  outHeight = snapRenderSize(outHeight * finalScale);
  return { width: outWidth, height: outHeight };
}

function resolveStoryboardImageModel(
  settings: ComfySettings,
  hasCharacterRefs = false
): string {
  const storyboardMode = settings.storyboardImageWorkflowMode ?? "mature_asset_guided";
  const storyboardModel = settings.storyboardImageModelName?.trim() || "";
  const characterModel = settings.characterAssetModelName?.trim() || "";
  const hasExplicitStoryboardModel =
    storyboardModel.length > 0 && storyboardModel.toLowerCase() !== "sd_xl_base_1.0.safetensors";
  if (hasExplicitStoryboardModel) return storyboardModel;
  if (hasCharacterRefs && characterModel) return characterModel;
  if (storyboardMode === "mature_asset_guided" && hasCharacterRefs) {
    return "realisticVisionV60B1_v51VAE.safetensors";
  }
  if (storyboardModel) return storyboardModel;
  if (characterModel) return characterModel;
  return "realisticVisionV60B1_v51VAE.safetensors";
}

export function defaultVideoGenerationMode(): "comfy" | "local_motion" {
  if (typeof navigator !== "undefined" && /mac/i.test(navigator.platform)) {
    return "local_motion";
  }
  return "comfy";
}

let comfyWsClientId = `storyboard-pro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let comfyWsBaseUrl = "";
let comfyWs: WebSocket | null = null;
let comfyWsActivePromptId = "";
const promptProgressById = new Map<string, PromptProgressSnapshot>();
const promptProgressListeners = new Map<string, Set<PromptProgressListener>>();

function toComfyWsUrl(baseUrl: string, clientId: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  const wsBase = normalized.startsWith("https://")
    ? `wss://${normalized.slice("https://".length)}`
    : `ws://${normalized.slice("http://".length)}`;
  return `${wsBase}/ws?clientId=${encodeURIComponent(clientId)}`;
}

function emitPromptProgress(promptId: string, progress: number, message: string) {
  const safePromptId = promptId.trim();
  if (!safePromptId) return;
  const safeProgress = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const snapshot: PromptProgressSnapshot = {
    progress: safeProgress,
    message: message.trim() || "执行中"
  };
  promptProgressById.set(safePromptId, snapshot);
  const listeners = promptProgressListeners.get(safePromptId);
  if (!listeners || listeners.size === 0) return;
  for (const listener of listeners) listener(snapshot);
}

function subscribePromptProgress(promptId: string, listener: PromptProgressListener): () => void {
  const safePromptId = promptId.trim();
  if (!safePromptId) return () => undefined;
  const set = promptProgressListeners.get(safePromptId) ?? new Set<PromptProgressListener>();
  set.add(listener);
  promptProgressListeners.set(safePromptId, set);
  const snapshot = promptProgressById.get(safePromptId);
  if (snapshot) listener(snapshot);
  return () => {
    const current = promptProgressListeners.get(safePromptId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) promptProgressListeners.delete(safePromptId);
  };
}

function ensureComfyProgressSocket(baseUrl: string) {
  if (typeof window === "undefined" || typeof WebSocket === "undefined") return;
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const shouldReuse =
    comfyWs &&
    comfyWsBaseUrl === normalizedBaseUrl &&
    (comfyWs.readyState === WebSocket.OPEN || comfyWs.readyState === WebSocket.CONNECTING);
  if (shouldReuse) return;

  if (comfyWs) {
    try {
      comfyWs.close();
    } catch {
      // ignore close errors
    }
    comfyWs = null;
  }

  const ws = new WebSocket(toComfyWsUrl(normalizedBaseUrl, comfyWsClientId));
  comfyWsBaseUrl = normalizedBaseUrl;
  ws.onmessage = (event) => {
    let payload: ComfyProgressMessage | null = null;
    try {
      payload = JSON.parse(String(event.data)) as ComfyProgressMessage;
    } catch {
      return;
    }
    if (!payload || typeof payload !== "object") return;
    const type = String(payload.type ?? "");
    const data = payload.data ?? {};
    const promptIdRaw = String(data.prompt_id ?? "").trim();
    if (promptIdRaw) {
      comfyWsActivePromptId = promptIdRaw;
    }
    const promptId = promptIdRaw || comfyWsActivePromptId;
    if (!promptId) return;

    if (type === "execution_start") {
      emitPromptProgress(promptId, 0.05, "任务已入队");
      return;
    }
    if (type === "executing") {
      if (data.node) {
        emitPromptProgress(promptId, 0.12, `执行节点 ${String(data.node)}`);
      } else {
        emitPromptProgress(promptId, 0.95, "执行完成，等待输出文件");
      }
      return;
    }
    if (type === "progress") {
      const value = Number(data.value);
      const max = Number(data.max);
      if (Number.isFinite(value) && Number.isFinite(max) && max > 0) {
        const ratio = Math.max(0, Math.min(1, value / max));
        emitPromptProgress(promptId, 0.12 + ratio * 0.82, `采样进度 ${Math.round(value)}/${Math.round(max)}`);
      }
      return;
    }
    if (type === "execution_cached") {
      emitPromptProgress(promptId, 0.3, "复用缓存节点");
      return;
    }
    if (type === "execution_success") {
      emitPromptProgress(promptId, 0.97, "执行成功，正在收集输出");
      return;
    }
    if (type === "execution_error") {
      const message = String(data.exception_message ?? "").trim();
      emitPromptProgress(promptId, 1, message ? `执行失败：${message}` : "执行失败");
      return;
    }
    if (type === "status") {
      const remaining = Number(data.queue_remaining);
      if (Number.isFinite(remaining)) {
        emitPromptProgress(promptId, 0.08, `队列剩余 ${Math.max(0, Math.round(remaining))}`);
      }
    }
  };
  ws.onclose = () => {
    if (comfyWs === ws) comfyWs = null;
  };
  ws.onerror = () => {
    // WS is best-effort; polling fallback is still used.
  };
  comfyWs = ws;
}

function inferComfyInputDir(settings: ComfySettings): string {
  const explicit = settings.comfyInputDir.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const root = settings.comfyRootDir.trim().replace(/\/+$/, "");
  if (root) return `${root}/input`;
  const output = settings.outputDir.trim().replace(/\/+$/, "");
  if (!output) return "";
  const index = output.lastIndexOf("/");
  if (index <= 0) return "";
  return `${output.slice(0, index)}/input`;
}

function normalizeWorkflowJsonText(raw: string): string {
  return raw.replace(/^\uFEFF/, "").trim();
}

function stripMarkdownJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() || trimmed;
}

function extractJsonObjectBody(raw: string): string {
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1).trim();
  }
  return raw;
}

function parseWorkflowJsonWithRecovery(raw: string): unknown {
  const attempts: string[] = [];
  const pushAttempt = (value: string) => {
    const next = value.trim();
    if (!next) return;
    if (!attempts.includes(next)) attempts.push(next);
  };

  const normalized = normalizeWorkflowJsonText(raw);
  if (!normalized) {
    throw new Error("工作流内容为空");
  }
  const withoutFence = stripMarkdownJsonFence(normalized);
  const extractedBody = extractJsonObjectBody(withoutFence);

  pushAttempt(normalized);
  pushAttempt(withoutFence);
  pushAttempt(extractedBody);

  let lastError: unknown = null;
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("未知 JSON 解析错误");
}

function applyTokenAliases(
  mapping: ComfySettings["tokenMapping"],
  baseTokens: Record<string, string>
): Record<string, string> {
  const mappedTokens: Record<string, string> = { ...baseTokens };
  const aliasPairs: Array<[keyof ComfySettings["tokenMapping"], string]> = [
    ["prompt", baseTokens.PROMPT],
    ["nextScenePrompt", baseTokens.NEXT_SCENE_PROMPT],
    ["videoPrompt", baseTokens.VIDEO_PROMPT],
    ["videoMode", baseTokens.VIDEO_MODE],
    ["negativePrompt", baseTokens.NEGATIVE_PROMPT],
    ["seed", baseTokens.SEED],
    ["title", baseTokens.SHOT_TITLE],
    ["dialogue", baseTokens.DIALOGUE],
    ["speakerName", baseTokens.SPEAKER_NAME],
    ["emotion", baseTokens.EMOTION],
    ["deliveryStyle", baseTokens.DELIVERY_STYLE],
    ["speechRate", baseTokens.SPEECH_RATE],
    ["voiceProfile", baseTokens.VOICE_PROFILE],
    ["characterVoiceProfiles", baseTokens.CHARACTER_VOICE_PROFILES],
    ["durationFrames", baseTokens.DURATION_FRAMES],
    ["durationSec", baseTokens.DURATION_SEC],
    ["characterRefs", baseTokens.CHARACTER_REFS],
    ["sceneRefPath", baseTokens.SCENE_REF_PATH],
    ["sceneRefName", baseTokens.SCENE_REF_NAME],
    ["characterRefPaths", baseTokens.CHARACTER_REF_PATHS],
    ["characterRefNames", baseTokens.CHARACTER_REF_NAMES],
    ["characterFrontPaths", baseTokens.CHARACTER_FRONT_PATHS],
    ["characterSidePaths", baseTokens.CHARACTER_SIDE_PATHS],
    ["characterBackPaths", baseTokens.CHARACTER_BACK_PATHS],
    ["character1Name", baseTokens.CHAR1_NAME],
    ["character1FrontPath", baseTokens.CHAR1_FRONT_PATH],
    ["character1SidePath", baseTokens.CHAR1_SIDE_PATH],
    ["character1BackPath", baseTokens.CHAR1_BACK_PATH],
    ["character2Name", baseTokens.CHAR2_NAME],
    ["character2FrontPath", baseTokens.CHAR2_FRONT_PATH],
    ["character2SidePath", baseTokens.CHAR2_SIDE_PATH],
    ["character2BackPath", baseTokens.CHAR2_BACK_PATH],
    ["character3Name", baseTokens.CHAR3_NAME],
    ["character3FrontPath", baseTokens.CHAR3_FRONT_PATH],
    ["character3SidePath", baseTokens.CHAR3_SIDE_PATH],
    ["character3BackPath", baseTokens.CHAR3_BACK_PATH],
    ["character4Name", baseTokens.CHAR4_NAME],
    ["character4FrontPath", baseTokens.CHAR4_FRONT_PATH],
    ["character4SidePath", baseTokens.CHAR4_SIDE_PATH],
    ["character4BackPath", baseTokens.CHAR4_BACK_PATH],
    ["frameImagePath", baseTokens.FRAME_IMAGE_PATH],
    ["firstFramePath", baseTokens.FIRST_FRAME_PATH],
    ["lastFramePath", baseTokens.LAST_FRAME_PATH],
    ["dialogueAudioPath", baseTokens.DIALOGUE_AUDIO_PATH],
    ["dialogueAudioPaths", baseTokens.DIALOGUE_AUDIO_PATHS],
    ["dialogueAudioCount", baseTokens.DIALOGUE_AUDIO_COUNT],
    ["hasDialogueAudio", baseTokens.HAS_DIALOGUE_AUDIO]
  ];
  for (const [key, value] of aliasPairs) {
    const alias = mapping[key]?.trim();
    if (!alias) continue;
    mappedTokens[alias] = value;
  }
  return mappedTokens;
}

export function inferComfyRootDir(settings: ComfySettings): string {
  const explicit = settings.comfyRootDir.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const output = settings.outputDir.trim().replace(/\/+$/, "");
  if (output.endsWith("/output")) return output.slice(0, -"/output".length);
  const input = settings.comfyInputDir.trim().replace(/\/+$/, "");
  if (input.endsWith("/input")) return input.slice(0, -"/input".length);
  return "";
}

function ensureWorkflowJson(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseWorkflowJsonWithRecovery(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`工作流 JSON 解析失败：${message}。请重新导入完整的 ComfyUI API 工作流 JSON 文件`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("工作流 JSON 必须是对象");
  }
  return parsed as Record<string, unknown>;
}

export function validateWorkflowJsonSyntax(workflowJson: string): void {
  void ensureWorkflowJson(workflowJson);
}

function collectTemplateTokens(value: unknown, bucket: Set<string>) {
  if (typeof value === "string") {
    const matches = value.matchAll(/\{\{([A-Z0-9_]+)\}\}/g);
    for (const match of matches) {
      const token = match[1]?.trim();
      if (token) bucket.add(token);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTemplateTokens(item, bucket);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectTemplateTokens(item, bucket);
    }
  }
}

function configuredTokenOrFallback(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? "";
  return trimmed || fallback;
}

function dialogueAudioPathTokens(mapping: ComfySettings["tokenMapping"]): string[] {
  return [
    configuredTokenOrFallback(mapping.dialogueAudioPath, "DIALOGUE_AUDIO_PATH"),
    configuredTokenOrFallback(mapping.dialogueAudioPaths, "DIALOGUE_AUDIO_PATHS")
  ];
}

function dialogueAudioAuxTokens(mapping: ComfySettings["tokenMapping"]): string[] {
  return [
    configuredTokenOrFallback(mapping.dialogueAudioCount, "DIALOGUE_AUDIO_COUNT"),
    configuredTokenOrFallback(mapping.hasDialogueAudio, "HAS_DIALOGUE_AUDIO")
  ];
}

function inspectWorkflowLipSyncSupportFromObject(
  workflow: Record<string, unknown>,
  mapping: ComfySettings["tokenMapping"]
): VideoWorkflowLipSyncSupport {
  const usedTokens = new Set<string>();
  collectTemplateTokens(workflow, usedTokens);
  const candidatePathTokens = dialogueAudioPathTokens(mapping);
  const candidateAuxTokens = dialogueAudioAuxTokens(mapping);
  const matchedPathTokens = candidatePathTokens.filter((token) => usedTokens.has(token));
  const matchedAuxTokens = candidateAuxTokens.filter((token) => usedTokens.has(token));
  return {
    usesTokenPlaceholders: usedTokens.size > 0,
    usesDialogueAudioPathToken: matchedPathTokens.length > 0,
    matchedPathTokens,
    matchedAuxTokens,
    candidatePathTokens,
    candidateAuxTokens
  };
}

function deepReplaceTokens(value: unknown, tokens: Record<string, string>): unknown {
  if (typeof value === "string") {
    let next = value;
    for (const [key, tokenValue] of Object.entries(tokens)) {
      next = next.split(`{{${key}}}`).join(tokenValue);
    }
    return next;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepReplaceTokens(item, tokens));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      deepReplaceTokens(item, tokens)
    ]);
    return Object.fromEntries(entries);
  }
  return value;
}

function rewriteWorkflowFilenamePrefixes(
  value: unknown,
  rewrite: (prefix: string) => string
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteWorkflowFilenamePrefixes(item, rewrite));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (key === "filename_prefix" && typeof item === "string") {
        return [key, rewrite(item)] as const;
      }
      return [key, rewriteWorkflowFilenamePrefixes(item, rewrite)] as const;
    });
    return Object.fromEntries(entries);
  }
  return value;
}

function rewriteCharacterAssetFilenamePrefix(prefix: string): string {
  const trimmed = prefix.trim();
  if (!trimmed) return prefix;
  if (trimmed.startsWith(".storyboard-cache/人物/")) return trimmed;
  if (trimmed.startsWith("人物/")) {
    return trimmed.replace(/^人物\//, ".storyboard-cache/人物/");
  }
  if (/character_anchor_cleanup/i.test(trimmed)) {
    return `${CHARACTER_ASSET_OUTPUT_PREFIX_TEMPLATE}/character_anchor_cleanup_{{SHOT_ID}}`;
  }
  if (/character_anchor|character_threeview/i.test(trimmed)) {
    return `${CHARACTER_ASSET_OUTPUT_PREFIX_TEMPLATE}/character_anchor_{{SHOT_ID}}`;
  }
  if (/character_orthoview|character_mv/i.test(trimmed)) {
    return `${CHARACTER_ASSET_OUTPUT_PREFIX_TEMPLATE}/character_orthoview_{{SHOT_ID}}`;
  }
  return prefix;
}

function rewriteSkyboxFilenamePrefix(prefix: string): string {
  const trimmed = prefix.trim();
  if (!trimmed) return prefix;
  if (trimmed.startsWith("场景/")) return trimmed;
  if (/skybox_panorama/i.test(trimmed)) {
    return `${SCENE_ASSET_OUTPUT_PREFIX_TEMPLATE}/skybox_panorama`;
  }
  const face = trimmed.match(/skybox_(front|right|back|left|up|down)/i)?.[1]?.toLowerCase();
  if (face) {
    return `${SCENE_ASSET_OUTPUT_PREFIX_TEMPLATE}/skybox_${face}`;
  }
  if (/skybox/i.test(trimmed)) {
    return `${SCENE_ASSET_OUTPUT_PREFIX_TEMPLATE}/skybox_{{SHOT_ID}}`;
  }
  return prefix;
}

function isComfyNodeReferenceTuple(value: unknown): value is [string, unknown] {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [nodeId, outputIndex] = value;
  if (typeof nodeId !== "string" || !/^\d+$/.test(nodeId.trim())) return false;
  if (typeof outputIndex === "number") return Number.isFinite(outputIndex);
  return typeof outputIndex === "string" && /^-?\d+$/.test(outputIndex.trim());
}

function coerceWorkflowLiteralValues(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (/^-?\d+$/.test(trimmed)) {
      const parsed = Number.parseInt(trimmed, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
    if (/^-?(?:\d+\.\d+|\d+e[+-]?\d+|\d+\.\d+e[+-]?\d+)$/i.test(trimmed)) {
      const parsed = Number.parseFloat(trimmed);
      if (Number.isFinite(parsed)) return parsed;
    }
    return value;
  }
  if (Array.isArray(value)) {
    // Preserve Comfy node-link tuples like ["6", 0].
    // If the first item is coerced to number, Comfy prompt validation may fail with KeyError
    // because node IDs in prompt objects are string keys.
    if (
      value.length === 2 &&
      typeof value[0] === "string" &&
      /^\d+$/.test(value[0].trim()) &&
      (typeof value[1] === "number" || (typeof value[1] === "string" && /^-?\d+$/.test(value[1].trim())))
    ) {
      const slot = coerceWorkflowLiteralValues(value[1]);
      return [value[0], slot];
    }
    if (isComfyNodeReferenceTuple(value)) {
      return [value[0], coerceWorkflowLiteralValues(value[1])];
    }
    return value.map((item) => coerceWorkflowLiteralValues(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, coerceWorkflowLiteralValues(item)])
    );
  }
  return value;
}

function normalizeLineBreaks(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function normalizePromptBody(value: string): string {
  return normalizeLineBreaks(value)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function appendPromptSection(base: string, sectionTitle: string, sectionBody: string): string {
  const content = normalizePromptBody(base);
  const addition = normalizePromptBody(sectionBody);
  if (!addition) return content;
  return [content, `${sectionTitle}：${addition}`].filter((item) => item.length > 0).join("\n");
}

function appendNegativePrompt(base: string, extra: string): string {
  const primary = normalizePromptBody(base);
  const addition = normalizePromptBody(extra).replace(/\n/g, ", ");
  if (!addition) return primary;
  if (!primary) return addition;
  return `${primary}, ${addition}`;
}

function stableNumericId(value: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return Math.max(1, hash % 1_000_000_000);
}

function sanitizeStoryboardNegativePrompt(base: string, hasCharacters: boolean): string {
  const normalized = normalizePromptBody(base);
  if (!normalized || !hasCharacters) return normalized;
  const blocked = [
    /empty\s*scene/i,
    /scenery\s*only/i,
    /landscape\s*only/i,
    /character\s*missing/i,
    /\bno\s+people\b/i,
    /\bno\s+person\b/i,
    /\bno\s+human\b/i,
    /\bwithout\s+people\b/i,
    /\bwithout\s+person\b/i,
    /空镜/,
    /无人/,
    /无人物/,
    /无角色/,
    /纯场景/,
    /仅场景/,
    /只有场景/
  ];
  const parts = normalized
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const filtered = parts.filter((item) => !blocked.some((pattern) => pattern.test(item)));
  return filtered.join(", ");
}

function sanitizeCharacterDrivenNegativePrompt(base: string, hasCharacters: boolean): string {
  if (!hasCharacters) return normalizePromptBody(base);
  return sanitizeStoryboardNegativePrompt(base, true);
}

function toNextScenePrompt(value: string): string {
  const compact = normalizePromptBody(value);
  if (!compact) return "Next Scene: empty shot";
  const segments = compact
    .split(/\bNext\s*Scene\b[:：]?\s*/gi)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const shotText = segments[0] ?? compact;
  return `Next Scene: ${shotText}`;
}

function containsAnyKeyword(raw: string, keywords: string[]): boolean {
  const text = raw.toLowerCase();
  return keywords.some((item) => text.includes(item));
}

const LOCAL_MOTION_TOKEN_PATTERN = /\[motion:(auto|still|fade|push_in|push_out|pan_left|pan_right)\]/i;
const FIRST_LAST_ENDPOINT_PATTERNS = [
  /从.+到/,
  /由.+到/,
  /先.+后/,
  /逐渐/,
  /慢慢/,
  /最终/,
  /直到/,
  /一步步/,
  /镜头.+来到/,
  /画面.+转到/
];
const FIRST_LAST_ACTION_KEYWORDS = [
  "转场",
  "衔接",
  "过渡",
  "transition",
  "走向",
  "走到",
  "走进",
  "走出",
  "跑向",
  "跑到",
  "进入",
  "离开",
  "穿过",
  "经过",
  "越过",
  "跨过",
  "靠近",
  "远离",
  "起身",
  "站起",
  "坐下",
  "跪下",
  "转身",
  "回头",
  "俯身",
  "抬头",
  "低头",
  "伸手",
  "抬手",
  "落手",
  "拿起",
  "放下",
  "放回",
  "推门",
  "开门",
  "关门",
  "拉开",
  "推开",
  "登上",
  "下楼",
  "上楼",
  "绕过",
  "穿越",
  "reveals",
  "reveal",
  "blocking"
];
const SINGLE_FRAME_DIALOGUE_KEYWORDS = [
  "对白",
  "说话",
  "开口",
  "台词",
  "反应",
  "注视",
  "凝视",
  "沉默",
  "停顿",
  "愣住",
  "特写",
  "近景",
  "中近景",
  "肖像",
  "半身"
];
const SINGLE_FRAME_AMBIENCE_KEYWORDS = [
  "轻微",
  "微微",
  "呼吸感",
  "镜头稳定",
  "镜头固定",
  "静止",
  "静帧",
  "风吹",
  "水波",
  "烟雾",
  "火焰",
  "树叶",
  "衣摆轻晃",
  "环境氛围",
  "空镜",
  "插入镜头",
  "道具特写",
  "产品特写"
];

export function extractLocalMotionPresetFromText(raw: string): LocalMotionPreset {
  const matched = LOCAL_MOTION_TOKEN_PATTERN.exec(raw.trim());
  const value = matched?.[1]?.toLowerCase() ?? "";
  if (
    value === "still" ||
    value === "fade" ||
    value === "push_in" ||
    value === "push_out" ||
    value === "pan_left" ||
    value === "pan_right"
  ) {
    return value;
  }
  return "auto";
}

export function stripLocalMotionPresetToken(raw: string): string {
  return raw.replace(LOCAL_MOTION_TOKEN_PATTERN, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function inferStoryboardVideoModeByMatureCase(
  text: string,
  dialogue = "",
  options?: { preferAutoWhenAmbiguous?: boolean }
): StoryboardVideoModeChoice {
  const corpus = `${text} ${dialogue}`.trim();
  if (!corpus) return options?.preferAutoWhenAmbiguous ? "auto" : "single_frame";

  if (FIRST_LAST_ENDPOINT_PATTERNS.some((pattern) => pattern.test(corpus))) {
    return "first_last_frame";
  }
  if (containsAnyKeyword(corpus, FIRST_LAST_ACTION_KEYWORDS)) {
    return "first_last_frame";
  }

  if (dialogue.trim()) return "single_frame";
  if (containsAnyKeyword(corpus, SINGLE_FRAME_DIALOGUE_KEYWORDS)) {
    return "single_frame";
  }
  if (containsAnyKeyword(corpus, SINGLE_FRAME_AMBIENCE_KEYWORDS)) {
    return "single_frame";
  }

  return options?.preferAutoWhenAmbiguous ? "auto" : "single_frame";
}

export function explainStoryboardVideoModeByMatureCase(
  text: string,
  dialogue = "",
  options?: { preferAutoWhenAmbiguous?: boolean }
): { mode: StoryboardVideoModeChoice; reason: string } {
  const corpus = `${text} ${dialogue}`.trim();
  if (!corpus) {
    return {
      mode: options?.preferAutoWhenAmbiguous ? "auto" : "single_frame",
      reason: options?.preferAutoWhenAmbiguous
        ? "文案信息不足，保留自动判断。"
        : "文案信息不足，默认按稳定单帧镜头处理。"
    };
  }

  const matchedEndpoint = FIRST_LAST_ENDPOINT_PATTERNS.find((pattern) => pattern.test(corpus));
  if (matchedEndpoint) {
    return {
      mode: "first_last_frame",
      reason: "检测到明确的起点到终点变化，这类镜头更适合首尾帧控制。"
    };
  }

  const matchedFirstLastKeyword = FIRST_LAST_ACTION_KEYWORDS.find((keyword) => containsAnyKeyword(corpus, [keyword]));
  if (matchedFirstLastKeyword) {
    return {
      mode: "first_last_frame",
      reason: `检测到动作或位移关键词“${matchedFirstLastKeyword}”，更像有明确终点状态的镜头，适合首尾帧。`
    };
  }

  if (dialogue.trim()) {
    return {
      mode: "single_frame",
      reason: "检测到对白镜头，成熟做法通常优先稳定人物和构图，用单帧图生视频更稳。"
    };
  }

  const matchedDialogueKeyword = SINGLE_FRAME_DIALOGUE_KEYWORDS.find((keyword) => containsAnyKeyword(corpus, [keyword]));
  if (matchedDialogueKeyword) {
    return {
      mode: "single_frame",
      reason: `检测到“${matchedDialogueKeyword}”这类反应/特写镜头，通常以稳定表演为主，适合单帧图生视频。`
    };
  }

  const matchedAmbienceKeyword = SINGLE_FRAME_AMBIENCE_KEYWORDS.find((keyword) => containsAnyKeyword(corpus, [keyword]));
  if (matchedAmbienceKeyword) {
    return {
      mode: "single_frame",
      reason: `检测到“${matchedAmbienceKeyword}”这类轻动作或氛围镜头，通常不需要显式终点，适合单帧图生视频。`
    };
  }

  return {
    mode: options?.preferAutoWhenAmbiguous ? "auto" : "single_frame",
    reason: options?.preferAutoWhenAmbiguous
      ? "没有命中明确规则，先保留自动判断。"
      : "没有命中明确规则，默认按稳定单帧镜头处理。"
  };
}

function applyGlobalStyleToTokens(
  settings: ComfySettings,
  tokens: Record<string, string>,
  kind: "image" | "video" | "audio",
  scope: "storyboard" | "character_asset" | "scene_asset" = "storyboard"
): Record<string, string> {
  const visualStyle = normalizePromptBody(settings.globalVisualStylePrompt ?? "");
  const styleNegative = normalizePromptBody(settings.globalStyleNegativePrompt ?? "");
  if (!visualStyle && !styleNegative) return tokens;

  const next = { ...tokens };
  const shouldInjectVisualStyle = scope !== "character_asset";
  const shouldInjectStyleNegative = scope !== "character_asset";
  if (visualStyle) {
    if (kind === "image" && shouldInjectVisualStyle) {
      next.PROMPT = appendPromptSection(next.PROMPT ?? "", "全局视觉风格锚点", visualStyle);
      next.NEXT_SCENE_PROMPT = appendPromptSection(next.NEXT_SCENE_PROMPT ?? "", "全局视觉风格锚点", visualStyle);
    }
    if (kind === "video" && shouldInjectVisualStyle) {
      next.VIDEO_PROMPT = appendPromptSection(next.VIDEO_PROMPT ?? "", "全局视觉风格锚点", visualStyle);
    }
    if (shouldInjectVisualStyle) {
      next.GLOBAL_VISUAL_STYLE = visualStyle;
    }
  }
  if (styleNegative && kind !== "audio" && shouldInjectStyleNegative) {
    next.NEGATIVE_PROMPT = appendNegativePrompt(next.NEGATIVE_PROMPT ?? "", styleNegative);
    next.GLOBAL_STYLE_NEGATIVE = styleNegative;
  }
  if (kind !== "audio") {
    const hasCharacterRefs = splitCsv(next.CHARACTER_REF_NAMES ?? "").length > 0;
    next.NEGATIVE_PROMPT = sanitizeCharacterDrivenNegativePrompt(next.NEGATIVE_PROMPT ?? "", hasCharacterRefs);
  }
  return next;
}

function parseComfyViewPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  if (!trimmed.includes("/view?")) return trimmed;
  try {
    const url = new URL(trimmed);
    const filename = url.searchParams.get("filename")?.trim() ?? "";
    const subfolder = url.searchParams.get("subfolder")?.trim() ?? "";
    if (!filename) return trimmed;
    const cleanSubfolder = subfolder.replace(/^\/+|\/+$/g, "");
    return cleanSubfolder ? `${cleanSubfolder}/${filename}` : filename;
  } catch {
    return trimmed;
  }
}

function toComfyViewDownloadUrl(source: string, fallbackBaseUrl: string): string {
  const trimmed = source.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  const filename = parseComfyViewPath(trimmed);
  if (!filename) return "";
  const params = new URLSearchParams();
  params.set("filename", filename.split("/").pop() ?? filename);
  if (filename.includes("/")) {
    params.set("subfolder", filename.slice(0, filename.lastIndexOf("/")));
  } else {
    params.set("subfolder", "");
  }
  params.set("type", "output");
  return `${normalizeBaseUrl(fallbackBaseUrl)}/view?${params.toString()}`;
}

function fileExtensionFromSource(source: string): string {
  const clean = source.split("?")[0].trim();
  const idx = clean.lastIndexOf(".");
  if (idx < 0) return "png";
  const ext = clean.slice(idx + 1).toLowerCase();
  if (!/^[a-z0-9]{1,6}$/.test(ext)) return "png";
  return ext;
}

function isAbsoluteLocalPath(path: string): boolean {
  if (path.startsWith("/")) return true;
  if (path.startsWith("~/")) return true;
  return /^[a-zA-Z]:[\\/]/.test(path);
}

function isWindowsStyleAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path.trim());
}

function runtimeUsesWindowsPaths(): boolean {
  if (typeof navigator === "undefined") return false;
  const fingerprint = `${navigator.userAgent ?? ""} ${navigator.platform ?? ""}`.toLowerCase();
  return fingerprint.includes("win");
}

function canUseAbsoluteLocalPath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed || !isAbsoluteLocalPath(trimmed)) return false;
  if (isWindowsStyleAbsolutePath(trimmed)) return runtimeUsesWindowsPaths();
  return !runtimeUsesWindowsPaths();
}

function normalizeComparablePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/, "");
}

function inferComfyOutputDownloadSource(source: string, outputDir = ""): string {
  const normalized = parseComfyViewPath(source).trim();
  if (!normalized) return "";
  if (!isAbsoluteLocalPath(normalized)) return normalized;

  const normalizedSource = normalizeComparablePath(normalized);
  const normalizedOutput = normalizeComparablePath(outputDir);
  if (normalizedOutput) {
    const sourceLower = normalizedSource.toLowerCase();
    const outputLower = normalizedOutput.toLowerCase();
    const prefix = `${outputLower}/`;
    if (sourceLower.startsWith(prefix)) {
      return normalizedSource.slice(normalizedOutput.length + 1);
    }
  }

  return normalizedSource.split("/").pop() ?? "";
}

async function stageSourceFileToComfyInput(
  source: string,
  targetPath: string,
  baseUrl: string,
  outputDir = ""
): Promise<string> {
  const trimmed = source.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.includes("/view?")) {
    const url = toComfyViewDownloadUrl(trimmed, baseUrl);
    const base64 = await invokeDesktop<string>("comfy_fetch_view_base64", { url });
    const result = await invokeDesktop<FileWriteResult>("write_base64_file", {
      filePath: targetPath,
      base64Data: base64
    });
    return result.filePath;
  }
  let downloadError: unknown = null;
  const downloadSource = inferComfyOutputDownloadSource(trimmed, outputDir);
  // For values like "Batch_00003_.png" or remote absolute output paths, fetch via /view first.
  if (downloadSource && !canUseAbsoluteLocalPath(trimmed)) {
    const viewUrl = toComfyViewDownloadUrl(downloadSource, baseUrl);
    if (viewUrl) {
      try {
        const base64 = await invokeDesktop<string>("comfy_fetch_view_base64", { url: viewUrl });
        const result = await invokeDesktop<FileWriteResult>("write_base64_file", {
          filePath: targetPath,
          base64Data: base64
        });
        return result.filePath;
      } catch (error) {
        downloadError = error;
      }
    }
  }
  try {
    const copied = await invokeDesktop<FileWriteResult>("copy_file_to", {
      sourcePath: trimmed,
      targetPath
    });
    return copied.filePath;
  } catch (copyError) {
    if (downloadError) {
      throw new Error(`准备输入文件失败：下载 Comfy 输出失败(${String(downloadError)})，本地复制也失败(${String(copyError)})`);
    }
    throw copyError;
  }
}

async function stageVideoFrameTokens(
  settings: ComfySettings,
  shot: Shot,
  tokens: Record<string, string>
): Promise<Record<string, string>> {
  const inputDir = inferComfyInputDir(settings);
  if (!inputDir) return tokens;

  const safeShotId = shot.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const firstSource = tokens.FIRST_FRAME_PATH || tokens.FRAME_IMAGE_PATH;
  const lastSource = tokens.LAST_FRAME_PATH || firstSource;
  const frameSource = tokens.FRAME_IMAGE_PATH || firstSource;
  if (!firstSource && !lastSource && !frameSource) {
    throw new Error(`镜头 ${shot.title} 缺少可用分镜图，无法自动喂给 ComfyUI 视频工作流`);
  }
  const firstExt = fileExtensionFromSource(firstSource || frameSource || "png");
  const lastExt = fileExtensionFromSource(lastSource || frameSource || "png");
  const frameExt = fileExtensionFromSource(frameSource || firstSource || "png");

  const firstTargetAbs = `${inputDir}/shot_${safeShotId}_first.${firstExt}`;
  const lastTargetAbs = `${inputDir}/shot_${safeShotId}_last.${lastExt}`;
  const frameTargetAbs = `${inputDir}/shot_${safeShotId}_frame.${frameExt}`;

  const [firstWritten, lastWritten, frameWritten] = await Promise.all([
    stageSourceFileToComfyInput(firstSource, firstTargetAbs, settings.baseUrl, settings.outputDir),
    stageSourceFileToComfyInput(lastSource, lastTargetAbs, settings.baseUrl, settings.outputDir),
    stageSourceFileToComfyInput(frameSource, frameTargetAbs, settings.baseUrl, settings.outputDir)
  ]);

  const firstName = firstWritten.split("/").pop() ?? `shot_${safeShotId}_first.${firstExt}`;
  const lastName = lastWritten.split("/").pop() ?? `shot_${safeShotId}_last.${lastExt}`;
  const frameName = frameWritten.split("/").pop() ?? `shot_${safeShotId}_frame.${frameExt}`;

  return {
    ...tokens,
    FIRST_FRAME_PATH: firstName,
    LAST_FRAME_PATH: lastName,
    FRAME_IMAGE_PATH: frameName
  };
}

async function stageImageFrameToken(
  settings: ComfySettings,
  shot: Shot,
  tokens: Record<string, string>
): Promise<Record<string, string>> {
  const source = (tokens.FRAME_IMAGE_PATH || "").trim();
  if (!source) return tokens;

  const inputDir = inferComfyInputDir(settings);
  if (!inputDir) {
    throw new Error("图片工作流需要参考图输入，但未检测到 ComfyUI input 目录");
  }

  const safeShotId = shot.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const ext = fileExtensionFromSource(source || "png");
  const targetAbs = `${inputDir}/shot_${safeShotId}_frame.${ext}`;
  const written = await stageSourceFileToComfyInput(source, targetAbs, settings.baseUrl, settings.outputDir);
  return {
    ...tokens,
    FRAME_IMAGE_PATH: written.split("/").pop() ?? written
  };
}

const IMAGE_REFERENCE_TOKEN_KEYS = [
  "SCENE_REF_PATH",
  "PREV_SCENE_IMAGE_PATH",
  "PREV_CHARACTER_IMAGE_PATH",
  "CHAR1_FRONT_PATH",
  "CHAR1_SIDE_PATH",
  "CHAR1_BACK_PATH",
  "CHAR2_FRONT_PATH",
  "CHAR2_SIDE_PATH",
  "CHAR2_BACK_PATH",
  "CHAR3_FRONT_PATH",
  "CHAR3_SIDE_PATH",
  "CHAR3_BACK_PATH",
  "CHAR4_FRONT_PATH",
  "CHAR4_SIDE_PATH",
  "CHAR4_BACK_PATH",
  "CHAR1_PRIMARY_PATH",
  "CHAR1_SECONDARY_PATH",
  "CHAR2_PRIMARY_PATH",
  "CHAR2_SECONDARY_PATH"
] as const;

async function stageImageReferenceTokens(
  settings: ComfySettings,
  shot: Shot,
  tokens: Record<string, string>
): Promise<Record<string, string>> {
  const stagedEntries = IMAGE_REFERENCE_TOKEN_KEYS
    .map((key) => ({ key, source: tokens[key]?.trim() ?? "" }))
    .filter((item) => item.source.length > 0);
  if (stagedEntries.length === 0) return tokens;

  const inputDir = inferComfyInputDir(settings);
  if (!inputDir) {
    throw new Error("图片工作流需要角色/场景参考图输入，但未检测到 ComfyUI input 目录");
  }

  const safeShotId = shot.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const nextTokens = { ...tokens };
  for (const entry of stagedEntries) {
    const ext = "png";
    const targetAbs = `${inputDir}/shot_${safeShotId}_${entry.key.toLowerCase()}.${ext}`;
    const mode = entry.key === "SCENE_REF_PATH" || entry.key === "PREV_SCENE_IMAGE_PATH" ? "scene" : "character";
    const written = await stagePreparedReferenceImage(settings, entry.source, targetAbs, mode);
    nextTokens[entry.key] = written.split("/").pop() ?? written;
  }
  return nextTokens;
}

async function mixDialogueAudioTracks(
  fps: number,
  tracks: AudioTrack[]
): Promise<string> {
  const orderedTracks = [...tracks]
    .filter((track) => track.filePath.trim().length > 0)
    .sort((left, right) => left.startFrame - right.startFrame || left.id.localeCompare(right.id));
  if (orderedTracks.length === 0) return "";
  if (orderedTracks.length === 1) return orderedTracks[0]!.filePath.trim();
  const result = await invokeDesktop<AudioMixResult>("mix_audio_tracks", {
    fps: Math.max(1, Math.round(fps || 24)),
    audioTracks: orderedTracks
  });
  return result.outputPath.trim();
}

async function stageDialogueAudioTokens(
  settings: ComfySettings,
  shot: Shot,
  tokens: Record<string, string>,
  dialogueAudioTracks: AudioTrack[],
  fps: number
): Promise<Record<string, string>> {
  const validTracks = [...dialogueAudioTracks]
    .filter((track) => track.filePath.trim().length > 0)
    .sort((left, right) => left.startFrame - right.startFrame || left.id.localeCompare(right.id));
  if (validTracks.length === 0) {
    return {
      ...tokens,
      DIALOGUE_AUDIO_PATH: "",
      DIALOGUE_AUDIO_PATHS: "",
      DIALOGUE_AUDIO_COUNT: "0",
      HAS_DIALOGUE_AUDIO: "0"
    };
  }

  const mixedSourcePath = await mixDialogueAudioTracks(fps, validTracks);
  const segmentSourcePaths = validTracks.map((track) => track.filePath.trim()).filter((value) => value.length > 0);
  const inputDir = inferComfyInputDir(settings);
  if (!inputDir) {
    return {
      ...tokens,
      DIALOGUE_AUDIO_PATH: mixedSourcePath,
      DIALOGUE_AUDIO_PATHS: segmentSourcePaths.join(","),
      DIALOGUE_AUDIO_COUNT: String(segmentSourcePaths.length),
      HAS_DIALOGUE_AUDIO: "1"
    };
  }

  const safeShotId = shot.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const mixedExt = fileExtensionFromSource(mixedSourcePath || "wav");
  const mixedTargetAbs = `${inputDir}/shot_${safeShotId}_dialogue.${mixedExt}`;
  const mixedWritten = await stageSourceFileToComfyInput(
    mixedSourcePath,
    mixedTargetAbs,
    settings.baseUrl,
    settings.outputDir
  );

  const stagedSegments = await Promise.all(
    segmentSourcePaths.map(async (source, index) => {
      const ext = fileExtensionFromSource(source || "wav");
      const targetAbs = `${inputDir}/shot_${safeShotId}_dialogue_${index + 1}.${ext}`;
      const written = await stageSourceFileToComfyInput(source, targetAbs, settings.baseUrl, settings.outputDir);
      return written.split("/").pop() ?? written;
    })
  );

  return {
    ...tokens,
    DIALOGUE_AUDIO_PATH: mixedWritten.split("/").pop() ?? mixedWritten,
    DIALOGUE_AUDIO_PATHS: stagedSegments.join(","),
    DIALOGUE_AUDIO_COUNT: String(stagedSegments.length),
    HAS_DIALOGUE_AUDIO: "1"
  };
}

function inferVideoMode(shot: Shot, nextShot?: Shot): VideoMode {
  if (shot.videoMode === "single_frame") return "single_frame";
  if (shot.videoMode === "first_last_frame") return "first_last_frame";
  if (shot.videoStartFramePath?.trim() && shot.videoEndFramePath?.trim()) {
    return "first_last_frame";
  }
  const corpus = [
    shot.storyPrompt ?? "",
    shot.videoPrompt ?? "",
    shot.dialogue ?? "",
    shot.notes ?? "",
    ...(shot.tags ?? [])
  ].join(" ");
  if (containsAnyKeyword(corpus, ["首尾帧", "首尾", "first_last", "first last", "起始帧", "结束帧"])) {
    return "first_last_frame";
  }
  if (containsAnyKeyword(corpus, ["单帧", "single frame", "图生视频"])) {
    return "single_frame";
  }
  const inferred = inferStoryboardVideoModeByMatureCase(corpus, shot.dialogue ?? "", {
    preferAutoWhenAmbiguous: false
  });
  if (inferred === "first_last_frame" || inferred === "single_frame") {
    return inferred;
  }
  if (shot.generatedImagePath?.trim() && nextShot?.generatedImagePath?.trim()) {
    if (containsAnyKeyword(corpus, ["转场", "衔接", "过渡", "transition"])) {
      return "first_last_frame";
    }
  }
  return "single_frame";
}

function inferLocalMotionPreset(
  shot: Shot,
  mode: VideoMode,
  nextShot?: Shot
): Exclude<LocalMotionPreset, "auto"> {
  const explicit = extractLocalMotionPresetFromText(shot.videoPrompt ?? "");
  if (explicit !== "auto") return explicit;
  const corpus = [
    shot.videoPrompt ?? "",
    shot.storyPrompt ?? "",
    shot.notes ?? "",
    ...(shot.tags ?? [])
  ]
    .join(" ")
    .toLowerCase();

  if (containsAnyKeyword(corpus, ["静止", "静帧", "still"])) return "still";
  if (containsAnyKeyword(corpus, ["淡入淡出", "淡变", "fade"])) return "fade";
  if (containsAnyKeyword(corpus, ["推近", "推进", "zoom in", "push in"])) return "push_in";
  if (containsAnyKeyword(corpus, ["拉远", "zoom out", "push out"])) return "push_out";
  if (containsAnyKeyword(corpus, ["左移", "向左平移", "pan left"])) return "pan_left";
  if (containsAnyKeyword(corpus, ["右移", "向右平移", "pan right"])) return "pan_right";

  if (mode === "first_last_frame") return "fade";
  if (shot.generatedImagePath?.trim() && nextShot?.generatedImagePath?.trim()) return "fade";
  return "push_in";
}

function inferSkyboxFaceFromShot(shot: Shot): SkyboxFace {
  if (
    shot.skyboxFace === "front" ||
    shot.skyboxFace === "right" ||
    shot.skyboxFace === "back" ||
    shot.skyboxFace === "left" ||
    shot.skyboxFace === "up" ||
    shot.skyboxFace === "down"
  ) {
    return shot.skyboxFace;
  }
  const cameraPitch = typeof shot.cameraPitch === "number" && Number.isFinite(shot.cameraPitch) ? shot.cameraPitch : undefined;
  if (cameraPitch !== undefined) {
    if (cameraPitch >= 55) return "up";
    if (cameraPitch <= -55) return "down";
  }
  const cameraYawRaw = typeof shot.cameraYaw === "number" && Number.isFinite(shot.cameraYaw) ? shot.cameraYaw : undefined;
  if (cameraYawRaw !== undefined) {
    let yaw = cameraYawRaw % 360;
    if (yaw > 180) yaw -= 360;
    if (yaw <= -180) yaw += 360;
    if (yaw >= -45 && yaw < 45) return "front";
    if (yaw >= 45 && yaw < 135) return "right";
    if (yaw >= 135 || yaw < -135) return "back";
    return "left";
  }
  const corpus = [
    shot.title ?? "",
    shot.storyPrompt ?? "",
    shot.videoPrompt ?? "",
    shot.notes ?? "",
    ...(shot.tags ?? [])
  ]
    .join(" ")
    .toLowerCase();
  if (containsAnyKeyword(corpus, ["右侧", "右边", "right"])) return "right";
  if (containsAnyKeyword(corpus, ["左侧", "左边", "left"])) return "left";
  if (containsAnyKeyword(corpus, ["后方", "背面", "后面", "rear", "back"])) return "back";
  if (containsAnyKeyword(corpus, ["俯视", "高角度", "top", "overhead", "bird"])) return "up";
  if (containsAnyKeyword(corpus, ["仰视", "低角度", "bottom", "low angle"])) return "down";
  return "front";
}

function autoSkyboxAdjacentFaces(face: SkyboxFace): SkyboxFace[] {
  if (face === "front") return ["left", "right"];
  if (face === "back") return ["left", "right"];
  if (face === "left") return ["front", "back"];
  if (face === "right") return ["front", "back"];
  if (face === "up" || face === "down") return ["front"];
  return [];
}

function inferAutoSkyboxProfile(shot: Shot): { faces: SkyboxFace[]; weights: Partial<Record<SkyboxFace, number>> } {
  const primary = inferSkyboxFaceFromShot(shot);
  const cameraYaw = typeof shot.cameraYaw === "number" && Number.isFinite(shot.cameraYaw) ? shot.cameraYaw : undefined;
  const cameraPitch = typeof shot.cameraPitch === "number" && Number.isFinite(shot.cameraPitch) ? shot.cameraPitch : undefined;
  const cameraFov = typeof shot.cameraFov === "number" && Number.isFinite(shot.cameraFov) ? shot.cameraFov : undefined;
  const hasCameraPose = cameraYaw !== undefined || cameraPitch !== undefined || cameraFov !== undefined;
  const corpus = [
    shot.title ?? "",
    shot.storyPrompt ?? "",
    shot.videoPrompt ?? "",
    shot.notes ?? "",
    ...(shot.tags ?? [])
  ]
    .join(" ")
    .toLowerCase();

  const isCloseShot = containsAnyKeyword(corpus, ["特写", "近景", "中近景", "表情", "反应", "肖像", "半身"]);
  const isWideSpatialShot = containsAnyKeyword(corpus, [
    "全景",
    "大全景",
    "建立",
    "建立镜头",
    "广角",
    "空间",
    "环境",
    "室内",
    "走廊",
    "门厅",
    "房间",
    "客厅",
    "卧室",
    "街道",
    "河边",
    "桥上",
    "庭院",
    "仓库",
    "车内",
    "天台"
  ]);
  const isDiagonalShot = containsAnyKeyword(corpus, ["斜侧", "斜角", "45度", "对角", "偏角度", "过肩", "肩后"]);
  const favorsLeft = containsAnyKeyword(corpus, ["左侧", "左边", "偏左", "向左"]);
  const favorsRight = containsAnyKeyword(corpus, ["右侧", "右边", "偏右", "向右"]);

  const faces: SkyboxFace[] = [primary];
  const weights: Partial<Record<SkyboxFace, number>> = { [primary]: 1 };

  if (hasCameraPose) {
    return { faces, weights };
  }

  if (isCloseShot) {
    return { faces, weights };
  }

  const pushFace = (face: SkyboxFace, weight: number) => {
    if (!faces.includes(face)) faces.push(face);
    weights[face] = Math.max(weights[face] ?? 0, weight);
  };

  if (primary === "up" || primary === "down") {
    pushFace("front", 0.6);
    return { faces, weights };
  }

  if (isWideSpatialShot) {
    for (const face of autoSkyboxAdjacentFaces(primary)) {
      pushFace(face, 0.72);
    }
  } else if (isDiagonalShot) {
    if (favorsLeft) {
      pushFace("left", primary === "left" ? 0.82 : 0.62);
    } else if (favorsRight) {
      pushFace("right", primary === "right" ? 0.82 : 0.62);
    } else {
      const fallback = primary === "left" || primary === "back" ? "front" : "right";
      pushFace(fallback, 0.58);
    }
  } else if (favorsLeft && primary !== "left") {
    pushFace("left", 0.52);
  } else if (favorsRight && primary !== "right") {
    pushFace("right", 0.52);
  }

  return { faces, weights };
}

export function inferSkyboxReferencePlan(shot: Shot): {
  primaryFace: SkyboxFace;
  faces: SkyboxFace[];
  weights: Partial<Record<SkyboxFace, number>>;
  manualFaces: boolean;
  manualWeights: boolean;
} {
  const primaryFace = inferSkyboxFaceFromShot(shot);
  const autoProfile = inferAutoSkyboxProfile(shot);
  const manualFaces = Array.isArray(shot.skyboxFaces) && shot.skyboxFaces.length > 0;
  const manualWeights = Boolean(
    shot.skyboxFaceWeights &&
      Object.values(shot.skyboxFaceWeights).some((value) => typeof value === "number" && Number.isFinite(value))
  );
  const faces = manualFaces ? inferSkyboxFacesFromShot(shot) : autoProfile.faces;
  const weights: Partial<Record<SkyboxFace, number>> = {};
  for (const face of faces) {
    weights[face] = manualWeights
      ? skyboxFaceWeight(shot, face)
      : autoProfile.weights[face] ?? skyboxFaceWeight(shot, face);
  }
  return {
    primaryFace,
    faces,
    weights,
    manualFaces,
    manualWeights
  };
}

function inferSkyboxFacesFromShot(shot: Shot): SkyboxFace[] {
  const manual = (shot.skyboxFaces ?? []).filter(
    (face): face is SkyboxFace =>
      face === "front" ||
      face === "right" ||
      face === "back" ||
      face === "left" ||
      face === "up" ||
      face === "down"
  );
  if (manual.length > 0) return uniquePreserveOrder(manual) as SkyboxFace[];
  return inferAutoSkyboxProfile(shot).faces;
}

function skyboxFaceWeight(shot: Shot, face: SkyboxFace): number {
  const raw = shot.skyboxFaceWeights?.[face];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return inferAutoSkyboxProfile(shot).weights[face] ?? 1;
  }
  return Math.max(0, Math.min(1, raw));
}

function toVideoPrompt(shot: Shot, mode: VideoMode): string {
  const raw = shot.videoPrompt?.trim() || shot.storyPrompt?.trim() || shot.notes?.trim() || shot.title;
  const compact = normalizePromptBody(raw);
  const speakingDirective = shot.dialogue.trim()
    ? "画面中若出现正在说话的角色，口型开合应与对白节奏一致，避免闭口说话、乱张嘴或延迟口型。"
    : "";
  if (mode === "first_last_frame") {
    return ["首尾帧运镜，保持角色与场景连续，平滑过渡。", speakingDirective, compact]
      .filter((item) => item.length > 0)
      .join("");
  }
  return ["单帧图生视频，保持主体稳定并增加自然镜头运动。", speakingDirective, compact]
    .filter((item) => item.length > 0)
    .join("");
}

type WorkflowNode = {
  id?: number;
  type?: string;
  pos?: [number, number];
  order?: number;
  mode?: number;
  size?: [number, number];
  flags?: Record<string, unknown>;
  inputs?: Array<{ name?: string; type?: string; link?: number | null }>;
  outputs?: Array<{ name?: string; type?: string; links?: number[] | null }>;
  widgets_values?: unknown;
};

type WeightedImageRef = {
  source: string;
  weight: number;
  priority: number;
  bucket: string;
  label: string;
  role:
    | "scene_primary"
    | "scene_secondary"
    | "character_front"
    | "character_side"
    | "character_back"
    | "continuity_scene"
    | "continuity_character";
};

type CharacterReferenceView = "front" | "side" | "back";

type ShotContinuityPlan = {
  previousSceneShot?: Shot;
  previousCharacterShot?: Shot;
};

function nodeWidgetList(node: WorkflowNode): unknown[] | null {
  return Array.isArray(node.widgets_values) ? node.widgets_values : null;
}

function setNodeWidgetValue(node: WorkflowNode | undefined, index: number, value: string | number | boolean) {
  if (!node) return;
  const widgets = nodeWidgetList(node);
  if (!widgets || index < 0 || index >= widgets.length) return;
  widgets[index] = value;
}

function setNodeWidgetNamedValue(
  node: WorkflowNode | undefined,
  name: string,
  value: string | number | boolean
) {
  if (!node || !node.widgets_values || typeof node.widgets_values !== "object" || Array.isArray(node.widgets_values)) {
    return;
  }
  (node.widgets_values as Record<string, unknown>)[name] = value;
}

function setNodeEnabled(node: WorkflowNode | undefined, enabled: boolean) {
  if (!node) return;
  node.mode = enabled ? 0 : 4;
}

const FISHER_IMAGE_NODE_IDS = new Set([7, 8, 10, 13, 21, 49, 89, 123, 216]);
const FISHER_FIRST_LAST_VIDEO_NODE_IDS = new Set([
  126, 127, 128, 133, 134, 136, 137, 138, 139, 140, 141, 142, 144, 145, 146, 147, 148, 149,
  150, 151, 152, 153, 154, 155, 156, 157, 160, 161, 162, 164
]);
const FISHER_SINGLE_FRAME_VIDEO_NODE_IDS = new Set([
  175, 176, 177, 178, 179, 180, 182, 183, 184, 185, 186, 187, 192, 193, 194, 195, 196, 197,
  198, 201, 202, 203, 204, 205, 206, 207, 208
]);

function looksLikeFisherWorkflow(byId: Map<number, WorkflowNode>): boolean {
  return byId.has(21) && byId.has(49) && byId.has(89) && byId.has(160) && byId.has(197);
}

function bypassFisherSageAttentionNodes(
  workflow: Record<string, unknown>,
  byId: Map<number, WorkflowNode>,
  kind: "image" | "video" | "audio",
  tokens: Record<string, string>
) {
  if (!looksLikeFisherWorkflow(byId) || kind !== "video") return;
  const isFirstLast = tokens.VIDEO_MODE === "FIRST_LAST_FRAME";
  const rewires = isFirstLast
    ? [
        { sourceId: 152, patchId: 133, torchPatchId: 149, samplerTargetId: 155, samplerInput: 1 },
        { sourceId: 153, patchId: 134, torchPatchId: 154, samplerTargetId: 155, samplerInput: 0 }
      ]
    : [
        { sourceId: 203, patchId: 177, torchPatchId: 179, samplerTargetId: 196, samplerInput: 0 },
        { sourceId: 204, patchId: 178, torchPatchId: 180, samplerTargetId: 196, samplerInput: 1 }
      ];

  for (const item of rewires) {
    removeIncomingLinks(workflow, item.patchId, [0]);
    removeOutgoingLinks(workflow, item.patchId, 0);
    removeIncomingLinks(workflow, item.torchPatchId, [0]);
    removeOutgoingLinks(workflow, item.torchPatchId, 0);
    removeIncomingLinks(workflow, item.samplerTargetId, [item.samplerInput]);
    ensureWorkflowLink(workflow, item.sourceId, 0, item.samplerTargetId, item.samplerInput, "MODEL");
    deleteWorkflowNode(workflow, item.patchId);
    deleteWorkflowNode(workflow, item.torchPatchId);
  }
}

function bypassFisherSimpleMathNode(
  workflow: Record<string, unknown>,
  byId: Map<number, WorkflowNode>,
  kind: "image" | "video" | "audio",
  tokens: Record<string, string>
) {
  if (!looksLikeFisherWorkflow(byId) || kind !== "video") return;
  if (tokens.VIDEO_MODE === "FIRST_LAST_FRAME") return;

  const frameCount = Number(tokens.DURATION_FRAMES);
  const safeFrameCount = Number.isFinite(frameCount) ? Math.max(1, Math.round(frameCount)) : undefined;
  if (safeFrameCount === undefined) return;

  removeIncomingLinks(workflow, 187, [0, 1, 2, 3]);
  removeOutgoingLinks(workflow, 187, 0);
  removeOutgoingLinks(workflow, 187, 1);
  removeIncomingLinks(workflow, 197, [7]);
  ensureWorkflowLink(workflow, 201, 0, 197, 7, "INT");
  deleteWorkflowNode(workflow, 187);
}

function bypassFisherRifeNodes(
  workflow: Record<string, unknown>,
  byId: Map<number, WorkflowNode>,
  kind: "image" | "video" | "audio"
) {
  if (!looksLikeFisherWorkflow(byId) || kind !== "video") return;

  removeIncomingLinks(workflow, 148, [0]);
  ensureWorkflowLink(workflow, 141, 0, 148, 0, "IMAGE");
  deleteWorkflowNode(workflow, 142);

  removeIncomingLinks(workflow, 195, [0]);
  ensureWorkflowLink(workflow, 192, 0, 195, 0, "IMAGE");
  deleteWorkflowNode(workflow, 194);
}

function disableFisherImageStyleLoras(
  workflow: Record<string, unknown>,
  byId: Map<number, WorkflowNode>,
  kind: "image" | "video" | "audio"
) {
  if (!looksLikeFisherWorkflow(byId) || kind !== "image") return;
  const loader = byId.get(216);
  if (!loader) return;

  if (Array.isArray(loader.widgets_values)) {
    for (const item of loader.widgets_values) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      if ("on" in item) {
        (item as Record<string, unknown>).on = false;
      }
      if ("strength" in item) {
        (item as Record<string, unknown>).strength = 0;
      }
      if ("strengthTwo" in item) {
        (item as Record<string, unknown>).strengthTwo = 0;
      }
    }
  }

  removeIncomingLinks(workflow, 10, [0]);
  ensureWorkflowLink(workflow, 49, 0, 10, 0, "MODEL");
  deleteWorkflowNode(workflow, 216);
}

function applyFisherWorkflowModes(
  byId: Map<number, WorkflowNode>,
  kind: "image" | "video" | "audio",
  tokens: Record<string, string>
) {
  if (!looksLikeFisherWorkflow(byId)) return;
  if (kind === "audio") return;
  if (kind === "image") {
    for (const id of FISHER_IMAGE_NODE_IDS) setNodeEnabled(byId.get(id), true);
    for (const id of FISHER_FIRST_LAST_VIDEO_NODE_IDS) setNodeEnabled(byId.get(id), false);
    for (const id of FISHER_SINGLE_FRAME_VIDEO_NODE_IDS) setNodeEnabled(byId.get(id), false);
    return;
  }

  const isFirstLast = tokens.VIDEO_MODE === "FIRST_LAST_FRAME";
  const activeVideoIds = isFirstLast ? FISHER_FIRST_LAST_VIDEO_NODE_IDS : FISHER_SINGLE_FRAME_VIDEO_NODE_IDS;
  const inactiveVideoIds = isFirstLast ? FISHER_SINGLE_FRAME_VIDEO_NODE_IDS : FISHER_FIRST_LAST_VIDEO_NODE_IDS;

  for (const id of FISHER_IMAGE_NODE_IDS) setNodeEnabled(byId.get(id), false);
  for (const id of activeVideoIds) setNodeEnabled(byId.get(id), true);
  for (const id of inactiveVideoIds) setNodeEnabled(byId.get(id), false);
}

type WorkflowLink = [number, number, number, number, number, string];

function workflowLinks(workflow: Record<string, unknown>): WorkflowLink[] {
  return Array.isArray(workflow.links) ? (workflow.links as WorkflowLink[]) : [];
}

function setWorkflowLinks(workflow: Record<string, unknown>, links: WorkflowLink[]) {
  workflow.links = links;
}

function workflowNodes(workflow: Record<string, unknown>): WorkflowNode[] {
  return Array.isArray(workflow.nodes) ? (workflow.nodes as WorkflowNode[]) : [];
}

const VIRTUAL_GRAPH_ONLY_NODE_TYPES = new Set(["SetNode", "GetNode"]);

function isVirtualGraphOnlyNodeType(type: string): boolean {
  return VIRTUAL_GRAPH_ONLY_NODE_TYPES.has(type.trim());
}

function extractWorkflowNodeTypes(workflow: Record<string, unknown>): string[] {
  const nodeTypes = workflowNodes(workflow)
    .map((node) => (typeof node.type === "string" ? node.type.trim() : ""))
    .filter((type) => type.length > 0 && !isVirtualGraphOnlyNodeType(type));
  return uniquePreserveOrder(nodeTypes);
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

function characterViewRole(view: CharacterReferenceView): WeightedImageRef["role"] {
  if (view === "front") return "character_front";
  if (view === "side") return "character_side";
  return "character_back";
}

function orderedCharacterViews(
  plan: ReturnType<typeof inferCharacterReferencePlan>
): CharacterReferenceView[] {
  return [plan.primaryView, ...plan.secondaryViews];
}

function joinNaturalChineseList(values: string[]): string {
  const filtered = values.map((item) => item.trim()).filter((item) => item.length > 0);
  if (filtered.length === 0) return "";
  if (filtered.length === 1) return filtered[0]!;
  if (filtered.length === 2) return `${filtered[0]}和${filtered[1]}`;
  return `${filtered.slice(0, -1).join("、")}和${filtered[filtered.length - 1]}`;
}

function skyboxFaceLabel(face: SkyboxFace): string {
  if (face === "front") return "正前";
  if (face === "right") return "右侧";
  if (face === "back") return "背面";
  if (face === "left") return "左侧";
  if (face === "up") return "上方";
  if (face === "down") return "下方";
  return face;
}

function characterReferenceViewLabel(view: CharacterReferenceView): string {
  if (view === "front") return "正面";
  if (view === "side") return "侧面";
  if (view === "back") return "背面";
  return view;
}

function containsKeywordWithNegativeContext(
  raw: string,
  keyword: string,
  negativePrefixes: string[]
): boolean {
  const text = raw.toLowerCase();
  const needle = keyword.toLowerCase();
  let startIndex = 0;
  while (startIndex < text.length) {
    const matchIndex = text.indexOf(needle, startIndex);
    if (matchIndex < 0) return false;
    const contextStart = Math.max(0, matchIndex - 48);
    const context = text
      .slice(contextStart, matchIndex)
      .replace(/\s+/g, " ")
      .trim();
    if (!negativePrefixes.some((prefix) => context.endsWith(prefix) || context.includes(prefix.trim()))) {
      return true;
    }
    startIndex = matchIndex + needle.length;
  }
  return false;
}

function shotCameraDescriptor(shot: Shot): string {
  const yaw = typeof shot.cameraYaw === "number" && Number.isFinite(shot.cameraYaw) ? shot.cameraYaw : undefined;
  const pitch = typeof shot.cameraPitch === "number" && Number.isFinite(shot.cameraPitch) ? shot.cameraPitch : undefined;
  const fov = typeof shot.cameraFov === "number" && Number.isFinite(shot.cameraFov) ? shot.cameraFov : undefined;
  const parts: string[] = [];
  if (yaw !== undefined) parts.push(`yaw ${yaw.toFixed(0)}°`);
  if (pitch !== undefined) parts.push(`pitch ${pitch.toFixed(0)}°`);
  if (fov !== undefined) parts.push(`fov ${fov.toFixed(0)}°`);
  return parts.join(" / ");
}

function inferCharacterReferencePlan(shot: Shot): {
  primaryView: CharacterReferenceView;
  secondaryViews: CharacterReferenceView[];
} {
  const corpus = [
    shot.title ?? "",
    shot.storyPrompt ?? "",
    shot.videoPrompt ?? "",
    shot.notes ?? "",
    ...(shot.tags ?? [])
  ]
    .join(" ")
    .toLowerCase();

  const frontPreferred = containsAnyKeyword(corpus, [
    "正面",
    "正朝镜头",
    "朝向镜头",
    "面向镜头",
    "面对镜头",
    "正对镜头",
    "面向画面",
    "front-facing",
    "front facing",
    "facing camera",
    "toward camera",
    "towards camera",
    "mostly front-facing",
    "mostly front facing"
  ]);

  const backNegated = [
    "不要",
    "不能",
    "不是",
    "避免",
    "别",
    "禁止",
    "rather than",
    "instead of",
    "not ",
    "no ",
    "avoid ",
    "without "
  ];
  const backPositiveKeywords = [
    "背影",
    "背面",
    "背对",
    "背对镜头",
    "背身",
    "back view",
    "back-facing",
    "back facing",
    "rear view",
    "from behind",
    "seen from behind"
  ];
  const prefersBack = backPositiveKeywords.some((keyword) => containsKeywordWithNegativeContext(corpus, keyword, backNegated));
  if (frontPreferred && !prefersBack) {
    return { primaryView: "front", secondaryViews: ["side", "back"] };
  }

  if (prefersBack) {
    return { primaryView: "back", secondaryViews: ["side", "front"] };
  }

  const prefersSide = containsAnyKeyword(corpus, [
    "侧身",
    "侧面",
    "侧脸",
    "侧视",
    "侧拍",
    "斜侧",
    "profile",
    "side view",
    "three-quarter",
    "3/4"
  ]);
  if (prefersSide) {
    return { primaryView: "side", secondaryViews: ["front", "back"] };
  }

  return { primaryView: "front", secondaryViews: ["side", "back"] };
}

function characterReferenceWeight(view: CharacterReferenceView, plan: ReturnType<typeof inferCharacterReferencePlan>): number {
  if (view === plan.primaryView) return 1;
  const secondaryIndex = plan.secondaryViews.indexOf(view);
  if (secondaryIndex === 0) return 0.62;
  if (secondaryIndex === 1) return 0.34;
  return 0;
}

function assetPathForCharacterView(asset: Asset | undefined, view: CharacterReferenceView): string {
  if (!asset) return "";
  if (view === "front") return asset.characterFrontPath || asset.filePath || "";
  if (view === "side") return asset.characterSidePath || asset.characterFrontPath || asset.filePath || "";
  return asset.characterBackPath || asset.characterSidePath || asset.characterFrontPath || asset.filePath || "";
}

function inferStoryboardReferenceWeights(
  shot: Shot,
  hasSceneRef: boolean,
  hasSecondCharacter: boolean,
  hasSceneContinuityFrame: boolean
): {
  char1Primary: number;
  char1Secondary: number;
  char2Primary: number;
  denoise: number;
  steps: number;
  cfg: number;
} {
  const characterDriven = isCharacterDrivenShot(shot);
  const sceneLed = hasSceneRef && shouldLeadWithSceneReference(shot);
  if (sceneLed && hasSceneContinuityFrame && hasSecondCharacter) {
    if (characterDriven) {
      return {
        char1Primary: 0.72,
        char1Secondary: 0.08,
        char2Primary: 0.68,
        denoise: 0.4,
        steps: 28,
        cfg: 5.2
      };
    }
    return {
      char1Primary: 0.58,
      char1Secondary: 0.06,
      char2Primary: 0.54,
      denoise: 0.22,
      steps: 26,
      cfg: 4.9
    };
  }
  if (sceneLed && hasSceneContinuityFrame) {
    if (characterDriven) {
      return {
        char1Primary: 0.74,
        char1Secondary: 0.08,
        char2Primary: 0,
        denoise: 0.38,
        steps: 28,
        cfg: 5.2
      };
    }
    return {
      char1Primary: 0.6,
      char1Secondary: 0.06,
      char2Primary: 0,
      denoise: 0.22,
      steps: 26,
      cfg: 4.9
    };
  }
  if (sceneLed && hasSecondCharacter) {
    if (characterDriven) {
      return {
        // Scene-led dual-character storyboard shots are the most failure-prone:
        // keep the scene stable, but push both character anchors hard enough that
        // the second actor does not disappear into the background.
        char1Primary: 0.9,
        char1Secondary: 0.06,
        char2Primary: 0.88,
        denoise: 0.46,
        steps: 32,
        cfg: 6
      };
    }
    return {
      char1Primary: 0.82,
      char1Secondary: 0.04,
      char2Primary: 0.78,
      denoise: 0.36,
      steps: 30,
      cfg: 5.8
    };
  }
  if (sceneLed) {
    if (characterDriven) {
      return {
        char1Primary: 0.78,
        char1Secondary: 0.08,
        char2Primary: 0,
        denoise: 0.38,
        steps: 28,
        cfg: 5.2
      };
    }
    return {
      char1Primary: 0.6,
      char1Secondary: 0.04,
      char2Primary: 0,
      denoise: 0.24,
      steps: 24,
      cfg: 5.1
    };
  }
  if (hasSecondCharacter) {
    return {
      char1Primary: 0.94,
      char1Secondary: 0.08,
      char2Primary: 0.9,
      denoise: 0.42,
      steps: 30,
      cfg: 5.8
    };
  }
  return {
    char1Primary: 0.94,
    char1Secondary: 0.1,
    char2Primary: 0,
    denoise: 0.32,
    steps: 28,
    cfg: 5.2
  };
}

function isCharacterDrivenShot(shot: Shot): boolean {
  if ((shot.characterRefs?.length ?? 0) > 0) return true;
  if (shot.dialogue?.trim()) return true;
  const corpus = [
    shot.title ?? "",
    shot.storyPrompt ?? "",
    shot.videoPrompt ?? "",
    shot.notes ?? "",
    ...(shot.tags ?? [])
  ]
    .join(" ")
    .toLowerCase();
  return containsAnyKeyword(corpus, [
    "人物",
    "角色",
    "对峙",
    "对白",
    "打斗",
    "交手",
    "冲拳",
    "出拳",
    "闪避",
    "反击",
    "对话",
    "face off",
    "duel",
    "fight",
    "punch",
    "kick",
    "dodge"
  ]);
}

function shotsShareCharacters(left: Shot, right: Shot): boolean {
  const leftSet = new Set((left.characterRefs ?? []).filter((item) => item.trim().length > 0));
  if (leftSet.size === 0) return false;
  return (right.characterRefs ?? []).some((item) => leftSet.has(item));
}

function hasGeneratedStill(shot: Shot | undefined): shot is Shot {
  return Boolean(shot?.generatedImagePath?.trim());
}

function inferShotContinuityPlan(shot: Shot, index: number, allShots: Shot[]): ShotContinuityPlan {
  let previousSceneShot: Shot | undefined;
  let previousCharacterShot: Shot | undefined;

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = allShots[cursor];
    if (!hasGeneratedStill(candidate)) continue;
    if (!previousSceneShot && shot.sceneRefId?.trim() && candidate.sceneRefId === shot.sceneRefId) {
      previousSceneShot = candidate;
    }
    if (!previousCharacterShot && shotsShareCharacters(shot, candidate)) {
      previousCharacterShot = candidate;
    }
    if (previousSceneShot && previousCharacterShot) break;
  }

  return { previousSceneShot, previousCharacterShot };
}

function buildContinuityDirective(plan: ShotContinuityPlan): string {
  const lines: string[] = [];
  if (plan.previousSceneShot) {
    lines.push(
      `跨镜头场景连续：延续上一条同场景分镜“${plan.previousSceneShot.title}”的环境布局与空间锚点，桥梁、建筑、河岸、道路等固定物位置关系不得漂移或改造。`
    );
  }
  if (plan.previousCharacterShot) {
    lines.push(
      `跨镜头人物连续：延续上一条同角色分镜“${plan.previousCharacterShot.title}”中的角色外观，发型、服装、配饰、配色、体型和受光状态保持同一人设，不得突然变化。`
    );
  }
  if (lines.length > 0) {
    lines.push("连续性规则：这是同一段戏内的连续镜头，默认继承上一镜头已经建立的角色和场景，不允许重置设计。");
  }
  return lines.join("\n");
}

function buildShotReferenceDirective(
  shot: Shot,
  sceneAsset: Asset | undefined,
  skyboxFaces: SkyboxFace[],
  characterAssets: Asset[],
  continuityPlan: ShotContinuityPlan
): string {
  const lines: string[] = [];
  const characterPlan = characterAssets.length > 0 ? inferCharacterReferencePlan(shot) : null;
  const continuityDirective = buildContinuityDirective(continuityPlan);
  const cameraDescriptor = shotCameraDescriptor(shot);
  if (sceneAsset?.type === "skybox") {
    const faceText = joinNaturalChineseList(skyboxFaces.map((face) => skyboxFaceLabel(face)));
    lines.push(
      `场景硬参考：必须以天空盒“${sceneAsset.name}”为准，优先参考${faceText || "正前"}视角，保持地平线、空间布局、建筑或地貌朝向、时间氛围与主色调一致，不得改成其他地点。`
    );
    if (cameraDescriptor) {
      lines.push(`机位硬约束：当前镜头机位 ${cameraDescriptor}，必须与天空盒方向保持一致。`);
    }
  } else if (sceneAsset?.type === "scene") {
    lines.push(`场景硬参考：必须保持场景“${sceneAsset.name}”的环境布局、主体元素、光线和色调一致，不得重设计场景。`);
  }
  if (characterAssets.length > 0) {
    for (const asset of characterAssets) {
      const availableViews = [
        asset.characterFrontPath || asset.filePath ? "front" : "",
        asset.characterSidePath ? "side" : "",
        asset.characterBackPath ? "back" : ""
      ].filter((item) => item.length > 0);
      const viewText = availableViews.length > 0 ? availableViews.join("/") : "front";
      const preferredView = characterPlan ? characterReferenceViewLabel(characterPlan.primaryView) : "正面";
      lines.push(
        `人物硬参考：角色“${asset.name}”必须严格匹配三视图，保持脸型、发型、服装、配色、体型和道具一致；当前镜头优先匹配${preferredView}参考，可用视图为 ${viewText}，不得换脸、换装、换配色或混入其他角色特征。`
      );
    }
    lines.push("人物构图硬约束：人物必须在中前景清晰可见，优先完整半身或全身，不得退化成远景小人影、剪影或被场景主体遮挡。");
    lines.push("动作与站位硬约束：必须执行脚本描述的动作和站位，镜头变化时不得沿用上一镜头姿态或无关模板姿势。");
    lines.push("表情硬约束：每个出镜角色都必须有与当前镜头动作匹配的可读面部表情，不允许面无表情、木讷站桩或统一模板脸。");
    lines.push("人物-场景物理约束：人物脚部与地面接触关系自然，接触阴影方向与场景主光一致，不允许漂浮、穿模、比例失真。");
    lines.push("人物融合硬约束：人物必须像真实存在于场景中的主体，而不是贴在背景上的纸片；人物边缘、灰度、线条密度、受光和阴影必须与环境一致。");
    lines.push("人物风格硬约束：禁止把角色改成室内写真、自拍、时装摆拍、裸露画面或无关陌生人，必须保持参考角色的身份与服装。");
  }
  if (continuityDirective) {
    lines.push(continuityDirective);
  }
  if (lines.length > 0) {
    lines.push("执行规则：参考图优先级高于自由发挥，先锁定参考一致性，再生成镜头动作和构图。");
  }
  return lines.join("\n");
}

function buildCharacterPresenceDirective(characterAssets: Asset[]): string {
  if (characterAssets.length === 0) return "";
  if (characterAssets.length === 1) {
    return `出镜硬要求：画面中必须且只能出现 1 名主要角色“${characterAssets[0]!.name}”，禁止生成为纯环境空镜；禁止换成其他人、禁止多出陌生人、禁止把主体画成远处小人影。角色必须位于中前景且清晰可辨识，建议占画面高度至少约 35%，并保证完整全身、头顶和脚底都留有安全边距、脚部接地、受光自然、阴影与环境一致。`;
  }
  const names = joinNaturalChineseList(characterAssets.map((item) => item.name));
  return `出镜硬要求：画面中必须且只能出现 ${characterAssets.length} 名角色${names}，禁止生成为纯环境空镜，禁止缺少任何一人，禁止出现第三人、路人、群演、重复人、融合人或身份互换；每个角色都需各自对应 1 名可辨识人物，不允许用同一张脸或同一套服装冒充两个人，也不允许只出现极远小人、严重裁切或被场景主体完全遮挡。所有角色都必须完整接地、头顶脚底保留安全边距、阴影自然、比例正确，并作为场景中的真实主体出现。`;
}

function buildCompactStoryboardPresencePrompt(characterAssets: Asset[]): string {
  if (characterAssets.length === 0) return "";
  if (characterAssets.length === 1) {
    return `exactly one full body character, character clearly visible from head to toe with safe margin above head and below feet, same face same hair same outfit in every shot, visible body action, readable facial expression, standing in the scene, feet touching the ground, shadow matching environment, integrated with the environment, never crop the body, not an empty scene`;
  }
  const names = characterAssets.map((item) => item.name.trim()).filter((item) => item.length > 0);
  const nameText = names.length > 0 ? `exactly ${characterAssets.length} characters: ${names.join(" and ")}` : `exactly ${characterAssets.length} characters`;
  return `${nameText}, all characters full body and clearly visible from head to toe with safe top and bottom margins, same faces same hairstyles same outfits in every shot, visible body acting, readable facial expressions, all characters inside the scene, feet touching the ground, shadow matching environment, no missing character, no body crop, no empty scene, natural interaction with environment`;
}

function storyboardScreenZoneLabel(centerXRatio: number): string {
  if (centerXRatio <= 0.18) return "画面左边缘";
  if (centerXRatio <= 0.36) return "画面左侧";
  if (centerXRatio <= 0.47) return "画面中左";
  if (centerXRatio < 0.53) return "画面中间";
  if (centerXRatio < 0.66) return "画面中右";
  if (centerXRatio < 0.82) return "画面右侧";
  return "画面右边缘";
}

function storyboardDepthLabel(floorYRatio: number): string {
  if (floorYRatio >= 0.92) return "更靠前";
  if (floorYRatio >= 0.87) return "中前景";
  if (floorYRatio >= 0.82) return "中景";
  return "偏后";
}

function storyboardScaleLabel(sizeScale: number): string {
  if (sizeScale >= 1.02) return "主体更大";
  if (sizeScale <= 0.84) return "次要更小";
  return "常规大小";
}


function extractCharacterActionCues(text: string, characterNames: string[]): Array<{ characterName: string; actionCue: string }> {
  const cues = [];
  let remainingText = text;

  for (const characterName of characterNames) {
    const regex = new RegExp(`${characterName}([^,.]*)`, 'g');
    let match;
    while ((match = regex.exec(remainingText)) !== null) {
      cues.push({ characterName, actionCue: match[1].trim() });
    }
  }

  return cues;
}

function buildStoryboardBlockingDirective(shot: Shot, characterAssets: Asset[]): string {
  if (characterAssets.length === 0) return "";
  const refs = characterAssets.map((asset) => ({
    source: asset.characterFrontPath || asset.filePath || "",
    weight: 1,
    priority: 1,
    bucket: `character:${asset.id}`,
    label: `${asset.name}:front`,
    role: "character_front" as WeightedImageRef["role"]
  }));
  const placements = inferStoryboardCompositeLayout(shot, refs);
  const exactCountLine =
    characterAssets.length === 1
      ? `构图硬约束：本镜头只允许 1 名主体角色清晰可见，即“${characterAssets[0]!.name}”。`
      : `构图硬约束：本镜头必须清晰呈现 ${characterAssets.length} 名角色，且人数必须与剧本一致，不得多也不得少。`;
  const shotActionCue = compactTextParts(shot.title, shot.storyPrompt, shot.notes, shot.videoPrompt)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
  
  const characterCues = extractCharacterActionCues(shotActionCue, characterAssets.map(c => c.name));
  const actionLines = characterCues.map(cue => `动作硬约束（${cue.characterName}）: ${cue.actionCue}`);
  
  const genericActionLine = shotActionCue
    ? `动作硬约束：严格执行本镜头脚本动作（${shotActionCue}），禁止把角色退化为静止站姿、模板摆拍或与剧情无关的姿态。`
    : "动作硬约束：严格执行本镜头脚本动作，禁止把角色退化为静止站姿、模板摆拍或与剧情无关的姿态。";

  const finalActionLines = actionLines.length > 0 ? actionLines : [genericActionLine];
  const performanceLine =
    "表演硬约束：所有出镜角色都必须表现出清晰可见的身体动作和与情境一致的面部表情，不允许木讷站立、没有表情、没有反应或像证件照一样僵硬。";
  const framingConflictLine =
    "景别冲突处理规则：如果文案里出现近景、中景、反应镜头等表述，但本工作流又要求 full body，则必须以 full body 为最高优先级，通过让人物在画面中更大、更靠前来体现景别，禁止把头顶、脚底、手臂或躯干裁出画面，禁止退化成半身像或肖像裁切。";

  const placementLines = characterAssets.map((asset, index) => {
    const placement = placements[index] ?? placements[placements.length - 1] ?? { centerXRatio: 0.5, floorYRatio: 0.88, sizeScale: 1 };
    return `站位硬约束：角色“${asset.name}”位于${storyboardScreenZoneLabel(placement.centerXRatio)}、${storyboardDepthLabel(placement.floorYRatio)}，画面尺度为${storyboardScaleLabel(placement.sizeScale)}；该角色不得缺失，不得被另一角色替代，也不得缩成不可辨识的小人。`;
  });
  return [exactCountLine, ...finalActionLines, performanceLine, framingConflictLine, ...placementLines].join("\n");
}

function buildStoryboardStabilityDirective(hasSceneRef: boolean, hasCharacters: boolean): string {
  const parts: string[] = [
    "画面稳定约束：单张分镜图，透视关系稳定，构图清晰，主体边界清楚，拒绝抽象涂抹和随机扭曲。",
    "clean single storyboard frame, coherent perspective, clear composition, no surreal warping, no abstract artifacts.",
    "物理常识约束：重力方向、接触关系和遮挡关系合理，禁止人物漂浮、穿透地面或与场景尺度冲突。",
    "光照约束：主光方向统一，人物与场景阴影逻辑一致，不允许前后光源矛盾。"
  ];
  if (hasSceneRef) {
    parts.push("场景稳定约束：地平线、道路、栏杆、树木、建筑等结构保持笔直或自然透视，不允许融化、卷曲、漂浮。");
  }
  if (hasCharacters) {
    parts.push("人物稳定约束：人物解剖正确，四肢完整，站姿自然，禁止畸形肢体、重复身体、拼贴分身。");
    parts.push("人物尺度约束：人物头身比、手脚比例、与环境物体尺度保持常识范围，不允许巨人化或玩偶化。");
    parts.push("人物融合约束：人物轮廓、灰度、线条密度、材质表现与场景统一，不允许贴纸感、硬边抠图感、白底残留或人物像单独图层漂浮在背景前。");
    parts.push("表演稳定约束：角色动作要自然符合正常审美和身体重心，面部表情要清楚可读，不允许僵硬站桩、木偶姿势或空白脸。");
  }
  return parts.join("\n");
}

function shouldUseSecondaryCharacterView(shot: Shot): boolean {
  const corpus = [shot.title ?? "", shot.storyPrompt ?? "", shot.videoPrompt ?? "", shot.notes ?? "", ...(shot.tags ?? [])]
    .join(" ")
    .toLowerCase();
  return containsAnyKeyword(corpus, [
    "侧身",
    "回头",
    "背影",
    "背面",
    "背对",
    "profile",
    "side view",
    "back view",
    "over shoulder"
  ]);
}

function selectStoryboardCharacterAssets(shot: Shot, assets: Asset[]): Asset[] {
  if (assets.length <= 1) return assets;
  const explicitlyBoundCharacterCount = Math.max(
    shot.characterRefs?.filter((item) => item.trim().length > 0).length ?? 0,
    shot.sourceCharacterNames?.filter((item) => item.trim().length > 0).length ?? 0
  );
  const corpus = [shot.title ?? "", shot.storyPrompt ?? "", shot.videoPrompt ?? "", shot.notes ?? "", ...(shot.tags ?? [])]
    .join(" ")
    .toLowerCase();
  if (
    explicitlyBoundCharacterCount >= 2 ||
    containsAnyKeyword(corpus, [
      "exact character count is 2",
      "only 2",
      "both characters",
      "两个人都",
      "两人都",
      "双人",
      "二人"
    ])
  ) {
    return assets.slice(0, 2);
  }
  const isForcedDual = containsAnyKeyword(corpus, [
    "双人",
    "两人",
    "二人",
    "对峙",
    "对打",
    "打斗",
    "交手",
    "冲拳",
    "直拳",
    "闪避",
    "反击",
    "互相",
    "face off",
    "duel",
    "versus"
  ]);
  if (isForcedDual) return assets.slice(0, 2);

  const mentioned = assets.filter((asset) => corpus.includes(asset.name.toLowerCase()));
  if (mentioned.length === 1) return [mentioned[0]!];
  if (mentioned.length >= 2) return mentioned.slice(0, 2);

  const likelySingleFraming = containsAnyKeyword(corpus, [
    "特写",
    "近景",
    "中近景",
    "反应",
    "半身",
    "面部",
    "胸像",
    "close-up",
    "medium close",
    "reaction"
  ]);
  if (likelySingleFraming) return [assets[0]!];
  return assets.slice(0, 2);
}

function buildQwenReferenceInstruction(tokens: Record<string, string>): string {
  const sceneName = tokens.SCENE_REF_NAME?.trim() ?? "";
  const characterNames = splitCsv(tokens.CHARACTER_REF_NAMES);
  const preferredCharacterView = tokens.PREFERRED_CHARACTER_VIEW?.trim().toLowerCase() ?? "";
  const cameraYaw = tokens.CAMERA_YAW?.trim() ?? "";
  const cameraPitch = tokens.CAMERA_PITCH?.trim() ?? "";
  const cameraFov = tokens.CAMERA_FOV?.trim() ?? "";
  const previousSceneTitle = tokens.PREV_SCENE_SHOT_TITLE?.trim() ?? "";
  const previousCharacterTitle = tokens.PREV_CHARACTER_SHOT_TITLE?.trim() ?? "";
  const globalVisualStyle = tokens.GLOBAL_VISUAL_STYLE?.trim() ?? "";
  const currentShotTitle = tokens.SHOT_TITLE?.trim() ?? "";
  const pieces = ["Treat every provided input image as a binding reference, not optional inspiration."];
  if (globalVisualStyle) {
    pieces.push(`Keep one unified visual style across every shot: ${globalVisualStyle}.`);
    if (/2d|二维|国漫|动画/i.test(globalVisualStyle)) {
      pieces.push(
        "Render the final image as a polished 2D Chinese animation storyboard keyframe with clean line art, cel-shaded forms, unified stylization between characters and environment, and zero photorealistic or live-action texture."
      );
      pieces.push(
        "Do not drift into realistic cinema, grayscale photography, painterly concept art, or 3D render look; keep the result flat-to-semi-flat 2D animation art with readable silhouettes."
      );
      if (/一人之下/.test(globalVisualStyle)) {
        pieces.push(
          "Favor a modern Chinese donghua look similar to The Outcast: restrained realistic proportions, crisp controlled linework, subdued balanced palette, grounded urban-fantasy mood, and mature non-cute facial design."
        );
        pieces.push(
          "Avoid chibi, moe, glossy idol-anime, candy pastel, exaggerated manga comedy, or overly decorative fantasy styling."
        );
      }
    }
  }
  if (currentShotTitle) {
    pieces.push(`Current shot objective is ${currentShotTitle}; the framing and action of this shot must visibly differ when the script asks for a new angle, distance, reaction, walk, reverse, or dialogue beat.`);
  }
  if (previousSceneTitle) {
    pieces.push(
      `Maintain visual continuity from the previous same-scene shot ${previousSceneTitle}; keep fixed landmarks and environment layout stable.`
    );
  }
  if (previousCharacterTitle) {
    pieces.push(
      `Maintain character continuity from the previous same-character shot ${previousCharacterTitle}; do not change hairstyle, costume, props, body shape, or palette.`
    );
  }
  if (sceneName) {
    pieces.push(
      `Lock the environment to the scene reference ${sceneName}; keep layout, horizon, camera direction, lighting mood, and materials consistent.`
    );
  }
  if (cameraYaw || cameraPitch || cameraFov) {
    pieces.push(
      `Respect camera pose constraints (yaw=${cameraYaw || "auto"}, pitch=${cameraPitch || "auto"}, fov=${cameraFov || "auto"}); keep framing and perspective consistent with this shot setup.`
    );
  }
  if (characterNames.length > 0) {
    pieces.push(
      `Lock character identity for ${characterNames.join(", ")}; keep face, hair, costume, silhouette, proportions, and colors consistent, and choose ${preferredCharacterView || "front/side/back"} appearance according to the shot angle.`
    );
    pieces.push("Never output an empty environment plate when character references are provided.");
    pieces.push(
      "Characters must be naturally integrated into the scene with grounded feet, matched perspective, matched grayscale/lighting, and contact shadows; never paste a flat character sheet or white-background cutout on top of the scene."
    );
    pieces.push(
      "Use the raw character reference images only for identity and costume fidelity. Do not copy their flat shading, white-background illustration look, or reference-sheet rendering style into the final storyboard frame."
    );
    pieces.push(
      "Character reference images are identity-only guides. They must not dominate composition, camera distance, pose staging, or scene layout."
    );
    pieces.push(
      "Do not output empty environment-only frames when the shot script includes characters. Always place all required characters in visible positions and execute the scripted body actions for this shot."
    );
    pieces.push(
      "Every visible character must show a readable facial expression and a clear body action matching the shot, never an expressionless mannequin pose."
    );
  }
  pieces.push(
    "Treat the skybox environment and same-scene continuity frame as the main composition anchors. Treat character references as identity anchors only."
  );
  pieces.push(
    "If a layout guide is provided, use it only for blocking and placement. The actual environment must come from the scene reference, and the final characters must be freshly redrawn into that environment."
  );
  pieces.push(
    "If previous-shot continuity conflicts with character three-view or skybox references, always follow the character three-view and skybox assets first."
  );
  pieces.push(
    "Prefer the shot-matching character view and the matching skybox face over any weaker or generic reference."
  );
  pieces.push(
    "Generate one coherent cinematic shot in the same world. Do not redesign the environment, do not change character identity, and do not ignore any provided reference image."
  );
  pieces.push(
    "When a previous-scene frame is provided, use it only to preserve scene style, lighting family, and landmark placement; do not clone its exact framing or composition if the current shot prompt asks for a different camera distance, angle, or body action."
  );
  pieces.push("Ignore any accidental UI panels, inset cards, split-screen blocks, text labels, borders, or watermark-like artifacts that may appear inside reference frames; they are not part of the scene.");
  return pieces.join(" ");
}

function buildQwenSlotInstruction(
  stagedRefs: Array<{ role?: WeightedImageRef["role"]; label?: string }>
): string {
  if (stagedRefs.length === 0) return "";
  const lines = stagedRefs
    .slice(0, 6)
    .map((item, index) => {
      const slot = `Reference slot ${index + 1}`;
      const label = item.label?.trim() ?? "";
      if (label === "scene_character_composite") {
        return `${slot} is a soft occupancy map for character placement only; use it only to understand where people stand, their spacing, and their rough scale, then redraw them naturally into the environment without copying the guide silhouettes, edges, or tones.`;
      }
      if (label === "character_identity_board") {
        return `${slot} is a character identity board; use it only for face, hair, costume silhouette, and palette consistency across all characters, not for pose, framing, or white-background cutout shapes.`;
      }
      if (item.role === "scene_primary" || item.role === "scene_secondary") {
        return `${slot} is the binding environment reference${label ? ` (${label})` : ""}; keep location layout and camera direction aligned to it.`;
      }
      if (item.role === "character_front" || item.role === "character_side" || item.role === "character_back") {
        return `${slot} is the binding character identity reference${label ? ` (${label})` : ""}; keep face, hair, costume, and palette aligned to it, but do not copy the flat reference pose, white background, or cutout edges into the final shot.`;
      }
      if (item.role === "continuity_scene") {
        return `${slot} is a weak continuity environment hint${label ? ` (${label})` : ""}; only use it if it does not conflict with the skybox asset.`;
      }
      if (item.role === "continuity_character") {
        return `${slot} is a weak continuity character hint${label ? ` (${label})` : ""}; only use it if it does not conflict with the character three-view asset.`;
      }
      return `${slot} is a binding reference${label ? ` (${label})` : ""}.`;
    })
    .filter((item) => item.length > 0);
  return lines.join(" ");
}

function qwenReferenceChunkSize(stagedRefs: Array<{ role?: WeightedImageRef["role"] }>): number {
  if (stagedRefs.length <= 0) return 1;
  if (
    stagedRefs.some(
      (item) =>
        (item as { label?: string }).label === "scene_character_composite" ||
        (item as { label?: string }).label === "character_identity_board"
    )
  ) {
    // For storyboard stills, keep environment, layout guide, and identity guide in
    // separate encoders so weighting can actually bias the scene over the guides.
    return 1;
  }
  // Keep refs in one encoder when possible; multi-encoder averaging tends to
  // introduce geometry tearing and identity drift on storyboard stills.
  return 3;
}

function extractImageReferenceSources(
  shot: Shot,
  assets: Asset[],
  index: number,
  allShots: Shot[] = []
): WeightedImageRef[] {
  const sceneAsset = assets.find(
    (item) => item.id === (shot.sceneRefId ?? "") && (item.type === "scene" || item.type === "skybox")
  );
  const characterPlan = inferCharacterReferencePlan(shot);
  const continuityPlan = inferShotContinuityPlan(shot, index, allShots);
  const sceneRefs: WeightedImageRef[] = [];
  if (sceneAsset?.type === "scene") {
    if ((sceneAsset.filePath ?? "").trim()) {
      sceneRefs.push({
        source: sceneAsset.filePath,
        weight: 0.86,
        priority: 320,
        bucket: `scene:${sceneAsset.id}`,
        label: `${sceneAsset.name}:scene_primary`,
        role: "scene_primary"
      });
    }
  } else if (sceneAsset?.type === "skybox") {
    const plan = inferSkyboxReferencePlan(shot);
    // Keep one stable scene anchor for storyboard stills. Switching cube faces
    // between shots causes large environment drift and surreal composites.
    const shouldRespectDynamicFace =
      plan.manualFaces ||
      plan.manualWeights ||
      (typeof shot.cameraYaw === "number" && Number.isFinite(shot.cameraYaw)) ||
      (typeof shot.cameraPitch === "number" && Number.isFinite(shot.cameraPitch)) ||
      (typeof shot.cameraFov === "number" && Number.isFinite(shot.cameraFov));
    const faceCandidates = uniquePreserveOrder([
      shouldRespectDynamicFace ? plan.primaryFace : "front",
      ...(!shouldRespectDynamicFace ? ["front"] : []),
      ...plan.faces,
      "right",
      "left",
      "back",
      "up",
      "down"
    ]) as SkyboxFace[];
    const selectedFace = faceCandidates.find((face) => Boolean(sceneAsset.skyboxFaces?.[face]?.trim()));
    if (selectedFace) {
      const facePath = sceneAsset.skyboxFaces?.[selectedFace] ?? "";
      const rawWeight = plan.weights[selectedFace] ?? skyboxFaceWeight(shot, selectedFace);
      const weight = Math.max(0.7, Math.min(0.9, rawWeight));
      sceneRefs.push({
        source: facePath,
        weight,
        priority: 320,
        bucket: `scene:${sceneAsset.id}`,
        label: `${sceneAsset.name}:${selectedFace}`,
        role: "scene_primary"
      });
    }
    if (sceneRefs.length === 0 && (sceneAsset.filePath ?? "").trim()) {
      sceneRefs.push({
        source: sceneAsset.filePath,
        weight: 0.86,
        priority: 320,
        bucket: `scene:${sceneAsset.id}`,
        label: `${sceneAsset.name}:scene_primary`,
        role: "scene_primary"
      });
    }
  }

  const selectedCharacters = (shot.characterRefs ?? [])
    .map((id) => assets.find((item) => item.id === id && item.type === "character"))
    .filter((item): item is Asset => Boolean(item));
  const prefersAngleMatchedView = shouldUseSecondaryCharacterView(shot);
  const shouldPreferFrontIdentityRefs =
    (sceneRefs.length > 0 || selectedCharacters.length > 1 || shotLooksCharacterDrivenInComfy(shot)) &&
    !prefersAngleMatchedView;
  const characterRefs = selectedCharacters.flatMap((asset, assetIndex) => {
    const refs: WeightedImageRef[] = [];
    const front = asset.characterFrontPath || asset.filePath || "";
    const side = asset.characterSidePath || "";
    const back = asset.characterBackPath || "";
    const byView: Record<CharacterReferenceView, string> = { front, side, back };
    const primaryView = shouldPreferFrontIdentityRefs ? "front" : characterPlan.primaryView;
    const primarySource =
      primaryView === "front"
        ? byView.front.trim() || byView.side.trim() || byView.back.trim()
        : byView[primaryView].trim() || byView.front.trim() || byView.side.trim() || byView.back.trim();
    const primaryWeight =
      sceneRefs.length > 0 ? (selectedCharacters.length > 1 ? 0.34 : 0.4) : 0.72;
    const primaryPriority = sceneRefs.length > 0 ? 245 - assetIndex * 10 : 420 - assetIndex * 20;
    if (primarySource) {
      refs.push({
        source: primarySource,
        weight: primaryWeight,
        priority: primaryPriority,
        bucket: `character:${asset.id}`,
        label: `${asset.name}:${primaryView}`,
        role: characterViewRole(primaryView)
      });
    }
    // Only use a secondary character view as fallback when scene anchor is missing
    // and there is a single character in shot.
    if (selectedCharacters.length === 1 && sceneRefs.length === 0) {
      const secondaryView = shouldPreferFrontIdentityRefs
        ? characterPlan.primaryView === "front"
          ? characterPlan.secondaryViews[0]
          : characterPlan.primaryView
        : characterPlan.secondaryViews[0];
      if (secondaryView) {
        const secondarySource = byView[secondaryView].trim();
        if (secondarySource && secondarySource !== primarySource) {
          refs.push({
            source: secondarySource,
            weight: 0.28,
            priority: 360,
            bucket: `character:${asset.id}`,
            label: `${asset.name}:${secondaryView}`,
            role: characterViewRole(secondaryView)
          });
        }
      }
    }
    return refs;
  });
  const continuityRefs: WeightedImageRef[] = [];
  const previousSceneImage = parseComfyViewPath(continuityPlan.previousSceneShot?.generatedImagePath ?? "");
  if (previousSceneImage) {
    continuityRefs.push({
      source: previousSceneImage,
      weight: sceneRefs.length > 0 ? 0.34 : 0.36,
      priority: sceneRefs.length > 0 ? 185 : 110,
      bucket: "continuity:scene",
      label: continuityPlan.previousSceneShot?.title
        ? `continuity_scene:${continuityPlan.previousSceneShot.title}`
        : "continuity_scene",
      role: "continuity_scene"
    });
  }
  const previousCharacterImage = parseComfyViewPath(continuityPlan.previousCharacterShot?.generatedImagePath ?? "");
  if (previousCharacterImage) {
    continuityRefs.push({
      source: previousCharacterImage,
      weight: characterRefs.length > 0 ? 0.34 : 0.3,
      priority: characterRefs.length > 0 ? 240 : 120,
      bucket: "continuity:character",
      label: continuityPlan.previousCharacterShot?.title
        ? `continuity_character:${continuityPlan.previousCharacterShot.title}`
        : "continuity_character",
      role: "continuity_character"
    });
  }
  const merged = [...characterRefs, ...sceneRefs, ...continuityRefs].filter((item) => item.source.trim().length > 0);
  const deduped = new Map<string, WeightedImageRef>();
  for (const item of merged) {
    const prev = deduped.get(item.source);
    if (!prev) {
      deduped.set(item.source, item);
      continue;
    }
    if (item.priority > prev.priority || (item.priority === prev.priority && item.weight > prev.weight)) {
      deduped.set(item.source, {
        ...item,
        weight: Math.max(prev.weight, item.weight),
        priority: Math.max(prev.priority, item.priority)
      });
      continue;
    }
    deduped.set(item.source, {
      ...prev,
      weight: Math.max(prev.weight, item.weight),
      priority: Math.max(prev.priority, item.priority)
    });
  }
  return [...deduped.values()].sort((left, right) => {
    const priorityDelta = right.priority - left.priority;
    if (priorityDelta !== 0) return priorityDelta;
    return right.weight - left.weight;
  });
}

function pushUniqueWeightedRef(
  target: WeightedImageRef[],
  usedSources: Set<string>,
  candidate: WeightedImageRef | undefined
) {
  if (!candidate) return;
  const source = candidate.source.trim();
  if (!source || usedSources.has(source)) return;
  target.push(candidate);
  usedSources.add(source);
}

function firstDistinctBucketRef(
  refs: WeightedImageRef[],
  predicate: (item: WeightedImageRef) => boolean,
  excludedBuckets: Set<string>,
  usedSources: Set<string>
): WeightedImageRef | undefined {
  return refs.find((item) => predicate(item) && !excludedBuckets.has(item.bucket) && !usedSources.has(item.source.trim()));
}

function adjustStoryboardReferenceWeight(
  shot: Shot,
  ref: WeightedImageRef,
  selectedRefs: WeightedImageRef[]
): WeightedImageRef {
  const availableCharacterNames = selectedRefs
    .filter((item) => item.role.startsWith("character_"))
    .map((item) => extractCharacterNameFromReferenceLabel(item.label))
    .filter((item) => item.length > 0);
  const focusedCharacterName = inferStoryboardFocusedCharacterName(shot, availableCharacterNames);
  const refCharacterName = extractCharacterNameFromReferenceLabel(ref.label);
  const hasCompositeGuide = selectedRefs.some((item) => item.label === "scene_character_composite");
  const characterRefCount = selectedRefs.filter((item) => item.role.startsWith("character_")).length;
  if (ref.label === "scene_character_composite") {
    return {
      ...ref,
      weight: 0.14,
      priority: Math.min(ref.priority, 230)
    };
  }
  if (ref.label === "character_identity_board") {
    return {
      ...ref,
      weight: focusedCharacterName ? 0.26 : 0.38,
      priority: Math.min(ref.priority, focusedCharacterName ? 300 : 320)
    };
  }
  if (ref.role === "scene_primary" || ref.role === "scene_secondary") {
    return {
      ...ref,
      weight: Math.max(ref.weight, 1.0)
    };
  }
  if (ref.role === "continuity_scene") {
    return {
      ...ref,
      weight: hasCompositeGuide ? Math.max(ref.weight, 0.72) : Math.max(ref.weight, 0.46),
      priority: hasCompositeGuide ? Math.max(ref.priority, 250) : ref.priority
    };
  }
  if (ref.role === "character_front" || ref.role === "character_side" || ref.role === "character_back") {
    if (hasCompositeGuide && focusedCharacterName && refCharacterName === focusedCharacterName) {
      return {
        ...ref,
        weight: Math.max(ref.weight, 0.96),
        priority: Math.max(ref.priority, 380)
      };
    }
    if (hasCompositeGuide && characterRefCount >= 2) {
      return {
        ...ref,
        weight: Math.max(ref.weight, 0.88),
        priority: Math.max(ref.priority, 350)
      };
    }
    return {
      ...ref,
      weight: hasCompositeGuide ? Math.max(ref.weight, 0.82) : Math.min(ref.weight, 0.48)
    };
  }
  return ref;
}

function selectStoryboardReferenceSlots(shot: Shot, refs: WeightedImageRef[]): WeightedImageRef[] {
  if (refs.length <= 5) return refs.slice(0, 5);
  const ordered = [...refs].sort((left, right) => {
    const priorityDelta = right.priority - left.priority;
    if (priorityDelta !== 0) return priorityDelta;
    return right.weight - left.weight;
  });
  const composite = ordered.find((item) => item.label === "scene_character_composite");
  const identityBoard = ordered.find((item) => item.label === "character_identity_board");
  const characters = ordered.filter(
    (item) => item.role.startsWith("character_") && item.label !== "character_identity_board"
  );
  const primaryScene =
    ordered.find(
      (item) =>
        (item.role === "scene_primary" || item.role === "scene_secondary") && item.label !== "scene_character_composite"
    ) ??
    ordered.find((item) => item.role === "continuity_scene");
  const focusedCharacterName = inferStoryboardFocusedCharacterName(
    shot,
    characters.map((item) => extractCharacterNameFromReferenceLabel(item.label)).filter((item) => item.length > 0)
  );
  const focusedCharacterRef =
    focusedCharacterName
      ? characters.find((item) => extractCharacterNameFromReferenceLabel(item.label) === focusedCharacterName)
      : undefined;
  const compositeContinuityScene = ordered.find((item) => item.role === "continuity_scene");
  const scale = inferStoryboardCompositeScale(shot);
  if (composite) {
    const selectedWithComposite: WeightedImageRef[] = [];
    const usedSources = new Set<string>();
    if (primaryScene && !usedSources.has(primaryScene.source.trim())) {
      selectedWithComposite.push(primaryScene);
      usedSources.add(primaryScene.source.trim());
    }
    if (compositeContinuityScene && !usedSources.has(compositeContinuityScene.source.trim())) {
      selectedWithComposite.push(compositeContinuityScene);
      usedSources.add(compositeContinuityScene.source.trim());
    }
    if (!usedSources.has(composite.source.trim())) {
      selectedWithComposite.push(composite);
      usedSources.add(composite.source.trim());
    }
    if (selectedWithComposite.length < 4 && focusedCharacterRef && !usedSources.has(focusedCharacterRef.source.trim())) {
      selectedWithComposite.push(focusedCharacterRef);
      usedSources.add(focusedCharacterRef.source.trim());
    }
    const usedCharacterBuckets = new Set<string>();
    for (const characterRef of characters) {
      if (selectedWithComposite.length >= 5) break;
      if (usedCharacterBuckets.has(characterRef.bucket) || usedSources.has(characterRef.source.trim())) continue;
      selectedWithComposite.push(characterRef);
      usedSources.add(characterRef.source.trim());
      usedCharacterBuckets.add(characterRef.bucket);
    }
    if (!compositeContinuityScene && selectedWithComposite.length < 5 && identityBoard && !usedSources.has(identityBoard.source.trim())) {
      selectedWithComposite.push(identityBoard);
      usedSources.add(identityBoard.source.trim());
    }
    return selectedWithComposite.slice(0, 5);
  }
  const selected: WeightedImageRef[] = [];
  const usedSources = new Set<string>();
  pushUniqueWeightedRef(selected, usedSources, primaryScene);
  pushUniqueWeightedRef(selected, usedSources, identityBoard);
  const usedCharacterBuckets = new Set<string>();
  for (const characterRef of characters) {
    if (selected.length >= 4) break;
    if (usedCharacterBuckets.has(characterRef.bucket)) continue;
    pushUniqueWeightedRef(selected, usedSources, characterRef);
    usedCharacterBuckets.add(characterRef.bucket);
  }
  const continuityCharacter = ordered.find(
    (item) => item.role === "continuity_character" && !usedSources.has(item.source.trim())
  );
  const continuityScene = ordered.find(
    (item) => item.role === "continuity_scene" && !usedSources.has(item.source.trim())
  );

  const fallbackCandidates = [
    continuityCharacter,
    continuityScene,
    ...ordered.filter((item) => !usedSources.has(item.source.trim()))
  ];
  for (const candidate of fallbackCandidates) {
    pushUniqueWeightedRef(selected, usedSources, candidate);
    if (selected.length >= 4) break;
  }

  return selected.slice(0, 4);
}

function shouldLeadWithSceneReference(shot: Shot): boolean {
  const corpus = [
    shot.title ?? "",
    shot.storyPrompt ?? "",
    shot.videoPrompt ?? "",
    shot.notes ?? "",
    ...(shot.tags ?? [])
  ]
    .join(" ")
    .toLowerCase();
  const explicitCharacterFocus = containsAnyKeyword(corpus, [
    "人物主体",
    "角色主体",
    "对白",
    "对话",
    "起话",
    "回应",
    "反打",
    "近景",
    "中近景",
    "特写",
    "单人主镜头",
    "人物明确存在",
    "walk",
    "walking",
    "speak",
    "speaking",
    "reaction",
    "medium close",
    "close-up"
  ]);
  if (explicitCharacterFocus) return false;
  return containsAnyKeyword(corpus, [
    "全景",
    "大全景",
    "远景",
    "建立镜头",
    "环境空镜",
    "环境建立",
    "wide establishing",
    "establishing",
    "environment plate",
    "scenery frame"
  ]);
}

function reorderStoryboardReferenceSlots(shot: Shot, refs: WeightedImageRef[]): WeightedImageRef[] {
  if (refs.length <= 1) return refs;
  const hasIdentityCoverage = refs.some((item) => item.label === "character_identity_board");
  const characterRefCount = refs.filter((item) => item.role.startsWith("character_") && item.label !== "character_identity_board").length;
  const maxStoryboardRefs = hasIdentityCoverage && characterRefCount >= 2 ? 5 : 4;
  const composite = refs.filter((item) => item.label === "scene_character_composite");
  const identityBoards = refs.filter((item) => item.label === "character_identity_board");
  const characters = refs.filter(
    (item) => item.role.startsWith("character_") && item.label !== "character_identity_board"
  );
  const scenes = refs.filter(
    (item) => (item.role === "scene_primary" || item.role === "scene_secondary") && item.label !== "scene_character_composite"
  );
  const continuity = refs.filter((item) => item.role === "continuity_character" || item.role === "continuity_scene");
  const continuityScene = continuity.filter((item) => item.role === "continuity_scene");
  const continuityCharacter = continuity.filter((item) => item.role === "continuity_character");
  const focusedCharacterName = inferStoryboardFocusedCharacterName(
    shot,
    characters.map((item) => extractCharacterNameFromReferenceLabel(item.label)).filter((item) => item.length > 0)
  );
  const focusedCharacterRef =
    focusedCharacterName
      ? characters.find((item) => extractCharacterNameFromReferenceLabel(item.label) === focusedCharacterName)
      : undefined;
  const scale = inferStoryboardCompositeScale(shot);
  if (composite.length > 0) {
    return [
      ...scenes.slice(0, 1),
      ...continuityScene.slice(0, 1),
      ...composite.slice(0, 1),
      ...(focusedCharacterRef ? [focusedCharacterRef] : identityBoards.slice(0, 1)),
      ...characters.filter((item) => item !== focusedCharacterRef).slice(0, focusedCharacterRef ? 1 : 2),
      ...(!continuityScene.length ? identityBoards.slice(0, 1) : []),
      ...continuityCharacter
    ].slice(0, maxStoryboardRefs);
  }
  // Always keep environment anchor first when a scene/skybox reference exists.
  if (continuityScene.length > 0 && scenes.length > 0) {
    return [
      ...scenes.slice(0, 1),
      ...continuityScene.slice(0, 1),
      ...identityBoards.slice(0, 1),
      ...characters.slice(0, 1),
      ...continuityCharacter,
      ...characters.slice(1)
    ].slice(0, maxStoryboardRefs);
  }
  if (scenes.length > 0) {
    return [...scenes.slice(0, 1), ...identityBoards.slice(0, 1), ...characters.slice(0, 2), ...continuity, ...scenes.slice(1), ...characters.slice(2)].slice(0, maxStoryboardRefs);
  }
  if (shouldLeadWithSceneReference(shot)) {
    return [...continuityScene, ...identityBoards.slice(0, 1), ...characters.slice(0, 2), ...continuityCharacter].slice(0, maxStoryboardRefs);
  }
  return [...identityBoards.slice(0, 1), ...characters.slice(0, 2), ...continuity].slice(0, maxStoryboardRefs);
}

function canProcessStoryboardReferenceImages(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

async function loadReferenceImageElement(pathOrUrl: string): Promise<HTMLImageElement | null> {
  if (!canProcessStoryboardReferenceImages()) return null;
  const trimmed = pathOrUrl.trim();
  if (!trimmed) return null;
  const source = /^data:|^https?:|^blob:|^file:/i.test(trimmed) ? trimmed : toDesktopMediaSource(trimmed);
  if (!source) return null;
  return await new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

async function loadComparableImageData(
  pathOrUrl: string,
  width = 96,
  height = 54
): Promise<ImageData | null> {
  const image = await loadReferenceImageElement(pathOrUrl);
  if (!image) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function detectReferenceContentBounds(context: CanvasRenderingContext2D, width: number, height: number) {
  const frame = context.getImageData(0, 0, width, height);
  const data = frame.data;
  const background = estimateBorderBackgroundColor(context, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] ?? 255;
    if (alpha <= 8) continue;
    const dr = (data[index] ?? 0) - background.r;
    const dg = (data[index + 1] ?? 0) - background.g;
    const db = (data[index + 2] ?? 0) - background.b;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    if (distance < 18) continue;
    const pixel = index / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (maxX < minX || maxY < minY) return null;
  const padding = Math.max(6, Math.round(Math.min(width, height) * 0.015));
  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  return {
    x: cropX,
    y: cropY,
    width: Math.min(width - cropX, maxX - minX + 1 + padding * 2),
    height: Math.min(height - cropY, maxY - minY + 1 + padding * 2),
    background
  };
}

async function stagePreparedReferenceImage(
  settings: ComfySettings,
  source: string,
  targetAbs: string,
  mode: "scene" | "character"
): Promise<string> {
  const trimmedSource = source.trim();
  if (!trimmedSource || !canProcessStoryboardReferenceImages()) {
    return stageSourceFileToComfyInput(trimmedSource, targetAbs, settings.baseUrl, settings.outputDir);
  }
  const image = await loadReferenceImageElement(trimmedSource);
  if (!image) {
    return stageSourceFileToComfyInput(trimmedSource, targetAbs, settings.baseUrl, settings.outputDir);
  }
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (width <= 0 || height <= 0) {
    return stageSourceFileToComfyInput(trimmedSource, targetAbs, settings.baseUrl, settings.outputDir);
  }

  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = width;
  sampleCanvas.height = height;
  const sampleContext = sampleCanvas.getContext("2d");
  if (!sampleContext) {
    return stageSourceFileToComfyInput(trimmedSource, targetAbs, settings.baseUrl, settings.outputDir);
  }
  sampleContext.drawImage(image, 0, 0, width, height);
  const bounds = detectReferenceContentBounds(sampleContext, width, height);
  if (!bounds) {
    return stageSourceFileToComfyInput(trimmedSource, targetAbs, settings.baseUrl, settings.outputDir);
  }

  const trimmedCanvas = document.createElement("canvas");
  trimmedCanvas.width = bounds.width;
  trimmedCanvas.height = bounds.height;
  const trimmedContext = trimmedCanvas.getContext("2d");
  if (!trimmedContext) {
    return stageSourceFileToComfyInput(trimmedSource, targetAbs, settings.baseUrl, settings.outputDir);
  }
  trimmedContext.drawImage(
    sampleCanvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height
  );

  const shouldSquarePad = mode === "character";
  const padding = shouldSquarePad ? Math.max(24, Math.round(Math.max(bounds.width, bounds.height) * 0.08)) : 0;
  const outWidth = shouldSquarePad ? Math.max(bounds.width, bounds.height) + padding * 2 : bounds.width;
  const outHeight = shouldSquarePad ? Math.max(bounds.width, bounds.height) + padding * 2 : bounds.height;
  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    return stageSourceFileToComfyInput(trimmedSource, targetAbs, settings.baseUrl, settings.outputDir);
  }

  context.fillStyle = `rgb(${clampChannel(bounds.background.r)}, ${clampChannel(bounds.background.g)}, ${clampChannel(bounds.background.b)})`;
  context.fillRect(0, 0, outWidth, outHeight);
  context.drawImage(
    trimmedCanvas,
    Math.round((outWidth - bounds.width) / 2),
    Math.round((outHeight - bounds.height) / 2),
    bounds.width,
    bounds.height
  );

  try {
    const written = await invokeDesktop<FileWriteResult>("write_base64_file", {
      filePath: targetAbs,
      base64Data: canvas.toDataURL("image/png").replace(/^data:[^,]+,/, "")
    });
    if (written.filePath.trim()) return written.filePath;
  } catch {
    // Keep the original staging path when square padding cannot be materialized.
  }
  return stageSourceFileToComfyInput(trimmedSource, targetAbs, settings.baseUrl, settings.outputDir);
}

function averageImageDifference(left: ImageData, right: ImageData): number {
  if (left.width !== right.width || left.height !== right.height) return Number.POSITIVE_INFINITY;
  const leftData = left.data;
  const rightData = right.data;
  if (leftData.length !== rightData.length || leftData.length === 0) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let index = 0; index < leftData.length; index += 4) {
    total += Math.abs((leftData[index] ?? 0) - (rightData[index] ?? 0));
    total += Math.abs((leftData[index + 1] ?? 0) - (rightData[index + 1] ?? 0));
    total += Math.abs((leftData[index + 2] ?? 0) - (rightData[index + 2] ?? 0));
  }
  return total / ((leftData.length / 4) * 3);
}

async function compareImageSources(leftSource: string, rightSource: string): Promise<number | null> {
  const [left, right] = await Promise.all([loadComparableImageData(leftSource), loadComparableImageData(rightSource)]);
  if (!left || !right) return null;
  return averageImageDifference(left, right);
}

function resolveInputTokenSourcePath(settings: ComfySettings, tokenValue: string): string {
  const trimmed = tokenValue.trim();
  if (!trimmed) return "";
  if (canUseAbsoluteLocalPath(trimmed)) return trimmed;
  const inputDir = inferComfyInputDir(settings);
  if (!inputDir) return trimmed;
  return `${inputDir.replace(/\/+$/, "")}/${trimmed.replace(/^\/+/, "")}`;
}

function hasStoryboardCharacterSeed(tokens: Record<string, string>): boolean {
  return Boolean(
    String(tokens.CHAR1_PRIMARY_PATH ?? tokens.CHAR1_FRONT_PATH ?? "").trim() ||
      String(tokens.CHAR2_PRIMARY_PATH ?? tokens.CHAR2_FRONT_PATH ?? "").trim()
  );
}

function toStableMediaPreviewUrl(source: string): string {
  const mediaSource = toDesktopMediaSource(source).trim();
  if (!mediaSource) return source;
  if (/^(https?:|blob:|data:|file:|asset:)/i.test(mediaSource)) return mediaSource;
  if (mediaSource.startsWith("/") && typeof window !== "undefined" && window.location?.origin) {
    try {
      return new URL(mediaSource, window.location.origin).toString();
    } catch {
      return mediaSource;
    }
  }
  return mediaSource;
}

async function materializeStoryboardFallbackStill(
  settings: ComfySettings,
  shot: Shot,
  sourcePath: string,
  label: string
): Promise<{ previewUrl: string; localPath: string }> {
  const outputRoot = settings.outputDir.trim().replace(/\/+$/, "");
  const ext = fileExtensionFromSource(sourcePath);
  const safeLabel = sanitizePathSegment(`${shot.id}_${label}`);
  const targetPath = outputRoot
    ? `${outputRoot}/Storyboard/${Date.now()}_${safeLabel}.${ext}`
    : localStillCachePath(settings, `${shot.id}_${label}`, sourcePath);
  const copied = await invokeDesktop<FileWriteResult>("copy_file_to", {
    sourcePath,
    targetPath
  });
  return {
    previewUrl: toStableMediaPreviewUrl(copied.filePath),
    localPath: copied.filePath
  };
}

async function maybeFallbackToStoryboardComposite(
  settings: ComfySettings,
  shot: Shot,
  tokens: Record<string, string>,
  generatedLocalPath: string,
  kind: "image" | "video" | "audio",
  assetOutputContext: AssetOutputContext | null
): Promise<{ previewUrl: string; localPath: string } | null> {
  if (kind !== "image" || assetOutputContext || !canProcessStoryboardReferenceImages()) return null;
  const hasCharacterSeed = hasStoryboardCharacterSeed(tokens);
  const framePath = resolveInputTokenSourcePath(settings, String(tokens.FRAME_IMAGE_PATH ?? ""));
  const scenePath = resolveInputTokenSourcePath(settings, String(tokens.SCENE_REF_PATH ?? ""));
  if (!canUseAbsoluteLocalPath(framePath) || !canUseAbsoluteLocalPath(scenePath) || !canUseAbsoluteLocalPath(generatedLocalPath)) {
    return null;
  }
  const [frameSceneDiff, outputSceneDiff, outputFrameDiff] = await Promise.all([
    compareImageSources(framePath, scenePath),
    compareImageSources(generatedLocalPath, scenePath),
    compareImageSources(generatedLocalPath, framePath)
  ]);
  if (
    frameSceneDiff === null ||
    outputSceneDiff === null ||
    outputFrameDiff === null ||
    !Number.isFinite(frameSceneDiff) ||
    !Number.isFinite(outputSceneDiff) ||
    !Number.isFinite(outputFrameDiff)
  ) {
    return null;
  }
  if (hasCharacterSeed) {
    return null;
  }
  const frameCarriesVisibleCharacters = frameSceneDiff >= (hasCharacterSeed ? 3.5 : 8);
  const outputCollapsedToScene = hasCharacterSeed
    ? outputSceneDiff <= Math.max(6, frameSceneDiff * 0.78) &&
      outputFrameDiff >= Math.max(6.5, outputSceneDiff * 1.05, frameSceneDiff * 0.28)
    : outputSceneDiff <= Math.max(8, frameSceneDiff * 0.72) &&
      outputFrameDiff >= Math.max(10, outputSceneDiff * 1.15, frameSceneDiff * 0.42);
  if (!frameCarriesVisibleCharacters || !outputCollapsedToScene) return null;
  return materializeStoryboardFallbackStill(settings, shot, framePath, "storyboard_composite_fallback");
}

async function isStoryboardCharacterDropout(
  settings: ComfySettings,
  tokens: Record<string, string>,
  generatedLocalPath: string
): Promise<boolean> {
  const hasCharacterSeed = hasStoryboardCharacterSeed(tokens);
  if (!hasCharacterSeed) return false;
  const framePath = resolveInputTokenSourcePath(settings, String(tokens.FRAME_IMAGE_PATH ?? ""));
  const scenePath = resolveInputTokenSourcePath(settings, String(tokens.SCENE_REF_PATH ?? ""));
  if (!canUseAbsoluteLocalPath(framePath) || !canUseAbsoluteLocalPath(scenePath) || !canUseAbsoluteLocalPath(generatedLocalPath)) {
    return false;
  }
  const [frameSceneDiff, outputSceneDiff, outputFrameDiff] = await Promise.all([
    compareImageSources(framePath, scenePath),
    compareImageSources(generatedLocalPath, scenePath),
    compareImageSources(generatedLocalPath, framePath)
  ]);
  if (
    frameSceneDiff === null ||
    outputSceneDiff === null ||
    outputFrameDiff === null ||
    !Number.isFinite(frameSceneDiff) ||
    !Number.isFinite(outputSceneDiff) ||
    !Number.isFinite(outputFrameDiff)
  ) {
    return false;
  }
  const frameCarriesVisibleCharacters = frameSceneDiff >= 3.5;
  const outputCollapsedToScene =
    outputSceneDiff <= Math.max(6, frameSceneDiff * 0.78) &&
    outputFrameDiff >= Math.max(6.5, outputSceneDiff * 1.05, frameSceneDiff * 0.28);
  return frameCarriesVisibleCharacters && outputCollapsedToScene;
}

function estimateBorderBackgroundColor(context: CanvasRenderingContext2D, width: number, height: number) {
  const frame = context.getImageData(0, 0, width, height);
  const data = frame.data;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 96));
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  const sample = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    sumR += data[index] ?? 0;
    sumG += data[index + 1] ?? 0;
    sumB += data[index + 2] ?? 0;
    count += 1;
  };
  for (let x = 0; x < width; x += step) {
    sample(x, 0);
    sample(x, Math.max(0, height - 1));
  }
  for (let y = step; y < height - step; y += step) {
    sample(0, y);
    sample(Math.max(0, width - 1), y);
  }
  return {
    r: count > 0 ? sumR / count : 255,
    g: count > 0 ? sumG / count : 255,
    b: count > 0 ? sumB / count : 255
  };
}

async function buildCharacterCutoutCanvas(pathOrUrl: string): Promise<HTMLCanvasElement | null> {
  const image = await loadReferenceImageElement(pathOrUrl);
  if (!image) return null;
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (width <= 0 || height <= 0) return null;
  const workCanvas = document.createElement("canvas");
  workCanvas.width = width;
  workCanvas.height = height;
  const context = workCanvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  const frame = context.getImageData(0, 0, width, height);
  const data = frame.data;
  const background = estimateBorderBackgroundColor(context, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < data.length; index += 4) {
    const dr = (data[index] ?? 0) - background.r;
    const dg = (data[index + 1] ?? 0) - background.g;
    const db = (data[index + 2] ?? 0) - background.b;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    const alpha = distance <= 28 ? 0 : distance >= 58 ? 255 : Math.round(((distance - 28) / 30) * 255);
    data[index + 3] = alpha;
    if (alpha <= 0) continue;
    const pixel = index / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (maxX < minX || maxY < minY) return null;
  context.putImageData(frame, 0, 0);
  const padding = Math.max(8, Math.round(Math.min(width, height) * 0.03));
  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropWidth = Math.min(width - cropX, maxX - minX + 1 + padding * 2);
  const cropHeight = Math.min(height - cropY, maxY - minY + 1 + padding * 2);
  const cutoutCanvas = document.createElement("canvas");
  cutoutCanvas.width = cropWidth;
  cutoutCanvas.height = cropHeight;
  const cutoutContext = cutoutCanvas.getContext("2d");
  if (!cutoutContext) return null;
  cutoutContext.drawImage(workCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return cutoutCanvas;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function sampleSceneRegionColor(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
): { r: number; g: number; b: number } {
  const safeX = Math.max(0, Math.min(context.canvas.width - 1, Math.round(x)));
  const safeY = Math.max(0, Math.min(context.canvas.height - 1, Math.round(y)));
  const safeWidth = Math.max(1, Math.min(context.canvas.width - safeX, Math.round(width)));
  const safeHeight = Math.max(1, Math.min(context.canvas.height - safeY, Math.round(height)));
  const image = context.getImageData(safeX, safeY, safeWidth, safeHeight);
  const data = image.data;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = (data[index + 3] ?? 0) / 255;
    if (alpha <= 0.05) continue;
    sumR += (data[index] ?? 0) * alpha;
    sumG += (data[index + 1] ?? 0) * alpha;
    sumB += (data[index + 2] ?? 0) * alpha;
    count += alpha;
  }
  if (count <= 0) return { r: 180, g: 180, b: 180 };
  return {
    r: sumR / count,
    g: sumG / count,
    b: sumB / count
  };
}

function extractScenePatchCanvas(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
): HTMLCanvasElement | null {
  const safeX = Math.max(0, Math.min(context.canvas.width - 1, Math.round(x)));
  const safeY = Math.max(0, Math.min(context.canvas.height - 1, Math.round(y)));
  const safeWidth = Math.max(1, Math.min(context.canvas.width - safeX, Math.round(width)));
  const safeHeight = Math.max(1, Math.min(context.canvas.height - safeY, Math.round(height)));
  const canvas = document.createElement("canvas");
  canvas.width = safeWidth;
  canvas.height = safeHeight;
  const patchContext = canvas.getContext("2d");
  if (!patchContext) return null;
  patchContext.drawImage(context.canvas, safeX, safeY, safeWidth, safeHeight, 0, 0, safeWidth, safeHeight);
  return canvas;
}

function buildIntegratedCharacterCanvas(
  cutout: HTMLCanvasElement,
  drawWidth: number,
  drawHeight: number,
  sceneTint: { r: number; g: number; b: number },
  scenePatch?: HTMLCanvasElement | null
): HTMLCanvasElement | null {
  const width = Math.max(1, Math.round(drawWidth));
  const height = Math.max(1, Math.round(drawHeight));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(cutout, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  let patchData: Uint8ClampedArray | null = null;
  let patchWidth = 0;
  let patchHeight = 0;
  if (scenePatch) {
    const patchCanvas = document.createElement("canvas");
    patchCanvas.width = width;
    patchCanvas.height = height;
    const patchContext = patchCanvas.getContext("2d");
    if (patchContext) {
      patchContext.drawImage(scenePatch, 0, 0, width, height);
      const patchImage = patchContext.getImageData(0, 0, width, height);
      patchData = patchImage.data;
      patchWidth = width;
      patchHeight = height;
    }
  }
  for (let index = 0; index < data.length; index += 4) {
    const alpha = (data[index + 3] ?? 0) / 255;
    if (alpha <= 0.01) continue;
    const pixel = index / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const verticalRatio = height <= 1 ? 0 : y / Math.max(1, height - 1);
    const floorBlend = verticalRatio <= 0.58 ? 0 : Math.min(1, (verticalRatio - 0.58) / 0.42);
    const edgeDistance = Math.min(x, y, Math.max(0, width - 1 - x), Math.max(0, height - 1 - y));
    const edgeBlend = edgeDistance >= 10 ? 0 : 1 - edgeDistance / 10;
    let patchR = sceneTint.r;
    let patchG = sceneTint.g;
    let patchB = sceneTint.b;
    if (patchData && patchWidth > 0 && patchHeight > 0) {
      const patchIndex = (Math.min(patchHeight - 1, y) * patchWidth + Math.min(patchWidth - 1, x)) * 4;
      patchR = patchData[patchIndex] ?? patchR;
      patchG = patchData[patchIndex + 1] ?? patchG;
      patchB = patchData[patchIndex + 2] ?? patchB;
    }
    const baseR = data[index] ?? 0;
    const baseG = data[index + 1] ?? 0;
    const baseB = data[index + 2] ?? 0;
    const patchLuma = patchR * 0.299 + patchG * 0.587 + patchB * 0.114;
    const baseLuma = baseR * 0.299 + baseG * 0.587 + baseB * 0.114;
    const brightnessScale = Math.max(0.88, Math.min(1.08, (patchLuma + 1) / Math.max(1, baseLuma + 1)));
    const sceneBlend = 0.06 + floorBlend * 0.08 + edgeBlend * 0.04;
    const litR = clampChannel(baseR * brightnessScale);
    const litG = clampChannel(baseG * brightnessScale);
    const litB = clampChannel(baseB * brightnessScale);
    data[index] = clampChannel(litR * (1 - sceneBlend) + patchR * sceneBlend);
    data[index + 1] = clampChannel(litG * (1 - sceneBlend) + patchG * sceneBlend);
    data[index + 2] = clampChannel(litB * (1 - sceneBlend) + patchB * sceneBlend);
    data[index + 3] = clampChannel((data[index + 3] ?? 255) * (1 - edgeBlend * 0.015));
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function averageOpaqueRegionColor(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fallback: { r: number; g: number; b: number }
): { r: number; g: number; b: number } {
  const safeX = Math.max(0, Math.min(context.canvas.width - 1, Math.round(x)));
  const safeY = Math.max(0, Math.min(context.canvas.height - 1, Math.round(y)));
  const safeWidth = Math.max(1, Math.min(context.canvas.width - safeX, Math.round(width)));
  const safeHeight = Math.max(1, Math.min(context.canvas.height - safeY, Math.round(height)));
  const image = context.getImageData(safeX, safeY, safeWidth, safeHeight);
  const data = image.data;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = (data[index + 3] ?? 0) / 255;
    if (alpha <= 0.08) continue;
    sumR += (data[index] ?? 0) * alpha;
    sumG += (data[index + 1] ?? 0) * alpha;
    sumB += (data[index + 2] ?? 0) * alpha;
    count += alpha;
  }
  if (count <= 0) return fallback;
  return {
    r: sumR / count,
    g: sumG / count,
    b: sumB / count
  };
}

function colorToRgba(color: { r: number; g: number; b: number }, alpha: number): string {
  return `rgba(${clampChannel(color.r)}, ${clampChannel(color.g)}, ${clampChannel(color.b)}, ${Math.max(0, Math.min(1, alpha))})`;
}

function mixRgb(
  left: { r: number; g: number; b: number },
  right: { r: number; g: number; b: number },
  ratio: number
): { r: number; g: number; b: number } {
  const t = Math.max(0, Math.min(1, ratio));
  return {
    r: left.r * (1 - t) + right.r * t,
    g: left.g * (1 - t) + right.g * t,
    b: left.b * (1 - t) + right.b * t
  };
}

function offsetPoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  distance: number
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1e-5, Math.sqrt(dx * dx + dy * dy));
  return {
    x: from.x + (dx / length) * distance,
    y: from.y + (dy / length) * distance
  };
}

function drawTaperedLimb(
  context: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  startWidth: number,
  endWidth: number,
  color: { r: number; g: number; b: number }
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const nx = -dy / length;
  const ny = dx / length;
  const halfStart = startWidth / 2;
  const halfEnd = endWidth / 2;
  context.beginPath();
  context.moveTo(from.x + nx * halfStart, from.y + ny * halfStart);
  context.lineTo(from.x - nx * halfStart, from.y - ny * halfStart);
  context.lineTo(to.x - nx * halfEnd, to.y - ny * halfEnd);
  context.lineTo(to.x + nx * halfEnd, to.y + ny * halfEnd);
  context.closePath();
  context.fillStyle = colorToRgba(color, 0.98);
  context.fill();
}

function sampleStoryboardGuidePalette(cutout: HTMLCanvasElement) {
  const context = cutout.getContext("2d");
  if (!context) {
    return {
      hair: { r: 34, g: 34, b: 40 },
      skin: { r: 230, g: 205, b: 188 },
      upper: { r: 95, g: 110, b: 145 },
      lower: { r: 78, g: 82, b: 110 },
      accent: { r: 40, g: 40, b: 48 },
      shoes: { r: 30, g: 30, b: 34 },
      hasLongGarment: true
    };
  }
  const width = cutout.width;
  const height = cutout.height;
  const darkFallback = { r: 36, g: 36, b: 42 };
  const upperFallback = { r: 100, g: 116, b: 150 };
  const lowerFallback = { r: 88, g: 94, b: 128 };
  const skinFallback = { r: 228, g: 204, b: 190 };
  const hair = averageOpaqueRegionColor(context, width * 0.28, height * 0.02, width * 0.44, height * 0.16, darkFallback);
  const skin = averageOpaqueRegionColor(context, width * 0.34, height * 0.1, width * 0.32, height * 0.16, skinFallback);
  const upper = averageOpaqueRegionColor(context, width * 0.24, height * 0.22, width * 0.52, height * 0.28, upperFallback);
  const lower = averageOpaqueRegionColor(context, width * 0.22, height * 0.5, width * 0.56, height * 0.28, lowerFallback);
  const accent = averageOpaqueRegionColor(context, width * 0.38, height * 0.42, width * 0.24, height * 0.12, darkFallback);
  const shoes = averageOpaqueRegionColor(context, width * 0.28, height * 0.86, width * 0.44, height * 0.12, darkFallback);
  const centerLower = context.getImageData(
    Math.max(0, Math.round(width * 0.42)),
    Math.max(0, Math.round(height * 0.58)),
    Math.max(1, Math.round(width * 0.16)),
    Math.max(1, Math.round(height * 0.24))
  );
  let opaqueCount = 0;
  for (let index = 0; index < centerLower.data.length; index += 4) {
    if ((centerLower.data[index + 3] ?? 0) > 48) opaqueCount += 1;
  }
  const hasLongGarment = opaqueCount >= Math.max(12, centerLower.data.length / 20);
  return { hair, skin, upper, lower, accent, shoes, hasLongGarment };
}

function buildStoryboardGuideCharacterCanvas(
  cutout: HTMLCanvasElement,
  drawWidth: number,
  drawHeight: number,
  sceneTint: { r: number; g: number; b: number },
  scenePatch?: HTMLCanvasElement | null,
  action: StoryboardPoseAction = "stand",
  mirror = false
): HTMLCanvasElement | null {
  const width = Math.max(1, Math.round(drawWidth));
  const height = Math.max(1, Math.round(drawHeight));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.clearRect(0, 0, width, height);
  const baseIntegrated = buildIntegratedCharacterCanvas(cutout, width, height, sceneTint, scenePatch);
  if (baseIntegrated) {
    context.save();
    context.globalAlpha = 0.9;
    context.filter = "blur(0.4px)";
    context.drawImage(baseIntegrated, 0, 0, width, height);
    context.restore();
  }
  const palette = sampleStoryboardGuidePalette(cutout);
  const patchInfluence = scenePatch
    ? sampleSceneRegionColor(
        (() => {
          const patchCanvas = document.createElement("canvas");
          patchCanvas.width = width;
          patchCanvas.height = height;
          const patchContext = patchCanvas.getContext("2d");
          if (patchContext) patchContext.drawImage(scenePatch, 0, 0, width, height);
          return patchContext ?? context;
        })(),
        width * 0.3,
        height * 0.28,
        width * 0.4,
        height * 0.54
      )
    : sceneTint;
  const tonedUpper = mixRgb(palette.upper, patchInfluence, 0.08);
  const tonedLower = mixRgb(palette.lower, patchInfluence, 0.1);
  const tonedHair = mixRgb(palette.hair, patchInfluence, 0.04);
  const tonedSkin = mixRgb(palette.skin, patchInfluence, 0.05);
  const tonedAccent = mixRgb(palette.accent, patchInfluence, 0.06);
  const tonedShoes = mixRgb(palette.shoes, patchInfluence, 0.04);

  const geometry = computeStoryboardPoseFigureGeometry(width / 2, height * 0.95, height * 0.92, action, mirror);
  const shadowCenterX = (geometry.leftAnkle.x + geometry.rightAnkle.x) / 2;
  const shadowCenterY = Math.max(geometry.leftAnkle.y, geometry.rightAnkle.y) + height * 0.02;
  const shoulderWidth = Math.abs(geometry.rightShoulder.x - geometry.leftShoulder.x);
  const hipWidth = Math.abs(geometry.rightHip.x - geometry.leftHip.x);
  const armWidth = Math.max(10, shoulderWidth * 0.22);
  const legWidth = Math.max(11, hipWidth * 0.38);
  const headRadius = Math.max(10, shoulderWidth * 0.34);
  const waistY = geometry.pelvis.y - height * 0.035;
  const hemY = palette.hasLongGarment
    ? Math.min(height * 0.92, Math.max(geometry.leftKnee.y, geometry.rightKnee.y) + height * 0.06)
    : Math.min(height * 0.78, geometry.pelvis.y + height * 0.14);
  const bodyCenterX = (geometry.leftShoulder.x + geometry.rightShoulder.x + geometry.leftHip.x + geometry.rightHip.x) / 4;
  const torsoLeftX = bodyCenterX - shoulderWidth * 0.62;
  const torsoRightX = bodyCenterX + shoulderWidth * 0.62;
  const hemLeftX = bodyCenterX - shoulderWidth * (palette.hasLongGarment ? 0.92 : 0.48);
  const hemRightX = bodyCenterX + shoulderWidth * (palette.hasLongGarment ? 0.92 : 0.48);

  context.save();
  context.filter = "blur(8px)";
  context.fillStyle = colorToRgba(mixRgb(sceneTint, { r: 12, g: 12, b: 18 }, 0.48), 0.22);
  context.beginPath();
  context.ellipse(
    shadowCenterX,
    shadowCenterY,
    Math.max(16, shoulderWidth * 0.52),
    Math.max(7, shoulderWidth * 0.16),
    0,
    0,
    Math.PI * 2
  );
  context.fill();
  context.restore();

  context.save();
  context.globalAlpha = 0.26;
  context.filter = "blur(1px)";
  drawTaperedLimb(context, geometry.leftHip, geometry.leftKnee, legWidth, legWidth * 0.78, tonedLower);
  drawTaperedLimb(context, geometry.leftKnee, geometry.leftAnkle, legWidth * 0.78, legWidth * 0.62, tonedLower);
  drawTaperedLimb(context, geometry.rightHip, geometry.rightKnee, legWidth, legWidth * 0.78, tonedLower);
  drawTaperedLimb(context, geometry.rightKnee, geometry.rightAnkle, legWidth * 0.78, legWidth * 0.62, tonedLower);

  context.beginPath();
  context.moveTo(geometry.leftShoulder.x, geometry.leftShoulder.y);
  context.lineTo(geometry.rightShoulder.x, geometry.rightShoulder.y);
  context.lineTo(torsoRightX, waistY);
  context.lineTo(hemRightX, hemY);
  context.lineTo(hemLeftX, hemY);
  context.lineTo(torsoLeftX, waistY);
  context.closePath();
  const garmentGradient = context.createLinearGradient(bodyCenterX, geometry.leftShoulder.y, bodyCenterX, hemY);
  garmentGradient.addColorStop(0, colorToRgba(tonedUpper, 0.98));
  garmentGradient.addColorStop(1, colorToRgba(tonedLower, 0.98));
  context.fillStyle = garmentGradient;
  context.fill();

  if (palette.hasLongGarment) {
    context.strokeStyle = colorToRgba(mixRgb(tonedAccent, tonedLower, 0.4), 0.5);
    context.lineWidth = Math.max(2, shoulderWidth * 0.05);
    context.beginPath();
    context.moveTo(bodyCenterX, waistY + height * 0.03);
    context.lineTo(bodyCenterX + (mirror ? -1 : 1) * shoulderWidth * 0.1, hemY - height * 0.02);
    context.stroke();
  }

  context.fillStyle = colorToRgba(tonedAccent, 0.92);
  context.fillRect(
    bodyCenterX - shoulderWidth * 0.22,
    waistY - height * 0.022,
    shoulderWidth * 0.44,
    Math.max(5, height * 0.032)
  );

  drawTaperedLimb(context, geometry.leftShoulder, geometry.leftElbow, armWidth, armWidth * 0.84, tonedUpper);
  drawTaperedLimb(context, geometry.leftElbow, geometry.leftWrist, armWidth * 0.82, armWidth * 0.64, tonedUpper);
  drawTaperedLimb(context, geometry.rightShoulder, geometry.rightElbow, armWidth, armWidth * 0.84, tonedUpper);
  drawTaperedLimb(context, geometry.rightElbow, geometry.rightWrist, armWidth * 0.82, armWidth * 0.64, tonedUpper);

  context.fillStyle = colorToRgba(tonedSkin, 0.86);
  context.beginPath();
  context.arc(geometry.head.x, geometry.head.y, headRadius, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(geometry.leftWrist.x, geometry.leftWrist.y, Math.max(4, armWidth * 0.26), 0, Math.PI * 2);
  context.arc(geometry.rightWrist.x, geometry.rightWrist.y, Math.max(4, armWidth * 0.26), 0, Math.PI * 2);
  context.fill();

  context.fillStyle = colorToRgba(tonedHair, 0.82);
  context.beginPath();
  context.arc(geometry.head.x, geometry.head.y - headRadius * 0.08, headRadius * 1.03, Math.PI, Math.PI * 2);
  context.lineTo(geometry.head.x + headRadius * 0.88, geometry.head.y + headRadius * 0.24);
  context.quadraticCurveTo(
    geometry.head.x,
    geometry.head.y - headRadius * 0.24,
    geometry.head.x - headRadius * 0.92,
    geometry.head.y + headRadius * 0.3
  );
  context.closePath();
  context.fill();
  context.fillRect(
    geometry.head.x - headRadius * 0.92,
    geometry.head.y - headRadius * 0.12,
    headRadius * 1.84,
    headRadius * 0.3
  );

  context.fillStyle = colorToRgba(tonedShoes, 0.98);
  context.beginPath();
  context.ellipse(geometry.leftAnkle.x, geometry.leftAnkle.y + height * 0.012, legWidth * 0.34, legWidth * 0.16, 0, 0, Math.PI * 2);
  context.ellipse(geometry.rightAnkle.x, geometry.rightAnkle.y + height * 0.012, legWidth * 0.34, legWidth * 0.16, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  const integratedGuide = buildIntegratedCharacterCanvas(canvas, width, height, sceneTint, scenePatch);
  if (integratedGuide) {
    context.save();
    context.globalAlpha = 0.42;
    context.filter = "blur(0.6px)";
    context.drawImage(integratedGuide, 0, 0, width, height);
    context.restore();
  }

  return canvas;
}

async function buildStoryboardIdentityBoardReference(
  shot: Shot,
  refs: WeightedImageRef[],
  inputDir: string,
  assets: Asset[]
): Promise<WeightedImageRef | null> {
  if (!canProcessStoryboardReferenceImages()) return null;
  const selectedCharacters = (shot.characterRefs ?? [])
    .map((id) => assets.find((item) => item.id === id && item.type === "character"))
    .filter((item): item is Asset => Boolean(item))
    .slice(0, 2);
  if (selectedCharacters.length < 2) return null;

  const strips = (
    await Promise.all(
      selectedCharacters.map(async (asset) => {
        const preferredSource =
          asset.characterFrontPath?.trim() ||
          refs.find((item) => item.bucket === `character:${asset.id}` && item.role === "character_front")?.source?.trim() ||
          asset.filePath?.trim() ||
          refs.find((item) => item.bucket === `character:${asset.id}`)?.source?.trim() ||
          "";
        return await buildCharacterThreeViewStripCanvas(asset, preferredSource);
      })
    )
  ).filter((item): item is HTMLCanvasElement => Boolean(item));
  if (strips.length === 0) return null;

  const slotHeight = 420;
  const gap = 28;
  const padding = 28;
  const slotWidth = 420;
  const boardWidth = padding * 2 + slotWidth * strips.length + gap * Math.max(0, strips.length - 1);
  const boardHeight = slotHeight + padding * 2;
  const canvas = document.createElement("canvas");
  canvas.width = boardWidth;
  canvas.height = boardHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "rgb(244, 241, 236)";
  context.fillRect(0, 0, boardWidth, boardHeight);

  strips.forEach((strip, index) => {
    const scale = Math.min(slotWidth / Math.max(1, strip.width), slotHeight / Math.max(1, strip.height));
    const drawWidth = Math.round(strip.width * scale);
    const drawHeight = Math.round(strip.height * scale);
    const slotX = padding + index * (slotWidth + gap);
    const drawX = slotX + Math.round((slotWidth - drawWidth) / 2);
    const drawY = padding + Math.round((slotHeight - drawHeight) / 2);
    context.save();
    context.fillStyle = "rgba(0,0,0,0.04)";
    context.fillRect(slotX, padding, slotWidth, slotHeight);
    context.filter = "saturate(0.92) contrast(0.96) brightness(0.98)";
    context.drawImage(strip, drawX, drawY, drawWidth, drawHeight);
    context.restore();
  });

  const safeShotId = shot.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = `${inputDir}/shot_${safeShotId}_character_identity_board.png`;
  const result = await invokeDesktopCommand<{ filePath: string }>("write_base64_file", {
    filePath,
    base64Data: canvas.toDataURL("image/png").replace(/^data:[^,]+,/, "")
  });
  if (!result.filePath) return null;
  return {
    source: result.filePath,
    weight: 0.72,
    priority: 360,
    bucket: `scene_identity:${shot.id}`,
    label: "character_identity_board",
    role: "continuity_character"
  };
}

async function buildCharacterThreeViewStripCanvas(
  asset: Asset,
  fallbackSource = ""
): Promise<HTMLCanvasElement | null> {
  const sources = [
    asset.characterFrontPath?.trim() || asset.filePath?.trim() || fallbackSource.trim(),
    asset.characterSidePath?.trim() || "",
    asset.characterBackPath?.trim() || ""
  ];
  const cutouts = (
    await Promise.all(
      sources.map(async (source) => {
        if (!source) return null;
        return await buildCharacterCutoutCanvas(source);
      })
    )
  ).filter((item): item is HTMLCanvasElement => Boolean(item));
  if (cutouts.length === 0) return null;

  const slotWidth = 180;
  const slotHeight = 320;
  const gap = 12;
  const padding = 16;
  const canvas = document.createElement("canvas");
  canvas.width = padding * 2 + slotWidth * cutouts.length + gap * Math.max(0, cutouts.length - 1);
  canvas.height = padding * 2 + slotHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "rgb(244, 241, 236)";
  context.fillRect(0, 0, canvas.width, canvas.height);

  cutouts.forEach((cutout, index) => {
    const scale = Math.min(slotWidth / Math.max(1, cutout.width), slotHeight / Math.max(1, cutout.height));
    const drawWidth = Math.round(cutout.width * scale);
    const drawHeight = Math.round(cutout.height * scale);
    const slotX = padding + index * (slotWidth + gap);
    const drawX = slotX + Math.round((slotWidth - drawWidth) / 2);
    const drawY = padding + Math.round((slotHeight - drawHeight) / 2);
    context.save();
    context.fillStyle = "rgba(0,0,0,0.04)";
    context.fillRect(slotX, padding, slotWidth, slotHeight);
    context.filter = "saturate(0.94) contrast(0.97) brightness(0.99)";
    context.drawImage(cutout, drawX, drawY, drawWidth, drawHeight);
    context.restore();
  });

  return canvas;
}

async function buildCharacterThreeViewTokenCanvas(
  settings: ComfySettings,
  sources: string[]
): Promise<HTMLCanvasElement | null> {
  if (!canProcessStoryboardReferenceImages()) return null;
  const cutouts = (
    await Promise.all(
      sources
        .map((source) => resolveInputTokenSourcePath(settings, source))
        .filter((source) => source.trim().length > 0)
        .map(async (source) => await buildCharacterCutoutCanvas(source))
    )
  ).filter((item): item is HTMLCanvasElement => Boolean(item));
  if (cutouts.length === 0) return null;

  const canvasSize = 1024;
  const padding = 48;
  const gap = 24;
  const slotWidth = Math.floor((canvasSize - padding * 2 - gap * 2) / 3);
  const slotHeight = canvasSize - padding * 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "rgb(244, 241, 236)";
  context.fillRect(0, 0, canvasSize, canvasSize);

  for (let index = 0; index < 3; index += 1) {
    const cutout = cutouts[index] ?? cutouts[cutouts.length - 1];
    if (!cutout) continue;
    const scale = Math.min(slotWidth / Math.max(1, cutout.width), slotHeight / Math.max(1, cutout.height));
    const drawWidth = Math.round(cutout.width * scale);
    const drawHeight = Math.round(cutout.height * scale);
    const slotX = padding + index * (slotWidth + gap);
    const drawX = slotX + Math.round((slotWidth - drawWidth) / 2);
    const drawY = padding + Math.round((slotHeight - drawHeight) / 2);
    context.save();
    context.fillStyle = "rgba(0,0,0,0.035)";
    context.fillRect(slotX, padding, slotWidth, slotHeight);
    context.filter = "saturate(0.94) contrast(0.97) brightness(0.99)";
    context.drawImage(cutout, drawX, drawY, drawWidth, drawHeight);
    context.restore();
  }

  return canvas;
}

async function stageStoryboardThreeViewTokens(
  settings: ComfySettings,
  shot: Shot,
  tokens: Record<string, string>
): Promise<Record<string, string>> {
  void settings;
  void shot;
  // Mature storyboard stills must keep CHAR*_PRIMARY_PATH bound to a clean
  // single-view identity anchor. Replacing it with a stitched three-view board
  // weakens IPAdapter identity lock and makes the model treat the reference as
  // a layout/style hint instead of "this exact person must be in frame".
  return tokens;
}

type StoryboardPoseAction =
  | "stand"
  | "walk"
  | "gesture"
  | "gesture_left"
  | "stop"
  | "stop_left"
  | "nod"
  | "lean"
  | "reach_down"
  | "reach_down_left"
  | "look";

type StoryboardPoseFigureGeometry = {
  head: { x: number; y: number };
  neck: { x: number; y: number };
  pelvis: { x: number; y: number };
  leftShoulder: { x: number; y: number };
  rightShoulder: { x: number; y: number };
  leftHip: { x: number; y: number };
  rightHip: { x: number; y: number };
  leftElbow: { x: number; y: number };
  rightElbow: { x: number; y: number };
  leftWrist: { x: number; y: number };
  rightWrist: { x: number; y: number };
  leftKnee: { x: number; y: number };
  rightKnee: { x: number; y: number };
  leftAnkle: { x: number; y: number };
  rightAnkle: { x: number; y: number };
  jointRadius: number;
  limbWidth: number;
};

function inferStoryboardPoseAction(shot: Shot, characterName: string, isFocused: boolean): StoryboardPoseAction {
  const corpus = compactTextParts(shot.title, shot.storyPrompt, shot.notes, shot.dialogue, shot.videoPrompt, ...(shot.tags ?? [])).toLowerCase();
  const { contexts } = collectCharacterMentionContexts(shot, corpus, characterName);
  const localText = contexts.join(" ");
  const mentionsLeftHand = containsAnyKeyword(localText, ["左手", "left hand", "left arm"]);
  const mentionsRightHand = containsAnyKeyword(localText, ["右手", "right hand", "right arm"]);
  const mentionsReachDown = containsAnyKeyword(localText, [
    "lowering one hand",
    "lowering her hand",
    "lowering his hand",
    "lowering her left hand",
    "lowering his left hand",
    "lowering her right hand",
    "lowering his right hand",
    "向石边",
    "toward the stone edge",
    "toward the water",
    "探向水边",
    "探向石边",
    "reach down",
    "reaching down"
  ]);
  const mentionsGesture = containsAnyKeyword(localText, ["抬手", "举手", "伸手", "raise hand", "lift hand", "gesture", "extending"]);
  if (containsAnyKeyword(localText, ["走", "慢走", "前行", "walk", "walking", "step", "stepping"])) return "walk";
  if (containsAnyKeyword(localText, ["俯身", "弯腰", "bend", "lean forward", "leaning"]) || mentionsReachDown) {
    if (mentionsLeftHand && !mentionsRightHand) return "reach_down_left";
    if (mentionsRightHand && !mentionsLeftHand) return "reach_down";
    return "reach_down_left";
  }
  if (containsAnyKeyword(localText, ["停下", "停步", "stop", "halt"])) {
    return mentionsLeftHand && !mentionsRightHand ? "stop_left" : "stop";
  }
  if (containsAnyKeyword(localText, ["点头", "nod"])) return "nod";
  if (mentionsGesture) {
    if (mentionsLeftHand && !mentionsRightHand) return "gesture_left";
    return "gesture";
  }
  if (containsAnyKeyword(localText, ["lean toward", "leaning toward", "lean toward jiang lan", "lean toward shen yan", "lean in", "倾向", "靠近"])) return "lean";
  if (containsAnyKeyword(localText, ["回头", "转头", "看向", "look at", "look toward", "turn head", "turn back", "glance"])) {
    return isFocused ? (mentionsLeftHand ? "gesture_left" : "gesture") : "look";
  }
  if (isFocused && containsAnyKeyword(corpus, ["回应", "说话", "起话", "反应", "reply", "speak", "speaking", "reaction"])) {
    return mentionsLeftHand ? "gesture_left" : "gesture";
  }
  return "stand";
}

function drawStoryboardPoseLimb(
  context: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: string,
  width: number
) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  context.restore();
}

function drawStoryboardPoseJoint(
  context: CanvasRenderingContext2D,
  point: { x: number; y: number },
  color: string,
  radius: number
) {
  context.save();
  context.fillStyle = color;
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function computeStoryboardPoseFigureGeometry(
  centerX: number,
  floorY: number,
  bodyHeight: number,
  action: StoryboardPoseAction,
  mirror = false
): StoryboardPoseFigureGeometry {
  const dir = mirror ? -1 : 1;
  const headY = floorY - bodyHeight * 0.92;
  const neck = { x: centerX, y: floorY - bodyHeight * 0.78 };
  const pelvis = { x: centerX, y: floorY - bodyHeight * 0.42 };
  const shoulderOffset = bodyHeight * 0.11;
  const hipOffset = bodyHeight * 0.075;
  const elbowDrop = bodyHeight * 0.18;
  const wristDrop = bodyHeight * 0.16;
  const kneeDrop = bodyHeight * 0.23;
  const ankleDrop = bodyHeight * 0.24;
  const jointRadius = Math.max(3, Math.round(bodyHeight * 0.025));
  const limbWidth = Math.max(4, Math.round(bodyHeight * 0.026));
  const leftShoulder = { x: neck.x - shoulderOffset, y: neck.y + bodyHeight * 0.02 };
  const rightShoulder = { x: neck.x + shoulderOffset, y: neck.y + bodyHeight * 0.02 };
  const leftHip = { x: pelvis.x - hipOffset, y: pelvis.y };
  const rightHip = { x: pelvis.x + hipOffset, y: pelvis.y };
  let leftElbow = { x: leftShoulder.x - shoulderOffset * 0.45, y: leftShoulder.y + elbowDrop };
  let rightElbow = { x: rightShoulder.x + shoulderOffset * 0.45, y: rightShoulder.y + elbowDrop };
  let leftWrist = { x: leftElbow.x - shoulderOffset * 0.4, y: leftElbow.y + wristDrop };
  let rightWrist = { x: rightElbow.x + shoulderOffset * 0.4, y: rightElbow.y + wristDrop };
  let leftKnee = { x: leftHip.x - hipOffset * 0.12, y: leftHip.y + kneeDrop };
  let rightKnee = { x: rightHip.x + hipOffset * 0.12, y: rightHip.y + kneeDrop };
  let leftAnkle = { x: leftKnee.x - hipOffset * 0.08, y: leftKnee.y + ankleDrop };
  let rightAnkle = { x: rightKnee.x + hipOffset * 0.08, y: rightKnee.y + ankleDrop };
  let headX = centerX;
  let headTiltY = headY;

  if (action === "walk") {
    leftElbow = { x: leftShoulder.x - shoulderOffset * 0.15 * dir, y: leftShoulder.y + elbowDrop * 0.8 };
    rightElbow = { x: rightShoulder.x + shoulderOffset * 0.75 * dir, y: rightShoulder.y + elbowDrop * 0.78 };
    leftWrist = { x: leftElbow.x - shoulderOffset * 0.2 * dir, y: leftElbow.y + wristDrop * 0.82 };
    rightWrist = { x: rightElbow.x + shoulderOffset * 0.45 * dir, y: rightElbow.y + wristDrop * 0.72 };
    leftKnee = { x: leftHip.x + hipOffset * 0.7 * dir, y: leftHip.y + kneeDrop * 0.92 };
    rightKnee = { x: rightHip.x - hipOffset * 0.5 * dir, y: rightHip.y + kneeDrop * 1.02 };
    leftAnkle = { x: leftKnee.x + hipOffset * 0.85 * dir, y: leftKnee.y + ankleDrop * 0.9 };
    rightAnkle = { x: rightKnee.x - hipOffset * 0.55 * dir, y: rightKnee.y + ankleDrop * 1.02 };
    headX += shoulderOffset * 0.12 * dir;
  } else if (action === "gesture") {
    rightElbow = { x: rightShoulder.x + shoulderOffset * 0.85 * dir, y: rightShoulder.y + elbowDrop * 0.42 };
    rightWrist = { x: rightElbow.x + shoulderOffset * 0.48 * dir, y: rightElbow.y - wristDrop * 0.08 };
    leftElbow = { x: leftShoulder.x - shoulderOffset * 0.28 * dir, y: leftShoulder.y + elbowDrop * 0.96 };
    leftWrist = { x: leftElbow.x - shoulderOffset * 0.18 * dir, y: leftElbow.y + wristDrop * 0.82 };
    headX += shoulderOffset * 0.18 * dir;
  } else if (action === "gesture_left") {
    leftElbow = { x: leftShoulder.x - shoulderOffset * 0.85 * dir, y: leftShoulder.y + elbowDrop * 0.42 };
    leftWrist = { x: leftElbow.x - shoulderOffset * 0.48 * dir, y: leftElbow.y - wristDrop * 0.08 };
    rightElbow = { x: rightShoulder.x + shoulderOffset * 0.24 * dir, y: rightShoulder.y + elbowDrop * 0.96 };
    rightWrist = { x: rightElbow.x + shoulderOffset * 0.18 * dir, y: rightElbow.y + wristDrop * 0.82 };
    headX -= shoulderOffset * 0.14 * dir;
  } else if (action === "stop") {
    rightElbow = { x: rightShoulder.x + shoulderOffset * 0.7 * dir, y: rightShoulder.y + elbowDrop * 0.5 };
    rightWrist = { x: rightElbow.x + shoulderOffset * 0.3 * dir, y: rightElbow.y + wristDrop * 0.08 };
    leftKnee = { x: leftHip.x + hipOffset * 0.18 * dir, y: leftHip.y + kneeDrop };
    rightKnee = { x: rightHip.x - hipOffset * 0.12 * dir, y: rightHip.y + kneeDrop };
  } else if (action === "stop_left") {
    leftElbow = { x: leftShoulder.x - shoulderOffset * 0.7 * dir, y: leftShoulder.y + elbowDrop * 0.5 };
    leftWrist = { x: leftElbow.x - shoulderOffset * 0.3 * dir, y: leftElbow.y + wristDrop * 0.08 };
    leftKnee = { x: leftHip.x + hipOffset * 0.12 * dir, y: leftHip.y + kneeDrop };
    rightKnee = { x: rightHip.x - hipOffset * 0.18 * dir, y: rightHip.y + kneeDrop };
  } else if (action === "nod") {
    headTiltY += bodyHeight * 0.02;
  } else if (action === "lean") {
    headX += shoulderOffset * 0.5 * dir;
    headTiltY += bodyHeight * 0.02;
    leftShoulder.x += shoulderOffset * 0.3 * dir;
    rightShoulder.x += shoulderOffset * 0.3 * dir;
    pelvis.x += shoulderOffset * 0.18 * dir;
    leftElbow.x += shoulderOffset * 0.25 * dir;
    rightElbow.x += shoulderOffset * 0.25 * dir;
    leftWrist.x += shoulderOffset * 0.25 * dir;
    rightWrist.x += shoulderOffset * 0.25 * dir;
  } else if (action === "reach_down" || action === "reach_down_left") {
    const useLeft = action === "reach_down_left";
    headX += shoulderOffset * 0.54 * dir;
    headTiltY += bodyHeight * 0.032;
    leftShoulder.x += shoulderOffset * 0.26 * dir;
    rightShoulder.x += shoulderOffset * 0.26 * dir;
    pelvis.x += shoulderOffset * 0.16 * dir;
    if (useLeft) {
      leftElbow = { x: leftShoulder.x + shoulderOffset * 0.12 * dir, y: leftShoulder.y + elbowDrop * 1.18 };
      leftWrist = { x: leftElbow.x + shoulderOffset * 0.16 * dir, y: leftElbow.y + wristDrop * 1.08 };
      rightElbow = { x: rightShoulder.x + shoulderOffset * 0.24 * dir, y: rightShoulder.y + elbowDrop * 0.74 };
      rightWrist = { x: rightElbow.x + shoulderOffset * 0.18 * dir, y: rightElbow.y + wristDrop * 0.72 };
    } else {
      rightElbow = { x: rightShoulder.x + shoulderOffset * 0.12 * dir, y: rightShoulder.y + elbowDrop * 1.18 };
      rightWrist = { x: rightElbow.x + shoulderOffset * 0.16 * dir, y: rightElbow.y + wristDrop * 1.08 };
      leftElbow = { x: leftShoulder.x - shoulderOffset * 0.24 * dir, y: leftShoulder.y + elbowDrop * 0.74 };
      leftWrist = { x: leftElbow.x - shoulderOffset * 0.18 * dir, y: leftElbow.y + wristDrop * 0.72 };
    }
    leftKnee = { x: leftHip.x + hipOffset * 0.12 * dir, y: leftHip.y + kneeDrop * 0.98 };
    rightKnee = { x: rightHip.x - hipOffset * 0.06 * dir, y: rightHip.y + kneeDrop * 1.04 };
  } else if (action === "look") {
    headX += shoulderOffset * 0.22 * dir;
  }

  return {
    head: { x: headX, y: headTiltY },
    neck,
    pelvis,
    leftShoulder,
    rightShoulder,
    leftHip,
    rightHip,
    leftElbow,
    rightElbow,
    leftWrist,
    rightWrist,
    leftKnee,
    rightKnee,
    leftAnkle,
    rightAnkle,
    jointRadius,
    limbWidth
  };
}

function buildStoryboardPoseFigure(
  context: CanvasRenderingContext2D,
  centerX: number,
  floorY: number,
  bodyHeight: number,
  action: StoryboardPoseAction,
  mirror = false
) {
  const geometry = computeStoryboardPoseFigureGeometry(centerX, floorY, bodyHeight, action, mirror);
  const {
    head,
    neck,
    pelvis,
    leftShoulder,
    rightShoulder,
    leftHip,
    rightHip,
    leftElbow,
    rightElbow,
    leftWrist,
    rightWrist,
    leftKnee,
    rightKnee,
    leftAnkle,
    rightAnkle,
    jointRadius,
    limbWidth
  } = geometry;
  const torsoTop = { x: neck.x, y: neck.y };
  const torsoBottom = { x: pelvis.x, y: pelvis.y };
  const limbColors = ["#ff4444", "#ffbb33", "#ffee55", "#66cc66", "#33b5e5", "#9966ff"];

  drawStoryboardPoseLimb(context, head, neck, limbColors[0], limbWidth);
  drawStoryboardPoseLimb(context, torsoTop, torsoBottom, limbColors[1], limbWidth);
  drawStoryboardPoseLimb(context, leftShoulder, rightShoulder, limbColors[2], limbWidth);
  drawStoryboardPoseLimb(context, leftHip, rightHip, limbColors[2], limbWidth);
  drawStoryboardPoseLimb(context, leftShoulder, leftElbow, limbColors[3], limbWidth);
  drawStoryboardPoseLimb(context, leftElbow, leftWrist, limbColors[3], limbWidth);
  drawStoryboardPoseLimb(context, rightShoulder, rightElbow, limbColors[4], limbWidth);
  drawStoryboardPoseLimb(context, rightElbow, rightWrist, limbColors[4], limbWidth);
  drawStoryboardPoseLimb(context, leftHip, leftKnee, limbColors[5], limbWidth);
  drawStoryboardPoseLimb(context, leftKnee, leftAnkle, limbColors[5], limbWidth);
  drawStoryboardPoseLimb(context, rightHip, rightKnee, limbColors[0], limbWidth);
  drawStoryboardPoseLimb(context, rightKnee, rightAnkle, limbColors[0], limbWidth);

  for (const [point, color] of [
    [head, limbColors[0]],
    [neck, limbColors[1]],
    [leftShoulder, limbColors[3]],
    [rightShoulder, limbColors[4]],
    [pelvis, limbColors[1]],
    [leftElbow, limbColors[3]],
    [rightElbow, limbColors[4]],
    [leftWrist, limbColors[3]],
    [rightWrist, limbColors[4]],
    [leftHip, limbColors[5]],
    [rightHip, limbColors[0]],
    [leftKnee, limbColors[5]],
    [rightKnee, limbColors[0]],
    [leftAnkle, limbColors[5]],
    [rightAnkle, limbColors[0]]
  ] as const) {
    drawStoryboardPoseJoint(context, point, color, jointRadius);
  }
}

async function stageStoryboardPoseGuideToken(
  settings: ComfySettings,
  shot: Shot,
  tokens: Record<string, string>
): Promise<Record<string, string>> {
  if (!canProcessStoryboardReferenceImages()) return tokens;
  const inputDir = inferComfyInputDir(settings);
  if (!inputDir) return tokens;
  const characterNames = [String(tokens.CHAR1_NAME ?? "").trim(), String(tokens.CHAR2_NAME ?? "").trim()].filter((item) => item.length > 0);
  if (characterNames.length === 0) return tokens;

  const renderWidth = Math.max(512, Number.parseInt(String(tokens.RENDER_WIDTH ?? "1280"), 10) || 1280);
  const renderHeight = Math.max(512, Number.parseInt(String(tokens.RENDER_HEIGHT ?? "704"), 10) || 704);
  const canvas = document.createElement("canvas");
  canvas.width = renderWidth;
  canvas.height = renderHeight;
  const context = canvas.getContext("2d");
  if (!context) return tokens;
  context.fillStyle = "black";
  context.fillRect(0, 0, renderWidth, renderHeight);

  const refs = characterNames.map((name, index) => ({
    source: index === 0 ? String(tokens.CHAR1_PRIMARY_PATH ?? "") : String(tokens.CHAR2_PRIMARY_PATH ?? ""),
    weight: 1,
    priority: 1,
    bucket: `pose:${name}`,
    label: `${name}:front`,
    role: "character_front" as WeightedImageRef["role"]
  }));
  const placements = inferStoryboardCompositeLayout(shot, refs);
  const heightRatio = inferStoryboardCompositeHeightRatio(shot, characterNames.length);
  const focusCharacter = inferStoryboardFocusedCharacterName(shot, characterNames);

  characterNames.forEach((name, index) => {
    const placement = placements[index] ?? placements[placements.length - 1] ?? { centerXRatio: 0.5, floorYRatio: 0.9, sizeScale: 1 };
    const centerX = renderWidth * placement.centerXRatio;
    const floorY = renderHeight * placement.floorYRatio;
    const bodyHeight = renderHeight * heightRatio * placement.sizeScale * 0.92;
    const action = inferStoryboardPoseAction(shot, name, focusCharacter === name || (!focusCharacter && index === 0));
    buildStoryboardPoseFigure(context, centerX, floorY, bodyHeight, action, index % 2 === 1);
  });

  const safeShotId = shot.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = `${inputDir}/shot_${safeShotId}_pose_map.png`;
  const result = await invokeDesktopCommand<{ filePath: string }>("write_base64_file", {
    filePath,
    base64Data: canvas.toDataURL("image/png").replace(/^data:[^,]+,/, "")
  });
  if (!result.filePath) return tokens;
  return {
    ...tokens,
    POSE_GUIDE_PATH: result.filePath.split("/").pop() ?? result.filePath
  };
}

function inferStoryboardCompositeScaleFromCorpus(corpus: string): "wide" | "medium" | "close" | "default" {
  const isClose = containsAnyKeyword(corpus, ["近景", "特写", "中近景", "medium close", "close shot", "close-up"]);
  const isMedium = containsAnyKeyword(corpus, [
    "中景",
    "双人中景",
    "中近景",
    "medium shot",
    "medium two shot",
    "medium wide",
    "two shot",
    "two-shot",
    "reverse medium"
  ]);
  const isWide = containsAnyKeyword(corpus, ["远景", "大全景", "全景", "建立镜头", "wide shot", "establishing wide"]);
  if (isClose) return "close";
  if (isMedium) return "medium";
  if (isWide) return "wide";
  return "default";
}

function inferStoryboardCompositeScale(shot: Shot): "wide" | "medium" | "close" | "default" {
  const corpus = compactTextParts(shot.title, shot.storyPrompt, shot.notes, shot.dialogue, shot.tags).toLowerCase();
  return inferStoryboardCompositeScaleFromCorpus(corpus);
}

function inferStoryboardCompositeHeightRatio(shot: Shot, count: number): number {
  const scale = inferStoryboardCompositeScale(shot);
  if (count >= 2) {
    if (scale === "wide") return 0.38;
    if (scale === "close") return 0.54;
    if (scale === "medium") return 0.48;
    return 0.44;
  }
  if (scale === "wide") return 0.42;
  if (scale === "close") return 0.56;
  if (scale === "medium") return 0.5;
  return 0.46;
}

function extractCharacterNameFromReferenceLabel(label: string): string {
  return label.split(":")[0]?.trim() ?? "";
}

function extractStoryboardLatinCharacterAliases(text: string): string[] {
  const source = text.trim();
  if (!source) return [];
  const aliases: string[] = [];
  const seen = new Set<string>();
  const patterns = [
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s+is\s+a\b/g,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s+(?:standing|walking|remains|turns|steps|slows|leans|plants|quickens|bending|lowering|lifting|speaking)\b/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const alias = match[1]?.trim();
      if (!alias) continue;
      const key = alias.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      aliases.push(alias);
    }
  }
  return aliases;
}

function inferStoryboardCharacterMentionVariants(shot: Shot, name: string): string[] {
  const canonicalName = name.trim();
  if (!canonicalName) return [];
  const variants: string[] = [];
  const seen = new Set<string>();
  const pushVariant = (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    variants.push(normalized);
  };
  pushVariant(canonicalName);
  const orderedNames = uniquePreserveOrder([...(shot.sourceCharacterNames ?? []), canonicalName].map((item) => item.trim()).filter((item) => item.length > 0));
  const characterIndex = orderedNames.findIndex((item) => item.toLowerCase() === canonicalName.toLowerCase());
  if (characterIndex >= 0) {
    const aliasCandidates = extractStoryboardLatinCharacterAliases(compactTextParts(shot.storyPrompt, shot.videoPrompt));
    const alias = aliasCandidates[characterIndex];
    if (alias) {
      pushVariant(alias);
      pushVariant(alias.replace(/\s+/g, ""));
    }
  }
  return variants;
}

function collectCharacterMentionContexts(
  shot: Shot,
  corpus: string,
  name: string
): { contexts: string[]; usedFallback: boolean } {
  const text = corpus.toLowerCase();
  const variants = inferStoryboardCharacterMentionVariants(shot, name);
  if (variants.length === 0) return { contexts: [text], usedFallback: true };
  const contexts: string[] = [];
  const seenContexts = new Set<string>();
  for (const needle of variants) {
    let startIndex = 0;
    while (startIndex < text.length) {
      const matchIndex = text.indexOf(needle, startIndex);
      if (matchIndex < 0) break;
      const contextStart = Math.max(0, matchIndex - 96);
      const contextEnd = Math.min(text.length, matchIndex + needle.length + 96);
      const context = text.slice(contextStart, contextEnd);
      if (!seenContexts.has(context)) {
        seenContexts.add(context);
        contexts.push(context);
      }
      startIndex = matchIndex + needle.length;
    }
  }
  return contexts.length > 0 ? { contexts, usedFallback: false } : { contexts: [text], usedFallback: true };
}

function corpusHasAnyKeyword(corpus: string, keywords: string[]): boolean {
  return keywords.some((keyword) => corpus.includes(keyword));
}

function contextsHaveAnyKeyword(contexts: string[], keywords: string[]): boolean {
  return contexts.some((context) => containsAnyKeyword(context, keywords));
}

function inferStoryboardFocusedCharacterName(
  shot: Shot,
  availableNames: string[]
): string | null {
  if (availableNames.length === 0) return null;
  const title = (shot.title ?? "").toLowerCase();
  const dialogue = (shot.dialogue ?? "").toLowerCase();
  const notes = (shot.notes ?? "").toLowerCase();
  const prompt = compactTextParts(shot.storyPrompt, shot.videoPrompt, ...(shot.tags ?? [])).toLowerCase();
  let bestName = "";
  let bestScore = 0;
  let tie = false;
  for (const rawName of availableNames) {
    const name = rawName.trim();
    if (!name) continue;
    let score = 0;
    const variants = inferStoryboardCharacterMentionVariants(shot, name);
    if (variants.some((needle) => title.includes(needle))) score += 4;
    if (variants.some((needle) => dialogue.includes(needle))) score += 3;
    if (variants.some((needle) => notes.includes(needle))) score += 2;
    if (variants.some((needle) => prompt.includes(needle))) score += 1;
    if (score <= 0) continue;
    if (score > bestScore) {
      bestName = name;
      bestScore = score;
      tie = false;
    } else if (score === bestScore) {
      tie = true;
    }
  }
  if (!bestName || tie) return null;
  return bestName;
}

function applyClampedPlacement(
  base: { centerXRatio: number; floorYRatio: number; sizeScale: number },
  patch: Partial<{ centerXRatio: number; floorYRatio: number; sizeScale: number }>
): { centerXRatio: number; floorYRatio: number; sizeScale: number } {
  return {
    centerXRatio: Math.min(0.9, Math.max(0.1, patch.centerXRatio ?? base.centerXRatio)),
    floorYRatio: Math.min(0.95, Math.max(0.74, patch.floorYRatio ?? base.floorYRatio)),
    sizeScale: Math.min(1.12, Math.max(0.52, patch.sizeScale ?? base.sizeScale))
  };
}

function contextsHavePathRelativeCue(contexts: string[], side: "left" | "right"): boolean {
  const keywords =
    side === "left"
      ? [
          "left side of the stone path",
          "left side of the riverside stone path",
          "left side of the same stone path",
          "left side of the path",
          "左侧的石路",
          "石路左侧",
          "沿河石路左侧",
          "河边石路左侧",
          "路径左侧",
          "路的左侧"
        ]
      : [
          "right side of the stone path",
          "right side of the riverside stone path",
          "right side of the same stone path",
          "right side of the path",
          "右侧的石路",
          "石路右侧",
          "沿河石路右侧",
          "河边石路右侧",
          "路径右侧",
          "路的右侧"
        ];
  return contextsHaveAnyKeyword(contexts, keywords);
}

function inferStoryboardCharacterPlacement(
  shot: Shot,
  characterName: string,
  fallback: { centerXRatio: number; floorYRatio: number; sizeScale: number },
  index: number,
  count: number,
  focusedCharacterName: string | null = null
): { centerXRatio: number; floorYRatio: number; sizeScale: number } {
  const corpus = compactTextParts(shot.title, shot.storyPrompt, shot.notes, shot.dialogue, shot.videoPrompt, ...(shot.tags ?? []));
  const mentionData = collectCharacterMentionContexts(shot, corpus, characterName);
  const contexts = mentionData.contexts;
  const lowerCorpus = corpus.toLowerCase();
  const lowerName = characterName.toLowerCase();
  const scale = inferStoryboardCompositeScale(shot);
  const isFocused = Boolean(focusedCharacterName && focusedCharacterName === characterName);
  const isWideWalk = containsAnyKeyword(lowerCorpus, ["并肩", "walk", "walking", "side by side", "along the same riverside path"]);
  let hasPathRelativeLeftCue = contextsHavePathRelativeCue(contexts, "left");
  let hasPathRelativeRightCue = contextsHavePathRelativeCue(contexts, "right");
  if (mentionData.usedFallback && hasPathRelativeLeftCue && hasPathRelativeRightCue && count >= 2) {
    hasPathRelativeLeftCue = index === 0;
    hasPathRelativeRightCue = index === 1;
  }
  const hasPathRelativeLaneCue = hasPathRelativeLeftCue || hasPathRelativeRightCue;
  const hasExplicitHorizontalCue = contextsHaveAnyKeyword(contexts, [
    "left edge",
    "screen left edge",
    "画面左边缘",
    "左边缘",
    "screen left",
    "left half",
    "画面左",
    "左半",
    "左侧",
    "左边",
    "屏幕左",
    "center-left",
    "centre-left",
    "screen center-left",
    "画面中左",
    "偏左",
    "左中",
    "right edge",
    "screen right edge",
    "画面右边缘",
    "右边缘",
    "screen right",
    "right half",
    "画面右",
    "右半",
    "右侧",
    "右边",
    "屏幕右",
    "center-right",
    "centre-right",
    "screen center-right",
    "画面中右",
    "偏右",
    "右中",
    "center",
    "centre",
    "中间",
    "居中"
  ]) && !hasPathRelativeLaneCue;

  let placement = { ...fallback };

  if (contextsHaveAnyKeyword(contexts, ["left edge", "screen left edge", "画面左边缘", "左边缘"])) {
    placement = applyClampedPlacement(placement, {
      centerXRatio: 0.18,
      sizeScale: placement.sizeScale * 1.05
    });
  } else if (contextsHaveAnyKeyword(contexts, ["screen left", "left half", "画面左", "左半", "左侧", "左边", "屏幕左"])) {
    placement = applyClampedPlacement(placement, {
      centerXRatio: count >= 2 ? 0.34 : 0.42
    });
  } else if (contextsHaveAnyKeyword(contexts, ["center-left", "centre-left", "screen center-left", "画面中左", "偏左", "左中"])) {
    placement = applyClampedPlacement(placement, {
      centerXRatio: count >= 2 ? 0.42 : 0.46
    });
  } else if (contextsHaveAnyKeyword(contexts, ["right edge", "screen right edge", "画面右边缘", "右边缘"])) {
    placement = applyClampedPlacement(placement, {
      centerXRatio: 0.82,
      sizeScale: placement.sizeScale * 1.05
    });
  } else if (contextsHaveAnyKeyword(contexts, ["screen right", "right half", "画面右", "右半", "右侧", "右边", "屏幕右"])) {
    placement = applyClampedPlacement(placement, {
      centerXRatio: count >= 2 ? 0.66 : 0.58
    });
  } else if (contextsHaveAnyKeyword(contexts, ["center-right", "centre-right", "screen center-right", "画面中右", "偏右", "右中"])) {
    placement = applyClampedPlacement(placement, {
      centerXRatio: count >= 2 ? 0.58 : 0.54
    });
  } else if (contextsHaveAnyKeyword(contexts, ["center", "centre", "中间", "居中"])) {
    placement = applyClampedPlacement(placement, {
      centerXRatio: 0.5
    });
  }

  if (contextsHaveAnyKeyword(contexts, ["foreground shoulder", "前景肩", "foreground silhouette", "前景边缘提示", "blurred foreground shoulder"])) {
    placement = applyClampedPlacement(placement, {
      sizeScale: placement.sizeScale * 1.14,
      floorYRatio: placement.floorYRatio + 0.02
    });
    if (placement.centerXRatio <= 0.5) {
      placement = applyClampedPlacement(placement, { centerXRatio: 0.13 });
    } else {
      placement = applyClampedPlacement(placement, { centerXRatio: 0.87 });
    }
  }

  if (contextsHaveAnyKeyword(contexts, [
    "slightly in front",
    "前面",
    "在前",
    "前景",
    "主位",
    "占主体",
    "主体",
    "focus on",
    "focused on"
  ]) || isFocused) {
    placement = applyClampedPlacement(placement, {
      floorYRatio: placement.floorYRatio + 0.015,
      sizeScale: placement.sizeScale * 1.08
    });
  }

  if (contextsHaveAnyKeyword(contexts, [
    "half step behind",
    "slightly behind",
    "在后",
    "后方",
    "背景人物",
    "secondary figure",
    "smaller on screen",
    "次要人物",
    "更小"
  ])) {
    placement = applyClampedPlacement(placement, {
      floorYRatio: placement.floorYRatio - 0.02,
      sizeScale: placement.sizeScale * 0.84
    });
  }

  if (isWideWalk && count >= 2) {
    placement = applyClampedPlacement(placement, {
      centerXRatio: hasExplicitHorizontalCue ? placement.centerXRatio : index === 0 ? 0.4 : 0.66,
      floorYRatio: 0.91,
      sizeScale: placement.sizeScale * 1.08
    });
  }

  if (contextsHaveAnyKeyword(contexts, ["waterline", "岸边", "石路", "stone path", "沿河石路"])) {
    placement = applyClampedPlacement(placement, {
      floorYRatio: Math.min(0.92, placement.floorYRatio)
    });
  }

  const isRiversidePathShot = containsAnyKeyword(lowerCorpus, [
    "河边",
    "河岸",
    "riverside",
    "riverbank",
    "stone path",
    "沿河石路",
    "桥边"
  ]);
  if (isRiversidePathShot) {
    if (hasPathRelativeLaneCue) {
      const lanePreset =
        scale === "close"
          ? {
              leftLaneX: 0.72,
              rightLaneX: 0.83,
              leftFloorY: 0.9,
              rightFloorY: 0.885,
              leftSize: 0.96,
              rightSize: 0.9
            }
          : scale === "medium"
            ? {
                leftLaneX: 0.7,
                rightLaneX: 0.81,
                leftFloorY: 0.905,
                rightFloorY: 0.89,
                leftSize: 0.9,
                rightSize: 0.84
              }
            : {
                leftLaneX: 0.68,
                rightLaneX: 0.78,
                leftFloorY: 0.91,
                rightFloorY: 0.895,
                leftSize: 0.84,
                rightSize: 0.78
              };
      placement = applyClampedPlacement(placement, {
        centerXRatio: hasPathRelativeLeftCue ? lanePreset.leftLaneX : lanePreset.rightLaneX,
        floorYRatio: hasPathRelativeLeftCue ? lanePreset.leftFloorY : lanePreset.rightFloorY,
        sizeScale: Math.max(
          placement.sizeScale,
          hasPathRelativeLeftCue ? lanePreset.leftSize : lanePreset.rightSize
        )
      });
    }
    if (count >= 2) {
      placement = applyClampedPlacement(placement, {
        // Keep both actors inside the lower-right walkable band instead of
        // pushing them into the upper willow canopy or open water.
        centerXRatio: hasExplicitHorizontalCue || hasPathRelativeLaneCue ? placement.centerXRatio : index === 0 ? 0.64 : 0.78,
        floorYRatio: hasPathRelativeLaneCue ? placement.floorYRatio : index === 0 ? 0.915 : 0.9,
        sizeScale: hasPathRelativeLaneCue
          ? placement.sizeScale
          : placement.sizeScale * (index === 0 ? 0.98 : 0.92)
      });
    } else {
      placement = applyClampedPlacement(placement, {
        centerXRatio: hasExplicitHorizontalCue ? placement.centerXRatio : 0.68,
        floorYRatio: 0.92,
        sizeScale: placement.sizeScale * 0.92
      });
    }
  }

  if (
    characterName &&
    lowerCorpus.includes(lowerName) &&
    !contextsHaveAnyKeyword(contexts, ["left", "right", "左", "右", "中间", "center"]) &&
    count === 2
  ) {
    placement = applyClampedPlacement(placement, {
      centerXRatio: index === 0 ? 0.4 : 0.62
    });
  }

  return placement;
}

function stabilizeStoryboardPairPlacements(
  shot: Shot,
  characterNames: string[],
  placements: Array<{ centerXRatio: number; floorYRatio: number; sizeScale: number }>,
  focusedCharacterName: string | null
): Array<{ centerXRatio: number; floorYRatio: number; sizeScale: number }> {
  if (placements.length < 2) return placements;
  const corpus = compactTextParts(shot.title, shot.storyPrompt, shot.notes, shot.dialogue, shot.videoPrompt, ...(shot.tags ?? [])).toLowerCase();
  const scale = inferStoryboardCompositeScale(shot);
  const isRiversidePathShot = containsAnyKeyword(corpus, [
    "河边",
    "河岸",
    "riverside",
    "riverbank",
    "stone path",
    "沿河石路",
    "桥边"
  ]);
  const desiredFocusedSide = containsAnyKeyword(corpus, [
    "main subject at center-right",
    "main subject at screen right",
    "main subject on the right side",
    "主体在画面右",
    "主体在右侧",
    "主体在中右",
    "center-right"
  ])
    ? "right"
    : containsAnyKeyword(corpus, [
        "main subject at center-left",
        "main subject at screen left",
        "main subject on the left side",
        "主体在画面左",
        "主体在左侧",
        "主体在中左",
        "center-left"
      ])
      ? "left"
      : null;

  let leftIndex = 0;
  let rightIndex = 1;
  if (focusedCharacterName) {
    const focusIndex = characterNames.findIndex((name) => name === focusedCharacterName);
    if (focusIndex >= 0 && focusIndex < 2 && desiredFocusedSide) {
      if (desiredFocusedSide === "left") {
        leftIndex = focusIndex;
        rightIndex = focusIndex === 0 ? 1 : 0;
      } else {
        rightIndex = focusIndex;
        leftIndex = focusIndex === 0 ? 1 : 0;
      }
    }
  }

  const stabilized = placements.map((item) => ({ ...item }));
  const currentSeparation = Math.abs(stabilized[0]!.centerXRatio - stabilized[1]!.centerXRatio);

  if (isRiversidePathShot) {
    const riversidePreset =
      scale === "close"
        ? {
            left: { centerXRatio: 0.64, floorYRatio: 0.91, sizeScale: 0.96 },
            right: { centerXRatio: 0.77, floorYRatio: 0.895, sizeScale: 0.88 }
          }
        : scale === "medium"
          ? {
              left: { centerXRatio: 0.66, floorYRatio: 0.915, sizeScale: 0.9 },
              right: { centerXRatio: 0.79, floorYRatio: 0.9, sizeScale: 0.84 }
            }
          : {
              left: { centerXRatio: 0.68, floorYRatio: 0.92, sizeScale: 0.82 },
              right: { centerXRatio: 0.8, floorYRatio: 0.905, sizeScale: 0.76 }
            };
    stabilized[leftIndex] = applyClampedPlacement(stabilized[leftIndex]!, {
      centerXRatio: riversidePreset.left.centerXRatio,
      floorYRatio: Math.max(stabilized[leftIndex]!.floorYRatio, riversidePreset.left.floorYRatio),
      sizeScale: Math.max(stabilized[leftIndex]!.sizeScale, riversidePreset.left.sizeScale)
    });
    stabilized[rightIndex] = applyClampedPlacement(stabilized[rightIndex]!, {
      centerXRatio: riversidePreset.right.centerXRatio,
      floorYRatio: Math.max(stabilized[rightIndex]!.floorYRatio, riversidePreset.right.floorYRatio),
      sizeScale: Math.max(stabilized[rightIndex]!.sizeScale, riversidePreset.right.sizeScale)
    });
  } else if (currentSeparation < 0.12) {
    const spreadPreset =
      scale === "close"
        ? [0.42, 0.62]
        : scale === "medium"
          ? [0.4, 0.62]
          : [0.38, 0.6];
    stabilized[leftIndex] = applyClampedPlacement(stabilized[leftIndex]!, {
      centerXRatio: spreadPreset[0],
      floorYRatio: Math.max(0.88, stabilized[leftIndex]!.floorYRatio)
    });
    stabilized[rightIndex] = applyClampedPlacement(stabilized[rightIndex]!, {
      centerXRatio: spreadPreset[1],
      floorYRatio: Math.max(0.88, stabilized[rightIndex]!.floorYRatio)
    });
  }

  if (Math.abs(stabilized[0]!.centerXRatio - stabilized[1]!.centerXRatio) < 0.1) {
    stabilized[leftIndex] = applyClampedPlacement(stabilized[leftIndex]!, {
      centerXRatio: stabilized[leftIndex]!.centerXRatio - 0.08
    });
    stabilized[rightIndex] = applyClampedPlacement(stabilized[rightIndex]!, {
      centerXRatio: stabilized[rightIndex]!.centerXRatio + 0.08
    });
  }

  return stabilized;
}

function inferStoryboardCompositeLayout(
  shot: Shot,
  characterRefs: WeightedImageRef[]
): Array<{ centerXRatio: number; floorYRatio: number; sizeScale: number }> {
  const count = characterRefs.length;
  const scale = inferStoryboardCompositeScale(shot);
  const availableNames = characterRefs.map((ref) => extractCharacterNameFromReferenceLabel(ref.label)).filter((name) => name.length > 0);
  const focusedCharacterName = inferStoryboardFocusedCharacterName(shot, availableNames);

  if (count >= 2) {
    const buildPairPlacements = (
      basePlacements: Array<{ centerXRatio: number; floorYRatio: number; sizeScale: number }>
    ) =>
      stabilizeStoryboardPairPlacements(
        shot,
        availableNames,
        characterRefs.map((ref, index) =>
          inferStoryboardCharacterPlacement(
            shot,
            extractCharacterNameFromReferenceLabel(ref.label),
            basePlacements[index] ?? basePlacements[basePlacements.length - 1]!,
            index,
            count,
            focusedCharacterName
          )
        ),
        focusedCharacterName
      );
    if (scale === "wide") {
      const wideBase = [
        { centerXRatio: 0.44, floorYRatio: 0.91, sizeScale: 0.78 },
        { centerXRatio: 0.66, floorYRatio: 0.92, sizeScale: 0.72 }
      ];
      return buildPairPlacements(wideBase);
    }
    if (scale === "close") {
      const closeBase = [
        { centerXRatio: 0.46, floorYRatio: 0.91, sizeScale: 0.9 },
        { centerXRatio: 0.66, floorYRatio: 0.93, sizeScale: 0.82 }
      ];
      return buildPairPlacements(closeBase);
    }
    if (scale === "medium") {
      const mediumBase = [
        { centerXRatio: 0.46, floorYRatio: 0.91, sizeScale: 0.82 },
        { centerXRatio: 0.66, floorYRatio: 0.93, sizeScale: 0.76 }
      ];
      return buildPairPlacements(mediumBase);
    }
    const defaultBase = [
      { centerXRatio: 0.46, floorYRatio: 0.9, sizeScale: 0.8 },
      { centerXRatio: 0.66, floorYRatio: 0.92, sizeScale: 0.74 }
    ];
    return buildPairPlacements(defaultBase);
  }

  const fallbackName = characterRefs[0] ? extractCharacterNameFromReferenceLabel(characterRefs[0].label) : "";
  if (scale === "close") {
    return [inferStoryboardCharacterPlacement(shot, fallbackName, { centerXRatio: 0.62, floorYRatio: 0.9, sizeScale: 1.0 }, 0, 1, focusedCharacterName)];
  }
  if (scale === "medium") {
    return [inferStoryboardCharacterPlacement(shot, fallbackName, { centerXRatio: 0.62, floorYRatio: 0.9, sizeScale: 0.94 }, 0, 1, focusedCharacterName)];
  }
  if (scale === "wide") {
    return [inferStoryboardCharacterPlacement(shot, fallbackName, { centerXRatio: 0.68, floorYRatio: 0.9, sizeScale: 0.88 }, 0, 1, focusedCharacterName)];
  }
  return [inferStoryboardCharacterPlacement(shot, fallbackName, { centerXRatio: 0.64, floorYRatio: 0.9, sizeScale: 0.92 }, 0, 1, focusedCharacterName)];
}

async function buildStoryboardCompositeReference(
  settings: ComfySettings,
  shot: Shot,
  refs: WeightedImageRef[],
  inputDir: string
): Promise<WeightedImageRef | null> {
  if (!canProcessStoryboardReferenceImages()) return null;
  const sceneRef =
    refs.find((item) => item.role === "scene_primary" || item.role === "scene_secondary") ??
    refs.find((item) => item.role === "continuity_scene");
  const characterRefs = refs.filter((item) => item.role.startsWith("character_")).slice(0, 2);
  if (!sceneRef || characterRefs.length === 0) return null;
  const sceneImage = await loadReferenceImageElement(sceneRef.source);
  if (!sceneImage) return null;
  const sceneWidth = sceneImage.naturalWidth || sceneImage.width;
  const sceneHeight = sceneImage.naturalHeight || sceneImage.height;
  if (sceneWidth <= 0 || sceneHeight <= 0) return null;

  const cutouts = (
    await Promise.all(characterRefs.map(async (item) => ({ ref: item, canvas: await buildCharacterCutoutCanvas(item.source) })))
  ).filter((entry): entry is { ref: WeightedImageRef; canvas: HTMLCanvasElement } => Boolean(entry.canvas));
  if (cutouts.length === 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = sceneWidth;
  canvas.height = sceneHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(sceneImage, 0, 0, sceneWidth, sceneHeight);
  context.save();
  context.fillStyle = "rgba(246, 244, 240, 0.08)";
  context.fillRect(0, 0, sceneWidth, sceneHeight);
  const horizonY = Math.round(sceneHeight * 0.68);
  const gradient = context.createLinearGradient(0, 0, 0, sceneHeight);
  gradient.addColorStop(0, "rgba(255,255,255,0.04)");
  gradient.addColorStop(1, "rgba(0,0,0,0.03)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, sceneWidth, sceneHeight);
  context.strokeStyle = "rgba(0,0,0,0.06)";
  context.lineWidth = Math.max(2, Math.round(sceneHeight * 0.003));
  context.beginPath();
  context.moveTo(0, horizonY);
  context.lineTo(sceneWidth, horizonY);
  context.stroke();
  context.restore();

  const heightRatio = inferStoryboardCompositeHeightRatio(shot, cutouts.length);
  const placements = inferStoryboardCompositeLayout(
    shot,
    cutouts.map(({ ref }) => ref)
  );
  const characterNames = cutouts.map(({ ref }) => extractCharacterNameFromReferenceLabel(ref.label)).filter((item) => item.length > 0);
  const focusedCharacterName = inferStoryboardFocusedCharacterName(shot, characterNames);
  cutouts.forEach(({ canvas: cutout }, index) => {
    const characterName = extractCharacterNameFromReferenceLabel(cutouts[index]?.ref.label ?? "");
    const action = inferStoryboardPoseAction(
      shot,
      characterName,
      Boolean(focusedCharacterName && focusedCharacterName === characterName) || (!focusedCharacterName && index === 0)
    );
    const placement = placements[index] ?? placements[placements.length - 1] ?? { centerXRatio: 0.62, floorYRatio: 0.89, sizeScale: 1 };
    const targetHeight = sceneHeight * heightRatio * placement.sizeScale;
    const scale = targetHeight / Math.max(1, cutout.height);
    const drawWidth = cutout.width * scale;
    const drawHeight = cutout.height * scale;
    const centerX = placement.centerXRatio * sceneWidth;
    const floorY = sceneHeight * placement.floorYRatio;
    const unclampedDrawX = Math.round(centerX - drawWidth / 2);
    const unclampedDrawY = Math.round(floorY - drawHeight);
    const horizontalMargin = Math.max(16, Math.round(sceneWidth * 0.02));
    const topMargin = Math.max(12, Math.round(sceneHeight * 0.02));
    const clampedDrawX = Math.round(
      Math.min(
        Math.max(horizontalMargin, sceneWidth - drawWidth - horizontalMargin),
        Math.max(horizontalMargin, unclampedDrawX)
      )
    );
    const clampedDrawY = Math.round(
      Math.min(
        Math.max(topMargin, sceneHeight - drawHeight - topMargin),
        Math.max(topMargin, unclampedDrawY)
      )
    );
    const clampedCenterX = clampedDrawX + drawWidth / 2;
    const clampedFloorY = clampedDrawY + drawHeight;
    const sampleWidth = Math.max(1, Math.round(drawWidth));
    const sampleHeight = Math.max(1, Math.round(drawHeight));
    const sampleX = Math.max(0, Math.min(sceneWidth - sampleWidth, clampedDrawX));
    const sampleY = Math.max(0, Math.min(sceneHeight - sampleHeight, clampedDrawY));
    const scenePatch = document.createElement("canvas");
    scenePatch.width = sampleWidth;
    scenePatch.height = sampleHeight;
    const scenePatchContext = scenePatch.getContext("2d");
    if (scenePatchContext) {
      scenePatchContext.drawImage(
        sceneImage,
        sampleX,
        sampleY,
        sampleWidth,
        sampleHeight,
        0,
        0,
        sampleWidth,
        sampleHeight
      );
    }
    const sceneTint = { r: 132, g: 132, b: 136 };
    const guideFigure = buildStoryboardGuideCharacterCanvas(
      cutout,
      drawWidth,
      drawHeight,
      sceneTint,
      scenePatch,
      action,
      index % 2 === 1
    );
    context.save();
    context.fillStyle = "rgba(0,0,0,0.14)";
    context.beginPath();
    context.filter = "blur(10px)";
    context.ellipse(
      clampedCenterX,
      clampedFloorY + 5,
      Math.max(18, drawWidth * 0.2),
      Math.max(8, drawWidth * 0.07),
      0,
      0,
      Math.PI * 2
    );
    context.fill();
    if (guideFigure) {
      context.globalAlpha = 0.18;
      context.filter = "blur(6px)";
      context.drawImage(guideFigure, clampedDrawX + 1.5, clampedDrawY + 2, drawWidth, drawHeight);
      context.globalAlpha = 1;
      context.filter = "contrast(1.05) brightness(0.995) saturate(0.98)";
      context.drawImage(guideFigure, clampedDrawX, clampedDrawY, drawWidth, drawHeight);
    } else {
      context.globalAlpha = 0.2;
      context.filter = "grayscale(1) contrast(0.9) brightness(0.92)";
      context.drawImage(cutout, clampedDrawX, clampedDrawY, drawWidth, drawHeight);
    }
    context.restore();
  });

  const safeShotId = shot.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = `${inputDir}/shot_${safeShotId}_scene_character_composite.png`;
  const result = await invokeDesktopCommand<{ filePath: string }>("write_base64_file", {
    filePath,
    base64Data: canvas.toDataURL("image/png").replace(/^data:[^,]+,/, "")
  });
  if (!result.filePath) return null;
  return {
    source: result.filePath,
    weight: 0.98,
    priority: 500,
    bucket: `scene_composite:${shot.id}`,
    label: "scene_character_composite",
    role: "scene_primary"
  };
}

async function buildCharacterIdentityCropReference(
  shot: Shot,
  ref: WeightedImageRef,
  inputDir: string,
  index: number
): Promise<WeightedImageRef | null> {
  if (!canProcessStoryboardReferenceImages()) return null;
  const cutout = await buildCharacterCutoutCanvas(ref.source);
  if (!cutout) return null;
  const cropY = 0;
  const cropHeight = Math.max(1, Math.round(cutout.height * 0.48));
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = cutout.width;
  cropCanvas.height = cropHeight;
  const context = cropCanvas.getContext("2d");
  if (!context) return null;
  context.drawImage(cutout, 0, cropY, cutout.width, cropHeight, 0, 0, cutout.width, cropHeight);
  const safeShotId = shot.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = `${inputDir}/shot_${safeShotId}_identity_crop_${index + 1}.png`;
  const result = await invokeDesktopCommand<{ filePath: string }>("write_base64_file", {
    filePath,
    base64Data: cropCanvas.toDataURL("image/png").replace(/^data:[^,]+,/, "")
  });
  if (!result.filePath) return null;
  return {
    ...ref,
    source: result.filePath,
    weight: Math.max(ref.weight, 0.82),
    priority: Math.max(320, ref.priority),
    label: `${ref.label}:identity_crop`
  };
}

async function buildCharacterThreeViewReference(
  shot: Shot,
  ref: WeightedImageRef,
  inputDir: string,
  index: number,
  assets: Asset[]
): Promise<WeightedImageRef | null> {
  if (!canProcessStoryboardReferenceImages()) return null;
  const assetId = ref.bucket.startsWith("character:") ? ref.bucket.slice("character:".length) : "";
  const asset =
    assets.find((item) => item.id === assetId && item.type === "character") ??
    assets.find((item) => item.type === "character" && item.name.trim() === extractCharacterNameFromReferenceLabel(ref.label));
  if (!asset) return null;
  const stripCanvas = await buildCharacterThreeViewStripCanvas(asset, ref.source);
  if (!stripCanvas) return null;
  const safeShotId = shot.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = `${inputDir}/shot_${safeShotId}_threeview_identity_${index + 1}.png`;
  const result = await invokeDesktopCommand<{ filePath: string }>("write_base64_file", {
    filePath,
    base64Data: stripCanvas.toDataURL("image/png").replace(/^data:[^,]+,/, "")
  });
  if (!result.filePath) return null;
  return {
    ...ref,
    source: result.filePath,
    weight: Math.max(ref.weight, 0.86),
    priority: Math.max(340, ref.priority),
    label: `${ref.label}:threeview_identity`
  };
}

async function stageCharacterReferenceImages(
  settings: ComfySettings,
  shot: Shot,
  refs: WeightedImageRef[],
  assets: Asset[]
): Promise<Array<{ filename: string; weight: number; role: WeightedImageRef["role"]; label: string }>> {
  let selectedRefs = reorderStoryboardReferenceSlots(shot, selectStoryboardReferenceSlots(shot, refs));
  if (selectedRefs.length === 0) return [];
  const isMatureStoryboardGuidance = (settings.storyboardImageWorkflowMode ?? "mature_asset_guided") === "mature_asset_guided";
  if (isMatureStoryboardGuidance) {
    const hasExplicitScene = selectedRefs.some((item) => item.role === "scene_primary" || item.role === "scene_secondary");
    const explicitCharacterRefs = selectedRefs.filter(
      (item) => item.role.startsWith("character_") && item.label !== "character_identity_board"
    );
    if (hasExplicitScene || explicitCharacterRefs.length > 0) {
      // Previous generated storyboard frames are useful as textual continuity hints,
      // but re-feeding them as visual refs compounds drift from earlier bad shots.
      // Keep mature storyboard stills anchored to clean asset refs instead.
      selectedRefs = selectedRefs.filter(
        (item) => item.role !== "continuity_scene" && item.role !== "continuity_character"
      );
    }
    if (hasExplicitScene && explicitCharacterRefs.length > 0) {
      // In mature storyboard mode, a clean scene ref + clean character refs + pose guide
      // is more stable than feeding the model a pasted composite board. The composite and
      // identity board tend to reintroduce flat cutout silhouettes, slot contention, and
      // sticker-like integration.
      selectedRefs = selectedRefs.filter(
        (item) => item.label !== "character_identity_board" && item.label !== "scene_character_composite"
      );
    }
  }
  const inputDir = inferComfyInputDir(settings);
  if (!inputDir) {
    // Degrade gracefully when input directory is unknown.
    // Generation can still continue without dynamic reference image injection.
    return [];
  }
  const adjusted: WeightedImageRef[] = [];
  for (let index = 0; index < selectedRefs.length; index += 1) {
    const item = selectedRefs[index]!;
    if (item.role === "scene_secondary") {
      continue;
    }
    adjusted.push(item);
  }
  const hasCompositeGuide = adjusted.some((item) => item.label === "scene_character_composite");
  const hasIdentityBoard = adjusted.some((item) => item.label === "character_identity_board");
  const multiCharacterRefCount = adjusted.filter((item) => item.role.startsWith("character_")).length;
  const maxRefCount =
    hasCompositeGuide && hasIdentityBoard && multiCharacterRefCount >= 2
      ? 5
      : hasCompositeGuide
        ? 4
        : 3;
  selectedRefs = adjusted.slice(0, maxRefCount);
  const safeShotId = shot.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const useIdentityCrops = selectedRefs.some((item) => item.label === "scene_character_composite");
  const staged: Array<{ filename: string; weight: number; role: WeightedImageRef["role"]; label: string }> = [];
  for (let index = 0; index < selectedRefs.length; index += 1) {
    let tuned = adjustStoryboardReferenceWeight(shot, selectedRefs[index]!, selectedRefs);
    if (
      useIdentityCrops &&
      tuned.role.startsWith("character_") &&
      tuned.label !== "character_identity_board"
    ) {
      const threeViewRef =
        (await buildCharacterThreeViewReference(shot, tuned, inputDir, index, assets)) ??
        (await buildCharacterIdentityCropReference(shot, tuned, inputDir, index));
      if (threeViewRef?.source) {
        tuned = {
          ...threeViewRef,
          weight: tuned.weight,
          priority: tuned.priority,
          role: tuned.role
        };
      }
    }
    const { source, weight, role, label } = tuned;
    const ext = fileExtensionFromSource(source || "png");
    const targetAbs = `${inputDir}/shot_${safeShotId}_charref_${index + 1}.${ext}`;
    const written = await stageSourceFileToComfyInput(source, targetAbs, settings.baseUrl, settings.outputDir);
    staged.push({
      filename: written.split("/").pop() ?? `shot_${safeShotId}_charref_${index + 1}.${ext}`,
      weight,
      role,
      label
    });
  }
  return staged;
}

function nextNumericId(workflow: Record<string, unknown>, field: "last_node_id" | "last_link_id"): number {
  const current = Number(workflow[field]);
  const base = Number.isFinite(current) ? Math.floor(current) : 0;
  const next = base + 1;
  workflow[field] = next;
  return next;
}

function findWorkflowNodeById(workflow: Record<string, unknown>, nodeId: number): WorkflowNode | undefined {
  return workflowNodes(workflow).find((node) => node.id === nodeId);
}

function addWorkflowLink(
  workflow: Record<string, unknown>,
  fromNodeId: number,
  fromSlot: number,
  toNodeId: number,
  toInput: number,
  type: string
) {
  const links = workflowLinks(workflow);
  const linkId = nextNumericId(workflow, "last_link_id");
  links.push([linkId, fromNodeId, fromSlot, toNodeId, toInput, type]);
  setWorkflowLinks(workflow, links);

  const targetNode = findWorkflowNodeById(workflow, toNodeId);
  if (targetNode && Array.isArray(targetNode.inputs) && targetNode.inputs[toInput]) {
    targetNode.inputs[toInput]!.link = linkId;
  }

  const sourceNode = findWorkflowNodeById(workflow, fromNodeId);
  if (sourceNode && Array.isArray(sourceNode.outputs) && sourceNode.outputs[fromSlot]) {
    const output = sourceNode.outputs[fromSlot]!;
    const existing = Array.isArray(output.links) ? output.links : [];
    if (!existing.includes(linkId)) output.links = [...existing, linkId];
  }
}

function removeIncomingLinks(
  workflow: Record<string, unknown>,
  nodeId: number,
  inputIndexes: number[]
): WorkflowLink[] {
  if (inputIndexes.length === 0) return [];
  const links = workflowLinks(workflow);
  const incoming = links.filter((link) => link[3] === nodeId && inputIndexes.includes(link[4]));
  const next = links.filter((link) => !(link[3] === nodeId && inputIndexes.includes(link[4])));
  setWorkflowLinks(workflow, next);

  const targetNode = findWorkflowNodeById(workflow, nodeId);
  if (targetNode && Array.isArray(targetNode.inputs)) {
    for (const inputIndex of inputIndexes) {
      if (targetNode.inputs[inputIndex]) targetNode.inputs[inputIndex]!.link = null;
    }
  }
  for (const link of incoming) {
    const sourceNode = findWorkflowNodeById(workflow, link[1]);
    if (!sourceNode || !Array.isArray(sourceNode.outputs) || !sourceNode.outputs[link[2]]) continue;
    const output = sourceNode.outputs[link[2]]!;
    if (Array.isArray(output.links)) {
      output.links = output.links.filter((value) => value !== link[0]);
    }
  }
  return incoming;
}

function removeOutgoingLinks(
  workflow: Record<string, unknown>,
  nodeId: number,
  outputSlot: number
): WorkflowLink[] {
  const links = workflowLinks(workflow);
  const outgoing = links.filter((link) => link[1] === nodeId && link[2] === outputSlot);
  const next = links.filter((link) => !(link[1] === nodeId && link[2] === outputSlot));
  setWorkflowLinks(workflow, next);

  const sourceNode = findWorkflowNodeById(workflow, nodeId);
  if (sourceNode && Array.isArray(sourceNode.outputs) && sourceNode.outputs[outputSlot]) {
    sourceNode.outputs[outputSlot]!.links = [];
  }
  for (const link of outgoing) {
    const targetNode = findWorkflowNodeById(workflow, link[3]);
    if (!targetNode || !Array.isArray(targetNode.inputs) || !targetNode.inputs[link[4]]) continue;
    targetNode.inputs[link[4]]!.link = null;
  }
  return outgoing;
}

function deleteWorkflowNode(workflow: Record<string, unknown>, nodeId: number) {
  const node = findWorkflowNodeById(workflow, nodeId);
  if (!node) return;
  const inputs = Array.isArray(node.inputs) ? node.inputs : [];
  if (inputs.length > 0) {
    removeIncomingLinks(
      workflow,
      nodeId,
      inputs.map((_, index) => index)
    );
  }
  const outputs = Array.isArray(node.outputs) ? node.outputs : [];
  for (let outputIndex = 0; outputIndex < outputs.length; outputIndex += 1) {
    removeOutgoingLinks(workflow, nodeId, outputIndex);
  }
  workflow.nodes = workflowNodes(workflow).filter((item) => item.id !== nodeId);
}

function hasWorkflowLink(
  workflow: Record<string, unknown>,
  fromNodeId: number,
  fromSlot: number,
  toNodeId: number,
  toInput: number
): boolean {
  return workflowLinks(workflow).some(
    (link) => link[1] === fromNodeId && link[2] === fromSlot && link[3] === toNodeId && link[4] === toInput
  );
}

function ensureWorkflowLink(
  workflow: Record<string, unknown>,
  fromNodeId: number,
  fromSlot: number,
  toNodeId: number,
  toInput: number,
  type: string
) {
  if (hasWorkflowLink(workflow, fromNodeId, fromSlot, toNodeId, toInput)) return;
  addWorkflowLink(workflow, fromNodeId, fromSlot, toNodeId, toInput, type);
}

function cloneNodeWithNewId(workflow: Record<string, unknown>, source: WorkflowNode, xOffset: number): WorkflowNode {
  const clone = JSON.parse(JSON.stringify(source)) as WorkflowNode;
  clone.id = nextNumericId(workflow, "last_node_id");
  if (Array.isArray(source.pos) && source.pos.length >= 2) {
    clone.pos = [source.pos[0] + xOffset, source.pos[1]];
  }
  const nodes = workflowNodes(workflow);
  nodes.push(clone);
  workflow.nodes = nodes;
  return clone;
}

function createLoadImageNode(workflow: Record<string, unknown>, filename: string): WorkflowNode {
  const nodeId = nextNumericId(workflow, "last_node_id");
  const node: WorkflowNode = {
    id: nodeId,
    type: "LoadImage",
    widgets_values: [filename, "image"],
    inputs: [],
    outputs: [
      { name: "IMAGE", type: "IMAGE", links: [] },
      { name: "MASK", type: "MASK", links: [] }
    ]
  };
  const nodes = workflowNodes(workflow);
  nodes.push(node);
  workflow.nodes = nodes;
  return node;
}

function createConditioningCombineNode(workflow: Record<string, unknown>, x: number, y: number): WorkflowNode {
  const nodeId = nextNumericId(workflow, "last_node_id");
  const node: WorkflowNode = {
    id: nodeId,
    type: "ConditioningCombine",
    pos: [x, y],
    inputs: [
      { name: "conditioning_1", type: "CONDITIONING" },
      { name: "conditioning_2", type: "CONDITIONING" }
    ],
    outputs: [{ name: "CONDITIONING", type: "CONDITIONING", links: [] }],
    widgets_values: []
  };
  const nodes = workflowNodes(workflow);
  nodes.push(node);
  workflow.nodes = nodes;
  return node;
}

function createConditioningAverageNode(
  workflow: Record<string, unknown>,
  x: number,
  y: number,
  conditioningToStrength: number
): WorkflowNode {
  const nodeId = nextNumericId(workflow, "last_node_id");
  const safeStrength = Number.isFinite(conditioningToStrength)
    ? Math.max(0, Math.min(1, conditioningToStrength))
    : 0.5;
  const node: WorkflowNode = {
    id: nodeId,
    type: "ConditioningAverage",
    pos: [x, y],
    inputs: [
      { name: "conditioning_to", type: "CONDITIONING" },
      { name: "conditioning_from", type: "CONDITIONING" }
    ],
    outputs: [{ name: "CONDITIONING", type: "CONDITIONING", links: [] }],
    widgets_values: [safeStrength]
  };
  const nodes = workflowNodes(workflow);
  nodes.push(node);
  workflow.nodes = nodes;
  return node;
}

function qwenImageInputIndexes(node: WorkflowNode): number[] {
  const inputs = Array.isArray(node.inputs) ? node.inputs : [];
  const vlResizeSlots: number[] = [];
  const noResizeSlots: number[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const name = inputs[index]?.name ?? "";
    if (name.startsWith("vl_resize_image")) vlResizeSlots.push(index);
    if (name.startsWith("not_resize_image")) noResizeSlots.push(index);
  }
  // The QwenEdit "Advance" node exposes six image inputs, but they represent
  // three reference slots with two processing modes, not six fully independent refs.
  // Feeding all six as separate images can break the node with
  // "too many values to unpack (expected 3)" on complex shots.
  if (vlResizeSlots.length > 0) return vlResizeSlots;
  return noResizeSlots;
}

function qwenPromptInputIndexes(node: WorkflowNode): number[] {
  const inputs = Array.isArray(node.inputs) ? node.inputs : [];
  const slots: number[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const rawName = inputs[index]?.name ?? "";
    const name = String(rawName).trim().toLowerCase();
    if (name === "prompt" || name.endsWith("_prompt")) {
      slots.push(index);
    }
  }
  return slots.length > 0 ? slots : [8];
}

function normalizeQwenPromptInputBindings(workflow: Record<string, unknown>, promptText: string) {
  const nodes = workflowNodes(workflow);
  for (const node of nodes) {
    if (node.type !== "TextEncodeQwenImageEditPlusAdvance_lrzjason" || typeof node.id !== "number") continue;
    removeIncomingLinks(workflow, node.id, qwenPromptInputIndexes(node));
    setNodeWidgetValue(node, 0, promptText);
    setNodeWidgetNamedValue(node, "prompt", promptText);
  }
}

function normalizeQwenInstructionBindings(workflow: Record<string, unknown>, instructionText: string) {
  const nodes = workflowNodes(workflow);
  for (const node of nodes) {
    if (node.type !== "TextEncodeQwenImageEditPlusAdvance_lrzjason" || typeof node.id !== "number") continue;
    setNodeWidgetValue(node, 5, instructionText);
  }
}

function applyDynamicCharacterRefsForImageWorkflow(
  workflow: Record<string, unknown>,
  weightedImageRefs: Array<{ filename: string; weight: number; role?: WeightedImageRef["role"] }>
) {
  const nodes = workflowNodes(workflow);
  const baseNode = nodes.find((node) => node.type === "TextEncodeQwenImageEditPlusAdvance_lrzjason");
  if (!baseNode || typeof baseNode.id !== "number") return;

  const slotIndexes = qwenImageInputIndexes(baseNode);
  if (slotIndexes.length === 0) return;
  // Always detach baked-in reference image links from the template workflow.
  // If current shot has no refs, we keep these slots disconnected instead of failing on stale image filenames.
  removeIncomingLinks(workflow, baseNode.id, slotIndexes);
  if (weightedImageRefs.length === 0) return;

  const chunkSize = Math.max(1, Math.min(slotIndexes.length, qwenReferenceChunkSize(weightedImageRefs)));
  const chunks: Array<Array<{ filename: string; weight: number; role?: WeightedImageRef["role"] }>> = [];
  for (let start = 0; start < weightedImageRefs.length; start += chunkSize) {
    chunks.push(weightedImageRefs.slice(start, start + chunkSize));
  }

  const encoderNodes: WorkflowNode[] = [baseNode];
  for (let idx = 1; idx < chunks.length; idx += 1) {
    encoderNodes.push(cloneNodeWithNewId(workflow, baseNode, idx * 520));
  }

  const baseIncoming = workflowLinks(workflow).filter((link) => link[3] === baseNode.id);
  const baseOutgoingConditioning = removeOutgoingLinks(workflow, baseNode.id, 0);
  removeIncomingLinks(workflow, baseNode.id, slotIndexes);

  for (let encoderIndex = 1; encoderIndex < encoderNodes.length; encoderIndex += 1) {
    const encoder = encoderNodes[encoderIndex]!;
    if (typeof encoder.id !== "number") continue;
    const inherited = baseIncoming.filter((link) => !slotIndexes.includes(link[4]));
    for (const link of inherited) {
      addWorkflowLink(workflow, link[1], link[2], encoder.id, link[4], link[5]);
    }
  }

  for (let encoderIndex = 0; encoderIndex < encoderNodes.length; encoderIndex += 1) {
    const encoder = encoderNodes[encoderIndex]!;
    if (typeof encoder.id !== "number") continue;
    const currentChunk = chunks[encoderIndex] ?? [];
    removeIncomingLinks(workflow, encoder.id, slotIndexes);
    for (let imageIndex = 0; imageIndex < currentChunk.length; imageIndex += 1) {
      const targetInput = slotIndexes[imageIndex];
      if (targetInput === undefined) continue;
      const loadNode = createLoadImageNode(workflow, currentChunk[imageIndex]!.filename);
      if (typeof loadNode.id !== "number") continue;
      addWorkflowLink(workflow, loadNode.id, 0, encoder.id, targetInput, "IMAGE");
    }
  }

  if (encoderNodes.length === 1) {
    for (const link of baseOutgoingConditioning) {
      addWorkflowLink(workflow, baseNode.id, 0, link[3], link[4], link[5]);
    }
    return;
  }

  let currentSourceNodeId = baseNode.id;
  let accumulatedWeight =
    chunks[0]?.reduce((sum, item) => sum + (Number.isFinite(item.weight) ? Math.max(0, item.weight) : 1), 0) ?? 1;
  if (accumulatedWeight <= 0) accumulatedWeight = 1;
  for (let encoderIndex = 1; encoderIndex < encoderNodes.length; encoderIndex += 1) {
    const encoder = encoderNodes[encoderIndex]!;
    if (typeof encoder.id !== "number") continue;
    const currentWeight =
      chunks[encoderIndex]?.reduce(
        (sum, item) => sum + (Number.isFinite(item.weight) ? Math.max(0, item.weight) : 1),
        0
      ) ?? 1;
    const safeCurrentWeight = currentWeight > 0 ? currentWeight : 1;
    const alpha = accumulatedWeight / (accumulatedWeight + safeCurrentWeight);
    let nextNodeId = 0;
    const average = createConditioningAverageNode(
      workflow,
      (baseNode.pos?.[0] ?? 0) + 220 + encoderIndex * 260,
      (baseNode.pos?.[1] ?? 0) + 620,
      alpha
    );
    if (typeof average.id === "number") {
      addWorkflowLink(workflow, currentSourceNodeId, 0, average.id, 0, "CONDITIONING");
      addWorkflowLink(workflow, encoder.id, 0, average.id, 1, "CONDITIONING");
      nextNodeId = average.id;
    } else {
      const combine = createConditioningCombineNode(
        workflow,
        (baseNode.pos?.[0] ?? 0) + 220 + encoderIndex * 240,
        (baseNode.pos?.[1] ?? 0) + 620
      );
      if (typeof combine.id !== "number") continue;
      addWorkflowLink(workflow, currentSourceNodeId, 0, combine.id, 0, "CONDITIONING");
      addWorkflowLink(workflow, encoder.id, 0, combine.id, 1, "CONDITIONING");
      nextNodeId = combine.id;
    }
    currentSourceNodeId = nextNodeId;
    accumulatedWeight += safeCurrentWeight;
  }

  for (const link of baseOutgoingConditioning) {
    addWorkflowLink(workflow, currentSourceNodeId, 0, link[3], link[4], link[5]);
  }
}

function applyFisherWorkflowBindings(
  workflow: Record<string, unknown>,
  kind: "image" | "video" | "audio",
  tokens: Record<string, string>,
  stagedImageRefs: Array<{ filename: string; weight: number; role?: WeightedImageRef["role"]; label?: string }> = []
) {
  const nodes = Array.isArray(workflow.nodes) ? (workflow.nodes as WorkflowNode[]) : [];
  if (nodes.length === 0) return;
  const byId = new Map<number, WorkflowNode>();
  for (const node of nodes) {
    if (typeof node.id === "number") byId.set(node.id, node);
  }
  applyFisherWorkflowModes(byId, kind, tokens);
  bypassFisherSageAttentionNodes(workflow, byId, kind, tokens);
  bypassFisherSimpleMathNode(workflow, byId, kind, tokens);
  bypassFisherRifeNodes(workflow, byId, kind);
  disableFisherImageStyleLoras(workflow, byId, kind);

  const seed = Number(tokens.SEED);
  const safeSeed = Number.isFinite(seed) ? Math.floor(seed) : undefined;
  const frames = Number(tokens.DURATION_FRAMES);
  const safeFrames = Number.isFinite(frames) ? Math.max(1, Math.round(frames)) : undefined;

  // Keep Fisher image workflow model aligned with storyboard settings.
  // Falling back to a fixed Qwen checkpoint here causes identity/style drift
  // between generated storyboard frames and character three-view assets.
  const storyboardModel = String(tokens.STORYBOARD_IMAGE_MODEL ?? "").trim();
  setNodeWidgetValue(
    byId.get(49),
    0,
    storyboardModel || "Qwen-Rapid-AIO-SFW-v5.safetensors"
  );
  setNodeWidgetValue(byId.get(145), 0, "wan_2.1_vae.safetensors");
  setNodeWidgetValue(byId.get(208), 0, "wan_2.1_vae.safetensors");

  // Fisher/Qwen workflows often connect easy promptLine(COMBO) -> qwen prompt(STRING),
  // which causes prompt validation errors in API mode. Always force prompt to widget text,
  // including cloned encoders created for extra reference images.
  const hasBindingRefs = kind === "image" && stagedImageRefs.length > 0;
  const qwenPromptText = kind === "image" ? (tokens.PROMPT || tokens.NEXT_SCENE_PROMPT) : (tokens.NEXT_SCENE_PROMPT || tokens.PROMPT);
  const qwenInstructionText = [buildQwenReferenceInstruction(tokens), buildQwenSlotInstruction(stagedImageRefs)]
    .filter((item) => item.length > 0)
    .join(" ");
  normalizeQwenPromptInputBindings(workflow, qwenPromptText);
  normalizeQwenInstructionBindings(workflow, qwenInstructionText);
  setNodeWidgetValue(byId.get(123), 0, qwenPromptText);

  if (kind === "image") {
    const safeShotId = sanitizePathSegment(String(tokens.SHOT_ID ?? "").trim() || "shot");
    setNodeWidgetValue(byId.get(89), 0, `Storyboard/image_asset_guided_${safeShotId}`);
    if (safeSeed !== undefined) setNodeWidgetValue(byId.get(10), 0, safeSeed);
    return;
  }

  const isFirstLast = tokens.VIDEO_MODE === "FIRST_LAST_FRAME";
  const framePath = tokens.FRAME_IMAGE_PATH;
  const firstFrame = tokens.FIRST_FRAME_PATH || framePath;
  const lastFrame = tokens.LAST_FRAME_PATH || firstFrame;
  const fallbackFrame = firstFrame || framePath;
  const positivePrompt = tokens.VIDEO_PROMPT || tokens.PROMPT;

  setNodeWidgetValue(byId.get(193), 0, positivePrompt);
  setNodeWidgetValue(byId.get(144), 0, positivePrompt);
  setNodeWidgetValue(byId.get(176), 0, tokens.NEGATIVE_PROMPT || "");
  setNodeWidgetNamedValue(byId.get(148), "save_output", true);
  setNodeWidgetNamedValue(byId.get(148), "format", "video/h264-mp4");
  setNodeWidgetNamedValue(byId.get(148), "filename_prefix", "Storyboard/video_first_last");
  setNodeWidgetNamedValue(byId.get(159), "save_output", false);
  setNodeWidgetNamedValue(byId.get(195), "save_output", true);
  setNodeWidgetNamedValue(byId.get(195), "format", "video/h264-mp4");
  setNodeWidgetNamedValue(byId.get(195), "filename_prefix", "Storyboard/video_single");
  setNodeWidgetNamedValue(byId.get(199), "save_output", false);
  if (safeSeed !== undefined) {
    setNodeWidgetValue(byId.get(196), 1, safeSeed);
    setNodeWidgetValue(byId.get(155), 1, safeSeed);
  }
  if (safeFrames !== undefined) {
    setNodeWidgetValue(byId.get(201), 0, safeFrames);
    setNodeWidgetValue(byId.get(197), 3, safeFrames);
    setNodeWidgetValue(byId.get(160), 3, safeFrames);
  }

  setNodeWidgetValue(byId.get(205), 0, isFirstLast ? firstFrame : fallbackFrame);
  if (isFirstLast) {
    setNodeWidgetValue(byId.get(150), 0, firstFrame);
    setNodeWidgetValue(byId.get(151), 0, lastFrame);
  } else {
    setNodeWidgetValue(byId.get(150), 0, fallbackFrame);
    setNodeWidgetValue(byId.get(151), 0, fallbackFrame);
  }
  if (fallbackFrame) {
    // Some mixed workflows still keep legacy image branches active in API prompt.
    // Fill known LoadImage nodes with a valid staged frame filename to avoid invalid-file failures.
    setNodeWidgetValue(byId.get(13), 0, fallbackFrame);
  }
}

function normalizeModelChoice(value: string): string {
  return value.trim().replace(/\\/g, "/").toLowerCase();
}

function basenameModelChoice(value: string): string {
  const normalized = normalizeModelChoice(value);
  const segments = normalized.split("/");
  return segments[segments.length - 1] ?? normalized;
}

function tokenizeComboChoice(value: string): string[] {
  return basenameModelChoice(value)
    .split(/[^a-z0-9]+/i)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length >= 2);
}

function extractComboOptionsFromObjectInfo(
  objectInfo: Record<string, unknown>,
  classType: string,
  inputName: string
): string[] {
  const classInfo = objectInfo[classType];
  if (!classInfo || typeof classInfo !== "object" || Array.isArray(classInfo)) return [];
  const input = (classInfo as Record<string, unknown>).input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const required = (input as Record<string, unknown>).required;
  if (!required || typeof required !== "object" || Array.isArray(required)) return [];
  const inputEntry = (required as Record<string, unknown>)[inputName];
  if (!Array.isArray(inputEntry) || inputEntry.length === 0) return [];
  const first = inputEntry[0];
  if (!Array.isArray(first)) return [];
  return first.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function resolveBestModelOption(
  desiredValue: string,
  options: string[],
  classType = "",
  inputName = ""
): string {
  if (!desiredValue.trim() || options.length === 0) return desiredValue;
  const desiredNormalized = normalizeModelChoice(desiredValue);
  const desiredBase = basenameModelChoice(desiredValue);

  const exact = options.find((option) => normalizeModelChoice(option) === desiredNormalized);
  if (exact) return exact;

  const sameBase = options.find((option) => basenameModelChoice(option) === desiredBase);
  if (sameBase) return sameBase;

  const suffixMatch = options.find((option) => normalizeModelChoice(option).endsWith(`/${desiredBase}`));
  if (suffixMatch) return suffixMatch;

  const desiredTokens = tokenizeComboChoice(desiredValue);
  if (desiredTokens.length > 0) {
    let bestOption = "";
    let bestScore = 0;
    for (const option of options) {
      const optionNormalized = normalizeModelChoice(option);
      let score = 0;
      for (const token of desiredTokens) {
        if (!optionNormalized.includes(token)) continue;
        score += token.length >= 5 ? 4 : token.length >= 3 ? 2 : 1;
      }
      if (score > bestScore) {
        bestOption = option;
        bestScore = score;
      }
    }
    if (bestOption && bestScore > 0) return bestOption;
  }

  if (classType === "RMBG" && inputName === "background") {
    const normalizedDesired = desiredValue.trim().toLowerCase();
    if (/(gray|grey|white|black|color|colour|solid)/.test(normalizedDesired)) {
      return options.find((option) => option.trim().toLowerCase() === "color") ?? options[0]!;
    }
    return options.find((option) => option.trim().toLowerCase() === "alpha") ?? options[0]!;
  }

  if (classType === "PatchModelPatcherOrder" && inputName === "full_load") {
    const normalizedDesired = desiredValue.trim().toLowerCase();
    if (/disable/.test(normalizedDesired)) {
      return options.find((option) => option.trim().toLowerCase() === "disabled") ?? options[0]!;
    }
    if (/enable/.test(normalizedDesired)) {
      return options.find((option) => option.trim().toLowerCase() === "enabled") ?? options[0]!;
    }
    return options.find((option) => option.trim().toLowerCase() === "auto") ?? options[0]!;
  }

  if (/^(default|auto)$/i.test(desiredValue.trim())) {
    return options[0]!;
  }

  return desiredValue;
}

function applyComfyModelOptionBindings(
  workflow: Record<string, unknown>,
  objectInfo: Record<string, unknown>
) {
  if (isLikelyComfyApiPrompt(workflow)) {
    for (const value of Object.values(workflow)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const node = value as Record<string, unknown>;
      const classType = typeof node.class_type === "string" ? node.class_type : "";
      const inputs = node.inputs;
      if (!classType || !inputs || typeof inputs !== "object" || Array.isArray(inputs)) continue;
      for (const [name, currentValue] of Object.entries(inputs as Record<string, unknown>)) {
        if (typeof currentValue !== "string" || !currentValue.trim()) continue;
        const options = extractComboOptionsFromObjectInfo(objectInfo, classType, name);
        if (options.length === 0) continue;
        const resolved = resolveBestModelOption(currentValue, options, classType, name);
        if (resolved !== currentValue) {
          (inputs as Record<string, unknown>)[name] = resolved;
        }
      }
    }
    return;
  }

  const nodes = workflowNodes(workflow);
  for (const node of nodes) {
    if (!node || typeof node.type !== "string") continue;
    if (!Array.isArray(node.widgets_values)) continue;

    const orderedNames = objectInfoInputOrderNames(objectInfo, node.type);
    if (orderedNames.length > 0) {
      const maxCount = Math.min(orderedNames.length, node.widgets_values.length);
      for (let index = 0; index < maxCount; index += 1) {
        const name = orderedNames[index] ?? "";
        const currentValue = node.widgets_values[index];
        if (!name || typeof currentValue !== "string" || !currentValue.trim()) continue;
        const options = extractComboOptionsFromObjectInfo(objectInfo, node.type, name);
        if (options.length === 0) continue;
        const resolved = resolveBestModelOption(currentValue, options, node.type, name);
        if (resolved !== currentValue) {
          setNodeWidgetValue(node, index, resolved);
        }
      }
      continue;
    }

    if (!Array.isArray(node.inputs)) continue;

    const comboInputs = node.inputs
      .map((input, index) => ({ input, index }))
      .filter(({ input }) => {
        if (!input || typeof input !== "object") return false;
        const name = typeof input.name === "string" ? input.name : "";
        const inputType = inputTypeValue(input);
        return Boolean(name) && (inputType === "COMBO" || Array.isArray(inputType));
      });

    for (const { input, index } of comboInputs) {
      const name = typeof input.name === "string" ? input.name : "";
      const currentValue = node.widgets_values[index];
      if (typeof currentValue !== "string" || !currentValue.trim()) continue;
      const options = extractComboOptionsFromObjectInfo(objectInfo, node.type, name);
      if (options.length === 0) continue;
      const resolved = resolveBestModelOption(currentValue, options, node.type, name);
      if (resolved !== currentValue) {
        setNodeWidgetValue(node, index, resolved);
      }
    }
  }
}

function inferPromptTokens(
  settings: ComfySettings,
  shot: Shot,
  index: number,
  mapping: ComfySettings["tokenMapping"],
  allShots: Shot[] = [],
  assets: Asset[] = [],
  kind: "image" | "video" | "audio" = "image"
): Record<string, string> {
  const assetOutputContext = inferAssetOutputContextFromShot(shot);
  const nextShot = allShots[index + 1];
  const mode = inferVideoMode(shot, nextShot);
  const promptBaseRaw = shot.storyPrompt?.trim() || shot.notes?.trim() || shot.title;
  const characterAssetsAll = assets.filter((item) => item.type === "character");
  const canonicalCharacterMap = buildCanonicalPrimaryCharacterMap(characterAssetsAll);
  const sceneAsset = assets.find(
    (item) => item.id === (shot.sceneRefId ?? "") && (item.type === "scene" || item.type === "skybox")
  );
  const skyboxPlan = sceneAsset?.type === "skybox" ? inferSkyboxReferencePlan(shot) : null;
  const skyboxFaces = skyboxPlan?.faces ?? [];
  const skyboxFaceWeightsText = skyboxFaces
    .map((face) => `${face}:${(skyboxPlan?.weights[face] ?? skyboxFaceWeight(shot, face)).toFixed(2)}`)
    .join(",");
  const skyboxFacePaths =
    sceneAsset?.type === "skybox"
      ? skyboxFaces
          .map((face) => sceneAsset.skyboxFaces?.[face] || "")
          .filter((path) => path.trim().length > 0)
      : [];
  const sceneRefPath =
    sceneAsset?.type === "skybox"
      ? skyboxFacePaths[0] || sceneAsset.skyboxFaces?.front || sceneAsset.filePath
      : sceneAsset?.filePath ?? "";
  const shotCharacterContext = compactTextParts(
    shot.title,
    shot.storyPrompt,
    shot.notes,
    shot.dialogue,
    shot.sourceCharacterNames
  );
  const inferredCharacterRefIds: string[] = [];
  const pushCharacterRefId = (candidateId?: string) => {
    const normalizedId = normalizeCharacterAssetRefId(assets, canonicalCharacterMap, candidateId);
    if (!normalizedId || inferredCharacterRefIds.includes(normalizedId)) return;
    inferredCharacterRefIds.push(normalizedId);
  };
  for (const refId of shot.characterRefs ?? []) {
    pushCharacterRefId(refId);
  }
  for (const name of shot.sourceCharacterNames ?? []) {
    pushCharacterRefId(resolveCharacterAssetIdByName(assets, canonicalCharacterMap, name));
  }
  for (const asset of characterAssetsAll) {
    const assetName = asset.name.trim();
    if (!assetName || !shotCharacterContext.includes(assetName)) continue;
    pushCharacterRefId(asset.id);
  }
  if (inferredCharacterRefIds.length === 0 && shotLooksCharacterDrivenInComfy(shot)) {
    if (characterAssetsAll.length >= 1) {
      pushCharacterRefId(characterAssetsAll[0]?.id);
    }
    if (characterAssetsAll.length >= 2) {
      pushCharacterRefId(characterAssetsAll[1]?.id);
    }
  }
  const resolvedCharacterAssets: Asset[] = [];
  for (const refId of inferredCharacterRefIds) {
    const matched = assets.find((item) => item.id === refId && item.type === "character");
    if (matched) resolvedCharacterAssets.push(matched);
  }
  const characterAssets = selectStoryboardCharacterAssets(shot, resolvedCharacterAssets);
  const continuityPlan = inferShotContinuityPlan(shot, index, allShots);
  const characterFrontPaths = characterAssets.map((item) => item.characterFrontPath || item.filePath).filter(Boolean);
  const characterSidePaths = characterAssets.map((item) => item.characterSidePath || "").filter(Boolean);
  const characterBackPaths = characterAssets.map((item) => item.characterBackPath || "").filter(Boolean);
  const characterVoiceProfiles = characterAssets.map((item) => item.voiceProfile?.trim() || "").filter(Boolean);
  const characterAllViewPaths = [...characterFrontPaths, ...characterSidePaths, ...characterBackPaths].filter(Boolean);
  const charSlots = [0, 1, 2, 3].map((slotIndex) => characterAssets[slotIndex]);
  const characterPlan = inferCharacterReferencePlan(shot);
  const prefersAngleMatchedCharacterView = shouldUseSecondaryCharacterView(shot);
  const continuityCharacterRefPath = parseComfyViewPath(continuityPlan.previousCharacterShot?.generatedImagePath ?? "");
  const hasCharacters = characterAssets.length > 0;
  const hasSecondCharacter = Boolean(charSlots[1]);
  const preferIdentityFrontPaths =
    kind === "image" &&
    (Boolean(sceneRefPath) || hasCharacters || shotLooksCharacterDrivenInComfy(shot)) &&
    (hasSecondCharacter || !prefersAngleMatchedCharacterView);
  const char1IdentityPath = assetPathForCharacterView(charSlots[0], "front") || characterFrontPaths[0] || continuityCharacterRefPath || "";
  const char1ViewPath =
    assetPathForCharacterView(charSlots[0], characterPlan.primaryView) || char1IdentityPath || "";
  const char1SecondaryView = kind === "image" && hasSecondCharacter ? "front" : (characterPlan.secondaryViews[0] ?? "front");
  const char1PrimaryPath = preferIdentityFrontPaths ? char1IdentityPath || char1ViewPath : char1ViewPath;
  const char1SecondaryPath =
    (preferIdentityFrontPaths
      ? assetPathForCharacterView(charSlots[0], characterPlan.primaryView === "front" ? char1SecondaryView : characterPlan.primaryView)
      : assetPathForCharacterView(charSlots[0], char1SecondaryView)) ||
    char1PrimaryPath ||
    "";
  const char2IdentityPath =
    assetPathForCharacterView(charSlots[1], "front") ||
    characterFrontPaths[1] ||
    char1IdentityPath ||
    continuityCharacterRefPath ||
    "";
  const char2ViewPath =
    assetPathForCharacterView(charSlots[1], characterPlan.primaryView) ||
    char2IdentityPath ||
    char1SecondaryPath ||
    char1PrimaryPath ||
    "";
  const char2SecondaryView = kind === "image" && hasSecondCharacter ? "front" : (characterPlan.secondaryViews[0] ?? "front");
  const char2PrimaryPath = preferIdentityFrontPaths ? char2IdentityPath || char2ViewPath : char2ViewPath;
  const char2SecondaryPath =
    (preferIdentityFrontPaths
      ? assetPathForCharacterView(charSlots[1], characterPlan.primaryView === "front" ? char2SecondaryView : characterPlan.primaryView)
      : assetPathForCharacterView(charSlots[1], char2SecondaryView)) ||
    char2PrimaryPath ||
    char1SecondaryPath ||
    char1PrimaryPath ||
    "";
  const defaultFramePath = parseComfyViewPath(shot.generatedImagePath ?? "");
  const continuitySceneSeedPath = parseComfyViewPath(continuityPlan.previousSceneShot?.generatedImagePath ?? "");
  const shouldPreferContinuitySeed =
    kind === "image" &&
    continuitySceneSeedPath.length > 0 &&
    (Boolean(sceneRefPath) || shouldLeadWithSceneReference(shot) || hasCharacters);
  const storyboardWeights = inferStoryboardReferenceWeights(
    shot,
    Boolean(sceneRefPath),
    Boolean(charSlots[1]),
    shouldPreferContinuitySeed
  );
  const useSecondaryCharacterView = shouldUseSecondaryCharacterView(shot) && !hasSecondCharacter;
  const normalizedChar1PrimaryPath = char1PrimaryPath.trim();
  const normalizedChar1SecondaryPath = char1SecondaryPath.trim();
  const normalizedChar2PrimaryPath = char2PrimaryPath.trim();
  const minChar1PrimaryWeight = hasCharacters ? (hasSecondCharacter ? 0.82 : 0.88) : 0;
  const minChar1SecondaryWeight = useSecondaryCharacterView ? 0.08 : 0;
  const minChar2PrimaryWeight = hasSecondCharacter ? 0.78 : 0;
  const effectiveChar1PrimaryWeight = normalizedChar1PrimaryPath
    ? Math.max(storyboardWeights.char1Primary, minChar1PrimaryWeight)
    : 0;
  const effectiveChar1SecondaryWeight =
    normalizedChar1SecondaryPath && normalizedChar1SecondaryPath !== normalizedChar1PrimaryPath && useSecondaryCharacterView
      ? Math.max(storyboardWeights.char1Secondary, minChar1SecondaryWeight)
      : 0;
  const effectiveChar2PrimaryWeight =
    hasSecondCharacter && normalizedChar2PrimaryPath
      ? Math.max(storyboardWeights.char2Primary, minChar2PrimaryWeight)
      : 0;
  const rawRenderWidth =
    typeof settings.renderWidth === "number" && Number.isFinite(settings.renderWidth) ? Math.max(64, Math.round(settings.renderWidth)) : 1920;
  const rawRenderHeight =
    typeof settings.renderHeight === "number" && Number.isFinite(settings.renderHeight) ? Math.max(64, Math.round(settings.renderHeight)) : 1080;
  const normalizedStoryboardSize =
    kind === "image"
      ? normalizeStoryboardStillRenderSize(settings, rawRenderWidth, rawRenderHeight)
      : { width: snapRenderSize(rawRenderWidth), height: snapRenderSize(rawRenderHeight) };
  const targetRenderWidth = normalizedStoryboardSize.width;
  const targetRenderHeight = normalizedStoryboardSize.height;
  const sceneContext = sceneAsset ? `场景参考：${sceneAsset.name}` : "";
  const cameraContext = shotCameraDescriptor(shot) ? `镜头机位：${shotCameraDescriptor(shot)}` : "";
  const characterContext =
    characterAssets.length > 0 ? `人物参考：${characterAssets.map((item) => item.name).join("、")}` : "";
  const compactPresencePrompt = buildCompactStoryboardPresencePrompt(characterAssets);
  const characterPresenceDirective = buildCharacterPresenceDirective(characterAssets);
  const blockingDirective = buildStoryboardBlockingDirective(shot, characterAssets);
  const stabilityDirective = buildStoryboardStabilityDirective(Boolean(sceneAsset), characterAssets.length > 0);
  const referenceDirective = buildShotReferenceDirective(shot, sceneAsset, skyboxFaces, characterAssets, continuityPlan);
  const promptBase = [
    promptBaseRaw,
    compactPresencePrompt,
    characterContext,
    sceneContext,
    cameraContext,
    referenceDirective,
    characterPresenceDirective,
    blockingDirective,
    stabilityDirective
  ]
    .filter((item) => item.length > 0)
    .join("\n");
  const nextScenePrompt = toNextScenePrompt(promptBase);
  const videoPrompt = toVideoPrompt(shot, mode);
  const storyboardFrameSeedPath =
    kind === "image"
      ? (
          (shouldPreferContinuitySeed ? continuitySceneSeedPath : "") ||
          sceneRefPath ||
          continuitySceneSeedPath ||
          defaultFramePath
        )
      : defaultFramePath;
  const firstFramePath = parseComfyViewPath(
    shot.videoStartFramePath?.trim() || defaultFramePath
  );
  const lastFramePath = parseComfyViewPath(
    shot.videoEndFramePath?.trim() || parseComfyViewPath(nextShot?.generatedImagePath ?? firstFramePath)
  );
  const characterAbsenceNegativePrompt =
    characterAssets.length > 0
      ? "empty scene, no people, no person, no human, scenery only, landscape only, character missing, no protagonist"
      : "";
  const characterCropNegativePrompt =
    characterAssets.length > 0
      ? "cropped body, cut off head, cut off face, cut off feet, out of frame, body out of frame, close-up crop, portrait crop, half body crop, knee-up crop, partial body, incomplete body"
      : "";
  const characterChaosNegativePrompt =
    characterAssets.length > 0
      ? "duplicated person, cloned person, mirror duplicate, twin body, double body, fused body, extra limbs, malformed anatomy, deformed hands, twisted posture, collage artifacts, split-screen layout"
      : "";
  const characterVisibilityNegativePrompt =
    characterAssets.length > 0
      ? "tiny person, distant tiny figure, far-away silhouette, person hidden behind objects, person fully occluded"
      : "";
  const structureChaosNegativePrompt =
    "surreal abstract texture, warped geometry, twisted architecture, melted buildings, melted bridge, warped riverbank, bent stone path, bent horizon, fisheye distortion, random scribble lines, chaotic glitch artifacts, smeared details";
  const identityDriftNegativePrompt =
    characterAssets.length > 0
      ? "unrelated character, wrong character identity, wrong face, wrong hairstyle, changed outfit, changed costume, changed color palette, different person, random passerby, stranger, background extra person"
      : "";
  const nsfwNegativePrompt =
    characterAssets.length > 0
      ? "nude, nsfw, explicit, erotic, porn, lingerie, bikini, underwear, exposed breasts, exposed nipples, exposed genitals, topless, bare chest, cleavage focus"
      : "";
  const portraitDriftNegativePrompt =
    characterAssets.length > 0
      ? "indoor selfie, bedroom portrait, glamour photo, fashion editorial, studio portrait crop, sitting on sofa, seated photo pose"
      : "";
  const stickerLookNegativePrompt =
    characterAssets.length > 0
      ? "sticker-like character, flat cutout look, pasted paper doll, separate foreground layer, white edge matte, hard cutout outline, mismatch lighting on character"
      : "";
  const performanceFailureNegativePrompt =
    characterAssets.length > 0
      ? "expressionless face, blank expression, dead face, mannequin pose, static pose, stiff standing, no visible motion, no acting, empty stare"
      : "";
  const continuityFailureNegativePrompt =
    characterAssets.length > 0
      ? "different hairstyle, different face, changed outfit, inconsistent costume, changed color palette, identity drift between shots"
      : "";
  const sanitizedShotNegativePrompt = sanitizeStoryboardNegativePrompt(
    shot.negativePrompt?.trim() || "",
    characterAssets.length > 0
  );
  const effectiveNegativePrompt = [
    sanitizedShotNegativePrompt,
    characterAbsenceNegativePrompt,
    characterCropNegativePrompt,
    characterChaosNegativePrompt,
    characterVisibilityNegativePrompt,
    structureChaosNegativePrompt,
    identityDriftNegativePrompt,
    nsfwNegativePrompt,
    portraitDriftNegativePrompt,
    stickerLookNegativePrompt,
    performanceFailureNegativePrompt,
    continuityFailureNegativePrompt
  ]
    .filter((item) => item.length > 0)
    .join(", ");
  const effectiveStoryboardModel = resolveStoryboardImageModel(settings, characterAssets.length > 0);
  const baseTokens: Record<string, string> = {
    ASSET_NAME_DIR: assetOutputContext?.assetName ?? "",
    SHOT_ID: shot.id,
    SHOT_TITLE: shot.title,
    SHOT_INDEX: String(index + 1),
    PROMPT: promptBase,
    NEXT_SCENE_PROMPT: nextScenePrompt,
    VIDEO_PROMPT: videoPrompt,
    VIDEO_MODE: mode === "first_last_frame" ? "FIRST_LAST_FRAME" : "SINGLE_FRAME",
    NEGATIVE_PROMPT: effectiveNegativePrompt,
    DIALOGUE: shot.dialogue?.trim() || "",
    SPEAKER_NAME: "",
    EMOTION: "",
    DELIVERY_STYLE: "",
    SPEECH_RATE: "",
    VOICE_PROFILE: characterVoiceProfiles[0] ?? "",
    CHARACTER_VOICE_PROFILES: characterVoiceProfiles.join(","),
    SEED: String(shot.seed ?? stableNumericId(`${shot.id}|${index}|${promptBaseRaw}`)),
    DURATION_FRAMES: String(Math.max(1, shot.durationFrames)),
    DURATION_SEC: String((shot.durationFrames / 24).toFixed(2)),
    CAMERA_YAW: typeof shot.cameraYaw === "number" && Number.isFinite(shot.cameraYaw) ? String(shot.cameraYaw) : "",
    CAMERA_PITCH: typeof shot.cameraPitch === "number" && Number.isFinite(shot.cameraPitch) ? String(shot.cameraPitch) : "",
    CAMERA_FOV: typeof shot.cameraFov === "number" && Number.isFinite(shot.cameraFov) ? String(shot.cameraFov) : "",
    RENDER_WIDTH: String(targetRenderWidth),
    RENDER_HEIGHT: String(targetRenderHeight),
    CHARACTER_REFS: resolvedCharacterAssets.map((item) => item.id).join(","),
    PREV_SCENE_SHOT_TITLE: continuityPlan.previousSceneShot?.title ?? "",
    PREV_SCENE_IMAGE_PATH: parseComfyViewPath(continuityPlan.previousSceneShot?.generatedImagePath ?? ""),
    PREV_CHARACTER_SHOT_TITLE: continuityPlan.previousCharacterShot?.title ?? "",
    PREV_CHARACTER_IMAGE_PATH: parseComfyViewPath(continuityPlan.previousCharacterShot?.generatedImagePath ?? ""),
    SCENE_REF_PATH: sceneRefPath,
    SCENE_REF_PATHS: sceneRefPath,
    SCENE_REF_NAME:
      sceneAsset?.type === "skybox"
        ? `${sceneAsset.name} (${(skyboxFaces.length > 0 ? skyboxFaces : ["front"]).join("+")})`
        : sceneAsset?.name ?? "",
    SKYBOX_FACE: (skyboxFaces[0] ?? "front").toUpperCase(),
    SKYBOX_FACES: skyboxFaces.map((face) => face.toUpperCase()).join(","),
    SKYBOX_FACE_PATHS: skyboxFacePaths.join(","),
    SKYBOX_FACE_WEIGHTS: skyboxFaceWeightsText,
    CHARACTER_REF_PATHS: characterAllViewPaths.join(","),
    CHARACTER_REF_NAMES: characterAssets.map((item) => item.name).join(","),
    PREFERRED_CHARACTER_VIEW: characterPlan.primaryView,
    CHARACTER_FRONT_PATHS: characterFrontPaths.join(","),
    CHARACTER_SIDE_PATHS: characterSidePaths.join(","),
    CHARACTER_BACK_PATHS: characterBackPaths.join(","),
    CHAR1_NAME: charSlots[0]?.name ?? "",
    CHAR1_FRONT_PATH: charSlots[0]?.characterFrontPath || charSlots[0]?.filePath || "",
    CHAR1_SIDE_PATH: charSlots[0]?.characterSidePath || "",
    CHAR1_BACK_PATH: charSlots[0]?.characterBackPath || "",
    CHAR2_NAME: charSlots[1]?.name ?? "",
    CHAR2_FRONT_PATH: charSlots[1]?.characterFrontPath || charSlots[1]?.filePath || "",
    CHAR2_SIDE_PATH: charSlots[1]?.characterSidePath || "",
    CHAR2_BACK_PATH: charSlots[1]?.characterBackPath || "",
    CHAR3_NAME: charSlots[2]?.name ?? "",
    CHAR3_FRONT_PATH: charSlots[2]?.characterFrontPath || charSlots[2]?.filePath || "",
    CHAR3_SIDE_PATH: charSlots[2]?.characterSidePath || "",
    CHAR3_BACK_PATH: charSlots[2]?.characterBackPath || "",
    CHAR4_NAME: charSlots[3]?.name ?? "",
    CHAR4_FRONT_PATH: charSlots[3]?.characterFrontPath || charSlots[3]?.filePath || "",
    CHAR4_SIDE_PATH: charSlots[3]?.characterSidePath || "",
    CHAR4_BACK_PATH: charSlots[3]?.characterBackPath || "",
    CHAR1_PRIMARY_PATH: char1PrimaryPath,
    CHAR1_SECONDARY_PATH: char1SecondaryPath,
    CHAR2_PRIMARY_PATH: char2PrimaryPath,
    CHAR2_SECONDARY_PATH: char2SecondaryPath,
    CHAR1_PRIMARY_WEIGHT: String(effectiveChar1PrimaryWeight),
    CHAR1_SECONDARY_WEIGHT: String(effectiveChar1SecondaryWeight),
    CHAR2_PRIMARY_WEIGHT: String(effectiveChar2PrimaryWeight),
    STORYBOARD_DENOISE: String(storyboardWeights.denoise),
    STORYBOARD_STEPS: String(storyboardWeights.steps),
    STORYBOARD_CFG: String(storyboardWeights.cfg),
    STORYBOARD_IMAGE_MODEL: effectiveStoryboardModel,
    POSE_GUIDE_PATH: "",
    FRAME_IMAGE_PATH: storyboardFrameSeedPath,
    FIRST_FRAME_PATH: firstFramePath,
    LAST_FRAME_PATH: lastFramePath,
    DIALOGUE_AUDIO_PATH: "",
    DIALOGUE_AUDIO_PATHS: "",
    DIALOGUE_AUDIO_COUNT: "0",
    HAS_DIALOGUE_AUDIO: "0"
  };
  return applyTokenAliases(mapping, baseTokens);
}

export async function pingComfyWithDetail(baseUrl: string): Promise<ComfyPingResult> {
  if (hasDesktopInvoke()) {
    return invokeDesktop<ComfyPingResult>("comfy_ping", { baseUrl: normalizeBaseUrl(baseUrl) });
  }
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/system_stats`, { method: "GET" });
    return {
      ok: response.ok,
      statusCode: response.status,
      message: response.ok ? "ComfyUI 可用（浏览器模式）" : `ComfyUI 返回 HTTP ${response.status}`
    };
  } catch (error) {
    return {
      ok: false,
      message: `浏览器模式连接失败：${String(error)}。建议使用桌面应用（npm run tauri dev）。`
    };
  }
}

export async function discoverComfyEndpoints(): Promise<string[]> {
  if (hasDesktopInvoke()) {
    const result = await invokeDesktop<ComfyDiscoverResult>("comfy_discover_endpoints");
    return result.found ?? [];
  }
  const candidates = [
    "http://127.0.0.1:8188",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:17888",
    "http://127.0.0.1:17788",
    "http://localhost:8188",
    "http://localhost:8000"
  ];
  const found: string[] = [];
  for (const base of candidates) {
    try {
      const response = await fetch(`${base}/system_stats`, { method: "GET" });
      if (response.ok) found.push(base);
    } catch {
      // ignore in browser fallback
    }
  }
  return found;
}

export async function discoverComfyLocalDirs(): Promise<{
  rootDir: string;
  inputDir: string;
  outputDir: string;
}> {
  if (!hasDesktopInvoke()) {
    return { rootDir: "", inputDir: "", outputDir: "" };
  }
  try {
    const result = await invokeDesktop<ComfyLocalDirsResult>("comfy_discover_local_dirs");
    return {
      rootDir: result.rootDir?.trim() ?? "",
      inputDir: result.inputDir?.trim() ?? "",
      outputDir: result.outputDir?.trim() ?? ""
    };
  } catch {
    return { rootDir: "", inputDir: "", outputDir: "" };
  }
}

export function validateWorkflowTemplate(
  workflowJson: string,
  mapping: ComfySettings["tokenMapping"],
  requiredTokens?: string[]
): { ok: boolean; missing: string[]; used: string[] } {
  const workflow = ensureWorkflowJson(workflowJson);
  const usedTokens = new Set<string>();
  collectTemplateTokens(workflow, usedTokens);
  if (usedTokens.size === 0) {
    // Some Comfy workflows rely on fixed node-id/widget binding (e.g. Fisher preset)
    // and do not use {{TOKEN}} placeholders at all. Treat this as valid.
    return { ok: true, missing: [], used: [] };
  }
  const promptCandidates =
    requiredTokens && requiredTokens.length > 0
      ? requiredTokens.map((token) => token.trim()).filter((token) => token.length > 0)
      : [
          mapping.prompt.trim() || "PROMPT",
          mapping.nextScenePrompt.trim() || "NEXT_SCENE_PROMPT",
          mapping.videoPrompt.trim() || "VIDEO_PROMPT"
        ];
  const hasPromptToken = promptCandidates.some((token) => usedTokens.has(token));
  const missing = hasPromptToken ? [] : promptCandidates;
  return {
    ok: missing.length === 0,
    missing,
    used: [...usedTokens].sort()
  };
}

export function inspectVideoWorkflowLipSyncSupport(
  workflowJson: string,
  mapping: ComfySettings["tokenMapping"]
): VideoWorkflowLipSyncSupport {
  const workflow = ensureWorkflowJson(workflowJson);
  return inspectWorkflowLipSyncSupportFromObject(workflow, mapping);
}

const NODE_HINT_MAP: Array<{ pattern: RegExp; plugin: string; repo: string }> = [
  { pattern: /qwen|qwenedit|imageeditplus/i, plugin: "qweneditutils", repo: "https://github.com/kijai/ComfyUI-Qwen-Image-Edit" },
  { pattern: /rgthree|power lora loader/i, plugin: "rgthree-comfy", repo: "https://github.com/rgthree/rgthree-comfy" },
  { pattern: /kjnodes|sageattention|modelpatchtorchsettings|intconstant|pathchsageattention/i, plugin: "ComfyUI-KJNodes", repo: "https://github.com/kijai/ComfyUI-KJNodes" },
  { pattern: /wan|wanvideo|wanmoe|wan.*ksampler/i, plugin: "ComfyUI-WanMoeKSampler / ComfyUI-wanBlockswap", repo: "https://github.com/stduhpf/ComfyUI-WanMoeKSampler" },
  { pattern: /impact|detailer|segs/i, plugin: "ComfyUI-Impact-Pack", repo: "https://github.com/ltdrdata/ComfyUI-Impact-Pack" },
  { pattern: /rmbg|rembg|background remover/i, plugin: "ComfyUI_RMBG", repo: "https://github.com/1038lab/ComfyUI-RMBG" },
  { pattern: /animatediff|motion/i, plugin: "ComfyUI-AnimateDiff-Evolved", repo: "https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved" },
  { pattern: /rife|vfi|frame interpolation/i, plugin: "comfyui-frame-interpolation", repo: "https://github.com/Fannovel16/ComfyUI-Frame-Interpolation" },
  { pattern: /controlnet|advancedcontrolnet|acn_/i, plugin: "ComfyUI-Advanced-ControlNet", repo: "https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet" },
  { pattern: /ipadapter/i, plugin: "comfyui_ipadapter_plus", repo: "https://github.com/cubiq/ComfyUI_IPAdapter_plus" },
  { pattern: /mvadapter|diffusersmv|ldmpipeline|viewselector|birefnet/i, plugin: "ComfyUI-MVAdapter", repo: "https://github.com/huanngzh/ComfyUI-MVAdapter" },
  { pattern: /equirectangular|cubemap|seam mask|roll image axes|circular padding|panorama/i, plugin: "ComfyUI_pytorch360convert", repo: "https://github.com/ProGamerGov/ComfyUI_pytorch360convert" },
  { pattern: /panoramaviewer/i, plugin: "ComfyUI_preview360panorama", repo: "https://github.com/ProGamerGov/ComfyUI_preview360panorama" },
  { pattern: /vhs|videohelper|loadvideo|savevideo/i, plugin: "comfyui-videohelpersuite", repo: "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite" },
  { pattern: /easy.*use/i, plugin: "comfyui-easy-use", repo: "https://github.com/yolain/ComfyUI-Easy-Use" }
];

function buildDependencyHints(missingNodeTypes: string[]): WorkflowDependencyHint[] {
  const hints: WorkflowDependencyHint[] = [];
  for (const nodeType of missingNodeTypes) {
    for (const rule of NODE_HINT_MAP) {
      if (!rule.pattern.test(nodeType)) continue;
      if (hints.some((item) => item.plugin === rule.plugin)) continue;
      hints.push({ plugin: rule.plugin, repo: rule.repo });
    }
  }
  return hints;
}

async function fetchObjectInfo(baseUrl: string): Promise<Record<string, unknown>> {
  if (hasDesktopInvoke()) {
    return invokeDesktop<Record<string, unknown>>("comfy_get_object_info", { baseUrl: normalizeBaseUrl(baseUrl) });
  }
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/object_info`, { method: "GET" });
  if (!response.ok) {
    throw new Error(`读取 object_info 失败：HTTP ${response.status}`);
  }
  const parsed = (await response.json()) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("object_info 格式异常");
  }
  return parsed as Record<string, unknown>;
}

function extractStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) {
      return value.map((item) => item.trim()).filter((item) => item.length > 0);
    }
    for (const item of value) {
      const nested = extractStringList(item);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

export async function listComfyCheckpointOptions(baseUrl: string): Promise<string[]> {
  const objectInfo = await fetchObjectInfo(baseUrl);
  const loader = objectInfo["CheckpointLoaderSimple"];
  if (!loader || typeof loader !== "object") return [];
  const input = (loader as { input?: Record<string, unknown> }).input;
  if (!input || typeof input !== "object") return [];
  const required = (input as { required?: Record<string, unknown> }).required;
  if (!required || typeof required !== "object") return [];
  return extractStringList((required as Record<string, unknown>).ckpt_name);
}

export async function inspectWorkflowDependencies(
  baseUrl: string,
  workflowJson: string
): Promise<WorkflowDependencyReport> {
  const workflow = ensureWorkflowJson(workflowJson);
  const requiredNodeTypes = extractWorkflowNodeTypes(workflow);
  if (requiredNodeTypes.length === 0) {
    return {
      totalNodeTypes: 0,
      availableNodeTypes: 0,
      missingNodeTypes: [],
      hints: []
    };
  }
  const objectInfo = await fetchObjectInfo(baseUrl);
  const availableTypes = new Set(Object.keys(objectInfo));
  const missingNodeTypes = requiredNodeTypes.filter((type) => !availableTypes.has(type));
  return {
    totalNodeTypes: requiredNodeTypes.length,
    availableNodeTypes: requiredNodeTypes.length - missingNodeTypes.length,
    missingNodeTypes,
    hints: buildDependencyHints(missingNodeTypes)
  };
}

export async function installSuggestedPlugins(
  comfyRootDir: string,
  hints: WorkflowDependencyHint[]
): Promise<PluginInstallReport> {
  const root = comfyRootDir.trim();
  if (!root) throw new Error("ComfyUI 根目录为空，请先配置 ComfyUI 根目录");
  const repos = uniquePreserveOrder(hints.map((item) => item.repo.trim()).filter((item) => item.length > 0));
  if (repos.length === 0) {
    return { installed: [], skipped: [], failed: [] };
  }
  return invokeDesktop<PluginInstallReport>("comfy_install_plugins", {
    comfyRootDir: root,
    repos
  });
}

export async function checkComfyModelHealth(comfyRootDir: string): Promise<ComfyModelHealthReport> {
  const root = comfyRootDir.trim();
  if (!root) throw new Error("ComfyUI 根目录为空，请先配置 ComfyUI 根目录");
  return invokeDesktop<ComfyModelHealthReport>("comfy_check_model_health", {
    comfyRootDir: root
  });
}

function isLikelyComfyApiPrompt(workflow: Record<string, unknown>): boolean {
  const entries = Object.entries(workflow).filter(([key]) => key !== "extra_data" && key !== "client_id");
  if (entries.length === 0) return false;
  const sampleCount = Math.min(entries.length, 8);
  let matched = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const [, value] = entries[index]!;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const node = value as Record<string, unknown>;
    if (typeof node.class_type !== "string") continue;
    if (!node.inputs || typeof node.inputs !== "object" || Array.isArray(node.inputs)) continue;
    matched += 1;
  }
  return matched >= Math.max(1, Math.floor(sampleCount / 2));
}

function isNodeDisabled(node: WorkflowNode): boolean {
  return typeof node.mode === "number" && node.mode === 4;
}

function hasWidgetMeta(input: Record<string, unknown>): boolean {
  return Boolean(input.widget) && typeof input.widget === "object" && !Array.isArray(input.widget);
}

function inputTypeValue(input: Record<string, unknown>): unknown {
  return input.type;
}

const WIDGET_ONLY_INPUT_FALLBACKS: Record<string, string[]> = {
  LoadImage: ["image", "upload"],
  ConditioningAverage: ["conditioning_to_strength"],
  CLIPTextEncode: ["text"],
  SaveImage: ["filename_prefix"],
  PrimitiveInt: ["value"],
  UNETLoader: ["unet_name", "weight_dtype"],
  DualCLIPLoader: ["clip_name1", "clip_name2", "type", "device"],
  VAELoader: ["vae_name"],
  RMBG: [
    "model",
    "sensitivity",
    "process_res",
    "mask_blur",
    "mask_offset",
    "background_color",
    "invert_output",
    "background",
    "refine_foreground"
  ],
  ImageResizeKJv2: [
    "width",
    "height",
    "upscale_method",
    "keep_proportion",
    "pad_color",
    "crop_position",
    "divisible_by",
    "device"
  ],
  ImageStitch: ["direction", "match_image_size", "spacing_width", "spacing_color"],
  EmptySD3LatentImage: ["width", "height", "batch_size"],
  FluxGuidance: ["guidance"],
  PathchSageAttentionKJ: ["sage_attention", "allow_compile"],
  PatchModelPatcherOrder: ["patch_order", "full_load"]
};

function isNumericString(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !Number.isNaN(Number(trimmed));
}

function isValueCompatibleForInputType(value: unknown, type: unknown): boolean {
  if (Array.isArray(type)) {
    if (type.length === 0) return true;
    return type.some((item) => String(item) === String(value));
  }
  if (typeof type !== "string") return true;
  const normalized = type.toUpperCase();
  if (normalized === "INT") {
    if (typeof value === "number") return Number.isFinite(value) && Number.isInteger(value);
    if (typeof value === "string") return isNumericString(value) && Number.isInteger(Number(value));
    return false;
  }
  if (normalized === "FLOAT" || normalized === "DOUBLE" || normalized === "NUMBER") {
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "string") return isNumericString(value);
    return false;
  }
  if (normalized === "BOOLEAN") {
    if (typeof value === "boolean") return true;
    if (typeof value === "number") return value === 0 || value === 1;
    if (typeof value === "string") {
      const lower = value.trim().toLowerCase();
      return lower === "true" || lower === "false" || lower === "0" || lower === "1";
    }
    return false;
  }
  if (normalized === "STRING") {
    return typeof value === "string";
  }
  // For COMBO and custom types, accept broad values.
  return true;
}

function objectInfoInputOrderNames(objectInfo: Record<string, unknown> | undefined, classType: string): string[] {
  if (!objectInfo || !classType.trim()) return [];
  const classInfo = objectInfo[classType];
  if (!classInfo || typeof classInfo !== "object" || Array.isArray(classInfo)) return [];
  const inputOrder = (classInfo as { input_order?: unknown }).input_order;
  const ordered: string[] = [];
  const appendBucketNames = (container: unknown, bucket: "required" | "optional") => {
    if (!container || typeof container !== "object" || Array.isArray(container)) return;
    const names = (container as Record<string, unknown>)[bucket];
    if (!Array.isArray(names)) return;
    for (const name of names) {
      if (typeof name !== "string") continue;
      const trimmed = name.trim();
      if (!trimmed) continue;
      ordered.push(trimmed);
    }
  };
  if (inputOrder && typeof inputOrder === "object" && !Array.isArray(inputOrder)) {
    for (const bucket of ["required", "optional"] as const) {
      appendBucketNames(inputOrder, bucket);
    }
  }
  if (ordered.length > 0) return ordered;
  const input = (classInfo as { input?: unknown }).input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  for (const bucket of ["required", "optional"] as const) {
    const entries = (input as Record<string, unknown>)[bucket];
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
    for (const key of Object.keys(entries)) {
      const trimmed = key.trim();
      if (!trimmed) continue;
      ordered.push(trimmed);
    }
  }
  return ordered;
}

function buildWidgetFallbackNames(
  node: WorkflowNode,
  widgetInputs: Array<Record<string, unknown>>,
  objectInfo?: Record<string, unknown>
): string[] {
  const nodeType = typeof node.type === "string" ? node.type.trim() : "";
  const explicitFallback = WIDGET_ONLY_INPUT_FALLBACKS[nodeType];
  if (explicitFallback && explicitFallback.length > 0) {
    return explicitFallback;
  }
  if (objectInfo && nodeType) {
    const orderedNames = objectInfoInputOrderNames(objectInfo, nodeType);
    if (orderedNames.length > 0) {
      const excludedNames = new Set<string>();
      const nodeInputs = Array.isArray(node.inputs) ? node.inputs : [];
      for (const rawInput of nodeInputs) {
        if (!rawInput || typeof rawInput !== "object") continue;
        const input = rawInput as Record<string, unknown>;
        const name = typeof input.name === "string" ? input.name.trim() : "";
        if (!name) continue;
        const hasLink = typeof input.link === "number";
        if (hasLink || hasWidgetMeta(input)) {
          excludedNames.add(name);
        }
      }
      for (const input of widgetInputs) {
        const name = typeof input.name === "string" ? input.name.trim() : "";
        if (!name) continue;
        excludedNames.add(name);
      }
      const derived = orderedNames.filter((name) => !excludedNames.has(name));
      if (derived.length > 0) return derived;
    }
  }
  return [];
}

function getWorkflowVariableNodeName(node: WorkflowNode): string {
  const widgets = node.widgets_values;
  if (Array.isArray(widgets) && typeof widgets[0] === "string" && widgets[0].trim()) {
    return widgets[0].trim();
  }
  const properties = (node as { properties?: unknown }).properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    const previousName = (properties as Record<string, unknown>).previousName;
    if (typeof previousName === "string" && previousName.trim()) {
      return previousName.trim();
    }
  }
  return "";
}

function buildWidgetValuesByInputName(
  node: WorkflowNode,
  objectInfo?: Record<string, unknown>
): Record<string, unknown> {
  const nodeInputs = Array.isArray(node.inputs) ? node.inputs : [];
  const output: Record<string, unknown> = {};
  const widgetValues = node.widgets_values;
  if (widgetValues && typeof widgetValues === "object" && !Array.isArray(widgetValues)) {
    for (const rawInput of nodeInputs) {
      if (!rawInput || typeof rawInput !== "object") continue;
      const input = rawInput as Record<string, unknown>;
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!name || !hasWidgetMeta(input)) continue;
      if (Object.prototype.hasOwnProperty.call(widgetValues, name)) {
        output[name] = (widgetValues as Record<string, unknown>)[name];
      }
    }
    return output;
  }

  const widgets = Array.isArray(widgetValues) ? widgetValues : [];
  if (widgets.length === 0) return output;

  const widgetInputs = nodeInputs.filter(
    (rawInput) =>
      rawInput &&
      typeof rawInput === "object" &&
      hasWidgetMeta(rawInput as Record<string, unknown>) &&
      typeof (rawInput as Record<string, unknown>).name === "string"
  ) as Array<Record<string, unknown>>;

  let cursor = 0;
  for (const input of widgetInputs) {
    const name = String(input.name).trim();
    if (!name) continue;
    const expectedType = inputTypeValue(input);
    let chosenIndex = -1;
    for (let idx = cursor; idx < widgets.length; idx += 1) {
      const candidate = widgets[idx];
      if (!isValueCompatibleForInputType(candidate, expectedType)) continue;
      chosenIndex = idx;
      break;
    }
    if (chosenIndex < 0) {
      if (cursor >= widgets.length) break;
      chosenIndex = cursor;
    }
    const value = widgets[chosenIndex];
    cursor = chosenIndex + 1;
    output[name] = value;
  }

  const fallbackNames = buildWidgetFallbackNames(node, widgetInputs, objectInfo);
  for (let index = 0; index < fallbackNames.length; index += 1) {
    const name = fallbackNames[index] ?? "";
    if (!name || Object.prototype.hasOwnProperty.call(output, name)) continue;
    const widgetIndex = cursor + index;
    if (widgetIndex >= widgets.length) break;
    output[name] = widgets[widgetIndex];
  }
  return output;
}

function buildSetNodeSourceLinkByName(nodes: WorkflowNode[]): Map<string, number> {
  const mapping = new Map<string, number>();
  for (const node of nodes) {
    if (isNodeDisabled(node)) continue;
    if ((node.type ?? "").trim() !== "SetNode") continue;
    const name = getWorkflowVariableNodeName(node);
    if (!name) continue;
    const nodeInputs = Array.isArray(node.inputs) ? node.inputs : [];
    const linkId = typeof nodeInputs[0]?.link === "number" ? nodeInputs[0].link : null;
    if (typeof linkId === "number") {
      mapping.set(name, linkId);
    }
  }
  return mapping;
}

function resolveWorkflowSourceNode(
  nodeId: string,
  outputSlot: number,
  nodeById: Map<string, WorkflowNode>,
  linkById: Map<number, WorkflowLink>,
  setNodeSourceLinkByName: Map<string, number>,
  seenAliases: Set<string> = new Set(),
  seenNodes: Set<string> = new Set()
): [string, number] | null {
  if (seenNodes.has(nodeId)) return null;
  seenNodes.add(nodeId);
  const node = nodeById.get(nodeId);
  const nodeType = typeof node?.type === "string" ? node.type.trim() : "";
  if (nodeType === "GetNode") {
    const alias = node ? getWorkflowVariableNodeName(node) : "";
    if (!alias || seenAliases.has(alias)) return null;
    seenAliases.add(alias);
    const sourceLinkId = setNodeSourceLinkByName.get(alias);
    if (typeof sourceLinkId !== "number") return null;
    return resolveWorkflowLinkedSource(
      sourceLinkId,
      nodeById,
      linkById,
      setNodeSourceLinkByName,
      seenAliases,
      seenNodes
    );
  }
  if (nodeType === "SetNode") {
    const nodeInputs = Array.isArray(node?.inputs) ? node.inputs : [];
    const sourceLinkId = typeof nodeInputs[0]?.link === "number" ? nodeInputs[0].link : null;
    if (typeof sourceLinkId !== "number") return null;
    return resolveWorkflowLinkedSource(
      sourceLinkId,
      nodeById,
      linkById,
      setNodeSourceLinkByName,
      seenAliases,
      seenNodes
    );
  }
  return [nodeId, outputSlot];
}

function resolveWorkflowLinkedSource(
  linkId: number,
  nodeById: Map<string, WorkflowNode>,
  linkById: Map<number, WorkflowLink>,
  setNodeSourceLinkByName: Map<string, number>,
  seenAliases: Set<string> = new Set(),
  seenNodes: Set<string> = new Set()
): [string, number] | null {
  const link = linkById.get(linkId);
  if (!link) return null;
  return resolveWorkflowSourceNode(
    String(link[1]),
    Number(link[2]),
    nodeById,
    linkById,
    setNodeSourceLinkByName,
    seenAliases,
    seenNodes
  );
}

function graphWorkflowToApiPrompt(
  workflow: Record<string, unknown>,
  objectInfo?: Record<string, unknown>
): Record<string, unknown> {
  const nodes = workflowNodes(workflow);
  if (nodes.length === 0) return {};
  const activeNodeIds = new Set<string>();
  const nodeById = new Map<string, WorkflowNode>();
  for (const node of nodes) {
    if (isNodeDisabled(node)) continue;
    const id = typeof node.id === "number" || typeof node.id === "string" ? String(node.id) : "";
    if (!id) continue;
    activeNodeIds.add(id);
    nodeById.set(id, node);
  }
  const links = workflowLinks(workflow);
  const linkById = new Map<number, WorkflowLink>();
  const linkedNodeIds = new Set<string>();
  for (const link of links) {
    if (!Array.isArray(link) || typeof link[0] !== "number") continue;
    const sourceNodeId = String(link[1]);
    const targetNodeId = String(link[3]);
    if (!activeNodeIds.has(sourceNodeId) || !activeNodeIds.has(targetNodeId)) continue;
    linkById.set(link[0], link);
    linkedNodeIds.add(sourceNodeId);
    linkedNodeIds.add(targetNodeId);
  }
  const setNodeSourceLinkByName = buildSetNodeSourceLinkByName(nodes);
  const prompt: Record<string, unknown> = {};
  for (const node of nodes) {
    if (isNodeDisabled(node)) continue;
    const nodeIdRaw = (node as { id?: unknown }).id;
    const nodeType = typeof node.type === "string" ? node.type.trim() : "";
    if (!nodeType) continue;
    if (isVirtualGraphOnlyNodeType(nodeType)) continue;
    const nodeId =
      typeof nodeIdRaw === "number" || typeof nodeIdRaw === "string"
        ? String(nodeIdRaw)
        : "";
    if (!nodeId) continue;
    if (!linkedNodeIds.has(nodeId)) continue;

    const inputValues: Record<string, unknown> = {};
    const nodeInputs = Array.isArray(node.inputs) ? node.inputs : [];
    const widgetByInputName = buildWidgetValuesByInputName(node, objectInfo);

    for (const rawInput of nodeInputs) {
      if (!rawInput || typeof rawInput !== "object") continue;
      const input = rawInput as Record<string, unknown>;
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!name) continue;

      const linkId = typeof input.link === "number" ? input.link : null;
      if (typeof linkId === "number") {
        const resolvedLink = resolveWorkflowLinkedSource(linkId, nodeById, linkById, setNodeSourceLinkByName);
        if (resolvedLink) {
          inputValues[name] = resolvedLink;
          continue;
        }
        const link = linkById.get(linkId);
        if (link) {
          inputValues[name] = [String(link[1]), Number(link[2])];
          continue;
        }
      }

      if (Object.prototype.hasOwnProperty.call(widgetByInputName, name)) {
        inputValues[name] = widgetByInputName[name];
      }
    }

    for (const [name, value] of Object.entries(widgetByInputName)) {
      if (Object.prototype.hasOwnProperty.call(inputValues, name)) continue;
      inputValues[name] = value;
    }

    prompt[nodeId] = {
      class_type: nodeType,
      inputs: inputValues
    };
  }
  return prompt;
}

function normalizeWorkflowForQueue(
  workflow: Record<string, unknown>,
  objectInfo?: Record<string, unknown>
): Record<string, unknown> {
  if (isLikelyComfyApiPrompt(workflow)) {
    return workflow;
  }
  const hasGraphNodes = Array.isArray((workflow as { nodes?: unknown }).nodes);
  if (!hasGraphNodes) {
    return workflow;
  }
  const converted = graphWorkflowToApiPrompt(workflow, objectInfo);
  if (Object.keys(converted).length === 0) {
    throw new Error("工作流转换失败：无法从 nodes/links 生成 Comfy API prompt");
  }
  return converted;
}

async function queueComfyPrompt(
  baseUrl: string,
  workflow: Record<string, unknown>,
  objectInfo?: Record<string, unknown>
): Promise<string> {
  const prompt = normalizeWorkflowForQueue(workflow, objectInfo);
  if (objectInfo) {
    applyComfyModelOptionBindings(prompt, objectInfo);
  }
  ensureComfyProgressSocket(baseUrl);
  return invokeDesktop<string>("comfy_queue_prompt", {
    baseUrl: normalizeBaseUrl(baseUrl),
    prompt,
    clientId: comfyWsClientId
  });
}

function collectOutputAssets(raw: unknown): ComfyOutputAsset[] {
  if (!raw || typeof raw !== "object") return [];
  const promptNode = raw as Record<string, unknown>;
  const outputs = promptNode.outputs;
  if (!outputs || typeof outputs !== "object") return [];
  const assets: ComfyOutputAsset[] = [];
  const seen = new Set<string>();
  const pushAsset = (asset: ComfyOutputAsset, mediaKind?: "image" | "video" | "audio") => {
    const key = `${asset.filename}::${asset.subfolder ?? ""}::${asset.type ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    assets.push(mediaKind ? { ...asset, mediaKind } : asset);
  };
  for (const nodeOutput of Object.values(outputs as Record<string, unknown>)) {
    const current = nodeOutput as ComfyHistoryNode;
    if (Array.isArray(current.images)) {
      current.images.forEach((asset) => pushAsset(asset, "image"));
    }
    if (Array.isArray(current.gifs)) {
      current.gifs.forEach((asset) => pushAsset(asset, "video"));
    }
    if (Array.isArray(current.videos)) {
      current.videos.forEach((asset) => pushAsset(asset, "video"));
    }
    if (Array.isArray(current.audio)) {
      current.audio.forEach((asset) => pushAsset(asset, "audio"));
    }
    if (Array.isArray(current.audios)) {
      current.audios.forEach((asset) => pushAsset(asset, "audio"));
    }
    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      if (key === "images" || key === "gifs" || key === "videos" || key === "audio" || key === "audios") continue;
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const maybeAsset = item as Record<string, unknown>;
        if (typeof maybeAsset.filename !== "string" || maybeAsset.filename.trim().length === 0) continue;
        const normalized: ComfyOutputAsset = {
          filename: maybeAsset.filename.trim(),
          subfolder: typeof maybeAsset.subfolder === "string" ? maybeAsset.subfolder : "",
          type: typeof maybeAsset.type === "string" ? maybeAsset.type : "output"
        };
        const ext = filenameExtension(normalized.filename);
        const lowerKey = key.toLowerCase();
        const inferredKind: "image" | "video" | "audio" =
          AUDIO_FILE_EXTENSIONS.has(ext) || lowerKey.includes("audio")
            ? "audio"
            : VIDEO_FILE_EXTENSIONS.has(ext) || lowerKey.includes("video") || lowerKey.includes("gif")
              ? "video"
              : "image";
        pushAsset(normalized, inferredKind);
      }
    }
  }
  return assets;
}

function workflowHasNodeType(workflow: Record<string, unknown>, targetType: string): boolean {
  const normalizedTarget = targetType.trim();
  if (!normalizedTarget) return false;
  if (Array.isArray(workflow.nodes)) {
    return extractWorkflowNodeTypes(workflow).includes(normalizedTarget);
  }
  return Object.values(workflow).some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    return String((entry as Record<string, unknown>).class_type ?? "").trim() === normalizedTarget;
  });
}

function adaptBuiltinStoryboardWorkflowForShot(
  workflow: Record<string, unknown>,
  tokens: Record<string, string>,
  objectInfo?: Record<string, unknown>
): void {
  const sceneRefPath = String(tokens.SCENE_REF_PATH ?? "").trim();
  const frameImagePath = String(tokens.FRAME_IMAGE_PATH ?? "").trim();
  const poseGuidePath = String(tokens.POSE_GUIDE_PATH ?? "").trim();
  const char1PrimaryPath = String(tokens.CHAR1_PRIMARY_PATH ?? "").trim();
  const char1SecondaryPath = String(tokens.CHAR1_SECONDARY_PATH ?? "").trim();
  const char2PrimaryPath = String(tokens.CHAR2_PRIMARY_PATH ?? "").trim();
  const char2SecondaryPath = String(tokens.CHAR2_SECONDARY_PATH ?? "").trim();
  const storyboardModel = String(tokens.STORYBOARD_IMAGE_MODEL ?? "").trim() || "realisticVisionV60B1_v51VAE.safetensors";
  const hasCharacters = char1PrimaryPath.length > 0 || char2PrimaryPath.length > 0;
  const hasSceneRef = sceneRefPath.length > 0;
  const usePoseGuide = poseGuidePath.length > 0;
  if (!hasCharacters || !hasSceneRef) return;

  const checkpointNode = workflow["1"];
  const samplerNode = workflow["13"];
  const sceneAdapterNode = workflow["17"];
  const char1AdapterNode = workflow["8"];
  const char1SecondaryAdapterNode = workflow["10"];
  const char2AdapterNode = workflow["12"];
  const controlNetLoaderNode = workflow["19"];
  const controlNetNode = workflow["20"];
  if (
    !samplerNode ||
    !sceneAdapterNode ||
    typeof samplerNode !== "object" ||
    typeof sceneAdapterNode !== "object"
  ) {
    return;
  }

  const samplerClass = String((samplerNode as Record<string, unknown>).class_type ?? "").trim();
  const sceneAdapterClass = String((sceneAdapterNode as Record<string, unknown>).class_type ?? "").trim();
  if (samplerClass !== "KSampler" || sceneAdapterClass !== "IPAdapterAdvanced") return;

  const controlNetChoice = resolveStoryboardControlNetChoice(storyboardModel, usePoseGuide, objectInfo);
  if (controlNetChoice.qualityError) {
    throw new Error(controlNetChoice.qualityError);
  }
  const effectiveStoryboardModel = controlNetChoice.checkpointOverride ?? storyboardModel;

  if (checkpointNode && typeof checkpointNode === "object") {
    const checkpointInputs = (checkpointNode as Record<string, unknown>).inputs;
    if (checkpointInputs && typeof checkpointInputs === "object" && !Array.isArray(checkpointInputs)) {
      (checkpointInputs as Record<string, unknown>).ckpt_name = effectiveStoryboardModel;
    }
  }

  const renderWidth = Math.max(64, Number.parseInt(String(tokens.RENDER_WIDTH ?? "1024"), 10) || 1024);
  const renderHeight = Math.max(64, Number.parseInt(String(tokens.RENDER_HEIGHT ?? "576"), 10) || 576);
  const hasSecondCharacter = char2PrimaryPath.length > 0;
  const lockCharacterIdentityAndCount = usePoseGuide && hasSecondCharacter;
  const useCompositeFrameSeed = lockCharacterIdentityAndCount && frameImagePath.length > 0;
  const hasFrameSeed = frameImagePath.length > 0 && (!usePoseGuide || useCompositeFrameSeed);
  const shotScale = inferStoryboardCompositeScaleFromCorpus(
    compactTextParts(tokens.SHOT_TITLE, tokens.STORY_PROMPT, tokens.NOTES, tokens.DIALOGUE).toLowerCase()
  );
  const samplerInputs =
    typeof (samplerNode as Record<string, unknown>).inputs === "object" &&
    (samplerNode as Record<string, unknown>).inputs &&
    !Array.isArray((samplerNode as Record<string, unknown>).inputs)
      ? ((samplerNode as Record<string, unknown>).inputs as Record<string, unknown>)
      : null;
  const sceneAdapterInputs =
    typeof (sceneAdapterNode as Record<string, unknown>).inputs === "object" &&
    (sceneAdapterNode as Record<string, unknown>).inputs &&
    !Array.isArray((sceneAdapterNode as Record<string, unknown>).inputs)
      ? ((sceneAdapterNode as Record<string, unknown>).inputs as Record<string, unknown>)
      : null;
  const char1AdapterInputs =
    typeof (char1AdapterNode as Record<string, unknown>)?.inputs === "object" &&
    (char1AdapterNode as Record<string, unknown>).inputs &&
    !Array.isArray((char1AdapterNode as Record<string, unknown>).inputs)
      ? ((char1AdapterNode as Record<string, unknown>).inputs as Record<string, unknown>)
      : null;
  const char1SecondaryAdapterInputs =
    typeof (char1SecondaryAdapterNode as Record<string, unknown>)?.inputs === "object" &&
    (char1SecondaryAdapterNode as Record<string, unknown>).inputs &&
    !Array.isArray((char1SecondaryAdapterNode as Record<string, unknown>).inputs)
      ? ((char1SecondaryAdapterNode as Record<string, unknown>).inputs as Record<string, unknown>)
      : null;
  const controlNetLoaderInputs =
    typeof (controlNetLoaderNode as Record<string, unknown>)?.inputs === "object" &&
    (controlNetLoaderNode as Record<string, unknown>).inputs &&
    !Array.isArray((controlNetLoaderNode as Record<string, unknown>).inputs)
      ? ((controlNetLoaderNode as Record<string, unknown>).inputs as Record<string, unknown>)
      : null;
  const controlNetInputs =
    typeof (controlNetNode as Record<string, unknown>)?.inputs === "object" &&
    (controlNetNode as Record<string, unknown>).inputs &&
    !Array.isArray((controlNetNode as Record<string, unknown>).inputs)
      ? ((controlNetNode as Record<string, unknown>).inputs as Record<string, unknown>)
      : null;
  const workflowRef = (nodeId: string | number, outputIndex = 0) => [String(nodeId), outputIndex];

  const updateAdapterWeight = (
    node: unknown,
    fallbackWeight: number,
    mode: "at_least" | "cap_at_most" = "at_least",
    fallbackEndAt?: number
  ) => {
    if (!node || typeof node !== "object") return;
    const inputs = (node as Record<string, unknown>).inputs;
    if (!inputs || typeof inputs !== "object") return;
    const currentWeight = Number((inputs as Record<string, unknown>).weight);
    const safeFallback = Number.isFinite(fallbackWeight) ? fallbackWeight : 0;
    const resolvedWeight =
      mode === "cap_at_most"
        ? (Number.isFinite(currentWeight) ? Math.min(currentWeight, safeFallback) : safeFallback)
        : (Number.isFinite(currentWeight) ? Math.max(currentWeight, safeFallback) : safeFallback);
    (inputs as Record<string, unknown>).weight = resolvedWeight;
    const resolvedEndAt =
      typeof fallbackEndAt === "number" && Number.isFinite(fallbackEndAt)
        ? fallbackEndAt
        : resolvedWeight >= 0.78
          ? 1.0
          : resolvedWeight >= 0.62
            ? 0.9
            : 0.72;
    (inputs as Record<string, unknown>).end_at = resolvedEndAt;
  };
  const clampAdapterWeight = (
    node: unknown,
    minWeight: number,
    maxWeight: number,
    fallbackEndAt?: number
  ) => {
    if (!node || typeof node !== "object") return;
    const inputs = (node as Record<string, unknown>).inputs;
    if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return;
    const currentWeight = Number((inputs as Record<string, unknown>).weight);
    const safeMin = Number.isFinite(minWeight) ? minWeight : 0;
    const safeMax = Number.isFinite(maxWeight) ? Math.max(safeMin, maxWeight) : safeMin;
    const resolvedWeight = Number.isFinite(currentWeight)
      ? Math.min(safeMax, Math.max(safeMin, currentWeight))
      : safeMin;
    (inputs as Record<string, unknown>).weight = resolvedWeight;
    (inputs as Record<string, unknown>).end_at =
      typeof fallbackEndAt === "number" && Number.isFinite(fallbackEndAt)
        ? fallbackEndAt
        : resolvedWeight >= 0.92
          ? 0.92
          : resolvedWeight >= 0.78
            ? 0.84
            : 0.72;
  };
  const disableAdapter = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const inputs = (node as Record<string, unknown>).inputs;
    if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return;
    (inputs as Record<string, unknown>).weight = 0;
    (inputs as Record<string, unknown>).start_at = 0;
    (inputs as Record<string, unknown>).end_at = 0;
  };

  // Dual-character storyboard shots are stabilized by reusing the composed
  // scene+character frame as a low-denoise seed. This keeps count and blocking
  // far more stable than asking the model to redraw both actors from a blank
  // scene latent on every shot.
  if (hasFrameSeed) {
    workflow["21"] = {
      inputs: {
        image: frameImagePath,
        upload: "image"
      },
      class_type: "LoadImage"
    };
  } else if (workflow["21"]) {
    delete workflow["21"];
  }
  workflow["16"] = {
    inputs: {
      image: hasFrameSeed ? ["21", 0] : ["2", 0],
      upscale_method: "lanczos",
      width: renderWidth,
      height: renderHeight,
      crop: hasFrameSeed ? "disabled" : "center"
    },
    class_type: "ImageScale"
  };
  workflow["3"] = {
    inputs: {
      pixels: ["16", 0],
      vae: ["1", 2]
    },
    class_type: "VAEEncode"
  };
  if (usePoseGuide) {
    workflow["18"] = {
      inputs: {
        image: poseGuidePath,
        upload: "image"
      },
      class_type: "LoadImage"
    };
  } else if (workflow["18"] && typeof workflow["18"] === "object") {
    const cannyInputs = (workflow["18"] as Record<string, unknown>).inputs;
    if (cannyInputs && typeof cannyInputs === "object" && !Array.isArray(cannyInputs)) {
      (cannyInputs as Record<string, unknown>).image = hasFrameSeed ? ["16", 0] : ["2", 0];
      (cannyInputs as Record<string, unknown>).low_threshold = hasFrameSeed ? 0.06 : 0.1;
      (cannyInputs as Record<string, unknown>).high_threshold = hasFrameSeed ? 0.22 : 0.4;
    }
  }
  if (controlNetLoaderInputs) {
    controlNetLoaderInputs.control_net_name = controlNetChoice.controlNetName ?? (usePoseGuide
      ? "control_v11p_sd15_openpose.pth"
      : "control_v11p_sd15_canny.pth");
  }

  const hasViewSpecificChar1 = char1SecondaryPath.length > 0 && char1SecondaryPath !== char1PrimaryPath;
  const hasViewSpecificChar2 = char2SecondaryPath.length > 0 && char2SecondaryPath !== char2PrimaryPath;
  const enableSecondaryIdentityViews = usePoseGuide ? !lockCharacterIdentityAndCount : true;
  const enableChar2ViewAdapter = enableSecondaryIdentityViews && usePoseGuide && hasSecondCharacter && hasViewSpecificChar2;
  if (enableChar2ViewAdapter) {
    workflow["22"] = {
      inputs: {
        image: char2SecondaryPath,
        upload: "image"
      },
      class_type: "LoadImage"
    };
  } else if (workflow["22"]) {
    delete workflow["22"];
  }
  if (char1AdapterInputs) {
    char1AdapterInputs.model = workflowRef(enableChar2ViewAdapter ? "17" : "6");
  }
  if (sceneAdapterInputs) {
    if (enableChar2ViewAdapter) {
      sceneAdapterInputs.model = workflowRef("6");
      sceneAdapterInputs.ipadapter = workflowRef("6", 1);
      sceneAdapterInputs.image = workflowRef("22");
      sceneAdapterInputs.weight = shotScale === "close" ? 0.24 : shotScale === "medium" ? 0.22 : 0.18;
      sceneAdapterInputs.weight_type = "linear";
      sceneAdapterInputs.combine_embeds = "concat";
      sceneAdapterInputs.start_at = 0;
      sceneAdapterInputs.end_at = 0.58;
      sceneAdapterInputs.embeds_scaling = "V only";
    } else {
      // Fully bypass the legacy scene IPAdapter. Weight=0 alone is not enough because
      // the node still encodes the wide scene image, reintroducing crop bias and hidden drift.
      disableAdapter(sceneAdapterNode);
    }
  }

  const denoiseTarget =
    lockCharacterIdentityAndCount
      ? shotScale === "close"
        ? useCompositeFrameSeed
          ? 0.4
          : 0.42
        : shotScale === "medium"
          ? useCompositeFrameSeed
            ? 0.38
            : 0.4
          : useCompositeFrameSeed
            ? 0.36
            : 0.38
      : usePoseGuide
      ? shotScale === "close"
        ? hasSecondCharacter
          ? 0.6
          : 0.58
        : shotScale === "medium"
          ? hasSecondCharacter
            ? 0.56
            : 0.54
          : hasSecondCharacter
            ? 0.52
            : 0.5
      : hasFrameSeed
      ? shotScale === "close"
        ? hasSecondCharacter
          ? 0.44
          : 0.46
        : shotScale === "medium"
          ? hasSecondCharacter
            ? 0.42
            : 0.44
          : hasSecondCharacter
            ? 0.38
            : 0.4
      : shotScale === "close"
        ? hasSecondCharacter
          ? 0.72
          : 0.7
        : shotScale === "medium"
          ? hasSecondCharacter
            ? 0.7
            : 0.66
        : hasSecondCharacter
          ? 0.66
          : 0.62;
  if (usePoseGuide) {
    if (lockCharacterIdentityAndCount) {
      // With dual-character shots we now rely on a softer pose-aware composite
      // seed, so front identity anchors can safely be pushed a bit harder.
      clampAdapterWeight(char1AdapterNode, 0.92, 1.0, 0.82);
      clampAdapterWeight(char2AdapterNode, 0.9, 0.98, 0.82);
    } else {
      clampAdapterWeight(char1AdapterNode, hasSecondCharacter ? 0.98 : 1.0, hasSecondCharacter ? 1.06 : 1.1, 0.92);
      clampAdapterWeight(char2AdapterNode, hasSecondCharacter ? 0.96 : 0, hasSecondCharacter ? 1.04 : 0, hasSecondCharacter ? 0.92 : 0);
    }
  } else {
    updateAdapterWeight(char1AdapterNode, hasSecondCharacter ? 1.02 : 0.98, "at_least", 0.9);
    updateAdapterWeight(char2AdapterNode, hasSecondCharacter ? 0.98 : 0, "at_least", hasSecondCharacter ? 0.88 : 0.72);
  }
  if (char1SecondaryAdapterInputs) {
    if (usePoseGuide) {
      if (lockCharacterIdentityAndCount) {
        char1SecondaryAdapterInputs.weight = 0;
        char1SecondaryAdapterInputs.start_at = 0;
        char1SecondaryAdapterInputs.end_at = 0;
      } else if (hasViewSpecificChar1) {
        char1SecondaryAdapterInputs.weight = hasSecondCharacter ? 0.18 : 0.3;
        char1SecondaryAdapterInputs.start_at = 0;
        char1SecondaryAdapterInputs.end_at = hasSecondCharacter ? 0.56 : 0.68;
      } else {
        char1SecondaryAdapterInputs.weight = 0;
        char1SecondaryAdapterInputs.start_at = 0;
        char1SecondaryAdapterInputs.end_at = 0;
      }
    } else if (hasSecondCharacter) {
      char1SecondaryAdapterInputs.weight = 0;
      char1SecondaryAdapterInputs.start_at = 0;
      char1SecondaryAdapterInputs.end_at = 0;
    } else {
      updateAdapterWeight(char1SecondaryAdapterNode, 0.28, "at_least", 0.56);
    }
  }

  if (controlNetInputs) {
    const targetStrength =
      lockCharacterIdentityAndCount
        ? (shotScale === "close" ? 0.82 : shotScale === "medium" ? 0.78 : 0.74)
        : usePoseGuide
        ? (shotScale === "close" ? 0.8 : shotScale === "medium" ? 0.76 : hasSecondCharacter ? 0.72 : 0.7)
        : hasFrameSeed
        ? (shotScale === "close" ? 0.56 : shotScale === "medium" ? 0.52 : hasSecondCharacter ? 0.5 : 0.46)
        : (shotScale === "close" ? 0.16 : shotScale === "medium" ? 0.2 : 0.24);
    controlNetInputs.strength = targetStrength;
    controlNetInputs.image = ["18", 0];
    controlNetInputs.start_percent = 0;
    controlNetInputs.end_percent = lockCharacterIdentityAndCount
      ? (shotScale === "close" ? 0.92 : shotScale === "medium" ? 0.88 : 0.84)
      : usePoseGuide
      ? (shotScale === "close" ? 0.94 : shotScale === "medium" ? 0.9 : 0.86)
      : hasFrameSeed
        ? (shotScale === "close" ? 0.84 : shotScale === "medium" ? 0.8 : 0.76)
        : (shotScale === "close" ? 0.42 : 0.5);
  }
  if (samplerInputs) {
    const current = Number(samplerInputs.denoise);
    if (lockCharacterIdentityAndCount) {
      samplerInputs.denoise = denoiseTarget;
      samplerInputs.steps = Math.max(32, Math.min(34, Number(samplerInputs.steps) || 32));
      samplerInputs.cfg =
        shotScale === "close"
          ? 5.8
          : shotScale === "medium"
            ? 5.6
            : 5.4;
    } else {
      samplerInputs.denoise =
        Number.isFinite(current) && current > 0
          ? (usePoseGuide ? Math.max(current, denoiseTarget) : hasFrameSeed ? Math.min(current, denoiseTarget) : Math.max(current, denoiseTarget))
          : denoiseTarget;
      samplerInputs.steps = Math.max(usePoseGuide ? (hasSecondCharacter ? 34 : 32) : (hasSecondCharacter ? 32 : 30), Number(samplerInputs.steps) || 0);
      const currentCfg = Number(samplerInputs.cfg);
      samplerInputs.cfg =
        Number.isFinite(currentCfg) && currentCfg > 0
          ? (usePoseGuide
              ? Math.max(currentCfg, hasSecondCharacter ? 6.0 : 5.8)
              : hasFrameSeed
                ? Math.min(currentCfg, hasSecondCharacter ? 6.2 : 5.9)
                : Math.max(hasSecondCharacter ? 6.8 : 6.2, currentCfg))
          : (usePoseGuide
              ? (hasSecondCharacter ? 6.0 : 5.8)
              : hasFrameSeed
                ? (hasSecondCharacter ? 6.2 : 5.9)
                : (hasSecondCharacter ? 6.8 : 6.2));
    }
  }
}

function shouldRouteStoryboardStillToFisher(
  settings: ComfySettings,
  shot: Shot,
  tokens: Record<string, string>,
  stagedImageRefs: Array<{ filename: string; weight: number; role?: WeightedImageRef["role"]; label?: string }>
): boolean {
  const storyboardMode = settings.storyboardImageWorkflowMode ?? "mature_asset_guided";
  // Mature asset guided mode is explicitly the scene-first + IPAdapter pipeline.
  // Auto-replacing it with the Qwen/Fisher compatibility still workflow causes
  // scene continuity loss, softer scene detail, and characters drifting away
  // from the bound three-view references.
  if (storyboardMode === "mature_asset_guided") return false;
  const hasSceneRef = String(tokens.SCENE_REF_PATH ?? "").trim().length > 0;
  const hasCharacterRef =
    String(tokens.CHAR1_PRIMARY_PATH ?? "").trim().length > 0 ||
    String(tokens.CHAR2_PRIMARY_PATH ?? "").trim().length > 0 ||
    stagedImageRefs.some((item) => String(item.role ?? "").startsWith("character_"));
  const hasCompositeGuide = stagedImageRefs.some((item) => String(item.label ?? "") === "scene_character_composite");
  return hasSceneRef && hasCharacterRef && hasCompositeGuide;
}

function getPromptStatus(raw: unknown): ComfyPromptStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const status = (raw as Record<string, unknown>).status;
  if (!status || typeof status !== "object" || Array.isArray(status)) return null;
  return status as ComfyPromptStatus;
}

function extractPromptError(raw: unknown): string | null {
  const status = getPromptStatus(raw);
  if (!status) return null;
  const messages = Array.isArray(status.messages) ? status.messages : [];
  for (const item of messages) {
    if (!item || typeof item !== "object") continue;
    const type = String((item as Record<string, unknown>).type ?? "");
    const message = (item as Record<string, unknown>).message;
    if (type !== "execution_error") continue;
    if (Array.isArray(message)) {
      const compact = message
        .map((entry) => {
          if (!entry || typeof entry !== "object") return "";
          const value = (entry as Record<string, unknown>).exception_message;
          return typeof value === "string" ? value : "";
        })
        .filter((entry) => entry.length > 0)
        .join(" | ");
      if (compact) return compact;
    }
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }
  }
  return null;
}

function summarizePromptHistory(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "history=empty";
  const record = raw as Record<string, unknown>;
  const outputs = record.outputs;
  const outputKeys =
    outputs && typeof outputs === "object" && !Array.isArray(outputs)
      ? Object.keys(outputs as Record<string, unknown>)
      : [];
  const status = getPromptStatus(raw);
  const statusStr = status ? String(status.status_str ?? "").trim() || "unknown" : "missing";
  const completed = status?.completed === true ? "true" : "false";
  const messages = Array.isArray(status?.messages) ? status?.messages : [];
  const compactMessages = messages
    .slice(-3)
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const entry = item as Record<string, unknown>;
      const type = String(entry.type ?? "").trim();
      const message = entry.message;
      if (typeof message === "string") return `${type}:${message}`.trim();
      if (Array.isArray(message)) {
        const brief = message
          .map((part) => {
            if (!part || typeof part !== "object") return "";
            const partRecord = part as Record<string, unknown>;
            return String(partRecord.exception_message ?? partRecord.message ?? "").trim();
          })
          .filter((text) => text.length > 0)
          .join(" | ");
        return brief ? `${type}:${brief}`.trim() : type;
      }
      return type;
    })
    .filter((text) => text.length > 0)
    .join(" || ");
  return [
    `status=${statusStr}`,
    `completed=${completed}`,
    `outputKeys=${outputKeys.join(",") || "none"}`,
    `messages=${compactMessages || "none"}`
  ].join("; ");
}

function isPromptCompleted(raw: unknown): boolean {
  const status = getPromptStatus(raw);
  if (!status) return false;
  if (status.completed === true) return true;
  const statusStr = String(status.status_str ?? "").trim().toLowerCase();
  return statusStr === "success" || statusStr === "failed" || statusStr === "error";
}

async function waitForComfyOutput(
  baseUrl: string,
  promptId: string,
  onProgress?: (progress: number, message: string) => void,
  options?: {
    requirePersistentImageOutput?: boolean;
  }
): Promise<ComfyOutputAsset[]> {
  const notify = (progress: number, message: string) => {
    if (!onProgress) return;
    onProgress(Math.max(0, Math.min(1, progress)), message);
  };
  notify(0.02, "已提交到 ComfyUI 队列");
  let fallbackProgress = 0.02;
  const unsubscribe = subscribePromptProgress(promptId, (snapshot) => {
    notify(snapshot.progress, snapshot.message);
  });
  const maxAttempts = 1800;
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let history: Record<string, unknown> | null = null;
      try {
        history = await invokeDesktop<Record<string, unknown>>("comfy_get_history", {
          baseUrl: normalizeBaseUrl(baseUrl),
          promptId
        });
      } catch {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        continue;
      }
      const promptHistory = history[promptId];
      const promptError = extractPromptError(promptHistory);
      if (promptError) {
        throw new Error(`ComfyUI 执行失败：${promptError}`);
      }
      const assets = collectOutputAssets(promptHistory);
      const persistentImageOutputs =
        options?.requirePersistentImageOutput
          ? filterOutputAssetsByKind(assets, "image").filter(
              (asset) => String(asset.type ?? "").trim().toLowerCase() === "output"
            )
          : [];
      if (
        assets.length > 0 &&
        (!options?.requirePersistentImageOutput || persistentImageOutputs.length > 0)
      ) {
        notify(1, "输出已生成");
        return options?.requirePersistentImageOutput ? persistentImageOutputs : assets;
      }
      if (promptHistory && isPromptCompleted(promptHistory)) {
        if (options?.requirePersistentImageOutput && assets.length > 0 && persistentImageOutputs.length === 0) {
          throw new Error(
            `ComfyUI 任务已完成，但只检测到 Preview/临时图片，没有检测到 SaveImage 正式输出文件。${summarizePromptHistory(promptHistory)}`
          );
        }
        throw new Error(`ComfyUI 任务已完成但未检测到输出文件，请检查工作流输出节点。${summarizePromptHistory(promptHistory)}`);
      }
      const status = getPromptStatus(promptHistory);
      const statusText = String(status?.status_str ?? "").trim().toLowerCase();
      const waitingForOutput =
        statusText === "success" ||
        statusText === "executing" ||
        statusText === "running" ||
        statusText === "processing";
      if (fallbackProgress < 0.92) {
        fallbackProgress = Math.min(0.92, fallbackProgress + 0.0022);
      } else {
        fallbackProgress = Math.min(0.985, fallbackProgress + 0.00035);
      }
      notify(
        fallbackProgress,
        waitingForOutput && fallbackProgress >= 0.92 ? "后处理中，等待输出文件写入" : "等待 ComfyUI 执行中"
      );
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    throw new Error("ComfyUI 任务超时（等待超过 30 分钟），未获取到输出");
  } finally {
    unsubscribe();
  }
}

function toComfyViewUrl(baseUrl: string, asset: ComfyOutputAsset): string {
  const params = new URLSearchParams();
  params.set("filename", asset.filename);
  params.set("subfolder", asset.subfolder ?? "");
  params.set("type", asset.type ?? "output");
  return `${normalizeBaseUrl(baseUrl)}/view?${params.toString()}`;
}

function toLocalOutputPath(outputDir: string, asset: ComfyOutputAsset): string {
  const root = outputDir.trim().replace(/\/+$/, "");
  if (!root) return "";
  const sub = asset.subfolder?.trim().replace(/^\/+|\/+$/g, "");
  return sub ? `${root}/${sub}/${asset.filename}` : `${root}/${asset.filename}`;
}

const VIDEO_FILE_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "m4v",
  "webm",
  "mkv",
  "avi",
  "gif"
]);

const AUDIO_FILE_EXTENSIONS = new Set([
  "wav",
  "mp3",
  "aac",
  "flac",
  "ogg",
  "m4a",
  "opus"
]);

function filenameExtension(filename: string): string {
  const clean = filename.trim().toLowerCase();
  const dotIndex = clean.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex >= clean.length - 1) return "";
  return clean.slice(dotIndex + 1);
}

function isVideoOutputAsset(asset: ComfyOutputAsset): boolean {
  if (asset.mediaKind === "video") return true;
  return VIDEO_FILE_EXTENSIONS.has(filenameExtension(asset.filename));
}

function isAudioOutputAsset(asset: ComfyOutputAsset): boolean {
  if (asset.mediaKind === "audio") return true;
  return AUDIO_FILE_EXTENSIONS.has(filenameExtension(asset.filename));
}

function scoreVideoOutputAsset(asset: ComfyOutputAsset): number {
  let score = 0;
  if ((asset.type ?? "").trim().toLowerCase() === "output") score += 10;
  const ext = filenameExtension(asset.filename);
  if (ext === "mp4" || ext === "mov" || ext === "webm") score += 5;
  if ((asset.subfolder ?? "").trim().length > 0) score += 1;
  return score;
}

function scoreAudioOutputAsset(asset: ComfyOutputAsset): number {
  let score = 0;
  if ((asset.type ?? "").trim().toLowerCase() === "output") score += 10;
  const ext = filenameExtension(asset.filename);
  if (ext === "wav" || ext === "flac") score += 5;
  if (ext === "mp3" || ext === "m4a" || ext === "ogg") score += 4;
  if ((asset.subfolder ?? "").trim().length > 0) score += 1;
  return score;
}

function selectOutputAsset(
  outputs: ComfyOutputAsset[],
  kind: "image" | "video" | "audio",
  shot?: Shot,
  assetOutputContext: AssetOutputContext | null = null
): ComfyOutputAsset | null {
  if (outputs.length === 0) return null;
  if (kind === "video") {
    const videos = outputs.filter((asset) => isVideoOutputAsset(asset));
    if (videos.length === 0) return null;
    return videos.sort((left, right) => scoreVideoOutputAsset(right) - scoreVideoOutputAsset(left))[0] ?? null;
  }
  if (kind === "audio") {
    const audios = outputs.filter((asset) => isAudioOutputAsset(asset));
    if (audios.length === 0) return null;
    return audios.sort((left, right) => scoreAudioOutputAsset(right) - scoreAudioOutputAsset(left))[0] ?? null;
  }
  const images = outputs.filter((asset) => !isVideoOutputAsset(asset) && !isAudioOutputAsset(asset));
  if (images.length === 0) return outputs[0] ?? null;
  const normalizedShotId = shot?.id.trim().toLowerCase() ?? "";
  const storyboardExpectedMarkers =
    !assetOutputContext && normalizedShotId
      ? [`image_asset_guided_${normalizedShotId}`, `shot_${normalizedShotId}`, normalizedShotId]
      : [];
  return (
    images.sort((left, right) => {
      const leftType = String(left.type ?? "").toLowerCase();
      const rightType = String(right.type ?? "").toLowerCase();
      const leftSubfolder = String(left.subfolder ?? "").toLowerCase();
      const rightSubfolder = String(right.subfolder ?? "").toLowerCase();
      const leftName = String(left.filename ?? "").toLowerCase();
      const rightName = String(right.filename ?? "").toLowerCase();
      const leftMatchesStoryboardMarker =
        storyboardExpectedMarkers.length > 0 &&
        storyboardExpectedMarkers.some((marker) => leftName.includes(marker) || leftSubfolder.includes(marker));
      const rightMatchesStoryboardMarker =
        storyboardExpectedMarkers.length > 0 &&
        storyboardExpectedMarkers.some((marker) => rightName.includes(marker) || rightSubfolder.includes(marker));
      const leftStoryboardPenalty =
        !assetOutputContext && /(character_anchor|character_orthoview|character_mv|skybox_)/.test(leftName) ? 120 : 0;
      const rightStoryboardPenalty =
        !assetOutputContext && /(character_anchor|character_orthoview|character_mv|skybox_)/.test(rightName) ? 120 : 0;
      const leftScore =
        (leftMatchesStoryboardMarker ? 160 : 0) +
        (leftType === "output" ? 100 : 0) +
        (leftType === "temp" ? -20 : 0) +
        (leftSubfolder.includes("storyboard") ? 20 : 0) +
        (/image_asset_|shot_/.test(leftName) ? 20 : 0) +
        (/character_orthoview|skybox_/.test(leftName) ? 6 : 0) -
        leftStoryboardPenalty;
      const rightScore =
        (rightMatchesStoryboardMarker ? 160 : 0) +
        (rightType === "output" ? 100 : 0) +
        (rightType === "temp" ? -20 : 0) +
        (rightSubfolder.includes("storyboard") ? 20 : 0) +
        (/image_asset_|shot_/.test(rightName) ? 20 : 0) +
        (/character_orthoview|skybox_/.test(rightName) ? 6 : 0) -
        rightStoryboardPenalty;
      return rightScore - leftScore;
    })[0] ?? null
  );
}

function filterOutputAssetsByKind(outputs: ComfyOutputAsset[], kind: "image" | "video" | "audio"): ComfyOutputAsset[] {
  if (kind === "video") {
    return outputs.filter((asset) => isVideoOutputAsset(asset));
  }
  if (kind === "audio") {
    return outputs.filter((asset) => isAudioOutputAsset(asset));
  }
  return outputs.filter((asset) => !isVideoOutputAsset(asset) && !isAudioOutputAsset(asset));
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized || "asset";
}

function localAssetCachePath(settings: ComfySettings, asset: ComfyOutputAsset): string {
  const outputRoot = settings.outputDir.trim().replace(/\/+$/, "");
  const cacheRoot = outputRoot ? `${outputRoot}/.storyboard-cache` : "/tmp/storyboard-pro-comfy";
  const safeSubfolder = sanitizePathSegment(asset.subfolder?.trim() || "root");
  const safeFilename = sanitizePathSegment(asset.filename.trim() || "output.bin");
  return `${cacheRoot}/${safeSubfolder}/${Date.now()}_${safeFilename}`;
}

function localStillCachePath(settings: ComfySettings, label: string, source: string): string {
  const outputRoot = settings.outputDir.trim().replace(/\/+$/, "");
  const cacheRoot = outputRoot ? `${outputRoot}/.storyboard-cache/stills` : "/tmp/storyboard-pro-comfy/stills";
  const safeLabel = sanitizePathSegment(label);
  const ext = fileExtensionFromSource(source);
  return `${cacheRoot}/${Date.now()}_${safeLabel}.${ext}`;
}

async function materializeStillImagePath(
  settings: ComfySettings,
  source: string,
  label: string
): Promise<string> {
  const trimmed = source.trim();
  if (!trimmed) return "";
  if (canUseAbsoluteLocalPath(trimmed)) return trimmed;
  const downloadSource = inferComfyOutputDownloadSource(trimmed, settings.outputDir);
  if (downloadSource) {
    try {
      const url = toComfyViewDownloadUrl(downloadSource, settings.baseUrl);
      const base64 = await invokeDesktop<string>("comfy_fetch_view_base64", { url });
      const written = await invokeDesktop<FileWriteResult>("write_base64_file", {
        filePath: localStillCachePath(settings, label, trimmed),
        base64Data: base64
      });
      return written.filePath;
    } catch {
      // fall back to a direct output path only when view download is unavailable
    }
  }
  const relative = parseComfyViewPath(trimmed);
  if (relative && settings.outputDir.trim()) {
    const direct = `${settings.outputDir.trim().replace(/\/+$/, "")}/${relative.replace(/^\/+/, "")}`;
    if (canUseAbsoluteLocalPath(direct)) return direct;
  }
  return trimmed;
}

async function generateLocalCompatibleVideo(
  settings: ComfySettings,
  shot: Shot,
  index: number,
  allShots: Shot[]
): Promise<{ previewUrl: string; localPath: string }> {
  const tokens = inferPromptTokens(settings, shot, index, settings.tokenMapping, allShots, [], "video");
  const nextShot = allShots[index + 1];
  const mode = inferVideoMode(shot, nextShot);
  const motionPreset = inferLocalMotionPreset(shot, mode, nextShot);
  const sourceFrame = shot.videoStartFramePath?.trim() || shot.generatedImagePath?.trim() || "";
  const fallbackEnd =
    shot.videoEndFramePath?.trim() || nextShot?.generatedImagePath?.trim() || sourceFrame;
  const primaryImagePath = await materializeStillImagePath(
    settings,
    mode === "first_last_frame" ? (tokens.FIRST_FRAME_PATH || sourceFrame) : (tokens.FRAME_IMAGE_PATH || sourceFrame),
    `${shot.id}_primary`
  );
  const secondaryImagePath =
    mode === "first_last_frame"
      ? await materializeStillImagePath(
          settings,
          tokens.LAST_FRAME_PATH || fallbackEnd || primaryImagePath,
          `${shot.id}_secondary`
        )
      : "";

  if (!primaryImagePath.trim()) {
    throw new Error("本地兼容视频生成失败：当前镜头没有可用分镜图或首帧");
  }
  if (mode === "first_last_frame" && !secondaryImagePath.trim()) {
    throw new Error("本地兼容视频生成失败：首尾帧模式缺少尾帧");
  }

  const result = await invokeDesktop<LocalVideoRenderResult>("generate_local_video_from_images", {
    primaryImagePath,
    secondaryImagePath: secondaryImagePath || null,
    width: Math.max(320, Math.round(settings.renderWidth ?? 1920)),
    height: Math.max(320, Math.round(settings.renderHeight ?? 1080)),
    fps: Math.max(1, Math.round(settings.renderFps ?? 24)),
    durationFrames: Math.max(1, Math.round(shot.durationFrames)),
    mode,
    motionPreset
  });
  return {
    previewUrl: result.outputPath,
    localPath: result.outputPath
  };
}

async function materializeVideoAssetPath(settings: ComfySettings, asset: ComfyOutputAsset): Promise<string> {
  const cachePath = localAssetCachePath(settings, asset);
  const directPath = toLocalOutputPath(settings.outputDir, asset);
  if (directPath) {
    try {
      const copied = await invokeDesktop<FileWriteResult>("copy_file_to", {
        sourcePath: directPath,
        targetPath: cachePath
      });
      return copied.filePath;
    } catch {
      // fallback to downloading from /view
    }
  }

  const url = toComfyViewUrl(settings.baseUrl, asset);
  const base64 = await invokeDesktop<string>("comfy_fetch_view_base64", { url });
  const written = await invokeDesktop<FileWriteResult>("write_base64_file", {
    filePath: cachePath,
    base64Data: base64
  });
  return written.filePath;
}

async function materializeImageAssetPath(settings: ComfySettings, asset: ComfyOutputAsset): Promise<string> {
  const cachePath = localAssetCachePath(settings, asset);
  const directPath = toLocalOutputPath(settings.outputDir, asset);
  if (directPath) {
    try {
      const copied = await invokeDesktop<FileWriteResult>("copy_file_to", {
        sourcePath: directPath,
        targetPath: cachePath
      });
      return copied.filePath;
    } catch {
      // fallback to downloading from /view
    }
  }

  const url = toComfyViewUrl(settings.baseUrl, asset);
  const base64 = await invokeDesktop<string>("comfy_fetch_view_base64", { url });
  const written = await invokeDesktop<FileWriteResult>("write_base64_file", {
    filePath: cachePath,
    base64Data: base64
  });
  return written.filePath;
}

async function materializeOutputAssetPath(settings: ComfySettings, asset: ComfyOutputAsset): Promise<string> {
  if (isVideoOutputAsset(asset) || isAudioOutputAsset(asset)) {
    return materializeVideoAssetPath(settings, asset);
  }
  return materializeImageAssetPath(settings, asset);
}

export async function splitCharacterThreeViewSheet(sourcePath: string): Promise<ThreeViewSplitResult> {
  const trimmed = sourcePath.trim();
  if (!trimmed) throw new Error("三视图整板输出路径为空，无法拆分 front / side / back");
  return invokeDesktop<ThreeViewSplitResult>("split_threeview_sheet", {
    sourcePath: trimmed
  });
}

async function readComfyServerLogTail(settings: ComfySettings, maxLines = 180): Promise<string | null> {
  const comfyRootDir = settings.comfyRootDir.trim();
  if (!comfyRootDir) return null;
  try {
    return await invokeDesktop<string>("comfy_read_server_log_tail", {
      comfyRootDir,
      baseUrl: settings.baseUrl,
      maxLines
    });
  } catch {
    return null;
  }
}

function summarizeComfyServerLogFailure(logTail: string): string | null {
  const lines = logTail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;

  const lastExceptionIndex = [...lines]
    .map((line, index) => ({ line, index }))
    .filter((item) => item.line.includes("!!! Exception during processing !!!"))
    .map((item) => item.index)
    .pop();

  const scope = lastExceptionIndex !== undefined ? lines.slice(lastExceptionIndex) : lines.slice(-40);
  const headline =
    scope.find((line) => line.includes("!!! Exception during processing !!!")) ??
    scope.find((line) =>
      /(?:ModuleNotFoundError|NotImplementedError|RuntimeError|ValueError|AssertionError|OSError|ImportError):/i.test(
        line
      )
    ) ??
    null;

  const explicitError =
    scope.find((line) =>
      /(?:ModuleNotFoundError|NotImplementedError|RuntimeError|ValueError|AssertionError|OSError|ImportError):/i.test(
        line
      )
    ) ?? null;

  const merged = [headline, explicitError].filter((item, index, array) => item && array.indexOf(item) === index).join(" | ");
  const normalized = merged || scope.slice(0, 6).join(" | ");
  if (!normalized) return null;
  const normalizedLower = normalized.toLowerCase();

  if (
    normalizedLower.includes("convolution_overrideable not implemented") ||
    normalizedLower.includes("tensor backend other than cpu/cuda/mkldnn")
  ) {
    return "服务端诊断：当前 Wan 视频工作流在 MPS/非 CUDA 后端不可用。你这台 Mac 上的 ComfyUI 正在使用 MPS，Wan 视频模型所需 3D 卷积只能在 CUDA/CPU/MKLDNN 路径运行，实际生产建议改到 NVIDIA CUDA 环境。";
  }
  if (normalizedLower.includes("no module named 'sageattention'")) {
    return "服务端诊断：ComfyUI 缺少 sageattention 依赖，相关 KJNodes 加速节点无法运行。";
  }
  if (
    normalizedLower.includes("outofmemoryerror") ||
    normalizedLower.includes("cuda out of memory") ||
    normalizedLower.includes("allocation on device")
  ) {
    const wanRelated =
      normalizedLower.includes("wan") ||
      normalizedLower.includes("conv3d") ||
      normalizedLower.includes("wanmoeksampler");
    if (wanRelated) {
      return "服务端诊断：当前工作流在 Wan 采样阶段显存不足。你这台 16GB 显卡已经触发 3D 卷积显存溢出，优先建议把这两条失败分镜改用更轻的图片工作流，或把 Wan 工作流的分辨率、帧数、steps 明显降下来。";
    }
    return "服务端诊断：当前工作流执行时显存不足。请降低分辨率、batch size、steps，或改用更轻的模型/工作流。";
  }
  return `服务端诊断：${normalized}`;
}

function shouldFallbackToLocalVideo(errorText: string): boolean {
  const normalized = String(errorText || "").toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("missing_node_type") ||
    normalized.includes("未检测到输出文件") ||
    normalized.includes("未找到输出文件") ||
    normalized.includes("未产出视频文件") ||
    normalized.includes("outputkeys=none") ||
    normalized.includes("status=error; completed=false")
  );
}

function isRequestTimeoutError(errorText: string): boolean {
  const normalized = String(errorText || "").toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("请求超时") ||
    normalized.includes("operation was aborted") ||
    normalized.includes("aborterror")
  );
}

export async function generateShotAsset(
  settings: ComfySettings,
  shot: Shot,
  index: number,
  kind: "image" | "video" | "audio",
  allShots: Shot[] = [],
  assets: Asset[] = [],
  options?: {
    onProgress?: (progress: number, message: string) => void;
    tokenOverrides?: Record<string, string>;
    workflowJsonOverride?: string;
    dialogueAudioTracks?: AudioTrack[];
  }
): Promise<{ previewUrl: string; localPath: string }> {
  try {
    if (kind === "video" && settings.videoGenerationMode === "local_motion") {
      return await generateLocalCompatibleVideo(settings, shot, index, allShots);
    }
    const workflowRaw =
      options?.workflowJsonOverride ??
      (kind === "image"
        ? settings.imageWorkflowJson
        : kind === "video"
          ? settings.videoWorkflowJson
          : settings.audioWorkflowJson ?? "");
    if (!workflowRaw.trim()) {
      throw new Error(
        kind === "image" ? "请先导入图片工作流" : kind === "video" ? "请先导入视频工作流" : "请先导入配音工作流"
      );
    }
    const assetOutputContext = inferAssetOutputContextFromShot(shot);
    const workflow = ensureWorkflowJson(workflowRaw);
    let rewrittenWorkflow =
      assetOutputContext?.kind === "character"
        ? (rewriteWorkflowFilenamePrefixes(workflow, rewriteCharacterAssetFilenamePrefix) as Record<string, unknown>)
        : workflow;
    const lipSyncSupport =
      kind === "video" ? inspectWorkflowLipSyncSupportFromObject(rewrittenWorkflow, settings.tokenMapping) : null;
    let tokens = inferPromptTokens(settings, shot, index, settings.tokenMapping, allShots, assets, kind);
    if (options?.tokenOverrides) {
      tokens = {
        ...tokens,
        ...Object.fromEntries(
          Object.entries(options.tokenOverrides).map(([key, value]) => [key, String(value ?? "")])
        )
      };
    }
    const styleScope =
      assetOutputContext?.kind === "character"
        ? "character_asset"
        : assetOutputContext?.kind === "scene"
          ? "scene_asset"
          : "storyboard";
    tokens = applyGlobalStyleToTokens(settings, tokens, kind, styleScope);
    let imageReferenceSources: WeightedImageRef[] = [];
    let storyboardCompositeFrameSource = "";
    if (kind === "image") {
      imageReferenceSources = extractImageReferenceSources(shot, assets, index, allShots);
      if ((settings.storyboardImageWorkflowMode ?? "mature_asset_guided") === "mature_asset_guided" && !assetOutputContext) {
        const inputDir = inferComfyInputDir(settings);
        if (inputDir) {
          const [compositeRef, identityBoardRef] = await Promise.all([
            buildStoryboardCompositeReference(settings, shot, imageReferenceSources, inputDir),
            buildStoryboardIdentityBoardReference(shot, imageReferenceSources, inputDir, assets)
          ]);
          if (compositeRef?.source) {
            storyboardCompositeFrameSource = compositeRef.source.trim();
          }
          if (identityBoardRef?.source) {
            imageReferenceSources = [
              ...imageReferenceSources.filter((item) => item.source.trim() !== identityBoardRef.source.trim()),
              identityBoardRef
            ];
          }
        }
      }
    }
    if (kind === "video") {
      if (lipSyncSupport?.usesDialogueAudioPathToken) {
        tokens = await stageDialogueAudioTokens(
          settings,
          shot,
          tokens,
          options?.dialogueAudioTracks ?? [],
          Math.max(1, Math.round(settings.renderFps ?? 24))
        );
      }
      tokens = await stageVideoFrameTokens(settings, shot, tokens);
    }
    if (kind === "image") {
      if (storyboardCompositeFrameSource) {
        tokens = {
          ...tokens,
          FRAME_IMAGE_PATH: storyboardCompositeFrameSource
        };
      }
      tokens = await stageImageReferenceTokens(settings, shot, tokens);
      tokens = await stageStoryboardPoseGuideToken(settings, shot, tokens);
      tokens = await stageStoryboardThreeViewTokens(settings, shot, tokens);
      tokens = await stageImageFrameToken(settings, shot, tokens);
    }
    const requirePersistentImageOutput = kind === "image" && workflowHasNodeType(rewrittenWorkflow, "SaveImage");
    let stagedCharacterImages: Array<{ filename: string; weight: number }> = [];
    if (kind === "image") {
      stagedCharacterImages =
        imageReferenceSources.length > 0 ? await stageCharacterReferenceImages(settings, shot, imageReferenceSources, assets) : [];
      if (shouldRouteStoryboardStillToFisher(settings, shot, tokens, stagedCharacterImages)) {
        rewrittenWorkflow = ensureWorkflowJson(STORYBOARD_IMAGE_FISHER_LIGHT_WORKFLOW_JSON);
      }
    }
    // Always detach baked-in Qwen image ref links; when image refs exist, reconnect with staged files.
    applyDynamicCharacterRefsForImageWorkflow(rewrittenWorkflow, stagedCharacterImages);
    let objectInfo: Record<string, unknown> | undefined;
    try {
      objectInfo = await fetchObjectInfo(settings.baseUrl);
    } catch {
      // Keep queueing with the original values if object_info is unavailable.
    }
    const built = coerceWorkflowLiteralValues(deepReplaceTokens(rewrittenWorkflow, tokens)) as Record<string, unknown>;
    if (kind === "image") {
      adaptBuiltinStoryboardWorkflowForShot(built, tokens, objectInfo);
    }
    applyFisherWorkflowBindings(built, kind, tokens, stagedCharacterImages);
    if (objectInfo) {
      applyComfyModelOptionBindings(built, objectInfo);
    }
    const promptId = await queueComfyPrompt(settings.baseUrl, built, objectInfo);
    const outputs = await waitForComfyOutput(settings.baseUrl, promptId, options?.onProgress, {
      requirePersistentImageOutput
    });
    const chosen = selectOutputAsset(outputs, kind, shot, assetOutputContext);
    if (!chosen) {
      if (kind === "video") {
        const names = outputs.map((item) => item.filename).join(", ");
        throw new Error(
          names.length > 0
            ? `工作流未产出视频文件（仅检测到：${names}）。请检查视频输出节点（如 VHS_VideoCombine）的格式与连接。`
            : "工作流未产出视频文件，请检查视频输出节点（如 VHS_VideoCombine）的格式与连接。"
        );
      }
      if (kind === "audio") {
        const names = outputs.map((item) => item.filename).join(", ");
        throw new Error(
          names.length > 0
            ? `工作流未产出音频文件（仅检测到：${names}）。请检查音频输出节点是否保存 WAV/MP3。`
            : "工作流未产出音频文件，请检查音频输出节点是否保存 WAV/MP3。"
        );
      }
      throw new Error("任务完成但未找到输出文件");
    }
    let localPath = await materializeOutputAssetPath(settings, chosen);
    if (kind === "image" && !assetOutputContext && (await isStoryboardCharacterDropout(settings, tokens, localPath))) {
      options?.onProgress?.(0.72, "检测到人物缺失，自动强化人物约束并重试");
      const strengthenedTokens = {
        ...tokens,
        NEGATIVE_PROMPT: `${tokens.NEGATIVE_PROMPT ?? ""}, empty scene, scenery only, no people, character missing, actor missing, no protagonist`,
        CHAR1_PRIMARY_WEIGHT: String(
          Math.min(1.36, Math.max(0, Number(tokens.CHAR1_PRIMARY_WEIGHT ?? "0") || 0) + 0.26)
        ),
        CHAR1_SECONDARY_WEIGHT: String(
          Math.min(0.42, Math.max(0, Number(tokens.CHAR1_SECONDARY_WEIGHT ?? "0") || 0) + 0.04)
        ),
        CHAR2_PRIMARY_WEIGHT: String(
          Math.min(1.32, Math.max(0, Number(tokens.CHAR2_PRIMARY_WEIGHT ?? "0") || 0) + 0.24)
        ),
        STORYBOARD_DENOISE: String(
          Math.min(0.42, Math.max(0.32, Number(tokens.STORYBOARD_DENOISE ?? "0.4") || 0.4))
        ),
        STORYBOARD_CFG: String(Math.min(6.2, Math.max(5.6, Number(tokens.STORYBOARD_CFG ?? "5.8") || 5.8)))
      };
      const rebuilt = coerceWorkflowLiteralValues(deepReplaceTokens(rewrittenWorkflow, strengthenedTokens)) as Record<string, unknown>;
      adaptBuiltinStoryboardWorkflowForShot(rebuilt, strengthenedTokens, objectInfo);
      applyFisherWorkflowBindings(rebuilt, kind, strengthenedTokens, stagedCharacterImages);
      if (objectInfo) {
        applyComfyModelOptionBindings(rebuilt, objectInfo);
      }
      const retryPromptId = await queueComfyPrompt(settings.baseUrl, rebuilt, objectInfo);
      const retryOutputs = await waitForComfyOutput(settings.baseUrl, retryPromptId, options?.onProgress, {
        requirePersistentImageOutput
      });
      const retryChosen = selectOutputAsset(retryOutputs, kind, shot, assetOutputContext);
      if (retryChosen) {
        localPath = await materializeOutputAssetPath(settings, retryChosen);
      }
    }
    const storyboardFallback = await maybeFallbackToStoryboardComposite(
      settings,
      shot,
      tokens,
      localPath,
      kind,
      assetOutputContext
    );
    if (storyboardFallback) {
      return storyboardFallback;
    }
    return {
      previewUrl: kind === "audio" ? localPath || toComfyViewUrl(settings.baseUrl, chosen) : toComfyViewUrl(settings.baseUrl, chosen),
      localPath
    };
  } catch (error) {
    const baseMessage = String(error);
    if (isRequestTimeoutError(baseMessage)) {
      throw new Error(`${baseMessage}。ComfyUI 请求超时，当前会话未拿到有效响应；请等待 Comfy 空闲后重试。`);
    }
    if (kind === "video" && settings.videoGenerationMode !== "local_motion" && shouldFallbackToLocalVideo(baseMessage)) {
      options?.onProgress?.(0.05, "Comfy 视频节点缺失，已自动回退到本地视频模式");
      return await generateLocalCompatibleVideo(settings, shot, index, allShots);
    }
    const logTail = await readComfyServerLogTail(settings);
    const diagnosis = logTail ? summarizeComfyServerLogFailure(logTail) : null;
    if (!diagnosis || baseMessage.includes(diagnosis)) {
      throw error;
    }
    throw new Error(`${baseMessage}；${diagnosis}`);
  }
}

export async function generateShotAssetOutputs(
  settings: ComfySettings,
  shot: Shot,
  index: number,
  kind: "image" | "video" | "audio",
  allShots: Shot[] = [],
  assets: Asset[] = [],
  options?: {
    onProgress?: (progress: number, message: string) => void;
    tokenOverrides?: Record<string, string>;
    workflowJsonOverride?: string;
    dialogueAudioTracks?: AudioTrack[];
  }
): Promise<Array<{ previewUrl: string; localPath: string }>> {
  try {
    if (kind === "video" && settings.videoGenerationMode === "local_motion") {
      return [await generateLocalCompatibleVideo(settings, shot, index, allShots)];
    }
    const workflowRaw =
      options?.workflowJsonOverride ??
      (kind === "image"
        ? settings.imageWorkflowJson
        : kind === "video"
          ? settings.videoWorkflowJson
          : settings.audioWorkflowJson ?? "");
    if (!workflowRaw.trim()) {
      throw new Error(
        kind === "image" ? "请先导入图片工作流" : kind === "video" ? "请先导入视频工作流" : "请先导入配音工作流"
      );
    }
    const assetOutputContext = inferAssetOutputContextFromShot(shot);
    const workflow = ensureWorkflowJson(workflowRaw);
    const rewrittenWorkflow =
      assetOutputContext?.kind === "character"
        ? (rewriteWorkflowFilenamePrefixes(workflow, rewriteCharacterAssetFilenamePrefix) as Record<string, unknown>)
        : workflow;
    const lipSyncSupport =
      kind === "video" ? inspectWorkflowLipSyncSupportFromObject(rewrittenWorkflow, settings.tokenMapping) : null;
    let tokens = inferPromptTokens(settings, shot, index, settings.tokenMapping, allShots, assets, kind);
    if (options?.tokenOverrides) {
      tokens = {
        ...tokens,
        ...Object.fromEntries(
          Object.entries(options.tokenOverrides).map(([key, value]) => [key, String(value ?? "")])
        )
      };
    }
    tokens = applyGlobalStyleToTokens(settings, tokens, kind);
    let imageReferenceSources: WeightedImageRef[] = [];
    let storyboardCompositeFrameSource = "";
    if (kind === "image") {
      imageReferenceSources = extractImageReferenceSources(shot, assets, index, allShots);
      if ((settings.storyboardImageWorkflowMode ?? "mature_asset_guided") === "mature_asset_guided" && !assetOutputContext) {
        const inputDir = inferComfyInputDir(settings);
        if (inputDir) {
          const [compositeRef, identityBoardRef] = await Promise.all([
            buildStoryboardCompositeReference(settings, shot, imageReferenceSources, inputDir),
            buildStoryboardIdentityBoardReference(shot, imageReferenceSources, inputDir, assets)
          ]);
          if (compositeRef?.source) {
            storyboardCompositeFrameSource = compositeRef.source.trim();
          }
          if (identityBoardRef?.source) {
            imageReferenceSources = [
              ...imageReferenceSources.filter((item) => item.source.trim() !== identityBoardRef.source.trim()),
              identityBoardRef
            ];
          }
        }
      }
    }
    if (kind === "video") {
      if (lipSyncSupport?.usesDialogueAudioPathToken) {
        tokens = await stageDialogueAudioTokens(
          settings,
          shot,
          tokens,
          options?.dialogueAudioTracks ?? [],
          Math.max(1, Math.round(settings.renderFps ?? 24))
        );
      }
      tokens = await stageVideoFrameTokens(settings, shot, tokens);
    }
    if (kind === "image") {
      if (storyboardCompositeFrameSource) {
        tokens = {
          ...tokens,
          FRAME_IMAGE_PATH: storyboardCompositeFrameSource
        };
      }
      tokens = await stageImageReferenceTokens(settings, shot, tokens);
      tokens = await stageStoryboardPoseGuideToken(settings, shot, tokens);
      tokens = await stageStoryboardThreeViewTokens(settings, shot, tokens);
      tokens = await stageImageFrameToken(settings, shot, tokens);
    }
    const requirePersistentImageOutput = kind === "image" && workflowHasNodeType(rewrittenWorkflow, "SaveImage");
    let stagedCharacterImages: Array<{ filename: string; weight: number }> = [];
    if (kind === "image") {
      stagedCharacterImages =
        imageReferenceSources.length > 0 ? await stageCharacterReferenceImages(settings, shot, imageReferenceSources, assets) : [];
    }
    applyDynamicCharacterRefsForImageWorkflow(rewrittenWorkflow, stagedCharacterImages);
    let objectInfo: Record<string, unknown> | undefined;
    try {
      objectInfo = await fetchObjectInfo(settings.baseUrl);
    } catch {
      // Keep queueing with the original values if object_info is unavailable.
    }
    const built = coerceWorkflowLiteralValues(deepReplaceTokens(rewrittenWorkflow, tokens)) as Record<string, unknown>;
    if (kind === "image") {
      adaptBuiltinStoryboardWorkflowForShot(built, tokens, objectInfo);
    }
    applyFisherWorkflowBindings(built, kind, tokens, stagedCharacterImages);
    if (objectInfo) {
      applyComfyModelOptionBindings(built, objectInfo);
    }
    const promptId = await queueComfyPrompt(settings.baseUrl, built, objectInfo);
    const outputs = await waitForComfyOutput(settings.baseUrl, promptId, options?.onProgress, {
      requirePersistentImageOutput
    });
    const filtered = filterOutputAssetsByKind(outputs, kind);
    const candidates = filtered.length > 0 ? filtered : outputs;
    if (candidates.length === 0) {
      if (kind === "video") {
        throw new Error("工作流未产出视频文件，请检查视频输出节点（如 VHS_VideoCombine）的格式与连接。");
      }
      if (kind === "audio") {
        throw new Error("工作流未产出音频文件，请检查音频输出节点是否保存 WAV/MP3。");
      }
      throw new Error("任务完成但未找到输出文件");
    }
    return await Promise.all(
      candidates.map(async (asset) => {
        const localPath = await materializeOutputAssetPath(settings, asset);
        return {
          previewUrl: kind === "audio" ? localPath || toComfyViewUrl(settings.baseUrl, asset) : toComfyViewUrl(settings.baseUrl, asset),
          localPath
        };
      })
    );
  } catch (error) {
    const baseMessage = String(error);
    if (isRequestTimeoutError(baseMessage)) {
      throw new Error(`${baseMessage}。ComfyUI 请求超时，当前会话未拿到有效响应；请等待 Comfy 空闲后重试。`);
    }
    if (kind === "video" && settings.videoGenerationMode !== "local_motion" && shouldFallbackToLocalVideo(baseMessage)) {
      options?.onProgress?.(0.05, "Comfy 视频节点缺失，已自动回退到本地视频模式");
      return [await generateLocalCompatibleVideo(settings, shot, index, allShots)];
    }
    const logTail = await readComfyServerLogTail(settings);
    const diagnosis = logTail ? summarizeComfyServerLogFailure(logTail) : null;
    if (!diagnosis || baseMessage.includes(diagnosis)) {
      throw error;
    }
    throw new Error(`${baseMessage}；${diagnosis}`);
  }
}

export async function concatShotVideos(paths: string[]): Promise<string | null> {
  const valid = paths.map((item) => item.trim()).filter((item) => item.length > 0);
  if (valid.length === 0) return null;
  const result = await invokeDesktop<ConcatResult>("concat_video_segments", { videoPaths: valid });
  return result.outputPath;
}

function makeSkyboxPrompt(description: string, face: SkyboxFace, eventPrompt?: string): string {
  const faceInstruction: Record<SkyboxFace, string> = {
    front: "front 面，正前方视角，作为主参考方向，空间主体朝前展开。",
    right: "right 面，相对 front 顺时针右转 90 度，展示右侧连续空间。",
    back: "back 面，相对 front 反向 180 度，展示后方连续空间。",
    left: "left 面，相对 front 左转 90 度，展示左侧连续空间。",
    up: "up 面，抬头仰视顶部空间，只展示上方结构与天花/天空。",
    down: "down 面，俯视下方面，只展示地面、地表、地砖、浅滩或底部结构。"
  };
  const workflowConstraint =
    "用于 scene-first 分镜底板：保持地平线稳定、垂直线条笔直、透视自然、避免鱼眼和几何扭曲；画面下方中部保留可站位空地，便于后续人物出镜。";
  const riversideConstraint = /(河边|江边|河岸|江岸|河畔|水边|岸边|riverbank|riverside|shore|waterfront)/i.test(description)
    ? "For riverside scenes, keep broad open river water, readable shoreline, human-eye-level perspective, and an inland river atmosphere. Do not collapse into a shallow forest creek full of rocks."
    : "";
  const base = `场景天空盒 ${faceInstruction[face]} cubemap face reference, wide environment plate, no characters, no action. ${workflowConstraint} ${riversideConstraint} ${description.trim()}`;
  const event = eventPrompt?.trim();
  if (!event) return base;
  return `${base}\n局部事件更新：${event}`;
}

function makeSkyboxPanoramaPrompt(description: string, eventPrompt?: string): string {
  const workflowConstraint =
    "用于 scene-first 分镜底板：地平线稳定，尽量避免极端透视与弯曲结构；中下区域保留可站位空间，便于后续叠加角色。";
  const base = `场景天空盒全景，360 equirectangular panorama，seamless environment plate，pure environment，no characters，no action。${workflowConstraint} ${description.trim()}`;
  const event = eventPrompt?.trim();
  if (!event) return base;
  return `${base}\n局部事件更新：${event}`;
}

function makeSkyboxFrontPlatePrompt(description: string): string {
  return [
    "分镜主场景建立板，单张宽幅环境图，不是 cubemap，不是 360 panorama，不是 layout sheet。",
    "用于 scene-first 分镜底板：保持地平线稳定、镜头接近人眼平视、空间可读、构图清楚，画面下方中部保留可站位空地。",
    "必须是纯环境图，无人物，无动物，无交通工具，无室内空间，无建筑概念图。",
    description.trim()
  ]
    .filter(Boolean)
    .join(" ");
}

function buildSkyboxNegativePrompt(sceneName: string, description: string, baseNegativePrompt: string): string {
  const text = `${sceneName} ${description}`.toLowerCase();
  const extras: string[] = [];
  const prefersOutdoor =
    /(河|江|湖|海|岸|滩|桥|山|林|原|野|天空|户外|外景|傍晚|黄昏|夕阳|river|lake|sea|shore|mountain|forest|outdoor|exterior|dusk|sunset|evening)/i.test(
      text
    ) && !/(室内|内景|大厅|房间|走廊|展厅|中庭|indoor|interior|atrium|lobby|hall|room|corridor|gallery|showroom)/i.test(text);
  if (prefersOutdoor) {
    extras.push(
      "indoor",
      "interior",
      "atrium",
      "lobby",
      "gallery",
      "showroom",
      "museum interior",
      "white hall",
      "wood interior",
      "wooden hall",
      "tea room",
      "restaurant interior",
      "cafe interior",
      "timber pavilion"
    );
  }
  if (/(河边|江边|河岸|江岸|河畔|水边|岸边|riverbank|riverside|shore|waterfront)/i.test(text)) {
    extras.push(
      "girl",
      "woman",
      "man",
      "child",
      "human figure",
      "people",
      "portrait",
      "festival",
      "wedding",
      "hanfu",
      "kimono",
      "traditional costume",
      "red lantern",
      "lantern festival",
      "train",
      "railway",
      "locomotive",
      "subway car",
      "bus",
      "vehicle depot",
      "cockpit",
      "technical drawing",
      "concept sheet",
      "design sheet",
      "cad interface",
      "ui screenshot",
      "wireframe sketch",
      "animal sketch",
      "dog drawing",
      "creature concept art",
      "industrial room",
      "marble atrium",
      "modern lobby",
      "empty white interior",
      "glass hall",
      "indoor courtyard",
      "campus render",
      "corporate campus",
      "office park",
      "modern white building",
      "ring building",
      "concrete wall",
      "retaining wall",
      "walled compound",
      "fence line",
      "architectural concept render",
      "masterplan render",
      "meadow only",
      "grass hill",
      "park lawn",
      "forest creek",
      "woodland creek",
      "mountain stream",
      "rocky stream",
      "stony creek",
      "shallow rocky creek",
      "pebble creek",
      "rock-filled stream",
      "boulder stream",
      "foreground boulders",
      "river stones",
      "stone-filled riverbed",
      "transparent shallow water",
      "clear streambed",
      "beach",
      "beachfront",
      "seaside",
      "coastline",
      "coastal town",
      "coastal city",
      "shore apartment",
      "oceanfront residence",
      "seaside apartment blocks",
      "sea",
      "ocean",
      "aerial view",
      "bird's-eye view",
      "drone shot",
      "mountain panorama",
      "valley aerial",
      "cave",
      "cavern",
      "statue",
      "temple carving",
      "fantasy ruin"
    );
  }
  const merged = [baseNegativePrompt.trim(), ...extras].filter(Boolean).join(", ");
  return merged.trim();
}

function buildSkyboxTokens(
  settings: ComfySettings,
  description: string,
  face: SkyboxFace,
  eventPrompt?: string,
  sceneName = ""
): Record<string, string> {
  const prompt = makeSkyboxPrompt(description, face, eventPrompt);
  const negativePrompt = buildSkyboxNegativePrompt(
    sceneName,
    description,
    settings.skyboxAssetNegativePrompt?.trim() ||
      "person, people, character, crowd, group shot, portrait, close-up, half body, full body person, actor, animal"
  );
  const baseTokens: Record<string, string> = {
    ASSET_NAME_DIR: sanitizeOutputAssetFolderName(sceneName || description, "未命名场景"),
    SHOT_ID: `skybox_${face}`,
    SHOT_TITLE: `Skybox ${face}`,
    SHOT_INDEX: "1",
    PROMPT: prompt,
    NEXT_SCENE_PROMPT: `Next Scene: ${prompt}`,
    VIDEO_PROMPT: prompt,
    VIDEO_MODE: "SINGLE_FRAME",
    NEGATIVE_PROMPT: negativePrompt,
    DIALOGUE: "",
    SPEAKER_NAME: "",
    EMOTION: "",
    DELIVERY_STYLE: "",
    SPEECH_RATE: "",
    VOICE_PROFILE: "",
    CHARACTER_VOICE_PROFILES: "",
    SEED: String(Math.floor(Math.random() * 1_000_000_000)),
    DURATION_FRAMES: "24",
    DURATION_SEC: "1.0",
    CHARACTER_REFS: "",
    SCENE_REF_PATH: "",
    SCENE_REF_NAME: "",
    CHARACTER_REF_PATHS: "",
    CHARACTER_REF_NAMES: "",
    CHARACTER_FRONT_PATHS: "",
    CHARACTER_SIDE_PATHS: "",
    CHARACTER_BACK_PATHS: "",
    CHAR1_NAME: "",
    CHAR1_FRONT_PATH: "",
    CHAR1_SIDE_PATH: "",
    CHAR1_BACK_PATH: "",
    CHAR2_NAME: "",
    CHAR2_FRONT_PATH: "",
    CHAR2_SIDE_PATH: "",
    CHAR2_BACK_PATH: "",
    CHAR3_NAME: "",
    CHAR3_FRONT_PATH: "",
    CHAR3_SIDE_PATH: "",
    CHAR3_BACK_PATH: "",
    CHAR4_NAME: "",
    CHAR4_FRONT_PATH: "",
    CHAR4_SIDE_PATH: "",
    CHAR4_BACK_PATH: "",
    FRAME_IMAGE_PATH: "",
    FIRST_FRAME_PATH: "",
    LAST_FRAME_PATH: "",
    DIALOGUE_AUDIO_PATH: "",
    DIALOGUE_AUDIO_PATHS: "",
    DIALOGUE_AUDIO_COUNT: "0",
    HAS_DIALOGUE_AUDIO: "0",
    SKYBOX_FACE: face.toUpperCase(),
    SKYBOX_DESCRIPTION: description.trim()
  };
  return applyTokenAliases(settings.tokenMapping, baseTokens);
}

function buildSkyboxPanoramaTokens(
  settings: ComfySettings,
  description: string,
  eventPrompt?: string,
  sceneName = ""
): Record<string, string> {
  const prompt = makeSkyboxPanoramaPrompt(description, eventPrompt);
  const negativePrompt = buildSkyboxNegativePrompt(
    sceneName,
    description,
    settings.skyboxAssetNegativePrompt?.trim() ||
      "person, people, character, crowd, group shot, portrait, close-up, half body, full body person, actor, animal"
  );
  const baseTokens: Record<string, string> = {
    ASSET_NAME_DIR: sanitizeOutputAssetFolderName(sceneName || description, "未命名场景"),
    SHOT_ID: "skybox_panorama",
    SHOT_TITLE: "Skybox Panorama",
    SHOT_INDEX: "1",
    PROMPT: prompt,
    NEXT_SCENE_PROMPT: `Next Scene: ${prompt}`,
    VIDEO_PROMPT: prompt,
    VIDEO_MODE: "SINGLE_FRAME",
    NEGATIVE_PROMPT: negativePrompt,
    DIALOGUE: "",
    SPEAKER_NAME: "",
    EMOTION: "",
    DELIVERY_STYLE: "",
    SPEECH_RATE: "",
    VOICE_PROFILE: "",
    CHARACTER_VOICE_PROFILES: "",
    SEED: String(Math.floor(Math.random() * 1_000_000_000)),
    DURATION_FRAMES: "24",
    DURATION_SEC: "1.0",
    CHARACTER_REFS: "",
    SCENE_REF_PATH: "",
    SCENE_REF_NAME: "",
    CHARACTER_REF_PATHS: "",
    CHARACTER_REF_NAMES: "",
    CHARACTER_FRONT_PATHS: "",
    CHARACTER_SIDE_PATHS: "",
    CHARACTER_BACK_PATHS: "",
    CHAR1_NAME: "",
    CHAR1_FRONT_PATH: "",
    CHAR1_SIDE_PATH: "",
    CHAR1_BACK_PATH: "",
    CHAR2_NAME: "",
    CHAR2_FRONT_PATH: "",
    CHAR2_SIDE_PATH: "",
    CHAR2_BACK_PATH: "",
    CHAR3_NAME: "",
    CHAR3_FRONT_PATH: "",
    CHAR3_SIDE_PATH: "",
    CHAR3_BACK_PATH: "",
    CHAR4_NAME: "",
    CHAR4_FRONT_PATH: "",
    CHAR4_SIDE_PATH: "",
    CHAR4_BACK_PATH: "",
    FRAME_IMAGE_PATH: "",
    FIRST_FRAME_PATH: "",
    LAST_FRAME_PATH: "",
    DIALOGUE_AUDIO_PATH: "",
    DIALOGUE_AUDIO_PATHS: "",
    DIALOGUE_AUDIO_COUNT: "0",
    HAS_DIALOGUE_AUDIO: "0",
    SKYBOX_FACE: "PANORAMA",
    SKYBOX_DESCRIPTION: description.trim()
  };
  return applyTokenAliases(settings.tokenMapping, baseTokens);
}

function pickSkyboxOutputByMarker(outputs: ComfyOutputAsset[], marker: string): ComfyOutputAsset | null {
  const normalized = marker.trim().toLowerCase();
  if (!normalized) return null;
  return (
    outputs.find((item) => item.filename.trim().toLowerCase().includes(normalized)) ??
    outputs.find((item) => `${item.subfolder ?? ""}/${item.filename}`.toLowerCase().includes(normalized)) ??
    null
  );
}

async function generateSkyboxPanoramaFaces(
  settings: ComfySettings,
  description: string,
  eventPrompt?: string,
  sceneName = ""
): Promise<SkyboxGenerationResult> {
  const workflowRaw = settings.skyboxWorkflowJson?.trim() || settings.imageWorkflowJson;
  if (!workflowRaw.trim()) throw new Error("请先配置图片工作流");

  const workflow = rewriteWorkflowFilenamePrefixes(
    ensureWorkflowJson(workflowRaw),
    rewriteSkyboxFilenamePrefix
  ) as Record<string, unknown>;
  const tokens = buildSkyboxPanoramaTokens(settings, description, eventPrompt, sceneName);
  applyDynamicCharacterRefsForImageWorkflow(workflow, []);
  const built = coerceWorkflowLiteralValues(deepReplaceTokens(workflow, tokens)) as Record<string, unknown>;
  applyFisherWorkflowBindings(built, "image", tokens);
  let objectInfo: Record<string, unknown> | undefined;
  try {
    objectInfo = await fetchObjectInfo(settings.baseUrl);
    applyComfyModelOptionBindings(built, objectInfo);
  } catch {
    // ignore object_info failures during skybox generation
  }

  const promptId = await queueComfyPrompt(settings.baseUrl, built, objectInfo);
  const outputs = await waitForComfyOutput(settings.baseUrl, promptId);
  const faces: Partial<Record<SkyboxFace, string>> = {};
  const previews: Partial<Record<SkyboxFace, string>> = {};
  const markers: Array<[SkyboxFace, string]> = [
    ["front", "skybox_front_"],
    ["right", "skybox_right_"],
    ["back", "skybox_back_"],
    ["left", "skybox_left_"],
    ["up", "skybox_up_"],
    ["down", "skybox_down_"]
  ];

  for (const [face, marker] of markers) {
    const asset = pickSkyboxOutputByMarker(outputs, marker);
    if (!asset) continue;
    faces[face] = await materializeImageAssetPath(settings, asset);
    previews[face] = toComfyViewUrl(settings.baseUrl, asset);
  }

  return { faces, previews };
}

export async function generateSkyboxFaces(
  settings: ComfySettings,
  description: string,
  sceneName = ""
): Promise<SkyboxGenerationResult> {
  if (settings.skyboxAssetWorkflowMode === "advanced_panorama") {
    return generateSkyboxPanoramaFaces(settings, description, undefined, sceneName);
  }
  const workflowRaw = settings.skyboxWorkflowJson?.trim() || settings.imageWorkflowJson;
  if (!workflowRaw.trim()) throw new Error("请先配置图片工作流");
  const faces: Partial<Record<SkyboxFace, string>> = {};
  const previews: Partial<Record<SkyboxFace, string>> = {};
  for (const face of SKYBOX_FACES) {
    const workflow = rewriteWorkflowFilenamePrefixes(
      ensureWorkflowJson(workflowRaw),
      rewriteSkyboxFilenamePrefix
    ) as Record<string, unknown>;
    // Skyboxes should stay pure environment plates; avoid injecting global character-style anchors here.
    const tokens = buildSkyboxTokens(settings, description, face, undefined, sceneName);
    applyDynamicCharacterRefsForImageWorkflow(workflow, []);
    const built = coerceWorkflowLiteralValues(deepReplaceTokens(workflow, tokens)) as Record<string, unknown>;
    applyFisherWorkflowBindings(built, "image", tokens);
    let objectInfo: Record<string, unknown> | undefined;
    try {
      objectInfo = await fetchObjectInfo(settings.baseUrl);
      applyComfyModelOptionBindings(built, objectInfo);
    } catch {
      // ignore object_info failures during skybox generation
    }
    const promptId = await queueComfyPrompt(settings.baseUrl, built, objectInfo);
    const outputs = await waitForComfyOutput(settings.baseUrl, promptId);
    const first = outputs[0];
    if (!first) continue;
    faces[face] = await materializeImageAssetPath(settings, first);
    previews[face] = toComfyViewUrl(settings.baseUrl, first);
  }
  return { faces, previews };
}

export async function generateSkyboxFrontPlate(
  settings: ComfySettings,
  description: string,
  sceneName = ""
): Promise<{ filePath: string; previewUrl: string }> {
  const workflowRaw = settings.skyboxWorkflowJson?.trim() || settings.imageWorkflowJson;
  if (!workflowRaw.trim()) throw new Error("请先配置图片工作流");
  const workflow = rewriteWorkflowFilenamePrefixes(
    ensureWorkflowJson(workflowRaw),
    rewriteSkyboxFilenamePrefix
  ) as Record<string, unknown>;
  const negativePrompt = buildSkyboxNegativePrompt(
    sceneName,
    description,
    settings.skyboxAssetNegativePrompt?.trim() ||
      "person, people, character, crowd, group shot, portrait, close-up, half body, full body person, actor, animal"
  );
  const baseTokens: Record<string, string> = {
    ASSET_NAME_DIR: sanitizeOutputAssetFolderName(sceneName || description, "未命名场景"),
    SHOT_ID: "skybox_front_plate",
    SHOT_TITLE: "Skybox Front Plate",
    SHOT_INDEX: "1",
    PROMPT: makeSkyboxFrontPlatePrompt(description),
    NEXT_SCENE_PROMPT: `Next Scene: ${makeSkyboxFrontPlatePrompt(description)}`,
    VIDEO_PROMPT: makeSkyboxFrontPlatePrompt(description),
    VIDEO_MODE: "SINGLE_FRAME",
    NEGATIVE_PROMPT: negativePrompt,
    DIALOGUE: "",
    SPEAKER_NAME: "",
    EMOTION: "",
    DELIVERY_STYLE: "",
    SPEECH_RATE: "",
    VOICE_PROFILE: "",
    CHARACTER_VOICE_PROFILES: "",
    SEED: String(Math.floor(Math.random() * 1_000_000_000)),
    DURATION_FRAMES: "24",
    DURATION_SEC: "1.0",
    CHARACTER_REFS: "",
    SCENE_REF_PATH: "",
    SCENE_REF_NAME: "",
    CHARACTER_REF_PATHS: "",
    CHARACTER_REF_NAMES: "",
    CHARACTER_FRONT_PATHS: "",
    CHARACTER_SIDE_PATHS: "",
    CHARACTER_BACK_PATHS: "",
    CHAR1_NAME: "",
    CHAR1_FRONT_PATH: "",
    CHAR1_SIDE_PATH: "",
    CHAR1_BACK_PATH: "",
    CHAR2_NAME: "",
    CHAR2_FRONT_PATH: "",
    CHAR2_SIDE_PATH: "",
    CHAR2_BACK_PATH: "",
    CHAR3_NAME: "",
    CHAR3_FRONT_PATH: "",
    CHAR3_SIDE_PATH: "",
    CHAR3_BACK_PATH: "",
    CHAR4_NAME: "",
    CHAR4_FRONT_PATH: "",
    CHAR4_SIDE_PATH: "",
    CHAR4_BACK_PATH: "",
    FRAME_IMAGE_PATH: "",
    FIRST_FRAME_PATH: "",
    LAST_FRAME_PATH: "",
    DIALOGUE_AUDIO_PATH: "",
    DIALOGUE_AUDIO_PATHS: "",
    DIALOGUE_AUDIO_COUNT: "0",
    HAS_DIALOGUE_AUDIO: "0",
    SKYBOX_FACE: "FRONT",
    SKYBOX_DESCRIPTION: description.trim()
  };
  const tokens = applyTokenAliases(settings.tokenMapping, baseTokens);
  applyDynamicCharacterRefsForImageWorkflow(workflow, []);
  const built = coerceWorkflowLiteralValues(deepReplaceTokens(workflow, tokens)) as Record<string, unknown>;
  applyFisherWorkflowBindings(built, "image", tokens);
  let objectInfo: Record<string, unknown> | undefined;
  try {
    objectInfo = await fetchObjectInfo(settings.baseUrl);
    applyComfyModelOptionBindings(built, objectInfo);
  } catch {
    // ignore object_info failures during skybox front-plate generation
  }
  const promptId = await queueComfyPrompt(settings.baseUrl, built, objectInfo);
  const outputs = await waitForComfyOutput(settings.baseUrl, promptId);
  const first = outputs[0];
  if (!first) throw new Error("河边正面建立场景板完成但未获取到输出");
  return {
    filePath: await materializeImageAssetPath(settings, first),
    previewUrl: toComfyViewUrl(settings.baseUrl, first)
  };
}

export async function generateSkyboxFaceUpdate(
  settings: ComfySettings,
  description: string,
  face: SkyboxFace,
  eventPrompt: string,
  sceneName = "",
  options?: {
    sourceFramePath?: string;
    workflowJsonOverride?: string;
  }
): Promise<{ filePath: string; previewUrl: string }> {
  if (settings.skyboxAssetWorkflowMode === "advanced_panorama") {
    const result = await generateSkyboxPanoramaFaces(settings, description, eventPrompt, sceneName);
    const filePath = result.faces[face];
    const previewUrl = result.previews[face];
    if (!filePath || !previewUrl) throw new Error(`天空盒全景更新完成，但未找到 ${face} 面输出`);
    return { filePath, previewUrl };
  }
  const workflowRaw = settings.skyboxWorkflowJson?.trim() || settings.imageWorkflowJson;
  if (!workflowRaw.trim()) throw new Error("请先配置图片工作流");
  const workflow = rewriteWorkflowFilenamePrefixes(
    ensureWorkflowJson(options?.workflowJsonOverride?.trim() || workflowRaw),
    rewriteSkyboxFilenamePrefix
  ) as Record<string, unknown>;
  const baseTokens = buildSkyboxTokens(settings, description, face, eventPrompt, sceneName);
  if (options?.sourceFramePath?.trim()) {
    const inputDir = inferComfyInputDir(settings);
    if (!inputDir) {
      throw new Error("天空盒扩展需要 front plate 参考图，但未检测到 ComfyUI input 目录");
    }
    const sourceFrame = options.sourceFramePath.trim();
    const ext = fileExtensionFromSource(sourceFrame || "png");
    const safeSceneId = sanitizeOutputAssetFolderName(sceneName || "skybox", "skybox");
    const targetAbs = `${inputDir}/skybox_${safeSceneId}_${face}_frame.${ext}`;
    const written = await stageSourceFileToComfyInput(sourceFrame, targetAbs, settings.baseUrl, settings.outputDir);
    const stagedName = written.split("/").pop() ?? written;
    baseTokens.FRAME_IMAGE_PATH = stagedName;
    baseTokens.FIRST_FRAME_PATH = stagedName;
  }
  const tokens = applyGlobalStyleToTokens(settings, baseTokens, "image");
  applyDynamicCharacterRefsForImageWorkflow(workflow, []);
  const built = coerceWorkflowLiteralValues(deepReplaceTokens(workflow, tokens)) as Record<string, unknown>;
  applyFisherWorkflowBindings(built, "image", tokens);
  let objectInfo: Record<string, unknown> | undefined;
  try {
    objectInfo = await fetchObjectInfo(settings.baseUrl);
    applyComfyModelOptionBindings(built, objectInfo);
  } catch {
    // ignore object_info failures during skybox update
  }
  const promptId = await queueComfyPrompt(settings.baseUrl, built, objectInfo);
  const outputs = await waitForComfyOutput(settings.baseUrl, promptId);
  const first = outputs[0];
  if (!first) throw new Error("天空盒更新完成但未获取到输出");
  return {
    filePath: await materializeImageAssetPath(settings, first),
    previewUrl: toComfyViewUrl(settings.baseUrl, first)
  };
}
