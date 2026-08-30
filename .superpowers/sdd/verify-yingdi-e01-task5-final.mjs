import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const production = "C:\\Users\\Administrator\\Desktop\\小说\\项目\\影帝他总想对我图谋不轨_漫剧改编\\投产\\E01";
const project = "C:\\Users\\Administrator\\Desktop\\小说\\应用项目\\影帝他总想对我图谋不轨_E01样片.sbproj";
const review = "C:\\Users\\Administrator\\Desktop\\小说\\项目\\影帝他总想对我图谋不轨_漫剧改编\\图片\\E01\\分镜候选";
const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const normalize = (value) => String(value).replace(/^\\\\\?\\/, "");
const plan = await readJson(path.join(production, "shot-plan.json"));
const run = await readJson(path.join(production, "run-manifest.json"));
const assets = await readJson(path.join(production, "asset-manifest.json"));
const beatCount = new Set(plan.shots.flatMap((shot) => shot.beatIds)).size;
const seconds = Number(plan.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0).toFixed(1));
if (plan.shots.length !== 23 || beatCount !== 36 || seconds !== 106.9) throw new Error(`plan_shape:${beatCount}:${seconds}`);
let cropModes = 0;
for (const shot of plan.shots) {
  if (shot.storyboardStatus !== "needs_review" || shot.candidateStatus !== "needs_review_user" || shot.videoStatus !== "blocked" || shot.generatedImagePath) throw new Error(`shot_gate:${shot.shotId}`);
  const packagePath = normalize(shot.packagePath);
  const outputDir = path.join(packagePath, "outputs");
  const names = (await fs.readdir(outputDir)).sort();
  if (JSON.stringify(names) !== JSON.stringify(["candidate.png", "import-receipt.json", "result.json"])) throw new Error(`outputs:${shot.shotId}:${names}`);
  const requestBytes = await fs.readFile(path.join(packagePath, "request.json"));
  const result = await readJson(path.join(outputDir, "result.json"));
  const receipt = await readJson(path.join(outputDir, "import-receipt.json"));
  const candidate = await fs.readFile(path.join(outputDir, "candidate.png"));
  const reviewBytes = await fs.readFile(path.join(review, `${shot.shotId}.png`));
  if (sha(requestBytes) !== shot.requestDigest || result.jobId !== shot.codexJobId || result.requestDigest !== shot.requestDigest || result.output.sha256 !== sha(candidate) || sha(reviewBytes) !== sha(candidate) || receipt.jobId !== shot.codexJobId || receipt.status !== "needs_review" || receipt.result?.generationMode !== result.generationMode || receipt.result?.output?.sha256 !== result.output.sha256) throw new Error(`lineage:${shot.shotId}`);
  if (result.generationMode === "user_authorized_local_deterministic_crop") {
    cropModes += 1;
    if (shot.shotId !== "E01-S01-C23" || result.derivedTransform?.operation !== result.generationMode || result.derivedTransform?.tool?.generative !== false || result.derivedTransform?.output?.sha256 !== result.output.sha256 || result.output.width * 9 !== result.output.height * 16) throw new Error("crop_lineage");
  } else if (result.generationMode !== "codex_builtin_imagegen" || result.derivedTransform) throw new Error(`generation_mode:${shot.shotId}`);
}
if (cropModes !== 1) throw new Error(`crop_count:${cropModes}`);
if (sha(await fs.readFile(path.join(production, "shot-plan.json"))) !== run.shotPlanDigest || run.stage !== "stage_a_user_review" || run.storyboardReview !== "needs_review" || run.videoGeneration !== "blocked" || run.selectedVideoWorkflow !== "DaSiWa_MiniMaxH3Video" || run.selectedVideoWorkflowState !== "pending_stage_b_gate") throw new Error("run_gate");
if (Object.keys(run.sourceDigests).length !== 35) throw new Error("source_count");
for (const [file, expected] of Object.entries(run.sourceDigests)) if (sha(await fs.readFile(file)) !== expected.sha256) throw new Error(`source_digest:${file}`);
if (assets.items.length !== 21 || assets.items.some((item) => item.acceptedPath)) throw new Error("asset_gate");
const formalDirs = [
  "C:\\Users\\Administrator\\Desktop\\小说\\项目\\影帝他总想对我图谋不轨_漫剧改编\\图片\\E01\\正式分镜",
  "C:\\Users\\Administrator\\Desktop\\小说\\项目\\影帝他总想对我图谋不轨_漫剧改编\\图片\\E01\\正式资产",
  "C:\\Users\\Administrator\\Desktop\\小说\\项目\\影帝他总想对我图谋不轨_漫剧改编\\视频\\E01\\逐镜",
  "C:\\Users\\Administrator\\Desktop\\小说\\项目\\影帝他总想对我图谋不轨_漫剧改编\\视频\\E01\\成片",
  "C:\\Users\\Administrator\\Desktop\\小说\\项目\\影帝他总想对我图谋不轨_漫剧改编\\音频\\E01"
];
for (const directory of formalDirs) if ((await fs.readdir(directory)).length) throw new Error(`formal_not_empty:${directory}`);
const snapshot = await readJson(path.join(project, "snapshot.json"));
if (snapshot.shots?.some((shot) => shot.generatedImagePath || shot.generatedVideoPath)) throw new Error("snapshot_generated");
console.log(JSON.stringify({ok:true,shots:23,receipts:23,needsReview:23,generated:0,cropModes,sourceDigests:35,acceptedPaths:0,formalFiles:0,shotPlanDigest:run.shotPlanDigest,videoGeneration:run.videoGeneration,videoWorkflowState:run.selectedVideoWorkflowState}));
