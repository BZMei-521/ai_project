import assert from "node:assert/strict";
import { build } from "esbuild";

const repoRoot = process.cwd();
const result = await build({
  stdin: {
    contents: 'export * from "./src/domains/spatial-scene/sceneMath.ts";',
    loader: "ts",
    resolveDir: repoRoot,
    sourcefile: "spatial-scene-domain-check.ts"
  },
  absWorkingDir: repoRoot,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});
const bundle = result.outputFiles[0]?.text;
assert.ok(bundle, "spatial scene domain bundle should be available");
const runtime = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const { normalizeCameraPlan, computeSceneBounds } = runtime;

const camera = normalizeCameraPlan({ yaw: 450, pitch: 100, fov: 2 });
assert.equal(camera.yaw, 90);
assert.equal(camera.pitch, 89);
assert.equal(camera.fov, 20);
assert.deepEqual(computeSceneBounds([
  { position: { x: -1, y: 0, z: 2 }, scale: { x: 1, y: 1, z: 1 } },
  { position: { x: 3, y: 2, z: -2 }, scale: { x: 2, y: 1, z: 1 } }
]), { min: { x: -2, y: 0, z: -3 }, max: { x: 4, y: 3, z: 3 } });

assert.throws(() => computeSceneBounds([
  { position: { x: Number.NaN, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
]), RangeError);
console.log("spatial scene domain checks passed");
