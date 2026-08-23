import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { acquireReportMutationLock, releaseReportMutationLock } from "./run-layered-local-repair.mjs";
import { assertCurrentSurfaceMaskManifest, assertSurfaceTask4TerminalProvenance, canonicalSurfaceRejectionEvidence, compileSurfaceWorkflow, STAGE_NEGATIVE_PROMPT, STAGE_PROMPTS } from "./lib/surface-empty-plate-v2-comfy.mjs";
import { assertOutsideEditableIdentity } from "./lib/surface-empty-plate-v2-masks.mjs";
import { assertSurfaceRun, sha256File, SURFACE_SEEDS, writeSurfaceReportAtomic } from "./lib/surface-empty-plate-v2-run.mjs";

const SURFACE_STAGES = Object.freeze(["upper_background", "middle_background", "lower_background"]);
const REVIEW_STAGES = Object.freeze(["surface_mask_overlay", ...SURFACE_STAGES, "final_empty_plate"]);
const PRESET_PATH = path.resolve(fileURLToPath(new URL("../src/modules/comfy-pipeline/presets/surface-empty-plate-qwen-v2.json", import.meta.url)));
const APPROVED_MODELS = Object.freeze({
  unet: "qwen_image_edit_2511_fp8mixed.safetensors",
  lora: "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
  clip: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
  vae: "qwen_image_vae.safetensors",
});
export const FINAL_PROMPT = "Deterministically copy the current accepted lower-stage empty plate without generation.";
export const FINAL_NEGATIVE_PROMPT = "No generation, resampling, pixel edits, or provenance changes.";
export const FINAL_ASSEMBLY = "byte-for-byte-copy-v1";

function fail(message) { throw new Error(`Surface empty plate V2 explicit review invariant: ${message}`); }
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function same(left, right) { return stable(left) === stable(right); }
function core(value) { return value && { path: path.resolve(value.path), size: value.size, sha256: String(value.sha256).toLowerCase() }; }
function sameResource(left, right) { return same(core(left), core(right)); }
function hashJson(value) { return createHash("sha256").update(stable(value)).digest("hex"); }
function readJson(filePath, label) { try { return JSON.parse(readFileSync(filePath, "utf8")); } catch { fail(`${label} is missing or malformed`); } }
function writeJsonExclusive(filePath, value) { const descriptor = openSync(path.resolve(filePath), "wx", 0o600); try { writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor); } finally { closeSync(descriptor); } }
function exactResource(value, label, geometry) {
  if (!value || typeof value.path !== "string" || !Number.isSafeInteger(value.size) || value.size <= 0 || !/^[a-f0-9]{64}$/i.test(value.sha256 ?? "")) fail(`${label} record is malformed`);
  const resolved = path.resolve(value.path); if (!existsSync(resolved) || !statSync(resolved).isFile() || statSync(resolved).size !== value.size || sha256File(resolved) !== value.sha256.toLowerCase()) fail(`${label} is missing or hash-mismatched`);
  if (geometry) {
    const result = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height", "-of", "json", resolved], { encoding: "utf8", windowsHide: true });
    let stream; try { stream = JSON.parse(result.stdout)?.streams?.[0]; } catch { /* handled below */ }
    if (result.error || result.status !== 0 || stream?.codec_name !== "png" || stream.width !== geometry.width || stream.height !== geometry.height) fail(`${label} must be a decodable ${geometry.width}x${geometry.height} PNG`);
  }
  return { ...structuredClone(value), path: resolved, sha256: value.sha256.toLowerCase() };
}
function currentAccepted(report, stage) { return report.stages[stage].filter((candidate) => candidate.state === "accepted" && !report.invalidations.some((entry) => entry.descendantStage === stage && entry.descendantCandidateId === candidate.id)); }
function manifestPath(reportPath, provided) { return path.resolve(provided ?? path.join(path.dirname(reportPath), "surface-masks", "surface-mask-manifest.json")); }
function reviewArtifactPath(manifestFile, provided) { return path.resolve(provided ?? path.join(path.dirname(manifestFile), "surface-mask-review.json")); }
function manifestResource(filePath) { const stats = statSync(filePath); return { path: path.resolve(filePath), size: stats.size, sha256: sha256File(filePath) }; }
function loadManifest(report, reportPath, provided) {
  const filePath = manifestPath(reportPath, provided); const resource = exactResource(manifestResource(filePath), "surface mask manifest"); const manifest = readJson(filePath, "surface mask manifest");
  try { assertCurrentSurfaceMaskManifest(manifest, report); } catch (error) { fail(`surface mask manifest is not current: ${error.message}`); }
  if (!sameResource(manifest.source, report.source)) fail("surface mask manifest source does not match the current report");
  return { filePath, resource, manifest };
}
function assertOverlayReview(context, provided) {
  const filePath = reviewArtifactPath(context.filePath, provided); const value = readJson(filePath, "surface mask overlay review");
  if (value?.schema !== 1 || value.kind !== "surface-mask-overlay-review" || value.currentDecision !== "accepted" || !Array.isArray(value.history) || !value.history.length) fail("surface mask overlay lacks explicit accepted review");
  if (!sameResource(value.manifest, context.resource)) fail("surface mask overlay review is bound to a stale manifest");
  const latest = value.history.at(-1); if (latest?.decision !== "accepted" || typeof latest.note !== "string" || !latest.note.trim() || !sameResource(latest.evidence, context.manifest.combinedOverlay)) fail("surface mask overlay accepted review/evidence is stale");
  exactResource(latest.evidence, "surface mask overlay accepted evidence", { width: 1152, height: 640 }); return { filePath, value };
}
export function loadSurfaceManifestContext(report, reportPath, options = {}) { return loadManifest(report, reportPath, options.manifestPath); }
export function loadSurfaceReviewContext(report, reportPath, options = {}) { const context = loadSurfaceManifestContext(report, reportPath, options); const overlay = assertOverlayReview(context, options.overlayReviewPath); return { ...context, overlay }; }
function selectedOverlap(manifest, stage) { return stage === "lower_background" ? manifest.overlaps?.middleLower : manifest.overlaps?.upperMiddle; }
function modelSelections(workflow) { const selected = {}; for (const node of Object.values(workflow)) { if (node.class_type === "UNETLoader") selected.unet = node.inputs?.unet_name; if (node.class_type === "LoraLoaderModelOnly") selected.lora = node.inputs?.lora_name; if (node.class_type === "CLIPLoader") selected.clip = node.inputs?.clip_name; if (node.class_type === "VAELoader") selected.vae = node.inputs?.vae_name; } return selected; }
function exactAncestors(report, stage, candidate, historical = false) {
  const expected = historical ? SURFACE_STAGES.slice(0, SURFACE_STAGES.indexOf(stage)).map((ancestorStage, index) => { const recorded = candidate.ancestors?.[index]; if (recorded?.stage !== ancestorStage || !report.stages[ancestorStage].some((item) => item.id === recorded.candidateId)) fail(`${stage}/${candidate.id} recorded historical ancestor is invalid`); return recorded; }) : SURFACE_STAGES.slice(0, SURFACE_STAGES.indexOf(stage)).map((ancestorStage) => { const accepted = currentAccepted(report, ancestorStage); if (accepted.length !== 1) fail(`${ancestorStage} requires exactly one current accepted candidate`); return { stage: ancestorStage, candidateId: accepted[0].id }; });
  if (!same(candidate.ancestors, expected)) fail(`${stage}/${candidate.id} ancestor chain is stale`); return expected;
}
export function assertCurrentTask4Candidate(report, reportPath, stage, candidate, context, options = {}) {
  if (!SURFACE_STAGES.includes(stage)) fail(`unknown Task 4 stage ${stage}`); exactAncestors(report, stage, candidate, options.historical === true);
  const number = Number(candidate.id.slice(-3)); if (![1, 2].includes(number)) fail(`${stage} candidate id is invalid`);
  const prior = SURFACE_STAGES[SURFACE_STAGES.indexOf(stage) - 1]; const recordedPrior = candidate.ancestors?.at(-1); const expectedInput = prior ? (options.historical ? report.stages[prior].find((item) => item.id === recordedPrior?.candidateId)?.output : currentAccepted(report, prior)[0]?.output) : report.source; if (!sameResource(candidate.input, expectedInput)) fail(`${stage}/${candidate.id} current input is stale`);
  const wantedMasks = { editable: context.manifest.masks?.[stage], protected: context.manifest.protectedMasks?.[stage], overlap: selectedOverlap(context.manifest, stage) };
  for (const [key, value] of Object.entries(wantedMasks)) { exactResource(value, `${stage} ${key} manifest mask`, { width: 1152, height: 640 }); if (!sameResource(candidate.masks?.[key], value)) fail(`${stage}/${candidate.id} ${key} mask provenance drifted`); }
  if (!sameResource(candidate.maskManifest, context.resource)) fail(`${stage}/${candidate.id} mask manifest provenance drifted`);
  if (candidate.prompt !== STAGE_PROMPTS[stage] || candidate.negativePrompt !== STAGE_NEGATIVE_PROMPT || candidate.seed !== SURFACE_SEEDS[stage][number - 1]) fail(`${stage}/${candidate.id} fixed prompt/seed drifted`);
  if (path.resolve(candidate.preset?.path ?? "") !== PRESET_PATH || candidate.preset?.sha256 !== sha256File(PRESET_PATH)) fail(`${stage}/${candidate.id} preset provenance drifted`);
  const workflow = readJson(candidate.workflow?.path, `${stage}/${candidate.id} workflow`); if (candidate.workflow?.sha256 !== sha256File(candidate.workflow.path)) fail(`${stage}/${candidate.id} workflow hash drifted`);
  const preset = readJson(PRESET_PATH, "approved V2 preset"); const expectedWorkflow = compileSurfaceWorkflow(preset, { INPUT_IMAGE: candidate.uploads?.inputImage, EDITABLE_MASK: candidate.uploads?.editableMask, PROMPT: STAGE_PROMPTS[stage], NEGATIVE_PROMPT: STAGE_NEGATIVE_PROMPT, SEED: SURFACE_SEEDS[stage][number - 1], FILENAME_PREFIX: `${stage}/${candidate.id}/surface` });
  if (!same(workflow, expectedWorkflow)) fail(`${stage}/${candidate.id} workflow is not the exact approved graph`); const models = modelSelections(workflow); if (!same(models, APPROVED_MODELS) || !same(candidate.models, models) || candidate.model?.name !== models.unet || candidate.model?.sha256 !== hashJson(models)) fail(`${stage}/${candidate.id} model provenance drifted`);
  exactResource(candidate.output, `${stage}/${candidate.id} output`, { width: 1152, height: 640 }); exactResource(candidate.rawComfyOutput, `${stage}/${candidate.id} raw Comfy output`, { width: 1152, height: 640 }); exactResource(candidate.evidence?.difference, `${stage}/${candidate.id} difference`, { width: 1152, height: 640 }); exactResource(candidate.evidence?.comparison, `${stage}/${candidate.id} comparison`, { width: 2304, height: 640 }); exactResource(candidate.evidence?.maskOverlay, `${stage}/${candidate.id} mask overlay`, { width: 1152, height: 640 });
  assertOutsideEditableIdentity(candidate.input.path, candidate.output.path, candidate.masks.editable.path); assertSurfaceTask4TerminalProvenance({ reportPath, stage, candidate, workflow }); return candidate;
}
export function assertCurrentFinalCandidate(report, reportPath, candidate, context, options = {}) {
  const lower = currentAccepted(report, "lower_background"); if (lower.length !== 1) fail("final assembly requires exactly one current accepted lower candidate");
  const acceptedByStage = {}; const ancestors = SURFACE_STAGES.map((stage) => { const accepted = currentAccepted(report, stage); if (accepted.length !== 1) fail(`${stage} requires exactly one current accepted candidate`); acceptedByStage[stage] = accepted[0]; return { stage, candidateId: accepted[0].id }; });
  const finalOutput = exactResource(candidate.output, "final empty plate", { width: 1152, height: 640 });
  const chain = exactResource(candidate.chainManifest, "final chain manifest"); const value = readJson(chain.path, "final chain manifest"); const overlay = assertOverlayReview(context, options.overlayReviewPath);
  const expectedChain = { schema: 1, kind: "surface-empty-plate-v2-final-chain", source: structuredClone(report.source), maskManifest: structuredClone(context.resource), overlayReview: manifestResource(overlay.filePath), ancestors, candidates: Object.fromEntries(SURFACE_STAGES.map((stage) => [stage, structuredClone(acceptedByStage[stage])])), lowerOutput: structuredClone(lower[0].output), output: structuredClone(finalOutput), generativeCalls: 0 };
  if (!same(value, expectedChain)) fail("final chain manifest does not exactly equal the complete current accepted chain");
  const exactFields = {
    input: lower[0].output, masks: lower[0].masks, maskManifest: context.resource,
    prompt: FINAL_PROMPT, negativePrompt: FINAL_NEGATIVE_PROMPT,
    preset: lower[0].preset, workflow: lower[0].workflow, model: lower[0].model, models: lower[0].models,
    promptId: `deterministic-copy:${finalOutput.sha256}`, output: finalOutput,
    evidence: { comparison: finalOutput, difference: finalOutput, maskOverlay: finalOutput }, ancestors,
    copyOf: lower[0].output, chainManifest: chain, generativeCalls: 0, assembly: FINAL_ASSEMBLY,
  };
  for (const [key, expected] of Object.entries(exactFields)) if (!same(candidate[key], expected)) fail(`final deterministic assembly ${key} is stale`);
  if (candidate.seed !== undefined || candidate.technicalAcceptance !== "accepted") fail("final deterministic assembly technical provenance is stale");
  for (const stage of SURFACE_STAGES) assertCurrentTask4Candidate(report, reportPath, stage, acceptedByStage[stage], context); return candidate;
}
function invalidateExactDescendants(report, stage, candidateId) { for (const descendantStage of [...SURFACE_STAGES, "final_empty_plate"].slice([...SURFACE_STAGES, "final_empty_plate"].indexOf(stage) + 1)) for (const descendant of report.stages[descendantStage]) if (descendant.ancestors?.some((ancestor) => ancestor.stage === stage && ancestor.candidateId === candidateId) && !report.invalidations.some((entry) => entry.descendantStage === descendantStage && entry.descendantCandidateId === descendant.id)) report.invalidations.push({ ancestorStage: stage, ancestorCandidateId: candidateId, descendantStage, descendantCandidateId: descendant.id, reason: `upstream ${stage}/${candidateId} was rejected` }); }

export async function reviewSurfaceCandidateExplicit(args = {}) {
  const reportPath = path.resolve(args.reportPath ?? ""); const stage = args.stage; const candidateId = args.candidate; const decision = args.decision; const note = args.note;
  if (!REVIEW_STAGES.includes(stage) || !/^candidate_00[12]$/.test(candidateId ?? "") || !["accepted", "rejected"].includes(decision) || typeof note !== "string" || !note.trim() || !args.evidencePath) fail("stage, candidate, decision, evidence, and note are required");
  if ((stage === "surface_mask_overlay" || stage === "final_empty_plate") && candidateId !== "candidate_001") fail(`${stage} only permits candidate_001`);
  const supportingEvidence = exactResource(manifestResource(path.resolve(args.evidencePath)), "review evidence", stage === "surface_mask_overlay" ? { width: 1152, height: 640 } : undefined);
  const lock = await acquireReportMutationLock(reportPath, { timeoutMs: args.lockTimeoutMs ?? 5000, processIdentityProvider: args.processIdentityProvider, purpose: `surface-review:${stage}:${candidateId}` });
  try {
    const before = readFileSync(reportPath); const beforeHash = sha256File(reportPath); const report = readJson(reportPath, "surface run report"); assertSurfaceRun(report); const context = loadManifest(report, reportPath, args.manifestPath); await args.afterSnapshot?.({ report: structuredClone(report), reportPath });
    if (!readFileSync(reportPath).equals(before) || sha256File(reportPath) !== beforeHash) fail("report changed after review snapshot; stale review rejected");
    if (stage === "surface_mask_overlay") {
      if (!sameResource(supportingEvidence, context.manifest.combinedOverlay)) fail("accepted/rejected overlay evidence must exactly match the frozen combined overlay");
      const artifactPath = reviewArtifactPath(context.filePath, args.overlayReviewPath); if (existsSync(artifactPath)) fail("external overlay review already exists; refusing overwrite");
      const artifact = { schema: 1, kind: "surface-mask-overlay-review", manifest: context.resource, currentDecision: decision, history: [{ decision, note: note.trim(), evidence: supportingEvidence }] };
      writeJsonExclusive(artifactPath, artifact); return { report, stage, candidate: candidateId, reviewArtifactPath: artifactPath, review: artifact.history[0] };
    }
    const overlay = assertOverlayReview(context, args.overlayReviewPath); const matches = report.stages[stage].filter((candidate) => candidate.id === candidateId); if (matches.length !== 1) fail(`${stage}/${candidateId} does not exist uniquely`); const candidate = matches[0]; if (candidate.state === "rejected" || report.invalidations.some((entry) => entry.descendantStage === stage && entry.descendantCandidateId === candidateId)) fail("candidate review transition is duplicate or invalidated");
    if (decision === "accepted") {
      if (candidate.state !== "technical" || candidate.creativeAcceptance !== "pending") fail("only a technical/pending candidate can be accepted"); if (!sameResource(supportingEvidence, candidate.output)) fail("accepted evidence must exactly match the current stored output"); if (currentAccepted(report, stage).some((item) => item.id !== candidateId)) fail(`${stage} already has a current accepted candidate`);
      if (stage === "final_empty_plate") assertCurrentFinalCandidate(report, reportPath, candidate, context, { overlayReviewPath: args.overlayReviewPath }); else { for (const prior of SURFACE_STAGES.slice(0, SURFACE_STAGES.indexOf(stage))) assertCurrentTask4Candidate(report, reportPath, prior, currentAccepted(report, prior)[0], context); assertCurrentTask4Candidate(report, reportPath, stage, candidate, context); }
      candidate.state = "accepted"; candidate.creativeAcceptance = "accepted"; candidate.reviewHistory.push({ decision, note: note.trim(), evidence: supportingEvidence, overlayReview: manifestResource(overlay.filePath) }); if (stage === "final_empty_plate") report.overallStatus = "accepted";
    } else {
      const canonicalEvidence = canonicalSurfaceRejectionEvidence({ reportPath, stage, candidate }); const ownedEvidence = Object.entries(canonicalEvidence).find(([, value]) => sameResource(supportingEvidence, value)); if (!ownedEvidence) fail("rejected evidence must match the canonical candidate-owned evidence path policy"); exactResource(supportingEvidence, "rejected candidate-owned evidence", { width: ownedEvidence[0] === "comparison" ? 2304 : 1152, height: 640 });
      candidate.state = "rejected"; candidate.creativeAcceptance = "rejected"; candidate.reviewHistory.push({ decision, note: note.trim(), supportingEvidence }); invalidateExactDescendants(report, stage, candidateId); report.overallStatus = "pending";
      if (SURFACE_STAGES.includes(stage) && report.stages[stage].length === 2 && report.stages[stage].every((item) => item.state === "rejected")) report.stoppedReason = `${stage}_max_two_rejected`;
    }
    if (!readFileSync(reportPath).equals(before) || sha256File(reportPath) !== beforeHash) fail("report changed before atomic review write; stale review rejected"); assertSurfaceRun(report); writeSurfaceReportAtomic(reportPath, report); return { report, candidate: report.stages[stage].find((item) => item.id === candidateId), reportPath };
  } finally { releaseReportMutationLock(lock); }
}

function usage() { fail("usage: --report PATH --stage surface_mask_overlay|upper_background|middle_background|lower_background|final_empty_plate --candidate candidate_001|candidate_002 --decision accepted|rejected --evidence PATH --note TEXT"); }
export function parseArguments(argv) { if (argv.length !== 12) usage(); const allowed = new Set(["--report", "--stage", "--candidate", "--decision", "--evidence", "--note"]); const values = new Map(); for (let index = 0; index < argv.length; index += 2) { if (!allowed.has(argv[index]) || !argv[index + 1] || values.has(argv[index])) usage(); values.set(argv[index], argv[index + 1]); } const stage = values.get("--stage"); const candidate = values.get("--candidate"); const decision = values.get("--decision"); if (values.size !== allowed.size || !REVIEW_STAGES.includes(stage) || !/^candidate_00[12]$/.test(candidate ?? "") || !["accepted", "rejected"].includes(decision) || ((stage === "surface_mask_overlay" || stage === "final_empty_plate") && candidate !== "candidate_001")) usage(); return { reportPath: path.resolve(values.get("--report")), stage, candidate, decision, evidencePath: path.resolve(values.get("--evidence")), note: values.get("--note") }; }
async function main() { const result = await reviewSurfaceCandidateExplicit(parseArguments(process.argv.slice(2))); process.stdout.write(`${JSON.stringify({ reportPath: result.reportPath ?? path.resolve(parseArguments(process.argv.slice(2)).reportPath), stage: result.stage ?? result.candidate?.id, decision: result.review?.decision ?? result.candidate?.state }, null, 2)}\n`); }
if ((process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "") === import.meta.url) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
