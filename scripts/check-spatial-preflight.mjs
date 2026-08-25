import assert from "node:assert/strict";
import { runSpatialPreflight } from "../src/modules/spatial-stage/spatialPreflightRuntime.mjs";

const input = {
  contract: {
    shotId: "table-scene",
    cameraId: "cam",
    layers: [
      { id: "room", order: 0, role: "environment", entityIds: ["room"] },
      { id: "actor", order: 10, role: "subject", entityIds: ["actor", "hand"] },
      { id: "props", order: 20, role: "interaction", entityIds: ["cup"] },
      { id: "front", order: 30, role: "foreground_occluder", entityIds: ["table"] }
    ],
    relations: [
      { kind: "behind", subjectEntityId: "actor", targetEntityId: "table" },
      { kind: "contact", subjectEntityId: "hand", targetEntityId: "cup" }
    ]
  },
  entities: {
    room: { min: [-4, -1, 1], max: [4, 4, 8] },
    actor: { min: [-1, 0, 3], max: [1, 2, 5] },
    hand: { min: [0, 1, 3.9], max: [0.2, 1.2, 4.1] },
    cup: { min: [0, 0.8, 3.9], max: [0.2, 1.1, 4.1] },
    table: { min: [-2, 0, 2], max: [2, 1, 3] }
  },
  contacts: [{ subjectEntityId: "hand", targetEntityId: "cup", distance: 0.01, maxDistance: 0.03 }],
  joints: [{ entityId: "actor", names: ["head", "neck", "leftShoulder", "leftElbow", "leftWrist", "rightShoulder", "rightElbow", "rightWrist"] }]
};

const report = runSpatialPreflight(input);
assert.equal(report.ok, true);

const invalidDepth = runSpatialPreflight({
  ...input,
  entities: { ...input.entities, table: { min: [-2, 0, 6], max: [2, 1, 7] } }
});
assert.equal(invalidDepth.ok, false);
assert.ok(invalidDepth.errors.some((error) => error.code === "spatial_relation_behind_failed"));

const boundaryInside = runSpatialPreflight({
  ...input,
  contract: {
    ...input.contract,
    relations: [{ kind: "inside", subjectEntityId: "actor", targetEntityId: "room" }]
  },
  entities: {
    ...input.entities,
    actor: { min: [-4, -1, 1], max: [4, 4, 8] }
  }
});
assert.equal(boundaryInside.ok, true);

const outsideInside = runSpatialPreflight({
  ...boundaryInside.input,
  entities: {
    ...boundaryInside.input.entities,
    actor: { min: [-4.01, -1, 1], max: [4, 4, 8] }
  }
});
assert.equal(outsideInside.ok, false);
assert.ok(outsideInside.errors.some((error) => error.code === "spatial_relation_inside_failed"));

const contactOverLimit = runSpatialPreflight({
  ...input,
  contacts: [{ ...input.contacts[0], distance: 0.031 }]
});
assert.equal(contactOverLimit.ok, false);
assert.ok(contactOverLimit.errors.some((error) => error.code === "spatial_contact_failed"));

const skeletonMissingJoint = runSpatialPreflight({
  ...input,
  joints: [{ entityId: "actor", names: ["head", "neck", "leftShoulder", "leftElbow", "leftWrist", "rightShoulder", "rightElbow"] }]
});
assert.equal(skeletonMissingJoint.ok, false);
assert.ok(skeletonMissingJoint.errors.some((error) => error.code === "spatial_skeleton_incomplete"));

console.log("PASS generic spatial preflight");
