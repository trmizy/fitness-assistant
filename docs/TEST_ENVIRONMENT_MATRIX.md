# Test Environment Matrix — fitness-service

> Written after this session repeatedly rediscovered the same environment
> confusion while running `fitness-service`'s test suite ad-hoc from the
> host (outside the project's own CI/container harness). No secret values
> are recorded here — only which variable each suite needs and where its
> real value lives (`.env`, or the running `gymcoach-fitness-dev`
> container's own environment).

## Why this file exists

`fitness-service`'s test suite is **not uniform** — different files assume
different databases and, for a few, different network reachability. Running
everything with one blanket environment produces confusing false
failures that look like real bugs but aren't. This session hit all three
categories below before root-causing each one (see
`docs/OPENGYM_GAP_IMPLEMENTATION_REPORT.md` "Known limitations" for the
full incident writeups) — this table exists so the next session doesn't
have to rediscover them.

## Category 1 — `_test` database (the default assumption)

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

## Category 2 — real seeded dev DB (`gymcoach_fitness`), not `_test`

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

Run with:

```bash
DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_fitness?schema=public" \
  npx tsx --test src/__tests__/<file>.test.ts
```

**Never run these against `gymcoach_fitness_test`** — they will fail with
confusing catalog-invariant violations that look like real bugs (missing
equipment links, missing muscle mappings) but are just "the test DB was
never seeded with this optional catalog data," not corruption.

## Category 3 — needs live cross-service calls (docker-only env vars)

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

## Category 4 — hung indefinitely (root-caused, fixed this pass)

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

## Practical recipe: running "the whole suite" correctly

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

## E2E harness (`fitnessassistant-playwright-e2e/`)

Separate project, own conventions — see that directory's own
`AGENT_HANDOFF.md`. One thing not documented there, found this pass: the
gateway's `/auth/*` rate limiter (20 req/15min/IP, see
`docs/overnight/OPEN_GYM_RESEARCH_CHECKPOINT.md` and the
`auth-rate-limiter-15min` project memory) is easily exhausted by iterating
on a single new spec file repeatedly (each `createIsolatedTestUser`/
`newAuthenticatedPage` call is a real login). If a run fails with
`status 429` on a login call, that is the rate limiter, not a real bug —
wait for the 15-minute window to clear rather than debugging app code.
