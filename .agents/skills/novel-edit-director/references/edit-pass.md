# 相邻段剪辑深化顺序

1. 展平 episode/segment 顺序，只处理每对相邻生成段。
2. 锁定前段最后 cut 的 `endBoundary` 与后段第一 cut 的 `startBoundary`。
3. 先判断动作、资产、人物位置、屏幕方向与空间是否真实连续；不连续且非剧情意图时返回 storyboard/action 层修复。
4. 写一句 purpose：保持什么、改变什么、观众何时意识到变化。
5. 默认保留 hard cut；只有共同动作、形状、遮挡、运动或声音触发确实存在时才选择语义方法。
6. 填两端锚点、必须匹配、有意变化、frameDependency 与短时长。
7. 声音引用来源，复杂连续形变改走稳定端点。
8. validate 全部通过后才 export。

镜内 cut、运镜、焦段和表演动作仍由 storyboard/action skill 负责。
