# GYMINI — Conversational AI Coach Evaluation #1

Date: 2026-09-15. Evaluator: Codex independent regression.

Decision: **RETURN TO CLAUDE**.

This is not a rejection of the whole orchestration foundation. The happy
path works, stale-confirm protection works, failed profile writes do not
resume, expired confirmations do not write, cross-user workflow continuation
is covered by existing E2E, and the PT two-step hire path remains intact.
However, two release-blocking production-path failures remain:

- `PROFILE_FACT` still exposes and accepts "Chỉ dùng cho lần này", despite
  the type contract saying profile facts have no legitimate use-once mode.
- A medically implausible target weight can be confirmed and persisted
  without contextual safety validation.

Evaluator artifacts:

- `backend/services/ai-service/src/evaluation/conversational-workflow/evaluate_conversational_workflow.ts`
- `backend/services/ai-service/src/evaluation/conversational-workflow/results/conversational-workflow-evaluation-1.json`

## 1. Requested Decision

**RETURN TO CLAUDE**.

The requested return conditions include "use-once causes repeat/failure for
`PROFILE_FACT`" and "unsafe plausible target weight bypasses safety." Both
were reproduced against the current code.

## 2. Scope

Reviewed the new conversational workflow foundation under
`backend/services/ai-service/src/agent-workflow/`, its call-in point from
`fitness-agent.service.ts`, and its interaction with the existing roadmap,
training program, PT recommendation, profile-write, and action confirmation
paths.

## 3. Non-Scope

I did not fix production behavior. I only added evaluator-only artifacts under
`src/evaluation/conversational-workflow/` and this report.

## 4. Sources Read

Read current workflow docs, target architecture docs, prior sign-off reports,
agent workflow source, fitness agent source, Prisma schema, and the relevant
frontend block renderer.

## 5. Commands Run

- `npx tsx backend/services/ai-service/src/evaluation/conversational-workflow/evaluate_conversational_workflow.ts`
- `npx tsx --test backend/services/ai-service/src/__tests__/agent-workflow-roadmap-e2e.test.ts backend/services/ai-service/src/__tests__/agent-workflow-program-e2e.test.ts backend/services/ai-service/src/__tests__/agent-workflow-security-e2e.test.ts`
- `npx tsx --test backend/services/ai-service/src/llm/__tests__/memory_extraction.test.ts backend/services/ai-service/src/llm/__tests__/memory_policy.test.ts backend/services/ai-service/src/llm/__tests__/recommendation_claims.test.ts backend/services/ai-service/src/llm/__tests__/program_recommendation_claims.test.ts backend/services/ai-service/src/__tests__/training-program-scoring-v2.test.ts`
- `npm --prefix backend/services/ai-service run build`

## 6. Verification Summary

Evaluator result: **PASS 7, FAIL 12, INFO 1, BLOCKED 0**.

Existing workflow E2E result: **8 pass, 0 fail**.

Existing memory/program/claim regression result: **76 pass, 0 fail**.

TypeScript build: **pass**.

## 7. Critical Findings

No cross-user access, arbitrary dispatch, expired-confirm write, failed-write
resume, or PT two-step bypass was reproduced.

The blocking issues are classified High/Medium rather than Critical, but they
meet the user's explicit RETURN criteria.

## 8. High Finding — Unsafe Target Weight Persists

Case: `unsafe-target-weight-accepted`.

For a profile with height `180 cm`, current weight `80 kg`, and missing target
weight, the workflow accepted `30 kg`, showed profile-update confirmation,
persisted `{ targetWeight: 30 }`, and resumed into roadmap generation.

Source mechanism: `parseWeightKg()` only enforces absolute `25..300 kg`
range in `agent-workflow/slot-values.ts:20`. `handleConfirmationReply()`
then writes the field via `deps.updateProfileFields()` in
`agent-workflow/orchestrator.ts:252`.

## 9. High Finding — Use-Once Target Weight Proceeds With Stale Profile

Case: `use-once-targetWeight`.

The workflow accepted "Chỉ dùng cho lần này" for a `PROFILE_FACT` target
weight. It wrote nothing, marked the workflow completed, and resumed into an
`ACTION_CONFIRMATION`.

The generated roadmap draft was based on the real profile, where
`targetWeight` was still `null`, because `proposePlanBundle()` refetches
profile and calls `generateRoadmapDraft()` without passing workflow-local
target-weight override (`fitness-agent.service.ts:674`, `:691`).

## 10. Medium Finding — Use-Once Other Profile Facts Fail/Re-Ask

Cases:

- `use-once-goal`
- `use-once-age`
- `use-once-heightCm`
- `use-once-currentWeight`
- `use-once-gender`

Each accepts use-once for `PROFILE_FACT`, completes the workflow, writes
nothing, then falls back to the legacy profile-missing message because the
real profile remains incomplete.

## 11. Medium Finding — UI Offers Invalid Use-Once Action

The frontend renders "Chỉ dùng cho lần này" for every
`PROFILE_UPDATE_CONFIRMATION` block in
`frontend/web/src/app/components/agent/FitnessAgentBlocks.tsx:214`.

This contradicts `SlotPersistence`'s own contract:
`PROFILE_FACT` has "no legitimate just this once mode"
(`agent-workflow/types.ts:25`).

## 12. Medium Finding — Initial Multi-Slot Message Is Ignored

Case: `initial-message-multislot-ignored`.

Initial prompt included goal, age, height, current weight, and target weight.
`startWorkflow()` still created a row with `{}` slots and asked for goal.

Source mechanism: `startWorkflow()` builds context from enterprise profile
only and does not parse the initiating message (`agent-workflow/orchestrator.ts:129`).

## 13. Medium Finding — Correction Before Confirm Is Misread

Case: `correction-before-confirm`.

After proposing `72 kg`, the reply `Không, 70 kg` was treated as decline /
use-once, not as a correction. The workflow completed, wrote nothing, and
resumed into roadmap preview.

Source mechanism: `handleConfirmationReply()` checks decline/use-once before
attempting to parse replacement slot values (`agent-workflow/orchestrator.ts:228`).

## 14. Medium Finding — No DB-Enforced Active Workflow Invariant

Dynamic concurrent start did not reproduce a duplicate active row in my local
run. Static schema review still found no database-enforced uniqueness
invariant for "one active workflow per user/session."

`AgentWorkflowSession` has `@@index([userId, sessionId, status])`, not a
unique/partial-unique active-session guard (`prisma/schema.prisma:870`).
`workflowStateRepository.create()` blindly inserts (`workflow-state.repository.ts:32`).

## 15. Medium Finding — FIND_PT Budget Parser Misreads Dot Thousands

Case: `find-pt-dedicated-e2e`.

The workflow resumed into `PT_RECOMMENDATIONS`, but a natural Vietnamese budget
reply `1.500.000` was parsed as `2` VND. The parser treats `1.500` as decimal
1.5 with no unit, rounds it to `2` (`agent-workflow/slot-values.ts:117`).

## 16. Low Finding — Unlimited Budget Reply Re-Asks Forever

Case: `find-pt-unlimited-budget-traps-user`.

`Ngân sách không quan trọng` returns `no_number_found`. If no-budget search is
valid product behavior, this slot needs an explicit no-cap representation.

## 17. Pass — Flagship Roadmap Confirm Path

Case: `roadmap-flagship-confirm-resume`.

The flow asked for missing target weight, produced a profile update
confirmation, wrote `{ targetWeight: 72 }` exactly once after confirmation, and
resumed into `ACTION_CONFIRMATION`.

## 18. Pass — No Premature Roadmap Writes

During collection and profile-update confirmation, no roadmap activation,
training-plan apply, or nutrition bootstrap occurred.

## 19. Pass — Stale Confirm Rejected

Case: `stale-profile-confirm-rejected`.

When the real profile changed from `null` to `70` before confirming the old
`72` proposal, the workflow refused to write and cancelled.

## 20. Pass — Expired Confirm Does Not Write

Case: `expired-confirm-no-write`.

After manually expiring the workflow row, a confirmation reply produced no
profile write and the row moved to `EXPIRED`.

## 21. Pass — Failed Profile Write Does Not Resume

Case: `failed-profile-write-does-not-resume`.

When `updateProfileFields()` threw, the workflow stayed
`AWAITING_SLOT_CONFIRMATION` and did not call roadmap draft or program search.

## 22. Pass — Cross-User Workflow Isolation

Existing security E2E passed: a session id belonging to another user cannot be
used to continue that user's pending workflow.

## 23. Pass — Business-State Attack Rejected

Existing security E2E passed: a business-state-shaped payload while a slot is
pending cannot write contract state or skip workflow rules.

## 24. Pass — Arbitrary Field Attack Rejected

Existing schema-level test passed: `agentUpdatableProfileFieldsSchema` rejects
fields outside its explicit allowlist.

## 25. Pass — PT Two-Step Hire Path

Case: `pt-search-to-hire-two-step`.

PT recommendation still requires:

1. select candidate,
2. confirm `CREATE_PT_CONTRACT_DRAFT`,
3. confirm `CONFIRM_PT_CONTRACT`.

No one-step PT contract bypass was reproduced.

## 26. Pass — Existing Budget Avoids FIND_PT Re-Ask

Case: `find-pt-existing-budget-no-ask`.

When profile budget exists, FIND_PT goes directly to `PT_RECOMMENDATIONS`.

## 27. Partial — FIND_PT Dedicated E2E

The dedicated path exists and resumes. The blocker is semantic: the budget is
parsed incorrectly for dot-thousands notation.

## 28. Partial — Concurrent Start

Local dynamic `Promise.all()` produced one active row. This is not sufficient
for production sign-off because the DB schema still lacks a hard invariant.

## 29. Parser Snapshot — Weight

Accepted:

- `72kg`
- `72 kg`
- `72 ký`
- `72 kí`
- `72 cân`

Problem: `72 kg... à không 70 kg` returns `72`, the first number.

## 30. Parser Snapshot — Training Days

`T2 T4 T6` parses correctly as `[1,3,5]`.

`thứ 2 4 6` returns only `[1]`; the bare `4 6` are ignored.

## 31. Parser Snapshot — Budget

`1500000` and `1.5 triệu` parse correctly.

`1tr5` returns `5`; `1.500.000` returns `2`; `không giới hạn` is rejected.

## 32. Parser Snapshot — Duration

`60 phút` parses correctly.

`1 tiếng` and `1 giờ` are rejected.

## 33. Workflow State Model Review

The model is additive and appropriately keeps workflow state separate from
business truth. The missing production hardening is not the existence of the
table; it is the absence of an active-row uniqueness invariant.

## 34. Slot Classification Review

The conceptual classification is good. The implementation does not enforce
the most important boundary: `PROFILE_FACT` must not have a decline/use-once
path that continues the workflow.

## 35. Resume Dispatch Review

Resume dispatch is server-owned through `resumeIntentKind`, not user-authored.
This is a good property and I did not reproduce arbitrary dispatch.

## 36. Resume Known Slots Review

`resumeKnownSlots` is appropriate for `WORKFLOW_ONLY` FIND_PT/program slots.
It becomes unsafe or semantically broken when used to continue after declined
`PROFILE_FACT` slots.

## 37. Roadmap Integration Review

Roadmap integration is close but not sign-off ready because target-weight
collection can resume with missing or unsafe real profile data.

## 38. Roadmap Revision Review

No regression was found in the existing action-confirmation model for roadmap
revision. This evaluation did not reopen all previous revision-loop coverage.

## 39. Training Program Integration Review

Existing workflow/program E2E passed. Existing program scoring v2 and claim
tests passed.

## 40. PT Integration Review

PT search, select, draft, and final confirmation remain gated. The new concern
is only slot parsing for natural budget expressions.

## 41. Memory Integration Review

Memory provenance and memory policy regression tests passed. No new workflow
path was found that writes long-term memory.

## 42. Action Confirmation Review

The new workflow foundation still hands real writes to the existing
`FitnessAgentAction` confirmation path. The profile update step is the one
new write surface needing stricter policy.

## 43. Expiry Review

Workflow expiry behavior is correct in the tested confirmation case: expired
state does not write.

## 44. Stale Overwrite Review

The stale profile check is a strong piece of the design and passed direct
adversarial testing.

## 45. Failed Write Review

Failed profile writes do not complete the workflow or resume business action.
This passed.

## 46. Frontend Review

The frontend currently cannot distinguish `PROFILE_FACT` from optional
preferences in its confirmation buttons. It always offers use-once.

## 47. CI Review

The targeted tests pass locally. I did not verify that the new evaluator is
wired into CI. The evaluator currently lives as an artifact for this review,
not as a production test gate.

## 48. Migration Review

The local DB accepted workflow E2E and evaluator runs, so the schema exists in
this environment. This pass did not run a clean isolated migration from an
empty database.

## 49. Observability Review

The workflow logs profile write failures. No dedicated telemetry assertion was
added for unsafe target-weight rejection because that rejection does not exist
yet.

## 50. Safety Review

Safety is the main blocker. The workflow's absolute kg range is not enough for
target-weight safety. It needs contextual validation against height, current
weight, age, goal, and existing safety rules before confirmation and before
profile write.

## 51. Security Review

No cross-user continuation or arbitrary field write was reproduced. Existing
tests for those paths passed.

## 52. Product UX Review

The multi-slot and correction behavior will feel broken to users: a rich
opening prompt is ignored, and "no, 70kg" does the opposite of what the user
means.

## 53. Recommended Fix Set

Before re-review:

- Remove or disable "use once" for `PROFILE_FACT` both server-side and UI-side.
- Add contextual target-weight safety validation before creating a
  `PROFILE_UPDATE_CONFIRMATION` and again before writing.
- Parse initiating messages for slot values, or explicitly document and test a
  one-slot-at-a-time UX.
- Treat correction replies during confirmation as replacement attempts, not
  decline/use-once.
- Add DB-level or transaction-level protection for one active workflow per
  user/session.
- Fix budget parsing for Vietnamese dot-thousands and `1tr5`; decide whether
  no-cap budget is valid.

## 54. Required Re-Review Cases

Claude should rerun or add tests for:

- Use-once hidden/rejected for every `PROFILE_FACT`.
- Unsafe target weight `30kg` at `180cm/80kg`.
- Correction `Không, 70kg` after `72kg` proposal.
- Initial multi-slot prompt with goal, age, height, current weight, target
  weight.
- Two concurrent workflow starts under DB-level stress.
- FIND_PT budgets: `1.500.000`, `1tr5`, `không giới hạn`, `1.5 triệu`.

## 55. What Can Be Carried Forward

The architecture direction is sound: deterministic slot collection, DB-backed
workflow state, explicit confirmation, stale-write guard, and reuse of existing
business-action confirmation paths.

## 56. Final Decision Rationale

Because two explicit return conditions were reproduced, the only honest
decision is **RETURN TO CLAUDE**.

This should be a focused patch, not a rewrite.

## 57. Final Sign-Off Line

**RETURN TO CLAUDE — fix PROFILE_FACT use-once semantics, contextual
target-weight safety, correction handling, active-workflow invariant, and
FIND_PT budget parsing before production sign-off.**
