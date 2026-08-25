# Character identity compilation update — final-review remediation

## Scope and result

The installed user-level novel-characters skill now treats an omitted identity version as legacy and every explicitly supplied value as opt-in validation input. Only numeric 1 is accepted. Direct assembly rejects null, 0, 2, and string "1"; approved anchors must match the owning character and exact identity version; HTML/CLI render-download data retains identityCompilationVersion: 1.

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
~~~

Fresh GREEN:

~~~text
✓ 361 项自测全部通过
CHARACTER_SELFTEST_EXIT=0
~~~

The 361 assertions include absence/null/supported/unsupported version cases, direct assemble rejection, wrong-character/wrong-version/malformed anchors, direct HTML embedded download round-trip, actual CLI render/download round-trip, and CLI validation of a top-level explicit null.

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
BD784AE9D68BF1C8AD3AD45E45385CF66538A4EF2792839D5BD01F3D3CD1A9EE  C:\Users\Administrator\.codex\skills\novel-characters\SKILL.md
247E5D8C469896991EAAD8B73A3859E2EFAC9BD35DAFB836F05BB5F80379BD90  C:\Users\Administrator\.codex\skills\novel-characters\references\identity-module.md
9187B9C50BAFEE8D99EB620687C334D7DA4808E2D42B5B69F234FB48B530D653  C:\Users\Administrator\.codex\skills\novel-characters\references\schema.md
1D0DFFC1432AC8CDBEF91771B658B86D86DCA217D2A96321E7FB03E4997902D0  C:\Users\Administrator\.codex\skills\novel-characters\references\profile-pass.md
7A03F6ED65FE39A31E5484142BA994D23847ABE89F8B54AC6E1E93A0ABB0FACB  C:\Users\Administrator\.codex\skills\novel-characters\scripts\novel-characters.mjs
5461645244D9A087B64AD9CA15D5634A3DD6401E40FB19F10661F4890FB74804  C:\Users\Administrator\.codex\skills\novel-characters\scripts\selftest.mjs
GET_FILE_HASH_STATUS=PASS
~~~

## Review

- Legacy four-argument validation remains unchanged through an undefined sentinel.
- Present null is preserved by JSON loading and rejected instead of being coalesced away.
- Approved anchor provenance is checked with an escaped characterRef and exact A-digits/version pattern.
- Render output preserves the version without inventing it for legacy input.
- No provider API, model-specific identity behavior, UI, or unrelated refactor was added.

Limitation: the installed user-level skill has no repository history by design. Its evidence is the six hashes plus fresh deterministic test/validation output above. The repository commit that contains this report cannot self-name its own new SHA; the ignored final-fix-report.md records that SHA immediately after commit.
