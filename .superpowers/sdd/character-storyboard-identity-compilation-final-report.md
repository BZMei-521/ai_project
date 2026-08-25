# Character–Storyboard Identity Compilation: final-review audit

**Status:** PASS before the report-bearing fix commit

**Reviewed starting head:** 17395fc

**Scope:** all Critical, Important, and Minor findings in final-review-findings.md; user-level novel-characters plus repository-local novel-storyboard contracts/tests/reports.

No network, generation model, provider API, automatic correction loop, application UI, or unrelated application/provider code was used or changed.

## Finding-to-fix audit

1. **Binding fail-closed:** correspondence v1 now requires plain binding objects, rejects duplicate characterRef values, requires string lookRef/startPosition/endPosition, validates complete start/end character boundary objects and fields, and diagnoses malformed/null bindings without throwing. Focused selftests cover null/array/string bindings, duplicates, empty and numeric fields, missing boundary entries, and incomplete boundary objects.
2. **Action/evidence resolution:** non-empty cut.actionRefs requires action context; every ref resolves; binding actionRefs equals resolved participant actions; all supplied evidence belongs to referenced actions; every required action has its own evidence; no-action bindings reject evidence. Focused tests cover each branch.
3. **Version I/O:** character absence remains legacy while present null/0/2/string "1" fails; assemble rejects them; HTML and actual CLI render/download preserve v1. Storyboard only treats a missing field as legacy; present null and other unsupported values create/fail the correspondence gate and structural validation.
4. **Anchor provenance/workflow:** production v1 now requires top-level `identityManifests` approval snapshots in the existing asset-pack manifest shape. Each approved module has exactly one same-owner/version manifest with an approved, non-empty anchor id/file, and the manifest-derived anchor ref must exactly equal `anchorRef`; absent, duplicate, wrong-owner/version/status/file/id and unregistered anchors fail. Assemble/validate/HTML/CLI preserve provenance; legacy is unchanged.
5. **Committed diagnostics:** wrong-version selftests assert exact E01-01#1 and C01 detail. Manifest tests compare against source correspondence and the JSON-serialized/deserialized manifest rather than object identity.
6. **QA summary:** summary requires an actual non-empty string; numeric-summary regression is committed.
7. **Character schema:** canonical example is legacy-compatible; opt-in v1 is separate.

## Final re-review follow-up

- **Important — approved anchor provenance:** fixed with top-level `identityManifests` snapshots reused from `asset-pack.md`; focused character tests cover every rejection and all assemble/render/HTML/CLI preservation paths.
- **Minor — installed assertion wording:** removed the stale hard-coded count from SKILL.md; the selftest output is authoritative.
- **Minor — malformed base collections:** exported `correspondenceProblems` now diagnoses non-array `cut.characters` and explicit non-array `cut.props` without throwing. Six focused null/object/string cases are committed.
- **Docs/schema:** character production commands and schemas require the manifest snapshot; storyboard schemas explicitly state the base array contracts. No second registry, provider/UI behavior, or legacy requirement was introduced.

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

AssertionError [ERR_ASSERTION]: v1 缺身份清单失败
CHARACTER_PROVENANCE_RED_EXIT=1

AssertionError [ERR_ASSERTION]: Missing expected exception: direct HTML render 对无 provenance 的 v1 cast fail closed
CHARACTER_RENDER_PROVENANCE_RED_EXIT=1
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

AssertionError [ERR_ASSERTION]: null cut.characters 返回诊断且不抛错
STORYBOARD_BASE_COLLECTION_RED_EXIT=1
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
✓ 380 项自测全部通过
✓ 306 项自测全部通过
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
FIELD_RG_MATCH_COUNT=281
PLACEHOLDER_SCAN_OK=True
PLACEHOLDER_MATCH_COUNT=0
~~~

The scan covers identityCompilationVersion, identityManifests, identityModule, characterRef, identityVersion, anchorRef, correspondenceVersion, correspondence, hasDiscrepancies, repairLayer, and repairScope in both skills. PLACEHOLDER_SCAN_OK is the PowerShell success marker; the material result is zero matches.

## User-level character hashes

~~~text
BB263AB4628528D9B42AFA09203A88CF64B92B3AB4BA8187A2FE10BAECD95BF0  C:\Users\Administrator\.codex\skills\novel-characters\SKILL.md
930B90974DD6CDD9A9BE1DFC07F7243E7EE2801B2EE6F50015CCE478B23876C6  C:\Users\Administrator\.codex\skills\novel-characters\references\identity-module.md
5A88AEB76EC60B4DA94E115A4E45429FB82FBA06C0D955FCC5E9A8F6B35B13A1  C:\Users\Administrator\.codex\skills\novel-characters\references\schema.md
9693A91A6A05475BE7775290F26416290D9DACEC74221CFE35EB1EFB6FF0F683  C:\Users\Administrator\.codex\skills\novel-characters\references\profile-pass.md
7016A869990F56ADE76096981C4D763C08D94EC1F34AE4BEFBEA4B2642C4D871  C:\Users\Administrator\.codex\skills\novel-characters\scripts\novel-characters.mjs
67030F5E8842A99C7DAFE9A7CB6A7DDB49D1CBE677F681D9396872926634A01B  C:\Users\Administrator\.codex\skills\novel-characters\scripts\selftest.mjs
GET_FILE_HASH_STATUS=PASS
~~~

## Repository provenance and limitation

The reviewed starting head is 17395fc. Repository changes in this remediation are limited to the local novel-storyboard skill, its committed selftests/references, and these two tracked evidence reports. The installed novel-characters edits remain outside Git and are represented by the six hashes above.

This tracked report is included in the new fix commit and therefore cannot self-reference that commit SHA by construction. Immediately after committing, the exact new SHA is recorded in the ignored .superpowers\sdd\final-fix-report.md together with the final post-commit verification.

## Final exact hash audit

After correcting the accidental 65-character transcription, all external-file digest records in both tracked reports and the ignored fix report were compared with fresh `Get-FileHash -Algorithm SHA256` output. There are 24 recorded rows for six unique files (each file appears in four report blocks).

~~~text
RECORDED_DIGEST_COUNT=24
UNIQUE_EXTERNAL_FILE_COUNT=6
EVERY_DIGEST_64_HEX=True
EVERY_DIGEST_EQUALS_CURRENT_FILE=True
EVERY_FILE_RECORDED_IN_ALL_4_BLOCKS=True
SIX_FILE_HASH_COMPARISON_PASS=True
~~~
