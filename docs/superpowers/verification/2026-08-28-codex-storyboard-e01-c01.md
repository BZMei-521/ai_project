# Codex 内置生图 E01-C01 任务包交接验证

日期：2026-08-28

状态：候选图已导入为 `needs_review`，尚未接受

分支：`codex/codex-storyboard-task-package`

## 1. 实现版本

本次 live 验证基于以下 Task 1–5 提交：

- Task 1：`9f60f30`、`c4f374e`
- Task 2：`dff14f6`、`454b834`、`64c6836`、`41fca80`、`c414632`、`1942b6e`、`682e273`
- Task 3：`d602578`、`244a5c6`
- Task 4：`8517bf2`、`e5b0312`
- Task 5：`e39b0d8`、`783ae3a`、`cb6aea4`、`21f158b`、`78c3712`、`9eb2574`

验证时 HEAD：`9eb2574`。

## 2. Deterministic preflight

在 `C:\Users\Administrator\Desktop\ai_project\.worktrees\codex-storyboard-task-package` 执行：

| 命令 | 结果 |
| --- | --- |
| `npm run test:codex-storyboard-package` | PASS，退出码 0；该脚本本次没有额外打印显式 PASS 行 |
| `npm run test:codex-storyboard-ui` | PASS，`codex storyboard UI checks passed` |
| `node scripts/check-storyboard-generation-flow.mjs` | PASS |
| `node scripts/check-storyboard-generation-state.mjs` | PASS |
| `cargo test --manifest-path src-tauri/Cargo.toml codex_storyboard -- --nocapture` | PASS，27 passed / 0 failed；Windows rename/symlink 分支按测试设计跳过，另有既存 dead-code warning |
| `npm run build` | PASS；仅出现既存的 Vite `>500 kB` chunk advisory |

Windows workspace sandbox 内的 Node 启动会在 `lstat C:\Users\Administrator` 返回 `EPERM`，因此 Node focused tests 和 build 使用获批的沙箱外本地执行；没有网络调用。

## 3. Live export

- Active media project：`C:\Users\Administrator\.codex\worktrees\aebb\ai_project`
- Shot：`E01-C01`
- Job ID：`codex-e01-c01-mtcxgpxe-7e411f5d615b53b5`
- Package：`C:\Users\Administrator\.codex\worktrees\aebb\ai_project\codex-storyboard-jobs\codex-e01-c01-mtcxgpxe-7e411f5d615b53b5`
- Request：`C:\Users\Administrator\.codex\worktrees\aebb\ai_project\codex-storyboard-jobs\codex-e01-c01-mtcxgpxe-7e411f5d615b53b5\request.json`
- Request SHA-256：`7d6fdfa8773d2f92cc7ee1ae66a40c1c17293686ce807f16207f9f5fcbe2f8c4`
- Inspection manifest：`C:\Users\Administrator\AppData\Local\Temp\codex-storyboard-inspection-dxjm5a\inspection-manifest.json`
- Prompt SHA-256：`4ea53218ea6ac141b222babdc75d302bbf4569ff5bb3d83aab5908cd3dda4ce0`

正式 UI 没有被点击：当时真实 Tauri `current-project.txt` 绑定的是另一个 `.sbproj`，修改该 marker 会干扰用户正在打开的项目。验证没有修改真实 marker。请求由生产 `buildCodexStoryboardPackageRequest` 实际生成，再由一次性 Rust 桥直接复用正式 Tauri command 内相同的 `codex_storyboard.rs::prepare_at_roots` 核心；project root 与 assets root 均为上面的 aebb active project，authority 使用该项目内的私有目录。桥源和临时 request-builder 文件执行后已删除，未进入提交。

导出完成时 `request.json` 存在，`outputs` 为空。导出前已接受路径为：

`C:\Users\Administrator\.codex\worktrees\aebb\ai_project\影帝他总想对我图谋不轨_漫剧改编\分镜\E01-01\f1.png`

其 SHA-256 为 `885154a4887dcdd54b426895b322e7584ec479650d0ae335ab5bb6ab6036bf97`，导出、inspect、complete 和 import 后均未改变。

## 4. Ordered references

| Picture | ID | Usage | Instruction | SHA-256 | Dimensions | Immutable staged path |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `e01-c01-spatial-authority` | `spatial_authority` | Use Picture 1 as the immutable spatial authority for camera, blocking, the complete lying pose, coffin geometry, occlusion, framing, and composition. Do not alter the camera or layout. | `8824abcac767df5ba2cd0caa2b3881daf53d5f7443a83cec9deb7db53cde9e70` | 960×720 | `C:\Users\Administrator\AppData\Local\Temp\codex-storyboard-inspection-dxjm5a\01-e01-c01-spatial-authority.png` |
| 2 | `li-baozhu-body-costume` | `body_costume` | Preserve Li Baozhu's body proportions, damaged crimson ceremonial robe construction, gold embroidery, materials, and accessories; keep the lying pose and composition controlled only by Picture 1. | `2c7472956ceb769e958986428fec8577ac7a057e58da7051ca39de2fc8fbf73c` | 370×610 | `C:\Users\Administrator\AppData\Local\Temp\codex-storyboard-inspection-dxjm5a\02-li-baozhu-body-costume.png` |
| 3 | `li-baozhu-face-identity` | `face_identity` | Preserve Li Baozhu's facial identity, face shape, phoenix eyes, brows, nose-lip proportions, hairline, updo, and phoenix hairpin; keep pose and composition controlled only by Picture 1. | `78fc51a664bab051d88eaa4cfc40dc1ea4ef7ce4d4698f875ab2a9dab1962606` | 380×380 | `C:\Users\Administrator\AppData\Local\Temp\codex-storyboard-inspection-dxjm5a\03-li-baozhu-face-identity.png` |
| 4 | `e01-01-style-anchor` | `style_only` | Use Picture 4 only for refined cinematic Chinese 3D animation rendering language, dark film lighting, palette, material treatment, and finish; it does not control composition, pose, anatomy, coffin geometry, or identity. | `885154a4887dcdd54b426895b322e7584ec479650d0ae335ab5bb6ab6036bf97` | 1672×941 | `C:\Users\Administrator\AppData\Local\Temp\codex-storyboard-inspection-dxjm5a\04-e01-01-style-anchor.png` |

Operator inspect 保留了 Picture 顺序、重复 usage 的通用能力、逐图 instruction、摘要和只读 staged snapshots。本次 baseline 使用四张图。

## 5. Exact final prompt

以下文本来自 inspection manifest，且与 `outputs/result.json.finalPrompt` 逐字一致：

```text
Picture 1 [spatial_authority]: Use Picture 1 as the immutable spatial authority for camera, blocking, the complete lying pose, coffin geometry, occlusion, framing, and composition. Do not alter the camera or layout.
Picture 2 [body_costume]: Preserve Li Baozhu's body proportions, damaged crimson ceremonial robe construction, gold embroidery, materials, and accessories; keep the lying pose and composition controlled only by Picture 1.
Picture 3 [face_identity]: Preserve Li Baozhu's facial identity, face shape, phoenix eyes, brows, nose-lip proportions, hairline, updo, and phoenix hairpin; keep pose and composition controlled only by Picture 1.
Picture 4 [style_only]: Use Picture 4 only for refined cinematic Chinese 3D animation rendering language, dark film lighting, palette, material treatment, and finish; it does not control composition, pose, anatomy, coffin geometry, or identity.
Create one production-ready AI comic-drama storyboard frame.
Project: 影帝他总想对我图谋不轨. Sequence: Episode 1 · Burial Chamber.
Shot 1: Li Baozhu wakes inside the sealed coffin.
Story and action: Li Baozhu jolts awake inside a sealed coffin. She is the only person in frame, wearing a damaged crimson ceremonial robe, with both hands braced against the heavy lid.
Dialogue context: 放我出去！有人吗！
Director notes: One young royal woman lies fully inside a cramped dark wooden coffin, both palms driving upward against the lid. Preserve the verified oblique overhead camera, complete body, both hands, both legs and both feet, credible lid pressure and continuous occlusion.
Shot tags: burial chamber, sealed coffin, oblique overhead, survival pressure.
On-screen character identity: Li Baozhu.
Output framing: 1280x720 at 24 fps continuity.
Cinematic style contract cinematic_3d_donghua_v1@1.0.0: cinematic semi-realistic 3D donghua, premium game-cinematic rendering, mature adult character proportions, refined slightly stylized facial anatomy, readable eyes, modeled nose and lips, detailed hair strands, soft luminous skin, restrained subsurface scattering, physically readable cloth leather metal fur and jewelry materials, cinematic depth of field, soft key light, controlled rim light, coherent character and environment rendering, original fantasy costume design.
Avoid: extra people, missing limbs, extra limbs, fused fingers, broken wrists, standing pose, bed, open room, modern clothing, identity drift, photoreal live action, cartoon outline, plastic game render, live-action photography, documentary photography, Disney, Pixar, western cartoon, chibi, toy-like, juvenile proportions, flat generic 2D anime, manga panels, watercolor, sketches, collage, character-sheet layout, waxy cheap plastic CG, excessive skin smoothing, overexposure, unreadable eyes, deformed anatomy, duplicated characters.
```

## 6. Built-in generation and publication

Codex built-in image generation was called exactly once with all four inspected staged paths, in request order, and the exact compiled prompt. No API、CLI image generator、ComfyUI、watcher、automation or network fallback was used.

- Built-in source：`C:\Users\Administrator\.codex\generated_images\01a04605-055b-7510-a3d7-f8b17ddc13f9\exec-a6ab348f-a8f1-49c9-98f8-3e84717c5362.png`
- Published candidate：`C:\Users\Administrator\.codex\worktrees\aebb\ai_project\codex-storyboard-jobs\codex-e01-c01-mtcxgpxe-7e411f5d615b53b5\outputs\candidate.png`
- Result：`C:\Users\Administrator\.codex\worktrees\aebb\ai_project\codex-storyboard-jobs\codex-e01-c01-mtcxgpxe-7e411f5d615b53b5\outputs\result.json`
- Candidate SHA-256：`12af61bdef6fa41ed1b8353c76141cbf6d39e928dd08314dc3e57e450bc5327c`
- Candidate dimensions/MIME：1672×941，`image/png`
- Generation mode：`codex_builtin_imagegen`
- Result state：`completed`

`complete` 使用同一 inspection manifest 重新验证 request、prompt、四张 reference snapshots 和 candidate，并通过 capability helper 以 candidate 后 result 的顺序无替换发布。Helper JSON 返回的 job、request digest、candidate path 和 result path 均与实际文件一致。

## 7. Import and review-only proof

正式 importer 的 UI 点击同样没有执行，因为真实 Tauri marker 仍绑定其他项目；验证仍未修改 marker。Import request 经生产 `createImportCodexStoryboardResultRequest` 验证，再由一次性 Rust 桥复用正式 command 相同的 `import_at_roots` core。该 core 重新验证 package/authority/ready marker/request/references/result/candidate lineage，写入私有 replay ledger，返回：

- `status = needs_review`
- `candidatePath = \\?\C:\Users\Administrator\.codex\worktrees\aebb\ai_project\codex-storyboard-jobs\codex-e01-c01-mtcxgpxe-7e411f5d615b53b5\outputs\candidate.png`
- `resultPath = \\?\C:\Users\Administrator\.codex\worktrees\aebb\ai_project\codex-storyboard-jobs\codex-e01-c01-mtcxgpxe-7e411f5d615b53b5\outputs\result.json`

真实生产 Zustand store 路径随后消费该 receipt：`upsertGenerationTask` → `markGenerationTaskNeedsReview(..., expectedTransition)`。断言结果：

- task `stage = needs_review`
- task `status = needs_review`
- `bestPreviewPath` 等于 importer 返回的 package candidate path
- shot `generatedImagePath` 仍为 pre-run accepted path `...\分镜\E01-01\f1.png`
- 对 review task 调用普通 `completeGenerationTask` 是 no-op，不能绕过 review gate
- `acceptGenerationTaskCandidate` 未调用

因此本次 live run 没有把候选发布为正式分镜，仍需用户显式审查和接受。

## 8. Visual review notes

对 package 内候选图执行原始分辨率视觉检查：

- Subject count：恰好一名成年女性，无重复人物或多余头部。
- Camera：保持清晰的斜俯视大景别，人物完整位于长方形木棺内部；整体机位和轴线与空间权威接近。
- Coffin：木制棺体、四周高侧壁、底板和人物遮挡关系连贯；但画面中没有棺盖，双掌伸向上方/壁沿，而不是明确顶住沉重棺盖。这是需要人工审查的主要空间叙事偏差。
- Anatomy：头、双臂、双手、双腿和双脚完整；可见双手各五指，腕臂连接连续，未见多余或融合肢体。右臂比例和抬手姿态可读。
- Costume：破损深绯红古装、金色纹饰、腰饰和长袖材质完整，符合 burial variant；脚部浅色厚底鞋较抢眼，略有现代鞋/厚底靴观感，需要审查是否符合既有人设。
- Identity：脸型、凤眼方向、黑色盘发与金色发饰总体接近李宝珠参考，成人比例成立；单张候选不能替代用户对精确五官身份的最终判断。
- Style：暗色电影灯光、半写实中式 3D 动画材质、木材/布料/金属层次统一，无明显真人摄影、卡通描边或拼贴边缘。

自动和本次视觉检查只证明候选可进入人工 review，并不构成接受决定。棺盖缺失和鞋履风格是显式保留的审查项。

## 9. Scope and integrity

- Package candidate 位于 active project 内，不只存在于 Codex generated-images 目录。
- 没有修改或删除任何 Comfy provider setting / workflow JSON。
- 没有新增 API key 字段、OpenAI network client、watcher、automation 或 batch mode。
- 一次性 export/import bridge 和临时 request 文件均已清理且不进入提交。
- 生成媒体、package、authority、inspection snapshots 均不进入代码提交。
- 本提交只包含本验证文档。
