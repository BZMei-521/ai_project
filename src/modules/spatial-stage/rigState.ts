import type {
  AttachmentPoint,
  PoseSnapshot,
  Quat,
  RigBinding,
  StageEntity,
  Transform3D,
  Vec3
} from "./types";
import type { PoseKeyframe, SpatialObject, SpatialVector3 } from "../../domains/spatial-scene/types";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function vector(value: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(value)) return fallback;
  return [finite(value[0], fallback[0]), finite(value[1], fallback[1]), finite(value[2], fallback[2])];
}

function quaternion(value: unknown): Quat {
  const source = vector(value, [0, 0, 0]);
  const w = Array.isArray(value) ? finite(value[3], 1) : 1;
  const magnitude = Math.hypot(source[0], source[1], source[2], w);
  if (magnitude < Number.EPSILON) return [0, 0, 0, 1];
  return [source[0] / magnitude, source[1] / magnitude, source[2] / magnitude, w / magnitude];
}

function transform(value: unknown): Transform3D {
  const source = record(value);
  return {
    position: vector(source.position, [0, 0, 0]),
    rotation: quaternion(source.rotation),
    scale: vector(source.scale, [1, 1, 1])
  };
}

export function normalizeRigBinding(value: unknown): RigBinding {
  const source = record(value);
  const kind = ["humanoid", "quadruped", "rigid_chain", "custom"].includes(String(source.kind))
    ? source.kind as RigBinding["kind"]
    : "custom";
  const joints = record(source.joints);
  return {
    kind,
    joints: Object.fromEntries(Object.entries(joints)
      .filter(([, target]) => typeof target === "string" && target.trim())
      .map(([name, target]) => [name.trim(), String(target).trim()]))
  };
}

export function normalizeAttachmentPoints(value: unknown): AttachmentPoint[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const points: AttachmentPoint[] = [];
  for (const item of value) {
    const source = record(item);
    const id = text(source.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    points.push({ id, label: text(source.label, id), localTransform: transform(source.localTransform) });
  }
  return points;
}

export function normalizePoseSnapshot(value: unknown): PoseSnapshot | null {
  const source = record(value);
  if (!source.rootTransform) return null;
  const sourceKind = ["auto_pose", "previous_snapshot", "manual", "imported"].includes(String(source.source))
    ? source.source as PoseSnapshot["source"]
    : "manual";
  const jointRotations: Record<string, Quat> = {};
  for (const [name, rotation] of Object.entries(record(source.jointRotations))) {
    jointRotations[name] = quaternion(rotation);
  }
  const contacts = Array.isArray(source.contacts)
    ? source.contacts.map((item) => {
        const contact = record(item);
        return {
          attachmentId: text(contact.attachmentId),
          ...(text(contact.targetEntityId) ? { targetEntityId: text(contact.targetEntityId) } : {}),
          ...(text(contact.targetAttachmentId) ? { targetAttachmentId: text(contact.targetAttachmentId) } : {})
        };
      }).filter((item) => item.attachmentId)
    : [];
  return {
    rootTransform: transform(source.rootTransform),
    jointRotations,
    contacts,
    source: sourceKind,
    confidence: Math.min(1, Math.max(0, finite(source.confidence, 1)))
  };
}

function vectorObject(value: Vec3): SpatialVector3 {
  return { x: value[0], y: value[1], z: value[2] };
}

function quaternionToEuler(value: Quat): SpatialVector3 {
  const [x, y, z, w] = value;
  const sinr = 2 * (w * x + y * z);
  const cosr = 1 - 2 * (x * x + y * y);
  const sinp = 2 * (w * y - z * x);
  const siny = 2 * (w * z + x * y);
  const cosy = 1 - 2 * (y * y + z * z);
  return {
    x: Math.atan2(sinr, cosr),
    y: Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp),
    z: Math.atan2(siny, cosy)
  };
}

export function toSpatialObject(entity: StageEntity, _sceneId: string): SpatialObject {
  const objectKind: SpatialObject["objectKind"] = entity.tags.includes("environment")
    ? "environment"
    : entity.tags.includes("prop")
      ? "prop"
      : entity.rig
        ? "character"
        : "custom";
  return {
    id: entity.id,
    label: entity.label,
    objectKind,
    assetId: entity.assetId,
    position: vectorObject(entity.transform.position),
    rotation: quaternionToEuler(entity.transform.rotation),
    scale: vectorObject(entity.transform.scale),
    visibility: entity.visibility,
    metadata: {
      ...entity.metadata,
      rigKind: entity.rig?.kind ?? null,
      attachmentIds: JSON.stringify((entity.attachments ?? []).map((point) => point.id))
    }
  };
}

export function toPoseKeyframe(pose: PoseSnapshot, objectId: string, time: number): PoseKeyframe {
  const normalized = normalizePoseSnapshot(pose) ?? pose;
  return {
    id: `${objectId}_pose_${time}`,
    objectId,
    time: finite(time, 0),
    position: vectorObject(normalized.rootTransform.position),
    rotation: quaternionToEuler(normalized.rootTransform.rotation),
    scale: vectorObject(normalized.rootTransform.scale),
    easing: "linear"
  };
}
