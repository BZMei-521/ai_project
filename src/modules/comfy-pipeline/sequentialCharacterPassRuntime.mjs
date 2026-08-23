import {
  recomputeCharacterWorkflowDigest,
  validateStoredCharacterBenchmarkEvidence
} from "../asset-manager/characterIdentityUiRuntime.mjs";
import { validateStoredCharacterGenerationEvidence } from "./characterBenchmarkEvidenceRuntime.mjs";

const PROVIDER_REQUIREMENTS = Object.freeze({
  qwen_image_edit_2511: Object.freeze({
    requiredNodes: Object.freeze(["TextEncodeQwenImageEdit"]),
    requiredModels: Object.freeze(["qwen_image_edit_2511_bf16.safetensors"])
  }),
  flux2_klein_4b: Object.freeze({
    requiredNodes: Object.freeze(["ReferenceLatent", "CFGGuider", "Flux2Scheduler"]),
    requiredModels: Object.freeze(["flux-2-klein-4b-fp8.safetensors"]),
    requiredModelBindings: Object.freeze([
      Object.freeze({ classType: "UNETLoader", field: "unet_name", model: "flux-2-klein-4b-fp8.safetensors" })
    ])
  })
});

const AUTHORITATIVE_MODEL_LOADERS = Object.freeze([
  Object.freeze({ classType: "UNETLoader", field: "unet_name", widgetIndex: 0 }),
  Object.freeze({ classType: "UNETLoaderGGUF", field: "unet_name", widgetIndex: 0 }),
  Object.freeze({ classType: "CheckpointLoaderSimple", field: "ckpt_name", widgetIndex: 0 }),
  Object.freeze({ classType: "CheckpointLoader", field: "ckpt_name", widgetIndex: 0 }),
  Object.freeze({ classType: "DiffusionModelLoader", field: "model_name", widgetIndex: 0 })
]);

const CHARACTER_LORA_LOADERS = Object.freeze({
  LoraLoader: Object.freeze({ modelInput: "model", strengthModel: "strength_model", strengthClip: "strength_clip" }),
  LoraLoaderModelOnly: Object.freeze({ modelInput: "model", strengthModel: "strength_model", strengthClip: null })
});
const MODEL_SAMPLER_INPUTS = Object.freeze({
  KSampler: "model",
  KSamplerAdvanced: "model",
  SamplerCustom: "model",
  SamplerCustomAdvanced: "model"
});
const MODEL_GENERATION_INPUTS = Object.freeze({
  CFGGuider: "model"
});
const MODEL_FALLBACK_GENERATION_INPUTS = Object.freeze({
  TextEncodeQwenImageEdit: "model"
});
const MODEL_CONSUMER_INPUTS = Object.freeze({ ...MODEL_GENERATION_INPUTS, ...MODEL_FALLBACK_GENERATION_INPUTS, ...MODEL_SAMPLER_INPUTS });
const MODEL_PATCHER_INPUTS = Object.freeze({
  ModelSamplingFlux: "model",
  ModelSamplingSD3: "model",
  FreeU: "model",
  FreeU_V2: "model",
  DifferentialDiffusion: "model"
});

const safeSegment = (value, fallback = "item") => {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
};

const modelBasename = (value) => String(value ?? "").trim().split(/[\\/]/).pop()?.toLowerCase() ?? "";

const defaultRandomToken = () => {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.getRandomValues) {
    const values = new Uint32Array(2);
    cryptoObject.getRandomValues(values);
    return `${values[0].toString(36)}${values[1].toString(36)}`;
  }
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
};

export function createSequentialRunId(options = {}) {
  const now = options.now ?? Date.now;
  const randomToken = options.randomToken ?? defaultRandomToken;
  return safeSegment(`run_${Number(now()).toString(36)}_${randomToken()}`, "run");
}

export function buildSequentialArtifactPath(options) {
  const root = String(options.inputDir ?? "").trim().replace(/[\\/]+$/, "");
  if (!root) throw new Error("sequential_artifact_input_dir_required");
  const extension = safeSegment(options.extension ?? "png", "png").replace(/^\.+/, "") || "png";
  const parts = [
    "shot",
    safeSegment(options.shotId, "shot"),
    safeSegment(options.runId, "run"),
    `pass_${Math.max(0, Number(options.roleIndex) || 0)}`,
    safeSegment(options.characterId, "character"),
    safeSegment(options.kind, "artifact")
  ];
  if (options.suffix !== undefined && String(options.suffix).trim()) {
    parts.push(safeSegment(options.suffix, "item"));
  }
  return `${root}/${parts.join("_")}.${extension}`;
}

export function createSequentialArtifactLedger(runId) {
  return { runId: safeSegment(runId, "run"), entries: [] };
}

export function registerSequentialArtifact(ledger, artifact) {
  const path = String(artifact.path ?? "").trim();
  if (!path) return ledger;
  const entry = {
    path,
    retention: artifact.retention === "persisted" || artifact.retention === "publication" || artifact.retention === "review"
      ? artifact.retention
      : "disposable",
    runOwned: artifact.runOwned !== false
  };
  const existingIndex = ledger.entries.findIndex((item) => item.path === path);
  if (existingIndex >= 0) ledger.entries[existingIndex] = entry;
  else ledger.entries.push(entry);
  return ledger;
}

export async function executeSequentialArtifactWrite(ledger, artifact, writer) {
  registerSequentialArtifact(ledger, artifact);
  return writer(artifact.path);
}

export function planSequentialArtifactCleanup(ledger, outcome) {
  return [...new Set(
    ledger.entries
      .filter((entry) => entry.runOwned && entry.retention !== "review" && (outcome === "failure" || entry.retention === "disposable"))
      .map((entry) => entry.path)
  )];
}

export function planSequentialArtifactRetainedPaths(ledger) {
  return [...new Set(
    ledger.entries
      .filter((entry) => entry.runOwned && entry.retention !== "disposable")
      .map((entry) => entry.path)
  )];
}

export function acquireSequentialControllerOwner(ownerRef, createController = () => new AbortController()) {
  if (ownerRef.current) return { acquired: false, controller: ownerRef.current };
  const controller = createController();
  ownerRef.current = controller;
  return { acquired: true, controller };
}

export function releaseSequentialControllerOwner(ownerRef, controller) {
  if (ownerRef.current !== controller) return false;
  ownerRef.current = null;
  return true;
}

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseApiWorkflow = (workflowValue) => {
  let workflow = workflowValue;
  if (typeof workflowValue === "string") {
    try {
      workflow = JSON.parse(workflowValue);
    } catch {
      return { ok: false, reason: "malformed_json" };
    }
  }
  if (
    !isPlainObject(workflow) ||
    Object.hasOwn(workflow, "nodes") ||
    Object.keys(workflow).length === 0 ||
    !Object.entries(workflow).every(
      ([id, node]) => id.trim() && isPlainObject(node) && typeof node.class_type === "string" && node.class_type.trim() && isPlainObject(node.inputs)
    )
  ) {
    return { ok: false, reason: "workflow_root_invalid" };
  }
  return { ok: true, workflow };
};

const linkedNodeIds = (value, ids, result = new Set()) => {
  if (Array.isArray(value)) {
    const linkedId = value.length === 2 && (typeof value[0] === "string" || typeof value[0] === "number") && Number.isInteger(value[1])
      ? String(value[0])
      : "";
    if (linkedId) {
      if (!ids.has(linkedId)) throw new Error(`missing_link:${linkedId}`);
      result.add(linkedId);
    } else {
      value.forEach((item) => linkedNodeIds(item, ids, result));
    }
  } else if (isPlainObject(value)) {
    Object.values(value).forEach((item) => linkedNodeIds(item, ids, result));
  }
  return result;
};

export function proveTerminalProviderWorkflow(providerId, workflowValue, outputNode) {
  const requirement = PROVIDER_REQUIREMENTS[providerId];
  if (!requirement) return { ok: false, reason: `unknown_provider:${String(providerId ?? "")}`, providerId };
  const parsed = parseApiWorkflow(workflowValue);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, providerId };
  const workflow = parsed.workflow;
  const terminals = Object.entries(workflow)
    .filter(([, node]) => node.class_type === "SaveImage")
    .map(([id]) => id);
  const explicitTerminal = outputNode === undefined || outputNode === null || String(outputNode).trim() === ""
    ? ""
    : String(outputNode).trim();
  if (!explicitTerminal && terminals.length === 0) return { ok: false, reason: "terminal_missing", providerId };
  if (!explicitTerminal && terminals.length > 1) return { ok: false, reason: "terminal_ambiguous", providerId };
  const terminalOutputNode = explicitTerminal || terminals[0];
  if (!terminals.includes(terminalOutputNode)) return { ok: false, reason: "terminal_invalid", providerId };
  const ids = new Set(Object.keys(workflow));
  const ancestry = new Set();
  const stack = new Set();
  const visit = (id) => {
    if (stack.has(id)) throw new Error(`link_cycle:${id}`);
    if (ancestry.has(id)) return;
    const node = workflow[id];
    if (!node) throw new Error(`missing_link:${id}`);
    stack.add(id);
    ancestry.add(id);
    for (const linkedId of linkedNodeIds(node.inputs, ids)) visit(linkedId);
    stack.delete(id);
  };
  try {
    visit(terminalOutputNode);
  } catch (error) {
    const reason = String(error?.message ?? error);
    return { ok: false, reason: reason.startsWith("link_cycle:") ? "link_cycle" : "missing_link", providerId, terminalOutputNode };
  }
  const nodes = [...ancestry].map((id) => ({ id, node: workflow[id] }));
  const classes = new Set(nodes.map(({ node }) => node.class_type));
  for (const requiredNode of requirement.requiredNodes) {
    if (!classes.has(requiredNode)) {
      return { ok: false, reason: `missing_ancestry_node:${requiredNode}`, providerId, terminalOutputNode };
    }
  }
  const loaderBindings = nodes.flatMap(({ id, node }) => {
    const loader = AUTHORITATIVE_MODEL_LOADERS.find((candidate) => candidate.classType === node.class_type);
    if (!loader) return [];
    const value = node.inputs[loader.field];
    const model = typeof value === "string" ? modelBasename(value) : "";
    return model ? [{ id, classType: loader.classType, field: loader.field, model }] : [];
  });
  for (const requiredModel of requirement.requiredModels) {
    if (!loaderBindings.some((binding) => binding.model === requiredModel.toLowerCase())) {
      return { ok: false, reason: `missing_ancestry_model:${requiredModel.toLowerCase()}`, providerId, terminalOutputNode };
    }
  }
  for (const requiredBinding of requirement.requiredModelBindings ?? []) {
    if (!loaderBindings.some((binding) =>
      binding.classType === requiredBinding.classType &&
      binding.field === requiredBinding.field &&
      binding.model === requiredBinding.model.toLowerCase()
    )) {
      return {
        ok: false,
        reason: `missing_ancestry_model_binding:${requiredBinding.classType}:${requiredBinding.field}:${requiredBinding.model.toLowerCase()}`,
        providerId,
        terminalOutputNode
      };
    }
  }
  const requiredModels = new Set(requirement.requiredModels.map((model) => model.toLowerCase()));
  const conflictingModel = loaderBindings
    .filter((binding) => !requiredModels.has(binding.model))
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (conflictingModel) {
    return { ok: false, reason: `conflicting_ancestry_model:${conflictingModel.model}`, providerId, terminalOutputNode };
  }
  return {
    ok: true,
    reason: "ok",
    providerId,
    workflowDigest: recomputeCharacterWorkflowDigest(workflow),
    terminalOutputNode,
    ancestorNodeIds: [...ancestry].sort(),
    authoritativeModelBindings: loaderBindings.sort((left, right) => left.id.localeCompare(right.id))
  };
}

export function validateSequentialProviderWorkflow(providerId, workflowJson, outputNode) {
  return proveTerminalProviderWorkflow(providerId, workflowJson, outputNode);
}

const exactToken = (value, token) => typeof value === "string" && value.trim() === `{{${token}}}`;
const sameCompiledStrength = (left, right) =>
  typeof left === "number" && Number.isFinite(left) &&
  typeof right === "number" && Number.isFinite(right) &&
  Math.abs(left - right) <= 1e-9;

export function lockSequentialCharacterTokens(input = {}) {
  const source = isPlainObject(input.tokens) ? input.tokens : {};
  const protectedIdentityTokens = isPlainObject(input.protectedIdentityTokens) ? input.protectedIdentityTokens : {};
  const appliedLora = input.appliedLora;
  return {
    ...Object.fromEntries(Object.entries(source).map(([key, value]) => [key, String(value ?? "")])),
    ...Object.fromEntries(Object.entries(protectedIdentityTokens).map(([key, value]) => [key, String(value ?? "")])),
    PROVIDER: String(input.providerId ?? ""),
    ACTIVE_LORA_NAME: appliedLora ? String(appliedLora.loraName ?? "").trim() : "",
    ACTIVE_LORA_STRENGTH: appliedLora ? String(appliedLora.strength) : "0"
  };
}

export function proveCompiledCharacterLoraBinding(input = {}) {
  const providerProof = proveTerminalProviderWorkflow(input.providerId, input.compiledWorkflow, input.outputNode);
  if (!providerProof.ok) return { ok: false, reason: providerProof.reason, providerProof, appliedLora: null };
  const parsedTemplate = parseApiWorkflow(input.workflowTemplate);
  const parsedCompiled = parseApiWorkflow(input.compiledWorkflow);
  if (!parsedTemplate.ok || !parsedCompiled.ok) {
    return { ok: false, reason: !parsedTemplate.ok ? `template_${parsedTemplate.reason}` : parsedCompiled.reason, providerProof, appliedLora: null };
  }
  const template = parsedTemplate.workflow;
  const compiled = parsedCompiled.workflow;
  const tokenBoundIds = new Set(Object.entries(template).flatMap(([id, node]) => {
    const fields = CHARACTER_LORA_LOADERS[node.class_type];
    if (!fields || !exactToken(node.inputs?.lora_name, "ACTIVE_LORA_NAME")) return [];
    if (!exactToken(node.inputs?.[fields.strengthModel], "ACTIVE_LORA_STRENGTH")) return [];
    if (fields.strengthClip && !exactToken(node.inputs?.[fields.strengthClip], "ACTIVE_LORA_STRENGTH")) return [];
    return [id];
  }));
  const ancestry = new Set(providerProof.ancestorNodeIds);
  const traceModelInput = (reference, visiting = new Set()) => {
    if (!Array.isArray(reference) || reference.length < 2 || reference[1] !== 0) return { valid: false, bindings: [] };
    const sourceId = String(reference[0]);
    if (visiting.has(sourceId)) return { valid: false, bindings: [] };
    const source = compiled[sourceId];
    if (!isPlainObject(source) || !ancestry.has(sourceId)) return { valid: false, bindings: [] };
    const root = AUTHORITATIVE_MODEL_LOADERS.some((loader) => loader.classType === source.class_type);
    if (root) return { valid: true, bindings: [] };
    const loraFields = CHARACTER_LORA_LOADERS[source.class_type];
    const nextInput = loraFields?.modelInput ?? MODEL_PATCHER_INPUTS[source.class_type];
    if (!nextInput) return { valid: false, bindings: [] };
    const nextVisiting = new Set(visiting); nextVisiting.add(sourceId);
    const upstream = traceModelInput(source.inputs?.[nextInput], nextVisiting);
    if (!upstream.valid) return upstream;
    if (!loraFields) return upstream;
    return {
      valid: true,
      bindings: [{
        id: sourceId,
        classType: source.class_type,
        loraName: typeof source.inputs?.lora_name === "string" ? source.inputs.lora_name.trim() : "",
        strengthModel: source.inputs?.[loraFields.strengthModel],
        strengthClip: loraFields.strengthClip ? source.inputs?.[loraFields.strengthClip] : null
      }, ...upstream.bindings]
    };
  };
  const hasModelInput = (node, field) => Array.isArray(node.inputs?.[field]) && node.inputs[field].length >= 2;
  const terminalSamplers = Object.entries(compiled).filter(([id, node]) =>
    ancestry.has(id) && MODEL_SAMPLER_INPUTS[node.class_type] && hasModelInput(node, MODEL_SAMPLER_INPUTS[node.class_type])
  );
  const generationConsumers = Object.entries(compiled).filter(([id, node]) =>
    ancestry.has(id) && MODEL_GENERATION_INPUTS[node.class_type] && hasModelInput(node, MODEL_GENERATION_INPUTS[node.class_type])
  );
  const terminalConsumers = [...terminalSamplers, ...generationConsumers];
  if (terminalConsumers.length === 0) {
    terminalConsumers.push(...Object.entries(compiled).filter(([id, node]) =>
      ancestry.has(id) && MODEL_FALLBACK_GENERATION_INPUTS[node.class_type] && hasModelInput(node, MODEL_FALLBACK_GENERATION_INPUTS[node.class_type])
    ));
  }
  const consumerTraces = terminalConsumers.map(([, node]) =>
    traceModelInput(node.inputs?.[MODEL_CONSUMER_INPUTS[node.class_type]])
  );
  const tracedBindings = consumerTraces.flatMap((traced) => traced.valid ? traced.bindings : []);
  const characterBindings = tracedBindings.filter((binding) => tokenBoundIds.has(binding.id));
  const expected = input.appliedLora;
  if (!expected) {
    if (consumerTraces.length === 0 || consumerTraces.some((traced) => !traced.valid)) {
      return { ok: false, reason: "unverified_terminal_model_path", providerProof, appliedLora: null };
    }
    const activated = tracedBindings.find((binding) =>
      binding.loraName || binding.strengthModel !== 0 || (binding.classType === "LoraLoader" && binding.strengthClip !== 0)
    );
    return activated
      ? { ok: false, reason: `unexpected_character_lora_binding:${activated.id}`, providerProof, appliedLora: null }
      : { ok: true, reason: "ok", providerProof, appliedLora: null };
  }
  const expectedName = String(expected.loraName ?? "").trim();
  const expectedStrength = Number(expected.strength);
  const everyGenerationPathBindsExpectedLora = consumerTraces.length > 0 && consumerTraces.every((traced) =>
    traced.valid && traced.bindings.some((binding) => tokenBoundIds.has(binding.id))
  );
  if (!expectedName || !Number.isFinite(expectedStrength) || expectedStrength <= 0 || characterBindings.length === 0 || !everyGenerationPathBindsExpectedLora) {
    return { ok: false, reason: "character_lora_binding_missing", providerProof, appliedLora: null };
  }
  const mismatch = tracedBindings.find((binding) =>
    binding.loraName !== expectedName ||
    !sameCompiledStrength(binding.strengthModel, expectedStrength) ||
    (binding.classType === "LoraLoader" && !sameCompiledStrength(binding.strengthClip, expectedStrength))
  );
  if (mismatch) return { ok: false, reason: `character_lora_binding_mismatch:${mismatch.id}`, providerProof, appliedLora: null };
  return {
    ok: true,
    reason: "ok",
    providerProof,
    appliedLora: { loraName: characterBindings[0].loraName, strength: characterBindings[0].strengthModel, ...(expected.version ? { version: expected.version } : {}) }
  };
}

export function validateSequentialCharacterCount(value) {
  const count = Math.max(0, Math.floor(Number(value) || 0));
  return count <= 2
    ? { ok: true, count }
    : { ok: false, count, reason: `unsupported_character_count:${count}` };
}

const hasCanonicalLoraContextConflict = (input = {}) => {
  const lora = input.characterLora ?? input.lora;
  const inherited = input.currentLoraContext;
  if (!isPlainObject(lora) || !isPlainObject(inherited)) return false;
  const sameText = (left, right, normalize = (value) => String(value ?? "").trim()) => !normalize(left) || !normalize(right) || normalize(left) === normalize(right);
  return !sameText(input.characterAssetId, inherited.characterAssetId) ||
    !sameText(input.identityPackVersion, inherited.identityPackVersion) ||
    !sameText(input.providerId, inherited.provider) ||
    !sameText(input.modelName || lora.modelName, inherited.modelName, modelBasename) ||
    !sameText(lora.loraName, inherited.loraName) ||
    !sameText(lora.version, inherited.loraVersion) ||
    (Number.isFinite(Number(lora.strength)) && Number.isFinite(inherited.loraStrength) && Number(lora.strength) !== inherited.loraStrength) ||
    (input.workflowProof?.workflowDigest && inherited.workflowProof?.workflowDigest && input.workflowProof.workflowDigest !== inherited.workflowProof.workflowDigest) ||
    (input.workflowProof?.terminalOutputNode && inherited.workflowProof?.terminalOutputNode && input.workflowProof.terminalOutputNode !== inherited.workflowProof.terminalOutputNode);
};

const resolveValidatedLoraTrack = (input = {}) => {
  const lora = input.characterLora ?? input.lora;
  const strength = Number(lora?.strength);
  const loraName = String(lora?.loraName ?? "").trim();
  if (
    !isPlainObject(lora) ||
    lora.status !== "ready" ||
    lora.provider !== input.providerId ||
    !loraName ||
    !Number.isFinite(strength) ||
    strength <= 0
  ) return null;
  if (modelBasename(input.modelName) && modelBasename(input.modelName) !== modelBasename(lora.modelName)) return null;
  const supplied = {
    characterAssetId: input.characterAssetId,
    identityPackVersion: input.identityPackVersion,
    provider: input.providerId,
    modelName: input.modelName || lora.modelName,
    loraName,
    loraVersion: String(lora.version ?? "").trim(),
    loraStrength: strength,
    workflowProof: input.workflowProof
  };
  const inherited = input.currentLoraContext ?? {};
  const sameText = (left, right, normalize = (value) => String(value ?? "").trim()) => !normalize(left) || !normalize(right) || normalize(left) === normalize(right);
  if (
    !sameText(supplied.characterAssetId, inherited.characterAssetId) ||
    !sameText(supplied.identityPackVersion, inherited.identityPackVersion) ||
    !sameText(supplied.provider, inherited.provider) ||
    !sameText(supplied.modelName, inherited.modelName, modelBasename) ||
    !sameText(supplied.loraName, inherited.loraName) ||
    !sameText(supplied.loraVersion, inherited.loraVersion) ||
    (Number.isFinite(supplied.loraStrength) && Number.isFinite(inherited.loraStrength) && supplied.loraStrength !== inherited.loraStrength) ||
    (supplied.workflowProof?.workflowDigest && inherited.workflowProof?.workflowDigest && supplied.workflowProof.workflowDigest !== inherited.workflowProof.workflowDigest) ||
    (supplied.workflowProof?.terminalOutputNode && inherited.workflowProof?.terminalOutputNode && supplied.workflowProof.terminalOutputNode !== inherited.workflowProof.terminalOutputNode)
  ) return null;
  const currentLoraContext = {
    ...inherited,
    generationMode: "lora_augmented",
    characterAssetId: supplied.characterAssetId || inherited.characterAssetId,
    identityPackVersion: supplied.identityPackVersion || inherited.identityPackVersion,
    provider: supplied.provider || inherited.provider,
    loraName: supplied.loraName || inherited.loraName,
    loraVersion: supplied.loraVersion || inherited.loraVersion,
    modelName: supplied.modelName || inherited.modelName,
    loraStrength: supplied.loraStrength,
    workflowProof: supplied.workflowProof || inherited.workflowProof
  };
  const evidenceValidation = lora.benchmarkEvidence?.generationMode
    ? validateStoredCharacterGenerationEvidence(lora.benchmarkEvidence, currentLoraContext, { trustedReceiptVerification: input.trustedLoraReceiptVerification })
    : validateStoredCharacterBenchmarkEvidence(lora.benchmarkEvidence, currentLoraContext);
  if (!evidenceValidation.valid) return null;
  const version = String(lora.version ?? "").trim();
  return {
    mode: "lora_augmented",
    providerId: input.providerId,
    modelName: String(lora.modelName ?? "").trim(),
    appliedLora: { loraName, strength, ...(version ? { version } : {}) }
  };
};

const compiledWorkflowHasActiveLora = (workflowValue) => {
  if (workflowValue === undefined || workflowValue === null) return { known: true, active: false };
  const parsed = parseApiWorkflow(workflowValue);
  if (!parsed.ok) return { known: false, active: false };
  const active = Object.values(parsed.workflow).some((node) => {
    if (!CHARACTER_LORA_LOADERS[node.class_type]) return false;
    const config = CHARACTER_LORA_LOADERS[node.class_type];
    const loraName = String(node.inputs?.lora_name ?? "").trim();
    const modelStrength = Number(node.inputs?.[config.strengthModel]);
    const clipStrength = config.strengthClip ? Number(node.inputs?.[config.strengthClip]) : 0;
    return Boolean(loraName) && (modelStrength > 0 || clipStrength > 0);
  });
  return { known: true, active };
};

export function resolveCharacterGenerationTrack(input = {}) {
  if (hasCanonicalLoraContextConflict(input)) return null;
  const lora = resolveValidatedLoraTrack(input);
  if (lora) return lora;
  const compiledLora = compiledWorkflowHasActiveLora(input.compiledWorkflow);
  if (!compiledLora.known || compiledLora.active) return null;
  const currentEvidenceContext = {
    generationMode: "zero_shot_multi_reference",
    ...(input.currentZeroContext ?? input.currentEvidenceContext)
  };
  if (
    (input.characterAssetId && input.characterAssetId !== currentEvidenceContext.characterAssetId) ||
    (input.providerId && input.providerId !== currentEvidenceContext.provider) ||
    (input.identityPackVersion && input.identityPackVersion !== currentEvidenceContext.identityPackVersion) ||
    (modelBasename(input.modelName) && modelBasename(input.modelName) !== modelBasename(currentEvidenceContext.modelName))
  ) return null;
  const zero = validateStoredCharacterGenerationEvidence(input.characterZeroShotEvidence, currentEvidenceContext, { trustedReceiptVerification: input.trustedZeroReceiptVerification });
  return zero.valid ? {
    mode: "zero_shot_multi_reference",
    providerId: input.providerId || currentEvidenceContext.provider,
    modelName: input.modelName || currentEvidenceContext.modelName,
    appliedLora: null
  } : null;
}

export async function verifyFreshCharacterEvidenceReceipts(input = {}, verifyReceipt) {
  if (typeof verifyReceipt !== "function") throw new Error("trusted_receipt_verifier_missing");
  const missing = { valid: false, reason: "trusted_receipt_missing" };
  const trustedZeroReceiptVerification = input.characterZeroShotEvidence
    ? await verifyReceipt(input.characterZeroShotEvidence)
    : missing;
  const trustedLoraReceiptVerification = input.characterLora?.benchmarkEvidence
    ? await verifyReceipt(input.characterLora.benchmarkEvidence)
    : missing;
  return { trustedZeroReceiptVerification, trustedLoraReceiptVerification };
}

export function resolveAppliedCharacterLora(input = {}) {
  return resolveValidatedLoraTrack(input)?.appliedLora ?? null;
}

const SEQUENTIAL_PROVIDER_IDS = Object.freeze(["qwen_image_edit_2511", "flux2_klein_4b"]);

export function normalizeSequentialProviderWorkflowMap(input = {}) {
  const selectedProviderId = SEQUENTIAL_PROVIDER_IDS.includes(input.selectedProviderId)
    ? input.selectedProviderId
    : "qwen_image_edit_2511";
  const source = isPlainObject(input.workflowJsonByProvider) ? input.workflowJsonByProvider : {};
  const normalized = Object.fromEntries(
    SEQUENTIAL_PROVIDER_IDS.map((providerId) => [
      providerId,
      typeof source[providerId] === "string" ? source[providerId] : ""
    ])
  );
  const singularWorkflowJson = typeof input.singularWorkflowJson === "string" ? input.singularWorkflowJson : "";
  if (!normalized[selectedProviderId].trim() && singularWorkflowJson.trim()) {
    normalized[selectedProviderId] = singularWorkflowJson;
  }
  return normalized;
}

export function resolveSequentialProviderWorkflow(input) {
  const providerId = input?.providerId;
  const workflowJson = String(input?.workflowJsonByProvider?.[providerId] ?? "").trim();
  if (!workflowJson) return { ok: false, providerId, reason: "missing_provider_workflow" };
  const proof = validateSequentialProviderWorkflow(providerId, workflowJson);
  return proof.ok
    ? { ok: true, providerId, reason: "ok", workflowJson, proof }
    : { ok: false, providerId, reason: proof.reason };
}

const paddedRect = (bbox, canvasWidth, canvasHeight, paddingRatio) => {
  const padX = Math.round(Math.max(0, Number(bbox?.width) || 0) * paddingRatio);
  const padY = Math.round(Math.max(0, Number(bbox?.height) || 0) * paddingRatio);
  const x = Math.max(0, Math.floor(Number(bbox?.x) || 0) - padX);
  const y = Math.max(0, Math.floor(Number(bbox?.y) || 0) - padY);
  const right = Math.min(canvasWidth, Math.ceil((Number(bbox?.x) || 0) + (Number(bbox?.width) || 0)) + padX);
  const bottom = Math.min(canvasHeight, Math.ceil((Number(bbox?.y) || 0) + (Number(bbox?.height) || 0)) + padY);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
};

export function planExpandedCharacterRetryCrop(input) {
  const canvasWidth = Math.max(1, Math.floor(Number(input?.canvasWidth) || 1));
  const canvasHeight = Math.max(1, Math.floor(Number(input?.canvasHeight) || 1));
  const normalPaddingRatio = Math.max(0, Number(input?.normalPaddingRatio) || 0.24);
  const expandedPaddingRatio = Math.max(normalPaddingRatio + 0.01, Number(input?.expandedPaddingRatio) || 0.38);
  return {
    normal: paddedRect(input?.bbox, canvasWidth, canvasHeight, normalPaddingRatio),
    expanded: paddedRect(input?.bbox, canvasWidth, canvasHeight, expandedPaddingRatio),
    normalPaddingRatio,
    expandedPaddingRatio
  };
}

const throwIfAborted = (signal) => {
  signal?.throwIfAborted();
};

export async function executeSequentialTransaction(options) {
  const promptIds = [];
  const recordPromptId = (promptId) => {
    const normalized = String(promptId ?? "").trim();
    if (normalized && !promptIds.includes(normalized)) promptIds.push(normalized);
  };
  try {
    throwIfAborted(options.signal);
    const generated = await options.generate({
      assertActive: () => throwIfAborted(options.signal),
      recordPromptId
    });
    throwIfAborted(options.signal);
    const published = await options.publish(generated);
    throwIfAborted(options.signal);
    await options.commit(published);
    try {
      await options.cleanup("success");
    } catch {
      // Successful publication and commit must not be rolled back by best-effort temp cleanup.
    }
    return published;
  } catch (error) {
    if (options.signal?.aborted && promptIds.length > 0) {
      try {
        await options.interrupt([...promptIds]);
      } catch {
        // Preserve the original abort/failure after best-effort interruption.
      }
    }
    try {
      await options.cleanup("failure");
    } catch {
      // Preserve the original abort/failure after best-effort cleanup.
    }
    throw error;
  }
}
