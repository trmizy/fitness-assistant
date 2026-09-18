# Exercise Canonical Identity Policy

Date: 2026-09-10
Scope: `backend/services/fitness-service`

## 1. Canonical Identity

The only canonical exercise identity is:

```text
Exercise.id
```

Do not use `exerciseName`, localized names, aliases, source names, external ids,
movement pattern, equipment, or muscle mappings as a replacement identity.

Supporting identifiers are resolver inputs only:

```text
ExerciseSource(sourceName, externalId) -> Exercise.id
ExerciseAlias(language, aliasNormalized) -> Exercise.id
exerciseName exact-normalized match     -> Exercise.id only when unique
```

## 2. Automatic Persistence Rule

Automatic plan persistence may write `WorkoutProgramExercise.exerciseId` only
after a canonical resolution succeeds.

Allowed resolution order:

```text
1. explicit exerciseId
2. sourceName + externalId
3. alias
4. exact normalized exerciseName, only if unique
```

If an explicit `exerciseId` is present but invalid, archived, unpublished, or
not visible to the caller, the write must fail. It must not fallback to name
matching.

## 3. Visibility Rule

Planning writes may resolve:

```text
SYSTEM + PUBLISHED + archivedAt=null
USER_CUSTOM + ownerId=<caller> + archivedAt=null
```

Marketplace/public validation may resolve only:

```text
SYSTEM + PUBLISHED + archivedAt=null
```

Historical by-id rendering is a separate read concern and may continue resolving
older rows by FK even if an exercise is later deprecated.

## 4. Duplicate Policy

Duplicate exercise names are allowed in storage because catalog import can
distinguish variants, review states, equipment, source provenance, and future
human merge decisions. Duplicate names are not allowed as automatic persistence
identity.

Policy for duplicate normalized names:

```text
same canonical movement/equipment/source semantics -> candidate for merge
different equipment/movement/muscle semantics      -> keep as separate variants or review
published + staging duplicate                      -> published row remains selectable; staging row stays out of AI/user plans
```

No migration in this pass merges or deletes duplicate rows.

## 5. Current Ambiguities Found

Direct PostgreSQL audit on isolated `gymcoach_fitness_test` found seven
source-backed normalized duplicate-name groups:

```text
band assisted pull up
dumbbell floor press
goblet squat
incline dumbbell curl
spider curl
trap bar deadlift
zottman curl
```

Several are not safe blind merges because movement/equipment semantics differ,
for example `Goblet Squat` has kettlebell vs dumbbell equipment metadata, and
`Incline Dumbbell Curl` / `Spider Curl` differ on movement pattern.

## 6. AI Contract

AI workout generation must receive a bounded allowlist from fitness-service and
must return `exerciseId` values from that allowlist. Fitness-service is still the
final authority at apply time.

The LLM may produce display names and notes, but those fields are never identity.

## 7. Substitution Contract

Substitution remains canonical-ID based. Input is target `Exercise.id`, output is
replacement `Exercise.id`, and filtering/scoring uses the existing deterministic
equipment/movement/muscle engine.
