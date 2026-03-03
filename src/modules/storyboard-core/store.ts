import { create } from "zustand";
import { audioTracks, assets, layers, project, sequences, shots } from "./mockData";
import type { AudioTrack, Asset, Project, Sequence, Shot, ShotLayer, SkyboxFace, SkyboxUpdateEvent } from "./types";

export type ImportedShotScriptItem = {
  id?: string;
  title: string;
  prompt: string;
  negativePrompt?: string;
  videoPrompt?: string;
  videoMode?: "auto" | "single_frame" | "first_last_frame";
  videoStartFramePath?: string;
  videoEndFramePath?: string;
  skyboxFace?: "auto" | SkyboxFace;
  skyboxFaces?: SkyboxFace[];
  skyboxFaceWeights?: Partial<Record<SkyboxFace, number>>;
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

export type ExportSettings = {
  width: number;
  height: number;
  fps: number;
  videoBitrateKbps: number;
};

type StoryboardState = {
  project: Project;
  sequences: Sequence[];
  currentSequenceId: string;
  shots: Shot[];
  layers: ShotLayer[];
  assets: Asset[];
  audioTracks: AudioTrack[];
  selectedShotId: string;
  playback: PlaybackState;
  canvasTool: CanvasToolState;
  exportSettings: ExportSettings;
  shotStrokes: Record<string, Stroke[]>;
  shotHistory: Record<string, CanvasHistoryState>;
  activeLayerByShotId: Record<string, string>;
  selectedShotIds: string[];
  shotFilterQuery: string;
  shotFilterTag: string;
  selectShot: (shotId: string) => void;
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
        | "skyboxFace"
        | "skyboxFaces"
        | "skyboxFaceWeights"
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
  hydrateFromSnapshot: (snapshot: Partial<StoryboardSnapshot>) => void;
  resetForNewProject: (name: string) => void;
  addShot: () => void;
  togglePlayback: () => void;
};

export type StoryboardSnapshot = Pick<
  StoryboardState,
  | "project"
  | "sequences"
  | "currentSequenceId"
  | "shots"
  | "selectedShotId"
  | "audioTracks"
  | "assets"
  | "canvasTool"
  | "layers"
  | "activeLayerByShotId"
  | "exportSettings"
  | "shotStrokes"
  | "shotHistory"
>;

export const useStoryboardStore = create<StoryboardState>((set, get) => ({
  project,
  sequences,
  currentSequenceId: sequences[0]?.id ?? "",
  shots,
  layers,
  assets,
  audioTracks,
  selectedShotId: shots[0]?.id ?? "",
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
  activeLayerByShotId: {},
  selectedShotIds: [],
  shotFilterQuery: "",
  shotFilterTag: "",

  selectShot: (shotId) =>
    set((state) => ({
      selectedShotId: shotId,
      selectedShotIds: state.selectedShotIds.includes(shotId)
        ? state.selectedShotIds
        : [...state.selectedShotIds, shotId]
    })),

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
      return {
        currentSequenceId: sequenceId,
        selectedShotId: firstShot?.id ?? "",
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
      const duplicatedSequenceId = `seq_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const duplicatedShots: Shot[] = scopedShots.map((shot, index) => {
        const newShotId = `shot_${Date.now()}_${index}_${Math.floor(Math.random() * 1000)}`;
        shotIdMap.set(shot.id, newShotId);
        return {
          ...shot,
          id: newShotId,
          sequenceId: duplicatedSequenceId
        };
      });

      const layerIdMap = new Map<string, string>();
      const duplicatedLayers: ShotLayer[] = state.layers
        .filter((layer) => shotIdMap.has(layer.shotId))
        .map((layer, index) => {
          const mappedShotId = shotIdMap.get(layer.shotId) ?? layer.shotId;
          const newLayerId = `layer_${mappedShotId}_${index + 1}`;
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

      return {
        sequences: normalizedSequences,
        currentSequenceId: duplicatedSequenceId,
        shots: [...state.shots, ...duplicatedShots],
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

      return {
        sequences: nextSequences,
        currentSequenceId: nextCurrentSequenceId,
        shots: nextShots,
        layers: nextLayers,
        shotStrokes: nextShotStrokes,
        shotHistory: nextShotHistory,
        activeLayerByShotId: nextActiveLayerByShotId,
        selectedShotId: nextSelectedShotId,
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
      const scoped = state.shots
        .filter((shot) => shot.sequenceId === state.currentSequenceId)
        .sort((a, b) => a.order - b.order);
      const index = scoped.findIndex((shot) => shot.id === shotId);
      if (index < 0) return state;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= scoped.length) return state;

      const nextShots = [...scoped];
      const [moved] = nextShots.splice(index, 1);
      nextShots.splice(targetIndex, 0, moved);
      const normalizedScoped = nextShots.map((shot, orderIndex) => ({
        ...shot,
        order: orderIndex + 1
      }));
      const normalizedById = new Map(normalizedScoped.map((shot) => [shot.id, shot]));

      return {
        shots: state.shots.map((shot) => normalizedById.get(shot.id) ?? shot)
      };
    }),

  moveShotToIndex: (shotId, targetIndex) =>
    set((state) => {
      const scoped = state.shots
        .filter((shot) => shot.sequenceId === state.currentSequenceId)
        .sort((a, b) => a.order - b.order);
      const sourceIndex = scoped.findIndex((shot) => shot.id === shotId);
      if (sourceIndex < 0) return state;
      const boundedTarget = Math.max(0, Math.min(targetIndex, scoped.length - 1));
      if (sourceIndex === boundedTarget) return state;

      const nextShots = [...scoped];
      const [moved] = nextShots.splice(sourceIndex, 1);
      nextShots.splice(boundedTarget, 0, moved);
      const normalizedScoped = nextShots.map((shot, orderIndex) => ({
        ...shot,
        order: orderIndex + 1
      }));
      const normalizedById = new Map(normalizedScoped.map((shot) => [shot.id, shot]));

      return {
        shots: state.shots.map((shot) => normalizedById.get(shot.id) ?? shot)
      };
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
      const normalizedById = new Map(normalizedScoped.map((shot) => [shot.id, shot]));

      return {
        shots: state.shots.map((shot) => normalizedById.get(shot.id) ?? shot)
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
      const voiceProfile = input.voiceProfile?.trim() ?? "";
      const skyboxDescription = input.skyboxDescription?.trim() ?? "";
      const skyboxTags = (input.skyboxTags ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
      const skyboxFaces = input.skyboxFaces ?? {};
      if (input.type === "character" && (!front || !side || !back)) return state;
      const asset: Asset = {
        id: `asset_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        projectId: state.project.id,
        type: input.type,
        name,
        filePath,
        characterFrontPath: input.type === "character" ? front : undefined,
        characterSidePath: input.type === "character" ? side : undefined,
        characterBackPath: input.type === "character" ? back : undefined,
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
          ? {
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
            }
          : asset
      )
    })),

  removeAsset: (assetId) =>
    set((state) => ({
      assets: state.assets.filter((asset) => asset.id !== assetId),
      shots: state.shots.map((shot) => ({
        ...shot,
        characterRefs: (shot.characterRefs ?? []).filter((item) => item !== assetId)
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
          characterRefs: exists ? refs.filter((item) => item !== characterAssetId) : [...refs, characterAssetId]
        };
      })
    })),

  updateShotFields: (shotId, patch) =>
    set((state) => ({
      shots: state.shots.map((shot) =>
        shot.id === shotId
          ? {
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
              skyboxFace: patch.skyboxFace ?? shot.skyboxFace,
              skyboxFaces: patch.skyboxFaces ?? shot.skyboxFaces,
              skyboxFaceWeights: patch.skyboxFaceWeights ?? shot.skyboxFaceWeights,
              seed: patch.seed ?? shot.seed,
              characterRefs: patch.characterRefs ?? shot.characterRefs,
              sceneRefId: patch.sceneRefId ?? shot.sceneRefId,
              sourceCharacterNames: patch.sourceCharacterNames ?? shot.sourceCharacterNames,
              sourceSceneName: patch.sourceSceneName ?? shot.sourceSceneName,
              sourceScenePrompt: patch.sourceScenePrompt ?? shot.sourceScenePrompt,
              generatedImagePath: patch.generatedImagePath ?? shot.generatedImagePath,
              generatedVideoPath: patch.generatedVideoPath ?? shot.generatedVideoPath
            }
          : shot
      )
    })),

  replaceShotsForCurrentSequence: (items) =>
    set((state) => {
      const sequenceId = state.currentSequenceId || state.sequences[0]?.id;
      if (!sequenceId) return state;
      const safeItems = items.filter((item) => item.title.trim().length > 0 && item.prompt.trim().length > 0);
      if (safeItems.length === 0) return state;

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
      const fps = Math.max(1, state.project.fps);

      safeItems.forEach((item, index) => {
        const shotId = item.id?.trim() || `shot_${Date.now()}_${index + 1}_${Math.floor(Math.random() * 1000)}`;
        const durationFrames = item.durationFrames && Number.isFinite(item.durationFrames)
          ? Math.max(1, Math.round(item.durationFrames))
          : Math.max(1, Math.round((item.durationSec ?? 2) * fps));
        const layerId = `layer_${shotId}_1`;

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
          seed: item.seed,
          characterRefs: item.characterRefs ?? [],
          sceneRefId: item.sceneRefId ?? "",
          sourceCharacterNames: item.sourceCharacterNames ?? [],
          sourceSceneName: item.sourceSceneName ?? "",
          sourceScenePrompt: item.sourceScenePrompt ?? "",
          generatedImagePath: "",
          generatedVideoPath: ""
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

      return {
        shots: [...baseShots, ...nextShots],
        layers: [...baseLayers, ...nextLayers],
        shotStrokes: nextShotStrokes,
        shotHistory: nextShotHistory,
        activeLayerByShotId: nextActiveLayerByShotId,
        selectedShotId: nextShots[0]?.id ?? "",
        selectedShotIds: nextShots[0]?.id ? [nextShots[0].id] : []
      };
    }),

  batchSetDurationForSelectedShots: (durationFrames) =>
    set((state) => {
      const selected = new Set(state.selectedShotIds);
      if (selected.size === 0) return state;
      const safeDuration = Math.max(1, Math.round(durationFrames));
      return {
        shots: state.shots.map((shot) =>
          selected.has(shot.id) ? { ...shot, durationFrames: safeDuration } : shot
        )
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
      return {
        project: {
          ...state.project,
          name: settings.name?.trim() || state.project.name,
          fps: settings.fps ? Math.max(1, Math.round(settings.fps)) : state.project.fps,
          width: settings.width ? Math.max(320, Math.round(settings.width)) : state.project.width,
          height: settings.height ? Math.max(240, Math.round(settings.height)) : state.project.height,
          updatedAt: now
        }
      };
    }),

  setShotDuration: (shotId, durationFrames) =>
    set((state) => ({
      shots: state.shots.map((shot) =>
        shot.id === shotId
          ? { ...shot, durationFrames: Math.max(1, durationFrames) }
          : shot
      )
    })),

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
      const newLayerId = `layer_${Date.now()}`;
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

      const newShotId = `shot_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const duplicate: Shot = {
        ...source,
        id: newShotId,
        title: `${source.title} Copy`
      };

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
      const copiedLayers: ShotLayer[] = sourceLayers.map((layer, index) => {
        const newLayerId = `layer_${newShotId}_${index + 1}`;
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
        layers: nextLayers,
        shotStrokes: nextShotStrokes,
        shotHistory: nextShotHistory,
        activeLayerByShotId: nextActiveLayerByShotId,
        selectedShotId: nextSelectedShotId,
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
        layers: nextLayers,
        shotStrokes: nextShotStrokes,
        shotHistory: nextShotHistory,
        activeLayerByShotId: nextActiveLayerByShotId,
        selectedShotId: nextSelectedShotId,
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

  hydrateFromSnapshot: (snapshot) =>
    set((state) => {
      const nextSequences = snapshot.sequences ?? state.sequences;
      const preferredSequenceId = snapshot.currentSequenceId ?? state.currentSequenceId;
      const safeCurrentSequenceId = nextSequences.some((seq) => seq.id === preferredSequenceId)
        ? preferredSequenceId
        : nextSequences[0]?.id ?? "";

      return {
        ...state,
        project: snapshot.project ?? state.project,
        sequences: nextSequences,
        currentSequenceId: safeCurrentSequenceId,
        shots: snapshot.shots ?? state.shots,
        selectedShotId: snapshot.selectedShotId ?? state.selectedShotId,
        audioTracks: snapshot.audioTracks ?? state.audioTracks,
        assets: snapshot.assets ?? state.assets,
        canvasTool: snapshot.canvasTool ?? state.canvasTool,
        layers: snapshot.layers ?? state.layers,
        activeLayerByShotId: snapshot.activeLayerByShotId ?? state.activeLayerByShotId,
        exportSettings: snapshot.exportSettings ?? state.exportSettings,
        shotStrokes: snapshot.shotStrokes ?? state.shotStrokes,
        shotHistory: snapshot.shotHistory ?? state.shotHistory
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
        selectedShotId: "",
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
        shotHistory: {}
      };
    }),

  addShot: () =>
    set((state) => {
      const sequenceId = state.currentSequenceId || state.sequences[0]?.id;
      if (!sequenceId) return state;

      const scopedCount = state.shots.filter((shot) => shot.sequenceId === sequenceId).length;
      const nextOrder = scopedCount + 1;
      const newShot: Shot = {
        id: `shot_${String(nextOrder).padStart(3, "0")}`,
        sequenceId,
        order: nextOrder,
        title: `镜头 ${nextOrder}`,
        durationFrames: 24,
        dialogue: "",
        notes: "",
        tags: []
      };

      const defaultLayerId = `layer_${newShot.id}_1`;
      const defaultLayer: ShotLayer = {
        id: defaultLayerId,
        shotId: newShot.id,
        name: "图层 1",
        visible: true,
        locked: false,
        zIndex: 1,
        bitmapPath: `shots/${newShot.id}/${defaultLayerId}.png`
      };

      return {
        shots: [...state.shots, newShot],
        layers: [...state.layers, defaultLayer],
        activeLayerByShotId: {
          ...state.activeLayerByShotId,
          [newShot.id]: defaultLayerId
        },
        selectedShotId: newShot.id,
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
