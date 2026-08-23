# RunningHub Task 5 Account Handoff

## Resume Protocol

1. Start with read-only checks only. Read this file, `.superpowers/sdd/progress.md`, the RunningHub plan, and the Task 6 brief before modifying anything.
2. Confirm the branch, HEAD, staged paths, and dirty status. This is a shared, deliberately dirty worktree.
3. Preserve every dirty and untracked path. Do not run `git reset`, `git checkout`, `git clean`, or `git add -A`. Do not unstash, discard, or reformat unrelated files.
4. Do not commit the current worktree wholesale. Any later commit must use exact, reviewed task-owned hunks only after checking the existing index.
5. Continue with a fresh Task 6 worker and an independent read-only review. Do not re-run an old pending command from the prior account.

## Exact Checkpoint

- Workspace: `C:\Users\Administrator\Desktop\ai_project`
- Branch: `codex/minimax-h3-video-routing-wipbase`
- HEAD: `e1ebf0baba50c702adafc3efae8fb41fb37d06dc`
- Staged paths, intentionally left untouched:
  - `docs/superpowers/plans/2026-08-20-runninghub-complex-shot-routing.md`
  - `docs/superpowers/specs/2026-08-20-runninghub-complex-shot-routing-design.md`
- The worktree has a large pre-existing set of modified and untracked files across unrelated character, spatial-stage, MiniMax, and story features. This is expected. Do not treat the raw `git status` count as task scope.

## Completed In This Run

### RunningHub Task 1: Complex-shot recommendation

- Added deterministic recommendation reasons and typed facade.
- Local MiniMax H3 remains the default. RunningHub is only recommended for complex shots.
- Focused cloud-routing and existing video-router tests passed. Independent review CLEAN.

### RunningHub Task 2: Approval/state/persistence

- Added exact approval snapshots, canonical hashes, self-validation, one-use consumption, strict lifecycle transitions, and `runningHubCloud` persistence/invalidation.
- Focused cloud-routing, production schema, and TypeScript tests passed. Independent review CLEAN.

### RunningHub Task 3: Manual cloud handoff

- Added review UI and an exact pinned workflow handoff: `2090035427871903746` at `https://www.runninghub.cn/workflow/2090035427871903746?source=workspace`.
- The application opens the page only after user approval; it does not run the cloud workflow, use browser credentials, or call a custom-workflow API.
- Tauri and Windows Web Bridge paths enforce selected-project containment, no-clobber atomic handoffs, final revalidation, and exact packet integrity. Web Bridge is protected from alternate projects/junctions.
- Focused UI, Web Bridge, schema, router, H3, TypeScript, and Rust checks passed. Final independent review CLEAN.

### RunningHub Task 4: Result import and RIFE recovery

- Added safe local import for a user-selected RunningHub MP4. Native code performs trusted ffprobe/decode/frame/timestamp/FPS/dimension/duration checks.
- Imported media is copied without overwrite to `runninghub-results/<taskId>/<sha256>/source.mp4` under the selected project's assets root.
- The native boundary recomputes the canonical approval SHA-256, persists/reloads exact `approval.json` and `submission.json`, and does not trust request-carried task authorization.
- Only a failed/error status with the known RIFE tuple signature is eligible for primary-output recovery. `generatedVideoPath` remains unset until watermark disposition is clean.
- Web Bridge does not expose result import, so it fails closed rather than accepting untrusted browser-side probe metadata.
- Passed: `npm.cmd run test:runninghub-result`, `cargo test --manifest-path src-tauri/Cargo.toml runninghub -- --nocapture` (4/4), `npx.cmd tsc --noEmit -p tsconfig.app.json --pretty false`. Final review CLEAN.

### Cross-shot character consistency Task 5: Sequential passes

- Existing working-tree implementation has been independently reviewed to CLEAN.
- It consumes `buildCharacterPassPlan`, stages at most three active-character references, applies all nine required active-character tokens, and protects accepted prior masks during later passes.
- It begins from the clean scene, validates before compositing/publishing, skips old dual-character Stage B under consistency mode, applies close/medium refinement constraints, and persists transactional `ShotLayer` data.
- Remediation added commercial-provider fallback using `selectCharacterProvider`; it selects a ready commercial provider with its provider-specific workflow. No eligible provider fails with `character_provider_unavailable:no_eligible_commercial_provider`.
- Passed: `npm.cmd run test:sequential-character-passes` and `npx.cmd tsc -b --pretty false`. Final independent review CLEAN.

## Evidence And Reports

- Main ledger: `.superpowers/sdd/progress.md`
- RunningHub plan: `docs/superpowers/plans/2026-08-20-runninghub-complex-shot-routing.md`
- RunningHub reports: `.superpowers/sdd/task-1-report.md` through `.superpowers/sdd/task-5-report.md`
- Task briefs: `.superpowers/sdd/task-1-brief.md` through `.superpowers/sdd/task-5-brief.md`

## Next Work: Task 6

Read `.superpowers/sdd/task-6-brief.md` in full and then its canonical plan before editing. Task 6 is the next unstarted node for this sequence. It must remain downstream of the Task 4 watermark gate: imported cloud MP4s must not become final published video until the watermark disposition is explicitly clean.

Before implementation, run read-only inspection of the Task 6 ownership boundaries and existing dirty hunks. Use a fresh implementer followed by an independent read-only reviewer. Keep the manual RunningHub model: recommendation and user-confirmed page opening only, never automated cloud submission.

## Known Environment Notes

- Node commands inside the restricted sandbox can fail with `EPERM lstat C:\Users\Administrator`. Tests previously passed under approved/root execution; report the distinction accurately if it recurs.
- A full TypeScript build can be blocked if it tries to write pre-existing dirty `tsconfig.app.tsbuildinfo`; prefer `npx.cmd tsc --noEmit -p tsconfig.app.json --pretty false` when preserving that file matters.
- No Task 6 work has been started in this account session after Task 5 review.
