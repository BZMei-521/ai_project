import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  migrateStoryboardSnapshot,
  saveMigratedProjectSnapshot
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

const destination = await mkdtemp(path.join(tmpdir(), "graybean-migration-"));
try {
  const events = [];
  const saved = await saveMigratedProjectSnapshot(legacy, destination, async (snapshot) => {
    events.push("save");
    assert.equal(snapshot.schemaVersion, 2);
    return path.join(destination, "project.json");
  }, async (snapshot, target) => {
    events.push("backup:start");
    const backupPath = await createMigrationBackup(snapshot, target);
    events.push("backup:done");
    return backupPath;
  });
  assert.deepEqual(events, ["backup:start", "backup:done", "save"]);
  assert.ok(saved.backupPath);
  assert.equal(saved.savedPath, path.join(destination, "project.json"));
  const backup = JSON.parse(await readFile(saved.backupPath, "utf8"));
  assert.deepEqual(backup.snapshot, legacy, "backup must contain the untouched legacy snapshot");
  assert.match(path.basename(saved.backupPath), /^migration-backup-\d{8}T\d{6}\.\d{3}Z\.json$/);

  const noMigrationEvents = [];
  const current = await saveMigratedProjectSnapshot(first.snapshot, destination, async () => {
    noMigrationEvents.push("save");
    return "current.json";
  }, async () => {
    noMigrationEvents.push("backup");
    return "unexpected.json";
  });
  assert.deepEqual(noMigrationEvents, ["save"]);
  assert.equal(current.backupPath, null);

  let saveCalled = false;
  await assert.rejects(
    saveMigratedProjectSnapshot(legacy, destination, async () => {
      saveCalled = true;
      return "must-not-save.json";
    }, async () => {
      throw new Error("controlled backup failure");
    }),
    /controlled backup failure/
  );
  assert.equal(saveCalled, false, "backup failure must leave the original project unwritten");
} finally {
  await rm(destination, { recursive: true, force: true });
}

console.log("PASS workbench migration: defaults, idempotence, immutability, validation, and backup ordering");
