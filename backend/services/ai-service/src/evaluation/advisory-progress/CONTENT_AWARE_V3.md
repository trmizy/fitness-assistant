# Content-aware V3 — offline experiment

V3 is opt-in through separate modules. The V2 runner, prompts, AnswerSchema,
contextualAnswerSchema and historical scores are unchanged. No production
module imports this experiment; no new dependencies or business schemas.

- `content-aware-v3-schema.ts`: five explicit semantic roles, strict output.
- `content-aware-v3.ts`: structured invariants and bounded text signals.
- `content-aware-v3-repair.ts`: at most one injected callback, hard errors only.
- `source-ablation-v3.ts`: pure protocol parsing and input transformations.
- `frozen-v2-integrity.ts`: read-only artifact/source/code/history integrity.
- `prepare-content-v3.ts`: offline preparation and retrospective screen CLI.

From ai-service, prepare without inference:

```powershell
pnpm exec tsx src/evaluation/advisory-progress/prepare-content-v3.ts
# Optional preserved V2 artifacts in another worktree; read only:
pnpm exec tsx src/evaluation/advisory-progress/prepare-content-v3.ts --artifact-dir=C:/D_Backup/project_personal/fitness-assistant/artifacts/ai-advisory-progress/bedrock-guarded-v2
```

There is no live option or provider import. Six excerpt-ablation inputs and
five synthetic document-dependency inputs are prepared in memory. No inference
or grounding validation under ablation is claimed. Missing runtime artifacts
return `ARTIFACT_UNAVAILABLE`; that is not an integrity success. Mismatch exits
nonzero. Artifact bytes remain outside Git; only pinned hashes/history metadata
are tracked. Default runs on a fresh checkout therefore cannot confirm the
local frozen run unless its artifact directory is supplied.

Run the required fixture scope (four baseline files + four V3 files):

```powershell
$env:ADVISORY_V2_ARTIFACT_DIR = 'C:/D_Backup/project_personal/fitness-assistant/artifacts/ai-advisory-progress/bedrock-guarded-v2'
pnpm exec tsx --test src/__tests__/advisory-baseline.test.ts src/__tests__/advisory-progress.test.ts src/__tests__/advisory-progress-guarded.test.ts src/__tests__/advisory-content-review.test.ts src/__tests__/advisory-content-v3.test.ts src/__tests__/advisory-content-v3-repair.test.ts src/__tests__/advisory-source-ablation-v3.test.ts src/__tests__/advisory-frozen-v2-integrity.test.ts
pnpm exec tsc --noEmit
```

Three tests that require actual frozen artifacts explicitly skip with an
ARTIFACT_UNAVAILABLE message when the environment variable is absent. When a
directory is supplied but missing/corrupted, those tests fail. The separate
missing-artifact test checks honest unavailable reporting, never fake success.
A fresh worktree needs workspace dependencies and the shared package build:
`pnpm install --offline --frozen-lockfile --ignore-scripts`, then
`pnpm --filter @gym-coach/shared build`. No lockfile edits are required.

ContentGate precedence: BLOCKED > FLAGGED_FOR_REVIEW >
NO_RULE_MATCH_NOT_CONTENT_PASS. This is separate from V2 contractPass; there
is no boolean contentPass. A declared recommendation is always blocked even
with harmless prose. A misdeclared recommendation may be detected by the
narrow screen. Every personal hypothesis is flagged for entailment review,
even if its structured confirmation fields are valid. Model KEEP cannot
override hard server findings; revisions go through the full gate again.

Metric assertions only copy values from referenced service facts. Exact
structured contradictions are blocked; free-text numerals and semantic
causality are not fully verified. Quotations, genuine questions and explicit
population-level wording matching advice patterns are softened to review
signals where recognized. Other false positives/negatives remain possible.
Tests deliberately include an undetected paraphrase and an unsupported claim
with a valid citation to demonstrate why no-match is not content approval.

See the [semantic design](../../../../../../data/eval/advisory-progress-dev/reviews/content-aware-v3-design.md)
for rule boundaries and the [frozen review](../../../../../../data/eval/advisory-progress-dev/reviews/guarded-v2-content-review.md)
for earlier assistant annotations. Neither is independent scientific validation.
