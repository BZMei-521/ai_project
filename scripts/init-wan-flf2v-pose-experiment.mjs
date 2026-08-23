import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AUTHORITATIVE_REPORT_PATH, createExperimentReport } from "./lib/wan-flf2v-experiment.mjs";

export const POSE_EXPERIMENT_ROOT = resolve("logs/video-quality-one-take-flf2v-pose");
export const POSE_REPORT_PATH = resolve(POSE_EXPERIMENT_ROOT, "wan-flf2v-report.json");
const LEGACY_REPORT_PATH = resolve("logs/video-quality-one-take-flf2v/wan-flf2v-report.json");

function hashFile(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function assertFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) throw new Error(`${label} is missing or empty: ${path}`);
}

export function initializePoseExperiment(options = {}) {
  const experimentRoot = resolve(options.experimentRoot || POSE_EXPERIMENT_ROOT);
  const reportPath = resolve(options.reportPath || resolve(experimentRoot, "wan-flf2v-report.json"));
  const authoritativeReportPath = resolve(options.authoritativeReportPath || AUTHORITATIVE_REPORT_PATH);
  const legacyReportPath = resolve(options.legacyReportPath || LEGACY_REPORT_PATH);
  if (existsSync(reportPath)) throw new Error(`pose experiment report already exists: ${reportPath}`);
  assertFile(authoritativeReportPath, "authoritative one-take report");
  const legacyBefore = existsSync(legacyReportPath) ? hashFile(legacyReportPath) : null;
  const authority = JSON.parse(readFileSync(authoritativeReportPath, "utf8"));
  const startFramePath = resolve(options.startFramePath || authority.initialFramePath || "");
  assertFile(startFramePath, "approved start frame");
  const report = createExperimentReport({
    experimentRoot,
    authoritativeReportPath,
    authoritativeReportSha256: hashFile(authoritativeReportPath),
    startFramePath,
    startFrameSha256: hashFile(startFramePath)
  });
  mkdirSync(dirname(reportPath), { recursive: true });
  const temporaryPath = `${reportPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, reportPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  if (legacyBefore !== null && hashFile(legacyReportPath) !== legacyBefore) throw new Error("legacy FLF2V report changed during pose experiment initialization");
  return { reportPath, report };
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invoked === import.meta.url) {
  try { process.stdout.write(`${JSON.stringify(initializePoseExperiment(), null, 2)}\n`); }
  catch (error) { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; }
}
