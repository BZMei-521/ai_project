# Novel Storyboard Action Adapter Evidence

Date: 2026-08-23

## Backup Path

`C:\Users\Administrator\.codex\worktrees\718d\ai_project\.superpowers\sdd\novel-action-director-global-backup\20260823-002446\novel-storyboard`

The backup was created before editing. All five files were copied without overwrite and SHA256-checked against the then-current global runtime.

## Changed Global Files

- `C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\selftest.mjs`
- `C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\novel-storyboard.mjs`
- `C:\Users\Administrator\.codex\skills\novel-storyboard\SKILL.md`
- `C:\Users\Administrator\.codex\skills\novel-storyboard\references\schema.md`
- `C:\Users\Administrator\.codex\skills\novel-storyboard\references\storyboard-pass.md`

## Before/After SHA256

| File | Before | After |
| --- | --- | --- |
| `scripts/selftest.mjs` | `2CE0057DCD431A196FC9D0ED9583052C43CE551579ACB9D729028A05F03A3825` | `2B95711CB06AA253FA32F1D21DDB4F2353A8E1E3E1E2080967D67369166992E4` |
| `scripts/novel-storyboard.mjs` | `716D0F6088115FF22CABA559F3EC5FE503303F5701BEEBB223E397901160F5F1` | `B70DCD0CE2E768733A25BD3990150F6234382E514269476141A8768F77098889` |
| `SKILL.md` | `BD7819836C1A2F81076BA44EF74DBD619DCD8A021FA36DA7899F6D5D8F43283D` | `BCC20F8886D3CA55A570874AB4FFE40AD6A0C0F47400884EED55FB7B497D572B` |
| `references/schema.md` | `4ED8C9B9CCF35434A86EC23D1D79122E384CC32701561CCBE85439BA0AA67B81` | `F7881511264C172398C425EB58C677EC7254A5C32BD7E3EECBE61D7CD155239C` |
| `references/storyboard-pass.md` | `46B6F501A012DE36E3F7C0A57A819313D868200823F9C337B1A0EBFB70729621` | `EF8F1579F3B40E645DD91E85D285C42AF9DBDDA87B4892C3E5307AF23F515250` |

## Public Interface Changes

- Added `actionSummaryOf(actions, ep, sceneIndex, beatStart, beatEnd)`.
- Added `actionGateReport(board, actions)` with four deterministic gates.
- Extended `seedFromScript(script, epRange = null, actions = null)`; `actions = null` preserves the previous seed shape.
- Added optional CLI `--actions <summary.json>` to `seed`, `validate`, `checkup`, and `render` context loading.
- Added optional cut fields `actionRefs` and `actionStateProjection`.
- `cameraIntent.mustShow` remains an information constraint; it cannot set cut `camera`, lens, framing, or shot size.

Without `--actions`, `gateReport` remains the original 18-gate public shape. The standalone action-gate report returns four passing entries with the explicit detail `未提供 action.json，跳过（视为通过）` when no action summary is supplied.

## Legacy Regression

Commands and results:

```text
node C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\selftest.mjs
✓ 221 项自测全部通过

node C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\novel-storyboard.mjs validate C:\Users\Administrator\.codex\skills\novel-storyboard\examples\渡口-storyboard.json --script C:\Users\Administrator\.codex\skills\novel-script\examples\渡口-script.json
✓ 1 集 / 10 段 / 34 个分镜全部通过校验（共 119s / 目标 120s / 2 个生成批次）
```

Both commands exited `0`. The legacy validation intentionally omitted `--actions`.

## Action Adapter Tests

The expanded selftest suite contains 14 new assertions on top of the prior 207:

- range-filtered action lookup;
- seed `actionRefs` and compact intent projection;
- exact legacy seed shape without actions;
- valid ownership and state projection;
- integration into total gates only when actions are present;
- missing ownership rejection;
- changed end-state rejection;
- changed hand-state rejection;
- changed contact/must-show rejection;
- concrete camera override rejection;
- four explicit skipped gates without actions.

The real `渡口` summary seed test exited `0` and attached action context to exactly four beats: `E01-S01-B01`, `E01-S01-B06`, `E04-S01-B10`, and `E06-S01-B01`.

## Reviewed Diff Summary

`git diff --no-index --stat` between the immutable backup and the patched mirror reported exactly five files, 237 insertions, and 17 deletions. `git diff --no-index --check` reported no whitespace errors. Review confirmed that changes were limited to optional action lookup/gates/seed/CLI behavior, its tests, and the three planned documentation files.
