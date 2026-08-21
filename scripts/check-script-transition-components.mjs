import React from "react";
import TestRenderer from "react-test-renderer";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const css = await readFile("src/styles/script-transition-editor.css", "utf8").catch(() => "");
const main = await readFile("src/main.tsx", "utf8");
const directorViewSource = await readFile("src/features/script-director/ScriptDirectorView.tsx", "utf8");
assert.match(directorViewSource, /onSelectionChange:\s*\(selection:\s*\{\s*shotId:\s*string \| null;\s*transitionId:\s*string \| null\s*\}\)\s*=>\s*void;/, "selection change must be a required authoritative prop");
assert.doesNotMatch(directorViewSource, /onSelect(?:Shot|Transition)\??:/, "view-level legacy selection callbacks must not remain public");
const chainOverflowRule = css.match(/\.director-desk \[data-stage-view="script"\] \.script-shot-chain-viewport\s*\{[^}]*\}/s)?.[0] ?? "";
assert.match(chainOverflowRule, /overflow-x:\s*auto/);
assert.match(chainOverflowRule, /overflow-y:\s*hidden/);
assert.equal([...css.matchAll(/overflow-x:\s*auto/g)].length, 1, "only the shot chain may own horizontal auto overflow");
assert.match(css, /\[data-shot-node\]\s*\{[^}]*width:\s*248px/s);
assert.match(css, /\[data-shot-node\]\[data-selected="true"\]/);
assert.match(css, /\[data-shot-node\]\[data-drop-side="left"\]/);
assert.match(css, /\[data-shot-node\]\[data-drop-side="right"\]/);
assert.match(css, /\[data-transition-edge\]\[data-selected="true"\]/);
assert.match(css, /\[data-transition-edge\]\s*\{[^}]*height:\s*2px/s, "directed edge line must be two pixels");
assert.match(css, /\[data-transition-edge\]::after\s*\{[^}]*border-top:\s*2px[^}]*border-right:\s*2px/s, "directed edge arrow must be two pixels");
assert.match(css, /\.director-desk\[data-stage="script"\] :is\(\.script-transition-inspector, \.script-shot-inspector\)/, "inspector rules must match the sibling shell drawer while script stage is active");
const inspectorSelectorLines = css.split(/\r?\n/).filter((line) => /(?:\.script-transition-inspector|\.script-shot-inspector)/.test(line));
assert.ok(inspectorSelectorLines.length > 0 && inspectorSelectorLines.every((line) => line.trim().startsWith('.director-desk[data-stage="script"]')), "inspector rules cannot depend on being a child of the stage view");
const importTriggerRule = css.match(/\.director-desk \[data-stage-view="script"\] \.script-import-trigger\s*\{[^}]*\}/s)?.[0] ?? "";
assert.match(importTriggerRule, /min-height:\s*44px/, "visible import control must be at least 44px high at 390px");
assert.match(importTriggerRule, /min-block-size:\s*44px/, "visible import control must preserve a logical 44px block target");
const moveTargetRule = css.match(/\.director-desk \[data-stage-view="script"\] \.script-shot-order-actions button\s*\{[^}]*\}/s)?.[0] ?? "";
for (const dimension of ["min-height", "min-block-size", "min-width", "min-inline-size"]) {
  assert.match(moveTargetRule, new RegExp(`${dimension}:\\s*44px`), `move controls must declare ${dimension}: 44px`);
}
assert.match(moveTargetRule, /flex:\s*0\s+0\s+44px/, "move controls must not flex-shrink below 44px");
assert.match(css, /@media\s*\(max-width:\s*767px\)[\s\S]*\.director-desk\[data-stage="script"\][^{]*(?:\.script-transition-inspector|\.script-shot-inspector)[\s\S]*safe-area-inset-bottom/);
assert.ok(main.indexOf("director-desk.css") < main.indexOf("script-transition-editor.css"), "transition CSS must load after Director Desk CSS");

const result = await build({
  stdin: {
    contents: `
      export * from "./src/features/script-director/ShotNode.tsx";
      export * from "./src/features/script-director/TransitionEdge.tsx";
      export * from "./src/features/script-director/ScriptDirectorView.tsx";
      export * from "./src/features/script-director/ScriptTransitionInspector.tsx";
    `,
    loader: "tsx",
    resolveDir: process.cwd(),
    sourcefile: "script-transition-components-check.tsx"
  },
  absWorkingDir: process.cwd(),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  jsx: "automatic",
  external: ["react", "react/*", "react-test-renderer"],
  write: false
});

const moduleDirectory = await mkdtemp(join(process.cwd(), ".script-transition-components-"));
const moduleFile = join(moduleDirectory, "runtime.mjs");
await writeFile(moduleFile, result.outputFiles[0].text, "utf8");

try {
  const runtime = await import(pathToFileURL(moduleFile).href);
  const shotA = {
    id: "a", sequenceId: "seq-1", order: 1, title: "A", durationFrames: 96,
    dialogue: "台词 A", notes: "备注 A", tags: ["角色甲"], generatedImagePath: "frames/a.png"
  };
  const shotB = {
    id: "b", sequenceId: "seq-1", order: 2, title: "B", durationFrames: 84,
    dialogue: "", notes: "", tags: []
  };
  const transitionAB = {
    id: "shot-transition:a:b", sequenceId: "seq-1", fromShotId: "a", toShotId: "b",
    type: "continuous", durationSeconds: 0.6, frameDependency: "previous_tail",
    actionContinuity: "", characterPosition: "", cameraDirection: "", notes: ""
  };
  const selectionChanges = [];
  const moves = [];
  const imports = [];
  const updates = [];
  const history = [];
  const view = TestRenderer.create(React.createElement(runtime.ScriptDirectorView, {
    shots: [shotA, shotB], transitions: [transitionAB], fps: 24, sequenceId: "seq-1",
    selectedShotId: "a", selectedTransitionId: transitionAB.id,
    onSelectionChange: (selection) => selectionChanges.push(selection),
    onMoveShot: (...args) => moves.push(args),
    onImportScript: (value) => imports.push(value),
    canUndo: true, canRedo: false,
    onUndo: () => history.push("undo"), onRedo: () => history.push("redo")
  }));

  const chain = view.root.findByProps({ "data-script-shot-chain": true });
  assert.equal(view.root.findByType("h1").parent.type, "div", "block heading content must not be wrapped in a span");
  assert.deepEqual(chain.children.map((child) => child.type === runtime.ShotNode ? "shot" : child.type === runtime.TransitionEdge ? "edge" : "unknown"), ["shot", "edge", "shot"]);
  assert.equal(view.root.findAllByProps({ "data-shot-node": true }).length, 2);
  assert.equal(view.root.findAllByProps({ "data-transition-edge": true }).length, 1);
  const edge = view.root.findByProps({ "data-transition-edge": true });
  assert.equal(view.root.findAllByProps({ "data-selected": true }).length, 1, "shot and transition selection must render mutually exclusively");
  assert.equal(view.root.findAllByProps({ "data-shot-node": true })[0].props["data-selected"], undefined, "transition selection wins if both ids are supplied");
  assert.equal(edge.props["data-selected"], true);
  assert.match(edge.findByType("button").children.join(""), /连续动作.*0\.6s/);
  assert.equal(edge.findByType("button").props.type, "button");
  assert.equal(view.root.findByProps({ type: "file" }).props.accept, "application/json,.json");
  assert.equal(view.root.findByProps({ "aria-label": "镜头 A 向前移动" }).props.disabled, true);
  assert.equal(view.root.findByProps({ "aria-label": "镜头 A 向后移动" }).props.disabled, false);
  assert.equal(view.root.findByProps({ "aria-label": "镜头 B 向前移动" }).props.disabled, false);
  assert.equal(view.root.findByProps({ "aria-label": "镜头 B 向后移动" }).props.disabled, true);
  view.root.findAllByProps({ className: "script-shot-select" })[0].props.onClick();
  assert.deepEqual(selectionChanges.at(-1), { shotId: "a", transitionId: null });
  edge.findByType("button").props.onClick();
  assert.deepEqual(selectionChanges.at(-1), { shotId: null, transitionId: transitionAB.id });

  let controlledSelection = { shotId: "a", transitionId: null };
  let controlledView;
  const renderControlledView = () => React.createElement(runtime.ScriptDirectorView, {
    shots: [shotA, shotB], transitions: [transitionAB], fps: 24, sequenceId: "seq-1",
    selectedShotId: controlledSelection.shotId, selectedTransitionId: controlledSelection.transitionId,
    onSelectionChange: (selection) => {
      controlledSelection = selection;
      controlledView.update(renderControlledView());
    },
    onMoveShot: () => undefined, onImportScript: () => undefined
  });
  controlledView = TestRenderer.create(renderControlledView());
  assert.equal(controlledView.root.findAllByProps({ "data-selected": true }).length, 1);
  assert.equal(controlledView.root.findAllByProps({ "data-shot-node": true })[0].props["data-selected"], true);
  await TestRenderer.act(async () => {
    controlledView.root.findByProps({ "data-transition-edge": true }).findByType("button").props.onClick();
  });
  assert.deepEqual(controlledSelection, { shotId: null, transitionId: transitionAB.id });
  assert.equal(controlledView.root.findAllByProps({ "data-selected": true }).length, 1);
  assert.equal(controlledView.root.findByProps({ "data-transition-edge": true }).props["data-selected"], true);
  await TestRenderer.act(async () => {
    controlledView.root.findAllByProps({ className: "script-shot-select" })[0].props.onClick();
  });
  assert.deepEqual(controlledSelection, { shotId: "a", transitionId: null });
  assert.equal(controlledView.root.findAllByProps({ "data-selected": true }).length, 1);
  assert.equal(controlledView.root.findAllByProps({ "data-shot-node": true })[0].props["data-selected"], true);
  view.root.findByProps({ "aria-label": "镜头 A 向后移动" }).props.onClick();
  view.root.findByProps({ "aria-label": "镜头 B 向前移动" }).props.onClick();
  assert.deepEqual(moves, [["a", 1], ["b", 0]]);

  const shotArticles = view.root.findAllByProps({ "data-shot-node": true });
  const dataTransfer = { values: new Map(), effectAllowed: "none", setData(type, value) { this.values.set(type, value); } };
  await TestRenderer.act(async () => {
    shotArticles[0].props.onDragStart({ dataTransfer });
  });
  let dragPrevented = false;
  await TestRenderer.act(async () => {
    shotArticles[1].props.onDragOver({ preventDefault: () => { dragPrevented = true; } });
  });
  assert.equal(dragPrevented, true);
  assert.equal(view.root.findAllByProps({ "data-shot-node": true })[1].props["data-drop-side"], "right");
  await TestRenderer.act(async () => {
    view.root.findAllByProps({ "data-shot-node": true })[1].props.onDrop({ preventDefault: () => undefined });
  });
  assert.deepEqual(moves.at(-1), ["a", 1], "drop must move the dragged shot to the exact target index");
  assert.equal(view.root.findAll((node) => node.props["data-drop-side"] !== undefined).length, 0);

  await TestRenderer.act(async () => {
    view.root.findAllByProps({ "data-shot-node": true })[1].props.onDragStart({ dataTransfer });
  });
  await TestRenderer.act(async () => {
    view.root.findAllByProps({ "data-shot-node": true })[0].props.onDragOver({ preventDefault: () => undefined });
  });
  assert.equal(view.root.findAllByProps({ "data-shot-node": true })[0].props["data-drop-side"], "left");
  await TestRenderer.act(async () => {
    view.root.findAllByProps({ "data-shot-node": true })[0].props.onDrop({ preventDefault: () => undefined });
  });
  assert.deepEqual(moves.at(-1), ["b", 0], "backward drop must preserve the exact target index");
  assert.equal(view.root.findAll((node) => node.props["data-drop-side"] !== undefined).length, 0);
  const undo = view.root.findByProps({ "aria-label": "撤销镜头排序" });
  const redo = view.root.findByProps({ "aria-label": "重做镜头排序" });
  assert.equal(undo.disabled ?? undo.props.disabled, false);
  assert.equal(redo.disabled ?? redo.props.disabled, true);
  undo.props.onClick();
  assert.deepEqual(history, ["undo"]);

  const invalidFileInput = view.root.findByProps({ type: "file" });
  await TestRenderer.act(async () => {
    await invalidFileInput.props.onChange({
      currentTarget: { files: [{ text: async () => "not json" }], value: "invalid.json" }
    });
  });
  assert.match(JSON.stringify(view.toJSON()), /文件不是合法 JSON/);
  assert.equal(imports.length, 0, "invalid imports must not update project state");

  await TestRenderer.act(async () => {
    await view.root.findByProps({ type: "file" }).props.onChange({
      currentTarget: { files: [{ text: async () => JSON.stringify({ shots: [{ id: "imported", title: "Imported", duration: 2 }] }) }], value: "valid.json" }
    });
  });
  assert.equal(imports.length, 1, "valid imports must invoke the import callback exactly once");
  assert.equal(imports[0].shots[0].id, "imported");
  assert.equal(view.root.findAllByProps({ role: "alert" }).length, 0, "a valid import clears earlier errors");

  let alertFocusCount = 0;
  const readFailureImports = [];
  const readFailureView = TestRenderer.create(React.createElement(runtime.ScriptDirectorView, {
    shots: [shotA], transitions: [], fps: 24, sequenceId: "seq-1",
    onSelectionChange: () => undefined,
    onImportScript: (value) => readFailureImports.push(value)
  }), { createNodeMock(element) { return element.props.role === "alert" ? { focus() { alertFocusCount += 1; } } : null; } });
  await TestRenderer.act(async () => {
    await readFailureView.root.findByProps({ type: "file" }).props.onChange({
      currentTarget: { files: [{ text: async () => { throw new Error("disk read failed"); } }], value: "broken.json" }
    });
  });
  assert.match(JSON.stringify(readFailureView.toJSON()), /无法读取镜头剧本/);
  assert.equal(readFailureImports.length, 0, "file read rejection must not mutate project state");
  assert.equal(alertFocusCount, 1, "new import error summaries must receive focus");
  assert.equal(readFailureView.root.findByProps({ role: "alert" }).findAllByType("a").length, 1, "issues should navigate back to the import control");

  const parserFailureImports = [];
  const parserFailureView = TestRenderer.create(React.createElement(runtime.ScriptDirectorView, {
    shots: [], transitions: [], fps: { valueOf() { throw new Error("unexpected parser failure"); } }, sequenceId: "seq-1",
    onSelectionChange: () => undefined,
    onImportScript: (value) => parserFailureImports.push(value)
  }));
  await TestRenderer.act(async () => {
    await parserFailureView.root.findByProps({ type: "file" }).props.onChange({
      currentTarget: { files: [{ text: async () => JSON.stringify({ shots: [] }) }], value: "unexpected.json" }
    });
  });
  assert.match(JSON.stringify(parserFailureView.toJSON()), /无法读取镜头剧本/);
  assert.equal(parserFailureImports.length, 0, "unexpected parser throws must not mutate project state");

  const emptyView = TestRenderer.create(React.createElement(runtime.ScriptDirectorView, {
    shots: [], transitions: [], fps: 24, sequenceId: "seq-1",
    selectedShotId: null, selectedTransitionId: null,
    onSelectionChange: () => undefined,
    onMoveShot: () => undefined, onImportScript: () => undefined
  }));
  assert.match(JSON.stringify(emptyView.toJSON()), /导入 JSON 镜头剧本/);
  assert.equal(emptyView.root.findByProps({ type: "file" }).props.accept, "application/json,.json");

  const inspector = TestRenderer.create(React.createElement(runtime.ScriptTransitionInspector, {
    fps: 24, selectedShot: null, selectedTransition: transitionAB,
    fromShot: shotA, toShot: shotB,
    onUpdateTransition: (id, patch) => updates.push([id, patch]),
    onRequestDeleteShot: () => assert.fail("transition selection must not expose deletion")
  }));
  assert.equal(inspector.root.findByProps({ "aria-label": "转场类型" }).props.value, "continuous");
  assert.equal(inspector.root.findByProps({ "aria-label": "转场时长（秒）" }).props.value, 0.6);
  assert.equal(inspector.root.findByProps({ "aria-label": "转场时长（秒）" }).props.disabled, false);
  assert.equal(inspector.root.findByProps({ "data-transition-advanced": true }).props.open, false);
  assert.match(JSON.stringify(inspector.toJSON()), /等待边界帧/);
  assert.equal(inspector.root.findAllByProps({ "aria-label": "共享匹配帧路径" }).length, 0);
  assert.equal(inspector.root.findAllByProps({ "aria-label": "删除镜头" }).length, 0);
  inspector.root.findByProps({ "aria-label": "转场类型" }).props.onChange({ target: { value: "hard_cut" } });
  assert.deepEqual(updates.at(-1), [transitionAB.id, { type: "hard_cut", durationSeconds: 0, frameDependency: "none" }]);

  const hardCutInspector = TestRenderer.create(React.createElement(runtime.ScriptTransitionInspector, {
    fps: 24, selectedShot: null,
    selectedTransition: { ...transitionAB, type: "hard_cut", durationSeconds: 0, frameDependency: "none" },
    fromShot: shotA, toShot: shotB, onUpdateTransition: () => undefined
  }));
  assert.equal(hardCutInspector.root.findByProps({ "aria-label": "转场时长（秒）" }).props.disabled, true);

  const sharedFrameInspector = TestRenderer.create(React.createElement(runtime.ScriptTransitionInspector, {
    fps: 24, selectedShot: null,
    selectedTransition: { ...transitionAB, type: "match_cut", frameDependency: "shared_frame" },
    fromShot: shotA, toShot: shotB, onUpdateTransition: () => undefined
  }));
  assert.equal(sharedFrameInspector.root.findByProps({ "aria-label": "共享匹配帧路径" }).type, "input");

  const deleted = [];
  const shotInspector = TestRenderer.create(React.createElement(runtime.ScriptTransitionInspector, {
    fps: 24, selectedShot: shotA, selectedTransition: null,
    fromShot: null, toShot: null, onUpdateTransition: () => undefined,
    onRequestDeleteShot: (id) => deleted.push(id)
  }));
  const deleteButton = shotInspector.root.findByProps({ "aria-label": "删除镜头" });
  assert.equal(deleteButton.props.type, "button");
  assert.equal(deleteButton.props["data-danger"], "true");
  deleteButton.props.onClick();
  assert.deepEqual(deleted, [shotA.id]);

  console.log("PASS script transition components");
} finally {
  await rm(moduleDirectory, { recursive: true, force: true });
}
