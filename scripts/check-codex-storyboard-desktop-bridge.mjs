import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bridgePath = new URL("../src/modules/platform/desktopBridge.ts", import.meta.url);
const bridgeSource = await readFile(bridgePath, "utf8");
const cargoSource = await readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
assert.match(cargoSource, /^\s*default-run\s*=\s*["']storyboard-pro["']\s*$/m, "tauri dev must select the desktop binary when the operator helper is also present");
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

const spatialControl = {
  stageId: "stage-1", stageRevision: 2, stageDigest: "a".repeat(64), shotId: "shot-1", snapshotId: "snapshot-1", cameraId: "camera-1", cameraDigest: "b".repeat(64),
  panoramaAssetId: "panorama-1", panoramaSha256: "c".repeat(64),
  artifacts: [
    ["color", "color"], ["depth", "depth"], ["normal", "normal"], ["character_id", "character-id"], ["prop_id", "prop-id"], ["pose", "pose"]
  ].map(([kind, referenceId], index) => ({ kind, referenceId, sha256: String(index + 1).repeat(64) }))
};
const v2 = {
  ...request(9),
  schemaVersion: 2,
  references: [
    reference(0, "spatial_authority"), reference(1, "spatial_depth"), reference(2, "spatial_normal"), reference(3, "character_id"), reference(4, "prop_id"), reference(5, "pose_reference"), reference(6, "environment_reference"), reference(7, "face_identity"), reference(8, "face_identity")
  ].map((item, index) => ({ ...item, id: ["color", "depth", "normal", "character-id", "prop-id", "pose", "environment", "li", "wei"][index], sourcePath: `C:/assets/${["color", "depth", "normal", "character-id", "prop-id", "pose", "environment", "li", "wei"][index]}.png` })),
  spatialControl
};
const preparedV2 = prepare(v2);
assert.equal(preparedV2.schemaVersion, 2);
assert.deepEqual(preparedV2.spatialControl, spatialControl, "schema-v2 preserves the explicit spatial binding verbatim");
expectPrepareError({ ...v2, spatialControl: { ...spatialControl, shotId: "other-shot" } }, "codex_storyboard_spatial_shot_id_invalid");
expectPrepareError({ ...v2, spatialControl: { ...spatialControl, artifacts: spatialControl.artifacts.slice(1) } }, "codex_storyboard_spatial_artifacts_invalid");

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
const coreTypes = await readFile(new URL("../src/services/generation-providers/codexTaskPackage.ts", import.meta.url), "utf8");
assert.match(coreTypes, /user_authorized_local_deterministic_crop/);
assert.match(coreTypes, /derivedTransform\?:/);
const exportReceipt = { jobId: "job-1", packagePath: "C:/package", requestDigest: "a".repeat(64), schemaVersion: 1, status: "exported", requestPath: "C:/package/request.json" };
const importReceipt = { jobId: "job-1", resultPath: "C:/package/outputs/result.json", result: {}, schemaVersion: 1, status: "needs_review", candidatePath: "C:/package/outputs/candidate.png" };
assert.deepEqual(Object.keys(exportReceipt).sort(), ["jobId", "packagePath", "requestDigest", "requestPath", "schemaVersion", "status"].sort());
assert.deepEqual(Object.keys(importReceipt).sort(), ["candidatePath", "jobId", "result", "resultPath", "schemaVersion", "status"].sort());

console.log("PASS Codex desktop bridge persistent boundary contract");
