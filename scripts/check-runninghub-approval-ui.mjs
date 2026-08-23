import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { act } from "react-test-renderer";

import {
  createRunningHubApprovalSnapshot,
  transitionRunningHubState,
  validateRunningHubApproval
} from "../src/modules/video-production/runningHubApprovalRuntime.mjs";
import { recordRunningHubSubmission, classifyRunningHubResult, RIFE_ERROR_SIGNATURE } from "../src/modules/video-production/runningHubResult.mjs";

const approvalInput = Object.freeze({
  shotId: "shot-runninghub-ui",
  workflowId: "2090035427871903746",
  workflowUrl: "https://www.runninghub.cn/workflow/2090035427871903746?source=workspace",
  references: Object.freeze(["C:/project/characters/lin-yue.png", "C:/project/characters/lan.png"]),
  prompt: "Lin Yue hands Lan the compass while the camera tracks around them.",
  width: 1344,
  height: 768,
  durationSeconds: 8,
  createdAt: "2026-08-20T00:00:00.000Z"
});
const approval = createRunningHubApprovalSnapshot(approvalInput);

// The mocked boundary is intentionally the only place that could represent a
// paid cloud submission.  `recordRunningHubSubmission` must reject it before
// approval, before this mock observes any side effect.
let mockedSubmitCalls = 0;
const submitMockedCloudTask = (state) => {
  const submission = recordRunningHubSubmission({ approval, taskId: "2026082001", state });
  mockedSubmitCalls += 1;
  return submission;
};
let lifecycleState = { status: "local_default" };
lifecycleState = transitionRunningHubState(lifecycleState, { type: "RECOMMEND_CLOUD" });
lifecycleState = transitionRunningHubState(lifecycleState, { type: "REQUEST_APPROVAL" });
assert.throws(() => submitMockedCloudTask(lifecycleState), /runninghub_state_transition_invalid/);
assert.equal(mockedSubmitCalls, 0, "submission must not occur before approval");
assert.equal(
  validateRunningHubApproval(approval, { ...approvalInput, prompt: "Changed wolf interaction prompt." }, new Set()).reason,
  "approval_input_changed",
  "a prompt edit must invalidate the approval digest"
);
lifecycleState = transitionRunningHubState(lifecycleState, { type: "APPROVE" });
lifecycleState = submitMockedCloudTask(lifecycleState);
assert.equal(mockedSubmitCalls, 1, "the mocked boundary may observe one submission only after approval");
// The persisted state machine records an explicit poll before it classifies a
// recovered primary output; this preserves the required submitted-to-recovery
// lifecycle without pretending that a real cloud task was run.
lifecycleState = transitionRunningHubState(lifecycleState, { type: "POLL_RUNNING" });
assert.deepEqual(
  classifyRunningHubResult({ taskStatus: "failed", validMp4: true, downstreamError: RIFE_ERROR_SIGNATURE }),
  { status: "recovered_primary_output", warning: "rife_postprocess_failed_primary_output_recovered" }
);
lifecycleState = transitionRunningHubState(lifecycleState, { type: "RECOVER_PRIMARY_OUTPUT" });
lifecycleState = transitionRunningHubState(lifecycleState, { type: "CHECK_WATERMARK" });
lifecycleState = transitionRunningHubState(lifecycleState, { type: "BEGIN_QUALITY_REVIEW" });
lifecycleState = transitionRunningHubState(lifecycleState, { type: "ACCEPT" });
assert.equal(lifecycleState.status, "accepted");
assert.throws(() => transitionRunningHubState(lifecycleState, { type: "POLL_RUNNING" }), /cloud_state_terminal/);

const checkerSource = await readFile(new URL(import.meta.url), "utf8");
assert.match(
  checkerSource,
  /await withTemporaryBundles\(\[bundlePath, handoffBundlePath\], async \(\) => \{/,
  "both dynamic bundle paths must be in one failure-safe cleanup scope"
);

async function withTemporaryBundles(bundlePaths, run) {
  try {
    return await run();
  } finally {
    await Promise.all(bundlePaths.map((path) => unlink(path).catch(() => {})));
  }
}

const cleanupProbeDirectory = await mkdtemp(join(tmpdir(), "runninghub-approval-cleanup-"));
const cleanupProbePath = join(cleanupProbeDirectory, "failed-bundle.mjs");
try {
  await writeFile(cleanupProbePath, "temporary bundle");
  await assert.rejects(
    () => withTemporaryBundles([cleanupProbePath], async () => { throw new Error("cleanup_probe_failure"); }),
    /cleanup_probe_failure/
  );
  await assert.rejects(() => readFile(cleanupProbePath), { code: "ENOENT" });
} finally {
  await rm(cleanupProbeDirectory, { recursive: true, force: true });
}

const bundlePath = join(process.cwd(), ".superpowers", "sdd", `.tmp-runninghub-approval-${process.pid}-${Date.now()}.mjs`);
const handoffBundlePath = join(process.cwd(), ".superpowers", "sdd", `.tmp-runninghub-handoff-${process.pid}-${Date.now()}.mjs`);
await withTemporaryBundles([bundlePath, handoffBundlePath], async () => {
await build({
  entryPoints: ["src/modules/video-production/RunningHubApprovalPanel.tsx"],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  external: ["react", "react-dom", "react-dom/server", "@tauri-apps/api", "@tauri-apps/api/*"]
});
const panelModule = await import(`${pathToFileURL(bundlePath).href}?${Date.now()}`);

let prepareCalls = 0;
let continueCalls = 0;
let cancelCalls = 0;
const element = React.createElement(panelModule.RunningHubApprovalPanel, {
  approval,
  recommendationReasons: ["character_contact", "combined_subject_camera_motion"],
  onPrepare: async () => { prepareCalls += 1; },
  onContinueLocal: () => { continueCalls += 1; },
  onCancel: () => { cancelCalls += 1; }
});
const markup = renderToStaticMarkup(element);
for (const expected of [
  "2090035427871903746", "1344", "768", "16:9", "0.9MP", "8", approval.prompt,
  "可能产生费用", "RunningHub", "水印", "确认并打开 RunningHub", "继续本地", "取消"
]) assert.match(markup, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.equal((markup.match(/<img/g) ?? []).length, 2, "approval UI must render exactly two reference previews");
assert.equal(prepareCalls, 0, "render must not prepare or open a handoff");

const renderer = TestRenderer.create(element);
const root = renderer.root;
const confirm = root.find((node) => node.type === "button" && node.props["data-runninghub-action"] === "confirm");
await act(async () => { await confirm.props.onClick(); });
assert.equal(prepareCalls, 1, "confirmation must prepare exactly one handoff");
assert.equal(renderer.root.find((node) => node.type === "button" && node.props["data-runninghub-action"] === "confirm").props.disabled, true, "confirmation must become one-use after success");
await act(async () => { await renderer.root.find((node) => node.type === "button" && node.props["data-runninghub-action"] === "continue-local").props.onClick(); });
await act(async () => { await renderer.root.find((node) => node.type === "button" && node.props["data-runninghub-action"] === "cancel").props.onClick(); });
assert.deepEqual([continueCalls, cancelCalls], [1, 1]);
renderer.unmount();

await build({
  entryPoints: ["src/modules/video-production/runningHubHandoff.ts"],
  outfile: handoffBundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["@tauri-apps/api", "@tauri-apps/api/*"]
});
const handoffModule = await import(`${pathToFileURL(handoffBundlePath).href}?${Date.now()}`);
const packetCalls = [];
const prepareHandoff = handoffModule.createRunningHubHandoffPreparer(async (request) => {
  packetCalls.push(request);
  return { schemaVersion: 1, status: "prepared", packetPath: "C:/project/assets/runninghub-handoffs/shot-runninghub-ui/packet.json", handoffDir: "C:/project/assets/runninghub-handoffs/shot-runninghub-ui", workflowUrl: approval.workflowUrl, inputDigest: approval.inputDigest };
});
const receipt = await prepareHandoff({ projectAssetsDir: "C:/project/assets", approval });
assert.equal(receipt.workflowUrl, approval.workflowUrl);
assert.equal(packetCalls.length, 1);
assert.deepEqual(packetCalls[0], { projectAssetsDir: "C:/project/assets", approval });
await assert.rejects(() => prepareHandoff({ projectAssetsDir: "C:/project/assets", approval }), /approval_already_consumed/);
assert.equal(packetCalls.length, 1, "a second confirmation must not call the desktop handoff boundary");

let releaseFirstPreparation;
const firstPreparation = new Promise((resolve) => { releaseFirstPreparation = resolve; });
let concurrentCalls = 0;
const concurrentPreparer = handoffModule.createRunningHubHandoffPreparer(async () => {
  concurrentCalls += 1;
  await firstPreparation;
  return { schemaVersion: 1, status: "prepared", packetPath: "C:/project/assets/runninghub-handoffs/shot-runninghub-ui/handoff.json", handoffDir: "C:/project/assets/runninghub-handoffs/shot-runninghub-ui", workflowUrl: approval.workflowUrl, inputDigest: approval.inputDigest };
});
const firstConcurrent = concurrentPreparer({ projectAssetsDir: "C:/project/assets", approval });
const secondConcurrent = concurrentPreparer({ projectAssetsDir: "C:/project/assets", approval });
await Promise.resolve();
assert.equal(concurrentCalls, 1, "concurrent confirmations must reserve the digest before awaiting transport");
releaseFirstPreparation();
await firstConcurrent;
await assert.rejects(() => secondConcurrent, /approval_already_consumed/);

let failureCalls = 0;
const retryPreparer = handoffModule.createRunningHubHandoffPreparer(async () => {
  failureCalls += 1;
  if (failureCalls === 1) throw new Error("handoff_transport_failed");
  return { schemaVersion: 1, status: "prepared", packetPath: "C:/project/assets/runninghub-handoffs/shot-runninghub-ui/handoff.json", handoffDir: "C:/project/assets/runninghub-handoffs/shot-runninghub-ui", workflowUrl: approval.workflowUrl, inputDigest: approval.inputDigest };
});
await assert.rejects(() => retryPreparer({ projectAssetsDir: "C:/project/assets", approval }), /handoff_transport_failed/);
await retryPreparer({ projectAssetsDir: "C:/project/assets", approval });
assert.equal(failureCalls, 2, "a failed transport must release the reservation for a retry");

const panelSource = await readFile("src/modules/video-production/RunningHubApprovalPanel.tsx", "utf8");
const handoffSource = await readFile("src/modules/video-production/runningHubHandoff.ts", "utf8");
const desktopBridgeSource = await readFile("src/modules/platform/desktopBridge.ts", "utf8");
assert.doesNotMatch(panelSource, /invokeDesktopCommand|window\.open|fetch\s*\(/, "rendering must not submit or open RunningHub");
assert.doesNotMatch(handoffSource, /submit(?:Task|RunningHub)?|\/api\//i, "handoff may not submit a task or call a RunningHub API");
assert.doesNotMatch(handoffSource, /window\.open|fetch\s*\(/, "handoff may only ask the desktop boundary to open the pinned page");
assert.match(desktopBridgeSource, /prepare_runninghub_handoff/, "handoff must use the task-scoped desktop command");
});
console.log("PASS RunningHub approval UI and exact-workflow handoff contracts");
