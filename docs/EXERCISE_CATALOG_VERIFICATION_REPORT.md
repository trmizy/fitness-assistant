# Exercise Catalog Verification Report

Date: 2026-09-09
Scope: `backend/services/fitness-service`
Status: `VERIFIED`

## 1. Isolated Test Database

Used the docker-compose test stack, not the dev database:

```text
docker compose -f docker-compose.test.yml --profile full down -v --remove-orphans
docker compose -f docker-compose.test.yml --profile full up -d postgres-test
```

Resolved service:

```text
container: gymcoach-test-postgres-test-1
image: postgres:15-alpine
host port: 55433 -> container 5432
database: gymcoach_fitness_test
status: healthy
```

Test URL:

```text
DATABASE_URL=postgresql://gymcoach_test:***@localhost:55433/gymcoach_fitness_test?schema=public
FITNESS_DATABASE_URL=<same>
NODE_ENV=test
FITNESS_DISABLE_REDIS=true
```

No dev DB copy, dump, or mutation was used.

## 2. Migration Status

Command:

```text
npx prisma migrate deploy
```

Result:

```text
PASS
53 migrations applied
20260909090000_fitness_roadmap_phase included
All migrations have been successfully applied.
```

Post-check:

```text
npx prisma migrate status
Result: Database schema is up to date!
```

## 3. Catalog Seed Setup

Command:

```text
pnpm --filter @gym-coach/fitness-service run test:catalog:setup
```

Result:

```text
PASS
```

Final validator metrics immediately after setup:

```text
exerciseCount                    1001
sourcedExerciseCount             1001
equipmentCount                   46
exerciseEquipmentLinkCount       1111
exerciseSourceCount              1027
exerciseAliasCount               145
exerciseMuscleLinkCount          2984
timeLoadCount                    3
missingMovementPatternCount      0
missingEquipmentLinkCount        0
duplicateEquipmentSlugs          0
duplicateExerciseSources         0
duplicateExerciseAliases         0
duplicateExerciseMuscleLinks     0
duplicateExerciseEquipmentLinks  0
orphanExerciseEquipmentLinks     0
invalidRequirementTypeCount      0
invalidMovementPatternCount      0
```

Importer convergence:

```text
newExerciseImporter run 1: Inserted 474
newExerciseImporter run 2: Inserted 13, Skipped/Duplicate 26
newExerciseImporter run 3: Inserted 0, Skipped/Duplicate 30
seed_logging_modes: updated 3 rows
```

Reported for product review, not a failed invariant:

```text
duplicateNormalizedNames = 7
band assisted pull up, dumbbell floor press, goblet squat,
incline dumbbell curl, spider curl, trap bar deadlift, zottman curl
```

Reason: the schema has no canonical `Exercise.slug` or unique normalized-name
constraint, and current source-backed variants must be reviewed by humans
before enforcing a uniqueness rule.

## 4. Independent Catalog Validation

Command:

```text
pnpm --filter @gym-coach/fitness-service run test:catalog:validate
```

Result:

```text
PASS
```

Observed after catalog tests had run:

```text
exerciseCount                    1001
sourcedExerciseCount             1001
equipmentCount                   46
exerciseEquipmentLinkCount       1112
exerciseSourceCount              1027
exerciseAliasCount               145
exerciseMuscleLinkCount          2984
timeLoadCount                    3
missingMovementPatternCount      0
missingEquipmentLinkCount        0
duplicateEquipmentSlugs          0
duplicateExerciseSources         0
duplicateExerciseAliases         0
duplicateExerciseMuscleLinks     0
duplicateExerciseEquipmentLinks  0
orphanExerciseEquipmentLinks     0
invalidRequirementTypeCount      0
invalidMovementPatternCount      0
```

The equipment-link count was `1112` after the test suite because a test-created
valid fixture link existed. The source-backed catalog invariants remained clean.

## 5. Catalog Test Suite

Command:

```text
pnpm --filter @gym-coach/fitness-service run test:catalog
```

Result:

```text
tests 43
pass 43
fail 0
skipped 0
todo 0
duration_ms 98761.0964
```

Covered files:

```text
src/__tests__/exercise-catalog-seed-parity.integration.test.ts
src/__tests__/catalog-quality-matrix.integration.test.ts
src/__tests__/exercise-substitution.test.ts
src/__tests__/equipment-data-integrity.test.ts
src/__tests__/movement-pattern.test.ts
```

Important confirmations:

```text
3 TIME_LOAD rows exist and paginate correctly
PUBLISHED excludes TIME_LOAD staging rows
equipment catalog has no generic-machine fallback leak
all ACTIVE equipment has mapped exercises
substitution respects movementPattern and equipment availability
every seeded catalog exercise has equipment links
every exercise in the final clean DB has movementPattern
seed parity test runs the full seed twice and remains idempotent
```

## 6. Regression

Build:

```text
pnpm --filter @gym-coach/fitness-service build
Result: PASS
```

Core engine baseline:

```text
npx tsx --test cycle-decision.engine.test.ts cycle-metrics.engine.test.ts
  nutrition-decision.engine.test.ts nutrition-goal-macro-validator.test.ts
  workout.validation.test.ts
Result: tests 128 / pass 128 / fail 0 / skipped 0 / todo 0
```

Roadmap regression, read-only with respect to this pass's scope:

```text
npx tsx --test src/__tests__/fitness-roadmap.service.integration.test.ts
Result: tests 37 / pass 37 / fail 0 / skipped 0 / todo 0
```

The roadmap test logs expected 401 warnings for optional user profile/InBody
HTTP fetches in the isolated test environment; the assertions passed.

## 7. Remaining Items

No blocker remains for the stated catalog seed parity scope.

Non-blocking follow-up:

```text
Review the 7 duplicateNormalizedNames and decide whether to introduce a real
business key such as Exercise.slug or a curated variant/duplicate policy.
```

