import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  compileStyleMigrationWorkflow,
  loadStyleMigrationSubject,
  parseStyleMigrationArgs,
  runCharacterStyleMigration,
  writeMigrationManifestExclusive
} from "./run-character-style-migration.mjs";

const WORKSPACE = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)));
const CHARACTER_ID = "asset_1774017261433_390";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63606060f80f0001040100b51c0c020000000049454e44ae426082", "hex");

const parsed = parseStyleMigrationArgs([
  "--project", "examples/character-consistency-benchmark/current-project-klein-release-subject.json",
  "--character", CHARACTER_ID,
  "--provider", "flux2_klein_4b",
  "--base-url", "http://127.0.0.1:8188",
  "--workflow", "examples/character-consistency-benchmark/workflows/flux2-klein-4b-style-migration-api.json",
  "--output", "logs/shen-yan-style-migration-v1"
]);
assert.equal(parsed.character, CHARACTER_ID);
assert.throws(() => parseStyleMigrationArgs(["--project", "../outside.json", "--character", CHARACTER_ID, "--provider", "flux2_klein_4b", "--base-url", "http://127.0.0.1:8188", "--workflow", "workflow.json", "--output", "logs/out"]), /workspace/i);
assert.throws(() => parseStyleMigrationArgs(["--project", "project.json", "--character", CHARACTER_ID, "--provider", "qwen_image_edit_2511", "--base-url", "http://127.0.0.1:8188", "--workflow", "workflow.json", "--output", "logs/out"]), /flux2_klein_4b/);

const workflowPath = resolve(WORKSPACE, "examples/character-consistency-benchmark/workflows/flux2-klein-4b-style-migration-api.json");
const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
const compiled = compileStyleMigrationWorkflow(workflow, {
  REFERENCE_IMAGE_A: "migration/front-a.png",
  REFERENCE_IMAGE_B: "migration/front-b.png",
  PROMPT: "immutable traits and canonical style",
  VIEW: "front",
  STYLE_CONTRACT_ID: "cinematic_3d_donghua_v1",
  STYLE_CONTRACT_VERSION: "1.0.0",
  CHARACTER_ASSET_ID: CHARACTER_ID,
  SEED: 2026080901
});
assert.equal(Object.values(compiled).filter((node) => node.class_type === "LoadImage").length, 2);
assert.equal(Object.values(compiled).filter((node) => node.class_type === "SaveImage").length, 1);
assert.doesNotMatch(JSON.stringify(compiled), /\{\{[^}]+\}\}/);

const oneLoader = structuredClone(workflow);
delete oneLoader["20"];
assert.throws(() => compileStyleMigrationWorkflow(oneLoader, {}), /exactly two active LoadImage/i);
const threeLoaders = structuredClone(workflow);
threeLoaders["99"] = { class_type: "LoadImage", inputs: { image: "style-reference-screenshot.png" } };
assert.throws(() => compileStyleMigrationWorkflow(threeLoaders, {}), /exactly two active LoadImage|screenshot|style reference/i);
const wrongModel = structuredClone(workflow);
wrongModel["2"].inputs.unet_name = "flux-dev.safetensors";
assert.throws(() => compileStyleMigrationWorkflow(wrongModel, {}), /Klein model binding/i);
const unresolved = structuredClone(workflow);
unresolved["7"].inputs.text += " {{UNKNOWN_TOKEN}}";
assert.throws(() => compileStyleMigrationWorkflow(unresolved, {
  REFERENCE_IMAGE_A: "a.png", REFERENCE_IMAGE_B: "b.png", PROMPT: "p", VIEW: "front",
  STYLE_CONTRACT_ID: "cinematic_3d_donghua_v1", STYLE_CONTRACT_VERSION: "1.0.0",
  CHARACTER_ASSET_ID: CHARACTER_ID, SEED: 1
}), /unresolved/i);
const orphanReferences = structuredClone(workflow);
orphanReferences["5"].inputs.image = ["18", 0];
orphanReferences["21"].inputs.image = ["18", 0];
assert.throws(() => compileStyleMigrationWorkflow(orphanReferences, {
  REFERENCE_IMAGE_A: "a.png", REFERENCE_IMAGE_B: "b.png", PROMPT: "p", VIEW: "front",
  STYLE_CONTRACT_ID: "cinematic_3d_donghua_v1", STYLE_CONTRACT_VERSION: "1.0.0",
  CHARACTER_ASSET_ID: CHARACTER_ID, SEED: 1
}), /active reference binding/i);
const previewBypass = structuredClone(workflow);
previewBypass["19"].inputs.images = ["1", 0];
previewBypass["25"] = { class_type: "PreviewImage", inputs: { images: ["18", 0] } };
assert.throws(() => compileStyleMigrationWorkflow(previewBypass, {
  REFERENCE_IMAGE_A: "a.png", REFERENCE_IMAGE_B: "b.png", PROMPT: "p", VIEW: "front",
  STYLE_CONTRACT_ID: "cinematic_3d_donghua_v1", STYLE_CONTRACT_VERSION: "1.0.0",
  CHARACTER_ASSET_ID: CHARACTER_ID, SEED: 1
}), /selected SaveImage|terminal/i, "reference and model chains must reach the selected SaveImage, not a decoy preview terminal");

const tempRoot = await mkdtemp(join(WORKSPACE, ".tmp-character-style-migration-"));
const sourceDirectory = join(tempRoot, "sources");
await mkdir(sourceDirectory);
const sourcePaths = {};
for (const name of ["face_master", "body_front", "face_left", "body_side", "hair_back", "body_back"]) {
  const sourcePath = join(sourceDirectory, `${name}.png`);
  await writeFile(sourcePath, PNG, { flag: "wx" });
  sourcePaths[name] = sourcePath;
}

function projectDocument(overrides = {}) {
  return {
    snapshot: {
      assets: [{
        id: CHARACTER_ID,
        type: "character",
        name: "Shen Yan",
        characterIdentityPack: {
          version: "shen-yan-identity-v1",
          triggerWord: "char_shen_yan_v1",
          faceMasterPath: sourcePaths.face_master,
          bodyFrontPath: sourcePaths.body_front,
          faceLeftPath: sourcePaths.face_left,
          bodySidePath: sourcePaths.body_side,
          hairBackPath: sourcePaths.hair_back,
          bodyBackPath: sourcePaths.body_back,
          immutableTraits: ["blue eyes", "short dark-brown side-swept hair", "teal tunic", "navy long coat", "brown belt", "brown boots", "youthful adult male proportions"],
          forbiddenChanges: ["do not change face shape"],
          ...overrides
        }
      }]
    }
  };
}

async function writeProject(name, overrides) {
  const projectPath = join(tempRoot, name);
  await writeFile(projectPath, `${JSON.stringify(projectDocument(overrides), null, 2)}\n`, { flag: "wx" });
  return projectPath;
}

const projectPath = await writeProject("project.json");
const subject = await loadStyleMigrationSubject(projectPath, CHARACTER_ID, { workspaceRoot: WORKSPACE });
assert.equal(subject.identityPack.version, "shen-yan-identity-v1");
assert.equal(subject.species, "human", "legacy source packs default to human without inventing target-style fields");

const nonHumanProject = await writeProject("non-human.json", { species: "catfolk", speciesTraits: ["cat ears"] });
await assert.rejects(loadStyleMigrationSubject(nonHumanProject, CHARACTER_ID, { workspaceRoot: WORKSPACE }), /human/i);

const malformedPath = join(sourceDirectory, "malformed.png");
await writeFile(malformedPath, "not an image", { flag: "wx" });
const malformedProject = await writeProject("malformed.json", { faceMasterPath: malformedPath });
await assert.rejects(loadStyleMigrationSubject(malformedProject, CHARACTER_ID, { workspaceRoot: WORKSPACE }), /image magic/i);
const jpegPath = join(sourceDirectory, "face-master.jpg");
await writeFile(jpegPath, Buffer.from("ffd8ffd9", "hex"), { flag: "wx" });
const jpegProject = await writeProject("jpeg-source.json", { faceMasterPath: jpegPath });
assert.equal((await loadStyleMigrationSubject(jpegProject, CHARACTER_ID, { workspaceRoot: WORKSPACE })).sourceFormats.face_master, "jpeg", "valid non-PNG inputs must preserve their detected format while staging and uploading");

const symlinkPath = join(sourceDirectory, "linked.png");
let symlinkCreated = false;
try {
  await symlink(sourcePaths.face_master, symlinkPath, "file");
  symlinkCreated = true;
} catch (error) {
  if (!(["EPERM", "EACCES", "ENOSYS"].includes(error?.code))) throw error;
}
if (symlinkCreated) {
  const linkedProject = await writeProject("linked.json", { faceMasterPath: symlinkPath });
  await assert.rejects(loadStyleMigrationSubject(linkedProject, CHARACTER_ID, { workspaceRoot: WORKSPACE }), /symlink|reparse/i);
}

const manifestDirectory = join(tempRoot, "manifest-exclusive");
await mkdir(manifestDirectory);
await writeMigrationManifestExclusive(manifestDirectory, { status: "awaiting_operator_approval" });
await assert.rejects(writeMigrationManifestExclusive(manifestDirectory, { status: "awaiting_operator_approval" }), /already exists|exclusive/i);
await assert.rejects(writeMigrationManifestExclusive(resolve(tempRoot, "..", "outside-manifest"), { status: "awaiting_operator_approval" }, {
  workspaceRoot: tempRoot,
  lstat: async () => ({ isSymbolicLink: () => false, isDirectory: () => true }),
  writeFile: async () => { throw new Error("unsafe write attempted"); }
}), /workspace/i, "the manifest helper must reject paths outside its workspace before attempting a write");

const calls = [];
let activeQueues = 0;
const transport = {
  async uploadImage({ fileName, bytes }) {
    assert.ok(Buffer.isBuffer(bytes));
    calls.push(["upload", fileName]);
    return `migration/${fileName}`;
  },
  async queueWorkflow({ workflow: queuedWorkflow, outputNodeId, pass }) {
    activeQueues += 1;
    assert.equal(activeQueues, 1, "passes must queue serially");
    assert.equal(outputNodeId, "19");
    calls.push(["queue", pass.id, queuedWorkflow["13"].inputs.noise_seed]);
    assert.match(queuedWorkflow["7"].inputs.text, new RegExp(`${pass.id}.*cinematic_3d_donghua_v1|cinematic_3d_donghua_v1.*${pass.id}`, "i"));
    assert.match(queuedWorkflow["7"].inputs.text, /blue eyes.*human ears only.*no animal ears.*no tail.*no horns.*no animal muzzle/i);
    activeQueues -= 1;
    return { kind: "model_generation", contentType: "image/png", bytes: PNG };
  }
};

const outputDirectory = join(tempRoot, "migration-output");
const beforeProject = await readFile(projectPath);
const manifest = await runCharacterStyleMigration({
  project: projectPath,
  character: CHARACTER_ID,
  provider: "flux2_klein_4b",
  baseUrl: "http://127.0.0.1:8188",
  workflow: workflowPath,
  output: outputDirectory,
  workspaceRoot: WORKSPACE
}, { transport });
assert.deepEqual(await readFile(projectPath), beforeProject, "migration must never mutate the project JSON");
assert.equal(manifest.status, "awaiting_operator_approval");
assert.equal(manifest.styleContract.id, "cinematic_3d_donghua_v1");
assert.equal(manifest.styleContract.version, "1.0.0");
assert.match(manifest.styleContract.digest, /^[a-f0-9]{64}$/);
assert.equal(manifest.candidates.length, 3);
assert.deepEqual(manifest.candidates.map((candidate) => [candidate.view, candidate.seed]), [
  ["front", 2026080901], ["side", 2026080902], ["back", 2026080903]
]);
assert.ok(manifest.candidates.every((candidate) => /^[a-f0-9]{64}$/.test(candidate.sourceSha256) && /^[a-f0-9]{64}$/.test(candidate.outputSha256)));
assert.ok(manifest.candidates.every((candidate) => candidate.sourceReferences.length === 2 && candidate.sourceReferences.every((source) => /^[a-f0-9]{64}$/.test(source.sha256))));
assert.deepEqual(calls.filter(([kind]) => kind === "queue").map(([, view]) => view), ["front", "side", "back"]);
assert.equal(JSON.parse(await readFile(join(outputDirectory, "migration-manifest.json"), "utf8")).status, "awaiting_operator_approval");
for (const view of ["front", "side", "back"]) assert.deepEqual(await readFile(join(outputDirectory, `${view}.png`)), PNG);
assert.deepEqual((await readdir(outputDirectory)).sort(), ["back.png", "front.png", "migration-manifest.json", "side.png"]);
await assert.rejects(runCharacterStyleMigration({ project: projectPath, character: CHARACTER_ID, provider: "flux2_klein_4b", baseUrl: "http://127.0.0.1:8188", workflow: workflowPath, output: outputDirectory, workspaceRoot: WORKSPACE }, { transport }), /already exists|exclusive/i);

const fallbackOutput = join(tempRoot, "fallback-output");
await assert.rejects(runCharacterStyleMigration({ project: projectPath, character: CHARACTER_ID, provider: "flux2_klein_4b", baseUrl: "http://127.0.0.1:8188", workflow: workflowPath, output: fallbackOutput, workspaceRoot: WORKSPACE }, {
  transport: { ...transport, async queueWorkflow() { return { kind: "fallback", contentType: "image/png", bytes: PNG }; } }
}), /fallback|model generation/i);
await assert.rejects(readFile(join(fallbackOutput, "migration-manifest.json")), /ENOENT/);

const mutatingProject = await writeProject("mutating-project.json");
const mutationOutput = join(tempRoot, "mutation-output");
await assert.rejects(runCharacterStyleMigration({ project: mutatingProject, character: CHARACTER_ID, provider: "flux2_klein_4b", baseUrl: "http://127.0.0.1:8188", workflow: workflowPath, output: mutationOutput, workspaceRoot: WORKSPACE }, {
  transport: {
    ...transport,
    async queueWorkflow(input) {
      await writeFile(mutatingProject, "{}\n");
      return transport.queueWorkflow(input);
    }
  }
}), /project JSON.*mutat/i);
await assert.rejects(readFile(join(mutationOutput, "migration-manifest.json")), /ENOENT/);

await rm(tempRoot, { recursive: true, force: true });
console.log("PASS non-destructive Klein character style migration CLI");
