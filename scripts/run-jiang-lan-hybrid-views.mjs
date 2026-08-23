import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "http://127.0.0.1:8188";
const WORKFLOW_PATH = resolve("examples/character-consistency-benchmark/workflows/flux2-klein-4b-reference-smoke-api.json");
export const OUTPUT_DIRECTORY_NAME = "logs/jiang-lan-hybrid-v1";
const OUTPUT_DIRECTORY = resolve(OUTPUT_DIRECTORY_NAME);
export const CHARACTER_ASSET_ID = "asset_1773997039637_416";
export const SPECIES = "human";
export const IDENTITY_REFERENCE_PATH = resolve("logs/jiang-lan-zimage-hero-v2/hero-2026080932.png");
export const BODY_REFERENCE_PATH = resolve("logs/jiang-lan-zimage-hero-v1/hero-2026080922.png");

const SHARED_PROMPT = [
  "Create Jiang Lan as the exact same adult human woman shown in reference image 1.",
  "Reference image 1 is the authoritative identity lock: preserve the same face, facial proportions, eyes, eyebrows, nose, lips, center-parted long straight black hair, hairline, and apparent age.",
  "Reference image 2 is only the full-body costume and proportion guide: preserve the light gray-blue long-sleeve dress with defined waist band, ankle-length skirt, and simple black flats.",
  "One adult character only, premium cinematic semi-realistic Chinese 3D donghua, clean high-end CGI materials, neutral expression, neutral standing pose, pure light-gray studio background, head to shoe soles fully visible with margin.",
  "Human anatomy only, ordinary human ears, no animal ears, no tail, no horns, no muzzle, no beast traits, no child proportions, no extra person, no duplicate body, no collage, no text."
].join(" ");

export const VIEWS = Object.freeze([
  {
    view: "front",
    seed: 2026081001,
    yaw: 0,
    prompt: `${SHARED_PROMPT} Strict front view, facing camera squarely, symmetrical shoulders and hips, both eyes visible, both arms and both shoes visible.`
  },
  {
    view: "side",
    seed: 2026081002,
    yaw: 90,
    prompt: `${SHARED_PROMPT} Strict right side profile, body and head turned exactly 90 degrees, nose points right, only one eye profile visible, arms close to torso, legs vertically aligned, no three-quarter view.`
  },
  {
    view: "back",
    seed: 2026081003,
    yaw: 180,
    prompt: `${SHARED_PROMPT} Strict back view, body and head facing directly away from camera, no visible face, no looking back, show the complete back silhouette of the same long straight black hair and the back construction of the same dress.`
  }
]);

export function replaceTokens(value, tokens) {
  if (Array.isArray(value)) return value.map((item) => replaceTokens(item, tokens));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTokens(item, tokens)]));
  }
  if (typeof value !== "string") return value;
  const exact = value.match(/^\{\{([A-Z0-9_]+)\}\}$/);
  if (exact) return tokens[exact[1]];
  return value.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, token) => String(tokens[token]));
}

async function uploadReference(path, name) {
  const form = new FormData();
  form.append("image", new Blob([await readFile(path)]), name);
  form.append("subfolder", "character-benchmark/jiang-lan-hybrid-v1");
  form.append("type", "input");
  form.append("overwrite", "true");
  const response = await fetch(`${BASE_URL}/upload/image`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`Reference upload failed: HTTP ${response.status} ${await response.text()}`);
  const uploaded = await response.json();
  if (!uploaded?.name) throw new Error("ComfyUI omitted uploaded reference name.");
  return uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;
}

async function queueAndFetch(workflow, view) {
  const queued = await fetch(`${BASE_URL}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: `jiang-lan-hybrid-${view}` })
  });
  if (!queued.ok) throw new Error(`Queue failed: HTTP ${queued.status} ${await queued.text()}`);
  const { prompt_id: promptId } = await queued.json();
  if (!promptId) throw new Error("ComfyUI omitted prompt_id.");

  for (let attempt = 0; attempt < 600; attempt += 1) {
    const response = await fetch(`${BASE_URL}/history/${encodeURIComponent(promptId)}`);
    if (!response.ok) throw new Error(`History failed: HTTP ${response.status}`);
    const history = await response.json();
    const entry = history[promptId];
    if (entry) {
      if (entry.status?.status_str === "error" || entry.status?.completed === false) {
        throw new Error(`ComfyUI execution failed for ${view}.`);
      }
      const image = entry.outputs?.["19"]?.images?.[0];
      if (!image?.filename) throw new Error(`ComfyUI output missing for ${view}.`);
      const query = new URLSearchParams({
        filename: image.filename,
        subfolder: image.subfolder ?? "",
        type: image.type ?? "output"
      });
      const artifact = await fetch(`${BASE_URL}/view?${query}`);
      if (!artifact.ok) throw new Error(`Artifact download failed: HTTP ${artifact.status}`);
      return Buffer.from(await artifact.arrayBuffer());
    }
    await new Promise((done) => setTimeout(done, 2000));
  }
  throw new Error(`Timed out waiting for ${view}.`);
}

async function main() {
  const template = JSON.parse(await readFile(WORKFLOW_PATH, "utf8"));
  const [identityReference, bodyReference] = await Promise.all([
    uploadReference(IDENTITY_REFERENCE_PATH, `identity-${basename(IDENTITY_REFERENCE_PATH)}`),
    uploadReference(BODY_REFERENCE_PATH, `body-${basename(BODY_REFERENCE_PATH)}`)
  ]);
  await mkdir(OUTPUT_DIRECTORY, { recursive: false });
  const candidates = [];

  for (const item of VIEWS) {
    const workflow = replaceTokens(template, {
      PROMPT: item.prompt,
      SEED: item.seed,
      CHARACTER_ASSET_ID,
      SHOT_TITLE: `jiang-lan-${item.view}-${item.seed}`,
      CAMERA_YAW: item.yaw,
      SHOT_SCALE: "full_body",
      EXPECTED_VIEW: item.view,
      REFERENCE_IMAGE_A: identityReference,
      REFERENCE_IMAGE_B: bodyReference
    });
    workflow["19"].inputs.filename_prefix = `character-consistency/jiang-lan-hybrid-v1-${item.view}-${item.seed}`;
    const bytes = await queueAndFetch(workflow, item.view);
    const outputPath = `${item.view}.png`;
    await writeFile(resolve(OUTPUT_DIRECTORY, outputPath), bytes, { flag: "wx" });
    candidates.push({
      view: item.view,
      seed: item.seed,
      outputPath,
      sha256: createHash("sha256").update(bytes).digest("hex")
    });
  }

  const manifest = {
    schemaVersion: 1,
    status: "quality_review_pending",
    characterAssetId: CHARACTER_ASSET_ID,
    proposedIdentityPackVersion: "jiang-lan-hybrid-v1",
    species: SPECIES,
    provider: "flux2_klein_4b",
    modelName: "flux-2-klein-4b-fp8.safetensors",
    strategy: "selected_zimage_face_plus_zimage_body_reference_and_flux2_klein_view_expansion",
    identityReference: {
      path: IDENTITY_REFERENCE_PATH,
      sha256: createHash("sha256").update(await readFile(IDENTITY_REFERENCE_PATH)).digest("hex")
    },
    bodyReference: {
      path: BODY_REFERENCE_PATH,
      sha256: createHash("sha256").update(await readFile(BODY_REFERENCE_PATH)).digest("hex")
    },
    candidates
  };
  await writeFile(resolve(OUTPUT_DIRECTORY, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ status: manifest.status, candidates }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
