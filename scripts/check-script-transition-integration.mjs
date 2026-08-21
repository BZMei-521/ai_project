import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import {
  createScriptTransitionPersistenceFingerprint,
  shouldClearScriptTransitionDirtyAfterSave
} from "../src/app/scriptTransitionSaveGuard.mjs";

const app = await readFile("src/app/App.tsx", "utf8");

const persistedScriptState = {
  shots: [
    { id: "shot-1", sequenceId: "seq-1", order: 1, title: "开门" },
    { id: "shot-2", sequenceId: "seq-1", order: 2, title: "进屋" }
  ],
  shotTransitions: [
    { id: "edge-12", sequenceId: "seq-1", fromShotId: "shot-1", toShotId: "shot-2", durationSeconds: 0.6 }
  ]
};
const fingerprintAtSaveStart = createScriptTransitionPersistenceFingerprint(persistedScriptState);
assert.equal(
  createScriptTransitionPersistenceFingerprint({
    shotTransitions: persistedScriptState.shotTransitions.map(({ durationSeconds, ...edge }) => ({ durationSeconds, ...edge })),
    shots: persistedScriptState.shots.map(({ title, ...shot }) => ({ title, ...shot }))
  }),
  fingerprintAtSaveStart,
  "fingerprint must be deterministic across object key insertion order"
);
const guardInput = {
  saved: true,
  revisionAtSaveStart: 7,
  currentRevision: 7,
  fingerprintAtSaveStart,
  currentFingerprint: fingerprintAtSaveStart
};
assert.equal(shouldClearScriptTransitionDirtyAfterSave(guardInput), true, "successful unchanged save may clear dirty");
assert.equal(shouldClearScriptTransitionDirtyAfterSave({ ...guardInput, currentRevision: 8 }), false, "wrapper revision edit must keep dirty");
assert.equal(shouldClearScriptTransitionDirtyAfterSave({
  ...guardInput,
  currentFingerprint: createScriptTransitionPersistenceFingerprint({
    ...persistedScriptState,
    shots: [...persistedScriptState.shots, { id: "shot-3", sequenceId: "seq-1", order: 3, title: "旁路新增" }]
  })
}), false, "shot content mutation without a revision bump must keep dirty");
assert.equal(shouldClearScriptTransitionDirtyAfterSave({
  ...guardInput,
  currentFingerprint: createScriptTransitionPersistenceFingerprint({
    ...persistedScriptState,
    shotTransitions: persistedScriptState.shotTransitions.map((edge) => ({ ...edge, durationSeconds: 1.2 }))
  })
}), false, "transition content mutation without a revision bump must keep dirty");
assert.equal(shouldClearScriptTransitionDirtyAfterSave({
  ...guardInput,
  currentFingerprint: createScriptTransitionPersistenceFingerprint({ shots: [], shotTransitions: [] })
}), false, "project reset or load fingerprint change must keep an older save from clearing dirty");
assert.equal(shouldClearScriptTransitionDirtyAfterSave({ ...guardInput, saved: false }), false, "failed save must keep dirty");

function blockBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing block start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing block end: ${end}`);
  return source.slice(startIndex, endIndex);
}

function compact(source) {
  return source.replace(/\s+/g, " ").trim();
}

function functionDeclaration(source, name) {
  const start = source.indexOf(`export function ${name}`);
  assert.notEqual(start, -1, `missing exported function: ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated exported function: ${name}`);
}

function constFunction(source, name) {
  const start = source.indexOf(`const ${name}`);
  assert.notEqual(start, -1, `missing function: ${name}`);
  const arrow = source.indexOf("=>", start);
  const bodyStart = source.indexOf("{", arrow);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated function: ${name}`);
}

function assertFalseBranch(source, pattern, label) {
  assert.match(source, pattern, `${label} must return false`);
}

const stageViews = blockBetween(app, "const focusedStageView", "const selectedShot");
const inspector = blockBetween(app, "const inspectorByStage", "const workbenchInspector");
const primaryActions = blockBetween(app, "const stagePrimaryAction", "const currentStageIndex");
const saveDesktop = blockBetween(app, "const onSaveDesktop", "const onLoadDesktop");
const loadDesktop = blockBetween(app, "const onLoadDesktop", "const onCreateProject");
const createProject = blockBetween(app, "const onCreateProject", "const onChangeProject");
const changeProject = blockBetween(app, "const onChangeProject", "const onOpenProjectPath");
const deleteProject = blockBetween(app, "const onDeleteProject", "const onEditProjectSettings");
const recovery = blockBetween(app, "const restoreAutosaveVersion", "const removeAutosaveVersion");
const backupImport = blockBetween(app, "const onImportBackupFile", "const selectAuxPanelSection");
const shortcuts = blockBetween(app, "const onKeyDown", "window.addEventListener(\"keydown\"");
const addShotShortcut = blockBetween(shortcuts, "if ((event.key === \"n\"", "if ((event.metaKey || event.ctrlKey)");
const scriptActions = blockBetween(app, "const onImportShotScript", "const directorCommands");
const manualSave = constFunction(app, "onManualSaveDesktop");
const deleteScriptShot = blockBetween(scriptActions, "const onDeleteScriptShot", "const onUndoScriptSequence");
const directorCommands = blockBetween(app, "const directorCommands", "const stagePrimaryAction");
const scriptViewStart = stageViews.indexOf('<ScriptDirectorView');
const scriptViewEnd = stageViews.indexOf('/>', scriptViewStart);
assert.notEqual(scriptViewStart, -1, "script stage must render ScriptDirectorView");
assert.notEqual(scriptViewEnd, -1, "ScriptDirectorView must be self-closing");
const scriptView = compact(stageViews.slice(scriptViewStart, scriptViewEnd + 2));

assert.match(app, /const \[scriptTransitionDirty, setScriptTransitionDirty\] = useState\(false\)/);
assert.match(app, /const scriptRevisionRef = useRef\(0\)/);
assert.match(app, /const scriptTransitionDirtyRef = useRef\(false\)/);
assert.match(app, /const markScriptTransitionDirty = \(\) => \{\s*scriptRevisionRef\.current \+= 1;\s*setScriptTransitionDirtyValue\(true\);\s*\}/);
assert.match(app, /const resetScriptTransitionTracking = \(\) => \{\s*scriptRevisionRef\.current \+= 1;\s*setScriptTransitionDirtyValue\(false\);\s*\}/);
assert.match(app, /const shotTransitions = useStoryboardStore\(\(state\) => state\.shotTransitions\)/);
assert.match(app, /const selectedShotTransitionId = useStoryboardStore\(\(state\) => state\.selectedShotTransitionId\)/);
assert.match(app, /const scriptShots = shots[\s\S]*?\.filter\(\(shot\) => shot\.sequenceId === currentSequenceId\)[\s\S]*?\.sort\(\(a, b\) => a\.order - b\.order\)/);
assert.match(app, /const scriptTransitions = shotTransitions\.filter\(\(item\) => item\.sequenceId === currentSequenceId\)/);

for (const prop of [
  "shots={scriptShots}",
  "transitions={scriptTransitions}",
  "fps={project.fps}",
  "sequenceId={currentSequenceId}",
  "selectedShotId={selectedShotId}",
  "selectedTransitionId={selectedShotTransitionId}",
  "onImportScript={onImportShotScript}",
  "onMoveShot={onMoveScriptShot}",
  "onUndo={onUndoScriptSequence}",
  "onRedo={onRedoScriptSequence}",
  "canUndo={shotSequenceHistory.past.length > 0}",
  "canRedo={shotSequenceHistory.future.length > 0}"
]) {
  assert.ok(scriptView.includes(prop), `script view missing ${prop}`);
}

assert.doesNotMatch(scriptView, /onSelectionChange=\{\(\) => undefined\}/, "no-op selection bridge is forbidden");
assert.doesNotMatch(scriptView, /\bonSelect(?:Shot|Transition)=/, "obsolete split selection callbacks are forbidden");
assert.match(
  scriptView,
  /onSelectionChange=\{\(\{ shotId, transitionId \}\) => \{ if \(shotId !== null\) \{ selectShot\(shotId\); selectShotTransition\(null\); return; \} selectShot\(null\); selectShotTransition\(transitionId\); \}\}/,
  "selection callback must authoritatively keep shot and transition state mutually exclusive"
);

for (const prop of [
  "fps={project.fps}",
  "selectedShot={selectedShot ?? null}",
  "selectedTransition={selectedScriptTransition}",
  "fromShot={scriptShots.find((shot) => shot.id === selectedScriptTransition?.fromShotId) ?? null}",
  "toShot={scriptShots.find((shot) => shot.id === selectedScriptTransition?.toShotId) ?? null}",
  "onUpdateTransition={onUpdateScriptTransition}",
  "onRequestDeleteShot={(shotId) => void onDeleteScriptShot(shotId)}"
]) assert.ok(compact(inspector).includes(prop), `script inspector missing ${prop}`);
assert.match(primaryActions, /script:\s*scriptTransitionDirty[\s\S]*保存转场[\s\S]*onManualSaveDesktop/);
assert.doesNotMatch(stageViews, /继续到资产/);

assert.match(saveDesktop, /const onSaveDesktop = async \(\): Promise<boolean> =>/);
assertFalseBranch(saveDesktop, /if \(!canManuallySaveDesktopSnapshot[\s\S]*?保存已阻止[\s\S]*?return false;\s*\}/, "blocked save");
assertFalseBranch(saveDesktop, /if \(result\.status === "cancelled"\)[\s\S]*?保存已取消[\s\S]*?return false;\s*\}/, "cancelled save");
assertFalseBranch(saveDesktop, /if \(!path\)[\s\S]*?已跳过[\s\S]*?return false;\s*\}/, "skipped save");
assertFalseBranch(saveDesktop, /if \([\s\S]*activeWorkspacePathRef\.current !== result\.submission\.workspacePath[\s\S]*?未推进同步基线[\s\S]*?return false;\s*\}/, "stale-workspace save");
assertFalseBranch(saveDesktop, /catch \(error\) \{\s*setSaveState\(`保存失败：[\s\S]*?return false;\s*\}/, "failed save");
assert.match(saveDesktop, /setSaveState\("已保存"\);\s*return true;/, "active completed save must be the sole true path");

assert.match(manualSave, /const revisionAtSaveStart = scriptRevisionRef\.current/);
assert.match(manualSave, /const fingerprintAtSaveStart = createScriptTransitionPersistenceFingerprint\(useStoryboardStore\.getState\(\)\)/);
assert.match(manualSave, /const saved = await onSaveDesktop\(\)/);
assert.match(manualSave, /const currentFingerprint = createScriptTransitionPersistenceFingerprint\(useStoryboardStore\.getState\(\)\)/);
assert.match(manualSave, /shouldClearScriptTransitionDirtyAfterSave\(\{\s*saved,\s*revisionAtSaveStart,\s*currentRevision: scriptRevisionRef\.current,\s*fingerprintAtSaveStart,\s*currentFingerprint\s*\}\)[\s\S]*?setScriptTransitionDirtyValue\(false\)/);
assert.equal(app.match(/await onSaveDesktop\(\)/g)?.length, 1, "raw manual save must only be awaited by the revision-safe wrapper");
assert.match(shortcuts, /event\.key === "s"[\s\S]*?void onManualSaveDesktop\(\)/);
assert.match(directorCommands, /saveProject:\s*onManualSaveDesktop/);
assert.match(primaryActions, /保存转场[\s\S]*?void onManualSaveDesktop\(\)/);
assert.match(addShotShortcut, /addShot\(\);\s*if \(workbenchStage === "script"\) markScriptTransitionDirty\(\);/, "N must mark script mutations dirty only in the script stage");
assert.equal(app.match(/\baddShot\(\)/g)?.length, 1, "App must not retain another direct addShot mutation path");

for (const [wrapperName, operation] of [
  ["onImportShotScript", "replaceShotScriptForCurrentSequence"],
  ["onMoveScriptShot", "moveShotToIndex"],
  ["onUpdateScriptTransition", "updateShotTransition"],
  ["onUndoScriptSequence", "undoShotSequenceEdit"],
  ["onRedoScriptSequence", "redoShotSequenceEdit"]
]) {
  const wrapper = constFunction(scriptActions, wrapperName);
  assert.match(wrapper, new RegExp(`${operation}\\(`), `${operation} wrapper must call the store action`);
  assert.match(wrapper, /markScriptTransitionDirty\(\)/, `${operation} wrapper must bump revision and mark dirty`);
}

assert.match(deleteScriptShot, /const stateBeforeConfirmation = useStoryboardStore\.getState\(\)/);
assert.match(deleteScriptShot, /const fingerprintBeforeConfirmation = createScriptDeleteFingerprint\(/);
assert.match(deleteScriptShot, /const revisionBeforeConfirmation = scriptRevisionRef\.current/);
assert.match(deleteScriptShot, /await confirmDialog\(\{[\s\S]*title:\s*"删除镜头"[\s\S]*相邻转场/);
assert.match(deleteScriptShot, /const stateAfterConfirmation = useStoryboardStore\.getState\(\)/);
assert.match(deleteScriptShot, /const fingerprintAfterConfirmation = createScriptDeleteFingerprint\(/);
assert.match(deleteScriptShot, /fingerprintAfterConfirmation !== fingerprintBeforeConfirmation[\s\S]*scriptRevisionRef\.current !== revisionBeforeConfirmation[\s\S]*镜头序列已变化，请重新执行删除操作/);
assert.match(deleteScriptShot, /deleteShot\(shotId\);\s*markScriptTransitionDirty\(\);/);

for (const [block, operation] of [
  [loadDesktop, "hydrateFromSnapshot(snapshot)"],
  [changeProject, "hydrateFromSnapshot(snapshot)"],
  [deleteProject, "hydrateFromSnapshot(snapshot)"],
  [recovery, "hydrateFromSnapshot(snapshot)"],
  [backupImport, "hydrateFromSnapshot(snapshot)"]
]) {
  assert.match(block, new RegExp(`${operation.replace(/[()]/g, "\\$&")};\\s*resetScriptTransitionTracking\\(\\);`), `${operation} must reset tracking in the same success path`);
}
assert.match(createProject, /const previousScriptTransitionDirty = scriptTransitionDirtyRef\.current/);
assert.match(createProject, /resetForNewProject\(name\);\s*resetScriptTransitionTracking\(\);/, "new project reset must immediately establish a clean revision baseline");
assert.match(createProject, /if \(!path\)[\s\S]*?restoreScriptTransitionTracking\(previousScriptTransitionDirty\)/, "failed creation must restore prior dirty semantics");
assert.match(createProject, /else \{[\s\S]*?useStoryboardStore\.setState\(previousStoreState, true\);[\s\S]*?restoreScriptTransitionTracking\(previousScriptTransitionDirty\)/, "creation rollback catch must restore prior dirty semantics");

const fingerprintSource = functionDeclaration(app, "createScriptDeleteFingerprint");
const transformedFingerprint = await transform(fingerprintSource, { loader: "ts", format: "esm", target: "es2020" });
const fingerprintModule = await import(`data:text/javascript;base64,${Buffer.from(transformedFingerprint.code).toString("base64")}`);
const fingerprint = fingerprintModule.createScriptDeleteFingerprint;
const baseState = {
  shots: [
    { id: "shot-1", sequenceId: "seq-1", order: 1 },
    { id: "shot-2", sequenceId: "seq-1", order: 2 },
    { id: "shot-3", sequenceId: "seq-1", order: 3 }
  ],
  shotTransitions: [
    { id: "edge-12", sequenceId: "seq-1", fromShotId: "shot-1", toShotId: "shot-2" },
    { id: "edge-23", sequenceId: "seq-1", fromShotId: "shot-2", toShotId: "shot-3" }
  ]
};
const beforeConfirmation = fingerprint(baseState, "seq-1", "shot-2");
assert.ok(beforeConfirmation, "existing delete target must produce a fingerprint");
assert.notEqual(fingerprint({ ...baseState, shots: [...baseState.shots, { id: "shot-4", sequenceId: "seq-1", order: 4 }] }, "seq-1", "shot-2"), beforeConfirmation, "adding a shot during confirmation must invalidate deletion");
assert.notEqual(fingerprint({ ...baseState, shots: baseState.shots.map((shot) => shot.id === "shot-3" ? { ...shot, order: 1.5 } : shot) }, "seq-1", "shot-2"), beforeConfirmation, "reordering during confirmation must invalidate deletion");
assert.equal(fingerprint(baseState, "seq-1", "missing-shot"), null, "removed delete target must invalidate deletion");

console.log("PASS script transition integration");
