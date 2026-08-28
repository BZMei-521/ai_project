import { create } from "zustand";
import { audioTracks, assets, layers, project, sequences, shots } from "./mockData";
// @ts-ignore Executable store transition is intentionally plain ESM for the security harness.
import { applyCharacterEvidencePatch } from "./characterEvidenceStoreRuntime.mjs";
import { createEmptySceneStage, normalizeSceneStages } from "../spatial-stage/normalizeStage";
import { addStage, deleteStage, patchStage } from "../spatial-stage/stageStoreActions";
import { computeStageSourceDigest } from "../spatial-stage/stageDigest";
import {
  createDefaultShotTransition,
  moveShotInLinearSequence,
  reconcileLinearTransitions,
  removeShotFromLinearSequence
} from "../../features/script-director/shotTransitionModel";
import type { SceneStage } from "../spatial-stage/types";
import type { DirectorPlan } from "../../domains/director/types";
import type { CameraPlan, PoseKeyframe, SpatialObject, SpatialScene } from "../../domains/spatial-scene/types";
import type {
  AudioTrack,
  Asset,
  Project,
  Sequence,
  Shot,
  ShotLayer,
  ShotTransition,
  SkyboxFace,
  SkyboxUpdateEvent,
  StoryboardGenerationTask
} from "./types";

export type ImportedShotScriptItem = {
  id?: string;
  title: string;
  prompt: string;
  negativePrompt?: string;
  videoPrompt?: string;
  videoMode?: "auto" | "single_frame" | "first_last_frame";
  videoStartFramePath?: string;
  videoEndFramePath?: string;
  videoWorkflowProfileId?: Shot["videoWorkflowProfileId"];
  videoQualityTier?: Shot["videoQualityTier"];
  videoAccelerationMode?: Shot["videoAccelerationMode"];
  continuitySegmentId?: string;
  videoBoundaryKind?: Shot["videoBoundaryKind"];
  approvedBoundaryFramePath?: string;
  videoRouteReason?: string;
  videoQualityStatus?: Shot["videoQualityStatus"];
  videoGenerationReceipt?: Shot["videoGenerationReceipt"];
  videoGenerationContractDigest?: string;
  videoProductionEvidence?: Shot["videoProductionEvidence"];
  videoProviderArtifact?: Shot["videoProviderArtifact"];
  runningHubCloud?: Shot["runningHubCloud"];
  skyboxFace?: "auto" | SkyboxFace;
  skyboxFaces?: SkyboxFace[];
  skyboxFaceWeights?: Partial<Record<SkyboxFace, number>>;
  cameraYaw?: number;
  cameraPitch?: number;
  cameraFov?: number;
  durationSec?: number;
  durationFrames?: number;
  seed?: number;
  characterRefs?: string[];
  sceneRefId?: string;
  sourceCharacterNames?: string[];
  sourceSceneName?: string;
  sourceScenePrompt?: string;
  dialogue?: string;
  notes?: string;
  tags?: string[];
  generatedImagePath?: string;
  generatedVideoPath?: string;
};

type PlaybackState = {
  currentFrame: number;
  playing: boolean;
};

export type Point = { x: number; y: number };

export type Stroke = {
  id: string;
  points: Point[];
  color: string;
  size: number;
  layerId?: string;
};

export type GenerationTaskReviewTransitionExpectation = Pick<
  StoryboardGenerationTask,
  "stage" | "status" | "shotId" | "outputPath" | "externalProvider" | "externalJobId"
>;

type CanvasToolState = {
  mode: "draw" | "select" | "erase";
  brushColor: string;
  brushSize: number;
  onionSkinEnabled: boolean;
  onionSkinRange: number;
};

type CanvasHistoryState = {
  past: Stroke[][];
  future: Stroke[][];
};

type ShotSequenceHistoryEntry = {
  sequenceId: string;
  orderedShotIds: string[];
  transitions: ShotTransition[];
};

type ShotSequenceHistoryState = {
  past: ShotSequenceHistoryEntry[];
  future: ShotSequenceHistoryEntry[];
};

const withVideoProductionDefaults = (shot: Shot): Shot => ({
  ...shot,
  videoWorkflowProfileId: shot.videoWorkflowProfileId ?? "auto",
  videoQualityTier: shot.videoQualityTier ?? "production",
  videoAccelerationMode: shot.videoAccelerationMode ?? "standard",
  videoBoundaryKind: shot.videoBoundaryKind ?? "hard_cut",
  videoQualityStatus: shot.videoQualityStatus ?? "pending",
  videoProductionEvidence: normalizeVideoProductionEvidence(shot.videoProductionEvidence, shot.id, shot.sequenceId),
  videoProviderArtifact: shot.videoProviderArtifact,
  runningHubCloud: normalizeRunningHubCloud(shot.runningHubCloud)
});

function normalizeVideoProductionEvidence(
  value: Shot["videoProductionEvidence"],
  shotId: string,
  sequenceId?: string
): Shot["videoProductionEvidence"] {
  if (!value || value.schemaVersion !== 1 || value.shotId !== shotId ||
      (sequenceId !== undefined && value.sequenceId !== undefined && value.sequenceId !== sequenceId) ||
      !["pending", "processing", "ready", "failed"].includes(value.status) ||
      typeof value.sourceVideoPath !== "string" || value.sourceVideoPath.trim().length === 0) return undefined;
  const route = value.routeDecision;
  const validProfiles = new Set(["minimax_h3_t2v", "minimax_h3_i2v", "minimax_h3_flf2v", "minimax_h3_r2v"]);
  if (!route || !["selected", "blocked"].includes(route.status) || typeof route.reason !== "string" ||
      route.reason.trim().length === 0 ||
      (route.status === "selected" && !validProfiles.has(route.profileId)) ||
      (route.status === "blocked" && route.profileId !== undefined && !validProfiles.has(route.profileId))) return undefined;
  const preflight = value.profilePreflight;
  if (!preflight || !validProfiles.has(preflight.profileId) || typeof preflight.available !== "boolean" ||
      !Array.isArray(preflight.missingNodes) || !preflight.missingNodes.every((node) => typeof node === "string") ||
      !Array.isArray(preflight.missingModels) || !preflight.missingModels.every((model) =>
        model && typeof model.kind === "string" && typeof model.name === "string") ||
      !Array.isArray(preflight.warnings) || !preflight.warnings.every((warning) => typeof warning === "string")) return undefined;
  return JSON.parse(JSON.stringify(value)) as Shot["videoProductionEvidence"];
}

function normalizeRunningHubCloud(value: Shot["runningHubCloud"]): Shot["runningHubCloud"] {
  if (!value || typeof value !== "object" || typeof value.status !== "string") return undefined;
  return JSON.parse(JSON.stringify(value)) as Shot["runningHubCloud"];
}

function runningHubArtifactIdentity(value: Shot["runningHubCloud"]): string {
  if (!value) return "";
  const imported = value.importedOutput as Record<string, unknown> | undefined;
  const watermark = value.watermarkReceipt as Record<string, unknown> | undefined;
  return JSON.stringify({
    approval: value.approval?.inputDigest,
    taskId: value.taskId,
    importedTaskId: imported?.taskId,
    importedSource: imported?.sourceSha256,
    importedPath: imported?.importedPath,
    importedApproval: imported?.approvalInputDigest,
    repairedOutput: watermark?.outputPath ?? watermark?.repairedPath,
    repairDigest: watermark?.receiptDigest,
    repairDisposition: watermark?.disposition,
    repairCleanPath: watermark?.cleanPath ?? watermark?.outputPath ?? watermark?.repairedPath,
    repairSource: watermark?.sourceSha256,
    repairApproval: watermark?.approvalInputDigest,
    repairTaskId: watermark?.taskId
  });
}

export type ExportSettings = {
  width: number;
  height: number;
  fps: number;
  videoBitrateKbps: number;
};

type StoryboardState = {
  schemaVersion: 2;
  migrationBackupPending: boolean;
  migrationBackupSource: Record<string, unknown> | null;
  directorPlan: DirectorPlan | null;
  spatialScenes: SpatialScene[];
  selectedSpatialObjectId: string | null;
  spatialObjects: SpatialObject[];
  poseKeyframes: PoseKeyframe[];
  cameraPlans: CameraPlan[];
  project: Project;
  sequences: Sequence[];
  currentSequenceId: string;
  shots: Shot[];
  shotTransitions: ShotTransition[];
  layers: ShotLayer[];
  assets: Asset[];
  audioTracks: AudioTrack[];
  selectedShotId: string;
  selectedShotTransitionId: string | null;
  playback: PlaybackState;
  canvasTool: CanvasToolState;
  exportSettings: ExportSettings;
  shotStrokes: Record<string, Stroke[]>;
  shotHistory: Record<string, CanvasHistoryState>;
  shotSequenceHistory: ShotSequenceHistoryState;
  activeLayerByShotId: Record<string, string>;
  selectedShotIds: string[];
  shotFilterQuery: string;
  shotFilterTag: string;
  generationTasks: StoryboardGenerationTask[];
  spatialStages: SceneStage[];
  completeWorkbenchMigration: () => void;
  selectShot: (shotId: string | null) => void;
  toggleShotSelection: (shotId: string) => void;
  clearShotSelection: () => void;
  selectAllShots: () => void;
  setShotFilterQuery: (query: string) => void;
  setShotFilterTag: (tag: string) => void;
  clearShotFilters: () => void;
  selectSequence: (sequenceId: string) => void;
  addSequence: () => void;
  renameSequence: (sequenceId: string, name: string) => void;
  duplicateSequence: (sequenceId: string) => void;
  deleteSequence: (sequenceId: string) => void;
  moveSequence: (sequenceId: string, direction: "up" | "down") => void;
  moveShot: (shotId: string, direction: "up" | "down") => void;
  moveShotToIndex: (shotId: string, targetIndex: number) => void;
  moveSelectedShots: (direction: "up" | "down") => void;
  undoShotSequenceEdit: () => void;
  redoShotSequenceEdit: () => void;
  addAudioTrack: (filePath: string) => void;
  upsertAudioTrack: (track: AudioTrack) => void;
  updateAudioTrack: (
    trackId: string,
    patch: Partial<Pick<AudioTrack, "startFrame" | "gain" | "filePath" | "kind" | "label">>
  ) => void;
  removeAudioTrack: (trackId: string) => void;
  addAsset: (input: {
    type: Asset["type"];
    name: string;
    filePath: string;
    characterFrontPath?: string;
    characterSidePath?: string;
    characterBackPath?: string;
    characterFaceRefPath?: string;
    characterDetailRefPath?: string;
    characterIdentityPack?: Asset["characterIdentityPack"];
    characterLora?: Asset["characterLora"];
    characterZeroShotEvidence?: Asset["characterZeroShotEvidence"];
    currentZeroContext?: Asset["currentZeroContext"];
    currentLoraContext?: Asset["currentLoraContext"];
    characterConsistencyBaseline?: Asset["characterConsistencyBaseline"];
    characterAnchorModelName?: string;
    voiceProfile?: string;
    skyboxDescription?: string;
    skyboxTags?: string[];
    skyboxFaces?: Partial<Record<SkyboxFace, string>>;
    skyboxUpdateEvents?: SkyboxUpdateEvent[];
  }) => void;
  updateAsset: (
    assetId: string,
    patch: Partial<
      Pick<
        Asset,
        | "name"
        | "filePath"
        | "type"
        | "characterFrontPath"
        | "characterSidePath"
        | "characterBackPath"
        | "characterFaceRefPath"
        | "characterDetailRefPath"
        | "characterIdentityPack"
        | "characterLora"
        | "characterZeroShotEvidence"
        | "currentZeroContext"
        | "currentLoraContext"
        | "characterConsistencyBaseline"
        | "characterAnchorModelName"
        | "voiceProfile"
        | "skyboxDescription"
        | "skyboxTags"
        | "skyboxFaces"
        | "skyboxUpdateEvents"
      >
    >
  ) => void;
  removeAsset: (assetId: string) => void;
  toggleCharacterRefForShot: (shotId: string, characterAssetId: string) => void;
  updateShotFields: (
    shotId: string,
    patch: Partial<
      Pick<
        Shot,
        | "title"
        | "dialogue"
        | "notes"
        | "tags"
        | "storyPrompt"
        | "negativePrompt"
        | "videoPrompt"
        | "videoMode"
        | "videoStartFramePath"
        | "videoEndFramePath"
        | "videoWorkflowProfileId"
        | "videoQualityTier"
        | "videoAccelerationMode"
        | "continuitySegmentId"
        | "videoBoundaryKind"
        | "approvedBoundaryFramePath"
        | "videoRouteReason"
        | "videoQualityStatus"
        | "videoGenerationReceipt"
        | "videoGenerationContractDigest"
        | "videoProductionEvidence"
        | "videoProviderArtifact"
        | "runningHubCloud"
        | "skyboxFace"
        | "skyboxFaces"
        | "skyboxFaceWeights"
        | "cameraYaw"
        | "cameraPitch"
        | "cameraFov"
        | "seed"
        | "characterRefs"
        | "sceneRefId"
        | "sourceCharacterNames"
        | "sourceSceneName"
        | "sourceScenePrompt"
        | "generatedImagePath"
        | "generatedVideoPath"
      >
    >
  ) => void;
  replaceShotsForCurrentSequence: (items: ImportedShotScriptItem[]) => void;
  replaceShotScriptForCurrentSequence: (input: {
    shots: ImportedShotScriptItem[];
    transitions: ShotTransition[];
  }) => void;
  selectShotTransition: (transitionId: string | null) => void;
  updateShotTransition: (
    transitionId: string,
    patch: Partial<
      Pick<
        ShotTransition,
        | "type"
        | "durationSeconds"
        | "frameDependency"
        | "sharedFramePath"
        | "actionContinuity"
        | "characterPosition"
        | "cameraDirection"
        | "notes"
      >
    >
  ) => void;
  batchSetDurationForSelectedShots: (durationFrames: number) => void;
  batchAddTagForSelectedShots: (tag: string) => void;
  batchRemoveTagForSelectedShots: (tag: string) => void;
  updateProjectSettings: (settings: {
    name?: string;
    fps?: number;
    width?: number;
    height?: number;
  }) => void;
  setShotDuration: (shotId: string, durationFrames: number) => void;
  setCurrentFrame: (frame: number) => void;
  setExportSettings: (settings: Partial<ExportSettings>) => void;
  applyExportPreset: (preset: "hd1080" | "hd720" | "vertical1080") => void;
  setBrushColor: (color: string) => void;
  setCanvasMode: (mode: "draw" | "select" | "erase") => void;
  setBrushSize: (size: number) => void;
  setOnionSkinEnabled: (enabled: boolean) => void;
  setOnionSkinRange: (range: number) => void;
  setActiveLayerForShot: (shotId: string, layerId: string) => void;
  repairActiveLayerMap: () => void;
  repairStrokeLayerRefs: () => void;
  addLayerToShot: (shotId: string) => void;
  removeLayerFromShot: (shotId: string, layerId: string) => void;
  moveLayerInShot: (shotId: string, layerId: string, direction: "up" | "down") => void;
  renameLayer: (layerId: string, name: string) => void;
  toggleLayerVisibility: (layerId: string) => void;
  toggleLayerLock: (layerId: string) => void;
  duplicateShot: (shotId: string) => void;
  deleteShot: (shotId: string) => void;
  deleteSelectedShots: () => void;
  addStroke: (shotId: string, stroke: Stroke) => void;
  undoStroke: (shotId: string) => void;
  redoStroke: (shotId: string) => void;
  upsertGenerationTask: (task: StoryboardGenerationTask) => void;
  markGenerationTaskFailed: (
    id: string,
    error: Pick<StoryboardGenerationTask, "errorCode" | "errorMessage" | "bestPreviewPath" | "reviewReasons">
  ) => void;
  markGenerationTaskCancelled: (
    id: string,
    review?: Pick<StoryboardGenerationTask, "bestPreviewPath" | "reviewReasons" | "errorMessage">
  ) => void;
  markGenerationTaskNeedsReview: (
    id: string,
    bestPreviewPath: string,
    reviewReasons: string[],
    expected?: GenerationTaskReviewTransitionExpectation
  ) => void;
  completeGenerationTask: (id: string, outputPath: string) => void;
  acceptGenerationTaskCandidate: (id: string) => void;
  rejectGenerationTaskCandidate: (id: string, reason?: string) => void;
  createSpatialStage: (sceneId: string) => string;
  updateSpatialScene: (scene: SpatialScene) => void;
  setSelectedSpatialObject: (objectId: string | null) => void;
  updateSpatialStage: (id: string, patch: Partial<SceneStage>) => void;
  removeSpatialStage: (id: string) => void;
  hydrateFromSnapshot: (snapshot: LegacyStoryboardSnapshotInput) => void;
  resetForNewProject: (name: string) => void;
  addShot: () => void;
  togglePlayback: () => void;
};

export type StoryboardSnapshot = Pick<
  StoryboardState,
  | "schemaVersion"
  | "migrationBackupPending"
  | "migrationBackupSource"
  | "directorPlan"
  | "spatialScenes"
  | "selectedSpatialObjectId"
  | "spatialObjects"
  | "poseKeyframes"
  | "cameraPlans"
  | "project"
  | "sequences"
  | "currentSequenceId"
  | "shots"
  | "shotTransitions"
  | "selectedShotId"
  | "selectedShotIds"
  | "selectedShotTransitionId"
  | "audioTracks"
  | "assets"
  | "canvasTool"
  | "layers"
  | "activeLayerByShotId"
  | "exportSettings"
  | "shotStrokes"
  | "shotHistory"
  | "generationTasks"
  | "spatialStages"
>;

export type LegacyStoryboardSnapshotInput = Partial<StoryboardSnapshot> & {
  selectedShotIds?: string[];
};

const linearRefs = (shots: Shot[], fps: number) => shots
  .slice()
  .sort((left, right) => left.order - right.order)
  .map((shot) => ({ id: shot.id, durationSeconds: shot.durationFrames / Math.max(1, fps) }));

const reconcileAllLinearTransitions = (
  sequences: Sequence[],
  shots: Shot[],
  fps: number,
  existingTransitions: ShotTransition[]
): ShotTransition[] => {
  const shotsBySequence = new Map<string, Shot[]>();
  const transitionsBySequence = new Map<string, ShotTransition[]>();
  for (const shot of shots) {
    const scoped = shotsBySequence.get(shot.sequenceId) ?? [];
    scoped.push(shot);
    shotsBySequence.set(shot.sequenceId, scoped);
  }
  for (const transition of existingTransitions) {
    const scoped = transitionsBySequence.get(transition.sequenceId) ?? [];
    scoped.push(transition);
    transitionsBySequence.set(transition.sequenceId, scoped);
  }
  return sequences
    .slice()
    .sort((left, right) => left.order - right.order)
    .flatMap((sequence) => reconcileLinearTransitions({
      sequenceId: sequence.id,
      orderedShots: linearRefs(shotsBySequence.get(sequence.id) ?? [], fps),
      existingTransitions: transitionsBySequence.get(sequence.id) ?? []
    }));
};

const EXTERNAL_TRANSITION_ID_PREFIX = "shot-transition-external:";
const SAFE_INTERNAL_ID = /^[A-Za-z0-9_-]{1,80}$/;
const WINDOWS_RESERVED_ID = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

const shotIdentityKey = (sequenceId: string, shotId: string): string =>
  JSON.stringify([sequenceId, shotId]);

const isSafeInternalId = (value: string): boolean =>
  SAFE_INTERNAL_ID.test(value) && !WINDOWS_RESERVED_ID.test(value);

const stableHashWord = (value: string, seed: number): string => {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const stableIdHash = (value: string): string =>
  `${stableHashWord(value, 0x811c9dc5)}${stableHashWord(value, 0x9e3779b9)}`;

const safeIdPrefix = (value: string): string => {
  const prefix = value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return prefix || "id";
};

const canonicalSafeId = (kind: "shot" | "layer", ownerId: string, externalId: string, salt: number): string =>
  `${kind}x_${safeIdPrefix(externalId)}_${stableIdHash(JSON.stringify([kind, ownerId, externalId, salt]))}`;

const allocateSafeId = (
  kind: "shot" | "layer",
  ownerId: string,
  externalId: string,
  usedIds: Set<string>
): string => {
  const usedKeys = new Set([...usedIds].map((id) => id.toLowerCase()));
  if (isSafeInternalId(externalId) && !usedKeys.has(externalId.toLowerCase())) {
    usedIds.add(externalId);
    return externalId;
  }
  let salt = 0;
  let candidate = canonicalSafeId(kind, ownerId, externalId, salt);
  while (usedKeys.has(candidate.toLowerCase())) candidate = canonicalSafeId(kind, ownerId, externalId, ++salt);
  usedIds.add(candidate);
  return candidate;
};

const uniqueId = (candidate: string, usedIds: Set<string>): string => {
  let next = candidate;
  let suffix = 1;
  while (usedIds.has(next)) next = `${candidate}_${suffix++}`;
  usedIds.add(next);
  return next;
};

const canonicalizeIncomingShotIds = (
  sequenceId: string,
  items: ImportedShotScriptItem[],
  existingShots: Shot[]
): { items: ImportedShotScriptItem[]; idMap: Map<string, string> } => {
  const usedIds = new Set(existingShots.filter((shot) => shot.sequenceId !== sequenceId).map((shot) => shot.id));
  const idMap = new Map<string, string>();
  const normalizedItems = items.map((item, index) => {
    const externalId = item.id?.trim() || `shot_${Date.now()}_${index + 1}_${Math.floor(Math.random() * 1000)}`;
    const internalId = allocateSafeId("shot", sequenceId, externalId, usedIds);
    if (!idMap.has(externalId)) idMap.set(externalId, internalId);
    const evidence = normalizeVideoProductionEvidence(item.videoProductionEvidence, externalId, sequenceId);
    if (evidence) {
      evidence.shotId = internalId;
      if (evidence.sequenceId !== undefined) evidence.sequenceId = sequenceId;
    }
    return { ...item, id: internalId, videoProductionEvidence: evidence };
  });
  return { items: normalizedItems, idMap };
};

const normalizeHydratedShotIdentities = (input: {
  shots: Shot[];
  transitions: ShotTransition[];
  currentSequenceId: string;
  selectedShotId: string;
  selectedShotIds: string[];
  layers: ShotLayer[];
  shotStrokes: Record<string, Stroke[]>;
  shotHistory: Record<string, CanvasHistoryState>;
  activeLayerByShotId: Record<string, string>;
  generationTasks: StoryboardGenerationTask[];
}) => {
  const usedShotIds = new Set<string>();
  const remapBySequenceAndId = new Map<string, string>();
  const targetsByLegacyId = new Map<string, Array<{ sequenceId: string; shotId: string }>>();
  const shots = input.shots.map((shot) => {
    const validatedEvidence = normalizeVideoProductionEvidence(
      shot.videoProductionEvidence,
      shot.id,
      shot.sequenceId
    );
    const nextId = allocateSafeId("shot", shot.sequenceId, shot.id, usedShotIds);
    remapBySequenceAndId.set(shotIdentityKey(shot.sequenceId, shot.id), nextId);
    const targets = targetsByLegacyId.get(shot.id) ?? [];
    targets.push({ sequenceId: shot.sequenceId, shotId: nextId });
    targetsByLegacyId.set(shot.id, targets);
    const videoProductionEvidence = validatedEvidence
      ? {
          ...validatedEvidence,
          shotId: nextId,
          ...(validatedEvidence.sequenceId !== undefined ? { sequenceId: shot.sequenceId } : {})
        }
      : undefined;
    return { ...shot, id: nextId, videoProductionEvidence };
  });
  const remapShotId = (sequenceId: string, shotId: string): string =>
    remapBySequenceAndId.get(shotIdentityKey(sequenceId, shotId)) ?? shotId;
  const selectionTarget = (shotId: string): string => {
    const targets = targetsByLegacyId.get(shotId) ?? [];
    return targets.find((target) => target.sequenceId === input.currentSequenceId)?.shotId ?? targets[0]?.shotId ?? shotId;
  };

  const usedLayerIds = new Set<string>();
  const layerRemap = new Map<string, string>();
  const layers: ShotLayer[] = [];
  for (const layer of input.layers) {
    const targets = targetsByLegacyId.get(layer.shotId) ?? [{ sequenceId: "", shotId: layer.shotId }];
    for (const target of targets) {
      const nextLayerId = allocateSafeId("layer", target.shotId, layer.id, usedLayerIds);
      layerRemap.set(shotIdentityKey(target.shotId, layer.id), nextLayerId);
      layers.push({
        ...layer,
        id: nextLayerId,
        shotId: target.shotId,
        bitmapPath: layer.bitmapPath.startsWith("shots/")
          ? `shots/${target.shotId}/${nextLayerId}.png`
          : layer.bitmapPath
      });
    }
  }
  const remapLayerId = (shotId: string, layerId: string | undefined): string | undefined =>
    layerId ? layerRemap.get(shotIdentityKey(shotId, layerId)) ?? layerId : undefined;
  const cloneStrokes = (strokes: Stroke[], shotId: string): Stroke[] => strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => ({ ...point })),
    layerId: remapLayerId(shotId, stroke.layerId)
  }));
  const shotStrokes: Record<string, Stroke[]> = {};
  const shotHistory: Record<string, CanvasHistoryState> = {};
  const activeLayerByShotId: Record<string, string> = {};
  for (const [legacyShotId, targets] of targetsByLegacyId) {
    for (const target of targets) {
      if (input.shotStrokes[legacyShotId]) {
        shotStrokes[target.shotId] = cloneStrokes(input.shotStrokes[legacyShotId], target.shotId);
      }
      const history = input.shotHistory[legacyShotId];
      if (history) {
        shotHistory[target.shotId] = {
          past: history.past.map((entry) => cloneStrokes(entry, target.shotId)),
          future: history.future.map((entry) => cloneStrokes(entry, target.shotId))
        };
      }
      const activeLayerId = input.activeLayerByShotId[legacyShotId];
      if (activeLayerId) activeLayerByShotId[target.shotId] = remapLayerId(target.shotId, activeLayerId) ?? activeLayerId;
    }
  }

  return {
    shots,
    transitions: input.transitions.map((transition) => ({
      ...transition,
      fromShotId: remapShotId(transition.sequenceId, transition.fromShotId),
      toShotId: remapShotId(transition.sequenceId, transition.toShotId)
    })),
    selectedShotId: selectionTarget(input.selectedShotId),
    selectedShotIds: input.selectedShotIds.map(selectionTarget).filter((id, index, ids) => ids.indexOf(id) === index),
    layers,
    shotStrokes,
    shotHistory,
    activeLayerByShotId,
    generationTasks: input.generationTasks.map((task) => ({ ...task, shotId: selectionTarget(task.shotId) }))
  };
};

const withoutShotBoundOutputs = (shot: Shot): Shot => ({
  ...shot,
  videoProductionEvidence: undefined,
  videoGenerationReceipt: undefined,
  videoGenerationContractDigest: undefined,
  videoProviderArtifact: undefined,
  runningHubCloud: undefined,
  approvedBoundaryFramePath: undefined,
  videoRouteReason: undefined,
  generatedImagePath: undefined,
  generatedVideoPath: undefined,
  videoQualityStatus: "pending"
});

const externalTransitionId = (transition: ShotTransition): string =>
  `${EXTERNAL_TRANSITION_ID_PREFIX}${encodeURIComponent(JSON.stringify([
    "external",
    transition.sequenceId,
    transition.id,
    transition.fromShotId,
    transition.toShotId
  ]))}`;

const hasCanonicalExternalTransitionId = (transition: ShotTransition): boolean => {
  if (!transition.id.startsWith(EXTERNAL_TRANSITION_ID_PREFIX)) return false;
  try {
    const tuple = JSON.parse(decodeURIComponent(transition.id.slice(EXTERNAL_TRANSITION_ID_PREFIX.length)));
    return Array.isArray(tuple) &&
      tuple.length === 5 &&
      tuple[0] === "external" &&
      tuple[1] === transition.sequenceId &&
      tuple[3] === transition.fromShotId &&
      tuple[4] === transition.toShotId;
  } catch {
    return false;
  }
};

const normalizeBoundaryTransitionIdentities = (
  transitions: ShotTransition[],
  selectedTransitionId: string | null,
  preserveCurrentDefaults: boolean
): { transitions: ShotTransition[]; selectedTransitionId: string | null } => {
  const selectedMatches = selectedTransitionId
    ? transitions.reduce<number[]>((matches, transition, index) => {
        if (transition.id === selectedTransitionId) matches.push(index);
        return matches;
      }, [])
    : [];
  const normalized = transitions.map((transition) => {
    const isCurrentDefault = preserveCurrentDefaults &&
      transition.id === createDefaultShotTransition(
        transition.sequenceId,
        transition.fromShotId,
        transition.toShotId
      ).id;
    return hasCanonicalExternalTransitionId(transition) || isCurrentDefault
      ? transition
      : { ...transition, id: externalTransitionId(transition) };
  });
  return {
    transitions: normalized,
    selectedTransitionId: selectedMatches.length === 1
      ? normalized[selectedMatches[0]].id
      : null
  };
};

const reconcileTransitionSequences = (
  transitions: ShotTransition[],
  shots: Shot[],
  fps: number,
  sequenceIds: Iterable<string>
): ShotTransition[] => {
  let nextTransitions = transitions;
  for (const sequenceId of new Set(sequenceIds)) {
    const reconciled = reconcileLinearTransitions({
      sequenceId,
      orderedShots: linearRefs(shots.filter((shot) => shot.sequenceId === sequenceId), fps),
      existingTransitions: nextTransitions
    });
    nextTransitions = [
      ...nextTransitions.filter((item) => item.sequenceId !== sequenceId),
      ...reconciled
    ];
  }
  return nextTransitions;
};

const findUniqueTransitionById = (
  transitions: ShotTransition[],
  transitionId: string | null
): ShotTransition | null => {
  if (!transitionId) return null;
  const matches = transitions.filter((item) => item.id === transitionId);
  return matches.length === 1 ? matches[0] : null;
};

const captureShotSequenceHistoryEntry = (
  state: StoryboardState,
  sequenceId: string
): ShotSequenceHistoryEntry => ({
  sequenceId,
  orderedShotIds: state.shots
    .filter((shot) => shot.sequenceId === sequenceId)
    .sort((left, right) => left.order - right.order)
    .map((shot) => shot.id),
  transitions: state.shotTransitions
    .filter((transition) => transition.sequenceId === sequenceId)
    .map((transition) => ({ ...transition }))
});

const buildShotSequenceOrderUpdate = (
  state: StoryboardState,
  sequenceId: string,
  orderedShotIds: string[],
  recordHistory: boolean
): Partial<StoryboardState> => {
  const scoped = state.shots.filter((shot) => shot.sequenceId === sequenceId);
  const shotById = new Map(scoped.map((shot) => [shot.id, shot]));
  const normalizedScoped = orderedShotIds
    .map((shotId) => shotById.get(shotId))
    .filter((shot): shot is Shot => Boolean(shot))
    .map((shot, index) => ({ ...shot, order: index + 1 }));
  const normalizedById = new Map(normalizedScoped.map((shot) => [shot.id, shot]));
  const nextTransitions = reconcileLinearTransitions({
    sequenceId,
    orderedShots: linearRefs(normalizedScoped, state.project.fps),
    existingTransitions: state.shotTransitions
  });
  const shotTransitions = [
    ...state.shotTransitions.filter((item) => item.sequenceId !== sequenceId),
    ...nextTransitions
  ];

  return {
    shots: state.shots.map((shot) => normalizedById.get(shot.id) ?? shot),
    shotTransitions,
    selectedShotTransitionId: shotTransitions.some((item) => item.id === state.selectedShotTransitionId)
      ? state.selectedShotTransitionId
      : null,
    ...(recordHistory
      ? {
          shotSequenceHistory: {
            past: [...state.shotSequenceHistory.past, captureShotSequenceHistoryEntry(state, sequenceId)],
            future: []
          }
        }
      : {})
  };
};

const restoreShotSequenceHistoryEntry = (
  state: StoryboardState,
  entry: ShotSequenceHistoryEntry
): Partial<StoryboardState> => {
  const scoped = state.shots
    .filter((shot) => shot.sequenceId === entry.sequenceId)
    .sort((left, right) => left.order - right.order);
  const currentIds = new Set(scoped.map((shot) => shot.id));
  const restoredIds = entry.orderedShotIds.filter((shotId) => currentIds.has(shotId));
  const restoredIdSet = new Set(restoredIds);
  restoredIds.push(...scoped.filter((shot) => !restoredIdSet.has(shot.id)).map((shot) => shot.id));
  const orderById = new Map(restoredIds.map((shotId, index) => [shotId, index + 1]));
  const restoredScoped = restoredIds
    .map((shotId) => scoped.find((shot) => shot.id === shotId))
    .filter((shot): shot is Shot => Boolean(shot))
    .map((shot, index) => ({ ...shot, order: index + 1 }));
  const nextTransitions = reconcileLinearTransitions({
    sequenceId: entry.sequenceId,
    orderedShots: linearRefs(restoredScoped, state.project.fps),
    existingTransitions: entry.transitions
  });
  const shotTransitions = [
    ...state.shotTransitions.filter((item) => item.sequenceId !== entry.sequenceId),
    ...nextTransitions
  ];
  return {
    shots: state.shots.map((shot) =>
      shot.sequenceId === entry.sequenceId
        ? { ...shot, order: orderById.get(shot.id) ?? shot.order }
        : shot
    ),
    shotTransitions,
    selectedShotTransitionId: shotTransitions.some((item) => item.id === state.selectedShotTransitionId)
      ? state.selectedShotTransitionId
      : null
  };
};

const buildShotReplacement = (
  state: StoryboardState,
  items: ImportedShotScriptItem[],
  importedTransitions?: ShotTransition[]
): Partial<StoryboardState> | null => {
  const sequenceId = state.currentSequenceId || state.sequences[0]?.id;
  if (!sequenceId) return null;
  const filteredItems = items.filter((item) => item.title.trim().length > 0 && item.prompt.trim().length > 0);
  if (filteredItems.length === 0) return null;
  const normalizedIncoming = canonicalizeIncomingShotIds(sequenceId, filteredItems, state.shots);
  const safeItems = normalizedIncoming.items;

  const removedShotIds = new Set(
    state.shots.filter((shot) => shot.sequenceId === sequenceId).map((shot) => shot.id)
  );
  const baseShots = state.shots.filter((shot) => shot.sequenceId !== sequenceId);
  const baseLayers = state.layers.filter((layer) => !removedShotIds.has(layer.shotId));
  const nextShotStrokes: Record<string, Stroke[]> = {};
  const nextShotHistory: Record<string, CanvasHistoryState> = {};
  const nextActiveLayerByShotId: Record<string, string> = {};

  for (const [shotId, strokes] of Object.entries(state.shotStrokes)) {
    if (!removedShotIds.has(shotId)) nextShotStrokes[shotId] = strokes;
  }
  for (const [shotId, history] of Object.entries(state.shotHistory)) {
    if (!removedShotIds.has(shotId)) nextShotHistory[shotId] = history;
  }
  for (const [shotId, layerId] of Object.entries(state.activeLayerByShotId)) {
    if (!removedShotIds.has(shotId)) nextActiveLayerByShotId[shotId] = layerId;
  }

  const nextShots: Shot[] = [];
  const nextLayers: ShotLayer[] = [];
  const usedLayerIds = new Set(baseLayers.map((layer) => layer.id));
  const fps = Math.max(1, state.project.fps);

  safeItems.forEach((item, index) => {
    const shotId = item.id?.trim() || `shot_${Date.now()}_${index + 1}_${Math.floor(Math.random() * 1000)}`;
    const durationFrames = item.durationFrames && Number.isFinite(item.durationFrames)
      ? Math.max(1, Math.round(item.durationFrames))
      : Math.max(1, Math.round((item.durationSec ?? 2) * fps));
    const layerId = allocateSafeId("layer", shotId, `layer_${shotId}_1`, usedLayerIds);

    nextShots.push({
      id: shotId,
      sequenceId,
      order: index + 1,
      title: item.title.trim(),
      durationFrames,
      dialogue: item.dialogue?.trim() ?? "",
      notes: item.notes?.trim() ?? "",
      tags: item.tags?.filter((tag) => tag.trim().length > 0).map((tag) => tag.trim()) ?? [],
      storyPrompt: item.prompt.trim(),
      negativePrompt: item.negativePrompt?.trim() ?? "",
      videoPrompt: item.videoPrompt?.trim() ?? "",
      videoMode: item.videoMode ?? "auto",
      videoStartFramePath: item.videoStartFramePath?.trim() ?? "",
      videoEndFramePath: item.videoEndFramePath?.trim() ?? "",
      videoWorkflowProfileId: item.videoWorkflowProfileId ?? "auto",
      videoQualityTier: item.videoQualityTier ?? "production",
      videoAccelerationMode: item.videoAccelerationMode ?? "standard",
      continuitySegmentId: item.continuitySegmentId,
      videoBoundaryKind: item.videoBoundaryKind ?? "hard_cut",
      approvedBoundaryFramePath: item.approvedBoundaryFramePath,
      videoRouteReason: item.videoRouteReason,
      videoQualityStatus: item.videoQualityStatus ?? "pending",
      videoGenerationReceipt: item.videoGenerationReceipt,
      videoGenerationContractDigest: item.videoGenerationContractDigest,
      videoProductionEvidence: normalizeVideoProductionEvidence(item.videoProductionEvidence, shotId, sequenceId),
      videoProviderArtifact: item.videoProviderArtifact,
      runningHubCloud: normalizeRunningHubCloud(item.runningHubCloud),
      skyboxFace: item.skyboxFace ?? "auto",
      skyboxFaces: (item.skyboxFaces ?? []).filter((face): face is SkyboxFace =>
        face === "front" ||
        face === "right" ||
        face === "back" ||
        face === "left" ||
        face === "up" ||
        face === "down"
      ),
      skyboxFaceWeights: item.skyboxFaceWeights ?? {},
      cameraYaw: typeof item.cameraYaw === "number" && Number.isFinite(item.cameraYaw) ? item.cameraYaw : undefined,
      cameraPitch:
        typeof item.cameraPitch === "number" && Number.isFinite(item.cameraPitch) ? item.cameraPitch : undefined,
      cameraFov: typeof item.cameraFov === "number" && Number.isFinite(item.cameraFov) ? item.cameraFov : undefined,
      seed: item.seed,
      characterRefs: item.characterRefs ?? [],
      sceneRefId: item.sceneRefId ?? "",
      sourceCharacterNames: item.sourceCharacterNames ?? [],
      sourceSceneName: item.sourceSceneName ?? "",
      sourceScenePrompt: item.sourceScenePrompt ?? "",
      generatedImagePath: item.generatedImagePath?.trim() ?? "",
      generatedVideoPath: item.generatedVideoPath?.trim() ?? ""
    });

    nextLayers.push({
      id: layerId,
      shotId,
      name: "图层 1",
      visible: true,
      locked: false,
      zIndex: 1,
      bitmapPath: `shots/${shotId}/${layerId}.png`
    });
    nextActiveLayerByShotId[shotId] = layerId;
    nextShotStrokes[shotId] = [];
    nextShotHistory[shotId] = { past: [], future: [] };
  });

  const remappedImportedTransitions = importedTransitions?.map((transition) => ({
    ...transition,
    sequenceId,
    fromShotId: normalizedIncoming.idMap.get(transition.fromShotId) ?? transition.fromShotId,
    toShotId: normalizedIncoming.idMap.get(transition.toShotId) ?? transition.toShotId
  }));
  const transitionSeed = remappedImportedTransitions === undefined
    ? state.shotTransitions
    : normalizeBoundaryTransitionIdentities(remappedImportedTransitions, null, false).transitions;
  const nextTransitions = reconcileLinearTransitions({
    sequenceId,
    orderedShots: linearRefs(nextShots, fps),
    existingTransitions: transitionSeed
  });
  const shotTransitions = [
    ...state.shotTransitions.filter((item) => item.sequenceId !== sequenceId),
    ...nextTransitions
  ];

  return {
    shots: [...baseShots, ...nextShots],
    shotTransitions,
    layers: [...baseLayers, ...nextLayers],
    shotStrokes: nextShotStrokes,
    shotHistory: nextShotHistory,
    shotSequenceHistory: { past: [], future: [] },
    activeLayerByShotId: nextActiveLayerByShotId,
    selectedShotId: nextShots[0]?.id ?? "",
    selectedShotTransitionId: shotTransitions.some((item) => item.id === state.selectedShotTransitionId)
      ? state.selectedShotTransitionId
      : null,
    selectedShotIds: nextShots[0]?.id ? [nextShots[0].id] : []
  };
};

export function createStoryboardSnapshot(state: StoryboardState): StoryboardSnapshot {
  return {
    schemaVersion: state.schemaVersion,
    migrationBackupPending: state.migrationBackupPending,
    migrationBackupSource: state.migrationBackupSource,
    directorPlan: state.directorPlan,
    spatialScenes: state.spatialScenes,
    selectedSpatialObjectId: state.selectedSpatialObjectId,
    spatialObjects: state.spatialObjects,
    poseKeyframes: state.poseKeyframes,
    cameraPlans: state.cameraPlans,
    project: state.project,
    sequences: state.sequences,
    currentSequenceId: state.currentSequenceId,
    shots: state.shots,
    shotTransitions: state.shotTransitions,
    layers: state.layers,
    assets: state.assets,
    audioTracks: state.audioTracks,
    selectedShotId: state.selectedShotId,
    selectedShotIds: state.selectedShotIds,
    selectedShotTransitionId: state.selectedShotTransitionId,
    activeLayerByShotId: state.activeLayerByShotId,
    canvasTool: state.canvasTool,
    exportSettings: state.exportSettings,
    shotStrokes: state.shotStrokes,
    shotHistory: state.shotHistory,
    generationTasks: state.generationTasks,
    spatialStages: state.spatialStages
  };
}

export const useStoryboardStore = create<StoryboardState>((set, get) => ({
  schemaVersion: 2,
  migrationBackupPending: false,
  migrationBackupSource: null,
  directorPlan: null,
  spatialScenes: [],
  selectedSpatialObjectId: null,
  spatialObjects: [],
  poseKeyframes: [],
  cameraPlans: [],
  project,
  sequences,
  currentSequenceId: sequences[0]?.id ?? "",
  shots,
  shotTransitions: [],
  layers,
  assets,
  audioTracks,
  selectedShotId: shots[0]?.id ?? "",
  selectedShotTransitionId: null,
  playback: { currentFrame: 0, playing: false },
  canvasTool: {
    mode: "draw",
    brushColor: "#0f172a",
    brushSize: 4,
    onionSkinEnabled: false,
    onionSkinRange: 1
  },
  exportSettings: {
    width: project.width,
    height: project.height,
    fps: project.fps,
    videoBitrateKbps: 8000
  },
  shotStrokes: {},
  shotHistory: {},
  shotSequenceHistory: { past: [], future: [] },
  activeLayerByShotId: {},
  selectedShotIds: [],
  shotFilterQuery: "",
  shotFilterTag: "",
  generationTasks: [],
  spatialStages: [],

  completeWorkbenchMigration: () => set({ migrationBackupPending: false, migrationBackupSource: null }),

  selectShot: (shotId) =>
    set((state) => shotId === null
      ? { selectedShotId: "", selectedShotIds: [] }
      : {
          selectedShotId: shotId,
          selectedShotIds: state.selectedShotIds.includes(shotId)
            ? state.selectedShotIds
            : [...state.selectedShotIds, shotId]
        }),

  toggleShotSelection: (shotId) =>
    set((state) => {
      if (state.selectedShotIds.includes(shotId)) {
        return {
          selectedShotIds: state.selectedShotIds.filter((id) => id !== shotId)
        };
      }
      return {
        selectedShotIds: [...state.selectedShotIds, shotId]
      };
    }),

  clearShotSelection: () => set({ selectedShotIds: [] }),

  selectAllShots: () =>
    set((state) => ({
      selectedShotIds: state.shots
        .filter((shot) => shot.sequenceId === state.currentSequenceId)
        .map((shot) => shot.id)
    })),

  setShotFilterQuery: (query) =>
    set({
      shotFilterQuery: query.trimStart()
    }),

  setShotFilterTag: (tag) =>
    set({
      shotFilterTag: tag.trim()
    }),

  clearShotFilters: () =>
    set({
      shotFilterQuery: "",
      shotFilterTag: ""
    }),

  selectSequence: (sequenceId) =>
    set((state) => {
      if (!state.sequences.some((sequence) => sequence.id === sequenceId)) return state;
      const firstShot = state.shots.find((shot) => shot.sequenceId === sequenceId);
      const selectedTransition = findUniqueTransitionById(
        state.shotTransitions,
        state.selectedShotTransitionId
      );
      return {
        currentSequenceId: sequenceId,
        selectedShotId: firstShot?.id ?? "",
        selectedShotTransitionId: selectedTransition?.sequenceId === sequenceId
          ? selectedTransition.id
          : null,
        selectedShotIds: firstShot ? [firstShot.id] : []
      };
    }),

  addSequence: () =>
    set((state) => {
      const nextOrder = state.sequences.length + 1;
      const sequenceId = `seq_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const sequence: Sequence = {
        id: sequenceId,
        projectId: state.project.id,
        name: `Sequence ${String(nextOrder).padStart(2, "0")}`,
        order: nextOrder
      };

      return {
        sequences: [...state.sequences, sequence],
        currentSequenceId: sequenceId,
        selectedShotId: "",
        selectedShotIds: []
      };
    }),

  renameSequence: (sequenceId, name) =>
    set((state) => ({
      sequences: state.sequences.map((sequence) =>
        sequence.id === sequenceId ? { ...sequence, name: name.trim() || sequence.name } : sequence
      )
    })),

  duplicateSequence: (sequenceId) =>
    set((state) => {
      const sourceSequence = state.sequences.find((sequence) => sequence.id === sequenceId);
      if (!sourceSequence) return state;

      const scopedShots = state.shots
        .filter((shot) => shot.sequenceId === sequenceId)
        .sort((a, b) => a.order - b.order);
      const shotIdMap = new Map<string, string>();
      const duplicatedSequenceId = uniqueId(
        `seq_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        new Set(state.sequences.map((sequence) => sequence.id))
      );
      const usedShotIds = new Set(state.shots.map((shot) => shot.id));
      const duplicatedShots: Shot[] = scopedShots.map((shot, index) => {
        const newShotId = allocateSafeId(
          "shot",
          duplicatedSequenceId,
          `shot_${Date.now()}_${index}_${Math.floor(Math.random() * 1000)}`,
          usedShotIds
        );
        shotIdMap.set(shot.id, newShotId);
        return withoutShotBoundOutputs({
          ...shot,
          id: newShotId,
          sequenceId: duplicatedSequenceId
        });
      });

      const layerIdMap = new Map<string, string>();
      const usedLayerIds = new Set(state.layers.map((layer) => layer.id));
      const duplicatedLayers: ShotLayer[] = state.layers
        .filter((layer) => shotIdMap.has(layer.shotId))
        .map((layer, index) => {
          const mappedShotId = shotIdMap.get(layer.shotId) ?? layer.shotId;
          const newLayerId = allocateSafeId(
            "layer",
            mappedShotId,
            `layer_${mappedShotId}_${index + 1}`,
            usedLayerIds
          );
          layerIdMap.set(layer.id, newLayerId);
          return {
            ...layer,
            id: newLayerId,
            shotId: mappedShotId,
            bitmapPath: `shots/${mappedShotId}/${newLayerId}.png`
          };
        });

      const duplicatedShotStrokes: Record<string, Stroke[]> = {};
      const duplicatedShotHistory: Record<string, CanvasHistoryState> = {};
      const duplicatedActiveLayerByShotId: Record<string, string> = {};

      for (const [oldShotId, newShotId] of shotIdMap.entries()) {
        const sourceStrokes = state.shotStrokes[oldShotId] ?? [];
        duplicatedShotStrokes[newShotId] = sourceStrokes.map((stroke, index) => ({
          ...stroke,
          id: `stroke_${newShotId}_${index + 1}`,
          layerId: stroke.layerId ? layerIdMap.get(stroke.layerId) : undefined
        }));

        duplicatedShotHistory[newShotId] = { past: [], future: [] };

        const sourceActiveLayer = state.activeLayerByShotId[oldShotId];
        if (sourceActiveLayer) {
          const mappedLayer = layerIdMap.get(sourceActiveLayer);
          if (mappedLayer) duplicatedActiveLayerByShotId[newShotId] = mappedLayer;
        }
      }

      const insertIndex = state.sequences.findIndex((sequence) => sequence.id === sequenceId);
      const duplicatedSequence: Sequence = {
        ...sourceSequence,
        id: duplicatedSequenceId,
        name: `${sourceSequence.name} Copy`
      };
      const nextSequences = [...state.sequences];
      nextSequences.splice(insertIndex + 1, 0, duplicatedSequence);
      const normalizedSequences = nextSequences.map((sequence, index) => ({
        ...sequence,
        order: index + 1
      }));

      const firstDuplicatedShot = duplicatedShots[0]?.id ?? "";
      const duplicatedTransitions = reconcileLinearTransitions({
        sequenceId: duplicatedSequenceId,
        orderedShots: linearRefs(duplicatedShots, state.project.fps),
        existingTransitions: []
      });

      return {
        sequences: normalizedSequences,
        currentSequenceId: duplicatedSequenceId,
        shots: [...state.shots, ...duplicatedShots],
        shotTransitions: [...state.shotTransitions, ...duplicatedTransitions],
        layers: [...state.layers, ...duplicatedLayers],
        shotStrokes: {
          ...state.shotStrokes,
          ...duplicatedShotStrokes
        },
        shotHistory: {
          ...state.shotHistory,
          ...duplicatedShotHistory
        },
        activeLayerByShotId: {
          ...state.activeLayerByShotId,
          ...duplicatedActiveLayerByShotId
        },
        selectedShotId: firstDuplicatedShot,
        selectedShotTransitionId: null,
        selectedShotIds: firstDuplicatedShot ? [firstDuplicatedShot] : []
      };
    }),

  deleteSequence: (sequenceId) =>
    set((state) => {
      if (state.sequences.length <= 1) return state;
      const removingSequence = state.sequences.find((sequence) => sequence.id === sequenceId);
      if (!removingSequence) return state;

      const removedShotIds = new Set(
        state.shots.filter((shot) => shot.sequenceId === sequenceId).map((shot) => shot.id)
      );
      const nextShots = state.shots.filter((shot) => shot.sequenceId !== sequenceId);
      const nextLayers = state.layers.filter((layer) => !removedShotIds.has(layer.shotId));
      const nextSelectedShotIds = state.selectedShotIds.filter((id) => !removedShotIds.has(id));

      const nextSequences = state.sequences
        .filter((sequence) => sequence.id !== sequenceId)
        .map((sequence, index) => ({
          ...sequence,
          order: index + 1
        }));
      const fallbackSequenceId = nextSequences[0]?.id ?? "";
      const nextCurrentSequenceId =
        state.currentSequenceId === sequenceId ? fallbackSequenceId : state.currentSequenceId;
      const nextFirstShotInCurrent = nextShots.find(
        (shot) => shot.sequenceId === nextCurrentSequenceId
      );

      const nextSelectedShotId = removedShotIds.has(state.selectedShotId)
        ? nextFirstShotInCurrent?.id ?? ""
        : state.selectedShotId;

      const nextShotStrokes: Record<string, Stroke[]> = {};
      for (const [shotId, strokes] of Object.entries(state.shotStrokes)) {
        if (!removedShotIds.has(shotId)) nextShotStrokes[shotId] = strokes;
      }
      const nextShotHistory: Record<string, CanvasHistoryState> = {};
      for (const [shotId, history] of Object.entries(state.shotHistory)) {
        if (!removedShotIds.has(shotId)) nextShotHistory[shotId] = history;
      }
      const nextActiveLayerByShotId: Record<string, string> = {};
      for (const [shotId, layerId] of Object.entries(state.activeLayerByShotId)) {
        if (!removedShotIds.has(shotId)) nextActiveLayerByShotId[shotId] = layerId;
      }
      const shotTransitions = state.shotTransitions.filter((item) => item.sequenceId !== sequenceId);

      return {
        sequences: nextSequences,
        currentSequenceId: nextCurrentSequenceId,
        shots: nextShots,
        shotTransitions,
        layers: nextLayers,
        shotStrokes: nextShotStrokes,
        shotHistory: nextShotHistory,
        activeLayerByShotId: nextActiveLayerByShotId,
        selectedShotId: nextSelectedShotId,
        selectedShotTransitionId: shotTransitions.some((item) => item.id === state.selectedShotTransitionId)
          ? state.selectedShotTransitionId
          : null,
        shotSequenceHistory: {
          past: state.shotSequenceHistory.past.filter((entry) => entry.sequenceId !== sequenceId),
          future: state.shotSequenceHistory.future.filter((entry) => entry.sequenceId !== sequenceId)
        },
        selectedShotIds: nextSelectedShotIds
      };
    }),

  moveSequence: (sequenceId, direction) =>
    set((state) => {
      const sourceIndex = state.sequences.findIndex((sequence) => sequence.id === sequenceId);
      if (sourceIndex < 0) return state;
      const targetIndex = direction === "up" ? sourceIndex - 1 : sourceIndex + 1;
      if (targetIndex < 0 || targetIndex >= state.sequences.length) return state;

      const next = [...state.sequences];
      const [moving] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moving);
      const normalized = next.map((sequence, index) => ({
        ...sequence,
        order: index + 1
      }));
      return {
        sequences: normalized
      };
    }),

  moveShot: (shotId, direction) =>
    set((state) => {
      const sequenceId = state.currentSequenceId;
      const scoped = state.shots
        .filter((shot) => shot.sequenceId === sequenceId)
        .sort((a, b) => a.order - b.order);
      const index = scoped.findIndex((shot) => shot.id === shotId);
      if (index < 0) return state;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= scoped.length) return state;
      const moved = moveShotInLinearSequence({
        sequenceId,
        orderedShots: linearRefs(scoped, state.project.fps),
        transitions: state.shotTransitions,
        shotId,
        targetIndex
      });
      return buildShotSequenceOrderUpdate(
        state,
        sequenceId,
        moved.orderedShots.map((shot) => shot.id),
        true
      );
    }),

  moveShotToIndex: (shotId, targetIndex) =>
    set((state) => {
      const sequenceId = state.currentSequenceId;
      const scoped = state.shots
        .filter((shot) => shot.sequenceId === sequenceId)
        .sort((a, b) => a.order - b.order);
      const sourceIndex = scoped.findIndex((shot) => shot.id === shotId);
      if (sourceIndex < 0) return state;
      const boundedTarget = Math.max(0, Math.min(targetIndex, scoped.length - 1));
      if (sourceIndex === boundedTarget) return state;

      const moved = moveShotInLinearSequence({
        sequenceId,
        orderedShots: linearRefs(scoped, state.project.fps),
        transitions: state.shotTransitions,
        shotId,
        targetIndex: boundedTarget
      });
      return buildShotSequenceOrderUpdate(
        state,
        sequenceId,
        moved.orderedShots.map((shot) => shot.id),
        true
      );
    }),

  moveSelectedShots: (direction) =>
    set((state) => {
      const scoped = state.shots
        .filter((shot) => shot.sequenceId === state.currentSequenceId)
        .sort((a, b) => a.order - b.order);
      if (state.selectedShotIds.length === 0 || scoped.length === 0) return state;
      const selected = new Set(
        state.selectedShotIds.filter((id) => scoped.some((shot) => shot.id === id))
      );
      const next = [...scoped];

      if (direction === "up") {
        for (let index = 1; index < next.length; index += 1) {
          if (selected.has(next[index].id) && !selected.has(next[index - 1].id)) {
            const tmp = next[index - 1];
            next[index - 1] = next[index];
            next[index] = tmp;
          }
        }
      } else {
        for (let index = next.length - 2; index >= 0; index -= 1) {
          if (selected.has(next[index].id) && !selected.has(next[index + 1].id)) {
            const tmp = next[index + 1];
            next[index + 1] = next[index];
            next[index] = tmp;
          }
        }
      }

      const normalizedScoped = next.map((shot, orderIndex) => ({
        ...shot,
        order: orderIndex + 1
      }));
      if (normalizedScoped.every((shot, index) => shot.id === scoped[index]?.id)) return state;
      return buildShotSequenceOrderUpdate(
        state,
        state.currentSequenceId,
        normalizedScoped.map((shot) => shot.id),
        true
      );
    }),

  undoShotSequenceEdit: () =>
    set((state) => {
      const entry = state.shotSequenceHistory.past[state.shotSequenceHistory.past.length - 1];
      if (!entry) return state;
      const current = captureShotSequenceHistoryEntry(state, entry.sequenceId);
      return {
        ...restoreShotSequenceHistoryEntry(state, entry),
        shotSequenceHistory: {
          past: state.shotSequenceHistory.past.slice(0, -1),
          future: [...state.shotSequenceHistory.future, current]
        }
      };
    }),

  redoShotSequenceEdit: () =>
    set((state) => {
      const entry = state.shotSequenceHistory.future[state.shotSequenceHistory.future.length - 1];
      if (!entry) return state;
      const current = captureShotSequenceHistoryEntry(state, entry.sequenceId);
      return {
        ...restoreShotSequenceHistoryEntry(state, entry),
        shotSequenceHistory: {
          past: [...state.shotSequenceHistory.past, current],
          future: state.shotSequenceHistory.future.slice(0, -1)
        }
      };
    }),

  addAudioTrack: (filePath) =>
    set((state) => {
      const nextIndex = state.audioTracks.length + 1;
      const track: AudioTrack = {
        id: `audio_${Date.now()}_${nextIndex}`,
        projectId: state.project.id,
        filePath: filePath.trim(),
        startFrame: 0,
        gain: 1,
        kind: "manual",
        label: ""
      };
      return {
        audioTracks: [...state.audioTracks, track]
      };
    }),

  upsertAudioTrack: (track) =>
    set((state) => {
      const normalized: AudioTrack = {
        id: track.id.trim(),
        projectId: track.projectId.trim() || state.project.id,
        filePath: track.filePath.trim(),
        startFrame: Math.max(0, Math.round(track.startFrame)),
        gain: Math.max(0, track.gain),
        kind: track.kind ?? "manual",
        label: track.label?.trim() ?? ""
      };
      if (!normalized.id || !normalized.filePath) return state;
      const exists = state.audioTracks.some((item) => item.id === normalized.id);
      return {
        audioTracks: exists
          ? state.audioTracks.map((item) => (item.id === normalized.id ? normalized : item))
          : [...state.audioTracks, normalized]
      };
    }),

  updateAudioTrack: (trackId, patch) =>
    set((state) => ({
      audioTracks: state.audioTracks.map((track) =>
        track.id === trackId
          ? {
              ...track,
              filePath: patch.filePath ?? track.filePath,
              startFrame:
                patch.startFrame !== undefined
                  ? Math.max(0, Math.round(patch.startFrame))
                  : track.startFrame,
              gain: patch.gain !== undefined ? Math.max(0, patch.gain) : track.gain,
              kind: patch.kind ?? track.kind,
              label: patch.label !== undefined ? patch.label.trim() : track.label
            }
          : track
      )
    })),

  removeAudioTrack: (trackId) =>
    set((state) => ({
      audioTracks: state.audioTracks.filter((track) => track.id !== trackId)
    })),

  addAsset: (input) =>
    set((state) => {
      const name = input.name.trim();
      const filePath = input.filePath.trim();
      if (!name || !filePath) return state;
      const front = input.characterFrontPath?.trim() ?? "";
      const side = input.characterSidePath?.trim() ?? "";
      const back = input.characterBackPath?.trim() ?? "";
      const faceRef = input.characterFaceRefPath?.trim() ?? "";
      const detailRef = input.characterDetailRefPath?.trim() ?? "";
      const characterAnchorModelName = input.characterAnchorModelName?.trim() ?? "";
      const voiceProfile = input.voiceProfile?.trim() ?? "";
      const skyboxDescription = input.skyboxDescription?.trim() ?? "";
      const skyboxTags = (input.skyboxTags ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
      const skyboxFaces = input.skyboxFaces ?? {};
      if (input.type === "character" && !front) return state;
      const asset: Asset = {
        id: `asset_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        projectId: state.project.id,
        type: input.type,
        name,
        filePath,
        characterFrontPath: input.type === "character" ? front : undefined,
        characterSidePath: input.type === "character" ? side || undefined : undefined,
        characterBackPath: input.type === "character" ? back || undefined : undefined,
        characterFaceRefPath: input.type === "character" ? faceRef || undefined : undefined,
        characterDetailRefPath: input.type === "character" ? detailRef || undefined : undefined,
        characterIdentityPack: input.type === "character" ? input.characterIdentityPack : undefined,
        characterLora: input.type === "character" ? input.characterLora : undefined,
        characterZeroShotEvidence: input.type === "character" ? input.characterZeroShotEvidence : undefined,
        currentZeroContext: input.type === "character" ? input.currentZeroContext : undefined,
        currentLoraContext: input.type === "character" ? input.currentLoraContext : undefined,
        characterConsistencyBaseline:
          input.type === "character" ? input.characterConsistencyBaseline : undefined,
        characterAnchorModelName: input.type === "character" ? characterAnchorModelName || undefined : undefined,
        voiceProfile: input.type === "character" ? voiceProfile : undefined,
        skyboxDescription: input.type === "skybox" ? skyboxDescription : undefined,
        skyboxTags: input.type === "skybox" ? skyboxTags : undefined,
        skyboxFaces: input.type === "skybox" ? skyboxFaces : undefined,
        skyboxUpdateEvents: input.type === "skybox" ? input.skyboxUpdateEvents ?? [] : undefined
      };
      return {
        assets: [asset, ...state.assets]
      };
    }),

  updateAsset: (assetId, patch) =>
    set((state) => ({
      assets: state.assets.map((asset) =>
        asset.id === assetId
          ? applyCharacterEvidencePatch({
              ...asset,
              type: patch.type ?? asset.type,
              name: patch.name?.trim() || asset.name,
              filePath: patch.filePath?.trim() || asset.filePath,
              characterFrontPath:
                patch.characterFrontPath !== undefined
                  ? patch.characterFrontPath.trim()
                  : asset.characterFrontPath,
              characterSidePath:
                patch.characterSidePath !== undefined
                  ? patch.characterSidePath.trim()
                  : asset.characterSidePath,
              characterBackPath:
                patch.characterBackPath !== undefined
                  ? patch.characterBackPath.trim()
                  : asset.characterBackPath,
              characterFaceRefPath:
                patch.characterFaceRefPath !== undefined
                  ? patch.characterFaceRefPath.trim()
                  : asset.characterFaceRefPath,
              characterDetailRefPath:
                patch.characterDetailRefPath !== undefined
                  ? patch.characterDetailRefPath.trim()
                  : asset.characterDetailRefPath,
              characterIdentityPack:
                (patch.type ?? asset.type) === "character"
                  ? patch.characterIdentityPack ?? asset.characterIdentityPack
                  : undefined,
              characterLora:
                (patch.type ?? asset.type) === "character"
                  ? patch.characterLora ?? asset.characterLora
                  : undefined,
              characterZeroShotEvidence:
                (patch.type ?? asset.type) === "character"
                  ? patch.characterZeroShotEvidence ?? asset.characterZeroShotEvidence
                  : undefined,
              currentZeroContext:
                (patch.type ?? asset.type) === "character"
                  ? patch.currentZeroContext ?? asset.currentZeroContext
                  : undefined,
              currentLoraContext:
                (patch.type ?? asset.type) === "character"
                  ? patch.currentLoraContext ?? asset.currentLoraContext
                  : undefined,
              characterConsistencyBaseline:
                (patch.type ?? asset.type) === "character"
                  ? patch.characterConsistencyBaseline ?? asset.characterConsistencyBaseline
                  : undefined,
              characterAnchorModelName:
                patch.characterAnchorModelName !== undefined
                  ? patch.characterAnchorModelName.trim()
                  : asset.characterAnchorModelName,
              voiceProfile:
                patch.voiceProfile !== undefined
                  ? patch.voiceProfile.trim()
                  : asset.voiceProfile,
              skyboxDescription:
                patch.skyboxDescription !== undefined
                  ? patch.skyboxDescription.trim()
                  : asset.skyboxDescription,
              skyboxTags:
                patch.skyboxTags !== undefined
                  ? patch.skyboxTags.map((item) => item.trim()).filter((item) => item.length > 0)
                  : asset.skyboxTags,
              skyboxFaces: patch.skyboxFaces ?? asset.skyboxFaces,
              skyboxUpdateEvents: patch.skyboxUpdateEvents ?? asset.skyboxUpdateEvents
            }, patch)
          : asset
      )
    })),

  removeAsset: (assetId) =>
    set((state) => ({
      assets: state.assets.filter((asset) => asset.id !== assetId),
      shots: state.shots.map((shot) => ({
        ...shot,
        characterRefs: (shot.characterRefs ?? []).filter((item) => item !== assetId),
        runningHubCloud: (shot.characterRefs ?? []).includes(assetId) ? undefined : shot.runningHubCloud
      }))
    })),

  toggleCharacterRefForShot: (shotId, characterAssetId) =>
    set((state) => ({
      shots: state.shots.map((shot) => {
        if (shot.id !== shotId) return shot;
        const refs = shot.characterRefs ?? [];
        const exists = refs.includes(characterAssetId);
        return {
          ...shot,
          characterRefs: exists ? refs.filter((item) => item !== characterAssetId) : [...refs, characterAssetId],
          runningHubCloud: undefined
        };
      })
    })),

  updateShotFields: (shotId, patch) =>
    set((state) => ({
      shots: state.shots.map((shot) =>
        shot.id === shotId
          ? (() => {
               const profileChanged = patch.videoWorkflowProfileId !== undefined && patch.videoWorkflowProfileId !== shot.videoWorkflowProfileId;
               const receiptChanged = patch.videoGenerationReceipt !== undefined && JSON.stringify(patch.videoGenerationReceipt) !== JSON.stringify(shot.videoGenerationReceipt);
               const mediaChanged = patch.generatedVideoPath !== undefined && patch.generatedVideoPath !== shot.generatedVideoPath;
               const cloudInputChanged =
                 (patch.storyPrompt !== undefined && patch.storyPrompt !== shot.storyPrompt) ||
                 (patch.videoPrompt !== undefined && patch.videoPrompt !== shot.videoPrompt) ||
                 (patch.characterRefs !== undefined && JSON.stringify(patch.characterRefs) !== JSON.stringify(shot.characterRefs)) ||
                 (patch.generatedImagePath !== undefined && patch.generatedImagePath !== shot.generatedImagePath) ||
                 profileChanged || mediaChanged;
               const generationContractChanged =
                 (patch.title !== undefined && patch.title !== shot.title) ||
                 (patch.storyPrompt !== undefined && patch.storyPrompt !== shot.storyPrompt) ||
                 (patch.notes !== undefined && patch.notes !== shot.notes) ||
                 (patch.dialogue !== undefined && patch.dialogue !== shot.dialogue) ||
                 (patch.seed !== undefined && patch.seed !== shot.seed) ||
                 (patch.characterRefs !== undefined && JSON.stringify(patch.characterRefs) !== JSON.stringify(shot.characterRefs)) ||
                 (patch.sceneRefId !== undefined && patch.sceneRefId !== shot.sceneRefId) ||
                 (patch.generatedImagePath !== undefined && patch.generatedImagePath !== shot.generatedImagePath) ||
                 (patch.videoPrompt !== undefined && patch.videoPrompt !== shot.videoPrompt) ||
                 (patch.videoMode !== undefined && patch.videoMode !== shot.videoMode) ||
                 (patch.videoStartFramePath !== undefined && patch.videoStartFramePath !== shot.videoStartFramePath) ||
                 (patch.videoEndFramePath !== undefined && patch.videoEndFramePath !== shot.videoEndFramePath) ||
                 (patch.videoQualityTier !== undefined && patch.videoQualityTier !== shot.videoQualityTier) ||
                 (patch.videoAccelerationMode !== undefined && patch.videoAccelerationMode !== shot.videoAccelerationMode) ||
                 (patch.continuitySegmentId !== undefined && patch.continuitySegmentId !== shot.continuitySegmentId) ||
                 (patch.videoBoundaryKind !== undefined && patch.videoBoundaryKind !== shot.videoBoundaryKind) ||
                 (patch.approvedBoundaryFramePath !== undefined && patch.approvedBoundaryFramePath !== shot.approvedBoundaryFramePath);
                const cloudArtifactChanged = patch.runningHubCloud !== undefined && runningHubArtifactIdentity(patch.runningHubCloud) !== runningHubArtifactIdentity(shot.runningHubCloud);
                const invalidatesProduction = profileChanged || receiptChanged || mediaChanged || generationContractChanged || cloudArtifactChanged;
                const carriesReplacementEvidence = patch.videoProductionEvidence !== undefined;
                const clearsProduction = invalidatesProduction && !carriesReplacementEvidence;
                const clearsGeneratedMedia = (profileChanged || generationContractChanged || cloudArtifactChanged) && patch.generatedVideoPath === undefined;
              const next: Shot = {
              ...shot,
              title: patch.title ?? shot.title,
              dialogue: patch.dialogue ?? shot.dialogue,
              notes: patch.notes ?? shot.notes,
              tags: patch.tags ?? shot.tags,
              storyPrompt: patch.storyPrompt ?? shot.storyPrompt,
              negativePrompt: patch.negativePrompt ?? shot.negativePrompt,
              videoPrompt: patch.videoPrompt ?? shot.videoPrompt,
              videoMode: patch.videoMode ?? shot.videoMode,
              videoStartFramePath: patch.videoStartFramePath ?? shot.videoStartFramePath,
              videoEndFramePath: patch.videoEndFramePath ?? shot.videoEndFramePath,
              videoWorkflowProfileId: patch.videoWorkflowProfileId ?? shot.videoWorkflowProfileId,
              videoQualityTier: patch.videoQualityTier ?? shot.videoQualityTier,
              videoAccelerationMode: patch.videoAccelerationMode ?? shot.videoAccelerationMode,
              continuitySegmentId: patch.continuitySegmentId ?? shot.continuitySegmentId,
              videoBoundaryKind: patch.videoBoundaryKind ?? shot.videoBoundaryKind,
              approvedBoundaryFramePath:
                patch.approvedBoundaryFramePath ?? shot.approvedBoundaryFramePath,
              videoRouteReason: patch.videoRouteReason ?? shot.videoRouteReason,
              videoQualityStatus: patch.videoQualityStatus ?? shot.videoQualityStatus,
              videoGenerationReceipt:
                patch.videoGenerationReceipt !== undefined
                  ? patch.videoGenerationReceipt
                  : clearsGeneratedMedia
                    ? undefined
                    : shot.videoGenerationReceipt,
              videoGenerationContractDigest:
                patch.videoGenerationContractDigest !== undefined
                  ? patch.videoGenerationContractDigest
                  : clearsGeneratedMedia
                    ? undefined
                    : shot.videoGenerationContractDigest,
              videoProductionEvidence: patch.videoProductionEvidence !== undefined
                   ? normalizeVideoProductionEvidence(patch.videoProductionEvidence, shot.id, shot.sequenceId)
                  : clearsProduction
                    ? undefined
                    : shot.videoProductionEvidence,
              videoProviderArtifact: patch.videoProviderArtifact !== undefined
                ? patch.videoProviderArtifact
                : clearsProduction
                  ? undefined
                  : shot.videoProviderArtifact,
              runningHubCloud: cloudInputChanged
                ? undefined
                : patch.runningHubCloud !== undefined
                  ? normalizeRunningHubCloud(patch.runningHubCloud)
                  : shot.runningHubCloud,
              skyboxFace: patch.skyboxFace ?? shot.skyboxFace,
              skyboxFaces: patch.skyboxFaces ?? shot.skyboxFaces,
              skyboxFaceWeights: patch.skyboxFaceWeights ?? shot.skyboxFaceWeights,
              cameraYaw: patch.cameraYaw ?? shot.cameraYaw,
              cameraPitch: patch.cameraPitch ?? shot.cameraPitch,
              cameraFov: patch.cameraFov ?? shot.cameraFov,
              seed: patch.seed ?? shot.seed,
              characterRefs: patch.characterRefs ?? shot.characterRefs,
              sceneRefId: patch.sceneRefId ?? shot.sceneRefId,
              sourceCharacterNames: patch.sourceCharacterNames ?? shot.sourceCharacterNames,
              sourceSceneName: patch.sourceSceneName ?? shot.sourceSceneName,
              sourceScenePrompt: patch.sourceScenePrompt ?? shot.sourceScenePrompt,
              generatedImagePath: patch.generatedImagePath ?? shot.generatedImagePath,
              generatedVideoPath:
                patch.generatedVideoPath !== undefined
                  ? patch.generatedVideoPath
                  : clearsGeneratedMedia
                    ? undefined
                    : shot.generatedVideoPath
            };
              if (clearsProduction) next.videoQualityStatus = "pending";
              return next;
            })()
          : shot
      )
    })),

  replaceShotsForCurrentSequence: (items) =>
    set((state) => buildShotReplacement(state, items) ?? state),

  replaceShotScriptForCurrentSequence: ({ shots: scriptShots, transitions }) =>
    set((state) => buildShotReplacement(state, scriptShots, transitions) ?? state),

  selectShotTransition: (transitionId) =>
    set((state) => ({
      selectedShotTransitionId: findUniqueTransitionById(state.shotTransitions, transitionId)?.id ?? null
    })),

  updateShotTransition: (transitionId, patch) =>
    set((state) => {
      const current = findUniqueTransitionById(state.shotTransitions, transitionId);
      if (!current) return state;
      const fromShot = state.shots.find((shot) =>
        shot.sequenceId === current.sequenceId && shot.id === current.fromShotId
      );
      const toShot = state.shots.find((shot) =>
        shot.sequenceId === current.sequenceId && shot.id === current.toShotId
      );
      if (!fromShot || !toShot) return state;
      const type = patch.type ?? current.type;
      const ceiling = Math.min(fromShot.durationFrames, toShot.durationFrames) / Math.max(1, state.project.fps);
      const requestedDuration = patch.durationSeconds ?? current.durationSeconds;
      const durationSeconds = type === "hard_cut"
        ? 0
        : Math.min(Math.max(0, Number.isFinite(requestedDuration) ? requestedDuration : 0), ceiling);
      const frameDependency =
        patch.frameDependency ?? (patch.type === "continuous" ? "previous_tail" : current.frameDependency);
      const next: ShotTransition = {
        ...current,
        type,
        durationSeconds,
        frameDependency,
        sharedFramePath: patch.sharedFramePath ?? current.sharedFramePath,
        actionContinuity: patch.actionContinuity ?? current.actionContinuity,
        characterPosition: patch.characterPosition ?? current.characterPosition,
        cameraDirection: patch.cameraDirection ?? current.cameraDirection,
        notes: patch.notes ?? current.notes
      };
      return {
        shotTransitions: state.shotTransitions.map((item) => item === current ? next : item)
      };
    }),

  batchSetDurationForSelectedShots: (durationFrames) =>
    set((state) => {
      const selected = new Set(state.selectedShotIds);
      if (selected.size === 0) return state;
      const safeDuration = Math.max(1, Math.round(durationFrames));
      const nextShots = state.shots.map((shot) =>
        selected.has(shot.id) && shot.durationFrames !== safeDuration
          ? {
              ...shot,
              durationFrames: safeDuration,
              generatedVideoPath: undefined,
              videoGenerationReceipt: undefined,
              videoGenerationContractDigest: undefined,
              videoProductionEvidence: undefined,
              videoProviderArtifact: undefined,
              runningHubCloud: undefined,
              videoQualityStatus: "pending" as const
            }
          : shot
      );
      const affectedSequenceIds = state.shots
        .filter((shot) => selected.has(shot.id))
        .map((shot) => shot.sequenceId);
      const shotTransitions = reconcileTransitionSequences(
        state.shotTransitions,
        nextShots,
        state.project.fps,
        affectedSequenceIds
      );
      return {
        shots: nextShots,
        shotTransitions,
        selectedShotTransitionId: findUniqueTransitionById(
          shotTransitions,
          state.selectedShotTransitionId
        )?.id ?? null
      };
    }),

  batchAddTagForSelectedShots: (tag) =>
    set((state) => {
      const selected = new Set(state.selectedShotIds);
      if (selected.size === 0) return state;
      const safeTag = tag.trim();
      if (!safeTag) return state;
      const lower = safeTag.toLowerCase();
      return {
        shots: state.shots.map((shot) => {
          if (!selected.has(shot.id)) return shot;
          const exists = shot.tags.some((item) => item.toLowerCase() === lower);
          if (exists) return shot;
          return {
            ...shot,
            tags: [...shot.tags, safeTag]
          };
        })
      };
    }),

  batchRemoveTagForSelectedShots: (tag) =>
    set((state) => {
      const selected = new Set(state.selectedShotIds);
      if (selected.size === 0) return state;
      const safeTag = tag.trim().toLowerCase();
      if (!safeTag) return state;
      return {
        shots: state.shots.map((shot) =>
          selected.has(shot.id)
            ? {
                ...shot,
                tags: shot.tags.filter((item) => item.toLowerCase() !== safeTag)
              }
            : shot
        )
      };
    }),

  updateProjectSettings: (settings) =>
    set((state) => {
      const now = new Date().toISOString();
      const nextFps = settings.fps ? Math.max(1, Math.round(settings.fps)) : state.project.fps;
      const nextWidth = settings.width ? Math.max(320, Math.round(settings.width)) : state.project.width;
      const nextHeight = settings.height ? Math.max(240, Math.round(settings.height)) : state.project.height;
      const normalizationChanged = nextFps !== state.project.fps || nextWidth !== state.project.width || nextHeight !== state.project.height;
      const nextShots = normalizationChanged ? state.shots.map((shot) => ({
        ...shot,
        generatedVideoPath: undefined,
        videoGenerationReceipt: undefined,
        videoGenerationContractDigest: undefined,
        videoProductionEvidence: undefined,
        videoProviderArtifact: undefined,
        runningHubCloud: undefined,
        videoQualityStatus: "pending" as const
      })) : state.shots;
      const shotTransitions = nextFps !== state.project.fps
        ? reconcileAllLinearTransitions(
            state.sequences,
            nextShots,
            nextFps,
            state.shotTransitions
          )
        : state.shotTransitions;
      return {
        project: {
          ...state.project,
          name: settings.name?.trim() || state.project.name,
          fps: nextFps,
          width: nextWidth,
          height: nextHeight,
          updatedAt: now
        },
        shots: nextShots,
        shotTransitions,
        selectedShotTransitionId: findUniqueTransitionById(
          shotTransitions,
          state.selectedShotTransitionId
        )?.id ?? null
      };
    }),

  setShotDuration: (shotId, durationFrames) =>
    set((state) => {
      const nextShots = state.shots.map((shot) =>
        shot.id === shotId
          ? (() => {
              const nextDuration = Math.max(1, durationFrames);
              if (nextDuration === shot.durationFrames) return shot;
              return {
                ...shot,
                durationFrames: nextDuration,
                generatedVideoPath: undefined,
                videoGenerationReceipt: undefined,
                videoGenerationContractDigest: undefined,
                videoProductionEvidence: undefined,
                videoProviderArtifact: undefined,
                runningHubCloud: undefined,
                videoQualityStatus: "pending" as const
              };
            })()
          : shot
      );
      const affectedSequenceIds = state.shots
        .filter((shot) => shot.id === shotId)
        .map((shot) => shot.sequenceId);
      const shotTransitions = reconcileTransitionSequences(
        state.shotTransitions,
        nextShots,
        state.project.fps,
        affectedSequenceIds
      );
      return {
        shots: nextShots,
        shotTransitions,
        selectedShotTransitionId: findUniqueTransitionById(
          shotTransitions,
          state.selectedShotTransitionId
        )?.id ?? null
      };
    }),

  setCurrentFrame: (frame) =>
    set((state) => ({
      playback: {
        ...state.playback,
        currentFrame: Math.max(0, frame)
      }
    })),

  setExportSettings: (settings) =>
    set((state) => ({
      exportSettings: {
        width: settings.width ? Math.max(320, Math.round(settings.width)) : state.exportSettings.width,
        height: settings.height ? Math.max(240, Math.round(settings.height)) : state.exportSettings.height,
        fps: settings.fps ? Math.max(1, Math.round(settings.fps)) : state.exportSettings.fps,
        videoBitrateKbps: settings.videoBitrateKbps
          ? Math.max(500, Math.round(settings.videoBitrateKbps))
          : state.exportSettings.videoBitrateKbps
      }
    })),

  applyExportPreset: (preset) =>
    set((state) => {
      if (preset === "hd720") {
        return {
          exportSettings: {
            ...state.exportSettings,
            width: 1280,
            height: 720,
            fps: state.project.fps
          }
        };
      }
      if (preset === "vertical1080") {
        return {
          exportSettings: {
            ...state.exportSettings,
            width: 1080,
            height: 1920,
            fps: state.project.fps
          }
        };
      }
      return {
        exportSettings: {
          ...state.exportSettings,
          width: 1920,
          height: 1080,
          fps: state.project.fps
        }
      };
    }),

  setBrushColor: (color) =>
    set((state) => ({
      canvasTool: {
        ...state.canvasTool,
        brushColor: color
      }
    })),

  setCanvasMode: (mode) =>
    set((state) => ({
      canvasTool: {
        ...state.canvasTool,
        mode
      }
    })),

  setBrushSize: (size) =>
    set((state) => ({
      canvasTool: {
        ...state.canvasTool,
        brushSize: Math.max(1, Math.min(64, size))
      }
    })),

  setOnionSkinEnabled: (enabled) =>
    set((state) => ({
      canvasTool: {
        ...state.canvasTool,
        onionSkinEnabled: enabled
      }
    })),

  setOnionSkinRange: (range) =>
    set((state) => ({
      canvasTool: {
        ...state.canvasTool,
        onionSkinRange: Math.max(1, Math.min(3, Math.round(range)))
      }
    })),

  setActiveLayerForShot: (shotId, layerId) =>
    set((state) => ({
      activeLayerByShotId: {
        ...state.activeLayerByShotId,
        [shotId]: layerId
      }
    })),

  repairActiveLayerMap: () =>
    set((state) => {
      const nextMap: Record<string, string> = { ...state.activeLayerByShotId };
      for (const shot of state.shots) {
        const shotLayers = state.layers
          .filter((layer) => layer.shotId === shot.id)
          .sort((a, b) => a.zIndex - b.zIndex);
        if (shotLayers.length === 0) continue;
        const active = nextMap[shot.id];
        const valid = shotLayers.some((layer) => layer.id === active);
        if (!valid) {
          nextMap[shot.id] = shotLayers[0].id;
        }
      }
      return {
        activeLayerByShotId: nextMap
      };
    }),

  repairStrokeLayerRefs: () =>
    set((state) => {
      const layerIdsByShot = new Map<string, Set<string>>();
      for (const shot of state.shots) {
        layerIdsByShot.set(
          shot.id,
          new Set(state.layers.filter((layer) => layer.shotId === shot.id).map((layer) => layer.id))
        );
      }

      const nextStrokes: Record<string, Stroke[]> = {};
      for (const [shotId, strokes] of Object.entries(state.shotStrokes)) {
        const validIds = layerIdsByShot.get(shotId) ?? new Set<string>();
        nextStrokes[shotId] = strokes.map((stroke) => {
          if (!stroke.layerId) return stroke;
          if (validIds.has(stroke.layerId)) return stroke;
          return { ...stroke, layerId: undefined };
        });
      }

      return {
        shotStrokes: nextStrokes
      };
    }),

  addLayerToShot: (shotId) =>
    set((state) => {
      const shotLayers = state.layers.filter((layer) => layer.shotId === shotId);
      const nextIndex = shotLayers.length + 1;
      const newLayerId = allocateSafeId(
        "layer",
        shotId,
        `layer_${Date.now()}`,
        new Set(state.layers.map((layer) => layer.id))
      );
      const zIndex = shotLayers.reduce((max, layer) => Math.max(max, layer.zIndex), 0) + 1;
      const newLayer: ShotLayer = {
        id: newLayerId,
        shotId,
        name: `Layer ${nextIndex}`,
        visible: true,
        locked: false,
        zIndex,
        bitmapPath: `shots/${shotId}/${newLayerId}.png`
      };

      return {
        layers: [...state.layers, newLayer],
        activeLayerByShotId: {
          ...state.activeLayerByShotId,
          [shotId]: newLayerId
        }
      };
    }),

  removeLayerFromShot: (shotId, layerId) =>
    set((state) => {
      const shotLayers = state.layers.filter((layer) => layer.shotId === shotId);
      if (shotLayers.length <= 1) return state;

      const nextLayers = state.layers.filter((layer) => layer.id !== layerId);
      const activeLayer = state.activeLayerByShotId[shotId];
      const nextActiveLayer =
        activeLayer === layerId
          ? nextLayers.find((layer) => layer.shotId === shotId)?.id ?? ""
          : activeLayer;

      return {
        layers: nextLayers,
        activeLayerByShotId: {
          ...state.activeLayerByShotId,
          [shotId]: nextActiveLayer
        }
      };
    }),

  moveLayerInShot: (shotId, layerId, direction) =>
    set((state) => {
      const scoped = state.layers
        .filter((layer) => layer.shotId === shotId)
        .sort((a, b) => a.zIndex - b.zIndex);
      const index = scoped.findIndex((layer) => layer.id === layerId);
      if (index < 0) return state;

      const target = direction === "up" ? index + 1 : index - 1;
      if (target < 0 || target >= scoped.length) return state;

      const reordered = [...scoped];
      const [moving] = reordered.splice(index, 1);
      reordered.splice(target, 0, moving);
      const zMap = new Map<string, number>();
      reordered.forEach((layer, idx) => zMap.set(layer.id, idx + 1));

      return {
        layers: state.layers.map((layer) =>
          layer.shotId === shotId && zMap.has(layer.id)
            ? { ...layer, zIndex: zMap.get(layer.id) ?? layer.zIndex }
            : layer
        )
      };
    }),

  renameLayer: (layerId, name) =>
    set((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === layerId ? { ...layer, name: name.trim() || layer.name } : layer
      )
    })),

  toggleLayerVisibility: (layerId) =>
    set((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === layerId ? { ...layer, visible: !layer.visible } : layer
      )
    })),

  toggleLayerLock: (layerId) =>
    set((state) => ({
      layers: state.layers.map((layer) =>
        layer.id === layerId ? { ...layer, locked: !layer.locked } : layer
      )
    })),

  duplicateShot: (shotId) =>
    set((state) => {
      const source = state.shots.find((shot) => shot.id === shotId);
      if (!source) return state;
      const scoped = state.shots
        .filter((shot) => shot.sequenceId === source.sequenceId)
        .sort((a, b) => a.order - b.order);
      const sourceIndex = scoped.findIndex((shot) => shot.id === shotId);
      if (sourceIndex < 0) return state;

      const newShotId = allocateSafeId(
        "shot",
        source.sequenceId,
        `shot_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        new Set(state.shots.map((shot) => shot.id))
      );
      const duplicate: Shot = withoutShotBoundOutputs({
        ...source,
        id: newShotId,
        title: `${source.title} Copy`
      });

      const nextShots = [...scoped];
      nextShots.splice(sourceIndex + 1, 0, duplicate);
      const normalizedScoped = nextShots.map((shot, orderIndex) => ({
        ...shot,
        order: orderIndex + 1
      }));
      const normalizedById = new Map(normalizedScoped.map((shot) => [shot.id, shot]));

      const sourceLayers = state.layers
        .filter((layer) => layer.shotId === shotId)
        .sort((a, b) => a.zIndex - b.zIndex);
      const layerIdMap = new Map<string, string>();
      const usedLayerIds = new Set(state.layers.map((layer) => layer.id));
      const copiedLayers: ShotLayer[] = sourceLayers.map((layer, index) => {
        const newLayerId = allocateSafeId(
          "layer",
          newShotId,
          `layer_${newShotId}_${index + 1}`,
          usedLayerIds
        );
        layerIdMap.set(layer.id, newLayerId);
        return {
          ...layer,
          id: newLayerId,
          shotId: newShotId,
          bitmapPath: `shots/${newShotId}/${newLayerId}.png`
        };
      });

      const sourceStrokes = state.shotStrokes[shotId] ?? [];
      const copiedStrokes = sourceStrokes.map((stroke, index) => ({
        ...stroke,
        id: `stroke_${newShotId}_${index + 1}`,
        layerId: stroke.layerId ? layerIdMap.get(stroke.layerId) : undefined
      }));

      const activeSourceLayer = state.activeLayerByShotId[shotId];
      const nextActiveLayer =
        (activeSourceLayer ? layerIdMap.get(activeSourceLayer) : undefined) ??
        copiedLayers[0]?.id;
      const mergedShots = state.shots
        .filter((shot) => shot.sequenceId !== source.sequenceId)
        .concat(normalizedScoped);

      return {
        shots: mergedShots.map((shot) => normalizedById.get(shot.id) ?? shot),
        layers: [...state.layers, ...copiedLayers],
        shotStrokes: {
          ...state.shotStrokes,
          [newShotId]: copiedStrokes
        },
        shotHistory: {
          ...state.shotHistory,
          [newShotId]: { past: [], future: [] }
        },
        activeLayerByShotId: nextActiveLayer
          ? {
              ...state.activeLayerByShotId,
              [newShotId]: nextActiveLayer
            }
          : state.activeLayerByShotId,
        selectedShotId: newShotId,
        selectedShotIds: [newShotId]
      };
    }),

  deleteShot: (shotId) =>
    set((state) => {
      const source = state.shots.find((shot) => shot.id === shotId);
      if (!source) return state;
      const scoped = state.shots
        .filter((shot) => shot.sequenceId === source.sequenceId)
        .sort((a, b) => a.order - b.order);
      const sourceIndex = scoped.findIndex((shot) => shot.id === shotId);
      const remainingScoped = scoped.filter((shot) => shot.id !== shotId);
      const normalizedScoped = remainingScoped.map((shot, orderIndex) => ({
        ...shot,
        order: orderIndex + 1
      }));
      const normalizedById = new Map(normalizedScoped.map((shot) => [shot.id, shot]));
      const mergedShots = state.shots
        .filter((shot) => shot.sequenceId !== source.sequenceId)
        .concat(normalizedScoped)
        .map((shot) => normalizedById.get(shot.id) ?? shot);
      const nextTransitions = removeShotFromLinearSequence({
        sequenceId: source.sequenceId,
        orderedShots: linearRefs(scoped, state.project.fps),
        transitions: state.shotTransitions,
        shotId
      }).transitions;
      const shotTransitions = [
        ...state.shotTransitions.filter((item) => item.sequenceId !== source.sequenceId),
        ...nextTransitions
      ];

      const nextLayers = state.layers.filter((layer) => layer.shotId !== shotId);
      const nextSelectedShotIds = state.selectedShotIds.filter((id) => id !== shotId);
      const nextSelectedShotId =
        state.selectedShotId === shotId
          ? normalizedScoped[Math.min(sourceIndex, normalizedScoped.length - 1)]?.id ?? ""
          : state.selectedShotId;

      const { [shotId]: _removedStrokes, ...nextShotStrokes } = state.shotStrokes;
      const { [shotId]: _removedHistory, ...nextShotHistory } = state.shotHistory;
      const { [shotId]: _removedActiveLayer, ...nextActiveLayerByShotId } = state.activeLayerByShotId;

      return {
        shots: mergedShots,
        shotTransitions,
        layers: nextLayers,
        shotStrokes: nextShotStrokes,
        shotHistory: nextShotHistory,
        activeLayerByShotId: nextActiveLayerByShotId,
        selectedShotId: nextSelectedShotId,
        selectedShotTransitionId: shotTransitions.some((item) => item.id === state.selectedShotTransitionId)
          ? state.selectedShotTransitionId
          : null,
        selectedShotIds: nextSelectedShotIds
      };
    }),

  deleteSelectedShots: () =>
    set((state) => {
      if (state.selectedShotIds.length === 0) return state;
      const removed = new Set(
        state.selectedShotIds.filter((id) =>
          state.shots.some(
            (shot) => shot.id === id && shot.sequenceId === state.currentSequenceId
          )
        )
      );
      if (removed.size === 0) return state;
      const scoped = state.shots
        .filter((shot) => shot.sequenceId === state.currentSequenceId)
        .sort((a, b) => a.order - b.order);
      const remainingScoped = scoped.filter((shot) => !removed.has(shot.id));
      const normalizedScoped = remainingScoped.map((shot, orderIndex) => ({
        ...shot,
        order: orderIndex + 1
      }));
      const normalizedById = new Map(normalizedScoped.map((shot) => [shot.id, shot]));
      const mergedShots = state.shots
        .filter((shot) => shot.sequenceId !== state.currentSequenceId)
        .concat(normalizedScoped)
        .map((shot) => normalizedById.get(shot.id) ?? shot);
      const nextTransitions = reconcileLinearTransitions({
        sequenceId: state.currentSequenceId,
        orderedShots: linearRefs(normalizedScoped, state.project.fps),
        existingTransitions: state.shotTransitions
      });
      const shotTransitions = [
        ...state.shotTransitions.filter((item) => item.sequenceId !== state.currentSequenceId),
        ...nextTransitions
      ];

      const nextLayers = state.layers.filter((layer) => !removed.has(layer.shotId));
      const nextShotStrokes: Record<string, Stroke[]> = {};
      for (const [id, strokes] of Object.entries(state.shotStrokes)) {
        if (!removed.has(id)) nextShotStrokes[id] = strokes;
      }

      const nextShotHistory: Record<string, CanvasHistoryState> = {};
      for (const [id, history] of Object.entries(state.shotHistory)) {
        if (!removed.has(id)) nextShotHistory[id] = history;
      }

      const nextActiveLayerByShotId: Record<string, string> = {};
      for (const [id, layerId] of Object.entries(state.activeLayerByShotId)) {
        if (!removed.has(id)) nextActiveLayerByShotId[id] = layerId;
      }

      const nextSelectedShotId = removed.has(state.selectedShotId)
        ? normalizedScoped[0]?.id ?? ""
        : state.selectedShotId;

      return {
        shots: mergedShots,
        shotTransitions,
        layers: nextLayers,
        shotStrokes: nextShotStrokes,
        shotHistory: nextShotHistory,
        activeLayerByShotId: nextActiveLayerByShotId,
        selectedShotId: nextSelectedShotId,
        selectedShotTransitionId: shotTransitions.some((item) => item.id === state.selectedShotTransitionId)
          ? state.selectedShotTransitionId
          : null,
        selectedShotIds: []
      };
    }),

  addStroke: (shotId, stroke) =>
    set((state) => {
      const currentStrokes = state.shotStrokes[shotId] ?? [];
      const history = state.shotHistory[shotId] ?? { past: [], future: [] };

      return {
        shotStrokes: {
          ...state.shotStrokes,
          [shotId]: [...currentStrokes, stroke]
        },
        shotHistory: {
          ...state.shotHistory,
          [shotId]: {
            past: [...history.past, currentStrokes],
            future: []
          }
        }
      };
    }),

  undoStroke: (shotId) =>
    set((state) => {
      const history = state.shotHistory[shotId];
      if (!history || history.past.length === 0) return state;

      const currentStrokes = state.shotStrokes[shotId] ?? [];
      const previousStrokes = history.past[history.past.length - 1];

      return {
        shotStrokes: {
          ...state.shotStrokes,
          [shotId]: previousStrokes
        },
        shotHistory: {
          ...state.shotHistory,
          [shotId]: {
            past: history.past.slice(0, -1),
            future: [currentStrokes, ...history.future]
          }
        }
      };
    }),

  redoStroke: (shotId) =>
    set((state) => {
      const history = state.shotHistory[shotId];
      if (!history || history.future.length === 0) return state;

      const currentStrokes = state.shotStrokes[shotId] ?? [];
      const nextStrokes = history.future[0];

      return {
        shotStrokes: {
          ...state.shotStrokes,
          [shotId]: nextStrokes
        },
        shotHistory: {
          ...state.shotHistory,
          [shotId]: {
            past: [...history.past, currentStrokes],
            future: history.future.slice(1)
          }
        }
      };
    }),

  upsertGenerationTask: (task) =>
    set((state) => {
      if (!state.shots.some((shot) => shot.id === task.shotId)) {
        throw new Error(`Cannot create generation task for unknown shot: ${task.shotId}`);
      }

      const existingTask = state.generationTasks.find((item) => item.id === task.id);
      const nextTask: StoryboardGenerationTask = {
        ...existingTask,
        ...task,
        errorCode: task.errorCode ?? existingTask?.errorCode,
        errorMessage: task.errorMessage ?? existingTask?.errorMessage
      };

      return {
        generationTasks: existingTask
          ? state.generationTasks.map((item) => (item.id === task.id ? nextTask : item))
          : [...state.generationTasks, nextTask]
      };
    }),

  markGenerationTaskFailed: (id, error) =>
    set((state) => {
      const task = state.generationTasks.find((item) => item.id === id);
      if (!task) throw new Error(`Cannot fail unknown generation task: ${id}`);

      return {
        generationTasks: state.generationTasks.map((item) =>
          item.id === id
            ? {
                ...item,
                stage: "failed",
                status: "failed",
                errorCode: error.errorCode ?? item.errorCode,
                errorMessage: error.errorMessage ?? item.errorMessage,
                bestPreviewPath: error.bestPreviewPath ?? item.bestPreviewPath,
                reviewReasons: error.reviewReasons ? [...error.reviewReasons] : item.reviewReasons,
                finishedAt: new Date().toISOString()
              }
            : item
        )
      };
    }),

  markGenerationTaskCancelled: (id, review = {}) =>
    set((state) => {
      const task = state.generationTasks.find((item) => item.id === id);
      if (!task) throw new Error(`Cannot cancel unknown generation task: ${id}`);
      if (["completed", "cancelled", "rejected", "needs_review"].includes(task.status)) return state;
      return {
        generationTasks: state.generationTasks.map((item) =>
          item.id === id
            ? {
                ...item,
                stage: "cancelled",
                status: "cancelled",
                errorCode: "cancelled",
                errorMessage: review.errorMessage ?? item.errorMessage ?? "Generation cancelled",
                bestPreviewPath: review.bestPreviewPath ?? item.bestPreviewPath,
                reviewReasons: review.reviewReasons ? [...review.reviewReasons] : item.reviewReasons,
                finishedAt: new Date().toISOString()
              }
            : item
        )
      };
    }),

  markGenerationTaskNeedsReview: (id, bestPreviewPath, reviewReasons, expected) =>
    set((state) => {
      const task = state.generationTasks.find((item) => item.id === id);
      if (!task) throw new Error(`Cannot review unknown generation task: ${id}`);
      const canEnterReview =
        (task.status === "queued" || task.status === "running") &&
        task.stage !== "needs_review" &&
        task.stage !== "completed" &&
        task.stage !== "cancelled" &&
        task.stage !== "failed";
      if (!canEnterReview) return state;
      if (expected && (
        task.stage !== expected.stage ||
        task.status !== expected.status ||
        task.shotId !== expected.shotId ||
        task.outputPath !== expected.outputPath ||
        task.externalProvider !== expected.externalProvider ||
        task.externalJobId !== expected.externalJobId
      )) {
        return state;
      }
      return {
        generationTasks: state.generationTasks.map((item) =>
          item.id === id
            ? {
                ...item,
                stage: "needs_review",
                status: "needs_review",
                bestPreviewPath,
                reviewReasons: [...reviewReasons],
                finishedAt: new Date().toISOString()
              }
            : item
        )
      };
    }),

  completeGenerationTask: (id, outputPath) =>
    set((state) => {
      const task = state.generationTasks.find((item) => item.id === id);
      if (!task) throw new Error(`Cannot complete unknown generation task: ${id}`);
      if (task.stage === "needs_review" || task.status === "needs_review" || task.status === "cancelled" || task.status === "rejected") {
        return state;
      }
      if (!state.shots.some((shot) => shot.id === task.shotId)) {
        throw new Error(`Cannot complete generation task for unknown shot: ${task.shotId}`);
      }

      const finishedAt = new Date().toISOString();
      return {
        shots: state.shots.map((shot) =>
          shot.id === task.shotId ? { ...shot, generatedImagePath: outputPath } : shot
        ),
        generationTasks: state.generationTasks.map((item) =>
          item.id === id
            ? {
                ...item,
                stage: "completed",
                status: "completed",
                outputPath,
                finishedAt
              }
            : item
        )
      };
    }),

  acceptGenerationTaskCandidate: (id) =>
    set((state) => {
      const task = state.generationTasks.find((item) => item.id === id);
      if (!task) throw new Error(`Cannot accept unknown generation task: ${id}`);
      if (task.stage !== "needs_review" || task.status !== "needs_review") {
        throw new Error(`Cannot accept generation task that is not needs_review: ${id}`);
      }
      if (!state.shots.some((shot) => shot.id === task.shotId)) {
        throw new Error(`Cannot accept generation task for unknown shot: ${task.shotId}`);
      }
      const outputPath = task.bestPreviewPath?.trim();
      if (!outputPath) {
        throw new Error(`Cannot accept generation task without a best preview path: ${id}`);
      }

      const finishedAt = new Date().toISOString();
      return {
        shots: state.shots.map((shot) =>
          shot.id === task.shotId ? { ...shot, generatedImagePath: outputPath } : shot
        ),
        generationTasks: state.generationTasks.map((item) =>
          item.id === id
            ? {
                ...item,
                stage: "completed",
                status: "completed",
                outputPath,
                finishedAt
              }
            : item
        )
      };
    }),

  rejectGenerationTaskCandidate: (id, reason = "codex_candidate_rejected") =>
    set((state) => {
      const task = state.generationTasks.find((item) => item.id === id);
      if (!task) throw new Error(`Cannot reject unknown generation task: ${id}`);
      if (task.stage !== "needs_review" || task.status !== "needs_review") {
        throw new Error(`Cannot reject generation task that is not needs_review: ${id}`);
      }
      return {
        generationTasks: state.generationTasks.map((item) => item.id === id ? {
          ...item,
          stage: "rejected",
          status: "rejected",
          errorCode: "rejected",
          errorMessage: reason,
          finishedAt: new Date().toISOString()
        } : item)
      };
    }),

  createSpatialStage: (sceneId) => {
    const stage = createEmptySceneStage(sceneId);
    stage.sourceDigest = computeStageSourceDigest(stage);
    set((state) => ({ spatialStages: addStage(state.spatialStages, stage) }));
    return stage.id;
  },

  updateSpatialScene: (scene) =>
    set((state) => {
      const spatialScenes = state.spatialScenes.some((item) => item.id === scene.id)
        ? state.spatialScenes.map((item) => (item.id === scene.id ? scene : item))
        : [...state.spatialScenes, scene];
      const selectedSpatialObjectId =
        state.selectedSpatialObjectId && !scene.objects.some((object) => object.id === state.selectedSpatialObjectId) &&
        state.spatialScenes.some((item) => item.id === scene.id)
          ? null
          : state.selectedSpatialObjectId;
      return { spatialScenes, selectedSpatialObjectId };
    }),

  setSelectedSpatialObject: (objectId) =>
    set((state) => {
      if (objectId === null) return { selectedSpatialObjectId: null };
      const scene = state.spatialScenes.find((item) => item.objects.some((object) => object.id === objectId));
      return { selectedSpatialObjectId: scene ? objectId : state.selectedSpatialObjectId };
    }),

  updateSpatialStage: (id, patch) =>
    set((state) => ({
      spatialStages: patchStage(state.spatialStages, id, patch, new Date().toISOString())
    })),

  removeSpatialStage: (id) =>
    set((state) => ({ spatialStages: deleteStage(state.spatialStages, id) })),

  hydrateFromSnapshot: (snapshot) =>
    set((state) => {
      const nextSequences = snapshot.sequences ?? state.sequences;
      const preferredSequenceId = snapshot.currentSequenceId ?? state.currentSequenceId;
      const safeCurrentSequenceId = nextSequences.some((seq) => seq.id === preferredSequenceId)
        ? preferredSequenceId
        : nextSequences[0]?.id ?? "";
      const nextProject = snapshot.project ?? state.project;
      const rawTransitionSeed = snapshot.shotTransitions ?? (snapshot.shots ? [] : state.shotTransitions);
      const normalizedShots = normalizeHydratedShotIdentities({
        shots: snapshot.shots ?? state.shots,
        transitions: rawTransitionSeed,
        currentSequenceId: safeCurrentSequenceId,
        selectedShotId: snapshot.selectedShotId ?? state.selectedShotId,
        selectedShotIds: snapshot.selectedShotIds ?? state.selectedShotIds,
        layers: snapshot.layers ?? state.layers,
        shotStrokes: snapshot.shotStrokes ?? state.shotStrokes,
        shotHistory: snapshot.shotHistory ?? state.shotHistory,
        activeLayerByShotId: snapshot.activeLayerByShotId ?? state.activeLayerByShotId,
        generationTasks: snapshot.generationTasks ?? state.generationTasks
      });
      const nextShots = normalizedShots.shots.map(withVideoProductionDefaults);
      const preferredShotTransitionId = snapshot.selectedShotTransitionId === undefined
        ? (snapshot.shots ? null : state.selectedShotTransitionId)
        : snapshot.selectedShotTransitionId;
      const normalizedBoundary = normalizeBoundaryTransitionIdentities(
        normalizedShots.transitions,
        preferredShotTransitionId,
        true
      );
      const nextShotTransitions = reconcileAllLinearTransitions(
        nextSequences,
        nextShots,
        nextProject.fps,
        normalizedBoundary.transitions
      );

      return {
        ...state,
        schemaVersion: snapshot.schemaVersion ?? state.schemaVersion,
        migrationBackupPending: snapshot.migrationBackupPending ?? state.migrationBackupPending,
        migrationBackupSource:
          snapshot.migrationBackupSource === undefined ? state.migrationBackupSource : snapshot.migrationBackupSource,
        directorPlan: snapshot.directorPlan === undefined ? state.directorPlan : snapshot.directorPlan,
        spatialScenes: snapshot.spatialScenes ?? state.spatialScenes,
        selectedSpatialObjectId:
          snapshot.selectedSpatialObjectId === undefined
            ? state.selectedSpatialObjectId
            : snapshot.selectedSpatialObjectId,
        spatialObjects: snapshot.spatialObjects ?? state.spatialObjects,
        poseKeyframes: snapshot.poseKeyframes ?? state.poseKeyframes,
        cameraPlans: snapshot.cameraPlans ?? state.cameraPlans,
        project: nextProject,
        sequences: nextSequences,
        currentSequenceId: safeCurrentSequenceId,
        shots: nextShots,
        shotTransitions: nextShotTransitions,
        selectedShotId: normalizedShots.selectedShotId,
        selectedShotIds: normalizedShots.selectedShotIds,
        selectedShotTransitionId: findUniqueTransitionById(
          nextShotTransitions,
          normalizedBoundary.selectedTransitionId
        )?.id ?? null,
        audioTracks: snapshot.audioTracks ?? state.audioTracks,
        assets: snapshot.assets ?? state.assets,
        canvasTool: snapshot.canvasTool ?? state.canvasTool,
        layers: normalizedShots.layers,
        activeLayerByShotId: normalizedShots.activeLayerByShotId,
        exportSettings: snapshot.exportSettings ?? state.exportSettings,
        shotStrokes: normalizedShots.shotStrokes,
        shotHistory: normalizedShots.shotHistory,
        shotSequenceHistory: { past: [], future: [] },
        generationTasks: normalizedShots.generationTasks,
        spatialStages: snapshot.spatialStages == null
          ? state.spatialStages
          : normalizeSceneStages(snapshot.spatialStages)
      };
    }),

  resetForNewProject: (name) =>
    set((state) => {
      const safeName = name.trim() || "Untitled Project";
      const now = new Date().toISOString();
      const projectId = `proj_${Date.now()}`;
      const sequenceId = `seq_${Date.now()}`;

      return {
        ...state,
        schemaVersion: 2,
        migrationBackupPending: false,
        migrationBackupSource: null,
        directorPlan: null,
        spatialScenes: [],
        selectedSpatialObjectId: null,
        spatialObjects: [],
        poseKeyframes: [],
        cameraPlans: [],
        project: {
          ...state.project,
          id: projectId,
          name: safeName,
          createdAt: now,
          updatedAt: now
        },
        sequences: [
          {
            id: sequenceId,
            projectId,
            name: "Sequence 01",
            order: 1
          }
        ],
        currentSequenceId: sequenceId,
        shots: [],
        shotTransitions: [],
        selectedShotId: "",
        selectedShotTransitionId: null,
        selectedShotIds: [],
        audioTracks: [],
        assets: [],
        playback: {
          currentFrame: 0,
          playing: false
        },
        layers: [],
        activeLayerByShotId: {},
        exportSettings: {
          width: state.project.width,
          height: state.project.height,
          fps: state.project.fps,
          videoBitrateKbps: 8000
        },
        shotStrokes: {},
        shotHistory: {},
        shotSequenceHistory: { past: [], future: [] },
        generationTasks: [],
        spatialStages: []
      };
    }),

  addShot: () =>
    set((state) => {
      const sequenceId = state.currentSequenceId || state.sequences[0]?.id;
      if (!sequenceId) return state;

      const scopedShots = state.shots.filter((shot) => shot.sequenceId === sequenceId);
      const scopedCount = scopedShots.length;
      const nextOrder = scopedCount + 1;
      const projectShotIds = new Set(state.shots.map((shot) => shot.id));
      const newShotId = allocateSafeId(
        "shot",
        sequenceId,
        `shot_${String(nextOrder).padStart(3, "0")}`,
        projectShotIds
      );
      const newShot: Shot = {
        id: newShotId,
        sequenceId,
        order: nextOrder,
        title: `镜头 ${nextOrder}`,
        durationFrames: 24,
        dialogue: "",
        notes: "",
        tags: []
      };

      const defaultLayerId = allocateSafeId(
        "layer",
        newShot.id,
        `layer_${newShot.id}_1`,
        new Set(state.layers.map((layer) => layer.id))
      );
      const defaultLayer: ShotLayer = {
        id: defaultLayerId,
        shotId: newShot.id,
        name: "图层 1",
        visible: true,
        locked: false,
        zIndex: 1,
        bitmapPath: `shots/${newShot.id}/${defaultLayerId}.png`
      };
      const nextShots = [...state.shots, newShot];
      const shotTransitions = reconcileTransitionSequences(
        state.shotTransitions,
        nextShots,
        state.project.fps,
        [sequenceId]
      );

      return {
        shots: nextShots,
        shotTransitions,
        layers: [...state.layers, defaultLayer],
        activeLayerByShotId: {
          ...state.activeLayerByShotId,
          [newShot.id]: defaultLayerId
        },
        selectedShotId: newShot.id,
        selectedShotTransitionId: findUniqueTransitionById(
          shotTransitions,
          state.selectedShotTransitionId
        )?.id ?? null,
        selectedShotIds: [newShot.id]
      };
    }),

  togglePlayback: () =>
    set((state) => ({
      playback: {
        ...state.playback,
        playing: !state.playback.playing
      }
    }))
}));

export const selectSelectedShot = (state: StoryboardState): Shot | undefined =>
  state.shots.find((shot) => shot.id === state.selectedShotId);

export const selectShotsForCurrentSequence = (state: StoryboardState): Shot[] =>
  state.shots
    .filter((shot) => shot.sequenceId === state.currentSequenceId)
    .sort((a, b) => a.order - b.order);

export const selectFilteredShotsForCurrentSequence = (state: StoryboardState): Shot[] => {
  const base = selectShotsForCurrentSequence(state);
  const query = state.shotFilterQuery.trim().toLowerCase();
  const tag = state.shotFilterTag.trim().toLowerCase();
  return base.filter((shot) => {
    const matchedQuery =
      query.length === 0 ||
      shot.title.toLowerCase().includes(query) ||
      shot.notes.toLowerCase().includes(query) ||
      shot.dialogue.toLowerCase().includes(query);
    const matchedTag =
      tag.length === 0 || shot.tags.some((item) => item.toLowerCase() === tag);
    return matchedQuery && matchedTag;
  });
};

export const selectAvailableShotTagsForCurrentSequence = (
  state: StoryboardState
): string[] => {
  const tags = new Set<string>();
  for (const shot of selectShotsForCurrentSequence(state)) {
    for (const tag of shot.tags) {
      const normalized = tag.trim();
      if (normalized) tags.add(normalized);
    }
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
};

export const selectSelectedShotStrokes = (state: StoryboardState): Stroke[] =>
  state.shotStrokes[state.selectedShotId] ?? [];

export const selectSelectedShotLayers = (state: StoryboardState): ShotLayer[] =>
  state.layers
    .filter((layer) => layer.shotId === state.selectedShotId)
    .sort((a, b) => a.zIndex - b.zIndex);

export const selectActiveLayerIdForSelectedShot = (
  state: StoryboardState
): string | undefined => {
  const configured = state.activeLayerByShotId[state.selectedShotId];
  if (configured) return configured;
  const first = state.layers.find((layer) => layer.shotId === state.selectedShotId);
  return first?.id;
};

export const selectTimelineFrames = (state: StoryboardState): number =>
  selectFilteredShotsForCurrentSequence(state).reduce((sum, shot) => sum + shot.durationFrames, 0);

export const selectShotStartFrame = (
  state: StoryboardState,
  shotId: string
): number => {
  let frame = 0;
  const scoped = selectFilteredShotsForCurrentSequence(state);
  for (const shot of scoped) {
    if (shot.id === shotId) return frame;
    frame += shot.durationFrames;
  }
  return frame;
};
