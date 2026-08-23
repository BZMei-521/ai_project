export const BOUNDARY_TYPES = ['continuous', 'match_cut', 'hard_cut', 'scene_change'];
export const EDIT_METHODS = [
  'occlusion-bridge',
  'motion-bridge',
  'action-match',
  'visual-match',
  'time-space-jump',
  'emotion-audio-trigger',
];

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

export function seedFromStoryboard(storyboard) {
  const groups = authoredGroups(storyboard);
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
        bridge: {
          visual: '',
          audio: '',
          duration: 0,
          execution: 'hard-cut',
        },
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

  return {
    source: storyboard.source ?? '',
    version: 1,
    boundaries,
  };
}
