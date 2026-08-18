# MiniMax H3 Task 8 r4 remediation report

## Scope

- Baseline: `104bfeaf1ac10740448cd471d2d01a94ad4f566e`.
- Closed the two Critical and six Important findings in the latest Task 8 review without starting Task 9.
- Preserved unrelated dirty work and staged only Task 8 files/hunks.

## RED to GREEN

1. Effective request mutations initially did not change the contract digest. The digest now hashes the complete consumed Task 5 request, including profile, acceleration, quality, prompt/seed, workflow, references, endpoints, incoming dependency receipt/frame, dimensions and duration.
2. Retain followed by stale/CAS failure initially leaked a retained unpublished run. The controller now uses retain-then-CAS publication and an authorized backend discard command for every unpublished retained run; single and batch failures clean all run capabilities.
3. Task 5 receipts are verified before Task 7 processing. Profile, acceleration, workflow/input digests, output identity, contract digest and random operation token must match the prepared request.
4. Task 6 boundaries are split into explicit incoming and outgoing roles. Continuous input uses a freshly authenticated predecessor tail; match cut uses an independently approved shared frame; hard cut and scene transition use no predecessor dependency. Outgoing frames never become the current first frame.
5. Real Comfy single and bulk video callbacks return through one narrow `videoProductionEntry` gateway backed by routed Task 5 generation. The generic asset executor is unreachable for quality-gated video callbacks.
6. Preparation/inventory failures persist a guarded retryable failure. A Comfy base URL change reruns live prepare/preflight/evidence processing, and the retry UI remains connected.
7. Backend review verification now binds the persisted first/middle/last role order; a swapped first/last permutation is rejected. Retained-unpublished discard is authorized, idempotent after cleanup, and rejects active runs.
8. Connected tests cover receipt tamper/replay, four boundary kinds across first/middle/last shot positions, gateway single/batch dispatch, partial-pair atomic failure, stale CAS, retry, and settings recovery.

## Fresh verification (2026-08-18)

- `npm.cmd run test:video-quality-gate` — PASS.
- `npm.cmd run test:video-production-schema` — PASS.
- `npm.cmd run test:minimax-h3-presets` — PASS.
- `npm.cmd run test:minimax-h3-profile-registry` — PASS.
- `npm.cmd run test:video-workflow-router` — PASS.
- `npm.cmd run test:minimax-h3-binding` — PASS.
- `npm.cmd run test:video-continuity-planner` — PASS.
- `npm.cmd run test:video-normalization` — PASS.
- `cargo test video_continuity::tests -- --nocapture` — PASS, 36 passed.
- Concurrent 8-artifact run-ledger test — PASS once, then five consecutive repeats PASS.
- `npm.cmd run build` — PASS; only the existing chunk-size advisory remains.

The first Rust full-suite attempt encountered Windows linker `LNK1104` because the test executable was briefly unavailable; no tests ran. An immediate clean rerun executed all 36 tests successfully.

## Shared dirty files

`ComfyPipelinePanel.tsx`, `types.ts`, `desktopBridge.ts`, `src-tauri/src/main.rs`, and `scripts/windows-web-server.mjs` already contained unrelated user changes. Only the exact Task 8 import/dispatch/type/command hunks are staged; all other work remains unstaged.
