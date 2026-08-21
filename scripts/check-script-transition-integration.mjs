import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile("src/app/App.tsx", "utf8");

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

const stageViews = blockBetween(app, "const focusedStageView", "const selectedShot");
const inspector = blockBetween(app, "const inspectorByStage", "const workbenchInspector");
const primaryActions = blockBetween(app, "const stagePrimaryAction", "const currentStageIndex");
const saveDesktop = blockBetween(app, "const onSaveDesktop", "const onLoadDesktop");
const scriptViewStart = stageViews.indexOf('<ScriptDirectorView');
const scriptViewEnd = stageViews.indexOf('/>', scriptViewStart);
assert.notEqual(scriptViewStart, -1, "script stage must render ScriptDirectorView");
assert.notEqual(scriptViewEnd, -1, "ScriptDirectorView must be self-closing");
const scriptView = compact(stageViews.slice(scriptViewStart, scriptViewEnd + 2));

assert.match(app, /const \[scriptTransitionDirty, setScriptTransitionDirty\] = useState\(false\)/);
assert.match(app, /const shotTransitions = useStoryboardStore\(\(state\) => state\.shotTransitions\)/);
assert.match(app, /const selectedShotTransitionId = useStoryboardStore\(\(state\) => state\.selectedShotTransitionId\)/);
assert.match(app, /const scriptShots = shots[\s\S]*?\.filter\(\(shot\) => shot\.sequenceId === currentSequenceId\)[\s\S]*?\.sort\(\(a, b\) => a\.order - b\.order\)/);
assert.match(app, /const scriptTransitions = shotTransitions\.filter\(\(item\) => item\.sequenceId === currentSequenceId\)/);

for (const prop of [
  "shots={scriptShots}",
  "transitions={scriptTransitions}",
  "onImportScript={onImportShotScript}",
  "onMoveShot={onMoveScriptShot}",
  "onUndo={onUndoScriptSequence}",
  "onRedo={onRedoScriptSequence}"
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

assert.match(inspector, /script:\s*<ScriptTransitionInspector/);
assert.match(primaryActions, /script:\s*scriptTransitionDirty[\s\S]*保存转场[\s\S]*saveScriptTransitions/);
assert.match(app, /confirmDialog\(\{[\s\S]*title:\s*"删除镜头"[\s\S]*相邻转场/);
assert.doesNotMatch(stageViews, /继续到资产/);

assert.match(saveDesktop, /const onSaveDesktop = async \(\): Promise<boolean> =>/);
assert.match(saveDesktop, /setSaveState\("已保存"\);\s*return true;/);
assert.match(saveDesktop, /return false;/);
assert.match(app, /const saveScriptTransitions = async \(\) => \{\s*if \(await onSaveDesktop\(\)\) setScriptTransitionDirty\(false\);\s*\}/);

for (const operation of [
  "replaceShotScriptForCurrentSequence",
  "moveShotToIndex",
  "updateShotTransition",
  "deleteShot",
  "undoShotSequenceEdit",
  "redoShotSequenceEdit"
]) {
  assert.match(app, new RegExp(`${operation}\\([\\s\\S]*?setScriptTransitionDirty\\(true\\)`), `${operation} must mark script transitions dirty`);
}

assert.match(app, /hydrateFromSnapshot\(snapshot\);\s*setScriptTransitionDirty\(false\);/);
assert.match(app, /resetForNewProject\(name\);[\s\S]*?setScriptTransitionDirty\(false\);/);
assert.match(app, /parseSnapshotBackup\(text\);\s*hydrateFromSnapshot\(snapshot\);\s*setScriptTransitionDirty\(false\);/);
assert.match(app, /restoreAutosaveVersion[\s\S]*?hydrateFromSnapshot\(snapshot\);\s*setScriptTransitionDirty\(false\);/);

console.log("PASS script transition integration");
