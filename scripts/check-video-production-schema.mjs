import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const repoRoot = process.cwd();
const comfyPanelSource = await readFile("src/modules/comfy-pipeline/ComfyPipelinePanel.tsx", "utf8");
assert.match(comfyPanelSource, /videoProductionEvidence\?: Shot\["videoProductionEvidence"\]/);
assert.match(comfyPanelSource, /videoProductionEvidence:\s*item\.videoProductionEvidence/);
assert.match(comfyPanelSource, /item\.video_production_evidence\s*&&/);
const result = await build({
  stdin: {
    contents: `
      export { useStoryboardStore } from "./src/modules/storyboard-core/store.ts";
      export { createSnapshotBackup, parseSnapshotBackup } from "./src/modules/persistence/backupSnapshot.ts";
      export * from "./src/modules/persistence/desktopSnapshotSync.ts";
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

const desktopSyncRuntime = await import(
  `data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`
);
const {
  beginDesktopSnapshotSyncTransition,
  blockDesktopSnapshotSync,
  canManuallySaveDesktopSnapshot,
  completeDesktopSnapshotLoad,
  completeDesktopSnapshotSave,
  createDesktopSnapshotSyncState,
  createSnapshotBackup,
  markDesktopSnapshotSynced,
  markDesktopSnapshotUnsynced,
  parseSnapshotBackup,
  restoreDesktopSnapshotSyncState,
  shouldScheduleDesktopSnapshotSave,
  useStoryboardStore
} = desktopSyncRuntime;

const workspaceA = "project-a.sbproj";
const workspaceB = "project-b.sbproj";
const snapshotA = { project: { id: "project-a", name: "Original" }, shots: [{ id: "shot-a" }] };
const editedSnapshotA = { ...snapshotA, project: { ...snapshotA.project, name: "Edited" } };
const snapshotB = { project: { id: "project-b", name: "Target" }, shots: [{ id: "shot-b" }] };
const editedSnapshotB = { ...snapshotB, project: { ...snapshotB.project, name: "Target edited" } };
const syncedA = createDesktopSnapshotSyncState(workspaceA, snapshotA);

const createSaveCoordinator = desktopSyncRuntime.createDesktopSnapshotSaveCoordinator ?? ((writer) => {
  let activeWorkspacePath = "";
  let activeWorkspaceToken = 0;
  return {
    activateWorkspace(workspacePath, workspaceToken) {
      activeWorkspacePath = workspacePath;
      activeWorkspaceToken = workspaceToken;
    },
    save(submission) {
      if (
        submission.workspacePath !== activeWorkspacePath ||
        submission.workspaceToken !== activeWorkspaceToken
      ) {
        return Promise.resolve({ status: "cancelled", savedPath: null, submission });
      }
      return writer(submission.snapshot).then((savedPath) => ({
        status: "completed",
        savedPath,
        submission
      }));
    }
  };
});

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

{
  const gates = {
    A: createDeferred(),
    B: createDeferred()
  };
  const started = [];
  const completed = [];
  let backendConcurrency = 0;
  let maximumBackendConcurrency = 0;
  let diskSnapshot = null;
  let saveState = syncedA;
  const coordinator = createSaveCoordinator(async (snapshot) => {
    const version = snapshot.version;
    started.push(version);
    backendConcurrency += 1;
    maximumBackendConcurrency = Math.max(maximumBackendConcurrency, backendConcurrency);
    try {
      await gates[version].promise;
      diskSnapshot = snapshot;
      completed.push(version);
      return workspaceA;
    } finally {
      backendConcurrency -= 1;
    }
  });
  coordinator.activateWorkspace(workspaceA, syncedA.workspaceToken);
  const saveA = coordinator.save({
    workspacePath: workspaceA,
    workspaceToken: syncedA.workspaceToken,
    snapshot: { version: "A" }
  }).then((result) => {
    if (result.status === "completed" && result.savedPath) {
      saveState = completeDesktopSnapshotSave(saveState, {
        workspacePath: result.submission.workspacePath,
        workspaceToken: result.submission.workspaceToken,
        submittedSnapshot: result.submission.snapshot
      });
    }
    return result;
  });
  const saveB = coordinator.save({
    workspacePath: workspaceA,
    workspaceToken: syncedA.workspaceToken,
    snapshot: { version: "B" }
  }).then((result) => {
    if (result.status === "completed" && result.savedPath) {
      saveState = completeDesktopSnapshotSave(saveState, {
        workspacePath: result.submission.workspacePath,
        workspaceToken: result.submission.workspaceToken,
        submittedSnapshot: result.submission.snapshot
      });
    }
    return result;
  });

  gates.B.resolve();
  await Promise.resolve();
  gates.A.resolve();
  await Promise.all([saveA, saveB]);

  assert.equal(maximumBackendConcurrency, 1, "desktop snapshot writes must be single-flight");
  assert.deepEqual(started, ["A", "B"], "snapshot B must start only after snapshot A settles");
  assert.deepEqual(completed, ["A", "B"], "snapshot writes must complete in submission order");
  assert.deepEqual(diskSnapshot, { version: "B" }, "out-of-order completion must not roll disk content back from B to A");
  assert.equal(
    saveState.baseline?.snapshotFingerprint,
    JSON.stringify({ version: "B" }),
    "the synchronized baseline must finish at the latest saved snapshot"
  );
}

{
  const gates = {
    A: createDeferred(),
    B: createDeferred(),
    C: createDeferred()
  };
  const started = [];
  let backendConcurrency = 0;
  let maximumBackendConcurrency = 0;
  const coordinator = createSaveCoordinator(async (snapshot) => {
    started.push(snapshot.version);
    backendConcurrency += 1;
    maximumBackendConcurrency = Math.max(maximumBackendConcurrency, backendConcurrency);
    try {
      await gates[snapshot.version].promise;
      return workspaceA;
    } finally {
      backendConcurrency -= 1;
    }
  });
  coordinator.activateWorkspace(workspaceA, syncedA.workspaceToken);
  const saveA = coordinator.save({ workspacePath: workspaceA, workspaceToken: syncedA.workspaceToken, snapshot: { version: "A" } });
  const manualSaveB = coordinator.save({ workspacePath: workspaceA, workspaceToken: syncedA.workspaceToken, snapshot: { version: "B" } });
  const autoSaveC = coordinator.save({ workspacePath: workspaceA, workspaceToken: syncedA.workspaceToken, snapshot: { version: "C" } });

  gates.B.resolve();
  gates.C.resolve();
  gates.A.resolve();
  const [, manualResult, autoResult] = await Promise.all([saveA, manualSaveB, autoSaveC]);

  assert.deepEqual(started, ["A", "C"], "queued B/C snapshots should coalesce to the latest C");
  assert.equal(maximumBackendConcurrency, 1, "coalesced saves must keep backend concurrency at one");
  assert.deepEqual(
    manualResult.submission.snapshot,
    { version: "C" },
    "a manual caller whose queued snapshot was superseded must receive the actual saved snapshot completion"
  );
  assert.deepEqual(autoResult.submission.snapshot, { version: "C" }, "all merged callers must observe the actual saved snapshot");
}

{
  const gates = {
    A: createDeferred(),
    B: createDeferred(),
    N: createDeferred()
  };
  const started = [];
  let backendConcurrency = 0;
  let maximumBackendConcurrency = 0;
  const coordinator = createSaveCoordinator(async (snapshot) => {
    started.push(snapshot.version);
    backendConcurrency += 1;
    maximumBackendConcurrency = Math.max(maximumBackendConcurrency, backendConcurrency);
    try {
      await gates[snapshot.version].promise;
      return snapshot.version === "N" ? workspaceB : workspaceA;
    } finally {
      backendConcurrency -= 1;
    }
  });
  coordinator.activateWorkspace(workspaceA, syncedA.workspaceToken);
  const oldInFlight = coordinator.save({ workspacePath: workspaceA, workspaceToken: syncedA.workspaceToken, snapshot: { version: "A" } });
  const oldQueued = coordinator.save({ workspacePath: workspaceA, workspaceToken: syncedA.workspaceToken, snapshot: { version: "B" } });
  coordinator.activateWorkspace(workspaceB, syncedA.workspaceToken + 1);
  const oldQueuedResult = await oldQueued;
  const newWorkspaceSave = coordinator.save({ workspacePath: workspaceB, workspaceToken: syncedA.workspaceToken + 1, snapshot: { version: "N" } });

  gates.B.resolve();
  gates.N.resolve();
  gates.A.resolve();
  await Promise.all([oldInFlight, newWorkspaceSave]);

  assert.equal(oldQueuedResult.status, "cancelled", "workspace transition must cancel an old queued snapshot");
  assert.deepEqual(started, ["A", "N"], "an old queued snapshot must never write after workspace transition");
  assert.equal(maximumBackendConcurrency, 1, "a new workspace write must wait for the old in-flight backend call to settle");
}

{
  const gates = {
    A: createDeferred(),
    B: createDeferred(),
    C: createDeferred()
  };
  const started = [];
  const coordinator = createSaveCoordinator(async (snapshot) => {
    started.push(snapshot.version);
    await gates[snapshot.version].promise;
    return workspaceA;
  });
  coordinator.activateWorkspace(workspaceA, syncedA.workspaceToken);
  const failedSave = coordinator
    .save({ workspacePath: workspaceA, workspaceToken: syncedA.workspaceToken, snapshot: { version: "A" } })
    .then(() => null, (error) => error);
  const queuedRecovery = coordinator.save({ workspacePath: workspaceA, workspaceToken: syncedA.workspaceToken, snapshot: { version: "B" } });

  const expectedFailure = new Error("save A failed");
  gates.B.resolve();
  gates.A.reject(expectedFailure);
  assert.equal(await failedSave, expectedFailure, "the failed save caller must receive the backend error");
  const recoveredResult = await queuedRecovery;
  assert.equal(recoveredResult.status, "completed", "a queued newer snapshot must still save after an earlier failure");

  gates.C.resolve();
  const retryResult = await coordinator.save({ workspacePath: workspaceA, workspaceToken: syncedA.workspaceToken, snapshot: { version: "C" } });
  assert.equal(retryResult.status, "completed", "the coordinator must accept later retries after a failed queue drain");
  assert.deepEqual(started, ["A", "B", "C"], "save failure must not poison subsequent queue processing");
}

const switchNullLoad = completeDesktopSnapshotLoad(
  blockDesktopSnapshotSync(beginDesktopSnapshotSyncTransition(syncedA), workspaceB),
  workspaceB,
  null
);
assert.equal(switchNullLoad.phase, "blocked", "switch load null must remain blocked");
assert.equal(
  shouldScheduleDesktopSnapshotSave({ state: switchNullLoad, workspacePath: workspaceB, snapshot: editedSnapshotA }),
  false,
  "editing after switch load null must not write the previous project into the target"
);
assert.equal(
  canManuallySaveDesktopSnapshot(switchNullLoad, workspaceB),
  false,
  "manual save must be denied while the target workspace is blocked"
);
assert.equal(
  canManuallySaveDesktopSnapshot(beginDesktopSnapshotSyncTransition(syncedA), workspaceA),
  false,
  "manual save must be denied during a workspace transition"
);
assert.equal(canManuallySaveDesktopSnapshot(syncedA, workspaceA), true, "manual save should be allowed for a synchronized workspace");
assert.equal(canManuallySaveDesktopSnapshot(syncedA, workspaceB), false, "manual save must reject a mismatched active workspace path");
let guardedManualBackendCalls = 0;
const attemptGuardedManualSave = (state, workspacePath) => {
  if (!canManuallySaveDesktopSnapshot(state, workspacePath)) return;
  guardedManualBackendCalls += 1;
};
attemptGuardedManualSave(switchNullLoad, workspaceB);
attemptGuardedManualSave(beginDesktopSnapshotSyncTransition(syncedA), workspaceA);
assert.equal(guardedManualBackendCalls, 0, "blocked and transitioning manual saves must not invoke the backend writer");

const createNullTransition = beginDesktopSnapshotSyncTransition(syncedA);
const createNullRecovered = restoreDesktopSnapshotSyncState(createNullTransition, syncedA);
assert.equal(createNullRecovered.phase, "synced", "create null must restore the previous synchronized workspace");
assert.equal(createNullRecovered.workspacePath, workspaceA, "create null must restore the real current workspace path");
assert.equal(
  shouldScheduleDesktopSnapshotSave({
    state: createNullRecovered,
    workspacePath: workspaceA,
    snapshot: editedSnapshotA,
    scheduledWorkspaceToken: syncedA.workspaceToken
  }),
  false,
  "create null recovery must invalidate a timeout scheduled before the transition"
);
assert.equal(
  shouldScheduleDesktopSnapshotSave({ state: createNullRecovered, workspacePath: workspaceA, snapshot: editedSnapshotA }),
  true,
  "a real edit after create null recovery must still autosave"
);

const createSaveThrowTransition = beginDesktopSnapshotSyncTransition(syncedA);
const createSaveThrowRecovered = markDesktopSnapshotUnsynced(createSaveThrowTransition, workspaceB);
assert.equal(createSaveThrowRecovered.phase, "unsynced", "a created workspace with failed explicit save must remain retryable");
assert.equal(
  canManuallySaveDesktopSnapshot(createSaveThrowRecovered, workspaceB),
  true,
  "manual save should be allowed to retry an unsynced workspace"
);
assert.equal(
  shouldScheduleDesktopSnapshotSave({ state: createSaveThrowRecovered, workspacePath: workspaceB, snapshot: snapshotB }),
  true,
  "failed explicit create save must be eligible for automatic retry"
);

const switchTransition = beginDesktopSnapshotSyncTransition(syncedA);
const switchLoadFailed = blockDesktopSnapshotSync(switchTransition, workspaceB);
assert.equal(switchLoadFailed.phase, "blocked", "switch load failure must block writes to the changed backend target");
assert.equal(
  shouldScheduleDesktopSnapshotSave({ state: switchLoadFailed, workspacePath: workspaceB, snapshot: snapshotA }),
  false,
  "the previous workspace snapshot must never be written to a switch target that failed to load"
);
const switchRecovered = markDesktopSnapshotSynced(switchLoadFailed, workspaceB, snapshotB);
assert.equal(
  shouldScheduleDesktopSnapshotSave({ state: switchRecovered, workspacePath: workspaceB, snapshot: editedSnapshotB }),
  true,
  "a real edit after switch reload recovery must autosave safely"
);

const deleteTransition = beginDesktopSnapshotSyncTransition(syncedA);
const deleteLoadFailed = blockDesktopSnapshotSync(deleteTransition, workspaceB);
assert.equal(deleteLoadFailed.phase, "blocked", "delete replacement load failure must block cross-project writes");
const deleteRecovered = markDesktopSnapshotSynced(deleteLoadFailed, workspaceB, snapshotB);
assert.equal(
  shouldScheduleDesktopSnapshotSave({ state: deleteRecovered, workspacePath: workspaceB, snapshot: editedSnapshotB }),
  true,
  "a real edit after delete replacement reload recovery must autosave safely"
);

const pendingWorkspaceToken = syncedA.workspaceToken;
assert.equal(
  shouldScheduleDesktopSnapshotSave({ state: syncedA, workspacePath: workspaceA, snapshot: editedSnapshotA, scheduledWorkspaceToken: pendingWorkspaceToken }),
  true,
  "an edit should initially schedule autosave"
);
const manualSaveCompleted = completeDesktopSnapshotSave(syncedA, {
  workspacePath: workspaceA,
  workspaceToken: pendingWorkspaceToken,
  submittedSnapshot: editedSnapshotA
});
assert.equal(
  shouldScheduleDesktopSnapshotSave({ state: manualSaveCompleted, workspacePath: workspaceA, snapshot: editedSnapshotA, scheduledWorkspaceToken: pendingWorkspaceToken }),
  false,
  "manual save success must skip a pending flush for the same submitted snapshot"
);
const editedWhileSaveInFlight = {
  ...editedSnapshotA,
  shots: [...editedSnapshotA.shots, { id: "shot-created-while-a-was-saving" }]
};
assert.equal(
  shouldScheduleDesktopSnapshotSave({
    state: manualSaveCompleted,
    workspacePath: workspaceA,
    snapshot: editedWhileSaveInFlight,
    scheduledWorkspaceToken: pendingWorkspaceToken
  }),
  true,
  "saving submitted snapshot A must not cancel pending snapshot B created while A was in flight"
);
assert.equal(
  shouldScheduleDesktopSnapshotSave({
    state: manualSaveCompleted,
    workspacePath: workspaceA,
    snapshot: { ...editedSnapshotA, shots: [...editedSnapshotA.shots, { id: "shot-a2" }] }
  }),
  true,
  "a later edit after manual save must still autosave"
);

const createInitialSaveState = markDesktopSnapshotUnsynced(
  beginDesktopSnapshotSyncTransition(syncedA),
  workspaceB
);
const createPendingWorkspaceToken = createInitialSaveState.workspaceToken;
const createInitialSaveCompleted = completeDesktopSnapshotSave(createInitialSaveState, {
  workspacePath: workspaceB,
  workspaceToken: createPendingWorkspaceToken,
  submittedSnapshot: snapshotB
});
assert.equal(
  shouldScheduleDesktopSnapshotSave({
    state: createInitialSaveCompleted,
    workspacePath: workspaceB,
    snapshot: editedSnapshotB,
    scheduledWorkspaceToken: createPendingWorkspaceToken
  }),
  true,
  "create initial save must baseline submitted A without cancelling an in-flight edit B"
);

let asyncSaveState = syncedA;
let resolveSubmittedA;
const submittedACompletion = new Promise((resolve) => {
  resolveSubmittedA = resolve;
}).then(() => {
  asyncSaveState = completeDesktopSnapshotSave(asyncSaveState, {
    workspacePath: workspaceA,
    workspaceToken: syncedA.workspaceToken,
    submittedSnapshot: editedSnapshotA
  });
});
assert.equal(
  shouldScheduleDesktopSnapshotSave({
    state: asyncSaveState,
    workspacePath: workspaceA,
    snapshot: editedWhileSaveInFlight,
    scheduledWorkspaceToken: syncedA.workspaceToken
  }),
  true,
  "snapshot B should be scheduled while submitted snapshot A is still in flight"
);
resolveSubmittedA();
await submittedACompletion;
assert.equal(
  shouldScheduleDesktopSnapshotSave({
    state: asyncSaveState,
    workspacePath: workspaceA,
    snapshot: editedWhileSaveInFlight,
    scheduledWorkspaceToken: syncedA.workspaceToken
  }),
  true,
  "snapshot B must remain scheduled after the asynchronous completion of submitted snapshot A"
);

let asyncCreateState = createInitialSaveState;
let resolveCreateA;
const createACompletion = new Promise((resolve) => {
  resolveCreateA = resolve;
}).then(() => {
  asyncCreateState = completeDesktopSnapshotSave(asyncCreateState, {
    workspacePath: workspaceB,
    workspaceToken: createPendingWorkspaceToken,
    submittedSnapshot: snapshotB
  });
});
resolveCreateA();
await createACompletion;
assert.equal(
  shouldScheduleDesktopSnapshotSave({
    state: asyncCreateState,
    workspacePath: workspaceB,
    snapshot: editedSnapshotB,
    scheduledWorkspaceToken: createPendingWorkspaceToken
  }),
  true,
  "an edit during the asynchronous create initial save must remain pending after submitted snapshot A completes"
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
const productionEvidence = Object.freeze({
  schemaVersion: 1,
  shotId: "script_video_plan",
  status: "ready",
  sourceVideoPath: "C:/project/raw/shot.mp4",
  routeDecision: Object.freeze({ status: "selected", profileId: "minimax_h3_flf2v", reason: "explicit_endpoints" }),
  profilePreflight: Object.freeze({ profileId: "minimax_h3_flf2v", available: true, missingNodes: [], missingModels: [], warnings: [] }),
  boundary: Object.freeze({ id: "boundary-1", fromShotId: "script_video_plan", toShotId: "next", kind: "hard_cut", requiresApproval: false, approvalStatus: "pending" }),
  projectAssetsDir: "C:/project/assets",
  normalizationCredential: Object.freeze({
    schemaVersion: 1, receiptId: "a".repeat(64), normalizedPath: "C:/project/assets/video-normalized/shot.mp4",
    sha256: "b".repeat(64), byteLength: 123, modifiedUnixMillis: 1787000000000,
    projectWidth: 1280, projectHeight: 720, durationFrames: 48,
    probe: Object.freeze({ width: 1280, height: 720, fpsNum: 24, fpsDen: 1, durationSeconds: 2, videoCodec: "h264", pixelFormat: "yuv420p", audioSampleRate: 48000, audioChannels: 2, hasMonotonicTimestamps: true, hasConstantFrameTimestamps: true, decodedFrameCount: 48 })
  }),
  inspection: Object.freeze({ probe: Object.freeze({ width: 1280, height: 720, fpsNum: 24, fpsDen: 1, durationSeconds: 2, videoCodec: "h264", pixelFormat: "yuv420p", audioSampleRate: 48000, audioChannels: 2, hasMonotonicTimestamps: true, hasConstantFrameTimestamps: true, decodedFrameCount: 48 }), anomalies: Object.freeze({ blackIntervals: [], freezeIntervals: [] }) }),
  reviewFrames: Object.freeze({ firstFramePath: "C:/project/assets/video-review/first.png", middleFramePath: "C:/project/assets/video-review/middle.png", lastFramePath: "C:/project/assets/video-review/last.png" }),
  artifactBinding: Object.freeze({ schemaVersion: 1, receiptId: "a".repeat(64), normalizedPath: "C:/project/assets/video-normalized/shot.mp4", sha256: "b".repeat(64), byteLength: 123, modifiedUnixMillis: 1787000000000, width: 1280, height: 720, durationFrames: 48, decodedFrameCount: 48, reviewFramesDigest: "c".repeat(64) }),
  decision: Object.freeze({ decision: "approved", reviewedAt: "2026-08-18T01:00:00.000Z", artifactBinding: Object.freeze({ schemaVersion: 1, receiptId: "a".repeat(64), normalizedPath: "C:/project/assets/video-normalized/shot.mp4", sha256: "b".repeat(64), byteLength: 123, modifiedUnixMillis: 1787000000000, width: 1280, height: 720, durationFrames: 48, decodedFrameCount: 48, reviewFramesDigest: "c".repeat(64) }) })
});

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
    ,videoProductionEvidence: productionEvidence
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
    ,"videoProductionEvidence"
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
    videoWorkflowProfileId: "minimax_h3_flf2v",
    videoQualityTier: "production",
    videoAccelerationMode: "standard",
    continuitySegmentId: "segment-updated",
    videoBoundaryKind: "scene_change",
    approvedBoundaryFramePath: "frames/updated-boundary.png",
    videoRouteReason: "Updated manual route",
    videoQualityStatus: "approved",
    videoProductionEvidence: Object.freeze({ ...productionEvidence, sourceVideoPath: "C:/project/raw/updated.mp4" })
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

  useStoryboardStore.getState().updateShotFields(importedScriptItem.id, { approvedBoundaryFramePath: "C:/project/boundary/replaced.png" });
  const replacedBoundaryShot = useStoryboardStore.getState().shots.find((shot) => shot.id === importedScriptItem.id);
  assert.equal(replacedBoundaryShot.videoProductionEvidence, undefined, "boundary identity replacement must invalidate production evidence");
  useStoryboardStore.getState().updateShotFields(importedScriptItem.id, { videoProductionEvidence: productionEvidence });

  useStoryboardStore.getState().updateShotFields(importedScriptItem.id, { generatedVideoPath: "C:/project/raw/replaced.mp4" });
  const replacedMediaShot = useStoryboardStore.getState().shots.find((shot) => shot.id === importedScriptItem.id);
  assert.equal(replacedMediaShot.videoProductionEvidence, undefined, "media replacement must invalidate production evidence and decision");
  assert.equal(replacedMediaShot.videoQualityStatus, "pending", "media replacement must reset quality status");

  useStoryboardStore.getState().updateShotFields(importedScriptItem.id, { videoProductionEvidence: productionEvidence });
  useStoryboardStore.getState().updateShotFields(importedScriptItem.id, { videoWorkflowProfileId: "minimax_h3_r2v" });
  const reroutedShot = useStoryboardStore.getState().shots.find((shot) => shot.id === importedScriptItem.id);
  assert.equal(reroutedShot.videoProductionEvidence, undefined, "profile override must invalidate production evidence");
  assert.equal(reroutedShot.videoGenerationReceipt, undefined, "profile override must invalidate generation receipt");
  assert.equal(reroutedShot.generatedVideoPath, undefined, "profile override must invalidate generated media");
} finally {
  useStoryboardStore.setState(initialState, true);
}

console.log("PASS video production schema: legacy migration, single-flight desktop sync, import, update, serialization, and reload");
