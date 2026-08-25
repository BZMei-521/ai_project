import type { LayeredSpatialControlPack, LayeredSpatialControlPackInput, LayeredControlPackValidation } from "./layeredSpatialControlPack";

export declare const LAYER_ARTIFACT_KINDS: readonly ["color", "depth", "normal", "mask", "material_id"];
export declare const SKELETON_ARTIFACT_KINDS: readonly ["openpose", "hand_pose", "contact_map"];
export declare function sha256Bytes(bytes: Uint8Array): string;
export declare function createLayeredSpatialControlPack(input: LayeredSpatialControlPackInput): LayeredSpatialControlPack;
export declare function validateLayeredSpatialControlPack(pack: LayeredSpatialControlPack, current: Pick<LayeredSpatialControlPackInput, "stageId" | "stageRevision" | "stageDigest" | "shotId" | "snapshotId" | "cameraId" | "cameraDigest">): LayeredControlPackValidation;
export declare function classifySpatialControlPackVersion(value: unknown): "layered_v2" | "legacy_v1" | "unsupported";
