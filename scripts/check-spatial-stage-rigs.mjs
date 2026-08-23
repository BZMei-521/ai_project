import assert from "node:assert/strict";
import { build } from "esbuild";

const repoRoot = process.cwd();
const result = await build({
  entryPoints: ["src/modules/spatial-stage/rigState.ts"],
  absWorkingDir: repoRoot,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});
const bundle = result.outputFiles[0]?.text;
assert.ok(bundle, "rig state bundle should be available");
const runtime = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const {
  normalizeAttachmentPoints,
  normalizePoseSnapshot,
  normalizeRigBinding,
  toPoseKeyframe,
  toSpatialObject
} = runtime;

const validTransform = { position: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
const validPose = {
  rootTransform: validTransform,
  jointRotations: { hip: [0, 0, 0, 1] },
  contacts: [],
  source: "manual",
  confidence: 0.8
};
const entity = {
  id: "hero",
  label: "Hero",
  tags: ["lead"],
  assetId: "asset-hero",
  transform: validTransform,
  geometry: { kind: "capsule", size: [0.5, 1.8, 0.5] },
  rig: { kind: "humanoid", joints: { hip: "pelvis" } },
  attachments: [{ id: "hand_r", label: "Right hand", localTransform: validTransform }],
  visibility: "visible",
  metadata: {}
};

const humanoid = normalizeRigBinding({ kind: "humanoid", joints: { hip: "pelvis" } });
assert.equal(humanoid.kind, "humanoid");
assert.equal(humanoid.joints.hip, "pelvis");
assert.equal(normalizeRigBinding({ kind: "invalid" }).kind, "custom");
const points = normalizeAttachmentPoints([
  { id: "hand_r", label: "Right hand", localTransform: validTransform },
  { id: "hand_r", label: "Duplicate", localTransform: validTransform }
]);
assert.equal(points.length, 1);
const pose = normalizePoseSnapshot({ ...validPose, confidence: 4 });
assert.ok(pose);
assert.equal(pose.confidence, 1);
const legacy = toSpatialObject(entity, "scene-1");
assert.equal(legacy.objectKind, "character");
assert.equal(legacy.assetId, "asset-hero");
assert.equal(legacy.metadata?.rigKind, "humanoid");
assert.deepEqual(toPoseKeyframe(pose, "hero", 12).position, { x: 0, y: 1, z: 0 });

console.log("spatial stage rig checks passed");
