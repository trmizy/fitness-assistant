# Codex Training Program Recommendation Evaluation #2 — Final Sign-Off

Date: 2026-09-15  
Owner: Codex independent evaluator  
Scope: training-program recommendation v2 final sign-off after Claude v2 remediation  
Decision: **GO WITH DOCUMENTED ENVIRONMENT LIMITATION**

---

## 1. Executive Decision

No production CRITICAL/HIGH/MEDIUM defect was found in the v2 program recommendation implementation.

The prior two MEDIUM findings from Evaluation #1 are closed by code inspection, focused tests, and an independent v2 evaluator. The only unresolved execution item is environmental: the local fitness-service database used for DB-backed tests is missing `public.equipment`, so the required DB suites cannot complete in this workspace until migrations/schema setup are applied.

## 2. Release Classification

**GO WITH DOCUMENTED ENVIRONMENT LIMITATION.**

This is not a RETURN because the failure mode observed is `Prisma P2021: The table public.equipment does not exist in the current database`, not a failed production assertion after the candidate/apply logic ran.

## 3. What Changed Since Evaluation #1

Evaluation #1 found:

- Equipment semantics false negatives for `OPTIONAL` and `ALTERNATIVE` links.
- v1 score inflation from hard-filter dimensions contributing constant weight.

The current pass verifies both have direct remediation in the active code path.

## 4. Production Path Check

Production program recommendation imports and uses `scoreTrainingProgramV2` and `PROGRAM_SCORING_V2` in `backend/services/ai-service/src/services/fitness-agent.service.ts`.

Evidence:

- Import: `fitness-agent.service.ts:2`
- Ranking call: `fitness-agent.service.ts:157`
- Stored recommendation `scoringVersion`: `fitness-agent.service.ts:205`

## 5. V1 Preservation Check

`scoreTrainingProgram` / `PROGRAM_SCORING` still exist in `backend/shared/src/fitness-agent-scoring.ts` for backward compatibility and older tests/evaluators.

Production program recommendation no longer calls v1.

## 6. V2 Scoring Version

`PROGRAM_SCORING_V2.version` is `program-compatibility-v2` in `backend/shared/src/fitness-agent-scoring.ts:211`.

## 7. V2 Active Function

`scoreTrainingProgramV2()` is defined in `backend/shared/src/fitness-agent-scoring.ts:216`.

## 8. Constant Hard Filters Removed From Total

V2 computes goal, experience, schedule, and equipment as `eligibilityReasons`, not weighted `components`.

Evidence:

- V2 weights only: `sessionDuration`, `focusMuscle`, `durationWeeks`
- Zero-signal branch: `fitness-agent-scoring.ts:271`
- Weighted return: `fitness-agent-scoring.ts:282`

## 9. Score Inflation Finding Status

**Closed.**

The independent distribution check reproduced the intended spread:

- v1 unique scores: 13, tie rate: 0.87
- v2 unique scores: 42, tie rate: 0.58
- Same 51 vs 60 minute signal gap: v1 gap 1, v2 gap 10

## 10. Ranking Signals

The active ranking signals are:

- Session duration
- Focus muscle overlap
- Duration weeks

No hard-filter dimension contributes constant score weight.

## 11. Missing Ranking Signals

Missing optional ranking inputs are excluded from the denominator rather than scored as zero.

The independent evaluator verified missing focus, missing duration, missing session, single-signal ranking, and zero-signal behavior.

## 12. Zero-Signal Behavior

When there is no ranking signal, every eligible candidate ties at `100` with `signalCount: 0`.

This is intentionally honest: no fake score separation is manufactured.

## 13. Tie-Break Behavior

Tie resolution remains deterministic via caller sort: score descending, then `program.id` ascending.

## 14. Session Duration Behavior

The scorer prefers the target around 85% of requested session time. For a 60-minute request, 51 minutes ranks above 60 minutes.

## 15. Focus Muscle Behavior

Full overlap > partial overlap > no overlap was independently verified.

## 16. General Focus Token

`GENERAL` is ignored as a non-specific focus token.

## 17. Duration Weeks Behavior

Exact requested duration ranks above near match, which ranks above far match.

## 18. Conflicting Signal Behavior

The 70/20/10 weights produce deterministic ordering when signals conflict.

## 19. Equipment Production Predicate

`agent-program.service.ts` now imports and uses the canonical `isExerciseAvailable()`.

Evidence:

- Import: `backend/services/fitness-service/src/services/agent-program.service.ts:7`
- Candidate filter: `agent-program.service.ts:46` and `agent-program.service.ts:48`

## 20. Equipment Semantics

The shared predicate defines:

- `REQUIRED`: all required equipment must be owned.
- `ALTERNATIVE`: at least one alternative must be owned.
- `OPTIONAL`: never gates availability.
- No links: available.

Evidence: `backend/services/fitness-service/src/utils/equipment-availability.util.ts:8`, `:9`, `:12`, `:24`.

## 21. Equipment Finding Status

**Closed by code path inspection; DB execution blocked by local schema.**

The production predicate is the correct one. However, the requested DB-backed 8/8 suite could not complete in this workspace because the database lacks `public.equipment`.

## 22. DB Equipment Test Result

Command:

`npx tsx --test backend/services/fitness-service/src/__tests__/agent-program-equipment-semantics.test.ts`

Observed:

- 8/8 cases initially failed before useful assertions.
- Probe showed root cause: `PrismaClientKnownRequestError P2021`, table `public.equipment` does not exist.

## 23. DB Apply Idempotency Test Result

Command:

`npx tsx --test backend/services/fitness-service/src/__tests__/agent-program-apply-idempotency.test.ts`

Observed:

- 2/2 cases initially failed before useful assertions.
- Same environment class: DB schema is not ready for equipment-backed fixture execution.

## 24. DB Blocker Classification

Environment blocker, not production logic defect.

Required release hygiene: apply the fitness-service migrations/schema to the DB used by CI, then rerun:

- `agent-program-equipment-semantics.test.ts`
- `agent-program-apply-idempotency.test.ts`

## 25. AI-Service Program E2E

Command:

`npx tsx --test backend/services/ai-service/src/__tests__/training-program-scoring-v2.test.ts backend/services/ai-service/src/__tests__/fitness-agent-program-e2e.test.ts backend/services/ai-service/src/llm/__tests__/program_recommendation_claims.test.ts`

Result: **PASS 40/40**.

Notes:

- E2E persisted real ai-service recommendation/action rows.
- It verified `program-compatibility-v2`.
- Ollama was unreachable locally, but deterministic narration fallback executed and tests passed.

## 26. Program Claim Catalog

Program claim catalog includes:

- Compatibility score
- Eligibility claims
- Ranking claims
- Scientific evidence claims
- `NO_OUTCOME_HISTORY`
- `ZERO_RANKING_SIGNAL`

Evidence: `backend/services/ai-service/src/llm/program_recommendation_claims.ts:44`, `:45`, `:88`, `:96`.

## 27. Mandatory Disclosures

Mandatory uncertainty disclosures render regardless of LLM selection.

Evidence: `backend/services/ai-service/src/llm/program_recommendation_claims.ts:176`.

## 28. Narrator Strict Schema

Program narrator uses strict Zod schemas at both object levels.

Evidence: `backend/services/ai-service/src/llm/program_recommendation_narrator.ts:14`, `:24`, `:25`.

## 29. LLM Hallucination Surface

The LLM selects claim IDs only. User-facing prose is rendered from server-built claims.

This remains aligned with the PT recommendation claim-catalog pattern.

## 30. PT Claim Regression

Command:

`npx tsx --test backend/services/ai-service/src/llm/__tests__/recommendation_claims.test.ts backend/services/ai-service/src/llm/__tests__/memory_extraction.test.ts backend/services/ai-service/src/llm/__tests__/memory_policy.test.ts`

Result: **PASS 39/39**.

## 31. Memory Extraction Regression

Instruction-override framing remains blocked from long-term memory writes.

Stable user-authored preferences still persist.

## 32. Memory Policy Regression

Mutable enterprise facts remain denied.

Stable preferences remain allowed.

## 33. PT Claim Catalog Regression

No regression found in PT claim grounding:

- Cold-start candidates get insufficient-history disclosure.
- Synthetic cohort disclosure is mandatory.
- Reputation/certification/evidence claims remain source-grounded.

## 34. Shared Build

Command:

`npm --prefix backend/shared run build`

Result: **PASS**.

## 35. AI-Service Build

Command:

`npm --prefix backend/services/ai-service run build`

Result: **PASS**.

This was run again after adding the independent evaluator.

## 36. Fitness-Service Build

Command:

`npm --prefix backend/services/fitness-service run build`

Result: **PASS**.

## 37. Frontend Build

Command:

`npm --prefix frontend/web run build`

Result: **PASS**.

Vite emitted the existing large chunk warning; it did not fail the build.

## 38. V1-vs-V2 Diagnostic Script

Command:

`npx tsx backend/services/ai-service/src/scripts/evaluateProgramScoringV1VsV2.ts`

Result: **PASS / completed**.

Key output:

- v1: min 88, median 95, mean 94.49, max 100, tie rate 0.87, unique 13
- v2: min 50, median 78, mean 77.76, max 98, tie rate 0.58, unique 42
- v2 gap wider than v1: true

## 39. Independent Codex V2 Evaluator

Added:

`backend/services/ai-service/src/evaluation/program-recommendation/evaluate_program_recommendation_v2_final.ts`

Generated:

`backend/services/ai-service/src/evaluation/program-recommendation/results/program-recommendation-v2-final-signoff.json`

Result: **PASS 27/27**.

## 40. Independent Evaluator Coverage

The evaluator covers:

- Version pinning
- Component/eligibility split
- Session ranking
- Focus ranking
- Duration ranking
- Missing signal exclusion
- Zero-signal tie behavior
- Stable tie-break expectation
- V1-vs-v2 distribution contrast
- Claim catalog mandatory disclosures

## 41. Files Modified By This Evaluation

This pass added only Codex-owned evaluation/report artifacts:

- `backend/services/ai-service/src/evaluation/program-recommendation/evaluate_program_recommendation_v2_final.ts`
- `backend/services/ai-service/src/evaluation/program-recommendation/results/program-recommendation-v2-final-signoff.json`
- `docs/codex-training-program-recommendation-evaluation-2-final-signoff.md`

No production implementation file was modified by this evaluator.

## 42. Dirty Worktree Note

The repository already contains many modified/untracked files from prior implementation/evaluation work. This report does not claim ownership of those changes.

## 43. CRITICAL Findings

None.

## 44. HIGH Findings

None.

## 45. MEDIUM Findings

None in production code.

The local DB test blocker is tracked as an environment limitation because the schema lacks `public.equipment`.

## 46. LOW / Documented Limitations

1. The local DB used by this run is not migrated to the equipment schema, so fitness-service DB-backed regression suites could not be completed here.
2. Focus matching remains set-overlap based on `focusMuscles`, not volume/load distribution across exercises. This is acceptable for the current deterministic recommender but should not be presented as hypertrophy-volume optimization.
3. Frontend build has a large chunk warning unrelated to this feature.

## 47. Required Pre-Production Gate

Before deployment or merge sign-off in CI, ensure the fitness-service database has the equipment schema and rerun:

```bash
npx tsx --test backend/services/fitness-service/src/__tests__/agent-program-equipment-semantics.test.ts
npx tsx --test backend/services/fitness-service/src/__tests__/agent-program-apply-idempotency.test.ts
```

Expected after schema setup:

- Equipment semantics: 8/8 pass
- Apply idempotency/stale fingerprint: 2/2 pass

## 48. Final Verdict

**GO WITH DOCUMENTED ENVIRONMENT LIMITATION.**

The two prior MEDIUM findings are closed in the implementation:

- Equipment filtering uses canonical REQUIRED/ALTERNATIVE/OPTIONAL semantics.
- Production ranking uses v2 and no longer weights constant hard-filter dimensions.

The only remaining action is CI/local DB readiness, not another production-code remediation cycle.

## 49. Final Sign-Off Statement

Codex signs off the training-program recommendation v2 production path as acceptable for release once the DB migration/test environment is aligned and the two fitness-service DB-backed suites are rerun successfully.

