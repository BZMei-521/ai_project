# Unity exchange verification — 2026-08-26

## Implemented

- `scripts/lib/unity-previs/exchange.mjs` validates the version-1 RH/Y-up DTO, reports field/entity-context errors, reflects positions and quaternions across the Z axis, creates tolerance-aware semantic scene digests, and verifies immutable export manifests.
- `scripts/unity-previs.mjs` supports `validate <scene.json>` and `verify <export-directory> <expected-scene.json>`.
- `scripts/lib/unity-previs/stage-adapter.mjs` adapts an explicit SceneStage snapshot/camera pair and applies an exchanged overlay back to a clone while retaining opaque original fields.
- `scripts/check-unity-previs-contract.mjs` covers invalid camera values, NaN, dangling references, joint cycles, unsupported primitive shapes, double reflection, stale scenes, unsafe paths, PNG corruption, SHA mismatch, Unity's default empty `hand`, and the CLI.

## Evidence

The red test initially failed because the exchange module and then the CLI did not exist. The green command was:

```powershell
node --test scripts/check-unity-previs-contract.mjs
```

It passed: 1 test, 0 failures.

The SceneStage adapter check also passed:

```powershell
node --test scripts/check-unity-previs-adapter.mjs
```

The same verifier was run read-only against both real Unity exports, each paired with its own `scene.json` as expected scene. Both returned `{ "valid": true, "errors": [] }`.

## Limits and decisions

- Semantic matching rounds finite numeric DTO values to 5 decimal places, allowing Unity serialization noise of roughly 1e-6 while detecting meaningful transform edits. Unknown DTO fields are rejected rather than omitted from the digest.
- Unity's serialized empty joint `hand` is normalized to semantic `none`; all other known DTO fields remain significant.
- Only `inside` and `contact` relations are accepted, matching the current C# implementation. Only box, sphere, capsule, and cylinder primitives are accepted. IDs are bounded ASCII-safe identifiers; camera, transform, size, radius, and relation bounds match the Unity limits.
- Complete exports require global color/depth/normal, a visible mask per entity, and isolated-mask/OpenPose/hand/contact artifacts for every subject. Descriptors use exact kind-specific encodings, unique `(kind, entityId)` pairs, scene-camera dimensions, and known entity IDs.
- PNG verification validates signature, chunk ordering/CRC, supported 8-bit formats, zlib payload size, filter bytes, dimensions, hashes, and relative-basename paths. It intentionally does not interpret pixels or assert artistic/control-pass semantics.
- The SceneStage adapter accepts only the explicit primitive/no-rig subset: right-handed Y-up metric stages with empty environments, no constraints, box/sphere/capsule entities, non-subject roles declared by `metadata.unityPrevisRole` or a `previs:<role>` tag, and an exact selected snapshot/camera. It rejects planes, meshes, rigs, subjects without a separate pose supplement, constraints, or an implicit first camera. Reverse import updates only the selected snapshot transforms and selected camera while preserving all other original fields.
