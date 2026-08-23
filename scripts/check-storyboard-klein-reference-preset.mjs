import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const presetPath = path.join(
  process.cwd(),
  "src",
  "modules",
  "comfy-pipeline",
  "presets",
  "storyboard-image-flux2-klein-multiref.json"
);

let workflow;
try {
  workflow = JSON.parse(await fs.readFile(presetPath, "utf8"));
} catch {
  assert.fail("FLUX.2 Klein storyboard multi-reference preset must exist");
}

const nodes = Object.values(workflow);
const nodeTypes = nodes.map((node) => node.class_type);
const raw = JSON.stringify(workflow);

assert.equal(nodeTypes.filter((type) => type === "LoadImage").length, 2, "preset must load exactly one anchor per scripted character");
assert.equal(nodeTypes.filter((type) => type === "ReferenceLatent").length, 4, "positive and negative conditioning must each receive exactly two character anchors");
assert.doesNotMatch(raw, /\{\{SCENE_REF_PATH\}\}/, "a missing legacy scene path must not block character-reference generation");
for (const token of [
  "{{CHAR1_PRIMARY_PATH}}",
  "{{CHAR2_PRIMARY_PATH}}",
  "{{PROMPT}}",
  "{{SEED}}"
] ) {
  assert.match(raw, new RegExp(token.replace(/[{}]/g, "\\$&")), `preset must use ${token}`);
}
assert.doesNotMatch(raw, /IDENTITY_BOARD_PATH/, "three-view boards must not be injected as extra visible people");
assert.match(raw, /exactly one instance of each scripted character/i, "prompt must forbid duplicate character instances");
assert.match(raw, /exactly two people/i, "two-character workflow must enforce the scripted headcount");
for (const type of ["UNETLoader", "CLIPLoader", "VAELoader", "EmptyFlux2LatentImage", "Flux2Scheduler", "SamplerCustomAdvanced", "SaveImage"]) {
  assert.ok(nodeTypes.includes(type), `preset must include ${type}`);
}

const outputNode = nodes.find((node) => node.class_type === "SaveImage");
assert.ok(outputNode, "preset must have a SaveImage output");
assert.equal(outputNode.inputs.filename_prefix, "Storyboard/{{SHOT_TITLE}}_klein_ref");

console.log("FLUX.2 Klein storyboard multi-reference preset: PASS");
