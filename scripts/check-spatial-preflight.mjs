import assert from "node:assert/strict";
import { runSpatialPreflight } from "../src/modules/spatial-stage/spatialPreflightRuntime.mjs";

const containerOccupantFixture = {
  contract: {
    shotId: "container-fixture",
    cameraId: "container-camera",
    layers: [
      { id: "container", order: 0, role: "environment", entityIds: ["container"] },
      { id: "occupant", order: 10, role: "subject", entityIds: ["occupant"] }
    ],
    relations: [{ kind: "inside", subjectEntityId: "occupant", targetEntityId: "container" }]
  },
  entities: {
    container: { min: [-5, -2, 1], max: [5, 5, 10] },
    occupant: { min: [-1, 0, 3], max: [1, 3, 7] }
  },
  contacts: [],
  joints: [{ entityId: "occupant", names: ["head", "neck", "leftShoulder", "leftElbow", "leftWrist", "rightShoulder", "rightElbow", "rightWrist"] }]
};
assert.equal(runSpatialPreflight(containerOccupantFixture).ok, true);

const seatedTableCupFixture = {
  contract: {
    shotId: "table-scene",
    cameraId: "cam",
    layers: [
      { id: "room", order: 0, role: "environment", entityIds: ["room"] },
      { id: "actor", order: 10, role: "subject", entityIds: ["actor"] },
      { id: "props", order: 20, role: "interaction", entityIds: ["cup"] },
      { id: "front", order: 30, role: "foreground_occluder", entityIds: ["table"] }
    ],
    relations: [
      { kind: "behind", subjectEntityId: "actor", targetEntityId: "table" },
      { kind: "contact", subjectEntityId: "actor", targetEntityId: "cup", subjectAttachmentId: "rightHand" }
    ]
  },
  entities: {
    room: { min: [-4, -1, 1], max: [4, 4, 8] },
    actor: { min: [-1, 0, 3], max: [1, 2, 5] },
    hand: { min: [0, 1, 3.9], max: [0.2, 1.2, 4.1] },
    cup: { min: [0, 0.8, 3.9], max: [0.2, 1.1, 4.1] },
    table: { min: [-2, 0, 2], max: [2, 1, 3] }
  },
  contacts: [{ subjectEntityId: "actor", targetEntityId: "cup", distance: 0.01, maxDistance: 0.03 }],
  joints: [{ entityId: "actor", names: ["head", "neck", "leftShoulder", "leftElbow", "leftWrist", "rightShoulder", "rightElbow", "rightWrist"] }]
};

const input = seatedTableCupFixture;

const report = runSpatialPreflight(input);
assert.equal(report.ok, true);

const invalidDepth = runSpatialPreflight({
  ...input,
  entities: { ...input.entities, table: { min: [-2, 0, 6], max: [2, 1, 7] } }
});
assert.equal(invalidDepth.ok, false);
assert.ok(invalidDepth.errors.some((error) => error.code === "spatial_relation_behind_failed"));

for (const bounds of [
  { min: [-1, 0, Number.NaN], max: [1, 2, 5] },
  { min: [-1, 0], max: [1, 2, 5] },
  { min: [2, 0, 3], max: [1, 2, 5] }
]) {
  const invalidBounds = runSpatialPreflight({
    ...input,
    entities: { ...input.entities, actor: bounds }
  });
  assert.equal(invalidBounds.ok, false);
  assert.ok(invalidBounds.errors.some((error) => error.code === "spatial_bounds_invalid:actor"));
}

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

for (const contact of [
  null,
  "not-an-object",
  { ...input.contacts[0], distance: -1 },
  { ...input.contacts[0], maxDistance: -1 },
  { ...input.contacts[0], distance: Number.NaN },
  { ...input.contacts[0], maxDistance: Number.POSITIVE_INFINITY },
  { ...input.contacts[0], distance: 0.031 }
]) {
  let invalidContact;
  assert.doesNotThrow(() => {
    invalidContact = runSpatialPreflight({ ...input, contacts: [contact] });
  });
  assert.equal(invalidContact.ok, false);
  assert.ok(invalidContact.errors.some((error) => error.code === "spatial_contact_failed"));
}

const missingSkeletonEvidence = runSpatialPreflight({ ...input, joints: [] });
assert.equal(missingSkeletonEvidence.ok, false);
assert.ok(missingSkeletonEvidence.errors.some((error) => error.code === "spatial_skeleton_evidence_missing"));

const unrelatedSkeleton = runSpatialPreflight({
  ...input,
  joints: [{ entityId: "unrelated", names: input.joints[0].names }]
});
assert.equal(unrelatedSkeleton.ok, false);
assert.ok(unrelatedSkeleton.errors.some((error) => error.code === "spatial_skeleton_evidence_invalid"));

let nullSkeleton;
assert.doesNotThrow(() => {
  nullSkeleton = runSpatialPreflight({ ...input, joints: [null] });
});
assert.equal(nullSkeleton.ok, false);
assert.ok(nullSkeleton.errors.some((error) => error.code === "spatial_skeleton_evidence_invalid"));

const skeletonMissingJoint = runSpatialPreflight({
  ...input,
  joints: [{ entityId: "actor", names: ["head", "neck", "leftShoulder", "leftElbow", "leftWrist", "rightShoulder", "rightElbow"] }]
});
assert.equal(skeletonMissingJoint.ok, false);
assert.ok(skeletonMissingJoint.errors.some((error) => error.code === "spatial_skeleton_incomplete"));

console.log("PASS generic spatial preflight");
