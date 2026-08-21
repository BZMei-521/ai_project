import type { Shot, ShotTransition } from "../modules/storyboard-core/types";
import type { WorkbenchStage } from "../app-shell/workbenchRoutes";
// @ts-ignore JavaScript runtime intentionally has no declaration file.
import { canCommitConfirmedStageChange as runtimeCanCommitStageChange, createScriptTransitionPersistenceFingerprint as runtimeCreateFingerprint, shouldConfirmScriptStageExit as runtimeShouldConfirmStageExit, shouldClearScriptTransitionDirtyAfterSave as runtimeShouldClearDirty, shouldMarkRecoveredScriptDirty as runtimeShouldMarkRecoveryDirty, shouldReplaceImportedScript as runtimeShouldReplaceImportedScript } from "./scriptTransitionSaveGuard.mjs";

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

export const shouldMarkRecoveredScriptDirty = runtimeShouldMarkRecoveryDirty as (input: {
  recoveredFingerprint: string;
  desktopFingerprint: string | null;
}) => boolean;

export const shouldReplaceImportedScript = runtimeShouldReplaceImportedScript as (input: {
  dirty: boolean;
  confirmationAccepted: boolean;
  revisionAtPrompt: number;
  currentRevision: number;
}) => boolean;

export const shouldConfirmScriptStageExit = runtimeShouldConfirmStageExit as (input: {
  currentStage: WorkbenchStage;
  nextStage: WorkbenchStage;
  dirty: boolean;
}) => boolean;

export const canCommitConfirmedStageChange = runtimeCanCommitStageChange as (input: {
  confirmationAccepted: boolean;
  requestId: number;
  latestRequestId: number;
}) => boolean;
