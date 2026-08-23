export type RunningHubCloudState =
  | "local_default" | "cloud_recommended" | "awaiting_approval" | "approved" | "submitted" | "running"
  | "output_collected" | "recovered_primary_output" | "watermark_checked" | "watermark_review_required"
  | "quality_review" | "accepted" | "declined" | "cancelled" | "failed" | "timed_out";

export type RunningHubApprovalSnapshot = {
  schemaVersion: 1;
  shotId: string;
  workflowId: "2090035427871903746";
  workflowUrl: "https://www.runninghub.cn/workflow/2090035427871903746?source=workspace";
  references: [string, string];
  prompt: string;
  width: number;
  height: number;
  durationSeconds: number;
  createdAt: string;
  inputDigest: string;
};

export type RunningHubCloudRecord = {
  status: RunningHubCloudState;
  approval?: RunningHubApprovalSnapshot;
  taskId?: string;
  submittedAt?: string;
  importedOutput?: Record<string, unknown>;
  watermarkReceipt?: Record<string, unknown>;
  acceptedAt?: string;
};

export type RunningHubApprovalInput = Omit<RunningHubApprovalSnapshot, "schemaVersion" | "inputDigest">;
export type RunningHubApprovalValidation = { ok: true } | { ok: false; reason: "approval_input_changed" | "approval_already_consumed" };

// @ts-ignore JavaScript runtime intentionally has no declaration file.
import * as runtime from "./runningHubApprovalRuntime.mjs";

export const createRunningHubApprovalSnapshot = runtime.createRunningHubApprovalSnapshot as (input: RunningHubApprovalInput) => RunningHubApprovalSnapshot;
export const validateRunningHubApproval = runtime.validateRunningHubApproval as (snapshot: RunningHubApprovalSnapshot, currentInput: RunningHubApprovalInput, consumedDigests?: Set<string>) => RunningHubApprovalValidation;
export const consumeRunningHubApproval = runtime.consumeRunningHubApproval as (snapshot: RunningHubApprovalSnapshot, currentInput: RunningHubApprovalInput, consumedDigests?: Set<string>) => RunningHubApprovalValidation;
export const transitionRunningHubState = runtime.transitionRunningHubState as (state: Pick<RunningHubCloudRecord, "status">, event: { type: string }) => Pick<RunningHubCloudRecord, "status">;
