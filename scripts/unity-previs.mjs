#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateExchange, validateExport } from "./lib/unity-previs/exchange.mjs";

const [command, first, second] = process.argv.slice(2);
const usage = () => "Usage: node scripts/unity-previs.mjs validate <scene.json> | verify <export-directory> <expected-scene.json>";

async function readJson(file) {
  return JSON.parse(await readFile(resolve(file), "utf8"));
}

try {
  let report;
  if (command === "validate" && first && !second) report = validateExchange(await readJson(first));
  else if (command === "verify" && first && second) report = await validateExport(resolve(first), await readJson(second));
  else throw new Error(usage());
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error.message}\n${usage()}\n`);
  process.exitCode = 2;
}
