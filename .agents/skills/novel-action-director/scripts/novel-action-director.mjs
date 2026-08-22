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
