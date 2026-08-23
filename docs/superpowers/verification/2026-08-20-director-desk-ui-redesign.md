# Director Desk UI Redesign Verification

- Focused tests: `npm run test:director-desk` — PASS (6/6 focused contracts)
- Production build: `npm run build` — BLOCKED by the pre-existing browser import of `node:child_process` in `src/modules/video-production/runningHubResult.mjs`; TypeScript completed and Vite transformed 537 modules before failing on `spawnSync`
- Viewports: 1440×900, 1024×768, 390×844 — PASS
- Primary action count: one per stage shell — PASS
- Legacy action reachability: command registry contract, desktop shortcut, and visible mobile command entry — PASS
- Reduced motion and keyboard focus: responsive contract plus manual audit — PASS
- Web Interface Guidelines: no unresolved high-severity findings in the Director Desk files
- Final accessibility remediation: `npm run test:director-desk` (6/6) and `npx tsc -p tsconfig.app.json --noEmit` — PASS

## Evidence

- `output/playwright/director-desk-1440x900.png`
- `output/playwright/director-desk-1024x768.png`
- `output/playwright/director-desk-390x844.png`

## Browser verification

| Viewport | Horizontal overflow | Primary actions | Inspector | Stage navigation | Main canvas |
| --- | ---: | ---: | --- | --- | ---: |
| 1440×900 | 0 px | 1 | static third column | left rail | 976 px |
| 1024×768 | 0 px | 1 | fixed 360 px drawer | left rail | 810 px |
| 390×844 | 0 px | 1 | fixed bottom sheet, 390 px wide, bottom 72 px | fixed 72 px bottom bar | clipped to the mobile workspace without page overflow |

Playwright verified that stage navigation changes the active stage to `preview`, the command palette opens as an accessible dialog with its search box focused, all 12 legacy commands remain reachable, the advanced-tools drawer opens and closes, and the inspector closes and reopens without forced clicks. No legacy `header.topbar` was present.

### Final-review accessibility remediation (fresh 1024×768 run)

- The command palette exposed a modal dialog, focused `combobox`, controlled `listbox`, and 12 stable-ID options. `ArrowDown` changed the active option from “新建项目” to “打开项目” through `aria-activedescendant`/selection state.
- The listbox options use `tabIndex={-1}`, keeping DOM focus on the combobox while arrows update the active descendant; Tab cycles directly between the search field and close control, so Enter cannot disagree with a separately focused option.
- The dialog consumes Enter only when the event originates from the combobox. Enter on the focused close button remains a native button click, closes exactly once, and invokes zero command callbacks.
- The shell background was both assistive-technology-isolated (`inert` plus `aria-hidden`) and pointer-blocked. A normal stage-button click timed out because `.director-command-backdrop` intercepted it.
- Invoking “高级工具” closed the palette before opening its successor drawer. The drawer close button received initial focus; `Escape` closed the drawer and returned focus to the “搜索命令” opener.
- At the compact 1024 px width, a stage button measured 153×44 px and the search trigger measured 48.2×44 px. The responsive contract also enforces 44 px minimum height for palette options/input/close, project and top-bar buttons, the advanced close button, and inspector close controls at 768–1099 px or on coarse pointers.
- The only browser-console error was an unrelated missing `favicon.ico` (404).

Focused fake-DOM regressions additionally prove close-before-command execution, successor focus preservation, combobox-only option focus with active-descendant Enter execution exactly once, native close-button Enter without command execution, palette focus trapping and Escape restoration, real DOM `inert` attribute cleanup, project-menu first-focus/Escape return, and advanced-drawer initial-focus/Escape return. The production build was not rerun for this remediation; its known RunningHub blocker remains recorded below.

At 390×844, the visible 48.2×44 px `搜索命令` control opened the palette by touch and exposed all 12 commands, including `导演工作流` (`app.nodeflow`) and `高级工具` (`app.advanced`), while the shell still had one primary action and zero horizontal overflow.

Inspector closed-state geometry was also verified before ordinary-click reopening:

| Viewport | Reopen button rect | Conflicting region | Result |
| --- | --- | --- | --- |
| 1440×900 | x 1036–1178, y 74–118, height 44 | top actions end at y 50; rail ends at x 174 | visible, no overlap |
| 1024×768 | x 870–1012, y 74–118, height 44 | top actions end at y 50; rail ends at x 174 | visible, no overlap |
| 390×844 | x 236–378, y 68–112, height 44 | top actions end at y 50; bottom rail starts at y 772 | visible, no overlap |

## Web Interface Guidelines audit

The audit covered semantic buttons and landmarks, accessible names, focus visibility, hover-independent controls, command-dialog focus behavior, reduced motion, 44 px mobile targets, long-text truncation, and destructive-action distinction.

Resolved findings:

- Replaced the shell's nested `<main>` landmark with a named workspace section and added a keyboard skip link.
- Added root dark color scheme, intentional tap highlighting, `touch-action: manipulation`, and contained overscroll for overlays.
- Raised onboarding above the compact inspector drawer after Playwright proved its visible close button was pointer-blocked.
- Added an accessible name to the advanced-tools complementary landmark.
- Added the missing screen-reader-only utility so stage descriptions no longer distort the visible rail or mobile bar.
- Removed redundant `aria-hidden` from the already-hidden inspector; a post-fix close did not increase the browser warning count.
- Converted the rail status footer to a bottom-aligned single-column layout so labels and values no longer wrap vertically.
- Kept a touch-sized command trigger visible in the mobile top bar so touch users can reach `app.nodeflow` and `app.advanced`.
- Positioned the inspector reopen control in the visible workspace corner instead of after the full-height app shell, with 44 px height at every verified viewport.
- Added a pointer-blocking command backdrop and real DOM `inert` lifecycle so `aria-modal` behavior matches both pointer and assistive-technology expectations.
- Implemented a complete combobox/listbox announcement model with stable option IDs, `aria-controls`, `aria-expanded`, and `aria-activedescendant`.
- Closed the palette before invoking commands and suppressed trigger-focus restoration during successor-overlay handoff; advanced tools now own initial focus, Escape close, and deterministic opener return.
- Added compact/coarse-pointer 44 px contracts for stage, toolbar, project-menu, command-palette, advanced, and inspector controls.
- Added project-menu first-focus, outside-click close, Escape close, and Escape focus return while mutually closing competing shell overlays.

## Remaining blocker

`npm run build` remains blocked outside the Director Desk scope because `runningHubResult.mjs` imports Node-only `fs`, `path`, `crypto`, and `child_process` modules into the browser graph. The blocking Rollup error is: `"spawnSync" is not exported by "__vite-browser-external"` at line 4. No RunningHub implementation was changed during this verification task.
