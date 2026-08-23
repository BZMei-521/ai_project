import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "http://127.0.0.1:8188";
const WORKFLOW_PATH = resolve("examples/character-consistency-benchmark/workflows/zimage-turbo-character-hero-api.json");
export const OUTPUT_DIRECTORY_NAME = "logs/jiang-lan-zimage-hero-v2";
const OUTPUT_DIRECTORY = resolve(OUTPUT_DIRECTORY_NAME);

export const CHARACTER_ASSET_ID = "asset_1773997039637_416";
export const SPECIES = "human";
export const SEEDS = Object.freeze([2026080931, 2026080932, 2026080933]);
export const PROMPT = [
  "A single front-view identity master portrait of Jiang Lan, an elegant adult Chinese woman age 25 to 30, framed from head to mid-thigh so her face and costume bodice are large and sharply readable.",
  "She has mature adult facial proportions, a refined slim oval face, defined cheekbones and jawline, a slender straight nose, natural-sized eyes with calm dark brown almond-shaped irises, controlled dark eyebrows, soft neutral lips, subtle realistic facial asymmetry, luminous fair skin, and long straight black hair with a clean center part, glossy finish, and detailed individual strands falling below the waist; preserve this exact face and hairstyle design.",
  "She wears a modest light gray-blue long-sleeve dress, ankle-length with a fitted waist and restrained layered fabric details, plus simple black flats; preserve this exact costume design.",
  "Premium cinematic semi-realistic Chinese 3D donghua animated-feature character, sophisticated adult heroine design, high-end Unreal-style game-cinematic rendering, realistic skin pores beneath soft luminous skin with subtle subsurface scattering, physically readable woven cloth, delicate material highlights, soft warm key light, controlled rim light, shallow depth of field, dark warm fantasy village background bokeh.",
  "Neutral calm expression, closed relaxed lips, relaxed symmetrical standing pose, arms naturally at her sides, centered portrait composition, one character only.",
  "Human anatomy only, ordinary human ears, no animal ears, no tail, no horns, no muzzle.",
  "Not live-action photography, not rugged realism, not Pixar, not Disney, not western family animation, not wide-eyed, not round baby face, not chibi, not toy-like, not plastic doll, not juvenile, not a child, no text, no frame, no collage, no character sheet."
].join(" ");

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

async function queueAndFetch(workflow, seed) {
  const queued = await fetch(`${BASE_URL}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: `jiang-lan-zimage-${seed}` })
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
        throw new Error(`ComfyUI execution failed for seed ${seed}.`);
      }
      const image = entry.outputs?.["10"]?.images?.[0];
      if (!image?.filename) throw new Error(`ComfyUI output missing for seed ${seed}.`);
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
  throw new Error(`Timed out waiting for seed ${seed}.`);
}

async function main() {
  const template = JSON.parse(await readFile(WORKFLOW_PATH, "utf8"));
  await mkdir(OUTPUT_DIRECTORY, { recursive: false });
  const candidates = [];

  for (const seed of SEEDS) {
    const workflow = replaceTokens(template, { PROMPT, SEED: seed });
    workflow["10"].inputs.filename_prefix = `character-hero/jiang-lan-v2-${seed}`;
    const bytes = await queueAndFetch(workflow, seed);
    const name = `hero-${seed}.png`;
    await writeFile(resolve(OUTPUT_DIRECTORY, name), bytes, { flag: "wx" });
    candidates.push({
      seed,
      outputPath: name,
      sha256: createHash("sha256").update(bytes).digest("hex")
    });
  }

  const manifest = {
    schemaVersion: 1,
    status: "awaiting_operator_approval",
    provider: "z_image_turbo",
    modelName: "z_image_turbo_bf16.safetensors",
    characterAssetId: CHARACTER_ASSET_ID,
    species: SPECIES,
    prompt: PROMPT,
    candidates
  };
  await writeFile(resolve(OUTPUT_DIRECTORY, "hero-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ status: manifest.status, candidates }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
