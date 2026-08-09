import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { inferCharacterView } from "../src/modules/comfy-pipeline/characterConsistencyRuntime.mjs";
import {
  recomputeCharacterBenchmarkEvidenceDigest,
  validateCharacterBenchmarkEvidence
} from "../src/modules/comfy-pipeline/characterBenchmarkEvidenceRuntime.mjs";
import * as benchmarkRunner from "./run-character-consistency-benchmark.mjs";

const {
  EXPECTED_SHOT_IDS, SUPPORTED_PROVIDERS, compileBenchmarkWorkflow, computeReferenceManifestDigest,
  createComfyExecutor, createFetchTransport, defaultReportPath, loadBenchmarkProjectSubject,
  loadTrustedEvaluator, prepareShotIdentityReferences, parseBenchmarkCliArgs, routeShotIdentityReferences,
  runCharacterConsistencyBenchmark, proveTerminalProviderWorkflow, summarizeBenchmark,
  transformReferenceWithPython, validateBenchmarkFixture, writeBenchmarkReportExclusive
} = benchmarkRunner;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runnerSource = await readFile(path.join(repoRoot, "scripts/run-character-consistency-benchmark.mjs"), "utf8");
const fixture = JSON.parse(await readFile(path.join(repoRoot, "examples/character-consistency-benchmark/benchmark.json"), "utf8"));
const ids = ["front_close", "three_quarter_medium", "left_profile", "right_profile", "back_view", "full_body_action", "strong_expression", "different_lighting"];
const dimensions = { face: 0.92, hair: 0.91, outfit: 0.9, body: 0.89, quality: 0.93 };
const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

const qwenWorkflow = () => ({
  "1": { class_type: "UNETLoader", inputs: { unet_name: "models/qwen_image_edit_2511_bf16.safetensors" } },
  "2": { class_type: "TextEncodeQwenImageEdit", inputs: { model: ["1", 0], text: "{{PROMPT}}", seed: "{{SEED}}", yaw: "{{CAMERA_YAW}}", scale: "{{SHOT_SCALE}}", view: "{{EXPECTED_VIEW}}", character: "{{CHARACTER_ASSET_ID}}", context: "{{CHARACTER_CONTEXT}}" } },
  "3": { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: "{{SHOT_TITLE}}" } }
});
const kleinWorkflow = () => ({
  "1": { class_type: "UNETLoader", inputs: { unet_name: "flux-2-klein-4b-fp8.safetensors" } },
  "2": { class_type: "ReferenceLatent", inputs: { conditioning: "{{PROMPT}}", latent: "{{CHARACTER_ASSET_ID}}", seed: "{{SEED}}", yaw: "{{CAMERA_YAW}}", scale: "{{SHOT_SCALE}}", view: "{{EXPECTED_VIEW}}" } },
  "3": { class_type: "CFGGuider", inputs: { model: ["1", 0], positive: ["2", 0], negative: ["2", 0] } },
  "4": { class_type: "Flux2Scheduler", inputs: { steps: 4 } },
  "5": { class_type: "SamplerCustom", inputs: { guider: ["3", 0], sigmas: ["4", 0], latent_image: ["2", 0] } },
  "6": { class_type: "SaveImage", inputs: { images: ["5", 0], filename_prefix: "{{SHOT_TITLE}}" } }
});
const kleinLoraWorkflow = () => ({
  "1": { class_type: "UNETLoader", inputs: { unet_name: "flux-2-klein-4b-fp8.safetensors" } },
  "2": { class_type: "ReferenceLatent", inputs: { conditioning: "{{PROMPT}}", latent: "{{CHARACTER_ASSET_ID}}", seed: "{{SEED}}", yaw: "{{CAMERA_YAW}}", scale: "{{SHOT_SCALE}}", view: "{{EXPECTED_VIEW}}" } },
  "3": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "{{ACTIVE_LORA_NAME}}", strength_model: "{{ACTIVE_LORA_STRENGTH}}" } },
  "4": { class_type: "CFGGuider", inputs: { model: ["3", 0], positive: ["2", 0], negative: ["2", 0] } },
  "5": { class_type: "Flux2Scheduler", inputs: { steps: 4 } },
  "6": { class_type: "SamplerCustomAdvanced", inputs: { guider: ["4", 0], sigmas: ["5", 0], latent_image: ["2", 0] } },
  "7": { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: "{{SHOT_TITLE}}" } }
});
const qwenLoraWorkflow = () => {
  const workflow = qwenWorkflow();
  workflow["4"] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "{{ACTIVE_LORA_NAME}}", strength_model: "{{ACTIVE_LORA_STRENGTH}}" } };
  workflow["2"].inputs.model = ["4", 0];
  return workflow;
};
const loraTokens = Object.freeze({ CHARACTER_CONTEXT: {}, ACTIVE_LORA_NAME: "ada-v3.safetensors", ACTIVE_LORA_STRENGTH: 0.9 });
const workflowFor = (provider) => provider === "flux2_klein_4b" ? kleinWorkflow() : qwenWorkflow();
const terminalFor = (provider) => provider === "flux2_klein_4b" ? "6" : "3";
const clone = (value) => structuredClone(value);
const runChild = (command, args) => new Promise((resolve, reject) => { const child = spawn(command, args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }); let stdout = ""; let stderr = ""; child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; }); child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr })); });
const sha = (digit) => digit.repeat(64);
const programmaticEvaluatorProof = Object.freeze({ id: "benchmark-test", version: "v1", implementationHash: sha("a"), policyHash: sha("b"), dimensionThreshold: 0.8 });
const routedManifest = Object.freeze([
  Object.freeze({ slot: "face_master", sourceSha256: sha("1"), logicalLabel: "canonical face", sourcePath: "C:/private/face.png" }),
  Object.freeze({ slot: "face_left", sourceSha256: sha("2"), logicalLabel: "left profile", sourcePath: "C:/private/left.png" }),
  Object.freeze({ slot: "hair_back", sourceSha256: sha("3"), logicalLabel: "back hair", sourcePath: "C:/private/hair.png" }),
  Object.freeze({ slot: "body_front", sourceSha256: sha("4"), logicalLabel: "front body", sourcePath: "C:/private/body-front.png" }),
  Object.freeze({ slot: "body_side", sourceSha256: sha("5"), logicalLabel: "side body", sourcePath: "C:/private/body-side.png" }),
  Object.freeze({ slot: "body_back", sourceSha256: sha("6"), logicalLabel: "back body", sourcePath: "C:/private/body-back.png" }),
  Object.freeze({ slot: "expression_neutral", sourceSha256: sha("7"), logicalLabel: "neutral expression", sourcePath: "C:/private/expression.png" })
]);

assert.deepEqual(EXPECTED_SHOT_IDS, ids);
assert.deepEqual(SUPPORTED_PROVIDERS, ["qwen_image_edit_2511", "flux2_klein_4b"]);
assert.doesNotMatch(runnerSource, /validateSequentialProviderWorkflow/, "selected-terminal proof must not be preceded by a selection-agnostic provider proof");
assert.equal(typeof proveTerminalProviderWorkflow, "function", "provider proof must be terminal-bound and importable");
assert.equal(validateBenchmarkFixture(fixture).shots[0].cameraYaw, 0, "zero camera yaw is valid");
assert.deepEqual(fixture.shots.map(({ id }) => id), ids);
const fixtureView = (yaw) => inferCharacterView(yaw).replace(/^(?:left|right)_three_quarter$/, "three_quarter");
for (const shot of fixture.shots) assert.equal(shot.expectedView, fixtureView(shot.cameraYaw), `${shot.id} yaw/view must agree with shared inference`);
for (const [mutate, code] of [
  [(item) => item.shots.pop(), "ECOUNT"], [(item) => { item.shots[1].id = item.shots[0].id; }, "EORDER"],
  [(item) => { delete item.shots[0].cameraYaw; }, "EYAW"], [(item) => { item.shots[0].evaluation.minimumScore = NaN; }, "EEVALUATION"],
  [(item) => { item.shots[5].cameraYaw = 0; }, "EVIEW"],
  [(item) => { item.shots[0].evaluation.requiredDimensions = ["face", "face"]; }, "EEVALUATION"], [(item) => { item.shots[0].evaluation.requiredDimensions = [" face"]; }, "EEVALUATION"]
]) { const candidate = clone(fixture); mutate(candidate); assert.throws(() => validateBenchmarkFixture(candidate), (error) => error?.code === code); }
assert.equal(defaultReportPath(new Date("2026-08-08T12:00:00.000Z")), "logs/character-consistency-benchmark-20260808T120000Z.json");
const zeroArgs = parseBenchmarkCliArgs(["--mode", "zero-shot", "--project", "project.json", "--character", "asset_ada", "--provider", "flux2_klein_4b", "--base-url", "http://127.0.0.1:8188", "--output", "out.json", "--workflow", "workflow.json", "--evaluator-module", "evaluator.mjs"]);
assert.equal(zeroArgs.generationMode, "zero_shot_multi_reference");
assert.equal(zeroArgs.workflowTokens.ACTIVE_LORA_NAME, undefined);
assert.equal(parseBenchmarkCliArgs(["--mode", "lora", "--character", "a", "--provider", "qwen_image_edit_2511", "--base-url", "http://127.0.0.1:8188", "--output", "x", "--workflow", "w"]).generationMode, "lora_augmented");
assert.throws(() => parseBenchmarkCliArgs(["--character", "a", "--provider", "qwen_image_edit_2511", "--base-url", "http://127.0.0.1:8188", "--output", "x", "--workflow", "w"]), (error) => error?.code === "EMODE");
assert.throws(() => parseBenchmarkCliArgs(["--mode", "lora", "--character", "a", "--provider", "flux2_klein_9b", "--base-url", "http://127.0.0.1:8188", "--output", "x", "--workflow", "w"]), (error) => error?.code === "EPROVIDER");
assert.throws(() => parseBenchmarkCliArgs(["--mode", "lora", "--character", "a", "--provider", "qwen_image_edit_2511", "--base-url", "ftp://host", "--output", "x", "--workflow", "w"]), (error) => error?.code === "EURL");

for (const shot of fixture.shots) {
  const routed = routeShotIdentityReferences(shot, routedManifest);
  assert.equal(routed.length, 2, `${shot.id} routes exactly two references`);
  assert.equal(Object.isFrozen(routed) && routed.every(Object.isFrozen), true, `${shot.id} routing is immutable`);
}
assert.equal(routeShotIdentityReferences(fixture.shots[0], routedManifest).some((item) => item.transform === "head_shoulders_crop"), true, "front uses a head/shoulders crop");
assert.equal(routeShotIdentityReferences(fixture.shots[6], routedManifest).some((item) => item.transform === "head_shoulders_crop"), true, "strong expression uses a head/shoulders crop");
assert.deepEqual(routeShotIdentityReferences(fixture.shots[4], routedManifest).map((item) => item.slot), ["body_back", "hair_back"], "back view uses back hair/body references");
assert.equal(routeShotIdentityReferences(fixture.shots[5], routedManifest).every((item) => item.slot.startsWith("body_")), true, "full-body action uses body references");
const mirroredRight = routeShotIdentityReferences(fixture.shots[3], routedManifest).find((item) => item.requestedSlot === "face_right");
assert.equal(mirroredRight.slot, "face_left"); assert.equal(mirroredRight.transform, "mirror_x", "the missing opposite profile is explicitly mirrored");
const changedByteManifest = clone(routedManifest); changedByteManifest[0].sourceSha256 = sha("8");
assert.notEqual(computeReferenceManifestDigest(fixture, changedByteManifest), computeReferenceManifestDigest(fixture, routedManifest), "source bytes are digest-bound");
const changedTransformFixture = clone(fixture); changedTransformFixture.shots[0].referencePolicy.transforms.face_master = "none";
assert.notEqual(computeReferenceManifestDigest(changedTransformFixture, routedManifest), computeReferenceManifestDigest(fixture, routedManifest), "reference transforms are digest-bound");

const zeroReferenceWorkflow = kleinWorkflow();
zeroReferenceWorkflow["2"].inputs.reference_a = "{{REFERENCE_IMAGE_A}}";
zeroReferenceWorkflow["2"].inputs.reference_b = "{{REFERENCE_IMAGE_B}}";
assert.throws(() => compileBenchmarkWorkflow({ generationMode: "zero_shot_multi_reference", provider: "flux2_klein_4b", fixture, workflow: kleinLoraWorkflow(), outputNode: "7", workflowTokens: { ACTIVE_LORA_NAME: "ada-v3.safetensors", ACTIVE_LORA_STRENGTH: 0.9, REFERENCE_IMAGE_A: "a.png", REFERENCE_IMAGE_B: "b.png" } }), (error) => error?.code === "EZERO_SHOT_LORA");
const customLoraProducer = clone(zeroReferenceWorkflow); customLoraProducer["25"] = { class_type: "CustomCharacterLoraLoader", inputs: { model: ["1", 0], lora_name: "hidden.safetensors" } }; customLoraProducer["3"].inputs.model = ["25", 0];
assert.throws(() => compileBenchmarkWorkflow({ generationMode: "zero_shot_multi_reference", provider: "flux2_klein_4b", fixture, workflow: customLoraProducer, outputNode: "6" }), (error) => error?.code === "EZERO_SHOT_MODEL_PATH", "zero-shot fails closed on unknown final MODEL producers");
const wrongZeroModelOutput = clone(zeroReferenceWorkflow); wrongZeroModelOutput["3"].inputs.model = ["1", 1]; assert.throws(() => compileBenchmarkWorkflow({ generationMode: "zero_shot_multi_reference", provider: "flux2_klein_4b", fixture, workflow: wrongZeroModelOutput, outputNode: "6" }), (error) => error?.code === "EZERO_SHOT_MODEL_PATH", "zero-shot rejects a wrong authoritative MODEL output index");
const brokenZeroModel = clone(zeroReferenceWorkflow); brokenZeroModel["3"].inputs.model = ["missing-model", 0]; assert.throws(() => compileBenchmarkWorkflow({ generationMode: "zero_shot_multi_reference", provider: "flux2_klein_4b", fixture, workflow: brokenZeroModel, outputNode: "6" }), (error) => error?.code === "EZERO_SHOT_MODEL_PATH", "zero-shot reports a stable code for a broken final MODEL link");
const cyclicZeroModel = clone(zeroReferenceWorkflow); cyclicZeroModel["25"] = { class_type: "ModelSamplingFlux", inputs: { model: ["25", 0] } }; cyclicZeroModel["3"].inputs.model = ["25", 0]; assert.throws(() => compileBenchmarkWorkflow({ generationMode: "zero_shot_multi_reference", provider: "flux2_klein_4b", fixture, workflow: cyclicZeroModel, outputNode: "6" }), (error) => error?.code === "EZERO_SHOT_MODEL_PATH", "zero-shot reports a stable code for a cyclic final MODEL path");
const referencePrepSource = await readFile(path.join(repoRoot, "scripts/prepare-character-reference.py"), "utf8");
assert.match(referencePrepSource, /ImageOps\.mirror/, "mirror_x uses Pillow's horizontal mirror");
assert.match(referencePrepSource, /0\.58/, "head_shoulders_crop takes the top 58 percent");
assert.match(referencePrepSource, /LANCZOS/, "reference resizing uses Lanczos");
assert.match(referencePrepSource, /8192/, "oversized reference dimensions are refused");
const officialKleinWorkflow = JSON.parse(await readFile(path.join(repoRoot, "examples/character-consistency-benchmark/workflows/flux2-klein-4b-reference-smoke-api.json"), "utf8"));
const officialKleinCompiled = compileBenchmarkWorkflow({ generationMode: "zero_shot_multi_reference", provider: "flux2_klein_4b", fixture, workflow: officialKleinWorkflow, outputNode: "19" });
assert.equal(officialKleinCompiled.providerProof.terminalOutputNode, "19", "updated Klein workflow keeps SaveImage node 19 terminal");
assert.equal(officialKleinCompiled.providerProof.authoritativeLoraBindings.length, 0); assert.equal(Object.values(officialKleinWorkflow).filter((node) => node.class_type === "ReferenceLatent").length, 4, "both references are chained on positive and negative conditioning");

const compiled = compileBenchmarkWorkflow({ provider: "qwen_image_edit_2511", fixture, workflow: qwenWorkflow(), workflowTokens: { CHARACTER_CONTEXT: { immutable: true } } });
const nativePrompt = compiled.compileShot(fixture.shots[0], "asset_ada");
assert.equal(nativePrompt["2"].inputs.seed, fixture.shots[0].seed, "exact token preserves native number");
assert.equal(nativePrompt["2"].inputs.yaw, 0, "zero token preserves native number");
assert.deepEqual(nativePrompt["2"].inputs.context, { immutable: true }, "exact token preserves native object");
assert.equal(compiled.providerProof.providerId, "qwen_image_edit_2511");
assert.equal(compiled.providerProof.terminalOutputNode, "3");
assert.deepEqual(proveTerminalProviderWorkflow("qwen_image_edit_2511", qwenWorkflow(), "3").ancestorNodeIds, ["1", "2", "3"], "Qwen proof binds model and encoder to the selected terminal");
assert.equal(proveTerminalProviderWorkflow("flux2_klein_4b", kleinWorkflow(), "6").ok, true, "Klein official distilled nodes and loader must be terminal ancestors");
const wrongKleinLoaderClass = kleinWorkflow();
wrongKleinLoaderClass["1"] = { class_type: "DiffusionModelLoader", inputs: { model_name: "flux-2-klein-4b-fp8.safetensors" } };
assert.throws(() => compileBenchmarkWorkflow({ provider: "flux2_klein_4b", fixture, workflow: wrongKleinLoaderClass, outputNode: "6" }), (error) => error?.code === "EPROVIDER_PROOF" && error.message === "missing_ancestry_model_binding:UNETLoader:unet_name:flux-2-klein-4b-fp8.safetensors", "benchmark proof requires the exact Klein UNET loader binding");
const kleinLoraProof = compileBenchmarkWorkflow({ provider: "flux2_klein_4b", fixture, workflow: kleinLoraWorkflow(), outputNode: "7", workflowTokens: { ACTIVE_LORA_NAME: "ada-v3.safetensors", ACTIVE_LORA_STRENGTH: 0.9 } }).providerProof;
assert.deepEqual(kleinLoraProof.authoritativeLoraBindings.map((binding) => binding.modelPathNodeIds), [["3", "4"]], "official Klein CFGGuider MODEL path records the approved model-only LoRA when SamplerCustomAdvanced has no model input");
const kleinLoraSidePath = kleinLoraWorkflow();
kleinLoraSidePath["4"].inputs.model = ["1", 0];
kleinLoraSidePath["8"] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "{{ACTIVE_LORA_NAME}}", strength_model: "{{ACTIVE_LORA_STRENGTH}}" } };
kleinLoraSidePath["4"].inputs.side = ["8", 0];
assert.throws(() => compileBenchmarkWorkflow({ provider: "flux2_klein_4b", fixture, workflow: kleinLoraSidePath, outputNode: "7", workflowTokens: { ACTIVE_LORA_NAME: "ada-v3.safetensors", ACTIVE_LORA_STRENGTH: 0.9 } }), (error) => error?.code === "EPROVIDER_PROOF" && error.message === "character_lora_binding_missing", "Klein side-input LoRA cannot satisfy its generation MODEL-path proof");
const kleinLoraDisconnected = kleinLoraWorkflow();
kleinLoraDisconnected["4"].inputs.model = ["1", 0];
kleinLoraDisconnected["8"] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "{{ACTIVE_LORA_NAME}}", strength_model: "{{ACTIVE_LORA_STRENGTH}}" } };
assert.throws(() => compileBenchmarkWorkflow({ provider: "flux2_klein_4b", fixture, workflow: kleinLoraDisconnected, outputNode: "7", workflowTokens: { ACTIVE_LORA_NAME: "ada-v3.safetensors", ACTIVE_LORA_STRENGTH: 0.9 } }), (error) => error?.code === "EPROVIDER_PROOF" && error.message === "character_lora_binding_missing", "disconnected Klein LoRA cannot satisfy its generation MODEL-path proof");
const kleinLoraConflict = kleinLoraWorkflow();
kleinLoraConflict["8"] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["3", 0], lora_name: "conflict.safetensors", strength_model: 0.9 } };
kleinLoraConflict["4"].inputs.model = ["8", 0];
assert.throws(() => compileBenchmarkWorkflow({ provider: "flux2_klein_4b", fixture, workflow: kleinLoraConflict, outputNode: "7", workflowTokens: { ACTIVE_LORA_NAME: "ada-v3.safetensors", ACTIVE_LORA_STRENGTH: 0.9 } }), (error) => error?.code === "EPROVIDER_PROOF" && error.message === "character_lora_binding_mismatch", "conflicting Klein CFGGuider MODEL-path LoRAs fail before a benchmark can run");
const kleinLoraWrongOutput = kleinLoraWorkflow();
kleinLoraWrongOutput["4"].inputs.model = ["3", 1];
assert.throws(() => compileBenchmarkWorkflow({ provider: "flux2_klein_4b", fixture, workflow: kleinLoraWrongOutput, outputNode: "7", workflowTokens: { ACTIVE_LORA_NAME: "ada-v3.safetensors", ACTIVE_LORA_STRENGTH: 0.9 } }), (error) => error?.code === "EPROVIDER_PROOF" && error.message === "character_lora_binding_missing", "non-MODEL Klein LoRA outputs fail benchmark proof");
const kleinBlendWorkflow = kleinLoraWorkflow();
kleinBlendWorkflow["4"].inputs.model = ["1", 0];
kleinBlendWorkflow["8"] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "{{ACTIVE_LORA_NAME}}", strength_model: "{{ACTIVE_LORA_STRENGTH}}" } };
kleinBlendWorkflow["9"] = { class_type: "KSampler", inputs: { model: ["8", 0], positive: ["2", 0] } };
kleinBlendWorkflow["10"] = { class_type: "ImageBlend", inputs: { image1: ["6", 0], image2: ["9", 0] } };
kleinBlendWorkflow["7"].inputs.images = ["10", 0];
assert.throws(
  () => compileBenchmarkWorkflow({ provider: "flux2_klein_4b", fixture, workflow: kleinBlendWorkflow, outputNode: "7", workflowTokens: { ACTIVE_LORA_NAME: "ada-v3.safetensors", ACTIVE_LORA_STRENGTH: 0.9 } }),
  (error) => error?.code === "EPROVIDER_PROOF" && error.message === "character_lora_binding_missing",
  "benchmark proof rejects a selected ImageBlend terminal when only its KSampler side path has the approved LoRA"
);
const legacyFluxGuidanceDecoy = {
  "1": { class_type: "UNETLoader", inputs: { unet_name: "flux-2-klein-4b-fp8.safetensors" } },
  "2": { class_type: "ReferenceLatent", inputs: { model: ["1", 0] } },
  "3": { class_type: "FluxGuidance", inputs: { conditioning: ["2", 0] } },
  "4": { class_type: "SaveImage", inputs: { images: ["3", 0] } }
};
assert.equal(proveTerminalProviderWorkflow("flux2_klein_4b", legacyFluxGuidanceDecoy, "4").reason, "missing_ancestry_node:CFGGuider", "legacy FluxGuidance alone must not prove the official distilled Klein workflow");
const disconnectedDecoy = qwenWorkflow(); disconnectedDecoy["2"].inputs.model = ["8", 0]; disconnectedDecoy["8"] = { class_type: "DiffusionModelLoader", inputs: { model_name: "flux-2-klein-4b-fp8.safetensors" } }; disconnectedDecoy["9"] = { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_edit_2511_bf16.safetensors" } };
assert.match(proveTerminalProviderWorkflow("qwen_image_edit_2511", disconnectedDecoy, "3").reason, /^missing_ancestry_model:/, "disconnected Qwen decoys cannot prove a Klein terminal");
const conflictingAncestry = qwenWorkflow(); conflictingAncestry["4"] = { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_edit_2509_bf16.safetensors" } }; conflictingAncestry["2"].inputs.extra_models = [["1", 0], ["4", 0]];
assert.match(proveTerminalProviderWorkflow("qwen_image_edit_2511", conflictingAncestry, "3").reason, /^conflicting_ancestry_model:/);
const unrelatedAuthoritativeLoader = qwenWorkflow(); unrelatedAuthoritativeLoader["4"] = { class_type: "UNETLoader", inputs: { unet_name: "sd_xl_base_1.0.safetensors" } }; unrelatedAuthoritativeLoader["2"].inputs.extra_model = ["4", 0];
assert.match(proveTerminalProviderWorkflow("qwen_image_edit_2511", unrelatedAuthoritativeLoader, "3").reason, /^conflicting_ancestry_model:/, "an SDXL authoritative loader on the terminal path cannot be ignored");
const cyclicGraph = qwenWorkflow(); cyclicGraph["2"].inputs.loop = ["2", 0]; assert.equal(proveTerminalProviderWorkflow("qwen_image_edit_2511", cyclicGraph, "3").reason, "link_cycle");
const missingGraph = qwenWorkflow(); missingGraph["3"].inputs.images = ["missing", 0]; assert.equal(proveTerminalProviderWorkflow("qwen_image_edit_2511", missingGraph, "3").reason, "missing_link");
assert.throws(() => compileBenchmarkWorkflow({ provider: "qwen_image_edit_2511", fixture, workflow: kleinWorkflow() }), (error) => error?.code === "EPROVIDER_PROOF");
const twoTerminalWorkflow = { ...qwenWorkflow(), "4": { class_type: "SaveImage", inputs: { images: ["2", 0] } } };
assert.equal(compileBenchmarkWorkflow({ provider: "qwen_image_edit_2511", fixture, workflow: twoTerminalWorkflow, outputNode: "3", workflowTokens: { CHARACTER_CONTEXT: {} } }).providerProof.terminalOutputNode, "3", "explicit output-node selects and proves that terminal");
assert.throws(() => compileBenchmarkWorkflow({ provider: "qwen_image_edit_2511", fixture, workflow: twoTerminalWorkflow, workflowTokens: { CHARACTER_CONTEXT: {} } }), (error) => error?.code === "EOUTPUT_NODE" && error.message === "terminal_ambiguous");
assert.throws(() => compileBenchmarkWorkflow({ provider: "qwen_image_edit_2511", fixture, workflow: twoTerminalWorkflow, outputNode: "2", workflowTokens: { CHARACTER_CONTEXT: {} } }), (error) => error?.code === "EOUTPUT_NODE" && error.message === "terminal_invalid");
const disconnectedTerminalWorkflow = { ...qwenWorkflow(), "4": { class_type: "SaveImage", inputs: { filename_prefix: "disconnected" } } };
assert.throws(() => compileBenchmarkWorkflow({ provider: "qwen_image_edit_2511", fixture, workflow: disconnectedTerminalWorkflow, outputNode: "4", workflowTokens: { CHARACTER_CONTEXT: {} } }), (error) => error?.code === "EPROVIDER_PROOF");
const unknownTokenWorkflow = qwenWorkflow();
unknownTokenWorkflow["2"].inputs.text = "{{UNKNOWN}}";
assert.throws(() => compileBenchmarkWorkflow({ provider: "qwen_image_edit_2511", fixture, workflow: unknownTokenWorkflow }), (error) => error?.code === "ETOKEN");

function makeTransport(provider, { history = null, onPrompt, serial, image = {}, outputNode = terminalFor(provider) } = {}) {
  let promptNumber = 0;
  const nodes = provider === "flux2_klein_4b" ? { ReferenceLatent: { model: "flux-2-klein-4b-fp8.safetensors" }, CFGGuider: {}, Flux2Scheduler: {} } : { TextEncodeQwenImageEdit: { model: "qwen_image_edit_2511_bf16.safetensors" } };
  return {
    async getBytes(url, options) { assert.match(url, /\/view\?/); assert.ok(options?.signal, "output download receives abort signal"); return Buffer.from(`generated:${url}`); },
    async postJson(url, body, options) { assert.match(url, /\/prompt$/); assert.ok(options?.signal, "prompt receives abort signal"); serial && (serial.active += 1, serial.maxActive = Math.max(serial.maxActive, serial.active), serial.order.push(body.prompt["2"]?.inputs?.seed ?? body.prompt["3"]?.inputs?.seed)); onPrompt?.(body); promptNumber += 1; await Promise.resolve(); serial && (serial.active -= 1); return { prompt_id: `prompt-${promptNumber}` }; },
    async getJson(url, options) {
      assert.ok(options?.signal, "preflight/history receives abort signal");
      if (url.endsWith("/system_stats")) return { devices: ["RTX 5070 Ti"] };
      if (url.endsWith("/object_info")) return nodes;
      const promptId = url.split("/").at(-1);
      return history?.(promptId) ?? { [promptId]: { outputs: { [outputNode]: { images: [{ filename: image.filename ?? `${promptId}.png`, subfolder: image.subfolder ?? "benchmark", type: image.type ?? "output" }] } }, status: { status_str: "success", completed: true, messages: [] } } };
    }
  };
}
const testClock = () => { let now = 0; return { now: () => (now += 10), sleep: async () => undefined }; };
const evaluator = ({ providerProof, output }) => ({ status: "accepted", provenance: "model_generation", actualProvider: providerProof.providerId, score: 0.93, dimensionScores: dimensions, references: [output], bestPreview: output, retries: 1 });

let queuedPrompt;
const executor = createComfyExecutor({ compiledWorkflow: compiled, transport: makeTransport("qwen_image_edit_2511", { onPrompt: (body) => { queuedPrompt = body.prompt; } }), clock: testClock(), evaluateShot: evaluator, pollAttempts: 1 });
const direct = await executor({ shot: fixture.shots[0], character: "asset_ada", baseUrl: "http://127.0.0.1:8188" });
assert.equal(direct.status, "accepted");
assert.equal(direct.output.includes("filename=prompt-1.png"), true, "history output is selected only from proven terminal node");
assert.equal(queuedPrompt["2"].inputs.seed, fixture.shots[0].seed, "real executor queues native prompt values");
await assert.rejects(createComfyExecutor({ compiledWorkflow: compiled, transport: makeTransport("qwen_image_edit_2511", { history: (id) => ({ [id]: { status: { status_str: "error", completed: false, messages: [["execution_error", { message: "token=secret" }]] }, outputs: {} } }) }), clock: testClock(), evaluateShot: evaluator, pollAttempts: 1 })({ shot: fixture.shots[0], character: "asset", baseUrl: "http://127.0.0.1:8188" }), (error) => error?.code === "EEXECUTION");
await assert.rejects(createComfyExecutor({ compiledWorkflow: compiled, transport: makeTransport("qwen_image_edit_2511", { history: (id) => ({ [id]: { status: { status_str: "success", completed: true, messages: [] }, outputs: {} } }) }), clock: testClock(), evaluateShot: evaluator, pollAttempts: 1 })({ shot: fixture.shots[0], character: "asset", baseUrl: "http://127.0.0.1:8188" }), (error) => error?.code === "EOUTPUT", "completed history without the proven terminal output fails immediately");
let pendingPolls = 0;
const pendingSuccess = await createComfyExecutor({ compiledWorkflow: compiled, transport: makeTransport("qwen_image_edit_2511", { history: (id) => { pendingPolls += 1; return pendingPolls < 3 ? { [id]: { status: { status_str: "running", completed: false, messages: [] }, outputs: {} } } : undefined; } }), clock: testClock(), evaluateShot: evaluator, pollAttempts: 3 })({ shot: fixture.shots[0], character: "asset", baseUrl: "http://127.0.0.1:8188" });
assert.equal(pendingSuccess.status, "accepted"); assert.equal(pendingPolls, 3, "pending history states continue polling until terminal success");
let pendingErrorPolls = 0;
await assert.rejects(createComfyExecutor({ compiledWorkflow: compiled, transport: makeTransport("qwen_image_edit_2511", { history: (id) => { pendingErrorPolls += 1; return pendingErrorPolls === 1 ? { [id]: { status: { status_str: "queued", completed: false }, outputs: {} } } : { [id]: { status: { status_str: "failed", completed: false, messages: ["terminal error"] }, outputs: {} } }; } }), clock: testClock(), evaluateShot: evaluator, pollAttempts: 3 })({ shot: fixture.shots[0], character: "asset", baseUrl: "http://127.0.0.1:8188" }), (error) => error?.code === "EEXECUTION", "pending then explicit terminal error stops immediately");

let timeoutSignal;
await assert.rejects(createFetchTransport(async (_url, init) => new Promise((_, reject) => { timeoutSignal = init.signal; init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }); }), { requestTimeoutMs: 10 }).getJson("http://fake/system_stats"), (error) => error?.code === "ETIMEOUT", "request deadline prevents hanging fetch");
assert.equal(timeoutSignal.aborted, true, "timeout aborts the exact signal passed to fetch");
let bodyTimeoutSignal;
await assert.rejects(createFetchTransport(async (_url, init) => ({ ok: true, json: () => new Promise((_, reject) => { bodyTimeoutSignal = init.signal; init.signal.addEventListener("abort", () => reject(Object.assign(new Error("body aborted"), { name: "AbortError" })), { once: true }); }) }), { requestTimeoutMs: 10 }).getJson("http://fake/body"), (error) => error?.code === "ETIMEOUT", "deadline remains active through response.json");
assert.equal(bodyTimeoutSignal.aborted, true, "body parser receives the timeout-aborted fetch signal");
const bodyParent = new AbortController(); let bodyParentSignal;
const parentAbortPromise = createFetchTransport(async (_url, init) => ({ ok: true, json: () => new Promise((_, reject) => { bodyParentSignal = init.signal; init.signal.addEventListener("abort", () => reject(Object.assign(new Error("body parent abort"), { name: "AbortError" })), { once: true }); }) }), { requestTimeoutMs: 1_000 }).getJson("http://fake/body", { signal: bodyParent.signal });
setTimeout(() => bodyParent.abort("user cancelled"), 1);
await assert.rejects(parentAbortPromise, (error) => error?.code === "ECANCELLED"); assert.equal(bodyParentSignal.aborted, true, "parent abort reaches stalled response body signal");
const listenerTracker = { aborted: false, reason: undefined, added: 0, removed: 0, addEventListener(_type, listener) { this.added += 1; this.listener = listener; }, removeEventListener() { this.removed += 1; } };
await createFetchTransport(async () => ({ ok: true, json: async () => ({ ok: true }) })).getJson("http://fake/cleanup", { signal: listenerTracker });
assert.equal(listenerTracker.added, 1); assert.equal(listenerTracker.removed, 1, "request listener is removed after body completion");
await assert.rejects(createFetchTransport(async () => ({ ok: false, status: 503, json: async () => ({}) })).getJson("http://fake/system_stats"), (error) => error?.code === "EHTTP");
await assert.rejects(createFetchTransport(async () => { throw new Error("dns unavailable"); }).getJson("http://fake/system_stats"), (error) => error?.code === "EOFFLINE");
const cancelled = new AbortController(); cancelled.abort(Object.assign(new Error("cancelled"), { code: "ECANCELLED" }));
await assert.rejects(createFetchTransport(async () => new Promise(() => {})).getJson("http://fake/system_stats", { signal: cancelled.signal }), (error) => error?.code === "ECANCELLED");

const tempRoot = await mkdtemp(path.join(tmpdir(), "character-benchmark-"));
const prepRoot = path.join(tempRoot, "reference-prep"); await mkdir(prepRoot, { recursive: true });
const prepManifest = routedManifest.map((item, index) => ({ ...item, sourcePath: path.join(prepRoot, `${index}.png`) }));
for (const [index, item] of prepManifest.entries()) await writeFile(item.sourcePath, Buffer.from(`source-${index}`));
const comfyPython = path.join(process.env.LOCALAPPDATA ?? "", "Comfy-Desktop", "ComfyUI-Installs", "ComfyUI", "ComfyUI", ".venv", "Scripts", "python.exe"); await access(comfyPython);
const fakePng = path.join(prepRoot, "fake-extension.png"); await writeFile(fakePng, Buffer.concat([Buffer.from("P6\n1 1\n255\n"), Buffer.from([255, 0, 0])]));
const fakePngResult = await runChild(comfyPython, [path.join(repoRoot, "scripts/prepare-character-reference.py"), "--input", fakePng, "--output", path.join(prepRoot, "fake-output.png"), "--transform", "none"]);
assert.notEqual(fakePngResult.code, 0, "Pillow prep rejects PPM content hidden behind a .png extension"); assert.match(fakePngResult.stderr, /unsupported reference image format/i);
const oversizedPng = path.join(prepRoot, "oversized.png"); const oversizedFixture = await runChild(comfyPython, ["-c", "from PIL import Image; import sys; Image.new('RGB',(8193,1),'black').save(sys.argv[1])", oversizedPng]); assert.equal(oversizedFixture.code, 0, oversizedFixture.stderr);
const oversizedResult = await runChild(comfyPython, [path.join(repoRoot, "scripts/prepare-character-reference.py"), "--input", oversizedPng, "--output", path.join(prepRoot, "oversized-output.png"), "--transform", "none"]);
assert.notEqual(oversizedResult.code, 0); assert.match(oversizedResult.stderr, /exceeds 8192x8192/i, "dimension limit is checked before pixel load");
const prepOrder = [];
const prepared = await prepareShotIdentityReferences({ shot: fixture.shots[0], identityReferenceManifest: prepManifest, baseUrl: "http://127.0.0.1:8188", stagingRoot: prepRoot }, {
  transformReference: async ({ inputPath, outputPath, transform }) => { prepOrder.push(`transform:${path.basename(inputPath)}:${transform}`); await writeFile(outputPath, Buffer.from(`${await readFile(inputPath, "utf8")}:${transform}`)); },
  uploadReference: async ({ endpoint, filename, subfolder, overwrite }) => { prepOrder.push(`upload:${filename}`); assert.equal(endpoint, "http://127.0.0.1:8188/upload/image"); assert.equal(subfolder, "character-benchmark"); assert.equal(overwrite, false); return { name: filename, subfolder, type: "input" }; }
});
assert.equal(prepared.references.length, 2); assert.match(prepared.workflowTokens.REFERENCE_IMAGE_A, /^character-benchmark\/[a-f0-9]{64}\.png$/); assert.match(prepared.workflowTokens.REFERENCE_IMAGE_B, /^character-benchmark\/[a-f0-9]{64}\.png$/);
assert.deepEqual(prepOrder.map((item) => item.split(":")[0]), ["transform", "upload", "transform", "upload"], "transform/upload is serial for exactly two references");
for (const [label, response] of [["missing fields", {}], ["renamed", { name: "renamed.png", subfolder: "character-benchmark", type: "input" }], ["wrong subfolder", { name: "placeholder", subfolder: "other", type: "input" }], ["wrong type", { name: "placeholder", subfolder: "character-benchmark", type: "output" }]]) {
  await assert.rejects(prepareShotIdentityReferences({ shot: fixture.shots[0], identityReferenceManifest: prepManifest, baseUrl: "http://127.0.0.1:8188", stagingRoot: prepRoot }, { transformReference: async ({ inputPath, outputPath }) => writeFile(outputPath, await readFile(inputPath)), uploadReference: async ({ filename }) => ({ ...response, ...(response.name === "placeholder" ? { name: filename } : {}) }) }), (error) => error?.code === "EREFERENCE_UPLOAD", `${label} upload response fails before prompt compilation`);
}
let failedPromptCalls = 0;
const failedPrep = await runCharacterConsistencyBenchmark({ generationMode: "zero_shot_multi_reference", character: "asset_ada", provider: "flux2_klein_4b", baseUrl: "http://127.0.0.1:8188", outputPath: path.join(tempRoot, "failed-reference-upload.json"), fixture, workflow: zeroReferenceWorkflow, outputNode: "6", identityReferenceManifest: prepManifest, subject: { characterAssetId: "asset_ada", provider: "flux2_klein_4b", identityPackVersion: "identity-v3", modelName: "flux-2-klein-4b-fp8.safetensors" } }, {
  transport: { ...makeTransport("flux2_klein_4b"), async postJson(...args) { failedPromptCalls += 1; return makeTransport("flux2_klein_4b").postJson(...args); } }, preflight: async () => ({ status: "ready", available: true }), evaluateShot: evaluator, evaluatorProof: programmaticEvaluatorProof, clock: testClock(), randomId: () => "fixed",
  transformReference: async ({ inputPath, outputPath }) => writeFile(outputPath, await readFile(inputPath)), uploadReference: async () => { throw Object.assign(new Error("upload denied"), { code: "EREFERENCE_UPLOAD" }); }
});
assert.equal(failedPromptCalls, 0, "failed reference upload stops before /prompt"); assert.equal(failedPrep.report.evidenceEligible, false, "failed preprocessing cannot issue evidence");
let renamedUploadPromptCalls = 0; const renamedUploadRun = await runCharacterConsistencyBenchmark({ generationMode: "zero_shot_multi_reference", character: "asset_ada", provider: "flux2_klein_4b", baseUrl: "http://127.0.0.1:8188", outputPath: path.join(tempRoot, "renamed-reference-upload.json"), fixture, workflow: zeroReferenceWorkflow, outputNode: "6", identityReferenceManifest: prepManifest, subject: { characterAssetId: "asset_ada", provider: "flux2_klein_4b", identityPackVersion: "identity-v3", modelName: "flux-2-klein-4b-fp8.safetensors" } }, { transport: { ...makeTransport("flux2_klein_4b"), async postJson(...args) { renamedUploadPromptCalls += 1; return makeTransport("flux2_klein_4b").postJson(...args); } }, preflight: async () => ({ status: "ready", available: true }), evaluateShot: evaluator, evaluatorProof: programmaticEvaluatorProof, clock: testClock(), randomId: () => "fixed", transformReference: async ({ inputPath, outputPath }) => writeFile(outputPath, await readFile(inputPath)), uploadReference: async ({ subfolder }) => ({ name: "renamed.png", subfolder, type: "input" }) }); assert.equal(renamedUploadPromptCalls, 0, "renamed upload response fails before /prompt"); assert.equal(renamedUploadRun.report.evidenceEligible, false);
const zeroEvidence = await runCharacterConsistencyBenchmark({ generationMode: "zero_shot_multi_reference", character: "asset_ada", provider: "flux2_klein_4b", baseUrl: "http://127.0.0.1:8188", outputPath: path.join(tempRoot, "zero-evidence.json"), fixture, workflow: zeroReferenceWorkflow, outputNode: "6", identityReferenceManifest: prepManifest, subject: { characterAssetId: "asset_ada", provider: "flux2_klein_4b", identityPackVersion: "identity-v3", modelName: "flux-2-klein-4b-fp8.safetensors" } }, {
  transport: makeTransport("flux2_klein_4b"), preflight: async () => ({ status: "ready", available: true }), evaluateShot: evaluator, evaluatorProof: programmaticEvaluatorProof, clock: testClock(), randomId: () => "fixed",
  transformReference: async ({ inputPath, outputPath, transform }) => writeFile(outputPath, Buffer.concat([await readFile(inputPath), Buffer.from(transform)])), uploadReference: async ({ filename, subfolder }) => ({ name: filename, subfolder, type: "input" })
});
assert.equal(zeroEvidence.report.generationMode, "zero_shot_multi_reference"); assert.equal(zeroEvidence.report.preflight.providerProof.authoritativeLoraBindings.length, 0);
assert.equal(zeroEvidence.report.references.length, 16, "the strict evidence envelope records both consumed routes for every shot"); assert.equal(zeroEvidence.report.referenceManifest.some((item) => Object.hasOwn(item, "sourcePath")), false, "published manifest omits absolute paths");
assert.equal(zeroEvidence.report.evidenceEligible, true, JSON.stringify(zeroEvidence.report)); assert.equal(validateCharacterBenchmarkEvidence(zeroEvidence.report).valid, true, "mode-aware zero-shot report validates as evidence");
const leakedWindowsPath = "C:\\Users\\secret\\reference.png"; const leakedPosixPath = "/home/secret/reference.png"; const diagnosticOutput = path.join(tempRoot, "transform-diagnostic.json");
await runCharacterConsistencyBenchmark({ generationMode: "zero_shot_multi_reference", character: "asset_ada", provider: "flux2_klein_4b", baseUrl: "http://127.0.0.1:8188", outputPath: diagnosticOutput, fixture, workflow: zeroReferenceWorkflow, outputNode: "6", identityReferenceManifest: prepManifest, subject: { characterAssetId: "asset_ada", provider: "flux2_klein_4b", identityPackVersion: "identity-v3", modelName: "flux-2-klein-4b-fp8.safetensors" } }, { transport: makeTransport("flux2_klein_4b"), preflight: async () => ({ status: "ready", available: true }), evaluateShot: evaluator, evaluatorProof: programmaticEvaluatorProof, clock: testClock(), randomId: () => "fixed", transformReference: async () => { throw new Error(`failed ${leakedWindowsPath} ${leakedPosixPath} \\\\server\\share\\secret.png`); }, uploadReference: async ({ filename, subfolder }) => ({ name: filename, subfolder, type: "input" }) });
const diagnosticBytes = await readFile(diagnosticOutput, "utf8"); assert.equal(diagnosticBytes.includes(leakedWindowsPath), false); assert.equal(diagnosticBytes.includes(leakedPosixPath), false); assert.equal(diagnosticBytes.includes("server\\\\share"), false, "published diagnostics redact UNC paths");
let killedChild = false; let childExited = false; const fakeChild = new EventEmitter(); fakeChild.stderr = new EventEmitter(); fakeChild.kill = () => { killedChild = true; queueMicrotask(() => { childExited = true; fakeChild.emit("close", null, "SIGTERM"); }); return true; };
const transformAbort = new AbortController(); const cancelledTransform = transformReferenceWithPython({ inputPath: prepManifest[0].sourcePath, outputPath: path.join(prepRoot, "cancelled.png"), transform: "none", signal: transformAbort.signal }, { resolvePython: async () => comfyPython, spawnImpl: () => fakeChild }); transformAbort.abort(Object.assign(new Error("cancelled"), { code: "ECANCELLED" }));
await assert.rejects(cancelledTransform, (error) => error?.code === "ECANCELLED"); assert.equal(killedChild && childExited, true, "aborted default transformer terminates and reaps its child process");
let timedOutChild = false; const fakeTimedOutChild = new EventEmitter(); fakeTimedOutChild.stderr = new EventEmitter(); fakeTimedOutChild.kill = () => { timedOutChild = true; queueMicrotask(() => fakeTimedOutChild.emit("close", null, "SIGTERM")); return true; }; const transformTimeout = new AbortController(); const timedOutTransform = transformReferenceWithPython({ inputPath: prepManifest[0].sourcePath, outputPath: path.join(prepRoot, "timed-out.png"), transform: "none", signal: transformTimeout.signal }, { resolvePython: async () => comfyPython, spawnImpl: () => fakeTimedOutChild }); transformTimeout.abort(Object.assign(new Error("deadline"), { code: "ETIMEOUT" })); await assert.rejects(timedOutTransform, (error) => error?.code === "ETIMEOUT"); assert.equal(timedOutChild, true, "timed-out transformer terminates its child process");
const stagingBeforeCancellation = (await readdir(prepRoot)).sort(); await assert.rejects(prepareShotIdentityReferences({ shot: fixture.shots[0], identityReferenceManifest: prepManifest, baseUrl: "http://127.0.0.1:8188", stagingRoot: prepRoot }, { transformReference: async () => { throw Object.assign(new Error("cancelled"), { code: "ECANCELLED" }); }, uploadReference: async ({ filename, subfolder }) => ({ name: filename, subfolder, type: "input" }) }), (error) => error?.code === "ECANCELLED"); assert.deepEqual((await readdir(prepRoot)).sort(), stagingBeforeCancellation, "cancelled preprocessing removes its exclusively owned staging directory");
const run = (name, provider = "qwen_image_edit_2511", evaluateShot = evaluator, extra = {}) => runCharacterConsistencyBenchmark({ generationMode: "lora_augmented", character: "asset_ada", provider, baseUrl: "http://127.0.0.1:8188", outputPath: path.join(tempRoot, `${name}.json`), fixture, workflow: provider === "flux2_klein_4b" ? kleinLoraWorkflow() : qwenLoraWorkflow(), workflowTokens: loraTokens, ...extra }, { transport: makeTransport(provider, { outputNode: provider === "flux2_klein_4b" ? "7" : "3" }), clock: testClock(), evaluateShot, evaluatorProof: evaluateShot ? programmaticEvaluatorProof : undefined, requestTimeoutMs: 100, overallTimeoutMs: 1_000, randomId: () => "fixed" });
try {
  const setupFailure = await runCharacterConsistencyBenchmark({ generationMode: "lora_augmented", character: "asset_ada", provider: "qwen_image_edit_2511", baseUrl: "http://127.0.0.1:8188", outputPath: path.join(tempRoot, "setup-failure.json"), fixture, workflowJson: "{not-json", workflowTokens: loraTokens }, { transport: makeTransport("qwen_image_edit_2511"), clock: testClock(), randomId: () => "fixed" });
  assert.equal(setupFailure.exitCode, 1); assert.equal(setupFailure.report.preflight.status, "failed", "workflow setup failures safely publish a report before network activity");
  let unqualifiedProofNetworkCalls = 0; const unqualifiedProof = await runCharacterConsistencyBenchmark({ generationMode: "lora_augmented", character: "asset_ada", provider: "qwen_image_edit_2511", baseUrl: "http://127.0.0.1:8188", outputPath: path.join(tempRoot, "unqualified-evaluator-proof.json"), fixture, workflow: qwenLoraWorkflow(), workflowTokens: loraTokens }, { transport: { async getJson() { unqualifiedProofNetworkCalls += 1; return {}; }, async postJson() { unqualifiedProofNetworkCalls += 1; return {}; } }, evaluateShot: evaluator, evaluatorProof: { ...programmaticEvaluatorProof, version: "programmatic" }, clock: testClock(), randomId: () => "fixed" }); assert.equal(unqualifiedProof.report.preflight.status, "failed"); assert.equal(unqualifiedProof.report.evidenceEligible, false); assert.equal(unqualifiedProofNetworkCalls, 0, "reserved evaluator versions cannot run or sign a programmatic envelope");
  const explicitCliOutput = path.join(tempRoot, "explicit-output-node.json");
  const explicitCli = parseBenchmarkCliArgs(["--mode", "lora", "--character", "asset_ada", "--provider", "qwen_image_edit_2511", "--base-url", "http://127.0.0.1:8188", "--output", explicitCliOutput, "--workflow", "two-terminal.json", "--output-node", "3"]);
  assert.equal(explicitCli.outputNode, "3", "CLI preserves explicit output-node into run options");
  const explicitLoraWorkflow = clone(twoTerminalWorkflow); explicitLoraWorkflow["5"] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "{{ACTIVE_LORA_NAME}}", strength_model: "{{ACTIVE_LORA_STRENGTH}}" } }; explicitLoraWorkflow["2"].inputs.model = ["5", 0];
  const explicitRun = await runCharacterConsistencyBenchmark({ ...explicitCli, fixture, workflow: explicitLoraWorkflow, workflowTokens: { CHARACTER_CONTEXT: {}, ACTIVE_LORA_NAME: "ada-v3.safetensors", ACTIVE_LORA_STRENGTH: 0.9 } }, { transport: makeTransport("qwen_image_edit_2511"), clock: testClock(), evaluateShot: evaluator, evaluatorProof: programmaticEvaluatorProof, randomId: () => "fixed" });
  assert.equal(explicitRun.exitCode, 0); assert.equal(explicitRun.report.preflight.providerProof.terminalOutputNode, "3");
  let disconnectedNetworkCalls = 0;
  const disconnectedRun = await runCharacterConsistencyBenchmark({ ...explicitCli, outputPath: path.join(tempRoot, "disconnected-output-node.json"), outputNode: "4", fixture, workflow: disconnectedTerminalWorkflow, workflowTokens: { CHARACTER_CONTEXT: {}, ACTIVE_LORA_NAME: "ada-v3.safetensors", ACTIVE_LORA_STRENGTH: 0.9 } }, { transport: { async getJson() { disconnectedNetworkCalls += 1; return {}; }, async postJson() { disconnectedNetworkCalls += 1; return {}; } }, clock: testClock(), randomId: () => "fixed" });
  assert.equal(disconnectedRun.exitCode, 1); assert.equal(disconnectedRun.report.preflight.status, "failed"); assert.equal(disconnectedNetworkCalls, 0, "selected terminal proof rejects disconnected output before network activity");
  const thrownPreflightPath = path.join(tempRoot, "thrown-preflight.json");
  const throwCounters = { get: 0, post: 0 };
  const circularPreflightError = Object.assign(new Error("preflight token=supersecret https://secret.example"), { code: "EPREFLIGHT_TEST" }); circularPreflightError.context = { self: circularPreflightError };
  const throwingPreflight = await runCharacterConsistencyBenchmark({ generationMode: "lora_augmented", character: "asset_ada", provider: "qwen_image_edit_2511", baseUrl: "http://127.0.0.1:8188", outputPath: thrownPreflightPath, fixture, workflow: qwenLoraWorkflow(), workflowTokens: loraTokens }, {
    transport: { async getJson() { throwCounters.get += 1; throw new Error("unexpected network"); }, async postJson() { throwCounters.post += 1; throw new Error("unexpected executor"); } },
    preflight: async () => { throw circularPreflightError; }, evaluateShot: evaluator, evaluatorProof: programmaticEvaluatorProof, clock: testClock(), randomId: () => "fixed"
  });
  assert.equal(throwingPreflight.exitCode, 1); assert.equal(throwCounters.get + throwCounters.post, 0, "throwing preflight runs before any transport/executor call");
  assert.equal(throwingPreflight.report.preflight.status, "failed"); assert.equal(throwingPreflight.report.shots.every((shot) => shot.finalStatus === "cancelled"), true);
  const thrownPreflightBytes = await readFile(thrownPreflightPath, "utf8"); const thrownPreflightReport = JSON.parse(thrownPreflightBytes);
  assert.equal(thrownPreflightReport.preflight.status, "failed"); assert.match(thrownPreflightReport.preflight.diagnostics[0], /^EPREFLIGHT_TEST:/); assert.equal(thrownPreflightBytes.includes("supersecret"), false, "preflight secrets are redacted before exclusive report publication");
  await assert.rejects(runCharacterConsistencyBenchmark({ generationMode: "lora_augmented", character: "asset_ada", provider: "qwen_image_edit_2511", baseUrl: "http://127.0.0.1:8188", outputPath: thrownPreflightPath, fixture, workflow: qwenLoraWorkflow(), workflowTokens: loraTokens }, { preflight: async () => { throw circularPreflightError; } }), (error) => error?.code === "EOUTPUT_EXISTS");
  assert.equal(await readFile(thrownPreflightPath, "utf8"), thrownPreflightBytes, "existing failed preflight report is byte-preserved");
  const invalidTransportPath = path.join(tempRoot, "invalid-transport-shape.json"); let invalidTransportExecuted = false;
  const invalidTransport = await runCharacterConsistencyBenchmark({ generationMode: "lora_augmented", character: "asset_ada", provider: "qwen_image_edit_2511", baseUrl: "http://127.0.0.1:8188", outputPath: invalidTransportPath, fixture, workflow: qwenLoraWorkflow(), workflowTokens: loraTokens }, {
    transport: { getJson: "not-a-function", postJson: null }, evaluateShot: async () => { invalidTransportExecuted = true; return evaluator({ providerProof: { providerId: "qwen_image_edit_2511" } }); }, evaluatorProof: programmaticEvaluatorProof, clock: testClock(), randomId: () => "fixed"
  });
  assert.equal(invalidTransport.exitCode, 1); assert.equal(invalidTransportExecuted, false, "invalid transport prevents shot executor construction"); assert.equal(invalidTransport.report.preflight.status, "failed"); assert.equal(invalidTransport.report.shots.every((shot) => shot.finalStatus === "cancelled"), true);
  const invalidTransportBytes = await readFile(invalidTransportPath, "utf8"); const invalidTransportReport = JSON.parse(invalidTransportBytes);
  assert.equal(invalidTransportReport.preflight.status, "failed"); assert.match(invalidTransportReport.preflight.diagnostics[0], /^ETRANSPORT:/); assert.equal(invalidTransportBytes.includes("not-a-function"), false, "invalid transport report is sanitized");
  await assert.rejects(runCharacterConsistencyBenchmark({ generationMode: "lora_augmented", character: "asset_ada", provider: "qwen_image_edit_2511", baseUrl: "http://127.0.0.1:8188", outputPath: invalidTransportPath, fixture, workflow: qwenLoraWorkflow(), workflowTokens: loraTokens }, { transport: { getJson: "not-a-function", postJson: null } }), (error) => error?.code === "EOUTPUT_EXISTS");
  assert.equal(await readFile(invalidTransportPath, "utf8"), invalidTransportBytes, "existing invalid-transport report is byte-preserved");
  const preCancelled = new AbortController(); preCancelled.abort(Object.assign(new Error("user cancelled"), { code: "ECANCELLED" }));
  const cancelledRun = await runCharacterConsistencyBenchmark({ generationMode: "lora_augmented", character: "asset_ada", provider: "qwen_image_edit_2511", baseUrl: "http://127.0.0.1:8188", outputPath: path.join(tempRoot, "cancelled.json"), fixture, workflow: qwenLoraWorkflow(), workflowTokens: loraTokens }, { transport: makeTransport("qwen_image_edit_2511"), evaluateShot: evaluator, evaluatorProof: programmaticEvaluatorProof, clock: testClock(), signal: preCancelled.signal, randomId: () => "fixed" });
  assert.equal(cancelledRun.report.preflight.status, "cancelled"); assert.equal(cancelledRun.report.aggregate.status, "cancelled");
  const accepted = await run("accepted"); assert.equal(accepted.exitCode, 0, JSON.stringify(accepted.report)); assert.equal(accepted.report.aggregate.accepted, 8); assert.equal(accepted.report.preflight.providerProof.providerId, "qwen_image_edit_2511");
  const artifact = "http://127.0.0.1:8188/view?filename=prompt-1.png&subfolder=benchmark&type=output";
  assert.equal(accepted.report.shots[0].output, artifact, "terminal artifact URL is retained exactly after allowlist sanitization");
  assert.equal(accepted.report.shots[0].bestPreview, artifact); assert.deepEqual(accepted.report.shots[0].references, [artifact]);
  const serial = { active: 0, maxActive: 0, order: [] };
  const serialRun = await runCharacterConsistencyBenchmark({ generationMode: "lora_augmented", character: "asset_ada", provider: "qwen_image_edit_2511", baseUrl: "http://127.0.0.1:8188", outputPath: path.join(tempRoot, "serial.json"), fixture, workflow: qwenLoraWorkflow(), workflowTokens: loraTokens }, { transport: makeTransport("qwen_image_edit_2511", { serial }), clock: testClock(), evaluateShot: evaluator, evaluatorProof: programmaticEvaluatorProof, randomId: () => "fixed" });
  assert.equal(serialRun.exitCode, 0); assert.equal(serial.maxActive, 1, "real executor only queues one prompt at a time"); assert.deepEqual(serial.order, fixture.shots.map((shot) => shot.seed), "real executor queues declared shots in order");
  const unsafeArtifacts = await run("unsafe-artifacts", "qwen_image_edit_2511", (input) => ({ ...evaluator(input), references: ["https://attacker.example/view?filename=x", input.output], bestPreview: "file:///secret.png" }));
  assert.deepEqual(unsafeArtifacts.report.shots[0].references, [artifact]); assert.equal(unsafeArtifacts.report.shots[0].bestPreview, null, "external/file artifacts are rejected rather than diagnostic-redacted");
  for (const [name, image] of [["terminal-input", { type: "input" }], ["terminal-temp", { type: "temp" }], ["terminal-traversal", { filename: "../escape.png" }], ["terminal-absolute", { filename: "C:/escape.png" }]]) {
    const unsafeTerminal = await runCharacterConsistencyBenchmark({ generationMode: "lora_augmented", character: "asset_ada", provider: "qwen_image_edit_2511", baseUrl: "http://127.0.0.1:8188", outputPath: path.join(tempRoot, `${name}.json`), fixture, workflow: qwenLoraWorkflow(), workflowTokens: loraTokens }, { transport: makeTransport("qwen_image_edit_2511", { image }), clock: testClock(), evaluateShot: evaluator, evaluatorProof: programmaticEvaluatorProof, randomId: () => "fixed" });
    assert.equal(unsafeTerminal.report.shots[0].finalStatus, "needs_review", `${name} cannot become an accepted terminal output`);
  }
  const klein = await run("klein", "flux2_klein_4b"); assert.equal(klein.exitCode, 0, "Klein 4B receives the same strict provider/endpoint preflight");
  for (const [name, altered] of [["no-provenance", { provenance: undefined }], ["bad-score", { score: 0.1 }], ["missing-dimension", { dimensionScores: { face: 0.9 } }], ["mismatch", { actualProvider: "flux2_klein_4b" }], ["cutout", { isCutout: true }]]) { const result = await run(name, "qwen_image_edit_2511", (input) => ({ ...evaluator(input), ...altered })); assert.equal(result.exitCode, 1); assert.equal(result.report.shots[0].finalStatus, "needs_review", `${name} cannot be accepted`); if (name === "mismatch") assert.equal(result.report.shots[0].actualProvider, "qwen_image_edit_2511", "actual provider is derived only from terminal proof"); }
  const noEvaluator = await run("no-evaluator", "qwen_image_edit_2511", null); assert.equal(noEvaluator.report.preflight.status, "failed"); assert.equal(noEvaluator.report.shots.every((shot) => shot.finalStatus === "cancelled"), true, "missing evaluator fails setup before prompt execution");
  const continuationTransport = makeTransport("qwen_image_edit_2511", { history: (id) => id === "prompt-3" ? ({ [id]: { status: { status: "error", messages: ["failed"] }, outputs: {} } }) : undefined });
  const continued = await runCharacterConsistencyBenchmark({ generationMode: "lora_augmented", character: "asset_ada", provider: "qwen_image_edit_2511", baseUrl: "http://127.0.0.1:8188", outputPath: path.join(tempRoot, "continued.json"), fixture, workflow: qwenLoraWorkflow(), workflowTokens: loraTokens }, { transport: continuationTransport, clock: testClock(), evaluateShot: evaluator, evaluatorProof: programmaticEvaluatorProof, randomId: () => "fixed" });
  assert.equal(continued.report.shots[2].finalStatus, "failed"); assert.equal(continued.report.shots[7].finalStatus, "accepted", "a terminal shot failure does not stop later declared shots");
  const offlineBase = makeTransport("qwen_image_edit_2511"); let offlinePrompts = 0; const offlineTransport = { async postJson(...args) { offlinePrompts += 1; return offlineBase.postJson(...args); }, async getJson(url, options) { if (url.endsWith("/history/prompt-3")) throw Object.assign(new Error("endpoint disappeared"), { code: "EOFFLINE" }); return offlineBase.getJson(url, options); } };
  const offlineMidRun = await runCharacterConsistencyBenchmark({ generationMode: "lora_augmented", character: "asset_ada", provider: "qwen_image_edit_2511", baseUrl: "http://127.0.0.1:8188", outputPath: path.join(tempRoot, "offline-mid-run.json"), fixture, workflow: qwenLoraWorkflow(), workflowTokens: loraTokens }, { transport: offlineTransport, clock: testClock(), evaluateShot: evaluator, evaluatorProof: programmaticEvaluatorProof, randomId: () => "fixed" });
  assert.equal(offlinePrompts, 3, "offline transport stops later queue calls"); assert.deepEqual(offlineMidRun.report.shots.map((shot) => shot.finalStatus), ["accepted", "accepted", "failed", "cancelled", "cancelled", "cancelled", "cancelled", "cancelled"]);
  const unsafe = await run("unsafe", "qwen_image_edit_2511", (input) => { const value = { ...evaluator(input), secret: "api_key=do-not-persist" }; value.self = value; return value; }); const unsafeBytes = await readFile(path.join(tempRoot, "unsafe.json"), "utf8"); assert.equal(unsafeBytes.includes("do-not-persist"), false, "report uses a primitive whitelist and rejects circular/unknown evaluator data");
  const first = await run("bytes-a"); const second = await run("bytes-b"); assert.equal(await readFile(path.join(tempRoot, "bytes-a.json"), "utf8"), await readFile(path.join(tempRoot, "bytes-b.json"), "utf8"), "fixed inputs/clock produce byte-identical reports");
  const existingPath = path.join(tempRoot, "existing.json"); await writeFile(existingPath, "preserve-me"); await assert.rejects(runCharacterConsistencyBenchmark({ generationMode: "lora_augmented", character: "asset_ada", provider: "qwen_image_edit_2511", baseUrl: "http://127.0.0.1:8188", outputPath: existingPath, fixture, workflow: qwenLoraWorkflow(), workflowTokens: loraTokens }, { transport: makeTransport("qwen_image_edit_2511") }), (error) => error?.code === "EOUTPUT_EXISTS"); assert.equal(await readFile(existingPath, "utf8"), "preserve-me", "existing report bytes are never touched");
  const raceFs = { ...await import("node:fs/promises"), async access() { const error = new Error("missing"); error.code = "ENOENT"; throw error; }, async link() { const error = new Error("race"); error.code = "EEXIST"; throw error; } }; let removed = false; const originalRm = raceFs.rm; raceFs.rm = async (...args) => { removed = true; return originalRm(...args); }; await assert.rejects(writeBenchmarkReportExclusive(path.join(tempRoot, "race.json"), { safe: true }, { fileSystem: raceFs, randomId: () => "race" }), (error) => error?.code === "EOUTPUT_EXISTS"); assert.equal(removed, true, "publication race cleans owned temporary file");
  assert.equal(summarizeBenchmark([{ finalStatus: "accepted", score: 1 }, { finalStatus: "needs_review", score: 0 }, { finalStatus: "failed", score: 0 }, { finalStatus: "cancelled", score: 0 }]).status, "cancelled", "aggregate precedence is cancelled > failed > needs_review > accepted");
} finally { await rm(tempRoot, { recursive: true, force: true }); }

const cliRoot = await mkdtemp(path.join(repoRoot, ".tmp-character-benchmark-cli-"));
const cliWorkflow = qwenWorkflow(); delete cliWorkflow["2"].inputs.context;
cliWorkflow["2"].inputs.reference_a = "{{REFERENCE_IMAGE_A}}"; cliWorkflow["2"].inputs.reference_b = "{{REFERENCE_IMAGE_B}}";
cliWorkflow["4"] = { class_type: "LoraLoader", inputs: { model: ["1", 0], lora_name: "{{ACTIVE_LORA_NAME}}", strength_model: "{{ACTIVE_LORA_STRENGTH}}", strength_clip: "{{ACTIVE_LORA_STRENGTH}}" } };
cliWorkflow["5"] = { class_type: "ModelSamplingFlux", inputs: { model: ["4", 0] } };
cliWorkflow["2"].inputs.model = ["5", 0];
const cliWorkflowPath = path.join(cliRoot, "workflow.json"); const cliEvaluatorPath = path.join(cliRoot, "evaluator.mjs"); const cliThrowEvaluatorPath = path.join(cliRoot, "throw-evaluator.mjs"); const cliWrongEvaluatorPath = path.join(cliRoot, "wrong-evaluator.mjs"); const cliNoVersionEvaluatorPath = path.join(cliRoot, "no-version-evaluator.mjs");
const cliProjectPath = path.join(cliRoot, "project.json"); const cliReadyProjectPath = path.join(cliRoot, "project-ready.json"); const cliMismatchProjectPath = path.join(cliRoot, "project-mismatch.json"); const cliIncompleteProjectPath = path.join(cliRoot, "project-incomplete.json");
await writeFile(cliWorkflowPath, `${JSON.stringify(cliWorkflow, null, 2)}\n`);
const strictCliProof = (id, version = null) => `export const evaluatorId = ${JSON.stringify(id)};\n${version ? `export const evaluatorVersion = ${JSON.stringify(version)};\n` : ""}export const evaluatorImplementationHash = "${"a".repeat(64)}";\nexport const evaluatorPolicyHash = "${"b".repeat(64)}";\nexport const dimensionThreshold = 0.8;\nexport const requiresLocalOutput = true;\nexport async function closeEvaluator() {}\n`;
await writeFile(cliEvaluatorPath, `${strictCliProof("cli-character-evaluator", "cli-test-v1")}export async function evaluateCharacterShot(context) { if (context.character.context?.unrelated || !context.character.context?.identityPack?.version || !context.character.context?.lora?.loraName) throw new Error("unsanitized or missing subject context"); return { status: "accepted", provenance: "model_generation", actualProvider: context.providerProof.providerId, score: 0.95, dimensionScores: { face: 0.95, hair: 0.95, outfit: 0.95, body: 0.95, quality: 0.95 }, references: [context.output], bestPreview: context.output, retries: 0 }; }\n`);
await writeFile(cliThrowEvaluatorPath, `${strictCliProof("cli-throw-evaluator", "cli-throw-v1")}export async function evaluateCharacterShot() { throw new Error("evaluator failed"); }\n`);
await writeFile(cliWrongEvaluatorPath, `${strictCliProof("cli-wrong-evaluator", "wrong-export")}export default function notTheContract() {}\n`);
await writeFile(cliNoVersionEvaluatorPath, `${strictCliProof("cli-no-version-evaluator")}export async function evaluateCharacterShot() { return {}; }\n`);
await assert.rejects(loadTrustedEvaluator(cliNoVersionEvaluatorPath), (error) => error?.code === "EEVALUATOR" && /version/i.test(error.message), "trusted evaluator requires an explicit stable version");
const cliRefsRoot = path.join(cliRoot, "refs"); await mkdir(cliRefsRoot, { recursive: true });
for (const name of ["ada-front.png", "ada-left.png", "ada-hair-back.png", "ada-body.png", "ada-body-side.png", "ada-body-back.png", "ada-expression.png", "ada-hero.png"]) await writeFile(path.join(cliRefsRoot, name), onePixelPng);
const projectAsset = { id: "asset_ada", type: "character", unrelated: "must-not-reach-evaluator", characterIdentityPack: { version: "identity-v3", triggerWord: "ada_v3", faceMasterPath: "refs/ada-front.png", faceLeftPath: "refs/ada-left.png", hairBackPath: "refs/ada-hair-back.png", bodyFrontPath: "refs/ada-body.png", bodySidePath: "refs/ada-body-side.png", bodyBackPath: "refs/ada-body-back.png", neutralExpressionPath: "refs/ada-expression.png", immutableTraits: ["silver bob"], forbiddenChanges: ["no eye color changes"], approvedHeroFramePaths: ["refs/ada-hero.png"], updatedAt: "2026-08-08T00:00:00.000Z" }, characterLora: { provider: "qwen_image_edit_2511", modelName: "qwen_image_edit_2511_bf16.safetensors", loraName: "ada-v3.safetensors", strength: 0.9, version: "lora-v3", status: "dataset_ready" } };
await writeFile(cliProjectPath, `${JSON.stringify({ snapshot: { assets: [projectAsset, { id: "unrelated", type: "character" }] } }, null, 2)}\n`);
await writeFile(cliReadyProjectPath, `${JSON.stringify({ assets: [{ ...projectAsset, characterLora: { ...projectAsset.characterLora, status: "ready" } }] }, null, 2)}\n`);
await writeFile(cliMismatchProjectPath, `${JSON.stringify({ assets: [{ ...projectAsset, id: "someone_else" }] }, null, 2)}\n`);
await writeFile(cliIncompleteProjectPath, `${JSON.stringify({ assets: [{ ...projectAsset, characterLora: { ...projectAsset.characterLora, version: "" } }] }, null, 2)}\n`);
const externalRefRoot = await mkdtemp(path.join(tmpdir(), "character-reference-external-")); const externalFace = path.join(externalRefRoot, "external-face.png"); await writeFile(externalFace, onePixelPng); const externalProjectPath = path.join(cliRoot, "external-reference-project.json");
await writeFile(externalProjectPath, `${JSON.stringify({ assets: [{ ...projectAsset, characterIdentityPack: { ...projectAsset.characterIdentityPack, faceMasterPath: externalFace } }] }, null, 2)}\n`);
const externalSubject = await loadBenchmarkProjectSubject(externalProjectPath, { character: "asset_ada", provider: "flux2_klein_4b", generationMode: "zero_shot_multi_reference" }); assert.equal(externalSubject.identityReferenceManifest.find((item) => item.slot === "face_master")?.sourceSha256.length, 64, "published identity packs may reference regular local images outside the repo root"); await rm(externalRefRoot, { recursive: true, force: true });
const zeroSubject = await loadBenchmarkProjectSubject(cliProjectPath, { character: "asset_ada", provider: "flux2_klein_4b", generationMode: "zero_shot_multi_reference" });
assert.equal(zeroSubject.subject.loraName, undefined); assert.equal(zeroSubject.workflowTokens.ACTIVE_LORA_NAME, undefined);
assert.equal(zeroSubject.identityReferenceManifest.length >= 3, true); assert.equal(zeroSubject.identityReferenceManifest.every((item) => /^[a-f0-9]{64}$/.test(item.sourceSha256)), true);
assert.equal(zeroSubject.identityReferenceManifest.every((item) => path.isAbsolute(item.sourcePath)), true, "private runner manifest retains resolved paths for preprocessing");
let cliPromptCount = 0; let cliActive = 0; let cliMaxActive = 0; const cliSeeds = [];
const server = createServer(async (request, response) => {
  const send = (body, status = 200) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
  if (request.method === "GET" && request.url === "/system_stats") return send({ devices: ["RTX 5070 Ti"] });
  if (request.method === "GET" && request.url === "/object_info") return send({ TextEncodeQwenImageEdit: { model: "qwen_image_edit_2511_bf16.safetensors" } });
  if (request.method === "GET" && request.url?.startsWith("/view?")) { response.writeHead(200, { "content-type": "image/png" }); response.end(onePixelPng); return; }
  if (request.method === "POST" && request.url === "/upload/image") { const chunks = []; for await (const chunk of request) chunks.push(chunk); const multipart = Buffer.concat(chunks).toString("latin1"); const filename = multipart.match(/filename="([^"]+)"/)?.[1]; return send({ name: filename, subfolder: "character-benchmark", type: "input" }); }
  if (request.method === "POST" && request.url === "/prompt") { cliActive += 1; cliMaxActive = Math.max(cliMaxActive, cliActive); const chunks = []; for await (const chunk of request) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks).toString("utf8")); cliPromptCount += 1; cliSeeds.push(body.prompt["2"].inputs.seed); cliActive -= 1; return send({ prompt_id: `cli-${cliPromptCount}` }); }
  if (request.method === "GET" && request.url?.startsWith("/history/cli-")) { const promptId = request.url.split("/").at(-1); return send({ [promptId]: { outputs: { "3": { images: [{ filename: `${promptId}.png`, subfolder: "benchmark", type: "output" }] } }, status: { status_str: "success", completed: true, messages: [] } } }); }
  return send({ error: "not found" }, 404);
});
const runCli = async (args) => { const child = spawn(process.execPath, [path.join(repoRoot, "scripts/run-character-consistency-benchmark.mjs"), ...args], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] }); let stdout = ""; let stderr = ""; child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; }); const [code] = await once(child, "close"); return { code, stdout, stderr }; };
try {
  server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); const cliBaseUrl = `http://127.0.0.1:${address.port}`;
  const commonCli = ["--mode", "lora", "--character", "asset_ada", "--provider", "qwen_image_edit_2511", "--base-url", cliBaseUrl, "--workflow", cliWorkflowPath, "--output-node", "3"];
  const readyPath = path.join(cliRoot, "ready-rejected.json"); const ready = await runCli([...commonCli, "--project", cliReadyProjectPath, "--evaluator-module", cliEvaluatorPath, "--output", readyPath]); assert.equal(ready.code, 1); assert.equal(cliPromptCount, 0, "ready input is rejected before queue"); assert.match(JSON.parse(await readFile(readyPath, "utf8")).preflight.diagnostics[0], /ELORA/);
  const cliAcceptedPath = path.join(cliRoot, "accepted.json"); const cliAccepted = await runCli([...commonCli, "--project", cliProjectPath, "--evaluator-module", cliEvaluatorPath, "--output", cliAcceptedPath]);
  if (cliAccepted.code !== 0) throw new Error(`CLI benchmark failed: ${cliAccepted.stderr}\n${await readFile(cliAcceptedPath, "utf8")}`);
  assert.equal(cliAccepted.code, 0, cliAccepted.stderr); const cliAcceptedReport = JSON.parse(await readFile(cliAcceptedPath, "utf8")); assert.equal(cliAcceptedReport.aggregate.accepted, 8); assert.equal(cliPromptCount, 8); assert.equal(cliMaxActive, 1); assert.deepEqual(cliSeeds, fixture.shots.map((shot) => shot.seed)); assert.equal(cliAcceptedReport.evaluatorProof.version, "cli-test-v1"); assert.match(cliAcceptedReport.evaluatorProof.modulePathHash, /^[a-f0-9]{64}$/); assert.equal(cliAcceptedReport.evidenceEligible, true); assert.match(cliAcceptedReport.evidenceDigest, /^[a-f0-9]{64}$/); assert.deepEqual(cliAcceptedReport.subject, { characterAssetId: "asset_ada", provider: "qwen_image_edit_2511", identityPackVersion: "identity-v3", loraName: "ada-v3.safetensors", loraVersion: "lora-v3", modelName: "qwen_image_edit_2511_bf16.safetensors", loraStrength: 0.9, candidateStatus: "dataset_ready" }); assert.deepEqual(cliAcceptedReport.preflight.providerProof.authoritativeLoraBindings, [{ id: "4", classType: "LoraLoader", field: "lora_name", loraName: "ada-v3.safetensors", strengthModel: 0.9, strengthClip: 0.9, clipStrengthPolicy: "equal_to_model", modelPathNodeIds: ["4", "5", "2"], modelPathEdges: [{ fromNodeId: "4", fromOutputIndex: 0, toNodeId: "5", toInput: "model" }, { fromNodeId: "5", fromOutputIndex: 0, toNodeId: "2", toInput: "model" }] }]); assert.equal(validateCharacterBenchmarkEvidence(cliAcceptedReport).valid, true); const changedEnvelope = { ...cliAcceptedReport, startedAt: "later", finishedAt: "later", baseUrl: "http://secret.invalid", apiKey: "secret" }; assert.equal(recomputeCharacterBenchmarkEvidenceDigest(changedEnvelope), cliAcceptedReport.evidenceDigest, "digest excludes timestamps, endpoint, and unknown secrets");
  const statusTamper = structuredClone(cliAcceptedReport); statusTamper.subject.candidateStatus = "ready"; assert.equal(validateCharacterBenchmarkEvidence(statusTamper).valid, false); assert.equal(validateCharacterBenchmarkEvidence(statusTamper).eligible, false); assert.notEqual(recomputeCharacterBenchmarkEvidenceDigest(statusTamper), cliAcceptedReport.evidenceDigest, "candidate status is digest-bound");
  const changedStrength = structuredClone(cliAcceptedReport); changedStrength.subject.loraStrength = 0.8; changedStrength.preflight.providerProof.authoritativeLoraBindings[0].strengthModel = 0.8; changedStrength.preflight.providerProof.authoritativeLoraBindings[0].strengthClip = 0.8; assert.notEqual(recomputeCharacterBenchmarkEvidenceDigest(changedStrength), cliAcceptedReport.evidenceDigest, "candidate inference strength is digest-bound");
  const modelOnly = structuredClone(cliAcceptedReport); modelOnly.preflight.providerProof.authoritativeLoraBindings[0] = { ...modelOnly.preflight.providerProof.authoritativeLoraBindings[0], classType: "LoraLoaderModelOnly", strengthClip: null, clipStrengthPolicy: "not_applicable" }; assert.equal(validateCharacterBenchmarkEvidence(modelOnly).eligible, true, "model-only loader proves its model strength without a CLIP input");
  for (const [label, value] of [["missing", undefined], ["string", "0.9"], ["nonfinite", Number.NaN], ["zero", 0], ["out-of-range", 1.6]]) { const altered = structuredClone(cliAcceptedReport); if (value === undefined) delete altered.subject.loraStrength; else altered.subject.loraStrength = value; assert.equal(validateCharacterBenchmarkEvidence(altered).eligible, false, `${label} subject inference strength is ineligible`); }
  for (const [label, value] of [["different", 0.8], ["missing", undefined], ["string", "0.9"], ["nonfinite", Number.NaN], ["out-of-range", 1.6]]) { const altered = structuredClone(cliAcceptedReport); if (value === undefined) delete altered.preflight.providerProof.authoritativeLoraBindings[0].strengthModel; else altered.preflight.providerProof.authoritativeLoraBindings[0].strengthModel = value; assert.equal(validateCharacterBenchmarkEvidence(altered).eligible, false, `${label} model inference strength is ineligible`); }
  for (const [label, value] of [["missing", undefined], ["different", 0.8], ["string", "0.9"], ["nonfinite", Number.NaN], ["out-of-range", -0.1]]) { const altered = structuredClone(cliAcceptedReport); if (value === undefined) delete altered.preflight.providerProof.authoritativeLoraBindings[0].strengthClip; else altered.preflight.providerProof.authoritativeLoraBindings[0].strengthClip = value; assert.equal(validateCharacterBenchmarkEvidence(altered).eligible, false, `${label} CLIP inference strength is ineligible`); }
  for (const [label, loraBindings] of [["missing", []], ["different", [{ ...cliAcceptedReport.preflight.providerProof.authoritativeLoraBindings[0], loraName: "decoy.safetensors" }]]]) { const altered = structuredClone(cliAcceptedReport); altered.preflight.providerProof.authoritativeLoraBindings = loraBindings; assert.equal(validateCharacterBenchmarkEvidence(altered).eligible, false, `${label} terminal LoRA proof is ineligible`); }
  const decoyWorkflow = qwenWorkflow(); decoyWorkflow["9"] = { class_type: "LoraLoader", inputs: { model: ["1", 0], lora_name: "{{ACTIVE_LORA_NAME}}" } }; assert.throws(() => compileBenchmarkWorkflow({ provider: "qwen_image_edit_2511", fixture, workflow: decoyWorkflow, outputNode: "3", workflowTokens: { CHARACTER_CONTEXT: {}, ACTIVE_LORA_NAME: "ada-v3.safetensors" } }), (error) => error?.code === "EPROVIDER_PROOF" && error.message === "character_lora_binding_missing", "disconnected LoRA decoy cannot satisfy an incomplete active LoRA proof");
  const directWorkflow = qwenWorkflow(); directWorkflow["4"] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "{{ACTIVE_LORA_NAME}}", strength_model: "{{ACTIVE_LORA_STRENGTH}}" } }; directWorkflow["2"].inputs.model = ["4", 0]; const directProof = compileBenchmarkWorkflow({ provider: "qwen_image_edit_2511", fixture, workflow: directWorkflow, outputNode: "3", workflowTokens: { CHARACTER_CONTEXT: {}, ACTIVE_LORA_NAME: "ada-v3.safetensors", ACTIVE_LORA_STRENGTH: 0.9 } }).providerProof; assert.deepEqual(directProof.authoritativeLoraBindings[0].modelPathNodeIds, ["4", "2"], "direct loader MODEL output proves the generation path");
  const sideWorkflow = qwenWorkflow(); sideWorkflow["9"] = { class_type: "LoraLoader", inputs: { model: ["1", 0], lora_name: "{{ACTIVE_LORA_NAME}}", strength_model: "{{ACTIVE_LORA_STRENGTH}}", strength_clip: "{{ACTIVE_LORA_STRENGTH}}" } }; sideWorkflow["2"].inputs.side_conditioning = ["9", 0]; assert.throws(() => compileBenchmarkWorkflow({ provider: "qwen_image_edit_2511", fixture, workflow: sideWorkflow, outputNode: "3", workflowTokens: { CHARACTER_CONTEXT: {}, ACTIVE_LORA_NAME: "ada-v3.safetensors", ACTIVE_LORA_STRENGTH: 0.9 } }), (error) => error?.code === "EPROVIDER_PROOF" && error.message === "character_lora_binding_missing", "generic ancestry through a non-model side input cannot prove LoRA application");
  const wrongOutputWorkflow = qwenWorkflow(); wrongOutputWorkflow["4"] = { class_type: "LoraLoader", inputs: { model: ["1", 0], lora_name: "{{ACTIVE_LORA_NAME}}", strength_model: 0.9, strength_clip: 0.9 } }; wrongOutputWorkflow["2"].inputs.model = ["4", 1]; assert.throws(() => compileBenchmarkWorkflow({ provider: "qwen_image_edit_2511", fixture, workflow: wrongOutputWorkflow, outputNode: "3", workflowTokens: { CHARACTER_CONTEXT: {}, ACTIVE_LORA_NAME: "ada-v3.safetensors", ACTIVE_LORA_STRENGTH: 0.9 } }), (error) => error?.code === "EPROVIDER_PROOF" && error.message === "character_lora_binding_missing", "non-MODEL LoRA output cannot prove application");
  const conflictWorkflow = qwenWorkflow(); conflictWorkflow["4"] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: "{{ACTIVE_LORA_NAME}}", strength_model: 0.9 } }; conflictWorkflow["5"] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["4", 0], lora_name: "conflict.safetensors", strength_model: 0.9 } }; conflictWorkflow["2"].inputs.model = ["5", 0]; assert.throws(() => compileBenchmarkWorkflow({ provider: "qwen_image_edit_2511", fixture, workflow: conflictWorkflow, outputNode: "3", workflowTokens: { CHARACTER_CONTEXT: {}, ACTIVE_LORA_NAME: "ada-v3.safetensors", ACTIVE_LORA_STRENGTH: 0.9 } }), (error) => error?.code === "EPROVIDER_PROOF" && error.message === "character_lora_binding_mismatch", "conflicting LoRA on the terminal MODEL path fails before a benchmark can run");
  const noProjectPath = path.join(cliRoot, "no-project.json"); const noProject = await runCli([...commonCli, "--evaluator-module", cliEvaluatorPath, "--output", noProjectPath]); assert.equal(noProject.code, 1, "test evaluator requires sanitized project context"); const noProjectReport = JSON.parse(await readFile(noProjectPath, "utf8")); assert.equal(noProjectReport.evidenceEligible, false); assert.equal(noProjectReport.evidenceDigest, null);
  const projectRequests = cliPromptCount; const mismatchPath = path.join(cliRoot, "project-mismatch-report.json"); const mismatch = await runCli([...commonCli, "--project", cliMismatchProjectPath, "--evaluator-module", cliEvaluatorPath, "--output", mismatchPath]); assert.equal(mismatch.code, 1); assert.equal(cliPromptCount, projectRequests, "project mismatch fails before generation"); assert.match(JSON.parse(await readFile(mismatchPath, "utf8")).preflight.diagnostics[0], /EPROJECT_CHARACTER/);
  const incompletePath = path.join(cliRoot, "project-incomplete-report.json"); const incomplete = await runCli([...commonCli, "--project", cliIncompleteProjectPath, "--evaluator-module", cliEvaluatorPath, "--output", incompletePath]); assert.equal(incomplete.code, 1); assert.equal(cliPromptCount, projectRequests); assert.match(JSON.parse(await readFile(incompletePath, "utf8")).preflight.diagnostics[0], /ELORA/);
  const requestsBeforeMissing = cliPromptCount; const cliMissingPath = path.join(cliRoot, "missing.json"); const cliMissing = await runCli([...commonCli, "--output", cliMissingPath]); assert.equal(cliMissing.code, 1); assert.equal(cliPromptCount, requestsBeforeMissing, "missing evaluator fails before prompt"); assert.equal(JSON.parse(await readFile(cliMissingPath, "utf8")).preflight.status, "failed");
  const cliUnsafePath = path.join(cliRoot, "unsafe.json"); const cliUnsafe = await runCli([...commonCli, "--evaluator-module", "data:text/javascript,export default 1", "--output", cliUnsafePath]); assert.equal(cliUnsafe.code, 1); assert.equal(cliPromptCount, requestsBeforeMissing); assert.equal(JSON.parse(await readFile(cliUnsafePath, "utf8")).preflight.status, "failed");
  const cliWrongPath = path.join(cliRoot, "wrong.json"); const cliWrong = await runCli([...commonCli, "--evaluator-module", cliWrongEvaluatorPath, "--output", cliWrongPath]); assert.equal(cliWrong.code, 1); assert.equal(cliPromptCount, requestsBeforeMissing); assert.match(JSON.parse(await readFile(cliWrongPath, "utf8")).preflight.diagnostics[0], /evaluateCharacterShot/);
  const cliThrowPath = path.join(cliRoot, "throw.json"); const cliThrow = await runCli([...commonCli, "--project", cliProjectPath, "--evaluator-module", cliThrowEvaluatorPath, "--output", cliThrowPath]); assert.equal(cliThrow.code, 1); const throwReport = JSON.parse(await readFile(cliThrowPath, "utf8")); assert.equal(throwReport.shots.every((shot) => shot.finalStatus === "failed"), true); assert.equal(cliPromptCount, requestsBeforeMissing + 8, "evaluator shot failures retain serial continuation");
} finally { await new Promise((resolve) => server.close(resolve)); await rm(cliRoot, { recursive: true, force: true }); }
console.log("PASS character benchmark workflow proof, typed compilation, protocol, gates, report safety, and publication");
