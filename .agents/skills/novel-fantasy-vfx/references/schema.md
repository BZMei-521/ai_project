# effects.json 字段契约

顶层：source、version: 1、params.maxMajorEffectsPerBeat、ordinaryBeatsPreserved、episodes。

每个 effect 必须包含：

- id：建议 E01-S02-B05-FX01。
- sceneIndex、beat、sourceBeat { sceneIndex, beat, text }：逐字对应剧本。
- kind：formation、elemental、sword-control、barrier、seal、healing、purification、illusion、clone、invisibility、summoning、spatial、astral、alchemy、environmental 之一。
- function：视觉功能；攻击、治愈、净化、封印、召唤、变身等结果必须由来源台词或动作授权。
- participants、propRefs。
- startState { phase, persistence }、endState { phase, persistence }。
- topology { shape, origin, scale, nodes, circuits }；可选 fineSymbols、layers、mirrors。
- phases[] { name, fromState, toState, transition? }。
- environmentResponse { scale, responses[] }。
- cameraIntent { mustShow[] }：禁止 camera、cameraMove、lens、shotSize。
- generationRisk[]、actionRefs[]。

尺度顺序：hand < body < room < scene < world。环境响应最多比效果拓扑高一级。

phase 只能按 dormant、charging、forming、active、impact、dissipating、residue 前进。后一相的 fromState 必须等于前一相的 toState，且除第一相外必须写 transition。
