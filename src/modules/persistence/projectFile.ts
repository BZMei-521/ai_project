import { createMigrationBackup } from "./backupSnapshot";
import {
  migrateStoryboardSnapshot,
  type WorkbenchStoryboardSnapshot
} from "../../services/persistence/workbenchMigration";

export type ProjectFile = {
  schemaVersion: number;
  projectId: string;
  name: string;
  fps: number;
  resolution: { width: number; height: number };
  createdAt: string;
  updatedAt: string;
};

export const CURRENT_SCHEMA_VERSION = 1;

export function createProjectFile(input: Omit<ProjectFile, "schemaVersion">): ProjectFile {
  return {
    ...input,
    schemaVersion: CURRENT_SCHEMA_VERSION
  };
}

export type MigratedProjectSaveResult<TSavedPath> = {
  snapshot: WorkbenchStoryboardSnapshot;
  migrated: boolean;
  warnings: string[];
  backupPath: string | null;
  savedPath: TSavedPath;
};

const migrationBackupClaims = new Map<string, Promise<string>>();

export async function saveMigratedProjectSnapshot<TSavedPath>(
  input: unknown,
  backupDestination: string,
  save: (snapshot: WorkbenchStoryboardSnapshot) => Promise<TSavedPath>,
  backup: (snapshot: unknown, destination: string) => Promise<string> = createMigrationBackup
): Promise<MigratedProjectSaveResult<TSavedPath>> {
  const migration = migrateStoryboardSnapshot(input);
  const backupRequired = migration.snapshot.migrationBackupPending;
  let backupPath: string | null = null;
  let claimKey: string | null = null;
  let claim: Promise<string> | null = null;
  let ownsClaim = false;
  if (backupRequired) {
    const projectId = String((migration.snapshot.project as Record<string, unknown>).id ?? "");
    claimKey = `${backupDestination}:${projectId}`;
    claim = migrationBackupClaims.get(claimKey) ?? null;
    if (!claim) {
      const source = migration.snapshot.migrationBackupSource ?? input;
      claim = backup(source, backupDestination);
      migrationBackupClaims.set(claimKey, claim);
      ownsClaim = true;
    }
    try {
      backupPath = await claim;
    } catch (error) {
      if (ownsClaim && claimKey && migrationBackupClaims.get(claimKey) === claim) migrationBackupClaims.delete(claimKey);
      throw error;
    }
  }
  const snapshot = backupRequired
    ? (() => {
        const { migrationBackupSource: _source, ...persisted } = migration.snapshot;
        return { ...persisted, migrationBackupPending: false };
      })()
    : migration.snapshot;
  try {
    const savedPath = await save(snapshot);
    if (ownsClaim && claimKey && claim && migrationBackupClaims.get(claimKey) === claim) {
      migrationBackupClaims.delete(claimKey);
    }

    return {
      ...migration,
      snapshot,
      backupPath,
      savedPath
    };
  } catch (error) {
    if (ownsClaim && claimKey && claim && migrationBackupClaims.get(claimKey) === claim) {
      migrationBackupClaims.delete(claimKey);
    }
    throw error;
  }
}
