# Exercise Catalog Parity Audit

Date: 2026-09-09
Scope: `backend/services/fitness-service`

This audit was written before implementation for the exercise catalog/test seed
parity pass. It intentionally does not modify the adaptive roadmap files.

## 1. Current Exercise Schema

Source of truth: `backend/services/fitness-service/prisma/schema.prisma`.

`Exercise` is stored in `exercises` and currently contains:

- Identity: `id` only. There is no canonical `slug` or unique normalized name.
- Legacy coarse taxonomy: `typeOfActivity`, `typeOfEquipment`, `bodyPart`, `type`.
- Legacy muscle metadata: `muscleGroupsActivated` string array.
- Richer additive catalog fields: `movementPattern`, `mechanics`,
  `contraindications`, `difficultyLevel`, `loggingMode`, `status`, `source`,
  `ownerId`, `archivedAt`.
- Relations: workout history/program relations, `ExerciseEquipment`,
  `ExerciseSource`, `ExerciseAlias`, `ExerciseMuscle`,
  `ExerciseReviewDecision`.

Important consequence: because `exerciseName` is not unique, a partially seeded
or legacy-populated DB cannot safely be topped up from `raw_exercises.json` by
name alone without a test-only reset or a stronger business key from
`ExerciseSource`.

## 2. Current Equipment Schema

`Equipment` is stored in `equipment`.

- Stable business key: `slug` unique.
- Display/metadata: `name`, `category`, `aliases`, `description`, `active`.
- Relations: `ExerciseEquipment`, `UserEquipment`.

The schema already supports BODYWEIGHT/no-equipment as a real equipment record:
`slug = "bodyweight"`, created by `prisma/seed_equipment.ts`.

## 3. Exercise-Equipment Relation

`ExerciseEquipment` is a normalized many-to-many table.

- Unique pair: `(exerciseId, equipmentId)`.
- `requirementType`: `REQUIRED | ALTERNATIVE | OPTIONAL`.
- `REQUIRED` means all required items must be owned.
- `ALTERNATIVE` means one item from the alternative group is enough.

The application uses this relation for equipment-aware availability and
substitution. The legacy `Exercise.typeOfEquipment` remains a coarse
compatibility field.

## 4. MovementPattern Representation

`Exercise.movementPattern` is nullable free text, but the authoritative runtime
taxonomy is the constant list in:

```text
backend/services/fitness-service/src/constants/movement-patterns.ts
```

Valid values include `HORIZONTAL_PUSH`, `VERTICAL_PULL`, `SQUAT`, `HINGE`,
`CARRY`, `CARDIO`, `MOBILITY`, and `OTHER`.

`data/catalog/taxonomy/ref_movement_patterns.csv` uses lowercase snake-case
source labels; `newExerciseImporter.ts` maps those to the uppercase runtime
taxonomy.

## 5. Muscle Metadata

There are two layers:

- Legacy `Exercise.muscleGroupsActivated`: string array, always expected to be
  non-empty for catalog exercises.
- Canonical `Muscle` and `ExerciseMuscle`: primary/secondary muscle mapping
  used by muscle-map/library APIs.

`Muscle` is seeded by migration
`20260819020000_add_exercise_muscle_provenance_schema` from the curated taxonomy.
`ExerciseMuscle` is populated later by
`src/importers/exerciseMuscleMappingImporter.ts` using `ExerciseSource`.

## 6. Exercise Type / Category Representation

The live schema keeps coarse Prisma enums:

- `ExerciseType`: `STRENGTH`, `CARDIO`, `MOBILITY`, `STRENGTH_CARDIO`,
  `STRENGTH_MOBILITY`.
- `EquipmentType`: `BODYWEIGHT`, `BARBELL`, `DUMBBELLS`, `KETTLEBELL`,
  `MACHINE`, `RESISTANCE_BAND`, `CABLE`, `MEDICINE_BALL`, `FOAM_ROLLER`.
- `BodyPart`: `UPPER_BODY`, `LOWER_BODY`, `CORE`, `FULL_BODY`.
- `MovementType`: `PUSH`, `PULL`, `HOLD`, `STRETCH`.

Richer curated catalog values live in CSV data and additive text columns rather
than new hard Prisma enums.

## 7. Substitution Logic

`exercise-substitution.service.ts` ranks candidates by:

- hard filter: `ExerciseEquipment` availability;
- dominant score: same `movementPattern`;
- secondary score: muscle overlap;
- additional score: known/equal `mechanics`, same `bodyPart`,
  `typeOfActivity`, and `type`.

`mechanicsKnownAndEqual(null, null)` deliberately returns false. Unknown
metadata is not treated as similarity.

Initial classification: the substitution failures are data dependency failures
when movement/equipment catalog seed is absent, not an engine bug.

## 8. Existing Production / Dev Seed Mechanism

Current package seed command:

```text
pnpm --filter @gym-coach/fitness-service db:seed
  -> prisma/seed_all.ts
```

At audit time, `seed_all.ts` orchestrated:

```text
prisma/seed_exercises_json.ts
prisma/seed_equipment.ts
prisma/seed_equipment_gap_exercises.ts
src/importers/freeExerciseDbProvenanceImporter.ts --report
src/importers/exerciseMuscleMappingImporter.ts --report
```

Additional authoritative importers/data exist but are not in the seed pipeline:

```text
prisma/seed_movement_patterns.ts
src/importers/exerciseLocalizationImporter.ts
src/importers/newExerciseImporter.ts
```

The three TIME_LOAD carry rows expected by catalog-quality tests are in:

```text
data/catalog/plans/gym_exercises.csv
  Farmer Carry
  Suitcase Carry
  Front Rack Carry
```

They are not in `prisma/raw_exercises.json`.

## 9. Existing Test Seed Mechanism

`docker-compose.test.yml` creates isolated Postgres on host port `55433`.
`scripts/prisma-test.mjs` runs migrations for service test databases, including
`gymcoach_fitness_test`.

It does not seed the fitness exercise/equipment catalog after migrations.

`docker/test/README.md` currently classifies several catalog suites as needing
the real dev-seeded database. That is the gap this pass must close.

## 10. Why Isolated Postgres-Test Lacks Required Data

Read-only catalog evidence from `localhost:55433/gymcoach_fitness_test` before
implementation:

```text
exercise_count             1306
equipment_count            46
exercise_equipment links   981
TIME_LOAD exercises        0
missing movementPattern    1297
missing equipment links    424
```

Root causes:

- Migrations run before seed. Migration
  `20260824090000_backfill_time_load_carry_exercises` cannot classify rows
  that are inserted later by seed/importers.
- `seed_all.ts` does not run `seed_movement_patterns.ts`.
- `seed_all.ts` does not run `newExerciseImporter.ts`, so curated rows such as
  `Farmer Carry`, `Suitcase Carry`, and `Front Rack Carry` are missing.
- `seed_all.ts` runs muscle mapping before any new curated rows would exist.
- `seed_exercises_json.ts` skips seeding when `Exercise.count >= raw count`.
  A contaminated or legacy test DB with too many rows but missing canonical
  rows is therefore not self-healing.

## 11. Tests And Data Dependencies

- `catalog-quality-matrix.integration.test.ts`: requires three curated
  `TIME_LOAD` carry rows with `status=STAGING`, `ExerciseSource` data license
  `original_curated`, no media license, and non-empty muscle data.
- `exercise-substitution.test.ts`: requires movement patterns, mechanics, and
  equipment links for common seed exercises such as `Dumbbell Bench Press`,
  `Wide-Grip Lat Pulldown`, `Pullups`, and `Seated Cable Rows`.
- `equipment-data-integrity.test.ts`: requires every catalog exercise to have
  at least one `ExerciseEquipment` link, valid equipment slugs, no duplicate
  relation rows, and no active equipment with zero exercises.
- `movement-pattern.test.ts`: requires every exercise to have a valid
  `movementPattern`.

## 12. Failure Classification

Current known catalog failures on isolated test DB are primarily:

- `TEST-SEED GAP`: authoritative catalog seed/import path is not run after
  migrations.
- `INVALID CATALOG DATA` inside the isolated DB: missing movement patterns,
  equipment links, and TIME_LOAD rows.
- Not a FitnessRoadmap regression.
- Not a substitution engine bug based on the source audit so far.

## 13. Proposed Smallest Correct Fix

1. Add a test-safe, deterministic catalog seed entrypoint with hard guards:
   `NODE_ENV=test` and database name/URL containing `_test`.
2. Reuse authoritative seed/import sources rather than dev DB dumps:
   `raw_exercises.json`, `seed_equipment.ts`,
   `seed_equipment_gap_exercises.ts`, `seed_movement_patterns.ts`,
   `exerciseLocalizationImporter.ts`, `newExerciseImporter.ts`,
   `exerciseMuscleMappingImporter.ts`.
3. Add a post-seed deterministic logging-mode correction for rows inserted
   after migrations, especially loaded carries:
   `type = HOLD AND typeOfEquipment != BODYWEIGHT -> TIME_LOAD`.
4. Ensure the muscle mapping pass runs after curated rows are created.
5. Add catalog validation/count script and seed idempotency tests.
6. Update Docker/test documentation and package scripts so developers can run:
   migrations -> seed test catalog -> catalog tests on `localhost:55433`.
7. Verify existing read-only exercise/equipment/muscle APIs are sufficient,
   and only add minimal endpoints if the current API misses a core read-only
   knowledge capability.
