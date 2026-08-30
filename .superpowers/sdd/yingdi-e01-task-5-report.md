# 影帝 E01 Task 5 — Codex 分镜候选生成、真实 UI 导入与技术筛查报告

## 结论

- 23/23 active Codex 分镜包均完成正式结果链路：22 镜为 `inspect → built-in imagegen → complete → 真实 Tauri UI 检查并导入`；C23 为独立批准的用户授权本地确定性裁切，经正式非生成式 `complete → 真实 Tauri UI 检查并导入`。
- 每个 active 包均有且仅有 `outputs/candidate.png`、`outputs/result.json`、`outputs/import-receipt.json`；23/23 receipt 为 `needs_review`，23/23 `generatedImagePath` 为空，未点击接受或拒绝。
- 23 张 review 副本已发布到 `图片/E01/分镜候选/E01-S01-C01.png` 至 `E01-S01-C23.png`，逐张 SHA-256 与 active package candidate/result 匹配。
- Task 5 实际 built-in imagegen 输出累计 **67 张**；其中最终无毛领修复 C18 生成 2 张、C19 生成 1 张、C20 生成 3 张。C23 最终裁切是非生成式 derived transform，不计入 imagegen attempt。另有一次 C22 参考图读取错误无图，同样不计。未使用 CLI/API fallback。
- 当前为 Stage A 用户复审：`assetReview=needs_review`、`storyboardReview=needs_review`、`videoGeneration=blocked`；`DaSiWa_MiniMaxH3Video` 仅为 `pending_stage_b_gate`，未配置、未启动。

## 正式链路与 UI 证据

每个 active 包在生成前均执行正式 `node scripts/run-codex-storyboard-job.mjs inspect --package ...`，核对 job/shot identity、canonical package path、request digest、exact compiled prompt、hard constraints、refs 顺序/usage/instruction/digest。每张 staged reference 在该镜生成前均单独使用 `view_image` 查看；传给 built-in imagegen 的是 inspection manifest 返回的 exact prompt 和最小完整参考集合，顺序不变，所有 active 包 refs 均不超过 5。

正式 `complete` 绑定 request digest、prompt/reference digests、candidate digest 与 RFC3339 `completedAt`；22 镜为 `generationMode=codex_builtin_imagegen`，C23 为诚实的 `generationMode=user_authorized_local_deterministic_crop` 并保存完整 `derivedTransform`。真实 Tauri WebView2 中逐镜执行“检查并导入结果”，均只导入为 `needs_review`，没有 accept/reject。

证据：

- `.superpowers/sdd/yingdi-e01-task-5-ui-import-evidence.json`：补导 C10/C17/C21 的真实 UI 证据，均为 `needs_review`、accept/reject 可见、`generatedImagePath=""`。
- C02/C22/C23 对应 active 包的 `outputs/import-receipt.json` 及第一次 UI 运行证据：三镜均为 `needs_review`、accept/reject 可见、`generatedImagePath=""`，运行时间 `2026-08-29T20:04:57.482Z`。
- 最终真实 Tauri runtime 同步结果：23 shots、23 `needs_review`、0 generated；`shotPlanDigest=9e6deba6c3ba6695e3fb3827dffdaedc77e3b32c4d828550c42828f49fa6df0e`，`updatedAt=2026-08-29T20:21:02.413Z`。

## 23 个 active 候选

| 镜头 | Active job | refs | review SHA-256 |
|---|---|---:|---|
| C01 | `codex-e01-s01-c01-mte5ckxj-b6319afbeec61c80` | 5 | `7ce77622bb11073583cc1f73043c0869db2b90bb8a33ac462bee4ae1268a8d84` |
| C02 | `codex-e01-s01-c02-mteq1j7j-bf8a4608201309bd` | 5 | `091c52e85cfec26f365af3caa8e87efda62cc02beaba93f35298c615f6080276` |
| C03 | `codex-e01-s01-c03-mteegih7-076e86bd64355c5f` | 4 | `0a542456d6764724c963475f10b5d40de5bd3b6945d42ef40855aaea1458bdb7` |
| C04 | `codex-e01-s01-c04-mtego2zr-c9e6671ffbb514a2` | 4 | `5a43a984b3f34f27981df7d0ffe90df9371e3ecbb09477dce8f91390b4b6d6c7` |
| C05 | `codex-e01-s01-c05-mte5dlum-bb2701e73527a728` | 5 | `abd0e43c2ee39bf04c90a7023974665be7fbea4ef23073bf6f2be4727dd29347` |
| C06 | `codex-e01-s01-c06-mte5dnji-07c1d880a3b49d40` | 5 | `b56f3ee78f987064b27496cb6fb5493e01cd20c2dd9b724e5977f1fc054b99d5` |
| C07 | `codex-e01-s01-c07-mte5dp1h-58f98a40a5a5012a` | 5 | `ad7d06444b508dffc5bb124b925cf4c5348825ae2c636dc4f4340477eb263795` |
| C08 | `codex-e01-s01-c08-mte5dqmb-3e4b2fcef19d7558` | 5 | `b7599b1fc25fea129a897705fd45f1f77a27c6cebeae1cfb468461959170d6a3` |
| C09 | `codex-e01-s01-c09-mteehej1-fe526db7f6c28b70` | 4 | `a33bafdc519c797275b36d27eb43db16440874aa694f599a692ef91212a162c8` |
| C10 | `codex-e01-s01-c10-mteo7ww0-fdda2c5826620214` | 4 | `d12d41715c08a9fa3c8aa5d154331d0893277e89f2e1209c338e6754762100f9` |
| C11 | `codex-e01-s01-c11-mte5dvvy-00c0aa27698bd726` | 5 | `1355c97e309137708413a48956299b6237ea79179ecfbcd65ef1f1ed160a9631` |
| C12 | `codex-e01-s01-c12-mte5dxdj-349b57114829fea6` | 5 | `100c5a06fd1de14ee2084d97540475a1f37453b56ee0ebdc1ffc23dd76370e2b` |
| C13 | `codex-e01-s01-c13-mte5dyvs-78f98611426d33f8` | 5 | `c93ab574a642b6dce92e95c3195efbe74c7a608a3608d60393cf6f321e245356` |
| C14 | `codex-e01-s01-c14-mte5e0e1-4a788dfdb9287160` | 5 | `ea7aa7bcd07ecc228f9486716c21bc0c5058db7de9c4422a4f190cf4d1a9d865` |
| C15 | `codex-e01-s01-c15-mte5e1v9-87c7473e1298c8ae` | 5 | `202d93c45ac368c27e9278fad82ed6fdf9b286844c7a5f5fc9b6e68f9874f1be` |
| C16 | `codex-e01-s01-c16-mte5e3ei-17d99164428a8382` | 4 | `3e4a34921388a41ecbab19ef94ad161891cc4fe41466fedb50dd7f2549645201` |
| C17 | `codex-e01-s01-c17-mteo7zlp-25848f72625ed642` | 4 | `a0cf5cf0580d3ea24ddce820e8fa12932f16c4f529a0475d72fde1a4ef6a4f98` |
| C18 | `codex-e01-s01-c18-mteehkeb-b26ace44d960ad3e` | 5 | `cc6f114edf247cc32bf1a453a3358fd7a05a86cf333bd4306ffc43e509969588` |
| C19 | `codex-e01-s01-c19-mteehm93-7e64492c444c5b00` | 4 | `7c6692af0b8aa080870bc9e6efb493773f08e1a03c9da5f2085db7fda15df081` |
| C20 | `codex-e01-s01-c20-mteehnvg-4a452ac667eefb4f` | 4 | `5df24e3483f5bac2f292dc98d7c9ce868c1843182f8a1d6ad4a4632d3feccab2` |
| C21 | `codex-e01-s01-c21-mteo814l-578a20720eaccf56` | 5 | `d1d3dcbbd35ae3edefbcc1dddf485b86a5ff36c0136fe2153361330dddf22628` |
| C22 | `codex-e01-s01-c22-mteygpf5-488ad2430c8011cd` | 5 | `6152e3cfc2da3d5216a025123f6f2aaaaa7729692a06f2f6e9704a2be48a9f56` |
| C23 | `codex-e01-s01-c23-mtf4f9we-d2eaa9b9e33a7371` | 5 | `aa2a88b5b634c75245a62c41114cf076a2a7b79cb48b20ea30c16350e9a5e819` |

## 六镜修复与 attempt lineage

六镜首轮修复新增 13 张实际输出：C02 3 rejected；C10 1 selected；C17 1 rejected + 1 selected；C21 1 selected；C22 3 rejected；C23 3 rejected。C02/C22/C23 后续上游链式包独立 Approved 后，本轮新增 4 张：C02 1 selected、C22 1 selected、C23 1 rejected + 1 selected。C10/C17/C21 未再次生成。

| 镜头 | request digest | inspection manifest | selected raw | 技术判定 |
|---|---|---|---|---|
| C02 | `7a49491fbca49918c348c58d6cbcaf2cd8831d87065f2b5ec258036ea45077fe` | `C:\Users\Administrator\AppData\Local\Temp\codex-storyboard-inspection-yf9BzJ\inspection-manifest.json` | `exec-6fce41a9-cd59-4c19-ba02-9061a3292d5e.png` | 首次通过：右掌位于头顶棺盖中央，左手收耳，无侧壁/铜钉接触。 |
| C10 | `45cc50ee88c83b0fb945c97c9d064640e23031e464ddd4995f0684f0542bdd5c` | active result/shot lineage | `exec-7ed7343c-3274-417a-b02a-d5420819b78d.png` | 通过：发饰仍佩戴，仅断裂细簪片落在衬缎，右拳伤口可读。 |
| C17 | `7ba8d9570eb835d7bcb57b0d29e7eca90a76a643e76253c15d74511dad65d01d` | active result/shot lineage | `exec-060b9acc-2131-4d3b-ba02-9f6e5680ab40.png` | 第二次通过：仅窄光缝、韦训只露局部双眼、铜钉轻松，无匕首。 |
| C21 | `06fd63915c9016cf3e675d783ce4bd599745495b031f370fa091bda77f9072bc` | active result/shot lineage | `exec-4f1147b7-5c4b-4355-a13d-73501afec351.png` | 首次通过：李在棺内、韦在棺外，暗板/短铲空间关系可读。 |
| C22 | `4f389c4a67034872d3536d0cd12001ad04df92e68e48ae93e60a994a1a2b5354` | `C:\Users\Administrator\AppData\Local\Temp\codex-storyboard-inspection-YJbgof\inspection-manifest.json` | `exec-5ffbc934-1361-449f-90dc-2d0b1aa22c47.png` | 首次通过：李内韦外、同一短柄宽铲刃朝下、水平暗板、存在 air gap。 |
| C23 | `272b4f46f918963314a247c51e9dfbaded88f41c217612843b4f83d8ed5da4e0` | `C:\Users\Administrator\AppData\Local\Temp\codex-storyboard-inspection-9KO54E\inspection-manifest.json` | `exec-852300b9-8c86-4ad8-8bf9-0f493925cb5a.png` | 第二次通过：李内韦外，右伤指收护，未伤左手伸向玉坠，无绷带；同铲/暗板连续。 |

本轮明确 rejected 原图：C17 `exec-bbaf9c57-5f0c-4865-9a40-67025c4ab7b3.png`（开口过宽并完整暴露韦训）；C23 `exec-d8cef91c-930d-48ba-8a44-984033f094c1.png`（左右手职责反转）。六镜首轮其余 rejected 的镜头级分布及技术原因保存在 superseded package、会话 tool-return 与 shot lineage 中；均为手位、棺内外身份、开盖进度、暗板/短铲空间关系等明确技术失败，不是审美迭代。

历史基线的明确 rejected 包括 C04 三次（回忆服装冲突两次、青瓷杯材质错误一次）、C20 一次（受损红衣漂移为完整服装）、C21 一次（李出棺、加黑色毛领且铲刃压暗板）及 C22 旧链四次（铲板接触或暗板位置/形态错误）。旧图均非破坏保留。

### C02 abandoned / unselected（不得改写为 rejected）

- 原图：`C:\Users\Administrator\.codex\generated_images\01a04d8a-f6d0-7fd0-b417-e8caec46028d\exec-a4235bcb-6b23-4c8f-84a6-12cc1befa5ca.png`
- SHA-256：`6c3f7f8f707e56e88c8b50ed036c3ea6c429221bb2c8e34c029d34a88ffb5df1`
- 文件证据：1,898,909 bytes，1672×941 RGB，mtime `2026-08-29 20:52:06 +08:00`。
- 会话 JSONL 证明它使用当时 C02 exact prompt/refs 生成，但该 turn 中断，未形成可审计的 formal complete/import 链。因此状态为 `abandoned/unselected`，不是事后美化为 rejected；画面同时存在双掌落在侧壁/铜钉带而非棺盖中央的问题。

## 23 镜技术与连续性审计

已按 C01→C23 全量检查身份、人数、肢体、服装、空间、道具、受力、光、16:9、相邻手位/方向/棺盖状态/道具状态/视线。

- 阻断级技术失败：0；未发现明确重复人物、缺失/融合肢体、文字、水印、拼贴或非 16:9 可用性失败。
- C01–C03：棺内身份/受损红衣/封闭空间连续；C02 已修复为右掌中央棺盖 + 左手收耳。
- C04–C05：宫宴/绑架回忆中的完整礼服与宫殿空间是时间层切换；C06 回到棺内，非连续性错误。
- C06–C08：同一棺内空间、受损红衣与发簪动作连续。
- C09–C11：C09 头上凤饰仍在且手中仅持断簪；C10 仅小段细簪落衬缎且右拳伤口可读；C11 伤拳延续。
- C12–C16：手部伤势、服装、棺内位置及动作推进连续。
- C17–C19：C17 仅窄缝/局部眼睛/单钉略松；C18 才引入匕首并扩大开口；C19 才完成开盖，递进正确。
- C20–C23：李始终在棺内、韦在棺外；水平暗板、同一短柄宽铲刃朝下且与板有间隙；C23 右伤指保护、左手伸玉坠，左右手职责正确。

仍需用户复审的 known concerns（非内部技术重生触发项）：

1. C20→C21 韦训外衣从较明显的华丽黑色毛领简化为破旧黑围巾/外套；身份和内外位置仍可辨，但服装细节连续性偏弱。
2. C17–C23 的发饰、束发及局部面部透视存在轻微漂移；C17→C18 因揭盖范围变化尤其明显，身份仍可辨。

历史 concern“C21/C22 构图过近”已由最终 C22 locked-off OTS insert 修复，不再列为当前 concern；C23 ECU 也已通过批准的确定性裁切与 C22 拉开景别。

## 最终状态验证（2026-08-30 fresh check）

- `shot-plan.json`：23 镜、36 beats、106.9 秒；23/23 active result/receipt/review copy identity 与 SHA 匹配，active outputs 无额外文件；23 `storyboardStatus=needs_review`、23 `candidateStatus=needs_review_user`、23 `videoStatus=blocked`、0 非空 `generatedImagePath`。
- Storyboard Pro `snapshot.json`：23 shots、0 非空 `generatedImagePath`；与真实 Tauri live 检查的 23 needs_review / 0 generated 一致。
- `run-manifest.json`：`stage=stage_a_user_review`、`videoGeneration=blocked`、`selectedVideoWorkflow=DaSiWa_MiniMaxH3Video`、`selectedVideoWorkflowState=pending_stage_b_gate`；shot-plan 文件 SHA 与 run 记录均为 `9e6deba6c3ba6695e3fb3827dffdaedc77e3b32c4d828550c42828f49fa6df0e`。
- 35/35 `sourceDigests` 重新计算全部匹配。
- `asset-manifest.json`：21 项，19 项 `needs_review`、2 项既有身份锚点；21/21 `acceptedPath` 为空。
- `图片/E01/正式分镜`、`图片/E01/正式资产`、`视频/E01/逐镜`、`视频/E01/成片`、`音频/E01` 均为 0 文件；active 包无视频或音频产物。

## 治理备注

实现者 commit `62e7b44` 只涉及报告/UI 辅助脚本，不影响产品状态，记为治理 Minor；本 Task 5 未额外 commit。候选尚未被用户接受，正式分镜/正式资产目录保持空，视频门继续 blocked。

## [SUPERSEDED] C23 final edit package：3/3 技术失败，停止（2026-08-30）

独立复审批准的最终 edit-oriented active 包为 `codex-e01-s01-c23-mtf1rm8m-3e4fdf10ad6358eb`，request digest `062d591491253e90903cbe737a608f65b19fb017e456310334f465aabc3080a5`。正式 inspection manifest 为 `C:\Users\Administrator\AppData\Local\Temp\codex-storyboard-inspection-gGTwba\inspection-manifest.json`；5 张 staged refs 已逐张 `view_image`，三次均使用 manifest 返回的 exact compiled prompt、完整 5 refs 与原顺序，built-in imagegen only。

| attempt | 原始 PNG | SHA-256 | 判定 |
|---:|---|---|---|
| 1 | `C:\Users\Administrator\.codex\generated_images\01a04d8a-f6d0-7fd0-b417-e8caec46028d\exec-63877ac4-78af-4740-8e9d-99211a253e26.png` | `dfe94160e11358513c6f83b8a51efc4284d47e6e22651a46c45cd763e4c2c717` | rejected：ECU/rack-focus/jade/Wei blur 构图通过，但人物自身 RIGHT（画面左）仍为无伤伸手，人物自身 LEFT（画面右）仍为伤指保护，左右手职责反转。 |
| 2 | `C:\Users\Administrator\.codex\generated_images\01a04d8a-f6d0-7fd0-b417-e8caec46028d\exec-06fbda30-efa8-4f85-a87d-e4a906a5d9e9.png` | `633464469160f858ef9f4750a2749d5717b11327098733107c9e5c93a45fca7b` | rejected：同一明确技术失败；构图通过，人物自身 RIGHT 无伤伸玉佩、LEFT 伤指蜷曲。 |
| 3 | `C:\Users\Administrator\.codex\generated_images\01a04d8a-f6d0-7fd0-b417-e8caec46028d\exec-e3b558ef-8605-4819-b130-b65f6fcc5deb.png` | `e7a68f8094c4a6bdc9810295855c31461cb01782308b007b9c61709a7282cd18` | rejected：同一明确技术失败；人物自身 LEFT/RIGHT 仍反置。达到该包 3 actual PNG 上限后停止。 |

Task 5 实际 built-in imagegen 输出累计从 55 增至 **58 张**。本包未执行 formal complete、未通过 UI 导入、未发布 review copy、未改写 C23 selected hash；active C23 保持 queued 且 outputs 为空。其余 22 镜不动。由于 C23 尚无通过候选，不能声明 23/23 当前均 `needs_review`，也不做 shot/run 最终同步。`generatedImagePath` 仍为空，正式目录仍为空，视频继续 blocked，`DaSiWa_MiniMaxH3Video` 继续 `pending_stage_b_gate`。本轮无 commit。

## [SUPERSEDED] C23 correct-hand crop/reframe：3/3 framing 技术失败，停止（2026-08-30）

独立复审批准的 crop/reframe active 包为 `codex-e01-s01-c23-mtf4f9we-d2eaa9b9e33a7371`，request digest `dbac850a7e214f1258adfcaeaf9ce07867e6aa3620d74d7d908751bdbf020e25`，inspection manifest `C:\Users\Administrator\AppData\Local\Temp\codex-storyboard-inspection-llW03Q\inspection-manifest.json`。5 张 staged refs 已逐张 `view_image`；唯一 spatial/composition/anatomy base 是左右手正确但景别过宽的历史 C23 候选，未引用任何 wrong-hand ECU、C21 或通用 contact sheet。三次均使用 exact compiled prompt、完整 refs 与原顺序，built-in imagegen only。

| attempt | 原始 PNG | SHA-256 | 判定 |
|---:|---|---|---|
| 1 | `C:\Users\Administrator\.codex\generated_images\01a04d8a-f6d0-7fd0-b417-e8caec46028d\exec-6f1d4d6d-5926-42f2-b72a-1838101670da.png` | `90389cd5cca0e71d1ab3a05bfbfe200f3e1f5263c689ddb5aa19b8f1be82470` | rejected：李自身 LEFT 无伤伸向 jade、RIGHT 伤指保护已正确；但仍是胸像 close-up，韦训整段前臂和手清晰可读，违反 jade+双手唯一主视觉 ECU 与 optional tiny defocused edge。 |
| 2 | `C:\Users\Administrator\.codex\generated_images\01a04d8a-f6d0-7fd0-b417-e8caec46028d\exec-309bb415-f76c-445d-8ecc-f3c96f4369fb.png` | `964b2306fd1a81840298781a6aa7f7565005fa3166ca85db7b74fa29447f36f1` | rejected：手位/伤势职责正确；仍为胸像 close-up，韦训半身、前臂和手可读，未达到目标景别与边缘存在约束。 |
| 3 | `C:\Users\Administrator\.codex\generated_images\01a04d8a-f6d0-7fd0-b417-e8caec46028d\exec-fffd2d66-4d06-453f-b800-b577bc402d4f.png` | `6e2460966e053cb8b498fa52e67e1b436328361bbf1564f95464bb5318093b77` | rejected：手位/伤势正确且已接近 jade+双手主导 ECU，但韦训前臂/手仍占画面左侧约四分之一并可辨，不是 tiny defocused edge；达到 3 actual PNG 上限后停止。 |

Task 5 实际 built-in imagegen 输出累计从 58 增至 **61 张**。本包未 formal complete、未 UI import、未发布 review copy、未改 C23 selected hash，也未执行 shot/run 最终同步；active C23 保持 queued 且 outputs 为空。其余 22 镜不动，`generatedImagePath` 为空，正式目录为空，视频 blocked，`DaSiWa_MiniMaxH3Video=pending_stage_b_gate`。本轮无 commit。

## [SUPERSEDED] C23 用户授权的本地确定性裁切（等待独立视觉复审）

- operation：`user_authorized_local_deterministic_crop`；非生成式 ffmpeg crop，未调用 imagegen，未覆盖源图。
- 用户授权上下文：用户明确允许对 attempt3 做一次本地确定性裁切，从左侧裁约 28–31%，相应裁上下保持精确 16:9，完整保留 jade、李宝珠自身 LEFT 无伤伸手指尖、RIGHT 食指伤口及保护手，移除韦训可读前臂/手；在独立视觉复审前不 formal complete、不 UI import。记录时间 `2026-08-30T02:14:40.5350127Z`。
- source：`C:\Users\Administrator\.codex\generated_images\01a04d8a-f6d0-7fd0-b417-e8caec46028d\exec-fffd2d66-4d06-453f-b800-b577bc402d4f.png`；1672×941；SHA-256 `6e2460966e053cb8b498fa52e67e1b436328361bbf1564f95464bb5318093b77`。
- crop rectangle：`x=488, y=244, width=1184, height=666`；左裁 `29.187%`；输出比例精确 `1184/666 = 16/9`。
- derived output：`C:\Users\Administrator\Desktop\小说\应用项目\影帝他总想对我图谋不轨_E01样片.sbproj\codex-reference-assets\derived-candidates\C23\c23-mtf4f9we-attempt3-crop-v1.png`；1184×666；SHA-256 `aa2a88b5b634c75245a62c41114cf076a2a7b79cb48b20ea30c16350e9a5e819`。
- 自检：玉佩完整；李宝珠自身 LEFT 无伤手的伸向玉佩指尖完整；自身 RIGHT 食指伤口和蜷曲保护手完整；韦训可读前臂/手已完全移出，仅左缘保留少量失焦黑衣暗部。
- 独立 lineage：`.superpowers/sdd/yingdi-e01-c23-local-crop-lineage.json`。

正式兼容性：当前 `result.json` schema、CLI complete 与 Tauri import 都强制 `generationMode=codex_builtin_imagegen`。本 derived PNG 实际是用户授权的非生成式确定性裁切，若直接走现有 complete 会伪装来源，因此本轮刻意不运行 formal complete/UI import。独立视觉复审通过后，必须先采用经复审的 schema/兼容路径显式表达 `user_authorized_local_deterministic_crop`，或由上游给出可审计的兼容裁决；在此之前 C23 active package/job 保持 queued、outputs 为空，其他 22 镜与视频门禁不变。

## C23 确定性裁切正式落库与最终治理（2026-08-30）

上节“等待独立视觉复审/正式兼容性阻塞”是历史状态，已被本节取代。独立 visual+lineage review 已 Approved，`pixel_exact_crop=true`，无分级问题。产品现已以最小兼容扩展诚实支持 `generationMode=user_authorized_local_deterministic_crop`；默认 `codex_builtin_imagegen` 的严格键集和行为保持不变。

- Active job：`codex-e01-s01-c23-mtf4f9we-d2eaa9b9e33a7371`
- Request digest：`dbac850a7e214f1258adfcaeaf9ce07867e6aa3620d74d7d908751bdbf020e25`
- Source：`exec-fffd2d66-4d06-453f-b800-b577bc402d4f.png`，1672×941，SHA-256 `6e2460966e053cb8b498fa52e67e1b436328361bbf1564f95464bb5318093b77`
- Operation：非生成式 ffmpeg `crop=1184:666:488:244`；授权记录时间规范化为 RFC3339 `2026-08-30T02:14:40.535Z`，完整授权上下文保留在 `derivedTransform.authorization.context`。
- Derived review candidate：`C:\Users\Administrator\Desktop\小说\应用项目\影帝他总想对我图谋不轨_E01样片.sbproj\codex-reference-assets\derived-candidates\C23\c23-mtf4f9we-attempt3-crop-v1.png`，1184×666，精确 16:9，SHA-256 `aa2a88b5b634c75245a62c41114cf076a2a7b79cb48b20ea30c16350e9a5e819`。
- Formal result：active package `outputs/result.json` 显式保存 `derivedTransform`，包括 source/output absolute path、SHA、尺寸、crop rectangle、ffmpeg 非生成标记、pixel exact 标记、授权时间/上下文；顶层继续绑定 jobId/requestDigest/finalPrompt/reference digests。
- UI：真实 Tauri 通过“检查并导入结果”导入 C23，receipt/status=`needs_review`，未 accept/reject；随后通过 `save_current_project → load_current_project` roundtrip 读回 23 `needs_review` / 0 generated，C23 仍为 `needs_review`。投产 review copy `E01-S01-C23.png` SHA 与 formal candidate/result 一致。
- Provider lineage：此项为 `derivedTransform`，不是新的 provider generation call；built-in imagegen 累计仍为 **61**。

### TDD / focused suites

- `node scripts/check-codex-storyboard-task-package.mjs`：PASS。
- `cargo test --offline --manifest-path src-tauri/Cargo.toml deterministic_crop_result_round_trips_and_rejects_bad_bounds -- --nocapture`：1 passed。
- `node scripts/check-codex-storyboard-desktop-bridge.mjs`：PASS。
- `node scripts/check-codex-storyboard-ui.mjs`：PASS。
- `cargo check --offline --manifest-path src-tauri/Cargo.toml --bin codex-storyboard-operator` 与完整 desktop `cargo check`：PASS（仅既有 dead_code warning）。
- Formal CLI 首次调用中，Rust operator 已原子发布正确 candidate/result，但 JS 后置校验因对象键序不同产生 `codex_storyboard_cli_helper_invalid` 假阴性；根因已修为 canonical deep comparison。未删除、重写或伪造已发布的 formal 文件。

### 23 镜连续性复核

独立复审已确认裁切像素精确且无分级问题。C23 只裁切/缩放/重构景别与景深，没有 re-pose、交换/镜像左右手或移动伤势：李宝珠自身 LEFT 无伤手仍停在玉佩一寸，自身 RIGHT 食指伤口与保护手保持；韦训可读前臂/手已移出，仅余 tiny defocused black-clothing edge。C22→C23 的暗板/玉佩动作接续和李内韦外关系可读；C01–C22 复核结论沿用上文，无新增阻断项。

### Fresh governance

最终只读校验 `.superpowers/sdd/verify-yingdi-e01-task5-final.mjs` 返回：23 shots、23 active results、23 receipts、23 `needs_review`、0 generated、1 deterministic-crop mode、35/35 source digests、0 accepted paths、0 formal files。`shotPlanDigest=e9b08123c1211ecda99cd2c17f954a02ff34e290f1ccd3b1ec626e58762fab5d`；`videoGeneration=blocked`，`DaSiWa_MiniMaxH3Video=pending_stage_b_gate`。C22 review copy 也补齐到当前 active formal candidate SHA `6152e3cfc2da3d5216a025123f6f2aaaaa7729692a06f2f6e9704a2be48a9f56`。本轮无 commit；工作树未提交治理项继续记为 deferred / branch not reproducible。

## Final review fix wave：profile、pixel attestation 与 C18–C20 无毛领重导（2026-08-30）

本轮按 final review 的 Critical/Important/Minor 一次性窄修复，未调用 imagegen、未 commit，也未修改 C22/C23 的 active package、candidate、result 或 receipt。

### 显式语义 profile，消除通用机位关键词污染

- 根因：E01 C22/C23 的专用语义曾由通用 `over-the-shoulder/locked-off`、`extreme close-up/rack-focus` 文本触发，未来相同机位标签的其他故事会被棺材、铲、凤凰暗板、玉佩、角色与伤手约束污染。
- 修复：`buildCodexStoryboardPackageRequest` 新增显式 `semanticProfile`；只有 `yingdi_e01_c22_ots_insert` / `yingdi_e01_c23_jade_ecu` 才启用对应 hard constraints，普通镜维持默认兼容行为。
- RED：新增相同机位标签、不同故事内容的负向回归后，旧实现错误移除默认 `subjectCount=2`，测试失败 `undefined !== 2`。
- GREEN：正向 C22/C23 fixture 使用显式 profile；两组负向 fixture 断言无 coffin/shovel/phoenix/jade/wound/李宝珠/韦训污染，`node scripts/check-codex-storyboard-task-package.mjs` PASS。

### Rust/Tauri 逐像素裁切证明

- 新共享 helper 解码 source/candidate 为 RGBA，并逐像素验证 candidate 精确等于 `source.crop(x,y,w,h)`；Rust operator 与 Tauri import 均调用同一 helper，避免逻辑漂移，同时保留 SHA、尺寸、bounds、16:9 与用户授权校验。
- RED：operator 与 Tauri 各自新增 single-pixel-tamper 负例，helper 接入前无法编译/验证。
- GREEN：`cargo test --offline --manifest-path src-tauri/Cargo.toml crop -- --nocapture` 共 3 passed、0 failed；当前 C23 实际 source crop 与 active candidate 的 ffmpeg decoded-frame MD5 同为 `70390b1e420a11332cf070b7aebaae34`，尺寸均为 1184×666，因此继续通过 exact-pixel 要求。

### C18–C20 真实 UI reject 与无毛领 packages

真实 Tauri UI 已 reject 三个旧 active `needs_review`，旧 candidate/result/receipt 与 rejection history 均保留。新包是唯一 active、`queued`、outputs 为空；每包 5 refs 已逐张 `view_image`，未越过独立 package review 门禁：

| shot | new active job | request digest | inspection manifest |
|---|---|---|---|
| C18 | `codex-e01-s01-c18-mtf9rgac-e5bfd367ff230150` | `f65e36cca9d59d8159026b4e4f087ea423a0b5f191c636ffdc35d04ee739ca70` | `C:\Users\Administrator\AppData\Local\Temp\codex-storyboard-inspection-VxVL5b\inspection-manifest.json` |
| C19 | `codex-e01-s01-c19-mtf9scnb-d28cc00448f955d0` | `c93a75069c18a642a6f86c12d53230d4bfe4e96cc16dcaffca20a4e984d105e8` | `C:\Users\Administrator\AppData\Local\Temp\codex-storyboard-inspection-FEWH2J\inspection-manifest.json` |
| C20 | `codex-e01-s01-c20-mtf9sf37-7c616ef1d758c7c8` | `f8d0c82f798f524d44528cf4285db81a8225082004f12929d263ce80d59e7aaa` | `C:\Users\Administrator\AppData\Local\Temp\codex-storyboard-inspection-SatSfe\inspection-manifest.json` |

五项 refs 用途依次为：旧 candidate 仅作 composition/action base（明确其黑色毛领错误不得继承）；李宝珠 identity + 破损红衣；韦训 identity + 无毛破旧黑色布披肩/外袍服装权威；C21 candidate 仅作无毛服装连续性、不得借构图；C18/C19 为匕首权威、C20 为同一短柄宽铲权威。compiled prompt 明确 `no fur / no plush / no thick furry collar / no furry shoulder armor`，并保持各镜原 framing/action/其他身份。

当前 package gate fresh verify：20 completed active + 3 queued empty-output active，35 source digests，0 generated paths，0 video unblocked；`videoGeneration=blocked`，`DaSiWa_MiniMaxH3Video=pending_stage_b_gate`。C17→C18 仍存在轻微面部/发型漂移，保留为最终用户逐图审阅 concern；本轮无图可重新判断或消除此项。

### 本轮 focused verification

- Node：task-package、desktop-bridge、UI、generation-flow、generation-state 全部 PASS。
- Rust：crop focused tests 3 passed；operator `cargo check` 与完整 desktop `cargo check` PASS，仅既有 dead-code warnings。
- Governance：无 imagegen、无 commit；C18–C20 等待独立 package review，当前不是最终 23/23 needs_review 状态。未提交工作树继续记为 `deferred / branch not reproducible`。

## Re-review Important fix：semantic profile 正式 UI/export/persistence 可达（2026-08-30）

### 根因与 TDD

根因不是 request builder 本身：`semanticProfile` 已能正确编译 C22/C23 专用约束，但它只存在于 builder 的临时入参；正式 `ComfyPipelinePanel.exportSelectedCodexJob` 没有从 shot metadata 传递该值，`Shot` 类型也没有可审计字段，因此 live UI/exporter 永远只能走默认分支。

- RED：先在 `check-codex-storyboard-ui.mjs` 要求正式 Shot 类型公开两种 profile、Shot 持有可选 profile、production exporter 明确传递 `selectedShot.codexStoryboardSemanticProfile`；旧代码在 `shot metadata exposes the audited Codex semantic profiles` 断言处失败。
- GREEN：新增 `CodexStoryboardSemanticProfile` 联合类型与 `Shot.codexStoryboardSemanticProfile`；正式 exporter 传 `semanticProfile: selectedShot.codexStoryboardSemanticProfile`。没有 camera-tag 推断或 shot-id 隐式推断。
- C22/C23 正向 compiled hard constraints 与无 profile 的 OTS/ECU 负向污染测试继续由 task-package suite 覆盖并通过；C23 的 crop/reframe active package 继续映射到 `yingdi_e01_c23_jade_ecu`，与其 approved compiled request 的 ECU/jade/hand-role 语义一致，不引入第三种隐式模式。

### DB、snapshot 与真实 Tauri roundtrip

Shot 的非基础字段由既有 `shots.extra_json` 严格对象通道保存。Rust roundtrip fixture 新增 `codexStoryboardSemanticProfile`，同时直接断言 SQLite `extra_json` 与 load 后 Shot 均保留该值；focused test 1 passed。

真实 Tauri WebView2 执行 `load_current_project → hydrate → set shot metadata → createStoryboardSnapshot → save_current_project → load_current_project → hydrate`，fresh 返回：

- `E01-S01-C22 = yingdi_e01_c22_ots_insert`
- `E01-S01-C23 = yingdi_e01_c23_jade_ecu`
- 其余 21 镜无 profile
- 20 `needs_review`、3 `queued`、0 generated

本次只写 project DB/snapshot 的 shot metadata，未重导或重写任何 package。`shot-plan.json` SHA-256 保持 `356ba46e7518a22aefdb96565e3dc7c27a90e82ef92d449babf63b5fd900bd79`；C22 active job/digest 仍为 `codex-e01-s01-c22-mteygpf5-488ad2430c8011cd` / `17285754e3245284821cc6eb5d57e89daf9cf5a7f970223f57512a5a5d8f1769`，C23 仍为 `codex-e01-s01-c23-mtf4f9we-d2eaa9b9e33a7371` / `dbac850a7e214f1258adfcaeaf9ce07867e6aa3620d74d7d908751bdbf020e25`。

### Verification

- `npm run test:codex-storyboard-focused`：task-package、bridge、UI、generation-flow、generation-state 全部 PASS。
- `cargo test --offline --manifest-path src-tauri/Cargo.toml sqlite_shot_roundtrip_preserves_storyboard_and_video_fields -- --nocapture`：1 passed。
- operator 与完整 desktop `cargo check`：PASS，仅既有 dead-code warnings。
- 未 imagegen、未 commit；C18–C20 仍为唯一 active、queued、outputs 空，C22/C23 与其他 20 个完成包未改候选或 digest；视频继续 blocked，DaSiWa 继续 `pending_stage_b_gate`。

## C18–C20 无毛领候选生成、UI 导入与最终治理（2026-08-30）

独立 package re-review Approved 后，仅消费 C18–C20 三个 active package。生成前重新 formal inspect 并逐张 `view_image` 全部 5 refs；实际 inspection manifests 分别为：C18 `C:\Users\Administrator\AppData\Local\Temp\codex-storyboard-inspection-ystWnV\inspection-manifest.json`、C19 `C:\Users\Administrator\AppData\Local\Temp\codex-storyboard-inspection-iZKggm\inspection-manifest.json`、C20 `C:\Users\Administrator\AppData\Local\Temp\codex-storyboard-inspection-ywNIwK\inspection-manifest.json`。job、request digest、exact compiled prompt、refs 顺序/用途/摘要均与 approved active packages 匹配；built-in imagegen only。

### Actual PNG attempts

| shot / attempt | 原始 PNG | SHA-256 | 判定 |
|---|---|---|---|
| C18 / 1 | `C:\Users\Administrator\.codex\generated_images\01a04d8a-f6d0-7fd0-b417-e8caec46028d\exec-cf482282-49e1-4a7c-8ced-2b7c40bc49f5.png` | `d8e23d9696ec4dd34c6028d3f1cb82c7ec10938f4bba42daf4c9bcf5f9adf6af` | rejected：无毛服装通过，但李宝珠只有一只手清晰可读，违反该包 visible anatomy。 |
| C18 / 2 | `C:\Users\Administrator\.codex\generated_images\01a04d8a-f6d0-7fd0-b417-e8caec46028d\exec-64bd7eb1-2f62-4ce2-bb3e-b885201a7ca8.png` | `78b323879cdb117e6d05d5ce752b98b3c9cd32a4a246b92f601edfee65a9e0ff` | selected：韦训为平整磨旧黑布，无 fur/plush/毛领/厚毛肩甲；双人双手可读，匕首进入棺缝，空间/动作通过。 |
| C19 / 1 | `C:\Users\Administrator\.codex\generated_images\01a04d8a-f6d0-7fd0-b417-e8caec46028d\exec-b5aa82b6-b003-4056-8a6b-9b19b55dd2d7.png` | `78aaba6407c4f755bea2672eded0272b4e0027ced7bca7ed456f00db7b2ce0f3` | selected：韦训无毛平布；李棺内遮光、韦棺外左手抬盖/右手持匕首压棺缘，身份、人数、手部和开盖动作通过。 |
| C20 / 1 | `C:\Users\Administrator\.codex\generated_images\01a04d8a-f6d0-7fd0-b417-e8caec46028d\exec-e0775e5e-7c73-4000-a64d-98c44617b29d.png` | `430da25841d991e26fdca78fe566dcd1c5ad693b081799c0dd4c00df51fee548` | rejected：服装通过，但韦训自身 LEFT 手持铲、RIGHT 手扶棺沿，左右手角色反转。 |
| C20 / 2 | `C:\Users\Administrator\.codex\generated_images\01a04d8a-f6d0-7fd0-b417-e8caec46028d\exec-5c46db70-99f9-4230-81c2-70bdfa524909.png` | `b00c95b969152833c3cc718d5011c6bb14ba25fe4176ca06ebba97845d42b123` | rejected：无毛服装、双人和棺材通过，持铲/扶棺左右手仍反转。 |
| C20 / 3 | `C:\Users\Administrator\.codex\generated_images\01a04d8a-f6d0-7fd0-b417-e8caec46028d\exec-22ef2ece-ad0e-47a1-8f85-893ed52f1fa6.png` | `6e16aa2223ccb51b9e2cba81f49120123df008f4e32a059dcc15b715068a27b4` | selected：韦训自身 RIGHT 手持短阔铲刃朝下、LEFT 手扶棺沿；李右手降至眉骨、左手护胸；无毛平布服装、人数、肢体、空间通过。 |

本轮新增 **6** 个 actual PNG，Task 5 built-in imagegen 累计由 61 增至 **67**；无图的 CLI usage/读取动作不计 generation attempt。C18、C19、C20 均以 approved job/digest formal complete，generationMode=`codex_builtin_imagegen`。真实 Tauri UI 逐镜点击“检查并导入结果”，三镜均为 `needs_review`，未 accept/reject；active output 均恰有 `candidate.png`、`result.json`、`import-receipt.json`。通过 Tauri 注册的 `copy_file_to` 更新三张投产 review copy，最终 SHA 与 formal candidate/result 一致：C18 `78b323879cdb117e6d05d5ce752b98b3c9cd32a4a246b92f601edfee65a9e0ff`、C19 `78aaba6407c4f755bea2672eded0272b4e0027ced7bca7ed456f00db7b2ce0f3`、C20 `6e16aa2223ccb51b9e2cba81f49120123df008f4e32a059dcc15b715068a27b4`。

### 23 镜连续性复核

逐张复核 C01–C23 当前 review copies：C01–C03 拍盖/听音与手位接续可读；C04 为宫宴回忆插叙；C05→C16 从被掳、封棺、发簪划缝/伤指、叩击、缺氧到外部重击递进完整；C17 仅窄缝与松钉，C18 才引入匕首，C19 才抬盖，C20 改用同一短柄宽铲并完成问话，C21–C23 的棺内/棺外、铲、暗板、air gap、玉佩与手伤职责继续可读。C18–C21 的韦训服装现均为无毛、无 plush 的磨旧黑布，消除先前毛领跳变。

已知非阻断 concern：C17→C18 李宝珠局部面部透视/发型轻微漂移；C18 韦训束髻、C19 披发、C20/C21 束髻造成相邻发型连续性轻微跳变；C19 墓室外背景较 C18/C20 更明亮。全部保留给最终用户逐图审阅，未因审美无限重生。

### Fresh governance

`.superpowers/sdd/verify-yingdi-e01-task5-final.mjs` fresh PASS：23 shots、23 active results、23 receipts、23 `needs_review`、0 generated、1 deterministic-crop mode、35/35 source digests、0 accepted paths、0 formal files；`shotPlanDigest=147a8812c110b6cfc016c9f8c70c6d58ad6058cd0fd30435f4e057e049295dbe`，`videoGeneration=blocked`，`DaSiWa_MiniMaxH3Video=pending_stage_b_gate`。未生成视频/音频，未写正式分镜/正式资产，未 commit。未提交治理项继续标记为 `deferred / branch not reproducible`。

## 最终独立复审与分支发布（2026-08-30）

本节取代上文各历史阶段的 `未 commit` / `deferred / branch not reproducible` 状态描述。最终独立复审结论为 **Approved**：Critical 0、Important 0；只保留 C17–C21 发型/透视与 C19 亮度的非阻断 Minor。当前 23 镜仍全部为 `needs_review`，视频门禁仍为 `blocked`，未接受任何资产或分镜，也未启动 `DaSiWa_MiniMaxH3Video`。

产品实现与回归测试已提交为 `54fdeda feat: harden Codex storyboard result workflow`。提交前 fresh verification：`npm run test:codex-storyboard-focused` 全部 PASS；`cargo test --offline --manifest-path src-tauri/Cargo.toml crop -- --nocapture` 为 3 passed / 0 failed；`cargo check --offline --manifest-path src-tauri/Cargo.toml` PASS（仅既有 dead-code warnings）。本报告、C23 deterministic-crop lineage 与 UI 导入证据作为独立审计提交保存；构建产物、inspection 图片、review diff 和临时 UI 辅助脚本均未纳入提交。
