import {
  beginVideoAssemblyRun,
  cleanupVideoAssemblyAssets,
  extractVideoReviewFrames,
  normalizeVideoSegment,
  probeVideoSegment,
  stageVideoSegment,
  retainVideoAssemblyRun,
  discardRetainedVideoAssemblyRun,
  verifyNormalizationCredential,
  verifyVideoReviewFrames,
  verifyVideoAssemblyReceipt
} from "../platform/desktopBridge";
import type { Project, Shot } from "../storyboard-core/types";
import type { VideoBoundaryPlan } from "./continuityPlanner";
import type { VideoProfilePreflightReport, VideoRouteDecision } from "./types";
import { evaluateVideoQuality } from "./videoQuality";
import type { VideoOperationIdentity, VideoProductionEvidence, VideoProviderArtifact, VideoQualityReport, VideoRebuildRequest } from "./videoQuality";

export interface VideoProductionControllerInput {
  sequenceId?: string;
  contractDigest?: string;
  shotId: string;
  generatedVideoPath: string;
  durationFrames: number;
  projectWidth: number;
  projectHeight: number;
  routeDecision: VideoRouteDecision;
  accelerationMode: NonNullable<Shot["videoAccelerationMode"]>;
  profilePreflight: VideoProfilePreflightReport;
  boundary?: VideoBoundaryPlan;
  operation?: VideoOperationIdentity;
  generationReceipt?: Shot["videoGenerationReceipt"];
  providerArtifact?: VideoProviderArtifact;
}

export interface GeneratedVideoResult { ok: boolean; generatedVideoPath?: string; [key: string]: unknown; }

export interface VideoProductionController {
  processGeneratedShot(input: VideoProductionControllerInput): Promise<VideoProductionEvidence>;
  verifyForDecision(evidence: VideoProductionEvidence): Promise<VideoQualityReport>;
  rebuild(request: VideoRebuildRequest, resolveInput: (shotId: string, generatedVideoPath: string, previousEvidence?: VideoProductionEvidence, generated?: GeneratedVideoResult) => Promise<VideoProductionControllerInput> | VideoProductionControllerInput): Promise<VideoProductionEvidence[]>;
}

// @ts-ignore Plain ESM runtime is used by the executable contract.
import { createVideoProductionController as runtimeCreateController } from "./videoProductionControllerRuntime.mjs";

export function createVideoProductionController(options: {
  persistEvidence: (shotId: string, evidence: VideoProductionEvidence) => void;
  generateShot: (shotId: string, options?: { request?: VideoRebuildRequest; previousEvidence?: VideoProductionEvidence }) => Promise<GeneratedVideoResult>;
  isOperationCurrent?: (operation: unknown) => boolean | Promise<boolean>;
  persistEvidenceCAS?: (operation: unknown, evidence: VideoProductionEvidence) => boolean | Promise<boolean>;
  persistBatchCAS?: (items: unknown[]) => boolean | Promise<boolean>;
}): VideoProductionController {
  const controller = runtimeCreateController({
    beginRun: beginVideoAssemblyRun,
    stage: stageVideoSegment,
    probe: probeVideoSegment,
    normalize: normalizeVideoSegment,
    extractReviewFrames: extractVideoReviewFrames,
    verifyCredential: verifyNormalizationCredential,
    verifyReviewRecord: verifyVideoReviewFrames,
    verifyAssemblyReceipt: verifyVideoAssemblyReceipt,
    completeRun: ({ runCapability }: { runCapability: Parameters<typeof retainVideoAssemblyRun>[0] }) => retainVideoAssemblyRun(runCapability),
    releaseRun: ({ runCapability }: { runCapability: Parameters<typeof discardRetainedVideoAssemblyRun>[0] }) => discardRetainedVideoAssemblyRun(runCapability),
    cleanupRun: cleanupVideoAssemblyAssets,
    persistEvidence: options.persistEvidence,
    generateShot: options.generateShot,
    isOperationCurrent: options.isOperationCurrent,
    persistEvidenceCAS: options.persistEvidenceCAS,
    persistBatchCAS: options.persistBatchCAS
  }) as VideoProductionController;
  return {
    ...controller,
    async processGeneratedShot(input) {
      assertProviderArtifact(input.providerArtifact);
      const evidence = await controller.processGeneratedShot(input);
      return input.providerArtifact ? { ...evidence, providerArtifact: input.providerArtifact } : evidence;
    },
    async verifyForDecision(evidence) {
      assertProviderArtifact(evidence.providerArtifact);
      return controller.verifyForDecision(evidence);
    }
  };
}

export function createControllerInputFromShot(input: {
  shot: Shot;
  project: Project;
  routeDecision: VideoRouteDecision;
  profilePreflight: VideoProfilePreflightReport;
  boundary?: VideoBoundaryPlan;
  operation?: VideoOperationIdentity;
  generationReceipt?: Shot["videoGenerationReceipt"];
}): VideoProductionControllerInput {
  const generatedVideoPath = input.shot.generatedVideoPath?.trim() ?? "";
  if (!generatedVideoPath) throw new Error("generated_video_path_missing");
  return {
    sequenceId: input.shot.sequenceId,
    shotId: input.shot.id,
    generatedVideoPath,
    durationFrames: input.shot.durationFrames,
    projectWidth: input.project.width,
    projectHeight: input.project.height,
    routeDecision: input.routeDecision,
    accelerationMode: input.shot.videoAccelerationMode ?? "standard",
    profilePreflight: input.profilePreflight,
    boundary: input.boundary,
    operation: input.operation,
    generationReceipt: input.generationReceipt ?? input.shot.videoGenerationReceipt,
    providerArtifact: input.shot.videoProviderArtifact ?? (input.shot.runningHubCloud ? { provider: "runninghub" } : { provider: "local_comfy", watermarkDisposition: "not_applicable" })
  };
}

function assertProviderArtifact(providerArtifact?: VideoProviderArtifact) {
  if (!providerArtifact) return;
  const evaluation = evaluateVideoQuality({ normalized: true, providerArtifact });
  if (evaluation.structuralIssues.includes("runninghub_watermark_not_clean")) throw new Error("runninghub_watermark_not_clean");
}
