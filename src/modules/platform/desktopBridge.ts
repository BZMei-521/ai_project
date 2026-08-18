import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";

declare global {
  interface Window {
    __STORYBOARD_WEB_BRIDGE__?: boolean;
  }
}

function isAbsoluteLocalPath(value: string): boolean {
  return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value);
}

export function isTauriRuntime(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

export function isWebBridgeRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return window.__STORYBOARD_WEB_BRIDGE__ === true;
}

export function isDesktopRuntime(): boolean {
  return isTauriRuntime() || isWebBridgeRuntime();
}

export async function invokeDesktopCommand<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauriRuntime()) {
    return invoke<T>(cmd, args);
  }
  if (!isWebBridgeRuntime()) {
    throw new Error("未检测到桌面运行桥接。请使用 Tauri 桌面版或 Windows Web 启动脚本。");
  }
  const response = await fetch(`/api/invoke/${encodeURIComponent(cmd)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args ?? {})
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && !Array.isArray(payload) && "error" in payload
        ? String((payload as { error?: unknown }).error ?? "Unknown bridge error")
        : `Bridge HTTP ${response.status}`;
    throw new Error(message);
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload) && "result" in payload) {
    return (payload as { result: T }).result;
  }
  return payload as T;
}

export type VideoProbe = {
  width: number;
  height: number;
  fpsNum: number;
  fpsDen: number;
  durationSeconds: number;
  videoCodec: string;
  pixelFormat: string;
  audioSampleRate: number | null;
  audioChannels: number | null;
  hasMonotonicTimestamps: boolean;
  hasConstantFrameTimestamps: boolean;
  decodedFrameCount: number;
};

export type VideoAnomalyReport = {
  blackIntervals: Array<{ startSeconds: number; endSeconds: number; durationSeconds: number }>;
  freezeIntervals: Array<{ startSeconds: number; endSeconds: number; durationSeconds: number }>;
};

export type VideoInspection = { probe: VideoProbe; anomalies: VideoAnomalyReport };

export type NormalizationCredential = {
  schemaVersion: 1;
  receiptId: string;
  normalizedPath: string;
  sha256: string;
  byteLength: number;
  modifiedUnixMillis: number;
  projectWidth: number;
  projectHeight: number;
  durationFrames: number;
  probe: VideoProbe;
};

export type NormalizedVideoSegment = {
  credential: NormalizationCredential;
  probe: VideoProbe;
  anomalies: VideoAnomalyReport;
};

export type StagedVideoSegment = {
  stagedPath: string;
  projectAssetsDir: string;
  stagingReceiptId: string;
};

export type StageVideoSegmentRequest = {
  inputPath: string;
};

export type VideoReviewFrames = {
  firstFramePath: string;
  middleFramePath: string;
  lastFramePath: string;
};

export type ConcatenatedVideo = { outputPath: string; probe: VideoProbe };
export type ProbeVideoSegmentRequest = { inputPath: string; projectAssetsDir: string };
export type NormalizeVideoSegmentRequest = ProbeVideoSegmentRequest & {
  segmentId: string;
  projectWidth: number;
  projectHeight: number;
  durationFrames: number;
};
export type ExtractVideoReviewFramesRequest = {
  projectAssetsDir: string;
  credential: NormalizationCredential;
};
export type ConcatNormalizedVideoSegmentsRequest = {
  projectAssetsDir: string;
  segments: NormalizationCredential[];
};

export type CleanupVideoAssemblyAssetsRequest = {
  projectAssetsDir: string;
  stagedSegments: StagedVideoSegment[];
  credentials: NormalizationCredential[];
  reviewFrames: VideoReviewFrames[];
};

export type VideoGcReport = { receiptsRemoved: number; assetsRemoved: number };

function requireAbsoluteVideoPath(value: string, missingCode: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(missingCode);
  if (!(trimmed.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(trimmed) || /^\\\\[^\\]+\\[^\\]+/.test(trimmed))) {
    throw new Error("video_path_must_be_absolute");
  }
  return trimmed;
}

function requirePositiveSafeInteger(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(code);
  return value;
}

function requireTauriVideoContinuityRuntime(): void {
  if (!isTauriRuntime()) throw new Error("video_normalization_requires_tauri_runtime");
}

function validateNormalizationCredential(credential: NormalizationCredential): NormalizationCredential {
  if (
    credential.schemaVersion !== 1 ||
    !/^[a-f0-9]{64}$/.test(credential.receiptId ?? "") ||
    !credential.normalizedPath?.trim() ||
    !/^[a-f0-9]{64}$/.test(credential.sha256 ?? "") ||
    !Number.isSafeInteger(credential.byteLength) || credential.byteLength <= 0 ||
    !Number.isSafeInteger(credential.modifiedUnixMillis) || credential.modifiedUnixMillis <= 0
  ) throw new Error("normalization_credential_missing");
  requireAbsoluteVideoPath(credential.normalizedPath, "normalization_credential_missing");
  requirePositiveSafeInteger(credential.projectWidth, "normalized_segment_dimensions_invalid");
  requirePositiveSafeInteger(credential.projectHeight, "normalized_segment_dimensions_invalid");
  requirePositiveSafeInteger(credential.durationFrames, "video_duration_frames_invalid");
  if (credential.probe?.fpsNum !== 24 || credential.probe?.fpsDen !== 1) {
    throw new Error("normalized_segment_fps_invalid");
  }
  if (credential.probe.width !== credential.projectWidth || credential.probe.height !== credential.projectHeight) {
    throw new Error("normalized_segment_dimensions_mismatch");
  }
  if (
    credential.probe.videoCodec !== "h264" ||
    credential.probe.pixelFormat !== "yuv420p" ||
    credential.probe.audioSampleRate !== 48000 ||
    credential.probe.audioChannels !== 2 ||
    credential.probe.hasMonotonicTimestamps !== true ||
    credential.probe.hasConstantFrameTimestamps !== true ||
    credential.probe.decodedFrameCount !== credential.durationFrames
  ) throw new Error("normalized_segment_stream_contract_invalid");
  return credential;
}

export function createProbeVideoSegmentRequest(request: ProbeVideoSegmentRequest): ProbeVideoSegmentRequest {
  return {
    inputPath: requireAbsoluteVideoPath(request.inputPath, "video_input_path_missing"),
    projectAssetsDir: requireAbsoluteVideoPath(request.projectAssetsDir, "video_assets_root_missing")
  };
}

export function createStageVideoSegmentRequest(request: StageVideoSegmentRequest): StageVideoSegmentRequest {
  return { inputPath: requireAbsoluteVideoPath(request.inputPath, "video_input_path_missing") };
}

export function createNormalizeVideoSegmentRequest(request: NormalizeVideoSegmentRequest): NormalizeVideoSegmentRequest {
  const base = createProbeVideoSegmentRequest(request);
  const segmentId = request.segmentId.trim();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(segmentId)) throw new Error("video_segment_id_invalid");
  const projectWidth = requirePositiveSafeInteger(request.projectWidth, "video_project_dimensions_invalid");
  const projectHeight = requirePositiveSafeInteger(request.projectHeight, "video_project_dimensions_invalid");
  if (projectWidth > 8192 || projectHeight > 8192 || projectWidth % 2 || projectHeight % 2) {
    throw new Error("video_project_dimensions_invalid");
  }
  const durationFrames = requirePositiveSafeInteger(request.durationFrames, "video_duration_frames_invalid");
  if (durationFrames > 24 * 60 * 60) throw new Error("video_duration_frames_invalid");
  return { ...base, segmentId, projectWidth, projectHeight, durationFrames };
}

export function createExtractVideoReviewFramesRequest(request: ExtractVideoReviewFramesRequest): ExtractVideoReviewFramesRequest {
  return {
    projectAssetsDir: requireAbsoluteVideoPath(request.projectAssetsDir, "video_assets_root_missing"),
    credential: validateNormalizationCredential(request.credential)
  };
}

export function createConcatNormalizedVideoSegmentsRequest(request: ConcatNormalizedVideoSegmentsRequest): ConcatNormalizedVideoSegmentsRequest {
  const projectAssetsDir = requireAbsoluteVideoPath(request.projectAssetsDir, "video_assets_root_missing");
  if (!Array.isArray(request.segments) || request.segments.length === 0) throw new Error("normalized_segments_missing");
  const segments = request.segments.map(validateNormalizationCredential);
  const { projectWidth, projectHeight } = segments[0];
  if (segments.some((segment) => segment.projectWidth !== projectWidth || segment.projectHeight !== projectHeight)) {
    throw new Error("normalized_segment_dimensions_mismatch");
  }
  return { projectAssetsDir, segments };
}

export async function probeVideoSegment(request: ProbeVideoSegmentRequest): Promise<VideoInspection> {
  requireTauriVideoContinuityRuntime();
  return invokeDesktopCommand<VideoInspection>("probe_video_segment", createProbeVideoSegmentRequest(request));
}

export async function stageVideoSegment(request: StageVideoSegmentRequest): Promise<StagedVideoSegment> {
  requireTauriVideoContinuityRuntime();
  return invokeDesktopCommand<StagedVideoSegment>("stage_video_segment", createStageVideoSegmentRequest(request));
}

export async function normalizeVideoSegment(request: NormalizeVideoSegmentRequest): Promise<NormalizedVideoSegment> {
  requireTauriVideoContinuityRuntime();
  return invokeDesktopCommand<NormalizedVideoSegment>("normalize_video_segment", createNormalizeVideoSegmentRequest(request));
}

export async function extractVideoReviewFrames(request: ExtractVideoReviewFramesRequest): Promise<VideoReviewFrames> {
  requireTauriVideoContinuityRuntime();
  return invokeDesktopCommand<VideoReviewFrames>("extract_video_review_frames", createExtractVideoReviewFramesRequest(request));
}

export async function concatNormalizedVideoSegments(request: ConcatNormalizedVideoSegmentsRequest): Promise<ConcatenatedVideo> {
  requireTauriVideoContinuityRuntime();
  return invokeDesktopCommand<ConcatenatedVideo>("concat_normalized_video_segments", createConcatNormalizedVideoSegmentsRequest(request));
}

export async function cleanupVideoAssemblyAssets(request: CleanupVideoAssemblyAssetsRequest): Promise<void> {
  requireTauriVideoContinuityRuntime();
  const projectAssetsDir = requireAbsoluteVideoPath(request.projectAssetsDir, "video_assets_root_missing");
  const stagedSegments = request.stagedSegments.map((segment) => ({
    stagedPath: requireAbsoluteVideoPath(segment.stagedPath, "video_input_path_missing"),
    projectAssetsDir: requireAbsoluteVideoPath(segment.projectAssetsDir, "video_assets_root_missing"),
    stagingReceiptId: /^[a-f0-9]{64}$/.test(segment.stagingReceiptId) ? segment.stagingReceiptId : (() => { throw new Error("video_cleanup_claim_invalid"); })()
  }));
  const credentials = request.credentials.map(validateNormalizationCredential);
  await invokeDesktopCommand("cleanup_video_assembly_assets", {
    projectAssetsDir,
    stagedSegments,
    credentials,
    reviewFrames: request.reviewFrames
  });
}

export async function gcVideoContinuityAssets(projectAssetsDir: string, ttlSeconds: number): Promise<VideoGcReport> {
  requireTauriVideoContinuityRuntime();
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 365 * 24 * 60 * 60) {
    throw new Error("video_gc_ttl_invalid");
  }
  return invokeDesktopCommand<VideoGcReport>("gc_video_continuity_assets", {
    projectAssetsDir: requireAbsoluteVideoPath(projectAssetsDir, "video_assets_root_missing"),
    ttlSeconds
  });
}

export function toDesktopMediaSource(raw: string | undefined): string {
  const value = raw?.trim() ?? "";
  if (!value) return "";
  if (/^(https?:|blob:|data:|file:)/i.test(value)) return value;
  if (!isAbsoluteLocalPath(value)) return value;
  if (isTauriRuntime()) {
    try {
      return convertFileSrc(value);
    } catch {
      // ignore and fallback
    }
  }
  if (isWebBridgeRuntime()) {
    return `/api/local-file?path=${encodeURIComponent(value)}`;
  }
  if (value.startsWith("/")) return `file://${value}`;
  return `file:///${value.replace(/\\/g, "/")}`;
}
