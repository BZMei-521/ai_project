import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const app = await readFile("src/app/App.tsx", "utf8");
const pipeline = await readFile("src/modules/comfy-pipeline/ComfyPipelinePanel.tsx", "utf8");
const service = await readFile("src/modules/comfy-pipeline/comfyService.ts", "utf8");
assert.match(app, /LazyAuxPanelContent/);
assert.ok(pipeline.split("\n").length > 10000);
assert.ok(service.split("\n").length > 20000);
console.log("baseline captured");
