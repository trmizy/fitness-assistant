# AI Workout Runtime Closure Audit

Date: 2026-09-10
Scope: `backend/services/ai-service`, `backend/services/fitness-service`

This audit was written before implementation changes for the live AI workout
runtime closure pass.

## Runtime Configuration

Configured provider resolution in source:

```text
backend/services/ai-service/src/services/llm.service.ts
LLM_PROVIDER = process.env.LLM_PROVIDER || "ollama"
LLM_MODEL    = process.env.LLM_MODEL || default by provider
ollama default in code = fitness-coach-qwen2.5-1.5b:q4_K_M
```

Dev compose still defaults AI containers to:

```text
LLM_PROVIDER=ollama
LLM_MODEL=fitness-coach-qwen2.5-1.5b:q4_K_M
LLM_BASE_URL=http://host.docker.internal:11434
```

Docker test documentation and `docker/test/.env.test.example` use the real
Ollama model:

```text
LLM_MODEL=llama3.2:3b
EMBEDDING_MODEL=nomic-embed-text
```

Local Ollama inventory observed this pass:

```text
nomic-embed-text:latest
llama3.2:3b
qwen2.5vl:3b
fitness-coach-strict:latest
```

`fitness-coach-qwen2.5-1.5b:q4_K_M` is not installed. A direct
`POST /api/chat` to local Ollama with that model returns HTTP 404. Therefore
the previous live suite failure is classified as:

```text
missing local model + stale dev/default model tag
not docker networking
not test mocking
not a canonical grounding regression
```

`llama3.2:3b` is reachable and returns from a real `/api/chat` request, but a
cold smoke call took about 67 seconds on this machine. Live workout generation
must keep the candidate prompt bounded.

## Candidate Payload Boundary

The architecture intentionally fetches a bounded candidate list:

```text
ai.worker.ts PLAN_EXERCISE_FETCH_LIMIT = 120
per-day prompt catalog limit = 8 exercises/day
test plan shape = 3 days * 4 exercises/day
```

Fitness-service currently returns rich candidate metadata from
`/internal/exercises/for-ai-plans`:

```text
movementPattern
mechanics
difficultyLevel
loggingMode
contraindications
equipmentRequirements[]
muscles[]
```

Implementation defect found before edits: `ai.worker.ts` maps the response
back to the legacy subset only (`id`, `exerciseName`, `bodyPart`,
`typeOfActivity`, `typeOfEquipment`, `muscleGroupsActivated`). That means the
compact live prompt path does not actually receive the newer
movement/equipment/contraindication metadata. This is an application wiring
defect, not a schema redesign need.

The intended fix is to preserve those returned metadata fields in the worker's
bounded in-memory allowlist and keep the prompt compact.

## Contraindication Boundary

Current behavior is:

```text
deterministic pre-filter: no
prompt guidance: partially intended, but metadata is currently dropped in worker mapping
post-generation validator: no dedicated contraindication validator
```

There is no safe deterministic injury-to-contraindication matcher established
for ambiguous free-text injuries in this pass. The correct boundary is to keep
contraindications as bounded metadata/guidance and document that medical safety
is not proven by deterministic filtering.

## Catalog Provenance Counts

After test catalog setup against isolated PostgreSQL:

```text
host=localhost
port=55433
database=gymcoach_fitness_test
exerciseCount=1089
sourcedExerciseCount=1001
nonSourceBacked=88
```

All 88 non-source-backed rows are `PUBLISHED SYSTEM` rows with null `ownerId`.
Querying ids/names classifies them as test fixture residue:

```text
exercise group fixture     26
undo fixture               16
reschedule fixture         16
template fixture           12
idempotency fixture         8
per-set fixture             4
duration schedule fixture   4
distance schedule fixture   2
```

Owning tests were found by namespace search:

```text
complete-schedule-exercise-duration.integration.test.ts
exercise-group.integration.test.ts
workout-idempotency.integration.test.ts
per-set-completion.integration.test.ts
reschedule-schedule.integration.test.ts
undo-complete-schedule-exercise.integration.test.ts
template.service.integration.test.ts
```

These should be cleaned at the test source and only in isolated test DBs.

## Duplicate Review Strategy

The seven duplicate normalized groups remain:

```text
band assisted pull up
dumbbell floor press
goblet squat
incline dumbbell curl
spider curl
trap bar deadlift
zottman curl
```

No blind merge, delete, migration, slug, or `canonicalExerciseId` should be
introduced in this pass. The review output should classify semantics and
selectability while preserving the invariant:

```text
automatic persistence uses Exercise.id
ambiguous name-only references fail
STAGING rows are not AI/public selectable
```

## DB Safety

DB-backed work in this pass must use:

```text
NODE_ENV=test
fitness DB: postgresql://...@localhost:55433/gymcoach_fitness_test?schema=public
ai DB:      postgresql://...@localhost:55433/gymcoach_ai_test?schema=public
```

No dev or production database mutation is permitted.
