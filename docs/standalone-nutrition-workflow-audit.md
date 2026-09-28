# Standalone CREATE_NUTRITION_PLAN — Audit

Date: 2026-09-18. Pre-implementation audit, verified against the real
source (`plan.controller.ts`, `plan.routes.ts`, `conversation.service.ts`,
`nutrition.processor.ts`, `nutrition-plan.schemas.ts`,
`conversation.repository.ts`, `schema.prisma`).

## 1. A real preview/confirm/revise capability already exists — at the REST layer, not chat

Contrary to the initial assumption that nutrition needed a preview/persist
boundary built from scratch, the REST "AI Nutrition Plan" wizard already
has one, end to end:

```
POST /plans/nutrition/generate   -> 202, {planId, jobId} (BullMQ job)
GET  /plans/nutrition/current    -> list
(NutritionPlan.status: QUEUED -> PROCESSING -> COMPLETED|FAILED)
POST /plans/nutrition/:planId/adjust        -> re-queues a FRESH generation
POST /plans/nutrition/:planId/save-to-nutrition -> real persistence
```

`NutritionPlan` (Prisma model, `nutrition_plans` table) IS the preview —
`plan: Json` holds the full `NutritionPlanContentSchema`-shaped content
only once `status = COMPLETED`; nothing is written into the authoritative
`NutritionGoal`/`NutritionProgram` models until `save-to-nutrition` is
called, which forwards to fitness-service's
`POST /nutrition/from-ai-plan` (`internalAuthMiddleware`-guarded). **The
"preview != persistence" invariant the task asked to verify (or build) was
already true** — the missing piece is purely a CHAT caller for this
existing REST pipeline, not a new domain boundary.

## 2. The real architectural wrinkle: async generation vs. synchronous chat

`conversationService.queueNutritionPlanGeneration()` returns immediately
with `{planId, jobId, status: QUEUED}` — the actual LLM call happens in a
BullMQ worker (`processNutritionPlanJob`, up to ~180s per attempt per its
own timeout config). Every OTHER chat action in this codebase is
synchronous request/response. A chat turn cannot block for up to 3
minutes.

**Decision**: track the async lifecycle entirely inside the
`FitnessAgentAction.payload` (a `phase: "GENERATING" | "PREVIEW" | "FAILED"`
field), polled on the user's NEXT turn
(`tryPollOrReviseNutritionPlanDraft`). This required NO change to
`agent-workflow/orchestrator.ts`'s state machine — the `CREATE_NUTRITION_PLAN`
workflow itself only ever collects `mealsPerDay` and completes
immediately (`WORKFLOW_ONLY`, no confirmation); by the time generation is
queued, the workflow row is already gone and the pending
`FitnessAgentAction` is the sole remaining state.

The reserved-but-unused `WorkflowStatus` values (`READY`,
`GENERATING_PREVIEW`, `AWAITING_PREVIEW_DECISION`,
`AWAITING_ACTION_CONFIRMATION`) were considered and NOT used — wiring them
in would require adding new branches to the orchestrator's own
`runWorkflowTurn` state machine, which is explicitly out of scope
("do not redesign the orchestrator"). Tracking the async state in the
action payload instead reuses `FitnessAgentAction`'s already-established
role in this file (e.g. `CREATE_PLAN_BUNDLE`'s own `steps[]` bookkeeping)
and needed zero new schema/orchestrator surface.

## 3. A real, disclosed bug found in the REST wizard's own "adjust" endpoint

`plan.controller.ts::adjustNutritionPlan` queues a fresh generation with:

```ts
notes: `Điều chỉnh từ kế hoạch trước: ${adjustments}`,
```

But `NutritionPlanJobDataSchema` (`nutrition.processor.ts`) has **no
`notes` field at all** — confirmed by reading the full schema and the
entire processor file (no reference to `notes` anywhere). The user's
adjustment text is silently dropped before it ever reaches the LLM
prompt; the REST "Adjust" button today only ever changes `mealsPerDay`
(if supplied) and otherwise regenerates an equivalent plan, ignoring
whatever the user actually asked to change.

This is a pre-existing gap in the standalone REST feature, out of scope
to fix here (P2 — not blocking, not touched, would need a real product
decision + its own test coverage in that surface). **This chat revision
loop does NOT reuse the broken `notes` path.** Every extracted
constraint (`extractNutritionConstraintsFromMessage`) is instead routed
through `restrictions: string[]`, which `nutrition.processor.ts` DOES
render into the prompt (`Hạn chế bắt buộc: ...`) — confirmed by reading
the processor's own prompt-assembly code.

## 4. `mealsPerDay` is the one genuinely-askable slot

`GenerateNutritionPlanRequestSchema` fields, and where each one already
comes from:

| Field | Source |
|---|---|
| `goal` | `profileExtractor`'s `profile.goal` (same as roadmap/workout) |
| `durationWeeks` | Hardcoded `1` — the only value the schema accepts today |
| `mealsPerDay` | **No EnterpriseContext/profile equivalent — genuinely asked** |
| `weightKg`/`heightCm`/`age`/`gender`/`bodyFatPct` | `profileExtractor`'s body-stat fields |
| `activityLevel`/`trainingDaysPerWeek`/`experienceLevel` | `profileExtractor`'s training/activity fields |
| `dietPreference`/`budgetLevel`/`restrictions` | No authoritative product-schema home (see §5) |

## 5. Product-schema gap: dietary preferences have no home

If a user says "Tôi không ăn cá," Gymini has no `UserProfile` field, no
`NutritionGoal` field, nothing durable to store that preference in beyond
this one chat session. Per the task's explicit instruction ("keep
workflow-local and document the product-schema gap rather than dumping
into UserMemory"), these are kept entirely inside the
`FitnessAgentAction.payload.restrictions` array — real within THIS
draft's lifecycle (correctly re-sent on every re-generation triggered by
a later revision in the same session), but genuinely lost once the action
expires/completes. A future product decision (a real `dietaryRestrictions`
field on `UserProfile`, or a versioned preference list) would be needed
to make this durable across sessions — not built here, since that is a
schema change well beyond "ask only genuinely missing inputs."

## 6. Deterministic-vs-LLM boundary already respected

`TDEE`/calorie target/macro targets are computed by the LLM prompt today
(`buildCompactNutritionTemplatePrompt`/`nutrition.processor.ts`), NOT by a
separate deterministic engine the way `recommendation_engine.ts` is for
workouts — this is pre-existing behavior, unrelated to this task, and NOT
something this task's scope calls for changing (`nutrition-decision.engine.ts`
governs cycle-assessment adjustments, a completely different, already
deterministic and untouched decision layer). `nutrition-plan-invariant.service.ts`
(calorie clamp/protein floor) already runs inside
`processNutritionPlanJob` on every generation — reused unmodified; this
task adds no new safety threshold.

## 7. What was intentionally NOT touched

- `nutrition.processor.ts`, `nutrition-plan-invariant.service.ts`,
  `NutritionPlanContentSchema` — zero changes; the chat layer only calls
  the existing `conversationService.queueNutritionPlanGeneration` and
  reads the existing `NutritionPlan` row.
- `agent-workflow/orchestrator.ts` — zero changes (see §2).
- fitness-service's `/nutrition/from-ai-plan` persistence endpoint —
  called via a new `fitnessAgentTools.saveNutritionPlanFromAiPlan` wrapper
  using the SAME `domain()` helper (already sends the
  `x-internal-token`/`x-user-id` headers that route's
  `internalAuthMiddleware` needs) every other fitness-service call in
  this file already uses — not a new transport.
