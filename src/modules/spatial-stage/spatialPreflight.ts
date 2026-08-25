import type { SpatialShotContract } from "./spatialLayerContract";
import type { Vec3 } from "./types";

export type SpatialBounds = { min: Vec3; max: Vec3 };
export type SpatialContactEvidence = {
  subjectEntityId: string;
  targetEntityId: string;
  distance: number;
  maxDistance: number;
};
export type SpatialSkeletonEvidence = { entityId: string; names: string[] };
export type SpatialPreflightError = {
  code: string;
  relation?: SpatialShotContract["relations"][number];
  contact?: unknown;
  entityId?: string;
  missing?: string[];
};
export type SpatialPreflightInput = {
  contract: SpatialShotContract;
  entities: Record<string, SpatialBounds>;
  contacts: SpatialContactEvidence[];
  joints: SpatialSkeletonEvidence[];
};
export type SpatialPreflightReport = {
  ok: boolean;
  errors: SpatialPreflightError[];
  warnings: SpatialPreflightError[];
  input: SpatialPreflightInput;
};

export { runSpatialPreflight } from "./spatialPreflightRuntime.mjs";
