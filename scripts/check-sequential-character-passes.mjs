import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUILTIN_STORYBOARD_WORKFLOWS } from "../src/modules/comfy-pipeline/workflowRegistryRuntime.mjs";
import {
  acquireSequentialControllerOwner,
  buildSequentialArtifactPath,
  createSequentialArtifactLedger,
  createSequentialRunId,
  executeSequentialArtifactWrite,
  executeSequentialTransaction,
  lockSequentialCharacterTokens,
  planExpandedCharacterRetryCrop,
  planSequentialArtifactCleanup,
  planSequentialArtifactRetainedPaths,
  proveCompiledCharacterLoraBinding,
  proveTerminalProviderWorkflow,
  releaseSequentialControllerOwner,
  resolveAppliedCharacterLora,
  resolveCharacterGenerationTrack,
  verifyFreshCharacterEvidenceReceipts,
  resolveSequentialProviderWorkflow,
  registerSequentialArtifact,
  validateSequentialProviderWorkflow,
  validateSequentialCharacterCount
} from "../src/modules/comfy-pipeline/sequentialCharacterPassRuntime.mjs";
import { recomputeStoredCharacterBenchmarkEvidenceDigest } from "../src/modules/asset-manager/characterIdentityUiRuntime.mjs";
import { selectCharacterProvider } from "../src/modules/comfy-pipeline/characterProviderRegistryRuntime.mjs";

const workflowProof = {
  workflowDigest: "b".repeat(64),
  terminalOutputNode: "3",
  authoritativeModelBindings: [{ model: "qwen_image_edit_2511_bf16.safetensors" }]
};
const benchmarkEvidence = {
  reportLabel: "hero-ready.json",
  benchmarkVersion: "benchmark-v1",
  fixtureDigest: "a".repeat(64),
  characterAssetId: "asset_hero",
  provider: "qwen_image_edit_2511",
  identityPackVersion: "identity-v3",
  loraName: "hero-v3.safetensors",
  loraVersion: "v3",
  modelName: "qwen_image_edit_2511_bf16.safetensors",
  loraStrength: 0.85,
  candidateStatus: "dataset_ready",
  workflowDigest: workflowProof.workflowDigest,
  terminalOutputNode: workflowProof.terminalOutputNode,
  terminalModel: "qwen_image_edit_2511_bf16.safetensors",
  terminalLoraName: "hero-v3.safetensors",
  terminalLoraStrengthModel: 0.85,
  terminalLoraStrengthClip: 0.85,
  terminalLoraClassType: "LoraLoader",
  terminalLoraClipPolicy: "equal_to_model",
  evaluatorHash: "c".repeat(64),
  evaluatorVersion: "evaluator-v1",
  acceptedShots: 8,
  verifiedAt: "2026-08-08T08:00:00.000Z",
  importedAt: "2026-08-08T08:00:00.000Z",
  evidenceDigest: ""
};
benchmarkEvidence.evidenceDigest = recomputeStoredCharacterBenchmarkEvidenceDigest(benchmarkEvidence);
const readyQwenLora = {
  provider: "qwen_image_edit_2511",
  modelName: "qwen_image_edit_2511_bf16.safetensors",
  loraName: "hero-v3.safetensors",
  strength: 0.85,
  version: "v3",
  status: "ready",
  benchmarkEvidence
};
const resolveReadyLora = (overrides = {}) => resolveAppliedCharacterLora({
  characterAssetId: "asset_hero",
  identityPackVersion: "identity-v3",
  lora: readyQwenLora,
  providerId: "qwen_image_edit_2511",
  workflowProof,
  currentLoraContext: {
    generationMode: "lora_augmented",
    characterAssetId: "asset_hero",
    identityPackVersion: "identity-v3",
    provider: "qwen_image_edit_2511",
    modelName: "qwen_image_edit_2511_bf16.safetensors",
    loraName: "hero-v3.safetensors",
    loraVersion: "v3",
    loraStrength: 0.85,
    candidateStatus: "dataset_ready",
    fixtureDigest: benchmarkEvidence.fixtureDigest,
    workflowProof
  },
  ...overrides
});
assert.equal(
  resolveReadyLora(),
  null,
  "legacy LoRA evidence without an authenticated receipt is audit-only"
);
assert.equal(
  resolveCharacterGenerationTrack({
    characterAssetId: "asset_hero",
    identityPackVersion: "identity-v3",
    lora: readyQwenLora,
    providerId: "qwen_image_edit_2511",
    workflowProof,
    currentLoraContext: {
      generationMode: "lora_augmented",
      characterAssetId: "asset_hero",
      identityPackVersion: "identity-v3",
      provider: "qwen_image_edit_2511",
      modelName: "qwen_image_edit_2511_bf16.safetensors",
      loraName: "hero-v3.safetensors",
      loraVersion: "v3",
      loraStrength: 0.85,
      candidateStatus: "dataset_ready",
      fixtureDigest: benchmarkEvidence.fixtureDigest,
      workflowProof
    }
  }),
  null,
  "the generic resolver rejects legacy unauthenticated LoRA evidence"
);
assert.equal(
  resolveAppliedCharacterLora({ characterAssetId: "asset_hero", identityPackVersion: "identity-v3", lora: readyQwenLora, providerId: "qwen_image_edit_2511", workflowProof }),
  null,
  "legacy stored LoRA evidence without a current fixture proof fails closed"
);
assert.equal(resolveReadyLora({ providerId: "flux2_klein_4b" }), null);
assert.equal(resolveReadyLora({ identityPackVersion: "identity-v4" }), null);
assert.equal(resolveReadyLora({ characterAssetId: "asset_other" }), null);
assert.equal(resolveReadyLora({ workflowProof: { ...workflowProof, workflowDigest: "d".repeat(64) } }), null);
assert.equal(resolveReadyLora({ lora: { ...readyQwenLora, benchmarkEvidence: undefined } }), null, "legacy ready without evidence must not apply");
assert.equal(resolveReadyLora({ lora: { ...readyQwenLora, benchmarkEvidence: { ...benchmarkEvidence, evidenceDigest: "0".repeat(64) } } }), null, "tampered stored evidence must not apply");
assert.equal(resolveReadyLora({ lora: { ...readyQwenLora, loraName: " " } }), null);
for (const invalidStrength of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.equal(
    resolveReadyLora({ lora: { ...readyQwenLora, strength: invalidStrength } }),
    null,
    `invalid LoRA strength ${String(invalidStrength)} must fail closed`
  );
}

let receiptRegistryPresent = true;
let receiptVerificationCalls = 0;
const evidenceForFreshVerification = { trustedReceipt: { receiptId: "a".repeat(64) } };
const verifyFromMutableRegistry = async () => {
  receiptVerificationCalls += 1;
  return receiptRegistryPresent
    ? { valid: true, receiptId: "a".repeat(64), claimsDigest: "b".repeat(64) }
    : { valid: false, reason: "trusted_receipt_registry_missing" };
};
assert.equal(
  (await verifyFreshCharacterEvidenceReceipts({ characterZeroShotEvidence: evidenceForFreshVerification }, verifyFromMutableRegistry)).trustedZeroReceiptVerification.valid,
  true,
  "the first queue may use a receipt that still exists"
);
receiptRegistryPresent = false;
assert.equal(
  (await verifyFreshCharacterEvidenceReceipts({ characterZeroShotEvidence: evidenceForFreshVerification }, verifyFromMutableRegistry)).trustedZeroReceiptVerification.valid,
  false,
  "deleting the registry record must reject the next queue instead of reusing cached valid"
);
assert.equal(receiptVerificationCalls, 2, "every queue gate must call the receipt backend again");

const service = readFileSync(new URL("../src/modules/comfy-pipeline/comfyService.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/modules/comfy-pipeline/ComfyPipelinePanel.tsx", import.meta.url), "utf8");
const registryTypes = readFileSync(new URL("../src/modules/comfy-pipeline/workflowRegistry.ts", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// The configured provider is a preference, not an eligibility override. This
// models a Qwen preference on a machine where only the commercial Klein path
// and its workflow prerequisites are available.
const unavailableConfiguredProviderFallback = selectCharacterProvider({
  commercialRequired: true,
  models: ["flux-2-klein-4b-fp8.safetensors"],
  nodes: ["ReferenceLatent", "CFGGuider", "Flux2Scheduler"]
});
assert.equal(
  unavailableConfiguredProviderFallback.selected?.id,
  "flux2_klein_4b",
  "an unavailable configured Qwen provider must fall back to the ready eligible commercial provider"
);
const noEligibleCommercialProvider = selectCharacterProvider({
  commercialRequired: true,
  models: [],
  nodes: []
});
assert.equal(noEligibleCommercialProvider.selected, undefined, "no eligible provider must remain unselected");
assert.match(
  service,
  /selectCharacterProvider\(providerEnvironment\)/,
  "sequential preflight must consume Task 3 provider selection instead of hard-selecting settings"
);
assert.match(
  service,
  /character_provider_unavailable:no_eligible_commercial_provider/,
  "no eligible provider must expose the exact fail-closed reason"
);

const between = (source, start, end, label) => {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `${label}: missing ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `${label}: missing ${end}`);
  return source.slice(startIndex, endIndex);
};
const stagedGeneration = between(
  service,
  "export async function generateStoryboardImageStaged",
  "export async function generateShotAsset(",
  "staged storyboard generation"
);
const generateShotAsset = between(
  service,
  "export async function generateShotAsset(",
  "export async function generateShotAssetOutputs(",
  "generateShotAsset"
);
assert.doesNotMatch(
  stagedGeneration,
  /settings\.characterGenerationProvider\s*===/,
  "sequential pass planning must not hard-select the configured provider before live eligibility selection"
);

const firstRunId = createSequentialRunId({ now: () => 1700000000000, randomToken: () => "alpha001" });
const secondRunId = createSequentialRunId({ now: () => 1700000000000, randomToken: () => "beta0002" });
assert.notEqual(firstRunId, secondRunId, "two invocations of the same shot need disjoint run ids");
const firstMaskPath = buildSequentialArtifactPath({
  inputDir: "C:/Comfy/input",
  shotId: "shot-1",
  runId: firstRunId,
  characterId: "hero",
  roleIndex: 0,
  kind: "immutable_mask"
});
const secondMaskPath = buildSequentialArtifactPath({
  inputDir: "C:/Comfy/input",
  shotId: "shot-1",
  runId: secondRunId,
  characterId: "hero",
  roleIndex: 0,
  kind: "immutable_mask"
});
assert.notEqual(firstMaskPath, secondMaskPath, "same-shot retries must never overwrite prior artifacts");
assert.ok(firstMaskPath.includes(firstRunId), "artifact paths must include their owning run id");

const retryCrop = planExpandedCharacterRetryCrop({
  bbox: { x: 100, y: 80, width: 200, height: 300 },
  canvasWidth: 640,
  canvasHeight: 480
});
assert.deepEqual(retryCrop.normal, { x: 52, y: 8, width: 296, height: 444 });
assert.deepEqual(retryCrop.expanded, { x: 24, y: 0, width: 352, height: 480 });
assert.equal(retryCrop.normalPaddingRatio, 0.24);
assert.equal(retryCrop.expandedPaddingRatio, 0.38);
assert.ok(retryCrop.expanded.width > retryCrop.normal.width, "expanded retry geometry must be materially wider");
assert.ok(retryCrop.expanded.height > retryCrop.normal.height, "expanded retry geometry must be materially taller");

const firstLedger = createSequentialArtifactLedger(firstRunId);
registerSequentialArtifact(firstLedger, { path: firstMaskPath, retention: "persisted" });
registerSequentialArtifact(firstLedger, { path: `${firstRunId}_raw.png`, retention: "disposable" });
registerSequentialArtifact(firstLedger, { path: "C:/canonical/user-input.png", retention: "disposable", runOwned: false });
assert.deepEqual(
  planSequentialArtifactCleanup(firstLedger, "success"),
  [`${firstRunId}_raw.png`],
  "success cleanup must delete disposable run-owned files only"
);
assert.deepEqual(
  planSequentialArtifactRetainedPaths(firstLedger),
  [firstMaskPath],
  "success cleanup must explicitly exclude persisted files from prefix-family deletion"
);
const secondLedger = createSequentialArtifactLedger(secondRunId);
registerSequentialArtifact(secondLedger, { path: secondMaskPath, retention: "persisted" });
registerSequentialArtifact(secondLedger, { path: `${secondRunId}_raw.png`, retention: "disposable" });
assert.deepEqual(
  new Set(planSequentialArtifactCleanup(secondLedger, "failure")),
  new Set([secondMaskPath, `${secondRunId}_raw.png`]),
  "failed retries must clean only their own run ledger"
);
assert.ok(
  !planSequentialArtifactCleanup(secondLedger, "failure").includes(firstMaskPath),
  "a failed second run must preserve first-run persisted paths"
);
const partialWriteLedger = createSequentialArtifactLedger("run_partial_failure");
const partialWriteOrder = [];
await assert.rejects(
  async () => {
    await executeSequentialArtifactWrite(
      partialWriteLedger,
      { path: "C:/Comfy/input/run_partial_failure_first.png", retention: "disposable" },
      async (targetPath) => { partialWriteOrder.push(`created:${targetPath}`); return targetPath; }
    );
    await executeSequentialArtifactWrite(
      partialWriteLedger,
      { path: "C:/Comfy/input/run_partial_failure_second", retention: "disposable" },
      async (targetPath) => { partialWriteOrder.push(`partial:${targetPath}`); throw new Error("second_write_failed"); }
    );
  },
  /second_write_failed/,
  "a partial multi-write failure must preserve the original writer error"
);
assert.deepEqual(
  planSequentialArtifactCleanup(partialWriteLedger, "failure"),
  ["C:/Comfy/input/run_partial_failure_first.png", "C:/Comfy/input/run_partial_failure_second"],
  "write-through registration must clean the first artifact and the failing second family prefix"
);

const qwenWorkflow = JSON.stringify({
  1: { class_type: "UNETLoader", inputs: { unet_name: "models/qwen_image_edit_2511_bf16.safetensors" } },
  2: { class_type: "TextEncodeQwenImageEdit", inputs: { model: ["1", 0] } },
  3: { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: "qwen" } }
});
const qwenTerminalProof = validateSequentialProviderWorkflow("qwen_image_edit_2511", qwenWorkflow);
assert.equal(qwenTerminalProof.ok, true, "Qwen 2511 needs a terminal-bound canonical node and model");
assert.equal(qwenTerminalProof.terminalOutputNode, "3");
assert.deepEqual(qwenTerminalProof.ancestorNodeIds, ["1", "2", "3"]);
const tokenBoundLoraTemplate = {
  1: { class_type: "UNETLoader", inputs: { unet_name: "models/qwen_image_edit_2511_bf16.safetensors" } },
  4: {
    class_type: "LoraLoader",
    inputs: {
      model: ["1", 0],
      lora_name: "{{ACTIVE_LORA_NAME}}",
      strength_model: "{{ACTIVE_LORA_STRENGTH}}",
      strength_clip: "{{ACTIVE_LORA_STRENGTH}}"
    }
  },
  2: { class_type: "TextEncodeQwenImageEdit", inputs: { model: ["4", 0] } },
  3: { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: "qwen" } }
};
const compiledVerifiedLora = structuredClone(tokenBoundLoraTemplate);
compiledVerifiedLora[4].inputs.lora_name = "hero-v3.safetensors";
compiledVerifiedLora[4].inputs.strength_model = 0.85;
compiledVerifiedLora[4].inputs.strength_clip = 0.85;
assert.deepEqual(
  proveCompiledCharacterLoraBinding({
    providerId: "qwen_image_edit_2511",
    workflowTemplate: tokenBoundLoraTemplate,
    compiledWorkflow: compiledVerifiedLora,
    appliedLora: { loraName: "hero-v3.safetensors", strength: 0.85, version: "v3" }
  }).appliedLora,
  { loraName: "hero-v3.safetensors", strength: 0.85, version: "v3" },
  "applied LoRA metadata is derived only after an exact terminal MODEL-path binding proof"
);
for (const [label, mutate] of [
  ["name", (workflow) => { workflow[4].inputs.lora_name = "attacker.safetensors"; }],
  ["strength", (workflow) => { workflow[4].inputs.strength_model = 1.4; workflow[4].inputs.strength_clip = 1.4; }]
]) {
  const tampered = structuredClone(compiledVerifiedLora);
  mutate(tampered);
  assert.equal(
    proveCompiledCharacterLoraBinding({
      providerId: "qwen_image_edit_2511",
      workflowTemplate: tokenBoundLoraTemplate,
      compiledWorkflow: tampered,
      appliedLora: { loraName: "hero-v3.safetensors", strength: 0.85, version: "v3" }
    }).ok,
    false,
    `compiled ${label} tampering fails before queue`
  );
}
const compiledWithoutLora = structuredClone(compiledVerifiedLora);
compiledWithoutLora[4].inputs.lora_name = "";
compiledWithoutLora[4].inputs.strength_model = 0;
compiledWithoutLora[4].inputs.strength_clip = 0;
assert.deepEqual(
  proveCompiledCharacterLoraBinding({
    providerId: "qwen_image_edit_2511",
    workflowTemplate: tokenBoundLoraTemplate,
    compiledWorkflow: compiledWithoutLora,
    appliedLora: null
  }),
  {
    ok: true,
    reason: "ok",
    providerProof: proveTerminalProviderWorkflow("qwen_image_edit_2511", compiledWithoutLora),
    appliedLora: null
  },
  "an unverified profile compiles token-bound LoRA fields to an inert binding"
);
const insertedUnverifiedLora = structuredClone(compiledWithoutLora);
insertedUnverifiedLora[4].inputs.lora_name = "hero-v3.safetensors";
insertedUnverifiedLora[4].inputs.strength_model = 0.85;
insertedUnverifiedLora[4].inputs.strength_clip = 0.85;
assert.equal(
  proveCompiledCharacterLoraBinding({
    providerId: "qwen_image_edit_2511",
    workflowTemplate: tokenBoundLoraTemplate,
    compiledWorkflow: insertedUnverifiedLora,
    appliedLora: null
  }).ok,
  false,
  "mutator insertion cannot activate an unverified LoRA"
);
const hardcodedOnlyTemplate = structuredClone(tokenBoundLoraTemplate);
hardcodedOnlyTemplate[4].inputs.lora_name = "hero-v3.safetensors";
hardcodedOnlyTemplate[4].inputs.strength_model = 0.85;
hardcodedOnlyTemplate[4].inputs.strength_clip = 0.85;
assert.equal(
  proveCompiledCharacterLoraBinding({
    providerId: "qwen_image_edit_2511",
    workflowTemplate: hardcodedOnlyTemplate,
    compiledWorkflow: hardcodedOnlyTemplate,
    appliedLora: null
  }).appliedLora,
  null,
  "a hardcoded matching loader is never claimed as character LoRA metadata"
);
assert.equal(
  proveCompiledCharacterLoraBinding({
    providerId: "flux2_klein_4b",
    workflowTemplate: tokenBoundLoraTemplate,
    compiledWorkflow: compiledVerifiedLora,
    appliedLora: { loraName: "hero-v3.safetensors", strength: 0.85 }
  }).ok,
  false,
  "provider switching invalidates the terminal proof instead of reusing Qwen evidence"
);
const approvedLockedTokens = lockSequentialCharacterTokens({
  tokens: {
    PROVIDER: "flux2_klein_4b",
    ACTIVE_CHARACTER_ID: "attacker",
    ACTIVE_CHARACTER_NAME: "Attacker",
    ACTIVE_CHARACTER_TRIGGER: "attacker_trigger",
    ACTIVE_LORA_NAME: "attacker.safetensors",
    ACTIVE_LORA_STRENGTH: "1.5",
    PROMPT: "allowed mutation"
  },
  providerId: "qwen_image_edit_2511",
  protectedIdentityTokens: {
    ACTIVE_CHARACTER_ID: "asset_hero",
    ACTIVE_CHARACTER_NAME: "Hero",
    ACTIVE_CHARACTER_TRIGGER: "char_hero"
  },
  appliedLora: { loraName: "hero-v3.safetensors", strength: 0.85, version: "v3" }
});
assert.deepEqual(
  {
    PROVIDER: approvedLockedTokens.PROVIDER,
    ACTIVE_CHARACTER_ID: approvedLockedTokens.ACTIVE_CHARACTER_ID,
    ACTIVE_CHARACTER_NAME: approvedLockedTokens.ACTIVE_CHARACTER_NAME,
    ACTIVE_CHARACTER_TRIGGER: approvedLockedTokens.ACTIVE_CHARACTER_TRIGGER,
    ACTIVE_LORA_NAME: approvedLockedTokens.ACTIVE_LORA_NAME,
    ACTIVE_LORA_STRENGTH: approvedLockedTokens.ACTIVE_LORA_STRENGTH,
    PROMPT: approvedLockedTokens.PROMPT
  },
  {
    PROVIDER: "qwen_image_edit_2511",
    ACTIVE_CHARACTER_ID: "asset_hero",
    ACTIVE_CHARACTER_NAME: "Hero",
    ACTIVE_CHARACTER_TRIGGER: "char_hero",
    ACTIVE_LORA_NAME: "hero-v3.safetensors",
    ACTIVE_LORA_STRENGTH: "0.85",
    PROMPT: "allowed mutation"
  },
  "post-mutation lock overwrites provider, identity, and LoRA fields while preserving allowed mutations"
);
const compileExactTokens = (value, tokens) => {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{([A-Z][A-Z0-9_]*)\}\}$/);
    if (!exact) return value;
    const resolved = tokens[exact[1]];
    return exact[1].endsWith("_STRENGTH") ? Number(resolved) : resolved;
  }
  if (Array.isArray(value)) return value.map((item) => compileExactTokens(item, tokens));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compileExactTokens(item, tokens)]));
  return value;
};
const approvedBuiltGraph = compileExactTokens(tokenBoundLoraTemplate, approvedLockedTokens);
assert.equal(approvedBuiltGraph[4].inputs.lora_name, "hero-v3.safetensors");
assert.equal(approvedBuiltGraph[4].inputs.strength_model, 0.85);
assert.equal(
  proveCompiledCharacterLoraBinding({
    providerId: "qwen_image_edit_2511",
    workflowTemplate: tokenBoundLoraTemplate,
    compiledWorkflow: approvedBuiltGraph,
    appliedLora: { loraName: "hero-v3.safetensors", strength: 0.85, version: "v3" }
  }).ok,
  true,
  "mutator tampering is overwritten before graph compilation so the approved graph still proves"
);
const emptyLockedTokens = lockSequentialCharacterTokens({
  tokens: { ACTIVE_LORA_NAME: "inserted.safetensors", ACTIVE_LORA_STRENGTH: "1.2" },
  providerId: "qwen_image_edit_2511",
  protectedIdentityTokens: {},
  appliedLora: null
});
const emptyBuiltGraph = compileExactTokens(tokenBoundLoraTemplate, emptyLockedTokens);
assert.equal(emptyBuiltGraph[4].inputs.lora_name, "");
assert.equal(emptyBuiltGraph[4].inputs.strength_model, 0);
assert.equal(proveCompiledCharacterLoraBinding({ providerId: "qwen_image_edit_2511", workflowTemplate: tokenBoundLoraTemplate, compiledWorkflow: emptyBuiltGraph, appliedLora: null }).ok, true, "unverified insertion compiles to an inert LoRA binding");
const thirdPartyInjectedGraph = structuredClone(emptyBuiltGraph);
thirdPartyInjectedGraph[9] = { class_type: "ThirdPartyLoRAInjector", inputs: { model: ["1", 0], lora_name: "evil.safetensors", strength_model: 1 } };
thirdPartyInjectedGraph[2].inputs.model = ["9", 0];
assert.equal(
  proveCompiledCharacterLoraBinding({ providerId: "qwen_image_edit_2511", workflowTemplate: tokenBoundLoraTemplate, compiledWorkflow: thirdPartyInjectedGraph, appliedLora: null }).ok,
  false,
  "zero-shot MODEL paths fail closed on an unknown third-party LoRA producer"
);
const staticLoraInjectedGraph = structuredClone(emptyBuiltGraph);
staticLoraInjectedGraph[9] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "evil.safetensors", strength_model: 1 } };
staticLoraInjectedGraph[2].inputs.model = ["9", 0];
assert.equal(
  proveCompiledCharacterLoraBinding({ providerId: "qwen_image_edit_2511", workflowTemplate: tokenBoundLoraTemplate, compiledWorkflow: staticLoraInjectedGraph, appliedLora: null }).ok,
  false,
  "zero-shot rejects an active supported static LoRA on a terminal MODEL path even when it is not token-bound"
);

const samplerBindingGraph = (samplerModel) => ({
  1: { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_edit_2511_bf16.safetensors" } },
  4: { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "hero-v3.safetensors", strength_model: 0.85 } },
  5: { class_type: "ModelSamplingFlux", inputs: { model: ["4", 0] } },
  2: { class_type: "TextEncodeQwenImageEdit", inputs: { model: ["1", 0] } },
  6: { class_type: "KSampler", inputs: { model: samplerModel, positive: ["2", 0] } },
  3: { class_type: "SaveImage", inputs: { images: ["6", 0] } }
});
for (const [label, samplerModel] of [["direct", ["4", 0]], ["patched", ["5", 0]]]) {
  const compiled = samplerBindingGraph(samplerModel);
  const template = structuredClone(compiled);
  template[4].inputs.lora_name = "{{ACTIVE_LORA_NAME}}";
  template[4].inputs.strength_model = "{{ACTIVE_LORA_STRENGTH}}";
  assert.equal(
    proveCompiledCharacterLoraBinding({ providerId: "qwen_image_edit_2511", workflowTemplate: template, compiledWorkflow: compiled, appliedLora: { loraName: "hero-v3.safetensors", strength: 0.85 } }).ok,
    true,
    `${label} terminal sampler MODEL chains prove the applied LoRA`
  );
}
const generatorSideOnly = samplerBindingGraph(["1", 0]);
generatorSideOnly[2].inputs.model = ["4", 0];
const generatorSideOnlyTemplate = structuredClone(generatorSideOnly);
generatorSideOnlyTemplate[4].inputs.lora_name = "{{ACTIVE_LORA_NAME}}";
generatorSideOnlyTemplate[4].inputs.strength_model = "{{ACTIVE_LORA_STRENGTH}}";
assert.equal(
  proveCompiledCharacterLoraBinding({ providerId: "qwen_image_edit_2511", workflowTemplate: generatorSideOnlyTemplate, compiledWorkflow: generatorSideOnly, appliedLora: { loraName: "hero-v3.safetensors", strength: 0.85 } }).ok,
  false,
  "a LoRA on only the generator side chain cannot prove a terminal sampler application"
);
const kleinWorkflow = JSON.stringify({
  1: { class_type: "UNETLoader", inputs: { unet_name: "flux-2-klein-4b-fp8.safetensors" } },
  2: { class_type: "ReferenceLatent", inputs: { conditioning: "reference", latent: "reference" } },
  3: { class_type: "CFGGuider", inputs: { model: ["1", 0], positive: ["2", 0], negative: ["2", 0] } },
  4: { class_type: "Flux2Scheduler", inputs: { steps: 4 } },
  5: { class_type: "SamplerCustom", inputs: { guider: ["3", 0], sigmas: ["4", 0], latent_image: ["2", 0] } },
  6: { class_type: "SaveImage", inputs: { images: ["5", 0], filename_prefix: "klein" } }
});
assert.equal(validateSequentialProviderWorkflow("flux2_klein_4b", kleinWorkflow).ok, true, "Klein 4B canonical workflow must pass");
const wrongKleinLoaderClass = JSON.parse(kleinWorkflow);
wrongKleinLoaderClass[1] = { class_type: "DiffusionModelLoader", inputs: { model_name: "flux-2-klein-4b-fp8.safetensors" } };
assert.equal(
  validateSequentialProviderWorkflow("flux2_klein_4b", wrongKleinLoaderClass).reason,
  "missing_ancestry_model_binding:UNETLoader:unet_name:flux-2-klein-4b-fp8.safetensors",
  "Klein requires its exact UNETLoader/unet_name binding, not merely a matching basename on another loader"
);
const kleinLoraTemplate = {
  1: { class_type: "UNETLoader", inputs: { unet_name: "flux-2-klein-4b-fp8.safetensors" } },
  2: { class_type: "ReferenceLatent", inputs: { conditioning: "reference", latent: "reference" } },
  3: { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "{{ACTIVE_LORA_NAME}}", strength_model: "{{ACTIVE_LORA_STRENGTH}}" } },
  4: { class_type: "CFGGuider", inputs: { model: ["3", 0], positive: ["2", 0], negative: ["2", 0] } },
  5: { class_type: "Flux2Scheduler", inputs: { steps: 4 } },
  6: { class_type: "SamplerCustomAdvanced", inputs: { guider: ["4", 0], sigmas: ["5", 0], latent_image: ["2", 0] } },
  7: { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "klein-lora" } }
};
const compiledKleinLora = compileExactTokens(kleinLoraTemplate, { ACTIVE_LORA_NAME: "hero-v3.safetensors", ACTIVE_LORA_STRENGTH: "0.85" });
assert.equal(
  proveCompiledCharacterLoraBinding({ providerId: "flux2_klein_4b", workflowTemplate: kleinLoraTemplate, compiledWorkflow: compiledKleinLora, appliedLora: { loraName: "hero-v3.safetensors", strength: 0.85 } }).ok,
  true,
  "official Klein CFGGuider MODEL path proves its approved model-only LoRA even when SamplerCustomAdvanced has no model input"
);
const assertKleinLoraRejected = (workflow, label) => assert.equal(
  proveCompiledCharacterLoraBinding({ providerId: "flux2_klein_4b", workflowTemplate: kleinLoraTemplate, compiledWorkflow: workflow, appliedLora: { loraName: "hero-v3.safetensors", strength: 0.85 } }).ok,
  false,
  label
);
const kleinLoraSidePath = structuredClone(compiledKleinLora);
kleinLoraSidePath[4].inputs.model = ["1", 0];
kleinLoraSidePath[8] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "hero-v3.safetensors", strength_model: 0.85 } };
kleinLoraSidePath[4].inputs.side = ["8", 0];
assertKleinLoraRejected(kleinLoraSidePath, "a Klein LoRA on a side input cannot prove the CFGGuider MODEL path");
const kleinLoraDisconnected = structuredClone(compiledKleinLora);
kleinLoraDisconnected[4].inputs.model = ["1", 0];
kleinLoraDisconnected[8] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "hero-v3.safetensors", strength_model: 0.85 } };
assertKleinLoraRejected(kleinLoraDisconnected, "a disconnected Klein LoRA cannot prove the CFGGuider MODEL path");
const kleinLoraConflict = structuredClone(compiledKleinLora);
kleinLoraConflict[8] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["3", 0], lora_name: "conflict.safetensors", strength_model: 0.85 } };
kleinLoraConflict[4].inputs.model = ["8", 0];
assertKleinLoraRejected(kleinLoraConflict, "a conflicting Klein LoRA on the CFGGuider MODEL path must fail closed");
const kleinLoraWrongOutput = structuredClone(compiledKleinLora);
kleinLoraWrongOutput[4].inputs.model = ["3", 1];
assertKleinLoraRejected(kleinLoraWrongOutput, "a non-MODEL Klein LoRA output cannot prove the CFGGuider MODEL path");
const kleinBlendTemplate = structuredClone(kleinLoraTemplate);
kleinBlendTemplate[4].inputs.model = ["1", 0];
kleinBlendTemplate[8] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "{{ACTIVE_LORA_NAME}}", strength_model: "{{ACTIVE_LORA_STRENGTH}}" } };
kleinBlendTemplate[9] = { class_type: "KSampler", inputs: { model: ["8", 0], positive: ["2", 0] } };
kleinBlendTemplate[10] = { class_type: "ImageBlend", inputs: { image1: ["6", 0], image2: ["9", 0] } };
kleinBlendTemplate[7].inputs.images = ["10", 0];
const compiledKleinBlend = compileExactTokens(kleinBlendTemplate, { ACTIVE_LORA_NAME: "hero-v3.safetensors", ACTIVE_LORA_STRENGTH: "0.85" });
assert.equal(
  proveCompiledCharacterLoraBinding({ providerId: "flux2_klein_4b", workflowTemplate: kleinBlendTemplate, compiledWorkflow: compiledKleinBlend, appliedLora: { loraName: "hero-v3.safetensors", strength: 0.85 } }).ok,
  false,
  "a selected ImageBlend terminal with a base-model CFGGuider path and an approved-LoRA KSampler side path must fail as an incomplete multi-path LoRA proof"
);
const legacyFluxGuidanceDecoy = JSON.stringify({
  1: { class_type: "UNETLoader", inputs: { unet_name: "flux-2-klein-4b-fp8.safetensors" } },
  2: { class_type: "ReferenceLatent", inputs: { model: ["1", 0] } },
  3: { class_type: "FluxGuidance", inputs: { model: ["2", 0] } },
  4: { class_type: "SaveImage", inputs: { images: ["3", 0], filename_prefix: "legacy-klein" } }
});
assert.equal(
  validateSequentialProviderWorkflow("flux2_klein_4b", legacyFluxGuidanceDecoy).reason,
  "missing_ancestry_node:CFGGuider",
  "legacy FluxGuidance alone must not prove the official distilled Klein workflow"
);
const disconnectedDecoy = {
  1: { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_edit_2511_bf16.safetensors" } },
  2: { class_type: "TextEncodeQwenImageEdit", inputs: { model: ["1", 0] } },
  8: { class_type: "SomeImageNode", inputs: {} },
  9: { class_type: "SaveImage", inputs: { images: ["8", 0] } }
};
assert.match(
  proveTerminalProviderWorkflow("qwen_image_edit_2511", disconnectedDecoy, "9").reason,
  /^missing_ancestry_node:/,
  "disconnected provider decoys cannot prove the selected terminal"
);
const unrelatedAuthoritativeLoader = {
  1: { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_edit_2511_bf16.safetensors" } },
  2: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
  3: { class_type: "TextEncodeQwenImageEdit", inputs: { model: ["1", 0], decoy: { nested: ["2", 0] } } },
  4: { class_type: "SaveImage", inputs: { images: ["3", 0] } }
};
assert.match(
  proveTerminalProviderWorkflow("qwen_image_edit_2511", unrelatedAuthoritativeLoader, "4").reason,
  /^conflicting_ancestry_model:/,
  "any other authoritative loader in terminal ancestry must fail closed"
);
const multipleTerminals = JSON.stringify({
  ...JSON.parse(qwenWorkflow),
  4: { class_type: "SaveImage", inputs: { images: ["2", 0] } }
});
assert.equal(validateSequentialProviderWorkflow("qwen_image_edit_2511", multipleTerminals).reason, "terminal_ambiguous");
assert.equal(validateSequentialProviderWorkflow("qwen_image_edit_2511", multipleTerminals, "3").ok, true, "an explicit valid terminal disambiguates multiple outputs");
assert.equal(proveTerminalProviderWorkflow("qwen_image_edit_2511", { ...disconnectedDecoy, 8: { class_type: "SomeImageNode", inputs: { loop: ["9", 0] } } }, "9").reason, "link_cycle");
assert.equal(proveTerminalProviderWorkflow("qwen_image_edit_2511", { 9: { class_type: "SaveImage", inputs: { images: ["404", 0] } } }, "9").reason, "missing_link");
assert.deepEqual(validateSequentialCharacterCount(2), { ok: true, count: 2 });
assert.deepEqual(validateSequentialCharacterCount(3), { ok: false, count: 3, reason: "unsupported_character_count:3" });
assert.deepEqual(
  resolveSequentialProviderWorkflow({
    providerId: "flux2_klein_4b",
    selectedProviderId: "qwen_image_edit_2511",
    selectedWorkflowJson: qwenWorkflow
  }),
  { ok: false, providerId: "flux2_klein_4b", reason: "missing_provider_workflow" },
  "the selected provider's singular workflow must not be reused for a fallback"
);
assert.match(
  resolveSequentialProviderWorkflow({
    providerId: "flux2_klein_4b",
    selectedProviderId: "qwen_image_edit_2511",
    selectedWorkflowJson: qwenWorkflow,
    workflowJsonByProvider: { flux2_klein_4b: qwenWorkflow }
  }).reason,
  /^missing_ancestry_node:/,
  "a mismatched provider map entry must fail parsed workflow proof"
);
const mappedKleinResolution = resolveSequentialProviderWorkflow({
    providerId: "flux2_klein_4b",
    selectedProviderId: "qwen_image_edit_2511",
    selectedWorkflowJson: qwenWorkflow,
    workflowJsonByProvider: { qwen_image_edit_2511: qwenWorkflow, flux2_klein_4b: kleinWorkflow }
  });
assert.equal(mappedKleinResolution.ok, true);
assert.equal(mappedKleinResolution.workflowJson, kleinWorkflow);
assert.equal(mappedKleinResolution.proof.terminalOutputNode, "6");
const misleadingQwen = JSON.stringify({
  1: { class_type: "Note", inputs: { text: "TextEncodeQwenImageEdit qwen_image_edit_2511_bf16.safetensors" } },
  2: { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_edit_2509_bf16.safetensors" } },
  3: { class_type: "SaveImage", inputs: { images: ["2", 0] } }
});
assert.equal(
  validateSequentialProviderWorkflow("qwen_image_edit_2511", misleadingQwen).reason,
  "missing_ancestry_node:TextEncodeQwenImageEdit",
  "comments and misleading strings must not prove provider compatibility"
);
assert.equal(
  validateSequentialProviderWorkflow("qwen_image_edit_2511", "{not-json").reason,
  "malformed_json",
  "malformed workflow JSON needs a deterministic reason"
);
assert.equal(
  validateSequentialProviderWorkflow("qwen_image_edit_2511", JSON.stringify({
    1: { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_edit_2509_bf16.safetensors" } },
    2: { class_type: "TextEncodeQwenImageEdit", inputs: { model: ["1", 0] } },
    3: { class_type: "SaveImage", inputs: { images: ["2", 0] } }
  })).reason,
  "missing_ancestry_model:qwen_image_edit_2511_bf16.safetensors",
  "other Qwen variants must be rejected even when the encoder node matches"
);
const conflictingQwenWithFakeMetadata = JSON.stringify({
  1: { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_edit_2509_bf16.safetensors" } },
  2: { class_type: "MetadataLoader", inputs: { model_name: "qwen_image_edit_2511_bf16.safetensors" } },
  3: { class_type: "TextEncodeQwenImageEdit", inputs: { model: ["1", 0], metadata: ["2", 0] } },
  4: { class_type: "SaveImage", inputs: { images: ["3", 0] } }
});
assert.equal(
  validateSequentialProviderWorkflow("qwen_image_edit_2511", conflictingQwenWithFakeMetadata).reason,
  "missing_ancestry_model:qwen_image_edit_2511_bf16.safetensors",
  "non-authoritative metadata loaders must not override a real conflicting Qwen UNET binding"
);
assert.equal(
  validateSequentialProviderWorkflow("qwen_image_edit_2511", JSON.stringify({
    1: { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_edit_2511_bf16.safetensors" } },
    2: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "qwen_image_edit_2509_bf16.safetensors" } },
    3: { class_type: "TextEncodeQwenImageEdit", inputs: { model: ["1", 0], conflict: ["2", 0] } },
    4: { class_type: "SaveImage", inputs: { images: ["3", 0] } }
  })).reason,
  "conflicting_ancestry_model:qwen_image_edit_2509_bf16.safetensors",
  "conflicting authoritative Qwen model bindings must be rejected"
);
assert.equal(
  validateSequentialProviderWorkflow("qwen_image_edit_2511", JSON.stringify({ nodes: [{}] })).reason,
  "workflow_root_invalid",
  "malformed graph nodes must be rejected before provider proof"
);
assert.equal(
  validateSequentialProviderWorkflow("qwen_image_edit_2511", JSON.stringify({ metadata: { model_name: "qwen_image_edit_2511_bf16.safetensors" } })).reason,
  "workflow_root_invalid",
  "arbitrary root objects must not be treated as API prompt nodes"
);

const aborted = new AbortController();
aborted.abort();
let queueCount = 0;
let commitCount = 0;
let cleanupCount = 0;
await assert.rejects(
  executeSequentialTransaction({
    signal: aborted.signal,
    generate: async () => { queueCount += 1; return "generated"; },
    publish: async (value) => value,
    commit: () => { commitCount += 1; },
    interrupt: async () => undefined,
    cleanup: async () => { cleanupCount += 1; }
  }),
  (error) => error?.name === "AbortError",
  "abort-before-queue must reject with AbortError"
);
assert.equal(queueCount, 0, "abort-before-queue must prevent enqueue");
assert.equal(commitCount, 0, "aborted transactions must never commit state");
assert.equal(cleanupCount, 1, "aborted transactions still run failure cleanup");

const abortAfterQueue = new AbortController();
const abortOrder = [];
let abortAfterQueueCommitCount = 0;
await assert.rejects(
  executeSequentialTransaction({
    signal: abortAfterQueue.signal,
    generate: async ({ recordPromptId }) => {
      recordPromptId("prompt-1");
      abortAfterQueue.abort();
      return "generated";
    },
    publish: async (value) => value,
    commit: () => { abortAfterQueueCommitCount += 1; },
    interrupt: async (promptIds) => { abortOrder.push(`interrupt:${promptIds.join(",")}`); },
    cleanup: async (outcome) => { abortOrder.push(`cleanup:${outcome}`); }
  }),
  (error) => error?.name === "AbortError"
);
assert.equal(abortAfterQueueCommitCount, 0, "abort-after-queue must still prevent commit");
assert.deepEqual(abortOrder, ["interrupt:prompt-1", "cleanup:failure"], "queued prompts must be interrupted before cleanup");

const successOrder = [];
const successResult = await executeSequentialTransaction({
  generate: async () => { successOrder.push("generate"); return "accepted"; },
  publish: async (value) => { successOrder.push("publish"); return `${value}:published`; },
  commit: () => { successOrder.push("commit"); },
  interrupt: async () => { successOrder.push("interrupt"); },
  cleanup: async (outcome) => { successOrder.push(`cleanup:${outcome}`); }
});
assert.equal(successResult, "accepted:published");
assert.deepEqual(successOrder, ["generate", "publish", "commit", "cleanup:success"], "success cleanup must follow atomic publication and commit");

const controllerOwnerRef = { current: null };
const firstController = { signal: { aborted: false }, abort() { this.signal.aborted = true; } };
const secondController = { signal: { aborted: false }, abort() { this.signal.aborted = true; } };
const firstOwnership = acquireSequentialControllerOwner(controllerOwnerRef, () => firstController);
assert.deepEqual(firstOwnership, { acquired: true, controller: firstController }, "the first synchronous action must acquire controller ownership");
const overlappingOwnership = acquireSequentialControllerOwner(controllerOwnerRef, () => secondController);
assert.deepEqual(overlappingOwnership, { acquired: false, controller: firstController }, "an overlapping action must not overwrite the active controller");
firstController.abort();
assert.equal(controllerOwnerRef.current, firstController, "stop must abort without releasing controller ownership");
assert.equal(releaseSequentialControllerOwner(controllerOwnerRef, secondController), false, "a non-owner must not clear the active controller");
assert.equal(controllerOwnerRef.current, firstController, "failed release must preserve the active owner");
assert.equal(releaseSequentialControllerOwner(controllerOwnerRef, firstController), true, "only the owning run may release its controller");
assert.equal(controllerOwnerRef.current, null, "the owning finally must clear the controller after unwind");

assert.match(
  service,
  /from\s+["']\.\/sequentialCharacterPassRuntime["']/,
  "service must wire the tested sequential runtime facade"
);
assert.match(stagedGeneration, /createSequentialRunId\(/, "each staged invocation must allocate a run id");
assert.match(stagedGeneration, /createSequentialArtifactLedger\(/, "each staged invocation must own an artifact ledger");
assert.match(stagedGeneration, /buildSequentialArtifactPath\(/, "run-owned filenames must use the tested path builder");
assert.match(stagedGeneration, /stageStoryboardCharacterMaskTokens\([\s\S]{0,420}?runId,\s*\(path\)\s*=>\s*registerArtifact/, "every run-scoped generated mask must enter the artifact ledger");
assert.match(stagedGeneration, /executeSequentialTransaction\(/, "publication and commit must use the tested transaction primitive");
assert.match(stagedGeneration, /planSequentialArtifactCleanup\(/, "success and failure cleanup must be ledger-derived");
assert.match(stagedGeneration, /resolveSequentialProviderWorkflow\(/, "provider workflow proof must use the parsed provider resolver");
const countValidationIndex = stagedGeneration.indexOf("validateSequentialCharacterCount(characterCount)");
const firstPreflightIndex = stagedGeneration.indexOf("inspectCharacterGenerationPreflight(");
const firstStateMutationIndex = stagedGeneration.indexOf("storyboardGenerationStore.setState");
assert.ok(countValidationIndex >= 0, "enabled consistency generation must validate the supported character count");
assert.ok(firstPreflightIndex > countValidationIndex, "unsupported character counts must fail before provider preflight");
assert.ok(firstStateMutationIndex === -1 || firstStateMutationIndex > countValidationIndex, "unsupported character counts must fail before any store mutation");
assert.match(service, /export\s+type\s+StoryboardGenerationRequest\s*=\s*\{[\s\S]*?signal\?:\s*AbortSignal/, "queued storyboard requests must carry cancellation");
assert.match(
  service,
  /generateStoryboardImageStaged\([\s\S]*?signal:\s*current\.signal/,
  "the default queue runner must pass request cancellation into staged generation"
);
assert.match(generateShotAsset, /onPromptQueued\?:\s*\(promptId:\s*string\)/, "queued prompt ids must be observable by the transaction");
assert.match(generateShotAsset, /sequentialCharacterPass\?:\s*\{[\s\S]*?runId:\s*string/, "locked generation must carry the owning run id");
assert.match(generateShotAsset, /sequentialCharacterPass\?:\s*\{[\s\S]*?appliedLora:\s*AppliedCharacterLora\s*\|\s*null/, "locked generation must carry only the evidence-resolved LoRA candidate");
assert.match(generateShotAsset, /sequentialCharacterPass\?:\s*\{[\s\S]*?protectedIdentityTokens:\s*Record<string,\s*string>/, "locked generation must carry immutable provider and identity tokens");
assert.match(
  generateShotAsset,
  /tokens\s*=\s*lockSequentialCharacterTokens\(\{[\s\S]*?providerId:\s*options\.sequentialCharacterPass\.providerId[\s\S]*?protectedIdentityTokens:\s*options\.sequentialCharacterPass\.protectedIdentityTokens[\s\S]*?appliedLora:\s*options\.sequentialCharacterPass\.appliedLora/,
  "post-mutation token lock must restore provider/identity evidence and verified-or-empty LoRA values"
);
assert.match(
  generateShotAsset,
  /tokens\s*=\s*lockSequentialCharacterTokens\([\s\S]*?\);\s*\}\s*applyDynamicCharacterRefsForImageWorkflow\(rewrittenWorkflow,\s*stagedCharacterImages\);\s*const built\s*=\s*coerceWorkflowLiteralValues\(deepReplaceTokens\(rewrittenWorkflow,\s*tokens\)\)/,
  "the protected token lock must be the final token operation immediately before workflow compilation"
);
assert.match(
  generateShotAsset,
  /sequentialOutputPrefix\s*=\s*`sequential_\$\{sanitizePathSegment\(options\.sequentialCharacterPass\.runId\)[\s\S]*?filename_prefix\s*=\s*sequentialOutputPrefix/,
  "raw Comfy outputs must receive a run-scoped filename prefix"
);
assert.match(
  generateShotAsset,
  /options\?\.signal\?\.throwIfAborted\(\);[\s\S]{0,240}queueComfyPrompt\(/,
  "the signal must be checked immediately before queuePrompt"
);
assert.match(panel, /useRef<AbortController\s*\|\s*null>/, "the UI generation boundary must own one AbortController");
assert.match(panel, /runtimeSettings:\s*ComfySettings\s*=\s*settings,\s*signal\?:\s*AbortSignal[\s\S]*?commonGenerationOptions\s*=\s*\{[\s\S]*?signal,/, "the UI must pass its run signal into generation options");
assert.match(panel, /\.abort\(\)/, "the running generation control must abort the active controller");
assert.match(panel, />\s*停止分镜生成\s*</, "the current generation section must expose the narrow stop action");
assert.match(panel, /signal\?\.throwIfAborted\(\);\s*if\s*\(kind\s*===\s*"image"\)/, "an aborted UI run must not store the generated shot path");
const imageGenerationAction = between(panel, "const onGenerateImages", "const onGenerateVideos", "image generation action");
assert.ok(
  imageGenerationAction.indexOf("acquireSequentialControllerOwner(") >= 0 &&
    imageGenerationAction.indexOf("acquireSequentialControllerOwner(") < imageGenerationAction.indexOf("await "),
  "controller ownership must be acquired synchronously before the first await"
);
assert.match(
  imageGenerationAction,
  /finally\s*\{\s*if\s*\(releaseSequentialControllerOwner\(storyboardGenerationAbortControllerRef,\s*generationController\)\)/,
  "only the identity-checked owning finally may release the controller"
);
const stopGenerationAction = between(panel, "const onStopStoryboardGeneration", "const upsertProvisionPreview", "stop generation action");
assert.doesNotMatch(stopGenerationAction, /storyboardGenerationAbortControllerRef\.current\s*=\s*null/, "stop must not clear controller ownership before unwind");
assert.match(stagedGeneration, /kind:\s*"canonical_reference"[\s\S]*?trackTransientPath\(targetPath\)[\s\S]*?stageSourceFileToComfyInput/, "snapshot references must enter the ledger before copying");
assert.match(service, /onArtifactCreated\?\.\(filePath\);\s*const result\s*=\s*await invokeDesktopCommand[^]*?"write_base64_file"/, "mask targets must enter the ledger before writing");
const rawOutputTargetIndex = generateShotAsset.indexOf("options.sequentialCharacterPass.onArtifactTarget(");
const promptQueueIndex = generateShotAsset.indexOf("queueComfyPrompt(", rawOutputTargetIndex);
assert.ok(rawOutputTargetIndex >= 0 && promptQueueIndex > rawOutputTargetIndex, "raw Comfy output families must enter the ledger before queueing");
const compiledProofIndex = generateShotAsset.indexOf("proveCompiledCharacterLoraBinding(");
assert.ok(compiledProofIndex >= 0 && compiledProofIndex < promptQueueIndex, "compiled provider and LoRA proof must pass immediately before any queue mutation");
assert.match(generateShotAsset, /terminalOutputNode:\s*compiledProviderProof\?\.terminalOutputNode/, "history polling must select only the proven terminal output node");
assert.match(generateShotAsset, /providerProof:\s*compiledProviderProof/, "generation output must carry the exact compiled workflow proof");
assert.match(generateShotAsset, /proveCompiledCharacterLoraBinding\([\s\S]*?workflowTemplate:\s*rewrittenWorkflow[\s\S]*?compiledWorkflow:\s*built[\s\S]*?appliedLora:\s*compiledTrack\?\.appliedLora\s*\?\?\s*options\.sequentialCharacterPass\.appliedLora/, "compiled terminal MODEL-path LoRA proof must run on the exact queued graph and verified track");
const compiledLoraProofIndex = generateShotAsset.indexOf("proveCompiledCharacterLoraBinding(");
const queueAfterLoraProofIndex = generateShotAsset.indexOf("queueComfyPrompt(", compiledLoraProofIndex);
assert.ok(compiledLoraProofIndex >= 0 && queueAfterLoraProofIndex > compiledLoraProofIndex, "LoRA binding mismatch must be detected before queue");
assert.match(generateShotAsset, /appliedLora:\s*compiledAppliedLora/, "generation output must derive applied LoRA metadata from compiled proof");

const activeTokens = [
  "ACTIVE_CHARACTER_ID",
  "ACTIVE_CHARACTER_NAME",
  "ACTIVE_CHARACTER_TRIGGER",
  "ACTIVE_FACE_REF_PATH",
  "ACTIVE_BODY_REF_PATH",
  "ACTIVE_HAIR_REF_PATH",
  "ACTIVE_LORA_NAME",
  "ACTIVE_LORA_STRENGTH",
  "PROTECT_PREVIOUS_CHARACTERS"
];

assert.match(service, /import\s*\{[^}]*buildCharacterPassPlan[^}]*\}\s*from\s*["']\.\/characterConsistency["']/, "generation must import buildCharacterPassPlan");
assert.match(service, /inspectCharacterGenerationPreflight/, "generation must consume the live provider preflight API");
assert.match(stagedGeneration, /const\s+characterPasses\s*=\s*buildCharacterPassPlan\(/, "consistency branch must build characterPasses");
assert.match(stagedGeneration, /resolvePreviousCharacterContinuityPaths\(\{[\s\S]*?currentShotIndex:\s*index[\s\S]*?allShots/, "continuity lookup must use prior storyboard shot order");
assert.match(stagedGeneration, /continuityPathsByCharacterId/, "character-scoped continuity must be passed to the planner");
assert.match(stagedGeneration, /for\s*\(const\s+plannedPass\s+of\s+characterPasses\)/, "character passes must run sequentially in input order");
assert.match(stagedGeneration, /pass\.references\.slice\(0,\s*3\)/, "each pass must bind at most three active-character references");
assert.match(stagedGeneration, /let\s+acceptedFramePath\s*=\s*cleanScenePath/, "sequential generation must begin from the accepted clean scene");
assert.match(stagedGeneration, /validateAndAcceptCharacterPass\([\s\S]*?acceptedFramePath\s*=/, "a pass must validate before replacing the accepted frame");
assert.match(stagedGeneration, /protectedMaskPaths/, "later passes must carry every earlier accepted mask");
assert.match(stagedGeneration, /PROTECT_PREVIOUS_CHARACTERS:\s*pass\.protectPreviousCharacters\s*\?\s*"1"\s*:\s*"0"/, "later passes must set protection explicitly");
assert.ok(stagedGeneration.includes("character_consistency_skip=missing_identity_pack"), "missing packs must log the exact legacy skip reason");

for (const token of activeTokens) {
  assert.ok(stagedGeneration.includes(token), `sequential generation is missing ${token}`);
  assert.ok(registryTypes.includes(`${token}:`), `typed registry diagnostics are missing ${token}`);
  for (const workflow of BUILTIN_STORYBOARD_WORKFLOWS.filter((item) => item.id.includes("qwen"))) {
    const optional = (workflow.optionalTokens ?? []).find((spec) => spec.token === token);
    assert.ok(optional, `${workflow.id} is missing optional token ${token}`);
    assert.ok(String(optional.description ?? "").trim(), `${workflow.id} token ${token} needs an accurate diagnostic description`);
  }
}

const consistencyBranch = between(
  stagedGeneration,
  "if (shouldRunSequentialCharacterPasses)",
  "character_consistency_skip=missing_identity_pack",
  "character consistency branch"
);
assert.match(consistencyBranch, /return\s+executeSequentialTransaction\(/, "consistency branch must return the atomic sequential transaction");
assert.doesNotMatch(consistencyBranch, /stageLabel:\s*"Stage B"/, "consistency branch must bypass the legacy dual Stage B path");

assert.match(stagedGeneration, /const\s+HEAD_REFINEMENT_PADDING_RATIO\s*=\s*0\.24/, "head refinement must pad the mask bounding box by 24%");
assert.match(stagedGeneration, /pass\.shotScale\s*===\s*"close"\s*\?\s*768\s*:\s*512/, "head refinement must use 768 close / 512 medium longest edge");
assert.match(stagedGeneration, /runHeadHairRefinement\(/, "close and medium passes must run head/hair refinement");
assert.match(stagedGeneration, /faceMasterPath[\s\S]*?faceAnglePath[\s\S]*?ACTIVE_LORA_NAME/, "refinement must be restricted to face master, angle reference, and active LoRA");
assert.match(stagedGeneration, /planExpandedCharacterRetryCrop\(/, "expand_head_crop must compute expanded conditioning geometry");
assert.match(stagedGeneration, /kind:\s*"expanded_retry_mask"/, "expanded retry masks must use a run-scoped artifact target");
assert.match(stagedGeneration, /resolveSequentialProviderWorkflow\(/, "provider switching must resolve an independently proven workflow");
assert.match(stagedGeneration, /workflowJsonOverride:\s*activeWorkflowJson/, "generation must execute the resolved active provider workflow");
assert.match(
  stagedGeneration,
  /runHeadHairRefinement\(\{[\s\S]*?provider:\s*acceptedAttempt\.provider/,
  "refinement must execute under the provider that produced the accepted attempt"
);
assert.match(
  stagedGeneration,
  /runHeadHairRefinement\(\{[\s\S]*?trackInput:\s*acceptedAttempt\.trackInput/,
  "head refinement must carry the accepted immutable reference/evidence binding into its own queue gate"
);
assert.match(
  stagedGeneration,
  /const\s+runHeadHairRefinement[\s\S]*?sequentialCharacterPass:\s*\{[\s\S]*?trackInput:\s*\{[\s\S]*?\.\.\.args\.trackInput,[\s\S]*?expectedReferenceInputNames:\s*refinementReferences\.map/,
  "head refinement must rehash the same immutable snapshot and bind only its actual reference inputs before queueing"
);
assert.match(
  stagedGeneration,
  /const\s+acceptedMaskPath\s*=\s*acceptedArtifacts\.maskPath[\s\S]*?buildAcceptedCharacterArtifacts\(\{[\s\S]*?maskPath:\s*acceptedMaskPath[\s\S]*?protectedMaskPaths\.push\(acceptedArtifacts\.maskPath\)[\s\S]*?artifacts:\s*acceptedArtifacts/,
  "successful refinement must preserve the accepted retry mask through rebuild, later protection, and final layer persistence"
);
assert.match(stagedGeneration, /generateShotAsset\(\{\s*\.\.\.settings,\s*characterGenerationProvider:\s*args\.provider\s*\}/, "refinement must use its proven provider settings");
assert.match(stagedGeneration, /const\s+runHeadHairRefinement[\s\S]*?providerId:\s*args\.provider/, "refinement queue proof must use the accepted attempt provider");
assert.match(stagedGeneration, /refinementValidation[\s\S]*?acceptedValidation\s*=/, "accepted layer metadata must use final refinement validation metrics");
assert.match(stagedGeneration, /const\s+generationTrack\s*=\s*attemptWorkflowProof\.ok[\s\S]*?resolveCharacterGenerationTrack\(\{[\s\S]*?providerId:\s*activeProvider/, "production generation must resolve one verified track for every actual attempt provider");
assert.match(stagedGeneration, /stageImmutableCharacterReferenceSnapshot\(\{[\s\S]*?identity:\s*activeAsset\.characterIdentityPack[\s\S]*?hashIdentity:\s*loadCharacterIdentityReferenceSourceHashes[\s\S]*?currentReferenceSourceHashes\s*=\s*immutableReferenceSnapshot\.sourceHashes[\s\S]*?resolveCharacterGenerationTrack\(\{[\s\S]*?characterAssetId:\s*activeAsset\.id[\s\S]*?characterZeroShotEvidence:\s*activeAsset\.characterZeroShotEvidence[\s\S]*?currentZeroContext:\s*trustedZeroContext[\s\S]*?currentLoraContext:\s*trustedLoraContext[\s\S]*?compiledWorkflow:\s*activeWorkflowJson/, "production resolution must stage canonical bytes before hashing them into the current evidence contexts");
assert.match(stagedGeneration, /references:\s*plannedPass\.references\.map\([\s\S]*?path:\s*immutableReferenceSnapshot\.pathBySource\[reference\.path\]/, "all later pass reference reads must be redirected to the run-owned immutable snapshot");
assert.doesNotMatch(stagedGeneration, /kind:\s*"staged_reference"/, "identity references must not be copied after the immutable snapshot hash");
assert.match(stagedGeneration, /slotPaths[\s\S]*?extractLocalInputName/, "queue-bound reference names must resolve directly from canonical_reference snapshot files");
assert.match(generateShotAsset, /verifyImmutableCharacterReferenceSnapshot\([\s\S]*?verifyCompiledCharacterReferenceBindings\([\s\S]*?verifyFreshCharacterEvidenceReceipts\([\s\S]*?resolveCharacterGenerationTrack\(\{\s*\.\.\.trackInput,[\s\S]*?compiledWorkflow:\s*built\s*\}\)[\s\S]*?queueComfyPrompt\(settings\.baseUrl,\s*built/, "every queue must rehash exact workflow inputs, freshly verify receipts, and then revalidate the compiled generation track");
assert.doesNotMatch(stagedGeneration, /const\s+trusted(?:Zero|Lora)ReceiptVerification\s*=\s*activeAsset/, "receipt verification must not be cached for a whole character pass");
assert.match(stagedGeneration, /expectedLoraBlocked[\s\S]*character_lora_evidence_blocked[\s\S]*status=needs_review/, "configured but unverified LoRA must surface an explicit needs-review diagnostic");
assert.match(stagedGeneration, /expectedLoraBlocked[\s\S]*lora_benchmark_evidence_required[\s\S]*appliedLora:\s*null/, "unverified LoRA must omit metadata and force a review outcome");
assert.match(stagedGeneration, /sequentialCharacterPass:\s*\{[\s\S]*?appliedLora:\s*attemptLora[\s\S]*?protectedIdentityTokens:/, "only resolver output and protected identity tokens may enter locked generation");
assert.match(stagedGeneration, /character_lora_compiled_workflow_mismatch[\s\S]*?retainedReviewReasons\s*=\s*\["lora_terminal_binding_mismatch"\][\s\S]*?createStoryboardNeedsReviewResult\(acceptedFramePath,\s*retainedReviewReasons\)/, "compiled LoRA mismatch must become needs_review before queue");
assert.match(stagedGeneration, /acceptedAttempt\s*=\s*\{[\s\S]*?appliedLora:\s*output\.appliedLora\s*\?\?\s*null/, "accepted metadata must use compiled proof output");
assert.match(stagedGeneration, /bestAttempt\s*=\s*\{[\s\S]*?appliedLora:\s*output\.appliedLora\s*\?\?\s*null/, "needs-review metadata must use compiled proof output");
assert.match(stagedGeneration, /const\s+acceptedLora\s*=\s*acceptedAttempt\.appliedLora/, "refinement must reuse the accepted attempt's LoRA without re-reading mutable asset state");
const acceptedLayerBuilder = between(stagedGeneration, "const buildAcceptedCharacterLayer", "const buildNeedsReviewCharacterLayer", "accepted character layer builder");
assert.doesNotMatch(acceptedLayerBuilder, /asset\.characterLora/, "persisted LoRA metadata must come only from the applied attempt profile");
assert.match(acceptedLayerBuilder, /appliedLora\?\.loraName[\s\S]*?appliedLora\?\.version/, "unapplied LoRA name/version keys must be omitted from metadata");

for (const field of [
  "isolatedRgbaPath",
  "maskPath",
  "acceptedCompositePath",
  "placementRect",
  "characterGenerationMetadata"
]) {
  assert.ok(stagedGeneration.includes(`${field}:`), `persisted ShotLayer is missing ${field}`);
}
assert.match(stagedGeneration, /status:\s*"accepted"/, "validated model output must persist accepted generation metadata");
assert.doesNotMatch(consistencyBranch, /storyboard_composite_still_fallback/, "cutout rescue must never be recorded as successful model generation");

// Review regressions: immutable inputs, real provider readiness, isolation, deterministic
// protection, refinement acceptance, and transactional state/cancellation.
assert.match(
  stagedGeneration,
  /buildSequentialArtifactPath\(\{[\s\S]*?kind:\s*"immutable_mask"/,
  "each pass needs a unique immutable mask filename"
);
assert.match(
  service,
  /sequentialCharacterPass\?:\s*\{[\s\S]*?lockedInputs:\s*true/,
  "generateShotAsset needs an explicit locked sequential-pass mode"
);
assert.match(
  generateShotAsset,
  /if\s*\(options\?\.sequentialCharacterPass\?\.lockedInputs\)[\s\S]*?imageReferenceSources\s*=\s*\[\]/,
  "locked sequential mode must bypass generic reference extraction"
);
assert.match(
  generateShotAsset,
  /options(?:\?)?\.sequentialCharacterPass(?:\?)?\.stagedReferences/,
  "locked sequential mode must use only explicitly staged pass references"
);
assert.match(
  stagedGeneration,
  /await\s+inspectCharacterGenerationPreflight\(settings\)/,
  "sequential generation must consume the live Task 4 provider preflight"
);
assert.match(stagedGeneration, /providerPreflight\.ready/, "the selected provider must be ready");
assert.match(stagedGeneration, /resolveSequentialProviderWorkflow\(/, "the configured workflow must match the executed provider");
assert.doesNotMatch(
  stagedGeneration,
  /models:\s*CHARACTER_GENERATION_PROVIDERS[\s\S]*?flatMap[\s\S]*?nodes:\s*CHARACTER_GENERATION_PROVIDERS/,
  "provider readiness must not be synthesized from registry requirements"
);
assert.match(stagedGeneration, /subtractProtectedMasksFromSequentialMask\(/, "active masks must subtract the prior-mask union");
assert.match(stagedGeneration, /remainingPixelCount\s*<=\s*0/, "empty protected masks must fail safely");
assert.match(
  stagedGeneration,
  /validateSequentialCharacterOutput\([\s\S]*?written\.localPath[\s\S]*?protectedMaskPaths/,
  "refinement must pass the same outside/protected/structure validation before acceptance"
);
assert.match(stagedGeneration, /pendingLayers:\s*PersistedCharacterShotLayer\[\]/, "layers must accumulate transactionally");
assert.match(
  consistencyBranch,
  /publishAcceptedCharacterFrame\([\s\S]*?storyboardGenerationStore\.setState/,
  "layer state may commit only after final publication succeeds"
);
assert.match(consistencyBranch, /planSequentialArtifactCleanup\(artifactLedger,\s*outcome\)/, "failure and success cleanup must be ledger-derived");
assert.match(stagedGeneration, /options\?\.signal\?\.throwIfAborted\(\)/, "the pass loop must propagate cancellation checks");
assert.match(generateShotAsset, /signal\?:\s*AbortSignal/, "generateShotAsset must accept the cancellation signal");

assert.equal(
  packageJson.scripts?.["test:sequential-character-passes"],
  "node scripts/check-sequential-character-passes.mjs",
  "package.json must expose the exact focused sequential-pass guard"
);

console.log("PASS per-character sequential generation tokens and acceptance pipeline");
