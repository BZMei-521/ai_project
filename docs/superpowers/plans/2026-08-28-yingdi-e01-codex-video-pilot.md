# 《影帝他总想对我图谋不轨》第1集 Codex 分镜与视频样片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用现有第1集36个剧情节拍制作22–24张可审核 Codex 分镜，并在用户接受全部正式分镜后生成约2分钟的逐镜视频、音频与合成预览。

**Architecture:** 流程分为 Stage A（资产、分镜、用户审核）和 Stage B（视频、音频、合成）。所有媒体任务以 JSON manifest、不可覆盖候选、摘要和显式状态连接；Stage B 只能读取 Stage A 用户接受后的正式分镜，不读取 `needs_review` 候选。

**Tech Stack:** Storyboard Pro Tauri/React 桌面应用、Codex built-in image generation、Codex task-package provider、现有本地视频生成 provider、JSON/Markdown 投产清单、24fps 16:9 时间线。

## Global Constraints

- 剧情唯一依据是现有改编剧本第1集，36个节拍、106.9秒；不扩展到第2集或原著第2章。
- 镜头总数必须在22–24之间，目标为23镜；剧情节拍顺序不得改变。
- 输出画面统一16:9、24fps；逐镜时长约3–6秒；合成预览约120秒。
- Codex 生成的人物、场景、道具和分镜均先进入 `needs_review`，不得自动接受。
- Stage A 完整审核通过前禁止启动任何视频生成任务。
- 视频任务只能读取用户接受后的正式分镜路径。
- 不新增外部 API key、未授权网络服务、watcher、自动批量接受或自动发布路径。
- 单项失败只重试该资产或该镜头，不覆盖已经接受的结果。
- 小说正文和媒体写入 `C:\Users\Administrator\Desktop\小说`；代码仓库只保存设计、计划与必要的软件实现，不提交生成媒体。
- 主代码工作树为 `C:\Users\Administrator\Desktop\ai_project\.worktrees\codex-storyboard-task-package`；不得提交既存 generated schema、`tsconfig.app.tsbuildinfo` 或 `.superpowers/sdd` 临时文件。

---

## File and Directory Map

### Existing read-only inputs

- `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\剧本\影帝他总想对我图谋不轨-script.md`：第1集文本依据。
- `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\分镜\影帝他总想对我图谋不轨-storyboard.seed.json`：36个节拍与106.9秒时间依据。
- `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\人物\images\李宝珠-sheet.png`：李宝珠身份基准。
- `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\人物\images\韦训-sheet.png`：韦训身份基准。
- `C:\Users\Administrator\Desktop\小说\应用项目\影帝他总想对我图谋不轨_e01空间分镜试验.sbproj\spatial-control\`：棺木空间预演依据。

### New production records

- Create `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\run-manifest.json`：整集权威状态和摘要。
- Create `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\asset-manifest.json`：资产候选、用途、状态与正式路径。
- Create `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\shot-plan.json`：23镜节拍映射、时长、参考绑定和视频策略。
- Create `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\review-package.md`：用户审核清单。
- Create `C:\Users\Administrator\Desktop\小说\应用项目\影帝他总想对我图谋不轨_E01样片.sbproj\`：独立样片项目，不修改空间试验项目。

### New media roots

- `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\图片\E01\资产候选\`
- `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\图片\E01\正式资产\`
- `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\图片\E01\分镜候选\`
- `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\图片\E01\正式分镜\`
- `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\视频\E01\逐镜\`
- `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\视频\E01\成片\`
- `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\音频\E01\`

---

### Task 1: 建立 E01 权威运行清单与只读输入基线

**Files:**
- Create: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\run-manifest.json`
- Create: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\asset-manifest.json`
- Create: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\shot-plan.json`
- Verify only: existing script, seed JSON, character sheets and spatial-control files

**Interfaces:**
- Consumes: 第1集剧本、36-beat seed、现有人物和空间资产。
- Produces: `run-manifest.json` schema `yingdi_e01_run_v1`，后续任务只通过该文件判断阶段与审核门。

- [ ] **Step 1: 读取生产技能说明**

完整读取并遵守 `novel-art`、`novel-action-director`、`novel-storyboard`、`imagegen`；Stage B 开始前再读取 `novel-edit-director` 和视频 provider 对应技能。记录每个技能对文件命名、提示词和审核的硬性要求。

- [ ] **Step 2: 验证输入不变性**

对剧本、seed、李宝珠 sheet、韦训 sheet 和空间预演关键文件计算 SHA-256。Expected：seed 中 `ep=1` 恰好36个 beats，seconds 合计106.9；输入文件全部可读且不被修改。

- [ ] **Step 3: 创建隔离目录**

创建 File and Directory Map 中的 `投产/E01`、图片、视频、音频目录，以及独立 `影帝他总想对我图谋不轨_E01样片.sbproj`。不得复制或覆盖原 `e01空间分镜试验.sbproj`。

- [ ] **Step 4: 写入运行清单**

`run-manifest.json` 使用以下完整顶层结构：

```json
{
  "schema": "yingdi_e01_run_v1",
  "episode": 1,
  "sourceBeatCount": 36,
  "sourceSeconds": 106.9,
  "targetShotCount": 23,
  "targetFps": 24,
  "targetAspectRatio": "16:9",
  "stage": "asset_inventory",
  "assetReview": "pending",
  "storyboardReview": "blocked",
  "videoGeneration": "blocked",
  "sourceDigests": {},
  "createdAt": "2026-08-28T16:00:00.000Z",
  "updatedAt": "2026-08-28T16:00:00.000Z"
}
```

写入前用 PowerShell `$now=(Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")` 取得实际时间，同时写入 `createdAt` 和 `updatedAt`；上面的固定时间只说明序列化格式，不得作为实际运行时间。`asset-manifest.json` 初始化为 `{"schema":"yingdi_e01_assets_v1","items":[]}`，`shot-plan.json` 初始化为 `{"schema":"yingdi_e01_shots_v1","shots":[]}`。

- [ ] **Step 5: 验证初始状态**

解析三个 JSON。Expected：schema 正确、23镜目标明确、`videoGeneration=blocked`、source digests 与实际文件一致、原输入的摘要在步骤前后不变。

### Task 2: 将36个节拍编译为23镜正式镜头计划

**Files:**
- Modify: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\shot-plan.json`
- Create: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\shot-plan.md`
- Modify: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\run-manifest.json`

**Interfaces:**
- Consumes: 36个 ordered beats 与五段内容设计。
- Produces: 23个 `ShotPlan` 条目，供资产盘点、Codex 分镜和视频编译共同使用。

- [ ] **Step 1: 建立五段镜头预算**

固定预算为 `[5,4,6,4,4]`，对应棺中惊醒、含元殿闪回、绝境自救、回应开棺、凤凰胎悬念。Expected：合计23。

- [ ] **Step 2: 使用动作导演深化镜头动作**

对每镜明确开始姿态、动作过程、结束姿态、受力对象、双手状态、微表情和可见肢体。拍棺、划缝、折簪、受伤、撬棺必须有具体接触点，不能只写情绪词。

- [ ] **Step 3: 写入 ShotPlan 条目**

每个条目必须具有：

```json
{
  "shotId": "E01-S01-C01",
  "segment": 1,
  "beatIds": [1, 2],
  "durationSeconds": 5.6,
  "title": "棺中惊醒",
  "characters": ["li-baozhu"],
  "location": "coffin-interior",
  "props": ["coffin", "bronze-nails"],
  "framing": "close-up",
  "camera": "slow-push-in",
  "actionStart": "李宝珠闭眼仰卧，双臂贴近身体",
  "actionEnd": "她猛然睁眼并将双掌推向棺盖",
  "dialogue": "放我出去！有人吗！",
  "voiceMode": "dialogue",
  "imageMode": "codex_task_package",
  "videoMode": "single_frame",
  "referenceAssetIds": [],
  "storyboardStatus": "blocked",
  "videoStatus": "blocked"
}
```

其余22镜使用连续 `C02`–`C23`，不能复用 ID；`beatIds` 合集必须恰好覆盖1–36且每个 beat 仅出现一次。

- [ ] **Step 4: 校验时长和剧情覆盖**

Expected：23镜、五段预算 `[5,4,6,4,4]`、beat 1–36无缺失无重复、镜头时长合计106.9秒。额外约13.1秒只由片头建立、段间停顿和结尾 hold 在合成任务添加，不篡改原 beat 时长。

- [ ] **Step 5: 更新运行状态**

把 `run-manifest.stage` 改为 `asset_inventory`，记录 `shotPlanDigest` 和实际更新时间。

### Task 3: 完成资产盘点与 Codex 资产候选

**Files:**
- Modify: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\asset-manifest.json`
- Modify: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\shot-plan.json`
- Create media root: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\图片\E01\资产候选\`；每个子目录名严格等于 manifest 中通过 `^[a-z0-9-]+$` 校验的 `assetId`
- Preserve originals: existing character sheets and spatial-control assets

**Interfaces:**
- Consumes: 23个 ShotPlan、现有角色 sheets、空间预演。
- Produces: 可按 ID 引用的正式来源或 `needs_review` 资产候选。

- [ ] **Step 1: 建立精确资产清单**

至少包含：李宝珠身份、韦训身份、晚翠、蒙面拖行者、李宝珠棺中破损礼服、密闭棺内、墓室外部、含元殿宫宴、冰冷石阶、梓木棺、铜钉、完整发簪、折断发簪、桂花酒杯、匕首、盗墓短铲、凤凰纹暗板、凤凰玉佩。复用项状态为 `existing`，缺失项状态为 `planned`。

- [ ] **Step 2: 为每个缺失资产编译 imagegen 请求**

人物候选使用身份/服装约束；场景候选必须无人物并说明空间用途；道具候选使用中性背景或定位图。每项请求记录 `assetId`、`kind`、参考路径、参考用途、逐图 instruction、compiled prompt 和 expected 16:9 或适合资产的透明/中性画布规格。

- [ ] **Step 3: 逐项调用 Codex built-in image generation**

每次生成前用 `view_image` 检查所有本地参考图；调用 `image_gen__imagegen` 时传入最小必要参考集合。每个输出复制到 `Join-Path $assetCandidateRoot (Join-Path $assetId 'candidate.png')`，其中 `$assetId` 来自刚验证的 manifest 条目；保留 Codex 原始 generated-images 文件。

- [ ] **Step 4: 写入摘要和候选状态**

每个候选条目记录 `candidatePath`、SHA-256、width、height、mimeType、references、`status=needs_review` 和视觉检查 notes。不得填 `acceptedPath`。

- [ ] **Step 5: 内部技术筛查**

拒绝无法解码、人物数量错误、明显多肢、场景含不应出现人物、道具结构错误或时代风格错误的候选；只对失败资产单独重生。内部筛查通过不等于用户接受，状态仍为 `needs_review`。

- [ ] **Step 6: 将候选作为 provisional reference 映射到镜头计划**

在 `referenceAssetIds` 中按镜头实际需要绑定资产 ID，并添加 `referenceAuthority="provisional_until_user_review"`。不得把候选复制到 `正式资产`。

### Task 4: 建立独立 E01 样片项目与23个 Codex 分镜任务

**Files:**
- Create/Modify: `C:\Users\Administrator\Desktop\小说\应用项目\影帝他总想对我图谋不轨_E01样片.sbproj\project.json`
- Create/Modify: `C:\Users\Administrator\Desktop\小说\应用项目\影帝他总想对我图谋不轨_E01样片.sbproj\snapshot.json`
- Create packages under: `C:\Users\Administrator\Desktop\小说\应用项目\影帝他总想对我图谋不轨_E01样片.sbproj\codex-storyboard-jobs\`；子目录由正式 exporter 返回的 `jobId` 决定
- Modify: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\shot-plan.json`

**Interfaces:**
- Consumes: 23个 ShotPlan 与 provisional asset references。
- Produces: 23个 queued Codex task packages，镜头身份与 package lineage 一一对应。

- [ ] **Step 1: 验证桌面功能分支**

在代码工作树运行：

```powershell
npm run test:codex-storyboard-focused
npx tsc -b
```

Expected：全部退出码0。Node 在 Windows workspace sandbox 出现 `EPERM` 时使用获批的沙箱外本地执行，不改变测试内容。

- [ ] **Step 2: 创建样片项目快照**

把23镜 ShotPlan 映射到23个 shot；每个 shot 保存 title、durationFrames=`round(durationSeconds*24)`、image prompt、video prompt、reference bindings、`generatedImagePath=""` 和 `videoStatus="blocked"`。不得从旧试验项目继承已接受的 f1–f5 路径作为新项目正式输出。

- [ ] **Step 3: 启动真实 Tauri 桌面实例**

从功能工作树运行桌面应用，打开 `影帝他总想对我图谋不轨_E01样片.sbproj`。确认当前项目 marker 指向样片项目；不得改写其他项目的 snapshot。

- [ ] **Step 4: 为每镜设置有序参考图**

顺序固定为 spatial → pose → face → body/costume → prop → style → lighting。每张参考明确 usage 和 instruction；`style_only` 必须写明不控制构图、姿态、解剖和身份。

- [ ] **Step 5: 从正式 UI 导出23个任务包**

每个任务包状态必须为 `queued`，request 中 shot ID 唯一、reference 1–16张、至少一个 spatial authority 和一个 identity/costume reference；记录 package path 与 request digest 到 ShotPlan。

### Task 5: 生成、回写并导入23张分镜候选

**Files:**
- Create: package `outputs/candidate.png`、`outputs/result.json`、`outputs/import-receipt.json`
- Copy for review: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\图片\E01\分镜候选\E01-S01-C01.png` 至 `E01-S01-C23.png`
- Modify: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\shot-plan.json`

**Interfaces:**
- Consumes: queued task packages 的 inspected snapshots 与 exact compiled prompt。
- Produces: 23张 `needs_review` 分镜候选，不产生正式分镜。

- [ ] **Step 1: 逐包运行 inspect**

```powershell
$jobRoot='C:\Users\Administrator\Desktop\小说\应用项目\影帝他总想对我图谋不轨_E01样片.sbproj\codex-storyboard-jobs'
Get-ChildItem -LiteralPath $jobRoot -Directory | Sort-Object Name | ForEach-Object {
  node scripts/run-codex-storyboard-job.mjs inspect --package $_.FullName
}
```

对实际23个 package path 逐一执行并把每次 JSON 输出绑定回对应 ShotPlan；Expected：job/shot identity 正确、reference 顺序和摘要正确、compiled prompt 含 mandatory hard constraints。

- [ ] **Step 2: 逐张检查 staged references**

每个 package 的每张 `referencedImagePaths` 都必须用 `view_image` 查看。发现路径错误、空间图与镜头不匹配或 style 图构图吸引力过强时，返回 Task 4 重导该镜任务包。

- [ ] **Step 3: 调用 Codex built-in image generation**

对每个镜头仅使用该 package inspect 返回的 staged paths 和 exact compiled prompt。一次任务生成一张候选，不跨镜共享结果，不自行改写 prompt。

- [ ] **Step 4: 通过 complete 发布 package 结果**

```powershell
$packagePath=$currentShot.packagePath
$candidatePath=$currentShot.codexGeneratedImagePath
$inspectionManifestPath=$currentShot.inspectionManifestPath
node scripts/run-codex-storyboard-job.mjs complete --package $packagePath --candidate $candidatePath --inspection-manifest $inspectionManifestPath
```

Expected：candidate/result 摘要匹配、result generationMode 为 `codex_builtin_imagegen`、completedAt 为规范 RFC3339。

- [ ] **Step 5: 从真实 UI 检查并导入**

每镜点击“检查并导入结果”。Expected：历史项和 receipt 都为 `needs_review`，显示接受/拒绝按钮，shot 的正式 `generatedImagePath` 仍为空。

- [ ] **Step 6: 技术与连续性筛查**

逐张检查身份、人数、肢体、服装、空间、道具、受力、16:9和相邻连续性。失败镜头在 ShotPlan 标记 `rejected_internal` 并只重做该镜；通过项仍标记 `needs_review_user`。

### Task 6: 生成 Stage A 用户审核包并停止

**Files:**
- Create: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\review-package.md`
- Create: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\图片\E01\E01-assets-contact-sheet.png`
- Create: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\图片\E01\E01-storyboards-contact-sheet.png`
- Modify: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\run-manifest.json`

**Interfaces:**
- Consumes: 全部技术筛查通过的资产和23张分镜候选。
- Produces: 用户可逐项确认的 Stage A 审核包；不触发视频。

- [ ] **Step 1: 创建资产联系表**

按人物、场景、道具分组，显示 asset ID、候选图、用途、关键检查项和候选摘要。

- [ ] **Step 2: 创建23镜联系表**

按 C01–C23 顺序排版，标注镜头标题、beat IDs、时长、对白/心声、候选摘要和连续性 notes。

- [ ] **Step 3: 写 review-package.md**

列出每个资产和镜头的 `接受 / 拒绝 / 修改说明` 空位，并明确总审核结论只有 `approved` 才能解除 Stage B。

- [ ] **Step 4: 锁住视频门**

更新 `run-manifest.stage="stage_a_user_review"`、`assetReview="needs_review"`、`storyboardReview="needs_review"`、`videoGeneration="blocked"`。验证样片项目不存在已排队或运行的视频任务。

- [ ] **Step 5: 向用户展示审核包并停止执行**

展示两张 contact sheet 和 review-package 路径，等待用户逐项或批量决定。没有用户明确“资产和分镜全部通过，开始视频”的回复时，任何代理不得执行 Task 7。

---

## HARD GATE: Stage A 用户审核

Task 7–9 的唯一入口条件：

1. 所有必要资产具有 `status=accepted` 和正式路径；
2. 23张分镜均具有 `status=accepted` 和正式路径；
3. `run-manifest.assetReview="approved"`；
4. `run-manifest.storyboardReview="approved"`；
5. 用户在当前会话明确要求开始生成视频。

任一条件不满足时必须停止，不得推测授权。

---

### Task 7: 发布正式资产/分镜并预检视频 provider

**Files:**
- Copy accepted media to: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\图片\E01\正式资产\`、`C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\图片\E01\正式分镜\`
- Modify: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\asset-manifest.json`
- Modify: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\shot-plan.json`
- Modify: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\run-manifest.json`
- Modify: sample `.sbproj\snapshot.json` through production UI only

**Interfaces:**
- Consumes: 用户接受决定与候选 lineage。
- Produces: 摘要绑定的正式媒体路径和视频 provider readiness 结论。

- [ ] **Step 1: 验证硬门五项条件**

Expected：全部为真；否则停止并报告缺失项。

- [ ] **Step 2: 通过正式 UI 接受候选**

逐项执行接受动作，复制/绑定正式资产和分镜；验证正式文件摘要与被接受候选一致、lifecycle 为 accepted、23个 shot 的 `generatedImagePath` 均指向正式分镜。

- [ ] **Step 3: 读取视频与剪辑技能**

完整读取视频 provider 技能、`novel-edit-director` 和项目现有视频工作流说明。不得使用未在当前项目配置的网络 provider。

- [ ] **Step 4: 执行 provider readiness 检查**

从 Storyboard Pro 运行正式环境体检。Expected：视频 provider、工作流文件、模型、输入目录、输出目录和硬件能力均 ready。若仍为 `manual_fallback` 或 unavailable，停止在正式分镜阶段，报告具体缺项，不尝试生成。

- [ ] **Step 5: 更新运行状态**

provider ready 后设置 `run-manifest.stage="video_generation"`、`videoGeneration="ready"` 并记录 provider/profile/version；否则保持 `videoGeneration="blocked"`。

### Task 8: 编译并生成23个逐镜视频

**Files:**
- Modify: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\shot-plan.json`
- Create: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\视频\E01\逐镜\E01-S01-C01.mp4` 至 `E01-S01-C23.mp4`
- Create: 样片项目的视频任务记录与日志

**Interfaces:**
- Consumes: 23张正式分镜、accepted asset bindings、provider readiness。
- Produces: 23个可审核视频候选。

- [ ] **Step 1: 确定单帧与首尾帧策略**

情绪/呼吸/视线用 single-frame；拍棺、划缝、折簪、受伤、重击、撬棺和关键转场用 first-last。为 first-last 镜头生成或选择经过审核的尾帧，未审核尾帧不得作为视频输入。

- [ ] **Step 2: 编译视频提示词**

每镜写入身份、服装、空间、动作起止、表情弧、镜头运动、环境动态、对白/心声和禁止项。`voiceMode=voiceover` 的镜头必须明确嘴唇闭合；`dialogue` 才包含口型提示。

- [ ] **Step 3: 逐镜排队生成**

一次只提交当前 provider 可安全承载的任务量。记录 provider job ID、seed/profile、输入摘要、输出路径和状态。失败任务只重试自身。

- [ ] **Step 4: 逐镜技术审核**

检查文件可解码、24fps、16:9、时长误差不超过2帧；检查人脸/服装/场景/道具漂移、肢体、动作落点和镜头运动。通过项复制到逐镜正式路径，失败项保留原因并重试。

- [ ] **Step 5: 连续性审核**

按 C01–C23 顺序检查手位、身体方向、棺盖开合、光线、道具状态和视线。任何边界失败只重生相邻受影响镜头，不改动已通过的无关镜头。

### Task 9: 生成音频、剪辑并导出约2分钟预览

**Files:**
- Create: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\音频\E01\dialogue\`、`C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\音频\E01\voiceover\`、`C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\音频\E01\sfx\`、`C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\音频\E01\music\`
- Create: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\视频\E01\成片\影帝他总想对我图谋不轨_E01_预览_v1.mp4`
- Create: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\final-qc.md`
- Modify: `C:\Users\Administrator\Desktop\小说\项目\影帝他总想对我图谋不轨_漫剧改编\投产\E01\run-manifest.json`

**Interfaces:**
- Consumes: 23个审核通过的视频与剧本对白。
- Produces: 可播放约2分钟样片、独立音轨和最终 QC 报告。

- [ ] **Step 1: 生成或导入对白与心声**

按剧本原文生成李宝珠、韦训、晚翠对白和李宝珠心声；心声与对白分轨。记录文本、角色、音色版本、时长和文件摘要。

- [ ] **Step 2: 准备环境与动作音效**

至少包含棺内呼吸、掌击木盖回声、木屑、发簪折断、指尖受伤细节、墓室重击、铜钉松动、匕首撬动、棺盖开启和强光转场声。

- [ ] **Step 3: 组装时间线**

按 ShotPlan 顺序拼接23镜；保留106.9秒节拍，增加约13.1秒的片头建立、段间停顿和结尾 hold。闪回使用已设计的声桥/白闪/动作匹配，不改变剧情顺序。

- [ ] **Step 4: 导出预览**

Expected：16:9、24fps、总时长约120秒、音视频可播放、无缺失镜头、无离线媒体。

- [ ] **Step 5: 完成最终 QC**

`final-qc.md` 逐项记录剧情完整性、身份/服装/空间/道具连续性、动作、口型、心声闭口、音效、分辨率、fps、时长和已知问题。所有硬性项通过后把 `run-manifest.stage="preview_complete"`；否则保持 `final_review` 并列出需要重试的 shot IDs。

---

## Final Verification Matrix

执行结束前必须同时满足：

```text
source beats: 36/36 covered exactly once
shots: 22–24, target 23
asset candidates: all lineage recorded
accepted assets: all required assets have accepted path and digest
storyboards: 23 accepted, 16:9, no review candidate used as video input
videos: 23 decodable, 24fps, correct duration, continuity reviewed
audio: dialogue/voiceover separated, required SFX present
preview: approximately 120 seconds, playable, no missing media
review gates: Stage A user-approved before any Stage B job
```

代码工作树最终回归：

```powershell
npm run test:codex-storyboard-focused
cargo test --offline --manifest-path src-tauri/Cargo.toml codex_storyboard -- --nocapture
cargo test --offline --manifest-path src-tauri/Cargo.toml --bin codex-storyboard-operator
npx tsc -b
npm run build
git diff --check 8ccf7e51cb122750752c62ffe1863c4266e88e52..HEAD
```

Expected：测试退出码全部为0；仅允许既存 Vite 大 chunk advisory 和测试设计明确记录的 Windows retained-handle skip。
