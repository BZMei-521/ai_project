import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const panelPath = path.resolve(__dirname, "../src/modules/comfy-pipeline/ComfyPipelinePanel.tsx");
const source = await readFile(panelPath, "utf8");

const failures = [];

const bannedPatterns = [
  {
    label: "front semantic dark-hair gate",
    pattern: /\bexpectsDarkHair\b/
  },
  {
    label: "front semantic blue-gray outfit gate",
    pattern: /\bexpectsBlueGrayOutfit\b/
  },
  {
    label: "front semantic mismatch helper",
    pattern: /\bhasDarkHairMismatch\b/
  },
  {
    label: "hair-color mismatch issue text",
    pattern: /发色与描述不符/
  },
  {
    label: "outfit-color mismatch issue text",
    pattern: /服装主色与描述不符/
  },
  {
    label: "front context consistency analyzer",
    pattern: /\banalyzeFrontContextConsistency\b/
  }
];

for (const entry of bannedPatterns) {
  if (entry.pattern.test(source)) {
    failures.push(`Found banned prompt-specific stability rule: ${entry.label}`);
  }
}

const minimumRetryBudgets = {
  CHARACTER_ANCHOR_MAX_ATTEMPTS_PER_MODEL: 3,
  CHARACTER_REFERENCE_MAX_ATTEMPTS: 3,
  CHARACTER_THREEVIEW_MAX_RETRIES: 4,
  CHARACTER_FALLBACK_VIEW_MAX_ATTEMPTS: 3,
  CHARACTER_FALLBACK_ROUND_MAX_ATTEMPTS: 3
};

for (const [name, minimum] of Object.entries(minimumRetryBudgets)) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)\\s*;`));
  if (!match) {
    failures.push(`Could not find retry budget constant: ${name}`);
    continue;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < minimum) {
    failures.push(`Retry budget ${name}=${match[1]} is below stable-priority minimum ${minimum}`);
  }
}

if (!source.includes("仅兜底，稳定性低于已有 front 或分镜回收")) {
  failures.push("Missing log copy that labels pure-text front rebuild as fallback-only.");
}

if (!source.includes("纯提示词 front 只作为兜底，无法保证任意提示词稳定出图")) {
  failures.push("Missing explicit failure message that pure-text front cannot guarantee arbitrary prompts.");
}

if (failures.length > 0) {
  console.error("[threeview-guards] FAILED");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[threeview-guards] PASS");
console.log(`- Checked file: ${panelPath}`);
console.log("- Prompt-specific front semantic quality gates are absent.");
console.log("- Stable-priority retry budgets meet minimum thresholds.");
console.log("- Pure-text front fallback is explicitly labeled as non-guaranteed.");
