# 02 — AS-IS Process (grounded in the current repository)

Every claim below cites a real file. This is what exists today, not the desired design — differences from the
TO-BE model (`03-to-be-bpm.md`) are called out explicitly rather than silently reconciled.

## Entry point and routing

- Flags: `CONVERSATIONAL_INTELLIGENCE_V2` and `CONVERSATIONAL_INTELLIGENCE_V2_LLM` both default to `"off"`
  (`backend/services/ai-service/src/conversational-intelligence/index.ts:25,28`). With CI-V2 off, the legacy
  intent router (`fitness-agent-intent.ts`) and the existing workflow orchestrator still handle `CREATE_WORKOUT_PLAN`
  — the deterministic global router described below is an **additive** layer, not a replacement, confirmed by the
  X1–X4 regression suite's own "flag OFF keeps the legacy behaviour" tests.
- With CI-V2 on, `global-turn.ts` classifies the turn via `router.ts`'s deterministic `GlobalRoute` union:
  `READ_STATE | RECOMMEND | WRITE_ACTION | START_WORKFLOW | KNOWLEDGE_QA | SLOT_ANSWER | CORRECTION | CANCEL |
  SWITCH_WORKFLOW | REFERENCE | EXPLAIN_AND_PROPOSE | NEGATE_ACTION | MULTI | UNKNOWN`
  (`global/router.ts:19-20`). A phrase such as *"Tạo lịch tập cho tôi"* matches `CREATE_WORKOUT_PLAN` keyword
  detection (`global/router.ts:127`) and routes `START_WORKFLOW` (`global/router.ts:168`).
- **Confirmation/status questions are intercepted even earlier**, before this router runs at all:
  `fitness-agent.service.ts::tryConfirmationBoundary` (line ~1914) is called right after `ownSession(...)`
  (session-ownership check) in `tryTurnUnguarded`. Bare utterances like "Xác nhận cập nhật.", "Đã lưu thành công
  chưa?" never reach the LLM or the generic router; they are answered purely from authoritative DB state
  (`FitnessAgentAction` + `AgentWorkflowSession`, see `confirmation-boundary.ts`).

## Workflow / slot-filling layer

- `agent-workflow/workflows/create-workout-plan.workflow.ts` declares `CREATE_WORKOUT_PLAN` with exactly two slots:
  `daysPerWeek` and `sessionMinutes` (lines 42–64). Both are read from the authoritative `EnterpriseContext` profile
  first (`readFromContext`) and only asked if genuinely unknown — goal, equipment, injuries, experience level, and
  safety-screening status are **not** re-collected as slots; they come straight from the profile at generation time
  (module doc comment, lines 25–30).
- `agent-workflow/slot-resolver.ts` provides the generic machinery: `resolveSlots`, `missingRequiredSlots`,
  `buildMissingSlotsQuestion` (asks exactly one missing slot, not all at once), `buildKnownMissingSummary`.
- `agent-workflow/orchestrator.ts` owns workflow-state transitions (`COLLECTING_SLOTS` → ... →
  `AWAITING_SLOT_CONFIRMATION`/completion) via `workflow-state.repository.ts`, backed by the `AgentWorkflowSession`
  table. A DB-level partial unique index enforces **at most one active (non-terminal) workflow per
  (userId, sessionId)** (`workflow-state.repository.ts` comment, migration
  `20260916090000_agent_workflow_session_active_unique`).
- Once slots are resolved, `fitness-agent.service.ts:564` dispatches
  `this.proposeWorkoutPlan(identity, sessionId, workflowResult?.resumeKnownSlots)`.

## Draft generation ("Fitness Recommendation Agent" responsibility, today)

- `fitness-agent.service.ts::generateWorkoutDraft` (line 153) is the actual generator: it synthesizes a canonical
  question, routes it through the **existing deterministic** `intentRouter`/`inputParser`/`recommendationEngine`
  (the same engine the product's own chat-recommendation path already trusts), trims each day to fit
  `sessionMinutes`, then resolves every exercise **name** the engine proposed to a real canonical `Exercise.id` via
  `fitnessAgentDeps.tools.searchExerciseByName` (one call per unique name, in parallel). Any name that fails to
  resolve is **dropped from the draft** (never auto-created as a new `Exercise` row) and counted in
  `unmatchedCount`, which is surfaced to the user as an honest caveat (`proposeWorkoutPlan`, line 1502).
- `proposeWorkoutPlan` (line 1473) builds the draft payload and creates one `FitnessAgentAction` row
  (`kind: "CREATE_WORKOUT_PLAN"`, `status: "PENDING"`, `expiresAt: now + 15min`) and returns a structured
  `WORKOUT_PLAN_PREVIEW` block (`buildWorkoutPlanPreviewBlock`, line 205) — including any safety warnings
  (`workoutSafetyWarnings`, line 182: injuries reported, beginner experience level, safety-screening follow-up —
  **soft warnings only, never a hard block**, explicitly documented as a disclosed gap at line 183–188, shared
  with the roadmap-draft path, not duplicated).
- **Known AS-IS gap**: there is no equipment-availability filter at **draft-generation** time in ai-service — the
  engine is not constrained to the user's `availableEquipment` before the preview is shown. Equipment is only
  validated later, at confirmation time, in the business service (next section). This matches the project's own
  documented asymmetry for AI-generated plans vs. template selection (see `gymini-ai-workout-grounding` skill /
  `docs/GYMINI_PT_COACHING_INTEGRATION_GAPS.md` #10) and is carried into `04-functional-requirements.md`/
  `12-gap-analysis-and-next-implementation.md` as a named gap, not silently assumed fixed.

## Revision loop

- `fitness-agent.service.ts::tryReviseWorkoutPlanDraft` (line 1518) handles free-text revision while a
  `CREATE_WORKOUT_PLAN` draft is `PENDING` and unexpired. It modifies only the `FitnessAgentAction.payload` —
  never `WorkoutProgram`. Handled cases include session-length retrim, day-count/weekday changes (regenerating via
  the same `generateWorkoutDraft`, then re-applying every exclusion ever stated in this draft's lifetime via the
  real substitution service), and exercise exclusions/swaps. An explicitly unsupported request ("Thêm superset.")
  is answered honestly rather than silently accepted or misread (lines 1556–1562).
- A free-text message that **names** a specific artifact ("lưu lịch tập này") while a draft is pending is
  redirected to the real pending-draft router rather than starting a second, competing save path
  (`agent-workflow-create-workout-plan.test.ts`'s "save-collision guard" test, line 227).

## Interruption / resume

- `global/global-turn.ts`'s own module doc (line 24): *"interruption → answer the side question, leave the waiting
  workflow untouched, remind the user how to continue"*. The exported `reminder()` function (line 52) appends the
  same reminder text whether the interrupting question reached the RAG/chat pipeline or the deterministic reader
  path (line 160, 178). Line 214: a knowledge question while a workflow is `waiting` sets `skipAgent: true` and
  traces `"knowledge question interrupts the waiting workflow (workflow preserved)"` — the workflow row itself is
  never touched by the interrupting turn.
- When the user later supplies the missing slot, the orchestrator's own "expected-slot priority" rule
  (`docs/conversational-ai-coach-workflow-design.md`, referenced from `types.ts`) resumes the **same** workflow row
  — no restart, no lost context.

## Confirmation / HITL

- A `CREATE_WORKOUT_PLAN` draft is confirmed or dismissed **only** through the dedicated HTTP endpoints —
  `POST /ai/agent/actions/:id/confirm` and `POST /ai/agent/actions/:id/dismiss`
  (`routes/fitness-agent.routes.ts`) — never through a bare confirmation text message. This is a deliberate,
  documented boundary (`confirmation-boundary.ts`'s own module doc comment): "writes only happen through the
  confirmation card / the workflow's own confirmation step." A profile-fact change (e.g. a goal update proposed
  mid-conversation) is the one case that **is** confirmable by text, through the workflow's own
  `AWAITING_SLOT_CONFIRMATION` → `handleConfirmationReply` path — a structurally different lifecycle
  (`AgentWorkflowSession`, not `FitnessAgentAction`).
- `fitness-agent.service.ts` (lines ~780–825) claims the action atomically (`PENDING` → `EXECUTING` via a
  conditional `updateMany`, guarding against two concurrent confirm requests), then dispatches by `action.kind`.
- For `CREATE_WORKOUT_PLAN` (line 938), the confirm handler calls
  `fitnessAgentDeps.tools.importAiPlanToSchedule` with **exactly** the last-previewed/revised payload — no
  regeneration step that could drift from what the user actually saw (comment, lines 940–946). Module doc:
  *"importAiPlanToSchedule is idempotent per (userId, sourcePlanId) — a repeated confirm of this same action
  produces one logical write."*
- `dismissDraft` (line ~1988) likewise claims atomically (`PENDING` → `CANCELLED`) and returns a truthful
  "Đã bỏ qua bản nháp này — chưa lưu gì vào hệ thống." / "already saved, cannot dismiss" / "already executing,
  cannot dismiss now" depending on which state actually won the race — never a blind "ok, cancelled."
- **Post-confirmation truthfulness** (any later "Đã lưu thành công chưa?") is answered by
  `tryConfirmationBoundary`, which merges `FitnessAgentAction` state and `AgentWorkflowSession` state by real
  lifecycle-event recency (`updatedAt`, not `createdAt`), with two targeted, unbounded-by-row-count queries for the
  action side (fixed in `docs/conversational-intelligence-x4-t10-final-fix.md`, reused here as direct evidence for
  FR17–FR19/FR22 and EX13–EX15 below).

## Persistence and validation ("Business Service" responsibility)

- `backend/services/fitness-service/src/routes/workout.routes.ts`: `POST /workouts/from-ai-plan`
  (`internalAuthMiddleware`-guarded — only a trusted internal caller with the shared internal secret can reach it,
  never a raw end-user token) → `workoutController.importAiPlan` → `workoutService.importAiPlanToSchedule`
  (`services/workout.service.ts:2353`).
- `importAiPlanToSchedule` looks up an existing `WorkoutProgram` by `(userId, sourcePlanId)` first. If one exists
  (a repeat confirm, or a resumed draft), it takes an **update/idempotent** path — re-validating
  (`validateExerciseIds`, `validateAiPlanExerciseEquipment`, lines 2394–2404) the **existing** program's exercises,
  never creating a second program. `WorkoutProgram.agentActionId` is itself a `@unique` column
  (`prisma/schema.prisma:535`), giving this a real database-level guarantee, not just an application-level check.
- If no existing program is found, the service creates a new `WorkoutProgram` + `WorkoutProgramDay` +
  `WorkoutProgramExercise` rows and the matching `WorkoutSchedule` rows (same function, later branch) — this is the
  **only** place in the whole BPM that ever writes these tables.
- `validateExerciseIds` (line 530) and `validateAiPlanExerciseEquipment` (line 541) are the deterministic domain
  gate: every exercise ID must resolve to a real, owned-or-published catalog row; every exercise's required
  equipment must be satisfiable by what the user's own `UserEquipment` rows (or system defaults) make available.
  **This is the only point in the AS-IS process where equipment is actually enforced** — not at draft-preview time
  (see the gap noted above).

## Exercise/equipment domain data

- `Exercise` (`prisma/schema.prisma:80`): canonical catalog row, `status` defaults to `"PUBLISHED"`
  (`STAGING | REVIEW_REQUIRED | APPROVED | PUBLISHED | DEPRECATED | REJECTED`, line 124), and an ownership field
  distinguishing `"SYSTEM"` vs `"USER_CUSTOM"` catalog entries (line 127) — a `USER_CUSTOM` row from one user is
  never referenceable by another (existing, unrelated ownership invariant, not modified by this BPM).
- `Equipment` (`line 173`): a real, named, categorized catalog (`FREE_WEIGHTS | BENCHES_RACKS | CABLE | ...`),
  linked to exercises via `ExerciseEquipment` and to users via `UserEquipment`.

## Tests already covering parts of this AS-IS flow (full mapping in `10-traceability-matrix.md`)

- `agent-workflow-create-workout-plan.test.ts`: golden flow (asks only the missing slot, resumes into a real draft,
  revises twice draft-only, confirms exactly once), no-repeat E2E (known slots never re-asked, no workflow row
  created when nothing needs asking), session-length revision, unsupported-revision honesty, save-collision guard.
- `workout-plan-invariant.test.ts`: deterministic draft-shape validator (accepts a matching skeleton, rejects
  missing days, duplicate day labels, unknown exercise ID, an exercise placed under the wrong muscle-day candidate
  set, an empty day/invalid prescription).
- The whole X1–X4 Conversational Intelligence regression suite (`x4-*.test.ts`,
  `conversational-intelligence-*.test.ts`) exercises the confirmation boundary, event ordering, and cross-user
  isolation this BPM's own confirmation step depends on — reused as evidence, not re-run or re-litigated here.
