export type DesktopSnapshotSyncBaseline = {
  workspacePath: string;
  snapshotFingerprint: string;
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

export function shouldSaveDesktopSnapshot(input: {
  workspacePath: string;
  syncReady: boolean;
  snapshot: unknown;
  baseline: DesktopSnapshotSyncBaseline | null;
}): boolean {
  if (!input.workspacePath || !input.syncReady || !input.baseline) return false;
  if (input.baseline.workspacePath !== input.workspacePath) return false;
  return input.baseline.snapshotFingerprint !== JSON.stringify(input.snapshot);
}
