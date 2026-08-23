# 灰豆式导演主流程节点工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将应用入口改为固定导演主流程节点画布，并复用现有生成、预演、分镜、成片和持久化逻辑。

**Architecture:** 新增 React-free 节点契约与状态映射，再用小型 React 画布组件渲染固定主链和 SVG 连线；右侧检查器通过节点 ID 分发到现有动作，不复制生成逻辑。App 仅负责选择工作流模式和传入现有 store 数据，旧六阶段视图保留为兼容模式但默认不挂载。

**Tech Stack:** React 18、TypeScript、现有 Zustand store、CSS、SVG、Node `.mjs` 契约检查器、Vite。

## Global Constraints

- 主链固定为：剧本 → 角色资产 → 空间预演 → 分镜 → 成片。
- 项目输入作为上下文，不单独占用主流程卡位。
- 节点状态由现有任务/持久化数据推导，不新增第二套任务系统。
- 节点画布只保存布局、选中节点、折叠状态和连线视图状态。
- 默认首屏不渲染旧引导、旧时间轴或大面积诊断面板。
- 旧六阶段导航保留为兼容入口，默认不渲染旧面板。
- 390px 视口下画布横向滚动，检查器转为底部抽屉。

---

### Task 1: 节点契约与状态映射

**Files:**
- Create: `src/features/nodeflow/nodeflowContracts.ts`
- Create: `scripts/check-nodeflow-contract.mjs`

**Interfaces:**
- Produces `DIRECTOR_NODE_IDS`, `DIRECTOR_NODE_EDGES`, `DirectorNodeId`, `DirectorNodeStatus`, `DirectorNodeViewState` and `getDirectorNodeStatus(input)`.
- `DirectorNodeViewState` contains `selectedNodeId: DirectorNodeId`, `collapsedNodeIds: DirectorNodeId[]`, `panX: number`, `panY: number`, `zoom: number`.

- [ ] **Step 1: Write the failing checker** asserting five node IDs, four ordered edges, status labels, and JSON round-trip of view state.
- [ ] **Step 2: Run `node scripts/check-nodeflow-contract.mjs` and verify it fails** because the contract module does not exist.
- [ ] **Step 3: Implement the pure contract module** with no React, DOM, filesystem, Tauri, or Comfy imports; map `generationTasks`, asset count, scene count, shot count, and generated output flags to statuses.
- [ ] **Step 4: Run the checker and verify `PASS nodeflow contract`.**
- [ ] **Step 5: Commit** `feat: add directed nodeflow contracts`.

### Task 2: Directed canvas and node cards

**Files:**
- Create: `src/features/nodeflow/DirectedNodeflowCanvas.tsx`
- Create: `src/features/nodeflow/NodeflowNodeCard.tsx`
- Create: `src/features/nodeflow/NodeflowToolbar.tsx`
- Modify: `src/styles/global.css`
- Modify: `scripts/check-nodeflow-contract.mjs`

**Interfaces:**
- Consumes `DIRECTOR_NODE_IDS`, `DIRECTOR_NODE_EDGES`, `DirectorNodeViewState`, `DirectorNodeStatus`.
- Produces `DirectedNodeflowCanvasProps { statuses, viewState, onSelectNode, onToggleNode, onViewStateChange, onRunNode }`.

- [ ] **Step 1: Extend the checker with static assertions** for SVG edge rendering, five cards, toolbar labels, keyboard focus, and `data-nodeflow-canvas`.
- [ ] **Step 2: Run the checker and verify the new assertions fail.**
- [ ] **Step 3: Implement the canvas** with a fixed left-to-right layout, absolute node cards, an SVG layer for four edges, selected/active/error styles, and a horizontal overflow container at narrow widths.
- [ ] **Step 4: Implement node cards** with status text, input/output ports, optional preview slot, and a button that calls `onRunNode` without starting a new task system.
- [ ] **Step 5: Implement toolbar** with select/add/fit/run controls; add keyboard focus-visible styles and `prefers-reduced-motion` behavior.
- [ ] **Step 6: Run checker and `npm.cmd run build`; expect PASS and existing chunk-size advisories only.**
- [ ] **Step 7: Commit** `feat: render directed nodeflow canvas`.

### Task 3: Node inspector and workflow view state

**Files:**
- Create: `src/features/nodeflow/NodeflowInspector.tsx`
- Create: `src/features/nodeflow/nodeflowViewState.ts`
- Modify: `src/modules/storyboard-core/store.ts`
- Modify: `src/modules/storyboard-core/types.ts`
- Modify: `scripts/check-nodeflow-contract.mjs`

**Interfaces:**
- `NodeflowInspectorProps { nodeId, project, assets, spatialScenes, shots, generationTasks, onRunNode }`.
- `nodeflowViewState.ts` exports `DEFAULT_NODEFLOW_VIEW_STATE`, `serializeNodeflowViewState`, `restoreNodeflowViewState`.

- [ ] **Step 1: Add checker cases** for inspector labels, node-specific summaries, and view-state serialization/restoration.
- [ ] **Step 2: Run checker and verify inspector assertions fail.**
- [ ] **Step 3: Implement pure view-state serialization** using the existing snapshot/persistence mechanism and schema-safe defaults.
- [ ] **Step 4: Implement inspector** with node-specific summaries and existing action callbacks; do not import ComfyPipelinePanel, filesystem APIs, or Tauri commands directly.
- [ ] **Step 5: Add the view state to the existing snapshot only as a namespaced optional field** so old snapshots load unchanged.
- [ ] **Step 6: Run migration, spatial preview, nodeflow checks and build; expect all PASS.**
- [ ] **Step 7: Commit** `feat: add nodeflow inspector and persisted view state`.

### Task 4: Replace default App entry with nodeflow mode

**Files:**
- Create: `src/features/nodeflow/DirectedNodeflowWorkspace.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app-shell/WorkbenchShell.tsx`
- Modify: `src/styles/global.css`
- Modify: `scripts/check-nodeflow-contract.mjs`

**Interfaces:**
- `DirectedNodeflowWorkspace` receives existing project/store data and dispatch callbacks; it renders canvas + inspector and no legacy timeline/onboarding subtree.

- [ ] **Step 1: Add checker assertions** that App mounts `DirectedNodeflowWorkspace` by default and legacy `focusedStageView` is behind an explicit compatibility mode.
- [ ] **Step 2: Run checker and verify App integration assertions fail.**
- [ ] **Step 3: Implement workspace composition** and map existing store selectors to the node status input.
- [ ] **Step 4: Add an explicit “传统视图” action** in the toolbar that opt-in mounts the existing six-stage shell; default route remains nodeflow.
- [ ] **Step 5: Ensure advanced tools remain closed by default and no old onboarding/timeline DOM is rendered in nodeflow mode.**
- [ ] **Step 6: Run `npm.cmd run build`, nodeflow checker, migration checker, and Playwright at 1280px; verify five nodes, four edges, inspector, and no legacy panels.**
- [ ] **Step 7: Commit** `feat: make directed nodeflow the default workspace`.

### Task 5: Responsive and acceptance verification

**Files:**
- Modify: `scripts/check-graybean-workbench-acceptance.mjs`
- Modify: `scripts/check-nodeflow-contract.mjs`
- Modify: `docs/superpowers/verification/graybean-spatial-director-workbench.md`
- Create: `output/playwright/graybean-nodeflow-desktop.png`
- Create: `output/playwright/graybean-nodeflow-mobile.png`

- [ ] **Step 1: Extend acceptance runner** to execute `check-nodeflow-contract.mjs` and fail closed when it fails.
- [ ] **Step 2: Run desktop Playwright at 1280px** and assert five nodes/four edges, selected-node inspector, no onboarding/timeline/legacy diagnostics.
- [ ] **Step 3: Run mobile Playwright at 390px** and assert horizontal canvas scrolling and bottom inspector without overlap.
- [ ] **Step 4: Run full acceptance and `npm.cmd run build`; record exact counts and remaining manual Tauri status.**
- [ ] **Step 5: Commit** `test: verify directed nodeflow workspace`.

## Self-review

- Spec coverage: all five main nodes, fixed edges, inspector, legacy compatibility, persistence, responsive behavior, and acceptance evidence have dedicated tasks.
- No new provider or task system is introduced; all execution paths reuse existing callbacks.
- The plan intentionally postpones freeform graph editing and node marketplace to keep the first implementation bounded.
