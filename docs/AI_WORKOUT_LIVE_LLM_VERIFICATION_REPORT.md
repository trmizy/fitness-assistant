# AI Workout Live LLM Verification Report

Date: 2026-09-10
Scope: `backend/services/ai-service`, `backend/services/fitness-service`
Status: `VERIFIED`

## 1. Runtime Used

Real local Ollama was used, not `mock`:

```text
LLM_PROVIDER=ollama
LLM_MODEL=llama3.2:3b
LLM_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text
DISABLE_AI_PLAN_EVIDENCE=true
DEBUG_AI_PLAN=true
```

Test databases:

```text
AI DB      gymcoach_ai_test      on isolated postgres-test port 55433
Fitness DB gymcoach_fitness_test on isolated postgres-test port 55433
Redis      redis-test            on port 56379
```

`fitness-coach-qwen2.5-1.5b:q4_K_M` was not installed locally and returned
Ollama HTTP 404. The stale default was corrected to `llama3.2:3b` in source
and dev examples so the default matches the model the test stack already
documents and can actually pull.

## 2. Live Suite Result

Command:

```text
npx tsx --test src/__tests__/plan-generation-equipment.integration.test.ts
```

Result:

```text
tests 3 / pass 3 / fail 0 / skipped 0 / todo 0
duration_ms 389793.3222
```

The suite runs the real path:

```text
conversationService.queuePlanGeneration
-> BullMQ/Redis test queue
-> ai.worker
-> fitness-service /internal/exercises/for-ai-plans
-> Ollama /api/chat
-> deterministic repair when needed
-> fitness-service /internal/exercises/validate-plan-equipment
-> for full-gym: POST /workouts/from-ai-plan
-> workoutService.importAiPlanToSchedule
-> strict exerciseReferenceResolver
-> WorkoutProgram / WorkoutProgramExercise persisted
```

## 3. Persona Evidence

Bodyweight persona:

```text
ownedEquipmentCount=2
equipmentFilteredCount=578
candidateCount=120
promptChars=5291
promptTokens=1667
completionTokens=210
llmDurationMs=80083
testDurationMs=84204.9306
result=PASS
```

Home-gym persona:

```text
ownedEquipmentCount=7
equipmentFilteredCount=262
candidateCount=120
promptChars=5253
promptTokens=1682
completionTokens=498
llmDurationMs=150955
testDurationMs=153667.2318
result=PASS
```

Commercial-gym persona:

```text
ownedEquipmentCount=45
equipmentFilteredCount=0
candidateCount=120
promptChars=5422
promptTokens=1681
completionTokens=481
llmDurationMs=144261
testDurationMs=144954.8132
persistenceDurationMs=136
result=PASS
```

Full-gym generated and persisted IDs matched exactly:

```text
generatedExerciseIds =
6fad19c0-25dc-45d0-9875-39641f6d8d35
cf38ec9d-a275-44d4-b181-87c0995a4346
a703ef3d-a2f6-4eb3-aac3-465a9c36f627
d22e379a-5d97-4a21-bbe9-91ff224b49d7
8c73cb4c-caa5-481b-918d-14788494ca83
cb51694d-10f8-47ef-af88-f12f5b59d177

persistedExerciseIds =
same six ids, same order
```

## 4. Grounding Verdict

Verified:

```text
generated IDs are subset of worker candidate allowlist
final generated plan passes real equipment validator
full-gym generated IDs persist unchanged into WorkoutProgramExercise.exerciseId
invalid/duplicate/short LLM output is repaired only from candidate catalog
no arbitrary insert, fuzzy fallback, or name-only replacement on explicit bad IDs
```

Observed limitation:

```text
llama3.2:3b local latency is high: 80s-151s for normal tests, 220s on one targeted full-gym rerun.
```

