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

export async function saveMigratedProjectSnapshot<TSavedPath>(
  input: unknown,
  backupDestination: string,
  save: (snapshot: WorkbenchStoryboardSnapshot) => Promise<TSavedPath>,
  backup: (snapshot: unknown, destination: string) => Promise<string> = createMigrationBackup
): Promise<MigratedProjectSaveResult<TSavedPath>> {
  const migration = migrateStoryboardSnapshot(input);
  const backupPath = migration.migrated
    ? await backup(input, backupDestination)
    : null;
  const savedPath = await save(migration.snapshot);

  return {
    ...migration,
    backupPath,
    savedPath
  };
}
