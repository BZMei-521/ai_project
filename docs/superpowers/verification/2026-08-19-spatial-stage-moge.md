# Spatial Stage MoGe Verification

## Implemented

- `mogeWorkflow.ts` builds a deterministic ComfyUI API graph using the installed `LoadMoGeModel`, `MoGePanoramaInference`, `MoGePointMapToMesh`, `MoGeRender`, and `SaveImage` nodes.
- The graph preserves the panorama filename, clamps resolution/batch/mesh parameters, and audits image/model/geometry/render connectivity.
- `mogeRunner.ts` requires an injected queue transport. Capability failure or missing transport returns `manual_fallback` without queueing.
- `comfyMogeTransport.ts` adds bounded `/prompt` and `/history/:promptId` HTTP transport with URL normalization and abort timeouts.
- `mogeAssetStaging.ts` uses the existing desktop bridge to discover ComfyUI `input` and copy the panorama before queueing; browser-only mode fails closed.
- Completed history outputs are parsed into depth/normal/mask URLs and persisted as a normalized `depth_map` stage source.
- The Three.js viewport renders `depth_map` as a bounded 2.5D displacement surface. It is a local spatial proxy, not a claim of complete 360-degree geometry.

## Live diagnostic

- ComfyUI prompt `dcef829e-379b-401f-9239-98630e3efda9` completed successfully on the installed MoGe model.
- Depth, normal, and mask outputs were retrieved under `logs/spatial-stage-moge-diagnostic/dcef829e-379b-401f-9239-98630e3efda9/`.

## Verification status

- Static file and symbol checks: completed.
- Node contract test: attempted via `npm run test:spatial-stage-moge`, blocked before execution by the managed Windows sandbox (`EPERM` while resolving `C:\Users\Administrator`).
- Full TypeScript/Vite build: attempted, blocked by the same environment error.

## Boundary

This phase does not claim a live mesh output. A ComfyUI transport and result polling adapter must be connected in the next phase, after which the generated depth/normal/mask files can be persisted into the stage environment.
