#!/usr/bin/env node
// novel-storyboard 自测：不调模型、不花额度，只验确定性逻辑。
// 原则与仓库里其他 skill 一致：每道质量门都要有击穿用例——
// 证明它真的会拦，不是一个永远为真的假测试。

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAMERA_MOVES,
  DEFAULT_PARAMS,
  DEFAULT_STYLE,
  STYLE_PRESETS,
  actionGateReport,
  actionSummaryOf,
  exportPack,
  H3_I2VA_LINE,
  SHOT_SIZES,
  computeStats,
  cutStarts,
  expandScript,
  gateReport,
  h3AlignmentLine,
  h3CutSlices,
  h3CutTime,
  h3Remainder,
  paramsOf,
  renderHtml,
  renderMarkdown,
  seedFromScript,
  segSeconds,
  slug,
  validateStoryboard,
} from './novel-storyboard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(here, '../examples/渡口-storyboard.json'), 'utf8'));
const siblingFixture = (skill, file) => {
  const project = join(here, `../../${skill}/examples/${file}`);
  return existsSync(project) ? project : join(homedir(), '.codex', 'skills', skill, 'examples', file);
};
const SCRIPT = JSON.parse(readFileSync(siblingFixture('novel-script', '渡口-script.json'), 'utf8'));
const OUTLINE = JSON.parse(readFileSync(siblingFixture('novel-outline', '渡口-outline.json'), 'utf8'));
const CAST = JSON.parse(readFileSync(siblingFixture('novel-characters', '渡口-cast.json'), 'utf8'));
const ART = JSON.parse(readFileSync(siblingFixture('novel-art', '渡口-art.json'), 'utf8'));
const CTX = { script: SCRIPT, outline: OUTLINE, cast: CAST, art: ART };

let passed = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  passed += 1;
}
function eq(actual, expected, label) {
  assert.equal(actual, expected, `${label} — 期望 ${expected}，实际 ${actual}`);
  passed += 1;
}
const clone = (x) => structuredClone(x);
const gate = (doc, id, ctx = CTX) => gateReport(doc, ctx).find((g) => g.id === id);

/* ---------------- expandScript ---------------- */

const expanded = expandScript(SCRIPT);
eq(expanded.size, 6, '剧本六集全部展开');
const e1 = expanded.get(1);
eq(e1.scenes.length, 2, '第 1 集两场');
eq(e1.scenes[0].beats.length, 13, '第 1 场 13 拍');
eq(e1.scenes[1].beats.length, 22, '第 2 场 22 拍');
eq(e1.scenes[0].beats[0].kind, 'action', '第 1 拍是动作');
eq(e1.scenes[0].beats[0].seconds, 2.5, '动作按 2.5 秒计');
eq(e1.scenes[0].beats[2].speaker, 'C03', '台词带说话人');
eq(e1.targetSeconds, 120, '目标秒数带出来');
eq(expandScript(null).size, 0, '空剧本不崩');

/* ---------------- action.json 可选适配 ---------------- */

const ACTIONS = {
  version: 1,
  source: SCRIPT.source,
  physicsProfile: 'realistic',
  actions: {
    'E01-S01-B01': {
      actionId: 'E01-S01-B01-A01',
      kind: 'locomotion',
      intent: '抱紧皮箱跑向栈桥',
      startState: { characters: { C01: { hands: { left: 'under-P01', right: 'around-P01' } } }, props: { P01: { state: 'closed' } } },
      endState: { characters: { C01: { hands: { left: 'under-P01', right: 'around-P01' } } }, props: { P01: { state: 'closed' } } },
      phaseSummary: [{ phase: 'action', path: 'river-road' }, { phase: 'recovery', stablePose: 'pier-approach' }],
      cameraIntent: { mustShow: ['皮箱始终贴胸', '鞋底踏过水洼'] },
      generationRisk: [],
      impactEvidence: {
        contactPoint: 'right-shoe/puddle-surface',
        contactVisible: true,
        targetLatency: '水面先压低半拍再向外炸开',
        supportChange: '右脚落地承重后左脚继续前送',
        centerOfMassShift: '重心越过右脚向前移动',
        forceDirection: 'downward-forward',
        wholeBodyResult: '身体保持前倾并完成下一步推进',
      },
    },
  },
};

eq(actionSummaryOf(ACTIONS, 1, 1, 1, 1).length, 1, '动作摘要按集场拍命中');
eq(actionSummaryOf(ACTIONS, 1, 1, 2, 3).length, 0, '动作摘要不越过分镜认领区间');
{
  const seeded = seedFromScript(SCRIPT, null, ACTIONS);
  assert.deepEqual(seeded.episodes[0].seedScenes[0].beats[0].actionRefs, ['E01-S01-B01-A01']);
  passed += 1;
  eq(seeded.episodes[0].seedScenes[0].beats[0].actionIntent, '抱紧皮箱跑向栈桥', 'seed 只投影紧凑动作意图');
  eq(seeded.episodes[0].seedScenes[0].beats[0].impactEvidence[0].actionId, 'E01-S01-B01-A01', 'seed 保留打击证据供分镜层选择呈现');
  ok(!Object.hasOwn(seedFromScript(SCRIPT).episodes[0].seedScenes[0].beats[0], 'actionRefs'), '不传 actions 时 seed 形状保持旧版');
}
{
  const doc = clone(FIXTURE);
  const cut = doc.episodes[0].segments[0].cuts[0];
  cut.actionRefs = ['E01-S01-B01-A01'];
  cut.actionStateProjection = {
    startState: clone(ACTIONS.actions['E01-S01-B01'].startState),
    endState: clone(ACTIONS.actions['E01-S01-B01'].endState),
    mustShow: clone(ACTIONS.actions['E01-S01-B01'].cameraIntent.mustShow),
  };
  cut.impactPresentation = {
    actionId: 'E01-S01-B01-A01',
    contactVisibility: 'clear',
    impactPulse: 'brief',
    informationOrder: ['contact', 'latency', 'imbalance'],
    overlapReplays: 1,
    slowMotionPhase: 'post-contact',
  };
  ok(actionGateReport(doc, ACTIONS).every((g) => g.ok), '正确动作认领与状态投影通过');
  ok(gateReport(doc, { ...CTX, actions: ACTIONS }).every((g) => g.ok), '传 actions 时动作门并入总门禁');

  const missing = clone(doc);
  delete missing.episodes[0].segments[0].cuts[0].actionRefs;
  ok(!actionGateReport(missing, ACTIONS).find((g) => g.id === 'action-ownership').ok, '缺动作认领会失败');

  const changedEnd = clone(doc);
  changedEnd.episodes[0].segments[0].cuts[0].actionStateProjection.endState.props.P01.state = 'open';
  ok(!actionGateReport(changedEnd, ACTIONS).find((g) => g.id === 'action-state-projection').ok, '改写末态会失败');

  const changedHand = clone(doc);
  changedHand.episodes[0].segments[0].cuts[0].actionStateProjection.startState.characters.C01.hands.right = 'free';
  ok(!actionGateReport(changedHand, ACTIONS).find((g) => g.id === 'action-fact-integrity').ok, '改写左右手事实会失败');

  const changedContact = clone(doc);
  changedContact.episodes[0].segments[0].cuts[0].actionStateProjection.mustShow = ['错误接触点'];
  ok(!actionGateReport(changedContact, ACTIONS).find((g) => g.id === 'action-fact-integrity').ok, '改写接触/必见事实会失败');

  const cameraOverrideActions = clone(ACTIONS);
  cameraOverrideActions.actions['E01-S01-B01'].cameraIntent.camera = 'Tracking Shot';
  ok(!actionGateReport(doc, cameraOverrideActions).find((g) => g.id === 'action-camera-boundary').ok, '动作层具体运镜覆盖会失败');

  const noPresentation = clone(doc);
  delete noPresentation.episodes[0].segments[0].cuts[0].impactPresentation;
  ok(!actionGateReport(noPresentation, ACTIONS).find((g) => g.id === 'impact-presentation').ok, '有打击证据却缺打击呈现会失败');

  const tooManyReplays = clone(doc);
  tooManyReplays.episodes[0].segments[0].cuts[0].impactPresentation.overlapReplays = 3;
  ok(!actionGateReport(tooManyReplays, ACTIONS).find((g) => g.id === 'impact-presentation').ok, '重叠镜头超过两段会失败');

  const missingEvidenceOrder = clone(doc);
  missingEvidenceOrder.episodes[0].segments[0].cuts[0].impactPresentation.informationOrder = ['effect'];
  ok(!actionGateReport(missingEvidenceOrder, ACTIONS).find((g) => g.id === 'impact-presentation').ok, '信息顺序缺接触与受力反馈会失败');

  const fullActionSlowMotion = clone(doc);
  fullActionSlowMotion.episodes[0].segments[0].cuts[0].impactPresentation.slowMotionPhase = 'full-action';
  ok(!actionGateReport(fullActionSlowMotion, ACTIONS).find((g) => g.id === 'impact-presentation').ok, '整段发力慢放会失败');
}
{
  const skipped = actionGateReport(FIXTURE, null);
  eq(skipped.length, 5, '动作适配器固定五门');
  ok(skipped.every((g) => g.ok && g.detail.includes('未提供 action.json，跳过')), '无 actions 时五门明确跳过');
}

function withCameraImpact() {
  const doc = clone(FIXTURE);
  const cut = doc.episodes[0].segments[0].cuts[0];
  cut.cameraPlan = {
    purpose: '逐步暴露人物压抑情绪', path: 'push-in', speed: 'slow', amplitude: 'short',
    subjectRelation: 'approach', stabilization: 'stable', foregroundOcclusion: 'none',
    startSize: 'medium', endSize: 'close',
  };
  cut.actionRefs = ['E01-S01-B01-A01'];
  cut.actionStateProjection = {
    startState: clone(ACTIONS.actions['E01-S01-B01'].startState),
    endState: clone(ACTIONS.actions['E01-S01-B01'].endState),
    mustShow: clone(ACTIONS.actions['E01-S01-B01'].cameraIntent.mustShow),
  };
  cut.impactPresentation = {
    actionId: 'E01-S01-B01-A01', contactVisibility: 'clear', impactPulse: 'brief',
    informationOrder: ['contact', 'latency', 'imbalance'], overlapReplays: 1,
    slowMotionPhase: 'post-contact',
  };
  return doc;
}

/* ---------------- H3 骨架推导 ---------------- */

eq(h3CutTime(3), '00:03.000', '切点时刻格式 分:秒.毫秒');
eq(h3CutTime(6.5), '00:06.500', '半秒切点');
eq(h3CutTime(65), '01:05.000', '过分钟进位');
eq(cutStarts([{ seconds: 3 }, { seconds: 4 }, { seconds: 3 }]).join(','), '0,3,7', '切点 = 前面分镜秒数累计');
eq(h3AlignmentLine([{ seconds: 5 }]), H3_I2VA_LINE, '默认英文：单分镜的段用官方 I2VA 固定句式');
eq(h3AlignmentLine([{ seconds: 5 }], 'zh'), '目标视频在 0.00 秒处完全参照图 1（来自镜头 1）。', 'zh 模式有中文 I2VA 句式');
{
  const line = h3AlignmentLine([{ seconds: 3 }, { seconds: 4 }]);
  ok(line.startsWith('How the reference pictures align with the target video — '), '默认英文：多分镜用官方对齐句式');
  ok(line.includes('Picture 1 (from Shot 1) aligns with the 0.00-second mark'), '主分镜图钉 0.00 秒');
  ok(line.includes('Picture 2 (from Shot 2) aligns with the 3.00-second mark'), '子分镜图钉自己的切点');
  ok(h3AlignmentLine([{ seconds: 3 }, { seconds: 4 }], 'zh').includes('图 2（来自镜头 2）对齐目标视频 3.00 秒处'), 'zh 模式对齐句式可用');
}
{
  const slices = h3CutSlices('integrated_multimodal_description:\n[Shot 1] aa\n[Shot 2] bb\n\noverall_soundscape: x', 2);
  ok(slices[0].includes('aa') && !slices[0].includes('bb'), '[Shot k] 切片互不越界');
  ok(slices[1].includes('bb') && !slices[1].includes('x'), '切片不吃到声景字段');
  const zh = h3CutSlices('整体视听描述：\n[镜头 1] aa\n[镜头 2] bb\n\n整体音景：x', 2, 'zh');
  ok(zh[0].includes('aa') && zh[1].includes('bb'), 'zh 模式按 [镜头 k] 切片');
}
eq(segSeconds({ cuts: [{ seconds: 3 }, { seconds: 4.5 }] }), 7.5, '段秒数 = 分镜求和');

/* ---------------- computeStats ---------------- */

const stats = computeStats(FIXTURE, SCRIPT);
eq(stats.totals.segments, 10, '样例十段');
eq(stats.totals.cuts, 34, '样例三十四个分镜');
eq(stats.totals.seconds, 119, '总秒数');
eq(stats.totals.targetSeconds, 120, '目标秒数');
ok(stats.totals.avgCutSeconds >= 3 && stats.totals.avgCutSeconds <= 4, '平均一切 3 秒左右——短剧节奏');
eq(stats.batches.length, 2, '两个生成批次（S02 浓雾清晨 / S01 晨雾）');
ok(stats.batches[0].segments.length + stats.batches[1].segments.length === 10, '批次覆盖全部段');
eq(stats.dialogue.length, 19, '第 1 集 19 句台词全部对到段和切');
ok(stats.dialogue.every((d) => /^E01-\d{2}$/.test(d.segment) && d.cut >= 1), '对齐单带段号和切序');
eq(stats.episodes[0].withLines, 10, '台词段计数——本样例每段都带台词，纯画面收在分镜级');
eq(paramsOf({}).maxSegmentSeconds, DEFAULT_PARAMS.maxSegmentSeconds, '默认段上限 15 秒');
eq(paramsOf({}).maxCutSeconds, 5, '默认分镜上限 5 秒');
eq(paramsOf({ params: { maxCutSeconds: 4 } }).maxCutSeconds, 4, '分镜上限可调');

/* ---------------- 质量门：全绿基线 ---------------- */

ok(gateReport(FIXTURE, CTX).every((g) => g.ok), '样例带全部上游全部门通过');
eq(gateReport(FIXTURE, CTX).length, 19, '十九道门');
{
  const valid = clone(FIXTURE);
  valid.episodes[0].segments[0].cuts[0].cameraPlan = {
    purpose: '逐步暴露人物压抑情绪',
    path: 'push-in',
    speed: 'slow',
    amplitude: 'short',
    subjectRelation: 'approach',
    stabilization: 'stable',
    foregroundOcclusion: 'none',
    startSize: 'medium',
    endSize: 'close',
  };
  ok(gate(valid, 'camera-plan').ok, '完整可选镜头计划通过');

  const missingPurpose = clone(valid);
  delete missingPurpose.episodes[0].segments[0].cuts[0].cameraPlan.purpose;
  ok(!gate(missingPurpose, 'camera-plan').ok, '镜头计划缺目的会失败');

  const unknownSpeed = clone(valid);
  unknownSpeed.episodes[0].segments[0].cuts[0].cameraPlan.speed = 'hyper';
  ok(!gate(unknownSpeed, 'camera-plan').ok, '镜头计划未知速度会失败');

  const badSizes = clone(valid);
  badSizes.episodes[0].segments[0].cuts[0].cameraPlan.startSize = 'cowboy';
  badSizes.episodes[0].segments[0].cuts[0].cameraPlan.endSize = 'macro';
  ok(!gate(badSizes, 'camera-plan').ok, '镜头计划首尾景别越过现有枚举会失败');
}
{
  const gates = gateReport(FIXTURE, {});
  ok(gates.every((g) => g.ok), '不带上游也通过（对账门跳过）');
  ok(gates.find((g) => g.id === 'coverage').detail.includes('跳过'), '跳过要明说，不静默');
}

/* ---------------- 质量门：逐门击穿 ---------------- */

// coverage — 没人认领 / 重复认领 / 区间不合法 / 整场没分镜 / 顺序倒退
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[3].beats = [5, 5]; // 第 4 拍失去认领
  const g = gate(doc, 'coverage');
  ok(!g.ok, '有节拍没人认领被拦');
  ok(g.detail.includes('没人认领'), '点名到拍');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[3].beats = [3, 5]; // 第 3 拍被两切认领
  ok(gate(doc, 'coverage').detail.includes('重复认领'), '重复认领点得出切号');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].beats = [1, 99];
  ok(!gate(doc, 'coverage').ok, '节拍区间越界被拦');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments = doc.episodes[0].segments.filter((s) => s.sceneIndex !== 1);
  ok(gate(doc, 'coverage').detail.includes('整场没有分镜'), '整场空白被拦');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[1].sceneIndex = 2; // E01-03 变成场次倒退
  ok(!gate(doc, 'coverage').ok, '场次顺序穿插被拦');
}
// segment-cap
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].seconds = 15; // 段总秒数 27
  const g = gate(doc, 'segment-cap');
  ok(!g.ok, '段超 15 秒被拦');
  ok(g.detail.includes('E01-01'), '点名到段');
}
// cut-length
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].seconds = 1;
  ok(!gate(doc, 'cut-length').ok, '分镜短于 2 秒被拦');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].seconds = 6;
  const g = gate(doc, 'cut-length');
  ok(!g.ok, '分镜超 5 秒被拦——3 秒节奏是硬门');
  ok(g.detail.includes('E01-01#1'), '点名到切');
}
{
  const doc = clone(FIXTURE);
  doc.params = { maxCutSeconds: 3 };
  ok(!gate(doc, 'cut-length').ok, '上限收紧到 3 秒后原样例不再达标');
}
// dialogue-fit
{
  const doc = clone(FIXTURE);
  const seg = doc.episodes[0].segments.find((s) => s.id === 'E01-05');
  seg.cuts[0].seconds = 4; // 台词 4.4 秒
  const g = gate(doc, 'dialogue-fit');
  ok(!g.ok, '台词装不进分镜被拦');
  ok(g.detail.includes('E01-05#1'), '点名到切');
}
// ep-duration
{
  const doc = clone(FIXTURE);
  for (const s of doc.episodes[0].segments) for (const c of s.cuts) c.seconds = Math.min(5, c.seconds + 2);
  ok(gate(doc, 'ep-duration').detail.includes('超'), '写超总时长被拦');
}
{
  const doc = clone(FIXTURE);
  for (const s of doc.episodes[0].segments) for (const c of s.cuts) c.seconds = Math.max(2, c.seconds - 2);
  ok(gate(doc, 'ep-duration').detail.includes('欠'), '写欠总时长被拦');
}
// crowd
{
  const doc = clone(FIXTURE);
  const cut = doc.episodes[0].segments.find((s) => s.id === 'E01-09').cuts[2];
  cut.characters = ['C01', 'C02', 'C03', 'C04'];
  ok(!gate(doc, 'crowd').ok, '四人同框无拆解说明被拦');
  cut.note = '全景交代后立刻切正反打';
  ok(gate(doc, 'crowd').ok, '带拆解说明就放行');
}
// segment-id
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[3].id = 'E01-99';
  const g = gate(doc, 'segment-id');
  ok(!g.ok, '断号被拦');
  ok(g.detail.includes('E01-04'), '报出应有的段号');
}
// size-phrase
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].frame = 'a foggy pier at dawn, cinematic';
  ok(!gate(doc, 'size-phrase').ok, '分镜图提示词缺景别短语被拦');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].size = '大远景';
  ok(!gate(doc, 'size-phrase').ok, '景别不在枚举里被拦');
}
// camera-phrase
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].camera = '推';
  ok(!gate(doc, 'camera-phrase').ok, '运镜不在 H3 词表里被拦');
}
{
  const doc = clone(FIXTURE);
  const seg = doc.episodes[0].segments[0];
  seg.h3Prompt = seg.h3Prompt.replace('a tracking shot follows her', 'the camera follows her');
  const g = gate(doc, 'camera-phrase');
  ok(!g.ok, '运镜词没写进自己的 [Shot k] 段落被拦');
  ok(g.detail.includes('E01-01#1'), '点名到切');
}
// h3-structure — 对齐指令由分镜结构推导，逐字对账
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].seconds = 4; // 时长改了、提示词没跟着改
  ok(gate(doc, 'h3-structure').detail.includes('对不上'), '分镜秒数一改，旧对齐指令立刻对不上');
}
{
  const doc = clone(FIXTURE);
  const seg = doc.episodes[0].segments[0];
  seg.h3Prompt = seg.h3Prompt.replace('[Shot 2] At 00:03.000,', '[Shot 2] At 00:03.500,');
  const g = gate(doc, 'h3-structure');
  ok(!g.ok, '切点时刻和分镜秒数累计不一致被拦');
  ok(g.detail.includes('切点时刻'), '报出哪一处时刻错了');
}
{
  const doc = clone(FIXTURE);
  const seg = doc.episodes[0].segments[0];
  seg.h3Prompt = seg.h3Prompt.replace('overall_soundscape:', 'ambient_sound:');
  ok(gate(doc, 'h3-structure').detail.includes('核心字段'), '三字段缺失被拦');
}
// h3-dialogue
{
  const doc = clone(FIXTURE);
  const seg = doc.episodes[0].segments[0];
  seg.h3Prompt = seg.h3Prompt.replace('上船喽——过河的抓紧，雾要变天。', 'the ferryman calls out.');
  const g = gate(doc, 'h3-dialogue');
  ok(!g.ok, '台词没进 <d> 块被拦');
  ok(gate(doc, 'h3-dialogue', {}).detail.includes('跳过'), '没给剧本时本门跳过并明说');
}
// h3-lang — 语言与设定双向对账（默认英文 = 官方口径）
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].h3Prompt += ' 浓雾弥漫。';
  ok(!gate(doc, 'h3-lang').ok, '英文提示词在 <d> 台词之外混中文被拦');
}
{
  const doc = clone(FIXTURE);
  doc.promptLang = 'zh';
  ok(!gate(doc, 'h3-lang').ok, '设定中文、正文却是英文被拦——语言开关双向都管');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].h3Prompt = doc.episodes[0].segments[0].h3Prompt.replace('the old ferryman squatting', '老周 squatting');
  ok(!gate(doc, 'prompt-no-names').ok, '英文模式下 H3 提示词里的人名被拦');
}
{
  const doc = clone(FIXTURE);
  doc.promptLang = 'zh';
  doc.episodes[0].segments[0].h3Prompt += ' 老周站在船头。';
  ok(gate(doc, 'prompt-no-names').ok, '中文模式 H3 提示词人名放行——身份靠分镜图锚定');
}
eq(h3Remainder('a <d>[Chinese] 你好</d> b "营业中" c'), 'a   b   c', 'h3Remainder 剔除 <d> 块与画面文字');
// prompt-english
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].frame = 'extreme wide shot 渡口的浓雾清晨';
  ok(!gate(doc, 'prompt-english').ok, '分镜图提示词混中文被拦');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].frame = '  ';
  ok(!gate(doc, 'prompt-english').ok, '空分镜图提示词被拦');
}
// prompt-no-names
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].frame += ' 沈知微 standing on the pier';
  ok(!gate(doc, 'prompt-no-names').ok, '分镜图提示词出现角色名被拦');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[1].frame += ' 老伯 squatting'; // cast 里的别名
  ok(!gate(doc, 'prompt-no-names').ok, '角色别名也拦');
}
// refs
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].characters = ['C05'];
  ok(!gate(doc, 'refs').ok, '不在该场的人物被拦');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].props = ['P02'];
  ok(!gate(doc, 'refs').ok, '不在该场的道具被拦');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].sceneIndex = 9;
  ok(!gate(doc, 'refs').ok, '不存在的场次被拦');
}

// style-phrase — 同剧分镜图画风不许漂
{
  eq(DEFAULT_STYLE, 'realistic', '默认半写实');
  ok(STYLE_PRESETS.realistic.phrase && STYLE_PRESETS.ghibli.phrase, '预设带风格短语');
  const doc = clone(FIXTURE);
  doc.style = '油画';
  ok(!gate(doc, 'style-phrase').ok, '不在预设里的风格被拦');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].frame = doc.episodes[0].segments[0].cuts[0].frame.replace('cinematic film still', 'cinematic image');
  const g = gate(doc, 'style-phrase');
  ok(!g.ok, '分镜图提示词缺风格短语被拦');
  ok(g.detail.includes('E01-01#1'), '点名到切');
}
{
  const doc = clone(FIXTURE);
  doc.style = 'ghibli';
  ok(!gate(doc, 'style-phrase').ok, '换成吉卜力后写实短语不再达标——换风格是整批换');
}

/* ---------------- 导演计划 + 跨镜连续性（continuityVersion 1） ---------------- */

function withContinuityV1(input = FIXTURE) {
  const doc = clone(input);
  doc.continuityVersion = 1;
  doc.assetDecisions = [];
  const decisionByAsset = new Map();
  const expandedDoc = expandScript(SCRIPT);

  for (const ep of doc.episodes) {
    const sourceEp = expandedDoc.get(ep.ep);
    ep.directorCriticalScenes = [1];
    ep.scenePlans = [{
      id: `E${String(ep.ep).padStart(2, '0')}-SC01-PLAN`,
      sceneIndex: 1,
      audiencePosition: '跟随女子逼近渡口，先与她同站不确定一边',
      informationTiming: '先给皮箱与雾，延后显示船夫的警惕',
      spatialPressure: '岸路到栈桥逐步收窄，船舱入口成为压力点',
      strongestImage: '女子抱箱站在雾中，船夫在低处仰看她',
      reactionLanding: '落在船夫识别皮箱后瞬间收紧的眼神',
      soundStrategy: '风铃与水声先行，关键识别时短暂抽空环境声',
    }];

    for (const scene of sourceEp.scenes) {
      const assets = [...scene.characters, ...scene.props];
      for (const asset of assets) {
        if (decisionByAsset.has(asset)) continue;
        const id = `AS-${asset}-DEFAULT`;
        decisionByAsset.set(asset, id);
        doc.assetDecisions.push({ id, asset, decision: 'reuse', state: 'default' });
      }
    }

    const lastBoundaryByScene = new Map();
    for (const seg of ep.segments) {
      const scene = sourceEp.scenes[seg.sceneIndex - 1];
      for (const cut of seg.cuts) {
        const characters = Object.fromEntries(scene.characters.map((id) => [id, {
          position: `${scene.sceneId}内站位`, facing: '沿工作轴线侧向对手', gaze: '对手或当前行动点',
          leftHand: '自然下垂', rightHand: '自然下垂', lookRef: decisionByAsset.get(id),
        }]));
        const props = Object.fromEntries(scene.props.map((id) => [id, {
          holder: 'environment', position: `${scene.sceneId}内固定位置`, stateRef: decisionByAsset.get(id),
        }]));
        const boundary = {
          spatialAnchor: scene.sceneId,
          workingSide: 'A',
          screenDirection: 'left-to-right',
          characters,
          props,
        };
        cut.startBoundary = clone(lastBoundaryByScene.get(seg.sceneIndex) ?? boundary);
        cut.endBoundary = clone(boundary);
        cut.purpose = '使当前节拍的信息或反应清晰落地';
        lastBoundaryByScene.set(seg.sceneIndex, cut.endBoundary);
      }
    }
  }
  return doc;
}

{
  const doc = withContinuityV1();
  ok(gateReport(doc, CTX).every((g) => g.ok), 'continuityVersion 1 的完整边界与导演计划通过');
  eq(gateReport(doc, CTX).length, 19, '新增导演计划、连续性与镜头计划门');
}
{
  const doc = withContinuityV1();
  delete doc.episodes[0].segments[0].cuts[0].startBoundary;
  ok(!gate(doc, 'continuity').ok, '启用 v1 后缺开始边界被拦');
}
{
  const doc = withContinuityV1();
  doc.episodes[0].segments[0].cuts[1].startBoundary.characters.C01.gaze = '看向画外';
  const g = gate(doc, 'continuity');
  ok(!g.ok, '相邻镜头首尾边界不一致被拦');
  ok(g.detail.includes('E01-01#1') && g.detail.includes('E01-01#2'), '连续性冲突点名前后切');
  doc.episodes[0].segments[0].cuts[1].continuityOverride = '有意图的跳切：省略角色转头过程';
  ok(gate(doc, 'continuity').ok, '显式写连续性跳切理由后放行');
}
{
  const doc = withContinuityV1();
  doc.assetDecisions[0].decision = 'unresolved';
  ok(!gate(doc, 'continuity').ok, '边界引用 unresolved 资产决策被拦');
}
{
  const doc = withContinuityV1();
  doc.episodes[0].segments[0].cuts[0].startBoundary.characters.C01.lookRef = 'AS-MISSING';
  ok(!gate(doc, 'continuity').ok, '不存在的资产状态引用被拦');
}
{
  const doc = withContinuityV1();
  doc.episodes[0].scenePlans[0].soundStrategy = '';
  ok(!gate(doc, 'director-plan').ok, '关键场次导演计划缺声音策略被拦');
}

/* ---------------- exportPack（H3 投产包） ---------------- */

{
  const pack = exportPack(FIXTURE, SCRIPT, { imageExists: () => false });
  eq(pack.files.length, 11, '十段 prompt.md + 一份 manifest');
  ok(pack.files.some((f) => f.path === 'E01-01/prompt.md'), '每段一个文件夹里的 prompt.md');
  const p01 = pack.files.find((f) => f.path === 'E01-01/prompt.md');
  ok(p01.content.startsWith('# E01-01 · H3 提示词'), 'prompt.md 带标题');
  ok(p01.content.includes('Picture 1 = f1.png（**首帧**，钉 0.00 秒）'), '明确指定哪个文件是首帧');
  ok(p01.content.includes('Picture 4 = f4.png（钉 10.00 秒）'), '每张图的切点秒数写明');
  ok(p01.content.includes('---\n\nHow the reference pictures align'), '分隔线以下是 h3Prompt 原样（官方英文口径）');
  const m = pack.manifest.find((x) => x.segment === 'E01-01');
  eq(m.pictures.join(','), 'E01-01/f1.png,E01-01/f2.png,E01-01/f3.png,E01-01/f4.png', 'Picture 序 = 文件夹里的 f1..fn');
  eq(m.cutStarts.join(','), '0,3,6,10', 'manifest 带切点时刻表');
  eq(m.missing.length, 4, '缺图逐张标注');
  ok(pack.missingTotal > 0, '缺图总数上报');
}
{
  const pack = exportPack(withCameraImpact(), SCRIPT, { imageExists: () => false });
  const p01 = pack.files.find((f) => f.path === 'E01-01/prompt.md');
  ok(p01.content.includes('镜头动机'), '投产 prompt 包保留镜头计划');
  ok(p01.content.includes('打击呈现'), '投产 prompt 包保留打击呈现');
  ok(pack.manifest[0].cameraImpact?.[0]?.cameraPlan?.purpose === '逐步暴露人物压抑情绪', 'manifest 结构化保留镜头计划');
  ok(pack.manifest[0].cameraImpact?.[0]?.impactPresentation?.actionId === 'E01-S01-B01-A01', 'manifest 结构化保留打击呈现');
}
{
  const pack = exportPack(FIXTURE, SCRIPT, { imageExists: () => true, dir: 'out' });
  eq(pack.missingTotal, 0, '图齐了就没有缺图标注');
  ok(pack.files.some((f) => f.path === 'out/manifest.json'), '--out 改导出目录');
  ok(pack.files.some((f) => f.path === 'out/E01-01/prompt.md'), '段文件夹跟着 --out 走');
}

/* ---------------- validateStoryboard 结构检查 ---------------- */

eq(validateStoryboard(FIXTURE, CTX).length, 0, '样例零违规');
ok(validateStoryboard(null).length > 0, 'null 不崩');
ok(validateStoryboard({}).some((p) => p.includes('source')), '缺 source 报出来');
ok(validateStoryboard({ source: 'x', episodes: [] }).some((p) => p.includes('episodes')), '空 episodes 报出来');
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0] = { id: 'E01-01' };
  const problems = validateStoryboard(doc, CTX);
  ok(problems.some((p) => p.includes('sceneIndex')), '缺 sceneIndex 报出来');
  ok(problems.some((p) => p.includes('h3Prompt')), '缺 H3 提示词报出来');
  ok(problems.some((p) => p.includes('没有分镜')), '缺 cuts 报出来');
}
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0] = { beats: [1, 1] };
  const problems = validateStoryboard(doc, CTX);
  ok(problems.some((p) => p.includes('seconds')), '分镜缺秒数报出来');
  ok(problems.some((p) => p.includes('frame')), '分镜缺分镜图提示词报出来');
}
{
  const doc = clone(FIXTURE);
  doc.episodes.push(clone(doc.episodes[0]));
  ok(validateStoryboard(doc, CTX).some((p) => p.includes('重复')), '重复集号报出来');
}

/* ---------------- seed ---------------- */

const seeded = seedFromScript(SCRIPT);
eq(seeded.source, '渡口', 'seed 带剧名');
eq(seeded.episodes.length, 6, 'seed 全六集');
eq(seeded.episodes[0].segments.length, 0, 'segments 留空给模型切');
eq(seeded.episodes[0].seedScenes.length, 2, '工作底稿带两场');
eq(seeded.episodes[0].seedScenes[0].beats.length, 13, '底稿带全部节拍');
ok(seeded.episodes[0].seedScenes[0].beats[0].seconds > 0, '每拍带秒数');
eq(seeded.continuityVersion, 1, 'seed 默认启用连续性 v1');
ok(Array.isArray(seeded.assetDecisions), 'seed 带资产决策表');
ok(Array.isArray(seeded.episodes[0].directorCriticalScenes) && Array.isArray(seeded.episodes[0].scenePlans), 'seed 带导演计划工作区');
eq(seedFromScript(SCRIPT, [2, 3]).episodes.map((e) => e.ep).join(','), '2,3', '--eps 区间过滤');
eq(seedFromScript({}).episodes.length, 0, '空剧本不崩');

/* ---------------- slug / 枚举 ---------------- */

eq(slug('渡口'), '渡口', '中文原样');
eq(slug('  '), 'storyboard', '空名兜底');
ok(Object.values(SHOT_SIZES).every((s) => s.zh && s.phrase), '景别枚举带中文名与英文短语');
ok(Object.keys(CAMERA_MOVES).length >= 18, '运镜词表覆盖 H3 全部动作类型');
ok(CAMERA_MOVES['Static Shot'] === '固定' && CAMERA_MOVES['Push In'] === '推', '运镜词表中英对照');

/* ---------------- render markdown ---------------- */

const md = renderMarkdown(FIXTURE, CTX);
ok(md.includes('# 渡口 · 分镜（第 1 集）'), 'md 标题');
ok(md.includes('### E01-01 · 渡口栈桥（浓雾清晨）'), 'md 段头带场景名与光照');
ok(md.includes('H3 视频提示词'), 'md 带逐段 H3 提示词');
ok(md.includes('How the reference pictures align'), '多分镜段的对齐指令完整可复制');
ok(md.includes('[Shot 2] At 00:03.000,'), '切点时刻原样进 md');
ok(md.includes('老周'), 'md 说话人显示名字');
ok(md.includes('生成批次单') && md.includes('配音对齐单'), 'md 带两张工单');
ok(renderMarkdown(FIXTURE, { script: SCRIPT }).includes('C03'), '不给 outline 退回裸 ID');
{
  const cameraImpactMd = renderMarkdown(withCameraImpact(), { ...CTX, actions: ACTIONS });
  ok(cameraImpactMd.includes('镜头动机'), 'md 呈现镜头动机');
  ok(cameraImpactMd.includes('打击呈现'), 'md 呈现打击呈现');
}
{
  const continuityMd = renderMarkdown(withContinuityV1(), CTX);
  ok(continuityMd.includes('关键场次导演计划'), 'md 呈现导演计划');
  ok(continuityMd.includes('连续性边界') && continuityMd.includes('startBoundary'), 'md 呈现分镜首尾边界');
}

/* ---------------- render html ---------------- */

const html = renderHtml(FIXTURE, CTX);
ok(html.includes('<!doctype html>'), 'html 完整文档');
ok(!/src="http|href="http|@import|url\(http/.test(html), '零外部资源');
ok(html.includes('分镜节奏带'), '01 分镜节奏带');
ok(html.includes('分集分镜表'), '02 分集分镜表');
ok(html.includes('生成批次单'), '03 生成批次单');
ok(html.includes('配音对齐单'), '04 配音对齐单');
ok(html.includes('✓ 质量门 19 / 19'), '页眉徽章全绿');
ok(html.includes('class="rseg"'), '节奏带按段分组（粗分隔）');
ok(html.includes('#seg-E01-01'), '节奏带段可跳转');
ok(html.includes('主分镜图 · #1 未生成'), '主分镜图缺图时显示占位不装有');
ok(html.includes('#2 未生成'), '子分镜图缺图有小占位');
{
  const cameraImpactHtml = renderHtml(withCameraImpact(), { ...CTX, actions: ACTIONS });
  ok(cameraImpactHtml.includes('镜头动机'), 'html 呈现镜头动机');
  ok(cameraImpactHtml.includes('打击呈现'), 'html 呈现打击呈现');
}
{
  const continuityHtml = renderHtml(withContinuityV1(), CTX);
  ok(continuityHtml.includes('关键场次导演计划'), 'html 呈现导演计划');
  ok(continuityHtml.includes('连续性边界') && continuityHtml.includes('lookRef'), 'html 可展开查看资产状态引用');
}
// 主分镜图区：无图时每切各占一整行提示词卡 + 复制按钮（PR 核心目标）
{
  const nCuts = FIXTURE.episodes.reduce((n, e) => n + e.segments.reduce((m, s) => m + s.cuts.length, 0), 0);
  ok((html.match(/class="frame ph fcell"/g) ?? []).length === nCuts, '无图时每切都是整宽提示词卡');
  const c0 = FIXTURE.episodes[0].segments[0].cuts;
  ok(html.includes(`data-copy="${c0[0].frame}"`), '主分镜格复制按钮带该切 frame 原文');
  ok(html.includes(`data-copy="${c0[1].frame}"`), '子分镜格复制按钮同样带 frame 原文');
}
ok(html.includes('class="shots clip"'), '段卡区默认截断');
ok(html.includes('展开全部段'), '每集自带展开按钮');
ok(html.includes('H3 提示词'), '段卡带 H3 提示词面板');
ok(html.includes('class="duo"'), '分镜列表与提示词面板五五分栏');
ok(html.includes('static shot'), '英文提示词正文进面板');
ok(html.includes('integrated_multimodal_description'), '官方骨架字段进面板');
ok(html.includes('[Shot 2] At'), '逐镜换行的结构化正文进面板');
ok(html.includes('分镜图提示词'), '每个分镜带分镜图提示词复制按钮');
ok(html.includes('id="lightbox"'), '点图放大');
ok(html.includes('渡口-storyboard.json'), '导出文件名');
ok(html.includes('批次 01'), '批次卡编号');
ok(html.includes('@media print'), '打印样式');
ok(html.includes('老周'), 'html 里 ID 换成名字');
{
  const withImg = renderHtml(FIXTURE, { ...CTX, imageExists: () => true });
  ok(withImg.includes('"E01-01/f1.png"'), '主分镜图从段文件夹读');
  ok(withImg.includes('"E01-01/f2.png"'), '子分镜图同样从段文件夹读');
  ok(!withImg.includes('未生成'), '有图时不再显示占位');
  ok(!withImg.includes('class="frame ph fcell"'), '图出全时不再走整宽提示词卡');
  ok(withImg.includes('class="subs"'), '图出全时保留子分镜条');
  ok(withImg.includes('class="subf"'), '子分镜条用小缩略图');
}
// 病灶横幅
{
  const doc = clone(FIXTURE);
  doc.episodes[0].segments[0].cuts[0].seconds = 6;
  const h = renderHtml(doc, CTX);
  ok(h.includes('class="galert"'), '有门未过时页顶挂病灶横幅');
  ok(h.includes('gatepill fail'), '徽章翻红');
}
// XSS：模型数据全部过 esc
{
  const doc = clone(FIXTURE);
  doc.source = '<script>alert(1)</script>';
  doc.episodes[0].segments[0].note = '<img src=x onerror=alert(1)>';
  const h = renderHtml(doc, { script: SCRIPT });
  ok(!h.includes('<script>alert(1)</script>'), '标题被转义');
  ok(!h.includes('<img src=x'), 'note 被转义');
  ok(h.includes('\\u003c'), '内嵌 JSON 的 < 转成 \\u003c，防 </script 截断');
}

/* ---------------- 报告界面语言（--lang，与 promptLang 独立） ---------------- */

{
  const en = renderHtml(FIXTURE, { ...CTX, lang: 'en' });
  ok(en.includes('<html lang="en">'), 'en 报告的 html lang 属性跟着语言走');
  ok(en.includes('Export JSON'), 'en 界面：导出按钮英文');
  ok(en.includes('Quality gates 19 / 19'), 'en 界面：页眉徽章英文');
  ok(en.includes('Cut rhythm strip'), 'en 界面：节奏带节标题英文');
  ok(en.includes('Segment cards'), 'en 界面：分镜表节标题英文');
  ok(en.includes('Generation batches'), 'en 界面：批次节标题英文');
  ok(en.includes('Audio alignment'), 'en 界面：配音对齐节标题英文');
  ok(en.includes('master frame'), 'en 界面：主分镜图占位标签英文');
  ok(!en.includes('导出 JSON'), 'en 界面不残留中文导出按钮');
  ok(!en.includes('生成批次单'), 'en 界面不残留中文批次标题');
  ok(!en.includes('配音对齐单'), 'en 界面不残留中文对齐标题');
  ok(en.includes('How the reference pictures align'), 'en 界面下 H3 提示词数据原样不动');
  ok(en.includes('[Shot 2] At 00:03.000,'), 'en 界面下切点时刻数据原样不动');
}
{
  const enMd = renderMarkdown(FIXTURE, { ...CTX, lang: 'en' });
  ok(enMd.includes('# 渡口 · Storyboard (Episode 1)') && enMd.includes('Audio alignment'), 'en markdown 标题与节标题英文');
}
{
  const zhAgain = renderHtml(FIXTURE, CTX);
  ok(zhAgain.includes('<html lang="zh">') && zhAgain.includes('导出 JSON'), '默认仍是中文界面');
}
{
  const doc = clone(FIXTURE);
  doc.lang = 'en';
  ok(renderHtml(doc, CTX).includes('Export JSON'), 'JSON 顶层 lang 字段可选定界面语言');
  ok(renderHtml(doc, { ...CTX, lang: 'zh' }).includes('导出 JSON'), 'ctx.lang（--lang）优先于 JSON 的 lang 字段');
}
{
  let threw = false;
  try {
    renderHtml(FIXTURE, { ...CTX, lang: 'ja' });
  } catch (e) {
    threw = /zh \/ en/.test(e.message);
  }
  ok(threw, '非法界面语言抛错并点名内置 zh / en');
}

// 质量门面板是报告的一部分：英文界面下门标签也要翻译（阈值由门自己算，原样保留）
{
  const gateEn = renderHtml(FIXTURE, { ...CTX, lang: 'en' });
  ok(gateEn.includes('Every cut 2–5s'), 'EN 报告的质量门标签翻译且阈值原样保留');
  ok(!gateEn.includes('每个分镜 2–5 秒'), 'EN 报告不再出现中文门标签');
}
console.log(`✓ ${passed} 项自测全部通过`);
