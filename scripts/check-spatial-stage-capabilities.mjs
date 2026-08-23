import assert from "node:assert/strict";
import { build } from "esbuild";

const repoRoot = process.cwd();
const result = await build({
  entryPoints: ["src/modules/spatial-stage/capabilities.ts"],
  absWorkingDir: repoRoot,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});
const bundle = result.outputFiles[0]?.text;
assert.ok(bundle, "capability bundle should be available");
const { probeSpatialStageCapabilities } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`
);

const now = "2026-08-19T00:00:00.000Z";
const healthyStats = {
  system: { ram_total: 48 * 1024 ** 3, ram_free: 12 * 1024 ** 3 },
  devices: [{ type: "cuda", vram_total: 16 * 1024 ** 3, vram_free: 10 * 1024 ** 3 }]
};
const allNodes = {
  LoadMoGeModel: { input: { required: { model_name: ["COMBO", { options: ["moge_2_vitl_normal_fp16.safetensors"] }] } } },
  MoGePanoramaInference: {},
  MoGePointMapToMesh: {},
  MoGeRender: {},
  "Equirectangular to Perspective": {},
  OpenposePreprocessor: {}
};

const offline = await probeSpatialStageCapabilities({
  baseUrl: "http://127.0.0.1:8188",
  webgl2: true,
  fetchJson: async () => { throw new TypeError("offline"); },
  now: () => now,
  timeoutMs: 250
});
assert.equal(offline.comfyui.status, "temporarily_unavailable");
assert.equal(offline.overall, "manual_fallback");

const missingModel = await probeSpatialStageCapabilities({
  baseUrl: "http://127.0.0.1:8188",
  webgl2: true,
  fetchJson: async (url) => url.endsWith("/system_stats")
    ? healthyStats
    : { ...allNodes, LoadMoGeModel: { input: { required: { model_name: ["COMBO", { options: [] }] } } } },
  now: () => now
});
assert.equal(missingModel.mogeNode.status, "available");
assert.equal(missingModel.mogeModel.status, "missing_dependency");
assert.equal(missingModel.overall, "manual_fallback");

const available = await probeSpatialStageCapabilities({
  baseUrl: "http://127.0.0.1:8188",
  webgl2: true,
  fetchJson: async (url) => url.endsWith("/system_stats") ? healthyStats : allNodes,
  now: () => now
});
assert.equal(available.mogeModel.status, "available");
assert.equal(available.overall, "available");

const timedOut = await probeSpatialStageCapabilities({
  baseUrl: "http://127.0.0.1:8188",
  webgl2: true,
  fetchJson: (_url, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(healthyStats), 1000);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  }),
  now: () => now,
  timeoutMs: 250
});
assert.equal(timedOut.comfyui.status, "temporarily_unavailable");
assert.equal(timedOut.overall, "manual_fallback");

console.log("spatial stage capability checks passed");
