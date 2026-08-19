export type SpatialVector3 = {
  x: number;
  y: number;
  z: number;
};

export type SpatialRotation = SpatialVector3;

export type SpatialObjectKind = "character" | "prop" | "camera" | "light" | "environment" | "custom";

export type SpatialObject = {
  id: string;
  label?: string;
  objectKind: SpatialObjectKind;
  assetId?: string;
  position: SpatialVector3;
  rotation: SpatialRotation;
  scale: SpatialVector3;
  visibility: "visible" | "hidden";
  poseKeyframeIds?: string[];
  metadata?: Record<string, string | number | boolean | null>;
};

export type PoseKeyframe = {
  id: string;
  objectId: string;
  time: number;
  position?: SpatialVector3;
  rotation?: SpatialRotation;
  scale?: SpatialVector3;
  easing?: "linear" | "step" | "ease-in" | "ease-out" | "ease-in-out";
};

export type CameraPlan = {
  id?: string;
  position?: SpatialVector3;
  target?: SpatialVector3;
  yaw: number;
  pitch: number;
  fov: number;
  near?: number;
  far?: number;
};

export type PreviewReferenceChannel = {
  kind: "color" | "depth" | "normal" | "mask" | "pose" | "json";
  path?: string;
  mimeType?: string;
};

export type PreviewReferenceSet = {
  sceneId: string;
  revision: number;
  channels: PreviewReferenceChannel[];
};

export type SpatialScene = {
  id: string;
  name?: string;
  revision: number;
  objects: SpatialObject[];
  camera: CameraPlan;
  poseKeyframes: PoseKeyframe[];
  previewReferences?: PreviewReferenceSet;
  updatedAt?: string;
};

export type DirectorPlanRevision = {
  id: string;
  revision: number;
  status: "draft" | "ready" | "approved" | "archived";
  sceneIds: string[];
  createdAt: string;
  updatedAt: string;
  notes?: string;
};

export type Bounds3 = {
  min: SpatialVector3;
  max: SpatialVector3;
};
