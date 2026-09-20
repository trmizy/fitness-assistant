# Standalone CREATE_NUTRITION_PLAN — Design

Date: 2026-09-18. Implements the audit's decisions
(`standalone-nutrition-workflow-audit.md`). No change to
`agent-workflow/orchestrator.ts`, no new `WorkflowStatus` wired in, no new
deterministic engine, no new safety threshold.

## 1. Files

- `backend/services/ai-service/src/agent-workflow/slot-values.ts` —
  `parseMealsPerDay` (bounded 2-6).
- `backend/services/ai-service/src/agent-workflow/workflows/
  create-nutrition-plan.workflow.ts` — one slot, `mealsPerDay`
  (`WORKFLOW_ONLY`, `required: true`, no context source at all —
  genuinely always asked unless `extractFromMessage` catches "chia 4 bữa"
  in the triggering message; that extractor requires the literal
  "bữa/meal" word next to the digit, deliberately stricter than
  `parseMealsPerDay`'s own bare-digit answer path, so an unrelated number
  elsewhere in the message — age, weight — is never misread as
  `mealsPerDay`).
- `backend/services/ai-service/src/services/fitness-agent-tools.ts` —
  `saveNutritionPlanFromAiPlan` tool wrapping
  `domain(identity, "fitness", "POST", "/nutrition/from-ai-plan", ...)`.
- `backend/services/ai-service/src/services/fitness-agent.service.ts` —
  `registerWorkflow(createNutritionPlanWorkflow)`;
  `"NUTRITION_PLAN_PREVIEW"` added to `AgentBlock`;
  `proposeNutritionPlan`, `tryPollOrReviseNutritionPlanDraft`,
  `extractNutritionConstraintsFromMessage`/
  `buildNutritionPlanPreviewBlock`/`buildNutritionGenerationParams`
  (module-level helpers), dispatch wiring in `tryTurn`, an `execute()`
  branch for `CREATE_NUTRITION_PLAN`.
- `frontend/web/src/app/services/fitnessAgent.ts` /
  `.../FitnessAgentBlocks.tsx` — `"NUTRITION_PLAN_PREVIEW"` block type +
  rendering (per-day/per-meal collapsible breakdown, daily
  calorie/macro summary, "Lưu thực đơn này"/"Để sau").

## 2. Flow

```
"Tạo kế hoạch dinh dưỡng giảm mỡ cho tôi"
  -> CREATE_NUTRITION_PLAN gated by intent kind
  -> mealsPerDay: ask if not stated up front
  -> resolved -> orchestrator completes (WORKFLOW_ONLY) -> RESUME_SENTINEL
  -> fitnessAgent.proposeNutritionPlan(question, identity, sessionId, resumeKnownSlots)
       - llmService.getHealthStatus() gate (same as the REST route's
         ensureLlmAvailable)
       - profileExtractor.extract() for goal/body-stats/activity/experience
       - extractNutritionConstraintsFromMessage(question) — opportunistic
         "không ăn cá"/"giảm ngân sách"/... extraction from the CURRENT turn
       - buildNutritionGenerationParams() — re-validates against
         GenerateNutritionPlanRequestSchema (defense-in-depth; this call
         has no Express validateBody in front of it)
       - conversationService.queueNutritionPlanGeneration() — the SAME
         real enqueue call POST /plans/nutrition/generate makes
       - FitnessAgentAction{kind:"CREATE_NUTRITION_PLAN",
         payload:{planId, jobId, phase:"GENERATING", mealsPerDay, goal,
         restrictions}} created
       - answer: "đang tính toán... nhắn lại để mình kiểm tra"
       (NO block yet — nothing to preview until the job finishes)

  -- next turn(s), ANY message, checked in tryTurn's !effectiveKind branch --
  fitnessAgent.tryPollOrReviseNutritionPlanDraft(question, identity, sessionId)
    if phase === GENERATING:
      poll conversationRepository.findNutritionPlanById(planId)
        COMPLETED -> phase="PREVIEW", cache `content`, return
                     NUTRITION_PLAN_PREVIEW
        FAILED    -> phase="FAILED", action.status="CANCELLED", report
                     honestly (never silently retried into a fake preview)
        else      -> "vẫn đang tính toán" (return null new job)
    if phase === PREVIEW:
      a recognized revision (mealsPerDay +/-1, or an extracted
      constraint) -> merge into restrictions[], re-queue a FRESH
      generation (mirrors the REST wizard's own "adjust" semantics
      exactly — full regeneration, since no targeted single-meal edit
      endpoint exists), phase back to GENERATING
      anything unrecognized -> return null, tryTurn falls through normally

  -> "Lưu thực đơn này" (frontend button) -> confirm(actionId) ->
     execute() -> re-fetch the Plan row fresh -> real
     fitnessAgentTools.saveNutritionPlanFromAiPlan() ->
     POST /nutrition/from-ai-plan -> real NutritionGoal/NutritionProgram
     write, exactly once (FitnessAgentAction.status flips to COMPLETED,
     a repeated confirm returns the stored result)
```

## 3. Revision loop (`tryPollOrReviseNutritionPlanDraft`, phase === PREVIEW)

| User says | Mechanism |
|---|---|
| "Tôi không ăn cá." / "Dị ứng đậu phộng." / "Tránh hải sản." | `extractNutritionConstraintsFromMessage` matches "không ăn/không dùng/dị ứng/tránh + phrase", appended to `restrictions` (the field `nutrition.processor.ts` genuinely renders into the prompt). |
| "Giảm ngân sách." | Mapped to a `restrictions` line ("Ưu tiên thực phẩm rẻ, dễ mua...") rather than the request schema's coarse `budgetLevel` enum (which `nutrition.processor.ts`'s own budget note only special-cases for `"student"` — an honest choice given that mismatch, not a silent no-op). |
| "Cho món Việt Nam dễ mua." | Mapped to `restrictions` lines ("Ưu tiên món ăn Việt Nam quen thuộc" / "Ưu tiên thực phẩm dễ mua"). |
| "Ít bữa hơn." / "Nhiều bữa hơn." | `mealsPerDay` adjusted by ±1, clamped to the real 2-6 schema bound. |
| "Đổi bữa sáng/trưa/tối." / "Đổi món này." | Mapped to a `restrictions` line asking for a different selection than last time — best-effort, since no per-meal targeted regeneration exists (see audit §3); always a FULL regeneration. |

Every re-queue also forwards `dailyCaloriesTarget` from the CURRENT cached
content, nudging the new generation toward calorie consistency across
revisions (never a bypass of `nutrition-plan-invariant.service.ts`'s own
clamp, which still runs unconditionally inside the job).

## 4. Confirm/persist

`execute()`'s `CREATE_NUTRITION_PLAN` branch requires `payload.phase ===
"PREVIEW"` (409 otherwise — "chưa sẵn sàng để lưu"), re-fetches the
`NutritionPlan` row fresh (catches a plan archived/changed between preview
and confirm — same "revalidate before execution" precedent used
elsewhere in this file), and calls the real persistence tool with the
SAME weeklySchedule/macro targets the user was just shown. Nothing
becomes an active `NutritionProgram` merely by appearing in the preview.

## 5. Safety

- Deterministic calorie/macro clamping and protein floor
  (`nutrition-plan-invariant.service.ts`) are untouched and still run on
  every generation, including every chat-triggered re-queue — this loop
  cannot bypass them, since it calls the exact same
  `queueNutritionPlanGeneration` → `processNutritionPlanJob` path the REST
  route uses.
- No new calorie/macro threshold was invented anywhere in this chat layer.
- `restrictions` accumulate (capped at 20, oldest dropped) rather than
  replace, so an earlier "không ăn cá" is never silently lost by a later,
  unrelated revision in the same session.

## 6. Explicitly not built

- No new `WorkflowStatus`, no orchestrator change.
- No targeted single-meal edit endpoint — every revision is a full
  regeneration, matching the REST wizard's own real "adjust" behavior.
- No durable dietary-preference storage (see audit §5) — workflow-local
  only, by design, pending a real product/schema decision.
- The REST wizard's own `notes`-field drop bug (audit §3) was NOT fixed —
  out of scope, and this chat path does not depend on it.

## 7. Addendum 2026-09-19 — Product remediation #1 (M1/M2/M3/M4/L1) — supersedes parts of §1-§6

Full detail: `ai-coach-product-remediation-1.md`.

- **Target authority (M3) supersedes the earlier claim that the processor/LLM computes the target.** The calorie/macro target is the ACTIVE `NutritionGoal` if one exists, else the deterministic initial prescription (`resolveNutritionTargetForUser`, read-only `GET /nutrition/target-preview`, sharing bootstrap's input assembly). The chat layer resolves it before every generation and revision and sends it as `dailyCaloriesTarget/proteinTargetG/carbTargetG/fatTargetG`; the LLM proposes composition only. Insufficient profile data -> ask, never a generic prescription. Confirm re-resolves and fails closed if the target changed; the plan content hash must equal what was previewed.
- **Constraints (M1/M2)**: a second non-required `WORKFLOW_ONLY` slot `nutritionConstraints` preserves opening-message constraints across slot collection; constraints MERGE (exclusions dedupe by canonical key and never roll off; only soft hints are capped at 10 — this replaces the earlier 20-entry rolling `restrictions` behaviour). Enforced exclusions travel as `excludedFoodKeys` and are applied to the processor's food pool at the source, re-checked on the final plan and before preview; unsupported phrases are refused. Free-text `restrictions` remain prompt hints only.
- **Routing (M4)**: `tryPollOrReviseNutritionPlanDraft` receives its action from `routePendingDraftTurn`; a GENERATING action polls only on poll-shaped messages and never swallows an unrelated turn; a real revision during GENERATING re-queues.
- **Dismiss (L1)**: "Bỏ qua bản này" cancels the draft server-side.
- Payload shape is now `{planId, jobId, phase, mealsPerDay, goal, constraints, target, content?, contentHash?, lastTouchedAt}`.

## 8. Addendum 2026-09-19 (final remediation)

`nutritionConstraints` is an ACCUMULATING set: while a CREATE_NUTRITION_PLAN workflow is COLLECTING_SLOTS, `accumulateNutritionWorkflowConstraints` (tryTurn, before `runWorkflowTurn`) merges constraints from every turn into the stored set with `mergeNutritionConstraints`; the orchestrator's never-overwrite rule for scalar slots is untouched. Constraint clauses are classified independently (no first-item special case); ANY unsupported hard exclusion (initial, middle turn, or revision) refuses generation — in a middle turn the workflow is cancelled and the user restates. Non-food clauses ("4 bữa", "ưu tiên món Việt") are never counted as unsupported. A CANCELLED nutrition action (dismissed or failed job) can never be confirmed. Removing a stated constraint remains unsupported. See `ai-coach-product-final-remediation.md`.

## Addendum 2026-09-19 (finalization race closure)

Codex's core sign-off found one race: concurrent confirm and dismiss of the same action could both report success. Fixed at the `FitnessAgentAction` lifecycle: confirm claims `PENDING -> EXECUTING` and dismiss claims `PENDING -> CANCELLED`, each one conditional UPDATE, so exactly one wins and the loser answers truthfully; a business failure after the claim returns the action to `PENDING` (no fake COMPLETED); a stale claim (>2 min) is reclaimable, safe through downstream idempotency. No schema migration (`status` is a free string). See `ai-coach-finalization-race-closure.md`.
