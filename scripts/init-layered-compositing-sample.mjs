import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createRunReport, sha256File, writeJsonAtomic } from "./lib/layered-compositing-run.mjs";

const MOTHER_FRAME = "C:/Users/Administrator/AppData/Local/Comfy-Desktop/ComfyUI-Shared/output/Storyboard/河边远景建立_klein_ref_00006_.png";
const APPROVED_ROOT = "C:/Users/Administrator/Desktop/ai_project/logs";
const OUTPUT_REPORT = "run-report.json";

function fail(message) {
  throw new Error(`Layered compositing initializer: ${message}`);
}

function parseArgs(args) {
  if (args.length !== 2 || args[0] !== "--output" || !args[1]) fail("usage: --output logs/layered-two-character-sample");
  return path.resolve(args[1]);
}

function resource(filePath, label) {
  const resolved = path.resolve(filePath);
  if (!existsSync(resolved)) fail(`${label} is missing: ${resolved}`);
  const stats = statSync(resolved);
  if (!stats.isFile() || stats.size <= 0) fail(`${label} is empty or not a file: ${resolved}`);
  return { path: resolved, size: stats.size, sha256: sha256File(resolved) };
}

function pngDimensions(filePath) {
  const header = readFileSync(filePath, { encoding: null }).subarray(0, 24);
  const signature = "89504e470d0a1a0a";
  if (header.length < 24 || header.subarray(0, 8).toString("hex") !== signature || header.subarray(12, 16).toString("ascii") !== "IHDR") {
    fail(`mother frame is not a decodable PNG: ${filePath}`);
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function main() {
  const outputDirectory = parseArgs(process.argv.slice(2));
  const source = resource(MOTHER_FRAME, "mother frame");
  const dimensions = pngDimensions(source.path);
  if (dimensions.width !== 1152 || dimensions.height !== 640) fail(`mother frame geometry must be 1152x640, got ${dimensions.width}x${dimensions.height}`);
  const shenFace = resource(path.join(APPROVED_ROOT, "shen-yan-zimage-hero-v1", "hero-2026080913.png"), "Shen Yan face/body");
  const shenFront = resource(path.join(APPROVED_ROOT, "shen-yan-hybrid-v5", "front.png"), "Shen Yan front structure");
  const shenSide = resource(path.join(APPROVED_ROOT, "shen-yan-hybrid-v5", "side.png"), "Shen Yan side structure");
  const shenBack = resource(path.join(APPROVED_ROOT, "shen-yan-hybrid-v5", "back.png"), "Shen Yan back structure");
  const jiangFace = resource(path.join(APPROVED_ROOT, "jiang-lan-zimage-hero-v2", "hero-2026080931.png"), "Jiang Lan face/body");
  const jiangFront = resource(path.join(APPROVED_ROOT, "jiang-lan-hybrid-v1", "front.png"), "Jiang Lan front structure");
  const jiangSide = resource(path.join(APPROVED_ROOT, "jiang-lan-hybrid-v1", "side.png"), "Jiang Lan side structure");
  const jiangBack = resource(path.join(APPROVED_ROOT, "jiang-lan-hybrid-v1", "back.png"), "Jiang Lan back structure");
  if (existsSync(outputDirectory)) fail(`output directory already exists: ${outputDirectory}`);

  const report = createRunReport({
    source: { ...source, width: 1152, height: 640 },
    characters: {
      shen_yan: { name: "沈砚", species: "human", faceMaster: shenFace, bodyFront: shenFace, structureFront: shenFront, structureSide: shenSide, structureBack: shenBack },
      jiang_lan: { name: "江岚", species: "human", faceMaster: jiangFace, bodyFront: jiangFace, structureFront: jiangFront, structureSide: jiangSide, structureBack: jiangBack },
    },
    lighting: {
      key: "warm sunset from screen-right/rear",
      fill: "soft fill from screen-left/front",
      shadow: "screen-left/front",
    },
  });
  mkdirSync(path.dirname(outputDirectory), { recursive: true });
  mkdirSync(outputDirectory, { recursive: false });
  writeJsonAtomic(path.join(outputDirectory, OUTPUT_REPORT), report);
  console.log(`Layered compositing sample initialized: ${path.join(outputDirectory, OUTPUT_REPORT)}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
