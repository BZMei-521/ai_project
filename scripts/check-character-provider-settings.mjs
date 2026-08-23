import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeSequentialProviderWorkflowMap,
  resolveSequentialProviderWorkflow
} from "../src/modules/comfy-pipeline/sequentialCharacterPassRuntime.mjs";

const normalizeNewlines = (source) => source.replace(/\r\n/g, "\n");
const service = normalizeNewlines(readFileSync(new URL("../src/modules/comfy-pipeline/comfyService.ts", import.meta.url), "utf8"));
const panel = normalizeNewlines(readFileSync(new URL("../src/modules/comfy-pipeline/ComfyPipelinePanel.tsx", import.meta.url), "utf8"));
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const between = (source, start, end, label) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `${label}: missing ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `${label}: missing ${end}`);
  return source.slice(startIndex, endIndex);
};

assert.match(service, /characterGenerationProvider/, "ComfySettings: missing characterGenerationProvider");

const mappedQwenWorkflow = JSON.stringify({
  1: { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_edit_2511_bf16.safetensors" } },
  2: { class_type: "TextEncodeQwenImageEdit", inputs: { model: ["1", 0] } },
  3: { class_type: "SaveImage", inputs: { images: ["2", 0] } }
});
assert.deepEqual(
  normalizeSequentialProviderWorkflowMap({
    selectedProviderId: "qwen_image_edit_2511",
    singularWorkflowJson: mappedQwenWorkflow,
    workflowJsonByProvider: { unknown_provider: "decoy", flux2_klein_4b: "" }
  }),
  {
    qwen_image_edit_2511: mappedQwenWorkflow,
    flux2_klein_4b: ""
  },
  "migration must retain exactly the two allowed provider keys and migrate the singular workflow"
);
assert.equal(
  resolveSequentialProviderWorkflow({
    providerId: "qwen_image_edit_2511",
    selectedProviderId: "qwen_image_edit_2511",
    selectedWorkflowJson: mappedQwenWorkflow,
    workflowJsonByProvider: {}
  }).reason,
  "missing_provider_workflow",
  "runtime resolution must never fall back to the compatibility singular field"
);

const settingsType = between(service, "export type ComfySettings = {", "export const DEFAULT_TOKEN_MAPPING", "ComfySettings type");
for (const [name, type] of [
  ["characterGenerationProvider", /CharacterGenerationProviderId/],
  ["characterGenerationWorkflowJson", /string/],
  ["characterGenerationWorkflowJsonByProvider", /Partial<Record<CharacterGenerationProviderId, string>>/],
  ["characterConsistencyEnabled", /boolean/],
  ["commercialUseRequired", /boolean/]
]) {
  assert.match(settingsType, new RegExp(`${name}\\??:\\s*${type.source}`), `ComfySettings: missing ${name}`);
}

const loadSettings = between(panel, "function loadSettings(): ComfySettings {", "function loadImportPresets", "loadSettings");
const defaultSettings = between(loadSettings, "if (!raw) {", "try {", "default settings");
const migration = between(loadSettings, "const parsed = JSON.parse(raw)", "} catch {", "settings migration");
const invalidStorageDefaults = between(loadSettings, "} catch {", "\n  }\n}", "invalid-storage defaults");
const expectedDefaults = [
  ["characterGenerationProvider", '"qwen_image_edit_2511"'],
  ["characterGenerationWorkflowJson", '""'],
  ["characterConsistencyEnabled", "true"],
  ["commercialUseRequired", "true"]
];
for (const [name, value] of expectedDefaults) {
  const assignment = new RegExp(`${name}:\\s*${value.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}`);
  assert.match(defaultSettings, assignment, `default settings: missing ${name}`);
  assert.match(migration, new RegExp(`${name}:`), `settings migration: missing ${name}`);
  assert.match(invalidStorageDefaults, assignment, `invalid-storage defaults: missing ${name}`);
}
assert.match(
  migration,
  /parsed\.characterGenerationProvider\s*===\s*"flux2_klein_4b"[\s\S]*?parsed\.characterGenerationProvider\s*===\s*"qwen_image_edit_2511"/,
  "settings migration must preserve an explicitly saved Klein provider"
);
for (const settingsBlock of [defaultSettings, migration, invalidStorageDefaults]) {
  assert.match(settingsBlock, /characterGenerationWorkflowJsonByProvider/, "settings must persist the provider-keyed workflow map");
}
assert.match(migration, /normalizeSequentialProviderWorkflowMap\(/, "legacy singular workflow migration must use the tested exact-key normalizer");
assert.match(migration, /singularWorkflowJson:[\s\S]*?parsed\.characterGenerationWorkflowJson/, "migration must retain the selected provider's legacy singular workflow");
assert.match(
  migration,
  /:\s*"qwen_image_edit_2511"/,
  "settings migration must fall back from unknown provider IDs to Qwen"
);

const preflight = between(
  service,
  "export async function inspectCharacterGenerationPreflight",
  "export async function inspectWorkflowDependencies",
  "character provider preflight"
);
assert.match(preflight, /inspectCharacterProvider\(/, "preflight must use the Task 3 provider registry");
assert.match(preflight, /Object\.values\(environment\.models\)[\s\S]*?\.flat\(\)/, "preflight must flatten ComfyEnvironmentReport.models");
assert.match(preflight, /Object\.keys\(objectInfo\)/, "preflight must use live object-info node names");
assert.match(preflight, /resolveSequentialProviderWorkflow\(\{[\s\S]*?workflowJsonByProvider:\s*settings\.characterGenerationWorkflowJsonByProvider/, "preflight must prove only the selected provider's mapped workflow");
assert.match(
  preflight,
  /environment\.online\s*&&\s*workflowConfigured\s*&&\s*inspection\.available/,
  "ready must require online Desktop, workflow JSON, and provider inspection"
);
for (const message of [
  "缺少角色生成模型",
  "缺少角色生成节点",
  "所选角色生成模型不支持商业使用",
  "ComfyUI Desktop 离线",
  "未配置角色生成工作流 JSON"
]) {
  assert.ok(preflight.includes(message), `preflight: missing distinct Chinese diagnostic: ${message}`);
}

const diagnosticSummary = between(
  panel,
  "const copyAssetDiagnosticSummary",
  "const copyStoryboardDiagnosticSummary",
  "character diagnostic summary"
);
for (const [name] of expectedDefaults) {
  assert.ok(diagnosticSummary.includes(name), `diagnostic summary: missing ${name}`);
}
assert.match(diagnosticSummary, /characterProviderPreflight\.diagnostics/, "diagnostic summary must include provider preflight diagnostics");

const providerEditor = between(panel, "characterGenerationProvider: provider", "characterConsistencyEnabled", "provider-keyed workflow editor");
assert.match(providerEditor, /characterGenerationWorkflowJsonByProvider:\s*workflows/, "provider switches must retain both workflow entries");
assert.match(providerEditor, /workflows\[provider\]\s*=\s*event\.target\.value/, "workflow edits must update only the selected provider key");
assert.match(providerEditor, /value=\{settings\.characterGenerationWorkflowJsonByProvider\?\.\[/, "the editor must display the selected provider's map entry");

assert.equal(
  packageJson.scripts?.["test:character-provider-settings"],
  "node scripts/check-character-provider-settings.mjs",
  "package.json must expose the focused settings guard"
);

console.log("PASS character provider settings and Desktop preflight guard");
