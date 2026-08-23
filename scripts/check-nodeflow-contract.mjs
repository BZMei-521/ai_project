import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const contractPath = path.join(repoRoot, "src/features/nodeflow/nodeflowContracts.ts");
const source = await readFile(contractPath, "utf8");
const canvasSource = await readFile(path.join(repoRoot, "src/features/nodeflow/DirectedNodeflowCanvas.tsx"), "utf8");
const workspaceSource = await readFile(path.join(repoRoot, "src/features/nodeflow/DirectedNodeflowWorkspace.tsx"), "utf8");
const appSource = await readFile(path.join(repoRoot, "src/app/App.tsx"), "utf8");

const { default: typescript } = await import("typescript");
const transpiled = typescript.transpileModule(source, {
  compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ES2020 }
}).outputText;
/* Keep the contract check aligned with the project's TypeScript parser. */
const stripped = source
  .replace(/export type [\s\S]*?;\n\n?/g, "")
  .replace(/\s+as const/g, "")
  .replace(/([(\[,]\s*[\w$]+)\s*:\s*[^,)]+/g, "$1")
  .replace(/\)\s*:\s*[^{]+(?=\s*\{)/g, ")");

const runtime = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);

assert.deepEqual(runtime.DIRECTOR_NODE_IDS, ["script", "assets", "preview", "storyboard", "production"]);
assert.deepEqual(runtime.DIRECTOR_NODE_EDGES, [
  { from: "script", to: "assets" },
  { from: "assets", to: "preview" },
  { from: "preview", to: "storyboard" },
  { from: "storyboard", to: "production" }
]);
assert.deepEqual(runtime.DIRECTOR_NODE_STATUSES, ["idle", "waiting", "running", "completed", "failed"]);

const roundTripped = JSON.parse(JSON.stringify({
  selectedNodeId: "preview",
  collapsedNodeIds: ["script", "storyboard"],
  panX: 18,
  panY: -24,
  zoom: 1.25
}));
assert.deepEqual(roundTripped, {
  selectedNodeId: "preview",
  collapsedNodeIds: ["script", "storyboard"],
  panX: 18,
  panY: -24,
  zoom: 1.25
});

assert.equal(runtime.getDirectorNodeStatus({ nodeId: "script" }), "idle");
assert.equal(runtime.getDirectorNodeStatus({ nodeId: "script", generationTasks: [{ status: "queued" }] }), "running");
assert.equal(runtime.getDirectorNodeStatus({ nodeId: "script", generationTasks: [{ status: "failed" }] }), "failed");
assert.equal(runtime.getDirectorNodeStatus({ nodeId: "assets", assets: [{ id: "asset-1", filePath: "asset.png" }] }), "completed");
assert.equal(runtime.getDirectorNodeStatus({ nodeId: "preview", spatialScenes: [{ id: "scene-1" }] }), "completed");
assert.equal(runtime.getDirectorNodeStatus({ nodeId: "storyboard", shots: [{ id: "shot-1" }] }), "waiting");
assert.equal(runtime.getDirectorNodeStatus({ nodeId: "production", shots: [{ id: "shot-1", generatedVideoPath: "output.mp4" }] }), "completed");
assert.match(canvasSource, /data-nodeflow-canvas/);
assert.match(canvasSource, /nodeflow-edges/);
assert.match(canvasSource, /NodeflowNodeCard/);
assert.match(workspaceSource, /NodeflowInspector/);
assert.match(appSource, /<DirectedNodeflowWorkspace/);
assert.match(appSource, /const \[nodeflowMode, setNodeflowMode\] = useState\(false\)/);
assert.match(appSource, /openNodeflow:\s*\(\) => setNodeflowMode\(true\)/);
assert.match(appSource, /data-nodeflow-app-root/);
assert.doesNotMatch(appSource.match(/if \(nodeflowMode\)[\s\S]*?\n  }\n\n  return \(/)?.[0] ?? "", /<WorkbenchShell/);

console.log("PASS nodeflow contract");
