# 生成结果 QA 与修复路由（`storyboard-qa.json` v1）

本文件用于审查一次生成结果是否仍符合已经批准的 `storyboard.json`。QA 只记录可审计的偏差与一条最小修复建议；它不改写分镜、媒体、提示词或资产。`qa-validate` 也只做结构和 `cutRef` 引用校验，**从不应用任何修正**。

## v1 结构

```json
{
  "version": 1,
  "source": "剧名（必须等于 storyboard.source）",
  "hasDiscrepancies": true,
  "summary": "C01 身份正确，但右手道具缺失",
  "findings": [{
    "id": "Q-E01-01-C01-01",
    "cutRef": "E01-01#1",
    "type": "scene-or-prop-mismatch",
    "severity": "blocking",
    "sourceRef": "P01 / endBoundary.characters.C01.rightHand",
    "expected": "C01 右手持续握住 P01",
    "actual": "右手为空",
    "repairLayer": "generation",
    "repairScope": "masked-region",
    "correctionPrompt": "仅重绘 C01 右手与 P01 的接触区域。",
    "preserve": ["C01 面部", "服装", "背景", "其他角色", "构图"]
  }]
}
```

`version` 只能为 `1`。`source` 必须等于已批准分镜的 `source`。`summary` 非空；`hasDiscrepancies` 必须与 `findings` 是否为空严格一致。每条 finding 的 `id` 唯一，`cutRef` 必须指向真实的 `<segment.id>#<从 1 开始的切序>`。

## 偏差分类与严重度

`type` 只能是：`wrong-character`、`missing-character`、`extra-character`、`duplicate-character`、`identity-drift`、`pose-mismatch`、`layout-mismatch`、`scene-or-prop-mismatch`、`script-contradiction`、`continuity-break`。

- `blocking`：身份、剧本、关键道具或连续性被破坏；停止该切投产。
- `major`：叙事读解、姿态、空间布局有显著偏差；修复后再进入下一轮。
- `minor`：不改变事实或读解的局部偏差；记录并由用户决定是否修。

每条 finding 都必须有非空的 `sourceRef`、`expected`、`actual` 和 `correctionPrompt`，并提供数组 `preserve`。`preserve` 明确列出修复时必须保持不变的角色身份、服装、背景、其他角色、构图或其他已批准内容。

## 按权威修复

`repairLayer` 选择拥有事实权威的最上游层：`characters`、`action-previs`、`art`、`storyboard`、`generation`。不能用下游提示词掩盖上游事实错误。

- `characters`：身份模块、造型或批准锚点有误。
- `action-previs`：动作、姿势、接触、受力或预演证据有误。
- `art`：场景、道具或视觉资产的权威设定有误。
- `storyboard`：剧本认领、镜头边界、布局或连续性结构有误。
- `generation`：上游全部正确，仅本次生成偏离批准结构。

若 `repairLayer` 不是 `generation`，`repairScope` 必须是 `upstream`。上游修正完成后重新验证，再重新生成受影响的下游内容。

## 最小安全修复范围

`repairScope` 只能是 `masked-region`、`local-cut`、`segment`、`upstream`。从最小且不破坏已批准事实的范围开始：

1. `masked-region`：只允许 `generation` 层，用于局部手、道具、接触点等可遮罩区域。
2. `local-cut`：重生成一切，保留同段其他切。
3. `segment`：同一生成段的首尾或多切关系不可分割时重生成整段。
4. `upstream`：权威数据错误时回到对应上游层；非 generation 层只能使用此范围。

`correctionPrompt` 是一次、可执行且限定范围的建议，必须与 `preserve` 同时阅读；它不得改写结构化权威事实。

## 用户边界与停止条件

QA 可以报告偏差和建议一条最小修复，但不会自动修改、不自动重绘、不自动替换任何输出。任何实际修复、重生成、替换或上游设定变更都必须先由用户批准。

每个 finding 只做**一轮建议**：提出一条最小安全方案后停止，等待用户选择批准、拒绝、调整范围或回到上游。不要在同一次 QA 中无止境地追加提示词或连续尝试修复。
