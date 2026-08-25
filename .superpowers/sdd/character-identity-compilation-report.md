# Character identity compilation update

- Implementation: added opt-in v1 identity validation, duplicate-ref detection, versioned assembly and CLI flag; hardened CLI version rejection and malformed identity fields; routed production-only guidance through the skill references.
- RED: original selftest exited 1 at `v1 缺身份模块失败`; regression selftest then exited 1 with `TypeError: object is not iterable` for malformed `forbiddenDrift`.
- GREEN: the bundled Node command exited 0 with `✓ 346 项自测全部通过`.
- Skill validation: Python `runpy` command from the brief exited 0 with `Skill is valid!` (temporary YAML shim removed afterward).
- Changed user-level files: `SKILL.md`; `references/identity-module.md`, `schema.md`, `profile-pass.md`; `scripts/novel-characters.mjs`, `selftest.mjs`.
- SHA256 `SKILL.md`: `AB1EE2DBF3127757EDF003E83ACB558B453B6837DEDE674FAAB1DAECEA2E3991`
- SHA256 `identity-module.md`: `A229876B69F270287A53A96B3185BB68ECDDF49EF3C9770337707ACAE7A87B2F`
- SHA256 `schema.md`: `66A26E6C71E714D0358D4CC471D47489683C2F8B3881D0EA4D4CB8910871492E`
- SHA256 `profile-pass.md`: `5D31AD9D24650B65A62DDD223A815CA9DAFADF58A727D6F46D04D237CC3E2C17`
- SHA256 `novel-characters.mjs`: `9BFAA3FC26AE5C455B379F827E625ED09EA8FC6C258246B9C5FDCECFD4EB38C4`
- SHA256 `selftest.mjs`: `8CCDD2412A233FE7C5B1B7E4BB9461856F8DCD8D07D7F8FB2674E6B572A88278`
- Self-review: legacy four-argument validation remains opt-in; CLI rejects missing/non-integer/unsupported versions before assembly; malformed arrays return problems without throwing; anchor and invariants require actual strings.
- Concern: user-level skill files are intentionally outside Git; only this evidence report is commit-eligible.
