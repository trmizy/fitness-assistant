# Nutrition agent actions + cycle-evaluation-via-chat — plan (2026-09-07)

**Status (2026-09-07, end of day): all five phases (A-E) built and tested**
(unit + integration everywhere; A/B/E also verified against real dev data,
not just stubs). See the end of this file for the concrete list of what
shipped and two real operational gotchas hit along the way (shared-package
dist staleness; a verification-script artifact that looked like a bug but
wasn't).

Continuation of `00_CURRENT_STATE_AUDIT.md`'s "Nutrition | EXISTS / REUSE"
line and its own "AI | PARTIAL / NEEDS_REFACTOR ... no typed PT matching/
action tools" gap — this closes both for nutrition specifically. Scope
confirmed with the product owner: (1) chat-driven meal-item substitution,
applied in one turn, no separate confirm step; (2) chat-driven cycle
evaluation; (3) scheduled/automatic cycle evaluation as a background job.
Not yet implemented — this is the plan, written before touching code.

## What already exists (reuse, do not rebuild)

| Piece | File | Reuse as |
| --- | --- | --- |
| Agent orchestration pattern | `ai-service/src/services/fitness-agent.service.ts` | `tryTurn`/`prepare`/`execute` shape; new nutrition tools plug into the same `fitnessAgentTools` object and `AgentBlock` union |
| Risk-tiered action kinds | `shared/src/fitness-agent.ts` (`AgentActionKindSchema`, `agentActionRisk`) | Add new kinds here, not a parallel enum |
| Structured chat replies | `frontend/.../stores/pendingAiTasks.ts` (`AgentChatBlock`, `appendAgentReply`) | Same `structuredBlocks` channel already wired into `AICoachPage.tsx` |
| Nutrient-equivalent substitution math | `fitness-service/src/services/nutrition-food-substitution.engine.ts` (`findFoodSubstitute`) | Called as-is; already returns quantity + macros for the new food |
| Persisted meal plan | `NutritionProgram → Day → Meal → MealItem` (schema.prisma) + `PUT /program-meal-items/:itemId` (`nutrition.service.ts:updateMealItem`) | The actual write target for a substitution |
| Cycle evaluation logic | `training-cycle.service.ts:evaluateCycle` → `runVersionedAssessment` (training decision + `evaluateNutritionAdaptive` together) | Called as-is for both chat-triggered and scheduled evaluation — one code path, two triggers |
| LLM-based structured extraction precedent | `ai-service/src/llm/profile_extractor.ts` | Same pattern (LLM extracts mentions, app code resolves/validates against real data, LLM never decides) for food-name extraction |

## Real gaps closed by this plan

1. **No nutrition tool in the agent at all.** `fitness-agent-tools.ts` has zero
   nutrition-related entries (confirmed by direct read, not grep-miss).
2. **Intent parser too narrow.** `fitness-agent-intent.ts` is closed-set regex
   for `PT | PROGRAM | SELECT`; free text like "tôi muốn ăn cá hồi thay ức gà"
   matches none of it. Needs LLM-based mention extraction (see below), not a
   bigger regex.
3. **No food-name → real meal-item resolution.** Nothing today maps a spoken
   food name + vague meal reference onto a specific `NutritionProgramMealItem`
   row in the user's active plan.
4. **Real pre-existing bug, independent of this feature:**
   `nutrition.service.ts:updateMealItem` patches the item's own
   calories/macros but never recomputes the parent `NutritionProgramMeal` or
   `NutritionProgramDay` rollup totals — and the frontend (`CurrentNutrition
   Program.tsx`, `NutritionPage.tsx`) displays those stored rollup fields
   directly, not a client-side re-sum. Any item edit today (manual or via
   this new agent action) leaves the displayed daily/meal kcal stale. **Must
   fix as a prerequisite** — otherwise the new "AI đổi món" feature appears to
   silently produce wrong calorie totals.
5. **No agent path to `evaluateCycle()` at all**, chat or otherwise — confirmed
   by the code's own comment: "user explicitly triggers POST /:id/evaluate,
   nothing runs automatically."
6. **No agent path to accept/reject a nutrition (or training) recommendation.**

## Design

### A. Fix the rollup-recompute bug (prerequisite, small, local)
`updateMealItem` (and `addMealItem`/`deleteMealItem`, same gap) must, inside
the same transaction, re-sum the parent meal's items into
`NutritionProgramMeal.calories/proteinGrams/carbGrams/fatGrams` and the
parent day's meals into `NutritionProgramDay.totalCalories/...`. No schema
change — existing columns, just never kept in sync.

### B. New agent tool: `substituteMealItem`
- Input: `{ currentFoodMention: string, desiredFoodMention: string | null, mode: SubstituteMode, mealHint: string | null }` — `desiredFoodMention` null means "let the engine pick" (existing REPLACE mode default).
- Resolution: match `currentFoodMention` against the active `NutritionProgram`'s items via the existing Vietnamese alias search (same `food_aliases`-backed lookup `nutrition-food-suggestion.engine.ts` already uses) — never fuzzy-match against the LLM's own spelling.
- **Ambiguity rule (confirmed by product owner): if more than one not-yet-completed meal in the active plan contains a matching item, do not guess — return a clarifying question listing the candidate meals** (reusing the existing "SELECT"-style disambiguation UX already used for PT/program candidate picks), instead of picking one.
- Once resolved to exactly one `NutritionProgramMealItem`: call `findFoodSubstitute` (reusing its existing quantity/macro math) → call the (now rollup-fixed) `updateMealItem` directly.
- **No separate confirm step (confirmed by product owner)** — this tool executes and returns an `ACTION_RESULT` block in the same turn, unlike `APPLY_TRAINING_PLAN`/`CREATE_PT_CONTRACT_DRAFT`. Justified by risk: reversible (ask to swap back), free, nutrient-equivalent by construction, never touches calorie/macro targets (only which food fills them) — categorically lower-risk than a training-plan replace, which already skips nothing. New `AgentActionKindSchema` entry `SUBSTITUTE_MEAL_ITEM`, `agentActionRisk` → `"LOW"`.
- Intent extraction: a narrow, single-purpose LLM call (same shape as `profile_extractor.ts`) that ONLY extracts `{currentFoodMention, desiredFoodMention, mealHint}` from the user's message — never decides nutrient safety or picks the actual substitute; that stays 100% in the deterministic engine, matching this repo's own architectural rule everywhere else (engine decides, LLM explains/extracts).

### C. New agent tool: `evaluateCycleForChat`
- Wraps the existing `trainingCycleService.evaluateCycle` verbatim (same call `inbody-reassessment.service.ts` already reuses) — no new decision logic.
- Formats the result using the same label/explanation mappings `cycle-assessment.service.ts` already has for both `NUTRITION_DECISION_LABEL` and the training decision — not a new explanation layer.
- Read-only from the user's point of view (an assessment already always requires separate accept/reject — see D), so this can run directly in `tryTurn` without a `prepare`/`execute` action at all, same as `PT_RECOMMENDATIONS`/`PROGRAM_RECOMMENDATIONS` today.
- Intent: extend `parseFitnessAgentIntent`'s closed set with an `EVALUATE` kind (still plain keyword match — "đánh giá chu kỳ", "chu kỳ tập của tôi thế nào" — this one doesn't need LLM extraction, no free-form parameters to pull out).

### D. New agent tool(s): accept/reject a pending nutrition (or training) recommendation
- Wraps the existing `applyNutritionReviewDecision` (client-side accept path, already used by TrainingCyclePage's Accept/Reject buttons) — no new decision logic, just a chat-callable entry point.
- This one DOES change the active prescription, so it keeps the existing `prepare` → confirm → `execute` action pattern, same tier as `APPLY_TRAINING_PLAN` (`MEDIUM`), new kind `ACCEPT_NUTRITION_RECOMMENDATION` / `REJECT_NUTRITION_RECOMMENDATION`.

### E. Scheduled/automatic cycle evaluation (background job)
- Confirmed in scope for this pass, separate infra piece from A-D.
- Reuses the SAME `evaluateCycle()` call as C — the job is only a new trigger, not new decision logic (same principle as `inbody-reassessment.service.ts`'s auto-trigger on a new InBody entry).
- This repo already has BullMQ wired (`workoutQueue` in `workout.service.ts`, reminder sweeps in the same file) — a new repeating queue job following that existing pattern, not a new job-scheduling mechanism.
- Cadence and "don't spam" gating still to be nailed down at implementation time (candidates: weekly, or gated the same way `inbody-reassessment.service.ts` already gates its own auto-trigger to avoid a no-op assessment generating a notification) — will follow that file's existing "no spam" pattern rather than invent a new one.
- Triggers the existing `CYCLE_REASSESSMENT_READY`-style notification path (already built for the InBody auto-trigger) rather than a new notification type, when the scheduled run actually produces something actionable.

## Order of work

1. Fix the rollup-recompute bug (A) — small, verifiable in isolation, blocks nothing else but should land first so B doesn't ship visibly-broken.
2. `substituteMealItem` tool + intent extraction + `SUBSTITUTE_MEAL_ITEM` action kind (B) — the concrete example the product owner gave.
3. `evaluateCycleForChat` tool + `EVALUATE` intent (C) — smaller than D, no new action-kind plumbing needed.
4. Accept/reject-via-chat tools (D) — reuses C's evaluation output.
5. Scheduled evaluation background job (E) — largest, most independent piece; can start once C's `evaluateCycleForChat` formatting helper exists (E reuses it for the notification body).

## Verification plan

Same standard this session has used throughout: real `node:test` integration
tests per new tool/service function against the test DB, then real
Playwright browser verification of at least the chat flow in B (since that's
the concrete example given) before calling it done — not just source
presence.

## What actually shipped (2026-09-07)

- **A (rollup fix)**: done. `nutrition.service.ts`'s `recomputeMealAndDayTotals`,
  called inside the same transaction as `addMealItem`/`updateMealItem`/
  `deleteMealItem`. 4 integration tests
  (`nutrition-meal-item-rollup.integration.test.ts`).
- **B (substituteMealItem)**: done. `nutrition-food-substitution.engine.ts`
  gained `desiredFoodName` (resolves a SPECIFIC named food via the same
  alias-backed search, not just a pool pick); `nutrition-agent.service.ts`
  (new) resolves a spoken food name against the user's real active plan,
  disambiguates by asking rather than guessing; new route `POST /nutrition/
  agent/substitute-meal-item`; ai-service's `food-substitution-extractor.ts`
  (new, LLM-based mention extraction, same engine-decides/LLM-extracts
  split as the rest of this codebase) + `fitness-agent.service.ts`'s
  `trySubstitution` wire it into chat, applying in one turn (no confirm
  step — product owner's explicit choice, LOW risk). 12 + 8 + 6 tests, and
  real-HTTP-verified against dev (logged in as testuser001, real swap
  applied, rollup confirmed correct in the DB, cleaned up).
- **C (evaluateCycleForChat)**: done, as `tryEvaluateCycle`. Wraps
  `evaluateCycle()` verbatim — no new decision logic — and formats the
  already-computed `aiSummary`/`nutritionAiHeadline`/`nutritionAiExplanation`
  fields (produced once during `evaluateCycle`'s own ai-service call) into a
  chat answer; no separate LLM call for the formatting itself. Runs
  directly, no confirm step (read-only). New `EVALUATE` intent in
  `fitness-agent-intent.ts`.
- **D (accept/reject via chat)**: done, as `tryReviewRecommendation` +
  `execute()`'s 4 new branches. Wraps the EXISTING `/recommendation/accept`,
  `/recommendation/reject`, `/nutrition-recommendation/accept`,
  `/nutrition-recommendation/reject` endpoints verbatim — no fitness-service
  changes needed for this phase at all. New `REVIEW` intent (accept/reject +
  optional training/nutrition target; asks when both are pending and the
  message didn't say which). Real prescription change, so — unlike B — this
  keeps `prepare()`→`ACTION_CONFIRMATION`→explicit confirm→`execute()`. New
  `AgentActionKind` values in `shared/src/fitness-agent.ts`
  (`ACCEPT_TRAINING_RECOMMENDATION`, `REJECT_TRAINING_RECOMMENDATION`,
  `ACCEPT_NUTRITION_RECOMMENDATION`, `REJECT_NUTRITION_RECOMMENDATION`, all
  MEDIUM risk). 9 + 6 tests.
- **E (scheduled evaluation job)**: done. `cycle-evaluation-sweep.service.ts`
  (new) adds NO new decision/gating logic at all — it's only a new TRIGGER
  for the existing `maybeAutoTriggerInBodyReassessment` pipeline (cooldown
  gate, notify-only-if-actionable, atomic notify-once claim — all already
  built and tested for the "new InBody entry" trigger), called with a new
  `trigger: "SCHEDULED"` parameter that only changes the notification's own
  wording (never claims "based on your latest InBody" for a periodic run).
  Same `setInterval` + overlap-guard + injectable-deps pattern as
  `workout-reminder.service.ts` (the established pattern for this kind of
  job in this codebase — not BullMQ, which the original draft of this plan
  incorrectly guessed). Registered in `server.ts` only (never `app.ts`,
  matching the existing Lambda-safety convention already documented there).
  4 + 1 tests (the sweep's own control flow; one more added to the existing
  `inbody-reassessment.integration.test.ts` for the wording distinction —
  all 13 pre-existing tests there still pass unchanged). **Verified against
  real dev data, twice**: a manual sweep invocation against 9 real active
  cycles produced 7 real new `CycleAssessment` rows (confirmed in the DB);
  an immediate second invocation produced 0 (cooldown gate correctly
  refused to re-evaluate cycles just evaluated) — proving both the reuse
  and the anti-spam gate are real, not just passing in stubbed tests.

**Real bugs found and fixed while building C/D (both are the same root
cause, hit twice):** JavaScript regex `\b` only recognizes ASCII
`[A-Za-z0-9_]` as "word" characters, so a `\b`-bounded pattern silently
fails to match right next to a Vietnamese "đ"/"Đ" (not itself a combining
accent, so `normalize("NFD")` doesn't help). First hit in
`food-substitution-extractor.ts`'s keyword gate (missed "đổi" at a sentence
start); found again, same shape, in the PRE-EXISTING (not written this
session) `normalizeAgentText` in `fitness-agent-intent.ts` — a
sentence-initial capital "Đ" (e.g. "Đánh giá...", "Đồng ý...") was left
un-replaced because the old `/đ/g` (lowercase-only) substitution ran
BEFORE `.toLowerCase()`. Fixed with a case-insensitive `/đ/gi` replace;
regression-checked against the existing PT/PROGRAM/SELECT keyword paths
(unchanged behavior on 5 spot-check phrases) since no test file existed for
this function before this session.

**Operational gotcha worth knowing about**: `@gym-coach/shared` is consumed
by every service from its COMPILED `dist/`, not `src/` directly. Editing
`backend/shared/src/fitness-agent.ts` (to add the 4 new `AgentActionKind`
values) had no effect on any test or running service until `backend/shared`
was rebuilt (`npx tsc`) — a real integration test caught this immediately
(`agentActionRisk` returned the wrong tier), but it's worth remembering for
next time: **any edit under `backend/shared/src/` needs a shared-package
rebuild before it's visible anywhere else**, including inside a running dev
container if `backend/shared` isn't bind-mounted there. Phase B was already
real-HTTP-verified against the live dev container before this rebuild step
existed as a known gotcha; phases C/D have NOT yet been separately verified
against the live dev container (only against the ai test DB with stubbed
fitness-service calls) — the dev ai-service container likely needs its own
rebuild/restart to pick up the shared-package change before trying C/D live
in chat.

**Second gotcha, while verifying E against real dev data**: a one-off
verification script that calls `process.exit()` right after
`runCycleEvaluationSweep()` resolves can make working detached ("fire and
forget", `void promise.catch(...)`) background work look broken — the
sweep's own promise resolving does NOT mean the per-user
`runReassessmentAndNotify` calls it kicked off have finished (they're
intentionally detached so the sweep tick itself stays fast); `process.exit()`
kills the Node process immediately, including whatever of those was still
in flight. Not a bug in the actual server (which never exits), only in a
short-lived script used to poke it — confirmed by re-running with a 20s
wait before exit instead, and separately by the two-invocation cooldown
proof above.
