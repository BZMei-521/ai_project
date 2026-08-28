# Codex 内置生图 E01-01-C01 桌面工作流验证

日期：2026-08-28

状态：真实 Tauri 界面已完成导出与导入，候选保持 `needs_review`，未接受、未拒绝

分支：`codex/codex-storyboard-task-package`

Live run 开始时实现 HEAD：`4d4205e1b9a23ab63ffb1730e773c7ea9fe7ff96`。本文件作为后续证据提交，不把自身提交误记为 live run 的实现版本。

## 1. 验证范围

本次验证使用带独立 Tauri identifier 的桌面开发实例，实际点击正式界面的“导出 Codex 任务包”和“检查并导入结果”。隔离项目为：

`C:\Users\Administrator\.codex\worktrees\aebb\ai_project\.superpowers\sdd\codex-ui-live-e01-c01-20260828-v2.sbproj`

该路径不在应用默认工作区列表内，因此先从 WebView 调用正式 `select_workspace_project` Tauri command，使隔离实例的 `current-project.txt` 与界面项目一致。真实用户实例的 marker 验证前后均保持：

`C:\Users\Administrator\Desktop\小说\应用项目\default.sbproj`

桌面启动验证同时确认 `src-tauri/Cargo.toml` 的 `default-run = "storyboard-pro"` 能在多 binary 配置下选择正确的 Tauri 主程序。

## 2. 实际桌面交接

- Shot：`E01-01-C01`（`E01-01 · 01 · 棺中惊醒`）
- Job ID：`codex-e01-01-c01-mtd2vg4n-4e4447cdef6c264e`
- Package：`C:\Users\Administrator\.codex\worktrees\aebb\ai_project\.superpowers\sdd\codex-ui-live-e01-c01-20260828-v2.sbproj\codex-storyboard-jobs\codex-e01-01-c01-mtd2vg4n-4e4447cdef6c264e`
- Request digest：`7d547c733da3465735a2142428e0f983f6864bd8e24488c617f8ca646c65d94f`
- Compiled prompt digest：`f7b3cc951ae14f12e89445f4c1630a62c4e1b63916ed98d260139c082e76d9e6`
- Result digest：`49a6ce7ee6d0f43cd1adec0cf0439a99fdde27c27a618fc7bacc1b0a79303c95`
- Candidate digest：`ccfdb1c7ca71b7db5b4104c18a2b287591557767b61d2ddfb9abe7d28c1518b0`

UI 中填写并冻结的有序参考图如下：

| Picture | Usage | 作用 | SHA-256 | 尺寸 |
| --- | --- | --- | --- | --- |
| 1 | `spatial_authority` | 锁定机位、棺木几何、完整躺姿、遮挡与构图 | `8824abcac767df5ba2cd0caa2b3881daf53d5f7443a83cec9deb7db53cde9e70` | 960×720 |
| 2 | `body_costume` | 只约束李宝珠体态比例、破损绯红礼服、金饰和材质 | `2c7472956ceb769e958986428fec8577ac7a057e58da7051ca39de2fc8fbf73c` | 370×610 |
| 3 | `face_identity` | 只约束脸型、凤眼、五官比例、发型与凤钗 | `78fc51a664bab051d88eaa4cfc40dc1ea4ef7ce4d4698f875ab2a9dab1962606` | 380×380 |
| 4 | `style_only` | 只约束中式半写实 3D、暗色电影光、材质和色盘 | `885154a4887dcdd54b426895b322e7584ec479650d0ae335ab5bb6ab6036bf97` | 1672×941 |

Operator inspect 保留了 Picture 顺序、逐图 usage/instruction 和不可变 staged snapshot。编译提示词在逐图说明后自动加入强制块：单人物、双臂双手与手指可见、空间权威机位锁定、禁止构图漂移、禁止文字与水印。`outputs/result.json.finalPrompt` 与 inspection manifest 的编译提示词逐字一致。

## 3. Codex 内置生图结果

使用四张 inspected staged paths 和原样编译提示词调用 Codex 内置 image generation：

- Codex 原图：`C:\Users\Administrator\.codex\generated_images\01a04605-055b-7510-a3d7-f8b17ddc13f9\exec-d5087626-69ae-42d4-88ca-d10d5f305421.png`
- Package candidate：`C:\Users\Administrator\.codex\worktrees\aebb\ai_project\.superpowers\sdd\codex-ui-live-e01-c01-20260828-v2.sbproj\codex-storyboard-jobs\codex-e01-01-c01-mtd2vg4n-4e4447cdef6c264e\outputs\candidate.png`
- 输出：1672×941，`image/png`
- Generation mode：`codex_builtin_imagegen`
- Result state：`completed`
- Completed at：`2026-08-28T15:02:45.122Z`

`complete` 在发布前重新核验 request、compiled prompt、四张 reference snapshots 与候选 PNG，并以不可覆盖方式写入 candidate 和 result。

## 4. Review gate 证据

点击正式 UI 的“检查并导入结果”后：

- 界面历史项显示 `needs_review`；
- 界面显示“接受候选图”和“拒绝候选图”按钮；
- “检查并导入结果”变为禁用；
- `outputs/import-receipt.json.status = needs_review`；
- 私有 lifecycle 仅有 `queued`（version 0）→ `needs_review`（version 1）；
- 没有 `accepted`、`rejected` 或 `cancelled` lifecycle 记录；
- 本次没有点击接受或拒绝。

请求为 review gate 冻结的 `acceptedImagePath` 字段是 `assets/codex-live-refs/04-style.png`，SHA-256 为 `885154a4887dcdd54b426895b322e7584ec479650d0ae335ab5bb6ab6036bf97`；这不等同于声称磁盘 `snapshot.json` 的 shot 路径已被改写。候选 SHA-256 不同，且该摘要没有出现在 package 外的项目 PNG 中；结合私有 lifecycle 与 receipt，可证明本次导入没有发布候选或替换持久化分镜。

## 5. 视觉检查

优点：

- 恰好一名成年女性，没有重复人物、文字或水印；
- 双臂、双手与十指清晰，未见融合、缺失或多余肢体；
- 李宝珠的脸型、发型、凤钗、破损绯红礼服与金饰保持良好；
- 黑暗棺内压迫感、木材、布料和金属的中式半写实 3D 质感完成度较高。

需要人工审查的问题：

- 候选明显继承了 Picture 4 的近景正俯构图，没有遵守 Picture 1 的斜俯全身空间权威；全腿、双脚及完整棺体没有进入画面；
- 提示词要求 1920×1080，但 Codex 实际返回 1672×941；宽高比接近 16:9，像素尺寸不相等；
- 双掌悬在棺盖下方，情绪成立，但“向上顶压棺盖”的受力接触仍不够明确。

因此这张图适合作为效果候选，但不应自动接受。它也说明“多参考图 + usage 标注”能稳定身份、服装和风格，却不能保证模型严格服从空间参考优先级；需要在后续方案中考虑降低 style reference 的构图吸引力、裁剪风格图，或增加生成后空间一致性审查与重试。

## 6. 最终自动验证

| 命令 | 结果 |
| --- | --- |
| `npm run test:codex-storyboard-package` | PASS，任务包契约、provider、inspect/complete、并发与恢复检查通过 |
| `npm run test:codex-storyboard-bridge` | PASS，桌面持久边界与 `default-run` 回归检查通过 |
| `npm run test:codex-storyboard-ui` | PASS |
| `node scripts/check-storyboard-generation-flow.mjs` | PASS |
| `node scripts/check-storyboard-generation-state.mjs` | PASS |
| `cargo test --offline --manifest-path src-tauri/Cargo.toml codex_storyboard -- --nocapture` | PASS，30 passed / 0 failed；Windows 目录替换分支按测试设计跳过 |
| `cargo test --offline --manifest-path src-tauri/Cargo.toml --bin codex-storyboard-operator` | PASS，3 passed / 0 failed |
| `npx tsc -b` | PASS |
| `npm run build` | PASS；仅有既存 Vite `>500 kB` chunk advisory |

Windows workspace sandbox 内 Node 对用户目录 realpath 会返回 `EPERM`，因此 Node、npm 与 Rust 验证使用获批的沙箱外本地执行；全程没有调用 ComfyUI、API key、watcher 或网络回退。
