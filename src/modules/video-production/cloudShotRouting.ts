export type CloudRecommendationReason =
  | "character_contact"
  | "ordered_fast_actions"
  | "combined_subject_camera_motion"
  | "crowd_spatial_action"
  | "local_quality_exhausted";

export interface CloudShotSignals {
  namedCharacterCount: number;
  hasCharacterContact: boolean;
  hasOcclusionExchange: boolean;
  hasPropTransfer: boolean;
  orderedActionBeatCount: number;
  hasCharacterMotion: boolean;
  hasCameraMotion: boolean;
  hasCrowdAction: boolean;
  localQualityFailureCount: number;
  localRetryLimit: number;
}

export interface CloudShotRecommendation {
  status: "local_default" | "cloud_recommended";
  reasons: CloudRecommendationReason[];
}

// @ts-ignore JavaScript runtime intentionally has no declaration file.
import { recommendRunningHub as runtimeRecommendRunningHub } from "./cloudShotRoutingRuntime.mjs";

export const recommendRunningHub = runtimeRecommendRunningHub as (
  input: Partial<CloudShotSignals>
) => CloudShotRecommendation;
