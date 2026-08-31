import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  stdin: {
    contents: `
      export * from "./src/modules/spatial-stage/spatialControlExport.ts";
      export * from "./src/modules/spatial-stage/spatialControlPack.ts";
    `,
    loader: "ts",
    resolveDir: process.cwd(),
    sourcefile: "spatial-control-export-check-entry.ts"
  },
  absWorkingDir: process.cwd(),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});

const bundle = result.outputFiles[0]?.text;
assert.ok(bundle, "spatial control export bundle should be available");
const { computeSpatialCameraDigest, exportShotControlPack, validateSpatialControlPack } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`
);

const kinds = ["color", "depth", "normal", "character_id", "prop_id", "environment_id", "pose"];
const hash = (digit) => digit.repeat(64);
const camera = {
  id: "E01-01-C03-camera",
  label: "C03 Strike",
  position: [0, 0.8, 0.5],
  rotation: [0, 0, 0, 1],
  target: [0, 0.8, 0],
  panoramaYaw: 0,
  panoramaPitch: 0,
  fov: 45,
  near: 0.01,
  far: 100
};
const snapshot = {
  id: "E01-01-C03",
  shotId: "E01-01-C03",
  beatId: "C03-Strike",
  cameraId: camera.id,
  entityStates: [],
  constraintIds: [],
  createdAt: "2026-08-25T00:00:00Z"
};
const stage = {
  id: "E01-01-coffin-stage",
  revision: 1,
  sourceDigest: "fnv1a32:12345678"
};

let renderCalls = 0;
let writerCalls = 0;
const renderedRequests = [];
const writtenKinds = [];
const writeArtifact = async (request) => {
  writerCalls += 1;
  writtenKinds.push(request.kind);
  return {
    kind: request.kind,
    filePath: `C:\\trial\\spatial-control\\${stage.id}\\${snapshot.shotId}\\${request.kind}.png`,
    sha256: hash(String(kinds.indexOf(request.kind) + 1)),
    width: request.width,
    height: request.height
  };
};
const renderControlArtifacts = async (request) => {
  renderCalls += 1;
  renderedRequests.push(request);
  const artifacts = [];
  for (const kind of kinds) {
    artifacts.push(await request.writeArtifact({
      stageId: request.stageId,
      shotId: request.shotId,
      kind,
      pngBytes: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      width: request.width,
      height: request.height
    }));
  }
  return artifacts;
};

const pack = await exportShotControlPack({
  stage,
  shotId: snapshot.shotId,
  snapshot,
  camera,
  projectAssetsDir: "C:/trial",
  width: 1280,
  height: 720,
  expectedHands: [
    { side: "left", visible: true, contactTargetId: "coffin-lid" },
    { side: "right", visible: true, contactTargetId: "coffin-lid" }
  ],
  expectedProps: [{ entityId: "bronze-nail", count: 1, state: "fixed until C05 contact" }],
  renderControlArtifacts,
  writeArtifact
});

assert.equal(renderCalls, 1);
assert.equal(writerCalls, 7);
assert.deepEqual(writtenKinds, kinds);
assert.deepEqual(pack.artifacts.map((item) => item.kind), kinds);
assert.equal(pack.shotId, snapshot.shotId);
assert.equal(pack.snapshotId, snapshot.id);
assert.equal(pack.cameraId, camera.id);
assert.equal(pack.cameraDigest, computeSpatialCameraDigest(camera));
assert.equal(renderedRequests[0].width, 1280);
assert.equal(renderedRequests[0].height, 720);
assert.deepEqual(validateSpatialControlPack(pack, pack), { valid: true });

renderCalls = 0;
writerCalls = 0;
await assert.rejects(
  () => exportShotControlPack({
    stage, shotId: snapshot.shotId, snapshot, camera, projectAssetsDir: " ", width: 1280, height: 720,
    expectedHands: [], expectedProps: [], renderControlArtifacts, writeArtifact
  }),
  /spatial_control_project_assets_dir_missing/
);
assert.equal(renderCalls, 0);
assert.equal(writerCalls, 0);

await assert.rejects(
  () => exportShotControlPack({
    stage, shotId: snapshot.shotId, snapshot: undefined, camera, projectAssetsDir: "C:\\trial", width: 1280, height: 720,
    expectedHands: [], expectedProps: [], renderControlArtifacts, writeArtifact
  }),
  /spatial_control_snapshot_missing/
);
assert.equal(renderCalls, 0);
assert.equal(writerCalls, 0);

console.log("spatial control export checks passed");
