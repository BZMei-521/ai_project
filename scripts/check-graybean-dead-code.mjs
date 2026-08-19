import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

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

function matchesPathPattern(specifier, pattern) {
  const wildcard = pattern.indexOf("*");
  if (wildcard < 0) return specifier === pattern ? "" : null;
  const prefix = pattern.slice(0, wildcard);
  const suffix = pattern.slice(wildcard + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return null;
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

function resolveImportPaths(importerPath, specifier, tsconfigResolvers) {
  if (specifier.startsWith(".")) return [path.resolve(path.dirname(importerPath), specifier)];
  const resolved = [];
  for (const config of tsconfigResolvers) {
    for (const [pattern, targets] of Object.entries(config.paths)) {
      const wildcardValue = matchesPathPattern(specifier, pattern);
      if (wildcardValue === null) continue;
      for (const target of targets) {
        resolved.push(path.resolve(config.basePath, target.replace("*", wildcardValue)));
      }
    }
    resolved.push(path.resolve(config.basePath, specifier));
  }
  return resolved;
}

function importTargetsCandidate(importerPath, specifier, candidatePath, tsconfigResolvers) {
  const candidate = normalizePath(path.resolve(candidatePath));
  return resolveImportPaths(importerPath, specifier, tsconfigResolvers)
    .some((resolved) => stripSourceExtension(normalizePath(resolved)) === stripSourceExtension(candidate));
}

function scriptKindForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function collectImportReferences({ source, absoluteFile, relativeFile, absoluteCandidate, tsconfigResolvers }) {
  const references = [];
  const sourceFile = ts.createSourceFile(
    relativeFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(relativeFile)
  );
  const addReference = (kind, moduleSpecifier) => {
    if (importTargetsCandidate(absoluteFile, moduleSpecifier, absoluteCandidate, tsconfigResolvers)) {
      references.push({ kind, file: relativeFile, detail: moduleSpecifier });
    }
  };
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      addReference("static-import", node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      addReference("static-import", node.moduleReference.expression.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      addReference("dynamic-import", node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
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

async function readTsconfigResolvers(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const configPaths = entries
    .filter((entry) => entry.isFile() && /^tsconfig(?:\.[^.]+)?\.json$/i.test(entry.name))
    .map((entry) => path.join(rootDir, entry.name));
  const resolvers = [];
  for (const configPath of configPaths) {
    const diagnostics = [];
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => diagnostics.push(diagnostic)
    });
    if (!parsed || diagnostics.length > 0) {
      throw new Error(`Unable to parse TypeScript config: ${normalizePath(path.relative(rootDir, configPath))}`);
    }
    const basePath = parsed.options.baseUrl
      ? path.resolve(parsed.options.baseUrl)
      : path.dirname(configPath);
    resolvers.push({ basePath, paths: parsed.options.paths ?? {} });
  }
  return resolvers;
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
  const tsconfigResolvers = await readTsconfigResolvers(absoluteRoot);
  const auditedCandidates = [];

  for (const candidate of candidates) {
    const absoluteCandidate = path.resolve(absoluteRoot, candidate.path);
    const relativeCandidate = path.relative(absoluteRoot, absoluteCandidate);
    if (relativeCandidate.startsWith("..") || path.isAbsolute(relativeCandidate)) {
      throw new Error(`Candidate is outside repository root: ${candidate.path}`);
    }
    let candidateStat;
    try {
      candidateStat = await stat(absoluteCandidate);
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`Candidate does not exist: ${candidate.path}`);
      throw error;
    }
    if (!candidateStat.isFile()) throw new Error(`Candidate is not a file: ${candidate.path}`);
    const references = [];
    for (const absoluteFile of sourceFiles) {
      if (stripSourceExtension(normalizePath(absoluteFile)) === stripSourceExtension(normalizePath(absoluteCandidate))) {
        continue;
      }
      const relativeFile = normalizePath(path.relative(absoluteRoot, absoluteFile));
      const source = await readFile(absoluteFile, "utf8");
      references.push(...collectImportReferences({
        source,
        absoluteFile,
        relativeFile,
        absoluteCandidate,
        tsconfigResolvers
      }));
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

export function parseCliCandidates(args) {
  return args.map((value) => {
    const tokenSeparator = value.indexOf("::");
    const mapping = tokenSeparator >= 0 ? value.slice(0, tokenSeparator) : value;
    const routeTokenText = tokenSeparator >= 0 ? value.slice(tokenSeparator + 2) : "";
    const separator = mapping.indexOf("=");
    if (separator <= 0 || separator === mapping.length - 1) {
      throw new Error(`Candidate must use candidate=replacement::routeToken1,routeToken2 syntax: ${value}`);
    }
    const candidatePath = mapping.slice(0, separator);
    const routeTokens = routeTokenText
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean);
    if (routeTokens.length === 0) {
      const basename = path.basename(candidatePath).replace(SOURCE_EXTENSION_PATTERN, "");
      routeTokens.push(basename);
      const exportedName = basename ? `${basename[0].toUpperCase()}${basename.slice(1)}` : "";
      if (exportedName && exportedName !== basename) routeTokens.push(exportedName);
    }
    return {
      path: candidatePath,
      replacement: mapping.slice(separator + 1),
      routeTokens
    };
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
