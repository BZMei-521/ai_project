import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bridgePath = new URL("../src/modules/platform/desktopBridge.ts", import.meta.url);
const bridgeSource = await readFile(bridgePath, "utf8");
const bundle = await build({
  entryPoints: [fileURLToPath(bridgePath)],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const bridge = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const prompt = { useCase: "stylized-concept", primaryRequest: "Create the frame." };
const reference = (index, usage = "style_only") => ({
  id: `ref-${index}`,
  usage,
  instruction: `instruction-${index}`,
  sourcePath: `C:/assets/ref-${index}.png`,
});
const request = (count) => ({
  schemaVersion: 1,
  jobId: "job-1",
  projectId: "project-1",
  episodeId: "episode-1",
  shotId: "shot-1",
  provider: "codex_task_package",
  createdAt: "2026-08-28T00:00:00Z",
  projectPath: "C:/project.sbproj",
  prompt,
  references: Array.from({ length: count }, (_, index) =>
    reference(index, index === 0 ? "spatial_authority" : index === 1 ? "face_identity" : "style_only")
  ),
  acceptedImagePath: null,
});
const prepare = bridge.createPrepareCodexStoryboardJobRequest;
const expectPrepareError = (value, code) => assert.throws(() => prepare(value), { message: code });

const one = request(1);
expectPrepareError(one, "codex_storyboard_required_reference_usage_missing");
const sixteen = prepare(request(16));
assert.equal(sixteen.references.length, 16);
assert.deepEqual(sixteen.references.map(({ id }) => id), Array.from({ length: 16 }, (_, i) => `ref-${i}`));
expectPrepareError(request(17), "codex_storyboard_references_invalid");
assert.equal(sixteen.references.filter(({ usage }) => usage === "style_only").length, 14);

const duplicateId = request(2);
duplicateId.references[1].id = duplicateId.references[0].id;
expectPrepareError(duplicateId, "codex_storyboard_reference_id_invalid");
const canonicalDuplicate = request(2);
canonicalDuplicate.references[1].sourcePath = "C:/assets/a/../ref-0.png";
expectPrepareError(canonicalDuplicate, "codex_storyboard_reference_path_conflict");
const unknownUsage = request(2);
unknownUsage.references[1].usage = "unknown";
expectPrepareError(unknownUsage, "codex_storyboard_reference_usage_invalid");
const emptyInstruction = request(2);
emptyInstruction.references[1].instruction = " ";
expectPrepareError(emptyInstruction, "codex_storyboard_reference_instruction_invalid");
const relativePath = request(2);
relativePath.references[1].sourcePath = "relative.png";
expectPrepareError(relativePath, "codex_storyboard_path_must_be_absolute");

const imported = bridge.createImportCodexStoryboardResultRequest({
  schemaVersion: 1,
  jobId: "job-1",
  projectId: "project-1",
  episodeId: "episode-1",
  shotId: "shot-1",
  provider: "codex_task_package",
  projectPath: "C:/project.sbproj",
  taskStatus: "queued",
  requestDigest: "attacker-controlled",
});
assert.equal(Object.hasOwn(imported, "requestDigest"), false);
assert.equal(Object.hasOwn(imported, "taskStatus"), false, "renderer taskStatus must not cross the IPC boundary");
await assert.rejects(
  bridge.prepareCodexStoryboardJob(request(2)),
  { message: "codex_storyboard_requires_tauri_runtime" }
);
await assert.rejects(
  bridge.importCodexStoryboardResult(imported),
  { message: "codex_storyboard_requires_tauri_runtime" }
);
assert.match(bridgeSource, /CoreCodexStoryboardExportReceipt\s*&\s*\{/);
assert.match(bridgeSource, /CoreCodexStoryboardImportReceipt\s*&\s*\{/);
const exportReceipt = { jobId: "job-1", packagePath: "C:/package", requestDigest: "a".repeat(64), schemaVersion: 1, status: "exported", requestPath: "C:/package/request.json" };
const importReceipt = { jobId: "job-1", resultPath: "C:/package/outputs/result.json", result: {}, schemaVersion: 1, status: "needs_review", candidatePath: "C:/package/outputs/candidate.png" };
assert.deepEqual(Object.keys(exportReceipt).sort(), ["jobId", "packagePath", "requestDigest", "requestPath", "schemaVersion", "status"].sort());
assert.deepEqual(Object.keys(importReceipt).sort(), ["candidatePath", "jobId", "result", "resultPath", "schemaVersion", "status"].sort());

console.log("PASS Codex desktop bridge persistent boundary contract");
