import React from "react";
import TestRenderer from "react-test-renderer";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const result = await build({
  stdin: {
    contents: `
      export * from "./src/app-shell/workbenchRoutes.ts";
      export * from "./src/app-shell/ProductionStageRail.tsx";
      export * from "./src/app-shell/DirectorTopBar.tsx";
      export * from "./src/app-shell/CommandPalette.tsx";
      export * from "./src/app-shell/ObjectInspectorDrawer.tsx";
      export * from "./src/shared/ui/EmptyState.tsx";
      export * from "./src/shared/ui/RecoveryNotice.tsx";
    `,
    loader: "tsx",
    resolveDir: process.cwd(),
    sourcefile: "director-desk-components-check.tsx"
  },
  absWorkingDir: process.cwd(),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["react", "react-test-renderer"],
  write: false
});
const source = result.outputFiles[0].text;
// A data: module cannot resolve the deliberately external React dependency.
// Loading the bundle from a temporary file preserves the contract while using
// the workspace's normal Node module resolution.
const moduleDirectory = await mkdtemp(join(process.cwd(), ".director-desk-components-"));
const moduleFile = join(moduleDirectory, "runtime.mjs");
await writeFile(moduleFile, source, "utf8");
try {
const runtime = await import(pathToFileURL(moduleFile).href);

assert.deepEqual(runtime.WORKBENCH_STAGES.map(({ label }) => label), ["项目", "剧本", "资产", "预演", "分镜", "成片"]);

const rail = TestRenderer.create(React.createElement(runtime.ProductionStageRail, {
  activeStage: "preview",
  completedStages: ["project", "script", "assets"],
  attentionStages: ["preview"],
  onStageChange: () => undefined
}));
assert.equal(rail.root.findAllByProps({ "aria-current": "page" })[0].props["data-stage"], "preview");
assert.equal(rail.root.findAllByProps({ "data-stage-state": "done" }).length, 3);

const top = TestRenderer.create(React.createElement(runtime.DirectorTopBar, {
  projectName: "荒原纪",
  projectPath: "预演 / 河岸营地",
  saveStatus: "已保存",
  primaryAction: { label: "确认这一节拍", onInvoke: () => undefined },
  onOpenCommands: () => undefined,
  onOpenProjectMenu: () => undefined
}));
assert.equal(top.root.findAllByProps({ "data-director-primary": true }).length, 1);
assert.equal(top.root.findAllByProps({ "aria-label": "搜索命令" }).length, 1);

const emptyInspector = TestRenderer.create(React.createElement(runtime.ObjectInspectorDrawer, {
  open: false,
  title: "当前对象",
  onClose: () => undefined
}));
assert.match(JSON.stringify(emptyInspector.toJSON()), /未选择对象/);

const recovery = TestRenderer.create(React.createElement(runtime.RecoveryNotice, {
  stage: "分镜生成",
  summary: "第 04 镜生成失败",
  outputState: "未产生图片文件",
  recovery: "检查参考图后重试",
  onRetry: () => undefined
}));
const recoveryText = JSON.stringify(recovery.toJSON());
for (const text of ["分镜生成", "第 04 镜生成失败", "未产生图片文件", "检查参考图后重试", "重试"]) {
  assert.match(recoveryText, new RegExp(text));
}

const palette = TestRenderer.create(React.createElement(runtime.CommandPalette, {
  open: true,
  commands: [{ id: "project.delete", label: "删除项目", keywords: ["删除"], danger: true, run: () => undefined }],
  onClose: () => undefined
}));
assert.equal(palette.root.findByProps({ role: "dialog" }).props["aria-modal"], true);
assert.equal(palette.root.findByProps({ "data-danger": "true" }).props.type, "button");
assert.equal(palette.root.findByProps({ "aria-label": "搜索命令" }).props.type, "search");
console.log("PASS director desk components");
} finally {
await rm(moduleDirectory, { recursive: true, force: true });
}
