# Unity runtime review — initial implementation

Date: 2026-08-26. Scope: `integrations/unity-previs/` against the approved Unity prototype design. Read-only source review; no Unity process or tests run by this reviewer. Line references describe the initial implementation and may move during fixes.

## Verdicts

- **Spec compliance: changes required.** Core scene construction, local joint hierarchy, boundary reflection, shot-camera rendering, independent masks and unique export directories are present. Missing subject-skeleton validation, source-preserving save/reload and contact editing prevent full compliance.
- **Code quality: changes required.** The main happy path is compact and understandable, but validation accepts an empty scene that breaks the UI, and occlusion metadata can silently report the wrong result.
- **Acceptance evidence remains separate.** Parent reports `PrevisChecks.Run` PASS and `PrevisRenderChecks.Run` PASS (front occluder black in visible mask, white isolated mask; near depth brighter). These are supplied results, not independently rerun. No visual/artifact acceptance or AI acceptance is claimed here.

## Findings

### R1 — P1: validate a subject's complete pose mapping before declaring pose export

`Runtime/PrevisData.cs:34-48`; `Runtime/PrevisExport.cs:44-48`.

Joint IDs and references are checked, but body indices, hand labels/indices, duplicates and required joints are not. A `role="subject"` with empty joints passes validation and exports black body/hand maps as successful `openpose_body18_rgb8` / `openpose_hand21_rgb8`. Duplicate indices make the exporter select only the first joint. Require unique complete body 0..17 and each hand 0..20 for supported humanoid subjects, reject unsupported mappings, and test absent/duplicate/out-of-range mappings. Pure geometry render-test entities can use an environment role.

### R2 — P1: empty scene accepted, then interactive UI fails

`Runtime/PrevisData.cs:26-30`; `Runtime/PrevisApp.cs:20-21`.

An empty entities array satisfies validation and replaces the previous scene. OnGUI then indexes entity zero, causing repeated exceptions instead of a usable empty/error state. Reject empty exchanges before replacement (consistent with this prototype), or implement a fully guarded empty-state UI. Also validate source IDs/digest/revision rather than checking only that the source object exists: the direct JSON-loading path currently accepts missing provenance.

### R3 — P1: saving and reloading loses unknown original-source fields

`Runtime/PrevisApp.cs:27-28`; `Runtime/PrevisScene.cs:39`; `Runtime/PrevisExport.cs:38`.

LoadJson keeps original bytes and Export writes a sidecar, but the separate Save action writes only Capture's typed JSON. Unknown fields disappear, and reloading that saved file replaces OriginalJson with the stripped data. Save a source sidecar too, and restore it explicitly on reopen without confusing it with the edited scene. Add a save/reopen/export test containing an unknown source property.

### R4 — P2: required contact-data editing absent

`Runtime/PrevisApp.cs:24-26`.

The UI exposes root/joint/camera editing and a contact check but no editing of the declared attachment, target point or tolerance. Design section 6 explicitly calls for first-version editing and preflight of generic contact data. Add selected-relation editing, using exchange-space values and preserving them on save. This is not a request for IK.

### R5 — P2: own geometry can hide another entity from occlusion annotation

`Runtime/PrevisPose.cs:31`.

Project only considers the first physics hit. If that hit belongs to the subject (e.g. a nearer arm), an intervening table farther along the same ray but still in front of the target joint is never considered, yielding `occludedByOtherEntity=false`. Query all applicable hits or explicitly ignore the subject's colliders, and filter hits to this stage. Test a ray with subject collider first, other-entity collider second and target joint third. This concerns JSON metadata; visible-mask rendering correctly retains all geometry.

### R6 — P2: malformed nested input can bypass structured validation errors

`Runtime/PrevisData.cs:54-55`.

Earlier loops record null entities/attachments/collections, then relation validation dereferences those same values through predicates. Load stops via an exception, but callers of Validate do not receive the promised error array and diagnostics omit the actual malformed field. Build validated lookup dictionaries or guard nulls throughout the relation pass; reject duplicate/missing attachment IDs as well so contact lookup is unambiguous.

## Additional acceptance gaps and non-findings

- Parent separately identified the required-contact camera-visibility gate and is adding a regression assertion; it was not independently exercised here.
- Current C# roundtrip checks cover reflection involution and camera position, but not rotated parent-joint world positions, camera up/direction, normals, or renamed IDs. These need test/visual evidence before A–C signoff.
- Pose rasterization omits a complete limb if either endpoint is outside the frame. The projected-joints metadata declares joint inclusion policy, but clipping policy should be documented or segments clipped if cropped shots are supported.
- No scene-ID special case was found in runtime geometry/rendering. Fixture-specific data is confined to fixtures.
- Mask mode writes black depth-occluding geometry for other entities; isolation is a separately named output. Control render targets disable MSAA and use linear readback. Depth explicitly maps near to white with camera near/far captured in scene JSON.
- Export creates a unique directory, writes the manifest last, restores camera/renderer/target state in finally, and destroys exported textures. Partial failure does not overwrite a previous valid run. Near/far shader globals are not restored, but no separate active runtime consumer was identified; not treated as a blocking finding.
- Inside checks explicitly describe conservative proxy AABB scope and do not claim arbitrary mesh collision or automatic IK.

## Suggested acceptance after fixes

Run dedicated malformed-input/mapping tests, save-source roundtrip checks, existing CPU/GPU checks, and a targeted multi-hit occlusion test. Then inspect both real fixture render sets for camera framing, finger chains, contact points, occlusion and normal/pose alignment. Keep AI-chain acceptance pending until a separately authorized local generation run and manual review.

## Bounded validation fix follow-up

Implemented by this reviewer only in `Runtime/PrevisData.cs` and new `Editor/PrevisValidationChecks.cs`; other runtime changes remain owned by the parent task. `RunCore()` is callable by the parent's aggregate runner and does not launch or exit Unity.

- Parent confirmed the test-first red run in actual Unity, `Logs/validation-red.log`: `PREVIS VALIDATION: accepted missing body mapping`, before production validation was edited.
- Validation now checks nonempty scenes, safe ASCII identifiers (up to 128 characters), lowercase hex64 provenance digest and nonnegative revision, supported roles, null entries/collections, unique part/attachment/joint IDs, dangling and cyclic joint references, distinct bone endpoints, complete unique body18 and both hand21 mappings for subjects, and normalized rotations. Empty/`none` hand labels are accepted with index -1; non-subject geometry may have no skeleton.
- Explicit prototype caps: positions/offsets/interior coordinates 10,000m per component; scale 100; primitive size 1,000m; bone/joint radius 100m; relation tolerance 10m; far clip 100,000m; 256 entities; 1,024 elements per entity collection; 4,096 relations; existing 16..4096 output dimensions retained. These are validation bounds, not a claim that every maximum-size input is practical to render.
- Regression cases cover malformed nested entries with live relations, missing and duplicate pose mappings, empty scenes, invalid provenance and roles, unsafe identifiers, transform limits, bad camera settings, collection limits, and valid fixture/environment cases.
- Production code and tests are ready for parent-owned aggregate compile/test execution. No green run or visual acceptance is claimed by this follow-up until the parent supplies that evidence.

## Final bounded re-review and observed build evidence

Re-read current `PrevisScene.Save/LoadFile`, contact UI, `PrevisPose.IsOtherEntityOccluded`, the updated renderer and corresponding tests. No runtime code was edited and no Unity process was launched during this re-review.

The reviewer independently read `C:\Users\Administrator\Desktop\小说\应用项目\Unity预演试验-20260826\Logs\verify-build.log` and observed:

| Log line | Evidence |
| --- | --- |
| 265 | `PREVIS_VALIDATION_CHECKS_PASS` |
| 276 | `PREVIS_CHECKS_PASS` |
| 286 | `PREVIS_RENDER_CHECKS_PASS` |
| 2256 | `PREVIS_BUILD_PASS` with the standalone executable path |

These are evidence from the parent's executed aggregate run. The validation implementation is this reviewer's work; independent acceptance of R1/R2/R6 belongs to the parent, not this reviewer.

- **R3 addressed for generated save/run directories:** Save writes edited scene plus untouched source sidecar; LoadFile restores the sidecar. The exercised unknown-property save/reopen regression compares the entire OriginalJson string. Existing sidecars are trusted by directory adjacency; arbitrary external folders with an unrelated sidecar are not lineage-validated.
- **R4 addressed:** the selected subject's generic contact relations expose target-local contact point and tolerance editing and persist via Capture. Attachment/target IDs remain read-only; this is sufficient for first-version contact-point editing, not a full constraint-authoring UI or IK.
- **R5 addressed:** all ray hits are examined; own-entity hits and renderers outside the stage are ignored. The regression explicitly places own geometry before the external occluder.
- Per-entity isolated color/depth/normal passes reuse the same shot camera and restore renderer state. The aggregate GPU test checks that a selected entity's isolated color excludes another entity's red surface. This is not a separate visual alignment acceptance of every output channel.

### R7 — P2: apply edited camera data before preflight projection

Current `Runtime/PrevisScene.cs`, Preflight: the new contact-frame gate projects with the existing Camera transform but does not call ApplyCamera. A caller can load a scene, mutate `stage.Data.camera.target`, and export. Preflight then checks the old view, while Render applies the new view, allowing the out-of-frame contact it was intended to reject. The UI applies camera changes immediately, so its normal path is not affected. Apply the validated camera data at preflight time and extend the camera-away regression to mutate Data after Load, rather than only loading an already-modified fixture. Parent notified.

**Updated spec verdict:** reviewed source-save/contact-editor/multihit fixes satisfy their scoped requirements, with R7 still requiring resolution for the public runtime path. Independent validation acceptance and visual A–C evidence remain parent-owned. **Updated quality verdict:** no further blocker found in those three fixes for the generated-directory UI workflow; stale-camera preflight remains an actionable P2. Full AI-chain acceptance remains unclaimed.
