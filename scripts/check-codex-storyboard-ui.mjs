import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../src/modules/comfy-pipeline/ComfyPipelinePanel.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/app/App.tsx", import.meta.url), "utf8");
const advancedTools = readFileSync(new URL("../src/features/advanced-tools/AdvancedToolsView.tsx", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../src/modules/platform/desktopBridge.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../src/modules/storyboard-core/types.ts", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/modules/storyboard-core/store.ts", import.meta.url), "utf8");

assert.match(panel, /<option value="codex_task_package">Codex 生图（任务包）<\/option>/);
assert.match(panel, /CodexTaskPackageProvider\(\{ exportStoryboardJob: prepareCodexStoryboardJob \}\)/);
assert.match(panel, /importCodexStoryboardResult\(/);
assert.match(panel, /导出 Codex 任务包/);
assert.match(panel, /检查并导入结果/);
assert.match(panel, /添加参考图/);
assert.match(panel, /使用说明/);
assert.match(panel, /moveCodexReference/);
assert.match(panel, /acceptGenerationTaskCandidate/);
assert.match(panel, /rejectGenerationTaskCandidate/);
assert.match(panel, /transitionCodexStoryboardLifecycle/);
assert.match(panel, /codex_storyboard_local_transition_stale/);
assert.match(types, /\| "rejected"/);
assert.match(store, /rejectGenerationTaskCandidate/);
assert.doesNotMatch(bridge, /taskStatus:/);
assert.match(bridge, /transition_codex_storyboard_lifecycle/);
assert.match(panel, /Codex.*不会自动发布/);
assert.match(panel, /const \[selectedCodexTaskId, setSelectedCodexTaskId\] = useState/);
assert.match(panel, /codexTasksForSelectedShot/);
assert.match(panel, /Codex 任务历史/);
assert.match(panel, /value=\{selectedCodexTaskId\}/);
assert.match(panel, /setSelectedCodexTaskId\(jobId\)/, "a new export becomes the explicit selected history task");
assert.match(panel, /const \[isCodexExporting, setIsCodexExporting\] = useState\(false\)/);
assert.match(panel, /const \[isCodexImporting, setIsCodexImporting\] = useState\(false\)/);
assert.match(panel, /if \(codexExportLockRef\.current\) return/);
assert.match(panel, /if \(codexImportLockRef\.current\) return/);
assert.match(panel, /selectedCodexTaskCanImport/);
assert.match(panel, /stage === "exported"[\s\S]{0,120}status === "queued"/);
assert.match(panel, /markGenerationTaskNeedsReview\([\s\S]{0,420}expectedReviewTransition/);
assert.match(panel, /codex_storyboard_requires_tauri_runtime/);
assert.match(panel, /codex_storyboard_project_path_missing/);
assert.match(app, /<AdvancedPipelinePanel[^>]*projectPath=\{activeWorkspacePath\}/);
assert.match(advancedTools, /projectPath: string/);
assert.match(advancedTools, /<LazyComfyPipelinePanel projectPath=\{projectPath\}/);

for (const mode of [
  "builtin_klein_reference",
  "mature_asset_guided",
  "builtin_zimage",
  "builtin_qwen",
  "codex_task_package"
]) {
  assert.match(panel, new RegExp(`(?:option value=|storyboardImageWorkflowMode === )['\"]${mode}['\"]`), `${mode} remains selectable or migratable`);
}

assert.match(panel, /parsed\.storyboardImageWorkflowMode === "codex_task_package"/, "settings migration retains Codex mode");
assert.match(panel, /requiredNodes: \[\][\s\S]{0,180}requiredModels: \[\][\s\S]{0,180}recommendedPlugins: \[\]/, "Codex mode has no Comfy dependencies");
assert.match(panel, /references:\s*codexReferences\.map\(\(reference\) => \(\{ \.\.\.reference \}\)\)/, "export preserves edited reference order");
assert.doesNotMatch(panel, /generatedImagePath[^\n]{0,160}spatial_authority|spatial_authority[^\n]{0,160}generatedImagePath/, "generated still is not inferred as spatial authority");

const codexBranch = panel.match(/\/\* CODEX_TASK_PACKAGE_BRANCH_START \*\/[\s\S]*?\/\* CODEX_TASK_PACKAGE_BRANCH_END \*\//)?.[0];
assert.ok(codexBranch, "Codex task-package branch is explicit and auditable");
assert.doesNotMatch(codexBranch, /inspectWorkflowDependencies\(|queuePrompt\(|imageWorkflowJson\s*:/, "Codex mode must not invoke or substitute a Comfy workflow");

const handlerBlock = (name, nextName) => {
  const start = panel.indexOf(`const ${name} = async`);
  const end = panel.indexOf(`const ${nextName} = async`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} handler block is extractable`);
  return panel.slice(start, end);
};
assert.match(handlerBlock("queueCurrentStoryboardShot", "queueStoryboardShots"), /if \(codexTaskPackageMode\) return/);
assert.match(handlerBlock("queueStoryboardShots", "storyboardGenerationPreflight"), /if \(codexTaskPackageMode\) return/);
assert.match(handlerBlock("storyboardGenerationPreflight", "retryFailedStoryboardShots"), /codex_storyboard_comfy_action_disabled/);
assert.match(handlerBlock("retryFailedStoryboardShots", "redrawSelectedCharacter"), /if \(codexTaskPackageMode\) return/);
assert.match(handlerBlock("onGenerateImages", "onGenerateVideos"), /if \(codexTaskPackageMode\) return false/);
assert.match(panel, /kind === "image" && codexTaskPackageMode[\s\S]{0,80}return false/, "single-image generation is hard guarded");
assert.match(panel, /const redrawSelectedCharacter = async \([\s\S]{0,220}if \(codexTaskPackageMode\) return/);
assert.match(panel, /const onGenerateAll = async \(\) => \{[\s\S]{0,220}if \(codexTaskPackageMode\) return/);
assert.match(handlerBlock("onInspectWorkflows", "onCheckModelHealth"), /if \(codexTaskPackageMode\) return/);
assert.match(panel, /disabled=\{codexTaskPackageMode \|\| phase === "running" \|\| scriptImportActive\}[\s\S]{0,180}onGenerateImages\(\)/);
assert.match(panel, /disabled=\{codexTaskPackageMode \|\| phase === "running" \|\| scopedShots\.length === 0\}[\s\S]{0,180}queueCurrentStoryboardShot/);
assert.match(panel, /disabled=\{codexTaskPackageMode \|\| phase === "running"\}[\s\S]{0,180}onGenerateSingle\("image"/);
assert.match(panel, /const disabled = codexTaskPackageMode \|\| phase === "running" \|\| redrawActive !== null/);
assert.match(panel, /disabled=\{codexTaskPackageMode \|\| phase === "running" \|\| runAllActive \|\| scriptImportActive\}[\s\S]{0,180}onGenerateAll\(\)/);

console.log("codex storyboard UI checks passed");
