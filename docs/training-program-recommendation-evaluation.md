# Training Program Recommendation Evaluation

Date: 2026-09-15 (v1) · **v2 update 2026-09-15** — see `docs/training-program-recommendation-v2-score-design.md` for full rationale and `docs/ai-agent-hardening-fix-report.md`-style before/after evidence.

## v3 — DB environment gate closed (2026-09-15)

Codex Independent Evaluation #2 (`docs/codex-training-program-recommendation-evaluation-2-final-signoff.md`): **GO WITH DOCUMENTED ENVIRONMENT LIMITATION** — 0 CRITICAL/HIGH/MEDIUM production defects; the only open item was `Prisma P2021: public.equipment does not exist` when Codex ran the two fitness-service DB-backed suites.

**Root cause**: the isolated test database (`gymcoach_fitness_test`) is provisioned by an explicit, separate bootstrap step (`pnpm run prisma:migrate:test`, i.e. `scripts/prisma-test.mjs` — the project's own safety-guarded migration script for all `*_test` databases, not `db push`) that is not run automatically before a bare `npx tsx --test`. When this pass's `gymcoach_fitness_test` was queried directly, `fitness-service` and `ai-service` were already fully migrated (likely from earlier `prisma migrate deploy` work in this same environment), but `chat-service` had 3 pending migrations — confirming the shared test-DB stack was only **partially** provisioned, not that any single table was hand-patched. This is a bootstrap-ordering/environment-lifecycle gap, not a defect in `agent-program.service.ts`'s equipment logic (which Codex already verified correct by code-path inspection) or in the test files themselves.

**Fix**: ran the project's own canonical bootstrap script for real —

```bash
POSTGRES_HOST=localhost POSTGRES_PORT=55433 POSTGRES_USER=gymcoach_test POSTGRES_PASSWORD=gymcoach_test_password \
  node scripts/prisma-test.mjs
```

— which applies `prisma migrate deploy` per service against its own `*_test` database (never `db push`, and never a manually-created single table: the script's own `assertTestUrl()` guard refuses any URL that isn't a recognized `_test`/`postgres-test`/`localhost` target, and a separate post-provisioning check confirms the two hand-written partial-unique-index migrations for `training_cycles`/`nutrition_goals` are present — this project already rejected `db push` for fitness-service specifically because it silently omits those). No new guard was added — `assertTestUrl()` already exists and already does this job; duplicating it was avoided.

**DB target actually used** (connection identity only, no credentials): `host=localhost`, `port=55433`, `database=gymcoach_fitness_test`, `schema=public` — the same isolated test Postgres this pass's earlier "10/10" claim already referenced (`docker-compose.test.yml`'s `postgres-test` service, host-mapped to `55433`).

**Real rerun results** (after confirming `prisma migrate status` → "Database schema is up to date!" and the bootstrap script's own "no pending migrations" + "all required indexes present" checks):

| Run | Result |
|---|---|
| Equipment suite alone | 8/8 pass |
| Apply idempotency/stale-fingerprint suite alone | 2/2 pass |
| Combined run #1 | 10/10 pass |
| Combined run #2 (reproducibility check) | 10/10 pass |

No production code was changed to close this gate — per the task's own instruction, this was purely a database/test-environment bootstrap issue, not a recommender-logic issue.

**CI finding (disclosed, not silently patched)**: `.github/workflows/docker-test.yml` currently only runs `pnpm docker:test:fast` (the `docker-compose.test.yml` **"fast"** profile — Redis only, `LLM_PROVIDER: mock`, no Postgres at all). The **"full"** profile (Postgres/Qdrant/Ollama, the one that runs `prisma:migrate:test` and could execute these two DB-backed suites automatically) is not currently wired into CI at all. This means `agent-program-equipment-semantics.test.ts` and `agent-program-apply-idempotency.test.ts` are **not yet part of any automated CI run** — they are a manual/local pre-production gate today. Deciding whether to add a "full"-profile CI job (real infra cost: Postgres+Qdrant+Ollama containers, model pulls) is a real, separate infrastructure decision outside this pass's scope ("do not change production deploy flow unnecessarily") — flagged here as a named recommendation, not unilaterally implemented.

## v4 — DB integration CI gate added (2026-09-15)

Closes the v3 CI finding above with the smallest infrastructure that actually covers the target suites — **not** the "full" Docker profile (Postgres+Qdrant+Ollama). New independent job `db-integration` in `.github/workflows/docker-test.yml`, alongside the existing `fast-docker-test` job (no `needs:` between them — both start immediately on every PR/push to `master`).

**Infrastructure**: a plain GitHub Actions `postgres:15-alpine` service container (host-mapped to `55433`, same convention as local `docker-compose.test.yml`, so `DATABASE_URL` values are copy-paste identical between CI and local reproduction) — nothing else. Audited directly: none of the 4 target test files call an LLM or vector search, so Ollama/Qdrant are correctly not provisioned.

**Bootstrap flow** (canonical, not `db push`): `scripts/ci-create-test-databases.mjs` (new — replays `docker/test/postgres-init-test.sql` verbatim against the plain Postgres service, so the CI and local-Docker database lists can never drift) → `pnpm run prisma:generate` → `pnpm run prisma:migrate:test` (the existing `scripts/prisma-test.mjs`, unmodified — real `prisma migrate deploy` per service, `assertTestUrl()` safety guard, required-index post-check, all unchanged) → an explicit `prisma migrate status` check for fitness-service specifically (cheap, and its whole purpose is to fail loudly and specifically if the exact `P2021 public.equipment` regression that started this gate work ever recurs) → the 4 target test files, each its own step for clear pass/fail attribution in the Actions log.

**Tests included** (16 total, all genuinely executed — not hardcoded pass):
- `fitness-service/agent-program-equipment-semantics.test.ts` — 8/8 pass
- `fitness-service/agent-program-apply-idempotency.test.ts` — 2/2 pass
- `user-service/agentic-contract-idempotency.test.ts` (PT contract idempotency + PT-stops-accepting/package-archived stale-state) — 4/4 pass
- `user-service/client-journey-derivation-idempotency.test.ts` (sequential + 10-way concurrent) — 2/2 pass

All 4 verified locally against the identical `localhost:55433` databases and env the CI job uses, individually and combined (6/6 for the 2 new user-service files together, matching the 10/10 combined result already established for the 2 fitness-service files). **Not included**: the ~230-file mega-suite (see v3's own finding: real Postgres resource exhaustion observed running that as one process) and anything requiring Ollama/Qdrant/a live LLM — this job is a targeted invariant gate, not a full regression run.

**Verification note**: `pnpm install` + the 6 test-execution steps were verified for real on this (Windows) machine. `pnpm run prisma:generate` could not be verified end-to-end locally — it hit a pre-existing, previously-documented Windows-only `EPERM` file-lock on regenerating a query-engine binary already in use by a local Docker container; this is not expected to occur on a fresh Linux GitHub Actions runner (no pre-existing generated binary to lock), but genuinely has not been observed passing in this exact CI job before its first real run — flagged honestly rather than claimed verified.

**Fast/integration tier separation**: `fast-docker-test` (lint, root build, unit tests, fast Docker profile) stays exactly as it was — no Postgres, no slower per-service migration step added to its path. `db-integration` is fully independent and only adds the smaller Postgres-only cost.

**Runtime**: not measured in real GitHub Actions (no way to trigger a run from this environment) — only local step timings are available: the 4 test files together take ~25-30s of real test execution on this machine; `pnpm install`/`prisma generate`/`prisma:migrate:test` are the likely dominant cost on a cold CI runner (not locally re-timed end-to-end due to the EPERM issue above). Recommend running `db-integration` on **every PR** (same trigger as `fast-docker-test`) given nothing in this scope suggests it's slow enough to reserve for main/release-only — but the real number should be confirmed from the job's first actual run and this recommendation revisited if it turns out to be materially slower than expected.

## v2 Commands Run And Real Results

```bash
npm --prefix backend/shared run build                      # pass
npm --prefix backend/services/ai-service run build          # pass
npm --prefix backend/services/fitness-service run build     # pass
npm --prefix frontend/web run build                          # pass

npx tsx --test --test-force-exit backend/services/ai-service/src/__tests__/training-program-scoring-v2.test.ts   # 32/32 pass
npx tsx --test --test-force-exit backend/services/ai-service/src/llm/__tests__/program_recommendation_claims.test.ts  # 5/5 pass
npx tsx --test --test-force-exit backend/services/ai-service/src/__tests__/fitness-agent-program-e2e.test.ts     # 3/3 pass, real ai-service DB
npx tsx --test --test-force-exit backend/services/fitness-service/src/__tests__/agent-program-equipment-semantics.test.ts backend/services/fitness-service/src/__tests__/agent-program-apply-idempotency.test.ts  # 10/10 pass, real isolated fitness test DB (gymcoach_fitness_test @ localhost:55433)
npx tsx backend/services/ai-service/src/evaluation/program-recommendation/evaluate_program_recommendation.ts     # Codex's own evaluator, UNMODIFIED — exit 0, goldenScenarios 5/5, claimSecurity 4/4, v1 numbers unchanged (confirms backward compatibility)
npx tsx backend/services/ai-service/src/scripts/evaluateProgramScoringV1VsV2.ts  # new v1-vs-v2 diagnostic — real numbers below

npx tsx --test --test-force-exit backend/services/ai-service/src/__tests__/*.test.ts (excl. 1 pre-existing test-DB-gated file, unchanged from prior passes)  # 751/755 pass, 4 skipped, 0 fail — full ai-service regression, confirms PT Phase-4 (Claim Catalog, memory provenance/policy) unaffected
```

### Real v1-vs-v2 diagnostic comparison (100-case representative dataset, same shape Codex's own evaluator uses)

| | v1 | v2 |
|---|---|---|
| tie rate | 0.87 | 0.58 |
| unique scores (of 100) | 13 | 42 |
| min/p25/median/mean/p75/max | 88/92/95/94.49/97/100 | 50/70/78/77.76/86/98 |

Divergence sanity check (same real sessionDuration difference, 51 vs 60 min target 60): v1 gap = 1 point, v2 gap = 10 points — confirms the removed constant dimensions were genuinely diluting real signal, not that v2 merely added noise.

### Equipment semantics — real DB-backed proof (8 new cases, `agent-program-equipment-semantics.test.ts`)

REQUIRED present/absent, OPTIONAL absent (still eligible — the actual bug), ALTERNATIVE one-of-two present (still eligible — the actual bug), ALTERNATIVE none present (ineligible), bodyweight/no-links (eligible), mixed REQUIRED+OPTIONAL, mixed REQUIRED(absent)+ALTERNATIVE(present) — all 8/8 pass against real `Equipment`/`ExerciseEquipment`/`UserEquipment` rows.

### DB-backed E2E — real proof (`fitness-agent-program-e2e.test.ts`, previously Codex-flagged BLOCKED/UNVERIFIED)

Real `fitnessAgent.tryTurn → prepare → execute` chain, real ai-service DB (`FitnessRecommendation`, `FitnessAgentAction`), real `scoreTrainingProgramV2` ranking, real claim-catalog deterministic-fallback narration; only the genuine cross-service HTTP boundary (`findTrainingPrograms`/`applyTrainingPlan`) stubbed. 3/3 pass: correct top-ranked-v2-candidate confirmed and applied; stored `scoringVersion` reflects v2; double-confirm idempotent; apply-boundary rejection propagates without marking the action COMPLETED.

### Full fitness-service suite — partially measured, honestly disclosed

A full 118-file `tsx --test` run in one process hit two distinct pre-existing environment issues unrelated to this pass's changes: (1) ~114 of 118 files lack their own `dotenv/config` import and rely on a shared-process side effect for `DATABASE_URL`, which is fragile to file ordering; (2) once run against the correct isolated test DB (`gymcoach_fitness_test @ localhost:55433`, `FITNESS_DISABLE_REDIS=true`), roughly a dozen unrelated heavy integration tests (nutrition, workout scheduling, persona fixtures) failed with real Postgres connection/transaction-timeout errors partway through — consistent with DB resource exhaustion under one very large single-process run, not a code defect (none of the failing tests touch equipment/program-recommendation code, and my targeted subset — equipment-semantics + apply-idempotency, 10/10 — passed cleanly against the same DB in isolation). Not re-attempted at full scale given the time cost; this is a known category of test-infrastructure limitation, honestly reported as **NOT FULLY MEASURED at full-suite scale**, not silently claimed clean.

## v1 Commands Run (historical)

```bash
npm --prefix backend/shared run build
npm --prefix backend/services/ai-service run build
npx tsx --test backend/services/ai-service/src/__tests__/training-program-scoring.test.ts backend/services/ai-service/src/llm/__tests__/program_recommendation_claims.test.ts
```

## Results

- shared build: pass
- ai-service build: pass
- targeted program recommendation tests: 8/8 pass

Covered cases:

- exact eligible program scoring;
- session-duration heuristic does not reward a program merely for being longer;
- optional focus/duration dimensions omitted when user data is missing;
- deterministic ranking tie-break by id;
- generated 100-case matrix remains deterministic and bounded 0-100;
- claim catalog has grounded program facts and mandatory no-history disclosure;
- hallucinated/cross-candidate claim IDs are ignored;
- deterministic fallback renders a full explanation with evidence refs.

## Not Fully Measured In This Environment

- DB-backed end-to-end recommendation -> choose -> confirmation -> apply flow.
- fitness-service hard-filter integration cases that require a seeded local database.
- frontend production build, because no frontend files were changed in this phase.
- live LLM latency/quality, because the claim-selection fallback is deterministic and the test does not require a live model.

## Non-Blocking Verification Note

An earlier broad `npm --prefix backend/services/ai-service test -- --test-name-pattern ...` invocation was parsed by PowerShell as a pipeline because the pattern contained `|`. It therefore ran many unrelated DB-backed suites and failed against missing local Postgres at `localhost:5433`. That is an environment issue for those suites, not a failure of the new program tests. The targeted files above were rerun directly and passed.
