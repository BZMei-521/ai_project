# 逐切多模态对应契约（`correspondenceVersion: 1`）

仅当 storyboard 根层显式写入数值 `correspondenceVersion: 1` 时读取本文件。该版本为每个 `cut` 增加必填 `correspondence`，把剧本节拍、已批准角色身份、动作/预演、边界、场景和道具绑定为一次生成的可审计快照；完全缺少该字段的旧分镜保持兼容。字段一旦出现，`null`、`0`、`2`、字符串 `"1"` 或其他非数值 `1` 都必须失败，不能降级为 legacy。

## 权威顺序与冲突

1. `cast.json` 的 `characters[].identityModule` 是人物身份、`identityVersion` 与批准状态的唯一权威；必须是 `status: "approved"`。
2. `segment.sceneIndex` 和 `cut.beats` 是剧本节拍认领的权威；`correspondence.sourceBeats` 只能逐字复写。
3. `actions.actions` 是动作参与者与可选预演要求的权威；`cut.actionRefs` 非空时必须提供动作上下文，且每个引用都必须解析。角色绑定的 `actionRefs` 必须恰好等于这些已解析动作中该角色参与的集合。每个 `poseEvidenceRef` 都必须来自绑定动作的 `previs.evidence.stillRefs` 或 `clipRefs`；当 `previs.required: true`，该动作还必须至少有一条自己的批准证据被引用。
4. `startBoundary` / `endBoundary` 是该切首尾位置、开始造型和空间锚点的权威；`lookRef`、`startPosition`、`endPosition`、`sceneRef` 均只能复写这些边界事实。
5. `cut.props` 与 `actionStateProjection.mustShow` 分别是画内道具和观众必须读到的信息的权威。

冲突一律 **fail closed**：不得猜测、降级或以提示词覆盖结构化事实；修正上游权威数据或对应快照后再过门。

## `cut.correspondence` 字段

```json
{
  "sourceBeats": { "sceneIndex": 1, "beats": [1, 2] },
  "emptyCharacterShot": false,
  "characters": [{
    "characterRef": "C01",
    "identityVersion": 1,
    "lookRef": "AS-C01-DEFAULT",
    "actionRefs": ["E01-S01-B01-A01"],
    "poseEvidenceRefs": ["previs-still-01"],
    "startPosition": "舱口右侧",
    "endPosition": "舱口内侧"
  }],
  "sceneRef": "S01-船舱口",
  "propRefs": ["P01"],
  "mustShow": ["右手与铜扣接触"]
}
```

- `sourceBeats.sceneIndex` 与 `sourceBeats.beats` 分别等于所在 `segment.sceneIndex` 与 `cut.beats`。
- `characters`、每项的 `actionRefs` / `poseEvidenceRefs`、`propRefs` 和 `mustShow` 都是 **必填数组**；即使预期为空也必须写 `[]`，不得以缺字段表示空值。`characters` 中每个绑定必须是普通对象，每个 `characterRef` 只能绑定一次，绑定集合必须与 `cut.characters` 完全相同；每项只用该角色 approved identity module 的当前版本。
- 每个绑定的 `lookRef`、`startPosition`、`endPosition` 都必须是非空字符串。对应角色在 `startBoundary.characters` 与 `endBoundary.characters` 中都必须有完整普通对象状态；开始和结束边界各自的 `position`、`facing`、`gaze`、`leftHand`、`rightHand`、`lookRef` 均不可缺失或为空。绑定只复写开始边界 `lookRef` 与首尾 `position`，不能靠双方同时缺字段形成 `undefined === undefined` 的假一致。
- 画内角色为零时，`characters: []` 且 `emptyCharacterShot: true`；只要画内有角色，`emptyCharacterShot` 必须为 `false`，不得借空镜逃过身份绑定。
- `actionRefs` 只列该人物实际参与且已经解析的本切动作；没有则 `[]`。角色没有参与动作时 `poseEvidenceRefs` 必须为 `[]`。有动作时可以只引用这些动作列出的批准预演证据；不能引用未批准证据或其他动作的证据。多个 required 预演动作时，每个 required 动作都至少要有一条自己的批准证据被引用。
- `sceneRef` 等于 `startBoundary.spatialAnchor`；`propRefs` 与 `cut.props` 集合相等；`mustShow` 必须与 `actionStateProjection.mustShow` 按顺序完全一致（投影缺该字段时两者均为 `[]`）。

## 参考槽位与提示词边界

每切组装参考图时固定按槽位：**场景槽**（`sceneRef`）→ **角色身份槽**（按 `cut.characters` 顺序，各自 `identityModule.anchorRef` 与对应 `lookRef`）→ **动作/姿势槽**（仅批准的 `poseEvidenceRefs`）→ **道具槽**（`propRefs`）。缺少应有槽位或槽位相互冲突都不得投产。

`correspondence` 是结构化约束与导出快照，不是第二份 prompt。`frame` 和 H3 描述只投影镜头构图、当下位置、动作过程和声画；不得把身份模块、锚点 ID、预演证据 ID 或整个对应对象逐字塞进提示词，也不得用提示词改写这些事实。
