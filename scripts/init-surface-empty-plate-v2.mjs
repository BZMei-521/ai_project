import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { assertSurfaceRun, createSurfaceRun, sha256File, writeSurfaceReportAtomic } from "./lib/surface-empty-plate-v2-run.mjs";

const LEGACY_REPORT_PATH = path.resolve("logs/layered-two-character-sample/run-report.json");
const OUTPUT_REPORT = "run-report.json";

function fail(message) { throw new Error(`Surface empty plate V2 initializer: ${message}`); }

function parseArgs(args) {
  if (args.length !== 2 || args[0] !== "--output" || typeof args[1] !== "string" || args[1].trim() === "") {
    fail("usage: --output logs/layered-empty-plate-surface-v2");
  }
  return path.resolve(args[1]);
}

function fileResource(filePath, label) {
  const resolved = path.resolve(filePath);
  if (!existsSync(resolved)) fail(`${label} is missing: ${resolved}`);
  const stats = statSync(resolved);
  if (!stats.isFile() || stats.size <= 0) fail(`${label} is not a nonempty file: ${resolved}`);
  return { path: resolved, size: stats.size, sha256: sha256File(resolved) };
}

function legacyInput() {
  const legacy = fileResource(LEGACY_REPORT_PATH, "V1 stopped report");
  let report;
  try { report = JSON.parse(readFileSync(legacy.path, "utf8")); } catch { fail("V1 stopped report is not valid JSON"); }
  const rejected = report?.stages?.empty_plate?.candidates;
  if (!Array.isArray(rejected) || rejected.length !== 3 || rejected.some((candidate) => candidate?.state !== "rejected")) {
    fail("V1 stopped report must retain exactly three rejected empty_plate candidates");
  }
  const source = report.source;
  if (!source || source.width !== 1152 || source.height !== 640) fail("V1 stopped report must retain the exact 1152x640 mother frame provenance");
  const mother = fileResource(source.path, "mother frame");
  if (mother.size !== source.size || mother.sha256 !== String(source.sha256).toLowerCase()) fail("mother frame no longer matches the V1 source hash");
  return {
    source: { ...mother, width: 1152, height: 640 },
    legacyEvidence: { reportPath: legacy.path, reportSha256: legacy.sha256, stoppedReason: "empty_plate_max_three_rejected" },
  };
}

function main() {
  const outputDirectory = parseArgs(process.argv.slice(2));
  if (existsSync(outputDirectory)) fail(`output directory already exists: ${outputDirectory}`);
  const report = createSurfaceRun(legacyInput());
  mkdirSync(path.dirname(outputDirectory), { recursive: true });
  mkdirSync(outputDirectory, { recursive: false });
  const reportPath = path.join(outputDirectory, OUTPUT_REPORT);
  writeSurfaceReportAtomic(reportPath, report);
  const persisted = JSON.parse(readFileSync(reportPath, "utf8"));
  assertSurfaceRun(persisted, { isDecodable: () => true });
  console.log(`Surface empty plate V2 initialized: ${reportPath}`);
  console.log(`SHA-256: ${sha256File(reportPath)}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
