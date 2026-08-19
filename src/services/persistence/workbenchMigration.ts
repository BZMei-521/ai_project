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
  migrationBackupPending: boolean;
  migrationBackupSource?: Record<string, unknown>;
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

function requireObjectArray(snapshot: Record<string, unknown>, field: string): void {
  const value = snapshot[field];
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
    throw new Error(`Invalid storyboard snapshot: ${field} must be an array of objects`);
  }
}

export function migrateStoryboardSnapshot(input: unknown): MigrationResult {
  if (!isRecord(input)) {
    throw new Error("Invalid storyboard snapshot: snapshot must be an object");
  }
  if (!isRecord(input.project)) {
    throw new Error("Invalid storyboard snapshot: project must be an object");
  }
  if (typeof input.project.id !== "string" || input.project.id.trim().length === 0) {
    throw new Error("Invalid storyboard snapshot: project.id must be a non-empty string");
  }
  for (const field of ["shots", "assets"]) {
    if (!Array.isArray(input[field])) {
      throw new Error(`Invalid storyboard snapshot: ${field} must be an array`);
    }
  }
  if (input.directorPlan !== undefined && input.directorPlan !== null && !isRecord(input.directorPlan)) {
    throw new Error("Invalid storyboard snapshot: directorPlan must be an object or null");
  }
  if (input.migrationBackupPending !== undefined && typeof input.migrationBackupPending !== "boolean") {
    throw new Error("Invalid storyboard snapshot: migrationBackupPending must be a boolean");
  }
  for (const field of ["spatialScenes", "spatialObjects", "poseKeyframes", "cameraPlans"]) {
    requireObjectArray(input, field);
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

  const missingFields = Object.keys(WORKBENCH_DEFAULTS).filter((field) => input[field] === undefined);
  const migrated = input.schemaVersion !== CURRENT_WORKBENCH_SCHEMA_VERSION || missingFields.length > 0;
  const snapshot = cloneSnapshot(input) as Record<string, unknown>;

  snapshot.schemaVersion = CURRENT_WORKBENCH_SCHEMA_VERSION;
  snapshot.migrationBackupPending = migrated ? true : input.migrationBackupPending ?? false;
  if (migrated) snapshot.migrationBackupSource = cloneSnapshot(input);
  else if (isRecord(input.migrationBackupSource)) snapshot.migrationBackupSource = cloneSnapshot(input.migrationBackupSource);
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
