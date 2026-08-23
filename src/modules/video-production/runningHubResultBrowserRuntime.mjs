import { validateRunningHubApproval, transitionRunningHubState } from "./runningHubApprovalRuntime.mjs";

export const RIFE_ERROR_SIGNATURE = "Tensor type unknown to einops <class 'tuple'>";

function safeTaskId(value) {
  const id = String(value ?? "").trim();
  if (!/^\d{1,40}$/.test(id)) throw new Error("runninghub_task_id_invalid");
  return id;
}

function approvalInput(approval) {
  return { shotId: approval.shotId, workflowId: approval.workflowId, workflowUrl: approval.workflowUrl, references: approval.references, prompt: approval.prompt, width: approval.width, height: approval.height, durationSeconds: approval.durationSeconds, createdAt: approval.createdAt };
}

export function classifyRunningHubResult({ taskStatus, validMp4, downstreamError } = {}) {
  const valid = validMp4 === true;
  if (valid && ["failed", "error", "failed_postprocess"].includes(String(taskStatus).toLowerCase()) && typeof downstreamError === "string" && downstreamError.length <= 4096 && downstreamError.includes(RIFE_ERROR_SIGNATURE)) return { status: "recovered_primary_output", warning: "rife_postprocess_failed_primary_output_recovered" };
  if (valid && ["success", "completed", "succeeded", "output_collected"].includes(String(taskStatus).toLowerCase())) return { status: "output_collected" };
  return { status: "failed", reason: downstreamError || "runninghub_output_invalid" };
}

export function recordRunningHubSubmission({ approval, taskId, state = { status: "approved" } } = {}) {
  const id = safeTaskId(taskId);
  const checked = validateRunningHubApproval(approval, approvalInput(approval));
  if (!checked.ok) throw new Error(checked.reason);
  if (state.status !== "approved") throw new Error("runninghub_state_transition_invalid");
  return { ...transitionRunningHubState(state, { type: "SUBMIT" }), taskId: id, submittedAt: new Date().toISOString() };
}
