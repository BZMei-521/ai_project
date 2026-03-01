import type { Project, Sequence, Shot, ShotLayer, Asset, AudioTrack } from "./types";

const now = new Date().toISOString();

export const project: Project = {
  id: "proj_001",
  name: "Teaser Episode 01",
  fps: 24,
  width: 1920,
  height: 1080,
  createdAt: now,
  updatedAt: now
};

export const sequences: Sequence[] = [
  { id: "seq_001", projectId: project.id, name: "Opening", order: 1 }
];

export const shots: Shot[] = [
  {
    id: "shot_001",
    sequenceId: "seq_001",
    order: 1,
    title: "Wide Establishing",
    durationFrames: 48,
    dialogue: "",
    notes: "City skyline, slow pan",
    tags: ["opening"]
  },
  {
    id: "shot_002",
    sequenceId: "seq_001",
    order: 2,
    title: "Character Close-up",
    durationFrames: 36,
    dialogue: "We are late.",
    notes: "Hold for reaction",
    tags: ["dialogue"]
  }
];

export const layers: ShotLayer[] = [
  {
    id: "layer_001",
    shotId: "shot_001",
    name: "Sketch",
    visible: true,
    locked: false,
    zIndex: 1,
    bitmapPath: "shots/shot_001/layer-1.png"
  }
];

export const assets: Asset[] = [
  {
    id: "asset_001",
    projectId: project.id,
    type: "character",
    name: "Lead Character",
    filePath: "assets/characters/lead_front.png",
    characterFrontPath: "assets/characters/lead_front.png",
    characterSidePath: "assets/characters/lead_side.png",
    characterBackPath: "assets/characters/lead_back.png",
    voiceProfile: "young_female_calm"
  }
];

export const audioTracks: AudioTrack[] = [
  {
    id: "audio_001",
    projectId: project.id,
    filePath: "audio/temp-dialogue.wav",
    startFrame: 0,
    gain: 1,
    kind: "dialogue",
    label: "示例对白"
  }
];
