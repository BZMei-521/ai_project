# Unity prototype evidence — 2026-08-26

## Isolation and scope

Branch `codex/unity-previs-prototype`, based on `cfaf1a15edb167dd70ebd8b54a73083be49bf5b7`. Worktree: `C:\Users\Administrator\Desktop\ai_project\.worktrees\unity-previs-prototype`. The main worktree and the active 「项目完善」 worktree were not modified. Its uncommitted work is not copied into this prototype.

Runtime project root below: `C:\Users\Administrator\Desktop\小说\应用项目\Unity预演试验-20260826`. All Unity caches, builds, media and logs remain outside the code repository. No asset downloads, production generation or AI requests were made.

## Executed Unity checks

Installed Unity `2022.3.62f1c1`, Windows64 Mono player, built-in rendering, actual GPU rendering on the installed RTX 5070 Ti. No headless substitute images.

`Logs/final-acceptance.log` contains all four success markers:

- `PREVIS_VALIDATION_CHECKS_PASS`
- `PREVIS_CHECKS_PASS`
- `PREVIS_RENDER_CHECKS_PASS`
- `PREVIS_BUILD_PASS`

Covered: malformed DTOs/collections, complete body18 + both hand21 mappings, safe provenance IDs, coordinate/quaternion reflection including rotated points, camera position/direction/up, local pose and descendant world-position reload, all entity IDs renamed, invalid containment/contact, edited camera-data visibility, opaque input save/reopen, mismatched source-sidecar lineage. GPU assertions cover known overlap visible/isolated masks, depth order, front-facing RH view-space normal, isolated layer color and multi-hit occlusion diagnostics.

Test-first failures are retained in `Logs/red-checks.log`, `red-render.log`, `validation-red.log`, `visibility-red.log`, `occlusion-red.log`, `layer-color-red.log`, `camera-data-red.log`. The final extra coordinate/identity/normal assertions extend existing tests and passed on existing behavior.

`Logs/final-player-smoke.log` has `PREVIS_PLAYER_SMOKE_PASS` after actual standalone exports of both scenes. `Logs/acceptance-player-smoke.log` records the final rebuild smoke run.

## Real export/import evidence

Standalone export pair:

| Scene | Export directory | Layered receipt |
| --- | --- | --- |
| Closed container / palms against lid | `Exports/run-20260826-091529-487-0bb0e09f` | 3 layers, 3 skeleton artifacts |
| Seated behind table / cup contact | `Exports/run-20260826-091529-743-57944e6e` | 5 layers, 3 skeleton artifacts |

Both passed `import-unity-previs-layered.mjs --write` after full validation. Expected scenes came from the separate preceding editor run (`run-20260826-091215-193-2029d683` and `run-20260826-091215-472-9f78c3b4`), not from the same player export being checked. This establishes editor/player fixture agreement; it is not a production SceneStage migration test. Receipts were written exclusively without overwriting previous files.

Repeated with the final acceptance build and final Node verifier: `run-20260826-092531-241-b41b86d4` and `run-20260826-092531-508-234cd16a`, expected scenes from independent editor runs `run-20260826-092241-946-432c8fb1` and `run-20260826-092242-242-2e6665ce`. Both validated and wrote exclusive receipts; `acceptance-player-smoke.log` confirms `PREVIS_PLAYER_SMOKE_PASS`.

Root inspected real color renders of both scenes and container normal, visible mask, body pose and hand pose. Controls use the same camera and visibly correspond to the gray geometry. Each hand map has five chains; fingers remain small/foreshortened in the container shot and require user review before AI trial. No identity or final-image success is inferred from them.

## Interactive check

Opened the actual Windows executable. Foreground screenshot revealed a wrapped FOV label; widened its label area and rebuilt. Clicked the 「桌后持杯」 button in the running program and inspected the changed scene and corrected FOV label. Screenshot: `interactive-final.png`. The scrollable control pane includes save/load/export below the visible fold. Not every slider/button was exercised through OS input; corresponding save/load, transforms, contact and export behavior is covered by runtime checks.

## Node and regression checks

Root executed:

```text
node --test scripts/check-unity-previs-contract.mjs scripts/check-unity-previs-adapter.mjs scripts/check-unity-previs-layered.mjs
node scripts/check-spatial-layer-contract.mjs
node scripts/check-spatial-preflight.mjs
node scripts/check-layered-spatial-control-pack.mjs
```

All three new script suites and all three existing spatial checks passed. Review found missing malformed-input coverage and ineffective negative-test baselines; those findings and final resolution are tracked in `unity-final-review.md`. Tests reuse the locally available Node runtime; this is not a clean-machine installation test.

Final root rerun after review fixes: 3 script suites passed, 0 failures. Export tests now start and end with a complete valid 16x16 fixture and assert specific rejection reasons. Corrupt PNG tests update the file hash; stale scene tests update the scene hash, isolating the relevant guard. Reordered/float32 exchange passes. A new panorama regression failed before the missing guard was added, then passed. The independent final re-review reports N1–N7 resolved within scope.

## Acceptance boundary

Working prototype and actual file exchange are demonstrated. Full production rig/mesh/constraint import, workbench UI integration, IK, animation, high-precision depth, and downstream model-specific encoding conversion are not implemented. SceneStage adapter is an explicit primitive-only subset; unsupported data or edits stop with errors. See integration README for exact limits.

User visual acceptance of A–C remains pending. Stage D (AI generation trial) has not started and requires that approval. Do not merge this experimental branch or replace the production preview merely because the prototype tests pass.
