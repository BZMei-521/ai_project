# MiniMax H3 Task 8 r6 remediation report

## r6 final concurrency closure

- RED: the connected component held an old `8188` inventory request, switched to `8388`, completed and published the fresh attempt, then resolved the old request successfully. The old request incorrectly entered the controller after the fresh transient slot had been removed (`[8388, 8188]`).
- GREEN: each sequence/shot now owns an independent monotonic processing epoch keyed to the canonical full Comfy settings identity and operation token. A new settings or generation-contract attempt becomes current before preparation; currentness is checked around every asynchronous boundary and before staged/controller/state work. The transient staged map is no longer the authority for attempt freshness.
- The connected regression proves the new URL fully publishes first, a successful old prepare never enters the controller, the fresh evidence remains byte-for-byte unchanged, and neither URL creates a processing loop.
- Fresh r6 verification: `node scripts/check-video-quality-gate.mjs` PASS; `npm.cmd run test:video-production-schema` PASS; `npm.cmd run build` PASS (only the existing large-chunk advisory).

## Scope

- Baseline: `ea4253b9e34f64fcf90fc72fb50bb5dd621725d7`.
- Closed the two Critical and one Important findings in the r4 independent review without starting Task 9.
- Preserved unrelated dirty work and staged only Task 8 files/hunks.

## RED to GREEN

1. A real adjacent-pair lifecycle test first showed zero cleanup calls for the first handed-off run when member two failed generation. The batch finally path now cleans every handed-off member whenever publication did not complete, including the one-staged-member case. Generation, input resolution, stage, normalize, and credential verification failure points each prove exactly one first-run cleanup and zero retain/publication.
2. Approval/rejection backend verification errors no longer call a shot-ID-only failure writer. Both capture immutable evidence and use sequence, shot, operation token, source path, contract digest, and artifact binding CAS. Eight connected cases cover approval/rejection rejection after media, profile, boundary, and sequence replacement; duplicate IDs across sequences are isolated.
3. A deferred old Comfy inventory request initially suppressed the automatic request for a new base URL. Processing is now keyed by sequence, shot, base URL, contract, and operation token; the settings identity is part of staged operation CAS. The new URL starts once while the old request remains pending, and the superseded old failure cannot publish or delete the new attempt.

## Prior r4 closures retained

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
- `cargo test retained_unpublished_run_can_be_authoritatively_discarded -- --nocapture` — PASS, 1 passed.
- Concurrent 8-artifact run-ledger test — PASS once, then five consecutive repeats PASS.
- `npm.cmd run build` — PASS; only the existing chunk-size advisory remains.

The first Rust full-suite attempt encountered Windows linker `LNK1104` because the test executable was briefly unavailable; no tests ran. An immediate clean rerun executed all 36 tests successfully.

## Shared dirty files

`ComfyPipelinePanel.tsx`, `types.ts`, `desktopBridge.ts`, `src-tauri/src/main.rs`, and `scripts/windows-web-server.mjs` already contained unrelated user changes. Only the exact Task 8 import/dispatch/type/command hunks are staged; all other work remains unstaged.
