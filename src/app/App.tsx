import { startTransition, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from "react";
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
  beginDesktopSnapshotSyncTransition,
  blockDesktopSnapshotSync,
  canManuallySaveDesktopSnapshot,
  completeDesktopSnapshotLoad,
  completeDesktopSnapshotSave,
  createDesktopSnapshotSaveCoordinator,
  choosePreferredDesktopSnapshot,
  createDesktopSnapshotSyncState,
  disableDesktopSnapshotSync,
  markDesktopSnapshotSynced,
  markDesktopSnapshotUnsynced,
  restoreDesktopSnapshotSyncState,
  shouldScheduleDesktopSnapshotSave,
  type DesktopSnapshotSaveCoordinator,
  type DesktopSnapshotSyncState
} from "../modules/persistence/desktopSnapshotSync";
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
import { SpatialStageWorkbench } from "../modules/spatial-stage/SpatialStageWorkbench";
import { AudioTrackPanel } from "../modules/preview-engine/AudioTrackPanel";
import { AppDialogHost, confirmDialog, promptDialog } from "../modules/ui/dialogStore";
import { AppToastHost, pushToast } from "../modules/ui/toastStore";
import {
  safeStorageGetItem,
  safeStorageSetItem
} from "../modules/platform/safeStorage";
import {
  createStoryboardSnapshot,
  selectShotStartFrame,
  selectFilteredShotsForCurrentSequence,
  useStoryboardStore,
  type StoryboardSnapshot
} from "../modules/storyboard-core/store";
import {
  canCommitConfirmedStageChange,
  createScriptTransitionPersistenceFingerprint,
  shouldConfirmScriptStageExit,
  shouldClearScriptTransitionDirtyAfterSave,
  shouldMarkRecoveredScriptDirty,
  shouldReplaceImportedScript
} from "./scriptTransitionSaveGuard";
import { LazyAuxPanelContent, preloadAuxPanel } from "./LazyAuxPanelContent";
import { WorkbenchShell } from "../app-shell/WorkbenchShell";
import type { DirectorPrimaryAction } from "../app-shell/DirectorTopBar";
import { buildDirectorCommands } from "../app-shell/directorDeskCommands";
import { readLastWorkbenchStage, writeLastWorkbenchStage } from "../app-shell/directorDeskState";
import { WORKBENCH_STAGES, type WorkbenchStage } from "../app-shell/workbenchRoutes";
import { ProjectWorkspaceView } from "../features/project/ProjectWorkspaceView";
import { ScriptDirectorView } from "../features/script-director/ScriptDirectorView";
import { ScriptTransitionInspector } from "../features/script-director/ScriptTransitionInspector";
import type { NormalizedShotScript } from "../features/script-director/shotScriptImport";
import { AssetWorkspaceView } from "../features/assets/AssetWorkspaceView";
import { PreviewWorkspaceView } from "../features/spatial-preview/PreviewWorkspaceView";
import { StoryboardWorkspaceView } from "../features/storyboard/StoryboardWorkspaceView";
import { ProductionWorkspaceView } from "../features/production/ProductionWorkspaceView";
import { AdvancedPipelinePanel, AdvancedToolsView, preloadAdvancedPipeline } from "../features/advanced-tools/AdvancedToolsView";
import type { SpatialScene } from "../domains/spatial-scene/types";
import { DirectedNodeflowWorkspace } from "../features/nodeflow/DirectedNodeflowWorkspace";

type AuxPanelSection = "shots" | "inspector" | "layers" | "audio" | "assets" | "health" | "pipeline";
type WorkspaceMode = "storyboard" | "spatial_stage";
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

function readCurrentStoryboardSnapshot(): StoryboardSnapshot {
  return createStoryboardSnapshot(useStoryboardStore.getState());
}

type ScriptDeleteFingerprintState = Pick<
  ReturnType<typeof useStoryboardStore.getState>,
  "shots" | "shotTransitions"
>;

export function createScriptDeleteFingerprint(
  state: ScriptDeleteFingerprintState,
  sequenceId: string,
  shotId: string
): string | null {
  const orderedShotIds = state.shots
    .filter((shot) => shot.sequenceId === sequenceId)
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((shot) => shot.id);
  if (!orderedShotIds.includes(shotId)) return null;
  const affectedTransitions = state.shotTransitions
    .filter((item) => (
      item.sequenceId === sequenceId &&
      (item.fromShotId === shotId || item.toShotId === shotId)
    ))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ sequenceId, shotId, orderedShotIds, affectedTransitions });
}

function loadAuxPanelState(): {
  open: boolean;
  pinned: boolean;
  section: AuxPanelSection;
} {
  if (typeof window === "undefined") {
    return { open: false, pinned: false, section: "pipeline" };
  }
  const raw = safeStorageGetItem(AUX_PANEL_STATE_KEY);
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
  const shotTransitions = useStoryboardStore((state) => state.shotTransitions);
  const layers = useStoryboardStore((state) => state.layers);
  const assets = useStoryboardStore((state) => state.assets);
  const audioTracks = useStoryboardStore((state) => state.audioTracks);
  const selectedShotId = useStoryboardStore((state) => state.selectedShotId);
  const selectedShotIds = useStoryboardStore((state) => state.selectedShotIds);
  const selectedShotTransitionId = useStoryboardStore((state) => state.selectedShotTransitionId);
  const playback = useStoryboardStore((state) => state.playback);
  const activeLayerByShotId = useStoryboardStore((state) => state.activeLayerByShotId);
  const canvasTool = useStoryboardStore((state) => state.canvasTool);
  const exportSettings = useStoryboardStore((state) => state.exportSettings);
  const shotStrokes = useStoryboardStore((state) => state.shotStrokes);
  const shotHistory = useStoryboardStore((state) => state.shotHistory);
  const generationTasks = useStoryboardStore((state) => state.generationTasks);
  const schemaVersion = useStoryboardStore((state) => state.schemaVersion);
  const migrationBackupPending = useStoryboardStore((state) => state.migrationBackupPending);
  const migrationBackupSource = useStoryboardStore((state) => state.migrationBackupSource);
  const directorPlan = useStoryboardStore((state) => state.directorPlan);
  const spatialScenes = useStoryboardStore((state) => state.spatialScenes);
  const selectedSpatialObjectId = useStoryboardStore((state) => state.selectedSpatialObjectId);
  const spatialObjects = useStoryboardStore((state) => state.spatialObjects);
  const poseKeyframes = useStoryboardStore((state) => state.poseKeyframes);
  const cameraPlans = useStoryboardStore((state) => state.cameraPlans);
  const spatialStages = useStoryboardStore((state) => state.spatialStages);
  const hydrateFromSnapshot = useStoryboardStore((state) => state.hydrateFromSnapshot);
  const resetForNewProject = useStoryboardStore((state) => state.resetForNewProject);
  const updateProjectSettings = useStoryboardStore((state) => state.updateProjectSettings);
  const togglePlayback = useStoryboardStore((state) => state.togglePlayback);
  const setCurrentFrame = useStoryboardStore((state) => state.setCurrentFrame);
  const addShot = useStoryboardStore((state) => state.addShot);
  const selectShot = useStoryboardStore((state) => state.selectShot);
  const selectShotTransition = useStoryboardStore((state) => state.selectShotTransition);
  const updateShotTransition = useStoryboardStore((state) => state.updateShotTransition);
  const replaceShotScriptForCurrentSequence = useStoryboardStore((state) => state.replaceShotScriptForCurrentSequence);
  const moveShotToIndex = useStoryboardStore((state) => state.moveShotToIndex);
  const deleteShot = useStoryboardStore((state) => state.deleteShot);
  const undoShotSequenceEdit = useStoryboardStore((state) => state.undoShotSequenceEdit);
  const redoShotSequenceEdit = useStoryboardStore((state) => state.redoShotSequenceEdit);
  const shotSequenceHistory = useStoryboardStore((state) => state.shotSequenceHistory);
  const updateSpatialScene = useStoryboardStore((state) => state.updateSpatialScene);
  const setSelectedSpatialObject = useStoryboardStore((state) => state.setSelectedSpatialObject);
  const [projectLocation, setProjectLocation] = useState<string>("网页模式");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("storyboard");
  const [nodeflowMode, setNodeflowMode] = useState(false);
  const [advancedToolsOpen, setAdvancedToolsOpen] = useState(false);
  const [workbenchStage, setWorkbenchStage] = useState<WorkbenchStage>(readLastWorkbenchStage);
  const [saveState, setSaveState] = useState<string>("空闲");
  const [scriptTransitionDirty, setScriptTransitionDirty] = useState(false);
  const scriptRevisionRef = useRef(0);
  const scriptTransitionDirtyRef = useRef(false);
  const stageChangeRequestRef = useRef(0);
  const setScriptTransitionDirtyValue = (dirty: boolean) => {
    scriptTransitionDirtyRef.current = dirty;
    setScriptTransitionDirty(dirty);
  };
  const markScriptTransitionDirty = () => {
    scriptRevisionRef.current += 1;
    setScriptTransitionDirtyValue(true);
  };
  const resetScriptTransitionTracking = () => {
    scriptRevisionRef.current += 1;
    setScriptTransitionDirtyValue(false);
  };
  const restoreScriptTransitionTracking = (dirty: boolean) => {
    scriptRevisionRef.current += 1;
    setScriptTransitionDirtyValue(dirty);
  };

  useEffect(() => {
    writeLastWorkbenchStage(workbenchStage);
  }, [workbenchStage]);
  const mountedRef = useRef(false);
  const desktopSyncStateRef = useRef<DesktopSnapshotSyncState>(
    createDesktopSnapshotSyncState()
  );
  const desktopSaveCoordinatorRef = useRef<DesktopSnapshotSaveCoordinator<StoryboardSnapshot> | null>(null);
  if (!desktopSaveCoordinatorRef.current) {
    desktopSaveCoordinatorRef.current = createDesktopSnapshotSaveCoordinator(saveSnapshotToDesktop);
    desktopSaveCoordinatorRef.current.activateWorkspace(
      desktopSyncStateRef.current.workspacePath,
      desktopSyncStateRef.current.workspaceToken
    );
  }
  const desktopSaveCoordinator = desktopSaveCoordinatorRef.current;
  const setDesktopSyncState = (nextState: DesktopSnapshotSyncState) => {
    desktopSyncStateRef.current = nextState;
    desktopSaveCoordinator.activateWorkspace(
      nextState.workspacePath,
      nextState.workspaceToken
    );
  };
  const [workspaceProjects, setWorkspaceProjects] = useState<WorkspaceProjectEntry[]>([]);
  const [activeWorkspacePath, setActiveWorkspacePath] = useState<string>("");
  const activeWorkspacePathRef = useRef(activeWorkspacePath);
  activeWorkspacePathRef.current = activeWorkspacePath;
  const [showRecoveryPanel, setShowRecoveryPanel] = useState(false);
  const [showHelpPanel, setShowHelpPanel] = useState(false);
  const [helpShortcutQuery, setHelpShortcutQuery] = useState("");
  const [showOnboardingPanel, setShowOnboardingPanel] = useState(true);
  const [initialAuxPanelState] = useState(loadAuxPanelState);
  const [auxPanelOpen, setAuxPanelOpen] = useState(initialAuxPanelState.open);
  const [auxPanelSection, setAuxPanelSection] = useState<AuxPanelSection>(initialAuxPanelState.section);
  const [auxPanelPinned, setAuxPanelPinned] = useState(initialAuxPanelState.pinned);
  const [pipelinePanelMounted, setPipelinePanelMounted] = useState(
    () => initialAuxPanelState.open && initialAuxPanelState.section === "pipeline"
  );
  const [focusMode, setFocusMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return safeStorageGetItem(FOCUS_MODE_KEY) === "1";
  });
  const [layoutDebug, setLayoutDebug] = useState(() => {
    if (!import.meta.env.DEV || typeof window === "undefined") return false;
    return safeStorageGetItem(LAYOUT_DEBUG_KEY) === "1";
  });
  const [canvasPriorityLayout, setCanvasPriorityLayout] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = safeStorageGetItem(MAIN_LAYOUT_KEY);
    return saved ? saved === "canvas" : true;
  });
  const [timelineSplitPercent, setTimelineSplitPercent] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = safeStorageGetItem(TIMELINE_SPLIT_KEY);
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
  const scriptShots = shots
    .filter((shot) => shot.sequenceId === currentSequenceId)
    .slice()
    .sort((a, b) => a.order - b.order);
  const scriptTransitions = shotTransitions.filter((item) => item.sequenceId === currentSequenceId);
  const selectedScriptTransition = scriptTransitions.find((item) => item.id === selectedShotTransitionId) ?? null;
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
        markScriptTransitionDirty();
        setSaveState("已从自动保存恢复，需保存");
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
        const preferredSnapshot = choosePreferredDesktopSnapshot(desktopSnapshot, autosaveSnapshot);
        if (preferredSnapshot) {
          const desktopFingerprint = desktopSnapshot
            ? createScriptTransitionPersistenceFingerprint(desktopSnapshot)
            : null;
          const recoveredFingerprint = createScriptTransitionPersistenceFingerprint(preferredSnapshot);
          hydrateFromSnapshot(preferredSnapshot);
          if (shouldMarkRecoveredScriptDirty({ recoveredFingerprint, desktopFingerprint })) {
            markScriptTransitionDirty();
            setSaveState("已恢复较新的自动保存，需保存");
          } else {
            resetScriptTransitionTracking();
          }
        }
        setDesktopSyncState(markDesktopSnapshotSynced(
          desktopSyncStateRef.current,
          current.path,
          readCurrentStoryboardSnapshot()
        ));
      }
    };

    void loadWorkspace();
  }, [hydrateFromSnapshot]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      saveAutosaveSnapshot({
        schemaVersion,
        migrationBackupPending,
        migrationBackupSource,
        directorPlan,
        spatialScenes,
        selectedSpatialObjectId,
        spatialObjects,
        poseKeyframes,
        cameraPlans,
        project,
        sequences,
        currentSequenceId,
        shots,
        shotTransitions,
        layers,
        assets,
        audioTracks,
        selectedShotId,
        selectedShotIds,
        selectedShotTransitionId,
        activeLayerByShotId,
        canvasTool,
        exportSettings,
        shotStrokes,
        shotHistory,
        generationTasks,
        spatialStages
      }, 30);

      const versions = listAutosaveSnapshots();
      setAutosaveVersions(versions.map((item) => ({ id: item.id, timestamp: item.timestamp })));
    }, 30000);

    return () => window.clearInterval(timerId);
  }, [
    schemaVersion,
    migrationBackupPending,
    migrationBackupSource,
    directorPlan,
    spatialScenes,
    selectedSpatialObjectId,
    spatialObjects,
    poseKeyframes,
    cameraPlans,
    spatialStages,
    canvasTool,
    exportSettings,
    activeLayerByShotId,
    audioTracks,
    currentSequenceId,
    layers,
    assets,
    project,
    selectedShotId,
    selectedShotIds,
    selectedShotTransitionId,
    sequences,
    generationTasks,
    shotHistory,
    shotStrokes,
    shotTransitions,
    shots
  ]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    const snapshot = readCurrentStoryboardSnapshot();
    if (!shouldScheduleDesktopSnapshotSave({
      state: desktopSyncStateRef.current,
      workspacePath: activeWorkspacePath,
      snapshot
    })) return;
    const scheduledWorkspaceToken = desktopSyncStateRef.current.workspaceToken;
    const timerId = window.setTimeout(() => {
      if (activeWorkspacePathRef.current !== activeWorkspacePath) return;
      const latestSnapshot = readCurrentStoryboardSnapshot();
      if (!shouldScheduleDesktopSnapshotSave({
        state: desktopSyncStateRef.current,
        workspacePath: activeWorkspacePath,
        snapshot: latestSnapshot,
        scheduledWorkspaceToken
      })) return;
      const submittedWorkspaceToken = desktopSyncStateRef.current.workspaceToken;
      void desktopSaveCoordinator.save({
        workspacePath: activeWorkspacePath,
        workspaceToken: submittedWorkspaceToken,
        snapshot: latestSnapshot
      })
        .then((result) => {
          if (
            !result ||
            result.status !== "completed" ||
            !result.savedPath ||
            activeWorkspacePathRef.current !== result.submission.workspacePath ||
            desktopSyncStateRef.current.workspaceToken !== result.submission.workspaceToken
          ) return;
          setDesktopSyncState(completeDesktopSnapshotSave(
            desktopSyncStateRef.current,
            {
              workspacePath: result.submission.workspacePath,
              workspaceToken: result.submission.workspaceToken,
              submittedSnapshot: result.submission.snapshot
            }
          ));
        })
        .catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timerId);
  }, [
    schemaVersion,
    migrationBackupPending,
    migrationBackupSource,
    directorPlan,
    spatialScenes,
    selectedSpatialObjectId,
    spatialObjects,
    poseKeyframes,
    cameraPlans,
    spatialStages,
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
    selectedShotIds,
    selectedShotTransitionId,
    sequences,
    generationTasks,
    shotHistory,
    shotStrokes,
    shotTransitions,
    shots
  ]);

  const onSaveDesktop = async (): Promise<boolean> => {
    const workspacePath = activeWorkspacePathRef.current;
    if (!canManuallySaveDesktopSnapshot(desktopSyncStateRef.current, workspacePath)) {
      setSaveState("保存已阻止：请先完成或重新加载当前项目");
      return false;
    }
    try {
      setSaveState("保存中...");
      const snapshotToSave = readCurrentStoryboardSnapshot();
      const submittedWorkspaceToken = desktopSyncStateRef.current.workspaceToken;
      const result = await desktopSaveCoordinator.save({
        workspacePath,
        workspaceToken: submittedWorkspaceToken,
        snapshot: snapshotToSave
      });
      const path = result.savedPath;

      if (result.status === "cancelled") {
        setSaveState("保存已取消：当前项目已变化");
        return false;
      }
      if (!path) {
        setSaveState("已跳过（非 Tauri 环境）");
        return false;
      }
      if (
        activeWorkspacePathRef.current !== result.submission.workspacePath ||
        desktopSyncStateRef.current.workspaceToken !== result.submission.workspaceToken
      ) {
        setSaveState("已保存；当前项目已变化，未推进同步基线");
        return false;
      }
      setDesktopSyncState(completeDesktopSnapshotSave(
        desktopSyncStateRef.current,
        {
          workspacePath: result.submission.workspacePath,
          workspaceToken: result.submission.workspaceToken,
          submittedSnapshot: result.submission.snapshot
        }
      ));
      setProjectLocation(path);
      setSaveState("已保存");
      return true;
    } catch (error) {
      setSaveState(`保存失败：${String(error)}`);
      return false;
    }
  };

  const onManualSaveDesktop = async (): Promise<boolean> => {
    const revisionAtSaveStart = scriptRevisionRef.current;
    const fingerprintAtSaveStart = createScriptTransitionPersistenceFingerprint(useStoryboardStore.getState());
    const saved = await onSaveDesktop();
    const currentFingerprint = createScriptTransitionPersistenceFingerprint(useStoryboardStore.getState());
    if (shouldClearScriptTransitionDirtyAfterSave({
      saved,
      revisionAtSaveStart,
      currentRevision: scriptRevisionRef.current,
      fingerprintAtSaveStart,
      currentFingerprint
    })) {
      setScriptTransitionDirtyValue(false);
    }
    return saved;
  };

  const onLoadDesktop = async () => {
    const previousSyncState = desktopSyncStateRef.current;
    setDesktopSyncState(beginDesktopSnapshotSyncTransition(previousSyncState));
    try {
      setSaveState("加载中...");
      const snapshot = await loadSnapshotFromDesktop();
      if (!snapshot) {
        setDesktopSyncState(restoreDesktopSnapshotSyncState(
          desktopSyncStateRef.current,
          previousSyncState
        ));
        setSaveState("未找到桌面快照");
        return;
      }

      hydrateFromSnapshot(snapshot);
      resetScriptTransitionTracking();
      setDesktopSyncState(markDesktopSnapshotSynced(
        desktopSyncStateRef.current,
        activeWorkspacePath,
        readCurrentStoryboardSnapshot()
      ));
      setSaveState("已加载");
    } catch (error) {
      setDesktopSyncState(restoreDesktopSnapshotSyncState(
        desktopSyncStateRef.current,
        previousSyncState
      ));
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
    const previousStoreState = useStoryboardStore.getState();
    const previousSyncState = desktopSyncStateRef.current;
    const previousScriptTransitionDirty = scriptTransitionDirtyRef.current;
    let createdPath = "";

    try {
      setDesktopSyncState(beginDesktopSnapshotSyncTransition(previousSyncState));
      resetForNewProject(name);
      resetScriptTransitionTracking();
      const path = await createWorkspaceProject(name);
      if (!path) {
        useStoryboardStore.setState(previousStoreState, true);
        restoreScriptTransitionTracking(previousScriptTransitionDirty);
        setDesktopSyncState(restoreDesktopSnapshotSyncState(
          desktopSyncStateRef.current,
          previousSyncState
        ));
        setSaveState("创建失败：未创建桌面项目");
        return;
      }
      createdPath = path;
      setDesktopSyncState(markDesktopSnapshotUnsynced(
        desktopSyncStateRef.current,
        path
      ));

      setActiveWorkspacePath(path);
      setProjectLocation(path);
      const list = await listWorkspaceProjects();
      setWorkspaceProjects(list);
      const submittedSnapshot = readCurrentStoryboardSnapshot();
      const submittedWorkspaceToken = desktopSyncStateRef.current.workspaceToken;
      const result = await desktopSaveCoordinator.save({
        workspacePath: path,
        workspaceToken: submittedWorkspaceToken,
        snapshot: submittedSnapshot
      });
      if (result.status === "cancelled") {
        setSaveState("项目已创建；当前项目已变化，初始保存已取消");
        return;
      }
      const savedPath = result.savedPath;
      if (!savedPath) throw new Error("Desktop project initial save returned no path");
      if (
        desktopSyncStateRef.current.workspacePath === result.submission.workspacePath &&
        desktopSyncStateRef.current.workspaceToken === result.submission.workspaceToken
      ) {
        setDesktopSyncState(completeDesktopSnapshotSave(
          desktopSyncStateRef.current,
          {
            workspacePath: result.submission.workspacePath,
            workspaceToken: result.submission.workspaceToken,
            submittedSnapshot: result.submission.snapshot
          }
        ));
      }
      setSaveState("项目已创建");
    } catch (error) {
      if (createdPath) {
        if (desktopSyncStateRef.current.workspacePath === createdPath) {
          setDesktopSyncState(markDesktopSnapshotUnsynced(
            desktopSyncStateRef.current,
            createdPath
          ));
        }
      } else {
        useStoryboardStore.setState(previousStoreState, true);
        restoreScriptTransitionTracking(previousScriptTransitionDirty);
        setDesktopSyncState(restoreDesktopSnapshotSyncState(
          desktopSyncStateRef.current,
          previousSyncState
        ));
      }
      setSaveState(`创建项目失败：${String(error)}`);
    }
  };

  const onChangeProject = async (path: string) => {
    if (!path || path === activeWorkspacePath) return;
    const previousSyncState = desktopSyncStateRef.current;
    let selectedPath = "";
    try {
      setDesktopSyncState(beginDesktopSnapshotSyncTransition(previousSyncState));
      setSaveState("切换项目中...");
      const selected = await selectWorkspaceProject(path);
      if (!selected) {
        setDesktopSyncState(restoreDesktopSnapshotSyncState(
          desktopSyncStateRef.current,
          previousSyncState
        ));
        return;
      }
      selectedPath = selected;
      setDesktopSyncState(blockDesktopSnapshotSync(
        desktopSyncStateRef.current,
        selected
      ));
      setActiveWorkspacePath(selected);
      setProjectLocation(selected);

      const snapshot = await loadSnapshotFromDesktop();
      if (!snapshot) {
        setDesktopSyncState(completeDesktopSnapshotLoad(
          desktopSyncStateRef.current,
          selected,
          null
        ));
        setSaveState("项目已切换，但快照未加载；请重试加载");
        return;
      }
      hydrateFromSnapshot(snapshot);
      resetScriptTransitionTracking();
      setDesktopSyncState(completeDesktopSnapshotLoad(
        desktopSyncStateRef.current,
        selected,
        readCurrentStoryboardSnapshot()
      ));

      const list = await listWorkspaceProjects();
      setWorkspaceProjects(list);
      setSaveState("项目已切换");
    } catch (error) {
      if (!selectedPath) {
        setDesktopSyncState(restoreDesktopSnapshotSyncState(
          desktopSyncStateRef.current,
          previousSyncState
        ));
      } else if (
        desktopSyncStateRef.current.workspacePath !== selectedPath ||
        desktopSyncStateRef.current.phase !== "synced"
      ) {
        setDesktopSyncState(blockDesktopSnapshotSync(
          desktopSyncStateRef.current,
          selectedPath
        ));
      }
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
      setDesktopSyncState(markDesktopSnapshotSynced(
        desktopSyncStateRef.current,
        newPath,
        readCurrentStoryboardSnapshot()
      ));
      const list = await listWorkspaceProjects();
      setWorkspaceProjects(list);
      setSaveState("项目已重命名");
    } catch (error) {
      setSaveState(`重命名失败：${String(error)}`);
    }
  };

  const onDeleteProject = async () => {
    if (!activeWorkspacePath) return;
    const previousSyncState = desktopSyncStateRef.current;
    let selectedPath = "";
    const current = workspaceProjects.find((item) => item.path === activeWorkspacePath);
    const confirmed = await confirmDialog({
      title: "删除项目",
      message: `确认删除项目“${current?.name ?? activeWorkspacePath}”？此操作不可撤销。`,
      confirmText: "删除",
      danger: true
    });
    if (!confirmed) return;

    try {
      setDesktopSyncState(beginDesktopSnapshotSyncTransition(previousSyncState));
      setSaveState("删除项目中...");
      const list = await deleteWorkspaceProject(activeWorkspacePath);
      setWorkspaceProjects(list);
      const selected = list.find((item) => item.isCurrent) ?? list[0];
      if (selected) {
        selectedPath = selected.path;
        setDesktopSyncState(blockDesktopSnapshotSync(
          desktopSyncStateRef.current,
          selected.path
        ));
        setActiveWorkspacePath(selected.path);
        setProjectLocation(selected.path);
        const snapshot = await loadSnapshotFromDesktop();
        if (!snapshot) {
          setDesktopSyncState(completeDesktopSnapshotLoad(
            desktopSyncStateRef.current,
            selected.path,
            null
          ));
          setSaveState("项目已删除，但替代项目快照未加载；请重试加载");
          return;
        }
        hydrateFromSnapshot(snapshot);
        resetScriptTransitionTracking();
        setDesktopSyncState(completeDesktopSnapshotLoad(
          desktopSyncStateRef.current,
          selected.path,
          readCurrentStoryboardSnapshot()
        ));
      } else {
        setActiveWorkspacePath("");
        setDesktopSyncState(disableDesktopSnapshotSync(
          desktopSyncStateRef.current
        ));
      }
      setSaveState("项目已删除");
    } catch (error) {
      if (!selectedPath) {
        setDesktopSyncState(restoreDesktopSnapshotSyncState(
          desktopSyncStateRef.current,
          previousSyncState
        ));
      } else if (
        desktopSyncStateRef.current.workspacePath !== selectedPath ||
        desktopSyncStateRef.current.phase !== "synced"
      ) {
        setDesktopSyncState(blockDesktopSnapshotSync(
          desktopSyncStateRef.current,
          selectedPath
        ));
      }
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
    markScriptTransitionDirty();
    setShowRecoveryPanel(false);
    setSaveState("已从自动保存恢复，需保存");
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
      const snapshot = readCurrentStoryboardSnapshot();
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
      resetScriptTransitionTracking();
      setSaveState("备份已导入");
    } catch (error) {
      setSaveState(`备份导入失败：${String(error)}`);
    }
  };

  const selectAuxPanelSection = (section: AuxPanelSection) => {
    void preloadAuxPanel(section);
    if (section === "pipeline") {
      void preloadAdvancedPipeline();
      setPipelinePanelMounted(true);
    }
    startTransition(() => {
      setAuxPanelSection(section);
    });
  };

  const toggleAuxPanel = (section: AuxPanelSection) => {
    selectAuxPanelSection(section);
    setAuxPanelOpen((previous) => {
      if (auxPanelPinned) return true;
      return auxPanelSection === section ? !previous : true;
    });
  };

  useEffect(() => {
    const hidden = safeStorageGetItem("storyboard-pro/onboarding-hidden") === "1";
    if (hidden) setShowOnboardingPanel(false);
  }, []);

  useEffect(() => {
    safeStorageSetItem(
      AUX_PANEL_STATE_KEY,
      JSON.stringify({
        open: auxPanelOpen,
        pinned: auxPanelPinned,
        section: auxPanelSection
      })
    );
  }, [auxPanelOpen, auxPanelPinned, auxPanelSection]);

  useEffect(() => {
    safeStorageSetItem(FOCUS_MODE_KEY, focusMode ? "1" : "0");
  }, [focusMode]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    safeStorageSetItem(LAYOUT_DEBUG_KEY, layoutDebug ? "1" : "0");
  }, [layoutDebug]);

  useEffect(() => {
    safeStorageSetItem(MAIN_LAYOUT_KEY, canvasPriorityLayout ? "canvas" : "balanced");
  }, [canvasPriorityLayout]);

  useEffect(() => {
    if (timelineSplitPercent === null) return;
    safeStorageSetItem(TIMELINE_SPLIT_KEY, String(timelineSplitPercent));
  }, [timelineSplitPercent]);

  useEffect(() => {
    if (!auxPanelOpen) return;
    void preloadAuxPanel(auxPanelSection);
    if (auxPanelSection === "pipeline") {
      void preloadAdvancedPipeline();
      setPipelinePanelMounted(true);
    }
  }, [auxPanelOpen, auxPanelSection]);

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
            selectAuxPanelSection(section);
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
        if (workbenchStage === "script") markScriptTransitionDirty();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        void onManualSaveDesktop();
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
  }, [addShot, onManualSaveDesktop, playback.currentFrame, setCurrentFrame, togglePlayback, workbenchStage]);

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

  const onWorkbenchStageChange = async (nextStage: WorkbenchStage): Promise<boolean> => {
    const requestId = ++stageChangeRequestRef.current;
    let confirmationAccepted = true;
    if (shouldConfirmScriptStageExit({
      currentStage: workbenchStage,
      nextStage,
      dirty: scriptTransitionDirtyRef.current
    })) {
      confirmationAccepted = await confirmDialog({
        title: "未保存转场",
        message: "转场修改尚未保存。仍要离开剧本阶段吗？未保存状态会保留。",
        confirmText: "仍要离开"
      });
    }
    if (!canCommitConfirmedStageChange({
      confirmationAccepted,
      requestId,
      latestRequestId: stageChangeRequestRef.current
    })) return false;
    setNodeflowMode(false);
    setWorkbenchStage(nextStage);
    if (nextStage === "preview") setWorkspaceMode("spatial_stage");
    if (nextStage === "storyboard") setWorkspaceMode("storyboard");
    return true;
  };

  const onImportShotScript = async (value: NormalizedShotScript) => {
    const revisionAtPrompt = scriptRevisionRef.current;
    const dirtyAtPrompt = scriptTransitionDirtyRef.current;
    let confirmationAccepted = true;
    if (scriptTransitionDirtyRef.current) {
      confirmationAccepted = await confirmDialog({
        title: "覆盖未保存剧本",
        message: "当前镜头与转场还有未保存修改。确认用导入文件覆盖吗？",
        confirmText: "覆盖",
        danger: true
      });
    }
    if (!shouldReplaceImportedScript({
      dirty: dirtyAtPrompt,
      confirmationAccepted,
      revisionAtPrompt,
      currentRevision: scriptRevisionRef.current
    })) {
      if (confirmationAccepted && scriptRevisionRef.current !== revisionAtPrompt) {
        setSaveState("剧本已变化，请重新导入");
      }
      return;
    }
    replaceShotScriptForCurrentSequence({ shots: value.shots, transitions: value.transitions });
    markScriptTransitionDirty();
  };
  const onMoveScriptShot = (shotId: string, targetIndex: number) => {
    moveShotToIndex(shotId, targetIndex);
    markScriptTransitionDirty();
  };
  const onUpdateScriptTransition = (
    id: string,
    patch: Parameters<typeof updateShotTransition>[1]
  ) => {
    updateShotTransition(id, patch);
    markScriptTransitionDirty();
  };
  const onDeleteScriptShot = async (shotId: string) => {
    const stateBeforeConfirmation = useStoryboardStore.getState();
    const sequenceIdBeforeConfirmation = stateBeforeConfirmation.currentSequenceId;
    const orderedShotsBeforeConfirmation = stateBeforeConfirmation.shots
      .filter((item) => item.sequenceId === sequenceIdBeforeConfirmation)
      .slice()
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const shot = orderedShotsBeforeConfirmation.find((item) => item.id === shotId);
    const fingerprintBeforeConfirmation = createScriptDeleteFingerprint(
      stateBeforeConfirmation,
      sequenceIdBeforeConfirmation,
      shotId
    );
    if (!shot || !fingerprintBeforeConfirmation) return;
    const shotIndex = orderedShotsBeforeConfirmation.findIndex((item) => item.id === shotId);
    const affected = stateBeforeConfirmation.shotTransitions.filter((item) => (
      item.sequenceId === sequenceIdBeforeConfirmation &&
      (item.fromShotId === shotId || item.toShotId === shotId)
    ));
    const reconnectNotice = shotIndex > 0 && shotIndex < orderedShotsBeforeConfirmation.length - 1
      ? "，并为新的相邻镜头创建默认连续动作转场"
      : "";
    const revisionBeforeConfirmation = scriptRevisionRef.current;
    const confirmed = await confirmDialog({
      title: "删除镜头",
      message: `删除“${shot.title}”将移除 ${affected.length} 条相邻转场${reconnectNotice}。`,
      confirmText: "删除",
      danger: true
    });
    if (!confirmed) return;
    const stateAfterConfirmation = useStoryboardStore.getState();
    const fingerprintAfterConfirmation = createScriptDeleteFingerprint(
      stateAfterConfirmation,
      sequenceIdBeforeConfirmation,
      shotId
    );
    if (
      stateAfterConfirmation.currentSequenceId !== sequenceIdBeforeConfirmation ||
      fingerprintAfterConfirmation !== fingerprintBeforeConfirmation ||
      scriptRevisionRef.current !== revisionBeforeConfirmation
    ) {
      setSaveState("镜头序列已变化，请重新执行删除操作");
      return;
    }
    deleteShot(shotId);
    markScriptTransitionDirty();
  };
  const onUndoScriptSequence = () => {
    undoShotSequenceEdit();
    markScriptTransitionDirty();
  };
  const onRedoScriptSequence = () => {
    redoShotSequenceEdit();
    markScriptTransitionDirty();
  };

  const directorCommands = buildDirectorCommands({
    createProject: onCreateProject,
    openProject: onOpenProjectPath,
    renameProject: onRenameProject,
    deleteProject: onDeleteProject,
    saveProject: onManualSaveDesktop,
    loadProject: onLoadDesktop,
    exportBackup: onExportBackup,
    importBackup: onImportBackupClick,
    openSettings: onEditProjectSettings,
    openHelp: () => setShowHelpPanel(true),
    openNodeflow: () => setNodeflowMode(true),
    openAdvancedTools: () => setAdvancedToolsOpen(true)
  });
  const stagePrimaryAction: DirectorPrimaryAction = {
    project: project.name
      ? { label: "继续到剧本", onInvoke: () => onWorkbenchStageChange("script") }
      : { label: "创建项目", onInvoke: onCreateProject },
    script: scriptTransitionDirty
      ? { label: "保存转场", onInvoke: () => void onManualSaveDesktop() }
      : { label: "继续到资产", onInvoke: () => onWorkbenchStageChange("assets") },
    assets: { label: "进入预演", onInvoke: () => onWorkbenchStageChange("preview") },
    preview: { label: "继续到分镜", onInvoke: () => onWorkbenchStageChange("storyboard") },
    storyboard: { label: "进入成片", onInvoke: () => onWorkbenchStageChange("production") },
    production: { label: "打开成片工具", onInvoke: () => setAdvancedToolsOpen(true) }
  }[workbenchStage];
  const currentStageIndex = WORKBENCH_STAGES.findIndex(({ stage }) => stage === workbenchStage);
  const completedStages = WORKBENCH_STAGES
    .slice(0, Math.max(0, currentStageIndex))
    .map(({ stage }) => stage);
  const attentionStages = nextOnboardingStep ? [workbenchStage] : [];

  const fallbackPreviewScene: SpatialScene = {
    id: "preview-default",
    name: project.name || "预演场景",
    revision: 0,
    objects: [],
    camera: { yaw: 0, pitch: 0, fov: 45 },
    poseKeyframes: []
  };
  const activePreviewScene = spatialScenes[0] ?? fallbackPreviewScene;
  const storyboardLegacyWorkspace = workspaceMode === "spatial_stage" ? <SpatialStageWorkbench /> : <>
    <StoryboardPreviewPanel />
    <div
      className="timeline-splitter"
      onMouseDown={onTimelineSplitMouseDown}
      role="separator"
      aria-label="调整预览与时间轴高度"
      aria-orientation="horizontal"
    />
    <TimelinePanel />
  </>;
  const focusedStageView = (() => {
    switch (workbenchStage) {
      case "project": return <ProjectWorkspaceView projectName={project.name} />;
      case "script": return <ScriptDirectorView
        shots={scriptShots}
        transitions={scriptTransitions}
        fps={project.fps}
        sequenceId={currentSequenceId}
        selectedShotId={selectedShotId}
        selectedTransitionId={selectedShotTransitionId}
        onSelectionChange={({ shotId, transitionId }) => {
          if (shotId !== null) {
            selectShot(shotId);
            selectShotTransition(null);
            return;
          }
          selectShot(null);
          selectShotTransition(transitionId);
        }}
        onMoveShot={onMoveScriptShot}
        onImportScript={onImportShotScript}
        onUndo={onUndoScriptSequence}
        onRedo={onRedoScriptSequence}
        canUndo={shotSequenceHistory.past.length > 0}
        canRedo={shotSequenceHistory.future.length > 0}
      />;
      case "assets": return <AssetWorkspaceView assetCount={assets.length} />;
      case "preview": return <PreviewWorkspaceView scene={activePreviewScene} selection={selectedSpatialObjectId} onSceneChange={updateSpatialScene} onSelectionChange={setSelectedSpatialObject} />;
      case "production": return <ProductionWorkspaceView taskLabel={generationTasks.length ? "处理中" : "等待生成"} />;
      case "storyboard":
      default: return <StoryboardWorkspaceView shotCount={shots.length}>{storyboardLegacyWorkspace}</StoryboardWorkspaceView>;
    }
  })();

  const selectedShot = shots.find((shot) => shot.id === selectedShotId);
  const selectedSpatialObject = spatialObjects.find((object) => object.id === selectedSpatialObjectId);
  const inspectorByStage: Record<WorkbenchStage, JSX.Element> = {
    project: <div className="workbench-object-inspector"><strong>{project.name || "未命名项目"}</strong><small>项目与版本</small></div>,
    script: <ScriptTransitionInspector
      fps={project.fps}
      selectedShot={selectedShot ?? null}
      selectedTransition={selectedScriptTransition}
      fromShot={scriptShots.find((shot) => shot.id === selectedScriptTransition?.fromShotId) ?? null}
      toShot={scriptShots.find((shot) => shot.id === selectedScriptTransition?.toShotId) ?? null}
      onUpdateTransition={onUpdateScriptTransition}
      onRequestDeleteShot={(shotId) => void onDeleteScriptShot(shotId)}
    />,
    assets: <div className="workbench-object-inspector"><strong>{assets.length} 个资产</strong><small>角色、场景与道具</small></div>,
    preview: <div className="workbench-object-inspector"><strong>{selectedSpatialObject?.label ?? "未选择对象"}</strong><small>{selectedSpatialObject ? "空间位置与姿态" : "在画布中选择角色或道具"}</small></div>,
    storyboard: <div className="workbench-object-inspector"><strong>{selectedShot?.title ?? "未选择镜头"}</strong><small>{selectedShot ? project.name : "在时间线中选择镜头"}</small></div>,
    production: <div className="workbench-object-inspector"><strong>{generationTasks.length ? "处理中" : "等待生成"}</strong><small>视频、声音、质量与导出</small></div>
  };
  const workbenchInspector = inspectorByStage[workbenchStage];

  const advancedTools = (
    <div className="workbench-legacy-tools">
      <p>旧版辅助面板</p>
      <div className="workbench-advanced-tool-actions">
        <button
          onClick={() => {
            setAuxPanelOpen(true);
            void preloadAuxPanel(auxPanelSection);
          }}
          type="button"
        >
          打开当前辅助面板
        </button>
        <span>{AUX_PANEL_META[auxPanelSection].label}</span>
      </div>
      <div className="workbench-advanced-panel-host">
        <aside className="panel aux-quickbar workbench-tool-rail" data-advanced-legacy-panel>
          {AUX_PANEL_ORDER.map((section, index) => (
            <button
              className={`aux-quick-btn ${auxPanelOpen && auxPanelSection === section ? "toggle-on" : ""}`}
              data-tip={`${index + 1} ${AUX_PANEL_META[section].label}`}
              key={section}
              onFocus={() => void preloadAuxPanel(section)}
              onMouseEnter={() => void preloadAuxPanel(section)}
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
        <aside className={`panel aux-drawer workbench-inspector ${auxPanelOpen ? "open" : ""}`}>
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
            <LazyAuxPanelContent
              pipelineContent={pipelinePanelMounted ? <AdvancedPipelinePanel hidden={auxPanelSection !== "pipeline"} /> : undefined}
              section={auxPanelSection}
            />
          </div>
        </aside>
      </div>
    </div>
  );

  if (nodeflowMode) {
    return (
      <div className="nodeflow-app-root" data-nodeflow-app-root>
        <DirectedNodeflowWorkspace
          projectName={project.name}
          assets={assets}
          spatialScenes={spatialScenes}
          shots={shots}
          generationTasks={generationTasks}
          onLegacy={() => setNodeflowMode(false)}
          onRunNode={(nodeId) => {
            const nextStage = nodeId === "preview" ? "preview" : nodeId === "storyboard" ? "storyboard" : nodeId === "production" ? "production" : nodeId === "assets" ? "assets" : "script";
            setNodeflowMode(false);
            onWorkbenchStageChange(nextStage);
          }}
        />
        <AppToastHost />
        <AppDialogHost />
      </div>
    );
  }

  return (
    <WorkbenchShell
      advancedTools={<AdvancedToolsView>{advancedTools}</AdvancedToolsView>}
      advancedToolsOpen={advancedToolsOpen}
      attentionStages={attentionStages}
      commands={directorCommands}
      completedStages={completedStages}
      inspector={workbenchInspector}
      onAdvancedToolsOpenChange={setAdvancedToolsOpen}
      onStageChange={onWorkbenchStageChange}
      primaryAction={stagePrimaryAction}
      projectName={project.name || "未命名项目"}
      projectPath={activeWorkspacePath || projectLocation}
      stage={workbenchStage}
      statusSnapshot={{
        saveState,
        engineState: isDesktopRuntime() ? "桌面引擎" : "网页引擎",
        taskState: generationTasks.length > 0 ? "处理中" : "空闲"
      }}
    >
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
      {showOnboardingPanel && workbenchStage === "project" && (
        <section className="panel onboarding-panel">
          <header className="panel-header">
            <h2>开始引导</h2>
            <button
              onClick={() => {
                setShowOnboardingPanel(false);
                safeStorageSetItem("storyboard-pro/onboarding-hidden", "1");
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
      <main className={`editor-layout single-screen workbench-layout ${auxPanelOpen ? "aux-open" : ""}`}>
        <section
          className="center-column main-focus workbench-stage"
          key={workbenchStage}
          ref={centerColumnRef}
          style={{ gridTemplateRows: centerColumnGridRows }}
        >
          {focusedStageView}
        </section>
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
    </WorkbenchShell>
  );
}
