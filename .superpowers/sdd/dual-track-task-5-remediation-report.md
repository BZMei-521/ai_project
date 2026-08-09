# Task 4+5 Joint Review Remediation

Date: 2026-08-09

## Outcome

All three Critical, five Important, and one Minor findings from the joint review were remediated in the shared working tree.

### Critical findings

- **C1 — terminal MODEL path proof:** `proveCompiledCharacterLoraBinding` now requires every terminal consumer trace to be non-empty and valid even when `appliedLora` is `null`. Unknown producers/patchers fail closed. A `ThirdPartyLoRAInjector` negative fixture proves the former bypass is rejected. The benchmark runner already enforced the same strict zero-shot trace semantics and remains covered.
- **C2 — trusted policy/version binding:** current contexts now require and digest-compare `benchmarkVersion`, `promptTemplateVersion`, and `dimensionThreshold`. The threshold is valid only in `(0, 1]`. Recomputed envelopes with evil benchmark/prompt versions and a zero threshold are rejected.
- **C3 — local reference access:** identity hashing no longer uses `convertFileSrc` plus `fetch`. The frontend calls the narrow `read_trusted_character_reference` desktop command. Tauri and the Windows bridge canonicalize the path, require a non-empty regular file, allow only PNG/JPEG/WebP extensions, verify matching file magic, enforce 40 MiB, and return only validated bytes plus narrow metadata. No broad asset-protocol permission was added.

### Important and Minor findings

- **I1:** zero-shot context construction no longer requires the asset's LoRA provider to match the active generation provider. Provider/profile coupling applies only to `lora_augmented`.
- **I2:** references are copied into an exclusively owned staging directory first. The staged bytes are validated and hashed, and that exact immutable staged path is used by preprocessing/upload. The owned directory is removed when the report finishes.
- **I3:** badges asynchronously rebuild trusted contexts from current reference bytes, show pending-review while loading, show a concrete stale reason on failure/change, and revalidate every 15 seconds plus on asset/workflow/provider changes.
- **I4:** `candidateStatus` is mandatory in LoRA current-context validation. Invalid status changes return `candidate_status_mismatch`; invalidation no longer fabricates a `loraVersion` mismatch.
- **I5:** `characterEvidenceStoreRuntime.mjs` is called by production `updateAsset`. The integration harness now runs report import → the same store transition → persisted dual-track asset → production `resolveCharacterGenerationTrack` gate.
- **Minor:** evidence JSON files are rejected before `File.text()` unless their size is in `(0, 8 MiB]`.

## TDD evidence

RED:

- `npm.cmd run test:sequential-character-passes` failed because a terminal `ThirdPartyLoRAInjector` returned `ok: true` for `appliedLora: null`.
- New context tests initially failed because benchmark/prompt versions and threshold were not part of the trusted validator.
- The UI contract initially found `convertFileSrc`/`fetch` in the reference hashing path and no narrow desktop command.
- The store-chain fixture initially bypassed `updateAsset` semantics by spreading patches directly.

GREEN:

- `npm.cmd run test:character-generation-evidence` — PASS
- `npm.cmd run test:character-evaluator` — PASS
- `npm.cmd run test:character-benchmark` — PASS
- `npm.cmd run test:character-providers` — PASS
- `npm.cmd run test:sequential-character-passes` — PASS
- `npm.cmd run test:character-identity-ui` — PASS
- `npm.cmd run test:character-consistency-ui` — PASS
- `npm.cmd run test:character-consistency` — PASS
- `node scripts/check-storyboard-generation-flow.mjs` — PASS
- `node --check scripts/windows-web-server.mjs` — PASS
- `npm.cmd run build` — PASS; only the pre-existing Vite chunk-size advisory remains
- Focused `git diff --check` — PASS; line-ending conversion warnings only

## Rust verification limitation

`cargo test --manifest-path src-tauri/Cargo.toml trusted_character_reference_tests` could not run because `cargo` is not installed or available on this machine's PATH. A Rust unit test is present in `src-tauri/src/main.rs`, and the JS contract test verifies command registration plus canonicalization, regular-file, size, and magic checks. This is the only remaining verification limitation; it is not bypassed or reported as a Rust GREEN.

## Files changed in the shared dirty working tree

- `src/modules/comfy-pipeline/sequentialCharacterPassRuntime.mjs`
- `src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs`
- `src/modules/comfy-pipeline/characterEvidenceContextRuntime.mjs`
- `src/modules/comfy-pipeline/characterEvidenceContext.ts`
- `src/modules/asset-manager/characterIdentityUiRuntime.mjs`
- `src/modules/asset-manager/characterIdentityUi.ts`
- `src/modules/asset-manager/AssetPanel.tsx`
- `src/modules/storyboard-core/types.ts`
- `src/modules/storyboard-core/store.ts`
- `src/modules/platform/desktopBridge.ts`
- `src-tauri/src/main.rs`
- `scripts/windows-web-server.mjs`
- `scripts/run-character-consistency-benchmark.mjs`
- `scripts/check-character-generation-evidence.mjs`
- `scripts/check-character-consistency-benchmark.mjs`
- `scripts/check-character-identity-ui.mjs`
- `scripts/check-sequential-character-passes.mjs`

New independent file: `src/modules/storyboard-core/characterEvidenceStoreRuntime.mjs`.

No unrelated dirty file was reverted or staged.
