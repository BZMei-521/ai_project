import path from "node:path";
import { pathToFileURL } from "node:url";
import { createSurfaceEvictedCaptureAttestation } from "./lib/surface-empty-plate-v2-comfy.mjs";

const FLAGS = ["--report", "--stage", "--candidate", "--canonical-output", "--history-observed-at", "--queue-observed-at", "--decision", "--note", "--date"];
function fail(message) { throw new Error(`Surface evicted capture attestation CLI: ${message}`); }

export function parseAttestationArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== FLAGS.length * 2) fail(`expected exactly ${FLAGS.join(" ")}`);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) { const flag = argv[index]; const value = argv[index + 1]; if (!FLAGS.includes(flag) || Object.hasOwn(values, flag) || typeof value !== "string" || !value) fail("unknown, duplicate, missing, or empty argument"); values[flag] = value; }
  if (Object.keys(values).length !== FLAGS.length || !["upper_background", "middle_background", "lower_background"].includes(values["--stage"]) || !["1", "2"].includes(values["--candidate"]) || values["--decision"] !== "accepted" || !/^\d{4}-\d{2}-\d{2}$/.test(values["--date"])) fail("stage/candidate/decision/date is invalid");
  const historyObservedAt = Number(values["--history-observed-at"]); const queueObservedAt = Number(values["--queue-observed-at"]); if (!Number.isSafeInteger(historyObservedAt) || historyObservedAt < 0 || !Number.isSafeInteger(queueObservedAt) || queueObservedAt < 0 || String(historyObservedAt) !== values["--history-observed-at"] || String(queueObservedAt) !== values["--queue-observed-at"]) fail("observation timestamps must be canonical nonnegative safe integers");
  return { reportPath: path.resolve(values["--report"]), stage: values["--stage"], candidate: values["--candidate"], canonicalOutputPath: path.resolve(values["--canonical-output"]), historyEvicted: { status: "absent", observedAt: historyObservedAt }, queueObserved: { running: 0, pending: 0, observedAt: queueObservedAt }, humanReview: { decision: "accepted", note: values["--note"], date: values["--date"] } };
}

async function main() { const result = createSurfaceEvictedCaptureAttestation(parseAttestationArguments(process.argv.slice(2))); console.log(JSON.stringify(result.resource, null, 2)); }
if ((process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "") === import.meta.url) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
