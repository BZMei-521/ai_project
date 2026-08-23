---
name: novel-action-director
description: Use when AI短剧或漫剧的分镜前需要深化人物动作、微表情、双人互动、道具操作、走位或战斗受力，并产出可校验的 action.json。
---

# Novel Action Director

把 `novel-script` 的关键节拍深化为动作与表演计划，再把精简摘要交给 `novel-storyboard`。本 skill 不写剧情、不改台词、不决定具体镜头。

## 输入边界

- 必需：`script.json`。
- 可选：`cast.json`、`art.json`，只用于身份、服装、道具与场景约束。
- 只深化高风险或叙事关键节拍；普通走路、坐下、递物等继续以剧本为准。
- 不增加剧本外角色、道具、命中结果或情绪结论。

## 工作流

1. 生成确定性骨架：

```powershell
node scripts/novel-action-director.mjs seed path\script.json --eps 1-3 --physics realistic
```

2. 选择关键节拍并填写 `actions`。字段与状态契约见 [schema.md](references/schema.md)，筛选和填表顺序见 [action-pass.md](references/action-pass.md)。
3. 按动作类型读取一份专项规则：
   - 微表情与情绪泄露：[performance.md](references/performance.md)
   - 双人接触、救援、爱情互动：[interaction.md](references/interaction.md)
   - 攻防、受力、闪避与恢复：[combat.md](references/combat.md)
   - 现实/武侠/仙侠/风格化尺度：[physics-profiles.md](references/physics-profiles.md)
4. 必须验证：

```powershell
node scripts/novel-action-director.mjs validate path\action.json --script path\script.json
```

5. 生成审阅报告和分镜摘要：

```powershell
node scripts/novel-action-director.mjs render path\action.json --script path\script.json --html --out action-report.html
node scripts/novel-action-director.mjs export path\action.json --script path\script.json --out storyboard-actions.json
```

## 核心判定

动作不是姿势清单。最小完整链是：

```text
起始状态 → 预备/触发 → 主动作 → 接触/变化 → 对方或身体反应 → 稳定恢复
```

- 表演写“触发—控制—通道变化—泄露—恢复”，不只写开心、愤怒、悲伤。
- 互动同时写发起者和回应者，明确距离、接触顺序与双方末态。
- 战斗必须说明攻击轨迹、接触或闪避、力方向、目标反馈和恢复支撑。
- 道具操作必须写左右手分工，以及道具从什么状态变成什么状态。
- 位移必须写支撑、路径和落点。
- `cameraIntent` 只写观众必须看清什么；推拉摇移、焦段、景别由 `novel-storyboard` 决定。
- 速度线、残影、震屏、粒子和动态模糊全部是可选表现，不是动作成立的证据。

验证未通过时不得导出给分镜。修复结构或事实问题，不要用更长的提示词掩盖错误。
