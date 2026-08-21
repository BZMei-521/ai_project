import type { Shot, ShotTransition } from "../modules/storyboard-core/types";
// @ts-ignore JavaScript runtime intentionally has no declaration file.
import { createScriptTransitionPersistenceFingerprint as runtimeCreateFingerprint, shouldClearScriptTransitionDirtyAfterSave as runtimeShouldClearDirty } from "./scriptTransitionSaveGuard.mjs";

export type ScriptTransitionPersistenceState = {
  shots: readonly Shot[];
  shotTransitions: readonly ShotTransition[];
};

export type ScriptTransitionSaveGuardInput = {
  saved: boolean;
  revisionAtSaveStart: number;
  currentRevision: number;
  fingerprintAtSaveStart: string;
  currentFingerprint: string;
};

export const createScriptTransitionPersistenceFingerprint = runtimeCreateFingerprint as (
  state: ScriptTransitionPersistenceState
) => string;

export const shouldClearScriptTransitionDirtyAfterSave = runtimeShouldClearDirty as (
  input: ScriptTransitionSaveGuardInput
) => boolean;
