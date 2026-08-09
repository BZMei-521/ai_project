import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readdir, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  buildMigrationIdentityDescriptor,
  buildPassPrompt,
  classifyMigrationTrait,
  compileStyleMigrationWorkflow,
  loadStyleMigrationSubject,
  parseStyleMigrationArgs,
  runCharacterStyleMigration,
  sanitizeMigrationTraits,
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
  "--output", "logs/shen-yan-style-migration-v1",
  "--revision", "2"
]);
assert.equal(parsed.character, CHARACTER_ID);
assert.equal(parsed.revision, 2);
assert.equal(parseStyleMigrationArgs([
  "--project", "examples/character-consistency-benchmark/current-project-klein-release-subject.json",
  "--character", CHARACTER_ID,
  "--provider", "flux2_klein_4b",
  "--base-url", "http://127.0.0.1:8188",
  "--workflow", "examples/character-consistency-benchmark/workflows/flux2-klein-4b-style-migration-api.json",
  "--output", "logs/shen-yan-style-migration-v1"
]).revision, 1);
for (const revision of ["0", "-1", "1.5", "two", ""]) {
  assert.throws(() => parseStyleMigrationArgs([
    "--project", "project.json", "--character", CHARACTER_ID, "--provider", "flux2_klein_4b",
    "--base-url", "http://127.0.0.1:8188", "--workflow", "workflow.json", "--output", "logs/out",
    "--revision", revision
  ]), /revision.*positive integer|invalid argument/i);
}
assert.throws(() => parseStyleMigrationArgs(["--project", "../outside.json", "--character", CHARACTER_ID, "--provider", "flux2_klein_4b", "--base-url", "http://127.0.0.1:8188", "--workflow", "workflow.json", "--output", "logs/out"]), /workspace/i);
assert.throws(() => parseStyleMigrationArgs(["--project", "project.json", "--character", CHARACTER_ID, "--provider", "qwen_image_edit_2511", "--base-url", "http://127.0.0.1:8188", "--workflow", "workflow.json", "--output", "logs/out"]), /flux2_klein_4b/);

const workflowPath = resolve(WORKSPACE, "examples/character-consistency-benchmark/workflows/flux2-klein-4b-style-migration-api.json");
const baseWorkflowPath = resolve(WORKSPACE, "examples/character-consistency-benchmark/workflows/flux2-klein-base-4b-style-migration-api.json");
const currentProjectFixturePath = resolve(WORKSPACE, "examples/character-consistency-benchmark/current-project-klein-release-subject.json");
const currentProjectFixtureBytes = await readFile(currentProjectFixturePath);
const currentProjectFixture = JSON.parse(currentProjectFixtureBytes.toString("utf8"));
const currentIdentityPack = currentProjectFixture.snapshot.assets.find((asset) => asset.id === CHARACTER_ID).characterIdentityPack;
assert.deepEqual(classifyMigrationTrait("large blue eyes", "immutable"), {
  action: "rewrite",
  source: "large blue eyes",
  canonicalFacts: ["natural-sized blue eyes"],
  reason: "preserve_eye_color_without_juvenile_scale"
});
for (const source of ["oversized blue eyes", "big blue eyes", "huge blue eyes", "enlarged blue eyes"]) {
  const classified = classifyMigrationTrait(source, "immutable");
  assert.deepEqual(classified.canonicalFacts, ["natural-sized blue eyes"]);
  assert.equal(classified.action, "rewrite");
  assert.doesNotMatch(classified.canonicalFacts.join(" "), /oversized|big|huge|enlarged/i);
}
assert.deepEqual(classifyMigrationTrait("youthful blue-eyed face with short dark brown side-swept hair", "immutable"), {
  action: "rewrite",
  source: "youthful blue-eyed face with short dark brown side-swept hair",
  canonicalFacts: ["blue eyes", "short dark brown side-swept hair", "established adult face identity"],
  reason: "extract_identity_facts_remove_age_or_style_coupling"
});
assert.deepEqual(classifyMigrationTrait("huge blue eyes with short dark brown side-swept hair", "immutable"), {
  action: "rewrite",
  source: "huge blue eyes with short dark brown side-swept hair",
  canonicalFacts: ["natural-sized blue eyes", "short dark brown side-swept hair"],
  reason: "extract_identity_facts_remove_age_or_style_coupling"
});
assert.deepEqual(classifyMigrationTrait("Pixar-style teal tunic and navy long coat", "immutable"), {
  action: "rewrite",
  source: "Pixar-style teal tunic and navy long coat",
  canonicalFacts: ["teal tunic", "navy long coat"],
  reason: "extract_identity_facts_remove_age_or_style_coupling"
});
assert.deepEqual(classifyMigrationTrait("child protagonist with a silver pendant", "immutable"), {
  action: "exclude",
  source: "child protagonist with a silver pendant",
  canonicalFacts: [],
  reason: "exclude_age_or_style_coupled_trait"
});
assert.deepEqual(classifyMigrationTrait("do not change childlike proportions", "forbidden"), {
  action: "exclude",
  source: "do not change childlike proportions",
  canonicalFacts: [],
  reason: "exclude_age_or_style_coupled_constraint"
});
assert.deepEqual(classifyMigrationTrait("juvenile blue-eyed face with short dark brown side-swept hair", "immutable"), {
  action: "rewrite",
  source: "juvenile blue-eyed face with short dark brown side-swept hair",
  canonicalFacts: ["blue eyes", "short dark brown side-swept hair", "established adult face identity"],
  reason: "extract_identity_facts_remove_age_or_style_coupling"
});
const currentSanitized = sanitizeMigrationTraits(currentIdentityPack);
assert.equal(currentSanitized.traitDecisions.length, currentIdentityPack.immutableTraits.length + currentIdentityPack.forbiddenChanges.length);
assert.ok(currentSanitized.traitDecisions.every((decision) => decision.source && decision.action && decision.reason && Array.isArray(decision.canonicalFacts)), "every source trait must have an auditable structured decision");
assert.deepEqual(currentSanitized.identityTraits, [
  "short dark brown side-swept hair",
  "natural-sized blue eyes",
  "teal long-sleeve tunic",
  "dark navy sleeveless long coat",
  "brown belt and knee-high brown boots",
  "established adult male identity"
]);
assert.deepEqual(currentSanitized.preservationConstraints, [
  "preserve recognizable facial identity and blue eye color while allowing adult target-style facial refinement",
  "preserve hair color, length, fringe, and silhouette",
  "preserve the teal tunic, navy long coat, brown belt, and brown boots"
]);
assert.deepEqual(currentSanitized.excludedSourceTraits.map(({ source }) => source), [
  "do not change age, gender presentation, or body proportions",
  "do not switch from clean 2D animated character styling to photorealism"
]);
const fixtureSubject = { identityPack: currentIdentityPack, species: "human" };
const canonicalDescriptor = buildMigrationIdentityDescriptor(fixtureSubject);
for (const pass of [{ id: "front" }, { id: "side" }, { id: "back" }]) {
  const migrationPrompt = buildPassPrompt(fixtureSubject, pass);
  assert.match(migrationPrompt, /young adult male.*24-28 years old.*refined adult facial planes/i);
  assert.match(migrationPrompt, /elegant softly angular jaw.*slender straight modeled nose.*natural-sized almond-shaped blue eyes.*normal iris proportions/i);
  assert.match(migrationPrompt, /clean-shaven in every view.*no beard.*no moustache.*no stubble/i);
  assert.match(migrationPrompt, /restrained calm expression.*slender adult body proportions/i);
  assert.match(migrationPrompt, /premium Chinese 3D donghua animated-feature aesthetic.*high-end CG anime character rendering/i);
  assert.match(migrationPrompt, /soft luminous skin.*subtle subsurface scattering.*detailed individual hair strands.*physically readable woven cloth and leather/i);
  assert.match(migrationPrompt, /not Pixar-style, not Disney-style, not western family animation, not chibi, not toy-like, not juvenile, not a child/i);
  assert.match(migrationPrompt, /not rugged live-action realism.*not a generic western game character/i);
  assert.ok(migrationPrompt.includes(canonicalDescriptor), "every view must contain the same canonical identity descriptor");
  assert.doesNotMatch(migrationPrompt, /large blue eyes|youthful animated face|do not change age, gender presentation, or body proportions|do not switch from clean 2D animated character styling to photorealism/i);
}
assert.deepEqual(await readFile(currentProjectFixturePath), currentProjectFixtureBytes, "trait sanitization must leave the real source project byte-for-byte unchanged");
const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
const baseWorkflow = JSON.parse(await readFile(baseWorkflowPath, "utf8"));
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
const compiledBase = compileStyleMigrationWorkflow(baseWorkflow, {
  REFERENCE_IMAGE_A: "migration/front-a.png",
  REFERENCE_IMAGE_B: "migration/front-b.png",
  PROMPT: "immutable traits and canonical style",
  VIEW: "front",
  STYLE_CONTRACT_ID: "cinematic_3d_donghua_v1",
  STYLE_CONTRACT_VERSION: "1.0.0",
  CHARACTER_ASSET_ID: CHARACTER_ID,
  SEED: 2026080901
});
assert.equal(compiledBase["2"].inputs.unet_name, "flux-2-klein-base-4b-fp8.safetensors");
assert.equal(compiledBase["4"].inputs.vae_name, "full_encoder_small_decoder.safetensors");
assert.equal(compiledBase["14"].inputs.cfg, 5);
assert.equal(compiledBase["16"].inputs.steps, 20);
assert.equal(parseStyleMigrationArgs([
  "--project", "examples/character-consistency-benchmark/current-project-klein-release-subject.json",
  "--character", CHARACTER_ID,
  "--provider", "flux2_klein_base_4b",
  "--base-url", "http://127.0.0.1:8188",
  "--workflow", "examples/character-consistency-benchmark/workflows/flux2-klein-base-4b-style-migration-api.json",
  "--output", "logs/shen-yan-style-migration-base-v4",
  "--revision", "4"
]).provider, "flux2_klein_base_4b");
for (const [nodeId, input, invalidValue, message] of [
  ["4", "vae_name", "flux2-vae.safetensors", /requires VAE/i],
  ["14", "cfg", 1, /requires CFG 5/i],
  ["16", "steps", 4, /requires exactly 20 scheduler steps/i]
]) {
  const invalidBase = structuredClone(baseWorkflow);
  invalidBase[nodeId].inputs[input] = invalidValue;
  assert.throws(() => compileStyleMigrationWorkflow(invalidBase, {}), message);
}

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
const isolatedStyleTokens = structuredClone(workflow);
isolatedStyleTokens["25"] = { class_type: "CLIPTextEncode", inputs: { text: isolatedStyleTokens["7"].inputs.text, clip: ["3", 0] } };
isolatedStyleTokens["7"].inputs.text = "unstyled character migration conditioning";
assert.throws(() => compileStyleMigrationWorkflow(isolatedStyleTokens, {
  REFERENCE_IMAGE_A: "a.png", REFERENCE_IMAGE_B: "b.png", PROMPT: "p", VIEW: "front",
  STYLE_CONTRACT_ID: "cinematic_3d_donghua_v1", STYLE_CONTRACT_VERSION: "1.0.0",
  CHARACTER_ASSET_ID: CHARACTER_ID, SEED: 1
}), /active.*CLIPTextEncode|conditioning.*token/i, "an isolated token-bearing encoder cannot cover an unstyled generation conditioning branch");
const ignoredReferenceEdges = structuredClone(workflow);
ignoredReferenceEdges["5"].inputs.image = ["18", 0];
ignoredReferenceEdges["21"].inputs.image = ["18", 0];
ignoredReferenceEdges["10"].inputs.ignored_reference_a = ["1", 0];
ignoredReferenceEdges["23"].inputs.ignored_reference_b = ["20", 0];
assert.throws(() => compileStyleMigrationWorkflow(ignoredReferenceEdges, {
  REFERENCE_IMAGE_A: "a.png", REFERENCE_IMAGE_B: "b.png", PROMPT: "p", VIEW: "front",
  STYLE_CONTRACT_ID: "cinematic_3d_donghua_v1", STYLE_CONTRACT_VERSION: "1.0.0",
  CHARACTER_ASSET_ID: CHARACTER_ID, SEED: 1
}), /active reference binding|schema/i, "unknown input arrays must not be interpreted as graph edges");
const zeroedPositiveStyle = structuredClone(workflow);
zeroedPositiveStyle["10"].inputs.conditioning = ["8", 0];
assert.throws(() => compileStyleMigrationWorkflow(zeroedPositiveStyle, {
  REFERENCE_IMAGE_A: "a.png", REFERENCE_IMAGE_B: "b.png", PROMPT: "p", VIEW: "front",
  STYLE_CONTRACT_ID: "cinematic_3d_donghua_v1", STYLE_CONTRACT_VERSION: "1.0.0",
  CHARACTER_ASSET_ID: CHARACTER_ID, SEED: 1
}), /positive.*zero|authoritative.*conditioning/i, "canonical positive style conditioning must not pass through ConditioningZeroOut");
const referencesOnlyOnNegative = structuredClone(workflow);
referencesOnlyOnNegative["14"].inputs.positive = ["7", 0];
assert.throws(() => compileStyleMigrationWorkflow(referencesOnlyOnNegative, {
  REFERENCE_IMAGE_A: "a.png", REFERENCE_IMAGE_B: "b.png", PROMPT: "p", VIEW: "front",
  STYLE_CONTRACT_ID: "cinematic_3d_donghua_v1", STYLE_CONTRACT_VERSION: "1.0.0",
  CHARACTER_ASSET_ID: CHARACTER_ID, SEED: 1
}), /positive.*reference|identity.*positive/i, "both identity references must condition the authoritative positive branch, not only cfg=1 negative conditioning");
const emptyLatentIdentity = structuredClone(workflow);
emptyLatentIdentity["10"].inputs.latent = ["12", 0];
assert.throws(() => compileStyleMigrationWorkflow(emptyLatentIdentity, {
  REFERENCE_IMAGE_A: "a.png", REFERENCE_IMAGE_B: "b.png", PROMPT: "p", VIEW: "front",
  STYLE_CONTRACT_ID: "cinematic_3d_donghua_v1", STYLE_CONTRACT_VERSION: "1.0.0",
  CHARACTER_ASSET_ID: CHARACTER_ID, SEED: 1
}), /pixel|VAEEncode|identity.*latent/i, "LoadImage dimensions feeding EmptyFlux2LatentImage must not count as identity pixel contribution");

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
for (const [name, speciesTraits] of [["string-traits.json", "cat ears"], ["object-traits.json", { trait: "cat ears" }], ["blank-traits.json", [""]]]) {
  const invalidHumanTraitsProject = await writeProject(name, { species: "human", speciesTraits });
  await assert.rejects(loadStyleMigrationSubject(invalidHumanTraitsProject, CHARACTER_ID, { workspaceRoot: WORKSPACE }), /speciesTraits.*empty array|human/i);
}
let invalidTraitsQueued = false;
const invalidTraitsRunProject = await writeProject("invalid-traits-run.json", { species: "human", speciesTraits: "cat ears" });
await assert.rejects(runCharacterStyleMigration({
  project: invalidTraitsRunProject,
  character: CHARACTER_ID,
  provider: "flux2_klein_4b",
  baseUrl: "http://127.0.0.1:8188",
  workflow: workflowPath,
  output: join(tempRoot, "invalid-traits-output"),
  workspaceRoot: WORKSPACE
}, { transport: { async uploadImage() { throw new Error("must not upload"); }, async queueWorkflow() { invalidTraitsQueued = true; throw new Error("must not queue"); } } }), /speciesTraits.*empty array|human/i);
assert.equal(invalidTraitsQueued, false, "invalid human speciesTraits must be rejected before prompt compilation or queueing");

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
const queuedPrompts = [];
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
    queuedPrompts.push(queuedWorkflow["7"].inputs.text);
    assert.match(queuedWorkflow["7"].inputs.text, new RegExp(`${pass.id}.*cinematic_3d_donghua_v1|cinematic_3d_donghua_v1.*${pass.id}`, "i"));
    assert.match(queuedWorkflow["7"].inputs.text, /blue eyes.*human ears only.*no animal ears.*no tail.*no horns.*no animal muzzle/i);
    assert.match(queuedWorkflow["7"].inputs.text, /not Pixar-style, not Disney-style, not western family animation, not chibi, not toy-like, not juvenile, not a child/i);
    const withoutExplicitExclusions = queuedWorkflow["7"].inputs.text.replace("not Pixar-style, not Disney-style, not western family animation, not chibi, not toy-like, not juvenile, not a child", "");
    assert.doesNotMatch(withoutExplicitExclusions, /Pixar-style|Disney-style|\bchibi\b|\btoy-like\b|\bjuvenile\b|\bchild\b/i, "no conflicting positive juvenile or western-family style may remain");
    activeQueues -= 1;
    return { kind: "model_generation", contentType: "image/png", bytes: PNG };
  }
};

const mkdtempFailureOutput = join(tempRoot, "mkdtemp-failure-output");
try {
  await assert.rejects(runCharacterStyleMigration({
    project: projectPath,
    character: CHARACTER_ID,
    provider: "flux2_klein_4b",
    baseUrl: "http://127.0.0.1:8188",
    workflow: workflowPath,
    output: mkdtempFailureOutput,
    workspaceRoot: WORKSPACE
  }, { transport, async mkdtemp() { throw new Error("injected mkdtemp failure"); } }), /injected mkdtemp failure/);
  assert.deepEqual(await readdir(mkdtempFailureOutput), [], "mkdtemp initialization failure must remove the already-created run sentinel");
} finally {
  await rm(mkdtempFailureOutput, { recursive: true, force: true });
}

const transportFailureOutput = join(tempRoot, "transport-failure-output");
let transportFailureTemp;
try {
  await assert.rejects(runCharacterStyleMigration({
    project: projectPath,
    character: CHARACTER_ID,
    provider: "flux2_klein_4b",
    baseUrl: "http://127.0.0.1:8188",
    workflow: workflowPath,
    output: transportFailureOutput,
    workspaceRoot: WORKSPACE
  }, {
    fetch: 42,
    tmpdir: () => tempRoot,
    async mkdtemp(prefix) {
      transportFailureTemp = await mkdtemp(prefix);
      return transportFailureTemp;
    }
  }), /fetch implementation/i);
  assert.deepEqual(await readdir(transportFailureOutput), [], "transport construction failure must remove the run sentinel");
  await assert.rejects(lstat(transportFailureTemp), /ENOENT/, "transport construction failure must remove only its run-owned temporary directory");
} finally {
  await rm(transportFailureOutput, { recursive: true, force: true });
  if (transportFailureTemp) await rm(transportFailureTemp, { recursive: true, force: true });
}

const tempReplacementOutput = join(tempRoot, "temp-replacement-output");
let originalOwnedTemp;
let movedOwnedTemp;
const victimBytes = Buffer.from("do not delete this victim\n", "utf8");
try {
  await assert.rejects(runCharacterStyleMigration({
    project: projectPath,
    character: CHARACTER_ID,
    provider: "flux2_klein_4b",
    baseUrl: "http://127.0.0.1:8188",
    workflow: workflowPath,
    output: tempReplacementOutput,
    workspaceRoot: WORKSPACE
  }, {
    tmpdir: () => tempRoot,
    async mkdtemp(prefix) {
      originalOwnedTemp = await mkdtemp(prefix);
      movedOwnedTemp = `${originalOwnedTemp}-moved`;
      return originalOwnedTemp;
    },
    transport: {
      async uploadImage() {
        await rename(originalOwnedTemp, movedOwnedTemp);
        await mkdir(originalOwnedTemp);
        await writeFile(join(originalOwnedTemp, "victim.txt"), victimBytes, { flag: "wx" });
        throw new Error("injected temp replacement");
      },
      async queueWorkflow() { throw new Error("must not queue"); }
    }
  }), /temp.*identity|temp.*replacement|injected temp replacement/i);
  assert.deepEqual(await readFile(join(originalOwnedTemp, "victim.txt")), victimBytes, "cleanup must never recursively remove a replacement directory or its victim file");
  assert.equal((await readdir(movedOwnedTemp)).some((name) => name.endsWith(".sentinel")), true, "an unlocatable moved owned directory may remain for safe operator cleanup");
} finally {
  await rm(tempReplacementOutput, { recursive: true, force: true });
  if (originalOwnedTemp) await rm(originalOwnedTemp, { recursive: true, force: true });
  if (movedOwnedTemp) await rm(movedOwnedTemp, { recursive: true, force: true });
}

const competingTempOutput = join(tempRoot, "competing-temp-output");
let competingTempDirectory;
let competingTempFile;
try {
  await assert.rejects(runCharacterStyleMigration({
    project: projectPath,
    character: CHARACTER_ID,
    provider: "flux2_klein_4b",
    baseUrl: "http://127.0.0.1:8188",
    workflow: workflowPath,
    output: competingTempOutput,
    workspaceRoot: WORKSPACE
  }, {
    transport,
    tmpdir: () => tempRoot,
    async mkdtemp(prefix) {
      competingTempDirectory = await mkdtemp(prefix);
      competingTempFile = join(competingTempDirectory, "front-1.png");
      return competingTempDirectory;
    },
    async writeFile(target, bytes, options) {
      if (target === competingTempFile) await writeFile(target, bytes, { flag: "wx" });
      return writeFile(target, bytes, options);
    }
  }), /EEXIST|untracked file/i);
  assert.deepEqual(await readFile(competingTempFile), PNG, "a same-name same-byte file whose competing wx won must never be registered or deleted as run-owned");
} finally {
  await rm(competingTempOutput, { recursive: true, force: true });
  if (competingTempDirectory) await rm(competingTempDirectory, { recursive: true, force: true });
}

const outputDirectory = join(tempRoot, "migration-output");
const beforeProject = await readFile(projectPath);
const manifest = await runCharacterStyleMigration({
  project: projectPath,
  character: CHARACTER_ID,
  provider: "flux2_klein_4b",
  baseUrl: "http://127.0.0.1:8188",
  workflow: workflowPath,
  output: outputDirectory,
  revision: 2,
  workspaceRoot: WORKSPACE
}, { transport });
assert.deepEqual(await readFile(projectPath), beforeProject, "migration must never mutate the project JSON");
assert.equal(manifest.status, "awaiting_operator_approval");
assert.equal(manifest.styleContract.id, "cinematic_3d_donghua_v1");
assert.equal(manifest.styleContract.version, "1.0.0");
assert.equal(manifest.proposedIdentityPackVersion, "shen-yan-identity-v1-cinematic3d-v2");
assert.match(manifest.styleContract.digest, /^[a-f0-9]{64}$/);
assert.equal(manifest.candidates.length, 3);
assert.deepEqual(manifest.candidates.map((candidate) => [candidate.view, candidate.seed]), [
  ["front", 2026080901], ["side", 2026080902], ["back", 2026080903]
]);
assert.ok(manifest.candidates.every((candidate) => /^[a-f0-9]{64}$/.test(candidate.sourceSha256) && /^[a-f0-9]{64}$/.test(candidate.outputSha256)));
assert.ok(manifest.candidates.every((candidate) => candidate.sourceReferences.length === 2 && candidate.sourceReferences.every((source) => /^[a-f0-9]{64}$/.test(source.sha256))));
assert.deepEqual(calls.filter(([kind]) => kind === "queue").map(([, view]) => view), ["front", "side", "back"]);
for (const prompt of queuedPrompts) {
  assert.ok(prompt.includes(`Canonical identity descriptor: ${buildMigrationIdentityDescriptor(subject)}.`), "all passes must share the exact canonical descriptor");
  assert.doesNotMatch(prompt, /large blue eyes|youthful animated face|do not change age, gender presentation, or body proportions|do not switch from clean 2D animated character styling to photorealism/i);
}
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

const narrowWorkflowPath = join(tempRoot, "workflow.json");
await writeFile(narrowWorkflowPath, `${JSON.stringify(workflow)}\n`, { flag: "wx" });
const swapOutput = join(tempRoot, "swap-output");
const quarantinedOutput = join(tempRoot, "swap-output-original");
const outsideWorkspace = await mkdtemp(join(WORKSPACE, ".tmp-style-migration-outside-"));
let switchedOutput = false;
try {
  await assert.rejects(runCharacterStyleMigration({
    project: projectPath,
    character: CHARACTER_ID,
    provider: "flux2_klein_4b",
    baseUrl: "http://127.0.0.1:8188",
    workflow: narrowWorkflowPath,
    output: swapOutput,
    workspaceRoot: tempRoot
  }, {
    transport,
    async writeFile(target, bytes, options) {
      if (!switchedOutput && target === join(swapOutput, "front.png")) {
        await rename(swapOutput, quarantinedOutput);
        await symlink(outsideWorkspace, swapOutput, "junction");
        switchedOutput = true;
      }
      return writeFile(target, bytes, options);
    }
  }), /reparse|identity|workspace/i, "an output-directory junction swap between check and write must fail closed");
  assert.equal(switchedOutput, true, "the regression must execute the check/write junction switch");
  assert.deepEqual(await readdir(outsideWorkspace), [], "a rejected junction swap must leave no run-created file outside the workspace");
} finally {
  await unlink(swapOutput).catch(() => {});
  await rm(quarantinedOutput, { recursive: true, force: true });
  await rm(outsideWorkspace, { recursive: true, force: true });
}

await rm(tempRoot, { recursive: true, force: true });
console.log("PASS non-destructive Klein character style migration CLI");
