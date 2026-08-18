import type { VideoBoundaryKind, VideoProfilePreflightReport, VideoWorkflowProfileId } from "./types";

export type VideoQualityStatus = "rejected" | "needs_review" | "approved";
export type VideoSemanticReviewItem =
  | "character_identity"
  | "scene_anchor"
  | "costume_prop"
  | "motion_boundary"
  | "color_continuity";

export interface VideoQualityReport {
  shotId: string;
  status: VideoQualityStatus;
  structuralIssues: string[];
  semanticReviewItems: VideoSemanticReviewItem[];
  reviewFrames: { first: string; middle: string; last: string };
  boundaryFrame?: string;
  reviewedByUserAt?: string;
  rejectionReason?: string;
}

export interface VideoQualityEvaluationInput {
  normalized?: boolean;
  blackFrameCount?: number;
  freezeDurationSeconds?: number;
  timestampErrors?: number;
  identityEvaluatorAvailable?: boolean;
  inspection?: {
    probe?: { hasMonotonicTimestamps?: boolean; hasConstantFrameTimestamps?: boolean };
    anomalies?: {
      blackIntervals?: Array<{ durationSeconds?: number }>;
      freezeIntervals?: Array<{ durationSeconds?: number }>;
    };
  };
  normalizationReceipt?: Record<string, unknown>;
  assemblyReceipt?: Record<string, unknown>;
  reviewFrames?: {
    first?: string;
    middle?: string;
    last?: string;
    firstFramePath?: string;
    middleFramePath?: string;
    lastFramePath?: string;
  };
  boundaryFrame?: string;
}

export interface VideoQualityDecision {
  decision: "approve" | "reject";
  reason?: string;
  reviewedAt?: string;
}

export interface VideoRebuildBoundary {
  kind: VideoBoundaryKind;
  fromShotId: string;
  toShotId: string;
}

export interface VideoRebuildRequest {
  kind: "shot" | "adjacent_pair";
  shotIds: string[];
  reason: string;
}

export interface VideoProductionRow {
  shotId: string;
  title: string;
  order: number;
  selectedProfileId?: VideoWorkflowProfileId;
  routeReason: string;
  manualProfileId: VideoWorkflowProfileId | "auto";
  preflight?: Pick<VideoProfilePreflightReport, "available" | "missingNodes"> & {
    missingModels: Array<string | { kind?: string; name: string }>;
    warnings?: string[];
  };
  reviewFrames: VideoQualityReport["reviewFrames"];
  characterReferences: string[];
  sceneReferences: string[];
  boundaryFrame?: string;
  boundary?: VideoRebuildBoundary;
  report: VideoQualityReport;
}

// @ts-ignore JavaScript runtime intentionally has no declaration file.
import { applyVideoQualityDecision as runtimeApplyVideoQualityDecision, createVideoQualityReport as runtimeCreateVideoQualityReport, evaluateVideoQuality as runtimeEvaluateVideoQuality, planVideoRebuildRequest as runtimePlanVideoRebuildRequest } from "./videoQualityRuntime.mjs";

export const evaluateVideoQuality = runtimeEvaluateVideoQuality as (
  input?: VideoQualityEvaluationInput
) => Pick<VideoQualityReport, "status" | "structuralIssues" | "semanticReviewItems">;

export const createVideoQualityReport = runtimeCreateVideoQualityReport as (
  shotId: string,
  input?: VideoQualityEvaluationInput
) => VideoQualityReport;

export const applyVideoQualityDecision = runtimeApplyVideoQualityDecision as (
  report: VideoQualityReport,
  decision: VideoQualityDecision
) => VideoQualityReport;

export const planVideoRebuildRequest = runtimePlanVideoRebuildRequest as (input: {
  shotId: string;
  orderedShotIds: string[];
  reason: string;
  boundary?: VideoRebuildBoundary;
}) => VideoRebuildRequest;
