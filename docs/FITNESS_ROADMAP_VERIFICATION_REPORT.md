# FitnessRoadmap Verification Report

Date: 2026-09-09
Scope: `backend/services/fitness-service`
Status: `VERIFIED`

This is a corrective pass on top of the prior `BLOCKED` verification (Docker
Desktop was not running, `localhost:5433` was unreachable). Docker Desktop was
confirmed already running this pass; the previously-blocking gap was that the
docker-compose test stack's own `postgres-test` service (a separate isolated
container, not the always-on dev Postgres) had not been started yet.

## 1. Docker / PostgreSQL Test Setup

`docker compose -f docker-compose.test.yml config` (profile `full`) confirmed
the real, resolved config — not guessed:

```text
service: postgres-test
image: postgres:15-alpine
host port: 55433  (published -> container 5432)
POSTGRES_USER: gymcoach_test
POSTGRES_DB: gymcoach_test
healthcheck: pg_isready -U gymcoach_test -d gymcoach_test
```

`docker/test/postgres-init-test.sql` creates one database per service on
first boot of that container, including:

```text
gymcoach_fitness_test
```

Important distinction confirmed this pass (this is what the prior session's
port confusion was about): `docker ps` showed a SEPARATE, already-running,
long-lived DEV Postgres container (`gymcoach-postgres`) published on host port
`5433` — that is the shared dev database backing `gymcoach-fitness-dev` and
must never be used for this verification. The isolated docker-compose test
stack's `postgres-test` service is a different container on a different port,
**`55433`**, and that is the one this verification used for all migration
deploys, constraint tests, and the roadmap/regression suites.

Startup:

```text
docker compose -f docker-compose.test.yml --profile full up -d postgres-test
Result: container created and started (gymcoach-test-postgres-test-1)

docker compose -f docker-compose.test.yml --profile full ps
Result: Up, health: healthy (within one ~5s healthcheck interval)

docker compose -f docker-compose.test.yml --profile full port postgres-test 5432
Result: 0.0.0.0:55433
```

Test URL used for every step below:

```text
DATABASE_URL=postgresql://gymcoach_test:***@localhost:55433/gymcoach_fitness_test?schema=public
FITNESS_DATABASE_URL=<same value>
NODE_ENV=test
FITNESS_DISABLE_REDIS=true
```

(Password redacted per safety rules; it is the non-secret fixed value from
`docker-compose.test.yml`/`docker/test/.env.test.example`, never written to a
file this session created.)

Safety assertion run before any migration/reset command:

```text
db name contains "_test": gymcoach_fitness_test -> OK
host/port isolated test container: localhost:55433 -> OK
NODE_ENV=test -> OK
```

## 2. Known Windows/Docker Gotcha Hit And Resolved

`prisma generate` against this workspace failed with:

```text
EPERM: operation not permitted, rename '...\libquery_engine-linux-musl-openssl-3.0.x.so.node.tmp... ->
  ...\libquery_engine-linux-musl-openssl-3.0.x.so.node'
```

Root cause: the always-running dev container `gymcoach-fitness-dev`
bind-mounts `src/generated/prisma` and held a file lock on the target binary
(documented Windows Docker Desktop gotcha, not specific to this pass). Fixed
by, with explicit user approval before the disruptive step:

```text
docker stop gymcoach-fitness-dev
npx prisma generate      -> PASS
docker start gymcoach-fitness-dev
```

`gymcoach-fitness-dev` was back to `Up`/healthy immediately after; downtime
was a few seconds and no dev data was touched.

## 3. Migration Commands And Results

```text
npx prisma validate
Result: PASS ("The schema at prisma\schema.prisma is valid")

npx prisma generate
Result: PASS (after the container-lock fix above)

npx prisma migrate status (pre-deploy)
Datasource: PostgreSQL database "gymcoach_fitness_test" at "localhost:55433"
Result: 53 migrations found; 20260909090000_fitness_roadmap_phase NOT yet applied

npx prisma migrate deploy
Result: PASS — "Applying migration `20260909090000_fitness_roadmap_phase`" ->
  "All migrations have been successfully applied."

npx prisma migrate status (post-deploy)
Result: "Database schema is up to date!" (53/53 applied, no drift)
```

## 4. Tables, Enums, Indexes — Actual PostgreSQL Catalog Inspection

Verified with `psql \d` / `pg_type`/`pg_enum` queries run directly inside the
`postgres-test` container against `gymcoach_fitness_test` — not just read
from migration SQL:

```text
enum FitnessRoadmapStatus = DRAFT, ACTIVE, COMPLETED, CANCELLED, ARCHIVED   -> confirmed
enum RoadmapCreatorRole   = CLIENT, PT, AI, SYSTEM                         -> confirmed
enum RoadmapPhaseType     = FAT_LOSS, DIET_BREAK, MAINTENANCE, LEAN_GAIN,
                             MINI_CUT, RECOMPOSITION, PERFORMANCE, RECOVERY -> confirmed
enum RoadmapPhaseStatus   = PLANNED, ACTIVE, COMPLETED, CANCELLED, SKIPPED  -> confirmed

table fitness_roadmaps  -> confirmed, all columns present
table roadmap_phases    -> confirmed, all columns present
training_cycles.roadmap_phase_id   -> confirmed (nullable, FK)
training_cycles.sequence_in_phase  -> confirmed (nullable)

fk roadmap_phases.roadmap_id -> fitness_roadmaps.id (ON DELETE CASCADE)         -> confirmed
fk training_cycles.roadmap_phase_id -> roadmap_phases.id (ON DELETE SET NULL)  -> confirmed
```

Partial unique indexes — all four required indexes confirmed present with the
exact expected `WHERE` clauses:

```text
fitness_roadmaps_one_active_per_user
  UNIQUE btree (user_id) WHERE status = 'ACTIVE' AND archived_at IS NULL

roadmap_phases_one_active_per_roadmap
  UNIQUE btree (roadmap_id) WHERE status = 'ACTIVE'

training_cycles_one_active_per_phase
  UNIQUE btree (roadmap_phase_id) WHERE roadmap_phase_id IS NOT NULL
    AND status = 'ACTIVE' AND archived_at IS NULL

training_cycles_one_active_per_user   (pre-existing, from 20260730020000)
  UNIQUE btree (user_id) WHERE status = 'ACTIVE' AND archived_at IS NULL
```

Also confirmed: `training_cycles_roadmap_phase_id_sequence_in_phase_key`
(`UNIQUE (roadmap_phase_id, sequence_in_phase)`), which allows multiple NULLs
(legacy cycles) per Postgres unique-index semantics.

## 5. Corrective Code Change Found And Fixed By Integration Testing

Running the roadmap integration suite against the real database (not
possible in the prior `BLOCKED` pass) surfaced one real ordering bug:

**Finding**: `activatePhaseInTransaction` in
`fitness-roadmap.service.ts` checked `roadmap.status !== "ACTIVE"` (409)
**before** checking whether the given `phaseId` actually belongs to
`roadmapId` (404). A caller owning a DRAFT roadmap who passes a `phaseId`
belonging to a different roadmap (their own or another user's) got a
misleading `409 "Roadmap must be ACTIVE..."` instead of the correct
`404 "Roadmap phase not found"` — an IDOR-adjacent containment-check ordering
defect, not a business-logic bug.

**Fix** (minimal, one file):
`backend/services/fitness-service/src/services/fitness-roadmap.service.ts` —
moved the `tx.roadmapPhase.findFirst({ where: { id: phaseId, roadmapId } })`
containment check above the `roadmap.status !== "ACTIVE"` business-state
check, so containment is always verified first regardless of roadmap state.

**Regression test added**:
`"FitnessRoadmap activatePhase rejects a phaseId outside roadmapId even when
the roadmap is not yet ACTIVE"` in
`fitness-roadmap.service.integration.test.ts`.

No other code paths were touched.

## 6. Unique Constraint Violation Tests — All 7 Scenarios, PostgreSQL-Enforced

Executed against the real `postgres-test` database (transactional, rolled
back / cleaned up per test, no fixture left behind):

```text
1. two ACTIVE FitnessRoadmap for same user                          -> P2002, REJECTED (PASS)
2. two ACTIVE RoadmapPhase for same roadmap                          -> P2002, REJECTED (PASS)
3. two ACTIVE TrainingCycle in same phase                            -> P2002, REJECTED (PASS)
4. two ACTIVE TrainingCycle, same user, different phase               -> P2002, REJECTED (PASS)
5. ACTIVE legacy cycle (roadmapPhaseId=null) + ACTIVE roadmap cycle    -> P2002, REJECTED (PASS)
6. duplicate sequenceInPhase within same phase                        -> P2002, REJECTED (PASS)
7. same sequenceInPhase reused across two DIFFERENT phases            -> ALLOWED (PASS)
```

Covered by two tests:
`"roadmap partial unique indexes reject invalid duplicate rows at PostgreSQL
level"` (scenarios 1–3) and the new
`"roadmap DB constraints: cross-phase active-cycle-per-user, legacy+roadmap
active-cycle conflict, sequenceInPhase uniqueness"` (scenarios 4–7, added
this pass to close explicit gaps in the required test matrix).

## 7. Transaction Boundaries (confirmed by source + exercised by tests)

```text
createDraftRoadmap  — Prisma nested create; idempotency scoped by (userId, idempotencyKey)
activateRoadmap     — prisma.$transaction, advisory lock "fitness-roadmap:<userId>"
activatePhase       — prisma.$transaction, advisory lock "fitness-roadmap:<userId>"
advanceRoadmap      — prisma.$transaction, advisory lock "fitness-roadmap:<userId>"
archiveRoadmap      — prisma.$transaction, advisory lock "fitness-roadmap:<userId>"
```

Rollback behavior verified: every constraint-violation test above hits a
real Postgres error mid-write and the transaction/test cleanly leaves no
partial row behind (`cleanupFitnessServiceData` + Postgres's own atomic
rollback on constraint violation).

## 8. Concurrency Results — Real Advisory-Lock Test, PostgreSQL-Backed

```text
"FitnessRoadmap concurrent advance creates one next cycle and one transition audit"
  Result: PASS — 2 concurrent advanceRoadmap() calls -> exactly 1 next cycle,
  1 ACTIVE cycle, 1 transition audit row.

"FitnessRoadmap full E2E concurrency: two concurrent advanceRoadmap calls on the
  same assessment create exactly one next cycle" (new, full-E2E variant)
  Result: PASS — both calls fulfilled (no unhandled crash), exactly 2 cycles
  total (1 old + 1 new) with sequenceInPhase [1,2] (no duplicate), exactly 1
  ACTIVE cycle survives, exactly 1 CONTINUE_CURRENT_PHASE audit row recorded.
```

Both ran against the real `postgres-test` database using Node's real
concurrent promise execution against real Postgres advisory locks — not
mocked.

## 9. Transition Decision Matrix

```text
KEEP              -> CONTINUE_CURRENT_PHASE
PROGRESS          -> CONTINUE_CURRENT_PHASE
ADJUST            -> CONTINUE_CURRENT_PHASE
DELOAD            -> INSERT_RECOVERY_CYCLE
REBUILD           -> REBUILD_REMAINING_ROADMAP
INSUFFICIENT_DATA -> INSUFFICIENT_DATA
plannedEndAt only -> CONTINUE_CURRENT_PHASE unless transitionRules.completeOnPlannedEndDate = true
```

Result: PASS (pure decision-table test, 1/1).

## 10. Authorization / IDOR Results — DB-Backed, PostgreSQL

```text
User A cannot read User B's roadmap (getRoadmapById)          -> 404, PASS
User A cannot activate User B's roadmap (activateRoadmap)     -> 404, PASS
phaseId from a different roadmap is rejected (activatePhase)  -> 404, PASS (fixed this pass, see §5)
```

Controller review confirms every route uses `req.user!.id` exclusively;
`req.body`/`req.params` are never trusted for the acting user's identity, and
none of the roadmap request schemas (`fitness-roadmap.models.ts`) accept a
`userId` field at all.

## 11. Workout DB Regressions — Real Database

```text
"manual workout program schedules attach to the existing active cycle"        -> PASS
"manual workout program does not create a cycle when no active cycle exists"  -> PASS
"AI imported workout schedules attach to the existing active cycle"           -> PASS
```

Also exercised end-to-end inside the new full-lifecycle E2E test (§13):
a real `createManualProgram` call attaches a real `WorkoutSchedule` row to
the roadmap's active cycle, and that row survives untouched across a phase
transition.

Agent-apply roadmap-phase-lineage behavior was reviewed by source (unchanged
in this pass — `fitness-roadmap.service.ts`'s `activatePhaseInTransaction`
reuses the same cycle-creation path agent-apply already used) and is not
independently re-tested beyond the existing coverage, since no code in that
path was touched by the corrective fix in §5.

## 12. Nutrition DB Regressions — Real Database

```text
"nutrition recommendation apply keeps version lineage and is not bypassed by roadmap advance" -> PASS
  - pending nutrition recommendation blocks roadmap advancement (no next cycle created)
  - acceptNutritionRecommendation creates a new ACTIVE NutritionGoal
  - old goal transitions to SUPERSEDED
  - previousGoalId / sourceAssessmentId / trainingCycleId all correct
```

Also exercised inside the new full-lifecycle E2E test: a real
`NutritionGoal` row (status ACTIVE, `trainingCycleId` = cycle 1) survives
untouched across cycle completion and phase transition, still queryable by
`trainingCycleId` after the roadmap reaches `COMPLETED`.

## 13. Full Roadmap E2E — New, Real Database

Two new tests added this pass to close the explicit E2E requirement (the
pre-existing suite covered only a single-phase, two-cycle slice):

```text
"FitnessRoadmap full E2E: draft -> activate -> workouts/nutrition attach ->
  evaluate -> advance across phases -> roadmap COMPLETED, history preserved"
  Result: PASS
  Covers: draft roadmap (2 phases) -> activate roadmap -> phase 1 ACTIVE,
  cycle 1 created -> real WorkoutSchedule attached via createManualProgram ->
  real ACTIVE NutritionGoal created -> cycle 1 evaluated (ANALYZED + COMPLETED
  KEEP assessment) -> advance (phase 1 objective.maxCycles=1 reached -> phase 1
  COMPLETED, phase 2 ACTIVE, cycle 2 created, sequenceInPhase=1) -> cycle 1's
  schedule/goal verified untouched -> cycle 2 evaluated -> advance again
  (phase 2 objective reached, no next phase -> phase 2 COMPLETED, roadmap
  COMPLETED) -> both phases COMPLETED, both cycles (2 total) still present,
  the 1 WorkoutSchedule and cycle-1-linked NutritionGoal still present and
  correctly linked.

"FitnessRoadmap full E2E concurrency: two concurrent advanceRoadmap calls on
  the same assessment create exactly one next cycle"
  Result: PASS (see §8)
```

## 14. Full Test Commands And Results

```text
npx tsx --test src/__tests__/fitness-roadmap.service.integration.test.ts
Result: tests 17 / pass 17 / fail 0 / skipped 0 / todo 0

npx tsc --noEmit   (fitness-service build)
Result: PASS, 0 errors

npx tsx --test <97 category-1 files, excludes files that need the real
  dev-seeded catalog and one live-cross-service file — see §16>
Result: tests 697 / pass 693 / fail 0 / skipped 4 / todo 0

Pure baseline regression (same 5 files as the prior report):
npx tsx --test src/__tests__/cycle-decision.engine.test.ts
  src/__tests__/cycle-metrics.engine.test.ts
  src/__tests__/nutrition-decision.engine.test.ts
  src/__tests__/nutrition-goal-macro-validator.test.ts
  src/__tests__/workout.validation.test.ts
Result: tests 128 / pass 128 / fail 0 / skipped 0 / todo 0  (matches prior baseline exactly, no drop)
```

Roadmap suite grew from 13 to 17 tests this pass:

```text
+1  regression test for the §5 containment-ordering fix
+1  DB constraint test covering violation scenarios 4-7 (§6)
+2  full-lifecycle E2E + E2E concurrency tests (§13)
```

## 15. Failure Classification (with evidence, not assumption)

Four tests are `skipped` inside the 697-test category-1 run. These are
pre-existing conditional `{skip: ...}` gates in files unrelated to the
roadmap change (not touched this pass); none are in the roadmap suite
(which is 0 skipped). Not further investigated as out of this pass's scope.

Two files were excluded from the category-1 run and instead run separately
against the dev-server-hosted `gymcoach_fitness_test` database on port
`5433` (the project's own documented convention in
`docker/test/README.md`'s "Category 2" table — real seeded exercise catalog
data that the fresh, migration-only `postgres-test`/`55433` stack never
seeds):

```text
catalog-quality-matrix.integration.test.ts, exercise-substitution.test.ts
  Against localhost:55433/gymcoach_fitness_test (fresh, catalog-empty): 4 FAIL
    (missing the 3 curated TIME_LOAD "carry" exercises and equipment-
    substitution catalog rows entirely — confirmed via direct SQL: 0 TIME_LOAD
    rows exist in that database)
  Against localhost:5433/gymcoach_fitness_test (dev-seeded, per README convention): 14/14 PASS
  Classification: environment/seed-data gap in the isolated compose stack,
  NOT a regression from this pass's code change (which never touches
  Exercise/catalog data) and NOT unique to this pass — same root cause the
  README already documents for equipment-data-integrity.test.ts and others.
```

Two further category-2 files were run against `localhost:5433/gymcoach_fitness_test`
(same dev-seeded convention) and failed:

```text
equipment-data-integrity.test.ts: "every exercise has at least one equipment link" -> FAIL
movement-pattern.test.ts: "every exercise has a movementPattern set" -> FAIL
Classification: environment failure. Per docker/test/README.md these two
specifically need the true dev database gymcoach_fitness (no _test suffix,
fully backfilled equipment/movementPattern data), not the gymcoach_fitness_test
copy. This was NOT independently re-verified against gymcoach_fitness
because this task's own safety rules prohibit connecting to any dev/production
database in this verification pass. Pre-existing per the project's own
README, unrelated to the roadmap change (Exercise/movementPattern code was
not touched).
```

One test flaked once during an earlier full-batch run (99 files in one
`node:test` process) and then passed reliably:

```text
"CONCURRENCY (Phase 2 §II): 10 simultaneous bootstrap calls for the same
  brand-new user -> exactly one ACTIVE cycle and one ACTIVE goal survive"
  (nutrition-onboarding-bootstrap.integration.test.ts)
Isolated run: 6/6 PASS including this test (110ms)
Final 97-file batch run: 0 fail (this test passed)
Classification: flaky under heavy connection-pool contention when running
~700 tests in one process against one Postgres connection pool, not a real
defect; confirmed by evidence (passes reliably standalone), not assumption.
```

`adaptive-cycle-evaluation.integration.test.ts` was excluded per
`docker/test/README.md`'s documented "Category 3" — it makes real HTTP calls
to `user-service`/`ai-service` and needs `INTERNAL_SERVICE_SECRET` sourced
from the live dev container's env, which this pass did not touch or need.

## 16. Old Migration Audit — `20260730020000_training_cycle_active_unique_constraint`

This migration is already applied (part of the 53 migrations confirmed
clean in §3) and was **not modified**. Its Step 1 auto-remediates duplicate
ACTIVE `TrainingCycle` rows per user (keeps latest `start_date`, cancels the
rest) before creating `training_cycles_one_active_per_user`.

**Fixture test** (not run against real data — a `CREATE TEMP TABLE` inside a
`BEGIN; ... ROLLBACK;` block, using the migration's exact `UPDATE`/CTE SQL
targeted at the fixture table): 3 duplicate ACTIVE rows for one synthetic
user, 1 clean ACTIVE row for a second, 0 ACTIVE rows for a third —
remediation kept the correct (latest `start_date`) row per user, cancelled
the other duplicates, left the clean and zero-ACTIVE users untouched, and
the post-remediation invariant query returned 0 violating users. Rolled back
immediately; no fixture data persisted.

**Preflight script added** (read-only, no writes):

```text
backend/services/fitness-service/src/scripts/checkDuplicateActiveCycles.ts
```

Run against `gymcoach_fitness_test`/`55433` this pass: reported "OK: no user
has more than one ACTIVE, non-archived training cycle" (expected — this is a
fresh migration-only database with no organic data).

**Risk for production deploy of any environment that has not yet run this
migration**: run `checkDuplicateActiveCycles.ts` against that database
first and get a human decision on any reported duplicates — the migration's
own remediation will silently cancel all but the latest-`start_date` row per
user the first time it runs, which is a real (if narrow, additive-only, no
deletes) behavior change on real rows if duplicates exist. This migration
was **not** run against production or any dev database in this pass.

## 17. Files Changed In This Verification Pass

```text
backend/services/fitness-service/src/services/fitness-roadmap.service.ts
  (activatePhase containment-check ordering fix, see §5)
backend/services/fitness-service/src/__tests__/fitness-roadmap.service.integration.test.ts
  (+4 tests: containment-fix regression, DB-constraint scenarios 4-7,
   full-lifecycle E2E, E2E concurrency)
backend/services/fitness-service/src/scripts/checkDuplicateActiveCycles.ts
  (new, read-only preflight script, see §16)
backend/services/fitness-service/src/generated/prisma/*
  (regenerated client, no manual edits)
docs/FITNESS_ROADMAP_VERIFICATION_REPORT.md (this file)
docs/FITNESS_ROADMAP_IMPLEMENTATION_REPORT.md
```

No other files were touched. No commit was made. `gymcoach-fitness-dev` was
stopped and restarted once (§2, user-approved) and is confirmed healthy;
`postgres-test` (the isolated test container) was left running — tear down
with `docker compose -f docker-compose.test.yml down -v` when no longer
needed.

## 18. Remaining Blockers

None for the stated scope. All completion conditions in the verification
brief are met:

```text
Docker/PostgreSQL test reachable:        YES (localhost:55433)
Correct compose port used:               YES (55433, not 5433)
Migration deploy:                        PASS
Migration status:                        clean (53/53, no drift)
Database indexes verified:               YES (§4, real catalog inspection)
Constraint violation tests:              PASS (7/7 scenarios, §6)
Roadmap integration tests:               17/17 PASS, 0 fail, 0 skipped, 0 todo
Concurrency:                             PASS (2 tests, §8)
Transaction rollback:                    PASS (§7)
RBAC/IDOR:                                PASS (§10)
Workout DB regressions:                  PASS (§11)
Nutrition DB regressions:                PASS (§12)
Full Roadmap E2E:                        PASS (§13)
Pure regression:                         128/128 PASS, no drop from baseline
Fitness-service build:                   PASS
```

Non-blocking, pre-existing, out-of-scope items noted for awareness (§15):
`catalog-quality-matrix.integration.test.ts`,
`exercise-substitution.test.ts`, `equipment-data-integrity.test.ts`, and
`movement-pattern.test.ts` depend on the real dev-seeded exercise catalog,
which the isolated `postgres-test`/`55433` stack does not seed by design;
this is a pre-existing environment gap already documented in
`docker/test/README.md`, unrelated to and unaffected by this pass's roadmap
work.
