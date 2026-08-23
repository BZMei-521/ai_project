export const DIRECTOR_NODE_IDS = ["script", "assets", "preview", "storyboard", "production"] as const;

export type DirectorNodeId = (typeof DIRECTOR_NODE_IDS)[number];

export const DIRECTOR_NODE_EDGES = [
  { from: "script", to: "assets" },
  { from: "assets", to: "preview" },
  { from: "preview", to: "storyboard" },
  { from: "storyboard", to: "production" }
] as const;

export const DIRECTOR_NODE_STATUSES = ["idle", "waiting", "running", "completed", "failed"] as const;

export type DirectorNodeStatus = (typeof DIRECTOR_NODE_STATUSES)[number];

export type DirectorNodeViewState = {
  selectedNodeId: DirectorNodeId;
  collapsedNodeIds: DirectorNodeId[];
  panX: number;
  panY: number;
  zoom: number;
};

export type DirectorGenerationTaskInput = {
  status?: "queued" | "running" | "completed" | "failed" | "cancelled" | "needs_review";
  outputPath?: string;
  generatedImagePath?: string;
  generatedVideoPath?: string;
};

export type DirectorAssetInput = {
  id: string;
  filePath?: string;
};

export type DirectorSceneInput = {
  id: string;
  previewReferences?: {
    channels?: Array<{
      path?: string | null;
    }>;
  };
};

export type DirectorShotInput = {
  id: string;
  generatedImagePath?: string;
  generatedVideoPath?: string;
  videoQualityStatus?: "pending" | "checking" | "needs_review" | "approved" | "rejected";
};

export type DirectorNodeStatusInput = {
  nodeId: DirectorNodeId;
  generationTasks?: readonly DirectorGenerationTaskInput[];
  assets?: readonly DirectorAssetInput[];
  spatialScenes?: readonly DirectorSceneInput[];
  shots?: readonly DirectorShotInput[];
  outputFlags?: Partial<Record<DirectorNodeId, boolean | string | null | undefined>>;
};

function hasTruthyOutput(value: boolean | string | null | undefined): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  return Boolean(value);
}

function hasRunningTask(tasks: readonly DirectorGenerationTaskInput[]): boolean {
  return tasks.some((task) => task.status === "queued" || task.status === "running");
}

function hasFailedTask(tasks: readonly DirectorGenerationTaskInput[]): boolean {
  return tasks.some((task) => task.status === "failed" || task.status === "cancelled" || task.status === "needs_review");
}

function hasCompletedTask(tasks: readonly DirectorGenerationTaskInput[]): boolean {
  return tasks.some((task) => task.status === "completed");
}

function hasSceneOutput(scenes: readonly DirectorSceneInput[]): boolean {
  return scenes.some((scene) => (scene.previewReferences?.channels ?? []).some((channel) => typeof channel.path === "string" && channel.path.trim().length > 0));
}

function hasShotImageOutput(shots: readonly DirectorShotInput[]): boolean {
  return shots.some((shot) => typeof shot.generatedImagePath === "string" && shot.generatedImagePath.trim().length > 0);
}

function hasShotVideoOutput(shots: readonly DirectorShotInput[]): boolean {
  return shots.some((shot) => typeof shot.generatedVideoPath === "string" && shot.generatedVideoPath.trim().length > 0);
}

function hasShotFailure(shots: readonly DirectorShotInput[]): boolean {
  return shots.some((shot) => shot.videoQualityStatus === "needs_review" || shot.videoQualityStatus === "rejected");
}

export function getDirectorNodeStatus(input: DirectorNodeStatusInput): DirectorNodeStatus {
  const tasks = input.generationTasks ?? [];
  const assets = input.assets ?? [];
  const scenes = input.spatialScenes ?? [];
  const shots = input.shots ?? [];
  const explicitOutput = input.outputFlags?.[input.nodeId];

  if (hasTruthyOutput(explicitOutput)) return "completed";
  if (hasRunningTask(tasks)) return "running";
  if (hasFailedTask(tasks)) return "failed";

  switch (input.nodeId) {
    case "script":
      if (hasCompletedTask(tasks)) return "completed";
      if (shots.length > 0 || tasks.length > 0) return "waiting";
      return "idle";
    case "assets":
      if (assets.length > 0 || tasks.length > 0) return "completed";
      if (shots.length > 0 || scenes.length > 0) return "waiting";
      return "idle";
    case "preview":
      if (hasSceneOutput(scenes) || scenes.length > 0) return "completed";
      if (shots.length > 0 || assets.length > 0 || tasks.length > 0) return "waiting";
      return "idle";
    case "storyboard":
      if (hasShotImageOutput(shots) || hasShotVideoOutput(shots)) return "completed";
      if (shots.length > 0 || scenes.length > 0 || assets.length > 0 || tasks.length > 0) return "waiting";
      return "idle";
    case "production":
      if (hasShotVideoOutput(shots) || hasShotImageOutput(shots)) return "completed";
      if (hasShotFailure(shots)) return "failed";
      if (shots.length > 0 || scenes.length > 0 || assets.length > 0 || tasks.length > 0) return "waiting";
      return "idle";
  }
}
