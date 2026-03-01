import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { pushToast } from "../ui/toastStore";
import { toDesktopMediaSource } from "../platform/desktopBridge";
import {
  selectShotStartFrame,
  useStoryboardStore
} from "../storyboard-core/store";

function toMediaSource(raw: string | undefined): string {
  return toDesktopMediaSource(raw);
}

function sourceExtension(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (value.includes("/view?")) {
    try {
      const url = new URL(value);
      const filename = url.searchParams.get("filename")?.trim() ?? "";
      const dot = filename.lastIndexOf(".");
      if (dot > 0 && dot < filename.length - 1) {
        return filename.slice(dot + 1).toLowerCase();
      }
    } catch {
      // ignore parse failure
    }
  }
  const base = value.split("?")[0] ?? value;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot >= base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

function isLikelyVideoSource(raw: string): boolean {
  const ext = sourceExtension(raw);
  return ["mp4", "mov", "m4v", "webm", "mkv", "avi", "gif"].includes(ext);
}

function isLikelyImageSource(raw: string): boolean {
  const ext = sourceExtension(raw);
  return ["png", "jpg", "jpeg", "webp", "bmp", "heic", "heif"].includes(ext);
}

const PREVIEW_SHOT_WIDTH_KEY = "storyboard-pro/preview-shot-width/v1";
const COMFY_SETTINGS_KEY = "storyboard-pro/comfy-settings/v1";
const MIN_PREVIEW_SHOT_WIDTH = 132;
const MAX_PREVIEW_SHOT_WIDTH = 280;
const loadExportService = () => import("../export-service/animaticExport");

function dirnameOfPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "";
  return normalized.slice(0, index);
}

function toAbsoluteLocalPath(raw: string | undefined): string {
  const value = raw?.trim() ?? "";
  if (!value) return "";
  if (value.startsWith("file://")) {
    try {
      const url = new URL(value);
      return decodeURIComponent(url.pathname);
    } catch {
      return value.replace(/^file:\/\//, "");
    }
  }
  if (value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value)) return value;
  return "";
}

function loadComfyOutputDir(): string {
  if (typeof window === "undefined") return "";
  const raw = window.localStorage.getItem(COMFY_SETTINGS_KEY);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { outputDir?: string };
    return parsed.outputDir?.trim() ?? "";
  } catch {
    return "";
  }
}

function resolveDirectoryFromSource(raw: string | undefined, fallbackDir = ""): string {
  const localPath = toAbsoluteLocalPath(raw);
  if (localPath) {
    const dir = dirnameOfPath(localPath);
    if (dir) return dir;
  }
  return fallbackDir.trim();
}

export function StoryboardPreviewPanel() {
  const project = useStoryboardStore((state) => state.project);
  const shots = useStoryboardStore((state) => state.shots);
  const sequences = useStoryboardStore((state) => state.sequences);
  const selectedShotId = useStoryboardStore((state) => state.selectedShotId);
  const currentSequenceId = useStoryboardStore((state) => state.currentSequenceId);
  const selectSequence = useStoryboardStore((state) => state.selectSequence);
  const selectShot = useStoryboardStore((state) => state.selectShot);
  const setCurrentFrame = useStoryboardStore((state) => state.setCurrentFrame);
  const [previewShotWidth, setPreviewShotWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 176;
    const saved = Number(window.localStorage.getItem(PREVIEW_SHOT_WIDTH_KEY));
    if (!Number.isFinite(saved)) return 176;
    return Math.max(MIN_PREVIEW_SHOT_WIDTH, Math.min(MAX_PREVIEW_SHOT_WIDTH, saved));
  });
  const storyShots = useMemo(() => {
    const sequenceOrder = new Map(sequences.map((sequence) => [sequence.id, sequence.order]));
    return shots
      .slice()
      .sort((a, b) => {
        const sequenceA = sequenceOrder.get(a.sequenceId) ?? Number.MAX_SAFE_INTEGER;
        const sequenceB = sequenceOrder.get(b.sequenceId) ?? Number.MAX_SAFE_INTEGER;
        if (sequenceA !== sequenceB) return sequenceA - sequenceB;
        return a.order - b.order;
      });
  }, [sequences, shots]);
  const sequenceLabelById = useMemo(
    () => new Map(sequences.map((sequence) => [sequence.id, `${sequence.order}. ${sequence.name}`])),
    [sequences]
  );
  const selectedShot = useMemo(
    () => storyShots.find((shot) => shot.id === selectedShotId) ?? storyShots[0],
    [selectedShotId, storyShots]
  );
  const selectedVideoSource = useMemo(() => {
    const fromSelected = toMediaSource(selectedShot?.generatedVideoPath);
    if (fromSelected) return fromSelected;
    const fallback = storyShots.find((shot) => shot.generatedVideoPath?.trim())?.generatedVideoPath;
    return toMediaSource(fallback);
  }, [selectedShot?.generatedVideoPath, storyShots]);
  const selectedImageSource = useMemo(() => {
    const fromSelected = toMediaSource(selectedShot?.generatedImagePath);
    if (fromSelected) return fromSelected;
    const fallback = storyShots.find((shot) => shot.generatedImagePath?.trim())?.generatedImagePath;
    return toMediaSource(fallback);
  }, [selectedShot?.generatedImagePath, storyShots]);
  const fallbackImageFromVideoField = useMemo(
    () => (isLikelyImageSource(selectedVideoSource) ? selectedVideoSource : ""),
    [selectedVideoSource]
  );
  const renderVideo = Boolean(selectedVideoSource && isLikelyVideoSource(selectedVideoSource));
  const renderImage = !renderVideo && Boolean(fallbackImageFromVideoField || selectedImageSource);
  const generatedImageCount = storyShots.reduce(
    (count, shot) => count + (shot.generatedImagePath?.trim() ? 1 : 0),
    0
  );
  const currentSequenceName =
    sequences.find((sequence) => sequence.id === currentSequenceId)?.name ?? "未命名序列";
  const comfyOutputDir = useMemo(() => loadComfyOutputDir(), []);
  const videoDirectory = useMemo(() => {
    const selectedDir = resolveDirectoryFromSource(selectedShot?.generatedVideoPath, comfyOutputDir);
    if (selectedDir) return selectedDir;
    const fallback = storyShots.find((shot) => toAbsoluteLocalPath(shot.generatedVideoPath));
    return resolveDirectoryFromSource(fallback?.generatedVideoPath, comfyOutputDir);
  }, [comfyOutputDir, selectedShot?.generatedVideoPath, storyShots]);
  const imageDirectory = useMemo(() => {
    const selectedDir = resolveDirectoryFromSource(selectedShot?.generatedImagePath, comfyOutputDir);
    if (selectedDir) return selectedDir;
    const fallback = storyShots.find((shot) => toAbsoluteLocalPath(shot.generatedImagePath));
    return resolveDirectoryFromSource(fallback?.generatedImagePath, comfyOutputDir);
  }, [comfyOutputDir, selectedShot?.generatedImagePath, storyShots]);
  const stripStyle = useMemo(
    () =>
      ({
        "--preview-shot-width": `${previewShotWidth}px`
      } as CSSProperties),
    [previewShotWidth]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PREVIEW_SHOT_WIDTH_KEY, String(previewShotWidth));
  }, [previewShotWidth]);

  const onSelectShot = (shotId: string, sequenceId: string) => {
    if (sequenceId !== useStoryboardStore.getState().currentSequenceId) {
      selectSequence(sequenceId);
    }
    selectShot(shotId);
    const start = selectShotStartFrame(useStoryboardStore.getState(), shotId);
    setCurrentFrame(start);
  };

  const onOpenDirectory = async (path: string, label: string) => {
    const target = path.trim();
    if (!target) {
      pushToast(`${label}不可用：当前还没有可打开的目录`, "warning");
      return;
    }
    try {
      const { openPathInOS } = await loadExportService();
      await openPathInOS(target);
    } catch (error) {
      pushToast(`打开${label}失败：${String(error)}`, "error");
    }
  };

  return (
    <section className="panel preview-panel">
      <header className="panel-header">
        <div className="preview-header-copy">
          <h2>视频预览</h2>
          <small>
            {selectedShot
              ? `当前镜头：${selectedShot.order}. ${selectedShot.title} · ${project.width}x${project.height}`
              : "暂无镜头"}
          </small>
        </div>
        <div className="preview-header-actions">
          <button onClick={() => void onOpenDirectory(imageDirectory, "分镜目录")} type="button">
            打开分镜目录
          </button>
          <button onClick={() => void onOpenDirectory(videoDirectory, "视频目录")} type="button">
            打开视频目录
          </button>
        </div>
      </header>
      <div className="preview-video-frame">
        {renderVideo ? (
          <video
            className="preview-video-player"
            controls
            key={selectedVideoSource}
            preload="metadata"
            src={selectedVideoSource}
          />
        ) : renderImage ? (
          <div className="preview-image-fallback">
            <img
              alt={selectedShot ? `${selectedShot.title} 分镜图` : "分镜图"}
              src={fallbackImageFromVideoField || selectedImageSource}
            />
            <small>当前镜头尚未产出可播放视频，正在展示分镜图。</small>
          </div>
        ) : (
          <div className="preview-empty">
            <strong>暂无可预览视频</strong>
            <small>生成镜头视频后会自动出现在这里。</small>
          </div>
        )}
      </div>
      <div className="preview-strip-header">
        <div className="preview-strip-title">
          <h3>分镜图列表（全故事）</h3>
          <small>
            当前序列：{currentSequenceName} · 已生成 {generatedImageCount} / {storyShots.length}
          </small>
        </div>
        <label className="preview-size-control">
          缩略图大小
          <input
            max={MAX_PREVIEW_SHOT_WIDTH}
            min={MIN_PREVIEW_SHOT_WIDTH}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (!Number.isFinite(value)) return;
              setPreviewShotWidth(
                Math.max(MIN_PREVIEW_SHOT_WIDTH, Math.min(MAX_PREVIEW_SHOT_WIDTH, value))
              );
            }}
            step={4}
            type="range"
            value={previewShotWidth}
          />
          <span>{previewShotWidth}px</span>
        </label>
      </div>
      <div className="preview-strip-grid" style={stripStyle}>
        {storyShots.length === 0 && (
          <div className="preview-strip-empty">还没有镜头，请先导入或新增镜头。</div>
        )}
        {storyShots.map((shot) => {
          const imageSource = toMediaSource(shot.generatedImagePath);
          const hasImage = imageSource.length > 0;
          return (
            <button
              className={`preview-shot-card ${shot.id === selectedShot?.id ? "selected" : ""}`}
              key={shot.id}
              onClick={() => onSelectShot(shot.id, shot.sequenceId)}
              type="button"
            >
              <div className={hasImage ? "preview-shot-thumb has-image" : "preview-shot-thumb"}>
                {hasImage ? (
                  <img alt={`${shot.title} 分镜图`} loading="lazy" src={imageSource} />
                ) : (
                  <span>未生成</span>
                )}
              </div>
              <div className="preview-shot-meta">
                <strong>
                  {sequenceLabelById.get(shot.sequenceId) ?? "未知序列"} · {shot.order}. {shot.title}
                </strong>
                <small>{hasImage ? "已生成" : "待生成"}</small>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
