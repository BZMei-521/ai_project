#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CHARACTER_GENERATION_PROVIDERS, inspectCharacterProvider } from "../src/modules/comfy-pipeline/characterProviderRegistryRuntime.mjs";
import { inferCharacterView } from "../src/modules/comfy-pipeline/characterConsistencyRuntime.mjs";
import { proveTerminalProviderWorkflow } from "../src/modules/comfy-pipeline/sequentialCharacterPassRuntime.mjs";
import { isCharacterGenerationEvidenceEligible, recomputeCharacterGenerationEvidenceDigest } from "../src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs";
export { proveTerminalProviderWorkflow };
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const EXPECTED_SHOT_IDS = Object.freeze(["front_close", "three_quarter_medium", "left_profile", "right_profile", "back_view", "full_body_action", "strong_expression", "different_lighting"]);
export const SUPPORTED_PROVIDERS = Object.freeze(CHARACTER_GENERATION_PROVIDERS.map(({ id }) => id));
const SCALES = new Set(["close", "medium", "full_body"]);
const VIEWS = new Set(["front", "three_quarter", "left_profile", "right_profile", "back"]);
const DIMENSIONS = new Set(["face", "hair", "outfit", "body", "quality"]);
const BASE_TOKENS = Object.freeze(["PROMPT", "SEED", "CHARACTER_ASSET_ID", "SHOT_TITLE", "CAMERA_YAW", "SHOT_SCALE", "EXPECTED_VIEW", "PROVIDER", "ACTIVE_LORA_NAME", "ACTIVE_LORA_STRENGTH", "REFERENCE_IMAGE_A", "REFERENCE_IMAGE_B"]);
const CLI_MODES = Object.freeze({ "zero-shot": "zero_shot_multi_reference", lora: "lora_augmented" });
const GENERATION_MODES = new Set(Object.values(CLI_MODES));
const REFERENCE_TRANSFORMS = new Set(["none", "mirror_x", "head_shoulders_crop"]);
const REFERENCE_SLOT_FIELDS = Object.freeze({ face_master: "faceMasterPath", face_left: "faceLeftPath", face_right: "faceRightPath", hair_back: "hairBackPath", body_front: "bodyFrontPath", body_side: "bodySidePath", body_back: "bodyBackPath", expression_neutral: "neutralExpressionPath" });
const MAX_REFERENCE_BYTES = 40 * 1024 * 1024;
const LORA_BINDING_FIELDS = Object.freeze({
  LoraLoader: Object.freeze({ name: "lora_name", modelInput: "model", modelStrength: "strength_model", clipStrength: "strength_clip", clipStrengthPolicy: "equal_to_model" }),
  LoraLoaderModelOnly: Object.freeze({ name: "lora_name", modelInput: "model", modelStrength: "strength_model", clipStrength: null, clipStrengthPolicy: "not_applicable" })
});
const MODEL_SAMPLER_INPUTS = Object.freeze({ KSampler: "model", KSamplerAdvanced: "model", SamplerCustom: "model", SamplerCustomAdvanced: "model" });
const MODEL_GENERATION_INPUTS = Object.freeze({ CFGGuider: "model" });
const MODEL_FALLBACK_GENERATION_INPUTS = Object.freeze({ TextEncodeQwenImageEdit: "model" });
const MODEL_PROVIDER_GENERATOR_INPUTS = Object.freeze({ ...MODEL_GENERATION_INPUTS, ...MODEL_FALLBACK_GENERATION_INPUTS });
const MODEL_GENERATOR_INPUTS = Object.freeze({ ...MODEL_PROVIDER_GENERATOR_INPUTS, ...MODEL_SAMPLER_INPUTS });
const MODEL_PATCHER_INPUTS = Object.freeze({ ModelSamplingFlux: "model", ModelSamplingSD3: "model", FreeU: "model", FreeU_V2: "model", DifferentialDiffusion: "model" });
const MODEL_ROOT_OUTPUTS = Object.freeze({ UNETLoader: 0, CheckpointLoaderSimple: 0, CheckpointLoader: 0, DiffusersLoader: 0 });
const CANDIDATE_LORA_STATUSES = Object.freeze(["dataset_ready", "training"]);
const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const fail = (code, message) => Object.assign(new Error(message), { code });
const text = (value, code, label) => { if (typeof value !== "string" || !value.trim()) throw fail(code, `${label} is required`); return value.trim(); };
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(",")}]` : plain(value) ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}` : JSON.stringify(value);
const inRange = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

export function validateBenchmarkFixture(fixture) {
  if (!plain(fixture) || !Number.isInteger(fixture.benchmarkVersion) || fixture.benchmarkVersion < 1) throw fail("EFIXTURE", "benchmark fixture/version is invalid");
  text(fixture.promptTemplateVersion, "EFIXTURE", "promptTemplateVersion");
  const declared = fixture.requiredWorkflowTokens ?? [];
  if (!Array.isArray(declared) || new Set(declared).size !== declared.length || declared.some((token) => typeof token !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(token))) throw fail("ETOKENS", "requiredWorkflowTokens must be unique token names");
  if (!Array.isArray(fixture.shots) || fixture.shots.length !== 8) throw fail("ECOUNT", "benchmark requires exactly eight shots");
  const ids = fixture.shots.map((shot) => shot?.id);
  if (new Set(ids).size !== 8 || ids.some((id, index) => id !== EXPECTED_SHOT_IDS[index])) throw fail("EORDER", "benchmark IDs must be exact and ordered");
  fixture.shots.forEach((shot) => {
    text(shot.title, "ETITLE", `${shot.id}.title`); text(shot.prompt, "EPROMPT", `${shot.id}.prompt`);
    if (typeof shot.cameraYaw !== "number" || !Number.isFinite(shot.cameraYaw) || shot.cameraYaw < -180 || shot.cameraYaw > 180) throw fail("EYAW", `${shot.id}.cameraYaw is invalid`);
    if (!SCALES.has(shot.scale)) throw fail("ESCALE", `${shot.id}.scale is invalid`);
    if (!VIEWS.has(shot.expectedView)) throw fail("EVIEW", `${shot.id}.expectedView is invalid`);
    const inferredView = inferCharacterView(shot.cameraYaw).replace(/^(?:left|right)_three_quarter$/, "three_quarter"); if (shot.expectedView !== inferredView) throw fail("EVIEW", `${shot.id}.expectedView conflicts with cameraYaw`);
    if (!Number.isInteger(shot.seed) || shot.seed < 1 || shot.seed > 0xffffffff) throw fail("ESEED", `${shot.id}.seed is invalid`);
    const evaluation = shot.evaluation;
    if (!plain(evaluation) || !inRange(evaluation.minimumScore) || !Array.isArray(evaluation.requiredDimensions) || !evaluation.requiredDimensions.length || new Set(evaluation.requiredDimensions).size !== evaluation.requiredDimensions.length || evaluation.requiredDimensions.some((item) => typeof item !== "string" || item !== item.trim() || !DIMENSIONS.has(item))) throw fail("EEVALUATION", `${shot.id}.evaluation is invalid`);
    const policy = shot.referencePolicy; const slots = policy?.preferredSlots; const transforms = policy?.transforms;
    if (!plain(policy) || !Array.isArray(slots) || slots.length !== 2 || new Set(slots).size !== 2 || slots.some((slot) => !Object.hasOwn(REFERENCE_SLOT_FIELDS, slot)) || !plain(transforms) || slots.some((slot) => !REFERENCE_TRANSFORMS.has(transforms[slot])) || Object.keys(transforms).some((slot) => !slots.includes(slot))) throw fail("EREFERENCE_POLICY", `${shot.id}.referencePolicy is invalid`);
  });
  return fixture;
}

export function normalizeBaseUrl(value) {
  let url; try { url = new URL(text(value, "EURL", "base URL")); } catch { throw fail("EURL", "base URL must be an absolute http(s) URL"); }
  if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw fail("EURL", "base URL must be a plain http(s) endpoint");
  return url.toString().replace(/\/$/, "");
}

export function defaultReportPath(date = new Date()) { return `logs/character-consistency-benchmark-${date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.json`; }

export function parseBenchmarkCliArgs(argv) {
  const values = {}; const allowed = new Set(["mode", "character", "provider", "base-url", "output", "fixture", "workflow", "output-node", "evaluator-module", "project"]);
  for (let index = 0; index < argv.length; index += 1) { const token = argv[index]; if (!token.startsWith("--")) throw fail("ECLI", `unexpected argument: ${token}`); const [key, inline] = token.split("=", 2); const name = key.slice(2); if (!allowed.has(name)) throw fail("ECLI", `unknown option: ${key}`); const value = inline ?? argv[++index]; if (!value || value.startsWith("--")) throw fail("ECLI", `missing value for ${key}`); values[name] = value; }
  if (!CLI_MODES[values.mode]) throw fail("EMODE", "--mode must be zero-shot or lora");
  if (!values.character || !values.provider || !values["base-url"] || !values.output) throw fail("ECLI", "usage: --mode <zero-shot|lora> [--project <backup.json>] --character <asset-id> --provider <qwen_image_edit_2511|flux2_klein_4b> --base-url <http-url> --output <report.json> --workflow <workflow.json> --evaluator-module <trusted-local.mjs> [--fixture <benchmark.json>] [--output-node <node-id>]");
  if (!SUPPORTED_PROVIDERS.includes(values.provider)) throw fail("EPROVIDER", `unsupported or non-commercial provider: ${values.provider}`);
  return { generationMode: CLI_MODES[values.mode], character: text(values.character, "ECHARACTER", "character"), provider: values.provider, baseUrl: normalizeBaseUrl(values["base-url"]), outputPath: text(values.output, "EOUTPUT", "output path"), fixturePath: values.fixture, workflowPath: values.workflow, outputNode: values["output-node"], evaluatorModulePath: values["evaluator-module"], projectPath: values.project, workflowTokens: {} };
}

function referenceFormat(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

export async function loadIdentityReferenceManifest(identity, projectFile, { fileSystem = fs } = {}) {
  const base = path.dirname(projectFile); const manifest = [];
  for (const [slot, field] of Object.entries(REFERENCE_SLOT_FIELDS)) {
    const value = identity?.[field]; if (typeof value !== "string" || !value.trim()) continue;
    if (/^(?:https?|data|node|file):/i.test(value)) throw fail("EREFERENCE_REQUIRED", `${field} must be a trusted local image`);
    let realFile; try { realFile = await fileSystem.realpath(path.resolve(base, value)); } catch { throw fail("EREFERENCE_REQUIRED", `${field} does not exist`); }
    const extension = path.extname(realFile).toLowerCase(); if (!new Set([".png", ".jpg", ".jpeg", ".webp"]).has(extension)) throw fail("EREFERENCE_REQUIRED", `${field} must be a PNG, JPEG, or WebP image`);
    const stat = await fileSystem.stat(realFile); if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_REFERENCE_BYTES) throw fail("EREFERENCE_REQUIRED", `${field} must be a non-empty regular image no larger than 40 MiB`);
    const bytes = await fileSystem.readFile(realFile); const format = referenceFormat(bytes); const expectedFormat = extension === ".png" ? "png" : extension === ".webp" ? "webp" : "jpeg"; if (format !== expectedFormat) throw fail("EREFERENCE_REQUIRED", `${field} content does not match its approved image extension`);
    manifest.push(Object.freeze({ slot, sourceSha256: hash(bytes), logicalLabel: field.replace(/Path$/, ""), sourcePath: realFile }));
  }
  if (!manifest.some((item) => item.slot === "face_master") || !manifest.some((item) => item.slot === "body_front") || manifest.length < 3) throw fail("EREFERENCE_REQUIRED", "identity pack must provide face_master, body_front, and at least one additional reference");
  return Object.freeze(manifest.sort((left, right) => left.slot.localeCompare(right.slot)));
}

export async function loadBenchmarkProjectSubject(projectPath, { character, provider, generationMode, trustedRoot = PROJECT_ROOT, fileSystem = fs } = {}) {
  const value = text(projectPath, "EPROJECT", "project backup");
  if (/^(?:https?|data|node|file):/i.test(value)) throw fail("EPROJECT", "project backup must be a trusted local JSON path");
  const root = await fileSystem.realpath(trustedRoot); const resolved = path.resolve(PROJECT_ROOT, value); let realFile;
  try { realFile = await fileSystem.realpath(resolved); } catch { throw fail("EPROJECT", "project backup does not exist"); }
  const relative = path.relative(root, realFile); if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !/\.json$/i.test(realFile)) throw fail("EPROJECT", "project backup is outside the trusted project root");
  let backup; try { backup = JSON.parse(await fileSystem.readFile(realFile, "utf8")); } catch { throw fail("EPROJECT", "project backup JSON is malformed"); }
  const snapshot = plain(backup?.snapshot) ? backup.snapshot : backup; const assets = snapshot?.assets;
  if (!Array.isArray(assets)) throw fail("EPROJECT", "project backup assets are missing");
  const matches = assets.filter((asset) => plain(asset) && asset.type === "character" && asset.id === character);
  if (matches.length !== 1) throw fail("EPROJECT_CHARACTER", "project backup must contain exactly one matching character asset");
  if (!GENERATION_MODES.has(generationMode)) throw fail("EMODE", "generationMode must be zero_shot_multi_reference or lora_augmented");
  const asset = matches[0]; const identity = asset.characterIdentityPack; const lora = asset.characterLora;
  const requiredIdentityStrings = ["version", "triggerWord", "faceMasterPath", "bodyFrontPath", "updatedAt"];
  if (!plain(identity) || requiredIdentityStrings.some((key) => !text(identity[key], "EIDENTITY", key)) || !Array.isArray(identity.immutableTraits) || !identity.immutableTraits.length || !Array.isArray(identity.forbiddenChanges) || !identity.forbiddenChanges.length || !Array.isArray(identity.approvedHeroFramePaths) || !identity.approvedHeroFramePaths.length) throw fail("EIDENTITY", "matching character requires a complete identity pack");
  const definition = CHARACTER_GENERATION_PROVIDERS.find((item) => item.id === provider);
  if (!definition) throw fail("EPROVIDER", "provider is unsupported");
  if (generationMode === "lora_augmented" && (!plain(lora) || lora.provider !== provider || !text(lora.loraName, "ELORA", "loraName") || !text(lora.version, "ELORA", "version") || !text(lora.modelName, "ELORA", "modelName") || !CANDIDATE_LORA_STATUSES.includes(lora.status) || !Number.isFinite(lora.strength) || lora.strength <= 0 || lora.strength > 1.5 || !definition.requiredModels.includes(path.basename(lora.modelName)))) throw fail("ELORA", "matching character requires a non-ready candidate LoRA profile for the selected provider/model and a positive finite inference strength");
  const clean = (input, limit = 512) => text(input, "EPROJECT", "project value").replace(/[\x00-\x1f]/g, "").slice(0, limit);
  const identityPack = { version: clean(identity.version, 80), triggerWord: clean(identity.triggerWord, 120), immutableTraits: identity.immutableTraits.slice(0, 20).map((item) => clean(item, 240)), forbiddenChanges: identity.forbiddenChanges.slice(0, 20).map((item) => clean(item, 240)) };
  const identityReferenceManifest = await loadIdentityReferenceManifest(identity, realFile, { trustedRoot, fileSystem });
  const modelName = generationMode === "lora_augmented" ? clean(lora.modelName, 240) : path.basename(definition.requiredModels[0]);
  const subject = { characterAssetId: character, provider, identityPackVersion: identityPack.version, modelName };
  const workflowTokens = {};
  const characterContext = { identityPack };
  if (generationMode === "lora_augmented") { Object.assign(subject, { loraName: clean(lora.loraName, 240), loraVersion: clean(lora.version, 80), loraStrength: lora.strength, candidateStatus: lora.status }); characterContext.lora = { provider, modelName, loraName: subject.loraName, strength: lora.strength, version: subject.loraVersion, status: clean(lora.status, 40) }; Object.assign(workflowTokens, { ACTIVE_LORA_NAME: subject.loraName, ACTIVE_LORA_STRENGTH: lora.strength }); }
  return {
    subject, characterContext, identityReferenceManifest, workflowTokens
  };
}

function safeReferenceSource(item) {
  return { slot: item.slot, sourceSha256: item.sourceSha256, logicalLabel: String(item.logicalLabel ?? item.slot).replace(/[^a-zA-Z0-9 _.-]/g, "").slice(0, 120) || item.slot };
}

export function routeShotIdentityReferences(shot, manifest) {
  const policy = shot?.referencePolicy; if (!plain(policy) || !Array.isArray(policy.preferredSlots) || policy.preferredSlots.length !== 2 || !plain(policy.transforms)) throw fail("EREFERENCE_POLICY", `${shot?.id ?? "shot"}.referencePolicy is invalid`);
  if (!Array.isArray(manifest)) throw fail("EREFERENCE_REQUIRED", "identity reference manifest is required");
  const bySlot = new Map(manifest.map((item) => [item?.slot, item]));
  const routed = policy.preferredSlots.map((requestedSlot) => {
    let source = bySlot.get(requestedSlot); let transform = policy.transforms[requestedSlot];
    if (!source && requestedSlot === "face_right" && bySlot.has("face_left")) { source = bySlot.get("face_left"); transform = "mirror_x"; }
    else if (!source && requestedSlot === "face_left" && bySlot.has("face_right")) { source = bySlot.get("face_right"); transform = "mirror_x"; }
    if (!source || !REFERENCE_TRANSFORMS.has(transform) || !/^[a-f0-9]{64}$/i.test(source.sourceSha256 ?? "")) throw fail("EREFERENCE_REQUIRED", `${shot?.id ?? "shot"} requires identity reference slot ${requestedSlot}`);
    return Object.freeze({ requestedSlot, slot: source.slot, sourceSha256: source.sourceSha256.toLowerCase(), logicalLabel: safeReferenceSource(source).logicalLabel, sourcePath: source.sourcePath, transform });
  }).sort((left, right) => left.requestedSlot.localeCompare(right.requestedSlot));
  return Object.freeze(routed);
}

export function computeReferenceManifestDigest(fixture, manifest) {
  validateBenchmarkFixture(fixture);
  const sources = [...manifest].map(safeReferenceSource).sort((left, right) => left.slot.localeCompare(right.slot));
  const routes = fixture.shots.flatMap((shot) => routeShotIdentityReferences(shot, manifest).map((item) => ({ shotId: shot.id, requestedSlot: item.requestedSlot, slot: item.slot, sourceSha256: item.sourceSha256, transform: item.transform })));
  return hash(stable({ sources, routes }));
}

export async function loadTrustedEvaluator(modulePath, { trustedRoot = PROJECT_ROOT, fileSystem = fs } = {}) {
  const value = text(modulePath, "EEVALUATOR", "evaluator module");
  if (/^(?:https?|data|node|file):/i.test(value) || (!path.isAbsolute(value) && !/[\\/]/.test(value))) throw fail("EEVALUATOR", "evaluator must be an explicit local file path");
  const root = await fileSystem.realpath(trustedRoot); const resolved = path.resolve(PROJECT_ROOT, value); let realFile;
  try { realFile = await fileSystem.realpath(resolved); } catch { throw fail("EEVALUATOR", "evaluator module does not exist"); }
  const relative = path.relative(root, realFile); if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !/\.m?js$/i.test(realFile)) throw fail("EEVALUATOR", "evaluator module is outside the trusted project root");
  let source; try { source = await fileSystem.readFile(realFile); } catch { throw fail("EEVALUATOR", "evaluator module cannot be read"); }
  let loaded; try { loaded = await import(pathToFileURL(realFile).href); } catch (error) { throw fail("EEVALUATOR", `evaluator module import failed: ${String(error?.message ?? error)}`); }
  if (typeof loaded.evaluateCharacterShot !== "function") throw fail("EEVALUATOR", "evaluator module must export evaluateCharacterShot(context)");
  const version = typeof loaded.evaluatorVersion === "string" ? loaded.evaluatorVersion.trim().slice(0, 80) : ""; if (!version || ["unversioned", "programmatic"].includes(version.toLowerCase())) throw fail("EEVALUATOR", "evaluator module must export an explicit stable evaluatorVersion");
  const id = typeof loaded.evaluatorId === "string" && loaded.evaluatorId.trim() ? loaded.evaluatorId.trim().slice(0, 80) : "trusted_local_character_evaluator";
  const dimensionThreshold = inRange(loaded.evaluatorDimensionThreshold) ? loaded.evaluatorDimensionThreshold : 0;
  const policy = plain(loaded.evaluatorPolicy) ? loaded.evaluatorPolicy : { requiredDimensions: [...DIMENSIONS].sort(), dimensionThreshold };
  const exportedImplementationHash = typeof loaded.evaluatorImplementationHash === "string" && /^[a-f0-9]{64}$/i.test(loaded.evaluatorImplementationHash) ? loaded.evaluatorImplementationHash.toLowerCase() : null;
  const exportedPolicyHash = typeof loaded.evaluatorPolicyHash === "string" && /^[a-f0-9]{64}$/i.test(loaded.evaluatorPolicyHash) ? loaded.evaluatorPolicyHash.toLowerCase() : null;
  return {
    evaluateShot: loaded.evaluateCharacterShot,
    closeEvaluator: typeof loaded.closeEvaluator === "function" ? loaded.closeEvaluator : async () => undefined,
    requiresLocalOutput: loaded.requiresLocalOutput === true,
    proof: { id, version, implementationHash: exportedImplementationHash ?? hash(source), policyHash: exportedPolicyHash ?? hash(stable(policy)), dimensionThreshold, modulePathHash: hash(relative.replace(/\\/g, "/")) }
  };
}

function apiWorkflow(workflowValue) {
  let workflow = workflowValue;
  if (typeof workflow === "string") { try { workflow = JSON.parse(workflow); } catch { throw fail("EWORKFLOW", "workflow JSON is malformed"); } }
  if (!plain(workflow) || Object.hasOwn(workflow, "nodes") || !Object.keys(workflow).length || !Object.entries(workflow).every(([id, node]) => id.trim() && plain(node) && typeof node.class_type === "string" && node.class_type.trim() && plain(node.inputs))) throw fail("EWORKFLOW", "workflow must be a Comfy API prompt graph");
  return workflow;
}
function stringLeaves(value, output = []) { if (typeof value === "string") output.push(value); else if (Array.isArray(value)) value.forEach((item) => stringLeaves(item, output)); else if (plain(value)) Object.values(value).forEach((item) => stringLeaves(item, output)); return output; }
function placeholders(value, output = new Set()) { if (typeof value === "string") for (const match of value.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g)) output.add(match[1]); else if (Array.isArray(value)) value.forEach((item) => placeholders(item, output)); else if (plain(value)) Object.values(value).forEach((item) => placeholders(item, output)); return output; }
function compileTokens(value, tokens) {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{([A-Z][A-Z0-9_]*)\}\}$/); if (exact) return tokens[exact[1]];
    const compiled = value.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (_, name) => String(tokens[name]));
    if (compiled.includes("{{") || compiled.includes("}}")) throw fail("ETOKEN", "unresolved workflow placeholder"); return compiled;
  }
  if (Array.isArray(value)) return value.map((item) => compileTokens(item, tokens));
  if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compileTokens(item, tokens)]));
  return value;
}

export function compileBenchmarkWorkflow({ generationMode, provider, fixture, workflow, outputNode, workflowTokens = {} }) {
  validateBenchmarkFixture(fixture); if (!SUPPORTED_PROVIDERS.includes(provider)) throw fail("EPROVIDER", "provider is unsupported");
  if (generationMode !== undefined && !GENERATION_MODES.has(generationMode)) throw fail("EMODE", "generationMode is invalid");
  const graph = apiWorkflow(workflow);
  if (!plain(workflowTokens) || Object.keys(workflowTokens).some((key) => !/^[A-Z][A-Z0-9_]*$/.test(key))) throw fail("ETOKEN", "workflowTokens must be a plain token map");
  const requiredTokens = [...new Set(["PROMPT", "SEED", "CHARACTER_ASSET_ID", ...(generationMode === "zero_shot_multi_reference" ? ["REFERENCE_IMAGE_A", "REFERENCE_IMAGE_B"] : []), ...fixture.requiredWorkflowTokens ?? []])];
  const found = placeholders(graph); const known = new Set([...BASE_TOKENS, ...Object.keys(workflowTokens)]);
  const missingReferenceTokens = requiredTokens.filter((token) => token.startsWith("REFERENCE_IMAGE_") && !found.has(token));
  for (const token of requiredTokens) if (!found.has(token) && !token.startsWith("REFERENCE_IMAGE_")) throw fail("ETOKEN", `workflow is missing required token: ${token}`);
  for (const token of found) if (!known.has(token)) throw fail("ETOKEN", `workflow contains unknown token: ${token}`);
  const terminalProof = proveTerminalProviderWorkflow(provider, graph, outputNode);
  if (!terminalProof.ok) { const terminalSelectionFailure = String(terminalProof.reason ?? "").startsWith("terminal_"); const code = terminalSelectionFailure ? "EOUTPUT_NODE" : generationMode === "zero_shot_multi_reference" ? "EZERO_SHOT_MODEL_PATH" : "EPROVIDER_PROOF"; throw fail(code, terminalProof.reason); }
  const terminalOutputNode = terminalProof.terminalOutputNode;
  const resolveToken = (value) => { const exact = typeof value === "string" ? value.match(/^\{\{([A-Z][A-Z0-9_]*)\}\}$/) : null; return exact ? workflowTokens[exact[1]] : value; };
  const ancestorIds = new Set((terminalProof.ancestorNodeIds ?? []).map(String));
  const traceModelInput = (reference, downstreamNodeIds, downstreamEdges, visiting = new Set()) => {
    if (!Array.isArray(reference) || reference.length < 2) return { valid: false, bindings: [] };
    const sourceId = String(reference[0]); const outputIndex = reference[1]; const source = graph[sourceId];
    if (!plain(source) || visiting.has(sourceId)) return { valid: false, bindings: [] };
    const expectedRootOutput = MODEL_ROOT_OUTPUTS[source.class_type]; const loraFields = LORA_BINDING_FIELDS[source.class_type]; const patchInput = MODEL_PATCHER_INPUTS[source.class_type];
    if ((!loraFields && !patchInput && expectedRootOutput === undefined) || outputIndex !== (expectedRootOutput ?? 0)) return { valid: false, bindings: [] };
    const edge = { fromNodeId: sourceId, fromOutputIndex: outputIndex, toNodeId: downstreamNodeIds[0], toInput: "model" };
    if (expectedRootOutput !== undefined) return { valid: true, bindings: [] };
    const inputField = loraFields?.modelInput ?? patchInput; const nextVisiting = new Set(visiting); nextVisiting.add(sourceId);
    const upstream = traceModelInput(source.inputs?.[inputField], [sourceId, ...downstreamNodeIds], [edge, ...downstreamEdges], nextVisiting);
    if (!upstream.valid) return upstream;
    if (!loraFields) return upstream;
    const loraName = resolveToken(source.inputs?.[loraFields.name]);
    if (typeof loraName !== "string" || !loraName.trim()) return { valid: false, bindings: [] };
    const binding = { id: sourceId, classType: source.class_type, field: loraFields.name, loraName: loraName.trim(), strengthModel: resolveToken(source.inputs?.[loraFields.modelStrength]), strengthClip: loraFields.clipStrength ? resolveToken(source.inputs?.[loraFields.clipStrength]) : null, clipStrengthPolicy: loraFields.clipStrengthPolicy, modelPathNodeIds: [sourceId, ...downstreamNodeIds], modelPathEdges: [edge, ...downstreamEdges] };
    return { valid: true, bindings: [binding, ...upstream.bindings] };
  };
  const hasModelInput = (node, field) => Array.isArray(node.inputs?.[field]) && node.inputs[field].length >= 2;
  const terminalSamplers = Object.entries(graph).filter(([id, node]) =>
    ancestorIds.has(id) && MODEL_SAMPLER_INPUTS[node.class_type] && hasModelInput(node, MODEL_SAMPLER_INPUTS[node.class_type])
  );
  const generationConsumers = Object.entries(graph).filter(([id, node]) =>
    ancestorIds.has(id) && MODEL_GENERATION_INPUTS[node.class_type] && hasModelInput(node, MODEL_GENERATION_INPUTS[node.class_type])
  );
  const modelConsumers = [...terminalSamplers, ...generationConsumers];
  if (modelConsumers.length === 0) modelConsumers.push(...Object.entries(graph).filter(([id, node]) =>
    ancestorIds.has(id) && MODEL_FALLBACK_GENERATION_INPUTS[node.class_type] && hasModelInput(node, MODEL_FALLBACK_GENERATION_INPUTS[node.class_type])
  ));
  const consumerTraces = modelConsumers.map(([id, node]) => {
    const modelInput = MODEL_GENERATOR_INPUTS[node.class_type];
    return traceModelInput(node.inputs?.[modelInput], [id], []);
  });
  const authoritativeLoraBindings = consumerTraces.flatMap((traced) => traced.valid ? traced.bindings : []);
  const modelPathHasLora = (reference, visiting = new Set()) => {
    if (!Array.isArray(reference) || reference.length < 2) return false;
    const sourceId = String(reference[0]); const outputIndex = reference[1]; const source = graph[sourceId]; if (!plain(source) || visiting.has(sourceId) || outputIndex !== 0) return false;
    if (LORA_BINDING_FIELDS[source.class_type]) return true;
    const inputField = MODEL_PATCHER_INPUTS[source.class_type]; if (!inputField) return false;
    const next = new Set(visiting); next.add(sourceId); return modelPathHasLora(source.inputs?.[inputField], next);
  };
  const activeTerminalLora = modelConsumers.some(([, node]) => modelPathHasLora(node.inputs?.[MODEL_GENERATOR_INPUTS[node.class_type]]));
  const expectedLoraName = typeof workflowTokens.ACTIVE_LORA_NAME === "string" ? workflowTokens.ACTIVE_LORA_NAME.trim() : "";
  const expectedLoraStrength = Number(workflowTokens.ACTIVE_LORA_STRENGTH);
  const requiresActiveLoraProof = expectedLoraName || workflowTokens.ACTIVE_LORA_STRENGTH !== undefined;
  if (requiresActiveLoraProof) {
    const everyGenerationPathBindsLora = modelConsumers.length > 0 && consumerTraces.every((traced) => traced.valid && traced.bindings.length > 0);
    if (!expectedLoraName || !Number.isFinite(expectedLoraStrength) || expectedLoraStrength <= 0 || !everyGenerationPathBindsLora) {
      throw fail("EPROVIDER_PROOF", "character_lora_binding_missing");
    }
    const mismatch = authoritativeLoraBindings.find((binding) =>
      binding.loraName !== expectedLoraName ||
      binding.strengthModel !== expectedLoraStrength ||
      (binding.classType === "LoraLoader" && binding.strengthClip !== expectedLoraStrength) ||
      (binding.classType === "LoraLoaderModelOnly" && binding.strengthClip !== null)
    );
    if (mismatch) throw fail("EPROVIDER_PROOF", "character_lora_binding_mismatch");
  }
  if (generationMode === "zero_shot_multi_reference" && (modelConsumers.length === 0 || consumerTraces.some((traced) => !traced.valid))) throw fail("EZERO_SHOT_MODEL_PATH", "zero-shot workflow contains an unprovable terminal MODEL path");
  if (generationMode === "zero_shot_multi_reference" && activeTerminalLora) throw fail("EZERO_SHOT_LORA", "zero-shot workflow contains an active terminal character LoRA");
  if (missingReferenceTokens.length) throw fail("ETOKEN", `workflow is missing required token: ${missingReferenceTokens[0]}`);
  if (generationMode === "lora_augmented" && (!requiresActiveLoraProof || modelConsumers.length === 0 || consumerTraces.some((traced) => !traced.valid || traced.bindings.length === 0))) throw fail("EPROVIDER_PROOF", "character_lora_binding_missing");
  const providerProof = { providerId: terminalProof.providerId, validator: "terminal_bound_provider_proof", reason: "ok", workflowDigest: hash(stable(graph)), terminalOutputNode, requiredTokens: [...requiredTokens], ancestorNodeIds: terminalProof.ancestorNodeIds, authoritativeModelBindings: terminalProof.authoritativeModelBindings, authoritativeLoraBindings };
  const generationParameters = Object.freeze({ generationMode: generationMode ?? null, provider, terminalOutputNode, workflowDigest: providerProof.workflowDigest, shots: fixture.shots.map((shot) => ({ id: shot.id, prompt: shot.prompt, seed: shot.seed, cameraYaw: shot.cameraYaw, scale: shot.scale, expectedView: shot.expectedView })) });
  return { graph, providerProof, workflowTokens, generationMode, generationParameters, compileShot(shot, character, dynamicTokens = {}) { const tokens = { ...workflowTokens, ...dynamicTokens, PROMPT: shot.prompt, SEED: shot.seed, CHARACTER_ASSET_ID: character, SHOT_TITLE: shot.title, CAMERA_YAW: shot.cameraYaw, SHOT_SCALE: shot.scale, EXPECTED_VIEW: shot.expectedView, PROVIDER: provider }; return compileTokens(graph, tokens); } };
}

function classify(error, fallback = "EPROTOCOL") { if (error?.code) return error; if (error?.name === "AbortError") return fail("ECANCELLED", "request cancelled"); return fail(fallback, String(error?.message ?? error)); }
function abortError(reason, timedOut = false) { if (timedOut || reason?.code === "ETIMEOUT") return fail("ETIMEOUT", "request timed out"); if (reason?.code) return reason; return fail("ECANCELLED", typeof reason === "string" ? reason : "request cancelled"); }
function waitPromise(promise, { signal, timeoutMs, label = "request" } = {}) {
  if (signal?.aborted) return Promise.reject(classify(signal.reason ?? fail("ECANCELLED", "request cancelled")));
  let timer; let abort; const timeout = new Promise((_, reject) => { if (Number.isFinite(timeoutMs) && timeoutMs > 0) timer = setTimeout(() => reject(fail("ETIMEOUT", `${label} timed out`)), timeoutMs); });
  const cancelled = new Promise((_, reject) => { if (signal) { abort = () => reject(classify(signal.reason ?? fail("ECANCELLED", "request cancelled"))); signal.addEventListener("abort", abort, { once: true }); } });
  return Promise.race([promise, timeout, cancelled]).finally(() => { if (timer) clearTimeout(timer); if (signal && abort) signal.removeEventListener("abort", abort); });
}
export function createFetchTransport(fetchImpl = globalThis.fetch, { requestTimeoutMs = 30_000 } = {}) {
  if (typeof fetchImpl !== "function") throw fail("ETRANSPORT", "fetch is unavailable");
  const request = async (url, init = {}, responseType = "json") => {
    const controller = new AbortController(); const timeoutMs = init.timeoutMs ?? requestTimeoutMs; let timedOut = false; let timer; const parent = init.signal; const abort = () => controller.abort(abortError(parent?.reason));
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) timer = setTimeout(() => { timedOut = true; controller.abort(abortError(fail("ETIMEOUT", "request timed out"), true)); }, timeoutMs);
    let phase = "fetch"; try { const response = await waitPromise(fetchImpl(url, { ...init, signal: controller.signal }), { signal: controller.signal, timeoutMs: timeoutMs + 10, label: "ComfyUI request" }); if (!response?.ok) throw fail("EHTTP", `ComfyUI HTTP ${response?.status ?? "unknown"}`); if (responseType === "bytes") { const declaredLength = Number(response.headers?.get?.("content-length")); if (Number.isFinite(declaredLength) && declaredLength > MAX_REFERENCE_BYTES) throw fail("EOUTPUT_SIZE", "terminal output exceeds the 40 MiB limit"); } phase = "body"; const bodyPromise = responseType === "bytes" ? response.arrayBuffer() : response.json(); const body = await waitPromise(bodyPromise, { signal: controller.signal, timeoutMs: timeoutMs + 10, label: "ComfyUI response body" }); return responseType === "bytes" ? { bytes: Buffer.from(body), contentType: response.headers?.get?.("content-type") ?? null } : body; } catch (error) { if (controller.signal.aborted) throw abortError(controller.signal.reason, timedOut); const classified = classify(error, phase === "body" ? "EPROTOCOL" : "EOFFLINE"); if (classified.code === "EPROTOCOL" && phase === "fetch") throw fail("EOFFLINE", classified.message); throw classified; } finally { if (timer) clearTimeout(timer); parent?.removeEventListener("abort", abort); }
  };
  return {
    getJson: (url, options = {}) => request(url, { method: "GET", ...options }),
    getBytes: (url, options = {}) => request(url, { method: "GET", ...options }, "bytes"),
    postJson: (url, body, options = {}) => request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...options }),
    postFormData: (url, body, options = {}) => request(url, { method: "POST", body, ...options })
  };
}

export async function stageComfyOutputForEvaluation({ response, artifactRoot, shotId }, { fileSystem = fs } = {}) {
  const bytes = Buffer.isBuffer(response) ? response : Buffer.isBuffer(response?.bytes) ? response.bytes : null;
  if (!bytes?.length) throw fail("EOUTPUT", "terminal output bytes are missing");
  if (bytes.length > MAX_REFERENCE_BYTES) throw fail("EOUTPUT_SIZE", "terminal output exceeds the 40 MiB limit");
  const contentType = Buffer.isBuffer(response) ? null : typeof response?.contentType === "string" ? response.contentType.split(";", 1)[0].trim().toLowerCase() : null;
  const format = referenceFormat(bytes); const expectedContentType = format === "png" ? "image/png" : format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : null;
  if (!expectedContentType || (!Buffer.isBuffer(response) && contentType !== expectedContentType)) throw fail("EOUTPUT_FORMAT", "terminal output content-type must match PNG, JPEG, or WebP image bytes");
  const safeShotId = typeof shotId === "string" && /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(shotId) ? shotId : null;
  if (!safeShotId) throw fail("EOUTPUT", "shot ID is invalid for artifact staging");
  const root = path.resolve(text(artifactRoot, "EOUTPUT", "artifact root")); const outputSha256 = hash(bytes); const extension = format === "jpeg" ? "jpg" : format; const outputPath = path.join(root, `${safeShotId}-${outputSha256.slice(0, 16)}.${extension}`);
  await fileSystem.mkdir(root, { recursive: true });
  try { await fileSystem.writeFile(outputPath, bytes, { flag: "wx" }); } catch (stageError) { if (stageError?.code === "EEXIST") throw fail("EOUTPUT_EXISTS", "refusing to overwrite an existing staged terminal output"); throw fail("EOUTPUT", "terminal output could not be staged"); }
  return Object.freeze({ outputPath, outputSha256, contentType: expectedContentType });
}

async function resolveReferencePython() {
  let command = process.platform === "win32" ? "py" : "python3"; let prefix = process.platform === "win32" ? ["-3"] : [];
  if (process.platform === "win32" && process.env.LOCALAPPDATA) { const comfyPython = path.join(process.env.LOCALAPPDATA, "Comfy-Desktop", "ComfyUI-Installs", "ComfyUI", "ComfyUI", ".venv", "Scripts", "python.exe"); try { await fs.access(comfyPython); command = comfyPython; prefix = []; } catch { /* use the Python launcher fallback */ } }
  return { command, prefix };
}

export async function transformReferenceWithPython({ inputPath, outputPath, transform, signal }, dependencies = {}) {
  if (signal?.aborted) throw abortError(signal.reason);
  const resolved = await (dependencies.resolvePython ?? resolveReferencePython)(); const command = typeof resolved === "string" ? resolved : resolved.command; const prefix = typeof resolved === "string" ? [] : resolved.prefix ?? []; const spawnImpl = dependencies.spawnImpl ?? spawn;
  const child = spawnImpl(command, [...prefix, path.join(PROJECT_ROOT, "scripts/prepare-character-reference.py"), "--input", inputPath, "--output", outputPath, "--transform", transform], { cwd: PROJECT_ROOT, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  child.stderr?.resume?.();
  let abortReason = null; const abort = () => { abortReason = abortError(signal?.reason); try { child.kill(); } catch { /* close/error still decides process completion */ } }; signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
  try {
    const { code } = await new Promise((resolve, reject) => { child.once("close", (code, exitSignal) => resolve({ code, exitSignal })); child.once("error", () => reject(fail("EREFERENCE_TRANSFORM", "reference transform process could not start"))); });
    if (abortReason) throw abortReason;
    if (code !== 0) throw fail("EREFERENCE_TRANSFORM", "reference transform process failed");
  } finally { signal?.removeEventListener("abort", abort); }
}

async function uploadComfyReference({ endpoint, bytes, filename, subfolder, overwrite, signal, transport }) {
  if (typeof transport?.postFormData !== "function") throw fail("EREFERENCE_UPLOAD", "transport does not support multipart image upload");
  const form = new FormData(); form.append("image", new Blob([bytes], { type: "image/png" }), filename); form.append("subfolder", subfolder); form.append("type", "input"); form.append("overwrite", String(overwrite));
  try { return await transport.postFormData(endpoint, form, { signal }); } catch (error) { throw fail("EREFERENCE_UPLOAD", classify(error).message); }
}

function validateReferenceUploadResponse(response, { filename, subfolder }) {
  const normalizedFolder = (value) => typeof value === "string" ? value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") : "";
  if (!plain(response) || response.name !== filename || normalizedFolder(response.subfolder) !== normalizedFolder(subfolder) || response.type !== "input") throw fail("EREFERENCE_UPLOAD", "ComfyUI returned an invalid content-addressed reference upload response");
}

export async function prepareShotIdentityReferences({ shot, identityReferenceManifest, baseUrl, stagingRoot, signal }, dependencies = {}) {
  const routed = routeShotIdentityReferences(shot, identityReferenceManifest); const fileSystem = dependencies.fileSystem ?? fs; const ownedRoot = await fileSystem.mkdtemp(path.join(stagingRoot ?? os.tmpdir(), "character-reference-")); const references = []; const workflowTokens = {};
  try {
    for (let index = 0; index < routed.length; index += 1) {
      const item = routed[index]; const outputPath = path.join(ownedRoot, `${index}.png`); const transformReference = dependencies.transformReference ?? transformReferenceWithPython;
      try { await transformReference({ inputPath: item.sourcePath, outputPath, transform: item.transform, signal }); } catch (error) { if (error?.code) throw error; throw fail("EREFERENCE_TRANSFORM", "reference transform failed"); }
      let bytes; try { bytes = await fileSystem.readFile(outputPath); } catch { throw fail("EREFERENCE_TRANSFORM", "reference transformer did not produce an output PNG"); }
      if (!bytes.length) throw fail("EREFERENCE_TRANSFORM", "reference transformer produced an empty PNG");
      const transformedSha256 = hash(bytes); const filename = `${transformedSha256}.png`; const subfolder = "character-benchmark"; const uploadReference = dependencies.uploadReference ?? ((input) => uploadComfyReference({ ...input, transport: dependencies.transport }));
      const uploadResponse = await uploadReference({ endpoint: `${baseUrl}/upload/image`, bytes, filename, subfolder, overwrite: false, signal }); validateReferenceUploadResponse(uploadResponse, { filename, subfolder });
      workflowTokens[index === 0 ? "REFERENCE_IMAGE_A" : "REFERENCE_IMAGE_B"] = `${subfolder}/${filename}`;
      references.push(Object.freeze({ shotId: shot.id, slot: item.requestedSlot, sourceSha256: item.sourceSha256, transformedSha256, transform: item.transform }));
    }
    return Object.freeze({ references: Object.freeze(references), workflowTokens: Object.freeze(workflowTokens) });
  } finally { await fileSystem.rm(ownedRoot, { recursive: true, force: true }).catch(() => undefined); }
}
function safeDiagnostic(value) {
  return String(value ?? "")
    .replace(/(?:https?|file):\/\/[^\s"']+/gi, "[url]")
    .replace(/\\\\[^\s"']+/g, "[path]")
    .replace(/\b[A-Za-z]:[\\/][^\s"']+/g, "[path]")
    .replace(/(^|[\s(])\/(?!\/)[^\s"']+/g, "$1[path]")
    .replace(/(?:authorization|api[_ -]?key|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 500);
}
function statusError(entry) { const status = entry?.status; if (!plain(status)) return null; const state = String(status.status_str ?? status.status ?? "").toLowerCase(); if (["error", "failed", "cancelled"].includes(state)) { let details = status.messages ?? status.execution_errors ?? entry?.errors ?? state; try { details = typeof details === "string" ? details : JSON.stringify(details); } catch { details = state; } return safeDiagnostic(details); } return null; }
function outputFor(history, promptId, nodeId) { const entry = history?.[promptId]; const executionError = statusError(entry); if (executionError) throw fail("EEXECUTION", executionError); const node = entry?.outputs?.[nodeId]; const image = Array.isArray(node?.images) ? node.images[0] : null; if (!plain(image) || !text(image.filename, "EOUTPUT", "terminal image filename")) { if (entry?.status?.completed === true) throw fail("EOUTPUT", "completed terminal output is missing"); return null; } return image; }

export async function preflightCharacterBenchmark({ provider, baseUrl, providerProof }, { transport, signal, requestTimeoutMs } = {}) {
  try { if (signal?.aborted) throw classify(signal.reason ?? fail("ECANCELLED", "preflight cancelled")); await waitPromise(transport.getJson(`${baseUrl}/system_stats`, { signal, timeoutMs: requestTimeoutMs }), { signal, timeoutMs: requestTimeoutMs, label: "system_stats" }); const info = await waitPromise(transport.getJson(`${baseUrl}/object_info`, { signal, timeoutMs: requestTimeoutMs }), { signal, timeoutMs: requestTimeoutMs, label: "object_info" }); if (!plain(info)) throw fail("EPROTOCOL", "object_info format is invalid"); const definition = CHARACTER_GENERATION_PROVIDERS.find((item) => item.id === provider); const inspection = inspectCharacterProvider(definition, { commercialRequired: true, nodes: Object.keys(info), models: stringLeaves(info).filter((value) => /\.(?:safetensors|ckpt|pt|pth|bin)$/i.test(value)) }); if (!inspection.available) return { status: "failed", available: false, diagnostics: inspection.reasons, providerProof, missingModels: inspection.missingModels, missingNodes: inspection.missingNodes }; return { status: "ready", available: true, diagnostics: [], providerProof }; } catch (error) { const code = classify(error).code; return { status: code === "ECANCELLED" ? "cancelled" : "failed", available: false, diagnostics: [safeDiagnostic(`${code}: ${error.message}`)], providerProof }; }
}

export function createComfyExecutor({ compiledWorkflow, transport, clock = { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }, evaluateShot, characterContext = null, identityReferenceManifest = [], stagingRoot, artifactRoot, requireStagedOutput = false, fileSystem = fs, transformReference, uploadReference, pollAttempts = 120, pollMs = 1000, requestTimeoutMs = 30_000, overallTimeoutMs = 15 * 60_000 } = {}) {
  if (!compiledWorkflow?.providerProof || typeof transport?.getJson !== "function" || typeof transport?.postJson !== "function") throw fail("ETRANSPORT", "compiled workflow and JSON transport are required");
  return async ({ shot, character, baseUrl, signal }) => {
    const deadline = new AbortController(); const timer = setTimeout(() => deadline.abort(fail("ETIMEOUT", "shot deadline exceeded")), overallTimeoutMs); const abort = () => deadline.abort(signal.reason ?? fail("ECANCELLED", "shot cancelled")); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    try {
      const prepared = compiledWorkflow.generationMode === "zero_shot_multi_reference" || identityReferenceManifest.length ? await prepareShotIdentityReferences({ shot, identityReferenceManifest, baseUrl, stagingRoot, signal: deadline.signal }, { transport, transformReference, uploadReference }) : { references: [], workflowTokens: {} };
      const prompt = compiledWorkflow.compileShot(shot, character, prepared.workflowTokens); const queued = await waitPromise(transport.postJson(`${baseUrl}/prompt`, { prompt }, { signal: deadline.signal, timeoutMs: requestTimeoutMs }), { signal: deadline.signal, timeoutMs: requestTimeoutMs, label: "prompt" }); const promptId = text(queued?.prompt_id, "EPROTOCOL", "prompt_id");
      let image = null; for (let attempt = 0; attempt < pollAttempts; attempt += 1) { const history = await waitPromise(transport.getJson(`${baseUrl}/history/${encodeURIComponent(promptId)}`, { signal: deadline.signal, timeoutMs: requestTimeoutMs }), { signal: deadline.signal, timeoutMs: requestTimeoutMs, label: "history" }); image = outputFor(history, promptId, compiledWorkflow.providerProof.terminalOutputNode); if (image) break; await waitPromise(Promise.resolve(clock.sleep?.(pollMs)), { signal: deadline.signal, timeoutMs: requestTimeoutMs, label: "history poll" }); }
      if (!image) throw fail("ETIMEOUT", "terminal output did not arrive before poll deadline");
      const rawOutput = `${baseUrl}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder ?? "")}&type=${encodeURIComponent(image.type ?? "output")}`;
      const trustedOutput = sanitizeArtifact(rawOutput, baseUrl, { terminal: true }); const output = trustedOutput ?? rawOutput;
      const outputResponse = trustedOutput && typeof transport.getBytes === "function" ? await transport.getBytes(trustedOutput, { signal: deadline.signal, timeoutMs: requestTimeoutMs }) : null;
      const rawOutputBytes = Buffer.isBuffer(outputResponse) ? outputResponse : Buffer.isBuffer(outputResponse?.bytes) ? outputResponse.bytes : null;
      let outputSha256 = rawOutputBytes?.length ? hash(rawOutputBytes) : null; let outputPath = "";
      if (requireStagedOutput) { const staged = await stageComfyOutputForEvaluation({ response: outputResponse, artifactRoot, shotId: shot.id }, { fileSystem }); outputSha256 = staged.outputSha256; outputPath = staged.outputPath; }
      const localReferences = identityReferenceManifest.length ? routeShotIdentityReferences(shot, identityReferenceManifest).map((item) => ({ requestedSlot: item.requestedSlot, slot: item.slot, sourcePath: item.sourcePath, transform: item.transform, sourceSha256: item.sourceSha256 })) : [];
      const evaluation = typeof evaluateShot === "function" ? await evaluateShot({ output, outputPath, outputSha256, signal: deadline.signal, shot: structuredClone(shot), character: { id: character, context: characterContext }, providerProof: structuredClone(compiledWorkflow.providerProof), references: structuredClone(localReferences), referenceEvidence: structuredClone(prepared.references), referenceManifest: Array.isArray(identityReferenceManifest) ? identityReferenceManifest.map(safeReferenceSource) : [], execution: { promptId, terminalOutputNode: compiledWorkflow.providerProof.terminalOutputNode } }) : null;
      if (!plain(evaluation)) return { status: "needs_review", actualProvider: compiledWorkflow.providerProof.providerId, bestPreview: output, failureDimensions: ["evaluation"], failureReason: "missing evaluator result", providerProof: compiledWorkflow.providerProof };
      return { status: evaluation.status, actualProvider: compiledWorkflow.providerProof.providerId, evaluatorProvider: evaluation.actualProvider, provenance: evaluation.provenance, score: evaluation.score, dimensionScores: evaluation.dimensionScores, retries: evaluation.retries, references: evaluation.references, referenceEvidence: prepared.references, outputSha256, bestPreview: evaluation.bestPreview, failureDimensions: evaluation.failureDimensions, failureReason: evaluation.failureReason, previewKind: evaluation.previewKind, isFallback: evaluation.isFallback, isCutout: evaluation.isCutout, output, terminalOutputNode: compiledWorkflow.providerProof.terminalOutputNode, providerProof: compiledWorkflow.providerProof };
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  };
}

const safeString = (value, limit = 500) => typeof value === "string" ? safeDiagnostic(value).slice(0, limit) : null;
const safeArray = (value, limit = 12) => Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(0, limit).map((item) => safeString(item, 240)).filter(Boolean) : [];
const safeScoreMap = (value) => plain(value) ? Object.fromEntries(Object.entries(value).filter(([key, score]) => DIMENSIONS.has(key) && inRange(score)).map(([key, score]) => [key, score])) : {};
const safeFilename = (value) => typeof value === "string" && value.length > 0 && value.length <= 240 && value !== "." && value !== ".." && !/[\\/:\x00-\x1f]/.test(value) && !value.includes("..") ? value : null;
const safeSubfolder = (value) => { if (typeof value !== "string" || value.length > 240 || /[\\:\x00-\x1f]/.test(value) || value.startsWith("/") || value.startsWith("//")) return null; if (!value) return ""; const segments = value.split("/"); return segments.every((segment) => segment && segment !== "." && segment !== "..") ? value : null; };
function sanitizeArtifact(value, baseUrl, { terminal = false } = {}) {
  if (typeof value === "string") {
    if (value.length > 2048) return null; let url; let base; try { url = new URL(value); base = new URL(baseUrl); } catch { return null; }
    if (!/^https?:$/.test(url.protocol) || url.origin !== base.origin || url.pathname !== "/view" || url.username || url.password || url.hash) return null;
    const allowed = new Set(["filename", "subfolder", "type"]); if ([...url.searchParams.keys()].some((key) => !allowed.has(key)) || !url.searchParams.get("filename") || [...url.searchParams.keys()].some((key, index, keys) => keys.indexOf(key) !== index)) return null;
    const filename = url.searchParams.get("filename"); const subfolder = url.searchParams.get("subfolder") ?? ""; const type = url.searchParams.get("type") ?? "output";
    const safeName = safeFilename(filename); const safeFolder = safeSubfolder(subfolder); if (!safeName || safeFolder === null || !(terminal ? type === "output" : ["output", "input", "temp"].includes(type))) return null;
    const query = new URLSearchParams({ filename: safeName, subfolder: safeFolder, type }); return `${base.origin}/view?${query}`;
  }
  if (!plain(value) || Object.keys(value).some((key) => !["filename", "subfolder", "type"].includes(key))) return null;
  const filename = typeof value.filename === "string" ? value.filename : ""; const subfolder = typeof value.subfolder === "string" ? value.subfolder : ""; const type = typeof value.type === "string" ? value.type : "output";
  const safeName = safeFilename(filename); const safeFolder = safeSubfolder(subfolder); if (!safeName || safeFolder === null || !(terminal ? type === "output" : ["output", "input", "temp"].includes(type))) return null;
  return { filename: safeName, subfolder: safeFolder, type };
}
const safeArtifacts = (value, baseUrl, limit = 8) => Array.isArray(value) ? value.slice(0, limit).map((item) => sanitizeArtifact(item, baseUrl)).filter(Boolean) : [];
function emptyShot(shot) { return { id: shot.id, outputSha256: null, score: null, durationMs: 0, retries: 0, actualProvider: null, references: [], output: null, bestPreview: null, failureDimensions: [], failureReason: null, dimensionScores: {}, provenance: null, terminalOutputNode: null, finalStatus: "cancelled" }; }
function safeProof(value) { return value?.providerId ? { providerId: safeString(value.providerId, 80), validator: safeString(value.validator, 120), reason: safeString(value.reason, 120), workflowDigest: safeString(value.workflowDigest, 80), terminalOutputNode: safeString(value.terminalOutputNode, 80), requiredTokens: safeArray(value.requiredTokens, 20), ancestorNodeIds: safeArray(value.ancestorNodeIds, 100), authoritativeModelBindings: Array.isArray(value.authoritativeModelBindings) ? value.authoritativeModelBindings.slice(0, 10).map((item) => plain(item) ? { id: safeString(item.id, 80), classType: safeString(item.classType, 80), field: safeString(item.field, 80), model: safeString(item.model, 240) } : null).filter(Boolean) : [], authoritativeLoraBindings: Array.isArray(value.authoritativeLoraBindings) ? value.authoritativeLoraBindings.slice(0, 10).map((item) => plain(item) ? { id: safeString(item.id, 80), classType: safeString(item.classType, 80), field: safeString(item.field, 80), loraName: safeString(item.loraName, 240), strengthModel: typeof item.strengthModel === "number" && Number.isFinite(item.strengthModel) ? item.strengthModel : null, strengthClip: typeof item.strengthClip === "number" && Number.isFinite(item.strengthClip) ? item.strengthClip : null, clipStrengthPolicy: safeString(item.clipStrengthPolicy, 40), modelPathNodeIds: safeArray(item.modelPathNodeIds, 40), modelPathEdges: Array.isArray(item.modelPathEdges) ? item.modelPathEdges.slice(0, 40).map((edge) => plain(edge) && Number.isInteger(edge.fromOutputIndex) ? { fromNodeId: safeString(edge.fromNodeId, 80), fromOutputIndex: edge.fromOutputIndex, toNodeId: safeString(edge.toNodeId, 80), toInput: safeString(edge.toInput, 80) } : null).filter(Boolean) : [] } : null).filter(Boolean) : [] } : null; }
function safeEvaluatorProof(value) { const rawVersion = safeString(value?.version, 80); const version = rawVersion && !["unversioned", "programmatic"].includes(rawVersion.toLowerCase()) ? rawVersion : null; return plain(value) ? { id: safeString(value.id, 80), version, implementationHash: typeof value.implementationHash === "string" && /^[a-f0-9]{64}$/i.test(value.implementationHash) ? value.implementationHash.toLowerCase() : null, policyHash: typeof value.policyHash === "string" && /^[a-f0-9]{64}$/i.test(value.policyHash) ? value.policyHash.toLowerCase() : null, dimensionThreshold: inRange(value.dimensionThreshold) ? value.dimensionThreshold : null, modulePathHash: typeof value.modulePathHash === "string" && /^[a-f0-9]{64}$/i.test(value.modulePathHash) ? value.modulePathHash.toLowerCase() : null } : { id: null, version: null, implementationHash: null, policyHash: null, dimensionThreshold: null, modulePathHash: null }; }
const qualifiedEvaluatorProof = (proof) => Boolean(proof?.id && proof.version && /^[a-f0-9]{64}$/.test(proof.implementationHash ?? "") && /^[a-f0-9]{64}$/.test(proof.policyHash ?? "") && inRange(proof.dimensionThreshold));
function safeSubject(value) { if (!plain(value)) return null; const subject = { characterAssetId: safeString(value.characterAssetId, 160), provider: safeString(value.provider, 80), identityPackVersion: safeString(value.identityPackVersion, 80), modelName: safeString(value.modelName, 240) }; if ([value.loraName, value.loraVersion, value.loraStrength, value.candidateStatus].some((item) => item !== undefined)) Object.assign(subject, { loraName: safeString(value.loraName, 240), loraVersion: safeString(value.loraVersion, 80), loraStrength: typeof value.loraStrength === "number" && Number.isFinite(value.loraStrength) ? value.loraStrength : null, candidateStatus: safeString(value.candidateStatus, 40) }); return subject; }
function normalizeResult(raw, shot, proof, baseUrl) {
  const candidate = plain(raw) ? raw : {}; const status = ["accepted", "needs_review", "failed", "cancelled"].includes(candidate.status) ? candidate.status : "needs_review"; const score = inRange(candidate.score) ? candidate.score : null; const dimensions = safeScoreMap(candidate.dimensionScores); const actualProvider = safeString(candidate.actualProvider, 80); const fallback = candidate.previewKind === "fallback" || candidate.isFallback === true || candidate.isCutout === true || /(?:fallback|cutout)/i.test(String(candidate.output ?? ""));
  const base = { outputSha256: typeof candidate.outputSha256 === "string" && /^[a-f0-9]{64}$/i.test(candidate.outputSha256) ? candidate.outputSha256.toLowerCase() : null, score, retries: Number.isInteger(candidate.retries) && candidate.retries >= 0 ? candidate.retries : 0, actualProvider, references: safeArtifacts(candidate.references, baseUrl), output: sanitizeArtifact(candidate.output, baseUrl, { terminal: true }), bestPreview: sanitizeArtifact(candidate.bestPreview, baseUrl), failureDimensions: safeArray(candidate.failureDimensions), failureReason: safeString(candidate.failureReason), dimensionScores: dimensions, provenance: safeString(candidate.provenance, 80), terminalOutputNode: safeString(candidate.terminalOutputNode, 80), referenceEvidence: Array.isArray(candidate.referenceEvidence) ? candidate.referenceEvidence : [] };
  if (status !== "accepted") return { ...base, finalStatus: status };
  const gates = [candidate.provenance === "model_generation", actualProvider === proof.providerId, candidate.evaluatorProvider === undefined || candidate.evaluatorProvider === proof.providerId, score !== null && score >= shot.evaluation.minimumScore, shot.evaluation.requiredDimensions.every((dimension) => inRange(dimensions[dimension])), Boolean(base.output), candidate.terminalOutputNode === proof.terminalOutputNode, !fallback];
  return gates.every(Boolean) ? { ...base, finalStatus: "accepted" } : { ...base, finalStatus: "needs_review", failureReason: base.failureReason ?? "accepted result did not meet benchmark acceptance gates" };
}
export function summarizeBenchmark(shots) { const counts = { declared: shots.length, completed: 0, accepted: 0, needsReview: 0, failed: 0, cancelled: 0 }; const acceptedScores = []; for (const shot of shots) { if (shot.finalStatus === "accepted") { counts.completed++; counts.accepted++; acceptedScores.push(shot.score); } else if (shot.finalStatus === "needs_review") { counts.completed++; counts.needsReview++; } else if (shot.finalStatus === "failed") { counts.completed++; counts.failed++; } else counts.cancelled++; } const status = counts.cancelled ? "cancelled" : counts.failed ? "failed" : counts.needsReview ? "needs_review" : counts.accepted === 8 ? "accepted" : "failed"; return { ...counts, score: acceptedScores.length ? Number((acceptedScores.reduce((sum, value) => sum + value, 0) / acceptedScores.length).toFixed(6)) : null, status }; }
async function assertNoOutput(outputPath, fileSystem) { try { await fileSystem.access(outputPath); } catch (error) { if (error?.code === "ENOENT") return; throw error; } throw fail("EOUTPUT_EXISTS", `refusing to overwrite existing benchmark report: ${outputPath}`); }
export async function writeBenchmarkReportExclusive(outputPath, report, { fileSystem = fs, randomId = () => crypto.randomUUID() } = {}) { await fileSystem.mkdir(path.dirname(outputPath), { recursive: true }); await assertNoOutput(outputPath, fileSystem); const temp = `${outputPath}.${process.pid}.${randomId()}.tmp`; try { await fileSystem.writeFile(temp, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" }); try { await fileSystem.link(temp, outputPath); } catch (error) { if (error?.code === "EEXIST") throw fail("EOUTPUT_EXISTS", `refusing to overwrite existing benchmark report: ${outputPath}`); throw error; } } finally { await fileSystem.rm(temp, { force: true }).catch(() => undefined); } }
function safePreflight(value, proof) { const status = ["ready", "failed", "cancelled"].includes(value?.status) ? value.status : "failed"; return { status, available: Boolean(value?.available) && status === "ready", diagnostics: safeArray(value?.diagnostics), missingModels: safeArray(value?.missingModels), missingNodes: safeArray(value?.missingNodes), fallbackUsed: false, cutoutFallbackUsed: false, providerProof: safeProof(proof) }; }
export async function runCharacterConsistencyBenchmark(options, dependencies = {}) {
  const generationMode = text(options?.generationMode, "EMODE", "generationMode"); if (!GENERATION_MODES.has(generationMode)) throw fail("EMODE", "generationMode is invalid");
  const character = text(options?.character, "ECHARACTER", "character"); const provider = text(options?.provider, "EPROVIDER", "provider"); if (!SUPPORTED_PROVIDERS.includes(provider)) throw fail("EPROVIDER", "provider is unsupported"); const baseUrl = normalizeBaseUrl(options?.baseUrl); const outputPath = path.resolve(text(options?.outputPath, "EOUTPUT", "output path")); const fixture = validateBenchmarkFixture(options?.fixture); const fileSystem = dependencies.fileSystem ?? fs; await assertNoOutput(outputPath, fileSystem);
  const identityReferenceManifest = Array.isArray(options.identityReferenceManifest) ? options.identityReferenceManifest : [];
  const publicReferenceManifest = identityReferenceManifest.map(safeReferenceSource).sort((left, right) => left.slot.localeCompare(right.slot)); let referenceManifestDigest = hash(stable(publicReferenceManifest)); try { if (identityReferenceManifest.length) referenceManifestDigest = computeReferenceManifestDigest(fixture, identityReferenceManifest); } catch { referenceManifestDigest = hash(stable(publicReferenceManifest)); }
  const clock = dependencies.clock ?? { now: () => Date.now() }; const signal = dependencies.signal ?? new AbortController().signal; const report = { generationMode, benchmarkVersion: String(fixture.benchmarkVersion), promptTemplateVersion: String(fixture.promptTemplateVersion), fixtureDigest: hash(stable(fixture)), generationParametersDigest: null, referenceManifest: publicReferenceManifest, referenceManifestDigest, references: [], character, provider, baseUrl, startedAt: new Date(clock.now()).toISOString(), finishedAt: null, subject: safeSubject(options.subject), evaluatorProof: safeEvaluatorProof(dependencies.evaluatorProof), evidenceEligible: false, evidenceDigest: null, preflight: null, aggregate: null, shots: fixture.shots.map(emptyShot) };
  const finish = async () => { report.finishedAt = new Date(clock.now()).toISOString(); report.aggregate = summarizeBenchmark(report.shots); report.evidenceEligible = isCharacterGenerationEvidenceEligible(report); report.evidenceDigest = report.evidenceEligible ? recomputeCharacterGenerationEvidenceDigest(report) : null; await writeBenchmarkReportExclusive(outputPath, report, { fileSystem, randomId: dependencies.randomId }); return { exitCode: report.aggregate.status === "accepted" && report.aggregate.accepted === 8 ? 0 : 1, report, outputPath }; };
  if (dependencies.projectSetupError || dependencies.evaluatorSetupError) { const error = dependencies.projectSetupError ?? dependencies.evaluatorSetupError; report.preflight = safePreflight({ status: "failed", available: false, diagnostics: [`${error.code ?? "EEVALUATOR"}: ${error.message}`] }); return finish(); }
  let compiled; try { compiled = compileBenchmarkWorkflow({ generationMode, provider, fixture, workflow: options.workflow ?? options.workflowJson, outputNode: options.outputNode, workflowTokens: options.workflowTokens }); report.generationParametersDigest = hash(stable(compiled.generationParameters)); } catch (error) { report.preflight = safePreflight({ status: "failed", available: false, diagnostics: [`${error.code ?? "EWORKFLOW"}: ${error.message}`] }); return finish(); }
  if (typeof dependencies.evaluateShot !== "function" || !qualifiedEvaluatorProof(report.evaluatorProof)) { const error = fail("EEVALUATOR_REQUIRED", "a trusted evaluator with an explicit qualified proof is required"); report.preflight = safePreflight({ status: "failed", available: false, diagnostics: [`${error.code}: ${error.message}`] }, compiled.providerProof); return finish(); }
  let transport; try { transport = dependencies.transport ?? createFetchTransport(dependencies.fetchImpl, { requestTimeoutMs: dependencies.requestTimeoutMs }); if (typeof transport?.getJson !== "function" || typeof transport?.postJson !== "function") throw fail("ETRANSPORT", "transport must provide getJson and postJson"); const preflightFn = dependencies.preflight ?? ((input) => preflightCharacterBenchmark(input, { transport, signal, requestTimeoutMs: dependencies.requestTimeoutMs })); report.preflight = safePreflight(await preflightFn({ provider, baseUrl, providerProof: compiled.providerProof }), compiled.providerProof); } catch (error) { report.preflight = safePreflight({ status: "failed", available: false, diagnostics: [`${error.code ?? "EPREFLIGHT"}: ${error.message}`] }, compiled.providerProof); return finish(); }
  if (!report.preflight.available) return finish();
  let executor; try { executor = createComfyExecutor({ compiledWorkflow: compiled, transport, clock: dependencies.clock, evaluateShot: dependencies.evaluateShot, characterContext: options.characterContext, identityReferenceManifest, stagingRoot: dependencies.stagingRoot, artifactRoot: dependencies.artifactRoot ?? path.join(path.dirname(outputPath), `${path.basename(outputPath, path.extname(outputPath))}-artifacts`), requireStagedOutput: dependencies.requireStagedOutput === true, fileSystem, transformReference: dependencies.transformReference, uploadReference: dependencies.uploadReference, requestTimeoutMs: dependencies.requestTimeoutMs, overallTimeoutMs: dependencies.overallTimeoutMs }); } catch (error) { report.preflight = safePreflight({ status: "failed", available: false, diagnostics: [`${error.code ?? "EEXECUTOR"}: ${error.message}`] }, compiled.providerProof); return finish(); }
  for (let index = 0; index < fixture.shots.length; index += 1) { const shot = fixture.shots[index]; const started = clock.now(); try { const normalized = normalizeResult(await executor({ shot, character, baseUrl, signal }), shot, compiled.providerProof, baseUrl); const referenceEvidence = normalized.referenceEvidence; delete normalized.referenceEvidence; if (referenceEvidence.length) report.references.push(...referenceEvidence); report.shots[index] = { ...emptyShot(shot), ...normalized, id: shot.id, durationMs: Math.max(0, clock.now() - started) }; } catch (error) { const classified = classify(error); report.shots[index] = { ...emptyShot(shot), durationMs: Math.max(0, clock.now() - started), finalStatus: classified.code === "ECANCELLED" ? "cancelled" : "failed", failureReason: safeDiagnostic(`${classified.code}: ${classified.message}`) }; if (["ECANCELLED", "EOFFLINE", "ETRANSPORT", "EREFERENCE_REQUIRED", "EREFERENCE_TRANSFORM", "EREFERENCE_UPLOAD"].includes(classified.code)) break; } }
  return finish();
}
async function main() {
  let evaluator;
  try {
    const args = parseBenchmarkCliArgs(process.argv.slice(2)); const fixture = JSON.parse(await fs.readFile(path.resolve(args.fixturePath ?? "examples/character-consistency-benchmark/benchmark.json"), "utf8")); const workflowJson = args.workflowPath ? await fs.readFile(path.resolve(args.workflowPath), "utf8") : undefined;
    let evaluatorSetupError; try { if (!args.evaluatorModulePath) throw fail("EEVALUATOR_REQUIRED", "--evaluator-module <trusted-local-esm-path> is required"); evaluator = await loadTrustedEvaluator(args.evaluatorModulePath); } catch (error) { evaluatorSetupError = error; }
    let project; let projectSetupError; try { if (args.projectPath) project = await loadBenchmarkProjectSubject(args.projectPath, args); } catch (error) { projectSetupError = error; }
    const result = await runCharacterConsistencyBenchmark({ ...args, fixture, workflowJson, ...project }, { evaluateShot: evaluator?.evaluateShot, evaluatorProof: evaluator?.proof, evaluatorSetupError, projectSetupError, requireStagedOutput: evaluator?.requiresLocalOutput });
    console.log(JSON.stringify({ outputPath: result.outputPath, exitCode: result.exitCode, aggregate: result.report.aggregate, evidenceEligible: result.report.evidenceEligible, evidenceDigest: result.report.evidenceDigest }, null, 2)); process.exitCode = result.exitCode;
  } catch (error) { console.error(`${error?.code ?? "EBENCHMARK"}: ${error?.message ?? error}`); process.exitCode = 1; }
  finally { await evaluator?.closeEvaluator?.().catch(() => undefined); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
