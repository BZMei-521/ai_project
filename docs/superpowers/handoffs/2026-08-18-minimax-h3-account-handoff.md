# MiniMax H3 视频路由与连续性工程交接

更新时间：2026-08-18（Asia/Shanghai）

## 1. 交接目的

这份文档用于在更换 Codex 账号或新开会话后，无需依赖原聊天上下文，继续完成 MiniMax H3 本地视频生成工程。

当前结论：实施计划共有 9 个任务，Task 1–8 已完成并经独立复审判定 `CLEAN / CLEAN`；Task 9 尚未开始，是下一步唯一的计划任务。Task 9 完成后还要做一次全分支验证和最终代码审查。

## 2. 工作区与 Git 状态

- 工作区：`C:\Users\Administrator\Desktop\ai_project`
- 当前分支：`codex/minimax-h3-video-routing-wipbase`
- 当前 HEAD：`7b73694c7027a740dda0b2a25c45a259561bfe82`
- 当前 HEAD 标题：`fix: prevent stale video prepare reclamation`
- 文档生成时工作区约有 374 条 dirty/untracked 状态；这个数字只是 2026-08-18 的快照，不是清理或验收基线。新会话应把实际 `git status --short` 中的所有既有内容视为受保护对象。
- 当前 Git index 在最后一次提交后为空。

### 必须遵守的工作区保护规则

1. 禁止运行 `git reset --hard`、`git checkout -- .`、`git clean`、整仓恢复或整仓格式化。
2. 禁止 `git add -A`、`git add .` 或整文件暂存共享脏文件。
3. 修改 `package.json`、`main.rs`、`desktopBridge.ts`、`ComfyPipelinePanel.tsx`、`comfyService.ts`、`store.ts`、`types.ts`、`global.css` 等共享文件时，只能精确暂存本任务 hunk。
4. 不要删除未跟踪文件；只有能够证明是本轮任务自己生成的临时 patch、bundle 或测试目录，才可精确删除。
5. 不要回退或覆盖其他代理、用户或历史任务的修改。
6. PowerShell 下使用 `npm.cmd`，避免 `npm.ps1` 被 ExecutionPolicy 拦截。

开始工作前先执行只读检查：

```powershell
Set-Location 'C:\Users\Administrator\Desktop\ai_project'
git branch --show-current
git rev-parse HEAD
git status --short
git diff --cached --stat
```

在 Task 9 开始前，预期分支和 HEAD 必须与上面一致；如果不一致，先报告，不要自行 reset 或切换。Task 9 正常产生新提交后，HEAD 当然会前进，不再要求等于 `7b73694`。

## 3. 用户已经确定的产品方向

- 云端接入暂缓，但保留扩展口；当前实现以本地 ComfyUI 为主。
- 使用本地 ComfyUI 的 MiniMax H3 工作流，根据镜头条件自动选择不同工作流。
- 支持并区分：T2V、I2V、FLF2V（首尾帧）和 R2V（参考图视频）。
- TE Speed 只允许草稿预览，production 使用标准质量路径。
- 360° 等距矩形全景是明确需要的能力；六面天空盒不再作为主要方案。
- 最终目标不是“能生成就算完成”，而是：视频流畅、无明显拼接感，人物身份、服装道具和场景锚点保持一致。
- 连续边界必须使用获批尾帧或独立 match-cut shared frame；未过质量门的片段不得进入成片。
- 角色生成可直接读取以下文件中的图片、描述和其他设定：
  `C:\Users\Administrator\Desktop\ai_project\短剧示例-从一根木矛开始的文明\角色设定\report.html`
- 用户的本地工作流资料目录：`C:\Users\Administrator\Desktop\工作流`
- 参考工具目录：`C:\Users\Administrator\AppData\Local\灰豆AI光影引擎`

## 4. 权威规格、计划和任务资料

必须先完整读取：

1. 规格：`docs/superpowers/specs/2026-08-17-ai-director-panorama-workflow-design.md`
2. 实施计划：`docs/superpowers/plans/2026-08-17-minimax-h3-video-routing-continuity.md`
3. 进度总账：`.superpowers/sdd/progress.md`
4. Task 9 完整任务包：`.superpowers/sdd/minimax-h3-task-9-brief.md`
5. Task 8 最终实现报告：`.superpowers/sdd/minimax-h3-task-8-report.md`
6. Task 8 最终独立复审：`.superpowers/sdd/minimax-h3-task-8-review.md`
7. Task 7 最终实现报告：`.superpowers/sdd/minimax-h3-task-7-report.md`
8. Task 7 最终独立复审：`.superpowers/sdd/minimax-h3-task-7-review.md`

不要只看聊天摘要；以上本地文件是恢复工程状态的权威来源。

## 5. 已完成任务与提交

| 任务 | 状态 | 提交 | 主要结果 |
|---|---|---|---|
| Task 1 | CLEAN | `5a7cadc`, `dcbce09`, `96fb7c7`, `acc6f4a` | 四种确定性 MiniMax H3 API preset、精确模型/节点/token/长度契约 |
| Task 2 | CLEAN | `25201f9`, `bd75b61`, `afe764d` | 四个生产 profile、标准/TE Speed 预检、能力注册 |
| Task 3 | CLEAN | `9e2b844`, `9c4b8f2`, `c56c8a5`, `b2b19f2`, `0485473` | Shot 视频生产字段、迁移、持久化、桌面 snapshot 单飞与防误写 |
| Task 4 | CLEAN | `25bb2ef`, `81bd2bd` | 手动覆盖、身份安全、参考图、边界和可用性优先级路由 |
| Task 5 | CLEAN | `325bb01`, `2fe2128`, `34b0251` | 真实 H3 执行绑定、canonical workflow、queued attestation、严格 receipt |
| Task 6 | CLEAN | `56bc203`, `d8c9a76`, `2cdb95f` | continuous/match-cut/scene-change 计划、依赖、失效传播、审批防绕过 |
| Task 7 | CLEAN | `69a9e62`, `e1a6370`, `890d1ec`, `0853da6`, `fc5dea0`, `c0a1763` | 24fps 规范化、逐帧审核、后端签名 authority、崩溃恢复、安全拼接、assembly receipt |
| Task 8 | CLEAN | `8b0f13c`, `2739acf`, `104bfea`, `ea4253b`, `62f150c`, `7b73694` | 真实 routed 单/批生成、live inventory、质量门、首中尾帧审核、CAS、双镜原子重建、人工批准/驳回 |

Task 8 最终复审明确为：`Spec CLEAN / Code CLEAN`。

### Task 8 最后关闭的关键竞态

- 新生成的 `generatedVideoPath` 会保留，只清理旧 evidence/status。
- 初次、单镜、批量、重试和驳回重建都统一进入 Task 5 routed gateway；generic video 分支对质量门生产不可达。
- incoming continuous 使用新鲜后端验证的前镜尾帧；incoming match-cut 使用独立获批 shared frame；outgoing 边界不作为当前首帧。
- operation token、canonical request digest、sequence/shot identity 和 Comfy settings identity 参与 CAS。
- 旧 Comfy baseURL 请求即便成功晚到，也会被单调 epoch 丢弃，不会覆盖新证据。
- 双镜第二成员失败不会留下第一成员的 active/retained Task 7 run，也不会部分发布新媒体。
- 后端严格校验 normalization credential、review frame 角色/路径/hash、assembly receipt 关联。

## 6. 当前验证基线

Task 8 收口时以下验证通过：

- `npm.cmd run test:video-quality-gate`
- `npm.cmd run test:video-production-schema`
- MiniMax H3 preset/profile/router/binding checks
- Task 6 continuity planner
- Task 7 normalization contract
- Rust `video_continuity` 全模块
- 8-thread run-ledger 并发测试连续 5 次通过
- `npm.cmd run build`

构建只有既有的大 chunk advisory，不是失败。

## 7. 下一步：Task 9

Task 9 尚未实施。完整任务文本已抽取到：

`.superpowers/sdd/minimax-h3-task-9-brief.md`

Task 9 的范围：

1. 扩展静态 workflow preset 审计，把四个 H3 preset 设为 core，检查 conditioning、`CreateVideo`、`SaveVideo`、模型 token 和代码引用。
2. 新建非破坏性 smoke：默认只请求 `/system_stats`、`/object_info`、模型清单、模板编译和 prompt payload 验证。
3. 只有显式传入 `--generate` 才允许排队一个 124 帧低成本 I2V 样例；不得自动下载模型或安装节点。切换账号后的新会话不要擅自运行 `--generate`，先做默认非破坏性 smoke，并向用户确认实际生成。
4. 新建验证清单 `docs/superpowers/verification/minimax-h3-video-routing-checklist.md`。
5. 记录三类人工验收：单角色对白特写、同场景连续双镜、场景切换。
6. 明确限制：生成模型不能数学保证零漂移；工程保证来自输入约束、profile 路由、共享边界和“未过审不入成片”。

计划要求的主要文件：

- 新建 `scripts/run-minimax-h3-video-smoke.mjs`
- 修改 `scripts/check-workflow-presets.mjs`
- 修改 `package.json`
- 新建 `docs/superpowers/verification/minimax-h3-video-routing-checklist.md`

### Task 9 建议执行协议

继续使用 subagent-driven development：

1. 新的 implementer 完整读取 Task 9 brief、TDD 和 verification skill。
2. 先写 RED，再做最小 GREEN。
3. implementer 只精确提交 Task 9 文件/hunk。
4. 生成 review package。
5. 使用独立 reviewer 复审；发现必须同一轮修复并复审，直到 `CLEAN / CLEAN`。
6. Task 9 完成后，读取 `requesting-code-review` 和 `finishing-a-development-branch` skill，做全分支最终审查和交付选项。

### Task 9 全套验证命令

在 PowerShell 中运行：

```powershell
npm.cmd run test:minimax-h3-presets
node scripts/check-minimax-h3-profile-registry.mjs
node scripts/check-video-production-schema.mjs
node scripts/check-video-workflow-router.mjs
node scripts/check-minimax-h3-binding.mjs
node scripts/check-video-continuity-planner.mjs
node scripts/check-video-normalization-contract.mjs
node scripts/check-video-quality-gate.mjs
npm.cmd run test:workflow-presets
npm.cmd run build
cargo check --manifest-path src-tauri/Cargo.toml
node scripts/run-minimax-h3-video-smoke.mjs
```

如果本地 ComfyUI 没有运行，默认 smoke 应清楚报告离线/不可用，而不能误报成功。不要为让测试通过而自动启动、下载或安装。

Task 9 实施时还必须明确 smoke 的 ComfyUI URL 来源、超时、离线退出语义、成功判据和报告保存位置。`--generate` 还必须明确输入图、隔离输出目录、队列失败/取消清理和资源确认；如果 Task 9 brief 或现有配置不能唯一确定这些值，先询问用户，不要猜测。

## 8. Task 9 之后的最终收口

1. `.superpowers/sdd/progress.md` 已补录 Task 8；Task 9 完成后再记录 Task 9 的最终状态和提交，不要重写已完成任务历史。
2. 运行上面的全验证矩阵，保存新鲜证据。
3. 对从 Task 1 基线到最终 HEAD 的净 diff 做一次独立跨任务审查，重点检查：
   - 旧项目打开/保存兼容性；
   - 图片生成路径未回归；
   - generic/legacy video 不得绕过 H3 质量门；
   - receipt、review frame 和 assembly output 的后端身份绑定；
   - continuous/match-cut 边界和双镜失败原子性；
   - dirty shared files 是否仍有必须提交但遗漏的 H3 hunk。
4. 不要把当前约 374 条用户 dirty/untracked 状态整体提交。只提交能够精确归属本工程的遗漏 hunk。
5. 最终向用户报告哪些功能已经生产可用、哪些人工验收尚需真实素材执行，以及模型无法保证绝对零漂移的限制。

Task 9 的 brief/report/review package 建议继续使用既有命名规则：`.superpowers/sdd/minimax-h3-task-9-brief.md`、`minimax-h3-task-9-report.md`、`minimax-h3-task-9-review-package*.diff` 和 `minimax-h3-task-9-review.md`。

## 9. 新账号恢复提示词

在新 Codex 会话中，将工作区打开到 `C:\Users\Administrator\Desktop\ai_project`，然后发送下面这段：

```text
请继续 MiniMax H3 视频路由与连续性工程。

第一步不要修改任何文件，也不要清理工作区。请完整读取：
C:\Users\Administrator\Desktop\ai_project\docs\superpowers\handoffs\2026-08-18-minimax-h3-account-handoff.md

然后按文档执行只读 Git 校验，确认分支为 codex/minimax-h3-video-routing-wipbase、HEAD 为 7b73694c7027a740dda0b2a25c45a259561bfe82，并完整读取文档列出的 spec、plan、progress、Task 9 brief、Task 7/8 report 和 review。

使用 subagent-driven-development 和严格 TDD 从 Task 9 开始。保留当前所有用户 dirty/untracked 文件；禁止 reset、checkout、clean、git add -A 或整文件暂存共享脏文件。默认只运行非破坏性 smoke，不要擅自使用 --generate，不要自动下载模型或安装节点。

Task 9 完成后必须独立复审到 CLEAN/CLEAN，再运行全验证矩阵和跨任务最终审查。请先用一段简短摘要告诉我你恢复到的状态，再开始实施。
```

## 10. 人工快速读法

如果想自己在 PowerShell 中打开交接文档：

```powershell
Set-Location 'C:\Users\Administrator\Desktop\ai_project'
Get-Content -Raw '.\docs\superpowers\handoffs\2026-08-18-minimax-h3-account-handoff.md'
```

也可以直接用 VS Code：

```powershell
code '.\docs\superpowers\handoffs\2026-08-18-minimax-h3-account-handoff.md'
```

新账号不需要粘贴旧聊天记录；只需让新会话完整读取本文件及第 4 节列出的权威文件。
