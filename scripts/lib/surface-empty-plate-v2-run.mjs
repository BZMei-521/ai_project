import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SURFACE_STAGES = Object.freeze(["upper_background", "middle_background", "lower_background", "final_empty_plate"]);
export const SURFACE_SEEDS = Object.freeze({
  upper_background: Object.freeze([71014001, 71014002]),
  middle_background: Object.freeze([72025001, 72025002]),
  lower_background: Object.freeze([73036001, 73036002]),
});

const HEX_SHA256 = /^[a-f0-9]{64}$/i;
const RECONSTRUCTION_STAGES = SURFACE_STAGES.slice(0, 3);

function fail(message) { throw new Error(`Surface empty plate V2 run invariant: ${message}`); }
function clone(value) { return structuredClone(value); }
function equalResource(left, right) { return left.path === right.path && left.size === right.size && left.sha256 === right.sha256; }

function resource(value, label) {
  if (!value || typeof value !== "object") fail(`${label} is required`);
  if (typeof value.path !== "string" || value.path.trim() === "") fail(`${label} path is required`);
  if (!Number.isInteger(value.size) || value.size <= 0) fail(`${label} size must be positive`);
  if (typeof value.sha256 !== "string" || !HEX_SHA256.test(value.sha256)) fail(`${label} sha256 is required`);
  return { ...clone(value), path: path.resolve(value.path), sha256: value.sha256.toLowerCase() };
}

function hashReference(value, label, requiredKey) {
  if (!value || typeof value !== "object") fail(`${label} is required`);
  if (requiredKey && (typeof value[requiredKey] !== "string" || value[requiredKey].trim() === "")) fail(`${label} ${requiredKey} is required`);
  if (typeof value.sha256 !== "string" || !HEX_SHA256.test(value.sha256)) fail(`${label} sha256 is required`);
  return clone({ ...value, sha256: value.sha256.toLowerCase() });
}

function defaultIo(io = {}) {
  return {
    exists: io.exists ?? existsSync,
    stat: io.stat ?? statSync,
    sha256File: io.sha256File ?? sha256File,
    isDecodable: io.isDecodable,
  };
}

function verifyResource(value, label, io, decodable = false) {
  const item = resource(value, label);
  if (!io.exists(item.path)) fail(`${label} is missing: ${item.path}`);
  const stats = io.stat(item.path);
  if (!stats?.isFile?.() || stats.size !== item.size) fail(`${label} size mismatch`);
  if (io.sha256File(item.path).toLowerCase() !== item.sha256) fail(`${label} hash mismatch`);
  if (decodable && (typeof io.isDecodable !== "function" || !io.isDecodable(item.path))) fail(`${label} evidence is not decodable`);
}

function candidateNumber(id) {
  const match = /^candidate_(\d{3})$/.exec(id ?? "");
  return match ? Number(match[1]) : 0;
}

function candidateAt(report, stage, id) {
  const candidate = report.stages[stage]?.find((item) => item.id === id);
  if (!candidate) fail(`candidate ${id} does not exist in ${stage}`);
  return candidate;
}

function invalidated(report, stage, candidateId) {
  return report.invalidations.some((entry) => entry.descendantStage === stage && entry.descendantCandidateId === candidateId);
}

function currentAccepted(report, stage) {
  return report.stages[stage].filter((candidate) => candidate.state === "accepted" && !invalidated(report, stage, candidate.id));
}

function expectedAncestors(report, stage) {
  return SURFACE_STAGES.slice(0, SURFACE_STAGES.indexOf(stage)).map((ancestorStage) => {
    const accepted = currentAccepted(report, ancestorStage);
    if (accepted.length !== 1) fail(`${ancestorStage} must have one current accepted candidate before ${stage}`);
    return { stage: ancestorStage, candidateId: accepted[0].id };
  });
}

function assertAncestorList(ancestors, report, stage) {
  const expectedStages = SURFACE_STAGES.slice(0, SURFACE_STAGES.indexOf(stage));
  if (!Array.isArray(ancestors) || ancestors.length !== expectedStages.length) fail(`${stage} ancestors must record each exact accepted predecessor`);
  for (let index = 0; index < expectedStages.length; index += 1) {
    if (!ancestors[index] || ancestors[index].stage !== expectedStages[index] || typeof ancestors[index].candidateId !== "string") {
      fail(`${stage} ancestors must record each exact accepted predecessor`);
    }
    candidateAt(report, ancestors[index].stage, ancestors[index].candidateId);
  }
}

function assertCurrentAncestorList(ancestors, report, stage, candidateId) {
  if (invalidated(report, stage, candidateId)) return;
  const expected = expectedAncestors(report, stage);
  if (ancestors.length !== expected.length || ancestors.some((ancestor, index) => ancestor.stage !== expected[index].stage || ancestor.candidateId !== expected[index].candidateId)) {
    fail(`${stage} candidate ${candidateId} ancestors must exactly match the current accepted predecessor chain`);
  }
}

function assertCandidate(candidate, stage, report, io) {
  if (!candidate || typeof candidate !== "object" || candidateNumber(candidate.id) === 0) fail(`stage ${stage} candidate id is invalid`);
  const number = candidateNumber(candidate.id);
  const permitted = stage === "final_empty_plate" ? number === 1 : number >= 1 && number <= 2;
  if (!permitted) fail(`stage ${stage} candidate id exceeds its fixed attempt budget`);
  const input = resource(candidate.input, `${stage} candidate input`);
  const immediateAncestor = candidate.ancestors?.at(-1);
  const expectedInput = stage === "upper_background" ? resource(report.source, "source") : immediateAncestor ? candidateAt(report, immediateAncestor.stage, immediateAncestor.candidateId).output : null;
  if (!expectedInput || !equalResource(input, expectedInput)) fail(`${stage} candidate input hash must match the current predecessor/source hash`);
  if (!candidate.masks || typeof candidate.masks !== "object") fail(`${stage} masks are required`);
  for (const key of ["editable", "protected", "overlap"]) resource(candidate.masks[key], `${stage} ${key} mask`);
  if (typeof candidate.prompt !== "string" || candidate.prompt.trim() === "") fail(`${stage} prompt is required`);
  if (typeof candidate.negativePrompt !== "string" || candidate.negativePrompt.trim() === "") fail(`${stage} negative prompt is required`);
  if (RECONSTRUCTION_STAGES.includes(stage)) {
    if (candidate.seed !== SURFACE_SEEDS[stage][number - 1]) fail(`${stage} seed must be fixed at ${SURFACE_SEEDS[stage][number - 1]}`);
  } else if (candidate.seed !== undefined) fail("final_empty_plate must not have a generation seed");
  hashReference(candidate.preset, `${stage} preset`, "path");
  hashReference(candidate.workflow, `${stage} workflow`, "path");
  hashReference(candidate.model, `${stage} model`, "name");
  if (typeof candidate.promptId !== "string" || candidate.promptId.trim() === "") fail(`${stage} promptId is required`);
  resource(candidate.output, `${stage} output`);
  if (!candidate.evidence || typeof candidate.evidence !== "object") fail(`${stage} evidence provenance is required`);
  for (const key of ["comparison", "difference", "maskOverlay"]) resource(candidate.evidence[key], `${stage} ${key} evidence`);
  assertAncestorList(candidate.ancestors, report, stage);
  assertCurrentAncestorList(candidate.ancestors, report, stage, candidate.id);
  if (candidate.state === "technical") {
    if (candidate.technicalAcceptance !== "accepted" || candidate.creativeAcceptance !== "pending" || candidate.reviewHistory?.length !== 0) fail(`${stage} technical candidate cannot auto-accept creatively`);
    return;
  }
  if (candidate.state !== "accepted" && candidate.state !== "rejected") fail(`${stage} candidate state is invalid`);
  if (candidate.technicalAcceptance !== "accepted" || candidate.creativeAcceptance !== candidate.state || !Array.isArray(candidate.reviewHistory) || candidate.reviewHistory.length === 0) fail(`${stage} candidate review history is invalid`);
  const latest = candidate.reviewHistory.at(-1);
  if (!latest || latest.decision !== candidate.state || typeof latest.note !== "string" || latest.note.trim() === "") fail(`${stage} latest review is inconsistent`);
  if (candidate.state === "accepted") {
    const evidence = resource(latest.evidence, `${stage} accepted review evidence`);
    if (!equalResource(evidence, resource(candidate.output, `${stage} output`))) fail(`${stage} accepted review evidence must exactly match output`);
    if (io) verifyResource(evidence, `${stage} accepted review evidence`, io, true);
  } else if (latest.evidence !== undefined) {
    fail(`${stage} rejected review must not require retained evidence`);
  }
}

function assertLegacy(legacy) {
  if (!legacy || typeof legacy !== "object") fail("legacyEvidence is required");
  if (typeof legacy.reportPath !== "string" || legacy.reportPath.trim() === "") fail("legacyEvidence reportPath is required");
  if (typeof legacy.reportSha256 !== "string" || !HEX_SHA256.test(legacy.reportSha256)) fail("legacyEvidence reportSha256 is required");
  if (legacy.stoppedReason !== "empty_plate_max_three_rejected") fail("legacyEvidence stoppedReason must be empty_plate_max_three_rejected");
}

export function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

export function createSurfaceRun(input) {
  if (!input || typeof input !== "object") fail("input is required");
  const source = resource(input.source, "source");
  if (input.source.width !== 1152 || input.source.height !== 640) fail("source geometry must be 1152x640");
  assertLegacy(input.legacyEvidence);
  const report = {
    schema: 1,
    experiment: "surface-aligned-empty-plate-v2",
    source: { ...source, width: 1152, height: 640 },
    legacyEvidence: { ...clone(input.legacyEvidence), reportPath: path.resolve(input.legacyEvidence.reportPath), reportSha256: input.legacyEvidence.reportSha256.toLowerCase() },
    stages: Object.fromEntries(SURFACE_STAGES.map((stage) => [stage, []])),
    overallStatus: "pending",
    invalidations: [],
  };
  assertSurfaceRun(report);
  return report;
}

export function assertSurfaceRun(report, ioOverrides) {
  if (!report || typeof report !== "object") fail("report is required");
  if (report.schema !== 1 || report.experiment !== "surface-aligned-empty-plate-v2") fail("schema or experiment is invalid");
  const source = resource(report.source, "source");
  if (report.source.width !== 1152 || report.source.height !== 640) fail("source geometry must be 1152x640");
  assertLegacy(report.legacyEvidence);
  if (!report.stages || typeof report.stages !== "object" || Object.keys(report.stages).length !== SURFACE_STAGES.length || SURFACE_STAGES.some((stage) => !Array.isArray(report.stages[stage]))) fail("stages must be exactly the ordered surface stages");
  if (!Array.isArray(report.invalidations)) fail("invalidations must be an array");
  const io = ioOverrides ? defaultIo(ioOverrides) : null;
  for (const stage of SURFACE_STAGES) {
    const ids = new Set(report.stages[stage].map((candidate) => candidate?.id));
    if (ids.size !== report.stages[stage].length) fail(`duplicate candidate id in ${stage}`);
    for (const [index, candidate] of report.stages[stage].entries()) {
      const expectedId = `candidate_${String(index + 1).padStart(3, "0")}`;
      if (candidate?.id !== expectedId) fail(`${stage} candidates must be ordered candidate_001 then candidate_002; position ${index + 1} must be ${expectedId}`);
      assertCandidate(candidate, stage, report, io);
    }
    if (currentAccepted(report, stage).length > 1) fail(`${stage} has multiple current accepted candidates`);
  }
  for (const entry of report.invalidations) {
    if (!entry || typeof entry !== "object" || !SURFACE_STAGES.includes(entry.ancestorStage) || !SURFACE_STAGES.includes(entry.descendantStage) || typeof entry.ancestorCandidateId !== "string" || typeof entry.descendantCandidateId !== "string" || SURFACE_STAGES.indexOf(entry.ancestorStage) >= SURFACE_STAGES.indexOf(entry.descendantStage)) fail("invalidation must reference an exact upstream ancestor and downstream candidate");
    const ancestor = candidateAt(report, entry.ancestorStage, entry.ancestorCandidateId);
    if (ancestor.state !== "rejected") fail("invalidation ancestor must reference a rejected candidate");
    const descendant = candidateAt(report, entry.descendantStage, entry.descendantCandidateId);
    if (!descendant.ancestors.some((ancestor) => ancestor.stage === entry.ancestorStage && ancestor.candidateId === entry.ancestorCandidateId)) fail("invalidation must match recorded descendant provenance");
  }
  const finalAccepted = currentAccepted(report, "final_empty_plate").length === 1;
  const prerequisitesAccepted = RECONSTRUCTION_STAGES.every((stage) => currentAccepted(report, stage).length === 1);
  const expectedStatus = finalAccepted && prerequisitesAccepted ? "accepted" : "pending";
  if (report.overallStatus !== expectedStatus) fail(`overall status must be ${expectedStatus}; invalidated or incomplete prerequisites cannot remain accepted`);
  if (io) {
    verifyResource(source, "source", io);
    verifyResource({ path: report.legacyEvidence.reportPath, size: io.stat(path.resolve(report.legacyEvidence.reportPath)).size, sha256: report.legacyEvidence.reportSha256 }, "legacyEvidence report", io);
  }
}

export function appendSurfaceCandidate(report, stage, candidate) {
  assertSurfaceRun(report);
  if (!SURFACE_STAGES.includes(stage)) fail(`unknown stage ${stage}`);
  const existing = report.stages[stage];
  if (currentAccepted(report, stage).length > 0) fail(`${stage} has a current accepted candidate; replacement is forbidden`);
  const maximum = stage === "final_empty_plate" ? 1 : 2;
  if (existing.length >= maximum) fail(`${stage} exhausted candidate_001 and candidate_002 attempts`);
  if (existing.some((item) => item.id === candidate?.id)) fail(`duplicate candidate id ${candidate.id} in ${stage}`);
  const number = candidateNumber(candidate?.id);
  if (number !== existing.length + 1) fail(`${stage} must append candidate_001 then candidate_002 in order`);
  expectedAncestors(report, stage);
  const next = clone(report);
  const normalized = clone(candidate);
  normalized.input = resource(candidate.input, `${stage} candidate input`);
  normalized.masks = Object.fromEntries(["editable", "protected", "overlap"].map((key) => [key, resource(candidate.masks?.[key], `${stage} ${key} mask`)]));
  normalized.output = resource(candidate.output, `${stage} output`);
  normalized.evidence = Object.fromEntries(["comparison", "difference", "maskOverlay"].map((key) => [key, resource(candidate.evidence?.[key], `${stage} ${key} evidence`)]));
  normalized.ancestors = clone(candidate.ancestors ?? expectedAncestors(report, stage));
  normalized.state = "technical";
  normalized.technicalAcceptance = "accepted";
  normalized.creativeAcceptance = "pending";
  normalized.reviewHistory = [];
  next.stages[stage].push(normalized);
  assertSurfaceRun(next);
  return next;
}

export function reviewSurfaceCandidate(report, stage, candidateId, review, ioOverrides) {
  assertSurfaceRun(report);
  if (!SURFACE_STAGES.includes(stage)) fail(`unknown stage ${stage}`);
  if (!review || typeof review !== "object" || (review.decision !== "accepted" && review.decision !== "rejected")) fail("review decision is required");
  const next = clone(report);
  const candidate = candidateAt(next, stage, candidateId);
  if (candidate.state === "rejected") fail(`candidate ${candidateId} has already been rejected`);
  if (invalidated(next, stage, candidateId)) fail(`candidate ${candidateId} is invalidated by an upstream review`);
  if (review.decision === "accepted") {
    expectedAncestors(next, stage);
    if (!review.evidence) fail("accepted review requires evidence");
    const evidence = resource(review.evidence, "review evidence");
    if (!equalResource(evidence, resource(candidate.output, `${stage} output`))) fail("review evidence must exactly match the stored output");
    verifyResource(evidence, "review evidence", defaultIo(ioOverrides), true);
  }
  if (typeof review.note !== "string" || review.note.trim() === "") fail("review note is required");
  candidate.state = review.decision;
  candidate.creativeAcceptance = review.decision;
  candidate.reviewHistory.push(review.decision === "accepted"
    ? { decision: "accepted", note: review.note.trim(), evidence: resource(review.evidence, "review evidence") }
    : { decision: "rejected", note: review.note.trim() });
  if (review.decision === "rejected") {
    for (const descendantStage of SURFACE_STAGES.slice(SURFACE_STAGES.indexOf(stage) + 1)) {
      for (const descendant of next.stages[descendantStage]) {
        if (descendant.ancestors.some((ancestor) => ancestor.stage === stage && ancestor.candidateId === candidateId) && !invalidated(next, descendantStage, descendant.id)) {
          next.invalidations.push({ ancestorStage: stage, ancestorCandidateId: candidateId, descendantStage, descendantCandidateId: descendant.id, reason: `upstream ${stage}/${candidateId} was rejected` });
        }
      }
    }
  }
  next.overallStatus = "pending";
  if (stage === "final_empty_plate" && review.decision === "accepted" && RECONSTRUCTION_STAGES.every((item) => currentAccepted(next, item).length === 1)) next.overallStatus = "accepted";
  assertSurfaceRun(next);
  return next;
}

export function writeSurfaceReportAtomic(reportPath, report) {
  assertSurfaceRun(report);
  const destination = path.resolve(reportPath);
  const directory = path.dirname(destination);
  mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, destination);
  } catch (error) {
    if (existsSync(temporary)) {
      try { unlinkSync(temporary); } catch { /* retain original failure */ }
    }
    throw error;
  }
}
