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
import { resolveShotTransitionBoundary as runtimeResolveShotTransitionBoundary } from "./shotTransitionBoundaryRuntime.mjs";

export const resolveShotTransitionBoundary = runtimeResolveShotTransitionBoundary as (input: {
  sequenceId: string;
  fromShot: ShotTransitionBoundaryRef;
  toShot: ShotTransitionBoundaryRef;
  transitions: readonly ShotTransitionBoundarySource[];
}) => VideoBoundaryInput;
