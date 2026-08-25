# Character–Storyboard Identity Compilation: final-review audit

**Status:** PASS before the report-bearing fix commit

**Reviewed starting head:** 17395fc

**Scope:** all Critical, Important, and Minor findings in final-review-findings.md; user-level novel-characters plus repository-local novel-storyboard contracts/tests/reports.

No network, generation model, provider API, automatic correction loop, application UI, or unrelated application/provider code was used or changed.

## Finding-to-fix audit

1. **Binding fail-closed:** correspondence v1 now requires plain binding objects, rejects duplicate characterRef values, requires string lookRef/startPosition/endPosition, validates complete start/end character boundary objects and fields, and diagnoses malformed/null bindings without throwing. Focused selftests cover null/array/string bindings, duplicates, empty and numeric fields, missing boundary entries, and incomplete boundary objects.
2. **Action/evidence resolution:** non-empty cut.actionRefs requires action context; every ref resolves; binding actionRefs equals resolved participant actions; all supplied evidence belongs to referenced actions; every required action has its own evidence; no-action bindings reject evidence. Focused tests cover each branch.
3. **Version I/O:** character absence remains legacy while present null/0/2/string "1" fails; assemble rejects them; HTML and actual CLI render/download preserve v1. Storyboard only treats a missing field as legacy; present null and other unsupported values create/fail the correspondence gate and structural validation.
4. **Anchor provenance/workflow:** approved anchors match the owning escaped characterRef and exact identityVersion. Wrong-character, wrong-version, and malformed tests are committed in the installed skill. Documentation allocates stable refs before anchors and delays final v1 assembly/validation until Step 8.5 user approval.
5. **Committed diagnostics:** wrong-version selftests assert exact E01-01#1 and C01 detail. Manifest tests compare against source correspondence and the JSON-serialized/deserialized manifest rather than object identity.
6. **QA summary:** summary requires an actual non-empty string; numeric-summary regression is committed.
7. **Character schema:** canonical example is legacy-compatible; opt-in v1 is separate.

## TDD evidence

Character RED command:

~~~powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\Administrator\.codex\skills\novel-characters\scripts\selftest.mjs'
~~~

Sequential intended REDs:

~~~text
AssertionError [ERR_ASSERTION]: Missing expected exception: assemble 拒绝显式无效身份版本 null
CHARACTER_RED_EXIT=1

AssertionError [ERR_ASSERTION]: 显式 null 身份版本失败
CHARACTER_RED2_EXIT=1

AssertionError [ERR_ASSERTION]: 锚点不能属于其他角色
CHARACTER_RED3_EXIT=1

AssertionError [ERR_ASSERTION]: HTML 下载数据保留 identityCompilationVersion: 1 — 期望 1，实际 undefined
CHARACTER_RED4_EXIT=1
~~~

Storyboard RED command:

~~~powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.agents\skills\novel-storyboard\scripts\selftest.mjs'
~~~

Sequential intended REDs:

~~~text
AssertionError [ERR_ASSERTION]: 数值 summary 失败
STORYBOARD_RED_EXIT=1

TypeError: Cannot read properties of null (reading 'characterRef')
at correspondenceProblems (...novel-storyboard.mjs:456:51)
STORYBOARD_RED2_EXIT=1

AssertionError [ERR_ASSERTION]: 显式 null correspondenceVersion 结构校验失败
STORYBOARD_AFTER_STRUCTURE_EXIT=1
~~~

## Fresh complete selftests and skill validation

Commands:

~~~powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\Administrator\.codex\skills\novel-characters\scripts\selftest.mjs'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.agents\skills\novel-storyboard\scripts\selftest.mjs'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -X utf8 -c "import sys,runpy;sys.path.insert(0,r'.codex-validate-shim');sys.argv=[r'quick_validate.py',r'C:\Users\Administrator\.codex\skills\novel-characters'];runpy.run_path(r'C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py',run_name='__main__')"
~~~

Exact output/exits:

~~~text
✓ 361 项自测全部通过
✓ 300 项自测全部通过
Skill is valid!
CHARACTER_SELFTEST_EXIT=0
STORYBOARD_SELFTEST_EXIT=0
CHARACTER_QUICK_VALIDATE_EXIT=0
~~~

The temporary YAML shim and generated __pycache__ were removed afterward.

## Legacy compatibility

Commands:

~~~powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\Administrator\.codex\skills\novel-characters\scripts\novel-characters.mjs' validate 'C:\Users\Administrator\.codex\skills\novel-characters\examples\渡口-cast.json' 'C:\Users\Administrator\.codex\skills\novel-characters\examples\渡口.txt'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.agents\skills\novel-storyboard\scripts\novel-storyboard.mjs' validate '.agents\skills\novel-storyboard\examples\渡口-storyboard.json' --script 'C:\Users\Administrator\.codex\skills\novel-script\examples\渡口-script.json' --outline 'C:\Users\Administrator\.codex\skills\novel-outline\examples\渡口-outline.json' --cast 'C:\Users\Administrator\.codex\skills\novel-characters\examples\渡口-cast.json' --art 'C:\Users\Administrator\.codex\skills\novel-art\examples\渡口-art.json'
~~~

Exact output/exits:

~~~text
✓ 4 个角色全部通过校验（lang=zh, style=realistic）
✓ 1 集 / 10 段 / 34 个分镜全部通过校验（共 119s / 目标 120s / 2 个生成批次）
CHARACTER_LEGACY_EXIT=0
STORYBOARD_LEGACY_EXIT=0
~~~

The legacy storyboard fixture has no correspondenceVersion. The committed selftest asserts it keeps exactly 19 base gates before optional action gates.

## QA CLI positive/negative smoke

Temporary valid and invalid QA JSON files were created for the commands and removed afterward.

~~~powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.agents\skills\novel-storyboard\scripts\novel-storyboard.mjs' qa-validate '.superpowers\sdd\final-fix-qa-valid.json' --storyboard '.agents\skills\novel-storyboard\examples\渡口-storyboard.json'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.agents\skills\novel-storyboard\scripts\novel-storyboard.mjs' qa-validate '.superpowers\sdd\final-fix-qa-invalid.json' --storyboard '.agents\skills\novel-storyboard\examples\渡口-storyboard.json'
~~~

Exact output/exits:

~~~text
✓ storyboard-qa.json 结构与分镜引用全部通过
QA_POSITIVE_EXIT=0

✗ 1 处 QA 结构违规：

  Q-E99-99-C01-01 的 cutRef 不存在：E99-99#9
QA_NEGATIVE_EXIT=1
~~~

## Opt-in producer-to-consumer smoke

Command:

~~~powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.superpowers\sdd\task-4-opt-in-smoke.mjs'
~~~

Exact output/exit:

~~~text
OPT_IN_CHAIN=PASS; GATE=multimodal-correspondence; QA=PASS; WRONG_VERSION_DETAIL_HAS=E01-01#1,C01
OPT_IN_SMOKE_EXIT=0
~~~

Smoke script SHA-256:

~~~text
0C90C658816834E054D66EE4C2226C09932CAC68869B73C9542029863D108724  .superpowers\sdd\task-4-opt-in-smoke.mjs
~~~

## Contract field and placeholder scans

The plan-specified rg field scan and Select-String forbidden-placeholder scan produced:

~~~text
FIELD_RG_EXIT=0
FIELD_RG_MATCH_COUNT=235
PLACEHOLDER_SCAN_OK=True
PLACEHOLDER_MATCH_COUNT=0
~~~

The scan covers identityCompilationVersion, identityModule, characterRef, identityVersion, anchorRef, correspondenceVersion, correspondence, hasDiscrepancies, repairLayer, and repairScope in both skills. PLACEHOLDER_SCAN_OK is the PowerShell success marker; the material result is zero matches.

## User-level character hashes

~~~text
BD784AE9D68BF1C8AD3AD45E45385CF66538A4EF2792839D5BD01F3D3CD1A9EE  C:\Users\Administrator\.codex\skills\novel-characters\SKILL.md
247E5D8C469896991EAAD8B73A3859E2EFAC9BD35DAFB836F05BB5F80379BD90  C:\Users\Administrator\.codex\skills\novel-characters\references\identity-module.md
9187B9C50BAFEE8D99EB620687C334D7DA4808E2D42B5B69F234FB48B530D653  C:\Users\Administrator\.codex\skills\novel-characters\references\schema.md
1D0DFFC1432AC8CDBEF91771B658B86D86DCA217D2A96321E7FB03E4997902D0  C:\Users\Administrator\.codex\skills\novel-characters\references\profile-pass.md
7A03F6ED65FE39A31E5484142BA994D23847ABE89F8B54AC6E1E93A0ABB0FACB  C:\Users\Administrator\.codex\skills\novel-characters\scripts\novel-characters.mjs
5461645244D9A087B64AD9CA15D5634A3DD6401E40FB19F10661F4890FB74804  C:\Users\Administrator\.codex\skills\novel-characters\scripts\selftest.mjs
GET_FILE_HASH_STATUS=PASS
~~~

## Repository provenance and limitation

The reviewed starting head is 17395fc. Repository changes in this remediation are limited to the local novel-storyboard skill, its committed selftests/references, and these two tracked evidence reports. The installed novel-characters edits remain outside Git and are represented by the six hashes above.

This tracked report is included in the new fix commit and therefore cannot self-reference that commit SHA by construction. Immediately after committing, the exact new SHA is recorded in the ignored .superpowers\sdd\final-fix-report.md together with the final post-commit verification.
