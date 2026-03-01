import type { StoryboardSnapshot } from "../storyboard-core/store";
import { invokeDesktopCommand, isDesktopRuntime as hasDesktopRuntime } from "../platform/desktopBridge";

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

export async function saveSnapshotToDesktop(
  snapshot: StoryboardSnapshot
): Promise<string | null> {
  if (!hasDesktopRuntime()) return null;

  const result = await invokeDesktopCommand<SaveResult>("save_current_project", { snapshot });
  return result.projectPath;
}

export async function loadSnapshotFromDesktop(): Promise<StoryboardSnapshot | null> {
  if (!hasDesktopRuntime()) return null;

  const result = await invokeDesktopCommand<StoryboardSnapshot | null>("load_current_project");
  return result;
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
