# AI Workout Runtime Closure Final Report

Date: 2026-09-10
Scope: live AI workout generation, canonical exercise grounding, catalog
provenance, substitution, marketplace resolver checks
Status: `VERIFIED`

## 1. Changes Made

AI service:

```text
ai.worker.ts
  preserves fitness-service candidate metadata:
  movementPattern, mechanics, difficultyLevel, loggingMode,
  contraindications, equipmentRequirements, muscles

  compact prompt now includes:
  id|name|mv|mech|eq|mus|log|contra

  DEBUG_AI_PLAN telemetry now includes:
  candidateExerciseIds, promptCandidateExerciseIds

  DISABLE_AI_PLAN_EVIDENCE=true can isolate workout-generation verification

plan-generation-equipment.integration.test.ts
  uses isolated AI/Fitness test DBs
  starts a real fitness-service HTTP test server
  uses Redis test queue + real aiWorker
  runs real Ollama
  validates generated IDs are subset of candidate allowlist
  imports the full-gym plan to fitness-service and proves persisted IDs match
  cleans live-* test namespace before/after

llm.service.ts / .env.example / docker-compose.dev.yml
  default Ollama model corrected from missing stale tag to llama3.2:3b
```

Fitness service:

```text
startTestHttpServer.ts
  lightweight test HTTP entrypoint for live cross-service tests

seedTestExerciseCatalog.ts
  removes known stale fixture exercise namespaces only under test DB guard

fixture-owning integration tests
  now clean their created exercise rows
```

## 2. Live LLM Closure

Live AI workout suite:

```text
tests 3 / pass 3 / fail 0 / skipped 0 / todo 0
duration_ms 389793.3222
```

Verified equipment contexts:

```text
BODYWEIGHT/MINIMAL:
  ownedEquipmentCount=2, equipmentFilteredCount=578, PASS

DUMBBELL/HOME-GYM:
  ownedEquipmentCount=7, equipmentFilteredCount=262, PASS

FULL GYM:
  ownedEquipmentCount=45, equipmentFilteredCount=0, PASS
  generated IDs persisted exactly into WorkoutProgramExercise.exerciseId
```

Full-gym canonical persistence proof:

```text
generatedExerciseIds == persistedExerciseIds
count=6
persistenceDurationMs=136
```

## 3. Invalid Output Behavior

Verified by tests/source:

```text
explicit bad exerciseId -> rejected, no fallback to matching name
name-only public resolver -> must resolve exactly one visible row
custom/user scope row -> not visible in public scope
archived catalog exercise -> rejected before equipment validation
unavailable equipment -> validator violation, not silent substitute
substitution result ids -> real existing Exercise rows
LLM short/empty/duplicate output -> deterministic repair from candidate catalog only
```

No code path was found that inserts arbitrary exercises from LLM output.

## 4. Marketplace Resolver

Direct fitness-service public resolver check:

```text
valid canonical id + wrong display name -> mappable=true
missing canonical id + valid display name -> mappable=false (not_found)
empty day -> mappable=false
```

AI marketplace tests:

```text
tests 22 / pass 22 / fail 0
```

Important nuance:

```text
marketplace browse/filter fails open if fitness-service mappability check is unreachable.
adoptPlan performs defense-in-depth mappability check before applying.
```

## 5. Catalog Closure

Catalog setup/validate was repeated three times on isolated test DB.

Final invariant:

```text
exerciseCount=1001
sourcedExerciseCount=1001
timeLoadCount=3
missingMovementPatternCount=0
missingEquipmentLinkCount=0
orphanExerciseEquipmentLinks=0
invalidRequirementTypeCount=0
invalidMovementPatternCount=0
```

Catalog suite:

```text
tests 43 / pass 43 / fail 0
```

Grounding/substitution suite:

```text
tests 23 / pass 23 / fail 0
```

Resolver/security suite:

```text
tests 10 / pass 10 / fail 0
```

Coach/roadmap-adjacent suite:

```text
tests 59 / pass 59 / fail 0
```

Build:

```text
pnpm --filter @gym-coach/ai-service build      PASS
pnpm --filter @gym-coach/fitness-service build PASS
```

## 6. Remaining Notes

Not changed:

```text
Roadmap/Journey frontend
Roadmap lifecycle semantics
database schema
production/dev database contents
```

Known limitation:

```text
local llama3.2:3b latency is high for live generation.
```

Final verdict:

```text
VERIFIED
GROUNDING WORKSTREAM CLOSED
```

