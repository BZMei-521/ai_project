import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildYingdiTombStage, auditYingdiTombStage } from "./build-yingdi-e01-c19-c22-spatial-stage.mjs";
import { buildYingdiUnityExchanges } from "./lib/unity-previs/yingdi-tomb-adapter.mjs";

const stage = buildYingdiTombStage();
assert.equal(stage.id, "stage_yingdi_e01_tomb_v3", "fixed entrance must create a new spatial authority version");
assert.equal(stage.revision, 7);
const c21Camera = stage.cameras.find((camera) => camera.id === "E01-S01-C21-camera");
const c22Camera = stage.cameras.find((camera) => camera.id === "E01-S01-C22-camera");
assert.deepEqual(c21Camera.position, [-2.4, 2.45, 1.45]);
assert.deepEqual(c21Camera.target, [0.15, 0.72, 0]);
assert.equal(c21Camera.fov, 58);
assert.deepEqual(c22Camera.position, [-2.25, 2.2, 1.35]);
assert.deepEqual(c22Camera.target, [0.2, 0.74, 0]);
assert.equal(c22Camera.fov, 60);

const entities = new Map(stage.entities.map((entity) => [entity.id, entity]));
for (const id of [
  "tomb-room-wall-north-left",
  "tomb-room-wall-north-right",
  "tomb-room-wall-north-lintel",
  "tomb-entrance-threshold",
  "tomb-entrance-frame-left",
  "tomb-entrance-frame-right",
  "tomb-entrance-frame-lintel",
  "tomb-corridor-floor",
  "tomb-corridor-end"
]) assert.ok(entities.has(id), `missing fixed entrance geometry ${id}`);
assert.equal(stage.entities.filter((entity) => entity.tags.includes("entrance")).length, 1, "the tomb must expose exactly one entrance authority entity");
assert.deepEqual(entities.get("tomb-entrance-threshold").metadata.worldAnchor, { wall: "north", position: [0, 0.1, -1.85], width: 1.2, height: 2.8 });

const doorwayPoint = [0, 1.4, -1.85];
function containsBox(entity, point) {
  if (entity.geometry.kind !== "box") return false;
  return point.every((value, axis) => Math.abs(value - entity.transform.position[axis]) <= entity.geometry.size[axis] / 2);
}
assert.equal(stage.entities.filter((entity) => entity.tags.includes("room-wall")).some((entity) => containsBox(entity, doorwayPoint)), false, "north wall geometry must contain a real doorway opening");
assert.deepEqual(stage.environment.sources, [{
  kind: "panorama",
  role: "fixed_world_material",
  projection: "equirectangular_world_anchor",
  anchor: [0, 1.55, 0],
  yawDegrees: 0,
  geometryAuthority: false
}]);
assert.deepEqual(auditYingdiTombStage(stage), { ok: true, errors: [] });

const duplicateEntrance = structuredClone(stage);
duplicateEntrance.entities.find((entity) => entity.id === "tomb-corridor-floor").tags.push("entrance");
assert.ok(auditYingdiTombStage(duplicateEntrance).errors.includes("single_entrance_invalid"));

const panorama = { assetId: "yingdi-e01-tomb-codex-v1", path: "C:/production/master-codex-v1-2x1.png", sha256: "e".repeat(64), width: 1774, height: 887 };
const exchanges = buildYingdiUnityExchanges(stage, panorama);
for (const { exchange } of exchanges.exchanges) {
  assert.deepEqual(exchange.environment, {
    panoramaPath: panorama.path,
    panoramaSha256: panorama.sha256,
    projection: "equirectangular_world_anchor",
    anchor: { x: 0, y: 1.55, z: 0 },
    yawDegrees: 0,
    geometryAuthority: false
  });
}

const controlsSource = await readFile(new URL("./build-yingdi-e01-c19-c22-unity-controls.mjs", import.meta.url), "utf8");
assert.match(controlsSource, /\["environment_id", environments\]/, "control packs must include a stable environment segmentation pass");
assert.match(controlsSource, /panoramaRole:\s*"fixed_world_material"/);
const packTypeSource = await readFile(new URL("../src/modules/spatial-stage/spatialControlPack.ts", import.meta.url), "utf8");
assert.match(packTypeSource, /"environment_id"/, "spatial control pack contract must preserve environment segmentation");
const providerSource = await readFile(new URL("../src/services/generation-providers/codexTaskPackageRuntime.mjs", import.meta.url), "utf8");
assert.match(providerSource, /environment_id:\s*"environment_id"/, "Codex task packages must route environment segmentation without dropping it");
const bridgeSource = await readFile(new URL("../src/modules/platform/desktopBridge.ts", import.meta.url), "utf8");
assert.match(bridgeSource, /"environment_id"/, "desktop bridge must expose environment segmentation artifacts");

const dataSource = await readFile(new URL("../integrations/unity-previs/Runtime/PrevisData.cs", import.meta.url), "utf8");
assert.match(dataSource, /class EnvironmentMaterialData/);
const sceneSource = await readFile(new URL("../integrations/unity-previs/Runtime/PrevisScene.cs", import.meta.url), "utf8");
assert.match(sceneSource, /LoadImage/);
assert.match(sceneSource, /_UsePanorama/);
assert.match(sceneSource, /r\.kind=="gaze"/, "gaze relations must be recognized as non-geometric preflight constraints");
const exportSource = await readFile(new URL("../integrations/unity-previs/Runtime/PrevisExport.cs", import.meta.url), "utf8");
assert.match(exportSource, /spatial_color/, "global color authority must be rendered without subject appearance");
assert.match(exportSource, /spatial_depth/, "global depth authority must exclude subject body shape");
assert.match(exportSource, /spatial_normal/, "global normal authority must exclude subject body shape");
assert.match(exportSource, /entity\.role=="subject"/, "subject renderers must be identifiable for spatial-only passes");
const poseSource = await readFile(new URL("../integrations/unity-previs/Runtime/PrevisPose.cs", import.meta.url), "utf8");
const adapterSource = await readFile(new URL("./lib/unity-previs/yingdi-tomb-adapter.mjs", import.meta.url), "utf8");
assert.match(poseSource, /channel=="orientation"/, "pose controls must encode character facing independently of appearance");
assert.match(poseSource, /head-forward/, "pose controls must expose an explicit head-facing anchor");
assert.match(poseSource, /kind=="gaze"/, "head-facing anchor must follow an explicit gaze relation when present");
assert.match(adapterSource, /kind:\s*"gaze"[\s\S]*subjectId:\s*"li-baozhu-full-body"[\s\S]*targetId:\s*"wei-xun-full-body"/, "Li Baozhu must explicitly gaze toward Wei Xun across tomb shots");
const codexReferenceSource = await readFile(new URL("../src/services/generation-providers/spatialCodexReferences.ts", import.meta.url), "utf8");
assert.match(codexReferenceSource, /contains no character appearance/i, "Codex color reference must forbid deriving character appearance from Unity");
assert.match(codexReferenceSource, /identity references are the only appearance authority/i, "Codex prompt contract must make character identity exclusive");
const shaderSource = await readFile(new URL("../integrations/unity-previs/Shaders/Control.shader", import.meta.url), "utf8");
assert.match(shaderSource, /_PanoramaTex/);
assert.match(shaderSource, /_PanoramaAnchor/);
assert.match(shaderSource, /atan2/);

console.log("PASS E01 tomb v3 fixed environment contract");
