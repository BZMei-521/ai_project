import assert from "node:assert/strict";
import { fromSceneStage, toSceneStage } from "./lib/unity-previs/stage-adapter.mjs";

const digest = "b".repeat(64);
const transform = (position = [0, 0, 0]) => ({ position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
const stage = () => ({
  schemaVersion: 2, id: "stage-a", sceneId: "scene-a", revision: 3,
  coordinateFrame: { handedness: "right", upAxis: "y", unit: "metre", origin: [0, 0, 0], forward: [0, 0, -1], groundY: 0, scaleMode: "metric" },
  environment: { sources: [{ kind: "empty_stage" }] }, constraints: [], sourceDigest: "fnv1a32:12345678", updatedAt: "2026-08-26T00:00:00.000Z",
  entities: [
    { id: "room", label: "Room", tags: ["previs:environment"], transform: transform(), geometry: { kind: "box", size: [4, 3, 4] }, visibility: "visible", metadata: { opaque: { retain: true }, unityPrevisRole: "environment" } },
    { id: "cup", label: "Cup", tags: ["previs:interaction"], transform: transform([1, 0, 0]), geometry: { kind: "sphere", size: [1, 1, 1] }, visibility: "visible", metadata: { unityPrevisRole: "interaction" } }
  ],
  cameras: [{ id: "cam-a", label: "Camera", position: [0, 1, 3], rotation: [0, 0, 0, 1], target: [0, 1, 0], panoramaYaw: 0, panoramaPitch: 0, fov: 50, near: .01, far: 20 }],
  snapshots: [{ id: "snapshot-a", shotId: "shot-a", beatId: "beat-a", cameraId: "cam-a", entityStates: [{ entityId: "room", transform: transform(), visibility: "visible" }, { entityId: "cup", transform: transform([1, 0, 0]), visibility: "visible" }], constraintIds: [], createdAt: "2026-08-26T00:00:00.000Z" }]
});

const exchange = fromSceneStage(stage(), { snapshotId: "snapshot-a", cameraId: "cam-a", stageDigest: digest });
assert.equal(exchange.source.snapshotId, "snapshot-a");
assert.equal(exchange.source.cameraId, "cam-a");
assert.deepEqual(exchange.entities.map((entity) => entity.role), ["environment", "interaction"]);
assert.equal(exchange.entities[1].parts[0].kind, "sphere");
assert.match(exchange.entities[0].parts[0].id, /^[A-Za-z0-9_-]{1,128}$/);

assert.throws(() => fromSceneStage(stage(), { snapshotId: "snapshot-a", stageDigest: digest }), /cameraId_explicit_required/);
assert.throws(() => fromSceneStage({ ...stage(), entities: stage().entities.map((entity, index) => index ? entity : { ...entity, geometry: { kind: "plane", size: [1, 1, 1] } }) }, { snapshotId: "snapshot-a", cameraId: "cam-a", stageDigest: digest }), /geometry_unsupported/);
assert.throws(() => fromSceneStage({ ...stage(), entities: stage().entities.map((entity, index) => index ? entity : { ...entity, rig: { kind: "humanoid", joints: {} } }) }, { snapshotId: "snapshot-a", cameraId: "cam-a", stageDigest: digest }), /rig_unsupported/);
assert.throws(() => fromSceneStage({ ...stage(), entities: stage().entities.map((entity, index) => index ? entity : { ...entity, tags: ["previs:subject"], metadata: { unityPrevisRole: "subject" } }) }, { snapshotId: "snapshot-a", cameraId: "cam-a", stageDigest: digest }), /subject_pose_supplement_required/);

const edited = structuredClone(exchange);
edited.entities[1].position.x = 2;
edited.camera.fov = 55;
const restored = toSceneStage(stage(), edited, { stageDigest: digest });
assert.equal(restored.entities[0].metadata.opaque.retain, true);
assert.deepEqual(restored.snapshots[0].entityStates.find((state) => state.entityId === "cup").transform.position, [2, 0, 0]);
assert.equal(restored.cameras[0].fov, 55);
function serialized(value){if(Array.isArray(value))return value.map(serialized);if(typeof value==='number')return Math.fround(value);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,serialized(item)]));return value;}
assert.doesNotThrow(()=>toSceneStage(stage(),serialized(exchange),{stageDigest:digest}),'Unity float32 and property order must roundtrip');
for(const mutate of [e=>e.label='Changed',e=>e.entities[0].role='interaction',e=>e.camera.width=128,e=>e.camera.up={x:.1,y:1,z:0}]){const bad=structuredClone(exchange);mutate(bad);assert.throws(()=>toSceneStage(stage(),bad,{stageDigest:digest}),/immutable_changed/);}
for(const mutate of [s=>s.entities[0].visibility='hidden',s=>s.snapshots[0].entityStates[0].visibility='hidden',s=>s.coordinateFrame.origin=[1,0,0],s=>s.cameras[0].panoramaYaw=1]){const bad=stage();mutate(bad);assert.throws(()=>fromSceneStage(bad,{snapshotId:'snapshot-a',cameraId:'cam-a',stageDigest:digest}));}
assert.deepEqual(exchange.entities[1].parts[0].size,{x:2,y:2,z:2},'sphere radius maps to full diameter');
const capsule=stage();capsule.entities[1].geometry={kind:'capsule',size:[.2,1,.2]};assert.deepEqual(fromSceneStage(capsule,{snapshotId:'snapshot-a',cameraId:'cam-a',stageDigest:digest}).entities[1].parts[0].size,{x:.4,y:1.4,z:.4},'capsule cylinder length includes endcap diameter');
assert.throws(() => toSceneStage(stage(), { ...edited, source: { ...edited.source, snapshotId: "other" } }, { stageDigest: digest }), /snapshot_stale/);
assert.throws(() => toSceneStage(stage(), { ...edited, id: "other" }, { stageDigest: digest }), /immutable_changed/);
assert.throws(() => fromSceneStage({ ...stage(), cameras: [{ ...stage().cameras[0], rotation: [0, 0, .2, .98] }] }, { snapshotId: "snapshot-a", cameraId: "cam-a", stageDigest: digest }), /camera_roll_unsupported/);
assert.throws(() => toSceneStage(stage(), { ...edited, entities: edited.entities.map((entity) => entity.id === "cup" ? { ...entity, parts: [{ ...entity.parts[0], size: { x: 3, y: 3, z: 3 } }] } : entity) }, { stageDigest: digest }), /immutable_changed/);

console.log("PASS unity previs SceneStage adapter");
