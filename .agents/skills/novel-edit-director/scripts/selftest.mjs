import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BOUNDARY_TYPES,
  EDIT_METHODS,
  seedFromStoryboard,
} from './novel-edit-director.mjs';

const fixtureUrl = new URL('../examples/fixtures/storyboard.json', import.meta.url);
const STORYBOARD = JSON.parse(readFileSync(fileURLToPath(fixtureUrl), 'utf8'));

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

console.log('✓ edit-director public contract');
