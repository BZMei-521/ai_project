import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const BASE_URL = "http://127.0.0.1:8188";
const WORKFLOW_PATH = resolve("examples/character-consistency-benchmark/workflows/zimage-turbo-character-hero-api.json");
const OUTPUT_DIRECTORY = resolve("logs/shen-yan-zimage-hero-v1");
const SEEDS = Object.freeze([2026080911, 2026080912, 2026080913]);
const PROMPT = [
  "A single full-body front-view master character portrait of Shen Yan, a handsome Chinese fantasy young adult man age 24 to 28.",
  "He has a refined slim oval face, softly angular jaw, slender straight nose, natural-sized clear blue almond-shaped eyes, controlled dark eyebrows, smooth clean-shaven face, and short dark brown side-swept layered hair with detailed individual strands.",
  "He wears a teal long-sleeve tunic under a dark navy sleeveless long coat, a brown leather belt with a restrained brass buckle, fitted dark trousers, and knee-high brown leather boots; preserve this exact costume design.",
  "Premium cinematic semi-realistic Chinese 3D donghua animated-feature character, elegant adult anime facial anatomy, high-end game-cinematic rendering, soft luminous skin with subtle subsurface scattering, physically readable woven cloth and leather, delicate material highlights, soft warm key light, controlled rim light, shallow depth of field, dark warm fantasy village background bokeh.",
  "Neutral calm expression, relaxed symmetrical standing pose, complete body visible from hair to boot soles, centered portrait composition, one character only.",
  "Human anatomy only, ordinary human ears, no animal ears, no tail, no horns, no muzzle.",
  "Not live-action photography, not rugged realism, not Pixar, not Disney, not western family animation, not chibi, not toy-like, not plastic doll, not juvenile, not a child, no beard, no moustache, no stubble, no text, no frame, no collage, no character sheet."
].join(" ");

function replaceTokens(value, tokens) {
  if (Array.isArray(value)) return value.map((item) => replaceTokens(item, tokens));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTokens(item, tokens)]));
  if (typeof value !== "string") return value;
  const exact = value.match(/^\{\{([A-Z0-9_]+)\}\}$/);
  if (exact) return tokens[exact[1]];
  return value.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, token) => String(tokens[token]));
}

async function queueAndFetch(workflow, seed) {
  const queued = await fetch(`${BASE_URL}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: `shen-yan-zimage-${seed}` })
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
      if (entry.status?.status_str === "error" || entry.status?.completed === false) throw new Error(`ComfyUI execution failed for seed ${seed}.`);
      const image = entry.outputs?.["10"]?.images?.[0];
      if (!image?.filename) throw new Error(`ComfyUI output missing for seed ${seed}.`);
      const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder ?? "", type: image.type ?? "output" });
      const artifact = await fetch(`${BASE_URL}/view?${query}`);
      if (!artifact.ok) throw new Error(`Artifact download failed: HTTP ${artifact.status}`);
      return Buffer.from(await artifact.arrayBuffer());
    }
    await new Promise((done) => setTimeout(done, 2000));
  }
  throw new Error(`Timed out waiting for seed ${seed}.`);
}

const template = JSON.parse(await readFile(WORKFLOW_PATH, "utf8"));
await mkdir(OUTPUT_DIRECTORY, { recursive: false });
const candidates = [];
for (const seed of SEEDS) {
  const workflow = replaceTokens(template, { PROMPT, SEED: seed });
  const bytes = await queueAndFetch(workflow, seed);
  const name = `hero-${seed}.png`;
  await writeFile(resolve(OUTPUT_DIRECTORY, name), bytes, { flag: "wx" });
  candidates.push({ seed, outputPath: name, sha256: createHash("sha256").update(bytes).digest("hex") });
}
await writeFile(resolve(OUTPUT_DIRECTORY, "hero-manifest.json"), `${JSON.stringify({
  schemaVersion: 1,
  status: "awaiting_operator_approval",
  provider: "z_image_turbo",
  modelName: "z_image_turbo_bf16.safetensors",
  characterAssetId: "asset_1774017261433_390",
  species: "human",
  prompt: PROMPT,
  candidates
}, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ status: "awaiting_operator_approval", candidates }, null, 2));
