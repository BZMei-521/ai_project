import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const seedPath = "影帝他总想对我图谋不轨_漫剧改编/分镜/work/E01-01.spatial-stage.seed.json";
const seed = JSON.parse(await readFile(seedPath, "utf8"));
const result = await build({
  stdin: {
    contents: `
      export * from "./src/modules/spatial-stage/normalizeStage.ts";
      export * from "./src/modules/spatial-stage/stageState.ts";
      export * from "./src/modules/spatial-stage/stageDigest.ts";
      export * from "./src/modules/spatial-stage/spatialControlPack.ts";
    `,
    loader: "ts",
    resolveDir: process.cwd(),
    sourcefile: "e01-01-spatial-stage-check-entry.ts"
  },
  absWorkingDir: process.cwd(),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});
const runtime = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const stage = runtime.normalizeSceneStage(seed);
assert.ok(stage, "seed must normalize as a v2 stage");
assert.equal(stage.schemaVersion, 2);

const entityIds = [
  "E01-01-coffin-shell", "E01-01-lid", "E01-01-silk", "E01-01-nail", "E01-01-li-baozhu"
];
assert.deepEqual(stage.entities.map((item) => item.id), entityIds);
assert.equal(stage.entities.filter((item) => item.id === "E01-01-nail").length, 1);
assert.equal(stage.entities.find((item) => item.id === "E01-01-nail").metadata.state, "Nail-Found");

const shortIds = ["C01", "C02", "C03", "C04", "C05"];
const shotIds = shortIds.map((id) => `E01-01-${id}`);
assert.deepEqual(stage.cameras.map((item) => item.id), shortIds.map((id) => `E01-01-${id}-camera`));
assert.deepEqual(stage.snapshots.map((item) => item.shotId), shotIds);
assert.equal(new Set(stage.snapshots.map((item) => item.shotId)).size, 5);
for (const snapshot of stage.snapshots) {
  assert.equal(runtime.validateStageSnapshot(stage, snapshot).valid, true, `${snapshot.shotId} must validate`);
}
const c05 = stage.snapshots.find((item) => item.shotId === "E01-01-C05");
assert.equal(c05.beatId, "Nail-Found");
assert.ok(c05.entityStates.some((state) => state.pose?.contacts?.some((contact) => contact.targetEntityId === "E01-01-nail")));
for (const snapshot of stage.snapshots.filter((item) => item.shotId !== "E01-01-C05")) {
  assert.equal(snapshot.entityStates.some((state) => state.pose?.contacts?.some((contact) => contact.targetEntityId === "E01-01-nail")), false);
}

const kinds = ["color", "depth", "normal", "character_id", "prop_id", "pose"];
const stageDigest = runtime.computeStageSourceDigest(stage);
for (const [index, snapshot] of stage.snapshots.entries()) {
  const cameraDigest = String(index + 1).repeat(64);
  const input = {
    stageId: stage.id,
    stageRevision: stage.revision,
    stageDigest,
    shotId: snapshot.shotId,
    snapshotId: snapshot.id,
    cameraId: snapshot.cameraId,
    cameraDigest,
    artifacts: kinds.map((kind, artifactIndex) => ({ kind, filePath: `C:\\assets\\${snapshot.shotId}\\${kind}.png`, sha256: String(artifactIndex + 1).repeat(64), width: 1280, height: 720 })),
    expectedHands: [{ side: "left", visible: true }, { side: "right", visible: true }],
    expectedProps: [{ entityId: "E01-01-nail", count: 1, state: snapshot.shotId === "E01-01-C05" ? "Nail-Found" : "Nail-Sealed" }]
  };
  const pack = runtime.createSpatialControlPack(input);
  assert.deepEqual(runtime.validateSpatialControlPack(pack, input), { valid: true });
}

const workbenchSource = await readFile("src/modules/spatial-stage/SpatialStageWorkbench.tsx", "utf8");
assert.match(workbenchSource, /E01-01\.spatial-stage\.seed\.json/);
assert.match(workbenchSource, /导入 E01-01 空间舞台/);

console.log("E01-01 spatial stage checks passed");
