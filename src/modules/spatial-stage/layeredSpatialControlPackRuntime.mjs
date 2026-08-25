export const LAYER_ARTIFACT_KINDS = ["color", "depth", "normal", "mask", "material_id"];
export const SKELETON_ARTIFACT_KINDS = ["openpose", "hand_pose", "contact_map"];

const HEX64 = /^[a-f0-9]{64}$/;
const LAYER_ARTIFACT_KIND_SET = new Set(LAYER_ARTIFACT_KINDS);
const SKELETON_ARTIFACT_KIND_SET = new Set(SKELETON_ARTIFACT_KINDS);
const LAYER_ROLE_SET = new Set(["environment", "subject", "interaction", "foreground_occluder", "effect"]);
const id = (value) => typeof value === "string" ? value.trim() : "";
const artifactOrder = (kinds, kind) => kinds.indexOf(kind);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
}

export function sha256Bytes(bytes) {
  const rotateRight = (value, amount) => (value >>> amount) | (value << (32 - amount));
  const maxWord = 2 ** 32;
  const words = [];
  const source = Uint8Array.from(bytes);
  const bitLength = source.length * 8;
  const hash = [];
  const constants = [];
  const composite = {};
  for (let candidate = 2, count = 0; count < 64; candidate += 1) {
    if (composite[candidate]) continue;
    for (let multiple = candidate * candidate; multiple < 313; multiple += candidate) composite[multiple] = true;
    hash[count] = (Math.sqrt(candidate) * maxWord) | 0;
    constants[count] = (candidate ** (1 / 3) * maxWord) | 0;
    count += 1;
  }
  const paddedLength = source.length + 1 + ((119 - source.length % 64) % 64) + 8;
  const padded = new Uint8Array(paddedLength);
  padded.set(source);
  padded[source.length] = 0x80;
  for (let index = 0; index < padded.length - 8; index += 1) words[index >> 2] = (words[index >> 2] ?? 0) | padded[index] << ((3 - index) % 4) * 8;
  words.push(Math.floor(bitLength / maxWord), bitLength);
  for (let offset = 0; offset < words.length; offset += 16) {
    const initial = hash.slice(0, 8);
    const schedule = words.slice(offset, offset + 16);
    let working = initial.slice();
    for (let index = 0; index < 64; index += 1) {
      if (index >= 16) {
        const x = schedule[index - 15];
        const y = schedule[index - 2];
        schedule[index] = (schedule[index - 16] + (rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3)) + schedule[index - 7] + (rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10))) | 0;
      }
      const e = working[4];
      const a = working[0];
      const first = (working[7] + (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) + ((e & working[5]) ^ (~e & working[6])) + constants[index] + schedule[index]) | 0;
      const second = ((rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) + ((a & working[1]) ^ (a & working[2]) ^ (working[1] & working[2]))) | 0;
      working = [(first + second) | 0, working[0], working[1], working[2], (working[3] + first) | 0, working[4], working[5], working[6]];
    }
    for (let index = 0; index < 8; index += 1) hash[index] = (initial[index] + working[index]) | 0;
  }
  return hash.slice(0, 8).map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

function sha256(input) {
  return sha256Bytes(new TextEncoder().encode(input));
}

function orderedArtifacts(artifacts, kinds) {
  return [...(Array.isArray(artifacts) ? artifacts : [])]
    .map((artifact) => ({ ...artifact, kind: String(artifact?.kind), filePath: id(artifact?.filePath), sha256: id(artifact?.sha256), width: Number(artifact?.width), height: Number(artifact?.height) }))
    .sort((left, right) => artifactOrder(kinds, left.kind) - artifactOrder(kinds, right.kind) || left.kind.localeCompare(right.kind));
}

function normalizeLayer(layer) {
  const layerId = id(layer?.layerId);
  return {
    layerId, order: Number(layer?.order), role: String(layer?.role),
    entityIds: [...new Set((Array.isArray(layer?.entityIds) ? layer.entityIds : []).map(id))].sort(),
    artifacts: orderedArtifacts(layer?.artifacts, LAYER_ARTIFACT_KINDS).map((artifact) => ({ ...artifact, layerId }))
  };
}

function normalizedCore(input) {
  return {
    schemaVersion: 2,
    stageId: id(input?.stageId), stageRevision: Number(input?.stageRevision), stageDigest: id(input?.stageDigest),
    shotId: id(input?.shotId), snapshotId: id(input?.snapshotId), cameraId: id(input?.cameraId), cameraDigest: id(input?.cameraDigest),
    contractDigest: id(input?.contractDigest), preflightDigest: id(input?.preflightDigest),
    layers: (Array.isArray(input?.layers) ? input.layers : []).map(normalizeLayer).sort((left, right) => left.order - right.order || left.layerId.localeCompare(right.layerId)),
    skeletonArtifacts: orderedArtifacts(input?.skeletonArtifacts, SKELETON_ARTIFACT_KINDS)
      .map((artifact) => ({ ...artifact, entityId: id(artifact.entityId) }))
      .sort((left, right) => left.entityId.localeCompare(right.entityId) || artifactOrder(SKELETON_ARTIFACT_KINDS, left.kind) - artifactOrder(SKELETON_ARTIFACT_KINDS, right.kind))
  };
}

function isValidArtifact(artifact, kinds) {
  return kinds.has(artifact?.kind) && id(artifact.filePath).length > 0 && HEX64.test(artifact.sha256) && Number.isInteger(artifact.width) && artifact.width > 0 && Number.isInteger(artifact.height) && artifact.height > 0;
}

export function createLayeredSpatialControlPack(input) {
  const core = normalizedCore(input);
  return { ...core, packDigest: sha256(JSON.stringify(canonicalize(core))) };
}

export function validateLayeredSpatialControlPack(pack, current) {
  if (!pack || pack.schemaVersion !== 2) return { valid: false, reason: "layered_control_schema_invalid" };
  for (const field of ["stageDigest", "cameraDigest", "contractDigest", "preflightDigest"]) {
    if (!HEX64.test(pack[field])) return { valid: false, reason: `layered_control_provenance_invalid:${field}` };
  }
  if (pack.stageId !== current?.stageId || pack.stageRevision !== current?.stageRevision || pack.stageDigest !== current?.stageDigest) return { valid: false, reason: "layered_control_stage_stale" };
  if (pack.shotId !== current?.shotId || pack.snapshotId !== current?.snapshotId) return { valid: false, reason: "layered_control_snapshot_stale" };
  if (pack.cameraId !== current?.cameraId || pack.cameraDigest !== current?.cameraDigest) return { valid: false, reason: "layered_control_camera_stale" };
  const layerIds = new Set();
  const subjectIds = new Set();
  let hasEnvironment = false;
  for (const layer of Array.isArray(pack.layers) ? pack.layers : []) {
    const layerId = id(layer?.layerId);
    if (!layerId || layerIds.has(layerId)) return { valid: false, reason: `layered_control_layer_duplicate:${layerId}` };
    const entityIds = Array.isArray(layer.entityIds) ? layer.entityIds.map(id) : [];
    if (!Number.isFinite(layer.order) || !LAYER_ROLE_SET.has(layer.role) || entityIds.length === 0 || entityIds.some((entityId) => !entityId) || new Set(entityIds).size !== entityIds.length) return { valid: false, reason: `layered_control_layer_invalid:${layerId}` };
    layerIds.add(layerId);
    hasEnvironment ||= layer.role === "environment";
    if (layer.role === "subject") entityIds.forEach((entityId) => subjectIds.add(entityId));
    const kinds = new Set();
    for (const artifact of Array.isArray(layer.artifacts) ? layer.artifacts : []) {
      if (artifact?.layerId !== layerId) return { valid: false, reason: `layered_control_artifact_layer_mismatch:${layerId}:${artifact?.kind ?? ""}` };
      if (kinds.has(artifact?.kind)) return { valid: false, reason: `layered_control_artifact_duplicate:${layerId}:${artifact?.kind ?? ""}` };
      kinds.add(artifact?.kind);
      if (!isValidArtifact(artifact, LAYER_ARTIFACT_KIND_SET)) return { valid: false, reason: `layered_control_artifact_invalid:${layerId}:${artifact?.kind ?? ""}` };
    }
  }
  if (!hasEnvironment) return { valid: false, reason: "layered_control_environment_missing" };
  const skeletonEntities = new Set();
  const skeletonKeys = new Set();
  for (const artifact of Array.isArray(pack.skeletonArtifacts) ? pack.skeletonArtifacts : []) {
    const entityId = id(artifact?.entityId);
    const key = `${entityId}:${artifact?.kind}`;
    if (skeletonKeys.has(key)) return { valid: false, reason: `layered_control_skeleton_duplicate:${key}` };
    skeletonKeys.add(key);
    if (!entityId || !isValidArtifact(artifact, SKELETON_ARTIFACT_KIND_SET)) return { valid: false, reason: `layered_control_skeleton_invalid:${entityId}:${artifact?.kind ?? ""}` };
    skeletonEntities.add(entityId);
  }
  for (const subjectId of subjectIds) if (!skeletonEntities.has(subjectId)) return { valid: false, reason: `layered_control_subject_skeleton_missing:${subjectId}` };
  const { packDigest, ...core } = pack;
  if (!HEX64.test(packDigest) || sha256(JSON.stringify(canonicalize(core))) !== packDigest) return { valid: false, reason: "layered_control_digest_invalid" };
  return { valid: true };
}

export function classifySpatialControlPackVersion(value) {
  if (value?.schemaVersion === 2) return "layered_v2";
  if (value?.schemaVersion === 1) return "legacy_v1";
  return "unsupported";
}
