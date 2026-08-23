---
name: novel-edit-director
description: Use when AI短剧或漫剧需要设计相邻生成段之间的转场、剪辑衔接、动作匹配、遮挡桥、声音桥、蒙太奇，或修复显得突兀的硬切。
---

# Novel Edit Director

把已完成的 storyboard.json 深化为相邻生成段的 edit.json，并导出工作台可消费的 `ShotTransition[]`。本 skill 不修改镜内切点，不修复坏动作或空间事实，不执行视频合成。

## 事实边界

- storyboard.json 是段顺序、人物、动作、机位方向和首尾事实的权威。
- 每对相邻生成段必须恰有一条边界；非相邻段不能直接建立边界。
- 底层类型只能是 `continuous|match_cut|hard_cut|scene_change`。
- 转场不能掩盖动作、资产、人物位置、视线方向或空间连续性错误。
- 对白、音乐和声音必须来自分镜或已批准导演计划，不能为转场自行创作。

## 工作流

1. 运行 `node scripts/novel-edit-director.mjs seed path\storyboard.json` 生成中性 hard-cut 骨架。
2. 按 [edit-pass.md](references/edit-pass.md) 逐边界确认连续事实和剪辑目的。
3. 依据 [transition-methods.md](references/transition-methods.md) 选择六种语义方法之一；声音桥读取 [audio-bridges.md](references/audio-bridges.md)。
4. 遇到连续变老、城市生长、时代变形或跨世界一镜到底时，先读 [risk-routing.md](references/risk-routing.md)。字段契约见 [schema.md](references/schema.md)。
5. 运行 `validate`，再用 `render` 审阅；通过后用 `export --sequence <id> --out transitions.json` 交给工作台。

验证失败时先修来源边界和连续性，不要换一个更花哨的转场名称。
