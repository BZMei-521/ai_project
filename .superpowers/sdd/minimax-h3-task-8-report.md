# MiniMax H3 Task 8 implementation report

## Scope and baseline

- Baseline: `c0a17638bc882edb0f4fc648241256d4dd894648`.
- Added the quality state machine, typed facade, production review panel, and executable quality gate.
- Added only an import and one `<VideoProductionPanel />` mount to `ComfyPipelinePanel.tsx`; all quality, routing display, review, and rebuild behavior remains in the child module.
- Did not start Task 9 and did not revert unrelated dirty-worktree changes.

## TDD evidence

1. `scripts/check-video-quality-gate.mjs` was created first. Its initial run failed with the expected `ERR_MODULE_NOT_FOUND` for `videoQualityRuntime.mjs`.
2. After the state-machine runtime became green, the next run failed because `VideoProductionPanel.tsx` did not exist.
3. After the actual component bundled and rendered successfully, the next run failed on the deliberately absent `ComfyPipelinePanel` import/mount contract.
4. The integrated checker then passed state-machine, immutability, receipt, rebuild-scope, SSR UI, and child-mount assertions.
5. Full TypeScript compilation initially found the multiline JavaScript runtime import was not covered by the project-standard `@ts-ignore`. Converting it to the same one-line runtime bridge pattern used by the existing video modules made the full build pass.

## Quality and rebuild contract

- A non-normalized segment, any black interval/frame, freeze duration over 0.5 seconds, or timestamp discontinuity is structurally rejected.
- Supplied Task 7 normalization/assembly receipts fail closed on tamper flags, invalid flags, or unknown status. Native Task 7 schema-v1 receipt identities are accepted without inventing a frontend trust root.
- Structurally clean media is always `needs_review`; semantic evaluator availability never auto-approves it. Only an explicit user approval can produce `approved`, and a structurally rejected report cannot be overridden to approved.
- Reject requires a non-empty reason. Ordinary rejection submits only the current shot. `motion_boundary` can submit two shots only for a `continuous`/`match_cut` boundary whose shot IDs are adjacent in the authoritative sequence order; non-adjacent pairs fail closed.
- All report/rebuild functions normalize deterministically and do not mutate their inputs. Legacy partial review-frame inputs are preserved with missing positions represented as empty strings.

## UI integration

- Each shot shows selected profile and route reason, manual profile override, model/node preflight, first/middle/last frames, character face/body references, scene references, boundary frame, structural issues, and explicit approve/reject actions.
- Reject-and-rebuild is disabled until a reason is selected. Approve is disabled for structural failures.
- Decisions and rebuild requests are emitted as `storyboard:video-quality-decision` and `storyboard:video-rebuild-request` events; the rebuild event contains the already-scoped single-shot or adjacent-pair request.
- Existing store fields persist profile override and quality status. Optional Task 7 inspection, review-frame, normalization, and assembly receipt fields are consumed compatibly when present.

## Fresh verification

- `node scripts/check-video-quality-gate.mjs` — PASS.
- `npm.cmd run build` (`tsc -b && vite build`) — PASS; only the existing Vite large-chunk advisory was emitted.
- `node scripts/check-video-continuity-planner.mjs` (Task 6 regression) — PASS.
- `node scripts/check-video-normalization-contract.mjs` (Task 7 real ffmpeg/Rust contract regression) — PASS.
- The ordinary `npm` PowerShell shim is blocked by the host execution policy; the equivalent Windows `npm.cmd` shim was used.

## Shared dirty files

- `ComfyPipelinePanel.tsx`, `global.css`, and `package.json` contained substantial pre-existing user/task changes. Only the exact Task 8 import, mount, styles, and package-script content is isolated for commit; all unrelated working-tree edits remain untouched and unstaged.
