# MiniMax H3 Task 5 — H3 binding and existing Comfy executor reuse

## Outcome

Implemented `generateRoutedVideoShot(request)` as a deterministic H3 binding layer over the existing `generateShotAsset` executor. The new module does not implement `/prompt`, history polling, output collection, or Comfy input copying.

## Behavior covered

- H3 duration snapping follows the `17k+5` grid and the 124–362 frame bounds. The checker covers 2, 2.5, 5, 10, and 15 seconds plus non-finite/non-positive and over-15-second failures.
- R2V references are stably ranked as character face, character body, scene, then key prop; normalized-path duplicates are removed and the result is capped at four.
- Unused R2V `LoadImage` nodes, their conditioning inputs, their graph links, and their unused path tokens are removed before execution.
- Every workflow receives `VIDEO_PROMPT`, `VIDEO_WIDTH`, `VIDEO_HEIGHT`, `H3_LENGTH`, and `SEED`; I2V/FLF2V/R2V additionally receive exactly the paths consumed by the selected profile.
- The selected profile is bound to the full canonical Task 1 preset before any binder transform or executor call. Model filenames, every node/input/edge, sampler/scheduler, output chain, and absence of unknown nodes must match; any `{{...}}` token not covered by the final token set is rejected regardless of spelling/case.
- Draft TE Speed inserts one `TESpeedMiniMaxH3` after each H3 `UNETLoader` and rewires every direct downstream model consumer. Production TE Speed fails with `te_speed_draft_only` before the executor is called.
- The existing executor is called once with the supplied settings, shot, index, `"video"`, shot/assets collections, rewritten workflow, token overrides, progress callback, and abort signal.
- Receipts are computed only from the executor's queue-accepted attestation and successful return proof: the post-style, post-staging, post-token-replacement/coercion/object-info canonical queued graph, effective inputs, prompt ID, Comfy provenance, and output identity. Plan digests are explicitly named `planned*` and are never used as receipt evidence.
- Routed H3 enables strict Comfy execution. Queue failure, post-queue terminal failure, abort, missing/mismatched proof, missing output identity, settings-level local motion, or any legacy fallback rejects without an H3 receipt; legacy callers retain fallback by default.

## TDD evidence

1. Initial RED: `node scripts/check-minimax-h3-binding.mjs` failed with `ENOENT` because `videoGeneration.ts` did not exist.
2. Initial GREEN: the executable checker transpiled and ran the real TypeScript binding module and passed.
3. Profile/workflow binding RED: an R2V workflow paired with a T2V receipt claim failed only later as an unbound token rather than `h3_profile_workflow_mismatch`.
4. Profile/workflow binding GREEN: explicit semantic profile validation now rejects the mismatch before binding.
5. Executor staging RED: the checker extracted and executed the real `generateShotAsset` function in an isolated runtime. H3 T2V invoked `stageVideoFrameTokens` once even though its workflow consumed no frame token (`actual 1`, `expected 0`).
6. Executor staging GREEN: `workflowConsumesVideoFrameTokens` now gates staging. The regression matrix reports H3 T2V/R2V `0`, H3 I2V/FLF2V `1`, and a Wan-style `FRAME_IMAGE_PATH` workflow `1`.
7. Canonical authenticity RED: changing only the T2V UNET model preserved the conditioning shape and was accepted; the checker reported `Missing expected rejection` and the executor ran.
8. Canonical authenticity GREEN: full canonical preset comparison now rejects ten same-shaped mutations (UNET, CLIP, VAE, sampler, scheduler, CreateVideo, SaveVideo, unknown node, changed edge, and lowercase residual token), each with executor count `0`.
9. Queue attestation RED: the isolated real executor completed queue/output successfully but exposed zero queue attestations (`actual 0`, `expected 1`).
10. Queue attestation GREEN: callback and return proof now identify the exact graph captured by the queue stub, styled prompt, staged I2V/FLF2V basenames, coerced values, object-info mutation, prompt ID, and output identity.
11. Strict fallback RED: with the strict guards temporarily absent, a queue failure was swallowed by legacy local-video fallback (`Missing expected rejection`).
12. Strict fallback GREEN: queue error, queued terminal error, abort, and settings-level local motion all reject with `localFallbackCalls === 0`; a non-strict legacy call still falls back without a Comfy proof.
13. End-to-end GREEN: the real binder delegates to the extracted real executor. Its receipt digest equals the executor's actual queued graph digest, differs from the unexecuted preset digest, and a terminal failure after prompt acceptance throws without a receipt.

The checker uses executable implementations. It transpiles the real binder and extracts/transpiles the real `generateShotAsset` function plus its private Task 5 helpers. Only filesystem/network/queue/history/output dependencies are isolated with deterministic stubs; the executor's control flow runs through successful output, terminal failure, abort, and fallback decisions. No source-string assertion is used as behavioral evidence.

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
- Added the private frame-token staging predicate plus minimal optional queue-attestation, successful execution-proof, and strict no-fallback wiring in `src/modules/comfy-pipeline/comfyService.ts`; existing queue/history/output mechanics remain the sole execution path and legacy defaults are unchanged.
- Added this report.

`package.json` and `comfyService.ts` contained extensive unrelated user changes before Task 5. Their Task-specific hunks remain intentionally uncommitted because safely staging those shared files would risk including unrelated edits; no working-tree changes were reset, cleaned, or overwritten. Task 6 was not started.
