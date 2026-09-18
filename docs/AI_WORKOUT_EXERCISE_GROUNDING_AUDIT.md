# AI Workout Exercise Grounding Audit

Date: 2026-09-10
Scope: `backend/services/fitness-service`, `backend/services/ai-service`

This is the design gate before implementation. Code is authoritative; prior
catalog reports were used only as context.

## 1. Current Exercise Identity Model

Authoritative production identity is `Exercise.id`.

Current supporting identity/provenance tables:

```text
ExerciseSource(exerciseId, sourceName, externalId)
ExerciseAlias(exerciseId, language, aliasNormalized)
ExerciseEquipment(exerciseId, equipmentId, requirementType)
ExerciseMuscle(exerciseId, muscleId, role)
```

There is no canonical `slug`, no `canonicalExerciseId`, and `exerciseName` is
not unique. Historical and planned workout references already point to
`Exercise.id` through `WorkoutExercise.exerciseId` and
`WorkoutProgramExercise.exerciseId`.

Visibility semantics found in source:

```text
General browse/search: PUBLISHED + SYSTEM only
User custom: USER_CUSTOM + ownerId + archivedAt=null
History by-id rendering: allowed to resolve older rows even if status changes
AI candidate pool: status=PUBLISHED
```

## 2. All WorkoutProgram Exercise Creation Paths

```text
Manual UI / PT assigned plan
  -> fitness-service createManualProgram()
  -> createManualProgramSchema requires exerciseId
  -> WorkoutProgramExercise.exerciseId

AI saved plan
  -> ai-service generated WorkoutPlan JSON
  -> POST /plans/:id/save-to-workout-log
  -> fitness-service importAiPlanToSchedule()
  -> WorkoutProgramExercise.exerciseId

Marketplace adoption
  -> ai-service marketplace adopt()
  -> fitness-service importAiPlanToSchedule()
  -> WorkoutProgramExercise.exerciseId

Personalized PT service accepted draft
  -> ai-service commitPersonalizedPlan()
  -> fitness-service internal /workouts/manual-program
  -> createManualProgram()
  -> WorkoutProgramExercise.exerciseId

Agent program apply
  -> fitness-service agentProgramService.apply()
  -> template daysJson parsed as createManualProgramSchema
  -> createManualProgram()
  -> WorkoutProgramExercise.exerciseId
```

All persistent `WorkoutProgramExercise` rows store IDs, but some paths still
derive those IDs from free-text names before insert.

## 3. All AI Workout Generation Paths

```text
AI worker generated workout plan
  fitness /internal/exercises/for-ai-plans -> bounded catalog
  prompt contains allowed exercise IDs
  validateWorkoutPlanInvariants() requires allowed IDs and per-day candidates
  plan-equipment-validator rechecks exact IDs
  ai-service stores JSON with exerciseId + display name

AI fallback/deterministic repair
  chooses from the same allowed per-day catalogs
  stores exerciseId + canonical display name

PT client-plan draft
  fitness candidate list -> LLM draft
  service drops exerciseIds outside allowed set
  draft only; actual persistence later goes through createManualProgram()

Agent program recommendation
  chooses from existing WorkoutProgramTemplate daysJson IDs
  fitness-service validates template IDs, status, equipment, contraindications
  apply path goes through createManualProgram()
```

The main AI worker already uses a bounded allowlist and ID invariant before
persisting the AI service `WorkoutPlan`. The weaker layer is fitness-service
apply/import validation.

## 4. Where Free-Text Exercise Names Are Accepted

`importAiPlanToSchedule()` accepts AI plan exercise `name` as legacy fallback.
The current resolver is local `findExerciseMatch()`, which does:

```text
normalized exact name
token subset / token overlap
substring contains
raw-name contains
```

Bug found: when an AI exercise contains an explicit `exerciseId` but the ID is
not found, the code falls back to name matching even though the comment says it
does not. That allows an invalid ID to be silently replaced by a name match.

`validateMarketplaceSchedules()` mirrors the same loose name matching, so
marketplace plans can be marked mappable even when they depend on ambiguous or
fuzzy names.

User-facing CSV/history import has a fuzzy preview matcher, but that path asks
for explicit user confirmation and does not create `WorkoutProgram` schedules.
That fuzzy user-confirmed discovery can remain separate from automatic AI
plan persistence.

## 5. Where ExerciseId Is Required

```text
createManualProgramSchema.days[].exercises[].exerciseId
manualProgramExerciseSchema.exerciseId
WorkoutProgramExercise.exerciseId FK
WorkoutExercise.exerciseId FK
ai-service PlanContent exerciseId
client personalized draft exerciseId
agent template daysJson exerciseId
```

`validateExerciseIds()` currently only checks that IDs exist. It does not
enforce status, archived state, custom ownership, equipment, or an allowlist.

## 6. Current Allowlist/Grounding Behavior

`/internal/exercises/for-ai-plans` currently:

```text
status=PUBLISHED
optional bodyPart/typeOfActivity/goal/equipment filters
granular UserEquipment filtering when rows exist
bounded limit, max 500, worker requests 120
shuffle before truncating to avoid alphabetical prefix bias
```

The AI worker then builds per-day catalogs capped at 8 candidates per day and
validates:

```text
exerciseId in allowedExercises
exerciseId in that day candidate list
no duplicate exercise per day
day/exercise counts
sets/reps/rest/order bounds
```

Gap: candidate payload still relies mostly on legacy
`muscleGroupsActivated`, `bodyPart`, `typeOfEquipment`, and does not expose
canonical `ExerciseMuscle`, equipment requirement details, movementPattern,
mechanics, difficulty, loggingMode, or contraindications.

## 7. Current Equipment Availability Behavior

Single rule engine: `equipment-availability.util.ts`.

```text
REQUIRED: all required equipment must be owned
ALTERNATIVE: at least one alternative must be owned
OPTIONAL: does not gate availability
zero links: available
```

AI candidate retrieval uses this rule when `UserEquipment` rows exist. If a
user has no granular equipment rows, it intentionally skips granular filtering
for backward compatibility.

Final plan equipment validator rechecks the exact generated plan IDs, but it
currently only checks equipment links. Missing/unpublished/archived/custom
exercise IDs can slip through as empty-link or unverified cases.

## 8. Current Substitution Behavior

Existing substitution service is already canonical-ID based:

```text
input Exercise.id
load target Exercise
bounded candidate pool by bodyPart or movementPattern
hard-filter by equipment availability
score by movementPattern, muscle overlap, mechanics, bodyPart, activity, type
return replacement Exercise.id
```

This should be reused. A second substitute ranking engine is not needed.

## 9. Current Contraindication/Injury Behavior

`Exercise.contraindications` exists. Agent program candidates already reject
templates when any selected exercise has contraindications and when profile
injury/safety flags suggest PT review.

AI workout candidate retrieval does not currently filter contraindications
against user injuries. The available injury data comes from user-service
profile in the AI worker context; deterministic matching is possible only for
literal/token restrictions already present in `Exercise.contraindications`.
This pass should preserve existing safety behavior and avoid inventing medical
diagnoses.

## 10. Duplicate-Exercise Identity Risk

Direct PostgreSQL catalog audit on `gymcoach_fitness_test` at `localhost:55433`
found seven normalized duplicate source-backed name groups:

```text
Band Assisted Pull Up
Dumbbell Floor Press
Goblet Squat
Incline Dumbbell Curl
Spider Curl
Trap Bar Deadlift
Zottman Curl
```

Representative finding:

```text
PUBLISHED free_exercise_db row + STAGING curated_vi_exercise_catalog row
same normalized name
sometimes same equipment/movement/muscles
sometimes conflicting movementPattern, typeOfEquipment, or primary muscles
```

Therefore automatic name resolution must treat duplicate normalized names and
duplicate aliases as ambiguous, not choose the first row by database order.

## 11. Proposed Canonical Identity Strategy

Use current schema; no migration for this phase.

Rules:

```text
1. Exercise.id is the only persisted identity.
2. Explicit exerciseId wins only if visible/allowed for the writing context.
3. Invalid explicit exerciseId is rejected; never fallback to name.
4. Legacy no-ID plans may use a strict resolver:
   valid ID > unique source key > unique exact alias > unique normalized name.
5. Ambiguous duplicate names/aliases/source keys are rejected.
6. No fuzzy matching in automatic AI persistence.
7. No implicit Exercise insert for AI output.
```

For new planned workout writes, allowed exercise rows are:

```text
SYSTEM + PUBLISHED + archivedAt=null
USER_CUSTOM + ownerId=userId + archivedAt=null
```

Marketplace/public mappability should use only public system rows.

## 12. Backward-Compatibility Strategy

Existing historical workout rows remain valid because their FK already points
to `Exercise.id`.

Compatibility retained:

```text
Legacy AI plan with no exerciseId can still resolve by unique exact name/alias.
Manual user-created custom exercises remain allowed by owner-scoped ID.
User-confirmed CSV import can keep fuzzy preview because the user chooses.
Existing by-id history rendering can still resolve archived/deprecated IDs.
```

Compatibility intentionally removed for automatic AI persistence:

```text
invalid ID -> name fallback
token/substring fuzzy automatic matching
silent first-row selection for duplicate names
implicit custom Exercise creation
```

## 13. Migration Requirement Or No-Migration Decision

No migration is required for this phase.

`ExerciseSource`, `ExerciseAlias`, `status`, `source`, `ownerId`, and
`archivedAt` are enough to build a deterministic resolver and preserve
history. A future additive migration for `canonicalExerciseId` or `slug` may be
useful after human review of duplicate groups, but forcing it now would risk
prematurely merging legitimate source variants.

## Data-Flow Diagram

```text
AI generated
  fitness candidate endpoint -> bounded allowlist IDs -> ai-service validation
  -> AI WorkoutPlan JSON -> fitness import resolver -> WorkoutProgram/Schedule

PT generated
  PT UI / personalized draft -> createManualProgramSchema IDs
  -> fitness ID visibility validation -> WorkoutProgram/Schedule

manual
  exercise search/detail/custom endpoint -> selected Exercise.id
  -> createManualProgram/createWorkout -> WorkoutProgram/WorkoutExercise

import
  history CSV preview -> fuzzy candidates for human confirmation
  -> confirmed existing ID or explicit custom create -> WorkoutExercise history

agent apply
  template IDs -> equipment/status/safety check -> createManualProgram
  -> WorkoutProgram/Schedule

substitution
  selected Exercise.id unavailable -> exercise-substitution.service
  -> equipment-compatible replacement Exercise.id
```

## Implementation Plan

1. Add a fitness-service strict exercise reference resolver using current
   schema and normalized-name logic from the duplicate detector.
2. Replace AI plan import and marketplace mappability name matching with the
   strict resolver.
3. Harden planned-write ID validation for `createManualProgram`,
   `addProgramExercise`, `updateProgramExercise`, and AI import.
4. Extend final plan equipment validation to reject unknown/unpublished/
   archived/foreign custom IDs before treating equipment links as valid.
5. Extend AI candidate response with bounded canonical fields already in DB:
   movementPattern, mechanics, difficultyLevel, loggingMode, contraindications,
   equipment requirement slugs, and primary/secondary muscles.
6. Harden `seed_logging_modes.ts` so future TIME_LOAD derivation is carry-based
   rather than every loaded hold.
7. Fix fixture cleanup around catalog tests so reseed/test runs preserve the
   exercise-equipment link baseline.
8. Add PostgreSQL-backed tests for resolver, AI import persistence, equipment
   semantics, substitution, logging mode, and roadmap regression.
