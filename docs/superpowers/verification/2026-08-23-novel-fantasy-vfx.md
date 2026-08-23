# Novel Fantasy VFX Verification

- Date: 2026-08-23 (Asia/Shanghai)
- Project skill: `.agents/skills/novel-fantasy-vfx`
- Global skill: `C:\Users\Administrator\.codex\skills\novel-fantasy-vfx`

## Contract and gates

Command:

```powershell
node .agents/skills/novel-fantasy-vfx/scripts/selftest.mjs
```

Result: `✓ fantasy-vfx public contract and 12 gates`.

The suite covers public constants, script expansion, episode selection, seed shape, all 12 deterministic gates, validation failure, storyboard export, Markdown, HTML, and HTML escaping.

## Skill format

Command:

```powershell
python -X utf8 C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py .agents\skills\novel-fantasy-vfx
```

Result: `Skill is valid!`.

`-X utf8` is required on this Windows host because the validator otherwise reads the Chinese UTF-8 `SKILL.md` with the process GBK default.

## CLI smoke checks

All five commands completed with exit code 0 within one bounded run:

- `seed <script.json> --eps 1-1`
- `validate <effects.json> --script <script.json>` — `✓ 通过 12 项法术门禁`
- `render <effects.json> --script <script.json> --md`
- `render <effects.json> --script <script.json> --html`
- `export <effects.json> --script <script.json> --out <temp>/storyboard-effects.json`

The exported summary was 1539 bytes.

## Deployment identity

The project and global skill trees each contain 11 runtime files. Recursive SHA-256 comparison reported `MISMATCHES=0` after syncing four files whose prior difference was CRLF versus LF only; `git diff --ignore-space-at-eol` reported no semantic change.
