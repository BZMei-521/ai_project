import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/i;
const ROUTE_REGISTRY_PATTERN = /(?:^|\/)(?:[^/]*(?:route|registry)[^/]*)\.[cm]?[jt]sx?$/i;

export const DEFAULT_REMOVAL_CANDIDATES = [];

export const DEFAULT_RETAINED_AUDIT = [
  {
    path: "src/modules/comfy-pipeline/ComfyPipelinePanel.tsx",
    replacement: "src/features/advanced-tools/LegacyPipelinePanel.tsx",
    reason: "The advanced-tools route still dynamically imports this public panel; physical deletion is not proven safe."
  }
];

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function stripSourceExtension(value) {
  return value.replace(SOURCE_EXTENSION_PATTERN, "");
}

function importTargetsCandidate(importerPath, specifier, candidatePath) {
  if (!specifier.startsWith(".")) return false;
  const resolved = normalizePath(path.resolve(path.dirname(importerPath), specifier));
  const candidate = normalizePath(path.resolve(candidatePath));
  return stripSourceExtension(resolved) === stripSourceExtension(candidate);
}

function collectImportReferences({ source, absoluteFile, relativeFile, absoluteCandidate }) {
  const references = [];
  const dynamicSpans = [];
  const dynamicPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(dynamicPattern)) {
    dynamicSpans.push([match.index, match.index + match[0].length]);
    if (importTargetsCandidate(absoluteFile, match[1], absoluteCandidate)) {
      references.push({ kind: "dynamic-import", file: relativeFile, detail: match[1] });
    }
  }

  const staticPatterns = [
    /\b(?:import|export)\s+(?:type\s+)?[^;\n]*?\sfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g
  ];
  for (const pattern of staticPatterns) {
    for (const match of source.matchAll(pattern)) {
      if (dynamicSpans.some(([start, end]) => match.index >= start && match.index < end)) continue;
      if (importTargetsCandidate(absoluteFile, match[1], absoluteCandidate)) {
        references.push({ kind: "static-import", file: relativeFile, detail: match[1] });
      }
    }
  }
  return references;
}

async function listSourceFiles(rootDir) {
  const srcDir = path.join(rootDir, "src");
  let entries = [];
  try {
    entries = await readdir(srcDir, { recursive: true, withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && SOURCE_EXTENSION_PATTERN.test(entry.name))
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
}

async function readPackageScripts(rootDir) {
  try {
    const parsed = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
    return parsed && typeof parsed.scripts === "object" ? parsed.scripts : {};
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function packageScriptReferencesCandidate(command, candidatePath) {
  const normalizedCommand = normalizePath(String(command));
  const normalizedCandidate = normalizePath(candidatePath);
  return normalizedCommand.includes(normalizedCandidate) ||
    normalizedCommand.includes(stripSourceExtension(normalizedCandidate));
}

export async function scanDeadCodeCandidates({ rootDir = process.cwd(), candidates = [] } = {}) {
  const absoluteRoot = path.resolve(rootDir);
  const sourceFiles = await listSourceFiles(absoluteRoot);
  const packageScripts = await readPackageScripts(absoluteRoot);
  const auditedCandidates = [];

  for (const candidate of candidates) {
    const absoluteCandidate = path.resolve(absoluteRoot, candidate.path);
    const references = [];
    for (const absoluteFile of sourceFiles) {
      if (stripSourceExtension(normalizePath(absoluteFile)) === stripSourceExtension(normalizePath(absoluteCandidate))) {
        continue;
      }
      const relativeFile = normalizePath(path.relative(absoluteRoot, absoluteFile));
      const source = await readFile(absoluteFile, "utf8");
      references.push(...collectImportReferences({ source, absoluteFile, relativeFile, absoluteCandidate }));
      if (ROUTE_REGISTRY_PATTERN.test(relativeFile)) {
        for (const token of candidate.routeTokens ?? []) {
          if (token && source.includes(token)) {
            references.push({ kind: "route-registry", file: relativeFile, detail: token });
          }
        }
      }
    }
    for (const [scriptName, command] of Object.entries(packageScripts)) {
      if (packageScriptReferencesCandidate(command, candidate.path)) {
        references.push({ kind: "package-script", file: "package.json", detail: scriptName });
      }
    }
    const deduped = [...new Map(references.map((item) => [`${item.kind}:${item.file}:${item.detail}`, item])).values()];
    auditedCandidates.push({ ...candidate, references: deduped });
  }

  return {
    safeCandidates: auditedCandidates.filter((candidate) => candidate.references.length === 0),
    blockedCandidates: auditedCandidates.filter((candidate) => candidate.references.length > 0)
  };
}

export function formatDeadCodeAudit(result) {
  const lines = [];
  for (const candidate of [...result.safeCandidates, ...result.blockedCandidates]) {
    const status = candidate.references.length === 0 ? "SAFE" : "BLOCKED";
    lines.push(`[${status}] candidate=${candidate.path} replacement=${candidate.replacement}`);
    for (const reference of candidate.references) {
      lines.push(`  ${reference.kind}: ${reference.file} (${reference.detail})`);
    }
  }
  lines.push(`SAFE_REMOVAL_CANDIDATES=${result.safeCandidates.length}`);
  lines.push(`BLOCKED_REMOVAL_CANDIDATES=${result.blockedCandidates.length}`);
  return lines.join("\n");
}

function parseCliCandidates(args) {
  return args.map((value) => {
    const separator = value.indexOf("=");
    if (separator <= 0 || separator === value.length - 1) {
      throw new Error(`Candidate must use path=replacement syntax: ${value}`);
    }
    return { path: value.slice(0, separator), replacement: value.slice(separator + 1), routeTokens: [] };
  });
}

async function main() {
  const cliCandidates = parseCliCandidates(process.argv.slice(2));
  const candidates = cliCandidates.length > 0 ? cliCandidates : DEFAULT_REMOVAL_CANDIDATES;
  for (const item of DEFAULT_RETAINED_AUDIT) {
    console.log(`[RETAIN] candidate=${item.path} replacement=${item.replacement}`);
    console.log(`  reason: ${item.reason}`);
  }
  const result = await scanDeadCodeCandidates({ candidates });
  console.log(formatDeadCodeAudit(result));
  if (candidates.length === 0) {
    console.log("ZERO_DELETE: no removal candidate is proven safe in the current dirty workspace.");
  }
  if (result.blockedCandidates.length > 0) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) await main();
