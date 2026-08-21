# 《影帝他总想对我图谋不轨》漫剧改编 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 产出 40 集 × 2 分钟的国风 3D 漫剧完整人物与大纲，并完成前 3 集可投产剧本、分镜和主要角色定妆图。

**Architecture:** 以公开前 5 章和 41 章目录为事实层，先建立可追溯人物资产，再用标准 JSON 将大纲、剧本、分镜逐层连接。所有后 36 章内容标注为目录推断或改编新增，每层均通过对应 skill 的确定性校验器。

**Tech Stack:** Markdown、JSON、Node.js 18+、novel-characters、novel-outline、novel-script、novel-storyboard、Codex built-in imagegen。

## Global Constraints

- 总集数固定为 40 集，单集目标时长固定为 2 分钟。
- 视觉风格固定为 `cinematic3d`，精致国风 3D 与电影光影。
- 前 5 章按公开正文提炼；第 6–41 章只能标注为目录推断或改编新增。
- 本阶段剧本与分镜范围固定为第 1–3 集。
- 分镜单生成段最长 15 秒，单切建议 2–5 秒。
- 不改动工作区内与本任务无关的现有文件或用户修改。

---

### Task 1: 原著依据与项目骨架

**Files:**
- Create: `影帝他总想对我图谋不轨_漫剧改编/原著依据.md`
- Create: `影帝他总想对我图谋不轨_漫剧改编/README.md`

**Interfaces:**
- Consumes: 番茄创作者页面可见简介、41 章目录与前 5 章正文。
- Produces: 后续人物、大纲、剧本引用的事实层与来源标签规范。

- [ ] **Step 1: 写入作品元信息、41 章目录和已确认人物/事件。**
- [ ] **Step 2: 将内容逐条标为 `原文明确`、`目录推断`、`改编新增`。**
- [ ] **Step 3: 执行来源标签检查。**

Run: `rg -n "原文明确|目录推断|改编新增" "影帝他总想对我图谋不轨_漫剧改编/原著依据.md"`

Expected: 三类标签均至少出现一次。

### Task 2: 人物资产

**Files:**
- Create: `影帝他总想对我图谋不轨_漫剧改编/人物/影帝他总想对我图谋不轨-cast.json`
- Create: `影帝他总想对我图谋不轨_漫剧改编/人物/影帝他总想对我图谋不轨-cast.md`
- Create: `影帝他总想对我图谋不轨_漫剧改编/人物/report.html`
- Create: `影帝他总想对我图谋不轨_漫剧改编/人物/images/*-sheet.png`

**Interfaces:**
- Consumes: `原著依据.md` 与公开正文逐字引文。
- Produces: `cast.json` 中稳定的角色 ID、视觉锚点、声音提示词和关系，供大纲、剧本、分镜引用。

- [ ] **Step 1: 建立主角、重要配角和功能角色卡。**
- [ ] **Step 2: 用 assemble 生成标准 cast.json。**
- [ ] **Step 3: 校验结构、引文、语言分工和 cinematic3d 风格。**

Run: `node "C:/Users/Administrator/.codex/skills/novel-characters/scripts/novel-characters.mjs" validate "影帝他总想对我图谋不轨_漫剧改编/人物/影帝他总想对我图谋不轨-cast.json" "影帝他总想对我图谋不轨_漫剧改编/原著公开文本.txt" --lang zh`

Expected: validation passes with zero errors.

- [ ] **Step 4: 使用内置 imagegen 逐个生成主要角色定妆图并目视检查脸部与三视图一致性。**
- [ ] **Step 5: 渲染 Markdown 与 HTML 报告。**

### Task 3: 40 集大纲

**Files:**
- Create: `影帝他总想对我图谋不轨_漫剧改编/大纲/影帝他总想对我图谋不轨-outline.json`
- Create: `影帝他总想对我图谋不轨_漫剧改编/大纲/影帝他总想对我图谋不轨-outline.md`
- Create: `影帝他总想对我图谋不轨_漫剧改编/大纲/outline-report.html`

**Interfaces:**
- Consumes: `cast.json`、事实层、40 集结构设计。
- Produces: 角色/场景/道具 ID、40 集梗概、爽点与钩子，供剧本 seed 使用。

- [ ] **Step 1: 写 adaptation、characters、scenes、beats 快版骨架。**
- [ ] **Step 2: 运行 beats 阶段校验。**

Run: `node "C:/Users/Administrator/.codex/skills/novel-outline/scripts/novel-outline.mjs" validate "影帝他总想对我图谋不轨_漫剧改编/大纲/影帝他总想对我图谋不轨-outline.json" --stage beats`

Expected: beats-stage validation passes.

- [ ] **Step 3: 分四批写入 1–40 集分集梗概，每批不超过 10 集。**
- [ ] **Step 4: 运行完整 13 道质量门并修正到通过。**
- [ ] **Step 5: 渲染 Markdown 与 HTML 报告。**

### Task 4: 前 3 集结构化剧本

**Files:**
- Create: `影帝他总想对我图谋不轨_漫剧改编/剧本/影帝他总想对我图谋不轨-script.json`
- Create: `影帝他总想对我图谋不轨_漫剧改编/剧本/影帝他总想对我图谋不轨-script.md`
- Create: `影帝他总想对我图谋不轨_漫剧改编/剧本/script-report.html`

**Interfaces:**
- Consumes: `outline.json` 第 1–3 集、`cast.json` 人物性格与说话方式。
- Produces: 场次、连续节拍和逐句对白，供 storyboard seed 使用。

- [ ] **Step 1: 从 outline.json seed 第 1–3 集骨架。**
- [ ] **Step 2: 写入每集冷开场、动作/对白节拍与结尾悬念。**
- [ ] **Step 3: 运行时长、台词、角色与爽点质量门并修正到通过。**

Run: `node "C:/Users/Administrator/.codex/skills/novel-script/scripts/novel-script.mjs" validate "影帝他总想对我图谋不轨_漫剧改编/剧本/影帝他总想对我图谋不轨-script.json" --outline "影帝他总想对我图谋不轨_漫剧改编/大纲/影帝他总想对我图谋不轨-outline.json"`

Expected: 3 episodes pass; each duration is between 102 and 138 seconds.

- [ ] **Step 4: 渲染 Markdown 与 HTML 报告。**

### Task 5: 前 3 集分镜与 H3 投产提示词

**Files:**
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/影帝他总想对我图谋不轨-storyboard.json`
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/影帝他总想对我图谋不轨-storyboard.md`
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/storyboard-report.html`
- Create: `影帝他总想对我图谋不轨_漫剧改编/分镜/E01-01/*`

**Interfaces:**
- Consumes: `script.json`、`outline.json`、`cast.json` 与角色设定图。
- Produces: 节拍全覆盖镜头表、连续性边界、首帧提示词、运动提示词和 MiniMax H3 提示词。

- [ ] **Step 1: 从 script.json seed 第 1–3 集工作底稿。**
- [ ] **Step 2: 逐集完成 assetDecisions、关键场导演计划、生成段与段内切镜。**
- [ ] **Step 3: 运行 18 道分镜质量门并修正到通过。**

Run: `node "C:/Users/Administrator/.codex/skills/novel-storyboard/scripts/novel-storyboard.mjs" validate "影帝他总想对我图谋不轨_漫剧改编/分镜/影帝他总想对我图谋不轨-storyboard.json" --script "影帝他总想对我图谋不轨_漫剧改编/剧本/影帝他总想对我图谋不轨-script.json" --outline "影帝他总想对我图谋不轨_漫剧改编/大纲/影帝他总想对我图谋不轨-outline.json" --cast "影帝他总想对我图谋不轨_漫剧改编/人物/影帝他总想对我图谋不轨-cast.json"`

Expected: 3 episodes pass; all script beats are covered exactly once; no segment exceeds 15 seconds.

- [ ] **Step 4: 用内置 imagegen 生成第一生成段的 3–5 张关键帧并目视检查构图与人物一致性。**
- [ ] **Step 5: 导出 Markdown、HTML、manifest 与 H3 prompt.md。**

### Task 6: 总体验收

**Files:**
- Modify: `影帝他总想对我图谋不轨_漫剧改编/README.md`

**Interfaces:**
- Consumes: 全部交付文件与验证输出。
- Produces: 可点击导航、已完成范围、推演边界和后续批次说明。

- [ ] **Step 1: 逐项核对设计规格中的交付物。**
- [ ] **Step 2: 重新运行四个完整 validate 命令。**
- [ ] **Step 3: 检查 JSON 可解析、HTML 文件存在、图片可打开。**
- [ ] **Step 4: 在 README 记录验证结果和后续第 4–6 集生产入口。**

