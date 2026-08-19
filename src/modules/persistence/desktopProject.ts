import { useStoryboardStore, type StoryboardSnapshot } from "../storyboard-core/store";
import { invokeDesktopCommand, isDesktopRuntime as hasDesktopRuntime } from "../platform/desktopBridge";
import { createMigrationBackup, type DesktopCommandInvoker } from "./backupSnapshot";
import { saveMigratedProjectSnapshot } from "./projectFile";
import { migrateStoryboardSnapshot } from "../../services/persistence/workbenchMigration";

type SaveResult = {
  projectPath: string;
};

export type WorkspaceProjectEntry = {
  name: string;
  path: string;
  isCurrent: boolean;
};

export function isDesktopRuntime(): boolean {
  return hasDesktopRuntime();
}

const CURRENT_PROJECT_BACKUP_DESTINATION = "current-project";

export async function saveSnapshotThroughDesktopBridge(
  snapshot: unknown,
  invokeCommand: DesktopCommandInvoker = invokeDesktopCommand,
  onMigrationSaved?: () => void
): Promise<string> {
  const result = await saveMigratedProjectSnapshot(
    snapshot,
    CURRENT_PROJECT_BACKUP_DESTINATION,
    async (migratedSnapshot) => {
      const saved = await invokeCommand("save_current_project", { snapshot: migratedSnapshot });
      if (!saved || typeof saved !== "object" || !("projectPath" in saved)) {
        throw new Error("Desktop project save did not return a project path");
      }
      return String((saved as { projectPath: unknown }).projectPath);
    },
    (legacySnapshot, destination) => createMigrationBackup(legacySnapshot, destination, invokeCommand)
  );
  if (result.backupPath) onMigrationSaved?.();
  return result.savedPath;
}

export async function loadSnapshotThroughDesktopBridge(
  invokeCommand: DesktopCommandInvoker = invokeDesktopCommand
): Promise<StoryboardSnapshot | null> {
  const result = await invokeCommand("load_current_project");
  if (result === null) return null;
  return migrateStoryboardSnapshot(result).snapshot as unknown as StoryboardSnapshot;
}

export async function saveSnapshotToDesktop(
  snapshot: StoryboardSnapshot
): Promise<string | null> {
  if (!hasDesktopRuntime()) return null;

  return saveSnapshotThroughDesktopBridge(
    snapshot,
    invokeDesktopCommand,
    () => useStoryboardStore.getState().completeWorkbenchMigration()
  );
}

export async function loadSnapshotFromDesktop(): Promise<StoryboardSnapshot | null> {
  if (!hasDesktopRuntime()) return null;

  return loadSnapshotThroughDesktopBridge();
}

export async function listWorkspaceProjects(): Promise<WorkspaceProjectEntry[]> {
  if (!hasDesktopRuntime()) return [];
  return invokeDesktopCommand<WorkspaceProjectEntry[]>("list_workspace_projects");
}

export async function createWorkspaceProject(name: string): Promise<string | null> {
  if (!hasDesktopRuntime()) return null;
  const result = await invokeDesktopCommand<SaveResult>("create_workspace_project", { name });
  return result.projectPath;
}

export async function selectWorkspaceProject(projectPath: string): Promise<string | null> {
  if (!hasDesktopRuntime()) return null;
  const result = await invokeDesktopCommand<SaveResult>("select_workspace_project", { projectPath });
  return result.projectPath;
}

export async function renameWorkspaceProject(
  projectPath: string,
  newName: string
): Promise<string | null> {
  if (!hasDesktopRuntime()) return null;
  const result = await invokeDesktopCommand<SaveResult>("rename_workspace_project", {
    projectPath,
    newName
  });
  return result.projectPath;
}

export async function deleteWorkspaceProject(
  projectPath: string
): Promise<WorkspaceProjectEntry[]> {
  if (!hasDesktopRuntime()) return [];
  return invokeDesktopCommand<WorkspaceProjectEntry[]>("delete_workspace_project", {
    projectPath
  });
}
