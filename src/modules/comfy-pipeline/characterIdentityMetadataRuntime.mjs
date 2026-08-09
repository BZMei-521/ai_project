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

const normalizeText = (value) => typeof value === "string"
  ? value.normalize("NFKC").trim().replace(/\s+/g, " ")
  : "";

function normalizeIdentityList(value) {
  if (!Array.isArray(value)) return null;
  const normalized = [...new Set(value.map(normalizeText).filter(Boolean))];
  normalized.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return normalized;
}

export function buildCharacterIdentityMetadataPayload(identity) {
  if (!plain(identity)) return null;
  const triggerWord = normalizeText(identity.triggerWord);
  const immutableTraits = normalizeIdentityList(identity.immutableTraits);
  const forbiddenChanges = normalizeIdentityList(identity.forbiddenChanges);
  if (!triggerWord || !immutableTraits?.length || !forbiddenChanges?.length) return null;
  return { triggerWord, immutableTraits, forbiddenChanges };
}

export function computeCharacterIdentityMetadataDigest(identity) {
  const payload = buildCharacterIdentityMetadataPayload(identity);
  return payload ? sha256(stable(payload)) : null;
}
