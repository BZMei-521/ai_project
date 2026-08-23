import path from "node:path";
import { pathToFileURL } from "node:url";
import { composeDeterministically } from "./lib/layered-compositing-compose.mjs";

function usage() { throw new Error("usage: --candidate 1|2|3 --report PATH --protection-contract PATH"); }

export function parseArguments(args) {
  if (args.length !== 6) usage();
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]; const value = args[index + 1];
    if (!["--candidate", "--report", "--protection-contract"].includes(flag) || !value || values.has(flag)) usage();
    values.set(flag, value);
  }
  const lexicalCandidate = values.get("--candidate");
  if (!/^[123]$/.test(lexicalCandidate ?? "") || !values.has("--report") || !values.has("--protection-contract")) usage();
  return {
    candidate: Number(lexicalCandidate),
    reportPath: path.resolve(values.get("--report")),
    protectionContractPath: path.resolve(values.get("--protection-contract")),
  };
}

async function main() {
  const result = await composeDeterministically(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ reportPath: result.reportPath, candidate: result.candidate }, null, 2)}\n`);
}

if ((process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "") === import.meta.url) {
  main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
}
