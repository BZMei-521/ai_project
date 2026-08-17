# MiniMax H3 Task 4 — Deterministic workflow router

## Scope

Implemented the Task 4 router runtime, typed facade, and deterministic matrix checker. This remediation addresses every P1/P2 finding in the independent review.

## TDD evidence

- Initial RED: the original checker was created before the original runtime and failed with `ERR_MODULE_NOT_FOUND`.
- Initial GREEN: the minimal ordered router passed its matrix.
- Remediation RED: before changing the runtime, the expanded checker reproduced P1. `routeVideoWorkflow(undefined)` failed with `TypeError: Cannot read properties of undefined (reading 'manualProfileId')`.
- Remediation GREEN: runtime-boundary normalization now handles absent and partial JavaScript input; the expanded checker reports `PASS video workflow router`.

## P1 remediation

- Missing/non-object input becomes a safe normalized request: `availableProfileIds: []`, counts `0`, booleans `false`, `manualProfileId: "auto"`, and `boundaryKind: "scene_change"`.
- Non-array availability data also becomes `[]`, so every `.includes` call receives an array.
- The resulting route is deterministic and safely blocked when the selected profile is unavailable, retaining the relevant `profileId` and exact `profile_unavailable:<id>` reason.
- The TypeScript facade continues to reuse Task 2 `VideoRouteInput` and `VideoRouteDecision` types, while accepting `Partial<VideoRouteInput> | undefined` to reflect the runtime boundary.

## P2 coverage

- All automatic workflows are checked in available and unavailable form: T2V, I2V, FLF2V, and R2V.
- Priority conflicts cover manual override > identity block > strong references > endpoints > storyboard > establishing.
- Hard-cut, continuous, and match-cut boundary cases are explicit.
- Production routing with both `standard` and `te_speed_preview` acceleration retains the base profile and cannot return a TE profile.
- Two controlled negative mutations dynamically load altered runtime source. Disabling the manual rule or the strong-reference rule produces a mismatch against the same priority cases, demonstrating that those assertions detect incorrect order; they are not reported as initial RED evidence.

## Verification

- `node scripts/check-video-workflow-router.mjs` — PASS
- `npm.cmd run test:video-workflow-router` — PASS
- `node scripts/check-minimax-h3-profile-registry.mjs` — PASS
- `npm.cmd run build` — PASS (existing Vite chunk-size warning only)

## Commit and risk

- Remediation commit: `fix: harden MiniMax H3 workflow routing`, containing only the Task 4 runtime, facade, checker, and this report.
- `package.json` has unrelated pre-existing unstaged changes. The existing minimal router test script remains deliberately unstaged and outside this remediation commit.
