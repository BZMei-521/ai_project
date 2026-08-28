import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../src/modules/comfy-pipeline/ComfyPipelinePanel.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/app/App.tsx", import.meta.url), "utf8");
const advancedTools = readFileSync(new URL("../src/features/advanced-tools/AdvancedToolsView.tsx", import.meta.url), "utf8");

assert.match(panel, /<option value="codex_task_package">Codex 生图（任务包）<\/option>/);
assert.match(panel, /prepareCodexStoryboardJob\(/);
assert.match(panel, /importCodexStoryboardResult\(/);
assert.match(panel, /导出 Codex 任务包/);
assert.match(panel, /检查并导入结果/);
assert.match(panel, /添加参考图/);
assert.match(panel, /使用说明/);
assert.match(panel, /moveCodexReference/);
assert.match(panel, /acceptGenerationTaskCandidate/);
assert.match(panel, /Codex.*不会自动发布/);
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

console.log("codex storyboard UI checks passed");
