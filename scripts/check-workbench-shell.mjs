import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const repoRoot = process.cwd();

const result = await build({
  stdin: {
    contents: `
      export * from "./src/app-shell/workbenchRoutes.ts";
      export * from "./src/app-shell/workbenchStatus.ts";
    `,
    loader: "tsx",
    resolveDir: repoRoot,
    sourcefile: "workbench-shell-check.tsx"
  },
  absWorkingDir: repoRoot,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
});

const bundle = result.outputFiles[0]?.text;
assert.ok(bundle, "workbench shell bundle should be available");
const runtime = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);

assert.deepEqual(runtime.WORKBENCH_STAGES.map((stage) => stage.label), [
  "项目",
  "剧本",
  "资产",
  "预演",
  "分镜",
  "成片"
]);
assert.equal(runtime.getWorkbenchRoute("preview")?.label, "预演");
assert.equal(runtime.getWorkbenchRoute("unknown"), undefined);

const status = runtime.getWorkbenchStatus({
  saveState: "已保存",
  engineState: "本地引擎",
  taskState: "空闲"
});
assert.deepEqual(status, { save: "已保存", engine: "本地引擎", task: "空闲" });

const source = await readFile("src/app-shell/WorkbenchShell.tsx", "utf8");
assert.match(source, /StageNavigation/);
assert.match(source, /CompactStatusBar/);
assert.match(source, /advanced-tools/);
assert.match(source, /advancedOpen/);
assert.match(source, /data-workbench-stage/);
assert.match(source, /onStageChange \? stage : activeStage/);

const appSource = await readFile("src/app/App.tsx", "utf8");
assert.match(appSource, /WorkbenchShell/);
assert.match(appSource, /AppToastHost/);
assert.match(appSource, /AppDialogHost/);
const css = await readFile("src/styles/global.css", "utf8");
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /animation-duration:\s*0\.01ms\s*!important/);
assert.match(css, /transition-duration:\s*0\.01ms\s*!important/);

console.log("PASS workbench shell contract");
