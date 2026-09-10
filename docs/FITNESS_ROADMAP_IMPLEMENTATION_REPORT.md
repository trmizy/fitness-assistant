# FitnessRoadmap + RoadmapPhase Implementation Report

Date: 2026-09-09
Scope: `backend/services/fitness-service`

## 1. Design Gate Completed Before Code

Design/audit document:

```text
docs/fitness-roadmap-phase-integration-plan.md
```

The design pass verified the current `TrainingCycle`, `NutritionGoal`,
`WorkoutProgram`, `WorkoutSchedule`, `NutritionProgram`, `CycleAssessment`, and
`RecommendationAudit` ownership boundaries before implementation.

The chosen model is:

```text
FitnessRoadmap 1 -> N RoadmapPhase
RoadmapPhase  1 -> N TrainingCycle
TrainingCycle 1 -> N WorkoutSchedule
TrainingCycle 1 -> N NutritionGoal versions
NutritionGoal 1 -> N NutritionProgram via sourceGoalId
```

Important invariant:

```text
FitnessRoadmap/RoadmapPhase is orchestration metadata only.
TrainingCycle, NutritionGoal, WorkoutProgram, WorkoutSchedule, NutritionProgram,
CycleAssessment, and RecommendationAudit remain the source of truth.
```

## 2. Data Model Implemented

Added Prisma enums:

```text
FitnessRoadmapStatus = DRAFT | ACTIVE | COMPLETED | CANCELLED | ARCHIVED
RoadmapCreatorRole   = CLIENT | PT | AI | SYSTEM
RoadmapPhaseType     = FAT_LOSS | DIET_BREAK | MAINTENANCE | LEAN_GAIN | MINI_CUT | RECOMPOSITION | PERFORMANCE | RECOVERY
RoadmapPhaseStatus   = PLANNED | ACTIVE | COMPLETED | CANCELLED | SKIPPED
```

Added models:

```text
FitnessRoadmap
RoadmapPhase
```

Extended `TrainingCycle`:

```text
roadmapPhaseId
sequenceInPhase
roadmapPhase relation
```

Migration:

```text
backend/services/fitness-service/prisma/migrations/20260909090000_fitness_roadmap_phase/migration.sql
```

Migration is additive:

```text
DROP = 0
TRUNCATE = 0
Existing rows are not backfilled or guessed into roadmaps.
```

Database safeguards added in SQL:

```text
one ACTIVE FitnessRoadmap per user
one ACTIVE RoadmapPhase per roadmap
one ACTIVE TrainingCycle per roadmap phase
unique sequenceInPhase inside a phase
```

## 3. Lifecycle Implemented

New service:

```text
backend/services/fitness-service/src/services/fitness-roadmap.service.ts
```

Supported lifecycle:

```text
create DRAFT roadmap with planned phases
add planned phase
activate roadmap
activate phase
create/reuse active TrainingCycle for active phase
advance roadmap after completed CycleAssessment
archive roadmap
read current roadmap projection
```

Concurrency/idempotency:

```text
Postgres advisory transaction lock per user during activate/advance
idempotencyKey on roadmap create
activation reuses an existing active cycle when possible
legacy active cycles are not silently re-parented into roadmap phases
archive blocks when a roadmap still has an active phase or active TrainingCycle
plannedEndAt alone does not complete a phase unless transitionRules explicitly allow it
partial unique indexes enforce single-active invariants
```

Transition behavior:

```text
PENDING/REJECTED/INSUFFICIENT_DATA assessment -> block advancement
REBUILD decision -> block for future roadmap rebuild flow
DELOAD decision -> creates next cycle with recovery role metadata
objective.maxCycles / objective.completed / phase end date -> phase completion
no next planned phase -> roadmap completed
```

## 4. API Implemented

New authenticated route mount:

```text
/fitness-roadmaps
```

Routes:

```text
POST /fitness-roadmaps
GET  /fitness-roadmaps/current
GET  /fitness-roadmaps/:roadmapId
POST /fitness-roadmaps/:roadmapId/phases
POST /fitness-roadmaps/:roadmapId/activate
POST /fitness-roadmaps/:roadmapId/phases/:phaseId/activate
POST /fitness-roadmaps/:roadmapId/advance
POST /fitness-roadmaps/:roadmapId/archive
```

Files:

```text
backend/services/fitness-service/src/models/fitness-roadmap.models.ts
backend/services/fitness-service/src/controllers/fitness-roadmap.controller.ts
backend/services/fitness-service/src/routes/fitness-roadmap.routes.ts
backend/services/fitness-service/src/app.ts
```

## 5. Workout Integration Implemented

Updated:

```text
backend/services/fitness-service/src/services/workout.service.ts
```

Behavior:

```text
Manual program schedule creation now attaches new WorkoutSchedule rows to the existing ACTIVE TrainingCycle.
AI plan import now attaches new WorkoutSchedule rows to the existing ACTIVE TrainingCycle.
Non-agent manual/import paths do not create a TrainingCycle by themselves.
Agent plan apply keeps its existing behavior: create/reuse active cycle, then assign schedules.
```

This closes the main duplication gap found during audit:

```text
Roadmap progress derives from TrainingCycle -> WorkoutSchedule,
instead of RoadmapPhase storing or duplicating WorkoutProgram data.
```

## 6. Explicit Non-Changes

Not changed in this pass:

```text
NutritionGoal versioning remains owned by nutrition/training-cycle apply flows.
NutritionProgram remains linked through sourceGoalId.
CycleAssessment remains the only review/accept/reject lifecycle.
WorkoutProgram remains the workout prescription source of truth.
AI service is not called to generate roadmaps.
Frontend is not changed.
No destructive migration or data backfill.
No git commit.
```

## 7. Verification

Superseded by a full real-database verification pass — see
`docs/FITNESS_ROADMAP_VERIFICATION_REPORT.md` (Status: `VERIFIED`) for the
authoritative, evidence-backed results. Summary:

```text
Docker test stack (docker-compose.test.yml, postgres-test service, host
  port 55433 — NOT the dev Postgres on 5433) started and confirmed healthy.
prisma migrate deploy against gymcoach_fitness_test (55433): PASS
prisma migrate status: clean (53/53 applied)
Real PostgreSQL catalog inspection: all 4 enums, both new tables, both new
  TrainingCycle columns, both FKs, and all 4 required partial unique
  indexes confirmed present with the exact expected WHERE clauses.
Roadmap integration suite: 17/17 PASS, 0 fail, 0 skipped, 0 todo
  (grew from 13 to 17 tests: +1 regression test for a real containment-
  check ordering bug found and fixed during this pass, +1 test closing DB
  constraint scenarios 4-7, +2 full-lifecycle/concurrency E2E tests)
Full category-1 regression (97 files, real DB): 697 tests, 693 pass, 0 fail
Pure baseline regression (5 engine/util files): 128/128 PASS, no drop
Fitness-service build (tsc --noEmit): PASS
```

One real bug was found and fixed by this pass's integration testing:
`activatePhaseInTransaction` checked the "roadmap must be ACTIVE" business
rule before checking that the given `phaseId` actually belongs to
`roadmapId`, so a mismatched roadmapId/phaseId pair against a non-ACTIVE
roadmap returned a misleading `409` instead of the correct `404`. Fixed by
reordering the two checks; covered by a new regression test. See the
verification report §5 for detail.

New test file (grew from 13 to 17 tests across this and the prior pass):

```text
backend/services/fitness-service/src/__tests__/fitness-roadmap.service.integration.test.ts
```

New read-only preflight script (see verification report §16):

```text
backend/services/fitness-service/src/scripts/checkDuplicateActiveCycles.ts
```

## 8. Remaining Work

```text
Add roadmap rebuild behavior for CycleAssessment.decision = REBUILD.
Add richer RoadmapPhase transition rules if product needs configurable thresholds beyond objective.maxCycles/date/completed.
Add frontend views after API contract is accepted.
Optionally add AI draft generation later as a draft-only producer, never as source of truth.
```

Non-blocking, pre-existing, out-of-scope gaps noted during this pass (do not
affect the `VERIFIED` status above — see verification report §15 for
evidence): `catalog-quality-matrix.integration.test.ts`,
`exercise-substitution.test.ts`, `equipment-data-integrity.test.ts`, and
`movement-pattern.test.ts` require the real dev-seeded exercise catalog,
which the isolated docker-compose test stack does not seed by design; this
is already documented in `docker/test/README.md` and is unrelated to the
roadmap feature.
