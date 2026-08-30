import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { auditYingdiTombStage, buildYingdiTombStage } from "./build-yingdi-e01-c19-c22-spatial-stage.mjs";

const seedPath = "影帝他总想对我图谋不轨_漫剧改编/分镜/work/E01-C19-C22.spatial-stage.seed.json";
const shots = ["E01-S01-C19", "E01-S01-C20", "E01-S01-C21", "E01-S01-C22"];
const roomSurfaceIds = ["tomb-room", "tomb-room-ceiling", "tomb-room-wall-west", "tomb-room-wall-east", "tomb-room-wall-north", "tomb-room-wall-south"];
const coffinSurfaceIds = ["coffin-shell", "coffin-side-north", "coffin-side-south", "coffin-end-head", "coffin-end-foot"];
const requiredIds = [...roomSurfaceIds, ...coffinSurfaceIds, "coffin-lid", "phoenix-panel", "li-baozhu-full-body", "wei-xun-full-body", "jade-dagger", "grave-shovel"];
const identity = [0, 0, 0, 1];

function multiply(left, right) { return [left[3] * right[0] + left[0] * right[3] + left[1] * right[2] - left[2] * right[1], left[3] * right[1] - left[0] * right[2] + left[1] * right[3] + left[2] * right[0], left[3] * right[2] + left[0] * right[1] - left[1] * right[0] + left[2] * right[3], left[3] * right[3] - left[0] * right[0] - left[1] * right[1] - left[2] * right[2]]; }
function conjugate(quaternion) { return [-quaternion[0], -quaternion[1], -quaternion[2], quaternion[3]]; }
function rotate(vector, quaternion) { return multiply(multiply(quaternion, [...vector, 0]), conjugate(quaternion)).slice(0, 3); }
function worldPoint(transform, local) { return rotate(local.map((value, axis) => value * transform.scale[axis]), transform.rotation).map((value, axis) => value + transform.position[axis]); }
function attachmentPoint(entity, transform, attachmentId) {
  const attachment = entity.attachments?.find((item) => item.id === attachmentId);
  assert.ok(attachment, `${entity.id} must expose ${attachmentId}`);
  return worldPoint(transform, attachment.localTransform.position);
}
function capsuleHalfExtents(size) { return [size[0], size[0] + size[1] / 2, size[0]]; }
function geometryAabb(entity, transform = entity.transform) {
  const half = entity.geometry.kind === "capsule" ? capsuleHalfExtents(entity.geometry.size) : entity.geometry.size.map((value) => value / 2);
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((axis) => rotate(axis, transform.rotation));
  const extent = axes[0].map((_, worldAxis) => axes.reduce((sum, axis, localAxis) => sum + Math.abs(axis[worldAxis]) * half[localAxis] * transform.scale[localAxis], 0));
  return { min: transform.position.map((value, axis) => value - extent[axis]), max: transform.position.map((value, axis) => value + extent[axis]) };
}
function pointInAabb(point, bounds) { return point.every((value, axis) => value >= bounds.min[axis] && value <= bounds.max[axis]); }
function pointInGeometry(point, entity, transform = entity.transform) {
  const local = rotate(point.map((value, axis) => value - transform.position[axis]), conjugate(transform.rotation)).map((value, axis) => value / transform.scale[axis]);
  if (entity.geometry.kind === "capsule") {
    const radius = entity.geometry.size[0];
    const halfCylinder = entity.geometry.size[1] / 2;
    const y = Math.max(-halfCylinder, Math.min(halfCylinder, local[1]));
    return Math.hypot(local[0], local[1] - y, local[2]) <= radius;
  }
  return entity.geometry.size.every((size, axis) => Math.abs(local[axis]) <= size / 2);
}
function gap(left, right) { return Math.hypot(...left.min.map((minimum, axis) => Math.max(0, minimum - right.max[axis], right.min[axis] - left.max[axis]))); }
function assembledBounds(entities, ids) {
  const bounds = ids.map((id) => geometryAabb(entities.get(id)));
  return {
    min: bounds[0].min.map((_, axis) => Math.min(...bounds.map((value) => value.min[axis]))),
    max: bounds[0].max.map((_, axis) => Math.max(...bounds.map((value) => value.max[axis])))
  };
}
function roundedBounds(bounds) { return { min: bounds.min.map((value) => Number(value.toFixed(6))), max: bounds.max.map((value) => Number(value.toFixed(6))) }; }
function cavityBounds(entities) {
  const floor = geometryAabb(entities.get("coffin-shell"));
  const north = geometryAabb(entities.get("coffin-side-north"));
  const south = geometryAabb(entities.get("coffin-side-south"));
  const head = geometryAabb(entities.get("coffin-end-head"));
  const foot = geometryAabb(entities.get("coffin-end-foot"));
  return { min: [head.max[0], floor.max[1], north.max[2]], max: [foot.min[0], Math.min(north.max[1], south.max[1]), south.min[2]] };
}
function state(snapshot, entityId) {
  const value = snapshot.entityStates.find((item) => item.entityId === entityId);
  assert.ok(value, `${snapshot.shotId} must include ${entityId}`);
  return value;
}

const stage = buildYingdiTombStage();
const rawSeed = await readFile(seedPath, "utf8");
assert.ok(rawSeed.endsWith("\n"), "fixture serialization must end with a newline");
assert.deepEqual(JSON.parse(rawSeed), stage, "fixture must exactly equal the deterministic builder output");
assert.equal(stage.id, "stage_yingdi_e01_tomb_v2");
assert.deepEqual(stage.coordinateFrame, { handedness: "right", upAxis: "y", unit: "metre", origin: [0, 0, 0], forward: [0, 0, -1], groundY: 0, scaleMode: "metric" });
assert.deepEqual(stage.snapshots.map((item) => item.shotId), shots);
assert.equal(stage.cameras.length, 4);
const entities = new Map(stage.entities.map((item) => [item.id, item]));
for (const id of requiredIds) assert.ok(entities.has(id), `missing physical stage entity ${id}`);
assert.equal(stage.entities.some((item) => item.geometry.kind === "box" && item.geometry.size.join(",") === "6.4,4.8,3.8"), false, "room must not be a solid volume box");
assert.equal(entities.get("tomb-room").geometry.size.join(","), "6.4,0.1,3.8", "tomb-room is its physical floor surface");
assert.equal(entities.get("coffin-shell").geometry.size.join(","), "2.15,0.08,0.78", "coffin-shell is its physical bottom surface");
assert.equal(entities.get("coffin-shell").metadata.hollow, undefined, "coffin hollow volume must come from wall geometry, not metadata");
assert.deepEqual(roundedBounds(assembledBounds(entities, roomSurfaceIds)), { min: [-3.2, 0, -1.9], max: [3.2, 4.8, 1.9] }, "assembled room exterior must be exactly 6.4m x 4.8m x 3.8m");
assert.deepEqual(roundedBounds(assembledBounds(entities, coffinSurfaceIds)), { min: [-1.075, 0.4, -0.39], max: [1.075, 0.84, 0.39] }, "assembled coffin exterior must be exactly 2.15m x 0.44m x 0.78m");

const panel = entities.get("phoenix-panel");
const shovel = entities.get("grave-shovel");
assert.deepEqual(panel.transform.rotation, identity, "panel normal must point upward");
assert.ok(gap(geometryAabb(shovel), geometryAabb(panel)) >= 0.08, "rotation-aware shovel-panel gap must be at least 0.08 m");

const interior = cavityBounds(entities);
for (const snapshot of stage.snapshots) {
  assert.equal(snapshot.cameraId, `${snapshot.shotId}-camera`);
  assert.deepEqual(snapshot.entityStates.map((item) => item.entityId), stage.entities.map((item) => item.id), `${snapshot.shotId} must capture every entity transform`);
  for (const id of ["coffin-containment", "lid-hinge-contact", "shovel-panel-clearance", "panel-horizontal"]) assert.ok(snapshot.constraintIds.includes(id), `${snapshot.shotId} must include ${id}`);
  const li = state(snapshot, "li-baozhu-full-body");
  const wei = state(snapshot, "wei-xun-full-body");
  const liBounds = geometryAabb(entities.get(li.entityId), li.transform);
  assert.equal(pointInAabb(liBounds.min, interior) && pointInAabb(liBounds.max, interior), true, `${snapshot.shotId} must fully contain Li's rendered capsule, not just its root`);
  assert.equal(pointInAabb(wei.transform.position, interior), false, `${snapshot.shotId} Wei must remain outside the coffin`);
  const lidPin = attachmentPoint(entities.get("coffin-lid"), state(snapshot, "coffin-lid").transform, "hinge_pin");
  const shellPin = attachmentPoint(entities.get("coffin-shell"), state(snapshot, "coffin-shell").transform, "lid_hinge");
  assert.ok(Math.hypot(...lidPin.map((value, axis) => value - shellPin[axis])) <= 0.02, `${snapshot.shotId} lid hinge world-space distance must be <= 0.02m`);
}

const colliderEntities = stage.entities.filter((entity) => entity.metadata.collider === true);
for (const camera of stage.cameras) for (const collider of colliderEntities) assert.equal(pointInGeometry(camera.position, collider), false, `${camera.id} must remain outside rotated ${collider.id} collider geometry`);
const roomBounds = assembledBounds(entities, roomSurfaceIds);
const roomInterior = { min: [-3.1, roomBounds.min[1] + 0.1, -1.8], max: [3.1, roomBounds.max[1] - 0.1, 1.8] };
for (const camera of stage.cameras.filter((item) => /C19|C20/.test(item.id))) assert.equal(pointInAabb(camera.target, roomInterior), true, `${camera.id} target must remain inside the physical tomb room`);

assert.deepEqual(auditYingdiTombStage(stage), { ok: true, errors: [] });
const solidRoom = structuredClone(stage);
solidRoom.entities = solidRoom.entities.filter((entity) => !roomSurfaceIds.slice(1).includes(entity.id));
assert.ok(auditYingdiTombStage(solidRoom).errors.includes("room_enclosure_invalid"), "old solid-room form must fail audit");
const solidCoffin = structuredClone(stage);
solidCoffin.entities = solidCoffin.entities.filter((entity) => !coffinSurfaceIds.slice(1).includes(entity.id));
assert.ok(auditYingdiTombStage(solidCoffin).errors.includes("coffin_enclosure_invalid"), "old solid-coffin form must fail audit");
const misplacedRoomSurface = structuredClone(stage);
misplacedRoomSurface.entities.find((entity) => entity.id === "tomb-room-wall-west").transform.position[0] += 0.1;
assert.ok(auditYingdiTombStage(misplacedRoomSurface).errors.includes("room_assembly_invalid"), "misplaced room wall must fail assembled-room audit");
const wrongSizeCoffinSurface = structuredClone(stage);
wrongSizeCoffinSurface.entities.find((entity) => entity.id === "coffin-side-north").geometry.size[1] = 0.35;
assert.ok(auditYingdiTombStage(wrongSizeCoffinSurface).errors.includes("coffin_assembly_invalid"), "wrong-size coffin wall must fail assembled-coffin audit");
const brokenHinge = structuredClone(stage);
brokenHinge.entities.find((entity) => entity.id === "coffin-lid").attachments[0].localTransform.position = [0, 0, 0];
assert.ok(auditYingdiTombStage(brokenHinge).errors.includes("lid_hinge_distance_invalid:E01-S01-C19"), "invalid hinge attachment must fail audit");
const bodyOutside = structuredClone(stage);
bodyOutside.snapshots[0].entityStates.find((item) => item.entityId === "li-baozhu-full-body").transform.position = [0, 0.8, 0];
assert.equal(pointInAabb([0, 0.8, 0], interior), true, "negative full-body fixture must keep Li root inside the actual cavity");
assert.ok(auditYingdiTombStage(bodyOutside).errors.includes("li_geometry_outside_coffin:E01-S01-C19"), "root-contained but full-body-invalid capsule must fail audit");
console.log("PASS E01 C19-C22 tomb stage physical constraints");
