# storyboard.json 结构

三层：**集 → 段（segment）→ 分镜（cut）**。

- **段** = 一次视频生成调用，总时长 ≤ `maxSegmentSeconds`（默认 15 秒），不跨场次——换景必开新段
- **分镜** = 段内的一次剪切，`minCutSeconds`–`maxCutSeconds`（默认 2–5 秒），各自认领剧本节拍、带景别运镜和一张分镜图
- **分镜图** = 每个分镜一张关键帧：第 1 切的是**主分镜图**（钉在 0.00 秒），其余是**子分镜图**（各钉在自己的切点时刻）。**每段一个文件夹**：`<段号>/f<切序>.png` + `prompt.md`（export 生成，内容就是 h3Prompt）

```json
{
  "source": "渡口",
  "style": "realistic",
  "promptLang": "zh",
  "continuityVersion": 1,
  "correspondenceVersion": 1,
  "assetDecisions": [ ... ],
  "params": { "maxSegmentSeconds": 15, "minCutSeconds": 2, "maxCutSeconds": 5, "maxOnScreen": 3, "tolerance": 0.15 },
  "episodes": [ { "ep": 1, "directorCriticalScenes": [2], "scenePlans": [ ... ], "segments": [ ... ] } ]
}
```

`promptLang` 可省略（**默认 `en`——官方规范口径**）：整条英文、禁角色名，台词在 `<d>[Chinese]` 里保留原文。设成 `zh` 可切整条中文（对齐指令、字段名、镜头标记都有中文版，人名放行）——偏离官方推荐的备选项。`style` 可省略（默认 `realistic`），预设与角色/场景 skill 同名对齐（`realistic` / `ghibli`），对应的英文短语（如 `cinematic film still`）必须出现在**每条**分镜图提示词里——同一部剧的分镜图不许画风漂，门查。

`seed` 默认写入 `continuityVersion: 1`。该版本要求资产决策、关键场导演计划和逐切首尾边界。旧文件没有 `continuityVersion` 时以向后兼容模式读取；不会凭空生成边界。完整创作规则见 [directing-continuity.md](directing-continuity.md)。

`correspondenceVersion` 可省略；**只有字段完全缺失**时才走 legacy。字段存在时仅接受数值 `1`，`null`、其他数字和字符串 `"1"` 都失败。v1 启用逐切多模态对应门，并要求每个 `cut` 有 `correspondence`。它消费 cast 的 approved `identityModule`、可选 actions/预演、cut 认领、完整边界和道具；任何 `cut.actionRefs` 非空时都必须提供可解析的 actions 上下文。字段、权威顺序、绑定唯一性、空镜、证据归属与参考槽位规则见 [multimodal-correspondence.md](multimodal-correspondence.md)。

## assetDecisions（根层）

```json
{ "id": "AS-P01-OPEN", "asset": "P01", "decision": "new_variant", "state": "open, letter visible", "reason": "第 2 场打开后持续" }
```

`decision` 只能是 `reuse / new_variant / new_asset / unresolved`。`id` 全文件唯一；边界里的 `lookRef / stateRef` 必须指向这张表中同一 `asset`、且不是 `unresolved` 的记录。

## episode 的导演计划

`directorCriticalScenes` 是真正需要先定整场观看方式的 `sceneIndex` 数组；没有就给 `[]`。其中每场必须在 `scenePlans` 中恰好有一份已选方案：

```json
{
  "id": "E01-SC02-PLAN",
  "sceneIndex": 2,
  "audiencePosition": "跟主角同站，暂不知对手已看穿",
  "informationTiming": "先显示道具异常，再落对手反应",
  "spatialPressure": "人物从门外被逼入狭窄室内",
  "strongestImage": "两人被门框分在明暗两侧",
  "reactionLanding": "落在对手瞬间收紧的眼神",
  "soundStrategy": "识别瞬间抽空环境声，留一声金属轻响"
}
```

## segment（段）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 段号 `E01-01`：集号 + 两位序号，**按顺序连号**。它就是素材文件名（`E01-01.mp4` / `E01-01-f1.png`） |
| `sceneIndex` | int | 这一段在剧本该集的第几场（1 起）。段内全部分镜同场 |
| `cuts` | cut[] | 段内分镜，按时间顺序。段总秒数 = 分镜秒数之和，**不单独存**——少一处会漂的冗余 |
| `h3Prompt` | string | **一段一条 H3 视频提示词**，正文语言跟 `promptLang`（默认中文），结构见 `references/h3-prompt.md` |
| `note` | string | 备注，可选 |

## cut（分镜）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `beats` | [int, int] | 认领该场第几拍到第几拍（含两端）。**每个节拍必须被恰好一个分镜认领**，按顺序、连续 |
| `seconds` | number | 分镜时长，2–5 秒——短剧的注意力节奏是硬门。认领节拍的台词秒数必须装得下 |
| `size` | enum | 景别：`extreme-wide` 大远景 / `wide` 全景 / `medium` 中景 / `close` 特写 / `extreme-close` 大特写 |
| `camera` | enum | 运镜，**直接用 H3 官方词表**（原样字符串）：`Static Shot` `Push In` `Pull Out` `Zoom In/Out` `Pan Left/Right` `Truck Left/Right` `Tilt Up/Down` `Pedestal Up/Down` `Arc Shot` `Tracking Shot` `Shake Slightly/Strongly` `POV` `Roll Clockwise/Counterclockwise` |
| `characters` | string[] | 画内人物（C 编号），始终必须是数组且必须 ⊆ 剧本该场人物；空镜给 `[]`。超过 `maxOnScreen` 时必须带 `note` |
| `props` | string[] | 画内道具（P 编号），必须 ⊆ 剧本该场道具。可省略；一旦出现就必须是数组，不能用 `null`、对象或字符串代替 |
| `frame` | string | **分镜图英文提示词**：这一格关键帧的样子。景别英文短语必须在里面；禁角色名 |
| `purpose` | string | v1 必填：观众必须注意/感受什么，这一切改变什么 |
| `startBoundary` | object | v1 必填：镜头开始的完整物理状态 |
| `endBoundary` | object | v1 必填：镜头结束的完整物理状态 |
| `continuityOverride` | string | 仅有意跳切/时间跳跃时可选，写明省略了什么及不误读的理由 |
| `actionRefs` | string[] | 传 `--actions` 时必填：本切认领的动作 ID。动作所在 beat 必须落在本切 `beats` 区间，且全板恰好认领一次 |
| `actionStateProjection` | object | 传 `--actions` 且本切覆盖关键动作时必填：投影动作首态、末态和必须看清的信息；不得改写动作事实 |
| `cameraPlan` | object | 可选高级镜头计划；只在镜头运动确实承担叙事任务时填写，字段见下表 |
| `impactPresentation` | object | 上游动作带 `impactEvidence` 时必填；只决定打击证据怎样被观众读到，不改写受力事实 |
| `correspondence` | object | 仅 `correspondenceVersion: 1` 时必填：本切的节拍、approved 人物身份、动作/预演、首尾位置、场景、道具与 must-show 快照；字段见 [multimodal-correspondence.md](multimodal-correspondence.md) |
| `note` | string | 备注，可选 |

### cameraPlan（可选）

| 字段 | 允许值 / 要求 |
| --- | --- |
| `purpose` | 非空；这次移动让观众多知道或多感受什么 |
| `path` | 非空；空间路径，如 `push-in / arc-left / lateral-right` |
| `speed` | `very-slow / slow / moderate / fast` |
| `amplitude` | `micro / short / medium / large` |
| `subjectRelation` | 非空；镜头与主体关系，如 `approach / follow / reveal / withdraw` |
| `stabilization` | `locked / stable / gimbal / handheld` |
| `foregroundOcclusion` | 非空；前景遮挡策略，无则写 `none` |
| `startSize` | `SHOT_SIZES` 现有键之一 |
| `endSize` | `SHOT_SIZES` 现有键之一 |

`cameraPlan` 不新增 H3 运镜枚举。最终 `camera` 仍只能从现有 `CAMERA_MOVES` 选择，计划只是选择依据。普通对话、信息已清楚或运动没有新增信息时可以完全省略。

### impactPresentation（动作带 impactEvidence 时）

| 字段 | 允许值 / 要求 |
| --- | --- |
| `actionId` | 必须匹配本切 `actionRefs` 中带 `impactEvidence` 的动作 |
| `contactVisibility` | `clear / occluded-with-alternative`；遮挡时必须用替代证据传达接触 |
| `impactPulse` | `none / brief`；短促打击脉冲，不把整段做成抖动 |
| `informationOrder` | 数组；必须含 `contact`，并至少含 `latency / support-change / center-of-mass / imbalance` 之一 |
| `overlapReplays` | 整数 `0–2`；每次重叠必须提供新信息 |
| `slowMotionPhase` | `none / opportunity / post-contact / aftermath`；禁止整段发力慢放 |

打击呈现的事实来源只有上游 `impactEvidence`。光效、火花、刀光、音效都只能放大已经成立的接触—迟滞—重心变化，不能代替受力反馈。

### boundary

```json
{
  "spatialAnchor": "S01-船舱口",
  "workingSide": "A",
  "screenDirection": "none",
  "characters": {
    "C01": { "position": "舱口右侧", "facing": "面向 C02", "gaze": "P01", "leftHand": "扶舱门", "rightHand": "悬在皮箱上方", "lookRef": "AS-C01-DEFAULT" }
  },
  "props": {
    "P01": { "holder": "C02.bothHands", "position": "C02 胸前", "stateRef": "AS-P01-CLOSED" }
  }
}
```

边界跟踪该场全部角色与道具，包括当前在画外但下镜会继续的资产。同场相邻切必须满足 `previous.endBoundary == next.startBoundary`；否则必须有非空 `continuityOverride`。

## 可选动作投影

`novel-action-director export` 的摘要通过 `--actions` 传入。seed 会在匹配 beat 上增加动作引用；完成分镜时把对应引用放入 cut：

```json
{
  "actionRefs": ["E01-S01-B01-A01"],
  "actionStateProjection": {
    "startState": {"characters": {}, "props": {}},
    "endState": {"characters": {}, "props": {}},
    "mustShow": ["右手与铜扣接触", "铜扣弹开结果"]
  }
}
```

- `startState` 取本切第一个关键动作的首态，`endState` 取最后一个关键动作的末态。
- 左右手、道具状态、接触点与动作结果必须和摘要一致；分镜可以拆分观看角度，不能改写事实。
- `mustShow` 是信息约束，不是具体镜头命令。cut 的 `size`、`camera`、构图与节奏仍由分镜决定。
- 不得把动作摘要中的 `cameraIntent` 原样塞进 cut，也不得在 `actionStateProjection` 内新增 `camera`、`lens`、`shotSize` 等字段。
- 未传 `--actions` 时，`actionRefs` 和 `actionStateProjection` 都是可选，旧文件行为不变。
- 动作摘要带 `impactEvidence` 时，同切必须补 `impactPresentation`；摘要没有打击证据时不强制。

## h3Prompt 的结构（三道门盯着，两处逐字对账）

写法见 `references/h3-prompt.md`（官方方法论的内化版，本 skill 自包含不依赖外部 skill）。骨架：

```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 2) aligns with the 3.00-second mark of the target video; ….

integrated_multimodal_description:
[Shot 1] Cinematic, live-action, …（首格锚定 → 动作 → 运镜 → 对白）
[Shot 2] At 00:03.000, the camera cuts to …（每个镜头独立一行，切点时刻开头）

overall_soundscape: …（环境声与动作声，1–4 句）

non_diegetic_music: …（1–3 句，没有就 N/A）
```

确定性检查的五条：

1. **首行对齐指令整行由分镜结构按 `promptLang` 推导**（`h3AlignmentLine`）：多分镜的段把每张分镜图钉在自己的切点秒数上；单分镜的段用固定句式。validate **逐字对账**——分镜秒数一改，旧指令立刻对不上
2. 三个字段名齐全且按序；描述正文有 `[Shot 1]`
3. **每个 `[Shot k]`（k ≥ 2）必须带切点时刻 `At 00:0X.XXX,`，且等于前面分镜秒数的累计**——节奏写在纸上就必须和提示词一致
4. 认领节拍的每句台词**逐字**进 `<d>[Chinese] …</d>`；说话人身份音色语气用英文写在 `<d>` 外；画外音用 `says in an off-screen voiceover` 并注明唇形闭合
5. `<d>` 块之外的正文语言与 `promptLang` 一致（中文写成英文、英文混进中文都拦）；英文模式禁角色名，中文模式放行（身份靠分镜图锚定）；每个分镜的运镜词（中文用词表中文词如「推」「固定」，英文用官方词）必须出现在**自己的 [Shot k] 段落**里

## 时长约束链

台词秒数（按剧本语速折算）≤ 分镜 `seconds` ≤ 5 秒；段 Σ分镜 ≤ 15 秒；集 Σ段 落在剧本 `targetSeconds` ±15%。全部由 validate 逐级对账。
