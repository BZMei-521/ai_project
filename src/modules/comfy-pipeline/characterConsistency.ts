import type { Shot } from "../storyboard-core/types";

export type CharacterView = "front" | "left_three_quarter" | "right_three_quarter" | "left_profile" | "right_profile" | "back";
export type ShotScale = "close" | "medium" | "wide";

export type CharacterReferenceSelection = {
  kind: "face_angle" | "face_master" | "body_view" | "hair_back" | "continuity";
  path: string;
};

export type CharacterIdentityPackInput = {
  triggerWord: string;
  faceMasterPath: string;
  faceLeftPath?: string;
  faceRightPath?: string;
  hairBackPath?: string;
  bodyFrontPath: string;
  bodySidePath?: string;
  bodyBackPath?: string;
};

export type CharacterGenerationProvider = "qwen_image_edit_2511" | "flux2_klein_4b";
export type CharacterConsistencyDimension = "face" | "hair" | "outfit" | "body" | "quality";
export type CharacterConsistencyMetrics = Record<CharacterConsistencyDimension, number | null>;
export type CharacterConsistencyProfile = {
  shotScale: ShotScale;
  view: CharacterView;
  threshold: number;
};
export type CharacterConsistencyScore = {
  total: number;
  passed: boolean;
  weights: Record<CharacterConsistencyDimension, number>;
  availableWeight: number;
  failedDimensions: CharacterConsistencyDimension[];
  missingDimensions: CharacterConsistencyDimension[];
};
export type CharacterRetryAction = "retry_seed" | "expand_head_crop" | "add_hero_reference" | "switch_provider" | "needs_review";
export type CharacterRetryDecision = {
  action: CharacterRetryAction;
  provider?: CharacterGenerationProvider;
};
export type CharacterRetryDecisionInput = {
  attempt: number;
  hasHeroReference: boolean;
  hasFallbackProvider?: boolean;
  fallbackProvider?: CharacterGenerationProvider;
};
export type StoryboardAcceptedResult = {
  status: "accepted";
  previewUrl: string;
  localPath: string;
};
export type StoryboardNeedsReviewResult = {
  status: "needs_review";
  bestPreviewPath: string;
  reasons: string[];
};
export type StoryboardStagedGenerationResult = StoryboardAcceptedResult | StoryboardNeedsReviewResult;
export type StoryboardOutcomeTransition =
  | { action: "complete"; outputPath: string }
  | { action: "needs_review"; bestPreviewPath: string; reasons: string[] };

export type CharacterAssetInput = {
  id: string;
  name: string;
  characterIdentityPack?: CharacterIdentityPackInput;
  continuityPath?: string;
};

export type CharacterPassPlan = {
  characterAssetId: string;
  characterName: string;
  roleIndex: number;
  provider: CharacterGenerationProvider;
  view: CharacterView;
  shotScale: ShotScale;
  references: CharacterReferenceSelection[];
  triggerWord: string;
  protectPreviousCharacters: boolean;
  refineHead: boolean;
};

export type CharacterReferenceRoutingInput = {
  identityPack: CharacterIdentityPackInput;
  view: CharacterView;
  shotScale: ShotScale;
  continuityPath?: string;
};

export type CharacterPassPlanInput = {
  shot: Pick<Shot, "id" | "title" | "cameraYaw" | "storyPrompt" | "notes" | "tags">;
  characters: CharacterAssetInput[];
  provider: CharacterGenerationProvider;
  continuityPath?: string;
  continuityPathsByCharacterId?: Partial<Record<string, string>>;
};

// The executable implementation is shared with the stock-Node focused check.
// @ts-expect-error The JavaScript runtime is intentionally dependency-free.
import { inferCharacterView as runtimeInferView, inferShotScale as runtimeInferScale, routeCharacterReferences as runtimeRoute, selectQueueCharacterReferences as runtimeSelectQueueReferences, resolvePreviousCharacterContinuityPaths as runtimeResolvePreviousContinuity, buildCharacterPassPlan as runtimeBuildPassPlan, scoreCharacterConsistency as runtimeScore, nextCharacterRetryDecision as runtimeNextRetry, createStoryboardAcceptedResult as runtimeAcceptedResult, createStoryboardNeedsReviewResult as runtimeNeedsReviewResult, createStoryboardFallbackReviewResult as runtimeFallbackReviewResult, planStoryboardOutcomeTransition as runtimeOutcomeTransition } from "./characterConsistencyRuntime.mjs";

export const inferCharacterView = runtimeInferView as (yaw?: number) => CharacterView;
export const inferShotScale = runtimeInferScale as (text?: string) => ShotScale;
export const routeCharacterReferences = runtimeRoute as (input: CharacterReferenceRoutingInput) => CharacterReferenceSelection[];
export const selectQueueCharacterReferences = runtimeSelectQueueReferences as (input: {
  references: CharacterReferenceSelection[];
  providerId: CharacterGenerationProvider;
}) => CharacterReferenceSelection[];
export const resolvePreviousCharacterContinuityPaths = runtimeResolvePreviousContinuity as (input: {
  currentShotIndex: number;
  allShots: Array<Pick<Shot, "id">>;
  characterIds: string[];
  layers: Array<{
    shotId: string;
    bitmapPath?: string;
    acceptedCompositePath?: string;
    characterGenerationMetadata?: { characterAssetId: string; status: "generated" | "accepted" | "needs_review" };
  }>;
}) => Record<string, string>;
export const buildCharacterPassPlan = runtimeBuildPassPlan as (input: CharacterPassPlanInput) => CharacterPassPlan[];
export const scoreCharacterConsistency = runtimeScore as (
  metrics: CharacterConsistencyMetrics,
  profile: CharacterConsistencyProfile
) => CharacterConsistencyScore;
export const nextCharacterRetryDecision = runtimeNextRetry as (
  input: CharacterRetryDecisionInput
) => CharacterRetryDecision;
export const createStoryboardAcceptedResult = runtimeAcceptedResult as (
  output: { previewUrl?: string; localPath?: string }
) => StoryboardAcceptedResult;
export const createStoryboardNeedsReviewResult = runtimeNeedsReviewResult as (
  bestPreviewPath: string,
  reasons?: string[]
) => StoryboardNeedsReviewResult;
export const createStoryboardFallbackReviewResult = runtimeFallbackReviewResult as (
  bestPreviewPath: string,
  reason: string
) => StoryboardNeedsReviewResult;
export const planStoryboardOutcomeTransition = runtimeOutcomeTransition as (
  outcome: StoryboardStagedGenerationResult
) => StoryboardOutcomeTransition;
