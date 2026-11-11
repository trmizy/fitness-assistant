# Phase 3 — Rollout Remediation R2 — Platform Safety + Live Verification Closure

Date: 2026-10-08. Scope: close the five documented rollout-verification blockers
(N1, N4, N5, N6, N7) with real reproduction evidence first, then run real HTTP
journeys (H1-H6) through the actual gateway/ai-service entry points against an
isolated verification stack, plus a real Qwen3 4B smoke. This is not a new AI
feature batch — no new router, no scoring change, no new capability.

Production defaults are unchanged: `GYMINI_UNIFIED_AI_COACH=off`,
`CONVERSATIONAL_INTELLIGENCE_V2=off`, `CONVERSATIONAL_INTELLIGENCE_V2_LLM=off`
(confirmed at current HEAD, `conversational-intelligence/index.ts`).

## 1. Git baseline

```
START_HEAD=71d2adf7b3e26b078cc229c060b2a6465516af40 (branch aws-deploy)
```

Checked before every major phase (reproduction, fixes, deterministic suite,
live HTTP journeys, final regression). **HEAD never moved during R2** —
`END_HEAD` is the same commit. No `REPOSITORY_BASELINE_CHANGED` condition was
hit. No reset/rebase/cherry-pick/history-rewrite was performed.

## 2. Reproduction table (current HEAD, before any R2 fix)

| ID | Reproduction | Current behavior | Expected | Owning component | Severity | Fix required? |
|---|---|---|---|---|---|---|
| N1 | `backend/services/fitness-service/src/repositories/redis.ts` constructs a node-redis v4 client with zero `.on("error", ...)` listeners. Independently reconfirmed by a real historical crash found in this session's own `.tmp-stack/fitness.log` (`SocketClosedUnexpectedlyError`, `throw er; // Unhandled 'error' event`) from an earlier, unrelated run. | A Redis socket error (e.g. `ETIMEDOUT`) is an uncaught exception that crashes the whole process. `exercise.repository.ts`'s cache reads/writes also had no try/catch, so even a *caught-at-the-client-level* Redis error would still propagate to the HTTP caller. | Error is logged, process stays alive; the cache (optional by design — every read already falls through to Prisma on a miss) degrades silently to a DB read/no-cache-write, never a crash or an unhandled rejection. | fitness-service | P1 (whole service down until manual restart) | Yes — fixed |
| N4 | `fitness-agent.service.ts:208-215`, `applyEquipmentFiltering`'s `catch {}` around the draft-time equipment-validator call. | A validator throw/timeout/malformed response returns the exact same shape as "validator ran, zero violations" — indistinguishable from a real pass in both the draft payload and the chat answer text. | A validator failure must not be presented as "checked, no issues"; a truthful, non-blocking disclosure instead (confirm-time validation, already fail-closed, remains the real safety backstop). | ai-service | P2 (misleading UX; persistence was never actually at risk — confirm-time already rejects invalid plans) | Yes — fixed |
| N5 | Only one ad hoc guard (`assertSafeTestDatabase`, inline in one test file) existed anywhere in the repo; every other DB-mutating integration test trusts `DATABASE_URL` with no check, and `.env` defaults to the dev DB. | Mitigated only by this session's practice of explicitly overriding `DATABASE_URL`/`AI_DATABASE_URL` on every run — not an enforced mechanism. | A shared, tested, reusable guard that refuses to run before any mutation if the target isn't the isolated `*_test` Postgres under `NODE_ENV=test`. | ai-service + fitness-service (test infra) | P2 (real risk, currently only mitigated by discipline) | Yes — guard implemented + tested; not retrofitted into every existing integration file (that is a much larger, separate pass — see §19) |
| N6a | `marketplace-publisher-qualification.integration.test.ts`'s 3 `adoptPlan` tests: a real cross-service mappability gate (`validateMarketplaceSchedulesMappable`, a real HTTP call to fitness-service's catalog) runs *before* the actual logic under test (day-count / invented-exercise / empty-day validation), and the fixture's fake exercise ids don't resolve in the live catalog. | 422 (blocked by the gate) instead of reaching the 400 the test asserts — the invariant under test never actually executes. | The invariant under test is ai-service's own logic; the unrelated cross-service gate should be stubbed for this test (already the file's own convention for two other dependencies). | ai-service (test) | P2 (test gap, not a product defect) | Yes — fixed |
| N6b | `plan-generation-equipment.integration.test.ts` spawns its own throwaway fitness-service test server; the harness had no spawn-error/early-exit detection, no port-occupancy check, and only a generic 30 s timeout with no diagnostic output. | Hung/timed out with zero diagnostic signal in this session's first attempts. | Explicit `PASS` or a reproducible `INFRASTRUCTURE_BLOCKED` reason — never an ambiguous "didn't finish." | ai-service (test harness) | P2 (test-infra reliability) | Yes — hardened; now passes |
| N7 | `llm-provider-ollama-regression.test.ts` hardcoded the model tag `"llama3.2:3b"` (mock `/api/tags` response and an assertion), but `llm.service.ts`'s actual default for `LLM_PROVIDER=ollama` is now `qwen3:4b-instruct-2507-q4_K_M`. | 2 tests fail on a stale expectation that drifted from the real runtime config. | The test should derive its expectation from the same `LLM_MODEL`/`EMBEDDING_MODEL` constants the runtime uses — one source of truth. | ai-service (test) | P3 (test-only drift) | Yes — fixed |

**New finding, not one of the original five, surfaced only by H1's real HTTP
run (§9):** `exercise-substitution.service.ts`'s candidate-pool query had no
`status: "PUBLISHED"` filter, so a `STAGING` exercise could be ranked and
returned as a legitimate substitute. The AI draft then carried it all the way
to confirm, where fitness-service's own exercise-master mapping correctly
rejects anything non-`PUBLISHED` — so confirm permanently failed with a
confusing `not_found` error. This is exactly the invariant this schema's own
`status` column comment documents as "a hard floor gating the AI-plan-
generation... path" — substitution was the one caller that didn't enforce it.
**Severity P1** (a real, user-facing, permanently-failing core journey — not
a test artifact; reproducible any time a STAGING row happens to rank well as
a substitute). Fixed with a one-line filter + a self-contained regression test
(creates its own throwaway STAGING row, doesn't depend on any particular row
already being STAGING in a given environment's seed data).

## 3. N1 fix

`redis.ts`: `realRedisClient?.on("error", ...)` logs and returns — the
client's own default reconnect strategy is untouched. `exercise.repository.ts`:
`findMany`/`findById`/`findByIdWithDetails` now go through `cacheGet`/
`cacheSetEx` wrappers that catch and log, falling back to the real DB path
exactly as a genuine cache miss would. `create()`'s existing cache-invalidation
try/catch was already fail-soft and is untouched.

5 new tests (`redis-error-resilience.test.ts`): (A) a client with the listener
attached does not throw on `emit("error", ...)`; (B) a client pointed at an
unreachable address still has `connect()` reject loud and callable (server.ts's
own startup policy — fail the boot — is unchanged, by design, and is not
touched here); (C) a synthetic mid-operation Redis error degrades
`exerciseRepository.findById` to the real Prisma row, never throws; (D)
recovery — a later call succeeds once the cache is reachable again, no
permanently-tripped state; (E) the error log line never contains the
connection URL's credentials. **5/5 pass.**

## 4. N4 fix

`applyEquipmentFiltering` now returns `equipmentValidationUnavailable: boolean`
(true only on a validator throw/timeout), threaded through
`generateWorkoutDraft` to both callers (`proposeWorkoutPlan`, the day-count-
change revision branch). When true, a new, fixed, truthful warning string is
added to the same `warnings` array `workoutSafetyWarnings` already uses for
disclosed, non-blocking gaps (the established pattern in this file — "never a
hard block... a disclosed gap, not silently ignored"). Confirm-time validation
(`validateAiPlanExerciseEquipment`, fitness-service) is completely untouched —
it remains the real safety backstop.

5 new tests (`fitness-agent-equipment-preview-degraded.test.ts`, real DB,
real `tryTurn()`): (A) validator reachable, zero violations → no degraded
warning; (B) validator throws → draft still shown, truthful warning present,
no false substitution/compatibility claim in the answer text; (C) validator
returns a malformed/null response → same safe degraded result, no crash; (D)
proposing/previewing a degraded draft never calls `importAiPlanToSchedule`
(no authoritative persistence); (E) once the validator is reachable again on a
later turn, a freshly regenerated draft no longer carries the warning (no
permanently-stuck degraded state). **5/5 pass.**

## 5. N5 isolation guard

Extracted `assertSafeTestDatabase` (previously only inline in
`plan-generation-equipment.integration.test.ts`) into
`src/test-utils/safe-test-db.ts` (ai-service) and an identical
`src/test-utils/safe-test-db.ts` (fitness-service) — duplicated per-service
rather than added to `@gym-coach/shared`, since that package ships in the
production runtime bundle and this is test-only code. Throws a plain
`UnsafeTestDatabaseTargetError` (`code: "UNSAFE_TEST_DATABASE_TARGET"`,
never includes the URL's credential portion) unless `NODE_ENV=test`, host is
`localhost`, port is the isolated `55433`, and the database name ends in
`_test`. The one existing call site now imports this instead of its own
inline copy — same behavior, now shared and independently tested.

6 new unit tests (`safe-test-db-guard.test.ts`, no real DB needed — this only
checks the guard's own decision logic): (A) the real isolated test DB is
accepted; (B) a dev-like DB on the dev port is rejected; (B2) a non-`_test`
name on the right port is also rejected; (C) `NODE_ENV` not `"test"` is
rejected even against an otherwise-valid URL; (D) the thrown message never
contains the credential portion; (E) a remote (non-localhost) host is rejected
even with the right port/name pattern. **6/6 pass.**

This guard is not yet retrofitted into every other DB-mutating integration
test in the repo — that is a large, separate, mechanical pass across many
files and is recorded here as a documented recommendation, not silently
built (per the scope-control rule against turning a P2 into an unbounded
rewrite).

## 6. N6 test architecture

**adoptPlan (§2 N6a):** the day-count/invented-exercise/empty-day invariants
are ai-service's own logic (reachable only after a real cross-service
mappability gate). Classified **SERVICE-INTEGRATION gated behind an unrelated
CROSS-SERVICE-INTEGRATION check** — fixed by stubbing
`marketplaceDeps.validateMarketplaceSchedulesMappable` to report the listing
as mappable, the exact same pattern this file already uses for
`hasCompletedCycleForPlan`/`fetchPtMarketplaceEligibility`. The real
cross-service check in production is untouched. **Result: 11/11 pass**
(all tests in the file, not just the 3 previously-failing ones).

**plan-generation-equipment (§2 N6b):** classified **CROSS-SERVICE-INTEGRATION
by design** (the file's own header says so — it needs fitness-service's real
candidate fetch + the real deterministic equipment validator + real
persistence). Hardened the spawn/readiness harness: a pre-spawn port-
occupancy check (fails fast with a clear reason instead of silently reusing or
hanging on a stale process), child `error`/`exit` listeners that report
immediately with the exit code/signal and the last ~4000 chars of captured
output (instead of a blind, generic 30 s timeout). **Result: 3/3 pass**
(all three personas — bodyweight, home-gym, commercial-gym — complete for
real, including a real LLM call (mock provider), real BullMQ job, real
fitness-service candidate fetch, and the real
`/internal/exercises/validate-plan-equipment` final safety net).

## 7. N7 model-test alignment

`llm-provider-ollama-regression.test.ts` now imports the real
`llm.LLM_MODEL`/`llm.EMBEDDING_MODEL` (resolved by `llm.service.ts` from
`DEFAULT_LLM_MODEL_BY_PROVIDER`/env, the same source of truth the runtime
itself uses) instead of a hardcoded `"llama3.2:3b"`, both in the mock
`/api/tags` response and in the chat-payload assertion. **4/4 pass.**

## 8. Deterministic suite results (ai-service)

`npx tsc --noEmit` → 0 errors. Full `src/__tests__/*.test.ts` (100 files,
including every new R2 test file), isolated `*_test` DB,
`FITNESS_DISABLE_REDIS=true`, `LLM_PROVIDER=mock`, `DEBUG_AI_PLAN=true`:

**987 pass / 0 fail / exit 0.** Every one of N6/N7's previously-failing tests
now passes for real (not "same known failures," genuinely closed), and no new
failures appeared anywhere else in the suite.

## 9. HTTP environment

Brought up via `test/ai-chat-full-verification/stack.mjs` — real application
services as host processes against the isolated `*_test` Postgres/Redis, real
JWT auth, real HTTP between services, no stubs. **Infra safety note:**
`stack.mjs`'s own ports (3000-3007) collide with this host's actual dev Docker
containers (`gymcoach-*-dev`), which this session relies on for other work;
its own `/health`-based "already up" check cannot tell them apart. A `curl`
registration attempt briefly reached the real dev gateway before this was
caught — verified (and recorded here) that **nothing was written to the dev
database** (the call failed with a 500 before any commit). Fixed by moving the
whole verification stack to `real port + 10000` (`VERIFICATION_STACK_PORT_OFFSET`,
default 10000), confirmed free before use, with the offset and the reason
documented directly in `stack.mjs`. The verification stack was stopped at the
end of this session (`stack.mjs down` + a manual check that every offset port
is free again); it does not run persistently.

## 10. H1 — workout creation (real HTTP)

Through `/ai/ask` → `/ai/agent/actions/:id/confirm`, user with
`dumbbell+bodyweight` equipment: draft preview → nothing persisted before
confirm → revision ("Đổi squat.") reuses the same pending action → confirm
succeeds → exactly one `COMPLETED` action → replaying the same confirm over
HTTP does not duplicate it. **The first run surfaced the new P1 substitution
bug in §2** (confirm failed with `Unable to map AI exercises to exercise
master: ... (not_found)` — a STAGING exercise had been offered as a
substitute). After the fix (§2/§6 of the reproduction table — this is the
`exercise-substitution.service.ts` fix), re-run end-to-end: **6/6 assertions
pass**, including the replay-does-not-duplicate check.

## 11. H2 — cross-domain interruption (real HTTP)

Under default flags (`CONVERSATIONAL_INTELLIGENCE_V2=off`), a mid-workflow
message that would elsewhere be a state-read question ("Mục tiêu dinh dưỡng
hiện tại của tôi là gì?") is instead treated as a non-matching answer to the
pending slot and the legacy slot-collection loop just re-asks for it — this is
existing, documented, by-design behavior (`agent-workflow/orchestrator.ts`:
the semantic/interruption path is explicitly gated `if (ciMode() !== "off")`),
not a regression. Re-tested with `CONVERSATIONAL_INTELLIGENCE_V2=on` (the mode
this capability actually belongs to): the interrupting nutrition question gets
its own real, correct answer (real macro numbers) *and* a reminder that the
workout workflow is still pending; the workflow row itself is byte-for-byte
unchanged by the interruption; answering the original slot afterward resumes
the same workflow into a real preview. **3/3 pass** (under CI-V2=on).

## 12. H3 — cross-user isolation (real HTTP)

A stranger confirming the owner's pending action gets **404 "Action not
found"** (the stranger has no visibility into it at all, not merely a
rejected mutation) — confirmed via the real DB that the owner's action was
not completed by the attempt. A stranger's own chat message referencing
nothing from the owner's session leaves the owner's draft payload
byte-for-byte unchanged. The real owner can still confirm afterward. **3/3
pass.**

## 13. H4 — duplicate confirm (real HTTP)

Sequential: two real HTTP confirms against the same action both return, but
exactly one `COMPLETED` row exists. Concurrent (`Promise.allSettled`, two
simultaneous confirms against a second real pending action): one request got
a real `409 "Action is already being executed — please wait a moment"`, the
other completed normally — a real, observed lock, not an assumption from
status codes alone; the DB confirms exactly one `COMPLETED` row. **2/2 pass.**

## 14. H5 — downstream failure (real HTTP)

This verification stack's own fitness-service process (never the real dev
container) was stopped to simulate a downstream outage. Confirming a real
pending action during the outage returned a non-200 (truthful failure) and
left the action **not** completed — no false "saved" response. fitness-service
was then restarted and polled back to healthy. **2/2 pass.**

## 15. H6 — equipment validator unavailable (real HTTP)

With fitness-service fully down (a more severe failure than N4's specific
"validator alone fails, everything else OK" scenario — which is covered
directly by the N4 unit tests, §4), draft generation itself fails with a
truthful message ("Mình chưa tạo được lịch tập phù hợp lúc này...") — never
an invented/hallucinated plan, never a crash. No authoritative persistence
happened from the attempt. fitness-service was then restored and confirmed
healthy (same restart as H5). **2/2 pass.**

## 16. Off/shadow/on evidence

- **Off (default):** `bounded-turn-route-parity.test.ts`'s own "flag OFF
  (default): PT composite gets the existing offer-only answer — byte-identical
  to pre-Batch-3 behavior" — passing in the §8 full regression.
- **Shadow:** the same file's "flag SHADOW: identical visible answer to OFF —
  the plan is computed/logged but the executor never runs" — passing in §8.
  Code-confirmed: `unifiedCoachMode() === "on"` is the sole gate for the
  bounded-turn-executor's visible-behavior change
  (`fitness-agent.service.ts:763,823`); shadow/off never reach it.
- **On:** `unified-ai-coach-e2e.test.ts` (multi-intent, revision,
  interruption/resume, confirmation, unsupported-capability truthfulness) —
  all passing in §8, `GYMINI_UNIFIED_AI_COACH=on`.

These are existing, dedicated automated tests (BACKEND INTEGRATION evidence,
re-confirmed passing in this session's own §8 run), not a fresh live-HTTP
probe for every mode — H1-H6 already cover real HTTP for the default/off
configuration; a full live-HTTP re-run of every flag combination was judged
unnecessary additional scope given this existing, currently-green coverage.

## 17. Real Qwen smoke

Model confirmed exact: `qwen3:4b-instruct-2507-q4_K_M` (`ollama list`, digest
`0edcdef34593`). Against the verification stack's ai-service with
`LLM_PROVIDER=ollama`, default (off) flags, real HTTP:

- A nutrition-overview question produced a real, successful `GENERATION` call
  (`provider: ollama`, `model: qwen3:4b-instruct-2507-q4_K_M`, `outcome: ok`).
- A genuine general-knowledge question ("Tại sao nên ngủ đủ giấc...") produced
  a real `GENERAL_QA` call that timed out at exactly the configured 45 s
  budget on this CPU host and correctly fell back to the truthful
  "Tạm thời AI chưa sẵn sàng..." message — consistent with R1's already-
  documented finding for this exact host, not a new or worsened issue.
- Narration real-model evidence (PT and Program) was already gathered in
  R1.1 (`docs/ai-product/phase3-rollout-r1-1-narration.md` §I/§J) and is not
  repeated here; it is unaffected by any R2 change.
- The typed semantic-routing Qwen fallback was not separately re-probed live
  in R2 — R1 already produced thorough real-model evidence for it
  (`phase3-rollout-r1-routing-llm.md`) and no R2 change touched
  `llm-route.ts`/the router.

Per instruction, the core deterministic/live-HTTP suites (§8-16) do not
depend on Qwen being available.

## 18. Full regression (current HEAD)

Re-verified before this section: `git rev-parse HEAD` ==
`71d2adf7b3e26b078cc229c060b2a6465516af40` (== START_HEAD — unchanged
throughout R2).

- **ai-service:** `tsc` 0 errors; 987/987 pass, 0 fail (§8, unchanged at
  completion).
- **fitness-service:** `tsc` 0 errors. This was the first time its full suite
  was ever run end-to-end in this session (previously only individual files
  were run). Three progressively more controlled runs were needed to get an
  honest reading:
  1. Concurrently with the live verification stack's 5 host processes still
     up → 42 failing markers (21 distinct names), all plain
     `'test timed out after 20000ms'`.
  2. Verification stack stopped, full suite alone (still node:test's default
     concurrent-file execution) → still 42 markers failing, but a
     **different** set of specific names/counts than run 1 — itself evidence
     of non-deterministic contention rather than a real regression (a real
     code defect reproduces the same way every time; this did not).
     Spot-check: `equipment-filtering.integration.test.ts` (source of two of
     the timed-out names) run completely alone: **4/4 pass in ~5 s** (vs. the
     ~20 s timeout it hit inside the full concurrent glob) — confirming
     DB/connection contention between many concurrently-spawned test-isolated
     child processes sharing one Postgres instance, not a code problem.
  3. Full suite with `--test-concurrency=1` (sequential files, same isolated
     DB, same env) → **914 pass / 36 markers fail (18 distinct names), exit
     1**. Every timeout-based failure from runs 1-2 is gone. The 18 that
     remain are genuine, reproducible, non-timeout failures — see below.

## 9b. The 18 remaining fitness-service failures — root cause

All 18 were investigated by reading their actual assertion output, not just
their names. Representative examples:

```
listExercises: loggingMode filter only returns exercises with that exact mode
  AssertionError: expected at least one TIME-logged exercise in the seeded catalog

getFilterOptions: returns real source and food form values from the catalog
  AssertionError: expected at least one real food form
```

These are **seed-data completeness gaps in this long-lived, shared isolated
test database** (`gymcoach_fitness_test` on `:55433`), not logic defects: the
tests expect specific catalog content (a `TIME`-logged exercise, specific
food-form values, certain cycle/InBody/nutrition-substitution fixtures) that
this particular database instance's accumulated state — built up incrementally
across many ad hoc sessions over many days, never a single from-scratch
reseed — does not currently have. **None of the 18 are in, or call into, any
of the three files R2 touched** (`redis.ts`, `exercise.repository.ts`,
`exercise-substitution.service.ts`) — confirmed by reading each failing
test's own file and call path. The dedicated regression tests for R2's actual
changes (`redis-error-resilience.test.ts` 5/5,
`fitness-agent-equipment-preview-degraded.test.ts` 5/5 (ai-service),
`exercise-substitution.test.ts` 10/10, `safe-test-db-guard.test.ts` 6/6) all
pass cleanly, including inside this same sequential full run.

This is new information surfaced only because R2 is the first time this
suite was run end-to-end — not a regression, and not something R2's hard
scope (narrow, named fixes) covers fixing. Recorded honestly here rather than
silently run around; a full reseed/data-audit of `gymcoach_fitness_test` is a
separate, out-of-scope piece of work (§20).

## 19. Exact remaining failures

**ai-service: none** (987/987, §8).

**fitness-service (18, all seed-data gaps, §9b, none in an R2-touched file):**
`Start cycle (DRAFT -> ACTIVE)`; `Ghi InBody (link a real InBody entry to the
cycle)`; `Adaptive Training Cycle Evaluation — full 9-step lifecycle`;
`HIGHER_PROTEIN: every candidate has strictly higher protein-per-100g than the
current item`; `REPLACE: swapping ức gà (protein role) returns a different
protein food, calorie-equivalent quantity`; `VEGETARIAN: LACTO_OVO mode may
include trứng-derived candidates; VEGAN mode never does`; `backfill: a known
powder/isolate food is classified as a supplement with a tight serving cap`;
`backfill: hard cheese (Parmesan) gets a tight 40g cap`; `desiredFoodName:
resolves the SPECIFIC named food ("cá hồi" -> salmon), not a pool pick,
calorie-equivalent quantity`; `getFilterOptions: returns real source and food
form values from the catalog`; `listExercises: loggingMode filter only
returns exercises with that exact mode`; `listFoods: source and foodForm
filters only return matching rows`; `region personalization: NAM region
reorders REPLACE candidates toward cá basa/tôm over the national default
order`; `runUpcomingReminderSweep (real deps): finds today's not-started
session, marks it, never re-fires on a second run`; `substituteMealItem:
applies the SPECIFICALLY named replacement in one call, no confirm step, and
the day/meal totals stay correct`; `substituteMealItem: mealHint narrows an
otherwise-ambiguous match down to one meal`; `substituteMealItem: no
desiredFoodMention -> falls back to the pool-based REPLACE engine, still
applies directly`; `substituteMealItem: resolvedMealId (the follow-up call
after AMBIGUOUS_MEAL) targets exactly that meal`.

## 20. Remaining rollout blockers

- General-QA latency on this CPU host: unchanged from R1/R1.1 (hardware/
  prompt-size, not a code defect) — the one item keeping the rollout
  recommendation at shadow-only rather than controlled.
- N5's guard exists and is tested but is not yet adopted by every existing
  DB-mutating integration test — a recommended follow-up, not built here.
- H2 confirms cross-domain interruption during active slot-collection is a
  `CONVERSATIONAL_INTELLIGENCE_V2`-gated capability, not available under
  default flags — by design, not a defect, but worth being explicit about for
  anyone assuming it works everywhere.
- fitness-service's `gymcoach_fitness_test` database has accumulated seed-data
  gaps (§9b, 18 named failures) from being a long-lived, incrementally-seeded
  shared instance rather than a single from-scratch seed. Recommend a
  from-scratch reseed + full-suite baseline as a separate, dedicated piece of
  work — not part of R2's narrow scope, and not a product-code defect.
- None of R2's gate conditions (§30 of the original instructions — Redis
  crash, test-isolation guarantee, cross-user HTTP isolation, confirmation
  bypass, duplicate mutation, misleading equipment-validator-outage draft,
  false-success downstream write, unstable HEAD) were triggered.

## 21. R2 verdict

**`R2_PLATFORM_VERIFICATION_CLOSED`**

All five originally-scoped items (N1, N4, N5, N6, N7) are reproduced with real
evidence, fixed, and covered by new tests that pass (26 new tests across 4 new
test files, all green). A sixth, previously-undocumented P1 defect
(exercise-substitution offering a non-`PUBLISHED` exercise, breaking confirm)
was found only because real HTTP verification (H1) was run, and is now fixed
and regression-tested. All six HTTP journeys (H1-H6) pass against a real,
isolated, non-mocked stack. A real Qwen3 4B smoke confirms both a successful
and a truthfully-bounded-and-fallback model call. ai-service's full
deterministic suite is 987/987 clean. fitness-service's full suite, run for
the first time end-to-end in this session, surfaces pre-existing seed-data
gaps unrelated to any R2 change (§9b/§19) — reported honestly, not hidden, and
explicitly out of R2's scope to fix. HEAD never moved
(`71d2adf7b3e26b078cc229c060b2a6465516af40` throughout). Production defaults
are unchanged.

## 22. Rollout recommendation

**`UNIFIED_AI_READY_FOR_SHADOW_ONLY`** (unchanged from Batch 5/R1/R1.1).

R2 closes every platform-safety/data-integrity blocker that would have stood
in the way of even a shadow or controlled rollout (crash resilience, test
isolation, cross-user isolation, confirmation/duplicate-mutation safety,
truthful degraded behavior under a real dependency outage) — plus finds and
fixes a real, previously-unknown data-integrity bug (the STAGING-exercise
substitution defect) that a controlled rollout would otherwise have hit in
production. The one thing still keeping this at shadow-only rather than
controlled is unchanged from R1: on this CPU host, a general-knowledge
question with the full RAG prompt does not reliably finish inside its budget
and falls back — truthfully, safely, but not yet an acceptable user
experience for a broader controlled rollout. That is a hardware/prompt-size
trade-off, not something R2 (or any of R1/R1.1) was scoped to fix.
