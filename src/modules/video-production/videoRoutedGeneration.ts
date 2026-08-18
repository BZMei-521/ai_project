import type { ComfySettings } from "../comfy-pipeline/comfyService";
import { verifyVideoReviewFrames } from "../platform/desktopBridge";
import type { Asset, Project, Shot } from "../storyboard-core/types";
import type { VideoBoundaryPlan } from "./continuityPlanner";
import { generateRoutedVideoShot, getCanonicalH3WorkflowJson } from "./videoGeneration";
import { inspectVideoProductionInventory } from "./videoInventory";
// @ts-ignore Plain ESM is shared with the executable quality checker.
import { createVideoGenerationContractDigest } from "./videoProductionControllerRuntime.mjs";
import { routeVideoWorkflow } from "./videoRouter";
import { MINIMAX_H3_PROFILES, preflightVideoProfile } from "./workflowProfiles";
import type { VideoProductionEvidence } from "./videoQuality";

// @ts-ignore Executable JS is shared with the dependency-free quality checker.
import { createRoutedVideoGenerationExecutor } from "./videoRoutedGenerationRuntime.mjs";

export interface RoutedVideoSnapshot {
  sequenceId: string;
  shot: Shot;
  index: number;
  allShots: Shot[];
  assets: Asset[];
  project: Project;
  boundary?: VideoBoundaryPlan;
}

export function createRoutedVideoProductionGenerator(input: {
  settings: ComfySettings;
  readSnapshot: (shotId: string) => RoutedVideoSnapshot | Promise<RoutedVideoSnapshot>;
}) {
  return createRoutedVideoGenerationExecutor({
    settings: input.settings,
    readSnapshot: input.readSnapshot,
    inspectInventory: () => inspectVideoProductionInventory(input.settings.baseUrl),
    routeShot: (snapshot: RoutedVideoSnapshot) => routeShotWithCurrentInputs(snapshot.shot, snapshot.assets),
    preflightProfile: (route: { profileId: string }, inventory: Parameters<typeof preflightVideoProfile>[1]) => {
      const profile = MINIMAX_H3_PROFILES.find((item) => item.id === route.profileId);
      if (!profile) throw new Error("h3_profile_unknown");
      return preflightVideoProfile(profile, inventory);
    },
    workflowJsonForProfile: getCanonicalH3WorkflowJson,
    contractDigest: createVideoGenerationContractDigest,
    generateRoutedVideoShot,
    verifyFreshTail: async (evidence: VideoProductionEvidence) => {
      if (!evidence.projectAssetsDir || !evidence.normalizationCredential || !evidence.reviewFrames) throw new Error("video_boundary_evidence_missing");
      const record = await verifyVideoReviewFrames({
        projectAssetsDir: evidence.projectAssetsDir,
        credential: evidence.normalizationCredential,
        reviewFrames: evidence.reviewFrames
      });
      const last = record.frames.find((frame) => frame.role === "last");
      if (!last || last.path !== evidence.reviewFrames.lastFramePath) throw new Error("video_boundary_tail_authentication_failed");
      return last.path;
    }
  });
}

export function routeShotWithCurrentInputs(shot: Shot, assets: Asset[]) {
  const refs = (shot.characterRefs ?? []).filter((id) => assets.some((asset) => asset.id === id));
  return routeVideoWorkflow({
    manualProfileId: shot.videoWorkflowProfileId ?? "auto",
    qualityTier: shot.videoQualityTier ?? "production",
    accelerationMode: shot.videoAccelerationMode ?? "standard",
    availableProfileIds: MINIMAX_H3_PROFILES.map((profile) => profile.id),
    namedCharacterCount: Math.max(refs.length, shot.sourceCharacterNames?.length ?? 0),
    identityReferenceCount: refs.length,
    extraReferenceCount: shot.sceneRefId ? 1 : 0,
    hasSceneContinuity: Boolean(shot.sceneRefId),
    hasStoryboardFrame: Boolean(shot.generatedImagePath),
    hasFirstFrame: Boolean(shot.videoStartFramePath || shot.generatedImagePath),
    hasLastFrame: Boolean(shot.videoEndFramePath),
    hasApprovedBoundaryFrame: Boolean(shot.approvedBoundaryFramePath),
    hasDialogue: Boolean(shot.dialogue.trim()),
    boundaryKind: shot.videoBoundaryKind ?? "hard_cut"
  });
}
