# MiniMax H3 视频路由验收清单

## 自动验证

- [ ] `npm run test:minimax-h3-presets`
- [ ] `npm run test:workflow-presets`
- [ ] `npm run test:minimax-h3-video-smoke`（默认只做预检，不排队任务）
- [ ] ComfyUI 在线时，smoke 报告 `/system_stats`、`/object_info` 和模型清单均已读取；离线时明确记录 `offline`，不把未知节点伪报为可用。
- [ ] 四个生产 Profile（T2V、I2V、FLF2V、R2V）均通过 conditioning、`CreateVideo`、`SaveVideo`、模型文件、token 和代码引用检查。
- [ ] TE Speed overlay 只标记为 `draft_only`，不得进入生产 preset。

## 人工验收

1. **单角色对白特写**：路由 I2V；身份裁片与首帧、中帧、尾帧人工对照通过。
2. **同场景动作双镜头**：路由 FLF2V；复用获批边界帧，拼接处没有黑帧、冻结或异常跳动。
3. **场景切换**：边界标记为 `scene_change`；保持角色身份，但不生成跨场景变形。

## 生成规则与限制

- 默认 smoke 是非破坏性的，只读取 Comfy 状态、节点信息、模型清单并编译 prompt；不会下载模型或安装节点。
- 只有显式传入 `--generate --first-frame=<Comfy 可见文件名>` 才会排队一个隔离的 124 帧低成本 I2V 样例；不得把 smoke 任务混入生产队列。
- 生成模型无法数学保证“零漂移”。本功能通过约束输入、Profile 路由、共享边界和“未过审不入成片”保证生产流程，不以一次生成成功作为完成标准。

## RunningHub 复杂镜头人工后备（2026-08-20）

### 自动验收

- [x] `npm run test:runninghub-cloud-routing`：本地默认、云端建议、审批摘要和终态回滚均通过。
- [x] `npm run test:runninghub-approval-ui`：固定工作流、两个角色参考、一次性人工确认和模拟端到端状态链均通过；审批前无提交副作用，提示词变更会使摘要失效。
- [x] `npm run test:runninghub-result`：导入结果、RIFE 后处理失败时的主输出恢复和路径/审批绑定均通过。
- [x] `npm run test:video-quality-gate` 与 `npm run test:video-production-schema`：RunningHub 处置或收据变化会 fail-closed 并失效媒体/审批。
- [x] `npm run test:minimax-h3-binding`、`npm run test:video-normalization`、`npm run test:video-continuity-planner`：本地 MiniMax H3 和既有后续流程均通过。

### 样本与人工步骤

- [x] 样本 `短剧示例-从一根木矛开始的文明/视频/MiniMaxH3高动态加速版-preview-20260819.mp4` 的首、中、尾帧已提取并审查；左上角持续有 `RunningHub AI生成`。
- [x] 样本处置记录为 `watermark_review_required`，没有把带水印原件或任何未经验证的候选送入成片路径。
- [ ] 需在可操作的桌面应用会话中，人工确认复杂狼互动镜头的 Lin Yue / Lan 角色表、提示词、`1344x768` 和 `8` 秒，再点击 `确认并打开 RunningHub`。验收环境无该会话，故尚无实际 handoff packet。
- [ ] 如需首次真实云端 `运行`，必须获得用户对该次付费操作的单独确认；自动化不得提交或收费。
