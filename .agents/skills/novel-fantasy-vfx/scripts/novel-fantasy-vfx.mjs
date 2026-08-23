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
function requireValid(doc, script) {
  const problems = validateEffects(doc, script);
  if (problems.length) throw new Error(`法术方案未通过门禁：${problems.map((item) => item.gate).join(', ')}`);
}

export function buildStoryboardSummary(doc, script) {
  requireValid(doc, script);
  const effects = {};
  for (const { ep, effect } of allEffects(doc)) {
    const key = `E${String(ep).padStart(2, '0')}-S${String(effect.sceneIndex ?? effect.sourceBeat.sceneIndex).padStart(2, '0')}-B${String(effect.beat ?? effect.sourceBeat.beat).padStart(2, '0')}`;
    effects[key] = {
      id: effect.id, kind: effect.kind, function: effect.function,
      sourceBeat: clone(effect.sourceBeat), topology: clone(effect.topology),
      phaseSummary: effect.phases.map((item) => `${item.name}: ${item.fromState} -> ${item.toState}`),
      environmentResponse: clone(effect.environmentResponse), endState: clone(effect.endState),
      mustShow: clone(effect.cameraIntent?.mustShow ?? []), actionRefs: clone(effect.actionRefs ?? []),
      generationRisk: clone(effect.generationRisk ?? []),
    };
  }
  return { source: doc?.source ?? script?.source ?? '', version: 1, effects };
}

function fmt(value) {
  return Array.isArray(value) ? value.join('、') : String(value ?? '');
}

export function renderMarkdown(doc, script) {
  requireValid(doc, script);
  const gates = gateReport(doc, script);
  const lines = [`# 法术视觉设计：${doc?.source ?? script?.source ?? ''}`, '', `门禁：${gates.filter((gate) => gate.pass).length}/${gates.length}`, ''];
  for (const { ep, effect } of allEffects(doc)) {
    lines.push(`## E${String(ep).padStart(2, '0')} · ${effect.id}`, '', `- 来源：${effect.sourceBeat.text}`, `- 类型/功能：${effect.kind} / ${effect.function}`,
      `- 拓扑：${effect.topology.shape}，原点 ${effect.topology.origin}，尺度 ${effect.topology.scale}`,
      `- 生命周期：${effect.phases.map((item) => item.name).join(' → ')}`,
      `- 环境响应：${fmt(effect.environmentResponse.responses)}`, `- 结束状态：${effect.endState.phase} / ${effect.endState.persistence}`,
      `- 必须看见：${fmt(effect.cameraIntent?.mustShow)}`, `- 动作引用：${fmt(effect.actionRefs) || '无'}`,
      `- 生成风险：${fmt(effect.generationRisk) || '无'}`, '');
  }
  lines.push('## 门禁结果', '', ...gates.map((gate) => `- ${gate.pass ? '✓' : '✗'} ${gate.id}`), '');
  return lines.join('\n');
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function renderHtml(doc, script) {
  requireValid(doc, script);
  const gates = gateReport(doc, script);
  const cards = allEffects(doc).map(({ effect }) => `<article><h2>${escapeHtml(effect.id)}</h2><p><b>来源：</b>${escapeHtml(effect.sourceBeat.text)}</p><p><b>拓扑：</b>${escapeHtml(`${effect.topology.shape} / ${effect.topology.origin} / ${effect.topology.scale}`)}</p><p><b>生命周期：</b>${escapeHtml(effect.phases.map((item) => item.name).join(' → '))}</p><p><b>环境响应：</b>${escapeHtml(fmt(effect.environmentResponse.responses))}</p><p><b>结束状态：</b>${escapeHtml(`${effect.endState.phase} / ${effect.endState.persistence}`)}</p><p><b>生成风险：</b>${escapeHtml(fmt(effect.generationRisk) || '无')}</p></article>`).join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>法术视觉设计</title><body><h1>${escapeHtml(doc?.source ?? script?.source ?? '')}</h1><p>门禁：${gates.filter((gate) => gate.pass).length}/${gates.length}</p>${cards}<h2>门禁结果</h2><ul>${gates.map((gate) => `<li>${gate.pass ? '✓' : '✗'} ${escapeHtml(gate.id)}</li>`).join('')}</ul></body></html>`;
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function loadJson(path, read) {
  if (!path) throw new Error('缺少必需的 JSON 路径');
  try { return JSON.parse(read(path, 'utf8')); } catch (error) { throw new Error(`无法读取 JSON ${path}：${error.message}`); }
}

export async function runCli(args, io = { readFileSync, writeFileSync, stdout: process.stdout, stderr: process.stderr }) {
  const out = (value) => io.stdout.write(`${value}\n`);
  try {
    const [command, input] = args;
    if (!command || !input) throw new Error('用法：seed|validate|render|export <input.json> ...');
    if (command === 'seed') {
      const script = loadJson(input, io.readFileSync);
      out(JSON.stringify(seedFromScript(script, parseEpisodeRange(option(args, '--eps'))), null, 2));
    } else if (command === 'validate') {
      const doc = loadJson(input, io.readFileSync);
      const script = loadJson(option(args, '--script'), io.readFileSync);
      requireValid(doc, script);
      out(`✓ 通过 ${GATE_IDS.length} 项法术门禁`);
    } else if (command === 'render') {
      const doc = loadJson(input, io.readFileSync);
      const script = loadJson(option(args, '--script'), io.readFileSync);
      if (!args.includes('--md') && !args.includes('--html')) throw new Error('render 必须指定 --md 或 --html');
      out(args.includes('--html') ? renderHtml(doc, script) : renderMarkdown(doc, script));
    } else if (command === 'export') {
      const doc = loadJson(input, io.readFileSync);
      const script = loadJson(option(args, '--script'), io.readFileSync);
      const outputPath = option(args, '--out');
      if (!outputPath) throw new Error('export 缺少 --out');
      io.writeFileSync(outputPath, `${JSON.stringify(buildStoryboardSummary(doc, script), null, 2)}\n`, 'utf8');
      out(`✓ 已导出 ${outputPath}`);
    } else {
      throw new Error(`未知命令：${command}`);
    }
    return 0;
  } catch (error) {
    io.stderr.write(`错误：${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await runCli(process.argv.slice(2), { readFileSync, writeFileSync, stdout: process.stdout, stderr: process.stderr });
  process.exitCode = code;
}
