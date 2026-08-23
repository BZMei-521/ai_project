import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import TestRenderer from "react-test-renderer";

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
assert.match(source, /ProductionStageRail/);
assert.match(source, /DirectorTopBar/);
assert.match(source, /CommandPalette/);
assert.match(source, /ObjectInspectorDrawer/);
assert.match(source, /data-director-desk/);
assert.match(source, /metaKey|ctrlKey/);
assert.match(source, /event\.key\.toLocaleLowerCase\(\) !== "k"/);
assert.doesNotMatch(source, /<details[\s\S]*workbench-advanced-tools/);
assert.match(source, /data-workbench-stage/);
assert.match(source, /onStageChange \? stage : activeStage/);

const shellBuild = await build({
  stdin: {
    contents: `export { WorkbenchShell } from "./src/app-shell/WorkbenchShell.tsx";`,
    loader: "tsx",
    resolveDir: repoRoot,
    sourcefile: "workbench-shell-behavior-check.tsx"
  },
  absWorkingDir: repoRoot,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  jsx: "automatic",
  external: ["react"],
  write: false,
});
const shellBundle = shellBuild.outputFiles[0]?.text;
assert.ok(shellBundle, "workbench shell behavior bundle should be available");
const shellModuleDirectory = await mkdtemp(join(repoRoot, ".workbench-shell-check-"));
const shellModuleFile = join(shellModuleDirectory, "runtime.mjs");
await writeFile(shellModuleFile, shellBundle, "utf8");
try {
  const shellRuntime = await import(pathToFileURL(shellModuleFile).href);
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalHTMLElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  let fakeDocument;
  class FakeElement {
    constructor(name) {
      this.name = name;
      this.focusCount = 0;
      this.attributes = new Map();
    }
    focus() {
      this.focusCount += 1;
      fakeDocument.activeElement = this;
    }
    contains(target) {
      return target === this;
    }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }
    removeAttribute(name) {
      this.attributes.delete(name);
    }
    hasAttribute(name) {
      return this.attributes.has(name);
    }
  }
  const documentListeners = new Map();
  const initialFocus = new FakeElement("initial");
  const commandTriggerElement = new FakeElement("command-trigger");
  const projectToggleElement = new FakeElement("project-toggle");
  const firstProjectCommandElement = new FakeElement("first-project-command");
  const projectMenuElement = new FakeElement("project-menu");
  projectMenuElement.querySelector = () => firstProjectCommandElement;
  const paletteSearchElement = new FakeElement("palette-search");
  const paletteCloseElement = new FakeElement("palette-close");
  const paletteDialogElement = new FakeElement("palette-dialog");
  paletteDialogElement.querySelectorAll = () => [paletteSearchElement, paletteCloseElement];
  const advancedCloseElement = new FakeElement("advanced-close");
  const shellContentElement = new FakeElement("shell-content");
  fakeDocument = {
    activeElement: initialFocus,
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) ?? new Set();
      listeners.add(listener);
      documentListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      documentListeners.get(type)?.delete(listener);
    }
  };
  Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: fakeDocument });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, writable: true, value: FakeElement });
  let projectRuns = 0;
  let deleteRuns = 0;
  let advancedRuns = 0;
  let shell;
  const commands = [
    { id: "project.open", label: "打开项目", keywords: [], run: () => { projectRuns += 1; } },
    { id: "project.delete", label: "删除项目", keywords: [], danger: true, run: () => { deleteRuns += 1; } },
    { id: "app.advanced", label: "高级工具", keywords: [], run: () => { advancedRuns += 1; } }
  ];

  await TestRenderer.act(async () => {
    shell = TestRenderer.create(React.createElement(
      shellRuntime.WorkbenchShell,
      { stage: "project", commands, inspector: React.createElement("p", null, "检查器内容") },
      React.createElement("main", null, "工作区内容")
    ), {
      createNodeMock(element) {
        if (element.type === "div" && element.props["data-director-shell-content"]) return shellContentElement;
        if (element.type === "button" && element.props["aria-label"] === "搜索命令") return commandTriggerElement;
        if (element.type === "button" && element.props["aria-label"] === "打开项目菜单") return projectToggleElement;
        if (element.type === "div" && element.props["data-director-project-menu"]) return projectMenuElement;
        if (element.type === "input" && element.props["aria-label"] === "搜索命令") return paletteSearchElement;
        if (element.type === "div" && element.props.role === "dialog") return paletteDialogElement;
        if (element.type === "button" && element.props["aria-label"] === "关闭命令面板") return paletteCloseElement;
        if (element.type === "button" && element.props["aria-label"] === "关闭高级工具") return advancedCloseElement;
        return null;
      }
    });
  });

  assert.equal(shell.root.findAllByType("main").length, 1, "shell should not nest a second main landmark around app content");
  assert.equal(shell.root.findByProps({ href: "#director-workspace" }).children.join(""), "跳到制作工作区");

  const findButton = (label) => shell.root.findAllByType("button").find((button) => button.children.join("") === label);
  const projectMenuToggle = shell.root.findByProps({ "aria-label": "打开项目菜单" });
  await TestRenderer.act(async () => {
    projectMenuToggle.props.onClick();
    await Promise.resolve();
  });
  const openProject = findButton("打开项目");
  const deleteProject = findButton("删除项目");
  assert.ok(openProject, "project menu should expose project commands");
  assert.ok(deleteProject, "project menu should expose the delete command");
  assert.equal(openProject.props["data-danger"], undefined, "non-dangerous project commands should not be marked dangerous");
  assert.equal(deleteProject.props["data-danger"], "true", "project.delete should be marked dangerous");
  await TestRenderer.act(async () => {
    openProject.props.onClick();
  });
  assert.equal(projectRuns, 1, "project command should run once");
  assert.equal(deleteRuns, 0, "checking command metadata should not invoke delete");
  assert.equal(shell.root.findAllByProps({ "data-director-project-menu": true }).length, 0, "project menu should close after invoking a command");

  const inspectorClose = shell.root.findByProps({ "aria-label": "关闭检查器" });
  await TestRenderer.act(async () => {
    inspectorClose.props.onClick();
  });
  const reopenInspector = shell.root.findByProps({ "aria-label": "打开当前对象检查器" });
  await TestRenderer.act(async () => {
    reopenInspector.props.onClick();
  });
  assert.equal(shell.root.findByProps({ "data-director-inspector": true }).props["data-open"], true, "inspector should reopen after closing");

  const openCommands = shell.root.findByProps({ "aria-label": "搜索命令" });
  await TestRenderer.act(async () => {
    openCommands.props.onClick();
    await Promise.resolve();
  });
  const shellContent = shell.root.findByProps({ "data-director-shell-content": true });
  assert.equal(shellContentElement.hasAttribute("inert"), true, "an open aria-modal palette should inert the shell background");
  assert.equal(shellContent.props["aria-hidden"], true, "an open aria-modal palette should hide the shell background from AT");
  assert.equal(shell.root.findAllByProps({ "data-director-command-backdrop": true }).length, 1, "palette should own a pointer-blocking backdrop");
  const openAdvanced = shell.root.findAllByProps({ role: "option" }).find((button) => (
    button.findAllByType("span").some((label) => label.children.join("") === "高级工具")
  ));
  assert.ok(openAdvanced, "command palette should expose advanced tools");
  await TestRenderer.act(async () => {
    openAdvanced.props.onClick();
    await Promise.resolve();
  });
  assert.equal(advancedRuns, 0, "app.advanced should be replaced only by the shell drawer action");
  const advancedDrawer = shell.root.findByProps({ className: "director-advanced-drawer" });
  assert.equal(advancedDrawer.props["aria-label"], "高级工具", "advanced drawer should expose an accessible landmark name");
  assert.equal(fakeDocument.activeElement, advancedCloseElement, "advanced drawer should receive initial focus");
  assert.equal(shellContentElement.hasAttribute("inert"), false, "palette background isolation should restore after command handoff");
  const closeAdvanced = shell.root.findByProps({ "aria-label": "关闭高级工具" });
  await TestRenderer.act(async () => {
    advancedDrawer.props.onKeyDown({ key: "Escape", preventDefault() {} });
    await Promise.resolve();
  });
  assert.equal(shell.root.findAllByProps({ className: "director-advanced-drawer" }).length, 0, "advanced drawer should close");
  assert.equal(fakeDocument.activeElement, commandTriggerElement, "closing advanced tools should return focus to the palette opener");
  assert.ok(closeAdvanced, "advanced close control should remain keyboard reachable");

  await TestRenderer.act(async () => {
    projectMenuToggle.props.onClick();
    await Promise.resolve();
  });
  assert.equal(fakeDocument.activeElement, firstProjectCommandElement, "opening the project menu should focus its first command");
  await TestRenderer.act(async () => {
    for (const listener of documentListeners.get("keydown") ?? []) {
      listener({ key: "Escape", defaultPrevented: false, metaKey: false, ctrlKey: false, preventDefault() {} });
    }
    await Promise.resolve();
  });
  assert.equal(shell.root.findAllByProps({ "data-director-project-menu": true }).length, 0, "Escape should close the project menu");
  assert.equal(fakeDocument.activeElement, projectToggleElement, "project menu Escape should return focus to its trigger");

  await TestRenderer.act(async () => {
    shell.unmount();
  });
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else delete globalThis.document;
  if (originalHTMLElement) Object.defineProperty(globalThis, "HTMLElement", originalHTMLElement);
  else delete globalThis.HTMLElement;
} finally {
  await rm(shellModuleDirectory, { recursive: true, force: true });
}

const appSource = await readFile("src/app/App.tsx", "utf8");
assert.match(appSource, /WorkbenchShell/);
assert.match(appSource, /AppToastHost/);
assert.match(appSource, /AppDialogHost/);
assert.match(appSource, /showOnboardingPanel && workbenchStage === "project"/);
assert.match(appSource, /key=\{workbenchStage\}[\s\S]*?ref=\{centerColumnRef\}/);
const timelineSource = await readFile("src/modules/preview-engine/TimelinePanel.tsx", "utf8");
assert.doesNotMatch(timelineSource, /timelineShotRefs\.current\[selectedShotId\]\?\.scrollIntoView/);
assert.match(timelineSource, /closest<HTMLElement>\("\.timeline-scroll"\)/);
const css = await readFile("src/styles/global.css", "utf8");
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /animation-duration:\s*0\.01ms\s*!important/);
assert.match(css, /transition-duration:\s*0\.01ms\s*!important/);
assert.match(css, /\.main-focus\s*\{[\s\S]*?overflow-anchor:\s*none/);

console.log("PASS workbench shell contract");
