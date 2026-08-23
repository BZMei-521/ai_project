import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("src/modules/comfy-pipeline/comfyService.ts", "utf8");
assert.match(source, /from ["']\.\.\/\.\.\/services\/generation-providers\/comfyClient["']/);
assert.match(source, /export \{ ComfyClient, normalizeComfyBaseUrl \}/);
for (const delegatedMethod of ["getObjectInfo", "queuePrompt", "getHistory", "fetchViewBase64", "writeBase64File", "copyFile"]) {
  assert.match(
    source,
    new RegExp(`createComfyClient\\([^)]*\\)[\\s\\S]{0,500}\\.${delegatedMethod}\\(`),
    `legacy service should delegate ${delegatedMethod} transport through ComfyClient`
  );
}

console.log("PASS comfy service compatibility boundary");
