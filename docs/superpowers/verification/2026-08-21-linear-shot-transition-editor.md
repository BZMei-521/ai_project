# 线性镜头转场编辑器验证记录

- 日期：2026-08-21
- 环境：Windows，Node.js 22.16.0，Vite 5.4.21，Chromium（Playwright CLI wrapper）
- 开发地址：`http://127.0.0.1:5174/`（5173 已被另一进程占用，未触碰）
- 范围：Task 7 聚合门禁、1440×900 / 1024×768 / 390×844 真实浏览器验收、构建状态

## 自动化门禁

| 命令 | Exit | 结果 |
| --- | ---: | --- |
| `npm run test:script-transitions`（添加脚本前） | 1 | 有效 RED：`Missing script: "test:script-transitions"`。 |
| `npm run test:script-transitions` | 0 | 6/6 PASS：model、import、store、components、integration、continuity planner。 |
| `npm run test:director-desk` | 0 | 6/6 PASS。 |
| `npx tsc -p tsconfig.app.json --noEmit` | 0 | 无 TypeScript 错误。 |
| `git diff --check -- package.json scripts/check-script-transition-components.mjs scripts/check-script-transition-integration.mjs docs/superpowers/verification/2026-08-21-linear-shot-transition-editor.md` | 0 | Task 7 owned 文件无空白错误。 |
| `git diff --check` | 1 | 被范围外既有内容阻塞：`docs/storyboard-workflows-20260304.md:3`、`:5` 两处 trailing whitespace；未修改该文件。 |
| `npm run build` | 1 | TypeScript 阶段通过，Vite 在已知 RunningHub 浏览器外部化问题处失败，见“阻塞项”。 |

首次在受限沙箱内运行聚合命令时，Node 对 `C:\Users\Administrator` 的 `lstat` 返回 `EPERM`；按批准权限在正常 Windows 用户上下文重跑后得到上表中的正式结果。

## 真实浏览器交互

所有交互均通过 Playwright CLI wrapper 完成，使用普通 click、native select/fill、pointer drag 和 keyboard press；没有 force click。

1. 普通点击“剧本”，普通点击可见“导入 JSON 镜头剧本”标签打开 file chooser，导入 3-shot JSON（无 `transitions`）。界面显示 3 个节点和 2 条“连续动作 · 0.6s”默认边。
2. 选择第一条边，改为“匹配剪辑”，展开高级参数，填写共享匹配帧 `frames/task7-shared.png`、动作延续、人物位置、运镜方向和备注；边标签立即更新为“匹配剪辑 · 0.6s”。
3. 用普通 pointer drag 把镜头 3 拖到镜头 1 与镜头 2 之间。顺序变为 1→3→2，两条新边均为“连续动作 · 0.6s”，旧的已编辑 1→2 边不再活动。
4. 焦点在移动后的镜头选择按钮时，使用 `Tab`、`Tab`、`Enter` 激活“向后移动”按钮，顺序恢复 1→2→3，证明键盘排序替代路径可用。
5. 导入非法 JSON 后，错误摘要以 `role="alert"` 呈现并获得焦点，显示“文件不是合法 JSON”；项目仍保持 3 个镜头和 2 条边。
6. 三个视口均普通点击关闭并重新打开检查器；节点链保持可横向滚动，检查器内容可滚动，页面根节点没有意外横向溢出。
7. “保存转场”普通点击被当前网页模式项目基线明确拒绝：`保存已阻止：请先完成或重新加载当前项目`。随后走正式“项目菜单 → 新建项目”流程到名称对话框，但创建/替换项目属于后果性状态变更，执行权限未获用户明确授权，故取消对话框；本轮没有绕过，保存后 reload 持久化标记为未验收。
8. 进入“成片”并打开高级工具成功；继续点击“打开当前辅助面板”时，已知 `runningHubResult.mjs` 浏览器外部化异常触发错误边界，因此连续性 UI 状态无法继续读取。

## 视口与布局指标

| 视口 | 页面 `scrollWidth` | 页面横向溢出 | 镜头链 client/scroll | 检查器 | 结果 |
| --- | ---: | ---: | --- | --- | --- |
| 1440×900 | 1440 | 0 | 横向链可滚动 | `left=1190, right=1440, top=62, bottom=900` | 桌面并列检查器；关闭/重开正常。 |
| 1024×768 | 1024 | 0 | 770 / 1088，`overflow-x:auto` | `left=664, right=1024, top=62, bottom=768`；706 / 824，`overflow-y:auto` | 紧凑抽屉，无水平裁切控件。 |
| 390×844 | 390 | 0 | 338 / 1088，`overflow-x:auto` | `left=0, right=390, top=181.2, bottom=772`；底部留 72px 导航；590 / 823，`overflow-y:auto` | 现有底部检查器，无水平裁切控件；可见触控目标最小 44×44。 |

初次移动端实测发现触控尺寸缺口：导入标签为约 149.5×38，六个排序按钮为约 39.1×44，未达到批准规格的 44×44。针对该真实缺口的组件 CSS 合同先进入 RED；Task 4 owner 在 `5589fad` 中修复生产 CSS。fresh reload 后重新量测：`undersizedTargets=[]`，导入标签与全部六个排序按钮的最小可见目标为 44×44；组件合同恢复 GREEN，并已覆盖移动截图。

## 截图

- `output/playwright/script-transitions-1440x900.png`
- `output/playwright/script-transitions-1024x768.png`
- `output/playwright/script-transitions-390x844.png`

三张截图均已人工查看；桌面为并列检查器，1024 为右侧抽屉，390 为底部检查器。

## Console

- 普通剧本编辑流程：唯一 error 是缺失 `favicon.ico` 的 404，无 warning。
- 打开成片辅助面板后：React error boundary 捕获 RunningHub 模块异常；精确堆栈指向 `src/modules/video-production/runningHubResult.mjs:4:157`。

## 阻塞项

### 已知、范围外的 RunningHub 构建/成片阻塞

`npm run build` 在 548 个模块转换后失败：

```text
src/modules/video-production/runningHubResult.mjs (4:9):
"spawnSync" is not exported by "__vite-browser-external"
import { spawnSync } from "node:child_process";
```

真实浏览器打开成片辅助面板时同一模块报错：

```text
Module "node:child_process" has been externalized for browser compatibility.
Cannot access "node:child_process.spawnSync" in client code.
```

该阻塞在批准计划中已列为既知范围外问题；本任务未修改任何 RunningHub 文件。转场聚合套件和独立 TypeScript 门禁保持通过。

### 等待用户授权的持久化验收

当前网页模式默认项目没有可手动保存基线；正式新建/替换项目需要用户明确授权。未获授权前，无法诚实声称“保存 → reload 后顺序与高级参数保持”已通过。
