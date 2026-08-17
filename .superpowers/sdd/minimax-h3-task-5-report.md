# MiniMax H3 Task 5 — H3 binding and existing Comfy executor reuse

## Outcome

Implemented `generateRoutedVideoShot(request)` as a deterministic H3 binding layer over the existing `generateShotAsset` executor. The new module does not implement `/prompt`, history polling, output collection, or Comfy input copying.

## Behavior covered

- H3 duration snapping follows the `17k+5` grid and the 124–362 frame bounds. The checker covers 2, 2.5, 5, 10, and 15 seconds plus non-finite/non-positive and over-15-second failures.
- R2V references are stably ranked as character face, character body, scene, then key prop; normalized-path duplicates are removed and the result is capped at four.
- Unused R2V `LoadImage` nodes, their conditioning inputs, their graph links, and their unused path tokens are removed before execution.
- Every workflow receives `VIDEO_PROMPT`, `VIDEO_WIDTH`, `VIDEO_HEIGHT`, `H3_LENGTH`, and `SEED`; I2V/FLF2V/R2V additionally receive exactly the paths consumed by the selected profile.
- The selected profile is verified against the supplied API workflow before a receipt can claim it.
- Draft TE Speed inserts one `TESpeedMiniMaxH3` after each H3 `UNETLoader` and rewires every direct downstream model consumer. Production TE Speed fails with `te_speed_draft_only` before the executor is called.
- The existing executor is called once with the supplied settings, shot, index, `"video"`, shot/assets collections, rewritten workflow, token overrides, progress callback, and abort signal.
- Receipts bind canonical SHA-256 workflow and effective-input digests plus the actual queued prompt ID and normalized output path. Supplying the same effective inputs, prompt ID/path, and `generatedAt` reproduces the same receipt.

## TDD evidence

1. Initial RED: `node scripts/check-minimax-h3-binding.mjs` failed with `ENOENT` because `videoGeneration.ts` did not exist.
2. Initial GREEN: the executable checker transpiled and ran the real TypeScript binding module and passed.
3. Profile/workflow binding RED: an R2V workflow paired with a T2V receipt claim failed only later as an unbound token rather than `h3_profile_workflow_mismatch`.
4. Profile/workflow binding GREEN: explicit semantic profile validation now rejects the mismatch before binding.
5. Executor staging RED: the checker extracted and executed the real `generateShotAsset` function in an isolated runtime. H3 T2V invoked `stageVideoFrameTokens` once even though its workflow consumed no frame token (`actual 1`, `expected 0`).
6. Executor staging GREEN: `workflowConsumesVideoFrameTokens` now gates staging. The regression matrix reports H3 T2V/R2V `0`, H3 I2V/FLF2V `1`, and a Wan-style `FRAME_IMAGE_PATH` workflow `1`.

The checker uses executable implementations. Its Comfy network/queue boundary is replaced only with an isolation stub that records the real binder/executor calls and stops before external side effects; it does not use source-string assertions as behavioral evidence.

## Fresh verification

```text
npm.cmd run test:minimax-h3-binding
PASS minimax h3 binding

node scripts/check-minimax-h3-presets.mjs
PASS minimax h3 API presets

node scripts/check-minimax-h3-profile-registry.mjs
PASS minimax h3 profile registry

node scripts/check-video-workflow-router.mjs
PASS video workflow router

node scripts/check-workflow-presets.mjs
PASS (all core and optional preset checks completed; pre-existing optional inventory notes only)

npm.cmd run build
PASS (TypeScript and Vite production build; pre-existing chunk-size advisory only)
```

## Files and dirty-worktree boundary

- Added `src/modules/video-production/videoGeneration.ts`.
- Added `scripts/check-minimax-h3-binding.mjs`.
- Added one `test:minimax-h3-binding` script to `package.json`.
- Added only a private frame-token consumption predicate and a guarded call in `src/modules/comfy-pipeline/comfyService.ts`; the existing queue/history/output implementation remains unchanged.
- Added this report.

`package.json` and `comfyService.ts` contained extensive unrelated user changes before Task 5. Their Task-specific hunks remain intentionally uncommitted because safely staging those shared files would risk including unrelated edits; no working-tree changes were reset, cleaned, or overwritten. Task 6 was not started.
