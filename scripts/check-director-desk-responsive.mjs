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
assert.match(tokens, /:root\s*\{[\s\S]*?color-scheme:\s*dark/);
assert.match(css, /touch-action:\s*manipulation/);
assert.match(css, /-webkit-tap-highlight-color:/);
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
const workspaceRule = ruleFor(".director-desk-workspace {");
assert.match(workspaceRule, /position:\s*relative/);
const shellContentRule = ruleFor(".director-desk > [data-director-shell-content] {");
assert.match(shellContentRule, /display:\s*contents/);
const backdropRule = ruleFor(".director-desk .director-command-backdrop {");
assert.match(backdropRule, /position:\s*fixed/);
assert.match(backdropRule, /inset:\s*0/);
assert.match(backdropRule, /pointer-events:\s*auto/);
assert.match(backdropRule, /background:/);
const inspectorReopenRule = ruleFor(
  '.director-desk-workspace > button[aria-label="打开当前对象检查器"] {'
);
assert.match(inspectorReopenRule, /position:\s*absolute/);
assert.match(inspectorReopenRule, /top:\s*12px/);
assert.match(inspectorReopenRule, /right:\s*12px/);
assert.match(inspectorReopenRule, /z-index:\s*3[1-9]|z-index:\s*[4-9]\d/);
assert.match(inspectorReopenRule, /min-height:\s*44px/);
const mobileCommandTriggerRule = ruleFor(
  ".director-desk [data-director-top-actions] > button.director-command-trigger {"
);
assert.match(mobileCommandTriggerRule, /display:\s*inline-flex/);
assert.match(mobileCommandTriggerRule, /min-width:\s*44px/);
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
assert.match(css, /@media\s*\(min-width:\s*768px\)\s*and\s*\(max-width:\s*1099px\),\s*\(pointer:\s*coarse\)/);
const compactTargetRule = ruleFor(
  ".director-desk[data-director-desk] :is(.production-stage-rail, [data-director-stage-rail]) button,"
);
for (const targetSelector of [
  ".director-desk [data-director-top-bar] button,",
  ".director-desk [data-director-project-menu] button,",
  ".director-desk :is(.director-command-palette, [data-director-command-palette]) input,",
  '.director-desk :is(.director-command-palette, [data-director-command-palette]) [role="option"],',
  ".director-desk .director-advanced-drawer > button,",
  ".director-desk :is(.director-object-inspector, [data-director-inspector]) > header button"
]) {
  assert.ok(compactTargetRule.includes(targetSelector), `compact/coarse target contract should include ${targetSelector}`);
}
assert.match(compactTargetRule, /min-height:\s*44px/);
const onboardingRule = ruleFor(
  ".director-desk-workspace > .app-shell > .onboarding-panel {"
);
assert.match(onboardingRule, /z-index:\s*(?:4[1-9]|[5-9]\d|\d{3,})/);
const stageRailRule = ruleFor(
  ".director-desk :is(.production-stage-rail, [data-director-stage-rail]) {"
);
assert.match(stageRailRule, /display:\s*flex/);
assert.match(stageRailRule, /flex-direction:\s*column/);
const railStatusRule = ruleFor(
  ".director-desk [data-director-stage-rail-footer] .compact-status-bar {"
);
assert.match(railStatusRule, /display:\s*grid/);
assert.match(railStatusRule, /grid-template-columns:\s*1fr/);
const railStatusItemRule = ruleFor(
  ".director-desk [data-director-stage-rail-footer] .compact-status-item {"
);
assert.match(railStatusItemRule, /grid-template-columns:\s*40px\s+minmax\(0,\s*1fr\)/);
const screenReaderOnlyRule = ruleFor(".director-desk .sr-only {");
assert.match(screenReaderOnlyRule, /position:\s*absolute/);
assert.match(screenReaderOnlyRule, /width:\s*1px/);
assert.match(screenReaderOnlyRule, /height:\s*1px/);
assert.match(screenReaderOnlyRule, /overflow:\s*hidden/);
for (const overlaySelector of [
  ".director-desk :is(.director-object-inspector, [data-director-inspector]) {",
  ".director-desk :is(.director-command-palette, [data-director-command-palette]) {",
  ".director-desk .director-advanced-drawer {"
]) {
  assert.match(ruleFor(overlaySelector), /overscroll-behavior:\s*contain/);
}
assert.match(main, /director-desk-tokens\.css/);
assert.match(main, /director-desk\.css/);
console.log("PASS director desk responsive contract");
