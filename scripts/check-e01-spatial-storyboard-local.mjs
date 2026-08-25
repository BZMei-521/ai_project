import assert from "node:assert/strict";

const {
  bindShotWorkflow,
  preflightLocalTrial,
  runShotCandidate,
  selectConstrainedProfile
} = await import("./lib/e01-spatial-storyboard-local.mjs");

const allRoles = ["environment", "character", "depth", "normal", "character_id", "prop_id", "pose"];
const zImageOnlyInventory = {
  profiles: [{ id: "storyboard-zimage-turbo", available: true, referenceRoles: [], loadFloorBytes: 4 * 1024 ** 3 }]
};
assert.throws(() => selectConstrainedProfile(zImageOnlyInventory), /LOCAL_PROFILE_UNAVAILABLE/);
assert.throws(
  () => preflightLocalTrial({ queueRunning: 1, queuePending: 0, freeVramBytes: 12e9 }),
  /COMFY_QUEUE_BUSY/
);
assert.throws(
  () => preflightLocalTrial({ queueRunning: 0, queuePending: 0, freeVramBytes: 3e9 }),
  /LOCAL_VRAM_UNSAFE/
);

const composerInventory = {
  profiles: [{
    id: "storyboard-composer-v1",
    available: true,
    referenceRoles: allRoles,
    loadFloorBytes: 12 * 1024 ** 3,
    workflow: {
      "1": { class_type: "LoadImage", inputs: { image: "{{CHARACTER_PATH}}" } },
      "2": { class_type: "LoadImage", inputs: { image: "{{DEPTH_PATH}}" } },
      "3": { class_type: "LoadImage", inputs: { image: "{{POSE_PATH}}" } },
      "4": { class_type: "SaveImage", inputs: { filename_prefix: "{{SHOT_TITLE}}" } }
    }
  }]
};
const selected = selectConstrainedProfile(composerInventory);
assert.equal(selected.id, "storyboard-composer-v1");
const bindings = bindShotWorkflow(selected, {
  shotId: "E01-01-C03",
  prompt: "credible two-arm upward force",
  seed: 2026082503,
  references: Object.fromEntries(allRoles.map((role) => [role, `${role}.png`]))
});
assert.deepEqual(bindings.referenceRoles, allRoles);
assert.equal(bindings.workflow["1"].inputs.image, "character.png");
assert.equal(bindings.workflow["2"].inputs.image, "depth.png");
assert.equal(bindings.workflow["3"].inputs.image, "pose.png");

let queuedMarker = null;
let queueCalls = 0;
let waitCalls = 0;
const journal = {
  async readQueued() { return queuedMarker; },
  async writeAttempt(value) { assert.equal(value.shotId, "E01-01-C03"); },
  async writeQueued(value) { queuedMarker = value; },
  async writeCompleted(value) { assert.equal(value.promptId, "prompt-1"); }
};
const crashingTransport = {
  async queuePrompt() { queueCalls += 1; return { promptId: "prompt-1" }; },
  async waitForOutput() { waitCalls += 1; throw new Error("simulated_process_crash"); }
};
await assert.rejects(
  () => runShotCandidate({ shotId: "E01-01-C03", workflow: bindings.workflow, journal, transport: crashingTransport }),
  /simulated_process_crash/
);
assert.equal(queueCalls, 1);
assert.equal(waitCalls, 1);
assert.equal(queuedMarker.promptId, "prompt-1");

const resumedTransport = {
  async queuePrompt() { queueCalls += 1; throw new Error("must_not_queue_twice"); },
  async waitForOutput(promptId) {
    waitCalls += 1;
    assert.equal(promptId, "prompt-1");
    return { promptId, filename: "E01-01-C03.png", subfolder: "e01", type: "output", outputNodeId: "4" };
  }
};
const resumed = await runShotCandidate({
  shotId: "E01-01-C03",
  workflow: bindings.workflow,
  journal,
  transport: resumedTransport
});
assert.equal(resumed.promptId, "prompt-1");
assert.equal(queueCalls, 1, "resume must not create a second queue entry");
assert.equal(waitCalls, 2);

console.log("E01 local spatial storyboard runner checks passed");
