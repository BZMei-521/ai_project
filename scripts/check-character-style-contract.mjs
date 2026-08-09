import assert from "node:assert/strict";
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

console.log("PASS cinematic 3D donghua style contract and explicit species gate");
