import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildYingdiUnityExchanges } from "./lib/unity-previs/yingdi-tomb-adapter.mjs";
import { validateExchange } from "./lib/unity-previs/exchange.mjs";

const stage = JSON.parse(await readFile("影帝他总想对我图谋不轨_漫剧改编/分镜/work/E01-C19-C22.spatial-stage.seed.json", "utf8"));
const panorama = { assetId: "yingdi-e01-tomb-codex-v1", path: "C:/production/master-codex-v1-2x1.png", sha256: "e".repeat(64), width: 1774, height: 887 };
const result = buildYingdiUnityExchanges(stage, panorama);
assert.equal(result.exchanges.length, 4);
assert.equal(result.panorama.role, "appearance_reference_only");
assert.equal(result.sourceAudit.unityGeometryAuthority, true);
assert.equal(result.sourceAudit.codexPanoramaGeometryAuthority, false);
assert.match(result.stageDigest, /^[a-f0-9]{64}$/);
assert.deepEqual(result.exchanges.map((item) => item.shotId), ["E01-S01-C19", "E01-S01-C20", "E01-S01-C21", "E01-S01-C22"]);
for (const item of result.exchanges) {
  assert.equal(validateExchange(item.exchange).valid, true);
  assert.equal(item.exchange.entities.length, stage.entities.length);
  assert.equal(item.exchange.relations.length, 1);
  assert.equal(item.exchange.relations[0].kind, "inside");
  for (const subject of item.exchange.entities.filter((entity) => entity.role === "subject")) {
    assert.equal(subject.joints.filter((joint) => joint.openPoseIndex >= 0).length, 18);
    assert.deepEqual([...new Set(subject.joints.filter((joint) => joint.hand === "left").map((joint) => joint.handIndex))].sort((a, b) => a - b), Array.from({ length: 21 }, (_, index) => index));
    assert.deepEqual([...new Set(subject.joints.filter((joint) => joint.hand === "right").map((joint) => joint.handIndex))].sort((a, b) => a - b), Array.from({ length: 21 }, (_, index) => index));
    if (subject.id === "li-baozhu-full-body") {
      const world = new Map();
      for (const joint of subject.joints) {
        const parent = joint.parentId ? world.get(joint.parentId) : { x: 0, y: 0, z: 0 };
        const position = { x: parent.x + joint.position.x, y: parent.y + joint.position.y, z: parent.z + joint.position.z };
        world.set(joint.id, position);
        assert.ok(Math.abs(position.x) + joint.radius <= 0.181, `${joint.id} leaves Li Baozhu's contained rest-pose capsule`);
      }
    }
  }
}
assert.throws(() => buildYingdiUnityExchanges({ ...stage, id: "other" }, panorama), /stage_invalid/);
assert.throws(() => buildYingdiUnityExchanges(stage, { ...panorama, width: 1700 }), /panorama_invalid/);
const incomplete = structuredClone(stage); incomplete.snapshots[0].entityStates.pop();
assert.throws(() => buildYingdiUnityExchanges(incomplete, panorama), /snapshot_incomplete/);
const batchSource = await readFile("integrations/unity-previs/Editor/PrevisBatch.cs", "utf8");
assert.match(batchSource, /public static void ExportInputDirectory\(\)/);
assert.match(batchSource, /Arg\("--previs-input-dir"\)/);
assert.match(batchSource, /Array\.Sort\(files,StringComparer\.Ordinal\)/);
assert.match(batchSource, /PREVIS_INPUT_EXPORT=/);
console.log("PASS E01 C19-C22 Unity production exchange");
