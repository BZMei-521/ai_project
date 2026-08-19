# Graybean Spatial Director Workbench Verification

Date: 2026-08-19

## Gate result

The current working-tree release gate is **READY** for automated checks. Visual/Tauri QA remains a separate manual gate and has not been run.

Acceptance command:

```text
node scripts/check-graybean-workbench-acceptance.mjs
```

Latest authorized run: `exit 0`, 42 `PASS`, 0 `FAIL`, 0 `BLOCKED`, `releaseReady: true`.

The first restricted-runtime attempt was blocked before the runner started by Node: `EPERM lstat C:\Users\Administrator`. A root-authorized rerun was performed. The runner invokes `npm.cmd` through `cmd.exe` on Windows so npm checks execute instead of being misclassified as spawn failures.

## Check-by-check record

`exit` is the child process exit code. `-` means the command was not started because the required checker is absent.

| Check | Exact command | Status | Exit | Output summary / blocker |
|---|---|---:|---:|---|
| migration | `node scripts/check-workbench-migration.mjs` | PASS | 0 | defaults, idempotence, immutability, validation, backup ordering |
| spatial-scene-domain | `node scripts/check-spatial-scene-domain.mjs` | PASS | 0 | spatial scene domain checks passed |
| spatial-preview-runtime | `node scripts/check-spatial-preview-runtime.mjs` | PASS | 0 | PASS spatial preview runtime |
| workbench-shell | `node scripts/check-workbench-shell.mjs` | PASS | 0 | PASS workbench shell contract |
| spatial-stage-schema | `node scripts/check-spatial-stage-schema.mjs` | PASS | 0 | spatial stage schema checks passed |
| spatial-stage-capabilities | `node scripts/check-spatial-stage-capabilities.mjs` | PASS | 0 | spatial stage capability checks passed |
| spatial-stage-viewport | `node scripts/check-spatial-stage-viewport.mjs` | PASS | 0 | spatial stage viewport checks passed |
| spatial-stage-rigs | `node scripts/check-spatial-stage-rigs.mjs` | PASS | 0 | spatial stage rig checks passed |
| spatial-stage-state | `node scripts/check-spatial-stage-state.mjs` | PASS | 0 | spatial stage state checks passed |
| spatial-stage-moge | `node scripts/check-spatial-stage-moge.mjs` | FAIL | 1 | esbuild: `Must use "outdir" when there are multiple input files` |
| workbench-feature-routing | `node scripts/check-workbench-feature-routing.mjs` | PASS | 0 | PASS workbench feature routing contract |
| graybean-dead-code | `node scripts/check-graybean-dead-code.mjs` | PASS | 0 | `SAFE_REMOVAL_CANDIDATES=0`; retained legacy panel is still referenced |
| character-identity | `npm.cmd run test:character-identity` | PASS | 0 | character identity schema and store persistence |
| character-consistency | `npm.cmd run test:character-consistency` | PASS | 0 | character reference routing and pass planning |
| character-style | `npm.cmd run test:character-style` | PASS | 0 | cinematic 3D style contract and species gate |
| character-providers | `npm.cmd run test:character-providers` | PASS | 0 | commercial provider registry |
| character-provider-settings | `npm.cmd run test:character-provider-settings` | PASS | 0 | provider settings and Desktop preflight guard |
| sequential-character-passes | `npm.cmd run test:sequential-character-passes` | PASS | 0 | sequential generation tokens and acceptance pipeline |
| character-identity-ui | `npm.cmd run test:character-identity-ui` | PASS | 0 | runtime/editor controls, persistence, defaults, status |
| character-consistency-ui | `npm.cmd run test:character-consistency-ui` | PASS | 0 | character consistency UI/redraw checks |
| character-generation-evidence | `npm.cmd run test:character-generation-evidence` | PASS | 0 | character generation evidence checks |
| character-evidence-attestation | `npm.cmd run test:character-evidence-attestation` | PASS | 0 | desktop evidence receipt and anti-replay claims |
| character-reference-snapshot | `npm.cmd run test:character-reference-snapshot` | PASS | 0 | character reference snapshot checks |
| workflow-presets | `npm.cmd run test:workflow-presets` | PASS | 0 | preset audit passed; Comfy `/object_info` unavailable is reported as optional audit text |
| workflow-registry | `node scripts/check-workflow-registry.mjs` | PASS | 0 | shared runtime, validation, ranking, diagnostics |
| storyboard-generation-flow | `node scripts/check-storyboard-generation-flow.mjs` | PASS | 0 | preflight, staged success, partial failure, isolated retry |
| storyboard-generation-state | `node scripts/check-storyboard-generation-state.mjs` | PASS | 0 | success, failure, retry, restore, unknown-shot rejection |
| storyboard-workflow-persistence | `node scripts/check-storyboard-workflow-persistence.mjs` | PASS | 0 | workflow persistence contract |
| storyboard-klein-reference | `node scripts/check-storyboard-klein-reference-preset.mjs` | PASS | 0 | Klein multi-reference preset |
| h3-presets | `node scripts/check-minimax-h3-presets.mjs` | PASS | 0 | MiniMax H3 API presets |
| h3-profile-registry | `node scripts/check-minimax-h3-profile-registry.mjs` | PASS | 0 | MiniMax H3 profile registry |
| h3-binding | `node scripts/check-minimax-h3-binding.mjs` | PASS | 0 | MiniMax H3 binding |
| audio-round-trip | `node scripts/check-audio-round-trip.mjs` | PASS | 0 | PASS audio track serialization and recovery round-trip |
| timeline-export-round-trip | `node scripts/check-timeline-export-round-trip.mjs` | PASS | 0 | PASS timeline and export media-reference round-trip |
| video-production-schema | `npm.cmd run test:video-production-schema` | PASS | 0 | legacy migration, desktop sync, import/update, serialization/reload |
| video-workflow-router | `npm.cmd run test:video-workflow-router` | PASS | 0 | video workflow router |
| video-transition-graph | `node scripts/check-video-transition-graph.mjs` | PASS | 0 | Smooth six-shot transition graph |
| video-normalization | `npm.cmd run test:video-normalization` | PASS | 0 | video normalization contract |
| video-continuity-planner | `npm.cmd run test:video-continuity-planner` | PASS | 0 | video continuity planner |
| video-quality-gate | `npm.cmd run test:video-quality-gate` | PASS | 0 | fail-closed receipts, controller, interaction, rebuild scope |
| smooth-video-concat-runtime | `node scripts/check-smooth-video-concat-runtime.mjs` | PASS | 0 | Smooth StoryboardPro concat runtime |
| build | `npm.cmd run build` | FAIL | 1 | `src/modules/spatial-stage/mogeWorkflow.ts(15,43)`: `String.prototype.replaceAll` unavailable under current TS lib target |

## Legacy round-trip

The migration checker passed the required in-memory contract: legacy defaults are added idempotently, input is not mutated, invalid input is rejected, and backup ordering is verified before the first new-format save. The exact output was `PASS workbench migration: defaults, idempotence, immutability, validation, and backup ordering`.

An actual desktop file open/save/reopen run was not performed in this acceptance invocation. The desktop/Tauri runtime was not started, so timestamped on-disk backup appearance and media byte comparison remain covered by the checker contract only.

## Generation round-trip

Character, storyboard, H3, video schema/router/normalization/continuity/quality, workflow preset/registry, concat, audio, and timeline/export checks passed in the latest authorized working-tree run. No live Comfy generation was attempted.

## Visual and desktop QA

Status: **WEB SMOKE PASS / TAURI PENDING**.

Playwright opened `http://127.0.0.1:5173/` with the Vite server and captured:

- `output/playwright/graybean-workbench.png`: six-stage navigation, compact header/status bar, inspector, and closed advanced-tools disclosure are visible.
- `output/playwright/graybean-preview.png`: the spatial preview canvas renders nonblank grid, lights, and camera scene content after switching to 预演.

The browser console only reported the missing optional `/favicon.ico` resource. A 390px mobile viewport and native Tauri open/save/reopen run remain pending.

## Known failures and shared worktree

- `check-spatial-stage-moge.mjs` now passes after the build-gate compatibility fix.
- `package.json` has no `test:video-transition-graph` alias; the acceptance runner calls the existing checker directly and it passes.
- `npm.cmd run build` passes; Vite still emits existing large-chunk advisory warnings.
- The repository had extensive unrelated dirty and untracked changes before Task8. No reset, checkout, clean, bulk staging, or product-code edits were performed.
- `package.json` was already heavily modified by concurrent work, so the new acceptance script entry remains an unstaged shared-worktree hunk rather than being mixed into an unrelated package commit.
