import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import ts from "typescript";
import {
  canCommitConfirmedStageChange,
  createScriptTransitionPersistenceFingerprint,
  shouldConfirmScriptStageExit,
  shouldClearScriptTransitionDirtyAfterSave,
  shouldMarkRecoveredScriptDirty,
  shouldReplaceImportedScript
} from "../src/app/scriptTransitionSaveGuard.mjs";

const [app, scriptDirectorViewSource] = await Promise.all([
  readFile("src/app/App.tsx", "utf8"),
  readFile("src/features/script-director/ScriptDirectorView.tsx", "utf8")
]);

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
assert.equal(shouldMarkRecoveredScriptDirty({ recoveredFingerprint: "autosave-a", desktopFingerprint: null }), true, "web autosave recovery must be dirty");
assert.equal(shouldMarkRecoveredScriptDirty({ recoveredFingerprint: "autosave-b", desktopFingerprint: "desktop-a" }), true, "different autosave recovery must be dirty");
assert.equal(shouldMarkRecoveredScriptDirty({ recoveredFingerprint: "same", desktopFingerprint: "same" }), false, "desktop-identical recovery may be clean");
assert.equal(shouldReplaceImportedScript({ dirty: false, confirmationAccepted: false, revisionAtPrompt: 3, currentRevision: 3 }), true, "clean script import does not need overwrite confirmation");
assert.equal(shouldReplaceImportedScript({ dirty: true, confirmationAccepted: false, revisionAtPrompt: 3, currentRevision: 3 }), false, "cancelled overwrite must not replace script state");
assert.equal(shouldReplaceImportedScript({ dirty: true, confirmationAccepted: true, revisionAtPrompt: 3, currentRevision: 3 }), true, "confirmed unchanged overwrite may replace script state");
assert.equal(shouldReplaceImportedScript({ dirty: true, confirmationAccepted: true, revisionAtPrompt: 3, currentRevision: 4 }), false, "stale import confirmation must not replace newer edits");
assert.equal(shouldConfirmScriptStageExit({ currentStage: "script", nextStage: "assets", dirty: true }), true, "dirty script exit needs confirmation");
assert.equal(shouldConfirmScriptStageExit({ currentStage: "script", nextStage: "script", dirty: true }), false, "same-stage request needs no confirmation");
assert.equal(shouldConfirmScriptStageExit({ currentStage: "assets", nextStage: "preview", dirty: true }), false, "non-script navigation keeps old behavior");
assert.equal(canCommitConfirmedStageChange({ confirmationAccepted: false, requestId: 2, latestRequestId: 2 }), false, "cancelled stage exit must stay on script");
assert.equal(canCommitConfirmedStageChange({ confirmationAccepted: true, requestId: 2, latestRequestId: 2 }), true, "confirmed latest stage exit may commit");
assert.equal(canCommitConfirmedStageChange({ confirmationAccepted: true, requestId: 1, latestRequestId: 2 }), false, "stale stage confirmation must not win a navigation race");

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

function parseTypeScript(source, label) {
  return ts.createSourceFile(label, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function scopedDescendants(node, predicate) {
  const matches = [];
  const visit = (current) => {
    if (predicate(current)) matches.push(current);
    if (current !== node && ts.isFunctionLike(current)) return;
    ts.forEachChild(current, visit);
  };
  visit(node);
  return matches;
}

function controlFlowScope(sourceFile) {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.body) return statement.body;
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        declaration.initializer &&
        (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
      ) return declaration.initializer.body;
    }
  }
  return sourceFile;
}

function callsNamed(node, name) {
  return scopedDescendants(node, (current) => (
    ts.isCallExpression(current) &&
    ts.isIdentifier(current.expression) &&
    current.expression.text === name
  ));
}

function staticBooleanValue(expression) {
  const current = unwrapParentheses(expression);
  if (current.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (current.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isPrefixUnaryExpression(current) && current.operator === ts.SyntaxKind.ExclamationToken) {
    const operand = staticBooleanValue(current.operand);
    return operand === undefined ? undefined : !operand;
  }
  return undefined;
}

function scanReachable(node, callName) {
  const sequence = (statements) => {
    const calls = [];
    let continuing = [0];
    const terminated = [];
    for (const statement of statements) {
      if (continuing.length === 0) break;
      const result = scanReachable(statement, callName);
      calls.push(...result.calls);
      terminated.push(...continuing.flatMap((before) => result.terminated.map((after) => before + after)));
      continuing = continuing.flatMap((before) => result.continuing.map((after) => before + after));
    }
    return { calls, continuing, terminated };
  };

  if (ts.isSourceFile(node) || ts.isBlock(node)) return sequence(node.statements);
  if (ts.isFunctionLike(node)) return { calls: [], continuing: [0], terminated: [] };
  if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) {
    const calls = node.expression ? callsNamed(node.expression, callName) : [];
    return {
      calls,
      continuing: [],
      terminated: [calls.length]
    };
  }
  if (ts.isIfStatement(node)) {
    const conditionCalls = callsNamed(node.expression, callName);
    const withCondition = (branch) => ({
      calls: [...conditionCalls, ...branch.calls],
      continuing: branch.continuing.map((count) => conditionCalls.length + count),
      terminated: branch.terminated.map((count) => conditionCalls.length + count)
    });
    const condition = staticBooleanValue(node.expression);
    if (condition === true) {
      return withCondition(scanReachable(node.thenStatement, callName));
    }
    if (condition === false) {
      const branch = node.elseStatement
        ? scanReachable(node.elseStatement, callName)
        : { calls: [], continuing: [0], terminated: [] };
      return withCondition(branch);
    }
    const whenTrue = scanReachable(node.thenStatement, callName);
    const whenFalse = node.elseStatement
      ? scanReachable(node.elseStatement, callName)
      : { calls: [], continuing: [0], terminated: [] };
    return {
      calls: [...conditionCalls, ...whenTrue.calls, ...whenFalse.calls],
      continuing: [...whenTrue.continuing, ...whenFalse.continuing].map((count) => conditionCalls.length + count),
      terminated: [...whenTrue.terminated, ...whenFalse.terminated].map((count) => conditionCalls.length + count)
    };
  }
  if (ts.isTryStatement(node)) {
    const attempted = scanReachable(node.tryBlock, callName);
    const caught = node.catchClause
      ? scanReachable(node.catchClause.block, callName)
      : null;
    const beforeFinally = caught
      ? {
          calls: [...attempted.calls, ...caught.calls],
          continuing: [...attempted.continuing, ...caught.continuing],
          terminated: [...attempted.terminated, ...caught.terminated]
        }
      : attempted;
    if (!node.finallyBlock) return beforeFinally;
    const finalized = node.finallyBlock
      ? scanReachable(node.finallyBlock, callName)
      : { calls: [], continuing: [0], terminated: [] };
    return {
      calls: [...beforeFinally.calls, ...finalized.calls],
      continuing: beforeFinally.continuing.flatMap((before) => finalized.continuing.map((after) => before + after)),
      terminated: [
        ...beforeFinally.continuing.flatMap((before) => finalized.terminated.map((after) => before + after)),
        ...beforeFinally.terminated.flatMap((before) => [...finalized.continuing, ...finalized.terminated].map((after) => before + after))
      ]
    };
  }
  const calls = callsNamed(node, callName);
  return { calls, continuing: [calls.length], terminated: [] };
}

function reachableCallsNamed(node, name) {
  return scanReachable(node, name).calls;
}

function ifCalling(root, name) {
  return scopedDescendants(root, (node) => ts.isIfStatement(node) && callsNamed(node.expression, name).length === 1)[0];
}

function hasUnconditionalReturn(node, expectedExpression) {
  const matches = (current) => (
    ts.isReturnStatement(current) &&
    (expectedExpression === undefined || current.expression?.getText() === expectedExpression)
  );
  if (matches(node)) return true;
  if (!ts.isBlock(node)) return false;
  return node.statements.some(matches);
}

function unwrapParentheses(expression) {
  let current = expression;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function isDirectCallTo(expression, name) {
  const current = unwrapParentheses(expression);
  return (
    ts.isCallExpression(current) &&
    ts.isIdentifier(current.expression) &&
    current.expression.text === name
  );
}

function isFalseLiteral(expression) {
  return unwrapParentheses(expression).kind === ts.SyntaxKind.FalseKeyword;
}

function isDeniedGuardExpression(expression, helperName) {
  const current = unwrapParentheses(expression);
  if (ts.isPrefixUnaryExpression(current) && current.operator === ts.SyntaxKind.ExclamationToken) {
    return isDirectCallTo(current.operand, helperName);
  }
  if (!ts.isBinaryExpression(current)) return false;
  if (
    current.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
    current.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken
  ) return false;
  return (
    (isDirectCallTo(current.left, helperName) && isFalseLiteral(current.right)) ||
    (isFalseLiteral(current.left) && isDirectCallTo(current.right, helperName))
  );
}

function assertExclusiveRecoveryControlFlow(source, label) {
  const root = controlFlowScope(parseTypeScript(source, label));
  const decision = ifCalling(root, "shouldMarkRecoveredScriptDirty");
  assert.ok(decision, `${label}: missing recovery decision`);
  assert.ok(isDirectCallTo(decision.expression, "shouldMarkRecoveredScriptDirty"), `${label}: recovery decision must directly control the branch`);
  assert.ok(decision.elseStatement, `${label}: dirty and clean tracking must be explicit opposite branches`);
  const dirtyMarkPaths = scanReachable(decision.thenStatement, "markScriptTransitionDirty");
  assert.ok(
    dirtyMarkPaths.continuing.length > 0 &&
      dirtyMarkPaths.terminated.length === 0 &&
      dirtyMarkPaths.continuing.every((count) => count === 1),
    `${label}: every continuing dirty path must mark once (dirty branch must mark once)`
  );
  assert.equal(reachableCallsNamed(decision.thenStatement, "resetScriptTransitionTracking").length, 0, `${label}: dirty branch must never reset clean`);
  const cleanResetPaths = scanReachable(decision.elseStatement, "resetScriptTransitionTracking");
  assert.ok(
    cleanResetPaths.continuing.length > 0 &&
      cleanResetPaths.terminated.length === 0 &&
      cleanResetPaths.continuing.every((count) => count === 1),
    `${label}: every continuing clean path must reset once (matching baseline branch must reset once)`
  );
  assert.equal(reachableCallsNamed(decision.elseStatement, "markScriptTransitionDirty").length, 0, `${label}: matching baseline branch must not mark dirty`);
  assert.equal(
    reachableCallsNamed(root, "markScriptTransitionDirty").filter((call) => call.getStart() < decision.thenStatement.getStart() || call.end > decision.thenStatement.end).length,
    0,
    `${label}: no reachable mark call may escape the decision`
  );
  assert.equal(
    reachableCallsNamed(root, "resetScriptTransitionTracking").filter((call) => call.getStart() < decision.elseStatement.getStart() || call.end > decision.elseStatement.end).length,
    0,
    `${label}: no reachable reset call may escape the decision`
  );
}

function assertGuardedStageControlFlow(source, label) {
  const root = controlFlowScope(parseTypeScript(source, label));
  const guard = ifCalling(root, "canCommitConfirmedStageChange");
  assert.ok(guard, `${label}: missing stage commit guard`);
  assert.ok(isDeniedGuardExpression(guard.expression, "canCommitConfirmedStageChange"), `${label}: denied decisions must enter the guard branch`);
  assert.ok(hasUnconditionalReturn(guard.thenStatement, "false"), `${label}: denied or stale request must return false`);
  assert.equal(callsNamed(guard.thenStatement, "setWorkbenchStage").length, 0, `${label}: denied branch must not commit stage`);
  const commits = callsNamed(root, "setWorkbenchStage");
  assert.equal(commits.length, 1, `${label}: stage may commit exactly once`);
  assert.ok(guard.end < commits[0].getStart(), `${label}: stage commit must occur only after the early-return guard`);
}

function assertGuardedImportControlFlow(source, label) {
  const root = controlFlowScope(parseTypeScript(source, label));
  const guard = ifCalling(root, "shouldReplaceImportedScript");
  assert.ok(guard, `${label}: missing import replacement guard`);
  assert.ok(isDeniedGuardExpression(guard.expression, "shouldReplaceImportedScript"), `${label}: denied decisions must enter the guard branch`);
  assert.ok(hasUnconditionalReturn(guard.thenStatement), `${label}: denied import must return`);
  assert.equal(callsNamed(guard.thenStatement, "replaceShotScriptForCurrentSequence").length, 0, `${label}: denied branch must not replace script`);
  const replacements = callsNamed(root, "replaceShotScriptForCurrentSequence");
  assert.equal(replacements.length, 1, `${label}: accepted import may replace exactly once`);
  assert.ok(guard.end < replacements[0].getStart(), `${label}: replacement must occur only after the early-return guard`);
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
const importShotScript = constFunction(app, "onImportShotScript");
const stageChange = constFunction(app, "onWorkbenchStageChange");
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
assert.match(app, /const selectedShotIds = useStoryboardStore\(\(state\) => state\.selectedShotIds\)/, "App must subscribe to the persisted multi-shot selection");
assert.match(app, /const selectedShotTransitionId = useStoryboardStore\(\(state\) => state\.selectedShotTransitionId\)/);
const autosaveSelectionTracking = blockBetween(app, "saveAutosaveSnapshot({", "  ]);");
assert.ok(
  (autosaveSelectionTracking.match(/selectedShotIds/g) ?? []).length >= 2,
  "browser autosave must persist selectedShotIds and reschedule when it changes"
);
const desktopSelectionTracking = blockBetween(app, "if (!isDesktopRuntime()) return;", "const onSaveDesktop");
assert.match(desktopSelectionTracking, /selectedShotIds/, "desktop snapshot scheduling must react to selectedShotIds changes");
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

assert.match(app, /const stageChangeRequestRef = useRef\(0\)/);
assert.match(stageChange, /const requestId = \+\+stageChangeRequestRef\.current/);
assert.match(stageChange, /shouldConfirmScriptStageExit\(\{[\s\S]*currentStage: workbenchStage[\s\S]*nextStage[\s\S]*dirty: scriptTransitionDirtyRef\.current/);
assert.match(stageChange, /await confirmDialog\(\{[\s\S]*title:\s*"未保存转场"/);
assert.match(stageChange, /canCommitConfirmedStageChange\(\{[\s\S]*confirmationAccepted[\s\S]*requestId[\s\S]*latestRequestId: stageChangeRequestRef\.current/);
assert.ok(stageChange.indexOf("canCommitConfirmedStageChange") < stageChange.indexOf("setWorkbenchStage(nextStage)"), "stage confirmation guard must run before committing navigation");
assert.equal(app.match(/\bsetWorkbenchStage\(/g)?.length, 1, "all stage navigation must use the guarded stage-change function");
const unsafeStageFixture = `
  if (!canCommitConfirmedStageChange({ confirmationAccepted, requestId, latestRequestId })) {
    setWorkbenchStage(nextStage);
  }
  setWorkbenchStage(nextStage);
`;
assert.throws(
  () => assertGuardedStageControlFlow(unsafeStageFixture, "unsafe stage fixture"),
  /must return false|must not commit stage/,
  "control-flow contract must reject a denied/stale request that can still commit"
);
assertGuardedStageControlFlow(stageChange, "onWorkbenchStageChange");
const nestedReturnStageFixture = `
  if (!canCommitConfirmedStageChange({ confirmationAccepted, requestId, latestRequestId })) {
    const deadReturn = () => { return false; };
  }
  setWorkbenchStage(nextStage);
`;
assert.throws(
  () => assertGuardedStageControlFlow(nestedReturnStageFixture, "nested return stage fixture"),
  /must return false/,
  "a return hidden in a nested function must not terminate the denied stage path"
);
const compoundFalseStageFixture = `
  if (!canCommitConfirmedStageChange({ confirmationAccepted, requestId, latestRequestId }) && false) {
    return false;
  }
  setWorkbenchStage(nextStage);
`;
assert.throws(
  () => assertGuardedStageControlFlow(compoundFalseStageFixture, "compound false stage fixture"),
  /denied decisions must enter the guard branch/,
  "a compound condition that can never guard must be rejected"
);
for (const equivalentStageGuard of [
  `if (canCommitConfirmedStageChange({ confirmationAccepted, requestId, latestRequestId }) === false) return false; setWorkbenchStage(nextStage);`,
  `if (!(canCommitConfirmedStageChange({ confirmationAccepted, requestId, latestRequestId }))) return false; setWorkbenchStage(nextStage);`
]) {
  assert.doesNotThrow(
    () => assertGuardedStageControlFlow(equivalentStageGuard, "equivalent stage guard"),
    "semantically equivalent denied-stage guards must be accepted"
  );
}

assert.match(importShotScript, /const revisionAtPrompt = scriptRevisionRef\.current/);
assert.match(importShotScript, /if \(scriptTransitionDirtyRef\.current\)[\s\S]*await confirmDialog\(\{[\s\S]*title:\s*"覆盖未保存剧本"/);
assert.match(importShotScript, /shouldReplaceImportedScript\(\{[\s\S]*dirty:[\s\S]*confirmationAccepted[\s\S]*revisionAtPrompt[\s\S]*currentRevision: scriptRevisionRef\.current/);
assert.ok(importShotScript.indexOf("shouldReplaceImportedScript") < importShotScript.indexOf("replaceShotScriptForCurrentSequence"), "overwrite decision must precede script replacement");
const unsafeImportFixture = `
  if (!shouldReplaceImportedScript({ dirty, confirmationAccepted, revisionAtPrompt, currentRevision })) {
    replaceShotScriptForCurrentSequence(value);
    return;
  }
  replaceShotScriptForCurrentSequence(value);
`;
assert.throws(
  () => assertGuardedImportControlFlow(unsafeImportFixture, "unsafe import fixture"),
  /must not replace script|replace exactly once/,
  "control-flow contract must reject replacement from the denied branch"
);
assertGuardedImportControlFlow(importShotScript, "onImportShotScript");
for (const equivalentImportGuard of [
  `if (shouldReplaceImportedScript(input) === false) return; replaceShotScriptForCurrentSequence(value);`,
  `if (!(shouldReplaceImportedScript(input))) return; replaceShotScriptForCurrentSequence(value);`
]) {
  assert.doesNotThrow(
    () => assertGuardedImportControlFlow(equivalentImportGuard, "equivalent import guard"),
    "semantically equivalent denied-import guards must be accepted"
  );
}
assert.match(scriptDirectorViewSource, /event\.currentTarget\.value = "";[\s\S]*parseShotScriptText/);
assert.match(scriptDirectorViewSource, /if \(!result\.ok\) \{ setIssues\(result\.issues\); return; \}[\s\S]*onImportScript\(result\.value\)/, "parse failures must not request destructive overwrite confirmation");

const startupRecovery = blockBetween(app, "const hadUncleanExit", "return () =>");
assert.match(startupRecovery, /loadAutosaveSnapshot\(\)[\s\S]*hydrateFromSnapshot\(snapshot\);\s*markScriptTransitionDirty\(\);[\s\S]*需保存/, "web autosave recovery must remain dirty");
const workspaceRecovery = blockBetween(app, "const loadWorkspace", "void loadWorkspace");
assert.match(workspaceRecovery, /const desktopFingerprint = desktopSnapshot[\s\S]*const recoveredFingerprint = createScriptTransitionPersistenceFingerprint/);
const legacyRecoveryContract = /shouldMarkRecoveredScriptDirty\(\{ recoveredFingerprint, desktopFingerprint \}\)[\s\S]*markScriptTransitionDirty\(\)[\s\S]*resetScriptTransitionTracking\(\)/;
const legacyFalsePositive = `
  if (shouldMarkRecoveredScriptDirty({ recoveredFingerprint, desktopFingerprint })) {
    markScriptTransitionDirty();
  }
  resetScriptTransitionTracking();
`;
assert.equal(
  legacyRecoveryContract.test(legacyFalsePositive),
  true,
  "fixture must demonstrate that the legacy regex admitted an unconditional reset"
);
assert.throws(
  () => assertExclusiveRecoveryControlFlow(legacyFalsePositive, "legacy recovery false positive"),
  /opposite branches|no reset call may escape/,
  "AST contract must reject mark-then-unconditional-reset recovery"
);
assertExclusiveRecoveryControlFlow(workspaceRecovery, "loadWorkspace recovery");
const deadRecoveryMarkFixture = `
  if (shouldMarkRecoveredScriptDirty({ recoveredFingerprint, desktopFingerprint })) {
    function deadMark() { markScriptTransitionDirty(); }
  } else {
    resetScriptTransitionTracking();
  }
`;
assert.throws(
  () => assertExclusiveRecoveryControlFlow(deadRecoveryMarkFixture, "dead recovery mark fixture"),
  /dirty branch must mark once/,
  "a mark hidden in a nested declaration must not satisfy recovery control flow"
);
const afterReturnRecoveryFixture = `
  if (shouldMarkRecoveredScriptDirty({ recoveredFingerprint, desktopFingerprint })) {
    return;
    markScriptTransitionDirty();
  } else {
    resetScriptTransitionTracking();
  }
`;
assert.throws(
  () => assertExclusiveRecoveryControlFlow(afterReturnRecoveryFixture, "after-return recovery fixture"),
  /dirty branch must mark once/,
  "a mark after an unconditional return must be unreachable"
);
const staticFalseRecoveryFixture = `
  if (shouldMarkRecoveredScriptDirty({ recoveredFingerprint, desktopFingerprint })) {
    if (false) markScriptTransitionDirty();
  } else {
    resetScriptTransitionTracking();
  }
`;
assert.throws(
  () => assertExclusiveRecoveryControlFlow(staticFalseRecoveryFixture, "static-false recovery fixture"),
  /dirty branch must mark once/,
  "a mark inside a statically false branch must be unreachable"
);
const conditionalRecoveryMarkFixture = `
  if (shouldMarkRecoveredScriptDirty({ recoveredFingerprint, desktopFingerprint })) {
    if (condition) markScriptTransitionDirty();
  } else {
    resetScriptTransitionTracking();
  }
`;
assert.throws(
  () => assertExclusiveRecoveryControlFlow(conditionalRecoveryMarkFixture, "conditional recovery mark fixture"),
  /every continuing dirty path must mark once/,
  "a mark on only one side of an unknown condition must not satisfy recovery control flow"
);
const bothBranchesMarkRecoveryFixture = `
  if (shouldMarkRecoveredScriptDirty({ recoveredFingerprint, desktopFingerprint })) {
    if (condition) markScriptTransitionDirty();
    else markScriptTransitionDirty();
  } else {
    resetScriptTransitionTracking();
  }
`;
assert.doesNotThrow(
  () => assertExclusiveRecoveryControlFlow(bothBranchesMarkRecoveryFixture, "both branches mark recovery fixture"),
  "equivalent marks on every unknown-condition branch must satisfy recovery control flow"
);
const markAfterBranchRecoveryFixture = `
  if (shouldMarkRecoveredScriptDirty({ recoveredFingerprint, desktopFingerprint })) {
    if (condition) prepareFirstPath();
    else prepareSecondPath();
    markScriptTransitionDirty();
  } else {
    resetScriptTransitionTracking();
  }
`;
assert.doesNotThrow(
  () => assertExclusiveRecoveryControlFlow(markAfterBranchRecoveryFixture, "mark after branch recovery fixture"),
  "one shared mark after an unknown condition must satisfy every continuing path"
);
assert.match(recovery, /hydrateFromSnapshot\(snapshot\);\s*markScriptTransitionDirty\(\);[\s\S]*需保存/, "explicit autosave recovery must remain dirty");

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
