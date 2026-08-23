export type RunningHubResultStatus = "output_collected" | "recovered_primary_output" | "failed";

// @ts-ignore JavaScript runtime intentionally has no declaration file.
import * as runtime from "./runningHubResultBrowserRuntime.mjs";

export const classifyRunningHubResult = runtime.classifyRunningHubResult as (input: { taskStatus?: string; validMp4?: boolean; downstreamError?: string }) => { status: RunningHubResultStatus; reason?: string; warning?: string };
export const recordRunningHubSubmission = runtime.recordRunningHubSubmission as (input: { approval: unknown; taskId: string; state?: unknown }) => unknown;
