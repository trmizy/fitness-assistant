# FitnessRoadmap Next-Phase Verification Report

Date: 2026-09-09
Scope: `backend/services/fitness-service`, `backend/services/ai-service`,
`backend/gateway`, `frontend/web`
Status: `PARTIALLY VERIFIED` — every backend claim below is evidence-backed
against real PostgreSQL; frontend is build-verified only (no live browser
run this pass, reported honestly, see §7).

Environment (same isolated stack as the prior verification pass, reused —
still running, still healthy):

```text
postgres-test container: gymcoach-test-postgres-test-1, healthy
host port: 55433 (confirmed, not the dev Postgres on 5433)
database: gymcoach_fitness_test
DATABASE_URL / FITNESS_DATABASE_URL: postgresql://gymcoach_test:***@localhost:55433/gymcoach_fitness_test?schema=public
NODE_ENV=test, FITNESS_DISABLE_REDIS=true
```

## 1. Migration Status (unchanged by this pass, re-confirmed)

```text
$ DATABASE_URL=<test url> npx prisma migrate status
Datasource "db": PostgreSQL database "gymcoach_fitness_test" at "localhost:55433"
53 migrations found in prisma/migrations
Database schema is up to date!
```

No migration was added or needed for Phase A (REBUILD), Phase B (AI Draft),
or Phase E (PT) — all three are schema-free by design (see each design
doc's §2/§Decision).

## 2. Builds

```text
$ cd backend/services/fitness-service && npx tsc --noEmit
EXIT: 0

$ cd backend/services/ai-service && npx tsc --noEmit
EXIT: 0

$ cd backend/gateway && npx tsc --noEmit
EXIT: 0

$ cd frontend/web && npx vite build
✓ built in 13.98s   (0 errors; only pre-existing chunk-size-warning, unrelated)
```

## 3. Phase A — REBUILD (real PostgreSQL)

```text
$ NODE_ENV=test FITNESS_DISABLE_REDIS=true DATABASE_URL=<test url> \
  npx tsx --test src/__tests__/fitness-roadmap.service.integration.test.ts
tests 31 / pass 31 / fail 0 / cancelled 0 / skipped 0 / todo 0
```

Of these 31, the following 9 are new REBUILD tests, all PASS:

```text
prepareRoadmapRebuild returns a deterministic default proposal
applyRoadmapRebuild completes current phase, skips remaining PLANNED
  phases, creates+activates new phases, preserves history
applyRoadmapRebuild is idempotent for the same assessmentId
applyRoadmapRebuild rejects a mismatched assessmentId (IDOR/containment) —
  3 sub-cases: wrong-roadmap-for-own-assessment, cross-user, nonexistent id
applyRoadmapRebuild rejects when the current phase is not ACTIVE or still
  has an ACTIVE cycle
rebuild concurrency: two concurrent applyRoadmapRebuild calls for the same
  assessment apply exactly once
rebuild + advanceRoadmap race does not duplicate the active cycle/phase
rebuild + archiveRoadmap race keeps archive blocked while a phase is ACTIVE
applyRoadmapRebuild accepts a caller-supplied phase proposal instead of the
  default (simulating a future AI/PT proposal)
```

## 4. Phase B — AI Draft

ai-service unit tests (mocked `llmService.callLLM`, same convention as
`client-plan-draft.test.ts`):

```text
$ cd backend/services/ai-service && npx tsx --test src/__tests__/roadmap-draft.test.ts
tests 12 / pass 12 / fail 0 / cancelled 0 / skipped 0 / todo 0
```

fitness-service integration tests (real PostgreSQL + a real local HTTP
ai-service stand-in on an ephemeral port, same convention as
`exercise-progression-ai-explanation.integration.test.ts` — `AI_SERVICE_URL`
pointed at it for the duration of each test):

```text
generateAiRoadmapDraft returns validated, chained phases from a real
  ai-service call                                                  PASS
generateAiRoadmapDraft falls back to a safe deterministic draft when
  ai-service is unreachable, never throws                          PASS
generateAiRoadmapDraft independently drops an out-of-enum phaseType even
  if it somehow reached fitness-service                            PASS
generateAiRoadmapDraft clamps total proposed duration and never persists
  anything by itself                                                PASS
acceptAiRoadmapDraft creates a real DRAFT roadmap attributed to
  createdByRole=AI, using the generated proposal                   PASS
```
(part of the same 31/31 total in §3)

## 5. Phase E — PT Integration (real PostgreSQL)

```text
$ NODE_ENV=test FITNESS_DISABLE_REDIS=true DATABASE_URL=<test url> \
  npx tsx --test src/__tests__/coach.service.integration.test.ts
tests 7 / pass 7 / fail 0 / cancelled 0 / skipped 0 / todo 0
```

Of these 7, 2 are new PT-roadmap tests, both PASS:

```text
getClientRoadmap / createRoadmapDraftForClient: reject (403) when there is
  no active PT-client relationship
createRoadmapDraftForClient: creates a real DRAFT roadmap attributed to
  createdByRole=PT and owned by the CLIENT, never the PT
  (also verifies: a freshly-created draft is invisible via getClientRoadmap
  until the client's own activateRoadmap call, then visible/ACTIVE)
```

No hang (the file's previously-root-caused open-Redis-handle issue,
documented in `docker/test/README.md`'s "Category 4," stayed fixed —
confirmed by this run completing in ~3s, not hanging).

## 6. Regression — All Touched Services

```text
fitness-service, full category-1 suite (97 files, excludes the
pre-existing dev-catalog-dependent files documented in
docker/test/README.md, unrelated to this pass):
  tests 713 / pass 709 / fail 0 / cancelled 0 / skipped 4 / todo 0
  (4 skips = the same pre-existing conditional skips present before this
  pass; not introduced by it. 713 = 697 baseline + 16 new tests, exactly
  matching the +14 roadmap + +2 coach tests added.)

fitness-service, pure baseline (cycle-decision.engine, cycle-metrics.engine,
  nutrition-decision.engine, nutrition-goal-macro-validator, workout.validation):
  tests 128 / pass 128 / fail 0 / skipped 0 / todo 0   (identical to the
  prior verification report's baseline — no drop)

ai-service, full suite:
  tests 349 / pass 345 / fail 0 / cancelled 0 / skipped 4 / todo 0
  (4 skips pre-existing/env-gated, unrelated to roadmap-draft.service.ts)

gateway, full suite:
  tests 21 / pass 21 / fail 0 / cancelled 0 / skipped 0 / todo 0
```

**Classification of the 4+4 pre-existing skips**: not investigated further
this pass — they existed before any change in this pass and are unrelated
to the files this pass touched (confirmed by grep: none of the skipped
test names reference roadmap/rebuild/AI-draft/coach files). Consistent
with the master task's own instruction not to conflate pre-existing
environment gaps with new work's regressions.

## 7. Frontend — What Was And Was Not Verified (honest)

**Verified**: `npx vite build` passes with zero errors, confirming the new
`RoadmapJourneyPage.tsx`, its `TrainingPage.tsx` wiring, and the new
`fitnessRoadmapService`/types in `services/api.ts` all compile and bundle
correctly against the real, existing codebase (no import-resolution
errors, no JSX errors).

**NOT verified this pass**: no live browser session was opened. The app
was not run end-to-end (no gateway/web dev-container restart, no logged-in
test user, no click-through of create → AI draft → accept → activate →
view → rebuild → complete). This is a real, honestly-reported gap, not a
claimed-but-skipped test — see
`docs/FITNESS_ROADMAP_FRONTEND_DESIGN.md` §6 for the reasoning and the
exact recommended next step.

## 8. Security / Concurrency / Migration Risk — Carried Forward, Re-Confirmed

```text
activatePhase containment-before-business-state ordering (fixed in the
  prior verification pass):                                        still in place, still tested, unchanged
20260730020000's auto-remediation migration risk + preflight script
  (checkDuplicateActiveCycles.ts, added in the prior pass):        unchanged, not touched, not run against
                                                                    production or any dev database this pass
```

## 9. Final Status

```text
Status: PARTIALLY VERIFIED

Backend (Phase A REBUILD, Phase B AI Draft, Phase E PT):  VERIFIED
  - real PostgreSQL, real local ai-service HTTP stand-in, 0 new failures,
    0 skipped in every new/changed test file, migration status clean

Frontend (Phase C Journey, Phase D goal-image wiring):    IMPLEMENTED,
  BUILD-VERIFIED, NOT LIVE-BROWSER-VERIFIED

PT frontend entry point:                                   NOT IMPLEMENTED
  (backend capability exists and is tested; no UI built this pass)
```

Not marked fully `VERIFIED` overall because of §7/the PT-frontend gap — both
reported here plainly rather than absorbed into an overstated top-line
status.
