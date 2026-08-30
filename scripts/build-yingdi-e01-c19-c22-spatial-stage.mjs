import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ID = "stage_yingdi_e01_tomb_v2";
const CREATED_AT = "2026-08-30T00:00:00.000Z";
const SHOTS = ["E01-S01-C19", "E01-S01-C20", "E01-S01-C21", "E01-S01-C22"];
const IDENTITY = [0, 0, 0, 1];
const UNIT_SCALE = [1, 1, 1];
const ROOM_SURFACES = ["tomb-room", "tomb-room-ceiling", "tomb-room-wall-west", "tomb-room-wall-east", "tomb-room-wall-north", "tomb-room-wall-south"];
const COFFIN_SURFACES = ["coffin-shell", "coffin-side-north", "coffin-side-south", "coffin-end-head", "coffin-end-foot"];

function transform(position, rotation = IDENTITY, scale = UNIT_SCALE) { return { position, rotation, scale }; }
function attachment(id, label, position) { return { id, label, localTransform: transform(position) }; }
function multiply(left, right) { return [left[3] * right[0] + left[0] * right[3] + left[1] * right[2] - left[2] * right[1], left[3] * right[1] - left[0] * right[2] + left[1] * right[3] + left[2] * right[0], left[3] * right[2] + left[0] * right[1] - left[1] * right[0] + left[2] * right[3], left[3] * right[3] - left[0] * right[0] - left[1] * right[1] - left[2] * right[2]]; }
function conjugate(quaternion) { return [-quaternion[0], -quaternion[1], -quaternion[2], quaternion[3]]; }
function rotate(vector, quaternion) { return multiply(multiply(quaternion, [...vector, 0]), conjugate(quaternion)).slice(0, 3); }
function worldPoint(current, local) { return rotate(local.map((value, axis) => value * current.scale[axis]), current.rotation).map((value, axis) => value + current.position[axis]); }
function subtract(left, right) { return left.map((value, index) => value - right[index]); }
function distance(left, right) { return Math.hypot(...left.map((value, index) => value - right[index])); }
function attachmentWorld(entity, current, attachmentId) {
  const value = entity.attachments?.find((item) => item.id === attachmentId);
  return value ? worldPoint(current, value.localTransform.position) : null;
}
function capsuleHalfExtents(size) { return [size[0], size[0] + size[1] / 2, size[0]]; }
function geometryAabb(entity, current = entity.transform) {
  const half = entity.geometry.kind === "capsule" ? capsuleHalfExtents(entity.geometry.size) : entity.geometry.size.map((value) => value / 2);
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((axis) => rotate(axis, current.rotation));
  const extent = axes[0].map((_, worldAxis) => axes.reduce((sum, axis, localAxis) => sum + Math.abs(axis[worldAxis]) * half[localAxis] * current.scale[localAxis], 0));
  return { min: current.position.map((value, axis) => value - extent[axis]), max: current.position.map((value, axis) => value + extent[axis]) };
}
function pointInAabb(point, bounds, tolerance = 0) { return point.every((value, axis) => value >= bounds.min[axis] - tolerance && value <= bounds.max[axis] + tolerance); }
function pointInGeometry(point, entity, current = entity.transform) {
  const local = rotate(point.map((value, axis) => value - current.position[axis]), conjugate(current.rotation)).map((value, axis) => value / current.scale[axis]);
  if (entity.geometry.kind === "capsule") {
    const radius = entity.geometry.size[0];
    const halfCylinder = entity.geometry.size[1] / 2;
    const y = Math.max(-halfCylinder, Math.min(halfCylinder, local[1]));
    return Math.hypot(local[0], local[1] - y, local[2]) <= radius;
  }
  return entity.geometry.size.every((size, axis) => Math.abs(local[axis]) <= size / 2);
}
function gap(left, right) { return Math.hypot(...left.min.map((minimum, axis) => Math.max(0, minimum - right.max[axis], right.min[axis] - left.max[axis]))); }
function entityMap(stage) { return new Map((stage?.entities ?? []).map((entity) => [entity.id, entity])); }
function snapshotState(snapshot, id) { return snapshot.entityStates?.find((state) => state.entityId === id) ?? null; }
function manualCapabilities() {
  const fallback = () => ({ status: "manual_fallback", message: "Deterministic metric proxy stage; no automatic geometry required.", checkedAt: CREATED_AT });
  return { overall: "manual_fallback", webgl2: fallback(), comfyui: fallback(), mogeNode: fallback(), mogeModel: fallback(), panoramaConversion: fallback(), pose: fallback(), systemMemory: fallback(), gpuMemory: fallback() };
}
function box(id, label, position, size, tags, metadata = {}, attachments) {
  return { id, label, tags, transform: transform(position), geometry: { kind: "box", size }, ...(attachments ? { attachments } : {}), visibility: "visible", metadata: { collider: true, ...metadata } };
}
function humanoid(id, label, position, rotation, role, radius, cylinderLength) {
  return {
    id, label, tags: ["character", "full-body", "collider", role], transform: transform(position, rotation),
    // SpatialStageViewport calls CapsuleGeometry(size[0], size[1]), so total height is 2r + cylinderLength.
    geometry: { kind: "capsule", size: [radius, cylinderLength, radius] },
    rig: { kind: "humanoid", joints: { pelvis: "pelvis", spine: "spine_01", chest: "spine_02", neck: "neck", head: "head", leftShoulder: "clavicle_l", leftElbow: "lowerarm_l", leftWrist: "hand_l", rightShoulder: "clavicle_r", rightElbow: "lowerarm_r", rightWrist: "hand_r", leftHip: "thigh_l", leftKnee: "calf_l", leftAnkle: "foot_l", rightHip: "thigh_r", rightKnee: "calf_r", rightAnkle: "foot_r" } },
    attachments: [attachment("left_palm", "Left palm", [-radius, cylinderLength * 0.28, 0]), attachment("right_palm", "Right palm", [radius, cylinderLength * 0.28, 0]), attachment("gaze", "Gaze origin", [0, cylinderLength / 2 + radius, -radius / 2])],
    visibility: "visible",
    metadata: { collider: true, role, bodyProxy: "complete humanoid capsule", viewportCapsule: { radius, cylinderLength, totalHeight: radius * 2 + cylinderLength } }
  };
}
function stateFor(entity) {
  const state = { entityId: entity.id, transform: structuredClone(entity.transform), visibility: entity.visibility };
  return entity.rig ? { ...state, pose: { rootTransform: structuredClone(entity.transform), jointRotations: {}, contacts: [], source: "manual", confidence: 1 } } : state;
}
function roomInterior(entities) {
  const floor = entities.get("tomb-room");
  const ceiling = entities.get("tomb-room-ceiling");
  const west = entities.get("tomb-room-wall-west");
  const east = entities.get("tomb-room-wall-east");
  const north = entities.get("tomb-room-wall-north");
  const south = entities.get("tomb-room-wall-south");
  if (![floor, ceiling, west, east, north, south].every(Boolean)) return null;
  return { min: [geometryAabb(west).max[0], geometryAabb(floor).max[1], geometryAabb(north).max[2]], max: [geometryAabb(east).min[0], geometryAabb(ceiling).min[1], geometryAabb(south).min[2]] };
}
function coffinInterior(entities) {
  const floor = entities.get("coffin-shell");
  const north = entities.get("coffin-side-north");
  const south = entities.get("coffin-side-south");
  const head = entities.get("coffin-end-head");
  const foot = entities.get("coffin-end-foot");
  if (![floor, north, south, head, foot].every(Boolean)) return null;
  return { min: [geometryAabb(head).max[0], geometryAabb(floor).max[1], geometryAabb(north).max[2]], max: [geometryAabb(foot).min[0], Math.min(geometryAabb(north).max[1], geometryAabb(south).max[1]), geometryAabb(south).min[2]] };
}

export function buildYingdiTombStage() {
  const hingeWorld = [0, 0.84, -0.35];
  const lidRotation = [-0.17364818, 0, 0, 0.98480775];
  const lidPinLocal = [0, -0.06, -0.39];
  const lidPosition = subtract(hingeWorld, rotate(lidPinLocal, lidRotation));
  const entities = [
    box("tomb-room", "Tomb room stone floor", [0, -0.05, 0], [6.4, 0.1, 3.8], ["environment", "room", "surface"], { surface: "floor", dimensionsMetres: [6.4, 3.8, 4.8] }),
    box("tomb-room-ceiling", "Tomb room stone ceiling", [0, 4.75, 0], [6.4, 0.1, 3.8], ["environment", "room", "surface"], { surface: "ceiling" }),
    box("tomb-room-wall-west", "Tomb room west wall", [-3.15, 2.35, 0], [0.1, 4.7, 3.8], ["environment", "room", "surface"], { surface: "wall" }),
    box("tomb-room-wall-east", "Tomb room east wall", [3.15, 2.35, 0], [0.1, 4.7, 3.8], ["environment", "room", "surface"], { surface: "wall" }),
    box("tomb-room-wall-north", "Tomb room north wall", [0, 2.35, -1.85], [6.2, 4.7, 0.1], ["environment", "room", "surface"], { surface: "wall" }),
    box("tomb-room-wall-south", "Tomb room south wall", [0, 2.35, 1.85], [6.2, 4.7, 0.1], ["environment", "room", "surface"], { surface: "wall" }),
    box("stone-plinth", "Central stone plinth", [0, 0.2, 0], [2.6, 0.4, 1.25], ["environment", "collider"]),
    box("coffin-shell", "Hollow coffin bottom", [0, 0.44, 0], [2.15, 0.08, 0.78], ["prop", "coffin", "surface"], { dimensionsMetres: [2.15, 0.78, 0.44] }, [attachment("lid_hinge", "Lid hinge", [0, 0.4, -0.35])]),
    box("coffin-side-north", "Hollow coffin north side", [0, 0.66, -0.35], [2.15, 0.36, 0.08], ["prop", "coffin", "surface"]),
    box("coffin-side-south", "Hollow coffin south side", [0, 0.66, 0.35], [2.15, 0.36, 0.08], ["prop", "coffin", "surface"]),
    box("coffin-end-head", "Hollow coffin head wall", [-1.035, 0.66, 0], [0.08, 0.36, 0.62], ["prop", "coffin", "surface"]),
    box("coffin-end-foot", "Hollow coffin foot wall", [1.035, 0.66, 0], [0.08, 0.36, 0.62], ["prop", "coffin", "surface"]),
    { ...box("coffin-lid", "Separate hinged coffin lid", lidPosition, [2.15, 0.12, 0.78], ["prop", "coffin-lid", "collider"], { hinge: "coffin-shell:lid_hinge" }, [attachment("hinge_pin", "Hinge pin", lidPinLocal)]), transform: transform(lidPosition, lidRotation) },
    box("phoenix-panel", "Horizontal phoenix relief panel", [0, 0.52, 0], [1.5, 0.02, 0.5], ["prop", "panel", "collider"], { normal: [0, 1, 0], floorClearanceMetres: 0.04 }),
    humanoid("li-baozhu-full-body", "Li Baozhu full-body proxy", [0, 0.66, 0], [0, 0, 0.70710678, 0.70710678], "li-baozhu", 0.18, 1.42),
    humanoid("wei-xun-full-body", "Wei Xun full-body proxy", [1.72, 1.2, 0.22], IDENTITY, "wei-xun", 0.25, 1.4),
    box("jade-dagger", "Separate jade dagger", [0.34, 0.58, -0.1], [0.46, 0.04, 0.07], ["prop", "dagger", "collider"], { propKind: "dagger" }),
    { ...box("grave-shovel", "Separate grave shovel", [1.72, 0.1, -0.95], [1.15, 0.08, 0.16], ["prop", "shovel", "collider"], { propKind: "shovel", panelClearanceMetres: 0.08 }), transform: transform([1.72, 0.1, -0.95], [0, 0, -0.25881905, 0.96592583]) }
  ];
  const cameras = [
    { id: "E01-S01-C19-camera", label: "C19 low coffin threshold", position: [-2.45, 1.1, -1.35], rotation: IDENTITY, target: [0, 0.7, 0], panoramaYaw: 0, panoramaPitch: 0, fov: 44, near: 0.01, far: 12, continuityGroup: "E01-C19-C22-tomb" },
    { id: "E01-S01-C20-camera", label: "C20 coffin interior reverse", position: [0, 1.5, -1.4], rotation: IDENTITY, target: [0, 0.66, 0], panoramaYaw: 0, panoramaPitch: 0, fov: 48, near: 0.01, far: 12, continuityGroup: "E01-C19-C22-tomb" },
    { id: "E01-S01-C21-camera", label: "C21 gaze to panel", position: [2.25, 1.55, -1.32], rotation: IDENTITY, target: [0, 0.52, 0], panoramaYaw: 0, panoramaPitch: 0, fov: 46, near: 0.01, far: 12, continuityGroup: "E01-C19-C22-tomb" },
    { id: "E01-S01-C22-camera", label: "C22 shoulder insert", position: [2.02, 1.52, 0.95], rotation: IDENTITY, target: [1.72, 1.3, 0.22], panoramaYaw: 0, panoramaPitch: 0, fov: 52, near: 0.01, far: 12, continuityGroup: "E01-C19-C22-tomb" }
  ];
  const constraints = [
    { id: "coffin-containment", kind: "axis_limit", subjectEntityId: "li-baozhu-full-body", targetEntityId: "coffin-shell", parameters: { boundsMin: [-0.995, 0.48, -0.31], boundsMax: [0.995, 0.84, 0.31] }, enabled: true },
    { id: "lid-hinge-contact", kind: "attachment", subjectEntityId: "coffin-lid", targetEntityId: "coffin-shell", subjectAttachmentId: "hinge_pin", targetAttachmentId: "lid_hinge", parameters: { maxDistance: 0.02 }, enabled: true },
    { id: "shovel-panel-clearance", kind: "distance", subjectEntityId: "grave-shovel", targetEntityId: "phoenix-panel", parameters: { minDistance: 0.08 }, enabled: true },
    { id: "panel-horizontal", kind: "orientation", subjectEntityId: "phoenix-panel", parameters: { normal: [0, 1, 0], maxDeviationDegrees: 0 }, enabled: true }
  ];
  const snapshots = SHOTS.map((shotId, index) => ({ id: `${ID}_${shotId}`, shotId, beatId: shotId.split("-").at(-1), ...(index ? { previousSnapshotId: `${ID}_${SHOTS[index - 1]}` } : {}), cameraId: `${shotId}-camera`, entityStates: entities.map(stateFor), constraintIds: constraints.map((constraint) => constraint.id), createdAt: `2026-08-30T00:00:0${index}.000Z` }));
  return { schemaVersion: 2, id: ID, sceneId: "yingdi_e01_tomb_c19_c22", revision: 2, coordinateFrame: { handedness: "right", upAxis: "y", unit: "metre", origin: [0, 0, 0], forward: [0, 0, -1], groundY: 0, scaleMode: "metric" }, environment: { sources: [{ kind: "procedural", primitive: "room" }] }, entities, constraints, cameras, snapshots, capabilities: manualCapabilities(), sourceDigest: "", updatedAt: CREATED_AT };
}

export function auditYingdiTombStage(stage) {
  const errors = [];
  const entities = entityMap(stage);
  const frame = stage?.coordinateFrame;
  if (stage?.id !== ID) errors.push("stage_id_invalid");
  if (!frame || frame.handedness !== "right" || frame.upAxis !== "y" || frame.unit !== "metre" || frame.scaleMode !== "metric") errors.push("coordinate_frame_invalid");
  if (JSON.stringify((stage?.snapshots ?? []).map((snapshot) => snapshot.shotId)) !== JSON.stringify(SHOTS)) errors.push("snapshot_order_invalid");
  if (stage?.cameras?.length !== 4) errors.push("camera_count_invalid");
  if (!ROOM_SURFACES.every((id) => entities.has(id)) || entities.get("tomb-room")?.geometry?.size?.join(",") !== "6.4,0.1,3.8" || !roomInterior(entities)) errors.push("room_enclosure_invalid");
  if (!COFFIN_SURFACES.every((id) => entities.has(id)) || entities.get("coffin-shell")?.geometry?.size?.join(",") !== "2.15,0.08,0.78" || entities.get("coffin-shell")?.metadata?.hollow !== undefined || !coffinInterior(entities)) errors.push("coffin_enclosure_invalid");
  for (const id of ["coffin-lid", "phoenix-panel", "li-baozhu-full-body", "wei-xun-full-body", "grave-shovel", "jade-dagger"]) if (!entities.has(id)) errors.push(`missing_entity:${id}`);
  const panel = entities.get("phoenix-panel");
  const shovel = entities.get("grave-shovel");
  if (!panel || distance(rotate([0, 1, 0], panel.transform.rotation), [0, 1, 0]) > 1e-8 || JSON.stringify(panel.metadata?.normal) !== "[0,1,0]") errors.push("panel_horizontal_invalid");
  if (!panel || !shovel || gap(geometryAabb(panel), geometryAabb(shovel)) < 0.08) errors.push("shovel_panel_clearance_invalid");
  const interior = coffinInterior(entities);
  const expectedIds = (stage?.entities ?? []).map((entity) => entity.id);
  const requirements = ["coffin-containment", "lid-hinge-contact", "shovel-panel-clearance", "panel-horizontal"];
  for (const snapshot of stage?.snapshots ?? []) {
    const li = snapshotState(snapshot, "li-baozhu-full-body");
    const wei = snapshotState(snapshot, "wei-xun-full-body");
    const lid = snapshotState(snapshot, "coffin-lid");
    const shell = snapshotState(snapshot, "coffin-shell");
    if (JSON.stringify((snapshot.entityStates ?? []).map((item) => item.entityId)) !== JSON.stringify(expectedIds)) errors.push(`snapshot_entities_invalid:${snapshot.shotId}`);
    if (snapshot.cameraId !== `${snapshot.shotId}-camera`) errors.push(`snapshot_camera_invalid:${snapshot.shotId}`);
    if (!requirements.every((id) => snapshot.constraintIds?.includes(id))) errors.push(`snapshot_constraints_invalid:${snapshot.shotId}`);
    if (!interior || !li || !pointInAabb(geometryAabb(entities.get("li-baozhu-full-body"), li.transform).min, interior, 1e-6) || !pointInAabb(geometryAabb(entities.get("li-baozhu-full-body"), li.transform).max, interior, 1e-6)) errors.push(`li_geometry_outside_coffin:${snapshot.shotId}`);
    if (!interior || !wei || pointInAabb(wei.transform.position, interior)) errors.push(`wei_inside_coffin:${snapshot.shotId}`);
    const lidHinge = lid && attachmentWorld(entities.get("coffin-lid"), lid.transform, "hinge_pin");
    const shellHinge = shell && attachmentWorld(entities.get("coffin-shell"), shell.transform, "lid_hinge");
    if (!lidHinge || !shellHinge || distance(lidHinge, shellHinge) > 0.02) errors.push(`lid_hinge_distance_invalid:${snapshot.shotId}`);
  }
  for (const camera of stage?.cameras ?? []) for (const entity of stage?.entities?.filter((item) => item.metadata?.collider === true) ?? []) if (pointInGeometry(camera.position, entity)) errors.push(`camera_in_collider:${camera.id}:${entity.id}`);
  const room = roomInterior(entities);
  if (room) for (const camera of (stage?.cameras ?? []).filter((item) => /C19|C20/.test(item.id))) if (!pointInAabb(camera.target, room)) errors.push(`camera_target_outside_room:${camera.id}`);
  return { ok: errors.length === 0, errors };
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex < 0 || !process.argv[outputIndex + 1]) throw new Error("missing --output");
  if (process.argv.length !== outputIndex + 2) throw new Error("unknown argument");
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(buildYingdiTombStage(), null, 2)}\n`, "utf8");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
