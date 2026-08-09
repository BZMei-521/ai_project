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

## Review remediation

Status: DONE. All Critical, Important, and requested Minor review findings were fixed after commit `833e419`.

### Trusted loader

- `loadTrustedEvaluator` now requires explicit, non-reserved `evaluatorId` and `evaluatorVersion`, explicit 64-hex `evaluatorImplementationHash` and `evaluatorPolicyHash`, and explicit `dimensionThreshold` in `(0, 1]`.
- Removed all ID, version, source-hash, serialized-policy-hash, and threshold fallbacks.
- Focused tests create modules missing each export and modules with reserved/invalid values; every case fails with `EEVALUATOR`.

### Snapshot integrity

- Added `siglip2-snapshot-manifest.json` with relative paths, exact sizes, and SHA-256 hashes for all seven model/processor/tokenizer files used by the worker, including the 1.5 GB safetensors file.
- The worker validates the canonical manifest digest, realpath containment, regular-file type, exact size, and streamed SHA-256 for every entry before any transformers load.
- Missing manifest/file returns `EMODEL_REVISION`; manifest, size, or content mismatch returns `EMODEL_INTEGRITY`.
- ESM implementation proof now covers exact manifest bytes plus canonical manifest digest. Worker responses and self-test report the same digest: `451ee614b7cf3349a125ffb24fa757238a455d369cb1b7ce15f6fc19b33a3b68`.
- Focused negative tests use tiny files to prove missing-file, small-file tamper, and manifest-content tamper failures without modifying the real weights.

### Policy, dimensions, transport, and lifecycle

- Active policies are structured-cloned and recursively frozen. Canonically equivalent default policy uses the exact policy-file SHA-256; modified custom policy instances receive their own canonical active-policy hash.
- Added versioned `siglip2-canonical-slots-v1` mapping: face uses face master/left/right, hair uses hair back plus face master/left/right, outfit/body use body front/side/back, and quality remains independent. Required dimensions without a matching slot fail `EREFERENCE_DIMENSION`.
- Runner passes the complete canonical local identity reference manifest to evaluation while leaving the two Comfy references per shot and 16 transformed evidence records unchanged.
- Terminal downloads now use `response.body.getReader()` with cumulative 40 MiB enforcement, immediate stream cancellation on excess, and no `arrayBuffer()` path. Missing and forged-small Content-Length streams are covered.
- Persistent client supports out-of-order IDs and fails closed on unknown, duplicate, late IDs and write failures. `close()` clears pending requests, waits for child close, then uses bounded SIGTERM/SIGKILL escalation.
- CLI SIGINT/SIGTERM handlers abort the benchmark, evaluator cleanup runs before handlers are removed, and exit codes are `130`/`143`. Programmatic evaluator ownership is unchanged.

### Review-fix verification

- RED: expanded focused checker first failed because `dimensionThreshold` was absent; after initial implementation it exposed an incorrect default-equivalent policy instance hash. Both were corrected without restoring fallbacks.
- `npm.cmd run test:character-evaluator` — PASS
- `npm.cmd run test:character-benchmark` — PASS
- `npm.cmd run test:character-generation-evidence` — PASS
- `npm.cmd run build` — PASS (`450` modules; existing Vite chunk warning only)
- Manifest-verified real worker `--self-test` — PASS on CUDA, exact revision, manifest digest above, embedding length `768`, norm `1.0`.
- Targeted Node syntax, Python syntax, and task-file whitespace checks — PASS.
