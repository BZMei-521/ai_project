# 导演计划与跨镜连续性

`seed` 默认生成 `continuityVersion: 1`。这个版本把“怎么看这场戏”和“切点前后的物理状态”从提示词里拆出，变成可对账的权威记录。旧文件没有该字段时保持兼容读取；不得为了过门伪造旧镜头的边界。

## 1. 先做资产决策

从本集剧本中收集实际出现的角色、造型和道具状态，每个状态在根层 `assetDecisions` 中只记一次：

- `reuse`：已有资产与已有状态直接复用。
- `new_variant`：同一身份，新增造型或道具状态。
- `new_asset`：确实是新身份或新道具。
- `unresolved`：证据不足。可以留在表中，但不得被正式分镜边界引用。

```json
{
  "id": "AS-P01-OPEN",
  "asset": "P01",
  "decision": "new_variant",
  "state": "open, letter visible",
  "reason": "第 2 场打开皮箱后持续到场尾"
}
```

衣服、伤势、湿污、道具开合通常是 `new_variant`，不是 `new_asset`。相机角度、景别和瞬时姿势不是资产变体。

## 2. 只给关键场写导演计划

把需要整场视觉选择的场次号放进 `directorCriticalScenes`。普通过场、功能性对话和简单转场留在空数组，不为流程完整强行加计划。

每个关键场在 `scenePlans` 中恰好一份已选方案：

- `audiencePosition`：观众跟谁同站，是否优先知道真相。
- `informationTiming`：什么先给，什么延后，在哪个反应才确认。
- `spatialPressure`：空间怎样收紧、分隔或改变权力关系。
- `strongestImage`：这场最值得被记住的一帧。
- `reactionLanding`：转向最终落在谁的反应上。
- `soundStrategy`：声音如何进入、撤出、留白或跨镜连接。

计划不得新增剧本事实，也不代替单镜 `purpose`。如果第一种合理拍法不应直接定稿，先用自由工作稿比较信息时机、观看位置、表演空间、最强画面和制作代价；只把用户选定的方案写进 `scenePlans`。

## 3. 每切先写目的和首尾边界

`purpose` 用一句话说清观众必须注意什么，信息、情绪或权力关系发生什么变化，为什么要在这里切。

`startBoundary` 和 `endBoundary` 都记录：

- `spatialAnchor`：不随镜头改变的场景锚点。
- `workingSide`：当前工作轴线侧。
- `screenDirection`：有意义的画面运动方向，无运动时明写 `none`。
- `characters`：该场每个角色的 `position / facing / gaze / leftHand / rightHand / lookRef`。画外角色也保留站位状态，避免下镜凭空移动。
- `props`：该场每个道具的 `holder / position / stateRef`。

```json
{
  "purpose": "让观众先看到船夫认出皮箱，但暂不知道原因",
  "startBoundary": {
    "spatialAnchor": "S01-船舱口",
    "workingSide": "A",
    "screenDirection": "none",
    "characters": {
      "C01": { "position": "舱口右侧", "facing": "面向 C02", "gaze": "P01 铜扣", "leftHand": "扶舱门", "rightHand": "悬在 P01 上方", "lookRef": "AS-C01-DEFAULT" },
      "C02": { "position": "舱口左侧", "facing": "面向 C01", "gaze": "C01", "leftHand": "抱住 P01 左侧", "rightHand": "抱住 P01 右侧", "lookRef": "AS-C02-DEFAULT" }
    },
    "props": {
      "P01": { "holder": "C02.bothHands", "position": "C02 胸前", "stateRef": "AS-P01-CLOSED" }
    }
  },
  "endBoundary": "与上述同结构的完整快照"
}
```

## 4. 跨镜对账

同场每个切点必须满足：

```text
上一切.endBoundary == 下一切.startBoundary
```

先从头到尾完成边界链，再写分镜图和 H3 动作。动作只能实现已声明的起点到终点，不能在提示词里偷换持物、站位或伤势。

确实需要时间跳跃、有意跳切或省略过程时，在后一切写非空 `continuityOverride`，说明省略了什么、为什么不会让观众误读。它是可审查的导演例外，不是为了消掉报错的通用开关。
