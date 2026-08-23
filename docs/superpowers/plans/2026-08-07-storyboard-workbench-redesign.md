# Storyboard Workbench Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the existing storyboard editor into a clear three-column production workbench without changing storyboard data or ComfyUI queue contracts.

**Architecture:** Keep `App.tsx` as the shell and preserve existing panel components. Add a stable workbench shell class structure around the existing center preview, shot list, and auxiliary drawer; use CSS to make the shot list, canvas, and inspector the primary desktop hierarchy while collapsing advanced tools. Existing state, shortcuts, persistence, and generation services remain unchanged.

**Tech Stack:** React 18, TypeScript, existing CSS variables and panel components, Vite build.

## Global Constraints

- Do not change storyboard snapshot schemas, ComfyUI API payloads, or generation task persistence.
- Preserve existing keyboard shortcuts and panel section identifiers.
- Use the existing visual language but reduce nested cards, gradients, and dense diagnostic blocks in the first viewport.
- Desktop target is 1280px and mobile target is 390px; no overlapping controls at either size.

### Task 1: Map the Existing Shell

**Files:**
- Inspect: `src/app/App.tsx`
- Inspect: `src/styles/global.css`

- [ ] Identify the JSX wrappers for topbar, editor layout, center preview, auxiliary quickbar/drawer, and timeline.
- [ ] Record the smallest class-level changes needed so existing panel components keep their public props and state behavior.
- [ ] Run `npm.cmd run build` before edits to establish the baseline.

### Task 2: Restructure Desktop Hierarchy

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/styles/global.css`

- [ ] Add semantic shell classes for `workbench-header`, `workbench-body`, `workbench-shot-rail`, `workbench-stage`, and `workbench-inspector` around existing content.
- [ ] Keep the current auxiliary panel selection and drawer behavior, but make the shot list the default left rail and inspector content the default right-side context.
- [ ] Add a compact status strip showing project, current shot, ComfyUI status, and autosave state without duplicating existing actions.
- [ ] Preserve all existing buttons, callbacks, and keyboard handlers; only move their visual containers.

### Task 3: Apply Workbench Visual System

**Files:**
- Modify: `src/styles/global.css`

- [ ] Replace the first viewport's competing panel treatments with one dark workbench surface, one elevated canvas, and restrained inspector sections.
- [ ] Define scoped variables for ink, surface, line, copper action, and teal status colors.
- [ ] Style primary generation action with an icon and stable dimensions; keep secondary actions compact and tool-like.
- [ ] Reduce panel padding and heading size inside diagnostics while preserving readable labels and focus states.
- [ ] Add subtle enter/selection transitions with `prefers-reduced-motion` fallback.

### Task 4: Responsive Behavior

**Files:**
- Modify: `src/styles/global.css`

- [ ] At widths below 1100px, collapse the inspector into the existing auxiliary drawer and keep the central canvas full width.
- [ ] At widths below 820px, convert the shot rail into a horizontal/overlay navigation strip and stack canvas plus current-shot controls.
- [ ] Verify text, buttons, thumbnails, and progress indicators do not overflow at 390px.

### Task 5: Verification

**Files:**
- Test: `npm.cmd run build`
- Test: existing workflow/state checks
- Artifact: `output/playwright/storyboard-workbench-1280.png`, `output/playwright/storyboard-workbench-390.png`

- [ ] Run `npm.cmd run build` and the existing storyboard generation checks.
- [ ] Start the Vite dev server and capture desktop/mobile screenshots with the browser tooling.
- [ ] Confirm the page loads, the shot rail remains usable, the central preview is nonblank, and no controls overlap.
- [ ] Confirm the ComfyUI generation buttons still call the existing queue path by running the existing Z-Image dry-run.
