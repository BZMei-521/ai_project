export type RunningHubResultStatus = "output_collected" | "recovered_primary_output" | "failed";
export type RunningHubResultProbe = { width:number; height:number; fpsNum:number; fpsDen:number; durationSeconds:number; videoCodec:string; pixelFormat:string; audioSampleRate:number|null; audioChannels:number|null; hasMonotonicTimestamps:boolean; hasConstantFrameTimestamps:boolean; decodedFrameCount:number };
export type RunningHubResultReceipt = { schemaVersion:1; shotId:string; taskId:string; sourceSha256:string; importedPath:string; probe:RunningHubResultProbe; status:RunningHubResultStatus; warning?:string; importedAt:string };
// @ts-ignore JavaScript runtime intentionally has no declaration file.
import * as runtime from "./runningHubResult.mjs";
export const classifyRunningHubResult = runtime.classifyRunningHubResult as (input: {taskStatus?:string; validMp4?:boolean; downstreamError?:string}) => {status:RunningHubResultStatus; reason?:string; warning?:string};
export const recordRunningHubSubmission = runtime.recordRunningHubSubmission as (input: {approval: unknown; taskId:string; state?:unknown}) => unknown;
export const importRunningHubResult = runtime.importRunningHubResult as (input: Record<string, unknown>) => {receipt:RunningHubResultReceipt; cloud: {status:RunningHubResultStatus; importedOutput: RunningHubResultReceipt}};
