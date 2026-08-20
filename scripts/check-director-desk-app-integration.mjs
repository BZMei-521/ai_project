import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile("src/app/App.tsx", "utf8");
assert.match(app, /readLastWorkbenchStage/);
assert.match(app, /writeLastWorkbenchStage/);
assert.match(app, /buildDirectorCommands/);
assert.match(app, /projectName=\{project\.name/);
assert.match(app, /primaryAction=\{stagePrimaryAction\}/);
assert.match(app, /commands=\{directorCommands\}/);
assert.match(app, /const \[nodeflowMode, setNodeflowMode\] = useState\(false\)/);
assert.doesNotMatch(app, /<header className="topbar">/);
for (const callback of [
  "onCreateProject", "onOpenProjectPath", "onRenameProject", "onDeleteProject",
  "onSaveDesktop", "onLoadDesktop", "onExportBackup", "onImportBackupClick",
  "onEditProjectSettings"
]) assert.match(app, new RegExp(callback));
console.log("PASS director desk app integration");
