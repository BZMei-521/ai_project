#!/usr/bin/env node
// novel-storyboard — deterministic helpers for the novel-storyboard skill (分镜).
// Zero dependencies on purpose: the skill must work in any directory
// without an npm install. Node 18+ (stdlib only).

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */
/*
 * AI 短剧的前提刻在骨子里，三层结构也由此而来：
 *
 *   段（segment）＝ 一次视频生成调用，上限就是模型单段时长（默认 15 秒）
 *   分镜（cut）  ＝ 段内的一次剪切，2–5 秒——短剧观众的注意力节奏
 *   分镜图       ＝ 每个分镜一张关键帧：第 1 个分镜的是主分镜图（钉在
 *                  0.00 秒），其余是子分镜图（各钉在自己的切点时刻）
 *
 * 一段的画面由这串分镜图 + 一条 H3 提示词共同控制：多图对齐指令
 * 把每张图钉在对应秒数上，[Shot k] 的切点时刻和分镜秒数逐一对账。
 * 多切一刀的成本几乎为零，所以不心疼分镜数量，只守节奏。
 */

export const DEFAULT_PARAMS = {
  maxSegmentSeconds: 15, // 视频模型单段生成上限（秒）
  minCutSeconds: 2,      // 单个分镜下限
  maxCutSeconds: 5,      // 单个分镜上限——3 秒左右是短剧的呼吸
  maxOnScreen: 3,        // 单个分镜同框人数上限，超了必须带拆解说明
  tolerance: 0.15,       // 每集总时长对剧本目标的容差
};

export function paramsOf(doc) {
  return { ...DEFAULT_PARAMS, ...(doc?.params ?? {}) };
}

/** 景别枚举：英文短语必须出现在该分镜的分镜图提示词里。 */
export const SHOT_SIZES = {
  'extreme-wide': { zh: '大远景', phrase: 'extreme wide shot' },
  wide: { zh: '全景', phrase: 'wide shot' },
  medium: { zh: '中景', phrase: 'medium shot' },
  close: { zh: '特写', phrase: 'close-up' },
  'extreme-close': { zh: '大特写', phrase: 'extreme close-up' },
};

/** 运镜枚举：直接用 H3 官方词表，原样写进该分镜的 [Shot k] 段落。 */
export const CAMERA_MOVES = {
  'Static Shot': '固定',
  'Push In': '推',
  'Pull Out': '拉',
  'Zoom In': '变焦推',
  'Zoom Out': '变焦拉',
  'Pan Left': '左摇',
  'Pan Right': '右摇',
  'Truck Left': '左移',
  'Truck Right': '右移',
  'Tilt Up': '仰摇',
  'Tilt Down': '俯摇',
  'Pedestal Up': '升',
  'Pedestal Down': '降',
  'Arc Shot': '环绕',
  'Tracking Shot': '跟拍',
  'Shake Slightly': '轻微晃动',
  'Shake Strongly': '强烈晃动',
  'POV': '主观视角',
  'Roll Clockwise': '顺旋',
  'Roll Counterclockwise': '逆旋',
};

const CAMERA_PLAN_SPEEDS = new Set(['very-slow', 'slow', 'moderate', 'fast']);
const CAMERA_PLAN_AMPLITUDES = new Set(['micro', 'short', 'medium', 'large']);
const CAMERA_PLAN_STABILIZATION = new Set(['locked', 'stable', 'gimbal', 'handheld']);

/** 分镜图风格预设：与 novel-characters / novel-art 同名对齐（realistic / ghibli）。
 *  短语必须出现在每条分镜图提示词里——同一部剧的分镜图不许画风漂。 */
export const STYLE_PRESETS = {
  realistic: { zh: '半写实电影感', phrase: 'cinematic film still' },
  ghibli: { zh: '吉卜力手绘', phrase: 'hand-painted anime film still' },
};
export const DEFAULT_STYLE = 'realistic';

const CJK = /[㐀-鿿぀-ヿ가-힯]/;
const r1 = (n) => Math.round(n * 10) / 10;
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

/* ------------------------------------------------------------------ */
/* H3 提示词的确定性骨架                                                 */
/* ------------------------------------------------------------------ */
/*
 * 结构由 H3 官方规范（h3-prompt-writing skill）定死，而且对齐指令和
 * 切点时刻都能从分镜结构推导出来——所以逐字设门，一个字符都不许漂。
 */

export const H3_I2VA_LINE =
  'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';
export const H3_FIELDS = ['integrated_multimodal_description:', 'overall_soundscape:', 'non_diegetic_music:'];

/** 骨架 token 按语言取：默认英文（官方规范口径）；'zh' 整条中文（只保留 <d>[Chinese] 和 (S1) 两个模型级 token）。 */
export const H3_TOKENS = {
  zh: {
    i2va: '目标视频在 0.00 秒处完全参照图 1（来自镜头 1）。',
    alignHead: '参考图与目标视频的对齐——',
    alignItem: (k, t) => `图 ${k}（来自镜头 ${k}）对齐目标视频 ${t} 秒处`,
    alignTail: '。',
    fields: ['整体视听描述：', '整体音景：', '非叙事配乐：'],
    shot: (k) => `[镜头 ${k}]`,
    cutMark: (k, time) => `[镜头 ${k}] 于 ${time}，`,
  },
  en: {
    i2va: H3_I2VA_LINE,
    alignHead: 'How the reference pictures align with the target video — ',
    alignItem: (k, t) => `Picture ${k} (from Shot ${k}) aligns with the ${t}-second mark of the target video`,
    alignTail: '.',
    fields: H3_FIELDS,
    shot: (k) => `[Shot ${k}]`,
    cutMark: (k, time) => `[Shot ${k}] At ${time},`,
  },
};

/** 段内切点时刻表：[0, c1, c1+c2, …]（不含结尾）。 */
export function cutStarts(cuts) {
  const starts = [];
  let t = 0;
  for (const c of cuts ?? []) {
    starts.push(r1(t));
    t += c?.seconds ?? 0;
  }
  return starts;
}

/** [Shot k] 的切点时刻格式：00:03.000（分:秒.毫秒）。 */
export function h3CutTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/**
 * 首行对齐指令：单分镜的段用 I2VA 固定句式；多分镜的段把每张分镜图
 * 钉在自己的切点秒数上。整行由分镜结构推导，validate 逐字对账。
 */
export function h3AlignmentLine(cuts, lang = 'en') {
  const tk = H3_TOKENS[lang] ?? H3_TOKENS.zh;
  if (!cuts || cuts.length <= 1) return tk.i2va;
  const starts = cutStarts(cuts);
  const parts = cuts.map((c, i) => tk.alignItem(i + 1, starts[i].toFixed(2)));
  return `${tk.alignHead}${parts.join(lang === 'en' ? '; ' : '；')}${tk.alignTail}`;
}

/** 台词/画面文字之外的部分——H3 要求它全英文，人名也只许出现在 <d> 里。 */
export function h3Remainder(prompt) {
  return String(prompt ?? '')
    .replace(/<d>[\s\S]*?<\/d>/g, ' ')
    .replace(/"[^"\n]*"/g, ' ');
}

/** 把 h3Prompt 的描述正文按 [镜头 k] / [Shot k] 切成每个分镜自己的段落。 */
export function h3CutSlices(prompt, cutCount, lang = 'en') {
  const tk = H3_TOKENS[lang] ?? H3_TOKENS.zh;
  const h3 = String(prompt ?? '');
  const bodyStart = h3.indexOf(tk.fields[0]);
  const bodyEnd = h3.indexOf(tk.fields[1]);
  if (bodyStart < 0) return [];
  const body = h3.slice(bodyStart, bodyEnd < 0 ? undefined : bodyEnd);
  const slices = [];
  for (let k = 1; k <= cutCount; k++) {
    const a = body.indexOf(tk.shot(k));
    if (a < 0) {
      slices.push(null);
      continue;
    }
    const b = body.indexOf(tk.shot(k + 1));
    slices.push(body.slice(a, b < 0 ? undefined : b));
  }
  return slices;
}

/* ------------------------------------------------------------------ */
/* 剧本节拍展开                                                          */
/* ------------------------------------------------------------------ */
/*
 * 与 novel-script 相同的计秒规则，这里刻意重新实现而不是跨目录
 * import——每个 skill 必须自包含、可以单独拷走。参数从 script.json
 * 的 params 里读，两边天然一致。
 */

const SCRIPT_DEFAULTS = { charsPerSecond: 4.5, actionSeconds: 2.5 };
const lineChars = (line) => String(line ?? '').replace(/\s+/g, '').length;

/** 把 script.json 展开成分镜要认领的节拍清单：ep → scenes → beats。 */
export function expandScript(script) {
  const p = { ...SCRIPT_DEFAULTS, ...(script?.params ?? {}) };
  const eps = new Map();
  for (const ep of script?.episodes ?? []) {
    const scenes = (ep?.scenes ?? []).map((sc, i) => ({
      sceneIndex: i + 1,
      sceneId: sc.sceneId,
      lighting: sc.lighting ?? '',
      characters: sc.characters ?? [],
      props: sc.props ?? [],
      beats: (sc.flow ?? []).map((b, j) => {
        const isLine = typeof b?.line === 'string';
        return {
          n: j + 1,
          kind: isLine ? 'line' : 'action',
          seconds: r1(isLine ? lineChars(b.line) / p.charsPerSecond : p.actionSeconds),
          speaker: isLine ? b.speaker : undefined,
          delivery: isLine ? (b.delivery ?? '') : undefined,
          text: isLine ? b.line : b.action,
        };
      }),
    }));
    eps.set(ep.ep, { ep: ep.ep, targetSeconds: ep.targetSeconds, scenes });
  }
  return eps;
}

const stableActionValue = (value) => {
  if (Array.isArray(value)) return value.map(stableActionValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableActionValue(value[key])]));
  }
  return value;
};
const sameActionValue = (left, right) => JSON.stringify(stableActionValue(left)) === JSON.stringify(stableActionValue(right));

/** 返回分镜认领区间内的动作摘要；actions 是 novel-action-director export 的输出。 */
export function actionSummaryOf(actions, ep, sceneIndex, beatStart, beatEnd) {
  if (!actions || !actions.actions || !Number.isInteger(beatStart) || !Number.isInteger(beatEnd)) return [];
  const found = [];
  for (const [key, summary] of Object.entries(actions.actions)) {
    const match = /^E(\d+)-S(\d+)-B(\d+)$/.exec(key);
    if (!match) continue;
    const actionEp = Number(match[1]);
    const actionScene = Number(match[2]);
    const actionBeat = Number(match[3]);
    if (actionEp === ep && actionScene === sceneIndex && actionBeat >= beatStart && actionBeat <= beatEnd) {
      found.push({ key, ep: actionEp, sceneIndex: actionScene, beat: actionBeat, ...summary });
    }
  }
  return found.sort((left, right) => left.beat - right.beat || String(left.actionId).localeCompare(String(right.actionId)));
}

function actionClaims(board, actions) {
  const claims = [];
  for (const episode of board?.episodes ?? []) {
    for (const segment of episode?.segments ?? []) {
      for (const [cutIndex, cut] of (segment?.cuts ?? []).entries()) {
        const [from, to] = cut?.beats ?? [];
        const expected = actionSummaryOf(actions, episode.ep, segment.sceneIndex, from, to);
        if (expected.length || (cut?.actionRefs ?? []).length) {
          claims.push({ episode, segment, cut, cutIndex, expected });
        }
      }
    }
  }
  return claims;
}

/** 四个可选动作门；未提供 action.json 时明确跳过，且不改变旧 gateReport 的 18 门形状。 */
export function actionGateReport(board, actions) {
  const definitions = [
    ['action-ownership', '关键动作被对应分镜恰好认领一次'],
    ['action-state-projection', '动作首尾状态投影一致'],
    ['action-fact-integrity', '左右手、道具、接触与结果事实不可改写'],
    ['action-camera-boundary', '动作镜头意图不覆盖具体分镜运镜'],
    ['impact-presentation', '有打击证据的动作必须呈现接触、迟滞与失衡信息'],
  ];
  const skipped = '未提供 action.json，跳过（视为通过）';
  if (!actions) return definitions.map(([id, label]) => ({ id, label, ok: true, detail: skipped }));

  const bad = { ownership: [], state: [], facts: [], camera: [], impact: [] };
  const claims = actionClaims(board, actions);
  const expectedCounts = new Map();
  const referenceCounts = new Map();

  for (const { segment, cut, cutIndex, expected } of claims) {
    const cutId = `${segment.id}#${cutIndex + 1}`;
    const expectedIds = expected.map((item) => item.actionId);
    const refs = Array.isArray(cut.actionRefs) ? cut.actionRefs : [];
    for (const id of expectedIds) expectedCounts.set(id, (expectedCounts.get(id) ?? 0) + 1);
    for (const id of refs) referenceCounts.set(id, (referenceCounts.get(id) ?? 0) + 1);

    const missing = expectedIds.filter((id) => !refs.includes(id));
    const extra = refs.filter((id) => !expectedIds.includes(id));
    if (missing.length) bad.ownership.push(`${cutId} 缺动作认领 ${missing.join(', ')}`);
    if (extra.length) bad.ownership.push(`${cutId} 认领了区间外动作 ${extra.join(', ')}`);
    if (!expected.length) continue;

    const projection = cut.actionStateProjection;
    if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
      bad.state.push(`${cutId} 缺 actionStateProjection`);
      bad.facts.push(`${cutId} 缺动作事实投影`);
      continue;
    }
    const first = expected[0];
    const last = expected.at(-1);
    if (!sameActionValue(projection.startState, first.startState) || !sameActionValue(projection.endState, last.endState)) {
      bad.state.push(`${cutId} 首尾状态与动作摘要不一致`);
    }
    const mustShow = expected.flatMap((item) => item.cameraIntent?.mustShow ?? []);
    if (!sameActionValue(projection.startState, first.startState) || !sameActionValue(projection.endState, last.endState) || !sameActionValue(projection.mustShow ?? [], mustShow)) {
      bad.facts.push(`${cutId} 改写了左右手、道具、接触或结果事实`);
    }
    const forbiddenProjection = ['camera', 'cameraMove', 'move', 'lens', 'focalLength', 'shotSize'].filter((field) => projection[field] != null);
    if (forbiddenProjection.length || cut.cameraIntent != null) {
      bad.camera.push(`${cutId} 把动作信息需求写成了具体镜头字段`);
    }

    const impactActions = expected.filter((item) => item.impactEvidence);
    for (const impactAction of impactActions) {
      const presentation = cut.impactPresentation;
      if (!presentation || typeof presentation !== 'object' || Array.isArray(presentation)) {
        bad.impact.push(`${cutId} 的 ${impactAction.actionId} 有 impactEvidence 但缺 impactPresentation`);
        continue;
      }
      if (presentation.actionId !== impactAction.actionId) bad.impact.push(`${cutId} 的 impactPresentation.actionId 未匹配 ${impactAction.actionId}`);
      if (!new Set(['clear', 'occluded-with-alternative']).has(presentation.contactVisibility)) bad.impact.push(`${cutId} 的 contactVisibility 无效`);
      if (!new Set(['none', 'brief']).has(presentation.impactPulse)) bad.impact.push(`${cutId} 的 impactPulse 无效`);
      if (!Number.isInteger(presentation.overlapReplays) || presentation.overlapReplays < 0 || presentation.overlapReplays > 2) bad.impact.push(`${cutId} 的 overlapReplays 必须为 0–2`);
      if (!new Set(['none', 'opportunity', 'post-contact', 'aftermath']).has(presentation.slowMotionPhase)) bad.impact.push(`${cutId} 的 slowMotionPhase 无效`);
      const order = Array.isArray(presentation.informationOrder) ? presentation.informationOrder : [];
      const feedback = ['latency', 'support-change', 'center-of-mass', 'imbalance'];
      if (!order.includes('contact') || !feedback.some((item) => order.includes(item))) bad.impact.push(`${cutId} 的 informationOrder 必须含 contact 和至少一种受力反馈`);
    }
  }

  for (const [id, expectedCount] of expectedCounts) {
    const actual = referenceCounts.get(id) ?? 0;
    if (expectedCount !== 1 || actual !== 1) bad.ownership.push(`${id} 应认领 1 次，实际 ${actual} 次`);
  }
  for (const [key, summary] of Object.entries(actions.actions ?? {})) {
    const forbidden = ['camera', 'cameraMove', 'move', 'lens', 'focalLength', 'shotSize', 'framing'].filter((field) => summary.cameraIntent?.[field] != null);
    if (forbidden.length) bad.camera.push(`${summary.actionId ?? key} 的 cameraIntent 越界包含 ${forbidden.join(', ')}`);
  }

  return [
    { id: definitions[0][0], label: definitions[0][1], ok: bad.ownership.length === 0, detail: bad.ownership.join('；') || '通过' },
    { id: definitions[1][0], label: definitions[1][1], ok: bad.state.length === 0, detail: bad.state.join('；') || '通过' },
    { id: definitions[2][0], label: definitions[2][1], ok: bad.facts.length === 0, detail: bad.facts.join('；') || '通过' },
    { id: definitions[3][0], label: definitions[3][1], ok: bad.camera.length === 0, detail: bad.camera.join('；') || '通过' },
    { id: definitions[4][0], label: definitions[4][1], ok: bad.impact.length === 0, detail: bad.impact.join('；') || '通过' },
  ];
}

export const segSeconds = (segment) => r1((segment?.cuts ?? []).reduce((n, c) => n + (c?.seconds ?? 0), 0));

/* ------------------------------------------------------------------ */
/* stats                                                               */
/* ------------------------------------------------------------------ */

/** 报告与质量门共用的确定性统计。script 是硬前提——分镜离开剧本没有意义。 */
export function computeStats(board, script) {
  const params = paramsOf(board);
  const expanded = expandScript(script);
  const episodes = [];
  const batches = new Map(); // sceneId|lighting → 生成批次
  const dialogue = [];       // 配音对齐单：段 × 分镜 × 说话人 × 台词

  for (const ep of board?.episodes ?? []) {
    const sEp = expanded.get(ep.ep);
    let total = 0;
    let cutCount = 0;
    let withLines = 0;
    for (const seg of ep?.segments ?? []) {
      const scene = sEp?.scenes?.[seg.sceneIndex - 1];
      const secs = segSeconds(seg);
      total += secs;
      let segHasLine = false;
      (seg?.cuts ?? []).forEach((cut, ci) => {
        cutCount++;
        if (!scene) return;
        const [from, to] = cut.beats ?? [];
        for (const b of scene.beats.slice((from ?? 1) - 1, to ?? 0)) {
          if (b.kind !== 'line') continue;
          segHasLine = true;
          dialogue.push({ segment: seg.id, cut: ci + 1, ep: ep.ep, speaker: b.speaker, line: b.text, seconds: b.seconds });
        }
      });
      if (segHasLine) withLines++;
      if (scene) {
        const key = `${scene.sceneId}|${scene.lighting}`;
        if (!batches.has(key)) {
          batches.set(key, { sceneId: scene.sceneId, lighting: scene.lighting, segments: [], characters: new Set(), props: new Set() });
        }
        const batch = batches.get(key);
        batch.segments.push(seg.id);
        for (const cut of seg?.cuts ?? []) {
          for (const c of cut.characters ?? []) batch.characters.add(c);
          for (const pr of cut.props ?? []) batch.props.add(pr);
        }
      }
    }
    episodes.push({
      ep: ep.ep,
      target: sEp?.targetSeconds ?? 0,
      segments: (ep?.segments ?? []).length,
      cuts: cutCount,
      totalSeconds: r1(total),
      avgCutSeconds: cutCount ? r1(total / cutCount) : 0,
      withLines,
    });
  }

  const totals = {
    segments: episodes.reduce((n, e) => n + e.segments, 0),
    cuts: episodes.reduce((n, e) => n + e.cuts, 0),
    seconds: r1(episodes.reduce((n, e) => n + e.totalSeconds, 0)),
    targetSeconds: episodes.reduce((n, e) => n + e.target, 0),
    withLines: episodes.reduce((n, e) => n + e.withLines, 0),
    avgCutSeconds: 0,
  };
  totals.avgCutSeconds = totals.cuts ? r1(totals.seconds / totals.cuts) : 0;

  return {
    params,
    episodes,
    totals,
    dialogue,
    batches: [...batches.values()].map((b) => ({
      sceneId: b.sceneId, lighting: b.lighting, segments: b.segments,
      characters: [...b.characters], props: [...b.props],
    })),
  };
}

/* ------------------------------------------------------------------ */
/* 质量门                                                               */
/* ------------------------------------------------------------------ */

/** correspondenceVersion: 1 的逐切多模态事实绑定检查。 */
export function correspondenceProblems(board, ctx = {}) {
  if (board?.correspondenceVersion == null) return [];
  if (board.correspondenceVersion !== 1) return [`correspondenceVersion 目前只支持 1，实际是 ${board.correspondenceVersion}`];
  const out = [];
  const identities = new Map((ctx.cast?.characters ?? []).map((c) => [c.identityModule?.characterRef, c.identityModule]));
  const actionById = new Map(Object.values(ctx.actions?.actions ?? {}).map((action) => [action.actionId, action]));
  for (const ep of board.episodes ?? []) for (const seg of ep.segments ?? []) {
    for (let index = 0; index < (seg.cuts ?? []).length; index += 1) {
      const cut = seg.cuts[index];
      const where = `${seg.id}#${index + 1}`;
      const c = cut?.correspondence;
      if (!c || typeof c !== 'object' || Array.isArray(c)) { out.push(`${where} 缺 correspondence`); continue; }
      if (c.sourceBeats?.sceneIndex !== seg.sceneIndex || stable(c.sourceBeats?.beats) !== stable(cut.beats)) out.push(`${where} sourceBeats 与分镜认领不一致`);
      const refs = new Set(cut.characters ?? []);
      if (!Array.isArray(c.characters)) out.push(`${where} characters 必须是数组`);
      const bindings = Array.isArray(c.characters) ? c.characters : [];
      const bound = new Set(bindings.map((x) => x.characterRef));
      if (stable([...refs].sort()) !== stable([...bound].sort())) out.push(`${where} 角色绑定集合与 cut.characters 不一致`);
      if (c.emptyCharacterShot !== (refs.size === 0)) out.push(`${where} emptyCharacterShot 与角色数量矛盾`);
      for (const binding of bindings) {
        const identity = identities.get(binding.characterRef);
        if (!identity || identity.status !== 'approved') out.push(`${where} 的 ${binding.characterRef} 没有 approved 身份模块`);
        if (identity && binding.identityVersion !== identity.identityVersion) out.push(`${where} 的 ${binding.characterRef} 身份版本错绑`);
        const start = cut.startBoundary?.characters?.[binding.characterRef];
        const end = cut.endBoundary?.characters?.[binding.characterRef];
        if (binding.lookRef !== start?.lookRef) out.push(`${where} 的 ${binding.characterRef} lookRef 与开始边界不一致`);
        if (binding.startPosition !== start?.position || binding.endPosition !== end?.position) out.push(`${where} 的 ${binding.characterRef} 首尾位置不一致`);
        const cutActionRefs = new Set(cut.actionRefs ?? []);
        const expectedActions = [...cutActionRefs].filter((ref) => (actionById.get(ref)?.participants ?? []).includes(binding.characterRef)).sort();
        if (!Array.isArray(binding.actionRefs)) out.push(`${where} 的 ${binding.characterRef} actionRefs 必须是数组`);
        const boundActions = [...new Set(Array.isArray(binding.actionRefs) ? binding.actionRefs : [])].sort();
        if (stable(expectedActions) !== stable(boundActions)) out.push(`${where} 的 ${binding.characterRef} actionRefs 与参与动作不一致`);
        if (!Array.isArray(binding.poseEvidenceRefs)) out.push(`${where} 的 ${binding.characterRef} poseEvidenceRefs 必须是数组`);
        const supplied = Array.isArray(binding.poseEvidenceRefs) ? binding.poseEvidenceRefs : [];
        const requiredPrevis = boundActions
          .map((ref) => ({ ref, previs: actionById.get(ref)?.previs }))
          .filter(({ previs }) => previs?.required === true);
        if (requiredPrevis.length) {
          const approvedEvidence = new Set(requiredPrevis.flatMap(({ previs }) => [
            ...(previs.evidence?.stillRefs ?? []), ...(previs.evidence?.clipRefs ?? []),
          ]));
          if (supplied.length === 0) out.push(`${where} 的 ${binding.characterRef} 缺必需预演证据`);
          for (const evidenceRef of supplied) if (!approvedEvidence.has(evidenceRef)) out.push(`${where} 的 ${binding.characterRef} 引用未批准预演证据：${evidenceRef}`);
          for (const { ref, previs } of requiredPrevis) {
            const actionEvidence = new Set([...(previs.evidence?.stillRefs ?? []), ...(previs.evidence?.clipRefs ?? [])]);
            if (!supplied.some((evidenceRef) => actionEvidence.has(evidenceRef))) out.push(`${where} 的 ${binding.characterRef} 缺 ${ref} 的必需预演证据`);
          }
        }
      }
      if (!Array.isArray(c.propRefs)) out.push(`${where} propRefs 必须是数组`);
      const correspondenceProps = [...new Set(Array.isArray(c.propRefs) ? c.propRefs : [])].sort();
      const cutProps = [...new Set(cut.props ?? [])].sort();
      if (stable(correspondenceProps) !== stable(cutProps)) out.push(`${where} propRefs 与 cut.props 不一致`);
      if (!String(c.sceneRef ?? '').trim()) out.push(`${where} 缺 sceneRef`);
      else if (c.sceneRef !== cut.startBoundary?.spatialAnchor) out.push(`${where} sceneRef 与开始边界空间锚点不一致`);
      if (!Array.isArray(c.mustShow)) out.push(`${where} mustShow 必须是数组`);
      else if (stable(c.mustShow) !== stable(cut.actionStateProjection?.mustShow ?? [])) out.push(`${where} mustShow 与动作投影不一致`);
    }
  }
  return out;
}

export function gateReport(board, ctx = {}) {
  const gates = [];
  const add = (id, label, ok, detail = '') => gates.push({ id, label, ok, detail });
  const params = paramsOf(board);
  const script = ctx.script ?? null;
  const expanded = script ? expandScript(script) : null;
  const eps = Array.isArray(board?.episodes) ? board.episodes : [];
  const bad = {
    coverage: [], segCap: [], cutLen: [], fit: [], duration: [], crowd: [],
    id: [], size: [], camera: [], english: [], names: [], refs: [],
    h3s: [], h3d: [], h3e: [], style: [], directorPlan: [], continuity: [], cameraPlan: [],
  };
  const styleId = board?.style ?? DEFAULT_STYLE;
  const style = STYLE_PRESETS[styleId];
  if (!style) bad.style.push(`style「${styleId}」不在预设里（${Object.keys(STYLE_PRESETS).join(' / ')}）`);
  // 提示词语言：默认英文——官方规范的口径（台词仍在 <d> 里保留原文）；'zh' 可切整条中文
  const promptLang = board?.promptLang ?? 'en';
  const continuityV1 = board?.continuityVersion === 1;
  const decisionKinds = new Set(['reuse', 'new_variant', 'new_asset', 'unresolved']);
  const decisions = new Map();
  const objectEntries = (value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value)
    : [];
  const requiredBoundaryString = (record, field, where) => {
    if (!String(record?.[field] ?? '').trim()) bad.continuity.push(`${where} 缺 ${field}`);
  };
  const checkDecisionRef = (ref, asset, where) => {
    if (!String(ref ?? '').trim()) {
      bad.continuity.push(`${where} 缺资产状态引用`);
      return;
    }
    const decision = decisions.get(ref);
    if (!decision) {
      bad.continuity.push(`${where} 引用不存在的资产决策「${ref}」`);
      return;
    }
    if (decision.asset !== asset) bad.continuity.push(`${where} 的 ${ref} 属于 ${decision.asset}，不是 ${asset}`);
    if (decision.decision === 'unresolved') bad.continuity.push(`${where} 引用未解决资产决策「${ref}」`);
  };
  const checkBoundary = (boundary, where, scene) => {
    if (!boundary || typeof boundary !== 'object' || Array.isArray(boundary)) {
      bad.continuity.push(`${where} 缺结构化边界`);
      return;
    }
    for (const field of ['spatialAnchor', 'workingSide', 'screenDirection']) requiredBoundaryString(boundary, field, where);
    if (!boundary.characters || typeof boundary.characters !== 'object' || Array.isArray(boundary.characters)) {
      bad.continuity.push(`${where} 缺 characters 状态表`);
    }
    if (!boundary.props || typeof boundary.props !== 'object' || Array.isArray(boundary.props)) {
      bad.continuity.push(`${where} 缺 props 状态表`);
    }
    for (const character of scene?.characters ?? []) {
      if (!Object.hasOwn(boundary.characters ?? {}, character)) bad.continuity.push(`${where} 缺该场角色 ${character} 的站位状态`);
    }
    for (const prop of scene?.props ?? []) {
      if (!Object.hasOwn(boundary.props ?? {}, prop)) bad.continuity.push(`${where} 缺该场道具 ${prop} 的持有与状态`);
    }
    for (const [id, state] of objectEntries(boundary.characters)) {
      for (const field of ['position', 'facing', 'gaze', 'leftHand', 'rightHand']) requiredBoundaryString(state, field, `${where}.${id}`);
      checkDecisionRef(state?.lookRef, id, `${where}.${id}.lookRef`);
    }
    for (const [id, state] of objectEntries(boundary.props)) {
      for (const field of ['holder', 'position']) requiredBoundaryString(state, field, `${where}.${id}`);
      checkDecisionRef(state?.stateRef, id, `${where}.${id}.stateRef`);
    }
  };

  if (continuityV1) {
    if (!Array.isArray(board?.assetDecisions)) {
      bad.continuity.push('根层缺 assetDecisions 数组');
    } else {
      for (const record of board.assetDecisions) {
        const id = String(record?.id ?? '').trim();
        if (!id) {
          bad.continuity.push('有资产决策缺 id');
          continue;
        }
        if (decisions.has(id)) bad.continuity.push(`资产决策 id 重复：${id}`);
        decisions.set(id, record);
        if (!String(record?.asset ?? '').trim()) bad.continuity.push(`${id} 缺 asset`);
        if (!decisionKinds.has(record?.decision)) bad.continuity.push(`${id} 的 decision「${record?.decision}」无效`);
        if (!String(record?.state ?? '').trim()) bad.continuity.push(`${id} 缺 state`);
      }
    }
  }

  // 提示词禁人名：outline 的名字 + cast 的名字与别名
  const banned = [];
  for (const c of ctx.outline?.characters ?? []) if (c?.name) banned.push(c.name);
  for (const c of ctx.cast?.characters ?? []) {
    if (c?.name) banned.push(c.name);
    for (const a of c?.aliases ?? []) banned.push(a);
  }

  for (const ep of eps) {
    const label = `E${String(ep?.ep).padStart(2, '0')}`;
    const sEp = expanded?.get(ep?.ep);
    if (expanded && !sEp) bad.refs.push(`${label} 在剧本里不存在`);

    if (continuityV1) {
      const critical = Array.isArray(ep?.directorCriticalScenes) ? ep.directorCriticalScenes : [];
      const plans = Array.isArray(ep?.scenePlans) ? ep.scenePlans : [];
      const byScene = new Map();
      const ids = new Set();
      for (const plan of plans) {
        const pid = String(plan?.id ?? '').trim() || '?';
        if (ids.has(pid)) bad.directorPlan.push(`${label} 导演计划 id 重复：${pid}`);
        ids.add(pid);
        if (!Number.isInteger(plan?.sceneIndex) || plan.sceneIndex < 1) bad.directorPlan.push(`${pid} 缺合法 sceneIndex`);
        if (byScene.has(plan?.sceneIndex)) bad.directorPlan.push(`${label} 第 ${plan?.sceneIndex} 场有多份已选导演计划`);
        byScene.set(plan?.sceneIndex, plan);
        for (const field of ['audiencePosition', 'informationTiming', 'spatialPressure', 'strongestImage', 'reactionLanding', 'soundStrategy']) {
          if (!String(plan?.[field] ?? '').trim()) bad.directorPlan.push(`${pid} 缺 ${field}`);
        }
        if (sEp && !sEp.scenes[plan?.sceneIndex - 1]) bad.directorPlan.push(`${pid} 指向不存在的场次 ${plan?.sceneIndex}`);
      }
      for (const sceneIndex of critical) {
        if (!byScene.has(sceneIndex)) bad.directorPlan.push(`${label} 关键场次 ${sceneIndex} 缺导演计划`);
      }
    }

    // 段号纪律：格式、集号一致、连号
    (ep?.segments ?? []).forEach((seg, i) => {
      const want = `${label}-${String(i + 1).padStart(2, '0')}`;
      if (seg?.id !== want) bad.id.push(`第 ${i + 1} 段应为 ${want}，实际「${seg?.id}」`);
    });

    let prevSceneIndex = 0;
    const previousCutByScene = new Map();
    for (const seg of ep?.segments ?? []) {
      const sid = seg?.id ?? '?';
      const cuts = seg?.cuts ?? [];
      const total = segSeconds(seg);

      if (!(total > 0) || total > params.maxSegmentSeconds) {
        bad.segCap.push(`${sid} 共 ${total} 秒`);
      }

      const h3 = String(seg?.h3Prompt ?? '');
      // H3 结构：首行对齐指令逐字对账（由分镜结构按 promptLang 推导），三字段按序，切点时刻逐个对
      const tk = H3_TOKENS[promptLang] ?? H3_TOKENS.zh;
      const wantLine = h3AlignmentLine(cuts, promptLang);
      if (!h3.trimStart().startsWith(wantLine)) {
        bad.h3s.push(`${sid} 首行对齐指令和分镜结构对不上（promptLang=${promptLang}）`);
      } else {
        const idx = tk.fields.map((f) => h3.indexOf(f));
        if (idx.some((i) => i < 0) || !(idx[0] < idx[1] && idx[1] < idx[2])) {
          bad.h3s.push(`${sid} 三个核心字段缺失或顺序不对`);
        } else {
          const starts = cutStarts(cuts);
          if (h3.indexOf(tk.shot(1), idx[0]) < 0) bad.h3s.push(`${sid} 描述正文缺 ${tk.shot(1)}`);
          for (let k = 2; k <= cuts.length; k++) {
            const mark = tk.cutMark(k, h3CutTime(starts[k - 1]));
            if (h3.indexOf(mark, idx[0]) < 0) bad.h3s.push(`${sid} 缺「${mark}」——切点时刻必须等于前面分镜秒数的累计`);
          }
        }
      }
      const rest = h3Remainder(h3);
      if (promptLang === 'en') {
        if (CJK.test(rest)) bad.h3e.push(`${sid} 的 h3Prompt 设定英文却在 <d> 台词之外混入了中文`);
        // 英文提示词禁人名（图像/视频模型对英文语境的人名有偏见）；中文提示词人名放行——身份靠分镜图锚定
        for (const name of banned) {
          if (rest.includes(name)) bad.names.push(`${sid} 的 h3Prompt 在台词之外出现角色名「${name}」`);
        }
      } else if (!CJK.test(rest)) {
        bad.h3e.push(`${sid} 设定中文提示词（promptLang=${promptLang}），正文却写成了英文`);
      }

      const slices = h3CutSlices(h3, cuts.length, promptLang);
      const scene = sEp ? sEp.scenes[seg?.sceneIndex - 1] : null;
      if (sEp && !scene) bad.refs.push(`${sid} 的 sceneIndex ${seg?.sceneIndex} 在剧本第 ${ep.ep} 集里不存在`);
      if (scene) {
        if (seg.sceneIndex < prevSceneIndex) bad.coverage.push(`${sid} 场次顺序倒退`);
        prevSceneIndex = Math.max(prevSceneIndex, seg.sceneIndex);
      }

      cuts.forEach((cut, ci) => {
        const cid = `${sid}#${ci + 1}`;

        if (cut?.cameraPlan != null) {
          const plan = cut.cameraPlan;
          if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
            bad.cameraPlan.push(`${cid} 的 cameraPlan 必须是对象`);
          } else {
            for (const field of ['purpose', 'path', 'speed', 'amplitude', 'subjectRelation', 'stabilization', 'foregroundOcclusion', 'startSize', 'endSize']) {
              if (!String(plan[field] ?? '').trim()) bad.cameraPlan.push(`${cid} 的 cameraPlan 缺 ${field}`);
            }
            if (!CAMERA_PLAN_SPEEDS.has(plan.speed)) bad.cameraPlan.push(`${cid} 的 cameraPlan.speed「${plan.speed}」无效`);
            if (!CAMERA_PLAN_AMPLITUDES.has(plan.amplitude)) bad.cameraPlan.push(`${cid} 的 cameraPlan.amplitude「${plan.amplitude}」无效`);
            if (!CAMERA_PLAN_STABILIZATION.has(plan.stabilization)) bad.cameraPlan.push(`${cid} 的 cameraPlan.stabilization「${plan.stabilization}」无效`);
            if (!SHOT_SIZES[plan.startSize]) bad.cameraPlan.push(`${cid} 的 cameraPlan.startSize「${plan.startSize}」不在景别枚举里`);
            if (!SHOT_SIZES[plan.endSize]) bad.cameraPlan.push(`${cid} 的 cameraPlan.endSize「${plan.endSize}」不在景别枚举里`);
          }
        }

        if (continuityV1) {
          if (!String(cut?.purpose ?? '').trim()) bad.continuity.push(`${cid} 缺 purpose`);
          checkBoundary(cut?.startBoundary, `${cid}.startBoundary`, scene);
          checkBoundary(cut?.endBoundary, `${cid}.endBoundary`, scene);
          const previous = previousCutByScene.get(seg?.sceneIndex);
          if (previous && stable(previous.endBoundary) !== stable(cut?.startBoundary) && !String(cut?.continuityOverride ?? '').trim()) {
            bad.continuity.push(`${previous.id} 的结束边界与 ${cid} 的开始边界不一致；若为有意跳切请写 continuityOverride`);
          }
          previousCutByScene.set(seg?.sceneIndex, { id: cid, endBoundary: cut?.endBoundary });
        }

        if (!(cut?.seconds >= params.minCutSeconds) || cut.seconds > params.maxCutSeconds) {
          bad.cutLen.push(`${cid} ${cut?.seconds ?? '?'} 秒`);
        }
        if ((cut?.characters ?? []).length > params.maxOnScreen && !String(cut?.note ?? seg?.note ?? '').trim()) {
          bad.crowd.push(`${cid} 同框 ${cut.characters.length} 人且没有拆解说明`);
        }
        if (!SHOT_SIZES[cut?.size]) {
          bad.size.push(`${cid} 景别「${cut?.size}」不在枚举里`);
        } else if (!String(cut?.frame ?? '').toLowerCase().includes(SHOT_SIZES[cut.size].phrase)) {
          bad.size.push(`${cid} 分镜图提示词缺景别短语「${SHOT_SIZES[cut.size].phrase}」`);
        }
        if (!CAMERA_MOVES[cut?.camera]) {
          bad.camera.push(`${cid} 运镜「${cut?.camera}」不在 H3 词表里`);
        } else {
          const slice = slices[ci];
          const term = promptLang === 'en' ? String(cut.camera).toLowerCase() : CAMERA_MOVES[cut.camera];
          if (slice == null) {
            bad.camera.push(`${cid} 在 h3Prompt 里找不到对应的 [Shot ${ci + 1}] 段落`);
          } else if (!(promptLang === 'en' ? slice.toLowerCase() : slice).includes(term)) {
            bad.camera.push(`${cid} 的 [Shot ${ci + 1}] 段落缺运镜词「${term}」`);
          }
        }
        const frame = String(cut?.frame ?? '');
        if (!frame.trim()) bad.english.push(`${cid} 的分镜图提示词为空`);
        if (CJK.test(frame)) bad.english.push(`${cid} 的分镜图提示词混入了非英文`);
        if (style && !frame.toLowerCase().includes(style.phrase)) {
          bad.style.push(`${cid} 的分镜图提示词缺风格短语「${style.phrase}」`);
        }
        for (const name of banned) {
          if (frame.includes(name)) bad.names.push(`${cid} 的分镜图提示词出现角色名「${name}」`);
        }

        // 引用对账 + 台词装得下 + 台词逐字进 <d>
        if (scene) {
          const cast = new Set(scene.characters);
          for (const c of cut?.characters ?? []) {
            if (!cast.has(c)) bad.refs.push(`${cid} 的 ${c} 不在剧本该场人物里`);
          }
          const propSet = new Set(scene.props);
          for (const pr of cut?.props ?? []) {
            if (!propSet.has(pr)) bad.refs.push(`${cid} 的 ${pr} 不在剧本该场道具里`);
          }
          const [from, to] = cut?.beats ?? [];
          if (Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to <= scene.beats.length && from <= to) {
            let dlg = 0;
            for (const b of scene.beats.slice(from - 1, to)) {
              if (b.kind !== 'line') continue;
              dlg += b.seconds;
              const re = new RegExp(`<d>\\[[^\\]]+\\]\\s*${b.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</d>`);
              if (!re.test(h3)) bad.h3d.push(`${sid} 的 h3Prompt 缺台词「${b.text.slice(0, 12)}…」的 <d> 块`);
            }
            if (dlg > cut.seconds) bad.fit.push(`${cid} 台词 ${r1(dlg)} 秒装不进 ${cut.seconds} 秒`);
          }
        }
      });
    }

    // 节拍全覆盖：每场的节拍被恰好一次、按顺序、连续认领（分镜级）
    if (sEp) {
      for (const scene of sEp.scenes) {
        const claims = [];
        for (const seg of ep?.segments ?? []) {
          if (seg?.sceneIndex !== scene.sceneIndex) continue;
          (seg?.cuts ?? []).forEach((cut, ci) => {
            const [from, to] = cut?.beats ?? [];
            if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > scene.beats.length || from > to) {
              bad.coverage.push(`${seg.id}#${ci + 1} 的节拍区间 [${from}, ${to}] 不合法（该场共 ${scene.beats.length} 拍）`);
              return;
            }
            claims.push([from, to, `${seg.id}#${ci + 1}`]);
          });
        }
        let cursor = 1;
        for (const [from, to, id] of claims) {
          if (from !== cursor) {
            bad.coverage.push(`${label} 第 ${scene.sceneIndex} 场第 ${cursor} 拍${from > cursor ? '没人认领' : `被 ${id} 重复认领`}`);
          }
          cursor = Math.max(cursor, to + 1);
        }
        if (claims.length && cursor <= scene.beats.length) {
          bad.coverage.push(`${label} 第 ${scene.sceneIndex} 场第 ${cursor}–${scene.beats.length} 拍没人认领`);
        }
        if (!claims.length && scene.beats.length) {
          bad.coverage.push(`${label} 第 ${scene.sceneIndex} 场整场没有分镜`);
        }
      }

      // 每集总时长对齐剧本目标
      if (sEp.targetSeconds > 0) {
        const total = (ep?.segments ?? []).reduce((n, s) => n + segSeconds(s), 0);
        const lo = sEp.targetSeconds * (1 - params.tolerance);
        const hi = sEp.targetSeconds * (1 + params.tolerance);
        if (total < lo) bad.duration.push(`${label} 欠 ${r1(lo - total)} 秒（${r1(total)}s / 目标 ${sEp.targetSeconds}s）`);
        if (total > hi) bad.duration.push(`${label} 超 ${r1(total - hi)} 秒（${r1(total)}s / 目标 ${sEp.targetSeconds}s）`);
      }
    }
  }

  const SKIP_SCRIPT = '未提供 script.json，本门跳过（视为通过）';
  const SKIP_NAMES = '未提供 outline/cast，本门跳过（视为通过）';
  const SKIP_CONTINUITY = '未启用 continuityVersion: 1，向后兼容模式（视为通过）';

  add('coverage', '剧本节拍被恰好一次、按顺序、连续认领（分镜级）', bad.coverage.length === 0, script ? bad.coverage.join('；') : SKIP_SCRIPT);
  add('segment-cap', `每段 0 < 总秒数 ≤ ${params.maxSegmentSeconds}（一次生成的上限）`, eps.length > 0 && bad.segCap.length === 0, bad.segCap.join('；'));
  add('cut-length', `每个分镜 ${params.minCutSeconds}–${params.maxCutSeconds} 秒——短剧的注意力节奏`, eps.length > 0 && bad.cutLen.length === 0, bad.cutLen.join('；'));
  add('dialogue-fit', '认领节拍的台词装得进分镜秒数', bad.fit.length === 0, script ? bad.fit.join('；') : SKIP_SCRIPT);
  add('ep-duration', `每集总时长在剧本目标 ±${Math.round(params.tolerance * 100)}% 内`, bad.duration.length === 0, script ? bad.duration.join('；') : SKIP_SCRIPT);
  add('crowd', `单个分镜同框 ≤ ${params.maxOnScreen} 人，超了必须带拆解说明`, bad.crowd.length === 0, bad.crowd.join('；'));
  add('segment-id', '段号 E01-01 格式、按顺序连号', bad.id.length === 0, bad.id.join('；'));
  add('size-phrase', '景别短语写进分镜图提示词', bad.size.length === 0, bad.size.join('；'));
  add('camera-phrase', '运镜用 H3 官方词表，且出现在自己的 [Shot k] 段落里', bad.camera.length === 0, bad.camera.join('；'));
  add('camera-plan', '可选镜头计划必须写清动机、路径、速度、幅度、主体关系、稳定方式、前景遮挡与首尾景别', bad.cameraPlan.length === 0, bad.cameraPlan.join('；'));
  add('h3-structure', 'H3 首行对齐指令由分镜结构推导逐字对账，切点时刻逐个对', eps.length > 0 && bad.h3s.length === 0, bad.h3s.join('；'));
  add('h3-dialogue', '认领节拍的台词逐字进 H3 提示词的 <d> 块', bad.h3d.length === 0, script ? bad.h3d.join('；') : SKIP_SCRIPT);
  add('h3-lang', `H3 提示词语言与设定一致（promptLang=${promptLang}，正文${promptLang === 'en' ? '全英文' : '中文'}、骨架 token 官方英文格式）`, bad.h3e.length === 0, bad.h3e.join('；'));
  add('style-phrase', `分镜图风格短语统一（${style ? `${styleId}：${style.phrase}` : '预设无效'}）——同剧不许画风漂`, bad.style.length === 0, bad.style.join('；'));
  add('prompt-english', '分镜图提示词全英文且非空', bad.english.length === 0, bad.english.join('；'));
  add('prompt-no-names', '英文提示词不含角色名（分镜图提示词恒查；中文 H3 提示词放行）', bad.names.length === 0, banned.length ? bad.names.join('；') : SKIP_NAMES);
  add('refs', '场次／人物／道具对账剧本', bad.refs.length === 0, script ? bad.refs.join('；') : SKIP_SCRIPT);
  add('director-plan', '关键场次有已选导演计划：观众立场、信息时机、空间压力、最强画面、反应落点与声音策略', bad.directorPlan.length === 0, continuityV1 ? bad.directorPlan.join('；') : SKIP_CONTINUITY);
  add('continuity', '镜头首尾边界、资产状态引用与同场跨镜连续性一致', bad.continuity.length === 0, continuityV1 ? bad.continuity.join('；') : SKIP_CONTINUITY);

  if (board?.correspondenceVersion != null) {
    const detail = correspondenceProblems(board, ctx);
    add('multimodal-correspondence', '逐切角色身份、动作姿势、场景道具与首尾边界严格对应', detail.length === 0, detail.join('；'));
  }

  if (ctx.actions) gates.push(...actionGateReport(board, ctx.actions));

  return gates;
}

/* ------------------------------------------------------------------ */
/* validate                                                            */
/* ------------------------------------------------------------------ */

export function validateStoryboard(board, ctx = {}) {
  const problems = [];
  const p = (msg) => problems.push(msg);
  if (!board || typeof board !== 'object') return ['storyboard.json 不是对象'];

  if (!String(board.source ?? '').trim()) p('缺少 source（剧名）');
  const eps = board.episodes;
  if (!Array.isArray(eps) || eps.length === 0) {
    p('episodes 为空');
    return problems;
  }
  const seen = new Set();
  if (board.continuityVersion != null && board.continuityVersion !== 1) p('continuityVersion 目前只支持 1');
  if (board.correspondenceVersion != null && board.correspondenceVersion !== 1) p('correspondenceVersion 目前只支持 1');
  if (board.continuityVersion === 1 && !Array.isArray(board.assetDecisions)) p('continuityVersion: 1 要求根层 assetDecisions 数组');
  for (const ep of eps) {
    const label = `第 ${ep?.ep ?? '?'} 集`;
    if (!Number.isInteger(ep?.ep) || ep.ep < 1) p(`${label}的 ep 必须是正整数`);
    if (seen.has(ep?.ep)) p(`集号 ${ep.ep} 重复`);
    seen.add(ep?.ep);
    if (board.continuityVersion === 1) {
      if (!Array.isArray(ep?.directorCriticalScenes)) p(`${label}缺 directorCriticalScenes 数组（没有关键场就给空数组）`);
      if (!Array.isArray(ep?.scenePlans)) p(`${label}缺 scenePlans 数组`);
    }
    if (!Array.isArray(ep?.segments) || ep.segments.length === 0) {
      p(`${label}没有段`);
      continue;
    }
    for (const seg of ep.segments) {
      const sid = seg?.id ?? '?';
      if (typeof seg?.id !== 'string') p(`${label}有段缺 id`);
      if (!Number.isInteger(seg?.sceneIndex) || seg.sceneIndex < 1) p(`${sid} 缺 sceneIndex（剧本里第几场）`);
      if (typeof seg?.h3Prompt !== 'string') p(`${sid} 缺 h3Prompt（H3 视频提示词，写法见 references/h3-prompt.md）`);
      if (!Array.isArray(seg?.cuts) || seg.cuts.length === 0) {
        p(`${sid} 没有分镜`);
        continue;
      }
      seg.cuts.forEach((cut, ci) => {
        const cid = `${sid}#${ci + 1}`;
        if (!Array.isArray(cut?.beats) || cut.beats.length !== 2) p(`${cid} 的 beats 必须是 [起, 止] 两个数`);
        if (typeof cut?.seconds !== 'number') p(`${cid} 缺 seconds`);
        if (!Array.isArray(cut?.characters)) p(`${cid} 缺 characters（空镜给空数组）`);
        if (typeof cut?.frame !== 'string') p(`${cid} 缺 frame（分镜图英文提示词）`);
      });
    }
  }

  for (const g of gateReport(board, ctx)) {
    if (!g.ok) p(`质量门未过：${g.label}${g.detail ? `（${g.detail}）` : ''}`);
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* seed — 从 script.json 确定性预填                                      */
/* ------------------------------------------------------------------ */

export function seedFromScript(script, epRange = null, actions = null) {
  const expanded = expandScript(script);
  const inRange = (n) => !epRange || (n >= epRange[0] && n <= epRange[1]);
  const episodes = [];
  for (const [epNo, sEp] of expanded) {
    if (!inRange(epNo)) continue;
    episodes.push({
      ep: epNo,
      segments: [],
      directorCriticalScenes: [],
      scenePlans: [],
      seedScenes: sEp.scenes.map((sc) => ({
        sceneIndex: sc.sceneIndex,
        sceneId: sc.sceneId,
        lighting: sc.lighting,
        characters: sc.characters,
        props: sc.props,
        beats: sc.beats.map((b) => {
          const summaries = actionSummaryOf(actions, epNo, sc.sceneIndex, b.n, b.n);
          return {
            n: b.n,
            kind: b.kind,
            seconds: b.seconds,
            ...(b.speaker ? { speaker: b.speaker } : {}),
            text: b.text,
            ...(summaries.length ? {
              actionRefs: summaries.map((summary) => summary.actionId),
              actionIntent: summaries.map((summary) => summary.intent).join('；'),
              ...(summaries.some((summary) => summary.impactEvidence) ? {
                impactEvidence: summaries.filter((summary) => summary.impactEvidence).map((summary) => ({
                  actionId: summary.actionId,
                  evidence: summary.impactEvidence,
                })),
              } : {}),
            } : {}),
          };
        }),
      })),
    });
  }
  return { source: script?.source ?? '', continuityVersion: 1, assetDecisions: [], episodes };
}

/* ------------------------------------------------------------------ */
/* export — H3 投产包                                                   */
/* ------------------------------------------------------------------ */
/*
 * 固定投产结构：每段一个文件夹——E01-01/f1.png … fN.png + prompt.md
 * （h3Prompt 原样），根部一份 manifest：按 Picture 序列出该段要挂的
 * 分镜图路径、秒数、缺图标注。提示词就躺在图旁边，整个文件夹拖给
 * H3 就是一次生成。纯函数返回文件清单，落盘在 CLI 层——可测性。
 */
export function exportPack(board, script, { imageExists = () => false, dir = '.' } = {}) {
  const prefix = dir === '.' ? '' : `${dir}/`;
  const files = [];
  const manifest = [];
  let missingTotal = 0;
  for (const ep of board?.episodes ?? []) {
    for (const seg of ep?.segments ?? []) {
      // prompt.md 头部先说清哪个文件是首帧、每张图钉在第几秒——
      // 分隔线以下是 h3Prompt 原样，整段复制就能用
      const starts = cutStarts(seg.cuts);
      const mapping = (seg.cuts ?? [])
        .map((_, i) => `- Picture ${i + 1} = f${i + 1}.png${i === 0 ? '（**首帧**，钉 0.00 秒）' : `（钉 ${starts[i].toFixed(2)} 秒）`}`)
        .join('\n');
      const directing = (seg.cuts ?? [])
        .map((cut, i) => {
          const lines = [];
          if (cut.cameraPlan) lines.push(`- Shot ${i + 1} · **镜头动机**：${cut.cameraPlan.purpose}\n  - 镜头计划：\`${JSON.stringify(cut.cameraPlan)}\``);
          if (cut.impactPresentation) lines.push(`- Shot ${i + 1} · **打击呈现**：\`${JSON.stringify(cut.impactPresentation)}\``);
          return lines.join('\n');
        })
        .filter(Boolean)
        .join('\n');
      const directingSection = directing ? `\n\n## 导演附注\n\n${directing}` : '';
      const promptMd = `# ${seg.id} · H3 提示词\n\n首帧 = **f1.png**。图片按 Picture 序号挂载：\n\n${mapping}${directingSection}\n\n---\n\n${seg.h3Prompt ?? ''}\n`;
      files.push({ path: `${prefix}${seg.id}/prompt.md`, content: promptMd });
      const pictures = (seg.cuts ?? []).map((_, i) => `${prefix}${seg.id}/f${i + 1}.png`);
      const missing = pictures.filter((rel) => !imageExists(rel));
      missingTotal += missing.length;
      manifest.push({
        segment: seg.id,
        seconds: segSeconds(seg),
        cuts: (seg.cuts ?? []).length,
        cutStarts: cutStarts(seg.cuts),
        prompt: `${prefix}${seg.id}/prompt.md`,
        pictures,
        missing,
        cameraImpact: (seg.cuts ?? []).map((cut, i) => ({
          cut: i + 1,
          ...(cut.cameraPlan ? { cameraPlan: cut.cameraPlan } : {}),
          ...(cut.impactPresentation ? { impactPresentation: cut.impactPresentation } : {}),
        })).filter((item) => item.cameraPlan || item.impactPresentation),
        ...(board?.correspondenceVersion === 1 ? {
          correspondence: (seg.cuts ?? []).map((cut, i) => ({
            cut: i + 1,
            ...(cut.correspondence ? { correspondence: cut.correspondence } : {}),
          })).filter((item) => item.correspondence),
        } : {}),
      });
    }
  }
  files.push({ path: `${prefix}manifest.json`, content: JSON.stringify(manifest, null, 2) + '\n' });
  return { files, manifest, missingTotal };
}

/* ------------------------------------------------------------------ */
/* slug                                                                */
/* ------------------------------------------------------------------ */

export function slug(name) {
  const cleaned = String(name)
    .trim()
    .replace(/[\s/\\:*?"<>|·]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'storyboard';
}

/* ------------------------------------------------------------------ */
/* render — 界面文案                                                    */
/* ------------------------------------------------------------------ */

/*
 * 界面文案表：内置 zh / en 两套。语言优先级 --lang > JSON 顶层 lang 字段 > 'zh'，
 * 经 ctx.lang 传给渲染器。只管报告界面标签——与 promptLang（H3 提示词语言）
 * 互相独立：界面切英文不改提示词，提示词切中文不改界面。
 * 数据（H3 提示词、画面摘要、台词、质量门 detail）不在此表，原样透传。
 */
/* 门标签与「跳过」提示的英文映射：质量门面板是报告的一部分，出英文报告时
 * 这里做展示层翻译——gateReport 的逻辑与中文诊断文案一行不动（CLI 仍是中文）。
 * 动态阈值由门自己算，映射里只写固定语义；未命中的 id 回落到原标签。 */
const GATE_LABELS_EN = {
  'coverage': 'Every script beat claimed exactly once, in order, contiguous (cut level)',
  'segment-cap': 'Each segment 0 < total ≤ {1}s (the single-generation cap)',
  'cut-length': 'Every cut {0}–{1}s — the short-drama attention rhythm',
  'dialogue-fit': 'Dialogue of the claimed beats fits within the cut duration',
  'ep-duration': 'Episode total within ±{0}% of the script\'s target',
  'crowd': 'At most {0} characters on screen per cut; more requires a breakdown note',
  'segment-id': 'Segment IDs in E01-01 format, sequential',
  'size-phrase': 'Shot-size phrase present in the frame prompt',
  'camera-phrase': 'Camera move from the official H3 vocabulary, inside its own [Shot k] passage',
  'h3-structure': 'H3 alignment line derived from the cut structure, audited verbatim; cut times match',
  'h3-dialogue': 'Claimed dialogue appears verbatim inside the H3 <d> blocks',
  'h3-lang': 'Prompt language matches the promptLang setting',
  'style-phrase': 'Frame-prompt style phrase consistent — one drama, one look',
  'prompt-english': 'Frame prompts are English and non-empty',
  'prompt-no-names': 'English prompts carry no character names',
  'refs': 'Scenes / characters / props audited against the script',
  'director-plan': 'Director-critical scenes have an accepted visual plan covering viewpoint, reveal timing, space, strongest image, reaction landing and sound',
  'continuity': 'Cut boundaries, asset-state references and same-scene handoffs remain continuous',
};
const GATE_SKIPS_EN = {
    '未提供 outline.json，本门跳过（视为通过）': 'outline.json not provided — gate skipped (treated as passing)',
    '未提供 art.json，本门跳过（视为通过）': 'art.json not provided — gate skipped (treated as passing)',
    '未提供 script.json，本门跳过（视为通过）': 'script.json not provided — gate skipped (treated as passing)',
    '未提供 outline/cast，本门跳过（视为通过）': 'outline/cast not provided — gate skipped (treated as passing)',
    '未提供 cast.json，本门跳过（视为通过）': 'cast.json not provided — gate skipped (treated as passing)',
    '未启用 continuityVersion: 1，向后兼容模式（视为通过）': 'continuityVersion 1 not enabled — legacy-compatible gate skipped (treated as passing)',
};
/** 报告里的门文案：英文界面取映射，未命中或中文界面回落原文。 */
const gateText = (g, lang) => {
  if (lang !== 'en') return { label: g.label, detail: g.detail };
  const en = GATE_LABELS_EN[g.id];
  // 阈值仍由门自己算：把中文标签里出现的数字按序填进 {0} {1}
  const nums = String(g.label).match(/\d+(?:\.\d+)?/g) ?? [];
  const label = en ? en.replace(/\{(\d)\}/g, (m, i) => nums[Number(i)] ?? m) : g.label;
  return { label, detail: GATE_SKIPS_EN[g.detail] ?? g.detail };
};

const I18N = {
  zh: {
    langCode: 'zh',
    kicker: '分镜',
    docTitle: (s, a, b) => `${s} · 分镜${a === b ? `（第 ${a} 集）` : `（第 ${a}–${b} 集）`}`,
    epRange: (a, b) => (a === b ? `第 ${a} 集` : `第 ${a}–${b} 集`),
    exportJson: '导出 JSON',
    gatesPass: '全部通过',
    gatesFail: (n) => `${n} 项未过`,
    gatePill: (okN, total) => `质量门 ${okN} / ${total}`,
    kpi: {
      segments: '生成段', segmentsSub: (cap) => `一段一次调用，上限 ${cap} 秒`,
      cuts: '分镜', cutsSub: (avg) => `平均 ${avg} 秒一切`,
      time: '预估总时长', timeSub: (t) => `目标 ${t}`,
      batches: '生成批次', batchesSub: '同场景同光照共用环境参考图',
      lines: '台词段', linesSub: '其余是纯画面段',
    },
    secRhythm: '分镜节奏带',
    secSegments: '分集分镜表',
    secBatches: '生成批次单',
    secDialogue: '配音对齐单',
    secGates: '质量门',
    rhythmNote: '粗分隔 = 生成段边界 · 段宽 = 分镜时长占比 · 颜色越深景别越近',
    segmentsNote: '一段 = 一次生成：主分镜图钉 0.00 秒，子分镜图钉各自切点',
    batchesNote: '自动汇总 · 同批段共用同一张环境参考图',
    dialogueNote: '自动汇总 · TTS 音频对到哪一段的第几切',
    epHead: (nSeg, nCut, total, target) => `${nSeg} 段 ${nCut} 切 · 共 ${total} 秒 / 目标 ${target} 秒`,
    segHead: (total, n) => `${total} 秒 · ${n} 个分镜`,
    secBadge: (secs, n) => `${secs}s · ${n} 切`,
    rhythmVal: (nSeg, nCut, secs) => `${nSeg} 段 ${nCut} 切 · ${secs}s`,
    beatsLabel: (s, from, to) => `第 ${s} 场 ${from === to ? `第 ${from} 拍` : `第 ${from}–${to} 拍`}`,
    masterLabel: '主分镜图',
    subLabel: (i) => `子分镜 ${i}`,
    frameMissing: (i) => `#${i} 未生成`,
    framePrompt: '分镜图提示词',
    h3Prompt: 'H3 提示词',
    h3Section: 'H3 视频提示词',
    scenePlansTitle: '关键场次导演计划',
    scenePlanTitle: (sceneIndex, id) => `第 ${sceneIndex} 场 · ${id}`,
    planLabels: {
      audiencePosition: '观众立场', informationTiming: '信息时机', spatialPressure: '空间压力',
      strongestImage: '最强画面', reactionLanding: '反应落点', soundStrategy: '声音策略',
    },
    continuityTitle: '连续性边界',
    purposeLabel: '镜头目的',
    cameraPlanTitle: '镜头动机',
    impactPresentationTitle: '打击呈现',
    showSegs: '▾ 展开全部段',
    hideSegs: '▴ 收起',
    copy: '复制', copied: '已复制', copyFailed: '复制失败',
    dialogueCols: ['段 · 切', '说话人', '台词', '台词秒数'],
    cutCols: ['切', '起点', '秒', '景别', '运镜', '画面', '人物'],
    batchCols: ['场景', '光照', '段', '需要的角色', '道具'],
    atSec: (t) => `${t.toFixed(2)}s 起`,
    batchLabel: (num) => `批次 ${num}`,
    batchNeed: (chars, props) => `需要：${chars.length ? chars.join('、') + ' 的角色设定图' : '无角色（空镜）'}${props.length ? ' · ' + props.join('、') : ''}`,
    voiceOver: '画外音',
    listSep: '、',
    sizeName: (size) => SHOT_SIZES[size]?.zh ?? size,
    cameraLabel: (camera) => `${camera}（${CAMERA_MOVES[camera] ?? '?'}）`,
    speakerLine: (name, text) => `${name}：「${text}」`,
    withLighting: (name, lighting) => (lighting ? `${name}（${lighting}）` : name),
    fmtMin: (sec) => `${Math.floor(sec / 60)} 分 ${Math.round(sec % 60)} 秒`,
    unitSeg: '段',
    unitCut: '切',
    colophon: '分镜由模型依据剧本切分：段 = 一次生成（≤15 秒），分镜 = 段内 2–5 秒的剪切，每个分镜一张关键帧图。对齐指令、切点时刻、台词、提示词纪律全部由脚本确定性对账。分镜图出图走 codex，环境与角色设定图当参考图。',
  },
  en: {
    langCode: 'en',
    kicker: 'Storyboard',
    docTitle: (s, a, b) => `${s} · Storyboard (${a === b ? `Episode ${a}` : `Episodes ${a}–${b}`})`,
    epRange: (a, b) => (a === b ? `Episode ${a}` : `Episodes ${a}–${b}`),
    exportJson: 'Export JSON',
    gatesPass: 'All passed',
    gatesFail: (n) => `${n} failed`,
    gatePill: (okN, total) => `Quality gates ${okN} / ${total}`,
    kpi: {
      segments: 'Segments', segmentsSub: (cap) => `one generation call each, capped at ${cap}s`,
      cuts: 'Cuts', cutsSub: (avg) => `${avg}s per cut on average`,
      time: 'Estimated total', timeSub: (t) => `target ${t}`,
      batches: 'Generation batches', batchesSub: 'same scene + lighting share one environment reference',
      lines: 'Dialogue segments', linesSub: 'the rest are picture-only',
    },
    secRhythm: 'Cut rhythm strip',
    secSegments: 'Segment cards',
    secBatches: 'Generation batches',
    secDialogue: 'Audio alignment',
    secGates: 'Quality gates',
    rhythmNote: 'thick separators = segment boundaries · slice width = cut duration share · darker = closer shot size',
    segmentsNote: 'one segment = one generation: the master frame pins 0.00s, sub-frames pin their own cut marks',
    batchesNote: 'auto-computed · segments in a batch share one environment reference image',
    dialogueNote: 'auto-computed · which segment and cut each TTS clip lands on',
    epHead: (nSeg, nCut, total, target) => `${nSeg} segments ${nCut} cuts · ${total}s total / ${target}s target`,
    segHead: (total, n) => `${total}s · ${n} cuts`,
    secBadge: (secs, n) => `${secs}s · ${n} cuts`,
    rhythmVal: (nSeg, nCut, secs) => `${nSeg} seg ${nCut} cuts · ${secs}s`,
    beatsLabel: (s, from, to) => `Scene ${s} · ${from === to ? `beat ${from}` : `beats ${from}–${to}`}`,
    masterLabel: 'master frame',
    subLabel: (i) => `sub-frame ${i}`,
    frameMissing: (i) => `#${i} not generated`,
    framePrompt: 'Frame prompt',
    h3Prompt: 'H3 prompt',
    h3Section: 'H3 video prompt',
    scenePlansTitle: 'Director plans for critical scenes',
    scenePlanTitle: (sceneIndex, id) => `Scene ${sceneIndex} · ${id}`,
    planLabels: {
      audiencePosition: 'Audience position', informationTiming: 'Reveal timing', spatialPressure: 'Spatial pressure',
      strongestImage: 'Strongest image', reactionLanding: 'Reaction landing', soundStrategy: 'Sound strategy',
    },
    continuityTitle: 'Continuity boundaries',
    purposeLabel: 'Shot purpose',
    cameraPlanTitle: 'Camera motivation',
    impactPresentationTitle: 'Impact presentation',
    showSegs: '▾ Show all segments',
    hideSegs: '▴ Collapse',
    copy: 'Copy', copied: 'Copied', copyFailed: 'Copy failed',
    dialogueCols: ['Segment · cut', 'Speaker', 'Line', 'Seconds'],
    cutCols: ['Cut', 'Start', 'Sec', 'Size', 'Camera', 'Picture', 'Characters'],
    batchCols: ['Scene', 'Lighting', 'Segments', 'Characters needed', 'Props'],
    atSec: (t) => `from ${t.toFixed(2)}s`,
    batchLabel: (num) => `Batch ${num}`,
    batchNeed: (chars, props) => `Needs: ${chars.length ? `character sheets for ${chars.join(', ')}` : 'no characters (empty shot)'}${props.length ? ' · ' + props.join(', ') : ''}`,
    voiceOver: 'Voice-over',
    listSep: ', ',
    sizeName: (size) => SHOT_SIZES[size]?.phrase ?? size,
    cameraLabel: (camera) => camera,
    speakerLine: (name, text) => `${name}: “${text}”`,
    withLighting: (name, lighting) => (lighting ? `${name} (${lighting})` : name),
    fmtMin: (sec) => `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`,
    unitSeg: 'seg',
    unitCut: 'cuts',
    colophon: 'Cut by the model from the script: a segment = one generation call (≤15s), a cut = a 2–5s edit inside it, one keyframe per cut. Alignment lines, cut marks, dialogue and prompt discipline are all audited deterministically by the script. Frames are generated through codex with the scene and character sheets as references.',
  },
};

const tOf = (lang) => {
  if (lang && !I18N[lang]) throw new Error('报告界面语言目前内置 zh / en');
  return I18N[lang ?? 'zh'];
};

/* ------------------------------------------------------------------ */
/* render 公共                                                          */
/* ------------------------------------------------------------------ */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function namer(ctx = {}, t = I18N.zh) {
  const charName = new Map((ctx.outline?.characters ?? []).map((c) => [c.id, c.name]));
  const sceneName = new Map((ctx.art?.scenes ?? []).map((s) => [s.id, s.name]));
  const propName = new Map((ctx.art?.props ?? []).map((p) => [p.id, p.name]));
  return {
    char: (id) => (id === 'VO' ? t.voiceOver : charName.get(id) ?? id),
    scene: (id) => sceneName.get(id) ?? id,
    prop: (id) => propName.get(id) ?? id,
  };
}

/** 分镜认领的节拍 → 画面摘要（动作原文 + 台词行），模型不重写。 */
function cutBeats(cut, scene) {
  if (!scene) return [];
  const [from, to] = cut.beats ?? [];
  return scene.beats.slice((from ?? 1) - 1, to ?? 0);
}

/* ------------------------------------------------------------------ */
/* render — markdown                                                   */
/* ------------------------------------------------------------------ */

const mdRow = (cells) => `| ${cells.map((c) => String(c ?? '').replace(/\|/g, '\\|')).join(' | ')} |`;
const mdHead = (cols) => [mdRow(cols), mdRow(cols.map(() => '---'))].join('\n');

export function renderMarkdown(board, ctx = {}) {
  const t = tOf(ctx.lang ?? board?.lang);
  const n = namer(ctx, t);
  const expanded = expandScript(ctx.script);
  const stats = computeStats(board, ctx.script);
  const eps = board.episodes;
  const out = [`# ${t.docTitle(board.source, eps[0]?.ep, eps[eps.length - 1]?.ep)}`, ''];

  for (const [i, ep] of eps.entries()) {
    const st = stats.episodes[i];
    const sEp = expanded.get(ep.ep);
    out.push(`## E${String(ep.ep).padStart(2, '0')}`, '', `> ${t.epHead(st.segments, st.cuts, st.totalSeconds, st.target)}`, '');
    if (board.continuityVersion === 1 && (ep.scenePlans ?? []).length) {
      out.push(`### ${t.scenePlansTitle}`, '');
      for (const plan of ep.scenePlans) {
        out.push(`#### ${t.scenePlanTitle(plan.sceneIndex, plan.id)}`, '');
        for (const field of Object.keys(t.planLabels)) out.push(`- **${t.planLabels[field]}**：${plan[field] ?? ''}`);
        out.push('');
      }
    }
    for (const seg of ep.segments) {
      const scene = sEp?.scenes?.[seg.sceneIndex - 1];
      out.push(`### ${seg.id} · ${scene ? t.withLighting(n.scene(scene.sceneId), scene.lighting) : '?'} · ${t.segHead(segSeconds(seg), seg.cuts.length)}`, '');
      out.push(mdHead(t.cutCols));
      const starts = cutStarts(seg.cuts);
      seg.cuts.forEach((cut, ci) => {
        const summary = cutBeats(cut, scene)
          .map((b) => (b.kind === 'line' ? t.speakerLine(n.char(b.speaker), b.text) : b.text))
          .join(' ');
        out.push(mdRow([
          `#${ci + 1}`, `${starts[ci].toFixed(2)}s`, cut.seconds,
          t.sizeName(cut.size), t.cameraLabel(cut.camera),
          summary, (cut.characters ?? []).map(n.char).join(t.listSep),
        ]));
      });
      out.push('', `**${t.h3Section}**`, '', '```text', seg.h3Prompt ?? '', '```', '');
      if (board.continuityVersion === 1) {
        out.push(`**${t.continuityTitle}**`, '');
        seg.cuts.forEach((cut, ci) => {
          out.push(`- #${ci + 1} · **${t.purposeLabel}**：${cut.purpose ?? ''}`, '', '```json', JSON.stringify({ startBoundary: cut.startBoundary, endBoundary: cut.endBoundary, ...(cut.continuityOverride ? { continuityOverride: cut.continuityOverride } : {}) }, null, 2), '```', '');
        });
      }
      seg.cuts.forEach((cut, ci) => {
        if (cut.cameraPlan) out.push(`- #${ci + 1} · **${t.cameraPlanTitle}**：${cut.cameraPlan.purpose}`, '', '```json', JSON.stringify(cut.cameraPlan, null, 2), '```', '');
        if (cut.impactPresentation) out.push(`- #${ci + 1} · **${t.impactPresentationTitle}**`, '', '```json', JSON.stringify(cut.impactPresentation, null, 2), '```', '');
      });
    }
  }

  out.push(`## ${t.secBatches}`, '', mdHead(t.batchCols));
  for (const b of stats.batches) {
    out.push(mdRow([`${b.sceneId} ${n.scene(b.sceneId)}`, b.lighting, b.segments.join(t.listSep), b.characters.map(n.char).join(t.listSep), b.props.map(n.prop).join(t.listSep)]));
  }
  out.push('', `## ${t.secDialogue}`, '', mdHead(t.dialogueCols));
  for (const d of stats.dialogue) out.push(mdRow([`${d.segment}#${d.cut}`, n.char(d.speaker), d.line, d.seconds]));
  out.push('');
  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* render — html                                                       */
/* ------------------------------------------------------------------ */
/*
 * 与另外四份报告同一套视觉语言。设计约定见 references/report-style.md。
 * 分镜图从 ./images/<段号>-f<切序>.png 找（相对 render 时的工作目录），
 * 有就内嵌显示 + 点击放大，没有就显示占位——不猜、不骗。
 */

function embedDoc(doc) {
  return JSON.stringify(doc).replace(/</g, '\\u003c');
}

export function renderHtml(board, ctx = {}) {
  const lang = ctx.lang ?? board?.lang ?? 'zh';
  const t = tOf(lang);
  const n = namer(ctx, t);
  const expanded = expandScript(ctx.script);
  const stats = computeStats(board, ctx.script);
  const gates = gateReport(board, ctx);
  const failed = gates.filter((g) => !g.ok);
  const eps = board.episodes;
  const params = stats.params;
  const fmtMin = t.fmtMin;

  const SIZE_ALPHA = { 'extreme-wide': 0.25, wide: 0.4, medium: 0.58, close: 0.78, 'extreme-close': 1 };

  // ---- 01 分镜节奏带：段是粗分隔的组，组内每个分镜一段色块 ----
  const rhythmRows = eps
    .map((ep, i) => {
      const st = stats.episodes[i];
      const groups = ep.segments
        .map((seg) => {
          const segs = seg.cuts
            .map((cut, ci) => {
              const w = st.totalSeconds ? (cut.seconds / st.totalSeconds) * 100 : 0;
              const alpha = SIZE_ALPHA[cut.size] ?? 0.5;
              return `<a class="seg" href="#seg-${esc(seg.id)}" style="width:${r1(w)}%;background:rgba(138,51,36,${alpha})" title="${esc(`${seg.id}#${ci + 1} · ${cut.seconds}s · ${t.sizeName(cut.size)} · ${cut.camera}`)}"></a>`;
            })
            .join('');
          const gw = st.totalSeconds ? (segSeconds(seg) / st.totalSeconds) * 100 : 0;
          return `<span class="rseg" style="width:${r1(gw)}%">${segs}</span>`;
        })
        .join('');
      return `<div class="rrow"><span class="rep">E${String(ep.ep).padStart(2, '0')}</span><div class="rtrack">${groups}</div><span class="rval">${esc(t.rhythmVal(st.segments, st.cuts, st.totalSeconds))}</span></div>`;
    })
    .join('\n');
  const rhythmLegend = Object.keys(SHOT_SIZES)
    .map((k) => `<i><span class="sw" style="background:rgba(138,51,36,${SIZE_ALPHA[k]})"></span>${esc(t.sizeName(k))}</i>`)
    .join('');

  // ---- 02 分集分镜表：段卡（主分镜图 + 子分镜条 + 分镜行） ----
  const epBlocks = eps
    .map((ep, i) => {
      const st = stats.episodes[i];
      const sEp = expanded.get(ep.ep);
      const planCards = board.continuityVersion === 1 && (ep.scenePlans ?? []).length
        ? `<section class="sceneplans"><h3>${esc(t.scenePlansTitle)}</h3>${ep.scenePlans.map((plan) => `<article class="sceneplan"><b>${esc(t.scenePlanTitle(plan.sceneIndex, plan.id))}</b>${Object.keys(t.planLabels).map((field) => `<p><strong>${esc(t.planLabels[field])}</strong>${esc(plan[field] ?? '')}</p>`).join('')}</article>`).join('')}</section>`
        : '';
      const cards = ep.segments
        .map((seg) => {
          const scene = sEp?.scenes?.[seg.sceneIndex - 1];
          const starts = cutStarts(seg.cuts);
          const frame = (ci) => `${seg.id}/f${ci + 1}.png`;
          const has = (ci) => (ctx.imageExists ? ctx.imageExists(frame(ci)) : false);

          // 主分镜图区：图出全的段保留原 master+subs 层级；有缺图的段每切一格——
          // 有图的格显示原图，无图的格显示整宽提示词卡 + 复制按钮（混合情况按格判断）
          const hasAll = seg.cuts.every((_, ci) => has(ci));
          let master, subs;
          if (hasAll) {
            master = `<img class="frame" src="${esc(frame(0))}" alt="${esc(`${seg.id}#1`)}" loading="lazy">`;
            subs = seg.cuts.length > 1
              ? `<div class="subs">${seg.cuts
                  .slice(1)
                  .map((cut, ci) => `<img class="subf" src="${esc(frame(ci + 1))}" alt="${esc(`${seg.id}#${ci + 2}`)}" loading="lazy">`)
                  .join('')}</div>`
              : '';
          } else {
            master = `<div class="fquad">${seg.cuts
              .map((cut, ci) => {
                const label = ci === 0 ? t.masterLabel : t.subLabel(ci + 1);
                const body = has(ci)
                  ? `<img class="frame" src="${esc(frame(ci))}" alt="${esc(`${seg.id}#${ci + 1}`)}" loading="lazy">`
                  : `<div class="frame ph fcell"><div class="fcell-h"><b>${esc(`${label} · ${t.frameMissing(ci + 1)}`)}</b><button class="copy mini" data-copy="${esc(cut.frame ?? '')}">${esc(t.copy)}</button></div><span class="fprompt">${esc(cut.frame ?? '')}</span></div>`;
                return body;
              })
              .join('\n')}</div>`;
            subs = '';
          }

          const cutRows = seg.cuts
            .map((cut, ci) => {
              const beats = cutBeats(cut, scene);
              const summary = beats
                .map((b) =>
                  b.kind === 'line'
                    ? `<p class="sline"><b>${esc(n.char(b.speaker))}</b>${esc(b.text)}</p>`
                    : `<p class="sact">${esc(b.text)}</p>`,
                )
                .join('');
              return `<li class="cut">
  <div class="cut-h">
    <b>#${ci + 1}</b>
    <span class="cut-t">${esc(t.atSec(starts[ci]))} · ${cut.seconds}s</span>
    <span class="cut-sc">${esc(t.sizeName(cut.size))} · ${esc(cut.camera)}</span>
    ${(cut.characters ?? []).map((id) => `<span class="chip">${esc(n.char(id))}</span>`).join('')}
    ${(cut.props ?? []).map((id) => `<span class="chip prop">${esc(n.prop(id))}</span>`).join('')}
    <button class="copy mini" data-copy="${esc(cut.frame ?? '')}">${esc(t.framePrompt)}</button>
  </div>
  ${summary}
  ${cut.cameraPlan ? `<details class="continuity"><summary>${esc(t.cameraPlanTitle)}：${esc(cut.cameraPlan.purpose)}</summary><pre>${esc(JSON.stringify(cut.cameraPlan, null, 2))}</pre></details>` : ''}
  ${cut.impactPresentation ? `<details class="continuity"><summary>${esc(t.impactPresentationTitle)}</summary><pre>${esc(JSON.stringify(cut.impactPresentation, null, 2))}</pre></details>` : ''}
  ${board.continuityVersion === 1 ? `<details class="continuity"><summary>${esc(t.continuityTitle)} · ${esc(t.purposeLabel)}：${esc(cut.purpose ?? '')}</summary><pre>${esc(JSON.stringify({ startBoundary: cut.startBoundary, endBoundary: cut.endBoundary, ...(cut.continuityOverride ? { continuityOverride: cut.continuityOverride } : {}) }, null, 2))}</pre></details>` : ''}
</li>`;
            })
            .join('\n');

          return `<article class="segcard" id="seg-${esc(seg.id)}">
  <header class="seg-h">
    <b>${esc(seg.id)}</b>
    <span class="sec-badge">${esc(t.secBadge(segSeconds(seg), seg.cuts.length))}</span>
    <span class="chip">${esc(scene ? `${scene.sceneId} ${n.scene(scene.sceneId)}` : '?')}</span>
    ${scene?.lighting ? `<span class="chip lite">${esc(scene.lighting)}</span>` : ''}
    <span class="beatsref">${esc(t.beatsLabel(seg.sceneIndex, seg.cuts[0]?.beats?.[0], seg.cuts[seg.cuts.length - 1]?.beats?.[1]))}</span>
  </header>
  ${master}
  ${subs}
  <div class="duo">
    <ol class="cuts">
${cutRows}
    </ol>
    <div class="ppanel">
      <div class="pp-h">
        <b>${esc(t.h3Prompt)}</b>
        <button class="copy" data-copy="${esc(seg.h3Prompt ?? '')}">${esc(t.copy)}</button>
      </div>
      <pre class="pp on">${esc(seg.h3Prompt ?? '')}</pre>
    </div>
  </div>
  ${seg.note ? `<p class="seg-note">${esc(seg.note)}</p>` : ''}
</article>`;
        })
        .join('\n');
      return `<section class="ep" id="ep-${ep.ep}">
  <header class="ep-h">
    <span class="ep-n">E${String(ep.ep).padStart(2, '0')}</span>
    <span class="ep-est">${esc(t.epHead(st.segments, st.cuts, st.totalSeconds, st.target))}</span>
  </header>
  ${planCards}
  <div class="shots clip">
    <div class="seggrid">
${cards}
    </div>
  </div>
  <button class="shmore">${esc(t.showSegs)}</button>
</section>`;
    })
    .join('\n');

  // ---- 03 生成批次单 ----
  const batchCards = stats.batches
    .map((b, i) => {
      const sheet = `images/${slug(n.scene(b.sceneId))}-sheet.png`;
      const hasSheet = ctx.imageExists ? ctx.imageExists(sheet) : false;
      return `<article class="batch">
  ${hasSheet ? `<img class="bimg" src="${esc(sheet)}" alt="${esc(n.scene(b.sceneId))}" loading="lazy">` : ''}
  <header class="batch-h"><b>${esc(t.batchLabel(String(i + 1).padStart(2, '0')))}</b><span class="chip">${esc(`${b.sceneId} ${n.scene(b.sceneId)}`)}</span>${b.lighting ? `<span class="chip lite">${esc(b.lighting)}</span>` : ''}</header>
  <div class="batch-shots">${b.segments.map((s) => `<a class="chip mono" href="#seg-${esc(s)}">${esc(s)}</a>`).join('')}</div>
  <p class="batch-need">${esc(t.batchNeed(b.characters.map(n.char), b.props.map(n.prop)))}</p>
</article>`;
    })
    .join('\n');

  // ---- 04 配音对齐单 ----
  const dlgRows = stats.dialogue
    .map((d) => `<tr><td><a href="#seg-${esc(d.segment)}">${esc(d.segment)}</a> #${d.cut}</td><td>${esc(n.char(d.speaker))}</td><td class="serif">${esc(d.line)}</td><td>${d.seconds}</td></tr>`)
    .join('\n');

  const gateList = `<ul class="gate">
  ${gates
    .map(
      (g) => `<li class="${g.ok ? 'ok' : 'bad'}"><span class="m">${g.ok ? '✓' : '✗'}</span><span>${esc(gateText(g, t.langCode).label)}${
        (!g.ok && g.detail) || (g.ok && g.detail.includes('跳过')) ? `<small>${esc(gateText(g, t.langCode).detail)}</small>` : ''
      }</span></li>`,
    )
    .join('\n  ')}
</ul>`;

  return `<!doctype html>
<html lang="${esc(lang)}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.docTitle(board.source, eps[0]?.ep, eps[eps.length - 1]?.ep))}</title>
<style>
:root{
  --paper:#eceded; --panel:#f5f6f5; --side:#e4e6e3; --ink:#191d21; --ink-2:#5b636a; --ink-3:#8c9298;
  --rule:#d2d5d0; --rule-2:#c2c6bf; --seal:#8a3324; --seal-2:#c56a4e; --seal-soft:#8a332412; --ok:#3d6b4f;
  --serif:"Songti SC","STSong","Source Han Serif SC","Noto Serif CJK SC",Georgia,serif;
  --sans:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,-apple-system,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.7 var(--sans);-webkit-font-smoothing:antialiased}
.page{max-width:1600px;margin:0 auto;padding:24px 32px 90px}
h1,h2,h3{margin:0;font-weight:400}

.hd{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;border-bottom:2px solid var(--ink);padding-bottom:12px}
.hd h1{font:400 28px/1.1 var(--serif);letter-spacing:.06em}
.hd .sub{font-size:13px;color:var(--ink-2)}
.hd .right{margin-left:auto;display:flex;align-items:center;gap:10px}
.gatepill{display:inline-flex;align-items:center;gap:6px;font:500 12px/1 var(--sans);border-radius:99px;padding:6px 12px}
.gatepill.pass{color:var(--ok);border:1px solid var(--ok)}
.gatepill.fail{color:var(--seal);border:1px solid var(--seal);background:var(--seal-soft)}
.expo{font:500 11px/1 var(--sans);color:var(--ink-2);background:var(--panel);
  border:1px solid var(--rule-2);border-radius:2px;padding:7px 11px;cursor:pointer;transition:.15s}
.expo:hover{border-color:var(--seal);color:var(--seal)}
.expo:focus-visible{outline:2px solid var(--seal);outline-offset:2px}

.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:18px 0 6px}
@media(max-width:980px){.kpis{grid-template-columns:repeat(2,1fr)}}
.kpi{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:11px 14px 9px}
.kpi .l{font:500 10px/1 var(--sans);letter-spacing:.18em;color:var(--ink-3)}
.kpi .v{font:400 28px/1.15 var(--serif);margin-top:5px}
.kpi .v small{font:400 14px var(--serif);color:var(--ink-2)}
.kpi .d{font-size:11px;color:var(--ink-2);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kpi.accent{border-top:2px solid var(--seal)}
.galert{margin:14px 0 0;border:1px solid var(--seal);background:var(--seal-soft);border-radius:2px;
  padding:10px 14px;font-size:13px}
.galert b{color:var(--seal)}
.galert span{display:block;font-size:12px;color:var(--ink-2)}

section.top-sec{margin-top:34px}
.sec-h{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--rule-2);padding-bottom:8px;margin-bottom:16px}
.sec-h .no{font:500 12px/1 var(--mono);color:var(--seal)}
.sec-h h2{font:400 20px/1.2 var(--serif);letter-spacing:.05em}
.sec-h .note{margin-left:auto;font-size:12px;color:var(--ink-3)}

/* 01 cut rhythm strip */
.rhythm{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:16px 20px 10px}
.rrow{display:grid;grid-template-columns:44px minmax(0,1fr) 150px;gap:12px;align-items:center;padding:5px 0}
.rep{font:500 12px/1 var(--mono);color:var(--ink-2)}
.rtrack{display:flex;height:22px;border:1px solid var(--rule);border-radius:2px;overflow:hidden;background:var(--paper)}
.rseg{display:flex;border-right:2px solid var(--ink-2)}
.rseg:last-child{border-right:0}
.seg{display:block;border-right:1px solid var(--panel)}
.rseg .seg:last-child{border-right:0}
.seg:hover{outline:2px solid var(--ink);outline-offset:-2px}
.rval{font:500 12px/1.5 var(--sans);color:var(--ink-2)}
.legend{display:flex;gap:16px;font-size:12px;color:var(--ink-2);margin:8px 0 2px;flex-wrap:wrap}
.legend i{font-style:normal;display:inline-flex;align-items:center;gap:6px}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px}

/* 02 segment cards */
.ep{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:18px 22px;margin-bottom:16px}
.sceneplans{margin:14px 0 18px;padding:12px 14px;border-left:3px solid var(--seal);background:var(--seal-soft)}
.sceneplans h3{margin:0 0 10px;font:600 15px/1.4 var(--serif)}
.sceneplan{padding:8px 0;border-top:1px solid var(--rule-2)}
.sceneplan p{display:grid;grid-template-columns:92px 1fr;gap:10px;margin:5px 0;font-size:12px;line-height:1.55}
.sceneplan strong{color:var(--ink-2)}
.ep-h{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--rule-2);padding-bottom:10px;margin-bottom:14px}
.ep-n{font:400 22px/1 var(--serif);letter-spacing:.04em;color:var(--seal)}
.ep-est{font-size:12.5px;color:var(--ink-2)}
.shots{position:relative}
.shots.clip{max-height:760px;overflow:hidden}
.shots.clip::after{content:'';position:absolute;left:0;right:0;bottom:0;height:80px;
  background:linear-gradient(180deg,transparent,var(--panel));pointer-events:none}
.shmore{display:block;width:100%;margin-top:8px;font:500 11.5px/1 var(--sans);letter-spacing:.06em;
  color:var(--ink-2);background:var(--paper);border:1px solid var(--rule-2);border-radius:2px;
  padding:7px 0;cursor:pointer;transition:.15s}
.shmore:hover{border-color:var(--seal);color:var(--seal)}
.shmore:focus-visible{outline:2px solid var(--seal);outline-offset:2px}
.seggrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}
@media(max-width:1100px){.seggrid{grid-template-columns:minmax(0,1fr)}}
.segcard{background:var(--paper);border:1px solid var(--rule);border-radius:2px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.seg-h{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.seg-h b{font:500 14px/1 var(--mono);color:var(--seal)}
.sec-badge{font:500 11px/1 var(--mono);border:1px solid var(--seal);color:var(--seal);border-radius:99px;padding:2px 8px}
.beatsref{margin-left:auto;font-size:10.5px;color:var(--ink-3)}
.frame{width:100%;aspect-ratio:16/9;object-fit:cover;border:1px solid var(--rule-2);border-radius:2px;
  cursor:zoom-in;display:block;background:var(--side)}
.frame.ph{display:flex;flex-direction:column;gap:6px;padding:10px 12px;cursor:default;overflow:hidden}
.frame.ph b{font:500 10px/1 var(--sans);letter-spacing:.14em;color:var(--ink-3)}
.frame.ph span{font:400 10.5px/1.55 var(--mono);color:var(--ink-2);overflow:hidden;display:-webkit-box;
  -webkit-line-clamp:5;-webkit-box-orient:vertical}
.subs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.fquad{display:grid;grid-template-columns:1fr;gap:10px;margin:10px 0}
.fquad .frame.ph{aspect-ratio:auto}
.fquad .fcell{margin:0;min-height:0}
.fcell-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px}
.fcell-h .copy.mini{margin:0;flex:none}
.frame.ph .fprompt{font:400 10.5px/1.4 var(--mono);color:var(--ink-2);white-space:pre-wrap;word-break:break-word;display:block;
  -webkit-line-clamp:none;-webkit-box-orient:vertical;overflow:visible}
.subf{width:100%;aspect-ratio:16/9;object-fit:cover;border:1px solid var(--rule-2);border-radius:2px;
  cursor:zoom-in;display:block;background:var(--side)}
.subf.ph{display:flex;align-items:center;justify-content:center;cursor:default;
  font:500 10px/1 var(--sans);color:var(--ink-3);letter-spacing:.08em}
.duo{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start;border-top:1px solid var(--rule);padding-top:4px}
@media(max-width:900px){.duo{grid-template-columns:minmax(0,1fr)}}
.ppanel{border:1px solid var(--rule);border-radius:2px;background:var(--panel);margin-top:7px}
.pp-h{display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid var(--rule)}
.pp-h b{font:500 11px/1 var(--sans);letter-spacing:.08em;color:var(--ink-2);margin-right:auto}
.pp{display:none;margin:0;padding:9px 12px;font:400 12px/1.8 var(--sans);color:var(--ink);
  white-space:pre-wrap;word-break:break-word;max-height:400px;overflow-y:auto;
  scrollbar-width:thin;scrollbar-color:var(--rule-2) transparent}
.pp.on{display:block}
.pp::-webkit-scrollbar{width:6px}
.pp::-webkit-scrollbar-thumb{background:var(--rule-2);border-radius:3px}
.cuts{margin:0;padding:0;list-style:none}
.cut{padding:7px 0;border-bottom:1px solid var(--rule)}
.continuity{margin:7px 0 3px;border-top:1px dashed var(--rule-2);padding-top:6px}
.continuity summary{cursor:pointer;color:var(--ink-2);font-size:12px}
.continuity pre{white-space:pre-wrap;overflow:auto;max-height:360px;background:var(--paper);border:1px solid var(--rule-2);padding:10px;font:11px/1.45 var(--mono)}
.cut:first-child{padding-top:11px}
.cut:last-child{border-bottom:0}
.cut-h{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.cut-h b{font:500 12px/1 var(--mono);color:var(--seal)}
.cut-t{font:500 10.5px/1.6 var(--mono);color:var(--ink-3)}
.cut-sc{font-size:11.5px;color:var(--ink-2)}
.cut-h .copy{margin-left:auto;opacity:0;transition:.15s}
.cut:hover .copy{opacity:1}
.cut p{margin:3px 0 0;font-size:12px;line-height:1.6}
.sact{color:var(--ink-2)}
.sline{font-family:var(--serif)}
.sline b{font-weight:500;margin-right:6px;color:var(--seal)}
.chip{font:400 10.5px/1.6 var(--mono);border:1px solid var(--rule-2);border-radius:2px;
  padding:0 6px;background:var(--panel);color:var(--ink-2);text-decoration:none}
.chip.lite{border-color:var(--seal-2);color:var(--seal-2)}
.chip.prop{border-color:var(--seal);color:var(--seal)}
.chip.mono{font-family:var(--mono)}
a.chip:hover{border-color:var(--seal);color:var(--seal)}
.prompts{display:flex;gap:6px}
.seg-note{margin:0;font-size:11px;color:var(--ink-3)}

/* 03 generation batches */
.batches{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;align-items:start}
@media(max-width:1100px){.batches{grid-template-columns:minmax(0,1fr)}}
.batch{background:var(--panel);border:1px solid var(--rule);border-radius:2px;padding:14px 18px}
.bimg{width:100%;aspect-ratio:16/9;object-fit:cover;border:1px solid var(--rule-2);border-radius:2px;
  cursor:zoom-in;display:block;margin-bottom:10px}
.batch-h{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.batch-h b{font:500 13px var(--serif);letter-spacing:.06em}
.batch-shots{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.batch-need{margin:8px 0 0;font-size:12px;color:var(--ink-2)}

/* 04 audio alignment */
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--rule);font-size:13px}
th,td{padding:8px 12px;border-bottom:1px solid var(--rule);text-align:left;vertical-align:top}
th{font:500 11px/1 var(--sans);letter-spacing:.1em;color:var(--ink-3);background:var(--side)}
tr:last-child td{border-bottom:0}
td:first-child{font-family:var(--mono);font-size:12px;white-space:nowrap}
td a{color:var(--seal);text-decoration:none}
td.serif{font-family:var(--serif)}

.copy{flex:none;font:500 11px/1 var(--sans);color:var(--ink-2);background:var(--panel);
  border:1px solid var(--rule-2);border-radius:2px;padding:5px 10px;cursor:pointer;transition:.15s}
.copy:hover{border-color:var(--seal);color:var(--seal)}
.copy:focus-visible{outline:2px solid var(--seal);outline-offset:2px}
.copy[data-done]{border-color:var(--seal);color:var(--seal)}
.copy.mini{padding:3px 7px;font-size:10px}
.copy.h3{border-color:var(--seal-2);color:var(--seal-2);width:100%}
.copy.h3:hover,.copy.h3[data-done]{border-color:var(--seal);color:var(--seal)}

.gate{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:2px 28px}
@media(max-width:900px){.gate{grid-template-columns:1fr}}
.gate li{display:flex;gap:8px;padding:5px 0;font-size:12.5px;line-height:1.55}
.gate .m{flex:none;font-weight:700}
.gate li.ok .m{color:var(--ok)}
.gate li.bad .m{color:var(--seal)}
.gate li.bad{background:var(--seal-soft);border-radius:2px;padding-left:6px}
.gate small{display:block;color:var(--ink-3)}
.gsum{margin:10px 0 0;font-size:12px;color:var(--ink-2)}
.gsum b{color:var(--seal)}

.lightbox{position:fixed;inset:0;background:rgba(20,22,24,.88);display:none;align-items:center;
  justify-content:center;z-index:9;cursor:zoom-out;padding:32px}
.lightbox.on{display:flex}
.lightbox img{max-width:96%;max-height:96%;border:1px solid #555;border-radius:2px}

.foot{margin-top:40px;font-size:11px;color:var(--ink-3);border-top:1px solid var(--rule);padding-top:14px}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media print{
  .expo,.copy,.shmore{display:none!important}
  .pp{max-height:none;overflow:visible}
  .duo{grid-template-columns:minmax(0,1fr)}
  .shots.clip{max-height:none}
  .shots.clip::after{display:none}
  .seggrid,.batches{grid-template-columns:minmax(0,1fr)}
  .page{max-width:none;padding:0}
  section.top-sec,.segcard,.batch{page-break-inside:avoid}
  body{background:#fff}
}
</style></head><body>
<div class="page">

<header class="hd">
  <h1>${esc(board.source)}</h1>
  <span class="sub">${esc(t.kicker)} · ${esc(t.epRange(eps[0]?.ep, eps[eps.length - 1]?.ep))}</span>
  <span class="right">
    <span class="gatepill ${failed.length ? 'fail' : 'pass'}">${failed.length ? '✗' : '✓'} ${esc(t.gatePill(gates.length - failed.length, gates.length))}</span>
    <button class="expo" data-name="${esc(slug(board.source))}-storyboard.json">${esc(t.exportJson)}</button>
  </span>
</header>

<div class="kpis">
  <div class="kpi accent"><div class="l">${esc(t.kpi.segments)}</div><div class="v">${stats.totals.segments} <small>${esc(t.unitSeg)}</small></div><div class="d">${esc(t.kpi.segmentsSub(params.maxSegmentSeconds))}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.cuts)}</div><div class="v">${stats.totals.cuts} <small>${esc(t.unitCut)}</small></div><div class="d">${esc(t.kpi.cutsSub(stats.totals.avgCutSeconds))}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.time)}</div><div class="v">${esc(fmtMin(stats.totals.seconds))}</div><div class="d">${esc(t.kpi.timeSub(fmtMin(stats.totals.targetSeconds)))}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.batches)}</div><div class="v">${stats.batches.length}</div><div class="d">${esc(t.kpi.batchesSub)}</div></div>
  <div class="kpi"><div class="l">${esc(t.kpi.lines)}</div><div class="v">${stats.totals.withLines} <small>${esc(t.unitSeg)}</small></div><div class="d">${esc(t.kpi.linesSub)}</div></div>
</div>
${failed.length ? `<div class="galert"><b>✗ ${esc(t.gatesFail(failed.length))}</b>${failed.map((g) => `<span>${esc(gateText(g, t.langCode).label)}${g.detail ? ` — ${esc(gateText(g, t.langCode).detail)}` : ''}</span>`).join('')}</div>` : ''}

<section class="top-sec" id="sec-rhythm">
  <div class="sec-h"><span class="no">01</span><h2>${esc(t.secRhythm)}</h2><span class="note">${esc(t.rhythmNote)}</span></div>
  <div class="rhythm">
    <div class="legend">${rhythmLegend}</div>
${rhythmRows}
  </div>
</section>

<section class="top-sec" id="sec-segments">
  <div class="sec-h"><span class="no">02</span><h2>${esc(t.secSegments)}</h2><span class="note">${esc(t.segmentsNote)}</span></div>
${epBlocks}
</section>

<section class="top-sec" id="sec-batches">
  <div class="sec-h"><span class="no">03</span><h2>${esc(t.secBatches)}</h2><span class="note">${esc(t.batchesNote)}</span></div>
  <div class="batches">
${batchCards}
  </div>
</section>

<section class="top-sec" id="sec-dialogue">
  <div class="sec-h"><span class="no">04</span><h2>${esc(t.secDialogue)}</h2><span class="note">${esc(t.dialogueNote)}</span></div>
  <table><thead><tr>${t.dialogueCols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
  <tbody>
${dlgRows}
  </tbody></table>
</section>

<section class="top-sec" id="sec-gates">
  <div class="sec-h"><span class="no">05</span><h2>${esc(t.secGates)}</h2></div>
  ${gateList}
  <p class="gsum">${failed.length ? `<b>${esc(t.gatesFail(failed.length))}</b>` : esc(t.gatesPass)}</p>
</section>

<p class="foot">${esc(t.colophon)}</p>
</div>

<div class="lightbox" id="lightbox"><img alt=""></div>

<script type="application/json" id="storyboard-data">${embedDoc(board)}</script>
<script>
const L = ${JSON.stringify({ copied: t.copied, failed: t.copyFailed, show: t.showSegs, hide: t.hideSegs })};

// 分集分镜表：段卡区默认最多 760px。不超高的集直接放开；超高的集点开/收起
document.querySelectorAll('.shmore').forEach((btn) => {
  const zone = btn.previousElementSibling;
  if (zone.scrollHeight <= 780) {
    zone.classList.remove('clip');
    btn.remove();
    return;
  }
  btn.addEventListener('click', () => {
    const clipped = zone.classList.toggle('clip');
    btn.textContent = clipped ? L.show : L.hide;
    if (clipped) zone.closest('.ep').scrollIntoView({ block: 'nearest' });
  });
});

// 点图放大（主分镜图 / 子分镜图 / 批次场景图）
const lb = document.getElementById('lightbox');
document.addEventListener('click', (e) => {
  const img = e.target.closest('img.frame, img.subf, img.bimg');
  if (img) {
    lb.querySelector('img').src = img.src;
    lb.classList.add('on');
    return;
  }
  if (e.target.closest('#lightbox')) lb.classList.remove('on');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') lb.classList.remove('on');
});

// 复制提示词
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy');
  if (!btn) return;
  e.preventDefault();
  const label = btn.textContent;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    btn.textContent = L.copied;
    btn.dataset.done = '1';
  } catch {
    btn.textContent = L.failed;
  }
  setTimeout(() => { btn.textContent = label; delete btn.dataset.done; }, 1600);
});

// 导出：报告自己带着完整的 storyboard.json，下载的是它原样
document.querySelector('.expo').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const url = URL.createObjectURL(
    new Blob([document.getElementById('storyboard-data').textContent], { type: 'application/json' }),
  );
  const a = Object.assign(document.createElement('a'), { href: url, download: btn.dataset.name });
  a.click();
  // 别立刻回收——Safari 会抢在下载读完之前撤掉 blob
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
</script>
</body></html>`;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const USAGE = `novel-storyboard.mjs — novel-storyboard skill 的确定性工具（分镜）

  seed <script.json> [--eps 1-3] [--actions]  从剧本预填节拍工作底稿（打印到 stdout）
  validate <sb.json> --script <script.json>   校验；有违规逐条打印并 exit 1
           [--outline] [--cast] [--art]       outline/cast 查提示词人名；art 只管显示名字
           [--actions <summary.json>]         校验动作认领、首尾状态和事实投影
  checkup <sb.json> --script <script.json>    只打印质量门 ✓/✗，有未过项 exit 1
  render <sb.json> --script <script.json>     渲染报告到 stdout（默认 --md）
         [--html|--md] [--outline] [--art]    分镜图从 ./<段号>/f<切序>.png 找
         [--lang zh|en]                       报告界面语言（默认 zh；未指定时读取 JSON 顶层 lang 字段）
  export <sb.json> --script <script.json>     导出 H3 投产包：每段一个文件夹 <段号>/prompt.md
         [--out .]                            （分镜图 f1..fN.png 同住）+ 根部 manifest.json
  slug <name>                                 剧名转安全文件名`;

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

function flag(rest, name, fallback = null) {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback;
}

function loadCtx(rest) {
  const get = (name) => {
    const path = flag(rest, name);
    return path ? readJson(path) : null;
  };
  return { script: get('--script'), outline: get('--outline'), cast: get('--cast'), art: get('--art'), actions: get('--actions') };
}

function main(argv) {
  const [cmd, ...rest] = argv;

  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.log(USAGE);
    process.exit(cmd ? 0 : 1);
  }

  if (cmd === 'seed') {
    const [path] = rest;
    if (!path) throw new Error('用法：seed <script.json> [--eps 1-3]');
    const range = flag(rest, '--eps');
    let epRange = null;
    if (range) {
      const m = String(range).match(/^(\d+)-(\d+)$/) ?? String(range).match(/^(\d+)$/);
      if (!m) throw new Error('--eps 形如 3 或 1-6');
      epRange = m[2] ? [Number(m[1]), Number(m[2])] : [Number(m[1]), Number(m[1])];
    }
    const actionPath = flag(rest, '--actions');
    console.log(JSON.stringify(seedFromScript(readJson(path), epRange, actionPath ? readJson(actionPath) : null), null, 2));
    return;
  }

  if (cmd === 'validate' || cmd === 'checkup') {
    const [path] = rest;
    if (!path) throw new Error(`用法：${cmd} <storyboard.json> --script <script.json> [--outline] [--cast]`);
    const board = readJson(path);
    const ctx = loadCtx(rest);
    if (!ctx.script) throw new Error('分镜离开剧本没有意义——必须给 --script <script.json>');
    if (!ctx.outline && !ctx.cast) console.error('⚠️ 没给 --outline / --cast，跳过提示词人名检查');

    if (cmd === 'checkup') {
      const gates = gateReport(board, ctx);
      for (const g of gates) console.log(`${g.ok ? '✓' : '✗'} ${g.label}${!g.ok && g.detail ? ` — ${g.detail}` : ''}`);
      const failedN = gates.filter((g) => !g.ok).length;
      console.log(failedN ? `\n✗ ${failedN} 项未过` : '\n✓ 全部通过');
      if (failedN) process.exit(1);
      return;
    }

    const problems = validateStoryboard(board, ctx);
    if (problems.length) {
      console.error(`✗ ${problems.length} 处违规：\n`);
      for (const x of problems) console.error('  ' + x);
      process.exit(1);
    }
    const st = computeStats(board, ctx.script);
    console.log(`✓ ${st.episodes.length} 集 / ${st.totals.segments} 段 / ${st.totals.cuts} 个分镜全部通过校验（共 ${st.totals.seconds}s / 目标 ${st.totals.targetSeconds}s / ${st.batches.length} 个生成批次）`);
    return;
  }

  if (cmd === 'render') {
    const [path] = rest;
    if (!path) throw new Error('用法：render <storyboard.json> --script <script.json> [--html|--md] [--lang zh|en] [--outline] [--art]');
    const board = readJson(path);
    const ctx = loadCtx(rest);
    if (!ctx.script) throw new Error('分镜离开剧本没有意义——必须给 --script <script.json>');
    // 界面语言：--lang > JSON 顶层 lang 字段 > 'zh'（后两级在渲染器里兜底）
    const langFlag = flag(rest, '--lang');
    if (langFlag) ctx.lang = langFlag;
    ctx.imageExists = (rel) => existsSync(resolve(rel));
    process.stdout.write((rest.includes('--html') ? renderHtml(board, ctx) : renderMarkdown(board, ctx)) + '\n');
    return;
  }

  if (cmd === 'export') {
    const [path] = rest;
    if (!path) throw new Error('用法：export <storyboard.json> --script <script.json> [--out h3]');
    const board = readJson(path);
    const ctx = loadCtx(rest);
    if (!ctx.script) throw new Error('分镜离开剧本没有意义——必须给 --script <script.json>');
    const dir = flag(rest, '--out', '.');
    const pack = exportPack(board, ctx.script, { imageExists: (rel) => existsSync(resolve(rel)), dir });
    for (const f of pack.files) {
      mkdirSync(resolve(f.path, '..'), { recursive: true });
      writeFileSync(resolve(f.path), f.content, 'utf8');
    }
    const segN = pack.manifest.length;
    console.log(`✓ ${segN} 段投产包 → ${resolve(dir)}/（每段一个文件夹：分镜图 + prompt.md；根部 manifest.json）`);
    if (pack.missingTotal) console.log(`⚠️ 缺 ${pack.missingTotal} 张分镜图，已在 manifest 的 missing 里标注——喂 H3 前先补齐`);
    return;
  }

  if (cmd === 'slug') {
    if (!rest[0]) throw new Error('用法：slug <name>');
    console.log(slug(rest[0]));
    return;
  }

  throw new Error(`未知命令 ${cmd}\n\n${USAGE}`);
}

// 软链安装时 argv[1] 是链接路径，两边都取 realpath 才能比得上
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  // `render ... | head` 这类管道提前关闭时安静退出，别甩 EPIPE 堆栈
  process.stdout.on('error', (e) => {
    if (e.code === 'EPIPE') process.exit(0);
    throw e;
  });
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
