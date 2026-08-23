import assert from "node:assert/strict";
import fs from "node:fs/promises";

const panelSource = await fs.readFile("src/modules/comfy-pipeline/ComfyPipelinePanel.tsx", "utf8");
const serviceSource = await fs.readFile("src/modules/comfy-pipeline/comfyService.ts", "utf8");
const workflow = JSON.parse(
  await fs.readFile(
    "src/modules/comfy-pipeline/presets/storyboard-image-flux2-klein-multiref.json",
    "utf8"
  )
);
const workflowRaw = JSON.stringify(workflow);

assert.match(
  panelSource,
  /import STORYBOARD_KLEIN_REFERENCE_WORKFLOW_OBJECT from "\.\/presets\/storyboard-image-flux2-klein-multiref\.json";/,
  "the production panel must import the Klein identity workflow"
);
assert.match(
  panelSource,
  /forceRegenerateAll[\s\S]*?shouldForceKleinIdentityWorkflow[\s\S]*?STORYBOARD_KLEIN_REFERENCE_WORKFLOW_JSON/,
  "regenerate-all must force the Klein identity workflow when character references are bound"
);
assert.match(
  panelSource,
  /forceRegenerateAll[\s\S]*?regenerationSeedOffset[\s\S]*?onGenerateSingle\([\s\S]*?regenerationSeedOffset/,
  "regenerate-all must vary the seed so a deterministic duplicate-person failure can be escaped"
);
assert.match(
  serviceSource,
  /validateKleinThreeViewBindings\([\s\S]*?FRONT_PATH[\s\S]*?SIDE_PATH[\s\S]*?BACK_PATH/,
  "Klein generation must validate complete three-view bindings without rendering the board as extra people"
);
assert.doesNotMatch(workflowRaw, /IDENTITY_BOARD_PATH/, "workflow must not inject three-view boards into the final composition");
assert.match(workflowRaw, /exactly one instance of each scripted character/i, "workflow must prohibit character duplication");
assert.equal(
  Object.values(workflow).filter((node) => node.class_type === "LoadImage").length,
  2,
  "workflow must load one canonical anchor per scripted character"
);

console.log("Regenerate-all Klein three-view identity contract: PASS");
