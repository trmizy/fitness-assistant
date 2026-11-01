# Content-aware V3 — fixes after REQUEST_CHANGES

Date: 2026-11-01. Implementation owner: Codex. Base reviewed commit:
`8718e986`. Scope: **CODE AUDIT / TEST FIXTURE** only. All listed P1–P3
reproductions are fixed and covered by regression tests. Status:
**READY_FOR_INDEPENDENT_CODE_REVIEW**, not scientific signoff or authorization
to run a new generation. Model/Bedrock calls: **0**.

The review findings were supplied by the user as a Claude Code review handoff.
This report records our implementation and executed checks; it does not imply
independent scientific/expert validation of those findings or the resulting code.

## Git and scope

- Base: `8718e986` (V3 HEAD reviewed).
- V2 baseline remains `ea98576d48ed97a1964bfae1f48b1a9af9197288`.
- Branch/worktree: `feat/advisory-content-v3`,
  `C:/D_Backup/project_personal/fitness-assistant-worktrees/advisory-content-v3`.
- Final implementation fix: `0fadc79c641b1d94a5a0ba00b6ddf522d9b75c34`.
  This report is a separate documentation follow-up; the immutable fix diff
  below includes all code, tests, design and README corrections.
- No amend, squash, force push or merge of reviewed history. No production,
  flags, DB, Qdrant, dependency manifest or frozen source/code/artifact edits.

Changed files, relative to repository root:

```text
backend/services/ai-service/src/evaluation/advisory-progress/
  content-aware-v3.ts
  content-aware-v3-language.ts                         (new)
  content-aware-v3-facts.ts                            (new)
  content-aware-v3-repair.ts
  source-ablation-v3.ts
  CONTENT_AWARE_V3.md
backend/services/ai-service/src/__tests__/
  advisory-content-v3.test.ts
  advisory-frozen-v2-integrity.test.ts
  advisory-source-ablation-v3.test.ts
  advisory-content-v3-review-fixes.test.ts              (new)
data/eval/advisory-progress-dev/reviews/
  content-aware-v3-design.md
  content-aware-v3-handoff.md                          (historical note only)
  content-aware-v3-review-fixes.md                      (new)
```

## Finding disposition

All regression names below are in `advisory-content-v3-review-fixes.test.ts`
unless another file is named. FIXED means the specified code defect and bounded
reproductions are addressed, not that natural-language reasoning is fully verified.

| Finding | Status | Change and corresponding regression |
| --- | --- | --- |
| P1-1 | FIXED | No blanket exception for “nói chung”, “nguyên tắc chung” or quotes. Only explicitly reported quotations in their own sentence can soften a matched directive. `review P1-1` checks all three reported bypasses; P1-1/2 controls check old-answer reporting and a separate new directive. Incorrect old general-wording test was removed from the exemption set. |
| P1-2 | FIXED | Uncertainty is inspected before each directive, after local boundaries; later hedges cannot suppress it. `review P1-2` checks both reported examples; controls check both legitimate uncertainty statements. Normalization explicitly avoids confusing “đủ” with the conjunction “dù”. |
| P1-3 | FIXED | Adapter reuses frozen V2 checkAnswer for all prose, including confirmation questions. Separate NUMBER_NOT_IN_INPUT, UNMAPPED_URL and FACTS_NOT_ADDRESSED findings. Exact source URLs and source/fact numbers stay allowed. Explicit arithmetic and single-metric kg deltas are bounded exceptions; unresolved equations flag, false equations block. Exceptions are occurrence-scoped, so equations cannot launder an unsupported number elsewhere. `review P1-3` plus numeric/URL/arithmetic controls cover the reported cases. |
| P1-4 | FIXED | Assessment checks derive endpoint direction from server-owned facts and the original question. UNSPECIFIED metadata cannot disable them; missing basis is a schema failure. A missing metric assertion flags and restricted from/to/direction parsing can still detect direct contradictions. Multiple unscoped exercises are flagged; named exercises use question scope. `review P1-4` and two scope/control tests cover omission, reversed endpoints and ambiguity. |
| P2-1 | FIXED | Expanded muscle lexicon and inference-local limitation handling. Unrelated negative/uncertain clauses cannot disable a prior inference. `review P2-1` covers all four supplied paraphrases, an unrelated nutrition hedge, and four valid limitation controls. Semantic inference remains SOFT. |
| P2-2 | FIXED | Personal-causal signals include program effectiveness and progressive overload; MEASUREMENT_LIMITATION is included in declared-type mismatch checks. `review P2-2` checks both supplied mislabels without rewriting their types. |
| P2-3 | FIXED | BODY domain no longer clears a muscle-size warning. Inspect referenced weight kind and assessment scope; current projection kinds do not establish a validated muscle-size measurement. Future measurement kinds need an explicit adapter before clearing review. `review P2-3` tests measured weight and irrelevant/unreferenced BODY facts. |
| P3-1 | FIXED | LOAD_WORDS uses normalized word boundaries. `review P3-1` checks “tập” and “adaptation” do not trigger load-history findings. |
| P3-2 | FIXED | Missing-information key mismatch checks both history→outcome and outcome→history, with correct-key controls in `review P3-2`. Still a narrow semantic heuristic. |
| P3-3 | FIXED | Implicit personal recommendation requires a personal-language cue and respects its limitation framing. `review P3-3` uses the actual attendance-only:D general principle and a lack-of-data statement. No implicit-advice flag is issued for either. |
| P3-4 | FIXED | Strict model payload projection removes titles, DOI, URL, locator and meaningful original IDs. Only opaque IDs, source class, excerpt text and remaining supported findings enter input; provenance is evaluation-only. `review P3-4` injects a finding-leaking marker into metadata and checks it is outside payload. Existing ablation tests preserve dependency/removal checks. |
| P3-5 | FIXED | Artifact-dependent tests probe actual availability, not env-var presence. Missing files skip with ARTIFACT_UNAVAILABLE; existing corrupted artifacts run and fail integrity. New missing-directory test and both full scope runs below distinguish unavailable from confirmed. |
| P3-6 | FIXED | All repair return paths retain initialCandidate snapshot, initialReport, finalReport, response and envelope diagnostics. Callback exceptions retain a redacted failure kind. Two `review P3-6` tests check success, malformed response, callback failure and caller mutation. |

## Executed verification

Before changing implementation, four new P1 regression groups were executed
against `8718e986`: **0 pass, 4 fail, 0 skip**. They reproduced the defects.
After fixes, the required eight existing files plus the new regression file
were run, with the following final results:

| Evidence | Configuration | Pass | Fail | Skip | Exit |
| --- | --- | ---: | ---: | ---: | ---: |
| TEST FIXTURE | 9 files, valid frozen artifact directory | 97 | 0 | 0 | 0 |
| TEST FIXTURE | Same 9 files, artifacts absent in V3 worktree | 94 | 0 | 3 | 0 |
| CODE AUDIT | ai-service TypeScript, tsc --noEmit | — | — | — | 0 |

The 97 tests include the unchanged 28-test V2 baseline and 21 new review-fix
tests. The three skipped tests are the local artifact byte/hash check, fixture
tampering check and frozen retrospective content check in
`advisory-frozen-v2-integrity.test.ts`. Skipping them confirms no artifact
integrity; the valid-directory run executes all three and confirms the pinned
local bytes. This is scoped regression, not full repository regression,
BACKEND INTEGRATION, REAL HTTP/API or REAL BROWSER.

Reproduction commands from the V3 worktree's `backend/services/ai-service`:

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
  'src/__tests__/advisory-content-v3-review-fixes.test.ts'
)
$env:ADVISORY_V2_ARTIFACT_DIR = 'C:/D_Backup/project_personal/fitness-assistant/artifacts/ai-advisory-progress/bedrock-guarded-v2'
# All four files were confirmed to exist before the artifact-enabled run.
pnpm exec tsx --test @testFiles
Remove-Item Env:ADVISORY_V2_ARTIFACT_DIR -ErrorAction SilentlyContinue
pnpm exec tsx --test @testFiles
pnpm exec tsc --noEmit
pnpm exec tsx src/evaluation/advisory-progress/prepare-content-v3.ts --artifact-dir=C:/D_Backup/project_personal/fitness-assistant/artifacts/ai-advisory-progress/bedrock-guarded-v2
pnpm exec tsx src/evaluation/advisory-progress/prepare-content-v3.ts
```

CLI with artifacts reports INTEGRITY_CONFIRMED and reads 24 candidates; CLI
without them reports ARTIFACT_UNAVAILABLE and 0 rows. Both prepare six excerpt
ablations and five synthetic tasks with modelCalls=0 and grounding inference
NOT_RUN. Frozen results retain SHA-256
`4f3f376ac81a93f645ba86a49a241f2d761e2bdf29388dcb44f79530e16c857a`.
The source pack, request/scenario hashes, frozen code, candidates and historical
contractPass/scores match the existing integrity pin. No pin was changed to make
these checks pass. Retrospective V3 findings do not replace historical V2 scores.

## Remaining limits and independent review

- These screens cover the reported phrases and bounded grammars, not every
  paraphrase, language, punctuation convention or negation scope. False positives
  remain possible for complex quoted/conditional numeric assertions, reported
  advice outside supported quotation syntax, and mixed-scope sentences.
- Known false negatives remain demonstrated by the existing undetected-plan-
  continuation paraphrase and unsupported principle with a valid source ID.
  Neither receives content approval; no-match is explicitly not content pass.
- Number membership inherits V2's input-wide whitelist, including source
  metadata. A valid number need not be attributed correctly. The linked metric
  grammar tightens common e1RM contradictions, but does not verify every number,
  unit, timeframe, implicit calculation or exercise reference in free text.
- Binary arithmetic over supplied operands verifies arithmetic, not whether
  adding those operands is scientifically meaningful. Unresolved equations,
  mixed exercises/outcomes, missing structured assertions and unsupported
  measurement kinds remain review findings rather than fabricated certainty.
- Current BODY projections contain weight/fat information, not a validated
  muscle-size outcome. New kinds require explicit server capability mapping;
  model declarations cannot supply that authority.
- Citation IDs, role declarations and correct excerpt dependencies still do
  not prove sentence entailment, individual causal attribution, applicability
  or clinical correctness. This fix has not received independent semantic or
  scientific review. Source ablation has not been run through any model.
- Initial/repair snapshots are for this JSON-based synthetic experiment.
  Arbitrary provider exception bodies are deliberately excluded from diagnostics.

For re-review, use the immutable implementation fix hash:

```sh
git diff 8718e986..0fadc79c641b1d94a5a0ba00b6ddf522d9b75c34
```

In this worktree the equivalent current-branch command is
`git diff 8718e986..feat/advisory-content-v3`. There are no unresolved listed P1
findings; independent code/semantic review remains the next review step.
