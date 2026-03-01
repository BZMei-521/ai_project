import { invokeDesktopCommand, isDesktopRuntime } from "../platform/desktopBridge";
import { renderShotsToFrames } from "./frameRenderer";
import type { AudioTrack, Shot, ShotLayer } from "../storyboard-core/types";
import type { Stroke } from "../storyboard-core/store";

type ExportAnimaticRequest = {
  width: number;
  height: number;
  fps: number;
  videoBitrateKbps: number;
  shots: Shot[];
  layers: ShotLayer[];
  shotStrokes: Record<string, Stroke[]>;
  audioTracks?: AudioTrack[];
  onProgress?: (progress: number, message: string) => void;
  signal?: AbortSignal;
};

type ExportResult = {
  outputPath: string;
};

type OpenPathResult = {
  openedPath: string;
};

type MuxVideoRequest = {
  videoPath: string;
  fps: number;
  audioTracks: AudioTrack[];
};

export type ExportLogEntry = {
  timestamp: number;
  kind: string;
  status: string;
  message: string;
  outputPath?: string;
};

export async function exportAnimaticVideo(
  request: ExportAnimaticRequest
): Promise<string | null> {
  if (!isDesktopRuntime()) {
    return null;
  }

  const frames = await renderShotsToFrames(
    request.shots,
    request.shotStrokes,
    request.layers,
    request.width,
    request.height,
    {
      onProgress: request.onProgress,
      signal: request.signal
    }
  );

  if (request.signal?.aborted) {
    throw new DOMException("Export cancelled", "AbortError");
  }

  request.onProgress?.(0.9, "Encoding video...");

  const result = await invokeDesktopCommand<ExportResult>("export_animatic_from_frames", {
    fps: request.fps,
    videoBitrateKbps: request.videoBitrateKbps,
    frames,
    audioTracks: request.audioTracks ?? []
  });

  return result.outputPath;
}

export async function listExportLogs(limit = 30): Promise<ExportLogEntry[]> {
  if (!isDesktopRuntime()) return [];
  return invokeDesktopCommand<ExportLogEntry[]>("list_export_logs", { limit });
}

export async function clearExportLogs(): Promise<void> {
  if (!isDesktopRuntime()) return;
  await invokeDesktopCommand("clear_export_logs");
}

export async function openPathInOS(path: string): Promise<string | null> {
  if (!isDesktopRuntime()) return null;
  const result = await invokeDesktopCommand<OpenPathResult>("open_path_in_os", { path });
  return result.openedPath;
}

export async function muxVideoWithAudioTracks(
  request: MuxVideoRequest
): Promise<string | null> {
  if (!isDesktopRuntime()) return null;
  const result = await invokeDesktopCommand<ExportResult>("mux_video_with_audio_tracks", {
    videoPath: request.videoPath,
    fps: request.fps,
    audioTracks: request.audioTracks
  });
  return result.outputPath;
}
