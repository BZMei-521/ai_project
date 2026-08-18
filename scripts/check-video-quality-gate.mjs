import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  applyVideoQualityDecision,
  createVideoQualityReport,
  evaluateVideoQuality,
  planVideoRebuildRequest
} from "../src/modules/video-production/videoQualityRuntime.mjs";

const cleanInput = {
  normalized: true,
  blackFrameCount: 0,
  freezeDurationSeconds: 0,
  timestampErrors: 0,
  identityEvaluatorAvailable: false
};

assert.equal(evaluateVideoQuality({ ...cleanInput, normalized: false }).status, "rejected");
assert.equal(evaluateVideoQuality(cleanInput).status, "needs_review");
assert.equal(evaluateVideoQuality({ ...cleanInput, blackFrameCount: 1 }).status, "rejected");
assert.equal(evaluateVideoQuality({ ...cleanInput, freezeDurationSeconds: 0.501 }).status, "rejected");
assert.equal(evaluateVideoQuality({ ...cleanInput, timestampErrors: 1 }).status, "rejected");
assert.equal(evaluateVideoQuality({
  ...cleanInput,
  inspection: {
    probe: { hasMonotonicTimestamps: false, hasConstantFrameTimestamps: true },
    anomalies: { blackIntervals: [], freezeIntervals: [] }
  }
}).status, "rejected");
assert.equal(evaluateVideoQuality({
  ...cleanInput,
  inspection: {
    probe: { hasMonotonicTimestamps: true, hasConstantFrameTimestamps: true },
    anomalies: { blackIntervals: [{ startSeconds: 0, endSeconds: 0.1, durationSeconds: 0.1 }], freezeIntervals: [] }
  }
}).status, "rejected");
assert.equal(evaluateVideoQuality({
  ...cleanInput,
  inspection: {
    probe: { hasMonotonicTimestamps: true, hasConstantFrameTimestamps: true },
    anomalies: { blackIntervals: [], freezeIntervals: [{ startSeconds: 0, endSeconds: 0.6, durationSeconds: 0.6 }] }
  }
}).status, "rejected");

// Supplied Task 7 receipts are fail-closed: unknown/tampered states cannot be reviewed or approved.
assert.equal(evaluateVideoQuality({ ...cleanInput, normalizationReceipt: { status: "mystery" } }).status, "rejected");
assert.equal(evaluateVideoQuality({ ...cleanInput, normalizationReceipt: { status: "verified", tampered: true } }).status, "rejected");
assert.equal(evaluateVideoQuality({ ...cleanInput, assemblyReceipt: { status: "invalid" } }).status, "rejected");
assert.equal(evaluateVideoQuality({ ...cleanInput, normalizationReceipt: { status: "verified", receiptId: "r1" } }).status, "needs_review");

// Runtime is deterministic and does not mutate legacy/partial inputs.
const partial = { normalized: true, reviewFrames: { firstFramePath: "first.png" } };
const partialSnapshot = structuredClone(partial);
const partialA = createVideoQualityReport(" shot-b ", partial);
const partialB = createVideoQualityReport(" shot-b ", partial);
assert.deepEqual(partial, partialSnapshot);
assert.deepEqual(partialA, partialB);
assert.deepEqual(partialA.reviewFrames, { first: "first.png", middle: "", last: "" });
assert.deepEqual(partialA.semanticReviewItems, [
  "character_identity",
  "scene_anchor",
  "costume_prop",
  "motion_boundary",
  "color_continuity"
]);

const report = createVideoQualityReport("shot-a", {
  ...cleanInput,
  reviewFrames: { firstFramePath: "first.png", middleFramePath: "middle.png", lastFramePath: "last.png" },
  boundaryFrame: "boundary.png"
});
assert.equal(report.status, "needs_review");
assert.deepEqual(report.reviewFrames, { first: "first.png", middle: "middle.png", last: "last.png" });
assert.throws(() => applyVideoQualityDecision(report, { decision: "reject", reason: "  " }), /rejection_reason_required/);
assert.equal(applyVideoQualityDecision(report, { decision: "approve", reviewedAt: "2026-08-18T01:02:03.000Z" }).status, "approved");
assert.equal(applyVideoQualityDecision(report, { decision: "approve" }).reviewedByUserAt.length > 0, true);
assert.equal(applyVideoQualityDecision({ ...report, status: "rejected" }, { decision: "approve" }).status, "rejected");
const rejected = applyVideoQualityDecision(report, { decision: "reject", reason: "character_identity" });
assert.equal(rejected.status, "rejected");
assert.equal(rejected.rejectionReason, "character_identity");

const orderedShotIds = ["s1", "s2", "s3", "s4"];
assert.deepEqual(planVideoRebuildRequest({ shotId: "s2", orderedShotIds, reason: "character_identity" }), {
  kind: "shot",
  shotIds: ["s2"],
  reason: "character_identity"
});
assert.deepEqual(planVideoRebuildRequest({
  shotId: "s2",
  orderedShotIds,
  reason: "motion_boundary",
  boundary: { kind: "continuous", fromShotId: "s2", toShotId: "s3" }
}), { kind: "adjacent_pair", shotIds: ["s2", "s3"], reason: "motion_boundary" });
assert.deepEqual(planVideoRebuildRequest({
  shotId: "s2",
  orderedShotIds,
  reason: "motion_boundary",
  boundary: { kind: "hard_cut", fromShotId: "s2", toShotId: "s3" }
}), { kind: "shot", shotIds: ["s2"], reason: "motion_boundary" });
assert.throws(() => planVideoRebuildRequest({
  shotId: "s1",
  orderedShotIds,
  reason: "motion_boundary",
  boundary: { kind: "continuous", fromShotId: "s1", toShotId: "s4" }
}), /boundary_shots_not_adjacent/);
assert.deepEqual(orderedShotIds, ["s1", "s2", "s3", "s4"]);

// Bundle and server-render the actual component, then check the required review affordances.
const componentBundlePath = join(process.cwd(), ".superpowers", "sdd", `.tmp-video-production-panel-${process.pid}-${Date.now()}.mjs`);
await build({
  entryPoints: ["src/modules/video-production/VideoProductionPanel.tsx"],
  outfile: componentBundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  external: [
    "react", "react-dom", "react-dom/server",
    "zustand", "zustand/*", "use-sync-external-store", "use-sync-external-store/*",
    "@tauri-apps/api", "@tauri-apps/api/*"
  ]
});
const { VideoProductionPanelView } = await import(`${pathToFileURL(componentBundlePath).href}?${Date.now()}`);
const markup = renderToStaticMarkup(React.createElement(VideoProductionPanelView, {
  rows: [{
    shotId: "s1",
    title: "开场",
    order: 1,
    selectedProfileId: "minimax_h3_flf2v",
    routeReason: "explicit_endpoints",
    manualProfileId: "auto",
    preflight: { available: false, missingNodes: ["MiniMaxH3ImageToVideo"], missingModels: ["h3.safetensors"] },
    reviewFrames: { first: "C:/first.png", middle: "C:/middle.png", last: "C:/last.png" },
    characterReferences: ["C:/face.png", "C:/body.png"],
    sceneReferences: ["C:/scene.png"],
    boundaryFrame: "C:/boundary.png",
    report: { ...report, structuralIssues: ["black_frames_detected"] }
  }],
  onManualProfileChange() {},
  onApprove() {},
  onRejectAndRebuild() {}
}));
for (const expected of [
  "minimax_h3_flf2v", "explicit_endpoints", "MiniMaxH3ImageToVideo", "h3.safetensors",
  "first.png", "middle.png", "last.png", "face.png", "body.png", "scene.png", "boundary.png",
  "black_frames_detected", "批准", "驳回并局部重建", "驳回原因"
]) assert.match(markup, new RegExp(expected));
assert.match(markup, /disabled=""[^>]*>驳回并局部重建|disabled[^>]*>驳回并局部重建/);

const comfyPanelSource = await readFile("src/modules/comfy-pipeline/ComfyPipelinePanel.tsx", "utf8");
assert.match(comfyPanelSource, /import\s+\{\s*VideoProductionPanel\s*\}\s+from\s+["']\.\.\/video-production\/VideoProductionPanel["']/);
assert.match(comfyPanelSource, /<VideoProductionPanel\s*\/>/);
assert.equal((comfyPanelSource.match(/<VideoProductionPanel\s*\/>/g) ?? []).length, 1, "Comfy panel must mount the child exactly once");
assert.equal((comfyPanelSource.match(/VideoProductionPanel/g) ?? []).length, 3, "Comfy panel must contain only identifier, import path, and mount");

await unlink(componentBundlePath);

console.log("video quality gate checks passed");
