import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, shell, css] = (await Promise.all([
  readFile("src/app/App.tsx", "utf8"),
  readFile("src/app-shell/WorkbenchShell.tsx", "utf8"),
  readFile("src/styles/director-desk.css", "utf8")
])).map((source) => source.replace(/\r\n/g, "\n"));

function blockBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing block start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing block end: ${end}`);
  return source.slice(startIndex, endIndex);
}

assert.match(app, /const \[advancedToolsOpen, setAdvancedToolsOpen\] = useState\(false\)/);
assert.match(app, /const \[nodeflowMode, setNodeflowMode\] = useState\(false\)/);
assert.match(app, /useState<WorkbenchStage>\(readLastWorkbenchStage\)/);
assert.match(app, /useEffect\(\(\) => \{\s*writeLastWorkbenchStage\(workbenchStage\);\s*\}, \[workbenchStage\]\)/);

const commands = blockBetween(app, "const directorCommands = buildDirectorCommands({", "const stagePrimaryAction");
for (const [action, callback] of Object.entries({
  createProject: "onCreateProject",
  openProject: "onOpenProjectPath",
  renameProject: "onRenameProject",
  deleteProject: "onDeleteProject",
  saveProject: "onManualSaveDesktop",
  loadProject: "onLoadDesktop",
  exportBackup: "onExportBackup",
  importBackup: "onImportBackupClick",
  openSettings: "onEditProjectSettings"
})) {
  assert.match(commands, new RegExp(`\\b${action}:\\s*${callback}\\b`), `${action} must retain its App callback`);
}
assert.match(commands, /openHelp:\s*\(\) => setShowHelpPanel\(true\)/);
assert.match(commands, /openNodeflow:\s*\(\) => setNodeflowMode\(true\)/);
assert.match(commands, /openAdvancedTools:\s*\(\) => setAdvancedToolsOpen\(true\)/);

const primaryActions = blockBetween(app, "const stagePrimaryAction", "const currentStageIndex");
for (const stage of ["project", "script", "assets", "preview", "storyboard", "production"]) {
  assert.match(primaryActions, new RegExp(`\\b${stage}:`), `missing ${stage} primary action`);
}
assert.match(primaryActions, /production:\s*\{[^}]*onInvoke:\s*\(\) => setAdvancedToolsOpen\(true\)/s);

const stageProgress = blockBetween(app, "const currentStageIndex", "const fallbackPreviewScene");
assert.match(stageProgress, /WORKBENCH_STAGES\.findIndex/);
assert.match(stageProgress, /WORKBENCH_STAGES\s*\.slice\(0, Math\.max\(0, currentStageIndex\)\)/);
assert.match(stageProgress, /const attentionStages = nextOnboardingStep \? \[workbenchStage\] : \[\]/);

const stageViews = blockBetween(app, "const focusedStageView", "const selectedShot");
assert.doesNotMatch(stageViews, /<(?:ProjectWorkspaceView|ScriptDirectorView|AssetWorkspaceView)[^>]*(?:onCreateProject|onContinue)=/s);
assert.doesNotMatch(stageViews, /<(?:StoryboardWorkspaceView|ProductionWorkspaceView)[^>]*(?:onContinue|onExport)=/s);
assert.match(stageViews, /<ScriptDirectorView[\s\S]*?onSelectionChange=/);
assert.doesNotMatch(stageViews, /<ScriptDirectorView[\s\S]*?onSelectionChange=\{\(\) => undefined\}/);
assert.doesNotMatch(stageViews, /<ScriptDirectorView[\s\S]*?\bonSelect(?:Shot|Transition)=/);

const inspector = blockBetween(app, "const inspectorByStage", "const workbenchInspector");
for (const stage of ["project", "script", "assets", "preview", "storyboard", "production"]) {
  assert.match(inspector, new RegExp(`\\b${stage}:`), `missing ${stage} inspector`);
}
assert.match(inspector, /selectedSpatialObject\?\.label/);
assert.doesNotMatch(inspector, /selectedSpatialObject\?\.name/);

const shellUsage = blockBetween(app, "<WorkbenchShell", ">\n      <div");
for (const prop of [
  "projectName={project.name", "projectPath={activeWorkspacePath", "primaryAction={stagePrimaryAction}",
  "commands={directorCommands}", "completedStages={completedStages}", "attentionStages={attentionStages}",
  "inspector={workbenchInspector}", "statusSnapshot={{", "advancedToolsOpen={advancedToolsOpen}",
  "onAdvancedToolsOpenChange={setAdvancedToolsOpen}"
]) assert.ok(shellUsage.includes(prop), `WorkbenchShell must receive ${prop}`);

assert.match(shell, /advancedToolsOpen\?: boolean/);
assert.match(shell, /onAdvancedToolsOpenChange\?: \(open: boolean\) => void/);
assert.match(shell, /const advancedOpen = advancedToolsOpen \?\? uncontrolledAdvancedOpen/);
assert.match(shell, /command\.id === "app\.advanced"[\s\S]*?setAdvancedOpen\(true\)/);
assert.match(shell, /onAdvancedToolsOpenChange\?\.\(open\)/);
assert.match(shell, /\{advancedOpen && \(/);

assert.match(css, /\.director-desk-workspace\s*>\s*\.app-shell\s*\{[^}]*position:\s*relative[^}]*height:\s*100%[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)[^}]*\}/s);
assert.match(css, /\.director-desk-workspace\s+\.workbench-layout\s*\{[^}]*height:\s*100%[^}]*padding-left:\s*0[^}]*\}/s);
assert.match(css, /\.director-desk-workspace\s+\[data-stage-view\]\s*>\s*button\s*\{[^}]*display:\s*none[^}]*\}/s);
assert.match(css, /\.director-desk-workspace\s*>\s*\.app-shell\s*>\s*\.onboarding-panel\s*\{[^}]*position:\s*absolute[^}]*overflow:\s*auto[^}]*\}/s);

assert.doesNotMatch(app, /<header className="topbar">/);
for (const overlay of [
  /showRecoveryPanel &&/, /showOnboardingPanel && workbenchStage === "project"/,
  /<input[\s\S]*?hidden[\s\S]*?onImportBackupFile/, /showHelpPanel &&/,
  /\{focusedStageView\}/, /<AppToastHost \/>/, /<AppDialogHost \/>/
]) assert.match(app, overlay);

console.log("PASS director desk app integration");
