export type DesktopSnapshotSyncBaseline = {
  workspacePath: string;
  snapshotFingerprint: string;
};

export function choosePreferredDesktopSnapshot<T extends Record<string, any>>(
  desktopSnapshot: T | null,
  autosaveSnapshot: T | null
): T | null {
  if (!desktopSnapshot) return autosaveSnapshot;
  if (!autosaveSnapshot) return desktopSnapshot;
  if ((desktopSnapshot.project?.id ?? "") !== (autosaveSnapshot.project?.id ?? "")) return desktopSnapshot;
  const score = (snapshot: T) => {
    const assetScore = (snapshot.assets ?? []).reduce((sum: number, asset: any) => sum +
      ((asset?.filePath?.trim() || "").length > 0 ? 2 : 0) +
      ((asset?.characterFrontPath?.trim() || "").length > 0 ? 3 : 0) +
      ((asset?.characterSidePath?.trim() || "").length > 0 ? 4 : 0) +
      ((asset?.characterBackPath?.trim() || "").length > 0 ? 4 : 0) +
      ((asset?.characterFaceRefPath?.trim() || "").length > 0 ? 2 : 0) +
      ((asset?.characterDetailRefPath?.trim() || "").length > 0 ? 2 : 0) +
      ((asset?.skyboxFaces?.front?.trim() || "").length > 0 ? 3 : 0), 0);
    const shotScore = (snapshot.shots ?? []).reduce((sum: number, shot: any) => sum +
      ((shot?.generatedImagePath?.trim() || "").length > 0 ? 5 : 0) +
      ((shot?.generatedVideoPath?.trim() || "").length > 0 ? 6 : 0) +
      ((shot?.characterRefs?.length ?? 0) > 0 ? 1 : 0) +
      ((shot?.sceneRefId?.trim() || "").length > 0 ? 1 : 0), 0);
    return assetScore * 10 + shotScore;
  };
  const preferred = score(autosaveSnapshot) >= score(desktopSnapshot) ? autosaveSnapshot : desktopSnapshot;
  if (!desktopSnapshot.migrationBackupPending) return preferred;
  return {
    ...preferred,
    migrationBackupPending: true,
    migrationBackupSource: desktopSnapshot.migrationBackupSource ?? preferred.migrationBackupSource
  };
}

export type DesktopSnapshotSyncState = {
  phase: "disabled" | "transitioning" | "synced" | "unsynced" | "blocked";
  workspacePath: string;
  baseline: DesktopSnapshotSyncBaseline | null;
  workspaceToken: number;
};

export type DesktopSnapshotSaveSubmission<TSnapshot = unknown> = {
  workspacePath: string;
  workspaceToken: number;
  snapshot: TSnapshot;
};

export type DesktopSnapshotSaveResult<TSnapshot = unknown> =
  | {
      status: "completed";
      savedPath: string | null;
      submission: DesktopSnapshotSaveSubmission<TSnapshot>;
    }
  | {
      status: "cancelled";
      savedPath: null;
      submission: DesktopSnapshotSaveSubmission<TSnapshot>;
    };

export type DesktopSnapshotSaveCoordinator<TSnapshot> = {
  activateWorkspace: (workspacePath: string, workspaceToken: number) => void;
  save: (
    submission: DesktopSnapshotSaveSubmission<TSnapshot>
  ) => Promise<DesktopSnapshotSaveResult<TSnapshot>>;
};

type DesktopSnapshotSaveWaiter<TSnapshot> = {
  resolve: (result: DesktopSnapshotSaveResult<TSnapshot>) => void;
  reject: (error: unknown) => void;
};

type DesktopSnapshotSaveJob<TSnapshot> = {
  submission: DesktopSnapshotSaveSubmission<TSnapshot>;
  snapshotFingerprint: string;
  waiters: DesktopSnapshotSaveWaiter<TSnapshot>[];
};

function desktopSnapshotWorkspaceKey(workspacePath: string, workspaceToken: number): string {
  return `${workspaceToken}:${workspacePath}`;
}

export function createDesktopSnapshotSaveCoordinator<TSnapshot>(
  writer: (snapshot: TSnapshot) => Promise<string | null>
): DesktopSnapshotSaveCoordinator<TSnapshot> {
  let activeWorkspaceKey = "";
  let inFlight: DesktopSnapshotSaveJob<TSnapshot> | null = null;
  let queued: DesktopSnapshotSaveJob<TSnapshot> | null = null;

  const cancelJob = (job: DesktopSnapshotSaveJob<TSnapshot>) => {
    const result: DesktopSnapshotSaveResult<TSnapshot> = {
      status: "cancelled",
      savedPath: null,
      submission: job.submission
    };
    for (const waiter of job.waiters) waiter.resolve(result);
  };

  const runNext = () => {
    if (inFlight || !queued) return;
    const job = queued;
    queued = null;
    if (
      desktopSnapshotWorkspaceKey(
        job.submission.workspacePath,
        job.submission.workspaceToken
      ) !== activeWorkspaceKey
    ) {
      cancelJob(job);
      runNext();
      return;
    }
    inFlight = job;
    void Promise.resolve()
      .then(() => writer(job.submission.snapshot))
      .then((savedPath) => {
        const result: DesktopSnapshotSaveResult<TSnapshot> = {
          status: "completed",
          savedPath,
          submission: job.submission
        };
        for (const waiter of job.waiters) waiter.resolve(result);
      })
      .catch((error) => {
        for (const waiter of job.waiters) waiter.reject(error);
      })
      .finally(() => {
        if (inFlight === job) inFlight = null;
        runNext();
      });
  };

  return {
    activateWorkspace(workspacePath: string, workspaceToken: number) {
      activeWorkspaceKey = desktopSnapshotWorkspaceKey(workspacePath, workspaceToken);
      if (
        queued &&
        desktopSnapshotWorkspaceKey(
          queued.submission.workspacePath,
          queued.submission.workspaceToken
        ) !== activeWorkspaceKey
      ) {
        const staleJob = queued;
        queued = null;
        cancelJob(staleJob);
      }
    },
    save(
      submission: DesktopSnapshotSaveSubmission<TSnapshot>
    ): Promise<DesktopSnapshotSaveResult<TSnapshot>> {
      const workspaceKey = desktopSnapshotWorkspaceKey(
        submission.workspacePath,
        submission.workspaceToken
      );
      if (workspaceKey !== activeWorkspaceKey) {
        return Promise.resolve({ status: "cancelled", savedPath: null, submission });
      }

      const snapshotFingerprint = JSON.stringify(submission.snapshot);
      return new Promise<DesktopSnapshotSaveResult<TSnapshot>>((resolve, reject) => {
        const waiter = { resolve, reject };
        if (queued) {
          if (
            desktopSnapshotWorkspaceKey(
              queued.submission.workspacePath,
              queued.submission.workspaceToken
            ) === workspaceKey &&
            queued.snapshotFingerprint === snapshotFingerprint
          ) {
            queued.waiters.push(waiter);
          } else {
            queued.submission = submission;
            queued.snapshotFingerprint = snapshotFingerprint;
            queued.waiters.push(waiter);
          }
          return;
        }
        if (
          inFlight &&
          desktopSnapshotWorkspaceKey(
            inFlight.submission.workspacePath,
            inFlight.submission.workspaceToken
          ) === workspaceKey &&
          inFlight.snapshotFingerprint === snapshotFingerprint
        ) {
          inFlight.waiters.push(waiter);
          return;
        }
        queued = { submission, snapshotFingerprint, waiters: [waiter] };
        runNext();
      });
    }
  };
}

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
