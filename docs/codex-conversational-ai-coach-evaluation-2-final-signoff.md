# CODEX — CONVERSATIONAL AI COACH EVALUATION #2

Date: 2026-09-15. Evaluator: Codex independent final foundation review.

## 1. Decision

**RETURN TO CLAUDE**.

Most Remediation #1 fixes are real and pass fresh live assertions. However,
one HIGH safety invariant is still broken: an unsafe `targetWeight` can be
extracted while context is incomplete, stored in workflow-local state, and
later shown inside `PROFILE_UPDATE_CONFIRMATION` after the missing context
arrives. The actual write is blocked by pre-write safety, but the required
"validate before confirmation" invariant is not fully satisfied.

## 2. Evaluation #1 Baseline

Evaluation #1 returned `RETURN TO CLAUDE` for:

- `PROFILE_FACT` use-once accepted.
- Unsafe `targetWeight=30kg` at `180cm/80kg` persisted.
- Initial multi-slot ignored.
- Correction-before-confirm misread.
- No one-active-workflow hard invariant.
- FIND_PT budget parser misread Vietnamese budget notation.

## 3. Production Diff Reviewed

Reviewed current dirty working tree, `git diff --stat`, and `git log --oneline -20`.

Relevant remediation files include:

- `agent-workflow/orchestrator.ts`
- `agent-workflow/types.ts`
- `agent-workflow/slot-values.ts`
- `agent-workflow/target-weight-safety.ts`
- `agent-workflow/workflow-state.repository.ts`
- `agent-workflow/workflows/roadmap.workflow.ts`
- `agent-workflow/workflows/find-pt-program.workflow.ts`
- `prisma/migrations/20260916090000_agent_workflow_session_active_unique/migration.sql`
- `frontend/web/src/app/components/agent/FitnessAgentBlocks.tsx`
- `frontend/web/src/app/services/fitnessAgent.ts`

## 4. Actual Call Graph

Confirmed current shape:

`fitnessAgent.tryTurn()` → `ownSession()` → `runWorkflowTurn()` →
registered `WorkflowDefinition`/`SlotDefinition` → deterministic parser →
optional contextual validator → optional profile confirmation → profile write
after confirm → resume original intent → existing domain handler →
`FitnessAgentAction` → existing business executor.

No second autonomous agent was introduced.

## 5. PROFILE_FACT Use-Once

Fresh v2 evaluator result: **PASS for all six fields**.

goal: PASS  
targetWeight: PASS  
age: PASS  
height: PASS  
currentWeight: PASS  
gender: PASS

Server rejects `"Chỉ dùng cho lần này"` for every current `PROFILE_FACT`, does
not write, does not resume, and leaves workflow `AWAITING_SLOT_CONFIRMATION`.

## 6. Frontend Allowed Actions

PASS by code audit.

Backend sends `allowUseOnce`. Frontend hides the use-once button when
`block.allowUseOnce === false` in
`frontend/web/src/app/components/agent/FitnessAgentBlocks.tsx:228`.

## 7. Contextual Target-Weight Safety

PARTIAL.

Exact Evaluation #1 reproduction passes: `180cm / 80kg / 30kg` is rejected
when height/current weight/goal are already known.

New v2 finding: when `30kg` is extracted before current weight is known, it is
stored as known and later shown as confirmable after current weight arrives.

## 8. Safety Formula / Source

`target-weight-safety.ts` uses:

- Directional consistency: weight-loss target must be below current weight;
  muscle-gain target must be above current weight.
- WHO BMI underweight threshold: rejects target BMI `< 18.5`.

The validator depends on `heightCm`, `currentWeightKg`, and `goal`.

## 9. Safety Validation Before Confirmation

**FAIL / HIGH**.

`extractSafeKnownFromMessage()` validates extracted values only against the
context known at extraction time. `targetWeightSlot.validateContext()` returns
OK when height/current/goal are missing. Later, `finalizeWorkflow()` creates
`PROFILE_UPDATE_CONFIRMATION` without revalidating all now-known slot values
before confirmation.

Source: `orchestrator.ts:138`, `orchestrator.ts:166`,
`roadmap.workflow.ts:119`.

## 10. Safety Validation Before Write

PASS.

The pre-write path re-fetches context and reruns `validateContext`; v2
`safety-stale-context-prewrite` passed.

## 11. Valid-Target Regression

PASS.

Normal targets still reach confirmation:

- `180cm / 80kg / WEIGHT_LOSS / 72kg`
- `175cm / 65kg / MUSCLE_GAIN / 72kg`

## 12. Safety + Stale-Context

PASS.

`65kg` safe at `180cm` became unsafe after height changed to `200cm` before
confirmation. Pre-write validation rejected the write and generated no roadmap.

## 13. Initial Multi-Slot

PASS.

Initial rich message extracted:

- `goal = WEIGHT_LOSS`
- `age = 25`
- `heightCm = 175`
- `currentWeightKg = 80`
- `targetWeight = 72`

It asked only for gender, then produced one batch confirmation after gender.

## 14. Follow-Up Multi-Slot

PASS.

Replying with `25 tuổi, cao 175cm, hiện 80kg, mục tiêu 72kg` while one slot was
expected filled all unambiguous still-missing values and moved to one
confirmation.

## 15. Ambiguous Multi-Slot

PASS.

`80, 72` with no labels did not assign current/target weight.

## 16. Correction-Before-Confirm

PASS.

All tested variants replaced the pending `72kg` proposal with `70kg`, produced
a new confirmation, wrote nothing immediately:

- `Không, 70kg`
- `Ý tôi là 70kg`
- `Đổi thành 70kg`
- `72kg... à không 70kg`

## 17. Unsafe Correction

PASS.

`Không, 30kg` did not replace the safe pending `72kg`, did not write, and did
not resume.

## 18. Active-Workflow Invariant

PASS.

Migration adds partial unique index:

`agent_workflow_sessions_one_active_per_session`

with `WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED')`.

## 19. Concurrent Start

PASS.

20 concurrent `CREATE_ROADMAP` starts for the same user/session left exactly
one active workflow row.

## 20. Concurrent Workflow Types

PASS.

Concurrent `CREATE_ROADMAP` and `FIND_PT` left at most one active workflow.
Observed policy: one request wins; the loser receives the duplicate-active
message.

## 21. Concurrent Slot Replies

PASS with caveat.

Concurrent `72kg` and `70kg` left one DB row and one pending proposal. Both
callers can receive confirmation cards, but only one proposal survives in DB.

## 22. Concurrent Confirm

PASS.

Two concurrent confirmation turns produced one profile write and one roadmap
draft. `claimForWrite()` prevents duplicate downstream generation.

## 23. Budget Parser

PASS.

Exact parsed VND:

```text
1500000       -> 1_500_000
1.500.000     -> 1_500_000
1,500,000     -> 1_500_000
1.5 triệu     -> 1_500_000
1,5 triệu     -> 1_500_000
1tr5          -> 1_500_000
1tr500        -> 1_500_000
1 triệu 500   -> 1_500_000
```

## 24. No-Cap Budget

PASS.

`Không giới hạn` and `Ngân sách không quan trọng` resume to
`PT_RECOMMENDATIONS`; `findPTCandidates` receives no fake numeric budget, and
profile `budgetVnd` remains `null`.

## 25. FIND_PT Dedicated E2E

PASS.

Known goal/days/session length + missing budget asks budget only. Reply
`1.500.000` resumes into `PT_RECOMMENDATIONS` with `budgetVnd = 1_500_000`.

## 26. Existing-Budget No-Repeat

PASS via old evaluator and current code audit.

When EnterpriseContext already contains `budgetVnd`, FIND_PT does not ask
again.

## 27. PT Search→Hire

PASS.

Search → select → `CREATE_PT_CONTRACT_DRAFT` confirmation → execute → second
`CONFIRM_PT_CONTRACT` confirmation → execute → `ACTION_RESULT`.

## 28. PT Two-Step Confirmation

PASS.

No contract confirmation bypass was reproduced.

## 29. Training-Day Parser

LOW finding remains.

```text
T2 T4 T6              -> [1,3,5]
thứ 2 4 6            -> [1,3,5]
thứ 2, thứ 4, thứ 6  -> [1]
```

This is not release-blocking by itself, but it is a common Vietnamese form.

## 30. Duration Parser

PASS.

```text
60 phút       -> 60
1 giờ         -> 60
1 tiếng       -> 60
1 giờ 30 phút -> 90
90 phút       -> 90
```

## 31. Source-Of-Truth Reload

PASS by behavior and code audit.

After profile confirmation, downstream roadmap generation reuses existing
domain flow and fresh profile extraction. `slotsJson` is not treated as final
business truth.

## 32. Failed Profile Write

PASS.

Simulated `updateProfileFields` failure left workflow
`AWAITING_SLOT_CONFIRMATION`, produced no roadmap draft, and returned a
failure message.

## 33. Stale Profile

PASS.

Proposal `null→72`, external update to `70`, then confirm leaves `70` intact
and generates no roadmap.

## 34. Expiry

PASS.

Expired workflow confirmation produced zero writes.

## 35. Cancel

PASS.

`Thôi hủy` moved workflow to `CANCELLED`, with zero profile/business writes.

## 36. Switch

PASS by concurrent/switch audit.

Different workflow starts do not leave two active rows. Slot values are stored
inside the winning workflow row and not merged across workflow types.

## 37. Slot Leakage

PASS.

No evidence of roadmap slot data leaking into PT search. Different workflow
races leave at most one active row.

## 38. Cross-User Isolation

PASS.

Existing `agent-workflow-security-e2e.test.ts` passed. `ownSession()` remains
ahead of workflow continuation.

## 39. Arbitrary Field / Business-State Attack

PASS.

Existing tests pass. `agentUpdatableProfileFieldsSchema` remains a strict
allowlist and does not expose role, admin, contract, roadmap status, or user id
fields.

## 40. Prompt Injection

PASS.

Existing workflow prompt-injection E2E passed: valid slot parsing does not skip
confirmation or write.

## 41. Resume Intent Boundary

PASS.

`resumeIntentKind` is derived from registered server-owned
`WorkflowDefinition.gatesIntentKind`, not from user-provided tool/action text.

## 42. Frontend Contract

PASS.

`PROFILE_UPDATE_CONFIRMATION` includes `allowUseOnce`; frontend does not
reconstruct the business rule from field names.

## 43. Refresh / Session Persistence

PASS by DB-backed design and E2E continuation.

Workflow state is persisted in `AgentWorkflowSession` keyed by user/session.
Different chat sessions do not inherit it.

## 44. Migration

Dev DB status: PASS.

`npx prisma migrate status` under `backend/services/ai-service` reports
`gymcoach_ai` is up to date with 24 migrations.

## 45. Isolated DB

BLOCKED / INFO.

`pnpm run prisma:migrate:test` failed before AI-service migration because the
script targets `postgres-test:5432`, which is only resolvable inside the
CI/docker network in this environment. I did not use `db push`.

## 46. CI Coverage

INFO.

`.github/workflows/docker-test.yml` has a DB integration job and canonical
`prisma:migrate:test`, but the listed DB tests do not include the new
agent-workflow remediation/concurrency tests.

## 47. PT Regression

PASS.

PT search/hire v2 evaluator passed, and existing recommendation claim tests
passed.

## 48. Program V2 Regression

PASS.

`training-program-scoring-v2` and program claim catalog tests passed.

## 49. Memory Regression

PASS.

`memory_extraction` and `memory_policy` tests passed. No workflow business fact
entered `UserMemory`.

## 50. Roadmap Regression

PASS except the new deferred-context safety finding.

Existing roadmap E2E and remediation tests passed. The new HIGH is a missing
revalidation point before confirmation, not a failure of stale write,
use-once, or final execution.

## 51. Builds

PASS:

- `npm --prefix backend/services/ai-service run build`
- `npm --prefix frontend/web run build`
- `npm --prefix backend/shared run build`
- `npm --prefix backend/services/user-service run build`
- `npm --prefix backend/services/fitness-service run build`

Frontend build emitted only the usual large-chunk warning.

## 52. Findings

CRITICAL: none.

HIGH:

- Unsafe `targetWeight=30kg` can become a `PROFILE_UPDATE_CONFIRMATION` if it
  is extracted before current weight is known, then current weight arrives
  later. Pre-write validation blocks persistence, but validation-before-confirm
  is incomplete.

MEDIUM: none.

LOW:

- `parseTrainingDays("thứ 2, thứ 4, thứ 6")` returns `[1]` instead of
  `[1,3,5]`.

INFO:

- Isolated test DB migration command was not runnable from this shell because
  `postgres-test` host was unavailable.
- Workflow DB tests are not visibly wired into CI's DB integration gate.
- Old evaluator now reports `PASS 19 / FAIL 0 / INFO 1`; Claude's note about
  remaining hardcoded FAIL entries is stale for this working tree.

## 53. Workflow Matrix

```text
CREATE_ROADMAP: PARTIAL
ROADMAP_REVISION: SIGNED OFF
FIND_TRAINING_PROGRAM: SIGNED OFF
FIND_PT: SIGNED OFF
PT SEARCH→HIRE: SIGNED OFF
CREATE_WORKOUT_PLAN: NOT BUILT
WORKOUT_PLAN_REVISION: NOT BUILT
CREATE_NUTRITION_PLAN: PARTIAL
NUTRITION_REVISION: NOT BUILT
```

`CREATE_ROADMAP` is marked PARTIAL only because of the deferred-context
target-weight safety confirmation bug.

## 54. Is The Conversational Workflow Foundation Safe To Extend?

**NO.**

The foundation is very close, but health-safety validation must be complete
before extension into standalone Workout/Nutrition workflows.

## 55. Supervisor Scenario Today

```text
ROADMAP: PARTIAL
WORKOUT: PARTIAL
PT: YES
NUTRITION: PARTIAL
```

ROADMAP works for normal paths, but the deferred unsafe target confirmation
blocks final sign-off. WORKOUT works as roadmap-bundled workout application,
not as standalone conversational workflow. PT search→hire works with two-step
confirmation. NUTRITION works only as bundled bootstrap, not standalone
preview/revise/confirm.

## 56. Production Files Modified By Codex

NONE.

Codex only added evaluation artifacts and this report.

## 57. Evaluation Artifacts Created

- `backend/services/ai-service/src/evaluation/conversational-workflow-v2/evaluate_conversational_workflow_v2.ts`
- `backend/services/ai-service/src/evaluation/conversational-workflow-v2/results/conversational-workflow-evaluation-2.json`
- `docs/codex-conversational-ai-coach-evaluation-2-final-signoff.md`

## 58. Next Phase Recommendation

Do not start standalone Workout/Nutrition workflow work yet.

Return a focused fix:

1. Re-run every slot's `validateContext` inside `finalizeWorkflow()` after
   all required slots are known and before emitting `PROFILE_UPDATE_CONFIRMATION`.
2. Ensure unsafe values already sitting in `known` are removed/re-asked, not
   proposed.
3. Add the exact failing case:
   initial message contains `goal/age/height/targetWeight=30kg`, current weight
   is missing, then user supplies `80kg`.
4. Optionally fix `thứ 2, thứ 4, thứ 6` parser while there.

## 59. Final Sign-Off Line

**RETURN TO CLAUDE — ONE HIGH REMAINS: DEFERRED-CONTEXT UNSAFE TARGET WEIGHT
CAN STILL BE SHOWN AS A CONFIRMABLE PROFILE UPDATE.**
