import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import typescript from "typescript";
import * as runtime from "../src/services/generation-providers/codexTaskPackageRuntime.mjs";

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
