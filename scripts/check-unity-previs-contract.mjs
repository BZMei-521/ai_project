import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { validateExchange, sceneDigest, reflectPosition, reflectQuaternion, validateExport } from "./lib/unity-previs/exchange.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
function chunk(kind,data){const type=Buffer.from(kind);const body=Buffer.concat([type,data]);let crc=0xffffffff;for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,body,sum]);}
const header=Buffer.alloc(13);header.writeUInt32BE(16,0);header.writeUInt32BE(16,4);header[8]=8;header[9]=2;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(16*(1+16*3)))),chunk('IEND',Buffer.alloc(0))]);
const scene = () => ({
  schemaVersion: 1, coordinateSystem: "RH_Y_UP_METRES", id: "scene-a", label: "Scene A",
  source: { stageId: "stage-a", stageRevision: 1, stageDigest: "a".repeat(64), shotId: "shot-a", snapshotId: "snapshot-a", cameraId: "camera-a" },
  camera: { position: { x: 0, y: 1, z: 3 }, target: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 1, z: 0 }, fov: 50, near: 0.01, far: 20, width: 960, height: 540 },
  entities: [{ id: "actor", label: "Actor", role: "environment", position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 }, parts: [], joints: [{ id: "hand", parentId: "", position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, radius: 0.1, openPoseIndex: -1, hand: "none", handIndex: -1 }], bones: [], attachments: [{ id: "grip", jointId: "hand", position: { x: 0, y: 0, z: 0 } }] }],
  relations: []
});

assert.equal(validateExchange(scene()).valid, true);
const unityDefaultHand = scene();
unityDefaultHand.entities[0].joints[0].hand = "";
assert.equal(validateExchange(unityDefaultHand).valid, true, "Unity's omitted hand default is semantic none");
assert.doesNotThrow(() => validateExchange({ ...scene(), entities: [{ ...scene().entities[0], attachments: {} }], relations: [{ kind: "contact", subjectId: "actor", targetId: "actor", attachmentId: "x", targetPoint: { x: 0, y: 0, z: 0 }, tolerance: 0 }] }));
assert.deepEqual(reflectPosition(reflectPosition({ x: 1, y: 2, z: 3 })), { x: 1, y: 2, z: 3 });
assert.deepEqual(reflectQuaternion(reflectQuaternion({ x: 0.1, y: 0.2, z: 0.3, w: 0.9 })), { x: 0.1, y: 0.2, z: 0.3, w: 0.9 });
assert.notEqual(sceneDigest(scene()), sceneDigest({ ...scene(), camera: { ...scene().camera, fov: 51 } }));

for (const [name, mutate, field] of [
  ["invalid camera", (s) => { s.camera.near = 20; }, "camera.near"],
  ["NaN", (s) => { s.entities[0].position.x = Number.NaN; }, "entities[0].position.x"],
  ["dangling reference", (s) => { s.relations.push({ kind: "contact", subjectId: "actor", targetId: "missing", attachmentId: "grip", targetPoint: { x: 0, y: 0, z: 0 }, tolerance: 0.1 }); }, "relations[0].targetId"],
  ["cycles", (s) => { s.entities[0].joints.push({ ...s.entities[0].joints[0], id: "elbow", parentId: "hand" }); s.entities[0].joints[0].parentId = "elbow"; }, "entities[0].joints"],
  ["unsupported shapes", (s) => { s.entities[0].parts.push({ id: "bad", kind: "mesh", position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, size: { x: 1, y: 1, z: 1 }, color: [1, 1, 1] }); }, "entities[0].parts[0].kind"]
]) {
  const invalid = scene(); mutate(invalid);
  const result = validateExchange(invalid);
  assert.equal(result.valid, false, name);
  assert.ok(result.errors.some((error) => error.field === field), name);
}

for (const [name, mutate] of [
  ["camera target equals position", (s) => { s.camera.target = { ...s.camera.position }; }],
  ["camera up is parallel", (s) => { s.camera.up = { x: 0, y: 0, z: -3 }; }],
  ["non-unit quaternion", (s) => { s.entities[0].rotation.w = 2; }],
  ["zero scale", (s) => { s.entities[0].scale.x = 0; }],
  ["out of range coordinate", (s) => { s.entities[0].position.x = 10001; }],
  ["empty entity list", (s) => { s.entities = []; }],
  ["duplicate part id", (s) => { const part = { id: "same", kind: "box", position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, size: { x: 1, y: 1, z: 1 }, color: [1, 1, 1] }; s.entities[0].parts = [part, { ...part }]; }],
  ["unsafe identifier", (s) => { s.entities[0].id = "坏"; }]
]) {
  const invalid = scene(); mutate(invalid);
  assert.equal(validateExchange(invalid).valid, false, name);
}

const directory = await mkdtemp(join(tmpdir(), "unity-previs-contract-"));
await mkdir(directory, { recursive: true });
const expected = scene();
expected.camera.width=expected.camera.height=16;
const encodings={color:'srgb_rgb8',depth:'linear_eye_near_white_8bit',normal:'rh_view_normal_rgb8',visible_mask:'binary_visible_8bit'};
const manifest={schemaVersion:1,sceneFile:'scene.json',sceneSha256:sha(JSON.stringify(expected)),preflightFile:'preflight.json',artifacts:['','actor'].flatMap(entityId=>(entityId?['color','depth','normal','visible_mask']:['color','depth','normal']).map(kind=>({kind,entityId,filePath:`${entityId||'global'}-${kind}.png`,width:16,height:16,sha256:sha(png),encoding:encodings[kind]})))};
async function reset(){await writeFile(join(directory,'scene.json'),JSON.stringify(expected));await writeFile(join(directory,'preflight.json'),JSON.stringify({valid:true,errors:[]}));await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest));for(const a of manifest.artifacts)await writeFile(join(directory,a.filePath),png);}
await reset();assert.deepEqual(await validateExport(directory,expected),{valid:true,errors:[]},'complete 16x16 baseline is valid');
for(const [name,mutate,field,message] of [
  ['missing entity pass',async m=>{m.artifacts=m.artifacts.filter(a=>!(a.kind==='depth'&&a.entityId==='actor'));},'artifacts',/per-entity depth missing/],
  ['stale scene with correct byte hash',async m=>{const stale=structuredClone(expected);stale.camera.fov=55;const bytes=JSON.stringify(stale);await writeFile(join(directory,'scene.json'),bytes);m.sceneSha256=sha(bytes);},'scene',/stale/],
  ['unsafe artifact path',async m=>{m.artifacts[0].filePath='../escape.png';},'artifacts[0]',/invalid artifact descriptor/],
  ['unsafe scene path',async m=>{m.sceneFile='../scene.json';},'manifest.sceneFile',/relative basename/],
  ['unsafe preflight path',async m=>{m.preflightFile='../preflight.json';},'manifest.preflightFile',/relative basename/],
  ['artifact hash mismatch',async m=>{m.artifacts[0].sha256='b'.repeat(64);},'artifacts[0].sha256',/does not match/],
  ['corrupt PNG with correct byte hash',async m=>{const broken=png.subarray(0,-1);await writeFile(join(directory,m.artifacts[0].filePath),broken);m.artifacts[0].sha256=sha(broken);},'artifacts[0].filePath',/invalid PNG/],
  ...[null,{},[null]].map(entities=>['malformed exported entities',async m=>{const bad={...expected,entities};const bytes=JSON.stringify(bad);await writeFile(join(directory,'scene.json'),bytes);m.sceneSha256=sha(bytes);},'scene',/invalid/])
]){await reset();const changed=structuredClone(manifest);await mutate(changed);await writeFile(join(directory,'manifest.json'),JSON.stringify(changed));const report=await validateExport(directory,expected);assert.equal(report.valid,false,name);assert.ok(report.errors.some(e=>e.field===field&&message.test(e.message)),`${name}: ${JSON.stringify(report.errors)}`);}
for(const attachments of [null,{},[null]]){const bad=scene();bad.entities[0].attachments=attachments;bad.relations=[{kind:'contact',subjectId:'actor',targetId:'missing',attachmentId:'grip',targetPoint:{x:0,y:0,z:0},tolerance:.1}];assert.equal(validateExchange(bad).valid,false,'malformed attachments returns diagnostics');}
await reset();assert.equal((await validateExport(directory,expected)).valid,true,'fixture restores to valid baseline');

const sceneFile = join(directory, "input-scene.json");
await writeFile(sceneFile, JSON.stringify(expected));
const cli = spawnSync(process.execPath, ["scripts/unity-previs.mjs", "validate", sceneFile], { cwd: process.cwd(), encoding: "utf8" });
assert.equal(cli.status, 0, cli.stderr);
assert.match(cli.stdout, /valid/);

console.log("PASS unity previs exchange contract");
