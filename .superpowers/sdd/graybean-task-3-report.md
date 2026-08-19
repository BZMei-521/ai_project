# Graybean Workbench Task 3 Report

## Status

Implemented versioned storyboard snapshot migration and migration-before-save backup orchestration.

## Changes

- Added `CURRENT_WORKBENCH_SCHEMA_VERSION = 2` and non-mutating `migrateStoryboardSnapshot(input)`.
- Legacy snapshots receive `directorPlan`, `spatialScenes`, `spatialObjects`, `poseKeyframes`, and `cameraPlans` defaults while unknown fields and media paths remain unchanged.
- Current snapshots migrate idempotently and return an independent clone.
- Invalid snapshot/project values and unsupported future versions are rejected before backup or save.
- Added exclusive (`wx`) timestamped migration backups so existing files are never overwritten.
- Added `saveMigratedProjectSnapshot` orchestration: a legacy snapshot is backed up before the new-format save callback; backup failure prevents the save callback.
- Left the existing dirty `src/modules/storyboard-core/types.ts` untouched because the migration service can type its additive fields without changing shared snapshot state.

## TDD Evidence

Red command:

```text
node scripts/check-workbench-migration.mjs
ERROR: Could not resolve "./src/services/persistence/workbenchMigration.ts"
```

Green command:

```text
node scripts/check-workbench-migration.mjs
PASS workbench migration: defaults, idempotence, immutability, validation, and backup ordering
```

The checker uses a controlled temporary destination and verifies the real backup file contents, backup-before-save event order, no repeated backup for an already-current snapshot, and save suppression when backup fails.

## Verification

- `node scripts/check-workbench-migration.mjs` - PASS
- `node scripts/check-video-production-schema.mjs` - PASS
- `node scripts/check-spatial-scene-domain.mjs` - PASS
- Targeted strict TypeScript check for the three implementation files - PASS
- `git diff --check` for Task 3 files - PASS

Full `npm.cmd run build` remains blocked by the pre-existing shared-worktree baseline in `src/app/App.tsx`: lines 150, 414, and 944 construct `StoryboardSnapshot` values without the already-required `spatialStages` property. No build error points to a Task 3 file.

## Scope And Safety

- No existing snapshot or media file was modified.
- No project naming or media path behavior was changed.
- No reset, checkout, clean, broad staging, or destructive repository operation was used.
- Only Task 3 files and this report are intended for the Task 3 commit.
