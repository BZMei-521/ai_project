---
name: novel-fantasy-vfx
description: Use when AI短剧或漫剧需要把仙侠/玄幻法术、阵法、结界、召唤或能量生命周期从剧本深化为可校验的 effects.json。
---

# Novel Fantasy VFX

把 script.json 中明确存在的超自然节拍深化为法术视觉计划，并导出精简事实给 novel-storyboard。本 skill 不创造剧情结果，不编人物肢体动作，不决定具体运镜、剪辑、模型或 ComfyUI 节点。

## 输入边界

- 必需：script.json，它是能力、作用对象与结果的唯一权威。
- 可选：action.json 只提供施法动作与反噬事实；art.json 只提供场景锚点。
- 法术名称只能帮助选择视觉语法，不能自动推出攻击、治愈、封印、召唤或变身结果。
- 每个节拍默认最多一个主效果；普通对白与无特效动作必须保留。

## 工作流

1. 运行 node scripts/novel-fantasy-vfx.mjs seed path\script.json --eps 1-3 生成空骨架。
2. 按 references/effect-pass.md 选择节拍，依据 references/schema.md 填写效果。
3. 只读取当前效果需要的专项参考：
   - 阵法、结界、剑阵拓扑：references/formations.md
   - 24 类法术的视觉决策线索：references/spell-families.md
   - 跨节拍持续、消散与残留：references/continuity.md
4. 运行 node scripts/novel-fantasy-vfx.mjs validate path\effects.json --script path\script.json。
5. 用 render 生成审阅报告，用 export --out storyboard-effects.json 交给分镜。

## 核心判定

休眠 → 蓄能 → 成形 → 生效 → 接触/作用 → 消散 → 残留

- 状态必须逐段接续；重复 active 可以，倒序不可以。
- 只有剧本明确持续时，末相才允许停在 active。
- 拓扑必须写形状、原点、尺度、节点与回路；环境响应不得无依据放大尺度。
- cameraIntent.mustShow 只列观众必须看清的事实，不写推拉摇移、焦段或景别。
- 手势、支撑脚、重心、身体姿态属于 action skill；这里只保留 actionRefs。
- 镜像层、密集粒子、多人遮挡、世界级环境和细符文必须声明生成风险。

验证未通过时不得交给分镜。优先修复来源、状态和拓扑，不要用更多粒子掩盖结构错误。
