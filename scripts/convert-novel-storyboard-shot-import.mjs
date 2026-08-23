import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildSegmentShotScript } from "./novel-storyboard-shot-import-runtime.mjs";
import { parseShotScriptText } from "../src/features/script-director/shotScriptImportRuntime.mjs";

const REQUIRED_FLAGS = ["storyboard", "script", "outline", "segment", "frames", "out"];

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(`invalid argument near: ${flag ?? "<end>"}`);
    }
    values[flag.slice(2)] = value;
  }
  const missing = REQUIRED_FLAGS.filter((name) => !values[name]?.trim());
  if (missing.length > 0) throw new Error(`missing required flags: ${missing.join(", ")}`);
  return values;
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${label} JSON: ${path}; ${String(error)}`);
  }
}

async function main() {
  const values = parseArgs(process.argv.slice(2));
  const storyboardPath = resolve(values.storyboard);
  const scriptPath = resolve(values.script);
  const outlinePath = resolve(values.outline);
  const frameDirectory = resolve(values.frames);
  const outputPath = resolve(values.out);
  const result = buildSegmentShotScript({
    board: await readJson(storyboardPath, "storyboard"),
    script: await readJson(scriptPath, "script"),
    outline: await readJson(outlinePath, "outline"),
    segmentId: values.segment,
    frameDirectory,
    frameExists: existsSync
  });
  const parsed = parseShotScriptText(JSON.stringify(result), {
    fps: 24,
    sequenceId: "sequence-main"
  });
  if (!parsed.ok) {
    throw new Error(`generated import rejected: ${JSON.stringify(parsed.issues)}`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(
    `PASS ${values.segment}: ${parsed.value.shots.length} shot / ${parsed.value.shots[0].durationFrames} frames / ${parsed.value.transitions.length} transitions`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
