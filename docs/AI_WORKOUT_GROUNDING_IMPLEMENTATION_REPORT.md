# AI Workout Grounding Implementation Report

Date: 2026-09-10
Scope: `backend/services/fitness-service`, `backend/services/ai-service`

## 1. Design Gate

Completed before code:

```text
docs/AI_WORKOUT_EXERCISE_GROUNDING_AUDIT.md
docs/EXERCISE_CANONICAL_IDENTITY_POLICY.md
```

Decision:

```text
Exercise.id remains the only canonical workout exercise identity.
Fitness-service resolves and validates IDs at apply time.
AI-service may suggest only IDs from a bounded fitness-service allowlist.
```

No schema or migration was added.

## 2. Canonical Resolver

Added:

```text
backend/services/fitness-service/src/services/exercise-reference-resolver.service.ts
```

Resolution order:

```text
explicit exerciseId
sourceName + externalId
alias
exact normalized exerciseName, only if unique
```

Important behavior:

```text
invalid explicit exerciseId -> not_found, no fallback to name
ambiguous name/alias/source -> ambiguous, no automatic choice
public scope -> SYSTEM + PUBLISHED only
user scope   -> SYSTEM + PUBLISHED plus caller-owned USER_CUSTOM
```

## 3. Workout Persistence

Updated:

```text
backend/services/fitness-service/src/services/workout.service.ts
```

Changes:

```text
createWorkout/updateWorkout/addSet/completeScheduleExercise validate visible planning IDs
createManualProgram validates visible planning IDs
add/update program exercise validates visible planning IDs
importAiPlanToSchedule uses strict resolver instead of loose fuzzy matching
validateMarketplaceSchedules uses the same strict public resolver
AI import rechecks final exact exercise IDs with planEquipmentValidatorService
```

Bug fixed:

```text
Before: invalid exerciseId from AI could fallback to name matching.
After: invalid explicit exerciseId fails the import.
```

## 4. Equipment Validation

Updated:

```text
backend/services/fitness-service/src/services/plan-equipment-validator.service.ts
```

Changes:

```text
exercise identity/visibility is validated before equipment availability
missing/unpublished/archived/foreign custom IDs return valid=false
no UserEquipment rows still skip only granular equipment filtering, not ID validation
equipment rule remains REQUIRED all owned, ALTERNATIVE any owned, OPTIONAL ignored
```

## 5. AI Allowlist Metadata

Updated:

```text
backend/services/fitness-service/src/controllers/internal.controller.ts
backend/services/ai-service/src/schemas/plan.schemas.ts
```

The internal AI candidate endpoint now returns richer structured metadata:

```text
movementPattern
mechanics
difficultyLevel
loggingMode
contraindications
equipmentRequirements[]
muscles[]
```

The AI prompt includes those fields in each allowed exercise line while keeping
the original hard rule:

```text
Use only exerciseId values from the catalog above. Never invent or guess an exerciseId.
```

## 6. Logging Mode Hardening

Updated:

```text
backend/services/fitness-service/prisma/seed_logging_modes.ts
backend/services/fitness-service/src/utils/logging-mode-classifier.ts
```

Changed loaded-carry classification from broad:

```text
type=HOLD + non-bodyweight equipment
```

to explicit curated carry allowlist:

```text
Farmer Carry
Suitcase Carry
Front Rack Carry
movementPattern=CARRY
```

This prevents unrelated loaded isometrics from being silently classified as
`TIME_LOAD`.

## 7. Test Cleanup

Updated:

```text
backend/services/fitness-service/src/__tests__/coach.service.integration.test.ts
```

The test now cleans its own `coach-it-ex-*` exercise namespace and related
program/schedule rows. This removed stale test pollution from the isolated
catalog DB.

## 8. Explicit Non-Changes

Not changed:

```text
No Exercise schema change
No canonicalExerciseId/slug column
No migration
No duplicate merge/delete
No second substitution engine
No frontend changes
No Roadmap service/frontend changes for this task
No dev/prod DB mutation
No git commit
```
