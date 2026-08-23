import assert from "node:assert/strict";

const generator = await import("./run-jiang-lan-zimage-hero.mjs");

assert.deepEqual(generator.SEEDS, [2026080931, 2026080932, 2026080933]);
assert.equal(generator.OUTPUT_DIRECTORY_NAME, "logs/jiang-lan-zimage-hero-v2");
assert.equal(generator.CHARACTER_ASSET_ID, "asset_1773997039637_416");
assert.equal(generator.SPECIES, "human");
assert.match(generator.PROMPT, /Jiang Lan/);
assert.match(generator.PROMPT, /adult Chinese woman/);
assert.match(generator.PROMPT, /long straight black hair/);
assert.match(generator.PROMPT, /light gray-blue long-sleeve dress/);
assert.match(generator.PROMPT, /black flats/);
assert.match(generator.PROMPT, /no animal ears/i);
assert.match(generator.PROMPT, /mature adult facial proportions/);
assert.match(generator.PROMPT, /natural-sized eyes/);
assert.match(generator.PROMPT, /defined cheekbones and jawline/);
assert.match(generator.PROMPT, /head to mid-thigh/);

const rendered = generator.replaceTokens(
  {
    prompt: "{{PROMPT}}",
    seed: "{{SEED}}",
    prefix: "character-hero/shen-yan-{{SEED}}"
  },
  { PROMPT: generator.PROMPT, SEED: generator.SEEDS[0] }
);

assert.equal(rendered.prompt, generator.PROMPT);
assert.equal(rendered.seed, generator.SEEDS[0]);
assert.equal(rendered.prefix, "character-hero/shen-yan-2026080931");

console.log("Jiang Lan Z-Image hero generator contract: PASS");
