import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from "react";
import { AssetPanel } from "../modules/asset-manager/AssetPanel";
import { LayerPanel } from "../modules/canvas-engine/LayerPanel";
import { ProjectHealthPanel } from "../modules/editor-shell/ProjectHealthPanel";
import { ShotInspectorPanel } from "../modules/editor-shell/ShotInspectorPanel";
import { ShotListPanel } from "../modules/editor-shell/ShotListPanel";
import { ComfyPipelinePanel } from "../modules/comfy-pipeline/ComfyPipelinePanel";
import {
  createWorkspaceProject,
  deleteWorkspaceProject,
  isDesktopRuntime,
  listWorkspaceProjects,
  loadSnapshotFromDesktop,
  renameWorkspaceProject,
  saveSnapshotToDesktop,
  selectWorkspaceProject,
  type WorkspaceProjectEntry
} from "../modules/persistence/desktopProject";
import {
  beginSessionAndDetectUncleanExit,
  clearAutosaveHistory,
  deleteAutosaveSnapshotById,
  endSession,
  listAutosaveSnapshots,
  loadAutosaveSnapshotById,
  loadAutosaveSnapshot,
  saveAutosaveSnapshot
} from "../modules/persistence/autosave";
import {
  createSnapshotBackup,
  parseSnapshotBackup
} from "../modules/persistence/backupSnapshot";
import { StoryboardPreviewPanel } from "../modules/preview-engine/StoryboardPreviewPanel";
import { TimelinePanel } from "../modules/preview-engine/TimelinePanel";
import { AudioTrackPanel } from "../modules/preview-engine/AudioTrackPanel";
import { AppDialogHost, confirmDialog, promptDialog } from "../modules/ui/dialogStore";
import { AppToastHost, pushToast } from "../modules/ui/toastStore";
import {
  selectShotStartFrame,
  selectFilteredShotsForCurrentSequence,
  useStoryboardStore,
  type StoryboardSnapshot
} from "../modules/storyboard-core/store";

type AuxPanelSection = "shots" | "inspector" | "layers" | "audio" | "assets" | "health" | "pipeline";
type ShortcutItem = {
  keys: string;
  label: string;
  group: "播放" | "导航" | "编辑与保存";
};

const HELP_SHORTCUTS: ShortcutItem[] = [
  { keys: "空格", label: "播放/暂停", group: "播放" },
  { keys: "J / K / L", label: "倒放 / 停止 / 快进", group: "播放" },
  { keys: "Shift + 空格", label: "切换循环 I/O", group: "播放" },
  { keys: "左/右方向键", label: "逐帧", group: "导航" },
  { keys: "Shift + 左/右方向键", label: "每次 10 帧", group: "导航" },
  { keys: "PageUp/PageDown", label: "上一镜头/下一镜头", group: "导航" },
  { keys: "1-7", label: "唤出右侧辅助面板", group: "导航" },
  { keys: "F", label: "切换专注模式", group: "导航" },
  { keys: "N", label: "添加镜头", group: "编辑与保存" },
  { keys: "Cmd/Ctrl + S", label: "保存桌面快照", group: "编辑与保存" }
];

const AUX_PANEL_META: Record<AuxPanelSection, { icon: string; label: string }> = {
  shots: { icon: "镜", label: "镜头列表" },
  inspector: { icon: "检", label: "检查器" },
  layers: { icon: "层", label: "图层" },
  audio: { icon: "音", label: "音频" },
  assets: { icon: "资", label: "资产" },
  health: { icon: "健", label: "健康检查" },
  pipeline: { icon: "AI", label: "生成流水线" }
};

const AUX_PANEL_ORDER: AuxPanelSection[] = [
  "shots",
  "inspector",
  "layers",
  "audio",
  "assets",
  "health",
  "pipeline"
];

const AUX_PANEL_STATE_KEY = "storyboard-pro/aux-panel-state/v1";
const FOCUS_MODE_KEY = "storyboard-pro/focus-mode/v1";
const LAYOUT_DEBUG_KEY = "storyboard-pro/layout-debug/v1";
const MAIN_LAYOUT_KEY = "storyboard-pro/main-layout/v1";
const TIMELINE_SPLIT_KEY = "storyboard-pro/timeline-split/v1";

function snapshotRichnessScore(snapshot: Partial<StoryboardSnapshot> | null): number {
  if (!snapshot) return Number.NEGATIVE_INFINITY;
  const assetScore = (snapshot.assets ?? []).reduce((sum, asset) => {
    if (!asset) return sum;
    return (
      sum +
      ((asset.filePath?.trim() || "").length > 0 ? 2 : 0) +
      ((asset.characterFrontPath?.trim() || "").length > 0 ? 3 : 0) +
      ((asset.characterSidePath?.trim() || "").length > 0 ? 4 : 0) +
      ((asset.characterBackPath?.trim() || "").length > 0 ? 4 : 0) +
      ((asset.skyboxFaces?.front?.trim() || "").length > 0 ? 3 : 0)
    );
  }, 0);
  const shotScore = (snapshot.shots ?? []).reduce((sum, shot) => {
    if (!shot) return sum;
    return (
      sum +
      ((shot.generatedImagePath?.trim() || "").length > 0 ? 5 : 0) +
      ((shot.generatedVideoPath?.trim() || "").length > 0 ? 6 : 0) +
      ((shot.characterRefs?.length ?? 0) > 0 ? 1 : 0) +
      ((shot.sceneRefId?.trim() || "").length > 0 ? 1 : 0)
    );
  }, 0);
  return assetScore * 10 + shotScore;
}

function choosePreferredStartupSnapshot(
  desktopSnapshot: StoryboardSnapshot | null,
  autosaveSnapshot: StoryboardSnapshot | null
): StoryboardSnapshot | null {
  if (!desktopSnapshot) return autosaveSnapshot;
  if (!autosaveSnapshot) return desktopSnapshot;
  if ((desktopSnapshot.project?.id ?? "") !== (autosaveSnapshot.project?.id ?? "")) {
    return desktopSnapshot;
  }
  return snapshotRichnessScore(autosaveSnapshot) >= snapshotRichnessScore(desktopSnapshot)
    ? autosaveSnapshot
    : desktopSnapshot;
}

function loadAuxPanelState(): {
  open: boolean;
  pinned: boolean;
  section: AuxPanelSection;
} {
  if (typeof window === "undefined") {
    return { open: false, pinned: false, section: "pipeline" };
  }
  const raw = localStorage.getItem(AUX_PANEL_STATE_KEY);
  if (!raw) return { open: false, pinned: false, section: "pipeline" };
  try {
    const parsed = JSON.parse(raw) as Partial<{
      open: boolean;
      pinned: boolean;
      section: AuxPanelSection;
    }>;
    const section = AUX_PANEL_ORDER.includes(parsed.section as AuxPanelSection)
      ? (parsed.section as AuxPanelSection)
      : "pipeline";
    const pinned = Boolean(parsed.pinned);
    const open = pinned ? true : Boolean(parsed.open);
    return { open, pinned, section };
  } catch {
    return { open: false, pinned: false, section: "pipeline" };
  }
}

export function App() {
  const project = useStoryboardStore((state) => state.project);
  const sequences = useStoryboardStore((state) => state.sequences);
  const currentSequenceId = useStoryboardStore((state) => state.currentSequenceId);
  const shots = useStoryboardStore((state) => state.shots);
  const layers = useStoryboardStore((state) => state.layers);
  const assets = useStoryboardStore((state) => state.assets);
  const audioTracks = useStoryboardStore((state) => state.audioTracks);
  const selectedShotId = useStoryboardStore((state) => state.selectedShotId);
  const playback = useStoryboardStore((state) => state.playback);
  const activeLayerByShotId = useStoryboardStore((state) => state.activeLayerByShotId);
  const canvasTool = useStoryboardStore((state) => state.canvasTool);
  const exportSettings = useStoryboardStore((state) => state.exportSettings);
  const shotStrokes = useStoryboardStore((state) => state.shotStrokes);
  const shotHistory = useStoryboardStore((state) => state.shotHistory);
  const hydrateFromSnapshot = useStoryboardStore((state) => state.hydrateFromSnapshot);
  const resetForNewProject = useStoryboardStore((state) => state.resetForNewProject);
  const updateProjectSettings = useStoryboardStore((state) => state.updateProjectSettings);
  const togglePlayback = useStoryboardStore((state) => state.togglePlayback);
  const setCurrentFrame = useStoryboardStore((state) => state.setCurrentFrame);
  const addShot = useStoryboardStore((state) => state.addShot);
  const [projectLocation, setProjectLocation] = useState<string>("网页模式");
  const [saveState, setSaveState] = useState<string>("空闲");
  const mountedRef = useRef(false);
  const desktopSyncReadyRef = useRef(false);
  const [workspaceProjects, setWorkspaceProjects] = useState<WorkspaceProjectEntry[]>([]);
  const [activeWorkspacePath, setActiveWorkspacePath] = useState<string>("");
  const [showRecoveryPanel, setShowRecoveryPanel] = useState(false);
  const [showHelpPanel, setShowHelpPanel] = useState(false);
  const [helpShortcutQuery, setHelpShortcutQuery] = useState("");
  const [showOnboardingPanel, setShowOnboardingPanel] = useState(true);
  const [auxPanelOpen, setAuxPanelOpen] = useState(() => loadAuxPanelState().open);
  const [auxPanelSection, setAuxPanelSection] = useState<AuxPanelSection>(() => loadAuxPanelState().section);
  const [auxPanelPinned, setAuxPanelPinned] = useState(() => loadAuxPanelState().pinned);
  const [focusMode, setFocusMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(FOCUS_MODE_KEY) === "1";
  });
  const [layoutDebug, setLayoutDebug] = useState(() => {
    if (!import.meta.env.DEV || typeof window === "undefined") return false;
    return localStorage.getItem(LAYOUT_DEBUG_KEY) === "1";
  });
  const [canvasPriorityLayout, setCanvasPriorityLayout] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem(MAIN_LAYOUT_KEY);
    return saved ? saved === "canvas" : true;
  });
  const [timelineSplitPercent, setTimelineSplitPercent] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(TIMELINE_SPLIT_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return Math.min(55, Math.max(24, parsed));
  });
  const centerColumnRef = useRef<HTMLElement | null>(null);
  const timelineSplitDragRef = useRef<{
    startY: number;
    startPercent: number;
    columnHeight: number;
  } | null>(null);
  const [autosaveVersions, setAutosaveVersions] = useState<
    Array<{ id: string; timestamp: number }>
  >([]);
  const [showAllRecoveryVersions, setShowAllRecoveryVersions] = useState(false);
  const importBackupInputRef = useRef<HTMLInputElement | null>(null);
  const hasGeneratedImage = shots.some((shot) => shot.generatedImagePath?.trim());
  const onboardingSteps = [
    {
      id: "project",
      title: "创建或打开项目",
      done: !!project.name
    },
    {
      id: "sequence",
      title: "至少有一个序列",
      done: sequences.length > 0
    },
    {
      id: "shot",
      title: "添加至少一个镜头",
      done: shots.length > 0
    },
    {
      id: "preview",
      title: "生成首张分镜图",
      done: hasGeneratedImage
    },
    {
      id: "audio",
      title: "可选：添加音轨并预览",
      done: audioTracks.length > 0
    }
  ];
  const onboardingDoneCount = onboardingSteps.filter((step) => step.done).length;
  const onboardingProgress = Math.round((onboardingDoneCount / onboardingSteps.length) * 100);
  const nextOnboardingStep = onboardingSteps.find((step) => !step.done)?.id ?? null;
  const guideAction =
    nextOnboardingStep === "shot"
      ? "add-shot"
      : nextOnboardingStep === "preview"
        ? "open-help"
        : nextOnboardingStep === "audio"
          ? "open-help"
          : "create-project";
  const filteredShortcutGroups = useMemo(() => {
    const query = helpShortcutQuery.trim().toLowerCase();
    const source = query.length === 0
      ? HELP_SHORTCUTS
      : HELP_SHORTCUTS.filter((item) =>
          item.keys.toLowerCase().includes(query) || item.label.toLowerCase().includes(query)
        );
    const groups: Array<{ title: ShortcutItem["group"]; items: ShortcutItem[] }> = [];
    for (const title of ["播放", "导航", "编辑与保存"] as const) {
      const items = source.filter((item) => item.group === title);
      if (items.length > 0) groups.push({ title, items });
    }
    return groups;
  }, [helpShortcutQuery]);
  const recoveryVisibleVersions = useMemo(
    () => (showAllRecoveryVersions ? autosaveVersions : autosaveVersions.slice(0, 10)),
    [autosaveVersions, showAllRecoveryVersions]
  );
  const hiddenRecoveryCount = Math.max(0, autosaveVersions.length - recoveryVisibleVersions.length);
  const effectiveTimelineSplit = timelineSplitPercent ?? (canvasPriorityLayout ? 30 : 40);
  const centerColumnGridRows = `minmax(0, calc(${100 - effectiveTimelineSplit}% - 4px)) 8px minmax(200px, calc(${effectiveTimelineSplit}% - 4px))`;

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (saveState === "空闲") return;
    if (saveState.endsWith("...")) return;

    const level =
      saveState.includes("失败") || saveState.includes("无效")
        ? "error"
        : saveState.includes("跳过")
          ? "warning"
          : saveState.includes("已")
            ? "success"
            : "info";
    pushToast(saveState, level);
  }, [saveState]);

  useEffect(() => {
    const hadUncleanExit = beginSessionAndDetectUncleanExit();
    const versions = listAutosaveSnapshots();
    setAutosaveVersions(versions.map((item) => ({ id: item.id, timestamp: item.timestamp })));

    if (hadUncleanExit && versions.length > 0) {
      setShowRecoveryPanel(true);
    } else {
      const snapshot = loadAutosaveSnapshot();
      if (snapshot) {
        hydrateFromSnapshot(snapshot);
      }
    }

    return () => {
      endSession();
    };
  }, [hydrateFromSnapshot]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;

    const loadWorkspace = async () => {
      const list = await listWorkspaceProjects();
      setWorkspaceProjects(list);
      const current = list.find((item) => item.isCurrent);
      if (current) {
        setActiveWorkspacePath(current.path);
        setProjectLocation(current.path);
        const desktopSnapshot = await loadSnapshotFromDesktop();
        const autosaveSnapshot = loadAutosaveSnapshot();
        const preferredSnapshot = choosePreferredStartupSnapshot(desktopSnapshot, autosaveSnapshot);
        if (preferredSnapshot) {
          hydrateFromSnapshot(preferredSnapshot);
        }
        desktopSyncReadyRef.current = true;
      }
    };

    void loadWorkspace();
  }, [hydrateFromSnapshot]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      saveAutosaveSnapshot({
        project,
        sequences,
        currentSequenceId,
        shots,
        layers,
        assets,
        audioTracks,
        selectedShotId,
        activeLayerByShotId,
        canvasTool,
        exportSettings,
        shotStrokes,
        shotHistory
      }, 30);

      const versions = listAutosaveSnapshots();
      setAutosaveVersions(versions.map((item) => ({ id: item.id, timestamp: item.timestamp })));
    }, 30000);

    return () => window.clearInterval(timerId);
  }, [
    canvasTool,
    exportSettings,
    activeLayerByShotId,
    audioTracks,
    currentSequenceId,
    layers,
    assets,
    project,
    selectedShotId,
    sequences,
    shotHistory,
    shotStrokes,
    shots
  ]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    if (!activeWorkspacePath || !desktopSyncReadyRef.current) return;
    const timerId = window.setTimeout(() => {
      void saveSnapshotToDesktop({
        project,
        sequences,
        currentSequenceId,
        shots,
        layers,
        assets,
        audioTracks,
        selectedShotId,
        activeLayerByShotId,
        canvasTool,
        exportSettings,
        shotStrokes,
        shotHistory
      }).catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timerId);
  }, [
    activeLayerByShotId,
    activeWorkspacePath,
    assets,
    audioTracks,
    canvasTool,
    currentSequenceId,
    exportSettings,
    layers,
    project,
    selectedShotId,
    sequences,
    shotHistory,
    shotStrokes,
    shots
  ]);

  const onSaveDesktop = async () => {
    try {
      setSaveState("保存中...");
      const path = await saveSnapshotToDesktop({
        project,
        sequences,
        currentSequenceId,
        shots,
        layers,
        assets,
        audioTracks,
        selectedShotId,
        activeLayerByShotId,
        canvasTool,
        exportSettings,
        shotStrokes,
        shotHistory
      });

      if (path) {
        setProjectLocation(path);
        setSaveState("已保存");
      } else {
        setSaveState("已跳过（非 Tauri 环境）");
      }
    } catch (error) {
      setSaveState(`保存失败：${String(error)}`);
    }
  };

  const onLoadDesktop = async () => {
    try {
      setSaveState("加载中...");
      const snapshot = await loadSnapshotFromDesktop();
      if (!snapshot) {
        setSaveState("未找到桌面快照");
        return;
      }

      hydrateFromSnapshot(snapshot);
      desktopSyncReadyRef.current = true;
      setSaveState("已加载");
    } catch (error) {
      setSaveState(`加载失败：${String(error)}`);
    }
  };

  const onCreateProject = async () => {
    const rawName = await promptDialog({
      title: "新建项目名称",
      placeholder: "输入项目名称",
      confirmText: "创建"
    });
    if (!rawName) return;
    const name = rawName.trim();
    if (!name) return;

    try {
      resetForNewProject(name);
      const path = await createWorkspaceProject(name);
      if (!path) return;

      setActiveWorkspacePath(path);
      setProjectLocation(path);
      const list = await listWorkspaceProjects();
      setWorkspaceProjects(list);
      const snapshotAfterReset = useStoryboardStore.getState();
      await saveSnapshotToDesktop({
        project: snapshotAfterReset.project,
        sequences: snapshotAfterReset.sequences,
        currentSequenceId: snapshotAfterReset.currentSequenceId,
        shots: snapshotAfterReset.shots,
        layers: snapshotAfterReset.layers,
        assets: snapshotAfterReset.assets,
        audioTracks: snapshotAfterReset.audioTracks,
        selectedShotId: snapshotAfterReset.selectedShotId,
        activeLayerByShotId: snapshotAfterReset.activeLayerByShotId,
        canvasTool: snapshotAfterReset.canvasTool,
        exportSettings: snapshotAfterReset.exportSettings,
        shotStrokes: snapshotAfterReset.shotStrokes,
        shotHistory: snapshotAfterReset.shotHistory
      });
      desktopSyncReadyRef.current = true;
      setSaveState("项目已创建");
    } catch (error) {
      setSaveState(`创建项目失败：${String(error)}`);
    }
  };

  const onChangeProject = async (path: string) => {
    if (!path || path === activeWorkspacePath) return;
    try {
      setSaveState("切换项目中...");
      const selected = await selectWorkspaceProject(path);
      if (!selected) return;
      setActiveWorkspacePath(selected);
      setProjectLocation(selected);

      const snapshot = await loadSnapshotFromDesktop();
      if (snapshot) {
        hydrateFromSnapshot(snapshot);
      }
      desktopSyncReadyRef.current = true;

      const list = await listWorkspaceProjects();
      setWorkspaceProjects(list);
      setSaveState("项目已切换");
    } catch (error) {
      setSaveState(`切换项目失败：${String(error)}`);
    }
  };

  const onOpenProjectPath = async () => {
    const raw = await promptDialog({
      title: "输入已有 .sbproj 路径",
      placeholder: "/path/to/project.sbproj",
      confirmText: "打开"
    });
    if (!raw) return;
    const path = raw.trim();
    if (!path) return;
    await onChangeProject(path);
  };

  const onRenameProject = async () => {
    if (!activeWorkspacePath) return;
    const current = workspaceProjects.find((item) => item.path === activeWorkspacePath);
    const nextName = await promptDialog({
      title: "重命名项目",
      defaultValue: current?.name ?? project.name,
      confirmText: "重命名"
    });
    if (!nextName) return;
    const name = nextName.trim();
    if (!name) return;

    try {
      setSaveState("重命名项目中...");
      const newPath = await renameWorkspaceProject(activeWorkspacePath, name);
      if (!newPath) return;
      setActiveWorkspacePath(newPath);
      setProjectLocation(newPath);
      const list = await listWorkspaceProjects();
      setWorkspaceProjects(list);
      setSaveState("项目已重命名");
    } catch (error) {
      setSaveState(`重命名失败：${String(error)}`);
    }
  };

  const onDeleteProject = async () => {
    if (!activeWorkspacePath) return;
    const current = workspaceProjects.find((item) => item.path === activeWorkspacePath);
    const confirmed = await confirmDialog({
      title: "删除项目",
      message: `确认删除项目“${current?.name ?? activeWorkspacePath}”？此操作不可撤销。`,
      confirmText: "删除",
      danger: true
    });
    if (!confirmed) return;

    try {
      setSaveState("删除项目中...");
      const list = await deleteWorkspaceProject(activeWorkspacePath);
      setWorkspaceProjects(list);
      const selected = list.find((item) => item.isCurrent) ?? list[0];
      if (selected) {
        setActiveWorkspacePath(selected.path);
        setProjectLocation(selected.path);
        const snapshot = await loadSnapshotFromDesktop();
        if (snapshot) {
          hydrateFromSnapshot(snapshot);
        }
        desktopSyncReadyRef.current = true;
      } else {
        setActiveWorkspacePath("");
        desktopSyncReadyRef.current = false;
      }
      setSaveState("项目已删除");
    } catch (error) {
      setSaveState(`删除失败：${String(error)}`);
    }
  };

  const onEditProjectSettings = async () => {
    const nameInput = await promptDialog({
      title: "项目名称",
      defaultValue: project.name
    });
    if (!nameInput) return;
    const fpsInput = await promptDialog({
      title: "帧率 FPS",
      defaultValue: String(project.fps)
    });
    if (!fpsInput) return;
    const widthInput = await promptDialog({
      title: "宽度",
      defaultValue: String(project.width)
    });
    if (!widthInput) return;
    const heightInput = await promptDialog({
      title: "高度",
      defaultValue: String(project.height)
    });
    if (!heightInput) return;

    const fps = Number(fpsInput);
    const width = Number(widthInput);
    const height = Number(heightInput);
    if (!Number.isFinite(fps) || !Number.isFinite(width) || !Number.isFinite(height)) {
      setSaveState("项目设置无效");
      return;
    }

    updateProjectSettings({
      name: nameInput.trim(),
      fps,
      width,
      height
    });
    setSaveState("项目设置已更新");
  };

  const restoreAutosaveVersion = (id: string) => {
    const snapshot = loadAutosaveSnapshotById(id);
    if (!snapshot) {
      setSaveState("恢复失败：未找到该版本");
      return;
    }
    hydrateFromSnapshot(snapshot);
    setShowRecoveryPanel(false);
    setSaveState("已从自动保存恢复");
  };

  const removeAutosaveVersion = async (id: string) => {
    const confirmed = await confirmDialog({
      title: "删除快照",
      message: "确认删除这个自动保存快照？",
      confirmText: "删除",
      danger: true
    });
    if (!confirmed) return;

    deleteAutosaveSnapshotById(id);
    const versions = listAutosaveSnapshots();
    setAutosaveVersions(versions.map((item) => ({ id: item.id, timestamp: item.timestamp })));
    if (versions.length === 0) setShowRecoveryPanel(false);
    setSaveState("已删除快照");
  };

  const clearAllAutosaveVersions = async () => {
    const confirmed = await confirmDialog({
      title: "清空自动快照",
      message: "确认清空全部自动保存快照？该操作不可撤销。",
      confirmText: "清空",
      danger: true
    });
    if (!confirmed) return;

    clearAutosaveHistory();
    setAutosaveVersions([]);
    setShowRecoveryPanel(false);
    setSaveState("已清空全部快照");
  };

  const onExportBackup = () => {
    try {
      const snapshot = {
        project,
        sequences,
        currentSequenceId,
        shots,
        layers,
        assets,
        audioTracks,
        selectedShotId,
        activeLayerByShotId,
        canvasTool,
        exportSettings,
        shotStrokes,
        shotHistory
      };
      const backup = createSnapshotBackup(snapshot);
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json"
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const safeName = project.name.replace(/[^a-z0-9-_]+/gi, "_");
      anchor.href = url;
      anchor.download = `${safeName || "storyboard"}-backup.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setSaveState("备份已导出");
    } catch (error) {
      setSaveState(`备份导出失败：${String(error)}`);
    }
  };

  const onImportBackupClick = () => {
    importBackupInputRef.current?.click();
  };

  const onImportBackupFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const snapshot = parseSnapshotBackup(text);
      hydrateFromSnapshot(snapshot);
      setSaveState("备份已导入");
    } catch (error) {
      setSaveState(`备份导入失败：${String(error)}`);
    }
  };

  const toggleAuxPanel = (section: AuxPanelSection) => {
    setAuxPanelSection(section);
    setAuxPanelOpen((previous) => {
      if (auxPanelPinned) return true;
      return auxPanelSection === section ? !previous : true;
    });
  };

  useEffect(() => {
    const hidden = localStorage.getItem("storyboard-pro/onboarding-hidden") === "1";
    if (hidden) setShowOnboardingPanel(false);
  }, []);

  useEffect(() => {
    localStorage.setItem(
      AUX_PANEL_STATE_KEY,
      JSON.stringify({
        open: auxPanelOpen,
        pinned: auxPanelPinned,
        section: auxPanelSection
      })
    );
  }, [auxPanelOpen, auxPanelPinned, auxPanelSection]);

  useEffect(() => {
    localStorage.setItem(FOCUS_MODE_KEY, focusMode ? "1" : "0");
  }, [focusMode]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    localStorage.setItem(LAYOUT_DEBUG_KEY, layoutDebug ? "1" : "0");
  }, [layoutDebug]);

  useEffect(() => {
    localStorage.setItem(MAIN_LAYOUT_KEY, canvasPriorityLayout ? "canvas" : "balanced");
  }, [canvasPriorityLayout]);

  useEffect(() => {
    if (timelineSplitPercent === null) return;
    localStorage.setItem(TIMELINE_SPLIT_KEY, String(timelineSplitPercent));
  }, [timelineSplitPercent]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const state = timelineSplitDragRef.current;
      if (!state) return;
      const deltaY = event.clientY - state.startY;
      const deltaPercent = (deltaY / Math.max(1, state.columnHeight)) * 100;
      const next = Math.min(55, Math.max(24, state.startPercent + deltaPercent));
      setTimelineSplitPercent(next);
    };

    const onMouseUp = () => {
      timelineSplitDragRef.current = null;
      document.body.classList.remove("is-resizing-timeline");
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

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

      if (
        event.code === "Space" &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        togglePlayback();
        return;
      }

      if (event.code === "ArrowRight" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        setCurrentFrame(playback.currentFrame + step);
        return;
      }

      if (event.code === "ArrowLeft" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        setCurrentFrame(Math.max(0, playback.currentFrame - step));
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        const isEditable = !!target && (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable
        );
        if (!isEditable) {
          const digit = Number(event.key);
          if (Number.isInteger(digit) && digit >= 1 && digit <= 7) {
            event.preventDefault();
            const section = AUX_PANEL_ORDER[digit - 1];
            setAuxPanelSection(section);
            setAuxPanelOpen(true);
            return;
          }
        }
      }

      if ((event.key === "f" || event.key === "F") && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setFocusMode((previous) => !previous);
        return;
      }

      if ((event.key === "n" || event.key === "N") && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        addShot();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        void onSaveDesktop();
        return;
      }

      if (event.code === "PageUp" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        const state = useStoryboardStore.getState();
        const scopedShots = selectFilteredShotsForCurrentSequence(state);
        if (scopedShots.length === 0) return;
        const currentFrame = state.playback.currentFrame;
        let index = 0;
        let cursor = 0;
        for (let i = 0; i < scopedShots.length; i += 1) {
          const end = cursor + scopedShots[i].durationFrames;
          if (currentFrame < end) {
            index = i;
            break;
          }
          cursor = end;
          index = i;
        }
        const prevIndex = Math.max(0, index - 1);
        const target = selectShotStartFrame(state, scopedShots[prevIndex].id);
        setCurrentFrame(target);
        return;
      }

      if (event.code === "PageDown" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        const state = useStoryboardStore.getState();
        const scopedShots = selectFilteredShotsForCurrentSequence(state);
        if (scopedShots.length === 0) return;
        const currentFrame = state.playback.currentFrame;
        let index = scopedShots.length - 1;
        let cursor = 0;
        for (let i = 0; i < scopedShots.length; i += 1) {
          const end = cursor + scopedShots[i].durationFrames;
          if (currentFrame < end) {
            index = i;
            break;
          }
          cursor = end;
        }
        const nextIndex = Math.min(scopedShots.length - 1, index + 1);
        const target = selectShotStartFrame(state, scopedShots[nextIndex].id);
        setCurrentFrame(target);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addShot, onSaveDesktop, playback.currentFrame, setCurrentFrame, togglePlayback]);

  const onTimelineSplitMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    const column = centerColumnRef.current;
    if (!column) return;
    const rect = column.getBoundingClientRect();
    timelineSplitDragRef.current = {
      startY: event.clientY,
      startPercent: effectiveTimelineSplit,
      columnHeight: rect.height
    };
    document.body.classList.add("is-resizing-timeline");
  };

  return (
    <div
      className={`app-shell ${focusMode ? "focus-mode" : ""} ${layoutDebug ? "layout-debug" : ""} ${
        canvasPriorityLayout ? "canvas-priority" : "balanced-layout"
      }`}
    >
      {showRecoveryPanel && (
        <section className="recovery-panel-backdrop">
          <section className="panel recovery-panel">
            <header className="panel-header">
              <h2>检测到可恢复快照</h2>
              <button onClick={() => setShowRecoveryPanel(false)} type="button">关闭</button>
            </header>
            <p>检测到上次异常退出，请选择要恢复的快照。</p>
            <div className="timeline-actions">
              <button
                onClick={() => {
                  const latest = autosaveVersions[0];
                  if (latest) restoreAutosaveVersion(latest.id);
                }}
                type="button"
              >
                恢复最新
              </button>
              <button className="btn-danger" onClick={() => void clearAllAutosaveVersions()} type="button">
                清空全部快照
              </button>
              {hiddenRecoveryCount > 0 && !showAllRecoveryVersions && (
                <button onClick={() => setShowAllRecoveryVersions(true)} type="button">
                  展开更多（+{hiddenRecoveryCount}）
                </button>
              )}
              {showAllRecoveryVersions && autosaveVersions.length > 10 && (
                <button onClick={() => setShowAllRecoveryVersions(false)} type="button">
                  收起到前 10 条
                </button>
              )}
            </div>
            <ul className="recovery-list">
              {recoveryVisibleVersions.map((item) => (
                <li key={item.id}>
                  <span>{new Date(item.timestamp).toLocaleString()}</span>
                  <div className="recovery-item-actions">
                    <button onClick={() => restoreAutosaveVersion(item.id)} type="button">
                      恢复
                    </button>
                    <button className="btn-danger" onClick={() => void removeAutosaveVersion(item.id)} type="button">
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </section>
      )}
      <header className="topbar">
        <div className="topbar-title" data-path={projectLocation}>
          <div className="topbar-title-head">
            <h1>{project.name}</h1>
            <button
              className="path-chip"
              title={projectLocation}
              type="button"
            >
              路径
            </button>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="toolbar-group toolbar-project">
            <button
              className={`btn-primary ${guideAction === "create-project" ? "guide-focus" : ""}`}
              onClick={onCreateProject}
              type="button"
            >
              新建
              {guideAction === "create-project" && <span className="guide-badge">下一步</span>}
            </button>
            <button className="optional-action" onClick={onOpenProjectPath} type="button">打开</button>
            <select
              onChange={(event) => onChangeProject(event.target.value)}
              value={activeWorkspacePath}
            >
              <option value="">当前项目</option>
              {workspaceProjects.map((item) => (
                <option key={item.path} value={item.path}>
                  {item.name}
                </option>
              ))}
            </select>
            <button className="optional-action" onClick={onRenameProject} type="button">重命名</button>
            <button className="btn-danger" onClick={onDeleteProject} type="button">删除</button>
          </div>
          <div className="toolbar-group toolbar-backup">
            <button className="btn-primary" onClick={onSaveDesktop} type="button">保存</button>
            <button className="optional-action" onClick={onLoadDesktop} type="button">加载</button>
            <button className="optional-action" onClick={onExportBackup} type="button">导出备份</button>
            <button className="optional-action" onClick={onImportBackupClick} type="button">导入备份</button>
          </div>
          <div className="toolbar-group toolbar-utility">
            <button className="optional-action" onClick={onEditProjectSettings} type="button">设置</button>
            <button
              className={`btn-ghost ${focusMode ? "toggle-on" : ""}`}
              onClick={() => setFocusMode((previous) => !previous)}
              type="button"
            >
              {focusMode ? "退出专注" : "专注模式"}
            </button>
            <button
              className={`btn-ghost ${canvasPriorityLayout ? "toggle-on" : ""}`}
              onClick={() => setCanvasPriorityLayout((previous) => !previous)}
              type="button"
            >
              {canvasPriorityLayout ? "预览优先" : "标准布局"}
            </button>
            {import.meta.env.DEV && (
              <button
                className={`btn-ghost ${layoutDebug ? "toggle-on" : ""}`}
                onClick={() => setLayoutDebug((previous) => !previous)}
                type="button"
              >
                布局线
              </button>
            )}
            <button
              className={`btn-ghost ${guideAction === "open-help" ? "guide-focus" : ""}`}
              onClick={() => setShowHelpPanel(true)}
              type="button"
            >
              帮助
              {guideAction === "open-help" && <span className="guide-badge">下一步</span>}
            </button>
          </div>
          <div className="status-strip">
            <span>{saveState}</span>
            <span className="shortcut-hint">空格 / ←→ / Shift+←→ / PgUp/PgDn / 1-7 / F / N / Cmd(Ctrl)+S</span>
          </div>
        </div>
      </header>
      {showOnboardingPanel && (
        <section className="panel onboarding-panel">
          <header className="panel-header">
            <h2>开始引导</h2>
            <button
              onClick={() => {
                setShowOnboardingPanel(false);
                localStorage.setItem("storyboard-pro/onboarding-hidden", "1");
              }}
              type="button"
            >
              隐藏
            </button>
          </header>
          <div className="onboarding-meta">
            <strong>完成度 {onboardingProgress}%</strong>
            <progress max={100} value={onboardingProgress} />
          </div>
          <ol className="onboarding-list">
            {onboardingSteps.map((step) => (
              <li
                className={
                  step.done ? "done" : nextOnboardingStep === step.id ? "active" : ""
                }
                key={step.id}
              >
                <span>{step.done ? "已完成" : "待完成"}</span>
                <span>{step.title}</span>
              </li>
            ))}
          </ol>
          <div className="timeline-actions">
            <button
              className={`btn-primary ${guideAction === "create-project" ? "guide-focus" : ""}`}
              onClick={onCreateProject}
              type="button"
            >
              1. 新建项目
            </button>
            <button
              className={`btn-primary ${guideAction === "add-shot" ? "guide-focus" : ""}`}
              onClick={addShot}
              type="button"
            >
              2. 添加镜头
            </button>
            <button
              className={`btn-ghost ${guideAction === "open-help" ? "guide-focus" : ""}`}
              onClick={() => setShowHelpPanel(true)}
              type="button"
            >
              3. 查看操作说明
            </button>
          </div>
        </section>
      )}
      <input
        accept=".json,application/json"
        hidden
        onChange={(event) => void onImportBackupFile(event)}
        ref={importBackupInputRef}
        type="file"
      />
      {showHelpPanel && (
        <section className="help-panel-backdrop">
          <div className="panel help-panel">
            <header className="panel-header">
              <h2>操作指南</h2>
              <button onClick={() => setShowHelpPanel(false)} type="button">关闭</button>
            </header>
            <p>推荐顺序</p>
            <ol>
              <li>在左侧镜头列表里先选序列，再添加镜头。</li>
              <li>在右侧 AI 生成流水线导入分镜脚本并生成图片/视频。</li>
              <li>在时间轴中预览、调时长、导出 MP4/PDF。</li>
              <li>使用导出/导入备份进行项目备份。</li>
            </ol>
            <p>快捷键</p>
            <input
              className="help-shortcut-search"
              onChange={(event) => setHelpShortcutQuery(event.target.value)}
              placeholder="搜索快捷键，例如：空格 / 保存 / PageUp"
              type="text"
              value={helpShortcutQuery}
            />
            <div className="help-shortcut-groups">
              {filteredShortcutGroups.length === 0 && (
                <div className="help-shortcut-empty">未匹配到快捷键</div>
              )}
              {filteredShortcutGroups.map((group) => (
                <section className="help-shortcut-group" key={group.title}>
                  <h3>{group.title}</h3>
                  <ul>
                    {group.items.map((item) => (
                      <li className="help-shortcut-row" key={`${group.title}_${item.keys}`}>
                        <kbd>{item.keys}</kbd>
                        <span>{item.label}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </section>
      )}
      <main className={`editor-layout single-screen ${auxPanelOpen ? "aux-open" : ""}`}>
        <section
          className="center-column main-focus"
          ref={centerColumnRef}
          style={{ gridTemplateRows: centerColumnGridRows }}
        >
          <StoryboardPreviewPanel />
          <div
            className="timeline-splitter"
            onMouseDown={onTimelineSplitMouseDown}
            role="separator"
            aria-label="调整预览与时间轴高度"
            aria-orientation="horizontal"
          />
          <TimelinePanel />
        </section>
        <aside className="panel aux-quickbar">
          {AUX_PANEL_ORDER.map((section, index) => (
            <button
              className={`aux-quick-btn ${auxPanelOpen && auxPanelSection === section ? "toggle-on" : ""}`}
              data-tip={`${index + 1} ${AUX_PANEL_META[section].label}`}
              key={section}
              onClick={() => toggleAuxPanel(section)}
              title={AUX_PANEL_META[section].label}
              type="button"
            >
              <span className="aux-quick-icon-wrap">
                <span className="aux-quick-icon">{AUX_PANEL_META[section].icon}</span>
                <span className="aux-quick-hotkey">{index + 1}</span>
              </span>
              <span className="aux-quick-label">{AUX_PANEL_META[section].label}</span>
            </button>
          ))}
        </aside>
        <aside className={`panel aux-drawer ${auxPanelOpen ? "open" : ""}`} aria-hidden={!auxPanelOpen}>
            <header className="panel-header aux-drawer-header">
              <div className="aux-drawer-title">
                <h2>{AUX_PANEL_META[auxPanelSection].label}</h2>
                <small>快捷键 {AUX_PANEL_ORDER.indexOf(auxPanelSection) + 1} 切换</small>
              </div>
              <div className="aux-drawer-actions">
                <button
                  className={`btn-ghost ${auxPanelPinned ? "toggle-on" : ""}`}
                  onClick={() => {
                    setAuxPanelPinned((previous) => {
                      const next = !previous;
                      if (next) setAuxPanelOpen(true);
                      return next;
                    });
                  }}
                  type="button"
                >
                  {auxPanelPinned ? "已固定" : "固定"}
                </button>
                <button
                  className="btn-ghost"
                  onClick={() => {
                    setAuxPanelPinned(false);
                    setAuxPanelOpen(false);
                  }}
                  type="button"
                >
                  收起
                </button>
              </div>
            </header>
            <div className="aux-drawer-body">
              {auxPanelSection === "shots" && <ShotListPanel />}
              {auxPanelSection === "inspector" && <ShotInspectorPanel />}
              {auxPanelSection === "layers" && <LayerPanel />}
              {auxPanelSection === "audio" && <AudioTrackPanel />}
              {auxPanelSection === "assets" && <AssetPanel />}
              {auxPanelSection === "health" && <ProjectHealthPanel />}
              <div hidden={auxPanelSection !== "pipeline"}>
                <ComfyPipelinePanel />
              </div>
            </div>
          </aside>
      </main>
      {focusMode && (
        <button
          className="focus-exit-fab btn-ghost"
          onClick={() => setFocusMode(false)}
          type="button"
        >
          退出专注
        </button>
      )}
      <AppToastHost />
      <AppDialogHost />
    </div>
  );
}
