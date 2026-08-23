import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BOUNDARY_TYPES,
  EDIT_METHODS,
  buildWorkbenchTransitions,
  gateReport,
  renderHtml,
  renderMarkdown,
  seedFromStoryboard,
  validateEdit,
} from './novel-edit-director.mjs';

const fixtureUrl = new URL('../examples/fixtures/storyboard.json', import.meta.url);
const STORYBOARD = JSON.parse(readFileSync(fileURLToPath(fixtureUrl), 'utf8'));
const deepClone = (value) => JSON.parse(JSON.stringify(value));

assert.deepEqual(BOUNDARY_TYPES, ['continuous', 'match_cut', 'hard_cut', 'scene_change']);
assert.deepEqual(EDIT_METHODS, [
  'occlusion-bridge', 'motion-bridge', 'action-match',
  'visual-match', 'time-space-jump', 'emotion-audio-trigger',
]);

const seed = seedFromStoryboard(STORYBOARD);
assert.equal(seed.version, 1);
assert.equal(seed.boundaries.length, 2);
assert.deepEqual(seed.boundaries.map((item) => [item.from, item.to]), [
  ['E01-01', 'E01-02'],
  ['E01-02', 'E01-03'],
]);
assert.ok(seed.boundaries.every((item) => item.type === 'hard_cut'));
assert.ok(seed.boundaries.every((item) => item.bridge.duration === 0));

const VALID_EDIT = deepClone(seed);
Object.assign(VALID_EDIT.boundaries[0], {
  purpose: '保持奔跑动作和方向连续',
  type: 'continuous',
  method: 'motion-bridge',
  outgoingAnchor: '右脚落地',
  incomingAnchor: '右脚落地',
  bridge: {
    visual: '同向动作峰值衔接',
    audio: '脚步声',
    audioSource: 'storyboard',
    duration: 0.18,
    execution: 'shared-frame-at-contact',
  },
  mustMatch: ['action', 'asset', 'screenDirection'],
  intentionalChange: [],
  frameDependency: 'shared_frame',
  actionContinuity: '右脚落地动作连续',
  characterPosition: 'C01保持画面左中部',
  cameraDirection: 'left-to-right',
  stableEndpointAssets: [],
});
Object.assign(VALID_EDIT.boundaries[1], {
  purpose: '从渡口切入船舱并明确时空变化',
  type: 'scene_change',
  method: 'time-space-jump',
  outgoingAnchor: '渡口水面',
  incomingAnchor: '船舱水光',
  bridge: {
    visual: '水面冷光匹配',
    audio: '水声',
    audioSource: 'storyboard',
    duration: 0.25,
    execution: 'hard-cut-on-audio-tail',
  },
  mustMatch: ['color'],
  intentionalChange: ['sceneIndex', 'characters', 'asset', 'screenDirection', 'space', 'action'],
  frameDependency: 'none',
  actionContinuity: '新场景不承接人物动作',
  characterPosition: 'C01离场，C02入场',
  cameraDirection: 'intentional reversal',
  stableEndpointAssets: ['渡口末帧', '船舱首帧'],
});

const GATE_IDS = [
  'source-reference', 'adjacent-boundary', 'one-boundary-per-pair',
  'boundary-type', 'method-compatibility', 'anchor-complete',
  'continuity-evidence', 'occlusion-direction', 'audio-authority',
  'duration-bounds', 'risky-morph-routing', 'workbench-compat',
];
const report = gateReport(VALID_EDIT, { storyboard: STORYBOARD });
assert.deepEqual(report.map((item) => item.id), GATE_IDS);
assert.equal(report.length, 12);
assert.ok(report.every((item) => item.ok), JSON.stringify(report.filter((item) => !item.ok), null, 2));
assert.equal(validateEdit(VALID_EDIT, STORYBOARD), true);

function broken(mutate) {
  const doc = deepClone(VALID_EDIT);
  mutate(doc);
  return doc;
}

const failures = [
  ['source-reference', (doc) => { doc.boundaries[0].from = 'UNKNOWN'; }],
  ['adjacent-boundary', (doc) => { doc.boundaries[0].to = 'E01-03'; }],
  ['one-boundary-per-pair', (doc) => { doc.boundaries.push(deepClone(doc.boundaries[0])); }],
  ['boundary-type', (doc) => { doc.boundaries[0].type = 'dissolve'; }],
  ['method-compatibility', (doc) => { doc.boundaries[0].method = 'time-space-jump'; }],
  ['anchor-complete', (doc) => { doc.boundaries[0].outgoingAnchor = ''; }],
  ['continuity-evidence', (doc) => { doc.boundaries[0].incomingFacts.boundary.action = 'C01突然倒地'; }],
  ['occlusion-direction', (doc) => {
    doc.boundaries[0].method = 'occlusion-bridge';
    doc.boundaries[0].bridge.occlusion = { occluder: '雾', entryDirection: '', exitDirection: '' };
  }],
  ['audio-authority', (doc) => { doc.boundaries[0].bridge.audio = '新增对白：快跑'; }],
  ['duration-bounds', (doc) => { doc.boundaries[0].bridge.duration = 99; }],
  ['risky-morph-routing', (doc) => { doc.boundaries[0].purpose = '跨世界一镜到底'; }],
  ['workbench-compat', (doc) => { doc.boundaries[0].frameDependency = 'future_head'; }],
];
for (const [id, mutate] of failures) {
  const item = gateReport(broken(mutate), { storyboard: STORYBOARD }).find((gate) => gate.id === id);
  assert.equal(item?.ok, false, `${id} 应失败`);
}

const MATCH_EDIT = deepClone(VALID_EDIT);
Object.assign(MATCH_EDIT.boundaries[0], {
  type: 'match_cut',
  method: 'action-match',
  purpose: '在右脚落地的动作峰值匹配剪辑',
});
const transitions = buildWorkbenchTransitions(MATCH_EDIT, STORYBOARD, 'sequence-1');
assert.equal(transitions.length, 2);
const [transition] = transitions;
assert.equal(transition.sequenceId, 'sequence-1');
assert.equal(transition.type, 'match_cut');
assert.equal(transition.durationSeconds, 0.18);
assert.equal(transition.frameDependency, 'shared_frame');
assert.equal(transition.fromShotId, 'E01-01');
assert.equal(transition.toShotId, 'E01-02');
assert.match(transition.notes, /^edit-director:v1 /);
assert.match(transition.notes, /"method":"action-match"/);

const markdown = renderMarkdown(MATCH_EDIT, STORYBOARD);
assert.match(markdown, /action-match/);
assert.match(markdown, /12 项门禁/);
const htmlEdit = deepClone(MATCH_EDIT);
htmlEdit.boundaries[0].purpose = '<script>alert(1)</script>';
const html = renderHtml(htmlEdit, STORYBOARD);
assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.doesNotMatch(html, /<script>alert/);

console.log('✓ edit-director public contract and 12 gates');
