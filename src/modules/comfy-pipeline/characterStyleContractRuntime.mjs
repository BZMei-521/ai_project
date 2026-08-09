const SPECIES_IDS = Object.freeze(["human", "beastfolk", "catfolk", "foxfolk", "wolffolk"]);

const LABEL_TO_SPECIES = Object.freeze({
  "species:human": "human",
  "浜虹被": "human",
  "species:beastfolk": "beastfolk",
  "鍏芥棌": "beastfolk",
  "species:catfolk": "catfolk",
  "鐚棌": "catfolk",
  "species:foxfolk": "foxfolk",
  "鐙愭棌": "foxfolk",
  "species:wolffolk": "wolffolk",
  "鐙兼棌": "wolffolk"
});

const SPECIES_ANATOMY = Object.freeze({
  human: "",
  beastfolk: "explicit beastfolk anatomy only",
  catfolk: "cat ears, cat tail",
  foxfolk: "fox ears, fox tail",
  wolffolk: "wolf ears, wolf tail"
});

const HUMAN_NEGATIVE = "human ears only, no animal ears, no tail, no horns, no animal muzzle";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const CINEMATIC_3D_DONGHUA_CONTRACT = deepFreeze({
  id: "cinematic_3d_donghua_v1",
  version: "1.0.0",
  positivePrompt: "cinematic semi-realistic 3D donghua, premium game-cinematic rendering, mature adult character proportions, refined slightly stylized facial anatomy, readable eyes, modeled nose and lips, detailed hair strands, soft luminous skin, restrained subsurface scattering, physically readable cloth leather metal fur and jewelry materials, cinematic depth of field, soft key light, controlled rim light, coherent character and environment rendering, original fantasy costume design",
  negativePrompt: "live-action photography, documentary photography, Disney, Pixar, western cartoon, chibi, toy-like, juvenile proportions, flat generic 2D anime, manga panels, watercolor, sketches, collage, character-sheet layout, waxy cheap plastic CG, excessive skin smoothing, overexposure, unreadable eyes, deformed anatomy, duplicated characters"
});

const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(input) {
  const rightRotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
  const maxWord = 2 ** 32; const words = []; const ascii = unescape(encodeURIComponent(input));
  const bitLength = ascii.length * 8; const hash = []; const constants = []; const composite = {};
  for (let candidate = 2, count = 0; count < 64; candidate += 1) {
    if (composite[candidate]) continue;
    for (let multiple = candidate * candidate; multiple < 313; multiple += candidate) composite[multiple] = true;
    hash[count] = (Math.sqrt(candidate) * maxWord) | 0; constants[count] = (candidate ** (1 / 3) * maxWord) | 0; count += 1;
  }
  let padded = `${ascii}\x80`; while ((padded.length % 64) !== 56) padded += "\x00";
  for (let index = 0; index < padded.length; index += 1) words[index >> 2] |= padded.charCodeAt(index) << ((3 - index) % 4) * 8;
  words.push(Math.floor(bitLength / maxWord), bitLength);
  for (let offset = 0; offset < words.length; offset += 16) {
    const initial = hash.slice(0, 8); const schedule = words.slice(offset, offset + 16); let working = initial.slice();
    for (let index = 0; index < 64; index += 1) {
      if (index >= 16) { const x = schedule[index - 15]; const y = schedule[index - 2]; schedule[index] = (schedule[index - 16] + (rightRotate(x, 7) ^ rightRotate(x, 18) ^ (x >>> 3)) + schedule[index - 7] + (rightRotate(y, 17) ^ rightRotate(y, 19) ^ (y >>> 10))) | 0; }
      const e = working[4]; const a = working[0];
      const temp1 = (working[7] + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) + ((e & working[5]) ^ (~e & working[6])) + constants[index] + schedule[index]) | 0;
      const temp2 = ((rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + ((a & working[1]) ^ (a & working[2]) ^ (working[1] & working[2]))) | 0;
      working = [(temp1 + temp2) | 0, working[0], working[1], working[2], (working[3] + temp1) | 0, working[4], working[5], working[6]];
    }
    for (let index = 0; index < 8; index += 1) hash[index] = (initial[index] + working[index]) | 0;
  }
  return hash.slice(0, 8).map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

const normalizeLabel = (value) => typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase() : "";
const normalizeSpecies = (value) => normalizeLabel(value);
const supportedSpecies = (value) => SPECIES_IDS.includes(value) ? value : null;
const append = (...values) => values.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean).join(", ");

export function computeCharacterStyleContractDigest(contract) {
  return sha256(stable(contract));
}

export function resolveCharacterSpecies(input = {}) {
  const identitySpecies = supportedSpecies(normalizeSpecies(input.identitySpecies));
  const labels = Array.isArray(input.explicitLabels) ? input.explicitLabels : [];
  const declaredSpecies = new Set(labels.map(normalizeLabel).map((label) => LABEL_TO_SPECIES[label]).filter(Boolean));
  if (declaredSpecies.size > 1) return { ok: false, reason: "species_metadata_conflict" };
  const scriptSpecies = declaredSpecies.values().next().value ?? null;
  if (identitySpecies && scriptSpecies && identitySpecies !== scriptSpecies) return { ok: false, reason: "species_metadata_conflict" };
  if (identitySpecies) return { ok: true, species: identitySpecies, source: "identity" };
  if (scriptSpecies) return { ok: true, species: scriptSpecies, source: "script_label" };
  return { ok: true, species: "human", source: "default_human" };
}

export function buildCharacterSpeciesClauses(result) {
  if (!result?.ok) return { positive: "", negative: "" };
  return result.species === "human"
    ? { positive: "", negative: HUMAN_NEGATIVE }
    : { positive: SPECIES_ANATOMY[result.species] ?? "", negative: "" };
}

function characterSpeciesClauses(characters) {
  const positive = [];
  const negative = [];
  for (const character of Array.isArray(characters) ? characters : []) {
    const result = resolveCharacterSpecies({ identitySpecies: character?.species, explicitLabels: character?.explicitLabels });
    if (!result.ok) throw new Error(result.reason);
    const clauses = buildCharacterSpeciesClauses(result);
    const name = typeof character?.name === "string" ? character.name.trim() : "";
    const traits = result.species === "human" || !Array.isArray(character?.speciesTraits)
      ? ""
      : character.speciesTraits.filter((trait) => typeof trait === "string" && trait.trim()).map((trait) => trait.trim()).join(", ");
    positive.push(append(name, clauses.positive, traits));
    negative.push(clauses.negative);
  }
  return { positive: append(...positive), negative: append(...negative) };
}

export function applyCharacterStyleContractToTokens(input = {}) {
  const tokens = plain(input.tokens) ? input.tokens : {};
  const contract = input.contract ?? CINEMATIC_3D_DONGHUA_CONTRACT;
  const species = characterSpeciesClauses(input.characters);
  return {
    ...tokens,
    PROMPT: input.kind === "image" ? append(tokens.PROMPT, contract.positivePrompt, species.positive) : tokens.PROMPT,
    NEXT_SCENE_PROMPT: input.kind === "image" ? append(tokens.NEXT_SCENE_PROMPT, contract.positivePrompt, species.positive) : tokens.NEXT_SCENE_PROMPT,
    VIDEO_PROMPT: input.kind === "video" ? append(tokens.VIDEO_PROMPT, contract.positivePrompt, species.positive) : tokens.VIDEO_PROMPT,
    NEGATIVE_PROMPT: append(tokens.NEGATIVE_PROMPT, contract.negativePrompt, species.negative),
    GLOBAL_VISUAL_STYLE: contract.positivePrompt,
    GLOBAL_STYLE_NEGATIVE: contract.negativePrompt,
    STYLE_CONTRACT_ID: contract.id,
    STYLE_CONTRACT_VERSION: contract.version,
    STYLE_CONTRACT_DIGEST: computeCharacterStyleContractDigest(contract)
  };
}
