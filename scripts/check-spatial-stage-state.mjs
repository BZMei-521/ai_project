import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

const repoRoot = process.cwd();
const result = await build({
  stdin: {
    contents: `
      export * from "./src/modules/spatial-stage/normalizeStage.ts";
      export * from "./src/modules/spatial-stage/stageState.ts";
    `,
    loader: "ts",
    resolveDir: repoRoot,
    sourcefile: "spatial-stage-state-check.ts"
  },
  absWorkingDir: repoRoot,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});
const bundle = result.outputFiles[0]?.text;
assert.ok(bundle, "stage state bundle should be available");
const { createEmptySceneStage, createShotSnapshot, createStageSnapshot, inheritShotSnapshot, inheritStageSnapshot, validateStageSnapshot } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`
);

const now = "2026-08-19T00:00:00.000Z";
const validTransform = { position: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
const stage = createEmptySceneStage("scene-1", now);
stage.entities = [
  {
    id: "hero",
    label: "Hero",
    tags: ["lead"],
    transform: validTransform,
    geometry: { kind: "capsule", size: [0.5, 1.8, 0.5] },
    attachments: [{ id: "hand_r", label: "Right hand", localTransform: validTransform }],
    visibility: "visible",
    metadata: {}
  },
  {
    id: "spear",
    label: "Spear",
    tags: ["prop"],
    transform: validTransform,
    geometry: { kind: "box", size: [0.1, 2, 0.1] },
    visibility: "visible",
    metadata: {}
  }
];
stage.constraints = [{
  id: "grip",
  kind: "attachment",
  subjectEntityId: "hero",
  targetEntityId: "spear",
  subjectAttachmentId: "hand_r",
  parameters: {},
  enabled: true
}];
stage.cameras = ["C01", "C02", "C03", "C04", "C05"].map((shotId, index) => ({
  id: `camera-${shotId}`,
  label: shotId,
  position: [index, 1.6, 4],
  rotation: [0, 0, 0, 1],
  target: [0, 1, 0],
  panoramaYaw: 0,
  panoramaPitch: 0,
  fov: 50,
  near: 0.01,
  far: 1000
}));

const first = createStageSnapshot(stage, "beat-1", undefined, now);
assert.equal(first.id, "stage_scene-1_beat-1");
assert.equal(first.entityStates.length, 2);
assert.deepEqual(validateStageSnapshot(stage, first).unresolved, []);
const movedTransform = { position: [1, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
const second = inheritStageSnapshot(stage, first, "beat-2", {
  entityPatches: { hero: { transform: movedTransform } },
  posePatches: { hero: { rootTransform: movedTransform, jointRotations: {}, contacts: [], source: "manual", confidence: 1 } }
}, now);
assert.equal(second.previousSnapshotId, first.id);
assert.deepEqual(second.entityStates.find((item) => item.entityId === "hero")?.transform, movedTransform);
assert.equal(validateStageSnapshot(stage, second).valid, true);
assert.notEqual(second, first);

const invalid = inheritStageSnapshot(stage, first, "beat-3", {
  contacts: [{ attachmentId: "missing", targetEntityId: "hero" }]
}, now);
assert.equal(validateStageSnapshot(stage, invalid).unresolved.length, 1);
assert.equal(validateStageSnapshot(stage, invalid).valid, false);
assert.equal(stage.snapshots.length, 0);

const c01 = createShotSnapshot(stage, "C01", "Awake", "camera-C01", now);
const c02 = inheritShotSnapshot(stage, c01, "C02", "Brace", {}, now);
const c03 = inheritShotSnapshot(stage, c02, "C03", "Push", { cameraId: "camera-C03" }, now);
const c04 = inheritShotSnapshot(stage, c03, "C04", "Listen", { cameraId: "camera-C04" }, now);
const c05 = inheritShotSnapshot(stage, c04, "C05", "Nail-Found", { cameraId: "camera-C05" }, now);
assert.equal(c01.shotId, "C01");
assert.equal(c02.shotId, "C02");
assert.equal(c02.cameraId, "camera-C01", "camera should inherit until explicitly patched");
assert.deepEqual(c02.entityStates, c01.entityStates, "entity state should inherit until explicitly patched");
assert.equal(c03.cameraId, "camera-C03");
assert.equal(c05.beatId, "Nail-Found");
assert.equal(new Set([c01, c02, c03, c04, c05].map((item) => item.shotId)).size, 5);

const missingCamera = createShotSnapshot(stage, "C06", "Exit", "camera-missing", now);
assert.deepEqual(validateStageSnapshot(stage, missingCamera).unresolved, ["camera:camera-missing"]);
stage.snapshots = [c01];
const duplicateShot = createShotSnapshot(stage, "C01", "Duplicate", "camera-C01", now);
assert.ok(validateStageSnapshot(stage, duplicateShot).unresolved.includes("shot:C01:duplicate"));

const workbenchSource = await readFile("src/modules/spatial-stage/SpatialStageWorkbench.tsx", "utf8");
assert.match(workbenchSource, /createShotSnapshot/);
assert.match(workbenchSource, /inheritShotSnapshot/);
assert.match(workbenchSource, /activeSnapshot/);
assert.match(workbenchSource, /selectShot/);
assert.match(workbenchSource, /shot\.id/);

console.log("spatial stage state checks passed");
