# Character identity compilation update — final-review remediation

## Scope and result

The installed user-level novel-characters skill now treats an omitted identity version as legacy and every explicitly supplied value as opt-in validation input. Only numeric 1 is accepted. Production v1 additionally requires top-level `identityManifests`, reusing the existing asset-pack manifest shape as approval snapshots. Every approved module must have exactly one matching owner/version manifest with approved, non-empty anchor id/file, and its derived anchor reference must equal `identityModule.anchorRef`; assemble, validate, HTML and CLI fail closed or preserve the snapshot end to end. Legacy remains unchanged.

The production workflow is approval-safe: Step 6 may create a legacy/provisional cast, stable character refs are frozen before anchor generation, and final v1 assembly/validation occurs only after Step 8.5 anchor generation and explicit user approval. The canonical schema example is legacy-compatible, with opt-in v1 shown separately.

## TDD evidence

Exact test command used for each RED and the final GREEN:

~~~powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\Administrator\.codex\skills\novel-characters\scripts\selftest.mjs'
~~~

Sequential RED results, all exit 1 for the intended missing behavior:

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

Fresh GREEN:

~~~text
✓ 380 项自测全部通过
CHARACTER_SELFTEST_EXIT=0
~~~

The 380 assertions additionally cover missing/duplicate/wrong-owner/wrong-version/unapproved/missing-file/missing-id manifests, syntactically valid but unregistered anchors, direct and CLI assemble fail-closed behavior, CLI validation, direct/CLI render fail-closed behavior, and manifest preservation through direct HTML plus CLI render/download.

## Installed skill validation and legacy smoke

The plan-specified quick validator ran through the temporary validator-only YAML shim:

~~~text
Skill is valid!
CHARACTER_QUICK_VALIDATE_EXIT=0
~~~

The shim and its generated __pycache__ were removed after validation.

Legacy command:

~~~powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\Administrator\.codex\skills\novel-characters\scripts\novel-characters.mjs' validate 'C:\Users\Administrator\.codex\skills\novel-characters\examples\渡口-cast.json' 'C:\Users\Administrator\.codex\skills\novel-characters\examples\渡口.txt'
~~~

Exact result:

~~~text
✓ 4 个角色全部通过校验（lang=zh, style=realistic）
CHARACTER_LEGACY_EXIT=0
~~~

## User-level files and SHA-256 provenance

These six files are intentionally outside the Git repository:

~~~text
BB263AB4628528D9B42AFA09203A88CF64B92B3AB4BA8187A2FE10BAECD95BF0  C:\Users\Administrator\.codex\skills\novel-characters\SKILL.md
930B90974DD6CDD9A9BE1DFC07F7243E7EE2801B2EE6F50015CCE478B23876C6  C:\Users\Administrator\.codex\skills\novel-characters\references\identity-module.md
5A88AEB76EC60B4DA94E115A4E45429FB82FBA06C0D955FCC5E9A8F6B35B13A1  C:\Users\Administrator\.codex\skills\novel-characters\references\schema.md
9693A91A6A05475BE7775290F26416290D9DACEC74221CFE35EB1EFB6FF0F683  C:\Users\Administrator\.codex\skills\novel-characters\references\profile-pass.md
7016A869990F56ADE76096981C4D763C08D94EC1F34AE4BEFBEA4B2642C4D871  C:\Users\Administrator\.codex\skills\novel-characters\scripts\novel-characters.mjs
67030F5E8842A99C7DAFE9A7CB6A7DDB49D1CBE677F681D9396872926634A01B  C:\Users\Administrator\.codex\skills\novel-characters\scripts\selftest.mjs
GET_FILE_HASH_STATUS=PASS
~~~

## Review

- Legacy four-argument validation remains unchanged through an undefined sentinel.
- Present null is preserved by JSON loading and rejected instead of being coalesced away.
- Approved anchor provenance is not inferred from syntax: it is registered by an exact approved asset-pack manifest snapshot.
- Assemble/render/HTML/CLI preserve both the version and approval snapshot without inventing either for legacy input.
- No provider API, model-specific identity behavior, UI, or unrelated refactor was added.

Limitation: the installed user-level skill has no repository history by design. Its evidence is the six hashes plus fresh deterministic test/validation output above. The repository commit that contains this report cannot self-name its own new SHA; the ignored final-fix-report.md records that SHA immediately after commit.

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
