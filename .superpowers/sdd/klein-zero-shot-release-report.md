# Klein 4B Zero-Shot Release Evidence — 2026-08-09

## Outcome

`production gate remains closed`

The real eight-shot run completed 8/8 model generations with no runtime failures or retries. The report's accepted-shot aggregate was `0.921342` (only one shot was accepted); the arithmetic mean across all eight recorded shot scores was `0.909032`. Seven shots were marked `needs_review` solely because the fixed independent `quality` floor was not met. Face, hair, outfit, and body identity scores remained high. No score, threshold, artifact, or report was edited, and the ineligible report was not imported as a production receipt.

## Runtime and proof

- Hardware: NVIDIA GeForce RTX 5070 Ti, 16 GB VRAM
- ComfyUI Desktop/core: `0.30.2`
- Provider/model: `flux2_klein_4b` / `flux-2-klein-4b-fp8.safetensors`
- Workflow: `examples/character-consistency-benchmark/workflows/flux2-klein-4b-reference-smoke-api.json`
- Terminal output node: `19`
- Workflow digest: `e820879e1050ce1151c20a19a3dddaabefa9b2d15b9a6c6994528633af710ab3`
- Evaluator: `siglip2-character-consistency` `1.0.0`
- Evaluator model: `google/siglip2-base-patch16-224`
- Evaluator model revision: `75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2`
- Evaluator cache: `models/character_evaluators/siglip2-base-patch16-224-75de2d5` relative to the ComfyUI/shared model root
- Evaluator implementation hash: `9f52eb59f4dc5f4279094516508c517e8f0ff32a9e8efe967e20ca530c919674`
- Evaluator policy hash: `828f4a18f06b4d325adc72d48463e67965db2d474c065bfdbe83994b6ad4cfae`
- Character asset: `asset_1774017261433_390`
- Identity pack: `shen-yan-identity-v1`
- Identity metadata digest: `2e79e6bed5f7215b0a3cbc334e638ca8a7fa26293ddcfdef510d2feb7c500524`
- Reference manifest digest: `6e479263ffd7b6519ea63bcc771dddb13c0b2a11df1938c6bca24216ba35b7bd`
- Canonical front SHA-256: `e62096553093ca7942509f458594faf0e4bb59a90d7aec2715268e994e33428a`
- Canonical side SHA-256: `e8174c782354e90f6b26e2eaa8ed49e3cb4bbc3c2beab6b68114cf2d536ad1d9`
- Canonical back SHA-256: `c6db4d8c50068eb68b09b97b38286c224e6b48d33d2ef8c01394ee4104211cf8`
- Report: `logs/character-consistency-benchmark-klein-zero-shot.json`
- Artifacts: `logs/character-consistency-benchmark-klein-zero-shot-artifacts/`
- Started/finished UTC: `2026-08-09T09:20:09.446Z` / `2026-08-09T09:21:02.176Z`
- Wall duration: 52.730 seconds; summed shot duration: 52.509 seconds
- Evidence eligible: `false`; evidence digest: `null`
- Authoritative LoRA bindings: zero

## Command

```powershell
npm.cmd run benchmark:characters -- --mode zero-shot --project examples/character-consistency-benchmark/current-project-klein-release-subject.json --character asset_1774017261433_390 --provider flux2_klein_4b --base-url http://127.0.0.1:8188 --output logs/character-consistency-benchmark-klein-zero-shot.json --workflow examples/character-consistency-benchmark/workflows/flux2-klein-4b-reference-smoke-api.json --output-node 19 --evaluator-module scripts/evaluators/siglip2-character-evaluator.mjs
```

## Per-shot result

| Shot | Status | Score | Face | Hair | Outfit | Body | Quality | Retries | Duration ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| front_close | needs_review | 0.899123 | 0.944599 | 0.936229 | 0.936229 | 0.936229 | 0.710552 | 0 | 16004 |
| three_quarter_medium | accepted | 0.921342 | 0.980859 | 0.973806 | 0.973806 | 0.973806 | 0.633561 | 0 | 6363 |
| left_profile | needs_review | 0.915618 | 0.980941 | 0.973561 | 0.973561 | 0.973561 | 0.598501 | 0 | 4463 |
| right_profile | needs_review | 0.905333 | 0.967168 | 0.963449 | 0.963449 | 0.963449 | 0.593718 | 0 | 4662 |
| back_view | needs_review | 0.910992 | 0.964577 | 0.973903 | 0.973903 | 0.973903 | 0.597027 | 0 | 6041 |
| full_body_action | needs_review | 0.916724 | 0.975780 | 0.967110 | 0.967110 | 0.967110 | 0.683335 | 0 | 6147 |
| strong_expression | needs_review | 0.883165 | 0.933842 | 0.923759 | 0.923759 | 0.923759 | 0.674709 | 0 | 3529 |
| different_lighting | needs_review | 0.919955 | 0.951362 | 0.945474 | 0.945474 | 0.945474 | 0.775675 | 0 | 5300 |

`three_quarter_medium` does not require the `quality` dimension in fixture v1, so it is accepted despite its diagnostic quality score. Every other non-accepted shot failed only `quality`; none failed face, hair, outfit, body, provider proof, artifact integrity, or generation provenance.

## Verification commands

The following all exited 0 after the live run:

```powershell
npm.cmd run test:character-generation-evidence
npm.cmd run test:character-evaluator
npm.cmd run test:character-benchmark
npm.cmd run test:character-providers
npm.cmd run test:sequential-character-passes
npm.cmd run test:character-identity-ui
npm.cmd run test:character-consistency-ui
npm.cmd run build
```

The Vite chunk-size advisory remains non-blocking. The next release candidate should revise and independently review a style-aware quality policy for flat 2D art, or use a fixture/workflow revision that materially improves the actual output quality. It must then generate eight new outputs under a new report path; this report must remain unchanged as failed evidence.
