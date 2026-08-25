# Character Identity Compilation and Storyboard Correspondence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add versioned character identity modules, per-cut multimodal correspondence, and structured generation QA to the existing character and storyboard skills without breaking legacy JSON.

**Architecture:** `novel-characters` remains the authority for approved identity versions and observable invariants. `novel-storyboard` consumes those identities together with script, action, previs, scene, prop, and boundary facts through an opt-in `correspondenceVersion: 1` contract; generated media is evaluated separately in `storyboard-qa.json` so QA never rewrites approved storyboard facts.

**Tech Stack:** Node.js ES modules using only the standard library, JSON contracts, Markdown skill references, existing self-test runners.

## Global Constraints

- Do not add Gemini, Banana, or any provider-specific API, model name, authentication, or billing behavior.
- Do not add comic-page panels, speech-bubble schema, SVG canvas, pose editor, or Storyboard Pro UI changes.
- `identityCompilationVersion: 1` and `correspondenceVersion: 1` are explicit opt-in switches; absent switches preserve legacy behavior.
- Declaring a version while omitting its required fields must fail validation; never invent defaults that claim an identity or QA check exists.
- Keep `script.json`, character identity, action/previs, `art.json`, and `storyboard.json` authority boundaries unchanged.
- QA may recommend one correction pass; it must not automatically loop or mutate approved source files.
- Preserve all unrelated dirty-worktree changes and stage only paths named by the current task.
- The active `novel-characters` installation is `C:\Users\Administrator\.codex\skills\novel-characters`, outside the repository; validate it in place and do not pretend it is covered by repository commits.

---

### Task 1: Versioned Character Identity Module

**Files:**
- Modify: `C:\Users\Administrator\.codex\skills\novel-characters\SKILL.md`
- Create: `C:\Users\Administrator\.codex\skills\novel-characters\references\identity-module.md`
- Modify: `C:\Users\Administrator\.codex\skills\novel-characters\references\schema.md`
- Modify: `C:\Users\Administrator\.codex\skills\novel-characters\references\profile-pass.md`
- Modify: `C:\Users\Administrator\.codex\skills\novel-characters\scripts\novel-characters.mjs`
- Test: `C:\Users\Administrator\.codex\skills\novel-characters\scripts\selftest.mjs`

**Interfaces:**
- Consumes: existing character cards and optional top-level `identityCompilationVersion`.
- Produces: `identityModule` on each character with `characterRef`, `identityVersion`, `anchorRef`, `status`, `invariants`, `allowedVariations`, and `forbiddenDrift`.
- Produces: `validateCast(characters, sourceText, lang, style, identityCompilationVersion)`; existing four-argument calls remain valid.
- Produces: `assembleCast(cards, options)` that emits `identityCompilationVersion: 1` only when explicitly requested.

- [ ] **Step 1: Add failing identity-version tests**

Append tests that prove legacy compatibility, explicit activation, valid identity acceptance, duplicate references, stale status, and invariant/variation contradiction:

```js
const deepClone = (value) => JSON.parse(JSON.stringify(value));
const withIdentity = deepClone(CAST);
withIdentity.forEach((character, index) => {
  character.identityModule = {
    characterRef: `C${String(index + 1).padStart(2, '0')}`,
    identityVersion: 1,
    anchorRef: `C${String(index + 1).padStart(2, '0')}-A0-v1`,
    status: 'approved',
    invariants: {
      face: ['stable face geometry'], hair: ['stable hair structure'],
      body: ['stable body scale'], baseCostume: ['stable base costume'],
    },
    allowedVariations: ['expression', 'pose', 'lighting', 'approved-state-variant'],
    forbiddenDrift: ['face-geometry', 'hair-structure', 'body-scale', 'costume-pattern-relocation'],
  };
});

eq(validateCast(CAST, SOURCE, 'zh', 'realistic').length, 0, '旧 cast 不启用身份编译仍通过');
ok(validateCast(CAST, SOURCE, 'zh', 'realistic', 1).some((x) => x.includes('identityModule')), 'v1 缺身份模块失败');
eq(validateCast(withIdentity, SOURCE, 'zh', 'realistic', 1).length, 0, '完整身份模块通过');

const duplicateRef = deepClone(withIdentity);
duplicateRef[1].identityModule.characterRef = duplicateRef[0].identityModule.characterRef;
ok(validateCast(duplicateRef, SOURCE, 'zh', 'realistic', 1).some((x) => x.includes('characterRef 重复')), '重复身份引用失败');

const staleIdentity = deepClone(withIdentity);
staleIdentity[0].identityModule.status = 'stale';
ok(validateCast(staleIdentity, SOURCE, 'zh', 'realistic', 1).some((x) => x.includes('必须 approved')), '陈旧身份不能正式导出');

const contradiction = deepClone(withIdentity);
contradiction[0].identityModule.allowedVariations.push('face-geometry');
ok(validateCast(contradiction, SOURCE, 'zh', 'realistic', 1).some((x) => x.includes('允许变化与禁止漂移冲突')), '身份边界矛盾失败');
```

- [ ] **Step 2: Run the character tests and confirm red state**

Run:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\Administrator\.codex\skills\novel-characters\scripts\selftest.mjs'
```

Expected: FAIL because the fifth `validateCast` argument and identity rules do not exist.

- [ ] **Step 3: Implement identity validation and assembly**

Add these constants and helper near `validateCast`:

```js
const IDENTITY_STATUSES = new Set(['draft', 'review', 'approved', 'rejected', 'stale']);
const IDENTITY_INVARIANT_GROUPS = ['face', 'hair', 'body', 'baseCostume'];
const VARIATION_TO_DRIFT = {
  expression: null, pose: null, lighting: null, 'approved-state-variant': null,
  'face-geometry': 'face-geometry', 'hair-structure': 'hair-structure',
  'body-scale': 'body-scale', 'costume-pattern-relocation': 'costume-pattern-relocation',
};

function identityProblems(character, version) {
  if (version == null) return [];
  if (version !== 1) return [`identityCompilationVersion 目前只支持 1，实际是 ${version}`];
  const m = character?.identityModule;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['缺 identityModule'];
  const out = [];
  if (!/^C\d{2,}$/.test(String(m.characterRef ?? ''))) out.push('identityModule.characterRef 必须形如 C01');
  if (!Number.isInteger(m.identityVersion) || m.identityVersion < 1) out.push('identityModule.identityVersion 必须是正整数');
  if (!String(m.anchorRef ?? '').trim()) out.push('identityModule.anchorRef 不能为空');
  if (!IDENTITY_STATUSES.has(m.status)) out.push(`identityModule.status 无效：${m.status}`);
  if (m.status !== 'approved') out.push('正式身份模块 status 必须 approved');
  for (const group of IDENTITY_INVARIANT_GROUPS) {
    if (!Array.isArray(m.invariants?.[group]) || m.invariants[group].length === 0 || m.invariants[group].some((x) => !String(x).trim())) {
      out.push(`identityModule.invariants.${group} 必须是非空字符串数组`);
    }
  }
  if (!Array.isArray(m.allowedVariations)) out.push('identityModule.allowedVariations 必须是数组');
  if (!Array.isArray(m.forbiddenDrift)) out.push('identityModule.forbiddenDrift 必须是数组');
  const forbidden = new Set(m.forbiddenDrift ?? []);
  for (const item of m.allowedVariations ?? []) {
    if (!Object.hasOwn(VARIATION_TO_DRIFT, item)) out.push(`未知 allowedVariation：${item}`);
    if (VARIATION_TO_DRIFT[item] && forbidden.has(VARIATION_TO_DRIFT[item])) out.push(`允许变化与禁止漂移冲突：${item}`);
  }
  return out;
}
```

Change the validator signature and add whole-cast duplicate checking:

```js
export function validateCast(characters, sourceText, lang = DEFAULT_LANG, style = DEFAULT_STYLE, identityCompilationVersion = null) {
  const problems = [];
  const identityRefs = new Set();
  // existing setup...
  for (const c of characters) {
    const name = c?.name ?? '(无名)';
    for (const problem of identityProblems(c, identityCompilationVersion)) at(name, problem);
    if (identityCompilationVersion === 1 && c?.identityModule?.characterRef) {
      const ref = c.identityModule.characterRef;
      if (identityRefs.has(ref)) at(name, `characterRef 重复：${ref}`);
      identityRefs.add(ref);
    }
    // existing checks continue unchanged
  }
  return problems;
}
```

Extend `assembleCast` options and output:

```js
export function assembleCast(cards, {
  source, lang = DEFAULT_LANG, style = DEFAULT_STYLE, summary = '', ui = null,
  order = null, identityCompilationVersion = null,
} = {}) {
  // existing sorting...
  const cast = { source, lang, style };
  if (identityCompilationVersion != null) cast.identityCompilationVersion = identityCompilationVersion;
  // existing ui/summary/characters assignments...
  return cast;
}
```

In the CLI, pass `doc.identityCompilationVersion` to `validateCast`. For `assemble`, parse `--identity-version 1`, pass the numeric value into `assembleCast`, and update the usage text with the exact flag.

- [ ] **Step 4: Add the identity-module reference and route it from the skill**

Create `references/identity-module.md` with the exact v1 JSON contract, authority rules, anchor upgrade/stale behavior, reference priority, conflict fail-closed behavior, and downstream compact fields. Update `references/schema.md`, `references/profile-pass.md`, and `SKILL.md` so `--identity-version 1` is used only for production identity packages; ordinary character extraction remains legacy-compatible.

- [ ] **Step 5: Run the character tests and validate the installed skill**

Run the self-test command from Step 2.

Expected: `✓ ... 项自测全部通过` with exit code `0`.

The bundled Python lacks PyYAML. Create `.codex-validate-shim/yaml.py` with this validator-only compatibility implementation, invoke `quick_validate.py` through `runpy`, then delete the shim directory:

```python
class YAMLError(Exception):
    pass

def safe_load(text):
    result, lines, index = {}, text.splitlines(), 0
    while index < len(lines):
        line = lines[index]
        if not line.strip() or line.startswith((' ', '\t')):
            index += 1
            continue
        if ':' not in line:
            raise YAMLError(f'invalid top-level entry: {line}')
        key, raw = line.split(':', 1)
        raw = raw.strip()
        if raw in ('|', '>'):
            parts = []
            index += 1
            while index < len(lines) and (not lines[index].strip() or lines[index].startswith((' ', '\t'))):
                parts.append(lines[index].strip())
                index += 1
            result[key.strip()] = '\n'.join(parts).strip()
            continue
        result[key.strip()] = raw.strip('"\'') if raw else {}
        index += 1
    return result
```

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -X utf8 -c "import sys,runpy;sys.path.insert(0,r'.codex-validate-shim');sys.argv=[r'quick_validate.py',r'C:\Users\Administrator\.codex\skills\novel-characters'];runpy.run_path(r'C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py',run_name='__main__')"
```

Expected: `Skill is valid!` with exit code `0`.

- [ ] **Step 6: Record the unversioned installation change**

Because this user-level skill is outside any Git repository, do not create a fake commit. Save `Get-FileHash` values for the six touched files and the self-test output in `.superpowers/sdd/character-identity-compilation-report.md`; commit only that report:

```powershell
git add -- '.superpowers/sdd/character-identity-compilation-report.md'
git commit -m "docs: record character identity module update"
```

---

### Task 2: Per-Cut Multimodal Correspondence

**Files:**
- Modify: `.agents/skills/novel-storyboard/SKILL.md`
- Create: `.agents/skills/novel-storyboard/references/multimodal-correspondence.md`
- Modify: `.agents/skills/novel-storyboard/references/schema.md`
- Modify: `.agents/skills/novel-storyboard/references/storyboard-pass.md`
- Modify: `.agents/skills/novel-storyboard/scripts/novel-storyboard.mjs`
- Test: `.agents/skills/novel-storyboard/scripts/selftest.mjs`

**Interfaces:**
- Consumes: `ctx.cast.characters[].identityModule`, `ctx.actions.actions`, existing `assetDecisions`, `actionRefs`, `startBoundary/endBoundary`, script scenes, and optional previs evidence.
- Produces: optional top-level `correspondenceVersion: 1` and required `cut.correspondence` objects.
- Produces: `correspondenceProblems(board, ctx): string[]` and an opt-in `multimodal-correspondence` quality gate.
- Produces: exported segment manifest entries containing the approved correspondence snapshot for each cut.

- [ ] **Step 1: Add failing correspondence tests**

Create a helper that upgrades the existing continuity fixture:

```js
function withCorrespondence() {
  const doc = withContinuity();
  doc.correspondenceVersion = 1;
  for (const ep of doc.episodes) for (const seg of ep.segments) {
    for (const cut of seg.cuts) {
      cut.correspondence = {
        sourceBeats: { sceneIndex: seg.sceneIndex, beats: clone(cut.beats) },
        emptyCharacterShot: cut.characters.length === 0,
        characters: cut.characters.map((characterRef) => ({
          characterRef,
          identityVersion: 1,
          lookRef: cut.startBoundary.characters[characterRef].lookRef,
          actionRefs: clone(cut.actionRefs ?? []),
          poseEvidenceRefs: [],
          startPosition: cut.startBoundary.characters[characterRef].position,
          endPosition: cut.endBoundary.characters[characterRef].position,
        })),
        sceneRef: cut.startBoundary.spatialAnchor,
        propRefs: clone(cut.props ?? []),
        mustShow: clone(cut.actionStateProjection?.mustShow ?? []),
      };
    }
  }
  return doc;
}

const fixtureCharacterRefs = [...new Set(FIXTURE.episodes.flatMap((ep) =>
  ep.segments.flatMap((seg) => seg.cuts.flatMap((cut) => cut.characters ?? []))))];
const IDENTITY_CAST = {
  characters: fixtureCharacterRefs.map((characterRef) => ({
    identityModule: {
      characterRef, identityVersion: 1, anchorRef: `${characterRef}-A0-v1`, status: 'approved',
      invariants: { face: ['face'], hair: ['hair'], body: ['body'], baseCostume: ['costume'] },
      allowedVariations: ['expression', 'pose', 'lighting'],
      forbiddenDrift: ['face-geometry', 'hair-structure', 'body-scale'],
    },
  })),
};
```

Add assertions:

```js
eq(gateReport(FIXTURE, CTX).length, 19, '旧分镜仍保持十九道门');
const correspondenceDoc = withCorrespondence();
ok(gate(correspondenceDoc, 'multimodal-correspondence', { ...CTX, cast: IDENTITY_CAST }).ok, '完整逐切对应通过');

const missingBinding = withCorrespondence();
missingBinding.episodes[0].segments[0].cuts[0].correspondence.characters = [];
ok(!gate(missingBinding, 'multimodal-correspondence', { ...CTX, cast: IDENTITY_CAST }).ok, '画内角色缺绑定失败');

const wrongVersion = withCorrespondence();
wrongVersion.episodes[0].segments[0].cuts[0].correspondence.characters[0].identityVersion = 99;
ok(!gate(wrongVersion, 'multimodal-correspondence', { ...CTX, cast: IDENTITY_CAST }).ok, '身份版本错绑失败');

const badEmptyShot = withCorrespondence();
badEmptyShot.episodes[0].segments[0].cuts[0].correspondence.emptyCharacterShot = true;
ok(!gate(badEmptyShot, 'multimodal-correspondence', { ...CTX, cast: IDENTITY_CAST }).ok, '有角色镜头不能标为空镜');
```

- [ ] **Step 2: Run storyboard tests and confirm red state**

Run:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.agents\skills\novel-storyboard\scripts\selftest.mjs'
```

Expected: FAIL because the new version and gate are not implemented.

- [ ] **Step 3: Implement `correspondenceProblems`**

Add an exported helper before `gateReport`:

```js
export function correspondenceProblems(board, ctx = {}) {
  if (board?.correspondenceVersion == null) return [];
  if (board.correspondenceVersion !== 1) return [`correspondenceVersion 目前只支持 1，实际是 ${board.correspondenceVersion}`];
  const out = [];
  const identities = new Map((ctx.cast?.characters ?? []).map((c) => [c.identityModule?.characterRef, c.identityModule]));
  const actionById = new Map(Object.values(ctx.actions?.actions ?? {}).map((action) => [action.actionId, action]));
  for (const ep of board.episodes ?? []) for (const seg of ep.segments ?? []) {
    for (let index = 0; index < (seg.cuts ?? []).length; index += 1) {
      const cut = seg.cuts[index];
      const where = `${seg.id}#${index + 1}`;
      const c = cut?.correspondence;
      if (!c || typeof c !== 'object' || Array.isArray(c)) { out.push(`${where} 缺 correspondence`); continue; }
      if (c.sourceBeats?.sceneIndex !== seg.sceneIndex || stable(c.sourceBeats?.beats) !== stable(cut.beats)) out.push(`${where} sourceBeats 与分镜认领不一致`);
      const refs = new Set(cut.characters ?? []);
      const bindings = Array.isArray(c.characters) ? c.characters : [];
      const bound = new Set(bindings.map((x) => x.characterRef));
      if (stable([...refs].sort()) !== stable([...bound].sort())) out.push(`${where} 角色绑定集合与 cut.characters 不一致`);
      if (c.emptyCharacterShot !== (refs.size === 0)) out.push(`${where} emptyCharacterShot 与角色数量矛盾`);
      for (const binding of bindings) {
        const identity = identities.get(binding.characterRef);
        if (!identity || identity.status !== 'approved') out.push(`${where} 的 ${binding.characterRef} 没有 approved 身份模块`);
        if (identity && binding.identityVersion !== identity.identityVersion) out.push(`${where} 的 ${binding.characterRef} 身份版本错绑`);
        const start = cut.startBoundary?.characters?.[binding.characterRef];
        const end = cut.endBoundary?.characters?.[binding.characterRef];
        if (binding.lookRef !== start?.lookRef) out.push(`${where} 的 ${binding.characterRef} lookRef 与开始边界不一致`);
        if (binding.startPosition !== start?.position || binding.endPosition !== end?.position) out.push(`${where} 的 ${binding.characterRef} 首尾位置不一致`);
        const cutActionRefs = new Set(cut.actionRefs ?? []);
        const expectedActions = [...cutActionRefs].filter((ref) => (actionById.get(ref)?.participants ?? []).includes(binding.characterRef)).sort();
        const boundActions = [...new Set(binding.actionRefs ?? [])].sort();
        if (stable(expectedActions) !== stable(boundActions)) out.push(`${where} 的 ${binding.characterRef} actionRefs 与参与动作不一致`);
        for (const ref of boundActions) {
          const previs = actionById.get(ref)?.previs;
          if (previs?.required === true) {
            const approvedEvidence = new Set([...(previs.evidence?.stillRefs ?? []), ...(previs.evidence?.clipRefs ?? [])]);
            const supplied = binding.poseEvidenceRefs ?? [];
            if (!Array.isArray(supplied) || supplied.length === 0) out.push(`${where} 的 ${binding.characterRef} 缺必需预演证据`);
            for (const evidenceRef of supplied) if (!approvedEvidence.has(evidenceRef)) out.push(`${where} 的 ${binding.characterRef} 引用未批准预演证据：${evidenceRef}`);
          }
        }
      }
      const correspondenceProps = [...new Set(c.propRefs ?? [])].sort();
      const cutProps = [...new Set(cut.props ?? [])].sort();
      if (stable(correspondenceProps) !== stable(cutProps)) out.push(`${where} propRefs 与 cut.props 不一致`);
      if (!String(c.sceneRef ?? '').trim()) out.push(`${where} 缺 sceneRef`);
      else if (c.sceneRef !== cut.startBoundary?.spatialAnchor) out.push(`${where} sceneRef 与开始边界空间锚点不一致`);
      if (!Array.isArray(c.mustShow)) out.push(`${where} mustShow 必须是数组`);
    }
  }
  return out;
}
```

Move the existing local `stable` helper to module scope so both continuity and correspondence checks call the same implementation.

- [ ] **Step 4: Add the opt-in quality gate and structural validation**

At the end of `gateReport`, before action gates:

```js
if (board?.correspondenceVersion != null) {
  const detail = correspondenceProblems(board, ctx);
  add('multimodal-correspondence', '逐切角色身份、动作姿势、场景道具与首尾边界严格对应', detail.length === 0, detail.join('；'));
}
```

In `validateStoryboard`, reject unsupported versions and let the quality gate report missing correspondence:

```js
if (board.correspondenceVersion != null && board.correspondenceVersion !== 1) {
  p('correspondenceVersion 目前只支持 1');
}
```

In `exportPack`, add a `correspondence` array to each segment manifest entry:

```js
correspondence: (seg.cuts ?? []).map((cut, i) => ({
  cut: i + 1,
  ...(cut.correspondence ? { correspondence: cut.correspondence } : {}),
})).filter((item) => item.correspondence),
```

- [ ] **Step 5: Document the correspondence contract**

Create `references/multimodal-correspondence.md` with the exact field contract, authority order, reference-slot order, conflict fail-closed rule, empty-shot handling, and prompt boundary. Update `schema.md`, `storyboard-pass.md`, and `SKILL.md` so this reference is read only when `correspondenceVersion: 1` is used.

- [ ] **Step 6: Run tests and commit Task 2**

Run the command from Step 2.

Expected: all assertions pass and legacy fixture gate count remains `19`.

Commit only Task 2 files:

```powershell
git add -- '.agents/skills/novel-storyboard/SKILL.md' '.agents/skills/novel-storyboard/references/multimodal-correspondence.md' '.agents/skills/novel-storyboard/references/schema.md' '.agents/skills/novel-storyboard/references/storyboard-pass.md' '.agents/skills/novel-storyboard/scripts/novel-storyboard.mjs' '.agents/skills/novel-storyboard/scripts/selftest.mjs'
git commit -m "feat: add storyboard correspondence contract"
```

---

### Task 3: Structured Generation QA and Repair Routing

**Files:**
- Create: `.agents/skills/novel-storyboard/references/generation-qa.md`
- Modify: `.agents/skills/novel-storyboard/SKILL.md`
- Modify: `.agents/skills/novel-storyboard/scripts/novel-storyboard.mjs`
- Test: `.agents/skills/novel-storyboard/scripts/selftest.mjs`

**Interfaces:**
- Consumes: `storyboard-qa.json` and the approved `storyboard.json`.
- Produces: `validateGenerationQa(report, board): string[]`.
- Produces: CLI command `qa-validate <storyboard-qa.json> --storyboard <storyboard.json>`.
- Does not mutate storyboard, media, prompts, or assets.

- [ ] **Step 1: Add failing QA validator tests**

Import `validateGenerationQa` and add:

```js
const QA_REPORT = {
  version: 1,
  source: FIXTURE.source,
  hasDiscrepancies: true,
  summary: 'C01 身份正确，但右手道具缺失',
  findings: [{
    id: 'Q-E01-01-C01-01', cutRef: 'E01-01#1', type: 'scene-or-prop-mismatch',
    severity: 'blocking', sourceRef: 'P01 / endBoundary.characters.C01.rightHand',
    expected: 'C01 右手持续握住 P01', actual: '右手为空', repairLayer: 'generation',
    repairScope: 'masked-region', correctionPrompt: '仅重绘 C01 右手与 P01 的接触区域。',
    preserve: ['C01 面部', '服装', '背景', '其他角色', '构图'],
  }],
};

eq(validateGenerationQa(QA_REPORT, correspondenceDoc).length, 0, '身份绑定分镜上的完整 QA 报告通过');
const unknownCutQa = clone(QA_REPORT);
unknownCutQa.findings[0].cutRef = 'E99-99#9';
ok(validateGenerationQa(unknownCutQa, correspondenceDoc).some((x) => x.includes('不存在')), '未知 cutRef 失败');
const falseButFindings = clone(QA_REPORT);
falseButFindings.hasDiscrepancies = false;
ok(validateGenerationQa(falseButFindings, correspondenceDoc).some((x) => x.includes('矛盾')), '无偏差标记与 findings 矛盾失败');
```

- [ ] **Step 2: Run storyboard tests and confirm red state**

Run the Task 2 self-test command.

Expected: FAIL because `validateGenerationQa` is not exported.

- [ ] **Step 3: Implement the QA validator**

Add exact enums and validator:

```js
const QA_TYPES = new Set([
  'wrong-character', 'missing-character', 'extra-character', 'duplicate-character',
  'identity-drift', 'pose-mismatch', 'layout-mismatch', 'scene-or-prop-mismatch',
  'script-contradiction', 'continuity-break',
]);
const QA_SEVERITIES = new Set(['blocking', 'major', 'minor']);
const QA_LAYERS = new Set(['characters', 'action-previs', 'art', 'storyboard', 'generation']);
const QA_SCOPES = new Set(['masked-region', 'local-cut', 'segment', 'upstream']);

export function validateGenerationQa(report, board) {
  const out = [];
  if (!report || typeof report !== 'object' || Array.isArray(report)) return ['storyboard-qa.json 不是对象'];
  if (report.version !== 1) out.push('QA version 目前只支持 1');
  if (report.source !== board?.source) out.push('QA source 与 storyboard.source 不一致');
  if (typeof report.hasDiscrepancies !== 'boolean') out.push('hasDiscrepancies 必须是布尔值');
  if (!String(report.summary ?? '').trim()) out.push('summary 不能为空');
  if (!Array.isArray(report.findings)) return [...out, 'findings 必须是数组'];
  if (report.hasDiscrepancies !== (report.findings.length > 0)) out.push('hasDiscrepancies 与 findings 是否为空矛盾');
  const cuts = new Set();
  for (const ep of board?.episodes ?? []) for (const seg of ep.segments ?? []) {
    (seg.cuts ?? []).forEach((_, index) => cuts.add(`${seg.id}#${index + 1}`));
  }
  const ids = new Set();
  for (const finding of report.findings) {
    const id = String(finding?.id ?? '');
    if (!id || ids.has(id)) out.push(`finding id 缺失或重复：${id || '(空)'}`);
    ids.add(id);
    if (!cuts.has(finding?.cutRef)) out.push(`${id} 的 cutRef 不存在：${finding?.cutRef}`);
    if (!QA_TYPES.has(finding?.type)) out.push(`${id} 的 type 无效`);
    if (!QA_SEVERITIES.has(finding?.severity)) out.push(`${id} 的 severity 无效`);
    if (!QA_LAYERS.has(finding?.repairLayer)) out.push(`${id} 的 repairLayer 无效`);
    if (!QA_SCOPES.has(finding?.repairScope)) out.push(`${id} 的 repairScope 无效`);
    if (finding?.repairLayer !== 'generation' && finding?.repairScope !== 'upstream') out.push(`${id} 的上游问题 repairScope 必须为 upstream`);
    if (finding?.repairScope === 'masked-region' && finding?.repairLayer !== 'generation') out.push(`${id} 只有 generation 层允许 masked-region`);
    for (const field of ['sourceRef', 'expected', 'actual', 'correctionPrompt']) {
      if (!String(finding?.[field] ?? '').trim()) out.push(`${id} 缺 ${field}`);
    }
    if (!Array.isArray(finding?.preserve)) out.push(`${id} 的 preserve 必须是数组`);
  }
  return out;
}
```

- [ ] **Step 4: Add the `qa-validate` CLI command**

Add to usage and `main`:

```js
if (cmd === 'qa-validate') {
  const [path] = rest;
  const boardPath = flag(rest, '--storyboard');
  if (!path || !boardPath) throw new Error('用法：qa-validate <storyboard-qa.json> --storyboard <storyboard.json>');
  const problems = validateGenerationQa(readJson(path), readJson(boardPath));
  if (problems.length) {
    console.error(`✗ ${problems.length} 处 QA 结构违规：\n\n${problems.map((x) => `  ${x}`).join('\n')}`);
    process.exit(1);
  }
  console.log('✓ storyboard-qa.json 结构与分镜引用全部通过');
  return;
}
```

- [ ] **Step 5: Document QA categories, repair scope, and stop condition**

Create `references/generation-qa.md` with the exact v1 schema, deviation types, severity definitions, authority-based `repairLayer`, smallest-safe `repairScope`, `preserve` requirements, user-approval boundary, and one-suggestion-pass stopping condition. Route it from `SKILL.md`; state that validation never applies a correction.

- [ ] **Step 6: Run tests and commit Task 3**

Run the storyboard self-test and a CLI smoke test using a temporary QA fixture.

Expected: self-test passes; valid fixture exits `0`; fixture with `E99-99#9` exits `1` and names the unknown cut.

Commit:

```powershell
git add -- '.agents/skills/novel-storyboard/SKILL.md' '.agents/skills/novel-storyboard/references/generation-qa.md' '.agents/skills/novel-storyboard/scripts/novel-storyboard.mjs' '.agents/skills/novel-storyboard/scripts/selftest.mjs'
git commit -m "feat: validate storyboard generation qa"
```

---

### Task 4: Cross-Skill Regression and Delivery Audit

**Files:**
- Inspect: `C:\Users\Administrator\.codex\skills\novel-characters\references\identity-module.md`
- Inspect: `.agents/skills/novel-storyboard/references/multimodal-correspondence.md`
- Inspect: `.agents/skills/novel-storyboard/references/generation-qa.md`
- Create: `.superpowers/sdd/character-storyboard-identity-compilation-final-report.md`

**Interfaces:**
- Consumes: completed Task 1–3 contracts and test outputs.
- Produces: evidence that legacy and opt-in paths both work and that field names agree across skills.

- [ ] **Step 1: Run both complete self-test suites fresh**

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'C:\Users\Administrator\.codex\skills\novel-characters\scripts\selftest.mjs'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.agents\skills\novel-storyboard\scripts\selftest.mjs'
```

Expected: both exit `0` and report zero failed assertions.

- [ ] **Step 2: Run explicit legacy compatibility smoke tests**

Validate the existing `渡口-cast.json` without `identityCompilationVersion`, and the existing storyboard sample without `correspondenceVersion`.

Expected: both pass with their pre-feature behavior; legacy storyboard gate count stays `19` before optional action gates.

- [ ] **Step 3: Confirm the opt-in contract chain through named assertions**

The Task 1 self-test must report these passing assertions from the exact `withIdentity` fixture: `完整身份模块通过`, `重复身份引用失败`, `陈旧身份不能正式导出`, and `身份边界矛盾失败`.

The storyboard self-test must use the exact shared `IDENTITY_CAST` → `correspondenceDoc` → `QA_REPORT` objects defined in Tasks 2–3 and report these passing assertions: `完整逐切对应通过`, `身份版本错绑失败`, `身份绑定分镜上的完整 QA 报告通过`, `未知 cutRef 失败`, and `无偏差标记与 findings 矛盾失败`.

Expected: the valid chain passes in producer-to-consumer order. The `wrongVersion` negative case exits through the `multimodal-correspondence` gate and its returned detail contains both `${seg.id}#${index + 1}` and the affected `characterRef`; add explicit substring assertions for both values if the existing negative assertion does not prove them.

- [ ] **Step 4: Audit field-name consistency and placeholders**

Run:

```powershell
rg -n "identityCompilationVersion|identityModule|characterRef|identityVersion|anchorRef|correspondenceVersion|correspondence|hasDiscrepancies|repairLayer|repairScope" 'C:\Users\Administrator\.codex\skills\novel-characters' '.agents\skills\novel-storyboard'
$taskForbidden = @(('T'+'BD'), ('TO'+'DO'), ('implement'+' later'), ('fill'+' in'), ('待'+'定'), ('以后'+'再做'))
Select-String -Path 'C:\Users\Administrator\.codex\skills\novel-characters\SKILL.md','C:\Users\Administrator\.codex\skills\novel-characters\references\identity-module.md','.agents\skills\novel-storyboard\SKILL.md','.agents\skills\novel-storyboard\references\multimodal-correspondence.md','.agents\skills\novel-storyboard\references\generation-qa.md' -Pattern $taskForbidden
```

Expected: every contract term appears in the intended producer and consumer; placeholder scan returns no matches.

- [ ] **Step 5: Write the final evidence report**

Record commands, exit codes, assertion totals, the legacy gate count, opt-in smoke-test results, user-level skill hashes, repository commits, and any limitations. Do not describe skipped checks as passing.

- [ ] **Step 6: Commit the final audit report**

```powershell
git add -- '.superpowers/sdd/character-storyboard-identity-compilation-final-report.md'
git commit -m "docs: verify identity compilation pipeline"
```

---

## Execution Order

Task 1 is the producer contract. Task 2 must consume its exact field names. Task 3 is independent of the character producer after Task 2 establishes stable `cutRef` values. Task 4 runs only after all feature commits and user-level skill validation finish.

## Expected Commit Sequence

1. `docs: record character identity module update`
2. `feat: add storyboard correspondence contract`
3. `feat: validate storyboard generation qa`
4. `docs: verify identity compilation pipeline`
