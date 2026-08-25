# Character–Storyboard Identity Compilation: Final Audit

**Status:** DONE
**Scope:** Task 1 user-level character identity v1, Task 2 repository-local multimodal correspondence v1, and Task 3 generation QA v1.
**Execution environment:** the fixed bundled Node runtime shown below; no network, model, or provider API calls.

## Contract references inspected

1. `C:\Users\Administrator\.codex\skills\novel-characters\references\identity-module.md`
2. `.agents\skills\novel-storyboard\references\multimodal-correspondence.md`
3. `.agents\skills\novel-storyboard\references\generation-qa.md`

The opt-in producer declares `identityCompilationVersion: 1` and approved `identityModule` records. The correspondence consumer reads `characterRef`, `identityVersion`, and `anchorRef` when `correspondenceVersion: 1` is set. QA validates `cutRef`, `hasDiscrepancies`, `repairLayer`, and `repairScope` without rewriting upstream facts.

## Fresh complete self-tests and legacy smoke tests

Executed from `C:\Users\Administrator\Desktop\ai_project\.worktrees\character-storyboard-identity-compilation`:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\Administrator\.codex\skills\novel-characters\scripts\selftest.mjs'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.agents\skills\novel-storyboard\scripts\selftest.mjs'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\Administrator\.codex\skills\novel-characters\scripts\novel-characters.mjs' validate 'C:\Users\Administrator\.codex\skills\novel-characters\examples\渡口-cast.json' 'C:\Users\Administrator\.codex\skills\novel-characters\examples\渡口.txt'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.agents\skills\novel-storyboard\scripts\novel-storyboard.mjs' validate '.agents\skills\novel-storyboard\examples\渡口-storyboard.json' --script 'C:\Users\Administrator\.codex\skills\novel-script\examples\渡口-script.json' --outline 'C:\Users\Administrator\.codex\skills\novel-outline\examples\渡口-outline.json' --cast 'C:\Users\Administrator\.codex\skills\novel-characters\examples\渡口-cast.json' --art 'C:\Users\Administrator\.codex\skills\novel-art\examples\渡口-art.json'
```

Exact output and exits:

```text
✓ 346 项自测全部通过
✓ 268 项自测全部通过
✓ 4 个角色全部通过校验（lang=zh, style=realistic）
✓ 1 集 / 10 段 / 34 个分镜全部通过校验（共 119s / 目标 120s / 2 个生成批次）
CHARACTER_SELFTEST_EXIT=0
STORYBOARD_SELFTEST_EXIT=0
CHARACTER_LEGACY_EXIT=0
STORYBOARD_LEGACY_EXIT=0
```

The character self-test includes the exact `withIdentity` assertions `完整身份模块通过`, `重复身份引用失败`, `陈旧身份不能正式导出`, and `身份边界矛盾失败`. The storyboard self-test includes `完整逐切对应通过`, `身份版本错绑失败`, `身份绑定分镜上的完整 QA 报告通过`, `未知 cutRef 失败`, and `无偏差标记与 findings 矛盾失败`.

The storyboard legacy fixture has no `correspondenceVersion`; its self-test asserts `gateReport(FIXTURE, CTX).length === 19` (`旧分镜仍保持十九道门`). Therefore it retains 19 gates before optional action gates.

## Reproducible opt-in identity-to-QA smoke

The smoke is retained as untracked local audit evidence at `C:\Users\Administrator\Desktop\ai_project\.worktrees\character-storyboard-identity-compilation\.superpowers\sdd\task-4-opt-in-smoke.mjs`. It rebuilds the test shapes named `IDENTITY_CAST`, `correspondenceDoc`, and `QA_REPORT`, accepts the valid producer-to-consumer chain, then asserts that the `wrongVersion` failure detail contains both the affected cut and character. Its SHA-256 is `0C90C658816834E054D66EE4C2226C09932CAC68869B73C9542029863D108724`.

Literal invocation:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.superpowers\sdd\task-4-opt-in-smoke.mjs'
```

Exact output and exit:

```text
OPT_IN_CHAIN=PASS; GATE=multimodal-correspondence; QA=PASS; WRONG_VERSION_DETAIL_HAS=E01-01#1,C01
OPT_IN_SMOKE_EXIT=0
```

The existing `身份版本错绑失败` unit assertion proves gate rejection. This separate audit script proves the required detail substrings without changing implementation: `${seg.id}#${index + 1}` is `E01-01#1`, and the affected `characterRef` is `C01`.

## Field and forbidden-placeholder scan

Executed from the same worktree:

```powershell
$fieldMatches = @(rg -n "identityCompilationVersion|identityModule|characterRef|identityVersion|anchorRef|correspondenceVersion|correspondence|hasDiscrepancies|repairLayer|repairScope" 'C:\Users\Administrator\.codex\skills\novel-characters' '.agents\skills\novel-storyboard')
$fieldExit = $LASTEXITCODE
$taskForbidden = @(('T'+'BD'), ('TO'+'DO'), ('implement'+' later'), ('fill'+' in'), ('待'+'定'), ('以后'+'再做'))
$ErrorActionPreference = 'Stop'
$placeholderMatches = @(Select-String -ErrorAction Stop -Path 'C:\Users\Administrator\.codex\skills\novel-characters\SKILL.md','C:\Users\Administrator\.codex\skills\novel-characters\references\identity-module.md','.agents\skills\novel-storyboard\SKILL.md','.agents\skills\novel-storyboard\references\multimodal-correspondence.md','.agents\skills\novel-storyboard\references\generation-qa.md' -Pattern $taskForbidden)
Write-Output "FIELD_RG_EXIT=$fieldExit"
Write-Output "FIELD_RG_MATCH_COUNT=$($fieldMatches.Count)"
Write-Output 'PLACEHOLDER_SCAN_OK=True'
Write-Output "PLACEHOLDER_MATCH_COUNT=$($placeholderMatches.Count)"
```

Exact summary output:

```text
FIELD_RG_EXIT=0
FIELD_RG_MATCH_COUNT=167
PLACEHOLDER_SCAN_OK=True
PLACEHOLDER_MATCH_COUNT=0
```

The full scan has 167 matching lines across the producer skill, storyboard skill, contracts, validators, tests, and export projection. The intended ownership is consistent: identity-version fields are produced by `novel-characters` and consumed by correspondence; correspondence fields are storyboard-owned; QA fields are QA-owned. `PLACEHOLDER_SCAN_OK=True` means `Select-String -ErrorAction Stop` completed without a terminating error; it is a cmdlet success marker, not a native exit code. The forbidden scan intentionally targets only the five instructed contract files, so command text in this report is not part of its input set.

## Current file hashes

Executed:

```powershell
$ErrorActionPreference = 'Stop'
Get-FileHash 'C:\Users\Administrator\.codex\skills\novel-characters\SKILL.md','C:\Users\Administrator\.codex\skills\novel-characters\references\identity-module.md','C:\Users\Administrator\.codex\skills\novel-characters\scripts\novel-characters.mjs','C:\Users\Administrator\.codex\skills\novel-characters\scripts\selftest.mjs','.superpowers\sdd\task-4-opt-in-smoke.mjs' -Algorithm SHA256 | ForEach-Object { "HASH=$($_.Hash) PATH=$($_.Path)" }
Write-Output 'GET_FILE_HASH_STATUS=PASS'
```

Exact output:

```text
HASH=AB1EE2DBF3127757EDF003E83ACB558B453B6837DEDE674FAAB1DAECEA2E3991 PATH=C:\Users\Administrator\.codex\skills\novel-characters\SKILL.md
HASH=A229876B69F270287A53A96B3185BB68ECDDF49EF3C9770337707ACAE7A87B2F PATH=C:\Users\Administrator\.codex\skills\novel-characters\references\identity-module.md
HASH=9BFAA3FC26AE5C455B379F827E625ED09EA8FC6C258246B9C5FDCECFD4EB38C4 PATH=C:\Users\Administrator\.codex\skills\novel-characters\scripts\novel-characters.mjs
HASH=8CCDD2412A233FE7C5B1B7E4BB9461856F8DCD8D07D7F8FB2674E6B572A88278 PATH=C:\Users\Administrator\.codex\skills\novel-characters\scripts\selftest.mjs
HASH=0C90C658816834E054D66EE4C2226C09932CAC68869B73C9542029863D108724 PATH=C:\Users\Administrator\Desktop\ai_project\.worktrees\character-storyboard-identity-compilation\.superpowers\sdd\task-4-opt-in-smoke.mjs
GET_FILE_HASH_STATUS=PASS
```

`novel-characters` is a user-level skill outside this repository; these hashes are its reproducible provenance.

## Repository provenance

Task commits examined, oldest to newest:

```text
4f7169d docs: record character identity module update
e5d3801 docs: refresh character identity module evidence
b635d30 docs: add identity selftest evidence
9a10930 feat: add storyboard correspondence contract
55150f2 fix: enforce storyboard correspondence contracts
64f9558 feat: validate storyboard generation qa
41cf242 fix: harden storyboard qa validation
f44f5b9 docs: verify identity compilation pipeline
```

`41cf242` is the pre-audit parent commit. The original final-audit provenance is captured through `f44f5b9`. This subsequent report-only correction commit cannot self-reference its own SHA by construction; its SHA is appended to the untracked `task-4-report.md` after committing. That is a transparent provenance limitation, not a passing check.

## Conclusion and limitations

The deterministic checks above exposed no functional defect and this audit changes no implementation file. Provider/model generation was intentionally not invoked. The user-level character skill has no repository history in this worktree; its hashes and fresh self-test output are the evidence retained here.
