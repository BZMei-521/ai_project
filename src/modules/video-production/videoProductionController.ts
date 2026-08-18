import {
  beginVideoAssemblyRun,
  extractVideoReviewFrames,
  normalizeVideoSegment,
  probeVideoSegment,
  stageVideoSegment,
  verifyNormalizationCredential,
  verifyVideoAssemblyReceipt
} from "../platform/desktopBridge";
import type { Project, Shot } from "../storyboard-core/types";
import type { VideoBoundaryPlan } from "./continuityPlanner";
import type { VideoProfilePreflightReport, VideoRouteDecision } from "./types";
import type { VideoProductionEvidence, VideoQualityReport, VideoRebuildRequest } from "./videoQuality";

export interface VideoProductionControllerInput {
  shotId: string;
  generatedVideoPath: string;
  durationFrames: number;
  projectWidth: number;
  projectHeight: number;
  routeDecision: VideoRouteDecision;
  profilePreflight: VideoProfilePreflightReport;
  boundary?: VideoBoundaryPlan;
}

export interface GeneratedVideoResult { ok: boolean; generatedVideoPath?: string; }

export interface VideoProductionController {
  processGeneratedShot(input: VideoProductionControllerInput): Promise<VideoProductionEvidence>;
  verifyForDecision(evidence: VideoProductionEvidence): Promise<VideoQualityReport>;
  rebuild(request: VideoRebuildRequest, resolveInput: (shotId: string, generatedVideoPath: string) => Promise<VideoProductionControllerInput> | VideoProductionControllerInput): Promise<VideoProductionEvidence[]>;
}

// @ts-ignore Plain ESM runtime is used by the executable contract.
import { createVideoProductionController as runtimeCreateController } from "./videoProductionControllerRuntime.mjs";

export function createVideoProductionController(options: {
  persistEvidence: (shotId: string, evidence: VideoProductionEvidence) => void;
  generateShot: (shotId: string) => Promise<GeneratedVideoResult>;
}): VideoProductionController {
  return runtimeCreateController({
    beginRun: beginVideoAssemblyRun,
    stage: stageVideoSegment,
    probe: probeVideoSegment,
    normalize: normalizeVideoSegment,
    extractReviewFrames: extractVideoReviewFrames,
    verifyCredential: verifyNormalizationCredential,
    verifyAssemblyReceipt: verifyVideoAssemblyReceipt,
    persistEvidence: options.persistEvidence,
    generateShot: options.generateShot
  }) as VideoProductionController;
}

export function createControllerInputFromShot(input: {
  shot: Shot;
  project: Project;
  routeDecision: VideoRouteDecision;
  profilePreflight: VideoProfilePreflightReport;
  boundary?: VideoBoundaryPlan;
}): VideoProductionControllerInput {
  const generatedVideoPath = input.shot.generatedVideoPath?.trim() ?? "";
  if (!generatedVideoPath) throw new Error("generated_video_path_missing");
  return {
    shotId: input.shot.id,
    generatedVideoPath,
    durationFrames: input.shot.durationFrames,
    projectWidth: input.project.width,
    projectHeight: input.project.height,
    routeDecision: input.routeDecision,
    profilePreflight: input.profilePreflight,
    boundary: input.boundary
  };
}
