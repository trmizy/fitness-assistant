# FitnessRoadmap REBUILD Design

Date: 2026-09-09
Scope: `backend/services/fitness-service`
Status: Design gate before code (Phase A, STEP 2)

## 1. What Already Exists (audited before writing this)

- `CycleAssessment.decision` is produced by fitness-service's own deterministic
  Decision Engine (`cycle-decision.engine.ts`), never by AI. `ai-service`'s
  `/assess-cycle` only explains an already-computed decision — it cannot
  change it. This is unchanged by this pass.
- `evaluateRoadmapTransition` already maps `decision === "REBUILD"` to a
  `REBUILD_REMAINING_ROADMAP` transition, and `advanceRoadmap` already
  records a `RecommendationAudit` row for it — but then just `return`s
  (no-op). The roadmap is left with its current phase still `ACTIVE` and no
  active cycle. This is the gap this pass closes.
- `RoadmapPhase.status` state machine (from
  `docs/fitness-roadmap-phase-integration-plan.md`) already legally allows
  `PLANNED -> SKIPPED` and `ACTIVE -> COMPLETED`. No new transition is
  needed for rebuild.
- `RecommendationAudit` already has a real `assessmentId` column (not just
  JSON), used today by `advanceRoadmap`. That is enough to make rebuild
  idempotent without any new schema field.

## 2. Decision: No Schema Change

Rejected options and why:

- A new `RoadmapPhase.supersededReason`/`supersededByPhaseId` column: not
  needed. `SKIPPED` already means "this planned phase will not happen,"
  which is exactly rebuild's effect on the remaining future phases. Adding a
  parallel "why" enum would duplicate what `RecommendationAudit.reasonCodes`
  + `metricsSnapshot` already records for every other roadmap transition.
- A new `rebuildGeneration` counter: not needed. Ordering/lineage is fully
  reconstructable from `phaseIndex` (monotonically increasing, never reused)
  plus the `RecommendationAudit` row's `metricsSnapshot` (records exactly
  which phase IDs were skipped and which were created, and by which
  `assessmentId`).
- A new `CANCELLED` use for rebuild-superseded phases: rejected per the
  task's own instruction — `CANCELLED` is reserved for `ACTIVE -> CANCELLED`
  today and has no established "system superseded this" meaning yet.
  `SKIPPED` (already legal from `PLANNED`) is the correct, pre-existing fit.

**Decision**: rebuild is implemented entirely with existing columns/enums:
`RoadmapPhase.status` transitions (`PLANNED -> SKIPPED`, `ACTIVE ->
COMPLETED`, plus the ordinary `PLANNED -> ACTIVE` phase activation already
used everywhere else), fresh `RoadmapPhase` rows with new `phaseIndex`
values, and one new `RecommendationAudit.decision` value:
`ROADMAP_REBUILD_APPLIED`. Zero migration.

## 3. Rebuild Semantics

**Preview** (`prepareRoadmapRebuild`, read-only):

1. Find the roadmap's `ACTIVE` phase.
2. Find that phase's most recent `COMPLETED`/`ANALYZED` `TrainingCycle` (the
   one that was just evaluated) — require no `ACTIVE` cycle exists in the
   phase (a rebuild only makes sense once a cycle has actually finished).
3. Find that cycle's latest `COMPLETED` `CycleAssessment`. Require
   `decision === "REBUILD"` and that it does not already require review
   (pending/rejected training or nutrition decisions still block rebuild,
   same rule `advanceRoadmap` already applies before ever reaching the
   REBUILD branch).
4. Require no existing `RecommendationAudit` with
   `decision = "ROADMAP_REBUILD_APPLIED"` for this `assessmentId` (otherwise
   this rebuild was already applied — return that fact instead of a new
   proposal).
5. Compute a **default deterministic proposal** (no AI, no PT needed):
   - Insert one `RECOVERY` phase starting now (rebuild moment), duration 14
     days, `objective.maxCycles = 1`.
   - Then re-append every currently-`PLANNED` phase after the active one, in
     original `phaseIndex` order, **unchanged** (same name/type/objective/
     constraints/transitionRules), each chained to start immediately after
     the previous one ends, keeping each phase's *original duration*
     (`plannedEndAt - plannedStartAt`) but shifted to the new timeline.
   - This mirrors `DELOAD`'s existing "insert a recovery step, then resume
     the plan" pattern, just at the phase granularity instead of the cycle
     granularity — the smallest change consistent with the existing product
     logic already in the decision engine.
6. Return the proposal (`proposedPhases`) without writing anything. The
   caller (today: a direct API caller / future: AI draft generation or PT
   review — Phase B/E) may accept this default as-is, or later phases may
   supply an edited/AI-generated/PT-edited `phases` array instead.

**Apply** (`applyRoadmapRebuild`, transactional, advisory-locked):

1. Re-run steps 1–4 above **inside** the same `pg_advisory_xact_lock`
   transaction `activateRoadmap`/`advanceRoadmap`/`archiveRoadmap` already
   use (`fitness-roadmap:<userId>`), so a concurrent `advanceRoadmap`,
   another `applyRoadmapRebuild`, or an `archiveRoadmap` call fully
   serializes against this one (Postgres transaction + the same lock key —
   no new locking primitive).
2. Idempotency: if a `ROADMAP_REBUILD_APPLIED` audit already exists for the
   caller-supplied `assessmentId`, return the current projection unchanged
   — no second write. This is the same idempotency shape `advanceRoadmap`
   already uses for `existingActiveCycle`.
3. Mark the current phase `COMPLETED` (`actualEndAt = now`) — the same
   effect `COMPLETE_AND_ACTIVATE_NEXT_PHASE` already has on a phase, since a
   rebuild event means the current phase's remaining strategy is being
   superseded by new evidence, not merely continued.
4. Bulk-transition every currently-`PLANNED` phase with
   `phaseIndex > currentPhase.phaseIndex` to `SKIPPED` — the "remaining
   future roadmap" being replaced. Nothing is deleted; every skipped phase
   keeps its original id, dates, and any linked (necessarily zero, since it
   was never activated) `TrainingCycle` rows.
5. Create the proposed phases (`input.phases` if supplied and valid,
   otherwise the same default computed in step 5 of Preview, recomputed
   inside the transaction for correctness under concurrency) as new
   `RoadmapPhase` rows, `status = PLANNED`, with fresh `phaseIndex` values
   continuing from `max(phaseIndex) + 1` across the whole roadmap (so they
   never collide with a skipped or historical index).
6. Activate the first newly-created phase via the existing
   `activatePhaseInTransaction` helper — unchanged code, so it gets the same
   active-cycle reuse/legacy-cycle guards, the same
   `training_cycles_one_active_per_phase`/`training_cycles_one_active_per_user`
   protection, and the same `ACTIVATE_PHASE` audit row every other phase
   activation gets.
7. Write one `ROADMAP_REBUILD_APPLIED` `RecommendationAudit` row:
   `cycleId` = the cycle that triggered the rebuild, `assessmentId` = the
   triggering assessment, `metricsSnapshot` = `{ roadmapId, completedPhaseId,
   skippedPhaseIds, createdPhaseIds, newActivePhaseId }`.

**Deliberate non-requirement**: the new phases are **not** checked against
the date ranges of the just-skipped or already-completed phases via
`assertPhaseDatesDoNotOverlap`. That guard exists to keep *live planning*
unambiguous (`addPlannedPhase`); once a phase is `SKIPPED`/`COMPLETED` its
stored date window is historical record, not a live scheduling constraint —
per the plan doc, "phase progress is derived from linked TrainingCycle
rows," not from planned date windows. The new phases are still checked for
internal consistency (chained, non-overlapping with each other).

## 4. Critical Rule Preserved

Nothing above ever touches:

```text
COMPLETED phases other than the one being superseded (never mutated further)
completed/analyzed TrainingCycle rows (read-only)
WorkoutSchedule / WorkoutProgram rows (never touched)
NutritionGoal / NutritionProgram rows (never touched)
CycleAssessment rows (read-only)
RecommendationAudit rows (append-only)
```

`applyRoadmapRebuild` requires the current phase to be `ACTIVE` with **no**
active `TrainingCycle` in it (the pre-rebuild cycle must already be
`COMPLETED`/`ANALYZED`). If a corrupted/unexpected state is found (e.g. an
active cycle somehow still exists, or the phase is not `ACTIVE`), it throws
a `409` rather than guessing.

## 5. Service Boundary

```text
CycleAssessment (decision=REBUILD, already computed by the rule engine)
      ↓
fitnessRoadmapService.prepareRoadmapRebuild(userId, roadmapId)   [read-only, no lock]
      ↓  (proposal review — today: direct API caller; future: AI draft / PT edit)
fitnessRoadmapService.applyRoadmapRebuild(userId, roadmapId, { assessmentId, phases? })
      [prisma.$transaction + lockRoadmapUser, idempotent]
```

`phases` is optional and, if supplied, is validated with the same phase
schema `addPlannedPhase` already uses (minus `phaseIndex`, which the server
always assigns during rebuild). This makes the exact same `applyRoadmapRebuild`
call usable later by an AI-generated draft (Phase B) or a PT-edited proposal
(Phase E) without any further backend change — only the caller changes.

## 6. API

```text
POST /fitness-roadmaps/:roadmapId/rebuild/preview   -> prepareRoadmapRebuild (no body)
POST /fitness-roadmaps/:roadmapId/rebuild/apply      -> applyRoadmapRebuild ({ assessmentId, phases? })
```

Both use `req.user!.id` exclusively, matching every other roadmap route.
`assessmentId` is re-validated server-side against the active phase's
current cycle — a caller cannot apply a rebuild using an assessment that
does not belong to their own current phase/cycle (IDOR containment check,
same ordering-first pattern already fixed for `activatePhase`: containment
is checked before any business-state check).

## 7. Concurrency / Idempotency Reasoning

All four roadmap-mutating operations (`activateRoadmap`, `activatePhase`,
`advanceRoadmap`, `archiveRoadmap`, and now `applyRoadmapRebuild`) take the
same per-user advisory lock, so they fully serialize against each other for
one user. Given that:

- **Two concurrent `applyRoadmapRebuild` calls, same assessment**: the
  second one, after the first commits, finds the `ROADMAP_REBUILD_APPLIED`
  audit already present for that `assessmentId` and returns the existing
  projection — no duplicate phases/cycles.
- **Rebuild + advance race**: whichever transaction commits first
  determines what the second reads. If rebuild commits first, the second
  (`advanceRoadmap`) call finds an `ACTIVE` cycle in the (new) active phase
  and no-ops. If advance commits first, it just re-evaluates the same
  assessment (still `REBUILD`) and writes one more harmless audit row before
  rebuild proceeds normally — no cycle/phase duplication either way.
- **Rebuild + archive race**: `archiveRoadmap` requires no `ACTIVE` phase.
  Before a rebuild is applied, the roadmap already has an `ACTIVE` phase (the
  one about to be rebuilt), so archive is already blocked with the same 409
  it always was. After rebuild, the roadmap still has an `ACTIVE` phase (the
  new one), so archive stays blocked. The invariant "cannot archive with an
  active phase" is never bypassed by rebuild's own commit.

## 8. Test Plan (Phase A, STEP 4)

```text
prepareRoadmapRebuild returns a deterministic default proposal
prepareRoadmapRebuild returns "already applied" info once applied
applyRoadmapRebuild completes current phase, skips remaining PLANNED phases,
  creates+activates the new phases, preserves history
applyRoadmapRebuild is idempotent for the same assessmentId
applyRoadmapRebuild rejects an assessmentId from another user's/phase's cycle (IDOR)
applyRoadmapRebuild rejects when the current phase is not ACTIVE or has an ACTIVE cycle
two concurrent applyRoadmapRebuild calls for the same assessment -> exactly one rebuild applied
rebuild + advanceRoadmap race -> no duplicate active cycle/phase
rebuild + archiveRoadmap race -> archive stays blocked while a phase is ACTIVE
caller-supplied phases (simulating a future AI/PT proposal) are validated and applied instead of the default
```
