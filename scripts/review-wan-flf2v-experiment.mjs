import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  EXPERIMENT_ROOT,
  applyEndpointReview,
  applyVideoReview,
  assertAuthoritativeUnchanged
} from "./lib/wan-flf2v-experiment.mjs";

const REQUIRED_FLAGS = new Set(["--endpoint-candidate", "--video-candidate", "--decision", "--note", "--evidence", "--report"]);

function parseArguments(argumentsList) {
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!REQUIRED_FLAGS.has(flag) || value === undefined || values.has(flag)) {
      throw new Error("usage: --endpoint-candidate N | --video-candidate N --decision accepted|rejected --note TEXT --evidence PATH [--report PATH]");
    }
    values.set(flag, value);
  }
  const endpointCandidate = values.get("--endpoint-candidate");
  const videoCandidate = values.get("--video-candidate");
  if ((endpointCandidate === undefined) === (videoCandidate === undefined)) {
    throw new Error("provide exactly one of --endpoint-candidate N or --video-candidate N");
  }
  if (!["accepted", "rejected"].includes(values.get("--decision")) || !values.get("--note") || !values.get("--evidence")) {
    throw new Error("--decision accepted|rejected, --note, and --evidence are required");
  }
  const candidate = Number(endpointCandidate ?? videoCandidate);
  if (!Number.isInteger(candidate)) throw new Error("candidate must be an integer");
  return {
    type: endpointCandidate === undefined ? "video" : "endpoint",
    candidate,
    decision: values.get("--decision"),
    note: values.get("--note"),
    evidencePath: resolve(values.get("--evidence")),
    reportPath: resolve(values.get("--report") || `${EXPERIMENT_ROOT}/wan-flf2v-report.json`)
  };
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertExisting(path, label) {
  if (!existsSync(path) || statSync(path).size <= 0) throw new Error(`${label} does not exist or is empty: ${path}`);
}

function runDecoder(path, label) {
  const result = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-frames:v", "1", "-f", "null", "-"], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(`${label} is not decodable: ${path}: ${result.stderr}`);
}

function assertImage(path, expectedHash, label) {
  assertExisting(path, label);
  if (sha256File(path) !== expectedHash) throw new Error(`${label} hash does not match the stored candidate hash: ${path}`);
  runDecoder(path, label);
}

function assertVideo(path, expectedHash, label) {
  assertExisting(path, label);
  if (sha256File(path) !== expectedHash) throw new Error(`${label} hash does not match the stored candidate hash: ${path}`);
  runDecoder(path, label);
}

function validateCandidate(report, parsed) {
  const candidates = parsed.type === "endpoint" ? report.endpointCandidates : report.videoCandidates;
  const candidate = candidates.find((item) => item.candidate === parsed.candidate);
  if (!candidate) throw new Error(`${parsed.type} candidate ${parsed.candidate} is missing from report`);
  assertImage(parsed.evidencePath, candidate.evidenceSha256, "review evidence");
  if (parsed.type === "endpoint") {
    assertImage(candidate.compositePath, candidate.compositeSha256, "endpoint composite");
    assertImage(candidate.endpointPath, candidate.endpointSha256, "endpoint image");
  } else {
    assertVideo(candidate.videoPath, candidate.videoSha256, "candidate video");
  }
  return candidate;
}

const artifactValidators = {
  existsFile: (path) => existsSync(path) && statSync(path).size > 0,
  hashFile: sha256File,
  readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
  assertDecodableImage: (path) => runDecoder(path, "image artifact"),
  assertDecodableVideo: (path) => runDecoder(path, "video artifact")
};

const parsed = parseArguments(process.argv.slice(2));
if (!existsSync(parsed.reportPath)) throw new Error(`experiment report does not exist: ${parsed.reportPath}`);
const report = JSON.parse(readFileSync(parsed.reportPath, "utf8"));
validateCandidate(report, parsed);
const review = {
  candidate: parsed.candidate,
  decision: parsed.decision,
  note: parsed.note,
  evidencePath: parsed.evidencePath,
  evidenceSha256: sha256File(parsed.evidencePath),
  reviewedAt: new Date().toISOString()
};
const updated = parsed.type === "endpoint"
  ? applyEndpointReview(report, review, artifactValidators)
  : applyVideoReview(report, review, artifactValidators);
const temporaryPath = `${parsed.reportPath}.tmp`;
assertAuthoritativeUnchanged(updated, sha256File);
writeFileSync(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
renameSync(temporaryPath, parsed.reportPath);
console.log(`${parsed.type} candidate ${parsed.candidate} creative review: ${parsed.decision}`);
