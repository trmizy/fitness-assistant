# Exercise Catalog Implementation Report

Date: 2026-09-09
Scope: `backend/services/fitness-service`

## 1. Audit Gate

Audit completed before code:

```text
docs/EXERCISE_CATALOG_PARITY_AUDIT.md
```

The audit verified the current `Exercise`, `Equipment`, `ExerciseEquipment`,
`ExerciseSource`, `ExerciseAlias`, `ExerciseMuscle`, movement-pattern,
substitution, and seed ownership boundaries before implementation.

Key conclusion:

```text
The catalog test failures on isolated postgres-test were seed parity failures,
not FitnessRoadmap regressions and not substitution engine defects.
```

## 2. Seed Pipeline Implemented

Updated orchestrator:

```text
backend/services/fitness-service/prisma/seed_all.ts
```

The seed pipeline now runs, in order:

```text
prisma/seed_exercises_json.ts
prisma/seed_equipment.ts
prisma/seed_movement_patterns.ts
prisma/seed_equipment_gap_exercises.ts
src/importers/freeExerciseDbProvenanceImporter.ts --report
src/importers/exerciseLocalizationImporter.ts --report
src/importers/newExerciseImporter.ts --report   (repeat until Inserted: 0, max 6)
src/importers/exerciseMuscleMappingImporter.ts --report
prisma/seed_logging_modes.ts
```

Added deterministic post-seed correction:

```text
backend/services/fitness-service/prisma/seed_logging_modes.ts
```

Behavior:

```text
Loaded HOLD exercises with non-BODYWEIGHT equipment are corrected to loggingMode=TIME_LOAD.
This restores the 3 curated carry rows after seed/importers create them post-migration.
```

## 3. Test-Only Entrypoints

Added guarded test seed entrypoint:

```text
backend/services/fitness-service/src/scripts/seedTestExerciseCatalog.ts
```

Safety guards:

```text
NODE_ENV must be test.
DATABASE_URL/FITNESS_DATABASE_URL must point to a test database.
Allowed signals include _test, postgres-test, or localhost:55433.
The script refuses gymcoach_fitness unless the URL also contains _test.
```

Added validation script:

```text
backend/services/fitness-service/src/scripts/validateExerciseCatalog.ts
```

The validator checks:

```text
source-backed exercise count
equipment count
equipment links
source records
alias records
muscle links
TIME_LOAD rows
missing movementPattern on source-backed catalog exercises
missing equipment links on source-backed catalog exercises
duplicate equipment slugs
duplicate source external ids
duplicate aliases
duplicate muscle links
duplicate equipment links
orphan equipment links
invalid requirementType
invalid movementPattern
```

`duplicateNormalizedNames` are reported but not failed because `Exercise` has
no canonical slug/unique normalized business key and several current rows are
intentional published/staging or source variants that require product review.

## 4. Data Fixes

Updated:

```text
backend/services/fitness-service/prisma/seed_equipment_gap_exercises.ts
```

Behavior:

```text
Curated gap exercises now always receive deterministic equipment links and
equipment_gap_seed provenance, even when the exercise row already exists.
```

Updated:

```text
backend/services/fitness-service/prisma/seed_movement_patterns.ts
```

Behavior:

```text
Movement-pattern seeding uses updateMany guarded by id + movementPattern=null,
so concurrent transient test fixtures cannot cause a P2025 failure.
```

Updated:

```text
backend/services/fitness-service/src/importers/freeExerciseDbProvenanceImporter.ts
```

Behavior:

```text
The importer no longer attaches free_exercise_db provenance to an already
source-backed non-free exercise with the same name. This prevents duplicate
source external ids when curated variants share names with raw catalog rows.
```

## 5. Test Updates

Added:

```text
backend/services/fitness-service/src/__tests__/exercise-catalog-seed-parity.integration.test.ts
```

Coverage:

```text
seed can run repeatedly on isolated postgres-test
source-backed exercise count remains stable
equipment/source/alias/muscle/equipment-link counts do not grow on reseed
TIME_LOAD rows exist
no source-backed catalog exercise misses movementPattern or equipment links
no duplicate source/alias/muscle/equipment links
no orphan equipment links
no invalid requirementType or movementPattern
```

Updated:

```text
backend/services/fitness-service/src/__tests__/equipment-data-integrity.test.ts
```

The first assertion now targets source-backed catalog exercises instead of all
transient test fixtures:

```text
sources: { some: {} }, equipmentLinks: { none: {} }
```

This preserves the catalog invariant without failing on unrelated per-test
fixture exercises that are intentionally not part of the seeded catalog.

## 6. Scripts And Docker Test Flow

Added package scripts:

```text
pnpm --filter @gym-coach/fitness-service run test:catalog:setup
pnpm --filter @gym-coach/fitness-service run test:catalog:validate
pnpm --filter @gym-coach/fitness-service run test:catalog
```

Updated:

```text
docker/test/run-tests.sh
docker/test/README.md
```

Full docker test now runs catalog setup after fitness-service migrations.
The README no longer classifies the core catalog suites as requiring the dev DB.

## 7. Non-Changes

Not changed in this pass:

```text
FitnessRoadmap service/controller/routes/models/tests
WorkoutProgram lifecycle
TrainingCycle lifecycle
NutritionGoal lifecycle
Exercise substitution ranking logic
frontend
dev or production database
database migrations
git commit
```

