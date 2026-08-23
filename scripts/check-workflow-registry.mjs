import assert from "node:assert/strict";
import { BUILTIN_STORYBOARD_WORKFLOWS, inspectWorkflowDefinition, selectBestStoryboardWorkflow } from "../src/modules/comfy-pipeline/workflowRegistryRuntime.mjs";

const byId = (id) => BUILTIN_STORYBOARD_WORKFLOWS.find((definition) => definition.id === id);
const stageA = byId("storyboard-qwen-stageA");
const stageB = byId("storyboard-qwen-stageB");
const fallback = byId("storyboard-single-pass-fallback");
const qwenEnvironment = { tokens: ["PROMPT", "SHOT_TITLE", "SEED"], dependencies: ["Qwen"], nodes: ["TextEncodeQwenImageEditPlusCustom_lrzjason"] };

const valid = inspectWorkflowDefinition(stageA, qwenEnvironment);
assert.equal(valid.available, true);
const scalarToken = inspectWorkflowDefinition({ ...stageA, requiredTokens: [{ token: "PROMPT" }] }, { tokens: "PROMPT", dependencies: ["Qwen"], nodes: ["TextEncodeQwenImageEditPlusCustom_lrzjason"] });
assert.equal(scalarToken.available, true, "scalar strings must be treated as one inventory value");
const scalarDependency = inspectWorkflowDefinition({ ...stageA, requiredTokens: [] }, { dependencies: "Qwen", nodes: "TextEncodeQwenImageEditPlusCustom_lrzjason" });
assert.equal(scalarDependency.available, true, "scalar dependency and node inventories must be treated as one value each");
const missingToken = inspectWorkflowDefinition(stageA, { ...qwenEnvironment, tokens: ["PROMPT"] });
assert.equal(missingToken.errors.some((error) => error.code === "missing_token"), true);
const missingDependency = inspectWorkflowDefinition(stageA, { tokens: qwenEnvironment.tokens, dependencies: [], nodes: qwenEnvironment.nodes });
assert.equal(missingDependency.errors.some((error) => error.code === "missing_dependency"), true);
const unavailableNode = inspectWorkflowDefinition(stageA, { tokens: qwenEnvironment.tokens, dependencies: ["Qwen"], nodes: [] });
assert.equal(unavailableNode.errors.some((error) => error.code === "unavailable_node"), true);
const invalid = inspectWorkflowDefinition({ ...stageA, id: "", workflowJson: "" }, qwenEnvironment);
assert.equal(invalid.errors.some((error) => error.code === "invalid_definition"), true);

const fallbackReport = inspectWorkflowDefinition(fallback, { tokens: ["PROMPT", "NEGATIVE_PROMPT"], nodes: ["CheckpointLoaderSimple", "KSampler"] });
const stageBReport = inspectWorkflowDefinition(stageB, qwenEnvironment);
const selection = selectBestStoryboardWorkflow([missingToken, fallbackReport, valid, stageBReport]);
assert.equal(selection.selected?.definition.id, "storyboard-qwen-stageB");
assert.deepEqual(selection.rejected, [missingToken, fallbackReport, valid], "rejected diagnostics must preserve input order");
assert.equal(selection.rejected[0].errors[0]?.code, "missing_token", "rejected reports must retain their capability errors");

const sameStageLowerQuality = { ...stageA, id: "lower", quality: "single_pass" };
const sameStageHigherQuality = { ...stageA, id: "higher", quality: "mature_asset_guided" };
assert.equal(selectBestStoryboardWorkflow([inspectWorkflowDefinition(sameStageLowerQuality, qwenEnvironment), inspectWorkflowDefinition(sameStageHigherQuality, qwenEnvironment)]).selected?.definition.id, "higher");
const tieB = inspectWorkflowDefinition({ ...stageA, id: "b" }, qwenEnvironment);
const tieA = inspectWorkflowDefinition({ ...stageA, id: "a" }, qwenEnvironment);
assert.equal(selectBestStoryboardWorkflow([tieB, tieA]).selected?.definition.id, "a");

console.log("PASS workflow registry: shared runtime, validation, scalar values, ranking, and rejected diagnostics");
