import assert from "node:assert/strict";
import { build } from "esbuild";

const repoRoot = process.cwd();
const result = await build({
  stdin: {
    contents: 'export * from "./src/features/spatial-preview/previewReferenceRenderer.ts";',
    loader: "ts",
    resolveDir: repoRoot,
    sourcefile: "spatial-preview-runtime-check.ts"
  },
  absWorkingDir: repoRoot,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});
const bundle = result.outputFiles[0]?.text;
assert.ok(bundle, "spatial preview bundle should be available");
const runtime = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
assert.equal(typeof runtime.createPreviewReferenceSet, "function", "renderer export is required");

const scene = {
  id: "scene-1",
  name: "Runtime check",
  revision: 7,
  objects: [
    {
      id: "hero",
      objectKind: "character",
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      visibility: "visible"
    }
  ],
  camera: { yaw: 0, pitch: 0, fov: 50 },
  poseKeyframes: []
};
const camera = { yaw: 0, pitch: 0, fov: 50 };
const references = runtime.createPreviewReferenceSet(scene, camera);
assert.equal(references.sceneId, scene.id);
assert.equal(references.revision, scene.revision);
assert.deepEqual(references.channels.map((channel) => channel.kind), ["color", "depth", "normal", "mask", "pose", "json"]);
assert.equal(new Set(references.channels.map((channel) => channel.kind)).size, 6);
const jsonChannel = references.channels.find((channel) => channel.kind === "json");
assert.equal(jsonChannel?.mimeType, "application/json");
assert.ok(jsonChannel?.metadata && typeof jsonChannel.metadata === "object");
assert.doesNotThrow(() => JSON.stringify(jsonChannel?.metadata));
assert.deepEqual(references, runtime.createPreviewReferenceSet(scene, camera), "references should be deterministic");
console.log("PASS spatial preview runtime");
