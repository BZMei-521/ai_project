export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export type Transform3D = {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
};

export type StageCapabilityStatus =
  | "available"
  | "missing_dependency"
  | "temporarily_unavailable"
  | "failed"
  | "manual_fallback";

export type StageEnvironmentSource =
  | { kind: "empty_stage" }
  | { kind: "panorama"; assetId: string; filePath?: string; maxTextureWidth: number }
  | { kind: "depth_mesh"; filePath: string; triangleCount: number }
  | { kind: "depth_map"; depthUrl: string; normalUrl?: string; maskUrl?: string; promptId: string; width: number; height: number }
  | { kind: "imported_mesh"; filePath: string; triangleCount?: number }
  | { kind: "procedural"; primitive: "ground" | "room" | "wall" | "stairs" }
  | { kind: "cards"; assetIds: string[] };

export type StageEnvironment = {
  sources: StageEnvironmentSource[];
};

export type StageCapability = {
  status: StageCapabilityStatus;
  message: string;
  checkedAt: string;
};

export type StageCapabilityReport = {
  overall: StageCapabilityStatus;
  webgl2: StageCapability;
  comfyui: StageCapability;
  mogeNode: StageCapability;
  mogeModel: StageCapability;
  panoramaConversion: StageCapability;
  pose: StageCapability;
  systemMemory: StageCapability;
  gpuMemory: StageCapability;
};

export type AttachmentPoint = {
  id: string;
  label: string;
  localTransform: Transform3D;
};

export type RigBinding = {
  kind: "humanoid" | "quadruped" | "rigid_chain" | "custom";
  joints: Record<string, string>;
};

export type PoseSnapshot = {
  rootTransform: Transform3D;
  jointRotations: Record<string, Quat>;
  contacts: Array<{
    attachmentId: string;
    targetEntityId?: string;
    targetAttachmentId?: string;
  }>;
  source: "auto_pose" | "previous_snapshot" | "manual" | "imported";
  confidence: number;
};

export type StageMeshResource = {
  filePath: string;
  sha256: string;
  triangleCount: number;
  materialCount: number;
  bounds: Vec3;
};

export type StageEntityGeometry =
  | {
      kind: "box" | "capsule" | "sphere" | "plane";
      size: Vec3;
    }
  | {
      kind: "imported_mesh";
      resource: StageMeshResource;
    };

export type StageEntity = {
  id: string;
  assetId?: string;
  label: string;
  tags: string[];
  transform: Transform3D;
  geometry: StageEntityGeometry;
  rig?: RigBinding;
  attachments?: AttachmentPoint[];
  visibility: "visible" | "hidden";
  metadata: Record<string, unknown>;
};

export type StageConstraint = {
  id: string;
  kind:
    | "attachment"
    | "contact"
    | "look_at"
    | "distance"
    | "orientation"
    | "path"
    | "visibility"
    | "occlusion"
    | "count"
    | "axis_limit";
  subjectEntityId: string;
  targetEntityId?: string;
  subjectAttachmentId?: string;
  targetAttachmentId?: string;
  parameters: Record<string, number | string | boolean | Vec3>;
  enabled: boolean;
};

export type StageCamera = {
  id: string;
  label: string;
  position: Vec3;
  rotation: Quat;
  target: Vec3;
  panoramaYaw: number;
  panoramaPitch: number;
  fov: number;
  near: number;
  far: number;
  continuityGroup?: string;
};

export type StageStateSnapshot = {
  id: string;
  shotId: string;
  beatId: string;
  previousSnapshotId?: string;
  cameraId?: string;
  entityStates: Array<{
    entityId: string;
    transform: Transform3D;
    pose?: PoseSnapshot;
    visibility: "visible" | "hidden";
  }>;
  constraintIds: string[];
  createdAt: string;
};

export type SceneStage = {
  schemaVersion: 2;
  id: string;
  sceneId: string;
  revision: number;
  coordinateFrame: {
    handedness: "right";
    upAxis: "y";
    unit: "metre";
    origin: Vec3;
    forward: Vec3;
    groundY: number;
    scaleMode: "metric" | "relative";
  };
  environment: StageEnvironment;
  entities: StageEntity[];
  constraints: StageConstraint[];
  cameras: StageCamera[];
  snapshots: StageStateSnapshot[];
  capabilities: StageCapabilityReport;
  sourceDigest: string;
  updatedAt: string;
};
