# MiniMax H3 Task 7 implementation report

## Scope and baseline

- Baseline: `2cdb95f360b917b5c2f12194099ed8533687c193`
- Added the isolated Rust implementation in `src-tauri/src/video_continuity.rs`.
- Added the executable contract in `scripts/check-video-normalization-contract.mjs`.
- Added only Task 7 registration, dependency, production-flow, Web-boundary, and typed-wrapper hunks to the already-dirty shared files; these hunks are isolated in the Task 7 commit without staging unrelated workspace changes.
- Did not start Task 8.

## TDD evidence

1. The Node contract was created before the bridge implementation and failed at the first missing export: expected `probeVideoSegment` to be a function, actual value `undefined`.
2. The Rust tests were created before production functions and failed with 15 expected unresolved function errors covering path guards, concat preflight, probe, normalize, review frames, and concat.
3. The first real-media run failed with `ffprobe_json_invalid`; FFprobe 8 emits packet timestamps as JSON numbers. The parser was corrected to strictly accept integer or numeric-string timestamps.
4. A new EOF-freeze assertion then failed because `freezedetect` does not always emit `freeze_end` at end of stream. The implementation now closes a pending interval at the strictly probed media duration; the targeted fixture turned green.
5. The review remediation first executed the real `concatShotVideos` function with the production request; the old implementation failed at `paths.map` and exposed its legacy-only shape. The replacement test proves two normalize calls, two same-credential review calls, one credentials-only concat, and zero legacy command calls.
6. A canonical project fixture wrote a fully self-consistent forged JSON receipt; the original verifier returned `Ok`, proving the caller-controlled trust root. The same fixture now fails with `normalization_receipt_not_issued` against the private registry.
7. The exact-frame test initially failed to compile because `VideoProbe` had no `decoded_frame_count`. FFprobe now counts decoded frames and the fixture reports exactly 24. A decoded-index review-filter test likewise failed before `select=eq(n\\,index)` was implemented.
8. The real Windows Web `invokeCommand` test initially returned generic `Unsupported bridge command`; all four commands now fail with the explicit architecture boundary `video_normalization_requires_tauri_runtime`, and frontend/production code blocks before fetch.

## Security and media contract

- Every caller path must be non-empty and absolute. Canonical input, credential, and derived paths are constrained to the selected project and its canonical asset subtree; pre-existing derived-directory symlinks cannot redirect output outside that subtree.
- Output names are backend-generated from a restricted segment ID or a backend nonce. Existing targets are rejected. FFmpeg writes to a same-volume temporary file and publication uses a no-clobber hard link, so arbitrary files are never overwritten.
- All FFmpeg/FFprobe calls use `Command::new(...).arg/args(...)`; no shell command string is constructed.
- FFprobe output is JSON-deserialized into typed structures and validates one video stream, at most one audio stream, exact reduced rational FPS, codec, pixel format, audio properties, monotonic and constant-step video DTS (PTS fallback), and exact decoded frame count. A credential is issued only when decoded frames equal `durationFrames`; container duration tolerance is 5 ms.
- Normalization explicitly writes `fps=24,scale=<project>,setsar=1,format=yuv420p`, H.264/libx264, AAC 48 kHz stereo, and an exact frame-derived `-t`. Missing source audio receives a bounded stereo silence source. Publication is atomic and no-clobber.
- Receipts are backend-issued using OS CSPRNG receipt IDs and issuance nonces. Immutable claims live under the Tauri private app-data registry, never in the project-writable asset tree, and bind canonical project root, canonical asset root, media path, SHA-256, length, mtime, dimensions, exact frame count, and the complete probe. Caller claims are compared to registry authority.
- `blackdetect` and `freezedetect` produce structured intervals. Freeze intervals continuing through EOF are closed at probed duration.
- Review extraction first verifies the private receipt and copies a hash-checked snapshot into a private derived directory. It uses decoded-frame filters for indices 0, `floor(frameCount/2)`, and `frameCount - 1`; 1/5/4-frame fixtures compare output SHA-256 against an independent full-decode PNG sequence.
- Concat rejects duplicate receipt IDs, validates every registry record and current file binding, then copies each input to a private staging directory and re-hashes/re-probes the snapshot. The concat list contains only backend-generated fixed filenames and uses `-safe 1`. Original files are no longer consumed after validation, avoiding source replacement TOCTOU. Receipts are atomically marked consumed before encoding, so replay fails before publication. Compatible streams are encoded to an exact summed frame count once.
- The legacy `concat_video_segments` command remains registered only for explicit legacy paths. The real production `concatShotVideos` function now normalizes every segment, extracts review frames from the exact returned credential, and sends only those credentials to `concatNormalizedVideoSegments`; its executable test asserts legacy calls remain zero.
- Windows Web cannot safely duplicate the Tauri private-registry trust root, so the four commands are explicitly disabled there. The real server dispatcher, typed bridge wrappers, and production flow all return `video_normalization_requires_tauri_runtime` before work begins.

## Verification

- `node scripts/check-video-normalization-contract.mjs` — PASS. This dynamically transpiles and executes the TypeScript bridge with a fake Tauri transport, asserts exact command arguments/responses and rejection paths, then runs the Rust tests with real local FFmpeg fixtures.
- `cargo check --manifest-path src-tauri/Cargo.toml` — PASS.
- `npm.cmd run build` (`tsc -b && vite build`) — PASS. The ordinary `npm` PowerShell shim was blocked by the host execution policy, so the equivalent Windows command shim was used.
- Real fixture coverage includes a 24 fps H.264/AAC exact-frame probe, 30→24 fps/scale/audio normalization, silent-input AAC synthesis, black and EOF-freeze reports, 1/5/4-frame golden review extraction, and exact-frame two-segment concat.
- Security negatives cover forged, duplicate and replayed receipts; source replacement between validation and snapshot; target preoccupation/no-clobber; VFR/bad timestamps; codec/audio mismatch; and Windows Web dispatch. Windows symlink creation was unavailable without `SeCreateSymbolicLinkPrivilege`, so that fixture reports an explicit SKIP; the canonical containment implementation remains exercised on supported hosts.
- Detached clean-tree validation of the exact 11-file Task 7 diff passed `node scripts/check-video-normalization-contract.mjs` and `cargo check --manifest-path src-tauri/Cargo.toml` after supplying the baseline-required untracked icon and an empty `dist` validation fixture. A full clean-tree `npm.cmd run build` and the Task 5/6 checkers remain blocked by pre-existing cross-task shared changes absent from `HEAD` (`Character*`/Comfy proof types, `sequentialCharacterPassRuntime`, `applyGlobalStyleToTokens`, and `resolveVideoFrameSources`); the same build and Task 5/6 regressions pass in the integrated main workspace. No unrelated fixes were pulled into the Task 7 commit to mask that baseline condition.
