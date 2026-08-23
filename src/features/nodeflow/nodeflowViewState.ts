import type { DirectorNodeId, DirectorNodeViewState } from "./nodeflowContracts";

export const DEFAULT_NODEFLOW_VIEW_STATE: DirectorNodeViewState = {
  selectedNodeId: "script",
  collapsedNodeIds: [],
  panX: 0,
  panY: 0,
  zoom: 1
};

const STORAGE_KEY = "graybean/director-nodeflow/view-state/v1";

export function serializeNodeflowViewState(state: DirectorNodeViewState): string {
  return JSON.stringify({
    selectedNodeId: state.selectedNodeId,
    collapsedNodeIds: state.collapsedNodeIds,
    panX: state.panX,
    panY: state.panY,
    zoom: state.zoom
  });
}

export function restoreNodeflowViewState(raw: string | null | undefined): DirectorNodeViewState {
  if (!raw) return { ...DEFAULT_NODEFLOW_VIEW_STATE, collapsedNodeIds: [] };
  try {
    const value = JSON.parse(raw) as Partial<DirectorNodeViewState>;
    const selectedNodeId = ["script", "assets", "preview", "storyboard", "production"].includes(String(value.selectedNodeId))
      ? value.selectedNodeId as DirectorNodeId
      : DEFAULT_NODEFLOW_VIEW_STATE.selectedNodeId;
    const collapsedNodeIds = Array.isArray(value.collapsedNodeIds)
      ? value.collapsedNodeIds.filter((id): id is DirectorNodeId => ["script", "assets", "preview", "storyboard", "production"].includes(String(id)))
      : [];
    return {
      selectedNodeId,
      collapsedNodeIds,
      panX: Number.isFinite(value.panX) ? Number(value.panX) : 0,
      panY: Number.isFinite(value.panY) ? Number(value.panY) : 0,
      zoom: Number.isFinite(value.zoom) ? Math.min(1.35, Math.max(0.72, Number(value.zoom))) : 1
    };
  } catch {
    return { ...DEFAULT_NODEFLOW_VIEW_STATE, collapsedNodeIds: [] };
  }
}

export function loadNodeflowViewState(): DirectorNodeViewState {
  if (typeof window === "undefined") return { ...DEFAULT_NODEFLOW_VIEW_STATE, collapsedNodeIds: [] };
  return restoreNodeflowViewState(window.localStorage.getItem(STORAGE_KEY));
}

export function persistNodeflowViewState(state: DirectorNodeViewState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, serializeNodeflowViewState(state));
}
