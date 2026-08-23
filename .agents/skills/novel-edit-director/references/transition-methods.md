# 六种语义转场方法

- `occlusion-bridge`：实体或环境遮挡物覆盖画面并从另一段退出；必须记录遮挡物、进入方向和退出方向。
- `motion-bridge`：前后段共享运动方向、速度趋势或动作峰值；需要双端运动锚点。
- `action-match`：同一动作或不同主体的同构动作在接触/峰值处匹配；通常映射 `match_cut`。
- `visual-match`：形状、构图、颜色、光区或物体轮廓相似；共同视觉锚点必须可明确指出。
- `time-space-jump`：明确时间、场景、时代或世界变化；使用 `hard_cut|match_cut|scene_change`，不能伪装成 continuous。
- `emotion-audio-trigger`：呼吸、对白尾音、环境声或已批准音乐触发剪辑；必须记录 trigger、audio 与 audioSource。

方法表达导演语义，不扩张工作台四种底层类型。普通 hard cut 不需要强行附会一种方法。
