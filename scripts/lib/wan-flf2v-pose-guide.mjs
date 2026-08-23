import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const BASE_WIDTH = 1152;
const BASE_HEIGHT = 640;
const KEYPOINT_COUNT = 18;
const CONFIDENCE_MINIMUM = 0.5;
const LEGS = Object.freeze([
  Object.freeze({ hip: 9, knee: 10, ankle: 11 }),
  Object.freeze({ hip: 12, knee: 13, ankle: 14 })
]);
const DEFAULT_DELTA = Object.freeze({
  hip: Object.freeze({ x: -4, y: 0 }),
  knee: Object.freeze({ x: -14, y: -1 }),
  ankle: Object.freeze({ x: -30, y: -2 })
});
const EDGES = Object.freeze([
  [0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7],
  [1, 8], [8, 9], [9, 10], [10, 11], [8, 12], [12, 13], [13, 14],
  [0, 15], [15, 17], [0, 16]
]);

function fail(message) {
  throw new Error(`pose_contract: ${message}`);
}

function canonicalNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be finite`);
  return value;
}

function keypoints(person) {
  return person.pose_keypoints_2d;
}

function point(person, index) {
  const values = keypoints(person);
  return { x: values[index * 3], y: values[index * 3 + 1], confidence: values[index * 3 + 2] };
}

function requirePoint(person, index, label) {
  const value = point(person, index);
  if (value.confidence < CONFIDENCE_MINIMUM) fail(`${label} confidence must be at least ${CONFIDENCE_MINIMUM}`);
  return value;
}

function pelvisX(person, label) {
  const first = requirePoint(person, LEGS[0].hip, `${label} first hip`);
  const second = requirePoint(person, LEGS[1].hip, `${label} second hip`);
  return (first.x + second.x) / 2;
}

function identifyCharacters(document) {
  if (document.people.length !== 2) fail("exactly two people are required");
  const centroids = document.people.map((person, index) => pelvisX(person, `person ${index}`));
  if (Math.abs(centroids[0] - centroids[1]) < 40 * (document.canvas_width / BASE_WIDTH)) fail("character pelvis centroids are ambiguous");
  const shenPersonIndex = centroids[0] < centroids[1] ? 0 : 1;
  return { shenPersonIndex, jiangPersonIndex: shenPersonIndex === 0 ? 1 : 0 };
}

function selectScreenLeftLeg(document, shenPersonIndex) {
  const person = document.people[shenPersonIndex];
  for (const [index, leg] of LEGS.entries()) {
    requirePoint(person, leg.hip, `leg ${index} hip`);
    requirePoint(person, leg.knee, `leg ${index} knee`);
    requirePoint(person, leg.ankle, `leg ${index} ankle`);
  }
  const first = point(person, LEGS[0].ankle);
  const second = point(person, LEGS[1].ankle);
  if (Math.abs(first.x - second.x) < 8 * (document.canvas_width / BASE_WIDTH)) fail("ankle ownership is ambiguous");
  return first.x < second.x ? LEGS[0] : LEGS[1];
}

function scaledDefaultDelta(document) {
  const sx = document.canvas_width / BASE_WIDTH;
  const sy = document.canvas_height / BASE_HEIGHT;
  return {
    hip: { x: DEFAULT_DELTA.hip.x * sx, y: DEFAULT_DELTA.hip.y * sy },
    knee: { x: DEFAULT_DELTA.knee.x * sx, y: DEFAULT_DELTA.knee.y * sy },
    ankle: { x: DEFAULT_DELTA.ankle.x * sx, y: DEFAULT_DELTA.ankle.y * sy }
  };
}

function normalizeDelta(delta) {
  const value = structuredClone(delta);
  for (const joint of ["hip", "knee", "ankle"]) {
    if (!value?.[joint] || typeof value[joint] !== "object") fail(`${joint} delta is required`);
    canonicalNumber(value[joint].x, `${joint}.x`);
    canonicalNumber(value[joint].y, `${joint}.y`);
  }
  return value;
}

function scalarDelta(source, target, personIndex, pointIndex) {
  const before = keypoints(source.people[personIndex]);
  const after = keypoints(target.people[personIndex]);
  return { x: after[pointIndex * 3] - before[pointIndex * 3], y: after[pointIndex * 3 + 1] - before[pointIndex * 3 + 1] };
}

function equalNumber(actual, expected, label) {
  if (Math.abs(actual - expected) > 1e-9) fail(`${label} changed outside the approved motion`);
}

function validateMotionBounds(document, delta) {
  const sx = document.canvas_width / BASE_WIDTH;
  const sy = document.canvas_height / BASE_HEIGHT;
  const ankleMagnitude = -delta.ankle.x;
  const kneeMagnitude = -delta.knee.x;
  if (ankleMagnitude < 24 * sx || ankleMagnitude > 36 * sx) fail("ankle forward delta must be 24 to 36px at 1152px width");
  if (kneeMagnitude < 10 * sx || kneeMagnitude > 18 * sx) fail("knee forward delta must be 10 to 18px at 1152px width");
  if (delta.hip.x > 0 || Math.abs(delta.hip.x) > 6 * sx) fail("hip forward delta must not exceed 6px at 1152px width");
  if (Math.abs(delta.ankle.y) > 4 * sy) fail("ground-contact vertical error must not exceed 4px at 640px height");
}

export function parseDWPoseJson(value) {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { fail("DWPose JSON is invalid"); }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("DWPose document must be an object");
  if (!Number.isInteger(parsed.canvas_width) || parsed.canvas_width <= 0) fail("canvas_width must be a positive integer");
  if (!Number.isInteger(parsed.canvas_height) || parsed.canvas_height <= 0) fail("canvas_height must be a positive integer");
  if (!Array.isArray(parsed.people)) fail("people must be an array");
  for (const [personIndex, person] of parsed.people.entries()) {
    if (!person || typeof person !== "object" || Array.isArray(person)) fail(`person ${personIndex} must be an object`);
    if (!Array.isArray(person.pose_keypoints_2d) || person.pose_keypoints_2d.length !== KEYPOINT_COUNT * 3) fail(`person ${personIndex} pose keypoints must contain 18 triplets`);
    person.pose_keypoints_2d.forEach((number, scalar) => canonicalNumber(number, `person ${personIndex} keypoint scalar ${scalar}`));
  }
  return structuredClone(parsed);
}

export function assertHalfStepTarget(sourceValue, targetValue, motion) {
  const source = parseDWPoseJson(sourceValue);
  const target = parseDWPoseJson(targetValue);
  if (target.canvas_width !== source.canvas_width || target.canvas_height !== source.canvas_height) fail("target canvas changed");
  if (target.people.length !== source.people.length) fail("target people count changed");
  const { shenPersonIndex } = identifyCharacters(source);
  const leg = selectScreenLeftLeg(source, shenPersonIndex);
  if (motion?.shenPersonIndex !== shenPersonIndex || motion?.selectedLeg !== "screen-left") fail("motion character or selected leg mismatch");
  if (motion.hipIndex !== leg.hip || motion.kneeIndex !== leg.knee || motion.ankleIndex !== leg.ankle) fail("motion joint indices mismatch");
  const actualDelta = {
    hip: scalarDelta(source, target, shenPersonIndex, leg.hip),
    knee: scalarDelta(source, target, shenPersonIndex, leg.knee),
    ankle: scalarDelta(source, target, shenPersonIndex, leg.ankle)
  };
  validateMotionBounds(source, actualDelta);
  const declaredDelta = normalizeDelta(motion.delta);
  for (const joint of ["hip", "knee", "ankle"]) {
    equalNumber(actualDelta[joint].x, declaredDelta[joint].x, `${joint}.x`);
    equalNumber(actualDelta[joint].y, declaredDelta[joint].y, `${joint}.y`);
  }
  for (let personIndex = 0; personIndex < source.people.length; personIndex += 1) {
    const before = keypoints(source.people[personIndex]);
    const after = keypoints(target.people[personIndex]);
    for (let scalar = 0; scalar < before.length; scalar += 1) {
      const pointIndex = Math.floor(scalar / 3);
      const coordinate = scalar % 3;
      const approvedCoordinate = personIndex === shenPersonIndex && [leg.hip, leg.knee, leg.ankle].includes(pointIndex) && coordinate !== 2;
      if (!approvedCoordinate && after[scalar] !== before[scalar]) fail(`locked scalar changed for person ${personIndex}, point ${pointIndex}`);
    }
  }
  return true;
}

export function buildHalfStepTarget(sourceValue, options = {}) {
  const source = parseDWPoseJson(sourceValue);
  const { shenPersonIndex } = identifyCharacters(source);
  const leg = selectScreenLeftLeg(source, shenPersonIndex);
  const delta = normalizeDelta(options.delta ?? scaledDefaultDelta(source));
  validateMotionBounds(source, delta);
  const target = structuredClone(source);
  for (const [joint, pointIndex] of [["hip", leg.hip], ["knee", leg.knee], ["ankle", leg.ankle]]) {
    target.people[shenPersonIndex].pose_keypoints_2d[pointIndex * 3] += delta[joint].x;
    target.people[shenPersonIndex].pose_keypoints_2d[pointIndex * 3 + 1] += delta[joint].y;
  }
  const motion = {
    shenPersonIndex,
    selectedLeg: "screen-left",
    hipIndex: leg.hip,
    kneeIndex: leg.knee,
    ankleIndex: leg.ankle,
    delta
  };
  assertHalfStepTarget(source, target, motion);
  return { source, target, motion };
}

function inferMotion(source, target) {
  const { shenPersonIndex } = identifyCharacters(source);
  const leg = selectScreenLeftLeg(source, shenPersonIndex);
  const motion = {
    shenPersonIndex,
    selectedLeg: "screen-left",
    hipIndex: leg.hip,
    kneeIndex: leg.knee,
    ankleIndex: leg.ankle,
    delta: {
      hip: scalarDelta(source, target, shenPersonIndex, leg.hip),
      knee: scalarDelta(source, target, shenPersonIndex, leg.knee),
      ankle: scalarDelta(source, target, shenPersonIndex, leg.ankle)
    }
  };
  assertHalfStepTarget(source, target, motion);
  return motion;
}

function setPixel(buffer, width, height, x, y, color) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= width || iy >= height) return;
  const offset = (iy * width + ix) * 3;
  buffer[offset] = color[0];
  buffer[offset + 1] = color[1];
  buffer[offset + 2] = color[2];
}

function drawCircle(buffer, width, height, cx, cy, radius, color) {
  for (let y = -radius; y <= radius; y += 1) for (let x = -radius; x <= radius; x += 1) {
    if (x * x + y * y <= radius * radius) setPixel(buffer, width, height, cx + x, cy + y, color);
  }
}

function drawLine(buffer, width, height, first, second, color) {
  let x0 = Math.round(first.x); let y0 = Math.round(first.y);
  const x1 = Math.round(second.x); const y1 = Math.round(second.y);
  const dx = Math.abs(x1 - x0); const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0); const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    drawCircle(buffer, width, height, x0, y0, 2, color);
    if (x0 === x1 && y0 === y1) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x0 += sx; }
    if (twice <= dx) { error += dx; y0 += sy; }
  }
}

function runFfmpeg(args, label) {
  const result = spawnSync("ffmpeg", ["-y", "-v", "error", ...args], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) fail(`${label} failed: ${result.stderr || result.stdout}`);
}

export function renderPoseGuide(poseValue, outputPath) {
  const pose = parseDWPoseJson(poseValue);
  const absoluteOutput = resolve(outputPath);
  mkdirSync(dirname(absoluteOutput), { recursive: true });
  const pixels = Buffer.alloc(pose.canvas_width * pose.canvas_height * 3, 0);
  const colors = [[255, 255, 255], [0, 220, 255]];
  for (const [personIndex, person] of pose.people.entries()) {
    const color = colors[personIndex % colors.length];
    for (const [firstIndex, secondIndex] of EDGES) {
      const first = point(person, firstIndex); const second = point(person, secondIndex);
      if (first.confidence >= CONFIDENCE_MINIMUM && second.confidence >= CONFIDENCE_MINIMUM) drawLine(pixels, pose.canvas_width, pose.canvas_height, first, second, color);
    }
    for (let index = 0; index < KEYPOINT_COUNT; index += 1) {
      const value = point(person, index);
      if (value.confidence >= CONFIDENCE_MINIMUM) drawCircle(pixels, pose.canvas_width, pose.canvas_height, value.x, value.y, 4, color);
    }
  }
  const ppmPath = `${absoluteOutput}.ppm.${randomUUID()}`;
  try {
    writeFileSync(ppmPath, Buffer.concat([Buffer.from(`P6\n${pose.canvas_width} ${pose.canvas_height}\n255\n`, "ascii"), pixels]));
    runFfmpeg(["-i", ppmPath, "-frames:v", "1", "-c:v", "png", "-pred", "mixed", "-compression_level", "9", "-threads", "1", absoluteOutput], "pose PNG encode");
  } finally {
    rmSync(ppmPath, { force: true });
  }
  return absoluteOutput;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

export function writePoseEvidence({ source: sourceValue, target: targetValue, outputDir, motion: declaredMotion } = {}) {
  const source = parseDWPoseJson(sourceValue);
  const target = parseDWPoseJson(targetValue);
  const motion = declaredMotion ?? inferMotion(source, target);
  assertHalfStepTarget(source, target, motion);
  const root = resolve(outputDir);
  mkdirSync(root, { recursive: true });
  const sourcePosePath = writeJson(join(root, "source_pose.json"), source);
  const targetPosePath = writeJson(join(root, "target_pose.json"), target);
  const poseGuidePath = renderPoseGuide(target, join(root, "target_pose.png"));
  const sourcePreview = join(root, `.source_pose.${randomUUID()}.png`);
  const poseDiagnosticPath = join(root, "pose_diagnostic.png");
  try {
    renderPoseGuide(source, sourcePreview);
    runFfmpeg(["-i", sourcePreview, "-i", poseGuidePath, "-filter_complex", "[0:v][1:v]hstack=inputs=2[out]", "-map", "[out]", "-frames:v", "1", "-c:v", "png", "-compression_level", "9", "-threads", "1", poseDiagnosticPath], "pose diagnostic encode");
  } finally {
    rmSync(sourcePreview, { force: true });
  }
  return {
    sourcePosePath,
    sourcePoseSha256: sha256File(sourcePosePath),
    targetPosePath,
    targetPoseSha256: sha256File(targetPosePath),
    poseGuidePath,
    poseGuideSha256: sha256File(poseGuidePath),
    poseDiagnosticPath,
    poseDiagnosticSha256: sha256File(poseDiagnosticPath),
    motion
  };
}
