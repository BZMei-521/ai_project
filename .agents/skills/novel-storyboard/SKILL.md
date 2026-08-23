---
name: novel-storyboard
description: |
  给 AI 短剧或漫剧出分镜、镜头表、关键帧和 MiniMax H3 视频提示词。
  把剧本节拍切成单次生成段与段内切点，支持关键场导演计划、资产状态决策、镜头首尾边界和跨镜连续性检查。
  产出 storyboard.json、Markdown、单页评审报告和 H3 投产包；可选用 imagegen 生成分镜图。
  Use when asked for 分镜、出分镜、镜头表、切镜、首帧、storyboard or shot list for AI drama.
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - Glob
metadata:
  license: Apache-2.0
  requires:
    bins:
      - node          # >= 18，只用标准库，无 npm 依赖
    optional:
      - codex         # 有才出首帧图；没有就只交提示词，其余照常
  runtimes:
    - claude-code
    - codex
---

## novel-storyboard

给 AI 短剧出**分镜**——管线里第一个直接面对视频模型的层。**前提刻在骨子里：镜头是生成出来的，多切一镜的成本几乎为零**，所以这里不心疼镜头数量，上限只有一个：视频模型单段生成的时长（默认 15 秒）。

**核心机制：镜头认领节拍。** 每个镜头声明它覆盖剧本某场的哪几个连续节拍（`sceneIndex` + `beats: [起, 止]`），镜头不许跨场次——换景必换镜。这让分镜和剧本的关系变成可机械对账的：

| 交付 | 解决什么 |
| --- | --- |
| 节拍认领 | 每个节拍被恰好一个镜头认领、顺序不乱——剧本改了重跑 validate，失效的镜头当场点名 |
| 关键场导演计划 | 先确定观众立场、信息时机、空间压力、最强画面、反应落点与声音策略，再切镜 |
| 首尾边界 + 资产状态 | 角色站位/朝向/目光/双手、道具持有/位置/状态有稳定引用；上镜结束必须等于下镜开始 |
| 可选动作摘要 | 传入 `novel-action-director` 的摘要后，分镜必须认领关键动作，首尾状态、左右手、道具、接触与结果不可改写 |
| 单镜头 ≤ 15 秒 | AI 视频单段生成上限，长对话在这里被强制拆镜（`params.maxShotSeconds` 按模型改） |
| 台词装得下 | 认领节拍的台词秒数 ≤ 镜头秒数——逐镜检查，不是拍脑袋 |
| 首帧 + 运动双提示词 | 首帧给图像模型（配合参考图），运动是模型无关的过程描述；景别、运镜是枚举，英文短语必须写进对应提示词 |
| **H3 视频提示词（每镜一段）** | MiniMax H3 的 I2VA 结构：固定对齐指令 + integrated_multimodal_description + overall_soundscape + non_diegetic_music。**认领节拍的台词逐字进 `<d>[Chinese] …</d>` 块**——对白、声景、配乐一段提示词全带上 |
| 生成批次单 | 同场景 + 同光照的镜头归一批，共用同一张环境参考图——AI 版的顺场表，脚本自动汇总 |
| 配音对齐单 | 每句台词对到镜号——TTS 音频贴到哪一段视频，脚本自动汇总 |

`{baseDir}` = 本文件所在目录。脚本 `{baseDir}/scripts/novel-storyboard.mjs`，零依赖，`node` 直接跑。

**边界（不做的事）**：不写戏不改台词（`novel-script` 的活）、不出场景/角色/道具设定图（`novel-art` / `novel-characters` 的活）、不做视频生成与剪辑合成。口型/唇形同步暂不管——那是生成管线的事。

---

### Step 0 — 定输入与范围

**script.json 是硬前提**——分镜离开剧本没有意义，validate/render 都必须给 `--script`。其余上游按有则用：

- `--outline` / `--cast`：提示词禁人名检查 + 报告里 C01 显示成人名
- `--art`：报告里 S01 显示成场景名 + 批次单嵌场景设定图
- `--actions`：可选的动作摘要；只提供动作事实与 `cameraIntent.mustShow`，不替代分镜的景别和运镜判断

**一次切几集**：跟剧本的批次走（剧本写到哪就分到哪），默认一批 ≤ 3 集。

### Step 1 — seed 工作底稿

```bash
node {baseDir}/scripts/novel-storyboard.mjs seed <script.json> --eps 1-3 \
  [--actions <storyboard-actions.json>] > <workdir>/storyboard.json
```

确定性展开：每场的节拍清单（编号、动作/台词、每拍秒数、说话人）进 `seedScenes`，这就是切镜时的工作底稿。**每拍几秒是算出来的，不要让模型重新估。** 传 `--actions` 时，匹配的 beat 只增加 `actionRefs` 和紧凑 `actionIntent`；不传时输出形状保持旧版。shots 留空，切镜才是模型的活。

### Step 2 — 逐集分段切镜

每集一份任务，能并发就并发。每份任务拿到：

- `{baseDir}/references/storyboard-pass.md` 和 `{baseDir}/references/schema.md`（读它们，照着做）
- `{baseDir}/references/directing-continuity.md`（`seed` 默认开启 `continuityVersion: 1`；按这份契约做资产决策、关键场计划和分镜首尾边界）
- 该集的 seedScenes 底稿 + 场景卡（art.json 的锚点与光照提示词）+ 角色卡（cast.json 的形象要点）

流程：先把本集角色/造型/道具状态收敛成 `assetDecisions`；只给真正改变体验的关键场写 `scenePlans`；再**按剧情单元分段**（每段 9–15 秒、不跨场），**段内切 2–5 秒的分镜**。每切先写 `purpose`、`startBoundary`、`endBoundary`，后写分镜图与 H3 提示词。相邻镜头的边界必须相等；真正有意的跳切才用 `continuityOverride` 写明理由。

**每段写一条 `h3Prompt`**，照 `{baseDir}/references/h3-prompt.md` 写（官方方法论的内化版，**不依赖任何外部 skill**）。官方口径默认英文（`promptLang` 可切中文），**每个镜头独立一行**。要点：首行对齐指令和 `[Shot k]` 切点时刻**由分镜秒数推导，一个字符都不许漂**（validate 逐字对账）；认领台词**逐字**进 `<d>[Chinese] …</d>`；每切的运镜词写进自己那一行；声景与配乐分进后两个字段——**声景也是动作指令，画面改了声景一起改**。

切完把 `seedScenes` 删掉。

### Step 3 — 校验 ⛔ 不能跳

```bash
node {baseDir}/scripts/novel-storyboard.mjs validate <storyboard.json> \
  --script <script.json> --outline <outline.json> --cast <cast.json> \
  [--actions <storyboard-actions.json>]
```

基础 18 道质量门全是代码：原 16 道门保持，新增**关键场导演计划完整性**和**镜头首尾边界 / 资产状态引用 / 同场跨镜连续性**。传 `--actions` 时再启用 4 道动作门：动作认领、首尾状态投影、手/道具/接触/结果事实、镜头意图边界。未传时旧项目仍是原 18 门、原输出形状；独立动作门报告会明确写“未提供 action.json，跳过”。

**有违规逐条修，改完重跑，直到通过。**

### Step 4 — 出分镜图（可选）

一切一张 16:9 关键帧，走 codex 内置 `$imagegen`，读 `{baseDir}/references/frame.md` 照契约做。要点：

- **没有 codex 就整步跳过**，只交提示词，报告显示占位不装有
- **参考图是命根子**：`-i` 挂上该段场景设定图（该光照状态）+ 画内角色的设定图 + 涉及道具的设定图，提示词只负责取景和此刻的姿态
- 一格一次调用绝不批量；输出 `./<段号>/f<切序>.png`（f1 = 主分镜图，每段一个文件夹）
- **默认先出第一段的整套分镜图给用户看效果**（3–5 张），确认画风和正反打构图再往后补——一集约 30–40 格，错了浪费的是整批
- 单个失败跳过不阻断，最后汇总说明

### Step 5 — 输出与汇报

```bash
cd <输出目录>
node {baseDir}/scripts/novel-storyboard.mjs render <剧名>-storyboard.json --md \
  --script <script.json> --outline <outline.json> --art <art.json> > <剧名>-storyboard.md
node {baseDir}/scripts/novel-storyboard.mjs render <剧名>-storyboard.json --html \
  --script <script.json> --outline <outline.json> --art <art.json> > storyboard-report.html
```

报告界面语言用 `--lang zh|en` 指定（优先级 `--lang` > JSON 顶层 `lang` 字段 > 默认中文）——只切界面标签，与 `promptLang`（H3 提示词语言）互相独立。`render` 自动去 `images/<镜号>-frame.png` 找首帧（批次单还会找场景设定图），**先出图再 render**。报告含：KPI 带、分镜节奏带、关键场导演计划、分集分镜表（主/子分镜图、逐切分镜行、可展开的连续性边界、H3 提示词）、生成批次单、配音对齐单、质量门、导出 JSON。Markdown 版同样保留导演计划和边界 JSON。

汇报一句话说清：几集几镜、总时长 vs 目标、几个生成批次、出了几张首帧、报告路径；没过的门和没出的图明说。

最终落地：

```
<输出目录>/
├── <剧名>-storyboard.json
├── <剧名>-storyboard.md
├── storyboard-report.html         ← 双击就能开
├── manifest.json                  ← export 生成
└── E01-01/                        ← 一段一个文件夹 = 一次 H3 生成的全部材料
    ├── f1.png                     ← 主分镜图（有 codex 才有）
    ├── f2.png …                   ← 子分镜图
    └── prompt.md                  ← H3 提示词（export 生成）
```

---

## 六个 skill 的接力（管线到此闭环）

```
novel-characters → cast.json       （谁：角色设定图）
novel-outline    → outline.json    （什么：结构与分集）
novel-art        → art.json        （哪里：场景/道具设定图）
novel-script     → script.json     （戏：场次、节拍、台词）
novel-action-director → action.json / storyboard-actions.json（怎么动：表演、接触、受力与首尾状态，可选）
novel-storyboard → storyboard.json （怎么拍：镜头、首帧、批次）
```

分镜是消费端：seed 吃 script.json，分镜图出图吃 art 和 characters 的设定图当参考，H3 提示词直接下单给视频模型，配音对齐单接 script 台词本的 TTS 产物。五份 JSON 各自的报告都带导出按钮，改完都能喂回各自的 render/validate。

## 边界

- 报告界面内置中英（`--lang`，默认中文）；提示词语言由 `promptLang` 单独控制（默认英文）
- 秒数是**下给视频模型的生成时长**不是估算——段上限按你的模型改 `params.maxSegmentSeconds`，切的节奏区间改 `min/maxCutSeconds`
- 口型/唇形同步暂不管——那是生成管线的事
- 分镜图不追求一次到位——它是给视频模型的构图锚，构图对、资产对就够，微调交给重生成

## 自测

```bash
node {baseDir}/scripts/selftest.mjs
```

221 项断言，不调模型、不花额度。基础 18 道质量门和可选 4 道动作门都有击穿用例。改完脚本先跑这个。

## 自带样例

`{baseDir}/examples/渡口-storyboard.json`：《渡口》第 1 集完整分镜——10 段 34 切认领剧本全部 35 拍，平均 3.5 秒一切，共 119 秒 / 目标 120 秒，2 个生成批次，每段带完整的 H3 视频提示词（多图对齐 + 切点时刻全部对账通过）。当质量基准，也是自测夹具。
