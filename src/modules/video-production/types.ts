export type VideoWorkflowProfileId =
  | "minimax_h3_t2v"
  | "minimax_h3_i2v"
  | "minimax_h3_flf2v"
  | "minimax_h3_r2v";

export type VideoQualityTier = "draft" | "production";
export type VideoAccelerationMode = "standard" | "te_speed_preview";
export type VideoBoundaryKind = "continuous" | "match_cut" | "hard_cut" | "scene_change";

export interface VideoWorkflowProfile {
  id: VideoWorkflowProfileId;
  presetPath: string;
  qualityTier: VideoQualityTier;
  supports: { textOnly: boolean; firstFrame: boolean; lastFrame: boolean; referenceImages: number; referenceVideo: boolean; referenceAudio: boolean };
  requiredNodes: string[];
  requiredModels: Array<{ kind: "diffusion_models" | "text_encoders" | "vae"; name: string }>;
}

export interface VideoProfilePreflightReport {
  profileId: VideoWorkflowProfileId;
  available: boolean;
  missingNodes: string[];
  missingModels: Array<{ kind: string; name: string }>;
  warnings: string[];
}

export type VideoRouteDecision =
  | { status: "selected"; profileId: VideoWorkflowProfileId; reason: string }
  | { status: "blocked"; profileId?: VideoWorkflowProfileId; reason: string };

export interface VideoRouteInput {
  manualProfileId: VideoWorkflowProfileId | "auto";
  qualityTier: VideoQualityTier;
  accelerationMode: VideoAccelerationMode;
  availableProfileIds: VideoWorkflowProfileId[];
  namedCharacterCount: number;
  identityReferenceCount: number;
  extraReferenceCount: number;
  hasSceneContinuity: boolean;
  hasStoryboardFrame: boolean;
  hasFirstFrame: boolean;
  hasLastFrame: boolean;
  hasApprovedBoundaryFrame: boolean;
  hasDialogue: boolean;
  boundaryKind: VideoBoundaryKind;
}
