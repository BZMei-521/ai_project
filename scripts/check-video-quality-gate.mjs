import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";

import {
  applyVideoQualityDecision,
  artifactBindingsEqual,
  createVideoArtifactBinding,
  createVideoQualityReport,
  evaluateVideoQuality,
  planVideoRebuildRequest,
  resolvePersistedVideoDecision
} from "../src/modules/video-production/videoQualityRuntime.mjs";
import {
  createVideoGenerationContractDigest,
  createVideoOperationIdentity,
  createVideoProductionController
} from "../src/modules/video-production/videoProductionControllerRuntime.mjs";
import { inventoryFromComfyObjectInfo } from "../src/modules/video-production/videoInventoryRuntime.mjs";
import { assertGenerationReceipt, createRoutedVideoGenerationExecutor } from "../src/modules/video-production/videoRoutedGenerationRuntime.mjs";

const hex = (character) => character.repeat(64);
const probe = Object.freeze({
  width: 1280,
  height: 720,
  fpsNum: 24,
  fpsDen: 1,
  durationSeconds: 2,
  videoCodec: "h264",
  pixelFormat: "yuv420p",
  audioSampleRate: 48000,
  audioChannels: 2,
  hasMonotonicTimestamps: true,
  hasConstantFrameTimestamps: true,
  decodedFrameCount: 48
});
const credential = Object.freeze({
  schemaVersion: 1,
  receiptId: hex("a"),
  normalizedPath: "C:/project/assets/video-normalized/shot-a.mp4",
  sha256: hex("b"),
  byteLength: 12345,
  modifiedUnixMillis: 1787000000000,
  projectWidth: 1280,
  projectHeight: 720,
  durationFrames: 48,
  probe
});
const reviewFrames = Object.freeze({
  firstFramePath: "C:/project/assets/video-review/a/first.png",
  middleFramePath: "C:/project/assets/video-review/a/middle.png",
  lastFramePath: "C:/project/assets/video-review/a/last.png"
});
const authenticatedReviewRecord = Object.freeze({
  schemaVersion: 1,
  credentialReceiptId: credential.receiptId,
  frames: [
    { role: "first", path: reviewFrames.firstFramePath, sha256: hex("a"), byteLength: 10, modifiedUnixMillis: 1787000000001 },
    { role: "middle", path: reviewFrames.middleFramePath, sha256: hex("b"), byteLength: 11, modifiedUnixMillis: 1787000000002 },
    { role: "last", path: reviewFrames.lastFramePath, sha256: hex("c"), byteLength: 12, modifiedUnixMillis: 1787000000003 }
  ],
  keyId: hex("d"),
  mac: hex("e")
});
const assemblyReceipt = Object.freeze({
  schemaVersion: 1,
  keyId: hex("1"),
  transactionId: hex("5"),
  runId: hex("2"),
  canonicalProjectRoot: "C:/project",
  outputPath: "C:/project/assets/video-final/sequence.mp4",
  sha256: hex("6"),
  byteLength: 54321,
  modifiedUnixMillis: 1787000001000,
  probe,
  orderedReceiptIds: [credential.receiptId],
  mac: hex("7")
});
const inspection = Object.freeze({ probe, anomalies: { blackIntervals: [], freezeIntervals: [] } });
const cleanInput = Object.freeze({ normalized: true, normalizationCredential: credential, inspection, reviewFrames, reviewRecord: authenticatedReviewRecord });

const generationContractSource = Object.freeze({
  schemaVersion: 1,
  sequenceId: "sequence-a",
  shot: {
    id: "s1", title: "opening", storyPrompt: "story", videoPrompt: "video", notes: "notes", dialogue: "dialogue",
    seed: 42, characterRefs: ["char-a"], sceneRefId: "scene-a", generatedImagePath: "C:/frame.png",
    videoStartFramePath: "C:/first.png", videoEndFramePath: "C:/last.png", durationFrames: 48,
    continuitySegmentId: "segment-a", videoBoundaryKind: "continuous"
  },
  project: { id: "project-a", width: 1280, height: 720, fps: 24 },
  routeDecision: { status: "selected", profileId: "minimax_h3_flf2v", reason: "manual_override" },
  profilePreflight: { profileId: "minimax_h3_flf2v", available: true, missingNodes: [], missingModels: [], warnings: [] },
  workflowDigest: hex("8"),
  references: [{ kind: "character_face", path: "C:/face.png" }, { kind: "scene", path: "C:/scene.png" }],
  boundary: { id: "b12", fromShotId: "s1", toShotId: "s2", kind: "continuous", requiresApproval: true, approvalStatus: "approved", sharedFramePath: "C:/boundary.png" }
});
const generationContractDigest = await createVideoGenerationContractDigest(generationContractSource);
assert.match(generationContractDigest, /^[a-f0-9]{64}$/);
for (const mutate of [
  (value) => value.shot.title = "changed",
  (value) => value.shot.storyPrompt = "changed",
  (value) => value.shot.videoPrompt = "changed",
  (value) => value.shot.notes = "changed",
  (value) => value.shot.dialogue = "changed",
  (value) => value.shot.seed = 43,
  (value) => value.shot.characterRefs = ["char-b"],
  (value) => value.shot.sceneRefId = "scene-b",
  (value) => value.shot.generatedImagePath = "C:/other.png",
  (value) => value.shot.durationFrames = 49,
  (value) => value.shot.continuitySegmentId = "segment-b",
  (value) => value.routeDecision.profileId = "minimax_h3_i2v",
  (value) => value.shot.videoAccelerationMode = "te_speed_preview",
  (value) => value.shot.videoQualityTier = "draft",
  (value) => value.workflowDigest = hex("9"),
  (value) => value.project.width = 1920,
  (value) => value.project.height = 1080,
  (value) => value.project.fps = 30,
  (value) => value.boundary.sharedFramePath = "C:/boundary-other.png"
]) {
  const changed = structuredClone(generationContractSource);
  mutate(changed);
  assert.notEqual(await createVideoGenerationContractDigest(changed), generationContractDigest, "consumed generation input must change contract digest");
}
assert.equal(await createVideoGenerationContractDigest({ ...generationContractSource, uiExpanded: true }), generationContractDigest, "unconsumed UI state must not change contract digest");

const liveInventory = inventoryFromComfyObjectInfo({
  MiniMaxH3ImageToVideo: {}, MiniMaxH3ReferenceToVideo: {}, LoadImage: {}, UNETLoader: { input: { required: { unet_name: [["minimax_h3_fl2va_pruned_int8_convrot.safetensors", "minimax_h3_ref2va_pruned_int8_convrot.safetensors"]] } } },
  CLIPLoader: { input: { required: { clip_name: [["qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"]] } } },
  VAELoader: { input: { required: { vae_name: [["minimax_h3_video_vae_fp16.safetensors", "minimax_h3_audio_vae_fp32.safetensors"]] } } },
  RandomNoise: {}, KSamplerSelect: {}, BasicScheduler: {}, BasicGuider: {}, SamplerCustomAdvanced: {}, VAEDecode: {}, VAEDecodeAudio: {}, CreateVideo: {}, SaveVideo: {}
});
assert.equal(liveInventory.nodes.includes("MiniMaxH3ImageToVideo"), true);
assert.deepEqual(liveInventory.models.diffusion_models, ["minimax_h3_fl2va_pruned_int8_convrot.safetensors", "minimax_h3_ref2va_pruned_int8_convrot.safetensors"]);
assert.deepEqual(liveInventory.models.text_encoders, ["qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"]);
assert.deepEqual(liveInventory.models.vae, ["minimax_h3_audio_vae_fp32.safetensors", "minimax_h3_video_vae_fp16.safetensors"]);

const routedRequests = [];
const routedSnapshots = {
  s1: { shot: { id: "s1", sequenceId: "sequence-a", order: 1, title: "first", dialogue: "", notes: "", tags: [], durationFrames: 48, videoPrompt: "first prompt", videoWorkflowProfileId: "minimax_h3_flf2v", videoQualityTier: "production", videoAccelerationMode: "standard", videoStartFramePath: "C:/story/first.png", videoEndFramePath: "C:/story/last.png", characterRefs: ["char-a"], sceneRefId: "scene-a" }, index: 0 },
  s2: { shot: { id: "s2", sequenceId: "sequence-a", order: 2, title: "second", dialogue: "", notes: "", tags: [], durationFrames: 48, videoPrompt: "second prompt", videoWorkflowProfileId: "minimax_h3_i2v", videoQualityTier: "production", videoAccelerationMode: "standard", generatedImagePath: "C:/story/middle.png", characterRefs: ["char-a"] }, index: 1, incomingBoundary: { id: "b12", fromShotId: "s1", toShotId: "s2", kind: "continuous", approvalStatus: "approved", sharedFramePath: "C:/boundary/approved.png", sharedFrameSource: "approved_tail" } },
  s3: { shot: { id: "s3", sequenceId: "sequence-a", order: 3, title: "third", dialogue: "", notes: "", tags: [], durationFrames: 48, videoPrompt: "third prompt", videoWorkflowProfileId: "minimax_h3_i2v", videoQualityTier: "production", videoAccelerationMode: "standard", generatedImagePath: "C:/story/last.png" }, index: 2, incomingBoundary: { id: "b23", fromShotId: "s2", toShotId: "s3", kind: "scene_transition", approvalStatus: "pending" } }
};
const routedExecutor = createRoutedVideoGenerationExecutor({
  readSnapshot: async (shotId) => ({
    ...structuredClone(routedSnapshots[shotId]), sequenceId: "sequence-a",
    project: { id: "project-a", width: 1280, height: 720, fps: 24 },
    allShots: Object.values(routedSnapshots).map((entry) => structuredClone(entry.shot)),
    assets: [{ id: "char-a", kind: "character", filePath: "C:/refs/body.png", characterFaceRefPath: "C:/refs/face.png" }, { id: "scene-a", kind: "scene", filePath: "C:/refs/scene.png" }],
    incomingBoundary: routedSnapshots[shotId].incomingBoundary,
    outgoingBoundary: shotId === "s1" ? { id: "b12", fromShotId: "s1", toShotId: "s2", kind: "continuous", approvalStatus: "approved", sharedFramePath: "C:/boundary/approved.png", sharedFrameSource: "approved_tail" } : undefined
  }),
  inspectInventory: async () => liveInventory,
  routeShot: (snapshot) => ({ status: "selected", profileId: snapshot.shot.videoWorkflowProfileId, reason: "manual_override" }),
  preflightProfile: (route) => ({ profileId: route.profileId, available: true, missingNodes: [], missingModels: [], warnings: [] }),
  workflowJsonForProfile: (profileId) => `workflow:${profileId}`,
  contractDigest: async (source) => createVideoGenerationContractDigest(source),
  generateRoutedVideoShot: async (request) => {
    routedRequests.push(structuredClone(request));
    const generatedVideoPath = `C:/generated/${request.shot.id}.mp4`;
    return { ok: true, generatedVideoPath, videoGenerationReceipt: {
      profileId: request.routeDecision.profileId, accelerationMode: request.accelerationMode,
      workflowDigest: hex("1"), inputDigest: hex("2"), promptId: `prompt-${request.shot.id}`,
      normalizedPath: generatedVideoPath, contractDigest: request.generationContractDigest,
      operationToken: request.operationToken, generatedAt: "2026-08-18T00:00:00.000Z"
    } };
  },
  verifyFreshTail: async (evidence) => evidence.reviewFrames.lastFramePath
});
const firstGenerated = await routedExecutor.generate("s1");
assert.equal(firstGenerated.generatedVideoPath, "C:/generated/s1.mp4");
assert.equal(routedRequests[0].routeDecision.profileId, "minimax_h3_flf2v");
assert.equal(routedRequests[0].profileWorkflowJson, "workflow:minimax_h3_flf2v");
assert.equal(routedRequests[0].firstFramePath, "C:/story/first.png");
assert.equal(routedRequests[0].lastFramePath, "C:/story/last.png");
assert.deepEqual(routedRequests[0].references.map((item) => item.path), ["C:/refs/face.png", "C:/refs/body.png", "C:/refs/scene.png"]);
for (const mutate of [
  (receipt) => ({ ...receipt, profileId: "minimax_h3_t2v" }),
  (receipt) => ({ ...receipt, normalizedPath: "C:/foreign.mp4" }),
  (receipt) => ({ ...receipt, contractDigest: hex("9") }),
  (receipt) => ({ ...receipt, operationToken: "replayed-token" })
]) assert.throws(() => assertGenerationReceipt(mutate(firstGenerated.videoGenerationReceipt), firstGenerated, firstGenerated.generatedVideoPath), /video_generation_receipt_/);
await routedExecutor.generate("s2", { previousEvidence: { shotId: "s1", status: "ready", normalizationCredential: { receiptId: hex("8") }, reviewFrames: { firstFramePath: "C:/review/first.png", middleFramePath: "C:/review/middle.png", lastFramePath: "C:/review/fresh-last.png" } } });
assert.equal(routedRequests[1].routeDecision.profileId, "minimax_h3_i2v");
assert.equal(routedRequests[1].firstFramePath, "C:/review/fresh-last.png", "dependent shot must bind the freshly backend-validated tail");
assert.equal(routedRequests[1].boundaryDependency.fromShotId, "s1");
assert.equal(routedRequests[1].boundaryDependency.kind, "continuous");
assert.equal(routedRequests[1].boundaryDependency.predecessorReceiptId, hex("8"));

routedSnapshots.s2.incomingBoundary = { id: "b12-match", fromShotId: "s1", toShotId: "s2", kind: "match_cut", approvalStatus: "approved", sharedFramePath: "C:/boundary/independent-match.png", sharedFrameSource: "independent" };
await routedExecutor.generate("s2", { previousEvidence: { shotId: "s1", status: "ready", normalizationCredential: { receiptId: hex("a") }, reviewFrames: { firstFramePath: "C:/review/first.png", middleFramePath: "C:/review/middle.png", lastFramePath: "C:/review/fresh-last.png" } } });
assert.equal(routedRequests[2].firstFramePath, "C:/boundary/independent-match.png", "incoming match-cut must use its independent approved shared frame");
assert.equal(routedRequests[2].boundaryDependency.kind, "match_cut");
assert.equal(routedRequests[2].boundaryDependency.predecessorReceiptId, hex("a"));

routedSnapshots.s1.shot.videoStartFramePath = undefined;
routedSnapshots.s1.shot.approvedBoundaryFramePath = "C:/boundary/outgoing-tail.png";
routedSnapshots.s1.shot.generatedImagePath = "C:/story/current-storyboard.png";
const preparedOutgoing = await routedExecutor.prepare("s1");
assert.equal(preparedOutgoing.request.firstFramePath, "C:/story/current-storyboard.png", "outgoing boundary must never become the current shot first frame");
routedSnapshots.s2.incomingBoundary = { id: "b12-hard", fromShotId: "s1", toShotId: "s2", kind: "hard_cut", approvalStatus: "pending" };
assert.equal((await routedExecutor.prepare("s2")).request.firstFramePath, "C:/story/middle.png", "hard cut middle shot must use its own storyboard frame");
assert.equal((await routedExecutor.prepare("s3")).request.firstFramePath, "C:/story/last.png", "scene transition last shot must use its own storyboard frame");

assert.equal(evaluateVideoQuality(cleanInput).status, "needs_review");
for (const invalid of [
  {},
  { ...cleanInput, normalized: false },
  { ...cleanInput, normalizationCredential: { status: "verified" } },
  { ...cleanInput, normalizationCredential: { schemaVersion: 1, receiptId: "x" } },
  { ...cleanInput, normalizationCredential: { ...credential, receiptId: hex("g") } },
  { ...cleanInput, normalizationCredential: { ...credential, byteLength: 0 } },
  { ...cleanInput, normalizationCredential: { ...credential, projectWidth: 1279 } },
  { ...cleanInput, normalizationCredential: { ...credential, durationFrames: 47 } },
  { ...cleanInput, normalizationCredential: { ...credential, probe: { ...probe, decodedFrameCount: 47 } } },
  { ...cleanInput, inspection: {} },
  { ...cleanInput, inspection: { probe, anomalies: { blackIntervals: [], freezeIntervals: [{ startSeconds: 0, endSeconds: 0.6, durationSeconds: 0.6 }] } } },
  { ...cleanInput, inspection: { probe, anomalies: { blackIntervals: [{ startSeconds: 0, endSeconds: 0.1, durationSeconds: 0.1 }], freezeIntervals: [] } } },
  { ...cleanInput, inspection: { probe: { ...probe, hasMonotonicTimestamps: false }, anomalies: { blackIntervals: [], freezeIntervals: [] } } },
  { ...cleanInput, inspection: { probe, anomalies: { blackIntervals: [{ startSeconds: -1, endSeconds: 0, durationSeconds: 1 }], freezeIntervals: [] } } },
  { ...cleanInput, blackFrameCount: -1 },
  { ...cleanInput, freezeDurationSeconds: Number.NaN },
  { ...cleanInput, timestampErrors: -1 },
  { ...cleanInput, reviewFrames: { firstFramePath: reviewFrames.firstFramePath } },
  { ...cleanInput, inspection: { probe: { ...probe, width: 1920 }, anomalies: { blackIntervals: [], freezeIntervals: [] } } },
  { ...cleanInput, normalizationCredential: { ...credential, tampered: true } },
  { ...cleanInput, normalizationCredential: { ...credential, replayed: true } }
]) assert.equal(evaluateVideoQuality(invalid).status, "rejected", JSON.stringify(invalid));

const inputSnapshot = structuredClone(cleanInput);
const binding = createVideoArtifactBinding(cleanInput);
assert.match(binding.reviewFramesDigest, /^[a-f0-9]{64}$/);
assert.equal(binding.receiptId, credential.receiptId);
assert.equal(binding.sha256, credential.sha256);
assert.deepEqual(cleanInput, inputSnapshot, "quality input must not be mutated");

const report = createVideoQualityReport("shot-a", cleanInput);
assert.equal(report.status, "needs_review");
assert.deepEqual(report.artifactBinding, binding);
assert.throws(() => applyVideoQualityDecision(report, { decision: "reject", reason: "" }), /rejection_reason_required/);
const approved = applyVideoQualityDecision(report, { decision: "approve", reviewedAt: "2026-08-18T01:02:03.000Z" });
assert.equal(approved.status, "approved");
assert.deepEqual(approved.decision.artifactBinding, binding);
assert.equal(resolvePersistedVideoDecision(report, approved.decision).status, "approved");
const replacedReport = createVideoQualityReport("shot-a", {
  ...cleanInput,
  normalizationCredential: { ...credential, receiptId: hex("c"), sha256: hex("d") }
});
assert.equal(artifactBindingsEqual(binding, replacedReport.artifactBinding), false);
assert.equal(resolvePersistedVideoDecision(replacedReport, approved.decision).status, "rejected");
assert.equal(applyVideoQualityDecision({ ...report, status: "rejected", structuralIssues: ["tampered"] }, { decision: "approve" }).status, "rejected");

const orderedShotIds = ["s1", "s2", "s3", "s4"];
assert.deepEqual(planVideoRebuildRequest({ shotId: "s2", orderedShotIds, reason: "scene_anchor" }), { kind: "shot", shotIds: ["s2"], reason: "scene_anchor" });
assert.deepEqual(planVideoRebuildRequest({
  shotId: "s2", orderedShotIds, reason: "motion_boundary",
  boundary: { id: "b23", kind: "continuous", fromShotId: "s2", toShotId: "s3", requiresApproval: true, approvalStatus: "approved", sharedFramePath: "C:/boundary.png" }
}), { kind: "adjacent_pair", shotIds: ["s2", "s3"], reason: "motion_boundary" });
for (const boundary of [
  { id: "b23", kind: "continuous", fromShotId: "s2", toShotId: "s3", requiresApproval: true, approvalStatus: "pending", sharedFramePath: "C:/boundary.png" },
  { id: "b23", kind: "match_cut", fromShotId: "s3", toShotId: "s2", requiresApproval: true, approvalStatus: "approved", sharedFramePath: "C:/boundary.png" },
  { id: "b14", kind: "continuous", fromShotId: "s1", toShotId: "s4", requiresApproval: true, approvalStatus: "approved", sharedFramePath: "C:/boundary.png" },
  { id: "b23", kind: "continuous", fromShotId: "s2", toShotId: "s3", requiresApproval: true, approvalStatus: "approved" }
]) assert.throws(() => planVideoRebuildRequest({ shotId: "s2", orderedShotIds, reason: "motion_boundary", boundary }), /boundary_/);
assert.deepEqual(planVideoRebuildRequest({
  shotId: "s2", orderedShotIds, reason: "motion_boundary",
  boundary: { id: "b23", kind: "hard_cut", fromShotId: "s2", toShotId: "s3", requiresApproval: false, approvalStatus: "pending" }
}), { kind: "shot", shotIds: ["s2"], reason: "motion_boundary" });

const calls = [];
const persisted = [];
const runCapability = {
  schemaVersion: 1, keyId: hex("1"), runId: hex("2"),
  canonicalProjectRoot: "C:/project", canonicalAssetRoot: "C:/project/assets",
  issuedUnixMillis: 1787000000000, expiresUnixMillis: 1787000060000, mac: hex("3")
};
const controller = createVideoProductionController({
  beginRun: async () => (calls.push("begin"), runCapability),
  stage: async () => (calls.push("stage"), { stagedPath: "C:/project/assets/video-staging/stage.media", projectAssetsDir: "C:/project/assets", stagingReceiptId: hex("4") }),
  probe: async () => (calls.push("probe"), inspection),
  normalize: async () => (calls.push("normalize"), { credential, probe, anomalies: inspection.anomalies }),
  extractReviewFrames: async () => (calls.push("extract"), reviewFrames),
  verifyCredential: async () => (calls.push("verify"), inspection),
  verifyAssemblyReceipt: async () => (calls.push("verify-assembly"), assemblyReceipt.outputPath),
  verifyReviewRecord: async () => (calls.push("verify-review"), { schemaVersion: 1, credentialReceiptId: credential.receiptId, frames: [
    { role: "first", path: reviewFrames.firstFramePath, sha256: hex("a"), byteLength: 10, modifiedUnixMillis: 1787000000001 },
    { role: "middle", path: reviewFrames.middleFramePath, sha256: hex("b"), byteLength: 11, modifiedUnixMillis: 1787000000002 },
    { role: "last", path: reviewFrames.lastFramePath, sha256: hex("c"), byteLength: 12, modifiedUnixMillis: 1787000000003 }
  ], keyId: hex("d"), mac: hex("e") }),
  completeRun: async () => { calls.push("complete"); },
  cleanupRun: async () => { calls.push("cleanup"); },
  persistEvidence: (shotId, evidence) => persisted.push([shotId, structuredClone(evidence)]),
  persistBatchCAS: async (items) => (calls.push(`batch:${items.map((item) => item.evidence.shotId).join(",")}`), true),
  generateShot: async (shotId) => (calls.push(`generate:${shotId}`), { ok: true, generatedVideoPath: `C:/generated/${shotId}.mp4` })
});
const routeDecision = { status: "selected", profileId: "minimax_h3_flf2v", reason: "explicit_endpoints" };
const profilePreflight = { profileId: "minimax_h3_flf2v", available: true, missingNodes: [], missingModels: [], warnings: [] };
const boundary = { id: "b12", fromShotId: "s1", toShotId: "s2", kind: "hard_cut", requiresApproval: false, approvalStatus: "pending" };
const operation = createVideoOperationIdentity({
  sequenceId: "sequence-a", shotId: "s1", contractDigest: generationContractDigest,
  sourceVideoPath: "C:/generated/s1.mp4", boundaryIdentity: "b12:s1:s2:C:/boundary.png",
  operationToken: hex("f")
});
const generationReceiptFor = (path, currentOperation = operation) => ({
  profileId: routeDecision.profileId, accelerationMode: "standard", workflowDigest: hex("2"), inputDigest: hex("3"),
  promptId: `prompt-${currentOperation.shotId}`, normalizedPath: path, contractDigest: currentOperation.contractDigest,
  operationToken: currentOperation.operationToken, generatedAt: "2026-08-18T00:00:00.000Z"
});
const evidence = await controller.processGeneratedShot({
  shotId: "s1", sequenceId: "sequence-a", operation, contractDigest: generationContractDigest,
  generatedVideoPath: "C:/generated/s1.mp4", durationFrames: 48,
  projectWidth: 1280, projectHeight: 720, routeDecision, accelerationMode: "standard", profilePreflight, boundary,
  generationReceipt: generationReceiptFor("C:/generated/s1.mp4")
});
assert.deepEqual(calls, ["begin", "stage", "probe", "normalize", "extract", "verify", "verify-review", "complete"]);
assert.equal(evidence.status, "ready");
assert.deepEqual(evidence.routeDecision, routeDecision);
assert.deepEqual(evidence.profilePreflight, profilePreflight);
assert.deepEqual(evidence.boundary, boundary);
assert.equal(evidence.qualityReport.status, "needs_review");
assert.equal(persisted.at(-1)[0], "s1");

calls.length = 0;
const verifiedReport = await controller.verifyForDecision(evidence);
assert.deepEqual(calls, ["verify", "verify-review"]);
assert.equal(verifiedReport.status, "needs_review");
calls.length = 0;
const assemblyQualityInput = { ...cleanInput, assemblyReceipt };
const evidenceWithAssembly = {
  ...evidence,
  assemblyReceipt,
  artifactBinding: createVideoArtifactBinding(assemblyQualityInput),
  qualityReport: createVideoQualityReport("s1", assemblyQualityInput)
};
assert.equal((await controller.verifyForDecision(evidenceWithAssembly)).status, "needs_review");
assert.deepEqual(calls, ["verify", "verify-review", "verify-assembly"]);
assert.equal(evidenceWithAssembly.artifactBinding.assemblyTransactionId, assemblyReceipt.transactionId);
assert.equal(evidenceWithAssembly.artifactBinding.assemblySha256, assemblyReceipt.sha256);
await assert.rejects(() => controller.verifyForDecision({ ...evidence, normalizationCredential: { ...credential, sha256: hex("e") } }), /artifact_binding_mismatch|credential_/);

let operationLive = true;
const stageDeferred = deferred();
const stageEntered = deferred();
const casWrites = [];
const lifecycleCalls = [];
const casController = createVideoProductionController({
  beginRun: async () => runCapability,
  stage: async () => { stageEntered.resolve(); return stageDeferred.promise; },
  probe: async () => inspection,
  normalize: async () => ({ credential, probe, anomalies: inspection.anomalies }),
  extractReviewFrames: async () => reviewFrames,
  verifyCredential: async () => inspection,
  verifyReviewRecord: async () => ({ schemaVersion: 1, credentialReceiptId: credential.receiptId, frames: [
    { role: "first", path: reviewFrames.firstFramePath, sha256: hex("a"), byteLength: 10, modifiedUnixMillis: 1787000000001 },
    { role: "middle", path: reviewFrames.middleFramePath, sha256: hex("b"), byteLength: 11, modifiedUnixMillis: 1787000000002 },
    { role: "last", path: reviewFrames.lastFramePath, sha256: hex("c"), byteLength: 12, modifiedUnixMillis: 1787000000003 }
  ], keyId: hex("d"), mac: hex("e") }),
  completeRun: async () => lifecycleCalls.push("complete"),
  cleanupRun: async () => lifecycleCalls.push("cleanup"),
  isOperationCurrent: () => operationLive,
  persistEvidenceCAS: (_operation, nextEvidence) => (casWrites.push(structuredClone(nextEvidence)), true),
  persistEvidence: () => { throw new Error("unguarded_persist_used"); },
  generateShot: async () => ({ ok: false })
});
const staleProcess = casController.processGeneratedShot({
  shotId: "s1", sequenceId: "sequence-a", operation, contractDigest: generationContractDigest,
  generatedVideoPath: "C:/generated/s1.mp4", durationFrames: 48, projectWidth: 1280, projectHeight: 720,
  routeDecision, accelerationMode: "standard", profilePreflight, boundary,
  generationReceipt: generationReceiptFor("C:/generated/s1.mp4")
});
await stageEntered.promise;
operationLive = false;
stageDeferred.resolve({ stagedPath: "C:/project/assets/video-staging/stage.media", projectAssetsDir: "C:/project/assets", stagingReceiptId: hex("4") });
await assert.rejects(staleProcess, /video_operation_stale/);
assert.equal(casWrites.some((item) => item.status === "ready"), false, "stale async completion must not publish ready evidence");
assert.deepEqual(lifecycleCalls, ["cleanup"], "stale run must be cleaned, never retained");

for (const failureMode of ["stale_during_retain", "cas_false_after_retain"]) {
  let live = true;
  const twoPhaseCalls = [];
  const twoPhaseController = createVideoProductionController({
    beginRun: async () => runCapability,
    stage: async () => ({ stagedPath: "C:/project/assets/video-staging/stage.media", projectAssetsDir: "C:/project/assets", stagingReceiptId: hex("4") }),
    probe: async () => inspection,
    normalize: async () => ({ credential, probe, anomalies: inspection.anomalies }),
    extractReviewFrames: async () => reviewFrames,
    verifyCredential: async () => inspection,
    verifyReviewRecord: async () => authenticatedReviewRecord,
    completeRun: async () => { twoPhaseCalls.push("retain"); if (failureMode === "stale_during_retain") live = false; },
    releaseRun: async () => twoPhaseCalls.push("release"),
    cleanupRun: async () => twoPhaseCalls.push("cleanup"),
    isOperationCurrent: () => live,
    persistEvidenceCAS: (_operation, nextEvidence) => failureMode !== "cas_false_after_retain" || nextEvidence.status !== "ready",
    persistEvidence: () => { throw new Error("unguarded_persist_used"); },
    generateShot: async () => ({ ok: false })
  });
  await assert.rejects(() => twoPhaseController.processGeneratedShot({
    shotId: "s1", sequenceId: "sequence-a", operation, contractDigest: generationContractDigest,
    generatedVideoPath: "C:/generated/s1.mp4", durationFrames: 48, projectWidth: 1280, projectHeight: 720,
    routeDecision, accelerationMode: "standard", profilePreflight, boundary,
    generationReceipt: generationReceiptFor("C:/generated/s1.mp4")
  }), /video_operation_stale/);
  assert.deepEqual(twoPhaseCalls, ["retain", "release"], `${failureMode} must discard the retained unpublished run`);
}

calls.length = 0;
await controller.rebuild({ kind: "adjacent_pair", shotIds: ["s2", "s3"], reason: "motion_boundary" }, async (shotId, generatedVideoPath) => {
  const rebuildOperation = createVideoOperationIdentity({ sequenceId: "sequence-a", shotId, contractDigest: generationContractDigest, sourceVideoPath: generatedVideoPath, boundaryIdentity: "rebuild", operationToken: `${shotId}-${hex("9")}` });
  return {
    shotId, sequenceId: "sequence-a", operation: rebuildOperation, contractDigest: generationContractDigest,
    generatedVideoPath, durationFrames: 48, projectWidth: 1280, projectHeight: 720,
    routeDecision, accelerationMode: "standard", profilePreflight, generationReceipt: generationReceiptFor(generatedVideoPath, rebuildOperation),
    boundary: { ...boundary, fromShotId: "s2", toShotId: "s3", kind: "continuous", requiresApproval: true, approvalStatus: "approved", sharedFramePath: "C:/boundary.png" }
  };
});
assert.deepEqual(calls.filter((item) => item.startsWith("generate:")), ["generate:s2", "generate:s3"]);

for (const failAt of ["generation", "resolve", "stage", "normalize", "verify"]) {
  let generatedCount = 0;
  let begunCount = 0;
  const cleanedRuns = [];
  const retainedRuns = [];
  const lifecycleController = createVideoProductionController({
    beginRun: async () => ({ ...runCapability, runId: (begunCount++ === 0 ? "6" : "7").repeat(64) }),
    stage: async ({ runCapability }) => {
      if (failAt === "stage" && begunCount === 2) throw new Error("second_stage_failed");
      return { stagedPath: `C:/project/assets/video-staging/${runCapability.runId}.media`, projectAssetsDir: "C:/project/assets", stagingReceiptId: hex("4") };
    },
    probe: async () => inspection,
    normalize: async () => { if (failAt === "normalize" && begunCount === 2) throw new Error("second_normalize_failed"); return { credential, probe, anomalies: inspection.anomalies }; },
    extractReviewFrames: async () => reviewFrames,
    verifyCredential: async () => { if (failAt === "verify" && begunCount === 2) throw new Error("second_verify_failed"); return inspection; },
    verifyReviewRecord: async () => authenticatedReviewRecord,
    completeRun: async ({ runCapability }) => retainedRuns.push(runCapability.runId),
    cleanupRun: async ({ runCapability }) => cleanedRuns.push(runCapability.runId),
    releaseRun: async ({ runCapability }) => cleanedRuns.push(`released:${runCapability.runId}`),
    persistEvidence: () => { throw new Error("pair_must_not_publish_individually"); },
    persistBatchCAS: async () => { throw new Error("failed_pair_must_not_publish"); },
    generateShot: async (shotId) => {
      generatedCount += 1;
      if (failAt === "generation" && generatedCount === 2) throw new Error("second_generation_failed");
      return { ok: true, generatedVideoPath: `C:/generated/${shotId}-${failAt}.mp4` };
    }
  });
  await assert.rejects(() => lifecycleController.rebuild({ kind: "adjacent_pair", shotIds: ["pair-a", "pair-b"], reason: "motion_boundary" }, async (shotId, generatedVideoPath) => {
    if (failAt === "resolve" && shotId === "pair-b") throw new Error("second_resolve_failed");
    const pairOperation = createVideoOperationIdentity({ sequenceId: "sequence-a", shotId, contractDigest: generationContractDigest, sourceVideoPath: generatedVideoPath, boundaryIdentity: "pair", operationToken: `${failAt}:${shotId}` });
    return { shotId, sequenceId: "sequence-a", operation: pairOperation, contractDigest: generationContractDigest, generatedVideoPath, durationFrames: 48, projectWidth: 1280, projectHeight: 720, routeDecision, accelerationMode: "standard", profilePreflight, generationReceipt: generationReceiptFor(generatedVideoPath, pairOperation), boundary };
  }), /second_/);
  assert.equal(cleanedRuns.filter((runId) => runId === hex("6")).length, 1, `${failAt}: first handed-off run must be cleaned exactly once`);
  assert.deepEqual(retainedRuns, [], `${failAt}: failed pair must not retain or publish a run`);
}

const componentBundlePath = join(process.cwd(), ".superpowers", "sdd", `.tmp-video-production-panel-${process.pid}-${Date.now()}.mjs`);
await build({
  entryPoints: ["src/modules/video-production/VideoProductionPanel.tsx"], outfile: componentBundlePath,
  bundle: true, platform: "node", format: "esm", jsx: "automatic",
  external: ["react", "react-dom", "react-dom/server", "zustand", "zustand/*", "use-sync-external-store", "use-sync-external-store/*", "@tauri-apps/api", "@tauri-apps/api/*"]
});
const panelModule = await import(`${pathToFileURL(componentBundlePath).href}?${Date.now()}`);
const gatewayCalls = [];
const unregisterGateway = panelModule.registerVideoProductionGateway({
  generateShot: async (shotId) => (gatewayCalls.push(["single", shotId]), true),
  generateBatch: async (shotIds) => (gatewayCalls.push(["batch", ...shotIds]), true)
});
assert.equal(await panelModule.generateQualityGatedVideoShot("gateway-one"), true);
assert.equal(await panelModule.generateQualityGatedVideoBatch(["gateway-one", "gateway-two", "gateway-one"]), true);
assert.deepEqual(gatewayCalls, [["single", "gateway-one"], ["batch", "gateway-one", "gateway-two"]]);
unregisterGateway();
const row = {
  sequenceId: "sequence-a", shotId: "s1", title: "开场", order: 1,
  selectedProfileId: "minimax_h3_flf2v", routeReason: "explicit_endpoints", manualProfileId: "auto",
  preflight: profilePreflight, reviewFrames: report.reviewFrames,
  characterReferences: ["C:/face.png", "C:/body.png"], sceneReferences: ["C:/scene.png"],
  boundaryFrame: "C:/boundary.png", artifactKey: `${credential.receiptId}:${credential.sha256}`,
  report
};
let selectedReason = "";
const interactions = [];
const props = {
  rows: [row], rejectionReasons: {},
  onReasonChange: (key, reason) => { selectedReason = reason; interactions.push(["reason", key, reason]); },
  onManualProfileChange: (shotId, profileId) => interactions.push(["override", shotId, profileId]),
  onApprove: (shotId) => interactions.push(["approve", shotId]),
  onRejectAndRebuild: (shotId, reason) => interactions.push(["reject", shotId, reason]),
  onRetryEvidence: (shotId) => interactions.push(["retry", shotId])
};
let tree = panelModule.VideoProductionPanelView(props);
/* Legacy encoding-sensitive interaction predicates are intentionally disabled.
findElement(tree, (node) => node.type === "select" && String(node.props["aria-label"] ?? "").includes("驳回原因")).props.onChange({ target: { value: "motion_boundary" } });
assert.equal(selectedReason, "motion_boundary");
tree = panelModule.VideoProductionPanelView({ ...props, rejectionReasons: { [row.artifactKey]: selectedReason } });
findElement(tree, (node) => node.type === "button" && textContent(node) === "驳回并局部重建").props.onClick();
findElement(tree, (node) => node.type === "select" && String(node.props["aria-label"] ?? "").includes("手动覆盖")).props.onChange({ target: { value: "minimax_h3_r2v" } });
findElement(tree, (node) => node.type === "button" && textContent(node) === "批准").props.onClick();
assert.deepEqual(interactions.map((item) => item[0]), ["reason", "reject", "override", "approve"]);
const markup = renderToStaticMarkup(React.createElement(panelModule.VideoProductionPanelView, { ...props, rejectionReasons: {} }));
for (const expected of ["minimax_h3_flf2v", "explicit_endpoints", "first.png", "middle.png", "last.png", "face.png", "scene.png", "boundary.png", "批准", "驳回并局部重建"]) assert.match(markup, new RegExp(expected));

*/
requireElement(tree, (node) => node.type === "select" && node.props.value === "").props.onChange({ target: { value: "motion_boundary" } });
assert.equal(selectedReason, "motion_boundary");
tree = panelModule.VideoProductionPanelView({ ...props, rejectionReasons: { [row.artifactKey]: selectedReason } });
requireElement(tree, (node) => node.type === "button" && node.props.className === "btn-danger").props.onClick();
requireElement(tree, (node) => node.type === "select" && node.props.value === "auto").props.onChange({ target: { value: "minimax_h3_r2v" } });
requireElement(tree, (node) => node.type === "button" && node.props.className === "btn-primary").props.onClick();
assert.deepEqual(interactions.map((item) => item[0]), ["reason", "reject", "override", "approve"]);
const markup = renderToStaticMarkup(React.createElement(panelModule.VideoProductionPanelView, { ...props, rejectionReasons: {} }));
for (const expected of ["minimax_h3_flf2v", "explicit_endpoints", "first.png", "middle.png", "last.png", "face.png", "scene.png", "boundary.png", "btn-primary", "btn-danger"]) assert.match(markup, new RegExp(expected));

const connectedStore = panelModule.videoProductionStoreHarness;
const originalConnectedState = connectedStore.getState();
const connectedOperation = createVideoOperationIdentity({ sequenceId: "sequence-connected", shotId: "connected-1", contractDigest: generationContractDigest, sourceVideoPath: "C:/generated/connected-1.mp4", boundaryIdentity: "connected-boundary", operationToken: hex("9") });
const connectedInput = { ...cleanInput, boundaryFrame: "C:/boundary/connected.png" };
const connectedReport = createVideoQualityReport("connected-1", connectedInput);
const connectedEvidence = {
  schemaVersion: 1, shotId: "connected-1", sequenceId: "sequence-connected", status: "ready", sourceVideoPath: connectedOperation.sourceVideoPath,
  contractDigest: generationContractDigest, boundaryIdentity: connectedOperation.boundaryIdentity, operation: connectedOperation,
  routeDecision, profilePreflight, projectAssetsDir: "C:/project/assets", runCapability,
  normalizationCredential: credential, inspection, reviewFrames, reviewRecord: authenticatedReviewRecord,
  artifactBinding: connectedReport.artifactBinding, qualityReport: connectedReport
};
const connectedShots = [{ id: "connected-1", sequenceId: "sequence-connected", order: 1, title: "connected first", durationFrames: 48, dialogue: "", notes: "", tags: [], videoPrompt: "first", videoWorkflowProfileId: "minimax_h3_flf2v", videoQualityTier: "production", videoAccelerationMode: "standard", videoBoundaryKind: "continuous", approvedBoundaryFramePath: "C:/boundary/connected.png", generatedImagePath: "C:/story/first.png", videoEndFramePath: "C:/story/end.png", generatedVideoPath: connectedOperation.sourceVideoPath, videoGenerationContractDigest: generationContractDigest, videoGenerationReceipt: generationReceiptFor(connectedOperation.sourceVideoPath, connectedOperation), videoProductionEvidence: connectedEvidence, videoQualityStatus: "needs_review" }, { id: "connected-2", sequenceId: "sequence-connected", order: 2, title: "connected second", durationFrames: 48, dialogue: "", notes: "", tags: [], videoPrompt: "second", videoWorkflowProfileId: "minimax_h3_i2v", videoQualityTier: "production", videoAccelerationMode: "standard", videoBoundaryKind: "hard_cut", generatedImagePath: "C:/story/second.png", videoQualityStatus: "pending" }];
const connectedCalls = [];
const connectedGenerator = {
  prepare: async (shotId, options) => ({ routeDecision, profilePreflight, generationContractDigest, request: { operationToken: options?.operationToken ?? hex("7"), outgoingBoundary: shotId === "connected-1" ? { id: "connected-1::connected-2", fromShotId: "connected-1", toShotId: "connected-2", kind: "continuous", approvalStatus: "approved", requiresApproval: true, sharedFramePath: "C:/boundary/connected.png" } : undefined } }),
  verifyReceipt: () => true,
  generate: async (shotId, options) => {
    const current = connectedStore.getState().shots.find((item) => item.id === shotId);
    connectedCalls.push(["generate", shotId, current?.videoWorkflowProfileId, options?.previousEvidence?.reviewFrames?.lastFramePath]);
    return { ok: true, generatedVideoPath: `C:/generated/${shotId}-rebuilt.mp4`, videoGenerationReceipt: { profileId: current?.videoWorkflowProfileId === "auto" ? "minimax_h3_i2v" : current?.videoWorkflowProfileId, accelerationMode: "standard", workflowDigest: hex("2"), inputDigest: hex("3"), promptId: `prompt-${shotId}`, generatedAt: "2026-08-18T00:00:00.000Z" }, generationContractDigest, routeDecision: { status: "selected", profileId: current?.videoWorkflowProfileId === "auto" ? "minimax_h3_i2v" : current?.videoWorkflowProfileId, reason: "manual_override" }, profilePreflight, request: { shot: current, boundary: undefined } };
  }
};
const connectedControllerFactory = (options) => ({
  processGeneratedShot: async (input) => { connectedCalls.push(["process", input.shotId]); options.persistEvidence(input.shotId, connectedEvidence); return connectedEvidence; },
  verifyForDecision: async (evidence) => { connectedCalls.push(["verify", evidence.shotId]); return connectedReport; },
  rebuild: async (request) => { let previousEvidence; for (const shotId of request.shotIds) { const generated = await options.generateShot(shotId, { request, previousEvidence }); connectedCalls.push(["rebuilt", shotId, generated.generatedVideoPath]); previousEvidence = connectedEvidence; } return []; }
});
const connectedSettings = { baseUrl: "http://127.0.0.1:8188", outputDir: "C:/out", comfyInputDir: "C:/in", comfyRootDir: "C:/comfy", imageWorkflowJson: "", videoWorkflowJson: "", tokenMapping: {} };
connectedStore.setState({ ...originalConnectedState, currentSequenceId: "sequence-connected", sequences: [{ id: "sequence-connected", projectId: originalConnectedState.project.id, name: "connected", order: 1 }], shots: connectedShots, assets: [] });
let connectedRenderer;
await act(async () => { connectedRenderer = TestRenderer.create(React.createElement(panelModule.VideoProductionPanel, { settings: connectedSettings, services: { routedGenerator: connectedGenerator, controllerFactory: connectedControllerFactory } })); });
const connectedRoot = connectedRenderer.root;
await act(async () => { connectedRoot.find((node) => node.type === "button" && node.props.className === "btn-primary" && node.props.disabled === false).props.onClick(); await Promise.resolve(); });
assert.equal(connectedStore.getState().shots[0].videoQualityStatus, "approved", "connected approve must persist in the real Zustand store");
await act(async () => { connectedRoot.find((node) => node.type === "select" && node.props.value === "minimax_h3_i2v").props.onChange({ target: { value: "minimax_h3_r2v" } }); });
assert.equal(connectedStore.getState().shots[1].videoWorkflowProfileId, "minimax_h3_r2v", "manual override must persist through the connected component");
connectedStore.setState((state) => ({ shots: state.shots.map((shot, index) => index === 0 ? { ...connectedShots[0], videoProductionEvidence: connectedEvidence } : shot) }));
await act(async () => {
  connectedRoot.findAll((node) => node.type === "select" && node.props.value === "")[0].props.onChange({ target: { value: "motion_boundary" } });
});
await act(async () => { connectedRoot.find((node) => node.type === "button" && node.props.className === "btn-danger" && node.props.disabled === false).props.onClick(); await Promise.resolve(); await Promise.resolve(); });
assert.deepEqual(connectedCalls.filter((item) => item[0] === "generate").map((item) => item[1]), ["connected-1", "connected-2"], "connected boundary rejection must rebuild the exact adjacent pair");
assert.equal(connectedCalls.find((item) => item[0] === "generate" && item[1] === "connected-2")[3], reviewFrames.lastFramePath, "connected pair must pass the fresh first member tail to the second");
await act(async () => { connectedRenderer.unmount(); });
connectedCalls.length = 0;
connectedStore.setState({ ...originalConnectedState, currentSequenceId: "sequence-connected", sequences: [{ id: "sequence-connected", projectId: originalConnectedState.project.id, name: "connected", order: 1 }], shots: [{ ...connectedShots[0], videoProductionEvidence: undefined, videoQualityStatus: "pending" }], assets: [] });
await act(async () => { connectedRenderer = TestRenderer.create(React.createElement(panelModule.VideoProductionPanel, { settings: connectedSettings, services: { routedGenerator: connectedGenerator, controllerFactory: connectedControllerFactory } })); await Promise.resolve(); });
assert.equal(connectedCalls.some((item) => item[0] === "process"), true, "initial generated path must run the connected processing effect");
await act(async () => { connectedRenderer.unmount(); });

for (const [label, mutate] of [
  ["media", () => connectedStore.getState().updateShotFields("connected-1", { generatedVideoPath: "C:/generated/replaced.mp4" })],
  ["profile", () => connectedStore.getState().updateShotFields("connected-1", { videoWorkflowProfileId: "minimax_h3_i2v" })],
  ["boundary", () => connectedStore.getState().updateShotFields("connected-1", { approvedBoundaryFramePath: "C:/boundary/replaced.png" })],
  ["sequence", () => connectedStore.setState({ currentSequenceId: "sequence-other" })]
]) {
  connectedStore.setState({ ...originalConnectedState, currentSequenceId: "sequence-connected", sequences: [{ id: "sequence-connected", projectId: originalConnectedState.project.id, name: "connected", order: 1 }, { id: "sequence-other", projectId: originalConnectedState.project.id, name: "other", order: 2 }], shots: [{ ...connectedShots[0], videoProductionEvidence: connectedEvidence }], assets: [] });
  const verifyGate = deferred();
  const deferredFactory = (options) => ({ processGeneratedShot: async () => connectedEvidence, verifyForDecision: async () => verifyGate.promise, rebuild: async () => [] });
  await act(async () => { connectedRenderer = TestRenderer.create(React.createElement(panelModule.VideoProductionPanel, { settings: connectedSettings, services: { routedGenerator: connectedGenerator, controllerFactory: deferredFactory } })); });
  act(() => { connectedRenderer.root.find((node) => node.type === "button" && node.props.className === "btn-primary" && node.props.disabled === false).props.onClick(); });
  mutate();
  verifyGate.resolve(connectedReport);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.notEqual(connectedStore.getState().shots[0].videoQualityStatus, "approved", `deferred ${label} replacement/switch must discard stale approval`);
  await act(async () => { connectedRenderer.unmount(); });
}

for (const decisionKind of ["approve", "reject"]) for (const replacementKind of ["media", "profile", "boundary", "sequence"]) {
  const rejectGate = deferred();
  connectedStore.setState({ ...originalConnectedState, currentSequenceId: "sequence-connected", sequences: [{ id: "sequence-connected", projectId: originalConnectedState.project.id, name: "connected", order: 1 }, { id: "sequence-other", projectId: originalConnectedState.project.id, name: "other", order: 2 }], shots: [{ ...connectedShots[0], videoProductionEvidence: connectedEvidence }], assets: [] });
  const rejectingFactory = () => ({ processGeneratedShot: async () => connectedEvidence, verifyForDecision: async () => rejectGate.promise, rebuild: async () => [] });
  await act(async () => { connectedRenderer = TestRenderer.create(React.createElement(panelModule.VideoProductionPanel, { settings: connectedSettings, services: { routedGenerator: connectedGenerator, controllerFactory: rejectingFactory } })); });
  if (decisionKind === "reject") await act(async () => { connectedRenderer.root.findAll((node) => node.type === "select" && node.props.value === "")[0].props.onChange({ target: { value: "motion_boundary" } }); });
  act(() => { connectedRenderer.root.find((node) => node.type === "button" && node.props.className === (decisionKind === "approve" ? "btn-primary" : "btn-danger") && node.props.disabled === false).props.onClick(); });
  if (replacementKind === "sequence") connectedStore.setState({ currentSequenceId: "sequence-other" });
  else connectedStore.setState((state) => ({ shots: state.shots.map((shot) => {
    if (shot.id !== "connected-1") return shot;
    const replacementPath = replacementKind === "media" ? "C:/generated/replacement.mp4" : shot.generatedVideoPath;
    const replacementEvidence = { ...shot.videoProductionEvidence, sourceVideoPath: replacementPath, contractDigest: hex("6"), operation: { ...shot.videoProductionEvidence.operation, sourceVideoPath: replacementPath, contractDigest: hex("6"), operationToken: hex("5") } };
    return { ...shot, generatedVideoPath: replacementPath, videoGenerationContractDigest: hex("6"), videoWorkflowProfileId: replacementKind === "profile" ? "minimax_h3_i2v" : shot.videoWorkflowProfileId, approvedBoundaryFramePath: replacementKind === "boundary" ? "C:/boundary/replacement.png" : shot.approvedBoundaryFramePath, videoProductionEvidence: replacementEvidence };
  }) }));
  const replacementSnapshot = { currentSequenceId: connectedStore.getState().currentSequenceId, shots: structuredClone(connectedStore.getState().shots) };
  rejectGate.reject(new Error("backend_review_rejected"));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.deepEqual({ currentSequenceId: connectedStore.getState().currentSequenceId, shots: connectedStore.getState().shots }, replacementSnapshot, `deferred ${decisionKind} verification failure after ${replacementKind} replacement must be a CAS no-op`);
  await act(async () => { connectedRenderer.unmount(); });
}

const duplicateOtherEvidence = { ...connectedEvidence, sequenceId: "sequence-other", operation: { ...connectedOperation, sequenceId: "sequence-other", operationToken: hex("4") } };
connectedStore.setState({ ...originalConnectedState, currentSequenceId: "sequence-other", sequences: [{ id: "sequence-connected", projectId: originalConnectedState.project.id, name: "connected", order: 1 }, { id: "sequence-other", projectId: originalConnectedState.project.id, name: "other", order: 2 }], shots: [{ ...connectedShots[0], videoProductionEvidence: connectedEvidence }, { ...connectedShots[0], sequenceId: "sequence-other", videoProductionEvidence: duplicateOtherEvidence }], assets: [] });
const duplicateSnapshot = { currentSequenceId: connectedStore.getState().currentSequenceId, shots: structuredClone(connectedStore.getState().shots) };
assert.equal(panelModule.persistDecisionFailureCAS(connectedEvidence, new Error("backend_review_rejected")), false);
assert.deepEqual({ currentSequenceId: connectedStore.getState().currentSequenceId, shots: connectedStore.getState().shots }, duplicateSnapshot, "duplicate shot IDs in another sequence must not receive stale decision failure");

const partialOldPaths = [connectedShots[0].generatedVideoPath, "C:/generated/connected-2-old.mp4"];
const connectedSecondEvidence = { ...connectedEvidence, shotId: "connected-2", sourceVideoPath: partialOldPaths[1], operation: { ...connectedOperation, shotId: "connected-2", sourceVideoPath: partialOldPaths[1], operationToken: hex("8") }, qualityReport: { ...connectedReport, shotId: "connected-2" } };
connectedStore.setState({ ...originalConnectedState, currentSequenceId: "sequence-connected", sequences: [{ id: "sequence-connected", projectId: originalConnectedState.project.id, name: "connected", order: 1 }], shots: [{ ...connectedShots[0], videoProductionEvidence: connectedEvidence }, { ...connectedShots[1], generatedVideoPath: partialOldPaths[1], videoGenerationContractDigest: generationContractDigest, videoProductionEvidence: connectedSecondEvidence, videoQualityStatus: "approved" }], assets: [] });
let partialRetryCount = 0;
const partialFactory = (options) => ({
  processGeneratedShot: async (input) => { partialRetryCount += 1; options.persistEvidence(input.shotId, connectedEvidence); return connectedEvidence; },
  verifyForDecision: async () => connectedReport,
  rebuild: async (request) => { await options.generateShot(request.shotIds[0], { request }); throw new Error("second_generation_failed"); }
});
await act(async () => { connectedRenderer = TestRenderer.create(React.createElement(panelModule.VideoProductionPanel, { settings: connectedSettings, services: { routedGenerator: connectedGenerator, controllerFactory: partialFactory } })); });
await act(async () => { connectedRenderer.root.findAll((node) => node.type === "select" && node.props.value === "")[0].props.onChange({ target: { value: "motion_boundary" } }); });
await act(async () => { connectedRenderer.root.find((node) => node.type === "button" && node.props.className === "btn-danger" && node.props.disabled === false).props.onClick(); await Promise.resolve(); await Promise.resolve(); });
assert.deepEqual(connectedStore.getState().shots.map((shot) => shot.generatedVideoPath), partialOldPaths, "partial pair failure must not publish either generated member");
assert.deepEqual(connectedStore.getState().shots.map((shot) => shot.videoQualityStatus), ["rejected", "rejected"], "partial pair failure must mark the whole boundary pair failed/stale");
act(() => { connectedRenderer.root.findAll((node) => node.type === "button" && node.props.className === "btn-ghost")[0].props.onClick(); });
await Promise.resolve();
await Promise.resolve();
assert.equal(partialRetryCount, 1, "retry UI must invoke connected evidence processing after a retryable pair failure");
await act(async () => { connectedRenderer.unmount(); });
let settingsRecoveryCount = 0;
const failedForRecovery = { ...connectedEvidence, status: "failed", failureReason: "video_inventory_http_failed" };
connectedStore.setState({ ...originalConnectedState, currentSequenceId: "sequence-connected", sequences: [{ id: "sequence-connected", projectId: originalConnectedState.project.id, name: "connected", order: 1 }], shots: [{ ...connectedShots[0], videoProductionEvidence: failedForRecovery, videoQualityStatus: "rejected" }], assets: [] });
const recoveryFactory = (options) => ({ processGeneratedShot: async (input) => { settingsRecoveryCount += 1; const freshEvidence = { ...connectedEvidence, operation: input.operation }; options.persistEvidence(input.shotId, freshEvidence); return freshEvidence; }, verifyForDecision: async () => connectedReport, rebuild: async () => [] });
await act(async () => { connectedRenderer = TestRenderer.create(React.createElement(panelModule.VideoProductionPanel, { settings: connectedSettings, services: { routedGenerator: connectedGenerator, controllerFactory: recoveryFactory } })); await Promise.resolve(); });
const firstRecoveryCount = settingsRecoveryCount;
await act(async () => { connectedRenderer.update(React.createElement(panelModule.VideoProductionPanel, { settings: { ...connectedSettings, baseUrl: "http://127.0.0.1:8288" }, services: { routedGenerator: connectedGenerator, controllerFactory: recoveryFactory } })); await Promise.resolve(); });
assert.equal(firstRecoveryCount >= 1, true, "retryable inventory failure must process on mount");
assert.equal(settingsRecoveryCount > firstRecoveryCount, true, "Comfy URL change must retry failed live preflight/evidence processing");
await act(async () => { connectedRenderer.unmount(); });

const oldInventoryGate = deferred();
let oldInventoryCount = 0;
let newInventoryCount = 0;
const oldUrlGenerator = { ...connectedGenerator, prepare: async () => { oldInventoryCount += 1; return oldInventoryGate.promise; } };
const newUrlGenerator = { ...connectedGenerator, prepare: async (shotId, options) => { newInventoryCount += 1; return connectedGenerator.prepare(shotId, options); } };
connectedStore.setState({ ...originalConnectedState, currentSequenceId: "sequence-connected", sequences: [{ id: "sequence-connected", projectId: originalConnectedState.project.id, name: "connected", order: 1 }], shots: [{ ...connectedShots[0], videoProductionEvidence: failedForRecovery, videoQualityStatus: "rejected" }], assets: [] });
await act(async () => { connectedRenderer = TestRenderer.create(React.createElement(panelModule.VideoProductionPanel, { settings: connectedSettings, services: { routedGenerator: oldUrlGenerator, controllerFactory: recoveryFactory } })); await Promise.resolve(); });
assert.equal(oldInventoryCount, 1);
await act(async () => { connectedRenderer.update(React.createElement(panelModule.VideoProductionPanel, { settings: { ...connectedSettings, baseUrl: "http://127.0.0.1:8388" }, services: { routedGenerator: newUrlGenerator, controllerFactory: recoveryFactory } })); await Promise.resolve(); });
assert.equal(newInventoryCount, 1, "new base URL inventory must start while old inventory is still pending");
const freshUrlSnapshot = structuredClone(connectedStore.getState().shots);
oldInventoryGate.reject(new Error("old_inventory_http_failed"));
await act(async () => { await Promise.resolve(); await Promise.resolve(); });
assert.deepEqual(connectedStore.getState().shots, freshUrlSnapshot, "superseded old URL failure must not overwrite fresh evidence");
await act(async () => { connectedRenderer.unmount(); });
connectedStore.setState(originalConnectedState);

const comfyPanelSource = await readFile("src/modules/comfy-pipeline/ComfyPipelinePanel.tsx", "utf8");
assert.match(comfyPanelSource, /<VideoProductionPanel[^>]*settings=\{settings\}/);
assert.doesNotMatch(comfyPanelSource, /<VideoProductionPanel[^>]*onGenerateShot=/);
assert.equal((comfyPanelSource.match(/VideoProductionPanel/g) ?? []).length, 3);
const singleCallbackSource = comfyPanelSource.slice(comfyPanelSource.indexOf("const onGenerateSingle"), comfyPanelSource.indexOf("const onGenerateImages"));
assert.equal(singleCallbackSource.indexOf("generateQualityGatedVideoShot") < singleCallbackSource.indexOf("generateShotAsset"), true, "real single-video callback must route before the generic asset executor");
const bulkCallbackSource = comfyPanelSource.slice(comfyPanelSource.indexOf("const onGenerateVideos"), comfyPanelSource.indexOf("const onExportAnimatic"));
assert.match(bulkCallbackSource, /return await generateQualityGatedVideoBatch/);
const css = await readFile("src/styles/global.css", "utf8");
for (const selector of ["video-quality-card", "video-quality-actions", "video-review-strip", "video-quality-grid"]) {
  const unsafe = new RegExp(`^\\.${selector}(?![^,{]*\\.video-production-panel)`, "m");
  assert.equal(unsafe.test(css.slice(css.indexOf(".video-production-panel {"))), false, `${selector} must be panel-scoped`);
}
await unlink(componentBundlePath);
console.log("PASS video quality gate: fail-closed receipts, bound decisions, controller, interactions, and rebuild scope");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function findElement(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function requireElement(node, predicate) {
  const found = findElement(node, predicate);
  if (!found) throw new Error("component element not found");
  return found;
}

function textContent(node) {
  return React.Children.toArray(node.props?.children).map((child) => typeof child === "string" ? child : typeof child === "number" ? String(child) : "").join("");
}
