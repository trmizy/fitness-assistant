# Phase 3 — Batch 1: Authoritative Context Foundation — Completion Report

**Implementation owner**: Claude Code. **Date**: 2026-10-05. Engineering report, not a research artifact.

## 1. Starting problem

`docs/ai-product/phase3-current-ai-map.md` found no consolidated "Enterprise Data Agent" in ai-service: 5-6
independent HTTP paths re-derive the same facts about the same user, with inconsistent validation — only
`profile_extractor.ts` guarded the nutrition goal against fitness-service's id-less `DEFAULT_NUTRITION_GOAL`
placeholder; `conversational-intelligence/global/readers.ts` and `llm/nutrition_context.ts` did not, so either
could show a placeholder/superseded goal as the user's real saved target.

## 2. Architecture implemented

```
services/enterprise-data/{types,profile.reader,nutrition.reader,workout.reader}.ts   (new)
services/context-assembler.ts                                                        (new)
```
Deterministic typed application code only — no LLM call anywhere in this layer. The Enterprise Data Layer's
profile/goal/workout-program/nutrition-program readers are thin projections over the **existing**
`profileExtractor.extract()` (not a parallel re-implementation); the nutrition-goal-history and workout-
schedule/recent-history readers make their own direct, typed HTTP calls for data `profileExtractor.extract()`
doesn't already fetch in that shape. `AuthoritativeRead<T>` never collapses "absent" (fetched fine, nothing
there) and "error" (upstream failed).

## 3. Enterprise Data Layer API

- `profile.reader.ts`: `getUserProfile(identity)`, `getCurrentFitnessGoal(identity)`
- `nutrition.reader.ts`: `getActiveNutritionGoal(identity)`, `getLatestNutritionGoal(identity)`,
  `getNutritionGoals(identity)`, `getCurrentNutritionProgram(identity)`
- `workout.reader.ts`: `getCurrentWorkoutProgram(identity)`, `getWorkoutSchedule(identity, range)`,
  `getRecentWorkoutHistory(identity, limit)`
- No equipment reader — there is no authoritative "list my real equipment" endpoint (confirmed again this
  batch); `AssembledContext.equipment` carries a literal `{ status: "validationOnly" }` marker. PT was not
  added — already the cleanest domain (one reader, one search call); adding it here would have been
  unnecessary churn.

## 4. Context Assembler API

```ts
assembleContext(identity, needs: ContextNeed[], opts?: { scheduleRange?, historyLimit? }): Promise<AssembledContext>
```
`ContextNeed` = `PROFILE | FITNESS_GOAL | ACTIVE_NUTRITION_GOAL | CURRENT_WORKOUT_PROGRAM | WORKOUT_SCHEDULE |
RECENT_WORKOUT_HISTORY`. Only the requested readers run; issues zero business mutations (tested, §11 T18).

## 5. Authoritative source mapping

| Fact | Source | Reader |
|---|---|---|
| Profile / fitness goal | user-service `/profile/me` (via `profileExtractor.extract`) | `profile.reader.ts` |
| Active nutrition goal | fitness-service `/nutrition/goals` (via `profileExtractor.extract`, ACTIVE-guarded) | `nutrition.reader.ts::getActiveNutritionGoal` |
| Latest/all nutrition goals | fitness-service `/nutrition/goals`, `/nutrition/goals/history` (direct) | `nutrition.reader.ts` |
| Current workout program (summary) | fitness-service `/workouts/programs/current` (via `profileExtractor.extract`) | `workout.reader.ts::getCurrentWorkoutProgram` |
| Current nutrition program | fitness-service `/nutrition/plans/current` (via `profileExtractor.extract`) | `nutrition.reader.ts::getCurrentNutritionProgram` |
| Workout schedule / recent history | fitness-service `/workouts/schedules`, `/workouts` (direct) | `workout.reader.ts` |
| Equipment | no authoritative endpoint — validation/substitution only | n/a (truthful marker only) |

## 6. Nutrition goal semantics — before vs after

**Before**: 3 independent callers of `/nutrition/goals`, 2 of which (`readers.ts`, `nutrition_context.ts`)
trusted any truthy response, including an id-less DEFAULT placeholder or a stored-but-superseded row.
**After**: all 3 (readers.ts's `readNutritionTarget`, `nutrition_context.ts`'s `fetchGoal`) route through
`getActiveNutritionGoal`, which applies the exact ACTIVE+id+valid-macro guard `profile_extractor.ts` already
used for its own derivation. **Intentional behavior change** (not hidden as refactoring, per the brief's §19):
a user with a stored-but-not-ACTIVE nutrition goal now correctly hears "you haven't set a nutrition goal yet"
from these two paths instead of being shown the superseded numbers. `getLatestNutritionGoal`/`getNutritionGoals`
were added as the two other unambiguous operations the brief's §7 asked for, using the previously-unused
`GET /nutrition/goals/history` endpoint for the latter — no current caller needs either yet.

## 7. Request-scoped deduplication

Implemented by making `profile_extractor.ts`'s existing per-user cache coalesce **in-flight** calls (not only
already-completed ones): a new `inFlight: Map<userId, Promise<PersonalizationContext>>`, checked after the
existing 15s TTL cache and before starting a new fetch, cleared via `.finally()` regardless of outcome. This
means `PROFILE`/`FITNESS_GOAL`/`ACTIVE_NUTRITION_GOAL`/`CURRENT_WORKOUT_PROGRAM` share exactly one upstream
batch whenever two of them are requested close together — proven with a real HTTP-call-count test (§11), not
assumed. `WORKOUT_SCHEDULE`/`RECENT_WORKOUT_HISTORY` have no such cache — a known, stated limitation (§14), not
a silent gap, since neither was found to be independently duplicated within one turn today.

**Deliberate semantics, not redesigned**: a failed sub-fetch (e.g. `/nutrition/goals` rejects) still gets its
`undefined`/failure state cached for the remaining TTL, same as any other field — a retry only happens after
15s. This was already true before this batch; this batch only made it *visible* (via the `error` status) rather
than changing it.

## 8. Call sites migrated

- `conversational-intelligence/global/readers.ts::readNutritionTarget` → `getActiveNutritionGoal`
- `conversational-intelligence/global/readers.ts::readProgram` → `getCurrentWorkoutProgram`
- `conversational-intelligence/global/readers.ts::readNutritionProgram` → `getCurrentNutritionProgram`
- `llm/nutrition_context.ts::fetchGoal` (the goal-fallback leaf only) → `getActiveNutritionGoal`

## 9. Call sites deliberately not migrated

- **`fitness-agent-tools.ts::getUserFitnessContext`** — too high-fan-out (used by `global-turn.ts`'s
  `GlobalDeps`, `agent-workflow/orchestrator.ts`'s `buildContext`, many `fitness-agent.service.ts` methods),
  with a `{profile, coach}` shape many callers depend on exactly. Left alone; a Batch 2+ candidate.
- **`llm/workout_schedule_context.ts::fetchCurrentProgram`** — found during implementation (not assumed from
  the plan) to be genuinely incompatible with the compacted `getCurrentWorkoutProgram` shape:
  `dayContextFromCurrentProgram` needs the program's **real per-day exercises** (names, muscle groups) to
  answer "what should I train today," while `profileExtractor.extract()`'s `currentWorkoutProgram` deliberately
  strips exercises down to a bare count (`daySummaries: [{dayNumber, title, exerciseCount}]`). Migrating this
  call site would have silently degraded that feature's real exercise-name answers to counts. **Correctly
  caught and left unmigrated** per the brief's own "leave it and document why" instruction — this is the one
  place the plan's original assumption (reuse the compacted shape everywhere) turned out to be wrong, and
  inspection during implementation (not the plan itself) caught it before it shipped.
- `fetchSchedules`/`fetchRecentLogs` in the same file — same endpoints the new `getWorkoutSchedule`/
  `getRecentWorkoutHistory` readers wrap, but this file's surrounding date-range/intent-parsing logic was out
  of scope to restructure this batch.
- `profile_extractor.ts`'s own remaining 4 HTTP calls (InBody, raw nutrition logs, daily-consumption-history,
  nutrition-plan-current detail) — not duplicated elsewhere; no value in wrapping yet.
- `user.client.ts::fetchUserGoalAndLevel`, `worker-user-context.ts` — different auth model (internal secret,
  not user JWT) and different consumers (marketplace sort, plan-generation workers); out of this batch's
  same-turn chat-read scope.

## 10. Tests

21 new tests across two files:
- `__tests__/enterprise-data-layer.test.ts` (13 tests) — canonicalization, auth propagation, cross-user
  isolation, and all 3 nutrition-goal semantics cases (active/absent/error) for every reader.
- `__tests__/context-assembler.test.ts` (10 tests) — T09-T18 from the plan: real dedup (not simulated — stubs
  `axios.get`, not `profileExtractor.extract`, so the real caching/coalescing logic actually runs), TTL-cache
  cross-call reuse, cross-user isolation, failure-caching semantics, demand-driven scoping, partial failure,
  zero mutations.

One existing test fixture required a fix, not a weakening: `conversational-intelligence-global.test.ts`'s
`profileExtractor.extract` stub didn't include `nutritionGoal`/`currentWorkoutProgram` (it only needed to
before this batch, since those reads went through `readerDeps.get` instead). Updated the stub to provide the
same fixture values through the now-correct channel — the assertions themselves (exact expected kcal/macro
text) were not changed.

## 11. Exact results

```
cd backend/services/ai-service
NODE_ENV=test DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_test \
  INTERNAL_SERVICE_SECRET=test_internal_service_secret_32_chars_minimum \
  JWT_SECRET=test_jwt_secret_32_chars_minimum_value REDIS_URL=redis://localhost:56379 \
  npx tsx --test src/__tests__/enterprise-data-layer.test.ts src/__tests__/context-assembler.test.ts
# -> tests 21, pass 21, fail 0
```

## 12. Regression

```
npx tsx --test src/__tests__/conversational-intelligence-global.test.ts \
  src/__tests__/conversational-intelligence-v2.test.ts src/__tests__/conversational-intelligence-remediation.test.ts
# -> tests 61, pass 61, fail 0 (CI-V2 routing byte-identical; only the fixture noted in §10 changed)

npx tsx --test src/__tests__/*.test.ts  (full ai-service suite, LLM_PROVIDER=mock, same isolated test DB)
# -> tests 810, pass 800, fail 6, skipped 4
```
The 6 failures are the **exact same 6**, by name, already documented as pre-existing/environmental in Phase
2's and Phase 2B's reports (Ollama model-name drift ×2, Pipeline B/legacy-mode live-fitness-service
requirements ×4) — zero new failures. 810 = 789 (Phase 2B baseline) + 21 new.

## 13. Performance / request-count evidence

Real, counted (not assumed) HTTP-call evidence from `context-assembler.test.ts`:
- Calling `getCurrentWorkoutProgram(identity)` **twice concurrently** for the same user → exactly **1** call to
  `/workouts/programs/current` and **1** to `/profile/me` (previously, before migration, `readers.ts::readProgram`
  made its own independent `/workouts/programs/current` call regardless of whether `profileExtractor.extract`
  had already run in the same turn — this is the real "2→1" case the migration fixes, measured via
  `callLog.filter(...).length`, not inferred).
- `assembleContext(identity, [])` → **0** HTTP calls.
- A second `assembleContext` call for the same user within 15s → **0** additional calls (TTL cache hit).
No latency number is claimed — only the call-count reduction, per the brief's explicit instruction not to
claim a latency improvement from a request-count decrease alone.

## 14. Remaining fragmentation

- `getUserFitnessContext`'s own `/profile/agent/context` call remains separate and uncached (§9).
- The 4 profile_extractor-backed needs (`PROFILE`/`FITNESS_GOAL`/`ACTIVE_NUTRITION_GOAL`/
  `CURRENT_WORKOUT_PROGRAM`) are demand-driven at the **typed-output** level (only the requested fields are
  returned) but **not** at the HTTP level — requesting just `ACTIVE_NUTRITION_GOAL` still triggers
  `profileExtractor.extract()`'s full 8-call batch internally, since that function has no partial-fetch mode.
  Splitting it would be a larger, riskier structural change (and would lose the real efficiency benefit of
  batching when several of these facts ARE needed together, the common case) — deferred to Batch 2.
- `workout_schedule_context.ts`'s own 3 reads (`fetchSchedules`/`fetchCurrentProgram`/`fetchRecentLogs`) and
  `fitness-agent-tools.ts::getTodaySchedule` still make independent calls to overlapping endpoints — not
  migrated this batch (§9).
- `worker-user-context.ts`'s full independent reimplementation (internal-auth path, plan-generation workers)
  was not touched.

## 15. Risks for Batch 2

- Any future attempt to migrate `getUserFitnessContext` must account for its wide fan-out and the exact
  `{profile, coach}` shape callers depend on — a bigger, more carefully staged change than this batch's.
- Splitting `profileExtractor.extract()`'s batch to make the 4 needs truly HTTP-level demand-driven would need
  to preserve its current efficiency win (one round trip when multiple facts are needed) — likely via
  per-sub-resource in-flight/TTL caches inside the same module, not a wholesale rewrite.
- `workout_schedule_context.ts::fetchCurrentProgram` genuinely needs the *raw* program (exercises/muscle
  groups), which `profileExtractor.extract()` doesn't expose — Batch 2 would need either a second,
  uncompacted reader or a restructuring of `profile_extractor.ts` to carry both shapes, with real test coverage
  proving "what should I train today" still names real exercises afterward.
