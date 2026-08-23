# edit.json 字段契约

顶层字段：`source`、`version: 1`、`boundaries[]`。

每条 boundary：

- `from`、`to`：相邻 segment ID。
- `purpose`：这次剪辑改变或保持什么叙事信息。
- `type`：`continuous|match_cut|hard_cut|scene_change`。
- `method`：六种语义方法之一；中性 hard cut 可为 `null`。
- `outgoingAnchor`、`incomingAnchor`：匹配动作、形状或运动的两端锚点。
- `bridge`：`visual`、`audio`、`audioSource`、`duration`、`execution`；遮挡桥另含 `occlusion { occluder, entryDirection, exitDirection }`，情绪声音触发另含 `trigger`。
- `mustMatch[]`：动作、资产、构图、颜色、人物位置或方向等必须连续的事实。
- `intentionalChange[]`：场景、时间、人物、空间、方向等有意改变的字段。
- `frameDependency`：`none|previous_tail|shared_frame`。
- `actionContinuity`、`characterPosition`、`cameraDirection`：映射到现有工作台字段。
- `stableEndpointAssets[]`：高风险时空/形变方案使用的稳定首尾资产。
- `outgoingFacts`、`incomingFacts`：seed 从 storyboard 复制的只读作者参考；验证时仍以 storyboard 为权威。

`hard_cut` 的 duration 必须为 0。其他类型 duration 必须有限、非负，且不能超过相邻两段中较短的一段。
