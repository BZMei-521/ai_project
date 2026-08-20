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
const commandPaletteRule = css.match(/\.director-desk :is\(\.director-command-palette, \[data-director-command-palette\]\) \{.*?\n\}/s)?.[0] ?? "";
assert.match(commandPaletteRule, /left:\s*16px/);
assert.match(commandPaletteRule, /right:\s*16px/);
assert.match(commandPaletteRule, /margin-inline:\s*auto/);
assert.doesNotMatch(commandPaletteRule, /transform/);
assert.doesNotMatch(css, /translateX\(/);
assert.match(css, /\.director-desk \.director-project-menu \[data-danger="true"\]/);
assert.match(css, /\[data-director-project-menu\] \[data-danger="true"\]/);
assert.match(css, /\.director-desk \.btn-danger/);
assert.match(css, /\.director-advanced-drawer \.aux-quick-btn\.toggle-on/);
const ruleFor = (selector) => {
  const index = css.indexOf(selector);
  assert.notEqual(index, -1, `Missing ${selector}`);
  return css.slice(index, css.indexOf("\n}", index) + 2);
};
const commandSearchInputRule = ruleFor(
  ".director-desk :is(.director-command-palette, [data-director-command-palette]) input {"
);
const commandSearchInputFocusRule = ruleFor(
  ".director-desk :is(.director-command-palette, [data-director-command-palette]) input:focus-visible {"
);
assert.doesNotMatch(commandSearchInputRule, /outline:\s*none/);
assert.match(commandSearchInputFocusRule, /outline:\s*2px solid var\(--director-teal\)/);
assert.match(commandSearchInputFocusRule, /box-shadow:\s*0 0 0 3px color-mix\(in srgb, var\(--director-teal\)/);
const dangerBaseRule = ruleFor(".director-desk .director-project-menu [data-danger=\"true\"],");
const dangerHoverRule = ruleFor(".director-desk .director-project-menu [data-danger=\"true\"]:hover:not(:disabled),");
const dangerFocusRule = ruleFor(".director-desk .director-project-menu [data-danger=\"true\"]:focus-visible,");
assert.match(dangerBaseRule, /var\(--director-stop\)/);
assert.match(dangerHoverRule, /var\(--director-stop\)/);
assert.match(dangerFocusRule, /var\(--director-stop\)/);
assert.match(dangerFocusRule, /box-shadow:\s*0 0 0 3px color-mix\(in srgb, var\(--director-stop\)/);
const advancedToggleRule = ruleFor(
  ".director-desk .director-advanced-drawer .aux-quick-btn.toggle-on {"
);
assert.match(advancedToggleRule, /var\(--director-teal\)/);
assert.match(advancedToggleRule, /box-shadow:\s*(?:none|0 0 0 3px color-mix\(in srgb, var\(--director-teal\))/);
assert.match(main, /director-desk-tokens\.css/);
assert.match(main, /director-desk\.css/);
console.log("PASS director desk responsive contract");
