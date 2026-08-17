# MiniMax H3 Task 4 — Deterministic workflow router

## Scope

Implemented only the Task 4 router runtime, typed facade, and deterministic matrix checker.

## TDD evidence

- **RED:** Created `scripts/check-video-workflow-router.mjs` before the runtime. Its first privileged execution failed with `ERR_MODULE_NOT_FOUND` for `videoRouterRuntime.mjs`, proving the matrix depended on the missing feature.
- **GREEN:** Added the smallest rule-ordered implementation. The checker now reports `PASS video workflow router`.

## Routing guarantees verified

- Manual profile choice has priority; an unavailable manual profile blocks with the exact requested `profileId`.
- Named characters without identity references block.
- Strong reference constraints select R2V and block if R2V is unavailable; they never downgrade.
- A continuous approved boundary selects FLF2V; a `hard_cut` does not use a boundary frame to select FLF2V.
- Production input never selects a TE Speed workflow (the router only selects the four production MiniMax profiles).

## Verification

- `node scripts/check-video-workflow-router.mjs` — PASS
- `npm.cmd run test:video-workflow-router` — PASS
- `node scripts/check-minimax-h3-profile-registry.mjs` — PASS
- `npm.cmd run build` — PASS (existing Vite chunk-size warning only)

## Commit and risk

- Commit: `feat: route shots across MiniMax H3 workflows`, containing only the new router runtime, facade, checker, and this report.
- `package.json` already had unrelated unstaged modifications. The minimal `test:video-workflow-router` script was added but will deliberately remain unstaged and out of this commit, preventing inclusion of others' work.
