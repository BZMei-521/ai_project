# H3 R2V 3D 国漫连续性优化

## Goal

Improve the wooden-spear opening test while keeping the current shot composition. The next generation must preserve Lin Yue's identity, use the project's cinematic 3D donghua direction, and make the hunter/wolf gaze and blocking explicit.

## Design

- Use MiniMax H3 Reference-to-Video instead of a single-reference I2V pass.
- Reference slots: Lin Yue character sheet, current opening frame, Lan/wolf character sheet, and a scene/object reference. If no distinct fourth asset exists, reuse the opening frame rather than inventing an asset.
- Style contract: cinematic 3D donghua CG, animated-feature rendering, designed facial planes, grouped hair/fur, clean matte materials, no live-action skin pores or photographic microtexture.
- Action beats for 124 frames at 24fps: wolf low and threatening behind the hunter; wolf raises its head without changing position; hunter keeps gaze and head aimed at the wolf while raising the wooden spear; camera performs only a restrained push-in.
- Negative constraints: no cuts, extra characters, teleporting or passive standing wolf, gaze away from wolf, identity/clothing changes, or spatial relayout.

## Acceptance

Review the output for identity, donghua style, hunter-to-wolf gaze, wolf blocking, and spear continuity. This is an isolated comparison output and does not replace the approved production route until reviewed.
