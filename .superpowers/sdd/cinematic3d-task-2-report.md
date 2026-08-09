# Cinematic 3D Donghua Task 2 Report

Date: 2026-08-09

## Status

Implementation and required verification are complete in the shared checkout. The implementation remains uncommitted because every tracked implementation file already contained substantial user-owned/unrelated dirty work, including prerequisite identity/evidence functionality not present in `HEAD`; staging whole files or their prerequisite hunks would capture work outside Task 2.

## RED evidence

The first sandboxed runs all exited 1 before loading the scripts with `EPERM: operation not permitted, lstat 'C:\Users\Administrator'`. They were rerun outside the restricted filesystem sandbox.

### `npm.cmd run test:character-identity`

Exit 1:

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
true !== false
at scripts/check-character-identity-schema.mjs:24:8
```

The unsupported `dragonfolk` species was accepted.

### `npm.cmd run test:character-identity-ui`

Exit 1:

```text
AssertionError [ERR_ASSERTION]: trusted evidence context rejects a non-canonical style digest
actual: undefined
expected: 'style_contract_mismatch'
at scripts/check-character-identity-ui.mjs:521:8
```

The trusted context did not reject a tampered style-contract digest.

### `npm.cmd run test:character-generation-evidence`

Exit 1:

```text
AssertionError [ERR_ASSERTION]: species edits cannot retain evidence bound to the prior identity metadata digest
actual: 'trusted_receipt_unverified'
expected: 'identity_metadata_mismatch'
at scripts/check-character-generation-evidence.mjs:289:8
```

The mutated context species was not detected before receipt verification.

## GREEN implementation

- `src/modules/storyboard-core/types.ts`: added `CharacterSpeciesId`, species traits, and canonical style fields to identity packs and generation evidence contexts.
- `src/modules/comfy-pipeline/characterIdentityMetadataRuntime.mjs`: canonicalizes and validates five species IDs, human/non-human trait cardinality, and exact canonical style ID/version/digest; all fields are carried by the existing identity metadata digest.
- `src/modules/comfy-pipeline/characterEvidenceContextRuntime.mjs`: fails closed with `style_contract_mismatch`, canonicalizes identity metadata, and returns the canonical payload fields with the single metadata digest.
- `src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs`: recomputes the current context's canonical identity digest so species/style edits fail with `identity_metadata_mismatch`.
- `src/modules/asset-manager/characterIdentityUiRuntime.mjs` and `characterIdentityUi.ts`: expose exact species options and canonical style status, and preserve canonical fields through compatibility contexts.
- `src/modules/asset-manager/AssetPanel.tsx`: persists canonical defaults, displays missing legacy species as human without mutating on load, clears human traits, shows non-human trait editing, refreshes `updatedAt`, and invalidates both evidence tracks through existing identity persistence.
- Focused scripts: extended complete fixtures and negative assertions for species, trait limits, style mismatch, canonical context binding, old-asset display behavior, and stored-evidence invalidation.

## Final verification

Fresh required run after the final edits:

```text
COMMAND: npm.cmd run test:character-identity
EXIT: 0
PASS character identity schema and store persistence

COMMAND: npm.cmd run test:character-identity-ui
EXIT: 0
PASS character identity runtime and editor controls, persistence, defaults, and status presentation

COMMAND: npm.cmd run test:character-generation-evidence
EXIT: 0
character generation evidence checks passed

COMMAND: npm.cmd run test:character-evidence-attestation
EXIT: 0
PASS desktop character evidence receipt registry and anti-replay claims

COMMAND: npm.cmd run build
EXIT: 0
tsc -b && vite build
456 modules transformed
build completed in 3.57s
```

The build emitted only the existing Vite advisory for chunks larger than 500 kB.

`git diff --check` reported no whitespace errors; it only printed the repository's existing LF-to-CRLF warnings.

## Self-review

- The receipt schema was not expanded with a second digest; `identityMetadataDigest` remains the sole authenticated identity metadata claim.
- Missing/mismatched style fields fail before trusted evidence context construction, preventing legacy flat references from being relabeled on load.
- Context validation recomputes the digest from canonical source fields, so changing `species` without updating the digest cannot preserve evidence validity.
- Human traits are always cleared by persistence; non-human identities require one to eight normalized non-empty traits.
- The species selector is sourced from exactly `human`, `beastfolk`, `catfolk`, `foxfolk`, and `wolffolk`.
- No Task 3+ files were edited.

## Commit and staging boundary

No implementation file was staged. All ten Task 2 implementation/test files were already dirty before Task 2, and several contain large prerequisite changes absent from `HEAD`. Exact Task 2 staging would either fail to apply to the index or capture unrelated user-owned work. The report is the only cleanly owned file safe to stage independently.

## Concerns

- Task 2 implementation is verified but remains in the working tree for the parent to integrate with the surrounding dirty prerequisite work.
- Existing non-focused scripts with old evidence fixtures may intentionally require later migration updates; the task-specified focused suites, attestation suite, and production build are green.
