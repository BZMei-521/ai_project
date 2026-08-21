import type { ShotTransition } from "../../modules/storyboard-core/types";

export type LinearShotRef = { id: string; durationSeconds: number };
export type LinearTransitionState = { orderedShots: LinearShotRef[]; transitions: ShotTransition[] };

// @ts-ignore JavaScript runtime intentionally has no declaration file.
import * as runtime from "./shotTransitionRuntime.mjs";

export const createDefaultShotTransition = runtime.createDefaultShotTransition as (
  sequenceId: string,
  fromShotId: string,
  toShotId: string,
  options?: { maxDurationSeconds?: number }
) => ShotTransition;
export const reconcileLinearTransitions = runtime.reconcileLinearTransitions as (input: {
  sequenceId: string;
  orderedShots: LinearShotRef[];
  existingTransitions: ShotTransition[];
}) => ShotTransition[];
export const moveShotInLinearSequence = runtime.moveShotInLinearSequence as (input: {
  sequenceId: string;
  orderedShots: LinearShotRef[];
  transitions: ShotTransition[];
  shotId: string;
  targetIndex: number;
}) => LinearTransitionState;
export const removeShotFromLinearSequence = runtime.removeShotFromLinearSequence as (input: {
  sequenceId: string;
  orderedShots: LinearShotRef[];
  transitions: ShotTransition[];
  shotId: string;
}) => LinearTransitionState;
