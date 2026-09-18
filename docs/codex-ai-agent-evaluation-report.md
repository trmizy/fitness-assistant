# Codex Independent AI Agent Evaluation Report

Date: 2026-09-14

> Superseded for current closure status by
> `docs/codex-ai-agent-regression-2-report.md`. This original report remains
> the Regression #1 baseline and provenance record.

Scope: independent evaluation/evidence layer only. Codex did not modify Claude-owned production implementation files.

## 1. Scope Completed

- Created a new independent evaluation workspace under `backend/services/ai-service/src/evaluation/agentic/`.
- Added deterministic synthetic fixtures for PT recommendation, narrator grounding, RAG/citation, tool selection, prompt injection, memory, HITL, idempotency, stale-state, and vision safety.
- Added a machine-runnable offline evaluator that imports current production/public code where safe.
- Re-ran the existing retrieval eval to verify the old `hitAtK=0.98` claim.
- Created independent docs: evaluation matrix, adversarial findings, research source review, and this report.

## 2. Files Inspected

Architecture docs:

- `docs/ai-agent-system-feasibility-audit.md`
- `docs/ai-agent-system-target-architecture.md`
- `docs/ai-agent-system-migration-plan.md`
- `docs/ai-agent-system-meeting-summary.md`

Code evidence:

- `backend/shared/src/fitness-agent.ts`
- `backend/shared/src/fitness-agent-scoring.ts`
- `backend/shared/src/fitness-agent-context.ts`
- `backend/services/ai-service/src/llm/recommendation_narrator.ts`
- `backend/services/ai-service/src/llm/tools.ts`
- `backend/services/ai-service/src/scripts/evaluateRetrieval.ts`
- `backend/services/ai-service/src/services/fitness-agent-intent.ts`
- `backend/services/ai-service/src/services/fitness-agent.service.ts`
- `backend/services/ai-service/src/services/fitness-goal-vision.service.ts`
- `backend/services/user-service/src/services/agentic-fitness.service.ts`
- `backend/services/user-service/src/services/contract.service.ts`

## 3. New Evaluation Datasets

- PT recommendation cases: 100 deterministic synthetic scenarios.
- Narrator adversarial cases: 50 synthetic narrator outputs.
- RAG retrieval cases: 19 topic cases.
- RAG citation adversarial cases: 9 cases.
- Tool-selection cases: 8 cases.
- Prompt-injection cases: 3 cases.
- Memory classification cases: 9 cases.
- HITL confirmation utterances: 12 cases.
- Vision safety cases: 11 cases.
- Idempotency/stale-state placeholders: 4 blocked integration cases.

## 4. Scenario Counts By Category

Offline runner: 233 total, 169 PASS, 21 FAIL, 33 SKIPPED, 10 BLOCKED.

Important: this is not a single "AI accuracy" score. Each category has separate metrics and evidence type.

## 5. PT Recommendation Findings

100/100 PT hard-constraint and deterministic-ranking fixture cases passed in the offline evaluator. The cases cover specialty mismatch, budget, availability, accepting-client status, archived/inactive packages, service mode, location, cold start, historical cohort variants, synthetic origin, and insufficient slots.

These are synthetic fixture checks, not DB integration tests.

## 6. Historical Similarity Findings

6/6 historical similarity/cohort/origin checks passed:

- Different goals do not match.
- Similar starting states score higher than distant states.
- Below-threshold cohorts disclose insufficient evidence.
- Synthetic cohort summaries are labeled synthetic.

## 7. Cold-Start Findings

Current `scorePT()` treats insufficient cohort as absence of evidence rather than negative evidence. Offline fixtures pass, and the existing unit test `fitness-agent-scoring.test.ts` also guards this behavior.

## 8. Narrator Adversarial Coverage

30/50 narrator cases passed; 20/50 failed. Current validator rejects mismatched percentages and unsupported citation IDs, but misses many fabricated non-numeric claims such as certification, availability, package, location, rating, superiority, wrong goal/preference, and unauthorized action language.

Finding: `ADV-001` in `docs/ai-agent-adversarial-findings.md`.

## 9. RAG Evaluation Status

Existing retrieval eval was rerun successfully:

- Dataset: `data/eval/retrieval/ground-truth-retrieval.csv`
- Collection: `exercises`
- Cases: 100
- K: 5
- Hit@5 / Recall@5: 0.98
- MRR: 0.8187
- Failed queries: 2

This verifies exercise retrieval only. Citation support over `fitness_evidence` remains skipped pending a dedicated citation validator/eval.

## 10. Old hitAtK=0.98 Verification

Status: VERIFIED for `exercises` retrieval with the current local setup.

Command:

```bash
pnpm --filter @gym-coach/ai-service run ai:eval:retrieval
```

Provenance now known: 100-case CSV, K=5, `exercises` collection, current local embedding/Qdrant setup as configured by the repo environment.

## 11. Tool-Selection Findings

Tool schema check passes for the three LLM-selectable tools:

- `search_exercise_library`
- `get_user_fitness_data`
- `remember_user_fact`

Live tool-choice accuracy and malicious prompt-injection behavior are blocked until a live model/tool-calling harness is run with `ENABLE_TOOL_CALLING=true`.

## 12. Prompt-Injection Findings

Prompt-injection dataset is prepared, but live verification is blocked. The highest-risk unverified path remains:

RAG content -> LLM tool-calling -> `remember_user_fact`.

Finding: `ADV-003`.

## 13. Memory Findings

Memory policy fixtures distinguish stable preferences from mutable enterprise facts. Policy fixtures pass, but current implementation has no deterministic guard inside `remember_user_fact`.

Finding: `ADV-002`.

## 14. HITL Findings

12/12 text-only utterance checks passed for "no CRITICAL execution by chat utterance alone." Some vague phrases parse as `REVIEW` or `PT`, but not as direct contract confirmation. Full action-id-bound duplicate/stale execution still needs DB integration tests.

## 15. Idempotency Findings

Blocked pending integration harness:

- duplicate contract confirmation
- duplicate apply-plan confirmation

Code inspection found the expected mechanisms (`agentActionId`, deterministic draft id, advisory locks), but this evaluator did not run DB-backed duplicate-write tests.

## 16. Vision Safety Findings

11/11 schema/prompt safety checks pass at the offline level. `GoalVisualAttributesSchema` has only qualitative attributes and no exact body-fat, weight, identity, age, sex/gender, disease, hormone, or PED fields.

Live image-model behavior was not run.

## 17. External Research Verification

Created `docs/ai-agent-research-source-review.md`. Strong sources now include Anthropic engineering guidance, OpenAI official human-review/guardrail docs, NIST AI RMF GenAI Profile, and empirical RAG chunking papers.

## 18. Weak Research Sources Replaced

Weak sources such as generic blogs, community articles, and repost-style academic pages should not be primary evidence. Replacement sources are documented in the source review.

## 19. Security Findings

CRITICAL: none found in offline evaluation.

HIGH:

- `ADV-001`: Recommendation Narrator validator misses fabricated non-numeric claims.

MEDIUM:

- `ADV-002`: `remember_user_fact` lacks deterministic mutable-enterprise-fact guard.
- `ADV-003`: live prompt-injection path remains unverified.

LOW:

- none new.

INFO:

- `ADV-004`: old `hitAtK=0.98` claim is now reproducible for the exercise collection.

## 20. Findings Claude Should Fix

- Strengthen `validateNarration()` field-level grounding checks.
- Add deterministic memory write policy before `remember_user_fact` persists content.
- Build live tool-calling prompt-injection harness before enabling tool calling by default.
- Add DB-backed idempotency and stale-state tests for contract and apply-plan confirmation.
- Add citation-support evaluation for `fitness_evidence`.

## 21. Tests Blocked Waiting For Claude Or Infrastructure

- Tool-selection live model accuracy.
- Prompt injection live model/tool-calling.
- Duplicate contract confirmation.
- Duplicate apply-plan confirmation.
- Stale PT/package/availability confirmation.
- Stale plan fingerprint confirmation.
- RAG citation validator over real retrieved evidence.

## 22. Tests Passed

- 100 PT recommendation fixture cases.
- 6 historical/cohort/origin checks.
- 30 narrator grounding cases.
- 9 memory policy cases.
- 12 HITL text-only checks.
- 11 vision schema/prompt safety cases.
- 100-case retrieval eval with Hit@5 0.98.

## 23. Tests Failed

- 20 narrator adversarial cases.
- 1 memory implementation gap case.

## 24. Tests Skipped

- 19 RAG retrieval fixture cases in the new offline runner; separate existing retrieval eval was run successfully.
- 9 RAG citation fixture cases.
- 5 non-adversarial live tool-choice cases.

## 25. Files Created

- `backend/services/ai-service/src/evaluation/agentic/README.md`
- `backend/services/ai-service/src/evaluation/agentic/fixtures.ts`
- `backend/services/ai-service/src/evaluation/agentic/run_agentic_evaluation.ts`
- `backend/services/ai-service/src/evaluation/agentic/results/agentic-evaluation-results.json`
- `docs/ai-agent-evaluation-matrix.md`
- `docs/ai-agent-adversarial-findings.md`
- `docs/ai-agent-research-source-review.md`
- `docs/codex-ai-agent-evaluation-report.md`

## 26. Existing Files Modified

None. This was intentional because Claude is concurrently modifying production implementation files.

## 27. Git Status

Working tree was already dirty at task start with many Claude-owned production files modified. Codex added only the independent evaluation workspace and report docs listed above.

## 28. Final Status

PARTIAL.

Reason: independent offline evaluation layer is complete and runnable, and the old retrieval metric was verified. Live model, DB-backed duplicate-write/stale-state, and RAG citation evaluations remain blocked pending infrastructure/harness work.
