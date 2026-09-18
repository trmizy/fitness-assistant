# Gymini Adaptive Cycle Transition Continuity + Nutrition Program Live Closure — Design

Date: 2026-09-10
Scope: small, targeted follow-up to the Cross-System Integration phase.
Fixes P2-1 (next-cycle WorkoutSchedule continuity) and live-closes the
one remaining Cross-System unchecked item (NutritionProgram.sourceGoalId
live-proof). Does not reopen Roadmap/Forecast design, Exercise Catalog,
Canonical Exercise Identity, AI Workout Grounding architecture,
navigation, or add new pages/agents. Written after auditing current code
— every claim below is code-cited, not assumed.

## 1. What exactly does `advanceRoadmap` create?

`fitness-roadmap.service.ts:1270-1413`. Three real outcomes:

- `COMPLETE_AND_ACTIVATE_NEXT_PHASE` → completes the current phase,
  writes the (unchanged) reconciliation audit, then calls
  `activatePhaseInTransaction(tx, userId, roadmapId, nextPhase.id, {})`
  for the next PLANNED phase — or marks the whole roadmap COMPLETED if
  none remain.
- `INSERT_RECOVERY_CYCLE` / `CONTINUE_CURRENT_PHASE` (assessment DELOAD,
  or phase objective not yet reached) → falls through to
  `trainingCycleService.startCycle(userId, cycle.planId, ...)`
  (line 1391) — a new cycle in the SAME phase.
- `applyRoadmapRebuild` (separate endpoint, `assessment.decision ===
  "REBUILD"`) also ultimately calls the SAME
  `activatePhaseInTransaction` (line 1538) for its new phase.

**All three paths converge on either `activatePhaseInTransaction` or
`startCycle` — both create a brand-new `TrainingCycle` row with
`planId: null`** (`activatePhaseInTransaction` passes `null` literally
at line 230; the same-phase branch forwards `cycle.planId`, which is
itself always `null` for a Roadmap-driven cycle — confirmed below, §4).
**No WorkoutSchedule row is ever created by any of these three paths.**
This is the exact, confirmed root cause of P2-1, uniform across
phase-transition, same-phase-transition, and REBUILD (answers §11/§12).

## 2. What training recommendation already exists in `CycleAssessment`?

`recommendedActionScope: "none"|"minor_adjustment"|"deload"|
"full_rebuild"` (coarse category, `cycle-decision.engine.ts`) and
`proposedChanges` (JSON array of `{target, currentValue, proposedValue,
reason}` items). **`proposedChanges` is populated from the AI
explanation layer's output** (`training-cycle.service.ts:1685`,
`proposedChanges: (aiResult?.proposedChanges ?? []) as any` — `aiResult`
comes from `ai-service`'s `/ai/assess-cycle`), not the deterministic
engine. It is free-text-shaped guidance for a human to read
("Sets: 3 → 4"), not a canonical-Exercise-id-linked, machine-buildable
program specification.

## 3. Does KEEP/PROGRESS/ADJUST/DELOAD carry structured, program-buildable data?

**No.** Confirmed by §2 — the only structured, deterministic signal is
`recommendedActionScope`'s 4-way coarse enum. There is no per-exercise,
per-set, canonical-id-linked recommendation anywhere in
`CycleAssessment`. This directly rules out "auto-build a new
WorkoutProgram from the assessment" as a safe option this pass — doing
so would require inventing new decision science (translating a coarse
category + free text into concrete sets/reps/exercise selection),
exactly what the master task's §7/§35 prohibit.

## 4. Does WorkoutProgram belong to a cycle directly?

No. `WorkoutProgram` has no `trainingCycleId` column (confirmed in the
prior Cross-System phase's schema inspection, re-confirmed here —
`\d workout_programs` has no such field). `TrainingCycle.planId` is the
only program-cycle pointer, and — confirmed by grepping every
`trainingCycle.update` call in `workout.service.ts` — **it is never
written to** outside of `startCycle`'s own creation call, which for
every Roadmap-driven path always receives `null`. So a Roadmap-driven
`TrainingCycle` has a permanently-null `planId`, and the ONLY real link
between a program and "which cycle is executing it" is the individual
`WorkoutSchedule.trainingCycleId` FK — set per-row, not per-program.

## 5. How are WorkoutSchedule rows assigned to `trainingCycleId`?

`resolveScheduleTrainingCycleId` (`workout.service.ts:53-116`), called
by both `createManualProgram` and `importAiPlanToSchedule`: reuses the
user's currently-ACTIVE TrainingCycle if one exists (throwing 409 if an
active Roadmap phase's cycle isn't ACTIVE yet), or creates one
(`allowCreate` param) for the agent/non-Roadmap path. This is the real,
existing, single source of truth for "which cycle owns this schedule
row" — already correct, already safe, reused as-is.

## 6. Can an existing WorkoutProgram safely be scheduled into the new cycle?

**Yes, via an existing mechanism** —
`planService.savePlanToWorkoutLog(planId, {startDate, selectedWeekdays,
replaceExisting})` (`POST /plans/:planId/save-to-workout-log` →
`importAiPlanToSchedule`) takes an EXISTING, already-validated
`sourcePlanId` and creates new `WorkoutSchedule` rows for a NEW date
range via the same `resolveScheduleTrainingCycleId` call — no new AI
generation, no new validation risk (the program's exercises were
already validated once). This is real, safe, deterministic reuse
infrastructure — exactly what §6/§7 of the master task asks me to look
for before reaching for AI. **This is the mechanism the KEEP-decision
fast path uses** (§11 below) — not a new implementation, just a new
caller of an existing endpoint.

## 7. When is a fresh AI generation actually necessary?

When there is no program worth reusing at all (first-ever cycle) or
the assessment decision is PROGRESS/ADJUST/DELOAD/REBUILD — each of
which, per §3 above, has no structured data this pass can safely turn
into a new program without a fresh design decision (progression amount,
deload load-reduction ratio, rebuilt phase's new emphasis) that only a
real generation pass (AI or manual) can make. Blindly reusing the old
program for these decisions would be the exact "blind copy" the master
task explicitly forbids (§4/§6).

## 8. Safest recovery behavior if AI is unavailable?

Already safe by construction — confirmed by direct code reading, not
assumed: `advanceRoadmap`'s entire lifecycle mutation happens inside its
own Prisma transaction (`fitness-roadmap.service.ts:1271`), completely
decoupled from AI generation, which only ever happens later via a
completely separate call chain (`POST /plans/workout/generate`,
ai-service's own async job). There is no code path where a Roadmap/
TrainingCycle transition depends on, blocks on, or rolls back because of
an AI generation outcome. **Nothing to fix here — already correct.**

## 9. How does the next-cycle NutritionGoal get created/versioned?

`nutrition.repository.ts:upsertGoal` — a real, atomic 2-statement
transaction: SUPERSEDE the current ACTIVE row, INSERT a new ACTIVE row
with `previousGoalId` pointing back. Triggered by
`applyNutritionReviewDecision` (`training-cycle.service.ts:396-,` called
from `acceptNutritionRecommendation`) when a user ACCEPTs the
assessment's nutrition proposal. `trainingCycleId` is stamped as the
**JUST-COMPLETED cycle's id** (`applyNutritionReviewDecision`'s own
`cycleId` parameter, line 475), not the new next cycle's id.

**This is correct, not a bug** — confirmed by checking every read site
of `NutritionGoal.trainingCycleId`
(`nutrition.repository.ts` — SELECT/INSERT only, never a `WHERE
training_cycle_id = ...` filter anywhere in the codebase). The field is
pure **provenance** ("which cycle's assessment produced this version"),
not a consumption-scoping FK. "Which goal is current" is determined
purely by `status = 'ACTIVE'`, which is correctly maintained regardless
of which cycle id happens to be stamped on it. No fix needed for Q9.

## 10. How does NutritionProgram follow that new NutritionGoal?

`nutrition.service.ts:1423`, `importNutritionPlan`-equivalent save path:
`const activeGoal = await nutritionRepository.findGoalByUserId(userId);`
then `sourceGoalId: activeGoal?.id ?? null` at creation time (line
1468). Real, already-correct, snapshot-at-creation-time semantics —
exactly the versioning contract §20 of the master task wants proven.
Nothing to fix; needs live verification only (§18 below).

**Stale-mismatch detection already exists and is already wired to the
UI** — a real, complete finding, not something to build:
`nutrition-goal-plan-consistency.service.ts` (`compute(userId)`) returns
`MATCHED | STALE_GOAL_CHANGED | MACRO_MISMATCH | NO_ACTIVE_GOAL |
NO_ACTIVE_PROGRAM | LOW_CONFIDENCE`, exposed at `GET
/nutrition/active-state`, and **already rendered** in
`NutritionPage.tsx:934-988` — a real banner
(`data-testid="goal-plan-mismatch-banner"`) with real Vietnamese copy
for both `MACRO_MISMATCH` and `STALE_GOAL_CHANGED`, a
"Tạo lại thực đơn theo mục tiêu mới" CTA navigating to `/client/ai-coach`,
and a dismiss action. **§21 (Stale Meal Plan UX) requires zero new
implementation** — this closes as NO ISSUE / ALREADY IMPLEMENTED,
verified live in this pass's E2E work rather than built.

## 11. Phase transition vs same-phase cycle transition — different behavior needed?

No — per §1, both converge on the identical `activatePhaseInTransaction`/
`startCycle` code shape with the identical `planId: null` / zero-schedule
result. The chosen continuity policy (below) applies uniformly; no
special-casing by transition type is needed or implemented.

## 12. What should happen after REBUILD?

Same as §11 — REBUILD's new phase activation is the same
`activatePhaseInTransaction` call (line 1538), so the identical
zero-schedule state and the identical continuity policy apply. REBUILD's
own Roadmap-internal correctness (forecast immutability, SKIPPED future
phases, etc.) is unchanged and out of scope for this pass.

---

## Chosen continuity policy

**Do NOT auto-trigger AI generation automatically, server-side, after
`advanceRoadmap`.** Per §2/§3, there is no safe, existing, deterministic
way to decide WHAT to generate differently for PROGRESS vs ADJUST vs
DELOAD without either (a) inventing new decision-translation logic
(prohibited — §7/§35 of the master task), or (b) threading
decision-awareness into ai-service's prompt-building internals, which is
AI Workout Grounding-adjacent code this pass must not touch. Blind
reuse is explicitly forbidden by §4 for anything but KEEP.

**Implemented instead — the master task's own §10 "Minimum Acceptable
Fix," chosen deliberately over §11's "Stronger Fix" because the stronger
fix's precondition (cleanly deriving generation input per decision
type) is not met by current code:**

1. A **derived** (no schema change) next-cycle training-readiness state
   — `READY | NEEDS_GENERATION` — computed from real data already
   available: does the ACTIVE TrainingCycle have any real
   `WorkoutSchedule` row? (`PREPARING`/`BLOCKED` states from the master
   task's own suggested vocabulary are not reachable in this
   architecture since generation is user-initiated and synchronous-from-
   the-UI's-perspective via the existing async job the UI already polls
   — there is no server-side "generation in progress for this cycle" we
   could observe without adding new state, which §32 forbids by
   default.)
2. **One exception — the KEEP decision fast path (§6 above):** when the
   just-completed cycle's assessment decision was `KEEP` and a real
   prior `WorkoutProgram`/AI plan exists, the readiness computation
   additionally reports it as reusable, and the frontend offers
   "Dùng lại chương trình trước" alongside the regenerate CTA — calling
   the SAME real `save-to-workout-log` endpoint with a new `startDate`
   (no new AI call, no new validation risk, real existing mechanism).
3. Journey/Today surfaces this via a small, existing-pattern UI block
   (no new page): `training: READY | NEEDS_GENERATION` +
   `nutrition: READY` (always — NutritionGoal is a standing resource,
   confirmed connected regardless of cycle boundary, §9) + a primary CTA
   that routes directly into the existing real Generate→Review→Save flow
   (`/client/plans`) or the KEEP-only reuse action. No internal IDs
   exposed.

## Why this is safe for KEEP/PROGRESS/ADJUST/DELOAD/REBUILD

- **KEEP** — the only decision with a real, safe, deterministic reuse
  path (§6); explicitly opt-in via a visible secondary action, never
  automatic.
- **PROGRESS/ADJUST** — always routed to the real, existing, human-
  reviewed Generate→Save flow; the user consciously regenerates,
  respecting whatever the real AI/manual flow decides fresh, never a
  silent stale copy.
- **DELOAD** — never reuses the prior (potentially higher-intensity)
  program; same regenerate-only path as PROGRESS/ADJUST, so a stale
  high-workload program can never resurface silently for a cycle the
  assessment explicitly flagged as needing reduced load.
- **REBUILD** — same path; a rebuilt phase's new strategic emphasis
  requires a fresh plan regardless, never a copy of the pre-rebuild
  program.

No AI output is ever auto-persisted (§8 of the master task — canonical
grounding, `validateExerciseIds`/`validateAiPlanExerciseEquipment`, and
the existing Save-requires-review UI are all completely untouched).

## Nutrition — chosen scope

- NutritionGoal-for-next-cycle: **NO ISSUE, live-verify only** (§9).
- NutritionProgram.sourceGoalId: **NO ISSUE, live-verify only** (§10).
- Stale meal-plan UX: **NO ISSUE, already fully implemented** — verify
  live, do not build.
- Nutrition adherence → CycleAssessment: audited or (§23) —
  **CONNECTED**. `NutritionMealCompletion` rows feed
  `computeNutritionConsistencyScore` (`cycle-metrics.engine.ts:256-295`)
  → `CycleMetricsResult.nutritionConsistencyScore` →
  `nutrition-decision.engine.ts`'s `nutritionAdherence` input (line 140),
  which genuinely gates the decision (lines 240/257 — a real
  `minAdherenceForAdjustment` threshold check, not a dead parameter).
  No fix needed; documented with evidence in the gaps-equivalent section
  of the implementation report.

## No schema change

Confirmed nothing here requires a migration: readiness is fully derived
from existing `TrainingCycle`/`WorkoutSchedule`/`CycleAssessment.decision`
rows; nutrition versioning/traceability already has every field it
needs (`previousGoalId`, `sourceGoalId`, `trainingCycleId`).
