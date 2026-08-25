import assert from "node:assert/strict";
import { build } from "esbuild";
import {
  createLayeredSpatialControlPack,
  validateLayeredSpatialControlPack,
  classifySpatialControlPackVersion
} from "../src/modules/spatial-stage/layeredSpatialControlPackRuntime.mjs";

const sha = "a".repeat(64);
const current = {
  stageId: "stage", stageRevision: 3, stageDigest: sha, shotId: "shot", snapshotId: "snapshot",
  cameraId: "camera", cameraDigest: sha
};
const input = {
  ...current,
  contractDigest: sha, preflightDigest: sha,
  layers: [
    { layerId: "front", order: 20, role: "foreground_occluder", entityIds: ["table"], artifacts: [{ kind: "mask", filePath: "front.png", sha256: sha, width: 1280, height: 720 }] },
    { layerId: "actor", order: 10, role: "subject", entityIds: ["actor"], artifacts: [{ kind: "normal", filePath: "normal.png", sha256: sha, width: 1280, height: 720 }, { kind: "mask", filePath: "actor.png", sha256: sha, width: 1280, height: 720 }] },
    { layerId: "back", order: 0, role: "environment", entityIds: ["room"], artifacts: [{ kind: "color", filePath: "back.png", sha256: sha, width: 1280, height: 720 }] }
  ],
  skeletonArtifacts: [{ entityId: "actor", kind: "openpose", filePath: "pose.png", sha256: sha, width: 1280, height: 720 }]
};
const pack = createLayeredSpatialControlPack(input);
assert.equal(pack.schemaVersion, 2);
assert.deepEqual(pack.layers.map(({ layerId }) => layerId), ["back", "actor", "front"]);
assert.deepEqual(pack.layers[1].artifacts.map(({ kind }) => kind), ["normal", "mask"]);
assert.equal(validateLayeredSpatialControlPack(pack, current).valid, true);
assert.equal(validateLayeredSpatialControlPack({ ...pack, layers: pack.layers.slice(1) }, current).reason, "layered_control_environment_missing");
assert.equal(validateLayeredSpatialControlPack({ ...pack, packDigest: sha }, current).reason, "layered_control_digest_invalid");
assert.equal(validateLayeredSpatialControlPack({ ...pack, layers: [...pack.layers, pack.layers[0]] }, current).reason, "layered_control_layer_duplicate:back");
assert.equal(validateLayeredSpatialControlPack({ ...pack, skeletonArtifacts: [] }, current).reason, "layered_control_subject_skeleton_missing:actor");
assert.equal(validateLayeredSpatialControlPack({ ...pack, layers: pack.layers.map((layer) => layer.layerId === "back" ? { ...layer, artifacts: [{ ...layer.artifacts[0], width: 0 }] } : layer) }, current).reason, "layered_control_artifact_invalid:back:color");
assert.equal(validateLayeredSpatialControlPack({ ...pack, skeletonArtifacts: [{ ...pack.skeletonArtifacts[0], sha256: "missing" }] }, current).reason, "layered_control_skeleton_invalid:actor:openpose");
assert.equal(validateLayeredSpatialControlPack(pack, { ...current, cameraId: "other" }).reason, "layered_control_camera_stale");
assert.equal(classifySpatialControlPackVersion(pack), "layered_v2");
assert.equal(classifySpatialControlPackVersion({ schemaVersion: 1 }), "legacy_v1");
assert.equal(classifySpatialControlPackVersion({ schemaVersion: 3 }), "unsupported");

const result = await build({
  stdin: { contents: 'export * from "./src/modules/spatial-stage/layeredStageRenderPasses.ts";', loader: "ts", resolveDir: process.cwd(), sourcefile: "layered-render-check.ts" },
  absWorkingDir: process.cwd(), bundle: true, format: "esm", platform: "node", target: "node20", write: false
});
const bundle = result.outputFiles[0]?.text;
assert.ok(bundle, "layered renderer bundle should be available");
const { renderLayeredStagePasses } = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const specs = [{ layerId: "back", kind: "color", entityIds: ["room"] }, { layerId: "actor", kind: "mask", entityIds: ["actor"] }];
const artifacts = await renderLayeredStagePasses({
  stageId: "stage", shotId: "shot", width: 4, height: 4, passes: specs,
  render: async () => png,
  writeArtifact: async ({ layerId, kind, width, height }) => ({ layerId, kind, filePath: `${layerId}-${kind}.png`, sha256: sha, width, height })
});
assert.deepEqual(artifacts.map(({ layerId, kind }) => `${layerId}:${kind}`), ["back:color", "actor:mask"]);
await assert.rejects(() => renderLayeredStagePasses({ ...{ stageId: "stage", shotId: "shot", width: 4, height: 4, render: async () => png, writeArtifact: async ({ layerId, kind, width, height }) => ({ layerId, kind, filePath: "x.png", sha256: sha, width, height }) }, passes: [specs[0], specs[0]] }), /layered_render_pass_duplicate:back:color/);
await assert.rejects(() => renderLayeredStagePasses({ ...{ stageId: "stage", shotId: "shot", width: 4, height: 4, render: async () => Uint8Array.from([0]), writeArtifact: async ({ layerId, kind, width, height }) => ({ layerId, kind, filePath: "x.png", sha256: sha, width, height }) }, passes: [specs[0]] }), /layered_render_png_invalid/);
await assert.rejects(() => renderLayeredStagePasses({ ...{ stageId: "stage", shotId: "shot", width: 4, height: 4, render: async () => png, writeArtifact: async ({ layerId, kind, width, height }) => ({ layerId: "wrong", kind, filePath: "x.png", sha256: sha, width, height }) }, passes: [specs[0]] }), /layered_render_receipt_layer_mismatch/);
await assert.rejects(() => renderLayeredStagePasses({ ...{ stageId: "stage", shotId: "shot", width: 4, height: 4, render: async () => png, writeArtifact: async ({ layerId, kind, width, height }) => ({ layerId, kind, filePath: "x.png", sha256: sha, width, height }) }, passes: Array.from({ length: 129 }, (_, index) => ({ layerId: `layer${index}`, kind: "mask", entityIds: ["entity"] })) }), /layered_render_pass_count_invalid/);

console.log("PASS layered spatial control pack v2");
