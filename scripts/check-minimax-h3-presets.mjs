import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const cases = [
  ["minimax-h3-t2v-v1.json", "MiniMaxH3ImageToVideo", []],
  ["minimax-h3-i2v-v1.json", "MiniMaxH3ImageToVideo", ["{{FIRST_FRAME_PATH}}"]],
  ["minimax-h3-flf2v-v1.json", "MiniMaxH3ImageToVideo", ["{{FIRST_FRAME_PATH}}", "{{LAST_FRAME_PATH}}"]],
  ["minimax-h3-r2v-v1.json", "MiniMaxH3ReferenceToVideo", ["{{REF_IMAGE_1_PATH}}"]]
];

for (const [name, conditioningType, requiredTokens] of cases) {
  const raw = fs.readFileSync(path.join(root, "src/modules/comfy-pipeline/presets", name), "utf8");
  const prompt = JSON.parse(raw);
  const nodes = Object.values(prompt);
  assert.ok(nodes.length >= 12, `${name}: expected complete API prompt`);
  assert.ok(nodes.some((node) => node.class_type === conditioningType));
  assert.ok(nodes.some((node) => node.class_type === "CreateVideo"));
  assert.ok(nodes.some((node) => node.class_type === "SaveVideo"));
  assert.equal(nodes.some((node) => node.class_type === "TESpeedMiniMaxH3"), false);
  for (const token of ["{{VIDEO_PROMPT}}", "{{H3_LENGTH}}", "{{SEED}}", ...requiredTokens]) {
    assert.ok(raw.includes(token), `${name}: missing ${token}`);
  }
}

console.log("PASS minimax h3 API presets");
