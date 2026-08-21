import assert from "node:assert/strict";
import { parseShotScriptText } from "../src/features/script-director/shotScriptImportRuntime.mjs";

const valid = parseShotScriptText(JSON.stringify({
  project: { title: "推门测试", version: 1 },
  shots: [
    { id: "a", title: "人物推门", duration: 4, prompt: "推门" },
    { id: "b", title: "进入房间", duration_sec: 3.5, video_prompt: "向左跟拍", character_names: ["角色A"] }
  ]
}), { fps: 24, sequenceId: "seq-1" });
assert.equal(valid.ok, true);
assert.equal(valid.value.shots[1].durationFrames, 84);
assert.equal(valid.value.shots[1].videoPrompt, "向左跟拍");
assert.deepEqual(valid.value.shots[1].sourceCharacterNames, ["角色A"]);
assert.deepEqual(valid.value.transitions.map(({ fromShotId, toShotId, type }) => ({ fromShotId, toShotId, type })), [
  { fromShotId: "a", toShotId: "b", type: "continuous" }
]);
const validOtherSequence = parseShotScriptText(JSON.stringify({
  shots: [
    { id: "a", title: "人物推门", duration: 4, prompt: "推门" },
    { id: "b", title: "进入房间", duration: 3.5, prompt: "跟拍" }
  ]
}), { fps: 24, sequenceId: "seq-2" });
assert.equal(validOtherSequence.ok, true);
assert.notEqual(valid.value.transitions[0].id, validOtherSequence.value.transitions[0].id);

const legacy = parseShotScriptText(JSON.stringify({
  shots: [{ title: "旧镜头", frames: 48, negative_prompt: "模糊", scene_name: "房间" }]
}), { fps: 24, sequenceId: "seq-legacy" });
assert.equal(legacy.ok, true);
assert.equal(legacy.value.shots[0].id, "shot_import_001");
assert.equal(legacy.value.shots[0].durationFrames, 48);
assert.equal(legacy.value.shots[0].prompt, "旧镜头");
assert.equal(legacy.value.shots[0].negativePrompt, "模糊");
assert.equal(legacy.value.shots[0].sourceSceneName, "房间");

const duplicateTransitionId = parseShotScriptText(JSON.stringify({
  shots: [
    { id: "a", title: "1" },
    { id: "b", title: "2" },
    { id: "c", title: "3" }
  ],
  transitions: [
    { id: "duplicate-id", from: "a", to: "b", type: "continuous" },
    { id: "duplicate-id", from: "b", to: "c", type: "continuous" }
  ]
}), { fps: 24, sequenceId: "seq-1" });
assert.equal(duplicateTransitionId.ok, false);
assert.equal(duplicateTransitionId.issues[0].code, "duplicate_transition_id");
assert.equal(duplicateTransitionId.issues[0].path, "$.transitions[1].id");

const duplicateExplicitIdAndPair = parseShotScriptText(JSON.stringify({
  shots: [{ id: "a", title: "1" }, { id: "b", title: "2" }],
  transitions: [
    { id: "duplicate-id", from: "a", to: "b", type: "continuous" },
    { id: "duplicate-id", from: "a", to: "b", type: "hard_cut" }
  ]
}), { fps: 24, sequenceId: "seq-1" });
assert.equal(duplicateExplicitIdAndPair.ok, false);
assert.equal(duplicateExplicitIdAndPair.issues[0].code, "duplicate_transition_id");
assert.equal(duplicateExplicitIdAndPair.issues[0].path, "$.transitions[1].id");

const nulCollisionPayload = (reverse) => JSON.stringify({
  shots: [
    { id: "a\u0000b", title: "1" },
    { id: "c", title: "2" },
    { id: "a", title: "3" },
    { id: "b\u0000c", title: "4" }
  ],
  transitions: (reverse ? [
    { from: "a", to: "b\u0000c", type: "continuous" },
    { from: "a\u0000b", to: "c", type: "continuous" }
  ] : [
    { from: "a\u0000b", to: "c", type: "continuous" },
    { from: "a", to: "b\u0000c", type: "continuous" }
  ])
});
for (const reverse of [false, true]) {
  const collisionSafe = parseShotScriptText(nulCollisionPayload(reverse), { fps: 24, sequenceId: "seq-nul" });
  assert.equal(collisionSafe.ok, true);
  assert.equal(collisionSafe.value.transitions.length, 3);
}

for (const [payload, code] of [
  ["not json", "invalid_json"],
  [JSON.stringify({}), "shots_missing"],
  [JSON.stringify({ shots: [{ id: "x", title: "1" }, { id: "x", title: "2" }] }), "duplicate_shot_id"],
  [JSON.stringify({ shots: [{ id: "a", title: "1" }, { id: "b", title: "2" }], transitions: [{ from: "a", to: "missing", type: "continuous" }] }), "transition_shot_missing"],
  [JSON.stringify({ shots: [{ id: "a", title: "1" }, { id: "b", title: "2" }, { id: "c", title: "3" }], transitions: [{ from: "a", to: "c", type: "continuous" }] }), "transition_not_adjacent"],
  [JSON.stringify({ shots: [{ id: "a", title: "1" }, { id: "b", title: "2" }], transitions: [{ from: "a", to: "b", type: "continuous" }, { from: "a", to: "b", type: "hard_cut" }] }), "duplicate_transition"],
  [JSON.stringify({ shots: [{ id: "a", title: "1" }, { id: "b", title: "2" }], transitions: [{ from: "a", to: "b", type: "continuous", frameDependency: "future_frame" }] }), "frame_dependency_invalid"],
  [JSON.stringify({ shots: [{ id: "a", title: "1" }, { id: "b", title: "2" }], transitions: [{ from: "a", to: "b", type: "continuous", duration: -1 }] }), "transition_duration_invalid"]
]) {
  const result = parseShotScriptText(payload, { fps: 24, sequenceId: "seq-1" });
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, code);
}

const invalidShot = parseShotScriptText(JSON.stringify({ shots: [null] }), { fps: 24, sequenceId: "seq-1" });
assert.equal(invalidShot.ok, false);
assert.equal(invalidShot.issues[0].code, "shot_invalid");

const invalidTransition = parseShotScriptText(JSON.stringify({
  shots: [{ id: "a", title: "1" }, { id: "b", title: "2" }],
  transitions: [null]
}), { fps: 24, sequenceId: "seq-1" });
assert.equal(invalidTransition.ok, false);
assert.equal(invalidTransition.issues[0].code, "transition_invalid");

const invalidTransitionsContainer = parseShotScriptText(JSON.stringify({
  shots: [{ id: "a", title: "1" }, { id: "b", title: "2" }],
  transitions: {}
}), { fps: 24, sequenceId: "seq-1" });
assert.equal(invalidTransitionsContainer.ok, false);
assert.equal(invalidTransitionsContainer.issues[0].code, "transitions_invalid");

console.log("PASS shot script import");
