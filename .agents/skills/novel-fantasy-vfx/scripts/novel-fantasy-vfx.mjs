#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const EFFECT_KINDS = [
  'formation', 'elemental', 'sword-control', 'barrier', 'seal', 'healing',
  'purification', 'illusion', 'clone', 'invisibility', 'summoning',
  'spatial', 'astral', 'alchemy', 'environmental',
];
export const LIFECYCLE_PHASES = ['dormant', 'charging', 'forming', 'active', 'impact', 'dissipating', 'residue'];
const clone = (value) => structuredClone(value);

export function parseEpisodeRange(value) {
  if (!value) return null;
  const match = /^(\d+)(?:-(\d+))?$/.exec(String(value).trim());
  if (!match) throw new Error(`集数范围无效：${value}`);
  const from = Number(match[1]);
  const to = Number(match[2] ?? match[1]);
  if (from < 1 || to < from) throw new Error(`集数范围无效：${value}`);
  return [from, to];
}

function rawScenes(episode) {
  if (Array.isArray(episode?.scenes)) return episode.scenes;
  if (Array.isArray(episode?.flow)) return episode.flow;
  return [];
}

function rawBeats(scene) {
  if (Array.isArray(scene?.beats)) return scene.beats;
  if (Array.isArray(scene?.flow)) return scene.flow;
  return [];
}

export function expandScript(script) {
  const episodes = new Map();
  for (const [epIndex, episode] of (script?.episodes ?? []).entries()) {
    const ep = Number(episode?.ep ?? epIndex + 1);
    const scenes = rawScenes(episode).map((scene, sceneIndex) => ({
      sceneIndex: sceneIndex + 1,
      sceneId: scene?.id ?? scene?.sceneId ?? `S${String(sceneIndex + 1).padStart(2, '0')}`,
      lighting: scene?.lighting ?? '',
      characters: clone(scene?.characters ?? []),
      props: clone(scene?.props ?? []),
      beats: rawBeats(scene).map((beat, beatIndex) => {
        const isLine = typeof beat?.line === 'string' || typeof beat?.dialogue === 'string';
        return {
          ep,
          sceneIndex: sceneIndex + 1,
          beat: beatIndex + 1,
          kind: isLine ? 'line' : 'action',
          text: isLine ? (beat.line ?? beat.dialogue) : (beat?.action ?? beat?.text ?? ''),
          ...(isLine && beat?.speaker ? { speaker: beat.speaker } : {}),
          ...(isLine && beat?.delivery ? { delivery: beat.delivery } : {}),
        };
      }),
    }));
    episodes.set(ep, { ep, targetSeconds: episode?.targetSeconds ?? 0, scenes });
  }
  return episodes;
}

export function seedFromScript(script, epRange = null) {
  const episodes = [];
  for (const [ep, episode] of expandScript(script)) {
    if (epRange && (ep < epRange[0] || ep > epRange[1])) continue;
    episodes.push({
      ep,
      seedScenes: episode.scenes.map((scene) => ({
        sceneIndex: scene.sceneIndex,
        sceneId: scene.sceneId,
        lighting: scene.lighting,
        characters: clone(scene.characters),
        props: clone(scene.props),
        beats: clone(scene.beats),
      })),
      effects: [],
    });
  }
  return {
    source: script?.source ?? '',
    version: 1,
    params: { maxMajorEffectsPerBeat: 1 },
    ordinaryBeatsPreserved: true,
    episodes,
  };
}

const GATE_IDS = [
  'source-reference', 'source-fidelity', 'one-major-effect', 'boundary-complete',
  'lifecycle-order', 'topology-coherence', 'activation-continuity',
  'effect-result-authority', 'environment-scale', 'action-boundary',
  'camera-boundary', 'generation-risk',
];
const SCALE_RANK = new Map(['hand', 'body', 'room', 'scene', 'world'].map((name, index) => [name, index]));
const RESULT_TERMS = {
  attack: ['攻击', '命中', '斩', '击', '刺'], healing: ['治愈', '疗伤', '恢复'],
  purification: ['净化', '洗尘'], seal: ['封印', '镇压'], summoning: ['召唤'], transformation: ['变身', '变化'],
};

function allEffects(doc) {
  return (doc?.episodes ?? []).flatMap((episode) => (episode.effects ?? []).map((effect) => ({ ep: episode.ep, effect })));
}

function sourceBeat(script, ep, sceneIndex, beat) {
  return expandScript(script).get(Number(ep))?.scenes?.[Number(sceneIndex) - 1]?.beats?.[Number(beat) - 1] ?? null;
}

function containsKey(value, forbidden) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => forbidden.has(key) || containsKey(child, forbidden));
}

function derivedRisks(effect) {
  const risks = new Set();
  const topology = effect?.topology ?? {};
  if (topology.fineSymbols || (topology.nodes?.length ?? 0) >= 4) risks.add('fine-symbols');
  if ((topology.layers ?? 1) > 1 || topology.mirrors === true) risks.add('multi-layer-mirror');
  if (effect?.particles?.density === 'dense') risks.add('dense-particles');
  if ((effect?.participants?.length ?? 0) > 2) risks.add('multi-person-occlusion');
  if (topology.scale === 'world' || effect?.environmentResponse?.scale === 'world') risks.add('large-scale-environment');
  return [...risks];
}

function checkGate(id, doc, script) {
  const entries = allEffects(doc);
  const failures = [];
  for (const { ep, effect } of entries) {
    const ref = sourceBeat(script, ep, effect?.sourceBeat?.sceneIndex, effect?.sourceBeat?.beat);
    if (id === 'source-reference' && !ref) failures.push(effect?.id ?? 'unknown');
    if (id === 'source-fidelity' && ref && ref.text !== effect?.sourceBeat?.text) failures.push(effect?.id ?? 'unknown');
    if (id === 'boundary-complete' && (!effect?.startState?.phase || !effect?.endState?.phase)) failures.push(effect?.id ?? 'unknown');
    if (id === 'lifecycle-order') {
      const ranks = (effect?.phases ?? []).map((item) => LIFECYCLE_PHASES.indexOf(item.name));
      const reversed = ranks.some((rank, index) => rank < 0 || (index > 0 && rank < ranks[index - 1]));
      const lastActive = effect?.phases?.at(-1)?.name === 'active' && effect?.endState?.persistence !== 'continuing';
      if (!effect?.phases?.length || reversed || lastActive) failures.push(effect?.id ?? 'unknown');
    }
    if (id === 'topology-coherence') {
      const topology = effect?.topology;
      if (!topology?.shape || !topology?.origin || !topology?.scale || !(topology.nodes?.length) || !(topology.circuits?.length)) failures.push(effect?.id ?? 'unknown');
    }
    if (id === 'activation-continuity') {
      const phases = effect?.phases ?? [];
      const broken = phases.some((item, index) => !item.fromState || !item.toState || (index > 0 && (item.fromState !== phases[index - 1].toState || !item.transition)));
      if (broken) failures.push(effect?.id ?? 'unknown');
    }
    if (id === 'effect-result-authority' && ref) {
      const terms = RESULT_TERMS[effect?.function] ?? [];
      if (terms.length && !terms.some((term) => ref.text.includes(term))) failures.push(effect?.id ?? 'unknown');
    }
    if (id === 'environment-scale') {
      const effectRank = SCALE_RANK.get(effect?.topology?.scale);
      const responseRank = SCALE_RANK.get(effect?.environmentResponse?.scale);
      if (effectRank == null || responseRank == null || responseRank > effectRank + 1) failures.push(effect?.id ?? 'unknown');
    }
    if (id === 'action-boundary' && containsKey(effect?.phases, new Set(['hands', 'supportFoot', 'weightShift', 'bodyPose']))) failures.push(effect?.id ?? 'unknown');
    if (id === 'camera-boundary' && containsKey(effect?.cameraIntent, new Set(['camera', 'cameraMove', 'lens', 'shotSize']))) failures.push(effect?.id ?? 'unknown');
    if (id === 'generation-risk') {
      const declared = new Set(effect?.generationRisk ?? []);
      if (derivedRisks(effect).some((risk) => !declared.has(risk))) failures.push(effect?.id ?? 'unknown');
    }
  }
  if (id === 'one-major-effect') {
    const counts = new Map();
    const max = Number(doc?.params?.maxMajorEffectsPerBeat ?? 1);
    for (const { ep, effect } of entries) {
      const key = `${ep}:${effect?.sceneIndex ?? effect?.sourceBeat?.sceneIndex}:${effect?.beat ?? effect?.sourceBeat?.beat}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) if (count > max) failures.push(`${key}=${count}`);
  }
  return { id, pass: failures.length === 0, details: failures };
}

export function gateReport(doc, script) {
  return GATE_IDS.map((id) => checkGate(id, doc, script));
}

export function validateEffects(doc, script) {
  return gateReport(doc, script).filter((gate) => !gate.pass).map((gate) => ({ gate: gate.id, details: gate.details }));
}
export function buildStoryboardSummary() { return { source: '', effects: {} }; }
export function renderMarkdown() { return ''; }
export function renderHtml() { return ''; }
export async function runCli() { return 0; }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await runCli(process.argv.slice(2), { readFileSync, writeFileSync, stdout: process.stdout, stderr: process.stderr });
  process.exitCode = code;
}
