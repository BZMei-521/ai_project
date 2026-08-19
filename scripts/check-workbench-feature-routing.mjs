import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";

const focusedViews = [
  ["project", "src/features/project/ProjectWorkspaceView.tsx"],
  ["script", "src/features/script-director/ScriptDirectorView.tsx"],
  ["assets", "src/features/assets/AssetWorkspaceView.tsx"],
  ["preview", "src/features/spatial-preview/PreviewWorkspaceView.tsx"],
  ["storyboard", "src/features/storyboard/StoryboardWorkspaceView.tsx"],
  ["production", "src/features/production/ProductionWorkspaceView.tsx"]
];

for (const [, file] of focusedViews) await access(file);
await access("src/features/advanced-tools/AdvancedToolsView.tsx");
await access("src/services/generation-providers/providerContracts.ts");
await access("src/services/generation-providers/localComfyProvider.ts");

const routes = await readFile("src/app-shell/workbenchRoutes.ts", "utf8");
for (const [stage] of focusedViews) assert.match(routes, new RegExp(`\\| "${stage}"`));

const preview = await readFile("src/features/spatial-preview/PreviewWorkspaceView.tsx", "utf8");
assert.match(preview, /SpatialPreviewCanvas/);

const advanced = await readFile("src/features/advanced-tools/AdvancedToolsView.tsx", "utf8");
assert.match(advanced, /ComfyPipelinePanel/);
const lazyAux = await readFile("src/app/LazyAuxPanelContent.tsx", "utf8");
assert.doesNotMatch(lazyAux, /ComfyPipelinePanel|comfy-pipeline/);
const sourceFiles = await readdir("src", { recursive: true });
for (const file of sourceFiles.filter((item) => /\.(ts|tsx)$/.test(item))) {
  const path = `src/${file.replaceAll("\\", "/")}`;
  if (path === "src/features/advanced-tools/AdvancedToolsView.tsx" || path === "src/modules/comfy-pipeline/ComfyPipelinePanel.tsx") continue;
  const source = await readFile(path, "utf8");
  assert.doesNotMatch(source, /import[\s\S]{0,160}comfy-pipeline\/ComfyPipelinePanel/);
}
for (const [, file] of focusedViews) {
  const source = await readFile(file, "utf8");
  assert.doesNotMatch(source, /ComfyPipelinePanel/);
}

const contracts = await readFile("src/services/generation-providers/providerContracts.ts", "utf8");
for (const job of ["character", "panorama", "storyboard", "video", "audio", "quality", "export"]) {
  assert.match(contracts, new RegExp(`${job}:`));
}
assert.match(contracts, /export type GenerationProviderDelegates = GenerationProvider/);
const provider = await readFile("src/services/generation-providers/localComfyProvider.ts", "utf8");
assert.match(provider, /delegate unavailable/);
assert.doesNotMatch(provider, /status: ["']queued["']/);
const app = await readFile("src/app/App.tsx", "utf8");
for (const stage of ["project", "script", "assets", "preview", "storyboard", "production"]) {
  assert.match(app, new RegExp(`case ["']${stage}["']`));
}
assert.match(app, /ProjectWorkspaceView|ScriptDirectorView|AssetWorkspaceView|PreviewWorkspaceView|StoryboardWorkspaceView|ProductionWorkspaceView/);
assert.match(app, /case "storyboard"[\s\S]*<StoryboardWorkspaceView[\s\S]*storyboardLegacyWorkspace/);
assert.match(app, /\{focusedStageView\}/);

console.log("PASS workbench feature routing contract");
