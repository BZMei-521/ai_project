import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ID = "stage_yingdi_e01_tomb_v2";
const CREATED_AT = "2026-08-30T00:00:00.000Z";
const SHOTS = ["E01-S01-C19", "E01-S01-C20", "E01-S01-C21", "E01-S01-C22"];
const IDENTITY = [0, 0, 0, 1];
const UNIT_SCALE = [1, 1, 1];

function transform(position, rotation = IDENTITY, scale = UNIT_SCALE) {
  return { position, rotation, scale };
}

function attachment(id, label, position) {
  return { id, label, localTransform: transform(position) };
}

function manualCapabilities() {
  const fallback = () => ({
    status: "manual_fallback",
    message: "Deterministic metric proxy stage; no automatic geometry required.",
    checkedAt: CREATED_AT
  });
  return {
    overall: "manual_fallback",
    webgl2: fallback(),
    comfyui: fallback(),
    mogeNode: fallback(),
    mogeModel: fallback(),
    panoramaConversion: fallback(),
    pose: fallback(),
    systemMemory: fallback(),
    gpuMemory: fallback()
  };
}

function humanoid(id, label, position, rotation, role) {
  return {
    id,
    label,
    tags: ["character", "full-body", "collider", role],
    transform: transform(position, rotation),
    geometry: { kind: "capsule", size: [0.42, 1.72, 0.42] },
    rig: {
      kind: "humanoid",
      joints: {
        pelvis: "pelvis", spine: "spine_01", chest: "spine_02", neck: "neck", head: "head",
        leftShoulder: "clavicle_l", leftElbow: "lowerarm_l", leftWrist: "hand_l",
        rightShoulder: "clavicle_r", rightElbow: "lowerarm_r", rightWrist: "hand_r",
        leftHip: "thigh_l", leftKnee: "calf_l", leftAnkle: "foot_l",
        rightHip: "thigh_r", rightKnee: "calf_r", rightAnkle: "foot_r"
      }
    },
    attachments: [
      attachment("left_palm", "Left palm", [-0.18, 0.48, 0]),
      attachment("right_palm", "Right palm", [0.18, 0.48, 0]),
      attachment("gaze", "Gaze origin", [0, 0.72, -0.08])
    ],
    visibility: "visible",
    metadata: { role, bodyProxy: "complete humanoid capsule", collider: true }
  };
}

function stateFor(entity) {
  const base = {
    entityId: entity.id,
    transform: structuredClone(entity.transform),
    visibility: entity.visibility
  };
  if (!entity.rig) return base;
  return {
    ...base,
    pose: {
      rootTransform: structuredClone(entity.transform),
      jointRotations: {},
      contacts: [],
      source: "manual",
      confidence: 1
    }
  };
}

function pointInBounds(point, bounds) {
  return point.every((value, axis) => value >= bounds.min[axis] && value <= bounds.max[axis]);
}

function aabb(entity, transformValue = entity.transform) {
  const [width, height, depth] = entity.geometry.size;
  return {
    min: [transformValue.position[0] - width * transformValue.scale[0] / 2, transformValue.position[1] - height * transformValue.scale[1] / 2, transformValue.position[2] - depth * transformValue.scale[2] / 2],
    max: [transformValue.position[0] + width * transformValue.scale[0] / 2, transformValue.position[1] + height * transformValue.scale[1] / 2, transformValue.position[2] + depth * transformValue.scale[2] / 2]
  };
}

function gapBetween(left, right) {
  return Math.hypot(...left.min.map((minimum, axis) => Math.max(0, minimum - right.max[axis], right.min[axis] - left.max[axis])));
}

export function buildYingdiTombStage() {
  const entities = [
    {
      id: "tomb-room", label: "Enclosed metric tomb room", tags: ["environment", "room"],
      transform: transform([0, 2.4, 0]), geometry: { kind: "box", size: [6.4, 4.8, 3.8] }, visibility: "visible",
      metadata: { dimensionsMetres: [6.4, 3.8, 4.8], collider: false, enclosure: "interior volume" }
    },
    {
      id: "stone-plinth", label: "Central stone plinth", tags: ["environment", "collider"],
      transform: transform([0, 0.2, 0]), geometry: { kind: "box", size: [2.6, 0.4, 1.25] }, visibility: "visible",
      metadata: { collider: true }
    },
    {
      id: "coffin-shell", label: "Hollow coffin shell", tags: ["prop", "coffin", "collider"],
      transform: transform([0, 0.62, 0]), geometry: { kind: "box", size: [2.15, 0.44, 0.78] },
      attachments: [attachment("lid_hinge", "Lid hinge", [-1.0, 0.22, 0.31])], visibility: "visible",
      metadata: { collider: true, hollow: true, interiorBounds: { min: [-0.92, 0.4, -0.31], max: [0.92, 1.05, 0.31] }, dimensionsMetres: [2.15, 0.78, 0.44] }
    },
    {
      id: "coffin-lid", label: "Separate hinged coffin lid", tags: ["prop", "coffin-lid", "collider"],
      transform: transform([-0.9, 1.05, 0.56], [0, 0, 0.17364818, 0.98480775]), geometry: { kind: "box", size: [2.15, 0.12, 0.78] },
      attachments: [attachment("hinge_pin", "Hinge pin", [-0.1, -0.06, -0.31])], visibility: "visible",
      metadata: { collider: true, hinge: "coffin-shell:lid_hinge" }
    },
    {
      id: "phoenix-panel", label: "Horizontal phoenix relief panel", tags: ["prop", "panel", "collider"],
      transform: transform([0, 0.44, 0]), geometry: { kind: "box", size: [1.5, 0.02, 0.5] }, visibility: "visible",
      metadata: { collider: true, normal: [0, 1, 0], floorClearanceMetres: 0.04 }
    },
    humanoid("li-baozhu-full-body", "Li Baozhu full-body proxy", [0, 0.84, 0], [0, 0, 0.70710678, 0.70710678], "li-baozhu"),
    humanoid("wei-xun-full-body", "Wei Xun full-body proxy", [1.72, 1.12, 0.22], IDENTITY, "wei-xun"),
    {
      id: "jade-dagger", label: "Separate jade dagger", tags: ["prop", "dagger", "collider"],
      transform: transform([0.34, 0.5, -0.1]), geometry: { kind: "box", size: [0.46, 0.04, 0.07] }, visibility: "visible",
      metadata: { collider: true, propKind: "dagger" }
    },
    {
      id: "grave-shovel", label: "Separate grave shovel", tags: ["prop", "shovel", "collider"],
      transform: transform([1.72, 0.1, -0.95], [0, 0, -0.25881905, 0.96592583]), geometry: { kind: "box", size: [1.15, 0.08, 0.16] }, visibility: "visible",
      metadata: { collider: true, propKind: "shovel", panelClearanceMetres: 0.08 }
    }
  ];
  const cameras = [
    { id: "E01-S01-C19-camera", label: "C19 low coffin threshold", position: [-2.45, 1.1, -1.35], rotation: IDENTITY, target: [0, 0.76, 0], panoramaYaw: 0, panoramaPitch: 0, fov: 44, near: 0.01, far: 12, continuityGroup: "E01-C19-C22-tomb" },
    { id: "E01-S01-C20-camera", label: "C20 coffin interior reverse", position: [0, 1.5, -1.4], rotation: IDENTITY, target: [0, 0.82, 0], panoramaYaw: 0, panoramaPitch: 0, fov: 48, near: 0.01, far: 12, continuityGroup: "E01-C19-C22-tomb" },
    { id: "E01-S01-C21-camera", label: "C21 gaze to panel", position: [2.25, 1.55, -1.32], rotation: IDENTITY, target: [0, 0.44, 0], panoramaYaw: 0, panoramaPitch: 0, fov: 46, near: 0.01, far: 12, continuityGroup: "E01-C19-C22-tomb" },
    { id: "E01-S01-C22-camera", label: "C22 shoulder insert", position: [2.02, 1.52, 0.95], rotation: IDENTITY, target: [1.72, 1.3, 0.22], panoramaYaw: 0, panoramaPitch: 0, fov: 52, near: 0.01, far: 12, continuityGroup: "E01-C19-C22-tomb" }
  ];
  const constraints = [
    { id: "coffin-containment", kind: "axis_limit", subjectEntityId: "li-baozhu-full-body", targetEntityId: "coffin-shell", parameters: { boundsMin: [-0.92, 0.4, -0.31], boundsMax: [0.92, 1.05, 0.31] }, enabled: true },
    { id: "lid-hinge-contact", kind: "attachment", subjectEntityId: "coffin-lid", targetEntityId: "coffin-shell", subjectAttachmentId: "hinge_pin", targetAttachmentId: "lid_hinge", parameters: { maxDistance: 0.02 }, enabled: true },
    { id: "shovel-panel-clearance", kind: "distance", subjectEntityId: "grave-shovel", targetEntityId: "phoenix-panel", parameters: { minDistance: 0.08 }, enabled: true },
    { id: "panel-horizontal", kind: "orientation", subjectEntityId: "phoenix-panel", parameters: { normal: [0, 1, 0], maxDeviationDegrees: 0 }, enabled: true }
  ];
  const snapshots = SHOTS.map((shotId, index) => ({
    id: `${ID}_${shotId}`,
    shotId,
    beatId: shotId.split("-").at(-1),
    ...(index ? { previousSnapshotId: `${ID}_${SHOTS[index - 1]}` } : {}),
    cameraId: `${shotId}-camera`,
    entityStates: entities.map(stateFor),
    constraintIds: constraints.map((constraint) => constraint.id),
    createdAt: `2026-08-30T00:00:0${index}.000Z`
  }));
  return {
    schemaVersion: 2,
    id: ID,
    sceneId: "yingdi_e01_tomb_c19_c22",
    revision: 1,
    coordinateFrame: { handedness: "right", upAxis: "y", unit: "metre", origin: [0, 0, 0], forward: [0, 0, -1], groundY: 0, scaleMode: "metric" },
    environment: { sources: [{ kind: "procedural", primitive: "room" }] },
    entities,
    constraints,
    cameras,
    snapshots,
    capabilities: manualCapabilities(),
    sourceDigest: "",
    updatedAt: CREATED_AT
  };
}

export function auditYingdiTombStage(stage) {
  const errors = [];
  const entities = new Map((stage?.entities ?? []).map((entity) => [entity.id, entity]));
  const coffin = entities.get("coffin-shell");
  const panel = entities.get("phoenix-panel");
  const shovel = entities.get("grave-shovel");
  if (stage?.id !== ID) errors.push("stage_id_invalid");
  if (stage?.coordinateFrame?.unit !== "metre") errors.push("stage_unit_invalid");
  if (JSON.stringify((stage?.snapshots ?? []).map((snapshot) => snapshot.shotId)) !== JSON.stringify(SHOTS)) errors.push("snapshot_order_invalid");
  if (stage?.cameras?.length !== 4) errors.push("camera_count_invalid");
  for (const id of ["tomb-room", "coffin-shell", "coffin-lid", "phoenix-panel", "li-baozhu-full-body", "wei-xun-full-body", "grave-shovel"]) {
    if (!entities.has(id)) errors.push(`missing_entity:${id}`);
  }
  if (coffin?.geometry?.size?.join(",") !== "2.15,0.44,0.78") errors.push("coffin_dimensions_invalid");
  if (entities.get("tomb-room")?.geometry?.size?.join(",") !== "6.4,4.8,3.8") errors.push("tomb_dimensions_invalid");
  if (!panel || JSON.stringify(panel.transform.rotation) !== JSON.stringify(IDENTITY) || JSON.stringify(panel.metadata?.normal) !== "[0,1,0]") errors.push("panel_horizontal_invalid");
  if (!shovel || !panel || gapBetween(aabb(shovel), aabb(panel)) < 0.08) errors.push("shovel_panel_clearance_invalid");
  const interiorBounds = coffin?.metadata?.interiorBounds;
  const expectedEntityIds = (stage?.entities ?? []).map((entity) => entity.id);
  const requiredConstraints = ["coffin-containment", "lid-hinge-contact", "shovel-panel-clearance", "panel-horizontal"];
  for (const snapshot of stage?.snapshots ?? []) {
    const states = new Map(snapshot.entityStates?.map((item) => [item.entityId, item]) ?? []);
    if (JSON.stringify([...states.keys()]) !== JSON.stringify(expectedEntityIds)) errors.push(`snapshot_entities_invalid:${snapshot.shotId}`);
    if (snapshot.cameraId !== `${snapshot.shotId}-camera`) errors.push(`snapshot_camera_invalid:${snapshot.shotId}`);
    if (!requiredConstraints.every((id) => snapshot.constraintIds?.includes(id))) errors.push(`snapshot_constraints_invalid:${snapshot.shotId}`);
    const li = states.get("li-baozhu-full-body");
    const wei = states.get("wei-xun-full-body");
    if (!interiorBounds || !li || !pointInBounds(li.transform.position, interiorBounds)) errors.push(`li_outside_coffin:${snapshot.shotId}`);
    if (!interiorBounds || !wei || pointInBounds(wei.transform.position, interiorBounds)) errors.push(`wei_inside_coffin:${snapshot.shotId}`);
  }
  const colliderIds = ["stone-plinth", "coffin-shell", "coffin-lid", "phoenix-panel", "li-baozhu-full-body", "wei-xun-full-body", "grave-shovel", "jade-dagger"];
  for (const camera of stage?.cameras ?? []) {
    for (const id of colliderIds) {
      const collider = entities.get(id);
      if (!collider) continue;
      if (pointInBounds(camera.position, aabb(collider))) errors.push(`camera_in_collider:${camera.id}:${id}`);
    }
  }
  const room = entities.get("tomb-room");
  if (room) for (const camera of (stage?.cameras ?? []).filter((item) => /C19|C20/.test(item.id))) {
    if (!pointInBounds(camera.target, aabb(room))) errors.push(`camera_target_outside_room:${camera.id}`);
  }
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
