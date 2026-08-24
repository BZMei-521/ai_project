import type { SceneStage, StageConstraint, StageStateSnapshot, Transform3D, PoseSnapshot } from "./types";
import { normalizePoseSnapshot } from "./rigState";

type EntityState = StageStateSnapshot["entityStates"][number];

export type StageSnapshotPatch = {
  entityPatches?: Record<string, Partial<Pick<EntityState, "transform" | "visibility">>>;
  posePatches?: Record<string, PoseSnapshot | null>;
  contacts?: Array<{
    attachmentId: string;
    targetEntityId?: string;
    targetAttachmentId?: string;
  }>;
  cameraId?: string;
};

export type StageSnapshotValidation = {
  valid: boolean;
  unresolved: string[];
  disabledConstraints: string[];
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function defaultPose(transform: Transform3D): PoseSnapshot {
  return {
    rootTransform: clone(transform),
    jointRotations: {},
    contacts: [],
    source: "previous_snapshot",
    confidence: 1
  };
}

function stageEntityState(stage: SceneStage): EntityState[] {
  return stage.entities.map((entity) => ({
    entityId: entity.id,
    transform: clone(entity.transform),
    visibility: entity.visibility
  }));
}

export function createShotSnapshot(
  stage: SceneStage,
  shotId: string,
  beatId: string,
  cameraId: string,
  createdAt = new Date().toISOString()
): StageStateSnapshot {
  const entityStates = stageEntityState(stage).map((state) => {
    const entity = stage.entities.find((item) => item.id === state.entityId);
    return entity?.rig
      ? { ...state, pose: defaultPose(state.transform) }
      : state;
  });
  return {
    id: `${stage.id}_${shotId}`,
    shotId,
    beatId,
    ...(cameraId ? { cameraId } : {}),
    entityStates,
    constraintIds: stage.constraints.filter((constraint) => constraint.enabled).map((constraint) => constraint.id),
    createdAt
  };
}

export function createStageSnapshot(
  stage: SceneStage,
  beatId: string,
  cameraId?: string,
  createdAt = new Date().toISOString()
): StageStateSnapshot {
  return createShotSnapshot(stage, beatId, beatId, cameraId ?? "", createdAt);
}

export function inheritShotSnapshot(
  stage: SceneStage,
  previous: StageStateSnapshot,
  shotId: string,
  beatId: string,
  patch: StageSnapshotPatch = {},
  createdAt = new Date().toISOString()
): StageStateSnapshot {
  const entityStates = previous.entityStates.map((state) => {
    const entityPatch = patch.entityPatches?.[state.entityId];
    const posePatch = patch.posePatches?.[state.entityId];
    const nextPose = posePatch === undefined
      ? state.pose
      : posePatch === null
        ? undefined
        : normalizePoseSnapshot(posePatch) ?? state.pose;
    return {
      ...clone(state),
      ...(entityPatch?.transform ? { transform: clone(entityPatch.transform) } : {}),
      ...(entityPatch?.visibility ? { visibility: entityPatch.visibility } : {}),
      ...(nextPose ? { pose: nextPose } : {})
    };
  });
  for (const entity of stage.entities) {
    if (entityStates.some((state) => state.entityId === entity.id)) continue;
    entityStates.push({
      entityId: entity.id,
      transform: clone(entity.transform),
      visibility: entity.visibility,
      ...(entity.rig ? { pose: defaultPose(entity.transform) } : {})
    });
  }
  if (patch.contacts) {
    const contactOwner = entityStates.find((state) =>
      patch.contacts?.some((contact) => attachmentExists(stage, state.entityId, contact.attachmentId))
    ) ?? entityStates[0];
    if (contactOwner) {
      const pose = contactOwner.pose ?? defaultPose(contactOwner.transform);
      contactOwner.pose = { ...pose, contacts: clone(patch.contacts), source: "manual" };
    }
  }
  return {
    id: `${stage.id}_${shotId}`,
    shotId,
    beatId,
    previousSnapshotId: previous.id,
    ...(patch.cameraId || previous.cameraId ? { cameraId: patch.cameraId ?? previous.cameraId } : {}),
    entityStates,
    constraintIds: stage.constraints.filter((constraint) => constraint.enabled).map((constraint) => constraint.id),
    createdAt
  };
}

export function inheritStageSnapshot(
  stage: SceneStage,
  previous: StageStateSnapshot,
  beatId: string,
  patch: StageSnapshotPatch = {},
  createdAt = new Date().toISOString()
): StageStateSnapshot {
  return inheritShotSnapshot(stage, previous, beatId, beatId, patch, createdAt);
}

function attachmentExists(stage: SceneStage, entityId: string, attachmentId: string): boolean {
  return Boolean(stage.entities.find((entity) => entity.id === entityId)?.attachments?.some((point) => point.id === attachmentId));
}

function constraintValid(stage: SceneStage, constraint: StageConstraint, snapshot: StageStateSnapshot): boolean {
  if (!snapshot.entityStates.some((state) => state.entityId === constraint.subjectEntityId)) return false;
  if (constraint.targetEntityId && !snapshot.entityStates.some((state) => state.entityId === constraint.targetEntityId)) return false;
  if (constraint.subjectAttachmentId && !attachmentExists(stage, constraint.subjectEntityId, constraint.subjectAttachmentId)) return false;
  if (constraint.targetEntityId && constraint.targetAttachmentId && !attachmentExists(stage, constraint.targetEntityId, constraint.targetAttachmentId)) return false;
  return true;
}

export function validateStageSnapshot(
  stage: SceneStage,
  snapshot: StageStateSnapshot
): StageSnapshotValidation {
  const unresolved: string[] = [];
  const disabledConstraints: string[] = [];
  if (snapshot.cameraId && !stage.cameras.some((camera) => camera.id === snapshot.cameraId)) {
    unresolved.push(`camera:${snapshot.cameraId}`);
  }
  if (stage.snapshots.some((item) => item !== snapshot && item.shotId === snapshot.shotId)) {
    unresolved.push(`shot:${snapshot.shotId}:duplicate`);
  }
  for (const state of snapshot.entityStates) {
    if (!stage.entities.some((entity) => entity.id === state.entityId)) unresolved.push(`entity:${state.entityId}`);
  }
  for (const constraint of stage.constraints) {
    if (!constraint.enabled) {
      disabledConstraints.push(constraint.id);
      continue;
    }
    if (!constraintValid(stage, constraint, snapshot)) unresolved.push(`constraint:${constraint.id}`);
  }
  for (const state of snapshot.entityStates) {
    for (const contact of state.pose?.contacts ?? []) {
      if (!attachmentExists(stage, state.entityId, contact.attachmentId)) {
        unresolved.push(`contact:${state.entityId}:${contact.attachmentId}`);
      }
      if (contact.targetEntityId && !snapshot.entityStates.some((item) => item.entityId === contact.targetEntityId)) {
        unresolved.push(`contact-target:${contact.targetEntityId}`);
      }
      if (contact.targetEntityId && contact.targetAttachmentId && !attachmentExists(stage, contact.targetEntityId, contact.targetAttachmentId)) {
        unresolved.push(`contact-target-attachment:${contact.targetEntityId}:${contact.targetAttachmentId}`);
      }
    }
  }
  return { valid: unresolved.length === 0, unresolved, disabledConstraints };
}
