import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const repoRoot = process.cwd();
const source = await readFile("src/modules/spatial-stage/threeResourceTracker.ts", "utf8");
assert.match(source, /class ThreeResourceTracker/);
const result = await build({
  entryPoints: ["src/modules/spatial-stage/threeResourceTracker.ts"],
  absWorkingDir: repoRoot,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});
const bundle = result.outputFiles[0]?.text;
assert.ok(bundle, "resource tracker bundle should be available");
const { ThreeResourceTracker } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`
);

const tracker = new ThreeResourceTracker();
const resource = { disposeCalls: 0, dispose() { this.disposeCalls += 1; } };
tracker.track(resource);
tracker.dispose();
tracker.dispose();
assert.equal(resource.disposeCalls, 1);

const viewportSource = await readFile("src/modules/spatial-stage/SpatialStageViewport.tsx", "utf8");
assert.match(viewportSource, /GLTFLoader/);
assert.match(viewportSource, /OrbitControls/);
assert.match(viewportSource, /TransformControls/);
assert.match(viewportSource, /loadStageMesh/);
assert.match(viewportSource, /activeCameraId/);
assert.match(viewportSource, /setRotationFromQuaternion|quaternion\.set/);
assert.match(viewportSource, /onEntityTransformChange/);
assert.match(viewportSource, /onCameraChange/);
assert.match(viewportSource, /mouseUp/);
assert.match(viewportSource, /webglcontextlost/);
assert.match(viewportSource, /webglcontextrestored/);
assert.match(viewportSource, /4096/);
assert.match(viewportSource, /releaseGpuResources/);
assert.match(viewportSource, /depth_map/);
assert.match(viewportSource, /displacementMap/);
const workbenchSource = await readFile("src/modules/spatial-stage/SpatialStageWorkbench.tsx", "utf8");
assert.match(workbenchSource, /建立空间预演/);
assert.match(workbenchSource, /手工代理模式/);
assert.match(workbenchSource, /SpatialStageViewport/);
assert.match(workbenchSource, /updateSpatialStage/);
assert.match(workbenchSource, /onEntityTransformChange/);
assert.match(workbenchSource, /onCameraChange/);
assert.match(workbenchSource, /观察模式/);
assert.match(workbenchSource, /镜头模式/);
assert.match(workbenchSource, /value=\{activeSnapshot\?\.cameraId \?\? activeCameraId/);
assert.match(workbenchSource, /rig/);
assert.match(workbenchSource, /继承上一节拍/);
assert.match(workbenchSource, /未解析|冲突/);
assert.match(workbenchSource, /MoGe 几何预检/);
assert.match(workbenchSource, /buildMogePanoramaWorkflow/);
assert.match(workbenchSource, /排队生成几何/);
assert.match(workbenchSource, /ComfyUI 地址/);
assert.match(workbenchSource, /createComfyMogeTransport/);
assert.match(workbenchSource, /stageMogePanoramaAsset/);
assert.match(workbenchSource, /手工代理模式/);
const appSource = await readFile("src/app/App.tsx", "utf8");
assert.match(appSource, /case "preview": return <PreviewWorkspaceView/);
assert.match(appSource, /case "storyboard"/);
assert.match(appSource, /<StoryboardWorkspaceView/);
const previewWorkspaceSource = await readFile("src/features/spatial-preview/PreviewWorkspaceView.tsx", "utf8");
assert.match(previewWorkspaceSource, /data-stage-view="preview"/);
assert.match(previewWorkspaceSource, /空间预演/);
assert.match(previewWorkspaceSource, /SpatialStageWorkbench/);

console.log("spatial stage viewport checks passed");
