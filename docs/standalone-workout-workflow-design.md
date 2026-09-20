# Standalone CREATE_WORKOUT_PLAN — Design

Date: 2026-09-18. Implements the audit's decisions
(`standalone-workout-workflow-audit.md`) as a new, additive
`CREATE_WORKOUT_PLAN` capability on top of the signed-off Conversational
Workflow Foundation. No change to `agent-workflow/orchestrator.ts`,
`WorkflowDefinition`/`SlotDefinition` shapes, or any previously signed-off
workflow.

## 1. Files

- `backend/shared/src/fitness-agent.ts` — `AgentActionKindSchema` gains
  `"CREATE_WORKOUT_PLAN"` (defaults to MEDIUM risk via the existing
  fallthrough).
- `backend/services/ai-service/src/agent-workflow/slot-values.ts` —
  `parseSessionsPerWeek` (bounded 1-7 count parser).
- `backend/services/ai-service/src/agent-workflow/workflows/
  create-workout-plan.workflow.ts` — the `WorkflowDefinition`. Slots:
  `daysPerWeek` (`readFromContext` → `profile.days.length`),
  `sessionMinutes` (`readFromContext` → `profile.sessionMinutes`). Both
  `WORKFLOW_ONLY`, `required: true`, no `validateContext` — there is no
  contextual safety concern for a day count or a duration.
- `backend/services/ai-service/src/services/fitness-agent-intent.ts` —
  `mentionsCreateWorkoutPlan` detection (checked AFTER
  `CREATE_PLAN_BUNDLE`/`SAVE_GENERATED_PLAN` so those keep their existing,
  more specific meaning).
- `backend/services/ai-service/src/services/fitness-agent-tools.ts` —
  `getExerciseSubstitute` tool wrapping `GET /exercises/:id/substitute`.
- `backend/services/ai-service/src/services/fitness-agent.service.ts` —
  `registerWorkflow(createWorkoutPlanWorkflow)`; `"WORKOUT_PLAN_PREVIEW"`
  added to `AgentBlock`; `proposeWorkoutPlan`, `tryReviseWorkoutPlanDraft`,
  `generateWorkoutDraft`/`trimDayForSessionMinutes`/
  `workoutSafetyWarnings`/`buildWorkoutPlanPreviewBlock` (module-level
  helpers), a `CREATE_WORKOUT_PLAN` dispatch branch in `tryTurn`, a
  `CREATE_WORKOUT_PLAN` branch in `execute()`, and a collision guard in
  `proposeSaveGeneratedPlan`.
- `frontend/web/src/app/services/fitnessAgent.ts` /
  `frontend/web/src/app/components/agent/FitnessAgentBlocks.tsx` —
  `"WORKOUT_PLAN_PREVIEW"` block type + rendering (collapsible day
  sections, "Lưu lịch tập này"/"Để sau" buttons calling the SAME
  `fitnessAgentService.confirm(actionId)` every other
  `ACTION_CONFIRMATION`-style block already uses).

## 2. Flow

```
"Tạo lịch tập cho tôi"
  -> CREATE_WORKOUT_PLAN gated by intent kind
  -> daysPerWeek/sessionMinutes: ask ONLY what's not already in
     EnterpriseContext (profile.days.length / profile.sessionMinutes)
  -> both known (immediately or after 0-2 turns) -> orchestrator completes
     (WORKFLOW_ONLY, no PROFILE_FACT confirmation) -> RESUME_SENTINEL
  -> fitnessAgent.proposeWorkoutPlan(question, identity, sessionId, resumeKnownSlots)
       - profileExtractor.extract() for goal/experience/equipment/safety
       - generateWorkoutDraft(): synthetic "Tạo lịch tập N buổi mỗi tuần
         cho tôi" -> intentRouter.route -> inputParser.parse (routeIntent/
         goalHint overridden, parsedTrainingDays forced to the resolved
         slot value) -> recommendationEngine.recommend() -> per-day
         trimDayForSessionMinutes() -> searchExerciseByName() per unique
         exercise name -> weeklySchedule of resolved {exerciseId, ...}
       - FitnessAgentAction{kind:"CREATE_WORKOUT_PLAN"} created,
         payload = {goal, sessionMinutes, weeklySchedule}
  -> WORKOUT_PLAN_PREVIEW block (actionId, days/exercises, warnings)
  -> free-text revision (see §3) — DRAFT ONLY, same actionId, zero writes
  -> "Lưu lịch tập này" (frontend button) -> confirm(actionId) ->
     execute() -> importAiPlanToSchedule(sourcePlanId: actionId, ...)
     -> real WorkoutProgram/WorkoutSchedule write, exactly once
     (idempotent per (userId, sourcePlanId))
```

## 3. Revision loop (`tryReviseWorkoutPlanDraft`)

Checked in `tryTurn`'s `!effectiveKind` branch (same tier as
`tryReviseRoadmapDraft`), gated on a real, live pending
`FitnessAgentAction` — never a guess. Every branch below either
regenerates through `generateWorkoutDraft` (full re-resolution + re-trim)
or edits already-resolved `exerciseId`s via the real substitution tool —
a raw exercise NAME never re-enters the payload.

| User says | Mechanism |
|---|---|
| "Buổi tập ngắn xuống 45 phút." | Re-trim only (`trimDayForSessionMinutes`), gated on an explicit minutes-unit word so a bare "45" is never misread as a day count. |
| "Tôi tập được 4 buổi/tuần." | Full regenerate via `generateWorkoutDraft` (day structure genuinely depends on count). |
| "Ngày chân nhẹ hơn." | `intentRouter.route()`'s `muscleGroupHint` (fed normalized text — see audit §4) matched against a small `MUSCLE_GROUP_DAY_RE` table connecting the hint to `recommendation_engine.ts`'s own day/goal labels; matched day(s) get `sets = max(2, sets-1)` — never touches reps/rest. |
| "Đổi squat." / "Tôi không muốn deadlift." / "Tôi không có máy cable." | A small deterministic keyword extractor (`extractExerciseRevisionKeyword`) strips carrier phrasing, matches by substring against the draft's OWN resolved exercise names, then calls `getExerciseSubstitute`; unresolvable matches are DROPPED (never persisted as a name). |
| "Cho phương án khác." | Best-effort resubstitution of every exercise via the same substitution tool. |
| "Thêm superset." | Honest "chưa hỗ trợ" — never silently accepted, never misread as an exercise edit. |

## 4. `proposeSaveGeneratedPlan` collision guard

`SAVE_GENERATED_PLAN`'s intent regex can still fire on "lưu lịch tập này"
while a `CREATE_WORKOUT_PLAN` draft is pending (see audit §5). Fixed with
a check at the very top of `proposeSaveGeneratedPlan`: if a PENDING
`CREATE_WORKOUT_PLAN` action exists for this session, redirect the user
to that action's own preview instead of attempting (and likely failing,
or worse, succeeding against stale data) a `recommendation_engine.ts`
replay.

## 5. Safety

- No new safety mechanism invented. `workoutSafetyWarnings` surfaces
  `safetyScreeningStatus === "FOLLOW_UP_SUGGESTED"`/`injuries` as an
  explicit, visible warning on the preview — a disclosed gap (see audit
  §3), not a new gate.
- Every exercise in a persisted `weeklySchedule` already carries a real
  `exerciseId` resolved via `searchExerciseByName`/`getExerciseSubstitute`
  BEFORE it is ever shown in a preview — an unmatched name is dropped at
  generation/revision time, never persisted as raw text.
- `importAiPlanToSchedule`'s own equipment validation
  (`validateAiPlanExerciseEquipment`) runs internally on confirm — not
  duplicated here.

## 6. Explicitly not built

- No new `WorkflowStatus` value, no orchestrator change.
- No new substitution engine — reuses `exerciseSubstitutionService`.
- No change to FIND_TRAINING_PROGRAM/`applyTrainingPlan`/
  `WorkoutProgramTemplate`.
- No per-set/per-rep conversational fine-tuning beyond the 6 revision
  cases in §3 — anything else falls through to the normal chat pipeline
  (`tryReviseWorkoutPlanDraft` returns `null`).

## 7. Addendum 2026-09-19 — Product remediation #1 (M4/M5/M6/M7/L1)

Full detail: `ai-coach-product-remediation-1.md`. Changes to the design above:

- **Weekdays (M7)**: the draft now carries `selectedWeekdays` (JS 0=Sunday..6, paired by index with program days) and `exclusions`. Priority: user-stated weekdays > `context.days` (agent 1=Mon..7=Sun, converted) when its length equals the day count > the engine's "Thứ N" labels > default spread. Day labels are rewritten to match; the preview shows each day's real first date; `execute()` sends `selectedWeekdays` so persisted `WorkoutSchedule` weekdays equal the reviewed ones. New revision: "Tôi tập được thứ 3, 5, 7".
- **Exclusions (M6)**: keyword extraction uses longest-carrier-phrase-first; matching is whole-token (`deadlift` matches Deadlift and Romanian Deadlift); the keyword becomes a durable exclusion (substitutes that match are retried, else dropped; regenerations re-apply it).
- **Warnings (M5)**: injuries are read from `profile.training.injuries`. The warning states it is warning-only, and a BEGINNER gets an honest note that generated plans are not level-filtered. CREATE_WORKOUT_PLAN does NOT have FIND_TRAINING_PROGRAM's hard eligibility gate.
- **Routing (M4)**: revisions reach this draft through `routePendingDraftTurn` (explicit domain cue > most-recently-touched, non-displaced draft > ask), not a fixed handler order. `tryReviseWorkoutPlanDraft` accepts the selected action.
- **Dismiss (L1)**: "Bỏ qua bản này" cancels the draft server-side (`POST /ai/agent/actions/:id/dismiss`).

## 8. Addendum 2026-09-19 (final remediation)

`execute()` now enforces a terminal-state invariant in its common entry: only `PENDING` executes, `COMPLETED` returns its stored result, `CANCELLED`/anything else -> 409. A workout draft dismissed via "Bỏ qua bản này" therefore cannot be confirmed from a stale card, second tab or replay. `dismissDraft` is conditional/idempotent and never converts a COMPLETED action to CANCELLED. See `ai-coach-product-final-remediation.md`.

## Addendum 2026-09-19 (finalization race closure)

Codex's core sign-off found one race: concurrent confirm and dismiss of the same action could both report success. Fixed at the `FitnessAgentAction` lifecycle: confirm claims `PENDING -> EXECUTING` and dismiss claims `PENDING -> CANCELLED`, each one conditional UPDATE, so exactly one wins and the loser answers truthfully; a business failure after the claim returns the action to `PENDING` (no fake COMPLETED); a stale claim (>2 min) is reclaimable, safe through downstream idempotency. No schema migration (`status` is a free string). See `ai-coach-finalization-race-closure.md`.
