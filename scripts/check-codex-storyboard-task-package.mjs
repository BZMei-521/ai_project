import assert from "node:assert/strict";
import { chmod, copyFile, lstat, mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { build } from "esbuild";
import typescript from "typescript";
import * as runtime from "../src/services/generation-providers/codexTaskPackageRuntime.mjs";

const comfyBundle = await build({
  entryPoints: [path.join(process.cwd(), "src/modules/comfy-pipeline/comfyService.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  write: false
});
const comfyService = await import(
  `data:text/javascript;base64,${Buffer.from(comfyBundle.outputFiles[0].text).toString("base64")}`
);

const providerSource = await readFile(
  new URL("../src/services/generation-providers/codexTaskPackageProvider.ts", import.meta.url),
  "utf8"
);
const cliSource = await readFile(new URL("./run-codex-storyboard-job.mjs", import.meta.url), "utf8");
assert.match(cliSource, /const MAX_IMAGE_BYTES = 64 \* 1024 \* 1024/);
assert.match(cliSource, /const MAX_IMAGE_PIXELS = 64 \* 1024 \* 1024/);
const preReadLimit = cliSource.indexOf("before.size > MAX_IMAGE_BYTES");
const imageRead = cliSource.indexOf("readFile(filePath)", preReadLimit);
const postReadCheck = cliSource.indexOf("bytes.length !== before.size", imageRead);
assert.ok(preReadLimit >= 0 && imageRead > preReadLimit && postReadCheck > imageRead);
const providerModule = await import(`data:text/javascript,${encodeURIComponent(
  typescript.transpileModule(providerSource, {
    compilerOptions: { target: typescript.ScriptTarget.ES2020, module: typescript.ModuleKind.ESNext }
  }).outputText
)}`);
const { CodexTaskPackageProvider } = providerModule;

const sha = (character) => character.repeat(64);
const characterAsset = {
  id: "character-1",
  projectId: "project-1",
  type: "character",
  name: "Shen Yan",
  filePath: "C:/project/assets/shen-yan.png",
  characterIdentityPack: {
    version: "identity-v1",
    triggerWord: "shen_yan",
    species: "human",
    speciesTraits: [],
    styleContractId: "cinematic_3d_donghua_v1",
    styleContractVersion: "1.0.0",
    styleContractDigest: sha("1"),
    faceMasterPath: "C:/project/assets/shen-yan-face.png",
    bodyFrontPath: "C:/project/assets/shen-yan-body.png",
    immutableTraits: ["black hair"],
    forbiddenChanges: ["costume drift"],
    approvedHeroFramePaths: ["C:/project/assets/shen-yan-style.png"],
    updatedAt: "2026-08-28T00:00:00.000Z"
  }
};
const storyboardShot = {
  id: "shot-1",
  sequenceId: "episode-1",
  order: 1,
  title: "Rooftop confrontation",
  durationFrames: 48,
  dialogue: "You came back.",
  notes: "Low-angle medium shot with rain and strong rim light.",
  tags: ["night", "rain"],
  storyPrompt: "Shen Yan faces the rival across the rooftop.",
  negativePrompt: "identity drift",
  characterRefs: [characterAsset.id],
  generatedImagePath: "C:/project/accepted/shot-1.png"
};
const defaultSelections = comfyService.buildDefaultCodexStoryboardReferenceSelections({
  shot: storyboardShot,
  assets: [characterAsset],
  spatialFramePath: "C:/project/spatial/shot-1.png"
});
assert.deepEqual(
  defaultSelections.map(({ id, usage, sourcePath }) => ({ id, usage, sourcePath })),
  [
    { id: "spatial-authority", usage: "spatial_authority", sourcePath: "C:/project/spatial/shot-1.png" },
    { id: "character-body", usage: "body_costume", sourcePath: "C:/project/assets/shen-yan-body.png" },
    { id: "character-face", usage: "face_identity", sourcePath: "C:/project/assets/shen-yan-face.png" },
    { id: "style-1", usage: "style_only", sourcePath: "C:/project/assets/shen-yan-style.png" }
  ],
  "the default helper must emit spatial, body, face, then style references"
);
assert.ok(defaultSelections.every((item) => item.instruction.trim()), "every default reference must be annotated");
assert.match(defaultSelections[3].instruction, /does not control composition/i);

const appendedStyleSelections = [
  ...defaultSelections,
  {
    id: "style-2",
    sourcePath: "C:/project/assets/palette-style.png",
    usage: "style_only",
    instruction: "Use only the palette and surface treatment; this image does not control composition."
  }
];
const preparedRequest = comfyService.buildCodexStoryboardPackageRequest({
  jobId: "job-1",
  projectPath: "C:/project",
  project: {
    id: "project-1",
    name: "Storyboard Project",
    fps: 24,
    width: 1920,
    height: 1080,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z"
  },
  sequence: { id: "episode-1", projectId: "project-1", name: "Episode 1", order: 1 },
  shot: storyboardShot,
  assets: [characterAsset],
  references: appendedStyleSelections,
  createdAt: "2026-08-28T00:00:00.000Z"
});
assert.deepEqual(preparedRequest.references, appendedStyleSelections, "request construction must preserve caller order");
assert.match(preparedRequest.references[3].instruction, /does not control composition/i);
assert.match(preparedRequest.references[4].instruction, /does not control composition/i);
assert.notEqual(preparedRequest.references[3].instruction, preparedRequest.references[4].instruction);
assert.equal(preparedRequest.acceptedImagePath, storyboardShot.generatedImagePath);
assert.match(preparedRequest.prompt.primaryRequest, /Rooftop confrontation/);
assert.match(preparedRequest.prompt.primaryRequest, /cinematic/i);

const { projectPath: _projectPath, ...immutablePreparedRequest } = preparedRequest;
const immutableRequestForPrompt = {
  ...immutablePreparedRequest,
  references: preparedRequest.references.map((reference, index) => ({
    id: reference.id,
    usage: reference.usage,
    instruction: reference.instruction,
    relativePath: `references/reference-${index + 1}.png`,
    sha256: String(index + 1).repeat(64),
    width: 512,
    height: 512,
    mimeType: "image/png"
  })),
  expectedOutput: {
    candidatePath: "outputs/candidate.png",
    resultPath: "outputs/result.json",
    mimeTypes: ["image/png"]
  }
};
const compiledPreparedPrompt = runtime.compileCodexStoryboardImageSpec(immutableRequestForPrompt).compiledPrompt;
assert.match(compiledPreparedPrompt, /Picture 4 \[style_only\]:.*does not control composition/i);
assert.match(compiledPreparedPrompt, /Picture 5 \[style_only\]:.*does not control composition/i);

const secondCharacterAsset = {
  ...characterAsset,
  id: "character-2",
  name: "Wei Xun",
  filePath: "C:/project/assets/wei-xun.png",
  characterIdentityPack: {
    ...characterAsset.characterIdentityPack,
    faceMasterPath: "C:/project/assets/wei-xun-face.png",
    bodyFrontPath: "C:/project/assets/wei-xun-body.png",
    approvedHeroFramePaths: ["C:/project/assets/wei-xun-style.png"]
  }
};
const buildFramingRequest = (shot, semanticProfile) => comfyService.buildCodexStoryboardPackageRequest({
  jobId: `job-${shot.order}`,
  projectPath: "C:/project",
  project: {
    id: "project-1", name: "Storyboard Project", fps: 24, width: 1920, height: 1080,
    createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z"
  },
  sequence: { id: "episode-1", projectId: "project-1", name: "Episode 1", order: 1 },
  shot: { ...storyboardShot, ...shot, characterRefs: [characterAsset.id, secondCharacterAsset.id], generatedImagePath: "" },
  assets: [characterAsset, secondCharacterAsset],
  references: appendedStyleSelections,
  semanticProfile,
  createdAt: "2026-08-28T00:00:00.000Z"
});
const immutableFramingRequest = (prepared) => {
  const { projectPath: _ignored, ...request } = prepared;
  return {
    ...request,
    references: request.references.map((reference, index) => ({
      id: reference.id, usage: reference.usage, instruction: reference.instruction,
      relativePath: `references/reference-${index + 1}.png`, sha256: String(index + 1).repeat(64),
      width: 512, height: 512, mimeType: "image/png"
    })),
    expectedOutput: { candidatePath: "outputs/candidate.png", resultPath: "outputs/result.json", mimeTypes: ["image/png"] }
  };
};

const c22Prepared = buildFramingRequest({
  id: "E01-S01-C22", order: 22,
  storyPrompt: "over-the-shoulder-insert; camera locked-off; the shovel blade stays above the horizontal panel with an air gap."
}, "yingdi_e01_c22_ots_insert");
assert.equal(Object.hasOwn(c22Prepared.prompt.hardConstraints, "subjectCount"), false);
assert.match(c22Prepared.prompt.hardConstraints.primarySubject, /short broad shovel blade.*horizontal phoenix panel.*clear air gap/i);
assert.doesNotMatch(c22Prepared.prompt.hardConstraints.primarySubject, /Shen Yan/i);
assert.match(c22Prepared.prompt.hardConstraints.secondaryPresence, /Wei Xun.*cropped shoulder.*back.of.head.*edge framing only.*Shen Yan.*limited secondary continuity inside (?:the )?coffin.*never co-equal/is);
const c22Compiled = runtime.compileCodexStoryboardImageSpec(immutableFramingRequest(c22Prepared)).compiledPrompt;
assert.match(c22Compiled, /Subject visibility:.*two story characters.*cropped.*shoulder.*back of head/is);
assert.match(c22Compiled, /Camera and framing lock:.*genuine locked-off over-the-shoulder insert/is);
assert.match(c22Compiled, /Visible anatomy:.*only anatomy actually required by this insert.*shovel blade.*horizontal panel.*air gap/is);
assert.match(c22Compiled, /Spatial authority role:.*environment.*layout.*not.*camera/is);
assert.doesNotMatch(c22Compiled, /Exact subject count: 2/);
assert.doesNotMatch(c22Compiled, /No pose, composition, camera, framing, projection, or occlusion drift from spatial authority/);

const c23Prepared = buildFramingRequest({
  id: "E01-S01-C23", order: 23,
  storyPrompt: "extreme-close-up; camera rack-focus-hold; the uninjured left hand stops one inch from the jade while the injured right hand protects the wound."
}, "yingdi_e01_c23_jade_ecu");
assert.equal(Object.hasOwn(c23Prepared.prompt.hardConstraints, "subjectCount"), false);
assert.match(c23Prepared.prompt.hardConstraints.primarySubject, /Shen Yan.*primary/i);
assert.match(c23Prepared.prompt.hardConstraints.secondaryPresence, /Wei Xun.*optional_defocused_edge/i);
const c23Compiled = runtime.compileCodexStoryboardImageSpec(immutableFramingRequest(c23Prepared)).compiledPrompt;
assert.match(c23Compiled, /Subject visibility:.*Shen Yan.*primary subject.*Wei Xun.*optional.*tiny defocused edge/is);
assert.match(c23Compiled, /Camera and framing lock:.*extreme close-up.*rack-focus-hold/is);
assert.match(c23Compiled, /Visible anatomy:.*uninjured LEFT hand.*injured RIGHT protective hand.*required fingers/is);
assert.match(c23Compiled, /Spatial authority role:.*environment.*layout.*not.*camera/is);
assert.doesNotMatch(c23Compiled, /Exact subject count: 2/);
assert.doesNotMatch(c23Compiled, /No pose, composition, camera, framing, projection, or occlusion drift from spatial authority/);
const c23EditBaseInstruction = "EDIT COMPOSITION BASE FOR C23: preserve this image's approved extreme-close-up crop and rack-focus-hold look. Edit only that hand-role and injury assignment while preserving the approved ECU composition.";
const c23EditPrepared = comfyService.buildCodexStoryboardPackageRequest({
  jobId: "job-c23-edit", projectPath: "C:/project",
  project: { id: "project-1", name: "Storyboard Project", fps: 24, width: 1920, height: 1080, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z" },
  sequence: { id: "episode-1", projectId: "project-1", name: "Episode 1", order: 1 },
  shot: { ...storyboardShot, id: "E01-S01-C23", order: 23, characterRefs: [characterAsset.id, secondCharacterAsset.id], storyPrompt: "extreme-close-up; camera rack-focus-hold; the uninjured left hand stops one inch from the jade while the injured right hand protects the wound.", generatedImagePath: "" },
  assets: [characterAsset, secondCharacterAsset],
  references: appendedStyleSelections.map((reference, index) => index === 0 ? { ...reference, usage: "spatial_authority", instruction: c23EditBaseInstruction } : reference),
  semanticProfile: "yingdi_e01_c23_jade_ecu",
  createdAt: "2026-08-28T00:00:00.000Z"
});
const c23EditCompiled = runtime.compileCodexStoryboardImageSpec(immutableFramingRequest(c23EditPrepared)).compiledPrompt;
assert.match(c23EditPrepared.prompt.hardConstraints.cameraFramingLock, /preserve.*ECU edit base.*camera.*framing.*composition/is);
assert.match(c23EditPrepared.prompt.hardConstraints.spatialAuthorityRole, /ECU edit base.*sole camera.*framing.*composition authority/is);
assert.match(c23EditCompiled, /Spatial authority role:.*ECU edit base.*sole camera.*framing.*composition authority/is);
assert.doesNotMatch(c23EditCompiled, /spatial-authority contact sheet only for environment/i);
const c23CropBaseInstruction = "C23 CORRECT-HAND CROP/REFRAME BASE: use this image as the sole spatial, composition, and anatomical hand-role authority. Preserve the subject's own LEFT uninjured reaching hand and RIGHT wounded protective hand exactly; only optical crop, zoom, reframe, depth of field, and Wei edge visibility may change.";
const c23CropPrepared = comfyService.buildCodexStoryboardPackageRequest({
  jobId: "job-c23-crop", projectPath: "C:/project",
  project: { id: "project-1", name: "Storyboard Project", fps: 24, width: 1920, height: 1080, createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z" },
  sequence: { id: "episode-1", projectId: "project-1", name: "Episode 1", order: 1 },
  shot: { ...storyboardShot, id: "E01-S01-C23", order: 23, characterRefs: [characterAsset.id, secondCharacterAsset.id], storyPrompt: "extreme-close-up; camera rack-focus-hold; the uninjured left hand stops one inch from the jade while the injured right hand protects the wound.", generatedImagePath: "" },
  assets: [characterAsset, secondCharacterAsset],
  references: appendedStyleSelections.map((reference, index) => index === 0 ? { ...reference, usage: "spatial_authority", instruction: c23CropBaseInstruction } : reference),
  semanticProfile: "yingdi_e01_c23_jade_ecu",
  createdAt: "2026-08-28T00:00:00.000Z"
});
assert.equal(Object.hasOwn(c23CropPrepared.prompt.hardConstraints, "subjectCount"), false);
assert.match(c23CropPrepared.prompt.hardConstraints.primarySubject, /jade.*LEFT.*hand.*RIGHT.*hand/i);
assert.match(c23CropPrepared.prompt.hardConstraints.secondaryPresence, /Wei Xun.*optional_defocused_edge/i);
assert.match(c23CropPrepared.prompt.hardConstraints.visibleAnatomy, /only.*LEFT.*uninjured.*RIGHT.*wounded.*protective hand/is);
assert.match(c23CropPrepared.prompt.hardConstraints.cameraFramingLock, /optical crop.*zoom.*reframe.*rack-focus/is);
assert.match(c23CropPrepared.prompt.hardConstraints.spatialAuthorityRole, /sole spatial.*composition.*anatomical hand-role authority/is);
assert.match(c23CropPrepared.prompt.hardConstraints.spatialAuthorityRole, /must not re-pose.*exchange hands.*move.*wound/is);
const c23CropCompiled = runtime.compileCodexStoryboardImageSpec(immutableFramingRequest(c23CropPrepared)).compiledPrompt;
assert.doesNotMatch(c23CropCompiled, /Exact subject count:/);
assert.doesNotMatch(c23CropCompiled, /both arms, both hands/i);
assert.match(c23CropCompiled, /Subject visibility:.*jade.*two required hands.*primary content/is);
assert.match(c23CropCompiled, /Camera and framing lock:.*optical crop.*zoom.*reframe/is);
const genericOts = buildFramingRequest({ id: "future-ots", order: 90, title: "Airport handoff", storyPrompt: "over-the-shoulder-insert; camera locked-off; a courier slides an envelope across a glass desk." });
assert.equal(genericOts.prompt.hardConstraints.subjectCount, 2);
assert.doesNotMatch(JSON.stringify(genericOts.prompt.hardConstraints), /coffin|shovel|phoenix|jade|wound|Shen Yan|Wei Xun/i);
const genericEcu = buildFramingRequest({ id: "future-ecu", order: 91, title: "Watch mechanism", storyPrompt: "extreme-close-up; camera rack-focus-hold; a watchmaker adjusts a brass gear." });
assert.equal(genericEcu.prompt.hardConstraints.subjectCount, 2);
assert.doesNotMatch(JSON.stringify(genericEcu.prompt.hardConstraints), /coffin|shovel|phoenix|jade|wound|Shen Yan|Wei Xun/i);
assert.equal(preparedRequest.prompt.hardConstraints.subjectCount, 1);
assert.throws(
  () => comfyService.buildCodexStoryboardPackageRequest({
    jobId: "job-duplicate-id",
    projectPath: "C:/project",
    project: { id: "project-1" },
    sequence: { id: "episode-1" },
    shot: storyboardShot,
    assets: [characterAsset],
    references: [...defaultSelections, { ...defaultSelections[3], sourcePath: "C:/project/assets/other-style.png" }],
    createdAt: "2026-08-28T00:00:00.000Z"
  }),
  /reference_id_invalid/
);
assert.throws(
  () => comfyService.buildCodexStoryboardPackageRequest({
    jobId: "job-relative-path",
    projectPath: "C:/project",
    project: { id: "project-1" },
    sequence: { id: "episode-1" },
    shot: storyboardShot,
    assets: [characterAsset],
    references: defaultSelections.map((item, index) => index === 0 ? { ...item, sourcePath: "relative/stage.png" } : item),
    createdAt: "2026-08-28T00:00:00.000Z"
  }),
  /path_must_be_absolute/
);
const request = {
  schemaVersion: 1,
  jobId: "job-1",
  projectId: "project-1",
  episodeId: "episode-1",
  shotId: "shot-1",
  provider: "codex_task_package",
  createdAt: "2026-08-28T00:00:00.000Z",
  prompt: { useCase: "stylized-concept", primaryRequest: "A dramatic storyboard frame." },
  references: [
    { id: "stage", usage: "spatial_authority", instruction: "Preserve the blocking.", relativePath: "references/stage.png", sha256: sha("a"), width: 1920, height: 1080, mimeType: "image/png" },
    { id: "costume", usage: "body_costume", instruction: "Preserve the costume.", relativePath: "references/costume.png", sha256: sha("b"), width: 512, height: 512, mimeType: "image/png" },
    { id: "face", usage: "face_identity", instruction: "Preserve the face.", relativePath: "references/face.jpg", sha256: sha("c"), width: 512, height: 512, mimeType: "image/jpeg" },
    { id: "style-a", usage: "style_only", instruction: "Use this ink texture.", relativePath: "references/style-a.png", sha256: sha("d"), width: 512, height: 512, mimeType: "image/png" },
    { id: "style-b", usage: "style_only", instruction: "Use this palette.", relativePath: "references/style-b.png", sha256: sha("e"), width: 512, height: 512, mimeType: "image/png" }
  ],
  acceptedImagePath: null,
  expectedOutput: { candidatePath: "outputs/candidate.png", resultPath: "outputs/result.json", mimeTypes: ["image/png"] }
};
const result = {
  schemaVersion: 1,
  jobId: request.jobId,
  projectId: request.projectId,
  episodeId: request.episodeId,
  shotId: request.shotId,
  provider: "codex_task_package",
  requestDigest: sha("f"),
  referenceDigests: request.references.map(({ id, sha256 }) => ({ id, sha256 })),
  generationMode: "codex_builtin_imagegen",
  finalPrompt: runtime.compileCodexStoryboardImageSpec(request).compiledPrompt,
  output: { relativePath: "outputs/candidate.png", sha256: sha("0"), width: 1920, height: 1080, mimeType: "image/png" },
  completedAt: "2026-08-28T00:01:00.000Z",
  state: "completed"
};

assert.equal(runtime.CODEX_STORYBOARD_PROVIDER_ID, "codex_task_package");
assert.equal(runtime.canonicalCodexStoryboardRequest(request), runtime.canonicalCodexStoryboardRequest(structuredClone(request)));
assert.deepEqual(runtime.compileCodexStoryboardImageSpec(request).referenceUsages, [
  "spatial_authority", "body_costume", "face_identity", "style_only", "style_only"
]);
const mandatoryPrompt = runtime.compileCodexStoryboardImageSpec(request).compiledPrompt;
assert.match(mandatoryPrompt, /Picture 5.*style_only/s);
assert.match(mandatoryPrompt, /MANDATORY HARD CONSTRAINTS/);
assert.match(mandatoryPrompt, /Exact subject count: 1/);
assert.match(mandatoryPrompt, /Visible anatomy: both arms, both hands/);
assert.match(mandatoryPrompt, /Camera and framing lock:/);
assert.match(mandatoryPrompt, /No pose, composition, camera, framing, projection, or occlusion drift/);
assert.match(mandatoryPrompt, /No text, captions, logos, signatures, or watermarks/);
assert.throws(() => runtime.validateCodexStoryboardRequest({ ...request, provider: "comfy" }), /provider_mismatch/);
assert.equal(runtime.validateCodexStoryboardRequest({ ...request, prompt: { ...request.prompt, metadata: { lens: "35mm", locked: true } } }).prompt.metadata.lens, "35mm");
assert.throws(() => runtime.validateCodexStoryboardRequest({ ...request, references: request.references.map((item, index) => index === 0 ? { ...item, relativePath: "../escape.png" } : item) }), /path_invalid/);
assert.throws(() => runtime.validateCodexStoryboardRequest({ ...request, references: request.references.map((item, index) => index === 0 ? { ...item, instruction: "" } : item) }), /instruction_invalid/);
assert.throws(() => runtime.validateCodexStoryboardResult({ ...result, shotId: "other" }, request), /identity_mismatch/);
assert.throws(() => runtime.validateCodexStoryboardResult({ ...result, finalPrompt: "attacker prompt" }, request), /prompt_mismatch/);
assert.throws(() => runtime.validateCodexStoryboardResult({ ...result, completedAt: "not-a-time" }, request), /completed_at_invalid/);
assert.throws(() => runtime.validateCodexStoryboardResult({ ...result, completedAt: "2026-02-31T00:00:00.000Z" }, request), /completed_at_invalid/);

const validatedRequest = runtime.validateCodexStoryboardRequest(request);
assert.throws(() => validatedRequest.references.push(request.references[0]), /read only|not extensible/i);
assert.throws(() => validatedRequest.references.reverse(), /read only/i);
assert.throws(() => { validatedRequest.references[0].sha256 = sha("f"); }, /read only/i);
assert.throws(() => { validatedRequest.references[0].usage = "style_only"; }, /read only/i);
assert.throws(() => { validatedRequest.references[0].instruction = "Rewrite blocking."; }, /read only/i);

const validatedResult = runtime.validateCodexStoryboardResult(result, request);
assert.throws(() => { validatedResult.output.sha256 = sha("f"); }, /read only/i);
assert.throws(() => { validatedResult.referenceDigests[0].sha256 = sha("f"); }, /read only/i);
const derivedTransform = {
  operation: "user_authorized_local_deterministic_crop",
  authorization: { observedAt: "2026-08-30T02:14:40.535Z", context: "User explicitly authorized one local deterministic crop." },
  tool: { name: "ffmpeg", generative: false, filter: "crop=1184:666:488:244" },
  source: { absolutePath: "C:\\source.png", sha256: "a".repeat(64), width: 1672, height: 941 },
  cropRectangle: { x: 488, y: 244, width: 1184, height: 666 },
  output: { absolutePath: "C:\\derived.png", sha256: "b".repeat(64), width: 1184, height: 666 },
  pixelExactCrop: true
};
const cropResult = { ...result, generationMode: "user_authorized_local_deterministic_crop", derivedTransform, output: { ...result.output, sha256: "b".repeat(64), width: 1184, height: 666 } };
assert.equal(runtime.validateCodexStoryboardResult(cropResult, request).derivedTransform.tool.generative, false);
assert.throws(() => runtime.validateCodexStoryboardResult({ ...cropResult, derivedTransform: { ...derivedTransform, cropRectangle: { ...derivedTransform.cropRectangle, width: 1183 } } }, request), /derived_transform_invalid/);
assert.throws(() => runtime.validateCodexStoryboardResult({ ...result, derivedTransform }, request), /keys_invalid/);

const cliPath = fileURLToPath(new URL("./run-codex-storyboard-job.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const helperBasename = process.platform === "win32" ? "codex-storyboard-operator.exe" : "codex-storyboard-operator";
const helperPath = fileURLToPath(new URL(`../src-tauri/target/debug/${helperBasename}`, import.meta.url));
const fixtureRoot = await mkdtemp(path.join(tmpdir(), "codex-storyboard-contract-fixture-"));
const fixturePackage = path.join(fixtureRoot, "package");
const fixtureCandidate = path.join(fixtureRoot, "candidate.png");
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAsTj2FAAAAABJRU5ErkJggg==", "base64");
const otherTinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==", "base64");
const hashBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonicalizeForDigest = (value) => Array.isArray(value)
  ? value.map(canonicalizeForDigest)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeForDigest(value[key])]))
    : value;
const makeFixtureRequest = () => ({
  schemaVersion: 1,
  jobId: "job-cli-1",
  projectId: "project-cli-1",
  episodeId: "episode-cli-1",
  shotId: "shot-cli-1",
  provider: "codex_task_package",
  createdAt: "2026-08-28T00:00:00.000Z",
  prompt: { useCase: "stylized-concept", primaryRequest: "A locked storyboard frame.", metadata: { lens: "35mm", locked: true } },
  references: [
    ["stage", "spatial_authority", "Preserve geometry and composition."],
    ["body", "body_costume", "Preserve body and costume."],
    ["face", "face_identity", "Preserve facial identity."],
    ["style-a", "style_only", "Use only the painterly material treatment."],
    ["style-b", "style_only", "Use only the cool-blue lighting palette."]
  ].map(([id, usage, instruction], index) => ({
    id, usage, instruction, relativePath: `references/${index + 1}-${id}.png`, sha256: hashBytes(tinyPng), width: 1, height: 1, mimeType: "image/png"
  })),
  acceptedImagePath: null,
  expectedOutput: { candidatePath: "outputs/candidate.png", resultPath: "outputs/result.json", mimeTypes: ["image/png"] }
});
const writeFixturePackage = async () => {
  const request = makeFixtureRequest();
  await mkdir(path.join(fixturePackage, "references"), { recursive: true });
  await Promise.all(request.references.map((reference) => writeFile(path.join(fixturePackage, reference.relativePath), tinyPng)));
  await writeFile(path.join(fixturePackage, "request.json"), `${JSON.stringify(request, null, 2)}\n`);
  return request;
};
let currentInspectionManifest;
const withManifest = (args) => args[0] === "complete" && currentInspectionManifest && !args.includes("--inspection-manifest") ? [...args, "--inspection-manifest", currentInspectionManifest] : args;
const runCli = (...args) => spawnSync(process.execPath, [cliPath, ...withManifest(args)], { encoding: "utf8" });
const runCliWithEnv = (env, ...args) => spawnSync(process.execPath, [cliPath, ...withManifest(args)], { encoding: "utf8", env: { ...process.env, ...env } });
const runCliFrom = (cwd, env, ...args) => spawnSync(process.execPath, [cliPath, ...withManifest(args)], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
const runHelper = (env = {}) => spawnSync(helperPath, ["complete", "--package", fixturePackage, "--candidate", fixtureCandidate, "--candidate-digest", hashBytes(tinyPng), "--inspection-manifest", currentInspectionManifest], { encoding: "utf8", env: { ...process.env, ...env } });
const runCliAsync = (args, env = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cliPath, ...withManifest(args)], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CODEX_STORYBOARD_OPERATOR_BIN: helperPath, ...env } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (status) => resolve({ status, stdout, stderr }));
});
const exists = async (filePath) => {
  try { await lstat(filePath); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
};
const restoreMovedDirectory = async (original, moved) => {
  if (!await exists(moved)) return;
  if (await exists(original)) await rm(original, { recursive: true, force: true });
  await rename(moved, original);
};

try {
  const cliRequest = await writeFixturePackage();
  const linkedPackage = path.join(fixtureRoot, "linked-package");
  await symlink(fixturePackage, linkedPackage, "junction");
  const symlinkedPackage = runCli("inspect", "--package", linkedPackage);
  assert.equal(symlinkedPackage.status, 12, symlinkedPackage.stderr);
  assert.match(symlinkedPackage.stderr, /codex_storyboard_cli_package_invalid/);
  const inspected = runCli("inspect", "--package", fixturePackage);
  assert.equal(inspected.status, 0, inspected.stderr);
  const inspection = JSON.parse(inspected.stdout);
  assert.equal(inspection.jobId, cliRequest.jobId);
  assert.equal(inspection.shotId, cliRequest.shotId);
  assert.equal(inspection.requestDigest, hashBytes(Buffer.from(JSON.stringify(canonicalizeForDigest(cliRequest)))));
  assert.deepEqual(inspection.referencedImagePaths.map((filePath) => path.basename(filePath)), cliRequest.references.map((reference, index) => `${String(index + 1).padStart(2, "0")}-${reference.id}.${reference.mimeType === "image/jpeg" ? "jpg" : "png"}`));
  assert.deepEqual(inspection.referenceUsages, cliRequest.references.map((reference) => reference.usage));
  assert.deepEqual(inspection.referenceInstructions, cliRequest.references.map((reference) => reference.instruction));
  assert.match(inspection.compiledPrompt, /Picture 5 \[style_only\]: Use only the cool-blue lighting palette\./);
  assert.match(inspection.inspectionRoot, /codex-storyboard-inspection-/);
  assert.match(inspection.inspectionCleanup, /Delete inspectionRoot after built-in image generation finishes/);
  assert.equal(await exists(inspection.manifestPath), true, "inspect publishes an immutable handoff manifest");
  const inspectionManifest = JSON.parse(await readFile(inspection.manifestPath, "utf8"));
  currentInspectionManifest = inspection.manifestPath;
  assert.equal(inspectionManifest.requestDigest, inspection.requestDigest);
  assert.equal(inspectionManifest.compiledPrompt, inspection.compiledPrompt);
  assert.deepEqual(inspectionManifest.references.map((reference) => reference.stagedPath), inspection.referencedImagePaths);
  assert.ok(inspection.referencedImagePaths.every((filePath) => filePath.startsWith(inspection.inspectionRoot)), "inspect exposes staged immutable snapshots rather than source paths");
  assert.ok((await Promise.all(inspection.referencedImagePaths.map((filePath) => lstat(filePath)))).every((entry) => !entry.isSymbolicLink()), "inspect never emits a symlink path");

  await writeFile(path.join(fixturePackage, cliRequest.references[1].relativePath), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==", "base64"));
  const mutated = runCli("inspect", "--package", fixturePackage);
  assert.equal(mutated.status, 11);
  assert.match(mutated.stderr, /codex_storyboard_cli_reference_digest_mismatch/);
  await writeFile(path.join(fixturePackage, cliRequest.references[1].relativePath), tinyPng);
  const oversizedReference = path.join(fixturePackage, cliRequest.references[1].relativePath);
  await truncate(oversizedReference, 64 * 1024 * 1024 + 1);
  const oversized = runCli("inspect", "--package", fixturePackage);
  assert.equal(oversized.status, 11, oversized.stderr);
  await writeFile(oversizedReference, tinyPng);

  await rm(path.join(fixturePackage, "request.json"));
  const missingRequest = runCli("inspect", "--package", fixturePackage);
  assert.equal(missingRequest.status, 10);
  assert.match(missingRequest.stderr, /codex_storyboard_cli_request_missing/);
  await writeFixturePackage();

  const escaped = makeFixtureRequest();
  escaped.references[0].relativePath = "../escape.png";
  await writeFile(path.join(fixturePackage, "request.json"), `${JSON.stringify(escaped, null, 2)}\n`);
  const escapedPath = runCli("inspect", "--package", fixturePackage);
  assert.equal(escapedPath.status, 12);
  assert.match(escapedPath.stderr, /codex_storyboard_cli_reference_path_invalid/);
  await writeFixturePackage();

  const malformedReferenceCases = [
    [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1]), "24-byte pseudo PNG"],
    [Buffer.concat([tinyPng.subarray(0, -1), Buffer.from([tinyPng.at(-1) ^ 1])]), "bad PNG CRC"],
    [Buffer.concat([tinyPng.subarray(0, tinyPng.indexOf(Buffer.from("IDAT")) - 4), tinyPng.subarray(tinyPng.indexOf(Buffer.from("IEND")) - 4)]), "missing IDAT"],
    [tinyPng.subarray(0, tinyPng.indexOf(Buffer.from("IEND")) - 4), "missing IEND"],
    [Buffer.concat([tinyPng, Buffer.from([0])]), "trailing PNG bytes"],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]), "truncated JPEG"]
  ];
  for (const [malformed, label] of malformedReferenceCases) {
    await writeFile(path.join(fixturePackage, cliRequest.references[1].relativePath), malformed);
    const malformedReference = runCli("inspect", "--package", fixturePackage);
    assert.equal(malformedReference.status, 11, label);
    assert.match(malformedReference.stderr, /codex_storyboard_cli_reference_image_invalid/, label);
  }
  await writeFile(path.join(fixturePackage, cliRequest.references[1].relativePath), tinyPng);

  await writeFile(fixtureCandidate, tinyPng);

  const originalRequestText = await readFile(path.join(fixturePackage, "request.json"), "utf8");
  const requestTamperedAfterInspect = makeFixtureRequest();
  requestTamperedAfterInspect.prompt.primaryRequest = "Tampered after inspection.";
  await writeFile(path.join(fixturePackage, "request.json"), `${JSON.stringify(requestTamperedAfterInspect, null, 2)}\n`);
  const helperRejectsRequestTamper = runHelper();
  assert.notEqual(helperRejectsRequestTamper.status, 0, "helper independently rejects request tampering after inspection");
  assert.match(helperRejectsRequestTamper.stderr, /codex_storyboard_operator_manifest_invalid/);
  await writeFile(path.join(fixturePackage, "request.json"), originalRequestText);

  const malformedRequestCases = [
    ["empty createdAt", (value) => { value.createdAt = ""; }],
    ["acceptedImagePath wrong type", (value) => { value.acceptedImagePath = 42; }],
    ["expectedOutput unknown key", (value) => { value.expectedOutput.unknown = true; }],
    ["expectedOutput candidate path", (value) => { value.expectedOutput.candidatePath = "outputs/other.png"; }],
    ["expectedOutput MIME", (value) => { value.expectedOutput.mimeTypes = ["image/jpeg"]; }]
  ];
  for (const [label, mutate] of malformedRequestCases) {
    const malformedRequest = makeFixtureRequest();
    mutate(malformedRequest);
    await writeFile(path.join(fixturePackage, "request.json"), `${JSON.stringify(malformedRequest, null, 2)}\n`);
    const rejected = runHelper();
    assert.notEqual(rejected.status, 0, `helper independently rejects ${label}`);
    assert.match(rejected.stderr, /codex_storyboard_operator_request_invalid/, label);
  }
  await writeFile(path.join(fixturePackage, "request.json"), originalRequestText);

  await writeFile(path.join(fixturePackage, cliRequest.references[1].relativePath), otherTinyPng);
  const helperRejectsReferenceTamper = runHelper();
  assert.notEqual(helperRejectsReferenceTamper.status, 0, "helper independently rejects package reference tampering after inspection");
  await writeFile(path.join(fixturePackage, cliRequest.references[1].relativePath), tinyPng);

  await chmod(inspection.referencedImagePaths[1], 0o600);
  await writeFile(inspection.referencedImagePaths[1], otherTinyPng);
  const helperRejectsStagedTamper = runHelper();
  assert.notEqual(helperRejectsStagedTamper.status, 0, "helper independently re-hashes staged inspection snapshots");
  await writeFile(inspection.referencedImagePaths[1], tinyPng);
  await chmod(inspection.referencedImagePaths[1], 0o400);

  const helperRejectsCaptureOpenSwap = runCliWithEnv({ CODEX_STORYBOARD_TEST_SWAP_PACKAGE_BEFORE_OPEN: "1", CODEX_STORYBOARD_OPERATOR_BIN: helperPath }, "complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(helperRejectsCaptureOpenSwap.status, 15, helperRejectsCaptureOpenSwap.stderr);
  assert.match(helperRejectsCaptureOpenSwap.stderr, /codex_storyboard_operator_package_invalid/);
  assert.equal(await exists(path.join(fixturePackage, "request.json")), true, "package swap test hook restores the original fixture");

  const movedOutputs = path.join(fixtureRoot, "moved-outputs-candidate");
  const movedOutputsMarker = path.join(fixtureRoot, "moved-outputs-candidate-link-attempted");
  const helperRejectsMovedOutputs = runCliWithEnv({ NODE_ENV: "test", CODEX_STORYBOARD_OPERATOR_BIN: helperPath, CODEX_STORYBOARD_TEST_LINK_ATTEMPT_MARKER: movedOutputsMarker, CODEX_STORYBOARD_TEST_REPLACE_OUTPUTS_AFTER_VALIDATE_BEFORE_CANDIDATE_LINK: movedOutputs }, "complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(helperRejectsMovedOutputs.status, 15, helperRejectsMovedOutputs.stderr);
  assert.equal(await exists(movedOutputsMarker), false, "outputs replacement must fail before candidate hard-link execution");
  if (process.platform === "win32") assert.equal(await exists(movedOutputs), false, "retained outputs handle must deny the post-validation rename on Windows");
  assert.equal(await exists(path.join(movedOutputs, "candidate.png")), false, "outputs junction replacement cannot publish candidate externally");
  assert.equal(await exists(path.join(movedOutputs, "result.json")), false, "outputs junction replacement cannot publish result externally");
  await restoreMovedDirectory(path.join(fixturePackage, "outputs"), movedOutputs);
  await rm(path.join(fixturePackage, "outputs"), { recursive: true, force: true });

  const movedPackage = path.join(fixtureRoot, "moved-package-candidate");
  const movedPackageMarker = path.join(fixtureRoot, "moved-package-candidate-link-attempted");
  const helperRejectsMovedPackage = runCliWithEnv({ NODE_ENV: "test", CODEX_STORYBOARD_OPERATOR_BIN: helperPath, CODEX_STORYBOARD_TEST_LINK_ATTEMPT_MARKER: movedPackageMarker, CODEX_STORYBOARD_TEST_REPLACE_PACKAGE_AFTER_VALIDATE_BEFORE_CANDIDATE_LINK: movedPackage }, "complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(helperRejectsMovedPackage.status, 15, helperRejectsMovedPackage.stderr);
  assert.equal(await exists(movedPackageMarker), false, "package replacement must fail before candidate hard-link execution");
  if (process.platform === "win32") assert.equal(await exists(movedPackage), false, "retained package handle must deny the post-validation rename on Windows");
  assert.equal(await exists(path.join(movedPackage, "outputs", "candidate.png")), false, "package junction replacement cannot publish candidate externally");
  assert.equal(await exists(path.join(movedPackage, "outputs", "result.json")), false, "package junction replacement cannot publish result externally");
  await restoreMovedDirectory(fixturePackage, movedPackage);
  await rm(path.join(fixturePackage, "outputs"), { recursive: true, force: true });

  const candidateOnlyForOutputsResult = runCliWithEnv({ NODE_ENV: "test", CODEX_STORYBOARD_TEST_FAIL_RESULT_PUBLISH: "1", CODEX_STORYBOARD_OPERATOR_BIN: helperPath }, "complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(candidateOnlyForOutputsResult.status, 15, candidateOnlyForOutputsResult.stderr);
  const movedOutputsResult = path.join(fixtureRoot, "moved-outputs-result");
  const movedOutputsResultMarker = path.join(fixtureRoot, "moved-outputs-result-link-attempted");
  const helperRejectsMovedOutputsResult = runCliWithEnv({ NODE_ENV: "test", CODEX_STORYBOARD_OPERATOR_BIN: helperPath, CODEX_STORYBOARD_TEST_LINK_ATTEMPT_MARKER: movedOutputsResultMarker, CODEX_STORYBOARD_TEST_REPLACE_OUTPUTS_AFTER_VALIDATE_BEFORE_RESULT_LINK: movedOutputsResult }, "complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(helperRejectsMovedOutputsResult.status, 15, helperRejectsMovedOutputsResult.stderr);
  assert.equal(await exists(movedOutputsResultMarker), false, "outputs replacement must fail before result hard-link execution");
  if (process.platform === "win32") assert.equal(await exists(movedOutputsResult), false, "retained outputs handle must deny the post-validation result rename on Windows");
  assert.equal(await exists(path.join(movedOutputsResult, "result.json")), false, "outputs junction replacement cannot publish result externally");
  await restoreMovedDirectory(path.join(fixturePackage, "outputs"), movedOutputsResult);
  await rm(path.join(fixturePackage, "outputs"), { recursive: true, force: true });

  const candidateOnlyForPackageResult = runCliWithEnv({ NODE_ENV: "test", CODEX_STORYBOARD_TEST_FAIL_RESULT_PUBLISH: "1", CODEX_STORYBOARD_OPERATOR_BIN: helperPath }, "complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(candidateOnlyForPackageResult.status, 15, candidateOnlyForPackageResult.stderr);
  const movedPackageResult = path.join(fixtureRoot, "moved-package-result");
  const movedPackageResultMarker = path.join(fixtureRoot, "moved-package-result-link-attempted");
  const helperRejectsMovedPackageResult = runCliWithEnv({ NODE_ENV: "test", CODEX_STORYBOARD_OPERATOR_BIN: helperPath, CODEX_STORYBOARD_TEST_LINK_ATTEMPT_MARKER: movedPackageResultMarker, CODEX_STORYBOARD_TEST_REPLACE_PACKAGE_AFTER_VALIDATE_BEFORE_RESULT_LINK: movedPackageResult }, "complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(helperRejectsMovedPackageResult.status, 15, helperRejectsMovedPackageResult.stderr);
  assert.equal(await exists(movedPackageResultMarker), false, "package replacement must fail before result hard-link execution");
  if (process.platform === "win32") assert.equal(await exists(movedPackageResult), false, "retained package handle must deny the post-validation result rename on Windows");
  assert.equal(await exists(path.join(movedPackageResult, "outputs", "result.json")), false, "package junction replacement cannot publish result externally");
  await restoreMovedDirectory(fixturePackage, movedPackageResult);
  await rm(path.join(fixturePackage, "outputs"), { recursive: true, force: true });

  const replacementSource = path.join(fixtureRoot, "replacement-source.png");
  await writeFile(replacementSource, otherTinyPng);
  const sourceReplacedAfterStage = runCliWithEnv({ NODE_ENV: "test", CODEX_STORYBOARD_OPERATOR_BIN: helperPath, CODEX_STORYBOARD_TEST_REPLACE_CANDIDATE_AFTER_STAGE: replacementSource }, "complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(sourceReplacedAfterStage.status, 0, sourceReplacedAfterStage.stderr);
  assert.equal(hashBytes(await readFile(fixtureCandidate)), hashBytes(otherTinyPng), "source path was replaced after immutable candidate staging");
  assert.equal(hashBytes(await readFile(path.join(fixturePackage, "outputs", "candidate.png"))), hashBytes(tinyPng), "published candidate remains the staged preflight bytes");
  await writeFile(fixtureCandidate, tinyPng);
  await rm(path.join(fixturePackage, "outputs"), { recursive: true, force: true });

  const relativeOverride = runCliWithEnv({ CODEX_STORYBOARD_OPERATOR_BIN: path.relative(repoRoot, helperPath) }, "complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(relativeOverride.status, 15, relativeOverride.stderr);
  assert.match(relativeOverride.stderr, /codex_storyboard_cli_helper_invalid/);
  await rm(path.join(fixturePackage, "outputs"), { recursive: true, force: true });

  const fakeCargoRoot = path.join(fixtureRoot, "fake-cargo");
  await mkdir(fakeCargoRoot);
  const fakeCargoName = process.platform === "win32" ? "cargo.exe" : "cargo";
  const fakeCargoPath = path.join(fakeCargoRoot, fakeCargoName);
  const forgedHelperJson = JSON.stringify({ jobId: cliRequest.jobId, requestDigest: inspection.requestDigest, candidatePath: path.join(fixturePackage, "outputs", "candidate.png"), resultPath: path.join(fixturePackage, "outputs", "result.json") });
  if (process.platform === "win32") await copyFile(process.env.ComSpec, fakeCargoPath);
  else { await writeFile(fakeCargoPath, `#!/bin/sh\nprintf '%s\\n' '${forgedHelperJson}'\n`); await chmod(fakeCargoPath, 0o700); }
  const maliciousCargo = runCliFrom(fakeCargoRoot, { PATH: fakeCargoRoot }, "complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(maliciousCargo.status, 15, maliciousCargo.stderr);
  assert.match(maliciousCargo.stderr, /codex_storyboard_cli_helper_invalid/);

  const otherCwd = runCliFrom(fixtureRoot, {}, "complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(otherCwd.status, 0, otherCwd.stderr);
  await rm(path.join(fixturePackage, "outputs"), { recursive: true, force: true });

  const forgedStdout = runCliWithEnv({ CODEX_STORYBOARD_OPERATOR_BIN: helperPath, CODEX_STORYBOARD_TEST_FORGE_STDOUT: "1" }, "complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(forgedStdout.status, 15, forgedStdout.stderr);
  assert.match(forgedStdout.stderr, /codex_storyboard_cli_helper_invalid/);
  await rm(path.join(fixturePackage, "outputs"), { recursive: true, force: true });

  const forgedResultShape = runCliWithEnv({ NODE_ENV: "test", CODEX_STORYBOARD_OPERATOR_BIN: helperPath, CODEX_STORYBOARD_TEST_FORGE_RESULT_SHAPE: "1" }, "complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(forgedResultShape.status, 15, forgedResultShape.stderr);
  assert.match(forgedResultShape.stderr, /codex_storyboard_cli_helper_invalid/);
  await rm(path.join(fixturePackage, "outputs"), { recursive: true, force: true });

  const forgedResultIdentity = runCliWithEnv({ NODE_ENV: "test", CODEX_STORYBOARD_OPERATOR_BIN: helperPath, CODEX_STORYBOARD_TEST_FORGE_RESULT_IDENTITY: "1" }, "complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(forgedResultIdentity.status, 15, forgedResultIdentity.stderr);
  assert.match(forgedResultIdentity.stderr, /codex_storyboard_cli_helper_invalid/);
  await rm(path.join(fixturePackage, "outputs"), { recursive: true, force: true });

  await writeFile(fixtureCandidate, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1]));
  const malformedCandidate = runCli("complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(malformedCandidate.status, 14);
  assert.match(malformedCandidate.stderr, /codex_storyboard_cli_candidate_invalid/);
  await writeFile(fixtureCandidate, tinyPng);

  await mkdir(path.join(fixturePackage, "outputs"), { recursive: true });
  await writeFile(path.join(fixturePackage, "outputs", "result.json"), "preexisting");
  const preexistingResult = runCli("complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(preexistingResult.status, 13, preexistingResult.stderr);
  assert.equal(await exists(path.join(fixturePackage, "outputs", "candidate.png")), false, "a preexisting result must not leave an orphan candidate");
  await rm(path.join(fixturePackage, "outputs"), { recursive: true, force: true });

  const injectedResultFailure = runCliWithEnv({ NODE_ENV: "test", CODEX_STORYBOARD_TEST_FAIL_RESULT_PUBLISH: "1" }, "complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(injectedResultFailure.status, 15);
  assert.equal(await exists(path.join(fixturePackage, "outputs", "candidate.png")), true, "a result publication failure leaves its verified candidate for safe resume");
  assert.equal(await exists(path.join(fixturePackage, "outputs", "result.json")), false);
  const resumedResult = runCli("complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(resumedResult.status, 0, resumedResult.stderr);
  assert.equal(await exists(path.join(fixturePackage, "outputs", "result.json")), true, "the next matching completion safely resumes receipt publication");
  await rm(path.join(fixturePackage, "outputs"), { recursive: true, force: true });

  const concurrent = await Promise.all([
    ...Array.from({ length: 8 }, () => runCliAsync(["complete", "--package", fixturePackage, "--candidate", fixtureCandidate]))
  ]);
  assert.equal(concurrent.filter((entry) => entry.status === 0).length, 1, JSON.stringify(concurrent));
  assert.equal(await exists(path.join(fixturePackage, "outputs", "candidate.png")), true);
  assert.equal(await exists(path.join(fixturePackage, "outputs", "result.json")), true);
  assert.equal(await exists(path.join(fixturePackage, "outputs", ".complete.lock")), false, "completion never creates a persistent lock file");

  await rm(path.join(fixturePackage, "outputs"), { recursive: true, force: true });
  await mkdir(path.join(fixturePackage, "outputs"));
  await writeFile(path.join(fixturePackage, "outputs", ".complete.lock"), "crashed old implementation");
  await writeFile(path.join(fixturePackage, "outputs", ".candidate.png.tmp-crash"), "orphan temp");
  const ignoresCrashArtifacts = runCli("complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(ignoresCrashArtifacts.status, 0, ignoresCrashArtifacts.stderr);

  await rm(path.join(fixturePackage, "outputs"), { recursive: true, force: true });
  const otherCandidate = path.join(fixtureRoot, "other-candidate.png");
  await writeFile(otherCandidate, otherTinyPng);
  const racingDifferentCandidates = await Promise.all([
    runCliAsync(["complete", "--package", fixturePackage, "--candidate", fixtureCandidate]),
    runCliAsync(["complete", "--package", fixturePackage, "--candidate", otherCandidate])
  ]);
  assert.equal(racingDifferentCandidates.filter((entry) => entry.status === 0).length, 1, JSON.stringify(racingDifferentCandidates));
  assert.equal(await exists(path.join(fixturePackage, "outputs", "candidate.png")), true);
  assert.equal(await exists(path.join(fixturePackage, "outputs", "result.json")), true);

  await rm(path.join(fixturePackage, "outputs"), { recursive: true, force: true });
  const completed = runCli("complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(completed.status, 0, completed.stderr);
  const completedResult = JSON.parse(await readFile(path.join(fixturePackage, "outputs", "result.json"), "utf8"));
  const completionRequest = makeFixtureRequest();
  assert.equal(completedResult.requestDigest, hashBytes(Buffer.from(JSON.stringify(canonicalizeForDigest(completionRequest)))));
  assert.deepEqual(completedResult.referenceDigests, completionRequest.references.map(({ id, sha256 }) => ({ id, sha256 })));
  assert.equal(completedResult.output.width, 1);
  assert.equal(completedResult.output.height, 1);
  runtime.validateCodexStoryboardResult(completedResult, completionRequest);
  const existingOutput = runCli("complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(existingOutput.status, 13);
  assert.match(existingOutput.stderr, /codex_storyboard_cli_output_exists/);
  await rm(inspection.inspectionRoot, { recursive: true, force: true });
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

const provider = new CodexTaskPackageProvider({
  exportStoryboardJob: async () => ({ jobId: request.jobId, packagePath: "C:/project/codex-storyboard-jobs/job-1", requestDigest: "a".repeat(64) })
});
assert.deepEqual(await provider.storyboard({ request }), {
  jobId: request.jobId,
  status: "queued",
  outputPath: "C:/project/codex-storyboard-jobs/job-1",
  metadata: { provider: "codex_task_package", requestDigest: "a".repeat(64) }
});
await assert.rejects(() => provider.video({}), /unsupported_job_kind/);

const e01Fixture = JSON.parse(await readFile(new URL("../examples/codex-storyboard/e01-c01.json", import.meta.url), "utf8"));
assert.deepEqual(
  e01Fixture,
  {
    schemaVersion: 1,
    projectId: "yingdi-storyboard",
    episodeId: "E01",
    shotId: "E01-C01",
    characterAssetId: "li-baozhu",
    references: [
      {
        id: "spatial-main",
        path: ".superpowers/sdd/e01-c01-depth-refcontrol-20260827-v1/outputs/run-20260827-125315-241-7e50d4f6/container/color.png",
        usage: "spatial_authority",
        instruction: "锁定机位、棺木几何、人物投影位置、姿态、构图和遮挡关系。"
      },
      {
        id: "style-main",
        path: "影帝他总想对我图谋不轨_漫剧改编/分镜/E01-01/f1.png",
        usage: "style_only",
        instruction: "只参考材质、光影和电影感中式半写实 3D 动画语言，不沿用近景构图。"
      }
    ]
  },
  "the fixed E01-C01 selection leaves identity rows for the persisted identity-pack loader to insert between spatial and style"
);

console.log("PASS Codex storyboard task-package contract, provider, and operator CLI");
