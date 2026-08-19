import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const checkerPath = path.resolve("scripts/check-graybean-dead-code.mjs");
const checkerUrl = pathToFileURL(checkerPath).href;
const { scanDeadCodeCandidates, formatDeadCodeAudit } = await import(checkerUrl);
const execFileAsync = promisify(execFile);

const rootDir = await mkdtemp(path.join(tmpdir(), "graybean-dead-code-"));
try {
  await mkdir(path.join(rootDir, "src/legacy"), { recursive: true });
  await mkdir(path.join(rootDir, "src/app-shell"), { recursive: true });
  await mkdir(path.join(rootDir, "src/features"), { recursive: true });
  await writeFile(path.join(rootDir, "src/legacy/deadPanel.ts"), "export const DeadPanel = true;\n");
  await writeFile(
    path.join(rootDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@legacy/*": ["src/legacy/*"] }
      }
    })
  );
  await writeFile(
    path.join(rootDir, "src/features/static.ts"),
    'import { DeadPanel } from "../legacy/deadPanel";\nvoid DeadPanel;\n'
  );
  await writeFile(
    path.join(rootDir, "src/features/multilineImport.ts"),
    'import {\n  DeadPanel\n} from "../legacy/deadPanel";\nvoid DeadPanel;\n'
  );
  await writeFile(
    path.join(rootDir, "src/features/multilineReexport.ts"),
    'export {\n  DeadPanel\n} from "../legacy/deadPanel";\n'
  );
  await writeFile(
    path.join(rootDir, "src/features/importEquals.ts"),
    'import legacyPanel = require("../legacy/deadPanel");\nvoid legacyPanel;\n'
  );
  await writeFile(
    path.join(rootDir, "src/features/dynamic.ts"),
    'export const load = () => import("../legacy/deadPanel");\n'
  );
  await writeFile(
    path.join(rootDir, "src/features/baseUrl.ts"),
    'import { DeadPanel } from "src/legacy/deadPanel";\nvoid DeadPanel;\n'
  );
  await writeFile(
    path.join(rootDir, "src/features/alias.ts"),
    'export const loadAlias = () => import("@legacy/deadPanel");\n'
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
  assert.ok(
    blocked.blockedCandidates[0]?.references.some((reference) => reference.detail === "src/legacy/deadPanel"),
    "tsconfig baseUrl import should block deletion"
  );
  assert.ok(
    blocked.blockedCandidates[0]?.references.some((reference) => reference.detail === "@legacy/deadPanel"),
    "tsconfig paths alias import should block deletion"
  );
  assert.ok(
    blocked.blockedCandidates[0]?.references.some(
      (reference) => reference.kind === "static-import" && reference.file === "src/features/multilineImport.ts"
    ),
    "multiline static import should block deletion"
  );
  assert.ok(
    blocked.blockedCandidates[0]?.references.some(
      (reference) => reference.kind === "static-import" && reference.file === "src/features/multilineReexport.ts"
    ),
    "multiline re-export should block deletion"
  );
  assert.ok(
    blocked.blockedCandidates[0]?.references.some(
      (reference) => reference.kind === "static-import" && reference.file === "src/features/importEquals.ts"
    ),
    "ImportEquals external module reference should block deletion"
  );
  const formatted = formatDeadCodeAudit(blocked);
  assert.match(formatted, /src\/legacy\/deadPanel\.ts/);
  assert.match(formatted, /src\/features\/advanced-tools\/LegacyPipelinePanel\.tsx/);

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [checkerPath, "src/legacy/deadPanel.ts=src/features/advanced-tools/LegacyPipelinePanel.tsx::legacyPipeline,DeadPanel"],
      { cwd: rootDir }
    ),
    (error) => {
      assert.equal(error?.code, 1);
      assert.match(error?.stdout ?? "", /route-registry: src\/app-shell\/workbenchRoutes\.ts \(legacyPipeline\)/);
      return true;
    }
  );
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [checkerPath, "src/legacy/deadPanel.ts=src/features/advanced-tools/LegacyPipelinePanel.tsx"],
      { cwd: rootDir }
    ),
    (error) => {
      assert.equal(error?.code, 1);
      assert.match(error?.stdout ?? "", /route-registry: src\/app-shell\/workbenchRoutes\.ts \(DeadPanel\)/);
      return true;
    }
  );

  await assert.rejects(
    () => scanDeadCodeCandidates({
      rootDir,
      candidates: [{ path: "src/legacy/missing.ts", replacement: "src/current.ts" }]
    }),
    /candidate does not exist/i
  );
  await assert.rejects(
    () => scanDeadCodeCandidates({
      rootDir,
      candidates: [{ path: "src/legacy", replacement: "src/current.ts" }]
    }),
    /candidate is not a file/i
  );
  await assert.rejects(
    () => scanDeadCodeCandidates({
      rootDir,
      candidates: [{ path: "../outside.ts", replacement: "src/current.ts" }]
    }),
    /outside repository root/i
  );

  await writeFile(path.join(rootDir, "src/features/static.ts"), "export const current = true;\n");
  await writeFile(path.join(rootDir, "src/features/multilineImport.ts"), "export const current = true;\n");
  await writeFile(path.join(rootDir, "src/features/multilineReexport.ts"), "export const current = true;\n");
  await writeFile(path.join(rootDir, "src/features/importEquals.ts"), "export const current = true;\n");
  await writeFile(path.join(rootDir, "src/features/dynamic.ts"), "export const current = true;\n");
  await writeFile(path.join(rootDir, "src/features/baseUrl.ts"), "export const current = true;\n");
  await writeFile(path.join(rootDir, "src/features/alias.ts"), "export const current = true;\n");
  await writeFile(path.join(rootDir, "src/app-shell/workbenchRoutes.ts"), "export const routes = [];\n");
  await writeFile(path.join(rootDir, "package.json"), JSON.stringify({ scripts: { build: "vite build" } }));
  const safe = await scanDeadCodeCandidates({ rootDir, candidates: [candidate] });
  assert.deepEqual(safe.safeCandidates.map((item) => item.path), [candidate.path]);
  assert.equal(safe.blockedCandidates.length, 0);
} finally {
  await rm(rootDir, { recursive: true, force: true });
}

console.log("PASS graybean dead-code checker contract");
