import type { DirectorPlan } from "../../domains/director/types";
import type {
  CameraPlan,
  PoseKeyframe,
  SpatialObject,
  SpatialScene
} from "../../domains/spatial-scene/types";

export const CURRENT_WORKBENCH_SCHEMA_VERSION = 2;

export type WorkbenchStoryboardSnapshot = Record<string, unknown> & {
  schemaVersion: typeof CURRENT_WORKBENCH_SCHEMA_VERSION;
  project: Record<string, unknown>;
  directorPlan: DirectorPlan | null;
  spatialScenes: SpatialScene[];
  spatialObjects: SpatialObject[];
  poseKeyframes: PoseKeyframe[];
  cameraPlans: CameraPlan[];
};

export type MigrationResult = {
  snapshot: WorkbenchStoryboardSnapshot;
  migrated: boolean;
  warnings: string[];
};

const WORKBENCH_DEFAULTS = {
  directorPlan: null,
  spatialScenes: [],
  spatialObjects: [],
  poseKeyframes: [],
  cameraPlans: []
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneSnapshot<T>(value: T): T {
  return structuredClone(value);
}

export function migrateStoryboardSnapshot(input: unknown): MigrationResult {
  if (!isRecord(input)) {
    throw new Error("Invalid storyboard snapshot: snapshot must be an object");
  }
  if (!isRecord(input.project)) {
    throw new Error("Invalid storyboard snapshot: project must be an object");
  }
  if (
    input.schemaVersion !== undefined &&
    (!Number.isInteger(input.schemaVersion) || Number(input.schemaVersion) < 0)
  ) {
    throw new Error("Invalid storyboard snapshot: schemaVersion must be a non-negative integer");
  }
  if (typeof input.schemaVersion === "number" && input.schemaVersion > CURRENT_WORKBENCH_SCHEMA_VERSION) {
    throw new Error(`Unsupported storyboard snapshot schemaVersion: ${input.schemaVersion}`);
  }

  const snapshot = cloneSnapshot(input) as Record<string, unknown>;
  const missingFields = Object.keys(WORKBENCH_DEFAULTS).filter((field) => snapshot[field] === undefined);
  const migrated = snapshot.schemaVersion !== CURRENT_WORKBENCH_SCHEMA_VERSION || missingFields.length > 0;

  snapshot.schemaVersion = CURRENT_WORKBENCH_SCHEMA_VERSION;
  for (const field of missingFields) {
    snapshot[field] = cloneSnapshot(WORKBENCH_DEFAULTS[field as keyof typeof WORKBENCH_DEFAULTS]);
  }

  return {
    snapshot: snapshot as WorkbenchStoryboardSnapshot,
    migrated,
    warnings: missingFields.length > 0
      ? [`Could not infer legacy workbench fields: ${missingFields.join(", ")}; defaults were applied.`]
      : []
  };
}
