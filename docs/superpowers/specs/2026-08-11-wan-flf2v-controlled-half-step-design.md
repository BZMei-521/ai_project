# Wan FLF2V Controlled Half-Step Design

**Date:** 2026-08-11  
**Status:** Approved design, awaiting written-spec review  
**Scope:** Replace only the rejected first one-take segment with a first/last-frame-controlled experiment. Do not generate segments 2–6 or replace the authoritative live report until segment 1 passes.

## 1. Background

The identity-first Wan 2.1 I2V chain and its technical/creative gates are implementation-ready, but all three approved segment-1 seeds failed the creative beat: Shen Yan remained planted and never completed a readable grounded half-step. The gate correctly stopped before segment 2.

The current Comfy Desktop installation already contains:

- `WanFirstLastFrameToVideo`;
- `Wan2_1-I2V-ATI-14B_fp8_e4m3fn.safetensors`;
- `umt5_xxl_fp8_e4m3fn_scaled.safetensors`;
- `wan_2.1_vae.safetensors`;
- `clip_vision_h.safetensors`;
- RTX 5070 Ti with approximately 16 GB VRAM.

ATI is a trajectory-control model, not the dedicated FLF2V model. The experiment therefore downloads and uses the dedicated FP8 FLF2V diffusion model documented by ComfyUI:

`wan2.1_flf2v_720p_14B_fp8_e4m3fn.safetensors`

Official references:

- https://docs.comfy.org/tutorials/video/wan/wan-flf
- https://docs.comfy.org/tutorials/video/wan/wan-ati

## 2. Decision

Use a dedicated Wan 2.1 FLF2V 14B FP8 workflow with a strictly masked end keyframe.

- Generate at 1280×720, then center-crop/downsample to 832×480 without stretching.
- Use 17 frames at 16 FPS for the segment.
- Keep ATI trajectory control as a later fallback only. Do not combine ATI and FLF2V in the first experiment.
- Keep the existing I2V preset and rejected live report unchanged throughout the experiment.

## 3. Motion and Composition Contract

The first segment contains exactly one primary character action:

- Shen Yan makes one readable, grounded half-step along the riverside path toward the bridge.
- One leading foot lifts, advances along the path, and lands.
- His pelvis shows a small, physically plausible weight transfer.
- Jiang Lan remains in place, with relaxed lowered hands and no mirrored step.
- Both characters remain human and keep their existing left/right screen positions.
- The camera performs one extremely slow continuous forward push.

The experiment must reject:

- whole-character translation without leg articulation;
- leg stretching or sliding feet;
- both characters stepping;
- synchronized gestures or raised hands;
- identity, hairstyle, clothing, body-shape, species, screen-side, background, or lighting changes;
- abrupt camera motion, reframing, flicker, morphing, or a cut.

## 4. End-Keyframe Generation

### 4.1 Source

Use the approved river start frame as the only scene source. Derive a dedicated experimental end-frame preset from the existing Qwen masked image-edit workflow. The start frame is the main image reference; Shen Yan's approved character references may guide anatomy and clothing. Do not use a different scene image as the compositional source.

### 4.2 Editable region

The editable mask covers only Shen Yan’s pelvis and legs, including enough surrounding ground for a natural new foot contact and shadow.

The following regions are locked:

- Shen Yan’s face, hair, upper body, and clothing construction above the pelvis;
- Jiang Lan’s entire body;
- the environment, river, path, trees, lighting, camera position, and composition.

After Qwen produces an edited candidate, hard-compose it back over the original start frame using the approved lower-body mask with an 8–16 pixel feather only at the boundary. Pixels outside the mask and feather band come directly from the original frame. This makes the locked background, Jiang Lan, faces, and upper bodies deterministic rather than prompt-dependent.

### 4.3 End-keyframe acceptance

An end keyframe may enter FLF2V only when all conditions pass:

1. Exactly two human characters are present.
2. Character identities, faces, hair, outfits, proportions, and screen sides match the start frame.
3. Locked regions and background remain perceptually unchanged.
4. Shen Yan’s leading foot is visibly advanced along the path and grounded.
5. Pelvis and leg articulation show a plausible half-step rather than a translated or stretched body.
6. Jiang Lan has not stepped or gestured.
7. A pixel-difference check confirms that changes outside the editable mask plus feather band are zero.

Generate at most three end-keyframe candidates. If none passes, stop before video generation.

## 5. Resolution Normalization

The approved river frame is 1152×640. Preserve geometry without stretching:

1. Scale each approved start/end keyframe proportionally to 1296×720.
2. Center-crop 8 pixels from both the left and right edges, producing 1280×720.
3. Feed the normalized pair to FLF2V.
4. For the chain-compatible output, scale the generated 1280×720 frames to height 480 with an even computed width (`scale=-2:480`, producing 854×480).
5. Center-crop 11 pixels from both horizontal edges, producing 832×480.

Start and end images must use identical transforms and crop values. No padding or non-uniform scaling is allowed.

## 6. FLF2V Workflow

Create a new experimental ComfyUI API preset. It must not replace the existing ATI/I2V preset.

Required components:

- `UNETLoader`: dedicated FLF2V FP8 diffusion model;
- `CLIPLoader`: existing UMT5 XXL FP8, type `wan`, CPU-loaded when supported;
- `VAELoader`: existing Wan 2.1 VAE;
- `CLIPVisionLoader`: existing CLIP Vision H;
- separate `LoadImage` and `CLIPVisionEncode` nodes for start and end images;
- `WanFirstLastFrameToVideo` with both images and both CLIP Vision outputs;
- 1280×720, length 17, batch size 1;
- current proven sampler baseline: 20 steps, CFG 5, `uni_pc`, `normal`;
- H.264 output at 16 FPS.

The exact FLF2V model name is a preset contract. The workflow must fail before queuing if the model is not visible in `UNETLoader`.

## 7. Model Acquisition

Download only the FP8 FLF2V model into the Comfy Desktop shared `models/diffusion_models/` directory.

The acquisition step must:

- check available disk space first;
- use resumable download behavior;
- write to a temporary or partial filename;
- promote to the final filename only after the download completes;
- verify the final file is non-empty and visible in the refreshed ComfyUI model list;
- never overwrite or rename the existing ATI model.

If ComfyUI requires a restart to refresh the dropdown, restart only after download completion and report the action.

## 8. Experimental Isolation and State

All experimental artifacts use a separate FLF2V directory and report.

They must include:

- start image and SHA-256;
- every end-keyframe candidate, mask, prompt, seed, and decision;
- the single approved end-keyframe version and SHA-256;
- normalized 1280×720 start/end inputs;
- each FLF2V candidate video, seed, Prompt ID, media metadata, and decision;
- 0/2/4/6/8/10/12/14/16 contact sheet;
- final 832×480 candidate and metadata.

The current authoritative `logs/video-quality-one-take/wan-one-take-report.json` remains unchanged until an FLF2V segment passes all gates and a later, separately approved integration step imports it.

## 9. Video Acceptance

### 9.1 Boundary fidelity

- Frame 0 must perceptually and geometrically match the normalized approved start image.
- Frame 16 must perceptually and geometrically match the normalized approved end image.
- Start/end hashes identify the intended inputs; decoded boundary frames receive perceptual checks because video encoding is lossy.

### 9.2 Motion evidence

Inspect frames 0, 2, 4, 6, 8, 10, 12, 14, and 16. The sequence must visibly contain:

1. planted start;
2. foot lift;
3. forward travel along the path;
4. grounded landing;
5. plausible pelvis weight transfer and natural settling.

### 9.3 Continuity and quality

- exactly two humans in every sampled frame;
- stable faces, hair, clothing, proportions, species, and screen sides;
- Jiang Lan remains planted with lowered hands;
- background and light remain stable;
- extremely slow forward camera push, with no jump, reverse, pan, or fast zoom;
- no flicker, limb deformation, foot sliding, duplicated frame, black frame, or severe color block.

## 10. Retry and Failure Policy

- End-keyframe failure: retry only the masked image edit, at most three candidates. Do not queue FLF2V.
- FLF2V creative failure: keep the approved keyframe pair fixed and test at most three fixed seeds.
- Technical generation failure: retry the same seed without silently creating a new creative seed.
- OOM: enable model/text-encoder CPU offload first. If it still fails, run a separate 960×544 feasibility probe; do not silently treat that probe as production output.
- Three rejected video seeds: stop and record the reasons. Do not modify the current authoritative report.
- Only after three FLF2V rejections may a later design activate the existing ATI trajectory fallback.

## 11. Testing

Non-live contracts must verify:

- exact model and node names;
- both start/end image and CLIP Vision bindings;
- 1280×720, 17 frames, 16 FPS;
- sampler, CFG, scheduler, and steps;
- normalization/crop/downsample geometry;
- separate experiment paths and no writes to the authoritative report;
- start/end versions and SHA-256 fields;
- fixed three-seed policy;
- technical retry uses the same seed;
- rejected keyframe/video states cannot be promoted;
- malformed/OOM/download-interrupted states fail closed.

Live verification proceeds in this order:

1. inventory and disk preflight;
2. resumable model download and loader visibility;
3. end-keyframe candidate generation and visual acceptance;
4. one 1280×720, 17-frame VRAM probe;
5. up to three fixed video seeds;
6. nine-frame visual review and 832×480 media verification.

## 12. Success and Non-Goals

### Success

The experiment succeeds only when segment 1 visibly performs the approved half-step, preserves both identities and the scene, maintains the extremely slow push, and produces a valid 832×480/16 FPS/17-frame result with complete evidence.

### Non-goals

- generating segments 2–6;
- assembling the six-segment delivery;
- changing the character models or art style;
- installing FunControl/VACE/OpenPose video weights;
- combining ATI trajectories with FLF2V;
- adding RIFE, FaceDetailer, audio, lip sync, or multi-person layering;
- deleting old media or replacing the authoritative rejected report.

## 13. Rollback

The implementation is additive. Rollback removes only the experimental preset, scripts, report, and optional downloaded FLF2V model. The existing ATI model, current I2V preset, gated runner, review CLI, reports, and historical media remain intact.
