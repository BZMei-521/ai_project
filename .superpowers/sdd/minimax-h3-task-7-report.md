# MiniMax H3 Task 7 implementation report

## Scope and baseline

- Baseline: `2cdb95f360b917b5c2f12194099ed8533687c193`
- Added the isolated Rust implementation in `src-tauri/src/video_continuity.rs`.
- Added the executable contract in `scripts/check-video-normalization-contract.mjs`.
- Added only registration/typed-wrapper/script-line changes to the already-dirty shared files `src-tauri/src/main.rs`, `src/modules/platform/desktopBridge.ts`, and `package.json`.
- Did not start Task 8.

## TDD evidence

1. The Node contract was created before the bridge implementation and failed at the first missing export: expected `probeVideoSegment` to be a function, actual value `undefined`.
2. The Rust tests were created before production functions and failed with 15 expected unresolved function errors covering path guards, concat preflight, probe, normalize, review frames, and concat.
3. The first real-media run failed with `ffprobe_json_invalid`; FFprobe 8 emits packet timestamps as JSON numbers. The parser was corrected to strictly accept integer or numeric-string timestamps.
4. A new EOF-freeze assertion then failed because `freezedetect` does not always emit `freeze_end` at end of stream. The implementation now closes a pending interval at the strictly probed media duration; the targeted fixture turned green.

## Security and media contract

- Every caller path must be non-empty and absolute. Canonical input, credential, and derived paths are constrained to the selected project and its canonical asset subtree; pre-existing derived-directory symlinks cannot redirect output outside that subtree.
- Output names are backend-generated from a restricted segment ID or a backend nonce. Existing targets are rejected. FFmpeg writes to a same-volume temporary file and publication uses a no-clobber hard link, so arbitrary files are never overwritten.
- All FFmpeg/FFprobe calls use `Command::new(...).arg/args(...)`; no shell command string is constructed.
- FFprobe output is JSON-deserialized into typed structures and validates one video stream, at most one audio stream, exact reduced rational FPS, duration, codec, pixel format, audio properties, and monotonic video DTS (PTS fallback).
- Normalization explicitly writes `fps=24,scale=<project>,setsar=1,format=yuv420p`, H.264/libx264, AAC 48 kHz stereo, and an exact frame-derived `-t`. Missing source audio receives a bounded stereo silence source. Publication is atomic and no-clobber.
- The normalization receipt binds canonical media/receipt paths, SHA-256, byte length, modification time, project dimensions, exact duration frames, and the complete probe.
- `blackdetect` and `freezedetect` produce structured intervals. Freeze intervals continuing through EOF are closed at probed duration.
- Review extraction first verifies the receipt and copies a hash-checked snapshot into a private derived directory. It extracts frame 0, `floor(frameCount/2)`, and `frameCount - 1`, so no seek exceeds the clip.
- Concat validates every receipt and current file binding, then copies each input to a private staging directory and re-hashes/re-probes the snapshot. The concat list contains only backend-generated fixed filenames and uses `-safe 1`. Original files are no longer consumed after validation, avoiding source replacement TOCTOU. Compatible streams are re-encoded once to a normalized final asset.
- The legacy `concat_video_segments` command remains registered. The new production flow must use the typed `concatNormalizedVideoSegments` wrapper; the existing large dirty `comfyService.ts` legacy caller was intentionally not edited under this task's shared-file ownership boundary.

## Verification

- `node scripts/check-video-normalization-contract.mjs` — PASS. This dynamically transpiles and executes the TypeScript bridge with a fake Tauri transport, asserts exact command arguments/responses and rejection paths, then runs the Rust tests with real local FFmpeg fixtures.
- `cargo check --manifest-path src-tauri/Cargo.toml` — PASS.
- `npm.cmd run build` (`tsc -b && vite build`) — PASS. The ordinary `npm` PowerShell shim was blocked by the host execution policy, so the equivalent Windows command shim was used.
- Real fixture coverage includes a 24 fps H.264/AAC probe, 30→24 fps/scale/audio normalization, black and EOF-freeze reports, first/middle/last PNG extraction, and two-segment concat.
