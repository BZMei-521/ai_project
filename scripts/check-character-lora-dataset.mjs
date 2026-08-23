import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportCharacterLoraDataset } from "./export-character-lora-dataset.mjs";

const fixtureRoot = await mkdtemp(join(tmpdir(), "character-lora-dataset-"));
let fixtureNumber = 0;

const imageSpecs = [
  ["front", "close"], ["front", "medium"], ["front", "full_body"],
  ["three_quarter", "close"], ["three_quarter", "medium"], ["three_quarter", "full_body"],
  ["profile", "close"], ["profile", "medium"], ["profile", "full_body"],
  ["back", "close"], ["back", "medium"], ["back", "full_body"],
  ["front", "medium"], ["three_quarter", "medium"], ["back", "full_body"]
];

function projectFixture() {
  return {
    schemaVersion: 1,
    snapshot: {
      assets: [{
        id: "character_ada",
        type: "character",
        name: "Ada",
        characterIdentityPack: {
          version: "v3",
          triggerWord: "char_ada_v3",
          immutableTraits: ["copper bob haircut", "green eyes", "navy coat"],
          forbiddenChanges: ["do not change eye color"],
          approvedHeroFramePaths: ["assets/ada-hero.png"],
          faceMasterPath: "assets/ada-face.png",
          bodyFrontPath: "assets/ada-body.png",
          updatedAt: "2026-08-08T00:00:00.000Z"
        }
      }]
    }
  };
}

function manifestFixture(entries = imageSpecs) {
  return {
    schemaVersion: 1,
    characterId: "character_ada",
    identityPackVersion: "v3",
    sourceRoots: ["approved"],
    commercialProviders: {
      qwen_image_edit_2511: "Qwen/Qwen-Image-Edit-2511",
      flux2_klein_4b: "black-forest-labs/FLUX.2-klein-base-4B"
    },
    approvedImages: entries.map(([view, scale], index) => ({
      path: `approved/frame-${String(index + 1).padStart(2, "0")}.png`,
      approved: true,
      view,
      scale,
      identityPackVersion: "v3",
      visibleImmutableTraits: index % 2 ? ["copper bob haircut", "green eyes"] : ["navy coat"]
    }))
  };
}

async function writeFixture(manifest = manifestFixture(), project = projectFixture()) {
  const fixtureId = ++fixtureNumber;
  const projectPath = join(fixtureRoot, `project-${fixtureId}.json`);
  await mkdir(join(fixtureRoot, "approved"), { recursive: true });
  await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  for (const [index, image] of manifest.approvedImages.entries()) {
    if (image.path.includes("missing.png") || image.path.includes("..")) continue;
    const source = join(fixtureRoot, image.path);
    await mkdir(dirname(source), { recursive: true });
    await writeFile(source, Buffer.from(`fixture-image-${index + 1}`));
  }
  const manifestPath = join(fixtureRoot, `manifest-${fixtureId}.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, manifestPath, projectPath };
}

async function expectReject(label, mutate, expectedCode, mutateProject = (project) => project) {
  const base = manifestFixture();
  const manifest = mutate(structuredClone(base));
  const fixture = await writeFixture(manifest, mutateProject(projectFixture()));
  await assert.rejects(
    exportCharacterLoraDataset({
      projectPath: fixture.projectPath,
      characterId: "character_ada",
      manifestPath: fixture.manifestPath,
      outputDirectory: join(fixtureRoot, `reject-${label}`)
    }),
    (error) => error?.code === expectedCode,
    label
  );
}

async function captureError(operation, label) {
  try { await operation; }
  catch (error) { return error; }
  assert.fail(`${label} did not reject`);
}

function assertSanitizedCleanupFailures(error) {
  for (const failure of error.cleanupFailures ?? []) {
    assert.deepEqual(Object.keys(failure).sort(), ["code", "operation", "relativePath"]);
    assert.equal(failure.relativePath.includes(fixtureRoot), false, "cleanup diagnostics do not expose absolute fixture paths");
    assert.match(failure.code, /^[A-Z0-9_]+$/);
  }
}

try {
  const fixture = await writeFixture();
  const outputDirectory = join(fixtureRoot, "export-a");
  const result = await exportCharacterLoraDataset({
    projectPath: fixture.projectPath,
    characterId: "character_ada",
    manifestPath: fixture.manifestPath,
    outputDirectory
  });

  assert.equal(result.imageCount, 15);
  const metadata = await readFile(join(outputDirectory, "dataset", "metadata.jsonl"), "utf8");
  const records = metadata.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(records.length, 15);
  assert.deepEqual(records.map((record) => record.file_name), [...records.map((record) => record.file_name)].sort());
  for (const [index, record] of records.entries()) {
    assert.match(record.caption, /char_ada_v3/);
    assert.equal(record.identity_pack_version, "v3");
    assert.equal(record.approved, true);
    assert.match(record.file_name, /^\d{3}-[a-z_]+-[a-z_]+-[a-f0-9]{12}\.png$/);
    assert.equal(await readFile(join(outputDirectory, "dataset", record.file_name), "utf8"), `fixture-image-${index + 1}`);
  }
  assert.equal(records.some((record) => /background|cinematic|studio/i.test(record.caption)), false);

  const qwen = JSON.parse(await readFile(join(outputDirectory, "qwen-diffsynth-training.json"), "utf8"));
  assert.deepEqual(qwen, {
    provider: "qwen_image_edit_2511",
    model: "Qwen/Qwen-Image-Edit-2511",
    commercial_compatible: true,
    identity_pack_version: "v3",
    trigger_word: "char_ada_v3",
    dataset_metadata: "dataset/metadata.jsonl",
    cpu_offload: true,
    lora_rank: 16,
    batch_size: 1,
    gradient_accumulation_steps: 4,
    resolution: 768,
    seed: 20260808
  });
  const klein = JSON.parse(await readFile(join(outputDirectory, "klein-ai-toolkit-training.json"), "utf8"));
  assert.deepEqual(klein, {
    provider: "flux2_klein_4b",
    model: "black-forest-labs/FLUX.2-klein-base-4B",
    commercial_compatible: true,
    identity_pack_version: "v3",
    trigger_word: "char_ada_v3",
    dataset_metadata: "dataset/metadata.jsonl",
    training_host_requirement: "24GB VRAM minimum",
    desktop_inference_target: "16GB VRAM desktop",
    lora_rank: 16,
    batch_size: 1,
    resolution: 768,
    steps: 1800,
    seed: 20260808
  });

  const secondOutput = join(fixtureRoot, "export-b");
  await exportCharacterLoraDataset({ ...result.input, outputDirectory: secondOutput });
  assert.equal(await readFile(join(secondOutput, "dataset", "metadata.jsonl"), "utf8"), metadata);
  assert.equal(await readFile(join(secondOutput, "qwen-diffsynth-training.json"), "utf8"), await readFile(join(outputDirectory, "qwen-diffsynth-training.json"), "utf8"));
  assert.equal(await readFile(join(secondOutput, "klein-ai-toolkit-training.json"), "utf8"), await readFile(join(outputDirectory, "klein-ai-toolkit-training.json"), "utf8"));
  assert.equal(await readFile(join(outputDirectory, "dataset", ".character-lora-complete.json"), "utf8"), "{\"complete\":true,\"schemaVersion\":1}\n");
  await assert.rejects(
    exportCharacterLoraDataset({ ...result.input, outputDirectory }),
    (error) => error?.code === "EOUTPUT_EXISTS",
    "an existing output target is rejected rather than overwritten"
  );

  const nestedFailureFixture = await writeFixture();
  const nestedFailureOutput = join(fixtureRoot, ".tmp-cleanup", "nested", "output");
  await assert.rejects(
    exportCharacterLoraDataset({
      ...result.input,
      projectPath: nestedFailureFixture.projectPath,
      manifestPath: nestedFailureFixture.manifestPath,
      outputDirectory: nestedFailureOutput,
      failureInjector: ({ phase, index }) => { if (phase === "copy" && index === 0) { const error = new Error("injected nested copy failure"); error.code = "ETEST"; throw error; } }
    }),
    (error) => error?.code === "ETEST",
    "nested failure is propagated"
  );
  await assert.rejects(stat(join(fixtureRoot, ".tmp-cleanup")), { code: "ENOENT" }, "empty invocation-created parent chain is removed");

  const existingParentFixture = await writeFixture();
  const existingParent = join(fixtureRoot, ".tmp-existing");
  await mkdir(existingParent);
  await writeFile(join(existingParent, "keep.txt"), "pre-existing");
  await assert.rejects(
    exportCharacterLoraDataset({
      ...result.input,
      projectPath: existingParentFixture.projectPath,
      manifestPath: existingParentFixture.manifestPath,
      outputDirectory: join(existingParent, "nested", "output"),
      failureInjector: ({ phase, index }) => { if (phase === "copy" && index === 0) { const error = new Error("injected existing-parent failure"); error.code = "ETEST"; throw error; } }
    }),
    (error) => error?.code === "ETEST"
  );
  assert.equal(await readFile(join(existingParent, "keep.txt"), "utf8"), "pre-existing");
  await assert.rejects(stat(join(existingParent, "nested")), { code: "ENOENT" }, "empty child created by this invocation is removed without touching its parent");

  const foreignParentFixture = await writeFixture();
  const foreignParentRoot = join(fixtureRoot, ".tmp-parent-diagnostic");
  const foreignParentDirectory = join(foreignParentRoot, "nested");
  const foreignParentPath = join(foreignParentDirectory, "foreign-parent.bin");
  const foreignParentError = await captureError(
    exportCharacterLoraDataset({
      ...result.input,
      projectPath: foreignParentFixture.projectPath,
      manifestPath: foreignParentFixture.manifestPath,
      outputDirectory: join(foreignParentDirectory, "output"),
      failureInjector: async ({ phase, index }) => {
        if (phase === "copy" && index === 0) {
          await writeFile(foreignParentPath, "foreign-parent-bytes");
          const error = new Error("injected parent cleanup failure");
          error.code = "EPRIMARY";
          throw error;
        }
      }
    }),
    "foreign parent cleanup export"
  );
  assert.equal(foreignParentError.code, "EPRIMARY", "parent cleanup diagnostics preserve the primary export error");
  assert.equal(foreignParentError.cleanupIncomplete, true);
  assert.equal(foreignParentError.cleanupUnexpectedEntries.includes("foreign-parent.bin"), true);
  assert.equal(foreignParentError.cleanupFailures.some((failure) => failure.operation === "rmdir_parent" && failure.code === "ENOTEMPTY"), true);
  assertSanitizedCleanupFailures(foreignParentError);
  assert.equal(await readFile(foreignParentPath, "utf8"), "foreign-parent-bytes", "foreign parent file is preserved");
  assert.equal((await stat(foreignParentDirectory)).isDirectory(), true, "non-empty invocation-created parent is preserved");
  await rm(foreignParentRoot, { recursive: true, force: true });

  const nestedFixture = await writeFixture();
  const nestedOutput = join(fixtureRoot, ".tmp-success", "nested", "output");
  await assert.rejects(stat(join(fixtureRoot, ".tmp-success")), { code: "ENOENT" });
  assert.equal((await exportCharacterLoraDataset({ ...result.input, projectPath: nestedFixture.projectPath, manifestPath: nestedFixture.manifestPath, outputDirectory: nestedOutput })).imageCount, 15);
  assert.equal(await readFile(join(nestedOutput, "dataset", ".character-lora-complete.json"), "utf8"), "{\"complete\":true,\"schemaVersion\":1}\n");

  await expectReject("too-few", (manifest) => ({ ...manifest, approvedImages: manifest.approvedImages.slice(0, 14) }), "ECOUNT");
  await expectReject("too-many", (manifest) => ({ ...manifest, approvedImages: [...manifest.approvedImages, ...manifest.approvedImages, { ...manifest.approvedImages[0], path: "approved/extra-16.png" }] }), "ECOUNT");
  await expectReject("duplicate", (manifest) => ({ ...manifest, approvedImages: manifest.approvedImages.map((image, index) => index === 1 ? { ...image, path: manifest.approvedImages[0].path } : image) }), "EDUPLICATE");
  await expectReject("missing-entry-version", (manifest) => ({ ...manifest, approvedImages: manifest.approvedImages.map((image, index) => index === 0 ? Object.fromEntries(Object.entries(image).filter(([key]) => key !== "identityPackVersion")) : image) }), "EVERSION");
  await expectReject("mismatched-manifest-version", (manifest) => ({ ...manifest, identityPackVersion: "v2" }), "EVERSION");
  await expectReject("canonical-path-alias", (manifest) => ({ ...manifest, approvedImages: manifest.approvedImages.map((image, index) => index === 0 ? { ...image, path: "approved/./frame-01.png" } : image) }), "EPATH");
  await expectReject("missing-trigger", (manifest) => manifest, "ETRIGGER", (project) => {
    project.snapshot.assets[0].characterIdentityPack.triggerWord = "";
    return project;
  });
  await expectReject("mixed-version", (manifest) => ({ ...manifest, approvedImages: manifest.approvedImages.map((image, index) => index === 0 ? { ...image, identityPackVersion: "v2" } : image) }), "EVERSION");
  await expectReject("unapproved-generated", (manifest) => ({ ...manifest, generatedFramePaths: ["approved/not-on-allowlist.png"] }), "EAPPROVAL");
  await expectReject("missing-coverage", (manifest) => ({ ...manifest, approvedImages: manifest.approvedImages.map((image) => image.view === "back" ? { ...image, view: "front" } : image) }), "ECOVERAGE");
  await expectReject("invalid-enum", (manifest) => ({ ...manifest, approvedImages: manifest.approvedImages.map((image, index) => index === 0 ? { ...image, view: "rear_three_quarter" } : image) }), "EENUM");
  await expectReject("missing-source", (manifest) => ({ ...manifest, approvedImages: manifest.approvedImages.map((image, index) => index === 0 ? { ...image, path: "approved/missing.png" } : image) }), "ESOURCE");
  await expectReject("path-traversal", (manifest) => ({ ...manifest, approvedImages: manifest.approvedImages.map((image, index) => index === 0 ? { ...image, path: "../outside.png" } : image) }), "EPATH");

  await expectReject("extra-provider", (manifest) => ({ ...manifest, commercialProviders: { ...manifest.commercialProviders, flux2_klein_9b: "black-forest-labs/FLUX.2-klein-9B" } }), "EPROVIDER");
  await expectReject("incomplete-pack", (manifest) => manifest, "EIDENTITY", (project) => {
    project.snapshot.assets[0].characterIdentityPack.forbiddenChanges = [];
    return project;
  });
  await expectReject("invalid-pack-timestamp", (manifest) => manifest, "EIDENTITY", (project) => {
    project.snapshot.assets[0].characterIdentityPack.updatedAt = "not-a-timestamp";
    return project;
  });
  await expectReject("duplicate-character-id", (manifest) => manifest, "ECHARACTER", (project) => {
    project.snapshot.assets.push(structuredClone(project.snapshot.assets[0]));
    return project;
  });
  const outsideFixture = await writeFixture();
  await assert.rejects(
    exportCharacterLoraDataset({ ...result.input, projectPath: outsideFixture.projectPath, manifestPath: outsideFixture.manifestPath, outputDirectory: join(tmpdir(), `outside-character-lora-${Date.now()}`) }),
    (error) => error?.code === "EPATH",
    "output outside the real project directory is rejected"
  );

  const collisionFixture = await writeFixture();
  const collisionManifest = structuredClone(collisionFixture.manifest);
  await mkdir(join(fixtureRoot, "approved", "angle-a"));
  await mkdir(join(fixtureRoot, "approved", "angle-b"));
  await writeFile(join(fixtureRoot, "approved", "angle-a", "same-name.png"), "collision-a");
  await writeFile(join(fixtureRoot, "approved", "angle-b", "same-name.png"), "collision-b");
  collisionManifest.approvedImages[0].path = "approved/angle-a/same-name.png";
  collisionManifest.approvedImages[1].path = "approved/angle-b/same-name.png";
  await writeFile(collisionFixture.manifestPath, `${JSON.stringify(collisionManifest, null, 2)}\n`);
  const collisionResult = await exportCharacterLoraDataset({ ...result.input, manifestPath: collisionFixture.manifestPath, outputDirectory: join(fixtureRoot, "collision-export") });
  assert.equal(new Set(collisionResult.files).size, 15, "different source paths with the same basename receive collision-safe names");

  const aliasFixture = await writeFixture();
  const aliasManifest = structuredClone(aliasFixture.manifest);
  const aliasPath = join(fixtureRoot, "approved", "frame-alias.png");
  try {
    await symlink(join(fixtureRoot, "approved", "frame-01.png"), aliasPath, "file");
    aliasManifest.approvedImages[1].path = "approved/frame-alias.png";
    await writeFile(aliasFixture.manifestPath, `${JSON.stringify(aliasManifest, null, 2)}\n`);
    await assert.rejects(
      exportCharacterLoraDataset({ ...result.input, manifestPath: aliasFixture.manifestPath, outputDirectory: join(fixtureRoot, "alias-reject") }),
      (error) => error?.code === "EDUPLICATE",
      "symlink alias of an approved source is rejected as a physical duplicate"
    );
  } catch (error) {
    if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
    console.log("SKIP symlink alias regression: platform policy denies symlink creation");
  }

  const externalRoot = await mkdtemp(join(tmpdir(), "character-lora-external-"));
  try {
    const redirectedRoot = join(fixtureRoot, "redirected-source-root");
    const redirectedOutput = join(fixtureRoot, "redirected-output-root");
    try {
      await symlink(externalRoot, redirectedRoot, "dir");
      await symlink(externalRoot, redirectedOutput, "dir");
      const reparseFixture = await writeFixture();
      const reparseManifest = structuredClone(reparseFixture.manifest);
      reparseManifest.sourceRoots = ["redirected-source-root"];
      await writeFile(reparseFixture.manifestPath, `${JSON.stringify(reparseManifest, null, 2)}\n`);
      await assert.rejects(
        exportCharacterLoraDataset({ ...result.input, manifestPath: reparseFixture.manifestPath, outputDirectory: join(fixtureRoot, "reparse-source-reject") }),
        (error) => error?.code === "EPATH",
        "a declared source root that reparses outside the project is rejected"
      );
      const safeOutputFixture = await writeFixture();
      await assert.rejects(
        exportCharacterLoraDataset({ ...result.input, projectPath: safeOutputFixture.projectPath, manifestPath: safeOutputFixture.manifestPath, outputDirectory: join(redirectedOutput, "dataset") }),
        (error) => error?.code === "EPATH",
        "an output ancestor that reparses outside the project is rejected"
      );
    } catch (error) {
      if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
      console.log("SKIP reparse-point regression: platform policy denies directory symlink creation");
    }
  } finally {
    await rm(externalRoot, { recursive: true, force: true });
  }

  const hardlinkFixture = await writeFixture();
  const hardlinkManifest = structuredClone(hardlinkFixture.manifest);
  const firstSource = join(fixtureRoot, "approved", "frame-01.png");
  const hardlinkSource = join(fixtureRoot, "approved", "frame-hardlink.png");
  await link(firstSource, hardlinkSource);
  hardlinkManifest.approvedImages[1].path = "approved/frame-hardlink.png";
  await writeFile(hardlinkFixture.manifestPath, `${JSON.stringify(hardlinkManifest, null, 2)}\n`);
  if ((await stat(firstSource)).ino !== 0 && (await stat(hardlinkSource)).ino !== 0) {
    await assert.rejects(
      exportCharacterLoraDataset({ ...result.input, manifestPath: hardlinkFixture.manifestPath, outputDirectory: join(fixtureRoot, "hardlink-reject") }),
      (error) => error?.code === "EDUPLICATE",
      "hardlink alias of an approved source is rejected as a physical duplicate"
    );
  } else {
    console.log("SKIP hardlink identity regression: this filesystem does not expose stable inode values");
  }

  if (process.platform === "win32") {
    const caseFixture = await writeFixture();
    const caseManifest = structuredClone(caseFixture.manifest);
    caseManifest.approvedImages[1].path = "approved/FRAME-01.PNG";
    await writeFile(caseFixture.manifestPath, `${JSON.stringify(caseManifest, null, 2)}\n`);
    await assert.rejects(
      exportCharacterLoraDataset({ ...result.input, manifestPath: caseFixture.manifestPath, outputDirectory: join(fixtureRoot, "case-reject") }),
      (error) => error?.code === "EDUPLICATE",
      "Windows case aliases are rejected as physical duplicates"
    );
  }

  const transactionFixture = await writeFixture();
  const sourceBeforeFailure = await readFile(join(fixtureRoot, "approved", "frame-01.png"));
  const failedOutput = join(fixtureRoot, "transaction-copy-failure");
  await assert.rejects(
    exportCharacterLoraDataset({
      ...result.input,
      projectPath: transactionFixture.projectPath,
      manifestPath: transactionFixture.manifestPath,
      outputDirectory: failedOutput,
      failureInjector: ({ phase, index }) => { if (phase === "copy" && index === 2) { const error = new Error("injected copy failure"); error.code = "ETEST"; throw error; } }
    }),
    (error) => error?.code === "ETEST",
    "mid-copy failure is propagated"
  );
  await assert.rejects(stat(failedOutput), { code: "ENOENT" });
  assert.deepEqual(await readFile(join(fixtureRoot, "approved", "frame-01.png")), sourceBeforeFailure);
  assert.equal((await readdir(fixtureRoot)).some((entry) => entry.endsWith(".character-lora-staging")), false);

  const reservationFailureOutput = join(fixtureRoot, "reservation-failure");
  await assert.rejects(
    exportCharacterLoraDataset({
      ...result.input,
      projectPath: transactionFixture.projectPath,
      manifestPath: transactionFixture.manifestPath,
      outputDirectory: reservationFailureOutput,
      failureInjector: ({ phase }) => { if (phase === "after_reservation") { const error = new Error("injected reservation failure"); error.code = "ETEST"; throw error; } }
    }),
    (error) => error?.code === "ETEST",
    "partial owned reservation is cleaned after an owner-created failure"
  );
  await assert.rejects(stat(reservationFailureOutput), { code: "ENOENT" });

  for (const tokenPhase of ["owner_token_open", "owner_token_write", "owner_token_sync", "owner_token_close"]) {
    const tokenFailureOutput = join(fixtureRoot, `reservation-token-failure-${tokenPhase}`);
    await assert.rejects(
      exportCharacterLoraDataset({
        ...result.input,
        projectPath: transactionFixture.projectPath,
        manifestPath: transactionFixture.manifestPath,
        outputDirectory: tokenFailureOutput,
        failureInjector: ({ phase }) => { if (phase === tokenPhase) { const error = new Error(`injected ${tokenPhase} failure`); error.code = "ETEST"; throw error; } }
      }),
      (error) => error?.code === "ETEST",
      `${tokenPhase} failure is propagated`
    );
    await assert.rejects(stat(tokenFailureOutput), { code: "ENOENT" }, `${tokenPhase} failure leaves no partial reservation`);
  }
  assert.equal((await readdir(fixtureRoot)).some((entry) => entry.endsWith(".character-lora-staging")), false, "owner-token failures clean this invocation's staging directory");

  const preOpenCollisionOutput = join(fixtureRoot, "reservation-pre-open-collision");
  let unownedTokenPath;
  await assert.rejects(
    exportCharacterLoraDataset({
      ...result.input,
      projectPath: transactionFixture.projectPath,
      manifestPath: transactionFixture.manifestPath,
      outputDirectory: preOpenCollisionOutput,
      failureInjector: async ({ phase, ownerTokenPath }) => {
        if (phase === "owner_token") {
          unownedTokenPath = ownerTokenPath;
          await writeFile(ownerTokenPath, "");
        }
      }
    }),
    (error) => error?.code === "EOUTPUT_EXISTS",
    "pre-open token collision is reported as a pre-existing final target"
  );
  assert.equal((await stat(preOpenCollisionOutput)).isDirectory(), true, "pre-open unowned final reservation is preserved");
  assert.equal(await readFile(unownedTokenPath, "utf8"), "", "pre-open unowned token is preserved");
  assert.equal((await readdir(fixtureRoot)).some((entry) => entry.endsWith(".character-lora-staging")), false, "pre-open collision cleans staging");
  await rm(preOpenCollisionOutput, { recursive: true, force: true });

  const preHandleAccessOutput = join(fixtureRoot, "reservation-pre-handle-eacces");
  const preHandleAccessError = await captureError(
    exportCharacterLoraDataset({
      ...result.input,
      projectPath: transactionFixture.projectPath,
      manifestPath: transactionFixture.manifestPath,
      outputDirectory: preHandleAccessOutput,
      failureInjector: ({ phase }) => {
        if (phase === "owner_token") { const error = new Error("injected token access denial"); error.code = "EACCES"; throw error; }
      }
    }),
    "pre-handle EACCES export"
  );
  assert.equal(preHandleAccessError.code, "EACCES");
  await assert.rejects(stat(preHandleAccessOutput), { code: "ENOENT" }, "identity-matched empty reservation is removed after pre-handle EACCES");

  const preHandleForeignOutput = join(fixtureRoot, "reservation-pre-handle-foreign");
  const preHandleForeignPath = join(preHandleForeignOutput, "foreign-before-open.bin");
  const preHandleForeignError = await captureError(
    exportCharacterLoraDataset({
      ...result.input,
      projectPath: transactionFixture.projectPath,
      manifestPath: transactionFixture.manifestPath,
      outputDirectory: preHandleForeignOutput,
      failureInjector: async ({ phase }) => {
        if (phase === "owner_token") {
          await writeFile(preHandleForeignPath, "pre-handle-foreign");
          const error = new Error("injected token access denial with foreign file");
          error.code = "EACCES";
          throw error;
        }
      }
    }),
    "pre-handle foreign EACCES export"
  );
  assert.equal(preHandleForeignError.code, "EACCES");
  assert.equal(preHandleForeignError.cleanupIncomplete, true);
  assert.deepEqual(preHandleForeignError.cleanupUnexpectedEntries, ["foreign-before-open.bin"]);
  assert.equal(await readFile(preHandleForeignPath, "utf8"), "pre-handle-foreign");
  await rm(preHandleForeignOutput, { recursive: true, force: true });

  const ownerMismatchOutput = join(fixtureRoot, "owner-mismatch");
  await assert.rejects(
    exportCharacterLoraDataset({
      ...result.input,
      projectPath: transactionFixture.projectPath,
      manifestPath: transactionFixture.manifestPath,
      outputDirectory: ownerMismatchOutput,
      failureInjector: async ({ phase, ownerTokenPath }) => {
        if (phase === "after_reservation") {
          await writeFile(ownerTokenPath, "other-owner\n");
          const error = new Error("injected owner mismatch");
          error.code = "ETEST";
          throw error;
        }
      }
    }),
    (error) => error?.code === "ETEST",
    "owner mismatch is surfaced"
  );
  assert.equal((await stat(ownerMismatchOutput)).isDirectory(), true, "owner mismatch prevents reservation cleanup");
  await rm(ownerMismatchOutput, { recursive: true, force: true });

  const foreignAfterOwnerOutput = join(fixtureRoot, "foreign-after-owner");
  const foreignAfterOwnerPath = join(foreignAfterOwnerOutput, "foreign.bin");
  const foreignAfterOwnerError = await captureError(
    exportCharacterLoraDataset({
      ...result.input,
      projectPath: transactionFixture.projectPath,
      manifestPath: transactionFixture.manifestPath,
      outputDirectory: foreignAfterOwnerOutput,
      failureInjector: async ({ phase }) => {
        if (phase === "after_reservation") {
          await writeFile(foreignAfterOwnerPath, "foreign-after-owner");
          const error = new Error("injected foreign owner failure");
          error.code = "ETEST";
          throw error;
        }
      }
    }),
    "foreign-after-owner export"
  );
  assert.equal(foreignAfterOwnerError.code, "ETEST");
  assert.equal(foreignAfterOwnerError.cleanupIncomplete, true);
  assert.deepEqual(foreignAfterOwnerError.cleanupUnexpectedEntries, ["foreign.bin"]);
  assert.equal(await readFile(foreignAfterOwnerPath, "utf8"), "foreign-after-owner");
  assert.deepEqual(await readdir(foreignAfterOwnerOutput), ["foreign.bin"], "owned owner token is removed while the concurrent file remains");
  await assert.rejects(stat(join(foreignAfterOwnerOutput, "dataset", ".character-lora-complete.json")), { code: "ENOENT" });
  await rm(foreignAfterOwnerOutput, { recursive: true, force: true });

  const foreignAfterPayloadOutput = join(fixtureRoot, "foreign-after-payload");
  const foreignAfterPayloadPath = join(foreignAfterPayloadOutput, "foreign-after-payload.bin");
  const foreignAfterPayloadError = await captureError(
    exportCharacterLoraDataset({
      ...result.input,
      projectPath: transactionFixture.projectPath,
      manifestPath: transactionFixture.manifestPath,
      outputDirectory: foreignAfterPayloadOutput,
      failureInjector: async ({ phase, index }) => {
        if (phase === "publish" && index === 1) {
          await writeFile(foreignAfterPayloadPath, "foreign-after-payload");
          const error = new Error("injected foreign payload failure");
          error.code = "ETEST";
          throw error;
        }
      }
    }),
    "foreign-after-payload export"
  );
  assert.equal(foreignAfterPayloadError.cleanupIncomplete, true);
  assert.deepEqual(foreignAfterPayloadError.cleanupUnexpectedEntries, ["foreign-after-payload.bin"]);
  assert.equal(await readFile(foreignAfterPayloadPath, "utf8"), "foreign-after-payload");
  assert.deepEqual(await readdir(foreignAfterPayloadOutput), ["foreign-after-payload.bin"], "owned partial payload is removed while the concurrent file remains");
  assert.deepEqual(await readFile(join(fixtureRoot, "approved", "frame-01.png")), sourceBeforeFailure);
  await rm(foreignAfterPayloadOutput, { recursive: true, force: true });

  const replacedOwnedOutput = join(fixtureRoot, "replaced-owned-path");
  let firstOwnedTarget;
  let replacedRelativePath;
  const replacedOwnedError = await captureError(
    exportCharacterLoraDataset({
      ...result.input,
      projectPath: transactionFixture.projectPath,
      manifestPath: transactionFixture.manifestPath,
      outputDirectory: replacedOwnedOutput,
      failureInjector: async ({ phase, index, target }) => {
        if (phase === "publish" && index === 0) firstOwnedTarget = target;
        if (phase === "publish" && index === 1) {
          await unlink(firstOwnedTarget);
          await writeFile(firstOwnedTarget, "concurrent-replacement");
          replacedRelativePath = `dataset/${firstOwnedTarget.split(/[\\/]/).at(-1)}`;
          const error = new Error("injected identity replacement");
          error.code = "ETEST";
          throw error;
        }
      }
    }),
    "replaced-owned-path export"
  );
  assert.equal(replacedOwnedError.cleanupIncomplete, true);
  assert.deepEqual(replacedOwnedError.cleanupUnexpectedEntries, [replacedRelativePath]);
  assert.equal(await readFile(firstOwnedTarget, "utf8"), "concurrent-replacement", "replacement with a new identity is never unlinked");
  await assert.rejects(stat(join(replacedOwnedOutput, "dataset", ".character-lora-complete.json")), { code: "ENOENT" });
  await rm(replacedOwnedOutput, { recursive: true, force: true });

  const completionCleanupOutput = join(fixtureRoot, "completion-cleanup-failure");
  const completionCleanupError = await captureError(
    exportCharacterLoraDataset({
      ...result.input,
      projectPath: transactionFixture.projectPath,
      manifestPath: transactionFixture.manifestPath,
      outputDirectory: completionCleanupOutput,
      failureInjector: ({ phase, relativePath }) => {
        if (phase === "after_completion") { const error = new Error("injected post-completion failure"); error.code = "EPRIMARY"; throw error; }
        if (phase === "cleanup_unlink" && relativePath === "dataset/.character-lora-complete.json") { const error = new Error("injected marker unlink denial"); error.code = "EACCES"; throw error; }
      }
    }),
    "completion cleanup failure export"
  );
  assert.equal(completionCleanupError.code, "EPRIMARY", "cleanup failure never replaces the primary export error");
  assert.equal(completionCleanupError.cleanupIncomplete, true);
  assert.equal(completionCleanupError.cleanupCompletionMarkerMayRemain, true);
  assert.equal(completionCleanupError.cleanupFailures.some((failure) => failure.operation === "unlink" && failure.relativePath === "dataset/.character-lora-complete.json" && failure.code === "EACCES"), true);
  assertSanitizedCleanupFailures(completionCleanupError);
  assert.equal(await readFile(join(completionCleanupOutput, "dataset", ".character-lora-complete.json"), "utf8"), "{\"complete\":true,\"schemaVersion\":1}\n");
  await assert.rejects(stat(join(completionCleanupOutput, "qwen-diffsynth-training.json")), { code: "ENOENT" }, "cleanup continues after marker unlink failure");
  await rm(completionCleanupOutput, { recursive: true, force: true });

  const directoryCleanupOutput = join(fixtureRoot, "directory-cleanup-failure");
  const directoryCleanupError = await captureError(
    exportCharacterLoraDataset({
      ...result.input,
      projectPath: transactionFixture.projectPath,
      manifestPath: transactionFixture.manifestPath,
      outputDirectory: directoryCleanupOutput,
      failureInjector: ({ phase, index, relativePath }) => {
        if (phase === "publish" && index === 1) { const error = new Error("injected primary publish failure"); error.code = "EPRIMARY"; throw error; }
        if (phase === "cleanup_rmdir" && relativePath === "dataset") { const error = new Error("injected dataset rmdir denial"); error.code = "EBUSY"; throw error; }
      }
    }),
    "directory cleanup failure export"
  );
  assert.equal(directoryCleanupError.code, "EPRIMARY");
  assert.equal(directoryCleanupError.cleanupFailures.some((failure) => failure.operation === "rmdir" && failure.relativePath === "dataset" && failure.code === "EBUSY"), true);
  assertSanitizedCleanupFailures(directoryCleanupError);
  assert.deepEqual(await readdir(join(directoryCleanupOutput, "dataset")), [], "file cleanup continues before the injected directory failure");
  await rm(directoryCleanupOutput, { recursive: true, force: true });

  const stagingCleanupOutput = join(fixtureRoot, "staging-cleanup-failure");
  const stagingCleanupError = await captureError(
    exportCharacterLoraDataset({
      ...result.input,
      projectPath: transactionFixture.projectPath,
      manifestPath: transactionFixture.manifestPath,
      outputDirectory: stagingCleanupOutput,
      failureInjector: ({ phase, index }) => {
        if (phase === "copy" && index === 0) { const error = new Error("injected primary staging failure"); error.code = "EPRIMARY"; throw error; }
        if (phase === "cleanup_staging_rm") { const error = new Error("injected staging rm denial"); error.code = "EACCES"; throw error; }
      }
    }),
    "staging cleanup failure export"
  );
  assert.equal(stagingCleanupError.code, "EPRIMARY");
  assert.equal(stagingCleanupError.cleanupFailures.some((failure) => failure.operation === "rm_staging" && failure.relativePath === "staging" && failure.code === "EACCES"), true);
  assertSanitizedCleanupFailures(stagingCleanupError);
  const leftoverStaging = (await readdir(fixtureRoot)).filter((entry) => entry.endsWith(".character-lora-staging"));
  assert.equal(leftoverStaging.length, 1, "injected staging cleanup failure preserves only the unique staging root");
  await rm(join(fixtureRoot, leftoverStaging[0]), { recursive: true, force: true });
  assert.deepEqual(await readFile(join(fixtureRoot, "approved", "frame-01.png")), sourceBeforeFailure, "cleanup failures never mutate source bytes");

  const publishFailureOutput = join(fixtureRoot, "publish-failure");
  await assert.rejects(
    exportCharacterLoraDataset({
      ...result.input,
      projectPath: transactionFixture.projectPath,
      manifestPath: transactionFixture.manifestPath,
      outputDirectory: publishFailureOutput,
      failureInjector: ({ phase, index }) => { if (phase === "publish" && index === 1) { const error = new Error("injected publish failure"); error.code = "ETEST"; throw error; } }
    }),
    (error) => error?.code === "ETEST",
    "partial owned publish reservation is cleaned"
  );
  await assert.rejects(stat(publishFailureOutput), { code: "ENOENT" });

  const racedOutput = join(fixtureRoot, "transaction-race");
  await assert.rejects(
    exportCharacterLoraDataset({
      ...result.input,
      projectPath: transactionFixture.projectPath,
      manifestPath: transactionFixture.manifestPath,
      outputDirectory: racedOutput,
      failureInjector: async ({ phase }) => { if (phase === "before_reservation") await mkdir(racedOutput); }
    }),
    (error) => error?.code === "EOUTPUT_EXISTS",
    "a final output created before reservation is retained rather than overwritten"
  );
  assert.equal((await stat(racedOutput)).isDirectory(), true);
  assert.equal((await readdir(fixtureRoot)).some((entry) => entry.endsWith(".character-lora-staging")), false);

  const topLevelProjectPath = join(fixtureRoot, "top-level-project.json");
  await writeFile(topLevelProjectPath, `${JSON.stringify(projectFixture().snapshot, null, 2)}\n`);
  assert.equal((await exportCharacterLoraDataset({ ...result.input, projectPath: topLevelProjectPath, manifestPath: transactionFixture.manifestPath, outputDirectory: join(fixtureRoot, "top-level-export") })).imageCount, 15);

  const cli = spawnSync(process.execPath, ["scripts/export-character-lora-dataset.mjs", "--project"], { cwd: join(fileURLToPath(new URL("..", import.meta.url))), encoding: "utf8" });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /^ECLI: usage:/);

  console.log("PASS character LoRA dataset export and training configuration");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
