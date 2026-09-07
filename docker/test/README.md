# Docker Test Environment

This test stack is isolated from development and production. It uses separate container names, a separate Docker network, and test-only volumes.

## Fast Docker Test

Fast mode does not require real Ollama and does not fetch external research APIs.

```bash
pnpm docker:test:fast
```

It runs:

- workspace install from lockfile inside a Node test container
- Prisma client generation
- TypeScript/build checks
- unit tests
- AI service build
- research dry-run/eval without external fetch

## Full Docker Test

Full mode starts test Postgres, Redis, and Qdrant. It uses test databases only.

```bash
pnpm docker:test:full
```

By default, full mode uses `LLM_PROVIDER=mock`. It seeds Qdrant with a tiny deterministic test RAG corpus before running AI/RAG smoke and retrieval eval commands:

- `pnpm --filter @gym-coach/ai-service run ai:test:seed-rag`
- `pnpm --filter @gym-coach/ai-service run ai:test:rag`
- `pnpm --filter @gym-coach/ai-service run ai:eval:retrieval`

The seed creates the `exercises`, `fitness_knowledge`, `fitness_faq`, and `fitness_evidence` collections. It does not call crawler APIs.

To run against real Ollama, opt in explicitly:

```bash
USE_OLLAMA=true pnpm docker:test:full
```

This starts the `ollama` compose profile. It checks that `LLM_MODEL` and `EMBEDDING_MODEL` exist before seeding Qdrant. It does not download large models automatically. Pull required models yourself before expecting real Ollama checks to pass.

## Compose Directly

```bash
docker compose -f docker-compose.test.yml --profile fast up --abort-on-container-exit --exit-code-from test-runner-fast

docker compose -f docker-compose.test.yml --profile full up --abort-on-container-exit --exit-code-from test-runner-full
```

## Cleanup

```bash
pnpm docker:test:down
```

This removes test containers and test volumes.

## Logs

```bash
pnpm docker:test:logs
```

## Test Environment Variables

See `docker/test/.env.test.example` for the intended defaults. Important safety settings:

- `NODE_ENV=test`
- `ENABLE_RESEARCH_AUTOMATION=false`
- `DISABLE_EXTERNAL_RESEARCH_FETCH=true`
- `RESEARCH_REQUIRE_REVIEW_FOR_WEB=true`
- `DEBUG_RAG=false`
- test-only database URLs ending in `_test`

## Common Failures

- Docker not running: start Docker Desktop or the Docker daemon.
- Port conflict: test ports are `55433`, `56379`, `56333`, `56334`, and optional `51434`.
- Qdrant not healthy: inspect `docker compose -f docker-compose.test.yml logs qdrant-test`.
- Missing Ollama model: run full mode without `USE_OLLAMA=true`, or manually pull `llama3.2:3b` and `nomic-embed-text` in `ollama-test`. The runner prints exact pull commands when this happens.
- Missing Qdrant collection: full mode should self-seed test collections. If it still fails, run `pnpm --filter @gym-coach/ai-service run ai:test:seed-rag` inside the test runner container and inspect Qdrant logs.
- Prisma client stale: run `pnpm run prisma:generate` or use Docker test runner, which runs it before tests.
- Migration failure: verify test Postgres is healthy and database URLs point to `_test` databases.
- Windows CRLF warning: Git may warn that LF will be replaced by CRLF; this is not a test failure.
- pnpm store/cache issue: run `pnpm store prune` locally, or remove the `pnpm_store_test` Docker volume.

---

<a id="merged-test-environment-matrix"></a>

## Consolidated reference: TEST_ENVIRONMENT_MATRIX.md

> Consolidated 2026-09-07. Original dates, verification results and deployment
> snapshots below are historical; confirm them against current code/environment.

## Test Environment Matrix — fitness-service

> Written after this session repeatedly rediscovered the same environment
> confusion while running `fitness-service`'s test suite ad-hoc from the
> host (outside the project's own CI/container harness). No secret values
> are recorded here — only which variable each suite needs and where its
> real value lives (`.env`, or the running `gymcoach-fitness-dev`
> container's own environment).

### Why this file exists

`fitness-service`'s test suite is **not uniform** — different files assume
different databases and, for a few, different network reachability. Running
everything with one blanket environment produces confusing false
failures that look like real bugs but aren't. This session hit all three
categories below before root-causing each one (see
`docs/OPENGYM_GAP_IMPLEMENTATION_REPORT.md` "Known limitations" for the
full incident writeups) — this table exists so the next session doesn't
have to rediscover them.

### Category 1 — `_test` database (the default assumption)

Most `*.test.ts` / `*.integration.test.ts` files self-gate on
`process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL` matching
`/(_test|postgres-test)/i`, and skip (not fail) if it doesn't. Run with:

```bash
DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness_test?schema=public" \
  npx tsx --test src/__tests__/<file>.test.ts
```

Setting `FITNESS_DATABASE_URL` instead only works for the small number of
files that explicitly remap it to `DATABASE_URL` in their own top-level code
(grep the file for `FITNESS_DATABASE_URL` to check) — safest to just set
`DATABASE_URL` directly for everything in this category.

This is every file **except** the ones listed below.

### Category 2 — real seeded dev DB (`gymcoach_fitness`), not `_test`

These need the full seeded exercise/equipment/food catalog, which only
exists in the dev database — `gymcoach_fitness_test` was never seeded with
it (confirmed empty/inconsistent for this data, not a bug). Each file's own
header comment says so; found by grepping for "dev DB"/"inside the
fitness-service container":

| File | Why it needs dev DB |
|---|---|
| `equipment-data-integrity.test.ts` | Real equipment catalog + 874-exercise mapping, seeded only in dev |
| `movement-pattern.test.ts` | Real `movementPattern` backfill, seeded only in dev |
| `equipment-filtering.integration.test.ts` | Hits the **already-running dev server over real HTTP** (`localhost:3002`) — its own Prisma writes (`UserEquipment` rows) must land in the SAME database that live server reads, which is `gymcoach_fitness` (whatever `DATABASE_URL` the running `gymcoach-fitness-dev` container actually has) |
| `exercise-muscle-map.integration.test.ts` | Real `ExerciseMuscle`/`Muscle` taxonomy, seeded only in dev |
| `food-serving-metadata.integration.test.ts` | Real 13k+-row USDA food catalog, seeded only in dev |
| `food-library.integration.test.ts` | Product Completeness pass — Food Library browse/detail, same 13k+-row USDA catalog |
| `muscle-library.integration.test.ts` | Product Completeness pass — Muscle Library "related exercises", real `ExerciseMuscle`/`Muscle` taxonomy |
| `exercise-library-filters.integration.test.ts` | Product Completeness pass — difficulty/logging-mode filters, aliases/media-license enrichment, real seeded catalog |

Run with:

```bash
DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness?schema=public" \
  npx tsx --test src/__tests__/<file>.test.ts
```

**Never run these against `gymcoach_fitness_test`** — they will fail with
confusing catalog-invariant violations that look like real bugs (missing
equipment links, missing muscle mappings) but are just "the test DB was
never seeded with this optional catalog data," not corruption.

### Category 3 — needs live cross-service calls (docker-only env vars)

`adaptive-cycle-evaluation.integration.test.ts` makes real HTTP calls to
`user-service` and `ai-service` (by design — see the file's own header:
"using this session's real, running ai-service (not mocked)"). It needs the
`_test` DB from Category 1 **plus** two env vars that only exist inside the
docker-compose network, never written to `.env` on disk:

| Variable | Where to get the real value | Why `.env` doesn't have it |
|---|---|---|
| `INTERNAL_SERVICE_SECRET` | `docker exec gymcoach-fitness-dev printenv INTERNAL_SERVICE_SECRET` | Injected by docker-compose only |
| `USER_SERVICE_URL` | Normally `http://user-service:3004` (a Docker-internal hostname, unreachable from the host) — from the **host**, use `http://localhost:3004` instead (the container's published port) | Same |

Run with:

```bash
DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness_test?schema=public" \
INTERNAL_SERVICE_SECRET="<value from docker exec above>" \
USER_SERVICE_URL="http://localhost:3004" \
  npx tsx --test src/__tests__/adaptive-cycle-evaluation.integration.test.ts
```

### Category 4 — hung indefinitely (root-caused, fixed this pass)

`coach.service.integration.test.ts` and `coach-plan-draft.integration.test.ts`
used to hang the test-runner process indefinitely (not fail — every real
subtest passed in well under a second combined, but the process never
exited). **Root cause, fully diagnosed this pass**: both files import
`coach.service.ts`, which imports `workout.service.ts`, whose `workoutQueue`
(a BullMQ `Queue`) opens its own separate ioredis connection as a
module-level side effect on import — an existing `test.after` in both files
already closed the OTHER open connection (`repositories/redis.ts`'s
`redisClient`) but never this one, so the process's event loop stayed alive
forever. Fixed: both files' `test.after` now also `await workoutQueue.close()`.
Verified: both files now run to completion (exit code 0, ~3.3s combined) with
zero imposed timeout needed. These two files are back in Category 1 (`_test`
DB, no special handling) — no longer an exception.

### Practical recipe: running "the whole suite" correctly

There is no single command — split by category:

```bash
# Category 1 (everything else) + the now-fixed Category 4 files:
DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness_test?schema=public" \
  npx tsx --test src/__tests__/*.test.ts

# Category 2 (dev DB), run separately:
DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness?schema=public" \
  npx tsx --test src/__tests__/equipment-data-integrity.test.ts src/__tests__/movement-pattern.test.ts \
    src/__tests__/equipment-filtering.integration.test.ts src/__tests__/exercise-muscle-map.integration.test.ts \
    src/__tests__/food-serving-metadata.integration.test.ts

# Category 3 (cross-service), run separately with the two extra env vars above.
```

### E2E harness (`fitnessassistant-playwright-e2e/`)

Separate project, own conventions — see that directory's own
`AGENT_HANDOFF.md`. One thing not documented there, found this pass: the
gateway's `/auth/*` rate limiter (20 req/15min/IP, see
`docs/overnight/OPEN_GYM_RESEARCH_CHECKPOINT.md` and the
`auth-rate-limiter-15min` project memory) is easily exhausted by iterating
on a single new spec file repeatedly (each `createIsolatedTestUser`/
`newAuthenticatedPage` call is a real login). If a run fails with
`status 429` on a login call, that is the rate limiter, not a real bug —
wait for the 15-minute window to clear rather than debugging app code.


---

<a id="merged-workout-log-qa"></a>

## Consolidated reference: workout-log-qa.md

> Consolidated 2026-09-07. Original dates, verification results and deployment
> snapshots below are historical; confirm them against current code/environment.

## Workout Log QA Checklist

### Setup

Apply the fitness-service schema update before testing against a local database:

```bash
pnpm --filter @gym-coach/fitness-service run db:generate
pnpm --filter @gym-coach/fitness-service run db:migrate
```

If migration is not applied, the consistency checker will report the missing `program_exercise_id` column.

1. Login with a test customer.
2. Create or import a workout plan with 4 exercises in Day 1.
3. Open Workout Log.
4. Open the "Ke hoach tap" tab.
5. Select Day 1.
6. Verify initial progress is 0%.
7. Click "Bat dau tap".
8. Complete exercise 1.
9. Verify progress is 25% and the row shows completed.
10. Complete exercise 2.
11. Verify progress is 50%.
12. Complete exercise 3.
13. Verify progress is 75%.
14. Complete exercise 4.
15. Verify progress is 100% and the session completion screen appears.
16. Return to the plan/day list.
17. Verify the Day 1 progress ring still shows 100%.
18. Refresh the browser.
19. Verify Day 1 still shows 100%.
20. Logout and login again.
21. Verify Day 1 still shows 100%.
22. Run:

```bash
pnpm --filter @gym-coach/fitness-service run workout:check-consistency -- --dry-run
```

23. If dry-run reports only recomputable progress mismatch in dev data, run:

```bash
pnpm --filter @gym-coach/fitness-service run workout:check-consistency -- --fix-safe
```

Do not use `--fix-safe` against production data without backup and review.

For CI-like failure behavior, add `--strict`:

```bash
pnpm --filter @gym-coach/fitness-service run workout:check-consistency -- --dry-run --strict
```

### Docker Verification

Fast profile:

```bash
pnpm docker:test:fast
```

Full profile with mock embeddings:

```bash
pnpm docker:test:full
```

Full profile now seeds Qdrant test collections before AI/RAG checks:

- `exercises`
- `fitness_knowledge`
- `fitness_faq`
- `fitness_evidence`

Real Ollama mode is opt-in:

```bash
USE_OLLAMA=true pnpm docker:test:full
```

If a real model is missing, the test runner prints the `ollama pull` command instead of downloading large models automatically.
