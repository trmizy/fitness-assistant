# Gymini Pre-Integration Failure Triage

Date: 2026-09-10
Scope: reproduce and classify the 6 failures + 1 stall observed during a
prior full-suite `tsx --test src/__tests__/*.test.ts` attempt, before
starting cross-system E2E work. Per the master task's own instruction:
classify each, fix only what blocks the cross-system journey, otherwise
document and leave alone.

## Summary table

| # | Symptom | Classification | Blocks cross-system journey? | Action |
|---|---|---|---|---|
| 1 | `every exercise has a movementPattern set` FAIL | TEST-ISOLATION BUG | No | Documented, not fixed |
| 2 | `getFilterOptions: returns real source and food form values` FAIL | WRONG TARGET DATABASE (usage error, not a bug) | No | None needed — passes correctly against the intended DB |
| 3 | `listFoods: source and foodForm filters only return matching rows` FAIL | WRONG TARGET DATABASE (usage error) | No | None needed |
| 4 | `backfill: a known powder/isolate food is classified as a supplement...` FAIL | WRONG TARGET DATABASE (usage error) | No | None needed |
| 5 | `backfill: hard cheese (Parmesan) gets a tight 40g cap` FAIL | WRONG TARGET DATABASE (usage error) | No | None needed |
| 6 | Full-suite glob stalls indefinitely (0% CPU, 0 DB activity) after `movement-pattern.test.ts` | ENVIRONMENT ISSUE (missing env var) | No (once correctly configured) | Documented; use correct env going forward |

## 1. `movement-pattern.test.ts` — "every exercise has a movementPattern set"

**Reproduced.** Root cause, confirmed by direct query against the
isolated test Postgres (`gymcoach_fitness_test:55433`):

```sql
SELECT e.id, e.exercise_name, e.status,
  EXISTS(SELECT 1 FROM exercise_sources es WHERE es.exercise_id=e.id) AS has_source
FROM exercises e WHERE e.movement_pattern IS NULL;
```
```text
 coach-it-ex-4d47171f-... | Coach Test Exercise coach-it-ex-4d47171f-... | PUBLISHED | f
 coach-it-ex-40492dfa-... | Coach Test Exercise coach-it-ex-40492dfa-... | PUBLISHED | f
```

Both rows are throwaway fixtures created by
`coach.service.integration.test.ts` (lines ~128, ~213 —
`` `coach-it-ex-${randomUUID()}` ``), which **never deletes them** after
its own tests finish. `movement-pattern.test.ts`'s assertion —
`prisma.exercise.count({ where: { movementPattern: null } })` — is
**unscoped** (counts the whole `Exercise` table), unlike the catalog
validator (`validateExerciseCatalog.ts`) and the seed-parity test, which
both correctly scope to source-backed catalog rows only
(`EXERCISE_CATALOG_VERIFICATION_REPORT.md` confirms
`missingMovementPatternCount=0` when scoped correctly).

**Classification: TEST-ISOLATION BUG.** Not a catalog defect (the real
catalog's 1001+ source-backed exercises all have a movementPattern, per
the independently-run `test:catalog:validate`), not caused by this
phase's or the prior Roadmap phase's edits, not something the parallel
AI Workout Grounding agent introduced (`coach.service.integration.test.ts`
is a fitness-service test file, unrelated to that agent's current scope).

**Does it block the cross-system journey?** No — it never runs against
production data, and the real catalog invariant it's trying to protect
is independently proven clean elsewhere. **Not fixed this phase** (would
require either adding cleanup to `coach.service.integration.test.ts` or
re-scoping `movement-pattern.test.ts`'s query — a one-line, low-risk fix,
but outside this phase's stated boundary of "fix only what blocks the
journey"). Documented here for whoever picks it up next.

## 2-5. Food-catalog / backfill test failures

**Reproduced, then fully explained — these are not product bugs at all.**
Both `food-library.integration.test.ts` and
`food-serving-metadata.integration.test.ts` carry an explicit header
comment stating they are **intentionally dev-DB-only**:

> "fitness-service has no separate `_test` database with the real
> 13k+-row USDA food catalog seeded — same accepted, already-documented
> constraint as equipment-data-integrity.test.ts and its siblings.
> DATABASE_URL points at the real `gymcoach_fitness` dev DB..."

The prior full-suite run pointed `DATABASE_URL` at the isolated test DB
(`gymcoach_fitness_test`) for every file uniformly — the wrong target for
these two files specifically. Confirmed by direct query:

```sql
SELECT count(*) AS total, count(*) FILTER (WHERE food_form IS NOT NULL) AS with_form
FROM foods; --  13159 | 0   (isolated test DB — imported, but the one-time
                            --  migration backfill ran before this data existed)
```

Re-run both files against the real dev DB (`gymcoach_fitness`, as their
own doc comments prescribe):

```text
food-serving-metadata.integration.test.ts: tests 4, pass 4, fail 0
food-library.integration.test.ts:          tests 11, pass 11, fail 0
```

**Classification: WRONG TARGET DATABASE (my own usage error in the prior
run), not a reproducible product bug, not a test-isolation bug, not an
environment defect in the product itself.** The isolated test DB simply
never runs these two files — that is by design, not an oversight to fix.

**Does it block the cross-system journey?** No.

## 6. Full-suite glob stall after `movement-pattern.test.ts`

**Reproduced and root-caused.** The next file alphabetically,
`muscle-library.integration.test.ts`, calls `redisClient.connect()` in
its setup (`src/repositories/redis.ts`). That module only skips
connecting when `process.env.FITNESS_DISABLE_REDIS === "true"`. The
prior full-suite invocation set `DATABASE_URL` but not
`FITNESS_DISABLE_REDIS` — exactly the env var
`EXERCISE_CATALOG_VERIFICATION_REPORT.md` had already documented as
required for isolated test runs. Without it, the Redis client attempts a
real connection to a Redis instance that isn't configured for this
context and hangs — explaining the observed 0% CPU / 0 active Postgres
connections (blocked on a socket connect, not computing or querying).

Confirmed fix:
```text
FITNESS_DISABLE_REDIS=true DATABASE_URL=... npx tsx --test \
  src/__tests__/muscle-library.integration.test.ts
tests 4, pass 4, fail 0, duration_ms 2046  (was: indefinite hang)
```

**Classification: ENVIRONMENT ISSUE (missing env var in my own
invocation).** Not a product bug, not a regression from this phase or
the prior Roadmap phase, not something the parallel agent caused.

**Does it block the cross-system journey?** No, once the correct env var
is set. All subsequent full-regression runs in this phase use
`FITNESS_DISABLE_REDIS=true`.

## Conclusion

None of the 6 observed failures/stalls are real product defects, and
none block the cross-system fitness journey. Zero code changes made in
this document's scope — consistent with the master task's instruction to
classify first and fix only what's blocking. Going forward in this
phase, the correct invocation for the isolated test DB is:

```bash
DATABASE_URL="postgresql://gymcoach_test:***@localhost:55433/gymcoach_fitness_test" \
FITNESS_DISABLE_REDIS=true \
npx tsx --test <files>
```

and `food-library.integration.test.ts` /
`food-serving-metadata.integration.test.ts` are run separately against
the real dev DB (`gymcoach_fitness`), per their own documented
convention.
