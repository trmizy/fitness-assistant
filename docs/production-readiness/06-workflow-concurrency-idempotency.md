# 06 — Workflow Concurrency and Idempotency

## Lifecycle under audit

Request → context → recommendation → draft → validation → revision → confirmation → persistence → retrieval/update.

Two workflow families exist and are audited separately:
- **AI action workflow** (`FitnessAgentAction`: PENDING → EXECUTING → COMPLETED or CANCELLED, with TTL `expiresAt`).
- **Conversational slot workflow** (`AgentWorkflowSession`: COLLECTING_SLOTS, AWAITING_SLOT_CONFIRMATION, WRITING, terminal COMPLETED, CANCELLED, EXPIRED).

## Confirmation claim (AI action)

`fitness-agent.service.ts` (~lines 777–826):
1. Reads the action scoped by `id` and `userId`.
2. Accepts only `PENDING` or `EXECUTING` (409 otherwise).
3. Claims with `updateMany({ where: { id, userId, status: "PENDING" }, data: { status: "EXECUTING", … } })`. The conditional update is atomic at
   row level. A second concurrent confirm loses the claim.
4. A stale `EXECUTING` claim (older than the threshold, around line 430) can be reclaimed with a compare-and-set on `result`.
5. The business write runs; on failure, `release()` returns the action to PENDING (retryable, never stuck).
6. On success, `updateMany` sets `COMPLETED` with the outcome.

Assessment: **VERIFIED_OK by code inspection**. Runtime behaviour under concurrent requests is NOT VERIFIED (P4-T03). Two points need runtime evidence:
- Is the business write idempotent if the process crashes between step 5 and step 6? The durable write plus a missing `COMPLETED` leaves the action
  `EXECUTING`; reclaim then re-runs the business write. Plan import is idempotent on `sourcePlanId`, which protects that path; other write types
  need the same check.
- Are there write paths that are not idempotent under retry (for example, creating a nutrition log without a unique key)?

## Duplicate-action control

- Only one `EXECUTING` claim wins; the loser receives 409 "already being executed". A PENDING draft can exist alongside another PENDING draft in
  the same session (G-26). The confirmation boundary picks the latest by `updatedAt`, which is a product risk.
- `agent_workflow_sessions` has a partial unique index for one active workflow per (user, session); the action table has no equivalent.

## Persistence idempotency

| Business write | Idempotency key | Enforced by |
|---|---|---|
| AI plan import to schedule | `sourcePlanId` per user | `@@unique([userId, sourcePlanId])` on `WorkoutProgram` |
| Program ↔ action link | `agentActionId` | `@unique` on `WorkoutProgram` |
| Nutrition goal (single active) | user + status | partial unique (migration `20260818020000`) |
| Nutrition program per source plan | user + sourcePlanId | unique index (catch-up migration) |
| Meal completion | user + meal + log date | unique index (catch-up migration) |
| InBody entry per day | user + date_only | unique index (with DELETE migration, G-04) |
| Training cycle one active | user | partial unique |

## Concurrent bootstrap (nutrition)

Nutrition goal bootstrap goes through `nutrition-onboarding-bootstrap.service.ts` and engines. The upsert path is used
(`nutritionService.upsertGoal`). Because a partial unique index guards single active goals, two concurrent bootstraps cannot create two active
goals; the loser sees a constraint error. Whether the service maps `P2002` to a clean retry or a 500 was NOT verified (P4-T03).

## Conversational slot workflow

- `AgentWorkflowSession.slotsJson` holds candidates only and is documented as never authoritative (schema comment).
- Transition to WRITING and the final write pass through the same business service as the confirmation path (code path sampled).
- A stale confirmation of a superseded proposal: returns a conflict in the confirmation boundary (`confirmationBoundaryAnswer`); runtime verification
  in the X4 matrix covers the "confirmed, then status asked" sequence for one user (TEST_FIXTURE).

## Double-submit from the client

- Clients may retry a POST after a network timeout. The confirm endpoint is idempotent by state (second call sees COMPLETED → 409 with the
  existing result message). The message reads "Action is COMPLETED and can no longer be confirmed" (409). Clients must treat 409 on confirm as
  "already done" and fetch state, not as failure. Mobile and web handling NOT VERIFIED.

## Server restart during a workflow

- An action stuck in `EXECUTING` after a crash is reclaimed after the stale threshold. The threshold value and the behaviour during the window
  are NOT VERIFIED at runtime.
- `AgentWorkflowSession` has `expiresAt`; expired sessions are terminal EXPIRED. Cleanup job presence: NOT VERIFIED.

## Gaps and required tests

| Gap | Test | Gate |
|---|---|---|
| G-26 multiple live drafts | concurrent draft creation; stale confirm → 409 | P2-T04 |
| Crash between business write and COMPLETED | fault injection: kill process after write; reclaim; expect one business row | P4-T03 |
| Non-idempotent write types | list every write type behind confirm; add unique keys or idempotency tokens | P4-T03 |
| Double confirm under load | 20 parallel confirms; exactly one business write | P4-T03 |
| Concurrent nutrition bootstrap | 10 parallel bootstraps; one goal; no 500 | P4-T03 |

## Verdict

Confirmation and persistence idempotency are **well designed in code** (atomic claim, unique keys, reclaim). They are **not yet proven under
concurrency or crash**. Workflow safety is CONDITIONAL until P4-T03 runs.
