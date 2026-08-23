export const RIVER_CANVAS = Object.freeze({ width: 1152, height: 640 });
export const LAYOUT_TOLERANCES = Object.freeze({ heightTolerancePx: 12, footTolerancePx: 8, maxSoftOverlapRatio: 0.005 });

const CANONICAL_LAYOUT = Object.freeze({
  canvas: RIVER_CANVAS,
  people: Object.freeze({
    shen_yan: Object.freeze({
      id: "shen_yan", name: "沈砚", species: "human", screenSide: "left",
      head: Object.freeze({ x: 495.7309789260229, y: 117.66274488220614 }),
      neck: Object.freeze({ x: 462.12112969905144, y: 175.15327645465732 }),
      feet: Object.freeze({ left: Object.freeze({ x: 505.46014580751466, y: 546.630557384342 }), right: Object.freeze({ x: 415.24423472459114, y: 551.0529059668381 }) }),
      pixelHeight: 431.179, gazeTarget: Object.freeze({ x: 690.4288188939294, y: 151.3356521253785 }),
      allowedBounds: Object.freeze({ x: 387, y: 99, width: 161, height: 465 }),
    }),
    jiang_lan: Object.freeze({
      id: "jiang_lan", name: "江岚", species: "human", screenSide: "right",
      head: Object.freeze({ x: 690.4288188939294, y: 151.3356521253785 }),
      neck: Object.freeze({ x: 715.4702842185895, y: 207.07310720284772 }),
      feet: Object.freeze({ left: Object.freeze({ x: 734.8572251151005, y: 555.2302541360259 }), right: Object.freeze({ x: 709.8157597904403, y: 555.2302541360259 }) }),
      pixelHeight: 403.8946020106472, gazeTarget: Object.freeze({ x: 495.7309789260229, y: 117.66274488220614 }),
      allowedBounds: Object.freeze({ x: 650, y: 130, width: 128, height: 434 }),
    }),
  }),
  tolerances: LAYOUT_TOLERANCES,
});

const BODY_POINT_COUNT = 18;
const MIN_CONFIDENCE = 0.2;
const NOSE = 0;
const NECK = 1;
const RIGHT_ANKLE = 10;
const LEFT_ANKLE = 13;

function fail(message) { throw new Error(`Layered compositing layout invariant: ${message}`); }
function clone(value) { return structuredClone(value); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function withinBounds(point, bounds) { return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height; }

function structuralEqual(actual, expected) {
  if (Object.is(actual, expected)) return true;
  if (typeof actual !== typeof expected || actual === null || expected === null) return false;
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length && actual.every((value, index) => structuralEqual(value, expected[index]));
  }
  if (typeof actual !== "object") return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index] && structuralEqual(actual[key], expected[key]));
}

function parseFrames(input) {
  let value = input;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { fail("OpenPose JSON must be valid JSON"); }
  }
  if (!Array.isArray(value)) fail("OpenPose output must be one outer frame array");
  if (value.length !== 1) fail("OpenPose output must contain exactly one frame");
  const frame = value[0];
  if (!frame || typeof frame !== "object") fail("OpenPose frame is required");
  return frame;
}

function readPoint(flat, index) {
  const offset = index * 3;
  const x = flat[offset]; const y = flat[offset + 1]; const confidence = flat[offset + 2];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(confidence)) fail("OpenPose person contains invalid point values");
  return { x, y, confidence };
}

function parsePerson(payload, canvas) {
  const flat = payload?.pose_keypoints_2d;
  if (!Array.isArray(flat) || flat.length !== BODY_POINT_COUNT * 3) fail(`OpenPose body point count must be exactly ${BODY_POINT_COUNT}`);
  const points = Array.from({ length: BODY_POINT_COUNT }, (_, index) => readPoint(flat, index));
  for (const point of points) {
    if (point.confidence >= MIN_CONFIDENCE && (point.x < 0 || point.x >= canvas.width || point.y < 0 || point.y >= canvas.height)) fail("detected keypoint is outside mother-frame bounds");
  }
  for (const [name, index] of [["nose", NOSE], ["neck", NECK], ["right ankle", RIGHT_ANKLE], ["left ankle", LEFT_ANKLE]]) {
    if (points[index].confidence < MIN_CONFIDENCE) fail(`detected person is missing ${name}`);
  }
  return { payload: clone(payload), points };
}

function assertPersonMatchesContract(person, contract, layout) {
  const nose = person.points[NOSE]; const neck = person.points[NECK];
  const rightAnkle = person.points[RIGHT_ANKLE]; const leftAnkle = person.points[LEFT_ANKLE];
  const feetMidpoint = { x: (leftAnkle.x + rightAnkle.x) / 2, y: (leftAnkle.y + rightAnkle.y) / 2 };
  const height = feetMidpoint.y - nose.y;
  if (height <= 0 || Math.abs(height - contract.pixelHeight) > layout.tolerances.heightTolerancePx) fail(`${contract.id} pose height does not match the fixed layout`);
  if (!withinBounds(nose, contract.allowedBounds) || !withinBounds(neck, contract.allowedBounds) || !withinBounds(leftAnkle, contract.allowedBounds) || !withinBounds(rightAnkle, contract.allowedBounds)) fail(`${contract.id} pose violates allowed bounds`);
  if (distance(leftAnkle, contract.feet.left) > layout.tolerances.footTolerancePx || distance(rightAnkle, contract.feet.right) > layout.tolerances.footTolerancePx) fail(`${contract.id} feet do not match fixed anchors`);
  if ((contract.screenSide === "left" && nose.x <= neck.x) || (contract.screenSide === "right" && nose.x >= neck.x)) fail(`${contract.id} gaze must face inward`);
}

function assertMask(mask, label, expectedLength) {
  if (!(Buffer.isBuffer(mask) || mask instanceof Uint8Array)) fail(`${label} must be a raw mask buffer`);
  if (mask.length !== expectedLength) fail(`${label} length must equal width * height`);
  let coverage = 0;
  for (const value of mask) coverage += value > 0 ? 1 : 0;
  if (coverage === 0) fail(`${label} must not be empty`);
  return coverage;
}

export function createRiverLayout() { return clone(CANONICAL_LAYOUT); }

export function assertLayout(layout) {
  if (!layout || typeof layout !== "object") fail("layout is required");
  if (!structuralEqual(layout, CANONICAL_LAYOUT)) fail("layout must equal the immutable canonical source-pixel contract");
}

export function splitPose(openposeJson, layout = createRiverLayout()) {
  assertLayout(layout);
  const frame = parseFrames(openposeJson);
  if (frame.canvas_width !== layout.canvas.width || frame.canvas_height !== layout.canvas.height) fail("OpenPose canvas must match the mother frame");
  if (!Array.isArray(frame.people) || frame.people.length !== 2) fail("OpenPose must contain exactly two detected people");
  const detected = frame.people.map((person) => parsePerson(person, layout.canvas));
  const byNeckX = [...detected].sort((a, b) => a.points[NECK].x - b.points[NECK].x);
  if (byNeckX[0].points[NECK].x === byNeckX[1].points[NECK].x) fail("two-person pose assignment is ambiguous");
  assertPersonMatchesContract(byNeckX[0], layout.people.shen_yan, layout);
  assertPersonMatchesContract(byNeckX[1], layout.people.jiang_lan, layout);
  return { shen_yan: byNeckX[0].payload, jiang_lan: byNeckX[1].payload };
}

export function assertNoBodyOverlap(maskA, maskB, options = {}) {
  const { width, height } = options;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) fail("mask width and height must be positive integers");
  const expectedLength = width * height;
  const coverageA = assertMask(maskA, "first mask", expectedLength);
  const coverageB = assertMask(maskB, "second mask", expectedLength);
  const ratioLimit = options.maxSoftOverlapRatio ?? LAYOUT_TOLERANCES.maxSoftOverlapRatio;
  if (!Number.isFinite(ratioLimit) || ratioLimit < 0 || ratioLimit > LAYOUT_TOLERANCES.maxSoftOverlapRatio) fail(`maxSoftOverlapRatio must be between 0 and ${LAYOUT_TOLERANCES.maxSoftOverlapRatio}`);
  const hardThreshold = options.hardThreshold ?? 128;
  if (!Number.isInteger(hardThreshold) || hardThreshold < 1 || hardThreshold > 255) fail("hardThreshold must be an integer from 1 to 255");
  let softOverlap = 0; let hardOverlap = 0;
  for (let index = 0; index < expectedLength; index += 1) {
    if (maskA[index] > 0 && maskB[index] > 0) {
      if (maskA[index] >= hardThreshold && maskB[index] >= hardThreshold) hardOverlap += 1;
      else softOverlap += 1;
    }
  }
  if (hardOverlap > 0) fail(`torso/leg mask overlap is forbidden (${hardOverlap} hard pixels)`);
  if (softOverlap / Math.min(coverageA, coverageB) > ratioLimit) fail(`soft-edge mask overlap ratio exceeds ${ratioLimit}`);
}
