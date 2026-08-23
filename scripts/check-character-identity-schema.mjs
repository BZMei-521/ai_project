import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateAndCanonicalizeCharacterIdentityMetadata } from "../src/modules/comfy-pipeline/characterIdentityMetadataRuntime.mjs";
import {
  CINEMATIC_3D_DONGHUA_CONTRACT,
  computeCharacterStyleContractDigest
} from "../src/modules/comfy-pipeline/characterStyleContractRuntime.mjs";

const types = await readFile(new URL("../src/modules/storyboard-core/types.ts", import.meta.url), "utf8");
const store = await readFile(new URL("../src/modules/storyboard-core/store.ts", import.meta.url), "utf8");

const identity = {
  triggerWord: "char_ada",
  immutableTraits: ["amber eyes", "short black bob"],
  forbiddenChanges: ["blue eyes", "long hair"],
  species: "human",
  speciesTraits: [],
  styleContractId: "cinematic_3d_donghua_v1",
  styleContractVersion: "1.0.0",
  styleContractDigest: computeCharacterStyleContractDigest(CINEMATIC_3D_DONGHUA_CONTRACT)
};

assert.equal(validateAndCanonicalizeCharacterIdentityMetadata(identity).ok, true);
assert.equal(validateAndCanonicalizeCharacterIdentityMetadata({ ...identity, species: "dragonfolk" }).ok, false);
assert.equal(validateAndCanonicalizeCharacterIdentityMetadata({ ...identity, speciesTraits: ["cat ears"] }).ok, false, "human identities require an empty species-traits list");
assert.equal(validateAndCanonicalizeCharacterIdentityMetadata({ ...identity, species: "catfolk" }).ok, false, "non-human identities require explicit species traits");
assert.equal(validateAndCanonicalizeCharacterIdentityMetadata({ ...identity, species: "catfolk", speciesTraits: ["black tail", "black cat ears"] }).ok, true);
assert.equal(validateAndCanonicalizeCharacterIdentityMetadata({ ...identity, species: "catfolk", speciesTraits: Array.from({ length: 9 }, (_, index) => `trait-${index}`) }).ok, false, "non-human identities accept at most eight species traits");
assert.equal(validateAndCanonicalizeCharacterIdentityMetadata({ ...identity, styleContractVersion: "2.0.0" }).ok, false, "identity metadata rejects a non-canonical style contract");

for (const symbol of [
  "CharacterIdentityPack",
  "CharacterLoraProfile",
  "CharacterConsistencyBaseline",
  "CharacterGenerationMetadata"
]) {
  assert.match(types, new RegExp(`export type ${symbol}\\b`), `missing ${symbol}`);
}
const identityPack = /export type CharacterIdentityPack = \{([\s\S]*?)\n\};/.exec(types)?.[1] ?? "";
for (const field of ["species", "speciesTraits", "styleContractId", "styleContractVersion", "styleContractDigest"]) {
  assert.match(identityPack, new RegExp(`\\b${field}\\b`), `CharacterIdentityPack is missing ${field}`);
}
for (const field of ["characterIdentityPack", "characterLora", "characterConsistencyBaseline"]) {
  assert.match(types, new RegExp(`${field}\\?`), `Asset is missing ${field}`);
  assert.match(store, new RegExp(field), `store does not persist ${field}`);
}

const shotLayer = /export type ShotLayer = \{([\s\S]*?)\n\};/.exec(types)?.[1] ?? "";
assert.match(
  shotLayer,
  /characterGenerationMetadata\?: CharacterGenerationMetadata;/,
  "ShotLayer is missing characterGenerationMetadata"
);

const asset = /export type Asset = \{([\s\S]*?)\n\};/.exec(types)?.[1] ?? "";
for (const [field, type] of [
  ["characterIdentityPack", "CharacterIdentityPack"],
  ["characterLora", "CharacterLoraProfile"],
  ["characterConsistencyBaseline", "CharacterConsistencyBaseline"]
]) {
  assert.match(asset, new RegExp(`${field}\\?: ${type};`), `Asset ${field} must reference ${type}`);
  assert.match(
    store,
    new RegExp(`${field}:\\s*input\\.type === "character" \\? input\\.${field} : undefined`),
    `addAsset must persist ${field} only for characters`
  );
  assert.match(
    store,
    new RegExp(
      `${field}:\\s*\\(patch\\.type \\?\\? asset\\.type\\) === "character"\\s*\\? patch\\.${field} \\?\\? asset\\.${field}\\s*:\\s*undefined`
    ),
    `updateAsset must preserve ${field} only for characters and clear it on type transitions`
  );
}
console.log("PASS character identity schema and store persistence");
