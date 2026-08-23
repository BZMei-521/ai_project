import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dataRoot = await mkdtemp(path.join(tmpdir(), "runninghub-web-bridge-"));
process.env.STORYBOARD_WEB_DATA_DIR = dataRoot;
const bridge = await import(`${pathToFileURL(path.resolve("scripts/windows-web-server.mjs")).href}?${Date.now()}`);
const projectRoot = path.join(dataRoot, "workspace", "web.sbproj");
const projectAssetsDir = path.join(projectRoot, "assets");
await mkdir(projectAssetsDir, { recursive: true });
await writeFile(path.join(dataRoot, "current-project.txt"), `${projectRoot}\n`);
const otherProjectRoot = path.join(dataRoot, "workspace", "other.sbproj");
const otherProjectAssetsDir = path.join(otherProjectRoot, "assets");
await mkdir(otherProjectAssetsDir, { recursive: true });
const approval = {
  shotId: "shot_web_01",
  workflowId: "2090035427871903746",
  workflowUrl: "https://www.runninghub.cn/workflow/2090035427871903746?source=workspace",
  references: ["C:/project/lin-yue.png", "C:/project/lan.png"],
  prompt: "full prompt",
  width: 1344,
  height: 768,
  durationSeconds: 8,
  inputDigest: "a".repeat(64)
};
const opened = [];
const receipt = await bridge.prepareRunningHubHandoffWeb({ projectAssetsDir, approval }, async (url) => { opened.push(url); });
assert.equal(receipt.status, "prepared");
assert.deepEqual(opened, [approval.workflowUrl]);
assert.deepEqual(JSON.parse(await readFile(receipt.packetPath, "utf8")), {
  schemaVersion: 1,
  provider: "runninghub_manual_custom_workflow",
  workflowId: approval.workflowId,
  workflowUrl: approval.workflowUrl,
  inputDigest: approval.inputDigest,
  references: approval.references,
  prompt: approval.prompt,
  width: 1344,
  height: 768,
  durationSeconds: 8
});
await writeFile(receipt.packetPath, "tampered");
await assert.rejects(() => bridge.prepareRunningHubHandoffWeb({ projectAssetsDir, approval }, async () => {}), /runninghub_handoff_packet_mismatch/);
await assert.rejects(() => bridge.prepareRunningHubHandoffWeb({ projectAssetsDir: otherProjectAssetsDir, approval }, async () => {}), /runninghub_assets_root_outside_current_project/);
await assert.rejects(() => bridge.prepareRunningHubHandoffWeb({ projectAssetsDir: path.join(projectRoot, ".."), approval }, async () => {}), /runninghub_assets_root_outside_project/);
await assert.rejects(() => bridge.prepareRunningHubHandoffWeb({ projectAssetsDir, approval: { ...approval, shotId: "../escape" } }, async () => {}), /runninghub_handoff_input_invalid/);
await rm(dataRoot, { recursive: true, force: true });
console.log("PASS Windows Web Bridge RunningHub handoff contracts");
