# 影帝 E01 Task 4 C04 宫宴服身份冲突修复报告

状态：`DONE_WITH_CONCERNS`（数据与真实 UI 流程通过；本机无 Playwright 运行时，继续使用项目既有 WebView2 CDP 驱动控制真实 Tauri UI。）

时间：2026-08-29（Asia/Shanghai）

## 问题与结论

C04 的旧包同时引用了：

- 李宝珠整张身份 sheet：脸部清晰，但服装是撕裂、泥污的棺中礼服；
- 李宝珠完整宫宴服候选：干净、完整的绯红宫宴礼服。

连续两次图像生成都被前者的强身份权威带回破损棺服。两张图经 `view_image(..., detail=original)` 目检：宫宴服候选的大头像与原李宝珠身份脸一致，眼睛、脸型、发际线、发髻、凤凰簪均清楚，足以在本镜单独承担身份权威。因此没有裁图、没有新生图，也没有保留冲突整 sheet。

## 新 C04 参考图方案

新包固定为 4 张，顺序合法：

1. `hanyuan-palace-banquet` — `spatial_authority`
2. `li-baozhu-palace-banquet-costume` — `face_identity`，作为李宝珠宫宴时期唯一身份权威，同时锁定完整宫宴礼服
3. `wan-cui-identity` — `face_identity`
4. `osmanthus-wine-cup` — `prop_detail`

李宝珠宫宴服 binding 的 instruction 明确：

- 保持李宝珠脸、眼睛、脸部比例、发际线、发髻、凤凰簪、年龄和不可变身份特征；
- 同时锁定干净、完整、无破损的绯红宫宴礼服、袖口、下摆、凤凰纹、腰带、身体比例和服装结构；
- 禁止重新引入撕裂、泥污的棺中礼服；
- 不复制白底、接触表、多视图、姿态、构图、机位或 blocking。

冲突整 sheet SHA-256 `173cfa038014ddc96679063ff0e8f8801e85866417250f9139ca5799edb60cc3` 已确认不在新包。宫宴身份/礼服候选 SHA-256 为 `0a5c7dca006826cf96b13076451e45fd52deac70c46952bac6079d17e238df10`。

## 真实 Tauri UI 流程

1. 正式打开样片，进入“高级工具 → 生成流水线 → Codex 任务包”。
2. 选择 C04 旧任务并点击“取消任务”；产品 private lifecycle 正式从 `queued` 转为 `cancelled`。
3. 在 C04 参考图控件中删除冲突整 sheet，将宫宴服候选改为合并身份/服装 instruction，保留空间、晚翠和酒杯。
4. 调用 `save_current_project`，同步 snapshot mirror。
5. 完全关闭 Tauri、Vite 和 CDP 端口，重新启动并正式打开样片；C04 的 4 张 binding 从 `project.db` 正确恢复。
6. 只点击一次“导出 Codex 任务包”，由正式 exporter 生成一个新 C04 queued 包。
7. 再次完全关闭/重启并正式打开样片，完成 active、DB、authority、outputs 和门禁验证。

## 旧包与新包 lineage

| 项目 | 旧 C04 | 新 C04 |
|---|---|---|
| Job | `codex-e01-s01-c04-mte5dkcr-9a92b842c37d7e8b` | `codex-e01-s01-c04-mtego2zr-c9e6671ffbb514a2` |
| Request digest | `b25f678bc014b216819f8a1b0859716eac2226afd358944a00f5cad7ae9276bc` | `5a47c94bc107f0d73d1c6b83a90c9b16e9d197889d834975ec73875e549e4eb8` |
| Refs | 5 | 4 |
| Lifecycle latest | `cancelled` | `queued` |
| Outputs | 空 | 空 |

`shot-plan.json` 的 C04 active job/package/requestDigest/referenceAssetIds 已唯一指向新包；旧包非破坏保留于 `supersededCodexJobs`：

- `status=cancelled`
- `reason=superseded_after_palace_costume_identity_conflict`
- `supersededByJobId=codex-e01-s01-c04-mtego2zr-c9e6671ffbb514a2`

Authority export record、ready marker、private lifecycle 和 request digest 全部匹配。样片现有 job 目录总数为 34（原 23 + 参考上限重导 10 + 本次 C04 重导 1）。

## 包与全局验证

- 新 C04 `request.references.length=4`，顺序为 spatial → face → face → prop。
- 每个引用都是包内相对 `inputs/...` 路径，文件摘要与 request 匹配。
- exact `prompt` JSON 与旧 C04 完全相同；镜头事实、人物动作、构图和对白未修改。
- runtime compiled prompt 含 `MANDATORY HARD CONSTRAINTS`、subject count、camera/framing lock，以及禁止棺服回流的合并 instruction。
- 其他 22 镜的 active job/package/requestDigest 全部未变；导出阶段逐项比较通过。
- 23 个 active shotId、jobId、packagePath 仍各自唯一；所有 active 包 refs≤5。
- C01–C03 的既有 candidate/result 均保持不变且 `result.state=completed`；本次没有读取后写回、导入或接受它们。
- 最终只读检查时，C05–C10（C04 除外）也已有既有 completed outputs；这些是外部 Task5 进度，本次未修改其映射或包。
- 新 C04 outputs 为空，没有生成媒体。
- `run-manifest.shotPlanDigest=5cda0b84ab1afadcbf27830b5bc53bcf11e4848bf3ef0f93d25058082a6b6602`，35 个 sourceDigests 逐文件匹配。
- 全部 generatedImagePath/generatedVideoPath 为空，23 镜 videoStatus 仍 blocked。
- `assetReview=pending`、`storyboardReview=blocked`、`videoGeneration=blocked`。
- `selectedVideoWorkflow=DaSiWa_MiniMaxH3Video`，状态仍 `pending_stage_b_gate`。

## Concern

本机没有可用 Playwright 运行时，因此 UI 控制使用项目已有的 WebView2 CDP 驱动。目标始终是真实运行的 Tauri WebView；取消、保存、重开、导出、authority 和 lifecycle 都使用产品正式路径，没有直接改写包，也没有生成/导入/接受媒体。

下一步：独立复审通过后，Task5 只消费 shot-plan 当前唯一 active C04 新包。
