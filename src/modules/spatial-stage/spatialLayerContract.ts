export type SpatialLayerRole = "environment" | "subject" | "interaction" | "foreground_occluder" | "effect";
export type SpatialRelationKind = "inside" | "front_of" | "behind" | "contact" | "occludes" | "allows_occlusion";
export type SpatialShotContract = {
  schemaVersion: 1;
  shotId: string;
  cameraId: string;
  layers: Array<{ id: string; order: number; role: SpatialLayerRole; entityIds: string[] }>;
  relations: Array<{ kind: SpatialRelationKind; subjectEntityId: string; targetEntityId: string; subjectAttachmentId?: string; targetAttachmentId?: string }>;
  expectedHands: Array<{ entityId: string; side: "left" | "right"; visible: boolean; contactTargetId?: string }>;
  riskFlags: string[];
};
export type SpatialContractValidation = { valid: true } | { valid: false; reason: string };

// The executable implementation is shared with the stock-Node focused check.
// @ts-expect-error The JavaScript runtime is intentionally dependency-free.
import { normalizeSpatialShotContract as runtimeNormalize, orderedLayerIds as runtimeOrderedLayerIds, validateSpatialShotContract as runtimeValidate } from "./spatialLayerContractRuntime.mjs";

export const normalizeSpatialShotContract = runtimeNormalize as (value: unknown) => SpatialShotContract;
export const orderedLayerIds = runtimeOrderedLayerIds as (contract: SpatialShotContract) => string[];
export const validateSpatialShotContract = runtimeValidate as (contract: SpatialShotContract) => SpatialContractValidation;
