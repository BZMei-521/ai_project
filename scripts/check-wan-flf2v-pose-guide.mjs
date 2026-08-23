import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertHalfStepTarget,
  buildHalfStepTarget,
  parseDWPoseJson,
  renderPoseGuide,
  writePoseEvidence
} from "./lib/wan-flf2v-pose-guide.mjs";

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function person({ pelvisX, leftAnkleX, rightAnkleX, yOffset = 0 }) {
  const points = Array.from({ length: 18 }, (_, index) => ({
    x: pelvisX + ((index % 3) - 1) * 8,
    y: 90 + yOffset + index * 18,
    confidence: 1
  }));
  points[9] = { x: pelvisX - 20, y: 360 + yOffset, confidence: 1 };
  points[10] = { x: pelvisX - 25, y: 455 + yOffset, confidence: 1 };
  points[11] = { x: leftAnkleX, y: 565 + yOffset, confidence: 1 };
  points[12] = { x: pelvisX + 20, y: 360 + yOffset, confidence: 1 };
  points[13] = { x: pelvisX + 25, y: 455 + yOffset, confidence: 1 };
  points[14] = { x: rightAnkleX, y: 565 + yOffset, confidence: 1 };
  return { pose_keypoints_2d: points.flatMap(({ x, y, confidence }) => [x, y, confidence]) };
}

function sourceFixture() {
  return {
    canvas_width: 1152,
    canvas_height: 640,
    people: [
      person({ pelvisX: 390, leftAnkleX: 340, rightAnkleX: 430 }),
      person({ pelvisX: 735, leftAnkleX: 700, rightAnkleX: 770, yOffset: -4 })
    ]
  };
}

function mutate(value, fn) {
  const copy = structuredClone(value);
  fn(copy);
  return copy;
}

const parsed = parseDWPoseJson(JSON.stringify(sourceFixture()));
assert.deepEqual(parsed, sourceFixture());
const result = buildHalfStepTarget(parsed);
assert.deepEqual(result.motion, {
  shenPersonIndex: 0,
  selectedLeg: "screen-left",
  hipIndex: 9,
  kneeIndex: 10,
  ankleIndex: 11,
  delta: { hip: { x: -4, y: 0 }, knee: { x: -14, y: -1 }, ankle: { x: -30, y: -2 } }
});
assert.equal(assertHalfStepTarget(result.source, result.target, result.motion), true);

for (let personIndex = 0; personIndex < parsed.people.length; personIndex += 1) {
  const before = parsed.people[personIndex].pose_keypoints_2d;
  const after = result.target.people[personIndex].pose_keypoints_2d;
  for (let scalar = 0; scalar < before.length; scalar += 1) {
    const pointIndex = Math.floor(scalar / 3);
    const allowed = personIndex === 0 && [9, 10, 11].includes(pointIndex) && scalar % 3 !== 2;
    if (!allowed) assert.equal(after[scalar], before[scalar], `locked scalar changed: person ${personIndex}, scalar ${scalar}`);
  }
}

assert.throws(() => parseDWPoseJson({ canvas_width: 1152, canvas_height: 640, people: [{}] }), /keypoint|pose/i);
assert.throws(() => buildHalfStepTarget(mutate(parsed, (v) => { v.people = v.people.slice(0, 1); })), /exactly two/i);
assert.throws(() => buildHalfStepTarget(mutate(parsed, (v) => { v.people.push(structuredClone(v.people[0])); })), /exactly two/i);
assert.throws(() => buildHalfStepTarget(mutate(parsed, (v) => { v.people[0].pose_keypoints_2d[9 * 3 + 2] = 0; })), /confidence|hip/i);
assert.throws(() => buildHalfStepTarget(mutate(parsed, (v) => { v.people[0].pose_keypoints_2d[11 * 3] = 400; v.people[0].pose_keypoints_2d[14 * 3] = 405; })), /ankle|ambiguous/i);
assert.throws(() => buildHalfStepTarget(parsed, { delta: { hip: { x: -4, y: 0 }, knee: { x: -14, y: -1 }, ankle: { x: -20, y: -2 } } }), /ankle|24/i);
assert.throws(() => buildHalfStepTarget(parsed, { delta: { hip: { x: -4, y: 0 }, knee: { x: -20, y: -1 }, ankle: { x: -30, y: -2 } } }), /knee|18/i);
assert.throws(() => buildHalfStepTarget(parsed, { delta: { hip: { x: -8, y: 0 }, knee: { x: -14, y: -1 }, ankle: { x: -30, y: -2 } } }), /hip|6/i);
assert.throws(() => buildHalfStepTarget(parsed, { delta: { hip: { x: -4, y: 0 }, knee: { x: -14, y: -1 }, ankle: { x: -30, y: -6 } } }), /ground|vertical|4/i);

const jiangChanged = mutate(result.target, (v) => { v.people[1].pose_keypoints_2d[0] += 1; });
assert.throws(() => assertHalfStepTarget(result.source, jiangChanged, result.motion), /locked|Jiang/i);
const shenLockedChanged = mutate(result.target, (v) => { v.people[0].pose_keypoints_2d[2 * 3] += 1; });
assert.throws(() => assertHalfStepTarget(result.source, shenLockedChanged, result.motion), /locked/i);

const out = mkdtempSync(join(tmpdir(), "wan-pose-guide-check-"));
try {
  const first = join(out, "first.png");
  const second = join(out, "second.png");
  renderPoseGuide(result.target, first);
  renderPoseGuide(result.target, second);
  assert.ok(existsSync(first));
  assert.equal(sha256(first), sha256(second), "pose PNG must be byte deterministic");

  const evidence = writePoseEvidence({ source: result.source, target: result.target, outputDir: join(out, "evidence") });
  for (const key of ["sourcePosePath", "targetPosePath", "poseGuidePath", "poseDiagnosticPath"]) assert.ok(existsSync(evidence[key]), `${key} must exist`);
  for (const key of ["sourcePoseSha256", "targetPoseSha256", "poseGuideSha256", "poseDiagnosticSha256"]) assert.match(evidence[key], /^[a-f0-9]{64}$/);
  assert.equal(evidence.motion.ankleIndex, 11);
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log("Wan FLF2V pose guide contract: PASS");
