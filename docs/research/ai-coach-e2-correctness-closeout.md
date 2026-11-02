# E2 correctness patch and safe closeout

2026-11-02. Starting HEAD `01ba5097`, branch `feat/advisory-content-v3`. Evidence **CODE AUDIT / TEST FIXTURE**, no model/embedding/vector calls. The earlier E2 commit already exists, so this is a follow-up fix rather than a history rewrite. Scope is P2-1/P2-2, a retrieval diagnostic and private-data/clean-clone correctness; no new semantic model, scientific regex expansion or evaluation framework.

## Reproduction and patch

At the starting commit, all eight supplied probes reached `DEV_REVIEW_ONLY` with **zero support records and no unverifiedClaims** for their unlinked assertion. This included “Epley sai số 5–10% ở người Việt”, universal 20-set optimum, fabricated chest growth, attendance→true strength causality, program effectiveness, e1RM-as-direct-measurement, and assertions hidden in rationale/questions. The existing V3 gate only flagged these runs; it did not establish their support.

`verification.ts` now enumerates all claim text, conclusion, missing-information questions and hypothesis follow-up questions, even on schema-invalid output. Every text unit has a reason, evidence identity, support status and any structured-metric comparison. The same eight real-packet probes now all appear as **UNVERIFIED**: personal assertions with fact IDs are `UNKNOWN_PERSONAL_APPLICABILITY`; rationale/question assertions are `UNKNOWN_ENTAILMENT`. They still can be DEV review candidates; that is deliberate retention for annotation/usefulness, not scientific clearance.

The result separates `contractValidity`, `evidenceIdentity`, `support`, `unverifiedClaims`, `coverage`, `verificationDisposition`, unchanged V3 gate diagnostics and `release`. `answerSafetyVerified=false` and `scientificPass=null`. Coverage counts **reviewable text units**, not independently identified atomic scientific propositions: nonevidence text is not silently absent from the denominator. `independentlyVerifiedScientificClaims=null`; accounting every unit is not 100% evidence support.

A copied estimated-1RM projection with matching structured baseline/current/changePct, identity/unit and adequate quality receives `VERIFIED_METRIC_COPY_COMPARISON`, scoped only to those fields. It does not establish that prose claiming a program effective or muscle growth is factual, or that the estimate measures true strength. Mismatched checkable structured fields are `CONTRADICTED` and the unchanged V3 gate blocks them. Other unhandled measurement kinds/delta prose remain unverified; no second fitness calculation engine or clinical threshold was introduced.

Legacy schema/reference/hard gate failures still block. Contract-valid unresolved narrative and paraphrases remain available as candidates with `REQUIRES_SEMANTIC_REVIEW`, rather than all free text being blocked or unknown entailment being called false. Reviewer judgement is still required for the supplied unsupported/contradictory scientific statements; the deterministic verifier does not pretend to prove the inverse of C21 from arbitrary prose.

## Canonical versus display text

`presentation.ts` preserves approvedTextVi and returns a reversible display projection: exact removed prefix, offsets and canonical-text hash. For C32a/b/c, the internal label is absent from display text while prefix+display reconstructs the untouched accepted text. Metadata still carries claim ID/version/hash and citation links; the prompt does not ask for those IDs in user-facing wording and permits natural paraphrase.

Exact canonical/display copies retain an explicit identity signal and `OWNER_ACCEPTED_GENERAL_WORDING_ONLY`, not an independent scientific support label. Removing punctuation, adding an introduction or paraphrasing produces UNKNOWN_ENTAILMENT and a reviewable candidate, not automatic CONTRADICTED. No semantic verifier was added. Exact scientific text disguised as an observation remains forbidden, including its display representation.

## Retrieval diagnostic, not a retrieval optimization

The original Claude 30-question list was not present in the supplied task attachment or inspected local review files. `data/eval/ai-coach-e2-retrieval/dev-queries.json` is therefore an explicitly **implementer/AI-authored replacement**, with draft expected/relevant IDs, not a claim of verbatim reuse or independent gold. The diagnostic runs against the local admitted registry. Before uses source modules from a Git clone at the starting commit; after uses patched context/presentation. The retrieval algorithm is unchanged, capped at six claims, with existing excluded-source/organ-volume/safety controls retained.

| Metric, 30 draft questions | Before | After |
| --- | ---: | ---: |
| Expected-claim recall | 12/25 = 48% | 12/25 = 48% |
| Precision | 27/67 = 40.30% | 27/67 = 40.30% |
| Irrelevant-claim rate under draft labels | 40/67 = 59.70% | 40/67 = 59.70% |
| Empty contexts | 13/30 = 43.33% | 13/30 = 43.33% |
| Queries with matches | 17/30 | 17/30 |
| Supplied claim occurrences / maximum per context | 67 / 6 | 67 / 6 |
| Mean estimated user-context tokens | 5,497.93 | 5,763.93 |
| Maximum estimated user-context tokens | 13,953 | 14,724 |

Token estimates are **UTF8 bytes/4**, exclude system text and are not actual model token counts, a budget approval or proof of fitting E3's proposed 12k cap. The small representation metadata/display overhead changes context size; it does not improve recall or add scientific claims. Actual full-prompt counting/caps remain E3 prerequisites. No recall tuning was done against these newly authored labels.

| Topic | Recall | Precision | Empty | Max claims |
| --- | ---: | ---: | ---: | ---: |
| Epley, 4 questions | 2/4 | 50% | 2/4 | 6 |
| ACSM, 4 | 2/6 | 50% | 2/4 | 4 |
| Failure/RIR/tempo, 5 | 3/5 | 33.33% | 2/5 | 6 |
| Light loads, 4 | 1/5 | 33.33% | 1/4 | 6 |
| Protein, 3 | 1/1 | 50% | 1/3 | 1 |
| Recovery/deload, 4 | NA (no expected supported claim) | 0% | 3/4 | 6 |
| Broad questions, 6 | 3/4 | 50% | 2/6 | 6 |

These results expose named-formula/organization alias gaps, poor specificity on broad/causal requests and limited corpus coverage. A protein result is not an answer to an optimal daily intake question; an existing recovery query can still retrieve unrelated strength claims. FOUND remains relevance-only. These weaknesses are measured limitations for E3 preparation, not fixed by claiming the earlier five fixture targets represent real-user recall.

## External registry and data policy

The E1/E2 CLIs now require `--registry-config ABSOLUTE_LOCAL_CONFIG`. The strict external config supplies absolute input/map/current-owner file paths and caller-trusted bundle/current-owner pins. Missing/wrong files, stale owner bytes, bad hashes/content and a draft release fail closed. No personal Windows path, fixed private owner pin or silent synthetic fallback is used. Captured bundle bytes are validated independently of their old source-machine origin paths; this is frozen knowledge identity, not a live source/code deployment check.

E1/E2 tests now use `fixtures/scientific-claims.ts`, an independently constructed **synthetic test packet**, with example.invalid sources and explicit fake decisions/passages. It is not copied/redacted owner history or valid scientific knowledge. The starting clean clone reproduced ENOENT for the missing local input-bundle in both old E1/E2 suites. Clean-checkout verification of the patch is recorded in the final handoff/artifact logs after commit; no owner/private packet is copied into that clone. Installed dependencies may be shared through ignored node_modules junctions.

`release.ts` proposes a strict Curated Claim Map Release draft allowlist: permitted canonical/display wording, IDs/version, evidence excerpts/references/hashes, scientific scope/limitations and unsupported inferences. It excludes raw owner decisions/history/notes/AI proposals and replaces personal filesystem code URLs with repository references. A row whose allowed fields embed an exact internal owner note is held for content curation rather than silently exporting that note. This limited check is not comprehensive DLP; manual owner release/privacy review is still required.

The local draft has **33 rows**, with C31 omitted for content curation; C22 remains evidence-held. This does not change the original registry's 34 DEV admissions or any scientific/owner decision. Draft status is `DRAFT_PENDING_OWNER_RELEASE_APPROVAL`; the runtime registry loader rejects it. The actual draft and config remain in ignored local artifacts, not committed/published. No release approval is inferred.

## Verification and committed scope

In the authorized worktree: **37 files, 386 pass / 0 fail / 0 skip / 0 cancelled**; TypeScript exit 0. Includes all previous 372 tests plus 14 new correctness/privacy/config/presentation tests: Evaluation Integrity/D1/D2/D3, E1/E2, Bedrock FAKE transports, frozen V2 and four RAG fixture suites. This is the requested scoped regression, not full monorepo or real model verification. Existing state/fixtures/statistical algorithms/providers/routes were not widened.

New tests reproduce all eight probes, distinguish metric-field truth from prose, exercise reversible display/unknown paraphrase handling, keep unresolved text for review, validate external loading failures, reject draft admission and forbid extra private fields in the release schema. Frozen source/answer hashes and private owner-data checks remain separate from these synthetic test assertions.

Only implementation, synthetic fixtures/draft retrieval labels and nonprivate technical docs are eligible for the selective follow-up commit. The original private input-bundle/claim-map/source snapshots/bindings/owner exports/audit/calibration and actual release draft are not staged. Historical E1/E2/E3 reports remain unchanged; this report supersedes their earlier claims about exact-copy behavior and clean-clone test dependency.

Reproduce from `backend/services/ai-service`:

```powershell
pnpm exec tsx --test src/__tests__/scientific-claim-map-v3.test.ts src/__tests__/ai-coach-claim-dev.test.ts src/__tests__/ai-coach-claim-correctness.test.ts
pnpm exec tsc --noEmit
# Config/pins below are local owner-controlled inputs, not provided by this repository.
pnpm exec tsx src/evaluation/ai-coach-claim-dev/retrieval-benchmark.ts --registry-config <absolute-local-config> --questions ../../../data/eval/ai-coach-e2-retrieval/dev-queries.json --baseline-root <clean-clone-at-01ba5097>
```

Ignored evidence directory: `artifacts/ai-coach-e2-correctness/` (before/after probes, source-based retrieval comparison, private draft/config, clean-checkout logs, full scoped regression).

## Closed scope / next step

P2-1 is addressed by complete explicit unverified accounting and limited structured-metric verification; P2-2 by reversible presentation and retaining natural language for semantic review. Neither is solved by a new scientific regex set or semantic oracle. Retrieval P2-3 now has an honest diagnostic rather than an overgeneralized 5/5 result; its limitations remain.

**E2_READY_FOR_E3_PREPARATION**, subject to the recorded clean-checkout evidence. This is not SCIENTIFICALLY_VALIDATED or authorization for LIVE. Proceed to the previously scoped E3 experiment preparation: real independently reviewed cases/labels, model/counting compatibility, budget/trust and the narrow existing-runner adapter remain prerequisites. Do not open another general hardening loop or expand retrieval using the held-out set.
