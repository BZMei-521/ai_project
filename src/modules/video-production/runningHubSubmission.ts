import {
  transitionRunningHubState,
  validateRunningHubApproval,
  type RunningHubApprovalInput,
  type RunningHubApprovalSnapshot,
  type RunningHubCloudRecord
} from "./runningHubApproval";

function safeTaskId(value: string): string {
  const id = value.trim();
  if (!/^\d{1,40}$/.test(id)) throw new Error("runninghub_task_id_invalid");
  return id;
}

function approvalInput(approval: RunningHubApprovalSnapshot): RunningHubApprovalInput {
  return {
    shotId: approval.shotId,
    workflowId: approval.workflowId,
    workflowUrl: approval.workflowUrl,
    references: approval.references,
    prompt: approval.prompt,
    width: approval.width,
    height: approval.height,
    durationSeconds: approval.durationSeconds,
    createdAt: approval.createdAt
  };
}

export function recordRunningHubSubmission(input: {
  approval: RunningHubApprovalSnapshot;
  taskId: string;
  state?: Pick<RunningHubCloudRecord, "status">;
}): Pick<RunningHubCloudRecord, "status" | "taskId" | "submittedAt"> {
  const taskId = safeTaskId(input.taskId);
  const checked = validateRunningHubApproval(input.approval, approvalInput(input.approval));
  if (!checked.ok) throw new Error(checked.reason);
  const state = input.state ?? { status: "approved" };
  if (state.status !== "approved") throw new Error("runninghub_state_transition_invalid");
  return {
    ...transitionRunningHubState(state, { type: "SUBMIT" }),
    taskId,
    submittedAt: new Date().toISOString()
  };
}
