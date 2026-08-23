import type {
  Quat,
  SceneStage,
  StageCapability,
  StageCapabilityReport,
  StageEntity,
  StageEnvironmentSource,
  Transform3D,
  Vec3
} from "./types";

const MANUAL_FALLBACK_MESSAGE =
  "Automatic geometry is not configured; manual proxy stage is available.";
const MAX_PANORAMA_TEXTURE_WIDTH = 4096;
const MAX_VISIBLE_TRIANGLES = 250_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finiteInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = finiteNumber(value, fallback);
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalString(value: unknown): string | undefined {
  const normalized = stringValue(value);
  return normalized || undefined;
}

function normalizeVec3(value: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(value)) return fallback;
  return [
    finiteNumber(value[0], fallback[0]),
    finiteNumber(value[1], fallback[1]),
    finiteNumber(value[2], fallback[2])
  ];
}

function normalizeQuat(value: unknown): Quat {
  if (!Array.isArray(value)) return [0, 0, 0, 1];
  const normalized: Quat = [
    finiteNumber(value[0], 0),
    finiteNumber(value[1], 0),
    finiteNumber(value[2], 0),
    finiteNumber(value[3], 1)
  ];
  const magnitude = Math.hypot(...normalized);
  if (magnitude < Number.EPSILON) return [0, 0, 0, 1];
  return normalized.map((component) => component / magnitude) as unknown as Quat;
}

function normalizeTransform(value: unknown): Transform3D {
  const record = isRecord(value) ? value : {};
  return {
    position: normalizeVec3(record.position, [0, 0, 0]),
    rotation: normalizeQuat(record.rotation),
    scale: normalizeVec3(record.scale, [1, 1, 1])
  };
}

function manualCapability(checkedAt: string): StageCapability {
  return {
    status: "manual_fallback",
    message: MANUAL_FALLBACK_MESSAGE,
    checkedAt
  };
}

function createManualCapabilityReport(checkedAt: string): StageCapabilityReport {
  const capability = () => manualCapability(checkedAt);
  return {
    overall: "manual_fallback",
    webgl2: capability(),
    comfyui: capability(),
    mogeNode: capability(),
    mogeModel: capability(),
    panoramaConversion: capability(),
    pose: capability(),
    systemMemory: capability(),
    gpuMemory: capability()
  };
}

function normalizeEnvironmentSource(value: unknown): StageEnvironmentSource | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "empty_stage":
      return { kind: "empty_stage" };
    case "panorama": {
      const assetId = stringValue(value.assetId);
      if (!assetId) return null;
      return {
        kind: "panorama",
        assetId,
        ...(optionalString(value.filePath) ? { filePath: optionalString(value.filePath) } : {}),
        maxTextureWidth: finiteInteger(
          value.maxTextureWidth,
          MAX_PANORAMA_TEXTURE_WIDTH,
          1,
          MAX_PANORAMA_TEXTURE_WIDTH
        )
      };
    }
    case "depth_mesh": {
      const filePath = stringValue(value.filePath);
      if (!filePath) return null;
      return {
        kind: "depth_mesh",
        filePath,
        triangleCount: finiteInteger(value.triangleCount, 0, 0, MAX_VISIBLE_TRIANGLES)
      };
    }
    case "depth_map": {
      const depthUrl = stringValue(value.depthUrl);
      const promptId = stringValue(value.promptId);
      if (!depthUrl || !promptId) return null;
      return {
        kind: "depth_map",
        depthUrl,
        ...(optionalString(value.normalUrl) ? { normalUrl: optionalString(value.normalUrl) } : {}),
        ...(optionalString(value.maskUrl) ? { maskUrl: optionalString(value.maskUrl) } : {}),
        promptId,
        width: finiteInteger(value.width, 1920, 1, 8192),
        height: finiteInteger(value.height, 960, 1, 8192)
      };
    }
    case "imported_mesh": {
      const filePath = stringValue(value.filePath);
      if (!filePath) return null;
      const triangleCount = value.triangleCount == null
        ? undefined
        : finiteInteger(value.triangleCount, 0, 0, MAX_VISIBLE_TRIANGLES);
      return {
        kind: "imported_mesh",
        filePath,
        ...(triangleCount == null ? {} : { triangleCount })
      };
    }
    case "procedural":
      return ["ground", "room", "wall", "stairs"].includes(String(value.primitive))
        ? { kind: "procedural", primitive: value.primitive as "ground" | "room" | "wall" | "stairs" }
        : null;
    case "cards":
      return {
        kind: "cards",
        assetIds: Array.isArray(value.assetIds)
          ? value.assetIds.map((item) => stringValue(item)).filter(Boolean)
          : []
      };
    default:
      return null;
  }
}

function normalizeEntity(value: unknown): StageEntity | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  if (!id) return null;
  const geometry = isRecord(value.geometry) ? value.geometry : {};
  const kind = ["box", "capsule", "sphere", "plane"].includes(String(geometry.kind))
    ? geometry.kind as StageEntity["geometry"]["kind"]
    : "box";
  return {
    id,
    ...(optionalString(value.assetId) ? { assetId: optionalString(value.assetId) } : {}),
    label: stringValue(value.label, id),
    tags: Array.isArray(value.tags) ? value.tags.map((item) => stringValue(item)).filter(Boolean) : [],
    transform: normalizeTransform(value.transform),
    geometry: {
      kind,
      size: normalizeVec3(geometry.size, [1, 1, 1])
    },
    visibility: value.visibility === "hidden" ? "hidden" : "visible",
    metadata: isRecord(value.metadata) ? value.metadata : {}
  };
}

export function createEmptySceneStage(
  sceneId: string,
  now = new Date().toISOString()
): SceneStage {
  const normalizedSceneId = stringValue(sceneId, "unbound_scene");
  return {
    schemaVersion: 1,
    id: `stage_${normalizedSceneId}`,
    sceneId: normalizedSceneId,
    revision: 1,
    coordinateFrame: {
      handedness: "right",
      upAxis: "y",
      unit: "metre",
      origin: [0, 0, 0],
      forward: [0, 0, -1],
      groundY: 0,
      scaleMode: "relative"
    },
    environment: { sources: [{ kind: "empty_stage" }] },
    entities: [],
    constraints: [],
    cameras: [],
    snapshots: [],
    capabilities: createManualCapabilityReport(now),
    sourceDigest: "",
    updatedAt: now
  };
}

export function normalizeSceneStage(value: unknown): SceneStage | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const id = stringValue(value.id);
  const sceneId = stringValue(value.sceneId);
  if (!id || !sceneId) return null;
  const coordinateFrame = isRecord(value.coordinateFrame) ? value.coordinateFrame : {};
  const environment = isRecord(value.environment) ? value.environment : {};
  const sources = Array.isArray(environment.sources)
    ? environment.sources.map(normalizeEnvironmentSource).filter((item): item is StageEnvironmentSource => Boolean(item))
    : [];
  const entities = Array.isArray(value.entities)
    ? value.entities.map(normalizeEntity).filter((item): item is StageEntity => Boolean(item))
    : [];
  const updatedAt = stringValue(value.updatedAt, new Date(0).toISOString());

  return {
    schemaVersion: 1,
    id,
    sceneId,
    revision: finiteInteger(value.revision, 1, 1, Number.MAX_SAFE_INTEGER),
    coordinateFrame: {
      handedness: "right",
      upAxis: "y",
      unit: "metre",
      origin: normalizeVec3(coordinateFrame.origin, [0, 0, 0]),
      forward: normalizeVec3(coordinateFrame.forward, [0, 0, -1]),
      groundY: finiteNumber(coordinateFrame.groundY, 0),
      scaleMode: coordinateFrame.scaleMode === "metric" ? "metric" : "relative"
    },
    environment: { sources: sources.length > 0 ? sources : [{ kind: "empty_stage" }] },
    entities,
    constraints: Array.isArray(value.constraints) ? value.constraints as SceneStage["constraints"] : [],
    cameras: Array.isArray(value.cameras) ? value.cameras as SceneStage["cameras"] : [],
    snapshots: Array.isArray(value.snapshots) ? value.snapshots as SceneStage["snapshots"] : [],
    capabilities: isRecord(value.capabilities)
      ? value.capabilities as unknown as StageCapabilityReport
      : createManualCapabilityReport(updatedAt),
    sourceDigest: stringValue(value.sourceDigest),
    updatedAt
  };
}

export function normalizeSceneStages(value: unknown): SceneStage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeSceneStage)
    .filter((stage): stage is SceneStage => Boolean(stage));
}
