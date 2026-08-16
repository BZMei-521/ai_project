# 《从一根木矛开始的文明》青铜联盟篇 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有十节正文之后补写第11—18节，使石牙从初获青铜技术发展为击败赤鬃、建立谷地联盟的完整短篇结局。

**Architecture:** 先扩展权威设定与小节大纲，再按 3 节、3 节、2 节分批追加正文，每批独立检查节数、长度、格式和承接。全文完成后统一做连续性复核与 `story-deslop`，只改表达，不改变已批准的剧情和人物关系。

**Tech Stack:** Markdown 正文与设定文件、`story-short-write` 写作规则、`story-deslop` 7 Gate、本地 Node.js 质检脚本、PowerShell 字符统计、Git 独立 worktree。

## Global Constraints

- 工作目录固定为 `C:\Users\Administrator\Desktop\ai_project\.worktrees\beastkin-civilization-story`，分支固定为 `codex/beastkin-civilization-story`。
- 第一人称林越视角；岚为唯一明确女主；青禾不进入感情线。
- 正文编号续接为 `###11.` 至 `###18.`，小节之间和段落之间都不插入空行。
- 每节硬下限 800 字，目标 1350—1700 字；新增正文目标约 12000 字。
- 系统只提供知识、鉴定和计算，不创造盐、铜、工具、军队或胜利。
- 决战必须同时依赖补给切断、附属战士倒戈、谷地工事与统一指挥，不能由青铜装备单独解决。
- 不进入铁器时代；结尾停在共用火塘与共同铜板刻纹，不写宏大展望。
- 所有创作性编辑使用 `apply_patch`，每个任务只提交列明的文件，保留无关的未跟踪 `从一根木矛开始的文明/短剧示例/`。

---

### Task 1: 扩展权威设定与第11—18节大纲

**Files:**
- Modify: `从一根木矛开始的文明/设定.md`
- Modify: `从一根木矛开始的文明/小节大纲.md`
- Reference: `docs/superpowers/specs/2026-08-16-beastkin-bronze-alliance-design.md`

**Interfaces:**
- Consumes: 已批准的八节剧情骨架、人物弧线、技术边界和五个贯穿道具。
- Produces: 第11—18节逐节蓝图，供后续三个正文批次逐项消费；更新后的角色、技术与伏笔权威说明。

- [ ] **Step 1: 更新设定文件**

用 `apply_patch` 在 `设定.md` 中把篇幅更新为十八节，并新增以下内容：赤鬃部落、烈鬃、青禾、盐路封锁、统一度量、烽火暗号、谷地盟约、第一枚青铜矛尖与赤鬃盐砖。明确青禾无感情线、烈鬃不降智、铁器时代不解锁。

- [ ] **Step 2: 追加第11—18节小节大纲**

每节必须写明：目标情绪、3—5 个子事件、至少一项关系或制度变化、技术/资源成本、节尾承接。第16节明确矛尖折断与盟友撤离，第17节回收三处撤离反转伏笔，第18节回收盐砖、铜环、兽牙和火塘。

- [ ] **Step 3: 验证大纲守恒与禁止项**

Run:

```powershell
$outline = Get-Content -LiteralPath '从一根木矛开始的文明\小节大纲.md' -Raw -Encoding utf8
([regex]::Matches($outline, '(?m)^###(?:1[1-8])\.$')).Count
rg -n '铁器时代知识库开放|青禾.*(喜欢|爱上|心动)|系统.*(发放|奖励).*青铜' '从一根木矛开始的文明/设定.md' '从一根木矛开始的文明/小节大纲.md'
```

Expected: 第一条输出 `8`；第二条无输出。

- [ ] **Step 4: 提交设定与大纲**

```powershell
git add -- '从一根木矛开始的文明/设定.md' '从一根木矛开始的文明/小节大纲.md'
git commit -m "docs: outline bronze alliance continuation"
```

---

### Task 2: 写第11—13节，完成威胁与联盟雏形

**Files:**
- Modify: `从一根木矛开始的文明/正文.md`
- Reference: `从一根木矛开始的文明/小节大纲.md`
- Reference: `从一根木矛开始的文明/设定.md`

**Interfaces:**
- Consumes: 第10节第一滴青铜入模的尾句，以及大纲第11—13节。
- Produces: 赤鬃威胁、盐路倒计时、青禾声线和松散互助网络，为矿场袭击提供因果。

- [ ] **Step 1: 加载本批写作规则与承接上下文**

完整读取 `story-short-write/references/short-format.md`、`story-short-write/references/short-craft.md` 与冷门题材兜底 `story-short-write/references/genre-writing-formulas.md` 中的系统/建设题材部分；再读 `正文.md` 最后 500 字。确认本批情绪为“成果兴奋 → 外敌羞辱 → 结盟希望”。

- [ ] **Step 2: 追加第11节《青铜与流民》**

目标 1350—1600 字。开头直接承接铜液入模，展示第一枚矛尖的真实缺陷和生产成本；青禾携伤员抵达；通过伤口、空盐袋和被割掉的族纹展示赤鬃统治；节尾让赤鬃使者把盐砖扔到公共石板上。

- [ ] **Step 3: 追加第12节《盐路封锁》**

目标 1400—1700 字。使者索要铜矿、冶炼法和二十名族人；岩山拒绝；系统只给出储盐天数而不给解决方案；林越与岚检查库存和替代盐源，确认硬抢盐路会先拖死伤员与幼童。

- [ ] **Step 4: 追加第13节《用工具换盟友》**

目标 1400—1700 字。青禾负责谈判，林越提供陶器、铜凿和统一计量；至少两个小部落表现不同利益诉求；枯羽把口头约定刻上骨板；结尾收到南坡矿场遇袭信号。

- [ ] **Step 5: 验证本批节长与格式**

Run:

```powershell
$text = Get-Content -LiteralPath '从一根木矛开始的文明\正文.md' -Raw -Encoding utf8
$m = [regex]::Matches($text, '(?ms)^###(1[1-3])\.\r?\n(.*?)(?=^###\d+\.|\z)')
$m | ForEach-Object { "SECTION_$($_.Groups[1].Value)=$($_.Groups[2].Value.Trim().Length)" }
"BLANKS=$(([regex]::Matches($text, '(?m)^\s*$')).Count)"
```

Expected: 输出 11、12、13 三节且每节 `>=800`；`BLANKS` 只允许文件末尾换行产生的 `1`。

- [ ] **Step 6: 提交第11—13节**

```powershell
git add -- '从一根木矛开始的文明/正文.md'
git commit -m "feat: write bronze alliance opening"
```

---

### Task 3: 写第14—16节，完成矿场冲突与首战失利

**Files:**
- Modify: `从一根木矛开始的文明/正文.md`
- Reference: `从一根木矛开始的文明/小节大纲.md`
- Reference: `docs/superpowers/specs/2026-08-16-beastkin-bronze-alliance-design.md`

**Interfaces:**
- Consumes: 第13节矿场警讯与松散联盟。
- Produces: 附属战士线索、共同议事规则、三处撤离伏笔、铜矿失守和折断矛尖。

- [ ] **Step 1: 写第14节《矿场遇袭》**

目标 1400—1700 字。赤鬃小队毁炉但不恋战；岚发现俘虏身上不同族纹和家属扣押痕迹；林越拒绝把俘虏当奴隶，以此建立附属战士可能倒戈的第一条证据。

- [ ] **Step 2: 写第15节《把不同的人编成一队》**

目标 1500—1800 字。用矛杆长度、盾阵口令、粮食铜环和烽火演练推动建设；让粮食分配争执迫使岩山接受共同议事；埋下备用山路、空粮车、统一烽火暗号三条伏笔。

- [ ] **Step 3: 写第16节《铜矿失守》**

目标 1500—1800 字。烈鬃提前进攻并针对石牙战法调整队形；外围盟友按密令撤走，石牙内部误以为遭背叛；岚用第一枚青铜矛尖掩护撤退，矛尖折断；石牙放弃铜矿退守谷地。

- [ ] **Step 4: 逐条复核反转公平性**

Run:

```powershell
rg -n '备用山路|空粮车|烽火|家人|人质|折断|铜矿' '从一根木矛开始的文明/正文.md'
```

Expected: 备用山路、空粮车、烽火在第15—16节均有可回看的场内证据；人质线在第14节出现；折断与铜矿失守在第16节出现。

- [ ] **Step 5: 验证并提交第14—16节**

重复 Task 2 的节长脚本，将正则改为 `(1[4-6])`。每节 `>=800` 后执行：

```powershell
git add -- '从一根木矛开始的文明/正文.md'
git commit -m "feat: write bronze alliance setback"
```

---

### Task 4: 写第17—18节，完成决战与谷地盟约

**Files:**
- Modify: `从一根木矛开始的文明/正文.md`
- Reference: `从一根木矛开始的文明/小节大纲.md`
- Reference: `从一根木矛开始的文明/设定.md`

**Interfaces:**
- Consumes: 第16节石牙退守、盟友撤走、矛尖折断与人质线。
- Produces: 补给线反转、附属战士倒戈、烈鬃失败、谷地盟约与感情收束。

- [ ] **Step 1: 写第17节《盐路上的烽火》**

目标 1700—2100 字。赤鬃围攻必须展现人数与经验优势；石牙依靠盾阵、投矛和旧工事拖延而非碾压；山路烽火揭示盟友任务；补给被截、附属战士倒戈、石牙反击依次发生；烈鬃因仍把附属战士当消耗品而失去阵线，最终被俘而非被林越单挑杀死。

- [ ] **Step 2: 写第18节《谷地盟约》**

目标 1500—1900 字。处理俘虏与盐路归属；各族拒绝拥立林越为王；枯羽主持盟誓，岩山让出部分决定权；盐砖被砸碎分食，铜环变成共同族纹；岚与林越共用火塘；最后一句停在铜板上新增的一道族纹或刻痕。

- [ ] **Step 3: 验证完结边界**

Run:

```powershell
rg -n '铁器时代知识库开放|未来.*时代|新的征程|才刚刚开始|命运.*齿轮|林越.*(称王|为王)' '从一根木矛开始的文明/正文.md'
```

Expected: 无输出。

- [ ] **Step 4: 验证全文节数与长度**

Run:

```powershell
$text = Get-Content -LiteralPath '从一根木矛开始的文明\正文.md' -Raw -Encoding utf8
"CHARS=$($text.Length)"
"SECTIONS=$(([regex]::Matches($text, '(?m)^###\d+\.$')).Count)"
$m = [regex]::Matches($text, '(?ms)^###(1[1-8])\.\r?\n(.*?)(?=^###\d+\.|\z)')
$m | ForEach-Object { "SECTION_$($_.Groups[1].Value)=$($_.Groups[2].Value.Trim().Length)" }
```

Expected: `SECTIONS=18`；第11—18节全部 `>=800`；全文字符数较第10节完成版增加约 10000—14000。

- [ ] **Step 5: 提交完结正文**

```powershell
git add -- '从一根木矛开始的文明/正文.md'
git commit -m "feat: complete bronze alliance story"
```

---

### Task 5: 连续性复核、story-deslop 与最终验收

**Files:**
- Modify: `从一根木矛开始的文明/正文.md`
- Modify only if inconsistency found: `从一根木矛开始的文明/设定.md`
- Modify only if inconsistency found: `从一根木矛开始的文明/小节大纲.md`

**Interfaces:**
- Consumes: 完整十八节正文、权威设定和逐节大纲。
- Produces: 情节不变、AI 指纹与退化 blocking 为零、格式合规的最终正文。

- [ ] **Step 1: 做事实与伏笔复核**

逐项核对：林越仍为二十七岁救援队员；岚肩伤与兽牙连续；岩山、枯羽转变不倒退；青禾无感情暗示；三处撤离线索全部回收；烈鬃失败符合补给和统治逻辑；铜产量未突然无限；盐路压力有实际后果。

- [ ] **Step 2: 运行 story-deslop 预检并定级**

按 `story-deslop` 要求完整加载 `references/anti-ai-writing.md` 与 `references/banned-words.md`，运行：

```powershell
$tmp = Join-Path (Get-Location) '.tmp-story-deslop-tools'
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
Copy-Item -LiteralPath 'C:\Users\Administrator\Desktop\ai_project\.agents\skills\story-deslop\scripts\check-ai-patterns.js' -Destination (Join-Path $tmp 'check-ai-patterns.cjs') -Force
Copy-Item -LiteralPath 'C:\Users\Administrator\Desktop\ai_project\.agents\skills\story-deslop\scripts\check-degeneration.js' -Destination (Join-Path $tmp 'check-degeneration.cjs') -Force
Copy-Item -LiteralPath 'C:\Users\Administrator\Desktop\ai_project\.agents\skills\story-deslop\scripts\normalize-punctuation.js' -Destination (Join-Path $tmp 'normalize-punctuation.cjs') -Force
node (Join-Path $tmp 'check-ai-patterns.cjs') '从一根木矛开始的文明\正文.md' --check --fail-on=blocking
```

Expected: 如有 blocking，先记录 Gate 与原句；advisory 逐条通读，不机械改功能性短句。

- [ ] **Step 3: 执行轻度去 AI 味**

优先删除或改写解释腔、总结腔、否定翻转、万能比喻与同声线对话；保护盐路、人质、撤离、倒戈、盟约、兽牙、铜环等剧情信息。默认只过 Pass 1；若量化达到中度，再执行 Pass 2。任何删除不得超过对应等级上限。

- [ ] **Step 4: 运行确定性终检**

```powershell
$tmp = Join-Path (Get-Location) '.tmp-story-deslop-tools'
node (Join-Path $tmp 'check-ai-patterns.cjs') '从一根木矛开始的文明\正文.md' --check --fail-on=blocking
node (Join-Path $tmp 'check-degeneration.cjs') '从一根木矛开始的文明\正文.md' --check --fail-on=all
node (Join-Path $tmp 'normalize-punctuation.cjs') '从一根木矛开始的文明\正文.md' --check --quote-mode keep
git diff --check
$wt = [System.IO.Path]::GetFullPath((Get-Location).Path)
$resolvedTmp = [System.IO.Path]::GetFullPath($tmp)
if ($resolvedTmp.StartsWith($wt + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedTmp) -eq '.tmp-story-deslop-tools') {
    Remove-Item -LiteralPath $resolvedTmp -Recurse -Force
} else {
    throw "Unsafe temp path: $resolvedTmp"
}
```

Expected: AI blocking 为零；退化 blocking/advisory 为零；标点问题为零；`git diff --check` 无错误；临时脚本目录已安全删除。

- [ ] **Step 5: 生成最终统计并提交**

```powershell
$text = Get-Content -LiteralPath '从一根木矛开始的文明\正文.md' -Raw -Encoding utf8
"CHARS=$($text.Length)"
"SECTIONS=$(([regex]::Matches($text, '(?m)^###\d+\.$')).Count)"
git add -- '从一根木矛开始的文明/正文.md' '从一根木矛开始的文明/设定.md' '从一根木矛开始的文明/小节大纲.md'
git commit -m "refactor: polish completed bronze alliance story"
```

Expected: `SECTIONS=18`，工作树除预存的无关 `短剧示例/` 外无本任务未提交修改。
