# Phase 3 — Batch 4: Conversational Revision + Safe Action Proposals — Completion Report

**Implementation owner**: Claude Code. **Date**: 2026-10-05. Engineering report, not a research artifact.

## 1. Starting limitation

Batches 1-3 built the read foundation, the canonical turn type, and bounded multi-intent composition.
Investigation at the start of this batch (reading the real code, not assuming) found the real starting
state much further along than the brief's scaffolding implied:

- **PT/PROGRAM budget & constraint refinement already worked.** `fitness-agent.service.ts`'s standalone
  recommend flow already merges `previous.contextSnapshot.preferences` with the current turn's extracted
  preferences before re-searching and persisting a new `fitnessRecommendation` row — so "PT đầu tiên đắt
  quá, dưới 2 triệu thôi" (contains the literal word "PT") already worked before this batch.
- **`fitnessRecommendation`** (`schema.prisma`) is the real, already-persisted structured snapshot the
  brief's §10 asks about — `candidateIds`, `contextSnapshot.preferences`, the full `result` block, scoped
  by `(userId, sessionId)`. `SELECT` already resolves against only the **latest** row, which already
  gives stale-proposal safety for free.
- **Workout draft revision** (`tryReviseWorkoutPlanDraft`) already supported day-count change, weekday
  change, session-length retrim, day-intensity reduction, named-exercise exclusion/swap (the brief's own
  "Tôi không có máy cable" example is a doc-commented example of this exact mechanism — REMOVE_EQUIPMENT
  already worked), and a broad resubstitution fallback — all revising the **same** `FitnessAgentAction`
  row in place, which already gives T20's stale-confirmation safety by construction.
- **Nutrition draft revision** (`tryPollOrReviseNutritionPlanDraft`) already supported mealsPerDay +/-1
  and constraint/dietary-preference changes, same in-place-update pattern. Critically, its own doc comment
  ("M3") states a hard, already-enforced invariant: **the calorie/macro target is never chosen by this
  chat layer or by the LLM** — it is always either the real ACTIVE `NutritionGoal` or the same
  deterministic profile-based calculation fitness-service's onboarding computes. Even the existing
  revision path re-resolves the authoritative target fresh on every revision; it never lets free text
  override the number. This materially changed this batch's nutrition scope (§9).

The real gaps this batch needed to build: candidate exclusion (no existing mechanism at all — no
`excludeIds` field anywhere, and exclusion language like "Không thích người thứ hai" contains no
"pt"/"chương trình" keyword so it never even reached the recommend flow); ordinal reference beyond "first"
(`signals.ts`'s `FIRST_ITEM` detector only matched "đầu tiên/thứ nhất/so 1"); the nutrition hypothetical-
vs-real-change distinction; an honest guard against falsely claiming a permanent program-template change;
and the `RevisionRequest` typed contract tying these together.

## 2. Revision architecture

Three new, independent revision modules under `services/revision/`, each a thin layer over existing
primitives, plus one new additive hook in `fitness-agent.service.ts` (same pattern as Batch 3's bounded-
turn hook):

- `pt-program-revision.ts::tryReviseRecommendation` — PT/PROGRAM candidate exclusion and constraint
  refinement.
- `nutrition-revision.ts::tryReviseNutritionTarget` — hypothetical calorie comparison and the honest
  real-change-is-unsupported explanation.
- `workout-guards.ts::tryExplainUnsupportedPermanentSwap` — the honest permanent-swap guard.
- `reference-resolution.ts`, `target-resolution.ts`, `diff.ts`, `types.ts` — shared, pure utilities.

All three entry points are flag-gated: they only run when `GYMINI_UNIFIED_AI_COACH === "on"`, inserted in
`fitness-agent.service.ts::tryTurnUnguarded` right after the existing `routePendingDraftTurn` call and
before the food-substitution/meal-log checks — the exact same insertion point and style as Batch 3's
bounded-turn hook, so with the flag off/shadow the turn falls through to byte-identical pre-Batch-4
behavior.

## 3. RevisionRequest contract

`services/revision/types.ts` — typed discriminated unions, never `{target: string, change: any}`:
`RevisionTarget` (`PT_RECOMMENDATION`/`PROGRAM_RECOMMENDATION` with `recommendationId`+`candidateIds`,
`WORKOUT_DRAFT`/`NUTRITION_DRAFT`/`PENDING_ACTION` with `actionId`, or `UNKNOWN`), `RevisionChangeKind` (a
closed, allowlisted enum — only operations with a real backing mechanism; see §5 for what's deliberately
excluded), `RevisionChange { kind, sourceText, ordinal?, value? }`, and `RevisionRequest { target, changes,
ambiguous, ambiguityReason? }`.

## 4. Supported domains/revision kinds

| Domain | Kind | Status |
|---|---|---|
| PT | `LOWER_MAX_BUDGET`, `CHANGE_AVAILABILITY_REQUIREMENT` | already worked (preference merge) |
| PT | `EXCLUDE_PT` | **new this batch** |
| PROGRAM | `CHANGE_DAYS_PER_WEEK`, `CHANGE_GOAL` | already worked (preference merge) |
| PROGRAM | `EXCLUDE_PROGRAM` | **new this batch** |
| Workout draft | `CHANGE_SESSIONS_PER_WEEK`, `CHANGE_DURATION`, `CHANGE_TRAINING_DAY`, `REDUCE_SESSION_VOLUME`, `REPLACE_EXERCISE_IN_DRAFT`, `REMOVE_EQUIPMENT` | already worked |
| Nutrition | hypothetical calorie comparison | **new this batch**, zero writes |
| Nutrition | `CHANGE_MEAL_CONSTRAINT`, `CHANGE_DIETARY_PREFERENCE` | already worked |

## 5. Unsupported/deferred revisions

- **Permanent active-program exercise replacement** — reconfirmed this batch: no fitness-service endpoint
  exists for "replace exercise X in my ACTIVE program going forward" (same finding as Batch 3 §10). A new
  guard (`workout-guards.ts`) answers honestly instead of letting the turn fall through to generic chat,
  which risked exactly the documented hallucination (claiming a change that never happened).
- **`CHANGE_CALORIE_TARGET` as a direct override** — investigated and deliberately NOT built. `PUT /goals`
  (`nutritionController.upsertGoal`) is technically reachable from ai-service's `domain()` helper (it
  already sends the same `x-gateway-secret`/`x-user-id` headers that satisfy `authMiddleware`'s
  `readGatewayVerifiedUser` fast path — confirmed by reading `gatewayTrust.ts`), but it enforces a real
  macro/calorie consistency check that a bare "change calories to 1900" cannot safely satisfy without this
  chat layer inventing a nutrition-science rebalancing formula — exactly what the existing codebase's own
  "M3" invariant already forbids (calorie/macro targets are never chosen by chat/LLM). Honoring this
  literally would mean building a second, competing nutrition-science authority. Deferred, with an honest
  explanation shown to the user instead.
- `CHANGE_SPECIALTY`, `CHANGE_GENDER_PREFERENCE`, program `CHANGE_EQUIPMENT`, `CHANGE_MACRO_PREFERENCE` —
  no backing field in `AgentPreferences`/the program-search tool today. Not added (brief §6: "do not
  create fake capabilities to fill the enum").
- **`ADD_EQUIPMENT` to a pending workout draft** — investigated and also deliberately not built. Equipment
  compatibility is validated entirely server-side (`fitnessAgentTools.validatePlanEquipment`, against the
  user's REAL profile equipment) — a client-local draft-only override would be silently ineffective (the
  real validator would never see it), so building it would mean a capability that *looks* like it works but
  doesn't. A correct implementation needs a real profile write, a bigger and more deliberate decision this
  batch did not take.

## 6. Target resolution

`services/revision/target-resolution.ts::resolveRevisionTarget` implements the brief's exact §9 priority
ladder (pending workout/nutrition draft → latest PT/PROGRAM recommendation → UNKNOWN), always scoped by
the caller's own `identity.userId`. **Important finding from implementation**: this generic ladder, used
as the single gate for every revision module, produced a real bug caught by this batch's own cross-domain
test — an unrelated pending NUTRITION draft would unconditionally outrank a clearly PT-signaled revision
("Không thích người thứ hai"), silently blocking it. `pt-program-revision.ts` therefore queries the latest
PT/PROGRAM `fitnessRecommendation` directly instead of going through tier-1 first — each domain-specific
revision module determines its own applicability from a domain-specific signal (ordinal+exclude cue, or a
recognized constraint phrase) rather than deferring to a single generic ladder. `resolveRevisionTarget`
remains available and directly tested (`__tests__/revision-target-resolution.test.ts`) as the ladder the
brief specifies — useful for a future cross-domain "ambiguous target" clarification layer — but the live
dispatch uses the more precise per-module checks this batch actually needed.

## 7. PT revisions

`services/revision/pt-program-revision.ts`. Detects an ordinal reference (`reference-resolution.ts`) +
exclude cue, or a recognized constraint phrase (budget/days, via `parseConstraintPhrase`, factored out of
`fitness-agent-intent.ts` so both the legacy branch and this module share one definition). On exclusion: the
referenced candidate id is resolved from the LATEST `fitnessRecommendation.candidateIds` (never guessed; an
out-of-range ordinal gets a clarification, never a hallucinated exclusion), merged with any prior
`excludeIds` already on file, and the **same, unmodified** retrieval → `scorePT` → narrate → persist
pipeline is reused (factored out of the existing standalone recommend flow into
`buildAndPersistRecommendation`, now shared by both the legacy branch and this module — `scorePT` itself
was never touched; exclusion filters the candidate list BEFORE scoring). Never hires a PT, never creates a
business mutation — only a new `fitnessRecommendation` row, the same side effect any ordinary re-search
already has.

## 8. Program revisions

Identical mechanism, parameterized by `kind="PROGRAM"` — `EXCLUDE_PROGRAM` filters before
`scoreTrainingProgramV2` (also unmodified). `CHANGE_DAYS_PER_WEEK`/`CHANGE_GOAL` already worked via the
existing preference-merge in the standalone recommend flow.

## 9. Nutrition revisions

`services/revision/nutrition-revision.ts`. Distinguishes hypothetical ("nếu 1900 thì sao?") from a real
change request by cue pattern, not by magnitude. Hypothetical: reads the real authoritative target
(`resolveNutritionTarget`, unchanged) and answers with a deterministic kcal delta/comparison — zero writes,
zero proposal, by construction (the function returns before touching any action/draft). Real change: given
the "M3" invariant (§1), there is no safe mechanism to honor an arbitrary chat-specified number, so the
answer explains this honestly (names the real current target and its source) and creates nothing — safer
than a fake pending proposal a user could later "confirm" into nothing happening.

## 10. Workout draft revisions

No new revision mechanism — `tryReviseWorkoutPlanDraft` already covered every required case except the
honest permanent-swap guard (§11). Equipment addition was investigated and found ineffective to implement
safely this batch (§5).

## 11. Recommendation → proposal boundary

Preserved exactly: `tryReviseRecommendation`/`tryReviseNutritionTarget` never create a `FitnessAgentAction`
— they only ever produce a new `fitnessRecommendation` row (read-only until the existing `SELECT`/
`prepare()`/`execute()` flow is invoked by the user, unchanged) or a plain text answer. The
permanent-swap guard creates nothing at all. No new proposal type was introduced that didn't already map to
an existing, reviewed write boundary.

## 12. Stale-proposal behavior

No new mechanism needed. `tryReviseWorkoutPlanDraft`/`tryPollOrReviseNutritionPlanDraft` already revise the
same `FitnessAgentAction` row in place; confirming always reads whatever is currently stored. `SELECT`
always resolves against the latest `fitnessRecommendation` row for the session. This batch added a focused
test (`__tests__/revision-route-parity.test.ts::"T20/T21..."`) proving this end-to-end via real
`tryTurn()`/`execute()` calls: propose A (5 sessions) → revise to B (3 sessions) → confirm → only B (3
sessions) is ever persisted.

## 13. Structured diff

`services/revision/diff.ts` — `RecommendationDiff`, `WorkoutDraftDiff`, `NutritionTargetDiff`, each a small
domain-specific type. `pt-program-revision.ts` computes the diff (excluded candidate ids, constraint
changes, before/after candidate lists) BEFORE building the prose prefix ("Mình đã bỏ lựa chọn bạn không
thích...") — the sentence is templated from the diff, never asked of an LLM to infer from two prose answers.

## 14. LLM call budget

Zero new LLM calls added by the revision layer itself for every deterministic path — confirmed by a
closure-counted spy in `__tests__/revision-route-parity.test.ts::"flag ON..."`: one narration call for the
initial PT search, exactly one more for the revision (the same single call the existing re-search flow
already makes) — never two, never a second "reinterpret" pass. Reference-resolution/target-resolution/diff
modules perform zero I/O and import nothing from `llm.service.ts`/`json_llm_call.util.ts`, verified by
construction (no LLM import) and by the full regression suite showing the exact same pass/fail counts as
the pre-Batch-4 baseline.

## 15. Feature-flag behavior

`GYMINI_UNIFIED_AI_COACH` stays the single flag (default `off`), unchanged from Batch 3.
`__tests__/revision-route-parity.test.ts::"flag OFF..."` proves the exclusion phrase falls through
unchanged (no new `fitnessRecommendation` row, no "Mình đã bỏ..." text) when the flag is off — byte-
identical to pre-Batch-4. `CONVERSATIONAL_INTELLIGENCE_V2`'s own default remains unchanged; none of this
batch's new behavior requires CI-V2 to be on (unlike Batch 3's bounded-turn composite, this batch's hook
lives in the legacy `!effectiveKind` fallback branch, which runs regardless of CI-V2's state).

## 16. Focused tests

```
cd backend/services/ai-service
NODE_ENV=test LLM_PROVIDER=mock DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_test \
  INTERNAL_SERVICE_SECRET=test_internal_service_secret_32_chars_minimum \
  JWT_SECRET=test_jwt_secret_32_chars_minimum_value REDIS_URL=redis://localhost:56379 \
  npx tsx --test src/__tests__/revision-*.test.ts
# -> tests 32, pass 32, fail 0
```
(reference-resolution 4, target-resolution 6, pt-program 7, nutrition 5, workout-guards 4,
route-parity 6 — covering the brief's T05/T07-T22/T26/T27 plus LLM-budget and safety assertions.)

## 17. Regression results

```
npx tsx --test src/__tests__/conversational-intelligence-{global,v2,remediation}.test.ts \
  src/__tests__/enterprise-data-layer.test.ts src/__tests__/context-assembler.test.ts \
  src/__tests__/turn-understanding-adapters.test.ts src/__tests__/turn-understanding-route-parity.test.ts \
  src/__tests__/bounded-turn-{planner,executor,route-parity}.test.ts \
  src/__tests__/agent-workflow-*.test.ts src/__tests__/fitness-agent-*.test.ts \
  src/__tests__/nutrition-goal-authority-in-chat.test.ts
# -> tests 261, pass 260, fail 1 (the same single pre-existing failure — "selection wording is unchanged" —
#    documented since the Batch 2/3 baseline; zero new failures)

LLM_PROVIDER=mock npx tsx --test src/__tests__/*.test.ts  (full suite)
# -> tests 892, pass 882, fail 6, skipped 4  (duration ~41.6s, single clean run)
```
892 = 860 (Batch 3 baseline) + 32 new. The 6 failures are the exact same 6, by name, as the Batch 3
baseline (Ollama model-name drift x2, the "selection wording" workout test, and the 3 equipment-persona
Pipeline-B tests) — zero new failures, 4 skipped unchanged.

## 18. Intentional user-visible changes

All flag-gated (`GYMINI_UNIFIED_AI_COACH=on`, default off):
- "Không thích [PT thứ N / chương trình thứ N], còn ai khác?" after a PT/PROGRAM recommendation now
  excludes that candidate and shows a revised shortlist, instead of falling through to generic chat.
- "Đổi [tên bài tập] luôn" (or similar permanence phrasing) with no pending workout draft now gets an
  honest explanation of the real limitation, instead of risking a hallucinated "đã đổi" claim from generic
  chat.
- "X kcal hơi cao, nếu Y thì sao?" now gets a deterministic comparison against the real authoritative
  target instead of either being misrouted or (if it fell through to generic chat) risking an invented
  number.
- "Đổi mục tiêu xuống X kcal" (a real-change request) now gets an honest explanation of why chat can't set
  an arbitrary target, instead of silently doing nothing or (worse) a generic-chat hallucination.

With the flag off or on a turn none of the above match, behavior is unchanged.

## 19. Remaining unsupported business mutations

- Permanent active-program exercise replacement (needs a real fitness-service write endpoint — a product/
  architecture decision, not an engineering one).
- Direct arbitrary-number `NutritionGoal` override via chat (would require this chat layer to own macro-
  rebalancing math — a deliberate non-goal, protecting the existing "M3" invariant).
- `ADD_EQUIPMENT` to a workout draft (would need a real profile write to have any effect, since equipment
  validation is 100% server-side).
- `CHANGE_SPECIALTY`/`CHANGE_GENDER_PREFERENCE`/program `CHANGE_EQUIPMENT`/`CHANGE_MACRO_PREFERENCE` (no
  backing data field anywhere today).

## 20. Batch 5 readiness

If a future batch wants to pursue the permanent-swap or direct-nutrition-override capabilities, the entry
point is the same product decision Batch 3 already flagged: who owns building the real write endpoint, and
whether the product wants chat to ever set an authoritative nutrition number directly (changing the "M3"
invariant is a product/safety decision, not something to route around in a future batch's engineering).
Separately, `target-resolution.ts`'s generic priority ladder is built, tested, and available — a future
batch building a true cross-domain "ambiguous target, please clarify" layer (distinguishing it from each
domain module's own narrower, more precise check) has a tested starting point rather than nothing.

**Stop after Batch 4. Batch 5 is not started.**
