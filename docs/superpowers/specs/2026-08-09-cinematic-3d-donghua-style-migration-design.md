# Cinematic 3D Donghua Style Migration Design

Date: 2026-08-09

## Goal

Adopt a consistent mature, semi-realistic 3D Chinese-animation look for character assets, storyboard stills, and video while preserving each character's established face, hairstyle, body proportions, and costume. Animal ears, tails, and other species anatomy must appear only on characters explicitly marked as beastfolk in the script or character metadata.

The three supplied screenshots are visual design references only. They must not be queued as ComfyUI identity or style-reference images because their faces, hair, costumes, and species traits could contaminate project characters.

## Selected approach

Use a prompt-based style contract named `cinematic_3d_donghua_v1`.

This is preferred over a style LoRA or per-shot image reference because it has no additional VRAM cost, works with the current RTX 5070 Ti 16 GB inference environment, and does not consume Klein's two character-reference slots. A separately trained and licensed style LoRA may be evaluated later, but it is outside this migration.

## Style contract

The positive contract describes:

- mature semi-realistic 3D donghua and premium game-cinematic rendering;
- adult character proportions and refined, slightly stylized facial anatomy;
- readable eyes, modeled nose and lips, detailed hair strands, soft luminous skin, and restrained subsurface scattering;
- physically readable cloth, leather, metal, fur, and jewelry materials;
- cinematic depth of field, soft key light, controlled rim light, and coherent character/environment rendering;
- fantasy costume design without copying any supplied screenshot's character identity or wardrobe.

The negative contract excludes:

- live-action or documentary photography;
- Disney, Pixar, western cartoon, chibi, toy-like, or juvenile proportions;
- flat generic 2D anime, manga panels, watercolor, sketches, collage, and character-sheet layouts in final shots;
- waxy or cheap plastic CG, excessive skin smoothing, overexposure, unreadable eyes, deformed anatomy, and duplicated characters.

The contract is versioned. Any material text change creates a new style-contract version and invalidates evidence that binds the prior version.

## Species gate

Species anatomy is independent from rendering style.

The resolver reads normalized character metadata and explicit script labels. An allowlist maps unambiguous terms such as `兽族`, `猫族`, `狐族`, and `狼族` to their declared anatomy. Only an explicit match may inject animal ears, a tail, fur placement, or other non-human anatomy.

For an unmarked, missing, or ambiguous species, the resolver defaults to human and injects a negative constraint equivalent to `human ears only, no animal ears, no tail, no horns, no animal muzzle`. It must not infer beastfolk status from the global style, costume vocabulary, scene setting, or the supplied screenshots.

The species gate cannot silently change an immutable identity trait. Conflicting identity metadata and script labels produce a visible validation error before generation.

## Integration and data flow

The existing global-style settings remain the operator-facing control. Their default value becomes the canonical `cinematic_3d_donghua_v1` contract.

The style contract is injected into:

1. initial character asset generation;
2. front, side, back, face, hair, body, and expression identity-reference generation;
3. storyboard still and redraw prompts;
4. video prompts and continuation prompts.

The current exception that prevents global style injection for `character_asset` scope is removed. Identity constraints remain a separate prompt section so style cannot overwrite face, hair, body, or costume requirements. Species constraints are resolved per character and appended after the shared style contract.

The style contract must not be represented as a `LoadImage`, `ReferenceLatent`, IP-Adapter, or other image-reference branch. Klein's two active reference inputs remain reserved for immutable character identity references selected for the current view.

## Shen Yan migration

The existing asset ID `asset_1774017261433_390` is preserved. Its current flat 2D front, side, and back images are migration sources, not release-ready references for the new style.

Migration runs one character at a time:

1. Extract immutable semantic traits from the existing identity pack: face shape, blue eyes, short dark-brown side-swept hair, teal tunic, navy long coat, brown belt, brown boots, and youthful adult male proportions.
2. Generate new front, side, and back images under `cinematic_3d_donghua_v1`, using the existing view image only as the corresponding identity/design source.
3. Reject animal ears, tail, horns, muzzle, and fur anatomy because Shen Yan is not explicitly marked as beastfolk.
4. Present generated candidates for visual approval. No candidate becomes an identity reference automatically.
5. After approval, write a new identity-pack version, update the approved hero frame, recompute reference hashes and identity metadata digest, and invalidate all receipts bound to the old identity version or bytes.

Old references and benchmark reports remain unchanged for audit and rollback. Migration never overwrites source images.

## Evidence and release gate

After the new identity pack is approved, run the fixed eight-shot Klein zero-shot benchmark with the official `flux-2-klein-4b-fp8.safetensors` workflow and pinned SigLIP2 evaluator revision `75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2`.

The evaluator implementation, scores, dimension floors, and report are not edited to obtain a pass. Every rerun uses a new report and artifact path. Production unlock requires:

- eight completed model-generation outputs;
- eight accepted shots and no fallback/cutout output;
- exact provider, model, terminal-output, reference, identity, workflow, and evaluator proofs;
- `evidenceEligible: true` and a backend-generated private receipt after re-evaluation.

If any shot remains `needs_review`, the report is preserved with exact failed dimensions and the production gate remains closed.

## Error handling

- Missing or ambiguous species metadata defaults to human.
- Conflicting explicit species metadata fails before queueing.
- Missing style-contract version fails before evidence-bearing generation.
- A character-asset workflow that omits the style contract fails its static contract test.
- A workflow that connects the supplied style screenshots as active character references fails the compiled reference-binding gate.
- Any identity reference, metadata, style-contract, model, workflow, or evaluator change invalidates the corresponding evidence before the next queue operation.

## Verification

Automated checks cover:

- human characters receive explicit no-beast-anatomy constraints;
- each supported beastfolk label receives only its declared anatomy;
- ambiguous text, costume words, or scene words cannot enable beastfolk anatomy;
- character assets, identity-reference passes, storyboard stills, redraws, and videos receive the same style-contract version;
- style prompt injection does not replace immutable identity or species constraints;
- changing the style-contract version or approved identity bytes invalidates prior evidence;
- Klein retains exactly two active identity-reference inputs and no screenshot-derived style input;
- existing character consistency, evidence, provider, UI, benchmark, Python attestor, Rust, and production build checks remain green.

Live verification generates Shen Yan's new candidate reference set, records operator selection, and runs the strict eight-shot benchmark. Visual similarity alone is diagnostic; only the accepted signed evidence path enables production.

## Out of scope

- Training or downloading a style LoRA.
- Copying a named artist, studio, copyrighted character, face, or costume from the supplied screenshots.
- Automatically marking a generated identity candidate as approved.
- Relaxing evaluator floors or editing benchmark scores.
- Applying beastfolk anatomy to every character merely because the project uses a fantasy style.
