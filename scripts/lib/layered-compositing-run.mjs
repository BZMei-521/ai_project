import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SCHEMA_VERSION = 1;
export const SOURCE_GEOMETRY = Object.freeze({ width: 1152, height: 640 });
export const STAGE_NAMES = Object.freeze([
  "empty_plate",
  "shen_yan",
  "jiang_lan",
  "shen_yan_matte",
  "jiang_lan_matte",
  "composite",
  "final",
]);

const STATES = new Set(["pending", "technical", "accepted", "rejected"]);
const HEX_SHA256 = /^[a-f0-9]{64}$/i;
const CHARACTER_KEYS = Object.freeze(["shen_yan", "jiang_lan"]);
const LIGHTING = Object.freeze({
  key: "warm sunset from screen-right/rear",
  fill: "soft fill from screen-left/front",
  shadow: "screen-left/front",
});

function fail(message) {
  throw new Error(`Layered compositing run invariant: ${message}`);
}

function clone(value) {
  return structuredClone(value);
}

function normalizeResource(resource, label) {
  if (!resource || typeof resource !== "object") fail(`${label} resource is required`);
  if (typeof resource.path !== "string" || resource.path.length === 0) fail(`${label} resource path is required`);
  if (!Number.isInteger(resource.size) || resource.size <= 0) fail(`${label} resource size must be positive`);
  if (typeof resource.sha256 !== "string" || !HEX_SHA256.test(resource.sha256)) fail(`${label} resource sha256 is required`);
  return { ...clone(resource), path: path.resolve(resource.path), sha256: resource.sha256.toLowerCase() };
}

function normalizeCharacter(character, key) {
  if (!character || typeof character !== "object") fail(`${key} character package is required`);
  if (typeof character.name !== "string" || character.name.trim().length === 0) fail(`${key} character name is required`);
  if (character.species !== "human") fail(`${key} species must be human`);
  const next = clone(character);
  next.faceMaster = normalizeResource(character.faceMaster, `${key} face`);
  next.bodyFront = normalizeResource(character.bodyFront, `${key} body`);
  for (const property of ["structureFront", "structureSide", "structureBack", "side", "back"]) {
    if (character[property] !== undefined) next[property] = normalizeResource(character[property], `${key} ${property}`);
  }
  return next;
}

function normalizeArtifact(artifact, label = "candidate artifact") {
  return normalizeResource(artifact, label);
}

function defaultIo(io = {}) {
  return {
    exists: io.exists ?? existsSync,
    stat: io.stat ?? statSync,
    sha256File: io.sha256File ?? sha256File,
    isDecodable: io.isDecodable,
  };
}

function verifyStoredResource(resource, label, io, { decodable = false } = {}) {
  const resolved = path.resolve(resource.path);
  if (!io.exists(resolved)) fail(`${label} artifact is missing: ${resolved}`);
  const stats = io.stat(resolved);
  if (!stats?.isFile?.() || stats.size <= 0) fail(`${label} artifact is not a nonempty file: ${resolved}`);
  if (stats.size !== resource.size) fail(`${label} artifact size mismatch`);
  if (io.sha256File(resolved).toLowerCase() !== resource.sha256) fail(`${label} artifact hash mismatch`);
  if (decodable && (typeof io.isDecodable !== "function" || !io.isDecodable(resolved))) fail(`${label} evidence is not decodable`);
}

function findCandidate(report, stage, id) {
  const candidates = report.stages?.[stage]?.candidates;
  if (!Array.isArray(candidates)) fail(`unknown stage ${stage}`);
  const candidate = candidates.find((item) => item.id === id);
  if (!candidate) fail(`candidate ${id} does not exist in ${stage}`);
  return candidate;
}

function assertReview(review) {
  if (!review || typeof review !== "object") fail("review is required");
  if (review.decision !== "accepted" && review.decision !== "rejected") fail("review decision must be accepted or rejected");
  if (typeof review.note !== "string" || review.note.trim().length === 0) fail("review note is required");
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object") fail(`${label} is required`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(`${label} keys must be exactly ${wanted.join(", ")}`);
}

function assertLighting(lighting) {
  assertExactKeys(lighting, Object.keys(LIGHTING), "lighting");
  for (const [key, value] of Object.entries(LIGHTING)) {
    if (lighting[key] !== value) fail(`lighting ${key} must be ${value}`);
  }
}

function assertCandidateState(candidate, stage, io) {
  normalizeArtifact(candidate.artifact);
  if (!STATES.has(candidate.state) || candidate.state === "pending") fail(`stage ${stage} candidate state is invalid`);
  if (candidate.state === "technical") {
    if (candidate.technicalAcceptance !== "accepted" || candidate.creativeAcceptance !== "pending" || candidate.review !== undefined) fail(`technical candidate ${candidate.id} has invalid review state`);
    return;
  }
  if (!candidate.review || candidate.review.decision !== candidate.state || typeof candidate.review.note !== "string" || candidate.review.note.trim().length === 0) fail(`review for candidate ${candidate.id} is inconsistent with its state`);
  if (candidate.creativeAcceptance !== candidate.state) fail(`creative acceptance for candidate ${candidate.id} is inconsistent with its state`);
  if (candidate.technicalAcceptance !== "accepted") fail(`technical acceptance for candidate ${candidate.id} is invalid`);
  if (candidate.state === "accepted") {
    const evidence = normalizeArtifact(candidate.review.evidence, "accepted review evidence");
    if (evidence.path !== candidate.artifact.path || evidence.size !== candidate.artifact.size || evidence.sha256 !== candidate.artifact.sha256) fail(`accepted review evidence must match candidate ${candidate.id} artifact`);
    if (io) verifyStoredResource(evidence, "accepted review evidence", io, { decodable: true });
  } else if (candidate.review.evidence !== undefined) {
    fail(`rejected review for candidate ${candidate.id} must not retain evidence`);
  }
}

export function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

export function createRunReport(input) {
  if (!input || typeof input !== "object") fail("input is required");
  const source = normalizeResource(input.source, "source");
  if (input.source.width !== SOURCE_GEOMETRY.width || input.source.height !== SOURCE_GEOMETRY.height) {
    fail(`source geometry must be ${SOURCE_GEOMETRY.width}x${SOURCE_GEOMETRY.height}`);
  }
  const characters = input.characters;
  assertExactKeys(characters, CHARACTER_KEYS, "characters");
  assertLighting(input.lighting);
  const report = {
    schemaVersion: SCHEMA_VERSION,
    overallStatus: "pending",
    source: { ...source, width: SOURCE_GEOMETRY.width, height: SOURCE_GEOMETRY.height },
    characters: {
      shen_yan: normalizeCharacter(characters.shen_yan, "shen_yan"),
      jiang_lan: normalizeCharacter(characters.jiang_lan, "jiang_lan"),
    },
    lighting: clone(input.lighting),
    stages: Object.fromEntries(STAGE_NAMES.map((stage) => [stage, { candidates: [] }])),
  };
  assertRunInvariant(report);
  return report;
}

export function assertRunInvariant(report, ioOverrides) {
  if (!report || typeof report !== "object") fail("report is required");
  if (report.schemaVersion !== SCHEMA_VERSION) fail(`schema version must be ${SCHEMA_VERSION}`);
  if (report.overallStatus !== "pending") fail("overall status must remain pending until a later final-review API is added");
  const source = normalizeResource(report.source, "source");
  if (report.source.width !== SOURCE_GEOMETRY.width || report.source.height !== SOURCE_GEOMETRY.height) fail(`source geometry must be ${SOURCE_GEOMETRY.width}x${SOURCE_GEOMETRY.height}`);
  assertExactKeys(report.characters, CHARACTER_KEYS, "characters");
  normalizeCharacter(report.characters.shen_yan, "shen_yan");
  normalizeCharacter(report.characters.jiang_lan, "jiang_lan");
  assertLighting(report.lighting);
  assertExactKeys(report.stages, STAGE_NAMES, "stages");
  const io = ioOverrides ? defaultIo(ioOverrides) : null;
  for (const stage of STAGE_NAMES) {
    const candidates = report.stages?.[stage]?.candidates;
    if (!Array.isArray(candidates)) fail(`stage ${stage} candidates are required`);
    const ids = new Set();
    for (const candidate of candidates) {
      if (!candidate || typeof candidate.id !== "string" || candidate.id.length === 0) fail(`stage ${stage} candidate id is required`);
      if (ids.has(candidate.id)) fail(`duplicate candidate id ${candidate.id} in ${stage}`);
      ids.add(candidate.id);
      assertCandidateState(candidate, stage, io);
    }
  }
  if (ioOverrides) {
    verifyStoredResource(source, "source", io);
    for (const [key, character] of Object.entries(report.characters)) {
      verifyStoredResource(character.faceMaster, `${key} face`, io);
      verifyStoredResource(character.bodyFront, `${key} body`, io);
    }
  }
}

export function appendCandidate(report, stage, candidate) {
  assertRunInvariant(report);
  if (!STAGE_NAMES.includes(stage)) fail(`unknown stage ${stage}`);
  if (!candidate || typeof candidate.id !== "string" || candidate.id.trim().length === 0) fail("candidate id is required");
  const artifact = normalizeArtifact(candidate.artifact);
  const next = clone(report);
  const list = next.stages[stage].candidates;
  if (list.some((item) => item.id === candidate.id)) fail(`candidate id already exists in ${stage}`);
  list.push({ ...clone(candidate), id: candidate.id, artifact, state: "technical", technicalAcceptance: "accepted", creativeAcceptance: "pending" });
  assertRunInvariant(next);
  return next;
}

export function reviewCandidate(report, stage, id, review, ioOverrides) {
  assertRunInvariant(report);
  assertReview(review);
  const next = clone(report);
  const candidate = findCandidate(next, stage, id);
  if (candidate.state !== "technical") fail(`candidate ${id} has already been reviewed`);
  if (review.decision === "accepted") {
    if (!review.evidence) fail("accepted review requires evidence");
    const evidence = normalizeArtifact(review.evidence, "review evidence");
    if (evidence.path !== candidate.artifact.path || evidence.size !== candidate.artifact.size || evidence.sha256 !== candidate.artifact.sha256) {
      fail("review evidence hash must match the stored candidate artifact");
    }
    verifyStoredResource(evidence, "review evidence", defaultIo(ioOverrides), { decodable: true });
    candidate.state = "accepted";
    candidate.creativeAcceptance = "accepted";
    candidate.review = { decision: "accepted", note: review.note.trim(), evidence };
  } else {
    candidate.state = "rejected";
    candidate.creativeAcceptance = "rejected";
    candidate.review = { decision: "rejected", note: review.note.trim() };
  }
  assertRunInvariant(next);
  return next;
}

export function writeJsonAtomic(filePath, value) {
  const destination = path.resolve(filePath);
  const directory = path.dirname(destination);
  mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, destination);
  } catch (error) {
    if (existsSync(temporary)) {
      try { unlinkSync(temporary); } catch { /* preserve original error */ }
    }
    throw error;
  }
}
