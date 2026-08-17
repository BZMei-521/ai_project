export type DesktopSnapshotSyncBaseline = {
  workspacePath: string;
  snapshotFingerprint: string;
};

export type DesktopSnapshotSyncState = {
  phase: "disabled" | "transitioning" | "synced" | "unsynced" | "blocked";
  workspacePath: string;
  baseline: DesktopSnapshotSyncBaseline | null;
  workspaceToken: number;
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
        workspaceToken: 0
      }
    : { phase: "disabled", workspacePath, baseline: null, workspaceToken: 0 };
}

export function beginDesktopSnapshotSyncTransition(
  state: DesktopSnapshotSyncState
): DesktopSnapshotSyncState {
  return { ...state, phase: "transitioning", workspaceToken: state.workspaceToken + 1 };
}

export function restoreDesktopSnapshotSyncState(
  transitionState: DesktopSnapshotSyncState,
  previousState: DesktopSnapshotSyncState
): DesktopSnapshotSyncState {
  return { ...previousState, workspaceToken: transitionState.workspaceToken };
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
    workspaceToken: state.workspaceToken
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
    workspaceToken: state.workspaceToken
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
    workspaceToken: state.workspaceToken
  };
}

export function completeDesktopSnapshotLoad(
  state: DesktopSnapshotSyncState,
  workspacePath: string,
  hydratedSnapshot: unknown | null
): DesktopSnapshotSyncState {
  return hydratedSnapshot === null
    ? blockDesktopSnapshotSync(state, workspacePath)
    : markDesktopSnapshotSynced(state, workspacePath, hydratedSnapshot);
}

export function disableDesktopSnapshotSync(
  state: DesktopSnapshotSyncState
): DesktopSnapshotSyncState {
  return {
    phase: "disabled",
    workspacePath: "",
    baseline: null,
    workspaceToken: state.workspaceToken + 1
  };
}

export function shouldScheduleDesktopSnapshotSave(input: {
  state: DesktopSnapshotSyncState;
  workspacePath: string;
  snapshot: unknown;
  scheduledWorkspaceToken?: number;
}): boolean {
  if (
    input.scheduledWorkspaceToken !== undefined &&
    input.scheduledWorkspaceToken !== input.state.workspaceToken
  ) {
    return false;
  }
  if (input.state.workspacePath !== input.workspacePath) return false;
  if (input.state.phase === "unsynced") return true;
  if (input.state.phase !== "synced" || !input.state.baseline) return false;
  return input.state.baseline.snapshotFingerprint !== JSON.stringify(input.snapshot);
}

export function canManuallySaveDesktopSnapshot(
  state: DesktopSnapshotSyncState,
  workspacePath: string
): boolean {
  return (
    state.workspacePath === workspacePath &&
    (state.phase === "synced" || state.phase === "unsynced")
  );
}

export function completeDesktopSnapshotSave(
  state: DesktopSnapshotSyncState,
  input: {
    workspacePath: string;
    workspaceToken: number;
    submittedSnapshot: unknown;
  }
): DesktopSnapshotSyncState {
  if (
    state.workspacePath !== input.workspacePath ||
    state.workspaceToken !== input.workspaceToken ||
    (state.phase !== "synced" && state.phase !== "unsynced")
  ) {
    return state;
  }
  return markDesktopSnapshotSynced(state, input.workspacePath, input.submittedSnapshot);
}
