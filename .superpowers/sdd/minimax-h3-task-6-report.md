# MiniMax H3 Task 6 Report

## Scope

- Added the pure continuity planner runtime and its typed TypeScript wrapper.
- Added executable regression coverage for segment grouping, approved-frame dependencies, approval blocking, cut semantics, deterministic output, and precise stale propagation.
- Removed only the legacy `inferVideoMode` branch that inferred FLF2V from generic transition wording plus a following storyboard image.
- Added `test:video-continuity-planner` to `package.json`.

## TDD evidence

1. RED: `node scripts/check-video-continuity-planner.mjs` failed with `ERR_MODULE_NOT_FOUND` before the planner runtime existed.
2. RED after the planner implementation: the checker reached the real `comfyService.ts` `inferVideoMode` declaration and failed because generic `transition` plus a next storyboard returned `first_last_frame`.
3. GREEN after the targeted removal: `PASS video continuity planner`.

The checker extracts and transpiles the real `inferVideoMode` function declaration; it does not use source-text searching as the behavior assertion.

## Implemented contract

- Ordered, equivalent scene/character/time shots form one deterministic `ContinuitySegment`.
- `continuous` depends on the prior shot task and exposes only an explicitly approved tail frame; pending approval blocks the target shot.
- `match_cut` exposes a frame only when the boundary frame is independently authored and manually approved.
- `hard_cut` and `scene_change` create no frame dependency; `scene_change` starts a new segment.
- Changing a boundary stales exactly the boundary's two shots and assembly.
- Changing a shot state summary stales the shot, actual dependency descendants, and assembly.
- IDs, shot order, anchor paths, dependencies, stale IDs, and duplicate handling are deterministic.
- No later storyboard asset is used by the planner or `inferVideoMode` to derive FLF2V automatically.

## Fresh verification

- `npm.cmd run test:video-continuity-planner` — PASS.
- `npm.cmd run test:video-workflow-router` — PASS.
- `npm.cmd run test:minimax-h3-binding` — PASS.
- `npm.cmd run build` — PASS (`tsc -b` and Vite); Vite emitted only the existing large-chunk advisory.

## Shared dirty files

`src/modules/comfy-pipeline/comfyService.ts` and `package.json` already contained extensive unrelated worktree changes. Their Task 6 edits remain intentionally uncommitted for the parent integrator to stage safely:

- `comfyService.ts`: removal of the five-line generic-transition/next-storyboard inference branch.
- `package.json`: one `test:video-continuity-planner` script entry.
