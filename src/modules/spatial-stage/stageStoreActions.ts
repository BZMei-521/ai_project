import { computeStageSourceDigest } from "./stageDigest";
import type { SceneStage } from "./types";

export function addStage(stages: SceneStage[], stage: SceneStage): SceneStage[] {
  const nextStage = {
    ...stage,
    sourceDigest: computeStageSourceDigest(stage)
  };
  const existingIndex = stages.findIndex((item) => item.id === stage.id);
  if (existingIndex < 0) return [...stages, nextStage];
  return stages.map((item, index) => index === existingIndex ? nextStage : item);
}

export function patchStage(
  stages: SceneStage[],
  id: string,
  patch: Partial<SceneStage>,
  now: string
): SceneStage[] {
  return stages.map((stage) => {
    if (stage.id !== id) return stage;
    const updated: SceneStage = {
      ...stage,
      ...patch,
      schemaVersion: 2,
      id: stage.id,
      sceneId: stage.sceneId,
      revision: stage.revision + 1,
      updatedAt: now,
      sourceDigest: ""
    };
    return {
      ...updated,
      sourceDigest: computeStageSourceDigest(updated)
    };
  });
}

export function deleteStage(stages: SceneStage[], id: string): SceneStage[] {
  return stages.filter((stage) => stage.id !== id);
}
