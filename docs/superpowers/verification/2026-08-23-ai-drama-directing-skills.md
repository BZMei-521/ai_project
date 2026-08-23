# AI Drama Directing Skills Verification

- Date: 2026-08-23 (Asia/Shanghai)
- Branch: `codex/integrate-ai-drama-skills`
- Scope: action performance, storyboard camera/impact, fantasy VFX, and edit transitions

## Integrated command

`npm run test:novel-directing-skills` completed with exit code 0 and reported:

- PASS novel-action-director selftest
- PASS novel-fantasy-vfx selftest
- PASS novel-storyboard selftest
- PASS novel-edit-director selftest
- PASS novel-fantasy-vfx validate/export
- PASS novel-edit-director validate/export
- PASS novel directing skills integration

Every spawned process has a 60-second timeout. The runner fails on a nonzero status, timeout/signal, empty output, missing entrypoint, malformed export, unexpected transition count, unsupported boundary type, or missing `edit-director:v1` notes.

## Workbench regressions

- `npm run test:script-transitions`: six PASS results for transition model, script import, transition store, components, integration, and video continuity planner.
- `npm run test:video-continuity-planner`: PASS.

## Skill format and deployment

`quick_validate.py` returned `Skill is valid!` for all four project skills:

- novel-action-director
- novel-storyboard
- novel-fantasy-vfx
- novel-edit-director

Recursive SHA-256 comparison of every project-owned file against each global deployment reported:

- novel-action-director: 12 files, 0 mismatches
- novel-storyboard: 12 files, 0 mismatches
- novel-fantasy-vfx: 11 files, 0 mismatches
- novel-edit-director: 11 files, 0 mismatches

The global storyboard skill retains three non-project runtime extras (`README.md`, `README.en.md`, and `assets/report.webp`); they were not deleted and are excluded from the project-owned hash set.

## Resulting boundaries

- Action owns observable body motion, performance channels, contact, support, center of mass, and impact evidence.
- Fantasy VFX owns supernatural topology, lifecycle, environment response, persistence, and generation risk without inventing outcomes.
- Storyboard owns camera purpose, path, framing, impact presentation, keyframes, and H3 production prompts.
- Edit owns only adjacent generated-segment transitions and audio bridges, exporting the existing four workbench boundary types.
