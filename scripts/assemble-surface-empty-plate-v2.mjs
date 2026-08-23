import { constants, copyFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { acquireReportMutationLock, releaseReportMutationLock } from "./run-layered-local-repair.mjs";
import { appendSurfaceCandidate, assertSurfaceRun, sha256File, writeSurfaceReportAtomic } from "./lib/surface-empty-plate-v2-run.mjs";
import { FINAL_ASSEMBLY, FINAL_NEGATIVE_PROMPT, FINAL_PROMPT, assertCurrentTask4Candidate, loadSurfaceReviewContext } from "./review-surface-empty-plate-v2.mjs";

const STAGES = Object.freeze(["upper_background", "middle_background", "lower_background"]);
function fail(message) { throw new Error(`Surface empty plate V2 final assembly invariant: ${message}`); }
function resource(filePath) { const stats = statSync(filePath); return { path: path.resolve(filePath), size: stats.size, sha256: sha256File(filePath) }; }
function currentAccepted(report, stage) { return report.stages[stage].filter((candidate) => candidate.state === "accepted" && !report.invalidations.some((entry) => entry.descendantStage === stage && entry.descendantCandidateId === candidate.id)); }
function writeExclusiveJson(filePath, value) { const temporary = `${path.resolve(filePath)}.${process.pid}.${Date.now()}.tmp`; try { writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); renameSync(temporary, path.resolve(filePath)); } finally { if (existsSync(temporary)) unlinkSync(temporary); } }

export async function assembleSurfaceFinal(args = {}) {
  const reportPath = path.resolve(args.reportPath ?? ""); const outputPath = path.resolve(args.outputPath ?? ""); if (!args.outputPath || outputPath === path.parse(outputPath).root) fail("output path is required");
  const chainPath = path.resolve(args.chainManifestPath ?? `${outputPath}.chain-manifest.json`); if (existsSync(outputPath) || existsSync(chainPath)) fail("final output or chain manifest exists; refusing overwrite");
  const lock = await acquireReportMutationLock(reportPath, { timeoutMs: args.lockTimeoutMs ?? 5000, processIdentityProvider: args.processIdentityProvider, purpose: "surface-final-assembly:candidate_001" }); let copied = false; let wroteChain = false;
  try {
    const before = readFileSync(reportPath); const beforeHash = sha256File(reportPath); const report = JSON.parse(before.toString("utf8")); assertSurfaceRun(report); if (report.stages.final_empty_plate.length) fail("final_empty_plate candidate_001 already exists");
    const context = loadSurfaceReviewContext(report, reportPath, { manifestPath: args.manifestPath, overlayReviewPath: args.overlayReviewPath }); const accepted = {};
    for (const stage of STAGES) { const values = currentAccepted(report, stage); if (values.length !== 1) fail(`${stage} requires exactly one current accepted candidate`); accepted[stage] = values[0]; assertCurrentTask4Candidate(report, reportPath, stage, values[0], context); }
    const ancestors = STAGES.map((stage) => ({ stage, candidateId: accepted[stage].id })); const lower = accepted.lower_background;
    copyFileSync(lower.output.path, outputPath, constants.COPYFILE_EXCL); copied = true; const output = resource(outputPath); if (output.size !== lower.output.size || output.sha256 !== lower.output.sha256) fail("deterministic final copy bytes/hash differ from accepted lower output");
    const overlayReview = resource(context.overlay.filePath); const chain = { schema: 1, kind: "surface-empty-plate-v2-final-chain", source: structuredClone(report.source), maskManifest: context.resource, overlayReview, ancestors, candidates: Object.fromEntries(STAGES.map((stage) => [stage, structuredClone(accepted[stage])])), lowerOutput: structuredClone(lower.output), output, generativeCalls: 0 };
    writeExclusiveJson(chainPath, chain); wroteChain = true; const chainManifest = resource(chainPath);
    const candidate = { id: "candidate_001", input: structuredClone(lower.output), masks: structuredClone(lower.masks), maskManifest: context.resource, prompt: FINAL_PROMPT, negativePrompt: FINAL_NEGATIVE_PROMPT, preset: structuredClone(lower.preset), workflow: structuredClone(lower.workflow), model: structuredClone(lower.model), models: structuredClone(lower.models), promptId: `deterministic-copy:${output.sha256}`, output, evidence: { comparison: structuredClone(output), difference: structuredClone(output), maskOverlay: structuredClone(output) }, ancestors, copyOf: structuredClone(lower.output), chainManifest, generativeCalls: 0, assembly: FINAL_ASSEMBLY };
    await args.afterCopy?.({ outputPath, chainPath, candidate: structuredClone(candidate) }); if (!readFileSync(reportPath).equals(before) || sha256File(reportPath) !== beforeHash) fail("report changed during final assembly; stale assembly rejected");
    const next = appendSurfaceCandidate(report, "final_empty_plate", candidate); writeSurfaceReportAtomic(reportPath, next); return { report: next, candidate: next.stages.final_empty_plate[0], reportPath, outputPath, chainManifest };
  } catch (error) {
    if (wroteChain && existsSync(chainPath)) unlinkSync(chainPath); if (copied && existsSync(outputPath)) unlinkSync(outputPath); throw error;
  } finally { releaseReportMutationLock(lock); }
}

function usage() { fail("usage: --report PATH --output PATH"); }
export function parseArguments(argv) { if (argv.length !== 4) usage(); const values = new Map(); for (let index = 0; index < argv.length; index += 2) { if (!["--report", "--output"].includes(argv[index]) || !argv[index + 1] || values.has(argv[index])) usage(); values.set(argv[index], argv[index + 1]); } if (values.size !== 2) usage(); return { reportPath: path.resolve(values.get("--report")), outputPath: path.resolve(values.get("--output")) }; }
async function main() { const result = await assembleSurfaceFinal(parseArguments(process.argv.slice(2))); process.stdout.write(`${JSON.stringify({ reportPath: result.reportPath, outputPath: result.outputPath, sha256: result.candidate.output.sha256, chainManifest: result.chainManifest }, null, 2)}\n`); }
if ((process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "") === import.meta.url) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
