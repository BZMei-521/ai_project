import assert from "node:assert/strict";
import {
  inferCharacterView,
  inferShotScale,
  routeCharacterReferences,
  buildCharacterPassPlan
} from "../src/modules/comfy-pipeline/characterConsistencyRuntime.mjs";

const identityPack = {
  version: "v1",
  triggerWord: "char_shen",
  faceMasterPath: "face.png",
  faceLeftPath: "left.png",
  faceRightPath: "right.png",
  hairBackPath: "hair-back.png",
  bodyFrontPath: "front.png",
  bodySidePath: "side.png",
  bodyBackPath: "back.png",
  immutableTraits: [],
  forbiddenChanges: [],
  approvedHeroFramePaths: [],
  updatedAt: "2026-08-08"
};

for (const [yaw, view] of [
  [-136, "back"], [-135, "left_profile"], [-51, "left_profile"],
  [-50, "left_three_quarter"], [-26, "left_three_quarter"], [-25, "front"],
  [0, "front"], [25, "front"], [26, "right_three_quarter"],
  [50, "right_three_quarter"], [51, "right_profile"], [135, "right_profile"],
  [136, "back"], [170, "back"]
]) {
  assert.equal(inferCharacterView(yaw), view, `yaw ${yaw}`);
}
assert.equal(inferCharacterView(360), "front");

for (const [text, scale] of [
  ["面部特写，眼神变化", "close"], ["close-up portrait", "close"],
  ["close", "close"],
  ["河边远景，两人全身", "wide"], ["establishing long shot", "wide"],
  ["wide", "wide"], ["long", "wide"],
  ["两人对话", "medium"]
]) assert.equal(inferShotScale(text), scale, text);

assert.deepEqual(
  routeCharacterReferences({ identityPack, view: "left_profile", shotScale: "close" }).map((item) => item.kind),
  ["face_angle", "face_master", "body_view"]
);
assert.deepEqual(
  routeCharacterReferences({ identityPack, view: "right_three_quarter", shotScale: "medium" }).map((item) => item.kind),
  ["body_view", "face_angle", "face_master"]
);
assert.deepEqual(
  routeCharacterReferences({ identityPack, view: "back", shotScale: "wide" }).map((item) => item.kind),
  ["body_view", "hair_back", "face_master"]
);
assert.deepEqual(
  routeCharacterReferences({
    identityPack: { ...identityPack, faceLeftPath: "face.png", bodySidePath: "" },
    view: "left_profile", shotScale: "close", continuityPath: "previous.png"
  }),
  [
    { kind: "face_angle", path: "face.png" },
    { kind: "continuity", path: "previous.png" }
  ]
);
assert.deepEqual(
  routeCharacterReferences({ identityPack, view: "front", shotScale: "close", continuityPath: "previous.png" }).map((item) => item.kind),
  ["face_angle", "body_view", "continuity"]
);
assert.equal(
  routeCharacterReferences({ identityPack: { ...identityPack, faceMasterPath: "same.png", bodyFrontPath: "same.png" }, view: "front", shotScale: "medium", continuityPath: "same.png" }).length,
  1
);

const passes = buildCharacterPassPlan({
  shot: { id: "s1", cameraYaw: 0, title: "双人近景" },
  characters: [
    { id: "a", name: "A", characterIdentityPack: identityPack },
    { id: "missing", name: "Missing" },
    { id: "b", name: "B", characterIdentityPack: { ...identityPack, triggerWord: "char_b" } }
  ],
  provider: "qwen_image_edit_2511"
});
assert.deepEqual(passes.map((item) => item.characterAssetId), ["a", "b"]);
assert.deepEqual(passes.map((item) => item.roleIndex), [0, 1]);
assert.equal(passes.every((item) => item.references.length <= 3), true);
assert.equal(passes[0].protectPreviousCharacters, false);
assert.equal(passes[1].protectPreviousCharacters, true);
assert.equal(passes[0].refineHead, true);
assert.equal(buildCharacterPassPlan({ shot: { id: "wide", cameraYaw: 170, title: "wide shot" }, characters: [passes[0] && { id: "a", name: "A", characterIdentityPack: identityPack }], provider: "qwen_image_edit_2511" })[0].refineHead, false);
console.log("PASS character reference routing and pass planning");
