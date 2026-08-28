import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
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

const cliPath = fileURLToPath(new URL("./run-codex-storyboard-job.mjs", import.meta.url));
const fixtureRoot = await mkdtemp(path.join(tmpdir(), "codex-storyboard-contract-fixture-"));
const fixturePackage = path.join(fixtureRoot, "package");
const fixtureCandidate = path.join(fixtureRoot, "candidate.png");
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAsTj2FAAAAABJRU5ErkJggg==", "base64");
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
  prompt: { useCase: "stylized-concept", primaryRequest: "A locked storyboard frame." },
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
const runCli = (...args) => spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
const runCliWithEnv = (env, ...args) => spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
const runCliAsync = (...args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cliPath, ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CODEX_STORYBOARD_OPERATOR_BIN: path.join(process.cwd(), "src-tauri", "target", "debug", "codex-storyboard-operator.exe") } });
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
  assert.ok(inspection.referencedImagePaths.every((filePath) => filePath.startsWith(inspection.inspectionRoot)), "inspect exposes staged immutable snapshots rather than source paths");
  assert.ok((await Promise.all(inspection.referencedImagePaths.map((filePath) => lstat(filePath)))).every((entry) => !entry.isSymbolicLink()), "inspect never emits a symlink path");

  await writeFile(path.join(fixturePackage, cliRequest.references[1].relativePath), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==", "base64"));
  const mutated = runCli("inspect", "--package", fixturePackage);
  assert.equal(mutated.status, 11);
  assert.match(mutated.stderr, /codex_storyboard_cli_reference_digest_mismatch/);
  await writeFile(path.join(fixturePackage, cliRequest.references[1].relativePath), tinyPng);

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
  await writeFile(fixtureCandidate, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1]));
  const malformedCandidate = runCli("complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(malformedCandidate.status, 14);
  assert.match(malformedCandidate.stderr, /codex_storyboard_cli_candidate_invalid/);
  await writeFile(fixtureCandidate, tinyPng);

  await mkdir(path.join(fixturePackage, "outputs"), { recursive: true });
  await writeFile(path.join(fixturePackage, "outputs", "result.json"), "preexisting");
  const preexistingResult = runCli("complete", "--package", fixturePackage, "--candidate", fixtureCandidate);
  assert.equal(preexistingResult.status, 13);
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
    runCliAsync("complete", "--package", fixturePackage, "--candidate", fixtureCandidate),
    runCliAsync("complete", "--package", fixturePackage, "--candidate", fixtureCandidate)
  ]);
  assert.equal(concurrent.filter((entry) => entry.status === 0).length, 1, JSON.stringify(concurrent));
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
