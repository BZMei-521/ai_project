import assert from "node:assert/strict";
import { recommendRunningHub } from "../src/modules/video-production/cloudShotRoutingRuntime.mjs";
import {
  createRunningHubApprovalSnapshot,
  consumeRunningHubApproval,
  transitionRunningHubState,
  validateRunningHubApproval
} from "../src/modules/video-production/runningHubApprovalRuntime.mjs";

assert.deepEqual(recommendRunningHub({ namedCharacterCount: 1 }), {
  status: "local_default",
  reasons: []
});
assert.deepEqual(recommendRunningHub({
  namedCharacterCount: 2,
  hasCharacterContact: true
}), {
  status: "cloud_recommended",
  reasons: ["character_contact"]
});
assert.equal(recommendRunningHub({ orderedActionBeatCount: 2 }).status, "cloud_recommended");
assert.equal(recommendRunningHub({ hasCharacterMotion: true, hasCameraMotion: true }).status, "cloud_recommended");
assert.equal(recommendRunningHub({ localQualityFailureCount: 2, localRetryLimit: 2 }).status, "cloud_recommended");

const validApprovalInput = Object.freeze({
  shotId: "shot-runninghub-approval",
  workflowId: "2090035427871903746",
  workflowUrl: "https://www.runninghub.cn/workflow/2090035427871903746?source=workspace",
  references: Object.freeze(["C:/project/characters/lin-yue.png", "C:/project/characters/lan.png"]),
  prompt: "Lin Yue hands Lan the compass while the camera tracks around them.",
  width: 1344,
  height: 768,
  durationSeconds: 8,
  createdAt: "2026-08-20T00:00:00.000Z"
});
const approval = await createRunningHubApprovalSnapshot(validApprovalInput);
assert.equal(approval.workflowId, "2090035427871903746");
assert.equal(approval.references.length, 2);
assert.match(approval.inputDigest, /^[a-f0-9]{64}$/);
assert.equal(validateRunningHubApproval(approval, validApprovalInput, new Set()).ok, true);
assert.equal(
  validateRunningHubApproval({ ...approval, prompt: "tampered snapshot" }, validApprovalInput, new Set()).reason,
  "approval_input_changed",
  "a snapshot with a changed canonical field must fail its own digest verification"
);
assert.equal(
  validateRunningHubApproval({ inputDigest: approval.inputDigest }, validApprovalInput, new Set()).reason,
  "approval_input_changed",
  "a minimal digest-only snapshot must not be accepted"
);
assert.equal(
  validateRunningHubApproval(approval, { ...validApprovalInput, prompt: "changed" }, new Set()).reason,
  "approval_input_changed"
);
assert.equal(
  validateRunningHubApproval(approval, validApprovalInput, new Set([approval.inputDigest])).reason,
  "approval_already_consumed"
);
const consumedDigests = new Set();
assert.equal(consumeRunningHubApproval(approval, validApprovalInput, consumedDigests).ok, true);
assert.equal(consumedDigests.has(approval.inputDigest), true, "a successful consumption must record the digest");
assert.equal(
  consumeRunningHubApproval(approval, validApprovalInput, consumedDigests).reason,
  "approval_already_consumed",
  "the same approval cannot be consumed twice"
);
assert.deepEqual(
  transitionRunningHubState({ status: "local_default" }, { type: "RECOMMEND_CLOUD" }),
  { status: "cloud_recommended" }
);
assert.throws(() => transitionRunningHubState({ status: "accepted" }, { type: "POLL_RUNNING" }), /cloud_state_terminal/);

console.log("PASS RunningHub cloud recommendation and approval contracts");
