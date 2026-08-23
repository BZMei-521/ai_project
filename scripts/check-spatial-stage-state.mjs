import assert from "node:assert/strict";
import { build } from "esbuild";

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
const { createEmptySceneStage, createStageSnapshot, inheritStageSnapshot, validateStageSnapshot } = await import(
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

console.log("spatial stage state checks passed");
