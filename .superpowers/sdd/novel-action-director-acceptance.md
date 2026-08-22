# Novel Action Director Acceptance

Date: 2026-08-23

## Outcome

`novel-action-director` is implemented as versioned project source, deployed as a global Codex skill, and connected to `novel-storyboard` through an optional backward-compatible action-summary adapter.

Pipeline:

```text
novel-script → action.json → validated storyboard-actions.json → novel-storyboard
```

Only action/performance-critical beats are deep-planned. Ordinary beats remain authoritative in `script.json`.

## Exact Verification Commands

```text
node C:\Users\Administrator\.codex\skills\novel-action-director\scripts\novel-action-director.mjs validate C:\Users\Administrator\.codex\skills\novel-action-director\examples\渡口-action.json --script C:\Users\Administrator\.codex\skills\novel-script\examples\渡口-script.json
PASS · 18/18 门禁通过 · 4 个动作计划

node C:\Users\Administrator\.codex\skills\novel-action-director\scripts\novel-action-director.mjs export C:\Users\Administrator\.codex\skills\novel-action-director\examples\渡口-action.json --script C:\Users\Administrator\.codex\skills\novel-script\examples\渡口-script.json --out %TEMP%\渡口-storyboard-actions-final.json
exit 0; summaryActions=4

node C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\novel-storyboard.mjs seed C:\Users\Administrator\.codex\skills\novel-script\examples\渡口-script.json --actions %TEMP%\渡口-storyboard-actions-final.json --eps 1-6
exit 0; seedActionBeats=4

node C:\Users\Administrator\.codex\skills\novel-script\scripts\selftest.mjs
✓ 153 项自测全部通过

node C:\Users\Administrator\.codex\skills\novel-storyboard\scripts\selftest.mjs
✓ 221 项自测全部通过

node C:\Users\Administrator\.codex\skills\novel-action-director\scripts\selftest.mjs
✓ 46 项自测全部通过
```

The official `skill-creator/scripts/quick_validate.py` was run against both the project source and global deployment. Both executions exited `0` with no diagnostics.

## Gate Coverage

The action skill exposes exactly 18 deterministic gates:

1. source reference;
2. source fidelity;
3. one major action per beat;
4. complete start/end boundary;
5. combat causality;
6. contact force;
7. displacement grounding;
8. bilateral interaction;
9. prop hands/state;
10. performance trigger/gaze;
11. emotion process;
12. recovery pose;
13. physics profile;
14. adjacent continuity;
15. camera boundary;
16. summary consistency;
17. generation risk;
18. ordinary-beat preservation.

The 46-assertion suite includes one valid baseline and an independently broken fixture for every gate. The storyboard suite adds four optional adapter gates and rejects missing ownership, changed end state, changed hand/contact facts, and action-layer camera overrides.

## Source/Deployment SHA256

The project source and global deployment were compared file by file: `sourceFiles=10`, `hashMismatches=0`.

| Relative file | SHA256 in both locations |
| --- | --- |
| `examples/渡口-action.json` | `CD96E3214D3C034BBFAB84E94A65375E468A73C74693AB80398ACD5397F1D81A` |
| `references/action-pass.md` | `8FBC18962074CC53760B89763398D15899665BFB74B93A23A1E493446DAD725F` |
| `references/combat.md` | `C2C4298C55C1C22FEC5A899F202C83161BDC191F78D1B9C04BFBE3D2505C2D15` |
| `references/interaction.md` | `47D96742C6147B0E6B449FABFACB0F6EEB727D9EC04C2CCAD476942CE12D9818` |
| `references/performance.md` | `6501A553C806DA1A8E5CFE31D461BE8793443187F544E95DF5AC3514CB0A59B1` |
| `references/physics-profiles.md` | `BD356B4799076CED41D67ABBAF1416824538AC17DA603A6BB520F2F1E2064793` |
| `references/schema.md` | `37EEEFD8E53C3FC310A608088DA0AAE6D564F8AC18D780C206E235268AE5DC1E` |
| `scripts/novel-action-director.mjs` | `342B177B7618C63421F2574CE90F7404E9902B8BF85D97CD50049D3B04816AD2` |
| `scripts/selftest.mjs` | `B2EA56B78960F0DA16DFCB375F0607E60E126FCD78722C2ACCEE0DB9AEF6BE80` |
| `SKILL.md` | `D733C7237C8CF39D96AAF5B301B3C79DEBFF8199A324ED67E87632803A61D62B` |

Global storyboard adapter before/after hashes and backup location are recorded in `.superpowers/sdd/novel-action-director-storyboard-adapter.md`.

## Final File List

Versioned:

- `.agents/skills/novel-action-director/SKILL.md`
- `.agents/skills/novel-action-director/scripts/novel-action-director.mjs`
- `.agents/skills/novel-action-director/scripts/selftest.mjs`
- `.agents/skills/novel-action-director/examples/渡口-action.json`
- `.agents/skills/novel-action-director/references/schema.md`
- `.agents/skills/novel-action-director/references/action-pass.md`
- `.agents/skills/novel-action-director/references/performance.md`
- `.agents/skills/novel-action-director/references/interaction.md`
- `.agents/skills/novel-action-director/references/combat.md`
- `.agents/skills/novel-action-director/references/physics-profiles.md`
- `AGENTS.md`
- `.superpowers/sdd/novel-action-director-storyboard-adapter.md`
- `.superpowers/sdd/novel-action-director-acceptance.md`

Deployed globally:

- `C:\Users\Administrator\.codex\skills\novel-action-director\` — exact copy of the 10-file project skill.
- Five planned files under `C:\Users\Administrator\.codex\skills\novel-storyboard\` — optional action adapter, tests, and docs.

## Known Limitations

- The storyboard adapter consumes the compact output of `novel-action-director export`, not raw full `action.json`.
- When one cut claims multiple ordered actions, its projection uses the first action's start state and the last action's end state; intermediate phases stay in `phaseSummary`.
- The first release validates deterministic schema/continuity facts. It does not run pose estimation or biomechanical vision scoring.
- `cameraIntent` carries information visibility only. Concrete shot size, lens, framing, and camera movement remain storyboard decisions.
- The global `novel-storyboard` directory is not a Git repository. Its five original files remain recoverable from the timestamped project backup recorded in the adapter evidence.
