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
};

// The executable implementation is shared with the stock-Node focused check.
// @ts-expect-error The JavaScript runtime is intentionally dependency-free.
import { inferCharacterView as runtimeInferView, inferShotScale as runtimeInferScale, routeCharacterReferences as runtimeRoute, buildCharacterPassPlan as runtimeBuildPassPlan } from "./characterConsistencyRuntime.mjs";

export const inferCharacterView = runtimeInferView as (yaw?: number) => CharacterView;
export const inferShotScale = runtimeInferScale as (text?: string) => ShotScale;
export const routeCharacterReferences = runtimeRoute as (input: CharacterReferenceRoutingInput) => CharacterReferenceSelection[];
export const buildCharacterPassPlan = runtimeBuildPassPlan as (input: CharacterPassPlanInput) => CharacterPassPlan[];
