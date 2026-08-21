import type { Shot, ShotTransition } from "../storyboard-core/types";
import type { VideoBoundaryInput } from "./continuityPlanner";

export type ShotTransitionBoundarySource = ShotTransition & {
  prompt?: string;
  negativePrompt?: string;
};

export type ShotTransitionBoundaryRef = Pick<
  Shot,
  "id" | "videoBoundaryKind" | "approvedBoundaryFramePath"
>;

// @ts-ignore JavaScript runtime intentionally has no declaration file.
import { createShotTransitionBoundaryResolver as runtimeCreateShotTransitionBoundaryResolver, resolveShotTransitionBoundary as runtimeResolveShotTransitionBoundary } from "./shotTransitionBoundaryRuntime.mjs";

export type ShotTransitionBoundaryResolver = (
  fromShot: ShotTransitionBoundaryRef,
  toShot: ShotTransitionBoundaryRef
) => VideoBoundaryInput;

export const createShotTransitionBoundaryResolver = runtimeCreateShotTransitionBoundaryResolver as (input: {
  sequenceId: string;
  transitions: readonly ShotTransitionBoundarySource[];
}) => ShotTransitionBoundaryResolver;

export const resolveShotTransitionBoundary = runtimeResolveShotTransitionBoundary as (input: {
  sequenceId: string;
  fromShot: ShotTransitionBoundaryRef;
  toShot: ShotTransitionBoundaryRef;
  transitions: readonly ShotTransitionBoundarySource[];
}) => VideoBoundaryInput;
