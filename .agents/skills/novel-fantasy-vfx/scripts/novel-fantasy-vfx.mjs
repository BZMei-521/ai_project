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

export function gateReport() { return []; }
export function validateEffects() { return []; }
export function buildStoryboardSummary() { return { source: '', effects: {} }; }
export function renderMarkdown() { return ''; }
export function renderHtml() { return ''; }
export async function runCli() { return 0; }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await runCli(process.argv.slice(2), { readFileSync, writeFileSync, stdout: process.stdout, stderr: process.stderr });
  process.exitCode = code;
}
