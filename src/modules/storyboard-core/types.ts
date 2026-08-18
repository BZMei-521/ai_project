import type {
  VideoAccelerationMode,
  VideoBoundaryKind,
  VideoQualityTier,
  VideoWorkflowProfileId
} from "../video-production/types";
import type { VideoProductionEvidence } from "../video-production/videoQuality";

export type Project = {
  id: string;
  name: string;
  fps: number;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
};

export type Sequence = {
  id: string;
  projectId: string;
  name: string;
  order: number;
};

export type Shot = {
  id: string;
  sequenceId: string;
  order: number;
  title: string;
  durationFrames: number;
  dialogue: string;
  notes: string;
  tags: string[];
  storyPrompt?: string;
  negativePrompt?: string;
  seed?: number;
  characterRefs?: string[];
  sceneRefId?: string;
  sourceCharacterNames?: string[];
  sourceSceneName?: string;
  sourceScenePrompt?: string;
  videoPrompt?: string;
  videoMode?: "auto" | "single_frame" | "first_last_frame";
  videoStartFramePath?: string;
  videoEndFramePath?: string;
  videoWorkflowProfileId?: VideoWorkflowProfileId | "auto";
  videoQualityTier?: VideoQualityTier;
  videoAccelerationMode?: VideoAccelerationMode;
  continuitySegmentId?: string;
  videoBoundaryKind?: VideoBoundaryKind;
  approvedBoundaryFramePath?: string;
  videoRouteReason?: string;
  videoQualityStatus?: "pending" | "checking" | "needs_review" | "approved" | "rejected";
  videoGenerationReceipt?: {
    profileId: VideoWorkflowProfileId;
    accelerationMode: VideoAccelerationMode;
    workflowDigest: string;
    inputDigest: string;
    promptId: string;
    normalizedPath?: string;
    generatedAt: string;
  };
  videoGenerationContractDigest?: string;
  videoProductionEvidence?: VideoProductionEvidence;
  skyboxFace?: "auto" | SkyboxFace;
  skyboxFaces?: SkyboxFace[];
  skyboxFaceWeights?: Partial<Record<SkyboxFace, number>>;
  cameraYaw?: number;
  cameraPitch?: number;
  cameraFov?: number;
  generatedImagePath?: string;
  generatedVideoPath?: string;
};

export type ShotLayer = {
  id: string;
  shotId: string;
  name: string;
  visible: boolean;
  locked: boolean;
  zIndex: number;
  bitmapPath: string;
};

export type SkyboxFace = "front" | "right" | "back" | "left" | "up" | "down";

export type SkyboxUpdateEvent = {
  id: string;
  face: SkyboxFace;
  prompt: string;
  filePath: string;
  createdAt: string;
};

export type AssetType = "character" | "scene" | "prop" | "skybox";

export type Asset = {
  id: string;
  projectId: string;
  type: AssetType;
  name: string;
  filePath: string;
  characterFrontPath?: string;
  characterSidePath?: string;
  characterBackPath?: string;
  characterAnchorModelName?: string;
  voiceProfile?: string;
  skyboxDescription?: string;
  skyboxTags?: string[];
  skyboxFaces?: Partial<Record<SkyboxFace, string>>;
  skyboxUpdateEvents?: SkyboxUpdateEvent[];
};

export type AudioTrackKind =
  | "manual"
  | "dialogue"
  | "narration"
  | "ambience"
  | "character_sfx"
  | "prop_sfx";

export type AudioTrack = {
  id: string;
  projectId: string;
  filePath: string;
  startFrame: number;
  gain: number;
  kind?: AudioTrackKind;
  label?: string;
};
