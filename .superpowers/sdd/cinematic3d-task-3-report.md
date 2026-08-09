# Cinematic 3D Task 3 Report

## Status

Implemented the canonical cinematic 3D donghua style/species contract across the request-level character-asset, storyboard image/redraw, and video token paths.

## RED evidence

- `node scripts/check-storyboard-generation-flow.mjs` failed because an identity `human` versus exact `Shot.tags` value `species:wolffolk` reached the desktop queue gate instead of rejecting with `species_metadata_conflict`.
- `npm.cmd run test:character-style` failed because the production request-level contract composer did not exist.
- `npm.cmd run test:character-consistency-ui` failed because panel defaults were not sourced from the canonical contract and custom operator text had no non-versioned diagnostic.
- The existing compiled-reference verifier already rejected an added style `LoadImage` reaching `ReferenceLatent`; the new regression records this separation behavior.

## GREEN implementation

- Added `applyCharacterStyleContractForRequest` in `comfyService.ts` and wired it into both `generateShotAsset` and `generateShotAssetOutputs` after token overrides and before reference preparation/queueing.
- Character-asset requests match exactly one character `Asset` by the existing `assetOutputContext.assetName`.
- Storyboard/video requests resolve only explicit `shot.characterRefs`; a missing/ambiguous referenced character fails reference validation before species routing.
- Species routing reads only persisted `characterIdentityPack.species` / `speciesTraits` and exact `Shot.tags`. It does not inspect story prompts, notes, dialogue, costume strings, or scene descriptions.
- Every visual request receives the canonical positive/negative contract and per-character human/beastfolk clauses. Audio remains unchanged.
- Removed the character-asset positive/negative style exclusion. Canonical settings use the versioned contract; saved custom operator text remains unversioned and is preserved in prompt strings.
- Panel defaults now come from `CINEMATIC_3D_DONGHUA_CONTRACT`. Saved custom text remains editable and displays `鑷畾涔夐鏍兼湭鐗堟湰鍖栵紝涓嶈兘鐢熸垚鍙戝竷璇佹嵁`; it is not assigned the canonical contract identity or digest.
- Added executable assertions for character-asset, storyboard, video, conflict rejection, exactly two Klein identity loaders, absence of style-reference loaders, and style-image branch rejection with `compiled_reference_binding_mismatch`.

## Verification

All required Task 3 commands exited 0:

- `npm.cmd run test:character-style`
- `npm.cmd run test:character-consistency`
- `npm.cmd run test:sequential-character-passes`
- `npm.cmd run test:character-reference-snapshot`
- `npm.cmd run test:character-consistency-ui`
- `node scripts/check-storyboard-generation-flow.mjs`
- `npm.cmd run build`

The Vite build emits only its pre-existing large-chunk advisory.

## Staging boundary

The implementation remains unstaged because `src/modules/comfy-pipeline/comfyService.ts` and `ComfyPipelinePanel.tsx` contain extensive shared prerequisite edits, while the two executable flow/UI scripts are shared untracked files and `check-character-style-contract.mjs` already contains Task 1/2 work. Staging any complete implementation file would mix unrelated or intentionally uncommitted prerequisite work. Only this exclusive Task 3 report is safe to stage and commit.

## Concern

No open implementation blocker. The current store rejects a character skeleton without a file/front path and that store is outside Task 3 ownership, so first generation without a persisted identity now fails closed with `action=save_character_identity_before_generation`. No species/style identity is fabricated. Duplicate matches fail with `action=deduplicate_character_assets`.

## Review remediation

The three Important/P1 review findings were fixed in the current shared working tree:

1. `ComfyPipelinePanel.tsx` now routes all six real character reference/cleanup/three-view/anchor generation call sites through `resolveCharacterAssetGenerationStyleAssets`. Exactly one persisted match is required and passed. Missing and duplicate records fail before queueing with actionable error codes. The executable style check bundles the real panel export, resolves a persisted identity asset, and composes it through the bundled service.
2. Style composition now distinguishes an exact canonical positive+negative pair from operator custom text. Canonical requests receive contract ID/version/digest. Custom text is injected into image/video prompt strings, canonical identifiers are removed, and trusted sequential publication rejects with `unversioned_visual_style_evidence_blocked`. The existing visible panel diagnostic remains the operator-facing explanation.
3. Human characters are no longer sent through the runtime's global human negative builder. All-human requests receive named human exclusions; mixed human/non-human requests keep the human anatomy clause positive and omit global `no animal ears` / `no tail`, preserving declared catfolk anatomy. Both storyboard-image and video mixed-species regressions execute against the production request composer.

### Remediation verification (2026-08-09)

All commands exited 0:

- `npm.cmd run test:character-style` — PASS
- `npm.cmd run test:character-consistency-ui` — PASS
- `node scripts/check-storyboard-generation-flow.mjs` — PASS
- `npm.cmd run test:character-consistency` — PASS
- `npm.cmd run test:sequential-character-passes` — PASS
- `npm.cmd run test:character-reference-snapshot` — PASS
- `npm.cmd run build` — PASS (`tsc -b` and Vite; only the existing large-chunk advisory)
- `git diff --check -- <Task 3 owned files>` — PASS

### Changed files and self-review

- `src/modules/comfy-pipeline/comfyService.ts`: canonical/custom style routing, unversioned stamping removal/publication guard, scoped mixed-species composition, production settings propagation.
- `src/modules/comfy-pipeline/ComfyPipelinePanel.tsx`: persisted exact-match character identity resolver and six production caller integrations.
- `scripts/check-character-style-contract.mjs`: real panel-to-service character path, canonical/custom stamping, mixed storyboard/video regressions.
- `scripts/check-character-consistency-ui.mjs`: static production caller and unversioned publication guard checks.
- `.superpowers/sdd/cinematic3d-task-3-report.md`: this remediation record.

Self-review confirmed style/species data still enters only string token fields; custom input cannot retain preexisting canonical token identifiers; ambiguous persisted character assets are not silently collapsed; mixed requests contain catfolk positive anatomy without global human anatomy exclusions; and no identity-reference loader graph behavior was changed.

## Final P1 persisted-identity remediation

Removed the provisional in-memory `Asset` bypass entirely. `resolveCharacterAssetGenerationStyleAssets` now returns only one exact persisted character `Asset`; zero and duplicate matches throw visible, actionable errors before any Comfy queue operation. The service repeats the same fail-closed validation for direct callers.

Coverage now proves:

- one persisted exact-match identity succeeds through the bundled real panel resolver and production service composer;
- a missing persisted record rejects with `character_asset_identity_missing_persisted`;
- duplicate persisted records reject with `character_asset_identity_ambiguous_persisted`;
- an explicitly persisted beastfolk identity keeps `beastfolk anatomy`, ear-tuft, and tail traits on its first generation without human exclusions;
- no `provisional_character_` path remains in the panel.

### Final P1 verification (2026-08-09)

All commands exited 0:

- `npm.cmd run test:character-style` — PASS
- `npm.cmd run test:character-consistency-ui` — PASS
- `node scripts/check-storyboard-generation-flow.mjs` — PASS
- `npm.cmd run test:character-consistency` — PASS
- `npm.cmd run test:sequential-character-passes` — PASS
- `npm.cmd run test:character-reference-snapshot` — PASS
- `npm.cmd run build` — PASS (`tsc -b` and Vite; only the existing large-chunk advisory)
- `git diff --check -- <Task 3 owned files>` — PASS
