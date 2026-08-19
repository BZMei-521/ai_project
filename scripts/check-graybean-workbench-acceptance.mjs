import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const node = process.execPath;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const checks = [
  ["migration", [node, "scripts/check-workbench-migration.mjs"]],
  ["spatial-scene-domain", [node, "scripts/check-spatial-scene-domain.mjs"]],
  ["spatial-preview-runtime", [node, "scripts/check-spatial-preview-runtime.mjs"]],
  ["workbench-shell", [node, "scripts/check-workbench-shell.mjs"]],
  ["spatial-stage-schema", [node, "scripts/check-spatial-stage-schema.mjs"]],
  ["spatial-stage-capabilities", [node, "scripts/check-spatial-stage-capabilities.mjs"]],
  ["spatial-stage-viewport", [node, "scripts/check-spatial-stage-viewport.mjs"]],
  ["spatial-stage-rigs", [node, "scripts/check-spatial-stage-rigs.mjs"]],
  ["spatial-stage-state", [node, "scripts/check-spatial-stage-state.mjs"]],
  ["spatial-stage-moge", [node, "scripts/check-spatial-stage-moge.mjs"]],
  ["workbench-feature-routing", [node, "scripts/check-workbench-feature-routing.mjs"]],
  ["graybean-dead-code", [node, "scripts/check-graybean-dead-code.mjs"]],
  ["character-identity", [npmCommand, "run", "test:character-identity"]],
  ["character-consistency", [npmCommand, "run", "test:character-consistency"]],
  ["character-style", [npmCommand, "run", "test:character-style"]],
  ["character-providers", [npmCommand, "run", "test:character-providers"]],
  ["character-provider-settings", [npmCommand, "run", "test:character-provider-settings"]],
  ["sequential-character-passes", [npmCommand, "run", "test:sequential-character-passes"]],
  ["character-identity-ui", [npmCommand, "run", "test:character-identity-ui"]],
  ["character-consistency-ui", [npmCommand, "run", "test:character-consistency-ui"]],
  ["character-generation-evidence", [npmCommand, "run", "test:character-generation-evidence"]],
  ["character-evidence-attestation", [npmCommand, "run", "test:character-evidence-attestation"]],
  ["character-reference-snapshot", [npmCommand, "run", "test:character-reference-snapshot"]],
  ["workflow-presets", [npmCommand, "run", "test:workflow-presets"]],
  ["workflow-registry", [node, "scripts/check-workflow-registry.mjs"]],
  ["storyboard-generation-flow", [node, "scripts/check-storyboard-generation-flow.mjs"]],
  ["storyboard-generation-state", [node, "scripts/check-storyboard-generation-state.mjs"]],
  ["storyboard-workflow-persistence", [node, "scripts/check-storyboard-workflow-persistence.mjs"]],
  ["storyboard-klein-reference", [node, "scripts/check-storyboard-klein-reference-preset.mjs"]],
  ["h3-presets", [node, "scripts/check-minimax-h3-presets.mjs"]],
  ["h3-profile-registry", [node, "scripts/check-minimax-h3-profile-registry.mjs"]],
  ["h3-binding", [node, "scripts/check-minimax-h3-binding.mjs"]],
  ["audio-round-trip", [node, "scripts/check-audio-round-trip.mjs"]],
  ["timeline-export-round-trip", [node, "scripts/check-timeline-export-round-trip.mjs"]],
  ["video-production-schema", [npmCommand, "run", "test:video-production-schema"]],
  ["video-workflow-router", [npmCommand, "run", "test:video-workflow-router"]],
  ["video-transition-graph", [node, "scripts/check-video-transition-graph.mjs"]],
  ["video-normalization", [npmCommand, "run", "test:video-normalization"]],
  ["video-continuity-planner", [npmCommand, "run", "test:video-continuity-planner"]],
  ["video-quality-gate", [npmCommand, "run", "test:video-quality-gate"]],
  ["smooth-video-concat-runtime", [node, "scripts/check-smooth-video-concat-runtime.mjs"]],
  ["build", [npmCommand, "run", "build"]]
];

function printableCommand(args) {
  return args.map((arg) => /\s/.test(arg) ? JSON.stringify(arg) : arg).join(" ");
}

function spawnCommand(args) {
  if (process.platform === "win32" && args[0].toLowerCase() === "npm.cmd") {
    const shell = process.env.ComSpec || "cmd.exe";
    return spawnSync(shell, ["/d", "/s", "/c", printableCommand(args)], {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, CI: process.env.CI ?? "1" }
    });
  }
  return spawnSync(args[0], args.slice(1), {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, CI: process.env.CI ?? "1" }
  });
}

function summarizeOutput(output) {
  const lines = String(output ?? "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length <= 8) return lines.join("\\n");
  return `${lines.slice(0, 4).join("\\n")}\\n... (${lines.length - 8} lines omitted) ...\\n${lines.slice(-4).join("\\n")}`;
}

const results = [];
for (const [name, args] of checks) {
  const command = printableCommand(args);
  const scriptPath = args.find((arg) => /^scripts[\\/].+\.mjs$/.test(arg));
  if (scriptPath && !existsSync(path.resolve(repoRoot, scriptPath))) {
    results.push({ name, command, status: "BLOCKED", exitCode: null, outputSummary: `missing required check: ${scriptPath}` });
    continue;
  }

  const child = spawnCommand(args);
  const output = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  const status = child.error ? "BLOCKED" : child.status === 0 ? "PASS" : "FAIL";
  results.push({
    name,
    command,
    status,
    exitCode: child.error ? null : child.status,
    outputSummary: summarizeOutput(child.error ? `${child.error.code ?? "spawn_error"}: ${child.error.message}` : output)
  });
}

const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  cwd: repoRoot,
  results,
  counts: results.reduce((counts, result) => {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
    return counts;
  }, {}),
  releaseReady: results.every((result) => result.status === "PASS")
};

console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.releaseReady ? 0 : 1;
