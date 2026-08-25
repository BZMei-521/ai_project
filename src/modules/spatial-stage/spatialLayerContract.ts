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

export { normalizeSpatialShotContract, orderedLayerIds, validateSpatialShotContract } from "./spatialLayerContractRuntime.mjs";
