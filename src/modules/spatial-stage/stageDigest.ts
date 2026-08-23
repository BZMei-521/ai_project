import type { SceneStage } from "./types";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  );
}

export function canonicalStageSource(stage: SceneStage): string {
  return JSON.stringify(canonicalize({
    coordinateFrame: stage.coordinateFrame,
    environment: stage.environment,
    entities: stage.entities.map((entity) => ({
      id: entity.id,
      assetId: entity.assetId,
      transform: entity.transform,
      geometry: entity.geometry,
      visibility: entity.visibility
    }))
  }));
}

export function computeStageSourceDigest(stage: SceneStage): string {
  const source = canonicalStageSource(stage);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function isStageSourceStale(stage: SceneStage): boolean {
  return stage.sourceDigest !== computeStageSourceDigest(stage);
}
