# Exercise Catalog Provenance Audit

Date: 2026-09-10
Scope: `backend/services/fitness-service`
Status: `VERIFIED`

## 1. Initial Finding

After seeding the isolated test catalog, the first provenance audit found:

```text
exerciseCount=1089
sourcedExerciseCount=1001
nonSourceBacked=88
all 88 were PUBLISHED SYSTEM rows with ownerId=null
```

Classification by fixture namespace:

```text
exercise group fixture      26
undo fixture                16
reschedule fixture          16
template fixture            12
idempotency fixture          8
per-set fixture              4
duration schedule fixture    4
distance schedule fixture    2
```

Verdict:

```text
LEGIT TEST FIXTURE RESIDUE, not catalog source data.
```

Owning tests were fixed to clean their created exercises, and
`seedTestExerciseCatalog.ts` now removes known stale fixture namespaces only
under its existing test-DB safety guard.

## 2. Final Catalog Counts

Final validation after cleanup and reseed:

```text
exerciseCount=1001
sourcedExerciseCount=1001
equipmentCount=46
exerciseEquipmentLinkCount=1112
exerciseSourceCount=1027
exerciseAliasCount=145
exerciseMuscleLinkCount=2984
timeLoadCount=3
missingMovementPatternCount=0
missingEquipmentLinkCount=0
orphanExerciseEquipmentLinks=0
invalidRequirementTypeCount=0
invalidMovementPatternCount=0
duplicateExerciseAliases=0
duplicateExerciseMuscleLinks=0
duplicateExerciseEquipmentLinks=0
```

Final residue checks:

```text
non_source_system_exercises=0
live_user_equipment=0
live_programs=0
live_schedules=0
live_ai_workout_plans=0
```

## 3. Repeatability

Three catalog setup/validate cycles were run.

Cycle 1:

```text
setup PASS
validate PASS
counts stable at 1001 sourced exercises
```

Cycle 2:

```text
setup PASS
validate via localhost hit transient Prisma P1001
validate retry via 127.0.0.1 PASS against same port/database
```

Cycle 3:

```text
setup PASS
validate PASS
counts stable at 1001 sourced exercises
```

The localhost-only failure was classified as a Windows loopback/IPv6 transient:
the `postgres-test` container stayed healthy and `127.0.0.1:55433` immediately
passed against the same isolated database.

## 4. Catalog Test Result

Command:

```text
pnpm run test:catalog
```

Result:

```text
tests 43 / pass 43 / fail 0 / skipped 0 / todo 0
```

This covered catalog parity, quality matrix, substitution, equipment integrity,
movement patterns, TIME_LOAD rows, equipment links, orphan checks, requirement
types, and generic-machine exclusions.

## 5. Logging Mode

Verified current invariant:

```text
TIME_LOAD rows = Farmer Carry, Front Rack Carry, Suitcase Carry
count = 3
status = STAGING
status=PUBLISHED excludes all TIME_LOAD rows
```

The classifier is an explicit loaded-carry allowlist:

```text
exerciseName IN [Farmer Carry, Suitcase Carry, Front Rack Carry]
movementPattern = CARRY
loggingMode != TIME_LOAD
```

It does not classify every static or loaded hold as `TIME_LOAD`.

