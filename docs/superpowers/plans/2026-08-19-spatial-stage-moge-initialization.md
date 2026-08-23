# Spatial Stage MoGe Initialization Plan

**Goal:** Produce a deterministic, auditable ComfyUI API workflow for panorama geometry initialization while preserving a manual-proxy fallback when the local capability report is unavailable.

## Tasks

- [ ] Add a pure MoGe workflow builder with bounded defaults and connected geometry/depth/normal/mask outputs.
- [ ] Add workflow auditing and an injected transport runner that never queues when capability preflight fails.
- [ ] Add focused contract tests and run the existing spatial/video/build regression suite.
- [ ] Record the offline/manual fallback and live-queue boundary in verification notes.

## Constraints

- Do not alter or clean unrelated dirty/untracked files.
- The builder accepts only a ComfyUI `LoadImage` filename, never an arbitrary absolute path.
- No claim of a live generated mesh until a transport is explicitly supplied and verified.
- Missing model, unavailable capability, or insufficient VRAM returns `manual_fallback` rather than throwing or queuing.
