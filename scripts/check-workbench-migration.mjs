import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";

const repoRoot = process.cwd();
const result = await build({
  stdin: {
    contents: `
      export * from "./src/services/persistence/workbenchMigration.ts";
      export { createMigrationBackup } from "./src/modules/persistence/backupSnapshot.ts";
      export { saveMigratedProjectSnapshot } from "./src/modules/persistence/projectFile.ts";
      export { loadSnapshotThroughDesktopBridge, saveSnapshotThroughDesktopBridge } from "./src/modules/persistence/desktopProject.ts";
      export { useStoryboardStore } from "./src/modules/storyboard-core/store.ts";
      export { createStoryboardSnapshot } from "./src/modules/storyboard-core/store.ts";
      export { choosePreferredDesktopSnapshot } from "./src/modules/persistence/desktopSnapshotSync.ts";
    `,
    loader: "ts",
    resolveDir: repoRoot,
    sourcefile: "workbench-migration-check.ts"
  },
  absWorkingDir: repoRoot,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});
const bundle = result.outputFiles[0]?.text;
assert.ok(bundle, "workbench migration bundle should be available");
const runtime = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const {
  CURRENT_WORKBENCH_SCHEMA_VERSION,
  createMigrationBackup,
  createStoryboardSnapshot,
  choosePreferredDesktopSnapshot,
  migrateStoryboardSnapshot,
  loadSnapshotThroughDesktopBridge,
  saveMigratedProjectSnapshot,
  saveSnapshotThroughDesktopBridge,
  useStoryboardStore
} = runtime;

assert.equal(CURRENT_WORKBENCH_SCHEMA_VERSION, 2);

const legacy = Object.freeze({
  project: Object.freeze({ id: "p1" }),
  shots: Object.freeze([]),
  assets: Object.freeze([]),
  mediaRoot: "media/unchanged",
  futureLegacyField: Object.freeze({ retained: true })
});
const legacyBefore = JSON.stringify(legacy);
const first = migrateStoryboardSnapshot(legacy);
assert.equal(first.migrated, true);
assert.equal(first.snapshot.schemaVersion, 2);
assert.equal(first.snapshot.directorPlan, null);
for (const field of ["spatialScenes", "spatialObjects", "poseKeyframes", "cameraPlans"]) {
  assert.deepEqual(first.snapshot[field], [], `${field} should default to an empty array`);
}
assert.equal(first.snapshot.mediaRoot, "media/unchanged");
assert.deepEqual(first.snapshot.futureLegacyField, { retained: true });
assert.ok(first.warnings.length > 0, "legacy migration should report fields that could not be inferred");
assert.equal(JSON.stringify(legacy), legacyBefore, "migration must not mutate its input");
assert.notStrictEqual(first.snapshot, legacy, "migration must return a cloned snapshot");

const second = migrateStoryboardSnapshot(first.snapshot);
assert.equal(second.migrated, false);
assert.deepEqual(second.snapshot, first.snapshot);
assert.deepEqual(second.warnings, []);
assert.notStrictEqual(second.snapshot, first.snapshot, "idempotent migration still returns an independent snapshot");

assert.throws(() => migrateStoryboardSnapshot({ project: null }), /project/i);
assert.throws(() => migrateStoryboardSnapshot(null), /snapshot/i);
assert.throws(() => migrateStoryboardSnapshot({ project: { id: "" }, shots: [], assets: [] }), /project.*id/i);
assert.throws(() => migrateStoryboardSnapshot({ project: { id: "p1" }, shots: null, assets: [] }), /shots/i);
assert.throws(() => migrateStoryboardSnapshot({ project: { id: "p1" }, shots: [], assets: null }), /assets/i);
for (const [field, invalid] of [
  ["spatialScenes", null],
  ["spatialObjects", {}],
  ["poseKeyframes", [null]],
  ["cameraPlans", "invalid"]
]) {
  assert.throws(
    () => migrateStoryboardSnapshot({ project: { id: "p1" }, shots: [], assets: [], [field]: invalid }),
    new RegExp(field, "i")
  );
}

{
  const loadCommands = [];
  const loaded = await loadSnapshotThroughDesktopBridge(async (command) => {
    loadCommands.push(command);
    return legacy;
  });
  assert.deepEqual(loadCommands, ["load_current_project"]);
  assert.equal(loaded.schemaVersion, 2);
  assert.deepEqual(loaded.cameraPlans, []);
  assert.equal(loaded.migrationBackupPending, true, "legacy load must retain pending backup provenance");
  const futureLegacyField = { retained: true };

  const initialState = useStoryboardStore.getState();
  try {
    useStoryboardStore.getState().hydrateFromSnapshot(loaded);
    assert.equal(useStoryboardStore.getState().migrationBackupPending, true);
    const hydratedSnapshot = createStoryboardSnapshot(useStoryboardStore.getState());
    const firstSaveEvents = [];
    await saveSnapshotThroughDesktopBridge(
      hydratedSnapshot,
      async (command, args) => {
        firstSaveEvents.push(command);
        if (command === "create_migration_backup") {
          assert.deepEqual(args.snapshot.futureLegacyField, futureLegacyField);
          return { backupPath: "first-migration.json" };
        }
        assert.equal(args.snapshot.migrationBackupPending, false, "persisted v2 snapshot clears pending provenance");
        assert.equal(args.snapshot.migrationBackupSource, undefined, "runtime migration source must not enter persisted payload");
        return { projectPath: "project.sbproj" };
      },
      () => useStoryboardStore.getState().completeWorkbenchMigration()
    );
    assert.deepEqual(firstSaveEvents, ["create_migration_backup", "save_current_project"]);
    assert.equal(useStoryboardStore.getState().migrationBackupPending, false);

    const secondSaveEvents = [];
    await saveSnapshotThroughDesktopBridge(
      { ...loaded, migrationBackupPending: useStoryboardStore.getState().migrationBackupPending },
      async (command) => {
        secondSaveEvents.push(command);
        return { projectPath: "project.sbproj" };
      }
    );
    assert.deepEqual(secondSaveEvents, ["save_current_project"], "second save must not create another backup");

    useStoryboardStore.getState().hydrateFromSnapshot(loaded);
    const failedEvents = [];
    await assert.rejects(
      saveSnapshotThroughDesktopBridge(
        { ...loaded, migrationBackupPending: useStoryboardStore.getState().migrationBackupPending },
        async (command) => {
          failedEvents.push(command);
          throw new Error("first backup failed");
        },
        () => useStoryboardStore.getState().completeWorkbenchMigration()
      ),
      /first backup failed/
    );
    assert.deepEqual(failedEvents, ["create_migration_backup"]);
    assert.equal(useStoryboardStore.getState().migrationBackupPending, true, "failed backup keeps provenance pending");

    const concurrentEvents = [];
    let releaseBackup;
    const backupGate = new Promise((resolve) => { releaseBackup = resolve; });
    let releaseSave;
    const saveGate = new Promise((resolve) => { releaseSave = resolve; });
    const concurrentInvoker = async (command) => {
      concurrentEvents.push(command);
      if (command === "create_migration_backup") {
        await backupGate;
        return { backupPath: "concurrent-migration.json" };
      }
      await saveGate;
      return { projectPath: "project.sbproj" };
    };
    const concurrentA = saveSnapshotThroughDesktopBridge(loaded, concurrentInvoker);
    const concurrentB = saveSnapshotThroughDesktopBridge(loaded, concurrentInvoker);
    releaseBackup();
    await Promise.resolve();
    const concurrentC = saveSnapshotThroughDesktopBridge(loaded, concurrentInvoker);
    releaseSave();
    await Promise.all([concurrentA, concurrentB, concurrentC]);
    assert.equal(concurrentEvents.filter((command) => command === "create_migration_backup").length, 1);
  } finally {
    useStoryboardStore.setState(initialState, true);
  }
}

{
  const destination = path.join(tmpdir(), "graybean-migration-controlled");
  const events = [];
  let savedSnapshot;
  const savedPath = await saveSnapshotThroughDesktopBridge(legacy, async (command, args) => {
    events.push(command);
    if (command === "create_migration_backup") {
      assert.deepEqual(args.snapshot, legacy, "desktop backup command receives untouched legacy input");
      return { backupPath: path.join(destination, "migration-backup-20260819T010203.004Z.json") };
    }
    assert.equal(command, "save_current_project");
    savedSnapshot = args.snapshot;
    return { projectPath: path.join(destination, "project.sbproj") };
  });
  assert.deepEqual(events, ["create_migration_backup", "save_current_project"]);
  assert.equal(savedPath, path.join(destination, "project.sbproj"));
  assert.equal(savedSnapshot.schemaVersion, 2);
  assert.deepEqual(savedSnapshot.spatialScenes, []);

  const noMigrationEvents = [];
  await saveSnapshotThroughDesktopBridge({ ...first.snapshot, migrationBackupPending: false }, async (command) => {
    noMigrationEvents.push(command);
    return { projectPath: "current.sbproj" };
  });
  assert.deepEqual(noMigrationEvents, ["save_current_project"]);

  const failureEvents = [];
  await assert.rejects(
    saveSnapshotThroughDesktopBridge(legacy, async (command) => {
      failureEvents.push(command);
      if (command === "create_migration_backup") throw new Error("controlled backup failure");
      return { projectPath: "must-not-save.sbproj" };
    }),
    /controlled backup failure/
  );
  assert.deepEqual(failureEvents, ["create_migration_backup"], "backup failure must prevent the real save command");

  const invalidEvents = [];
  await assert.rejects(
    saveSnapshotThroughDesktopBridge({ project: { id: "p1" }, shots: [], assets: null }, async (command) => {
      invalidEvents.push(command);
      return {};
    }),
    /assets/i
  );
  assert.deepEqual(invalidEvents, [], "invalid snapshots must be rejected before any desktop write command");
}

const rustSource = await readFile("src-tauri/src/main.rs", "utf8");
const richerAutosave = { ...legacy, assets: [{ id: "a1" }], shots: [{ id: "s1" }] };
const preferredStartup = choosePreferredDesktopSnapshot(
  { ...legacy, migrationBackupPending: true, migrationBackupSource: legacy },
  richerAutosave
);
assert.equal(preferredStartup.migrationBackupPending, true);
assert.deepEqual(preferredStartup.migrationBackupSource, legacy);
const mediaRichDesktop = { ...legacy, assets: [{ id: "a1", filePath: "asset.png" }], shots: [{ id: "s1", generatedVideoPath: "shot.mp4" }] };
const equalShapeAutosave = { ...legacy, assets: [{ id: "a2" }], shots: [{ id: "s2" }] };
assert.equal(choosePreferredDesktopSnapshot(mediaRichDesktop, equalShapeAutosave), mediaRichDesktop);
assert.match(rustSource, /schema_version:\s*i64/);
assert.match(rustSource, /director_plan:\s*serde_json::Value/);
assert.match(rustSource, /spatial_scenes:\s*Vec<serde_json::Value>/);
assert.match(rustSource, /workbench_snapshot_json/);
assert.match(rustSource, /create_migration_backup/);
assert.match(rustSource, /#\[serde\(flatten\)\][\s\S]*extra_snapshot_fields/);
assert.match(rustSource, /workbench_sqlite_roundtrip_preserves_unknown_fields/);

console.log("PASS workbench migration: defaults, idempotence, immutability, validation, and backup ordering");
