# Director Desk UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current button-heavy storyboard shell with the approved “空间导演台” interface while preserving every existing project action, six-stage route, advanced tool, and user data path.

**Architecture:** Keep the existing React, Zustand, and Tauri domain behavior intact. Add small shell components around the existing stage views, centralize global commands and last-stage persistence in testable pure modules, and load a dedicated token/layout stylesheet after `global.css` so the redesign does not expand the existing monolithic stylesheet.

**Tech Stack:** React 18, TypeScript 5.6, Zustand 4, Vite 5, Tauri 2, Node contract checks, `react-test-renderer`, esbuild, Playwright/browser screenshots.

## Global Constraints

- Keep the six stages exactly `项目 → 剧本 → 资产 → 预演 → 分镜 → 成片`.
- Opening a project restores the last valid stage; an invalid saved stage falls back to `project`.
- Keep new, open, rename, delete, save, load, export backup, import backup, settings, help, nodeflow, and advanced tools reachable through the project menu or command palette.
- Do not expose ComfyUI models, nodes, or long logs in the default shell.
- Use `#071216`, `#10242A`, `#DCE8E9`, `#75B9B4`, `#E7A86E`, and `#B85B58` for the approved visual roles.
- Do not require network-loaded fonts or add a UI framework.
- Keep at most one tungsten-orange primary action visible in the shell.
- At `< 768px`, use bottom stage navigation and a bottom inspector drawer; do not scale the desktop columns down.
- Respect `prefers-reduced-motion`, visible keyboard focus, accessible icon names, dialog focus return, and 44×44 CSS-pixel touch targets.
- Do not rewrite the storyboard store, ComfyUI service, Tauri persistence, generation routing, or user snapshots.
- Do not reset, clean, or overwrite unrelated dirty-worktree changes; commit only task-owned files.

---

## Planned File Structure

```text
src/app-shell/
  directorDeskState.ts            # last-stage normalization and storage adapter
  directorDeskCommands.ts         # command definitions, search, danger metadata
  DirectorTopBar.tsx              # project/status header and project menu
  CommandPalette.tsx              # keyboard-searchable global command dialog
  ProductionStageRail.tsx         # desktop rail and mobile stage navigation
  ObjectInspectorDrawer.tsx       # desktop inspector and mobile bottom drawer
  WorkbenchShell.tsx              # composition and responsive state only
src/shared/ui/
  EmptyState.tsx                  # actionable empty state
  RecoveryNotice.tsx              # stage/output/retry recovery contract
src/styles/
  director-desk-tokens.css        # approved palette, type, spacing, motion tokens
  director-desk.css               # shell layout and component styles
scripts/
  check-director-desk-state.mjs
  check-director-desk-commands.mjs
  check-director-desk-components.mjs
  check-director-desk-app-integration.mjs
  check-director-desk-responsive.mjs
```

Existing files modified:

- `src/app/App.tsx`: wire existing actions into the new shell and remove the duplicate legacy topbar.
- `src/main.tsx`: load the two new stylesheets after `global.css`.
- `src/app-shell/workbenchRoutes.ts`: add icon/description metadata without changing stage IDs.
- `scripts/check-workbench-shell.mjs`: update the shell contract to the approved composition.
- `scripts/check-graybean-workbench-acceptance.mjs`: include the new focused checks.
- `package.json`: expose a single `test:director-desk` check aggregator.

---

### Task 1: Last-stage restoration contract

**Files:**
- Create: `src/app-shell/directorDeskState.ts`
- Create: `scripts/check-director-desk-state.mjs`

**Interfaces:**
- Consumes: `WorkbenchStage` and `WORKBENCH_STAGES` from `src/app-shell/workbenchRoutes.ts`.
- Produces: `LAST_WORKBENCH_STAGE_KEY`, `normalizeWorkbenchStage(value, fallback?)`, `readLastWorkbenchStage(storage?)`, and `writeLastWorkbenchStage(stage, storage?)`.

- [ ] **Step 1: Write the failing state contract**

Create `scripts/check-director-desk-state.mjs`:

```js
import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  entryPoints: ["src/app-shell/directorDeskState.ts"],
  absWorkingDir: process.cwd(),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});
const source = result.outputFiles[0].text;
const state = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

assert.equal(state.normalizeWorkbenchStage("preview"), "preview");
assert.equal(state.normalizeWorkbenchStage("missing"), "project");
assert.equal(state.normalizeWorkbenchStage(null, "storyboard"), "storyboard");

const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value)
};
assert.equal(state.readLastWorkbenchStage(storage), "project");
state.writeLastWorkbenchStage("production", storage);
assert.equal(state.readLastWorkbenchStage(storage), "production");
values.set(state.LAST_WORKBENCH_STAGE_KEY, "invalid-stage");
assert.equal(state.readLastWorkbenchStage(storage), "project");
console.log("PASS director desk state");
```

- [ ] **Step 2: Run the contract and verify RED**

Run: `node scripts/check-director-desk-state.mjs`

Expected: FAIL because `src/app-shell/directorDeskState.ts` does not exist.

- [ ] **Step 3: Implement the pure storage adapter**

Create `src/app-shell/directorDeskState.ts`:

```ts
import { WORKBENCH_STAGES, type WorkbenchStage } from "./workbenchRoutes";

export const LAST_WORKBENCH_STAGE_KEY = "storyboard-pro/director-desk/last-stage/v1";

type StageStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StageStorage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

export function normalizeWorkbenchStage(
  value: unknown,
  fallback: WorkbenchStage = "project"
): WorkbenchStage {
  return typeof value === "string" && WORKBENCH_STAGES.some(({ stage }) => stage === value)
    ? value as WorkbenchStage
    : fallback;
}

export function readLastWorkbenchStage(storage: StageStorage | null = browserStorage()): WorkbenchStage {
  if (!storage) return "project";
  try { return normalizeWorkbenchStage(storage.getItem(LAST_WORKBENCH_STAGE_KEY)); }
  catch { return "project"; }
}

export function writeLastWorkbenchStage(
  stage: WorkbenchStage,
  storage: StageStorage | null = browserStorage()
): void {
  if (!storage) return;
  try { storage.setItem(LAST_WORKBENCH_STAGE_KEY, stage); } catch { /* unavailable storage */ }
}
```

- [ ] **Step 4: Run the contract and verify GREEN**

Run: `node scripts/check-director-desk-state.mjs`

Expected: `PASS director desk state`.

- [ ] **Step 5: Commit only the state unit**

```bash
git add src/app-shell/directorDeskState.ts scripts/check-director-desk-state.mjs
git commit -m "feat: persist director desk stage"
```

---

### Task 2: Global command registry and search

**Files:**
- Create: `src/app-shell/directorDeskCommands.ts`
- Create: `scripts/check-director-desk-commands.mjs`

**Interfaces:**
- Consumes: existing `App.tsx` callbacks supplied through `DirectorCommandActions`.
- Produces: `DirectorCommand`, `DirectorCommandId`, `buildDirectorCommands(actions)`, and `searchDirectorCommands(commands, query)`.

- [ ] **Step 1: Write the failing command contract**

Create `scripts/check-director-desk-commands.mjs`:

```js
import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  entryPoints: ["src/app-shell/directorDeskCommands.ts"],
  absWorkingDir: process.cwd(),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false
});
const source = result.outputFiles[0].text;
const runtime = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const invoked = [];
const actionNames = [
  "createProject", "openProject", "renameProject", "deleteProject", "saveProject",
  "loadProject", "exportBackup", "importBackup", "openSettings", "openHelp",
  "openNodeflow", "openAdvancedTools"
];
const actions = Object.fromEntries(actionNames.map((name) => [name, () => invoked.push(name)]));
const commands = runtime.buildDirectorCommands(actions);

assert.deepEqual(commands.map(({ id }) => id), [
  "project.create", "project.open", "project.rename", "project.delete",
  "project.save", "project.load", "backup.export", "backup.import",
  "app.settings", "app.help", "app.nodeflow", "app.advanced"
]);
assert.equal(commands.find(({ id }) => id === "project.delete").danger, true);
assert.deepEqual(runtime.searchDirectorCommands(commands, "备份").map(({ id }) => id), [
  "backup.export", "backup.import"
]);
commands.find(({ id }) => id === "project.open").run();
assert.deepEqual(invoked, ["openProject"]);
console.log("PASS director desk commands");
```

- [ ] **Step 2: Run the contract and verify RED**

Run: `node scripts/check-director-desk-commands.mjs`

Expected: FAIL because `directorDeskCommands.ts` does not exist.

- [ ] **Step 3: Implement exact command metadata**

Create `src/app-shell/directorDeskCommands.ts` with these public shapes:

```ts
export type DirectorCommandId =
  | "project.create" | "project.open" | "project.rename" | "project.delete"
  | "project.save" | "project.load" | "backup.export" | "backup.import"
  | "app.settings" | "app.help" | "app.nodeflow" | "app.advanced";

export type DirectorCommand = {
  id: DirectorCommandId;
  label: string;
  keywords: readonly string[];
  shortcut?: string;
  danger?: boolean;
  run: () => void;
};

export type DirectorCommandActions = {
  createProject: () => void; openProject: () => void; renameProject: () => void;
  deleteProject: () => void; saveProject: () => void; loadProject: () => void;
  exportBackup: () => void; importBackup: () => void; openSettings: () => void;
  openHelp: () => void; openNodeflow: () => void; openAdvancedTools: () => void;
};
```

Implement `buildDirectorCommands` as a fixed array in the asserted order. Use labels `新建项目`, `打开项目`, `重命名项目`, `删除项目`, `保存项目`, `加载桌面快照`, `导出备份`, `导入备份`, `项目设置`, `帮助`, `导演工作流`, and `高级工具`. Give backup commands the keyword `备份`; mark only deletion as `danger: true`.

Implement normalized search:

```ts
export function searchDirectorCommands(
  commands: readonly DirectorCommand[],
  query: string
): DirectorCommand[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...commands];
  return commands.filter(({ label, keywords }) =>
    [label, ...keywords].some((value) => value.toLocaleLowerCase().includes(needle))
  );
}
```

- [ ] **Step 4: Run the contract and verify GREEN**

Run: `node scripts/check-director-desk-commands.mjs`

Expected: command IDs, danger metadata, Chinese search, and callbacks all pass.

- [ ] **Step 5: Commit only the command unit**

```bash
git add src/app-shell/directorDeskCommands.ts scripts/check-director-desk-commands.mjs
git commit -m "feat: add director command registry"
```

---

### Task 3: Stage rail, top bar, command palette, and inspector components

**Files:**
- Modify: `src/app-shell/workbenchRoutes.ts`
- Create: `src/app-shell/ProductionStageRail.tsx`
- Create: `src/app-shell/DirectorTopBar.tsx`
- Create: `src/app-shell/CommandPalette.tsx`
- Create: `src/app-shell/ObjectInspectorDrawer.tsx`
- Create: `src/shared/ui/EmptyState.tsx`
- Create: `src/shared/ui/RecoveryNotice.tsx`
- Create: `scripts/check-director-desk-components.mjs`

**Interfaces:**
- Consumes: `WorkbenchStage`, `DirectorCommand`, `WorkbenchStatus`, and React nodes.
- Produces: `DirectorPrimaryAction`, `DirectorTopBar`, `ProductionStageRail`, `CommandPalette`, `ObjectInspectorDrawer`, `EmptyState`, and `RecoveryNotice`.

- [ ] **Step 1: Write the failing component render contract**

Create `scripts/check-director-desk-components.mjs`:

```js
import React from "react";
import TestRenderer from "react-test-renderer";
import assert from "node:assert/strict";
import { build } from "esbuild";

const result = await build({
  stdin: {
    contents: `
      export * from "./src/app-shell/workbenchRoutes.ts";
      export * from "./src/app-shell/ProductionStageRail.tsx";
      export * from "./src/app-shell/DirectorTopBar.tsx";
      export * from "./src/app-shell/CommandPalette.tsx";
      export * from "./src/app-shell/ObjectInspectorDrawer.tsx";
      export * from "./src/shared/ui/EmptyState.tsx";
      export * from "./src/shared/ui/RecoveryNotice.tsx";
    `,
    loader: "tsx",
    resolveDir: process.cwd(),
    sourcefile: "director-desk-components-check.tsx"
  },
  absWorkingDir: process.cwd(),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["react", "react-test-renderer"],
  write: false
});
const source = result.outputFiles[0].text;
const runtime = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

assert.deepEqual(runtime.WORKBENCH_STAGES.map(({ label }) => label), ["项目", "剧本", "资产", "预演", "分镜", "成片"]);

const rail = TestRenderer.create(React.createElement(runtime.ProductionStageRail, {
  activeStage: "preview",
  completedStages: ["project", "script", "assets"],
  attentionStages: ["preview"],
  onStageChange: () => undefined
}));
assert.equal(rail.root.findAllByProps({ "aria-current": "page" })[0].props["data-stage"], "preview");
assert.equal(rail.root.findAllByProps({ "data-stage-state": "done" }).length, 3);

const top = TestRenderer.create(React.createElement(runtime.DirectorTopBar, {
  projectName: "荒原纪",
  projectPath: "预演 / 河岸营地",
  saveStatus: "已保存",
  primaryAction: { label: "确认这一节拍", onInvoke: () => undefined },
  onOpenCommands: () => undefined,
  onOpenProjectMenu: () => undefined
}));
assert.equal(top.root.findAllByProps({ "data-director-primary": true }).length, 1);
assert.equal(top.root.findAllByProps({ "aria-label": "搜索命令" }).length, 1);

const emptyInspector = TestRenderer.create(React.createElement(runtime.ObjectInspectorDrawer, {
  open: false,
  title: "当前对象",
  onClose: () => undefined
}));
assert.match(JSON.stringify(emptyInspector.toJSON()), /未选择对象/);

const recovery = TestRenderer.create(React.createElement(runtime.RecoveryNotice, {
  stage: "分镜生成",
  summary: "第 04 镜生成失败",
  outputState: "未产生图片文件",
  recovery: "检查参考图后重试",
  onRetry: () => undefined
}));
const recoveryText = JSON.stringify(recovery.toJSON());
for (const text of ["分镜生成", "第 04 镜生成失败", "未产生图片文件", "检查参考图后重试", "重试"]) {
  assert.match(recoveryText, new RegExp(text));
}

const palette = TestRenderer.create(React.createElement(runtime.CommandPalette, {
  open: true,
  commands: [{ id: "project.delete", label: "删除项目", keywords: ["删除"], danger: true, run: () => undefined }],
  onClose: () => undefined
}));
assert.equal(palette.root.findByProps({ role: "dialog" }).props["aria-modal"], true);
assert.equal(palette.root.findByProps({ "data-danger": "true" }).props.type, "button");
assert.equal(palette.root.findByProps({ "aria-label": "搜索命令" }).props.type, "search");
console.log("PASS director desk components");
```

- [ ] **Step 2: Run the component contract and verify RED**

Run: `node scripts/check-director-desk-components.mjs`

Expected: FAIL because the four components do not exist.

- [ ] **Step 3: Extend route metadata without changing IDs**

Change `WorkbenchRoute` to:

```ts
export type WorkbenchRoute = {
  stage: WorkbenchStage;
  label: string;
  shortLabel: string;
  description: string;
  path: string;
};
```

Use short labels `项`, `剧`, `资`, `演`, `镜`, `片` and descriptions `管理项目与版本`, `整理故事与场次`, `准备角色场景道具`, `确认空间姿态机位`, `生成筛选修订镜头`, `装配检查导出影片`.

- [ ] **Step 4: Implement the stage rail**

`ProductionStageRail` props:

```ts
export type ProductionStageRailProps = {
  activeStage: WorkbenchStage;
  completedStages?: readonly WorkbenchStage[];
  attentionStages?: readonly WorkbenchStage[];
  footer?: ReactNode;
  onStageChange: (stage: WorkbenchStage) => void;
};
```

Render one button per route with `data-stage`, `data-stage-state="active|done|attention|idle"`, `aria-current="page"` only for the active stage, visible Chinese label, and a hidden description. The mobile CSS will reuse the same DOM instead of maintaining a second route list.

- [ ] **Step 5: Implement the top bar and primary action contract**

```ts
export type DirectorPrimaryAction = {
  label: string;
  onInvoke: () => void;
  disabled?: boolean;
};

export type DirectorTopBarProps = {
  projectName: string;
  projectPath?: string;
  saveStatus: string;
  primaryAction?: DirectorPrimaryAction;
  projectMenuOpen?: boolean;
  projectMenu?: ReactNode;
  onOpenCommands: () => void;
  onOpenProjectMenu: () => void;
};
```

Render the product mark, project name, save status, path, an accessible search button, an accessible project-menu button, and at most one `<button data-director-primary>` using `primaryAction`.

- [ ] **Step 6: Implement the command dialog and inspector drawer**

`CommandPalette` receives `open`, `commands`, `onClose`. On open it stores the previously focused element and focuses the search input; `Escape` closes; arrow keys change the active result; `Enter` invokes it and closes; `Tab` cycles within the dialog. On close, return focus to the stored element. Guard DOM access with `typeof document !== "undefined"` so the component remains server/test renderable. Preserve the command callback as the only execution path so existing confirmation dialogs still protect deletion.

`ObjectInspectorDrawer` receives:

```ts
export type ObjectInspectorDrawerProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  onClose: () => void;
};
```

Render an `<aside data-director-inspector data-open>` with a close button. Use `未选择对象` when children are absent. Do not render generation logs or model data.

Implement `EmptyState` with required `title`, `description`, `actionLabel`, and `onAction` props. Implement `RecoveryNotice` with required `stage`, `summary`, `outputState`, and `recovery` props plus optional `onRetry`; render a retry button only when `onRetry` exists. These components enforce the approved rule that empty and failure states always identify the next action.

- [ ] **Step 7: Run the component contract and verify GREEN**

Run: `node scripts/check-director-desk-components.mjs`

Expected: all metadata, rendering, primary-action uniqueness, danger metadata, and accessible labels pass.

- [ ] **Step 8: Commit the component unit**

```bash
git add src/app-shell/workbenchRoutes.ts src/app-shell/ProductionStageRail.tsx src/app-shell/DirectorTopBar.tsx src/app-shell/CommandPalette.tsx src/app-shell/ObjectInspectorDrawer.tsx src/shared/ui/EmptyState.tsx src/shared/ui/RecoveryNotice.tsx scripts/check-director-desk-components.mjs
git commit -m "feat: add director desk shell components"
```

---

### Task 4: Compose the new WorkbenchShell

**Files:**
- Modify: `src/app-shell/WorkbenchShell.tsx`
- Modify: `scripts/check-workbench-shell.mjs`

**Interfaces:**
- Consumes: components from Task 3, command list from Task 2, status normalization already provided by `getWorkbenchStatus`.
- Produces: backward-compatible `WorkbenchShell` with new optional `projectName`, `projectPath`, `primaryAction`, `commands`, `completedStages`, and `attentionStages` props.

- [ ] **Step 1: Change the shell contract test to the approved composition**

Replace the legacy source assertions with:

```js
assert.match(source, /ProductionStageRail/);
assert.match(source, /DirectorTopBar/);
assert.match(source, /CommandPalette/);
assert.match(source, /ObjectInspectorDrawer/);
assert.match(source, /data-director-desk/);
assert.match(source, /metaKey|ctrlKey/);
assert.match(source, /event\.key\.toLocaleLowerCase\(\) !== "k"/);
assert.doesNotMatch(source, /<details[\s\S]*workbench-advanced-tools/);
```

Keep the six-stage and `getWorkbenchStatus` runtime assertions.

- [ ] **Step 2: Run the shell check and verify RED**

Run: `node scripts/check-workbench-shell.mjs`

Expected: FAIL because `WorkbenchShell` still renders `StageNavigation`, `CompactStatusBar`, and `<details>`.

- [ ] **Step 3: Extend the shell props**

```ts
export type WorkbenchShellProps = {
  stage: WorkbenchStage;
  children: ReactNode;
  inspector?: ReactNode;
  advancedTools?: ReactNode;
  statusSnapshot?: WorkbenchStatusSnapshot;
  projectName?: string;
  projectPath?: string;
  primaryAction?: DirectorPrimaryAction;
  commands?: readonly DirectorCommand[];
  completedStages?: readonly WorkbenchStage[];
  attentionStages?: readonly WorkbenchStage[];
  onStageChange?: (stage: WorkbenchStage) => void;
};
```

- [ ] **Step 4: Compose one stable shell**

Use local state only for `commandsOpen`, `projectMenuOpen`, `inspectorOpen`, and `advancedOpen`. Add one document `keydown` effect that opens commands on `Ctrl/Cmd + K`; do not intercept the shortcut when a dialog has already handled it.

Render this hierarchy:

```tsx
<div className="director-desk" data-director-desk data-stage={selectedStage}>
  <DirectorTopBar ... />
  <ProductionStageRail ... footer={<CompactStatusBar status={status} />} />
  <main className="director-desk-workspace" data-workbench-stage>{children}</main>
  <ObjectInspectorDrawer open={inspectorOpen} title="当前对象" onClose={() => setInspectorOpen(false)}>
    {inspector}
  </ObjectInspectorDrawer>
  {advancedOpen && <aside className="director-advanced-drawer">{advancedTools}</aside>}
  <CommandPalette open={commandsOpen} commands={commands ?? []} onClose={() => setCommandsOpen(false)} />
</div>
```

The project menu must list the commands `project.create` through `backup.import`, plus settings/help. Build `effectiveCommands` by replacing the `app.advanced` command's `run` callback with `() => setAdvancedOpen(true)` inside the shell; all other commands call their existing callbacks unchanged.

- [ ] **Step 5: Run the shell check and verify GREEN**

Run: `node scripts/check-workbench-shell.mjs`

Expected: `PASS workbench shell contract`.

- [ ] **Step 6: Commit only the shell composition**

```bash
git add src/app-shell/WorkbenchShell.tsx scripts/check-workbench-shell.mjs
git commit -m "feat: compose director desk shell"
```

---

### Task 5: Apply approved tokens and responsive layout

**Files:**
- Create: `src/styles/director-desk-tokens.css`
- Create: `src/styles/director-desk.css`
- Modify: `src/main.tsx`
- Create: `scripts/check-director-desk-responsive.mjs`

**Interfaces:**
- Consumes: `director-desk`, `director-topbar`, `production-stage-rail`, `director-desk-workspace`, `director-object-inspector`, `director-command-palette`, and `director-advanced-drawer` class contracts.
- Produces: desktop three-column, compact inspector drawer, and mobile bottom-navigation layouts.

- [ ] **Step 1: Write the failing token and responsive contract**

Create `scripts/check-director-desk-responsive.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const tokens = await readFile("src/styles/director-desk-tokens.css", "utf8");
const css = await readFile("src/styles/director-desk.css", "utf8");
const main = await readFile("src/main.tsx", "utf8");

for (const hex of ["#071216", "#10242a", "#dce8e9", "#75b9b4", "#e7a86e", "#b85b58"]) {
  assert.match(tokens.toLocaleLowerCase(), new RegExp(hex));
}
assert.match(css, /grid-template-columns:\s*174px\s+minmax\(0,\s*1fr\)\s+250px/);
assert.match(css, /@media\s*\(max-width:\s*1099px\)/);
assert.match(css, /@media\s*\(max-width:\s*767px\)/);
assert.match(css, /min-height:\s*44px/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /:focus-visible/);
assert.match(main, /director-desk-tokens\.css/);
assert.match(main, /director-desk\.css/);
console.log("PASS director desk responsive contract");
```

- [ ] **Step 2: Run the responsive check and verify RED**

Run: `node scripts/check-director-desk-responsive.mjs`

Expected: FAIL because the dedicated stylesheets do not exist.

- [ ] **Step 3: Create the token sheet**

Define the approved variables under `:root`:

```css
:root {
  --director-ink: #071216;
  --director-panel: #10242a;
  --director-mist: #dce8e9;
  --director-teal: #75b9b4;
  --director-tungsten: #e7a86e;
  --director-stop: #b85b58;
  --director-line: #26383d;
  --director-muted: #80999d;
  --director-radius-shell: 16px;
  --director-radius-control: 9px;
  --director-motion: 180ms;
  --director-title-font: "Noto Serif SC", "Source Han Serif SC", SimSun, serif;
  --director-ui-font: "Microsoft YaHei UI", system-ui, sans-serif;
  --director-data-font: Bahnschrift, ui-monospace, monospace;
}
```

- [ ] **Step 4: Create the desktop, compact, and mobile layouts**

The desktop root uses:

```css
.director-desk {
  min-height: 100vh;
  height: 100vh;
  display: grid;
  grid-template-columns: 174px minmax(0, 1fr) 250px;
  grid-template-rows: 62px minmax(0, 1fr);
  overflow: hidden;
  background: var(--director-ink);
  color: var(--director-mist);
  font-family: var(--director-ui-font);
}
```

At `max-width: 1099px`, collapse the third column and position the inspector as a right drawer. At `max-width: 767px`, use a single column, place `.production-stage-rail` fixed at the bottom as six equal buttons, and position the inspector as a bottom sheet. Ensure buttons and stage items have `min-height: 44px` at the touch breakpoint.

Use `.director-primary-action` for the only tungsten button. Use teal for focus/selection, stop red only for dangerous commands, and no orange decorative borders. Add `:focus-visible` outlines and a `prefers-reduced-motion` block that removes transforms and reduces transitions to `0.01ms`.

- [ ] **Step 5: Import styles after the legacy sheet**

`src/main.tsx` imports:

```ts
import "./styles/global.css";
import "./styles/director-desk-tokens.css";
import "./styles/director-desk.css";
```

- [ ] **Step 6: Run the responsive check and verify GREEN**

Run: `node scripts/check-director-desk-responsive.mjs`

Expected: approved palette, exact breakpoints, touch size, focus, reduced motion, and import order all pass.

- [ ] **Step 7: Commit only the style unit**

```bash
git add src/styles/director-desk-tokens.css src/styles/director-desk.css src/main.tsx scripts/check-director-desk-responsive.mjs
git commit -m "style: apply director desk visual system"
```

---

### Task 6: Integrate existing App actions and remove the duplicate topbar

**Files:**
- Modify: `src/app/App.tsx`
- Create: `scripts/check-director-desk-app-integration.mjs`

**Interfaces:**
- Consumes: state adapter from Task 1, command registry from Task 2, shell props from Task 4, all existing project callbacks in `App.tsx`.
- Produces: a default Director Desk launch path with no duplicate legacy topbar and no lost project actions.

- [ ] **Step 1: Write the failing integration contract**

Create `scripts/check-director-desk-app-integration.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile("src/app/App.tsx", "utf8");
assert.match(app, /readLastWorkbenchStage/);
assert.match(app, /writeLastWorkbenchStage/);
assert.match(app, /buildDirectorCommands/);
assert.match(app, /projectName=\{project\.name/);
assert.match(app, /primaryAction=\{stagePrimaryAction\}/);
assert.match(app, /commands=\{directorCommands\}/);
assert.match(app, /const \[nodeflowMode, setNodeflowMode\] = useState\(false\)/);
assert.doesNotMatch(app, /<header className="topbar">/);
for (const callback of [
  "onCreateProject", "onOpenProjectPath", "onRenameProject", "onDeleteProject",
  "onSaveDesktop", "onLoadDesktop", "onExportBackup", "onImportBackupClick",
  "onEditProjectSettings"
]) assert.match(app, new RegExp(callback));
console.log("PASS director desk app integration");
```

- [ ] **Step 2: Run the integration check and verify RED**

Run: `node scripts/check-director-desk-app-integration.mjs`

Expected: FAIL because App still starts in nodeflow mode and renders the legacy topbar.

- [ ] **Step 3: Restore and persist the active stage**

Initialize with `useState<WorkbenchStage>(readLastWorkbenchStage)` and add:

```ts
useEffect(() => {
  writeLastWorkbenchStage(workbenchStage);
}, [workbenchStage]);
```

Set `nodeflowMode` initial state to `false`; keep the existing nodeflow workspace reachable through its command.

- [ ] **Step 4: Build commands from existing callbacks**

Memoize `buildDirectorCommands` with this exact mapping:

```ts
const directorCommands = useMemo(() => buildDirectorCommands({
  createProject: onCreateProject,
  openProject: onOpenProjectPath,
  renameProject: onRenameProject,
  deleteProject: onDeleteProject,
  saveProject: onSaveDesktop,
  loadProject: onLoadDesktop,
  exportBackup: onExportBackup,
  importBackup: onImportBackupClick,
  openSettings: onEditProjectSettings,
  openHelp: () => setShowHelpPanel(true),
  openNodeflow: () => setNodeflowMode(true),
  openAdvancedTools: () => setAuxPanelOpen(true)
}), [activeWorkspacePath, project.name, auxPanelSection]);
```

If lint/compiler reports unstable callback dependencies, wrap the existing handlers in `useCallback` or construct the fixed command array without `useMemo`; do not suppress hook warnings.

- [ ] **Step 5: Define safe stage primary actions**

Do not pretend to persist confirmations that the domain does not support. Use:

```ts
const stagePrimaryAction: DirectorPrimaryAction = {
  project: project.name
    ? { label: "继续到剧本", onInvoke: () => onWorkbenchStageChange("script") }
    : { label: "创建项目", onInvoke: onCreateProject },
  script: { label: "继续到资产", onInvoke: () => onWorkbenchStageChange("assets") },
  assets: { label: "进入预演", onInvoke: () => onWorkbenchStageChange("preview") },
  preview: { label: "继续到分镜", onInvoke: () => onWorkbenchStageChange("storyboard") },
  storyboard: { label: "进入成片", onInvoke: () => onWorkbenchStageChange("production") },
  production: { label: "打开成片工具", onInvoke: () => setAuxPanelOpen(true) }
}[workbenchStage];
```

This preserves truthful copy until dedicated beat/shot confirmation actions exist.

- [ ] **Step 6: Pass shell metadata and remove the old topbar**

Pass `projectName`, `projectPath`, `primaryAction`, `commands`, `completedStages`, and `attentionStages` to `WorkbenchShell`. Remove the `<header className="topbar">…</header>` block only; keep recovery, onboarding, file import, help, editor content, toasts, and dialogs.

Replace the storyboard-only inspector with stage-aware content:

```tsx
const selectedShot = shots.find((shot) => shot.id === selectedShotId);
const selectedSpatialObject = spatialObjects.find((object) => object.id === selectedSpatialObjectId);
const inspectorByStage: Record<WorkbenchStage, JSX.Element> = {
  project: <div className="workbench-object-inspector"><strong>{project.name || "未命名项目"}</strong><small>项目与版本</small></div>,
  script: <div className="workbench-object-inspector"><strong>导演计划</strong><small>检查场次与故事节拍</small></div>,
  assets: <div className="workbench-object-inspector"><strong>{assets.length} 个资产</strong><small>角色、场景与道具</small></div>,
  preview: <div className="workbench-object-inspector"><strong>{selectedSpatialObject?.label ?? "未选择对象"}</strong><small>{selectedSpatialObject ? "空间位置与姿态" : "在画布中选择角色或道具"}</small></div>,
  storyboard: <div className="workbench-object-inspector"><strong>{selectedShot?.title ?? "未选择镜头"}</strong><small>{selectedShot ? project.name : "在时间线中选择镜头"}</small></div>,
  production: <div className="workbench-object-inspector"><strong>{generationTasks.length ? "处理中" : "等待生成"}</strong><small>视频、声音、质量与导出</small></div>
};
const workbenchInspector = inspectorByStage[workbenchStage];
```

Compute completed stages from the current stage index so the rail does not invent completion state:

```ts
const currentStageIndex = WORKBENCH_STAGES.findIndex(({ stage }) => stage === workbenchStage);
const completedStages = WORKBENCH_STAGES.slice(0, Math.max(0, currentStageIndex)).map(({ stage }) => stage);
const attentionStages = nextOnboardingStep ? [workbenchStage] : [];
```

The existing project handlers remain in `App.tsx` and are reached through the command registry. Do not delete them.

- [ ] **Step 7: Run the integration check and verify GREEN**

Run: `node scripts/check-director-desk-app-integration.mjs`

Expected: last-stage restore, command wiring, default Director Desk, no duplicate topbar, and all old callbacks remain present.

- [ ] **Step 8: Run focused shell regression**

Run: `node scripts/check-workbench-shell.mjs`

Expected: `PASS workbench shell contract`.

- [ ] **Step 9: Commit only the App integration**

```bash
git add src/app/App.tsx scripts/check-director-desk-app-integration.mjs
git commit -m "feat: launch director desk by default"
```

---

### Task 7: Aggregate tests, build, visual QA, and guideline audit

**Files:**
- Modify: `scripts/check-graybean-workbench-acceptance.mjs`
- Modify: `package.json`
- Create: `docs/superpowers/verification/2026-08-20-director-desk-ui-redesign.md`
- Modify only if findings require fixes: files owned by Tasks 1–6.

**Interfaces:**
- Consumes: every focused check and the production build.
- Produces: one repeatable test command and screenshot-backed verification report.

- [ ] **Step 1: Add the aggregate test script**

Add to `package.json`:

```json
"test:director-desk": "node scripts/check-director-desk-state.mjs && node scripts/check-director-desk-commands.mjs && node scripts/check-director-desk-components.mjs && node scripts/check-workbench-shell.mjs && node scripts/check-director-desk-responsive.mjs && node scripts/check-director-desk-app-integration.mjs"
```

Add the five new focused scripts to `checks` near `workbench-shell` in `check-graybean-workbench-acceptance.mjs`.

- [ ] **Step 2: Run all focused tests**

Run: `npm run test:director-desk`

Expected: six PASS lines and exit code 0.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: TypeScript and Vite complete with exit code 0 and no new warnings from Director Desk files.

- [ ] **Step 4: Start the app and capture the approved viewports**

Run: `npm run dev -- --host 127.0.0.1`

Use Playwright or the existing browser automation to capture:

- `output/playwright/director-desk-1440x900.png`
- `output/playwright/director-desk-1024x768.png`
- `output/playwright/director-desk-390x844.png`

For each screenshot, verify the active stage, one tungsten primary button, no legacy topbar button pile, no horizontal page scroll, and a usable main canvas. At 1024px verify the inspector is a drawer; at 390px verify stage navigation is at the bottom and inspector content opens as a bottom sheet.

- [ ] **Step 5: Audit against current Web Interface Guidelines**

Fetch the current guideline source required by the `web-design-guidelines` skill, review all new TSX/CSS files, and fix every applicable high-severity issue. Specifically verify semantic buttons, accessible names, focus visibility, no hover-only controls, dialog focus behavior, reduced motion, touch targets, text truncation, and destructive-action distinction.

- [ ] **Step 6: Write the verification report**

Create `docs/superpowers/verification/2026-08-20-director-desk-ui-redesign.md` containing:

```markdown
# Director Desk UI Redesign Verification

- Focused tests: `npm run test:director-desk` — PASS
- Production build: `npm run build` — PASS
- Viewports: 1440×900, 1024×768, 390×844 — PASS
- Primary action count: one per stage shell — PASS
- Legacy action reachability: command registry contract — PASS
- Reduced motion and keyboard focus: responsive contract + manual audit — PASS
- Web Interface Guidelines: no unresolved high-severity findings

## Evidence

- `output/playwright/director-desk-1440x900.png`
- `output/playwright/director-desk-1024x768.png`
- `output/playwright/director-desk-390x844.png`
```

Replace `PASS` with the actual status if any check fails; do not claim completion with unresolved failures.

- [ ] **Step 7: Run the final fresh verification**

Run: `npm run test:director-desk`

Run: `npm run build`

Expected: both exit 0 after all audit fixes.

- [ ] **Step 8: Commit the verification unit**

```bash
git add package.json scripts/check-graybean-workbench-acceptance.mjs docs/superpowers/verification/2026-08-20-director-desk-ui-redesign.md src/app-shell src/app/App.tsx src/main.tsx src/styles/director-desk-tokens.css src/styles/director-desk.css scripts/check-director-desk-*.mjs scripts/check-workbench-shell.mjs
git commit -m "test: verify director desk redesign"
```

Before committing, run `git diff --cached --name-only` and remove any path not owned by this plan from the commit without discarding that path's working-tree changes.

---

## Completion Criteria

- All seven tasks have their RED → GREEN evidence.
- `npm run test:director-desk` and `npm run build` pass in the final execution turn.
- The app opens in Director Desk rather than nodeflow mode and restores the last valid stage.
- Every legacy project action is reachable through the command registry.
- The old topbar button pile is absent from the default shell.
- Desktop, compact, and mobile screenshots match the approved layout hierarchy.
- No user project, snapshot, asset, model, or unrelated dirty-worktree change is removed or overwritten.
