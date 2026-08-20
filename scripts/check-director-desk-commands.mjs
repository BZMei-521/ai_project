import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  entryPoints: ["src/app-shell/directorDeskCommands.ts"],
  absWorkingDir: process.cwd(),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});
const source = result.outputFiles[0].text;
const runtime = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const invoked = [];
const actionNames = [
  "createProject", "openProject", "renameProject", "deleteProject", "saveProject",
  "loadProject", "exportBackup", "importBackup", "openSettings", "openHelp",
  "openNodeflow", "openAdvancedTools"
];
const actions = Object.fromEntries(actionNames.map((name) => [name, () => invoked.push(name)]));
const commands = runtime.buildDirectorCommands(actions);

assert.deepEqual(commands.map(({ id }) => id), [
  "project.create", "project.open", "project.rename", "project.delete",
  "project.save", "project.load", "backup.export", "backup.import",
  "app.settings", "app.help", "app.nodeflow", "app.advanced"
]);
assert.equal(commands.find(({ id }) => id === "project.delete").danger, true);
assert.deepEqual(runtime.searchDirectorCommands(commands, "备份").map(({ id }) => id), [
  "backup.export", "backup.import"
]);
commands.find(({ id }) => id === "project.open").run();
assert.deepEqual(invoked, ["openProject"]);
console.log("PASS director desk commands");
