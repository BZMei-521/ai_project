import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { validateRunningHubApproval, transitionRunningHubState } from "./runningHubApprovalRuntime.mjs";

export const RIFE_ERROR_SIGNATURE = "Tensor type unknown to einops <class 'tuple'>";

function absolute(value, code) {
  if (typeof value !== "string" || !value.trim() || !path.isAbsolute(value)) throw new Error(code);
  return path.resolve(value);
}
function safeTaskId(value) {
  const id = String(value ?? "").trim();
  if (!/^\d{1,40}$/.test(id)) throw new Error("runninghub_task_id_invalid");
  return id;
}
function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function fpsValue(probe) {
  const n = Number(probe?.fpsNum ?? probe?.fps_num), d = Number(probe?.fpsDen ?? probe?.fps_den);
  return Number.isFinite(n) && Number.isFinite(d) && n > 0 && d > 0 && Number.isFinite(n / d) ? n / d : NaN;
}
function normalizeProbe(probe) {
  return {
    width: Number(probe?.width), height: Number(probe?.height), fpsNum: Number(probe?.fpsNum ?? probe?.fps_num),
    fpsDen: Number(probe?.fpsDen ?? probe?.fps_den), durationSeconds: Number(probe?.durationSeconds ?? probe?.duration_seconds),
    videoCodec: String(probe?.videoCodec ?? probe?.video_codec ?? ""), pixelFormat: String(probe?.pixelFormat ?? probe?.pixel_format ?? ""),
    audioSampleRate: probe?.audioSampleRate ?? probe?.audio_sample_rate ?? null, audioChannels: probe?.audioChannels ?? probe?.audio_channels ?? null,
    hasMonotonicTimestamps: probe?.hasMonotonicTimestamps ?? probe?.has_monotonic_timestamps,
    hasConstantFrameTimestamps: probe?.hasConstantFrameTimestamps ?? probe?.has_constant_frame_timestamps,
    decodedFrameCount: Number(probe?.decodedFrameCount ?? probe?.decoded_frame_count)
  };
}
export function probeMp4(sourcePath) {
  const result = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,codec_name,pix_fmt,nb_frames:format=duration", "-of", "json", sourcePath], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("runninghub_probe_failed");
  const payload = JSON.parse(result.stdout || "{}");
  const stream = payload.streams?.[0];
  if (!stream) throw new Error("runninghub_probe_failed");
  const [n, d] = String(stream.r_frame_rate || "0/1").split("/").map(Number);
  const durationSeconds = Number(payload.format?.duration);
  const decodedFrameCount = Number(stream.nb_frames);
  return normalizeProbe({ width: stream.width, height: stream.height, fpsNum: n, fpsDen: d, durationSeconds, videoCodec: stream.codec_name, pixelFormat: stream.pix_fmt, hasMonotonicTimestamps: true, hasConstantFrameTimestamps: true, decodedFrameCount });
}
export function classifyRunningHubResult({ taskStatus, validMp4, downstreamError } = {}) {
  const valid = validMp4 === true;
  if (valid && ["failed", "error", "failed_postprocess"].includes(String(taskStatus).toLowerCase()) && typeof downstreamError === "string" && downstreamError.length <= 4096 && downstreamError.includes(RIFE_ERROR_SIGNATURE)) return { status: "recovered_primary_output", warning: "rife_postprocess_failed_primary_output_recovered" };
  if (valid && ["success", "completed", "succeeded", "output_collected"].includes(String(taskStatus).toLowerCase())) return { status: "output_collected" };
  return { status: "failed", reason: downstreamError || "runninghub_output_invalid" };
}
function approvalInput(approval) {
  return { shotId: approval.shotId, workflowId: approval.workflowId, workflowUrl: approval.workflowUrl, references: approval.references, prompt: approval.prompt, width: approval.width, height: approval.height, durationSeconds: approval.durationSeconds, createdAt: approval.createdAt };
}
export function recordRunningHubSubmission({ approval, taskId, state = { status: "approved" } } = {}) {
  const id = safeTaskId(taskId);
  const checked = validateRunningHubApproval(approval, approvalInput(approval));
  if (!checked.ok) throw new Error(checked.reason);
  if (state.status !== "approved") throw new Error("runninghub_state_transition_invalid");
  return { ...transitionRunningHubState(state, { type: "SUBMIT" }), taskId: id, submittedAt: new Date().toISOString() };
}
export function createRunningHubResultImporter({ probeMedia = probeMp4 } = {}) {
  return function importRunningHubResult({ projectAssetsDir, shotId, approval, taskId, sourcePath, reportedTaskStatus = "success", downstreamError, submission } = {}) {
  const assets = absolute(projectAssetsDir, "runninghub_project_assets_dir_missing");
  const source = absolute(sourcePath, "runninghub_source_path_missing");
  const id = safeTaskId(taskId);
  if (typeof shotId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(shotId)) throw new Error("runninghub_shot_id_invalid");
  if (approval?.shotId !== shotId) throw new Error("runninghub_shot_id_mismatch");
  const checked = validateRunningHubApproval(approval, approvalInput(approval));
  if (!checked.ok) throw new Error(checked.reason);
  if (submission?.status !== "submitted" || submission.taskId !== id || submission.approvalInputDigest !== approval.inputDigest) throw new Error("runninghub_submission_mismatch");
  if (!fs.existsSync(source) || !fs.statSync(source).isFile() || path.extname(source).toLowerCase() !== ".mp4") throw new Error("runninghub_source_mp4_invalid");
  const sourceSha256 = sha256File(source);
  const mediaProbe = normalizeProbe(probeMedia(source));
  const valid = mediaProbe.width > 0 && mediaProbe.height > 0 && mediaProbe.width % 2 === 0 && mediaProbe.height % 2 === 0 && Number.isFinite(fpsValue(mediaProbe)) && mediaProbe.hasMonotonicTimestamps === true && mediaProbe.decodedFrameCount > 0 && Number.isFinite(mediaProbe.durationSeconds) && Math.abs(mediaProbe.durationSeconds - approval.durationSeconds) <= 1;
  if (!valid) throw new Error("runninghub_media_contract_invalid");
  const classification = classifyRunningHubResult({ taskStatus: reportedTaskStatus, validMp4: true, downstreamError });
  if (classification.status === "failed") throw new Error(classification.reason);
  const dir = path.join(assets, "runninghub-results", id, sourceSha256);
  fs.mkdirSync(dir, { recursive: true });
  const destination = path.join(dir, "source.mp4");
  if (fs.existsSync(destination)) throw new Error("runninghub_result_already_exists");
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  const receipt = { schemaVersion: 1, shotId, taskId: id, approvalInputDigest: approval.inputDigest, sourceSha256, importedPath: destination, probe: mediaProbe, status: classification.status, ...(classification.warning ? { warning: classification.warning } : {}), importedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  return { receipt, cloud: { status: classification.status, importedOutput: receipt } };
}
}
export const importRunningHubResult = createRunningHubResultImporter();
