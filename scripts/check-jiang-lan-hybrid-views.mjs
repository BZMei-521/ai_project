import assert from "node:assert/strict";

const runner = await import("./run-jiang-lan-hybrid-views.mjs");

assert.equal(runner.CHARACTER_ASSET_ID, "asset_1773997039637_416");
assert.equal(runner.SPECIES, "human");
assert.equal(runner.IDENTITY_REFERENCE_PATH.endsWith("hero-2026080932.png"), true);
assert.equal(runner.BODY_REFERENCE_PATH.endsWith("hero-2026080922.png"), true);
assert.equal(runner.OUTPUT_DIRECTORY_NAME, "logs/jiang-lan-hybrid-v1");
assert.deepEqual(runner.VIEWS.map((item) => item.view), ["front", "side", "back"]);
assert.deepEqual(runner.VIEWS.map((item) => item.seed), [2026081001, 2026081002, 2026081003]);

for (const item of runner.VIEWS) {
  assert.match(item.prompt, /Jiang Lan/);
  assert.match(item.prompt, /human woman/i);
  assert.match(item.prompt, /same face/i);
  assert.match(item.prompt, /long straight black hair/i);
  assert.match(item.prompt, /light gray-blue long-sleeve dress/i);
  assert.match(item.prompt, /head to shoe soles/i);
  assert.match(item.prompt, /no animal ears/i);
}
assert.match(runner.VIEWS[0].prompt, /strict front view/i);
assert.match(runner.VIEWS[1].prompt, /strict right side profile/i);
assert.match(runner.VIEWS[2].prompt, /strict back view/i);
assert.match(runner.VIEWS[2].prompt, /no visible face/i);

const rendered = runner.replaceTokens(
  { prompt: "{{PROMPT}}", seed: "{{SEED}}", ref: "{{REFERENCE_IMAGE_A}}" },
  { PROMPT: "locked", SEED: 7, REFERENCE_IMAGE_A: "a.png" }
);
assert.deepEqual(rendered, { prompt: "locked", seed: 7, ref: "a.png" });

console.log("Jiang Lan hybrid view generator contract: PASS");
process.exit(0);
