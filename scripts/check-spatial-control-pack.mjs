import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

const result = await build({
  stdin: {
    contents: `
      export * from "./src/modules/spatial-stage/spatialControlPack.ts";
      export * from "./src/modules/spatial-stage/stageRenderPasses.ts";
    `,
    loader: "ts",
    resolveDir: process.cwd(),
    sourcefile: "spatial-control-pack-check-entry.ts"
  },
  absWorkingDir: process.cwd(),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});
const bundle = result.outputFiles[0]?.text;
assert.ok(bundle, "spatial control pack bundle should be available");
const { createSpatialControlPack, renderStagePasses, validateSpatialControlPack } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`
);

const hash = (digit) => digit.repeat(64);
const kinds = ["color", "depth", "normal", "character_id", "prop_id", "pose"];
const artifacts = kinds.map((kind, index) => ({
  kind,
  filePath: `C:\\project\\assets\\spatial-control\\stage-1\\C01\\${kind}.png`,
  sha256: hash(String(index + 1)),
  width: 1280,
  height: 720
}));
const input = {
  stageId: "stage-1",
  stageRevision: 4,
  stageDigest: "fnv1a32:12345678",
  shotId: "C01",
  snapshotId: "stage-1_C01",
  cameraId: "camera-C01",
  cameraDigest: hash("a"),
  artifacts,
  expectedHands: [
    { side: "left", visible: true, contactTargetId: "coffin-lid" },
    { side: "right", visible: true, contactTargetId: "coffin-lid" }
  ],
  expectedProps: [{ entityId: "nail", count: 1, state: "hidden" }]
};

const pack = createSpatialControlPack(input);
assert.deepEqual(pack.artifacts.map((item) => item.kind), kinds);
assert.match(pack.packDigest, /^[a-f0-9]{64}$/);
assert.deepEqual(validateSpatialControlPack(pack, input), { valid: true });

const missingNormal = { ...pack, artifacts: pack.artifacts.filter((item) => item.kind !== "normal") };
assert.equal(validateSpatialControlPack(missingNormal, input).reason, "control_pack_artifact_missing:normal");
const missingPose = { ...pack, artifacts: pack.artifacts.filter((item) => item.kind !== "pose") };
assert.equal(validateSpatialControlPack(missingPose, input).reason, "control_pack_artifact_missing:pose");
assert.equal(
  validateSpatialControlPack(pack, { ...input, cameraDigest: hash("b") }).reason,
  "control_pack_camera_stale"
);
assert.equal(
  validateSpatialControlPack(pack, { ...input, stageDigest: "fnv1a32:87654321" }).reason,
  "control_pack_stage_stale"
);
assert.equal(
  validateSpatialControlPack({ ...pack, packDigest: hash("f") }, input).reason,
  "control_pack_digest_invalid"
);

const renderedKinds = [];
const writtenKinds = [];
const renderArtifacts = await renderStagePasses({
  stageId: "stage-1",
  shotId: "C01",
  width: 1280,
  height: 720,
  render: async (kind) => {
    renderedKinds.push(kind);
    return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, kinds.indexOf(kind)]);
  },
  writeArtifact: async ({ kind, pngBytes, width, height }) => {
    writtenKinds.push(kind);
    assert.deepEqual(Array.from(pngBytes.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
    return { kind, filePath: `C:\\project\\${kind}.png`, sha256: hash("c"), width, height };
  }
});
assert.deepEqual(renderedKinds, kinds);
assert.deepEqual(writtenKinds, kinds);
assert.deepEqual(renderArtifacts.map((item) => item.kind), kinds);
await assert.rejects(() => renderStagePasses({
  stageId: "stage-1", shotId: "C01", width: 1280, height: 720,
  render: async () => Uint8Array.from([1, 2, 3]),
  writeArtifact: async ({ kind, width, height }) => ({ kind, filePath: "x.png", sha256: hash("d"), width, height })
}), /spatial_render_png_invalid/);

const rustSource = await readFile("src-tauri/src/spatial_stage.rs", "utf8");
assert.match(rustSource, /write_spatial_control_artifact/);
assert.match(rustSource, /spatial-control/);
assert.match(rustSource, /canonicalize/);
assert.match(rustSource, /Sha256/);
assert.doesNotMatch(rustSource, /destination_path/i);
const mainSource = await readFile("src-tauri/src/main.rs", "utf8");
assert.match(mainSource, /mod spatial_stage/);
assert.match(mainSource, /write_spatial_control_artifact/);
const bridgeSource = await readFile("src/modules/platform/desktopBridge.ts", "utf8");
assert.match(bridgeSource, /writeSpatialControlArtifact/);
assert.match(bridgeSource, /write_spatial_control_artifact/);
const viewportSource = await readFile("src/modules/spatial-stage/SpatialStageViewport.tsx", "utf8");
assert.match(viewportSource, /renderStagePasses/);
assert.match(viewportSource, /createStageOverrideMaterial/);

console.log("spatial control pack checks passed");
