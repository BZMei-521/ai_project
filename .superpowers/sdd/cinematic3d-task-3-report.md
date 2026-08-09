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
- Removed the character-asset positive/negative style exclusion. Remaining global visual helper paths also use the canonical contract rather than saved custom operator text.
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

The strict character-asset gate intentionally rejects legacy callers that construct an `asset_char_*`/`import_char_anchor_*` shot without supplying the single matching persisted `Asset`. This is the required fail-closed behavior; such callers must persist/pass identity metadata before visual generation.
