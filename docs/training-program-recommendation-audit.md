# Training Program Recommendation Audit

Date: 2026-09-15

Scope: `findTrainingPrograms` / `PROGRAM_RECOMMENDATIONS` only. PT recommendation, memory, and contract automation are intentionally left unchanged.

## Current Production Path

`ai-service` routes program recommendation through `fitnessAgent.tryTurn()` when `parseFitnessAgentIntent()` returns `PROGRAM`.

The true candidate source is `fitness-service`, not Qdrant:

- `ai-service/src/services/fitness-agent-tools.ts::findTrainingPrograms()`
- `fitness-service/src/routes/agent-program.routes.ts`
- `fitness-service/src/services/agent-program.service.ts`

`fitness-service` already performs the hard filters:

- user must not have safety/injury flags requiring review;
- `preferences.goal`, `preferences.days`, and profile `experienceLevel` are required;
- template `goal`, `daysPerWeek`, `experienceLevel`, visibility, and `dataOrigin` must match;
- every exercise must resolve to a canonical published `Exercise`;
- beginner profiles reject non-beginner exercises;
- contraindicated exercises are rejected;
- equipment must be covered by the user's equipment set or be bodyweight-only;
- estimated max session duration must be within `preferences.sessionMinutes`;
- apply re-runs candidate lookup and checks `templateId` + `fingerprint` before creating a real `WorkoutProgram`.

## Finding Closed In This Phase

Before this phase, `ai-service` assigned program score using:

```ts
0.75 + 0.25 * min(1, estimatedMinutes / sessionMinutes)
```

This made a longer session look better until the cap, even when all hard filters were identical. It was also not documented as a deterministic methodology and had no program-specific claim-grounded narrator.

## v2 update (2026-09-15) — Codex Independent Evaluation #1 findings closed

Codex's independent evaluation (`docs/codex-training-program-recommendation-evaluation-1.md`, GO WITH DOCUMENTED LIMITATIONS) found two real MEDIUM issues, both addressed this pass — full detail in `docs/training-program-recommendation-v2-score-design.md`:

- **Equipment semantics (MEDIUM #1)**: the note below ("treats any ExerciseEquipment link as required") was confirmed as a real false-negative recall bug. Fixed by reusing the already-existing canonical `isExerciseAvailable()` predicate (`equipment-availability.util.ts`) — the same one exercise-substitution and plan-equipment-validation already use — instead of `agent-program.service.ts`'s own inline reimplementation. `OPTIONAL` links no longer gate availability at all; `ALTERNATIVE` links now correctly form an OR-group (owning any one member satisfies the exercise). 8 new DB-backed tests (`agent-program-equipment-semantics.test.ts`) prove each case.
- **Score redundancy (MEDIUM #2)**: `goal`/`experience`/`schedule`/`equipment` were 80/100 of every v1 score despite being exact hard filters already guaranteeing every eligible candidate scores 1 on all four (Codex measured 0 variance across a 100-case matrix, 0.87 tie rate). `scoreTrainingProgramV2` removes these four from `components`/`total` entirely — they remain as `eligibilityReasons` (confirmatory facts for the Claim Catalog, never weighted). Real re-measured result: tie rate 0.87 → 0.58, unique scores 13 → 42 on the same 100-case shape.

v1 (`scoreTrainingProgram`/`PROGRAM_SCORING`) is kept byte-for-byte unchanged for Codex's own evaluator's backward compatibility; production has moved to v2.

There is still no outcome cohort for individual program templates. The implementation therefore labels program score as compatibility, not probability of success — unchanged by v2.

