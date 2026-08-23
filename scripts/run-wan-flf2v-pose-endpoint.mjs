import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ENDPOINT_SEEDS } from "./lib/wan-flf2v-experiment.mjs";
import { runEndpointCandidate } from "./run-wan-flf2v-endpoint.mjs";

const EXPERIMENT_ROOT = resolve("logs/video-quality-one-take-flf2v-pose");
const REPORT_PATH = resolve(EXPERIMENT_ROOT, "wan-flf2v-report.json");

export function parsePoseEndpointArguments(args) {
  if (args.length !== 2 || args[0] !== "--candidate") throw new Error("usage: --candidate 1|2|3");
  const candidate = Number(args[1]);
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > ENDPOINT_SEEDS.length) throw new Error(`candidate must be 1..${ENDPOINT_SEEDS.length}`);
  return { candidate };
}

async function main() {
  const parsed = parsePoseEndpointArguments(process.argv.slice(2));
  const result = await runEndpointCandidate({ ...parsed, reportPath: REPORT_PATH, experimentRoot: EXPERIMENT_ROOT, poseGuided: true });
  process.stdout.write(`${JSON.stringify({ reportPath: result.reportPath, candidate: result.candidate }, null, 2)}\n`);
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invoked === import.meta.url) main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
