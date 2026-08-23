import type { StoryboardGenerationTask } from "../storyboard-core/types";

// @ts-expect-error The JavaScript runtime is intentionally dependency-free for stock-Node focused tests.
import * as runtime from "./characterRedrawTaskPreviewRuntime.mjs";

export type CharacterRedrawReviewPreview = {
  scope: "face_hair" | "upper_body" | "full_character";
  task: StoryboardGenerationTask;
};

export const selectCharacterRedrawReviewPreviews = runtime.selectCharacterRedrawReviewPreviews as (
  tasks: StoryboardGenerationTask[],
  target: { shotId: string; characterAssetId: string }
) => CharacterRedrawReviewPreview[];
