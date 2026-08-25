import { constants, copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const REQUIRED_PATHS = [
  "分镜/rework-e01-01-new-skills/source.script.json",
  "分镜/rework-e01-01-new-skills/storyboard-actions.json",
  "分镜/rework-e01-01-new-skills/action.json",
  "分镜/rework-e01-01-new-skills/storyboard.json",
  "人物/影帝他总想对我图谋不轨-cast.json",
  "人物/images/李宝珠-sheet.png",
  "分镜/work/E01-01.spatial-stage.seed.json",
];

function parseArgs(argv) {
  const result = { copyMissing: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--copy-missing") {
      result.copyMissing = true;
      continue;
    }
    if (token === "--source-root" || token === "--target-root") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${token}`);
      result[token === "--source-root" ? "sourceRoot" : "targetRoot"] = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (!result.sourceRoot || !result.targetRoot) {
    throw new Error("--source-root and --target-root are required");
  }
  return result;
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function jsonSemanticallyEqual(leftPath, rightPath) {
  if (path.extname(leftPath).toLowerCase() !== ".json") return false;
  try {
    const [left, right] = await Promise.all([
      readFile(leftPath, "utf8").then(JSON.parse),
      readFile(rightPath, "utf8").then(JSON.parse),
    ]);
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

async function inspectInputs(options) {
  const report = { ok: false, copied: [], verified: [], missing: [], missingSources: [], conflicts: [] };
  for (const relativePath of REQUIRED_PATHS) {
    const parts = relativePath.split("/");
    const sourcePath = path.join(options.sourceRoot, ...parts);
    const targetPath = path.join(options.targetRoot, ...parts);
    if (!(await isFile(sourcePath))) {
      report.missingSources.push(relativePath);
      continue;
    }
    const sourceSha256 = await sha256(sourcePath);
    if (!(await isFile(targetPath))) {
      if (!options.copyMissing) {
        report.missing.push(relativePath);
        continue;
      }
      await mkdir(path.dirname(targetPath), { recursive: true });
      try {
        await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
        report.copied.push(relativePath);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
    const targetSha256 = await sha256(targetPath);
    const equivalence = targetSha256 === sourceSha256
      ? "byte-identical"
      : (await jsonSemanticallyEqual(sourcePath, targetPath) ? "json-semantic" : null);
    if (!equivalence) {
      report.conflicts.push({ relativePath, sourceSha256, targetSha256 });
      continue;
    }
    report.verified.push({ relativePath, sha256: targetSha256, sourceSha256, equivalence });
  }
  report.ok = report.missingSources.length === 0 && report.missing.length === 0 &&
    report.conflicts.length === 0 && report.verified.length === REQUIRED_PATHS.length;
  return report;
}

try {
  const report = await inspectInputs(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.missingSources.length > 0) process.exitCode = 2;
  else if (report.conflicts.length > 0) process.exitCode = 3;
  else if (!report.ok) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 64;
}
