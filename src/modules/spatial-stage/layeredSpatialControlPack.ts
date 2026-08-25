import type { SpatialLayerRole } from "./spatialLayerContract";

export type LayerArtifactKind = "color" | "depth" | "normal" | "mask" | "material_id";
export type SkeletonArtifactKind = "openpose" | "hand_pose" | "contact_map";
export type LayerRenderArtifact = { layerId: string; kind: LayerArtifactKind; filePath: string; sha256: string; width: number; height: number };
export type SkeletonRenderArtifact = { entityId: string; kind: SkeletonArtifactKind; filePath: string; sha256: string; width: number; height: number };
export type LayeredSpatialControlPack = {
  schemaVersion: 2;
  stageId: string; stageRevision: number; stageDigest: string;
  shotId: string; snapshotId: string; cameraId: string; cameraDigest: string;
  contractDigest: string; preflightDigest: string;
  layers: Array<{ layerId: string; order: number; role: SpatialLayerRole; entityIds: string[]; artifacts: LayerRenderArtifact[] }>;
  skeletonArtifacts: SkeletonRenderArtifact[];
  packDigest: string;
};
export type LayeredSpatialControlPackInput = Omit<LayeredSpatialControlPack, "schemaVersion" | "packDigest">;
export type LayeredControlPackValidation = { valid: true } | { valid: false; reason: string };

export {
  LAYER_ARTIFACT_KINDS,
  SKELETON_ARTIFACT_KINDS,
  createLayeredSpatialControlPack,
  validateLayeredSpatialControlPack,
  classifySpatialControlPackVersion
} from "./layeredSpatialControlPackRuntime.mjs";
