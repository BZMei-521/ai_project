import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(
  packageJson.scripts?.['test:novel-directing-skills'],
  'node scripts/check-novel-directing-skills.mjs',
  'package.json 必须暴露 test:novel-directing-skills',
);

const entrypoints = [
  '.agents/skills/novel-action-director/scripts/novel-action-director.mjs',
  '.agents/skills/novel-fantasy-vfx/scripts/novel-fantasy-vfx.mjs',
  '.agents/skills/novel-storyboard/scripts/novel-storyboard.mjs',
  '.agents/skills/novel-edit-director/scripts/novel-edit-director.mjs',
];
for (const path of entrypoints) {
  assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `缺少 skill 入口: ${path}`);
}

console.log('PASS novel directing skills package contract');
