import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { auditYingdiTombStage, buildYingdiTombStage } from "./build-yingdi-e01-c19-c22-spatial-stage.mjs";

const seedPath = "影帝他总想对我图谋不轨_漫剧改编/分镜/work/E01-C19-C22.spatial-stage.seed.json";
const expectedShots = ["E01-S01-C19", "E01-S01-C20", "E01-S01-C21", "E01-S01-C22"];
const requiredEntityIds = [
  "tomb-room",
  "coffin-shell",
  "coffin-lid",
  "phoenix-panel",
  "li-baozhu-full-body",
  "wei-xun-full-body",
  "grave-shovel"
];
const colliderIds = new Set(["stone-plinth", "coffin-shell", "coffin-lid", "phoenix-panel", "li-baozhu-full-body", "wei-xun-full-body", "grave-shovel", "jade-dagger"]);

function state(snapshot, entityId) {
  const found = snapshot.entityStates.find((item) => item.entityId === entityId);
  assert.ok(found, `${snapshot.shotId} must include ${entityId}`);
  return found;
}

function aabb(entity, transform = entity.transform) {
  const [width, height, depth] = entity.geometry.size;
  const [scaleX, scaleY, scaleZ] = transform.scale;
  return {
    min: [transform.position[0] - width * scaleX / 2, transform.position[1] - height * scaleY / 2, transform.position[2] - depth * scaleZ / 2],
    max: [transform.position[0] + width * scaleX / 2, transform.position[1] + height * scaleY / 2, transform.position[2] + depth * scaleZ / 2]
  };
}

function pointInAabb(point, bounds) {
  return point.every((coordinate, axis) => coordinate >= bounds.min[axis] && coordinate <= bounds.max[axis]);
}

function gapBetween(left, right) {
  return Math.hypot(...left.min.map((minimum, axis) => Math.max(0, minimum - right.max[axis], right.min[axis] - left.max[axis])));
}

const stage = buildYingdiTombStage();
const seed = JSON.parse(await readFile(seedPath, "utf8"));
assert.deepEqual(seed, stage, "fixture must be the deterministic builder output");
assert.equal(stage.id, "stage_yingdi_e01_tomb_v2");
assert.equal(stage.coordinateFrame.unit, "metre");
assert.deepEqual(stage.snapshots.map((item) => item.shotId), expectedShots);
assert.equal(stage.cameras.length, 4);
for (const id of requiredEntityIds) assert.ok(stage.entities.some((item) => item.id === id), `missing ${id}`);

const entities = new Map(stage.entities.map((item) => [item.id, item]));
const coffin = entities.get("coffin-shell");
const panel = entities.get("phoenix-panel");
const shovel = entities.get("grave-shovel");
assert.ok(coffin && panel && shovel, "core physical entities must exist");
assert.deepEqual(entities.get("tomb-room")?.geometry.size, [6.4, 4.8, 3.8]);
assert.deepEqual(coffin.geometry.size, [2.15, 0.44, 0.78]);
assert.equal(panel.transform.rotation[0], 0, "panel must remain horizontal");
assert.equal(panel.transform.rotation[1], 0, "panel must remain horizontal");
assert.equal(panel.transform.rotation[2], 0, "panel normal must point upward");
assert.equal(panel.transform.rotation[3], 1, "panel normal must point upward");
assert.ok(gapBetween(aabb(shovel), aabb(panel)) >= 0.08, "shovel-panel gap must be at least 0.08 m");

const coffinBounds = coffin.metadata.interiorBounds;
assert.ok(coffinBounds && typeof coffinBounds === "object", "coffin must declare hollow interior bounds");
for (const snapshot of stage.snapshots) {
  assert.equal(snapshot.cameraId, `${snapshot.shotId}-camera`, `${snapshot.shotId} camera must match`);
  assert.deepEqual(snapshot.entityStates.map((item) => item.entityId), stage.entities.map((item) => item.id), `${snapshot.shotId} must capture every entity transform`);
  const li = state(snapshot, "li-baozhu-full-body");
  const wei = state(snapshot, "wei-xun-full-body");
  assert.ok(pointInAabb(li.transform.position, coffinBounds), `${snapshot.shotId} Li must remain inside the coffin`);
  assert.equal(pointInAabb(wei.transform.position, coffinBounds), false, `${snapshot.shotId} Wei must remain outside the coffin`);
  assert.ok(snapshot.constraintIds.includes("coffin-containment"), `${snapshot.shotId} must preserve coffin containment`);
  assert.ok(snapshot.constraintIds.includes("lid-hinge-contact"), `${snapshot.shotId} must preserve lid contact`);
  assert.ok(snapshot.constraintIds.includes("shovel-panel-clearance"), `${snapshot.shotId} must preserve shovel clearance`);
  assert.ok(snapshot.constraintIds.includes("panel-horizontal"), `${snapshot.shotId} must preserve panel horizontality`);
}

for (const camera of stage.cameras) {
  for (const entityId of colliderIds) {
    const entity = entities.get(entityId);
    assert.ok(entity, `missing collider ${entityId}`);
    assert.equal(pointInAabb(camera.position, aabb(entity)), false, `${camera.id} must stay outside ${entityId}`);
  }
}
const roomBounds = aabb(entities.get("tomb-room"));
for (const camera of stage.cameras.filter((item) => /C19|C20/.test(item.id))) {
  assert.ok(pointInAabb(camera.target, roomBounds), `${camera.id} target must stay inside tomb room`);
}

assert.deepEqual(auditYingdiTombStage(stage), { ok: true, errors: [] });
console.log("PASS E01 C19-C22 tomb stage physical constraints");
