# 《从一根木矛开始的文明》正文实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 根据已确认设计，完成一篇约一万字、可独立阅读的严肃生存建设短篇小说。

**Architecture:** 先建立标准短篇项目文件，再按三批完成十节正文，每批写后机器统计节长。最后统一执行格式规范化、AI 模式扫描、退化扫描与伏笔回收检查。

**Tech Stack:** Markdown、UTF-8、Codex `story-short-write` 写作流程、Node.js 质量检查脚本、Python 字符统计。

## Global Constraints

- 第一人称男性视角，主基调为严肃生存建设爽文。
- 正文恰好十节，使用统一小节标记 `###1.` 至 `###10.`，相邻正文段落之间不留空行。
- 每节至少八百个中文字符，总字数不低于八千字，目标约一万字。
- 系统只能提供鉴定、语言和知识，不能创造物资或替人物行动。
- 每项技术必须回应当前危机，并体现材料、试错或组织成本。
- 本篇只展开岚一条明确感情线，不实际开启后宫。
- 开篇狼群、木矛、兽牙、孔雀石、旧洞渗水五组伏笔必须回收。
- 结尾完成寒潮主线，以兽牙动作和第一滴青铜熔液收束。

---

### Task 1: 建立短篇项目骨架

**Files:**
- Create: `从一根木矛开始的文明/设定.md`
- Create: `从一根木矛开始的文明/小节大纲.md`
- Create: `从一根木矛开始的文明/正文.md`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-08-16-beastkin-primitive-civilization-short-story-design.md`
- Produces: 供全部正文任务读取的角色、系统、技术、伏笔与十节节拍约束。

- [ ] **Step 1: 写入 `设定.md`**

记录作品定位、林越、岚、岩山、枯羽、白脊狼王、系统六条规则、技术推进表、感情线六阶段和五组贯穿伏笔。人物信息与系统边界逐字对齐已确认设计，不增加第二女主。

- [ ] **Step 2: 写入 `小节大纲.md`**

按 `###1.` 至 `###10.` 写入十节；每节列出目标情绪、三个以上子事件、技术或关系变化、伏笔动作和节尾钩子。第七节完成“狼群在逃离极寒”的核心揭示，第九节完成狼王决战，第十节完成兽牙与孔雀石回收。

- [ ] **Step 3: 初始化 `正文.md`**

创建 UTF-8 空文件，不写自检记录、设计说明或 HTML 注释。

- [ ] **Step 4: 验证项目结构**

Run:

```powershell
Get-Item '从一根木矛开始的文明\设定.md','从一根木矛开始的文明\小节大纲.md','从一根木矛开始的文明\正文.md'
```

Expected: 三个文件均存在；`小节大纲.md` 中 `###1.` 至 `###10.` 各出现一次。

### Task 2: 完成第一批正文——绝境与取信

**Files:**
- Modify: `从一根木矛开始的文明/正文.md`
- Read: `从一根木矛开始的文明/设定.md`
- Read: `从一根木矛开始的文明/小节大纲.md`

**Interfaces:**
- Consumes: 十节大纲中的第一至第三节。
- Produces: 狼口获救、系统上线、七日寒潮倒计时和一天证明期限。

- [ ] **Step 1: 写第一节“狼口醒来”**

首三句依次落下狼牙逼近、林越确认穿越、木矛贯穿头狼三件事件。通过岚的救援和双方无法交流展示兽耳社会，不进行独立世界观讲解。节尾落在部落决定把流浪人留在荒野。

- [ ] **Step 2: 写第二节“万事通系统”**

让系统在林越最需要沟通时上线，先赋予语言精通，再给出七日寒潮与百分之七十三死亡率。林越隐瞒系统来源，只把预警解释为观察所得。节尾以他听懂“明天把他送走”形成钩子。

- [ ] **Step 3: 写第三节“没人相信寒潮”**

用候鸟南迁、狼群冻伤和岩缝结霜组成证据链。岩山与枯羽都保持合理立场；岩山给出一天证明期限，赌注是林越失败便被逐出部落。

- [ ] **Step 4: 机器验证第一批节数和节长**

Run:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -c "from pathlib import Path; import re; t=Path(r'从一根木矛开始的文明/正文.md').read_text(encoding='utf-8'); parts=re.split(r'(?m)^###\d+\.\s*$',t)[1:]; print(len(parts),*[len(x.strip()) for x in parts])"
```

Expected: 输出三节，每节字符数不低于 800；文件中不存在连续两个换行符。

### Task 3: 完成第二批正文——技术试错与关系建立

**Files:**
- Modify: `从一根木矛开始的文明/正文.md`
- Read: `从一根木矛开始的文明/正文.md` 尾部五百字

**Interfaces:**
- Consumes: 前三节建立的证明期限、寒潮倒计时与人物立场。
- Produces: 狩猎胜利、制陶试错、岚的信任、寒潮提前和旧洞分裂。

- [ ] **Step 1: 写第四节“第一场狩猎”**

让林越现场制作并解释投矛器、绳套和驱兽阵，通过猎手执行而非系统代劳取得两头巨角鹿。岚在实战中修正林越不熟悉本地兽性的判断，使双方能力互补。

- [ ] **Step 2: 写第五节“火、泥与粮食”**

第一窑陶器大半炸裂，错误烟道险些毁掉鹿肉。林越依据失败调整泥料、阴干和烟道，部落成员通过分工完成第二次试制。把岚的绿色佩饰作为无解释细节第一次带入。

- [ ] **Step 3: 写第六节“岚的兽牙”**

岚的弟弟误食毒根，林越用鉴定确认毒性，但具体洗胃、补水、草药处理需要族人协作。孩子脱险后，岚交出只代表信任的兽牙，不直接表白。

- [ ] **Step 4: 写第七节“狼群不是来狩猎的”**

林越从狼尸消瘦、脚掌冻伤和迁徙方向发现核心真相：狼群也在逃离极寒。寒潮提前一夜，枯羽基于祖先经验带部分族人进入旧洞，形成合理而危险的分裂。

- [ ] **Step 5: 机器验证第二批节数和节长**

Run: 重复 Task 2 Step 4 的 Python 命令。

Expected: 总节数七节，每节字符数不低于 800；第四至第七节均包含明确的技术、关系或危机状态变化。

### Task 4: 完成第三批正文——救援、决战与文明初火

**Files:**
- Modify: `从一根木矛开始的文明/正文.md`
- Read: `从一根木矛开始的文明/正文.md` 尾部五百字

**Interfaces:**
- Consumes: 旧洞风险、未完成防线、兽牙、绿色佩饰和木矛伏笔。
- Produces: 零死亡度过寒潮、传火者身份、青铜时代解锁与归属感结尾。

- [ ] **Step 1: 写第八节“暴雪封山”**

旧洞因冻裂与积水坍塌。林越选择营救反对者，岚与他共同进入暴雪；救援行动体现绳索、支撑和组织分工。枯羽获救后承认错误但不改变为盲目崇拜者。

- [ ] **Step 2: 写第九节“白脊狼王”**

依次兑现壕沟、拒马、树脂火墙和集中投矛。让未完工侧翼形成可信缺口，林越与岚共同守门，枯羽带获救族人回援。用修复后的开篇木矛杀死狼王，不让系统直接提供战斗能力。

- [ ] **Step 3: 写第十节“第一滴青铜”**

确认部落无人死于寒潮，岩山授予林越“传火者”身份。系统因生存、储备、生产和协作共同达标而开放青铜图纸。林越认出岚佩饰是孔雀石；岚将兽牙重新系到木矛上，以“你有家了”完成感情落点。最后一句停在第一滴青铜熔液落入石模。

- [ ] **Step 4: 机器验证完整节数与总字数**

Run:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -c "from pathlib import Path; import re; t=Path(r'从一根木矛开始的文明/正文.md').read_text(encoding='utf-8'); parts=re.split(r'(?m)^###\d+\.\s*$',t)[1:]; print('total',len(t),'sections',len(parts),'lengths',*[len(x.strip()) for x in parts]); assert len(parts)==10 and len(t)>=8000 and min(map(lambda x:len(x.strip()),parts))>=800"
```

Expected: exit 0，`sections 10`，`total` 不低于 8000，全部节长不低于 800。

### Task 5: 精修与确定性质量验收

**Files:**
- Modify: `从一根木矛开始的文明/正文.md`
- Read: `从一根木矛开始的文明/设定.md`
- Read: `从一根木矛开始的文明/小节大纲.md`

**Interfaces:**
- Consumes: 完整十节初稿。
- Produces: 格式统一、无阻断 AI 模式、无退化、伏笔全部回收的最终正文。

- [ ] **Step 1: 通读并压缩解释性文字**

删除不推动危机、技术、关系或伏笔的句子；把系统知识讲解改为角色当场操作和失败反馈。检查林越、岚、岩山、枯羽的声线差异。

- [ ] **Step 2: 核对五组伏笔**

逐项确认木矛、兽牙、孔雀石、南逃狼群、旧洞渗水均至少有一次铺垫和一次回收；缺失时补入对应小节，不在结尾用旁白补解释。

- [ ] **Step 3: 规范标点**

Run:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.agents\skills\story-short-write\scripts\normalize-punctuation.js' '从一根木矛开始的文明\正文.md'
```

Expected: 正文标点被确定性规范化，小节标记保持 `###1.` 至 `###10.`。

- [ ] **Step 4: 检查 AI 模式**

Run:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.agents\skills\story-short-write\scripts\check-ai-patterns.js' --check --fail-on=blocking '从一根木矛开始的文明\正文.md'
```

Expected: exit 0，无 blocking 命中；非阻断提示逐条按实际读感处理。

- [ ] **Step 5: 检查模型退化**

Run:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.agents\skills\story-short-write\scripts\check-degeneration.js' --check '从一根木矛开始的文明\正文.md'
```

Expected: exit 0，无复读、截断或工程词泄漏 blocking 命中。

- [ ] **Step 6: 运行最终结构与字数验收**

Run: 重复 Task 4 Step 4 的 Python 命令，并检查正文不存在 HTML 注释、待办占位标记或连续空行。

Expected: 十节守恒、总字符数及全部节长达标，正文文件只含可阅读小说内容。
