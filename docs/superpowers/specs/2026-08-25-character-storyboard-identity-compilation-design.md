# 角色身份编译与分镜多模态对应设计

日期：2026-08-25

## 1. 目标

把漫画创作流程中有价值的“角色身份模块、多模态严格对应、生成后差异检测、定向修正”方法吸收到现有 `novel-characters` 与 `novel-storyboard`，提高系列漫剧和 AI 短剧中跨镜角色一致性与返工可定位性。

本设计只修改 skills 的方法、参考契约及必要的确定性校验，不开发 Storyboard Pro 界面，不接入 Gemini、Banana 或其他特定模型，也不把现有视频分镜改造成漫画页面编辑器。

## 2. 设计原则

1. 角色身份是有版本、有证据、有允许变化边界的模块，不是一个名字加一张参考图。
2. 剧本、角色、动作、场景、布局或预演分别拥有自己的事实权限，后游不得用提示词覆盖上游权威事实。
3. 多模态输入必须先建立机器可读的对应关系，再组织自然语言提示词。
4. 质量检查比较“预期与实际”，不能只判断画面是否好看。
5. 返工应路由到最早出错的层，并尽量缩小重生成范围。
6. 模型无关：具体生成模型只消费契约，不进入核心 schema。

## 3. 范围

### 3.1 纳入范围

- `novel-characters` 的角色身份模块契约与身份资产优先级。
- `novel-storyboard` 的逐镜多模态对应表、生成输入包与结果偏差报告。
- 角色数量、身份引用、姿势/动作、场景、道具、表情、首尾状态和无角色镜头的对应检查。
- 局部修正与整段重生成的返工路由。
- 与现有 `assetDecisions`、`actionRefs`、`startBoundary/endBoundary` 和走位预演证据兼容。

### 3.2 不纳入范围

- 漫画页面、格子、气泡、破格构图专用 schema。
- SVG 画布、拖拽角色、骨骼编辑器、三栏 UI 和页面管理器。
- Gemini/Banana API、模型选择器和积分计费。
- 自动无限应用修正提示。
- 宣称多角度参考或某一模型能够彻底解决角色一致性。

## 4. 现有基础

`novel-characters` 已能生成角色卡、面部基准、全身三视图和生产级资产包；`novel-action-director` 已输出动作首尾状态、姿势路径和可选走位预演；`novel-storyboard` 已包含 `assetDecisions`、`actionRefs`、动作状态投影、逐切连续性边界和生成提示词。

本设计不建立平行真相源，而是在这些现有字段上增加明确的身份版本引用、输入对应关系与产物核验结果。

## 5. 角色身份模块

### 5.1 身份记录

每个正式角色资产包增加稳定身份描述：

```json
{
  "characterRef": "C01",
  "identityVersion": 3,
  "anchorRef": "C01-A0-v3",
  "status": "approved",
  "invariants": {
    "face": ["椭圆脸", "右眉尾短疤", "窄眼距"],
    "hair": ["中分", "双辫", "褪色红绳"],
    "body": ["约七头身", "窄肩", "轻微内扣站姿"],
    "baseCostume": ["藏青学生装", "白色平领", "小腿中部裙摆"]
  },
  "allowedVariations": ["expression", "pose", "lighting", "approved-state-variant"],
  "forbiddenDrift": ["face-geometry", "hair-structure", "body-scale", "costume-pattern-relocation"]
}
```

`invariants` 只保存可观察且能用于核验的识别特征。抽象气质和性格不作为像素级身份不变量。

### 5.2 版本与依赖

- `characterRef` 在全项目稳定；姓名变化不改变引用。
- `identityVersion` 只在身份锚点发生实质修改时递增。
- 表情、姿态、口型、服装细节和状态变体记录其 `dependsOn` 身份版本。
- 锚点换版后，旧版本的派生资产转为 `stale`，不得被新分镜继续引用。
- 下游只消费 `approved` 资产；`draft/review/rejected/stale` 均不可用于正式生成。

### 5.3 参考优先级

同一角色的多张参考图按用途分工：

1. 身份锚点决定脸、发型、体型和基础造型。
2. 角度资产补充侧面、背面和体积信息，不能改写正面身份。
3. 表情与姿态资产只改变对应通道。
4. 剧情状态资产只改变被授权的伤、污、湿、破损等状态。
5. 场景融合图只提供光影与环境适配，不回写身份基础色和结构。

多角度输入是证据补全，不是简单按图片数量加权。参考之间有冲突时停止生成并回角色层解决。

## 6. 分镜多模态对应契约

### 6.1 对应表

每个正式生成段在组织提示词前，先建立逐切对应表：

```json
{
  "cutRef": "E01-03-C02",
  "sourceBeats": {"sceneIndex": 2, "beats": [4, 5]},
  "characters": [
    {
      "characterRef": "C01",
      "identityVersion": 3,
      "lookRef": "AS-C01-DEFAULT-v3",
      "actionRefs": ["E01-S02-B04-A01"],
      "poseEvidenceRefs": ["previs/E01-S02-B04-end.png"],
      "expression": "克制惊讶",
      "startPosition": "屋顶左侧女儿墙内",
      "endPosition": "原地后撤半步"
    }
  ],
  "sceneRef": "S07-ROOFTOP-NIGHT",
  "propRefs": ["P03"],
  "emptyCharacterShot": false,
  "mustShow": ["C01 右手仍握 P03", "后撤落点", "对面人物进入视线"]
}
```

该表只引用上游事实，不产生新的剧情、动作结果或身份特征。

### 6.2 权威顺序

- `script.json`：场次、节拍、台词、人物是否出现、剧情结果。
- 角色身份模块：谁、长什么样、当前已批准造型版本。
- `action.json` 与预演：怎么动、姿势路径、接触、首尾动作状态。
- `art.json`：场景结构、道具身份、基础视觉锚点。
- `storyboard.json`：怎么看、何时切、构图、机位和生成时长。

布局草图、姿势骨架或预演截图是视觉指令证据，但不能覆盖上述权威顺序。若它们与结构化事实冲突，生成前失败，不把冲突交给模型猜。

### 6.3 生成输入包

每个生成段的输入包按固定槽位组织：

1. `identityReferences`：本段实际出场角色的批准身份资产。
2. `sceneReferences`：当前场景、光照状态和道具资产。
3. `poseAndBlockingReferences`：动作、姿势骨架、走位截图或动态片段。
4. `correspondence`：逐切角色与参考图、动作、场景的绑定表。
5. `scriptFacts`：逐切必须执行的动作、台词、无角色镜头和禁止增删项。
6. `renderIntent`：景别、机位、构图、画风、声景与模型时长。

提示词中的强调词只用于提高可读性；真正约束来自字段对应、稳定编号和生成前校验。

## 7. 结果核验与修正闭环

### 7.1 偏差类型

核验至少覆盖：

- `wrong-character`：身份错误或角色互换。
- `missing-character` / `extra-character` / `duplicate-character`。
- `identity-drift`：脸、发型、体型或造型版本漂移。
- `pose-mismatch`：姿势、接触、手部或落点与动作证据不符。
- `layout-mismatch`：构图、主体位置、遮挡和画面层级偏离。
- `scene-or-prop-mismatch`：场景、道具、持有关系或状态错误。
- `script-contradiction`：与剧本事实或无角色镜头冲突。
- `continuity-break`：与前后镜首尾边界不连续。

### 7.2 结构化报告

```json
{
  "hasDiscrepancies": true,
  "summary": "C01 身份正确，但右手道具缺失且落点偏移",
  "findings": [
    {
      "id": "Q-E01-03-C02-01",
      "cutRef": "E01-03-C02",
      "type": "scene-or-prop-mismatch",
      "severity": "blocking",
      "sourceRef": "P03 / endBoundary.characters.C01.rightHand",
      "expected": "C01 右手持续握住 P03",
      "actual": "右手为空",
      "repairLayer": "generation",
      "repairScope": "local-cut",
      "correctionPrompt": "仅重绘 C01 右手与 P03 的接触区域……",
      "preserve": ["C01 面部", "服装", "背景", "其他角色", "构图"]
    }
  ]
}
```

`severity` 使用 `blocking / major / minor`。`repairScope` 使用 `masked-region / local-cut / segment / upstream`。

### 7.3 返工路由

- 身份资产本身冲突、锚点错误：回 `novel-characters`。
- 姿势、接触、路径、站位错误：回 `novel-action-director` 或走位预演。
- 场景结构、道具设计错误：回 `novel-art`。
- 构图、机位、轴线、切点错误：回 `novel-storyboard`。
- 输入正确而产物局部偏差：局部遮罩编辑或单切重生成。
- 角色绑定、布局或连续性系统性错误：整段重生成。

AI 可以生成修正建议，但应用前必须通过结构校验和用户确认。默认最多执行一轮自动建议；仍失败则停止并报告，不进行无限自修正。

## 8. Skill 文件组织

### 8.1 `novel-characters`

- `SKILL.md`：增加身份模块路由与使用边界。
- `references/identity-module.md`：身份字段、版本、依赖、参考优先级和冲突处理。
- 复用现有 `asset-pack.md`，避免重复资产类型说明。
- `cast.json` 顶层新增可选 `identityCompilationVersion: 1`；启用时每个正式角色必须带 `identityModule`，包含 `characterRef / identityVersion / anchorRef / status / invariants / allowedVariations / forbiddenDrift`。
- 校验器只在顶层版本为 `1` 时启用身份门；渲染和下游摘要原样携带紧凑身份模块，不复制图片内容。

### 8.2 `novel-storyboard`

- `SKILL.md`：增加严格对应与产物核验路由。
- `references/multimodal-correspondence.md`：对应表、权威顺序、输入包和冲突失败条件。
- `references/generation-qa.md`：偏差 schema、严重度、返工范围和停止条件。
- 复用现有动作投影、连续性、走位预演和生成提示词参考，不复制其知识。
- `storyboard.json` 顶层新增可选 `correspondenceVersion: 1`；启用时每个 cut 必须带 `correspondence`，并与 `characters / beats / actionRefs / boundary / assetDecisions` 对账。
- 生成后的偏差记录单独保存为 `storyboard-qa.json`，不回写已批准的分镜事实；其校验规则由 `generation-qa.md` 定义。

## 9. 兼容策略

- 新字段采用显式版本开关；旧 `cast.json` 与 `storyboard.json` 不含版本字段时保持可读取、可验证、可渲染。
- `identityCompilationVersion: 1` 强制角色身份门；`correspondenceVersion: 1` 强制逐切对应门。声明版本却缺字段必须失败，不做静默降级。
- 新增字段不得改变旧字段含义，也不得用默认值伪造不存在的身份版本或核验结果。
- 公开导出只包含下游需要的紧凑事实，不复制完整角色知识库和图片内容。

## 10. 验证策略

### 10.1 角色层

- 身份版本、锚点和状态枚举合法。
- 批准资产的依赖存在且属于同一 `characterRef` 与身份版本。
- 锚点升级后旧依赖不能继续作为批准资产导出。
- 不变量与允许变化字段不互相矛盾。

### 10.2 分镜层

- 每个画内角色恰好绑定一个批准身份版本。
- 对应表角色集合与剧本、cut.characters 一致。
- 无角色镜头不能携带角色绑定。
- 动作、预演、道具和场景引用存在且属于当前节拍或场次。
- 首尾位置、左右手、道具状态与现有边界及动作投影一致。
- 偏差报告的 `sourceRef`、严重度、修复层和范围合法。

### 10.3 回归

- 运行两个 skills 的全部现有自测。
- 增加新字段的通过、缺失、错绑、陈旧版本和无角色镜头击穿用例。
- 验证旧样例不启用新模式时输出保持兼容。

## 11. 成功标准

1. 任一正式镜头都能回答“这个角色使用哪个身份版本、哪个动作/姿势证据、哪个场景与道具状态”。
2. 输入冲突在生成前被点名，不交给图像或视频模型自行猜测。
3. 生成偏差能定位到具体镜头、来源事实和返工层级。
4. 局部问题不会默认触发整段或整集重生成。
5. 旧角色卡、旧分镜和现有渲染/校验流程继续工作。
6. 设计不依赖任何特定供应商、模型或 UI。
