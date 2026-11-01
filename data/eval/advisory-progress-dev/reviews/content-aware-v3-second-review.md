# Content-aware V3 — second-review fixes R-1 through R-7

Date: 2026-11-01. Base reviewed HEAD: `6fe3eb60`.
Branch: `feat/advisory-content-v3`, worktree:
`C:/D_Backup/project_personal/fitness-assistant-worktrees/advisory-content-v3`.
Scope: **CODE AUDIT / TEST FIXTURE**, offline experiment only.
Status: **READY_FOR_RE_REVIEW** for the supplied reproductions. No new generation
was run or authorized by these test results; no independent scientific signoff.

The user supplied Claude Code's second review: previous findings were closed,
and R-1–R-6 fixes plus R-7 documentation were explicitly authorized. No previous
commits were rewritten. Implementation fix:
`ee6ea3b2445059e93417d0032603b0d7cf226f9e`.
This report is a documentation follow-up to that implementation commit.

## Finding disposition

| Finding | Status | Implementation and regression evidence |
| --- | --- | --- |
| R-1 | FIXED | A hedge only exempts a bounded complement about that decision. Objects such as causes/nutrition and independent conjunctions no longer confer an exemption. Raw lexical fallback prevents V2's older hedge suppression from hiding directives before V3 can inspect them. All three supplied directives BLOCKED; both uncertainty controls remain unblocked. Additional bare-plan and English controls preserve scope. |
| R-2 | FIXED | Neutral progress questions use a sole relevant e1RM outcome from server facts; attendance/frequency are context. Correct or absent metricAssertion and UNSPECIFIED basis cannot bypass contradiction checks. Unknown/other outcome kinds or multiple unscoped exercises remain soft; named exercise scope comes from the question and known facts. Tests cover neutral/specific questions, correct/absent assertions, competing body outcome and multiple exercises. |
| R-3 | FIXED | Kg delta magnitude and direction are compared with current-baseline, independently of input-wide number membership. 12 sessions, 10 percent and 28 days cannot be recycled as kg deltas. All three reproductions emit HARD OBSERVATION_DELTA_CONTRADICTION. Claim references and escaped supplied exercise names resolve scope; unresolved attribution emits OBSERVATION_DELTA_UNVERIFIED. A matching e1RM delta still does not establish actual lifted-load change. |
| R-4 | FIXED | The delta grammar accepts natural personal subjects such as “Sức mạnh ước tính của bạn tăng 6 kg”, as well as known exercise names. Correct increases/decreases are permitted; incorrect magnitude/direction block. Numeric exceptions remain occurrence-scoped and do not authorize unrelated numbers elsewhere. |
| R-5 | FIXED | Recognized measurement questions and explicit strength/muscle measurement contrasts are not themselves positive hypertrophy inferences. All three supplied negative controls avoid the inference flag. Questions with an embedded proof assertion, or a contrast followed by an independent positive inference, retain the risk flag. |
| R-6 | FIXED | Muscle lexicon includes khối lượng cơ, gained muscles and plurals. An unrelated nutrition hedge does not hide the supplied muscle-growth assertion. The two direct continuation/no-change directives hard-block; explicit reporting/rejection, decision uncertainty and descriptive principles remain controls. Semantic causality/inference stays soft. |
| R-7 | DOCUMENTED | Design and README explicitly preserve the conservative policy: normative population language can block despite scientifically plausible content. V3 prefers descriptive principles. A policy relaxation requires separate evaluation. A regression test preserves both supplied normative-wording cases as BLOCKED. |

All new tests are in
`backend/services/ai-service/src/__tests__/advisory-content-v3-second-review.test.ts`.
The old P1/P2/P3 test files and assertions remain intact in this round.

## Executed verification

Before implementation changes, the initial 19 new reproduction/control tests
reported **3 pass, 16 fail, 0 skip** on `6fe3eb60`. After implementation and
additional scope controls, the new file has **28 tests**. The final required
scope is all ten advisory test files, including the previous 97 tests.

| Evidence | Run | Pass | Fail | Skip | Exit |
| --- | --- | ---: | ---: | ---: | ---: |
| TEST FIXTURE | Ten files with preserved local V2 artifacts | 125 | 0 | 0 | 0 |
| TEST FIXTURE | Same files without artifacts in the V3 worktree | 122 | 0 | 3 | 0 |
| CODE AUDIT | ai-service tsc --noEmit | — | — | — | 0 |

This is scoped ai-service regression, not full repository regression, BACKEND
INTEGRATION, REAL HTTP/API or REAL BROWSER. The three skips belong to the local
artifact byte/hash check, tampering test and frozen retrospective test. They do
not certify unavailable artifacts; the artifact-enabled run executes all three.
All four local files were confirmed present before that run.

Reproduce from the V3 worktree's `backend/services/ai-service`:

```powershell
$testFiles = @(
  'src/__tests__/advisory-baseline.test.ts',
  'src/__tests__/advisory-progress.test.ts',
  'src/__tests__/advisory-progress-guarded.test.ts',
  'src/__tests__/advisory-content-review.test.ts',
  'src/__tests__/advisory-content-v3.test.ts',
  'src/__tests__/advisory-content-v3-repair.test.ts',
  'src/__tests__/advisory-source-ablation-v3.test.ts',
  'src/__tests__/advisory-frozen-v2-integrity.test.ts',
  'src/__tests__/advisory-content-v3-review-fixes.test.ts',
  'src/__tests__/advisory-content-v3-second-review.test.ts'
)
$env:ADVISORY_V2_ARTIFACT_DIR = 'C:/D_Backup/project_personal/fitness-assistant/artifacts/ai-advisory-progress/bedrock-guarded-v2'
pnpm exec tsx --test @testFiles
Remove-Item Env:ADVISORY_V2_ARTIFACT_DIR -ErrorAction SilentlyContinue
pnpm exec tsx --test @testFiles
pnpm exec tsc --noEmit
pnpm exec tsx src/evaluation/advisory-progress/prepare-content-v3.ts --artifact-dir=C:/D_Backup/project_personal/fitness-assistant/artifacts/ai-advisory-progress/bedrock-guarded-v2
```

Frozen integrity: **INTEGRITY_CONFIRMED**, 24 preserved final candidates,
unchanged raw manifest/request/results/summary bytes, source pack, frozen code
hashes, scenarios and historical contract scores. Results SHA-256 remains
`4f3f376ac81a93f645ba86a49a241f2d761e2bdf29388dcb44f79530e16c857a`.
No integrity pin was updated. Current retrospective signals are separate from
V2 scores: one BLOCKED (`no-external-evidence:D`), 14 FLAGGED and nine no-rule-match.
These signal counts are not semantic accuracy.

Preparation remains six excerpt ablations/five synthetic tasks in memory, with
grounding inference NOT_RUN. **Model/Bedrock calls = 0**. No production routes,
prompts, flags, DB, vector stores, source ingestion or dependency files changed.

## Changed files and boundaries

- `src/evaluation/advisory-progress/content-aware-v3-language.ts`: bounded
  epistemic scope, raw directive coverage, measurement contrasts and lexicon.
- `src/evaluation/advisory-progress/content-aware-v3-facts.ts`: neutral outcome
  resolution, scoped magnitude/direction validation and safe numeric exceptions.
- `src/evaluation/advisory-progress/content-aware-v3.ts`: per-claim references
  passed to numeric checking, including the read-only legacy adapter.
- `src/__tests__/advisory-content-v3-second-review.test.ts`: 28 regression tests.
- `src/evaluation/advisory-progress/CONTENT_AWARE_V3.md` and
  `data/eval/advisory-progress-dev/reviews/content-aware-v3-design.md`: behavior,
  commands, R-7 tradeoff and limitations.
- `data/eval/advisory-progress-dev/reviews/content-aware-v3-second-review.md`:
  this documentation follow-up.

Source paths starting `src/` above are relative to ai-service. V2 baseline
`ea98576d` and the protected V2 source files/data are unchanged.

## Known limits and independent review

- The hedge complement and delta grammars are bounded lexical rules, not a
  general parser. Unseen syntax, quotation conventions, implicit/nonnumeric
  causality, mixed scopes, unit conversion and rounding can still yield false
  positives/negatives. Supported scope controls do not prove global precision.
- Unrecognized numbers still use the V2 input-wide whitelist; membership does
  not establish attribution. Resolved kg deltas are tighter checks, not full
  verification of every numeral, unit or timeframe. Unknown kinds and ambiguous
  references stay review findings rather than guessed hard contradictions.
- A bare lifting statement and an e1RM estimate are different measurements.
  The bounded single-metric interpretation blocks conflicting deltas in the
  reported cases; even a matching delta receives a review flag for actual load.
  It does not manufacture an observed load-history fact.
- Measurement-question exemptions apply to recognized measurement questions
  without proof/causal language. Complex leading questions can still need human
  review. Measurement contrasts are not scientific signoff on the rest of a unit.
- R-7 is an intentional false-positive tradeoff for normative population language,
  not proof of a scientific error. No policy relaxation was made here.
- Known unsupported paraphrases/principles can still evade lexical patterns;
  NO_RULE_MATCH_NOT_CONTENT_PASS remains distinct from approval. Citation IDs,
  declared claim roles and excerpt links do not prove scientific entailment,
  individual causality or source applicability.
- These changes still need independent code/semantic review. Scientific source
  applicability and clinical correctness have not been independently validated.
  No inference ablation, model generalization or production E2E claim is made.

Review command:

```sh
git diff 6fe3eb60..ee6ea3b2445059e93417d0032603b0d7cf226f9e
```

No listed R-1/R-2 blocker remains; generation is still
NOT_RUN and these results do not authorize rollout.
