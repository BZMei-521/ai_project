import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PHYSICS_PROFILES = ['realistic', 'wuxia', 'xianxia', 'stylized'];
export const ACTION_KINDS = ['performance', 'interaction', 'combat', 'prop-operation', 'locomotion'];
export const DEFAULT_PARAMS = Object.freeze({
  maxMajorActionsPerBeat: 1,
  requireRecoveryPose: true,
});

export function parseEpisodeRange(text) {
  if (!text) return null;
  const match = /^(\d+)(?:-(\d+))?$/.exec(String(text).trim());
  if (!match) throw new Error(`无效集数范围：${text}`);
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (start < 1 || end < start) throw new Error(`无效集数范围：${text}`);
  return new Set(Array.from({ length: end - start + 1 }, (_, index) => start + index));
}

function clone(value) {
  return structuredClone(value);
}

function normalizeBeat(beat, beatIndex) {
  if (typeof beat?.line === 'string') {
    return {
      n: beatIndex + 1,
      kind: 'line',
      speaker: beat.speaker,
      delivery: beat.delivery ?? '',
      text: beat.line,
      ...(beat.seconds != null ? { seconds: beat.seconds } : {}),
    };
  }
  return {
    n: beat.n ?? beat.index ?? beatIndex + 1,
    ...clone(beat),
    kind: beat.kind ?? 'action',
    text: beat.text ?? beat.action ?? '',
  };
}

function normalizeScene(scene, sceneIndex) {
  const rawBeats = scene.beats ?? scene.flow ?? [];
  return {
    ...clone(scene),
    sceneIndex: scene.sceneIndex ?? scene.index ?? sceneIndex + 1,
    sceneId: scene.sceneId ?? `S${String(sceneIndex + 1).padStart(2, '0')}`,
    lighting: scene.lighting ?? '',
    characters: clone(scene.characters ?? []),
    props: clone(scene.props ?? []),
    beats: rawBeats.map(normalizeBeat),
  };
}

export function expandScript(script) {
  if (!script || !Array.isArray(script.episodes)) {
    throw new TypeError('script.json 缺少 episodes 数组');
  }

  const expanded = new Map();
  for (const episode of script.episodes) {
    if (!Number.isInteger(episode.ep)) {
      throw new TypeError('script.json 的 episode.ep 必须是整数');
    }
    expanded.set(episode.ep, {
      ...clone(episode),
      scenes: (episode.scenes ?? []).map(normalizeScene),
    });
  }
  return expanded;
}

function seedBeat(beat, beatIndex) {
  return {
    n: beat.n ?? beatIndex + 1,
    index: beat.n ?? beatIndex + 1,
    ...clone(beat),
  };
}

function seedScene(scene, sceneIndex) {
  return {
    sceneIndex: scene.sceneIndex ?? scene.index ?? sceneIndex + 1,
    index: scene.sceneIndex ?? scene.index ?? sceneIndex + 1,
    sceneId: scene.sceneId,
    lighting: scene.lighting ?? '',
    characters: clone(scene.characters ?? []),
    props: clone(scene.props ?? []),
    beats: (scene.beats ?? []).map(seedBeat),
  };
}

export function seedFromScript(script, epRange = null) {
  const expanded = expandScript(script);
  const episodes = [];

  for (const [ep, episode] of expanded) {
    if (epRange && !epRange.has(ep)) continue;
    episodes.push({
      ep,
      seedScenes: (episode.scenes ?? []).map(seedScene),
      actions: [],
    });
  }

  return {
    version: 1,
    source: script.source ?? '',
    physicsProfile: 'realistic',
    episodes,
  };
}

const GATE_DEFINITIONS = [
  ['source-reference', '剧本引用真实存在'],
  ['source-fidelity', '剧情事实不可改写'],
  ['one-major-action', '每节拍一个主动作'],
  ['boundary-complete', '首尾状态完整'],
  ['combat-causality', '战斗攻防与受力链'],
  ['contact-force', '接触点与受力结果'],
  ['displacement-grounding', '位移支撑、路径与落点'],
  ['interaction-bilateral', '双人互动双方完整'],
  ['prop-hands-state', '左右手与道具状态变化'],
  ['performance-trigger-gaze', '微表情触发与注视对象'],
  ['emotion-process', '情绪变化过程'],
  ['recovery-pose', '恢复姿态可承接'],
  ['physics-profile', '题材物理档位'],
  ['adjacent-continuity', '相邻动作状态连续'],
  ['camera-boundary', '镜头意图不越界'],
  ['summary-consistency', '摘要动作不矛盾'],
  ['generation-risk', '生成风险已标记'],
  ['ordinary-beat-preservation', '普通节拍保持剧本权威'],
];

function actionEntries(doc) {
  return (doc?.episodes ?? []).flatMap((episode) =>
    (episode.actions ?? []).map((action) => ({ episode, action }))
  );
}

function scriptFacts(script) {
  const facts = new Map();
  if (!script) return facts;
  for (const [ep, episode] of expandScript(script)) {
    for (const scene of episode.scenes ?? []) {
      for (const beat of scene.beats ?? []) {
        facts.set(actionKey(ep, scene.sceneIndex, beat.n), { episode, scene, beat, beatIndex: beat.n });
      }
    }
  }
  return facts;
}

function actionKey(ep, sceneIndex, beat) {
  return `E${String(ep).padStart(2, '0')}-S${String(sceneIndex).padStart(2, '0')}-B${String(beat).padStart(2, '0')}`;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasContent(value) {
  return isObject(value) && Object.keys(value).length > 0;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sameValue(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function fail(ids) {
  return ids.filter(Boolean).join('；');
}

function sourceReference(doc, ctx) {
  const facts = scriptFacts(ctx?.script);
  const problems = [];
  for (const { episode, action } of actionEntries(doc)) {
    const key = actionKey(episode.ep, action.sceneIndex, action.beat);
    const fact = facts.get(key);
    if (!fact) {
      problems.push(`${action.id ?? key} 未引用真实剧本节拍`);
      continue;
    }
    const unknownCharacters = (action.participants ?? []).filter((id) => !(fact.scene.characters ?? []).includes(id));
    const unknownProps = (action.propRefs ?? []).filter((id) => !(fact.scene.props ?? []).includes(id));
    if (unknownCharacters.length) problems.push(`${action.id} 引用了场景外角色 ${unknownCharacters.join(', ')}`);
    if (unknownProps.length) problems.push(`${action.id} 引用了场景外道具 ${unknownProps.join(', ')}`);
  }
  return fail(problems);
}

function sourceFidelity(doc, ctx) {
  const facts = scriptFacts(ctx?.script);
  const problems = [];
  for (const { episode, action } of actionEntries(doc)) {
    const key = actionKey(episode.ep, action.sceneIndex, action.beat);
    const expected = facts.get(key)?.beat;
    if (!expected) continue;
    const claimed = action.sourceBeat;
    const fields = ['kind', 'text', 'speaker', 'delivery'];
    if (!claimed || claimed.ep !== episode.ep || claimed.sceneIndex !== action.sceneIndex || claimed.beat !== action.beat || fields.some((field) => (expected[field] ?? null) !== (claimed[field] ?? null))) {
      problems.push(`${action.id ?? key} 的 sourceBeat 与剧本不一致`);
    }
  }
  return fail(problems);
}

function oneMajorAction(doc) {
  const counts = new Map();
  const limit = doc?.params?.maxMajorActionsPerBeat ?? DEFAULT_PARAMS.maxMajorActionsPerBeat;
  for (const { episode, action } of actionEntries(doc)) {
    const key = actionKey(episode.ep, action.sceneIndex, action.beat);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return fail([...counts].filter(([, count]) => count > limit).map(([key]) => `${key} 超过 ${limit} 个主动作`));
}

function boundaryComplete(doc) {
  return fail(actionEntries(doc).map(({ action }) =>
    hasContent(action.startState) && hasContent(action.endState) ? '' : `${action.id} 缺少完整 startState/endState`
  ));
}

function phaseOf(action, name) {
  return (action.phases ?? []).find((phase) => phase.phase === name);
}

function combatCausality(doc) {
  const required = ['setup', 'anticipation', 'action', 'contact', 'reaction', 'recovery'];
  return fail(actionEntries(doc).map(({ action }) => {
    if (action.kind !== 'combat') return '';
    const missing = required.filter((name) => !phaseOf(action, name));
    return missing.length ? `${action.id} 缺少 ${missing.join(', ')} 阶段` : '';
  }));
}

function contactForce(doc) {
  return fail(actionEntries(doc).map(({ action }) => {
    if (action.kind !== 'combat') return '';
    const contact = phaseOf(action, 'contact');
    const missing = ['contactPoint', 'forceDirection', 'forceResult'].filter((field) => !contact?.[field]);
    return missing.length ? `${action.id} 接触阶段缺少 ${missing.join(', ')}` : '';
  }));
}

function displacementGrounding(doc) {
  return fail(actionEntries(doc).map(({ action }) => {
    if (!action.displacement) return '';
    const missing = ['support', 'path', 'landing'].filter((field) => !action.displacement[field]);
    return missing.length ? `${action.id} 位移缺少 ${missing.join(', ')}` : '';
  }));
}

function interactionBilateral(doc) {
  return fail(actionEntries(doc).map(({ action }) => {
    if (action.kind !== 'interaction') return '';
    const interaction = action.interaction ?? {};
    const missing = ['initiator', 'responder', 'contact', 'distanceChange', 'initiatorEnd', 'responderEnd'].filter((field) => !interaction[field]);
    return missing.length ? `${action.id} 双人互动缺少 ${missing.join(', ')}` : '';
  }));
}

function propHandsState(doc) {
  return fail(actionEntries(doc).map(({ action }) => {
    if (action.kind !== 'prop-operation') return '';
    const operation = action.propOperation ?? {};
    const missing = ['leftHand', 'rightHand', 'contact', 'stateChange'].filter((field) => !operation[field]);
    const changed = (action.propRefs ?? []).some((ref) => !sameValue(action.startState?.props?.[ref], action.endState?.props?.[ref]));
    if (!changed) missing.push('道具首尾状态变化');
    return missing.length ? `${action.id} 道具操作缺少 ${missing.join(', ')}` : '';
  }));
}

function performanceTriggerGaze(doc) {
  return fail(actionEntries(doc).map(({ action }) => {
    if (action.kind !== 'performance') return '';
    const missing = ['trigger', 'gazeTarget'].filter((field) => !action.performance?.[field]);
    return missing.length ? `${action.id} 表演缺少 ${missing.join(', ')}` : '';
  }));
}

function emotionProcess(doc) {
  return fail(actionEntries(doc).map(({ action }) => {
    if (action.kind !== 'performance') return '';
    const performance = action.performance ?? {};
    const missing = ['control', 'leak', 'release'].filter((field) => !performance[field]);
    if (!Array.isArray(performance.channels) || performance.channels.length === 0) missing.push('channels');
    return missing.length ? `${action.id} 情绪过程缺少 ${missing.join(', ')}` : '';
  }));
}

function recoveryPose(doc) {
  if (doc?.params?.requireRecoveryPose === false) return '';
  return fail(actionEntries(doc).map(({ action }) => {
    const recoveryPhase = phaseOf(action, 'recovery');
    return recoveryPhase?.stablePose ? '' : `${action.id} 缺少可承接的 recovery 稳定姿态`;
  }));
}

function physicsProfile(doc) {
  const profile = doc?.physicsProfile;
  const problems = [];
  if (!PHYSICS_PROFILES.includes(profile)) return `未知 physicsProfile：${profile}`;
  for (const { action } of actionEntries(doc)) {
    const displacement = action.displacement ?? {};
    if (profile === 'realistic' && (displacement.airborne || displacement.supernatural || Number(displacement.impactDisplacementMeters ?? 0) > 2)) {
      problems.push(`${action.id} 超出 realistic 位移上限`);
    }
    if (profile === 'stylized' && !doc?.params?.stylizedLimits) {
      problems.push('stylized 档位必须声明 params.stylizedLimits');
    }
  }
  return fail(problems);
}

function adjacentContinuity(doc) {
  const problems = [];
  for (const episode of doc?.episodes ?? []) {
    const groups = new Map();
    for (const action of episode.actions ?? []) {
      const list = groups.get(action.sceneIndex) ?? [];
      list.push(action);
      groups.set(action.sceneIndex, list);
    }
    for (const list of groups.values()) {
      list.sort((left, right) => left.beat - right.beat);
      for (let index = 1; index < list.length; index += 1) {
        const previous = list[index - 1];
        const current = list[index];
        if (current.continuity?.timeJump === true) continue;
        if (!sameValue(previous.endState, current.startState)) problems.push(`${current.id} 的 startState 未承接 ${previous.id} 的 endState`);
      }
    }
  }
  return fail(problems);
}

function cameraBoundary(doc) {
  const forbidden = ['camera', 'cameraMove', 'move', 'lens', 'focalLength', 'shotSize', 'framing'];
  return fail(actionEntries(doc).map(({ action }) => {
    const fields = forbidden.filter((field) => action.cameraIntent?.[field] != null);
    return fields.length ? `${action.id} 的 cameraIntent 越界包含 ${fields.join(', ')}` : '';
  }));
}

function summaryConsistency(doc) {
  return fail(actionEntries(doc).map(({ action }) => {
    const contradictions = action.summaryConsistency?.contradictions;
    return Array.isArray(contradictions) && contradictions.length ? `${action.id} 摘要存在矛盾：${contradictions.join(', ')}` : '';
  }));
}

function generationRisk(doc) {
  return fail(actionEntries(doc).map(({ action }) => {
    const required = new Set(action.riskFlags ?? []);
    if ((action.phases ?? []).some((phase) => phase.fineFinger)) required.add('fine-finger');
    if ((action.participants ?? []).length >= 3) required.add('multi-person-occlusion');
    const marked = new Set(action.generationRisk ?? []);
    const missing = [...required].filter((risk) => !marked.has(risk));
    return missing.length ? `${action.id} 未标记生成风险 ${missing.join(', ')}` : '';
  }));
}

function ordinaryBeatPreservation(doc, ctx) {
  if (doc?.ordinaryBeatsPreserved !== true) return '未明确普通节拍仍由 script.json 保留';
  const facts = scriptFacts(ctx?.script);
  const keys = new Set(actionEntries(doc).map(({ episode, action }) => actionKey(episode.ep, action.sceneIndex, action.beat)));
  if (keys.size >= facts.size && facts.size > 0) return '动作摘要不得覆盖全部普通节拍';
  return '';
}

const GATE_CHECKS = {
  'source-reference': sourceReference,
  'source-fidelity': sourceFidelity,
  'one-major-action': oneMajorAction,
  'boundary-complete': boundaryComplete,
  'combat-causality': combatCausality,
  'contact-force': contactForce,
  'displacement-grounding': displacementGrounding,
  'interaction-bilateral': interactionBilateral,
  'prop-hands-state': propHandsState,
  'performance-trigger-gaze': performanceTriggerGaze,
  'emotion-process': emotionProcess,
  'recovery-pose': recoveryPose,
  'physics-profile': physicsProfile,
  'adjacent-continuity': adjacentContinuity,
  'camera-boundary': cameraBoundary,
  'summary-consistency': summaryConsistency,
  'generation-risk': generationRisk,
  'ordinary-beat-preservation': ordinaryBeatPreservation,
};

export function gateReport(doc, ctx = {}) {
  return GATE_DEFINITIONS.map(([id, label]) => {
    const detail = GATE_CHECKS[id](doc, ctx);
    return { id, label, ok: detail.length === 0, detail: detail || '通过' };
  });
}

export function validateAction(doc, ctx = {}) {
  return gateReport(doc, ctx).filter((gate) => !gate.ok).map((gate) => `${gate.label}：${gate.detail}`);
}

function phaseSummary(action) {
  return (action.phases ?? []).map((phase) => ({
    phase: phase.phase,
    duration: phase.duration,
    subject: phase.subject,
    target: phase.target,
    path: phase.path,
    contactPoint: phase.contactPoint,
    forceDirection: phase.forceDirection,
    forceResult: phase.forceResult,
    response: phase.response,
    stablePose: phase.stablePose,
  })).map((phase) => Object.fromEntries(Object.entries(phase).filter(([, value]) => value != null)));
}

export function buildStoryboardSummary(doc, script) {
  const problems = validateAction(doc, { script });
  if (problems.length) throw new Error(`action.json 未通过验证：\n${problems.join('\n')}`);
  const actions = {};
  for (const { episode, action } of actionEntries(doc)) {
    actions[actionKey(episode.ep, action.sceneIndex, action.beat)] = {
      actionId: action.id,
      kind: action.kind,
      intent: action.intent,
      participants: clone(action.participants ?? []),
      propRefs: clone(action.propRefs ?? []),
      startState: clone(action.startState),
      endState: clone(action.endState),
      phaseSummary: phaseSummary(action),
      cameraIntent: clone(action.cameraIntent ?? {}),
      generationRisk: clone(action.generationRisk ?? []),
    };
  }
  return { version: 1, source: doc.source, physicsProfile: doc.physicsProfile, actions };
}

function json(value) {
  return JSON.stringify(value, null, 2);
}

function totalScriptBeats(script) {
  return scriptFacts(script).size;
}

function timelineLines(doc) {
  const lines = [];
  for (const { episode, action } of actionEntries(doc)) {
    const title = `${action.id} · ${action.kind} · ${action.intent}`;
    lines.push(`### ${title}`);
    lines.push('');
    lines.push(`- 来源：E${episode.ep} / S${action.sceneIndex} / B${action.beat}`);
    lines.push(`- 参与者：${(action.participants ?? []).join('、') || '无'}`);
    lines.push(`- 道具：${(action.propRefs ?? []).join('、') || '无'}`);
    lines.push(`- 首态：\`${JSON.stringify(action.startState)}\``);
    for (const phase of action.phases ?? []) {
      const details = Object.entries(phase)
        .filter(([key, value]) => key !== 'phase' && value != null)
        .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
        .join('；');
      lines.push(`  - ${phase.phase}${details ? `：${details}` : ''}`);
    }
    lines.push(`- 末态：\`${JSON.stringify(action.endState)}\``);
    lines.push(`- 镜头信息需求：${(action.cameraIntent?.mustShow ?? []).join('、') || '无'}`);
    lines.push(`- 生成风险：${(action.generationRisk ?? []).join('、') || '无'}`);
    lines.push('');
  }
  return lines;
}

export function renderMarkdown(doc, ctx = {}) {
  const report = gateReport(doc, ctx);
  const actions = actionEntries(doc);
  const totalBeats = totalScriptBeats(ctx.script);
  const selected = new Set(actions.map(({ episode, action }) => actionKey(episode.ep, action.sceneIndex, action.beat))).size;
  const ordinary = Math.max(0, totalBeats - selected);
  let summary = null;
  if (report.every((gate) => gate.ok)) summary = buildStoryboardSummary(doc, ctx.script);

  const lines = [
    `# ${doc.source || '未命名项目'} · 动作导演报告`,
    '',
    '## KPI',
    '',
    `- physicsProfile：\`${doc.physicsProfile}\``,
    `- 深化动作：${actions.length}`,
    `- 已选关键节拍：${selected}`,
    `- 普通剧本节拍：${ordinary}`,
    `- 门禁通过：${report.filter((gate) => gate.ok).length}/${report.length}`,
    '',
    '## 动作时间线',
    '',
    ...timelineLines(doc),
    '## 质量门',
    '',
    ...report.map((gate) => `- ${gate.ok ? 'PASS' : 'FAIL'} · ${gate.label}：${gate.detail}`),
    '',
  ];

  if (summary) {
    lines.push('## Storyboard 动作摘要', '', '```json', json(summary), '```', '');
  }
  return lines.join('\n');
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderHtml(doc, ctx = {}) {
  const markdown = renderMarkdown(doc, ctx);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(doc.source || '动作导演报告')}</title>
  <style>
    :root{color-scheme:light;background:#f4f1ea;color:#17202a;font-family:system-ui,"Microsoft YaHei",sans-serif}
    body{max-width:1120px;margin:0 auto;padding:32px}main{background:#fff;padding:32px;border-radius:18px;box-shadow:0 12px 40px #18202a18}
    .profile{display:inline-block;padding:6px 10px;border-radius:999px;background:#183153;color:#fff}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}
  </style>
</head>
<body><main><p class="profile">physicsProfile: ${escapeHtml(doc.physicsProfile)}</p><pre>${escapeHtml(markdown)}</pre></main></body>
</html>`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} 缺少参数值`);
  return args[index + 1];
}

function requireOption(args, name) {
  const value = optionValue(args, name);
  if (!value) throw new Error(`必须提供 ${name}`);
  return value;
}

function outputText(text, outPath) {
  if (outPath) writeFileSync(outPath, text, 'utf8');
  else process.stdout.write(`${text}\n`);
}

function usage() {
  return [
    'novel-action-director seed <script.json> [--eps 1-3] [--physics realistic|wuxia|xianxia|stylized]',
    'novel-action-director validate <action.json> --script <script.json> [--cast <cast.json>] [--art <art.json>]',
    'novel-action-director render <action.json> --script <script.json> [--html|--md] [--out <report>]',
    'novel-action-director export <action.json> --script <script.json> [--out <summary.json>]',
  ].join('\n');
}

export function runCli(argv = process.argv.slice(2)) {
  const [command, input, ...args] = argv;
  if (!command || !input) throw new Error(usage());

  if (command === 'seed') {
    const script = readJson(input);
    const physics = optionValue(args, '--physics') ?? 'realistic';
    if (!PHYSICS_PROFILES.includes(physics)) throw new Error(`未知 physicsProfile：${physics}`);
    const doc = seedFromScript(script, parseEpisodeRange(optionValue(args, '--eps')));
    doc.physicsProfile = physics;
    outputText(json(doc), optionValue(args, '--out'));
    return 0;
  }

  const script = readJson(requireOption(args, '--script'));
  const doc = readJson(input);
  const ctx = {
    script,
    cast: optionValue(args, '--cast') ? readJson(optionValue(args, '--cast')) : null,
    art: optionValue(args, '--art') ? readJson(optionValue(args, '--art')) : null,
  };

  if (command === 'validate') {
    const problems = validateAction(doc, ctx);
    if (problems.length) {
      process.stderr.write(`${problems.join('\n')}\n`);
      return 1;
    }
    process.stdout.write(`PASS · 18/18 门禁通过 · ${actionEntries(doc).length} 个动作计划\n`);
    return 0;
  }
  if (command === 'render') {
    const text = args.includes('--html') ? renderHtml(doc, ctx) : renderMarkdown(doc, ctx);
    outputText(text, optionValue(args, '--out'));
    return 0;
  }
  if (command === 'export') {
    outputText(json(buildStoryboardSummary(doc, script)), optionValue(args, '--out'));
    return 0;
  }
  throw new Error(`未知命令：${command}\n${usage()}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
