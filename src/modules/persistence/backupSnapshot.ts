import type { StoryboardSnapshot } from "../storyboard-core/store";

type SnapshotBackupFile = {
  schemaVersion: number;
  exportedAt: string;
  snapshot: StoryboardSnapshot;
};

const SNAPSHOT_BACKUP_SCHEMA_VERSION = 1;

export function createSnapshotBackup(snapshot: StoryboardSnapshot): SnapshotBackupFile {
  return {
    schemaVersion: SNAPSHOT_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    snapshot
  };
}

export function parseSnapshotBackup(raw: string): StoryboardSnapshot {
  const parsed = JSON.parse(raw) as Partial<SnapshotBackupFile>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid backup file");
  }
  if (parsed.schemaVersion !== SNAPSHOT_BACKUP_SCHEMA_VERSION) {
    throw new Error(`Unsupported backup schema: ${String(parsed.schemaVersion)}`);
  }
  if (!parsed.snapshot || typeof parsed.snapshot !== "object") {
    throw new Error("Missing snapshot payload");
  }

  const snapshot = parsed.snapshot as Partial<StoryboardSnapshot>;
  if (!snapshot.project || !snapshot.shots || !snapshot.sequences) {
    throw new Error("Incomplete snapshot payload");
  }

  return snapshot as StoryboardSnapshot;
}
