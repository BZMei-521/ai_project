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

The checker extracts and transpiles the real `inferVideoMode`, `inferStoryboardVideoModeByMatureCase`, `resolveVideoFrameSources`, keyword tables, and helper declarations. It does not stub the mature-case helper or use source-text searching as the behavior assertion.

## Review remediation TDD evidence

1. RED: the real mature-case helper returned `first_last_frame` for bare `transition`; GREEN: generic `transition`/`转场`/`衔接`/`过渡` now remain single-frame while explicit mode, explicit start+end paths, and explicit endpoint wording remain FLF2V.
2. RED: the checker required the missing real frame-source resolver; GREEN: the production token path now returns an empty last-frame source for single-frame mode and cannot consume the next storyboard implicitly.
3. RED: compound `a→b→c` boundary plus `a` state changes omitted `c`; GREEN: traversal uses a separate visited set and returns each stale shot/task once in stable order.
4. RED: conflicting duplicate `dup` definitions did not throw and could select an approved tail; GREEN: only identical definitions deduplicate, while conflicts throw `duplicate_shot_id_conflict:dup` before boundary planning.
5. RED: nested `undefined` raised a native `JSON.parse` `SyntaxError`; GREEN: JSON-compatible nested arrays normalize safely and unsupported undefined/function/symbol/bigint/non-finite/cyclic values throw `unsupported_continuity_state:<field>:<reason>`.

Additional coverage proves stable empty input, delimiter-safe IDs, deterministic order, and a forward-only acyclic dependency graph even when reverse boundary input is supplied.

### Re-review r2 closure

- RED: duplicate `continuous` boundaries for the same pair, one pending and one approved, silently selected the approved definition and made the dependent ready.
- GREEN: boundary normalization now rejects conflicting pair or explicit-identity definitions with `duplicate_boundary_conflict:<identity>` before a plan is returned.
- The checker covers approval, kind, shared-frame path, shared-frame source, and same-explicit-ID/different-pair conflicts; every case asserts that no plan or ready dependent is returned.
- Semantically identical duplicate boundaries remain idempotent, deterministic, and produce one boundary plan.

## Implemented contract

- Ordered, equivalent scene/character/time shots form one deterministic `ContinuitySegment`.
- `continuous` depends on the prior shot task and exposes only an explicitly approved tail frame; pending approval blocks the target shot.
- `match_cut` exposes a frame only when the boundary frame is independently authored and manually approved.
- `hard_cut` and `scene_change` create no frame dependency; `scene_change` starts a new segment.
- Changing a boundary stales exactly the boundary's two shots and assembly.
- Changing a shot state summary stales the shot, actual dependency descendants, and assembly.
- IDs, shot order, anchor paths, dependencies, stale IDs, and duplicate handling are deterministic.
- No later storyboard asset is used by the planner or single-frame token path to derive or populate FLF2V automatically.

## Fresh verification

- `npm.cmd run test:video-continuity-planner` — PASS.
- `npm.cmd run test:video-workflow-router` — PASS.
- `npm.cmd run test:minimax-h3-binding` — PASS.
- `npm.cmd run build` — PASS (`tsc -b` and Vite); Vite emitted only the existing large-chunk advisory.

## Shared dirty files

`src/modules/comfy-pipeline/comfyService.ts` and `package.json` already contained extensive unrelated worktree changes. Their Task 6 edits remain intentionally uncommitted for the parent integrator to stage safely:

- `comfyService.ts`: removal of the generic-transition fallback and generic transition words from mature FLF2V actions, plus the real mode-gated frame-source resolver used by token construction.
- `package.json`: one `test:video-continuity-planner` script entry.
