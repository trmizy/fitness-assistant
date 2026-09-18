# Training Program Recommendation v2 — Score Design

**Date**: 2026-09-15 · Written in response to `docs/codex-training-program-recommendation-evaluation-1.md` (Codex Independent Evaluation #1, GO WITH DOCUMENTED LIMITATIONS, MEDIUM findings #1 and #2). Companion: `docs/training-program-recommendation-methodology.md` (v1, kept unedited as historical record).

## The two findings this doc addresses

**MEDIUM #1 — equipment semantics**: the candidate filter in `agent-program.service.ts::candidates()` treated every linked `ExerciseEquipment` row as `REQUIRED`, regardless of its real `requirementType`. An `OPTIONAL` link (never meant to gate availability) or an `ALTERNATIVE` link (meant to form an OR-group — owning any one member satisfies the exercise) both incorrectly rejected an otherwise-eligible program. A false-negative recall bug, not a safety issue.

**MEDIUM #2 — score redundancy**: v1's `program-compatibility-v1` weighted `goal`(25) + `experience`(20) + `schedule`(20) + `equipment`(15) = 80/100 of every score on dimensions that are already **exact hard filters** in the same `candidates()` function — every program that survives the filter has already matched all four, so they are constant (always 1) across every real candidate and never differentiate anything. Codex measured this directly: tie rate 0.87, scores clustered 88–100, and `goal`/`experience`/`schedule`/`equipment` component variance was exactly 0 across a 100-candidate matrix.

## Equipment fix

Reused the existing canonical predicate (`equipment-availability.util.ts::isExerciseAvailable`) already shared by exercise substitution and plan-equipment validation — a single source of truth the whole codebase already agreed on, just never wired into the program candidate filter. No new semantics were invented:

- **REQUIRED**: every REQUIRED link must be owned.
- **ALTERNATIVE**: forms one OR-group — owning any one member satisfies it. (The current catalog only ever uses one alternative group per exercise; multi-group alternatives, e.g. `(barbell OR dumbbell) AND (bench OR machine)`, are not representable today and were not needed — no exercise in the current data requires it. If that ever becomes a real product need, it requires a schema change (a `groupId` column) and should be scoped separately, not invented speculatively here.)
- **OPTIONAL**: never gates availability.
- Zero equipment links: always available (matches every other canonical consumer).

8 new DB-backed tests (`fitness-service/src/__tests__/agent-program-equipment-semantics.test.ts`) prove each case against real `Equipment`/`ExerciseEquipment`/`UserEquipment` rows.

## Score redesign: eligibility vs. ranking

```
Hard Eligibility (fitness-service, unchanged)
  goal / experience / days-per-week / equipment / safety / canonical-exercise
        |
        v
Eligible Programs  →  every one has ALREADY matched the above exactly
        |
        v
scoreTrainingProgramV2()
  components (weighted into `total`):  sessionDuration, focusMuscle, durationWeeks
  eligibilityReasons (confirmatory, NEVER weighted):
      PROGRAM_GOAL_ELIGIBLE / PROGRAM_EXPERIENCE_ELIGIBLE /
      PROGRAM_SCHEDULE_ELIGIBLE / PROGRAM_EQUIPMENT_ELIGIBLE
```

`v1` (`scoreTrainingProgram`/`PROGRAM_SCORING`) is kept **byte-for-byte unchanged** — Codex's own evaluator (`evaluate_program_recommendation.ts`) imports these two exact names directly and must keep seeing v1's real, documented behavior. Production has moved to `scoreTrainingProgramV2`/`PROGRAM_SCORING_V2`; v1 is not deleted, and its `scoringVersion` string remains interpretable on any historical `FitnessRecommendation` row already stored with it.

### v2 weights

```
PROGRAM_SCORING_V2 = {
  version: "program-compatibility-v2",
  weights: { sessionDuration: 70, focusMuscle: 20, durationWeeks: 10 },
}
```

Same "excluded from the denominator when absent, never scored as 0" rule v1 already used for its optional dimensions — carried over unchanged, just now the ONLY rule governing `total`, since there is no longer a constant floor from eligibility dimensions.

### Weight rationale — scientific constraint vs. engineering heuristic, stated explicitly

Fitness science informs *which* dimensions are reasonable to rank on and *why* they matter at all (session length affects volume/adherence; focus-muscle alignment affects whether the program serves the user's stated goal; program duration affects periodization fit). **It does not calibrate the exact numbers 70/20/10.** Those are engineering heuristics — a defensible, documented, inspectable choice, not a scientifically-derived optimum. No claim is made or should be made that these weights are outcome-optimal; `docs/training-program-recommendation-methodology.md` and this file are the source of truth for what they mean.

### Zero ranking signal — an honest tie, not a fabricated score

If a request supplies no `sessionMinutes`, no confirmed focus muscles, and no `durationWeeks` preference, **none** of the three ranking dimensions can be computed — `components` is empty and `signalCount === 0`. Per this task's own explicit instruction ("a tie between genuinely equal programs is correct... it is more honest to say these all match than manufacture 95 vs 94"), every such candidate receives the same fixed `total: 100` ("matches everything currently known/requested") with `signalCount: 0` making the tie self-documenting, and a **mandatory** `ZERO_RANKING_SIGNAL` claim/disclosure — "Các chương trình này đều đáp ứng các ràng buộc hiện tại như nhau..." — always rendered regardless of LLM selection. Final ordering among such ties falls to the existing stable `program.id` tie-break, unchanged.

`total` deliberately stays `number` (not `number | null`) — `CompatibilityScore` is a single shared interface also used by `scorePT` (frozen, PT-Agent Phase 4, out of scope for this pass); widening its type would force every PT consumer to handle `null` for a case that doesn't apply to PT at all. `eligibilityReasons?: string[]` and `signalCount?: number` were added as new **optional** fields instead — fully additive, zero effect on `scorePT`'s existing behavior or tests.

### Measured result (real, this pass — `evaluateProgramScoringV1VsV2.ts`, same 100-case representative dataset shape Codex's own evaluator uses)

| | v1 | v2 |
|---|---|---|
| scoringVersion | program-compatibility-v1 | program-compatibility-v2 |
| min / p25 / median / mean / p75 / max | 88 / 92 / 95 / 94.49 / 97 / 100 | 50 / 70 / 78 / 77.76 / 86 / 98 |
| tie rate | 0.87 | 0.58 |
| unique scores (of 100) | 13 | 42 |
| goal/experience/schedule/equipment component variance | all 0 | not in components at all |

**Divergence sanity check** (not "did the distribution get wider" — "does a REAL signal now produce a wider gap"): two candidates identical except `estimatedMinutes` (51 vs. 60, target 60) — the SAME real difference produced a 1-point gap under v1 and a 10-point gap under v2. This is the actual claim being made: v1's 80 constant points were diluting genuine signal, not that v2 added noise.

## Claim Catalog v2

`program_recommendation_claims.ts` now distinguishes:

- **Eligibility claims** (`GOAL_ELIGIBLE`, `EXPERIENCE_ELIGIBLE`, `SCHEDULE_ELIGIBLE`, `EQUIPMENT_ELIGIBLE`) — "why this program is even in the list." Rendered into `strengths` but ordered before ranking claims, never conflated with "why it outranks another eligible one."
- **Ranking claims** (`SESSION_DURATION`, `FOCUS_MATCH`, `DURATION_WEEKS`) — the only claims sourced from `components`, the only ones that can actually differ between two eligible candidates.
- **Mandatory disclosures** (`NO_OUTCOME_HISTORY`, `ZERO_RANKING_SIGNAL`) — always rendered regardless of LLM selection, same principle as the PT Narrator's `INSUFFICIENT_HISTORY`/synthetic-origin claims (`docs/recommendation-claim-catalog-design.md`).

Same Structured Claim Grounding invariant as the PT Narrator: the LLM only ever selects claim IDs (`ProgramClaimSelectionSchema`, now `.strict()` on both levels, matching the PT design) from a server-built, per-candidate-scoped catalog; `renderProgramClaim`/`renderProgramNarrationFromClaims` are the only code that ever produces user-facing text. There is still no claim type for price, guaranteed outcome, medical/PED, superiority, hidden schedule promises, or real-world outcome cohorts — none of those has a real grounding field, so none can ever be selected regardless of how an LLM response is worded.

Backward compatibility: `buildProgramClaimCatalog` falls back to reading v1's `components.goal`/`.experience`/`.schedule`/`.equipment` directly when `eligibilityReasons` is absent (i.e. a v1 `CompatibilityScore` is passed in) — this is what keeps Codex's own evaluator's `assertClaimSecurity()` (which calls `scoreTrainingProgram` v1 directly) passing unchanged.

## DB-backed E2E (Codex §29/§30/§34/§38 — previously BLOCKED/UNVERIFIED)

`fitness-agent-program-e2e.test.ts` (ai-service, new): the real `fitnessAgent.tryTurn → prepare → execute` chain against real ai-service DB rows (`FitnessRecommendation`, `FitnessAgentAction`), with real v2 scoring, real claim-catalog deterministic-fallback narration, and only the genuine cross-service HTTP boundary (`findTrainingPrograms`/`applyTrainingPlan`) stubbed — the same convention the existing PT-side `fitness-agent-goal-intent-loop.test.ts` already uses for its own HTTP boundary. Proves: the real top-ranked v2 candidate is what gets confirmed and applied; the stored `scoringVersion` reflects v2, not the retired v1 constant; double-confirm is idempotent via the real `FitnessAgentAction` row; an apply-boundary rejection (simulating fitness-service's own revalidation) propagates as a real error without marking the local action `COMPLETED`.

`agent-program-apply-idempotency.test.ts` and the new `agent-program-equipment-semantics.test.ts` (fitness-service) independently cover the fitness-service side of that same boundary: real hard filters, real idempotency, real stale-fingerprint 409, real equipment semantics — all DB-backed.

## What was explicitly NOT done

- No ML/learning-to-rank/collaborative filtering — there is no attributable real program-outcome cohort to learn from.
- No RoadmapPhase-to-template mapping — the current candidate payload has no stable representation for it; inventing one would be guessing, not implementing.
- No multi-group ALTERNATIVE equipment schema change — not needed by any current exercise; would be scope creep without a real product requirement.
- No `total: number | null` type change to the shared `CompatibilityScore` — would ripple into the frozen PT-Agent scoring path unnecessarily.
- No large card redesign — added only the one missing, real piece (an "uncertainty/disclosure" section rendering `narration.uncertainty`, which now surfaces `ZERO_RANKING_SIGNAL`/`NO_OUTCOME_HISTORY` text) rather than the full mockup in the task's own §26, since the smaller change already delivers the transparency value without a larger UI risk surface.

## DB environment gate (2026-09-15, post-Evaluation-#2)

Codex Independent Evaluation #2 signed off the v2 implementation itself (0 CRITICAL/HIGH/MEDIUM) but could not complete the two fitness-service DB-backed suites against its local environment (`Prisma P2021: public.equipment does not exist`). Root cause and resolution: `docs/training-program-recommendation-evaluation.md`'s "v3 — DB environment gate closed" section. In short: the isolated test database needs the project's own `pnpm run prisma:migrate:test` bootstrap (real `prisma migrate deploy` per service, safety-guarded against non-test URLs) run before DB-backed tests — this had only partially happened in the shared test-DB volume. No production code changed for this; re-running `agent-program-equipment-semantics.test.ts` + `agent-program-apply-idempotency.test.ts` after the bootstrap step gives 10/10, reproducible across two consecutive runs.
