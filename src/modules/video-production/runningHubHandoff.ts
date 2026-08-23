import { prepareRunningHubHandoffPacket, type RunningHubHandoffReceipt } from "../platform/desktopBridge";
import { validateRunningHubApproval, type RunningHubApprovalSnapshot } from "./runningHubApproval";

export type { RunningHubHandoffReceipt } from "../platform/desktopBridge";

export type RunningHubHandoffRequest = {
  projectAssetsDir: string;
  approval: RunningHubApprovalSnapshot;
};

export type RunningHubHandoffTransport = (request: RunningHubHandoffRequest) => Promise<RunningHubHandoffReceipt>;

export function createRunningHubHandoffPreparer(transport: RunningHubHandoffTransport): (request: RunningHubHandoffRequest) => Promise<RunningHubHandoffReceipt> {
  const consumedDigests = new Set<string>();
  const reservedDigests = new Set<string>();
  return async (request) => {
    const projectAssetsDir = requireAbsoluteProjectAssetsDir(request?.projectAssetsDir);
    const approval = request?.approval;
    const unavailableDigests = new Set([...consumedDigests, ...reservedDigests]);
    const validation = validateRunningHubApproval(approval, approvalInput(approval), unavailableDigests);
    if (!validation.ok) throw new Error(validation.reason);
    reservedDigests.add(approval.inputDigest);
    try {
      const receipt = await transport({ projectAssetsDir, approval });
      if (receipt.status !== "prepared" || receipt.inputDigest !== approval.inputDigest || receipt.workflowUrl !== approval.workflowUrl) {
        throw new Error("runninghub_handoff_receipt_invalid");
      }
      consumedDigests.add(approval.inputDigest);
      return receipt;
    } finally {
      reservedDigests.delete(approval.inputDigest);
    }
  };
}

export const prepareRunningHubHandoff = createRunningHubHandoffPreparer(prepareRunningHubHandoffPacket);

function approvalInput(approval: RunningHubApprovalSnapshot | undefined) {
  return {
    shotId: approval?.shotId ?? "",
    workflowId: approval?.workflowId,
    workflowUrl: approval?.workflowUrl,
    references: approval?.references ?? [],
    prompt: approval?.prompt ?? "",
    width: approval?.width ?? 0,
    height: approval?.height ?? 0,
    durationSeconds: approval?.durationSeconds ?? 0,
    createdAt: approval?.createdAt ?? ""
  } as Parameters<typeof validateRunningHubApproval>[1];
}

function requireAbsoluteProjectAssetsDir(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) throw new Error("runninghub_project_assets_dir_missing");
  if (!trimmed.startsWith("/") && !/^[a-zA-Z]:[\\/]/.test(trimmed) && !/^\\\\[^\\]+\\[^\\]+/.test(trimmed)) {
    throw new Error("runninghub_project_assets_dir_invalid");
  }
  return trimmed;
}
