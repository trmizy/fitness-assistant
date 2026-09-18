# FitnessRoadmap + RoadmapPhase Integration Plan

Date: 2026-09-09
Scope: `backend/services/fitness-service`

This document is the design gate before schema/code changes. It is based on
current source inspection, not on old roadmap wording alone.

## 1. Current Models And Lifecycle

### Verified current state

- `NutritionGoal` is versioned by `status = ACTIVE | SUPERSEDED`, with
  `trainingCycleId`, `previousGoalId`, and `sourceAssessmentId`.
- `WorkoutProgram` is the workout prescription. It has `status`,
  `archivedAt`, `version`, `sourcePlanId`, `sourceType`, and `aiPlanVersion`,
  but no direct cycle or phase relation.
- `WorkoutSchedule.trainingCycleId` is the current source of truth for which
  scheduled workout sessions count toward a `TrainingCycle`.
- `TrainingCycle` has `DRAFT | ACTIVE | COMPLETED | ANALYZED | CANCELLED`,
  plus `archivedAt`, `baselineMetrics`, `targetMetrics`, and `configuration`.
- `CycleAssessment` stores the training decision and the nutrition decision for
  the same evaluation event.
- `RecommendationAudit` is the audit trail for training and nutrition decisions.
- `NutritionProgram` has `sourceGoalId`, but no cycle or phase relation.
- Training recommendation accept/reject marks the assessment review state only.
- Nutrition recommendation accept/reject creates a new `NutritionGoal` version
  through the existing apply path.
- `createManualProgram`, agent apply, and AI import schedule workouts with
  different cycle-link behavior today. Agent apply ensures an active cycle and
  assigns `WorkoutSchedule.trainingCycleId`; plain manual/AI paths can create
  schedules without that link.
- Existing docs name the missing long-horizon concept as `TrainingBlockPlan` or
  "Training Block Sequence"; current code has no such model.

### Existing lifecycle boundaries

- `TrainingCycle` owns short-term baseline/target snapshots and evaluation.
- `WorkoutProgram` owns prescribed training structure.
- `WorkoutSchedule` owns dated sessions and their cycle membership.
- `NutritionGoal` owns the active macro prescription and version lineage.
- `NutritionProgram` owns concrete meals and item-level plan editing.
- `CycleAssessment` owns recommendation review state.
- `RecommendationAudit` owns decision/action audit.

## 2. Source-Of-Truth Matrix

| Data | Source of truth |
| --- | --- |
| Long-term body/fitness goal | `FitnessRoadmap` |
| Cut/bulk/diet-break/recomp strategy | `RoadmapPhase` |
| Short-term baseline and target | `TrainingCycle` |
| Workout prescription | `WorkoutProgram` |
| Session belongs to cycle | `WorkoutSchedule.trainingCycleId` |
| Active macro target | `NutritionGoal` where `status = ACTIVE` |
| Concrete meal plan | `NutritionProgram` |
| Adaptive decision | `CycleAssessment` |
| Decision audit | `RecommendationAudit` |

Rules:

- Do not duplicate editable calories/macros on Roadmap or Phase.
- Do not duplicate workout prescriptions on Roadmap or Phase.
- Do not create phase-level accept/reject state that competes with
  `CycleAssessment`.
- Phase progress is derived from linked `TrainingCycle` rows and their existing
  artifacts.
- `activatePhase` does not silently re-parent an existing legacy ACTIVE cycle
  (`roadmapPhaseId = null`). Legacy-cycle adoption needs a separate explicit
  command/audit trail.
- `plannedEndAt` alone does not complete a phase. A phase completes only when
  `objective.completed`, `objective.maxCycles`, or an explicit transition rule
  allows date-based completion.

## 3. New Data Model

### FitnessRoadmap

Long-horizon plan for one user.

Fields:

- `id`
- `userId`
- `name`
- `goalType`
- `status`: `DRAFT | ACTIVE | COMPLETED | CANCELLED | ARCHIVED`
- `plannedStartAt`
- `plannedEndAt`
- `actualStartAt`
- `actualEndAt`
- `createdByUserId`
- `createdByRole`: `CLIENT | PT | AI | SYSTEM`
- `sourceAssessmentId`
- `targetMetrics`
- `configuration`
- `version`
- `previousRoadmapId`
- `archivedAt`
- timestamps
- `phases`

### RoadmapPhase

Strategic body-composition/nutrition phase inside a roadmap. One phase may
contain many training cycles.

Fields:

- `id`
- `roadmapId`
- `phaseIndex`
- `name`
- `phaseType`:
  `FAT_LOSS | DIET_BREAK | MAINTENANCE | LEAN_GAIN | MINI_CUT |
  RECOMPOSITION | PERFORMANCE | RECOVERY`
- `status`: `PLANNED | ACTIVE | COMPLETED | CANCELLED | SKIPPED`
- `plannedStartAt`
- `plannedEndAt`
- `actualStartAt`
- `actualEndAt`
- `objective`
- `constraints`
- `transitionRules`
- timestamps
- `trainingCycles`

### TrainingCycle additions

Additive and nullable:

- `roadmapPhaseId String?`
- `sequenceInPhase Int?`
- `roadmapPhase RoadmapPhase?`

Constraints:

- Existing cycles keep `roadmapPhaseId = null`.
- Do not backfill guessed phase membership.
- `@@unique([roadmapPhaseId, sequenceInPhase])` is acceptable because Postgres
  allows multiple nulls and this prevents duplicate numbering inside a phase.
- Add index on `roadmapPhaseId`.

## 4. Roadmap State Machine

Allowed transitions:

- `DRAFT -> ACTIVE`
- `DRAFT -> ARCHIVED`
- `ACTIVE -> COMPLETED`
- `ACTIVE -> CANCELLED`
- `ACTIVE -> ARCHIVED`

Archive rule:

- A roadmap with an ACTIVE phase or ACTIVE TrainingCycle is not archived by the
  generic archive command. The caller must first close/cancel the active
  lifecycle explicitly through the existing TrainingCycle/phase paths.
- `COMPLETED -> ARCHIVED`
- `CANCELLED -> ARCHIVED`

Rules:

- At most one non-archived `ACTIVE` roadmap per user, enforced by partial unique
  index.
- Activating a roadmap activates exactly one first valid phase.
- Archiving is soft: set `archivedAt` and `status = ARCHIVED`; do not delete
  phases/cycles/history.

## 5. RoadmapPhase State Machine

Allowed transitions:

- `PLANNED -> ACTIVE`
- `PLANNED -> SKIPPED`
- `ACTIVE -> COMPLETED`
- `ACTIVE -> CANCELLED`
- `ACTIVE -> SKIPPED`

Rules:

- At most one `ACTIVE` phase per roadmap.
- A phase can contain multiple completed/analyzed cycles.
- At most one active cycle can be linked to a phase at a time, already covered
  globally by `training_cycles_one_active_per_user` and reinforced by a partial
  unique index for `roadmap_phase_id WHERE status='ACTIVE'`.
- `RoadmapPhaseType` is long-term strategy only. Training periodization labels
  such as accumulation, intensification, deload, realization stay in
  `TrainingCycle.configuration`, workout prescription, or existing training
  models.

## 6. Phase To TrainingCycle Relationship

Required shape:

```text
RoadmapPhase
  -> TrainingCycle 1 (sequenceInPhase = 1)
  -> TrainingCycle 2 (sequenceInPhase = 2)
  -> TrainingCycle 3 (sequenceInPhase = 3)
```

Not allowed:

- `RoadmapPhase.trainingCycleId`
- `RoadmapPhase.workoutProgramId`
- `RoadmapPhase.nutritionGoalId`
- `RoadmapPhase.nutritionProgramId`

Artifact resolution:

- Workout program: derive through phase cycles -> schedules -> program day ->
  workout program.
- Nutrition goal: derive from `NutritionGoal.trainingCycleId` for a cycle, or
  active goal for current user when no cycle-specific goal exists.
- Nutrition program: derive from `NutritionProgram.sourceGoalId`.
- Assessment/audit: derive from `CycleAssessment.cycleId` and
  `RecommendationAudit.cycleId`.

No cache pointer is introduced in this pass.

## 7. Transaction Boundary

Use fitness-service as the transaction owner because all new tables and the
existing cycle/workout/nutrition artifacts live in the same database.

Boundaries:

- `createDraftRoadmap`: single transaction for roadmap and initial phase rows.
- `activateRoadmap`: one transaction with user advisory lock; set roadmap
  active, choose first planned phase, activate phase, create/link cycle.
- `activatePhase`: one transaction with user advisory lock; verify roadmap and
  phase ownership, enforce one active phase, create or reuse one linked active
  cycle via the same baseline snapshot logic as `trainingCycleService.startCycle`.
- `advanceRoadmap`: one transaction with user advisory lock after reading the
  latest completed assessment; does not run LLM and does not create
  recommendations.

Important: where an existing service function has important logic, reuse it or
mirror it inside the same transaction only when required by Prisma transaction
boundaries. Do not reimplement baseline snapshot, nutrition macro validation,
or recommendation apply logic.

## 8. Idempotency And Concurrency

Concurrency:

- Use `pg_advisory_xact_lock(hashtextextended('fitness-roadmap:' || userId, 0))`
  for roadmap activation and advancement.
- Database partial unique indexes remain the final race protection.

Idempotency:

- `createDraftRoadmap` accepts optional `idempotencyKey` stored on
  `FitnessRoadmap`. Retry with the same user/key returns the existing row.
- `activateRoadmap` is idempotent: if the roadmap is already active and has an
  active phase/cycle, return the current projection.
- `activatePhase` is idempotent: if the phase is already active and has an
  active linked cycle, return that state.
- `advanceRoadmap` must not create a duplicate cycle under concurrent requests;
  sequence uniqueness and advisory lock enforce this.

## 9. API Contracts

Routes to add:

```http
POST /fitness-roadmaps
GET /fitness-roadmaps/current
GET /fitness-roadmaps/:roadmapId
POST /fitness-roadmaps/:roadmapId/phases
POST /fitness-roadmaps/:roadmapId/activate
POST /fitness-roadmaps/:roadmapId/phases/:phaseId/activate
POST /fitness-roadmaps/:roadmapId/advance
POST /fitness-roadmaps/:roadmapId/archive
```

Auth:

- User identity comes from auth middleware.
- Body `userId` is ignored for self-service routes.
- PT-client write routes are not added in this pass; `createdByRole = PT` is
  retained for future coach-service integration.

Response shape:

- Return a projection with roadmap, ordered phases, linked cycles, current
  active phase, current active cycle, derived workout program summaries,
  cycle-linked nutrition goals, matching nutrition programs, latest assessment,
  and progress.

## 10. Migration Strategy

- Add new enums/tables.
- Add nullable columns to `training_cycles`.
- Add indexes and partial unique indexes with raw SQL where Prisma cannot
  express `WHERE`.
- No destructive migration.
- No fake backfill.
- Rollback note: drop partial indexes, drop added relation columns, then drop new
  tables/enums only if no production data must be preserved. Do not rollback by
  deleting historical cycle data.

## 11. Backward Compatibility

- Existing TrainingCycle routes continue to work with `roadmapPhaseId = null`.
- Existing WorkoutProgram and NutritionProgram routes do not require a roadmap.
- Existing AI import/manual program calls are preserved; only cycle-link
  consistency is fixed when an active cycle exists.
- Existing CycleAssessment and RecommendationAudit remain authoritative.

## 12. Test Matrix

Schema/database:

- Two active roadmaps for one user are rejected.
- Two active phases in one roadmap are rejected.
- Duplicate `phaseIndex` is rejected.
- Multiple completed cycles in one phase are allowed.
- Only one active cycle in a phase is allowed.
- Legacy cycle with null `roadmapPhaseId` still works.

Service/API:

- Create draft roadmap.
- Retry create with idempotency key does not duplicate.
- Add planned phase validates user ownership and phase index.
- Activate roadmap activates first phase and creates one cycle.
- Retry activate does not duplicate.
- Activate phase creates next sequence in phase.
- Archive roadmap soft-archives without deleting history.
- Cross-user access is rejected.

Transition engine:

- `KEEP`, `PROGRESS`, `ADJUST`, `DELOAD`, `REBUILD`,
  `INSUFFICIENT_DATA`.
- Pending review blocks transition.
- Rejected recommendation blocks automatic phase transition.
- Objective reached completes or advances phase.
- Last phase completes roadmap.
- Concurrent advance cannot create two cycles.

Consistency:

- Manual program path links new schedules to active cycle when one exists.
- Agent apply keeps current behavior.
- AI import links new schedules to active cycle when one exists.
- Nutrition recommendation apply preserves `trainingCycleId`,
  `previousGoalId`, `sourceAssessmentId`, and ACTIVE/SUPERSEDED lifecycle.
- `NutritionProgram.sourceGoalId` resolves to the correct version.
- Active nutrition program based on a superseded goal reports mismatch.

## 13. Out Of Scope

- Frontend redesign.
- AI-generated roadmap planning.
- PT matching and payment.
- New nutrition program regeneration after a goal change.
- New phase-level recommendation accept/reject.
- Direct phase links on WorkoutProgram or NutritionProgram.
- New training periodization enum mixed into `RoadmapPhaseType`.

## 14. Remaining Risks

- Long-term objective completion requires product-specific thresholds; this pass
  implements deterministic orchestration, not new sports science.
- Existing manual/AI program replacement deletes incomplete schedules. The
  roadmap layer must not assume future planned schedules are immutable.
- NutritionGoal and NutritionProgram can still intentionally drift; this pass
  exposes consistency, not auto-regeneration.
- PT control over roadmaps needs explicit contract/RBAC design before enabling.

## Next Pass Roadmap

1. Fitness Diagnosis.
2. Roadmap Preview.
3. Phase timeline UI.
4. Current cycle position UI.
5. Accept/Edit/Ask PT.
6. Adaptive projection.
7. AI roadmap proposal based on the evidence registry.
