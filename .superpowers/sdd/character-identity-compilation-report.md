# Character identity compilation update

- Implementation: added opt-in v1 identity validation, duplicate-ref detection, versioned assembly and CLI flag; routed production-only guidance through the skill references.
- RED: `node.exe ...\\novel-characters\\scripts\\selftest.mjs` exited 1 at `v1 缺身份模块失败` before implementation.
- GREEN: the same command exited 0 with `✓ 339 项自测全部通过`.
- Skill validation: Python `runpy` command from the brief exited 0 with `Skill is valid!` (temporary YAML shim removed afterward).
- Changed user-level files: `SKILL.md`; `references/identity-module.md`, `schema.md`, `profile-pass.md`; `scripts/novel-characters.mjs`, `selftest.mjs`.
- SHA256 `SKILL.md`: `66FB021DC60460A5866825FFC38970B2129DC6690A9B1C5503F9B6481FE4BB0D`
- SHA256 `identity-module.md`: `A229876B69F270287A53A96B3185BB68ECDDF49EF3C9770337707ACAE7A87B2F`
- SHA256 `schema.md`: `66A26E6C71E714D0358D4CC471D47489683C2F8B3881D0EA4D4CB8910871492E`
- SHA256 `profile-pass.md`: `5D31AD9D24650B65A62DDD223A815CA9DAFADF58A727D6F46D04D237CC3E2C17`
- SHA256 `novel-characters.mjs`: `581AB0F3F13490D3E0A53E38510BC543E0F5369BA2D62C61476C886EC4A44EBA`
- SHA256 `selftest.mjs`: `08EE11254FD20B6AB6BEE8D4838F48CD365D1305F5C98AE2D68569FB02F74906`
- Self-review: legacy four-argument validation remains opt-in; only v1 requires approved identity modules; duplicate refs and variation/drift contradictions fail closed.
- Concern: user-level skill files are intentionally outside Git; only this evidence report is commit-eligible.
