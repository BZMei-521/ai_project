# AI 漫剧导演 Skills 知识整合设计

- 日期：2026-08-23
- 状态：用户已批准架构，待规格复核
- 范围：动作表演、镜头语言、仙侠法术视觉、转场剪辑

## 1. 目标

把用户提供的动作、表情、打击帧、运镜、场景、仙侠阵法法术和转场资料内化为可复用、可校验、可部署的导演能力，而不是保存成提示词摘抄。

本次采用“增强两个现有 skill，新建两个独立 skill”的模块化方案：

```text
novel-script ────────────────→ script.json
      │
      ├─→ novel-action-director ─→ action.json / storyboard-actions.json
      │                                      │
      ├─→ novel-fantasy-vfx ────→ effects.json / storyboard-effects.json
      │                                      │
      └──────────────────────────────────────▼
                               novel-storyboard ─→ storyboard.json
                                                        │
                                                        ▼
                                     novel-edit-director ─→ edit.json
                                                        │
                                                        ▼
                                  现有工作台与视频连续性规划器
```

四个模块必须保持单一职责：动作层回答“怎么动”，特效层回答“超自然现象如何形成和变化”，分镜层回答“怎么拍”，剪辑层回答“镜头和生成段如何连接”。

## 2. 资料内化原则

附件和文章是知识输入，不是工具操作指令，也不逐条复制为固定提示词。

只保留会改变导演判断或能够形成质量门的规律：

- 动作依赖支撑、重心、轨迹、接触、反馈和恢复；
- 打击感来自可见动量传递，不来自特效数量；
- 微表情是触发、控制、泄露和恢复的过程，不是单个情绪标签；
- 运镜必须服务叙事目的、主体运动、空间信息和情绪距离；
- 法术必须有空间拓扑、能量路径、生命周期、环境反馈和消散结果；
- 转场必须有边界锚点与连续或有意变化的契约，不能掩盖动作断裂；
- 性别化动作标签改写为角色气质、关系、身体条件和情境；
- 运动模糊、震屏、粒子、残影、慢动作、血液和变形均为条件性表现，不是默认要求。

## 3. 子项目 A：增强 `novel-action-director`

### 3.1 保持的边界

- 输入仍以 `script.json` 为唯一剧情事实，可选消费 `cast.json` 与 `art.json`。
- 输出仍为 `action.json`、报告和 `storyboard-actions.json`。
- 不决定景别、焦段、切镜或具体运镜。
- 不新增剧本外角色、道具、命中结果、伤害尺度或情绪结论。

### 3.2 打击证据

在 `combat` 动作中增加可选 `impactEvidence`。当剧本事实包含命中、格挡或明显受击结果时，该字段必需：

```json
{
  "impactEvidence": {
    "contactPoint": "刀尖/颈甲空隙",
    "contactVisible": true,
    "attackerCheck": "肩臂到位后短促减速并顶住",
    "targetLatency": "受击后身体前倾但推进短暂停止",
    "supportChange": "右脚失去有效支撑",
    "centerOfMassShift": "重心向左后方越过支撑面",
    "wholeBodyResult": "甲胄重量带动身体侧坠"
  }
}
```

字段表达的是可观察证据，不规定必须使用某种表现手段。攻击者清晰、目标模糊和短促画面抖动只能作为可选的分镜表达。

### 3.3 表演层级

`performance` 保持现有“触发—控制—通道—泄露—恢复”契约，并增加参考表，把喜、怒、哀、惧、惊等资料整理成可组合通道：

- 眼神与眼睑；
- 眉形；
- 嘴角、下颌与吞咽；
- 呼吸；
- 肩颈与躯干；
- 手部与自我接触；
- 注视对象与关系距离。

情绪名称只能作为意图索引，最终计划必须描述变化过程。

### 3.4 新增质量门

在现有 18 门基础上增加：

1. 有命中/格挡事实的战斗必须提供 `impactEvidence`。
2. `contactPoint` 与 `contact` 阶段的接触事实一致。
3. 受力必须至少造成停顿、支撑变化、重心变化或全身结果之一。
4. 全身结果能从力方向和支撑关系推导。
5. 不得用粒子、闪光、震屏或音效代替身体反馈。
6. 血液、断裂和明显变形只能在源剧本明确授权时出现。

旧版 `action.json` 在不包含命中/格挡事实时继续兼容。

## 4. 子项目 B：增强 `novel-storyboard`

### 4.1 运镜维度拆分

保留现有 MiniMax H3 官方运镜枚举，避免破坏提示词和验证器；新增结构化 `cameraPlan`，把资料中混合的概念拆成独立维度：

```json
{
  "cameraPlan": {
    "purpose": "逐步暴露人物压抑情绪",
    "path": "push-in",
    "speed": "slow",
    "amplitude": "short",
    "subjectRelation": "approach",
    "stabilization": "stable",
    "foregroundOcclusion": "none",
    "startSize": "medium",
    "endSize": "close-up"
  }
}
```

维度包括：

- 景别；
- 角度与机位；
- 基础运动路径；
- 速度与幅度；
- 主体关系；
- 稳定方式；
- 前景遮挡；
- 起止景别；
- 叙事目的。

镜头选择顺序为：

```text
叙事目的 → 主体运动 → 空间信息 → 情绪距离
→ 基础运镜 → 修饰参数 → 连续性检查
```

### 4.2 打击呈现

分镜层消费 `impactEvidence`，但不改写动作事实。可按信息量拆为：

```text
命中/接触 → 受击停顿 → 全身失衡或恢复
```

- 接触点必须可读；遮挡是有意设计时需声明替代证据。
- `impactPulse` 表示极短接触脉冲，不强制模型生成严格单帧。
- 重叠镜头最多两段，每次必须增加新信息。
- 慢动作只用于机会出现、接触完成或短暂余波，不慢放整个发力过程。
- 画面抖动、闪屏和动态模糊为可选修饰。

### 4.3 镜头语言参考

新增按需读取的 `camera-language.md`，整理基础叙事、氛围景别、情绪和动作镜头的选择条件。它不把“推镜必然压迫”“俯拍必然孤独”等经验固化为绝对门禁。

## 5. 子项目 C：新建 `novel-fantasy-vfx`

### 5.1 职责

用于仙侠、玄幻、奇幻题材中的阵法、法术、结界、召唤、元素现象和天地异象设计。

- 必需输入：`script.json`。
- 可选输入：`action.json`、`art.json`、`cast.json`。
- 输出：`effects.json`、Markdown、HTML 和 `storyboard-effects.json`。
- 不决定人物身体动作、镜头方案、剪辑或最终合成节点。

### 5.2 法术生命周期

```text
dormant → charging → forming → active
→ impact → dissipating → residue
```

可以省略无关阶段，但必须具有可承接的起始状态和结束状态。持续型结界允许以 `active` 结束，并声明后续仍存在。

### 5.3 空间与能量模型

每个效果计划记录：

```text
功能 → 空间拓扑 → 阵眼/节点 → 能量回路 → 激活顺序
→ 作用目标 → 环境反馈 → 失效/消散 → 残留状态
```

阵法类别、五行、太极、星斗、剑阵、雷阵、镜花水月等作为可组合视觉语法，不作为固定剧情能力。名称不能自动赋予源剧本未说明的伤害、封印或召唤结果。

### 5.4 `effects.json` 核心结构

```json
{
  "id": "E01-S02-B05-FX01",
  "sceneIndex": 2,
  "beat": 5,
  "kind": "formation",
  "function": "defense",
  "participants": ["C01"],
  "topology": {
    "shape": "concentric-octagonal",
    "origin": "ground-below-C01",
    "nodes": 8,
    "circuits": "clockwise-linked"
  },
  "phases": [],
  "environmentResponse": [],
  "endState": {},
  "cameraIntent": { "mustShow": [] },
  "generationRisk": []
}
```

### 5.5 质量门

- 引用真实集、场和节拍；
- 不增加源剧本外能力与结果；
- 拓扑、节点与能量回路不互相矛盾；
- 激活和消散阶段连续；
- 环境反馈与能量规模相称；
- 人物结印与反冲引用动作计划，不重复制造身体事实；
- 遮挡、复杂粒子、多层镜像和大规模群体效果标记生成风险；
- 导出摘要不得强行固定运镜。

## 6. 子项目 D：新建 `novel-edit-director`

### 6.1 职责与兼容层

输入 `storyboard.json`，输出 `edit.json`、报告和现有工作台可消费的转场摘要。

底层 `type` 只使用现有应用支持的四种 `VideoBoundaryKind`：

```text
continuous / match_cut / hard_cut / scene_change
```

用户资料中的八十种转场不扩张底层枚举，而归纳为可组合 `method`：

```text
occlusion-bridge / motion-bridge / action-match
visual-match / time-space-jump / emotion-audio-trigger
```

### 6.2 边界契约

```json
{
  "from": "E01-01",
  "to": "E01-02",
  "purpose": "从拔剑爆点切入战场",
  "type": "match_cut",
  "method": "action-match",
  "outgoingAnchor": "横向剑光",
  "incomingAnchor": "战场中的同向光痕",
  "bridge": {
    "visual": "剑光遮满画面",
    "audio": "破风声跨切",
    "duration": 0.18,
    "execution": "hard-cut-at-peak"
  },
  "mustMatch": ["运动方向", "剑光角度"],
  "intentionalChange": ["场景", "时间"]
}
```

### 6.3 规则

- 相邻生成段必须有一条边界记录；镜内普通切点仍归 storyboard 管理。
- 连续动作优先复用前段尾帧事实，不用转场掩盖断裂。
- 匹配剪辑必须声明共同动作、形状、构图、颜色或声音锚点。
- 遮挡转场必须声明遮挡物进入和退出画面的方向。
- 声音桥接记录现场声、对白尾音、呼吸或环境声；背景音乐不是默认要求。
- 连续变老、城市生长、时代变形、跨世界一镜到底等高风险方案默认拆为稳定资产状态和可控剪辑，不要求视频模型在一段内完成全部形变。
- “爆款开场”“一镜到底”“人物登场”属于镜头或段落设计，不作为独立转场类型。

### 6.4 应用适配

导出适配器把 `edit.json` 映射到现有 `ShotTransition`：

- `from/to` → `fromShotId/toShotId`；
- `type` 原样保留；
- `bridge.duration` → `durationSeconds`；
- 边界帧策略 → `frameDependency`；
- 动作、人物位置和镜头方向分别写入现有高级字段；
- 详细 `method` 与锚点信息保留在扩展摘要或 `notes`，不破坏旧导入器。

## 7. 文件与发现方式

项目源文件：

```text
.agents/skills/novel-action-director/  # 更新
.agents/skills/novel-storyboard/       # 建立项目版本并更新
.agents/skills/novel-fantasy-vfx/      # 新建
.agents/skills/novel-edit-director/    # 新建
```

每个 skill 按需要包含：

```text
SKILL.md
references/
scripts/<skill>.mjs
scripts/selftest.mjs
examples/
agents/openai.yaml
```

同时更新仓库 `AGENTS.md` 路由。完成验证后，分别部署到 `C:\Users\Administrator\.codex\skills\`，并检查项目版与全局版文件哈希一致。

## 8. 实施与测试顺序

根据 skill 编写规范，每个 skill 必须独立完成 RED、GREEN、验证和部署，不能先批量写四个再统一测试。

顺序为：

1. 更新并部署 `novel-action-director`；
2. 建立项目版并更新、部署 `novel-storyboard`；
3. 新建、测试、部署 `novel-fantasy-vfx`；
4. 新建、测试、部署 `novel-edit-director`；
5. 执行四者之间的集成契约测试。

每个阶段至少包含：

- 无新增规则时的失败基线或明确缺口夹具；
- schema 与验证器单元测试；
- 合法样例；
- 每道门的击穿测试；
- `seed / validate / render / export` 烟雾测试；
- `quick_validate.py` skill 格式检查；
- 上下游兼容测试；
- 项目版和全局版哈希核对。

已有行为必须回归：

- 旧 `action.json` 的非命中用例继续通过；
- 未传动作或特效摘要时，`novel-storyboard` 保持原行为；
- `novel-edit-director` 导出不扩张现有四类 `VideoBoundaryKind`；
- 现有工作台 `test:script-transitions` 和视频连续性相关测试保持通过。

## 9. 错误处理

- 输入引用漂移时 fail closed，并指出集、场、节拍、镜头或字段。
- 不能从源剧本确认的剧情结果不得自动补全。
- 可选资料缺失时跳过对应增强，不伪造“已验证”。
- 全局部署失败时保留项目源文件与验证报告，明确报告未部署状态。
- 当前工作区存在大量用户修改，实施只暂存和提交本规格列出的 skill、测试、路由与计划文件，不清理、不重置、不覆盖其他文件。

## 10. 完成标准

本项目只有同时满足以下条件才算完成：

1. 四个 skill 均能被准确发现和调用；
2. 两个新 skill 能生成、校验、渲染和导出自己的 JSON；
3. 动作、特效、分镜和剪辑之间的事实边界没有互相覆盖；
4. 新增门禁均有正反测试；
5. 旧项目兼容测试通过；
6. 项目版与全局部署版一致；
7. `AGENTS.md` 路由、使用示例和最终验证报告齐全。
