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
  runCapability: AssemblyRunCapability;
  inputPath: string;
};

export type AssemblyRunCapability = {
  schemaVersion: 1;
  keyId: string;
  runId: string;
  canonicalProjectRoot: string;
  canonicalAssetRoot: string;
  issuedUnixMillis: number;
  expiresUnixMillis: number;
  mac: string;
};

export type VideoReviewFrames = {
  firstFramePath: string;
  middleFramePath: string;
  lastFramePath: string;
};

export type VerifiedVideoReviewRecord = {
  schemaVersion: 1;
  credentialReceiptId: string;
  canonicalProjectRoot: string;
  frames: Array<{
    role: "first" | "middle" | "last";
    path: string;
    sha256: string;
    byteLength: number;
    modifiedUnixMillis: number;
  }>;
  keyId: string;
  mac: string;
};

export type ConcatenatedVideo = {
  outputPath: string;
  probe: VideoProbe;
  assemblyReceipt: AssemblyReceipt;
};

export type AssemblyReceipt = {
  schemaVersion: 1;
  keyId: string;
  transactionId: string;
  runId: string;
  canonicalProjectRoot: string;
  outputPath: string;
  sha256: string;
  byteLength: number;
  modifiedUnixMillis: number;
  probe: VideoProbe;
  orderedReceiptIds: string[];
  mac: string;
};
export type ProbeVideoSegmentRequest = { inputPath: string; projectAssetsDir: string };
export type NormalizeVideoSegmentRequest = ProbeVideoSegmentRequest & {
  runCapability: AssemblyRunCapability;
  segmentId: string;
  projectWidth: number;
  projectHeight: number;
  durationFrames: number;
};

export type ExtractVideoReviewFramesRequest = {
  runCapability: AssemblyRunCapability;
  projectAssetsDir: string;
  credential: NormalizationCredential;
};

export type VerifyNormalizationCredentialRequest = {
  projectAssetsDir: string;
  credential: NormalizationCredential;
};

export type ConcatNormalizedVideoSegmentsRequest = {
  runCapability: AssemblyRunCapability;
  projectAssetsDir: string;
  segments: NormalizationCredential[];
};

export type CleanupVideoAssemblyAssetsRequest = {
  runCapability: AssemblyRunCapability;
};

export type VideoGcReport = { receiptsRemoved: number; assetsRemoved: number; issues: string[] };

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
  return {
    runCapability: validateAssemblyRunCapability(request.runCapability),
    inputPath: requireAbsoluteVideoPath(request.inputPath, "video_input_path_missing")
  };
}

function validateAssemblyRunCapability(capability: AssemblyRunCapability): AssemblyRunCapability {
  if (
    capability?.schemaVersion !== 1 ||
    !/^[a-f0-9]{64}$/.test(capability.keyId ?? "") ||
    !/^[a-f0-9]{64}$/.test(capability.runId ?? "") ||
    !/^[a-f0-9]{64}$/.test(capability.mac ?? "") ||
    !Number.isSafeInteger(capability.issuedUnixMillis) ||
    !Number.isSafeInteger(capability.expiresUnixMillis) ||
    capability.expiresUnixMillis <= capability.issuedUnixMillis
  ) throw new Error("video_assembly_run_invalid");
  requireAbsoluteVideoPath(capability.canonicalProjectRoot, "video_project_root_unavailable");
  requireAbsoluteVideoPath(capability.canonicalAssetRoot, "video_assets_root_missing");
  return capability;
}

function validateAssemblyReceipt(receipt: AssemblyReceipt): AssemblyReceipt {
  if (
    receipt?.schemaVersion !== 1 ||
    !/^[a-f0-9]{64}$/.test(receipt.keyId ?? "") ||
    !/^[a-f0-9]{64}$/.test(receipt.transactionId ?? "") ||
    !/^[a-f0-9]{64}$/.test(receipt.runId ?? "") ||
    !/^[a-f0-9]{64}$/.test(receipt.sha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(receipt.mac ?? "") ||
    !Number.isSafeInteger(receipt.byteLength) || receipt.byteLength <= 0 ||
    !Number.isSafeInteger(receipt.modifiedUnixMillis) || receipt.modifiedUnixMillis <= 0 ||
    !Array.isArray(receipt.orderedReceiptIds) || receipt.orderedReceiptIds.length === 0 ||
    receipt.orderedReceiptIds.some((id) => !/^[a-f0-9]{64}$/.test(id))
  ) throw new Error("video_assembly_receipt_invalid");
  requireAbsoluteVideoPath(receipt.canonicalProjectRoot, "video_project_root_unavailable");
  requireAbsoluteVideoPath(receipt.outputPath, "video_assembly_output_missing");
  return receipt;
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
  return { ...base, runCapability: validateAssemblyRunCapability(request.runCapability), segmentId, projectWidth, projectHeight, durationFrames };
}

export function createExtractVideoReviewFramesRequest(request: ExtractVideoReviewFramesRequest): ExtractVideoReviewFramesRequest {
  return {
    projectAssetsDir: requireAbsoluteVideoPath(request.projectAssetsDir, "video_assets_root_missing"),
    runCapability: validateAssemblyRunCapability(request.runCapability),
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
  return { projectAssetsDir, runCapability: validateAssemblyRunCapability(request.runCapability), segments };
}

export async function beginVideoAssemblyRun(): Promise<AssemblyRunCapability> {
  requireTauriVideoContinuityRuntime();
  return invokeDesktopCommand<AssemblyRunCapability>("begin_video_assembly_run");
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

export async function verifyNormalizationCredential(request: VerifyNormalizationCredentialRequest): Promise<VideoInspection> {
  requireTauriVideoContinuityRuntime();
  return invokeDesktopCommand<VideoInspection>("verify_normalization_credential", {
    projectAssetsDir: requireAbsoluteVideoPath(request.projectAssetsDir, "video_assets_root_missing"),
    credential: validateNormalizationCredential(request.credential)
  });
}

export async function verifyVideoReviewFrames(request: VerifyNormalizationCredentialRequest & { reviewFrames: VideoReviewFrames }): Promise<VerifiedVideoReviewRecord> {
  requireTauriVideoContinuityRuntime();
  return invokeDesktopCommand<VerifiedVideoReviewRecord>("verify_video_review_frames", {
    projectAssetsDir: requireAbsoluteVideoPath(request.projectAssetsDir, "video_assets_root_missing"),
    credential: validateNormalizationCredential(request.credential),
    reviewFrames: {
      firstFramePath: requireAbsoluteVideoPath(request.reviewFrames.firstFramePath, "video_review_frame_missing"),
      middleFramePath: requireAbsoluteVideoPath(request.reviewFrames.middleFramePath, "video_review_frame_missing"),
      lastFramePath: requireAbsoluteVideoPath(request.reviewFrames.lastFramePath, "video_review_frame_missing")
    }
  });
}

export async function retainVideoAssemblyRun(runCapability: AssemblyRunCapability): Promise<void> {
  requireTauriVideoContinuityRuntime();
  await invokeDesktopCommand("retain_video_assembly_run", { runCapability });
}

export async function concatNormalizedVideoSegments(request: ConcatNormalizedVideoSegmentsRequest): Promise<ConcatenatedVideo> {
  requireTauriVideoContinuityRuntime();
  return invokeDesktopCommand<ConcatenatedVideo>("concat_normalized_video_segments", createConcatNormalizedVideoSegmentsRequest(request));
}

export async function verifyVideoAssemblyReceipt(receipt: AssemblyReceipt): Promise<string> {
  requireTauriVideoContinuityRuntime();
  return invokeDesktopCommand<string>("verify_video_assembly_receipt", {
    receipt: validateAssemblyReceipt(receipt)
  });
}

export async function cleanupVideoAssemblyAssets(request: CleanupVideoAssemblyAssetsRequest): Promise<void> {
  requireTauriVideoContinuityRuntime();
  await invokeDesktopCommand("cleanup_video_assembly_assets", {
    runCapability: validateAssemblyRunCapability(request.runCapability)
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
