import path from "node:path";
import { pathToFileURL } from "node:url";
import { generateSurfaceStage } from "./lib/surface-empty-plate-v2-comfy.mjs";

const STAGES = new Set(["upper_background", "middle_background", "lower_background"]);
const CANDIDATES = new Set(["1", "2"]);
const ATTEMPT_ID = /^\d{13}-[1-9]\d*-[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HEX_SHA256 = /^[a-f0-9]{64}$/i;

function fail(message) { throw new Error(`Surface empty plate V2 CLI: ${message}`); }

export function parseArguments(argv) {
  if (!Array.isArray(argv) || ![6, 8, 14].includes(argv.length)) fail("expected stage arguments with one optional complete recovery identity");
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!["--report", "--stage", "--candidate", "--legacy-capture-attempt-id", "--legacy-capture-prompt-id", "--legacy-raw-size", "--legacy-raw-sha256", "--evicted-attestation"].includes(flag) || Object.hasOwn(values, flag) || typeof value !== "string" || !value) fail("unknown, duplicate, missing, or empty argument");
    values[flag] = value;
  }
  if (![3, 4, 7].includes(Object.keys(values).length) || !STAGES.has(values["--stage"]) || !CANDIDATES.has(values["--candidate"])) fail("stage/candidate lexical value is invalid");
  const result = { reportPath: path.resolve(values["--report"]), stage: values["--stage"], candidate: values["--candidate"] }; if (Object.keys(values).length === 7) { const attemptId = values["--legacy-capture-attempt-id"]; const promptId = values["--legacy-capture-prompt-id"]; const rawSizeText = values["--legacy-raw-size"]; const rawSha256 = values["--legacy-raw-sha256"]; if (!ATTEMPT_ID.test(attemptId) || !/^[A-Za-z0-9._-]+$/.test(promptId) || !/^[1-9]\d*$/.test(rawSizeText) || !HEX_SHA256.test(rawSha256)) fail("legacy capture migration lexical value is invalid"); const rawSize = Number(rawSizeText); if (!Number.isSafeInteger(rawSize)) fail("legacy capture raw size is invalid"); result.legacyCaptureMigration = { attemptId, promptId, rawSize, rawSha256: rawSha256.toLowerCase() }; }
  if (Object.keys(values).length === 4) { if (!Object.hasOwn(values, "--evicted-attestation")) fail("partial recovery argument identity is invalid"); result.evictedAttestationPath = path.resolve(values["--evicted-attestation"]); }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await generateSurfaceStage(parseArguments(process.argv.slice(2)));
  console.log(`${result.candidate.id} ${result.candidate.output.path}`);
}
