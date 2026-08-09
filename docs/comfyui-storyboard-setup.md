# ComfyUI Storyboard Setup

## 角色一致性证据回执（生产门禁）

角色基准报告中的 `evidenceDigest` 只是公开可重算的内容摘要，不能单独解锁生产生成。报告必须在桌面应用中导入：后端重新读取 runner 保存的 8 个输出和身份参考图，核对同一字节的 SHA-256，并使用固定版本 SigLIP2 重评；全部结果与报告一致后，才在应用私有数据目录原子写入 receipt registry 并返回回执。

- runner 必须使用固定 evaluator，并保留报告旁的 `*-artifacts` 目录；不要在导入前移动或编辑报告、输出或身份参考图。
- Windows Web Bridge 与 Tauri 都验证 registry 回执；普通浏览器、后端不可用、未知回执或旧版无 `identityMetadataDigest` 的证据一律只供审计，不能进入生产轨道。
- Tauri 使用当前设置中的 `comfyRootDir`，调用该 ComfyUI 安装的 `.venv` Python 与应用打包的固定 attestor/worker；缺少固定模型快照时签发失败并保持门禁关闭。
- 修改身份版本、触发词、固定特征、禁改项、参考图、模型、工作流、模式、LoRA 或 evaluator 后，必须重新跑基准并导入新回执。

The desktop panel scans the configured ComfyUI root and endpoint. The default endpoint is `http://127.0.0.1:8188`. Comfy Desktop may keep model files in a shared model root such as `C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models`; the scanner accepts either that directory or the ComfyUI checkout. It checks `checkpoints`, `vae`, `controlnet`, `ipadapter`, `clip_vision`, `diffusion_models`, `loras`, `clip`, `text_encoders`, `unet`, and custom node packages.

## Workflow IDs

* `storyboard-qwen-stageA`: built-in Qwen Stage A preset.
* `storyboard-qwen-stageB`: Qwen image-edit Stage B preset.
* `storyboard-zimage-turbo`: current stock Z-Image-Turbo text-to-image fallback.
* `storyboard-single-pass-fallback`: stock storyboard-composer fallback.

Required model filenames and node types are extracted from the selected JSON preset and checked against local files plus `/object_info`. A workflow is not reported ready when the endpoint is offline or any required model, node, token, or scan path is unresolved. The panel shows the scan timestamp and next actionable fix.

## Smoke test

```powershell
node scripts/run-storyboard-smoke-test.mjs --base-url http://127.0.0.1:8188 --comfy-root "C:\Users\Administrator\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models" --workflow-id storyboard-zimage-turbo --shot-script examples/river-dialogue-5s/river_dialogue_5s_shot_script.json --dry-run
```

The command prints JSON. Exit `2` means ComfyUI is offline; exit `3` means the script, preset, model files, or output mapping is missing; exit `0` means the preflight passed (and, without `--dry-run`, an image was found in history and mapped to the example shot ID). Dry-run never calls `/prompt` and therefore cannot modify ComfyUI.

## Installation boundary

Before downloading anything, run the dry-run and inspect every `missing_model`, `missing_node`, and `missing_path` diagnostic. Install only the selected workflow's files into the existing ComfyUI directories above, preserving files already present. Install custom nodes through the ComfyUI manager or an approved local package process, then rescan `/object_info`. Runtime code intentionally contains no external download URLs.

## Character LoRA dataset export and training

Prepare one character at a time. The exporter requires a project-backup JSON, a character asset with a complete identity pack, and a reviewed manifest. `approvedImages` is the only training-image allowlist: it must have 15--30 unique files from the declared `sourceRoots`, cover front/profile/back and close/medium/full-body views, and use only `front`, `three_quarter`, `profile`, or `back` plus `close`, `medium`, or `full_body`. Each caption is made only from the identity trigger and the manifest's declared visible immutable traits; incidental background styling is not carried into a caption.

Start from [lora-dataset.example.json](../examples/character-consistency-benchmark/lora-dataset.example.json), replace its placeholders with the asset's actual version and immutable traits, and run:

```powershell
npm run export:character-lora-dataset -- --project path\to\project_backup.json --character character-asset-id --manifest path\to\lora-dataset.json --output .tmp\character-lora-dataset
```

The target output must be a new directory: the exporter rejects an existing target, path traversal, source-root escapes, unapproved generated frames, and mismatched identity versions. It never deletes or overwrites source images. Its deterministic output includes copied files and `dataset/metadata.jsonl`, alongside commercial-compatible Qwen and Klein training configurations; it does not select Klein 9B or any Dev/noncommercial provider. Treat an output as complete only when `dataset/.character-lora-complete.json` is present; it is written last after the exclusive no-replace publication finishes.

Use DiffSynth-Studio for the `Qwen/Qwen-Image-Edit-2511` configuration. It enables CPU offload and uses rank 16, batch size 1, gradient accumulation 4, 768 resolution, and seed `20260808`. This is the normal 16GB desktop inference baseline on the NVIDIA GeForce RTX 5070 Ti.

Use AI Toolkit for the `black-forest-labs/FLUX.2-klein-base-4B` configuration. Its rank is 16 with batch size 1, 768 resolution, 1800 steps, and seed `20260808`. Klein training requires a separate host with at least 24GB VRAM; after training, its exported LoRA may be used again for inference on the 16GB desktop.

After training, copy the resulting `.safetensors` filename, provider, trigger word, identity/LoRA version, and selected checkpoint step into the character's `CharacterLoraProfile`. Do not change its status to `ready` until Task 10's eight-shot character-consistency regression has passed; use `dataset_ready` or `training` until then.

## Eight-shot commercial-provider benchmark

The checked-in eight-shot fixture is [benchmark.json](../examples/character-consistency-benchmark/benchmark.json). It is deliberately fixed to front-close, three-quarter, left/right profile, back, full-body action, strong expression, and changed-lighting shots; do not add, remove, or reorder shots when comparing providers. The static contract check needs no running ComfyUI:

```powershell
npm run test:character-benchmark
```

For Qwen-Image-Edit-2511, install `qwen_image_edit_2511_bf16.safetensors` in `models\diffusion_models` and confirm `TextEncodeQwenImageEdit` appears in Desktop's `/object_info`. For FLUX.2 Klein 4B, install `flux-2-klein-4b-fp8.safetensors` in `models\diffusion_models` and confirm `ReferenceLatent`, `CFGGuider`, and `Flux2Scheduler` appear in `/object_info`. These are the exact filenames and nodes used by the provider preflight for the official distilled image-edit graph. ComfyUI Desktop stable can lag the core/nightly release or custom-node versions needed to expose those nodes; update or install the approved node package, then re-run the preflight rather than bypassing it.

Start Desktop and run an evidence-bearing provider preflight/benchmark with the project backup that owns the selected character. Choose one mode explicitly: `--mode zero-shot` uses only the immutable identity references and must have no authoritative LoRA binding; `--mode lora` requires the candidate LoRA declared by the project and proves that its loader reaches the selected terminal output. The provider-specific workflow JSON must retain the tokens required by its mode. Both modes require `{{PROMPT}}`, `{{SEED}}`, `{{CHARACTER_ASSET_ID}}`, `{{CAMERA_YAW}}`, `{{SHOT_SCALE}}`, and `{{EXPECTED_VIEW}}`; LoRA mode additionally requires `{{ACTIVE_LORA_NAME}}` and `{{ACTIVE_LORA_STRENGTH}}`.

```powershell
npm run benchmark:characters -- --mode zero-shot --project path\to\project-backup.json --character character-asset-id --provider flux2_klein_4b --base-url http://127.0.0.1:8188 --workflow examples\character-consistency-benchmark\workflows\flux2-klein-4b-reference-smoke-api.json --output-node 19 --evaluator-module scripts\evaluators\siglip2-character-evaluator.mjs --output logs\klein-4b-zero-shot-benchmark.json
npm run benchmark:characters -- --mode lora --project path\to\project-backup.json --character character-asset-id --provider qwen_image_edit_2511 --base-url http://127.0.0.1:8188 --workflow path\to\qwen-2511-character-lora-workflow.json --output-node save-node-id --evaluator-module scripts\evaluators\siglip2-character-evaluator.mjs --output logs\qwen-2511-lora-benchmark.json
```

Before contacting Desktop, the runner parses the API-format workflow and proves the selected provider with a terminal-bound authoritative loader/node check. The exact Qwen/Klein loader and every required provider node must be reachable backward from the selected `SaveImage`; disconnected decoys, link cycles, missing links, and conflicting provider loaders fail. It rejects unresolved or unknown tokens, missing `{{PROMPT}}`/`{{SEED}}`/character or fixture-declared angle tokens, and any workflow without exactly one `SaveImage` terminal. If a valid workflow has several `SaveImage` nodes, pass `--output-node <node-id>`; history is read only from that exact terminal, never from the first arbitrary image.

The runner probes `/system_stats` and `/object_info`, queues one shot at a time through `/prompt`, and reads `/history/{prompt_id}` with cancellation and per-request/shot deadlines. It understands Comfy history `status_str`, `completed`, and structured error messages; a completed terminal without its selected image fails immediately. It always writes a new JSON report, including setup, offline/preflight, cancellation, and incomplete-run outcomes; it refuses to overwrite an existing report. Report artifacts retain only validated same-origin Comfy `/view?filename=&subfolder=&type=` URLs (or validated filename/subfolder/type objects); diagnostics are redacted separately. Use a timestamped name such as `logs\character-consistency-benchmark-20260808T120000Z.json` for an archival run. A shot is accepted only with proven terminal output, proof-derived actual provider, `model_generation` provenance, a finite passing score, and every required dimension score; otherwise it is `needs_review`, never a successful generation. Cutout or fallback previews can only be recorded as review/failure evidence. Aggregate status precedence is `cancelled`, then `failed`, then `needs_review`, then `accepted`; exit 0 requires all eight shots accepted.

Live CLI runs require `--evaluator-module` pointing to an explicit local ESM file under this project root. The production evaluator uses the offline snapshot `google/siglip2-base-patch16-224` at revision `75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2`, cached at `models\character_evaluators\siglip2-base-patch16-224-75de2d5` relative to the ComfyUI/shared model root; changing its snapshot, policy, or implementation invalidates earlier evidence. URLs, package names, missing exports, and paths escaping the trusted root fail before `/prompt`. `--project` is optional for ordinary diagnostic reports but required for readiness evidence. Its real path must remain under the project root and contain exactly one matching character with a complete identity pack. LoRA mode additionally requires a non-ready candidate LoRA (`dataset_ready` or `training`) matching the selected provider/model; zero-shot mode rejects authoritative LoRA bindings. The evaluator receives only the verified identity context and immutable reference snapshots. Evidence eligibility requires eight accepted shots and complete evaluator/workflow proofs; LoRA mode also requires the exact LoRA loader binding to reach the selected terminal generator/sampler. Disconnected decoys, conditioning/text side branches, wrong output indexes, conflicting path LoRAs, absent required loaders, and mismatched filenames fail closed. The report's deterministic evidence digest excludes timestamps, endpoint URLs, and unknown/secret fields.

Qwen is the default commercial production baseline for the NVIDIA GeForce RTX 5070 Ti 16GB. Klein 4B is the sole local FLUX.2 commercial-production candidate. Klein 9B and every Dev/noncommercial variant are excluded from commercial production and are rejected by the benchmark allowlist.

### Evidence import, badges, and invalidation

Keep the report and its sibling `*-artifacts` directory unchanged. Import an accepted zero-shot report from the character identity panel; the desktop backend rehashes all eight outputs and the canonical front/side/back references, reruns the pinned SigLIP2 evaluator, and writes a private receipt only when the recomputed result is identical. A report digest by itself is audit metadata and cannot unlock production.

The zero-shot badge means that the selected identity pack, references, Klein model, workflow, and evaluator were verified without a LoRA. The LoRA badge means a separate eight-shot run verified the named LoRA and its terminal model binding. Neither badge implies the other. Editing shared identity metadata or any reference byte invalidates both tracks. Editing a track's model, provider, workflow, mode, or evaluator invalidates that track; a LoRA-only change invalidates only the LoRA track and does not erase otherwise valid zero-shot evidence. A changed reference must surface `reference_manifest_mismatch`; do not manually restore a badge.

Use bounded remediation based on recorded failure dimensions: mirror the recorded side reference for a failed profile direction, use the recorded head-and-shoulders crop for close/expression failures, and strengthen explicit limb/motion wording for an action failure. Save every rerun under a new report filename and version the changed fixture or workflow. Do not edit scores, reuse earlier outputs, substitute fallback/cutout images, or mark an asset ready manually. A visual smoke test is useful for diagnosis but is never release evidence.

The live Klein run on 2026-08-09 completed all eight model generations with strong identity similarity but failed the fixed `quality` floor on seven flat 2D outputs. Its aggregate status is `needs_review`, so no receipt was imported and the production gate remains closed. See `.superpowers/sdd/klein-zero-shot-release-report.md` for the exact evidence.

## Verification record (2026-08-07)

The current ComfyUI Desktop endpoint is online (0.30.2). The shared model root contains the Z-Image-Turbo diffusion model, Qwen 3.4B text encoder, and AE VAE. The old Qwen 2511 stage A/B files and custom node remain absent.

The machine-readable inventory is [comfyui-storyboard-dependency-manifest.json](comfyui-storyboard-dependency-manifest.json). Its `installed` values are based only on the scanner's local file inventory; `sourceUrl` is `null` where no authoritative, exact source was available during this run. Re-run the scanner after starting ComfyUI and after any approved installation, then update the manifest checksums from the resulting files.

The live smoke test passed for `storyboard-zimage-turbo`; the example shot was generated as `Storyboard/河边远景开场_zimage_00001_.png`.
