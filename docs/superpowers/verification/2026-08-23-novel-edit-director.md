# Novel Edit Director Verification

- Date: 2026-08-23 (Asia/Shanghai)
- Project skill: `.agents/skills/novel-edit-director`
- Global skill: `C:\Users\Administrator\.codex\skills\novel-edit-director`

## TDD evidence

- Public API RED: selftest failed with `ERR_MODULE_NOT_FOUND` before `novel-edit-director.mjs` existed.
- Gate RED: selftest failed because `gateReport` was not exported.
- Adapter/report RED: selftest failed because `buildWorkbenchTransitions` was not exported.
- Final GREEN: `✓ edit-director public contract and 12 gates`.

The 12 gates cover source references, authored adjacency, exact pair coverage, the four workbench boundary types, six semantic methods, anchors, continuity evidence, occlusion directions, audio authority, duration bounds, risky morph routing, and workbench field compatibility.

## Skill format

Command:

```powershell
python -X utf8 C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py .agents\skills\novel-edit-director
```

Result: `Skill is valid!`.

## CLI smoke checks

The bounded smoke run completed with exit code 0 for:

- `seed <storyboard.json>`
- `validate <edit.json> --storyboard <storyboard.json>` — `✓ 通过 12 项剪辑门禁`
- `render <edit.json> --storyboard <storyboard.json> --md`
- `render <edit.json> --storyboard <storyboard.json> --html`
- `export <edit.json> --storyboard <storyboard.json> --sequence sequence-1 --out <temp>/transitions.json`

The export contained two parseable `ShotTransition` objects, was 1301 bytes, and began with `E01-01 -> E01-02`.

## Deployment identity

The project and global skill trees each contain 11 files. Recursive SHA-256 comparison reported `MISMATCHES=0`.

## Workbench regressions

The current worktree reused the main worktree's `node_modules` through a temporary directory junction. Both worktrees share the same `package-lock.json` SHA-256: `203699911A42564FE320E06B71BE2CA160BF17B61427A495489D4B52B7C6B3A6`.

- `npm run test:script-transitions`: PASS for shot transition model, script import, transition store, UI components, integration, and video continuity planner.
- `npm run test:video-continuity-planner`: PASS.
