# MiniMax H3 Task 8 r3 remediation report

## Scope

- Baseline review commit: `2739acff09132b8c5c0b82df6b8930485390918e`.
- Closed the three Critical and four Important findings in the latest `minimax-h3-task-8-review.md` without starting Task 9.
- Preserved the user's unrelated dirty worktree and staged only Task 8 r3 files/hunks.

## RED to GREEN evidence

1. Store regression first proved that a `generatedVideoPath` replacement was erased. The transition now retains the replacement media and clears only stale evidence/decision; profile or generation-contract changes may clear old media.
2. Routed production first failed with `ERR_MODULE_NOT_FOUND` for `videoRoutedGenerationRuntime.mjs`. The real controller now reads live Comfy `object_info`, routes and preflights before generation, and directly invokes Task 5 `generateRoutedVideoShot` with the selected canonical workflow.
3. Exact-request tests cover effective profile/manual override, canonical workflow, first/last frames, character/scene reference paths, and the second continuous shot's freshly backend-authenticated predecessor tail.
4. Deferred CAS tests replace media/profile/boundary and switch sequence while backend awaits are pending. No stale processing or decision completion is published.
5. Contract-digest table tests cover prompts/title/notes/dialogue/seed, character/scene/storyboard references, duration, continuity/profile/workflow/boundary, and project width/height/fps; unrelated UI state does not invalidate.
6. Review-frame replacement/replay and foreign assembly association now fail closed through Task 7 backend verification and authenticated artifact binding.
7. A real `react-test-renderer` harness mounts `VideoProductionPanel` hooks against the real Zustand store. It covers initial-path processing, approval persistence, manual override invalidation, exact single/pair rebuild, deferred stale decisions, partial-pair failure, retry UI, and sequence switching.

## Production contract

- `Shot.videoGenerationContractDigest` and typed `videoProductionEvidence` bind generation, Task 6 boundary identity, Task 7 normalization/review/assembly receipts, and semantic decisions to one immutable artifact contract.
- Every processing/decision operation carries sequence, shot, canonical contract digest, source path, boundary identity, and operation token. Store writes are compare-and-set; adjacent pair publication is one atomic Zustand transition.
- Task 7 runs are retained explicitly after success and cleaned on failure/stale completion. Backend review verification rehashes all three frame files and signs their identities.
- Continuous/match-cut pair generation is dependency ordered. The second Task 5 request receives the freshly verified last review frame from the first result. Partial failure publishes neither new media result and marks the whole pair stale/rejected for retry.
- `ComfyPipelinePanel` now supplies only current settings to the narrow video-production mount; it no longer passes the legacy generic video callback.

## Fresh verification (2026-08-18)

- `npm.cmd run test:video-quality-gate` — PASS.
- `npm.cmd run test:video-production-schema` — PASS.
- `npm.cmd run test:minimax-h3-profile-registry` — PASS.
- `npm.cmd run test:video-workflow-router` — PASS.
- `npm.cmd run test:minimax-h3-binding` — PASS.
- `npm.cmd run test:video-continuity-planner` — PASS.
- `npm.cmd run test:video-normalization` — PASS.
- `cargo test video_continuity --manifest-path src-tauri/Cargo.toml` — PASS, 35 passed.
- `npm.cmd run build` — PASS; only the existing large-chunk advisory remains.
- Scoped `git diff --check` — PASS (line-ending notices only).

## Shared dirty files

`package.json`, `package-lock.json`, `ComfyPipelinePanel.tsx`, `comfyService.ts`, `store.ts`, `types.ts`, `desktopBridge.ts`, `src-tauri/src/main.rs`, and `scripts/windows-web-server.mjs` contain or may overlap unrelated user work. Task 8 uses exact patch staging for these files; unrelated changes remain unstaged.
