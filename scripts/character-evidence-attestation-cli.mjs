#!/usr/bin/env node
import { attestCharacterGenerationReport, verifyCharacterEvidenceReceiptFromRegistry } from "./character-evidence-attestation.mjs";

const [operation, registryRoot] = process.argv.slice(2);
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 10 * 1024 * 1024) throw new Error("attestation_input_too_large");
}
const payload = JSON.parse(input);
const result = operation === "attest"
  ? await attestCharacterGenerationReport(payload.report, { registryRoot })
  : operation === "verify"
    ? await verifyCharacterEvidenceReceiptFromRegistry(payload, { registryRoot })
    : (() => { throw new Error("attestation_operation_invalid"); })();
process.stdout.write(`${JSON.stringify(result)}\n`);
