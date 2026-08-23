# Jiang Lan Cinematic 3D Anchor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Generate three reproducible, visually reviewed Z-Image Turbo front-anchor candidates for Jiang Lan without changing the current StoryboardPro character asset before operator selection.

**Architecture:** Add a Jiang-Lan-specific local ComfyUI runner that reuses the proven Z-Image Turbo API workflow, substitutes a locked human-character prompt and three fixed seeds, and records immutable output metadata in a manifest. Validate the manifest and images locally, then stop for operator selection; project mutation and side/back expansion are deliberately out of scope for this pass.

**Tech Stack:** Node.js ESM, ComfyUI HTTP API, Z-Image Turbo BF16, Qwen 3 4B text encoder, JSON manifests, SHA-256.

## Global Constraints

- Jiang Lan is human: no animal ears, tail, horns, muzzle, or other beastfolk traits.
- Match Shen Yan's premium cinematic semi-realistic Chinese 3D donghua rendering language.
- Do not use storyboard crops or screenshots as the canonical anchor.
- Do not update StoryboardPro's current-project data until the user selects one candidate.
- Treat missing outputs, API errors, malformed manifests, or failed visual checks as hard failures.

### Task 1: Add the reproducible Jiang Lan generator

**Files:**
- Create: `scripts/run-jiang-lan-zimage-hero.mjs`
- Reuse: `examples/character-consistency-benchmark/workflows/zimage-turbo-character-hero-api.json`

**Step 1:** Adapt the validated Shen Yan runner into a Jiang Lan-specific entry point.

Use asset id `asset_1773997039637_416`, seeds `2026080921`, `2026080922`, and `2026080923`, output directory `logs/jiang-lan-zimage-hero-v1`, and a locked prompt describing an adult Chinese woman with long straight black hair, a light gray-blue long-sleeve dress, black flats, neutral front pose, and human anatomy only.

**Step 2:** Ensure the ComfyUI client id and SaveImage prefix identify Jiang Lan, while preserving the proven 768×1152, 8-step, CFG 1, `res_multistep`/`simple` settings.

**Step 3:** Emit `hero-manifest.json` with provider, model, character asset id, species, full prompt, seed, relative output path, and SHA-256 for each candidate. Use exclusive file creation so reruns cannot silently overwrite evidence.

### Task 2: Generate the three candidates

**Files:**
- Create: `logs/jiang-lan-zimage-hero-v1/hero-2026080921.png`
- Create: `logs/jiang-lan-zimage-hero-v1/hero-2026080922.png`
- Create: `logs/jiang-lan-zimage-hero-v1/hero-2026080923.png`
- Create: `logs/jiang-lan-zimage-hero-v1/hero-manifest.json`

**Step 1:** Verify ComfyUI is reachable at `http://127.0.0.1:8188` and the required workflow models are accepted by the running instance.

**Step 2:** Run `node scripts/run-jiang-lan-zimage-hero.mjs` and wait for all three queued jobs to complete.

**Step 3:** Check all four files exist, each PNG is non-empty, and every recorded SHA-256 matches its file.

### Task 3: Visual QA and operator selection handoff

**Files:**
- Inspect: `logs/jiang-lan-zimage-hero-v1/hero-2026080921.png`
- Inspect: `logs/jiang-lan-zimage-hero-v1/hero-2026080922.png`
- Inspect: `logs/jiang-lan-zimage-hero-v1/hero-2026080923.png`

**Step 1:** Visually inspect all candidates for a single adult human woman, stable long black hairstyle, readable outfit, front-facing neutral pose, complete body, clean anatomy, and cinematic 3D donghua style.

**Step 2:** Reject candidates containing beast traits, childlike anatomy, extra people, missing body parts, unreadable costume, text/collage artifacts, or major style drift.

**Step 3:** Present the passing candidates with seed labels and a concise recommendation. Stop for the user's selection; do not mutate the Jiang Lan asset in this task.
