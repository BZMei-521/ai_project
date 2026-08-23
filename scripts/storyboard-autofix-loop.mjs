#!/usr/bin/env node

import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
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

function toNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeJsonText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  const direct = (() => {
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      return "";
    }
  })();
  if (direct) return direct;
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace < 0) return "";
  for (let index = firstBrace; index < trimmed.length; index += 1) {
    if (trimmed[index] !== "{") continue;
    const candidate = trimmed.slice(index).trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Continue.
    }
  }
  return "";
}

async function runCommand(command, args, options = {}) {
  const { cwd = repoRoot, env = process.env, streamOutput = true } = options;
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk ?? "");
      stdout += text;
      if (streamOutput) process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk ?? "");
      stderr += text;
      if (streamOutput) process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function tuneAttemptProfile(profile, reason) {
  const next = { ...profile };
  const char1Weight = clamp(toNumber(next.char1PrimaryWeight, 0.96), 0.8, 1.24);
  const char2Weight = clamp(toNumber(next.char2PrimaryWeight, 0.9), 0.75, 1.24);
  const char2SecondaryWeight = clamp(toNumber(next.char2SecondaryWeight, 0.34), 0.2, 0.8);
  switch (reason) {
    case "invalid_stageA_char1_missing_or_too_weak":
    case "invalid_stageA_char1_identity_or_outfit_drift":
      next.denoise = clamp(next.denoise + 0.04, 0.86, 0.96);
      next.cfg = clamp(next.cfg + 0.04, 0.98, 1.1);
      next.maxSize = Math.round(clamp(next.maxSize + 64, 704, 1024));
      next.refEdge = Math.round(clamp(next.refEdge, 384, 640));
      next.steps = Math.round(clamp(next.steps + 1, 4, 8));
      next.char1PrimaryWeight = clamp(char1Weight + 0.08, 0.8, 1.24);
      next.char2PrimaryWeight = clamp(char2Weight - 0.04, 0.75, 1.24);
      break;
    case "invalid_stageA_second_person_leaked":
      next.denoise = clamp(next.denoise - 0.05, 0.78, 0.98);
      next.cfg = clamp(next.cfg - 0.04, 0.9, 1.08);
      next.maxSize = Math.round(clamp(next.maxSize - 64, 704, 1024));
      next.refEdge = Math.round(clamp(next.refEdge + 24, 384, 640));
      next.char1PrimaryWeight = clamp(char1Weight + 0.04, 0.8, 1.24);
      next.char2PrimaryWeight = clamp(char2Weight - 0.08, 0.75, 1.24);
      break;
    case "invalid_stageA_scene_drift_or_unmasked_subject":
      next.denoise = clamp(next.denoise - 0.04, 0.82, 0.94);
      next.cfg = clamp(next.cfg - 0.02, 0.96, 1.06);
      next.maxSize = Math.round(clamp(next.maxSize - 64, 704, 1024));
      next.refEdge = Math.round(clamp(next.refEdge + 32, 384, 640));
      next.steps = Math.round(clamp(next.steps - 1, 4, 8));
      next.char1PrimaryWeight = clamp(char1Weight + 0.05, 0.8, 1.24);
      next.char2PrimaryWeight = clamp(char2Weight - 0.05, 0.75, 1.24);
      break;
    case "invalid_stageB_char1_missing_or_too_weak":
    case "invalid_stageB_char1_identity_or_outfit_drift":
      next.denoise = clamp(next.denoise - 0.06, 0.74, 0.96);
      next.cfg = clamp(next.cfg - 0.05, 0.88, 1.08);
      next.steps = Math.round(clamp(next.steps, 4, 7));
      next.char1PrimaryWeight = clamp(char1Weight + 0.08, 0.8, 1.24);
      next.char2PrimaryWeight = clamp(char2Weight - 0.04, 0.75, 1.24);
      break;
    case "invalid_stageB_char2_identity_or_outfit_drift":
      next.denoise = clamp(next.denoise - 0.04, 0.78, 0.92);
      next.cfg = clamp(next.cfg + 0.08, 0.94, 1.16);
      next.maxSize = Math.round(clamp(next.maxSize + 64, 768, 1024));
      next.refEdge = Math.round(clamp(next.refEdge + 48, 416, 640));
      next.steps = Math.round(clamp(next.steps + 1, 4, 8));
      next.char2PrimaryWeight = clamp(char2Weight + 0.2, 0.75, 1.24);
      next.char2SecondaryWeight = clamp(char2SecondaryWeight + 0.16, 0.2, 0.8);
      next.char1PrimaryWeight = clamp(char1Weight - 0.12, 0.75, 1.24);
      break;
    case "invalid_stageB_char2_missing_or_too_weak":
    case "invalid_stageB_char2_not_added":
      next.denoise = clamp(next.denoise + 0.04, 0.8, 0.96);
      next.cfg = clamp(next.cfg + 0.06, 0.92, 1.14);
      next.steps = Math.round(clamp(next.steps + 1, 4, 8));
      next.refEdge = Math.round(clamp(next.refEdge + 32, 384, 640));
      next.char2PrimaryWeight = clamp(char2Weight + 0.18, 0.75, 1.24);
      next.char2SecondaryWeight = clamp(char2SecondaryWeight + 0.1, 0.2, 0.8);
      next.char1PrimaryWeight = clamp(char1Weight - 0.08, 0.75, 1.24);
      break;
    case "invalid_stageB_unmasked_extra_subject_or_scene_drift":
      next.denoise = clamp(next.denoise - 0.06, 0.72, 0.95);
      next.maxSize = Math.round(clamp(next.maxSize - 64, 704, 1024));
      next.char1PrimaryWeight = clamp(char1Weight + 0.03, 0.8, 1.24);
      next.char2PrimaryWeight = clamp(char2Weight + 0.05, 0.75, 1.24);
      break;
    default:
      next.denoise = clamp(next.denoise - 0.02, 0.74, 0.98);
      break;
  }
  if (!Number.isFinite(Number(next.char1PrimaryWeight))) next.char1PrimaryWeight = char1Weight;
  if (!Number.isFinite(Number(next.char2PrimaryWeight))) next.char2PrimaryWeight = char2Weight;
  if (!Number.isFinite(Number(next.char2SecondaryWeight))) next.char2SecondaryWeight = char2SecondaryWeight;
  return next;
}

function inferShotName(shot) {
  return String(shot?.title || shot?.id || "shot").trim() || "shot";
}

async function runValidator({
  pythonExe,
  validatorScript,
  requestPayload
}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "storyboard-autofix-"));
  const requestPath = path.join(tempDir, "request.json");
  await fs.writeFile(requestPath, JSON.stringify(requestPayload, null, 2), "utf8");
  try {
    const result = await runCommand(pythonExe, [validatorScript, "--request", requestPath], {
      cwd: repoRoot,
      streamOutput: false
    });
    if (result.code !== 0) {
      throw new Error(`validator failed (${result.code}): ${result.stderr || result.stdout}`);
    }
    const jsonText = normalizeJsonText(result.stdout);
    if (!jsonText) {
      throw new Error(`validator returned non-json output: ${result.stdout.slice(0, 400)}`);
    }
    return JSON.parse(jsonText);
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors.
    }
  }
}

async function runStageBSanitize({
  pythonExe,
  sanitizeScript,
  stageAPath,
  stageBPath,
  char1MaskPath,
  char2MaskPath,
  char2PrimaryPath = "",
  reason = ""
}) {
  if (!stageAPath || !stageBPath || !char1MaskPath || !char2MaskPath) return null;
  if (!fssync.existsSync(stageAPath) || !fssync.existsSync(stageBPath)) return null;
  if (!fssync.existsSync(char1MaskPath) || !fssync.existsSync(char2MaskPath)) return null;
  if (!fssync.existsSync(sanitizeScript)) return null;
  const result = await runCommand(
    pythonExe,
    [
      sanitizeScript,
      "--stageB",
      stageBPath,
      "--stageA",
      stageAPath,
      "--char1Mask",
      char1MaskPath,
      "--char2Mask",
      char2MaskPath,
      "--char2Primary",
      String(char2PrimaryPath || ""),
      "--reason",
      String(reason || ""),
      "--output",
      stageBPath
    ],
    {
      cwd: repoRoot,
      streamOutput: false
    }
  );
  if (result.code !== 0) {
    throw new Error(`stageB sanitize failed (${result.code}): ${result.stderr || result.stdout}`);
  }
  const jsonText = normalizeJsonText(result.stdout);
  if (!jsonText) {
    throw new Error(`stageB sanitize returned non-json output: ${result.stdout.slice(0, 400)}`);
  }
  return JSON.parse(jsonText);
}

async function runStageAForceSanitize({
  pythonExe,
  sanitizeScript,
  stageAPath,
  scenePath,
  char1MaskPath,
  outputPath
}) {
  if (!stageAPath || !scenePath || !char1MaskPath || !outputPath) return null;
  if (!fssync.existsSync(stageAPath) || !fssync.existsSync(scenePath) || !fssync.existsSync(char1MaskPath)) return null;
  if (!fssync.existsSync(sanitizeScript)) return null;
  const result = await runCommand(
    pythonExe,
    [
      sanitizeScript,
      "--stageA",
      stageAPath,
      "--scene",
      scenePath,
      "--mask",
      char1MaskPath,
      "--output",
      outputPath,
      "--forceLowConfidence",
      "1"
    ],
    {
      cwd: repoRoot,
      streamOutput: false
    }
  );
  if (result.code !== 0) {
    throw new Error(`stageA force sanitize failed (${result.code}): ${result.stderr || result.stdout}`);
  }
  const jsonText = normalizeJsonText(result.stdout);
  if (!jsonText) {
    throw new Error(`stageA force sanitize returned non-json output: ${result.stdout.slice(0, 400)}`);
  }
  return JSON.parse(jsonText);
}

async function runFirstShotScript({
  nodeBin,
  runnerScript,
  comfyRoot,
  baseUrl,
  shotScriptPath,
  shotId,
  profile,
  twoStage,
  char1Name,
  char2Name,
  timeoutMs,
  tag
}) {
  const args = [
    runnerScript,
    "--comfyRoot",
    comfyRoot,
    "--baseUrl",
    baseUrl,
    "--shotScript",
    shotScriptPath,
    "--shotId",
    shotId,
    "--score=0",
    "--maxSize",
    String(profile.maxSize),
    "--refEdge",
    String(profile.refEdge),
    "--steps",
    String(profile.steps),
    "--cfg",
    String(profile.cfg),
    "--denoise",
    String(profile.denoise),
    "--timeoutMs",
    String(timeoutMs),
    "--twoStage",
    twoStage ? "1" : "0",
    "--tag",
    tag
  ];
  if (char1Name) {
    args.push("--char1Name", char1Name);
  }
  if (char2Name && twoStage) {
    args.push("--char2Name", char2Name);
  }
  if (Number.isFinite(Number(profile.char1PrimaryWeight))) {
    args.push("--char1PrimaryWeight", String(profile.char1PrimaryWeight));
  }
  if (Number.isFinite(Number(profile.char2PrimaryWeight))) {
    args.push("--char2PrimaryWeight", String(profile.char2PrimaryWeight));
  }
  if (Number.isFinite(Number(profile.char2SecondaryWeight))) {
    args.push("--char2SecondaryWeight", String(profile.char2SecondaryWeight));
  }
  const result = await runCommand(nodeBin, args, { cwd: repoRoot, streamOutput: false });
  if (result.code !== 0) {
    throw new Error(`runner failed (${result.code}): ${result.stderr || result.stdout}`);
  }
  const jsonText = normalizeJsonText(result.stdout);
  if (!jsonText) {
    throw new Error(`runner returned non-json output: ${result.stdout.slice(0, 400)}`);
  }
  return JSON.parse(jsonText);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const comfyRoot = String(
    args.comfyRoot || "C:/Users/Administrator/Desktop/AiProject/ComfyUI_JM_windows_portable"
  ).trim();
  const baseUrl = String(args.baseUrl || "http://127.0.0.1:8188").replace(/\/+$/, "");
  const shotScriptPath = path.resolve(
    String(args.shotScript || "examples/river-continuity-test/river_continuity_test_shot_script.json")
  );
  const maxRounds = Math.max(1, Math.floor(toNumber(args.maxRounds, 3)));
  const maxAttemptsPerShot = Math.max(1, Math.floor(toNumber(args.maxAttemptsPerShot, 4)));
  const timeoutMs = Math.max(30_000, Math.floor(toNumber(args.timeoutMs, 20 * 60 * 1000)));
  const skipBuild = String(args.skipBuild || "0").trim() === "1";
  const enableStageAForceSanitize = String(args.enableStageAForceSanitize || "0").trim() === "1";
  const selectedShotIds = new Set(splitCsv(args.shots));
  const singleStageIds = new Set(
    splitCsv(args.singleStageIds || "river_continuity_004")
  );
  const nodeBin = process.execPath;
  const runnerScript = path.join(repoRoot, "scripts", "run-qwen-stageab-first-shot-test.mjs");
  const validatorScript = path.join(repoRoot, "scripts", "storyboard_validate_stageab.py");
  const stageASanitizeScript = path.join(repoRoot, "scripts", "storyboard_sanitize_stagea.py");
  const stageBSanitizeScript = path.join(repoRoot, "scripts", "storyboard_sanitize_stageb.py");
  const pythonExe = path.resolve(
    String(args.python || path.join(comfyRoot, "python_embeded", "python.exe"))
  );
  const comfyInputDir = path.join(comfyRoot, "ComfyUI", "input");
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

  if (!fssync.existsSync(runnerScript)) {
    throw new Error(`runner script not found: ${runnerScript}`);
  }
  if (!fssync.existsSync(validatorScript)) {
    throw new Error(`validator script not found: ${validatorScript}`);
  }
  if (!fssync.existsSync(stageBSanitizeScript)) {
    throw new Error(`stageB sanitize script not found: ${stageBSanitizeScript}`);
  }
  if (!fssync.existsSync(stageASanitizeScript)) {
    throw new Error(`stageA sanitize script not found: ${stageASanitizeScript}`);
  }
  if (!fssync.existsSync(pythonExe)) {
    throw new Error(`python not found: ${pythonExe}`);
  }

  if (!skipBuild) {
    console.log("[autofix] building web app...");
    const build = await runCommand(npmBin, ["run", "build"], { cwd: repoRoot });
    if (build.code !== 0) {
      throw new Error("build failed");
    }
    console.log("[autofix] running threeview guards...");
    const guards = await runCommand(npmBin, ["run", "test:threeview-guards"], { cwd: repoRoot });
    if (guards.code !== 0) {
      throw new Error("test:threeview-guards failed");
    }
  }

  const shotScriptRaw = await fs.readFile(shotScriptPath, "utf8");
  const shotScript = JSON.parse(shotScriptRaw);
  const allShots = Array.isArray(shotScript?.shots) ? shotScript.shots : [];
  const shots = selectedShotIds.size > 0
    ? allShots.filter((shot) => selectedShotIds.has(String(shot?.id || "").trim()))
    : allShots;
  if (shots.length === 0) {
    throw new Error(`no shots selected from ${shotScriptPath}`);
  }
  const useCanonicalRoleBinding = String(args.disableCanonicalBinding || "0").trim() !== "1";
  const canonicalDualCharacterNames = (() => {
    if (!useCanonicalRoleBinding) return [];
    for (const shot of allShots) {
      const names = Array.isArray(shot?.character_names)
        ? shot.character_names.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      if (names.length >= 2) return names.slice(0, 2);
    }
    return [];
  })();
  const baseProfile = {
    maxSize: Math.round(clamp(toNumber(args.maxSize, 896), 704, 1024)),
    refEdge: Math.round(clamp(toNumber(args.refEdge, 512), 384, 640)),
    steps: Math.round(clamp(toNumber(args.steps, 6), 4, 8)),
    cfg: clamp(toNumber(args.cfg, 1.0), 0.88, 1.12),
    denoise: clamp(toNumber(args.denoise, 0.9), 0.72, 0.99),
    char1PrimaryWeight: clamp(toNumber(args.char1PrimaryWeight, 0.96), 0.8, 1.24),
    char2PrimaryWeight: clamp(toNumber(args.char2PrimaryWeight, 0.9), 0.75, 1.24),
    char2SecondaryWeight: clamp(toNumber(args.char2SecondaryWeight, 0.34), 0.2, 0.8)
  };
  const profileByShot = new Map();
  const resolvedShots = new Map();
  const rounds = [];
  let overallPass = false;

  console.log(
    `[autofix] shots=${shots.length} rounds=${maxRounds} attempts_per_shot=${maxAttemptsPerShot} baseUrl=${baseUrl}`
  );
  if (canonicalDualCharacterNames.length >= 2) {
    console.log(
      `[autofix] canonical_role_binding char1=${canonicalDualCharacterNames[0]} char2=${canonicalDualCharacterNames[1]}`
    );
  }
  for (let round = 1; round <= maxRounds; round += 1) {
    console.log(`\n[autofix] ===== round ${round}/${maxRounds} =====`);
    const roundRecord = { round, shots: [] };

    for (const shot of shots) {
      const shotId = String(shot?.id || "").trim();
      const shotName = inferShotName(shot);
      if (resolvedShots.has(shotId)) {
        const resolved = resolvedShots.get(shotId);
        roundRecord.shots.push({
          shotId,
          shotName,
          passed: true,
          skipped: true,
          resolvedAtRound: resolved?.resolvedAtRound ?? round - 1,
          finalProfile: resolved?.finalProfile ?? profileByShot.get(shotId) ?? { ...baseProfile },
          attempts: []
        });
        continue;
      }
      const shotCharacterNames = Array.isArray(shot?.character_names)
        ? shot.character_names.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      const expectDual = shotCharacterNames.length >= 2 && !singleStageIds.has(shotId);
      const boundChar1Name = String(canonicalDualCharacterNames[0] || shotCharacterNames[0] || "").trim();
      const boundChar2Name = String(canonicalDualCharacterNames[1] || shotCharacterNames[1] || "").trim();
      let profile = profileByShot.get(shotId) || { ...baseProfile };
      if (round > 1 && profileByShot.has(shotId)) {
        profile = { ...baseProfile };
        console.log(`[autofix] shot=${shotId} round=${round} profile_reset=base`);
      }
      const shotAttempts = [];
      let shotPassed = false;

      for (let attempt = 1; attempt <= maxAttemptsPerShot; attempt += 1) {
        console.log(
          `[autofix] shot=${shotId} (${shotName}) attempt=${attempt}/${maxAttemptsPerShot} twoStage=${expectDual ? "1" : "0"} denoise=${profile.denoise.toFixed(2)} cfg=${profile.cfg.toFixed(2)} max=${profile.maxSize} w1=${Number(profile.char1PrimaryWeight).toFixed(2)} w2=${Number(profile.char2PrimaryWeight).toFixed(2)} w2s=${Number(profile.char2SecondaryWeight).toFixed(2)}`
        );
        const tag = `autofix_${Date.now()}_${round}_${attempt}_${shotId}`;
        try {
          const runnerResult = await runFirstShotScript({
            nodeBin,
            runnerScript,
            comfyRoot,
            baseUrl,
            shotScriptPath,
            shotId,
            profile,
            twoStage: expectDual,
            char1Name: boundChar1Name,
            char2Name: boundChar2Name,
            timeoutMs,
            tag
          });
          const stageAPath = String(runnerResult?.stageA?.outputPath || "").trim();
          const stageARawPath = String(runnerResult?.stageA?.rawOutputPath || "").trim();
          const stageBPath = expectDual
            ? String(runnerResult?.stageB?.outputPath || "").trim()
            : "";
          let requestPayload = {
            // Validate against the actual Stage-A base that Stage-B consumes.
            // Raw Stage-A often contains tolerated leakage that is already cleaned in stageA.outputPath.
            stageAPath: stageAPath || stageARawPath,
            stageABasePath: stageAPath,
            stageBPath,
            scenePath: path.join(comfyInputDir, `shot_${shotId}_scene_ref_path.png`),
            char1PrimaryPath: path.join(comfyInputDir, `shot_${shotId}_char1_primary_path.png`),
            char1MaskPath: path.join(comfyInputDir, `shot_${shotId}_char1_mask.png`),
            char2MaskPath: expectDual ? path.join(comfyInputDir, `shot_${shotId}_char2_mask.png`) : "",
            char2PrimaryPath: expectDual ? path.join(comfyInputDir, `shot_${shotId}_char2_primary_path.png`) : "",
            expectDual
          };
          let stageAPathForStageBSanitize = stageAPath;
          let validation = await runValidator({
            pythonExe,
            validatorScript,
            requestPayload
          });
          let stageAForceSanitize = null;
          if (
            expectDual &&
            enableStageAForceSanitize &&
            !validation.ok &&
            String(validation.reason || "") === "invalid_stageA_scene_drift_or_unmasked_subject" &&
            stageARawPath
          ) {
            try {
              const forcedStageAPath = path.join(
                os.tmpdir(),
                `storyboard_stagea_forced_${shotId}_${Date.now()}_${attempt}.png`
              );
              stageAForceSanitize = await runStageAForceSanitize({
                pythonExe,
                sanitizeScript: stageASanitizeScript,
                stageAPath: stageARawPath,
                scenePath: requestPayload.scenePath,
                char1MaskPath: requestPayload.char1MaskPath,
                outputPath: forcedStageAPath
              });
              const forcedPath = String(stageAForceSanitize?.outputPath || "").trim();
              if (forcedPath && fssync.existsSync(forcedPath)) {
                requestPayload = {
                  ...requestPayload,
                  stageAPath: forcedPath,
                  stageABasePath: forcedPath
                };
                stageAPathForStageBSanitize = forcedPath;
                const forcedValidation = await runValidator({
                  pythonExe,
                  validatorScript,
                  requestPayload
                });
                stageAForceSanitize = {
                  ...stageAForceSanitize,
                  postValidation: forcedValidation
                };
                validation = forcedValidation;
              }
            } catch (error) {
              stageAForceSanitize = {
                applied: false,
                error: error instanceof Error ? error.message : String(error)
              };
            }
          }
          let stageBSanitize = null;
          if (
            expectDual &&
            !validation.ok &&
            [
              "invalid_stageB_unmasked_extra_subject_or_scene_drift",
              "invalid_stageB_char1_missing_or_too_weak",
              "invalid_stageB_char1_identity_or_outfit_drift",
              "invalid_stageB_char2_identity_or_outfit_drift",
              "invalid_stageB_char2_missing_or_too_weak",
              "invalid_stageB_char2_not_added"
            ].includes(String(validation.reason || ""))
          ) {
            try {
              stageBSanitize = await runStageBSanitize({
                pythonExe,
                sanitizeScript: stageBSanitizeScript,
                stageAPath: stageAPathForStageBSanitize || stageAPath,
                stageBPath,
                char1MaskPath: requestPayload.char1MaskPath,
                char2MaskPath: requestPayload.char2MaskPath,
                char2PrimaryPath: requestPayload.char2PrimaryPath,
                reason: validation.reason
              });
              if (stageBSanitize?.applied) {
                const postValidation = await runValidator({
                  pythonExe,
                  validatorScript,
                  requestPayload
                });
                stageBSanitize = {
                  ...stageBSanitize,
                  postValidation
                };
                validation = postValidation;
              }
            } catch (error) {
              stageBSanitize = {
                applied: false,
                error: error instanceof Error ? error.message : String(error)
              };
            }
          }
          const attemptRecord = {
            attempt,
            profile: { ...profile },
            runnerResult,
            validation,
            stageAForceSanitize,
            stageBSanitize
          };
          shotAttempts.push(attemptRecord);
          if (validation.ok) {
            shotPassed = true;
            console.log(`[autofix] pass shot=${shotId} reason=${validation.reason}`);
            break;
          }
          console.log(`[autofix] fail shot=${shotId} reason=${validation.reason}`);
          profile = tuneAttemptProfile(profile, String(validation.reason || ""));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`[autofix] error shot=${shotId} ${message}`);
          shotAttempts.push({
            attempt,
            profile: { ...profile },
            error: message
          });
          profile = tuneAttemptProfile(profile, "runner_error");
        }
      }

      profileByShot.set(shotId, profile);
      if (shotPassed) {
        resolvedShots.set(shotId, {
          resolvedAtRound: round,
          finalProfile: profile
        });
      }
      roundRecord.shots.push({
        shotId,
        shotName,
        passed: shotPassed,
        finalProfile: profile,
        attempts: shotAttempts
      });
    }

    rounds.push(roundRecord);
    if (resolvedShots.size >= shots.length) {
      overallPass = true;
      console.log(`[autofix] round ${round} all shots passed`);
      break;
    }
  }

  const report = {
    startedAt: new Date().toISOString(),
    comfyRoot,
    baseUrl,
    shotScriptPath,
    maxRounds,
    maxAttemptsPerShot,
    overallPass,
    rounds
  };
  const reportDir = path.join(repoRoot, "logs");
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `storyboard-autofix-loop-${Date.now()}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\n[autofix] report=${reportPath}`);

  if (!overallPass) {
    console.error("[autofix] not all shots passed within limits");
    process.exit(2);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[autofix] fatal: ${message}`);
  process.exit(1);
});
