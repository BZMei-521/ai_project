import assert from 'node:assert/strict';
import {
  ACTION_KINDS,
  PHYSICS_PROFILES,
  expandScript,
  parseEpisodeRange,
  seedFromScript,
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

console.log(`✓ ${assertions} 项自测全部通过`);
