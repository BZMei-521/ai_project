import { resolve } from "node:path";

const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;

export function buildSegmentShotScript({
  board,
  script,
  outline,
  segmentId,
  frameDirectory,
  frameExists = () => true
}) {
  const episode = board?.episodes?.find((item) =>
    item?.segments?.some((segment) => segment?.id === segmentId)
  );
  const segment = episode?.segments?.find((item) => item?.id === segmentId);
  if (!segment) throw new Error(`segment not found: ${segmentId}`);
  if (!Array.isArray(segment.cuts) || segment.cuts.length === 0) {
    throw new Error(`segment has no cuts: ${segmentId}`);
  }
  if (!nonEmpty(segment.h3Prompt)) throw new Error(`segment has no h3Prompt: ${segmentId}`);
  if (!nonEmpty(segment.cuts[0]?.frame)) throw new Error(`segment first cut has no frame: ${segmentId}`);

  const duration = Number(
    segment.cuts.reduce((sum, cut) => sum + Number(cut?.seconds), 0).toFixed(3)
  );
  if (!(duration > 0)) throw new Error(`segment duration is invalid: ${segmentId}`);

  const characterNames = new Map(
    (outline?.characters ?? []).map((item) => [item.id, item.name])
  );
  const sceneNames = new Map(
    (outline?.scenes ?? []).map((item) => [item.id, item.name])
  );
  const scriptEpisode = script?.episodes?.find((item) => item?.ep === episode.ep);
  const scriptScene = scriptEpisode?.scenes?.[segment.sceneIndex - 1];
  const sceneName = sceneNames.get(scriptScene?.sceneId) ?? `Scene ${segment.sceneIndex}`;
  const frames = segment.cuts.map((_, index) => resolve(frameDirectory, `f${index + 1}.png`));
  if (!frameExists(frames[0])) throw new Error(`segment first frame is missing: ${frames[0]}`);

  const dialogue = [];
  for (const cut of segment.cuts) {
    const [firstBeat, lastBeat] = cut.beats ?? [];
    for (let beat = firstBeat; beat <= lastBeat; beat += 1) {
      const item = scriptScene?.flow?.[beat - 1];
      if (!nonEmpty(item?.line)) continue;
      const speaker = item.speaker === "VO"
        ? "旁白"
        : characterNames.get(item.speaker) ?? item.speaker;
      dialogue.push(`${speaker}：${item.line}`);
    }
  }

  const visibleNames = [
    ...new Set(
      segment.cuts
        .flatMap((cut) => cut.characters ?? [])
        .map((id) => characterNames.get(id) ?? id)
    )
  ];
  const notes = [
    `Segment ${segmentId}; episode ${episode.ep}; scene ${segment.sceneIndex}; ${segment.cuts.length} cuts; ${duration}s`,
    ...segment.cuts.map((cut, index) => {
      const [firstBeat, lastBeat] = cut.beats ?? [];
      const missing = frameExists(frames[index]) ? "" : " [missing]";
      const startAnchor = cut.startBoundary?.spatialAnchor ?? "";
      const endAnchor = cut.endBoundary?.spatialAnchor ?? "";
      return `Cut ${index + 1}: ${cut.seconds}s | ${cut.size} | ${cut.camera} | beats ${firstBeat}-${lastBeat} | frame ${frames[index]}${missing} | ${startAnchor} -> ${endAnchor}`;
    })
  ].join("\n");

  return {
    project: { title: `${board.source} · ${segmentId} 导入试验` },
    shots: [
      {
        id: segmentId,
        title: `第${episode.ep}集 · ${segmentId} · ${sceneName}`,
        duration,
        prompt: segment.cuts[0].frame,
        video_prompt: segment.h3Prompt,
        dialogue: dialogue.join("\n"),
        notes,
        character_names: visibleNames,
        scene_name: sceneName,
        scene_prompt: segment.cuts[0].frame,
        thumbnail: frames[0],
        tags: [
          `episode-${String(episode.ep).padStart(2, "0")}`,
          `segment-${segmentId}`,
          "h3-multicut",
          "pilot-import"
        ]
      }
    ],
    transitions: []
  };
}
