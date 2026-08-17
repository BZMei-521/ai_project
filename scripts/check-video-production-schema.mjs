import assert from "node:assert/strict";
import path from "node:path";
import { build } from "esbuild";

const repoRoot = process.cwd();
const result = await build({
  stdin: {
    contents: `
      export { useStoryboardStore } from "./src/modules/storyboard-core/store.ts";
      export { createSnapshotBackup, parseSnapshotBackup } from "./src/modules/persistence/backupSnapshot.ts";
      export { createDesktopSnapshotSyncBaseline, shouldSaveDesktopSnapshot } from "./src/modules/persistence/desktopSnapshotSync.ts";
    `,
    loader: "ts",
    resolveDir: repoRoot,
    sourcefile: "video-production-schema-check-entry.ts"
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});
const bundle = result.outputFiles[0]?.text;
assert.ok(bundle, "The bundled storyboard persistence path should be available.");

const {
  createDesktopSnapshotSyncBaseline,
  createSnapshotBackup,
  parseSnapshotBackup,
  shouldSaveDesktopSnapshot,
  useStoryboardStore
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`
);

const loadedSnapshot = { project: { id: "project-a", name: "Legacy" }, shots: [{ id: "legacy-shot" }] };
const loadedBaseline = createDesktopSnapshotSyncBaseline("project-a.sbproj", loadedSnapshot);
assert.equal(
  shouldSaveDesktopSnapshot({
    workspacePath: "project-a.sbproj",
    syncReady: true,
    snapshot: loadedSnapshot,
    baseline: null
  }),
  false,
  "sync readiness without an established load baseline must not save"
);
assert.equal(
  shouldSaveDesktopSnapshot({
    workspacePath: "project-a.sbproj",
    syncReady: true,
    snapshot: loadedSnapshot,
    baseline: loadedBaseline
  }),
  false,
  "initial hydrate must establish a synchronized baseline without saving"
);
assert.equal(
  shouldSaveDesktopSnapshot({
    workspacePath: "project-a.sbproj",
    syncReady: true,
    snapshot: { ...loadedSnapshot, project: { ...loadedSnapshot.project, name: "Edited" } },
    baseline: loadedBaseline
  }),
  true,
  "a later business edit must be saved"
);
const switchedSnapshot = { project: { id: "project-b", name: "Switched" }, shots: [] };
const switchedBaseline = createDesktopSnapshotSyncBaseline("project-b.sbproj", switchedSnapshot);
assert.equal(
  shouldSaveDesktopSnapshot({
    workspacePath: "project-a.sbproj",
    syncReady: true,
    snapshot: loadedSnapshot,
    baseline: switchedBaseline
  }),
  false,
  "a pending flush from the previous workspace must not write after a switch"
);
assert.equal(
  shouldSaveDesktopSnapshot({
    workspacePath: "project-b.sbproj",
    syncReady: true,
    snapshot: switchedSnapshot,
    baseline: switchedBaseline
  }),
  false,
  "switching and hydrating a project must not immediately save it"
);
const rehydratedSnapshot = JSON.parse(JSON.stringify(switchedSnapshot));
const rehydratedBaseline = createDesktopSnapshotSyncBaseline("project-b.sbproj", rehydratedSnapshot);
assert.equal(
  shouldSaveDesktopSnapshot({
    workspacePath: "project-b.sbproj",
    syncReady: true,
    snapshot: rehydratedSnapshot,
    baseline: rehydratedBaseline
  }),
  false,
  "rehydrating equivalent persisted data must not schedule a write"
);

const defaults = {
  videoWorkflowProfileId: "auto",
  videoQualityTier: "production",
  videoAccelerationMode: "standard",
  videoBoundaryKind: "hard_cut",
  videoQualityStatus: "pending"
};
const receipt = {
  profileId: "minimax_h3_r2v",
  accelerationMode: "te_speed_preview",
  workflowDigest: "workflow-digest-1",
  inputDigest: "input-digest-1",
  promptId: "prompt-1",
  normalizedPath: "outputs/normalized-1.mp4",
  generatedAt: "2026-08-17T00:00:00.000Z"
};

const initialState = useStoryboardStore.getState();
const legacyShot = Object.freeze({
  id: "legacy_first_last_frame",
  sequenceId: initialState.currentSequenceId,
  order: 1,
  title: "Legacy first/last frame shot",
  durationFrames: 48,
  dialogue: "",
  notes: "",
  tags: Object.freeze([]),
  videoMode: "first_last_frame"
});
const legacySourceBeforeImport = JSON.stringify(legacyShot);

try {
  useStoryboardStore.getState().hydrateFromSnapshot({ shots: [legacyShot] });
  const migratedLegacyShot = useStoryboardStore.getState().shots[0];
  assert.equal(migratedLegacyShot.videoMode, "first_last_frame", "legacy videoMode must survive project import");
  for (const [field, expected] of Object.entries(defaults)) {
    assert.equal(migratedLegacyShot[field], expected, `legacy project import should default ${field}`);
  }
  assert.notStrictEqual(migratedLegacyShot, legacyShot, "legacy migration must create an in-memory shot");
  assert.equal(JSON.stringify(legacyShot), legacySourceBeforeImport, "legacy project input must not be mutated");

  const importedScriptItem = Object.freeze({
    id: "script_video_plan",
    title: "Imported video plan",
    prompt: "A continuous tracking shot",
    videoMode: "first_last_frame",
    videoWorkflowProfileId: "minimax_h3_flf2v",
    videoQualityTier: "draft",
    videoAccelerationMode: "te_speed_preview",
    continuitySegmentId: "segment-imported",
    videoBoundaryKind: "match_cut",
    approvedBoundaryFramePath: "frames/imported-boundary.png",
    videoRouteReason: "Manual FLF2V override",
    videoQualityStatus: "checking",
    videoGenerationReceipt: Object.freeze({ ...receipt })
  });
  const scriptSourceBeforeImport = JSON.stringify(importedScriptItem);
  useStoryboardStore.getState().replaceShotsForCurrentSequence([importedScriptItem]);
  const importedScriptShot = useStoryboardStore.getState().shots.find((shot) => shot.id === importedScriptItem.id);
  assert.ok(importedScriptShot, "shot-script import should create the requested shot");
  for (const field of [
    "videoWorkflowProfileId",
    "videoQualityTier",
    "videoAccelerationMode",
    "continuitySegmentId",
    "videoBoundaryKind",
    "approvedBoundaryFramePath",
    "videoRouteReason",
    "videoQualityStatus",
    "videoGenerationReceipt"
  ]) {
    assert.deepEqual(importedScriptShot[field], importedScriptItem[field], `shot-script import should preserve ${field}`);
  }
  assert.equal(JSON.stringify(importedScriptItem), scriptSourceBeforeImport, "shot-script input must not be mutated");

  const updatedReceipt = {
    ...receipt,
    profileId: "minimax_h3_i2v",
    accelerationMode: "standard",
    workflowDigest: "workflow-digest-2",
    inputDigest: "input-digest-2",
    promptId: "prompt-2",
    normalizedPath: "outputs/normalized-2.mp4",
    generatedAt: "2026-08-17T01:00:00.000Z"
  };
  const updatePatch = Object.freeze({
    videoWorkflowProfileId: "minimax_h3_i2v",
    videoQualityTier: "production",
    videoAccelerationMode: "standard",
    continuitySegmentId: "segment-updated",
    videoBoundaryKind: "scene_change",
    approvedBoundaryFramePath: "frames/updated-boundary.png",
    videoRouteReason: "Updated manual route",
    videoQualityStatus: "approved",
    videoGenerationReceipt: Object.freeze(updatedReceipt)
  });
  const updatePatchBefore = JSON.stringify(updatePatch);
  useStoryboardStore.getState().updateShotFields(importedScriptItem.id, updatePatch);
  const updatedShot = useStoryboardStore.getState().shots.find((shot) => shot.id === importedScriptItem.id);
  for (const [field, expected] of Object.entries(updatePatch)) {
    assert.deepEqual(updatedShot[field], expected, `store update should persist ${field}`);
  }
  assert.equal(JSON.stringify(updatePatch), updatePatchBefore, "update patch must not be mutated");

  const backupJson = JSON.stringify(createSnapshotBackup(useStoryboardStore.getState()));
  const parsedSnapshot = parseSnapshotBackup(backupJson);
  const serializedShot = parsedSnapshot.shots.find((shot) => shot.id === importedScriptItem.id);
  for (const [field, expected] of Object.entries(updatePatch)) {
    assert.deepEqual(serializedShot[field], expected, `backup serialization should preserve ${field}`);
  }

  useStoryboardStore.getState().hydrateFromSnapshot(parsedSnapshot);
  const restoredShot = useStoryboardStore.getState().shots.find((shot) => shot.id === importedScriptItem.id);
  for (const [field, expected] of Object.entries(updatePatch)) {
    assert.deepEqual(restoredShot[field], expected, `serialized project reload should restore ${field}`);
  }
} finally {
  useStoryboardStore.setState(initialState, true);
}

console.log("PASS video production schema: legacy migration, desktop sync policy, import, update, serialization, and reload");
