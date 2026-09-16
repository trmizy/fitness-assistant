# Conversational AI Coach Workflow — Implementation

What shipped, file by file. See the audit doc for what already existed and
the design doc for the state machine this implements.

## New files

- `backend/services/ai-service/prisma/schema.prisma` — `AgentWorkflowSession`
  model (`id, userId, sessionId, workflowType, status, expectedSlot,
  slotsJson, pendingProfileUpdate, draftRef, revision, expiresAt,
  createdAt, updatedAt`, indexed on `[userId, sessionId, status]`).
- `.../prisma/migrations/20260915120000_agent_workflow_session/migration.sql`
  — applied via `prisma migrate deploy` against both the dev DB
  (`gymcoach_ai`, port 5433) and the isolated test DB (`gymcoach_ai_test`,
  port 55433).
- `.../src/agent-workflow/types.ts` — `SlotSource`, `SlotPersistence`,
  `SlotProvenance`, `SlotParseResult<T>`, `WorkflowContext`,
  `SlotDefinition<T>`, `WorkflowStatus`, `PendingProfileUpdate`,
  `WorkflowDefinition`.
- `.../src/agent-workflow/slot-values.ts` — deterministic parsers:
  `parseWeightKg`, `parseHeightCm`, `parseAge`, `parseGender`, `parseGoal`,
  `parseTrainingDays`, `parseMinutes`, `parseBudgetVnd`. All reuse
  `normalizeAgentText` from `fitness-agent-intent.ts` (no second diacritic-
  stripping/normalization implementation).
- `.../src/agent-workflow/slot-resolver.ts` — `resolveSlots`,
  `missingRequiredSlots`, `buildMissingSlotsQuestion`,
  `buildKnownMissingSummary`.
- `.../src/agent-workflow/workflow-state.repository.ts` —
  `findActive` (auto-expires past-`expiresAt` rows on read), `create`,
  `update`, `cancel`, `complete`. `WORKFLOW_TTL_MS = 30 * 60_000`.
- `.../src/agent-workflow/orchestrator.ts` — `runWorkflowTurn` (the state
  machine described in the design doc), `registerWorkflow`, `RESUME_SENTINEL`.
- `.../src/agent-workflow/workflows/roadmap.workflow.ts` — CREATE_ROADMAP,
  gates `CREATE_PLAN_BUNDLE`. 6 slots: `goal`/`age`/`heightCm`/
  `currentWeightKg`/`gender` (all `PROFILE_FACT`) + `targetWeight`
  (`PROFILE_FACT`, conditionally required only for WEIGHT_LOSS/MUSCLE_GAIN).
- `.../src/agent-workflow/workflows/find-pt-program.workflow.ts` — FIND_PT
  (gates `PT`) and FIND_TRAINING_PROGRAM (gates `PROGRAM`). Shared
  `goal`/`days`/`sessionMinutes` (optional) slots; FIND_PT adds a required
  `budgetVnd` slot. All four `WORKFLOW_ONLY`.
- Tests: `src/__tests__/agent-workflow-roadmap-e2e.test.ts` (4 cases),
  `src/__tests__/agent-workflow-program-e2e.test.ts` (1 case) — see
  evaluation doc for what each proves.

## Modified files

- `.../src/services/fitness-agent-tools.ts`:
  - `domain()`'s `method` parameter widened to include `"PUT"`.
  - New `agentUpdatableProfileFieldsSchema` (`.strict()`): `goal`,
    `targetWeight`, `age`, `gender`, `heightCm`, `currentWeight` — an
    explicit whitelist subset of user-service's real `profileSchema`.
    `preferredTrainingDays` is deliberately excluded (0–6 vs. the rest of
    this agent system's 1–7 day convention — see audit doc §5).
  - New `updateProfileFields(identity, fields)` tool — `PUT /profile/me`
    through the existing `domain()` helper, same forwarded-JWT trust model
    as every other tool in this file.

- `.../src/services/fitness-agent.service.ts`:
  - New imports + 3 `registerWorkflow(...)` calls at module load
    (`createRoadmapWorkflow`, `findPtWorkflow`, `findTrainingProgramWorkflow`).
  - `tryTurn`: `ownSession()` moved to the very top (was previously only
    reached for a recognized `intent.kind`); `runWorkflowTurn()` called
    immediately after, before any existing dispatch; `effectiveKind`
    (resume-aware) replaces `intent.kind` as the dispatch key for the ENTIRE
    remaining handler chain, including the two Prisma-write fields
    (`fitnessRecommendation.type`, `.scoringVersion`) that a straight
    find-replace would have missed (caught by `tsc`, not by inspection —
    see evaluation doc).
  - New `buildPlanBundleConfirmationBlock()` helper, factored out of
    `proposePlanBundle` so a revision renders through the identical code
    path as the initial preview.
  - New `tryReviseRoadmapDraft()` — the ROADMAP_REVISION handler (see
    design doc §9). Called from the `!effectiveKind` branch, gated on
    `!isResuming` (a resume turn never re-enters revision detection).
  - `AgentBlock` type union extended: `"WORKFLOW_MISSING_DATA"`,
    `"PROFILE_UPDATE_CONFIRMATION"`.

- `.../src/agent-workflow/orchestrator.ts` (iterative fixes made after the
  E2E tests surfaced them — see evaluation doc for the exact failing→passing
  sequence):
  - `TurnResult` gained `resumeIntentKind`/`resumeKnownSlots`, set at all
    three RESUME_SENTINEL return sites.
  - `handleConfirmationReply` widened its `active` parameter to include
    `slotsJson` (needed to source `resumeKnownSlots`).
  - `USE_ONCE_RE` widened to match "chi dung **cho** lan nay" — the real
    normalized form of the PROFILE_UPDATE_CONFIRMATION button's own text
    ("Chỉ dùng cho lần này"), which the original regex (missing "cho")
    did not match.

- `.../src/agent-workflow/workflows/roadmap.workflow.ts` (post-audit fixes):
  - `currentWeightSlot.readFromContext` now reads `currentWeight` (the
    real EnterpriseContext field), not the invented `currentWeightKg`.
  - `age`/`heightCm`/`currentWeightKg`/`gender` slots changed from
    `WORKFLOW_ONLY` to `PROFILE_FACT` (see design doc §4a for why).

- `.../src/agent-workflow/workflows/find-pt-program.workflow.ts` (post-
  regression fix): `budgetSlot.readFromContext` now reads the real
  `budgetVnd` field from EnterpriseContext instead of unconditionally
  returning `undefined` (see design doc §7).

- `backend/services/ai-service/src/services/fitness-agent.service.ts`
  (frontend-facing block wiring) + `frontend/web/src/app/services/
  fitnessAgent.ts` (`AgentChatBlock` type gained `WORKFLOW_MISSING_DATA`/
  `PROFILE_UPDATE_CONFIRMATION`, and `workflowId`/`workflowType`/`known`/
  `missing`/`changes` fields) + `frontend/web/src/app/components/agent/
  FitnessAgentBlocks.tsx` (two new render branches — see §"Frontend" below)
  + `frontend/web/src/app/pages/client/AICoachPage.tsx` (`onQuickReply={send}`
  wired to `FitnessAgentBlock`).

## Frontend

`WORKFLOW_MISSING_DATA` renders a read-only known✓/missing• summary — no
buttons. The user answers by typing normally in the existing chat input;
that text flows through the SAME `sendQuestion` → `/ai/ask` →
`fitnessAgent.tryTurn` → `runWorkflowTurn` path every other message already
uses, so no new API surface was needed for this card.

`PROFILE_UPDATE_CONFIRMATION` renders a field/old→new list plus three
buttons ("Xác nhận cập nhật" / "Chỉ dùng cho lần này" / "Hủy"), each of
which calls the SAME `onQuickReply` (the page's existing `send()` callback)
with that exact Vietnamese text — i.e. clicking a button behaves exactly
like typing that phrase, deliberately reusing the orchestrator's own
regex-based confirm/decline/cancel detection rather than adding a second,
button-specific API path. `PROFILE_FIELD_LABEL_VI`/`formatProfileFieldValue`
in `FitnessAgentBlocks.tsx` mirror the backend's own
`SlotDefinition.label`/`.format` for every currently-persistable field
(`goal`, `targetWeight`, `age`, `gender`, `heightCm`, `currentWeight`) —
kept in sync manually, no shared package export for this small a surface.

Verified via `npx tsc --noEmit` (ai-service) and `npx vite build`
(frontend/web) after every change in this section — both clean. No live
browser session was exercised this pass (see evaluation doc's honesty
labels).

## Explicitly not built this pass (see audit doc §8, design doc §8)

- A bounded LLM slot extractor (deterministic parsing covers the current
  slot set's realistic phrasing space).
- A standalone chat-driven CREATE_NUTRITION_PLAN workflow (no preview/
  revise capability exists in the domain layer to wire up yet — nutrition
  only participates today as CREATE_PLAN_BUNDLE's bundled step 3).
- CREATE_WORKOUT_PLAN as its own workflow distinct from FIND_TRAINING_PROGRAM
  (the `SAVE_GENERATED_PLAN` chat-plan-generation path is a separate,
  already-single-turn-workable flow; wiring slot-filling onto it was not
  attempted this pass — see the completion matrix in the evaluation doc).
- ROADMAP_STATUS/ADVANCE/REBUILD/ARCHIVE, HIRE_PT's
  `CREATE_PT_CONTRACT_DRAFT`/`CONFIRM_PT_CONTRACT` two-step, and every
  scoring/claim-catalog/memory-provenance module — untouched, per the
  task's own "do not reopen" list.

## Remediation #1 (post Codex Evaluation #1)

See `docs/conversational-ai-coach-remediation-1.md` for the full account.
Summary of files touched in that pass (all under the same directories
listed above — no new top-level module):

- New: `agent-workflow/target-weight-safety.ts`,
  `prisma/migrations/20260916090000_agent_workflow_session_active_unique/`,
  `__tests__/agent-workflow-remediation-1.test.ts`.
- Modified: `agent-workflow/types.ts` (`allowsUseOnce`, `validateContext`,
  `extractFromMessage`, `WRITING` status), `agent-workflow/slot-values.ts`
  (weight self-correction, multi-day parsing, hour-based duration,
  Vietnamese-notation budget parsing), `agent-workflow/orchestrator.ts`
  (`finalizeWorkflow` consolidation, message extraction wiring, correction
  detection, use-once policy enforcement, write-time concurrency claim +
  two-pass safety validation), `agent-workflow/workflow-state.repository.ts`
  (race-safe `create()`, claim/release), `agent-workflow/workflows/
  roadmap.workflow.ts` (contextual safety + message extraction),
  `agent-workflow/workflows/find-pt-program.workflow.ts` (no-cap budget
  message), `prisma/schema.prisma`, `frontend/web/.../fitnessAgent.ts`,
  `frontend/web/.../FitnessAgentBlocks.tsx`.

## Remediation #2 / Final Safety Closure (post Codex Evaluation #2)

One further production file: `agent-workflow/orchestrator.ts` —
`finalizeWorkflow()` gained a generic contextual-revalidation pass (see
`docs/conversational-ai-coach-safety-closure.md`). New test file:
`__tests__/agent-workflow-remediation-2.test.ts` (11 cases, including
parser-variant unit tests for the training-days/duration fixes that were
already on the tree but previously untested). No schema/migration change.
