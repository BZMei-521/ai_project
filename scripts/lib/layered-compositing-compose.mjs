import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { appendCandidate, assertRunInvariant, sha256File, writeJsonAtomic } from "./layered-compositing-run.mjs";
import { assertLayout, assertNoBodyOverlap, createRiverLayout } from "./layered-compositing-layout.mjs";
import { probeImage } from "./layered-compositing-media.mjs";

const WIDTH = 1152;
const HEIGHT = 640;
const PIXELS = WIDTH * HEIGHT;
const CHARACTERS = Object.freeze(["shen_yan", "jiang_lan"]);
const LAYER_ORDER = Object.freeze(["shen_yan", "jiang_lan"]);
const ARTIFACT_NAMES = Object.freeze({
  unrepairedComposite: "unrepaired-composite.png",
  editableMask: "editable-mask.png",
  protectedMask: "protected-mask.png",
  contactShadowMask: "contact-shadow-mask.png",
});

export const DEFAULT_COMPOSITE_LIGHTING = Object.freeze({
  environmentRgb: Object.freeze([196, 126, 78]),
  spillOpacity: 0.035,
  shadowOpacity: 0.18,
  shadowOffsetX: -14,
  shadowOffsetY: 7,
  shadowBlurRadius: 5,
});

function fail(message) { throw new Error(`Layered deterministic composite invariant: ${message}`); }

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { windowsHide: true, maxBuffer: 128 * 1024 * 1024, ...options });
  if (result.error) fail(`${command} could not run: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} failed: ${String(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

function assertLighting(input = DEFAULT_COMPOSITE_LIGHTING) {
  const lighting = structuredClone(input);
  const expectedKeys = ["environmentRgb", "shadowBlurRadius", "shadowOffsetX", "shadowOffsetY", "shadowOpacity", "spillOpacity"];
  const keys = Object.keys(lighting ?? {}).sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) fail(`numeric lighting keys must be exactly ${expectedKeys.join(", ")}`);
  if (!Array.isArray(lighting.environmentRgb) || lighting.environmentRgb.length !== 3 || lighting.environmentRgb.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) fail("environmentRgb must contain three 8-bit integers");
  if (!Number.isFinite(lighting.spillOpacity) || lighting.spillOpacity < 0 || lighting.spillOpacity > 0.1) fail("spillOpacity must be from 0 to 0.1");
  if (!Number.isFinite(lighting.shadowOpacity) || lighting.shadowOpacity <= 0 || lighting.shadowOpacity > 0.4) fail("shadowOpacity must be greater than 0 and at most 0.4");
  if (!Number.isInteger(lighting.shadowOffsetX) || lighting.shadowOffsetX >= 0 || lighting.shadowOffsetX < -64) fail("shadowOffsetX must point screen-left");
  if (!Number.isInteger(lighting.shadowOffsetY) || lighting.shadowOffsetY <= 0 || lighting.shadowOffsetY > 64) fail("shadowOffsetY must point screen-front/down");
  if (!Number.isFinite(lighting.shadowBlurRadius) || lighting.shadowBlurRadius <= 0 || lighting.shadowBlurRadius > 32) fail("shadowBlurRadius must be greater than 0 and at most 32");
  return lighting;
}

function exactArtifact(record, label) {
  if (!record || typeof record.path !== "string" || !Number.isInteger(record.size) || record.size <= 0 || !/^[a-f0-9]{64}$/i.test(record.sha256 ?? "")) fail(`${label} frozen artifact record is required`);
  const resolved = path.resolve(record.path);
  if (!existsSync(resolved)) fail(`${label} artifact is missing`);
  const stats = statSync(resolved);
  if (!stats.isFile() || stats.size !== record.size) fail(`${label} artifact size mismatch`);
  if (sha256File(resolved).toLowerCase() !== record.sha256.toLowerCase()) fail(`${label} artifact hash mismatch`);
  const probe = probeImage(resolved);
  if (probe.codecName !== "png") fail(`${label} codec must be PNG`);
  if (probe.width !== WIDTH || probe.height !== HEIGHT) fail(`${label} geometry must be ${WIDTH}x${HEIGHT}`);
  return { ...structuredClone(record), path: resolved, sha256: record.sha256.toLowerCase(), probe };
}

function decode(filePath, pixelFormat) {
  return run("ffmpeg", ["-v", "error", "-i", filePath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", pixelFormat, "pipe:1"], { encoding: null });
}

function encodeGray(pixels, destination) {
  run("ffmpeg", [
    "-y", "-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", `${WIDTH}x${HEIGHT}`,
    "-i", "pipe:0", "-frames:v", "1", "-threads", "1", "-fflags", "+bitexact", "-flags:v", "+bitexact",
    "-c:v", "png", destination,
  ], { input: pixels });
}

function artifact(filePath) {
  const stats = statSync(filePath);
  return { path: path.resolve(filePath), size: stats.size, sha256: sha256File(filePath) };
}

function pointDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function selectedZone(mask, point, radius = 8) {
  let count = 0; let xTotal = 0; let yTotal = 0; let alphaTotal = 0;
  const left = Math.max(0, Math.floor(point.x - radius)); const right = Math.min(WIDTH - 1, Math.ceil(point.x + radius));
  const top = Math.max(0, Math.floor(point.y - radius)); const bottom = Math.min(HEIGHT - 1, Math.ceil(point.y + radius));
  for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) {
    const value = mask[y * WIDTH + x];
    if (value < 128 || (x - point.x) ** 2 + (y - point.y) ** 2 > radius ** 2) continue;
    count += 1; xTotal += x * value; yTotal += y * value; alphaTotal += value;
  }
  return { count, point: alphaTotal ? { x: xTotal / alphaTotal, y: yTotal / alphaTotal } : null };
}

function validateMatte(mask, contract, label) {
  if (mask.length !== PIXELS) fail(`${label} decoded matte length is invalid`);
  let strong = 0; let weighted = 0; let lowLeak = 0; let minX = WIDTH; let minY = HEIGHT; let maxX = -1; let maxY = -1;
  const bounds = contract.allowedBounds; const right = bounds.x + bounds.width; const bottom = bounds.y + bounds.height;
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    const value = mask[y * WIDTH + x]; weighted += value;
    if (value >= 4 && (x < bounds.x || x > right || y < bounds.y || y > bottom)) lowLeak += 1;
    if (value < 128) continue;
    strong += 1; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const coverage = strong / PIXELS; const weightedCoverage = weighted / (255 * PIXELS);
  if (coverage < 0.005 || coverage > 0.25 || weightedCoverage < 0.005 || weightedCoverage > 0.25) fail(`${label} matte coverage is not meaningful`);
  if (lowLeak > 0) fail(`${label} matte has low-alpha leakage outside Task 2 allowed bounds`);
  if (minX < bounds.x || minY < bounds.y || maxX > right || maxY > bottom) fail(`${label} matte violates Task 2 allowed bounds`);
  const head = selectedZone(mask, contract.head); const left = selectedZone(mask, contract.feet.left); const footRight = selectedZone(mask, contract.feet.right);
  if (head.count < 12 || left.count < 12 || footRight.count < 12) fail(`${label} head and feet anchors must contain meaningful foreground`);
  if (pointDistance(left.point, contract.feet.left) > 8 || pointDistance(footRight.point, contract.feet.right) > 8) fail(`${label} feet are outside the 8px anchor tolerance`);
  const measuredHeight = ((left.point.y + footRight.point.y) / 2) - head.point.y;
  if (Math.abs(measuredHeight - contract.pixelHeight) > 12) fail(`${label} height is outside the 12px tolerance`);
  return { coverage, weightedCoverage, bounds: { minX, minY, maxX, maxY }, zones: { head, leftFoot: left, rightFoot: footRight }, measuredHeight };
}

function validateAlpha(rgba, matte, label) {
  if (rgba.length !== PIXELS * 4) fail(`${label} decoded RGBA length is invalid`);
  for (let index = 0; index < PIXELS; index += 1) {
    if (Math.abs(rgba[index * 4 + 3] - matte[index]) > 1) fail(`${label} transparent PNG alpha does not match the accepted matte`);
  }
}

function normalizeInputs(inputs, layout) {
  if (!inputs || typeof inputs !== "object") fail("accepted composite inputs are required");
  if (!Array.isArray(inputs.layerOrder) || inputs.layerOrder.length !== 2 || inputs.layerOrder.some((value, index) => value !== LAYER_ORDER[index])) fail("immutable character layer order is shen_yan then jiang_lan");
  const emptyPlate = exactArtifact(inputs.emptyPlate, "accepted empty plate");
  const normalized = { emptyPlate, layerOrder: [...LAYER_ORDER] };
  const rawMasks = {};
  for (const character of CHARACTERS) {
    const entry = inputs[character];
    if (entry?.identity !== character) fail(`${character} identity is missing or layers were swapped`);
    const transparentPng = exactArtifact(entry.transparentPng, `${character} accepted transparent PNG`);
    const matte = exactArtifact(entry.matte, `${character} accepted matte`);
    if (!/^(?:rgba|bgra|argb|abgr|yuva|gbrap|ya)/.test(transparentPng.probe.pixelFormat)) fail(`${character} transparent PNG must retain alpha`);
    if (!/^gray/.test(matte.probe.pixelFormat)) fail(`${character} matte must be grayscale`);
    const mask = decode(matte.path, "gray"); const rgba = decode(transparentPng.path, "rgba");
    validateAlpha(rgba, mask, character);
    normalized[character] = { identity: character, transparentPng, matte };
    rawMasks[character] = mask;
  }
  assertNoBodyOverlap(rawMasks.shen_yan, rawMasks.jiang_lan, { width: WIDTH, height: HEIGHT, maxSoftOverlapRatio: layout.tolerances.maxSoftOverlapRatio });
  for (const character of CHARACTERS) normalized[character].validation = validateMatte(rawMasks[character], layout.people[character], character);
  const shenCenter = normalized.shen_yan.validation.zones.head.point.x;
  const jiangCenter = normalized.jiang_lan.validation.zones.head.point.x;
  if (!(shenCenter < jiangCenter)) fail("characters must preserve inward separation and may not swap screen sides");
  return { inputs: normalized, rawMasks };
}

function lightingNumber(value) { return Number(value.toFixed(8)).toString(); }

function shadowGraph(lighting, layout) {
  const cropX = Math.abs(lighting.shadowOffsetX);
  const cropWidth = WIDTH - cropX;
  const opacity = lightingNumber(lighting.shadowOpacity);
  const blur = lightingNumber(lighting.shadowBlurRadius);
  const line = (input, character, label) => {
    const contract = layout.people[character];
    const lowerY = Math.floor(Math.min(contract.feet.left.y, contract.feet.right.y) - 45);
    const lowerHeight = HEIGHT - lowerY - lighting.shadowOffsetY;
    return `[${input}:v]scale=${WIDTH}:${HEIGHT}:flags=neighbor,format=gray,crop=${cropWidth}:${lowerHeight}:${cropX}:${lowerY},pad=${WIDTH}:${HEIGHT}:0:${lowerY + lighting.shadowOffsetY}:black[${label}]`;
  };
  const one = line(3, "shen_yan", "shadow_a");
  const two = line(4, "jiang_lan", "shadow_b");
  const combine = `[shadow_a][shadow_b]blend=all_expr='max(A,B)',gblur=sigma=${blur},lut=y='val*${opacity}',format=gray[shadow_mask]`;
  return { one, two, combine };
}

export function buildCompositeFilter(inputs, layout, lightingInput = DEFAULT_COMPOSITE_LIGHTING) {
  assertLayout(layout);
  if (!inputs || inputs.shen_yan?.identity !== "shen_yan" || inputs.jiang_lan?.identity !== "jiang_lan") fail("character identities are required and may not be swapped");
  if (!Array.isArray(inputs.layerOrder) || inputs.layerOrder.some((value, index) => value !== LAYER_ORDER[index]) || inputs.layerOrder.length !== 2) fail("immutable character layer order is required");
  const lighting = assertLighting(lightingInput);
  const spillColor = `0x${lighting.environmentRgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  const spillOpacity = lightingNumber(lighting.spillOpacity);
  const shadow = shadowGraph(lighting, layout);
  return [
    `[0:v]scale=${WIDTH}:${HEIGHT}:flags=lanczos,format=rgba[plate]`,
    shadow.one, shadow.two, shadow.combine,
    `color=c=black@1.0:s=${WIDTH}x${HEIGHT},format=rgba[shadow_color]`,
    `[shadow_color][shadow_mask]alphamerge[shadow_rgba]`,
    `[plate][shadow_rgba]overlay=0:0:format=auto[grounded]`,
    `[3:v]scale=${WIDTH}:${HEIGHT}:flags=neighbor,format=gray,split=2[shen_spill_base][shen_spill_source]`,
    `[shen_spill_source]dilation=coordinates=255[shen_spill_dilated]`,
    `[shen_spill_dilated][shen_spill_base]blend=all_expr='max(A-B,0)',lut=y='val*${spillOpacity}'[shen_spill_mask]`,
    `[4:v]scale=${WIDTH}:${HEIGHT}:flags=neighbor,format=gray,split=2[jiang_spill_base][jiang_spill_source]`,
    `[jiang_spill_source]dilation=coordinates=255[jiang_spill_dilated]`,
    `[jiang_spill_dilated][jiang_spill_base]blend=all_expr='max(A-B,0)',lut=y='val*${spillOpacity}'[jiang_spill_mask]`,
    `color=c=${spillColor}@1.0:s=${WIDTH}x${HEIGHT},format=rgba[shen_spill_color]`,
    `color=c=${spillColor}@1.0:s=${WIDTH}x${HEIGHT},format=rgba[jiang_spill_color]`,
    `[shen_spill_color][shen_spill_mask]alphamerge[shen_spill]`,
    `[jiang_spill_color][jiang_spill_mask]alphamerge[jiang_spill]`,
    `[1:v]scale=${WIDTH}:${HEIGHT}:flags=neighbor,format=rgba[shen_yan_layer]`,
    `[2:v]scale=${WIDTH}:${HEIGHT}:flags=neighbor,format=rgba[jiang_lan_layer]`,
    `[grounded][shen_spill]overlay=0:0:format=auto[with_shen_spill]`,
    `[with_shen_spill][jiang_spill]overlay=0:0:format=auto[with_jiang_spill]`,
    `[with_jiang_spill][shen_yan_layer]overlay=0:0:format=auto[with_shen_yan]`,
    `[with_shen_yan][jiang_lan_layer]overlay=0:0:format=auto[composite]`,
  ].join(";");
}

function rectangleSum(integral, left, top, right, bottom) {
  const stride = WIDTH + 1;
  return integral[(bottom + 1) * stride + right + 1] - integral[top * stride + right + 1] - integral[(bottom + 1) * stride + left] + integral[top * stride + left];
}

function morphology(mask, radius, mode) {
  const binary = new Uint8Array(PIXELS);
  for (let index = 0; index < PIXELS; index += 1) binary[index] = mask[index] >= 128 ? 1 : 0;
  const stride = WIDTH + 1; const integral = new Uint32Array((WIDTH + 1) * (HEIGHT + 1));
  for (let y = 0; y < HEIGHT; y += 1) {
    let row = 0;
    for (let x = 0; x < WIDTH; x += 1) { row += binary[y * WIDTH + x]; integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row; }
  }
  const output = Buffer.alloc(PIXELS);
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    const left = Math.max(0, x - radius); const right = Math.min(WIDTH - 1, x + radius);
    const top = Math.max(0, y - radius); const bottom = Math.min(HEIGHT - 1, y + radius);
    const sum = rectangleSum(integral, left, top, right, bottom); const area = (right - left + 1) * (bottom - top + 1);
    if ((mode === "dilate" && sum > 0) || (mode === "erode" && sum === area)) output[y * WIDTH + x] = 255;
  }
  return output;
}

function fillEllipse(mask, center, radiusX, radiusY, bounds) {
  const left = Math.max(bounds.x, Math.floor(center.x - radiusX)); const right = Math.min(bounds.x + bounds.width, Math.ceil(center.x + radiusX));
  const top = Math.max(bounds.y, Math.floor(center.y - radiusY)); const bottom = Math.min(bounds.y + bounds.height, Math.ceil(center.y + radiusY));
  for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) {
    if (((x - center.x) / radiusX) ** 2 + ((y - center.y) / radiusY) ** 2 <= 1) mask[y * WIDTH + x] = 255;
  }
}

function assertNormalized(value, label, { positive = false } = {}) {
  if (!Number.isFinite(value) || value < 0 || value > 1 || (positive && value === 0)) fail(`${label} must be ${positive ? "greater than 0 and " : ""}normalized from 0 to 1`);
  return value;
}

function ellipseRegion(region, bounds, label) {
  if (region?.kind !== "ellipse") fail(`${label} must be an ellipse region`);
  const cx = assertNormalized(region.cx, `${label}.cx`); const cy = assertNormalized(region.cy, `${label}.cy`);
  const rx = assertNormalized(region.rx, `${label}.rx`, { positive: true }); const ry = assertNormalized(region.ry, `${label}.ry`, { positive: true });
  if (cx - rx < 0 || cx + rx > 1 || cy - ry < 0 || cy + ry > 1) fail(`${label} must stay inside the character-local allowed bounds`);
  return { kind: "ellipse", center: { x: bounds.x + cx * bounds.width, y: bounds.y + cy * bounds.height }, radiusX: rx * bounds.width, radiusY: ry * bounds.height };
}

function accessoryRegion(box, bounds, label) {
  if (typeof box?.name !== "string" || box.name.trim().length < 3 || typeof box.note !== "string" || box.note.trim().length < 8) fail(`${label} requires a reviewed accessory name and note`);
  const x = assertNormalized(box.x, `${label}.x`); const y = assertNormalized(box.y, `${label}.y`);
  const width = assertNormalized(box.width, `${label}.width`, { positive: true }); const height = assertNormalized(box.height, `${label}.height`, { positive: true });
  if (x + width > 1 || y + height > 1) fail(`${label} lies outside the character-local allowed bounds`);
  return { name: box.name.trim(), note: box.note.trim(), x: bounds.x + x * bounds.width, y: bounds.y + y * bounds.height, width: width * bounds.width, height: height * bounds.height };
}

export function validateProtectionContract(input, layout = createRiverLayout()) {
  assertLayout(layout);
  if (!input || typeof input !== "object") fail("protection contract is required");
  if (input.schemaVersion !== 1 || typeof input.review?.reviewer !== "string" || input.review.reviewer.trim().length < 3 || typeof input.review?.note !== "string" || input.review.note.trim().length < 12) fail("protection contract requires schemaVersion 1 and explicit human review metadata");
  const keys = Object.keys(input.characters ?? {}).sort();
  if (keys.length !== 2 || keys[0] !== "jiang_lan" || keys[1] !== "shen_yan") fail("protection contract characters must be exactly shen_yan and jiang_lan");
  const derived = { schemaVersion: 1, review: structuredClone(input.review), characters: {} };
  for (const character of CHARACTERS) {
    const value = input.characters[character]; const bounds = layout.people[character].allowedBounds;
    if (value?.bodyCostumeProtection?.strategy !== "eroded-matte" || !Number.isInteger(value.bodyCostumeProtection.erosionPx) || value.bodyCostumeProtection.erosionPx < 2 || value.bodyCostumeProtection.erosionPx > 12 || !Number.isFinite(value.bodyCostumeProtection.minCoverageRatio) || value.bodyCostumeProtection.minCoverageRatio < 0.2 || value.bodyCostumeProtection.minCoverageRatio > 0.95) fail(`${character} body/costume protection strategy is invalid`);
    if (!Array.isArray(value.accessoryBoxes)) fail(`${character} accessoryBoxes array is required`);
    if (value.accessoryBoxes.length === 0) {
      const none = value.noKeyAccessories;
      if (none?.declared !== true || typeof none.reviewer !== "string" || none.reviewer.trim().length < 3 || typeof none.note !== "string" || none.note.trim().length < 12) fail(`${character} empty accessoryBoxes requires an explicit human no-key-accessories declaration and note`);
    }
    derived.characters[character] = {
      faceRegion: ellipseRegion(value.faceRegion, bounds, `${character} faceRegion`),
      primaryHairRegion: ellipseRegion(value.primaryHairRegion, bounds, `${character} primaryHairRegion`),
      bodyCostumeProtection: structuredClone(value.bodyCostumeProtection),
      accessoryBoxes: value.accessoryBoxes.map((box, index) => accessoryRegion(box, bounds, `${character} accessoryBoxes[${index}]`)),
    };
    if (value.noKeyAccessories) derived.characters[character].noKeyAccessories = structuredClone(value.noKeyAccessories);
  }
  return { contract: structuredClone(input), derived };
}

function fillBox(mask, box) {
  const left = Math.floor(box.x); const right = Math.ceil(box.x + box.width); const top = Math.floor(box.y); const bottom = Math.ceil(box.y + box.height);
  for (let y = top; y <= bottom; y += 1) mask.fill(255, y * WIDTH + left, y * WIDTH + right + 1);
}

function intersectRegion(regionMask, matte, destination) {
  let regionPixels = 0; let intersectionPixels = 0;
  for (let index = 0; index < PIXELS; index += 1) {
    if (!regionMask[index]) continue;
    regionPixels += 1;
    if (matte[index] >= 128) { destination[index] = 255; intersectionPixels += 1; }
  }
  return { regionPixels, intersectionPixels, ratio: regionPixels ? intersectionPixels / regionPixels : 0 };
}

function makeContactSeed(rawMasks, layout, lighting) {
  const seed = Buffer.alloc(PIXELS);
  for (const character of CHARACTERS) {
    const mask = rawMasks[character]; const contract = layout.people[character];
    const lowerY = Math.floor(Math.min(contract.feet.left.y, contract.feet.right.y) - 45);
    for (let y = lowerY; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
      const destinationX = x + lighting.shadowOffsetX; const destinationY = y + lighting.shadowOffsetY;
      if (destinationX < 0 || destinationX >= WIDTH || destinationY < 0 || destinationY >= HEIGHT) continue;
      seed[destinationY * WIDTH + destinationX] = Math.max(seed[destinationY * WIDTH + destinationX], mask[y * WIDTH + x]);
    }
  }
  return seed;
}

function writeContactShadow(seed, lighting, temporarySeed, destination) {
  encodeGray(seed, temporarySeed);
  run("ffmpeg", [
    "-y", "-v", "error", "-i", temporarySeed,
    "-vf", `gblur=sigma=${lightingNumber(lighting.shadowBlurRadius)},lut=y='val*${lightingNumber(lighting.shadowOpacity)}',format=gray`,
    "-frames:v", "1", "-threads", "1", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-c:v", "png", destination,
  ]);
}

function generateMasks({ rawMasks, layout, lighting, protection, outputDirectory }) {
  const contactShadowMask = path.join(outputDirectory, ARTIFACT_NAMES.contactShadowMask);
  const protectedMask = path.join(outputDirectory, ARTIFACT_NAMES.protectedMask);
  const editableMask = path.join(outputDirectory, ARTIFACT_NAMES.editableMask);
  const temporarySeed = path.join(outputDirectory, `.contact-shadow-seed-${process.pid}.png`);
  writeContactShadow(makeContactSeed(rawMasks, layout, lighting), lighting, temporarySeed, contactShadowMask);
  rmSync(temporarySeed, { force: true });
  const shadow = decode(contactShadowMask, "gray"); const protectedPixels = Buffer.alloc(PIXELS); const editablePixels = Buffer.alloc(PIXELS);
  for (const character of CHARACTERS) {
    const mask = rawMasks[character]; const contract = layout.people[character];
    const declared = protection.derived.characters[character];
    const erodedBody = morphology(mask, declared.bodyCostumeProtection.erosionPx, "erode"); const dilated = morphology(mask, 4, "dilate");
    let bodyPixels = 0; let mattePixels = 0;
    for (let index = 0; index < PIXELS; index += 1) {
      protectedPixels[index] = Math.max(protectedPixels[index], erodedBody[index]);
      if (erodedBody[index]) bodyPixels += 1;
      if (mask[index] >= 128) mattePixels += 1;
      if (dilated[index] && !erodedBody[index]) editablePixels[index] = 255;
    }
    if (!mattePixels || bodyPixels / mattePixels < declared.bodyCostumeProtection.minCoverageRatio) fail(`${character} body/costume protection coverage is too low`);
    const face = Buffer.alloc(PIXELS); fillEllipse(face, declared.faceRegion.center, declared.faceRegion.radiusX, declared.faceRegion.radiusY, contract.allowedBounds);
    const faceFacts = intersectRegion(face, mask, protectedPixels); if (faceFacts.intersectionPixels < 32 || faceFacts.ratio < 0.35) fail(`${character} face protection has insufficient matte coverage`);
    const hair = Buffer.alloc(PIXELS); fillEllipse(hair, declared.primaryHairRegion.center, declared.primaryHairRegion.radiusX, declared.primaryHairRegion.radiusY, contract.allowedBounds);
    const erodedHair = morphology(hair, 2, "erode"); const hairFacts = intersectRegion(erodedHair, mask, protectedPixels); if (hairFacts.intersectionPixels < 32 || hairFacts.ratio < 0.2) fail(`${character} primary hair protection has insufficient matte coverage`);
    for (const box of declared.accessoryBoxes) {
      const accessory = Buffer.alloc(PIXELS); fillBox(accessory, box); const facts = intersectRegion(accessory, mask, protectedPixels);
      if (facts.intersectionPixels < 8 || facts.ratio < 0.2) fail(`${character} accessory ${box.name} protection has insufficient matte coverage`);
    }
    for (const foot of [contract.feet.left, contract.feet.right]) fillEllipse(editablePixels, foot, 18, 10, contract.allowedBounds);
  }
  for (let index = 0; index < PIXELS; index += 1) {
    if (rawMasks.shen_yan[index] > 0 && rawMasks.jiang_lan[index] > 0) editablePixels[index] = 255;
    if (shadow[index] > 0) editablePixels[index] = Math.max(editablePixels[index], shadow[index]);
    if (protectedPixels[index] > 0) editablePixels[index] = 0;
  }
  encodeGray(protectedPixels, protectedMask); encodeGray(editablePixels, editableMask);
  assertMaskDisjoint(protectedMask, editableMask);
  return { editableMask, protectedMask, contactShadowMask };
}

function assertMeaningfulMask(maskPath, label) {
  const probe = probeImage(maskPath);
  if (probe.codecName !== "png" || probe.width !== WIDTH || probe.height !== HEIGHT || !/^gray/.test(probe.pixelFormat)) fail(`${label} must be a grayscale ${WIDTH}x${HEIGHT} PNG`);
  const pixels = decode(maskPath, "gray"); let count = 0;
  for (const value of pixels) if (value > 0) count += 1;
  if (count === 0 || count === PIXELS) fail(`${label} must be meaningful and bounded inside the canvas`);
  return { pixels, count };
}

export function assertMaskDisjoint(protectedMaskPath, editableMaskPath) {
  const protectedResult = assertMeaningfulMask(protectedMaskPath, "protected mask");
  const editableResult = assertMeaningfulMask(editableMaskPath, "editable mask");
  for (let index = 0; index < PIXELS; index += 1) if (protectedResult.pixels[index] > 0 && editableResult.pixels[index] > 0) fail(`protected/editable raw gray intersection is not zero at pixel ${index}`);
  return true;
}

function prepareOutputDirectory(outputDirectory) {
  const resolved = path.resolve(outputDirectory ?? "");
  if (existsSync(resolved)) fail(`output directory exists; refusing to overwrite: ${resolved}`);
  mkdirSync(path.dirname(resolved), { recursive: true });
  mkdirSync(resolved, { recursive: false });
  return resolved;
}

function normalizeDirectArgs(args) {
  const layout = args.layout ?? createRiverLayout(); assertLayout(layout);
  const lighting = assertLighting(args.lighting ?? DEFAULT_COMPOSITE_LIGHTING);
  const normalized = normalizeInputs(args.inputs, layout);
  const protection = validateProtectionContract(args.protectionContract, layout);
  return { ...normalized, layout, lighting, protection, outputDirectory: prepareOutputDirectory(args.outputDirectory) };
}

export async function buildEditableMask(args = {}) {
  if (args.reportPath) fail("buildEditableMask accepts explicit immutable inputs; report orchestration belongs to composeDeterministically");
  const prepared = normalizeDirectArgs(args);
  return generateMasks(prepared);
}

function renderComposite({ inputs, layout, lighting, outputDirectory }) {
  const output = path.join(outputDirectory, ARTIFACT_NAMES.unrepairedComposite);
  const filter = buildCompositeFilter(inputs, layout, lighting);
  run("ffmpeg", [
    "-y", "-v", "error",
    "-i", inputs.emptyPlate.path, "-i", inputs.shen_yan.transparentPng.path, "-i", inputs.jiang_lan.transparentPng.path,
    "-i", inputs.shen_yan.matte.path, "-i", inputs.jiang_lan.matte.path,
    "-filter_complex", filter, "-map", "[composite]", "-frames:v", "1", "-threads", "1",
    "-fflags", "+bitexact", "-flags:v", "+bitexact", "-c:v", "png", output,
  ]);
  const probe = probeImage(output);
  if (probe.codecName !== "png" || probe.width !== WIDTH || probe.height !== HEIGHT) fail(`unrepaired composite must be a ${WIDTH}x${HEIGHT} PNG`);
  return output;
}

function composeDirect(args) {
  const prepared = normalizeDirectArgs(args);
  const masks = generateMasks(prepared);
  const unrepairedComposite = renderComposite(prepared);
  return { unrepairedComposite, ...masks };
}

function loadReport(reportPath) {
  let report;
  try { report = JSON.parse(readFileSync(reportPath, "utf8")); } catch { fail(`report is missing or malformed: ${reportPath}`); }
  assertRunInvariant(report, { isDecodable(filePath) { try { probeImage(filePath); return true; } catch { return false; } } });
  return report;
}

function acceptedCandidate(report, stage) {
  const candidates = report.stages[stage].candidates.filter((item) => item.state === "accepted" && item.creativeAcceptance === "accepted" && !item.invalidations?.length);
  if (candidates.length !== 1) fail(`${stage} requires exactly one accepted prerequisite`);
  return candidates[0];
}

function matteCandidate(report, stage, source) {
  const candidates = report.stages[stage].candidates.filter((item) => item.state === "technical" && item.technicalAcceptance === "accepted" && item.sourceCandidateId === source.id);
  if (candidates.length !== 1) fail(`${stage} requires exactly one technical matte for accepted source ${source.id}`);
  if (candidates[0].sourceArtifact?.sha256 !== source.artifact.sha256) fail(`${stage} source provenance does not match the accepted identity candidate`);
  return candidates[0];
}

function reportInputs(report) {
  const plateCandidates = report.stages.empty_plate.candidates.filter((item) => item.state === "accepted" && item.creativeAcceptance === "accepted" && !item.invalidations?.length);
  if (plateCandidates.length !== 1) fail("exactly one empty plate accepted prerequisite is required");
  const shenSource = acceptedCandidate(report, "shen_yan"); const jiangSource = acceptedCandidate(report, "jiang_lan");
  const shenMatte = matteCandidate(report, "shen_yan_matte", shenSource); const jiangMatte = matteCandidate(report, "jiang_lan_matte", jiangSource);
  return {
    emptyPlate: plateCandidates[0].artifact,
    layerOrder: [...LAYER_ORDER],
    shen_yan: { identity: "shen_yan", transparentPng: shenMatte.transparentPng, matte: shenMatte.revisedMask },
    jiang_lan: { identity: "jiang_lan", transparentPng: jiangMatte.transparentPng, matte: jiangMatte.revisedMask },
  };
}

function candidateRecord(id, outputs, inputs, layout, lighting, lightingManifest, protection) {
  return {
    id,
    artifact: artifact(outputs.unrepairedComposite),
    unrepairedComposite: artifact(outputs.unrepairedComposite),
    editableMask: artifact(outputs.editableMask),
    protectedMask: artifact(outputs.protectedMask),
    contactShadowMask: artifact(outputs.contactShadowMask),
    inputArtifacts: {
      emptyPlate: structuredClone(inputs.emptyPlate),
      shen_yan: { transparentPng: structuredClone(inputs.shen_yan.transparentPng), matte: structuredClone(inputs.shen_yan.matte) },
      jiang_lan: { transparentPng: structuredClone(inputs.jiang_lan.transparentPng), matte: structuredClone(inputs.jiang_lan.matte) },
    },
    layout: structuredClone(layout),
    numericLighting: structuredClone(lighting),
    numericLightingManifest: lightingManifest ? structuredClone(lightingManifest) : undefined,
    protectionContract: protection ? { manifest: structuredClone(protection.manifest), derived: structuredClone(protection.derived) } : undefined,
    layerOrder: [...LAYER_ORDER],
    technicalValidation: { geometry: `${WIDTH}x${HEIGHT}`, protectedEditableIntersection: 0, deterministic: true, generativeCalls: 0 },
  };
}

function windowsProcessStartIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return { alive: null, startIdentity: null };
  const script = `$raw=$env:LAYERED_PROCESS_ID; $id=0; if (-not [int]::TryParse($raw,[ref]$id) -or $id -le 0) { Write-Output 'indeterminate'; exit 4 }; try { $p = [System.Diagnostics.Process]::GetProcessById($id); Write-Output ('alive:' + $p.StartTime.ToUniversalTime().Ticks); exit 0 } catch [System.ArgumentException] { Write-Output 'dead'; exit 3 } catch { Write-Output 'indeterminate'; exit 4 }`;
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, encoding: "utf8", env: { ...process.env, LAYERED_PROCESS_ID: String(pid) } });
  if (result.status === 3 && result.stdout.trim() === "dead") return { alive: false, startIdentity: null };
  const match = /^alive:(\d+)$/.exec(result.stdout.trim()); return result.status === 0 && match ? { alive: true, startIdentity: `windows-ticks:${match[1]}` } : { alive: null, startIdentity: null };
}

export function parseLinuxProcessStatStartIdentity(statText) {
  const closingComm = statText.lastIndexOf(")");
  if (closingComm < 0) fail("Linux process stat is missing the final command delimiter");
  const remainder = statText.slice(closingComm + 1).trim().split(/\s+/);
  if (remainder.length <= 19 || !/^\d+$/.test(remainder[19])) fail("Linux process stat is missing numeric field 22 starttime");
  return `linux-starttime:${remainder[19]}`;
}

function linuxProcessStartIdentity(pid) {
  try {
    return { alive: true, startIdentity: parseLinuxProcessStatStartIdentity(readFileSync(`/proc/${pid}/stat`, "utf8")) };
  } catch (error) { return error?.code === "ENOENT" ? { alive: false, startIdentity: null } : { alive: null, startIdentity: null }; }
}

function defaultProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return { alive: null, startIdentity: null };
  if (process.platform === "win32") return windowsProcessStartIdentity(pid);
  if (process.platform === "linux") return linuxProcessStartIdentity(pid);
  try { process.kill(pid, 0); return { alive: true, startIdentity: null }; } catch (error) { return error?.code === "ESRCH" ? { alive: false, startIdentity: null } : { alive: null, startIdentity: null }; }
}

function queueEntryOwner(entryPath, label) {
  const name = path.basename(entryPath); const match = /^(\d+)~(\d+)~([a-f0-9-]{8,})~([^~]+)~([^~]+)\.queue-entry$/i.exec(name);
  if (!match) fail(`${label} queue entry name is malformed; refusing to prune it`);
  const pid = Number(match[1]); const createdAt = Number(match[2]);
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(createdAt) || createdAt < 0) fail(`${label} queue entry owner is malformed; refusing to prune it`);
  return { pid, createdAt, nonce: match[3], processStartIdentity: decodeURIComponent(match[4]), purpose: decodeURIComponent(match[5]) };
}

function queueNumber(entryPath) {
  const numbers = readdirSync(entryPath).filter((name) => /^number-\d{16}$/.test(name));
  if (numbers.length === 0) return null;
  if (numbers.length !== 1) fail("queue entry has ambiguous bakery number state");
  return Number(numbers[0].slice("number-".length));
}

function stableOwnerOrder(owner) {
  return `${String(owner.pid).padStart(12, "0")}\0${owner.processStartIdentity}`;
}

function ownerState(identity, owner) {
  return {
    same: identity?.alive === true && identity.startIdentity === owner.processStartIdentity,
    dead: identity?.alive === false || (identity?.alive === true && typeof identity.startIdentity === "string" && identity.startIdentity !== owner.processStartIdentity),
  };
}

async function acquireTicketLock(queueDirectory, purpose, options = {}) {
  const label = options.label ?? purpose; const deadline = Date.now() + (options.timeoutMs ?? 5000); const identityProvider = options.processIdentityProvider ?? defaultProcessIdentity;
  const self = await identityProvider(process.pid);
  if (self?.alive !== true || typeof self.startIdentity !== "string" || !self.startIdentity) fail(`${label} cannot verify this process start identity`);
  mkdirSync(queueDirectory, { recursive: true });
  const nonce = options.ticketNonce ?? randomUUID(); const createdAt = options.ticketCreatedAt ?? Date.now();
  const owner = { pid: process.pid, processStartIdentity: self.startIdentity, nonce, createdAt, purpose };
  const entryName = `${process.pid}~${createdAt}~${nonce}~${encodeURIComponent(self.startIdentity)}~${encodeURIComponent(purpose)}.queue-entry`; const entryPath = path.join(queueDirectory, entryName);
  let number;
  try {
    mkdirSync(entryPath, { recursive: false });
    await options.afterSequenceReserved?.({ queueDirectory, sequencePath: entryPath, owner: structuredClone(owner) });
    while (true) {
      const entryPaths = readdirSync(queueDirectory).filter((entry) => entry.endsWith(".queue-entry")).map((name) => path.join(queueDirectory, name));
      await options.afterNumberSelectionSnapshot?.({ queueDirectory, entryPaths: [...entryPaths], ticketPath: entryPath, owner: structuredClone(owner) });
      let maximum = 0; let stateChanged = false;
      for (const currentPath of entryPaths) {
        const current = queueEntryOwner(currentPath, label); const state = ownerState(await identityProvider(current.pid), current);
        if (state.dead) { try { rmSync(currentPath, { recursive: true, force: false }); } catch (error) { if (error?.code !== "ENOENT") throw error; } continue; }
        if (!state.same && Date.now() >= deadline) fail(`${label} timed out because a choosing owner process start identity is indeterminate`);
        try { maximum = Math.max(maximum, queueNumber(currentPath) ?? 0); } catch (error) { if (error?.code !== "ENOENT") throw error; stateChanged = true; break; }
      }
      if (!stateChanged) { number = maximum + 1; break; }
      if (Date.now() >= deadline) fail(`${label} timed out while queue entries changed during number selection`);
    }
    const numberPath = path.join(entryPath, `number-${String(number).padStart(16, "0")}`); const numberTemporary = path.join(entryPath, `.number-${randomUUID()}.tmp`);
    const descriptor = openSync(numberTemporary, "wx", 0o600); try { writeFileSync(descriptor, `${number}\n`, "utf8"); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    await options.afterTicketTemporaryFsynced?.({ queueDirectory, temporaryPath: numberTemporary, ticketPath: entryPath, owner: structuredClone(owner) });
    try { linkSync(numberTemporary, numberPath); rmSync(numberTemporary, { force: false }); } catch (error) { rmSync(numberTemporary, { force: true }); throw error; }
  } catch (error) { rmSync(entryPath, { recursive: true, force: true }); throw error; }
  await options.afterTicketPublished?.({ queueDirectory, ticketPath: entryPath, owner: structuredClone(owner) });
  try {
    while (true) {
      const entryPaths = readdirSync(queueDirectory).filter((name) => name.endsWith(".queue-entry")).map((name) => path.join(queueDirectory, name));
      await options.afterAdmissionSnapshot?.({ queueDirectory, entryPaths: [...entryPaths], ticketPath: entryPath, owner: structuredClone(owner), number });
      const entries = []; let stateChanged = false;
      for (const currentPath of entryPaths) {
        try { entries.push({ name: path.basename(currentPath), path: currentPath, owner: queueEntryOwner(currentPath, label), number: queueNumber(currentPath) }); }
        catch (error) { if (error?.code !== "ENOENT") throw error; stateChanged = true; break; }
      }
      if (stateChanged) { if (Date.now() >= deadline) fail(`${label} timed out while queue entries changed during admission`); continue; }
      let blocked = false;
      for (const entry of entries) {
        const currentPath = entry.path; const current = entry.owner;
        const identity = await identityProvider(current.pid);
        const state = ownerState(identity, current);
        if (state.dead) {
          try { rmSync(currentPath, { recursive: true, force: false }); } catch (removeError) { if (removeError?.code !== "ENOENT") throw removeError; }
          continue;
        }
        if (!state.same && identity?.alive !== false) {
          if (Date.now() >= deadline) fail(`${label} timed out because an owner process start identity is indeterminate`);
          blocked = true; break;
        }
        if (entry.name !== entryName && (entry.number === null || entry.number < number || (entry.number === number && stableOwnerOrder(current).localeCompare(stableOwnerOrder(owner)) < 0))) { blocked = true; break; }
      }
      if (!blocked && existsSync(entryPath)) return { ticketPath: entryPath, ticketName: entryName, queueDirectory, owner };
      if (Date.now() >= deadline) fail(`${label} timed out waiting for the earliest live queue ticket`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } catch (error) { rmSync(entryPath, { recursive: true, force: true }); throw error; }
}

function releaseTicketLock(lock) {
  if (!lock || !existsSync(lock.ticketPath)) return;
  const current = queueEntryOwner(lock.ticketPath, lock.owner.purpose);
  if (!sameValue(current, lock.owner)) fail(`${lock.owner.purpose} unique ticket ownership changed before release`);
  rmSync(lock.ticketPath, { recursive: true, force: false });
}

function parseReportLockOwner(bytes) {
  let owner; try { owner = JSON.parse(bytes); } catch { return null; }
  if (owner?.protocol !== "layered-report-mutation-v1" || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.processStartIdentity !== "string" || !owner.processStartIdentity || typeof owner.nonce !== "string" || !owner.nonce || typeof owner.purpose !== "string" || !owner.purpose) return null;
  return owner;
}

export async function acquireReportMutationLock(reportPath, options = {}) {
  const resolvedReport = path.resolve(reportPath); const lockPath = `${resolvedReport}.lock`; const deadline = Date.now() + (options.timeoutMs ?? 5000); const identityProvider = options.processIdentityProvider ?? defaultProcessIdentity;
  const queueLock = await acquireTicketLock(`${lockPath}.bakery`, options.purpose ?? "report-mutation", { ...options, label: "shared report mutation queue" });
  const owner = { protocol: "layered-report-mutation-v1", pid: queueLock.owner.pid, processStartIdentity: queueLock.owner.processStartIdentity, nonce: queueLock.owner.nonce, purpose: options.purpose ?? "report-mutation" };
  const bytes = Buffer.from(`${JSON.stringify(owner)}\n`); const temporary = `${lockPath}.${process.pid}.${owner.nonce}.tmp`; const descriptor = openSync(temporary, "wx", 0o600);
  try { writeFileSync(descriptor, bytes); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  try {
    while (true) {
      try { linkSync(temporary, lockPath); unlinkSync(temporary); return { lockPath, owner, queueLock }; }
      catch (error) {
        if (error?.code !== "EEXIST") throw error;
        let currentBytes; try { currentBytes = readFileSync(lockPath, "utf8"); } catch (readError) { if (readError?.code === "ENOENT") continue; throw readError; }
        const current = parseReportLockOwner(currentBytes);
        if (!current) {
          if (Date.now() >= deadline) fail("shared report mutation lock timed out on an unreadable or legacy owner");
          await new Promise((resolve) => setTimeout(resolve, 10)); continue;
        }
        const identity = await identityProvider(current.pid); const state = ownerState(identity, current);
        if (state.dead) { try { unlinkSync(lockPath); } catch (removeError) { if (removeError?.code !== "ENOENT") throw removeError; } continue; }
        if (Date.now() >= deadline) fail("shared report mutation lock timed out");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  } catch (error) { rmSync(temporary, { force: true }); releaseTicketLock(queueLock); throw error; }
}

export function releaseReportMutationLock(lock) {
  if (!lock) return;
  try {
    let currentBytes; try { currentBytes = readFileSync(lock.lockPath, "utf8"); } catch (error) { if (error?.code === "ENOENT") return; throw error; }
    const current = parseReportLockOwner(currentBytes); if (!current || !sameValue(current, lock.owner)) fail("shared report mutation lock ownership changed before release");
    unlinkSync(lock.lockPath);
  } finally { releaseTicketLock(lock.queueLock); }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sameValue(left, right) { return stableJson(left) === stableJson(right); }

function sha256Bytes(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function writeExclusiveBytesAtomic(destination, bytes) {
  if (existsSync(destination)) fail(`frozen sidecar already exists: ${destination}`);
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`; const descriptor = openSync(temporary, "wx", 0o600);
  try { writeFileSync(descriptor, bytes); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  try { renameSync(temporary, destination); } catch (error) { rmSync(temporary, { force: true }); throw error; }
}

function readProtectionSource(sourcePath, layout) {
  const resolved = path.resolve(sourcePath ?? "");
  let bytes; try { bytes = readFileSync(resolved); } catch { fail(`protection contract source is missing: ${resolved}`); }
  let parsed; try { parsed = JSON.parse(bytes.toString("utf8")); } catch { fail("protection contract source must be valid JSON"); }
  const validated = validateProtectionContract(parsed, layout);
  return { ...validated, sourcePath: resolved, sourceSha256: sha256Bytes(bytes), bytes };
}

function inspectFrozenProtection(stageRoot, sourcePath, layout) {
  const current = readProtectionSource(sourcePath, layout); const frozenPath = path.join(stageRoot, "protection-contract.json");
  if (!existsSync(frozenPath)) fail("once-frozen protection contract sidecar is missing");
  const frozenBytes = readFileSync(frozenPath); const frozenSha256 = sha256Bytes(frozenBytes);
  if (frozenSha256 !== current.sourceSha256 || !frozenBytes.equals(current.bytes)) fail("protection contract source bytes do not match the once-frozen run sidecar");
  return {
    contract: current.contract,
    derived: current.derived,
    manifest: { sourcePath: current.sourcePath, sourceSha256: current.sourceSha256, path: frozenPath, size: frozenBytes.length, sha256: frozenSha256 },
  };
}

function freezeProtectionContract(stageRoot, sourcePath, layout) {
  const current = readProtectionSource(sourcePath, layout); const frozenPath = path.join(stageRoot, "protection-contract.json");
  if (!existsSync(frozenPath)) writeExclusiveBytesAtomic(frozenPath, current.bytes);
  return inspectFrozenProtection(stageRoot, sourcePath, layout);
}

function freezeNumericLighting(stageRoot, lightingInput) {
  const lighting = assertLighting(lightingInput);
  const manifestPath = path.join(stageRoot, "numeric-lighting.json");
  if (existsSync(manifestPath)) {
    let manifest; try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { fail("numeric lighting manifest is malformed"); }
    const frozen = assertLighting(manifest?.lighting);
    if (manifest?.schemaVersion !== 1 || !sameValue(frozen, lighting)) fail("numeric lighting must match the once-frozen run manifest; drift is forbidden");
    return { lighting: frozen, manifestPath, path: manifestPath, size: statSync(manifestPath).size, sha256: sha256File(manifestPath) };
  }
  writeJsonAtomic(manifestPath, { schemaVersion: 1, lighting });
  return { lighting, manifestPath, path: manifestPath, size: statSync(manifestPath).size, sha256: sha256File(manifestPath) };
}

function assertManifestHistory(report, frozen) {
  for (const candidate of report.stages.composite.candidates) {
    if (candidate.numericLightingManifest?.sha256 !== frozen.sha256 || !sameValue(candidate.numericLighting, frozen.lighting)) fail("numeric lighting manifest changed after a prior composite candidate");
  }
}

function sameArtifactProvenance(left, right) {
  return path.resolve(left?.path ?? "") === path.resolve(right?.path ?? "") && left?.size === right?.size && left?.sha256?.toLowerCase() === right?.sha256?.toLowerCase();
}

function exactSidecar(record, label, expectedPath) {
  const recordPath = record?.path ?? record?.manifestPath;
  if (typeof recordPath !== "string" || !Number.isInteger(record?.size) || record.size <= 0 || !/^[a-f0-9]{64}$/i.test(record?.sha256 ?? "")) fail(`${label} frozen sidecar record is invalid`);
  const resolved = path.resolve(recordPath); if (expectedPath && resolved !== path.resolve(expectedPath)) fail(`${label} path does not match the mandated run-root sidecar`);
  if (!existsSync(resolved)) fail(`${label} sidecar is missing`); const stats = statSync(resolved);
  if (!stats.isFile() || stats.size !== record.size || sha256File(resolved) !== record.sha256.toLowerCase()) fail(`${label} sidecar bytes changed`);
  return { path: resolved, bytes: readFileSync(resolved), record: { ...structuredClone(record), path: resolved, sha256: record.sha256.toLowerCase() } };
}

function findCandidateJournals(root, id) {
  if (!existsSync(root)) return [];
  const journals = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) journals.push(...findCandidateJournals(target, id));
    else if (entry.name === "attempt.json") {
      let value; try { value = JSON.parse(readFileSync(target, "utf8")); } catch { fail("composite attempt journal is malformed"); }
      if (value.candidateId === id && ["ready-to-publish", "published", "completed"].includes(value.status)) journals.push(value);
    }
  }
  return journals;
}

function frozenCompositeProvenance(candidate) {
  return { id: candidate.id, unrepairedComposite: candidate.unrepairedComposite ?? candidate.artifact, editableMask: candidate.editableMask, protectedMask: candidate.protectedMask, contactShadowMask: candidate.contactShadowMask, inputArtifacts: candidate.inputArtifacts, layout: candidate.layout, numericLighting: candidate.numericLighting, numericLightingManifest: candidate.numericLightingManifest, protectionContract: candidate.protectionContract, layerOrder: candidate.layerOrder, technicalValidation: candidate.technicalValidation };
}

export function validateCurrentCompositeChain(report, candidate, options = {}) {
  const reportPath = path.resolve(options.reportPath ?? ""); const stageRoot = path.join(path.dirname(reportPath), "composite");
  const inputs = reportInputs(report); const layout = candidate?.layout; assertLayout(layout); const normalized = normalizeInputs(inputs, layout);
  if (!candidate || candidate.invalidations?.length || candidate.state !== "accepted" || candidate.creativeAcceptance !== "accepted") fail("current composite must be accepted and not invalidated");
  for (const [label, record] of [["unrepaired composite", candidate.unrepairedComposite ?? candidate.artifact], ["editable mask", candidate.editableMask], ["protected mask", candidate.protectedMask], ["contact shadow mask", candidate.contactShadowMask]]) exactArtifact(record, label);
  if (!/^gray/.test(probeImage(candidate.editableMask.path).pixelFormat) || !/^gray/.test(probeImage(candidate.protectedMask.path).pixelFormat) || !/^gray/.test(probeImage(candidate.contactShadowMask.path).pixelFormat)) fail("composite editable, protected, and contact-shadow masks must be grayscale");
  if (candidate.technicalValidation?.deterministic !== true || candidate.technicalValidation?.generativeCalls !== 0 || candidate.technicalValidation?.protectedEditableIntersection !== 0) fail("composite technical validation is incomplete");
  if (!Array.isArray(candidate.layerOrder) || !sameValue(candidate.layerOrder, LAYER_ORDER)) fail("composite layer order changed");
  const journals = findCandidateJournals(path.join(stageRoot, "attempts", candidate.id), candidate.id);
  if (journals.length !== 1 || journals[0].candidateId !== candidate.id || journals[0].candidate?.id !== candidate.id || !sameValue(frozenCompositeProvenance(journals[0].candidate), frozenCompositeProvenance(candidate))) fail("composite candidate ID or provenance does not match its unique frozen attempt journal");
  if (!sameArtifactProvenance(candidate.inputArtifacts?.emptyPlate, normalized.inputs.emptyPlate)
    || !sameArtifactProvenance(candidate.inputArtifacts?.shen_yan?.transparentPng, normalized.inputs.shen_yan.transparentPng)
    || !sameArtifactProvenance(candidate.inputArtifacts?.shen_yan?.matte, normalized.inputs.shen_yan.matte)
    || !sameArtifactProvenance(candidate.inputArtifacts?.jiang_lan?.transparentPng, normalized.inputs.jiang_lan.transparentPng)
    || !sameArtifactProvenance(candidate.inputArtifacts?.jiang_lan?.matte, normalized.inputs.jiang_lan.matte)) fail("composite input artifact provenance does not match current accepted prerequisites");
  const lightingSidecar = exactSidecar(candidate.numericLightingManifest, "numeric lighting manifest", path.join(stageRoot, "numeric-lighting.json"));
  let lightingManifest; try { lightingManifest = JSON.parse(lightingSidecar.bytes); } catch { fail("numeric lighting manifest is malformed"); }
  if (lightingManifest.schemaVersion !== 1 || !sameValue(assertLighting(lightingManifest.lighting), assertLighting(candidate.numericLighting))) fail("numeric lighting does not deep-equal the frozen manifest");
  const protectionSidecar = exactSidecar(candidate.protectionContract?.manifest, "protection contract manifest", path.join(stageRoot, "protection-contract.json"));
  let protectionSource; try { protectionSource = JSON.parse(protectionSidecar.bytes); } catch { fail("protection contract manifest is malformed"); }
  const validatedProtection = validateProtectionContract(protectionSource, layout); const sourcePath = path.resolve(candidate.protectionContract.manifest.sourcePath ?? "");
  if (!sourcePath || !existsSync(sourcePath) || sha256File(sourcePath) !== candidate.protectionContract.manifest.sourceSha256 || !readFileSync(sourcePath).equals(protectionSidecar.bytes)) fail("protection contract reviewed source bytes changed");
  if (!sameValue(candidate.protectionContract.derived, validatedProtection.derived)) fail("protection contract derived regions do not match its source and layout");
  return { candidate, inputs: normalized.inputs, layout, lighting: lightingManifest.lighting, protection: validatedProtection };
}

function inspectNumericLighting(stageRoot, lightingInput) {
  const lighting = assertLighting(lightingInput); const manifestPath = path.join(stageRoot, "numeric-lighting.json");
  let manifest; try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { fail("once-frozen numeric lighting manifest is missing or malformed"); }
  const frozen = assertLighting(manifest?.lighting);
  if (manifest?.schemaVersion !== 1 || !sameValue(frozen, lighting)) fail("numeric lighting does not match the once-frozen run manifest");
  return { lighting: frozen, manifestPath, path: manifestPath, size: statSync(manifestPath).size, sha256: sha256File(manifestPath) };
}

async function inspectPublished(report, stageRoot, id, expected) {
  const attemptRoot = path.join(stageRoot, "attempts", id);
  if (!existsSync(attemptRoot)) return null;
  for (const directory of readdirSync(attemptRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
    const journal = path.join(attemptRoot, directory.name, "attempt.json");
    if (!existsSync(journal)) continue;
    let value; try { value = JSON.parse(readFileSync(journal, "utf8")); } catch { continue; }
    if (!["ready-to-publish", "published", "completed"].includes(value.status) || value.candidate?.id !== id) continue;
    const outputDirectory = path.join(stageRoot, id);
    for (const [key, name] of Object.entries(ARTIFACT_NAMES)) {
      if (path.resolve(value.candidate[key]?.path ?? "") !== path.resolve(outputDirectory, name)) fail(`recovery ${key} path does not match the immutable published directory`);
      exactArtifact(value.candidate[key], `recovery ${key}`);
    }
    const currentInputs = reportInputs(report);
    assertLayout(value.candidate.layout);
    if (!sameValue(value.candidate.layout, expected.layout)) fail("recovery layout does not match the requested immutable layout");
    if (!sameValue(value.candidate.numericLighting, assertLighting(expected.lighting))) fail("recovery numeric lighting does not match the requested run lighting");
    const recoveredLighting = inspectNumericLighting(stageRoot, value.candidate.numericLighting);
    if (value.candidate.numericLightingManifest?.sha256 !== recoveredLighting.sha256) fail("recovery numeric lighting manifest hash does not match the published journal");
    const sourcePath = path.resolve(expected.protectionContractPath ?? "");
    if (path.resolve(value.candidate.protectionContract?.manifest?.sourcePath ?? "") !== sourcePath) fail("recovery protection contract source path does not match the requested reviewed sidecar");
    const recoveredProtection = inspectFrozenProtection(stageRoot, sourcePath, value.candidate.layout);
    if (!sameValue(value.candidate.protectionContract, { manifest: recoveredProtection.manifest, derived: recoveredProtection.derived })) fail("recovery protection contract bytes or derived parameters do not match the published journal");
    normalizeInputs(currentInputs, value.candidate.layout);
    if (!sameArtifactProvenance(currentInputs.emptyPlate, value.candidate.inputArtifacts?.emptyPlate)) fail("recovery accepted empty plate does not match the published journal");
    for (const character of CHARACTERS) {
      if (!sameArtifactProvenance(currentInputs[character].transparentPng, value.candidate.inputArtifacts?.[character]?.transparentPng)
        || !sameArtifactProvenance(currentInputs[character].matte, value.candidate.inputArtifacts?.[character]?.matte)) fail(`recovery ${character} prerequisites do not match the published journal`);
    }
    if (value.status === "completed") {
      const recorded = report.stages.composite.candidates.filter((candidate) => candidate.id === id);
      if (recorded.length !== 1 || !sameValue(recorded[0], value.candidate)) fail("completed recovery journal does not exactly match its appended report candidate");
    }
    return { journal, value };
  }
  return null;
}

async function recoverPublished(reportPath, report, stageRoot, id, expected, lockOptions) {
  const reportLock = await acquireReportMutationLock(reportPath, { timeoutMs: lockOptions.timeoutMs, processIdentityProvider: lockOptions.processIdentityProvider, purpose: `composite-report-recovery:${id}` });
  try {
    const latest = loadReport(reportPath); const published = await inspectPublished(latest, stageRoot, id, expected);
    if (!published) return null;
    const next = appendCandidate(latest, "composite", published.value.candidate); writeJsonAtomic(reportPath, next);
    writeJsonAtomic(published.journal, { ...published.value, status: "completed" });
    return { candidate: next.stages.composite.candidates.at(-1), report: next };
  } finally { releaseReportMutationLock(reportLock); }
}

function abandonInterruptedAttempts(stageRoot) {
  const attemptRoot = path.join(stageRoot, "attempts");
  if (!existsSync(attemptRoot)) return;
  for (const candidateEntry of readdirSync(attemptRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const candidateRoot = path.join(attemptRoot, candidateEntry.name);
    for (const attemptEntry of readdirSync(candidateRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const journal = path.join(candidateRoot, attemptEntry.name, "attempt.json");
      if (!existsSync(journal)) continue;
      let value; try { value = JSON.parse(readFileSync(journal, "utf8")); } catch { continue; }
      const outputDirectory = path.join(stageRoot, value.candidateId ?? candidateEntry.name);
      if (["reserved", "failed"].includes(value.status) || (value.status === "ready-to-publish" && !existsSync(outputDirectory))) writeJsonAtomic(journal, { ...value, status: "abandoned", abandonedAt: Date.now(), reason: "owner exited before atomic publication" });
    }
  }
}

async function composeFromReport(args) {
  const reportPath = path.resolve(args.reportPath ?? ""); const candidateNumber = Number(args.candidate);
  if (![1, 2, 3].includes(candidateNumber)) fail("candidate must be 1, 2, or 3");
  const id = `candidate_${String(candidateNumber).padStart(3, "0")}`; const stageRoot = path.join(path.dirname(reportPath), "composite");
  mkdirSync(stageRoot, { recursive: true });
  const layout = args.layout ?? createRiverLayout(); assertLayout(layout);
  const expected = { layout, lighting: args.lighting ?? DEFAULT_COMPOSITE_LIGHTING, protectionContractPath: args.protectionContractPath };
  assertLighting(expected.lighting); readProtectionSource(expected.protectionContractPath, layout);
  const commonLockOptions = { timeoutMs: args.lockTimeoutMs ?? 5000, processIdentityProvider: args.processIdentityProvider, afterSequenceReserved: args.afterSequenceReserved, afterNumberSelectionSnapshot: args.afterNumberSelectionSnapshot, afterTicketTemporaryFsynced: args.afterTicketTemporaryFsynced, afterTicketPublished: args.afterTicketPublished, afterAdmissionSnapshot: args.afterAdmissionSnapshot, ticketCreatedAt: args.ticketCreatedAt, ticketNonce: args.ticketNonce };
  const runQueue = path.join(stageRoot, ".compose-run.queue"); let runLock;
  try {
    runLock = await acquireTicketLock(runQueue, `composite-run:${id}`, { ...commonLockOptions, label: "composite run queue" });
    await args.afterRunLockAcquired?.({ ticketPath: runLock.ticketPath, candidate: id });
    abandonInterruptedAttempts(stageRoot);
    const report = loadReport(reportPath);
    if (report.stages.composite.candidates.some((item) => item.id === id)) fail(`composite ${id} already exists`);
    const outputDirectory = path.join(stageRoot, id);
    if (existsSync(outputDirectory)) {
      const latest = loadReport(reportPath); const recovered = await recoverPublished(reportPath, latest, stageRoot, id, expected, commonLockOptions);
      if (!recovered) fail(`composite ${id} output exists without a recoverable published journal`);
      return {
        ...Object.fromEntries(Object.entries(ARTIFACT_NAMES).map(([key, name]) => [key, path.join(outputDirectory, name)])),
        ...recovered,
        reportPath,
      };
    }
    const inputs = reportInputs(report);
    const frozenLighting = freezeNumericLighting(stageRoot, expected.lighting); const lighting = frozenLighting.lighting;
    const protection = freezeProtectionContract(stageRoot, args.protectionContractPath, layout);
    assertManifestHistory(report, frozenLighting);
    const attemptDirectory = path.join(stageRoot, "attempts", id, `${Date.now()}-${process.pid}-${randomUUID()}`);
    mkdirSync(attemptDirectory, { recursive: true }); const journal = path.join(attemptDirectory, "attempt.json");
    writeJsonAtomic(journal, { status: "reserved", stage: "composite", candidateId: id, createdAt: Date.now() });
    await args.afterAttemptReserved?.({ journalPath: journal, attemptDirectory, candidate: id });
    const attemptOutput = path.join(attemptDirectory, "output");
    try {
      const attemptArtifacts = composeDirect({ inputs, outputDirectory: attemptOutput, layout, lighting, protectionContract: protection.contract });
      const outputs = Object.fromEntries(Object.entries(ARTIFACT_NAMES).map(([key, name]) => [key, path.join(outputDirectory, name)]));
      const record = candidateRecord(id, attemptArtifacts, inputs, layout, lighting, { path: frozenLighting.manifestPath, manifestPath: frozenLighting.manifestPath, size: frozenLighting.size, sha256: frozenLighting.sha256 }, protection);
      for (const key of Object.keys(ARTIFACT_NAMES)) record[key].path = outputs[key];
      record.artifact = structuredClone(record.unrepairedComposite);
      writeJsonAtomic(journal, { status: "ready-to-publish", stage: "composite", candidateId: id, createdAt: Date.now(), candidate: record });
      args.afterReadyToPublishJournal?.({ journalPath: journal, attemptDirectory, attemptOutput, outputDirectory, candidate: structuredClone(record) });
      renameSync(attemptOutput, outputDirectory);
      args.afterArtifactDirectoryPublished?.({ journalPath: journal, outputDirectory, candidate: structuredClone(record) });
      writeJsonAtomic(journal, { status: "published", stage: "composite", candidateId: id, createdAt: Date.now(), candidate: record });
      args.afterPublishedJournal?.({ journalPath: journal, outputDirectory, candidate: structuredClone(record) });
      const reportLock = await acquireReportMutationLock(reportPath, { timeoutMs: commonLockOptions.timeoutMs, processIdentityProvider: commonLockOptions.processIdentityProvider, purpose: `composite-report-append:${id}` });
      try {
        const latest = loadReport(reportPath);
        if (latest.stages.composite.candidates.some((item) => item.id === id)) fail(`composite ${id} already exists`);
        const latestInputs = reportInputs(latest);
        normalizeInputs(latestInputs, layout);
        const latestLighting = freezeNumericLighting(stageRoot, lighting);
        assertManifestHistory(latest, latestLighting);
        if (latestLighting.sha256 !== record.numericLightingManifest.sha256) fail("numeric lighting manifest changed during processing");
        const latestProtection = freezeProtectionContract(stageRoot, args.protectionContractPath, layout);
        if (!sameValue(record.protectionContract, { manifest: latestProtection.manifest, derived: latestProtection.derived })) fail("protection contract bytes or derived parameters changed during processing");
        for (const character of CHARACTERS) if (latestInputs[character].matte.sha256 !== inputs[character].matte.sha256 || latestInputs[character].transparentPng.sha256 !== inputs[character].transparentPng.sha256) fail("accepted composite prerequisites changed during processing");
        if (latestInputs.emptyPlate.sha256 !== inputs.emptyPlate.sha256) fail("accepted empty plate changed during processing");
        const next = appendCandidate(latest, "composite", record); writeJsonAtomic(reportPath, next);
        writeJsonAtomic(journal, { status: "completed", stage: "composite", candidateId: id, createdAt: Date.now(), candidate: record });
        return { ...outputs, candidate: next.stages.composite.candidates.at(-1), report: next, reportPath };
      } finally { releaseReportMutationLock(reportLock); }
    } catch (error) {
      if (existsSync(journal)) {
        let current = {}; try { current = JSON.parse(readFileSync(journal, "utf8")); } catch { /* keep failure evidence */ }
        if (!["ready-to-publish", "published", "completed"].includes(current.status)) writeJsonAtomic(journal, { ...current, status: "failed", error: error.message });
      }
      throw error;
    }
  } finally {
    releaseTicketLock(runLock);
  }
}

export async function composeDeterministically(args = {}) {
  if (args.reportPath) return composeFromReport(args);
  return composeDirect(args);
}
