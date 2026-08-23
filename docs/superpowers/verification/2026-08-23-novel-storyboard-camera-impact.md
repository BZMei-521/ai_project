# Novel Storyboard 镜头语言与打击呈现验证

日期：2026-08-23  
项目源：`.agents/skills/novel-storyboard`  
全局部署：`C:\Users\Administrator\.codex\skills\novel-storyboard`

## 结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 项目 quick_validate | PASS | exit 0 |
| 项目完整自测 | PASS | `✓ 238 项自测全部通过` |
| 全局 quick_validate | PASS | exit 0 |
| 全局完整自测 | PASS | `✓ 238 项自测全部通过` |
| `test:script-transitions` | PASS | model、import、store、components、integration、continuity planner 共 6 项 PASS |
| `test:video-continuity-planner` | PASS | `PASS video continuity planner` |
| 项目 / 全局 SHA-256 | PASS | 项目拥有 12 个文件，缺失 0，哈希不一致 0 |
| 全局非项目资产保留 | PASS | `README.md`、`README.en.md`、`assets/` 均存在 |

首次运行聚合回归时，当前恢复 worktree 没有 `node_modules`，前两项通过后在 React 解析处停止；按现有 `package-lock` 执行 `npm install --ignore-scripts --no-audit --no-fund` 后重新运行，全部通过，未修改锁文件。

## 契约覆盖

- 旧 storyboard 没有 `cameraPlan` 时仍合法；H3 `CAMERA_MOVES` 官方枚举未改变。
- `cameraPlan` 校验镜头目的、路径、速度、幅度、主体关系、稳定方式、前景遮挡与首尾景别。
- 只有导入动作含 `impactEvidence` 时才要求 `impactPresentation`。
- 打击呈现要求接触加至少一种受力反馈，重叠镜头 0–2 段，禁止整段发力慢放。
- Markdown、HTML、H3 `prompt.md` 与 manifest 都保留镜头计划和打击呈现。
- 项目 selftest 在缺少项目内上游示例时会回退到已部署全局 sibling skill 夹具，项目源可独立执行。

## 部署边界

只同步项目源拥有的 `SKILL.md`、`references/`、`scripts/`、`examples/`、`agents/`。未删除、未覆盖全局专有 README 和 assets。
