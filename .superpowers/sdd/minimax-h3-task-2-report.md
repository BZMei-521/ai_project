# MiniMax H3 Task 2 Report

## TDD evidence

- RED: `node scripts/check-minimax-h3-profile-registry.mjs`
  - Expected failure observed: `ERR_MODULE_NOT_FOUND` for
    `src/modules/video-production/workflowProfilesRuntime.mjs`.
- GREEN: `node scripts/check-minimax-h3-profile-registry.mjs`
  - Output: `PASS minimax h3 profile registry`.
- Package command: `npm.cmd run test:minimax-h3-profile-registry`
  - Output: `PASS minimax h3 profile registry`.
- Type verification: `npx.cmd tsc -b --pretty false`
  - Exit status: 0; no compiler output.

`npm run test:minimax-h3-profile-registry` could not run directly because this
machine's PowerShell execution policy blocks `npm.ps1`; `npm.cmd` ran the same
package script successfully.

## Coverage

The deterministic Node check validates the four verified inventory profiles,
R2V-only loss after removing `MiniMaxH3ReferenceToVideo`, R2V's missing
`ref2va` diffusion model report, and TE Speed overlay unavailability without
`TESpeedMiniMaxH3` while the standard base profile remains available. It also
asserts each profile's preset path, required-node list, and exact model
contracts.

## Files owned by Task 2

- `src/modules/video-production/types.ts`
- `src/modules/video-production/workflowProfilesRuntime.mjs`
- `src/modules/video-production/workflowProfiles.ts`
- `scripts/check-minimax-h3-profile-registry.mjs`
- `.superpowers/sdd/minimax-h3-task-2-report.md`

## Commit and risks

- Implementation commit: `25201f9` (`feat: register MiniMax H3 video
  capabilities`), containing only the five Task 2-owned files listed above.
- `package.json` has the new `test:minimax-h3-profile-registry` command in the
  working tree, but it is intentionally excluded from the commit: its single
  line shares a diff hunk with unrelated user changes, so it cannot be
  isolated by a minimal index patch.
- The check is fully offline/deterministic. It validates inventory input rather
  than requiring ComfyUI on port 8188.

## Review amendment: TE Speed standard-mode regression coverage

- Added a direct assertion using the same verified inventory without
  `TESpeedMiniMaxH3`: `preflightVideoAcceleration("standard",
  MINIMAX_H3_PROFILES[0].qualityTier, withoutTeSpeed)` must return exactly
  `{ available: true, warnings: [] }`.
- The existing direct assertions continue to prove that the draft TE Speed
  request is unavailable with the exact `missing_node:TESpeedMiniMaxH3`
  warning and that a base profile remains available.
- TDD note: this is a coverage-only change over already-correct runtime
  behavior. The new direct assertion passed on its first execution, so there
  is no legitimate RED result without temporarily corrupting an implementation
  the review explicitly found correct. No production implementation was
  changed to manufacture a failure.
- GREEN: `node scripts/check-minimax-h3-profile-registry.mjs` output
  `PASS minimax h3 profile registry`.
