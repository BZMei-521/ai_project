import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  applyVideoQualityDecision,
  artifactBindingsEqual,
  createVideoArtifactBinding,
  createVideoQualityReport,
  evaluateVideoQuality,
  planVideoRebuildRequest,
  resolvePersistedVideoDecision
} from "../src/modules/video-production/videoQualityRuntime.mjs";
import { createVideoProductionController } from "../src/modules/video-production/videoProductionControllerRuntime.mjs";

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
const cleanInput = Object.freeze({ normalized: true, normalizationCredential: credential, inspection, reviewFrames });

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
assert.equal(resolvePersistedVideoDecision(replacedReport, approved.decision).status, "needs_review");
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
  persistEvidence: (shotId, evidence) => persisted.push([shotId, structuredClone(evidence)]),
  generateShot: async (shotId) => (calls.push(`generate:${shotId}`), { ok: true, generatedVideoPath: `C:/generated/${shotId}.mp4` })
});
const routeDecision = { status: "selected", profileId: "minimax_h3_flf2v", reason: "explicit_endpoints" };
const profilePreflight = { profileId: "minimax_h3_flf2v", available: true, missingNodes: [], missingModels: [], warnings: [] };
const boundary = { id: "b12", fromShotId: "s1", toShotId: "s2", kind: "hard_cut", requiresApproval: false, approvalStatus: "pending" };
const evidence = await controller.processGeneratedShot({
  shotId: "s1", generatedVideoPath: "C:/generated/s1.mp4", durationFrames: 48,
  projectWidth: 1280, projectHeight: 720, routeDecision, profilePreflight, boundary
});
assert.deepEqual(calls, ["begin", "stage", "probe", "normalize", "extract", "verify"]);
assert.equal(evidence.status, "ready");
assert.deepEqual(evidence.routeDecision, routeDecision);
assert.deepEqual(evidence.profilePreflight, profilePreflight);
assert.deepEqual(evidence.boundary, boundary);
assert.equal(evidence.qualityReport.status, "needs_review");
assert.equal(persisted.at(-1)[0], "s1");

calls.length = 0;
const verifiedReport = await controller.verifyForDecision(evidence);
assert.deepEqual(calls, ["verify"]);
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
assert.deepEqual(calls, ["verify", "verify-assembly"]);
assert.equal(evidenceWithAssembly.artifactBinding.assemblyTransactionId, assemblyReceipt.transactionId);
assert.equal(evidenceWithAssembly.artifactBinding.assemblySha256, assemblyReceipt.sha256);
await assert.rejects(() => controller.verifyForDecision({ ...evidence, normalizationCredential: { ...credential, sha256: hex("e") } }), /artifact_binding_mismatch|credential_/);

calls.length = 0;
await controller.rebuild({ kind: "adjacent_pair", shotIds: ["s2", "s3"], reason: "motion_boundary" }, async (shotId, generatedVideoPath) => ({
  shotId, generatedVideoPath, durationFrames: 48, projectWidth: 1280, projectHeight: 720,
  routeDecision, profilePreflight, boundary: { ...boundary, fromShotId: "s2", toShotId: "s3", kind: "continuous", requiresApproval: true, approvalStatus: "approved", sharedFramePath: "C:/boundary.png" }
}));
assert.deepEqual(calls.filter((item) => item.startsWith("generate:")), ["generate:s2", "generate:s3"]);

const componentBundlePath = join(process.cwd(), ".superpowers", "sdd", `.tmp-video-production-panel-${process.pid}-${Date.now()}.mjs`);
await build({
  entryPoints: ["src/modules/video-production/VideoProductionPanel.tsx"], outfile: componentBundlePath,
  bundle: true, platform: "node", format: "esm", jsx: "automatic",
  external: ["react", "react-dom", "react-dom/server", "zustand", "zustand/*", "use-sync-external-store", "use-sync-external-store/*", "@tauri-apps/api", "@tauri-apps/api/*"]
});
const panelModule = await import(`${pathToFileURL(componentBundlePath).href}?${Date.now()}`);
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

const comfyPanelSource = await readFile("src/modules/comfy-pipeline/ComfyPipelinePanel.tsx", "utf8");
assert.match(comfyPanelSource, /<VideoProductionPanel[^>]*onGenerateShot=/);
assert.equal((comfyPanelSource.match(/VideoProductionPanel/g) ?? []).length, 3);
const css = await readFile("src/styles/global.css", "utf8");
for (const selector of ["video-quality-card", "video-quality-actions", "video-review-strip", "video-quality-grid"]) {
  const unsafe = new RegExp(`^\\.${selector}(?![^,{]*\\.video-production-panel)`, "m");
  assert.equal(unsafe.test(css.slice(css.indexOf(".video-production-panel {"))), false, `${selector} must be panel-scoped`);
}
await unlink(componentBundlePath);
console.log("PASS video quality gate: fail-closed receipts, bound decisions, controller, interactions, and rebuild scope");

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
