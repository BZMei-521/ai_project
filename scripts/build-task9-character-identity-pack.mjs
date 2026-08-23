import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(process.cwd());
const outRoot = resolve(root, ".superpowers/sdd/task9-character-identity-pack");
const sourceRoot = resolve(root, "短剧示例-从一根木矛开始的文明/角色设定/images");

const crops = [
  { character: "lan", source: "岚-sheet.png", slot: "face_master", crop: "588:941:0:0" },
  { character: "lan", source: "岚-sheet.png", slot: "body_front", crop: "360:665:588:0" },
  { character: "lan", source: "岚-sheet.png", slot: "body_side", crop: "360:665:948:0" },
  { character: "lan", source: "岚-sheet.png", slot: "details", crop: "1084:276:588:665" },
  { character: "linyue", source: "林越-sheet.png", slot: "face_master", crop: "608:941:0:0" },
  { character: "linyue", source: "林越-sheet.png", slot: "body_front", crop: "360:685:608:0" },
  { character: "linyue", source: "林越-sheet.png", slot: "body_side", crop: "360:685:968:0" },
  { character: "linyue", source: "林越-sheet.png", slot: "details", crop: "1064:256:608:685" }
];

await mkdir(outRoot, { recursive: true });
const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg";
for (const item of crops) {
  const input = resolve(sourceRoot, item.source);
  const output = resolve(outRoot, `${item.character}-${item.slot}.png`);
  await stat(input);
  await mkdir(dirname(output), { recursive: true });
  await run(ffmpeg, ["-y", "-i", input, "-vf", `crop=${item.crop},scale=768:-2:flags=lanczos`, output], { windowsHide: true });
}

console.log(JSON.stringify({ outputRoot: outRoot, files: crops.map((item) => `${item.character}-${item.slot}.png`) }, null, 2));
