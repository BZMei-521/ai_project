import type { StoryboardSnapshot } from "../storyboard-core/store";

type SnapshotBackupFile = {
  schemaVersion: number;
  exportedAt: string;
  snapshot: StoryboardSnapshot;
};

const SNAPSHOT_BACKUP_SCHEMA_VERSION = 1;

type NodeFileSystem = {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  writeFile(
    path: string,
    data: string,
    options: { encoding: "utf8"; flag: "wx" }
  ): Promise<unknown>;
};

const loadNodeFileSystem = new Function(
  "return import('node:fs/promises')"
) as () => Promise<NodeFileSystem>;

function migrationBackupName(now: Date): string {
  const timestamp = now.toISOString().replace(/[-:]/g, "");
  return `migration-backup-${timestamp}.json`;
}

export function createSnapshotBackup(snapshot: StoryboardSnapshot): SnapshotBackupFile {
  return {
    schemaVersion: SNAPSHOT_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    snapshot
  };
}

export async function createMigrationBackup(
  snapshot: unknown,
  destination: string
): Promise<string> {
  if (typeof destination !== "string" || destination.trim().length === 0) {
    throw new Error("Migration backup destination must be a non-empty path");
  }

  const fileSystem = await loadNodeFileSystem();
  const directory = destination.replace(/[\\/]$/, "");
  await fileSystem.mkdir(directory, { recursive: true });
  const backupPath = `${directory}/${migrationBackupName(new Date())}`;
  const payload = {
    schemaVersion: SNAPSHOT_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    snapshot
  };
  await fileSystem.writeFile(backupPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  });
  return backupPath;
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
