import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { extractVideoOutputs } from "./lib/comfy-output-media.mjs";

const comfyUrl = process.env.COMFYUI_URL || "http://127.0.0.1:8188";
const storyboardDir = "C:/Users/Administrator/AppData/Local/Comfy-Desktop/ComfyUI-Shared/output/Storyboard";
const reportDir = resolve("logs/video-quality-six-shot");
const shotArgIndex = process.argv.indexOf("--shot");
const selectedShotId = shotArgIndex >= 0 ? process.argv[shotArgIndex + 1] : "";
const seedArgIndex = process.argv.indexOf("--seed");
const seedOverride = seedArgIndex >= 0 ? Number(process.argv[seedArgIndex + 1]) : null;
const reportPath = resolve(reportDir, selectedShotId ? `wan-${selectedShotId}-report.json` : "wan-six-shot-report.json");
const presetPath = resolve("src/modules/comfy-pipeline/presets/video-wan21-i2v-14b-fp8.json");
const frameCount = 17;

const shots = [
  {
    id: "river_continuity_001",
    title: "河边远景建立",
    image: "河边远景建立_klein_ref_00006_.png",
    prompt: "Wide establishing shot. The man in the dark navy long coat makes one small grounded step and a restrained hand gesture. The woman in the light gray-blue dress follows half a step and turns her head toward him. Subtle breathing and blinking. Locked stable camera, calm river reflections, gentle foliage movement. Keep exactly two people and preserve their faces, hair, clothes, proportions and positions."
  },
  {
    id: "river_continuity_002",
    title: "双人中景起话",
    image: "双人中景起话_klein_ref_00006_.png",
    prompt: "Medium two-shot continuing on the same axis. The woman turns slightly toward the man, lifts one hand a little and begins speaking with subtle lip motion. The man gives a small attentive nod. Very slow camera push-in. Keep exactly two people, grounded feet, unchanged faces, hairstyles and clothing."
  },
  {
    id: "river_continuity_003",
    title: "江岚近景说话",
    image: "江岚近景说话_klein_ref_00006_.png",
    prompt: "Closer two-person shot. The woman remains the visual focus, raises one hand near her chest and speaks softly; her expression shifts from calm to thoughtful. The man stays visible behind her and glances toward the bridge. Minimal stable camera motion. Keep exactly two people and preserve identity, hair length, outfit design and colors."
  },
  {
    id: "river_continuity_004",
    title: "沈砚回应点头",
    image: "沈砚回应点头_klein_ref_00005_.png",
    prompt: "Reverse medium shot without crossing the axis. The man makes a small grounded half-step, nods once and raises his right hand slightly as a warning. The woman slows and looks back with concern. Stable camera, restrained natural motion. Keep exactly two people with unchanged faces, hairstyles, clothing and body proportions."
  },
  {
    id: "river_continuity_005",
    title: "并肩沿河慢走",
    image: "并肩沿河慢走_klein_ref_00006_.png",
    prompt: "Two-person walking shot. Both characters take one slow natural grounded step with subtle weight transfer, arm swing and cloth movement. The man glances toward the river while the woman looks ahead. Gentle stabilized tracking camera. Keep exactly two people; no identity swap, face change, hairstyle change or outfit change."
  },
  {
    id: "river_continuity_006",
    title: "桥边停步收尾",
    image: "桥边停步收尾_klein_ref_00006_.png",
    prompt: "Closing two-person shot near the bridge. The woman slows to a stop, shifts her weight and leans slightly toward the water. The man plants both feet and turns his upper body to scan the surroundings. Subtle hair and fabric response, stable camera. Keep exactly two people and preserve exact identity, face, hair and clothing."
  }
];

const negativePrompt = "identity drift, face morphing, face replacement, hairstyle change, hair length change, clothing change, color change, identity swap, duplicated person, missing person, third person, extra limbs, malformed hands, warped body, floating feet, flicker, temporal jitter, scene cut, fast camera, strong zoom, camera shake";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function replaceTokens(value, tokens) {
  if (typeof value === "string") {
    let output = value;
    for (const [key, replacement] of Object.entries(tokens)) {
      output = output.split(`{{${key}}}`).join(String(replacement));
    }
    return output;
  }
  if (Array.isArray(value)) return value.map((item) => replaceTokens(item, tokens));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTokens(item, tokens)]));
  }
  return value;
}

async function uploadImage(path) {
  const bytes = readFileSync(path);
  const form = new FormData();
  form.append("image", new Blob([bytes], { type: "image/png" }), basename(path));
  form.append("type", "input");
  form.append("overwrite", "true");
  const response = await fetch(`${comfyUrl}/upload/image`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`upload failed ${response.status}: ${await response.text()}`);
  const result = await response.json();
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
}

async function queueWorkflow(workflow) {
  const response = await fetch(`${comfyUrl}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: "storyboardpro-wan-six-shot" })
  });
  if (!response.ok) throw new Error(`queue failed ${response.status}: ${await response.text()}`);
  const result = await response.json();
  if (!result.prompt_id) throw new Error(`queue returned no prompt_id: ${JSON.stringify(result)}`);
  return result.prompt_id;
}

async function waitForHistory(promptId) {
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await fetch(`${comfyUrl}/history/${promptId}`);
    if (!response.ok) throw new Error(`history failed ${response.status}: ${await response.text()}`);
    const payload = await response.json();
    if (payload[promptId]) return payload[promptId];
    await new Promise((resolveWait) => setTimeout(resolveWait, 5000));
  }
  throw new Error(`generation timed out: ${promptId}`);
}

async function main() {
  mkdirSync(reportDir, { recursive: true });
  const statsResponse = await fetch(`${comfyUrl}/system_stats`);
  if (!statsResponse.ok) throw new Error(`ComfyUI unavailable: ${statsResponse.status}`);
  const stats = await statsResponse.json();
  const preset = JSON.parse(readFileSync(presetPath, "utf8"));
  const selectedShots = selectedShotId ? shots.filter((shot) => shot.id === selectedShotId) : shots;
  if (selectedShots.length === 0) throw new Error(`unknown --shot id: ${selectedShotId}`);
  if (seedOverride !== null && !Number.isSafeInteger(seedOverride)) throw new Error("--seed must be a safe integer");
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    comfyUrl,
    frameCount,
    model: "Wan2_1-I2V-ATI-14B_fp8_e4m3fn.safetensors",
    selectedShotId: selectedShotId || null,
    seedOverride,
    system: stats,
    shots: []
  };

  for (const shot of selectedShots) {
    const startedAt = Date.now();
    const imagePath = `${storyboardDir}/${shot.image}`;
    const imageBytes = readFileSync(imagePath);
    const uploadedName = await uploadImage(imagePath);
    const workflow = replaceTokens(preset, {
      FRAME_IMAGE_PATH: uploadedName,
      VIDEO_PROMPT: shot.prompt,
      NEGATIVE_PROMPT: negativePrompt,
      WAN_FRAME_COUNT: frameCount,
      SEED: seedOverride ?? 26081010 + Number(shot.id.slice(-3)),
      SHOT_TITLE: `${shot.id}_${shot.title}`
    });
    const promptId = await queueWorkflow(workflow);
    console.log(`[${shot.id}] queued ${promptId}`);
    const history = await waitForHistory(promptId);
    const status = history.status || {};
    const videos = extractVideoOutputs(history);
    const item = {
      id: shot.id,
      title: shot.title,
      sourceImage: imagePath,
      sourceSha256: sha256(imageBytes),
      promptId,
      frameCount,
      seed: seedOverride ?? 26081010 + Number(shot.id.slice(-3)),
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      completed: Boolean(status.completed),
      statusText: status.status_str || "unknown",
      messages: status.messages || [],
      videos
    };
    report.shots.push(item);
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (!item.completed || videos.length === 0) {
      throw new Error(`${shot.id} failed: ${JSON.stringify(item.messages)}`);
    }
    console.log(`[${shot.id}] complete in ${item.elapsedSeconds}s -> ${videos.map((video) => video.filename).join(", ")}`);
  }

  report.completedAt = new Date().toISOString();
  report.completedShots = report.shots.filter((shot) => shot.completed && shot.videos.length > 0).length;
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Wan benchmark complete: ${report.completedShots}/${selectedShots.length}`);
  console.log(reportPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
