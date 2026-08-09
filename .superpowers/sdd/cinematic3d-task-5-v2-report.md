# Cinematic 3D Task 5 V2 Quality Remediation Report

Date: 2026-08-09

## Outcome

Implemented a pure, auditable legacy-migration trait policy for Shen Yan's second candidate run. No live ComfyUI request was made and no project/source image was modified.

## Changes

- Added `classifyMigrationTrait` and `sanitizeMigrationTraits` exports.
- Preserved core identity facts: established face shape, blue eye color, short dark-brown side-swept hair, teal tunic, navy long coat, brown belt, and brown boots.
- Rewrote `large blue eyes` to `natural-sized blue eyes` and `clean youthful animated male face` to `established adult male identity`.
- Excluded the legacy age/body-proportion lock and the clean-2D-versus-photorealism rendering lock from compiled prompts.
- Added one canonical descriptor shared byte-for-byte by front, side, and back prompts.
- Strengthened the target prompt with an adult male age range (25-30), mature facial bone structure, natural almond-shaped blue eyes and iris proportions, restrained expression, slender adult proportions, cinematic semi-realistic Chinese 3D donghua rendering, and explicit non-child/non-toy/non-western-family-animation constraints.
- Added optional `--revision`; it defaults to `1`, accepts only positive safe integers, and controls the proposed `cinematic3d-vN` identity-pack suffix. Revision `2` now produces `shen-yan-identity-v1-cinematic3d-v2`.

## TDD Evidence

RED was observed before production changes: `test:character-style-migration` failed because `buildMigrationIdentityDescriptor` was not exported. After implementation, the focused regression passed.

The test covers the exact checked-in Shen Yan fixture, exact sanitized traits and constraints, forbidden-phrase non-leakage, human-only descriptor construction, identical canonical descriptors across all three passes, source-project byte preservation, revision validation, and manifest v2 naming.

## Fresh Verification

- `npm.cmd run test:character-style-migration` — PASS
- `npm.cmd run test:character-providers` — PASS
- `npm.cmd run test:character-reference-snapshot` — PASS
- `npm.cmd run build` — PASS (existing Vite chunk-size warning only)
- `node --check scripts/run-character-style-migration.mjs` — PASS
- `node --check scripts/check-character-style-migration.mjs` — PASS
- `git diff --check -- scripts/run-character-style-migration.mjs scripts/check-character-style-migration.mjs` — PASS (Git line-ending notices only)

## Operator Follow-up

The next live run should use `--revision 2` and a new output directory. Candidates must remain `awaiting_operator_approval`; do not import them automatically.

## Review Remediation

The initial v2 review correctly identified two Important gaps. Both were addressed test-first:

- Trait handling is now fragment-aware and returns structured `canonicalFacts`. `sanitizeMigrationTraits` also returns a frozen `traitDecisions` audit record for every input item, including its kind, source, action, reason, and retained facts. `large`, `oversized`, `big`, `huge`, and `enlarged` blue-eye phrases normalize to `natural-sized blue eyes`, including mixed phrases. Mixed juvenile/style wording retains recognized eye color, hair, face-identity, and costume facts while removing the unsafe qualifier; unsafe text with no safely extractable fact is excluded.
- Every authoritative queued positive prompt now contains the exact clause `not Pixar-style, not Disney-style, not western family animation, not chibi, not toy-like, not juvenile, not a child`. Tests remove that clause and verify no conflicting positive occurrence remains.

Additional RED evidence was observed for both remediation cycles: the first failed because the old result exposed one `canonical` string, and the mixed-size regression failed because `huge blue eyes with ... hair` was still preserved wholesale. Both focused regressions now pass.
