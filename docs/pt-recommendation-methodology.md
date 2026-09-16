# PT Recommendation Methodology

**Implementation**: `backend/shared/src/fitness-agent-scoring.ts` (`scorePT`, `journeySimilarity`, `summarizeJourneys`) + `backend/services/user-service/src/services/agentic-fitness.service.ts` (`candidates()`) + `backend/services/ai-service/src/llm/recommendation_narrator.ts` (explanation layer, see §5 below).

## Architecture: hard filters → deterministic scoring → historical similarity → (optional) LLM narration

This is a **hybrid** design per the research comparison in `docs/ai-agent-system-feasibility-audit.md` §7 (case-based reasoning + deterministic scoring, not a learned ranking model) — appropriate for a dataset of this scale (dozens to low hundreds of PTs), where a machine-learning ranker would be both unjustified by data volume and less explainable than a transparent formula.

## 1. Candidate eligibility (hard constraints)

Computed in `agenticFitnessService.candidates()`. A PT is **excluded entirely** (not down-ranked) if any of these fail — no soft score can compensate for a failed hard constraint:

- `isPT`, not `ptSuspended`, `isAcceptingClients`
- `ptApplication.status === "APPROVED"`
- `specialties` has some overlap with the requested goal's alias list (`GOAL_SPECIALTIES`)
- At least one `PTServicePackage` within budget (`price <= budgetVnd`) and session duration (`sessionDurationMinutes <= preferences.sessionMinutes`)
- Real-time computed availability covers **every** requested day (via `countSlotsFromRows` against `PTAvailability`/`PTScheduleException`/booked `Session`s over a 28-day window) — a genuinely computed capacity check, not a static flag
- At least one package has enough open slots for its own `sessionCount`

## 2. Soft scoring (`scorePT`, deterministic weighted sum)

Weights: `goal: 30, schedule: 25, budget: 20, reputation: 10, evidence: 15` (`FITNESS_SCORING.weights`, version `compatibility-v2`).

| Dimension | Computation |
|---|---|
| `goal` | 1 if the PT's specialties include an alias for the requested goal, else 0 |
| `schedule` | Fraction of requested days the PT covers |
| `budget` | 1 if any eligible package is within budget, else 0 |
| `reputation` | `averageRating / 5` if `reviewCount >= 5`, else 0 |
| `evidence` | See §3 — **absent** (not 0) when cohort data doesn't exist |

**Explicitly forbidden**: no LLM ever computes or overrides this score (feasibility audit §29). The narration layer (§5) only explains an already-fixed number.

## 3. Historical similarity (case-based reasoning)

`journeySimilarity(a, b)`: hard-zero if `goal` or `experience` differ, or `constraints` (injuries) differ; otherwise a weighted distance over `baselineWeight` (0.30), `trainingDays` (0.25), `durationWeeks` (0.15), `sessionMinutes` (0.15), `baselineBodyFat` (0.15, excluded from the denominator when either side is missing rather than penalized).

`summarizeJourneys(rows, origin)`: filters to journeys with a real `endingWeight`, requires `eligible.length >= minimumCohort` (5) before returning any non-zero summary — below that, returns `{count: 0, note: "Not enough historical evidence."}` regardless of how good the few available journeys look. This is a genuine statistical floor, not a UI nicety: a 2-3-journey "cohort" is not a meaningful sample, and the code refuses to pretend otherwise.

### Cold-start fairness (fixed during this implementation — real bug, real fix)

**Before**: `scorePT`'s `evidence` component was `0` for any PT below `minimumCohort`, identical to a PT with a genuinely poor observed cohort. A brand-new PT with excellent goal/schedule/budget/reputation fit was scored as if their (nonexistent) track record were actively bad.

**After**: when `history.count < minimumCohort`, the `evidence` dimension is **dropped from both the numerator and the weight-normalizing denominator** — a cold-start PT is ranked on the remaining 85 points (goal/schedule/budget/reputation) rather than capped by a dimension with nothing real to say yet. Verified by `backend/services/ai-service/src/__tests__/fitness-agent-scoring.test.ts` (8 unit tests, all passing) and end-to-end by `backend/services/user-service/src/__tests__/agentic-fitness-synthetic-cohort.test.ts` against the real synthetic dataset. `FITNESS_SCORING.version` bumped to `compatibility-v2` to mark the behavior change.

## 4. What is intentionally NOT used as a similarity dimension

No age, gender, or any other demographic field is used in `journeySimilarity` — the `JourneyFeatures` type structurally has no such field (verified by a compile-time-guarding test). Only goal, experience level, training load, and body composition are used, per the task's own instruction to avoid unsupported/sensitive matching dimensions.

## 5. Narration layer (the one new LLM capability, §6 of target-architecture doc)

`recommendation_narrator.ts::narrateRecommendations()` takes the already-ranked `scorePT` output + real evidence + real cohort summaries and produces a grounded, per-candidate explanation, replacing the previous hardcoded Vietnamese `why[]` strings. Every output is validated (`validateNarration()`, pure/deterministic) against the real numbers before being shown:

- Any percentage mentioned must equal the real `compatibility.total` (not a paraphrase, not a rounding).
- `historicalEvidenceSummary` is stripped/rejected if the cohort is empty (`history.count === 0`) — a narration cannot claim evidence that doesn't exist.
- Cited scientific evidence (`evidenceRefs`) must match a real, supplied `AgentEvidence.id` — an invented citation is dropped.
- Guarantee/causal-promise language ("chắc chắn", "sẽ giúp bạn giảm Xkg") is rejected outright.

On ANY validation failure for a given candidate, that candidate silently falls back to the original template `why[]` strings — the recommendation itself is never blocked or degraded by an LLM failure (verified: `narrateRecommendations` never throws, `ENABLE_RECOMMENDATION_NARRATION` defaults such that disabling it produces identical behavior to before this implementation).

## 6. Explainability

Every `PT_RECOMMENDATIONS` candidate carries: `compatibility.components` (the exact per-dimension scores), `history` (the real or honestly-empty cohort summary), and either a validated LLM narration or the deterministic `why[]` fallback. A user (or evaluator) can always trace a ranking back to concrete, real numbers — nothing in the ranking path is a black box.

## 7. Known limitations

- `findTrainingPrograms` (workout-program recommendation, as opposed to PT recommendation) has **no equivalent scoring** — it returns a filtered, unranked list. Extending it with a comparable deterministic scorer (goal/experience/equipment/session-length fit) is a natural next phase, deliberately not built in this pass to avoid inventing weights without a dedicated design review (see migration plan Phase 8, left as a documented next step rather than a rushed formula).
- `journeySimilarity`'s weights (`distance: {weight:0.30, frequency:0.25, duration:0.15, session:0.15, bodyFat:0.15}`) are pre-existing product heuristics, not re-derived in this pass — validating them against the new synthetic dataset (or real data, once it exists) is future evaluation work, not a claim made here.
