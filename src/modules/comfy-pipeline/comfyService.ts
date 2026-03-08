import type { Asset, AudioTrack, Shot, SkyboxFace } from "../storyboard-core/types";
import { invokeDesktopCommand, isDesktopRuntime } from "../platform/desktopBridge";

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
  characterRenderPreset?: "stable_fullbody" | "clean_reference";
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
  const modelName = settings.storyboardImageModelName?.trim() || "";
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
  kind: "image" | "video" | "audio"
): Record<string, string> {
  const visualStyle = normalizePromptBody(settings.globalVisualStylePrompt ?? "");
  const styleNegative = normalizePromptBody(settings.globalStyleNegativePrompt ?? "");
  if (!visualStyle && !styleNegative) return tokens;

  const next = { ...tokens };
  if (visualStyle) {
    if (kind === "image") {
      next.PROMPT = appendPromptSection(next.PROMPT ?? "", "全局视觉风格锚点", visualStyle);
      next.NEXT_SCENE_PROMPT = appendPromptSection(next.NEXT_SCENE_PROMPT ?? "", "全局视觉风格锚点", visualStyle);
    }
    if (kind === "video") {
      next.VIDEO_PROMPT = appendPromptSection(next.VIDEO_PROMPT ?? "", "全局视觉风格锚点", visualStyle);
    }
    next.GLOBAL_VISUAL_STYLE = visualStyle;
  }
  if (styleNegative && kind !== "audio") {
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
    const ext = fileExtensionFromSource(entry.source || "png");
    const targetAbs = `${inputDir}/shot_${safeShotId}_${entry.key.toLowerCase()}.${ext}`;
    const written = await stageSourceFileToComfyInput(entry.source, targetAbs, settings.baseUrl, settings.outputDir);
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

  const prefersBack = containsAnyKeyword(corpus, [
    "背影",
    "背面",
    "背对",
    "背身",
    "后方",
    "后背",
    "rear",
    "back view",
    "back-facing"
  ]);
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
  hasSecondCharacter: boolean
): {
  char1Primary: number;
  char1Secondary: number;
  char2Primary: number;
  denoise: number;
  steps: number;
  cfg: number;
} {
  const characterDriven = (() => {
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
  })();
  const sceneLed = hasSceneRef && shouldLeadWithSceneReference(shot);
  if (sceneLed && hasSecondCharacter) {
    if (characterDriven) {
      return {
        // Mature baseline: scene-first, then lock both characters with primary views.
        char1Primary: 0.62,
        char1Secondary: 0.02,
        char2Primary: 0.58,
        denoise: 0.44,
        steps: 30,
        cfg: 5.9
      };
    }
    return {
      char1Primary: 0.46,
      char1Secondary: 0.02,
      char2Primary: 0.42,
      denoise: 0.46,
      steps: 28,
      cfg: 6
    };
  }
  if (sceneLed) {
    if (characterDriven) {
      return {
        char1Primary: 0.72,
        char1Secondary: 0.03,
        char2Primary: 0,
        denoise: 0.44,
        steps: 30,
        cfg: 5.9
      };
    }
    return {
      char1Primary: 0.48,
      char1Secondary: 0.02,
      char2Primary: 0,
      denoise: 0.46,
      steps: 28,
      cfg: 6
    };
  }
  if (hasSecondCharacter) {
    return {
      char1Primary: 0.62,
      char1Secondary: 0.02,
      char2Primary: 0.58,
      denoise: 0.56,
      steps: 32,
      cfg: 6.3
    };
  }
  return {
    char1Primary: 0.66,
    char1Secondary: 0.03,
    char2Primary: 0,
    denoise: 0.56,
    steps: 32,
    cfg: 6.3
  };
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
    lines.push("人物-场景物理约束：人物脚部与地面接触关系自然，接触阴影方向与场景主光一致，不允许漂浮、穿模、比例失真。");
  }
  if (continuityDirective && !sceneAsset && characterAssets.length === 0) {
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
    return `出镜硬要求：画面中必须出现角色“${characterAssets[0]!.name}”，禁止生成为纯环境空镜；角色必须位于中前景且清晰可辨识，建议占画面高度至少约 35%，并保证头部到躯干完整，不得只剩远处小人影或被树木建筑完全遮挡。`;
  }
  const names = joinNaturalChineseList(characterAssets.map((item) => item.name));
  return `出镜硬要求：画面中必须同时出现角色${names}，禁止生成为纯环境空镜；每个角色都需位于中前景且清晰可辨识，建议各自占画面高度至少约 25%，不允许只出现剪影、极远小人、严重裁切或被场景主体完全遮挡。`;
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
  const corpus = [shot.title ?? "", shot.storyPrompt ?? "", shot.videoPrompt ?? "", shot.notes ?? "", ...(shot.tags ?? [])]
    .join(" ")
    .toLowerCase();
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
  const pieces = ["Treat every provided input image as a binding reference, not optional inspiration."];
  if (globalVisualStyle) {
    pieces.push(`Keep one unified visual style across every shot: ${globalVisualStyle}.`);
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
  }
  pieces.push(
    "If previous-shot continuity conflicts with character three-view or skybox references, always follow the character three-view and skybox assets first."
  );
  pieces.push(
    "Prefer the shot-matching character view and the matching skybox face over any weaker or generic reference."
  );
  pieces.push(
    "Generate one coherent cinematic shot in the same world. Do not redesign the environment, do not change character identity, and do not ignore any provided reference image."
  );
  return pieces.join(" ");
}

function buildQwenSlotInstruction(
  stagedRefs: Array<{ role?: WeightedImageRef["role"]; label?: string }>
): string {
  if (stagedRefs.length === 0) return "";
  const lines = stagedRefs
    .slice(0, 3)
    .map((item, index) => {
      const slot = `Reference slot ${index + 1}`;
      const label = item.label?.trim() ?? "";
      if (item.role === "scene_primary" || item.role === "scene_secondary") {
        return `${slot} is the binding environment reference${label ? ` (${label})` : ""}; keep location layout and camera direction aligned to it.`;
      }
      if (item.role === "character_front" || item.role === "character_side" || item.role === "character_back") {
        return `${slot} is the binding character reference${label ? ` (${label})` : ""}; keep identity, costume, and shot angle aligned to it.`;
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
    // Use only one skybox face as the scene anchor. Mixing multiple cube faces
    // in one 2D frame often creates perspective tearing and warped geometry.
    const faceCandidates = uniquePreserveOrder([
      plan.primaryFace,
      ...plan.faces,
      "front",
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
  const characterRefs = selectedCharacters.flatMap((asset, assetIndex) => {
    const refs: WeightedImageRef[] = [];
    const front = asset.characterFrontPath || asset.filePath || "";
    const side = asset.characterSidePath || "";
    const back = asset.characterBackPath || "";
    const byView: Record<CharacterReferenceView, string> = { front, side, back };
    const primaryView = characterPlan.primaryView;
    const primarySource = byView[primaryView].trim() || byView.front.trim() || byView.side.trim() || byView.back.trim();
    if (primarySource) {
      refs.push({
        source: primarySource,
        weight: 1,
        priority: 420 - assetIndex * 20,
        bucket: `character:${asset.id}`,
        label: `${asset.name}:${primaryView}`,
        role: characterViewRole(primaryView)
      });
    }
    // Only use a secondary character view as fallback when scene anchor is missing
    // and there is a single character in shot.
    if (selectedCharacters.length === 1 && sceneRefs.length === 0) {
      const secondaryView = characterPlan.secondaryViews[0];
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
  // Continuity image hints are useful only when hard asset refs are missing.
  if (sceneRefs.length === 0 && characterRefs.length === 0) {
    const previousSceneImage = parseComfyViewPath(continuityPlan.previousSceneShot?.generatedImagePath ?? "");
    if (previousSceneImage) {
      continuityRefs.push({
        source: previousSceneImage,
        weight: 0.26,
        priority: 110,
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
        weight: 0.3,
        priority: 120,
        bucket: "continuity:character",
        label: continuityPlan.previousCharacterShot?.title
          ? `continuity_character:${continuityPlan.previousCharacterShot.title}`
          : "continuity_character",
        role: "continuity_character"
      });
    }
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

function selectStoryboardReferenceSlots(refs: WeightedImageRef[]): WeightedImageRef[] {
  if (refs.length <= 3) return refs.slice(0, 3);
  const ordered = [...refs].sort((left, right) => {
    const priorityDelta = right.priority - left.priority;
    if (priorityDelta !== 0) return priorityDelta;
    return right.weight - left.weight;
  });
  const selected: WeightedImageRef[] = [];
  const usedSources = new Set<string>();
  const primaryScene = ordered.find((item) => item.role === "scene_primary" || item.role === "scene_secondary");
  pushUniqueWeightedRef(selected, usedSources, primaryScene);
  const usedCharacterBuckets = new Set<string>();
  const characters = ordered.filter((item) => item.role.startsWith("character_"));
  for (const characterRef of characters) {
    if (selected.length >= 3) break;
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
    if (selected.length >= 3) break;
  }

  return selected.slice(0, 3);
}

function shouldLeadWithSceneReference(shot: Shot): boolean {
  if ((shot.characterRefs?.length ?? 0) > 1) return true;
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
    "对峙",
    "双人",
    "两人",
    "二人",
    "全景",
    "大全景",
    "中景",
    "远景",
    "建立镜头",
    "环境",
    "河边",
    "桥上",
    "室外",
    "对打",
    "打斗",
    "搏斗",
    "wide shot",
    "establishing",
    "environment"
  ]);
}

function reorderStoryboardReferenceSlots(shot: Shot, refs: WeightedImageRef[]): WeightedImageRef[] {
  if (refs.length <= 1) return refs;
  const characters = refs.filter((item) => item.role.startsWith("character_"));
  const scenes = refs.filter((item) => item.role === "scene_primary" || item.role === "scene_secondary");
  const continuity = refs.filter((item) => item.role === "continuity_character" || item.role === "continuity_scene");
  // Always keep environment anchor first when a scene/skybox reference exists.
  if (scenes.length > 0) {
    return [...scenes.slice(0, 1), ...characters.slice(0, 2), ...continuity, ...scenes.slice(1)].slice(0, 3);
  }
  if (shouldLeadWithSceneReference(shot)) {
    const continuityScene = continuity.filter((item) => item.role === "continuity_scene");
    const continuityCharacter = continuity.filter((item) => item.role === "continuity_character");
    return [...continuityScene, ...characters.slice(0, 2), ...continuityCharacter].slice(0, 3);
  }
  return [...characters.slice(0, 2), ...continuity].slice(0, 3);
}

async function stageCharacterReferenceImages(
  settings: ComfySettings,
  shot: Shot,
  refs: WeightedImageRef[]
): Promise<Array<{ filename: string; weight: number; role: WeightedImageRef["role"]; label: string }>> {
  const selectedRefs = reorderStoryboardReferenceSlots(shot, selectStoryboardReferenceSlots(refs));
  if (selectedRefs.length === 0) return [];
  const inputDir = inferComfyInputDir(settings);
  if (!inputDir) {
    // Degrade gracefully when input directory is unknown.
    // Generation can still continue without dynamic reference image injection.
    return [];
  }
  const safeShotId = shot.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const staged: Array<{ filename: string; weight: number; role: WeightedImageRef["role"]; label: string }> = [];
  for (let index = 0; index < selectedRefs.length; index += 1) {
    const { source, weight, role, label } = selectedRefs[index]!;
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

  // Normalize common model path defaults for Comfy dropdown values.
  // Prefer basename as a cross-platform fallback. Some Comfy builds expose checkpoints
  // as plain filenames, others include a subdirectory prefix. object_info remapping below
  // will upgrade this to the exact available option when possible.
  setNodeWidgetValue(byId.get(49), 0, "Qwen-Rapid-AIO-SFW-v5.safetensors");
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
  const nextShot = allShots[index + 1];
  const mode = inferVideoMode(shot, nextShot);
  const promptBaseRaw = shot.storyPrompt?.trim() || shot.notes?.trim() || shot.title;
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
  const resolvedCharacterAssets: Asset[] = [];
  const seenCharacterIds = new Set<string>();
  for (const refId of shot.characterRefs ?? []) {
    const trimmedId = refId.trim();
    if (!trimmedId || seenCharacterIds.has(trimmedId)) continue;
    const matched = assets.find((item) => item.id === trimmedId && item.type === "character");
    if (!matched) continue;
    seenCharacterIds.add(trimmedId);
    resolvedCharacterAssets.push(matched);
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
  const continuityCharacterRefPath = parseComfyViewPath(continuityPlan.previousCharacterShot?.generatedImagePath ?? "");
  const char1PrimaryPath =
    assetPathForCharacterView(charSlots[0], characterPlan.primaryView) || characterFrontPaths[0] || continuityCharacterRefPath || "";
  const char1SecondaryPath =
    assetPathForCharacterView(charSlots[0], characterPlan.secondaryViews[0] ?? "front") ||
    char1PrimaryPath ||
    "";
  const char2PrimaryPath =
    assetPathForCharacterView(charSlots[1], characterPlan.primaryView) ||
    assetPathForCharacterView(charSlots[1], "front") ||
    char1SecondaryPath ||
    char1PrimaryPath ||
    "";
  const char2SecondaryPath =
    assetPathForCharacterView(charSlots[1], characterPlan.secondaryViews[0] ?? "front") ||
    char2PrimaryPath ||
    char1SecondaryPath ||
    char1PrimaryPath ||
    "";
  const storyboardWeights = inferStoryboardReferenceWeights(shot, Boolean(sceneRefPath), Boolean(charSlots[1]));
  const hasCharacters = characterAssets.length > 0;
  const hasSecondCharacter = Boolean(charSlots[1]);
  const useSecondaryCharacterView = shouldUseSecondaryCharacterView(shot) && !hasSecondCharacter;
  const normalizedChar1PrimaryPath = char1PrimaryPath.trim();
  const normalizedChar1SecondaryPath = char1SecondaryPath.trim();
  const normalizedChar2PrimaryPath = char2PrimaryPath.trim();
  const minChar1PrimaryWeight = hasCharacters ? (hasSecondCharacter ? 0.5 : 0.56) : 0;
  const minChar1SecondaryWeight = useSecondaryCharacterView ? 0.02 : 0;
  const minChar2PrimaryWeight = hasSecondCharacter ? 0.46 : 0;
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
  const characterPresenceDirective = buildCharacterPresenceDirective(characterAssets);
  const stabilityDirective = buildStoryboardStabilityDirective(Boolean(sceneAsset), characterAssets.length > 0);
  const referenceDirective = buildShotReferenceDirective(shot, sceneAsset, skyboxFaces, characterAssets, continuityPlan);
  const promptBase = [
    referenceDirective,
    characterPresenceDirective,
    sceneContext,
    cameraContext,
    characterContext,
    promptBaseRaw,
    stabilityDirective
  ]
    .filter((item) => item.length > 0)
    .join("\n");
  const nextScenePrompt = toNextScenePrompt(promptBase);
  const videoPrompt = toVideoPrompt(shot, mode);
  const defaultFramePath = parseComfyViewPath(shot.generatedImagePath ?? "");
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
      ? "cropped body, cut off head, cut off face, cut off feet, out of frame, body out of frame, close-up crop, partial body, incomplete body"
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
    "surreal abstract texture, warped geometry, twisted architecture, melted buildings, bent horizon, fisheye distortion, random scribble lines, chaotic glitch artifacts, smeared details";
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
    structureChaosNegativePrompt
  ]
    .filter((item) => item.length > 0)
    .join(", ");
  const baseTokens: Record<string, string> = {
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
    CHARACTER_REFS: (shot.characterRefs ?? []).join(","),
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
    STORYBOARD_IMAGE_MODEL: settings.storyboardImageModelName?.trim() || "sd_xl_base_1.0.safetensors",
    FRAME_IMAGE_PATH: defaultFramePath,
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
        return assets;
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

function selectOutputAsset(outputs: ComfyOutputAsset[], kind: "image" | "video" | "audio"): ComfyOutputAsset | null {
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
  return (
    images.sort((left, right) => {
      const leftType = String(left.type ?? "").toLowerCase();
      const rightType = String(right.type ?? "").toLowerCase();
      const leftSubfolder = String(left.subfolder ?? "").toLowerCase();
      const rightSubfolder = String(right.subfolder ?? "").toLowerCase();
      const leftName = String(left.filename ?? "").toLowerCase();
      const rightName = String(right.filename ?? "").toLowerCase();
      const leftScore =
        (leftType === "output" ? 100 : 0) +
        (leftType === "temp" ? -20 : 0) +
        (leftSubfolder.includes("storyboard") ? 20 : 0) +
        (/character_orthoview|skybox_|image_asset_|shot_/.test(leftName) ? 10 : 0);
      const rightScore =
        (rightType === "output" ? 100 : 0) +
        (rightType === "temp" ? -20 : 0) +
        (rightSubfolder.includes("storyboard") ? 20 : 0) +
        (/character_orthoview|skybox_|image_asset_|shot_/.test(rightName) ? 10 : 0);
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
    const workflow = ensureWorkflowJson(workflowRaw);
    const lipSyncSupport = kind === "video" ? inspectWorkflowLipSyncSupportFromObject(workflow, settings.tokenMapping) : null;
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
      tokens = await stageImageReferenceTokens(settings, shot, tokens);
      tokens = await stageImageFrameToken(settings, shot, tokens);
    }
    const requirePersistentImageOutput = kind === "image" && workflowHasNodeType(workflow, "SaveImage");
    let stagedCharacterImages: Array<{ filename: string; weight: number }> = [];
    if (kind === "image") {
      const sources = extractImageReferenceSources(shot, assets, index, allShots);
      stagedCharacterImages =
        sources.length > 0 ? await stageCharacterReferenceImages(settings, shot, sources) : [];
    }
    // Always detach baked-in Qwen image ref links; when image refs exist, reconnect with staged files.
    applyDynamicCharacterRefsForImageWorkflow(workflow, stagedCharacterImages);
    const built = coerceWorkflowLiteralValues(deepReplaceTokens(workflow, tokens)) as Record<string, unknown>;
    applyFisherWorkflowBindings(built, kind, tokens, stagedCharacterImages);
    let objectInfo: Record<string, unknown> | undefined;
    try {
      objectInfo = await fetchObjectInfo(settings.baseUrl);
      applyComfyModelOptionBindings(built, objectInfo);
    } catch {
      // Keep queueing with the original values if object_info is unavailable.
    }
    const promptId = await queueComfyPrompt(settings.baseUrl, built, objectInfo);
    const outputs = await waitForComfyOutput(settings.baseUrl, promptId, options?.onProgress, {
      requirePersistentImageOutput
    });
    const chosen = selectOutputAsset(outputs, kind);
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
    const localPath = await materializeOutputAssetPath(settings, chosen);
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
    const workflow = ensureWorkflowJson(workflowRaw);
    const lipSyncSupport = kind === "video" ? inspectWorkflowLipSyncSupportFromObject(workflow, settings.tokenMapping) : null;
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
      tokens = await stageImageReferenceTokens(settings, shot, tokens);
      tokens = await stageImageFrameToken(settings, shot, tokens);
    }
    const requirePersistentImageOutput = kind === "image" && workflowHasNodeType(workflow, "SaveImage");
    let stagedCharacterImages: Array<{ filename: string; weight: number }> = [];
    if (kind === "image") {
      const sources = extractImageReferenceSources(shot, assets, index, allShots);
      stagedCharacterImages =
        sources.length > 0 ? await stageCharacterReferenceImages(settings, shot, sources) : [];
    }
    applyDynamicCharacterRefsForImageWorkflow(workflow, stagedCharacterImages);
    const built = coerceWorkflowLiteralValues(deepReplaceTokens(workflow, tokens)) as Record<string, unknown>;
    applyFisherWorkflowBindings(built, kind, tokens, stagedCharacterImages);
    let objectInfo: Record<string, unknown> | undefined;
    try {
      objectInfo = await fetchObjectInfo(settings.baseUrl);
      applyComfyModelOptionBindings(built, objectInfo);
    } catch {
      // Keep queueing with the original values if object_info is unavailable.
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
  const base = `场景天空盒 ${faceInstruction[face]} cubemap face reference, wide environment plate, no characters, no action. ${workflowConstraint} ${description.trim()}`;
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

function buildSkyboxTokens(
  settings: ComfySettings,
  description: string,
  face: SkyboxFace,
  eventPrompt?: string
): Record<string, string> {
  const prompt = makeSkyboxPrompt(description, face, eventPrompt);
  const negativePrompt =
    settings.skyboxAssetNegativePrompt?.trim() ||
    "person, people, character, crowd, group shot, portrait, close-up, half body, full body person, actor, animal";
  const baseTokens: Record<string, string> = {
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
  eventPrompt?: string
): Record<string, string> {
  const prompt = makeSkyboxPanoramaPrompt(description, eventPrompt);
  const negativePrompt =
    settings.skyboxAssetNegativePrompt?.trim() ||
    "person, people, character, crowd, group shot, portrait, close-up, half body, full body person, actor, animal";
  const baseTokens: Record<string, string> = {
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
  eventPrompt?: string
): Promise<SkyboxGenerationResult> {
  const workflowRaw = settings.skyboxWorkflowJson?.trim() || settings.imageWorkflowJson;
  if (!workflowRaw.trim()) throw new Error("请先配置图片工作流");

  const workflow = ensureWorkflowJson(workflowRaw);
  const tokens = buildSkyboxPanoramaTokens(settings, description, eventPrompt);
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
  description: string
): Promise<SkyboxGenerationResult> {
  if (settings.skyboxAssetWorkflowMode === "advanced_panorama") {
    return generateSkyboxPanoramaFaces(settings, description);
  }
  const workflowRaw = settings.skyboxWorkflowJson?.trim() || settings.imageWorkflowJson;
  if (!workflowRaw.trim()) throw new Error("请先配置图片工作流");
  const faces: Partial<Record<SkyboxFace, string>> = {};
  const previews: Partial<Record<SkyboxFace, string>> = {};
  for (const face of SKYBOX_FACES) {
    const workflow = ensureWorkflowJson(workflowRaw);
    const tokens = buildSkyboxTokens(settings, description, face);
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

export async function generateSkyboxFaceUpdate(
  settings: ComfySettings,
  description: string,
  face: SkyboxFace,
  eventPrompt: string
): Promise<{ filePath: string; previewUrl: string }> {
  if (settings.skyboxAssetWorkflowMode === "advanced_panorama") {
    const result = await generateSkyboxPanoramaFaces(settings, description, eventPrompt);
    const filePath = result.faces[face];
    const previewUrl = result.previews[face];
    if (!filePath || !previewUrl) throw new Error(`天空盒全景更新完成，但未找到 ${face} 面输出`);
    return { filePath, previewUrl };
  }
  const workflowRaw = settings.skyboxWorkflowJson?.trim() || settings.imageWorkflowJson;
  if (!workflowRaw.trim()) throw new Error("请先配置图片工作流");
  const workflow = ensureWorkflowJson(workflowRaw);
  const tokens = buildSkyboxTokens(settings, description, face, eventPrompt);
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
