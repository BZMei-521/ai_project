import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const tokens = await readFile("src/styles/director-desk-tokens.css", "utf8");
const css = await readFile("src/styles/director-desk.css", "utf8");
const main = await readFile("src/main.tsx", "utf8");

for (const hex of ["#071216", "#10242a", "#dce8e9", "#75b9b4", "#e7a86e", "#b85b58"]) {
  assert.match(tokens.toLocaleLowerCase(), new RegExp(hex));
}
assert.match(css, /grid-template-columns:\s*174px\s+minmax\(0,\s*1fr\)\s+250px/);
assert.match(css, /@media\s*\(max-width:\s*1099px\)/);
assert.match(css, /@media\s*\(max-width:\s*767px\)/);
assert.match(css, /min-height:\s*44px/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /:focus-visible/);
assert.match(main, /director-desk-tokens\.css/);
assert.match(main, /director-desk\.css/);
console.log("PASS director desk responsive contract");
