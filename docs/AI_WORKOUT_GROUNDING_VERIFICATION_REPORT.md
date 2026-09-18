# AI Workout Grounding Verification Report

Date: 2026-09-10
Scope: `backend/services/fitness-service`, `backend/services/ai-service`
Status: `VERIFIED_WITH_ONE_ENVIRONMENT_BLOCKED_LIVE_LLM_SUITE`

## 1. Database Target

All DB-backed fitness-service verification used the isolated docker-compose test
database:

```text
host: localhost
port: 55433
database: gymcoach_fitness_test
NODE_ENV=test
FITNESS_DISABLE_REDIS=true
```

No dev or production database was mutated.

Migration status:

```text
npx prisma migrate deploy
Result: PASS, 53 migrations found, no pending migrations
```

## 2. Catalog Evidence

Post-cleanup catalog metrics:

```text
exerciseCount: 1085
sourcedExerciseCount: 1001
equipmentCount: 46
exerciseEquipmentLinkCount: 1112
exerciseSourceCount: 1027
exerciseAliasCount: 145
exerciseMuscleLinkCount: 2984
timeLoadCount: 3
missingMovementPatternCount: 0
missingEquipmentLinkCount: 0
orphanExerciseEquipmentLinks: 0
duplicateExerciseSources: 0
duplicateExerciseAliases: 0
duplicateExerciseMuscleLinks: 0
duplicateExerciseEquipmentLinks: 0
invalidRequirementTypeCount: 0
invalidMovementPatternCount: 0
```

Test fixture leak closed:

```text
coach-it-ex* exercises after cleanup: 0
```

Duplicate normalized source-backed exercise names still present, intentionally
not merged:

```text
band assisted pull up
dumbbell floor press
goblet squat
incline dumbbell curl
spider curl
trap bar deadlift
zottman curl
```

## 3. Tests Added

```text
backend/services/fitness-service/src/__tests__/exercise-reference-resolver.integration.test.ts
backend/services/fitness-service/src/__tests__/ai-workout-grounding.integration.test.ts
backend/services/fitness-service/src/__tests__/logging-mode-classifier.test.ts
```

Extended:

```text
backend/services/fitness-service/src/__tests__/plan-equipment-validator.test.ts
backend/services/fitness-service/src/__tests__/coach.service.integration.test.ts
```

## 4. Grounding Assertions

Verified:

```text
explicit exerciseId resolves canonically even when name differs
invalid explicit exerciseId does not fallback to a valid name
name-only reference must be unique or fails as ambiguous
public scope cannot resolve USER_CUSTOM exercise
user scope can resolve caller-owned USER_CUSTOM exercise
AI plan import persists canonical Exercise.id
AI plan import rejects bad explicit exerciseId before writing WorkoutProgram
```

## 5. Equipment Assertions

Verified:

```text
REQUIRED requires all owned equipment
ALTERNATIVE passes with any owned alternative
OPTIONAL remains non-gating through existing rule engine
missing/archived/unpublished exercise ID fails before equipment check
no UserEquipment rows skip only granular equipment filtering, not ID validation
```

## 6. Commands Run

```text
pnpm --filter @gym-coach/fitness-service build
Result: PASS

pnpm --filter @gym-coach/ai-service build
Result: PASS

npx tsx --test src/__tests__/exercise-reference-resolver.integration.test.ts \
  src/__tests__/plan-equipment-validator.test.ts \
  src/__tests__/ai-workout-grounding.integration.test.ts \
  src/__tests__/logging-mode-classifier.test.ts
Result: tests 15 / pass 15 / fail 0

npx tsx --test src/__tests__/exercise-catalog-seed-parity.integration.test.ts
Result: tests 1 / pass 1 / fail 0

npx tsx --test src/__tests__/coach.service.integration.test.ts
Result: tests 7 / pass 7 / fail 0

npx tsx --test src/__tests__/catalog-quality-matrix.integration.test.ts \
  src/__tests__/exercise-substitution.test.ts \
  src/__tests__/equipment-filtering.integration.test.ts \
  src/__tests__/equipment-invariants.test.ts \
  src/__tests__/workout.validation.test.ts
Result: tests 62 / pass 62 / fail 0

npx tsx --test src/__tests__/fitness-roadmap.service.integration.test.ts
Result: tests 55 / pass 55 / fail 0

npx tsx --test src/__tests__/cycle-decision.engine.test.ts \
  src/__tests__/cycle-metrics.engine.test.ts \
  src/__tests__/nutrition-decision.engine.test.ts \
  src/__tests__/nutrition-goal-macro-validator.test.ts
Result: tests 92 / pass 92 / fail 0

AI service excluding live-LLM plan-generation-equipment.integration.test.ts:
Result: tests 356 / pass 352 / fail 0 / skipped 4
```

## 7. Environment-Blocked Live LLM Suite

Run separately:

```text
npx tsx --test src/__tests__/plan-generation-equipment.integration.test.ts
Result: tests 3 / pass 0 / fail 3
```

Failure classification:

```text
Environment/runtime dependency, not grounding regression.
All three generated WorkoutPlan rows failed with:
LLM unavailable: LLM call failed: Request failed with status code 404
```

The referenced local model was unavailable:

```text
fitness-coach-qwen2.5-1.5b:q4_K_M
```

## 8. Build Result

Both touched TypeScript services compile:

```text
fitness-service: PASS
ai-service: PASS
```

## 9. Remaining Blockers

None for deterministic canonical grounding and fitness-service persistence.

The only blocked check is the live real-LLM AI equipment generation suite, which
requires a reachable Ollama model matching the configured `LLM_MODEL`.
