import type { Asset, CharacterIdentityPack, Shot } from "../storyboard-core/types";

export type CharacterView = "front" | "left_three_quarter" | "right_three_quarter" | "left_profile" | "right_profile" | "back";
export type ShotScale = "close" | "medium" | "wide";

export type CharacterReferenceSelection = {
  kind: "face_angle" | "face_master" | "body_view" | "hair_back" | "continuity";
  path: string;
};

export type CharacterPassPlan = {
  characterAssetId: string;
  characterName: string;
  roleIndex: number;
  provider: string;
  view: CharacterView;
  shotScale: ShotScale;
  references: CharacterReferenceSelection[];
  triggerWord: string;
  protectPreviousCharacters: boolean;
  refineHead: boolean;
};

export type CharacterReferenceRoutingInput = {
  identityPack: CharacterIdentityPack;
  view: CharacterView;
  shotScale: ShotScale;
  continuityPath?: string;
};

export type CharacterPassPlanInput = {
  shot: Pick<Shot, "id" | "title" | "cameraYaw" | "storyPrompt" | "notes" | "tags">;
  characters: Array<Pick<Asset, "id" | "name" | "characterIdentityPack"> & { continuityPath?: string }>;
  provider: string;
  continuityPath?: string;
};

// The executable implementation is shared with the stock-Node focused check.
// @ts-expect-error The JavaScript runtime is intentionally dependency-free.
import { inferCharacterView as runtimeInferView, inferShotScale as runtimeInferScale, routeCharacterReferences as runtimeRoute, buildCharacterPassPlan as runtimeBuildPassPlan } from "./characterConsistencyRuntime.mjs";

export const inferCharacterView = runtimeInferView as (yaw?: number) => CharacterView;
export const inferShotScale = runtimeInferScale as (text?: string) => ShotScale;
export const routeCharacterReferences = runtimeRoute as (input: CharacterReferenceRoutingInput) => CharacterReferenceSelection[];
export const buildCharacterPassPlan = runtimeBuildPassPlan as (input: CharacterPassPlanInput) => CharacterPassPlan[];
