# 影帝 E01 Task 4 参考图上限修复与正式重导报告

状态：`DONE_WITH_CONCERNS`（投产数据与真实 UI 流程均通过；唯一 concern 是本机未安装 Playwright 运行时，因此复用了项目既有 WebView2 CDP 驱动控制真实 Tauri UI。）

时间：2026-08-29（Asia/Shanghai）

## 结果

- 修复了 built-in imagegen `referenced_image_paths <= 5` 的上游冲突。
- 仅处理原先超限的 10 镜：C03、C09、C10、C17、C18、C19、C20、C21、C22、C23。
- 真实 Tauri UI 中逐镜选择旧任务并点击“取消任务”；10 个旧任务的私有 lifecycle 最新状态均为 `cancelled`。
- 通过真实 Tauri UI 修改参考图、调用 `save_current_project`，完全关闭应用后重启并正式打开样片，确认 10 镜绑定从 `project.db` 往返恢复。
- 重启后的真实 Tauri UI 仅点击 10 次“导出 Codex 任务包”；10 个新任务均由正式 exporter 生成，私有 lifecycle 为 `queued`，authority export record、ready marker、request digest 全部匹配。
- 再次完整关闭/重启并正式打开样片后，全量验证 23 个 active 映射唯一；C01 为既有 `completed` result、其余 22 个 active 任务为 `queued`。
- 未生成、导入或接受任何新媒体；未触发视频。

## 真实 UI 证据

1. Tauri dev app 启动于 Vite `5173`，WebView2 CDP `9338`；自动化先用命令面板“打开项目”，填入样片路径，再进入“高级工具 → 生成流水线 → Codex 任务包”。
2. Prepare 阶段：10 个旧任务逐一由 UI 取消，参考图控件逐一收敛为 3–5 张；调用产品 `save_current_project`，并通过产品 `write_base64_file` 同步 snapshot mirror。
3. 第一次完整重启：正式重开返回 `projectId=yingdi-e01-sample`、`shotCount=23`、`taskCount=23`，证明取消状态和绑定已从数据库恢复。
4. Export 阶段：只导出 10 镜；随后保存数据库与 snapshot，投产 shot-plan/run 通过 Tauri 命令更新。
5. 第二次完整重启：正式重开返回 `shotCount=23`、`taskCount=33`（23 原任务 + 10 新任务），受影响镜均为一条旧 cancelled + 一条新 queued。
6. 最终验证后，10 镜 `referenceAssetIds` 也通过 Tauri 命令同步为 active 包的真实列表，run `shotPlanDigest` 重算为 `40d5099a97b762e32636925b7d4d866c9f8a7280a3dd2fbb24f1e0d5b51aa3ce`。

生命周期写入在本机约需 17 秒，原 15 秒 UI 等待窗发生一次超时；实际动作随后成功。诊断确认任务已正确选中且取消按钮可用，等待窗改为 60 秒后其余操作全部成功；没有绕过产品 lifecycle。

## 10 镜旧包 → 新包

| 镜头 | refs | 旧 job / digest | 新 job / digest |
|---|---:|---|---|
| C03 | 6→4 | `codex-e01-s01-c03-mte5dij9-c7a936a36bbc4c28`<br>`1ce61b29f7cf9f6ac417d8ff71cd8cb683b2ad0f8d3538ef7ab43b1597bd6b69` | `codex-e01-s01-c03-mteegih7-076e86bd64355c5f`<br>`cc3c092a4b5f50c2e59e4e403588a7828156310bfa586daeb886743462d8d15f` |
| C09 | 7→4 | `codex-e01-s01-c09-mte5ds5b-3972f5f4074b455b`<br>`37cbfd3ea1e9fcab61615b95e7ac922396deeee22b0bb533f0fedb51dc28305d` | `codex-e01-s01-c09-mteehej1-fe526db7f6c28b70`<br>`ba36bc2cb55deeb1f4962f7e7d060459a370f88e97b7a446526d33daef3f6efe` |
| C10 | 6→4 | `codex-e01-s01-c10-mte5du6l-3fd05d54a1ee68d0`<br>`50862f44add672c90d51914e2de19c061c8caf7f99028273923e8ae261ccbf24` | `codex-e01-s01-c10-mteehhc1-eef0996491a4fbeb`<br>`937ed0e6072759d9bd6c4958faad6fdf357892e5cff053d9b1a27435483f72ed` |
| C17 | 6→3 | `codex-e01-s01-c17-mte5e4q4-d546b8ba5ad19c21`<br>`982f12d511cf2fbd67cf80bd2f8cb1912e975d1b1806edf26426f18ecfe6a7b6` | `codex-e01-s01-c17-mteehix4-c5223c6fc5608184`<br>`00417a0d015b42ae81b8bc43eac6e2cf4139327cea7644c4aa805e84b1e616e0` |
| C18 | 8→5 | `codex-e01-s01-c18-mte5e6kn-b63e58e11abf1a2a`<br>`28300a620ddd3df34377f62b1eb209277831182d41a50430001f0979c533c93e` | `codex-e01-s01-c18-mteehkeb-b26ace44d960ad3e`<br>`a70449761e7a05deb428717e0628163b627f3032d594fd89a3234bdf38675420` |
| C19 | 6→4 | `codex-e01-s01-c19-mte5e8t8-c7983cf0fd7905d1`<br>`2609491c81ff6811f3285e3f1b23c2b350402b8dacf341f79dd9afcd40944d18` | `codex-e01-s01-c19-mteehm93-7e64492c444c5b00`<br>`9f1ce83976681b94bb81dce7f1bc921e78067981e27fa0c4e1a76c1bc768ecbf` |
| C20 | 6→4 | `codex-e01-s01-c20-mte5ealm-b8528bb62f5891c1`<br>`219a216d9ad96dfd31120deac43b6cb80fd38ac99a9e2bf9d718596830829c52` | `codex-e01-s01-c20-mteehnvg-4a452ac667eefb4f`<br>`b72d9eef4c8a00f248c2fadf150ad4a92844dcff36a024b041016224096993c6` |
| C21 | 7→5 | `codex-e01-s01-c21-mte5ecl0-215c50d9273c0f28`<br>`3762c9a9071bd42b6222b5cfd65e39628e91b26f58aa498508ecb328b83f9d90` | `codex-e01-s01-c21-mteehpt9-06feb7f94af1e1c1`<br>`1b7c1a1b3e969bf050c3eadd818214c4b529acb46713f2db5b5bae3e0a774176` |
| C22 | 7→5 | `codex-e01-s01-c22-mte5eerb-8673ea8003bc776e`<br>`1bafef2615f0ac0d8c1c5aadf55b5c4cba56123ec1bdd6feb424286bcd815e2f` | `codex-e01-s01-c22-mteehrjs-7cb54fbc597aa6d1`<br>`3fcfff3474468fa2a8521a4cca43f570de4ec72693fbb56a6bf390bfb858cff5` |
| C23 | 9→5 | `codex-e01-s01-c23-mte5egvh-7208a565ef269ced`<br>`51b2cd225345c3ec8e5c2f459b75bb093f1f94b78d1115549b6607935cde7971` | `codex-e01-s01-c23-mteehte4-7e76339431964fd5`<br>`66a6117a15a0f2ef4d1396ad91d674653b8ecbad75c39763a226d7fb9a38457e` |

## 参考图收敛与删除原因

所有新包都保持固定顺序 `spatial → pose → face → body/costume → prop → style → lighting`；本批实际为 `spatial → face → body/costume（如有）→ prop`。每包至少一张空间权威和一张身份/服装权威。

李宝珠既有 identity sheet 经原图检查，已同时清楚包含面部身份、发型、完整身材比例和破损绯红棺服。它仍以 schema 合法的 `face_identity` 使用，但 instruction 明确同时锁定身份与该 sheet 可见的服装；不把 sheet 构图、白底、多视图、姿势或机位带入画面。因此 10 镜都删除重复的独立棺服 sheet。

| 镜头 | 保留的最小必要权威 | 删除及原因 |
|---|---|---|
| C03 | coffin-interior；李宝珠身份+棺服；silk-lining；bronze-nails | 独立棺服：与身份 sheet 重复；coffin：空间 sheet 已锁棺体几何/材质。 |
| C09 | coffin-interior；李宝珠身份+棺服；injured-finger；broken-hairpin | 独立棺服重复；coffin 被空间 sheet 覆盖；intact-hairpin 在最终叙事帧不可见，只保留断簪。 |
| C10 | coffin-interior；李宝珠身份+棺服；injured-finger；broken-hairpin | 独立棺服重复；coffin 被空间 sheet 覆盖。 |
| C17 | coffin-interior；李宝珠身份+棺服；bronze-nails | 韦训仍在棺外/画外，不用身份图抢占配额；独立棺服重复；coffin 被空间 sheet 覆盖。 |
| C18 | tomb-chamber-exterior；李宝珠身份+棺服；韦训身份；injured-finger；dagger | 独立棺服重复；coffin 与 bronze-nails 均由空间 sheet 覆盖，优先保留可见伤指和接触匕首。 |
| C19 | tomb-chamber-exterior；李宝珠身份+棺服；韦训身份；dagger | 独立棺服重复；coffin 被空间 sheet 覆盖。 |
| C20 | tomb-chamber-exterior；李宝珠身份+棺服；韦训身份；grave-robbing-shovel | 独立棺服重复；coffin 被空间 sheet 覆盖。 |
| C21 | tomb-chamber-exterior；李宝珠身份+棺服；韦训身份；shovel；phoenix-pattern-panel | 独立棺服重复；coffin 被空间 sheet 覆盖。 |
| C22 | tomb-chamber-exterior；李宝珠身份+棺服；韦训身份；shovel；phoenix-pattern-panel | 独立棺服重复；coffin 被空间 sheet 覆盖。 |
| C23 | tomb-chamber-exterior；李宝珠身份+棺服；韦训身份；injured-finger；phoenix-jade-pendant | 独立棺服重复；coffin 被空间 sheet 覆盖；shovel 与 phoenix panel 在玉佩/手部极近景中不可读，优先伤指和剧情关键玉佩。 |

核心 exact prompt、镜头动作、构图事实和 hard constraints 均未改。新旧包逐镜比较 `prompt` JSON 完全相同；所有新包编译 prompt 仍包含 hard constraints。

## Active 映射、authority 与 outputs

- `shot-plan.json`：23 个 shotId、23 个 codexJobId、23 个 packagePath 均唯一；10 镜 active job/package/requestDigest/referenceAssetIds 已同步，新旧 lineage 写入 `supersededCodexJobs`。
- 产品没有 `superseded` lifecycle state。非破坏处理为：旧包与 authority/history 全保留，旧任务用产品支持的 `queued → cancelled`；shot-plan 只把新任务映射为 active，并记录 `supersededByJobId`。Task5 只应消费当前 shot-plan 的唯一 active 映射。
- 私有 authority key：`47ce1192872a5f488f7b7bd3eb5def4447516e541dba536d1fee2a6f0775616f`。10 个旧 job 最新 lifecycle 均 cancelled；10 个新 job 最新 lifecycle 均 queued；新 export records、ready markers、requestDigest 全匹配。
- 样片 `codex-storyboard-jobs` 共 33 个目录（23 个原包 + 10 个新包），旧包没有删除。
- Active outputs：仅 C01 有 `candidate.png` 和 `result.json`，且 `result.json.state=completed`；C02–C23 的 active 包 outputs 全空。C02/C04 可能存在的未发布 built-in 原始输出不在正式 active 包 outputs 中。
- 23 个 active 包均为项目内 package path；每个 reference 均为包内相对 `inputs/...` 路径，输入文件 SHA-256 与 request 匹配。
- 所有 active 包 refs 为 3–5；顺序、usage、instruction、required spatial/identity 均验证通过。
- 未受影响的 13 个 shot-plan requestDigest 原值保持不变；它们没有重导。

## 门禁和未变项

- `run-manifest.stage=storyboard_tasks_queued`。
- 35 个 `sourceDigests` 未变，并已逐文件重算匹配。
- `asset-manifest`：21 项；2 existing、19 needsReview、0 accepted，全部 `acceptedPath=null`。
- 样片全部 `generatedImagePath` / `generatedVideoPath` 为空；23 镜 `videoStatus=blocked`。
- `assetReview=pending`、`storyboardReview=blocked`、`videoGeneration=blocked`。
- `selectedVideoWorkflow=DaSiWa_MiniMaxH3Video`，`selectedVideoWorkflowState=pending_stage_b_gate`。
- Task2/Task3、用户审核门禁和视频门禁没有推进。

## 验证入口

- UI 自动化与断言脚本：`.superpowers/sdd/reexport-yingdi-e01-ref-cap-ui.mjs`
- Prepare：`node .superpowers/sdd/reexport-yingdi-e01-ref-cap-ui.mjs --phase=prepare`
- Export：`node .superpowers/sdd/reexport-yingdi-e01-ref-cap-ui.mjs --phase=export`
- 投产 referenceAssetIds 同步：`node .superpowers/sdd/reexport-yingdi-e01-ref-cap-ui.mjs --phase=sync`
- Final verify：`node .superpowers/sdd/reexport-yingdi-e01-ref-cap-ui.mjs --phase=verify`

下一步：等待独立复审通过后，Task5 从更新后的 23 个 active shot 映射恢复；本 Task 不生成图片、不导入图片、不接受候选，也不触发视频。
