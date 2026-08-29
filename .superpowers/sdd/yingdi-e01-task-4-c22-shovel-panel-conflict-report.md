# 影帝 E01 Task 4 C22 短铲—凤凰暗板接触冲突修复报告

状态：`DONE_WITH_CONCERNS`（真实 UI 上游修复、重导和验证均通过；产品的镜头 Prompt 编辑区只渲染前 12 镜，C22 无正式 Prompt 控件，因此核心 Prompt 保持零 diff，非接触澄清放入正式凤凰暗板 binding instruction。）

时间：2026-08-29（Asia/Shanghai）

## 四次 rejected 目检与根因

读取并以 `view_image(..., detail=original)` 检查：

| 轮次 | 原图 | 结果 |
|---|---|---|
| R1 | `C:\Users\Administrator\.codex\generated_images\01a04d8a-f6d0-7fd0-b417-e8caec46028d\exec-56ca7ba7-6629-4e3a-ba24-d81112945844.png` | 凤凰暗板正确，但短铲刃紧贴/压住暗板边缘。 |
| R2 | `C:\Users\Administrator\.codex\generated_images\01a04d8a-f6d0-7fd0-b417-e8caec46028d\exec-95655e30-5d2c-4e79-84ef-f22d60a3b032.png` | 暗板被重绘、融合成棺侧凤凰饰板；短铲仍作为前景主道具。 |
| R3 | `C:\Users\Administrator\.codex\generated_images\01a04d8a-f6d0-7fd0-b417-e8caec46028d\exec-7d96ea77-a548-41b6-8ed0-83ceaa37b37c.png` | 独立暗板恢复，但铲刃明显压在暗板凤凰纹上。 |
| R4 | `C:\Users\Administrator\.codex\generated_images\01a04d8a-f6d0-7fd0-b417-e8caec46028d\exec-78fddeb2-0bdd-4a42-9ce2-342c9fa533fc.png` | 暗板恢复，铲刃仍接触暗板中心。 |

根因不是随机种子：旧 active 包同时把短铲与凤凰暗板作为高显著 `prop_detail` 参考；核心画面 Prompt 又多次出现“右手持短铲”“眼神转向短铲”和 `Props: grave-robbing-shovel, phoenix-pattern-panel`。模型因此把两件剧情道具压入同一视觉交互区；中文“不接触暗板”的弱否定连续四次都没有压过双重显著性。

## 最小修复

通过真实 Tauri UI 将 C22 bindings 从 5 张收敛到 4 张：

1. `tomb-chamber-exterior` — `spatial_authority`
2. `li-baozhu-identity` — `face_identity`，兼顾既有破损棺服
3. `wei-xun-identity` — `face_identity`
4. `phoenix-pattern-panel` — `prop_detail`

删除：`grave-robbing-shovel`，SHA-256 `fdb8843b58f01ccf739ed4c55a19c70327b6c1a704399fb6810210514e39eea6`。新包已确认完全不含该 SHA。

凤凰暗板 binding instruction 最小加强为：暗板整面必须完整可见、无遮挡；任何工具、铲刃、手或其他物体均不得接触、重叠、覆盖、指向或合成到暗板上。它仍只控制暗板结构、材质和状态，不控制构图、姿态或身份。

## Prompt diff

核心 shot/image Prompt：**无修改，byte-identical**。

- 旧 `request.prompt` 与新 `request.prompt` JSON 完全相同。
- `actionStart`、`actionEnd`、对白、characters、props、镜头构图、camera 和 hard constraints 均未变。
- 原因：真实产品“镜头状态”编辑区的 `visibleShots` 固定 `scopedShots.slice(0, 12)`；C22 没有正式 Prompt textarea。没有绕过 UI 直接改 store/DB。
- 非接触澄清仅进入用户明确要求可编辑的正式 reference binding instruction，并由 exporter 编译进最终 prompt；这比改剧本事实更小。

## 真实 Tauri UI 流程

1. 正式打开样片并进入 Codex 任务包面板。
2. 选择旧 C22 active task，点击“取消任务”；private lifecycle 正式转为 `cancelled`。
3. 在 reference UI 中移除短铲，保留四张必要权威，并编辑凤凰暗板 instruction。
4. 调用 `save_current_project` 并同步 snapshot mirror。
5. 完全关闭 Tauri/Vite/CDP，重新启动并正式打开样片；4 张 bindings 与 instruction 从 `project.db` 正确恢复。
6. 只点击一次“导出 Codex 任务包”，正式 exporter 生成唯一新 C22 queued 包。
7. 再次完全关闭/重启并正式打开样片，全量验证 active、authority、outputs、source digests 与视频门禁。

## 旧包 → 新包 lineage

| 项目 | 旧 C22 active | 新 C22 active |
|---|---|---|
| Job | `codex-e01-s01-c22-mteehrjs-7cb54fbc597aa6d1` | `codex-e01-s01-c22-mtejmi62-78ffd6e33cfe94f3` |
| Request digest | `3fcfff3474468fa2a8521a4cca43f570de4ec72693fbb56a6bf390bfb858cff5` | `dc11572e711b6d4c51cb2155c2d6394b1c0e1d085b3070398fc225b9b5179663` |
| Refs | 5 | 4 |
| Lifecycle | `cancelled` | `queued` |
| Outputs | 空 | 空 |

`shot-plan.json` 已追加：

- `status=cancelled`
- `reason=superseded_after_shovel_panel_contact_conflict`
- `supersededByJobId=codex-e01-s01-c22-mtejmi62-78ffd6e33cfe94f3`

新 C22 job/package/requestDigest/referenceAssetIds 唯一 active；旧 C22 历史包和更早 ref-cap superseded 包均非破坏保留。Authority export record、ready marker、private lifecycle 与 digest 全部匹配。

## 验证

- 新包 refs=4，顺序 `spatial → face → face → prop`。
- 每张 reference 都是包内 `inputs/...` 相对路径，文件 SHA-256 与 request 匹配。
- 新包不含 short-shovel SHA，保留 phoenix-panel SHA `3ef6581d0f8d66abdb7c732186f9a9d020350e0a238bdf50c9c1044f262fdb04`。
- compiled prompt 含 `MANDATORY HARD CONSTRAINTS`、subject count、camera/framing lock 和暗板完整无遮挡/无接触 instruction。
- 其他 22 个 active job/package/requestDigest 均未变；导出前后逐项比较通过。
- 23 个 active shotId、jobId、packagePath 各自唯一；所有 active refs≤5。
- 最终只读验证时，其余 22 active 包均已有 `candidate.png` + `result.json`，且 `result.state=completed`；本次没有修改、导入或接受这些结果。用户任务开始时是 21 个 completed，期间外部 Task5 完成了 C23。
- 新 C22 outputs 为空；未生成、导入或接受媒体。
- 样片 job 目录共 35：原 23 + ref-cap 重导 10 + C04 重导 1 + 本次 C22 重导 1。
- `run-manifest.shotPlanDigest=dff0fa80714235fdaade966f326552e98dd45cfac55685e149f56592f7339fc2`。
- 35 个 sourceDigests 逐文件重算匹配。
- 全部 `generatedImagePath` / `generatedVideoPath` 为空；23 镜 `videoStatus=blocked`。
- `assetReview=pending`、`storyboardReview=blocked`、`videoGeneration=blocked`。
- `selectedVideoWorkflow=DaSiWa_MiniMaxH3Video`，`selectedVideoWorkflowState=pending_stage_b_gate`。

## Concerns

1. 本机无 Playwright runtime，继续使用项目既有 WebView2 CDP 驱动控制真实 Tauri UI；取消、绑定编辑、保存、重启和正式导出均走产品路径。
2. 产品镜头参数编辑区只渲染前 12 镜，C22 无正式 Prompt 控件。本次没有绕过该限制；核心 Prompt 零 diff，澄清放在正式 prop binding instruction。建议另行修复 UI 的 `slice(0, 12)` 可编辑性，但不属于本次投产修复范围。

下一步：等待独立复审通过后，Task5 只消费 shot-plan 当前唯一 active C22 新包；不得在本 Task 生成媒体。
