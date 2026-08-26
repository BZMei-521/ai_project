import { validateExchange } from "./exchange.mjs";

const PRIMITIVES = new Set(["box", "sphere", "capsule"]);
const ROLES = new Set(["environment", "interaction", "foreground_occluder"]);
const toVector = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? { x: value[0], y: value[1], z: value[2] } : null;
const toQuaternion = (value) => Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) ? { x: value[0], y: value[1], z: value[2], w: value[3] } : null;
const toTuple = ({ x, y, z }) => [x, y, z];

function fail(code) { throw new TypeError(`unity_previs_stage_adapter:${code}`); }
function sameIds(left, right) { return left.length === right.length && left.every((id) => right.includes(id)); }
function roleOf(entity) {
  const declared = entity?.metadata?.unityPrevisRole;
  const tagged = (entity?.tags ?? []).find((tag) => /^previs:(environment|interaction|foreground_occluder|subject)$/.test(tag))?.slice(7);
  if (declared && tagged && declared !== tagged) fail(`role_conflict:${entity.id}`);
  return declared ?? tagged ?? "";
}
function transform(value, entityId) {
  const source = value?.transform;
  if (!Array.isArray(source?.position) || source.position.length !== 3 || !Array.isArray(source?.rotation) || source.rotation.length !== 4 || !Array.isArray(source?.scale) || source.scale.length !== 3) fail(`transform_invalid:${entityId}`);
  const result = { position: toVector(source.position), rotation: toQuaternion(source.rotation), scale: toVector(source.scale) };
  if (!result.position || !result.rotation || !result.scale) fail(`transform_invalid:${entityId}`);
  return result;
}
function primitiveSize(geometry, entityId) {
  const size = geometry?.size;
  if (!Array.isArray(size) || size.length !== 3 || !size.every((value) => Number.isFinite(value) && value > 0)) fail(`geometry_size_invalid:${entityId}`);
  if (geometry.kind === "sphere") return { x: size[0] * 2, y: size[0] * 2, z: size[0] * 2 };
  if (geometry.kind === "capsule") return { x: size[0] * 2, y: size[1] + size[0] * 2, z: size[0] * 2 };
  return toVector(size);
}
function cameraRotation(position, target) {
  const z0 = position.x - target.x, z1 = position.y - target.y, z2 = position.z - target.z; const zl = Math.hypot(z0, z1, z2);
  if (zl < 1e-8) fail("camera_target_invalid"); const z = [z0 / zl, z1 / zl, z2 / zl];
  const xl = Math.hypot(z[2], 0, -z[0]); if (xl < 1e-8) fail("camera_up_unsupported"); const x = [z[2] / xl, 0, -z[0] / xl]; const y = [z[1] * x[2], z[2] * x[0] - z[0] * x[2], -z[1] * x[0]];
  const m00=x[0],m01=y[0],m02=z[0],m10=x[1],m11=y[1],m12=z[1],m20=x[2],m21=y[2],m22=z[2], trace=m00+m11+m22; let q;
  if (trace > 0) { const s=Math.sqrt(trace+1)*2; q=[(m21-m12)/s,(m02-m20)/s,(m10-m01)/s,.25*s]; } else if (m00 > m11 && m00 > m22) { const s=Math.sqrt(1+m00-m11-m22)*2; q=[.25*s,(m01+m10)/s,(m02+m20)/s,(m21-m12)/s]; } else if (m11 > m22) { const s=Math.sqrt(1+m11-m00-m22)*2; q=[(m01+m10)/s,.25*s,(m12+m21)/s,(m02-m20)/s]; } else { const s=Math.sqrt(1+m22-m00-m11)*2; q=[(m02+m20)/s,(m12+m21)/s,.25*s,(m10-m01)/s]; }
  return q;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 1e5) / 1e5;
  if (!value || typeof value !== "object") return value;
  const record = value;
  if (["x", "y", "z", "w"].every((key) => typeof record[key] === "number") && Object.keys(record).length === 4) {
    const sign = record.w < 0 || (record.w === 0 && (record.x < 0 || (record.x === 0 && (record.y < 0 || (record.y === 0 && record.z < 0))))) ? -1 : 1;
    return { w: canonical(record.w * sign), x: canonical(record.x * sign), y: canonical(record.y * sign), z: canonical(record.z * sign) };
  }
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
}
const semanticallyEqual = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
function assertSupported(stage, snapshot, camera) {
  if (stage?.schemaVersion !== 2 || stage.coordinateFrame?.handedness !== "right" || stage.coordinateFrame?.upAxis !== "y" || stage.coordinateFrame?.unit !== "metre" || JSON.stringify(stage.coordinateFrame?.origin) !== "[0,0,0]" || JSON.stringify(stage.coordinateFrame?.forward) !== "[0,0,-1]" || stage.coordinateFrame?.scaleMode !== "metric") fail("coordinate_frame_unsupported");
  if (!Array.isArray(stage.environment?.sources) || stage.environment.sources.some((source) => source?.kind !== "empty_stage")) fail("environment_unsupported");
  if ((stage.constraints ?? []).length || (snapshot.constraintIds ?? []).length) fail("constraints_unsupported");
  if (!camera || !Array.isArray(stage.entities)) fail("stage_invalid");
  if ((camera.panoramaYaw ?? 0) !== 0 || (camera.panoramaPitch ?? 0) !== 0) fail("panorama_unsupported");
  const stateIds = (snapshot.entityStates ?? []).map((state) => state?.entityId);
  const entityIds = stage.entities.map((entity) => entity?.id);
  if (!sameIds(stateIds, entityIds) || new Set(stateIds).size !== stateIds.length) fail("snapshot_entities_invalid");
  for (const entity of stage.entities) {
    if (!entity?.id || entity.rig || entity.visibility !== "visible" || snapshot.entityStates.find((item) => item.entityId === entity.id)?.visibility !== "visible") fail(entity?.rig ? `rig_unsupported:${entity.id}` : `entity_invalid:${entity?.id ?? ""}`);
    if (!PRIMITIVES.has(entity.geometry?.kind)) fail(`geometry_unsupported:${entity.id}`);
    const role = roleOf(entity);
    if (role === "subject") fail(`subject_pose_supplement_required:${entity.id}`);
    if (!ROLES.has(role)) fail(`role_unsupported:${entity.id}`);
    const state = snapshot.entityStates.find((item) => item.entityId === entity.id);
    if (state?.pose) fail(`pose_unsupported:${entity.id}`);
    transform(state, entity.id);
  }
}

/** Converts only the lossless primitive/no-rig SceneStage subset. */
export function fromSceneStage(stage, { snapshotId, cameraId, stageDigest } = {}) {
  if (!snapshotId) fail("snapshotId_explicit_required");
  if (!cameraId) fail("cameraId_explicit_required");
  if (!/^[a-f0-9]{64}$/.test(stageDigest ?? "")) fail("stage_digest_invalid");
  const snapshot = stage?.snapshots?.find((item) => item.id === snapshotId);
  if (!snapshot) fail(`snapshot_missing:${snapshotId}`);
  if (snapshot.cameraId !== cameraId) fail("snapshot_camera_mismatch");
  const camera = stage?.cameras?.find((item) => item.id === cameraId);
  if (!camera) fail(`camera_missing:${cameraId}`);
  assertSupported(stage, snapshot, camera);
  const stageCameraRotation = cameraRotation(toVector(camera.position), toVector(camera.target));
  if (!stageCameraRotation || !semanticallyEqual(camera.rotation, stageCameraRotation)) fail("camera_roll_unsupported");
  const entities = stage.entities.map((entity) => {
    const state = snapshot.entityStates.find((item) => item.entityId === entity.id);
    const current = transform(state, entity.id);
    return {
      id: entity.id, label: entity.label, role: roleOf(entity), ...current,
      parts: [{ id: `${entity.id}-primitive`, kind: entity.geometry.kind, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, size: primitiveSize(entity.geometry, entity.id), color: [0.55, 0.65, 0.75] }],
      joints: [], bones: [], attachments: (entity.attachments ?? []).map((attachment) => ({ id: attachment.id, jointId: "", position: toVector(attachment.localTransform.position) }))
    };
  });
  const exchange = {
    schemaVersion: 1, coordinateSystem: "RH_Y_UP_METRES", id: stage.sceneId, label: stage.sceneId,
    source: { stageId: stage.id, stageRevision: stage.revision, stageDigest, shotId: snapshot.shotId, snapshotId, cameraId },
    camera: { position: toVector(camera.position), target: toVector(camera.target), up: { x: 0, y: 1, z: 0 }, fov: camera.fov, near: camera.near, far: camera.far, width: 960, height: 540 },
    entities, relations: []
  };
  const report = validateExchange(exchange); if (!report.valid) fail(`exchange_invalid:${report.errors[0]?.field ?? "unknown"}`);
  return exchange;
}

/** Applies an exchanged snapshot back to a clone, retaining every unowned field. */
export function toSceneStage(original, exchange, { stageDigest } = {}) {
  const report = validateExchange(exchange); if (!report.valid) fail(`exchange_invalid:${report.errors[0]?.field ?? "unknown"}`);
  if (!/^[a-f0-9]{64}$/.test(stageDigest ?? "")) fail("stage_digest_invalid");
  if (exchange.source.stageId !== original?.id || exchange.source.stageRevision !== original?.revision || exchange.source.stageDigest !== stageDigest) fail("stage_stale");
  const snapshot = original.snapshots?.find((item) => item.id === exchange.source.snapshotId);
  if (!snapshot) fail("snapshot_stale");
  if (snapshot.cameraId !== exchange.source.cameraId) fail("camera_stale");
  if (snapshot.shotId !== exchange.source.shotId) fail("shot_stale");
  const camera = original.cameras?.find((item) => item.id === exchange.source.cameraId);
  if (!camera) fail("camera_stale");
  assertSupported(original, snapshot, camera);
  const originalIds = original.entities.map((entity) => entity.id);
  const exchangeIds = exchange.entities.map((entity) => entity.id);
  if (!sameIds(originalIds, exchangeIds) || new Set(exchangeIds).size !== exchangeIds.length) fail("entities_stale");
  const baseline = fromSceneStage(original, { snapshotId: exchange.source.snapshotId, cameraId: exchange.source.cameraId, stageDigest });
  const immutableEntity = ({ position, rotation, scale, ...rest }) => rest;
  if (!semanticallyEqual({ id: exchange.id, label: exchange.label, source: exchange.source }, { id: baseline.id, label: baseline.label, source: baseline.source })) fail("immutable_changed");
  for (const entity of exchange.entities) {
    const expected = baseline.entities.find((item) => item.id === entity.id);
    if (!expected || !semanticallyEqual(immutableEntity(entity), immutableEntity(expected))) fail(`immutable_changed:${entity.id}`);
  }
  const { position: _position, target: _target, fov: _fov, near: _near, far: _far, ...cameraImmutable } = exchange.camera;
  const { position: __position, target: __target, fov: __fov, near: __near, far: __far, ...baselineCameraImmutable } = baseline.camera;
  if (!semanticallyEqual(cameraImmutable, baselineCameraImmutable) || !semanticallyEqual(exchange.relations, baseline.relations)) fail("immutable_changed");
  const next = structuredClone(original);
  const nextSnapshot = next.snapshots.find((item) => item.id === exchange.source.snapshotId);
  nextSnapshot.entityStates = nextSnapshot.entityStates.map((state) => {
    const entity = exchange.entities.find((item) => item.id === state.entityId);
    return { ...state, transform: { position: toTuple(entity.position), rotation: [entity.rotation.x, entity.rotation.y, entity.rotation.z, entity.rotation.w], scale: toTuple(entity.scale) } };
  });
  next.cameras = next.cameras.map((item) => item.id !== exchange.source.cameraId ? item : {
    ...item, position: toTuple(exchange.camera.position), target: toTuple(exchange.camera.target), rotation: cameraRotation(exchange.camera.position, exchange.camera.target), fov: exchange.camera.fov, near: exchange.camera.near, far: exchange.camera.far
  });
  return next;
}
