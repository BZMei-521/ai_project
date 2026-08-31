import { createHash } from "node:crypto";
import { validateExchange } from "./exchange.mjs";

const TOMB_STAGE_ID = "stage_yingdi_e01_tomb_v2";
const SHOTS = ["E01-S01-C19", "E01-S01-C20", "E01-S01-C21", "E01-S01-C22"];
const vector = ([x, y, z]) => ({ x, y, z });
const quaternion = ([x, y, z, w]) => ({ x, y, z, w });
const identity = { x: 0, y: 0, z: 0, w: 1 };
const zero = { x: 0, y: 0, z: 0 };
const hash = (value) => createHash("sha256").update(value).digest("hex");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
}

export function yingdiTombStageDigest(stage) {
  return hash(JSON.stringify(canonical(stage)));
}

export function yingdiTombCameraDigest(camera) {
  return hash(JSON.stringify(canonical(camera)));
}

function role(entity) {
  if (entity.tags.includes("character")) return "subject";
  if (entity.tags.includes("environment")) return "environment";
  if (entity.id === "coffin-lid") return "foreground_occluder";
  return "interaction";
}

function color(entity) {
  if (entity.tags.includes("character")) return entity.id.startsWith("li-") ? [0.68, 0.52, 0.72] : [0.25, 0.45, 0.68];
  if (entity.tags.includes("environment")) return entity.id === "stone-plinth" ? [0.34, 0.33, 0.31] : [0.25, 0.28, 0.31];
  if (entity.id === "phoenix-panel" || entity.id === "jade-dagger") return [0.26, 0.58, 0.48];
  return [0.34, 0.22, 0.14];
}

function primitive(entity) {
  const size = entity.geometry.size;
  return {
    id: `${entity.id}-primitive`,
    kind: entity.geometry.kind,
    position: zero,
    rotation: identity,
    size: entity.geometry.kind === "capsule"
      ? { x: size[0] * 2, y: size[1] + size[0] * 2, z: size[0] * 2 }
      : vector(size),
    color: color(entity)
  };
}

function humanoid(entity) {
  const height = entity.metadata.viewportCapsule.totalHeight;
  const containedRestPose = entity.id === "li-baozhu-full-body";
  const positions = new Map();
  const joints = [];
  const bones = [];
  const add = (id, parentId, absolute, openPoseIndex = -1, radius = 0.02, hand = "", handIndex = -1) => {
    const parent = parentId ? positions.get(parentId) : [0, 0, 0];
    positions.set(id, absolute);
    joints.push({ id, parentId, position: vector(absolute.map((value, index) => value - parent[index])), rotation: identity, radius, openPoseIndex, hand, handIndex });
    if (parentId) bones.push({ from: parentId, to: id, radius: Math.max(radius * 0.72, 0.006) });
  };
  const h = height;
  add("pelvis", "", [0, -0.12 * h, 0], -1, 0.05 * h);
  add("chest", "pelvis", [0, 0.12 * h, 0], -1, 0.075 * h);
  add("neck", "chest", [0, 0.30 * h, 0], 1, 0.025 * h);
  add("head", "neck", [0, 0.41 * h, 0], -1, 0.065 * h);
  add("nose", "head", [0, 0.43 * h, 0.065 * h], 0, 0.012 * h);
  add("right-eye", "head", [-0.025 * h, 0.445 * h, 0.055 * h], 14, 0.008 * h);
  add("left-eye", "head", [0.025 * h, 0.445 * h, 0.055 * h], 15, 0.008 * h);
  add("right-ear", "head", [-0.06 * h, 0.42 * h, 0], 16, 0.009 * h);
  add("left-ear", "head", [0.06 * h, 0.42 * h, 0], 17, 0.009 * h);
  for (const [side, sign, armIndex, legIndex] of [["right", -1, 2, 8], ["left", 1, 5, 11]]) {
    const shoulderX = (containedRestPose ? 0.06 : 0.12) * h;
    const armX = (containedRestPose ? 0.075 : 0.20) * h;
    add(`${side}-shoulder`, "chest", [sign * shoulderX, 0.25 * h, 0], armIndex, 0.03 * h);
    add(`${side}-elbow`, `${side}-shoulder`, [sign * armX, 0.08 * h, 0.035 * h], armIndex + 1, 0.024 * h);
    add(`${side}-wrist`, `${side}-elbow`, [sign * armX, -0.08 * h, 0.07 * h], armIndex + 2, 0.014 * h, side, 0);
    add(`${side}-palm`, `${side}-wrist`, [sign * armX, -0.10 * h, 0.09 * h], -1, 0.017 * h);
    for (let finger = 0; finger < 5; finger += 1) {
      let parent = `${side}-palm`;
      for (let segment = 0; segment < 4; segment += 1) {
        const spread = (finger - 2) * (containedRestPose ? 0.004 : 0.009) * h;
        const reach = (0.015 + segment * 0.012) * h;
        const absolute = [sign * armX + spread, -0.10 * h - segment * 0.003 * h, 0.09 * h + reach];
        const id = `${side}-finger-${finger}-${segment}`;
        add(id, parent, absolute, -1, 0.004 * h, side, 1 + finger * 4 + segment);
        parent = id;
      }
    }
    add(`${side}-hip`, "pelvis", [sign * 0.06 * h, -0.13 * h, 0], legIndex, 0.04 * h);
    add(`${side}-knee`, `${side}-hip`, [sign * 0.065 * h, -0.31 * h, 0.02 * h], legIndex + 1, 0.033 * h);
    add(`${side}-ankle`, `${side}-knee`, [sign * 0.065 * h, -0.46 * h, 0.025 * h], legIndex + 2, 0.022 * h);
    add(`${side}-foot`, `${side}-ankle`, [sign * 0.065 * h, -0.47 * h, 0.09 * h], -1, 0.022 * h);
  }
  return { joints, bones };
}

function exchangeEntity(entity, state) {
  const subject = entity.tags.includes("character");
  const skeleton = subject ? humanoid(entity) : { joints: [], bones: [] };
  const attachments = (entity.attachments ?? []).map((attachment) => ({
    id: attachment.id,
    jointId: subject && /^(left|right)_palm$/.test(attachment.id) ? attachment.id.replace("_", "-") : "",
    position: subject && /^(left|right)_palm$/.test(attachment.id) ? zero : vector(attachment.localTransform.position)
  }));
  return {
    id: entity.id,
    label: entity.label,
    role: role(entity),
    position: vector(state.transform.position),
    rotation: quaternion(state.transform.rotation),
    scale: vector(state.transform.scale),
    parts: [primitive(entity)],
    joints: skeleton.joints,
    bones: skeleton.bones,
    attachments
  };
}

function assertProductionStage(stage) {
  if (stage?.id !== TOMB_STAGE_ID || stage?.schemaVersion !== 2 || stage?.revision !== 2) throw new TypeError("yingdi_unity_stage_invalid");
  if (JSON.stringify(stage.snapshots?.map((item) => item.shotId)) !== JSON.stringify(SHOTS)) throw new TypeError("yingdi_unity_shots_invalid");
  if (!stage.entities?.every((entity) => ["box", "capsule"].includes(entity.geometry?.kind))) throw new TypeError("yingdi_unity_geometry_invalid");
}

export function buildYingdiUnityExchanges(stage, panorama) {
  assertProductionStage(stage);
  if (!panorama || !/^[A-Fa-f0-9]{64}$/.test(panorama.sha256 ?? "") || panorama.width !== panorama.height * 2 || !panorama.path) throw new TypeError("yingdi_unity_panorama_invalid");
  const stageDigest = yingdiTombStageDigest(stage);
  const exchanges = stage.snapshots.map((snapshot) => {
    const camera = stage.cameras.find((item) => item.id === snapshot.cameraId);
    if (!camera) throw new TypeError(`yingdi_unity_camera_missing:${snapshot.cameraId}`);
    const states = new Map(snapshot.entityStates.map((item) => [item.entityId, item]));
    if (states.size !== stage.entities.length) throw new TypeError(`yingdi_unity_snapshot_incomplete:${snapshot.shotId}`);
    const containment = stage.constraints.find((item) => item.id === "coffin-containment");
    const coffin = states.get(containment.targetEntityId).transform;
    const worldMin = containment.parameters.boundsMin;
    const worldMax = containment.parameters.boundsMax;
    const exchange = {
      schemaVersion: 1,
      coordinateSystem: "RH_Y_UP_METRES",
      id: `yingdi-${snapshot.shotId.toLowerCase().replaceAll("-", "_")}`,
      label: `Yingdi ${snapshot.shotId} tomb Unity previs`,
      source: { stageId: stage.id, stageRevision: stage.revision, stageDigest, shotId: snapshot.shotId, snapshotId: snapshot.id, cameraId: camera.id },
      camera: { position: vector(camera.position), target: vector(camera.target), up: { x: 0, y: 1, z: 0 }, fov: camera.fov, near: camera.near, far: camera.far, width: 1280, height: 720 },
      entities: stage.entities.map((entity) => exchangeEntity(entity, states.get(entity.id))),
      relations: [{
        kind: "inside",
        subjectId: containment.subjectEntityId,
        targetId: containment.targetEntityId,
        attachmentId: "",
        targetPoint: zero,
        tolerance: 0.005,
        interiorMin: vector(worldMin.map((value, index) => value - coffin.position[index])),
        interiorMax: vector(worldMax.map((value, index) => value - coffin.position[index]))
      }]
    };
    const checked = validateExchange(exchange);
    if (!checked.valid) throw new TypeError(`yingdi_unity_exchange_invalid:${checked.errors.map((item) => item.field).join(",")}`);
    return { shotId: snapshot.shotId, cameraDigest: yingdiTombCameraDigest(camera), exchange };
  });
  return {
    schemaVersion: 1,
    workflow: "unity_previs_with_codex_panorama_appearance_v1",
    stageId: stage.id,
    stageRevision: stage.revision,
    stageDigest,
    panorama: { role: "appearance_reference_only", ...panorama, sha256: panorama.sha256.toLowerCase() },
    sourceAudit: { physicalStageRequired: true, unityGeometryAuthority: true, codexPanoramaGeometryAuthority: false },
    exchanges
  };
}
