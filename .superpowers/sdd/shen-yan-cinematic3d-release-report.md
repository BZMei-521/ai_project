# Shen Yan cinematic 3D release evidence

Date: 2026-08-09
Status: RELEASE GATE ACCEPTED AND IMPORTED

## Release subject

- Character asset: `asset_1774017261433_390`
- Identity pack: `shen-yan-hybrid-v5`
- Species: `human`; `speciesTraits: []`
- Style contract: `cinematic_3d_donghua_v1` version `1.0.0`
- Style contract digest: `27db8be0b246c9b931217e24caffc9606c0959b035f7a0d9714ed0c058828b88`
- Provider/model: `flux2_klein_4b` / `flux-2-klein-4b-fp8.safetensors`
- Mode: `zero_shot_multi_reference`; authoritative LoRA bindings: 0

Only characters explicitly marked as beastfolk may receive animal traits. Shen Yan is explicitly human, and visual review found no animal ears, tail, horns, or muzzle. The canonical references are generated identity assets, not screenshots from unrelated media.

## Canonical references

| View | SHA-256 | Bound identity slots |
| --- | --- | --- |
| Front | `bb93213df418213e41cb1206e397056cbb45e34ed446274307f531f658713043` | `face_master`, `body_front`, `expression_neutral` |
| Side | `2a0ed3ef0dd1ce290f2f66d1f558d754d37a1e239b092c3189a431bf7ba2b861` | `face_left`, `face_right`, `body_side` |
| Back | `2abafd0d96d0beb77441760a37872f367f4f3af0fcea4721176a313bd0a76195` | `hair_back`, `body_back` |

Trusted eight-slot reference manifest digest: `e49d062b6688deabdf0b5567e43c1a8b0191985d15ca693faba2d7412e761289`.

## Release benchmark

- Report: `logs/character-consistency-benchmark-klein-cinematic3d-zero-shot-quality-v4.json`
- Artifacts: `logs/character-consistency-benchmark-klein-cinematic3d-zero-shot-quality-v4-artifacts/`
- Result: 8 accepted, 0 review, 0 failed, 0 cancelled, 0 retries
- Aggregate score: `0.948297`
- Source report evidence digest: `72e97696826412ccc8b5bfa5ac7d6e274ae59909b83e17144f64addb5660408c`
- Workflow digest: `e820879e1050ce1151c20a19a3dddaabefa9b2d15b9a6c6994528633af710ab3`
- Fixture digest: `48fe813b546ec15cdaac58d8e9e550c3c2ffad53009d7fa8bad9c0274841b72d`
- Generation-parameters digest: `7c15b5fab4b5827c14589c3b684422177c12c52f637f4f2178e08e9db2d849d1`

| Shot | Score | Quality | Output SHA-256 |
| --- | ---: | ---: | --- |
| `front_close` | 0.944065 | 0.943114 | `72f6f6fc19906c2dcbb5303be0ca4aa7df10f7c493981625b2eb56e63a036050` |
| `three_quarter_medium` | 0.963745 | 0.936725 | `00abc3b02d098e038a472bbe7aa96c04a2704a9a5aaae1f670d5c8c570c70dd6` |
| `left_profile` | 0.931120 | 0.934682 | `658fbb578d0ad9350ed01a71379bbe01d7c6dad3b0a2110eab7f9cdef003ddb2` |
| `right_profile` | 0.920146 | 0.827497 | `5eb22c64bbb178e620ae09ab2361c831c67893ce7ed25ff8d6ffd8dbbb5d0376` |
| `back_view` | 0.947817 | 0.834029 | `1219edbad39228c02b7adf15efe9ddab6ae56323600aa10b2281ec7b8cc1022c` |
| `full_body_action` | 0.969760 | 0.935845 | `d56c8538e43c3c29efe479ed43aa71f3c00d802994f6793641b085a717fc17d6` |
| `strong_expression` | 0.945439 | 0.948654 | `933dffee64741741ce25dd7365814a7269be40225852e7f3f9f344ec483e429f` |
| `different_lighting` | 0.964286 | 0.932435 | `593687ef7b2f0724e36b099d6b6eee181bfbfe265307df748e9219683f2a3692` |

Visual QA confirmed consistent mature male face, short dark-brown layered hair, blue eyes, teal tunic, navy long coat, belt and boots across all views. The natural outputs have no sharpen halos. The corrected right-profile eight-slot binding was reviewed separately and is directionally correct.

## Evaluator and remediation audit

- Evaluator: `siglip2-character-consistency` version `1.0.0`
- Snapshot: `google/siglip2-base-patch16-224` revision `75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2`
- Implementation hash: `928799e00d8f1af139caa01be76fe750416c710711c432940a151c2f7072571e`
- Policy hash: `828f4a18f06b4d325adc72d48463e67965db2d474c065bfdbe83994b6ad4cfae`
- Dimension threshold: `0.72`

The first natural run was blocked by a full-frame edge-variance heuristic that penalized cinematic depth of field. A sharpened diagnostic run passed numerically but was visually rejected for halos/noise and was not imported. The quality metric was replaced with a center-subject gradient/detail/clipping/entropy calculation and regression-tested against clean, blurred, and aggressively sharpened fixtures. v3 then passed on the untouched natural bytes, but import exposed a seven-slot reference-manifest defect. The benchmark/attestor reference binding was corrected to all eight desktop identity slots, and v4 was regenerated and accepted. Failed/intermediate reports remain audit-only.

## Trusted import and production resolution

- Receipt registry: `%APPDATA%\StoryboardProWeb\character-evidence\receipts`
- Receipt ID: `921fe6bb5dcc8db5e9a273cf0f021334275533b7eae89245ffd52ee558f5903b`
- Stored evidence digest: `b1c4620823a79c339b98cbf4962d3f2fcb573a1deda01e9135340f76a928bf79`
- Generated project copy: `examples/character-consistency-benchmark/current-project-klein-release-subject-cinematic3d-evidence.json`
- Resolver: `zero_shot_multi_reference`, provider `flux2_klein_4b`, model `flux-2-klein-4b-fp8.safetensors`, `appliedLora: null`

The backend re-read and rehashed the three canonical reference files and all eight output artifacts, reran the pinned evaluator, and registered the receipt before import. Stored evidence and its registry receipt both revalidated. A copied context with an altered `face_master` hash returned `reference_manifest_mismatch`; the real reference files and imported evidence were never modified.

Generated reports, images, the machine-specific project export, and private receipt registry entries are intentionally not committed.
