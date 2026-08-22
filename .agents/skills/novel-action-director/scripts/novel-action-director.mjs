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

export function expandScript(script) {
  if (!script || !Array.isArray(script.episodes)) {
    throw new TypeError('script.json 缺少 episodes 数组');
  }

  const expanded = new Map();
  for (const episode of script.episodes) {
    if (!Number.isInteger(episode.ep)) {
      throw new TypeError('script.json 的 episode.ep 必须是整数');
    }
    expanded.set(episode.ep, clone(episode));
  }
  return expanded;
}

function seedBeat(beat, beatIndex) {
  return {
    index: beatIndex + 1,
    ...clone(beat),
  };
}

function seedScene(scene, sceneIndex) {
  return {
    index: scene.index ?? sceneIndex + 1,
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
  for (const episode of script?.episodes ?? []) {
    for (const [sceneOffset, scene] of (episode.scenes ?? []).entries()) {
      const sceneIndex = scene.index ?? sceneOffset + 1;
      for (const [beatOffset, beat] of (scene.beats ?? []).entries()) {
        const beatIndex = beat.index ?? beatOffset + 1;
        facts.set(actionKey(episode.ep, sceneIndex, beatIndex), { episode, scene, beat, beatIndex });
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
    const fields = ['kind', 'text', 'speaker', 'line'];
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
    if (profile === 'realistic' && (displacement.airborne || displacement.supernatural || Number(displacement.distanceMeters ?? 0) > 2)) {
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
