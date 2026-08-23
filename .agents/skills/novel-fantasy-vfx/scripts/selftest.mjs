#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EFFECT_KINDS,
  LIFECYCLE_PHASES,
  buildStoryboardSummary,
  expandScript,
  gateReport,
  renderHtml,
  renderMarkdown,
  seedFromScript,
  validateEffects,
} from './novel-fantasy-vfx.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = JSON.parse(readFileSync(join(here, '../examples/fixtures/script.json'), 'utf8'));

assert.ok(EFFECT_KINDS.includes('formation'));
assert.deepEqual(LIFECYCLE_PHASES, ['dormant', 'charging', 'forming', 'active', 'impact', 'dissipating', 'residue']);
assert.equal(expandScript(SCRIPT).get(1).scenes[0].beats.length, 3);
assert.equal(seedFromScript(SCRIPT).episodes[0].seedScenes[0].beats.length, 3);
assert.deepEqual(seedFromScript(SCRIPT).episodes[0].effects, []);
assert.equal(typeof gateReport, 'function');
assert.equal(typeof validateEffects, 'function');
assert.equal(typeof buildStoryboardSummary, 'function');
assert.equal(typeof renderMarkdown, 'function');
assert.equal(typeof renderHtml, 'function');

console.log('✓ fantasy-vfx public contract');
