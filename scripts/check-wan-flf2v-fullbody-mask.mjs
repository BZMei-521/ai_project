import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  FULLBODY_FEATHER_PIXELS,
  FULLBODY_MASK_PROFILE,
  createFullBodyContextMaskArtifacts
} from "./lib/wan-flf2v-fullbody-mask.mjs";

const width = 1152;
const height = 640;
const expectedEditableEnvelope = [
  [330, 18], [505, 18], [570, 92], [590, 230],
  [590, 632], [300, 632], [300, 230], [315, 92]
];
const expectedJiangProtection = [
  [590, 45], [850, 45], [875, 630], [580, 630]
];
const expectedFeatherPixels = 28;

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isInside(point, polygon) {
  const [x, y] = point;
  let inside = false;
  for (let index = 0, prior = polygon.length - 1; index < polygon.length; prior = index++) {
    const [xi, yi] = polygon[index];
    const [xj, yj] = polygon[prior];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function decodeRgbPng(path) {
  const result = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], {
    encoding: null,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(`PNG decode failed: ${result.stderr?.toString() || result.stdout?.toString()}`);
  assert.equal(result.stdout.length, width * height * 3, "decoded PNG must be 1152x640 rgb24");
  return result.stdout;
}

function pngGeometry(path) {
  const parsed = JSON.parse(run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,pix_fmt", "-of", "json", path], "ffprobe"));
  const stream = parsed.streams?.[0];
  assert.equal(stream?.width, width, "PNG width");
  assert.equal(stream?.height, height, "PNG height");
  assert.match(stream?.pix_fmt ?? "", /^rgb/, "PNG must be RGB");
}

function createSourceFixture(path) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 3;
    pixels[offset] = (x * 17 + y * 3) % 256;
    pixels[offset + 1] = (x * 5 + y * 11) % 256;
    pixels[offset + 2] = (x + y * 7) % 256;
  }
  const ppm = `${path}.${process.pid}.${randomUUID()}.ppm`;
  try {
    writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii"), pixels]));
    run("ffmpeg", ["-y", "-v", "error", "-i", ppm, "-frames:v", "1", "-c:v", "png", "-pix_fmt", "rgb24", path], "source PNG encode");
  } finally {
    rmSync(ppm, { force: true });
  }
}

function expectedOverlay(source, color) {
  return source.map((channel, index) => Math.round(channel * 0.55 + color[index] * 0.45));
}

assert.equal(FULLBODY_MASK_PROFILE, "full-body-context-v1");
assert.equal(FULLBODY_FEATHER_PIXELS, expectedFeatherPixels);
for (const oldPoint of [[420, 250], [515, 250], [405, 420], [570, 625]]) {
  assert.equal(expectedEditableEnvelope.some(([x, y]) => x === oldPoint[0] && y === oldPoint[1]), false, `old cut point ${oldPoint} is not a new editable-envelope vertex`);
  assert.equal(expectedJiangProtection.some(([x, y]) => x === oldPoint[0] && y === oldPoint[1]), false, `old cut point ${oldPoint} is not a new Jiang-protection vertex`);
}

const root = mkdtempSync(join(tmpdir(), "wan-fullbody-mask-check-"));
try {
  const invalidCases = [
    { name: "missing", path: join(root, "missing.png"), expected: /missing or empty/ },
    { name: "empty", path: join(root, "empty.png"), expected: /missing or empty/ },
    { name: "undecodable", path: join(root, "undecodable.png"), expected: /undecodable/ }
  ];
  writeFileSync(invalidCases[1].path, Buffer.alloc(0));
  writeFileSync(invalidCases[2].path, Buffer.from("not a PNG", "utf8"));
  for (const invalid of invalidCases) {
    const invalidOutputDir = join(root, `out-${invalid.name}`);
    assert.throws(
      () => createFullBodyContextMaskArtifacts({ outputDir: invalidOutputDir, sourcePath: invalid.path }),
      invalid.expected,
      `${invalid.name} source is rejected`
    );
    assert.equal(existsSync(invalidOutputDir), false, `${invalid.name} source is rejected before outputDir creation`);
  }

  const wrongSizePath = join(root, "wrong-size.png");
  run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64", "-frames:v", "1", "-c:v", "png", "-pix_fmt", "rgb24", wrongSizePath], "wrong-size PNG encode");
  const wrongSizeOutputDir = join(root, "out-wrong-size");
  assert.throws(
    () => createFullBodyContextMaskArtifacts({ outputDir: wrongSizeOutputDir, sourcePath: wrongSizePath }),
    /1152x640/,
    "wrong-size source is rejected"
  );
  assert.equal(existsSync(wrongSizeOutputDir), false, "wrong-size source is rejected before outputDir creation");

  const sourcePath = join(root, "source.png");
  createSourceFixture(sourcePath);
  const artifacts = createFullBodyContextMaskArtifacts({ outputDir: join(root, "out"), sourcePath });
  for (const key of ["maskPath", "lockedMaskPath", "diagnosticPath"]) {
    assert.ok(existsSync(artifacts[key]), `${key} exists`);
    assert.ok(statSync(artifacts[key]).size > 0, `${key} is non-empty`);
  }
  for (const key of ["maskSha256", "lockedMaskSha256", "diagnosticSha256"]) assert.match(artifacts[key], /^[a-f0-9]{64}$/, `${key} is SHA-256`);
  assert.equal(artifacts.maskSha256, sha256(artifacts.maskPath));
  assert.equal(artifacts.lockedMaskSha256, sha256(artifacts.lockedMaskPath));
  assert.equal(artifacts.diagnosticSha256, sha256(artifacts.diagnosticPath));
  pngGeometry(artifacts.maskPath);
  pngGeometry(artifacts.lockedMaskPath);
  pngGeometry(artifacts.diagnosticPath);

  const repeated = createFullBodyContextMaskArtifacts({ outputDir: join(root, "out-repeated"), sourcePath });
  assert.equal(repeated.maskSha256, artifacts.maskSha256, "mask is deterministic");
  assert.equal(repeated.lockedMaskSha256, artifacts.lockedMaskSha256, "locked mask is deterministic");
  assert.equal(repeated.diagnosticSha256, artifacts.diagnosticSha256, "diagnostic is deterministic");

  const mask = decodeRgbPng(artifacts.maskPath);
  const locked = decodeRgbPng(artifacts.lockedMaskPath);
  const source = decodeRgbPng(sourcePath);
  const diagnostic = decodeRgbPng(artifacts.diagnosticPath);
  const maskAt = (x, y) => mask[(y * width + x) * 3];
  const lockedAt = (x, y) => locked[(y * width + x) * 3];
  const rgbAt = (pixels, x, y) => [...pixels.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
  assert.equal(maskAt(440, 40), 255, "hair is fully editable");
  assert.equal(maskAt(350, 300), 255, "screen-left sleeve is fully editable");
  assert.equal(maskAt(535, 315), 255, "screen-right hand is fully editable");
  assert.equal(maskAt(410, 590), 255, "screen-left boot is fully editable");
  assert.equal(maskAt(530, 590), 255, "screen-right boot is fully editable");
  assert.equal(maskAt(710, 250), 0, "Jiang Lan is excluded");
  assert.equal(maskAt(720, 575), 0, "Jiang Lan lower body is excluded");
  assert.equal(maskAt(1000, 320), 0, "far background is locked");
  assert.ok(maskAt(305, 200) > 0 && maskAt(305, 200) < 255, "outer boundary is feathered");
  assert.deepEqual(rgbAt(diagnostic, 440, 40), expectedOverlay(rgbAt(source, 440, 40), [0, 255, 255]), "editable core diagnostic is 45% cyan");
  assert.deepEqual(rgbAt(diagnostic, 305, 200), expectedOverlay(rgbAt(source, 305, 200), [255, 191, 0]), "feather diagnostic is 45% amber");
  assert.deepEqual(rgbAt(diagnostic, 710, 250), expectedOverlay(rgbAt(source, 710, 250), [255, 0, 0]), "Jiang protection diagnostic is 45% red");
  assert.deepEqual(rgbAt(diagnostic, 1000, 320), rgbAt(source, 1000, 320), "locked diagnostic pixels are unchanged");
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (isInside([x, y], expectedJiangProtection)) assert.equal(maskAt(x, y), 0, `Jiang-protected pixel ${x},${y} must remain zero`);
    assert.equal(lockedAt(x, y), maskAt(x, y) === 0 ? 255 : 0, `locked mask complements final mask at ${x},${y}`);
  }
  assert.deepEqual(readdirSync(join(root, "out")).sort(), ["locked_region_mask.png", "mask.png", "mask_diagnostic.png"], "owned temporaries are removed");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("Wan FLF2V full-body mask contract: PASS");
