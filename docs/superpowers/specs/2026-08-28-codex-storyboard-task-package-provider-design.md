# Codex Storyboard Task-Package Provider Design

**Date:** 2026-08-28

**Status:** User-approved design

## Objective

Add Codex built-in image generation as an optional storyboard-image path while retaining the existing local ComfyUI path unchanged. The first production-shaped trial covers only `E01-C01` and must prove an end-to-end handoff: export an immutable job package, generate one Codex candidate, validate the returned receipt, import it as review-only, and publish it only after explicit human acceptance.

Codex built-in image generation is available inside a Codex task, not as a background REST service callable by the desktop application. The integration therefore uses a versioned filesystem task package rather than pretending that Codex is a directly callable online provider.

## Scope

### Included

- Add `CodexTaskPackageProvider` alongside the existing `GenerationProvider` abstractions.
- Expose `Codex 生图（任务包）` as an optional storyboard-image path.
- Export one immutable package per shot attempt.
- Assign an explicit usage and per-image instruction to every reference image.
- Allow the current Codex task to generate one candidate per package with the built-in image-generation tool.
- Import a validated Codex result into the existing `needs_review` state.
- Preserve the existing accepted image until a human explicitly accepts the candidate.
- Run the complete bridge once for `E01-C01`.

### Excluded

- Replacing ComfyUI for video, audio, character-asset, panorama, quality, or export jobs.
- Calling the OpenAI Images API from the desktop application.
- Requiring or storing `OPENAI_API_KEY`.
- Background polling, directory watchers, scheduled processing, or automatic Codex task creation.
- Batch generation for an episode or multiple shots in the first release.
- Automatically accepting a visually plausible image.

## Architecture

The existing generation state machine remains authoritative. The new provider supplies a filesystem handoff instead of a Comfy prompt submission.

```text
Storyboard UI
  -> CodexTaskPackageProvider
    -> immutable package exporter
      -> current Codex task + built-in image generation
        -> result receipt validator
          -> existing needs_review gate
            -> explicit human acceptance
```

### Components

#### `CodexTaskPackageProvider`

Implements the storyboard method of the existing provider contract. For unsupported job kinds it returns a clear unsupported-job failure rather than silently routing to ComfyUI. Its storyboard operation exports a package and returns a queued/pending result that identifies the package directory and job ID.

#### Package exporter

Builds a new directory using exclusive creation, copies the ordered selected references, calculates hashes and dimensions, and publishes `request.json` last. Publishing the request last is the completion marker; a directory without `request.json` is incomplete and cannot be processed.

#### Codex bridge runner

Runs inside the current Codex task. It validates the immutable request and references, maps every usage/instruction pair to a structured image-generation prompt, calls the built-in image-generation tool once for the shot, copies the returned artifact into the package, and publishes `result.json` last.

This runner is an operator workflow, not a hidden desktop network client. Its generated image must be copied into the project-bound package; a path under Codex's default generated-image directory is not a valid final project result.

#### Result importer

Validates package identity, reference lineage, output metadata, and path containment. A valid result updates the task to `needs_review` and sets only the review candidate path. It cannot update the shot's accepted `generatedImagePath`.

#### Existing review gate

Remains unchanged as the publication authority. Explicit acceptance promotes the candidate; rejection leaves the accepted shot untouched. Retrying creates a new package and job ID.

## Package Contract

Each attempt uses a new project-managed directory:

```text
codex-storyboard-jobs/<jobId>/
├─ request.json
├─ inputs/
│  ├─ 01-spatial-authority.png
│  ├─ 02-body-costume.png
│  ├─ 03-face-identity.png
│  └─ 04-style-only.png
└─ outputs/
   ├─ candidate.png
   └─ result.json
```

The filenames are deterministic snapshots, not a fixed four-file schema. A package may contain any positive number of references. Multiple references may share one usage, and their array order defines Picture 1, Picture 2, and so on for prompt compilation. For the initial `E01-C01` proof, the four listed references are used.

### `request.json`

The request contains:

- `schemaVersion`
- `jobId`
- `projectId`
- `episodeId`
- `shotId`
- `provider: "codex_task_package"`
- `createdAt`
- `prompt` with use case, asset type, scene, subject, composition, lighting, constraints, and avoid rules
- `references`, an ordered array whose entries contain a stable `id`, semantic `usage`, required non-empty `instruction`, relative path, SHA-256, width, height, and MIME type
- `acceptedImagePath`, when present, as overwrite-protection evidence only
- `expectedOutput` with required relative paths and supported MIME types

The request contains project-relative or package-relative paths only. Absolute paths, `..`, symlink escapes, unknown usages, duplicate reference IDs, duplicate source files assigned conflicting instructions, and unknown top-level fields fail closed.

### Reference usages and instructions

Supported usages are `spatial_authority`, `pose_reference`, `face_identity`, `body_costume`, `prop_detail`, `style_only`, `lighting_only`, and `negative_example`. The free-text `instruction` narrows how that particular image must be used and must not contradict its usage. At least one `spatial_authority` and one identity-bearing reference (`face_identity` or `body_costume`) are required. Additional references and repeated usages are allowed.

The initial `E01-C01` package annotates its four references as follows:

- `spatial_authority`: authoritative camera, coffin geometry, subject projection, pose, framing, and occlusion.
- `body_costume`: authoritative costume, body appearance, high coiffure, and phoenix hairpin.
- `face_identity`: authoritative Li Baozhu identity.
- `style_only`: material, lighting, and cinematic semi-realistic Chinese 3D animation language only; its close-up composition is not authoritative.

### `result.json`

The result contains:

- the same schema, job, project, episode, shot, and provider identity
- a digest of the canonical request
- every verified reference ID and digest, preserving request order
- `generationMode: "codex_builtin_imagegen"`
- the final normalized prompt used by Codex
- output relative path, SHA-256, width, height, and MIME type
- `completedAt`
- `state: "completed"`

The result is published only after `candidate.png` is fully written and verified. The importer accepts no alternative output path and no remote-only URL.

## State Transitions

```text
queued/exporting
  -> exported
  -> Codex processing outside the desktop application
  -> result available
  -> needs_review
  -> accepted | rejected
```

- Export failure ends as `failed` with no processable request.
- A cancelled task may retain evidence files, but its later result cannot be imported or published.
- A malformed or mismatched result ends as `failed` or remains review-blocked with a deterministic diagnostic.
- Rejection is terminal for that job. A retry creates a new job directory and does not mutate the rejected package.

## Prompt Construction

The exporter builds a structured production prompt, not a single unlabelled prose string. It follows the image-generation taxonomy `stylized-concept` and names the intended asset as an AI comic-drama storyboard frame.

The prompt must enumerate every reference as `Picture N`, its usage, and its instruction. It must also state:

- which references are authoritative and which are advisory or negative examples
- exact subject count
- required visible limbs and hand anatomy
- camera/framing invariants
- no text or watermark
- forbidden pose drift, camera drift, fused limbs, duplicate subjects, modern clothing, low-poly plastic appearance, and copying the style reference's composition

Codex may improve visual detail, but any geometry or identity drift remains subject to human review. Prompt wording is not treated as a hard geometric guarantee.

## Storage and Non-Overwrite Rules

- The package root is a project-managed asset location configured by the application, not a global temp directory.
- Package creation is exclusive; existing job directories are never reused.
- References are copied snapshots, not live links to mutable source files.
- `request.json` and `result.json` are published last using atomic rename semantics.
- Existing accepted storyboard images are read-only during export, generation, and import.
- A candidate is review evidence until explicit human acceptance.
- Retry and regeneration always use versioned sibling packages.

## Validation and Error Handling

### Export validation

- reject an empty reference list or missing required usages
- reject missing, unreadable, unsupported, or empty images
- reject path traversal and source-root escape
- reject duplicate IDs and conflicting duplicate source assignments
- reject an existing destination
- verify copied byte digests before request publication

### Codex bridge validation

- reject an incomplete package without `request.json`
- reject schema, provider, or identity mismatch
- reject reference digest, size, or MIME drift
- reject unresolved or unrecognized usages or empty instructions
- reject existing `candidate.png` or `result.json`
- leave no successful result receipt when generation fails

### Import validation

- reject request/result digest mismatch
- reject job, project, episode, shot, or provider mismatch
- reject output path escape, missing file, unsupported MIME, empty dimensions, or digest mismatch
- reject results for cancelled, rejected, already accepted, or unknown tasks
- reject any import operation that would overwrite the accepted shot path

## User Interface

The storyboard image-provider selector gains `Codex 生图（任务包）` while retaining the existing Comfy options. For the Codex path, the UI exposes:

- `导出 Codex 任务包`
- the package path and job ID
- a copyable instruction telling the user to ask the current Codex task to process that job
- `检查并导入结果`
- pending, invalid, needs-review, accepted, rejected, and cancelled states

The UI must not display the package as generated merely because export succeeded. It must not display the candidate as accepted merely because `result.json` validates.

## Testing Strategy

Implementation follows test-driven development.

### Exporter tests

- a complete `E01-C01` fixture exports the exact ordered reference layout
- multiple references with the same usage preserve order and compile into distinct `Picture N` instructions
- request publication occurs after all copied references are available
- the canonical request digest is stable for stable ordered semantic references
- missing required usages, empty instructions, duplicate IDs, conflicting duplicates, traversal, digest drift, and existing destinations fail

### Provider tests

- storyboard export returns a pending job with package path and job ID
- unsupported kinds fail explicitly
- selecting Codex does not mutate Comfy settings or provider behavior

### Bridge contract tests

- a valid request compiles every ordered reference into the expected usage-labelled built-in-image-generation specification
- incomplete and mutated packages are rejected before any generation call
- an existing output prevents a second write
- a successful injected image-generation result publishes a valid result receipt

Tests inject the image-generation boundary; they do not call the live built-in tool.

### Import and state tests

- a valid result enters `needs_review`
- `needs_review` leaves the accepted shot path unchanged
- invalid identity, lineage, dimensions, MIME, digest, or containment is rejected
- cancelled and rejected jobs cannot be published
- human acceptance alone updates `generatedImagePath`
- a retry produces a distinct job ID and directory

### Regression tests

- existing Comfy storyboard generation continues to queue and complete
- partial Comfy batch failure and isolated retry remain unchanged
- existing review-state non-publication guarantees remain unchanged

### Live `E01-C01` evidence

After deterministic tests pass:

1. Export a new `E01-C01` package.
2. Inspect all reference snapshots and verify each usage instruction; the initial fixture contains four.
3. Call Codex built-in image generation once.
4. Copy the generated candidate into the package and publish `result.json`.
5. Import it and prove the task is `needs_review` while the accepted path is unchanged.
6. Visually inspect subject count, camera, coffin, anatomy, costume, identity, and style.
7. Accept only if the user approves the candidate.

## Acceptance Criteria

- `Codex 生图（任务包）` is selectable without removing or altering ComfyUI.
- `E01-C01` exports a complete immutable task package.
- The current Codex task can process the package using built-in image generation without an API key.
- A valid candidate and result receipt are stored inside the project-managed package.
- Import produces `needs_review`, never automatic publication.
- Existing accepted storyboard output remains unchanged until explicit acceptance.
- Deterministic exporter, bridge-contract, importer, state, and Comfy regression tests pass.
- The live result and its exact prompt, ordered reference metadata/digests, output digest, and dimensions are retained as evidence.

## Rollout

The first release is deliberately limited to `E01-C01`. Episode batching, job watchers, automatic Codex task creation, and additional provider job kinds require separate designs after the single-shot handoff proves reliable.
