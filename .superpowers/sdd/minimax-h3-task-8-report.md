# MiniMax H3 Task 8 remediation report

## Scope

- Baseline: `c0a17638bc882edb0f4fc648241256d4dd894648`; remediation follows review of `8b0f13c`.
- Fixed all two Critical, three Important, and two Minor findings in `minimax-h3-task-8-review.md`.
- Did not start Task 9 and preserved unrelated dirty-worktree changes.

## RED to GREEN evidence

1. The strict Task 8 checker first failed with `ERR_MODULE_NOT_FOUND` for `videoProductionControllerRuntime.mjs`.
2. Receipt tests then rejected the old caller-authored `{status:"verified"}` trust path and required complete Task 7 credentials, probes, anomaly intervals, review frames, and artifact identities.
3. The connected interaction harness failed until the controlled view and real controller callbacks existed.
4. The Task 3 schema checker failed because shot-script normalization stripped `videoProductionEvidence`; snake/camel import, media reuse, replace, update, backup, hydrate, and legacy defaults now preserve it.
5. Assembly verification failed because only the normalization credential was reverified; the controller now calls the Task 7 backend assembly verifier and binds its transaction ID, hash, and output path.
6. Boundary replacement initially left an approval attached; Task 6 boundary identity and video generation contract changes now invalidate stale media evidence and decisions.

## Production contract

- `Shot.videoProductionEvidence` is a typed schema containing Task 2 route/preflight, Task 6 boundary identity, Task 7 run/staging/normalization/inspection/review-frame/assembly evidence, artifact binding, report, decision, and processing/failure state.
- Generated shot results enter a dedicated controller: begin run, stage, probe, normalize, extract first/middle/last frames, reverify the credential, persist evidence, and build a fresh report. Failures persist a retryable `failed` state.
- The runtime fails closed on partial, unknown, malformed, non-finite, negative, mismatched, tampered, or replayed evidence. A caller-provided verified status is never authority.
- Approval and rejection reverify the current file through the backend. Persisted decisions are reused only when the complete artifact binding matches; replacing media, profile/workflow inputs, or boundary identity invalidates them.
- Only explicit approval produces `approved`; structural failures cannot be approved. Reject requires a reason.
- Rebuild uses the real generation callback. Hard cuts rebuild only the current shot. Continuous/match-cut boundaries rebuild only the authoritative approved adjacent pair with its shared frame.
- Rejection reason state is keyed by sequence, shot, and artifact and is cleared on submit/removal. Task 8 CSS is panel-scoped.
- `ComfyPipelinePanel` contains only the import, mount, and existing generator callback wiring; routing, verification, persistence, and rebuild rules stay in the video-production module.

## Fresh verification (2026-08-18)

- `npm.cmd run test:video-quality-gate` — PASS.
- `npm.cmd run test:video-production-schema` — PASS.
- `npm.cmd run test:video-workflow-router` — PASS.
- `npm.cmd run test:video-continuity-planner` — PASS.
- `npm.cmd run test:video-normalization` — PASS, including the real ffmpeg/Rust contract.
- `npm.cmd run build` — PASS (`tsc -b && vite build`); only the existing large-chunk advisory remains.
- `git diff --check` on Task 8 paths — PASS (line-ending notices only).

## Shared dirty files

`ComfyPipelinePanel.tsx`, `global.css`, `store.ts`, `types.ts`, `desktopBridge.ts`, `src-tauri/src/main.rs`, and `scripts/windows-web-server.mjs` contain unrelated work. Only exact Task 8 hunks are staged; unrelated changes remain unstaged.
