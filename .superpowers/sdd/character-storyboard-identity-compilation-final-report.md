# Character–Storyboard Identity Compilation: Final Audit

**Status:** DONE
**Audited base/head before this report commit:** `41cf242ed4bdbe47eee3038373670e7b527d9249` — `fix: harden storyboard qa validation`
**Audit scope:** Task 1 user-level character identity v1, Task 2 repository-local multimodal correspondence v1, and Task 3 generation QA v1.
**Execution environment:** fixed bundled Node runtime; no network or model/provider API calls.

## Contract references inspected

1. `C:\Users\Administrator\.codex\skills\novel-characters\references\identity-module.md`
2. `.agents/skills/novel-storyboard/references/multimodal-correspondence.md`
3. `.agents/skills/novel-storyboard/references/generation-qa.md`

The producer declares an opt-in `identityCompilationVersion: 1` and supplies approved `identityModule` records.  The correspondence contract consumes `characterRef`, `identityVersion`, and `anchorRef` from those records only when `correspondenceVersion: 1` is selected.  The QA contract validates `cutRef` plus `hasDiscrepancies`, `repairLayer`, and `repairScope`; it does not rewrite upstream facts.

## Fresh complete self-tests

Commands executed from this worktree with `C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`:

```powershell
& $node 'C:\Users\Administrator\.codex\skills\novel-characters\scripts\selftest.mjs'
& $node '.agents\skills\novel-storyboard\scripts\selftest.mjs'
```

| Suite | Exit | Fresh output |
|---|---:|---|
| `novel-characters` | 0 | `✓ 346 项自测全部通过` |
| `novel-storyboard` | 0 | `✓ 268 项自测全部通过` |

The character suite contains, and the passing total includes, the exact `withIdentity` assertions: `完整身份模块通过`, `重复身份引用失败`, `陈旧身份不能正式导出`, and `身份边界矛盾失败`.

The storyboard suite contains, and the passing total includes, the exact shared-object assertions: `完整逐切对应通过`, `身份版本错绑失败`, `身份绑定分镜上的完整 QA 报告通过`, `未知 cutRef 失败`, and `无偏差标记与 findings 矛盾失败`.

## Explicit legacy compatibility smoke tests

| Input and command | Exit | Evidence |
|---|---:|---|
| `渡口-cast.json` without `identityCompilationVersion`: `novel-characters.mjs validate <cast> <source>` | 0 | `✓ 4 个角色全部通过校验（lang=zh, style=realistic）` |
| `渡口-storyboard.json` without `correspondenceVersion`: `novel-storyboard.mjs validate <board> --script <script> --outline <outline> --cast <cast> --art <art>` | 0 | `✓ 1 集 / 10 段 / 34 个分镜全部通过校验（共 119s / 目标 120s / 2 个生成批次）` |

The storyboard suite independently asserts `gateReport(FIXTURE, CTX).length === 19` (`旧分镜仍保持十九道门`), so the legacy board has 19 gates before any optional action gates.

## Opt-in producer-to-consumer chain

An additional read-only Node smoke check rebuilt the exact Task 2–3 test shapes (`IDENTITY_CAST`, `correspondenceDoc`, and `QA_REPORT`) from the installed fixtures and asserted the ordered chain:

1. `multimodal-correspondence` accepts the complete v1 correspondence document with the approved identity cast.
2. `validateGenerationQa(QA_REPORT, correspondenceDoc)` returns no findings.
3. A copied `wrongVersion` document is rejected by the `multimodal-correspondence` gate; its detail includes both affected references.

Exit was `0` with exact output:

```text
OPT_IN_CHAIN=PASS; GATE=multimodal-correspondence; QA=PASS; WRONG_VERSION_DETAIL_HAS=E01-01#1,C01
OPT_IN_AUDIT_EXIT=0
```

The existing self-test's `身份版本错绑失败` assertion proves rejection.  The audit smoke adds the required detail assertions without changing implementation: the returned failure identifies both `${seg.id}#${index + 1}` (`E01-01#1`) and the bound `characterRef` (`C01`).

## Field and placeholder audit

Executed:

```powershell
rg -n "identityCompilationVersion|identityModule|characterRef|identityVersion|anchorRef|correspondenceVersion|correspondence|hasDiscrepancies|repairLayer|repairScope" 'C:\Users\Administrator\.codex\skills\novel-characters' '.agents\skills\novel-storyboard'
$taskForbidden = @(('T'+'BD'), ('TO'+'DO'), ('implement'+' later'), ('fill'+' in'), ('待'+'定'), ('以后'+'再做'))
Select-String -Path 'C:\Users\Administrator\.codex\skills\novel-characters\SKILL.md','C:\Users\Administrator\.codex\skills\novel-characters\references\identity-module.md','.agents\skills\novel-storyboard\SKILL.md','.agents\skills\novel-storyboard\references\multimodal-correspondence.md','.agents\skills\novel-storyboard\references\generation-qa.md' -Pattern $taskForbidden
```

`rg` exited `0`.  The producer-side identity terms appear in the character skill and identity contract; consumer-side identity terms appear in the correspondence contract and validator; correspondence terms appear in the storyboard skill, contract, validator, and export; and QA terms appear in the QA contract and validator.  The follow-up counted `PLACEHOLDER_MATCH_COUNT=0` (exit `0`) for the five instructed contract files.

## Provenance

The user-level `novel-characters` skill is outside this repository.  These current SHA-256 hashes were recorded from the files actually tested:

| File | SHA-256 |
|---|---|
| `SKILL.md` | `AB1EE2DBF3127757EDF003E83ACB558B453B6837DEDE674FAAB1DAECEA2E3991` |
| `references/identity-module.md` | `A229876B69F270287A53A96B3185BB68ECDDF49EF3C9770337707ACAE7A87B2F` |
| `scripts/novel-characters.mjs` | `9BFAA3FC26AE5C455B379F827E625ED09EA8FC6C258246B9C5FDCECFD4EB38C4` |
| `scripts/selftest.mjs` | `8CCDD2412A233FE7C5B1B7E4BB9461856F8DCD8D07D7F8FB2674E6B572A88278` |

Repository commits examined (newest first):

```text
41cf242 fix: harden storyboard qa validation
64f9558 feat: validate storyboard generation qa
55150f2 fix: enforce storyboard correspondence contracts
9a10930 feat: add storyboard correspondence contract
b635d30 docs: add identity selftest evidence
e5d3801 docs: refresh character identity module evidence
```

`git diff --check 41cf242` produced no output (exit `0`).

## Limitations and conclusion

No provider/model generation was invoked; this audit covers only deterministic contract, validator, fixture, and export-facing paths, as required.  The installed character skill is outside Git, so hashes—not repository history—are the reproducible provenance for that portion.  No functional defect was exposed, and no implementation file was changed by this audit.
