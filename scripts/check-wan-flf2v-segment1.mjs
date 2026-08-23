import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  VIDEO_SEEDS,
  applyEndpointReview,
  createExperimentReport,
  markEndpointTechnical
} from "./lib/wan-flf2v-experiment.mjs";

const PRESET_PATH = resolve("src/modules/comfy-pipeline/presets/video-wan21-flf2v-14b-fp8.json");
const RUNNER_PATH = resolve("scripts/run-wan-flf2v-segment1.mjs");
const MODEL_NAME = "wan2.1_flf2v_720p_14B_fp8_e4m3fn.safetensors";
const GiB = 1024 ** 3;

assert.ok(existsSync(PRESET_PATH), "dedicated FLF2V preset must exist");
assert.ok(existsSync(RUNNER_PATH), "isolated segment-1 runner must exist");

const preset = JSON.parse(readFileSync(PRESET_PATH, "utf8"));
assert.equal(preset["1"].inputs.unet_name, MODEL_NAME);
assert.equal(preset["10"].class_type, "WanFirstLastFrameToVideo");
assert.deepEqual(preset["10"].inputs.start_image, ["6", 0]);
assert.deepEqual(preset["10"].inputs.end_image, ["7", 0]);
assert.deepEqual(preset["10"].inputs.clip_vision_start_image, ["8", 0]);
assert.deepEqual(preset["10"].inputs.clip_vision_end_image, ["9", 0]);
assert.equal(preset["10"].inputs.width, 1280);
assert.equal(preset["10"].inputs.height, 720);
assert.equal(preset["10"].inputs.length, 17);
assert.equal(preset["10"].inputs.batch_size, 1);
assert.equal(preset["11"].inputs.steps, 20);
assert.equal(preset["11"].inputs.cfg, 5);
assert.equal(preset["11"].inputs.sampler_name, "uni_pc");
assert.equal(preset["11"].inputs.scheduler, "normal");
assert.equal(preset["15"].inputs.fps, 16);
assert.equal(preset["16"].class_type, "SaveVideo");
assert.equal(preset["16"].inputs.format, "mp4");
assert.equal(preset["16"].inputs.codec, "h264");
assert.equal(preset["16"].inputs.filename_prefix, "Video/wan21_flf2v_segment1_{{RUN_MODE_PREFIX}}_candidate_{{CANDIDATE_PADDED}}");
assert.deepEqual(Object.entries(preset).filter(([, node]) => node.class_type === "LoadImage").map(([id]) => id), ["6", "7"]);
assert.deepEqual(Object.entries(preset).filter(([, node]) => node.class_type === "CLIPVisionEncode").map(([id]) => id), ["8", "9"]);

const runner = await import(`${pathToFileURL(RUNNER_PATH).href}?contract=${Date.now()}`);
const {
  ATTEMPT_JOURNAL_FILENAME,
  FLF2V_NEGATIVE_PRESET_TEXT,
  FLF2V_POSITIVE_PRESET_TEXT,
  MIN_AVAILABLE_RAM_BYTES,
  assertCanonicalFlfPreset,
  assertChainVideo,
  assertRawFlfVideo,
  classifyStructuredOom,
  canonicalWorkflowSha256,
  compileFlfWorkflow,
  createDefaultComfyAdapter,
  createNineFrameContactSheet,
  extractFinalFrame,
  normalizeBoundaryImage,
  parseSegment1Arguments,
  probeVideo,
  runSegment1Candidate,
  transcodeChainCandidate,
  unloadComfyModels,
  validateFlfPresetObjectInfo
} = runner;

assert.equal(MIN_AVAILABLE_RAM_BYTES, 20 * GiB);
assert.equal(ATTEMPT_JOURNAL_FILENAME, "attempt-journal.json");
assert.equal(preset["12"].inputs.text, FLF2V_POSITIVE_PRESET_TEXT, "positive preset body is pinned byte-for-byte");
assert.equal(preset["13"].inputs.text, FLF2V_NEGATIVE_PRESET_TEXT, "negative preset body is pinned byte-for-byte");
assert.deepEqual(parseSegment1Arguments(["--candidate", "2"]), {
  candidate: 2,
  reportPath: resolve("logs/video-quality-one-take-flf2v/wan-flf2v-report.json"),
  probeResolution: null
});
assert.deepEqual(parseSegment1Arguments(["--candidate", "3", "--report", "fixture.json", "--probe-resolution", "960x544"]), {
  candidate: 3,
  reportPath: resolve("fixture.json"),
  probeResolution: { width: 960, height: 544, label: "960x544" }
});
for (const invalid of [
  [], ["--candidate", "0"], ["--candidate", "4"], ["--candidate", "1", "--candidate", "2"],
  ["--candidate", "1", "--probe-resolution", "1280x720"], ["--candidate", "1", "--all", "true"]
]) {
  assert.throws(() => parseSegment1Arguments(invalid), /usage|candidate|probe-resolution/i);
}

function field(typeOrChoices, options = {}) {
  return [typeOrChoices, options];
}

function node(required, optional, output) {
  return { input: { required, optional }, output };
}

function liveInventory() {
  return {
    UNETLoader: node({ unet_name: field([MODEL_NAME, "Wan2_1-I2V-ATI-14B_fp8_e4m3fn.safetensors"]), weight_dtype: field(["default", "fp8_e4m3fn"]) }, {}, ["MODEL"]),
    ModelSamplingSD3: node({ model: field("MODEL"), shift: field("FLOAT") }, {}, ["MODEL"]),
    CLIPLoader: node({ clip_name: field(["umt5_xxl_fp8_e4m3fn_scaled.safetensors"]), type: field(["wan"]), device: field(["default", "cpu"]) }, {}, ["CLIP"]),
    VAELoader: node({ vae_name: field(["wan_2.1_vae.safetensors"]) }, {}, ["VAE"]),
    CLIPVisionLoader: node({ clip_name: field(["clip_vision_h.safetensors"]) }, {}, ["CLIP_VISION"]),
    LoadImage: node({ image: field(["input.png"]) }, {}, ["IMAGE", "MASK"]),
    CLIPVisionEncode: node({ clip_vision: field("CLIP_VISION"), image: field("IMAGE"), crop: field(["none", "center"]) }, {}, ["CLIP_VISION_OUTPUT"]),
    CLIPTextEncode: node({ text: field("STRING"), clip: field("CLIP") }, {}, ["CONDITIONING"]),
    WanFirstLastFrameToVideo: node({
      positive: field("CONDITIONING"), negative: field("CONDITIONING"), vae: field("VAE"),
      width: field("INT", { min: 16, max: 4096 }), height: field("INT", { min: 16, max: 4096 }),
      length: field("INT", { min: 1, max: 4096 }), batch_size: field("INT", { min: 1, max: 16 })
    }, {
      clip_vision_start_image: field("CLIP_VISION_OUTPUT"), clip_vision_end_image: field("CLIP_VISION_OUTPUT"),
      start_image: field("IMAGE"), end_image: field("IMAGE")
    }, ["CONDITIONING", "CONDITIONING", "LATENT"]),
    KSampler: node({
      model: field("MODEL"), seed: field("INT"), steps: field("INT"), cfg: field("FLOAT"),
      sampler_name: field(["uni_pc"]), scheduler: field(["normal"]), positive: field("CONDITIONING"),
      negative: field("CONDITIONING"), latent_image: field("LATENT"), denoise: field("FLOAT")
    }, {}, ["LATENT"]),
    VAEDecode: node({ samples: field("LATENT"), vae: field("VAE") }, {}, ["IMAGE"]),
    CreateVideo: node({ images: field("IMAGE"), fps: field("FLOAT"), bit_depth: field("INT") }, {}, ["VIDEO"]),
    SaveVideo: node({ video: field("VIDEO"), filename_prefix: field("STRING"), format: field(["mp4"]), codec: field(["h264"]) }, {}, [])
  };
}

assert.equal(validateFlfPresetObjectInfo(preset, liveInventory()), true);
assert.equal(assertCanonicalFlfPreset(preset), true);
for (const mutate of [
  (value) => { value["1"].inputs.unet_name = "other.safetensors"; },
  (value) => { value["3"].inputs.clip_name = "other.safetensors"; },
  (value) => { value["4"].inputs.vae_name = "other.safetensors"; },
  (value) => { value["5"].inputs.clip_name = "other.safetensors"; },
  (value) => { value["10"].inputs.end_image = ["6", 0]; },
  (value) => { value["10"].inputs.width = 960; },
  (value) => { value["10"].inputs.length = 33; },
  (value) => { value["11"].inputs.steps = 19; },
  (value) => { value["11"].inputs.cfg = 4; },
  (value) => { value["11"].inputs.sampler_name = "euler"; },
  (value) => { value["11"].inputs.scheduler = "beta"; },
  (value) => { value["15"].inputs.fps = 15; },
  (value) => { value["16"].inputs.codec = "hevc"; },
  (value) => { value["16"].inputs.filename_prefix = "Video/shared_candidate"; },
  (value) => { value["12"].inputs.text = value["12"].inputs.text.replace("Preserve the exact identities", "Preserve identities"); },
  (value) => { value["12"].inputs.text = value["12"].inputs.text.replace("visible foot lift, travel, landing", "a step"); },
  (value) => { value["12"].inputs.text = value["12"].inputs.text.replace("and human anatomy", ""); },
  (value) => { value["12"].inputs.text = value["12"].inputs.text.replace("Maintain one extremely slow continuous forward camera push and a stable riverside scene.", ""); },
  (value) => { value["13"].inputs.text = value["13"].inputs.text.replace("identity drift, face morphing", "identity changes"); }
]) {
  const changed = structuredClone(preset);
  mutate(changed);
  assert.throws(() => assertCanonicalFlfPreset(changed), /canonical FLF2V preset/i);
}
const missingClass = liveInventory();
delete missingClass.WanFirstLastFrameToVideo;
assert.throws(() => validateFlfPresetObjectInfo(preset, missingClass), /missing required class WanFirstLastFrameToVideo/i);
const missingPort = liveInventory();
delete missingPort.WanFirstLastFrameToVideo.input.optional.end_image;
assert.throws(() => validateFlfPresetObjectInfo(preset, missingPort), /WanFirstLastFrameToVideo.*end_image/i);
const missingModel = liveInventory();
missingModel.UNETLoader.input.required.unet_name[0] = ["Wan2_1-I2V-ATI-14B_fp8_e4m3fn.safetensors"];
assert.throws(() => validateFlfPresetObjectInfo(preset, missingModel), /does not offer.*wan2\.1_flf2v/i);
const invalidOutput = structuredClone(preset);
invalidOutput["10"].inputs.start_image = ["6", 3];
assert.throws(() => validateFlfPresetObjectInfo(invalidOutput, liveInventory()), /output index/i);
const danglingSource = structuredClone(preset);
danglingSource["10"].inputs.end_image = ["999", 0];
assert.throws(() => validateFlfPresetObjectInfo(danglingSource, liveInventory()), /missing source node 999/i);
const invalidType = liveInventory();
invalidType.LoadImage.output[0] = "MASK";
assert.throws(() => validateFlfPresetObjectInfo(preset, invalidType), /type mismatch/i);
const invalidRange = liveInventory();
invalidRange.WanFirstLastFrameToVideo.input.required.width[1].max = 1024;
assert.throws(() => validateFlfPresetObjectInfo(preset, invalidRange), /width.*range|range.*width/i);
const invalidLiteralChoice = liveInventory();
invalidLiteralChoice.KSampler.input.required.sampler_name[0] = ["euler"];
assert.throws(() => validateFlfPresetObjectInfo(preset, invalidLiteralChoice), /KSampler.*sampler_name.*does not offer/i);
const invalidLiteralType = liveInventory();
invalidLiteralType.KSampler.input.required.cfg[0] = "STRING";
assert.throws(() => validateFlfPresetObjectInfo(preset, invalidLiteralType), /KSampler.*cfg.*type/i);

const compiled = compileFlfWorkflow(preset, {
  START_IMAGE_PATH: "uploads/start.png",
  END_IMAGE_PATH: "uploads/end.png",
  VIDEO_PROMPT: "half-step",
  NEGATIVE_PROMPT: "sliding feet",
  SEED: VIDEO_SEEDS[1],
  RUN_MODE_PREFIX: "production",
  CANDIDATE_PADDED: "002"
});
assert.equal(compiled["6"].inputs.image, "uploads/start.png");
assert.equal(compiled["7"].inputs.image, "uploads/end.png");
assert.equal(compiled["11"].inputs.seed, VIDEO_SEEDS[1]);
assert.match(compiled["12"].inputs.text, /half-step/);
assert.match(compiled["13"].inputs.text, /sliding feet/);
assert.equal(compiled["16"].inputs.filename_prefix, "Video/wan21_flf2v_segment1_production_candidate_002");
assert.match(canonicalWorkflowSha256(compiled), /^[a-f0-9]{64}$/);
assert.equal(canonicalWorkflowSha256(compiled), canonicalWorkflowSha256(Object.fromEntries(Object.entries(compiled).reverse())), "workflow hash is independent of object key insertion order");
const compiledProbe = compileFlfWorkflow(preset, {
  START_IMAGE_PATH: "uploads/start.png", END_IMAGE_PATH: "uploads/end.png", VIDEO_PROMPT: "half-step",
  NEGATIVE_PROMPT: "sliding feet", SEED: VIDEO_SEEDS[1], RUN_MODE_PREFIX: "probe", CANDIDATE_PADDED: "002"
}, { width: 960, height: 544, label: "960x544" });
assert.equal(compiledProbe["16"].inputs.filename_prefix, "Video/wan21_flf2v_segment1_probe_candidate_002");
assert.throws(() => compileFlfWorkflow(preset, { START_IMAGE_PATH: "only-one-token.png" }), /unresolved preset tokens/i);

const structuredOomDiagnostics = [{
  event: "execution_error",
  data: { prompt_id: "prompt-oom", node_id: "11", node_type: "KSampler", exception_type: "torch.OutOfMemoryError", exception_message: "allocation failed" }
}];
assert.equal(classifyStructuredOom(structuredOomDiagnostics), true);
assert.equal(classifyStructuredOom([{ event: "execution_error", data: { exception_type: "RuntimeError", exception_message: "CUDA out of memory" } }]), false, "generic error text never authorizes a probe");
assert.equal(classifyStructuredOom([]), false);

let freeRequest;
await assert.doesNotReject(() => unloadComfyModels("http://127.0.0.1:8188", async (url, init) => {
  freeRequest = { url, init };
  return { ok: true, status: 200, text: async () => "" };
}));
assert.equal(freeRequest.url, "http://127.0.0.1:8188/free");
assert.equal(freeRequest.init.method, "POST");
assert.deepEqual(JSON.parse(freeRequest.init.body), { unload_models: true, free_memory: true });
await assert.rejects(() => unloadComfyModels("https://example.com", async () => ({ ok: true })), /only a local ComfyUI endpoint/i);

function run(command, args, encoding = "utf8") {
  const result = spawnSync(command, args, { encoding, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result;
}

function createPng(path, color, width = 1152, height = 640) {
  run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=${width}x${height}`, "-frames:v", "1", "-pix_fmt", "rgb24", path]);
}

function createVideo(path, { width = 1280, height = 720, fps = 16, frames = 17, codec = "libx264" } = {}) {
  run("ffmpeg", [
    "-y", "-v", "error", "-f", "lavfi", "-i", `testsrc2=s=${width}x${height}:r=${fps}`,
    "-frames:v", String(frames), "-an", "-c:v", codec, "-pix_fmt", "yuv420p", path
  ]);
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function imageStream(path) {
  const result = run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path]);
  return JSON.parse(result.stdout).streams[0];
}

function imageIo() {
  return {
    existsFile: (path) => existsSync(path) && statSync(path).isFile() && statSync(path).size > 0,
    hashFile: sha256File,
    assertDecodableImage: imageStream
  };
}

const scratchParent = resolve(".tmp");
mkdirSync(scratchParent, { recursive: true });
const tempRoot = mkdtempSync(join(scratchParent, "wan-flf2v-segment1-"));

try {
  const sourcePath = resolve(tempRoot, "source.png");
  const endpointPath = resolve(tempRoot, "endpoint.png");
  const evidencePath = resolve(tempRoot, "start_end.png");
  createPng(sourcePath, "red");
  createPng(endpointPath, "blue");
  run("ffmpeg", ["-y", "-v", "error", "-i", sourcePath, "-i", endpointPath, "-filter_complex", "hstack=inputs=2", "-frames:v", "1", evidencePath]);

  const normalizedPath = resolve(tempRoot, "normalized.png");
  normalizeBoundaryImage({ inputPath: sourcePath, outputPath: normalizedPath });
  assert.deepEqual(imageStream(normalizedPath), { width: 1280, height: 720 });

  const rawPath = resolve(tempRoot, "raw.mp4");
  createVideo(rawPath);
  const rawMetadata = probeVideo(rawPath);
  assert.equal(assertRawFlfVideo(rawMetadata, { width: 1280, height: 720 }), true);
  for (const [change, message] of [
    [{ codec_name: "mpeg4" }, /codec.*h264/i], [{ width: 1278 }, /1280x720/i],
    [{ r_frame_rate: "15/1" }, /16 FPS/i], [{ nb_frames: "16" }, /17 frames/i],
    [{ avg_frame_rate: "15/1" }, /average.*16 FPS|effective.*16 FPS/i],
    [{ format: { ...rawMetadata.format, duration: "1.300000" } }, /1\.0.*1\.2 seconds/i]
  ]) {
    assert.throws(() => assertRawFlfVideo({ ...rawMetadata, ...change }, { width: 1280, height: 720 }), message);
  }

  function jsonResponse(value, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => value, text: async () => JSON.stringify(value) };
  }

  function bytesResponse(value, status = 200) {
    const bytes = Buffer.from(value);
    return { ok: status >= 200 && status < 300, status, text: async () => "", arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  }

  function fakeClock() {
    let time = 0;
    return { now: () => time, sleep: async (milliseconds) => { time += milliseconds; } };
  }

  function defaultAdapterFetch({ runMode, promptId, outputCollection = "images", terminalError = null }) {
    const requests = [];
    let submittedWorkflow = null;
    const outputRef = { filename: `${runMode}.mp4`, subfolder: `server/${runMode}`, type: "output" };
    const fetchImpl = async (url, init = {}) => {
      requests.push({ url, init });
      if (url.endsWith("/upload/image")) {
        assert.equal(init.body.get("subfolder"), `wan-flf2v-segment1/${runMode}/candidate_002`);
        return jsonResponse({ name: `${runMode}.png`, subfolder: `wan-flf2v-segment1/${runMode}/candidate_002`, type: "input" });
      }
      if (url.endsWith("/prompt")) {
        const body = JSON.parse(init.body);
        submittedWorkflow = structuredClone(body.prompt);
        assert.equal(body.prompt["16"].inputs.filename_prefix, `Video/wan21_flf2v_segment1_${runMode}_candidate_002`);
        assert.equal(body.client_id, `wan-flf2v-segment1-${runMode}-002`);
        return jsonResponse({ prompt_id: promptId, number: 7, node_errors: {} });
      }
      if (url.endsWith(`/history/${promptId}`)) {
        const status = terminalError
          ? { status_str: "error", completed: false, messages: [["execution_error", terminalError]] }
          : { status_str: "success", completed: true, messages: [["execution_success", { prompt_id: promptId }]] };
        return jsonResponse({ [promptId]: { prompt: [7, promptId, submittedWorkflow, {}, []], outputs: { "16": { [outputCollection]: [outputRef], animated: [true] } }, status } });
      }
      if (url.includes("/view?")) return bytesResponse(readFileSync(rawPath));
      throw new Error(`unexpected fake Comfy request: ${url}`);
    };
    return { fetchImpl, requests, outputRef };
  }

  for (const [runMode, outputCollection, workflow] of [
    ["production", "images", compiled],
    ["probe", "videos", compiledProbe]
  ]) {
    const transport = defaultAdapterFetch({ runMode, promptId: `default-${runMode}`, outputCollection });
    const defaultAdapter = createDefaultComfyAdapter({
      baseUrl: "http://127.0.0.1:8188",
      candidatePadded: "002",
      runMode,
      fetchImpl: transport.fetchImpl,
      clock: fakeClock()
    });
    const uploaded = await defaultAdapter.uploadImage({ path: sourcePath, role: "normalized_start" });
    assert.equal(uploaded.subfolder, `wan-flf2v-segment1/${runMode}/candidate_002`);
    const outputPath = resolve(tempRoot, `default-${runMode}.mp4`);
    const order = [];
    const generated = await defaultAdapter.generateVideo({
      workflow,
      outputPath,
      onQueued: async ({ promptId }) => { order.push(`queued:${promptId}`); }
    });
    assert.deepEqual(order, [`queued:default-${runMode}`], "queue identity is exposed before terminal history handling");
    assert.equal(generated.promptId, `default-${runMode}`);
    assert.deepEqual(generated.outputRefs, [transport.outputRef]);
    assert.equal(generated.isOom, false);
    const fetchedHistory = await defaultAdapter.fetchPromptHistory(`default-${runMode}`);
    assert.equal(fetchedHistory.promptId, `default-${runMode}`);
    assert.deepEqual(fetchedHistory.storedWorkflow, workflow, "default adapter returns Comfy's stored submitted workflow for provenance verification");
    assert.equal(fetchedHistory.status, "success");
    assert.equal(readFileSync(outputPath).equals(readFileSync(rawPath)), true);
    assert.equal(transport.requests.some((request) => request.url.endsWith(`/history/default-${runMode}`)), true);
    assert.equal(transport.requests.some((request) => request.url.includes("/view?")), true);
  }

  const oomTransport = defaultAdapterFetch({
    runMode: "production",
    promptId: "default-oom",
    outputCollection: "images",
    terminalError: { prompt_id: "default-oom", node_id: "11", node_type: "KSampler", exception_type: "torch.OutOfMemoryError", exception_message: "allocation failed", traceback: ["frame"] }
  });
  const oomAdapter = createDefaultComfyAdapter({ baseUrl: "http://127.0.0.1:8188", candidatePadded: "002", runMode: "production", fetchImpl: oomTransport.fetchImpl, clock: fakeClock() });
  await assert.rejects(oomAdapter.generateVideo({ workflow: compiled, outputPath: resolve(tempRoot, "never-written.mp4"), onQueued: async () => {} }), (error) => {
    assert.equal(error.promptId, "default-oom");
    assert.equal(error.isOom, true);
    assert.equal(error.diagnostics[0].event, "execution_error");
    assert.deepEqual(error.outputRefs, [oomTransport.outputRef]);
    return true;
  });
  assert.equal(oomTransport.requests.some((request) => request.url.includes("/view?")), false, "terminal errors preserve output refs without promoting/downloading them");

  const genericTransport = defaultAdapterFetch({
    runMode: "production",
    promptId: "default-generic",
    terminalError: { prompt_id: "default-generic", node_id: "11", node_type: "KSampler", exception_type: "RuntimeError", exception_message: "CUDA out of memory text only", traceback: [] }
  });
  const genericAdapter = createDefaultComfyAdapter({ baseUrl: "http://127.0.0.1:8188", candidatePadded: "002", runMode: "production", fetchImpl: genericTransport.fetchImpl, clock: fakeClock() });
  await assert.rejects(genericAdapter.generateVideo({ workflow: compiled, outputPath: resolve(tempRoot, "never-generic.mp4"), onQueued: async () => {} }), (error) => {
    assert.equal(error.promptId, "default-generic");
    assert.equal(error.isOom, false, "generic error message is not classified as structured OOM");
    return true;
  });

  const chainPath = resolve(tempRoot, "chain.mp4");
  transcodeChainCandidate({ inputPath: rawPath, outputPath: chainPath });
  const chainMetadata = probeVideo(chainPath);
  assert.equal(assertChainVideo(chainMetadata), true);
  assert.equal(chainMetadata.codec_name, "h264");
  assert.equal(Number(chainMetadata.width), 832);
  assert.equal(Number(chainMetadata.height), 480);
  assert.equal(Number(chainMetadata.nb_frames), 17);

  const finalFramePath = resolve(tempRoot, "frame_016.png");
  extractFinalFrame({ inputPath: chainPath, outputPath: finalFramePath });
  assert.deepEqual(imageStream(finalFramePath), { width: 832, height: 480 });
  const sheetPath = resolve(tempRoot, "contact_sheet_9.png");
  createNineFrameContactSheet({ inputPath: chainPath, outputPath: sheetPath });
  assert.deepEqual(imageStream(sheetPath), { width: 1248, height: 720 });

  function makeApprovedReport(root) {
    mkdirSync(root, { recursive: true });
    const authorityPath = resolve(root, "authoritative.json");
    const reportPath = resolve(root, "wan-flf2v-report.json");
    const localStart = resolve(root, "start.png");
    const localEnd = resolve(root, "end.png");
    const localEvidence = resolve(root, "endpoint-evidence.png");
    writeFileSync(authorityPath, "authoritative fixture\n", "utf8");
    copyFileSync(sourcePath, localStart);
    copyFileSync(endpointPath, localEnd);
    copyFileSync(evidencePath, localEvidence);
    let report = createExperimentReport({
      experimentRoot: root,
      authoritativeReportPath: authorityPath,
      authoritativeReportSha256: sha256File(authorityPath),
      startFramePath: localStart,
      startFrameSha256: sha256File(localStart)
    });
    report = markEndpointTechnical(report, {
      candidate: 1,
      seed: 271011,
      endpointPath: localEnd,
      endpointSha256: sha256File(localEnd),
      compositePath: localEnd,
      compositeSha256: sha256File(localEnd),
      evidencePath: localEvidence,
      evidenceSha256: sha256File(localEvidence)
    });
    report = applyEndpointReview(report, {
      candidate: 1,
      decision: "accepted",
      note: "grounded half-step endpoint accepted",
      evidencePath: localEvidence,
      evidenceSha256: sha256File(localEvidence),
      reviewedAt: "2026-08-11T00:00:00.000Z"
    }, imageIo());
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return { authorityPath, reportPath, root, startPath: localStart, endPath: localEnd, evidencePath: localEvidence };
  }

  function adapter({
    rawOptions = {}, inventory = liveInventory(), ramFree = 21 * GiB, calls = [], failAttempts = 0,
    failureKind = "generic", omitPromptId = false, afterQueued, writeRawBeforeFailure = false,
    historyStore = new Map()
  } = {}) {
    let generationAttempt = 0;
    return {
      calls,
      async fetchObjectInfo() { calls.push("object_info"); return inventory; },
      async unloadModels() { calls.push("unload"); return { unloaded: true }; },
      async getSystemStats() { calls.push("ram"); return { system: { ram_free: ramFree, ram_total: 64 * GiB } }; },
      async uploadImage({ path, role }) {
        calls.push(`upload:${role}`);
        assert.deepEqual(imageStream(path), { width: 1280, height: 720 });
        return { name: `${role}.png`, subfolder: "wan-flf2v/fixture", type: "input" };
      },
      async fetchPromptHistory(promptId) {
        calls.push(`history:${promptId}`);
        return historyStore.get(promptId) || null;
      },
      async generateVideo({ workflow, outputPath, attempt, onQueued, probeOnly }) {
        generationAttempt += 1;
        calls.push(`generate:${attempt}:${workflow["11"].inputs.seed}`);
        const promptId = omitPromptId ? null : `prompt-${generationAttempt}`;
        if (promptId) {
          await onQueued({ promptId });
          if (afterQueued) await afterQueued({ attempt, promptId, probeOnly });
        }
        if (generationAttempt <= failAttempts) {
          if (writeRawBeforeFailure) createVideo(outputPath, rawOptions);
          const diagnostics = failureKind === "oom"
            ? structuredOomDiagnostics.map((item) => ({ ...structuredClone(item), data: { ...structuredClone(item.data), prompt_id: promptId } }))
            : [{ event: "execution_error", data: { prompt_id: promptId, exception_type: "RuntimeError", exception_message: "CUDA out of memory fixture text only" } }];
          if (promptId) historyStore.set(promptId, {
            promptId,
            storedWorkflow: structuredClone(workflow),
            diagnostics: structuredClone(diagnostics),
            outputRefs: [],
            status: "error",
            completed: false
          });
          throw Object.assign(new Error(`fixture technical failure ${generationAttempt}`), {
            promptId,
            diagnostics,
            isOom: classifyStructuredOom(diagnostics),
            outputRefs: []
          });
        }
        createVideo(outputPath, rawOptions);
        if (promptId) historyStore.set(promptId, {
          promptId,
          storedWorkflow: structuredClone(workflow),
          diagnostics: [],
          outputRefs: [{ filename: `fixture-${generationAttempt}.mp4`, subfolder: probeOnly ? "probe" : "production", type: "output" }],
          status: "success",
          completed: true
        });
        return { promptId, diagnostics: [], isOom: false, outputRefs: [{ filename: `fixture-${generationAttempt}.mp4`, subfolder: probeOnly ? "probe" : "production", type: "output" }] };
      }
    };
  }

  for (const [name, mutate] of [
    ["dimensions", (value) => { value["10"].inputs.width = 960; }],
    ["binding", (value) => { value["10"].inputs.clip_vision_end_image = ["8", 0]; }],
    ["prefix", (value) => { value["16"].inputs.filename_prefix = "Video/shared"; }],
    ["positive-identity", (value) => { value["12"].inputs.text = value["12"].inputs.text.replace("Preserve the exact identities", "Preserve identities"); }],
    ["positive-motion", (value) => { value["12"].inputs.text = value["12"].inputs.text.replace("visible foot lift, travel, landing", "a step"); }],
    ["positive-anatomy", (value) => { value["12"].inputs.text = value["12"].inputs.text.replace("and human anatomy", ""); }],
    ["positive-scene-lock", (value) => { value["12"].inputs.text = value["12"].inputs.text.replace("Maintain one extremely slow continuous forward camera push and a stable riverside scene.", ""); }],
    ["negative-body", (value) => { value["13"].inputs.text = value["13"].inputs.text.replace("identity drift, face morphing", "identity changes"); }]
  ]) {
    const fixture = makeApprovedReport(resolve(tempRoot, `runtime-canonical-${name}`));
    const changed = structuredClone(preset);
    mutate(changed);
    const changedPresetPath = resolve(fixture.root, "mutated-preset.json");
    writeFileSync(changedPresetPath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");
    const calls = [];
    await assert.rejects(runSegment1Candidate({ candidate: 1, reportPath: fixture.reportPath, experimentRoot: fixture.root, presetPath: changedPresetPath }, adapter({ calls })), /canonical FLF2V preset/i);
    assert.deepEqual(calls, [], `runtime canonical ${name} mutation fails before object_info, unload, or queue`);
  }

  const successful = makeApprovedReport(resolve(tempRoot, "successful"));
  const successfulCalls = [];
  const successfulJournalPath = resolve(successful.root, "video", "candidate_002", ATTEMPT_JOURNAL_FILENAME);
  const queuedSnapshots = [];
  const successfulAdapter = adapter({
    calls: successfulCalls,
    failAttempts: 1,
    writeRawBeforeFailure: true,
    afterQueued({ attempt, promptId }) {
      const journal = JSON.parse(readFileSync(successfulJournalPath, "utf8"));
      queuedSnapshots.push(structuredClone(journal));
      const entry = journal.attempts.find((item) => item.attempt === attempt && item.promptId === promptId);
      assert.equal(entry.status, "queued", "attempt journal persists prompt identity immediately at the queue boundary");
      assert.match(entry.workflowSha256, /^[a-f0-9]{64}$/, "queue-boundary journal entry already contains workflow provenance");
    }
  });
  const successfulResult = await runSegment1Candidate({
    candidate: 2,
    reportPath: successful.reportPath,
    experimentRoot: successful.root
  }, successfulAdapter);
  assert.deepEqual(successfulCalls.slice(0, 3), ["object_info", "unload", "ram"], "models unload before post-unload RAM check");
  assert.deepEqual(successfulCalls.filter((call) => call.startsWith("generate:")), [
    `generate:1:${VIDEO_SEEDS[1]}`,
    `generate:2:${VIDEO_SEEDS[1]}`
  ], "technical retries retain the candidate seed");
  assert.equal(successfulResult.candidate.seed, VIDEO_SEEDS[1]);
  assert.equal(successfulResult.candidate.promptId, "prompt-2");
  assert.equal(successfulResult.candidate.endpointCandidate, 1);
  assert.equal(successfulResult.candidate.endpointSha256, sha256File(successful.endPath));
  assert.equal(successfulResult.candidate.technicalAcceptance.status, "accepted");
  assert.equal(successfulResult.candidate.creativeAcceptance.status, "pending");
  assert.equal(successfulResult.candidate.metadata.codec_name, "h264");
  assert.equal(successfulResult.candidate.metadata.width, 832);
  assert.equal(successfulResult.candidate.metadata.height, 480);
  assert.equal(successfulResult.candidate.metadata.nb_frames, "17");
  assert.equal(successfulResult.candidate.metadata.r_frame_rate, "16/1");
  assert.ok(Number(successfulResult.candidate.metadata.format.duration) >= 1 && Number(successfulResult.candidate.metadata.format.duration) <= 1.2);
  for (const key of [
    "normalizedStartPath", "normalizedEndPath", "rawFlfPath", "videoPath", "finalFramePath", "evidencePath", "metadataPath"
  ]) assert.ok(existsSync(successfulResult.candidate[key]), `${key} artifact exists`);
  const expectedProductionDir = resolve(successful.root, "video", "candidate_002");
  for (const key of [
    "normalizedStartPath", "normalizedEndPath", "rawFlfPath", "videoPath", "finalFramePath", "evidencePath", "metadataPath"
  ]) assert.equal(resolve(successfulResult.candidate[key]).startsWith(`${expectedProductionDir}\\`), true, `${key} stays under the isolated production candidate directory`);
  for (const key of [
    "normalizedStartSha256", "normalizedEndSha256", "rawFlfSha256", "videoSha256", "finalFrameSha256", "evidenceSha256", "metadataSha256"
  ]) assert.match(successfulResult.candidate[key], /^[a-f0-9]{64}$/);
  assert.equal(JSON.parse(readFileSync(successfulResult.candidate.metadataPath, "utf8")).attempts.length, 2);
  assert.equal(queuedSnapshots.length, 2);
  const successfulJournal = JSON.parse(readFileSync(successfulJournalPath, "utf8"));
  assert.equal(successfulJournal.schemaVersion, 1);
  assert.equal(successfulJournal.candidate, 2);
  assert.equal(successfulJournal.seed, VIDEO_SEEDS[1]);
  assert.deepEqual(successfulJournal.productionResolution, { width: 1280, height: 720, label: "1280x720" });
  assert.deepEqual(successfulJournal.attempts.map((item) => [item.status, item.promptId, item.isOom]), [
    ["failed", "prompt-1", false], ["accepted", "prompt-2", false]
  ]);
  for (const item of successfulJournal.attempts) {
    assert.match(item.workflowSha256, /^[a-f0-9]{64}$/, "queued production attempt stores the canonical submitted-workflow hash");
    assert.deepEqual(item.workflowInputs, {
      startImage: "wan-flf2v/fixture/normalized_start.png",
      endImage: "wan-flf2v/fixture/normalized_end.png"
    });
  }
  assert.match(successfulJournal.attempts[0].rawSha256, /^[a-f0-9]{64}$/, "failed queued attempt preserves the hash of real media already written");
  assert.equal(successfulJournal.attempts[0].diagnostics[0].data.exception_type, "RuntimeError");
  assert.deepEqual(successfulJournal.attempts[1].outputRefs, [{ filename: "fixture-2.mp4", subfolder: "production", type: "output" }]);
  assert.equal(readdirSync(dirname(successfulJournalPath)).some((name) => name.startsWith(`${ATTEMPT_JOURNAL_FILENAME}.tmp-`)), false, "atomic journal leaves no temporary file");
  assert.deepEqual(imageStream(successfulResult.candidate.evidencePath), { width: 1248, height: 720 });
  assert.equal(JSON.parse(readFileSync(successful.reportPath, "utf8")).videoCandidates.length, 1);

  const unaccepted = makeApprovedReport(resolve(tempRoot, "unaccepted"));
  const unacceptedReport = JSON.parse(readFileSync(unaccepted.reportPath, "utf8"));
  unacceptedReport.endpointCandidates[0].creativeAcceptance = { status: "pending" };
  unacceptedReport.approvedEndpoint = null;
  unacceptedReport.overallStatus = "endpoint-required";
  writeFileSync(unaccepted.reportPath, `${JSON.stringify(unacceptedReport, null, 2)}\n`, "utf8");
  const unacceptedCalls = [];
  await assert.rejects(runSegment1Candidate({ candidate: 1, reportPath: unaccepted.reportPath, experimentRoot: unaccepted.root }, adapter({ calls: unacceptedCalls })), /approved endpoint is required/i);
  assert.deepEqual(unacceptedCalls, ["object_info"], "unaccepted endpoint stops before unload and queue");

  const absentModel = makeApprovedReport(resolve(tempRoot, "absent-model"));
  const absentInventory = liveInventory();
  absentInventory.UNETLoader.input.required.unet_name[0] = ["other.safetensors"];
  const absentCalls = [];
  await assert.rejects(runSegment1Candidate({ candidate: 1, reportPath: absentModel.reportPath, experimentRoot: absentModel.root }, adapter({ inventory: absentInventory, calls: absentCalls })), /does not offer.*wan2\.1_flf2v/i);
  assert.deepEqual(absentCalls, ["object_info"]);

  const authorityDrift = makeApprovedReport(resolve(tempRoot, "authority-drift"));
  writeFileSync(authorityDrift.authorityPath, "changed authority\n", "utf8");
  const authorityCalls = [];
  await assert.rejects(runSegment1Candidate({ candidate: 1, reportPath: authorityDrift.reportPath, experimentRoot: authorityDrift.root }, adapter({ calls: authorityCalls })), /authoritative.*changed/i);
  assert.deepEqual(authorityCalls, [], "authority drift stops before Comfy access");

  const endpointDrift = makeApprovedReport(resolve(tempRoot, "endpoint-drift"));
  createPng(endpointDrift.endPath, "green");
  const endpointCalls = [];
  await assert.rejects(runSegment1Candidate({ candidate: 1, reportPath: endpointDrift.reportPath, experimentRoot: endpointDrift.root }, adapter({ calls: endpointCalls })), /endpoint artifact.*hash mismatch/i);
  assert.deepEqual(endpointCalls, ["object_info"], "endpoint drift stops before unload and queue");

  const endpointGeometry = makeApprovedReport(resolve(tempRoot, "endpoint-geometry"));
  createPng(endpointGeometry.endPath, "blue", 100, 100);
  const endpointGeometryReport = JSON.parse(readFileSync(endpointGeometry.reportPath, "utf8"));
  const wrongGeometryHash = sha256File(endpointGeometry.endPath);
  for (const item of [endpointGeometryReport.endpointCandidates[0], endpointGeometryReport.approvedEndpoint]) {
    item.endpointSha256 = wrongGeometryHash;
    item.compositeSha256 = wrongGeometryHash;
  }
  writeFileSync(endpointGeometry.reportPath, `${JSON.stringify(endpointGeometryReport, null, 2)}\n`, "utf8");
  const endpointGeometryCalls = [];
  await assert.rejects(runSegment1Candidate({ candidate: 1, reportPath: endpointGeometry.reportPath, experimentRoot: endpointGeometry.root }, adapter({ calls: endpointGeometryCalls })), /approved end frame must be 1152x640/i);
  assert.deepEqual(endpointGeometryCalls, ["object_info"], "endpoint geometry mismatch stops before unload and queue");

  const lowRam = makeApprovedReport(resolve(tempRoot, "low-ram"));
  const lowRamCalls = [];
  await assert.rejects(runSegment1Candidate({ candidate: 1, reportPath: lowRam.reportPath, experimentRoot: lowRam.root }, adapter({ calls: lowRamCalls, ramFree: MIN_AVAILABLE_RAM_BYTES - 1 })), /at least 20 GiB.*after unload/i);
  assert.deepEqual(lowRamCalls, ["object_info", "unload", "ram"]);

  const noPriorProbe = makeApprovedReport(resolve(tempRoot, "probe-no-prior"));
  const noPriorBytes = readFileSync(noPriorProbe.reportPath);
  const noPriorCalls = [];
  await assert.rejects(runSegment1Candidate({ candidate: 1, reportPath: noPriorProbe.reportPath, experimentRoot: noPriorProbe.root, probeResolution: { width: 960, height: 544, label: "960x544" } }, adapter({ calls: noPriorCalls, rawOptions: { width: 960, height: 544 } })), /prior.*structured.*OOM|structured.*OOM.*required/i);
  assert.deepEqual(noPriorCalls, []);
  assert.equal(readFileSync(noPriorProbe.reportPath).equals(noPriorBytes), true);

  const genericFailure = makeApprovedReport(resolve(tempRoot, "probe-generic-failure"));
  await assert.rejects(runSegment1Candidate({ candidate: 1, reportPath: genericFailure.reportPath, experimentRoot: genericFailure.root }, adapter({ failAttempts: 3, failureKind: "generic" })), /failed after 3 technical attempts/i);
  const genericProbeCalls = [];
  await assert.rejects(runSegment1Candidate({ candidate: 1, reportPath: genericFailure.reportPath, experimentRoot: genericFailure.root, probeResolution: { width: 960, height: 544, label: "960x544" } }, adapter({ calls: genericProbeCalls, rawOptions: { width: 960, height: 544 } })), /structured.*OOM/i);
  assert.deepEqual(genericProbeCalls, [], "generic error text does not reach Comfy probe preflight");

  const missingPrompt = makeApprovedReport(resolve(tempRoot, "probe-missing-prompt"));
  await assert.rejects(runSegment1Candidate({ candidate: 1, reportPath: missingPrompt.reportPath, experimentRoot: missingPrompt.root }, adapter({ failAttempts: 3, failureKind: "oom", omitPromptId: true })), /failed after 3 technical attempts/i);
  const missingPromptCalls = [];
  await assert.rejects(runSegment1Candidate({ candidate: 1, reportPath: missingPrompt.reportPath, experimentRoot: missingPrompt.root, probeResolution: { width: 960, height: 544, label: "960x544" } }, adapter({ calls: missingPromptCalls, rawOptions: { width: 960, height: 544 } })), /promptId.*required|queued prompt.*required/i);
  assert.deepEqual(missingPromptCalls, []);

  function writeProbeAuthorityFixture(fixture, { candidate, seed }) {
    const candidateDir = resolve(fixture.root, "video", "candidate_001");
    mkdirSync(candidateDir, { recursive: true });
    writeFileSync(resolve(candidateDir, ATTEMPT_JOURNAL_FILENAME), `${JSON.stringify({
      schemaVersion: 1,
      candidate,
      seed,
      productionResolution: { width: 1280, height: 720, label: "1280x720" },
      attempts: [{
        attempt: 1, mode: "production", candidate, seed, resolution: { width: 1280, height: 720, label: "1280x720" },
        status: "failed", promptId: "prompt-authority", diagnostics: structuredOomDiagnostics, isOom: true, outputRefs: []
      }],
      probeAttempts: []
    }, null, 2)}\n`, "utf8");
  }

  for (const [name, journalIdentity, message] of [
    ["wrong-seed", { candidate: 1, seed: VIDEO_SEEDS[1] }, /seed.*match|same fixed seed/i],
    ["wrong-candidate", { candidate: 2, seed: VIDEO_SEEDS[0] }, /candidate.*match|same candidate/i]
  ]) {
    const fixture = makeApprovedReport(resolve(tempRoot, `probe-${name}`));
    writeProbeAuthorityFixture(fixture, journalIdentity);
    const calls = [];
    await assert.rejects(runSegment1Candidate({ candidate: 1, reportPath: fixture.reportPath, experimentRoot: fixture.root, probeResolution: { width: 960, height: 544, label: "960x544" } }, adapter({ calls, rawOptions: { width: 960, height: 544 } })), message);
    assert.deepEqual(calls, []);
  }

  async function assertForgedProbeRejected(name, mutate) {
    const fixture = makeApprovedReport(resolve(tempRoot, `probe-forged-${name}`));
    const historyStore = new Map();
    await assert.rejects(runSegment1Candidate({ candidate: 1, reportPath: fixture.reportPath, experimentRoot: fixture.root }, adapter({
      failAttempts: 3,
      failureKind: "oom",
      historyStore
    })), /failed after 3 technical attempts/i);
    const journalPath = resolve(fixture.root, "video", "candidate_001", ATTEMPT_JOURNAL_FILENAME);
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.attempts = [journal.attempts.at(-1)];
    const promptId = journal.attempts[0].promptId;
    await mutate({ journal, historyStore, promptId });
    writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
    const reportBefore = readFileSync(fixture.reportPath);
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url.endsWith("/object_info")) return jsonResponse(liveInventory());
      if (url.endsWith(`/history/${promptId}`)) {
        const stored = historyStore.get(promptId);
        if (!stored) return jsonResponse({});
        return jsonResponse({ [promptId]: {
          prompt: [7, promptId, stored.storedWorkflow, {}, ["16"]],
          outputs: {},
          status: {
            status_str: stored.status,
            completed: stored.completed,
            messages: stored.diagnostics.map((item) => [item.event, item.data])
          }
        } });
      }
      throw new Error(`unexpected forged-probe fake request: ${url}`);
    };
    await assert.rejects(runSegment1Candidate({
      candidate: 1,
      reportPath: fixture.reportPath,
      experimentRoot: fixture.root,
      probeResolution: { width: 960, height: 544, label: "960x544" },
      comfyUrl: "http://127.0.0.1:8188",
      fetchImpl,
      clock: fakeClock()
    }), /history|prompt|workflow|hash|canonical|OOM/i);
    assert.equal(calls.some((url) => url.endsWith(`/history/${promptId}`)), true, `${name}: real default adapter re-queries Comfy history`);
    assert.equal(calls.some((url) => url.endsWith("/free")), false, `${name}: forged history is rejected before unload`);
    assert.equal(calls.some((url) => url.endsWith("/prompt")), false, `${name}: forged history is rejected before queue`);
    assert.equal(JSON.parse(readFileSync(journalPath, "utf8")).probeAttempts.length, 0, `${name}: rejected evidence is never reserved`);
    assert.equal(readFileSync(fixture.reportPath).equals(reportBefore), true, `${name}: rejected probe cannot mutate report`);
  }

  await assertForgedProbeRejected("missing-history", async ({ historyStore }) => { historyStore.clear(); });
  await assertForgedProbeRejected("unrelated-oom", async ({ historyStore, promptId }) => {
    historyStore.get(promptId).diagnostics[0].data.prompt_id = "different-real-prompt";
  });
  await assertForgedProbeRejected("journal-hash", async ({ journal }) => { journal.attempts[0].workflowSha256 = "0".repeat(64); });
  await assertForgedProbeRejected("journal-inputs", async ({ journal }) => { journal.attempts[0].workflowInputs.startImage = "forged/start.png"; });
  await assertForgedProbeRejected("history-seed", async ({ historyStore, promptId }) => { historyStore.get(promptId).storedWorkflow["11"].inputs.seed += 1; });
  await assertForgedProbeRejected("history-geometry", async ({ historyStore, promptId }) => { historyStore.get(promptId).storedWorkflow["10"].inputs.width = 960; });
  await assertForgedProbeRejected("history-prefix", async ({ historyStore, promptId }) => { historyStore.get(promptId).storedWorkflow["16"].inputs.filename_prefix = "Video/unrelated_production"; });
  await assertForgedProbeRejected("history-preset", async ({ historyStore, promptId }) => { historyStore.get(promptId).storedWorkflow["1"].inputs.unet_name = "other.safetensors"; });

  const validFetchHistoryFixture = makeApprovedReport(resolve(tempRoot, "probe-valid-default-history"));
  const validFetchHistoryStore = new Map();
  await assert.rejects(runSegment1Candidate({ candidate: 2, reportPath: validFetchHistoryFixture.reportPath, experimentRoot: validFetchHistoryFixture.root }, adapter({
    failAttempts: 3,
    failureKind: "oom",
    historyStore: validFetchHistoryStore
  })), /failed after 3 technical attempts/i);
  const validFetchJournalPath = resolve(validFetchHistoryFixture.root, "video", "candidate_002", ATTEMPT_JOURNAL_FILENAME);
  const validFetchJournal = JSON.parse(readFileSync(validFetchJournalPath, "utf8"));
  validFetchJournal.attempts = [validFetchJournal.attempts.at(-1)];
  writeFileSync(validFetchJournalPath, `${JSON.stringify(validFetchJournal, null, 2)}\n`, "utf8");
  const validFetchPromptId = validFetchJournal.attempts[0].promptId;
  const validFetchStored = validFetchHistoryStore.get(validFetchPromptId);
  const validFetchCalls = [];
  const validFetchImpl = async (url) => {
    validFetchCalls.push(url);
    if (url.endsWith("/object_info")) return jsonResponse(liveInventory());
    if (url.endsWith(`/history/${validFetchPromptId}`)) return jsonResponse({ [validFetchPromptId]: {
      prompt: [7, validFetchPromptId, validFetchStored.storedWorkflow, {}, ["16"]],
      outputs: {},
      status: { status_str: "error", completed: false, messages: validFetchStored.diagnostics.map((item) => [item.event, item.data]) }
    } });
    if (url.endsWith("/free")) return jsonResponse({ error: "authorized-history-stop" }, 500);
    throw new Error(`unexpected valid-history fake request: ${url}`);
  };
  await assert.rejects(runSegment1Candidate({
    candidate: 2,
    reportPath: validFetchHistoryFixture.reportPath,
    experimentRoot: validFetchHistoryFixture.root,
    probeResolution: { width: 960, height: 544, label: "960x544" },
    comfyUrl: "http://127.0.0.1:8188",
    fetchImpl: validFetchImpl,
    clock: fakeClock()
  }), /authorized-history-stop/i);
  assert.equal(validFetchCalls.some((url) => url.endsWith(`/history/${validFetchPromptId}`)), true);
  assert.equal(validFetchCalls.some((url) => url.endsWith("/free")), true, "valid fake Comfy history passes provenance authorization to the unload preflight");
  assert.equal(JSON.parse(readFileSync(validFetchJournalPath, "utf8")).probeAttempts.length, 0, "pre-reservation unload failure cannot consume the one-shot probe");

  const probe = makeApprovedReport(resolve(tempRoot, "probe-valid-oom"));
  const probeBefore = readFileSync(probe.reportPath);
  const probeHistory = new Map();
  await assert.rejects(runSegment1Candidate({ candidate: 3, reportPath: probe.reportPath, experimentRoot: probe.root }, adapter({ failAttempts: 3, failureKind: "oom", historyStore: probeHistory })), /failed after 3 technical attempts/i);
  const productionOomJournalPath = resolve(probe.root, "video", "candidate_003", ATTEMPT_JOURNAL_FILENAME);
  const productionOomJournal = JSON.parse(readFileSync(productionOomJournalPath, "utf8"));
  assert.equal(productionOomJournal.attempts.every((item) => item.promptId && item.isOom && classifyStructuredOom(item.diagnostics)), true);
  assert.equal(productionOomJournal.attempts.every((item) => /^[a-f0-9]{64}$/.test(item.workflowSha256)), true, "all failed queued OOM attempts retain submitted-workflow hashes");
  const probeCalls = [];
  const probeResult = await runSegment1Candidate({
    candidate: 3,
    reportPath: probe.reportPath,
    experimentRoot: probe.root,
    probeResolution: { width: 960, height: 544, label: "960x544" }
  }, adapter({ calls: probeCalls, rawOptions: { width: 960, height: 544 }, historyStore: probeHistory }));
  assert.equal(probeResult.probeOnly, true);
  assert.equal(probeResult.candidate, undefined);
  assert.equal(probeResult.probe.seed, VIDEO_SEEDS[2]);
  assert.equal(probeResult.probe.metadata.width, 960);
  assert.equal(probeResult.probe.metadata.height, 544);
  assert.equal(readFileSync(probe.reportPath).equals(probeBefore), true, "probe output cannot be promoted into the production report");
  assert.equal(resolve(probeResult.probe.rawFlfPath).startsWith(`${resolve(probe.root, "video", "probes", "candidate_003")}\\`), true, "probe artifacts remain outside the persisted production-attempt directory");
  assert.equal(existsSync(resolve(probe.root, "video", "candidate_003")), true, "the production OOM journal remains persisted");
  assert.equal(probeCalls.filter((call) => call.startsWith("generate:")).length, 1, "valid structured OOM authorizes exactly one probe prompt");
  assert.equal(probeCalls.filter((call) => call.startsWith("history:")).length, 1, "probe authorization re-queries exactly one real Comfy history record");
  const journalAfterProbe = JSON.parse(readFileSync(productionOomJournalPath, "utf8"));
  assert.equal(journalAfterProbe.probeAttempts.length, 1);
  assert.equal(journalAfterProbe.probeAttempts[0].status, "accepted");
  const secondProbeCalls = [];
  await assert.rejects(runSegment1Candidate({ candidate: 3, reportPath: probe.reportPath, experimentRoot: probe.root, probeResolution: { width: 960, height: 544, label: "960x544" } }, adapter({ calls: secondProbeCalls, rawOptions: { width: 960, height: 544 } })), /probe.*already|exactly one probe/i);
  assert.deepEqual(secondProbeCalls, []);

  const concurrent = makeApprovedReport(resolve(tempRoot, "concurrent"));
  const concurrentSentinel = { changedBy: "concurrent writer" };
  await assert.rejects(runSegment1Candidate({ candidate: 1, reportPath: concurrent.reportPath, experimentRoot: concurrent.root }, {
    ...adapter(),
    async beforeReportWrite() {
      writeFileSync(concurrent.reportPath, `${JSON.stringify(concurrentSentinel)}\n`, "utf8");
    }
  }), /report state changed during segment-1 generation/i);
  assert.deepEqual(JSON.parse(readFileSync(concurrent.reportPath, "utf8")), concurrentSentinel, "stale runner never overwrites concurrent report bytes");
  assert.equal(existsSync(`${concurrent.reportPath}.lock`), false, "owned report lock is cleaned after stale-state failure");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("Wan FLF2V segment-1 contract: PASS");
