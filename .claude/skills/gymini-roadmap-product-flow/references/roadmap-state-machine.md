# Roadmap / Phase / TrainingCycle / CycleAssessment state graph

Source of truth: `backend/services/fitness-service/src/services/
fitness-roadmap.service.ts`, `training-cycle.service.ts`,
`cycle-decision.engine.ts`. Re-read the actual code before relying on
this if it's been a while — this is a snapshot, not guaranteed current.

## FitnessRoadmap.status

`DRAFT -> ACTIVE -> COMPLETED` (or `ARCHIVED` at any point before
COMPLETED). Only ONE non-archived DRAFT and only one ACTIVE roadmap per
user at a time (enforced service-side).

`createdByRole`: `CLIENT | PT | AI | SYSTEM`. Only trusted server code
may pass `PT`/`AI`/`SYSTEM` — never from client-supplied request body.
A PT-created draft is still owned by the **client** (`userId` = the
client), never the PT.

## RoadmapPhase.status

`PLANNED -> ACTIVE -> COMPLETED` (or `SKIPPED` if bypassed by a REBUILD).
Exactly one phase is ACTIVE at a time while the roadmap is ACTIVE.

## TrainingCycle.status

`ACTIVE -> ANALYZED -> (assessment completes) -> next cycle created`.
`planId` is **always null** for a Roadmap-driven cycle — the real
program↔cycle link is the per-row `WorkoutSchedule.trainingCycleId`, not
a cycle-level pointer. A brand-new cycle (from any transition path)
starts with **zero** `WorkoutSchedule` rows — this is expected, not a
bug; see the derived `trainingReadiness` field below.

## advanceRoadmap outcomes

`evaluateRoadmapTransition` maps the just-completed cycle's
`CycleAssessment.decision` to one of:

- `REBUILD_REMAINING_ROADMAP` (decision=REBUILD) — separate
  `applyRoadmapRebuild` path.
- `INSERT_RECOVERY_CYCLE` (decision=DELOAD) or `CONTINUE_CURRENT_PHASE`
  (phase objective not yet reached) — same-phase, new cycle via
  `trainingCycleService.startCycle`.
- `COMPLETE_AND_ACTIVATE_NEXT_PHASE` — phase objective reached, next
  `PLANNED` phase activates via `activatePhaseInTransaction` (or the
  whole roadmap completes if no phase remains).

All three converge on the same "new TrainingCycle, `planId: null`, zero
schedules" result — `advanceRoadmap` never auto-generates a workout.

## Derived readiness (no schema field — computed, not stored)

`getRoadmapProjection` (same service) additionally computes, purely from
already-loaded data:

```
trainingReadiness: {
  status: "READY" | "NEEDS_GENERATION"   // does the ACTIVE cycle have any real WorkoutSchedule row?
  lastAssessmentDecision: string | null
  canReuseLastProgram: boolean            // true only for a real KEEP decision + a prior ACTIVE program
}
nutritionReadiness: { status: "READY" | "NEEDS_GENERATION" }  // does the user have any ACTIVE NutritionGoal?
```

`canReuseLastProgram` is deliberately `KEEP`-only: `CycleAssessment` has
no structured, program-buildable data for PROGRESS/ADJUST/DELOAD/REBUILD
(only a coarse `recommendedActionScope` enum + free-text
`proposedChanges` from the LLM explanation layer) — reusing the prior
program for any of those would be a blind copy, explicitly forbidden
(DELOAD especially must never silently repeat a higher-workload prior
program).

## CycleAssessment fields worth knowing

- `decision`: `KEEP | PROGRESS | ADJUST | DELOAD | REBUILD |
  INSUFFICIENT_DATA` — the deterministic engine's own output, the
  adaptation-decision authority.
- `aiSummary`: LLM explanation layer, human-readable, **never overrides**
  `decision`.
- `nutritionDecision`/`nutritionUserDecision`/`nutritionReviewedByRole`:
  a **separate** decision space on the same row (nutrition vs. training
  can be accepted/rejected independently).
- `reasonCodes`: short audit-trail strings — safe to surface, not raw
  chain-of-thought.
