# Shen Yan Cinematic 3D Donghua Migration Report

Date: 2026-08-09

## Approval and imported identity

- User approval: explicit confirmation received after visual inspection of the final front, side, and back candidates.
- Character asset ID: `asset_1774017261433_390` (preserved).
- Approved candidate manifest: `logs/shen-yan-hybrid-v5/hybrid-candidate-manifest.json`.
- Exported project: `examples/character-consistency-benchmark/current-project-klein-release-subject-cinematic3d.json` (machine-specific, not committed).
- New identity pack version: `shen-yan-hybrid-v5`.
- Species: `human`; `speciesTraits` is empty.
- Style contract: `cinematic_3d_donghua_v1` version `1.0.0`.
- Style contract digest: `27db8be0b246c9b931217e24caffc9606c0959b035f7a0d9714ed0c058828b88`.

## Approved canonical views

| View | Provider | SHA-256 |
| --- | --- | --- |
| Front | Z-Image Turbo, seed `2026080913` | `bb93213df418213e41cb1206e397056cbb45e34ed446274307f531f658713043` |
| Side | Flux.2 Klein 4B distilled, seed `2026080902` | `2a0ed3ef0dd1ce290f2f66d1f558d754d37a1e239b092c3189a431bf7ba2b861` |
| Back | Flux.2 Klein 4B distilled, seed `2026080903` | `2abafd0d96d0beb77441760a37872f367f4f3af0fcea4721176a313bd0a76195` |

The canonical front is the approved Z-Image hero rather than Klein's regenerated front. Klein is used only to expand the approved identity into side and back views.

## Verification

- `node scripts/check-shen-yan-cinematic3d-import.mjs`: PASS.
- Trusted reference manifest digest: `e49d062b6688deabdf0b5567e43c1a8b0191985d15ca693faba2d7412e761289`.
- Old identity version `shen-yan-identity-v1` invalidates against the imported identity with `identity_pack_version_mismatch`.
- `npm.cmd run test:character-identity`: PASS.
- `npm.cmd run test:character-consistency`: PASS.
- `npm.cmd run test:character-style`: PASS.
- `npm.cmd run test:character-style-migration`: PASS.

## Visual status and remaining gate

- Visual QA passed face, blue-eye, short-hair silhouette, costume, material, and human-only anatomy consistency across the approved three views.
- No blocking visual issue remains in the approved identity pack.
- Production benchmark evidence from the previous identity is invalid and was not carried forward.
- The new identity still requires the strict eight-shot release benchmark before production generation evidence can be marked ready.
