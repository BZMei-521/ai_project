import { readFile, writeFile } from "node:fs/promises";
import { parseShotScriptText } from "../src/features/script-director/shotScriptImportRuntime.mjs";

const [snapshotPath, projectPath, shotScriptPath, candidateSnapshotPath, candidateProjectPath] = process.argv.slice(2);

if (![snapshotPath, projectPath, shotScriptPath, candidateSnapshotPath, candidateProjectPath].every(Boolean)) {
  throw new Error("usage: node scripts/build-web-shot-import-candidate.mjs <snapshot> <project> <shot-script> <candidate-snapshot> <candidate-project>");
}

const snapshotText = await readFile(snapshotPath, "utf8");
const projectText = await readFile(projectPath, "utf8");
const shotScriptText = await readFile(shotScriptPath, "utf8");
const snapshot = JSON.parse(snapshotText);
const projectMetadata = JSON.parse(projectText);
const sequenceId = snapshot.currentSequenceId || snapshot.sequences?.[0]?.id;

if (!sequenceId) throw new Error("Web 快照没有当前序列");

const parsed = parseShotScriptText(shotScriptText, {
  fps: snapshot.project?.fps ?? 24,
  sequenceId
});

if (!parsed.ok) {
  throw new Error(`镜头脚本解析失败：${JSON.stringify(parsed.issues)}`);
}
if (parsed.value.shots.length !== 1) {
  throw new Error(`试验导入要求恰好 1 个镜头，实际 ${parsed.value.shots.length} 个`);
}

const removedShotIds = new Set(
  (snapshot.shots ?? []).filter((shot) => shot.sequenceId === sequenceId).map((shot) => shot.id)
);
const baseShots = (snapshot.shots ?? []).filter((shot) => shot.sequenceId !== sequenceId);
const baseLayers = (snapshot.layers ?? []).filter((layer) => !removedShotIds.has(layer.shotId));
const usedShotIds = new Set(baseShots.map((shot) => shot.id));
const usedLayerIds = new Set(baseLayers.map((layer) => layer.id));
const item = parsed.value.shots[0];

if (!/^[A-Za-z0-9_-]{1,80}$/.test(item.id)) throw new Error(`不安全的镜头 ID：${item.id}`);
if (usedShotIds.has(item.id)) throw new Error(`镜头 ID 与其他序列冲突：${item.id}`);

let layerId = `layer_${item.id}_1`;
let suffix = 2;
while (usedLayerIds.has(layerId)) layerId = `layer_${item.id}_${suffix++}`;

const shot = {
  id: item.id,
  sequenceId,
  order: 1,
  title: item.title.trim(),
  durationFrames: item.durationFrames,
  dialogue: item.dialogue?.trim() ?? "",
  notes: item.notes?.trim() ?? "",
  tags: item.tags ?? [],
  storyPrompt: item.prompt.trim(),
  negativePrompt: item.negativePrompt?.trim() ?? "",
  videoPrompt: item.videoPrompt?.trim() ?? "",
  videoMode: "auto",
  videoStartFramePath: "",
  videoEndFramePath: "",
  videoWorkflowProfileId: "auto",
  videoQualityTier: "production",
  videoAccelerationMode: "standard",
  videoBoundaryKind: "hard_cut",
  videoQualityStatus: "pending",
  skyboxFace: "auto",
  skyboxFaces: [],
  skyboxFaceWeights: {},
  characterRefs: [],
  sceneRefId: "",
  sourceCharacterNames: item.sourceCharacterNames ?? [],
  sourceSceneName: item.sourceSceneName ?? "",
  sourceScenePrompt: item.sourceScenePrompt ?? "",
  generatedImagePath: item.generatedImagePath?.trim() ?? "",
  generatedVideoPath: item.generatedVideoPath?.trim() ?? ""
};
const layer = {
  id: layerId,
  shotId: item.id,
  name: "图层 1",
  visible: true,
  locked: false,
  zIndex: 1,
  bitmapPath: `shots/${item.id}/${layerId}.png`
};

const withoutRemovedKeys = (record = {}) => Object.fromEntries(
  Object.entries(record).filter(([shotId]) => !removedShotIds.has(shotId))
);
const now = new Date().toISOString();
const candidate = {
  ...snapshot,
  project: { ...snapshot.project, updatedAt: now },
  shots: [...baseShots, shot],
  shotTransitions: [
    ...(snapshot.shotTransitions ?? []).filter((transition) => transition.sequenceId !== sequenceId),
    ...parsed.value.transitions
  ],
  layers: [...baseLayers, layer],
  shotStrokes: { ...withoutRemovedKeys(snapshot.shotStrokes), [item.id]: [] },
  shotHistory: { ...withoutRemovedKeys(snapshot.shotHistory), [item.id]: { past: [], future: [] } },
  shotSequenceHistory: { past: [], future: [] },
  activeLayerByShotId: { ...withoutRemovedKeys(snapshot.activeLayerByShotId), [item.id]: layerId },
  selectedShotId: item.id,
  selectedShotTransitionId: null,
  selectedShotIds: [item.id]
};
const candidateProject = {
  ...projectMetadata,
  projectId: candidate.project.id,
  name: candidate.project.name,
  fps: candidate.project.fps,
  resolution: { width: candidate.project.width, height: candidate.project.height },
  createdAt: candidate.project.createdAt,
  updatedAt: now
};

const currentSequenceShots = candidate.shots.filter((entry) => entry.sequenceId === sequenceId);
const currentSequenceLayers = candidate.layers.filter((entry) => entry.shotId === item.id);
const leakedOldIds = [...removedShotIds].filter((id) =>
  candidate.shots.some((entry) => entry.id === id) ||
  candidate.layers.some((entry) => entry.shotId === id) ||
  Object.hasOwn(candidate.shotStrokes, id) ||
  Object.hasOwn(candidate.shotHistory, id) ||
  Object.hasOwn(candidate.activeLayerByShotId, id)
);

if (currentSequenceShots.length !== 1 || currentSequenceShots[0].id !== "E01-01") throw new Error("候选快照的当前序列不是单镜头 E01-01");
if (shot.durationFrames !== 341) throw new Error(`候选镜头帧数错误：${shot.durationFrames}`);
if (shot.videoPrompt.length !== 2420) throw new Error(`候选视频提示词长度错误：${shot.videoPrompt.length}`);
if (currentSequenceLayers.length !== 1) throw new Error(`候选镜头图层数错误：${currentSequenceLayers.length}`);
if (leakedOldIds.length > 0) throw new Error(`旧镜头关联数据未清理：${leakedOldIds.join(",")}`);

await writeFile(candidateSnapshotPath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
await writeFile(candidateProjectPath, `${JSON.stringify(candidateProject, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  status: "PASS",
  sequenceId,
  removedShots: removedShotIds.size,
  importedShotId: shot.id,
  durationFrames: shot.durationFrames,
  videoPromptChars: shot.videoPrompt.length,
  dialogueLines: shot.dialogue.split(/\r?\n/).filter(Boolean).length,
  transitions: parsed.value.transitions.length,
  layerId,
  updatedAt: now
}));
