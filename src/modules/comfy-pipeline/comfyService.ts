import type { Asset, Shot, SkyboxFace } from "../storyboard-core/types";
import { invokeDesktopCommand, isDesktopRuntime } from "../platform/desktopBridge";

export type ComfySettings = {
  baseUrl: string;
  outputDir: string;
  comfyInputDir: string;
  comfyRootDir: string;
  imageWorkflowJson: string;
  videoWorkflowJson: string;
  audioWorkflowJson?: string;
  soundWorkflowJson?: string;
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
  lastFramePath: "LAST_FRAME_PATH"
};

type VideoMode = "single_frame" | "first_last_frame";

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

type LocalVideoRenderResult = {
  outputPath: string;
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
    ["lastFramePath", baseTokens.LAST_FRAME_PATH]
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

async function stageFrameFileToComfyInput(
  source: string,
  targetPath: string,
  baseUrl: string
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
  // For values like "Batch_00003_.png", treat them as Comfy output filenames and fetch via /view.
  if (!isAbsoluteLocalPath(trimmed)) {
    const viewUrl = toComfyViewDownloadUrl(trimmed, baseUrl);
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
      throw new Error(`准备输入帧失败：下载 Comfy 输出失败(${String(downloadError)})，本地复制也失败(${String(copyError)})`);
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
    stageFrameFileToComfyInput(firstSource, firstTargetAbs, settings.baseUrl),
    stageFrameFileToComfyInput(lastSource, lastTargetAbs, settings.baseUrl),
    stageFrameFileToComfyInput(frameSource, frameTargetAbs, settings.baseUrl)
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

function inferVideoMode(shot: Shot, nextShot?: Shot): VideoMode {
  if (shot.videoMode === "single_frame") return "single_frame";
  if (shot.videoMode === "first_last_frame") return "first_last_frame";
  if (shot.videoStartFramePath?.trim() && shot.videoEndFramePath?.trim()) {
    return "first_last_frame";
  }
  const corpus = [
    shot.storyPrompt ?? "",
    shot.videoPrompt ?? "",
    shot.notes ?? "",
    ...(shot.tags ?? [])
  ].join(" ");
  if (containsAnyKeyword(corpus, ["首尾帧", "首尾", "first_last", "first last", "起始帧", "结束帧"])) {
    return "first_last_frame";
  }
  if (containsAnyKeyword(corpus, ["单帧", "single frame", "图生视频"])) {
    return "single_frame";
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
  if (mode === "first_last_frame") {
    return `首尾帧运镜，保持角色与场景连续，平滑过渡。${compact}`;
  }
  return `单帧图生视频，保持主体稳定并增加自然镜头运动。${compact}`;
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

function extractWorkflowNodeTypes(workflow: Record<string, unknown>): string[] {
  const nodeTypes = workflowNodes(workflow)
    .map((node) => (typeof node.type === "string" ? node.type.trim() : ""))
    .filter((type) => type.length > 0);
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

function extractImageReferenceSources(shot: Shot, assets: Asset[]): WeightedImageRef[] {
  const sceneAsset = assets.find(
    (item) => item.id === (shot.sceneRefId ?? "") && (item.type === "scene" || item.type === "skybox")
  );
  const sceneRefs: WeightedImageRef[] = [];
  if (sceneAsset?.type === "scene") {
    if ((sceneAsset.filePath ?? "").trim()) sceneRefs.push({ source: sceneAsset.filePath, weight: 1 });
  } else if (sceneAsset?.type === "skybox") {
    const faces = inferSkyboxFacesFromShot(shot);
    for (const face of faces) {
      const facePath = sceneAsset.skyboxFaces?.[face] ?? "";
      if (!facePath.trim()) continue;
      const weight = skyboxFaceWeight(shot, face);
      if (weight <= 0) continue;
      sceneRefs.push({ source: facePath, weight });
    }
    if (sceneRefs.length === 0 && (sceneAsset.filePath ?? "").trim()) {
      sceneRefs.push({ source: sceneAsset.filePath, weight: 1 });
    }
  }

  const selectedCharacters = (shot.characterRefs ?? [])
    .map((id) => assets.find((item) => item.id === id && item.type === "character"))
    .filter((item): item is Asset => Boolean(item));
  const characterRefs = selectedCharacters.flatMap((asset) => {
    const refs: WeightedImageRef[] = [];
    const front = asset.characterFrontPath || asset.filePath || "";
    const side = asset.characterSidePath || "";
    const back = asset.characterBackPath || "";
    if (front.trim()) refs.push({ source: front, weight: 1 });
    if (side.trim()) refs.push({ source: side, weight: 0.8 });
    if (back.trim()) refs.push({ source: back, weight: 0.8 });
    return refs;
  });
  const merged = [...sceneRefs, ...characterRefs].filter((item) => item.source.trim().length > 0);
  const deduped = new Map<string, number>();
  for (const item of merged) {
    const prev = deduped.get(item.source) ?? 0;
    deduped.set(item.source, Math.max(prev, item.weight));
  }
  return [...deduped.entries()].map(([source, weight]) => ({ source, weight }));
}

async function stageCharacterReferenceImages(
  settings: ComfySettings,
  shot: Shot,
  refs: WeightedImageRef[]
): Promise<Array<{ filename: string; weight: number }>> {
  if (refs.length === 0) return [];
  const inputDir = inferComfyInputDir(settings);
  if (!inputDir) {
    // Degrade gracefully when input directory is unknown.
    // Generation can still continue without dynamic reference image injection.
    return [];
  }
  const safeShotId = shot.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const staged: Array<{ filename: string; weight: number }> = [];
  for (let index = 0; index < refs.length; index += 1) {
    const { source, weight } = refs[index]!;
    const ext = fileExtensionFromSource(source || "png");
    const targetAbs = `${inputDir}/shot_${safeShotId}_charref_${index + 1}.${ext}`;
    const written = await stageFrameFileToComfyInput(source, targetAbs, settings.baseUrl);
    staged.push({
      filename: written.split("/").pop() ?? `shot_${safeShotId}_charref_${index + 1}.${ext}`,
      weight
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
  const slots: number[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const name = inputs[index]?.name ?? "";
    if (name.startsWith("vl_resize_image") || name.startsWith("not_resize_image")) {
      slots.push(index);
    }
  }
  return slots;
}

function applyDynamicCharacterRefsForImageWorkflow(
  workflow: Record<string, unknown>,
  weightedImageRefs: Array<{ filename: string; weight: number }>
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

  const chunks: Array<Array<{ filename: string; weight: number }>> = [];
  for (let start = 0; start < weightedImageRefs.length; start += slotIndexes.length) {
    chunks.push(weightedImageRefs.slice(start, start + slotIndexes.length));
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
  tokens: Record<string, string>
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
  // which causes prompt validation errors in API mode. Always force prompt to widget text.
  const qwenPromptText = tokens.NEXT_SCENE_PROMPT || tokens.PROMPT;
  removeIncomingLinks(workflow, 21, [8]);
  setNodeWidgetValue(byId.get(123), 0, qwenPromptText);
  setNodeWidgetValue(byId.get(21), 0, qwenPromptText);

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

function resolveBestModelOption(desiredValue: string, options: string[]): string {
  if (!desiredValue.trim() || options.length === 0) return desiredValue;
  const desiredNormalized = normalizeModelChoice(desiredValue);
  const desiredBase = basenameModelChoice(desiredValue);

  const exact = options.find((option) => normalizeModelChoice(option) === desiredNormalized);
  if (exact) return exact;

  const sameBase = options.find((option) => basenameModelChoice(option) === desiredBase);
  if (sameBase) return sameBase;

  const suffixMatch = options.find((option) => normalizeModelChoice(option).endsWith(`/${desiredBase}`));
  if (suffixMatch) return suffixMatch;

  return desiredValue;
}

function applyComfyModelOptionBindings(
  workflow: Record<string, unknown>,
  objectInfo: Record<string, unknown>
) {
  const nodes = workflowNodes(workflow);
  for (const node of nodes) {
    if (!node || typeof node.type !== "string") continue;
    if (!Array.isArray(node.inputs) || !Array.isArray(node.widgets_values)) continue;

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
      const resolved = resolveBestModelOption(currentValue, options);
      if (resolved !== currentValue) {
        setNodeWidgetValue(node, index, resolved);
      }
    }
  }
}

function inferPromptTokens(
  shot: Shot,
  index: number,
  mapping: ComfySettings["tokenMapping"],
  allShots: Shot[] = [],
  assets: Asset[] = []
): Record<string, string> {
  const nextShot = allShots[index + 1];
  const mode = inferVideoMode(shot, nextShot);
  const promptBaseRaw = shot.storyPrompt?.trim() || shot.notes?.trim() || shot.title;
  const sceneAsset = assets.find(
    (item) => item.id === (shot.sceneRefId ?? "") && (item.type === "scene" || item.type === "skybox")
  );
  const skyboxFaces = sceneAsset?.type === "skybox" ? inferSkyboxFacesFromShot(shot) : [];
  const skyboxFaceWeightsText = skyboxFaces
    .map((face) => `${face}:${skyboxFaceWeight(shot, face).toFixed(2)}`)
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
  const characterAssets = (shot.characterRefs ?? [])
    .map((id) => assets.find((item) => item.id === id && item.type === "character"))
    .filter((item): item is Asset => Boolean(item));
  const characterFrontPaths = characterAssets.map((item) => item.characterFrontPath || item.filePath).filter(Boolean);
  const characterSidePaths = characterAssets.map((item) => item.characterSidePath || "").filter(Boolean);
  const characterBackPaths = characterAssets.map((item) => item.characterBackPath || "").filter(Boolean);
  const characterVoiceProfiles = characterAssets.map((item) => item.voiceProfile?.trim() || "").filter(Boolean);
  const characterAllViewPaths = [...characterFrontPaths, ...characterSidePaths, ...characterBackPaths].filter(Boolean);
  const charSlots = [0, 1, 2, 3].map((slotIndex) => characterAssets[slotIndex]);
  const sceneContext = sceneAsset ? `场景参考：${sceneAsset.name}` : "";
  const characterContext =
    characterAssets.length > 0 ? `人物参考：${characterAssets.map((item) => item.name).join("、")}` : "";
  const promptBase = [sceneContext, characterContext, promptBaseRaw].filter((item) => item.length > 0).join("\n");
  const nextScenePrompt = toNextScenePrompt(promptBase);
  const videoPrompt = toVideoPrompt(shot, mode);
  const defaultFramePath = parseComfyViewPath(shot.generatedImagePath ?? "");
  const firstFramePath = parseComfyViewPath(
    shot.videoStartFramePath?.trim() || defaultFramePath
  );
  const lastFramePath = parseComfyViewPath(
    shot.videoEndFramePath?.trim() || parseComfyViewPath(nextShot?.generatedImagePath ?? firstFramePath)
  );
  const baseTokens: Record<string, string> = {
    SHOT_ID: shot.id,
    SHOT_TITLE: shot.title,
    SHOT_INDEX: String(index + 1),
    PROMPT: promptBase,
    NEXT_SCENE_PROMPT: nextScenePrompt,
    VIDEO_PROMPT: videoPrompt,
    VIDEO_MODE: mode === "first_last_frame" ? "FIRST_LAST_FRAME" : "SINGLE_FRAME",
    NEGATIVE_PROMPT: shot.negativePrompt?.trim() || "",
    DIALOGUE: shot.dialogue?.trim() || "",
    SPEAKER_NAME: "",
    EMOTION: "",
    DELIVERY_STYLE: "",
    SPEECH_RATE: "",
    VOICE_PROFILE: characterVoiceProfiles[0] ?? "",
    CHARACTER_VOICE_PROFILES: characterVoiceProfiles.join(","),
    SEED: String(shot.seed ?? Math.floor(Math.random() * 1_000_000_000)),
    DURATION_FRAMES: String(Math.max(1, shot.durationFrames)),
    DURATION_SEC: String((shot.durationFrames / 24).toFixed(2)),
    CHARACTER_REFS: (shot.characterRefs ?? []).join(","),
    SCENE_REF_PATH: sceneRefPath,
    SCENE_REF_PATHS: sceneAsset?.type === "skybox" ? skyboxFacePaths.join(",") : sceneRefPath,
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
    FRAME_IMAGE_PATH: defaultFramePath,
    FIRST_FRAME_PATH: firstFramePath,
    LAST_FRAME_PATH: lastFramePath
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

const NODE_HINT_MAP: Array<{ pattern: RegExp; plugin: string; repo: string }> = [
  { pattern: /qwen|qwenedit|imageeditplus/i, plugin: "qweneditutils", repo: "https://github.com/kijai/ComfyUI-Qwen-Image-Edit" },
  { pattern: /rgthree|power lora loader/i, plugin: "rgthree-comfy", repo: "https://github.com/rgthree/rgthree-comfy" },
  { pattern: /kjnodes|sageattention|modelpatchtorchsettings|intconstant|pathchsageattention/i, plugin: "ComfyUI-KJNodes", repo: "https://github.com/kijai/ComfyUI-KJNodes" },
  { pattern: /wan|wanvideo|wanmoe|wan.*ksampler/i, plugin: "ComfyUI-WanMoeKSampler / ComfyUI-wanBlockswap", repo: "https://github.com/stduhpf/ComfyUI-WanMoeKSampler" },
  { pattern: /impact|detailer|segs/i, plugin: "ComfyUI-Impact-Pack", repo: "https://github.com/ltdrdata/ComfyUI-Impact-Pack" },
  { pattern: /animatediff|motion/i, plugin: "ComfyUI-AnimateDiff-Evolved", repo: "https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved" },
  { pattern: /rife|vfi|frame interpolation/i, plugin: "comfyui-frame-interpolation", repo: "https://github.com/Fannovel16/ComfyUI-Frame-Interpolation" },
  { pattern: /controlnet|advancedcontrolnet|acn_/i, plugin: "ComfyUI-Advanced-ControlNet", repo: "https://github.com/Kosinkadink/ComfyUI-Advanced-ControlNet" },
  { pattern: /ipadapter/i, plugin: "comfyui_ipadapter_plus", repo: "https://github.com/cubiq/ComfyUI_IPAdapter_plus" },
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

function buildWidgetValuesByInputName(node: WorkflowNode): Record<string, unknown> {
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
  return output;
}

function graphWorkflowToApiPrompt(workflow: Record<string, unknown>): Record<string, unknown> {
  const nodes = workflowNodes(workflow);
  if (nodes.length === 0) return {};
  const activeNodeIds = new Set<string>();
  for (const node of nodes) {
    if (isNodeDisabled(node)) continue;
    const id = typeof node.id === "number" || typeof node.id === "string" ? String(node.id) : "";
    if (!id) continue;
    activeNodeIds.add(id);
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
  const prompt: Record<string, unknown> = {};
  for (const node of nodes) {
    if (isNodeDisabled(node)) continue;
    const nodeIdRaw = (node as { id?: unknown }).id;
    const nodeType = typeof node.type === "string" ? node.type.trim() : "";
    if (!nodeType) continue;
    const nodeId =
      typeof nodeIdRaw === "number" || typeof nodeIdRaw === "string"
        ? String(nodeIdRaw)
        : "";
    if (!nodeId) continue;
    if (!linkedNodeIds.has(nodeId)) continue;

    const inputValues: Record<string, unknown> = {};
    const nodeInputs = Array.isArray(node.inputs) ? node.inputs : [];
    const widgetByInputName = buildWidgetValuesByInputName(node);

    for (const rawInput of nodeInputs) {
      if (!rawInput || typeof rawInput !== "object") continue;
      const input = rawInput as Record<string, unknown>;
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!name) continue;

      const linkId = typeof input.link === "number" ? input.link : null;
      if (typeof linkId === "number") {
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

    prompt[nodeId] = {
      class_type: nodeType,
      inputs: inputValues
    };
  }
  return prompt;
}

function normalizeWorkflowForQueue(workflow: Record<string, unknown>): Record<string, unknown> {
  if (isLikelyComfyApiPrompt(workflow)) {
    return workflow;
  }
  const hasGraphNodes = Array.isArray((workflow as { nodes?: unknown }).nodes);
  if (!hasGraphNodes) {
    return workflow;
  }
  const converted = graphWorkflowToApiPrompt(workflow);
  if (Object.keys(converted).length === 0) {
    throw new Error("工作流转换失败：无法从 nodes/links 生成 Comfy API prompt");
  }
  return converted;
}

async function queueComfyPrompt(baseUrl: string, workflow: Record<string, unknown>): Promise<string> {
  const prompt = normalizeWorkflowForQueue(workflow);
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
  onProgress?: (progress: number, message: string) => void
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
      if (assets.length > 0) {
        notify(1, "输出已生成");
        return assets;
      }
      if (promptHistory && isPromptCompleted(promptHistory)) {
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
  return outputs.find((asset) => !isVideoOutputAsset(asset) && !isAudioOutputAsset(asset)) ?? outputs[0] ?? null;
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
  if (isAbsoluteLocalPath(trimmed)) return trimmed;
  const relative = parseComfyViewPath(trimmed);
  if (relative && settings.outputDir.trim()) {
    const direct = `${settings.outputDir.trim().replace(/\/+$/, "")}/${relative.replace(/^\/+/, "")}`;
    if (isAbsoluteLocalPath(direct)) return direct;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.includes("/view?")) {
    const url = toComfyViewDownloadUrl(trimmed, settings.baseUrl);
    const base64 = await invokeDesktop<string>("comfy_fetch_view_base64", { url });
    const written = await invokeDesktop<FileWriteResult>("write_base64_file", {
      filePath: localStillCachePath(settings, label, trimmed),
      base64Data: base64
    });
    return written.filePath;
  }
  return trimmed;
}

async function generateLocalCompatibleVideo(
  settings: ComfySettings,
  shot: Shot,
  index: number,
  allShots: Shot[]
): Promise<{ previewUrl: string; localPath: string }> {
  const tokens = inferPromptTokens(shot, index, settings.tokenMapping, allShots, []);
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
    throw new Error("Mac 兼容视频生成失败：当前镜头没有可用分镜图或首帧");
  }
  if (mode === "first_last_frame" && !secondaryImagePath.trim()) {
    throw new Error("Mac 兼容视频生成失败：首尾帧模式缺少尾帧");
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

  if (
    normalized.includes("convolution_overrideable not implemented") ||
    normalized.includes("tensor backend other than CPU/CUDA/MKLDNN")
  ) {
    return "服务端诊断：当前 Wan 视频工作流在 MPS/非 CUDA 后端不可用。你这台 Mac 上的 ComfyUI 正在使用 MPS，Wan 视频模型所需 3D 卷积只能在 CUDA/CPU/MKLDNN 路径运行，实际生产建议改到 NVIDIA CUDA 环境。";
  }
  if (normalized.includes("No module named 'sageattention'")) {
    return "服务端诊断：ComfyUI 缺少 sageattention 依赖，相关 KJNodes 加速节点无法运行。";
  }
  return `服务端诊断：${normalized}`;
}

function shouldFallbackToLocalVideo(errorText: string): boolean {
  const normalized = String(errorText || "");
  if (!normalized) return false;
  if (!/missing_node_type/i.test(normalized)) return false;
  return true;
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
    let tokens = inferPromptTokens(shot, index, settings.tokenMapping, allShots, assets);
    if (options?.tokenOverrides) {
      tokens = {
        ...tokens,
        ...Object.fromEntries(
          Object.entries(options.tokenOverrides).map(([key, value]) => [key, String(value ?? "")])
        )
      };
    }
    if (kind === "video") {
      tokens = await stageVideoFrameTokens(settings, shot, tokens);
    }
    let stagedCharacterImages: Array<{ filename: string; weight: number }> = [];
    if (kind === "image") {
      const sources = extractImageReferenceSources(shot, assets);
      stagedCharacterImages =
        sources.length > 0 ? await stageCharacterReferenceImages(settings, shot, sources) : [];
    }
    // Always detach baked-in Qwen image ref links; when image refs exist, reconnect with staged files.
    applyDynamicCharacterRefsForImageWorkflow(workflow, stagedCharacterImages);
    const built = deepReplaceTokens(workflow, tokens) as Record<string, unknown>;
    applyFisherWorkflowBindings(built, kind, tokens);
    try {
      const objectInfo = await fetchObjectInfo(settings.baseUrl);
      applyComfyModelOptionBindings(built, objectInfo);
    } catch {
      // Keep queueing with the original values if object_info is unavailable.
    }
    const promptId = await queueComfyPrompt(settings.baseUrl, built);
    const outputs = await waitForComfyOutput(settings.baseUrl, promptId, options?.onProgress);
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
    if (kind === "video" && settings.videoGenerationMode !== "local_motion" && shouldFallbackToLocalVideo(baseMessage)) {
      options?.onProgress?.(0.05, "Comfy 视频节点缺失，已自动回退到本地视频模式");
      return await generateLocalCompatibleVideo(settings, shot, index, allShots);
    }
    if (kind !== "video") throw error;
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
  const base = `场景天空盒 ${face} 面，超广角，环境一致，材质一致，光照一致。${description.trim()}`;
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
  const baseTokens: Record<string, string> = {
    SHOT_ID: `skybox_${face}`,
    SHOT_TITLE: `Skybox ${face}`,
    SHOT_INDEX: "1",
    PROMPT: prompt,
    NEXT_SCENE_PROMPT: `Next Scene: ${prompt}`,
    VIDEO_PROMPT: prompt,
    VIDEO_MODE: "SINGLE_FRAME",
    NEGATIVE_PROMPT: "",
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
    SKYBOX_FACE: face.toUpperCase(),
    SKYBOX_DESCRIPTION: description.trim()
  };
  return applyTokenAliases(settings.tokenMapping, baseTokens);
}

export async function generateSkyboxFaces(
  settings: ComfySettings,
  description: string
): Promise<SkyboxGenerationResult> {
  const workflowRaw = settings.imageWorkflowJson;
  if (!workflowRaw.trim()) throw new Error("请先配置图片工作流");
  const faces: Partial<Record<SkyboxFace, string>> = {};
  const previews: Partial<Record<SkyboxFace, string>> = {};
  for (const face of SKYBOX_FACES) {
    const workflow = ensureWorkflowJson(workflowRaw);
    const tokens = buildSkyboxTokens(settings, description, face);
    applyDynamicCharacterRefsForImageWorkflow(workflow, []);
    const built = deepReplaceTokens(workflow, tokens) as Record<string, unknown>;
    applyFisherWorkflowBindings(built, "image", tokens);
    try {
      const objectInfo = await fetchObjectInfo(settings.baseUrl);
      applyComfyModelOptionBindings(built, objectInfo);
    } catch {
      // ignore object_info failures during skybox generation
    }
    const promptId = await queueComfyPrompt(settings.baseUrl, built);
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
  const workflowRaw = settings.imageWorkflowJson;
  if (!workflowRaw.trim()) throw new Error("请先配置图片工作流");
  const workflow = ensureWorkflowJson(workflowRaw);
  const tokens = buildSkyboxTokens(settings, description, face, eventPrompt);
  applyDynamicCharacterRefsForImageWorkflow(workflow, []);
  const built = deepReplaceTokens(workflow, tokens) as Record<string, unknown>;
  applyFisherWorkflowBindings(built, "image", tokens);
  try {
    const objectInfo = await fetchObjectInfo(settings.baseUrl);
    applyComfyModelOptionBindings(built, objectInfo);
  } catch {
    // ignore object_info failures during skybox update
  }
  const promptId = await queueComfyPrompt(settings.baseUrl, built);
  const outputs = await waitForComfyOutput(settings.baseUrl, promptId);
  const first = outputs[0];
  if (!first) throw new Error("天空盒更新完成但未获取到输出");
  return {
    filePath: await materializeImageAssetPath(settings, first),
    previewUrl: toComfyViewUrl(settings.baseUrl, first)
  };
}
