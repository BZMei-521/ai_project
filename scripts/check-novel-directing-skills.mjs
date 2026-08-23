import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
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
  assert.ok(existsSync(resolve(root, path)), `缺少 skill 入口: ${path}`);
}

function run(label, args, expectedText) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.error) throw new Error(`${label} 启动失败: ${result.error.message}`);
  if (result.signal) throw new Error(`${label} 被信号终止: ${result.signal}`);
  if (result.status !== 0) {
    throw new Error(`${label} exit=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (!output) throw new Error(`${label} 没有输出`);
  if (expectedText && !output.includes(expectedText)) {
    throw new Error(`${label} 缺少预期输出: ${expectedText}\n${output}`);
  }
  console.log(`PASS ${label}`);
}

for (const [name, selftest] of [
  ['novel-action-director selftest', '.agents/skills/novel-action-director/scripts/selftest.mjs'],
  ['novel-fantasy-vfx selftest', '.agents/skills/novel-fantasy-vfx/scripts/selftest.mjs'],
  ['novel-storyboard selftest', '.agents/skills/novel-storyboard/scripts/selftest.mjs'],
  ['novel-edit-director selftest', '.agents/skills/novel-edit-director/scripts/selftest.mjs'],
]) {
  run(name, [selftest]);
}

const scratch = mkdtempSync(join(tmpdir(), 'novel-directing-skills-'));
const fantasyCli = '.agents/skills/novel-fantasy-vfx/scripts/novel-fantasy-vfx.mjs';
const fantasyScript = '.agents/skills/novel-fantasy-vfx/examples/fixtures/script.json';
const fantasyEffects = '.agents/skills/novel-fantasy-vfx/examples/阵法-effects.json';
const fantasyOut = join(scratch, 'storyboard-effects.json');
run('novel-fantasy-vfx validate', [fantasyCli, 'validate', fantasyEffects, '--script', fantasyScript], '通过 12 项法术门禁');
run('novel-fantasy-vfx export', [fantasyCli, 'export', fantasyEffects, '--script', fantasyScript, '--out', fantasyOut], '已导出');
const effectSummary = JSON.parse(readFileSync(fantasyOut, 'utf8'));
assert.ok(Object.keys(effectSummary).length > 0, 'storyboard-effects.json 不能为空');

const editCli = '.agents/skills/novel-edit-director/scripts/novel-edit-director.mjs';
const storyboard = '.agents/skills/novel-edit-director/examples/fixtures/storyboard.json';
const edit = '.agents/skills/novel-edit-director/examples/渡口-edit.json';
const transitionsOut = join(scratch, 'transitions.json');
run('novel-edit-director validate', [editCli, 'validate', edit, '--storyboard', storyboard], '通过 12 项剪辑门禁');
run('novel-edit-director export', [editCli, 'export', edit, '--storyboard', storyboard, '--sequence', 'sequence-1', '--out', transitionsOut], '已导出');
const transitions = JSON.parse(readFileSync(transitionsOut, 'utf8'));
assert.equal(transitions.length, 2, '应导出两条相邻段转场');
for (const transition of transitions) {
  assert.ok(['continuous', 'match_cut', 'hard_cut', 'scene_change'].includes(transition.type));
  assert.match(transition.notes, /^edit-director:v1 /);
}

console.log('PASS novel directing skills integration');
