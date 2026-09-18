# Gymini Cross-System Fitness Journey Audit

Date: 2026-09-10
Scope: map the REAL current journey across services before writing any
integration code. Code is authoritative over prior reports. Every claim
below is either **CONFIRMED BY CODE** (file:line evidence) or flagged
**TO BE PROVEN BY LIVE TEST** where code reading alone cannot settle the
question — per the master task's own instruction not to assume
connectivity.

## Legend

- **SOT** = source of truth
- Evidence markers: `[CODE]` (read directly, cited), `[LIVE]` (to be
  confirmed by running the real flow — filled in during E2E execution,
  see the Implementation/E2E reports for the actual run).

---

## 1. Onboarding → Profile

```text
SERVICE       user-service
API           PUT /profile/me (+ onboarding-specific fields)
MODEL         UserProfile (age, gender, heightCm, currentWeight, goal,
              activityLevel, experienceLevel, preferredTrainingDays)
SOT           user-service owns demographic/current-profile context
INPUT         onboarding wizard form fields
OUTPUT        persisted UserProfile row
NEXT CONSUMER fitness-service (fetchUserProfile, internal call),
              nutrition-onboarding-bootstrap.service.ts trigger
AUTHZ         authMiddleware, self-only (userId from JWT)
IDEMPOTENCY   PUT/upsert semantics — repeat calls overwrite, no duplicate rows
FAILURE MODE  400 on invalid field; no partial-profile corruption observed in code
```
`[CODE]` `user-service/src/services/profile.service.ts` calls
`bootstrapNutritionForUser` (fitness-service internal endpoint) —
confirmed at grep: `profile.service.ts` is one of only 3 callers of
`bootstrapNutrition`. This means **onboarding completion is what
triggers the initial standing NutritionGoal**, independent of Roadmap.

## 2. InBody / Body Context

```text
SERVICE       user-service
API           POST /inbody (create), GET /inbody/:userId,
              GET /internal/inbody/:userId/latest?before= (Gap E, prior phase)
MODEL         InBodyEntry (date, dateOnly unique-per-day, weight,
              bodyFatPct nullable, muscleMass, visceralFat, bmr)
SOT           user-service; body-state measurements
INPUT         manual entry or InBody OCR extraction
OUTPUT        InBodyEntry row
NEXT CONSUMER fitness-diagnosis.engine.ts, fitness-roadmap-forecast.engine.ts,
              training-cycle.service.ts (startCycle baseline), cycle metrics
AUTHZ         self-only
IDEMPOTENCY   dateOnly unique constraint — one entry per calendar day (BR-07)
FAILURE MODE  fetchLatestInBodyOnOrBefore returns null on missing data
              (never a future entry — hardened Adaptive Roadmap Closure phase)
```
`[CODE]` Body-state quality hierarchy (recent InBody > stale InBody >
manual > visual > none) is implemented in
`fitness-roadmap-forecast.engine.ts`'s confidence-scoring
(`bodyFatSourceScore` ladder, prior phase's own verification report). Not
re-derived this phase — reused as documented.

## 3. Guided Fitness Diagnosis → AI Roadmap Draft

```text
SERVICE       fitness-service (diagnosis) + ai-service (draft)
API           POST /fitness-roadmaps/diagnosis, ai-service roadmap-draft endpoint
MODEL         (stateless diagnosis result) -> AI draft persisted nowhere
              until Save
SOT           fitness-diagnosis.engine.ts (deterministic), ai-service drafts
              phase sequence via roadmap-draft.service.ts
INPUT         profile + InBody + goal
OUTPUT        diagnosis result + proposed phase sequence
NEXT CONSUMER GuidedRoadmapWizard.tsx -> Save (DRAFT)
AUTHZ         self-only
IDEMPOTENCY   N/A (read-only compute until Save)
FAILURE MODE  ai-service unavailable -> TO BE PROVEN BY LIVE TEST (§32 failure injection)
```

## 4. Save DRAFT / Start ACTIVE (Roadmap lifecycle — already VERIFIED, unchanged)

```text
SERVICE       fitness-service
API           POST /fitness-roadmaps (save draft), POST /fitness-roadmaps/:id/start
MODEL         FitnessRoadmap (DRAFT/ACTIVE/COMPLETED/...), RoadmapPhase (PLANNED/ACTIVE/...)
SOT           fitness-roadmap.service.ts
OUTPUT        DRAFT: roadmap + PLANNED phases, 0 TrainingCycles.
              START: roadmap ACTIVE, exactly 1 ACTIVE phase, 1 ACTIVE TrainingCycle.
NEXT CONSUMER TrainingCycle (below)
AUTHZ         self-only, userId-scoped queries throughout
IDEMPOTENCY   advisory lock (lockRoadmapUser) serializes concurrent start/advance
```
Unchanged from the VERIFIED Roadmap phases — not re-litigated, only
re-confirmed live in §6-8 execution below.

## 5. RoadmapPhase activation → TrainingCycle — **`planId: null`, CONFIRMED**

```text
SERVICE       fitness-service
FUNCTION      activatePhaseInTransaction -> trainingCycleService.startCycle(
                userId, null, ...)   [CODE: fitness-roadmap.service.ts:228-230]
MODEL         TrainingCycle (planId nullable FK to WorkoutProgram)
SOT           training-cycle.service.ts
```
**CONFIRMED BY CODE**: every Roadmap-driven `startCycle` call passes
`planId: null` — a Roadmap-activated TrainingCycle NEVER automatically
receives a WorkoutProgram. This is the critical boundary the master task
names in §9.

## 6. TrainingCycle → Workout: the documented product answer

**No automatic/AI-triggered generation on cycle activation exists.**
Confirmed by exhaustive search: `prisma.workoutProgram.create` is called
from exactly one production function,
`workout.service.ts:createManualProgram` / its sibling
`importAiPlanToSchedule` — both require an **explicit user/PT/agent
action**:

```text
1. PT explicit assignment       coach.service.ts:createAndAssignPlan(ptUserId, clientUserId, ...)
2. Marketplace order commit     ai-service fitness.client.ts:commitPersonalizedPlan (order ACCEPTED)
3. AI Coach chat template apply agent-program.service.ts:apply -> workoutService.createManualProgram
4. Self-service AI Plan flow    frontend AIPlansPage.tsx: generateWorkoutPlan (async ai-service job)
                                 -> user reviews -> explicit "Save" ->
                                 planService.savePlanToWorkoutLog ->
                                 workout.service.ts:importAiPlanToSchedule
```
Path 4 is the one a self-service client with no PT actually uses. It is
reachable from the empty-state UI: `WorkoutLogPage.tsx` shows "Bạn chưa
có chương trình tập. Hãy tạo AI Plan..." with a button navigating to
`/client/plans` `[CODE: WorkoutLogPage.tsx:8007-8018]`.

Both `createManualProgram` (line 1699) and `importAiPlanToSchedule`
(line 2408) call the SAME `resolveScheduleTrainingCycleId(tx, userId,
{...})` helper `[CODE: workout.service.ts:53-116]`, which:
- reuses the currently-ACTIVE TrainingCycle if one exists (including a
  Roadmap-activated one with `planId: null` — it does not require
  `planId` to be set), and
- throws 409 if an active Roadmap phase exists but its TrainingCycle
  isn't ACTIVE yet (defends against scheduling into a phase that hasn't
  actually started).

**Verdict: the boundary is real and functional in code** — a Roadmap-
activated cycle IS discoverable and linkable by the AI-plan-save path.
Whether a first-time user actually finds and completes this 2-step flow
(Generate → Save) in the real browser is **TO BE PROVEN BY LIVE TEST**
(§39 main E2E).

## 7. AI Workout Grounding / Canonical Exercise validation

```text
FUNCTION      workout.service.ts:validateExerciseIds(ids, userId)
                -> exerciseReferenceResolver.validatePlanningExerciseIds
FUNCTION      workout.service.ts:validateAiPlanExerciseEquipment(userId, days)
                -> planEquipmentValidatorService.validate
CALLED FROM   createManualProgram, importAiPlanToSchedule (both save paths)
```
`[CODE]` Every exercise in a saved plan (manual or AI) is validated
against the real Exercise Catalog for existence + equipment compatibility
before persistence — this reuses the existing resolver/validator, no
second engine. **Not yet confirmed**: exact behavior on an unknown/
ambiguous AI-returned exercise id (§11) — TO BE PROVEN BY LIVE TEST /
targeted unit-level probe of `exerciseReferenceResolver`.

## 8. WorkoutProgram → WorkoutSchedule

```text
MODEL   WorkoutProgram (standing template: days, repeatWeeks — no
        trainingCycleId FK) -> WorkoutProgramDay -> WorkoutSchedule
        (trainingCycleId set via resolveScheduleTrainingCycleId,
        programDayId, date, workoutId nullable until logged)
SOT     workout.service.ts
```
**Open question, code alone cannot answer — TO BE PROVEN BY LIVE TEST**:
`WorkoutProgram` has no `trainingCycleId`; only `WorkoutSchedule` rows
do, generated once at save-time for a bounded window
(`durationWeeks`/`repeatWeeks` chosen by the user at Generate time). When
a Roadmap advances to TrainingCycle #2, does that program's existing
schedule already cover cycle #2's date range (if `repeatWeeks` was
chosen generously), or does the next cycle start with **zero**
scheduled workouts until the user explicitly regenerates? This is
exactly master task §29's "CRITICAL" question — see the Implementation/
Gaps report for the empirical answer.

## 9. Today Surface

```text
SURFACE   frontend/web WorkoutLogPage.tsx ("Nhật ký tập" tab)
SOT       currentProgram + today's WorkoutSchedule row
```
Confirmed empty-state exists and points to the real generation path
(§6). Whether a populated state correctly shows a Roadmap-cycle-linked
workout without requiring the user to understand Roadmap/Phase/Cycle
ids — TO BE PROVEN BY LIVE TEST (browser).

## 10. NutritionGoal — standing, versioned, NOT cycle-scoped by design

```text
MODEL   NutritionGoal: userId-scoped, status ACTIVE|SUPERSEDED, append-
        only chain (previousGoalId), trainingCycleId OPTIONAL cross-
        reference (not authoritative), triggeredBy ONBOARDING|MANUAL|
        AI_ADAPTIVE|PT [schema.prisma:459-508]
SOT     nutrition.service.ts (upsertGoal = MANUAL), nutrition-onboarding-
        bootstrap.service.ts (ONBOARDING), TrainingCycle accept-
        recommendation flow (AI_ADAPTIVE)
```
`[CODE]` Confirmed: Roadmap forecast NEVER appears as a `triggeredBy`
source — the master task's §20 concern ("no Roadmap forecast becomes the
actual NutritionGoal") does not reproduce; architecturally impossible by
the current triggeredBy enum. One ACTIVE goal per user is a `status`-
field convention, not (yet independently confirmed) a DB uniqueness
constraint — TO BE VERIFIED (relational-integrity pass, §41).

Known, already-documented gap (not discovered this phase): editing a
NutritionGoal does **not** automatically regenerate the NutritionProgram
— `nutrition.service.ts:248-254`'s own comment cites
`docs/audit/nutrition-ai-current-flow-audit.md` "câu 6" and confirms the
current mitigation is a read-only `planConsistency` warning surfaced to
the user, not auto-resync. Documented as a pre-existing, known, non-
blocking limitation (the UI does warn, it doesn't silently mismatch).

## 11. NutritionProgram — also standing, not cycle-scoped

```text
MODEL   NutritionProgram: sourceGoalId (traceability only, not SOT for
        macros — the program row snapshots its own macro targets),
        sourceType AI_PLAN|MANUAL, repeatEnabled (7-day menu repeats
        beyond endDate) [schema.prisma:1263-1293]
```
Like WorkoutProgram, has no `trainingCycleId` — by design, a meal plan
is not cycle-bounded. This means nutrition continuity across a Roadmap
advance is architecturally automatic (the standing goal/program simply
keeps applying) — **unlike** workout schedules, which are date-bounded.
This asymmetry is real and worth stating plainly in the gaps report
rather than assuming both subsystems behave the same way.

## 12. Cycle metrics / CycleAssessment input trace

```text
SOT     cycle-metrics.engine.ts computes from real WorkoutSchedule/
        WorkoutSet completion data + InBody + nutrition adherence
        aggregate (per prior-phase engine tests)
```
TO BE PROVEN BY LIVE TEST: does completing a REAL logged workout through
the API actually change `computedMetrics` on the next `evaluate` call,
or could `evaluate` run on a cycle with zero real executed workouts and
still produce a confident-looking decision? (§19, §26-27)

## 13. Roadmap advance / REBUILD downstream — already VERIFIED at the Roadmap-internal level

REBUILD's own correctness (original forecast immutable, completed
history preserved, SKIPPED future phases, rebuilt phases drive current
forecast) is VERIFIED from the prior closure phase — not re-litigated.
**New this phase**: does REBUILD's newly-created ACTIVE cycle get a
WorkoutProgram/NutritionGoal any differently than a normal advance? Code
inspection (`applyRoadmapRebuild`, not shown here) needs a targeted read
— TO BE COMPLETED (§31).

## 14. Authorization pattern (repeated, consistent)

Every service function inspected so far takes `userId` as an explicit
parameter derived from `req.user!.id` (JWT), and every Prisma query
scopes by that `userId` at the query level (`findFirst({ where: { ...,
userId } })`), not fetch-then-check. This is a consistent, repeatable
pattern across fitness-roadmap, training-cycle, and workout services —
not something this phase needs to re-architect. Live cross-user negative
tests still required (§34) to catch any one-off exception.

---

## Open questions carried into live E2E (do not assume answers)

1. §8/§29 — does WorkoutSchedule coverage survive into the next
   TrainingCycle, or does it silently run out?
2. §7/§11 — exact behavior on an AI-returned unknown/ambiguous exercise id.
3. §12/§19 — does CycleAssessment's computedMetrics actually reflect real
   logged execution data end-to-end?
4. §13/§31 — REBUILD's new active cycle's workout/nutrition readiness.
5. §32 — ai-service-unavailable failure-mode behavior for Roadmap draft
   and for AI workout generation.
6. §34 — live cross-user negative-path confirmation (code pattern is
   consistent, but not yet re-proven this phase for the Workout/
   Nutrition endpoints specifically).

These are resolved empirically in
`docs/GYMINI_CROSS_SYSTEM_INTEGRATION_GAPS.md` and the Implementation/
E2E reports, not asserted here.
