# Task 4+5 Remediation Round 2

Date: 2026-08-09

## Outcome

The remaining three Important findings and one Minor finding are fixed in the shared working tree. No unrelated dirty changes were reverted.

## Fixes

### I1 — identity metadata permanently binds evidence

- Added a shared browser/Node-safe canonical identity metadata runtime.
- `identityMetadataDigest` is SHA-256 over normalized `triggerWord`, `immutableTraits`, and `forbiddenChanges`. Text uses NFKC normalization, trimming, and whitespace collapse; identity lists are de-duplicated and code-unit sorted.
- The benchmark runner and the app trusted-context builder import the same canonical implementation.
- The digest is required and digest-bound in mode-aware reports, stored evidence, current contexts, imports, and TypeScript types. Pre-digest mode-aware reports/evidence fail closed.
- Reference paths and timestamps are deliberately excluded: reference bytes remain bound by `referenceManifestDigest`, while `updatedAt` is not identity semantics.
- A regression edits an immutable hair trait without changing the identity version, rebuilds the trusted context asynchronously, and proves both stored validation and the production `resolveCharacterGenerationTrack` gate still reject the old evidence with `identity_metadata_mismatch`.

### I2 — zero-shot rejects any active supported static LoRA

- `proveCompiledCharacterLoraBinding(..., appliedLora: null)` now checks every traced terminal-path LoRA binding, not only template token-bound bindings.
- A non-token-bound `LoraLoaderModelOnly` using `evil.safetensors` at strength `1` is rejected.
- The existing inert token-bound empty/zero LoRA fixture and legitimate pure zero-shot paths remain accepted.

### I3 — legacy stored LoRA preserves current candidate status

- Legacy validation no longer overwrites `context.candidateStatus` with the stored evidence status.
- `dataset_ready` legacy evidence against a current `training` context returns `candidate_status_mismatch`.
- The explicit legacy migration envelope remains supported; identity metadata digest is mandatory only for the newer mode-aware evidence envelope.

### Minor — precise UI stale reasons for LoRA edits

- Added `inferCharacterLoraEvidenceInvalidationReason` and wired `AssetPanel` to it.
- Filename, strength, provider, status, model, and version edits now surface `lora_name_mismatch`, `strength_mismatch`, `provider_mismatch`, `candidate_status_mismatch`, `model_mismatch`, and `lora_version_mismatch` respectively.
- Direct runtime regressions cover filename, strength, provider, status, and version.

## TDD evidence

RED observed before implementation:

- Metadata digest context mutation returned `ok` instead of `identity_metadata_mismatch`.
- The new static supported-loader `evil.safetensors` fixture was accepted in zero-shot mode.
- Legacy `dataset_ready` evidence accepted a current `training` context because validation self-overrode the status.
- The UI had only a hard-coded `lora_version_mismatch` reason.

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
- `node --check` on the new canonical runtime, evidence runtime, and runner — PASS
- `npm.cmd run build` — PASS; only the existing Vite chunk-size advisory remains
- Focused `git diff --check` — PASS; line-ending conversion warnings only

## Files changed

New independent runtime:

- `src/modules/comfy-pipeline/characterIdentityMetadataRuntime.mjs`

Shared dirty working-tree files updated in place:

- `src/modules/comfy-pipeline/characterEvidenceContextRuntime.mjs`
- `src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs`
- `src/modules/comfy-pipeline/sequentialCharacterPassRuntime.mjs`
- `src/modules/asset-manager/characterIdentityUiRuntime.mjs`
- `src/modules/asset-manager/characterIdentityUi.ts`
- `src/modules/asset-manager/AssetPanel.tsx`
- `src/modules/storyboard-core/types.ts`
- `scripts/run-character-consistency-benchmark.mjs`
- `scripts/check-character-consistency-benchmark.mjs`
- `scripts/check-character-generation-evidence.mjs`
- `scripts/check-character-identity-ui.mjs`
- `scripts/check-sequential-character-passes.mjs`

No Rust files were changed in this remediation round.
