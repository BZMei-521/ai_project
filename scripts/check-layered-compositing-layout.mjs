import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  assertLayout,
  assertNoBodyOverlap,
  createRiverLayout,
  splitPose,
} from "./lib/layered-compositing-layout.mjs";

const PRESET = path.resolve("src/modules/comfy-pipeline/presets/layered-pose-sdpose-v1.json");
const SOURCE_SHA256 = "58b8909ca4dc0d94a53e7bda09e46d134fc2f5b9246f04679aac4d585df7a620";

// Literal body-keypoint payload from the installed SavePoseKpsAsJsonFile schema for
// the exact authoritative mother frame. Its required outer frame array is intentional.
const SOURCE_SDPOSE_JSON = `[
  {"people":[
    {"pose_keypoints_2d":[495.7309789260229,117.66274488220614,1,462.12112969905144,175.15327645465732,1,416.12870444109046,175.15327645465732,1,395.7859009616077,256.5244903725883,1,395.7859009616077,331.7044162750244,1,508.1135549570124,175.15327645465732,1,524.0340098539989,251.21767207359278,1,539.9544647509854,319.3218402440349,1,440.0093867865702,321.97524939353264,1,425.85787132258224,448.4544188529253,1,415.24423472459114,551.0529059668381,1,499.26885779201984,321.0907796770334,1,501.9222669415176,443.1476005539298,1,505.46014580751466,546.630557384342,1,486.0018120445311,107.04910828421515,1,496.6154486425221,107.04910828421515,1,453.2764325340588,111.47145686671138,1,489.5396909105282,110.58698715021211,1]},
    {"pose_keypoints_2d":[690.4288188939294,151.3356521253785,1,715.4702842185895,207.07310720284772,1,681.5431376496952,207.07310720284772,1,674.2730348135035,275.73518954465794,1,658.1172507330775,336.31937984625506,1,749.3974307874838,207.07310720284772,1,767.1687932759523,278.96634636074305,1,768.784371683995,343.5894826824467,1,687.1976620778441,341.16611507038283,1,696.0833433220785,449.4098684092363,1,709.8157597904403,555.2302541360259,1,732.4338575030367,342.78169347842527,1,734.0494359110793,447.79429000119364,1,734.8572251151005,555.2302541360259,1,686.3898728738228,142.44997088114417,1,703.3534461582701,141.64218167712295,1,683.9665052617589,147.29670610527194,1,733.241646707058,148.9122845133146,1]}
  ],"canvas_height":640,"canvas_width":1152}
]`;

const CANONICAL_LAYOUT = {
  canvas: { width: 1152, height: 640 },
  people: {
    shen_yan: {
      id: "shen_yan", name: "沈砚", species: "human", screenSide: "left",
      head: { x: 495.7309789260229, y: 117.66274488220614 },
      neck: { x: 462.12112969905144, y: 175.15327645465732 },
      feet: { left: { x: 505.46014580751466, y: 546.630557384342 }, right: { x: 415.24423472459114, y: 551.0529059668381 } },
      pixelHeight: 431.179, gazeTarget: { x: 690.4288188939294, y: 151.3356521253785 },
      allowedBounds: { x: 387, y: 99, width: 161, height: 465 },
    },
    jiang_lan: {
      id: "jiang_lan", name: "江岚", species: "human", screenSide: "right",
      head: { x: 690.4288188939294, y: 151.3356521253785 },
      neck: { x: 715.4702842185895, y: 207.07310720284772 },
      feet: { left: { x: 734.8572251151005, y: 555.2302541360259 }, right: { x: 709.8157597904403, y: 555.2302541360259 } },
      pixelHeight: 403.8946020106472, gazeTarget: { x: 495.7309789260229, y: 117.66274488220614 },
      allowedBounds: { x: 650, y: 130, width: 128, height: 434 },
    },
  },
  tolerances: { heightTolerancePx: 12, footTolerancePx: 8, maxSoftOverlapRatio: 0.005 },
};

const layout = createRiverLayout();
assert.deepEqual(layout, CANONICAL_LAYOUT, "layout must freeze the derived source-pixel contract");
assert.doesNotThrow(() => assertLayout(layout));
const reorderedLayout = {
  tolerances: { maxSoftOverlapRatio: 0.005, footTolerancePx: 8, heightTolerancePx: 12 },
  people: {
    jiang_lan: { allowedBounds: { height: 434, width: 128, y: 130, x: 650 }, gazeTarget: { y: 117.66274488220614, x: 495.7309789260229 }, pixelHeight: 403.8946020106472, feet: { right: { y: 555.2302541360259, x: 709.8157597904403 }, left: { y: 555.2302541360259, x: 734.8572251151005 } }, neck: { y: 207.07310720284772, x: 715.4702842185895 }, head: { y: 151.3356521253785, x: 690.4288188939294 }, screenSide: "right", species: "human", name: "江岚", id: "jiang_lan" },
    shen_yan: { allowedBounds: { height: 465, width: 161, y: 99, x: 387 }, gazeTarget: { y: 151.3356521253785, x: 690.4288188939294 }, pixelHeight: 431.179, feet: { right: { y: 551.0529059668381, x: 415.24423472459114 }, left: { y: 546.630557384342, x: 505.46014580751466 } }, neck: { y: 175.15327645465732, x: 462.12112969905144 }, head: { y: 117.66274488220614, x: 495.7309789260229 }, screenSide: "left", species: "human", name: "沈砚", id: "shen_yan" },
  },
  canvas: { height: 640, width: 1152 },
};
assert.doesNotThrow(() => assertLayout(reorderedLayout), "canonical equality must ignore property ordering");

function mutate(pathParts, value) {
  const changed = structuredClone(layout);
  let target = changed;
  for (const part of pathParts.slice(0, -1)) target = target[part];
  target[pathParts.at(-1)] = value;
  return changed;
}

for (const [parts, value] of [
  [["canvas", "width"], 1], [["canvas", "height"], 1],
  [["tolerances", "heightTolerancePx"], 1], [["tolerances", "footTolerancePx"], 1], [["tolerances", "maxSoftOverlapRatio"], 0.004],
  [["people", "shen_yan", "id"], "jiang_lan"], [["people", "shen_yan", "name"], "other"], [["people", "shen_yan", "species"], "fox"], [["people", "shen_yan", "screenSide"], "right"],
  [["people", "shen_yan", "head", "x"], 1], [["people", "shen_yan", "head", "y"], 1], [["people", "shen_yan", "neck", "x"], 1], [["people", "shen_yan", "neck", "y"], 1],
  [["people", "shen_yan", "feet", "left", "x"], 1], [["people", "shen_yan", "feet", "left", "y"], 1], [["people", "shen_yan", "feet", "right", "x"], 1], [["people", "shen_yan", "feet", "right", "y"], 1],
  [["people", "shen_yan", "pixelHeight"], 1], [["people", "shen_yan", "gazeTarget", "x"], 1], [["people", "shen_yan", "gazeTarget", "y"], 1],
  [["people", "shen_yan", "allowedBounds", "x"], 1], [["people", "shen_yan", "allowedBounds", "y"], 1], [["people", "shen_yan", "allowedBounds", "width"], 1], [["people", "shen_yan", "allowedBounds", "height"], 1],
  [["people", "jiang_lan", "id"], "shen_yan"], [["people", "jiang_lan", "name"], "other"], [["people", "jiang_lan", "species"], "fox"], [["people", "jiang_lan", "screenSide"], "left"],
  [["people", "jiang_lan", "head", "x"], 1], [["people", "jiang_lan", "head", "y"], 1], [["people", "jiang_lan", "neck", "x"], 1], [["people", "jiang_lan", "neck", "y"], 1],
  [["people", "jiang_lan", "feet", "left", "x"], 1], [["people", "jiang_lan", "feet", "left", "y"], 1], [["people", "jiang_lan", "feet", "right", "x"], 1], [["people", "jiang_lan", "feet", "right", "y"], 1],
  [["people", "jiang_lan", "pixelHeight"], 1], [["people", "jiang_lan", "gazeTarget", "x"], 1], [["people", "jiang_lan", "gazeTarget", "y"], 1],
  [["people", "jiang_lan", "allowedBounds", "x"], 1], [["people", "jiang_lan", "allowedBounds", "y"], 1], [["people", "jiang_lan", "allowedBounds", "width"], 1], [["people", "jiang_lan", "allowedBounds", "height"], 1],
]) assert.throws(() => assertLayout(mutate(parts, value)), /canonical|immutable/i, parts.join("."));

const sourceFrames = JSON.parse(SOURCE_SDPOSE_JSON);
const split = splitPose(SOURCE_SDPOSE_JSON, layout);
assert.deepEqual(split.shen_yan, sourceFrames[0].people[0]);
assert.deepEqual(split.jiang_lan, sourceFrames[0].people[1]);
assert.notStrictEqual(split.shen_yan, sourceFrames[0].people[0], "single-person payload is cloned");
assert.deepEqual(splitPose(sourceFrames, layout), split, "parsed SavePoseKpsAsJsonFile frame-array value is also accepted");
assert.throws(() => splitPose([], layout), /one frame/i);
assert.throws(() => splitPose(JSON.stringify([]), layout), /one frame/i);
assert.throws(() => splitPose([sourceFrames[0], sourceFrames[0]], layout), /one frame/i);
assert.throws(() => splitPose(sourceFrames[0], layout), /outer frame array/i);
assert.throws(() => splitPose([{ ...sourceFrames[0], people: [sourceFrames[0].people[0]] }], layout), /exactly two/i);
const equalNeck = structuredClone(sourceFrames); equalNeck[0].people[1].pose_keypoints_2d[3] = equalNeck[0].people[0].pose_keypoints_2d[3];
assert.throws(() => splitPose(equalNeck, layout), /ambiguous/i);
const nonfinite = structuredClone(sourceFrames); nonfinite[0].people[0].pose_keypoints_2d[0] = Infinity;
assert.throws(() => splitPose(nonfinite, layout), /invalid point/i);
const missing = structuredClone(sourceFrames); missing[0].people[0].pose_keypoints_2d[2] = 0;
assert.throws(() => splitPose(missing, layout), /missing nose/i);
const swappedId = structuredClone(layout); [swappedId.people.shen_yan.id, swappedId.people.jiang_lan.id] = [swappedId.people.jiang_lan.id, swappedId.people.shen_yan.id];
assert.throws(() => assertLayout(swappedId), /canonical|immutable/i);
const heightAtLimit = structuredClone(sourceFrames); heightAtLimit[0].people[0].pose_keypoints_2d[1] -= 12;
assert.doesNotThrow(() => splitPose(heightAtLimit, layout));
const heightPastLimit = structuredClone(sourceFrames); heightPastLimit[0].people[0].pose_keypoints_2d[1] -= 12.001;
assert.throws(() => splitPose(heightPastLimit, layout), /height/i);
const feetAtLimit = structuredClone(sourceFrames); feetAtLimit[0].people[0].pose_keypoints_2d[30] += 8; feetAtLimit[0].people[0].pose_keypoints_2d[39] += 8;
assert.doesNotThrow(() => splitPose(feetAtLimit, layout));
const feetPastLimit = structuredClone(sourceFrames); feetPastLimit[0].people[0].pose_keypoints_2d[30] += 8.001;
assert.throws(() => splitPose(feetPastLimit, layout), /feet/i);

const a = Buffer.alloc(1000); const b = Buffer.alloc(1000);
for (let i = 0; i < 200; i += 1) { a[i] = 255; b[i + 199] = 255; }
a[199] = 1; b[199] = 1;
assert.doesNotThrow(() => assertNoBodyOverlap(a, b, { width: 100, height: 10 }));
const tooMuchSoft = Buffer.from(b); tooMuchSoft[198] = 1;
assert.throws(() => assertNoBodyOverlap(a, tooMuchSoft, { width: 100, height: 10 }), /overlap/i);
const hard = Buffer.from(b); a[199] = 255; hard[199] = 255;
assert.throws(() => assertNoBodyOverlap(a, hard, { width: 100, height: 10 }), /torso\/leg/i);
assert.throws(() => assertNoBodyOverlap(Buffer.alloc(1000), b, { width: 100, height: 10 }), /empty/i);
assert.throws(() => assertNoBodyOverlap(a, Buffer.alloc(999), { width: 100, height: 10 }), /length/i);

const preset = JSON.parse(readFileSync(PRESET, "utf8"));
const objectInfo = {
  LoadImage: { input: { required: { image: ["STRING"] } }, output: ["IMAGE", "MASK"] },
  DWPreprocessor: { input: { required: { image: ["IMAGE"] }, optional: { detect_hand: [["enable", "disable"]], detect_body: [["enable", "disable"]], detect_face: [["enable", "disable"]], resolution: ["INT"], bbox_detector: [["None", "yolox_l.onnx"]], pose_estimator: [["dw-ll_ucoco_384.onnx"]], scale_stick_for_xinsr_cn: [["disable", "enable"]] } }, output: ["IMAGE", "POSE_KEYPOINT"] },
  PreviewImage: { input: { required: { images: ["IMAGE"] } }, output: ["IMAGE"] },
  SavePoseKpsAsJsonFile: { input: { required: { pose_kps: ["POSE_KEYPOINT"], filename_prefix: ["STRING"] } }, output: [] },
};
function expectedType(node, inputName) { return node.input.required?.[inputName]?.[0] ?? node.input.optional?.[inputName]?.[0]; }
function enumValues(spec) { return Array.isArray(spec?.[0]) ? spec[0] : null; }
function isLink(value) { return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && Number.isInteger(value[1]); }
function literalMatches(type, value) {
  if (type === "INT") return Number.isInteger(value);
  if (type === "FLOAT") return typeof value === "number" && Number.isFinite(value);
  if (type === "BOOLEAN") return typeof value === "boolean";
  if (type === "STRING") return typeof value === "string";
  return false;
}
function validatePresetGraph(graph, pinnedObjectInfo) {
  for (const [nodeId, node] of Object.entries(graph)) {
    const definition = pinnedObjectInfo[node.class_type];
    if (!definition) throw new Error(`unknown node class ${node.class_type}`);
    for (const [inputName, value] of Object.entries(node.inputs ?? {})) {
      const spec = definition.input.required?.[inputName] ?? definition.input.optional?.[inputName];
      if (!spec) throw new Error(`${nodeId}.${inputName} is not a known input`);
      const wanted = expectedType(definition, inputName);
      if (isLink(value)) {
        const source = graph[value[0]];
        if (!source) throw new Error(`${nodeId}.${inputName} source id does not resolve`);
        const sourceDefinition = pinnedObjectInfo[source.class_type];
        const outputType = sourceDefinition?.output[value[1]];
        if (!outputType) throw new Error(`${nodeId}.${inputName} output index does not resolve`);
        if (outputType !== wanted) throw new Error(`${nodeId}.${inputName} link type is incompatible`);
      } else {
        const choices = enumValues(spec);
        if (choices && !choices.includes(value)) throw new Error(`${nodeId}.${inputName} literal enum is invalid`);
        if (!choices && !literalMatches(wanted, value)) throw new Error(`${nodeId}.${inputName} literal type is invalid`);
      }
    }
  }
  const preview = graph["3"]?.inputs?.images;
  const json = graph["4"]?.inputs?.pose_kps;
  if (!isLink(preview) || preview[0] !== "2" || preview[1] !== 0 || !isLink(json) || json[0] !== "2" || json[1] !== 1 || !isLink(graph["2"]?.inputs?.image) || graph["2"].inputs.image[0] !== "1" || graph["2"].inputs.image[1] !== 0) {
    throw new Error("preview and JSON outputs must share the LoadImage→DWPreprocessor ancestry");
  }
}
assert.doesNotThrow(() => validatePresetGraph(preset, objectInfo));
for (const [label, mutateGraph, pattern] of [
  ["unknown input", (graph) => { graph["2"].inputs.unknown = "value"; }, /input/i],
  ["dangling source", (graph) => { graph["2"].inputs.image = ["404", 0]; }, /source/i],
  ["invalid output", (graph) => { graph["2"].inputs.image = ["1", 2]; }, /output/i],
  ["incompatible link", (graph) => { graph["4"].inputs.pose_kps = ["2", 0]; }, /type/i],
  ["literal primitive", (graph) => { graph["2"].inputs.resolution = "1152"; }, /literal/i],
  ["invalid enum", (graph) => { graph["2"].inputs.detect_hand = "maybe"; }, /enum/i],
  ["wrong preview ancestry", (graph) => { graph["3"].inputs.images = ["1", 0]; }, /ancestry/i],
  ["wrong json ancestry", (graph) => { graph["4"].inputs.pose_kps = ["2", 0]; }, /ancestry|type/i],
]) {
  const mutated = structuredClone(preset); mutateGraph(mutated);
  assert.throws(() => validatePresetGraph(mutated, objectInfo), pattern, label);
}
assert.deepEqual([...JSON.stringify(preset).matchAll(/{{[^}]+}}/g)].map((match) => match[0]).sort(), ["{{FILENAME_PREFIX}}", "{{SOURCE_IMAGE}}"]);
assert.equal(SOURCE_SHA256, "58b8909ca4dc0d94a53e7bda09e46d134fc2f5b9246f04679aac4d585df7a620");

console.log("Layered compositing layout contract: PASS");
