import type {
  VideoAccelerationMode,
  VideoBoundaryKind,
  VideoQualityTier,
  VideoWorkflowProfileId
} from "../video-production/types";
import type { VideoProductionEvidence, VideoProviderArtifact } from "../video-production/videoQuality";
import type { CharacterSpeciesId } from "../comfy-pipeline/characterStyleContract";
import type { RunningHubCloudRecord } from "../video-production/runningHubApproval";

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

export type ShotTransitionFrameDependency = "none" | "previous_tail" | "shared_frame";

export type ShotTransition = {
  id: string;
  sequenceId: string;
  fromShotId: string;
  toShotId: string;
  type: VideoBoundaryKind;
  durationSeconds: number;
  frameDependency: ShotTransitionFrameDependency;
  sharedFramePath?: string;
  actionContinuity: string;
  characterPosition: string;
  cameraDirection: string;
  notes: string;
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
    contractDigest?: string;
    operationToken?: string;
    generatedAt: string;
  };
  videoGenerationContractDigest?: string;
  videoProductionEvidence?: VideoProductionEvidence;
  videoProviderArtifact?: VideoProviderArtifact;
  runningHubCloud?: RunningHubCloudRecord;
  skyboxFace?: "auto" | SkyboxFace;
  skyboxFaces?: SkyboxFace[];
  skyboxFaceWeights?: Partial<Record<SkyboxFace, number>>;
  cameraYaw?: number;
  cameraPitch?: number;
  cameraFov?: number;
  generatedImagePath?: string;
  generatedVideoPath?: string;
};

export type StoryboardGenerationStage =
  | "preflight"
  | "exported"
  | "stageA"
  | "stageB"
  | "fallback"
  | "needs_review"
  | "rejected"
  | "completed"
  | "cancelled"
  | "failed";

export type StoryboardGenerationRetrySnapshot = {
  version: 1;
  settings: Record<string, unknown>;
  shot: Shot;
  index: number;
  allShots: Shot[];
  assets: Asset[];
  stageAWorkflowJson?: string;
  stageBWorkflowJson?: string;
  workflowId?: string;
  globalStyle?: string;
  negativePrompt?: string;
  characterRedraw?: {
    characterAssetId: string;
    scope: "face_hair" | "upper_body" | "full_character";
  };
  preflightRequired: boolean;
  customRunnerRequired: boolean;
};

export type StoryboardGenerationTask = {
  id: string;
  batchId: string;
  shotId: string;
  workflowId: string;
  stage: StoryboardGenerationStage;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "needs_review" | "rejected";
  promptHash: string;
  outputPath?: string;
  bestPreviewPath?: string;
  reviewReasons?: string[];
  errorCode?: string;
  errorMessage?: string;
  externalProvider?: "codex_task_package";
  externalJobId?: string;
  externalRequestDigest?: string;
  retrySnapshot?: StoryboardGenerationRetrySnapshot;
  startedAt: string;
  finishedAt?: string;
};

export type CharacterIdentityPack = {
  version: string;
  triggerWord: string;
  species: CharacterSpeciesId;
  speciesTraits: string[];
  styleContractId: "cinematic_3d_donghua_v1";
  styleContractVersion: "1.0.0";
  styleContractDigest: string;
  faceMasterPath: string;
  faceLeftPath?: string;
  faceRightPath?: string;
  hairBackPath?: string;
  bodyFrontPath: string;
  bodySidePath?: string;
  bodyBackPath?: string;
  neutralExpressionPath?: string;
  immutableTraits: string[];
  forbiddenChanges: string[];
  approvedHeroFramePaths: string[];
  updatedAt: string;
};

export type CharacterGenerationMode = "zero_shot_multi_reference" | "lora_augmented";

export type CharacterIdentityReferenceEvidence = {
  shotId: "front_close" | "three_quarter_medium" | "left_profile" | "right_profile" | "back_view" | "full_body_action" | "strong_expression" | "different_lighting";
  slot: "face_master" | "face_left" | "face_right" | "hair_back" | "body_front" | "body_side" | "body_back" | "expression_neutral";
  sourceSha256: string;
  transformedSha256: string;
  transform: "none" | "mirror_x" | "head_shoulders_crop";
};

export type CharacterShotEvidence = {
  id: CharacterIdentityReferenceEvidence["shotId"];
  outputSha256: string;
  score: number;
  dimensionScores: Record<"face" | "hair" | "outfit" | "body" | "quality", number>;
  retries: number;
  finalStatus: "accepted";
  provenance: "model_generation";
  actualProvider: "qwen_image_edit_2511" | "flux2_klein_4b";
  terminalOutputNode: string;
};

export type CharacterGenerationEvidence = {
  reportLabel: string;
  sourceReportDigest: string;
  trustedReceipt: {
    schemaVersion: 1;
    issuer: "storyboard-desktop-character-evidence-v1";
    receiptId: string;
    claimsDigest: string;
    reportDigest: string;
    generationMode: CharacterGenerationMode;
    characterAssetId: string;
    identityPackVersion: string;
    identityMetadataDigest: string;
    fixtureDigest: string;
    evaluatorImplementationHash: string;
    evaluatorPolicyHash: string;
    outputHashesDigest: string;
  };
  evidenceDigest: string;
  generationMode: CharacterGenerationMode;
  benchmarkVersion: string;
  promptTemplateVersion: string;
  fixtureDigest: string;
  generationParametersDigest: string;
  characterAssetId: string;
  provider: "qwen_image_edit_2511" | "flux2_klein_4b";
  identityPackVersion: string;
  identityMetadataDigest: string;
  referenceManifestDigest: string;
  references: CharacterIdentityReferenceEvidence[];
  modelName: string;
  workflowDigest: string;
  terminalOutputNode: string;
  terminalModel: string;
  evaluatorId: string;
  evaluatorVersion: string;
  evaluatorImplementationHash: string;
  evaluatorPolicyHash: string;
  dimensionThreshold: number;
  shots: CharacterShotEvidence[];
  aggregateScore: number;
  acceptedShots: 8;
  verifiedAt: string;
  importedAt: string;
  loraName?: string;
  loraVersion?: string;
  loraStrength?: number;
  candidateStatus?: "dataset_ready" | "training";
  terminalLoraName?: string;
  terminalLoraStrengthModel?: number;
  terminalLoraStrengthClip?: number | null;
  terminalLoraClassType?: "LoraLoader" | "LoraLoaderModelOnly";
  terminalLoraClipPolicy?: "equal_to_model" | "not_applicable";
};

export type CharacterBenchmarkEvidence = CharacterGenerationEvidence;

export type CharacterGenerationEvidenceContext = {
  generationMode: "zero_shot_multi_reference" | "lora_augmented";
  benchmarkVersion: string;
  promptTemplateVersion: string;
  characterAssetId: string;
  identityPackVersion: string;
  identityMetadataDigest: string;
  triggerWord: string;
  immutableTraits: string[];
  forbiddenChanges: string[];
  species: CharacterSpeciesId;
  speciesTraits: string[];
  styleContractId: "cinematic_3d_donghua_v1";
  styleContractVersion: "1.0.0";
  styleContractDigest: string;
  provider: "qwen_image_edit_2511" | "flux2_klein_4b";
  modelName: string;
  fixtureDigest: string;
  referenceManifestDigest: string;
  evaluatorId: string;
  evaluatorVersion: string;
  evaluatorImplementationHash: string;
  evaluatorPolicyHash: string;
  dimensionThreshold: number;
  workflowProof: { workflowDigest: string; terminalOutputNode: string; authoritativeModelBindings: Array<{ model: string }> };
  loraName?: string;
  loraVersion?: string;
  loraStrength?: number;
  candidateStatus?: "dataset_ready" | "training";
};

export type CharacterLoraProfile = {
  provider: "qwen_image_edit_2511" | "flux2_klein_4b";
  modelName: string;
  loraName: string;
  strength: number;
  version: string;
  status: "unconfigured" | "dataset_ready" | "training" | "ready" | "failed";
  benchmarkEvidence?: CharacterBenchmarkEvidence;
};

export type CharacterConsistencyBaseline = {
  version: string;
  closeThreshold: number;
  mediumThreshold: number;
  wideThreshold: number;
  lastRegressionAt?: string;
  lastRegressionScore?: number;
};

export type CharacterGenerationMetadata = {
  characterAssetId: string;
  identityPackVersion: string;
  loraName?: string;
  loraVersion?: string;
  provider: "qwen_image_edit_2511" | "flux2_klein_4b";
  referencePaths: string[];
  retryCount: number;
  consistencyScore?: number;
  failureDimensions?: Array<"face" | "hair" | "outfit" | "body" | "quality">;
  status: "generated" | "accepted" | "needs_review";
};

export type ShotLayer = {
  id: string;
  shotId: string;
  name: string;
  visible: boolean;
  locked: boolean;
  zIndex: number;
  bitmapPath: string;
  characterGenerationMetadata?: CharacterGenerationMetadata;
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
  characterFaceRefPath?: string;
  characterDetailRefPath?: string;
  characterIdentityPack?: CharacterIdentityPack;
  characterLora?: CharacterLoraProfile;
  characterZeroShotEvidence?: CharacterGenerationEvidence;
  currentZeroContext?: CharacterGenerationEvidenceContext;
  currentLoraContext?: CharacterGenerationEvidenceContext;
  characterConsistencyBaseline?: CharacterConsistencyBaseline;
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
