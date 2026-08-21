import React from "react";
import TestRenderer from "react-test-renderer";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const css = await readFile("src/styles/script-transition-editor.css", "utf8").catch(() => "");
const main = await readFile("src/main.tsx", "utf8");
assert.match(css, /\.director-desk \[data-stage-view="script"\] \.script-shot-chain-viewport\s*\{[^}]*overflow-x:\s*auto/s);
assert.match(css, /\[data-shot-node\]\s*\{[^}]*width:\s*248px/s);
assert.match(css, /\[data-transition-edge\]\s*\{[^}]*height:\s*2px/s);
assert.match(css, /@media\s*\(min-width:\s*768px\)\s*and\s*\(max-width:\s*1099px\),\s*\(pointer:\s*coarse\)[\s\S]*min-height:\s*44px/);
assert.match(css, /@media\s*\(max-width:\s*767px\)[\s\S]*safe-area-inset-bottom/);
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
  const selectedShots = [];
  const selectedTransitions = [];
  const moves = [];
  const imports = [];
  const updates = [];
  const history = [];
  const view = TestRenderer.create(React.createElement(runtime.ScriptDirectorView, {
    shots: [shotA, shotB], transitions: [transitionAB], fps: 24, sequenceId: "seq-1",
    selectedShotId: "a", selectedTransitionId: null,
    onSelectShot: selectedShots.push.bind(selectedShots),
    onSelectTransition: selectedTransitions.push.bind(selectedTransitions),
    onMoveShot: (...args) => moves.push(args),
    onImportScript: (value) => imports.push(value),
    canUndo: true, canRedo: false,
    onUndo: () => history.push("undo"), onRedo: () => history.push("redo")
  }));

  const chain = view.root.findByProps({ "data-script-shot-chain": true });
  assert.deepEqual(chain.children.map((child) => child.type === runtime.ShotNode ? "shot" : child.type === runtime.TransitionEdge ? "edge" : "unknown"), ["shot", "edge", "shot"]);
  assert.equal(view.root.findAllByProps({ "data-shot-node": true }).length, 2);
  assert.equal(view.root.findAllByProps({ "data-transition-edge": true }).length, 1);
  const edge = view.root.findByProps({ "data-transition-edge": true });
  assert.match(edge.findByType("button").children.join(""), /连续动作.*0\.6s/);
  assert.equal(edge.findByType("button").props.type, "button");
  assert.equal(view.root.findByProps({ type: "file" }).props.accept, "application/json,.json");
  assert.equal(view.root.findByProps({ "aria-label": "镜头 A 向前移动" }).props.disabled, true);
  assert.equal(view.root.findByProps({ "aria-label": "镜头 A 向后移动" }).props.disabled, false);
  assert.equal(view.root.findByProps({ "aria-label": "镜头 B 向前移动" }).props.disabled, false);
  assert.equal(view.root.findByProps({ "aria-label": "镜头 B 向后移动" }).props.disabled, true);
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

  const emptyView = TestRenderer.create(React.createElement(runtime.ScriptDirectorView, {
    shots: [], transitions: [], fps: 24, sequenceId: "seq-1",
    selectedShotId: null, selectedTransitionId: null,
    onSelectShot: () => undefined, onSelectTransition: () => undefined,
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
