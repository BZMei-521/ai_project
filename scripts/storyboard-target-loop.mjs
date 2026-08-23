#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const repoRoot = process.cwd();

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [key, inlineValue] = token.split("=", 2);
    const name = key.slice(2);
    if (inlineValue !== undefined) {
      output[name] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      output[name] = next;
      index += 1;
      continue;
    }
    output[name] = "1";
  }
  return output;
}

function extractStringList(value) {
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) {
      return value.map((item) => item.trim()).filter((item) => item.length > 0);
    }
    for (const item of value) {
      const nested = extractStringList(item);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

function toNumberOrDefault(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

const args = parseArgs(process.argv.slice(2));
const comfyRoot =
  args.comfyRoot || "C:/Users/Administrator/Desktop/AiProject/ComfyUI_JM_windows_portable";
const comfyBaseUrl = (args.baseUrl || "http://127.0.0.1:8188").replace(/\/+$/, "");
const targetPath = args.target || `${comfyRoot}/target.png`;
const shotPrefix = args.shot || "shot_river_continuity_001";
const threshold = toNumberOrDefault(args.threshold, 0.78);
const timeoutMs = toNumberOrDefault(args.timeoutMs, 15 * 60 * 1000);
const pollIntervalMs = toNumberOrDefault(args.pollMs, 1200);
const debugSaves = String(args.debugSaves ?? "").trim() === "1";
const forcedCheckpoint = typeof args.checkpoint === "string" ? args.checkpoint.trim() : "";
const twoStageMode = String(args.twoStage ?? "1").trim() !== "0";
const stageCMode = String(args.stageC ?? "0").trim() !== "0";
const seedSweepCount = Math.max(1, Math.round(Number(args.seedSweep ?? 1)));
const seedSweepStep = Math.max(1, Math.round(Number(args.seedStep ?? 113)));
const deleteFailedOutputs = String(args.deleteFailed ?? "1").trim() !== "0";

const hardGateThresholds = {
  minGlobal: toNumberOrDefault(args.minGlobal, 0.80),
  minFemaleHead: toNumberOrDefault(args.minFemaleHead, 0.78),
  minMaleHead: toNumberOrDefault(args.minMaleHead, 0.77),
  minFemaleFace: toNumberOrDefault(args.minFemaleFace, 0.76),
  minMaleFace: toNumberOrDefault(args.minMaleFace, 0.76),
  minFemaleBody: toNumberOrDefault(args.minFemaleBody, 0.81),
  minMaleBody: toNumberOrDefault(args.minMaleBody, 0.81),
  minFemaleFeet: toNumberOrDefault(args.minFemaleFeet, 0.80),
  minMaleFeet: toNumberOrDefault(args.minMaleFeet, 0.80),
  minHandHold: toNumberOrDefault(args.minHandHold, 0.86),
  minTorsoCenter: toNumberOrDefault(args.minTorsoCenter, 0.81),
  minPoseArm: toNumberOrDefault(args.minPoseArm, 0.80),
  minEdgeBlend: toNumberOrDefault(args.minEdgeBlend, 0.80)
};

const presetPath = path.join(
  repoRoot,
  "src",
  "modules",
  "comfy-pipeline",
  "presets",
  "storyboard-image-storyboard-composer-v1.json"
);
const scoreScriptPath = path.join(repoRoot, "scripts", "score-storyboard-target.ps1");
const comfyInputDir = path.join(comfyRoot, "ComfyUI", "input");
const comfyOutputDir = path.join(comfyRoot, "ComfyUI", "output");

const requiredInputs = {
  scene: `${shotPrefix}_scene_ref_path.png`,
  char1Front: `${shotPrefix}_char1_front_path.png`,
  char1Side: `${shotPrefix}_char1_side_path.png`,
  char1Back: `${shotPrefix}_char1_back_path.png`,
  char2Front: `${shotPrefix}_char2_front_path.png`,
  char2Side: `${shotPrefix}_char2_side_path.png`,
  char2Back: `${shotPrefix}_char2_back_path.png`
};

const candidateConfigs = [
  {
    name: "no_inpaint_baseline",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.34,
    inpaintSteps: 8,
    inpaintCfg: 4.6,
    inpaintDenoise: 0.0,
    maskGrow: 20,
    maskFeather: 10,
    skipInpaint: true,
    stageASkipInpaint: true
  },
  {
    name: "turnaround_posefit_closeup_soft",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.3,
    inpaintSteps: 8,
    inpaintCfg: 4.6,
    inpaintDenoise: 0.12,
    maskGrow: 16,
    maskFeather: 8
  },
  {
    name: "turnaround_posefit_closeup_strong",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.34,
    inpaintSteps: 10,
    inpaintCfg: 4.7,
    inpaintDenoise: 0.16,
    maskGrow: 16,
    maskFeather: 8
  },
  {
    name: "turnaround_posefit_identity_priority",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.38,
    inpaintSteps: 12,
    inpaintCfg: 4.8,
    inpaintDenoise: 0.2,
    maskGrow: 18,
    maskFeather: 9
  },
  {
    name: "turnaround_posefit_inpaint_repair_mid",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.40,
    inpaintSteps: 18,
    inpaintCfg: 5.8,
    inpaintDenoise: 0.48,
    maskGrow: 18,
    maskFeather: 8
  },
  {
    name: "turnaround_posefit_inpaint_repair_strong",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.42,
    inpaintSteps: 24,
    inpaintCfg: 6.4,
    inpaintDenoise: 0.62,
    maskGrow: 16,
    maskFeather: 8
  },
  {
    name: "turnaround_posefit_inpaint_repair_max",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.44,
    inpaintSteps: 30,
    inpaintCfg: 7.2,
    inpaintDenoise: 0.78,
    maskGrow: 20,
    maskFeather: 12
  },
  {
    name: "turnaround_posefit_inpaint_legfix_balanced",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.42,
    inpaintSteps: 28,
    inpaintCfg: 6.6,
    inpaintDenoise: 0.68,
    maskGrow: 28,
    maskFeather: 14
  },
  {
    name: "turnaround_posefit_inpaint_legfix_hard",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.42,
    inpaintSteps: 34,
    inpaintCfg: 7.0,
    inpaintDenoise: 0.76,
    maskGrow: 34,
    maskFeather: 18
  },
  {
    name: "turnaround_posefit_target_alignment",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.42,
    inpaintSteps: 26,
    inpaintCfg: 6.4,
    inpaintDenoise: 0.62,
    maskGrow: 24,
    maskFeather: 12,
    char1FeetX: 780,
    char1GroundY: 1000,
    char1Ratio: 0.94,
    char2FeetX: 460,
    char2GroundY: 1000,
    char2Ratio: 0.92
  },
  {
    name: "turnaround_posefit_target_alignment_preserve",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.34,
    inpaintSteps: 22,
    inpaintCfg: 5.8,
    inpaintDenoise: 0.48,
    maskGrow: 22,
    maskFeather: 10,
    char1FeetX: 760,
    char1GroundY: 1000,
    char1Ratio: 0.94,
    char2FeetX: 430,
    char2GroundY: 1000,
    char2Ratio: 0.92
  },
  {
    name: "turnaround_posefit_target_alignment_close",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.36,
    inpaintSteps: 24,
    inpaintCfg: 6.0,
    inpaintDenoise: 0.54,
    maskGrow: 24,
    maskFeather: 12,
    char1FeetX: 740,
    char1GroundY: 1000,
    char1Ratio: 0.95,
    char2FeetX: 420,
    char2GroundY: 1000,
    char2Ratio: 0.93
  },
  {
    name: "turnaround_posefit_target_alignment_handhold",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.34,
    inpaintSteps: 24,
    inpaintCfg: 5.8,
    inpaintDenoise: 0.46,
    maskGrow: 22,
    maskFeather: 10,
    char1FeetX: 740,
    char1GroundY: 1000,
    char1Ratio: 0.95,
    char2FeetX: 420,
    char2GroundY: 1000,
    char2Ratio: 0.93,
    char1ActionPrompt: "full-body natural stance, left arm gently inward and forward to hold partner hand, right arm relaxed at side",
    char2ActionPrompt: "full-body natural stance, right arm gently inward and forward to hold partner hand, left arm relaxed at side",
    char1ExpressionPrompt: "gentle soft smile, calm eyes",
    char2ExpressionPrompt: "gentle soft smile, calm eyes"
  },
  {
    name: "turnaround_posefit_target_alignment_front_soft_male",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.34,
    inpaintSteps: 24,
    inpaintCfg: 5.8,
    inpaintDenoise: 0.46,
    maskGrow: 22,
    maskFeather: 10,
    char1FeetX: 740,
    char1GroundY: 1000,
    char1Ratio: 0.95,
    char2FeetX: 420,
    char2GroundY: 1000,
    char2Ratio: 0.93,
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ActionPrompt: "full-body natural walk, slight 3/4 angle toward camera, left arm inward holding partner hand, grounded feet",
    char2ActionPrompt: "full-body natural walk, slight 3/4 angle toward camera, right arm inward holding partner hand, grounded feet",
    char1ExpressionPrompt: "gentle soft smile, calm eyes, facing camera",
    char2ExpressionPrompt: "gentle soft smile, calm eyes, facing camera"
  },
  {
    name: "turnaround_posefit_target_alignment_front_soft_female",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.34,
    inpaintSteps: 24,
    inpaintCfg: 5.8,
    inpaintDenoise: 0.46,
    maskGrow: 22,
    maskFeather: 10,
    char1FeetX: 740,
    char1GroundY: 1000,
    char1Ratio: 0.95,
    char2FeetX: 420,
    char2GroundY: 1000,
    char2Ratio: 0.93,
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ActionPrompt: "full-body natural walk, slight 3/4 angle toward camera, left arm inward holding partner hand, grounded feet",
    char2ActionPrompt: "full-body natural walk, slight 3/4 angle toward camera, right arm inward holding partner hand, grounded feet",
    char1ExpressionPrompt: "gentle soft smile, calm eyes, facing camera",
    char2ExpressionPrompt: "gentle soft smile, calm eyes, facing camera"
  },
  {
    name: "turnaround_posefit_target_alignment_front_pair",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.34,
    inpaintSteps: 24,
    inpaintCfg: 5.8,
    inpaintDenoise: 0.46,
    maskGrow: 22,
    maskFeather: 10,
    char1FeetX: 740,
    char1GroundY: 1000,
    char1Ratio: 0.95,
    char2FeetX: 420,
    char2GroundY: 1000,
    char2Ratio: 0.93,
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ActionPrompt: "full-body natural walk side-by-side, slight 3/4 angle toward camera, left arm inward holding partner hand, right arm relaxed",
    char2ActionPrompt: "full-body natural walk side-by-side, slight 3/4 angle toward camera, right arm inward holding partner hand, left arm relaxed",
    char1ExpressionPrompt: "gentle soft smile, calm eyes, facing camera",
    char2ExpressionPrompt: "gentle soft smile, calm eyes, facing camera"
  },
  {
    name: "turnaround_posefit_target_alignment_front_pair_left_shift",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.34,
    inpaintSteps: 26,
    inpaintCfg: 6.0,
    inpaintDenoise: 0.50,
    maskGrow: 24,
    maskFeather: 12,
    char1FeetX: 780,
    char1GroundY: 1004,
    char1Ratio: 0.99,
    char2FeetX: 440,
    char2GroundY: 1004,
    char2Ratio: 0.97,
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ActionPrompt:
      "full-body natural walking stride, slight inward turn toward partner, left hand meeting partner hand near center, right arm relaxed",
    char2ActionPrompt:
      "full-body natural walking stride, slight inward turn toward partner, right hand meeting partner hand near center, left arm relaxed",
    char1ExpressionPrompt: "soft warm smile, eyes glancing toward partner",
    char2ExpressionPrompt: "soft warm smile, eyes glancing toward partner"
  },
  {
    name: "turnaround_posefit_target_alignment_front_pair_left_shift_close",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.33,
    inpaintSteps: 28,
    inpaintCfg: 6.2,
    inpaintDenoise: 0.56,
    maskGrow: 26,
    maskFeather: 12,
    char1FeetX: 790,
    char1GroundY: 1008,
    char1Ratio: 1.01,
    char2FeetX: 450,
    char2GroundY: 1008,
    char2Ratio: 0.99,
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ActionPrompt:
      "full-body close pair walk, torso gently turned inward toward partner, left hand holding partner hand, natural grounded steps",
    char2ActionPrompt:
      "full-body close pair walk, torso gently turned inward toward partner, right hand holding partner hand, natural grounded steps",
    char1ExpressionPrompt: "soft warm smile, looking at partner",
    char2ExpressionPrompt: "soft warm smile, looking at partner"
  },
  {
    name: "turnaround_posefit_target_alignment_front_pair_match_target",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.34,
    inpaintSteps: 24,
    inpaintCfg: 5.8,
    inpaintDenoise: 0.46,
    maskGrow: 24,
    maskFeather: 12,
    char1FeetX: 805,
    char1GroundY: 1008,
    char1Ratio: 0.99,
    char2FeetX: 500,
    char2GroundY: 1008,
    char2Ratio: 0.97,
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ActionPrompt:
      "full-body natural walking stride on riverside path, gentle torso turn toward partner, left arm inward holding partner hand, grounded feet",
    char2ActionPrompt:
      "full-body natural walking stride on riverside path, gentle torso turn toward partner, right arm inward holding partner hand, grounded feet",
    char1ExpressionPrompt: "soft warm smile, calm eyes, slight glance toward partner",
    char2ExpressionPrompt: "soft warm smile, calm eyes, slight glance toward partner"
  },
  {
    name: "turnaround_posefit_target_alignment_inward_gaze_match_target",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.33,
    inpaintSteps: 28,
    inpaintCfg: 6.1,
    inpaintDenoise: 0.56,
    maskGrow: 22,
    maskFeather: 10,
    char1FeetX: 760,
    char1GroundY: 1008,
    char1Ratio: 0.99,
    char2FeetX: 470,
    char2GroundY: 1008,
    char2Ratio: 0.97,
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ActionPrompt:
      "full-body natural walking stride, torso slightly turned inward toward partner, left hand meeting partner hand at body center, grounded steps",
    char2ActionPrompt:
      "full-body natural walking stride, torso slightly turned inward toward partner, right hand meeting partner hand at body center, grounded steps",
    char1ExpressionPrompt: "gentle smile, eyes glancing toward partner",
    char2ExpressionPrompt: "gentle smile, eyes glancing toward partner"
  },
  {
    name: "turnaround_posefit_target_alignment_inward_gaze_match_target_refine_natural_global",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.33,
    inpaintSteps: 28,
    inpaintCfg: 6.1,
    inpaintDenoise: 0.56,
    maskGrow: 22,
    maskFeather: 10,
    stageCInpaintSteps: 18,
    stageCInpaintCfg: 4.5,
    stageCInpaintDenoise: 0.30,
    stageCMaskGrow: 180,
    stageCMaskFeather: 24,
    char1FeetX: 760,
    char1GroundY: 1008,
    char1Ratio: 0.99,
    char2FeetX: 470,
    char2GroundY: 1008,
    char2Ratio: 0.97,
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ActionPrompt:
      "full-body natural walking stride, torso slightly turned inward toward partner, left hand meeting partner hand at body center, grounded steps",
    char2ActionPrompt:
      "full-body natural walking stride, torso slightly turned inward toward partner, right hand meeting partner hand at body center, grounded steps",
    char1ExpressionPrompt: "gentle smile, eyes glancing toward partner",
    char2ExpressionPrompt: "gentle smile, eyes glancing toward partner"
  },
  {
    name: "source_image_target_alignment_inward_gaze_match_target",
    renderMode: "source_image",
    poseFit: 0.40,
    inpaintSteps: 26,
    inpaintCfg: 5.9,
    inpaintDenoise: 0.46,
    maskGrow: 24,
    maskFeather: 10,
    char1FeetX: 760,
    char1GroundY: 1008,
    char1Ratio: 0.99,
    char2FeetX: 470,
    char2GroundY: 1008,
    char2Ratio: 0.97,
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ActionPrompt:
      "full-body natural walking stride, torso gently turned toward partner, left hand meeting partner hand, natural leg cadence",
    char2ActionPrompt:
      "full-body natural walking stride, torso gently turned toward partner, right hand meeting partner hand, natural leg cadence",
    char1ExpressionPrompt: "soft warm smile, glancing at partner",
    char2ExpressionPrompt: "soft warm smile, glancing at partner"
  },
  {
    name: "turnaround_posefit_target_alignment_side_pair_match_target",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.36,
    inpaintSteps: 24,
    inpaintCfg: 5.9,
    inpaintDenoise: 0.48,
    maskGrow: 24,
    maskFeather: 12,
    char1FeetX: 805,
    char1GroundY: 1008,
    char1Ratio: 0.99,
    char2FeetX: 500,
    char2GroundY: 1008,
    char2Ratio: 0.97,
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on left side, left arm inward holding partner hand, right arm relaxed",
    char2ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on right side, right arm inward holding partner hand, left arm relaxed",
    char1ExpressionPrompt: "gentle smile, looking at partner",
    char2ExpressionPrompt: "gentle smile, looking at partner"
  },
  {
    name: "turnaround_posefit_target_alignment_side_pair_match_target_left_shift",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.36,
    inpaintSteps: 24,
    inpaintCfg: 5.8,
    inpaintDenoise: 0.46,
    maskGrow: 24,
    maskFeather: 12,
    char1FeetX: 780,
    char1GroundY: 1004,
    char1Ratio: 0.99,
    char2FeetX: 440,
    char2GroundY: 1004,
    char2Ratio: 0.97,
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on left side, left arm inward holding partner hand, right arm relaxed",
    char2ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on right side, right arm inward holding partner hand, left arm relaxed",
    char1ExpressionPrompt: "gentle smile, looking at partner",
    char2ExpressionPrompt: "gentle smile, looking at partner"
  },
  {
    name: "turnaround_posefit_target_alignment_side_pair_match_target_left_compact",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.35,
    inpaintSteps: 24,
    inpaintCfg: 5.7,
    inpaintDenoise: 0.44,
    maskGrow: 22,
    maskFeather: 10,
    char1FeetX: 770,
    char1GroundY: 1000,
    char1Ratio: 0.98,
    char2FeetX: 430,
    char2GroundY: 1000,
    char2Ratio: 0.96,
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on left side, left arm inward holding partner hand, right arm relaxed",
    char2ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on right side, right arm inward holding partner hand, left arm relaxed",
    char1ExpressionPrompt: "gentle smile, looking at partner",
    char2ExpressionPrompt: "gentle smile, looking at partner"
  },
  {
    name: "turnaround_posefit_target_alignment_side_pair_match_target_left_compact_refine_soft",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.35,
    inpaintSteps: 24,
    inpaintCfg: 5.7,
    inpaintDenoise: 0.44,
    maskGrow: 22,
    maskFeather: 10,
    stageCInpaintSteps: 16,
    stageCInpaintCfg: 4.6,
    stageCInpaintDenoise: 0.16,
    stageCMaskGrow: 10,
    stageCMaskFeather: 6,
    char1FeetX: 770,
    char1GroundY: 1000,
    char1Ratio: 0.98,
    char2FeetX: 430,
    char2GroundY: 1000,
    char2Ratio: 0.96,
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on left side, left arm inward holding partner hand, right arm relaxed",
    char2ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on right side, right arm inward holding partner hand, left arm relaxed",
    char1ExpressionPrompt: "gentle smile, looking at partner",
    char2ExpressionPrompt: "gentle smile, looking at partner"
  },
  {
    name: "turnaround_posefit_target_alignment_side_pair_match_target_left_compact_refine_soft_dirswap",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.35,
    inpaintSteps: 24,
    inpaintCfg: 5.7,
    inpaintDenoise: 0.44,
    maskGrow: 22,
    maskFeather: 10,
    stageCInpaintSteps: 16,
    stageCInpaintCfg: 4.6,
    stageCInpaintDenoise: 0.16,
    stageCMaskGrow: 10,
    stageCMaskFeather: 6,
    char1FeetX: 770,
    char1GroundY: 1000,
    char1Ratio: 0.98,
    char2FeetX: 430,
    char2GroundY: 1000,
    char2Ratio: 0.96,
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1SideViewDirection: "left",
    char2SideViewDirection: "right",
    char1ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on left side, left arm inward holding partner hand, right arm relaxed",
    char2ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on right side, right arm inward holding partner hand, left arm relaxed",
    char1ExpressionPrompt: "gentle smile, looking at partner",
    char2ExpressionPrompt: "gentle smile, looking at partner"
  },
  {
    name: "turnaround_posefit_target_alignment_side_pair_match_target_left_compact_refine_soft_both_right",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.35,
    inpaintSteps: 24,
    inpaintCfg: 5.7,
    inpaintDenoise: 0.44,
    maskGrow: 22,
    maskFeather: 10,
    stageCInpaintSteps: 16,
    stageCInpaintCfg: 4.6,
    stageCInpaintDenoise: 0.16,
    stageCMaskGrow: 10,
    stageCMaskFeather: 6,
    char1FeetX: 770,
    char1GroundY: 1000,
    char1Ratio: 0.98,
    char2FeetX: 430,
    char2GroundY: 1000,
    char2Ratio: 0.96,
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1SideViewDirection: "right",
    char2SideViewDirection: "right",
    char1ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on left side, left arm inward holding partner hand, right arm relaxed",
    char2ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on right side, right arm inward holding partner hand, left arm relaxed",
    char1ExpressionPrompt: "gentle smile, looking at partner",
    char2ExpressionPrompt: "gentle smile, looking at partner"
  },
  {
    name: "turnaround_posefit_target_alignment_side_pair_match_target_left_compact_refine_soft_male_front_lock",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.34,
    inpaintSteps: 24,
    inpaintCfg: 5.7,
    inpaintDenoise: 0.42,
    maskGrow: 22,
    maskFeather: 10,
    stageCInpaintSteps: 16,
    stageCInpaintCfg: 4.6,
    stageCInpaintDenoise: 0.16,
    stageCMaskGrow: 10,
    stageCMaskFeather: 6,
    char1FeetX: 760,
    char1GroundY: 1000,
    char1Ratio: 0.99,
    char2FeetX: 440,
    char2GroundY: 1000,
    char2Ratio: 0.96,
    char1FacingDirection: "front",
    char2FacingDirection: "right",
    char1ViewPolicy: "pose_only",
    char2ViewPolicy: "scene_then_pose",
    char1ActionPrompt:
      "full-body natural walking stride, slight front three-quarter, left arm inward naturally holding partner hand near centerline, right arm relaxed",
    char2ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on right side, right arm inward holding partner hand near centerline, left arm relaxed",
    char1ExpressionPrompt: "gentle smile, clean face detail, looking at partner",
    char2ExpressionPrompt: "gentle smile, looking at partner"
  },
  {
    name: "turnaround_posefit_target_alignment_side_pair_match_target_left_compact_refine_soft_stagec_preserve",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.35,
    inpaintSteps: 24,
    inpaintCfg: 5.7,
    inpaintDenoise: 0.44,
    maskGrow: 22,
    maskFeather: 10,
    stageCInpaintSteps: 14,
    stageCInpaintCfg: 4.4,
    stageCInpaintDenoise: 0.10,
    stageCMaskGrow: 8,
    stageCMaskFeather: 4,
    char1FeetX: 766,
    char1GroundY: 1000,
    char1Ratio: 0.99,
    char2FeetX: 438,
    char2GroundY: 1000,
    char2Ratio: 0.96,
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on left side, left arm inward holding partner hand near centerline, right arm relaxed",
    char2ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on right side, right arm inward holding partner hand near centerline, left arm relaxed",
    char1ExpressionPrompt: "gentle smile, looking at partner, preserve face identity",
    char2ExpressionPrompt: "gentle smile, looking at partner, preserve face identity"
  },
  {
    name: "turnaround_posefit_target_alignment_side_pair_match_target_left_compact_refine_soft_hd",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.35,
    inpaintSteps: 24,
    inpaintCfg: 5.7,
    inpaintDenoise: 0.44,
    maskGrow: 22,
    maskFeather: 10,
    stageCInpaintSteps: 18,
    stageCInpaintCfg: 4.8,
    stageCInpaintDenoise: 0.22,
    stageCMaskGrow: 18,
    stageCMaskFeather: 10,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 770,
    char1GroundY: 1000,
    char1Ratio: 0.98,
    char2FeetX: 430,
    char2GroundY: 1000,
    char2Ratio: 0.96,
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on left side, left arm inward holding partner hand, right arm relaxed, clean hand anatomy",
    char2ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on right side, right arm inward holding partner hand, left arm relaxed, clean hand anatomy",
    char1ExpressionPrompt: "gentle smile, looking at partner, clean facial detail",
    char2ExpressionPrompt: "gentle smile, looking at partner, clean facial detail"
  },
  {
    name: "turnaround_posefit_target_alignment_side_pair_match_target_left_compact_refine_soft_hd_push_v2",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.36,
    inpaintSteps: 24,
    inpaintCfg: 5.7,
    inpaintDenoise: 0.42,
    maskGrow: 22,
    maskFeather: 10,
    stageCInpaintSteps: 18,
    stageCInpaintCfg: 4.8,
    stageCInpaintDenoise: 0.20,
    stageCMaskGrow: 18,
    stageCMaskFeather: 10,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 760,
    char1GroundY: 1000,
    char1Ratio: 0.99,
    char2FeetX: 450,
    char2GroundY: 1000,
    char2Ratio: 0.97,
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on left side, left arm inward clearly holding partner hand near centerline, right arm relaxed, clean hand anatomy",
    char2ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on right side, right arm inward clearly holding partner hand near centerline, left arm relaxed, clean hand anatomy",
    char1ExpressionPrompt: "gentle smile, looking at partner, clean facial detail",
    char2ExpressionPrompt: "gentle smile, looking at partner, clean facial detail"
  },
  {
    name: "turnaround_posefit_target_alignment_side_pair_match_target_left_compact_refine_soft_hd_push_v3",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.37,
    inpaintSteps: 24,
    inpaintCfg: 5.8,
    inpaintDenoise: 0.44,
    maskGrow: 24,
    maskFeather: 10,
    stageCInpaintSteps: 20,
    stageCInpaintCfg: 4.9,
    stageCInpaintDenoise: 0.22,
    stageCMaskGrow: 20,
    stageCMaskFeather: 10,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 752,
    char1GroundY: 1000,
    char1Ratio: 1.00,
    char2FeetX: 458,
    char2GroundY: 1000,
    char2Ratio: 0.98,
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on left side, left arm inward holding partner hand, right arm relaxed, clean hand anatomy",
    char2ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on right side, right arm inward holding partner hand, left arm relaxed, clean hand anatomy",
    char1ExpressionPrompt: "gentle smile, looking at partner, clean facial detail",
    char2ExpressionPrompt: "gentle smile, looking at partner, clean facial detail"
  },
  {
    name: "turnaround_posefit_target_alignment_side_pair_match_target_left_compact_refine_soft_hd_push_v4",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.36,
    inpaintSteps: 24,
    inpaintCfg: 5.7,
    inpaintDenoise: 0.42,
    maskGrow: 22,
    maskFeather: 10,
    stageCInpaintSteps: 18,
    stageCInpaintCfg: 4.7,
    stageCInpaintDenoise: 0.18,
    stageCMaskGrow: 16,
    stageCMaskFeather: 9,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 758,
    char1GroundY: 1000,
    char1Ratio: 0.99,
    char2FeetX: 448,
    char2GroundY: 1000,
    char2Ratio: 0.97,
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on left side, left arm inward holding partner hand near centerline, right arm relaxed",
    char2ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on right side, right arm inward holding partner hand near centerline, left arm relaxed",
    char1ExpressionPrompt: "gentle smile, looking at partner, clean facial detail",
    char2ExpressionPrompt: "gentle smile, looking at partner, clean facial detail"
  },
  {
    name: "turnaround_posefit_target_alignment_side_pair_match_target_left_compact_refine_natural_global",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.35,
    inpaintSteps: 24,
    inpaintCfg: 5.7,
    inpaintDenoise: 0.44,
    maskGrow: 22,
    maskFeather: 10,
    stageCInpaintSteps: 18,
    stageCInpaintCfg: 4.5,
    stageCInpaintDenoise: 0.30,
    stageCMaskGrow: 180,
    stageCMaskFeather: 26,
    char1FeetX: 770,
    char1GroundY: 1000,
    char1Ratio: 0.98,
    char2FeetX: 430,
    char2GroundY: 1000,
    char2Ratio: 0.96,
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on left side, left arm inward holding partner hand, right arm relaxed",
    char2ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on right side, right arm inward holding partner hand, left arm relaxed",
    char1ExpressionPrompt: "gentle smile, looking at partner",
    char2ExpressionPrompt: "gentle smile, looking at partner"
  },
  {
    name: "turnaround_posefit_target_alignment_side_pair_match_target_left_compact_refine_natural_global_soft",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.35,
    inpaintSteps: 24,
    inpaintCfg: 5.7,
    inpaintDenoise: 0.44,
    maskGrow: 22,
    maskFeather: 10,
    stageCInpaintSteps: 16,
    stageCInpaintCfg: 4.4,
    stageCInpaintDenoise: 0.24,
    stageCMaskGrow: 140,
    stageCMaskFeather: 22,
    char1FeetX: 770,
    char1GroundY: 1000,
    char1Ratio: 0.98,
    char2FeetX: 430,
    char2GroundY: 1000,
    char2Ratio: 0.96,
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on left side, left arm inward holding partner hand, right arm relaxed",
    char2ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on right side, right arm inward holding partner hand, left arm relaxed",
    char1ExpressionPrompt: "gentle smile, looking at partner",
    char2ExpressionPrompt: "gentle smile, looking at partner"
  },
  {
    name: "turnaround_posefit_target_alignment_side_pair_match_target_left_compact_refine_natural_global_clean",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.35,
    inpaintSteps: 24,
    inpaintCfg: 5.7,
    inpaintDenoise: 0.44,
    maskGrow: 22,
    maskFeather: 10,
    stageCInpaintSteps: 20,
    stageCInpaintCfg: 4.6,
    stageCInpaintDenoise: 0.33,
    stageCMaskGrow: 220,
    stageCMaskFeather: 30,
    char1FeetX: 770,
    char1GroundY: 1000,
    char1Ratio: 0.98,
    char2FeetX: 430,
    char2GroundY: 1000,
    char2Ratio: 0.96,
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on left side, left arm inward holding partner hand, right arm relaxed",
    char2ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on right side, right arm inward holding partner hand, left arm relaxed",
    char1ExpressionPrompt: "gentle smile, looking at partner",
    char2ExpressionPrompt: "gentle smile, looking at partner"
  },
  {
    name: "turnaround_posefit_target_alignment_side_pair_match_target_left_compact_refine_balanced",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.34,
    inpaintSteps: 24,
    inpaintCfg: 5.8,
    inpaintDenoise: 0.42,
    maskGrow: 21,
    maskFeather: 9,
    stageCInpaintSteps: 18,
    stageCInpaintCfg: 4.8,
    stageCInpaintDenoise: 0.2,
    stageCMaskGrow: 12,
    stageCMaskFeather: 7,
    char1FeetX: 768,
    char1GroundY: 1000,
    char1Ratio: 0.99,
    char2FeetX: 428,
    char2GroundY: 1000,
    char2Ratio: 0.97,
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on left side, left arm inward holding partner hand, right arm relaxed",
    char2ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on right side, right arm inward holding partner hand, left arm relaxed",
    char1ExpressionPrompt: "gentle smile, looking at partner",
    char2ExpressionPrompt: "gentle smile, looking at partner"
  },
  {
    name: "turnaround_posefit_target_alignment_side_pair_match_target_left_compact_tight",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.34,
    inpaintSteps: 24,
    inpaintCfg: 5.8,
    inpaintDenoise: 0.42,
    maskGrow: 20,
    maskFeather: 9,
    stageCInpaintSteps: 18,
    stageCInpaintCfg: 4.7,
    stageCInpaintDenoise: 0.18,
    stageCMaskGrow: 11,
    stageCMaskFeather: 7,
    char1FeetX: 764,
    char1GroundY: 1000,
    char1Ratio: 0.99,
    char2FeetX: 424,
    char2GroundY: 1000,
    char2Ratio: 0.97,
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on left side, left arm inward holding partner hand, right arm relaxed",
    char2ActionPrompt:
      "full-body natural walking stride, body and head turned toward partner on right side, right arm inward holding partner hand, left arm relaxed",
    char1ExpressionPrompt: "gentle smile, looking at partner",
    char2ExpressionPrompt: "gentle smile, looking at partner"
  },
  {
    name: "source_image_target_alignment_side_pair_soft",
    renderMode: "source_image",
    poseFit: 0.42,
    inpaintSteps: 22,
    inpaintCfg: 5.4,
    inpaintDenoise: 0.34,
    maskGrow: 26,
    maskFeather: 12,
    char1FeetX: 760,
    char1GroundY: 1000,
    char1Ratio: 0.95,
    char2FeetX: 455,
    char2GroundY: 1000,
    char2Ratio: 0.93,
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ActionPrompt:
      "full-body natural slow walk on riverside path, body slightly facing left toward partner, left arm gently inward to hold partner hand, grounded feet",
    char2ActionPrompt:
      "full-body natural slow walk on riverside path, body slightly facing right toward partner, right arm gently inward to hold partner hand, grounded feet",
    char1ExpressionPrompt: "gentle calm expression, eyes looking toward partner",
    char2ExpressionPrompt: "gentle calm expression, eyes looking toward partner"
  },
  {
    name: "source_image_target_alignment_side_pair_strong",
    renderMode: "source_image",
    poseFit: 0.44,
    inpaintSteps: 26,
    inpaintCfg: 5.8,
    inpaintDenoise: 0.40,
    maskGrow: 30,
    maskFeather: 14,
    char1FeetX: 770,
    char1GroundY: 1000,
    char1Ratio: 0.96,
    char2FeetX: 460,
    char2GroundY: 1000,
    char2Ratio: 0.94,
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ActionPrompt:
      "full-body natural walk, slight torso turn toward partner, left hand meeting partner hand near body center, right arm relaxed, natural leg stride",
    char2ActionPrompt:
      "full-body natural walk, slight torso turn toward partner, right hand meeting partner hand near body center, left arm relaxed, natural leg stride",
    char1ExpressionPrompt: "soft warm expression, looking at partner",
    char2ExpressionPrompt: "soft warm expression, looking at partner"
  },
  {
    name: "source_image_target_alignment_three_quarter_pair",
    renderMode: "source_image",
    poseFit: 0.42,
    inpaintSteps: 24,
    inpaintCfg: 5.6,
    inpaintDenoise: 0.36,
    maskGrow: 28,
    maskFeather: 12,
    char1FeetX: 750,
    char1GroundY: 1000,
    char1Ratio: 0.95,
    char2FeetX: 450,
    char2GroundY: 1000,
    char2Ratio: 0.93,
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ActionPrompt:
      "full-body three-quarter pose toward camera and partner, left arm inward holding partner hand, shoulders relaxed, natural grounded stance",
    char2ActionPrompt:
      "full-body three-quarter pose toward camera and partner, right arm inward holding partner hand, shoulders relaxed, natural grounded stance",
    char1ExpressionPrompt: "gentle smile, calm eyes, slight glance toward partner",
    char2ExpressionPrompt: "gentle smile, calm eyes, slight glance toward partner"
  },
  {
    name: "turnaround_posefit_identity_lock_front_compose",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.28,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 16,
    stageCInpaintCfg: 4.6,
    stageCInpaintDenoise: 0.20,
    stageCMaskGrow: 16,
    stageCMaskFeather: 9,
    char1FeetX: 760,
    char1GroundY: 1000,
    char1Ratio: 0.95,
    char2FeetX: 430,
    char2GroundY: 1000,
    char2Ratio: 0.93,
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 9,
    char2Feather: 9,
    char1ShadowStrength: 0.32,
    char2ShadowStrength: 0.32,
    char1ActionPrompt:
      "full-body natural walking pose, slight three-quarter toward camera, left arm inward to hold partner hand, right arm relaxed, grounded feet",
    char2ActionPrompt:
      "full-body natural walking pose, slight three-quarter toward camera, right arm inward to hold partner hand, left arm relaxed, grounded feet",
    char1ExpressionPrompt: "gentle smile, calm eyes, natural facial proportion",
    char2ExpressionPrompt: "gentle smile, calm eyes, natural facial proportion"
  },
  {
    name: "turnaround_posefit_identity_lock_front_hd_v2",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.27,
    inpaintSteps: 20,
    inpaintCfg: 5.3,
    inpaintDenoise: 0.30,
    maskGrow: 20,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 20,
    stageAInpaintCfg: 5.1,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 20,
    stageCInpaintCfg: 4.9,
    stageCInpaintDenoise: 0.28,
    stageCMaskGrow: 120,
    stageCMaskFeather: 20,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 770,
    char1GroundY: 1004,
    char1Ratio: 0.98,
    char2FeetX: 470,
    char2GroundY: 1004,
    char2Ratio: 0.97,
    char1PoseMode: "walk_right",
    char2PoseMode: "walk_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 11,
    char2Feather: 11,
    char1ShadowStrength: 0.36,
    char2ShadowStrength: 0.36,
    char1ActionPrompt:
      "full-body natural walking pose, slight three-quarter toward camera, left arm naturally inward to hold partner hand at centerline, grounded feet, clean hand anatomy",
    char2ActionPrompt:
      "full-body natural walking pose, slight three-quarter toward camera, right arm naturally inward to hold partner hand at centerline, grounded feet, clean hand anatomy",
    char1ExpressionPrompt: "gentle smile, calm eyes, clear facial details, stable haircut and outfit silhouette",
    char2ExpressionPrompt: "gentle smile, calm eyes, clear facial details, stable haircut and outfit silhouette"
  },
  {
    name: "turnaround_posefit_identity_lock_inward_face",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.27,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 18,
    stageCInpaintCfg: 4.8,
    stageCInpaintDenoise: 0.24,
    stageCMaskGrow: 48,
    stageCMaskFeather: 16,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 770,
    char1GroundY: 1004,
    char1Ratio: 0.97,
    char2FeetX: 470,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural stance, torso slightly turned inward toward partner, right hand naturally meeting partner left hand at centerline, grounded feet, complete limbs",
    char2ActionPrompt:
      "full-body natural stance, torso slightly turned inward toward partner, left hand naturally meeting partner right hand at centerline, grounded feet, complete limbs",
    char1ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner",
    char2ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner"
  },
  {
    name: "turnaround_posefit_identity_lock_inward_face_gap_narrow_a",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.27,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 18,
    stageCInpaintCfg: 4.8,
    stageCInpaintDenoise: 0.24,
    stageCMaskGrow: 48,
    stageCMaskFeather: 16,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 760,
    char1GroundY: 1004,
    char1Ratio: 0.97,
    char2FeetX: 500,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural stance, torso slightly turned inward toward partner, right hand naturally meeting partner left hand at centerline, grounded feet, complete limbs",
    char2ActionPrompt:
      "full-body natural stance, torso slightly turned inward toward partner, left hand naturally meeting partner right hand at centerline, grounded feet, complete limbs",
    char1ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner",
    char2ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner"
  },
  {
    name: "turnaround_posefit_identity_lock_inward_face_gap_narrow_b",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.27,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 18,
    stageCInpaintCfg: 4.8,
    stageCInpaintDenoise: 0.24,
    stageCMaskGrow: 48,
    stageCMaskFeather: 16,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 748,
    char1GroundY: 1004,
    char1Ratio: 0.97,
    char2FeetX: 500,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural stance, torso slightly turned inward toward partner, right hand naturally meeting partner left hand at centerline, grounded feet, complete limbs",
    char2ActionPrompt:
      "full-body natural stance, torso slightly turned inward toward partner, left hand naturally meeting partner right hand at centerline, grounded feet, complete limbs",
    char1ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner",
    char2ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner"
  },
  {
    name: "turnaround_posefit_identity_lock_inward_face_v2",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.27,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 20,
    stageCInpaintCfg: 4.9,
    stageCInpaintDenoise: 0.27,
    stageCMaskGrow: 64,
    stageCMaskFeather: 18,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 782,
    char1GroundY: 1004,
    char1Ratio: 1.0,
    char2FeetX: 500,
    char2GroundY: 1004,
    char2Ratio: 0.96,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural stance, torso slightly turned inward toward partner, right hand firmly and naturally holding partner left hand at centerline, grounded feet, complete limbs",
    char2ActionPrompt:
      "full-body natural stance, torso slightly turned inward toward partner, left hand firmly and naturally holding partner right hand at centerline, grounded feet, complete limbs",
    char1ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner",
    char2ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner"
  },
  {
    name: "turnaround_posefit_identity_lock_inward_face_v3",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.27,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 18,
    stageCInpaintCfg: 4.8,
    stageCInpaintDenoise: 0.26,
    stageCMaskGrow: 56,
    stageCMaskFeather: 16,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 770,
    char1GroundY: 1004,
    char1Ratio: 0.98,
    char2FeetX: 480,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural stance, torso slightly turned inward toward partner, right hand naturally meeting partner left hand at centerline, grounded feet, complete limbs",
    char2ActionPrompt:
      "full-body natural stance, torso slightly turned inward toward partner, left hand naturally meeting partner right hand at centerline, grounded feet, complete limbs",
    char1ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner",
    char2ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner"
  },
  {
    name: "turnaround_posefit_hold_inner_lock_v1",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.25,
    inpaintSteps: 20,
    inpaintCfg: 5.0,
    inpaintDenoise: 0.28,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 4.9,
    stageAInpaintDenoise: 0.22,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 20,
    stageCInpaintCfg: 4.9,
    stageCInpaintDenoise: 0.28,
    stageCMaskGrow: 60,
    stageCMaskFeather: 16,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 770,
    char1GroundY: 1004,
    char1Ratio: 0.98,
    char2FeetX: 488,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural inward stance, right hand gently meeting partner left hand at frame center, complete clean limbs, grounded feet, natural shoulder line",
    char2ActionPrompt:
      "full-body natural inward stance, left hand gently meeting partner right hand at frame center, complete clean limbs, grounded feet, natural shoulder line",
    char1ExpressionPrompt: "warm gentle smile, clear eyes, preserved male identity details, looking toward partner",
    char2ExpressionPrompt: "warm gentle smile, clear eyes, preserved female identity details, looking toward partner"
  },
  {
    name: "turnaround_posefit_identity_lock_inward_face_interact_v4",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.27,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 20,
    stageCInpaintCfg: 5.0,
    stageCInpaintDenoise: 0.32,
    stageCMaskGrow: 72,
    stageCMaskFeather: 18,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 758,
    char1GroundY: 1004,
    char1Ratio: 0.98,
    char2FeetX: 482,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural inward stance, right hand visibly clasping partner left hand at center waist level, grounded feet, clean fingers, complete limbs",
    char2ActionPrompt:
      "full-body natural inward stance, left hand visibly clasping partner right hand at center waist level, grounded feet, clean fingers, complete limbs",
    char1ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner",
    char2ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner"
  },
  {
    name: "turnaround_posefit_identity_lock_inward_face_stageC_strong",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.27,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 22,
    stageCInpaintCfg: 5.1,
    stageCInpaintDenoise: 0.38,
    stageCMaskGrow: 180,
    stageCMaskFeather: 26,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 770,
    char1GroundY: 1004,
    char1Ratio: 0.97,
    char2FeetX: 470,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural stance, torso slightly turned inward toward partner, right hand clearly and naturally holding partner left hand at centerline, grounded feet, complete body",
    char2ActionPrompt:
      "full-body natural stance, torso slightly turned inward toward partner, left hand clearly and naturally holding partner right hand at centerline, grounded feet, complete body",
    char1ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner",
    char2ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner"
  },
  {
    name: "turnaround_posefit_identity_lock_inward_face_stageC_strong_swapped_hands",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.27,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 22,
    stageCInpaintCfg: 5.1,
    stageCInpaintDenoise: 0.38,
    stageCMaskGrow: 180,
    stageCMaskFeather: 26,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 770,
    char1GroundY: 1004,
    char1Ratio: 0.97,
    char2FeetX: 470,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_left",
    char2PoseMode: "hold_inner_right",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural stance, torso slightly turned inward toward partner, left hand clearly and naturally holding partner right hand at centerline, grounded feet, complete body",
    char2ActionPrompt:
      "full-body natural stance, torso slightly turned inward toward partner, right hand clearly and naturally holding partner left hand at centerline, grounded feet, complete body",
    char1ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner",
    char2ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner"
  },
  {
    name: "turnaround_posefit_identity_lock_inward_face_stageC_strong_swapped_hands_male_scene_only",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.27,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 22,
    stageCInpaintCfg: 5.1,
    stageCInpaintDenoise: 0.38,
    stageCMaskGrow: 180,
    stageCMaskFeather: 26,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 770,
    char1GroundY: 1004,
    char1Ratio: 0.97,
    char2FeetX: 470,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_left",
    char2PoseMode: "hold_inner_right",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_only",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural inward stance, left hand naturally holding partner right hand at centerline, head gently turning toward partner, grounded feet",
    char2ActionPrompt:
      "full-body natural inward stance, right hand naturally holding partner left hand at centerline, head gently turning toward partner, grounded feet",
    char1ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner",
    char2ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner"
  },
  {
    name: "turnaround_posefit_identity_lock_inward_face_stageC_strong_swapped_hands_male_front",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.27,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 22,
    stageCInpaintCfg: 5.1,
    stageCInpaintDenoise: 0.38,
    stageCMaskGrow: 180,
    stageCMaskFeather: 26,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 770,
    char1GroundY: 1004,
    char1Ratio: 0.98,
    char2FeetX: 470,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_left",
    char2PoseMode: "hold_inner_right",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_only",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural inward stance, left hand naturally holding partner right hand at centerline, head turning toward partner, grounded feet",
    char2ActionPrompt:
      "full-body natural inward stance, right hand naturally holding partner left hand at centerline, head turning toward partner, grounded feet",
    char1ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner",
    char2ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner"
  },
  {
    name: "turnaround_posefit_identity_lock_inward_face_stageC_soft_swapped_hands_male_front",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.27,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 18,
    stageCInpaintCfg: 4.8,
    stageCInpaintDenoise: 0.24,
    stageCMaskGrow: 56,
    stageCMaskFeather: 16,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 770,
    char1GroundY: 1004,
    char1Ratio: 0.98,
    char2FeetX: 470,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_left",
    char2PoseMode: "hold_inner_right",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_only",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural inward stance, left hand naturally holding partner right hand at centerline, head turning toward partner, grounded feet",
    char2ActionPrompt:
      "full-body natural inward stance, right hand naturally holding partner left hand at centerline, head turning toward partner, grounded feet",
    char1ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner",
    char2ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner"
  },
  {
    name: "turnaround_posefit_identity_lock_inward_face_stageC_soft_swapped_hands_male_front_walkhold",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.27,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 18,
    stageCInpaintCfg: 4.8,
    stageCInpaintDenoise: 0.24,
    stageCMaskGrow: 56,
    stageCMaskFeather: 16,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 748,
    char1GroundY: 1004,
    char1Ratio: 1.01,
    char2FeetX: 492,
    char2GroundY: 1004,
    char2Ratio: 0.96,
    char1PoseMode: "walk_hold_inner_left",
    char2PoseMode: "walk_hold_inner_right",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_only",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural walking stance, inner left hand clearly holding partner right hand at centerline, grounded feet, clean fingers, slight inward gaze",
    char2ActionPrompt:
      "full-body natural walking stance, inner right hand clearly holding partner left hand at centerline, grounded feet, clean fingers, slight inward gaze",
    char1ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner",
    char2ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner"
  },
  {
    name: "turnaround_posefit_identity_lock_stageA_clean_stageC_strong",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.27,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: false,
    stageBAllSubjects: true,
    stageCInpaintSteps: 22,
    stageCInpaintCfg: 5.1,
    stageCInpaintDenoise: 0.38,
    stageCMaskGrow: 180,
    stageCMaskFeather: 26,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 770,
    char1GroundY: 1004,
    char1Ratio: 0.97,
    char2FeetX: 470,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural stance, torso slightly turned inward toward partner, right hand clearly and naturally holding partner left hand at centerline, grounded feet, complete body",
    char2ActionPrompt:
      "full-body natural stance, torso slightly turned inward toward partner, left hand clearly and naturally holding partner right hand at centerline, grounded feet, complete body",
    char1ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner",
    char2ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner"
  },
  {
    name: "turnaround_posefit_identity_lock_front_hold_stageC_strong",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.26,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 22,
    stageCInpaintCfg: 5.1,
    stageCInpaintDenoise: 0.36,
    stageCMaskGrow: 150,
    stageCMaskFeather: 24,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 748,
    char1GroundY: 1002,
    char1Ratio: 0.95,
    char2FeetX: 510,
    char2GroundY: 1002,
    char2Ratio: 0.94,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ViewPolicy: "pose_only",
    char2ViewPolicy: "pose_only",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural front-facing stance, slight inward torso toward partner, right hand clearly holding partner left hand at centerline, complete limbs, grounded feet",
    char2ActionPrompt:
      "full-body natural front-facing stance, slight inward torso toward partner, left hand clearly holding partner right hand at centerline, complete limbs, grounded feet",
    char1ExpressionPrompt: "warm gentle smile, clear eyes, preserved male face structure and hairstyle, looking toward partner",
    char2ExpressionPrompt: "warm gentle smile, clear eyes, preserved female face structure and hairstyle, looking toward partner"
  },
  {
    name: "turnaround_posefit_identity_lock_male_front_female_side_stageC",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.24,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 22,
    stageCInpaintCfg: 5.1,
    stageCInpaintDenoise: 0.38,
    stageCMaskGrow: 170,
    stageCMaskFeather: 24,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 770,
    char1GroundY: 1004,
    char1Ratio: 0.97,
    char2FeetX: 470,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "right",
    char1ViewPolicy: "pose_only",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural stance with slight inward shoulder toward partner, right hand clearly holding partner left hand, grounded feet, complete body, preserved male face details",
    char2ActionPrompt:
      "full-body natural stance turned toward partner, left hand clearly holding partner right hand, grounded feet, complete body",
    char1ExpressionPrompt: "warm gentle smile, clear eyes, preserved male face structure and hairstyle",
    char2ExpressionPrompt: "warm gentle smile, clear eyes, preserved female face structure and hairstyle"
  },
  {
    name: "turnaround_posefit_identity_lock_male_front_female_side_stageC_pos_left_tight",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.24,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 22,
    stageCInpaintCfg: 5.1,
    stageCInpaintDenoise: 0.38,
    stageCMaskGrow: 170,
    stageCMaskFeather: 24,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 740,
    char1GroundY: 1000,
    char1Ratio: 0.98,
    char2FeetX: 430,
    char2GroundY: 1000,
    char2Ratio: 0.96,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "right",
    char1ViewPolicy: "pose_only",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural stance with slight inward shoulder toward partner, right hand clearly holding partner left hand, grounded feet, complete body, preserved male face details",
    char2ActionPrompt:
      "full-body natural stance turned toward partner, left hand clearly holding partner right hand, grounded feet, complete body",
    char1ExpressionPrompt: "warm gentle smile, clear eyes, preserved male face structure and hairstyle",
    char2ExpressionPrompt: "warm gentle smile, clear eyes, preserved female face structure and hairstyle"
  },
  {
    name: "turnaround_posefit_identity_lock_male_front_female_side_stageC_pos_center_tight",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.24,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 22,
    stageCInpaintCfg: 5.1,
    stageCInpaintDenoise: 0.38,
    stageCMaskGrow: 170,
    stageCMaskFeather: 24,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 754,
    char1GroundY: 1000,
    char1Ratio: 0.99,
    char2FeetX: 452,
    char2GroundY: 1000,
    char2Ratio: 0.97,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "right",
    char1ViewPolicy: "pose_only",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural stance with slight inward shoulder toward partner, right hand clearly holding partner left hand, grounded feet, complete body, preserved male face details",
    char2ActionPrompt:
      "full-body natural stance turned toward partner, left hand clearly holding partner right hand, grounded feet, complete body",
    char1ExpressionPrompt: "warm gentle smile, clear eyes, preserved male face structure and hairstyle",
    char2ExpressionPrompt: "warm gentle smile, clear eyes, preserved female face structure and hairstyle"
  },
  {
    name: "turnaround_posefit_identity_lock_male_front_female_side_stageC_pos_right_tight",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.24,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 22,
    stageCInpaintCfg: 5.1,
    stageCInpaintDenoise: 0.38,
    stageCMaskGrow: 170,
    stageCMaskFeather: 24,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 782,
    char1GroundY: 1000,
    char1Ratio: 0.99,
    char2FeetX: 478,
    char2GroundY: 1000,
    char2Ratio: 0.97,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "right",
    char1ViewPolicy: "pose_only",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural stance with slight inward shoulder toward partner, right hand clearly holding partner left hand, grounded feet, complete body, preserved male face details",
    char2ActionPrompt:
      "full-body natural stance turned toward partner, left hand clearly holding partner right hand, grounded feet, complete body",
    char1ExpressionPrompt: "warm gentle smile, clear eyes, preserved male face structure and hairstyle",
    char2ExpressionPrompt: "warm gentle smile, clear eyes, preserved female face structure and hairstyle"
  },
  {
    name: "turnaround_posefit_identity_lock_male_front_female_side_stageC_char1_focus",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.24,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCMaskMode: "char1",
    stageCInpaintSteps: 26,
    stageCInpaintCfg: 5.2,
    stageCInpaintDenoise: 0.46,
    stageCMaskGrow: 92,
    stageCMaskFeather: 18,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 770,
    char1GroundY: 1004,
    char1Ratio: 0.97,
    char2FeetX: 470,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "right",
    char1ViewPolicy: "pose_only",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural stance with slight inward shoulder toward partner, right hand clearly holding partner left hand, preserve exact male face detail and hairstyle",
    char2ActionPrompt:
      "full-body natural stance turned toward partner, left hand clearly holding partner right hand, grounded feet, complete body",
    char1ExpressionPrompt: "warm gentle smile, sharp male eye/nose/mouth detail, preserved male facial proportions",
    char2ExpressionPrompt: "warm gentle smile, clear eyes, preserved female face structure and hairstyle"
  },
  {
    name: "turnaround_posefit_identity_lock_male_front_female_side_stageC_detail_boost",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.24,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 26,
    stageCInpaintCfg: 5.4,
    stageCInpaintDenoise: 0.50,
    stageCMaskGrow: 188,
    stageCMaskFeather: 26,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 770,
    char1GroundY: 1004,
    char1Ratio: 0.98,
    char2FeetX: 470,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "right",
    char1ViewPolicy: "pose_only",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural inward stance, right hand clearly holding partner left hand, preserve exact male face detail and hairstyle, grounded feet",
    char2ActionPrompt:
      "full-body natural stance turned toward partner, left hand clearly holding partner right hand, preserve exact female identity, grounded feet",
    char1ExpressionPrompt: "warm gentle smile, sharp male eye and nose detail, preserved male facial proportions",
    char2ExpressionPrompt: "warm gentle smile, clear female eyes and jawline, preserved female facial proportions"
  },
  {
    name: "turnaround_posefit_identity_lock_male_front_female_side_stageC_swapped_contact",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.24,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 22,
    stageCInpaintCfg: 5.1,
    stageCInpaintDenoise: 0.38,
    stageCMaskGrow: 176,
    stageCMaskFeather: 24,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 756,
    char1GroundY: 1004,
    char1Ratio: 0.97,
    char2FeetX: 490,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_left",
    char2PoseMode: "hold_inner_right",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "right",
    char1ViewPolicy: "pose_only",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural inward stance, left hand clearly and naturally holding partner right hand near centerline, complete limbs, grounded feet, preserve male face details",
    char2ActionPrompt:
      "full-body natural inward stance, right hand clearly and naturally holding partner left hand near centerline, complete limbs, grounded feet, preserve female face details",
    char1ExpressionPrompt: "warm gentle smile, preserved male hairline and eye shape",
    char2ExpressionPrompt: "warm gentle smile, preserved female bangs and eye shape"
  },
  {
    name: "turnaround_posefit_identity_lock_male_front_female_side_stageC_detail_contact_mix",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.24,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 24,
    stageCInpaintCfg: 5.3,
    stageCInpaintDenoise: 0.44,
    stageCMaskGrow: 184,
    stageCMaskFeather: 26,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 758,
    char1GroundY: 1004,
    char1Ratio: 0.98,
    char2FeetX: 488,
    char2GroundY: 1004,
    char2Ratio: 0.96,
    char1PoseMode: "hold_inner_left",
    char2PoseMode: "hold_inner_right",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "right",
    char1ViewPolicy: "pose_only",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural inward stance, left hand clearly holding partner right hand, preserve exact male face detail and hairstyle, grounded feet",
    char2ActionPrompt:
      "full-body natural inward stance, right hand clearly holding partner left hand, preserve exact female face detail and hairstyle, grounded feet",
    char1ExpressionPrompt: "warm gentle smile, sharp male eyes and nose, preserved male facial proportions",
    char2ExpressionPrompt: "warm gentle smile, clear female eyes and chin contour, preserved female facial proportions"
  },
  {
    name: "turnaround_posefit_identity_lock_male_front_female_side_stageC_posefit_min",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.08,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 22,
    stageCInpaintCfg: 5.1,
    stageCInpaintDenoise: 0.38,
    stageCMaskGrow: 170,
    stageCMaskFeather: 24,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 770,
    char1GroundY: 1004,
    char1Ratio: 0.97,
    char2FeetX: 470,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "right",
    char1ViewPolicy: "pose_only",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural front stance, preserve exact male identity, right hand naturally holding partner left hand",
    char2ActionPrompt:
      "full-body natural side stance toward partner, preserve exact female identity, left hand naturally holding partner right hand",
    char1ExpressionPrompt: "warm gentle smile, preserved male face detail and hairstyle",
    char2ExpressionPrompt: "warm gentle smile, preserved female face detail and hairstyle"
  },
  {
    name: "turnaround_posefit_identity_lock_male_front_female_side_stageC_sequential_inject",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.24,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: false,
    stageCInpaintSteps: 24,
    stageCInpaintCfg: 5.1,
    stageCInpaintDenoise: 0.34,
    stageCMaskGrow: 150,
    stageCMaskFeather: 22,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 770,
    char1GroundY: 1004,
    char1Ratio: 0.97,
    char2FeetX: 470,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "right",
    char1ViewPolicy: "pose_only",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural front stance, preserve exact male identity and complete body, right hand toward partner",
    char2ActionPrompt:
      "full-body natural side stance toward partner, preserve exact female identity and complete body, left hand toward partner",
    char1ExpressionPrompt: "warm gentle smile, preserved male face detail and hairstyle",
    char2ExpressionPrompt: "warm gentle smile, preserved female face detail and hairstyle"
  },
  {
    name: "turnaround_posefit_identity_lock_male_front_female_side_stageC_hires",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.24,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 22,
    stageCInpaintCfg: 5.1,
    stageCInpaintDenoise: 0.38,
    stageCMaskGrow: 170,
    stageCMaskFeather: 24,
    charRenderWidth: 1024,
    charRenderHeight: 2048,
    char1FeetX: 770,
    char1GroundY: 1004,
    char1Ratio: 0.97,
    char2FeetX: 470,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "right",
    char1ViewPolicy: "pose_only",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural stance with slight inward shoulder toward partner, right hand clearly holding partner left hand, grounded feet, complete body, preserved male face details",
    char2ActionPrompt:
      "full-body natural stance turned toward partner, left hand clearly holding partner right hand, grounded feet, complete body",
    char1ExpressionPrompt: "warm gentle smile, clear eyes, preserved male face structure and hairstyle",
    char2ExpressionPrompt: "warm gentle smile, clear eyes, preserved female face structure and hairstyle"
  },
  {
    name: "turnaround_posefit_identity_lock_male_front_female_side_stageC_repaint_global",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.24,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 30,
    stageCInpaintCfg: 5.4,
    stageCInpaintDenoise: 0.62,
    stageCMaskGrow: 260,
    stageCMaskFeather: 36,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 770,
    char1GroundY: 1004,
    char1Ratio: 0.97,
    char2FeetX: 470,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "right",
    char1ViewPolicy: "pose_only",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural hand-holding walk, right hand clearly holding partner left hand at centerline, preserve exact male identity, complete limbs",
    char2ActionPrompt:
      "full-body natural hand-holding walk toward partner, left hand clearly holding partner right hand at centerline, preserve exact female identity, complete limbs",
    char1ExpressionPrompt: "warm gentle smile, preserved male face structure and hairstyle",
    char2ExpressionPrompt: "warm gentle smile, preserved female face structure and hairstyle"
  },
  {
    name: "turnaround_posefit_target_match_pose_box_v1",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.26,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 24,
    stageCInpaintCfg: 5.0,
    stageCInpaintDenoise: 0.34,
    stageCMaskGrow: 176,
    stageCMaskFeather: 24,
    sceneCameraHint:
      "medium full shot, eye-level camera, two-character hand-holding walk, inward gaze, clean full-body composition",
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 735,
    char1GroundY: 1002,
    char1Ratio: 0.98,
    char2FeetX: 430,
    char2GroundY: 1002,
    char2Ratio: 0.96,
    char1PoseMode: "hold_inner_left",
    char2PoseMode: "hold_inner_right",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ViewPolicy: "scene_only",
    char2ViewPolicy: "scene_only",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural walk, left hand clearly holding partner right hand at centerline, head and eyes gently turned toward partner, preserve exact male identity",
    char2ActionPrompt:
      "full-body natural walk, right hand clearly holding partner left hand at centerline, head and eyes gently turned toward partner, preserve exact female identity",
    char1ExpressionPrompt: "warm gentle smile, clean eyes, preserved male face details and hairstyle",
    char2ExpressionPrompt: "warm gentle smile, clean eyes, preserved female face details and hairstyle"
  },
  {
    name: "turnaround_source_hybrid_male_lock_female_natural_v1",
    renderMode: "turnaround_pose_fit",
    char1RenderMode: "turnaround_pose_fit",
    char2RenderMode: "source_image",
    poseFit: 0.24,
    char1PoseFit: 0.24,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 24,
    stageCInpaintCfg: 5.1,
    stageCInpaintDenoise: 0.38,
    stageCMaskGrow: 176,
    stageCMaskFeather: 24,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 758,
    char1GroundY: 1004,
    char1Ratio: 0.97,
    char2FeetX: 452,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_left",
    char2PoseMode: "hold_inner_right",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ViewPolicy: "pose_only",
    char2ViewPolicy: "scene_only",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural walk, left hand clearly holding partner right hand at centerline, head gently turned toward partner, preserve exact male identity",
    char2ActionPrompt:
      "full-body natural walk, right hand clearly holding partner left hand at centerline, natural facial detail, preserve female identity",
    char1ExpressionPrompt: "warm gentle smile, clean eyes, preserved male face details and hairstyle",
    char2ExpressionPrompt: "warm gentle smile, clean eyes, preserved female face details and hairstyle"
  },
  {
    name: "turnaround_posefit_identity_lock_pair_front_swapped_contact_v2",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.24,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 22,
    stageCInpaintCfg: 5.0,
    stageCInpaintDenoise: 0.36,
    stageCMaskGrow: 180,
    stageCMaskFeather: 24,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 748,
    char1GroundY: 1004,
    char1Ratio: 0.98,
    char2FeetX: 512,
    char2GroundY: 1004,
    char2Ratio: 0.98,
    char1PoseMode: "hold_inner_left",
    char2PoseMode: "hold_inner_right",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ViewPolicy: "pose_only",
    char2ViewPolicy: "pose_only",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural inward stance, left hand clearly holding partner right hand at centerline, complete limbs, grounded feet, preserve exact male face and hairstyle",
    char2ActionPrompt:
      "full-body natural inward stance, right hand clearly holding partner left hand at centerline, complete limbs, grounded feet, preserve exact female face and hairstyle",
    char1ExpressionPrompt: "warm gentle smile, clear eyes, looking toward partner, preserve exact male facial proportions",
    char2ExpressionPrompt: "warm gentle smile, clear eyes, looking toward partner, preserve exact female facial proportions"
  },
  {
    name: "turnaround_posefit_gate_push_front_male_contact_v1",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.25,
    inpaintSteps: 20,
    inpaintCfg: 5.0,
    inpaintDenoise: 0.28,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 16,
    stageAInpaintCfg: 4.8,
    stageAInpaintDenoise: 0.20,
    stageAMaskGrow: 12,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 18,
    stageCInpaintCfg: 4.8,
    stageCInpaintDenoise: 0.28,
    stageCMaskGrow: 84,
    stageCMaskFeather: 16,
    sceneCameraHint:
      "medium full shot, eye-level, slight front-facing two-character composition, natural hand-holding interaction near centerline",
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 726,
    char1GroundY: 1002,
    char1Ratio: 0.99,
    char2FeetX: 526,
    char2GroundY: 1002,
    char2Ratio: 0.97,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "front",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_only",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural stance, right hand clearly and naturally holding partner left hand at centerline, grounded feet, complete limbs, preserve exact male face identity",
    char2ActionPrompt:
      "full-body natural stance, left hand clearly and naturally holding partner right hand at centerline, grounded feet, complete limbs, preserve exact female face identity",
    char1ExpressionPrompt: "warm gentle smile, clear eyes, preserve exact male hairline and facial proportions",
    char2ExpressionPrompt: "warm gentle smile, clear eyes, preserve exact female hairline and facial proportions"
  },
  {
    name: "turnaround_posefit_identity_lock_front_camera_hold_stageB",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.24,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCSkipInpaint: true,
    sceneCameraHint:
      "medium full shot, front view, eye-level camera, two characters on riverside path, natural hand-holding interaction",
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 760,
    char1GroundY: 1002,
    char1Ratio: 0.96,
    char2FeetX: 500,
    char2GroundY: 1002,
    char2Ratio: 0.94,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural stance, slight inward torso, right hand clearly holding partner left hand at centerline, grounded feet, preserved male identity details",
    char2ActionPrompt:
      "full-body natural stance, slight inward torso, left hand clearly holding partner right hand at centerline, grounded feet, preserved female identity details",
    char1ExpressionPrompt: "warm gentle smile, clear eyes, looking toward partner",
    char2ExpressionPrompt: "warm gentle smile, clear eyes, looking toward partner"
  },
  {
    name: "turnaround_posefit_identity_lock_male_front_scene_hint",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.27,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 22,
    stageCInpaintCfg: 5.1,
    stageCInpaintDenoise: 0.36,
    stageCMaskGrow: 170,
    stageCMaskFeather: 24,
    sceneCameraHint:
      "medium full shot, front view, eye-level camera, riverside stone bridge at dusk, two characters naturally interacting",
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 770,
    char1GroundY: 1004,
    char1Ratio: 0.97,
    char2FeetX: 470,
    char2GroundY: 1004,
    char2Ratio: 0.95,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_only",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural stance, right hand clearly and naturally holding partner left hand at centerline, grounded feet, preserved male identity",
    char2ActionPrompt:
      "full-body natural stance, left hand clearly and naturally holding partner right hand at centerline, grounded feet, preserved female identity",
    char1ExpressionPrompt: "warm gentle smile, clear eyes, preserved male face structure and hairstyle",
    char2ExpressionPrompt: "warm gentle smile, clear eyes, preserved female face structure and hairstyle"
  },
  {
    name: "turnaround_posefit_identity_lock_inward_face_stageC_contact_boost",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.25,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 22,
    stageCInpaintCfg: 5.1,
    stageCInpaintDenoise: 0.34,
    stageCMaskGrow: 110,
    stageCMaskFeather: 24,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 752,
    char1GroundY: 1004,
    char1Ratio: 0.98,
    char2FeetX: 510,
    char2GroundY: 1004,
    char2Ratio: 0.96,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural inward stance, torso turned toward partner, right hand clearly holding partner left hand at centerline, complete limbs, grounded feet, clean fingers",
    char2ActionPrompt:
      "full-body natural inward stance, torso turned toward partner, left hand clearly holding partner right hand at centerline, complete limbs, grounded feet, clean fingers",
    char1ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner",
    char2ExpressionPrompt: "warm gentle smile, clean eyes, clear face details, looking toward partner"
  },
  {
    name: "turnaround_posefit_poseonly_face_to_face_handhold",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.29,
    inpaintSteps: 20,
    inpaintCfg: 5.2,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 20,
    stageCInpaintCfg: 5.0,
    stageCInpaintDenoise: 0.30,
    stageCMaskGrow: 72,
    stageCMaskFeather: 18,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 800,
    char1GroundY: 1004,
    char1Ratio: 0.98,
    char2FeetX: 520,
    char2GroundY: 1004,
    char2Ratio: 0.96,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1ExpressionMode: "happy",
    char2ExpressionMode: "happy",
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ViewPolicy: "pose_only",
    char2ViewPolicy: "pose_only",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural face-to-face stance, right hand clearly clasping partner left hand at waist level near frame center, grounded feet, relaxed shoulders, complete limbs",
    char2ActionPrompt:
      "full-body natural face-to-face stance, left hand clearly clasping partner right hand at waist level near frame center, grounded feet, relaxed shoulders, complete limbs",
    char1ExpressionPrompt: "gentle smile, clear eyes, clean male facial features, looking toward partner",
    char2ExpressionPrompt: "gentle smile, clear eyes, clean female facial features, looking toward partner"
  },
  {
    name: "turnaround_posefit_front_handhold_natural",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.24,
    inpaintSteps: 22,
    inpaintCfg: 5.4,
    inpaintDenoise: 0.34,
    maskGrow: 20,
    maskFeather: 11,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageCInpaintSteps: 18,
    stageCInpaintCfg: 4.8,
    stageCInpaintDenoise: 0.24,
    stageCMaskGrow: 30,
    stageCMaskFeather: 14,
    char1FeetX: 740,
    char1GroundY: 1000,
    char1Ratio: 0.96,
    char2FeetX: 450,
    char2GroundY: 1000,
    char2Ratio: 0.94,
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural side-by-side walk, slight three-quarter front toward camera, left hand gently holding partner hand near body center, right arm relaxed",
    char2ActionPrompt:
      "full-body natural side-by-side walk, slight three-quarter front toward camera, right hand gently holding partner hand near body center, left arm relaxed",
    char1ExpressionPrompt: "gentle smile, calm eyes, looking slightly toward partner",
    char2ExpressionPrompt: "gentle smile, calm eyes, looking slightly toward partner"
  },
  {
    name: "source_image_front_handhold_natural",
    renderMode: "source_image",
    poseFit: 0.42,
    inpaintSteps: 24,
    inpaintCfg: 5.8,
    inpaintDenoise: 0.42,
    maskGrow: 24,
    maskFeather: 12,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.26,
    stageAMaskGrow: 16,
    stageAMaskFeather: 8,
    stageCInpaintSteps: 18,
    stageCInpaintCfg: 4.8,
    stageCInpaintDenoise: 0.28,
    stageCMaskGrow: 34,
    stageCMaskFeather: 16,
    char1FeetX: 738,
    char1GroundY: 1000,
    char1Ratio: 0.96,
    char2FeetX: 448,
    char2GroundY: 1000,
    char2Ratio: 0.94,
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural side-by-side walk, slight three-quarter front toward camera, left hand gently holding partner hand near body center, right arm relaxed",
    char2ActionPrompt:
      "full-body natural side-by-side walk, slight three-quarter front toward camera, right hand gently holding partner hand near body center, left arm relaxed",
    char1ExpressionPrompt: "gentle smile, calm eyes, looking slightly toward partner",
    char2ExpressionPrompt: "gentle smile, calm eyes, looking slightly toward partner"
  },
  {
    name: "turnaround_posefit_front_pair_pose_rewrite",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.32,
    inpaintSteps: 24,
    inpaintCfg: 5.8,
    inpaintDenoise: 0.44,
    maskGrow: 24,
    maskFeather: 12,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.26,
    stageAMaskGrow: 16,
    stageAMaskFeather: 8,
    stageCInpaintSteps: 22,
    stageCInpaintCfg: 5.0,
    stageCInpaintDenoise: 0.38,
    stageCMaskGrow: 160,
    stageCMaskFeather: 24,
    char1FeetX: 750,
    char1GroundY: 1000,
    char1Ratio: 0.96,
    char2FeetX: 440,
    char2GroundY: 1000,
    char2Ratio: 0.94,
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural walking pose, slight three-quarter front, left hand firmly and naturally holding partner right hand at waist level, right arm relaxed, normal leg stride",
    char2ActionPrompt:
      "full-body natural walking pose, slight three-quarter front, right hand firmly and naturally holding partner left hand at waist level, left arm relaxed, normal leg stride",
    char1ExpressionPrompt: "gentle smile, calm eyes, natural face shape, not blank expression",
    char2ExpressionPrompt: "gentle smile, calm eyes, natural face shape, not blank expression"
  },
  {
    name: "turnaround_posefit_front_walk_interaction_identity_hd",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.28,
    inpaintSteps: 24,
    inpaintCfg: 5.9,
    inpaintDenoise: 0.4,
    maskGrow: 22,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 20,
    stageAInpaintCfg: 5.1,
    stageAInpaintDenoise: 0.26,
    stageAMaskGrow: 16,
    stageAMaskFeather: 8,
    stageCInpaintSteps: 24,
    stageCInpaintCfg: 5.2,
    stageCInpaintDenoise: 0.42,
    stageCMaskGrow: 180,
    stageCMaskFeather: 26,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 760,
    char1GroundY: 1004,
    char1Ratio: 0.98,
    char2FeetX: 456,
    char2GroundY: 1004,
    char2Ratio: 0.98,
    char1PoseMode: "walk_right",
    char2PoseMode: "walk_left",
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 11,
    char2Feather: 11,
    char1ShadowStrength: 0.36,
    char2ShadowStrength: 0.36,
    char1ActionPrompt:
      "full-body natural walk, torso slightly inward toward partner, left hand naturally holding partner right hand near centerline, grounded feet, clean fingers",
    char2ActionPrompt:
      "full-body natural walk, torso slightly inward toward partner, right hand naturally holding partner left hand near centerline, grounded feet, clean fingers",
    char1ExpressionPrompt: "warm gentle smile, clean eyes, detailed face, stable haircut",
    char2ExpressionPrompt: "warm gentle smile, clean eyes, detailed face, stable haircut"
  },
  {
    name: "turnaround_posefit_front_walk_interaction_identity_detail_lock",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.26,
    inpaintSteps: 22,
    inpaintCfg: 5.7,
    inpaintDenoise: 0.36,
    maskGrow: 20,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 20,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageCInpaintSteps: 22,
    stageCInpaintCfg: 5.1,
    stageCInpaintDenoise: 0.34,
    stageCMaskGrow: 150,
    stageCMaskFeather: 24,
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 768,
    char1GroundY: 1004,
    char1Ratio: 0.99,
    char2FeetX: 464,
    char2GroundY: 1004,
    char2Ratio: 0.99,
    char1PoseMode: "walk_right",
    char2PoseMode: "walk_left",
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.35,
    char2ShadowStrength: 0.35,
    char1ActionPrompt:
      "full-body close pair walk, natural shoulder relaxation, left hand naturally holding partner hand, clean limb structure, no overlap glitches",
    char2ActionPrompt:
      "full-body close pair walk, natural shoulder relaxation, right hand naturally holding partner hand, clean limb structure, no overlap glitches",
    char1ExpressionPrompt: "gentle smile, natural eyes, clear facial details, no blur",
    char2ExpressionPrompt: "gentle smile, natural eyes, clear facial details, no blur"
  },
  {
    name: "turnaround_posefit_target_alignment_front_hold_exact_v1",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.24,
    inpaintSteps: 20,
    inpaintCfg: 5.0,
    inpaintDenoise: 0.32,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 20,
    stageCInpaintCfg: 4.8,
    stageCInpaintDenoise: 0.24,
    stageCMaskGrow: 80,
    stageCMaskFeather: 18,
    sceneCameraHint:
      "medium full shot, eye-level front view, two characters naturally hand-holding on riverside path, cinematic dusk lighting",
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 760,
    char1GroundY: 1004,
    char1Ratio: 0.99,
    char2FeetX: 468,
    char2GroundY: 1004,
    char2Ratio: 0.97,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural walking pose, left hand naturally holding partner right hand at centerline, clean fingers, grounded feet, slight inward gaze toward partner",
    char2ActionPrompt:
      "full-body natural walking pose, right hand naturally holding partner left hand at centerline, clean fingers, grounded feet, slight inward gaze toward partner",
    char1ExpressionPrompt: "warm gentle smile, clear eyes, stable male face identity",
    char2ExpressionPrompt: "warm gentle smile, clear eyes, stable female face identity"
  },
  {
    name: "turnaround_posefit_target_alignment_three_quarter_hold_v1",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.24,
    inpaintSteps: 20,
    inpaintCfg: 5.1,
    inpaintDenoise: 0.32,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 20,
    stageCInpaintCfg: 4.9,
    stageCInpaintDenoise: 0.26,
    stageCMaskGrow: 90,
    stageCMaskFeather: 18,
    sceneCameraHint:
      "medium full shot, eye-level front camera, two characters in slight three-quarter inward stance, natural hand-holding at centerline",
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 758,
    char1GroundY: 1004,
    char1Ratio: 0.98,
    char2FeetX: 488,
    char2GroundY: 1004,
    char2Ratio: 0.96,
    char1PoseMode: "hold_inner_right",
    char2PoseMode: "hold_inner_left",
    char1FacingDirection: "left",
    char2FacingDirection: "right",
    char1ViewPolicy: "scene_only",
    char2ViewPolicy: "scene_only",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body slight three-quarter inward stance, right hand naturally holding partner left hand at centerline, grounded feet, natural shoulder relaxation",
    char2ActionPrompt:
      "full-body slight three-quarter inward stance, left hand naturally holding partner right hand at centerline, grounded feet, natural shoulder relaxation",
    char1ExpressionPrompt: "warm gentle smile, looking at partner, preserve male face structure",
    char2ExpressionPrompt: "warm gentle smile, looking at partner, preserve female face structure"
  },
  {
    name: "turnaround_posefit_target_alignment_walk_hold_newpose_v1",
    renderMode: "turnaround_pose_fit",
    poseFit: 0.24,
    inpaintSteps: 20,
    inpaintCfg: 5.0,
    inpaintDenoise: 0.30,
    maskGrow: 18,
    maskFeather: 10,
    stageAInpaint: true,
    stageAInpaintSteps: 18,
    stageAInpaintCfg: 5.0,
    stageAInpaintDenoise: 0.24,
    stageAMaskGrow: 14,
    stageAMaskFeather: 8,
    stageBAllSubjects: true,
    stageCInpaintSteps: 20,
    stageCInpaintCfg: 4.8,
    stageCInpaintDenoise: 0.24,
    stageCMaskGrow: 84,
    stageCMaskFeather: 18,
    sceneCameraHint:
      "medium full shot, eye-level front camera, two characters naturally walking side by side while holding inner hands",
    charRenderWidth: 640,
    charRenderHeight: 1536,
    char1FeetX: 758,
    char1GroundY: 1004,
    char1Ratio: 0.98,
    char2FeetX: 476,
    char2GroundY: 1004,
    char2Ratio: 0.96,
    char1PoseMode: "walk_hold_inner_left",
    char2PoseMode: "walk_hold_inner_right",
    char1FacingDirection: "front",
    char2FacingDirection: "front",
    char1ViewPolicy: "scene_then_pose",
    char2ViewPolicy: "scene_then_pose",
    char1Feather: 10,
    char2Feather: 10,
    char1ShadowStrength: 0.34,
    char2ShadowStrength: 0.34,
    char1ActionPrompt:
      "full-body natural walk, inner left hand holding partner right hand at centerline, clean finger anatomy, slight inward gaze",
    char2ActionPrompt:
      "full-body natural walk, inner right hand holding partner left hand at centerline, clean finger anatomy, slight inward gaze",
    char1ExpressionPrompt: "warm gentle smile, preserve male face and hairline",
    char2ExpressionPrompt: "warm gentle smile, preserve female face and hairline"
  }
];
const candidateFilterTokens = String(args.candidates ?? "")
  .split(",")
  .map((token) => token.trim())
  .filter((token) => token.length > 0);
const activeCandidateConfigs =
  candidateFilterTokens.length === 0
    ? candidateConfigs
    : candidateConfigs.filter((config) =>
        candidateFilterTokens.some((token) => {
          if (token.startsWith("=")) {
            return config.name === token.slice(1);
          }
          return config.name.includes(token);
        })
      );

function buildExecutionCandidates(baseCandidates) {
  if (!Array.isArray(baseCandidates) || baseCandidates.length === 0) return [];
  if (seedSweepCount <= 1) return baseCandidates.map((config) => ({ ...config }));
  const expanded = [];
  for (const config of baseCandidates) {
    const baseOffset = Number.isFinite(Number(config.seedOffset)) ? Number(config.seedOffset) : 0;
    for (let sweepIndex = 0; sweepIndex < seedSweepCount; sweepIndex += 1) {
      const suffix = sweepIndex === 0 ? "" : `__seed${sweepIndex + 1}`;
      expanded.push({
        ...config,
        name: `${config.name}${suffix}`,
        baseName: config.name,
        seedOffset: baseOffset + sweepIndex * seedSweepStep
      });
    }
  }
  return expanded;
}
const executionCandidateConfigs = buildExecutionCandidates(activeCandidateConfigs);

function workflowNodes(workflow) {
  return Array.isArray(workflow.nodes) ? workflow.nodes : [];
}

function workflowLinks(workflow) {
  if (!Array.isArray(workflow.links)) workflow.links = [];
  return workflow.links;
}

function resolvePresetCheckpointName(workflow) {
  const nodes = workflowNodes(workflow);
  const checkpointNode = nodes.find((node) => (node?.type ?? "").trim() === "CheckpointLoaderSimple");
  const widgets = Array.isArray(checkpointNode?.widgets_values) ? checkpointNode.widgets_values : [];
  const value = String(widgets[0] ?? "").trim();
  return value;
}

function selectPreferredCheckpoint(candidates) {
  const orderedPreferred = [
    "cardosAnime_v10.safetensors",
    "animagine-xl-4.0.safetensors",
    "animaPencilXL_v100_2.safetensors",
    "Anything-V3.0.ckpt",
    "awpainting_v14.safetensors",
    "NetaYumev35_pretrained_all_in_one.safetensors",
    "sd_xl_base_1.0.safetensors",
    "realisticVisionV60B1_v51VAE.safetensors"
  ];
  const normalized = new Map(candidates.map((name) => [String(name).trim().toLowerCase(), String(name).trim()]));
  for (const target of orderedPreferred) {
    const hit = normalized.get(target.toLowerCase());
    if (hit) return hit;
  }
  const softHit =
    candidates.find((name) => /animagine|anime|anima|anything|awpainting|cardos/i.test(String(name))) ??
    candidates.find((name) => /sd[_-]?xl|xl/i.test(String(name))) ??
    candidates[0] ??
    "";
  return String(softHit).trim();
}

function isNodeDisabled(node) {
  return typeof node?.mode === "number" && node.mode === 4;
}

function setNodeEnabled(node, enabled) {
  if (!node) return;
  node.mode = enabled ? 0 : 4;
}

function setNodeWidgetValue(node, index, value) {
  if (!node || !Array.isArray(node.widgets_values)) return;
  if (index < 0 || index >= node.widgets_values.length) return;
  node.widgets_values[index] = value;
}

function isKSamplerControlAfterGenerateValue(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "fixed" || normalized === "randomize" || normalized === "increment" || normalized === "decrement";
}

function setKSamplerWidgetValues(node, values) {
  if (!node || !Array.isArray(node.widgets_values) || node.widgets_values.length === 0) return;
  const hasControlAfterGenerateSlot =
    node.widgets_values.length >= 7 && isKSamplerControlAfterGenerateValue(node.widgets_values[1]);
  setNodeWidgetValue(node, 0, values.seed);
  if (hasControlAfterGenerateSlot) {
    setNodeWidgetValue(node, 1, values.controlAfterGenerate ?? "fixed");
    setNodeWidgetValue(node, 2, values.steps);
    setNodeWidgetValue(node, 3, values.cfg);
    setNodeWidgetValue(node, 4, values.samplerName);
    setNodeWidgetValue(node, 5, values.scheduler);
    setNodeWidgetValue(node, 6, values.denoise);
    return;
  }
  setNodeWidgetValue(node, 1, values.steps);
  setNodeWidgetValue(node, 2, values.cfg);
  setNodeWidgetValue(node, 3, values.samplerName);
  setNodeWidgetValue(node, 4, values.scheduler);
  setNodeWidgetValue(node, 5, values.denoise);
}

function getNodeByIdMap(workflow) {
  const map = new Map();
  for (const node of workflowNodes(workflow)) {
    if (typeof node?.id === "number") map.set(node.id, node);
  }
  return map;
}

function removeIncomingLinks(workflow, targetNodeId, inputIndices) {
  const links = workflowLinks(workflow);
  const blocked = new Set(inputIndices);
  workflow.links = links.filter((link) => {
    if (!Array.isArray(link) || link.length < 5) return false;
    return !(Number(link[3]) === targetNodeId && blocked.has(Number(link[4])));
  });
}

function ensureWorkflowLink(workflow, byId, sourceNodeId, sourceSlot, targetNodeId, targetInputIndex, type = "MASK") {
  removeIncomingLinks(workflow, targetNodeId, [targetInputIndex]);
  const links = workflowLinks(workflow);
  const nextLinkId = Number(workflow.last_link_id ?? 0) + 1;
  workflow.last_link_id = nextLinkId;
  links.push([nextLinkId, sourceNodeId, sourceSlot, targetNodeId, targetInputIndex, type]);

  const targetNode = byId.get(targetNodeId);
  if (targetNode && Array.isArray(targetNode.inputs) && targetNode.inputs[targetInputIndex]) {
    targetNode.inputs[targetInputIndex].link = nextLinkId;
  }
  const sourceNode = byId.get(sourceNodeId);
  if (sourceNode && Array.isArray(sourceNode.outputs) && sourceNode.outputs[sourceSlot]) {
    if (!Array.isArray(sourceNode.outputs[sourceSlot].links)) {
      sourceNode.outputs[sourceSlot].links = [];
    }
    sourceNode.outputs[sourceSlot].links.push(nextLinkId);
  }
}

function ensureDebugSaveNode(workflow, byId, saveNodeId, sourceNodeId, sourceSlot, filenamePrefix) {
  const template = byId.get(22);
  if (!template) return;
  let saveNode = byId.get(saveNodeId);
  if (!saveNode) {
    saveNode = JSON.parse(JSON.stringify(template));
    saveNode.id = saveNodeId;
    saveNode.pos = [Number(template.pos?.[0] ?? 0) + (saveNodeId - 900) * 24, Number(template.pos?.[1] ?? 0) + 120];
    saveNode.title = `Debug Save ${sourceNodeId}`;
    workflow.nodes.push(saveNode);
    byId.set(saveNodeId, saveNode);
  }
  if (!Array.isArray(saveNode.widgets_values) || saveNode.widgets_values.length === 0) {
    saveNode.widgets_values = [filenamePrefix];
  } else {
    saveNode.widgets_values[0] = filenamePrefix;
  }
  setNodeEnabled(saveNode, true);
  ensureWorkflowLink(workflow, byId, sourceNodeId, sourceSlot, saveNodeId, 0, "IMAGE");
}

function ensureMaskToImageNode(workflow, byId, nodeId, sourceNodeId, sourceSlot) {
  let node = byId.get(nodeId);
  if (!node) {
    node = {
      id: nodeId,
      type: "MaskToImage",
      pos: [0, 0],
      size: [210, 46],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [{ localized_name: "mask", name: "mask", type: "MASK", link: null }],
      outputs: [{ localized_name: "IMAGE", name: "IMAGE", type: "IMAGE", links: [] }],
      properties: { "Node name for S&R": "MaskToImage" },
      widgets_values: []
    };
    workflow.nodes.push(node);
    byId.set(nodeId, node);
  }
  setNodeEnabled(node, true);
  ensureWorkflowLink(workflow, byId, sourceNodeId, sourceSlot, nodeId, 0, "MASK");
}

function setNodesEnabled(byId, ids, enabled) {
  for (const id of ids) setNodeEnabled(byId.get(id), enabled);
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveInpaintParamsByStage(config, stage) {
  const baseSteps = toFiniteNumber(config.inpaintSteps) ?? 20;
  const baseCfg = toFiniteNumber(config.inpaintCfg) ?? 5.6;
  const baseDenoise = toFiniteNumber(config.inpaintDenoise) ?? 0.36;
  const baseMaskGrow = toFiniteNumber(config.maskGrow) ?? 20;
  const baseMaskFeather = toFiniteNumber(config.maskFeather) ?? 10;

  if (stage === "stageA") {
    return {
      steps: Math.max(
        1,
        Math.round(
          toFiniteNumber(config.stageAInpaintSteps) ?? Math.max(16, Math.round(baseSteps - 4))
        )
      ),
      cfg: toFiniteNumber(config.stageAInpaintCfg) ?? Math.max(5.0, Math.min(5.8, baseCfg)),
      denoise:
        toFiniteNumber(config.stageAInpaintDenoise) ?? Math.max(0.22, Math.min(0.34, baseDenoise)),
      maskGrow: Math.max(1, Math.round(toFiniteNumber(config.stageAMaskGrow) ?? baseMaskGrow)),
      maskFeather: Math.max(0, Math.round(toFiniteNumber(config.stageAMaskFeather) ?? baseMaskFeather)),
      samplerName: String(config.stageASamplerName ?? config.inpaintSamplerName ?? "euler"),
      scheduler: String(config.stageAScheduler ?? config.inpaintScheduler ?? "normal")
    };
  }

  if (stage === "stageC") {
    return {
      steps: Math.max(
        1,
        Math.round(
          toFiniteNumber(config.stageCInpaintSteps) ??
            Math.max(12, Math.min(22, Math.round(baseSteps * 0.82)))
        )
      ),
      cfg: toFiniteNumber(config.stageCInpaintCfg) ?? Math.max(4.0, Math.min(5.0, baseCfg - 0.8)),
      denoise:
        toFiniteNumber(config.stageCInpaintDenoise) ??
        Math.max(0.12, Math.min(0.26, baseDenoise * 0.5)),
      maskGrow: Math.max(
        1,
        Math.round(toFiniteNumber(config.stageCMaskGrow) ?? Math.max(8, Math.min(18, Math.round(baseMaskGrow * 0.55))))
      ),
      maskFeather: Math.max(
        0,
        Math.round(
          toFiniteNumber(config.stageCMaskFeather) ?? Math.max(4, Math.min(10, Math.round(baseMaskFeather * 0.6)))
        )
      ),
      samplerName: String(config.stageCSamplerName ?? config.inpaintSamplerName ?? "dpmpp_2m"),
      scheduler: String(config.stageCScheduler ?? config.inpaintScheduler ?? "karras")
    };
  }

  return {
    steps: Math.max(1, Math.round(baseSteps)),
    cfg: baseCfg,
    denoise: baseDenoise,
    maskGrow: Math.max(1, Math.round(baseMaskGrow)),
    maskFeather: Math.max(0, Math.round(baseMaskFeather)),
    samplerName: String(config.inpaintSamplerName ?? "euler"),
    scheduler: String(config.inpaintScheduler ?? "normal")
  };
}

function configureSingleLayerComposite(workflow, byId, placedLayerNodeId) {
  setNodeEnabled(byId.get(32), false);
  removeIncomingLinks(workflow, 21, [1, 2, 3]);
  ensureWorkflowLink(workflow, byId, placedLayerNodeId, 0, 21, 1, "PLACED_LAYER");
}

function applyCandidateBindings(workflow, config, iterationIndex, selectedCheckpoint, options = {}) {
  const byId = getNodeByIdMap(workflow);
  const stage = String(options.stage ?? "single");
  const sceneInput = String(options.sceneInput ?? requiredInputs.scene);
  const forceSkipInpaint = options.forceSkipInpaint === true;

  const sceneNode = byId.get(2);
  setNodeWidgetValue(sceneNode, 0, 1536);
  setNodeWidgetValue(sceneNode, 1, 1024);
  setNodeWidgetValue(
    sceneNode,
    3,
    config.sceneCameraHint ??
      "medium full shot, eye-level, riverside stone bridge at dusk, two characters walking naturally, clean cinematic storyboard"
  );

  setNodeWidgetValue(byId.get(1), 0, sceneInput);
  setNodeWidgetValue(byId.get(3), 0, requiredInputs.char1Front);
  setNodeWidgetValue(byId.get(4), 0, requiredInputs.char1Side);
  setNodeWidgetValue(byId.get(5), 0, requiredInputs.char1Back);
  setNodeWidgetValue(byId.get(12), 0, requiredInputs.char2Front);
  setNodeWidgetValue(byId.get(13), 0, requiredInputs.char2Side);
  setNodeWidgetValue(byId.get(14), 0, requiredInputs.char2Back);

  setNodeWidgetValue(byId.get(6), 0, "沈砚");
  setNodeWidgetValue(
    byId.get(6),
    1,
    "exact identity lock from turnaround, clean anime storyboard, natural anatomy, young Chinese male, short black hair, clean face, no facial distortion, coat silhouette preserved"
  );
  setNodeWidgetValue(byId.get(6), 3, "dark blue long coat, white shirt, belt, black boots");
  setNodeWidgetValue(byId.get(6), 4, "gentle expression");
  setNodeWidgetValue(byId.get(15), 0, "江岚");
  setNodeWidgetValue(
    byId.get(15),
    1,
    "exact identity lock from turnaround, clean anime storyboard, natural anatomy, young Chinese female, long straight black hair, natural eyes and face proportion, dress silhouette preserved"
  );
  setNodeWidgetValue(byId.get(15), 3, "light blue dress, white collar, black flats");
  setNodeWidgetValue(byId.get(15), 4, "gentle expression");
  setNodeWidgetValue(byId.get(6), 7, config.char1SideViewDirection ?? "right");
  setNodeWidgetValue(byId.get(15), 7, config.char2SideViewDirection ?? "left");
  setNodeWidgetValue(byId.get(6), 8, config.char1MirrorSideForOpposite ?? true);
  setNodeWidgetValue(byId.get(15), 8, config.char2MirrorSideForOpposite ?? true);

  setNodeWidgetValue(byId.get(7), 0, config.char1PoseMode ?? "stand");
  setNodeWidgetValue(byId.get(7), 1, config.char1FacingDirection ?? "front");
  setNodeWidgetValue(byId.get(7), 2, config.char1ExpressionMode ?? "happy");
  setNodeWidgetValue(byId.get(7), 3, config.char1ActionPrompt ?? "full-body natural stance, slightly turning toward partner, holding hands");
  setNodeWidgetValue(byId.get(7), 4, config.char1ExpressionPrompt ?? "warm gentle smile, clean eyes");
  setNodeWidgetValue(byId.get(16), 0, config.char2PoseMode ?? "stand");
  setNodeWidgetValue(byId.get(16), 1, config.char2FacingDirection ?? "front");
  setNodeWidgetValue(byId.get(16), 2, config.char2ExpressionMode ?? "happy");
  setNodeWidgetValue(byId.get(16), 3, config.char2ActionPrompt ?? "full-body natural stance, slightly turning toward partner, holding hands");
  setNodeWidgetValue(byId.get(16), 4, config.char2ExpressionPrompt ?? "warm gentle smile, clean eyes");

  setNodeWidgetValue(byId.get(8), 0, config.char1ViewPolicy ?? "scene_then_pose");
  setNodeWidgetValue(byId.get(17), 0, config.char2ViewPolicy ?? "scene_then_pose");

  const char1RenderMode = config.char1RenderMode ?? config.renderMode;
  const char2RenderMode = config.char2RenderMode ?? config.renderMode;
  const char1RenderWidth = config.char1RenderWidth ?? config.charRenderWidth ?? 512;
  const char1RenderHeight = config.char1RenderHeight ?? config.charRenderHeight ?? 1280;
  const char2RenderWidth = config.char2RenderWidth ?? config.charRenderWidth ?? 512;
  const char2RenderHeight = config.char2RenderHeight ?? config.charRenderHeight ?? 1280;
  const char1PoseFit = config.char1PoseFit ?? config.poseFit;
  const char2PoseFit = config.char2PoseFit ?? config.poseFit;

  setNodeWidgetValue(byId.get(9), 0, char1RenderMode);
  setNodeWidgetValue(byId.get(9), 1, char1RenderWidth);
  setNodeWidgetValue(byId.get(9), 2, char1RenderHeight);
  setNodeWidgetValue(byId.get(9), 4, char1PoseFit);
  setNodeWidgetValue(byId.get(18), 0, char2RenderMode);
  setNodeWidgetValue(byId.get(18), 1, char2RenderWidth);
  setNodeWidgetValue(byId.get(18), 2, char2RenderHeight);
  setNodeWidgetValue(byId.get(18), 4, char2PoseFit);
  setNodeWidgetValue(byId.get(10), 0, "sample_corners");
  setNodeWidgetValue(byId.get(10), 1, "#FFFFFF");
  setNodeWidgetValue(byId.get(10), 2, 0.22);
  setNodeWidgetValue(byId.get(10), 3, 1);
  setNodeWidgetValue(byId.get(10), 4, 30);
  setNodeWidgetValue(byId.get(19), 0, "sample_corners");
  setNodeWidgetValue(byId.get(19), 1, "#FFFFFF");
  setNodeWidgetValue(byId.get(19), 2, 0.22);
  setNodeWidgetValue(byId.get(19), 3, 1);
  setNodeWidgetValue(byId.get(19), 4, 30);

  setNodeWidgetValue(byId.get(11), 0, config.char1FeetX ?? 860);
  setNodeWidgetValue(byId.get(11), 1, config.char1GroundY ?? 1000);
  setNodeWidgetValue(byId.get(11), 4, config.char1Ratio ?? 0.86);
  setNodeWidgetValue(byId.get(11), 5, config.char1Feather ?? 8);
  setNodeWidgetValue(byId.get(11), 7, 4);
  setNodeWidgetValue(byId.get(11), 8, config.char1ShadowStrength ?? 0.28);
  setNodeWidgetValue(byId.get(11), 9, "沈砚");
  setNodeWidgetValue(byId.get(20), 0, config.char2FeetX ?? 680);
  setNodeWidgetValue(byId.get(20), 1, config.char2GroundY ?? 1000);
  setNodeWidgetValue(byId.get(20), 4, config.char2Ratio ?? 0.84);
  setNodeWidgetValue(byId.get(20), 5, config.char2Feather ?? 8);
  setNodeWidgetValue(byId.get(20), 7, 4);
  setNodeWidgetValue(byId.get(20), 8, config.char2ShadowStrength ?? 0.28);
  setNodeWidgetValue(byId.get(20), 9, "江岚");

  setNodeWidgetValue(
    byId.get(46),
    0,
    [
      "Goal: cinematic anime storyboard frame with natural anatomy and clean composition.",
      "Scene: riverside stone bridge at sunset with coherent dusk lighting and perspective.",
      "Camera: eye-level medium-full shot, both characters fully visible from head to feet.",
      "Subjects: exactly two people only.",
      "Character A: male, dark-blue long coat and boots, preserved identity from references.",
      "Character B: female, light-blue dress and black flats, preserved identity from references.",
      "Action: natural hand-holding walk, relaxed shoulders, grounded feet, readable hands and faces.",
      "Faces: both faces fully uncovered, no mask, no face covering.",
      "Face/detail lock: keep hairline, eye shape, nose-mouth spacing, and outfit details consistent with turnaround views.",
      "Edit scope: if mask is provided, update only inside masked region and keep unmasked pixels unchanged.",
      "Describe and preserve the full final image composition, not only local fragments.",
      stage === "stageC"
        ? "Stage C local harmonization: remove sticker edges and boundary artifacts while preserving both characters and scene identity."
        : "Preserve character identity and scene continuity."
    ].join("\n")
  );
  setNodeWidgetValue(
    byId.get(47),
    0,
    [
      "extra people",
      "duplicate character",
      "extra arms",
      "extra legs",
      "duplicate head",
      "broken anatomy",
      "missing hands",
      "missing feet",
      "transparent limbs",
      "ghost limbs",
      "purple blotch",
      "purple artifact",
      "neon stain",
      "double exposure",
      "sticker edge",
      "white halo",
      "collage",
      "watermark",
      "text",
      "wrong costume"
    ].join(", ")
  );

  const inpaintParams = resolveInpaintParamsByStage(config, stage);

  setKSamplerWidgetValues(byId.get(49), {
    seed:
      (Number.isFinite(Number(config.seedBase)) ? Number(config.seedBase) : 2026040101) +
      iterationIndex * 97 +
      (Number.isFinite(Number(config.seedOffset)) ? Number(config.seedOffset) : 0),
    steps: inpaintParams.steps,
    cfg: inpaintParams.cfg,
    samplerName: inpaintParams.samplerName,
    scheduler: inpaintParams.scheduler,
    denoise: inpaintParams.denoise,
    controlAfterGenerate: "fixed"
  });
  setNodeWidgetValue(byId.get(53), 0, inpaintParams.maskGrow);
  setNodeWidgetValue(byId.get(53), 1, true);
  const maskFeather = inpaintParams.maskFeather;
  setNodeWidgetValue(byId.get(54), 0, maskFeather);
  setNodeWidgetValue(byId.get(54), 1, maskFeather);
  setNodeWidgetValue(byId.get(54), 2, maskFeather);
  setNodeWidgetValue(byId.get(54), 3, maskFeather);

  if (selectedCheckpoint) {
    setNodeWidgetValue(byId.get(33), 0, selectedCheckpoint);
  }

  const char1BranchIds = [3, 4, 5, 6, 7, 8, 9, 10, 11, 34, 35, 36, 37];
  const char2BranchIds = [12, 13, 14, 15, 16, 17, 18, 19, 20, 38, 39, 40, 41];
  const char3BranchIds = [23, 24, 25, 26, 27, 28, 29, 30, 31, 42, 43, 44, 45];
  const inpaintIds = [46, 47, 48, 49, 50, 51, 52, 53, 54, 55];

  // Start from all enabled, then disable per-stage.
  setNodesEnabled(byId, char1BranchIds, true);
  setNodesEnabled(byId, char2BranchIds, true);
  setNodesEnabled(byId, char3BranchIds, false);
  setNodesEnabled(byId, inpaintIds, true);
  setNodeEnabled(byId.get(32), true);

  if (stage === "stageA") {
    // Stage A: pure scene + primary character as stable base frame.
    setNodesEnabled(byId, char2BranchIds, false);
    setNodesEnabled(byId, char3BranchIds, false);
    configureSingleLayerComposite(workflow, byId, 11);
    const skipStageAInpaint = forceSkipInpaint || config.stageAInpaint !== true;
    if (skipStageAInpaint) {
      setNodesEnabled(byId, inpaintIds, false);
      ensureWorkflowLink(workflow, byId, 21, 0, 22, 0, "IMAGE");
    } else {
      setNodesEnabled(byId, [46, 47, 48, 49, 50, 53, 54, 55], true);
      setNodesEnabled(byId, [51, 52], false);
      ensureWorkflowLink(workflow, byId, 11, 2, 53, 0, "MASK");
      ensureWorkflowLink(workflow, byId, 50, 0, 22, 0, "IMAGE");
    }
    setNodeWidgetValue(byId.get(22), 0, `Storyboard/target_loop_stageA_${shotPrefix}_${iterationIndex + 1}`);
  } else if (stage === "stageB") {
    // Stage B: use stageA output as scene, inject only the second character, then local inpaint refinement.
    const stageBAllSubjects = config.stageBAllSubjects === true;
    setNodesEnabled(byId, char3BranchIds, false);
    if (stageBAllSubjects) {
      setNodesEnabled(byId, char1BranchIds, true);
      setNodesEnabled(byId, char2BranchIds, true);
      setNodeEnabled(byId.get(32), true);
      removeIncomingLinks(workflow, 21, [1, 2, 3]);
      ensureWorkflowLink(workflow, byId, 11, 0, 21, 1, "PLACED_LAYER");
      ensureWorkflowLink(workflow, byId, 20, 0, 21, 2, "PLACED_LAYER");
      setNodeEnabled(byId.get(51), true);
      setNodeEnabled(byId.get(52), false);
      ensureWorkflowLink(workflow, byId, 11, 2, 51, 0, "MASK");
      ensureWorkflowLink(workflow, byId, 20, 2, 51, 1, "MASK");
      ensureWorkflowLink(workflow, byId, 51, 0, 53, 0, "MASK");
    } else {
      setNodesEnabled(byId, char1BranchIds, false);
      configureSingleLayerComposite(workflow, byId, 20);
      setNodeEnabled(byId.get(51), false);
      setNodeEnabled(byId.get(52), false);
      ensureWorkflowLink(workflow, byId, 20, 2, 53, 0, "MASK");
    }
    setNodeWidgetValue(byId.get(22), 0, `Storyboard/target_loop_${shotPrefix}_${iterationIndex + 1}`);
    if (config.skipInpaint || forceSkipInpaint) {
      setNodesEnabled(byId, inpaintIds, false);
      ensureWorkflowLink(workflow, byId, 21, 0, 22, 0, "IMAGE");
    }
  } else if (stage === "stageC") {
    // Stage C: keep stageB result as base scene and run ROI-only harmonization on the union mask of character areas.
    setNodesEnabled(byId, char1BranchIds, true);
    setNodesEnabled(byId, char2BranchIds, true);
    setNodesEnabled(byId, char3BranchIds, false);
    setNodeEnabled(byId.get(32), false);
    const stageCMaskMode = String(config.stageCMaskMode ?? "both").trim().toLowerCase();

    // Do not re-compose layers in stage C; refine the existing stageB image only.
    removeIncomingLinks(workflow, 21, [1, 2, 3]);
    if (stageCMaskMode === "char1") {
      setNodeEnabled(byId.get(51), false);
      setNodeEnabled(byId.get(52), false);
      ensureWorkflowLink(workflow, byId, 11, 2, 53, 0, "MASK");
    } else if (stageCMaskMode === "char2") {
      setNodeEnabled(byId.get(51), false);
      setNodeEnabled(byId.get(52), false);
      ensureWorkflowLink(workflow, byId, 20, 2, 53, 0, "MASK");
    } else {
      setNodeEnabled(byId.get(51), true);
      setNodeEnabled(byId.get(52), false);
      ensureWorkflowLink(workflow, byId, 11, 2, 51, 0, "MASK");
      ensureWorkflowLink(workflow, byId, 20, 2, 51, 1, "MASK");
      ensureWorkflowLink(workflow, byId, 51, 0, 53, 0, "MASK");
    }

    setNodeWidgetValue(byId.get(22), 0, `Storyboard/target_loop_${shotPrefix}_${iterationIndex + 1}`);
    if (config.stageCSkipInpaint === true || forceSkipInpaint) {
      setNodesEnabled(byId, inpaintIds, false);
      ensureWorkflowLink(workflow, byId, 21, 0, 22, 0, "IMAGE");
    } else {
      setNodesEnabled(byId, [46, 47, 48, 49, 50, 51, 53, 54, 55], true);
      setNodesEnabled(byId, [52], false);
      ensureWorkflowLink(workflow, byId, 50, 0, 22, 0, "IMAGE");
    }
  } else {
    // One-shot legacy mode: scene + two characters.
    setNodesEnabled(byId, char3BranchIds, false);
    setNodeEnabled(byId.get(51), false);
    setNodeEnabled(byId.get(52), false);
    ensureWorkflowLink(workflow, byId, 20, 2, 53, 0, "MASK");
    setNodeWidgetValue(byId.get(22), 0, `Storyboard/target_loop_${shotPrefix}_${iterationIndex + 1}`);
    if (config.skipInpaint || forceSkipInpaint) {
      setNodesEnabled(byId, inpaintIds, false);
      ensureWorkflowLink(workflow, byId, 21, 0, 22, 0, "IMAGE");
    }
  }

  if (debugSaves && stage !== "stageA") {
    ensureDebugSaveNode(workflow, byId, 901, 9, 0, `Storyboard/target_debug_char1_${shotPrefix}_${iterationIndex + 1}`);
    ensureDebugSaveNode(workflow, byId, 902, 18, 0, `Storyboard/target_debug_char2_${shotPrefix}_${iterationIndex + 1}`);
    ensureDebugSaveNode(workflow, byId, 903, 20, 1, `Storyboard/target_debug_char2_processed_${shotPrefix}_${iterationIndex + 1}`);
    ensureDebugSaveNode(workflow, byId, 904, 11, 1, `Storyboard/target_debug_char1_processed_${shotPrefix}_${iterationIndex + 1}`);
    ensureDebugSaveNode(workflow, byId, 905, 21, 0, `Storyboard/target_debug_compose_${shotPrefix}_${iterationIndex + 1}`);
    ensureMaskToImageNode(workflow, byId, 906, 20, 2);
    ensureMaskToImageNode(workflow, byId, 907, 11, 2);
    ensureDebugSaveNode(workflow, byId, 908, 906, 0, `Storyboard/target_debug_char2_mask_${shotPrefix}_${iterationIndex + 1}`);
    ensureDebugSaveNode(workflow, byId, 909, 907, 0, `Storyboard/target_debug_char1_mask_${shotPrefix}_${iterationIndex + 1}`);
  } else if (debugSaves && stage === "stageA") {
    ensureDebugSaveNode(workflow, byId, 904, 11, 1, `Storyboard/target_debug_char1_processed_${shotPrefix}_${iterationIndex + 1}`);
    ensureMaskToImageNode(workflow, byId, 907, 11, 2);
    ensureDebugSaveNode(workflow, byId, 909, 907, 0, `Storyboard/target_debug_char1_mask_${shotPrefix}_${iterationIndex + 1}`);
  }
}

function isLikelyComfyApiPrompt(workflow) {
  const entries = Object.entries(workflow).filter(([key]) => key !== "extra_data" && key !== "client_id");
  if (entries.length === 0) return false;
  return entries.every(([, value]) => value && typeof value === "object" && !Array.isArray(value) && value.class_type);
}

function hasWidgetMeta(input) {
  return Boolean(input?.widget) && typeof input.widget === "object" && !Array.isArray(input.widget);
}

function isNumericString(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && !Number.isNaN(Number(trimmed));
}

function isValueCompatibleForInputType(value, type) {
  if (Array.isArray(type)) return type.length === 0 || type.some((item) => String(item) === String(value));
  if (typeof type !== "string") return true;
  const normalized = type.toUpperCase();
  if (normalized === "INT") {
    return typeof value === "number" ? Number.isInteger(value) : isNumericString(value) && Number.isInteger(Number(value));
  }
  if (normalized === "FLOAT" || normalized === "DOUBLE" || normalized === "NUMBER") {
    return typeof value === "number" || isNumericString(value);
  }
  if (normalized === "BOOLEAN") {
    if (typeof value === "boolean") return true;
    if (typeof value === "number") return value === 0 || value === 1;
    if (typeof value === "string") {
      const lower = value.trim().toLowerCase();
      return lower === "true" || lower === "false" || lower === "0" || lower === "1";
    }
    return false;
  }
  return true;
}

function objectInfoInputOrderNames(objectInfo, classType) {
  if (!objectInfo || !classType || typeof objectInfo !== "object") return [];
  const classInfo = objectInfo[classType];
  if (!classInfo || typeof classInfo !== "object" || Array.isArray(classInfo)) return [];
  const inputOrder = classInfo.input_order;
  const ordered = [];
  const pushBucket = (container, bucket) => {
    if (!container || typeof container !== "object" || Array.isArray(container)) return;
    const names = container[bucket];
    if (!Array.isArray(names)) return;
    for (const item of names) {
      if (typeof item === "string" && item.trim()) ordered.push(item.trim());
    }
  };
  if (inputOrder && typeof inputOrder === "object" && !Array.isArray(inputOrder)) {
    pushBucket(inputOrder, "required");
    pushBucket(inputOrder, "optional");
  }
  if (ordered.length > 0) return ordered;
  const input = classInfo.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  pushBucket(input, "required");
  pushBucket(input, "optional");
  return ordered;
}

function buildWidgetValuesByInputName(node, objectInfo) {
  const nodeInputs = Array.isArray(node.inputs) ? node.inputs : [];
  const nodeType = typeof node?.type === "string" ? node.type.trim() : "";
  const output = {};
  if (node.widgets_values && typeof node.widgets_values === "object" && !Array.isArray(node.widgets_values)) {
    for (const rawInput of nodeInputs) {
      if (!rawInput || typeof rawInput !== "object") continue;
      const name = typeof rawInput.name === "string" ? rawInput.name.trim() : "";
      if (!name || !hasWidgetMeta(rawInput)) continue;
      if (Object.prototype.hasOwnProperty.call(node.widgets_values, name)) {
        output[name] = node.widgets_values[name];
      }
    }
    return output;
  }

  const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : [];
  let cursor = 0;
  const widgetInputs = nodeInputs.filter((input) => input && hasWidgetMeta(input) && typeof input.name === "string");
  for (const input of widgetInputs) {
    const name = String(input.name).trim();
    if (!name) continue;
    if (
      nodeType === "KSampler" &&
      name === "steps" &&
      cursor === 1 &&
      widgets.length > 1 &&
      isKSamplerControlAfterGenerateValue(widgets[1])
    ) {
      cursor = 2;
    }
    const expectedType = input.type;
    let chosenIndex = -1;
    for (let idx = cursor; idx < widgets.length; idx += 1) {
      if (isValueCompatibleForInputType(widgets[idx], expectedType)) {
        chosenIndex = idx;
        break;
      }
    }
    if (chosenIndex < 0) {
      if (cursor >= widgets.length) break;
      chosenIndex = cursor;
    }
    output[name] = widgets[chosenIndex];
    cursor = chosenIndex + 1;
  }

  if (objectInfo && node.type) {
    const ordered = objectInfoInputOrderNames(objectInfo, String(node.type).trim());
    const used = new Set(Object.keys(output));
    for (const rawInput of nodeInputs) {
      const name = typeof rawInput?.name === "string" ? rawInput.name.trim() : "";
      if (!name) continue;
      if (typeof rawInput.link === "number" || hasWidgetMeta(rawInput)) used.add(name);
    }
    const missing = ordered.filter((name) => !used.has(name));
    for (const name of missing) {
      if (cursor >= widgets.length) break;
      output[name] = widgets[cursor];
      cursor += 1;
    }
  }
  return output;
}

function graphWorkflowToApiPrompt(workflow, objectInfo) {
  if (isLikelyComfyApiPrompt(workflow)) return workflow;
  const nodes = workflowNodes(workflow);
  const activeNodeIds = new Set();
  const nodeById = new Map();
  for (const node of nodes) {
    if (isNodeDisabled(node)) continue;
    const id = typeof node.id === "number" || typeof node.id === "string" ? String(node.id) : "";
    if (!id) continue;
    activeNodeIds.add(id);
    nodeById.set(id, node);
  }

  const links = workflowLinks(workflow);
  const linkById = new Map();
  const linkedNodeIds = new Set();
  for (const link of links) {
    if (!Array.isArray(link) || link.length < 5) continue;
    const sourceNodeId = String(link[1]);
    const targetNodeId = String(link[3]);
    if (!activeNodeIds.has(sourceNodeId) || !activeNodeIds.has(targetNodeId)) continue;
    linkById.set(Number(link[0]), link);
    linkedNodeIds.add(sourceNodeId);
    linkedNodeIds.add(targetNodeId);
  }

  const prompt = {};
  for (const node of nodes) {
    if (isNodeDisabled(node)) continue;
    const nodeType = typeof node.type === "string" ? node.type.trim() : "";
    if (!nodeType || nodeType === "SetNode" || nodeType === "GetNode") continue;
    const nodeId = typeof node.id === "number" || typeof node.id === "string" ? String(node.id) : "";
    if (!nodeId || !linkedNodeIds.has(nodeId)) continue;

    const inputValues = {};
    const nodeInputs = Array.isArray(node.inputs) ? node.inputs : [];
    const widgetByInputName = buildWidgetValuesByInputName(node, objectInfo);

    for (const rawInput of nodeInputs) {
      if (!rawInput || typeof rawInput !== "object") continue;
      const name = typeof rawInput.name === "string" ? rawInput.name.trim() : "";
      if (!name) continue;
      if (typeof rawInput.link === "number") {
        const link = linkById.get(rawInput.link);
        if (link) {
          inputValues[name] = [String(link[1]), Number(link[2])];
          continue;
        }
      }
      if (Object.prototype.hasOwnProperty.call(widgetByInputName, name)) {
        inputValues[name] = widgetByInputName[name];
      }
    }
    for (const [name, value] of Object.entries(widgetByInputName)) {
      if (!Object.prototype.hasOwnProperty.call(inputValues, name)) inputValues[name] = value;
    }
    prompt[nodeId] = { class_type: nodeType, inputs: inputValues };
  }
  return prompt;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${await response.text()}`);
  }
  return response.json();
}

function collectOutputImages(historyEntry) {
  if (!historyEntry || typeof historyEntry !== "object") return [];
  const outputs = historyEntry.outputs;
  if (!outputs || typeof outputs !== "object") return [];
  const assets = [];
  for (const nodeOutput of Object.values(outputs)) {
    if (!nodeOutput || typeof nodeOutput !== "object") continue;
    const maybeImages = nodeOutput.images;
    if (!Array.isArray(maybeImages)) continue;
    for (const asset of maybeImages) {
      if (!asset || typeof asset !== "object") continue;
      const filename = String(asset.filename ?? "").trim();
      if (!filename) continue;
      assets.push({
        filename,
        subfolder: String(asset.subfolder ?? "").trim(),
        type: String(asset.type ?? "output").trim() || "output"
      });
    }
  }
  return assets;
}

function collectNodeOutputImages(historyEntry, nodeId) {
  if (!historyEntry || typeof historyEntry !== "object") return [];
  const outputs = historyEntry.outputs;
  if (!outputs || typeof outputs !== "object") return [];
  const nodeOutput = outputs[String(nodeId)];
  if (!nodeOutput || typeof nodeOutput !== "object") return [];
  const maybeImages = nodeOutput.images;
  if (!Array.isArray(maybeImages)) return [];
  const assets = [];
  for (const asset of maybeImages) {
    if (!asset || typeof asset !== "object") continue;
    const filename = String(asset.filename ?? "").trim();
    if (!filename) continue;
    assets.push({
      filename,
      subfolder: String(asset.subfolder ?? "").trim(),
      type: String(asset.type ?? "output").trim() || "output"
    });
  }
  return assets;
}

async function queuePrompt(baseUrl, prompt) {
  const payload = await fetchJson(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, client_id: "storyboard-target-loop" })
  });
  const promptId = String(payload?.prompt_id ?? "").trim();
  if (!promptId) throw new Error("Comfy returned no prompt_id");
  return promptId;
}

async function waitPromptResult(baseUrl, promptId, preferredOutputNodeId = 22) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const history = await fetchJson(`${baseUrl}/history/${encodeURIComponent(promptId)}`);
    const entry = history?.[promptId];
    if (entry) {
      let images = collectNodeOutputImages(entry, preferredOutputNodeId);
      if (images.length === 0) {
        images = collectOutputImages(entry);
      }
      if (images.length > 0) return images[0];
      const status = entry?.status;
      const statusText = String(status?.status_str ?? "").toLowerCase();
      if (status?.completed === true || statusText === "success" || statusText === "failed" || statusText === "error") {
        throw new Error(`Prompt completed but no image output found (status=${statusText || "unknown"})`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Timed out waiting for prompt ${promptId}`);
}

async function runPowerShellScore(target, candidate) {
  const output = await new Promise((resolve, reject) => {
    const child = spawn(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scoreScriptPath,
        "-Target",
        target,
        "-Candidate",
        candidate
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk ?? "");
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk ?? "");
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`score script failed (${code}): ${stderr || stdout}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
  const parsed = JSON.parse(String(output).split(/\r?\n/).filter((line) => line.trim()).at(-1));
  return parsed;
}

function readMetric(metrics, key) {
  return toNumberOrDefault(metrics?.[key], 0);
}

function evaluateHardGates(metrics, scoreThreshold, thresholds) {
  const checks = [
    { key: "score", min: scoreThreshold, label: "score" },
    { key: "global", min: thresholds.minGlobal, label: "global consistency" },
    { key: "female_head", min: thresholds.minFemaleHead, label: "identity female head" },
    { key: "male_head", min: thresholds.minMaleHead, label: "identity male head" },
    { key: "female_face_detail", min: thresholds.minFemaleFace, label: "identity female face detail" },
    { key: "male_face_detail", min: thresholds.minMaleFace, label: "identity male face detail" },
    { key: "female_body", min: thresholds.minFemaleBody, label: "full body female" },
    { key: "male_body", min: thresholds.minMaleBody, label: "full body male" },
    { key: "female_feet", min: thresholds.minFemaleFeet, label: "full body female feet" },
    { key: "male_feet", min: thresholds.minMaleFeet, label: "full body male feet" },
    { key: "hand_hold", min: thresholds.minHandHold, label: "pose interaction" },
    { key: "torso_center", min: thresholds.minTorsoCenter, label: "pose torso alignment" },
    { key: "pose_arm", min: thresholds.minPoseArm, label: "pose arm structure" },
    { key: "edge_blend", min: thresholds.minEdgeBlend, label: "non-sticker edge blend" }
  ];

  const failures = [];
  for (const check of checks) {
    const value = readMetric(metrics, check.key);
    if (value < check.min) {
      failures.push(
        `${check.label}: ${value.toFixed(4)} < ${Number(check.min).toFixed(4)}`
      );
    }
  }
  return {
    pass: failures.length === 0,
    failures
  };
}

function isPathInside(baseDir, candidatePath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(candidatePath);
  const baseWithSep = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  return target === base || target.startsWith(baseWithSep);
}

async function removeFileIfExistsSafe(filePath, baseDir) {
  if (!filePath) return;
  if (!isPathInside(baseDir, filePath)) return;
  const retryableCodes = new Set(["EPERM", "EBUSY", "EACCES"]);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fs.unlink(filePath);
      return;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error)) throw error;
      if (error.code === "ENOENT") return;
      if (!retryableCodes.has(String(error.code)) || attempt >= 5) {
        console.warn(
          `[target-loop] warn: failed to delete ${filePath} (${String(error.code)}${error.message ? `: ${error.message}` : ""})`
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 + attempt * 150));
    }
  }
}

async function cleanupFailedAttemptArtifacts(attempt) {
  await Promise.all([
    removeFileIfExistsSafe(attempt.outputPath, comfyOutputDir),
    removeFileIfExistsSafe(attempt.stageAOutputPath, comfyOutputDir),
    removeFileIfExistsSafe(attempt.stageBOutputPath, comfyOutputDir),
    removeFileIfExistsSafe(attempt.stageCOutputPath, comfyOutputDir),
    removeFileIfExistsSafe(
      attempt.stageAInputName ? path.join(comfyInputDir, attempt.stageAInputName) : "",
      comfyInputDir
    ),
    removeFileIfExistsSafe(
      attempt.stageBInputName ? path.join(comfyInputDir, attempt.stageBInputName) : "",
      comfyInputDir
    ),
    removeFileIfExistsSafe(
      attempt.stageCInputName ? path.join(comfyInputDir, attempt.stageCInputName) : "",
      comfyInputDir
    )
  ]);
}

async function assertInputsExist() {
  const missing = [];
  for (const file of Object.values(requiredInputs)) {
    const fullPath = path.join(comfyInputDir, file);
    try {
      await fs.access(fullPath);
    } catch {
      missing.push(fullPath);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing required input files:\n${missing.join("\n")}`);
  }
}

function sanitizeFilenamePart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

async function copyOutputToComfyInput(outputPath, tag) {
  const safeTag = sanitizeFilenamePart(tag) || "stage";
  const ext = path.extname(outputPath) || ".png";
  const inputName = `${safeTag}_${Date.now()}_${Math.floor(Math.random() * 100000)}${ext}`;
  const targetInputPath = path.join(comfyInputDir, inputName);
  await fs.copyFile(outputPath, targetInputPath);
  return inputName;
}

async function main() {
  await assertInputsExist();
  await fs.access(targetPath);
  if (executionCandidateConfigs.length === 0) {
    throw new Error(
      `No candidate matches --candidates filter: ${candidateFilterTokens.join(", ")}`
    );
  }
  const presetRaw = await fs.readFile(presetPath, "utf8");
  const presetWorkflow = JSON.parse(presetRaw);
  const presetCheckpoint = resolvePresetCheckpointName(presetWorkflow);
  const objectInfo = await fetchJson(`${comfyBaseUrl}/object_info`);
  const checkpointCandidates = extractStringList(
    objectInfo?.CheckpointLoaderSimple?.input?.required?.ckpt_name ??
      objectInfo?.CheckpointLoaderSimple?.input?.required?.ckpt ??
      []
  );
  const selectedCheckpoint =
    forcedCheckpoint && checkpointCandidates.includes(forcedCheckpoint)
      ? forcedCheckpoint
      : presetCheckpoint && checkpointCandidates.includes(presetCheckpoint)
        ? presetCheckpoint
        : selectPreferredCheckpoint(checkpointCandidates);

  let best = null;
  let bestPassing = null;
  const attempts = [];
  console.log(`[target-loop] baseUrl=${comfyBaseUrl}`);
  console.log(`[target-loop] target=${targetPath}`);
  console.log(`[target-loop] shot=${shotPrefix}`);
  console.log(`[target-loop] threshold=${threshold}`);
  console.log(`[target-loop] two_stage=${twoStageMode ? "1" : "0"}`);
  console.log(`[target-loop] stage_c=${stageCMode ? "1" : "0"}`);
  console.log(`[target-loop] candidates=${executionCandidateConfigs.length}`);
  console.log(`[target-loop] seed_sweep=${seedSweepCount} seed_step=${seedSweepStep}`);
  console.log(
    `[target-loop] hard_gates=1 delete_failed=${deleteFailedOutputs ? "1" : "0"}`
  );
  const checkpointSource =
    forcedCheckpoint && checkpointCandidates.includes(forcedCheckpoint)
      ? "forced"
      : presetCheckpoint && checkpointCandidates.includes(presetCheckpoint)
        ? "preset"
        : "fallback_preferred";
  console.log(`[target-loop] checkpoint=${selectedCheckpoint || "<none>"} source=${checkpointSource}`);

  for (let index = 0; index < executionCandidateConfigs.length; index += 1) {
    const config = executionCandidateConfigs[index];
    console.log(`\n[target-loop] Iteration ${index + 1}/${executionCandidateConfigs.length}: ${config.name}`);
    let outputPath = "";
    let promptId = "";
    let stageAPromptId = "";
    let stageAOutputPath = "";
    let stageAInputName = "";
    let stageBPromptId = "";
    let stageBOutputPath = "";
    let stageBInputName = "";
    let stageCPromptId = "";
    let stageCOutputPath = "";
    let stageCInputName = "";

    if (twoStageMode) {
      const workflowA = JSON.parse(presetRaw);
      applyCandidateBindings(workflowA, config, index, selectedCheckpoint, {
        stage: "stageA",
        sceneInput: requiredInputs.scene,
        forceSkipInpaint: false
      });
      const promptA = graphWorkflowToApiPrompt(workflowA, objectInfo);
      stageAPromptId = await queuePrompt(comfyBaseUrl, promptA);
      console.log(`[target-loop] stageA_prompt_id=${stageAPromptId}`);
      const stageAAsset = await waitPromptResult(comfyBaseUrl, stageAPromptId, 22);
      stageAOutputPath = path.join(comfyOutputDir, stageAAsset.subfolder || "", stageAAsset.filename);
      stageAInputName = await copyOutputToComfyInput(stageAOutputPath, `target_loop_stageA_input_${shotPrefix}_${index + 1}`);
      console.log(`[target-loop] stageA_base=${stageAOutputPath}`);

      const workflowB = JSON.parse(presetRaw);
      applyCandidateBindings(workflowB, config, index, selectedCheckpoint, {
        stage: "stageB",
        sceneInput: stageAInputName
      });
      const promptB = graphWorkflowToApiPrompt(workflowB, objectInfo);
      stageBPromptId = await queuePrompt(comfyBaseUrl, promptB);
      console.log(`[target-loop] stageB_prompt_id=${stageBPromptId}`);
      const stageBAsset = await waitPromptResult(comfyBaseUrl, stageBPromptId, 22);
      stageBOutputPath = path.join(comfyOutputDir, stageBAsset.subfolder || "", stageBAsset.filename);
      if (stageCMode) {
        stageBInputName = await copyOutputToComfyInput(
          stageBOutputPath,
          `target_loop_stageB_input_${shotPrefix}_${index + 1}`
        );
        console.log(`[target-loop] stageB_base=${stageBOutputPath}`);

        const workflowC = JSON.parse(presetRaw);
        applyCandidateBindings(workflowC, config, index, selectedCheckpoint, {
          stage: "stageC",
          sceneInput: stageBInputName
        });
        const promptC = graphWorkflowToApiPrompt(workflowC, objectInfo);
        stageCPromptId = await queuePrompt(comfyBaseUrl, promptC);
        console.log(`[target-loop] stageC_prompt_id=${stageCPromptId}`);
        const stageCAsset = await waitPromptResult(comfyBaseUrl, stageCPromptId, 22);
        stageCOutputPath = path.join(comfyOutputDir, stageCAsset.subfolder || "", stageCAsset.filename);
        promptId = stageCPromptId;
        outputPath = stageCOutputPath;
      } else {
        promptId = stageBPromptId;
        outputPath = stageBOutputPath;
      }
    } else {
      const workflow = JSON.parse(presetRaw);
      applyCandidateBindings(workflow, config, index, selectedCheckpoint, {
        stage: "single",
        sceneInput: requiredInputs.scene
      });
      const prompt = graphWorkflowToApiPrompt(workflow, objectInfo);
      promptId = await queuePrompt(comfyBaseUrl, prompt);
      console.log(`[target-loop] prompt_id=${promptId}`);
      const imageAsset = await waitPromptResult(comfyBaseUrl, promptId, 22);
      outputPath = path.join(comfyOutputDir, imageAsset.subfolder || "", imageAsset.filename);
    }

    const metrics = await runPowerShellScore(targetPath, outputPath);
    const score = Number(metrics.score ?? 0);
    const hardGate = evaluateHardGates(metrics, threshold, hardGateThresholds);
    const result = {
      iteration: index + 1,
      name: config.name,
      baseName: config.baseName ?? config.name,
      seedOffset: Number.isFinite(Number(config.seedOffset)) ? Number(config.seedOffset) : 0,
      promptId,
      stageAPromptId,
      stageAOutputPath,
      stageAInputName,
      stageBPromptId,
      stageBOutputPath,
      stageBInputName,
      stageCPromptId,
      stageCOutputPath,
      stageCInputName,
      outputPath,
      metrics,
      hardGate
    };
    attempts.push(result);
    if (!best || score > Number(best.metrics.score ?? 0)) best = result;
    if (hardGate.pass && (!bestPassing || score > Number(bestPassing.metrics.score ?? 0))) {
      bestPassing = result;
    }
    console.log(
      `[target-loop] score=${score.toFixed(4)} hard_pass=${hardGate.pass ? "1" : "0"} output=${outputPath}`
    );
    if (!hardGate.pass) {
      console.log(`[target-loop] hard_fail_reasons=${hardGate.failures.join(" | ")}`);
      if (deleteFailedOutputs) {
        await cleanupFailedAttemptArtifacts(result);
        console.log("[target-loop] cleaned_failed_artifacts=1");
      }
      continue;
    }
    if (hardGate.pass) {
      console.log("[target-loop] target reached (hard gates)");
      break;
    }
  }

  const report = {
    baseUrl: comfyBaseUrl,
    targetPath,
    threshold,
    hardGateThresholds,
    shotPrefix,
    best,
    bestPassing,
    attempts,
    generatedAt: new Date().toISOString()
  };
  const reportPath = path.join(
    repoRoot,
    "logs",
    `storyboard-target-loop-${shotPrefix}-${Date.now()}.json`
  );
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`\n[target-loop] report=${reportPath}`);
  if (!best) {
    console.error("[target-loop] no successful image generated");
    process.exitCode = 2;
    return;
  }
  if (!bestPassing) {
    console.log(
      `[target-loop] best_score_any=${Number(best.metrics.score ?? 0).toFixed(4)} best_image_any=${best.outputPath}`
    );
    console.error("[target-loop] no image passed hard gates");
    process.exitCode = 2;
    return;
  }
  console.log(
    `[target-loop] best_score=${Number(bestPassing.metrics.score ?? 0).toFixed(4)} best_image=${bestPassing.outputPath}`
  );
  if (Number(bestPassing.metrics.score ?? 0) < threshold) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(`[target-loop] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
