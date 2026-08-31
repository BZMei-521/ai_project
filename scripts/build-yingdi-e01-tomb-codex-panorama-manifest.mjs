import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const required = (name) => {
  const value = args.get(name);
  if (!value) throw new TypeError(`missing_argument:${name}`);
  return value;
};
const root = resolve(required("--root"));
const sourceGeneratedPath = resolve(required("--source"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function png(path) {
  const bytes = await readFile(path);
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") throw new TypeError(`not_png:${path}`);
  return { path: path.replaceAll("\\", "/"), sha256: hash(bytes), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
const masterPath = join(root, "panorama", "master-codex-v1-2x1.png");
const candidatePath = join(root, "panorama", "candidates", "candidate-codex-01-2x1.png");
const master = await png(masterPath);
const candidate = await png(candidatePath);
const source = await png(sourceGeneratedPath);
if (master.width !== master.height * 2 || master.sha256 !== candidate.sha256 || master.sha256 !== source.sha256) throw new TypeError("codex_panorama_lineage_invalid");
const definitions = [
  ["front", 0],
  ["right", 90],
  ["back", 180],
  ["left", -90]
];
const views = [];
for (const [name, yaw] of definitions) {
  const view = await png(join(root, "panorama", "validation", "codex-v1", `${name}.png`));
  if (view.width !== 1280 || view.height !== 720) throw new TypeError(`codex_panorama_view_dimensions_invalid:${name}`);
  views.push({ name, yaw, pitch: 0, horizontalFov: 90, verticalFov: 58, ...view });
}
const manifest = {
  schemaVersion: 1,
  workflow: "codex_builtin_imagegen_erp_v1",
  state: "approved_for_unity_appearance_reference",
  role: "appearance_reference_only",
  generator: "codex_builtin_imagegen",
  geometryAuthority: "unity",
  panoramaGeometryAuthority: false,
  sourceGeneratedPath: source.path,
  candidatePath: candidate.path,
  master,
  validationViews: views,
  qa: {
    strictTwoToOne: true,
    oneEntrance: true,
    emptyCentralPlinth: true,
    noPeople: true,
    noCoffin: true,
    noWeapons: true,
    noText: true,
    sameMasterForAllViews: true,
    appearanceOnlyApproval: true
  },
  generatedAt: new Date().toISOString()
};
const target = join(root, "manifests", "panorama-codex-v1.json");
await mkdir(dirname(target), { recursive: true });
const temporary = `${target}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await rename(temporary, target);
console.log(JSON.stringify({ valid: true, target, sha256: hash(await readFile(target)) }));
