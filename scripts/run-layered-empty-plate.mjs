import path from "node:path";
import { pathToFileURL } from "node:url";
import { generateEmptyPlate } from "./lib/layered-compositing-comfy.mjs";

function usage() { throw new Error("usage: --candidate 1|2|3 --mask PATH --report PATH"); }

export function parseArguments(args) {
  if (args.length !== 6) usage();
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]; const value = args[index + 1];
    if (!["--candidate", "--mask", "--report"].includes(flag) || !value || values.has(flag)) usage();
    values.set(flag, value);
  }
  const candidateLexical = values.get("--candidate");
  if (!/^[123]$/.test(candidateLexical ?? "") || !values.has("--mask") || !values.has("--report")) usage();
  const candidate = Number(candidateLexical);
  return { candidate, removalMaskPath: path.resolve(values.get("--mask")), reportPath: path.resolve(values.get("--report")) };
}

async function main() {
  const result = await generateEmptyPlate(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ reportPath: result.reportPath, candidate: result.candidate }, null, 2)}\n`);
}

if ((process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "") === import.meta.url) {
  main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
}
