import type {
  AssemblyReceipt,
  AssemblyRunCapability,
  NormalizationCredential,
  VideoInspection,
  VideoReviewFrames,
  VerifiedVideoReviewRecord
} from "../platform/desktopBridge";
import type { VideoBoundaryPlan } from "./continuityPlanner";
import type { VideoProfilePreflightReport, VideoRouteDecision, VideoWorkflowProfileId } from "./types";

export type VideoQualityStatus = "rejected" | "needs_review" | "approved";
export type VideoSemanticReviewItem = "character_identity" | "scene_anchor" | "costume_prop" | "motion_boundary" | "color_continuity";

export interface VideoArtifactBinding {
  schemaVersion: 1;
  receiptId: string;
  normalizedPath: string;
  sha256: string;
  byteLength: number;
  modifiedUnixMillis: number;
  width: number;
  height: number;
  durationFrames: number;
  decodedFrameCount: number;
  reviewFramesDigest: string;
  reviewRecordMac: string;
  assemblyTransactionId?: string;
  assemblySha256?: string;
  assemblyOutputPath?: string;
}

export interface VideoOperationIdentity {
  sequenceId: string;
  shotId: string;
  contractDigest: string;
  sourceVideoPath: string;
  boundaryIdentity: string;
  operationToken: string;
  settingsIdentity?: string;
}

export interface VideoQualityDecisionRecord {
  decision: "approved" | "rejected";
  reviewedAt: string;
  reason?: string;
  artifactBinding: VideoArtifactBinding;
}

export interface VideoQualityReport {
  shotId: string;
  status: VideoQualityStatus;
  structuralIssues: string[];
  semanticReviewItems: VideoSemanticReviewItem[];
  reviewFrames: { first: string; middle: string; last: string };
  artifactBinding?: VideoArtifactBinding;
  boundaryFrame?: string;
  reviewedByUserAt?: string;
  rejectionReason?: string;
  decision?: VideoQualityDecisionRecord;
}

export type VideoProductionEvidenceStatus = "pending" | "processing" | "ready" | "failed";

export interface VideoProductionEvidence {
  schemaVersion: 1;
  shotId: string;
  status: VideoProductionEvidenceStatus;
  sourceVideoPath: string;
  sequenceId?: string;
  contractDigest?: string;
  boundaryIdentity?: string;
  operation?: VideoOperationIdentity;
  routeDecision: VideoRouteDecision;
  profilePreflight: VideoProfilePreflightReport;
  boundary?: VideoBoundaryPlan;
  projectAssetsDir?: string;
  runCapability?: AssemblyRunCapability;
  stagingReceiptId?: string;
  normalizationCredential?: NormalizationCredential;
  inspection?: VideoInspection;
  reviewFrames?: VideoReviewFrames;
  reviewRecord?: VerifiedVideoReviewRecord;
  assemblyReceipt?: AssemblyReceipt;
  artifactBinding?: VideoArtifactBinding;
  qualityReport?: VideoQualityReport;
  decision?: VideoQualityDecisionRecord;
  generationReceipt?: ShotGenerationReceipt;
  failureReason?: string;
}

export interface ShotGenerationReceipt {
  profileId: VideoWorkflowProfileId;
  accelerationMode: string;
  workflowDigest: string;
  inputDigest: string;
  promptId: string;
  normalizedPath?: string;
  contractDigest?: string;
  operationToken?: string;
  generatedAt: string;
}

export interface VideoQualityEvaluationInput {
  normalized?: boolean;
  normalizationCredential?: NormalizationCredential | Record<string, unknown>;
  inspection?: VideoInspection | Record<string, unknown>;
  reviewFrames?: VideoReviewFrames | VideoQualityReport["reviewFrames"] | Record<string, unknown>;
  reviewRecord?: VerifiedVideoReviewRecord | Record<string, unknown>;
  assemblyReceipt?: AssemblyReceipt | Record<string, unknown>;
  boundaryFrame?: string;
  blackFrameCount?: number;
  freezeDurationSeconds?: number;
  timestampErrors?: number;
}

export interface VideoProductionRow {
  sequenceId: string;
  shotId: string;
  title: string;
  order: number;
  selectedProfileId?: VideoWorkflowProfileId;
  routeReason: string;
  manualProfileId: VideoWorkflowProfileId | "auto";
  preflight?: VideoProfilePreflightReport;
  reviewFrames: VideoQualityReport["reviewFrames"];
  characterReferences: string[];
  sceneReferences: string[];
  boundaryFrame?: string;
  boundary?: VideoBoundaryPlan;
  artifactKey: string;
  report: VideoQualityReport;
  evidenceStatus?: VideoProductionEvidenceStatus;
  failureReason?: string;
}

export interface VideoRebuildRequest { kind: "shot" | "adjacent_pair" | "batch"; shotIds: string[]; reason: string; }

// @ts-ignore JavaScript runtime intentionally has no declaration file.
import { applyVideoQualityDecision as runtimeApply, artifactBindingsEqual as runtimeBindingsEqual, createVideoArtifactBinding as runtimeCreateBinding, createVideoQualityReport as runtimeCreateReport, evaluateVideoQuality as runtimeEvaluate, planVideoRebuildRequest as runtimePlanRebuild, resolvePersistedVideoDecision as runtimeResolveDecision } from "./videoQualityRuntime.mjs";

export const evaluateVideoQuality = runtimeEvaluate as (input?: VideoQualityEvaluationInput) => Pick<VideoQualityReport, "status" | "structuralIssues" | "semanticReviewItems">;
export const createVideoArtifactBinding = runtimeCreateBinding as (input: VideoQualityEvaluationInput) => VideoArtifactBinding;
export const createVideoQualityReport = runtimeCreateReport as (shotId: string, input?: VideoQualityEvaluationInput) => VideoQualityReport;
export const applyVideoQualityDecision = runtimeApply as (report: VideoQualityReport, decision: { decision: "approve" | "reject"; reason?: string; reviewedAt?: string }) => VideoQualityReport;
export const resolvePersistedVideoDecision = runtimeResolveDecision as (report: VideoQualityReport, decision?: VideoQualityDecisionRecord) => VideoQualityReport;
export const artifactBindingsEqual = runtimeBindingsEqual as (left?: VideoArtifactBinding, right?: VideoArtifactBinding) => boolean;
export const planVideoRebuildRequest = runtimePlanRebuild as (input: { shotId: string; orderedShotIds: string[]; reason: string; boundary?: VideoBoundaryPlan }) => VideoRebuildRequest;
