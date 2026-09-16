# Training Program Recommendation Implementation

Date: 2026-09-15 (v1) · **v2 update 2026-09-15** in response to `docs/codex-training-program-recommendation-evaluation-1.md`.

## v2 Files Changed

**Production code**:
- `backend/services/fitness-service/src/services/agent-program.service.ts`: equipment eligibility now reuses the canonical `isExerciseAvailable()` (`equipment-availability.util.ts`) instead of its own inline REQUIRED-only predicate — fixes the OPTIONAL/ALTERNATIVE over-filtering bug (MEDIUM #1).
- `backend/shared/src/fitness-agent-scoring.ts`: added `PROGRAM_SCORING_V2`/`scoreTrainingProgramV2()`. `PROGRAM_SCORING`/`scoreTrainingProgram()` (v1) kept byte-for-byte unchanged for Codex's evaluator.
- `backend/shared/src/fitness-agent.ts`: `CompatibilityScore` gained two new **optional** fields, `eligibilityReasons?: string[]` and `signalCount?: number` — additive only, `scorePT` (PT-Agent, frozen) is unaffected.
- `backend/services/ai-service/src/services/fitness-agent.service.ts`: PROGRAM branch now calls `scoreTrainingProgramV2`; stored `FitnessRecommendation.scoringVersion` now reflects `program-compatibility-v2`.
- `backend/services/ai-service/src/llm/program_recommendation_claims.ts`: rewritten — eligibility claims (`*_ELIGIBLE`) split from ranking claims; new `ZERO_RANKING_SIGNAL` mandatory disclosure; backward-compatible fallback path for a v1 `CompatibilityScore` input.
- `backend/services/ai-service/src/llm/program_recommendation_narrator.ts`: `.strict()` added to the claim-selection schema (parity with the PT Narrator's defense-in-depth).
- `frontend/web/src/app/components/agent/FitnessAgentBlocks.tsx`: renders `narration.uncertainty` (the `NO_OUTCOME_HISTORY`/`ZERO_RANKING_SIGNAL` disclosures) in a small "Lưu ý" section — previously computed but never shown (Codex LOW finding).

**Tests (new)**:
- `backend/services/fitness-service/src/__tests__/agent-program-equipment-semantics.test.ts` (8 DB-backed cases).
- `backend/services/ai-service/src/__tests__/training-program-scoring-v2.test.ts` (32-case golden ranking suite).
- `backend/services/ai-service/src/__tests__/fitness-agent-program-e2e.test.ts` (3 real-DB E2E cases: recommend→prepare→execute, idempotency, apply-boundary-rejection propagation).
- `backend/services/ai-service/src/scripts/evaluateProgramScoringV1VsV2.ts` (v1-vs-v2 diagnostic comparison, own script — Codex's evaluator untouched).

**Tests (updated)**: `backend/services/ai-service/src/llm/__tests__/program_recommendation_claims.test.ts` — moved to `scoreTrainingProgramV2`, added eligibility/ranking-split and zero-signal cases.

**Full detail/rationale**: `docs/training-program-recommendation-v2-score-design.md`.

## v1 Files Changed (historical, unedited below)

- `backend/shared/src/fitness-agent.ts`: added `TrainingProgramCandidate`.
- `backend/shared/src/fitness-agent-scoring.ts`: added `PROGRAM_SCORING` and `scoreTrainingProgram()`.
- `backend/services/ai-service/src/services/fitness-agent-tools.ts`: returns program candidates as shared `TrainingProgramCandidate`.
- `backend/services/ai-service/src/services/fitness-agent.service.ts`: replaces temporary program scoring with deterministic shared scorer and program narrator.
- `backend/services/ai-service/src/llm/program_recommendation_claims.ts`: program claim catalog + deterministic renderer.
- `backend/services/ai-service/src/llm/program_recommendation_narrator.ts`: JSON claim-ID selection with deterministic fallback.
- `backend/services/ai-service/src/__tests__/training-program-scoring.test.ts`: deterministic scorer tests, including a generated 100-case matrix.
- `backend/services/ai-service/src/llm/__tests__/program_recommendation_claims.test.ts`: program claim catalog/renderer tests.

## Preserved Paths

- `applyTrainingPlan` is unchanged.
- PT recommendation narrator/scoring is unchanged.
- memory extraction/tools are unchanged.
- frontend rendering already supported `PROGRAM_RECOMMENDATIONS`, so no UI change was required.

## Runtime Behavior

Program recommendations now sort by:

1. deterministic `compatibility.total` descending;
2. program id ascending for ties.

The saved `FitnessRecommendation.scoringVersion` for program recommendations is now `program-compatibility-v1`.

Narration failure does not block recommendations. If the LLM call is disabled, invalid, or fails, the server renders default grounded claims.

The score now carries deterministic `reasons`, which feed explainability and tests without requiring LLM-authored rationale text.

## v2 Runtime Behavior (production, since this pass)

Program recommendations now sort by `scoreTrainingProgramV2`'s `compatibility.total` descending, then program id ascending for ties — same tie-break rule as v1, unchanged. The saved `FitnessRecommendation.scoringVersion` for program recommendations is now `program-compatibility-v2`. `eligibilityReasons`/`signalCount` are new fields on the returned `CompatibilityScore`, used by the Claim Catalog to separate "why this is eligible" from "why it ranks where it does." When `signalCount === 0` (no session/focus/duration preference at all), every eligible candidate ties at `total: 100` with a mandatory disclosure, rather than manufacturing a fake distinction.
