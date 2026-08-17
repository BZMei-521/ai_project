import type { VideoRouteDecision, VideoRouteInput } from "./types";

// @ts-ignore JavaScript runtime intentionally has no declaration file.
import { routeVideoWorkflow as runtimeRouteVideoWorkflow } from "./videoRouterRuntime.mjs";

export const routeVideoWorkflow = runtimeRouteVideoWorkflow as (
  input: VideoRouteInput
) => VideoRouteDecision;
