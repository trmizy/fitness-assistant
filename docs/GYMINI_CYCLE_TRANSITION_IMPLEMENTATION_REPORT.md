# Gymini Adaptive Cycle Transition Continuity + Nutrition Program Live Closure — Implementation Report

Date: 2026-09-10
Design doc: `docs/GYMINI_CYCLE_TRANSITION_CONTINUITY_DESIGN.md` (all 12
required questions answered from code before any edit below was made).

## Summary

Fixes the one open P2 gap from the prior Cross-System phase (next Roadmap
cycle has zero WorkoutSchedule rows after a transition) with a derived,
no-schema-change readiness state, and live-closes the one remaining
unchecked Cross-System item (NutritionProgram.sourceGoalId real-AI proof).

## P2-1 root cause (confirmed by code, not assumption)

`activatePhaseInTransaction` and `trainingCycleService.startCycle`'s
same-phase branch — the two code paths every `advanceRoadmap` outcome
(phase-transition, same-phase continuation, and REBUILD) converges on —
always create a brand-new `TrainingCycle` with `planId: null`, and no
`WorkoutSchedule` row is ever created alongside it. `TrainingCycle.planId`
is never written anywhere else in the codebase (confirmed by exhaustive
grep of every `trainingCycle.update` call). The only real program↔cycle
link is the per-row `WorkoutSchedule.trainingCycleId`.

## Chosen fix — derived readiness, no schema change

`getRoadmapProjection` (`fitness-roadmap.service.ts`) now additionally
computes, from data it already loads for that same call (zero new
queries except one `nutritionGoal.findFirst`):

```ts
trainingReadiness: {
  status: "READY" | "NEEDS_GENERATION";      // does the ACTIVE cycle have any real WorkoutSchedule row?
  lastAssessmentDecision: string | null;      // the decision that produced this cycle
  canReuseLastProgram: boolean;               // true only if decision === "KEEP" AND a prior ACTIVE program/schedule exists
}
nutritionReadiness: {
  status: "READY" | "NEEDS_GENERATION";       // does the user have any ACTIVE NutritionGoal?
}
```

Why `canReuseLastProgram` is gated to `KEEP` only: per the design doc
§2/§3, `CycleAssessment` carries no structured, program-buildable data for
PROGRESS/ADJUST/DELOAD/REBUILD (only a coarse 4-way
`recommendedActionScope` and free-text `proposedChanges` from the AI
explanation layer) — blindly reusing the prior program for any of those
would be exactly the "blind copy" the master task forbids. KEEP is the
only decision where reusing the prior program is a legitimate, safe,
deterministic action, and even then it is offered as an opt-in secondary
CTA, never automatic.

The reuse action itself calls the existing
`POST /plans/:planId/save-to-workout-log` endpoint
(`planService.savePlanToWorkoutLog`) with a new date range — zero new
backend mutation endpoints, zero new AI calls, zero new validation risk
(the program's exercises were already validated once).

No AI generation is ever auto-triggered server-side after
`advanceRoadmap`. The Journey UI's primary CTA always routes into the
existing, human-reviewed Generate→Review→Save flow at `/client/plans`.

## AI-failure recovery — nothing to fix

Confirmed by code reading: `advanceRoadmap`'s entire lifecycle mutation
runs inside its own Prisma transaction, fully decoupled from AI
generation (a separate, already-async call chain —
`POST /plans/workout/generate` returns 202 immediately with
`{planId, jobId}`). There is no code path where a Roadmap/TrainingCycle
transition depends on, blocks on, or rolls back because of an AI
generation outcome.

## Nutrition — audited, one small proven cross-cutting test added

- NutritionGoal-for-next-cycle and NutritionProgram.sourceGoalId
  semantics were both already correct by code reading (snapshot-at-
  creation-time `sourceGoalId`, `status='ACTIVE'`-based "current" goal
  resolution, `trainingCycleId` correctly understood as provenance-only,
  never a consumption-scoping filter).
- The stale-meal-plan UX (§21) was found ALREADY FULLY IMPLEMENTED
  (`nutrition-goal-plan-consistency.service.ts` + the real banner in
  `NutritionPage.tsx`) — verified live, not built.
- One new backend integration test added to close the one real
  cross-cutting gap that was NOT covered by any existing test: an older
  NutritionProgram (P1) must stay pinned to the NutritionGoal version
  (V1) it was actually generated from, even after the goal is superseded
  to V2 and a new program (P2) is created from V2. See
  `nutrition-goal-plan-consistency.integration.test.ts`'s new
  `"V1->V2 goal versioning..."` test.

## §24 Substitution — one integration proof, engine untouched

New file `cross-system-substitution-integration.test.ts` calls the real,
existing `exerciseSubstitutionService.rankSubstitutes` with a real
catalog exercise whose required equipment is made unavailable via a
legitimate test-context equipment set. Asserts a real, equipment-
compatible, PUBLISHED substitute with `score > 0` and a real reason
string. The substitution engine itself is not modified.

## Files changed

Backend (`backend/services/fitness-service`):
- `src/services/fitness-roadmap.service.ts` — `trainingReadiness`/
  `nutritionReadiness` added to `getRoadmapProjection`'s return value.
- `src/__tests__/fitness-roadmap.service.integration.test.ts` — extended
  the existing §25-29 Cross-System test with readiness assertions after
  `advanceRoadmap`; added a new dedicated readiness test (READY vs
  NEEDS_GENERATION, `canReuseLastProgram` true only after a real KEEP).
- `src/__tests__/cross-system-substitution-integration.test.ts` (new) —
  §24 proof.
- `src/__tests__/nutrition-goal-plan-consistency.integration.test.ts` —
  new V1→V2 sourceGoalId cross-cutting test (§20).
- `src/scripts/_tmp_prepareCycleTransitionFixture.ts` (new, temporary,
  explicitly named for deletion after use) — one-off TEST FIXTURE-prep
  script for the browser E2E precondition (see below).

Auth (`backend/services/auth-service/prisma/seed.ts`):
- Added `cycleTransitionClient` (`cycle.transition.client@example.test`)
  — a dedicated account for TC-XSYS-006/008.

Frontend (`frontend/web`):
- `src/app/services/api.ts` — added `RoadmapTrainingReadiness` /
  `RoadmapNutritionReadiness` types, extended
  `FitnessRoadmapProjection`.
- `src/app/pages/client/RoadmapJourneyPage.tsx` — new readiness UI block
  on the Journey tab: `NEEDS_GENERATION` state (amber, with the CTA
  copy specified in the master task), `READY` state (green
  confirmation), a KEEP-only "Dùng lại chương trình trước" secondary
  CTA, and a nutrition-needs-setup block. No new page.

External E2E harness (`fitnessassistant-playwright-e2e`, separate repo):
- `fixtures/auth.ts` — added `cycleTransitionClient` seed account entry.
- `tests/32-cross-system-fitness-journey.spec.ts` — added TC-XSYS-006
  (readiness UI, REAL BROWSER), TC-XSYS-007 (real AI meal-plan
  generation + sourceGoalId proof, REAL BROWSER + REAL AI), TC-XSYS-008
  (mobile viewports, REAL BROWSER), TC-XSYS-009 (security, REAL
  HTTP/API), TC-XSYS-010 (§21 stale-meal-plan banner, REAL BROWSER +
  REAL HTTP/API — a real goal change, not a code-audit-only claim).

## API changes

None. `getRoadmapProjection`'s response gains two new optional-shaped
fields (`trainingReadiness`, `nutritionReadiness`); no existing field
changed shape, no new endpoint added.

## Schema / migration

None. Confirmed by design-doc §"No schema change": readiness is fully
derived from existing `TrainingCycle`/`WorkoutSchedule`/
`CycleAssessment.decision` rows; nutrition versioning/traceability
already had every field it needed.

## Security

Reuses existing ownership semantics — no new endpoint, no new
authorization logic. `getRoadmapProjection` (the code path the new
readiness fields were added to) already scopes its query by
`{ id: roadmapId, userId }`, so the new fields inherit that guard for
free. `POST /plans/:planId/save-to-nutrition` already checks
`plan.userId !== userId` (403) and never accepts a client-supplied
`sourceGoalId`/goal id at all — confirmed by reading its full request-
body destructuring (`startDate, endDate, repeatEnabled, forceArchive`
only). Live-proven in TC-XSYS-009.
