import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const checkerUrl = pathToFileURL(path.resolve("scripts/check-graybean-dead-code.mjs")).href;
const { scanDeadCodeCandidates, formatDeadCodeAudit } = await import(checkerUrl);

const rootDir = await mkdtemp(path.join(tmpdir(), "graybean-dead-code-"));
try {
  await mkdir(path.join(rootDir, "src/legacy"), { recursive: true });
  await mkdir(path.join(rootDir, "src/app-shell"), { recursive: true });
  await mkdir(path.join(rootDir, "src/features"), { recursive: true });
  await writeFile(path.join(rootDir, "src/legacy/deadPanel.ts"), "export const DeadPanel = true;\n");
  await writeFile(
    path.join(rootDir, "src/features/static.ts"),
    'import { DeadPanel } from "../legacy/deadPanel";\nvoid DeadPanel;\n'
  );
  await writeFile(
    path.join(rootDir, "src/features/dynamic.ts"),
    'export const load = () => import("../legacy/deadPanel");\n'
  );
  await writeFile(
    path.join(rootDir, "src/app-shell/workbenchRoutes.ts"),
    'export const routes = [{ id: "legacyPipeline", component: "DeadPanel" }];\n'
  );
  await writeFile(
    path.join(rootDir, "package.json"),
    JSON.stringify({ scripts: { legacy: "node src/legacy/deadPanel.ts" } })
  );

  const candidate = {
    path: "src/legacy/deadPanel.ts",
    replacement: "src/features/advanced-tools/LegacyPipelinePanel.tsx",
    routeTokens: ["legacyPipeline", "DeadPanel"]
  };
  const blocked = await scanDeadCodeCandidates({ rootDir, candidates: [candidate] });
  assert.equal(blocked.safeCandidates.length, 0);
  assert.deepEqual(
    new Set(blocked.blockedCandidates[0]?.references.map((reference) => reference.kind)),
    new Set(["static-import", "dynamic-import", "route-registry", "package-script"])
  );
  const formatted = formatDeadCodeAudit(blocked);
  assert.match(formatted, /src\/legacy\/deadPanel\.ts/);
  assert.match(formatted, /src\/features\/advanced-tools\/LegacyPipelinePanel\.tsx/);

  await writeFile(path.join(rootDir, "src/features/static.ts"), "export const current = true;\n");
  await writeFile(path.join(rootDir, "src/features/dynamic.ts"), "export const current = true;\n");
  await writeFile(path.join(rootDir, "src/app-shell/workbenchRoutes.ts"), "export const routes = [];\n");
  await writeFile(path.join(rootDir, "package.json"), JSON.stringify({ scripts: { build: "vite build" } }));
  const safe = await scanDeadCodeCandidates({ rootDir, candidates: [candidate] });
  assert.deepEqual(safe.safeCandidates.map((item) => item.path), [candidate.path]);
  assert.equal(safe.blockedCandidates.length, 0);
} finally {
  await rm(rootDir, { recursive: true, force: true });
}

console.log("PASS graybean dead-code checker contract");
