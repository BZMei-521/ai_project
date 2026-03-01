import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  selectShotStartFrame,
  selectFilteredShotsForCurrentSequence,
  selectTimelineFrames,
  useStoryboardStore
} from "../storyboard-core/store";
import { confirmDialog, promptDialog } from "../ui/dialogStore";
import { pushToast } from "../ui/toastStore";
import { toDesktopMediaSource } from "../platform/desktopBridge";

type ExportJobStatus =
  | "pending"
  | "rendering"
  | "encoding"
  | "success"
  | "failed"
  | "cancelled";

type ExportJob = {
  id: string;
  createdAt: number;
  status: ExportJobStatus;
  progress: number;
  message: string;
  outputPath?: string;
  width: number;
  height: number;
  fps: number;
  videoBitrateKbps: number;
  attempt: number;
  maxAutoRetries: number;
  errorDetail?: string;
};

type ExportLogEntry = {
  timestamp: number;
  kind: string;
  status: string;
  message: string;
  outputPath?: string;
};

type LogFilter = "all" | "success" | "failed";
type TimelineMarker = {
  id: string;
  frame: number;
  label: string;
};

const MAX_EXPORT_QUEUE_ITEMS = 20;
const LOG_PAGE_SIZE = 8;
const EXPORT_QUEUE_STORAGE_KEY = "storyboard-pro/export-queue/v1";
const TIMELINE_MARKER_STORAGE_KEY = "storyboard-pro/timeline-markers/v1";
const TIMELINE_PANEL_PREFS_STORAGE_KEY = "storyboard-pro/timeline-panel-prefs/v1";
const loadExportService = () => import("../export-service/animaticExport");
const loadPdfService = () => import("../export-service/storyboardPdf");

function formatAudioTrackKind(kind?: string): string {
  switch (kind) {
    case "dialogue":
      return "对白";
    case "narration":
      return "旁白";
    case "ambience":
      return "环境";
    case "character_sfx":
      return "人物音效";
    case "prop_sfx":
      return "道具音效";
    default:
      return "手动";
  }
}

function inferShotIdFromAudioTrackId(trackId: string): string {
  const ttsMatch = /^audio_tts_(.+?)(?:_(\d+))?$/.exec(trackId);
  if (ttsMatch?.[1]) return ttsMatch[1];
  const soundMatch = /^audio_(?:ambience|character|prop)_(.+)$/.exec(trackId);
  if (soundMatch?.[1]) return soundMatch[1];
  return "";
}

const AUDIO_TRACK_KIND_OPTIONS = [
  { value: "dialogue", label: "对白" },
  { value: "narration", label: "旁白" },
  { value: "ambience", label: "环境" },
  { value: "character_sfx", label: "人物音效" },
  { value: "prop_sfx", label: "道具音效" },
  { value: "manual", label: "手动" }
] as const;

export function TimelinePanel() {
  const project = useStoryboardStore((state) => state.project);
  const shots = useStoryboardStore(selectFilteredShotsForCurrentSequence);
  const selectedShotId = useStoryboardStore((state) => state.selectedShotId);
  const selectShot = useStoryboardStore((state) => state.selectShot);
  const playback = useStoryboardStore((state) => state.playback);
  const togglePlayback = useStoryboardStore((state) => state.togglePlayback);
  const setCurrentFrame = useStoryboardStore((state) => state.setCurrentFrame);
  const setShotDuration = useStoryboardStore((state) => state.setShotDuration);
  const layers = useStoryboardStore((state) => state.layers);
  const moveShotToIndex = useStoryboardStore((state) => state.moveShotToIndex);
  const updateAudioTrack = useStoryboardStore((state) => state.updateAudioTrack);
  const exportSettings = useStoryboardStore((state) => state.exportSettings);
  const setExportSettings = useStoryboardStore((state) => state.setExportSettings);
  const applyExportPreset = useStoryboardStore((state) => state.applyExportPreset);
  const shotStrokes = useStoryboardStore((state) => state.shotStrokes);
  const audioTracks = useStoryboardStore((state) => state.audioTracks);
  const totalFrames = useStoryboardStore(selectTimelineFrames);
  const [exportState, setExportState] = useState<string>("空闲");
  const [exportWidth, setExportWidth] = useState<number>(exportSettings.width);
  const [exportHeight, setExportHeight] = useState<number>(exportSettings.height);
  const [exportFps, setExportFps] = useState<number>(exportSettings.fps);
  const [exportBitrateKbps, setExportBitrateKbps] = useState<number>(
    exportSettings.videoBitrateKbps
  );
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [isProcessingExport, setIsProcessingExport] = useState(false);
  const [logEntries, setLogEntries] = useState<ExportLogEntry[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [cancelController, setCancelController] = useState<AbortController | null>(null);
  const [queuePaused, setQueuePaused] = useState(false);
  const [logFilter, setLogFilter] = useState<LogFilter>("all");
  const [logPage, setLogPage] = useState(1);
  const [defaultMaxAutoRetries, setDefaultMaxAutoRetries] = useState(1);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [dragShotId, setDragShotId] = useState<string | null>(null);
  const [audioPreviewEnabled, setAudioPreviewEnabled] = useState(true);
  const [mutedTrackIds, setMutedTrackIds] = useState<string[]>([]);
  const [soloTrackIds, setSoloTrackIds] = useState<string[]>([]);
  const [enabledAudioKinds, setEnabledAudioKinds] = useState<string[]>(
    AUDIO_TRACK_KIND_OPTIONS.map((item) => item.value)
  );
  const [jumpFrameInput, setJumpFrameInput] = useState<string>("");
  const [jumpSecondsInput, setJumpSecondsInput] = useState<string>("");
  const [timelineZoom, setTimelineZoom] = useState<number>(1);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [inFrame, setInFrame] = useState<number | null>(null);
  const [outFrame, setOutFrame] = useState<number | null>(null);
  const [loopRegionEnabled, setLoopRegionEnabled] = useState(false);
  const [shuttleDirection, setShuttleDirection] = useState<1 | -1>(1);
  const [shuttleMultiplier, setShuttleMultiplier] = useState<1 | 2 | 4>(1);
  const [markers, setMarkers] = useState<TimelineMarker[]>([]);
  const [isQueuePanelCollapsed, setIsQueuePanelCollapsed] = useState(true);
  const [isHistoryPanelCollapsed, setIsHistoryPanelCollapsed] = useState(true);
  const [isMarkersPanelCollapsed, setIsMarkersPanelCollapsed] = useState(true);
  const [autoExpandPanels, setAutoExpandPanels] = useState(true);
  const audioNodesRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const timelineShotRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const queueCountRef = useRef<number | null>(null);
  const historyCountRef = useRef<number | null>(null);
  const markerCountRef = useRef<number | null>(null);
  const audioOverviewLaneRef = useRef<HTMLDivElement | null>(null);
  const audioClipDragRef = useRef<{
    trackId: string;
    startX: number;
    startFrame: number;
    laneWidth: number;
    moved: boolean;
  } | null>(null);
  const suppressAudioClipClickRef = useRef(false);
  const resizeStateRef = useRef<{
    shotId: string;
    startX: number;
    startDuration: number;
  } | null>(null);
  const exportToastReadyRef = useRef(false);

  const buildJobKey = (job: Pick<ExportJob, "width" | "height" | "fps" | "videoBitrateKbps">) =>
    `${job.width}x${job.height}@${job.fps}_${job.videoBitrateKbps}`;
  const formatJobStatus = (status: ExportJobStatus): string => {
    if (status === "pending") return "等待中";
    if (status === "rendering") return "渲染中";
    if (status === "encoding") return "编码中";
    if (status === "success") return "成功";
    if (status === "failed") return "失败";
    return "已取消";
  };
  const formatLogStatus = (status: string): string => {
    const value = status.trim().toLowerCase();
    if (value === "success") return "成功";
    if (value === "failed" || value === "error") return "失败";
    if (value === "cancelled" || value === "canceled") return "已取消";
    if (value === "pending") return "等待中";
    if (value === "rendering") return "渲染中";
    if (value === "encoding") return "编码中";
    return status;
  };
  const formatLogKind = (kind: string): string => {
    const value = kind.trim().toLowerCase();
    if (value === "mp4" || value === "video" || value === "animatic") return "MP4 视频";
    if (value === "pdf" || value === "storyboard_pdf" || value === "storyboard-pdf") return "PDF 分镜";
    if (value === "queue") return "队列";
    if (value === "autosave") return "自动保存";
    return kind;
  };

  const activeTrackIds = useMemo(() => {
    const solo = new Set(soloTrackIds);
    const muted = new Set(mutedTrackIds);
    const enabledKinds = new Set(enabledAudioKinds);
    const hasSolo = solo.size > 0;
    return audioTracks
      .filter((track) => track.filePath.trim().length > 0)
      .filter((track) => enabledKinds.has(track.kind ?? "manual"))
      .filter((track) => (hasSolo ? solo.has(track.id) : true))
      .filter((track) => !muted.has(track.id))
      .map((track) => track.id);
  }, [audioTracks, enabledAudioKinds, mutedTrackIds, soloTrackIds]);

  const audioTrackKindCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const track of audioTracks) {
      const kind = track.kind ?? "manual";
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    return counts;
  }, [audioTracks]);

  const toAudioSource = (rawPath: string) => {
    return toDesktopMediaSource(rawPath);
  };

  const enqueueJob = (
    job: Pick<ExportJob, "width" | "height" | "fps" | "videoBitrateKbps">,
    label = "已加入队列"
  ): boolean => {
    let added = false;
    setExportJobs((previous) => {
      const key = buildJobKey(job);
      const hasDuplicate = previous.some((item) => {
        const active = item.status === "pending" || item.status === "rendering" || item.status === "encoding";
        return active && buildJobKey(item) === key;
      });
      if (hasDuplicate) {
        setExportState("已跳过重复的活动任务");
        return previous;
      }

      const newJob: ExportJob = {
        id: `job_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        createdAt: Date.now(),
        status: "pending",
        progress: 0,
        message: label,
        attempt: 0,
        maxAutoRetries: defaultMaxAutoRetries,
        errorDetail: undefined,
        ...job
      };
      added = true;
      return [newJob, ...previous].slice(0, MAX_EXPORT_QUEUE_ITEMS);
    });
    return added;
  };

  useEffect(() => {
    if (!exportToastReadyRef.current) {
      exportToastReadyRef.current = true;
      return;
    }
    if (exportState === "空闲") return;
    if (exportState.endsWith("...")) return;

    const level =
      exportState.includes("失败")
        ? "error"
        : exportState.includes("取消") || exportState.includes("跳过")
          ? "warning"
          : exportState.includes("完成") || exportState.includes("已")
            ? "success"
            : "info";
    pushToast(exportState, level);
  }, [exportState]);

  useEffect(() => {
    setExportWidth(exportSettings.width);
    setExportHeight(exportSettings.height);
    setExportFps(exportSettings.fps);
    setExportBitrateKbps(exportSettings.videoBitrateKbps);
  }, [exportSettings.fps, exportSettings.height, exportSettings.videoBitrateKbps, exportSettings.width]);

  useEffect(() => {
    const raw = localStorage.getItem(EXPORT_QUEUE_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        jobs?: ExportJob[];
        queuePaused?: boolean;
        defaultMaxAutoRetries?: number;
      };
      if (Array.isArray(parsed.jobs)) {
        const restored = parsed.jobs.map((job) => {
          if (job.status === "rendering" || job.status === "encoding") {
            return {
              ...job,
              status: "pending" as const,
              progress: 0,
              message: "重启后恢复"
            };
          }
          return job;
        });
        setExportJobs(restored.slice(0, MAX_EXPORT_QUEUE_ITEMS));
      }
      if (typeof parsed.queuePaused === "boolean") {
        setQueuePaused(parsed.queuePaused);
      }
      if (typeof parsed.defaultMaxAutoRetries === "number") {
        setDefaultMaxAutoRetries(Math.max(0, Math.min(5, Math.round(parsed.defaultMaxAutoRetries))));
      }
    } catch {
      localStorage.removeItem(EXPORT_QUEUE_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      EXPORT_QUEUE_STORAGE_KEY,
      JSON.stringify({
        jobs: exportJobs,
        queuePaused,
        defaultMaxAutoRetries
      })
    );
  }, [defaultMaxAutoRetries, exportJobs, queuePaused]);

  useEffect(() => {
    const loadLogs = async () => {
      const { listExportLogs } = await loadExportService();
      const logs = await listExportLogs(20);
      setLogEntries(logs);
    };
    void loadLogs();
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem(`${TIMELINE_MARKER_STORAGE_KEY}:${project.id}`);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as TimelineMarker[];
      if (!Array.isArray(parsed)) return;
      const normalized = parsed
        .filter((item) => typeof item.frame === "number")
        .map((item) => ({
          id: String(item.id),
          frame: Math.max(0, Math.round(item.frame)),
          label: String(item.label || "标记")
        }))
        .sort((a, b) => a.frame - b.frame);
      setMarkers(normalized);
    } catch {
      localStorage.removeItem(`${TIMELINE_MARKER_STORAGE_KEY}:${project.id}`);
    }
  }, [project.id]);

  useEffect(() => {
    const raw = localStorage.getItem(TIMELINE_PANEL_PREFS_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        autoExpandPanels?: boolean;
        isQueuePanelCollapsed?: boolean;
        isHistoryPanelCollapsed?: boolean;
        isMarkersPanelCollapsed?: boolean;
        enabledAudioKinds?: string[];
      };
      if (typeof parsed.autoExpandPanels === "boolean") {
        setAutoExpandPanels(parsed.autoExpandPanels);
      }
      if (typeof parsed.isQueuePanelCollapsed === "boolean") {
        setIsQueuePanelCollapsed(parsed.isQueuePanelCollapsed);
      }
      if (typeof parsed.isHistoryPanelCollapsed === "boolean") {
        setIsHistoryPanelCollapsed(parsed.isHistoryPanelCollapsed);
      }
      if (typeof parsed.isMarkersPanelCollapsed === "boolean") {
        setIsMarkersPanelCollapsed(parsed.isMarkersPanelCollapsed);
      }
      if (Array.isArray(parsed.enabledAudioKinds)) {
        const knownKinds = new Set(AUDIO_TRACK_KIND_OPTIONS.map((item) => item.value));
        const normalizedKinds = parsed.enabledAudioKinds
          .map((item) => String(item))
          .filter(
            (item): item is (typeof AUDIO_TRACK_KIND_OPTIONS)[number]["value"] => knownKinds.has(item as (typeof AUDIO_TRACK_KIND_OPTIONS)[number]["value"])
          );
        setEnabledAudioKinds(
          normalizedKinds
        );
      }
    } catch {
      localStorage.removeItem(TIMELINE_PANEL_PREFS_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      `${TIMELINE_MARKER_STORAGE_KEY}:${project.id}`,
      JSON.stringify(markers)
    );
  }, [markers, project.id]);

  useEffect(() => {
    localStorage.setItem(
      TIMELINE_PANEL_PREFS_STORAGE_KEY,
      JSON.stringify({
        autoExpandPanels,
        isQueuePanelCollapsed,
        isHistoryPanelCollapsed,
        isMarkersPanelCollapsed,
        enabledAudioKinds
      })
    );
  }, [
    autoExpandPanels,
    enabledAudioKinds,
    isHistoryPanelCollapsed,
    isMarkersPanelCollapsed,
    isQueuePanelCollapsed
  ]);

  useEffect(() => {
    const currentCount = exportJobs.length;
    const previousCount = queueCountRef.current;
    if (previousCount === null) {
      queueCountRef.current = currentCount;
      return;
    }
    if (currentCount === 0) {
      setIsQueuePanelCollapsed(true);
    } else if (autoExpandPanels && previousCount === 0 && currentCount > 0) {
      setIsQueuePanelCollapsed(false);
    }
    queueCountRef.current = currentCount;
  }, [autoExpandPanels, exportJobs.length]);

  useEffect(() => {
    const currentCount = logEntries.length;
    const previousCount = historyCountRef.current;
    if (previousCount === null) {
      historyCountRef.current = currentCount;
      return;
    }
    if (currentCount === 0) {
      setIsHistoryPanelCollapsed(true);
    } else if (autoExpandPanels && currentCount > previousCount) {
      setIsHistoryPanelCollapsed(false);
    }
    historyCountRef.current = currentCount;
  }, [autoExpandPanels, logEntries.length]);

  useEffect(() => {
    const currentCount = markers.length;
    const previousCount = markerCountRef.current;
    if (previousCount === null) {
      markerCountRef.current = currentCount;
      return;
    }
    if (currentCount === 0) {
      setIsMarkersPanelCollapsed(true);
    } else if (autoExpandPanels && currentCount > previousCount) {
      setIsMarkersPanelCollapsed(false);
    }
    markerCountRef.current = currentCount;
  }, [autoExpandPanels, markers.length]);

  useEffect(() => {
    if (playback.currentFrame >= totalFrames && totalFrames > 0) {
      setCurrentFrame(totalFrames - 1);
    }
  }, [playback.currentFrame, setCurrentFrame, totalFrames]);

  useEffect(() => {
    if (!playback.playing || totalFrames <= 0) return;

    const hasRegion = inFrame !== null && outFrame !== null;
    const regionStart = hasRegion ? Math.min(inFrame, outFrame) : 0;
    const regionEnd = hasRegion ? Math.max(inFrame, outFrame) : Math.max(0, totalFrames - 1);
    if (loopRegionEnabled && hasRegion) {
      const current = useStoryboardStore.getState().playback.currentFrame;
      if (current < regionStart || current > regionEnd) {
        setCurrentFrame(regionStart);
      }
    }

    const intervalMs = Math.max(10, Math.round(1000 / project.fps));
    const timerId = window.setInterval(() => {
      const delta = shuttleDirection * shuttleMultiplier;
      const next = useStoryboardStore.getState().playback.currentFrame + delta;
      if (loopRegionEnabled && hasRegion) {
        if (shuttleDirection > 0) {
          setCurrentFrame(next > regionEnd ? regionStart : next);
        } else {
          setCurrentFrame(next < regionStart ? regionEnd : next);
        }
        return;
      }
      if (next >= totalFrames) {
        setCurrentFrame(0);
      } else if (next < 0) {
        setCurrentFrame(Math.max(0, totalFrames - 1));
      } else {
        setCurrentFrame(next);
      }
    }, intervalMs);

    return () => window.clearInterval(timerId);
  }, [
    inFrame,
    loopRegionEnabled,
    outFrame,
    playback.playing,
    project.fps,
    setCurrentFrame,
    shuttleDirection,
    shuttleMultiplier,
    totalFrames
  ]);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return (
        target.isContentEditable ||
        tag === "input" ||
        tag === "textarea" ||
        tag === "select"
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.shiftKey && event.code === "Space") {
        event.preventDefault();
        setLoopRegionEnabled((value) => !value);
        return;
      }

      if (event.key === "k" || event.key === "K") {
        event.preventDefault();
        if (useStoryboardStore.getState().playback.playing) {
          togglePlayback();
        }
        setShuttleDirection(1);
        setShuttleMultiplier(1);
        return;
      }

      if (event.key === "l" || event.key === "L") {
        event.preventDefault();
        const playing = useStoryboardStore.getState().playback.playing;
        setShuttleDirection(1);
        setShuttleMultiplier((value) =>
          playing && shuttleDirection === 1
            ? (value === 1 ? 2 : value === 2 ? 4 : 1)
            : 1
        );
        if (!playing) togglePlayback();
        return;
      }

      if (event.key === "j" || event.key === "J") {
        event.preventDefault();
        const playing = useStoryboardStore.getState().playback.playing;
        setShuttleDirection(-1);
        setShuttleMultiplier((value) =>
          playing && shuttleDirection === -1
            ? (value === 1 ? 2 : value === 2 ? 4 : 1)
            : 1
        );
        if (!playing) togglePlayback();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shuttleDirection, togglePlayback]);

  useEffect(() => {
    const fps = Math.max(1, project.fps);
    const nodes = audioNodesRef.current;

    if (!audioPreviewEnabled || !playback.playing) {
      for (const node of nodes.values()) {
        node.pause();
      }
      return;
    }

    const allowed = new Set(activeTrackIds);
    const activeTracks = audioTracks.filter((track) => allowed.has(track.id));

    for (const [trackId, node] of nodes) {
      if (!allowed.has(trackId)) {
        node.pause();
      }
    }

    for (const track of activeTracks) {
      let node = nodes.get(track.id);
      const src = toAudioSource(track.filePath);
      if (!src) continue;

      if (!node) {
        node = new Audio(src);
        node.preload = "auto";
        nodes.set(track.id, node);
      } else if (node.src !== src) {
        node.pause();
        node.src = src;
      }

      node.volume = Math.max(0, Math.min(2, track.gain));
      const offsetSec = (playback.currentFrame - track.startFrame) / fps;
      if (offsetSec <= 0) {
        node.pause();
        node.currentTime = 0;
        continue;
      }

      if (Math.abs(node.currentTime - offsetSec) > 0.2) {
        node.currentTime = offsetSec;
      }

      if (node.paused) {
        void node.play().catch(() => {
          node?.pause();
        });
      }
    }
  }, [activeTrackIds, audioPreviewEnabled, audioTracks, playback.currentFrame, playback.playing, project.fps]);

  useEffect(() => {
    const activeIds = new Set(audioTracks.map((track) => track.id));
    setMutedTrackIds((previous) => previous.filter((id) => activeIds.has(id)));
    setSoloTrackIds((previous) => previous.filter((id) => activeIds.has(id)));

    const nodes = audioNodesRef.current;
    for (const [trackId, node] of nodes) {
      if (!activeIds.has(trackId)) {
        node.pause();
        nodes.delete(trackId);
      }
    }
  }, [audioTracks]);

  useEffect(() => {
    return () => {
      for (const node of audioNodesRef.current.values()) {
        node.pause();
      }
      audioNodesRef.current.clear();
    };
  }, []);

  const onToggleTrackMute = (trackId: string) => {
    setMutedTrackIds((previous) =>
      previous.includes(trackId)
        ? previous.filter((id) => id !== trackId)
        : [...previous, trackId]
    );
  };

  const onToggleTrackSolo = (trackId: string) => {
    setSoloTrackIds((previous) =>
      previous.includes(trackId)
        ? previous.filter((id) => id !== trackId)
        : [...previous, trackId]
    );
  };

  const onToggleAudioKind = (kind: string) => {
    setEnabledAudioKinds((previous) =>
      previous.includes(kind) ? previous.filter((item) => item !== kind) : [...previous, kind]
    );
  };

  const onExportMp4 = async () => {
    const added = enqueueJob({
      width: Math.max(320, exportWidth),
      height: Math.max(240, exportHeight),
      fps: Math.max(1, exportFps),
      videoBitrateKbps: Math.max(500, exportBitrateKbps)
    });
    if (added) {
      setExportState("MP4 导出已加入队列");
    }
  };

  const onRetryJob = (job: ExportJob) => {
    const added = enqueueJob(
      {
        width: job.width,
        height: job.height,
        fps: job.fps,
        videoBitrateKbps: job.videoBitrateKbps
      },
      "已加入队列（重试）"
    );
    if (added) {
      setExportJobs((previous) =>
        previous.map((item) =>
          item.id === job.id
            ? {
                ...item,
                message: "已手动重试"
              }
            : item
        )
      );
      setExportState("重试已加入队列");
    }
  };

  const onMoveJobToTop = (jobId: string) => {
    setExportJobs((previous) => {
      const index = previous.findIndex((job) => job.id === jobId);
      if (index <= 0) return previous;
      if (previous[index].status !== "pending") return previous;
      const next = [...previous];
      const [target] = next.splice(index, 1);
      const firstPending = next.findIndex((job) => job.status === "pending");
      if (firstPending <= 0) {
        next.unshift(target);
      } else {
        next.splice(firstPending, 0, target);
      }
      return next;
    });
    setExportState("任务已移到队首");
  };

  useEffect(() => {
    if (isProcessingExport) return;
    if (queuePaused) return;
    const nextJob = exportJobs.find((job) => job.status === "pending");
    if (!nextJob) return;

    const run = async () => {
      setIsProcessingExport(true);
      setActiveJobId(nextJob.id);
      const controller = new AbortController();
      setCancelController(controller);
      setExportJobs((previous) =>
        previous.map((job) =>
          job.id === nextJob.id
            ? {
                ...job,
                status: "rendering",
                message: "开始导出...",
                errorDetail: undefined
              }
            : job
        )
      );

      try {
        const { exportAnimaticVideo } = await loadExportService();
        const outputPath = await exportAnimaticVideo({
          width: nextJob.width,
          height: nextJob.height,
          fps: nextJob.fps,
          videoBitrateKbps: nextJob.videoBitrateKbps,
          shots,
          layers,
          shotStrokes,
          audioTracks,
          signal: controller.signal,
          onProgress: (progress, message) => {
            setExportJobs((previous) =>
              previous.map((job) =>
                job.id === nextJob.id
                  ? {
                      ...job,
                      progress,
                      status: progress >= 0.9 ? "encoding" : "rendering",
                      message
                    }
                  : job
              )
            );
          }
        });

        if (!outputPath) {
          setExportJobs((previous) =>
            previous.map((job) =>
              job.id === nextJob.id
                ? { ...job, status: "failed", message: "请在 Tauri 桌面环境运行", progress: 1 }
                : job
            )
          );
          setExportState("导出已跳过（请在 Tauri 桌面环境运行）");
        } else {
          setExportJobs((previous) =>
            previous.map((job) =>
              job.id === nextJob.id
                ? {
                    ...job,
                    status: "success",
                    message: "完成",
                    progress: 1,
                    outputPath,
                    errorDetail: undefined
                  }
                : job
            )
          );
          setExportState(`MP4 导出完成：${outputPath}`);
        }
      } catch (error) {
        const message = String(error);
        const isCancelled = message.includes("AbortError");
        if (!isCancelled && nextJob.attempt < nextJob.maxAutoRetries) {
          const nextAttempt = nextJob.attempt + 1;
          setExportJobs((previous) =>
            previous.map((job) =>
              job.id === nextJob.id
                ? {
                    ...job,
                    status: "pending",
                    message: `自动重试 ${nextAttempt}/${nextJob.maxAutoRetries}`,
                    progress: 0,
                    attempt: nextAttempt,
                    errorDetail: message
                  }
                : job
            )
          );
          setExportState(`已安排重试（${nextAttempt}/${nextJob.maxAutoRetries}）`);
        } else {
          setExportJobs((previous) =>
            previous.map((job) =>
              job.id === nextJob.id
                ? {
                    ...job,
                    status: isCancelled ? "cancelled" : "failed",
                    message: isCancelled ? "已取消" : message,
                    progress: isCancelled ? job.progress : 1,
                    errorDetail: message
                  }
                : job
            )
          );
          setExportState(isCancelled ? "导出已取消" : `MP4 导出失败：${message}`);
        }
      } finally {
        setCancelController(null);
        setActiveJobId(null);
        setIsProcessingExport(false);
        const { listExportLogs } = await loadExportService();
        const logs = await listExportLogs(20);
        setLogEntries(logs);
      }
    };

    void run();
  }, [audioTracks, exportJobs, isProcessingExport, layers, queuePaused, shotStrokes, shots]);

  const onCancelExport = async () => {
    const confirmed = await confirmDialog({
      title: "取消当前导出",
      message: "确认取消当前正在执行的导出任务吗？",
      confirmText: "取消导出",
      danger: true
    });
    if (!confirmed) return;
    cancelController?.abort();
  };

  const onToggleQueuePaused = () => {
    setQueuePaused((value) => !value);
  };

  const onSaveExportDefaults = () => {
    setExportSettings({
      width: exportWidth,
      height: exportHeight,
      fps: exportFps,
      videoBitrateKbps: exportBitrateKbps
    });
    setExportState("已保存为项目默认设置");
  };

  const onPreset = (preset: "hd1080" | "hd720" | "vertical1080") => {
    applyExportPreset(preset);
    const latest = useStoryboardStore.getState().exportSettings;
    setExportWidth(latest.width);
    setExportHeight(latest.height);
    setExportFps(latest.fps);
    setExportState(`预设已应用：${preset}`);
  };

  const onExportPdf = async () => {
    try {
      const { exportStoryboardPdf } = await loadPdfService();
      exportStoryboardPdf(project, shots);
      setExportState("PDF 导出完成");
    } catch (error) {
      setExportState(`PDF 导出失败：${String(error)}`);
    }
  };

  const onTimelineDragStart = (shotId: string) => {
    setDragShotId(shotId);
  };

  const onTimelineDragEnd = () => {
    setDragShotId(null);
  };

  const onTimelineDrop = (targetIndex: number) => {
    if (!dragShotId) return;
    moveShotToIndex(dragShotId, targetIndex);
    setDragShotId(null);
  };

  const onOverviewVideoDrop = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!dragShotId || shots.length === 0) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width <= 0 ? 0 : (event.clientX - rect.left) / rect.width;
    const frame = Math.round(Math.max(0, Math.min(1, ratio)) * safeTotalFrames);
    const targetIndex = shotTimelineEntries.findIndex((entry) => frame < entry.startFrame + entry.shot.durationFrames / 2);
    onTimelineDrop(targetIndex < 0 ? shots.length - 1 : targetIndex);
  };

  useEffect(() => {
    if (!selectedShotId) return;
    timelineShotRefs.current[selectedShotId]?.scrollIntoView({
      inline: "nearest",
      behavior: "smooth"
    });
  }, [selectedShotId]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const state = resizeStateRef.current;
      if (state) {
        const deltaX = event.clientX - state.startX;
        const frameStep = Math.round(deltaX / 6);
        const nextDuration = Math.max(1, state.startDuration + frameStep);
        setShotDuration(state.shotId, nextDuration);
      }

      const audioState = audioClipDragRef.current;
      if (audioState) {
        const deltaX = event.clientX - audioState.startX;
        const frameOffset = Math.round((deltaX / Math.max(1, audioState.laneWidth)) * Math.max(1, totalFrames));
        const nextStartFrame = Math.max(
          0,
          Math.min(Math.max(0, totalFrames - 1), audioState.startFrame + frameOffset)
        );
        if (nextStartFrame !== useStoryboardStore.getState().audioTracks.find((track) => track.id === audioState.trackId)?.startFrame) {
          updateAudioTrack(audioState.trackId, { startFrame: nextStartFrame });
        }
        if (Math.abs(deltaX) > 3) {
          audioState.moved = true;
          suppressAudioClipClickRef.current = true;
        }
      }
    };

    const onMouseUp = () => {
      resizeStateRef.current = null;
      audioClipDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [setShotDuration, totalFrames, updateAudioTrack]);

  const onTimelineResizeStart = (event: ReactMouseEvent<HTMLButtonElement>, shotId: string, duration: number) => {
    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = {
      shotId,
      startX: event.clientX,
      startDuration: duration
    };
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  };

  const findShotIndexByFrame = (frame: number): number => {
    let cursor = 0;
    for (let index = 0; index < shots.length; index += 1) {
      const end = cursor + shots[index].durationFrames;
      if (frame < end) return index;
      cursor = end;
    }
    return Math.max(0, shots.length - 1);
  };

  const currentShotIndex = shots.length > 0 ? findShotIndexByFrame(playback.currentFrame) : -1;
  const currentShot = currentShotIndex >= 0 ? shots[currentShotIndex] : undefined;
  const safeTotalFrames = Math.max(1, totalFrames);
  const shotTimelineEntries = useMemo(() => {
    let cursor = 0;
    return shots.map((shot) => {
      const startFrame = cursor;
      const durationFrames = Math.max(1, shot.durationFrames);
      cursor += durationFrames;
      return {
        shot,
        startFrame,
        endFrame: cursor,
        leftPct: (startFrame / safeTotalFrames) * 100,
        widthPct: (durationFrames / safeTotalFrames) * 100
      };
    });
  }, [safeTotalFrames, shots]);
  const shotTimelineMap = useMemo(
    () =>
      Object.fromEntries(
        shotTimelineEntries.map((entry) => [entry.shot.id, entry] as const)
      ) as Record<string, (typeof shotTimelineEntries)[number]>,
    [shotTimelineEntries]
  );
  const pixelsPerFrame = Math.max(2, Math.round(8 * timelineZoom));
  const totalTimelineWidth = Math.max(720, totalFrames * pixelsPerFrame);
  const rulerStep = useMemo(() => {
    if (totalFrames <= 60) return 5;
    if (totalFrames <= 180) return 10;
    if (totalFrames <= 600) return 30;
    if (totalFrames <= 1200) return 60;
    return 120;
  }, [totalFrames]);
  const rulerTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let frame = 0; frame <= totalFrames; frame += rulerStep) {
      ticks.push(frame);
    }
    if (ticks[ticks.length - 1] !== totalFrames) ticks.push(totalFrames);
    return ticks;
  }, [rulerStep, totalFrames]);
  const boundaryFrames = useMemo(() => {
    const values = new Set<number>([0]);
    let cursor = 0;
    for (const shot of shots) {
      values.add(cursor);
      cursor += shot.durationFrames;
      values.add(cursor);
    }
    return [...values].sort((a, b) => a - b);
  }, [shots]);
  const markerFrames = useMemo(
    () => [...new Set(markers.map((item) => item.frame))].sort((a, b) => a - b),
    [markers]
  );
  const snapFrames = useMemo(
    () => [...new Set([...boundaryFrames, ...markerFrames])].sort((a, b) => a - b),
    [boundaryFrames, markerFrames]
  );
  const regionStartFrame = inFrame !== null && outFrame !== null ? Math.min(inFrame, outFrame) : null;
  const regionEndFrame = inFrame !== null && outFrame !== null ? Math.max(inFrame, outFrame) : null;
  const regionBandLeft =
    regionStartFrame === null ? 0 : Math.min(totalTimelineWidth, regionStartFrame * pixelsPerFrame);
  const regionBandWidth =
    regionStartFrame === null || regionEndFrame === null
      ? 0
      : Math.max(2, (regionEndFrame - regionStartFrame + 1) * pixelsPerFrame);
  const overviewPlayheadPct = (Math.min(playback.currentFrame, Math.max(0, totalFrames - 1)) / safeTotalFrames) * 100;
  const overviewRegionLeftPct =
    regionStartFrame === null ? 0 : (Math.min(regionStartFrame, safeTotalFrames) / safeTotalFrames) * 100;
  const overviewRegionWidthPct =
    regionStartFrame === null || regionEndFrame === null
      ? 0
      : (Math.max(1, regionEndFrame - regionStartFrame + 1) / safeTotalFrames) * 100;
  const overviewMarkerEntries = useMemo(
    () =>
      markers.map((marker) => ({
        ...marker,
        leftPct: (Math.max(0, Math.min(marker.frame, safeTotalFrames)) / safeTotalFrames) * 100
      })),
    [markers, safeTotalFrames]
  );
  const audioOverviewClips = useMemo(() => {
    const groupedByShot = new Map<string, typeof audioTracks>();
    for (const track of audioTracks) {
      const shotId = inferShotIdFromAudioTrackId(track.id);
      if (!shotId) continue;
      groupedByShot.set(shotId, [...(groupedByShot.get(shotId) ?? []), track]);
    }
    const rawClips = audioTracks
      .filter((track) => track.filePath.trim().length > 0)
      .map((track) => {
        const shotId = inferShotIdFromAudioTrackId(track.id);
        const shotEntry = shotId ? shotTimelineMap[shotId] : undefined;
        let durationFrames = Math.max(12, project.fps);
        if (track.id.startsWith("audio_tts_") && shotId && shotEntry) {
          const sameShot = [...(groupedByShot.get(shotId) ?? [])]
            .filter((item) => item.id.startsWith("audio_tts_"))
            .sort((a, b) => a.startFrame - b.startFrame);
          const currentIndex = sameShot.findIndex((item) => item.id === track.id);
          const nextStartFrame = sameShot[currentIndex + 1]?.startFrame ?? shotEntry.endFrame;
          durationFrames = Math.max(6, nextStartFrame - track.startFrame);
        } else if (shotEntry) {
          durationFrames = Math.max(12, shotEntry.shot.durationFrames);
        }
        return {
          track,
          shotId,
          startFrame: Math.max(0, track.startFrame),
          durationFrames,
          leftPct: (Math.max(0, track.startFrame) / safeTotalFrames) * 100,
          widthPct: (Math.max(1, durationFrames) / safeTotalFrames) * 100
        };
      })
      .sort((a, b) => a.startFrame - b.startFrame || a.durationFrames - b.durationFrames);

    const rowEndFrames: number[] = [];
    return rawClips.map((clip) => {
      let row = rowEndFrames.findIndex((endFrame) => clip.startFrame >= endFrame);
      if (row < 0) {
        row = rowEndFrames.length;
        rowEndFrames.push(clip.startFrame + clip.durationFrames);
      } else {
        rowEndFrames[row] = clip.startFrame + clip.durationFrames;
      }
      return { ...clip, row };
    });
  }, [audioTracks, project.fps, safeTotalFrames, shotTimelineMap]);
  const audioOverviewRowCount = Math.max(
    1,
    audioOverviewClips.reduce((maxRow, clip) => Math.max(maxRow, clip.row + 1), 1)
  );
  const getSnappedFrame = (frame: number): number => {
    if (!snapEnabled) return frame;
    const threshold = Math.max(1, Math.round(2 / timelineZoom));
    let best = frame;
    let bestDistance = threshold + 1;
    for (const targetFrame of snapFrames) {
      const distance = Math.abs(targetFrame - frame);
      if (distance <= threshold && distance < bestDistance) {
        best = targetFrame;
        bestDistance = distance;
      }
    }
    return best;
  };

  const onJumpToFrame = () => {
    const next = Number(jumpFrameInput);
    if (!Number.isFinite(next)) return;
    const bounded = Math.max(0, Math.min(Math.round(next), Math.max(0, totalFrames - 1)));
    setCurrentFrame(getSnappedFrame(bounded));
  };

  const onJumpToSeconds = () => {
    const seconds = Number(jumpSecondsInput);
    if (!Number.isFinite(seconds)) return;
    const frame = Math.round(Math.max(0, seconds) * Math.max(1, project.fps));
    const bounded = Math.max(0, Math.min(frame, Math.max(0, totalFrames - 1)));
    setCurrentFrame(getSnappedFrame(bounded));
  };

  const onScrubFrame = (value: number) => {
    const bounded = Math.max(0, Math.min(Math.round(value), Math.max(0, totalFrames - 1)));
    setCurrentFrame(getSnappedFrame(bounded));
  };

  const onAudioClipDragStart = (
    event: ReactMouseEvent<HTMLButtonElement>,
    trackId: string,
    startFrame: number
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const laneWidth = audioOverviewLaneRef.current?.getBoundingClientRect().width ?? 0;
    if (laneWidth <= 0) return;
    audioClipDragRef.current = {
      trackId,
      startX: event.clientX,
      startFrame,
      laneWidth,
      moved: false
    };
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  };

  const onOverviewLaneClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (totalFrames <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width <= 0 ? 0 : (event.clientX - rect.left) / rect.width;
    const frame = Math.round(Math.max(0, Math.min(1, ratio)) * Math.max(0, totalFrames - 1));
    onScrubFrame(frame);
  };

  const onSetInFrame = () => {
    setInFrame(Math.max(0, Math.min(playback.currentFrame, Math.max(0, totalFrames - 1))));
  };

  const onSetOutFrame = () => {
    setOutFrame(Math.max(0, Math.min(playback.currentFrame, Math.max(0, totalFrames - 1))));
  };

  const onClearRegion = () => {
    setInFrame(null);
    setOutFrame(null);
    setLoopRegionEnabled(false);
  };

  const onAddMarker = async () => {
    const label = (await promptDialog({
      title: "标记名称",
      defaultValue: `标记${markers.length + 1}`,
      confirmText: "添加"
    }))?.trim();
    if (!label) return;
    const frame = Math.max(0, Math.min(playback.currentFrame, Math.max(0, totalFrames - 1)));
    const next: TimelineMarker = {
      id: `marker_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      frame,
      label
    };
    setMarkers((previous) => [...previous, next].sort((a, b) => a.frame - b.frame));
  };

  const onDeleteMarker = async (markerId: string) => {
    const confirmed = await confirmDialog({
      title: "删除标记",
      message: "确认删除这个时间轴标记吗？",
      confirmText: "删除",
      danger: true
    });
    if (!confirmed) return;
    setMarkers((previous) => previous.filter((item) => item.id !== markerId));
  };

  const onRenameMarker = async (markerId: string) => {
    const marker = markers.find((item) => item.id === markerId);
    if (!marker) return;
    const next = (await promptDialog({
      title: "重命名标记",
      defaultValue: marker.label,
      confirmText: "重命名"
    }))?.trim();
    if (!next) return;
    setMarkers((previous) =>
      previous.map((item) => (item.id === markerId ? { ...item, label: next } : item))
    );
  };

  const onJumpPrevMarker = () => {
    const previous = [...markers]
      .filter((item) => item.frame < playback.currentFrame)
      .sort((a, b) => b.frame - a.frame)[0];
    if (!previous) return;
    setCurrentFrame(previous.frame);
  };

  const onJumpNextMarker = () => {
    const next = [...markers]
      .filter((item) => item.frame > playback.currentFrame)
      .sort((a, b) => a.frame - b.frame)[0];
    if (!next) return;
    setCurrentFrame(next.frame);
  };

  const onPrevShotBoundary = () => {
    if (shots.length === 0) return;
    const targetIndex = Math.max(0, currentShotIndex - 1);
    const targetFrame = selectShotStartFrame(useStoryboardStore.getState(), shots[targetIndex].id);
    setCurrentFrame(targetFrame);
  };

  const onNextShotBoundary = () => {
    if (shots.length === 0) return;
    const targetIndex = Math.min(shots.length - 1, currentShotIndex + 1);
    const targetFrame = selectShotStartFrame(useStoryboardStore.getState(), shots[targetIndex].id);
    setCurrentFrame(targetFrame);
  };

  const filteredLogs = logEntries.filter((entry) => {
    if (logFilter === "all") return true;
    if (logFilter === "success") return entry.status === "success";
    return entry.status === "failed";
  });
  const totalLogPages = Math.max(1, Math.ceil(filteredLogs.length / LOG_PAGE_SIZE));
  const safeLogPage = Math.min(logPage, totalLogPages);
  const pagedLogs = filteredLogs.slice(
    (safeLogPage - 1) * LOG_PAGE_SIZE,
    safeLogPage * LOG_PAGE_SIZE
  );
  const queueSummary =
    exportJobs.length === 0
      ? "暂无导出任务"
      : `${formatJobStatus(exportJobs[0].status)} · ${exportJobs[0].message}`;
  const historySummary =
    filteredLogs.length === 0
      ? "暂无导出日志"
      : `${formatLogStatus(filteredLogs[0].status)} · ${filteredLogs[0].message}`;
  const markersSummary =
    markers.length === 0
      ? "暂无标记"
      : `${markers[0].label} @ ${markers[0].frame}f`;
  const onCollapseLowerPanels = () => {
    setIsQueuePanelCollapsed(true);
    setIsHistoryPanelCollapsed(true);
    setIsMarkersPanelCollapsed(true);
  };
  const onExpandLowerPanels = () => {
    setIsQueuePanelCollapsed(false);
    setIsHistoryPanelCollapsed(false);
    setIsMarkersPanelCollapsed(false);
  };

  return (
    <section className="panel timeline-panel">
      <header className="panel-header">
        <h2>时间轴</h2>
        <div className="timeline-actions timeline-main-tools">
          <button
            aria-label={playback.playing ? "暂停播放" : "开始播放"}
            className="timeline-icon-btn"
            onClick={togglePlayback}
            title={playback.playing ? "暂停播放" : "开始播放"}
            type="button"
          >
            <span aria-hidden>{playback.playing ? "⏸" : "▶"}</span>
          </button>
          <button
            aria-label="导出 MP4"
            className="timeline-icon-btn"
            onClick={onExportMp4}
            title="导出 MP4"
            type="button"
          >
            <span aria-hidden>V</span>
          </button>
          <button
            aria-label="导出 PDF"
            className="timeline-icon-btn"
            onClick={onExportPdf}
            title="导出 PDF"
            type="button"
          >
            <span aria-hidden>P</span>
          </button>
        </div>
      </header>
      <div className="timeline-meta">总计：{totalFrames} 帧 · 当前帧：{playback.currentFrame}</div>
      <section className="timeline-overview-panel">
        <div className="timeline-overview-toolbar">
          <div className="timeline-overview-summary">
            <strong>{currentShot ? `${currentShot.order}. ${currentShot.title}` : "暂无镜头"}</strong>
            <span>当前 {playback.currentFrame}f / {(playback.currentFrame / Math.max(1, project.fps)).toFixed(2)}s</span>
            <span>In {inFrame ?? "-"}f / Out {outFrame ?? "-"}f</span>
          </div>
          <div className="timeline-actions timeline-jump-nav">
            <button
              aria-label="上一镜头"
              className="timeline-icon-btn"
              onClick={onPrevShotBoundary}
              title="上一镜头"
              type="button"
            >
              <span aria-hidden>⟨</span>
            </button>
            <button
              aria-label="下一镜头"
              className="timeline-icon-btn"
              onClick={onNextShotBoundary}
              title="下一镜头"
              type="button"
            >
              <span aria-hidden>⟩</span>
            </button>
            <button
              aria-label="上一标记"
              className="timeline-icon-btn"
              onClick={onJumpPrevMarker}
              title="上一标记"
              type="button"
            >
              <span aria-hidden>◂M</span>
            </button>
            <button
              aria-label="下一标记"
              className="timeline-icon-btn"
              onClick={onJumpNextMarker}
              title="下一标记"
              type="button"
            >
              <span aria-hidden>M▸</span>
            </button>
            <button
              aria-label="设为 In 点"
              className="timeline-icon-btn"
              onClick={onSetInFrame}
              title="设为 In 点"
              type="button"
            >
              <span aria-hidden>I</span>
            </button>
            <button
              aria-label="设为 Out 点"
              className="timeline-icon-btn"
              onClick={onSetOutFrame}
              title="设为 Out 点"
              type="button"
            >
              <span aria-hidden>O</span>
            </button>
            <button
              aria-label="清除 I/O"
              className="timeline-icon-btn"
              onClick={onClearRegion}
              title="清除 I/O"
              type="button"
            >
              <span aria-hidden>✕</span>
            </button>
          </div>
        </div>
        <div className="timeline-overview-jump-grid">
          <label>
            帧号
            <input
              onChange={(event) => setJumpFrameInput(event.target.value)}
              placeholder={`${playback.currentFrame}`}
              type="number"
              value={jumpFrameInput}
            />
          </label>
          <button onClick={onJumpToFrame} type="button">跳到帧</button>
          <label>
            秒数
            <input
              onChange={(event) => setJumpSecondsInput(event.target.value)}
              placeholder={(playback.currentFrame / Math.max(1, project.fps)).toFixed(2)}
              step={0.01}
              type="number"
              value={jumpSecondsInput}
            />
          </label>
          <button onClick={onJumpToSeconds} type="button">跳到时间</button>
          <label className="timeline-snap-toggle">
            <input
              checked={loopRegionEnabled}
              onChange={(event) => setLoopRegionEnabled(event.target.checked)}
              type="checkbox"
            />
            循环 I/O
          </label>
        </div>
        <div className="timeline-overview-lanes">
          <div className="timeline-overview-lane-block">
            <div className="timeline-overview-lane-head">
              <div>
                <strong>视频层</strong>
                <span>点击镜头块或空白区域跳到对应帧</span>
              </div>
            </div>
            <div
              className="timeline-overview-lane timeline-overview-video-lane"
              onClick={onOverviewLaneClick}
              onDragOver={(event) => event.preventDefault()}
              onDrop={onOverviewVideoDrop}
              role="button"
              tabIndex={0}
            >
              {regionStartFrame !== null && regionEndFrame !== null && (
                <div
                  className="timeline-overview-region"
                  style={{ left: `${overviewRegionLeftPct}%`, width: `${overviewRegionWidthPct}%` }}
                />
              )}
              <div className="timeline-overview-playhead" style={{ left: `${overviewPlayheadPct}%` }} />
              {overviewMarkerEntries.map((marker) => (
                <button
                  key={marker.id}
                  className="timeline-overview-marker"
                  onClick={(event) => {
                    event.stopPropagation();
                    setCurrentFrame(marker.frame);
                  }}
                  style={{ left: `${marker.leftPct}%` }}
                  title={`${marker.label} · ${marker.frame}f`}
                  type="button"
                />
              ))}
              {shotTimelineEntries.map((entry, index) => {
                const isActive =
                  entry.shot.id === selectedShotId ||
                  (playback.currentFrame >= entry.startFrame && playback.currentFrame < entry.endFrame);
                return (
                  <button
                    key={entry.shot.id}
                    className={[
                      "timeline-overview-clip",
                      isActive ? "active" : "",
                      dragShotId === entry.shot.id ? "is-dragging" : ""
                    ].filter(Boolean).join(" ")}
                    draggable
                    onDragEnd={onTimelineDragEnd}
                    onDragOver={(event) => event.preventDefault()}
                    onDragStart={() => onTimelineDragStart(entry.shot.id)}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onTimelineDrop(index);
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectShot(entry.shot.id);
                      setCurrentFrame(entry.startFrame);
                    }}
                    style={{ left: `${entry.leftPct}%`, width: `${entry.widthPct}%` }}
                    title={`${entry.shot.order}. ${entry.shot.title} · ${entry.shot.durationFrames}f`}
                    type="button"
                  >
                    <span className="timeline-overview-clip-index">{entry.shot.order}</span>
                    <span className="timeline-overview-clip-label">{entry.shot.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="timeline-overview-lane-block">
            <div className="timeline-overview-lane-head">
              <div>
                <strong>音频层</strong>
                <span>点击音频块跳到片段起点，点击空白跳到对应帧</span>
              </div>
              <div className="timeline-actions">
                <label className="audio-preview-toggle">
                  <input
                    checked={audioPreviewEnabled}
                    onChange={(event) => setAudioPreviewEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  试听
                </label>
                {AUDIO_TRACK_KIND_OPTIONS.map((option) => {
                  const enabled = enabledAudioKinds.includes(option.value);
                  const count = audioTrackKindCounts[option.value] ?? 0;
                  return (
                    <button
                      key={option.value}
                      aria-label={enabled ? `关闭${option.label}预览` : `开启${option.label}预览`}
                      className={`${enabled ? "toggle-on " : ""}timeline-icon-btn`}
                      onClick={() => onToggleAudioKind(option.value)}
                      title={enabled ? `关闭${option.label}预览` : `开启${option.label}预览`}
                      type="button"
                    >
                      <span aria-hidden>{option.label}</span>
                      <small>{count}</small>
                    </button>
                  );
                })}
              </div>
            </div>
            <div
              className="timeline-overview-lane timeline-overview-audio-lane"
              onClick={onOverviewLaneClick}
              ref={audioOverviewLaneRef}
              role="button"
              style={{ minHeight: `${Math.max(56, 18 + audioOverviewRowCount * 20)}px` }}
              tabIndex={0}
            >
              {regionStartFrame !== null && regionEndFrame !== null && (
                <div
                  className="timeline-overview-region"
                  style={{ left: `${overviewRegionLeftPct}%`, width: `${overviewRegionWidthPct}%` }}
                />
              )}
              <div className="timeline-overview-playhead" style={{ left: `${overviewPlayheadPct}%` }} />
              {audioOverviewClips.map((clip) => {
                const isActive =
                  playback.currentFrame >= clip.startFrame &&
                  playback.currentFrame < clip.startFrame + clip.durationFrames;
                const isMuted = mutedTrackIds.includes(clip.track.id);
                const isSolo = soloTrackIds.includes(clip.track.id);
                const isKindEnabled = enabledAudioKinds.includes(clip.track.kind ?? "manual");
                return (
                  <button
                    key={clip.track.id}
                    className={[
                      "timeline-overview-audio-clip",
                      isActive ? "active" : "",
                      isMuted ? "is-muted" : "",
                      isSolo ? "is-solo" : "",
                      !isKindEnabled ? "is-disabled" : ""
                    ].filter(Boolean).join(" ")}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (suppressAudioClipClickRef.current) {
                        suppressAudioClipClickRef.current = false;
                        return;
                      }
                      if (clip.shotId) {
                        selectShot(clip.shotId);
                      }
                      setCurrentFrame(clip.startFrame);
                    }}
                    onMouseDown={(event) => onAudioClipDragStart(event, clip.track.id, clip.startFrame)}
                    style={{
                      left: `${clip.leftPct}%`,
                      width: `${clip.widthPct}%`,
                      top: `${8 + clip.row * 20}px`
                    }}
                    title={`${clip.track.label?.trim() || clip.track.filePath} · ${formatAudioTrackKind(clip.track.kind)}`}
                    type="button"
                  >
                    <span className="timeline-overview-audio-kind">{formatAudioTrackKind(clip.track.kind)}</span>
                    <span className="timeline-overview-audio-label">
                      {clip.track.label?.trim() || clip.track.filePath || "音频"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>
      <section className="export-controls">
      <div className="export-grid">
        <button onClick={() => onPreset("hd1080")} type="button">
          1080p
        </button>
        <button onClick={() => onPreset("hd720")} type="button">
          720p
        </button>
        <button onClick={() => onPreset("vertical1080")} type="button">
          竖屏
        </button>
        <button onClick={onSaveExportDefaults} type="button">
          保存为默认
        </button>
        <label>
          宽度
          <input
            min={320}
            onChange={(event) => setExportWidth(Number(event.target.value))}
            type="number"
            value={exportWidth}
          />
        </label>
        <label>
          高度
          <input
            min={240}
            onChange={(event) => setExportHeight(Number(event.target.value))}
            type="number"
            value={exportHeight}
          />
        </label>
        <label>
          FPS
          <input
            min={1}
            onChange={(event) => setExportFps(Number(event.target.value))}
            type="number"
            value={exportFps}
          />
        </label>
        <label>
          码率（kbps）
          <input
            min={500}
            onChange={(event) => setExportBitrateKbps(Number(event.target.value))}
            type="number"
            value={exportBitrateKbps}
          />
        </label>
        <label>
          自动重试
          <input
            max={5}
            min={0}
            onChange={(event) =>
              setDefaultMaxAutoRetries(Math.max(0, Math.min(5, Number(event.target.value) || 0)))
            }
            type="number"
            value={defaultMaxAutoRetries}
          />
        </label>
      </div>
      <div className="timeline-meta">导出状态：{exportState}</div>
      <div className="timeline-actions">
        <button
          aria-label="取消当前导出"
          className="timeline-icon-btn"
          disabled={!activeJobId || !cancelController}
          onClick={onCancelExport}
          title="取消当前导出"
          type="button"
        >
          <span aria-hidden>■</span>
        </button>
        <button
          aria-label={queuePaused ? "继续队列" : "暂停队列"}
          className="timeline-icon-btn"
          onClick={onToggleQueuePaused}
          title={queuePaused ? "继续队列" : "暂停队列"}
          type="button"
        >
          <span aria-hidden>{queuePaused ? "▶" : "⏸"}</span>
        </button>
      </div>
      <div className="timeline-lower-toolbar">
        <label className="timeline-snap-toggle">
          <input
            checked={autoExpandPanels}
            onChange={(event) => setAutoExpandPanels(event.target.checked)}
            type="checkbox"
          />
          自动展开底栏
        </label>
        <div className="timeline-actions timeline-panel-actions">
          <button
            className="timeline-icon-btn"
            onClick={onCollapseLowerPanels}
            title="收起底栏"
            type="button"
          >
            <span aria-hidden>▾</span>
          </button>
          <button
            className="timeline-icon-btn"
            onClick={onExpandLowerPanels}
            title="展开底栏"
            type="button"
          >
            <span aria-hidden>▴</span>
          </button>
        </div>
      </div>
      </section>
      <div className="timeline-lower-grid">
      <section className="export-panel export-panel-queue">
        <div className="export-panel-head">
          <h3>导出队列</h3>
          <div className="export-panel-head-actions">
            <span className="export-panel-count">{exportJobs.length}</span>
            <button
              aria-label={isQueuePanelCollapsed ? "展开导出队列" : "收起导出队列"}
              className="export-panel-toggle timeline-icon-btn"
              onClick={() => setIsQueuePanelCollapsed((value) => !value)}
              title={isQueuePanelCollapsed ? "展开导出队列" : "收起导出队列"}
              type="button"
            >
              <span aria-hidden>{isQueuePanelCollapsed ? "▸" : "▾"}</span>
            </button>
          </div>
        </div>
        {isQueuePanelCollapsed ? (
          <button
            className="export-panel-collapsed"
            onClick={() => setIsQueuePanelCollapsed(false)}
            title={queueSummary}
            type="button"
          >
            {queueSummary}
          </button>
        ) : (
          <ul className="export-list">
            {exportJobs.length === 0 && <li className="export-empty">暂无导出任务</li>}
            {exportJobs.map((job) => (
              <li key={job.id}>
                <div>
                  <strong>{formatJobStatus(job.status)}</strong> {job.width}x{job.height} {job.fps}fps
                </div>
                <div>
                  {job.message} · 尝试 {job.attempt}/{job.maxAutoRetries}
                </div>
                <progress max={1} value={job.progress} />
                {job.outputPath && <small>{job.outputPath}</small>}
                <div className="timeline-actions export-item-actions">
                  <button
                    aria-label="查看任务详情"
                    className="timeline-icon-btn"
                    onClick={() => setSelectedJobId(job.id)}
                    title="查看任务详情"
                    type="button"
                  >
                    <span aria-hidden>i</span>
                  </button>
                  {(job.status === "failed" || job.status === "cancelled") && (
                    <button
                      aria-label="重试任务"
                      className="timeline-icon-btn"
                      onClick={() => onRetryJob(job)}
                      title="重试任务"
                      type="button"
                    >
                      <span aria-hidden>↻</span>
                    </button>
                  )}
                  {job.status === "pending" && (
                    <button
                      aria-label="移到队首"
                      className="timeline-icon-btn"
                      onClick={() => onMoveJobToTop(job.id)}
                      title="移到队首"
                      type="button"
                    >
                      <span aria-hidden>↑</span>
                    </button>
                  )}
                  {job.outputPath && (
                    <button
                      aria-label="打开输出目录"
                      className="timeline-icon-btn"
                      onClick={async () => {
                        const { openPathInOS } = await loadExportService();
                        await openPathInOS(job.outputPath ?? "");
                      }}
                      title="打开输出目录"
                      type="button"
                    >
                      <span aria-hidden>↗</span>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="export-panel export-panel-history">
        <div className="export-panel-head">
          <h3>导出历史</h3>
          <div className="export-panel-head-actions">
            <span className="export-panel-count">{filteredLogs.length}</span>
            <button
              aria-label={isHistoryPanelCollapsed ? "展开导出历史" : "收起导出历史"}
              className="export-panel-toggle timeline-icon-btn"
              onClick={() => setIsHistoryPanelCollapsed((value) => !value)}
              title={isHistoryPanelCollapsed ? "展开导出历史" : "收起导出历史"}
              type="button"
            >
              <span aria-hidden>{isHistoryPanelCollapsed ? "▸" : "▾"}</span>
            </button>
          </div>
        </div>
        {isHistoryPanelCollapsed ? (
          <button
            className="export-panel-collapsed"
            onClick={() => setIsHistoryPanelCollapsed(false)}
            title={historySummary}
            type="button"
          >
            {historySummary}
          </button>
        ) : (
          <>
            <div className="timeline-actions export-history-actions">
              <button
                aria-label="刷新导出历史"
                className="timeline-icon-btn"
                onClick={async () => {
                  const { listExportLogs } = await loadExportService();
                  const logs = await listExportLogs(20);
                  setLogEntries(logs);
                }}
                title="刷新导出历史"
                type="button"
              >
                <span aria-hidden>↻</span>
              </button>
              <button
                aria-label="清空导出历史"
                className="btn-danger timeline-icon-btn"
                onClick={async () => {
                  const confirmed = await confirmDialog({
                    title: "清空导出历史",
                    message: "确认清空全部导出历史记录吗？此操作不可撤销。",
                    confirmText: "清空",
                    danger: true
                  });
                  if (!confirmed) return;
                  const { clearExportLogs } = await loadExportService();
                  await clearExportLogs();
                  setLogEntries([]);
                  setExportState("导出历史已清空");
                }}
                title="清空导出历史"
                type="button"
              >
                <span aria-hidden>✕</span>
              </button>
              <select
                aria-label="导出历史筛选"
                onChange={(event) => {
                  setLogFilter(event.target.value as LogFilter);
                  setLogPage(1);
                }}
                title="导出历史筛选"
                value={logFilter}
              >
                <option value="all">全部</option>
                <option value="success">成功</option>
                <option value="failed">失败</option>
              </select>
            </div>
            <ul className="export-list">
              {filteredLogs.length === 0 && <li className="export-empty">暂无导出日志</li>}
              {pagedLogs.map((entry, index) => (
                <li key={`${entry.timestamp}-${index}`}>
                  <div>
                    <strong>{formatLogStatus(entry.status)}</strong> {formatLogKind(entry.kind)}
                  </div>
                  <div>{entry.message}</div>
                  {entry.outputPath && <small>{entry.outputPath}</small>}
                  {entry.outputPath && (
                    <div className="timeline-actions export-item-actions">
                      <button
                        aria-label="打开输出目录"
                        className="timeline-icon-btn"
                        onClick={async () => {
                          const { openPathInOS } = await loadExportService();
                          await openPathInOS(entry.outputPath ?? "");
                        }}
                        title="打开输出目录"
                        type="button"
                      >
                        <span aria-hidden>↗</span>
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {filteredLogs.length > LOG_PAGE_SIZE && (
              <div className="timeline-actions export-pagination">
                <button
                  aria-label="上一页"
                  className="timeline-icon-btn"
                  disabled={safeLogPage <= 1}
                  onClick={() => setLogPage((page) => Math.max(1, page - 1))}
                  title="上一页"
                  type="button"
                >
                  <span aria-hidden>◂</span>
                </button>
                <span className="export-page-indicator">
                  {safeLogPage}/{totalLogPages}
                </span>
                <button
                  aria-label="下一页"
                  className="timeline-icon-btn"
                  disabled={safeLogPage >= totalLogPages}
                  onClick={() => setLogPage((page) => Math.min(totalLogPages, page + 1))}
                  title="下一页"
                  type="button"
                >
                  <span aria-hidden>▸</span>
                </button>
              </div>
            )}
          </>
        )}
      </section>
      {selectedJobId && (
        <section className="export-panel export-panel-details">
          <h3>任务详情</h3>
          {(() => {
            const job = exportJobs.find((item) => item.id === selectedJobId);
            if (!job) return <div>未找到任务</div>;
            return (
              <div className="export-details">
                <div>任务 ID：{job.id}</div>
                <div>状态：{formatJobStatus(job.status)}</div>
                <div>分辨率：{job.width}x{job.height}</div>
                <div>帧率 FPS：{job.fps}</div>
                <div>码率：{job.videoBitrateKbps} kbps</div>
                <div>尝试次数：{job.attempt}/{job.maxAutoRetries}</div>
                <div>信息：{job.message}</div>
                {job.errorDetail && <pre>{job.errorDetail}</pre>}
                <button onClick={() => setSelectedJobId(null)} type="button">
                  关闭
                </button>
              </div>
            );
          })()}
        </section>
      )}
      <section className="export-panel export-panel-markers">
        <div className="export-panel-head">
          <h3>标记</h3>
          <div className="export-panel-head-actions">
            <span className="export-panel-count">{markers.length}</span>
            <button
              aria-label={isMarkersPanelCollapsed ? "展开标记" : "收起标记"}
              className="export-panel-toggle timeline-icon-btn"
              onClick={() => setIsMarkersPanelCollapsed((value) => !value)}
              title={isMarkersPanelCollapsed ? "展开标记" : "收起标记"}
              type="button"
            >
              <span aria-hidden>{isMarkersPanelCollapsed ? "▸" : "▾"}</span>
            </button>
          </div>
        </div>
        {isMarkersPanelCollapsed ? (
          <button
            className="export-panel-collapsed"
            onClick={() => setIsMarkersPanelCollapsed(false)}
            title={markersSummary}
            type="button"
          >
            {markersSummary}
          </button>
        ) : (
          <ul className="export-list">
            {markers.length === 0 && <li className="export-empty">暂无标记</li>}
            {markers.map((marker) => (
              <li key={marker.id}>
                <div>
                  <strong>{marker.label}</strong> · {marker.frame}f
                </div>
                <div className="timeline-actions export-item-actions">
                  <button
                    aria-label="跳转到标记"
                    className="timeline-icon-btn"
                    onClick={() => setCurrentFrame(marker.frame)}
                    title="跳转到标记"
                    type="button"
                  >
                    <span aria-hidden>▶</span>
                  </button>
                  <button
                    aria-label="重命名标记"
                    className="timeline-icon-btn"
                    onClick={() => onRenameMarker(marker.id)}
                    title="重命名标记"
                    type="button"
                  >
                    <span aria-hidden>✎</span>
                  </button>
                  <button
                    aria-label="删除标记"
                    className="btn-danger timeline-icon-btn"
                    onClick={() => onDeleteMarker(marker.id)}
                    title="删除标记"
                    type="button"
                  >
                    <span aria-hidden>✕</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>
      <div className="timeline-zoom-bar">
        <label>
          缩放
          <input
            max={3}
            min={0.5}
            onChange={(event) => setTimelineZoom(Number(event.target.value))}
            step={0.1}
            type="range"
            value={timelineZoom}
          />
        </label>
        <span>{timelineZoom.toFixed(1)}x</span>
        <label className="timeline-snap-toggle">
          <input
            checked={snapEnabled}
            onChange={(event) => setSnapEnabled(event.target.checked)}
            type="checkbox"
          />
          吸附
        </label>
        <button
          aria-label="添加标记"
          className="timeline-icon-btn"
          onClick={onAddMarker}
          title="添加标记"
          type="button"
        >
          <span aria-hidden>＋</span>
        </button>
      </div>
      <div className="timeline-scroll">
        <div className="timeline-ruler" style={{ width: totalTimelineWidth }}>
          {regionStartFrame !== null && regionEndFrame !== null && (
            <div
              className="timeline-region-band"
              style={{
                left: regionBandLeft,
                width: regionBandWidth
              }}
            />
          )}
          {rulerTicks.map((frame) => (
            <div className="timeline-ruler-tick" key={`tick_${frame}`} style={{ left: frame * pixelsPerFrame }}>
              <span>{frame}f</span>
            </div>
          ))}
          <div
            className="timeline-playhead"
            style={{ left: Math.min(totalTimelineWidth, playback.currentFrame * pixelsPerFrame) }}
          />
          {markers.map((marker) => (
            <button
              className="timeline-marker-dot"
              key={marker.id}
              onClick={() => setCurrentFrame(marker.frame)}
              style={{ left: Math.min(totalTimelineWidth, marker.frame * pixelsPerFrame) }}
              title={`${marker.label} @ ${marker.frame}f`}
              type="button"
            />
          ))}
        </div>
        <div className="timeline-track-wrap">
          {regionStartFrame !== null && regionEndFrame !== null && (
            <div
              className="timeline-region-band"
              style={{
                left: regionBandLeft,
                width: regionBandWidth
              }}
            />
          )}
          <div
            className="timeline-playhead"
            style={{ left: Math.min(totalTimelineWidth, playback.currentFrame * pixelsPerFrame) }}
          />
          <div className="timeline-track" style={{ width: totalTimelineWidth }}>
          {shots.map((shot, index) => {
            const startFrame = selectShotStartFrame(useStoryboardStore.getState(), shot.id);
            const strokesCount = shotStrokes[shot.id]?.length ?? 0;
            return (
              <div
                className={shot.id === selectedShotId ? "timeline-shot active" : "timeline-shot"}
                key={shot.id}
                draggable
                ref={(node) => {
                  timelineShotRefs.current[shot.id] = node;
                }}
                onDragEnd={onTimelineDragEnd}
                onDragOver={(event) => event.preventDefault()}
                onDragStart={() => onTimelineDragStart(shot.id)}
                onDrop={() => onTimelineDrop(index)}
                onClick={() => {
                  selectShot(shot.id);
                  setCurrentFrame(startFrame);
                }}
                style={{
                  width: Math.max(120, shot.durationFrames * pixelsPerFrame),
                  flex: "0 0 auto"
                }}
                title={`起始 ${startFrame}f`}
              >
                <div className="timeline-shot-head">
                  <span className="timeline-shot-order">{shot.order}</span>
                  <strong>{shot.title}</strong>
                </div>
                <div className="timeline-shot-meta">
                  <span>{shot.durationFrames} 帧 · {strokesCount} 笔</span>
                  {shot.tags.length > 0 && (
                    <div className="shot-tags">
                      {shot.tags.slice(0, 2).map((tag) => (
                        <span className="shot-chip" key={`${shot.id}_timeline_${tag}`}>{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="timeline-shot-foot">
                  <input
                    aria-label={`${shot.title} 时长`}
                    min={1}
                    onChange={(event) => setShotDuration(shot.id, Number(event.target.value))}
                    type="number"
                    value={shot.durationFrames}
                  />
                  <span>帧</span>
                </div>
                <button
                  className="timeline-resize-handle"
                  onMouseDown={(event) => onTimelineResizeStart(event, shot.id, shot.durationFrames)}
                  title="拖动调整镜头时长"
                  type="button"
              />
            </div>
          );
        })}
          </div>
        </div>
      </div>
    </section>
  );
}
