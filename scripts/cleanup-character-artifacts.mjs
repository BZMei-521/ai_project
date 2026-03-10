#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const usage = `Usage:
  node scripts/cleanup-character-artifacts.mjs <output-dir> [--apply]

Behavior:
  - Deletes character-generation intermediate files only
  - Keeps final *_front.png / *_side.png / *_back.png outputs
  - Default is dry-run; pass --apply to actually delete files
`;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const positional = args.filter((value) => value !== "--apply");
const rootDir = positional[0] ? path.resolve(positional[0]) : "";

if (!rootDir || positional.includes("--help") || positional.includes("-h")) {
  console.log(usage);
  process.exit(rootDir ? 0 : 1);
}

const INTERMEDIATE_SUFFIX_PATTERNS = [
  /_flatbg\.png$/i,
  /_subject\.png$/i,
  /_framed\.png$/i,
  /_panel\d+\.png$/i,
  /_triptych_input_\d+\.png$/i
];

const REMOVE_PREFIX_PATTERNS = [
  /^character_anchor_/i,
  /^character_anchor_cleanup_/i,
  /^character_mv_/i,
  /^character_threeview/i
];

const REMOVE_TOKEN_PATTERNS = [
  /fallback/i,
  /cleanup/i
];

const KEEP_SUFFIX_PATTERNS = [
  /_front\.png$/i,
  /_side\.png$/i,
  /_back\.png$/i
];

const shouldKeep = (basename) => KEEP_SUFFIX_PATTERNS.some((pattern) => pattern.test(basename));

const shouldDelete = (basename) => {
  if (shouldKeep(basename)) return false;
  if (INTERMEDIATE_SUFFIX_PATTERNS.some((pattern) => pattern.test(basename))) return true;
  if (REMOVE_PREFIX_PATTERNS.some((pattern) => pattern.test(basename))) return true;
  return REMOVE_TOKEN_PATTERNS.some((pattern) => pattern.test(basename));
};

async function walk(dir, results = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, results);
      continue;
    }
    if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

async function main() {
  const stat = await fs.stat(rootDir).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Output directory not found: ${rootDir}`);
  }

  const files = await walk(rootDir);
  const targets = files.filter((filePath) => shouldDelete(path.basename(filePath)));

  if (targets.length === 0) {
    console.log(`No character intermediate artifacts found under ${rootDir}`);
    return;
  }

  console.log(`${apply ? "Deleting" : "Would delete"} ${targets.length} files under ${rootDir}`);
  for (const filePath of targets) {
    console.log(filePath);
  }

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to delete.");
    return;
  }

  for (const filePath of targets) {
    await fs.unlink(filePath);
  }
  console.log(`\nDeleted ${targets.length} files.`);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
