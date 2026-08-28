import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
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
  finalPrompt: "A dramatic storyboard frame.",
  output: { relativePath: "outputs/candidate.png", sha256: sha("0"), width: 1920, height: 1080, mimeType: "image/png" },
  completedAt: "2026-08-28T00:01:00.000Z",
  state: "completed"
};

assert.equal(runtime.CODEX_STORYBOARD_PROVIDER_ID, "codex_task_package");
assert.equal(runtime.canonicalCodexStoryboardRequest(request), runtime.canonicalCodexStoryboardRequest(structuredClone(request)));
assert.deepEqual(runtime.compileCodexStoryboardImageSpec(request).referenceUsages, [
  "spatial_authority", "body_costume", "face_identity", "style_only", "style_only"
]);
assert.match(runtime.compileCodexStoryboardImageSpec(request).compiledPrompt, /Picture 5.*style_only/s);
assert.throws(() => runtime.validateCodexStoryboardRequest({ ...request, provider: "comfy" }), /provider_mismatch/);
assert.throws(() => runtime.validateCodexStoryboardRequest({ ...request, references: request.references.map((item, index) => index === 0 ? { ...item, relativePath: "../escape.png" } : item) }), /path_invalid/);
assert.throws(() => runtime.validateCodexStoryboardRequest({ ...request, references: request.references.map((item, index) => index === 0 ? { ...item, instruction: "" } : item) }), /instruction_invalid/);
assert.throws(() => runtime.validateCodexStoryboardResult({ ...result, shotId: "other" }, request), /identity_mismatch/);

const validatedRequest = runtime.validateCodexStoryboardRequest(request);
assert.throws(() => validatedRequest.references.push(request.references[0]), /read only|not extensible/i);
assert.throws(() => validatedRequest.references.reverse(), /read only/i);
assert.throws(() => { validatedRequest.references[0].sha256 = sha("f"); }, /read only/i);
assert.throws(() => { validatedRequest.references[0].usage = "style_only"; }, /read only/i);
assert.throws(() => { validatedRequest.references[0].instruction = "Rewrite blocking."; }, /read only/i);

const validatedResult = runtime.validateCodexStoryboardResult(result, request);
assert.throws(() => { validatedResult.output.sha256 = sha("f"); }, /read only/i);
assert.throws(() => { validatedResult.referenceDigests[0].sha256 = sha("f"); }, /read only/i);

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

console.log("PASS Codex storyboard task-package contract and provider");
