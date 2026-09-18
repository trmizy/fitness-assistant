# Conversational AI Coach Workflow — Audit (Current Code, 2026-09-15)

Scope: what exists in `backend/services/ai-service` (orchestration),
`user-service` (profile/PT truth) and `fitness-service` (roadmap/training/
nutrition truth) **today**, read directly from the working tree — not from
older design docs. This is the required audit-before-build pass for the
Conversational AI Coach Workflow Orchestrator (`agent-workflow/`).

## 1. Entry point and existing dispatch

`fitness-agent.service.ts::tryTurn(question, identity, sessionId)` is the
single chat-turn entry point, called from `llm/orchestrator.service.ts`'s
`/ai/ask` RAG pipeline (`orchestrator.service.ts:448`). It:

1. Parses `question` with `parseFitnessAgentIntent()` — a pure regex/keyword
   classifier (`fitness-agent-intent.ts`), never an LLM call.
2. Dispatches to one of ~18 fixed handlers by `intent.kind`
   (PT/PROGRAM/SELECT/EVALUATE/REVIEW/CREATE_PLAN_BUNDLE/
   SAVE_GENERATED_PLAN/ROADMAP_*/CYCLE_*/WORKOUT_*).
3. Every handler that proposes a real write creates a `FitnessAgentAction`
   row (`kind`, `payload`, `status: PENDING`, `expiresAt`) and returns an
   `ACTION_CONFIRMATION` block; `execute(identity, actionId, confirmed)` is
   the ONE place any of those writes actually happen, and it is already
   idempotent (`status === "COMPLETED"` short-circuits to the stored
   `result`, never re-runs the boundary call).

This dispatch is entirely **single-turn**: nothing before this task tracked
"the user still owes me one more piece of information" across turns. A
handler that found missing required data returned a fixed Vietnamese
sentence listing everything missing and gave up for that turn
(`proposePlanBundle`'s `missing: string[]` block, the generic PT/PROGRAM
branch's "Để tìm lựa chọn phù hợp, hãy cho biết..." message). The user had
to restate their entire original request with everything filled in.

## 2. Tool inventory (`fitness-agent-tools.ts`), classified

All tools go through one `domain()` helper — a plain `axios` call to
`user`/`fitness` service with the caller's own forwarded JWT plus an
internal gateway secret. There is no separate "agent identity"; every write
below is attributed to and re-authorized as the real authenticated user on
the target service's own side (fitness-service/user-service re-validate
ownership themselves — this file never trusts anything beyond `userId`).

| Tool | Method/route | Class | Confirmation | Idempotent? | Source of truth |
|---|---|---|---|---|---|
| `getUserFitnessContext` | GET `/profile/agent/context` (user-service) | READ | n/a | n/a | `UserProfile` (+ derived coach summaries) |
| `findPTCandidates` | POST `/profile/agent/candidates` (user-service) | READ | n/a | n/a | `UserProfile` (PT rows) |
| `findTrainingPrograms` | POST `/workouts/agent/candidates` (fitness) | READ | n/a | n/a | `WorkoutProgram` templates |
| `createPTContractDraft` | POST `/profile/agent/drafts` (user) | DRAFT | 2-step (draft -> `CONFIRM_PT_CONTRACT`) | draft is TTL'd, re-callable | `Contract` draft |
| `confirmPTContract` | POST `/profile/agent/drafts/:id/confirm` | WRITE/CRITICAL | yes (2nd real business step) | server-side (draftId keyed) | `Contract` |
| `applyTrainingPlan` | POST `/workouts/agent/apply` (fitness) | WRITE | yes (`ACTION_CONFIRMATION`) | server checks `fingerprint`, 409 on staleness (`agent-program-apply-idempotency.test.ts`) | `WorkoutProgram`/`WorkoutSchedule` |
| `confirmGoal` | POST `/profile/agent/goal` (user) | WRITE | yes (explicit "Đúng, lưu mục tiêu này" button) | overwrite of `goalIntent`, safe to resend | `UserProfile.goalIntent` |
| `updateProfileFields` **(new)** | PUT `/profile/me` (user) | WRITE | yes — orchestrator's own confirm step | PUT is a partial merge (omitted keys untouched, `profile.models.ts` comment) | `UserProfile` (explicit whitelist, see §5) |
| `getRoadmapDiagnosis` | POST `/fitness-roadmaps/diagnosis` (fitness) | READ | n/a | n/a | zero DB write, pure calculation |
| `generateRoadmapDraft` | POST `/fitness-roadmaps/ai-draft` (fitness) | DRAFT | n/a (preview only) | n/a, pure generation | reads `UserProfile`+InBody, writes nothing |
| `acceptRoadmapDraft` | POST `/fitness-roadmaps/ai-draft/accept` | WRITE | via `CREATE_PLAN_BUNDLE` confirm | creates `FitnessRoadmap`+`RoadmapPhase` rows | `FitnessRoadmap` |
| `activateRoadmap` | POST `/fitness-roadmaps/:id/activate` | WRITE | via `CREATE_PLAN_BUNDLE` confirm | no-op if already ACTIVE (service-side) | `FitnessRoadmap.status` |
| `getCurrentRoadmap`/`getCurrentDraftRoadmap`/`getCurrentRoadmapForecast` | GET | READ | n/a | n/a | `FitnessRoadmap`/forecast engine |
| `advanceRoadmapPhase` | POST | WRITE | via `ROADMAP_ADVANCE` confirm | server no-ops on ACTIVE cycle / insufficient assessment (verified live, see fitness-agent.service.ts's own comment at the `ROADMAP_ADVANCE` execute branch) | `RoadmapPhase` |
| `applyRoadmapRebuild` | POST | WRITE | via `ROADMAP_REBUILD` confirm | replaces not-yet-started phases only | `RoadmapPhase` |
| `archiveRoadmap` | POST | WRITE | via `ROADMAP_ARCHIVE` confirm | terminal, no re-activate path here | `FitnessRoadmap.status` |
| `bootstrapNutrition` | (fitness) | WRITE | via `CREATE_PLAN_BUNDLE` confirm (bundled) | no-op on existing goal (service-side) | `NutritionGoal` |
| `importAiPlanToSchedule` | POST (fitness) | WRITE | via `SAVE_GENERATED_PLAN` confirm | `replaceExisting: true` — explicit, disclosed in the confirmation note | `WorkoutSchedule` |
| `searchExerciseByName` | in-process catalog lookup + synonym table | READ | n/a | n/a | `Exercise` catalog (never creates a row) |
| `substituteMealItem`/`createNutritionLog`/`getTodaySchedule`/`start\|skip\|cancelWorkoutSchedule` | various (fitness) | WRITE (small, single-entity) | yes, each its own `ACTION_CONFIRMATION` or direct apply | server-scoped | `NutritionLog`/`WorkoutSchedule` |
| `completeCycle`/`cancelCycle` | POST (fitness) | WRITE/CRITICAL | via `CYCLE_COMPLETE`/`CYCLE_CANCEL` confirm | terminal | `TrainingCycle` |
| `reviewRecommendation` | POST (fitness) | WRITE | via `REVIEW` intent (accept/reject) | server-scoped | `CycleAssessment` decision |
| `getScientificEvidence` | in-process, static | READ | n/a | n/a | n/a (RAG evidence only) |

**CRITICAL** = touches money/contract state (`confirmPTContract`) or is
otherwise hard to reverse (`archiveRoadmap`, `cancelCycle`). All of these
already required their own explicit confirmation before this task and
**none of that is touched** — the orchestrator only ever gates entry into
the existing dispatch; it never re-implements or shortcuts these steps
(§107 of the task prompt — "do not reopen").

## 3. Real EnterpriseContext field names (traced, not assumed)

`getUserFitnessContext()` → `agentic-fitness.service.ts::context()`
(user-service) returns, verbatim:

```
goal, goalIntent, experience, age, gender, heightCm,
startingWeight, currentWeight, targetWeight, activityLevel,
days, sessionMinutes, budgetVnd, injuries, equipment, gymId,
safetyScreeningStatus, reviewRequired
```

**Finding (real bug, fixed during this task):** the first draft of
`roadmap.workflow.ts` read `currentWeightKg` from this context, which does
not exist on the wire — the real field is `currentWeight`. Had this shipped,
the CREATE_ROADMAP workflow would have asked for current weight on every
single turn, even for a fully-onboarded user, because
`readFromContext` would always return `undefined`. Caught by writing the
DB-backed E2E test (`agent-workflow-roadmap-e2e.test.ts`) before trusting
the design — see the "no-repeat" test. Fixed by pointing `readFromContext`
at `currentWeight` while keeping the slot's own internal `key` as
`currentWeightKg` for unit clarity (the key is never sent over the wire).

`profileExtractor.extract()` (a SEPARATE boundary `proposePlanBundle` uses
for its own independent missing-field check) uses **yet another** field
name for the same value: `currentWeightKg` (`profile_extractor.ts:398`,
`latestInBody?.weightKg ?? profileData?.currentWeight`). These two
boundaries are consistent internally but use different field names for the
same real value — anyone adding a third consumer must check the actual
call, not assume a name from either existing one.

`PUT /profile/me` (`profile.models.ts::profileSchema`) accepts, among
others: `age`, `gender`, `heightCm`, `goal`, `preferredTrainingDays`
(**0–6**, see §5), `currentWeight`, `targetWeight`.

`generateAiRoadmapDraftSchema` (`fitness-roadmap.models.ts`, POST
`/fitness-roadmaps/ai-draft`) accepts only `goalType`, `timeframeWeeks`,
`plannedStartAt`, `constraints: string[]` (≤20 items, ≤200 chars each),
`goalVisualAttributes`, `targetWeightKg`, `targetBodyFatPercent`,
`trainingDaysPerWeek` as overrides. It does **not** accept age/height/
currentWeight/gender overrides — those are always read fresh from the real
stored `UserProfile`/InBody by `fetchUserProfile()` inside
`generateAiRoadmapDraft` (fitness-service). This is why age/height/
currentWeight/gender were made `PROFILE_FACT` slots (see §5) rather than
`WORKFLOW_ONLY`: if any of them were genuinely missing and only collected
in workflow-local state, `proposePlanBundle`'s own re-check after a
workflow resume would still see them as missing (nothing else ever writes
them to the real profile) and silently re-ask — the exact
"never make the user repeat themselves" failure this task explicitly rules
out. This was a second real bug caught the same way as the first, before
either shipped.

## 4. `constraints` genuinely influences generation (verified, not assumed)

`generateAiRoadmapDraftSchema.constraints` flows: ai-service tool call →
fitness-service `generateAiRoadmapDraft` (`fitness-roadmap.service.ts:543`,
`constraints: input.constraints ?? []`) → ai-service's own
`roadmap-draft.service.ts:65,89` renders it verbatim into the LLM prompt as
`Ràng buộc khác: ${req.constraints.join("; ")}`. This is a real, already-
wired mechanism — the ROADMAP_REVISION loop (§9 below) is a new *caller* of
it, not a new capability.

## 5. Source-of-truth boundaries for slot persistence

No business fact is ever written to AI long-term memory by this module.
Every `PROFILE_FACT` slot writes through `updateProfileFields()` → real
`PUT /profile/me` → real `UserProfile` row. The whitelist
(`agentUpdatableProfileFieldsSchema`, `fitness-agent-tools.ts`) is
deliberately narrow:

- **Included**: `goal`, `targetWeight`, `age`, `gender`, `heightCm`,
  `currentWeight` — each a single unambiguous scalar, identical name/unit/
  range on both sides (slot parser vs. real `profileSchema`).
- **Excluded**: `preferredTrainingDays`. `UserProfile.preferredTrainingDays`
  is constrained `0–6`, while every day-array convention elsewhere in this
  agent system (`AgentPreferencesSchema`, `fitness-agent-intent.ts::
  parseTrainingDays`, this task's own `slot-values.ts::parseTrainingDays`)
  is **1–7** (Vietnamese "Thứ N" numbering — confirmed against the
  frontend's own `d === 7 ? "CN" : "T" + (d + 1)` rendering). Writing one
  convention's values into the other's field without an independently
  verified conversion risks silently corrupting a real user's schedule.
  Training-day preference therefore stays `WORKFLOW_ONLY` for both
  CREATE_ROADMAP and FIND_PT/FIND_TRAINING_PROGRAM — exactly how it already
  behaves for PT/PROGRAM search today (never persisted there either).
- PT search budget (`budgetVnd`) has **no UserProfile field at all** —
  genuinely workflow-local by necessity, matching this task's own default
  ("a search preference is not necessarily a permanent profile fact").

## 6. Existing persistent-state models — why a new one was still justified

- `ChatSession` (ai-service): `id, userId, title, lastMessageAt,
  archivedAt`. No concept of "expected next input."
- `FitnessAgentAction`: single fixed-purpose row (`kind`, `payload`,
  `status`, `expiresAt`) representing exactly one pending confirmation. No
  "which slot is still missing," no multi-step slot-collection state, no
  distinction between a workflow-local value and a persisted one.

Neither can represent "mid slot-collection, waiting on X, already know Y
and Z, resume workflow W after this resolves." A new, narrow model was
added: `AgentWorkflowSession` (`ai-service/prisma/schema.prisma`) —
`userId, sessionId, workflowType, status, expectedSlot, slotsJson,
pendingProfileUpdate, draftRef, revision, expiresAt`. It stores **workflow
state**, never business truth: no copy of `currentWeight`/`goal`/contract
status is ever treated as authoritative from this table — every real read
in `proposePlanBundle`/the PT/PROGRAM branch goes back to
`getUserFitnessContext`/`profileExtractor.extract` fresh, every real write
goes through the existing domain services. `slotsJson` is workflow-local
scratch space only.

## 7. PT domain

`findPTCandidates`/PT scoring (`scorePT`, `FITNESS_SCORING`) and the two-step
`CREATE_PT_CONTRACT_DRAFT` → `CONFIRM_PT_CONTRACT` confirmation are
untouched (§107 "do not reopen" — this is Codex-signed-off scoring/claim-
catalog territory). FIND_PT's workflow only gates *entry* into the existing
PT search branch by resolving goal/days/sessionMinutes/budgetVnd first; it
never re-implements ranking or the contract-draft flow.

## 8. Nutrition domain — real scope boundary

There is no standalone chat-driven "create a nutrition plan" capability in
the current domain layer: `bootstrapNutrition` only ever runs bundled
inside `CREATE_PLAN_BUNDLE` (as step 3 of accept-roadmap → apply-workout →
bootstrap-nutrition), and the richer meal-plan/macro/versioning flow
(`NutritionGoal`/`NutritionProgram`/`CycleAssessment`) is a separate,
non-chat REST wizard today. No new nutrition workflow was built standalone
this pass — CREATE_NUTRITION_PLAN is `PARTIAL`: it benefits from
CREATE_ROADMAP's slot-filling (the bundle's nutrition step runs
automatically once the roadmap+workout steps succeed) but there is no
chat-driven revision/preview loop for nutrition specifically, because the
domain layer has no such preview capability to wire up. Building one is a
real, separate, larger unit of work (a genuine `NutritionGoal` draft/
preview/revise capability does not exist yet) — documented here rather than
half-built.

## 9. What this task actually adds

`agent-workflow/` (new directory): `types.ts` (SlotDefinition/
WorkflowDefinition/WorkflowContext), `slot-values.ts` (deterministic
parsers), `slot-resolver.ts` (resolve/missing/question-building),
`workflow-state.repository.ts` (`AgentWorkflowSession` CRUD + auto-expiry),
`orchestrator.ts` (`runWorkflowTurn` — the state machine), `workflows/
roadmap.workflow.ts` (CREATE_ROADMAP, gates `CREATE_PLAN_BUNDLE`),
`workflows/find-pt-program.workflow.ts` (FIND_PT/FIND_TRAINING_PROGRAM,
gates `PT`/`PROGRAM`). `fitness-agent.service.ts::tryTurn` calls
`runWorkflowTurn` first; on a genuine resume it dispatches on the just-
completed workflow's `gatesIntentKind` (not the current turn's own parsed
intent — see the design doc's "resume dispatch" section for why this
matters), then falls through to 100% of the existing, unmodified
preview/confirm/execute logic. A new `ROADMAP_REVISION` handler
(`tryReviseRoadmapDraft`) lets a free-text message revise a still-PENDING
`CREATE_PLAN_BUNDLE` draft via the real `constraints` mechanism (§4),
updating the same action row rather than creating a second one.

See `docs/conversational-ai-coach-workflow-design.md` for the state-machine
design and `docs/conversational-ai-coach-workflow-implementation.md` for
what shipped, file by file.
