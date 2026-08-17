import type {
  VideoAccelerationMode,
  VideoProfilePreflightReport,
  VideoQualityTier,
  VideoWorkflowProfile
} from "./types";

// The executable implementation remains dependency-free for the Node registry check.
// @ts-ignore JavaScript runtime intentionally has no declaration file.
import { MINIMAX_H3_PROFILES as runtimeProfiles, preflightVideoAcceleration as runtimePreflightAcceleration, preflightVideoProfile as runtimePreflightProfile } from "./workflowProfilesRuntime.mjs";

export const MINIMAX_H3_PROFILES = runtimeProfiles as VideoWorkflowProfile[];
export const preflightVideoProfile = runtimePreflightProfile as (
  profile: VideoWorkflowProfile,
  inventory: { nodes?: string[]; models?: Record<string, string[]> }
) => VideoProfilePreflightReport;
export const preflightVideoAcceleration = runtimePreflightAcceleration as (
  mode: VideoAccelerationMode,
  qualityTier: VideoQualityTier,
  inventory: { nodes?: string[] }
) => { available: boolean; warnings: string[] };
