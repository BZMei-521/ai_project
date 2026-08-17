import type { VideoBoundaryKind } from "./types";

export type BoundaryApprovalStatus = "pending" | "approved" | "rejected";
export type ContinuityExecutionStatus = "ready" | "awaiting_approval";

export interface ContinuityPlannerShot {
  id: string;
  order?: number;
  videoBoundaryKind?: VideoBoundaryKind;
  characterAnchorPaths?: string[];
  sceneAnchorPath?: string;
  colorAnchorPath?: string;
  sceneState?: unknown;
  characterState?: unknown;
  timeState?: unknown;
  statusSummary?: unknown;
  approvedTailFramePath?: string;
  tailFrameApprovalStatus?: BoundaryApprovalStatus;
}

export interface VideoBoundaryInput {
  fromShotId: string;
  toShotId: string;
  kind: VideoBoundaryKind;
  sharedFramePath?: string;
  sharedFrameSource?: "independent" | string;
  approvalStatus?: BoundaryApprovalStatus;
}

export interface VideoBoundaryPlan {
  id: string;
  fromShotId: string;
  toShotId: string;
  kind: VideoBoundaryKind;
  sharedFramePath?: string;
  requiresApproval: boolean;
  approvalStatus: BoundaryApprovalStatus;
  sharedFrameSource?: string;
}

export interface ContinuitySegment {
  id: string;
  shotIds: string[];
  characterAnchorPaths: string[];
  sceneAnchorPath?: string;
  colorAnchorPath?: string;
  boundaries: VideoBoundaryPlan[];
}

export interface ShotContinuityExecution {
  shotId: string;
  taskId: string;
  status: ContinuityExecutionStatus;
  blockReason?: string;
  dependencyTaskIds: string[];
  firstFrameInput?: {
    kind: "approved_tail_frame" | "approved_shared_frame";
    path: string;
    boundaryId: string;
    fromShotId?: string;
  };
}

export interface VideoContinuityPlan {
  segments: ContinuitySegment[];
  boundaries: VideoBoundaryPlan[];
  shotExecutions: ShotContinuityExecution[];
  assemblyTaskId: string;
  shotStateSignatures: Array<{ shotId: string; signature: string }>;
  statusSummary: { total: number; ready: number; awaitingApproval: number };
}

export interface ContinuityInvalidationPlan {
  staleShotIds: string[];
  staleTaskIds: string[];
  reasons: string[];
}

// @ts-ignore JavaScript runtime intentionally has no declaration file.
import { planVideoContinuity as runtimePlanVideoContinuity, planContinuityInvalidation as runtimePlanContinuityInvalidation } from "./continuityPlannerRuntime.mjs";

export const planVideoContinuity = runtimePlanVideoContinuity as (input?: {
  shots?: ContinuityPlannerShot[];
  boundaries?: VideoBoundaryInput[];
  assemblyTaskId?: string;
}) => VideoContinuityPlan;

export const planContinuityInvalidation = runtimePlanContinuityInvalidation as (
  previousPlan?: Partial<VideoContinuityPlan>,
  nextPlan?: Partial<VideoContinuityPlan>
) => ContinuityInvalidationPlan;
