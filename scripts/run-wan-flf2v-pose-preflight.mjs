import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  compileDWPoseWorkflow,
  normalizeDWPoseHistoryJson,
  validateDWPoseObjectInfo
} from "./run-wan-flf2v-endpoint.mjs";
import { buildHalfStepTarget, writePoseEvidence } from "./lib/wan-flf2v-pose-guide.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:8188";
const DEFAULT_ROOT = resolve("logs/video-quality-one-take-flf2v-pose");
const PRESET_PATH = resolve("src/modules/comfy-pipeline/presets/dwpose-half-step-extract-v1.json");
const LEGACY_REPORT_PATH = resolve("logs/video-quality-one-take-flf2v/wan-flf2v-report.json");
const AUTHORITY_REPORT_PATH = resolve("logs/video-quality-one-take/wan-one-take-report.json");

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function responseJson(response, label) {
  if (!response.ok) throw new Error(`${label} failed ${response.status}: ${await response.text()}`);
  return response.json();
}

function atomicJson(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

function uploadedPath(value) {
  const name = String(value?.name || "").trim();
  const subfolder = String(value?.subfolder || "").trim().replace(/\\/g, "/");
  if (!name) throw new Error("Comfy upload returned no filename");
  return subfolder ? `${subfolder}/${name}` : name;
}

export async function runDWPosePreflight(options = {}, dependencies = {}) {
  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const experimentRoot = resolve(options.experimentRoot || DEFAULT_ROOT);
  const reportPath = resolve(options.reportPath || join(experimentRoot, "wan-flf2v-report.json"));
  const outputDir = resolve(options.outputDir || join(experimentRoot, "preflight"));
  const fetchImpl = dependencies.fetchImpl || fetch;
  const wait = dependencies.wait || ((milliseconds) => new Promise((done) => setTimeout(done, milliseconds)));
  if (existsSync(outputDir)) throw new Error(`preflight directory already exists: ${outputDir}`);

  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const legacyBefore = sha256File(LEGACY_REPORT_PATH);
  const authorityBefore = sha256File(AUTHORITY_REPORT_PATH);
  if (sha256File(report.startFrame.path) !== report.startFrame.sha256) throw new Error("approved start frame hash mismatch");

  const queue = await responseJson(await fetchImpl(`${baseUrl}/queue`), "Comfy queue inventory");
  if ((queue.queue_running || []).length || (queue.queue_pending || []).length) throw new Error("Comfy queue is not empty");
  const preset = JSON.parse(readFileSync(PRESET_PATH, "utf8"));
  const objectInfo = await responseJson(await fetchImpl(`${baseUrl}/object_info`), "Comfy object_info");
  validateDWPoseObjectInfo(preset, objectInfo);

  mkdirSync(outputDir, { recursive: false });
  let promptId = null;
  try {
    const form = new FormData();
    form.append("image", new Blob([readFileSync(report.startFrame.path)], { type: "image/png" }), "approved_start.png");
    form.append("type", "input");
    form.append("subfolder", "wan-flf2v-pose/preflight");
    form.append("overwrite", "false");
    const uploaded = await responseJson(await fetchImpl(`${baseUrl}/upload/image`, { method: "POST", body: form }), "Comfy upload");
    const startInput = uploadedPath(uploaded);
    const workflow = compileDWPoseWorkflow(preset, { START_FRAME_PATH: startInput, CANDIDATE_PADDED: "preflight" });
    const queued = await responseJson(await fetchImpl(`${baseUrl}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: "wan-flf2v-dwpose-preflight" })
    }), "Comfy DWPose queue");
    promptId = String(queued?.prompt_id || "").trim();
    if (!promptId) throw new Error("Comfy DWPose queue returned no prompt_id");

    const deadline = Date.now() + 10 * 60 * 1000;
    let sourcePose;
    let imageReference;
    while (Date.now() < deadline) {
      await wait(2000);
      const historyEnvelope = await responseJson(
        await fetchImpl(`${baseUrl}/history/${encodeURIComponent(promptId)}`),
        "Comfy DWPose history"
      );
      const history = historyEnvelope?.[promptId];
      if (!history) continue;
      const rawPose = history.outputs?.["2"]?.openpose_json;
      const images = history.outputs?.["3"]?.images;
      if (rawPose !== undefined && Array.isArray(images) && images.length === 1) {
        sourcePose = normalizeDWPoseHistoryJson(rawPose);
        [imageReference] = images;
        break;
      }
      const status = String(history.status?.status_str || "").toLowerCase();
      if (history.status?.completed || ["success", "failed", "error"].includes(status)) {
        throw new Error(`Comfy DWPose completed without required JSON and preview: ${JSON.stringify(history.status)}`);
      }
    }
    if (!sourcePose || !imageReference) throw new Error(`Comfy DWPose timed out: ${promptId}`);

    const query = new URLSearchParams({
      filename: imageReference.filename,
      subfolder: imageReference.subfolder || "",
      type: imageReference.type || "output"
    });
    const previewResponse = await fetchImpl(`${baseUrl}/view?${query}`);
    if (!previewResponse.ok) throw new Error(`Comfy DWPose preview download failed ${previewResponse.status}`);
    const previewPath = join(outputDir, "dwpose_preview.png");
    writeFileSync(previewPath, Buffer.from(await previewResponse.arrayBuffer()));
    writeFileSync(join(outputDir, "source_pose_raw.json"), `${JSON.stringify(sourcePose, null, 2)}\n`, "utf8");

    const transformed = buildHalfStepTarget(sourcePose);
    const artifacts = writePoseEvidence({ ...transformed, outputDir });
    const protectedReports = {
      legacySha256: sha256File(LEGACY_REPORT_PATH),
      authoritySha256: sha256File(AUTHORITY_REPORT_PATH)
    };
    if (protectedReports.legacySha256 !== legacyBefore || protectedReports.authoritySha256 !== authorityBefore) {
      throw new Error("protected report changed during DWPose preflight");
    }
    const result = {
      schemaVersion: 1,
      status: "passed",
      promptId,
      uploadedPath: startInput,
      previewPath,
      previewSha256: sha256File(previewPath),
      ...artifacts,
      protectedReports
    };
    atomicJson(join(outputDir, "preflight-result.json"), result);
    return result;
  } catch (error) {
    const failure = {
      schemaVersion: 1,
      status: "failed",
      promptId,
      error: String(error instanceof Error ? error.message : error),
      protectedReports: {
        legacySha256: sha256File(LEGACY_REPORT_PATH),
        authoritySha256: sha256File(AUTHORITY_REPORT_PATH)
      }
    };
    atomicJson(join(outputDir, "preflight-failure.json"), failure);
    throw error;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  runDWPosePreflight().then(
    (result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    (error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; }
  );
}
