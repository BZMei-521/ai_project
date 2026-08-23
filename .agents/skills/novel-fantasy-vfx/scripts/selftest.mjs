#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EFFECT_KINDS, LIFECYCLE_PHASES, buildStoryboardSummary, expandScript,
  gateReport, renderHtml, renderMarkdown, seedFromScript, validateEffects,
} from './novel-fantasy-vfx.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = JSON.parse(readFileSync(join(here, '../examples/fixtures/script.json'), 'utf8'));
const sourceText = expandScript(SCRIPT).get(1).scenes[0].beats[0].text;
const phase = (name, fromState, toState, transition = '') => ({ name, fromState, toState, ...(transition ? { transition } : {}) });
const validEffect = {
  id: 'E01-S01-B01-FX01', sceneIndex: 1, beat: 1, kind: 'formation', function: 'defense',
  sourceBeat: { sceneIndex: 1, beat: 1, text: sourceText }, participants: ['C01'], propRefs: [],
  startState: { phase: 'dormant', persistence: 'none' },
  endState: { phase: 'residue', persistence: 'ended' },
  topology: {
    shape: 'bagua-circle', origin: 'ground-under-C01', scale: 'body', fineSymbols: true,
    nodes: ['坎', '离', '震', '兑'], circuits: [['坎', '离'], ['震', '兑']],
  },
  phases: [
    phase('dormant', 'unlit', 'unlit'),
    phase('charging', 'unlit', 'gold-lines-gather', 'C01 channels energy into the ground'),
    phase('forming', 'gold-lines-gather', 'bagua-closed', 'eight nodes connect into two circuits'),
    phase('active', 'bagua-closed', 'barrier-raised', 'the completed formation raises a barrier'),
    phase('impact', 'barrier-raised', 'barrier-holds', 'thunder and fire strike the barrier'),
    phase('dissipating', 'barrier-holds', 'light-fades', 'impact energy drains through the circuits'),
    phase('residue', 'light-fades', 'scorched-ring', 'only a scorched ring remains'),
  ],
  environmentResponse: { scale: 'body', responses: ['dust-lifts', 'rain-splits'] },
  cameraIntent: { mustShow: ['ground topology', 'barrier blocks thunder-fire'] },
  generationRisk: ['fine-symbols'], actionRefs: [],
};
const seed = seedFromScript(SCRIPT);
const effectsDoc = { ...seed, episodes: [{ ...seed.episodes[0], effects: [validEffect] }] };
const clone = (value) => structuredClone(value);
const mutate = (fn) => { const doc = clone(effectsDoc); fn(doc.episodes[0].effects[0], doc); return doc; };

assert.ok(EFFECT_KINDS.includes('formation'));
assert.deepEqual(LIFECYCLE_PHASES, ['dormant', 'charging', 'forming', 'active', 'impact', 'dissipating', 'residue']);
assert.equal(expandScript(SCRIPT).get(1).scenes[0].beats.length, 3);
assert.equal(seedFromScript(SCRIPT).episodes[0].seedScenes[0].beats.length, 3);
assert.deepEqual(seedFromScript(SCRIPT).episodes[0].effects, []);

const expectedIds = [
  'source-reference', 'source-fidelity', 'one-major-effect', 'boundary-complete',
  'lifecycle-order', 'topology-coherence', 'activation-continuity',
  'effect-result-authority', 'environment-scale', 'action-boundary',
  'camera-boundary', 'generation-risk',
];
assert.deepEqual(gateReport(effectsDoc, SCRIPT).map((gate) => gate.id), expectedIds);
assert.deepEqual(validateEffects(effectsDoc, SCRIPT), []);

const mutations = new Map([
  ['source-reference', mutate((fx) => { fx.sourceBeat.beat = 99; })],
  ['source-fidelity', mutate((fx) => { fx.sourceBeat.text = '改写后的阵法结果'; })],
  ['one-major-effect', mutate((_fx, doc) => { doc.episodes[0].effects.push(clone(doc.episodes[0].effects[0])); })],
  ['boundary-complete', mutate((fx) => { delete fx.endState; })],
  ['lifecycle-order', mutate((fx) => { [fx.phases[2], fx.phases[3]] = [fx.phases[3], fx.phases[2]]; })],
  ['topology-coherence', mutate((fx) => { fx.topology.circuits = []; })],
  ['activation-continuity', mutate((fx) => { fx.phases[3].fromState = 'impossible-jump'; })],
  ['effect-result-authority', mutate((fx) => { fx.function = 'healing'; })],
  ['environment-scale', mutate((fx) => { fx.topology.scale = 'hand'; fx.environmentResponse.scale = 'world'; })],
  ['action-boundary', mutate((fx) => { fx.phases[1].hands = '双手结印'; })],
  ['camera-boundary', mutate((fx) => { fx.cameraIntent.cameraMove = '快速推进'; })],
  ['generation-risk', mutate((fx) => { fx.generationRisk = []; })],
]);
for (const [gateId, doc] of mutations) {
  const failed = gateReport(doc, SCRIPT).filter((gate) => !gate.pass).map((gate) => gate.id);
  assert.ok(failed.includes(gateId), `${gateId} should fail, got: ${failed.join(', ')}`);
}

const summary = buildStoryboardSummary(effectsDoc, SCRIPT);
const exported = summary.effects['E01-S01-B01'];
assert.equal(exported.function, 'defense');
assert.equal(exported.topology.shape, 'bagua-circle');
assert.equal(exported.phaseSummary[0], 'dormant: unlit -> unlit');
assert.deepEqual(exported.environmentResponse.responses, ['dust-lifts', 'rain-splits']);
assert.equal(exported.endState.persistence, 'ended');
assert.deepEqual(exported.mustShow, ['ground topology', 'barrier blocks thunder-fire']);
assert.deepEqual(exported.actionRefs, []);
assert.deepEqual(exported.generationRisk, ['fine-symbols']);
const markdown = renderMarkdown(effectsDoc, SCRIPT);
const html = renderHtml(effectsDoc, SCRIPT);
assert.match(markdown, /生命周期/);
assert.match(markdown, /拓扑/);
assert.match(markdown, /12\/12/);
assert.match(html, /生命周期/);
assert.match(html, /拓扑/);
assert.match(html, /12\/12/);
console.log(`✓ fantasy-vfx public contract and ${expectedIds.length} gates`);
