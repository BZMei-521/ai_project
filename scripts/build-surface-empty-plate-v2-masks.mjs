import path from "node:path";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { buildSurfaceMasks, sha256File } from "./lib/surface-empty-plate-v2-masks.mjs";

function fail(message) { throw new Error(`Surface empty plate V2 mask builder: ${message}`); }
function safeOutputRoot(reportPath, requestedOutput) {
  const reportReal = realpathSync(reportPath); const parent = path.dirname(reportReal);
  const candidate = requestedOutput ? path.resolve(requestedOutput) : path.join(parent, "surface-masks");
  const relative = path.relative(parent, candidate);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) fail("output root escapes the real report directory");
  let cursor = parent;
  for (const segment of relative.split(path.sep)) { cursor = path.join(cursor, segment); if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) fail("output root contains a symlink or junction"); }
  return candidate;
}
function parseArgs(args) {
  if (args.length !== 2 && args.length !== 4) fail("usage: --report task2-run-report.json [--output output-directory]");
  if (args[0] !== "--report" || !args[1]?.trim() || (args.length === 4 && (args[2] !== "--output" || !args[3]?.trim()))) fail("usage: --report task2-run-report.json [--output output-directory]");
  const reportPath = path.resolve(args[1]);
  const outputRoot = safeOutputRoot(reportPath, args.length === 4 ? args[3] : undefined);
  return { reportPath, outputRoot };
}
try {
  const result = buildSurfaceMasks(parseArgs(process.argv.slice(2)));
  console.log(`Surface masks frozen: ${path.join(path.dirname(result.combinedOverlay.path), "surface-mask-manifest.json")}`);
  console.log(`SHA-256: ${sha256File(path.join(path.dirname(result.combinedOverlay.path), "surface-mask-manifest.json"))}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
