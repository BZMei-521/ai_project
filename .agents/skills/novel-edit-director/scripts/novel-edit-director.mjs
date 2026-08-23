import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BOUNDARY_TYPES = ['continuous', 'match_cut', 'hard_cut', 'scene_change'];
export const EDIT_METHODS = [
  'occlusion-bridge',
  'motion-bridge',
  'action-match',
  'visual-match',
  'time-space-jump',
  'emotion-audio-trigger',
];

const FRAME_DEPENDENCIES = ['none', 'previous_tail', 'shared_frame'];
const RISKY_MORPHS = ['年龄连续变化', '城市生长', '时代连续变形', '跨世界一镜到底', '四季连续变形'];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value;
}

function segmentDuration(segment) {
  return (Array.isArray(segment.cuts) ? segment.cuts : [])
    .reduce((total, cut) => total + (Number.isFinite(cut?.seconds) ? cut.seconds : 0), 0);
}

function boundaryFacts(segment, edge) {
  const cuts = Array.isArray(segment.cuts) ? segment.cuts : [];
  const cut = edge === 'start' ? cuts[0] : cuts.at(-1);
  const facts = edge === 'start' ? cut?.startBoundary : cut?.endBoundary;
  return {
    segmentId: segment.id,
    sceneIndex: segment.sceneIndex,
    duration: segmentDuration(segment),
    characters: clone(cut?.characters ?? []),
    cameraDirection: cut?.cameraDirection ?? '',
    boundary: clone(facts ?? {}),
  };
}

function authoredGroups(storyboard) {
  requireObject(storyboard, 'storyboard');
  if (!Array.isArray(storyboard.episodes)) throw new Error('storyboard.episodes 必须是数组');

  const seen = new Set();
  const episodeGroups = storyboard.episodes.map((episode, episodeIndex) => {
    if (!Array.isArray(episode?.segments)) throw new Error(`episodes[${episodeIndex}].segments 必须是数组`);
    return episode.segments.map((segment, segmentIndex) => {
      requireObject(segment, `episodes[${episodeIndex}].segments[${segmentIndex}]`);
      if (!segment.id || typeof segment.id !== 'string') throw new Error('每个 segment 必须有字符串 id');
      if (seen.has(segment.id)) throw new Error(`重复 segment id: ${segment.id}`);
      seen.add(segment.id);
      return segment;
    });
  });

  return storyboard.continuousAcrossEpisodes
    ? [episodeGroups.flat()]
    : episodeGroups;
}

function contextFromStoryboard(storyboard) {
  const groups = authoredGroups(storyboard);
  const segments = new Map();
  const expectedPairs = [];
  for (const group of groups) {
    for (const segment of group) segments.set(segment.id, segment);
    for (let index = 0; index < group.length - 1; index += 1) {
      expectedPairs.push([group[index].id, group[index + 1].id]);
    }
  }
  return { groups, segments, expectedPairs };
}

export function seedFromStoryboard(storyboard) {
  const { groups } = contextFromStoryboard(storyboard);
  const boundaries = [];

  for (const segments of groups) {
    for (let index = 0; index < segments.length - 1; index += 1) {
      const outgoing = segments[index];
      const incoming = segments[index + 1];
      boundaries.push({
        from: outgoing.id,
        to: incoming.id,
        purpose: '',
        type: 'hard_cut',
        method: null,
        outgoingAnchor: '',
        incomingAnchor: '',
        bridge: { visual: '', audio: '', duration: 0, execution: 'hard-cut' },
        mustMatch: [],
        intentionalChange: [],
        frameDependency: 'none',
        actionContinuity: '',
        characterPosition: '',
        cameraDirection: '',
        outgoingFacts: boundaryFacts(outgoing, 'end'),
        incomingFacts: boundaryFacts(incoming, 'start'),
      });
    }
  }

  return { source: storyboard.source ?? '', version: 1, boundaries };
}

function gate(id, details) {
  return { id, ok: details.length === 0, details };
}

function boundaryList(edit) {
  return Array.isArray(edit?.boundaries) ? edit.boundaries : [];
}

function pairKey(from, to) {
  return `${from}\u0000${to}`;
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sameJson(left, right) {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

function compatibleMethod(type, method, intentionalChange) {
  const changes = Array.isArray(intentionalChange) ? intentionalChange : [];
  if (method != null && !EDIT_METHODS.includes(method)) return false;
  if (type === 'hard_cut') return method == null || ['time-space-jump', 'emotion-audio-trigger'].includes(method);
  if (type === 'continuous') {
    if (changes.some((item) => ['sceneIndex', 'time', 'era', 'world'].includes(item))) return false;
    return ['occlusion-bridge', 'motion-bridge', 'emotion-audio-trigger'].includes(method);
  }
  if (type === 'match_cut') {
    return ['occlusion-bridge', 'motion-bridge', 'action-match', 'visual-match', 'emotion-audio-trigger'].includes(method);
  }
  if (type === 'scene_change') {
    return ['occlusion-bridge', 'visual-match', 'time-space-jump', 'emotion-audio-trigger'].includes(method);
  }
  return false;
}

function continuityIssues(boundary, segments) {
  if (boundary.type !== 'continuous') return [];
  const outgoing = segments.get(boundary.from);
  const incoming = segments.get(boundary.to);
  if (!outgoing || !incoming) return [];
  const actualOut = boundaryFacts(outgoing, 'end').boundary;
  const actualIn = boundaryFacts(incoming, 'start').boundary;
  const details = [];
  if (!sameJson(boundary.outgoingFacts?.boundary, actualOut)) details.push(`${boundary.from} outgoingFacts 与 storyboard 不一致`);
  if (!sameJson(boundary.incomingFacts?.boundary, actualIn)) details.push(`${boundary.to} incomingFacts 与 storyboard 不一致`);
  const allowed = new Set(Array.isArray(boundary.intentionalChange) ? boundary.intentionalChange : []);
  for (const key of new Set([...Object.keys(actualOut), ...Object.keys(actualIn)])) {
    if (!sameJson(actualOut[key], actualIn[key]) && !allowed.has(key)) {
      details.push(`${boundary.from}->${boundary.to} 的 ${key} 不连续且未声明变化`);
    }
  }
  return details;
}

export function gateReport(edit, { storyboard } = {}) {
  requireObject(edit, 'edit');
  const boundaries = boundaryList(edit);
  const { segments, expectedPairs } = contextFromStoryboard(storyboard);
  const expected = new Set(expectedPairs.map(([from, to]) => pairKey(from, to)));

  const sourceReference = [];
  const adjacency = [];
  for (const boundary of boundaries) {
    if (!segments.has(boundary?.from)) sourceReference.push(`未知 from segment: ${boundary?.from}`);
    if (!segments.has(boundary?.to)) sourceReference.push(`未知 to segment: ${boundary?.to}`);
    if (!expected.has(pairKey(boundary?.from, boundary?.to))) adjacency.push(`非相邻边界: ${boundary?.from}->${boundary?.to}`);
  }

  const coverage = [];
  const counts = new Map();
  for (const boundary of boundaries) {
    const key = pairKey(boundary?.from, boundary?.to);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [from, to] of expectedPairs) {
    const count = counts.get(pairKey(from, to)) ?? 0;
    if (count !== 1) coverage.push(`${from}->${to} 应有 1 条，实际 ${count} 条`);
  }
  for (const [key, count] of counts) {
    if (!expected.has(key) && count > 0) coverage.push(`存在非计划边界 ${key.replace('\u0000', '->')}`);
  }

  const typeIssues = boundaries
    .filter((item) => !BOUNDARY_TYPES.includes(item?.type))
    .map((item) => `${item?.from}->${item?.to} type=${item?.type}`);

  const methodIssues = boundaries
    .filter((item) => BOUNDARY_TYPES.includes(item?.type) && !compatibleMethod(item.type, item.method, item.intentionalChange))
    .map((item) => `${item.from}->${item.to} 的 ${item.type}/${item.method} 不兼容`);

  const anchorIssues = [];
  for (const item of boundaries) {
    if (['action-match', 'visual-match', 'motion-bridge'].includes(item?.method)
      && (!nonempty(item.outgoingAnchor) || !nonempty(item.incomingAnchor))) {
      anchorIssues.push(`${item.from}->${item.to} 缺少双端锚点`);
    }
    if (item?.method === 'emotion-audio-trigger'
      && (!nonempty(item.bridge?.trigger) || !nonempty(item.bridge?.audio) || !nonempty(item.bridge?.audioSource))) {
      anchorIssues.push(`${item.from}->${item.to} 缺少情绪触发或声音来源`);
    }
  }

  const continuity = boundaries.flatMap((item) => continuityIssues(item, segments));

  const occlusion = boundaries
    .filter((item) => item?.method === 'occlusion-bridge')
    .filter((item) => !nonempty(item.bridge?.occlusion?.occluder)
      || !nonempty(item.bridge?.occlusion?.entryDirection)
      || !nonempty(item.bridge?.occlusion?.exitDirection))
    .map((item) => `${item.from}->${item.to} 缺少遮挡物进入/退出方向`);

  const authorizedAudio = new Set([
    ...(Array.isArray(storyboard.audioCues) ? storyboard.audioCues : []),
    ...(Array.isArray(storyboard.directorPlan?.audioCues) ? storyboard.directorPlan.audioCues : []),
  ]);
  const audio = boundaries
    .filter((item) => nonempty(item?.bridge?.audio) && !authorizedAudio.has(item.bridge.audio))
    .map((item) => `${item.from}->${item.to} 未授权声音: ${item.bridge.audio}`);

  const durations = [];
  for (const item of boundaries) {
    const duration = item?.bridge?.duration;
    const outgoing = segments.get(item?.from);
    const incoming = segments.get(item?.to);
    const maximum = outgoing && incoming ? Math.min(segmentDuration(outgoing), segmentDuration(incoming)) : 0;
    if (!Number.isFinite(duration) || duration < 0 || (outgoing && incoming && duration > maximum)) {
      durations.push(`${item?.from}->${item?.to} duration=${duration} 超界`);
    }
  }

  const morphs = [];
  for (const item of boundaries) {
    const text = `${item?.purpose ?? ''} ${item?.bridge?.visual ?? ''}`;
    const risky = RISKY_MORPHS.find((phrase) => text.includes(phrase));
    if (risky && (item.type === 'continuous' || !Array.isArray(item.stableEndpointAssets) || item.stableEndpointAssets.length < 2)) {
      morphs.push(`${item.from}->${item.to} 的 ${risky} 必须拆为稳定端点剪辑`);
    }
  }

  const workbench = [];
  for (const item of boundaries) {
    if (!FRAME_DEPENDENCIES.includes(item?.frameDependency)) {
      workbench.push(`${item?.from}->${item?.to} frameDependency=${item?.frameDependency}`);
    }
    if (item?.type === 'hard_cut' && item?.bridge?.duration !== 0) {
      workbench.push(`${item.from}->${item.to} hard_cut duration 必须为 0`);
    }
  }

  return [
    gate('source-reference', sourceReference),
    gate('adjacent-boundary', adjacency),
    gate('one-boundary-per-pair', coverage),
    gate('boundary-type', typeIssues),
    gate('method-compatibility', methodIssues),
    gate('anchor-complete', anchorIssues),
    gate('continuity-evidence', continuity),
    gate('occlusion-direction', occlusion),
    gate('audio-authority', audio),
    gate('duration-bounds', durations),
    gate('risky-morph-routing', morphs),
    gate('workbench-compat', workbench),
  ];
}

export function validateEdit(edit, storyboard) {
  const failed = gateReport(edit, { storyboard }).filter((item) => !item.ok);
  if (failed.length) {
    const detail = failed.map((item) => `${item.id}: ${item.details.join('; ')}`).join('\n');
    throw new Error(`edit.json 未通过门禁:\n${detail}`);
  }
  return true;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildWorkbenchTransitions(edit, storyboard, sequenceId = 'default') {
  validateEdit(edit, storyboard);
  return edit.boundaries.map((boundary) => {
    const extension = {
      method: boundary.method,
      outgoingAnchor: boundary.outgoingAnchor,
      incomingAnchor: boundary.incomingAnchor,
      execution: boundary.bridge?.execution ?? '',
      intentionalChange: boundary.intentionalChange ?? [],
      visualBridge: boundary.bridge?.visual ?? '',
      audioBridge: boundary.bridge?.audio ?? '',
    };
    return {
      sequenceId,
      fromShotId: boundary.from,
      toShotId: boundary.to,
      type: boundary.type,
      durationSeconds: boundary.bridge.duration,
      frameDependency: boundary.frameDependency,
      actionContinuity: boundary.actionContinuity ?? '',
      characterPosition: boundary.characterPosition ?? '',
      cameraDirection: boundary.cameraDirection ?? '',
      notes: `edit-director:v1 ${JSON.stringify(extension)}`,
    };
  });
}

export function renderMarkdown(edit, storyboard) {
  validateEdit(edit, storyboard);
  const report = gateReport(edit, { storyboard });
  const lines = [
    '# 剪辑边界计划',
    '',
    `来源：${edit.source || storyboard.source || ''}`,
    '',
  ];
  for (const boundary of edit.boundaries) {
    lines.push(
      `## ${boundary.from} → ${boundary.to}`,
      '',
      `- 目的：${boundary.purpose}`,
      `- 类型 / 方法：${boundary.type} / ${boundary.method ?? 'none'}`,
      `- 出/入锚点：${boundary.outgoingAnchor || '无'} → ${boundary.incomingAnchor || '无'}`,
      `- 视觉桥：${boundary.bridge?.visual || '无'}`,
      `- 声音桥：${boundary.bridge?.audio || '无'}`,
      `- 时长 / 执行：${boundary.bridge?.duration ?? 0}s / ${boundary.bridge?.execution || '无'}`,
      `- 必须匹配：${(boundary.mustMatch ?? []).join('、') || '无'}`,
      `- 有意变化：${(boundary.intentionalChange ?? []).join('、') || '无'}`,
      `- 连续性：${boundary.actionContinuity || '无'}；${boundary.characterPosition || '无'}；${boundary.cameraDirection || '无'}`,
      '',
    );
  }
  lines.push('## 12 项门禁', '');
  for (const item of report) {
    lines.push(`- ${item.ok ? 'PASS' : 'FAIL'} ${item.id}${item.details.length ? `：${item.details.join('；')}` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderHtml(edit, storyboard) {
  validateEdit(edit, storyboard);
  const report = gateReport(edit, { storyboard });
  const sections = edit.boundaries.map((boundary) => `
    <section>
      <h2>${escapeHtml(boundary.from)} → ${escapeHtml(boundary.to)}</h2>
      <dl>
        <dt>目的</dt><dd>${escapeHtml(boundary.purpose)}</dd>
        <dt>类型 / 方法</dt><dd>${escapeHtml(boundary.type)} / ${escapeHtml(boundary.method ?? 'none')}</dd>
        <dt>出/入锚点</dt><dd>${escapeHtml(boundary.outgoingAnchor || '无')} → ${escapeHtml(boundary.incomingAnchor || '无')}</dd>
        <dt>视觉桥</dt><dd>${escapeHtml(boundary.bridge?.visual || '无')}</dd>
        <dt>声音桥</dt><dd>${escapeHtml(boundary.bridge?.audio || '无')}</dd>
        <dt>时长 / 执行</dt><dd>${escapeHtml(boundary.bridge?.duration ?? 0)}s / ${escapeHtml(boundary.bridge?.execution || '无')}</dd>
        <dt>必须匹配</dt><dd>${escapeHtml((boundary.mustMatch ?? []).join('、') || '无')}</dd>
        <dt>有意变化</dt><dd>${escapeHtml((boundary.intentionalChange ?? []).join('、') || '无')}</dd>
      </dl>
    </section>`).join('');
  const gates = report.map((item) => `<li class="${item.ok ? 'pass' : 'fail'}">${item.ok ? 'PASS' : 'FAIL'} ${escapeHtml(item.id)}${item.details.length ? `：${escapeHtml(item.details.join('；'))}` : ''}</li>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>剪辑边界计划</title></head><body><main><h1>剪辑边界计划</h1>${sections}<section><h2>12 项门禁</h2><ul>${gates}</ul></section></main></body></html>\n`;
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readJson(path, io) {
  if (!path) throw new Error('缺少 JSON 路径');
  return JSON.parse(io.readFileSync(path, 'utf8'));
}

export async function runCli(args, io = { readFileSync, writeFileSync, stdout: process.stdout, stderr: process.stderr }) {
  const out = (text) => io.stdout.write(`${text}\n`);
  try {
    const [command, inputPath] = args;
    if (!command) throw new Error('用法: seed|validate|render|export ...');
    if (command === 'seed') {
      out(JSON.stringify(seedFromStoryboard(readJson(inputPath, io)), null, 2));
    } else if (command === 'validate') {
      const edit = readJson(inputPath, io);
      const storyboard = readJson(option(args, '--storyboard'), io);
      validateEdit(edit, storyboard);
      out('✓ 通过 12 项剪辑门禁');
    } else if (command === 'render') {
      const edit = readJson(inputPath, io);
      const storyboard = readJson(option(args, '--storyboard'), io);
      if (!args.includes('--md') && !args.includes('--html')) throw new Error('render 必须指定 --md 或 --html');
      out(args.includes('--html') ? renderHtml(edit, storyboard) : renderMarkdown(edit, storyboard));
    } else if (command === 'export') {
      const edit = readJson(inputPath, io);
      const storyboard = readJson(option(args, '--storyboard'), io);
      const sequence = option(args, '--sequence');
      const outputPath = option(args, '--out');
      if (!sequence || !outputPath) throw new Error('export 必须指定 --sequence 和 --out');
      io.writeFileSync(outputPath, `${JSON.stringify(buildWorkbenchTransitions(edit, storyboard, sequence), null, 2)}\n`, 'utf8');
      out(`✓ 已导出 ${outputPath}`);
    } else {
      throw new Error(`未知命令: ${command}`);
    }
    return 0;
  } catch (error) {
    io.stderr.write(`错误: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await runCli(process.argv.slice(2), { readFileSync, writeFileSync, stdout: process.stdout, stderr: process.stderr });
  process.exitCode = code;
}
