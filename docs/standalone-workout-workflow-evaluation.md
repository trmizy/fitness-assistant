# Standalone CREATE_WORKOUT_PLAN — Evaluation

Date: 2026-09-18. Evidence for the CREATE_WORKOUT_PLAN capability
(`standalone-workout-workflow-design.md`). Labels follow this repo's
evidence convention: BACKEND INTEGRATION (real DB, stubbed HTTP
boundaries only) and CODE AUDIT.

## 1. New tests — BACKEND INTEGRATION

`src/__tests__/agent-workflow-create-workout-plan.test.ts` — 5/5 passing:

1. **Golden flow**: daysPerWeek known from context, sessionMinutes asked
   ("1 tiếng" → 60) → auto-resume → real generated draft
   (`WORKOUT_PLAN_PREVIEW`) → every exercise already carries a resolved
   `exerciseId` (asserted directly against the persisted
   `FitnessAgentAction.payload`) → "Ngày chân nhẹ hơn." lowers sets on the
   real Legs day → "Đổi squat." calls the real substitution tool and the
   excluded exercise (`ex-back-squat`) is genuinely gone, not relabeled →
   `execute()` calls `importAiPlanToSchedule` exactly once → a repeated
   confirm returns the stored result, no second import call.
2. **No-repeat**: daysPerWeek+sessionMinutes both already known → first
   turn goes straight to `WORKOUT_PLAN_PREVIEW`, zero
   `AgentWorkflowSession` rows created.
3. **Session-length revision**: "Buổi tập ngắn xuống 20 phút." sets
   `sessionMinutes=20` (never misread as a day-count from the bare
   digit "20") and never increases the exercise count.
4. **Unsupported revision**: "Thêm superset." answers honestly
   ("chưa hỗ trợ"), the current draft/actionId is preserved unchanged.
5. **Save-collision guard**: "lưu lịch tập này" while a draft is pending
   redirects to that SAME `CREATE_WORKOUT_PLAN` action; zero competing
   `SAVE_GENERATED_PLAN` actions are created.

## 2. Cross-domain tests — BACKEND INTEGRATION

`src/__tests__/agent-workflow-cross-domain.test.ts` (shared with the
nutrition capability):

- CREATE_WORKOUT_PLAN reuses `goal`/`days`/`sessionMinutes` straight from
  the same `EnterpriseContext` FIND_PT/FIND_TRAINING_PROGRAM already read
  — no redundant re-ask when triggered right after those.
- A pending CREATE_WORKOUT_PLAN, switched away from via "Khoan, tìm PT cho
  tôi trước", is cleanly `CANCELLED` (never left dangling), FIND_PT
  proceeds straight to a real search using genuinely-shared context, and
  the abandoned workout draft leaves zero `FitnessAgentAction` rows
  behind (it never got far enough to create one).

## 3. Full regression — BACKEND INTEGRATION

Run together (`agent-workflow-roadmap-e2e`, `-remediation-1`,
`-remediation-2`, `-program-e2e`, `-security-e2e`,
`-create-workout-plan`, `-create-nutrition-plan`, `-cross-domain`):
**40/40 passing**, zero regressions in any previously-signed-off behavior
(roadmap E2E, target-weight safety Fix B, deferred-context revalidation,
PROFILE_FACT use-once, cross-user isolation, business-state/arbitrary-
field attacks).

`npx tsc --noEmit` (ai-service) and `npm run build` (frontend/web): both
clean.

## 4. Security — CODE AUDIT

Both new slots (`daysPerWeek`, `sessionMinutes`) are `WORKFLOW_ONLY` —
confirmed by direct grep of `create-workout-plan.workflow.ts`. Neither is
ever written to `UserProfile`, so the arbitrary-profile-write surface
`agentUpdatableProfileFieldsSchema` already guards is unchanged. No new
`validateContext` was needed (no domain-safety concern exists for a day
count or a duration), so the three-stage validation pipeline is simply
not exercised for this workflow — not weakened, not bypassed.

## 5. Not run / genuinely deferred

- No REAL BROWSER verification of the `WORKOUT_PLAN_PREVIEW` mobile
  layout — `npm run build` confirms it compiles and bundles; visual/touch
  verification at 360/375/390/412px was not performed live in this pass.
  The markup reuses the SAME `<details>`/button primitives already used
  elsewhere in `FitnessAgentBlocks.tsx` (e.g. `PT_RECOMMENDATIONS`'s own
  collapsible `<details>`), which are already mobile-verified in this
  codebase's history — this is a reasonable but not independently
  re-verified inference.
- No live-LLM run — `recommendation_engine.ts` is fully deterministic, so
  no LLM is involved in generation at all; the async-job style asserted
  elsewhere in this task applies only to nutrition.

## 6. Addendum 2026-09-19 — Codex product E2E findings and re-verification

Codex (`codex-ai-coach-product-e2e-1`) found M5 (injury warning read the wrong field), M6 (no-cable / no-deadlift phrases) and M7 (saved weekdays != preview) in this capability. All closed in `ai-coach-product-remediation-1.md`; new tests in `agent-workflow-product-remediation-1.test.ts` (M5 x1, M6 x3, M7 x3, routing x4, dismiss x1, idempotency x1). M7 is additionally proven against the REAL fitness-service DB by `test/ai-coach-product-remediation-1/domain-verify.ts`: without `selectedWeekdays` a Friday start saves Fri/Sat/Sun (the reproduced defect); with it every saved date is Mon/Wed/Fri and each program day's first date equals the preview's. Statements in §1-§5 above that the previous 5 tests proved these behaviours are superseded: those tests stubbed the boundary where the defects lived.

## 7. Addendum 2026-09-19 (final remediation)

Codex reproduced dismiss -> confirm -> import invoked -> COMPLETED. Fixed at the common `execute()` guard; tests: dismiss then stale confirm -> rejected, 0 imports, status stays CANCELLED; double dismiss idempotent; dismiss after complete keeps COMPLETED; COMPLETED confirm still one write; EXPIRED still rejected; cancelled draft not routed. All in `agent-workflow-product-final-remediation.test.ts`. M5/M6/M7 regressions stay green (`agent-workflow-product-remediation-1.test.ts`).

## Addendum 2026-09-19 (finalization race closure)

Codex's core sign-off found one race: concurrent confirm and dismiss of the same action could both report success. Fixed at the `FitnessAgentAction` lifecycle: confirm claims `PENDING -> EXECUTING` and dismiss claims `PENDING -> CANCELLED`, each one conditional UPDATE, so exactly one wins and the loser answers truthfully; a business failure after the claim returns the action to `PENDING` (no fake COMPLETED); a stale claim (>2 min) is reclaimable, safe through downstream idempotency. No schema migration (`status` is a free string). See `ai-coach-finalization-race-closure.md`.
