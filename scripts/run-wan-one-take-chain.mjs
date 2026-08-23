import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { extractVideoOutputs } from "./lib/comfy-output-media.mjs";
import {
  assertBoundaryHash,
  buildOneTakeConcatFilter,
  buildOneTakeSegments
} from "./lib/wan-one-take-chain.mjs";
import {
  assertAcceptedPrefix,
  canAssemble,
  markTechnicalAccepted
} from "./lib/wan-one-take-acceptance.mjs";

const comfyUrl = process.env.COMFYUI_URL || "http://127.0.0.1:8188";
const comfyOutputDir = "C:/Users/Administrator/AppData/Local/Comfy-Desktop/ComfyUI-Shared/output";
const reportDir = resolve("logs/video-quality-one-take");
const reportPath = resolve(reportDir, "wan-one-take-report.json");
const presetPath = resolve("src/modules/comfy-pipeline/presets/video-wan21-i2v-14b-fp8.json");
const initialFramePath = "C:/Users/Administrator/AppData/Local/Comfy-Desktop/ComfyUI-Shared/output/Storyboard/河边远景建立_klein_ref_00006_.png";
const maxAttempts = 3;
const frameCount = 17;

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const assembleMode = process.argv.includes("--assemble");
const hasGenerateMode = process.argv.includes("--generate-segment");
const generateSegment = Number(valueAfter("--generate-segment"));
const seedOffset = Number(valueAfter("--seed-offset") || 0);
const allowedSeedOffsets = new Set([0, 1000, 2000]);
const motionPrompts = [
  "Continue as one uninterrupted take. Extremely slow continuous forward camera push. Shen Yan makes one clearly visible small half-step forward with grounded foot contact while Jiang Lan performs only a subtle natural weight shift. Exactly two human characters: Shen Yan and Jiang Lan. One primary action once, then settle toward a natural pose. Preserve exact faces, hair, outfits and screen sides.",
  "Continue the exact same take and the same extremely slow forward camera push. Jiang Lan only turns her head toward Shen Yan and makes subtle natural speaking motion; both bodies stay on the same screen sides with grounded feet. Exactly two human characters. One primary action once, then settle naturally.",
  "Continue without a cut with the same extremely slow forward push. Jiang Lan makes one small single-hand explanatory gesture and then lowers that hand toward a relaxed position. Shen Yan only watches. Exactly two human characters; no synchronized gesture.",
  "Continue the same take and camera motion. Only Shen Yan raises his right hand once in a restrained warning gesture and begins lowering it. Jiang Lan keeps both hands relaxed and reacts only with her face and head. Exactly two human characters; no mirrored or synchronized gesture.",
  "Continue the uninterrupted extremely slow forward push. Shen Yan and Jiang Lan each take one clear small grounded step forward, with hands lowered and slight natural arm swing. Preserve exact identities, outfits, screen sides and human anatomy. Exactly two human characters. One walking action once, then settle.",
  "Continue to the end of the same take. Both characters naturally stop and plant their feet. Jiang Lan only looks toward the water while Shen Yan calmly scans the surroundings; both hands remain lowered. The extremely slow forward push eases into a stable final composition. Exactly two human characters."
];
const negativePrompt = "identity drift, face morphing, face replacement, hairstyle change, hair length change, clothing change, color change, identity swap, duplicated person, missing person, third person, extra limbs, malformed hands, warped body, floating feet, flicker, temporal jitter, scene cut, fast camera, strong zoom, camera shake, beast traits, animal features, animal ears, animalization, non-human transformation, both hands raised, arms held overhead, synchronized gestures, both characters raising hands, mirrored action, repeated gesture, gesture loop, prolonged held gesture, frozen pose, static pose, no visible motion, motionless body, sudden camera motion, fast push-in";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function replaceTokens(value, tokens) {
  if (typeof value === "string") {
    let output = value;
    for (const [key, replacement] of Object.entries(tokens)) output = output.split(`{{${key}}}`).join(String(replacement));
    return output;
  }
  if (Array.isArray(value)) return value.map((item) => replaceTokens(item, tokens));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTokens(item, tokens)]));
  return value;
}

function extractFinalFrame(videoPath, outputPath) {
  const result = spawnSync("ffmpeg", [
    "-y", "-v", "error", "-i", videoPath,
    "-vf", "select=eq(n\\,16)", "-frames:v", "1", outputPath
  ], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`final-frame extraction failed: ${result.stderr}`);
}

function runFfmpeg(args) {
  const result = spawnSync("ffmpeg", args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
}

function createSegmentContactSheet(videoPath, outputPath) {
  mkdirSync(resolve(reportDir, "contact-sheets"), { recursive: true });
  runFfmpeg([
    "-y", "-v", "error", "-i", videoPath,
    "-vf", "select=eq(n\\,0)+eq(n\\,8)+eq(n\\,16),scale=416:240,tile=3x1",
    "-frames:v", "1", outputPath
  ]);
}

function createBoundarySheets(segments, directory) {
  mkdirSync(directory, { recursive: true });
  const paths = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    const outputPath = resolve(
      directory,
      `boundary_${String(index + 1).padStart(3, "0")}_${String(index + 2).padStart(3, "0")}.png`
    );
    runFfmpeg([
      "-y", "-v", "error",
      "-i", segments[index].videoPath,
      "-i", segments[index + 1].videoPath,
      "-filter_complex",
      "[0:v]select=eq(n\\,16),scale=416:240,setpts=PTS-STARTPTS[left];[1:v]select=eq(n\\,0),scale=416:240,setpts=PTS-STARTPTS[right];[left][right]hstack=inputs=2[outv]",
      "-map", "[outv]", "-frames:v", "1", outputPath
    ]);
    paths.push(outputPath);
  }
  return paths;
}

function createFullContactSheet(nativePath, outputPath) {
  runFfmpeg([
    "-y", "-v", "error", "-i", nativePath,
    "-vf", "scale=158:92,tile=10x10:padding=1:margin=1",
    "-frames:v", "1", outputPath
  ]);
}

function probeVideo(filePath) {
  const result = spawnSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,r_frame_rate,nb_frames:format=duration,size",
    "-of", "json", filePath
  ], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`ffprobe failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  return { ...parsed.streams[0], format: parsed.format };
}

function parseFrameRate(frameRate) {
  const [numerator, denominator] = String(frameRate).split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return NaN;
  return numerator / denominator;
}

function assertVideoMetadata(metadata, { label, codecName, width, height, fps, minDuration, maxDuration }) {
  if (metadata.codec_name !== codecName) {
    throw new Error(`${label} codec must be ${codecName}: ${metadata.codec_name}`);
  }
  if (Number(metadata.width) !== width || Number(metadata.height) !== height) {
    throw new Error(`${label} dimensions must be ${width}x${height}: ${metadata.width}x${metadata.height}`);
  }
  const actualFps = parseFrameRate(metadata.r_frame_rate);
  if (!Number.isFinite(actualFps) || Math.abs(actualFps - fps) > 0.01) {
    throw new Error(`${label} frame rate must be ${fps}: ${metadata.r_frame_rate}`);
  }
  const duration = Number(metadata.format?.duration);
  if (!Number.isFinite(duration) || duration < minDuration || duration > maxDuration) {
    throw new Error(`${label} duration must be ${minDuration}-${maxDuration} seconds: ${metadata.format?.duration}`);
  }
}

async function uploadImage(path) {
  const bytes = readFileSync(path);
  const form = new FormData();
  form.append("image", new Blob([bytes], { type: "image/png" }), basename(path));
  form.append("type", "input");
  form.append("overwrite", "true");
  const response = await fetch(`${comfyUrl}/upload/image`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`upload failed ${response.status}: ${await response.text()}`);
  const result = await response.json();
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
}

async function queueWorkflow(workflow) {
  const response = await fetch(`${comfyUrl}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: "storyboardpro-wan-one-take" })
  });
  if (!response.ok) throw new Error(`queue failed ${response.status}: ${await response.text()}`);
  const result = await response.json();
  if (!result.prompt_id) throw new Error(`queue returned no prompt_id: ${JSON.stringify(result)}`);
  return result.prompt_id;
}

async function waitForHistory(promptId) {
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await fetch(`${comfyUrl}/history/${promptId}`);
    if (!response.ok) throw new Error(`history failed ${response.status}: ${await response.text()}`);
    const payload = await response.json();
    if (payload[promptId]) return payload[promptId];
    await new Promise((resolveWait) => setTimeout(resolveWait, 5000));
  }
  throw new Error(`generation timed out: ${promptId}`);
}

function writeReport(report) {
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function createRecoverySnapshot() {
  const priorReport = JSON.parse(readFileSync(reportPath, "utf8"));
  const snapshotDir = resolve(reportDir, "recovery-snapshots", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(snapshotDir, { recursive: true });
  for (const entry of readdirSync(reportDir, { withFileTypes: true })) {
    if (entry.name === "recovery-snapshots") continue;
    const source = resolve(reportDir, entry.name);
    cpSync(source, resolve(snapshotDir, entry.name), { recursive: true });
  }
  const externalVideoDir = resolve(snapshotDir, "source-segment-videos");
  mkdirSync(externalVideoDir, { recursive: true });
  for (const segment of priorReport.segments || []) {
    if (segment.videoPath && existsSync(segment.videoPath)) {
      copyFileSync(segment.videoPath, resolve(externalVideoDir, basename(segment.videoPath)));
    }
  }
  return snapshotDir;
}

function assembleAcceptedSegments() {
  if (!existsSync(reportPath)) throw new Error(`cannot assemble without a report: ${reportPath}`);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  if (!canAssemble(report.segments)) throw new Error("six technically and creatively accepted segments are required");
  assertAcceptedPrefix({
    segments: report.segments,
    expectedCount: 6,
    initialFrameHash: sha256(readFileSync(initialFramePath)),
    hashFile: (path) => sha256(readFileSync(path)),
    existsFile: (path) => existsSync(path)
  });
  createRecoverySnapshot();
  delete report.assembly;
  delete report.finalAcceptance;
  report.overallAccepted = false;
  writeReport(report);

  const assembly = buildOneTakeConcatFilter({
    segmentCount: report.segments.length,
    framesPerSegment: frameCount,
    inputFps: 16,
    outputFps: 24
  });
  const segmentInputs = report.segments.flatMap((segment) => ["-i", segment.videoPath]);
  const nativePath = resolve(reportDir, "river_one_take_native16.mp4");
  const deliveryPath = resolve(reportDir, "river_one_take_delivery24.mp4");
  const nativeGraph = assembly.filterGraph.replace(
    /;\[native\]minterpolate[\s\S]*$/,
    ";[native]format=yuv420p[outv]"
  );
  runFfmpeg([
    "-y", ...segmentInputs,
    "-filter_complex", nativeGraph,
    "-map", "[outv]", "-an", "-c:v", "libx264", "-crf", "18", nativePath
  ]);
  runFfmpeg([
    "-y", ...segmentInputs,
    "-filter_complex", assembly.filterGraph,
    "-map", "[outv]", "-an", "-c:v", "libx264", "-crf", "18", deliveryPath
  ]);

  const nativeMetadata = probeVideo(nativePath);
  const deliveryMetadata = probeVideo(deliveryPath);
  const nativeFrameCount = Number(nativeMetadata.nb_frames);
  if (nativeFrameCount !== 97) throw new Error(`nativeFrameCount !== 97: ${nativeFrameCount}`);
  if (nativeFrameCount !== assembly.nativeFrameCount) {
    throw new Error(`native frame count must equal ${assembly.nativeFrameCount}: ${nativeFrameCount}`);
  }
  assertVideoMetadata(nativeMetadata, {
    label: "native output",
    codecName: "h264",
    width: 832,
    height: 480,
    fps: 16,
    minDuration: 6.0,
    maxDuration: 6.2
  });
  assertVideoMetadata(deliveryMetadata, {
    label: "delivery output",
    codecName: "h264",
    width: 832,
    height: 480,
    fps: 24,
    minDuration: 5.8,
    maxDuration: 6.3
  });

  const contactSheetDir = resolve(reportDir, "contact-sheets");
  const boundarySheetPaths = createBoundarySheets(report.segments, contactSheetDir);
  const fullContactSheetPath = resolve(contactSheetDir, "one_take_97_frames.png");
  createFullContactSheet(nativePath, fullContactSheetPath);
  report.assembly = {
    nativePath,
    deliveryPath,
    nativeMetadata,
    deliveryMetadata,
    nativeFrameCount,
    expectedNativeFrameCount: assembly.nativeFrameCount,
    evidence: {
      fullContactSheetPath,
      boundarySheetPaths
    },
    integrity: {
      nativeSha256: sha256(readFileSync(nativePath)),
      deliverySha256: sha256(readFileSync(deliveryPath)),
      fullContactSheetSha256: sha256(readFileSync(fullContactSheetPath)),
      boundarySheetSha256s: boundarySheetPaths.map((path) => sha256(readFileSync(path)))
    }
  };
  Object.assign(report, {
    finalAcceptance: { status: "pending" },
    overallAccepted: false,
    updatedAt: new Date().toISOString()
  });
  writeReport(report);
  console.log(`One-take assembly ready for final creative review: ${fullContactSheetPath}`);
  console.log(reportPath);
}

async function main() {
  if (Number(assembleMode) + Number(hasGenerateMode) !== 1) {
    throw new Error("choose exactly one mode: --generate-segment 1..6 or --assemble");
  }
  if (assembleMode) {
    assembleAcceptedSegments();
    return;
  }
  if (!Number.isInteger(generateSegment) || generateSegment < 1 || generateSegment > 6) {
    throw new Error("--generate-segment must be an integer from 1 to 6");
  }
  if (!Number.isInteger(seedOffset) || !allowedSeedOffsets.has(seedOffset)) {
    throw new Error("--seed-offset must be one of 0, 1000, or 2000");
  }

  mkdirSync(reportDir, { recursive: true });
  const segments = buildOneTakeSegments({ initialFramePath, prompts: motionPrompts, baseSeed: 26081010 });
  const segment = segments[generateSegment - 1];
  let report;
  let preservedSegments = [];

  if (generateSegment === 1) {
    if (existsSync(reportPath)) createRecoverySnapshot();
    report = { schemaVersion: 2, startedAt: new Date().toISOString(), segments: [], overallAccepted: false };
  } else {
    if (!existsSync(reportPath)) throw new Error(`cannot generate segment ${generateSegment} without a report`);
    createRecoverySnapshot();
    report = JSON.parse(readFileSync(reportPath, "utf8"));
    preservedSegments = report.segments.slice(0, generateSegment - 1);
    const initialFrameHash = sha256(readFileSync(initialFramePath));
    assertAcceptedPrefix({
      segments: preservedSegments,
      expectedCount: generateSegment - 1,
      initialFrameHash,
      hashFile: (path) => sha256(readFileSync(path)),
      existsFile: (path) => existsSync(path)
    });
    report.segments = preservedSegments;
    report.technicalAcceptedSegments = report.segments.filter((entry) => entry.technicalAccepted).length;
    report.acceptedSegments = report.segments.filter((entry) => entry.accepted).length;
    report.overallAccepted = false;
    delete report.assembly;
    delete report.finalAcceptance;
  }

  const statsResponse = await fetch(`${comfyUrl}/system_stats`);
  if (!statsResponse.ok) throw new Error(`ComfyUI unavailable: ${statsResponse.status}`);
  const preset = JSON.parse(readFileSync(presetPath, "utf8"));
  report.schemaVersion = 2;
  report.comfyUrl = comfyUrl;
  report.frameCount = frameCount;
  report.maxAttempts = maxAttempts;
  report.generateSegment = generateSegment;
  report.seedOffset = seedOffset;
  report.initialFramePath = initialFramePath;
  report.presetPath = presetPath;
  report.system = await statsResponse.json();

  const segmentReport = { ...segment, attempts: [], accepted: false };
  report.pendingSegment = segmentReport;
  writeReport(report);

  let acceptedContactSheetPath = null;
  let technicallyAccepted = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    const inputFramePath = segment.order === 1 ? initialFramePath : preservedSegments.at(-1).finalFramePath;
    const item = { attempt, seed: segment.seed + seedOffset, inputFramePath };
    segmentReport.attempts.push(item);
    try {
      const inputHash = sha256(readFileSync(inputFramePath));
      item.inputSha256 = inputHash;
      if (segment.order > 1) {
        assertBoundaryHash(preservedSegments.at(-1).finalFrameSha256, inputHash, segment.id);
      }
      const uploadedName = await uploadImage(inputFramePath);
      const workflow = replaceTokens(preset, {
        FRAME_IMAGE_PATH: uploadedName,
        VIDEO_PROMPT: segment.prompt,
        NEGATIVE_PROMPT: negativePrompt,
        WAN_FRAME_COUNT: frameCount,
        SEED: item.seed,
        SHOT_TITLE: `${segment.id}_attempt_${attempt}`
      });
      const promptId = await queueWorkflow(workflow);
      item.promptId = promptId;
      console.log(`[${segment.id}] attempt ${attempt}/${maxAttempts} queued ${promptId}`);
      const history = await waitForHistory(promptId);
      const status = history.status || {};
      const videos = extractVideoOutputs(history);
      item.completed = Boolean(status.completed);
      item.statusText = status.status_str || "unknown";
      item.messages = status.messages || [];
      item.videos = videos;
      if (!item.completed || videos.length === 0) {
        throw new Error(`${segment.id} attempt ${attempt} failed: ${JSON.stringify(item.messages)}`);
      }

      const video = videos[0];
      const videoPath = resolve(comfyOutputDir, video.subfolder || "", video.filename);
      const finalFramePath = resolve(reportDir, `${segment.id}_final-frame.png`);
      extractFinalFrame(videoPath, finalFramePath);
      Object.assign(item, {
        videoPath,
        finalFramePath,
        finalFrameSha256: sha256(readFileSync(finalFramePath))
      });

      const segmentMetadata = probeVideo(videoPath);
      assertVideoMetadata(segmentMetadata, {
        label: `${segment.id} output`,
        codecName: "h264",
        width: 832,
        height: 480,
        fps: 16,
        minDuration: 1.0,
        maxDuration: 1.2
      });
      if (Number(segmentMetadata.nb_frames) !== 17) {
        throw new Error(`${segment.id} frame count must be 17: ${segmentMetadata.nb_frames}`);
      }
      const contactSheetPath = resolve(reportDir, "contact-sheets", `${segment.id}.png`);
      createSegmentContactSheet(videoPath, contactSheetPath);
      item.contactSheetPath = contactSheetPath;
      item.videoMetadata = segmentMetadata;
      item.elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      item.success = true;

      const acceptedSegment = {
        ...markTechnicalAccepted(segmentReport, item),
        attempts: segmentReport.attempts,
        contactSheetPath,
        videoMetadata: segmentMetadata
      };
      report.segments = [...preservedSegments, acceptedSegment];
      report.technicalAcceptedSegments = report.segments.filter((entry) => entry.technicalAccepted).length;
      report.acceptedSegments = report.segments.filter((entry) => entry.accepted).length;
      report.overallAccepted = false;
      report.updatedAt = new Date().toISOString();
      delete report.pendingSegment;
      acceptedContactSheetPath = contactSheetPath;
      technicallyAccepted = true;
    } catch (error) {
      item.error = error instanceof Error ? error.message : String(error);
      item.elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      console.error(`[${segment.id}] attempt ${attempt}/${maxAttempts} failed: ${item.error}`);
    } finally {
      writeReport(report);
    }
    if (technicallyAccepted) break;
  }

  if (!technicallyAccepted) {
    throw new Error(`${segment.id} failed after ${maxAttempts} attempts; current segment generation stopped`);
  }
  const contactSheetPath = acceptedContactSheetPath;
  console.log(`Segment ${generateSegment} technically accepted; creative review is pending: ${contactSheetPath}`);
  console.log(reportPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
