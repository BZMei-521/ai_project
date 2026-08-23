import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const WIDTH = 1152;
const HEIGHT = 640;

export const FULLBODY_MASK_PROFILE = "full-body-context-v1";
export const FULLBODY_FEATHER_PIXELS = 28;
export const FULLBODY_EDITABLE_ENVELOPE = Object.freeze([
  [330, 18], [505, 18], [570, 92], [590, 230],
  [590, 632], [300, 632], [300, 230], [315, 92]
].map(Object.freeze));
export const JIANG_PROTECTION_POLYGON = Object.freeze([
  [590, 45], [850, 45], [875, 630], [580, 630]
].map(Object.freeze));

function fail(message) {
  throw new Error(`fullbody_mask: ${message}`);
}

function run(command, args, label, encoding = "utf8") {
  const result = spawnSync(command, args, { encoding, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) fail(`${label} failed: ${result.stderr?.toString() || result.stdout?.toString() || "unknown error"}`);
  return result.stdout;
}

function pointInside(x, y, polygon) {
  let inside = false;
  for (let index = 0, prior = polygon.length - 1; index < polygon.length; prior = index++) {
    const [xi, yi] = polygon[index];
    const [xj, yj] = polygon[prior];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function leftEnvelopeBoundary(y) {
  const intersections = [];
  for (let index = 0, prior = FULLBODY_EDITABLE_ENVELOPE.length - 1; index < FULLBODY_EDITABLE_ENVELOPE.length; prior = index++) {
    const [x1, y1] = FULLBODY_EDITABLE_ENVELOPE[prior];
    const [x2, y2] = FULLBODY_EDITABLE_ENVELOPE[index];
    if ((y1 <= y && y < y2) || (y2 <= y && y < y1)) intersections.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
  }
  return intersections.length ? Math.min(...intersections) : Number.POSITIVE_INFINITY;
}

function validateSourcePath(sourcePath) {
  if (typeof sourcePath !== "string" || sourcePath.length === 0) fail("sourcePath is required");
  const source = resolve(sourcePath);
  if (!existsSync(source) || !statSync(source).isFile() || statSync(source).size === 0) fail("source PNG is missing or empty");
  let parsed;
  try {
    parsed = JSON.parse(run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height", "-of", "json", source], "source PNG probe"));
  } catch (error) {
    fail(`source PNG is undecodable: ${error.message}`);
  }
  const stream = parsed.streams?.[0];
  if (!stream) fail("source PNG is undecodable");
  if (stream?.codec_name !== "png") fail("source must be a PNG");
  if (!Number.isInteger(stream.width) || stream.width <= 0 || !Number.isInteger(stream.height) || stream.height <= 0) fail("source PNG is undecodable");
  if (stream.width !== WIDTH || stream.height !== HEIGHT) fail(`source must be ${WIDTH}x${HEIGHT}`);
  const pixels = run("ffmpeg", ["-v", "error", "-i", source, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], "source PNG decode", null);
  if (pixels.length !== WIDTH * HEIGHT * 3) fail("source PNG decoded pixel data has the wrong size");
  return { source, pixels };
}

function writePpm(path, pixels) {
  writeFileSync(path, Buffer.concat([Buffer.from(`P6\n${WIDTH} ${HEIGHT}\n255\n`, "ascii"), pixels]));
}

function encodePng(inputPath, outputPath, filter) {
  const args = ["-y", "-v", "error", "-i", inputPath, "-frames:v", "1"];
  if (filter) args.push("-vf", filter);
  args.push("-c:v", "png", "-pix_fmt", "rgb24", "-pred", "mixed", "-compression_level", "9", "-threads", "1", outputPath);
  run("ffmpeg", args, "PNG encode");
}

function decodeRgb(path, label) {
  const pixels = run("ffmpeg", ["-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], label, null);
  if (pixels.length !== WIDTH * HEIGHT * 3) fail(`${label} produced the wrong decoded pixel size`);
  return pixels;
}

function validateOutputPng(path, label) {
  if (!existsSync(path) || statSync(path).size === 0) fail(`${label} is missing or empty`);
  let parsed;
  try {
    parsed = JSON.parse(run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,pix_fmt", "-of", "json", path], `${label} probe`));
  } catch (error) {
    fail(`${label} is undecodable: ${error.message}`);
  }
  const stream = parsed.streams?.[0];
  if (stream?.codec_name !== "png" || stream.width !== WIDTH || stream.height !== HEIGHT || !/^rgb/.test(stream.pix_fmt ?? "")) fail(`${label} must be a decodable ${WIDTH}x${HEIGHT} RGB PNG`);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function createFullBodyContextMaskArtifacts({ outputDir, sourcePath } = {}) {
  if (typeof outputDir !== "string" || outputDir.length === 0) fail("outputDir is required");
  const { pixels: sourcePixels } = validateSourcePath(sourcePath);
  const root = resolve(outputDir);
  const token = `${process.pid}-${randomUUID()}`;
  const basePpm = join(root, `.fullbody-base-${token}.ppm`);
  const blurredPng = join(root, `.fullbody-blurred-${token}.png`);
  const finalPpm = join(root, `.fullbody-final-${token}.ppm`);
  const lockedPpm = join(root, `.fullbody-locked-${token}.ppm`);
  const diagnosticPpm = join(root, `.fullbody-diagnostic-${token}.ppm`);
  const maskPath = join(root, "mask.png");
  const lockedMaskPath = join(root, "locked_region_mask.png");
  const diagnosticPath = join(root, "mask_diagnostic.png");
  mkdirSync(root, { recursive: true });
  try {
    const base = Buffer.alloc(WIDTH * HEIGHT * 3);
    for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
      const editable = pointInside(x, y, FULLBODY_EDITABLE_ENVELOPE) && !pointInside(x, y, JIANG_PROTECTION_POLYGON);
      base.fill(editable ? 255 : 0, (y * WIDTH + x) * 3, (y * WIDTH + x + 1) * 3);
    }
    writePpm(basePpm, base);
    encodePng(basePpm, blurredPng, `boxblur=${FULLBODY_FEATHER_PIXELS}:1,format=rgb24`);
    const mask = decodeRgb(blurredPng, "feathered mask decode");
    for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
      const offset = (y * WIDTH + x) * 3;
      const editable = pointInside(x, y, FULLBODY_EDITABLE_ENVELOPE) && !pointInside(x, y, JIANG_PROTECTION_POLYGON);
      if (editable && x - leftEnvelopeBoundary(y) >= FULLBODY_FEATHER_PIXELS) mask.fill(255, offset, offset + 3);
      if (pointInside(x, y, JIANG_PROTECTION_POLYGON)) mask.fill(0, offset, offset + 3);
    }
    writePpm(finalPpm, mask);
    encodePng(finalPpm, maskPath);

    const locked = Buffer.alloc(mask.length);
    const diagnostic = Buffer.from(sourcePixels);
    for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
      const offset = (y * WIDTH + x) * 3;
      const protectedPixel = pointInside(x, y, JIANG_PROTECTION_POLYGON);
      const value = mask[offset];
      locked.fill(value === 0 ? 255 : 0, offset, offset + 3);
      const color = protectedPixel ? [255, 0, 0] : value === 255 ? [0, 255, 255] : value > 0 ? [255, 191, 0] : null;
      if (color) for (let channel = 0; channel < 3; channel += 1) diagnostic[offset + channel] = Math.round(sourcePixels[offset + channel] * 0.55 + color[channel] * 0.45);
    }
    writePpm(lockedPpm, locked);
    writePpm(diagnosticPpm, diagnostic);
    encodePng(lockedPpm, lockedMaskPath);
    encodePng(diagnosticPpm, diagnosticPath);
    validateOutputPng(maskPath, "mask PNG");
    validateOutputPng(lockedMaskPath, "locked-region mask PNG");
    validateOutputPng(diagnosticPath, "mask diagnostic PNG");
    return {
      maskPath,
      lockedMaskPath,
      diagnosticPath,
      maskSha256: sha256(maskPath),
      lockedMaskSha256: sha256(lockedMaskPath),
      diagnosticSha256: sha256(diagnosticPath)
    };
  } finally {
    for (const path of [basePpm, blurredPng, finalPpm, lockedPpm, diagnosticPpm]) rmSync(path, { force: true });
  }
}
