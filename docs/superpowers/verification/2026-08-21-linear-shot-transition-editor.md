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
7. 用户明确授权替换隔离测试浏览器中的当前测试项目后，走正式“项目菜单 → 新建项目”流程，输入 `Task7 Persistence Acceptance` 并普通点击确认；网页模式返回 `创建失败：未创建桌面项目`，未产生可保存的 `.sbproj` 基线。正式“打开项目”可见按钮的普通 click 又被工作区 `panel-header` 截获；改用同一菜单的普通键盘 `Tab` / `Enter` 可进入 `.sbproj` 路径对话框，但仓库中没有可打开的 `.sbproj`，随后普通点击取消。没有绕过桌面能力边界。
8. 在最终顺序 1→3→2 上重新编辑仍存在的 1→3 边：`match_cut`、`1.2s`、`shared_frame`、`frames/TASK7_PERSIST_SHARED.png`，并填写动作延续、人物位置、运镜方向与备注。普通点击“保存转场”仍明确返回 `保存已阻止：请先完成或重新加载当前项目`，因此不能声称桌面项目保存成功。
9. reload 后出现正式“检测到可恢复快照”界面；普通点击“恢复最新”后，UI 报告 `已从自动保存恢复`。恢复态保留顺序“推门→窗边→抬眼”、2 条边、第一边“匹配剪辑 · 1.2s”、`shared_frame`、共享帧路径和全部高级文本；镜头 1 的画面提示 `TASK7_PROMPT_PUSH_DOOR` 也由检查器确认。`negativePrompt` 没有剧本检查器可见字段，不能仅以真实 UI 单独证明，但 import/store 聚合合同覆盖该字段。
10. 进入“成片”并打开高级工具成功；继续点击“打开当前辅助面板”时，已知 `runningHubResult.mjs` 浏览器外部化异常触发错误边界，因此连续性 UI 状态无法继续读取。

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
- 持久化复验 session 在 reload / “恢复最新”后的 fresh console：3 条消息，0 error、0 warning（返回的唯一可见条目为 React DevTools info）。fresh 指标为 viewport/root `1440/1440`、页面横向溢出 0、边标签 `[匹配剪辑 · 1.2s, 连续动作 · 0.6s]`、保存状态 `已从自动保存恢复`。
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

### 网页模式缺少桌面项目基线

用户已明确授权在隔离测试浏览器内新建/替换测试项目，正式提交新建仍返回 `创建失败：未创建桌面项目`。正式打开流程可到达 `.sbproj` 路径对话框，但仓库没有可用基线；普通点击保存返回 `保存已阻止：请先完成或重新加载当前项目`。因此桌面项目的“保存成功 → reload / 打开项目”仍是环境阻塞，不能标记通过。

浏览器自动保存是独立路径：reload 后普通点击“恢复最新”成功恢复最终顺序和转场全部高级字段，状态显示 `已从自动保存恢复`。该结果证明恢复快照保真，不等同于 `.sbproj` 手动保存成功。

另发现项目菜单打开时，可见且启用的“打开项目”普通指针点击被工作区 `panel-header` 截获；键盘 `Tab` / `Enter` 可达。这是可访问但指针命中层叠异常，未使用 force click。
