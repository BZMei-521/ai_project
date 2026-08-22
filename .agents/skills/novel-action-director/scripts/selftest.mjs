import assert from 'node:assert/strict';
import {
  ACTION_KINDS,
  PHYSICS_PROFILES,
  buildStoryboardSummary,
  expandScript,
  gateReport,
  parseEpisodeRange,
  renderHtml,
  renderMarkdown,
  seedFromScript,
  validateAction,
} from './novel-action-director.mjs';

let assertions = 0;
const check = (fn) => {
  fn();
  assertions += 1;
};

const SCRIPT = {
  source: '测试剧',
  episodes: [
    {
      ep: 1,
      scenes: [
        {
          index: 1,
          characters: ['C01', 'C02'],
          props: ['P01'],
          beats: [
            { kind: 'action', text: '她挡在同伴身前。', seconds: 2.5 },
            { kind: 'dialogue', speaker: 'C02', line: '小心！', seconds: 1.2 },
          ],
        },
      ],
    },
    {
      ep: 2,
      scenes: [
        {
          index: 1,
          characters: ['C01'],
          props: [],
          beats: [{ kind: 'action', text: '她停在门外。', seconds: 1.5 }],
        },
      ],
    },
  ],
};

check(() => assert.deepEqual(PHYSICS_PROFILES, ['realistic', 'wuxia', 'xianxia', 'stylized']));
check(() => assert.ok(ACTION_KINDS.includes('combat')));
check(() => assert.equal(expandScript(SCRIPT).get(1).scenes[0].beats[0].text, '她挡在同伴身前。'));
check(() => assert.deepEqual([...parseEpisodeRange('1-2')], [1, 2]));
check(() => assert.equal(parseEpisodeRange(null), null));
check(() => assert.throws(() => parseEpisodeRange('2-1'), /无效集数范围/));

const seed = seedFromScript(SCRIPT);
check(() => assert.equal(seed.version, 1));
check(() => assert.equal(seed.source, '测试剧'));
check(() => assert.equal(seed.physicsProfile, 'realistic'));
check(() => assert.equal(seed.episodes[0].seedScenes[0].beats.length, 2));
check(() => assert.deepEqual(seed.episodes[0].actions, []));
check(() => assert.deepEqual(seedFromScript(SCRIPT, parseEpisodeRange('2')).episodes.map(({ ep }) => ep), [2]));

const expanded = expandScript(SCRIPT);
expanded.get(1).scenes[0].beats[0].text = '被修改';
check(() => assert.equal(SCRIPT.episodes[0].scenes[0].beats[0].text, '她挡在同伴身前。'));

const FLOW_SCRIPT = {
  source: '生产格式',
  episodes: [{
    ep: 1,
    scenes: [{
      sceneId: 'S09',
      characters: ['C01'],
      props: ['P01'],
      flow: [
        { action: '她抱着箱子跑上跳板。' },
        { speaker: 'C01', line: '让开。', delivery: '压低声音' },
      ],
    }],
  }],
};
check(() => assert.equal(expandScript(FLOW_SCRIPT).get(1).scenes[0].sceneIndex, 1));
check(() => assert.equal(expandScript(FLOW_SCRIPT).get(1).scenes[0].beats[0].text, '她抱着箱子跑上跳板。'));
check(() => assert.equal(expandScript(FLOW_SCRIPT).get(1).scenes[0].beats[1].kind, 'line'));
check(() => assert.equal(seedFromScript(FLOW_SCRIPT).episodes[0].seedScenes[0].beats[1].speaker, 'C01'));

const GATE_SCRIPT = {
  source: '门禁测试剧',
  episodes: [{
    ep: 1,
    scenes: [{
      index: 1,
      characters: ['C01', 'C02'],
      props: ['P01'],
      beats: [
        { kind: 'action', text: 'C01 挡住 C02 的进路。' },
        { kind: 'action', text: 'C01 扶住踉跄的 C02。' },
        { kind: 'action', text: 'C02 听见名字后强忍情绪。' },
        { kind: 'action', text: 'C01 用右手打开木匣。' },
        { kind: 'action', text: 'C02 绕过桌角走到门边。' },
        { kind: 'action', text: '两人隔门沉默。' },
      ],
    }],
  }],
};

const recovery = (stablePose) => ({ phase: 'recovery', duration: 0.3, stablePose });
const sourceBeat = (beat, text) => ({ ep: 1, sceneIndex: 1, beat, kind: 'action', text });

const VALID = {
  source: '门禁测试剧',
  version: 1,
  physicsProfile: 'realistic',
  params: { maxMajorActionsPerBeat: 1, requireRecoveryPose: true },
  ordinaryBeatsPreserved: true,
  episodes: [{
    ep: 1,
    actions: [
      {
        id: 'E01-S01-B01-A01', sceneIndex: 1, beat: 1, kind: 'combat', intent: '阻止对方前进',
        participants: ['C01', 'C02'], propRefs: [], sourceBeat: sourceBeat(1, 'C01 挡住 C02 的进路。'),
        startState: { characters: { C01: { support: 'left-foot' }, C02: { position: 'front' } }, props: {} },
        phases: [
          { phase: 'setup', support: 'left-foot' },
          { phase: 'anticipation', weightShift: 'forward' },
          { phase: 'action', path: 'short-forward-arc', support: 'left-foot', landing: 'right-foot' },
          { phase: 'contact', contactPoint: 'C01-forearm/C02-shoulder', forceDirection: 'backward', forceResult: 'C02 stops' },
          { phase: 'reaction', subject: 'C02', response: 'torso recoils and stance widens' },
          recovery('C01 与 C02 各自双脚稳定站立'),
        ],
        endState: { characters: { C01: { support: 'both-feet' }, C02: { position: 'one-step-back' } }, props: {} },
        cameraIntent: { mustShow: ['前臂接触点', 'C02 后退结果'] }, generationRisk: [],
        summaryConsistency: { contradictions: [] },
      },
      {
        id: 'E01-S01-B02-A01', sceneIndex: 1, beat: 2, kind: 'interaction', intent: '扶稳对方',
        participants: ['C01', 'C02'], propRefs: [], sourceBeat: sourceBeat(2, 'C01 扶住踉跄的 C02。'),
        continuity: { timeJump: true },
        startState: { characters: { C01: { hands: { right: 'free' } }, C02: { balance: 'unstable' } }, props: {} },
        interaction: {
          initiator: { id: 'C01', action: '右手伸向 C02 前臂' },
          responder: { id: 'C02', action: '前臂迎向支撑并收住脚步' },
          contact: 'C01 右手掌/C02 左前臂', distanceChange: 'one-arm to half-arm',
          initiatorEnd: '右手稳定托住前臂', responderEnd: '双脚恢复支撑',
        },
        phases: [{ phase: 'action', path: 'hand-short-arc' }, { phase: 'contact', contactPoint: 'right-palm/left-forearm' }, { phase: 'reaction', response: 'C02 regains balance' }, recovery('双方相距半臂稳定站立')],
        endState: { characters: { C01: { hands: { right: 'supporting-C02' } }, C02: { balance: 'stable' } }, props: {} },
        cameraIntent: { mustShow: ['手臂接触', '双方平衡结果'] }, generationRisk: [], summaryConsistency: { contradictions: [] },
      },
      {
        id: 'E01-S01-B03-A01', sceneIndex: 1, beat: 3, kind: 'performance', intent: '压住情绪但泄露震动',
        participants: ['C02'], propRefs: [], sourceBeat: sourceBeat(3, 'C02 听见名字后强忍情绪。'), continuity: { timeJump: true },
        startState: { characters: { C02: { gaze: 'C01', breath: 'even' } }, props: {} },
        performance: { trigger: '听见自己的名字', gazeTarget: 'C01', control: '先压住反应', channels: ['eyelid', 'jaw', 'breath'], leak: '下颌短暂绷紧，呼气延迟', release: '一次缓慢呼气' },
        phases: [{ phase: 'anticipation', gaze: 'C01' }, { phase: 'action', breath: 'held-half-beat' }, recovery('视线仍落在 C01，呼吸恢复')],
        endState: { characters: { C02: { gaze: 'C01', breath: 'slow' } }, props: {} },
        cameraIntent: { mustShow: ['视线目标', '下颌泄露动作'] }, generationRisk: [], summaryConsistency: { contradictions: [] },
      },
      {
        id: 'E01-S01-B04-A01', sceneIndex: 1, beat: 4, kind: 'prop-operation', intent: '打开木匣',
        participants: ['C01'], propRefs: ['P01'], sourceBeat: sourceBeat(4, 'C01 用右手打开木匣。'), continuity: { timeJump: true },
        startState: { characters: { C01: { hands: { left: 'steadying-box', right: 'on-latch' } } }, props: { P01: { state: 'closed' } } },
        propOperation: { leftHand: '扶稳木匣', rightHand: '拨开锁扣并抬盖', contact: 'right-thumb/latch', stateChange: 'closed-to-open' },
        phases: [{ phase: 'action', hands: { left: 'steady', right: 'lift-lid' }, fineFinger: true }, { phase: 'contact', contactPoint: 'right-thumb/latch' }, recovery('左手扶匣，右手停在开启的盖边')],
        endState: { characters: { C01: { hands: { left: 'steadying-box', right: 'on-open-lid' } } }, props: { P01: { state: 'open' } } },
        cameraIntent: { mustShow: ['左右手分工', '木匣开启状态'] }, riskFlags: ['fine-finger'], generationRisk: ['fine-finger'], summaryConsistency: { contradictions: [] },
      },
      {
        id: 'E01-S01-B05-A01', sceneIndex: 1, beat: 5, kind: 'locomotion', intent: '绕过桌角到门边',
        participants: ['C02'], propRefs: [], sourceBeat: sourceBeat(5, 'C02 绕过桌角走到门边。'), continuity: { timeJump: true },
        startState: { characters: { C02: { position: 'table-left', support: 'both-feet' } }, props: {} },
        displacement: { support: 'alternating-feet', path: 'clockwise around table corner', landing: 'door-side mark', distanceMeters: 1.5 },
        phases: [{ phase: 'action', support: 'alternating-feet', path: 'clockwise arc', landing: 'door-side mark' }, recovery('门边站定，双脚承重')],
        endState: { characters: { C02: { position: 'door-side', support: 'both-feet' } }, props: {} },
        cameraIntent: { mustShow: ['绕行路径', '门边落点'] }, generationRisk: [], summaryConsistency: { contradictions: [] },
      },
    ],
  }],
};

const gate = (doc, id) => gateReport(doc, { script: GATE_SCRIPT }).find((item) => item.id === id);
const broken = (mutate) => {
  const value = structuredClone(VALID);
  mutate(value);
  return value;
};

check(() => assert.equal(gateReport(VALID, { script: GATE_SCRIPT }).length, 18));
check(() => assert.ok(gateReport(VALID, { script: GATE_SCRIPT }).every((item) => item.ok)));
check(() => assert.equal(validateAction(VALID, { script: GATE_SCRIPT }).length, 0));

const failures = [
  ['source-reference', (doc) => { doc.episodes[0].actions[0].sceneIndex = 99; }],
  ['source-fidelity', (doc) => { doc.episodes[0].actions[0].sourceBeat.text = '改写后的剧情'; }],
  ['one-major-action', (doc) => { doc.episodes[0].actions.push(structuredClone(doc.episodes[0].actions[0])); }],
  ['boundary-complete', (doc) => { delete doc.episodes[0].actions[0].endState; }],
  ['combat-causality', (doc) => { doc.episodes[0].actions[0].phases = doc.episodes[0].actions[0].phases.filter((phase) => phase.phase !== 'reaction'); }],
  ['contact-force', (doc) => { delete doc.episodes[0].actions[0].phases.find((phase) => phase.phase === 'contact').forceDirection; }],
  ['displacement-grounding', (doc) => { delete doc.episodes[0].actions[4].displacement.landing; }],
  ['interaction-bilateral', (doc) => { delete doc.episodes[0].actions[1].interaction.responder; }],
  ['prop-hands-state', (doc) => { delete doc.episodes[0].actions[3].propOperation.rightHand; }],
  ['performance-trigger-gaze', (doc) => { delete doc.episodes[0].actions[2].performance.gazeTarget; }],
  ['emotion-process', (doc) => { delete doc.episodes[0].actions[2].performance.leak; }],
  ['recovery-pose', (doc) => { doc.episodes[0].actions[4].phases.at(-1).stablePose = ''; }],
  ['physics-profile', (doc) => { doc.episodes[0].actions[4].displacement.airborne = true; }],
  ['adjacent-continuity', (doc) => { doc.episodes[0].actions[1].continuity.timeJump = false; }],
  ['camera-boundary', (doc) => { doc.episodes[0].actions[0].cameraIntent.camera = 'Push In'; }],
  ['summary-consistency', (doc) => { doc.episodes[0].actions[0].summaryConsistency.contradictions.push('同时前进和后退'); }],
  ['generation-risk', (doc) => { doc.episodes[0].actions[3].generationRisk = []; }],
  ['ordinary-beat-preservation', (doc) => { doc.ordinaryBeatsPreserved = false; }],
];

for (const [id, mutate] of failures) {
  check(() => assert.equal(gate(broken(mutate), id).ok, false, `${id} 应失败`));
}

const summary = buildStoryboardSummary(VALID, GATE_SCRIPT);
check(() => assert.equal(summary.physicsProfile, 'realistic'));
check(() => assert.equal(Object.keys(summary.actions).length, 5));
check(() => assert.equal(summary.actions['E01-S01-B01'].actionId, 'E01-S01-B01-A01'));
check(() => assert.deepEqual(summary.actions['E01-S01-B01'].cameraIntent.mustShow, ['前臂接触点', 'C02 后退结果']));
check(() => assert.match(renderMarkdown(VALID, { script: GATE_SCRIPT }), /动作时间线/));
check(() => assert.match(renderMarkdown(VALID, { script: GATE_SCRIPT }), /前臂接触点/));
check(() => assert.match(renderHtml(VALID, { script: GATE_SCRIPT }), /<!doctype html>/i));
check(() => assert.match(renderHtml(VALID, { script: GATE_SCRIPT }), /physicsProfile/));

console.log(`✓ ${assertions} 项自测全部通过`);
