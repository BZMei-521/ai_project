import { create } from "zustand";
import type { CameraPlan, SpatialScene } from "../../domains/spatial-scene/types";

export type SpatialPreviewTool = "select" | "translate" | "rotate" | "scale";

export type SpatialPreviewStoreState = {
  selectedObjectId: string | null;
  activeTool: SpatialPreviewTool;
  undoStack: SpatialScene[];
  redoStack: SpatialScene[];
  cameraPlan: CameraPlan | null;
  isDirty: boolean;
  setSelection: (selectedObjectId: string | null) => void;
  setActiveTool: (activeTool: SpatialPreviewTool) => void;
  setCameraPlan: (cameraPlan: CameraPlan | null) => void;
  recordScene: (scene: SpatialScene) => void;
  undo: () => SpatialScene | null;
  redo: () => SpatialScene | null;
  markClean: () => void;
  reset: () => void;
};

const initialState = {
  selectedObjectId: null,
  activeTool: "select" as SpatialPreviewTool,
  undoStack: [] as SpatialScene[],
  redoStack: [] as SpatialScene[],
  cameraPlan: null as CameraPlan | null,
  isDirty: false
};

export const useSpatialPreviewStore = create<SpatialPreviewStoreState>((set, get) => ({
  ...initialState,
  setSelection: (selectedObjectId) => set({ selectedObjectId }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setCameraPlan: (cameraPlan) => set({ cameraPlan, isDirty: true }),
  recordScene: (scene) => set((state) => ({
    undoStack: [...state.undoStack, scene].slice(-50),
    redoStack: [],
    cameraPlan: scene.camera,
    isDirty: true
  })),
  undo: () => {
    const state = get();
    const previous = state.undoStack.length > 0 ? state.undoStack[state.undoStack.length - 1] : null;
    if (!previous) return null;
    set({ undoStack: state.undoStack.slice(0, -1), redoStack: [...state.redoStack, previous], cameraPlan: previous.camera, isDirty: true });
    return previous;
  },
  redo: () => {
    const state = get();
    const next = state.redoStack.length > 0 ? state.redoStack[state.redoStack.length - 1] : null;
    if (!next) return null;
    set({ redoStack: state.redoStack.slice(0, -1), undoStack: [...state.undoStack, next], cameraPlan: next.camera, isDirty: true });
    return next;
  },
  markClean: () => set({ isDirty: false }),
  reset: () => set(initialState)
}));
