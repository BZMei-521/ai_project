# RunningHub 复杂镜头路由验收

日期：2026-08-20

## 可复现性与未生成的收据

- 分支：`codex/minimax-h3-video-routing-wipbase`
- 精确 HEAD：`e1ebf0baba50c702adafc3efae8fb41fb37d06dc`
- handoff packet / handoff receipt：`none generated`
- RunningHub 导入 receipt / task ID：`none generated`
- 水印修复候选 / repair receipt：`none generated`

## 范围与安全边界

RunningHub 仅是复杂镜头的人工、审批后备路径；MiniMax H3 本地生成仍是默认路径。此验收没有调用 RunningHub API、没有打开任意自定义工作流、没有点击 `运行`，也没有产生付费提交。允许的固定工作流仍只有 `2090035427871903746`（`https://www.runninghub.cn/workflow/2090035427871903746?source=workspace`）。在 RunningHub 提供有文档的自定义工作流提交契约之前，任意 API 自动提交保持禁用；这是一项明确的人工后备限制，不是隐藏失败。

## 模拟端到端生命周期

`scripts/check-runninghub-approval-ui.mjs` 新增了一个只在进程内执行的模拟提交边界。它使用真实的审批摘要、状态机和结果分类契约，但不接触浏览器、网络或云端任务。

- 实际覆盖顺序：`local_default -> cloud_recommended -> awaiting_approval -> approved -> submitted -> running -> recovered_primary_output -> watermark_checked -> quality_review -> accepted`。`running` 是持久化状态机在 `submitted` 和恢复主输出之间所要求的轮询中间态。
- `awaiting_approval` 状态下调用 `recordRunningHubSubmission` 抛出 `runninghub_state_transition_invalid`，且模拟提交计数保持 `0`。
- 提示词改为 `Changed wolf interaction prompt.` 后，原审批摘要返回 `approval_input_changed`。
- 通过审批后模拟边界仅观察到一次提交；带 RIFE 后处理故障签名的有效 MP4 被分类为 `recovered_primary_output`。
- `accepted` 为终态；尝试 `POLL_RUNNING` 回滚被 `cloud_state_terminal` 拒绝。

### TDD 证据

先运行了反向的 RED 断言（错误地要求审批前已有一次提交），获得如下真实失败：

```text
AssertionError [ERR_ASSERTION]: RED: submission must not occur before approval
0 !== 1
```

随后将断言改为规范要求的 `0`，并补全审批后到终态的模拟生命周期。GREEN：

```text
npm run test:runninghub-approval-ui
PASS RunningHub approval UI and exact-workflow handoff contracts
```

## 聚焦验证

受限 Node 环境在加载脚本前会报 `EPERM: operation not permitted, lstat 'C:\\Users\\Administrator'`；以下本地、无网络命令在获准的根执行环境中完成，全部退出码为 0：

```text
npm run test:runninghub-cloud-routing
PASS RunningHub cloud recommendation and approval contracts

npm run test:runninghub-approval-ui
PASS RunningHub approval UI and exact-workflow handoff contracts

npm run test:runninghub-result
runninghub result checks passed

npm run test:video-quality-gate
PASS video quality gate: fail-closed receipts, bound decisions, controller, interactions, and rebuild scope

npm run test:video-production-schema
PASS video production schema: legacy migration, single-flight desktop sync, import, update, serialization, and reload

npm run test:minimax-h3-binding
PASS minimax h3 binding

npm run test:video-normalization
PASS video normalization contract

npm run test:video-continuity-planner
PASS video continuity planner
```

## 真实水印样本

输入：`短剧示例-从一根木矛开始的文明/视频/MiniMaxH3高动态加速版-preview-20260819.mp4`（`ffprobe` 时长 `8.020000` 秒）。

提取的只读审查帧位于新的任务派生目录：

- `output/runninghub-task-7-watermark-sample-20260820/source-first.jpg`
- `output/runninghub-task-7-watermark-sample-20260820/source-middle.jpg`
- `output/runninghub-task-7-watermark-sample-20260820/source-last.jpg`

首、中、尾三帧的左上角都清楚保留 `RunningHub AI生成` 文字。没有可用的商业安全水印修复 worker，因此没有产生或声称产生修复候选、修复收据或 `clean` 处置；不存在可接受的导入输出。结论：`watermark_review_required`。原文件保持未改动，不能进入归一化、质量审批或成片路径。

## 人工交接

人工交接未执行：此验收环境没有可操作的桌面应用会话可选择“复杂狼互动”镜头并按下 `确认并打开 RunningHub`，因此没有可以诚实记录的面板截图、handoff packet 或浏览器页面。未打开固定工作流，未点击 `运行`，未提交任务，未收费。

待具备人工会话时，操作者应确认面板为 Lin Yue 和 Lan 两张角色表、复杂狼互动提示词、`1344x768`、`8` 秒；点击确认后仅验证固定 URL 打开且应用没有点击 `运行`，然后停止。任何首次真实 `运行` 点击仍需用户单独确认。

## 结论

自动化审批、状态机、导入恢复和质量门禁契约均已通过；真实样本明确被水印门禁阻断。未产生 RunningHub 任务 ID、导入收据或交接 packet，因为没有云端提交或手动交接。
