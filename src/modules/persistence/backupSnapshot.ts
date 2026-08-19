import type { StoryboardSnapshot } from "../storyboard-core/store";
import { invokeDesktopCommand } from "../platform/desktopBridge";
import { migrateStoryboardSnapshot } from "../../services/persistence/workbenchMigration";

type SnapshotBackupFile = {
  schemaVersion: number;
  exportedAt: string;
  snapshot: StoryboardSnapshot;
};

const SNAPSHOT_BACKUP_SCHEMA_VERSION = 1;

export type DesktopCommandInvoker = (
  command: string,
  args?: Record<string, unknown>
) => Promise<unknown>;

export function createSnapshotBackup(snapshot: StoryboardSnapshot): SnapshotBackupFile {
  return {
    schemaVersion: SNAPSHOT_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    snapshot
  };
}

export async function createMigrationBackup(
  snapshot: unknown,
  destination: string,
  invokeCommand: DesktopCommandInvoker = invokeDesktopCommand
): Promise<string> {
  if (typeof destination !== "string" || destination.trim().length === 0) {
    throw new Error("Migration backup destination must be a non-empty path");
  }

  const result = await invokeCommand("create_migration_backup", { snapshot, destination });
  if (!result || typeof result !== "object" || !("backupPath" in result)) {
    throw new Error("Desktop migration backup did not return a backup path");
  }
  return String((result as { backupPath: unknown }).backupPath);
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

  return migrateStoryboardSnapshot(snapshot).snapshot as unknown as StoryboardSnapshot;
}
