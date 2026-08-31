import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const SHOTS = ["E01-S01-C19", "E01-S01-C20", "E01-S01-C21", "E01-S01-C22"];
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const required = (name) => {
  const value = args.get(name);
  if (!value) throw new TypeError(`missing_argument:${name}`);
  return value;
};
const runs = required("--runs").split(",").map((value) => resolve(value));
if (runs.length !== SHOTS.length) throw new TypeError("runs_must_match_four_shots");
const inputsDir = resolve(required("--inputs"));
const outputRoot = resolve(required("--output"));
const ffmpeg = args.get("--ffmpeg");
const python = args.get("--python");
if (!ffmpeg && !python) throw new TypeError("missing_argument:--ffmpeg_or_--python");
const pillowComposer = resolve(new URL("./compose-unity-control-images.py", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function pngDimensions(bytes, path) {
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") throw new TypeError(`not_png:${path}`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
async function json(path) { return JSON.parse(await readFile(path, "utf8")); }
async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}
async function checkedArtifact(run, artifact) {
  const path = join(run, artifact.filePath);
  const bytes = await readFile(path);
  if (digest(bytes) !== artifact.sha256) throw new TypeError(`unity_artifact_hash_mismatch:${path}`);
  if (artifact.width !== 1280 || artifact.height !== 720) throw new TypeError(`unity_artifact_dimensions_invalid:${path}`);
  return path;
}
function palette(entityId) {
  const bytes = createHash("sha256").update(entityId).digest();
  return [64 + (bytes[0] % 160), 64 + (bytes[1] % 160), 64 + (bytes[2] % 160)];
}
function runFfmpeg(inputPaths, filters, output) {
  return new Promise((accept, reject) => {
    const temporary = `${output}.${process.pid}.png`;
    const child = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...inputPaths.flatMap((path) => ["-i", path]), "-filter_complex", filters, "-map", "[out]", "-frames:v", "1", temporary], { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("error", reject);
    child.on("close", async (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg_failed:${code}:${error.trim()}`));
      try { await rename(temporary, output); accept(); } catch (reason) { reject(reason); }
    });
  });
}
function runPillow(mode, inputArguments, output) {
  return new Promise((accept, reject) => {
    const child = spawn(python, [pillowComposer, mode, output, ...inputArguments], { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? accept() : reject(new Error(`pillow_composer_failed:${code}:${error.trim()}`)));
  });
}
function idFilters(entities) {
  const colored = entities.map((entity, index) => {
    const [r, g, b] = palette(entity.id).map((value) => (value / 255).toFixed(6));
    return `[${index}:v]format=rgb24,colorchannelmixer=rr=${r}:rg=0:rb=0:gr=0:gg=${g}:gb=0:br=0:bg=0:bb=${b}[c${index}]`;
  });
  let current = "c0";
  for (let index = 1; index < entities.length; index += 1) {
    const next = index === entities.length - 1 ? "out" : `b${index}`;
    colored.push(`[${current}][c${index}]blend=all_mode=addition[${next}]`);
    current = next;
  }
  if (entities.length === 1) colored.push("[c0]copy[out]");
  return colored.join(";");
}
function poseFilters(count) {
  if (count === 1) return "[0:v]copy[out]";
  const filters = [];
  let current = "0:v";
  for (let index = 1; index < count; index += 1) {
    const next = index === count - 1 ? "out" : `p${index}`;
    filters.push(`[${current}][${index}:v]blend=all_mode=lighten[${next}]`);
    current = next;
  }
  return filters.join(";");
}

const bundles = [];
for (let index = 0; index < SHOTS.length; index += 1) {
  const shotId = SHOTS[index];
  const run = runs[index];
  const source = await json(join(inputsDir, `${shotId}.unity-exchange.json`));
  const scene = await json(join(run, "scene.json"));
  const preflight = await json(join(run, "preflight.json"));
  const manifest = await json(join(run, "manifest.json"));
  await stat(join(run, "layered-control-receipt.json"));
  if (!preflight.valid || scene.source.shotId !== shotId || scene.source.stageDigest !== source.source.stageDigest) throw new TypeError(`unity_lineage_invalid:${shotId}`);
  const by = (kind, entityId = "") => {
    const artifact = manifest.artifacts.find((item) => item.kind === kind && item.entityId === entityId);
    if (!artifact) throw new TypeError(`unity_artifact_missing:${shotId}:${kind}:${entityId}`);
    return artifact;
  };
  const outputDir = join(outputRoot, shotId);
  await mkdir(outputDir, { recursive: true });
  const canonical = [];
  for (const kind of ["color", "depth", "normal"]) {
    const artifact = by(kind);
    const sourcePath = await checkedArtifact(run, artifact);
    const target = join(outputDir, `${kind}.png`);
    await copyFile(sourcePath, target);
    canonical.push({ kind, path: target, encoding: artifact.encoding });
  }
  const subjects = source.entities.filter((entity) => entity.role === "subject");
  const props = source.entities.filter((entity) => entity.role === "interaction" || entity.role === "foreground_occluder");
  const environments = source.entities.filter((entity) => entity.role === "environment");
  for (const [kind, entities] of [["character_id", subjects], ["prop_id", props], ["environment_id", environments]]) {
    const masks = await Promise.all(entities.map((entity) => checkedArtifact(run, by("visible_mask", entity.id))));
    const target = join(outputDir, `${kind}.png`);
    if (ffmpeg) await runFfmpeg(masks, idFilters(entities), target);
    else await runPillow("ids", entities.map((entity, entityIndex) => `${palette(entity.id).join(",")}=${masks[entityIndex]}`), target);
    canonical.push({ kind, path: target, encoding: "stable_entity_id_rgb8", palette: Object.fromEntries(entities.map((entity) => [entity.id, palette(entity.id)])) });
  }
  const poses = [];
  for (const subject of subjects) for (const kind of ["openpose", "hand_pose", "orientation"]) poses.push(await checkedArtifact(run, by(kind, subject.id)));
  const posePath = join(outputDir, "pose.png");
  if (ffmpeg) await runFfmpeg(poses, poseFilters(poses.length), posePath);
  else await runPillow("pose", poses, posePath);
  canonical.push({ kind: "pose", path: posePath, encoding: "openpose_body18_and_hand21_rgb8" });
  const artifacts = [];
  for (const item of canonical) {
    const bytes = await readFile(item.path);
    const dimensions = pngDimensions(bytes, item.path);
    if (dimensions.width !== 1280 || dimensions.height !== 720) throw new TypeError(`canonical_artifact_dimensions_invalid:${item.path}`);
    artifacts.push({ ...item, path: item.path.replaceAll("\\", "/"), ...dimensions, sha256: digest(bytes) });
  }
  const controlPack = {
    schemaVersion: 1,
    workflow: "unity_previs_identity_isolated_controls_v3",
    state: "validated",
    shotId,
    stage: source.source,
    geometryAuthority: "unity",
    panoramaRole: "fixed_world_material",
    unityExport: run.replaceAll("\\", "/"),
    artifacts,
    generatedAt: new Date().toISOString()
  };
  const manifestPath = join(outputDir, "control-pack.json");
  await atomicJson(manifestPath, controlPack);
  bundles.push({ shotId, manifestPath: manifestPath.replaceAll("\\", "/"), manifestSha256: digest(await readFile(manifestPath)) });
}
await atomicJson(join(outputRoot, "control-pack-bundle.json"), { schemaVersion: 1, workflow: "unity_previs_identity_isolated_controls_v3", state: "validated", bundles, generatedAt: new Date().toISOString() });
console.log(JSON.stringify({ valid: true, outputRoot, shots: bundles.length }));
