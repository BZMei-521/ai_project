export type DesktopSnapshotSyncBaseline = {
  workspacePath: string;
  snapshotFingerprint: string;
};

export type DesktopSnapshotSyncState = {
  phase: "disabled" | "transitioning" | "synced" | "unsynced" | "blocked";
  workspacePath: string;
  baseline: DesktopSnapshotSyncBaseline | null;
  revision: number;
};

export function createDesktopSnapshotSyncBaseline(
  workspacePath: string,
  snapshot: unknown
): DesktopSnapshotSyncBaseline {
  return {
    workspacePath,
    snapshotFingerprint: JSON.stringify(snapshot)
  };
}

export function createDesktopSnapshotSyncState(
  workspacePath = "",
  snapshot?: unknown
): DesktopSnapshotSyncState {
  return workspacePath && snapshot !== undefined
    ? {
        phase: "synced",
        workspacePath,
        baseline: createDesktopSnapshotSyncBaseline(workspacePath, snapshot),
        revision: 0
      }
    : { phase: "disabled", workspacePath, baseline: null, revision: 0 };
}

export function beginDesktopSnapshotSyncTransition(
  state: DesktopSnapshotSyncState
): DesktopSnapshotSyncState {
  return { ...state, phase: "transitioning", revision: state.revision + 1 };
}

export function restoreDesktopSnapshotSyncState(
  transitionState: DesktopSnapshotSyncState,
  previousState: DesktopSnapshotSyncState
): DesktopSnapshotSyncState {
  return { ...previousState, revision: transitionState.revision + 1 };
}

export function markDesktopSnapshotSynced(
  state: DesktopSnapshotSyncState,
  workspacePath: string,
  snapshot: unknown
): DesktopSnapshotSyncState {
  return {
    phase: "synced",
    workspacePath,
    baseline: createDesktopSnapshotSyncBaseline(workspacePath, snapshot),
    revision: state.revision + 1
  };
}

export function markDesktopSnapshotUnsynced(
  state: DesktopSnapshotSyncState,
  workspacePath: string
): DesktopSnapshotSyncState {
  return {
    phase: "unsynced",
    workspacePath,
    baseline: null,
    revision: state.revision + 1
  };
}

export function blockDesktopSnapshotSync(
  state: DesktopSnapshotSyncState,
  workspacePath: string
): DesktopSnapshotSyncState {
  return {
    phase: "blocked",
    workspacePath,
    baseline: null,
    revision: state.revision + 1
  };
}

export function disableDesktopSnapshotSync(
  state: DesktopSnapshotSyncState
): DesktopSnapshotSyncState {
  return {
    phase: "disabled",
    workspacePath: "",
    baseline: null,
    revision: state.revision + 1
  };
}

export function shouldScheduleDesktopSnapshotSave(input: {
  state: DesktopSnapshotSyncState;
  workspacePath: string;
  snapshot: unknown;
  scheduledRevision?: number;
}): boolean {
  if (input.scheduledRevision !== undefined && input.scheduledRevision !== input.state.revision) {
    return false;
  }
  if (input.state.workspacePath !== input.workspacePath) return false;
  if (input.state.phase === "unsynced") return true;
  if (input.state.phase !== "synced" || !input.state.baseline) return false;
  return input.state.baseline.snapshotFingerprint !== JSON.stringify(input.snapshot);
}
