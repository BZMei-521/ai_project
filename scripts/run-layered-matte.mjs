import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractMatte } from "./lib/layered-compositing-media.mjs";

function usage() { throw new Error("usage: --character shen_yan|jiang_lan --candidate 1|2|3 --report PATH"); }

export function parseArguments(args) {
  if (args.length !== 6) usage();
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]; const value = args[index + 1];
    if (!['--character', '--candidate', '--report'].includes(flag) || !value || values.has(flag)) usage();
    values.set(flag, value);
  }
  const character = values.get("--character"); const lexicalCandidate = values.get("--candidate");
  if (!["shen_yan", "jiang_lan"].includes(character) || !/^[123]$/.test(lexicalCandidate ?? "") || !values.has("--report")) usage();
  return { character, candidate: Number(lexicalCandidate), reportPath: path.resolve(values.get("--report")) };
}

async function main() {
  const result = await extractMatte(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ reportPath: result.reportPath, candidate: result.candidate }, null, 2)}\n`);
}

if ((process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "") === import.meta.url) main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
