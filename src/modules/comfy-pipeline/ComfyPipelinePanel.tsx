import { useEffect, useMemo, useRef, useState } from "react";
import { selectShotStartFrame, useStoryboardStore } from "../storyboard-core/store";
import type { Asset, Shot } from "../storyboard-core/types";
import { pushToast } from "../ui/toastStore";
import { invokeDesktopCommand, isWebBridgeRuntime, toDesktopMediaSource } from "../platform/desktopBridge";
import {
  checkComfyModelHealth,
  concatShotVideos,
  defaultVideoGenerationMode,
  discoverComfyLocalDirs,
  discoverComfyEndpoints,
  DEFAULT_TOKEN_MAPPING,
  extractLocalMotionPresetFromText,
  generateShotAsset,
  inferComfyRootDir,
  installSuggestedPlugins,
  inspectWorkflowDependencies,
  pingComfyWithDetail,
  stripLocalMotionPresetToken,
  validateWorkflowJsonSyntax,
  validateWorkflowTemplate,
  type ComfySettings,
  type LocalMotionPreset,
  type WorkflowDependencyHint
} from "./comfyService";
import FISHER_WORKFLOW_OBJECT from "./presets/fisher-nextscene-v1.json";

const FISHER_WORKFLOW_JSON = JSON.stringify(FISHER_WORKFLOW_OBJECT);
const loadExportService = () => import("../export-service/animaticExport");

type GenerationPhase = "idle" | "running";
type AssetStatus = "idle" | "running" | "success" | "failed";
type PipelineLogLevel = "info" | "error";

type PipelineLogItem = {
  id: number;
  timestamp: string;
  level: PipelineLogLevel;
  message: string;
};

type SoundCueKind = "ambience" | "character" | "prop";
type SoundCueSpec = {
  kind: SoundCueKind;
  prompt: string;
  gain: number;
};

type DialogueSegment = {
  speaker: string;
  text: string;
  voiceProfile: string;
  emotion: string;
  deliveryStyle: string;
  speechRate: string;
};

type ParsedScriptShot = {
  id: string;
  title: string;
  prompt: string;
  negative_prompt: string;
  video_prompt: string;
  video_mode: "auto" | "single_frame" | "first_last_frame";
  duration_sec: number;
  dialogue: string;
  notes: string;
  tags: string[];
};

const SETTINGS_KEY = "storyboard-pro/comfy-settings/v1";
const LOCAL_MOTION_PRESET_OPTIONS: Array<{ value: LocalMotionPreset; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "still", label: "静帧" },
  { value: "fade", label: "淡入淡出" },
  { value: "push_in", label: "推近" },
  { value: "push_out", label: "推远" },
  { value: "pan_left", label: "左移" },
  { value: "pan_right", label: "右移" }
];

function normalizeStoryInput(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/\u3000/g, " ").trim();
}

function splitStorySentences(raw: string): string[] {
  return normalizeStoryInput(raw)
    .split(/(?<=[。！？!?；;])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function splitStoryBlocks(raw: string): Array<{ heading: string; body: string }> {
  const text = normalizeStoryInput(raw);
  if (!text) return [];
  const lines = text.split("\n").map((line) => line.trim());
  const headingPattern = /^(?:镜头|shot|scene|场景)\s*[\d一二三四五六七八九十]*[:：.\-、\s]*/i;
  const numberedPattern = /^\d+\s*[.)、．]\s*/;
  const blocks: Array<{ heading: string; body: string }> = [];
  let currentHeading = "";
  let currentLines: string[] = [];

  const flush = () => {
    const body = currentLines.join("\n").trim();
    if (!body) return;
    blocks.push({ heading: currentHeading.trim(), body });
    currentHeading = "";
    currentLines = [];
  };

  for (const line of lines) {
    if (!line) {
      if (currentLines.length > 0) {
        currentLines.push("");
      } else {
        flush();
      }
      continue;
    }
    const isHeading = headingPattern.test(line) || numberedPattern.test(line);
    if (isHeading && currentLines.length > 0) {
      flush();
    }
    if (isHeading) {
      currentHeading = line.replace(headingPattern, "").replace(numberedPattern, "").trim();
      continue;
    }
    currentLines.push(line);
  }
  flush();

  const nonEmpty = blocks.filter((item) => item.body.trim().length > 0);
  if (nonEmpty.length > 1) return nonEmpty;

  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (paragraphs.length > 1) {
    return paragraphs.map((body, index) => ({ heading: `段落 ${index + 1}`, body }));
  }

  const sentences = splitStorySentences(text);
  if (sentences.length <= 3) return [{ heading: "段落 1", body: text }];

  const grouped: Array<{ heading: string; body: string }> = [];
  for (let index = 0; index < sentences.length; index += 3) {
    grouped.push({
      heading: `段落 ${grouped.length + 1}`,
      body: sentences.slice(index, index + 3).join("")
    });
  }
  return grouped;
}

function extractDialogueLines(raw: string): string[] {
  return normalizeStoryInput(raw)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /[:：]/.test(line) || /[“"].+[”"]/.test(line));
}

function stripDialogueLines(raw: string): string {
  return normalizeStoryInput(raw)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/[:：]/.test(line))
    .join(" ");
}

function inferShotScale(text: string, index: number, total: number): string {
  if (/特写|细节|表情|眼神|手部|嘴角|指尖/.test(text)) return "特写";
  if (/远处|全貌|整体|街道|建筑|河边|天空|外景/.test(text)) return "大全景";
  if (/对话|交谈|面对面|并肩|两人|多人/.test(text)) return "中景";
  if (index === 0 && total > 1) return "建立镜头";
  if (index === total - 1 && total > 1) return "近景收束";
  return "中近景";
}

function inferShotTitle(text: string, heading: string, index: number, total: number): string {
  if (heading && heading !== `段落 ${index + 1}`) return heading;
  if (/对话|说道|问道|回答|看着.*说|[:：]/.test(text)) return total > 1 && index === 0 ? "对话开场" : "对话推进";
  if (/走|跑|转身|打开|进入|离开|抬手|放下|靠近|远离/.test(text)) return total > 1 && index === 0 ? "动作起势" : "动作推进";
  if (index === 0) return "开场建立";
  if (index === total - 1) return "情绪收束";
  return `叙事镜头 ${index + 1}`;
}

function inferShotTags(text: string, dialogue: string): string[] {
  const tags = new Set<string>();
  if (/夜|黑夜|凌晨|月光/.test(text)) tags.add("夜景");
  if (/清晨|早晨|黎明|日出/.test(text)) tags.add("晨景");
  if (/室内|房间|客厅|门厅|走廊|楼梯/.test(text)) tags.add("室内");
  if (/街道|河边|庭院|广场|外景|天空/.test(text)) tags.add("外景");
  if (dialogue.trim()) tags.add("对白");
  if (/走|跑|转身|推门|开门|抬手|进入|离开/.test(text)) tags.add("动作");
  return [...tags];
}

function inferDurationSec(text: string, dialogue: string): number {
  const length = text.length + dialogue.length;
  if (dialogue.trim()) return Math.min(6, Math.max(3, Math.round(length / 28)));
  if (length <= 40) return 2;
  if (length <= 90) return 3;
  if (length <= 160) return 4;
  return 5;
}

function chunkNarrationForShots(text: string, dialogue: string): string[] {
  const narration = stripDialogueLines(text) || normalizeStoryInput(text);
  const sentences = splitStorySentences(narration);
  if (sentences.length <= 2 || dialogue.trim()) {
    return [narration.trim()];
  }
  const chunkSize = sentences.length >= 6 ? 3 : 2;
  const chunks: string[] = [];
  for (let index = 0; index < sentences.length; index += chunkSize) {
    chunks.push(sentences.slice(index, index + chunkSize).join(""));
  }
  return chunks.filter((item) => item.trim().length > 0);
}

function buildStoryShotPrompt(text: string, scale: string): string {
  const clean = normalizeStoryInput(text).replace(/\n+/g, " ").trim();
  return `${clean}。电影分镜，${scale}，主体明确，环境连续，镜头语言清晰，光影自然，构图稳定。`;
}

function buildStoryVideoPrompt(text: string): string {
  if (/走|跑|转身|抬手|放下|靠近|远离|打开|进入|离开/.test(text)) {
    return `${normalizeStoryInput(text)}。主体产生连续动作，镜头保持平稳推进。`;
  }
  return `${normalizeStoryInput(text)}。主体有轻微呼吸感动作，镜头稳定。`;
}

function parseStoryToShotScript(raw: string): { shots: ParsedScriptShot[] } {
  const blocks = splitStoryBlocks(raw);
  if (blocks.length === 0) {
    throw new Error("故事内容为空");
  }
  const shots: ParsedScriptShot[] = [];
  let shotIndex = 1;
  for (const block of blocks) {
    const dialogue = extractDialogueLines(block.body).join("\n");
    const chunks = chunkNarrationForShots(block.body, dialogue);
    chunks.forEach((chunk, chunkIndex) => {
      const scale = inferShotScale(chunk, chunkIndex, chunks.length);
      const title = inferShotTitle(chunk, block.heading, chunkIndex, chunks.length);
      const prompt = buildStoryShotPrompt(chunk, scale);
      const videoPrompt = buildStoryVideoPrompt(chunk);
      shots.push({
        id: `story_shot_${shotIndex}`,
        title,
        prompt,
        negative_prompt: "",
        video_prompt: videoPrompt,
        video_mode: "auto",
        duration_sec: inferDurationSec(chunk, chunkIndex === 0 ? dialogue : ""),
        dialogue: chunkIndex === 0 ? dialogue : "",
        notes: normalizeStoryInput(chunk),
        tags: inferShotTags(chunk, chunkIndex === 0 ? dialogue : "")
      });
      shotIndex += 1;
    });
  }
  return { shots };
}

function withLocalMotionToken(prompt: string, preset: LocalMotionPreset): string {
  const base = stripLocalMotionPresetToken(prompt).trim();
  if (preset === "auto") return base;
  return base ? `${base}\n[motion:${preset}]` : `[motion:${preset}]`;
}

function loadSettings(): ComfySettings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    return {
      baseUrl: "http://127.0.0.1:8188",
      outputDir: "",
      comfyInputDir: "",
      comfyRootDir: "",
      imageWorkflowJson: FISHER_WORKFLOW_JSON,
      videoWorkflowJson: FISHER_WORKFLOW_JSON,
      audioWorkflowJson: "",
      soundWorkflowJson: "",
      videoGenerationMode: defaultVideoGenerationMode(),
      tokenMapping: { ...DEFAULT_TOKEN_MAPPING }
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ComfySettings>;
    const resolvedImageWorkflowJson =
      typeof parsed.imageWorkflowJson === "string" && parsed.imageWorkflowJson.trim().length > 0
        ? parsed.imageWorkflowJson
        : FISHER_WORKFLOW_JSON;
    const resolvedVideoWorkflowJson =
      typeof parsed.videoWorkflowJson === "string" && parsed.videoWorkflowJson.trim().length > 0
        ? parsed.videoWorkflowJson
        : FISHER_WORKFLOW_JSON;
    return {
      baseUrl: parsed.baseUrl ?? "http://127.0.0.1:8188",
      outputDir: parsed.outputDir ?? "",
      comfyInputDir: parsed.comfyInputDir ?? "",
      comfyRootDir: parsed.comfyRootDir ?? "",
      imageWorkflowJson: resolvedImageWorkflowJson,
      videoWorkflowJson: resolvedVideoWorkflowJson,
      audioWorkflowJson: typeof parsed.audioWorkflowJson === "string" ? parsed.audioWorkflowJson : "",
      soundWorkflowJson: typeof parsed.soundWorkflowJson === "string" ? parsed.soundWorkflowJson : "",
      videoGenerationMode: parsed.videoGenerationMode ?? defaultVideoGenerationMode(),
      tokenMapping: {
        ...DEFAULT_TOKEN_MAPPING,
        ...(parsed.tokenMapping ?? {})
      }
    };
  } catch {
    return {
      baseUrl: "http://127.0.0.1:8188",
      outputDir: "",
      comfyInputDir: "",
      comfyRootDir: "",
      imageWorkflowJson: FISHER_WORKFLOW_JSON,
      videoWorkflowJson: FISHER_WORKFLOW_JSON,
      audioWorkflowJson: "",
      soundWorkflowJson: "",
      videoGenerationMode: defaultVideoGenerationMode(),
      tokenMapping: { ...DEFAULT_TOKEN_MAPPING }
    };
  }
}

function formatAssetStatus(status: AssetStatus): string {
  if (status === "running") return "生成中";
  if (status === "success") return "成功";
  if (status === "failed") return "失败";
  return "待生成";
}

function formatPipelineLogText(items: PipelineLogItem[]): string {
  return items.map((item) => `[${item.timestamp}] [${item.level.toUpperCase()}] ${item.message}`).join("\n");
}

function looksLikeVideoPath(path: string): boolean {
  const value = path.trim().toLowerCase();
  if (!value) return false;
  const pure = (value.split("?")[0] ?? value).trim();
  return [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".gif"].some((ext) =>
    pure.endsWith(ext)
  );
}

function looksLikeAudioPath(path: string): boolean {
  const value = path.trim().toLowerCase();
  if (!value) return false;
  const pure = (value.split("?")[0] ?? value).trim();
  return [".wav", ".mp3", ".aac", ".flac", ".ogg", ".m4a", ".opus"].some((ext) =>
    pure.endsWith(ext)
  );
}

function ttsTrackIdForShot(shotId: string): string {
  return `audio_tts_${shotId}`;
}

function ttsTrackIdForSegment(shotId: string, index: number): string {
  return `${ttsTrackIdForShot(shotId)}_${index}`;
}

function isNarrationSpeaker(speaker: string): boolean {
  const normalized = normalizeSpeakerKey(speaker);
  return ["旁白", "内心", "心声", "独白", "narration", "voiceover", "voice-over", "vo"].includes(normalized);
}

function summarizeDialogueSegments(segments: DialogueSegment[]): {
  total: number;
  dialogue: number;
  narration: number;
} {
  return segments.reduce(
    (summary, segment) => {
      summary.total += 1;
      if (isNarrationSpeaker(segment.speaker)) {
        summary.narration += 1;
      } else {
        summary.dialogue += 1;
      }
      return summary;
    },
    { total: 0, dialogue: 0, narration: 0 }
  );
}

function normalizeSpeakerKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function splitDialogueLines(raw: string): string[] {
  return raw
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function inferSpeechRate(text: string): string {
  const normalized = text.trim();
  if (!normalized) return "1.00";
  if (/急促|加快|飞快|赶紧|立刻|马上|快点|喘|跑|危险|紧张|激动|兴奋/.test(normalized)) return "1.12";
  if (/低声|压低|耳语|悄声|缓慢|停顿|迟疑|犹豫|哽咽|哭腔|旁白|沉稳|冷静|平静|慢慢/.test(normalized)) return "0.90";
  if (/[!！]{2,}/.test(normalized)) return "1.08";
  if (/[?？].*[?？]/.test(normalized)) return "1.04";
  if (/…|\.\.\./.test(normalized)) return "0.92";
  return "1.00";
}

function inferDialogueDelivery(
  text: string,
  speaker: string,
  explicitHint = ""
): { emotion: string; deliveryStyle: string; speechRate: string } {
  const combined = `${speaker} ${explicitHint} ${text}`.trim();
  const isNarration = /^(旁白|内心|心声|narration|voice over|vo)$/i.test(speaker.trim());
  let emotion = isNarration ? "平静" : "自然";
  let deliveryStyle = isNarration ? "旁白" : "自然口语";

  if (/怒|生气|愤怒|咬牙|厉声|吼|喊|咆哮/.test(combined)) {
    emotion = "愤怒";
    deliveryStyle = explicitHint.trim() || "爆发感";
  } else if (/哭|哽咽|抽泣|伤心|难过|悲伤|泣不成声/.test(combined)) {
    emotion = "悲伤";
    deliveryStyle = explicitHint.trim() || "哽咽";
  } else if (/笑|轻笑|苦笑|打趣|调侃|轻松|温柔/.test(combined)) {
    emotion = "轻松";
    deliveryStyle = explicitHint.trim() || "带笑意";
  } else if (/紧张|着急|急促|危险|快点|马上|立刻|跑|喘/.test(combined) || /[!！]/.test(text)) {
    emotion = "紧张";
    deliveryStyle = explicitHint.trim() || "急促";
  } else if (/疑惑|困惑|怀疑|试探|怎么|为什么/.test(combined) || /[?？]/.test(text)) {
    emotion = "疑惑";
    deliveryStyle = explicitHint.trim() || "试探";
  } else if (/低声|压低|耳语|悄声/.test(combined)) {
    emotion = isNarration ? "平静" : "克制";
    deliveryStyle = explicitHint.trim() || "压低声音";
  } else if (/冷静|平静|沉稳|冷声|克制/.test(combined)) {
    emotion = "克制";
    deliveryStyle = explicitHint.trim() || "冷静";
  } else if (/…|\.\.\.|迟疑|犹豫|顿了顿/.test(combined)) {
    emotion = "迟疑";
    deliveryStyle = explicitHint.trim() || "停顿明显";
  } else if (explicitHint.trim()) {
    deliveryStyle = explicitHint.trim();
  }

  return {
    emotion,
    deliveryStyle,
    speechRate: inferSpeechRate(`${explicitHint} ${text}`)
  };
}

function parseSpeakerSpec(raw: string): { speaker: string; hint: string } {
  const trimmed = raw.trim();
  const paren = trimmed.match(/^(.+?)\s*[（(]\s*([^()（）]+?)\s*[)）]\s*$/);
  if (paren) {
    return {
      speaker: paren[1]!.trim(),
      hint: paren[2]!.trim()
    };
  }
  const parts = trimmed.split(/[|｜]/).map((item) => item.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      speaker: parts[0]!,
      hint: parts.slice(1).join(" ")
    };
  }
  return { speaker: trimmed, hint: "" };
}

function matchSpeakerLine(raw: string): { speaker: string; text: string; hint: string } | null {
  const colon = raw.match(/^([^:：]{1,24})\s*[:：]\s*(.+)$/);
  if (colon) {
    const parsedSpeaker = parseSpeakerSpec(colon[1]!.trim());
    return {
      speaker: parsedSpeaker.speaker,
      hint: parsedSpeaker.hint,
      text: colon[2]!.trim()
    };
  }
  const bracket = raw.match(/^[\[【](.+?)[\]】]\s*(.+)$/);
  if (bracket) {
    const parsedSpeaker = parseSpeakerSpec(bracket[1]!.trim());
    return {
      speaker: parsedSpeaker.speaker,
      hint: parsedSpeaker.hint,
      text: bracket[2]!.trim()
    };
  }
  return null;
}

function resolveVoiceProfileForSpeaker(
  speaker: string,
  shot: Shot,
  assets: Asset[]
): string {
  const selectedCharacters = (shot.characterRefs ?? [])
    .map((id) => assets.find((item) => item.id === id && item.type === "character"))
    .filter((item): item is Asset => Boolean(item));
  const allCharacters = assets.filter((item) => item.type === "character");
  const pool = selectedCharacters.length > 0 ? selectedCharacters : allCharacters;
  const normalizedSpeaker = normalizeSpeakerKey(speaker);
  const matched = pool.find((item) => normalizeSpeakerKey(item.name) === normalizedSpeaker);
  if (matched?.voiceProfile?.trim()) return matched.voiceProfile.trim();
  return selectedCharacters[0]?.voiceProfile?.trim() || "";
}

function parseDialogueSegments(
  shot: Shot,
  assets: Asset[]
): DialogueSegment[] {
  const raw = shot.dialogue.trim();
  if (!raw) return [];
  const lines = splitDialogueLines(raw);
  const segments: DialogueSegment[] = [];
  for (const line of lines) {
    const parsed = matchSpeakerLine(line);
    if (parsed) {
      const delivery = inferDialogueDelivery(parsed.text, parsed.speaker, parsed.hint);
      segments.push({
        speaker: parsed.speaker,
        text: parsed.text,
        voiceProfile: resolveVoiceProfileForSpeaker(parsed.speaker, shot, assets),
        emotion: delivery.emotion,
        deliveryStyle: delivery.deliveryStyle,
        speechRate: delivery.speechRate
      });
      continue;
    }
    const delivery = inferDialogueDelivery(line, "", "");
    segments.push({
      speaker: "",
      text: line,
      voiceProfile: resolveVoiceProfileForSpeaker("", shot, assets),
      emotion: delivery.emotion,
      deliveryStyle: delivery.deliveryStyle,
      speechRate: delivery.speechRate
    });
  }
  return segments.filter((item) => item.text.trim().length > 0);
}

function allocateSegmentDurations(totalFrames: number, segments: DialogueSegment[]): number[] {
  if (segments.length === 0) return [];
  if (segments.length === 1) return [Math.max(1, totalFrames)];
  const safeTotal = Math.max(segments.length, totalFrames);
  const weights = segments.map((item) => Math.max(1, item.text.replace(/\s+/g, "").length));
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  const durations = weights.map((weight) => Math.max(1, Math.floor((weight / weightSum) * safeTotal)));
  let current = durations.reduce((sum, value) => sum + value, 0);
  while (current < safeTotal) {
    let targetIndex = 0;
    let bestGap = -Infinity;
    for (let index = 0; index < weights.length; index += 1) {
      const gap = weights[index]! / weightSum - durations[index]! / safeTotal;
      if (gap > bestGap) {
        bestGap = gap;
        targetIndex = index;
      }
    }
    durations[targetIndex] += 1;
    current += 1;
  }
  while (current > safeTotal) {
    let targetIndex = durations.findIndex((value) => value > 1);
    if (targetIndex < 0) break;
    durations[targetIndex] -= 1;
    current -= 1;
  }
  return durations;
}

function soundTrackIdForShot(shotId: string, kind: SoundCueKind): string {
  return `audio_${kind}_${shotId}`;
}

const PROP_SOUND_RULES: Array<{ pattern: RegExp; prompt: string }> = [
  { pattern: /枪|手枪|步枪|gun|rifle|shot|shoot|fire/i, prompt: "枪械金属碰撞、上膛、开火或余响" },
  { pattern: /门|door|开门|关门/i, prompt: "门把手、开门、关门、门轴摩擦" },
  { pattern: /电话|手机|phone|mobile/i, prompt: "手机提示音、震动、接听或按键" },
  { pattern: /车|汽车|car|engine|brake/i, prompt: "引擎、轮胎、驶过、刹车或车门" },
  { pattern: /杯|玻璃|glass|bottle/i, prompt: "玻璃杯、瓶子、轻碰撞或放置桌面" },
  { pattern: /纸|信|书|paper|book/i, prompt: "纸张翻动、书页摩擦或文件落桌" },
  { pattern: /刀|剑|knife|sword/i, prompt: "刀剑出鞘、金属摩擦、挥动破风" },
  { pattern: /包|箱|bag|box|case/i, prompt: "包袋、箱体开合、拉链、硬物碰撞" }
];

function compactTextParts(...parts: Array<string | undefined>): string {
  return parts
    .map((item) => item?.trim() ?? "")
    .filter((item) => item.length > 0)
    .join("；");
}

function buildShotSoundCues(shot: Shot): SoundCueSpec[] {
  const context = compactTextParts(shot.title, shot.storyPrompt, shot.notes, shot.dialogue, shot.tags.join("、"));
  const cues: SoundCueSpec[] = [
    {
      kind: "ambience",
      gain: 0.42,
      prompt: `为该镜头生成纯环境氛围声与空间底噪，不要对白，不要音乐，不要夸张拟音。镜头内容：${context || shot.title}。`
    }
  ];

  const hasCharacterActivity =
    Boolean(shot.dialogue.trim()) || (shot.characterRefs?.length ?? 0) > 0 || shot.tags.some((tag) => /dialogue|人物|角色/i.test(tag));
  if (hasCharacterActivity) {
    cues.push({
      kind: "character",
      gain: 0.68,
      prompt: `为该镜头生成人物细微动作音效，如呼吸、衣料摩擦、站立重心变化、轻微脚步或转身，不要对白，不要音乐。镜头内容：${context || shot.title}。`
    });
  }

  const propPrompts = PROP_SOUND_RULES
    .filter((rule) => rule.pattern.test(context))
    .map((rule) => rule.prompt);
  if (propPrompts.length > 0) {
    cues.push({
      kind: "prop",
      gain: 0.82,
      prompt: `为该镜头生成道具/事件音效：${[...new Set(propPrompts)].join("、")}。不要对白，不要音乐。镜头内容：${context || shot.title}。`
    });
  }
  return cues;
}

function hasUsableGeneratedAsset(
  kind: "image" | "video",
  shot: { generatedImagePath?: string; generatedVideoPath?: string }
): boolean {
  if (kind === "image") {
    return Boolean(shot.generatedImagePath?.trim());
  }
  return looksLikeVideoPath(shot.generatedVideoPath ?? "");
}

export function ComfyPipelinePanel() {
  const project = useStoryboardStore((state) => state.project);
  const shots = useStoryboardStore((state) => state.shots);
  const assets = useStoryboardStore((state) => state.assets);
  const audioTracks = useStoryboardStore((state) => state.audioTracks);
  const currentSequenceId = useStoryboardStore((state) => state.currentSequenceId);
  const replaceShotsForCurrentSequence = useStoryboardStore((state) => state.replaceShotsForCurrentSequence);
  const updateShotFields = useStoryboardStore((state) => state.updateShotFields);
  const setShotDuration = useStoryboardStore((state) => state.setShotDuration);
  const upsertAudioTrack = useStoryboardStore((state) => state.upsertAudioTrack);
  const updateAudioTrack = useStoryboardStore((state) => state.updateAudioTrack);
  const removeAudioTrack = useStoryboardStore((state) => state.removeAudioTrack);
  const [storyText, setStoryText] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [phase, setPhase] = useState<GenerationPhase>("idle");
  const [pipelineState, setPipelineState] = useState("空闲");
  const [runAllActive, setRunAllActive] = useState(false);
  const [runAllProgress, setRunAllProgress] = useState(0);
  const [runAllStage, setRunAllStage] = useState("");
  const [previewVideoPath, setPreviewVideoPath] = useState("");
  const [settings, setSettings] = useState<ComfySettings>(() => loadSettings());
  const [skipExisting, setSkipExisting] = useState(true);
  const [imageStatusByShot, setImageStatusByShot] = useState<Record<string, AssetStatus>>({});
  const [videoStatusByShot, setVideoStatusByShot] = useState<Record<string, AssetStatus>>({});
  const [audioStatusByShot, setAudioStatusByShot] = useState<Record<string, AssetStatus>>({});
  const [lastErrorByShot, setLastErrorByShot] = useState<Record<string, string>>({});
  const [expandedShotId, setExpandedShotId] = useState("");
  const [logs, setLogs] = useState<PipelineLogItem[]>([]);
  const [connectionLabel, setConnectionLabel] = useState("待检测");
  const [showShotEditor, setShowShotEditor] = useState(false);
  const [shotFilter, setShotFilter] = useState<"all" | "failed">("all");
  const [lastDependencyHints, setLastDependencyHints] = useState<WorkflowDependencyHint[]>([]);
  const [lastModelChecklist, setLastModelChecklist] = useState("");
  const checkingRef = useRef(false);

  const scopedShots = useMemo(
    () =>
      shots
        .filter((shot) => shot.sequenceId === currentSequenceId)
        .sort((a, b) => a.order - b.order),
    [currentSequenceId, shots]
  );

  const visibleShots = useMemo(() => {
    const list = scopedShots.slice(0, 12);
    if (shotFilter === "all") return list;
    return list.filter(
      (shot) =>
        imageStatusByShot[shot.id] === "failed" ||
        videoStatusByShot[shot.id] === "failed" ||
        audioStatusByShot[shot.id] === "failed"
    );
  }, [audioStatusByShot, imageStatusByShot, scopedShots, shotFilter, videoStatusByShot]);

  const getScopedShotsSnapshot = () =>
    useStoryboardStore
      .getState()
      .shots.filter((shot) => shot.sequenceId === currentSequenceId)
      .sort((a, b) => a.order - b.order);

  const inferInputDirFromSettings = (value: ComfySettings): string => {
    const explicitInput = value.comfyInputDir.trim().replace(/\/+$/, "");
    if (explicitInput) return explicitInput;
    const root = value.comfyRootDir.trim().replace(/\/+$/, "");
    if (root) return `${root}/input`;
    const output = value.outputDir.trim().replace(/\/+$/, "");
    if (!output) return "";
    const index = output.lastIndexOf("/");
    if (index <= 0) return "";
    return `${output.slice(0, index)}/input`;
  };

  const monitorSummary = useMemo(() => {
    let imageSuccess = 0;
    let imageFailed = 0;
    let videoSuccess = 0;
    let videoFailed = 0;
    let audioSuccess = 0;
    let audioFailed = 0;
    for (const shot of scopedShots) {
      const imageStatus = imageStatusByShot[shot.id] ?? "idle";
      const videoStatus = videoStatusByShot[shot.id] ?? "idle";
      const audioStatus = audioStatusByShot[shot.id] ?? "idle";
      if (imageStatus === "success") imageSuccess += 1;
      if (imageStatus === "failed") imageFailed += 1;
      if (videoStatus === "success") videoSuccess += 1;
      if (videoStatus === "failed") videoFailed += 1;
      if (audioStatus === "success") audioSuccess += 1;
      if (audioStatus === "failed") audioFailed += 1;
    }
    const errorLogCount = logs.reduce((count, item) => count + (item.level === "error" ? 1 : 0), 0);
    return {
      totalShots: scopedShots.length,
      imageSuccess,
      imageFailed,
      videoSuccess,
      videoFailed,
      audioSuccess,
      audioFailed,
      errorLogCount
    };
  }, [audioStatusByShot, imageStatusByShot, logs, scopedShots, videoStatusByShot]);

  const persistSettings = (next: ComfySettings | ((previous: ComfySettings) => ComfySettings)) => {
    setSettings((previous) => {
      const resolved = typeof next === "function" ? (next as (prev: ComfySettings) => ComfySettings)(previous) : next;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(resolved));
      return resolved;
    });
  };

  const appendLog = (message: string, level: PipelineLogLevel = "info") => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const item: PipelineLogItem = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      timestamp: `${hh}:${mm}:${ss}`,
      level,
      message
    };
    setLogs((previous) => [...previous.slice(-499), item]);
  };

  useEffect(() => {
    if (!isWebBridgeRuntime()) return;
    const timer = window.setTimeout(() => {
      void invokeDesktopCommand("save_pipeline_logs", {
        text: formatPipelineLogText(logs)
      }).catch(() => {
        // Ignore bridge log sync failures. The local UI log remains the source of truth.
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [logs]);

  useEffect(() => {
    if (!isWebBridgeRuntime()) return;
    const timer = window.setTimeout(() => {
      void invokeDesktopCommand("save_comfy_runtime_config", {
        config: {
          baseUrl: settings.baseUrl,
          comfyRootDir: settings.comfyRootDir,
          comfyInputDir: settings.comfyInputDir,
          outputDir: settings.outputDir,
          videoGenerationMode: settings.videoGenerationMode,
          imageWorkflowJson: settings.imageWorkflowJson,
          videoWorkflowJson: settings.videoWorkflowJson,
          audioWorkflowJson: settings.audioWorkflowJson,
          soundWorkflowJson: settings.soundWorkflowJson
        }
      }).catch(() => {
        // Ignore bridge config sync failures. Diagnostics is best-effort only.
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [
    settings.baseUrl,
    settings.audioWorkflowJson,
    settings.comfyInputDir,
    settings.comfyRootDir,
    settings.imageWorkflowJson,
    settings.outputDir,
    settings.soundWorkflowJson,
    settings.videoWorkflowJson,
    settings.videoGenerationMode
  ]);

  const copyLogs = async () => {
    if (logs.length === 0) {
      pushToast("暂无日志可复制", "warning");
      return;
    }
    const text = formatPipelineLogText(logs);
    try {
      await navigator.clipboard.writeText(text);
      pushToast("日志已复制", "success");
    } catch (error) {
      pushToast(`复制失败：${String(error)}`, "error");
    }
  };

  const setAssetStatus = (kind: "image" | "video" | "audio", shotId: string, status: AssetStatus) => {
    if (kind === "image") {
      setImageStatusByShot((previous) => ({ ...previous, [shotId]: status }));
    } else if (kind === "audio") {
      setAudioStatusByShot((previous) => ({ ...previous, [shotId]: status }));
    } else {
      setVideoStatusByShot((previous) => ({ ...previous, [shotId]: status }));
    }
  };

  const audioSummaryByShot = useMemo(() => {
    const map: Record<string, { count: number; dialogueCount: number; narrationCount: number; firstPath: string }> = {};
    for (const track of audioTracks) {
      const ttsMatch = /^audio_tts_(.+?)(?:_(\d+))?$/.exec(track.id);
      if (!ttsMatch) continue;
      const shotId = ttsMatch[1] ?? "";
      if (!shotId) continue;
      const current = map[shotId] ?? { count: 0, dialogueCount: 0, narrationCount: 0, firstPath: "" };
      const valid = looksLikeAudioPath(track.filePath);
      if (valid) {
        current.count += 1;
        if (track.kind === "narration") {
          current.narrationCount += 1;
        } else {
          current.dialogueCount += 1;
        }
      }
      if (!current.firstPath && track.filePath.trim()) current.firstPath = track.filePath;
      map[shotId] = current;
    }
    return map;
  }, [audioTracks]);

  const applyImportedShots = (parsed: { shots?: Array<Record<string, unknown>> }) => {
    const list = Array.isArray(parsed.shots) ? parsed.shots : [];
    if (list.length === 0) {
      throw new Error("脚本格式无效：缺少 shots 数组");
    }
    replaceShotsForCurrentSequence(
      list.map((item, index) => ({
        id: typeof item.id === "string" ? item.id : `shot_import_${index + 1}`,
        title: String(item.title ?? `镜头 ${index + 1}`),
        prompt: String(item.prompt ?? ""),
        negativePrompt: String(item.negative_prompt ?? item.negativePrompt ?? ""),
        videoPrompt: String(item.video_prompt ?? item.videoPrompt ?? ""),
        videoMode:
          item.video_mode === "single_frame" || item.videoMode === "single_frame"
            ? "single_frame"
            : item.video_mode === "first_last_frame" || item.videoMode === "first_last_frame"
              ? "first_last_frame"
              : "auto",
        videoStartFramePath: String(item.video_start_frame_path ?? item.videoStartFramePath ?? ""),
        videoEndFramePath: String(item.video_end_frame_path ?? item.videoEndFramePath ?? ""),
        skyboxFace:
          item.skybox_face === "front" ||
          item.skybox_face === "right" ||
          item.skybox_face === "back" ||
          item.skybox_face === "left" ||
          item.skybox_face === "up" ||
          item.skybox_face === "down" ||
          item.skybox_face === "auto"
            ? item.skybox_face
            : item.skyboxFace === "front" ||
                item.skyboxFace === "right" ||
                item.skyboxFace === "back" ||
                item.skyboxFace === "left" ||
                item.skyboxFace === "up" ||
                item.skyboxFace === "down" ||
                item.skyboxFace === "auto"
              ? item.skyboxFace
              : "auto",
        skyboxFaces: Array.isArray(item.skybox_faces)
          ? item.skybox_faces.filter(
              (face): face is "front" | "right" | "back" | "left" | "up" | "down" =>
                face === "front" ||
                face === "right" ||
                face === "back" ||
                face === "left" ||
                face === "up" ||
                face === "down"
            )
          : Array.isArray(item.skyboxFaces)
            ? item.skyboxFaces.filter(
                (face): face is "front" | "right" | "back" | "left" | "up" | "down" =>
                  face === "front" ||
                  face === "right" ||
                  face === "back" ||
                  face === "left" ||
                  face === "up" ||
                  face === "down"
              )
            : [],
        skyboxFaceWeights:
          item.skybox_face_weights && typeof item.skybox_face_weights === "object"
            ? (item.skybox_face_weights as Record<string, number>)
            : item.skyboxFaceWeights && typeof item.skyboxFaceWeights === "object"
              ? (item.skyboxFaceWeights as Record<string, number>)
              : {},
        durationSec:
          typeof item.duration_sec === "number"
            ? item.duration_sec
            : typeof item.durationSec === "number"
              ? item.durationSec
              : undefined,
        durationFrames:
          typeof item.duration_frames === "number"
            ? item.duration_frames
            : typeof item.durationFrames === "number"
              ? item.durationFrames
              : undefined,
        seed: typeof item.seed === "number" ? item.seed : undefined,
        characterRefs: Array.isArray(item.character_refs)
          ? (item.character_refs as string[])
          : Array.isArray(item.characterRefs)
            ? (item.characterRefs as string[])
            : [],
        sceneRefId: String(item.scene_ref_id ?? item.sceneRefId ?? ""),
        dialogue: typeof item.dialogue === "string" ? item.dialogue : "",
        notes: typeof item.notes === "string" ? item.notes : "",
        tags: Array.isArray(item.tags) ? (item.tags as string[]) : []
      }))
    );
    return list.length;
  };

  const onImportScript = () => {
    try {
      const parsed = JSON.parse(scriptText) as { shots?: Array<Record<string, unknown>> };
      const count = applyImportedShots(parsed);
      pushToast(`已导入 ${count} 个镜头`, "success");
      appendLog(`导入镜头脚本成功，共 ${count} 条`);
    } catch (error) {
      pushToast(`导入失败：${String(error)}`, "error");
      appendLog(`导入镜头脚本失败：${String(error)}`, "error");
    }
  };

  const onParseStory = (shouldImport = false) => {
    try {
      const parsed = parseStoryToShotScript(storyText);
      const formatted = JSON.stringify(parsed, null, 2);
      setScriptText(formatted);
      appendLog(`故事解析成功，共生成 ${parsed.shots.length} 条镜头脚本`);
      if (shouldImport) {
        const count = applyImportedShots(parsed as { shots?: Array<Record<string, unknown>> });
        pushToast(`故事已解析并导入 ${count} 个镜头`, "success");
        appendLog(`故事解析并导入成功，共 ${count} 条`);
      } else {
        pushToast(`故事解析成功，共 ${parsed.shots.length} 个镜头`, "success");
      }
    } catch (error) {
      pushToast(`故事解析失败：${String(error)}`, "error");
      appendLog(`故事解析失败：${String(error)}`, "error");
    }
  };

  const onCheckConnection = async () => {
    try {
      const result = await pingComfyWithDetail(settings.baseUrl);
      setConnectionLabel(result.ok ? "已连接" : "未连接");
      pushToast(result.ok ? "ComfyUI 连接正常" : result.message, result.ok ? "success" : "warning");
      appendLog(result.ok ? "ComfyUI 连接正常" : `ComfyUI 连接失败：${result.message}`, result.ok ? "info" : "error");
    } catch (error) {
      setConnectionLabel("未连接");
      pushToast(`连接失败：${String(error)}`, "error");
      appendLog(`ComfyUI 连接失败：${String(error)}`, "error");
    }
  };

  const onInspectWorkflows = async () => {
    try {
      setPipelineState("体检工作流依赖中");
      appendLog("开始体检工作流依赖（图片 + 视频 + 配音）");
      setLastDependencyHints([]);
      const reports = await Promise.all([
        inspectWorkflowDependencies(settings.baseUrl, settings.imageWorkflowJson),
        inspectWorkflowDependencies(settings.baseUrl, settings.videoWorkflowJson),
        settings.audioWorkflowJson?.trim()
          ? inspectWorkflowDependencies(settings.baseUrl, settings.audioWorkflowJson)
          : Promise.resolve(null)
      ]);
      const [imageReport, videoReport, audioReport] = reports;

      const reportLines = [
        `图片工作流节点: ${imageReport.availableNodeTypes}/${imageReport.totalNodeTypes} 可用`,
        `视频工作流节点: ${videoReport.availableNodeTypes}/${videoReport.totalNodeTypes} 可用`
      ];
      if (audioReport) {
        reportLines.push(`配音工作流节点: ${audioReport.availableNodeTypes}/${audioReport.totalNodeTypes} 可用`);
      }
      appendLog(reportLines.join("；"));

      const missing = [...imageReport.missingNodeTypes, ...videoReport.missingNodeTypes, ...(audioReport?.missingNodeTypes ?? [])];
      if (missing.length === 0) {
        pushToast("体检通过：未发现缺失节点", "success");
        appendLog("体检通过：未发现缺失节点");
        return;
      }

      const uniqueMissing = [...new Set(missing)];
      appendLog(`缺失节点类型：${uniqueMissing.join(", ")}`, "error");

      const hints = [...imageReport.hints, ...videoReport.hints, ...(audioReport?.hints ?? [])].filter(
        (item, index, all) => all.findIndex((cur) => cur.plugin === item.plugin) === index
      );
      setLastDependencyHints(hints);
      if (hints.length > 0) {
        for (const hint of hints) {
          appendLog(`建议安装插件：${hint.plugin} (${hint.repo})`, "error");
        }
      }
      pushToast(`发现 ${uniqueMissing.length} 个缺失节点类型，详情见日志`, "warning");
    } catch (error) {
      pushToast(`体检失败：${String(error)}`, "error");
      appendLog(`体检工作流失败：${String(error)}`, "error");
    } finally {
      setPipelineState("空闲");
    }
  };

  const onInstallSuggestedPlugins = async () => {
    try {
      if (lastDependencyHints.length === 0) {
        pushToast("当前没有可安装建议，请先体检工作流", "warning");
        return;
      }
      const comfyRoot = inferComfyRootDir(settings);
      if (!comfyRoot) {
        pushToast("请先填写 ComfyUI 根目录（或正确配置 output/input 目录）", "error");
        appendLog("安装建议插件失败：未能推断 ComfyUI 根目录", "error");
        return;
      }
      setPipelineState("安装建议插件中");
      appendLog(`开始安装建议插件，Comfy 根目录：${comfyRoot}`);
      const result = await installSuggestedPlugins(comfyRoot, lastDependencyHints);
      if (result.installed.length > 0) {
        appendLog(`已安装/更新：${result.installed.join(", ")}`);
      }
      if (result.skipped.length > 0) {
        appendLog(`已跳过：${result.skipped.join(", ")}`);
      }
      if (result.failed.length > 0) {
        for (const item of result.failed) {
          appendLog(`安装失败：${item.repo} -> ${item.error}`, "error");
        }
      }
      if (result.failed.length === 0) {
        pushToast("建议插件安装完成", "success");
      } else {
        pushToast(`建议插件安装完成，失败 ${result.failed.length} 项`, "warning");
      }

      appendLog("开始安装后自动复检");
      const reports = await Promise.all([
        inspectWorkflowDependencies(settings.baseUrl, settings.imageWorkflowJson),
        inspectWorkflowDependencies(settings.baseUrl, settings.videoWorkflowJson),
        settings.audioWorkflowJson?.trim()
          ? inspectWorkflowDependencies(settings.baseUrl, settings.audioWorkflowJson)
          : Promise.resolve(null)
      ]);
      const [imageReport, videoReport, audioReport] = reports;
      const remainMissing = [
        ...imageReport.missingNodeTypes,
        ...videoReport.missingNodeTypes,
        ...(audioReport?.missingNodeTypes ?? [])
      ];
      const uniqueRemain = [...new Set(remainMissing)];
      if (uniqueRemain.length === 0) {
        appendLog("安装后复检通过：未发现缺失节点");
      } else {
        appendLog(`安装后仍缺失节点：${uniqueRemain.join(", ")}`, "error");
      }
    } catch (error) {
      pushToast(`安装建议插件失败：${String(error)}`, "error");
      appendLog(`安装建议插件失败：${String(error)}`, "error");
    } finally {
      setPipelineState("空闲");
    }
  };

  const onCheckModelHealth = async () => {
    try {
      const comfyRoot = inferComfyRootDir(settings);
      if (!comfyRoot) {
        pushToast("请先填写 ComfyUI 根目录（或正确配置 output/input 目录）", "error");
        appendLog("模型体检失败：未能推断 ComfyUI 根目录", "error");
        return;
      }
      setPipelineState("体检模型文件中");
      appendLog(`开始体检模型目录：${comfyRoot}`);
      const report = await checkComfyModelHealth(comfyRoot);
      const checklistLines: string[] = [];
      let hardFail = false;
      for (const item of report.checks) {
        const status = item.exists ? `存在(${item.fileCount})` : "缺失";
        appendLog(`模型检查 - ${item.label}: ${status} @ ${item.path}`, item.required && !item.exists ? "error" : "info");
        if (item.required && !item.exists) hardFail = true;
        if (!item.exists || item.fileCount === 0) {
          checklistLines.push(`- ${item.label}`);
          checklistLines.push(`  目标目录: ${item.path}`);
          if (item.key === "checkpoints") {
            checklistLines.push("  建议模型: SDXL / SD1.5 主模型（.safetensors）");
            checklistLines.push("  建议来源: https://civitai.com/ 或 https://huggingface.co/");
          } else if (item.key === "vae") {
            checklistLines.push("  建议模型: 通用 VAE（与底模匹配）");
            checklistLines.push("  建议来源: https://huggingface.co/");
          } else if (item.key === "controlnet") {
            checklistLines.push("  建议模型: ControlNet 常用权重（lineart/depth/openpose）");
            checklistLines.push("  建议来源: https://huggingface.co/lllyasviel");
          } else if (item.key === "ipadapter" || item.key === "clip_vision") {
            checklistLines.push("  建议模型: IPAdapter 权重 + CLIP Vision");
            checklistLines.push("  建议来源: https://huggingface.co/h94/IP-Adapter");
          } else if (item.key === "animatediff_models" || item.key === "animatediff_models_plugin") {
            checklistLines.push("  建议模型: AnimateDiff motion module");
            checklistLines.push("  建议来源: https://huggingface.co/guoyww/animatediff");
          } else if (item.key === "loras") {
            checklistLines.push("  建议模型: 角色/风格 LoRA");
            checklistLines.push("  建议来源: https://civitai.com/ 或 https://huggingface.co/");
          }
        }
      }
      const motion = report.checks.find((item) => item.key === "animatediff_models");
      const motionPlugin = report.checks.find((item) => item.key === "animatediff_models_plugin");
      const motionCount = (motion?.fileCount ?? 0) + (motionPlugin?.fileCount ?? 0);
      if (motionCount === 0) {
        appendLog("AnimateDiff 未检测到 motion model（可选）。需要时请放入 models/animatediff_models 或插件 models 目录。", "error");
      }
      const checklistText =
        checklistLines.length === 0
          ? "当前模型体检未发现缺失项。"
          : `模型缺失下载清单\n${checklistLines.join("\n")}`;
      setLastModelChecklist(checklistText);
      if (hardFail) {
        pushToast("模型体检完成：存在必需目录缺失，详情见日志", "warning");
      } else {
        pushToast("模型体检完成", "success");
      }
    } catch (error) {
      pushToast(`模型体检失败：${String(error)}`, "error");
      appendLog(`模型体检失败：${String(error)}`, "error");
    } finally {
      setPipelineState("空闲");
    }
  };

  const onCopyModelChecklist = async () => {
    if (!lastModelChecklist.trim()) {
      pushToast("暂无模型下载清单，请先点体检模型文件", "warning");
      return;
    }
    try {
      await navigator.clipboard.writeText(lastModelChecklist);
      pushToast("模型下载清单已复制", "success");
      appendLog("已复制模型下载清单");
    } catch (error) {
      pushToast(`复制失败：${String(error)}`, "error");
      appendLog(`复制模型下载清单失败：${String(error)}`, "error");
    }
  };

  const onAutoDetectComfy = async (quiet = false) => {
    try {
      const found = await discoverComfyEndpoints();
      if (found.length === 0) {
        if (!quiet) pushToast("未探测到可用 ComfyUI 地址，请确认桌面版已启动", "warning");
        setConnectionLabel("未连接");
        appendLog("自动探测 Comfy 地址失败：未发现可用端口", "error");
        return;
      }
      const first = found[0];
      persistSettings((previous) => ({ ...previous, baseUrl: first }));
      const localDirs = await discoverComfyLocalDirs();
      const changedLabels: string[] = [];
      persistSettings((previous) => {
        const next = { ...previous };
        if (!next.comfyRootDir.trim() && localDirs.rootDir) {
          next.comfyRootDir = localDirs.rootDir;
          changedLabels.push(`根目录: ${localDirs.rootDir}`);
        }
        if (!next.comfyInputDir.trim() && localDirs.inputDir) {
          next.comfyInputDir = localDirs.inputDir;
          changedLabels.push(`input: ${localDirs.inputDir}`);
        }
        if (!next.outputDir.trim() && localDirs.outputDir) {
          next.outputDir = localDirs.outputDir;
          changedLabels.push(`output: ${localDirs.outputDir}`);
        }
        return next;
      });
      if (!quiet) pushToast(`已探测到 ComfyUI：${first}`, "success");
      appendLog(`自动探测成功，已切换 Comfy 地址：${first}`);
      if (changedLabels.length > 0) {
        appendLog(`已自动补全 Comfy 路径：${changedLabels.join("；")}`);
      }
      const ping = await pingComfyWithDetail(first);
      setConnectionLabel(ping.ok ? "已连接" : "未连接");
    } catch (error) {
      if (!quiet) pushToast(`自动探测失败：${String(error)}`, "error");
      setConnectionLabel("未连接");
      appendLog(`自动探测 Comfy 地址失败：${String(error)}`, "error");
    }
  };

  const ensureComfyReady = async (): Promise<boolean> => {
    if (checkingRef.current) return false;
    checkingRef.current = true;
    try {
      const current = await pingComfyWithDetail(settings.baseUrl);
      if (current.ok) {
        setConnectionLabel("已连接");
        return true;
      }
      const found = await discoverComfyEndpoints();
      const first = found[0];
      if (!first) {
        setConnectionLabel("未连接");
        appendLog("ComfyUI 未就绪：未探测到可用地址", "error");
        return false;
      }
      persistSettings((previous) => ({ ...previous, baseUrl: first }));
      const localDirs = await discoverComfyLocalDirs();
      const changedLabels: string[] = [];
      persistSettings((previous) => {
        const next = { ...previous };
        if (!next.comfyRootDir.trim() && localDirs.rootDir) {
          next.comfyRootDir = localDirs.rootDir;
          changedLabels.push(`根目录: ${localDirs.rootDir}`);
        }
        if (!next.comfyInputDir.trim() && localDirs.inputDir) {
          next.comfyInputDir = localDirs.inputDir;
          changedLabels.push(`input: ${localDirs.inputDir}`);
        }
        if (!next.outputDir.trim() && localDirs.outputDir) {
          next.outputDir = localDirs.outputDir;
          changedLabels.push(`output: ${localDirs.outputDir}`);
        }
        return next;
      });
      if (changedLabels.length > 0) {
        appendLog(`已自动补全 Comfy 路径：${changedLabels.join("；")}`);
      }
      const next = await pingComfyWithDetail(first);
      setConnectionLabel(next.ok ? "已连接" : "未连接");
      if (!next.ok) appendLog(`ComfyUI 连接失败：${next.message}`, "error");
      return next.ok;
    } finally {
      checkingRef.current = false;
    }
  };

  useEffect(() => {
    void onAutoDetectComfy(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onUploadWorkflow = async (kind: "image" | "video" | "audio", file?: File) => {
    if (!file) return;
    const text = await file.text();
    try {
      validateWorkflowJsonSyntax(text);
    } catch (error) {
      const label = kind === "image" ? "图片工作流" : kind === "video" ? "视频工作流" : "配音工作流";
      pushToast(`${label}加载失败：${String(error)}`, "error");
      appendLog(`${label}加载失败：${String(error)}`, "error");
      return;
    }
    const next = {
      ...settings,
      imageWorkflowJson: kind === "image" ? text : settings.imageWorkflowJson,
      videoWorkflowJson: kind === "video" ? text : settings.videoWorkflowJson,
      audioWorkflowJson: kind === "audio" ? text : settings.audioWorkflowJson
    };
    persistSettings(next);
    const check =
      kind === "audio"
        ? validateWorkflowTemplate(text, settings.tokenMapping, [
            settings.tokenMapping.dialogue.trim() || "DIALOGUE"
          ])
        : validateWorkflowTemplate(text, settings.tokenMapping);
    if (!check.ok) {
      pushToast("工作流已加载，但未检测到提示词 token，请检查高级设置映射", "warning");
      appendLog(`工作流已加载，但预检提示缺少 token：${check.missing.join(", ")}`, "error");
      return;
    }
    pushToast(
      kind === "image" ? "已加载图片工作流" : kind === "video" ? "已加载视频工作流" : "已加载配音工作流",
      "success"
    );
    appendLog(kind === "image" ? "已加载图片工作流" : kind === "video" ? "已加载视频工作流" : "已加载配音工作流");
  };

  const onUpdateTokenMapping = (key: keyof ComfySettings["tokenMapping"], value: string) => {
    persistSettings({
      ...settings,
      tokenMapping: {
        ...settings.tokenMapping,
        [key]: value.trim().toUpperCase().replace(/[{}]/g, "")
      }
    });
  };

  const generateDialogueTracksForShot = async (
    shot: Shot,
    shotIndex: number,
    runtimeSettings: ComfySettings,
    force: boolean
  ): Promise<boolean> => {
    const latestScopedShots = getScopedShotsSnapshot();
    const latestAssets = useStoryboardStore.getState().assets;
    const assetRuntimeSettings: ComfySettings = {
      ...runtimeSettings,
      renderWidth: project.width,
      renderHeight: project.height,
      renderFps: project.fps
    };
    const existingTracks = useStoryboardStore
      .getState()
      .audioTracks.filter((track) => track.id === ttsTrackIdForShot(shot.id) || track.id.startsWith(`${ttsTrackIdForShot(shot.id)}_`));
    const hasUsableAudio = existingTracks.some((track) => looksLikeAudioPath(track.filePath));
    if (!force && hasUsableAudio) return true;

    for (const track of existingTracks) {
      removeAudioTrack(track.id);
    }

    const segments = parseDialogueSegments(shot, latestAssets);
    if (segments.length === 0) return false;
    const durations = allocateSegmentDurations(shot.durationFrames, segments);
    const startFrame = selectShotStartFrame(useStoryboardStore.getState(), shot.id);
    let frameCursor = 0;

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segment = segments[segmentIndex]!;
      const segmentDuration = durations[segmentIndex] ?? 1;
      const label = segment.speaker ? `${shot.title} / ${segment.speaker}` : shot.title;
      const output = await generateShotAsset(
        assetRuntimeSettings,
        shot,
        shotIndex,
        "audio",
        latestScopedShots,
        latestAssets,
        {
          tokenOverrides: {
            DIALOGUE: segment.text,
            SPEAKER_NAME: segment.speaker,
            EMOTION: segment.emotion,
            DELIVERY_STYLE: segment.deliveryStyle,
            SPEECH_RATE: segment.speechRate,
            VOICE_PROFILE: segment.voiceProfile,
            CHARACTER_VOICE_PROFILES: segment.voiceProfile,
            SHOT_TITLE: label,
            DURATION_FRAMES: String(segmentDuration),
            DURATION_SEC: String((segmentDuration / Math.max(1, project.fps)).toFixed(2))
          },
          onProgress: (progress, message) => {
            const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
            const speakerLabel = segment.speaker ? ` / ${segment.speaker}` : "";
            setPipelineState(`镜头配音生成中：${shot.title}${speakerLabel}（${pct}%）${message ? ` · ${message}` : ""}`);
          }
        }
      );
      upsertAudioTrack({
        id: ttsTrackIdForSegment(shot.id, segmentIndex),
        projectId: project.id,
        filePath: output.localPath || output.previewUrl,
        startFrame: startFrame + frameCursor,
        gain: 1,
        kind: isNarrationSpeaker(segment.speaker) ? "narration" : "dialogue",
        label: segment.speaker
          ? `${isNarrationSpeaker(segment.speaker) ? "旁白" : "对白"} / ${segment.speaker}`
          : "对白"
      });
      frameCursor += segmentDuration;
    }
    return true;
  };

  const onGenerateSingle = async (
    kind: "image" | "video" | "audio",
    shotId: string,
    force = false,
    runtimeSettings: ComfySettings = settings
  ) => {
    const latestScopedShots = getScopedShotsSnapshot();
    const shot = latestScopedShots.find((item) => item.id === shotId);
    if (!shot) return false;
    if (kind === "video" && shot.generatedVideoPath?.trim() && !looksLikeVideoPath(shot.generatedVideoPath)) {
      updateShotFields(shot.id, { generatedVideoPath: "" });
      appendLog(`检测到历史遗留的非视频路径，已清空并重新生成：${shot.title}`, "error");
    }
    if (
      kind === "audio" &&
      audioTracks.some(
        (track) =>
          (track.id === ttsTrackIdForShot(shot.id) || track.id.startsWith(`${ttsTrackIdForShot(shot.id)}_`)) &&
          track.filePath.trim() &&
          !looksLikeAudioPath(track.filePath)
      )
    ) {
      audioTracks
        .filter(
          (track) =>
            track.id === ttsTrackIdForShot(shot.id) || track.id.startsWith(`${ttsTrackIdForShot(shot.id)}_`)
        )
        .forEach((track) => updateAudioTrack(track.id, { filePath: "" }));
      appendLog(`检测到历史遗留的非音频路径，已清空并重新生成：${shot.title}`, "error");
    }
    if (!force) {
      if (kind === "audio") {
        if ((audioSummaryByShot[shot.id]?.count ?? 0) > 0) return true;
      } else if (hasUsableGeneratedAsset(kind, shot)) {
        return true;
      }
    }
    const shotIndex = latestScopedShots.findIndex((item) => item.id === shotId);
    if (shotIndex < 0) return false;
    const latestAssets = useStoryboardStore.getState().assets;
    const assetRuntimeSettings: ComfySettings = {
      ...runtimeSettings,
      renderWidth: project.width,
      renderHeight: project.height,
      renderFps: project.fps
    };
    setAssetStatus(kind, shotId, "running");
    appendLog(`开始生成${kind === "image" ? "分镜图" : kind === "video" ? "视频" : "配音"}：${shot.title}`);
    try {
      if (kind === "audio") {
        const ok = await generateDialogueTracksForShot(shot, shotIndex, runtimeSettings, force);
        if (!ok) throw new Error("未生成任何对白分段");
        setAssetStatus(kind, shotId, "success");
        setLastErrorByShot((previous) => ({ ...previous, [shotId]: "" }));
        const summary = summarizeDialogueSegments(parseDialogueSegments(shot, assets));
        appendLog(
          `生成成功：${shot.title} -> 已输出 ${summary.total || 1} 段配音（对白 ${summary.dialogue} / 旁白 ${summary.narration}）`
        );
        return true;
      }
      const output = await generateShotAsset(assetRuntimeSettings, shot, shotIndex, kind, latestScopedShots, latestAssets, {
        onProgress: (progress, message) => {
          const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
          const label = kind === "image" ? "分镜图" : kind === "video" ? "镜头视频" : "镜头配音";
          setPipelineState(`${label}生成中：${shot.title}（${pct}%）${message ? ` · ${message}` : ""}`);
        }
      });
      if (kind === "image") {
        updateShotFields(shot.id, { generatedImagePath: output.previewUrl });
      } else if (kind === "video") {
        updateShotFields(shot.id, { generatedVideoPath: output.localPath || output.previewUrl });
      }
      setAssetStatus(kind, shotId, "success");
      setLastErrorByShot((previous) => ({ ...previous, [shotId]: "" }));
      appendLog(
        `生成成功：${shot.title} -> ${kind === "image" ? output.previewUrl : output.localPath || output.previewUrl}`
      );
      return true;
    } catch (error) {
      setAssetStatus(kind, shotId, "failed");
      const message = String(error);
      setLastErrorByShot((previous) => ({ ...previous, [shotId]: message }));
      pushToast(`${kind === "image" ? "分镜图" : kind === "video" ? "镜头视频" : "镜头配音"}生成失败：${shot.title}`, "error");
      appendLog(`生成失败：${shot.title}，${message}`, "error");
      return false;
    }
  };

  const onGenerateAudios = async (retryFailedOnly = false): Promise<boolean> => {
    try {
      if (phase === "running") {
        appendLog("镜头配音生成被跳过：当前已有任务在运行", "error");
        return false;
      }
      if (scopedShots.length === 0) {
        appendLog("镜头配音生成被跳过：当前没有镜头", "error");
        return false;
      }
      let runtimeSettings = settings;
      if (!runtimeSettings.audioWorkflowJson?.trim()) {
        pushToast("请先在高级设置里粘贴配音工作流 JSON", "warning");
        appendLog("镜头配音生成中断：未配置配音工作流", "error");
        return false;
      }
      if (!(await ensureComfyReady())) {
        pushToast("ComfyUI 未连接，请先启动 ComfyUI 桌面版", "error");
        setPipelineState("镜头配音生成中断：ComfyUI 未连接");
        appendLog("镜头配音生成中断：ComfyUI 未连接", "error");
        return false;
      }
      const check = validateWorkflowTemplate(runtimeSettings.audioWorkflowJson, runtimeSettings.tokenMapping, [
        runtimeSettings.tokenMapping.dialogue.trim() || "DIALOGUE"
      ]);
      if (!check.ok) {
        pushToast(`配音工作流缺少必需 token：${check.missing.join(", ")}`, "error");
        appendLog(`配音工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
        setPipelineState("镜头配音生成中断：配音工作流预检失败");
        return false;
      }

      const shotsForRun = getScopedShotsSnapshot();
      setPhase("running");
      let successCount = 0;
      let attemptedCount = 0;
      let skippedCount = 0;
      let skippedEmptyDialogue = 0;
      appendLog(retryFailedOnly ? "开始重试失败镜头配音" : "开始生成镜头配音");
      for (let index = 0; index < shotsForRun.length; index += 1) {
        const shot = shotsForRun[index];
        if (!shot.dialogue.trim()) {
          skippedEmptyDialogue += 1;
          continue;
        }
        if (retryFailedOnly && audioStatusByShot[shot.id] !== "failed") continue;
        if (skipExisting && !retryFailedOnly && (audioSummaryByShot[shot.id]?.count ?? 0) > 0) {
          skippedCount += 1;
          continue;
        }
        attemptedCount += 1;
        setPipelineState(`生成镜头配音：${shot.title} (${index + 1}/${shotsForRun.length})`);
        const ok = await onGenerateSingle("audio", shot.id, retryFailedOnly, runtimeSettings);
        if (ok) successCount += 1;
      }
      setPipelineState(retryFailedOnly ? "镜头配音失败项重试完成" : "镜头配音生成完成");
      appendLog(
        retryFailedOnly
          ? `镜头配音失败重试完成，成功 ${successCount} 条，尝试 ${attemptedCount} 条`
          : `镜头配音生成完成，成功 ${successCount} 条，尝试 ${attemptedCount} 条，跳过 ${skippedCount} 条，无对白跳过 ${skippedEmptyDialogue} 条`
      );
      if (successCount > 0) {
        appendLog("配音已自动加入时间轴音轨。当前“拼接整片预览”仍为纯视频拼接，如需带音频版本请使用导出功能。");
      }
      if (!retryFailedOnly && attemptedCount === 0 && skippedCount > 0) {
        appendLog("本轮镜头配音未重新生成：全部对白镜头已存在配音且启用了“跳过已生成”", "error");
      }
      if (attemptedCount === 0 && skippedEmptyDialogue > 0 && skippedCount === 0) {
        pushToast("当前镜头都没有对白，已跳过配音生成", "warning");
      } else {
        pushToast(
          retryFailedOnly ? `镜头配音重试完成，成功 ${successCount} 条` : `镜头配音生成完成，成功 ${successCount} 条`,
          "success"
        );
      }
      return successCount > 0 || skippedCount > 0;
    } catch (error) {
      const message = String(error);
      setPipelineState(`镜头配音生成异常：${message}`);
      appendLog(`镜头配音生成异常：${message}`, "error");
      pushToast(`镜头配音生成异常：${message}`, "error");
      return false;
    } finally {
      setPhase("idle");
    }
  };

  const onGenerateImages = async (retryFailedOnly = false): Promise<boolean> => {
    try {
      if (phase === "running") {
        appendLog("分镜图生成被跳过：当前已有任务在运行", "error");
        return false;
      }
      if (scopedShots.length === 0) {
        appendLog("分镜图生成被跳过：当前没有镜头", "error");
        return false;
      }
      const shotsForRun = getScopedShotsSnapshot();
      let runtimeSettings = settings;
      if (!runtimeSettings.imageWorkflowJson.trim()) {
        runtimeSettings = { ...runtimeSettings, imageWorkflowJson: FISHER_WORKFLOW_JSON };
        persistSettings((previous) => ({ ...previous, imageWorkflowJson: FISHER_WORKFLOW_JSON }));
        appendLog("图片工作流为空，已自动恢复为内置默认工作流", "error");
        pushToast("图片工作流为空，已自动恢复默认工作流", "warning");
      }
      const inferredInput = inferInputDirFromSettings(runtimeSettings);
      const hasReferenceNeed = shotsForRun.some((shot) => (shot.characterRefs?.length ?? 0) > 0 || Boolean(shot.sceneRefId?.trim()));
      if (!inferredInput && hasReferenceNeed) {
        appendLog("未配置 ComfyUI input 目录：将跳过角色/场景参考图注入，仅使用文本提示生成", "error");
        pushToast("未配置 ComfyUI input 目录：本轮将忽略参考图注入", "warning");
      }
      if (!(await ensureComfyReady())) {
        pushToast("ComfyUI 未连接，请先启动 ComfyUI 桌面版", "error");
        setPipelineState("分镜图生成中断：ComfyUI 未连接");
        appendLog("分镜图生成中断：ComfyUI 未连接", "error");
        return false;
      }
      const check = validateWorkflowTemplate(runtimeSettings.imageWorkflowJson, runtimeSettings.tokenMapping);
      if (!check.ok) {
        pushToast(`图片工作流缺少必需 token：${check.missing.join(", ")}`, "error");
        appendLog(`图片工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
        setPipelineState("分镜图生成中断：图片工作流预检失败");
        return false;
      }
      setPhase("running");
      let successCount = 0;
      let attemptedCount = 0;
      let skippedCount = 0;
      appendLog(retryFailedOnly ? "开始重试失败分镜图" : "开始生成分镜图");
      for (let index = 0; index < shotsForRun.length; index += 1) {
        const shot = shotsForRun[index];
        if (retryFailedOnly && imageStatusByShot[shot.id] !== "failed") continue;
        if (skipExisting && !retryFailedOnly && shot.generatedImagePath?.trim()) {
          skippedCount += 1;
          continue;
        }
        attemptedCount += 1;
        setPipelineState(`生成分镜图：${shot.title} (${index + 1}/${shotsForRun.length})`);
        const ok = await onGenerateSingle("image", shot.id, retryFailedOnly, runtimeSettings);
        if (ok) successCount += 1;
      }
      setPipelineState(retryFailedOnly ? "分镜图失败项重试完成" : "分镜图生成完成");
      appendLog(
        retryFailedOnly
          ? `分镜图失败重试完成，成功 ${successCount} 条，尝试 ${attemptedCount} 条`
          : `分镜图生成完成，成功 ${successCount} 条，尝试 ${attemptedCount} 条，跳过 ${skippedCount} 条`
      );
      if (!retryFailedOnly && attemptedCount === 0 && skippedCount > 0) {
        appendLog("本轮分镜图未重新生成：全部镜头已存在分镜图且启用了“跳过已生成”", "error");
      }
      pushToast(
        retryFailedOnly ? `分镜图重试完成，成功 ${successCount} 条` : `分镜图生成完成，成功 ${successCount} 条`,
        "success"
      );
      const readyImageCount = getScopedShotsSnapshot().filter((item) => item.generatedImagePath?.trim()).length;
      if (readyImageCount === 0) {
        setPipelineState("分镜图阶段未产出可用图片");
        appendLog("分镜图阶段未产出可用图片，已中断后续步骤", "error");
        if (attemptedCount > 0) {
          pushToast("分镜图全部失败，请先修复 input 目录或工作流问题", "error");
        } else {
          pushToast("没有可用分镜图，请先生成分镜图", "warning");
        }
        return false;
      }
      return true;
    } catch (error) {
      const message = String(error);
      setPipelineState(`分镜图生成异常：${message}`);
      appendLog(`分镜图生成异常：${message}`, "error");
      pushToast(`分镜图生成异常：${message}`, "error");
      return false;
    } finally {
      setPhase("idle");
    }
  };

  const onGenerateVideos = async (retryFailedOnly = false): Promise<boolean> => {
    try {
      if (phase === "running") {
        appendLog("镜头视频生成被跳过：当前已有任务在运行", "error");
        return false;
      }
      if (scopedShots.length === 0) {
        appendLog("镜头视频生成被跳过：当前没有镜头", "error");
        return false;
      }
      const shotsForRun = getScopedShotsSnapshot();
      let runtimeSettings = settings;
      if (!runtimeSettings.videoWorkflowJson.trim()) {
        runtimeSettings = { ...runtimeSettings, videoWorkflowJson: FISHER_WORKFLOW_JSON };
        persistSettings((previous) => ({ ...previous, videoWorkflowJson: FISHER_WORKFLOW_JSON }));
        appendLog("视频工作流为空，已自动恢复为内置默认工作流", "error");
        pushToast("视频工作流为空，已自动恢复默认工作流", "warning");
      }
      if (runtimeSettings.videoGenerationMode !== "local_motion") {
        if (!(await ensureComfyReady())) {
          pushToast("ComfyUI 未连接，请先启动 ComfyUI 桌面版", "error");
          setPipelineState("镜头视频生成中断：ComfyUI 未连接");
          appendLog("镜头视频生成中断：ComfyUI 未连接", "error");
          return false;
        }
        const check = validateWorkflowTemplate(runtimeSettings.videoWorkflowJson, runtimeSettings.tokenMapping);
        if (!check.ok) {
          pushToast(`视频工作流缺少必需 token：${check.missing.join(", ")}`, "error");
          appendLog(`视频工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
          setPipelineState("镜头视频生成中断：视频工作流预检失败");
          return false;
        }
      } else {
        appendLog("当前视频生成方式：Mac 兼容本地视频，不依赖 Comfy 视频工作流");
      }
      setPhase("running");
      let successCount = 0;
      let attemptedCount = 0;
      let skippedCount = 0;
      appendLog(retryFailedOnly ? "开始重试失败镜头视频" : "开始生成镜头视频");
      for (let index = 0; index < shotsForRun.length; index += 1) {
        const shot = shotsForRun[index];
        if (retryFailedOnly && videoStatusByShot[shot.id] !== "failed") continue;
        const hasLegacyInvalidVideoPath =
          Boolean(shot.generatedVideoPath?.trim()) && !looksLikeVideoPath(shot.generatedVideoPath ?? "");
        if (hasLegacyInvalidVideoPath) {
          updateShotFields(shot.id, { generatedVideoPath: "" });
          appendLog(`镜头视频路径不是可播放视频，已自动清空并重新生成：${shot.title}`, "error");
        }
        if (skipExisting && !retryFailedOnly && hasUsableGeneratedAsset("video", shot)) {
          skippedCount += 1;
          continue;
        }
        attemptedCount += 1;
        setPipelineState(`生成镜头视频：${shot.title} (${index + 1}/${shotsForRun.length})`);
        const ok = await onGenerateSingle("video", shot.id, retryFailedOnly, runtimeSettings);
        if (ok) successCount += 1;
      }
      setPipelineState(retryFailedOnly ? "镜头视频失败项重试完成" : "镜头视频生成完成");
      appendLog(
        retryFailedOnly
          ? `镜头视频失败重试完成，成功 ${successCount} 条，尝试 ${attemptedCount} 条`
          : `镜头视频生成完成，成功 ${successCount} 条，尝试 ${attemptedCount} 条，跳过 ${skippedCount} 条`
      );
      if (!retryFailedOnly && attemptedCount === 0 && skippedCount > 0) {
        appendLog("本轮镜头视频未重新生成：全部镜头已存在视频且启用了“跳过已生成”", "error");
      }
      pushToast(
        retryFailedOnly ? `镜头视频重试完成，成功 ${successCount} 条` : `镜头视频生成完成，成功 ${successCount} 条`,
        "success"
      );
      const readyVideoCount = getScopedShotsSnapshot().filter((item) =>
        hasUsableGeneratedAsset("video", item)
      ).length;
      if (readyVideoCount === 0) {
        setPipelineState("镜头视频阶段未产出可用视频");
        appendLog("镜头视频阶段未产出可用视频，已中断拼接步骤", "error");
        if (attemptedCount > 0) {
          pushToast("镜头视频全部失败，请检查 Comfy 工作流与模型", "error");
        }
        return false;
      }
      return true;
    } catch (error) {
      const message = String(error);
      setPipelineState(`镜头视频生成异常：${message}`);
      appendLog(`镜头视频生成异常：${message}`, "error");
      pushToast(`镜头视频生成异常：${message}`, "error");
      return false;
    } finally {
      setPhase("idle");
    }
  };

  const onGenerateSoundDesign = async (retryFailedOnly = false): Promise<boolean> => {
    try {
      if (phase === "running") {
        appendLog("环境/音效生成被跳过：当前已有任务在运行", "error");
        return false;
      }
      if (scopedShots.length === 0) {
        appendLog("环境/音效生成被跳过：当前没有镜头", "error");
        return false;
      }
      if (!settings.soundWorkflowJson?.trim()) {
        appendLog("环境/音效生成跳过：未配置环境/音效工作流", "error");
        return false;
      }
      if (!(await ensureComfyReady())) {
        pushToast("ComfyUI 未连接，请先启动 ComfyUI 桌面版", "error");
        setPipelineState("环境/音效生成中断：ComfyUI 未连接");
        appendLog("环境/音效生成中断：ComfyUI 未连接", "error");
        return false;
      }
      const check = validateWorkflowTemplate(settings.soundWorkflowJson, settings.tokenMapping, [
        settings.tokenMapping.prompt.trim() || "PROMPT"
      ]);
      if (!check.ok) {
        pushToast(`环境/音效工作流缺少必需 token：${check.missing.join(", ")}`, "error");
        appendLog(`环境/音效工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
        setPipelineState("环境/音效生成中断：工作流预检失败");
        return false;
      }

      const shotsForRun = getScopedShotsSnapshot();
      const latestAssets = useStoryboardStore.getState().assets;
      const assetRuntimeSettings: ComfySettings = {
        ...settings,
        renderWidth: project.width,
        renderHeight: project.height,
        renderFps: project.fps
      };
      setPhase("running");
      let successCount = 0;
      let attemptedCount = 0;
      let skippedCount = 0;
      appendLog(retryFailedOnly ? "开始重试失败环境/音效" : "开始生成环境/音效");
      for (let index = 0; index < shotsForRun.length; index += 1) {
        const shot = shotsForRun[index]!;
        const cues = buildShotSoundCues(shot);
        if (cues.length === 0) continue;
        if (retryFailedOnly && audioStatusByShot[shot.id] !== "failed") continue;

        const startFrame = selectShotStartFrame(useStoryboardStore.getState(), shot.id);
        const existingForShot = cues.every((cue) =>
          looksLikeAudioPath(audioTracks.find((track) => track.id === soundTrackIdForShot(shot.id, cue.kind))?.filePath ?? "")
        );
        if (skipExisting && !retryFailedOnly && existingForShot) {
          skippedCount += 1;
          continue;
        }

        attemptedCount += 1;
        setAssetStatus("audio", shot.id, "running");
        let shotSuccess = true;
        for (const cue of cues) {
          try {
            const output = await generateShotAsset(
              assetRuntimeSettings,
              shot,
              index,
              "audio",
              shotsForRun,
              latestAssets,
              {
                workflowJsonOverride: settings.soundWorkflowJson,
                tokenOverrides: {
                  PROMPT: cue.prompt,
                  DIALOGUE: "",
                  SHOT_TITLE: `${shot.title} ${cue.kind}`
                },
                onProgress: (progress, message) => {
                  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
                  setPipelineState(
                    `生成环境/音效：${shot.title} / ${cue.kind}（${pct}%）${message ? ` · ${message}` : ""}`
                  );
                }
              }
            );
            upsertAudioTrack({
              id: soundTrackIdForShot(shot.id, cue.kind),
              projectId: project.id,
              filePath: output.localPath || output.previewUrl,
              startFrame,
              gain: cue.gain,
              kind:
                cue.kind === "ambience"
                  ? "ambience"
                  : cue.kind === "character"
                    ? "character_sfx"
                    : "prop_sfx",
              label:
                cue.kind === "ambience"
                  ? `${shot.title} / 环境音`
                  : cue.kind === "character"
                    ? `${shot.title} / 人物音效`
                    : `${shot.title} / 道具音效`
            });
            appendLog(`环境/音效生成成功：${shot.title} / ${cue.kind} -> ${output.localPath || output.previewUrl}`);
          } catch (error) {
            shotSuccess = false;
            const message = String(error);
            setLastErrorByShot((previous) => ({ ...previous, [shot.id]: message }));
            appendLog(`环境/音效生成失败：${shot.title} / ${cue.kind}，${message}`, "error");
          }
        }
        setAssetStatus("audio", shot.id, shotSuccess ? "success" : "failed");
        if (shotSuccess) successCount += 1;
      }

      setPipelineState(retryFailedOnly ? "环境/音效失败项重试完成" : "环境/音效生成完成");
      appendLog(
        retryFailedOnly
          ? `环境/音效失败重试完成，成功 ${successCount} 条，尝试 ${attemptedCount} 条`
          : `环境/音效生成完成，成功 ${successCount} 条，尝试 ${attemptedCount} 条，跳过 ${skippedCount} 条`
      );
      if (successCount > 0) {
        appendLog("环境音、人物动作音、道具音已自动加入时间轴音轨。");
      }
      return successCount > 0 || skippedCount > 0;
    } catch (error) {
      const message = String(error);
      setPipelineState(`环境/音效生成异常：${message}`);
      appendLog(`环境/音效生成异常：${message}`, "error");
      pushToast(`环境/音效生成异常：${message}`, "error");
      return false;
    } finally {
      setPhase("idle");
    }
  };

  const onConcatVideos = async (): Promise<boolean> => {
    try {
      const allPaths = getScopedShotsSnapshot()
        .map((shot) => shot.generatedVideoPath?.trim() ?? "")
        .filter((path) => path.length > 0);
      const paths = allPaths.filter((path) => looksLikeVideoPath(path));
      const skippedNonVideo = allPaths.length - paths.length;
      if (skippedNonVideo > 0) {
        appendLog(`拼接前已跳过 ${skippedNonVideo} 条非视频路径（历史遗留图片路径）`, "error");
      }
      if (paths.length === 0) {
        pushToast("没有可拼接的视频路径", "warning");
        appendLog("视频拼接跳过：没有可用视频路径", "error");
        setPipelineState("视频拼接中断：没有可用视频路径");
        return false;
      }
      setPipelineState("拼接整片视频中...");
      appendLog(`开始拼接整片视频，共 ${paths.length} 段`);
      const output = await concatShotVideos(paths);
      if (!output) {
        pushToast("拼接失败：未返回输出路径", "error");
        appendLog("视频拼接失败：未返回输出路径", "error");
        setPipelineState("视频拼接失败：未返回输出路径");
        return false;
      }
      let finalOutput = output;
      const usableAudioTracks = useStoryboardStore
        .getState()
        .audioTracks.filter((track) => looksLikeAudioPath(track.filePath));
      if (usableAudioTracks.length > 0) {
        appendLog(`开始融合整片音频，共 ${usableAudioTracks.length} 条音轨`);
        const { muxVideoWithAudioTracks } = await loadExportService();
        const muxed = await muxVideoWithAudioTracks({
          videoPath: output,
          fps: project.fps,
          audioTracks: usableAudioTracks
        });
        if (muxed) {
          finalOutput = muxed;
          appendLog(`整片音频融合成功：${muxed}`);
        }
      }
      setPreviewVideoPath(finalOutput);
      setPipelineState(`整片预览已生成：${finalOutput}`);
      pushToast("整片预览视频已生成", "success");
      appendLog(`整片视频拼接成功：${finalOutput}`);
      return true;
    } catch (error) {
      setPipelineState(`视频拼接失败：${String(error)}`);
      pushToast(`视频拼接失败：${String(error)}`, "error");
      appendLog(`视频拼接失败：${String(error)}`, "error");
      return false;
    }
  };

  const onGenerateAll = async () => {
    if (phase === "running" || runAllActive) {
      pushToast("已有生成任务在运行中，请稍后再试", "warning");
      appendLog("一键生成整片被忽略：已有任务在运行中", "error");
      return;
    }
    const shotsForRun = getScopedShotsSnapshot();
    if (shotsForRun.length === 0) {
      pushToast("请先导入分镜脚本", "warning");
      setPipelineState("一键生成中断：没有可用镜头");
      appendLog("一键生成中断：没有可用镜头", "error");
      return;
    }
    setRunAllActive(true);
    setRunAllProgress(3);
    setRunAllStage("准备开始");
    appendLog(`一键生成整片开始，共 ${shotsForRun.length} 个镜头`);
    pushToast("已开始一键生成整片", "success");
    try {
      setPipelineState("一键生成整片：步骤 1/5 生成分镜图");
      setRunAllProgress(12);
      setRunAllStage("步骤 1/5 生成分镜图");
      const imageOk = await onGenerateImages(false);
      if (!imageOk) {
        setPipelineState("一键生成中断：分镜图阶段未完成");
        appendLog("一键生成中断：分镜图阶段未完成", "error");
        return;
      }

      setPipelineState("一键生成整片：步骤 2/5 生成镜头视频");
      setRunAllProgress(38);
      setRunAllStage("步骤 2/5 生成镜头视频");
      const videoOk = await onGenerateVideos(false);
      if (!videoOk) {
        setPipelineState("一键生成中断：镜头视频阶段未完成");
        appendLog("一键生成中断：镜头视频阶段未完成", "error");
        return;
      }

      setPipelineState("一键生成整片：步骤 3/5 生成镜头配音");
      setRunAllProgress(58);
      setRunAllStage("步骤 3/5 生成镜头配音");
      if (settings.audioWorkflowJson?.trim()) {
        const audioOk = await onGenerateAudios(false);
        if (!audioOk) {
          appendLog("一键生成提示：镜头配音阶段未产出可用结果，继续后续流程", "error");
        }
      } else {
        appendLog("一键生成提示：未配置配音工作流，已跳过镜头配音");
      }

      setPipelineState("一键生成整片：步骤 4/5 生成环境/音效");
      setRunAllProgress(74);
      setRunAllStage("步骤 4/5 生成环境/音效");
      if (settings.soundWorkflowJson?.trim()) {
        const soundOk = await onGenerateSoundDesign(false);
        if (!soundOk) {
          appendLog("一键生成提示：环境/音效阶段未产出可用结果，继续后续流程", "error");
        }
      } else {
        appendLog("一键生成提示：未配置环境/音效工作流，已跳过环境/音效生成");
      }

      setPipelineState("一键生成整片：步骤 5/5 拼接整片并融合音频");
      setRunAllProgress(88);
      setRunAllStage("步骤 5/5 拼接整片并融合音频");
      const concatOk = await onConcatVideos();
      if (!concatOk) {
        setPipelineState("一键生成中断：整片拼接未完成");
        appendLog("一键生成中断：整片拼接未完成", "error");
        return;
      }

      setRunAllProgress(100);
      setRunAllStage("全部完成");
      appendLog("一键生成整片完成");
    } catch (error) {
      const message = String(error);
      setPipelineState(`一键生成异常：${message}`);
      appendLog(`一键生成异常：${message}`, "error");
      pushToast(`一键生成异常：${message}`, "error");
    } finally {
      setRunAllActive(false);
    }
  };

  const onUpdateShotPrompt = (shotId: string, value: string) => {
    updateShotFields(shotId, { storyPrompt: value });
  };

  const onUpdateShotVideoPrompt = (shotId: string, value: string) => {
    const currentPrompt = shots.find((item) => item.id === shotId)?.videoPrompt ?? "";
    const preset = extractLocalMotionPresetFromText(currentPrompt);
    updateShotFields(shotId, { videoPrompt: withLocalMotionToken(value, preset) });
  };

  const onUpdateShotVideoMode = (shotId: string, value: string) => {
    if (value !== "auto" && value !== "single_frame" && value !== "first_last_frame") return;
    updateShotFields(shotId, { videoMode: value });
  };

  const onUpdateShotLocalMotionPreset = (shotId: string, value: string) => {
    if (
      value !== "auto" &&
      value !== "still" &&
      value !== "fade" &&
      value !== "push_in" &&
      value !== "push_out" &&
      value !== "pan_left" &&
      value !== "pan_right"
    ) {
      return;
    }
    const currentPrompt = shots.find((item) => item.id === shotId)?.videoPrompt ?? "";
    updateShotFields(shotId, {
      videoPrompt: withLocalMotionToken(currentPrompt, value)
    });
  };

  const onUpdateShotVideoFramePath = (shotId: string, key: "videoStartFramePath" | "videoEndFramePath", value: string) => {
    updateShotFields(shotId, { [key]: value } as { videoStartFramePath?: string; videoEndFramePath?: string });
  };

  const onUpdateShotSeed = (shotId: string, value: string) => {
    const trimmed = value.trim();
    const seed = trimmed.length === 0 ? undefined : Number(trimmed);
    if (seed !== undefined && !Number.isFinite(seed)) return;
    updateShotFields(shotId, { seed });
  };

  const onUpdateShotDurationSec = (shotId: string, value: string) => {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const fps = 24;
    setShotDuration(shotId, Math.max(1, Math.round(seconds * fps)));
  };

  return (
    <section className="panel comfy-panel">
      <header className="panel-header">
        <div className="comfy-title-block">
          <h2>AI 流水线</h2>
          <small>连接 ComfyUI · 导入分镜 · 一键生成整片</small>
        </div>
      </header>
      <section className="comfy-stage">
        <div className="comfy-stage-head">
          <span className="comfy-stage-index">01</span>
          <h3>连接与路径</h3>
        </div>
        <div className="timeline-meta comfy-status-bar">
          <span className={`comfy-status-chip ${connectionLabel === "已连接" ? "is-ok" : "is-bad"}`}>{connectionLabel}</span>
          <span className="comfy-status-text">{pipelineState}</span>
        </div>
        {runAllActive && (
          <div className="comfy-run-progress" role="status" aria-live="polite">
            <div className="comfy-run-progress-meta">
              <strong>{runAllStage || "执行中"}</strong>
              <span>{Math.max(0, Math.min(100, Math.round(runAllProgress)))}%</span>
            </div>
            <progress max={100} value={Math.max(0, Math.min(100, runAllProgress))} />
          </div>
        )}
        <div className="comfy-path-grid">
          <label>
            ComfyUI 输出目录（用于视频拼接）
            <input
              onChange={(event) => persistSettings((previous) => ({ ...previous, outputDir: event.target.value }))}
              placeholder="/path/to/ComfyUI/output"
              type="text"
              value={settings.outputDir}
            />
          </label>
          <label>
            ComfyUI input 目录（用于自动喂图）
            <input
              onChange={(event) => persistSettings((previous) => ({ ...previous, comfyInputDir: event.target.value }))}
              placeholder="/path/to/ComfyUI/input（留空将按 output 同级推断）"
              type="text"
              value={settings.comfyInputDir}
            />
          </label>
        </div>
        <details className="export-panel comfy-advanced-panel">
          <summary>高级连接与工作流设置</summary>
          <div className="timeline-actions comfy-connection-actions">
            <button className="btn-ghost" onClick={() => void onAutoDetectComfy()} type="button">自动探测地址</button>
            <button className="btn-ghost" onClick={onCheckConnection} type="button">检测连接</button>
          </div>
          <label>
            ComfyUI 根目录（用于自动安装插件）
            <input
              onChange={(event) => persistSettings((previous) => ({ ...previous, comfyRootDir: event.target.value }))}
              placeholder="/path/to/ComfyUI（留空将按 output/input 推断）"
              type="text"
              value={settings.comfyRootDir}
            />
          </label>
        <label>
          ComfyUI 地址（手动覆盖）
          <input
            onChange={(event) => persistSettings((previous) => ({ ...previous, baseUrl: event.target.value }))}
            placeholder="http://127.0.0.1:8000"
            type="text"
            value={settings.baseUrl}
          />
        </label>
        <label>
          视频生成方式
          <select
            onChange={(event) =>
              persistSettings((previous) => ({
                ...previous,
                videoGenerationMode: event.target.value as "comfy" | "local_motion"
              }))
            }
            value={settings.videoGenerationMode ?? defaultVideoGenerationMode()}
          >
            <option value="local_motion">Mac 兼容本地视频</option>
            <option value="comfy">ComfyUI 视频工作流</option>
          </select>
        </label>
        {settings.videoGenerationMode === "local_motion" && (
          <div className="timeline-meta">
            本模式不依赖 ComfyUI 视频模型。会用当前分镜图或首尾帧在本地生成可拼接的镜头视频，适合 Mac。
          </div>
        )}
        <label className="comfy-script-block">
          配音工作流（JSON）
          <textarea
            onChange={(event) =>
              persistSettings((previous) => ({ ...previous, audioWorkflowJson: event.target.value }))
            }
            placeholder='粘贴 ComfyUI TTS API 工作流 JSON，建议至少使用 {{DIALOGUE}} 占位'
            rows={5}
            value={settings.audioWorkflowJson ?? ""}
          />
        </label>
        <div className="timeline-meta">
          对白支持写法：角色名: 台词、角色名(压低声音,急促): 台词、【旁白|低沉】内容。配音工作流可选 token：
          {" {{SPEAKER_NAME}} / {{EMOTION}} / {{DELIVERY_STYLE}} / {{SPEECH_RATE}}"}
        </div>
        <label className="comfy-script-block">
          环境/音效工作流（JSON）
          <textarea
            onChange={(event) =>
              persistSettings((previous) => ({ ...previous, soundWorkflowJson: event.target.value }))
            }
            placeholder='粘贴 ComfyUI 音效生成工作流 JSON，建议至少使用 {{PROMPT}} 占位'
            rows={5}
            value={settings.soundWorkflowJson ?? ""}
          />
        </label>
        <div className="timeline-actions">
          <button
            className="btn-ghost"
            onClick={() => {
              const check = validateWorkflowTemplate(settings.imageWorkflowJson, settings.tokenMapping);
              if (!check.ok) {
                pushToast(`图片工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
                appendLog(`图片工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
              } else {
                if (check.used.length === 0) {
                  pushToast("图片工作流预检通过（未检测到 token，占位由节点绑定处理）", "success");
                  appendLog("图片工作流预检通过：未检测到 token，将使用节点绑定模式");
                } else {
                  pushToast(`图片工作流预检通过（检测到 ${check.used.length} 个 token）`, "success");
                  appendLog(`图片工作流预检通过，检测到 ${check.used.length} 个 token`);
                }
              }
            }}
            type="button"
          >
            预检图片工作流
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              const check = validateWorkflowTemplate(settings.videoWorkflowJson, settings.tokenMapping);
              if (!check.ok) {
                pushToast(`视频工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
                appendLog(`视频工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
              } else {
                if (check.used.length === 0) {
                  pushToast("视频工作流预检通过（未检测到 token，占位由节点绑定处理）", "success");
                  appendLog("视频工作流预检通过：未检测到 token，将使用节点绑定模式");
                } else {
                  pushToast(`视频工作流预检通过（检测到 ${check.used.length} 个 token）`, "success");
                  appendLog(`视频工作流预检通过，检测到 ${check.used.length} 个 token`);
                }
              }
            }}
            type="button"
          >
            预检视频工作流
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              if (!settings.audioWorkflowJson?.trim()) {
                pushToast("请先粘贴配音工作流 JSON", "warning");
                appendLog("配音工作流预检跳过：未配置工作流 JSON", "error");
                return;
              }
              const check = validateWorkflowTemplate(settings.audioWorkflowJson, settings.tokenMapping, [
                settings.tokenMapping.dialogue.trim() || "DIALOGUE"
              ]);
              if (!check.ok) {
                pushToast(`配音工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
                appendLog(`配音工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
              } else {
                if (check.used.length === 0) {
                  pushToast("配音工作流预检通过（未检测到 token，占位由节点绑定处理）", "success");
                  appendLog("配音工作流预检通过：未检测到 token，将使用节点绑定模式");
                } else {
                  pushToast(`配音工作流预检通过（检测到 ${check.used.length} 个 token）`, "success");
                  appendLog(`配音工作流预检通过，检测到 ${check.used.length} 个 token`);
                }
              }
            }}
            type="button"
          >
            预检配音工作流
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              if (!settings.soundWorkflowJson?.trim()) {
                pushToast("请先粘贴环境/音效工作流 JSON", "warning");
                appendLog("环境/音效工作流预检跳过：未配置工作流 JSON", "error");
                return;
              }
              const check = validateWorkflowTemplate(settings.soundWorkflowJson, settings.tokenMapping, [
                settings.tokenMapping.prompt.trim() || "PROMPT"
              ]);
              if (!check.ok) {
                pushToast(`环境/音效工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
                appendLog(`环境/音效工作流预检失败：缺少 ${check.missing.join(", ")}`, "error");
              } else {
                if (check.used.length === 0) {
                  pushToast("环境/音效工作流预检通过（未检测到 token，占位由节点绑定处理）", "success");
                  appendLog("环境/音效工作流预检通过：未检测到 token，将使用节点绑定模式");
                } else {
                  pushToast(`环境/音效工作流预检通过（检测到 ${check.used.length} 个 token）`, "success");
                  appendLog(`环境/音效工作流预检通过，检测到 ${check.used.length} 个 token`);
                }
              }
            }}
            type="button"
          >
            预检环境/音效工作流
          </button>
        </div>
        <h3>工作流字段映射</h3>
        <div className="comfy-mapping-grid">
          <label>
            Prompt Token
            <input
              onChange={(event) => onUpdateTokenMapping("prompt", event.target.value)}
              placeholder="PROMPT"
              type="text"
              value={settings.tokenMapping.prompt}
            />
          </label>
          <label>
            NextScene Token
            <input
              onChange={(event) => onUpdateTokenMapping("nextScenePrompt", event.target.value)}
              placeholder="NEXT_SCENE_PROMPT"
              type="text"
              value={settings.tokenMapping.nextScenePrompt}
            />
          </label>
          <label>
            VideoPrompt Token
            <input
              onChange={(event) => onUpdateTokenMapping("videoPrompt", event.target.value)}
              placeholder="VIDEO_PROMPT"
              type="text"
              value={settings.tokenMapping.videoPrompt}
            />
          </label>
          <label>
            VideoMode Token
            <input
              onChange={(event) => onUpdateTokenMapping("videoMode", event.target.value)}
              placeholder="VIDEO_MODE"
              type="text"
              value={settings.tokenMapping.videoMode}
            />
          </label>
          <label>
            Negative Token
            <input
              onChange={(event) => onUpdateTokenMapping("negativePrompt", event.target.value)}
              placeholder="NEGATIVE_PROMPT"
              type="text"
              value={settings.tokenMapping.negativePrompt}
            />
          </label>
          <label>
            Seed Token
            <input
              onChange={(event) => onUpdateTokenMapping("seed", event.target.value)}
              placeholder="SEED"
              type="text"
              value={settings.tokenMapping.seed}
            />
          </label>
          <label>
            Title Token
            <input
              onChange={(event) => onUpdateTokenMapping("title", event.target.value)}
              placeholder="SHOT_TITLE"
              type="text"
              value={settings.tokenMapping.title}
            />
          </label>
          <label>
            Dialogue Token
            <input
              onChange={(event) => onUpdateTokenMapping("dialogue", event.target.value)}
              placeholder="DIALOGUE"
              type="text"
              value={settings.tokenMapping.dialogue}
            />
          </label>
          <label>
            SpeakerName Token
            <input
              onChange={(event) => onUpdateTokenMapping("speakerName", event.target.value)}
              placeholder="SPEAKER_NAME"
              type="text"
              value={settings.tokenMapping.speakerName}
            />
          </label>
          <label>
            Emotion Token
            <input
              onChange={(event) => onUpdateTokenMapping("emotion", event.target.value)}
              placeholder="EMOTION"
              type="text"
              value={settings.tokenMapping.emotion}
            />
          </label>
          <label>
            DeliveryStyle Token
            <input
              onChange={(event) => onUpdateTokenMapping("deliveryStyle", event.target.value)}
              placeholder="DELIVERY_STYLE"
              type="text"
              value={settings.tokenMapping.deliveryStyle}
            />
          </label>
          <label>
            SpeechRate Token
            <input
              onChange={(event) => onUpdateTokenMapping("speechRate", event.target.value)}
              placeholder="SPEECH_RATE"
              type="text"
              value={settings.tokenMapping.speechRate}
            />
          </label>
          <label>
            VoiceProfile Token
            <input
              onChange={(event) => onUpdateTokenMapping("voiceProfile", event.target.value)}
              placeholder="VOICE_PROFILE"
              type="text"
              value={settings.tokenMapping.voiceProfile}
            />
          </label>
          <label>
            CharacterVoiceProfiles Token
            <input
              onChange={(event) => onUpdateTokenMapping("characterVoiceProfiles", event.target.value)}
              placeholder="CHARACTER_VOICE_PROFILES"
              type="text"
              value={settings.tokenMapping.characterVoiceProfiles}
            />
          </label>
          <label>
            DurationFrames Token
            <input
              onChange={(event) => onUpdateTokenMapping("durationFrames", event.target.value)}
              placeholder="DURATION_FRAMES"
              type="text"
              value={settings.tokenMapping.durationFrames}
            />
          </label>
          <label>
            DurationSec Token
            <input
              onChange={(event) => onUpdateTokenMapping("durationSec", event.target.value)}
              placeholder="DURATION_SEC"
              type="text"
              value={settings.tokenMapping.durationSec}
            />
          </label>
          <label>
            CharacterRefs Token
            <input
              onChange={(event) => onUpdateTokenMapping("characterRefs", event.target.value)}
              placeholder="CHARACTER_REFS"
              type="text"
              value={settings.tokenMapping.characterRefs}
            />
          </label>
          <label>
            SceneRefPath Token
            <input
              onChange={(event) => onUpdateTokenMapping("sceneRefPath", event.target.value)}
              placeholder="SCENE_REF_PATH"
              type="text"
              value={settings.tokenMapping.sceneRefPath}
            />
          </label>
          <label>
            SceneRefName Token
            <input
              onChange={(event) => onUpdateTokenMapping("sceneRefName", event.target.value)}
              placeholder="SCENE_REF_NAME"
              type="text"
              value={settings.tokenMapping.sceneRefName}
            />
          </label>
          <label>
            CharacterRefPaths Token
            <input
              onChange={(event) => onUpdateTokenMapping("characterRefPaths", event.target.value)}
              placeholder="CHARACTER_REF_PATHS"
              type="text"
              value={settings.tokenMapping.characterRefPaths}
            />
          </label>
          <label>
            CharacterRefNames Token
            <input
              onChange={(event) => onUpdateTokenMapping("characterRefNames", event.target.value)}
              placeholder="CHARACTER_REF_NAMES"
              type="text"
              value={settings.tokenMapping.characterRefNames}
            />
          </label>
          <label>
            CharacterFrontPaths Token
            <input
              onChange={(event) => onUpdateTokenMapping("characterFrontPaths", event.target.value)}
              placeholder="CHARACTER_FRONT_PATHS"
              type="text"
              value={settings.tokenMapping.characterFrontPaths}
            />
          </label>
          <label>
            CharacterSidePaths Token
            <input
              onChange={(event) => onUpdateTokenMapping("characterSidePaths", event.target.value)}
              placeholder="CHARACTER_SIDE_PATHS"
              type="text"
              value={settings.tokenMapping.characterSidePaths}
            />
          </label>
          <label>
            CharacterBackPaths Token
            <input
              onChange={(event) => onUpdateTokenMapping("characterBackPaths", event.target.value)}
              placeholder="CHARACTER_BACK_PATHS"
              type="text"
              value={settings.tokenMapping.characterBackPaths}
            />
          </label>
          <label>
            Char1Name Token
            <input
              onChange={(event) => onUpdateTokenMapping("character1Name", event.target.value)}
              placeholder="CHAR1_NAME"
              type="text"
              value={settings.tokenMapping.character1Name}
            />
          </label>
          <label>
            Char1Front Token
            <input
              onChange={(event) => onUpdateTokenMapping("character1FrontPath", event.target.value)}
              placeholder="CHAR1_FRONT_PATH"
              type="text"
              value={settings.tokenMapping.character1FrontPath}
            />
          </label>
          <label>
            Char1Side Token
            <input
              onChange={(event) => onUpdateTokenMapping("character1SidePath", event.target.value)}
              placeholder="CHAR1_SIDE_PATH"
              type="text"
              value={settings.tokenMapping.character1SidePath}
            />
          </label>
          <label>
            Char1Back Token
            <input
              onChange={(event) => onUpdateTokenMapping("character1BackPath", event.target.value)}
              placeholder="CHAR1_BACK_PATH"
              type="text"
              value={settings.tokenMapping.character1BackPath}
            />
          </label>
          <label>
            Char2Name Token
            <input
              onChange={(event) => onUpdateTokenMapping("character2Name", event.target.value)}
              placeholder="CHAR2_NAME"
              type="text"
              value={settings.tokenMapping.character2Name}
            />
          </label>
          <label>
            Char2Front Token
            <input
              onChange={(event) => onUpdateTokenMapping("character2FrontPath", event.target.value)}
              placeholder="CHAR2_FRONT_PATH"
              type="text"
              value={settings.tokenMapping.character2FrontPath}
            />
          </label>
          <label>
            Char2Side Token
            <input
              onChange={(event) => onUpdateTokenMapping("character2SidePath", event.target.value)}
              placeholder="CHAR2_SIDE_PATH"
              type="text"
              value={settings.tokenMapping.character2SidePath}
            />
          </label>
          <label>
            Char2Back Token
            <input
              onChange={(event) => onUpdateTokenMapping("character2BackPath", event.target.value)}
              placeholder="CHAR2_BACK_PATH"
              type="text"
              value={settings.tokenMapping.character2BackPath}
            />
          </label>
          <label>
            Char3Name Token
            <input
              onChange={(event) => onUpdateTokenMapping("character3Name", event.target.value)}
              placeholder="CHAR3_NAME"
              type="text"
              value={settings.tokenMapping.character3Name}
            />
          </label>
          <label>
            Char3Front Token
            <input
              onChange={(event) => onUpdateTokenMapping("character3FrontPath", event.target.value)}
              placeholder="CHAR3_FRONT_PATH"
              type="text"
              value={settings.tokenMapping.character3FrontPath}
            />
          </label>
          <label>
            Char3Side Token
            <input
              onChange={(event) => onUpdateTokenMapping("character3SidePath", event.target.value)}
              placeholder="CHAR3_SIDE_PATH"
              type="text"
              value={settings.tokenMapping.character3SidePath}
            />
          </label>
          <label>
            Char3Back Token
            <input
              onChange={(event) => onUpdateTokenMapping("character3BackPath", event.target.value)}
              placeholder="CHAR3_BACK_PATH"
              type="text"
              value={settings.tokenMapping.character3BackPath}
            />
          </label>
          <label>
            Char4Name Token
            <input
              onChange={(event) => onUpdateTokenMapping("character4Name", event.target.value)}
              placeholder="CHAR4_NAME"
              type="text"
              value={settings.tokenMapping.character4Name}
            />
          </label>
          <label>
            Char4Front Token
            <input
              onChange={(event) => onUpdateTokenMapping("character4FrontPath", event.target.value)}
              placeholder="CHAR4_FRONT_PATH"
              type="text"
              value={settings.tokenMapping.character4FrontPath}
            />
          </label>
          <label>
            Char4Side Token
            <input
              onChange={(event) => onUpdateTokenMapping("character4SidePath", event.target.value)}
              placeholder="CHAR4_SIDE_PATH"
              type="text"
              value={settings.tokenMapping.character4SidePath}
            />
          </label>
          <label>
            Char4Back Token
            <input
              onChange={(event) => onUpdateTokenMapping("character4BackPath", event.target.value)}
              placeholder="CHAR4_BACK_PATH"
              type="text"
              value={settings.tokenMapping.character4BackPath}
            />
          </label>
          <label>
            FrameImagePath Token
            <input
              onChange={(event) => onUpdateTokenMapping("frameImagePath", event.target.value)}
              placeholder="FRAME_IMAGE_PATH"
              type="text"
              value={settings.tokenMapping.frameImagePath}
            />
          </label>
          <label>
            FirstFrame Token
            <input
              onChange={(event) => onUpdateTokenMapping("firstFramePath", event.target.value)}
              placeholder="FIRST_FRAME_PATH"
              type="text"
              value={settings.tokenMapping.firstFramePath}
            />
          </label>
          <label>
            LastFrame Token
            <input
              onChange={(event) => onUpdateTokenMapping("lastFramePath", event.target.value)}
              placeholder="LAST_FRAME_PATH"
              type="text"
              value={settings.tokenMapping.lastFramePath}
            />
          </label>
        </div>
        <small>
          {"工作流里使用 {{TOKEN}} 占位。分镜建议用 {{NEXT_SCENE_PROMPT}}，视频建议用 {{VIDEO_PROMPT}} 与 {{VIDEO_MODE}}，配音建议用 {{DIALOGUE}}，环境/音效建议用 {{PROMPT}}。"}
        </small>
        </details>
      </section>

      <section className="comfy-stage">
        <div className="comfy-stage-head">
          <span className="comfy-stage-index">02</span>
          <h3>生成执行</h3>
        </div>
        <label className="comfy-script-block">
          原始故事文本
          <textarea
            onChange={(event) => setStoryText(event.target.value)}
            placeholder={"输入故事正文、分段剧情或对白文本。我会先按段落/句子拆成镜头，再生成可导入的 shots JSON。"}
            rows={6}
            value={storyText}
          />
        </label>
        <div className="comfy-primary-actions">
          <button className="btn-ghost" onClick={() => onParseStory(false)} type="button">
            解析故事为镜头脚本
          </button>
          <button className="btn-ghost" onClick={() => onParseStory(true)} type="button">
            解析并直接导入
          </button>
        </div>
        <label className="comfy-script-block">
          已分镜脚本（JSON）
          <textarea
            onChange={(event) => setScriptText(event.target.value)}
            placeholder='{"shots":[{"title":"镜头1","prompt":"...","duration_sec":3}]}'
            rows={6}
            value={scriptText}
          />
        </label>
        <div className="comfy-primary-actions">
          <button className="btn-ghost" onClick={onImportScript} type="button">导入镜头脚本</button>
          <button className="btn-primary comfy-action-main" disabled={phase === "running" || runAllActive} onClick={() => void onGenerateAll()} type="button">
            一键生成整片
          </button>
          <label className="timeline-snap-toggle">
            <input
              checked={skipExisting}
              onChange={(event) => setSkipExisting(event.target.checked)}
              type="checkbox"
            />
            跳过已生成
          </label>
        </div>
        <details className="export-panel comfy-advanced-tools">
          <summary>高级动作（单步生成 / 重试 / 环境体检）</summary>
          <div className="timeline-actions comfy-main-actions">
            <button className="btn-ghost" disabled={phase === "running"} onClick={() => void onGenerateImages()} type="button">
              生成分镜图
            </button>
            <button className="btn-ghost" disabled={phase === "running"} onClick={() => void onGenerateVideos()} type="button">
              生成镜头视频
            </button>
            <button className="btn-ghost" disabled={phase === "running"} onClick={() => void onGenerateAudios()} type="button">
              生成镜头配音
            </button>
            <button className="btn-ghost" disabled={phase === "running"} onClick={() => void onGenerateSoundDesign()} type="button">
              生成环境/音效
            </button>
            <button className="btn-ghost" onClick={() => void onConcatVideos()} type="button">拼接整片预览</button>
            <button className="btn-ghost" disabled={phase === "running"} onClick={() => void onGenerateImages(true)} type="button">
              重试失败分镜图
            </button>
            <button className="btn-ghost" disabled={phase === "running"} onClick={() => void onGenerateVideos(true)} type="button">
              重试失败镜头视频
            </button>
            <button className="btn-ghost" disabled={phase === "running"} onClick={() => void onGenerateAudios(true)} type="button">
              重试失败镜头配音
            </button>
            <button className="btn-ghost" disabled={phase === "running"} onClick={() => void onGenerateSoundDesign(true)} type="button">
              重试失败环境/音效
            </button>
            <button className="btn-ghost" onClick={() => void onInspectWorkflows()} type="button">体检工作流依赖</button>
            <button className="btn-ghost" onClick={() => void onInstallSuggestedPlugins()} type="button">一键安装建议插件</button>
            <button className="btn-ghost" onClick={() => void onCheckModelHealth()} type="button">体检模型文件</button>
            <button className="btn-ghost" onClick={() => void onCopyModelChecklist()} type="button">复制模型下载清单</button>
          </div>
        </details>
        {previewVideoPath && (
          <div className="timeline-actions comfy-preview-actions">
            <small>{previewVideoPath}</small>
            <button
              onClick={async () => {
                const { openPathInOS } = await loadExportService();
                await openPathInOS(previewVideoPath);
              }}
              type="button"
            >
              打开预览视频
            </button>
          </div>
        )}
      </section>

      <section className="comfy-stage">
        <div className="comfy-stage-head">
          <span className="comfy-stage-index">03</span>
          <h3>运行监控</h3>
        </div>
        <div className="comfy-monitor-summary">
          <div className="comfy-summary-card">
            <small>镜头总数</small>
            <strong>{monitorSummary.totalShots}</strong>
          </div>
          <div className="comfy-summary-card">
            <small>分镜图 成功/失败</small>
            <strong>{monitorSummary.imageSuccess} / {monitorSummary.imageFailed}</strong>
          </div>
          <div className="comfy-summary-card">
            <small>视频 成功/失败</small>
            <strong>{monitorSummary.videoSuccess} / {monitorSummary.videoFailed}</strong>
          </div>
          <div className="comfy-summary-card">
            <small>配音 成功/失败</small>
            <strong>{monitorSummary.audioSuccess} / {monitorSummary.audioFailed}</strong>
          </div>
          <div className="comfy-summary-card">
            <small>错误日志</small>
            <strong>{monitorSummary.errorLogCount}</strong>
          </div>
        </div>
        <div className="comfy-monitor-grid">
          <details className="export-panel comfy-subpanel comfy-collapsible-panel">
            <summary>运行日志</summary>
            <div className="comfy-section-head">
              <h3>运行日志</h3>
            </div>
            <div className="timeline-actions comfy-log-actions">
              <button className="btn-ghost" onClick={() => void copyLogs()} type="button">复制日志</button>
              <button className="btn-ghost" onClick={() => setLogs([])} type="button">清空日志</button>
            </div>
            <div className="comfy-log-box">
              {logs.length === 0 ? (
                <div className="comfy-log-empty">暂无日志</div>
              ) : (
                logs.slice().reverse().map((item) => (
                  <div className={`comfy-log-line ${item.level === "error" ? "is-error" : ""}`} key={item.id}>
                    <code>[{item.timestamp}] [{item.level.toUpperCase()}]</code> {item.message}
                  </div>
                ))
              )}
            </div>
          </details>
          <details className="export-panel comfy-subpanel comfy-collapsible-panel">
            <summary>镜头状态（{visibleShots.length}）</summary>
            <div className="comfy-section-head">
              <h3>镜头状态</h3>
            </div>
            <div className="timeline-actions comfy-log-actions">
              <label className="timeline-snap-toggle">
                <input
                  checked={showShotEditor}
                  onChange={(event) => setShowShotEditor(event.target.checked)}
                  type="checkbox"
                />
                显示镜头参数编辑
              </label>
              <select onChange={(event) => setShotFilter(event.target.value as "all" | "failed")} value={shotFilter}>
                <option value="all">显示全部</option>
                <option value="failed">仅显示失败</option>
              </select>
            </div>
            <ul className="export-list comfy-shot-list">
            {visibleShots.map((shot) => (
              <li key={`pipeline_${shot.id}`}>
                <div><strong>{shot.order}. {shot.title}</strong></div>
                <div>
                  图：{shot.generatedImagePath || "未生成"} · 状态：{formatAssetStatus(imageStatusByShot[shot.id] ?? "idle")}
                </div>
                {toDesktopMediaSource(shot.generatedImagePath) && (
                  <a
                    className="comfy-shot-preview"
                    href={toDesktopMediaSource(shot.generatedImagePath)}
                    rel="noreferrer"
                    target="_blank"
                    title="点击在新窗口查看分镜图"
                  >
                    <img alt={`${shot.title} 分镜图`} loading="lazy" src={toDesktopMediaSource(shot.generatedImagePath)} />
                  </a>
                )}
                <div>
                  视频：{shot.generatedVideoPath || "未生成"} · 状态：{formatAssetStatus(videoStatusByShot[shot.id] ?? "idle")}
                </div>
                <div>
                  配音：
                  {audioSummaryByShot[shot.id]?.count
                    ? `对白 ${audioSummaryByShot[shot.id]!.dialogueCount} 段 / 旁白 ${audioSummaryByShot[shot.id]!.narrationCount} 段`
                    : "未生成"} · 状态：{formatAssetStatus(audioStatusByShot[shot.id] ?? "idle")}
                </div>
                {lastErrorByShot[shot.id] && <small>错误：{lastErrorByShot[shot.id]}</small>}
                {showShotEditor && (
                  <details className="comfy-shot-details" open={expandedShotId === shot.id}>
                    <summary
                      onClick={() => setExpandedShotId((id) => (id === shot.id ? "" : shot.id))}
                    >
                      镜头参数
                    </summary>
                  <div className="comfy-shot-edit">
                    <label>
                      Prompt
                      <textarea
                        onChange={(event) => onUpdateShotPrompt(shot.id, event.target.value)}
                        rows={3}
                        value={shot.storyPrompt ?? ""}
                      />
                    </label>
                    <label>
                      视频 Prompt
                      <textarea
                        onChange={(event) => onUpdateShotVideoPrompt(shot.id, event.target.value)}
                        placeholder={
                          settings.videoGenerationMode === "local_motion"
                            ? "留空则沿用分镜 Prompt；运动样式用下方下拉框控制"
                            : "留空则沿用分镜 Prompt"
                        }
                        rows={3}
                        value={stripLocalMotionPresetToken(shot.videoPrompt ?? "")}
                      />
                    </label>
                    <label>
                      视频模式
                      <select
                        onChange={(event) => onUpdateShotVideoMode(shot.id, event.target.value)}
                        value={shot.videoMode ?? "auto"}
                      >
                        <option value="auto">自动判断</option>
                        <option value="single_frame">单帧图生视频</option>
                        <option value="first_last_frame">首尾帧生成视频</option>
                      </select>
                    </label>
                    {settings.videoGenerationMode === "local_motion" && (
                      <label>
                        本地运动样式
                        <select
                          onChange={(event) =>
                            onUpdateShotLocalMotionPreset(shot.id, event.target.value)
                          }
                          value={extractLocalMotionPresetFromText(shot.videoPrompt ?? "")}
                        >
                          {LOCAL_MOTION_PRESET_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className="audio-row">
                      <label>
                        Seed
                        <input
                          onChange={(event) => onUpdateShotSeed(shot.id, event.target.value)}
                          placeholder="留空则随机"
                          type="text"
                          value={shot.seed?.toString() ?? ""}
                        />
                      </label>
                      <label>
                        时长(秒)
                        <input
                          min={0.1}
                          onChange={(event) => onUpdateShotDurationSec(shot.id, event.target.value)}
                          step={0.1}
                          type="number"
                          value={(shot.durationFrames / 24).toFixed(1)}
                        />
                      </label>
                    </div>
                    <div className="audio-row">
                      <label>
                        首帧路径
                        <input
                          onChange={(event) => onUpdateShotVideoFramePath(shot.id, "videoStartFramePath", event.target.value)}
                          placeholder="留空则用当前镜头分镜图"
                          type="text"
                          value={shot.videoStartFramePath ?? ""}
                        />
                      </label>
                      <label>
                        尾帧路径
                        <input
                          onChange={(event) => onUpdateShotVideoFramePath(shot.id, "videoEndFramePath", event.target.value)}
                          placeholder="留空则自动推断"
                          type="text"
                          value={shot.videoEndFramePath ?? ""}
                        />
                      </label>
                    </div>
                  </div>
                  </details>
                )}
                <details className="comfy-shot-details">
                  <summary>单镜头重试</summary>
                  <div className="timeline-actions">
                    <button
                      className="btn-ghost"
                      disabled={phase === "running"}
                      onClick={() => void onGenerateSingle("image", shot.id, true)}
                      type="button"
                    >
                      重生图像
                    </button>
                    <button
                      className="btn-ghost"
                      disabled={phase === "running"}
                      onClick={() => void onGenerateSingle("video", shot.id, true)}
                      type="button"
                    >
                      重生视频
                    </button>
                    <button
                      className="btn-ghost"
                      disabled={phase === "running"}
                      onClick={() => void onGenerateSingle("audio", shot.id, true)}
                      type="button"
                    >
                      重生配音
                    </button>
                  </div>
                </details>
              </li>
            ))}
            </ul>
          </details>
        </div>
      </section>
    </section>
  );
}
