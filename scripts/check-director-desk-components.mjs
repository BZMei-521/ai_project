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
assert.equal(rail.root.findByProps({ "data-stage": "preview" }).props["data-stage-attention"], "true");

const overlappingRail = TestRenderer.create(React.createElement(runtime.ProductionStageRail, {
  activeStage: "script",
  completedStages: ["project", "script"],
  attentionStages: ["project", "script"],
  onStageChange: () => undefined
}));
const doneAndAttention = overlappingRail.root.findByProps({ "data-stage": "project" });
assert.equal(doneAndAttention.props["data-stage-state"], "done");
assert.equal(doneAndAttention.props["data-stage-attention"], "true");
const activeAndAttention = overlappingRail.root.findByProps({ "data-stage": "script" });
assert.equal(activeAndAttention.props["data-stage-state"], "active");
assert.equal(activeAndAttention.props["data-stage-attention"], "true");

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
assert.equal(emptyInspector.root.findByType("aside").props.hidden, true);

const openInspector = TestRenderer.create(React.createElement(runtime.ObjectInspectorDrawer, {
  open: true,
  title: "当前对象",
  onClose: () => undefined
}, React.createElement("button", null, "可编辑对象")));
assert.equal(openInspector.root.findByType("aside").props.hidden, false);
assert.equal(openInspector.root.findAllByType("button").some((button) => button.children.join("") === "可编辑对象"), true);

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

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalHTMLElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
if (originalDocument) delete globalThis.document;
const ssrPalette = TestRenderer.create(React.createElement(runtime.CommandPalette, {
  open: true,
  commands: [],
  onClose: () => undefined
}));
assert.equal(ssrPalette.root.findByProps({ role: "dialog" }).props["aria-modal"], true);
ssrPalette.unmount();

let fakeDocument;
class FakeElement {
  constructor(name) {
    this.name = name;
    this.focusCount = 0;
  }

  focus() {
    this.focusCount += 1;
    fakeDocument.activeElement = this;
  }
}

const previousFocus = new FakeElement("previous");
fakeDocument = { activeElement: previousFocus };
Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: fakeDocument });
Object.defineProperty(globalThis, "HTMLElement", { configurable: true, writable: true, value: FakeElement });

function keyboardEvent(key, shiftKey = false) {
  let prevented = false;
  return {
    key,
    shiftKey,
    preventDefault() {
      prevented = true;
    },
    get prevented() {
      return prevented;
    }
  };
}

async function createFocusTestPalette(commands, onClose) {
  const searchInput = new FakeElement("search");
  const commandButtons = commands.map((command) => new FakeElement(command.id));
  const closeButton = new FakeElement("close");
  const dialog = {
    querySelectorAll() {
      return [searchInput, ...commandButtons, closeButton];
    }
  };
  let commandButtonIndex = 0;
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(runtime.CommandPalette, {
      open: true,
      commands,
      onClose
    }), {
      createNodeMock(element) {
        if (element.type === "input") return searchInput;
        if (element.type === "div" && element.props.role === "dialog") return dialog;
        if (element.type === "button" && element.props["aria-label"] === "关闭命令面板") return closeButton;
        if (element.type === "button") return commandButtons[commandButtonIndex++];
        return null;
      }
    });
    await Promise.resolve();
  });
  return { renderer, searchInput, commandButtons, closeButton };
}

let firstRuns = 0;
let secondRuns = 0;
let commandCloseCalls = 0;
const behaviorCommands = [
  { id: "project.open", label: "打开项目", keywords: ["打开"], run: () => { firstRuns += 1; } },
  { id: "project.delete", label: "删除项目", keywords: ["删除"], danger: true, run: () => { secondRuns += 1; } }
];
const focusPalette = await createFocusTestPalette(behaviorCommands, () => { commandCloseCalls += 1; });
assert.equal(fakeDocument.activeElement, focusPalette.searchInput);
assert.equal(focusPalette.searchInput.focusCount, 1);

const dialogNode = focusPalette.renderer.root.findByProps({ role: "dialog" });
await TestRenderer.act(async () => {
  dialogNode.props.onKeyDown(keyboardEvent("ArrowDown"));
});
assert.equal(focusPalette.renderer.root.findAllByProps({ role: "option" })[1].props["aria-selected"], true);
await TestRenderer.act(async () => {
  dialogNode.props.onKeyDown(keyboardEvent("ArrowUp"));
});
assert.equal(focusPalette.renderer.root.findAllByProps({ role: "option" })[0].props["aria-selected"], true);

focusPalette.closeButton.focus();
const tabForward = keyboardEvent("Tab");
await TestRenderer.act(async () => {
  dialogNode.props.onKeyDown(tabForward);
});
assert.equal(tabForward.prevented, true);
assert.equal(fakeDocument.activeElement, focusPalette.searchInput);
const tabBackward = keyboardEvent("Tab", true);
await TestRenderer.act(async () => {
  dialogNode.props.onKeyDown(tabBackward);
});
assert.equal(tabBackward.prevented, true);
assert.equal(fakeDocument.activeElement, focusPalette.closeButton);

await TestRenderer.act(async () => {
  dialogNode.props.onKeyDown(keyboardEvent("ArrowDown"));
});
await TestRenderer.act(async () => {
  dialogNode.props.onKeyDown(keyboardEvent("Enter"));
});
assert.equal(firstRuns, 0);
assert.equal(secondRuns, 1);
assert.equal(commandCloseCalls, 1);
await TestRenderer.act(async () => {
  focusPalette.renderer.update(React.createElement(runtime.CommandPalette, {
    open: false,
    commands: behaviorCommands,
    onClose: () => { commandCloseCalls += 1; }
  }));
});
assert.equal(fakeDocument.activeElement, previousFocus);

let escapeCloseCalls = 0;
const escapePalette = await createFocusTestPalette(behaviorCommands, () => { escapeCloseCalls += 1; });
const escapeDialog = escapePalette.renderer.root.findByProps({ role: "dialog" });
await TestRenderer.act(async () => {
  escapeDialog.props.onKeyDown(keyboardEvent("Escape"));
});
assert.equal(escapeCloseCalls, 1);
await TestRenderer.act(async () => {
  escapePalette.renderer.update(React.createElement(runtime.CommandPalette, {
    open: false,
    commands: behaviorCommands,
    onClose: () => { escapeCloseCalls += 1; }
  }));
});
assert.equal(fakeDocument.activeElement, previousFocus);

if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
else delete globalThis.document;
if (originalHTMLElement) Object.defineProperty(globalThis, "HTMLElement", originalHTMLElement);
else delete globalThis.HTMLElement;
console.log("PASS director desk components");
} finally {
await rm(moduleDirectory, { recursive: true, force: true });
}
