import { reconcileLinearTransitions } from "./shotTransitionRuntime.mjs";

const TRANSITION_TYPES = new Set(["continuous", "match_cut", "hard_cut", "scene_change"]);
const FRAME_DEPENDENCIES = new Set(["none", "previous_tail", "shared_frame"]);
const text = (value) => typeof value === "string" ? value.trim() : "";
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : undefined;

export function parseShotScriptText(source, context) {
  let parsed;
  try { parsed = JSON.parse(source); }
  catch { return { ok: false, issues: [{ code: "invalid_json", path: "$", message: "文件不是合法 JSON" }] }; }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.shots)) {
    return { ok: false, issues: [{ code: "shots_missing", path: "$.shots", message: "缺少 shots 数组" }] };
  }
  const fps = Math.max(1, Math.round(context.fps));
  const shots = parsed.shots.map((item, index) => {
    const id = text(item.id) || `shot_import_${String(index + 1).padStart(3, "0")}`;
    const title = text(item.title) || `镜头 ${index + 1}`;
    const durationSeconds = number(item.duration ?? item.duration_sec ?? item.durationSec);
    const frames = number(item.frames ?? item.durationFrames);
    return {
      id,
      title,
      prompt: text(item.prompt) || text(item.notes) || title,
      negativePrompt: text(item.negative_prompt ?? item.negativePrompt),
      videoPrompt: text(item.video_prompt ?? item.videoPrompt),
      durationFrames: Math.max(1, Math.round(frames ?? (durationSeconds ?? 2) * fps)),
      dialogue: text(item.dialogue),
      notes: text(item.notes),
      tags: Array.isArray(item.tags) ? item.tags.map(text).filter(Boolean) : [],
      sourceCharacterNames: Array.isArray(item.character_names ?? item.characterNames)
        ? (item.character_names ?? item.characterNames).map(text).filter(Boolean)
        : [],
      sourceSceneName: text(item.scene_name ?? item.sceneName),
      sourceScenePrompt: text(item.scene_prompt ?? item.scenePrompt),
      generatedImagePath: text(item.thumbnail ?? item.generatedImagePath),
      generatedVideoPath: text(item.generatedVideoPath)
    };
  });
  const ids = new Set();
  for (let index = 0; index < shots.length; index += 1) {
    if (ids.has(shots[index].id)) return { ok: false, issues: [{ code: "duplicate_shot_id", path: `$.shots[${index}].id`, message: `镜头 ID 重复：${shots[index].id}` }] };
    ids.add(shots[index].id);
  }
  const position = new Map(shots.map((shot, index) => [shot.id, index]));
  const transitions = [];
  const transitionPairs = new Set();
  for (let index = 0; index < (Array.isArray(parsed.transitions) ? parsed.transitions.length : 0); index += 1) {
    const item = parsed.transitions[index];
    const fromShotId = text(item.from ?? item.fromShotId);
    const toShotId = text(item.to ?? item.toShotId);
    if (!ids.has(fromShotId) || !ids.has(toShotId)) return { ok: false, issues: [{ code: "transition_shot_missing", path: `$.transitions[${index}]`, message: `${fromShotId} → ${toShotId} 引用了不存在的镜头` }] };
    if (position.get(toShotId) !== position.get(fromShotId) + 1) return { ok: false, issues: [{ code: "transition_not_adjacent", path: `$.transitions[${index}]`, message: `${fromShotId} → ${toShotId} 不是相邻镜头` }] };
    const transitionPair = `${fromShotId}\u0000${toShotId}`;
    if (transitionPairs.has(transitionPair)) return { ok: false, issues: [{ code: "duplicate_transition", path: `$.transitions[${index}]`, message: `${fromShotId} → ${toShotId} 存在重复转场` }] };
    transitionPairs.add(transitionPair);
    const type = text(item.type);
    if (!TRANSITION_TYPES.has(type)) return { ok: false, issues: [{ code: "transition_type_invalid", path: `$.transitions[${index}].type`, message: `不支持的转场类型：${type}` }] };
    const requestedFrameDependency = text(item.frameDependency);
    if (requestedFrameDependency && !FRAME_DEPENDENCIES.has(requestedFrameDependency)) return { ok: false, issues: [{ code: "frame_dependency_invalid", path: `$.transitions[${index}].frameDependency`, message: `不支持的首尾帧依赖：${requestedFrameDependency}` }] };
    const frameDependency = FRAME_DEPENDENCIES.has(requestedFrameDependency)
      ? requestedFrameDependency
      : type === "continuous" ? "previous_tail" : "none";
    const ceiling = Math.min(shots[position.get(fromShotId)].durationFrames, shots[position.get(toShotId)].durationFrames) / fps;
    const rawDuration = item.duration ?? item.durationSeconds;
    const parsedDuration = number(rawDuration);
    if (rawDuration !== undefined && (parsedDuration === undefined || parsedDuration < 0)) return { ok: false, issues: [{ code: "transition_duration_invalid", path: `$.transitions[${index}].duration`, message: "转场时长必须是大于或等于零的有限秒数" }] };
    const requestedDuration = parsedDuration ?? (type === "hard_cut" ? 0 : 0.6);
    transitions.push({
      id: text(item.id) || `shot-transition:${encodeURIComponent(fromShotId)}:${encodeURIComponent(toShotId)}`,
      sequenceId: context.sequenceId,
      fromShotId,
      toShotId,
      type,
      durationSeconds: type === "hard_cut" ? 0 : Math.min(Math.max(0, requestedDuration), ceiling),
      frameDependency,
      sharedFramePath: text(item.sharedFramePath) || undefined,
      actionContinuity: text(item.actionContinuity),
      characterPosition: text(item.characterPosition),
      cameraDirection: text(item.cameraDirection),
      notes: text(item.notes)
    });
  }
  const orderedShots = shots.map((shot) => ({ id: shot.id, durationSeconds: shot.durationFrames / fps }));
  return {
    ok: true,
    value: {
      projectTitle: text(parsed.project?.title),
      shots,
      transitions: reconcileLinearTransitions({
        sequenceId: context.sequenceId,
        orderedShots,
        existingTransitions: transitions
      })
    }
  };
}
