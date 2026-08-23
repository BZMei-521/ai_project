import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildTrustedCharacterGenerationEvidenceContext } from "../src/modules/comfy-pipeline/characterEvidenceContextRuntime.mjs";

const PROJECT_PATH = resolve("examples/character-consistency-benchmark/current-project-klein-release-subject-cinematic3d.json");
const MANIFEST_PATH = resolve("logs/shen-yan-hybrid-v5/hybrid-candidate-manifest.json");
const OLD_REPORT_PATH = resolve("logs/character-consistency-benchmark-klein-zero-shot.json");
const EXPECTED_ASSET_ID = "asset_1774017261433_390";

const sha256File = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const project = await readJson(PROJECT_PATH);
const manifest = await readJson(MANIFEST_PATH);
const oldReport = await readJson(OLD_REPORT_PATH);
const asset = project?.snapshot?.assets?.find((item) => item?.id === EXPECTED_ASSET_ID);
if (!asset || manifest.characterAssetId !== EXPECTED_ASSET_ID) throw new Error("approved character asset is missing");
if (manifest.status !== "approved" || manifest.approval !== "explicit_user_confirmation") throw new Error("manifest is not explicitly approved");

const identity = asset.characterIdentityPack;
const byView = Object.fromEntries(manifest.canonicalViews.map((item) => [item.view, item]));
if (!["front", "side", "back"].every((view) => byView[view]?.sha256)) throw new Error("approved manifest is missing a canonical view");

const expectedPaths = {
  front: resolve("logs/shen-yan-zimage-hero-v1/hero-2026080913.png"),
  side: resolve("logs/shen-yan-hybrid-v5/side.png"),
  back: resolve("logs/shen-yan-hybrid-v5/back.png")
};
for (const view of ["front", "side", "back"]) {
  if (await sha256File(expectedPaths[view]) !== byView[view].sha256) throw new Error(`${view} hash does not match the approved manifest`);
}

const expectedIdentityPaths = {
  faceMasterPath: expectedPaths.front,
  bodyFrontPath: expectedPaths.front,
  neutralExpressionPath: expectedPaths.front,
  faceLeftPath: expectedPaths.side,
  faceRightPath: expectedPaths.side,
  bodySidePath: expectedPaths.side,
  hairBackPath: expectedPaths.back,
  bodyBackPath: expectedPaths.back
};
for (const [field, expectedPath] of Object.entries(expectedIdentityPaths)) {
  if (identity?.[field] !== expectedPath) throw new Error(`${field} does not match the approved canonical view`);
}
if (identity.version !== manifest.proposedIdentityPackVersion) throw new Error("identity version does not match the approved manifest");
if (identity.species !== "human" || !Array.isArray(identity.speciesTraits) || identity.speciesTraits.length !== 0) throw new Error("Shen Yan must remain human-only");
if (identity.styleContractId !== manifest.styleContract.id || identity.styleContractVersion !== manifest.styleContract.version || identity.styleContractDigest !== manifest.styleContract.digest) {
  throw new Error("identity style contract does not match the approved manifest");
}

const referenceSourceHashes = {
  face_master: byView.front.sha256,
  face_left: byView.side.sha256,
  face_right: byView.side.sha256,
  hair_back: byView.back.sha256,
  body_front: byView.front.sha256,
  body_side: byView.side.sha256,
  body_back: byView.back.sha256,
  expression_neutral: byView.front.sha256
};
const built = buildTrustedCharacterGenerationEvidenceContext({
  asset,
  mode: "zero_shot_multi_reference",
  referenceSourceHashes,
  providerId: "flux2_klein_4b",
  modelName: "flux-2-klein-4b-fp8.safetensors",
  workflowProof: oldReport.preflight.providerProof
});
if (!built.ok) throw new Error(`new trusted identity context is invalid: ${built.reason}`);

const invalidation = oldReport.subject?.identityPackVersion === built.context.identityPackVersion
  ? "unexpected_identity_match"
  : "identity_pack_version_mismatch";
if (invalidation === "unexpected_identity_match") throw new Error("old benchmark evidence was not invalidated");

process.stdout.write(`${JSON.stringify({
  status: "PASS",
  assetId: asset.id,
  newIdentityVersion: identity.version,
  styleContractDigest: identity.styleContractDigest,
  referenceManifestDigest: built.context.referenceManifestDigest,
  oldIdentityVersion: oldReport.subject.identityPackVersion,
  invalidation
}, null, 2)}\n`);
