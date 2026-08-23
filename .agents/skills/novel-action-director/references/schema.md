# action.json 数据契约

## 顶层

```json
{
  "source": "剧名",
  "version": 1,
  "physicsProfile": "realistic",
  "params": {
    "maxMajorActionsPerBeat": 1,
    "requireRecoveryPose": true
  },
  "ordinaryBeatsPreserved": true,
  "episodes": []
}
```

`physicsProfile` 只能是 `realistic`、`wuxia`、`xianxia`、`stylized`。`ordinaryBeatsPreserved` 必须为 `true`，表示未入选节拍仍由 `script.json` 提供唯一事实。

## 动作计划

```json
{
  "id": "E01-S02-B05-A01",
  "sceneIndex": 2,
  "beat": 5,
  "kind": "interaction",
  "intent": "扶住失衡的同伴",
  "participants": ["C01", "C02"],
  "propRefs": ["P01"],
  "environmentRefs": ["S02-zone-a"],
  "sourceBeat": {
    "ep": 1,
    "sceneIndex": 2,
    "beat": 5,
    "kind": "action",
    "text": "原剧本动作原文"
  },
  "startState": {"characters": {}, "props": {}},
  "phases": [],
  "endState": {"characters": {}, "props": {}},
  "cameraIntent": {"mustShow": []},
  "generationRisk": [],
  "summaryConsistency": {"contradictions": []}
}
```

`sourceBeat` 必须逐字段复制归一化后的剧本节拍。台词节拍使用 `kind: "line"`，并保留 `speaker`、`delivery`、`text`；不得改写台词。

## kind

- `performance`：情绪控制、微表情、呼吸、肩颈、手部泄露。
- `interaction`：双方接近、接触、拥抱、牵手、救援、阻拦、对话反应。
- `combat`：攻击、格挡、闪避、命中、受力与恢复。
- `prop-operation`：拿取、打开、装填、递交、操作工具。
- `locomotion`：走、跑、转身、跨越、上下台阶、落地。

## phases

可用阶段是 `setup`、`anticipation`、`action`、`contact`、`reaction`、`recovery`。战斗必须六段齐全；其他类型可以省略不适用阶段，但必须以含 `stablePose` 的 `recovery` 收尾。

阶段可以记录：`duration`、`subject`、`target`、`support`、`weightShift`、`torso`、`head`、`gaze`、`breath`、`hands`、`path`、`landing`、`contactPoint`、`forceDirection`、`forceResult`、`response`、`secondaryMotion`。战斗的 `contact.outcome` 只能表达动作结果：`hit`、`block`、`evade` 或 `miss`。

## impactEvidence

当战斗 `contact.outcome` 为 `hit` 或 `block`，或源剧本明确写出命中/格挡时，必须提供：

```json
{
  "contactPoint": "blade/left-shoulder-armor",
  "contactVisible": true,
  "targetLatency": "左肩停顿半拍",
  "supportChange": "右脚向后补步",
  "centerOfMassShift": "重心移向右后方",
  "forceDirection": "backward-right",
  "wholeBodyResult": "躯干随肩向右后倾斜后重新站稳"
}
```

- `contactPoint` 与 `forceDirection` 必须和 `contact` 阶段一致。
- `contactVisible` 是布尔值；遮挡接触点时写 `false`，但仍要给出可观察的目标反馈。
- `targetLatency`、`supportChange`、`centerOfMassShift`、`wholeBodyResult` 描述受力传递，不能只写火花、震屏或动态模糊。
- 喷血、流血、断裂、折断、肢解或变形只能在源剧本已有相同事实时出现。

## 类型字段

### performance

必需 `trigger`、`gazeTarget`、`control`、非空 `channels`、`leak`、`release`。

### interaction

必需 `initiator`、`responder`、`contact`、`distanceChange`、`initiatorEnd`、`responderEnd`。

### propOperation

必需 `leftHand`、`rightHand`、`contact`、`stateChange`；`startState.props` 与 `endState.props` 中至少一个引用道具必须发生状态变化。

### displacement

发生位移时必需 `support`、`path`、`landing`；可补充 `distanceMeters`、`obstacle`、`speed`、`airborne`。

## storyboard 摘要

`export` 输出以 `E01-S02-B05` 为键的精简映射，包含动作 ID、类型、意图、参与者、道具引用、首尾状态、阶段摘要、镜头信息需求、生成风险，以及存在时的 `impactEvidence`。它不复制知识库，也不生成具体镜头运动。
