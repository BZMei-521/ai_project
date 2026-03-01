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
