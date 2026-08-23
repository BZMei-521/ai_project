import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRunReport, sha256File, writeJsonAtomic } from "./lib/layered-compositing-run.mjs";
import { createRiverLayout } from "./lib/layered-compositing-layout.mjs";
import {
  assertWorkflowObjectInfo,
  compileWorkflow,
  createComfyAdapter,
  generateCharacter,
  generateEmptyPlate,
  compositeEmptyPlate,
} from "./lib/layered-compositing-comfy.mjs";

const EMPTY_PRESET_PATH = path.resolve("src/modules/comfy-pipeline/presets/layered-empty-plate-qwen-v1.json");
const CHARACTER_PRESET_PATH = path.resolve("src/modules/comfy-pipeline/presets/layered-character-qwen-v1.json");
const EMPTY_OUTPUT_NODE = "20";
const CHARACTER_OUTPUT_NODE = "30";
const VALID_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+5yJ+mwAAAABJRU5ErkJggg==", "base64");

function response(payload, { status = 200, bytes } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return typeof payload === "string" ? payload : JSON.stringify(payload); },
    async arrayBuffer() { return Uint8Array.from(bytes ?? []).buffer; },
  };
}

function pngHeader(width = 1152, height = 640) {
  const bytes = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes, 0);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

function colorPng(filePath, color, size = "1152x640") {
  run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=${size}:d=0.04`, "-frames:v", "1", filePath]);
  return { path: filePath, size: readFileSync(filePath).length, sha256: sha256File(filePath) };
}

function pinnedObjectInfo() {
  const string = ["STRING"];
  const float = ["FLOAT"];
  const image = ["IMAGE"];
  const model = ["MODEL"];
  const conditioning = ["CONDITIONING"];
  const latent = ["LATENT"];
  const vae = ["VAE"];
  const clip = ["CLIP"];
  return {
    UNETLoader: { input: { required: { unet_name: [["qwen_image_edit_2511_fp8mixed.safetensors"]], weight_dtype: [["default"]] } }, output: ["MODEL"] },
    LoraLoaderModelOnly: { input: { required: { model, lora_name: [["Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"]], strength_model: float } }, output: ["MODEL"] },
    ModelSamplingAuraFlow: { input: { required: { model, shift: float } }, output: ["MODEL"] },
    CLIPLoader: { input: { required: { clip_name: [["qwen_2.5_vl_7b_fp8_scaled.safetensors"]], type: [["qwen_image"]], device: [["default"]] } }, output: ["CLIP"] },
    VAELoader: { input: { required: { vae_name: [["qwen_image_vae.safetensors"]] } }, output: ["VAE"] },
    LoadImage: { input: { required: { image: string } }, output: ["IMAGE", "MASK"] },
    ImageToMask: { input: { required: { image, channel: [["red", "green", "blue", "alpha"]] } }, output: ["MASK"] },
    TextEncodeQwenImageEditPlus: { input: { required: { clip, prompt: string }, optional: { vae, image1: image, image2: image, image3: image } }, output: ["CONDITIONING"] },
    ConditioningZeroOut: { input: { required: { conditioning } }, output: ["CONDITIONING"] },
    VAEEncode: { input: { required: { pixels: image, vae } }, output: ["LATENT"] },
    VAEEncodeForInpaint: { input: { required: { pixels: image, vae, mask: ["MASK"], grow_mask_by: ["INT"] } }, output: ["LATENT"] },
    EmptySD3LatentImage: { input: { required: { width: ["INT"], height: ["INT"], batch_size: ["INT"] } }, output: ["LATENT"] },
    KSampler: { input: { required: { model, positive: conditioning, negative: conditioning, latent_image: latent, seed: ["INT"], steps: ["INT"], cfg: float, sampler_name: [["euler"]], scheduler: [["beta"]], denoise: float } }, output: ["LATENT"] },
    VAEDecode: { input: { required: { samples: latent, vae } }, output: ["IMAGE"] },
    SaveImage: { input: { required: { images: image, filename_prefix: string } }, output: [] },
  };
}

function history(promptId, nodeId, filename, subfolder = "layered") {
  return {
    [promptId]: {
      status: { completed: true, status_str: "success" },
      outputs: { [nodeId]: { images: [{ filename, subfolder, type: "output" }] } },
    },
  };
}

function makeFakeFetch({ objectInfo = pinnedObjectInfo(), outputNode = EMPTY_OUTPUT_NODE, filename = "candidate.png", subfolder = "layered", outputBytes = VALID_PNG, onHistory, uploadSubfolder, onPrompt } = {}) {
  const calls = [];
  const uploadedBytes = [];
  let uploadIndex = 0;
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, options });
    if (parsed.pathname === "/object_info") return response(objectInfo);
    if (parsed.pathname === "/upload/image") {
      const blob = options.body.get("image");
      uploadedBytes.push(Buffer.from(await blob.arrayBuffer()));
      uploadIndex += 1;
      return response({ name: `upload_${uploadIndex}.png`, subfolder: uploadSubfolder ?? options.body.get("subfolder"), type: "input" });
    }
    if (parsed.pathname === "/prompt") { onPrompt?.(); return response({ prompt_id: "prompt-123" }); }
    if (parsed.pathname === "/history/prompt-123") {
      onHistory?.();
      return response(history("prompt-123", outputNode, filename, subfolder));
    }
    if (parsed.pathname === "/view") return response(null, { bytes: outputBytes });
    return response({ error: "unexpected request" }, { status: 404 });
  };
  return { calls, fetchImpl, uploadedBytes };
}

function writeResource(root, name, contents = name) {
  const filePath = path.join(root, name);
  writeFileSync(filePath, contents);
  return { path: filePath, size: Buffer.byteLength(contents), sha256: sha256File(filePath) };
}

function createFixture(root, { optionalViews = true } = {}) {
  mkdirSync(root, { recursive: true });
  const source = colorPng(path.join(root, "mother.png"), "red");
  const maskPath = path.join(root, "two-person-mask.png");
  run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=1152x640:d=0.04", "-vf", "format=gray,lut=y=0,drawbox=x=390:y=100:w=160:h=465:color=white:t=fill,drawbox=x=650:y=130:w=130:h=435:color=white:t=fill", "-frames:v", "1", maskPath]);
  const mask = { path: maskPath, size: readFileSync(maskPath).length, sha256: sha256File(maskPath) };
  const faceA = colorPng(path.join(root, "shen-face.png"), "blue", "32x32");
  const frontA = colorPng(path.join(root, "shen-front.png"), "green", "32x32");
  const sideA = colorPng(path.join(root, "shen-side.png"), "yellow", "32x32");
  const backA = colorPng(path.join(root, "shen-back.png"), "purple", "32x32");
  const faceB = colorPng(path.join(root, "jiang-face.png"), "cyan", "32x32");
  const frontB = colorPng(path.join(root, "jiang-front.png"), "gray", "32x32");
  const sideB = colorPng(path.join(root, "jiang-side.png"), "white", "32x32");
  const backB = colorPng(path.join(root, "jiang-back.png"), "black", "32x32");
  const report = createRunReport({
    source: { ...source, width: 1152, height: 640 },
    characters: {
      shen_yan: { name: "Shen Yan", species: "human", faceMaster: faceA, bodyFront: frontA, structureFront: frontA, structureSide: sideA, structureBack: backA },
      jiang_lan: { name: "Jiang Lan", species: "human", faceMaster: faceB, bodyFront: frontB, structureFront: frontB, structureSide: sideB, structureBack: backB },
    },
    lighting: { key: "warm sunset from screen-right/rear", fill: "soft fill from screen-left/front", shadow: "screen-left/front" },
  });
  if (!optionalViews) {
    delete report.characters.shen_yan.structureSide; delete report.characters.shen_yan.structureBack;
    delete report.characters.jiang_lan.structureSide; delete report.characters.jiang_lan.structureBack;
  }
  const reportPath = path.join(root, "run-report.json");
  writeJsonAtomic(reportPath, report);
  return { mask, report, reportPath };
}

function mutate(value, action) { const cloned = structuredClone(value); action(cloned); return cloned; }

const root = mkdtempSync(path.join(tmpdir(), "layered-comfy-"));
try {
  assert.equal(existsSync(EMPTY_PRESET_PATH), true, "empty-plate preset must exist");
  assert.equal(existsSync(CHARACTER_PRESET_PATH), true, "character preset must exist");
  const emptyPreset = JSON.parse(readFileSync(EMPTY_PRESET_PATH, "utf8"));
  const characterPreset = JSON.parse(readFileSync(CHARACTER_PRESET_PATH, "utf8"));
  const objectInfo = pinnedObjectInfo();

  const emptyMaskGraphFindings = [];
  if (emptyPreset["14"]?.inputs?.image2 || JSON.stringify(emptyPreset["14"]?.inputs?.image1) !== JSON.stringify(["6", 0])) emptyMaskGraphFindings.push("removal mask must not be a visual Qwen reference image");
  if (emptyPreset["8"]?.class_type !== "ImageToMask" || JSON.stringify(emptyPreset["8"]?.inputs) !== JSON.stringify({ image: ["7", 0], channel: "red" })) emptyMaskGraphFindings.push("grayscale mask IMAGE must convert through red-channel ImageToMask");
  if (emptyPreset["18"]?.class_type !== "VAEEncodeForInpaint" || JSON.stringify(emptyPreset["18"]?.inputs) !== JSON.stringify({ pixels: ["6", 0], vae: ["5", 0], mask: ["8", 0], grow_mask_by: 0 })) emptyMaskGraphFindings.push("sampler latent must carry the converted approved mask as its exact inpaint/noise mask");
  if (emptyPreset["16"]?.inputs?.denoise !== 1.0) emptyMaskGraphFindings.push("inpaint denoise contract drifted");
  if (emptyMaskGraphFindings.length) throw new Error(`Empty-plate mask semantics regression: ${emptyMaskGraphFindings.join("; ")}`);

  const polarityFixture = path.join(root, "mask-polarity.png");
  run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=4x2:d=0.04", "-vf", "format=gray,drawbox=x=1:y=0:w=2:h=2:color=white:t=fill", "-frames:v", "1", polarityFixture]);
  const extractedRed = (maskPath) => spawnSync("ffmpeg", ["-v", "error", "-i", maskPath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { encoding: null, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }).stdout;
  const polarityPixels = extractedRed(polarityFixture); let fixtureWhite = 0; let fixtureBlack = 0;
  for (let offset = 0; offset < polarityPixels.length; offset += 3) { assert.equal(polarityPixels[offset], polarityPixels[offset + 1]); assert.equal(polarityPixels[offset], polarityPixels[offset + 2]); if (polarityPixels[offset] > 127) fixtureWhite += 1; else fixtureBlack += 1; }
  assert.equal(fixtureWhite, 4, "white red-channel pixels must become the editable/noise mask"); assert.equal(fixtureBlack, 4, "black red-channel pixels must remain protected");
  const approvedMaskPath = path.resolve("logs/layered-two-character-sample/preflight/two-person-removal-mask.png");
  if (existsSync(path.resolve("logs/layered-two-character-sample/run-report.json"))) assert.equal(existsSync(approvedMaskPath), true, "an initialized live sample must retain its approved removal mask");
  if (existsSync(approvedMaskPath)) { const pixels = extractedRed(approvedMaskPath); let white = 0; let black = 0; for (let offset = 0; offset < pixels.length; offset += 3) { assert.equal(pixels[offset], pixels[offset + 1]); assert.equal(pixels[offset], pixels[offset + 2]); if (pixels[offset] > 127) white += 1; else black += 1; } assert.equal(white, 154040); assert.equal(black, 583240); assert.equal(white / (white + black), 0.20893012152777779); }

  const exact = compileWorkflow({ a: "{{NUMBER}}", b: "prefix-{{TEXT}}", c: ["{{BOOL}}"] }, { NUMBER: 7, TEXT: "ok", BOOL: false });
  assert.deepEqual(exact, { a: 7, b: "prefix-ok", c: [false] });
  assert.throws(() => compileWorkflow({ value: "{{MISSING}}" }, {}), /unresolved/i);
  assert.throws(() => compileWorkflow({ value: "{{lower-case}}" }, {}), /unresolved/i);
  assert.throws(() => compileWorkflow({ value: "{{KNOWN}}" }, { KNOWN: "ok", EXTRA: "no" }), /token.*inventory|extra/i);
  assert.doesNotThrow(() => assertWorkflowObjectInfo(compileWorkflow(emptyPreset, { SOURCE_IMAGE: "source.png", REMOVAL_MASK: "mask.png", SEED: 101, FILENAME_PREFIX: "plate/candidate_001" }), objectInfo));
  assert.doesNotThrow(() => assertWorkflowObjectInfo(compileWorkflow(characterPreset, {
    FACE_MASTER: "face.png", BODY_FRONT: "front.png", STRUCTURE_FRONT: "front.png",
    PROMPT: "one human", SEED: 201, FILENAME_PREFIX: "character/candidate_001",
  }), objectInfo));
  const liveComboObjectInfo = {
    LoadBackgroundRemovalModel: { input: { required: { bg_removal_name: ["COMBO", { options: ["birefnet.safetensors"], multiselect: false }] } }, output: ["REMOVAL_MODEL"] },
  };
  const liveComboWorkflow = { "2": { class_type: "LoadBackgroundRemovalModel", inputs: { bg_removal_name: "birefnet.safetensors" } } };
  assert.doesNotThrow(() => assertWorkflowObjectInfo(liveComboWorkflow, liveComboObjectInfo), "live COMBO literals must use the closed options enum");
  assert.throws(() => assertWorkflowObjectInfo(mutate(liveComboWorkflow, (g) => { g["2"].inputs.bg_removal_name = "other.safetensors"; }), liveComboObjectInfo), /enum|option/i, "COMBO must reject unenumerated options");
  assert.throws(() => assertWorkflowObjectInfo(mutate(liveComboWorkflow, (g) => { g["2"].inputs.bg_removal_name = 7; }), liveComboObjectInfo), /type|string|combo/i, "single-select COMBO must reject non-string literals");
  assert.throws(() => assertWorkflowObjectInfo(liveComboWorkflow, mutate(liveComboObjectInfo, (info) => { info.LoadBackgroundRemovalModel.input.required.bg_removal_name[1].multiselect = true; })), /multiselect|array|combo/i, "multiselect COMBO must not accept a scalar literal");
  assert.throws(() => assertWorkflowObjectInfo(liveComboWorkflow, mutate(liveComboObjectInfo, (info) => { delete info.LoadBackgroundRemovalModel.input.required.bg_removal_name[1].options; })), /options|combo/i, "COMBO must fail closed without an options inventory");
  const malformedMultiselectMetadata = [
    ["absent", (info) => { delete info.LoadBackgroundRemovalModel.input.required.bg_removal_name[1].multiselect; }],
    ["string", (info) => { info.LoadBackgroundRemovalModel.input.required.bg_removal_name[1].multiselect = "false"; }],
    ["null", (info) => { info.LoadBackgroundRemovalModel.input.required.bg_removal_name[1].multiselect = null; }],
  ];
  const malformedMultiselectAccepted = malformedMultiselectMetadata.flatMap(([label, alter]) => {
    try { assertWorkflowObjectInfo(liveComboWorkflow, mutate(liveComboObjectInfo, alter)); return [label]; } catch { return []; }
  });
  assert.deepEqual(malformedMultiselectAccepted, [], "COMBO must fail closed when multiselect metadata is absent, a string, or null");
  const comboLinkWorkflow = {
    "1": { class_type: "ForgedComboSource", inputs: {} },
    "2": { class_type: "LoadBackgroundRemovalModel", inputs: { bg_removal_name: ["1", 0] } },
  };
  const comboLinkObjectInfo = {
    ForgedComboSource: { input: { required: {} }, output: ["COMBO"] },
    ...liveComboObjectInfo,
  };
  const malformedComboLinkMetadataAccepted = malformedMultiselectMetadata.flatMap(([label, alter]) => {
    try { assertWorkflowObjectInfo(comboLinkWorkflow, mutate(comboLinkObjectInfo, alter)); return [label]; } catch { return []; }
  });
  assert.deepEqual(malformedComboLinkMetadataAccepted, [], "link-shaped values and COMBO-typed sources must not bypass absent, string, or null multiselect metadata validation");
  const comboModelObjectInfo = { UNETLoader: { input: { required: { unet_name: ["COMBO", { options: ["qwen.safetensors"], multiselect: false }] } }, output: ["MODEL"] } };
  assert.doesNotThrow(() => assertWorkflowObjectInfo({ "1": { class_type: "UNETLoader", inputs: { unet_name: "qwen.safetensors" } } }, comboModelObjectInfo), "model selection enumeration must accept live COMBO metadata");
  assert.deepEqual(characterPreset["26"], { class_type: "EmptySD3LatentImage", inputs: { width: 1152, height: 640, batch_size: 1 } }, "character graph must own exact output geometry");
  for (const [label, workflow, pattern] of [
    ["unknown class", mutate(emptyPreset, (g) => { g["1"].class_type = "MissingClass"; }), /class/i],
    ["missing required input", mutate(emptyPreset, (g) => { delete g["16"].inputs.steps; }), /required.*steps|steps.*required/i],
    ["unknown input", mutate(emptyPreset, (g) => { g["16"].inputs.typo = 1; }), /input/i],
    ["dangling link", mutate(emptyPreset, (g) => { g["16"].inputs.model = ["404", 0]; }), /resolve|missing/i],
    ["wrong output index", mutate(emptyPreset, (g) => { g["16"].inputs.model = ["3", 9]; }), /output/i],
    ["wrong link type", mutate(emptyPreset, (g) => { g["16"].inputs.model = ["4", 0]; }), /type/i],
    ["literal type drift", mutate(emptyPreset, (g) => { g["16"].inputs.steps = "4"; }), /type/i],
    ["literal enum drift", mutate(emptyPreset, (g) => { g["16"].inputs.sampler_name = "not-euler"; }), /enum/i],
    ["connection literal", mutate(emptyPreset, (g) => { g["16"].inputs.model = "MODEL"; }), /link|connection/i],
    ["connection malformed array", mutate(emptyPreset, (g) => { g["16"].inputs.model = ["3"]; }), /link|connection/i],
  ]) {
    assert.throws(() => assertWorkflowObjectInfo(compileWorkflow(workflow, { SOURCE_IMAGE: "source.png", REMOVAL_MASK: "mask.png", SEED: 101, FILENAME_PREFIX: "plate/test" }), objectInfo), pattern, label);
  }
  const modelDrift = pinnedObjectInfo(); modelDrift.UNETLoader.input.required.unet_name = [["other.safetensors"]];
  assert.throws(() => assertWorkflowObjectInfo(compileWorkflow(emptyPreset, { SOURCE_IMAGE: "source.png", REMOVAL_MASK: "mask.png", SEED: 101, FILENAME_PREFIX: "plate/test" }), modelDrift), /enum/i);
  const dynamicImages = pinnedObjectInfo(); dynamicImages.LoadImage.input.required.image = [["older-existing.png"], { image_upload: true }];
  assert.doesNotThrow(() => assertWorkflowObjectInfo(compileWorkflow(emptyPreset, { SOURCE_IMAGE: "newly-uploaded.png", REMOVAL_MASK: "new-mask.png", SEED: 101, FILENAME_PREFIX: "plate/test" }), dynamicImages), "LoadImage upload inventory is dynamic, not a closed enum");
  const customConnection = pinnedObjectInfo(); customConnection.KSampler.input.required.model = ["CUSTOM_NONPRIMITIVE"];
  assert.throws(() => assertWorkflowObjectInfo(mutate(compileWorkflow(emptyPreset, { SOURCE_IMAGE: "source.png", REMOVAL_MASK: "mask.png", SEED: 101, FILENAME_PREFIX: "plate/test" }), (g) => { g["16"].inputs.model = "literal"; }), customConnection), /link|connection/i, "every nonprimitive type requires a link");

  const directValid = colorPng(path.join(root, "direct-valid.png"), "red", "32x32");
  const directFake = makeFakeFetch({ outputBytes: readFileSync(directValid.path) });
  const directDestination = path.join(root, "direct.png");
  const adapter = createComfyAdapter({ baseUrl: "http://127.0.0.1:8188/", fetchImpl: directFake.fetchImpl, now: () => 1000, wait: async () => {} });
  const uploadFixture = writeResource(root, "upload.png", VALID_PNG);
  await assert.doesNotReject(() => adapter.uploadImage({ filePath: uploadFixture.path, role: "test", subfolder: "expected/input" }));
  const wrongUploadFake = makeFakeFetch({ uploadSubfolder: "wrong/input" });
  await assert.rejects(() => createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: wrongUploadFake.fetchImpl, now: () => 1000, wait: async () => {} }).uploadImage({ filePath: uploadFixture.path, role: "test", subfolder: "expected/input" }), /subfolder|descriptor/i);
  const journal = [];
  const queued = await adapter.queue(emptyPreset, { onQueued: async ({ promptId }) => journal.push(promptId) });
  assert.equal(journal[0], queued.promptId, "onQueued runs before queue resolves to caller");
  const captured = await adapter.capture({ promptId: queued.promptId, outputNodeId: EMPTY_OUTPUT_NODE, filenamePrefix: "candidate", destination: directDestination, pollIntervalMs: 0 });
  assert.deepEqual(readFileSync(directDestination), readFileSync(directValid.path));
  assert.equal(captured.promptId, "prompt-123");
  await assert.rejects(() => adapter.capture({ promptId: "prompt-123", outputNodeId: "wrong", filenamePrefix: "candidate", destination: path.join(root, "wrong.png"), pollIntervalMs: 0 }), /output node|configured/i);
  await assert.rejects(() => adapter.capture({ promptId: "prompt-123", outputNodeId: EMPTY_OUTPUT_NODE, filenamePrefix: "candidate", destination: directDestination, pollIntervalMs: 0 }), /exists|overwrite/i);
  for (const descriptor of [
    { filename: "C:/escape.png", subfolder: "layered", type: "output" },
    { filename: "../escape.png", subfolder: "layered", type: "output" },
    { filename: "dir/escape.png", subfolder: "layered", type: "output" },
    { filename: "candidate.png", subfolder: "../layered", type: "output" },
    { filename: "candidate.png", subfolder: "layered", type: "temp" },
  ]) {
    const unsafe = makeFakeFetch();
    unsafe.fetchImpl = async (url, options = {}) => {
      const parsed = new URL(url);
      unsafe.calls.push({ url: parsed, options });
      if (parsed.pathname === "/history/prompt-123") return response({ "prompt-123": { status: { completed: true, status_str: "success" }, outputs: { [EMPTY_OUTPUT_NODE]: { images: [descriptor] } } } });
      if (parsed.pathname === "/view") return response(null, { bytes: readFileSync(directValid.path) });
      return response({});
    };
    const unsafeAdapter = createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: unsafe.fetchImpl, now: () => 1000, wait: async () => {} });
    await assert.rejects(() => unsafeAdapter.capture({ promptId: "prompt-123", outputNodeId: EMPTY_OUTPUT_NODE, filenamePrefix: "candidate", expectedSubfolder: "layered", destination: path.join(root, `unsafe-${Math.random()}.png`), pollIntervalMs: 0 }), /descriptor|filename|subfolder|type|safe/i);
  }
  const wrongGeometryPath = colorPng(path.join(root, "wrong-geometry-source.png"), "red", "1024x640");
  const wrongGeometryFake = makeFakeFetch({ outputBytes: readFileSync(wrongGeometryPath.path) });
  const wrongGeometryAdapter = createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: wrongGeometryFake.fetchImpl, now: () => 1000, wait: async () => {} });
  await assert.rejects(() => wrongGeometryAdapter.capture({ promptId: "prompt-123", outputNodeId: EMPTY_OUTPUT_NODE, filenamePrefix: "candidate", destination: path.join(root, "wrong-geometry.png"), expectedGeometry: { width: 1152, height: 640 }, pollIntervalMs: 0 }), /1152.*640|geometry/i);
  const corruptCaptureFake = makeFakeFetch({ outputBytes: pngHeader() });
  await assert.rejects(() => createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: corruptCaptureFake.fetchImpl, now: () => 1000, wait: async () => {} }).capture({ promptId: "prompt-123", outputNodeId: EMPTY_OUTPUT_NODE, filenamePrefix: "candidate", destination: path.join(root, "corrupt-capture.png"), pollIntervalMs: 0 }), /decode|image/i);

  const fixture = createFixture(root);
  const sourceMutationFixture = createFixture(path.join(root, "source-mutation"));
  writeFileSync(sourceMutationFixture.report.source.path, "corrupt source");
  const sourceMutationFake = makeFakeFetch({ filename: "empty_plate.png", subfolder: "empty_plate/candidate_001" });
  await assert.rejects(() => generateEmptyPlate({ reportPath: sourceMutationFixture.reportPath, candidate: 1, removalMaskPath: sourceMutationFixture.mask.path, adapter: createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: sourceMutationFake.fetchImpl, now: () => 1000, wait: async () => {} }) }), /source|mother|frozen|hash|decode/i);
  assert.equal(sourceMutationFake.calls.some((call) => call.url.pathname === "/prompt"), false, "mutated source fails before prompt");
  const wrongSourceFixture = createFixture(path.join(root, "wrong-source-geometry"));
  const wrongSource = colorPng(path.join(root, "wrong-source.png"), "red", "1024x640");
  wrongSourceFixture.report.source = { ...wrongSource, width: 1152, height: 640 };
  writeJsonAtomic(wrongSourceFixture.reportPath, wrongSourceFixture.report);
  const wrongSourceFake = makeFakeFetch({ filename: "empty_plate.png", subfolder: "empty_plate/candidate_001" });
  await assert.rejects(() => generateEmptyPlate({ reportPath: wrongSourceFixture.reportPath, candidate: 1, removalMaskPath: wrongSourceFixture.mask.path, adapter: createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: wrongSourceFake.fetchImpl, now: () => 1000, wait: async () => {} }) }), /1152.*640|geometry/i);
  assert.equal(wrongSourceFake.calls.some((call) => call.url.pathname === "/upload/image" || call.url.pathname === "/prompt"), false, "hash-consistent wrong source geometry fails before upload and prompt");
  for (const [label, color] of [["empty", "black"], ["full", "white"]]) {
    const coverageFixture = createFixture(path.join(root, `coverage-${label}`));
    const coverageMask = colorPng(path.join(root, `coverage-${label}.png`), color);
    const coverageFake = makeFakeFetch({ filename: "empty_plate.png", subfolder: "empty_plate/candidate_001" });
    await assert.rejects(() => generateEmptyPlate({ reportPath: coverageFixture.reportPath, candidate: 1, removalMaskPath: coverageMask.path, adapter: createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: coverageFake.fetchImpl, now: () => 1000, wait: async () => {} }) }), /coverage/i);
    assert.equal(coverageFake.calls.some((call) => call.url.pathname === "/prompt"), false, `${label} mask fails before prompt`);
  }
  const plateCandidateDir = path.join(root, "empty_plate", "candidate_001");
  let durableQueueSeen = false;
  const plateFake = makeFakeFetch({ filename: "empty_plate.png", subfolder: "empty_plate/candidate_001", outputBytes: readFileSync(fixture.report.source.path), onHistory: () => {
    const attempts = path.join(root, "empty_plate", "attempts", "candidate_001");
    const attemptDirs = existsSync(attempts) ? readdirSync(attempts) : [];
    durableQueueSeen = attemptDirs.some((dir) => JSON.parse(readFileSync(path.join(attempts, dir, "attempt.json"), "utf8")).promptId === "prompt-123");
  } });
  const plateResult = await generateEmptyPlate({
    reportPath: fixture.reportPath, candidate: 1, removalMaskPath: fixture.mask.path,
    adapter: createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: plateFake.fetchImpl, now: () => 1000, wait: async () => {} }),
  });
  assert.equal(durableQueueSeen, true, "prompt ID is durable before history polling");
  assert.equal(plateResult.candidate.id, "candidate_001");
  assert.equal(plateResult.candidate.promptId, "prompt-123");
  assert.equal(plateResult.candidate.state, "technical");
  assert.equal(plateResult.candidate.creativeAcceptance, "pending");
  assert.equal(plateResult.report.overallStatus, "pending");
  assert.equal(existsSync(path.join(plateCandidateDir, "empty_plate.png")), true);
  assert.equal(readFileSync(fixture.reportPath, "utf8").includes("prompt-123"), true);
  assert.equal(plateResult.candidate.artifact.path, path.join(plateCandidateDir, "empty_plate.png"));
  assert.match(plateResult.candidate.comfyOutput.path, /attempts.*comfy-output\.png/i);
  assert.notEqual(plateResult.candidate.comfyOutput.sha256, undefined);
  assert.equal(plateResult.candidate.removalMask.role, "fixed-two-person-removal-mask");
  assert.equal(plateResult.candidate.references.source.role, "immutable-mother-frame");
  const maskManifestPath = path.join(root, "layered-removal-mask.json");
  const maskManifest = JSON.parse(readFileSync(maskManifestPath, "utf8"));
  assert.equal(maskManifest.sha256, fixture.mask.sha256);
  assert.equal(maskManifest.width, 1152); assert.equal(maskManifest.height, 640);
  assert.ok(maskManifest.coverage > 0.001 && maskManifest.coverage < 0.25);
  await assert.rejects(() => generateEmptyPlate({ reportPath: fixture.reportPath, candidate: 1, removalMaskPath: fixture.mask.path, adapter }), /exists|candidate/i);
  const invalidInfo = pinnedObjectInfo(); invalidInfo.VAELoader.input.required.vae_name = [["different-vae.safetensors"]];
  const preflightFake = makeFakeFetch({ objectInfo: invalidInfo, filename: "empty_plate.png" });
  await assert.rejects(() => generateEmptyPlate({ reportPath: fixture.reportPath, candidate: 3, removalMaskPath: fixture.mask.path, adapter: createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: preflightFake.fetchImpl, now: () => 1000, wait: async () => {} }) }), /enum/i);
  assert.equal(existsSync(path.join(root, "empty_plate", "candidate_003")), false, "preflight failure must not reserve a candidate directory");
  assert.equal(preflightFake.calls.some((call) => call.url.pathname === "/prompt"), false, "preflight failure must not queue");
  const wrongMask = colorPng(path.join(root, "wrong-mask.png"), "white", "1024x640");
  const wrongMaskFake = makeFakeFetch({ filename: "empty_plate.png" });
  await assert.rejects(() => generateEmptyPlate({ reportPath: fixture.reportPath, candidate: 3, removalMaskPath: wrongMask.path, adapter: createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: wrongMaskFake.fetchImpl, now: () => 1000, wait: async () => {} }) }), /1152.*640|geometry/i);
  assert.equal(wrongMaskFake.calls.some((call) => call.url.pathname === "/prompt"), false, "wrong mask geometry must not queue");
  const differentMaskPath = path.join(root, "different-mask.png");
  run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=1152x640:d=0.04", "-vf", "format=gray,lut=y=0,drawbox=x=300:y=100:w=100:h=100:color=white:t=fill", "-frames:v", "1", differentMaskPath]);
  const differentMaskFake = makeFakeFetch({ filename: "empty_plate.png", subfolder: "empty_plate/candidate_002", outputBytes: readFileSync(fixture.report.source.path) });
  await assert.rejects(() => generateEmptyPlate({ reportPath: fixture.reportPath, candidate: 2, removalMaskPath: differentMaskPath, adapter: createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: differentMaskFake.fetchImpl, now: () => 1000, wait: async () => {} }) }), /mask.*hash|frozen.*mask/i);
  assert.equal(differentMaskFake.calls.some((call) => call.url.pathname === "/prompt"), false);
  const markerFixture = createFixture(path.join(root, "queued-marker-failure"));
  const markerFake = makeFakeFetch({ filename: "empty_plate.png", subfolder: "empty_plate/candidate_001", outputBytes: readFileSync(markerFixture.report.source.path) });
  await assert.rejects(() => generateEmptyPlate({ reportPath: markerFixture.reportPath, candidate: 1, removalMaskPath: markerFixture.mask.path, afterQueuedMarker: () => { throw new Error("injected journal boundary failure"); }, adapter: createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: markerFake.fetchImpl, now: () => 7777, wait: async () => {} }) }), /injected journal boundary failure/i);
  const queuedMarker = path.join(path.dirname(markerFixture.reportPath), "empty_plate", ".candidate_001.queued");
  assert.deepEqual(JSON.parse(readFileSync(queuedMarker, "utf8")), { promptId: "prompt-123", queuedAt: 7777 }, "first durable post-prompt marker is recovery JSON");
  const burnedRetryFake = makeFakeFetch({ filename: "empty_plate.png", subfolder: "empty_plate/candidate_001" });
  await assert.rejects(() => generateEmptyPlate({ reportPath: markerFixture.reportPath, candidate: 1, removalMaskPath: markerFixture.mask.path, adapter: createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: burnedRetryFake.fetchImpl, now: () => 8888, wait: async () => {} }) }), /queued.*not reusable|burned|candidate/i);
  assert.equal(burnedRetryFake.calls.some((call) => call.url.pathname === "/prompt"), false);
  const retryFake = makeFakeFetch({ filename: "empty_plate.png", subfolder: "empty_plate/candidate_003", outputBytes: readFileSync(fixture.report.source.path) });
  const retryResult = await generateEmptyPlate({ reportPath: fixture.reportPath, candidate: 3, removalMaskPath: fixture.mask.path, adapter: createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: retryFake.fetchImpl, now: () => 4000, wait: async () => {} }) });
  assert.equal(retryResult.candidate.id, "candidate_003", "a durable failed-prequeue attempt permits an explicit safe retry");
  const retryAttemptsRoot = path.join(root, "empty_plate", "attempts", "candidate_003");
  const retryStatuses = readdirSync(retryAttemptsRoot).map((dir) => JSON.parse(readFileSync(path.join(retryAttemptsRoot, dir, "attempt.json"), "utf8")).status).sort();
  assert.deepEqual(retryStatuses, ["completed", "failed-prequeue"]);

  const characterFake = makeFakeFetch({ outputNode: CHARACTER_OUTPUT_NODE, filename: "shen_yan.png", subfolder: "shen_yan/candidate_002", outputBytes: readFileSync(fixture.report.source.path) });
  const characterResult = await generateCharacter({
    reportPath: fixture.reportPath, character: "shen_yan", candidate: 2, layout: createRiverLayout(),
    adapter: createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: characterFake.fetchImpl, now: () => 2000, wait: async () => {} }),
  });
  assert.equal(characterResult.candidate.seed, 73112002);
  assert.equal(characterResult.candidate.character, "shen_yan");
  assert.match(characterResult.candidate.prompt, /exactly one human/i);
  assert.match(characterResult.candidate.prompt, /full body.*feet/i);
  assert.match(characterResult.candidate.prompt, /neutral removable background/i);
  assert.match(characterResult.candidate.prompt, /inward/i);
  assert.match(characterResult.candidate.prompt, /no other person/i);
  assert.match(characterResult.candidate.prompt, /no beast traits/i);
  assert.equal(characterFake.calls.filter((call) => call.url.pathname === "/upload/image").length, 3, "only the chosen character's supported frozen references are uploaded");
  assert.equal(characterResult.report.stages.jiang_lan.candidates.length, 0);
  assert.deepEqual(characterFake.uploadedBytes.map((bytes) => sha256File((() => { const p = path.join(root, `uploaded-${Math.random()}.png`); writeFileSync(p, bytes); return p; })())), [fixture.report.characters.shen_yan.faceMaster.sha256, fixture.report.characters.shen_yan.bodyFront.sha256, fixture.report.characters.shen_yan.structureFront.sha256]);
  assert.match(characterResult.candidate.prompt, /Picture 1 is the sole face identity authority/i);
  assert.match(characterResult.candidate.prompt, /Picture 2 controls body.*costume.*only/i);
  assert.match(characterResult.candidate.prompt, /Picture 3 controls front-view.*structure only/i);
  assert.equal(characterResult.candidate.presetSha256, sha256File(CHARACTER_PRESET_PATH));
  assert.match(characterResult.candidate.workflowSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(characterResult.candidate.models, { unet: "qwen_image_edit_2511_fp8mixed.safetensors", clip: "qwen_2.5_vl_7b_fp8_scaled.safetensors", vae: "qwen_image_vae.safetensors", lora: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors" });
  assert.equal(characterResult.candidate.references.faceMaster.role, "sole-face-authority");
  assert.equal(characterResult.candidate.references.bodyFront.role, "body-costume-only");
  assert.equal(characterResult.candidate.references.structureFront.role, "front-structure-only");

  const concurrentFake = makeFakeFetch({ outputNode: CHARACTER_OUTPUT_NODE, filename: "shen_yan.png", subfolder: "shen_yan/candidate_003", outputBytes: readFileSync(fixture.report.source.path) });
  const concurrentAdapter = createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: concurrentFake.fetchImpl, now: () => 5000, wait: async () => {} });
  const concurrent = await Promise.allSettled([
    generateCharacter({ reportPath: fixture.reportPath, character: "shen_yan", candidate: 3, layout: createRiverLayout(), adapter: concurrentAdapter }),
    generateCharacter({ reportPath: fixture.reportPath, character: "shen_yan", candidate: 3, layout: createRiverLayout(), adapter: concurrentAdapter }),
  ]);
  assert.deepEqual(concurrent.map((item) => item.status).sort(), ["fulfilled", "rejected"], "exclusive candidate reservation permits exactly one invocation");
  assert.equal(concurrentFake.calls.filter((call) => call.url.pathname === "/prompt").length, 1, "concurrent duplicate queues exactly once");
  assert.equal(JSON.parse(readFileSync(fixture.reportPath, "utf8")).stages.shen_yan.candidates.filter((item) => item.id === "candidate_003").length, 1);
  assert.equal(existsSync(characterResult.candidate.comfyOutput.path), true);
  assert.equal(sha256File(characterResult.candidate.comfyOutput.path), characterResult.candidate.comfyOutput.sha256);

  const serialFixture = createFixture(path.join(root, "serial-run"));
  const promptIntervals = []; let activePrompts = 0;
  function serialFake(candidateNumber) {
    const base = makeFakeFetch({ outputNode: CHARACTER_OUTPUT_NODE, filename: "jiang_lan.png", subfolder: `jiang_lan/candidate_00${candidateNumber}`, outputBytes: readFileSync(serialFixture.report.source.path) });
    const original = base.fetchImpl;
    base.fetchImpl = async (url, options) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/prompt") { activePrompts += 1; promptIntervals.push({ candidateNumber, event: "start", activePrompts }); await new Promise((resolve) => setTimeout(resolve, 30)); const result = await original(url, options); activePrompts -= 1; promptIntervals.push({ candidateNumber, event: "end", activePrompts }); return result; }
      return original(url, options);
    };
    return base;
  }
  const serialA = serialFake(1); const serialB = serialFake(2);
  await Promise.all([
    generateCharacter({ reportPath: serialFixture.reportPath, character: "jiang_lan", candidate: 1, adapter: createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: serialA.fetchImpl, now: Date.now, wait: async () => {} }) }),
    generateCharacter({ reportPath: serialFixture.reportPath, character: "jiang_lan", candidate: 2, adapter: createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: serialB.fetchImpl, now: Date.now, wait: async () => {} }) }),
  ]);
  assert.equal(Math.max(...promptIntervals.map((item) => item.activePrompts)), 1, "run-wide lock serializes distinct prompt intervals");
  assert.equal(JSON.parse(readFileSync(serialFixture.reportPath, "utf8")).stages.jiang_lan.candidates.length, 2, "serialized distinct candidates both append without loss");

  const optionalRoot = path.join(root, "optional-views");
  const optionalFixture = createFixture(optionalRoot, { optionalViews: false });
  const optionalFake = makeFakeFetch({ outputNode: CHARACTER_OUTPUT_NODE, filename: "jiang_lan.png", subfolder: "jiang_lan/candidate_001", outputBytes: readFileSync(optionalFixture.report.source.path) });
  await assert.doesNotReject(() => generateCharacter({ reportPath: optionalFixture.reportPath, character: "jiang_lan", candidate: 1, layout: createRiverLayout(), adapter: createComfyAdapter({ baseUrl: "http://127.0.0.1:8188", fetchImpl: optionalFake.fetchImpl, now: () => 3000, wait: async () => {} }) }), "side/back structure views are optional");

  const beforeQueueCount = characterFake.calls.filter((call) => call.url.pathname === "/prompt").length;
  const malformedLayout = createRiverLayout(); malformedLayout.canvas.width = 1;
  await assert.rejects(() => generateCharacter({ reportPath: fixture.reportPath, character: "jiang_lan", candidate: 1, layout: malformedLayout, adapter }), /layout|canonical/i);
  assert.equal(characterFake.calls.filter((call) => call.url.pathname === "/prompt").length, beforeQueueCount, "malformed layout fails before queueing");
  const malformedReportPath = path.join(root, "malformed-report.json");
  writeFileSync(malformedReportPath, "{}");
  await assert.rejects(() => generateCharacter({ reportPath: malformedReportPath, character: "jiang_lan", candidate: 1, adapter }), /report|schema/i);
  assert.throws(() => compileWorkflow(characterPreset, { FACE_MASTER: "x" }), /unresolved/i);

  const runner = path.resolve("scripts/run-layered-character.mjs");
  for (const args of [
    ["--character", "unknown", "--candidate", "1", "--report", fixture.reportPath],
    ["--character", "shen_yan", "--candidate", "4", "--report", fixture.reportPath],
    ["--character", "shen_yan", "--candidate", "1", "--report", fixture.reportPath, "--seed", "9"],
    ["--character", "shen_yan", "--candidate", "1"],
    ["--character", "shen_yan", "--candidate", "01", "--report", fixture.reportPath],
    ["--character", "shen_yan", "--candidate", "1.0", "--report", fixture.reportPath],
  ]) assert.throws(() => execFileSync(process.execPath, [runner, ...args], { encoding: "utf8", stdio: "pipe" }), /usage|candidate|character/i);
  await import(`${pathToFileURL(runner).href}?import-check=1`);

  const emptyPrompt = emptyPreset["14"].inputs.prompt;
  for (const phrase of ["remove both people", "same continuous stone road", "do not add any object", "riverbank", "stone perspective", "trees", "river outline", "sunset direction", "palette", "camera", "1152x640"]) assert.match(emptyPrompt, new RegExp(phrase, "i"));
  assert.equal(emptyPreset[EMPTY_OUTPUT_NODE].class_type, "SaveImage");
  assert.equal(characterPreset[CHARACTER_OUTPUT_NODE].class_type, "SaveImage");

  const mediaRoot = path.join(root, "media"); mkdirSync(mediaRoot);
  const mother = colorPng(path.join(mediaRoot, "mother.png"), "red");
  const fill = colorPng(path.join(mediaRoot, "fill.png"), "blue");
  const maskPath = path.join(mediaRoot, "mask.png");
  run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=1152x640:d=0.04", "-vf", "format=gray,lut=y=0,drawbox=x=100:y=100:w=100:h=100:color=white:t=fill", "-frames:v", "1", maskPath]);
  const finalPath = path.join(mediaRoot, "final.png");
  assert.doesNotThrow(() => compositeEmptyPlate({ sourcePath: mother.path, fillPath: fill.path, maskPath, outputPath: finalPath }));
  const outside = execFileSync("ffmpeg", ["-v", "error", "-i", finalPath, "-vf", "crop=1:1:0:0,format=rgb24", "-frames:v", "1", "-f", "rawvideo", "pipe:1"], { encoding: null });
  const motherOutside = execFileSync("ffmpeg", ["-v", "error", "-i", mother.path, "-vf", "crop=1:1:0:0,format=rgb24", "-frames:v", "1", "-f", "rawvideo", "pipe:1"], { encoding: null });
  const inside = execFileSync("ffmpeg", ["-v", "error", "-i", finalPath, "-vf", "crop=1:1:110:110,format=rgb24", "-frames:v", "1", "-f", "rawvideo", "pipe:1"], { encoding: null });
  assert.deepEqual(outside, motherOutside, "outside-mask RGB remains the exact decoded mother-frame pixel");
  assert.ok(inside[2] > inside[0], "inside-mask RGB transfers from fill");
  const corrupt = path.join(mediaRoot, "corrupt.png"); writeFileSync(corrupt, pngHeader());
  assert.throws(() => compositeEmptyPlate({ sourcePath: corrupt, fillPath: fill.path, maskPath, outputPath: path.join(mediaRoot, "bad-final.png") }), /decode|ffprobe|image/i);
  const jpegNamedPng = path.join(mediaRoot, "jpeg-renamed.png");
  run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=1152x640:d=0.04", "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", jpegNamedPng]);
  assert.throws(() => compositeEmptyPlate({ sourcePath: jpegNamedPng, fillPath: fill.path, maskPath, outputPath: path.join(mediaRoot, "jpeg-final.png") }), /png|codec/i);
  const truncated = path.join(mediaRoot, "truncated.png"); const fillBytes = readFileSync(fill.path); writeFileSync(truncated, fillBytes.subarray(0, Math.floor(fillBytes.length / 2)));
  assert.throws(() => compositeEmptyPlate({ sourcePath: truncated, fillPath: fill.path, maskPath, outputPath: path.join(mediaRoot, "truncated-final.png") }), /decode|ffmpeg|image/i);

  console.log("Layered compositing Comfy contract: PASS");
} finally {
  rmSync(root, { recursive: true, force: true });
}
