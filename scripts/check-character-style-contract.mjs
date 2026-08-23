import assert from "node:assert/strict";
import path from "node:path";
import { build } from "esbuild";
import {
  CINEMATIC_3D_DONGHUA_CONTRACT,
  applyCharacterStyleContractToTokens,
  buildCharacterSpeciesClauses,
  computeCharacterStyleContractDigest,
  resolveCharacterSpecies
} from "../src/modules/comfy-pipeline/characterStyleContractRuntime.mjs";

assert.equal(CINEMATIC_3D_DONGHUA_CONTRACT.id, "cinematic_3d_donghua_v1");
assert.equal(CINEMATIC_3D_DONGHUA_CONTRACT.version, "1.0.0");
assert.match(computeCharacterStyleContractDigest(CINEMATIC_3D_DONGHUA_CONTRACT), /^[a-f0-9]{64}$/);

assert.deepEqual(resolveCharacterSpecies({ identitySpecies: "human", explicitLabels: ["forest camp"] }), {
  ok: true, species: "human", source: "identity"
});
assert.deepEqual(resolveCharacterSpecies({ explicitLabels: [] }), {
  ok: true, species: "human", source: "default_human"
});
assert.equal(resolveCharacterSpecies({ explicitLabels: ["species:catfolk"] }).species, "catfolk");
assert.equal(resolveCharacterSpecies({ explicitLabels: ["猫耳发箍", "毛领"] }).species, "human");
assert.deepEqual(resolveCharacterSpecies({ identitySpecies: "human", explicitLabels: ["species:wolffolk"] }), {
  ok: false, reason: "species_metadata_conflict"
});
assert.deepEqual(resolveCharacterSpecies({ explicitLabels: ["species:catfolk", "species:foxfolk"] }), {
  ok: false, reason: "species_metadata_conflict"
});
assert.deepEqual(buildCharacterSpeciesClauses({ ok: true, species: "human", source: "identity" }), {
  positive: "",
  negative: "human ears only, no animal ears, no tail, no horns, no animal muzzle"
});

const human = applyCharacterStyleContractToTokens({
  tokens: { PROMPT: "Shen Yan front view", NEGATIVE_PROMPT: "" },
  kind: "image",
  characters: [{ name: "Shen Yan", species: "human" }]
});
assert.match(human.PROMPT, /cinematic semi-realistic 3D donghua/i);
assert.match(human.NEGATIVE_PROMPT, /human ears only.*no animal ears.*no tail/i);
assert.doesNotMatch(human.PROMPT, /cat ears|fox ears|wolf ears/i);

const catfolk = applyCharacterStyleContractToTokens({
  tokens: { VIDEO_PROMPT: "walks through camp", NEGATIVE_PROMPT: "" },
  kind: "video",
  characters: [{ name: "Miao", species: "catfolk", speciesTraits: ["black cat ears", "black tail"] }]
});
assert.match(catfolk.VIDEO_PROMPT, /Miao.*black cat ears.*black tail/i);
assert.doesNotMatch(catfolk.NEGATIVE_PROMPT, /no animal ears/i);

const root = process.cwd();
const bundled = await build({
  entryPoints: [path.join(root, "src/modules/comfy-pipeline/comfyService.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  write: false
});
const service = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
assert.equal(
  typeof service.applyCharacterStyleContractForRequest,
  "function",
  "comfyService must expose the production request-level style/species composer"
);

const identity = (species, speciesTraits = []) => ({ species, speciesTraits });
const characterAssets = [
  { id: "shen-yan", type: "character", name: "Shen Yan", characterIdentityPack: identity("human") },
  { id: "miao", type: "character", name: "Miao", characterIdentityPack: identity("catfolk", ["black cat ears", "black tail"]) }
];
const baseShot = {
  id: "shot-style-contract",
  title: "Style contract",
  storyPrompt: "neutral scene description",
  notes: "",
  dialogue: "",
  tags: [],
  characterRefs: []
};

const characterAssetTokens = service.applyCharacterStyleContractForRequest({
  tokens: { PROMPT: "Shen Yan front view", NEGATIVE_PROMPT: "" },
  kind: "image",
  shot: { ...baseShot, id: "asset_char_Shen Yan_reference", title: "Shen Yan" },
  assets: characterAssets
});
assert.match(characterAssetTokens.PROMPT, /cinematic semi-realistic 3D donghua/i);
assert.match(characterAssetTokens.NEGATIVE_PROMPT, /human ears only.*no animal ears/i);

const storyboardTokens = service.applyCharacterStyleContractForRequest({
  tokens: { PROMPT: "Shen Yan crosses the courtyard", NEGATIVE_PROMPT: "" },
  kind: "image",
  shot: { ...baseShot, characterRefs: ["shen-yan"] },
  assets: characterAssets
});
assert.match(storyboardTokens.PROMPT, /Shen Yan.*human ears only/i);

const videoTokens = service.applyCharacterStyleContractForRequest({
  tokens: { VIDEO_PROMPT: "Miao runs", NEGATIVE_PROMPT: "" },
  kind: "video",
  shot: { ...baseShot, characterRefs: ["miao"] },
  assets: characterAssets
});
assert.match(videoTokens.VIDEO_PROMPT, /Miao.*cat ears.*tail/i);

const canonicalTokens = service.applyCharacterStyleContractForRequest({
  tokens: { PROMPT: "canonical", NEGATIVE_PROMPT: "" },
  kind: "image",
  shot: baseShot,
  assets: [],
  settings: {
    globalVisualStylePrompt: CINEMATIC_3D_DONGHUA_CONTRACT.positivePrompt,
    globalStyleNegativePrompt: CINEMATIC_3D_DONGHUA_CONTRACT.negativePrompt
  }
});
assert.equal(canonicalTokens.STYLE_CONTRACT_ID, CINEMATIC_3D_DONGHUA_CONTRACT.id);
assert.equal(canonicalTokens.STYLE_CONTRACT_VERSION, CINEMATIC_3D_DONGHUA_CONTRACT.version);
assert.match(canonicalTokens.STYLE_CONTRACT_DIGEST, /^[a-f0-9]{64}$/);

const mixedShot = { ...baseShot, characterRefs: ["shen-yan", "miao"] };
const mixedStoryboardTokens = service.applyCharacterStyleContractForRequest({
  tokens: { PROMPT: "Shen Yan and Miao cross the courtyard", NEGATIVE_PROMPT: "" },
  kind: "image",
  shot: mixedShot,
  assets: characterAssets
});
assert.match(mixedStoryboardTokens.PROMPT, /Shen Yan.*human ears only/i);
assert.match(mixedStoryboardTokens.PROMPT, /Miao.*cat ears.*tail/i);
assert.doesNotMatch(mixedStoryboardTokens.NEGATIVE_PROMPT, /no animal ears|no tail/i);

const mixedVideoTokens = service.applyCharacterStyleContractForRequest({
  tokens: { VIDEO_PROMPT: "Shen Yan follows Miao", NEGATIVE_PROMPT: "" },
  kind: "video",
  shot: mixedShot,
  assets: characterAssets
});
assert.match(mixedVideoTokens.VIDEO_PROMPT, /Shen Yan.*human ears only/i);
assert.match(mixedVideoTokens.VIDEO_PROMPT, /Miao.*cat ears.*tail/i);
assert.doesNotMatch(mixedVideoTokens.NEGATIVE_PROMPT, /no animal ears|no tail/i);

const customTokens = service.applyCharacterStyleContractForRequest({
  tokens: { PROMPT: "custom base", NEGATIVE_PROMPT: "base negative" },
  kind: "image",
  shot: baseShot,
  assets: [],
  settings: {
    globalVisualStylePrompt: "operator custom charcoal style",
    globalStyleNegativePrompt: "operator custom glossy exclusion"
  }
});
assert.match(customTokens.PROMPT, /operator custom charcoal style/i);
assert.match(customTokens.NEGATIVE_PROMPT, /operator custom glossy exclusion/i);
assert.equal(Object.hasOwn(customTokens, "STYLE_CONTRACT_ID"), false);
assert.equal(Object.hasOwn(customTokens, "STYLE_CONTRACT_VERSION"), false);
assert.equal(Object.hasOwn(customTokens, "STYLE_CONTRACT_DIGEST"), false);
assert.doesNotMatch(customTokens.PROMPT, /cinematic semi-realistic 3D donghua/i);

const bundledPanel = await build({
  entryPoints: [path.join(root, "src/modules/comfy-pipeline/ComfyPipelinePanel.tsx")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  write: false
});
const panel = await import(
  `data:text/javascript;base64,${Buffer.from(bundledPanel.outputFiles[0].text).toString("base64")}`
);
assert.equal(
  typeof panel.resolveCharacterAssetGenerationStyleAssets,
  "function",
  "the real panel character-generation path must resolve one style identity Asset"
);
assert.throws(
  () => panel.resolveCharacterAssetGenerationStyleAssets([], "Shen Yan", "project-panel"),
  /character_asset_identity_missing_persisted/,
  "initial character generation must fail before queueing when no persisted identity Asset exists"
);
const persistedHuman = {
  id: "persisted-shen-yan",
  projectId: "project-panel",
  type: "character",
  name: "Shen Yan",
  filePath: "shen-yan-front.png",
  characterFrontPath: "shen-yan-front.png",
  characterIdentityPack: identity("human")
};
const panelCharacterAssets = panel.resolveCharacterAssetGenerationStyleAssets(
  [persistedHuman],
  "Shen Yan",
  "project-panel"
);
assert.deepEqual(panelCharacterAssets, [persistedHuman]);
const persistedCharacterAssetTokens = service.applyCharacterStyleContractForRequest({
  tokens: { PROMPT: "Shen Yan initial generation", NEGATIVE_PROMPT: "" },
  kind: "image",
  shot: { ...baseShot, id: "asset_char_Shen Yan_reference", title: "Shen Yan" },
  assets: panelCharacterAssets
});
assert.match(persistedCharacterAssetTokens.PROMPT, /cinematic semi-realistic 3D donghua/i);
assert.throws(
  () => panel.resolveCharacterAssetGenerationStyleAssets(
    [persistedHuman, { ...persistedHuman, id: "persisted-shen-yan-duplicate" }],
    "Shen Yan",
    "project-panel"
  ),
  /character_asset_identity_ambiguous_persisted/,
  "duplicate persisted character identities must fail before queueing"
);
const persistedBeastfolk = {
  ...persistedHuman,
  id: "persisted-ash",
  name: "Ash",
  filePath: "ash-front.png",
  characterFrontPath: "ash-front.png",
  characterIdentityPack: identity("beastfolk", ["lynx ear tufts", "short fur tail"])
};
const firstBeastfolkTokens = service.applyCharacterStyleContractForRequest({
  tokens: { PROMPT: "Ash initial generation", NEGATIVE_PROMPT: "" },
  kind: "image",
  shot: { ...baseShot, id: "asset_char_Ash_reference", title: "Ash" },
  assets: panel.resolveCharacterAssetGenerationStyleAssets([persistedBeastfolk], "Ash", "project-panel")
});
assert.match(firstBeastfolkTokens.PROMPT, /Ash.*beastfolk anatomy.*lynx ear tufts.*short fur tail/i);
assert.doesNotMatch(firstBeastfolkTokens.NEGATIVE_PROMPT, /no animal ears|no tail/i);

console.log("PASS cinematic 3D donghua style contract and explicit species gate");
