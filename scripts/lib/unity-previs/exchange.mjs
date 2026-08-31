import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { inflateSync } from "node:zlib";

const HEX64 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ROLES = new Set(["environment", "subject", "interaction", "foreground_occluder"]);
const SHAPES = new Set(["box", "sphere", "capsule", "cylinder"]);
const RELATIONS = new Set(["contact", "inside", "gaze"]);
const HANDS = new Set(["none", "left", "right"]);
const ARTIFACTS = new Set(["color", "depth", "normal", "visible_mask", "isolated_mask", "openpose", "hand_pose", "orientation", "contact_map"]);
const ENCODINGS = new Set(["srgb_rgb8", "linear_eye_near_white_8bit", "rh_view_normal_rgb8", "binary_visible_8bit", "binary_isolated_8bit", "openpose_body18_rgb8", "openpose_hand21_rgb8", "head_forward_orientation_rgb8", "contact_diagnostic_rgb8"]);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const safeId = (value) => typeof value === "string" && SAFE_ID.test(value);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const issue = (errors, field, message, entity = "scene") => errors.push({ entity, field, message });
const unknown = (value, allowed, field, errors, entity) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value)) if (!allowed.has(key)) issue(errors, `${field}.${key}`, "unsupported field", entity);
};

function vector(value, field, errors, entity, quaternion = false, maxAbs = 10000) {
  const keys = quaternion ? ["x", "y", "z", "w"] : ["x", "y", "z"];
  if (!value || typeof value !== "object" || Array.isArray(value)) { issue(errors, field, "must be an object", entity); return; }
  unknown(value, new Set(keys), field, errors, entity);
  for (const key of keys) if (!finite(value[key]) || Math.abs(value[key]) > maxAbs) issue(errors, `${field}.${key}`, "must be a bounded finite number", entity);
  if (quaternion && keys.every((key) => finite(value[key]))) {
    const magnitude = Math.hypot(...keys.map((key) => value[key]));
    if (Math.abs(magnitude - 1) > 0.001) issue(errors, field, "must be a unit quaternion", entity);
  }
}

function collection(value, field, errors, entity) {
  if (!Array.isArray(value)) { issue(errors, field, "must be an array", entity); return false; }
  return true;
}

export function validateExchange(scene) {
  const errors = [];
  if (!scene || typeof scene !== "object" || Array.isArray(scene)) return { valid: false, errors: [{ entity: "scene", field: "scene", message: "must be an object" }] };
  unknown(scene, new Set(["schemaVersion", "coordinateSystem", "id", "label", "source", "camera", "environment", "entities", "relations"]), "scene", errors, "scene");
  if (scene.schemaVersion !== 1) issue(errors, "schemaVersion", "must equal 1");
  if (scene.coordinateSystem !== "RH_Y_UP_METRES") issue(errors, "coordinateSystem", "must equal RH_Y_UP_METRES");
  if (!safeId(scene.id)) issue(errors, "id", "must be an ASCII-safe identifier of at most 128 characters");
  if (!text(scene.label)) issue(errors, "label", "must be a non-empty string");
  const sourceKeys = new Set(["stageId", "stageRevision", "stageDigest", "shotId", "snapshotId", "cameraId"]);
  if (!scene.source || typeof scene.source !== "object" || Array.isArray(scene.source)) issue(errors, "source", "must be an object");
  else {
    unknown(scene.source, sourceKeys, "source", errors, "scene");
    for (const field of ["stageId", "shotId", "snapshotId", "cameraId"]) if (!safeId(scene.source[field])) issue(errors, `source.${field}`, "must be an ASCII-safe identifier of at most 128 characters");
    if (!Number.isInteger(scene.source.stageRevision) || scene.source.stageRevision < 0) issue(errors, "source.stageRevision", "must be a non-negative integer");
    if (!HEX64.test(scene.source.stageDigest)) issue(errors, "source.stageDigest", "must be a SHA-256 hex digest");
  }
  const environmentKeys = new Set(["panoramaPath", "panoramaSha256", "projection", "anchor", "yawDegrees", "geometryAuthority"]);
  if (scene.environment !== undefined && (!scene.environment || typeof scene.environment !== "object" || Array.isArray(scene.environment))) issue(errors, "environment", "must be an object");
  else if (scene.environment) {
    unknown(scene.environment, environmentKeys, "environment", errors, "scene");
    if (!text(scene.environment.panoramaPath)) issue(errors, "environment.panoramaPath", "must be a non-empty path");
    if (!HEX64.test(scene.environment.panoramaSha256)) issue(errors, "environment.panoramaSha256", "must be a SHA-256 hex digest");
    if (scene.environment.projection !== "equirectangular_world_anchor") issue(errors, "environment.projection", "must equal equirectangular_world_anchor");
    vector(scene.environment.anchor, "environment.anchor", errors, "environment");
    if (!finite(scene.environment.yawDegrees) || Math.abs(scene.environment.yawDegrees) > 360) issue(errors, "environment.yawDegrees", "must be within -360 and 360");
    if (scene.environment.geometryAuthority !== false) issue(errors, "environment.geometryAuthority", "must remain false");
  }
  const cameraKeys = new Set(["position", "target", "up", "fov", "near", "far", "width", "height"]);
  if (!scene.camera || typeof scene.camera !== "object" || Array.isArray(scene.camera)) issue(errors, "camera", "must be an object");
  else {
    unknown(scene.camera, cameraKeys, "camera", errors, "scene");
    for (const field of ["position", "target", "up"]) vector(scene.camera[field], `camera.${field}`, errors, "camera");
    if (!finite(scene.camera.fov) || scene.camera.fov <= 1 || scene.camera.fov >= 179) issue(errors, "camera.fov", "must be between 1 and 179");
    if (!finite(scene.camera.near) || !finite(scene.camera.far) || scene.camera.near <= 0 || scene.camera.far <= scene.camera.near || scene.camera.far > 100000) issue(errors, "camera.near", "must be positive and less than bounded camera.far");
    for (const field of ["width", "height"]) if (!Number.isInteger(scene.camera[field]) || scene.camera[field] < 16 || scene.camera[field] > 4096) issue(errors, `camera.${field}`, "must be an integer from 16 to 4096");
    const delta = scene.camera.target && scene.camera.position ? { x: scene.camera.target.x - scene.camera.position.x, y: scene.camera.target.y - scene.camera.position.y, z: scene.camera.target.z - scene.camera.position.z } : null;
    if (!delta || !finite(delta.x) || Math.hypot(delta.x, delta.y, delta.z) < 1e-5) issue(errors, "camera.target", "must differ from camera.position");
    else if (scene.camera.up && Math.hypot(delta.y * scene.camera.up.z - delta.z * scene.camera.up.y, delta.z * scene.camera.up.x - delta.x * scene.camera.up.z, delta.x * scene.camera.up.y - delta.y * scene.camera.up.x) < 1e-5) issue(errors, "camera.up", "must not be parallel to view direction");
  }
  const ids = new Set();
  if (collection(scene.entities, "entities", errors, "scene")) { if (!scene.entities.length || scene.entities.length > 256) issue(errors, "entities", "must contain 1 to 256 entities"); scene.entities.forEach((entity, index) => validateEntity(entity, index, errors, ids)); }
  if (collection(scene.relations, "relations", errors, "scene")) scene.relations.forEach((relation, index) => validateRelation(relation, index, errors, scene.entities, ids));
  return { valid: errors.length === 0, errors };
}

function validateEntity(entity, index, errors, ids) {
  const field = `entities[${index}]`; const entityId = text(entity?.id) ? entity.id.trim() : `#${index}`;
  if (!entity || typeof entity !== "object" || Array.isArray(entity)) { issue(errors, field, "must be an object", entityId); return; }
  unknown(entity, new Set(["id", "label", "role", "position", "rotation", "scale", "parts", "joints", "bones", "attachments"]), field, errors, entityId);
  if (!safeId(entity.id) || ids.has(entityId)) issue(errors, `${field}.id`, "must be a unique ASCII-safe identifier", entityId); else ids.add(entityId);
  if (!text(entity.label)) issue(errors, `${field}.label`, "must be a non-empty string", entityId);
  if (!ROLES.has(entity.role)) issue(errors, `${field}.role`, "unsupported role", entityId);
  vector(entity.position, `${field}.position`, errors, entityId); vector(entity.rotation, `${field}.rotation`, errors, entityId, true); vector(entity.scale, `${field}.scale`, errors, entityId, false, 100);
  if (entity.scale && ["x", "y", "z"].some((key) => !finite(entity.scale[key]) || entity.scale[key] <= 0)) issue(errors, `${field}.scale`, "must be strictly positive", entityId);
  const jointIds = new Set(); const partIds = new Set(); const attachmentIds = new Set();
  if (collection(entity.parts, `${field}.parts`, errors, entityId)) entity.parts.forEach((part, partIndex) => {
    const p = `${field}.parts[${partIndex}]`; if (!part || typeof part !== "object") return issue(errors, p, "must be an object", entityId);
    unknown(part, new Set(["id", "kind", "position", "rotation", "size", "color"]), p, errors, entityId);
    if (!safeId(part.id) || partIds.has(part.id)) issue(errors, `${p}.id`, "must be a unique ASCII-safe identifier", entityId); else partIds.add(part.id); if (!SHAPES.has(part.kind)) issue(errors, `${p}.kind`, "unsupported shape", entityId);
    vector(part.position, `${p}.position`, errors, entityId); vector(part.rotation, `${p}.rotation`, errors, entityId, true); vector(part.size, `${p}.size`, errors, entityId, false, 1000);
    if (part.size && ["x", "y", "z"].some((key) => !finite(part.size[key]) || part.size[key] <= 0)) issue(errors, `${p}.size`, "must be strictly positive", entityId);
    if (!Array.isArray(part.color) || part.color.length !== 3 || part.color.some((v) => !finite(v) || v < 0 || v > 1)) issue(errors, `${p}.color`, "must be an RGB float array", entityId);
  });
  if (collection(entity.joints, `${field}.joints`, errors, entityId)) entity.joints.forEach((joint, jointIndex) => {
    const p = `${field}.joints[${jointIndex}]`; if (!joint || typeof joint !== "object") return issue(errors, p, "must be an object", entityId);
    unknown(joint, new Set(["id", "parentId", "position", "rotation", "radius", "openPoseIndex", "hand", "handIndex"]), p, errors, entityId);
    if (!safeId(joint.id) || jointIds.has(joint.id)) issue(errors, `${p}.id`, "must be unique and ASCII-safe", entityId); else jointIds.add(joint.id);
    if (typeof joint.parentId !== "string") issue(errors, `${p}.parentId`, "must be a string", entityId);
    vector(joint.position, `${p}.position`, errors, entityId); vector(joint.rotation, `${p}.rotation`, errors, entityId, true);
    if (!finite(joint.radius) || joint.radius <= 0 || joint.radius > 100) issue(errors, `${p}.radius`, "must be positive and <= 100", entityId);
    for (const key of ["openPoseIndex", "handIndex"]) if (!Number.isInteger(joint[key]) || joint[key] < -1) issue(errors, `${p}.${key}`, "must be an integer >= -1", entityId);
    if (!(joint.hand === "" || HANDS.has(joint.hand))) issue(errors, `${p}.hand`, "must be empty, none, left, or right", entityId);
  });
  const joints = Array.isArray(entity.joints) ? entity.joints : [];
  const parent = new Map(joints.filter((j) => text(j?.id)).map((j) => [j.id, j.parentId]));
  for (const [jointId, parentId] of parent) {
    if (parentId && !parent.has(parentId)) issue(errors, `${field}.joints`, `parent ${parentId} does not exist`, entityId);
    const seen = new Set(); let cursor = jointId;
    while (parent.get(cursor)) { cursor = parent.get(cursor); if (seen.has(cursor)) { issue(errors, `${field}.joints`, "joint parent cycle", entityId); break; } seen.add(cursor); }
  }
  if (collection(entity.bones, `${field}.bones`, errors, entityId)) entity.bones.forEach((bone, boneIndex) => {
    const p = `${field}.bones[${boneIndex}]`; if (!bone || typeof bone !== "object") return issue(errors, p, "must be an object", entityId);
    if (!text(bone.from) || !jointIds.has(bone.from) || !text(bone.to) || !jointIds.has(bone.to) || bone.from === bone.to) issue(errors, p, "must reference two distinct joints", entityId);
    if (!finite(bone.radius) || bone.radius <= 0) issue(errors, `${p}.radius`, "must be positive", entityId);
  });
  if (collection(entity.attachments, `${field}.attachments`, errors, entityId)) entity.attachments.forEach((attachment, attachmentIndex) => {
    const p = `${field}.attachments[${attachmentIndex}]`; if (!attachment || typeof attachment !== "object") return issue(errors, p, "must be an object", entityId);
    if (!safeId(attachment.id) || attachmentIds.has(attachment.id)) issue(errors, `${p}.id`, "must be unique and ASCII-safe", entityId); else attachmentIds.add(attachment.id); if (typeof attachment.jointId !== "string" || (attachment.jointId && !jointIds.has(attachment.jointId))) issue(errors, `${p}.jointId`, "must reference a joint or be empty", entityId); vector(attachment.position, `${p}.position`, errors, entityId);
  });
  if (entity.role === "subject") {
    const validJoints = joints.filter((joint) => joint && typeof joint === "object");
    const body = validJoints.map((joint) => joint.openPoseIndex).filter((value) => value >= 0);
    if (body.length !== 18 || new Set(body).size !== 18 || body.some((value) => value > 17)) issue(errors, `${field}.joints`, "subject must map body indexes 0 through 17 exactly once", entityId);
    for (const hand of ["left", "right"]) {
      const mapped = validJoints.filter((joint) => joint.hand === hand).map((joint) => joint.handIndex);
      if (mapped.length !== 21 || new Set(mapped).size !== 21 || mapped.some((value) => value < 0 || value > 20)) issue(errors, `${field}.joints`, `subject must map ${hand} hand indexes 0 through 20 exactly once`, entityId);
    }
    for (const joint of validJoints) if ((joint.hand === "" || joint.hand === "none") && joint.handIndex !== -1) issue(errors, `${field}.joints`, "unmapped hand must use handIndex -1", entityId);
  }
}

function validateRelation(relation, index, errors, entities, ids) {
  const field = `relations[${index}]`; if (!relation || typeof relation !== "object" || Array.isArray(relation)) return issue(errors, field, "must be an object");
  unknown(relation, new Set(["kind", "subjectId", "targetId", "attachmentId", "targetPoint", "tolerance", "interiorMin", "interiorMax"]), field, errors, "relation");
  if (!RELATIONS.has(relation.kind)) issue(errors, `${field}.kind`, "unsupported relation", "relation");
  for (const key of ["subjectId", "targetId"]) if (!text(relation[key]) || !ids.has(relation[key])) issue(errors, `${field}.${key}`, "must reference an entity", "relation");
  if (relation.subjectId === relation.targetId) issue(errors, field, "subject and target must differ", "relation");
  const subject = Array.isArray(entities) ? entities.find((entity) => entity?.id === relation.subjectId) : undefined;
  if (relation.kind === "contact") {
    if (!text(relation.attachmentId) || !Array.isArray(subject?.attachments) || !subject.attachments.some((attachment) => attachment?.id === relation.attachmentId)) issue(errors, `${field}.attachmentId`, "must reference a subject attachment", "relation");
    vector(relation.targetPoint, `${field}.targetPoint`, errors, "relation"); if (!finite(relation.tolerance) || relation.tolerance < 0 || relation.tolerance > 10) issue(errors, `${field}.tolerance`, "must be from 0 to 10", "relation");
  }
  if (relation.kind === "inside") { vector(relation.interiorMin, `${field}.interiorMin`, errors, "relation"); vector(relation.interiorMax, `${field}.interiorMax`, errors, "relation"); }
}

export const reflectPosition = ({ x, y, z }) => ({ x, y, z: -z });
export const reflectQuaternion = ({ x, y, z, w }) => ({ x: -x, y: -y, z, w });

function normalized(value, key = "") {
  if (Array.isArray(value)) return value.map(normalized);
  if (finite(value)) return Math.round(value * 1e5) / 1e5;
  if (key === "hand" && value === "") return "none";
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([entryKey, item]) => [entryKey, normalized(item, entryKey)]));
}

export function sceneDigest(scene) {
  const result = validateExchange(scene); if (!result.valid) throw new TypeError(`unity_previs_scene_invalid:${result.errors.map((error) => error.field).join(",")}`);
  return hash(Buffer.from(JSON.stringify(normalized(scene)), "utf8"));
}

function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function pngInfo(bytes) {
  if (bytes.length < 57 || !Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("png_signature_invalid");
  let offset = 8; let ihdr; let idat = []; let ended = false;
  while (offset < bytes.length) { if (offset + 12 > bytes.length) throw new Error("png_chunk_truncated"); const length = bytes.readUInt32BE(offset); const end = offset + 12 + length; if (end > bytes.length) throw new Error("png_chunk_truncated"); const type = bytes.toString("ascii", offset + 4, offset + 8); const data = bytes.subarray(offset + 8, offset + 8 + length); if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) throw new Error("png_crc_invalid"); if (ended) throw new Error("png_after_iend"); if (type === "IHDR") { if (ihdr || length !== 13) throw new Error("png_ihdr_invalid"); ihdr = data; } else if (type === "IDAT") { if (!ihdr) throw new Error("png_order_invalid"); idat.push(data); } else if (type === "IEND") { if (length !== 0 || !idat.length) throw new Error("png_iend_invalid"); ended = true; if (end !== bytes.length) throw new Error("png_trailing_data"); } else if (!/^[a-z]{4}$/.test(type)) throw new Error("png_chunk_unsupported"); offset = end; }
  if (!ihdr || !ended) throw new Error("png_incomplete"); const width = ihdr.readUInt32BE(0); const height = ihdr.readUInt32BE(4); const depth = ihdr[8]; const color = ihdr[9]; if (!width || !height || depth !== 8 || ![0, 2, 4, 6].includes(color) || ihdr[10] || ihdr[11] || ihdr[12]) throw new Error("png_format_unsupported"); const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[color]; const raw = inflateSync(Buffer.concat(idat)); if (raw.length !== height * (1 + width * channels)) throw new Error("png_data_invalid"); for (let row = 0; row < raw.length; row += 1 + width * channels) if (raw[row] > 4) throw new Error("png_filter_invalid"); return { width, height };
}

function safeBasename(value) { return text(value) && basename(value) === value && !value.includes("/") && !value.includes("\\") && !value.includes("..") ? value : ""; }
export async function validateExport(directory, expectedScene) {
  const errors = []; const add = (field, message) => errors.push({ entity: "export", field, message }); let manifest;
  try { manifest = JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8")); } catch { return { valid: false, errors: [{ entity: "export", field: "manifest.json", message: "missing or invalid" }] }; }
  if (manifest?.schemaVersion !== 1) add("manifest.schemaVersion", "must equal 1");
  for (const key of ["sceneFile", "preflightFile"]) if (!safeBasename(manifest?.[key])) add(`manifest.${key}`, "must be a relative basename");
  if (errors.length) return { valid: false, errors };
  let sceneBytes; try { sceneBytes = await readFile(resolve(directory, manifest.sceneFile)); } catch { add("sceneFile", "cannot read scene"); }
  if (sceneBytes && (!HEX64.test(manifest.sceneSha256) || hash(sceneBytes) !== manifest.sceneSha256)) add("sceneSha256", "does not match exact scene bytes");
  let exportedScene; try { exportedScene = JSON.parse(sceneBytes.toString("utf8")); } catch { add("sceneFile", "invalid JSON"); }
  try { if (!expectedScene || sceneDigest(exportedScene) !== sceneDigest(expectedScene)) add("scene", "semantic scene is stale"); } catch { add("scene", "semantic scene is invalid"); }
  let preflight; try { preflight = JSON.parse(await readFile(resolve(directory, manifest.preflightFile), "utf8")); } catch { add("preflightFile", "missing or invalid"); }
  if (!preflight || preflight.valid !== true || !Array.isArray(preflight.errors) || preflight.errors.length) add("preflight", "must have valid true and empty errors");
  const encodingFor = { color: "srgb_rgb8", depth: "linear_eye_near_white_8bit", normal: "rh_view_normal_rgb8", visible_mask: "binary_visible_8bit", isolated_mask: "binary_isolated_8bit", openpose: "openpose_body18_rgb8", hand_pose: "openpose_hand21_rgb8", orientation: "head_forward_orientation_rgb8", contact_map: "contact_diagnostic_rgb8" };
  const artifactList = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (!artifactList.length) add("artifacts", "must be a non-empty array");
  const artifactKeys = new Set(); const entityRoles = new Map((Array.isArray(exportedScene?.entities) ? exportedScene.entities : []).filter((entity) => entity && typeof entity === "object").map((entity) => [entity.id, entity.role]));
  for (const [index, artifact] of artifactList.entries()) { const field = `artifacts[${index}]`; const key = `${artifact?.kind}:${artifact?.entityId}`; if (artifactKeys.has(key)) add(field, "duplicate kind/entity artifact"); artifactKeys.add(key); const global = ["color", "depth", "normal"].includes(artifact?.kind) && artifact?.entityId === ""; const perEntityPass = ["color", "depth", "normal", "visible_mask", "isolated_mask", "openpose", "hand_pose", "orientation", "contact_map"].includes(artifact?.kind) && artifact?.entityId && entityRoles.has(artifact.entityId); if (!ARTIFACTS.has(artifact?.kind) || !ENCODINGS.has(artifact?.encoding) || artifact?.encoding !== encodingFor[artifact?.kind] || !safeBasename(artifact?.filePath) || !HEX64.test(artifact?.sha256) || !Number.isInteger(artifact?.width) || artifact.width !== exportedScene?.camera?.width || !Number.isInteger(artifact?.height) || artifact.height !== exportedScene?.camera?.height || typeof artifact?.entityId !== "string" || (!global && !perEntityPass)) { add(field, "invalid artifact descriptor"); continue; } try { const bytes = await readFile(resolve(directory, artifact.filePath)); if (hash(bytes) !== artifact.sha256) add(`${field}.sha256`, "does not match artifact bytes"); const info = pngInfo(bytes); if (info.width !== artifact.width || info.height !== artifact.height) add(field, "PNG dimensions do not match manifest"); } catch (error) { add(`${field}.filePath`, `invalid PNG or unreadable artifact: ${error.message}`); } }
  for (const kind of ["color", "depth", "normal"]) if (!artifactKeys.has(`${kind}:`)) add("artifacts", `global ${kind} artifact missing`);
  for (const [entityId, role] of entityRoles) {
    for (const kind of ["color", "depth", "normal"]) if (!artifactKeys.has(`${kind}:${entityId}`)) add("artifacts", `per-entity ${kind} missing:${entityId}`);
    if (!artifactKeys.has(`visible_mask:${entityId}`)) add("artifacts", `visible mask missing:${entityId}`);
    if (role === "subject") for (const kind of ["isolated_mask", "openpose", "hand_pose", "orientation", "contact_map"]) if (!artifactKeys.has(`${kind}:${entityId}`)) add("artifacts", `subject artifact missing:${kind}:${entityId}`);
  }
  return { valid: errors.length === 0, errors };
}
