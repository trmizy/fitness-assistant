# Gymini Nutrition Program Live E2E Report

Date: 2026-09-10
Closes the one item the prior Cross-System Integration phase left
unchecked: "NutritionProgram points to correct goal version — NOT
RE-TESTED this phase (AI meal-plan generation UI not driven through a
real browser)."

## Real flow discovered and driven (from `CurrentNutritionProgram.tsx`)

The real supported AI meal-plan flow is a two-step Generate → Review →
Save, not a single action:

1. "Tạo kế hoạch mới" (always-visible header button, not just an empty-
   state prompt) opens a config modal.
2. The modal's own submit button, "Tạo kế hoạch", calls
   `generateMutation.mutate(payload)` → `POST /plans/nutrition/generate`
   — a real, unmocked async job (the product's own copy states "2-5
   phút").
3. Once the job reaches `status: "COMPLETED"`, the plan card shows a
   "Lưu vào Dinh dưỡng" trigger, opening a second confirm modal whose own
   button carries the SAME label — this second click is the one that
   actually calls `saveMutation.mutate({planId, form})` →
   `planService.saveNutritionPlanToNutrition` →
   `POST /plans/:planId/save-to-nutrition`. **This is the exact call
   that creates the real `NutritionProgram` row and stamps
   `sourceGoalId`** — not the generation step.

## Real evidence (TC-XSYS-007, `cross.system.client@example.test`)

```text
TC-XSYS-007a: Generate control found (real button "Tạo kế hoạch mới")
TC-XSYS-007b: aiPlanId=17189ca1-bd1a-42a0-9002-0c477e2db298 (real job reached COMPLETED, ~1m46s real latency)
TC-XSYS-007c: programId=6ab40d68-b098-4102-8c97-9e6c364bea14 (real NutritionProgram row created by the real Save click)
TC-XSYS-007c: sourceGoalId=df066aa1-8b6b-43a8-a010-5f42cc7c85b8 === active NutritionGoal.id (exact match)
```

Full real, unmocked run (real browser, real Ollama-backed AI, real
Postgres): **PASS**, twice independently (once standalone, once inside
the full spec run), including a repeat run against an account that
already carried a prior real plan/program from an earlier run of this
same test (proves the flow — and this test — is durably repeatable, not
a one-shot fixture).

## §20 — NutritionGoal V1→V2 versioning cross-linked with sourceGoalId

Live-proven at the backend integration level (real `upsertGoal`
transaction, real `nutrition-goal-plan-consistency.service.ts` detector)
in `nutrition-goal-plan-consistency.integration.test.ts`'s new test:

```text
V1 created -> P1 seeded with sourceGoalId=V1
V2 created (real SUPERSEDE+INSERT transaction) -> P1.sourceGoalId still === V1 (unchanged)
detector against stale P1: MACRO_MISMATCH (P1's own numbers genuinely differ from V2)
P1 archived, P2 seeded with sourceGoalId=V2
P1.sourceGoalId === V1 (still, forever)
P2.sourceGoalId === V2
active goal calories/macros === V2's own numbers (never silently superseded by a meal plan)
detector against P2: MATCHED
```

10/10 tests pass in that file, including 2 new plus 8 pre-existing.

## §21 — Stale meal-plan UX (live-verified in a real browser, already implemented)

`nutrition-goal-plan-consistency.service.ts`'s `compute(userId)` is
exposed at `GET /nutrition/active-state` and already rendered in
`NutritionPage.tsx` (a real `data-testid="goal-plan-mismatch-banner"`
with real Vietnamese copy for both `MACRO_MISMATCH` and
`STALE_GOAL_CHANGED`, a "Tạo lại thực đơn theo mục tiêu mới" CTA, and a
dismiss action). No new implementation was needed or added — this is a
pre-existing, correct feature.

Live-proven end to end (TC-XSYS-010, real browser + real HTTP/API): a
real `PUT /nutrition/goals` call superseded `cross.system.client`'s V1
goal (the one their real, saved `NutritionProgram` from TC-XSYS-007 was
built from) with a genuinely different V2 (2850/195/330/82 vs.
2200/165/248/61). The real detector returned:

```json
{
  "status": "MACRO_MISMATCH",
  "mismatches": [
    { "field": "calories", "planValue": 2200, "goalValue": 2850, "diff": 650, "toleranceUsed": 142.5, "exceedsTolerance": true },
    { "field": "protein",  "planValue": 165,  "goalValue": 195,  "diff": 30,  "toleranceUsed": 19.5,  "exceedsTolerance": true },
    { "field": "carbs",    "planValue": 248,  "goalValue": 330,  "diff": 82,  "toleranceUsed": 33,    "exceedsTolerance": true },
    { "field": "fat",      "planValue": 61,   "goalValue": 82,   "diff": 21,  "toleranceUsed": 8.2,   "exceedsTolerance": true }
  ]
}
```

and the real browser rendered the banner with the exact expected copy;
clicking "Tạo lại thực đơn theo mục tiêu mới" routed into the existing
`/client/ai-coach` entry point — no new page.

## §22 — AI meal-generation failure recovery

Not independently re-injected this pass (would require forcing a real
Ollama/ai-service failure mid-run). Reasoned from the same evidence
class the prior phase used for the analogous workout-generation case:
`saveMutation`/`generateMutation` are both real React Query mutations
with their own error branches (toast + no navigation on failure); the
save endpoint independently checks `plan.status !== PlanStatus.COMPLETED`
(409) before ever touching `NutritionProgram`, so a plan stuck at
`FAILED`/`QUEUED`/`PROCESSING` structurally cannot produce a malformed
`NutritionProgram` — the write path itself is gated on a real status
check, not best-effort.

## Files touched this report covers

- `backend/services/fitness-service/src/__tests__/nutrition-goal-plan-consistency.integration.test.ts`
- `fitnessassistant-playwright-e2e/tests/32-cross-system-fitness-journey.spec.ts` (TC-XSYS-007)

## Verdict

NutritionProgram.sourceGoalId is now **live-proven** end to end through
the real, supported UI, real AI, and real Postgres — the one item the
prior Cross-System Verification Report left unchecked is now closed.
