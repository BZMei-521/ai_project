# Task 3 Report: Trusted Local SigLIP2 Evaluator

## Status

DONE

## Baseline and scope

- Baseline HEAD: `bdbb609`
- Implemented only the Task 3 brief's Python worker, ESM evaluator, focused checker, policy JSON, benchmark runner integration, and package script.
- Preserved unrelated dirty-worktree changes. In particular, only the Task 3 package-script hunk is intended for staging.

## Implementation

- Added an offline-only persistent NDJSON Python worker pinned to:
  - model: `google/siglip2-base-patch16-224`
  - revision: `75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2`
  - local directory: `C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models\character_evaluators\siglip2-base-patch16-224-75de2d5`
- Worker protections: regular-file and 40 MiB checks, approved decoded formats, 8192x8192 cap, decompression-bomb warnings as errors, sanitized error codes, finite normalized embeddings, deterministic decoded-image quality, and `local_files_only=True` model/processor loads.
- Added a persistent cancellable ESM worker client and evaluator. Any timeout, cancellation, malformed response, revision mismatch, invalid embedding, or protocol error closes the worker and fails closed.
- Added deterministic face/hair/outfit/body cosine scores plus an independent worker-computed quality score, per-scale weights, per-dimension floors, and shot minimum-score gating. Caller-provided scores are ignored.
- Exported explicit evaluator ID/version/policy and a content proof covering the exact ESM, Python, policy, and pinned-revision bytes.
- Updated `loadTrustedEvaluator` to consume the exported multi-file implementation and policy hashes and expose `closeEvaluator`/`requiresLocalOutput`.
- Updated the runner to download only a sanitized terminal `/view` artifact, reject an oversized declared body before buffering, require matching PNG/JPEG/WebP MIME and magic bytes, write the output exclusively to the report-sibling artifact directory, pass only the local path to the evaluator, retain only SHA-256 plus sanitized Comfy artifact in the report, pass routed local reference paths, and close the CLI evaluator.

## TDD evidence

- Initial RED: `node scripts/check-character-siglip2-evaluator.mjs` failed with `ERR_MODULE_NOT_FOUND` for the absent evaluator module.
- Later focused RED/GREEN cycles covered exported multi-file proof use, required shot view, early 40 MiB rejection, and missing Content-Type rejection.
- Fake-worker coverage includes normalization, non-finite/zero/wrong-length rejection, all five dimensions, scale weights, required-dimension floors, quality independence, exact model revision, caller-score distrust, malformed worker protocol, timeout/cancellation termination, and missing output/reference paths.
- The first real model self-test was a useful RED: weights loaded, but transformers 5.8 returned `BaseModelOutputWithPooling`. A diagnostic confirmed `pooler_output` is `[1, 768]`; the minimal compatibility fix now selects that pooled image embedding.

## Final verification

- `npm.cmd run test:character-evaluator` — PASS
- `npm.cmd run test:character-benchmark` — PASS
- `npm.cmd run test:character-generation-evidence` — PASS
- `npm.cmd run build` — PASS (`450` modules; existing Vite chunk-size warning only)
- Worker syntax compile — PASS
- Worker malformed/invalid-path NDJSON smoke — PASS (`EMALFORMED`, exact ID echo with `EIMAGE_PATH`)
- Installed snapshot inspection — PASS: config, processor/tokenizer files, and `model.safetensors` present; Hugging Face metadata records the exact pinned revision for all nine files.
- Real `--self-test` — PASS: CUDA, exact model ID/revision, embedding length `768`, embedding norm `1.0`.
- `node --check` for evaluator, runner, and focused checker — PASS

## Self-review and concerns

- No known functional or safety blocker remains.
- The snapshot was downloaded without an HF token, but the command used the full immutable revision and local metadata records that exact revision.
- Production inference never accesses the network; a missing or unreadable snapshot returns `EMODEL_MISSING`.
- Build reports the repository's existing Vite large-chunk warning; Task 3 does not add frontend bundle code.

## Commit

- Scoped commit created with message `feat: score character consistency with local SigLIP2`.
- The commit includes only the Task 3 `package.json` script hunk; other shared package changes remain unstaged.
