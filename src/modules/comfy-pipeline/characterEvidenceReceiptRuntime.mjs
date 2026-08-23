const plain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
const sha256Value = (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);

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

const outputHashes = (source) => Array.isArray(source?.shots)
  ? source.shots.map((shot) => ({ id: text(shot?.id), outputSha256: text(shot?.outputSha256) }))
  : [];

const referenceBinding = (source) => ({
  referenceManifestDigest: text(source?.referenceManifestDigest),
  references: Array.isArray(source?.references) ? source.references.map((item) => ({ shotId: text(item?.shotId), slot: text(item?.slot), sourceSha256: text(item?.sourceSha256), transformedSha256: text(item?.transformedSha256), transform: text(item?.transform) })) : []
});

export function buildCharacterEvidenceReceiptClaims(source, reportDigest = null) {
  const subject = plain(source?.subject) ? source.subject : source;
  const evaluator = plain(source?.evaluatorProof) ? source.evaluatorProof : source;
  const digest = text(reportDigest) ?? text(source?.sourceReportDigest) ?? text(source?.evidenceDigest);
  const claims = {
    reportDigest: digest,
    generationMode: text(source?.generationMode),
    characterAssetId: text(subject?.characterAssetId),
    identityPackVersion: text(subject?.identityPackVersion),
    identityMetadataDigest: text(subject?.identityMetadataDigest),
    fixtureDigest: text(source?.fixtureDigest),
    evaluatorImplementationHash: text(evaluator?.implementationHash) ?? text(source?.evaluatorImplementationHash),
    evaluatorPolicyHash: text(evaluator?.policyHash) ?? text(source?.evaluatorPolicyHash),
    outputHashesDigest: sha256(stable(outputHashes(source))),
    referenceBindingDigest: sha256(stable(referenceBinding(source)))
  };
  return Object.values(claims).every(Boolean) && [claims.reportDigest, claims.identityMetadataDigest, claims.fixtureDigest, claims.evaluatorImplementationHash, claims.evaluatorPolicyHash, claims.outputHashesDigest, claims.referenceBindingDigest].every(sha256Value)
    ? claims
    : null;
}

export function computeCharacterEvidenceReceiptClaimsDigest(claims) {
  return plain(claims) ? sha256(stable(claims)) : null;
}

export function validateCharacterEvidenceReceipt(receipt, source, verification, reportDigest = null) {
  if (!plain(receipt)) return { valid: false, reason: "trusted_receipt_missing" };
  if (receipt.schemaVersion !== 1 || receipt.issuer !== "storyboard-desktop-character-evidence-v1" || !sha256Value(receipt.receiptId) || !sha256Value(receipt.claimsDigest)) return { valid: false, reason: "trusted_receipt_invalid" };
  const claims = buildCharacterEvidenceReceiptClaims(source, reportDigest);
  if (!claims) return { valid: false, reason: "trusted_receipt_claims_invalid" };
  const expectedKeys = new Set(["schemaVersion", "issuer", "receiptId", "claimsDigest", ...Object.keys(claims)]);
  if (Object.keys(receipt).length !== expectedKeys.size || Object.keys(receipt).some((key) => !expectedKeys.has(key))) return { valid: false, reason: "trusted_receipt_invalid" };
  const claimsDigest = computeCharacterEvidenceReceiptClaimsDigest(claims);
  for (const [key, value] of Object.entries(claims)) if (receipt[key] !== value) return { valid: false, reason: "trusted_receipt_claims_mismatch" };
  if (receipt.claimsDigest !== claimsDigest) return { valid: false, reason: "trusted_receipt_claims_mismatch" };
  if (!plain(verification) || verification.valid !== true || verification.receiptId !== receipt.receiptId || verification.claimsDigest !== claimsDigest) return { valid: false, reason: "trusted_receipt_unverified" };
  return { valid: true, reason: "ok", claimsDigest };
}
