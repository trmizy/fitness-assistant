# Standalone CREATE_NUTRITION_PLAN — Evaluation

Date: 2026-09-18. Evidence for the CREATE_NUTRITION_PLAN capability
(`standalone-nutrition-workflow-design.md`).

## 1. New tests — BACKEND INTEGRATION

`src/__tests__/agent-workflow-create-nutrition-plan.test.ts` — 3/3
passing. The stub rig models the REAL async lifecycle (a mutable
`Map<planId, planRow>` starting `QUEUED`, only flipped to `COMPLETED`/
`FAILED` by the test itself between `tryTurn` calls — never
pre-completed), so the GENERATING phase is genuinely exercised, not
assumed:

1. **Golden flow**: mealsPerDay asked ("4 bữa") → real
   `queueNutritionPlanGeneration` call recorded (asserted `mealsPerDay:4`
   reaches it) → answer acknowledges without a block (nothing to preview
   yet) → a pending `CREATE_NUTRITION_PLAN` action tracks the job across
   turns → "xong chưa" polls the (test-flipped) `COMPLETED` plan →
   real `NUTRITION_PLAN_PREVIEW` → "Tôi không ăn cá, đổi giúp tôi"
   re-queues a SECOND real generation call, asserted the restriction
   string genuinely appears in that call's `restrictions` array (not
   silently dropped the way the REST wizard's own `notes` field is — see
   audit §3) → phase flips back to `GENERATING` → polling again after the
   (test-simulated) revised plan completes shows the SAME `actionId`
   (never a second competing action) → `execute()` calls
   `saveNutritionPlanFromAiPlan` exactly once, persisting the REVISED
   content the user actually last saw (asserted directly against the
   mocked call's `weeklySchedule` — the fish item is gone, replaced by
   chicken) → a repeated confirm returns the stored result, no second
   save call.
2. **Async job failure**: a `FAILED` job is reported with its real
   `failReason`, never silently retried into a fake preview; the action
   is marked `CANCELLED` so it can never be mistakenly resumed by a later,
   unrelated message.
3. **No-repeat**: "chia 5 bữa" stated in the triggering message resolves
   `mealsPerDay` in the SAME turn — no `WORKFLOW_MISSING_DATA` round trip
   — and the resolved value (5) is confirmed to reach the queued job.

## 2. Cross-domain tests — BACKEND INTEGRATION

`src/__tests__/agent-workflow-cross-domain.test.ts`:

- Triggering CREATE_NUTRITION_PLAN right after CREATE_WORKOUT_PLAN (both
  reading the SAME stubbed `EnterpriseContext`) never re-asks `goal` —
  confirmed CREATE_NUTRITION_PLAN's own `missing` list contains ONLY
  `mealsPerDay`, exactly as designed (there is no `goal` slot on this
  workflow at all, precisely because it already reuses `profile.goal`).

## 3. Full regression — BACKEND INTEGRATION

Run together with every other agent-workflow suite (roadmap E2E,
remediation-1/2, program-e2e, security-e2e, create-workout-plan,
cross-domain): **40/40 passing**. `npx tsc --noEmit` (ai-service) and
`npm run build` (frontend/web): both clean.

## 4. Security — CODE AUDIT

The one new slot (`mealsPerDay`) is `WORKFLOW_ONLY` — confirmed by direct
grep of `create-nutrition-plan.workflow.ts`. It is never written to
`UserProfile`. `restrictions`/`dietPreference`/`budgetLevel` extracted
from free text are stored ONLY inside the transient
`FitnessAgentAction.payload` (never `UserMemory`, never a profile field)
— per the audit's explicit product-schema-gap finding, this is workflow-
local by design, not an oversight. Persistence goes through
`fitnessAgentTools.saveNutritionPlanFromAiPlan`, the SAME `domain()`
helper (with the SAME identity-scoped `x-user-id` header) every other
fitness-service write in this file already uses — no new trust boundary.

## 5. Not run / genuinely deferred

- No live BullMQ worker / real Ollama run in this pass — every test stubs
  `conversationService.queueNutritionPlanGeneration` and
  `conversationRepository.findNutritionPlanById` directly, matching this
  codebase's own established convention of stubbing the HTTP/async
  boundary rather than requiring a live model. A REAL end-to-end run
  (real job, real LLM, real multi-minute wait) was NOT performed.
- No REAL BROWSER verification of `NUTRITION_PLAN_PREVIEW`'s mobile
  layout — `npm run build` confirms it compiles; the markup reuses the
  same collapsible-`<details>` pattern as `WORKOUT_PLAN_PREVIEW`, not
  independently re-verified live at 360/375/390/412px in this pass.
- The REST wizard's own `notes`-drop bug (audit §3) is documented, not
  fixed — a real, disclosed, out-of-scope finding for a future pass.

## 6. Addendum 2026-09-19 — Codex product E2E findings and re-verification

Codex found M1 (opening restriction lost), M2 (28 salmon items for "không ăn cá"), M3 (chat 2200/165 vs deterministic 1992/128 for the same context; existing ACTIVE 1800 goal + 2200 program) and M4 (action routing) in this capability. All closed (`ai-coach-product-remediation-1.md`). Evidence: `nutrition-food-exclusion.test.ts` 7/7 (REAL `processNutritionPlanJob` + invariant: control run proves fish is pulled in without the exclusion; with it, zero fish; `eggplant` is not egg; unknown key fails the job; injected "calories = 200" cannot change the supplied 1992); `agent-workflow-product-remediation-1.test.ts` M1/M2/M3/M4 (13 tests); fitness-service `nutrition-target-resolution.integration.test.ts` 4/4 on the isolated test DB (Codex's fixture -> 1992/128/246/55, read-only, equals what bootstrap then persists, ACTIVE goal wins). The earlier §1-§5 statements that the 3 tests proved restriction handling are superseded (the stubbed processor boundary hid M2). Still NOT verified: a live BullMQ/Ollama generation (configured provider `127.0.0.1:11435` refused connections; no config was changed) — ENVIRONMENT LIMITATION.

## 7. Addendum 2026-09-19 (final remediation)

Codex's final recheck reproduced three-turn constraint loss (fish kept, beef lost), a compound unsupported exclusion ("không ăn cá và không ăn cay") silently queued, and a stale confirm after dismiss. Closed with `agent-workflow-product-final-remediation.test.ts` (13/13): three-turn golden queues `[beef, fish]`; "4 bữa, và tôi cũng không ăn thịt bò" queues both; unsupported in any position/order/3-item list -> no job; dismissed/failed nutrition action -> confirm rejected with zero saves. Processor exclusion suite unchanged 7/7; target/bootstrap 20/20. Still not verified: live BullMQ/Ollama run (ENVIRONMENT).

## Addendum 2026-09-19 (finalization race closure)

Codex's core sign-off found one race: concurrent confirm and dismiss of the same action could both report success. Fixed at the `FitnessAgentAction` lifecycle: confirm claims `PENDING -> EXECUTING` and dismiss claims `PENDING -> CANCELLED`, each one conditional UPDATE, so exactly one wins and the loser answers truthfully; a business failure after the claim returns the action to `PENDING` (no fake COMPLETED); a stale claim (>2 min) is reclaimable, safe through downstream idempotency. No schema migration (`status` is a free string). See `ai-coach-finalization-race-closure.md`.
