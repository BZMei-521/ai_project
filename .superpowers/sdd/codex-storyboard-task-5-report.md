# Task 5 report — Codex storyboard operator bridge

## Status

Complete. Commit: `e39b0d8bed9086a64dd13fbe53ef0d6c0df05908` (`feat: add Codex storyboard operator bridge`).

## Delivered

- Added an offline, Node-built-ins-only `inspect` / `complete` operator CLI. It validates the immutable request, every ordered reference snapshot (containment, stable read, SHA-256, dimensions, MIME type), preserves repeated usages, and prints the exact ordered built-in-image handoff metadata and `Picture N` prompt.
- Completion accepts only a PNG with valid signature/dimensions, writes candidate and receipt with temporary exclusive files plus atomic no-replace publication, and publishes `result.json` last. It makes no network or API calls.
- Added the fixed project-relative E01-C01 selection. It leaves Li Baozhu body/face insertion to the persisted identity-pack loader between spatial and style entries.
- Registered `npm run codex:storyboard-job`.

## Tests

- RED observed: `node scripts/check-codex-storyboard-task-package.mjs` failed because `scripts/run-codex-storyboard-job.mjs` was absent.
- GREEN: `node scripts/check-codex-storyboard-task-package.mjs` — PASS (inspection ordering, repeated style usage, mutation, missing request, path escape, exclusive completion, runtime receipt validation).
- `node scripts/check-storyboard-generation-flow.mjs` — PASS.
- `node scripts/check-storyboard-generation-state.mjs` — PASS.
- `node scripts/check-codex-storyboard-ui.mjs` — PASS.
- `npm run build` — PASS; only the existing Vite large-chunk advisory was emitted.
- `git diff --cached --check` and `git show --check HEAD` — PASS.

## Concerns

- Windows sandboxed Node invocations raised `EPERM` while resolving `C:\\Users\\Administrator`; focused tests/build were rerun with approved elevation and passed.
- The production build refreshed the tracked TypeScript incremental cache `tsconfig.app.tsbuildinfo`. It is intentionally unstaged and not part of this Task5 commit.

## P1 follow-up hardening

- Full Node-built-ins image validation now parses PNG chunk structure and CRCs, requires first/unique IHDR, IDAT and terminal IEND, rejects trailing bytes, and verifies inflated non-interlaced scanline size. JPEG validation now requires safe marker segments, consistent SOF dimensions, scan data, and a terminal EOI.
- Inspection rejects symlink path components, copies stable verified snapshots into exclusive private temporary staging, marks them read-only, re-verifies metadata, and returns that `inspectionRoot` plus staged paths.
- Completion preflights both final targets, holds and revalidates `outputs`, rechecks identity/containment around publication, and rolls back only the verified candidate it created if receipt publication fails.
- Added tests for pseudo/truncated/corrupt images, pre-existing receipt, injected receipt failure, concurrent completion, symlink package input, and output-directory write-window replacement.

## Capability-helper architecture correction

- Completion now delegates to `src-tauri/src/bin/codex-storyboard-operator.rs`: Node uses the explicitly supplied local binary or `cargo run --offline`, never a network/API call.
- The helper independently parses request/reference snapshots, retains `cap_std::fs::Dir` package and outputs handles, decodes the candidate through the Rust image crate, uses an exclusive `.complete.lock`, and supports safe candidate-only resume after a receipt-publication failure.
- Node inspection remains local and now labels `inspectionRoot` cleanup responsibility explicitly. PNG inspection additionally rejects invalid filter bytes, non-contiguous IDAT, and unknown critical chunks.
- RED: Node helper delegation initially failed before the binary existed; GREEN: offline helper tests, helper-backed focused contract, default offline Cargo fallback, Task3/4 regressions, and production build pass. Build-generated cache/schema artifacts were restored to HEAD.

## R3 review closure

- Bound package and outputs capabilities to canonical directory identities. The helper captures reparse-free canonical paths and OS handle identity before the retained `cap_std::fs::Dir` acquisition, compares the retained handle, and revalidates ambient path identity through request, manifest, candidate, candidate publication, result publication, and final handoff. A capture/open swap hook proves fail-closed behavior.
- Made the inspection manifest an independently verified authorization artifact. The helper now performs stable regular-file reads, requires exact manifest/reference fields, recomputes the canonical request digest and compiled prompt digest, preserves ordered reference digests, and re-hashes/decodes every staged snapshot. `result.finalPrompt` comes from the verified manifest. Request, package reference, and staged snapshot tampering after inspection are rejected.
- Removed `.complete.lock`. Candidate and result publication use unique exclusive temporary files and capability-relative hard links. Matching candidate-only state resumes, conflicting candidates fail, stale lock/crash temp files do not block, result remains last, and an eight-process race publishes exactly one complete pair.
- Anchored Cargo manifest and target paths to `import.meta.url`. Helper overrides must be absolute, real, regular, non-symlink files with the exact helper basename under `src-tauri/target`. Successful stdout must be exact JSON and is checked against job/request identities, contained canonical output paths, and the actual candidate/result files. Other-cwd fallback, malicious Cargo, relative override, and forged stdout cases are covered.

## R3 verification

- `cargo test --offline --manifest-path src-tauri/Cargo.toml --bin codex-storyboard-operator` — PASS (2/2).
- `cargo build --offline --manifest-path src-tauri/Cargo.toml --bin codex-storyboard-operator` — PASS.
- `node scripts/check-codex-storyboard-task-package.mjs` — PASS.
- `node scripts/check-storyboard-generation-flow.mjs` — PASS.
- `node scripts/check-storyboard-generation-state.mjs` — PASS.
- `node scripts/check-codex-storyboard-ui.mjs` — PASS.
- `npm run build` — PASS; existing Vite large-chunk advisory only.
- Generated schemas and `tsconfig.app.tsbuildinfo` restored to HEAD after build.

## R4 review closure

- Final candidate/result names are no longer linked through a retained, movable outputs handle. The helper retains a filesystem-root anchor capability and resolves both hard-link source and destination through the canonical package-relative path at the atomic publication step. If `outputs` or the package is moved after validation and temporary-file creation, publication fails and the retained handle only removes the private temp; no external `candidate.png` or `result.json` is created. Dedicated outputs/package move-window tests cover this boundary.
- Rust now enforces the full request contract before manifest processing: exact top-level, prompt, reference and expected-output keys; non-empty `createdAt`; accepted-image type; fixed output paths/MIME; identifiers, usages, instructions, digests, dimensions and MIME values. It also validates the complete generated result schema and identity/lineage before serialization. Node independently requires exact helper stdout, result and output keys plus all provider, version, mode, state, identity, lineage, prompt and output fields.
- Node completion copies the preflight PNG into an exclusive private read-only staging directory and passes its SHA-256 as `--candidate-digest`. Rust re-hashes that staged file against the explicit digest before any output work. Replacing the user-supplied source path after staging therefore still publishes and verifies the original preflight bytes, avoiding a completed package followed by a CLI-side mismatch.
- Existing offline behavior, candidate-only resume, stale-temp tolerance, conflicting-candidate rejection and the eight-process single-winner publication contract remain covered.

## R4 verification

- RED: focused Node contract rejected the old helper because an empty `createdAt` reached manifest mismatch instead of request-schema rejection; Rust result-schema unit initially failed to compile before `validate_result` existed.
- `cargo test --offline --manifest-path src-tauri/Cargo.toml --bin codex-storyboard-operator` — PASS (3/3).
- `cargo build --offline --manifest-path src-tauri/Cargo.toml --bin codex-storyboard-operator` — PASS.
- `node scripts/check-codex-storyboard-task-package.mjs` — PASS.
- `node scripts/check-storyboard-generation-flow.mjs` — PASS.
- `node scripts/check-storyboard-generation-state.mjs` — PASS.
- `node scripts/check-codex-storyboard-ui.mjs` — PASS.
- `npm run build` — PASS; existing Vite large-chunk advisory only.
- Generated schemas and `tsconfig.app.tsbuildinfo` restored to HEAD after build.

## R5 review closure

- Removed the filesystem-root publication authority. The helper now retains a package-parent capability plus bound parent/package/output identities, opens only single normal child components, rejects reparse points, and publishes through the retained outputs capability. For this Windows desktop workflow it also holds explicit `FILE_FLAG_OPEN_REPARSE_POINT` directory guards without `FILE_SHARE_DELETE` for the package parent, package, and outputs directory, so rename/junction replacement fails before the final-link operation.
- Added exact post-temp-write hooks for candidate and result publication across both outputs-directory and package-directory move-plus-junction/symlink replacement. All four cases fail closed and cannot create the stage's final artifact outside the package.
- Aligned the Rust prompt contract with the runtime/Node validator: `useCase` and `primaryRequest` remain required and typed, while runtime-valid extra prompt metadata is preserved in canonical request/manifest verification and accepted through inspect and complete.

## R5 verification

- RED: after prompt alignment, `node scripts/check-codex-storyboard-task-package.mjs` reliably failed at the first new replacement-window assertion with `0 !== 15` against the root-anchor implementation.
- `cargo test --bin codex-storyboard-operator` — PASS (3/3).
- `cargo build --bin codex-storyboard-operator` — PASS.
- `node scripts/check-codex-storyboard-task-package.mjs` — PASS, including four move-plus-link windows, metadata compatibility, candidate-only resume, and the eight-process race.
- `node scripts/check-storyboard-generation-flow.mjs` — PASS.
- `node scripts/check-storyboard-generation-state.mjs` — PASS.
- `node scripts/check-codex-storyboard-ui.mjs` — PASS.
- `npm run build` — PASS; existing Vite large-chunk advisory only.
- Generated schemas and `tsconfig.app.tsbuildinfo` restored to HEAD after build.
