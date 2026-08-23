import assert from "node:assert/strict";
import fs from "node:fs/promises";

const source = await fs.readFile("src/modules/comfy-pipeline/ComfyPipelinePanel.tsx", "utf8");

assert.doesNotMatch(source, /void parsedStoryboardMode;/, "saved storyboard mode must not be discarded on reload");
assert.match(
  source,
  /const resolvedStoryboardMode:\s*StoryboardImageWorkflowMode\s*=\s*parsedStoryboardMode;/,
  "reload must restore the saved storyboard workflow mode"
);
assert.match(
  source,
  /const resolvedImageWorkflowJson\s*=\s*typeof parsed\.imageWorkflowJson === "string"[\s\S]*?parsed\.imageWorkflowJson\.trim\(\)\.length > 0[\s\S]*?parsed\.imageWorkflowJson[\s\S]*?: STORYBOARD_IMAGE_WORKFLOW_JSON;/,
  "reload must restore a non-empty saved storyboard workflow"
);

console.log("Storyboard workflow persistence contract: PASS");
