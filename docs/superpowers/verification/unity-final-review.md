# Final bounded Node adapter review

Date: 2026-08-26. Scope: current `scripts/lib/unity-previs/{exchange,stage-adapter,layered-adapter}.mjs`, both CLI entry points and their three check scripts. The existing layered-pack contract was read only to understand provenance/assembly. No tests rerun, no Unity launched, no runtime code edited. Test PASS and two real-export verification results are parent/worker-supplied evidence, not independently executed here.

## Verdict

**Changes required.** Two P1 defects prevent the advertised cross-runtime/lossless adapter workflow. Additional P2 issues affect validation robustness and verification claims. Layered assembly uses per-entity control images and retains original source provenance separately from the edited exchange digest; no global-color substitution was found.

## Findings

### N1 — P1: SceneStage conversion creates identifiers Unity rejects

`scripts/lib/unity-previs/stage-adapter.mjs:58`; `scripts/lib/unity-previs/exchange.mjs:7`.

Every converted primitive is named `${entity.id}:primitive`. Node's SAFE_ID accepts colon, dot and hyphen (not slash), whereas current Unity SpaceMap.SafeId accepts only ASCII letters, digits, underscore and hyphen. Therefore a successful Node conversion of the supported primitive subset cannot load in Unity. Align the grammar and generated IDs. Add a shared accepted/rejected identifier corpus plus a real converted-input load check; the current Node-only adapter test cannot detect this boundary failure. Underscore/hyphen first-character acceptance also differs.

### N2 — P1: roundtrip silently discards unsupported edits

`scripts/lib/unity-previs/stage-adapter.mjs:75-95`.

toSceneStage validates the broad exchange schema but only copies root transforms and camera position/target/FOV/near/far. Changes to primitive kind/size/local transform, attachments, relations, roles, joints, camera up or output dimensions are accepted and silently ignored. It also does not compare source.shotId or exchange scene ID to the selected original snapshot/scene. Either map each supported change back or compare against a fromSceneStage baseline and explicitly reject every field outside the editable subset. Add one mutation test per rejected non-owned field and source selector.

### N3 — P2: unsupported source visibility becomes visible geometry

`scripts/lib/unity-previs/stage-adapter.mjs:22-39,53-66`.

assertSupported never inspects entity/snapshot visibility. The converter emits all primitives and Unity renders all of them, including a source snapshot state declared hidden. This changes occlusion while claiming a lossless supported subset. Preserve visibility if supported, otherwise reject non-visible source states explicitly. Other unrepresented pose-affecting fields such as camera roll should likewise be rejected rather than assumed compatible.

### N4 — P2: validation throws on malformed nested input

`scripts/lib/unity-previs/exchange.mjs:119,137,182`.

The first entity validation loop records null joints, then subject mapping dereferences them. Contact attachment lookup similarly dereferences null entries or calls `.some` on a non-array object. validateExport catches invalid-scene digest errors then still maps malformed scene entities without guarding them. The CLI stops, but the promised structured invalid report is lost and library callers unexpectedly reject/throw. Guard all follow-up passes or stop after structural failure. Also align remaining collection, bone-radius, mapping and inside-bounds checks with Unity's stricter limits.

### N5 — P2: unsafe manifest paths are read after being rejected

`scripts/lib/unity-previs/exchange.mjs:172-177`.

An invalid sceneFile/preflightFile basename adds an error but does not prevent readFile(resolve(directory, value)). The validator can therefore read an absolute or parent-traversal path outside the export before returning invalid. Stop before I/O on invalid descriptors. Basename checks alone also do not contain symlink targets; decide and document whether external local export folders are trusted. PNG inflation currently has no output-size bound; compare IHDR dimensions against expected size before inflation and cap inflated bytes to the declared row size for untrusted files.

### N6 — P2: export verification can approve a pack missing mandatory layer inputs

`scripts/lib/unity-previs/exchange.mjs:184-188`; `scripts/lib/unity-previs/layered-adapter.mjs:13-16`.

validateExport requires global color/depth/normal plus per-entity visible masks and subject extras, but not per-entity color/depth/normal. buildLayeredPack requires all three per entity. Removing one isolated entity color from a complete export can therefore yield verify.valid=true followed by layered-import failure. Make verifier completeness match the current runtime export/import contract.

### N7 — P2: negative manifest tests have a permanently invalid baseline

`scripts/check-unity-previs-contract.mjs:60-72`.

Hash, path and corrupt-PNG assertions all reuse a one-image 1x1 manifest against a 960x540 scene, lacking required artifacts. Their expected false result still holds if the protection under test is removed. Build one complete valid export fixture first, assert it validates, then mutate a single property and assert the relevant error field/reason. The reported real-export happy-path verification does not supply this missing negative coverage.

## Reviewed non-findings / limits

- Public filesystem layered import calls validateExport before assembly. Missing entity-specific layer images cause assembly to throw, rather than silently substitute full-scene color.
- Layer stageDigest is explicitly the edited exchange digest, while original source stageDigest and selectors are retained in the encoding receipt. This is an adapter provenance domain, not proof that the receipt matches the formal workbench's independently computed current-stage digest.
- Artifact PNG hashes, CRCs, dimensions and basic decompression/filter structure are checked. Source-scene exact SHA-256 and semantic expected-scene freshness are checked.
- CLI errors produce nonzero status. Receipt writing uses exclusive `wx`, avoiding overwrite of an earlier receipt.
- Cropped pose endpoints are documented in the encoding receipt; this remains a supported-prototype limitation, not a claim of clipped-limb rasterization.
- The root reports C# R7 fixed by applying validated camera data before preflight projection and is compiling the final build. This Node review did not rerun or independently approve that change.

The two P1 defects were sent to the parent immediately. Final source review and GPU/visual acceptance must use the corrected snapshot rather than this initial review snapshot.

## Re-review of worker fixes

Read-only re-review of the current source and tests; no test reruns. The original findings above are historical and the table below records their current disposition.

| Finding | Current status |
| --- | --- |
| N1 identifier boundary | Resolved: Node now uses `[A-Za-z0-9_-]{1,128}` and primitive suffix `-primitive`, matching Unity. |
| N2 discarded edits | Main geometry/attachment/relation/camera edit loss resolved by comparison against the original-derived immutable baseline; shot ID is checked. Small remaining gap: exchange scene `id`/`label` are not compared and are still silently discarded. Original camera roll/rotation is not explicitly excluded from the claimed lossless source subset. |
| N3 source visibility | Resolved: both entity and selected snapshot state must be visible. |
| N4 malformed nested input | Partially resolved: null subject joints and null attachment entries are guarded. Still unresolved: a contact subject's `attachments={}` invokes `.some` on a non-array, and malformed exported `entities` (object or array containing null) reaches the unguarded entityRoles map after sceneDigest failure was caught. |
| N5 path I/O | Main defect resolved: invalid manifest header/basenames now return before scene/preflight I/O. Previously noted symlink trust and unbounded PNG inflation remain limitations for untrusted external folders. |
| N6 complete layer inputs | Resolved: verifier now requires color/depth/normal for every entity. |
| N7 invalid negative-test baseline | Unresolved in the reviewed snapshot: contract tests still initialize a 1x1 single-color incomplete manifest against a 960x540 scene, then use it for corruption/path/hash assertions. |

The remaining blocking review work is to finish N4's structural guards and N7's valid-baseline regressions. Reject unsupported scene identity edits to complete N2's stated contract. No additional broad review scope was introduced.

### C# and documentation re-review

`PrevisScene.Preflight` now returns immediately on validation errors and applies camera data before contact-frame projection. The added test mutates Data.camera after Load. R7 is resolved. LoadFile compares sidecar source lineage before loading/replacing the scene; the added regression rejects an unrelated shot. This resolves the previously documented adjacent-sidecar association gap for source lineage.

Read final logs directly:

- `Logs/final-verify-build.log`: validation PASS at line 272; core PASS at line 283; render PASS at line 293; standalone build PASS at line 2263.
- `Logs/final-player-smoke.log`: `PREVIS_PLAYER_SMOKE_PASS` at line 48.

README accurately separates the independent prototype, restricted primitive SceneStage adapter, unsupported rigs/subject-pose conversion, editable root/camera subset, and deferred AI acceptance. Its promise that all other reverse edits reject should remain conditional until the scene identity gap above is closed. Full validation implementation approval remains parent-owned because this reviewer authored the C# validator.

**Current verdict:** primary interoperability and control-artifact defects are fixed; changes remain required for N4/N7 and the narrow N2 identity guard. Real final Unity test/build/smoke evidence is observed, but it does not replace Node malformed-input regressions or manual image/AI acceptance.

## Final disposition after root patches

This section supersedes the preceding interim verdicts. Re-read the corrected source and tests without executing them.

| Finding | Final disposition |
| --- | --- |
| N1 | Resolved: common identifier grammar and compatible generated primitive IDs. |
| N2 | Resolved for the documented restricted adapter: scene ID/label/source are compared to baseline, unsupported entity/camera/relation edits reject, and unsupported source camera roll/panorama values reject explicitly. Supported transforms and camera changes are applied. |
| N3 | Resolved: hidden entity or selected-snapshot state rejects. |
| N4 | Resolved for the reported failures: attachment lookup requires an actual array; malformed exported entity collections are safely guarded; subject null-joint entries do not throw. Dedicated malformed attachment/export-entity cases are present. |
| N5 | Resolved for unsafe declared manifest paths: header/basename failure returns before I/O. Trusted local directory assumptions remain as noted below. |
| N6 | Resolved: complete entity color/depth/normal inputs are required by verification. |
| N7 | Resolved: a complete valid 16x16 PNG export fixture is asserted valid before and after independent mutations. Tests update hashes when testing semantic staleness or PNG corruption, and check branch-specific error fields/messages. |

Adapter regressions now cover reordered properties/float32 serialization, immutable edits, source visibility/coordinate/panorama rejection, and sphere/capsule size semantics. The root reports that the panorama test failed before the missing source guard was added; this reviewer did not independently rerun the red/green cycle.

The latest `Logs/final-acceptance.log` was read directly: validation PASS line 265, core PASS line 276, render PASS line 286, build PASS line 2251. Reviewed the added checks for rotated-parent descendant world position after reload, shot-camera direction and up, renamed entity IDs, and positive RH view-space Z normal encoding. Earlier final standalone smoke PASS remains separately recorded above.

**Final scoped spec verdict:** no remaining blocking finding in N1–N7 or C# R7/source-lineage fixes for the documented independent local prototype. **Final scoped code-quality verdict:** acceptable after these fixes; no further blocking finding in this bounded re-review. Node execution results remain root-owned, C# validator independent acceptance remains root-owned, and manual image/AI acceptance is not claimed.

**Residual deployment limits:** this does not approve arbitrary untrusted external export folders: symlink containment and decompression allocation bounds were not hardened in this patch. Node/C# edge-limit parity is not certified for every possible input; Unity remains the strict runtime gate. These do not reopen the corrected N1–N7 local-workflow blockers, but should be addressed before exposing import as a general untrusted-file service. README's restricted source subset, editable subset, separate exchange-pose persistence, and deferred AI acceptance now match the reviewed implementation.
