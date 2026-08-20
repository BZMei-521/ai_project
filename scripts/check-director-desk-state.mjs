import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  entryPoints: ["src/app-shell/directorDeskState.ts"],
  absWorkingDir: process.cwd(),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});
const source = result.outputFiles[0].text;
const state = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

assert.equal(state.normalizeWorkbenchStage("preview"), "preview");
assert.equal(state.normalizeWorkbenchStage("missing"), "project");
assert.equal(state.normalizeWorkbenchStage(null, "storyboard"), "storyboard");

const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value)
};
assert.equal(state.readLastWorkbenchStage(storage), "project");
state.writeLastWorkbenchStage("production", storage);
assert.equal(state.readLastWorkbenchStage(storage), "production");
values.set(state.LAST_WORKBENCH_STAGE_KEY, "invalid-stage");
assert.equal(state.readLastWorkbenchStage(storage), "project");
console.log("PASS director desk state");
