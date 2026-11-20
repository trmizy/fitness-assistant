# V-T012 Release Blocker Correction Report (R222-01 … R222-06)

Date 2026-10-19 · Claude Code · answers `V-T012_2_2_INDEPENDENT_REREVIEW.md`.
No deployment, no migration applied, no AWS, no paid model, no commit, no heldout access.
**PostgreSQL/Redis: ENVIRONMENT_BLOCKED** (`docker ps` fails, no isolated database; none substituted). All durability statements are fixture-level. **No schema change in this task.**

## 1. Baseline
START_HEAD = END_HEAD `003545c6…`, branch `aws-deploy`, in place (the earlier V-T001.x/V-T012.x work is uncommitted). `frontend/web/src/app/pages/client/AIPlansPage.tsx` is modified by **another agent** and was not touched. Preserved: V-T001.1, Bedrock files, `execute()`/confirm lifecycle, provider wiring.

## 2. Files changed
Backend: `services/generation-operations.ts`, `services/fitness-agent.service.ts` (replay guard only), `controllers/plan.controller.ts` (status), `__tests__/generation-operations.test.ts`, `__tests__/generation-admission.test.ts`, `__tests__/helpers/memory-operation-store.ts`. Frontend: `stores/chat-request-identity.ts` (new, pure), `stores/pendingAiTasks.ts`, `pages/client/AICoachPage.tsx`, `stores/__tests__/chat-request-identity.test.ts` (new).

## 3. Findings
| ID | Root cause | Correction | Status |
|---|---|---|---|
| R222-01 | the conflict check was skipped while FAILED, and reopen rewrote the fingerprint | binding (actor via lookup, kind, subject, fingerprint) is checked in **every** state before any reopen; reopen no longer changes it. Same-payload FAILED retry = documented paid re-execution (new epoch, new target, charged; **not** exactly-once billing) | corrected locally |
| R222-02 | revision recomputed `mealsPerDay` from already-revised state, then fingerprinted | replay guard at the top of `tryPollOrReviseNutritionPlanDraft`: the applied revision's `clientRequestId` + instruction fingerprint are stored in the draft payload; a replay of that id returns the stored result and applies nothing (no delta, no charge, no job, no action mutation); same id with another instruction is refused; a new instruction has a new id. General (every revision this function handles), not tied to "nhieu bua hon". Legacy (no id) unchanged | corrected locally |
| R222-03 | UI generated no durable id and had no retry | see §6 | corrected locally (browser NOT_VERIFIED) |
| R222-04 | cross-service autosave unfenced | design assessment, §8 | **BLOCKED: approval required** |
| R222-05 | ADMITTED attempts bypassed the budget | one atomic budget for every state, §5 | corrected locally |
| R222-06 | generic status was workout-only and not epoch-aware | canonical operation status, §7 | corrected locally |

## 4. Actor/subject/idempotency rules
Operation uniqueness is `(verifiedActor, key)`; an id never authorizes. Conflict = different fingerprint (which covers kind, subject, plan args and job args) or different kind/subject, → 409 in all states. A PT acting for a client keeps actor ≠ subject in the binding; changing the subject under the same key is refused. Chat: `chat:req:<clientRequestId>`; revision replay recorded in the draft payload.

## 5. Publication state machine (R222-05)
`claimPublish(id, epoch, expectedCount, max, now)` is the single durable budget: a compare-and-set on the observed `publish_count` (< max), valid for ADMITTED, PUBLISHED and RUNNING, executed **before** every external publish (initial, ADMITTED retry, PUBLISHED/RUNNING recovery). `recordPublish` no longer counts. Never refunded (ambiguous outcomes count). Exponential backoff (5 s, doubling, capped 5 min) is enforced before claiming; at budget exhaustion the execution is settled FAILED with its plan atomically (`settleStranded`), and the same request afterwards is the documented new charged epoch. Concurrent runners/claims: exactly one winner per increment; a stale epoch cannot spend the budget. Production code calls the same store method the tests exercise.

## 6. Frontend retry contract (R222-03)
`chat-request-identity.ts` (pure): one record per deliberate send, id generated once (= task id) and **persisted with the question and thread before the request is sent**; explicit retry (`retryQuestion`, new “Thử lại” button when the thread is failed and retryable) re-sends the **stored** question under the **original** id (payload cannot drift); a deliberate new send, even with identical text, gets a new id; same id is passed to `coachService.chat` and `chatStream` and is reused by the automatic 401 resend; after a reload an interrupted send is recovered as FAILED + **uncertain** (never auto-replayed) and offered for retry with the same id; records are read per `userId`, so another account cannot see or reuse them. Failures after the request left are shown as “chưa rõ yêu cầu đã được xử lý hay chưa … không tạo trùng”. Malformed or missing ids from a new client cannot occur (generated locally); the server's policy for a missing/malformed id remains the documented legacy path, not a silent upgrade. Verification: 12 node:test pass (pure rules + CODE AUDIT of the wiring), `vite build` succeeds, type check of the touched files clean (two unrelated older errors in `api.ts`). **REAL_BROWSER_NOT_VERIFIED** (no isolated browser/backend run).

## 7. Canonical job status (R222-06)
`describeOperationJob(userId, jobId)` treats the public `jobId` as the **operation id** (what every command returns and stores in `Plan.jobId`): ownership = the operation's verified actor (403 otherwise, as before); target = the operation's own `(targetType, targetId)` for its **current epoch** (never guessed from plan timestamps; the “newest plan” ordering from the previous round remains only for the legacy path); workout and nutrition; operation FAILED beats a plan row still reading active (truthful); missing plan row is reported, not hidden; BullMQ enrichment looks up `transportJobId(operationId, epoch)` only outside SQS mode. Non-operation ids fall through to the unchanged legacy `Plan.jobId`/BullMQ path (documented: workout plans only). PT access keeps the pre-existing owner-only rule. Old-epoch plans are never exposed by the reference.

## 8. R222-04 — cross-service autosave: design decision (not implemented)
Facts (source): `autoSaveCompletedNutritionPlan` POSTs `/nutrition/from-ai-plan` with `sourcePlanId = this execution's plan id`; fitness-service does `findFirst({userId, sourcePlanId})` then `create` inside a default-isolation `$transaction`, with no unique constraint visible on `(userId, sourcePlanId)`.
- Safety: `sourcePlanId` is already per-execution, so an old epoch targets its own (FAILED) plan; the plan content a worker can autosave is the content its own fenced completion committed. Stale *content* is therefore not the main risk.
- Real gaps: (1) **lost autosave**: a worker that loses its lease between plan completion and the probe never saves, and the new claimant short-circuits on a COMPLETED plan; (2) **duplicate programs** under concurrent autosaves (check-then-create without a unique constraint); (3) no durable record of “save pending”.
- Option A (downstream rejects stale attempts): fitness-service does not own `AiGenerationOperation`, so it needs a new internal validation API or a replicated epoch: structural. Option B (durable save intent): record the intent atomically with plan completion, replay idempotently from the existing recovery runner until acknowledged. B needs (a) a unique constraint `(user_id, source_plan_id)` in fitness-service (**migration in another service**) with P2002 handled as alreadyExists, and (b) a nullable intent/ack marker in ai-service (column or payload field).
- Decision: **STOP**. Both options require a fitness-service migration and a new durable state; per the task's gate this is an approval item, not a hidden redesign. No header-only “fix” and no removal of autosave. Release impact: autosave remains best-effort and can be lost or duplicated under concurrency; Nutrition remains usable without it (deterministic NutritionGoal already authoritative).

## 9. Schema / migration
None added. The two earlier ai-service migrations remain unapplied. R222-04 would add one fitness-service migration (unique index) and one ai-service marker, **awaiting approval**.

## 10. Tests
| Run | Result | Evidence |
|---|---|---|
| `generation-operations.test.ts` | 77 pass (R222-01 ×5, R222-05 ×11, R222-06 ×6 incl. workout/nutrition, plus earlier) | TEST FIXTURE + installed BullMQ validator |
| `generation-admission.test.ts` | 34 pass (R222-02 ×5 incl. Codex's 3→4→5 meals reproduction) | TEST FIXTURE, real chat flow |
| with `ai-endpoint-policy`, `rate-limit`, `auth-middleware-token-rejection` | **161 pass / 0 fail**, identical in 3 runs | mixed |
| `tsc --noEmit` ai-service | clean | build |
| frontend `chat-request-identity.test.ts` | 12 pass / 0 fail | TEST FIXTURE + CODE AUDIT |
| frontend `vite build` | success | build |
| real PostgreSQL / Redis / multi-process / real queues | ENVIRONMENT_BLOCKED | not run |
| real browser | REAL_BROWSER_NOT_VERIFIED | not run |
Each regression is written to fail against the previous behaviour (documented counterexamples; negative controls retained for FAILED-rewrite, unbounded ADMITTED publication, previous-turn keys, unfenced writes).

## 11. Architecture preservation
`callerKind` service-only, shared `ai-expensive`/`ai-ask`, durable operation + epoch, conditional reservation, atomic worker fencing, atomic terminal settle, reconciliation, BullMQ-safe transport id, SQS binding, deterministic confirmation and Bedrock wiring are unchanged and covered by the 161-test run. `execute()` and the confirm lifecycle were not touched; no new framework, queue or provider.

## 12. Remaining release blockers
(1) R222-04 approval and implementation; (2) real PostgreSQL run (migration pair, unique races, `FOR UPDATE`/rollback, raw SQL `settleStranded`/`listInconsistentTerminal`); (3) real browser verification of retry/refresh/stream; (4) recovery schedule and deployment configuration (lease, SQS visibility/DLQ, DynamoDB quota); (5) legacy clients keep the weaker chat idempotency; (6) another agent's uncommitted frontend edits must be reconciled before any commit.

## 13. Codex re-review readiness
Ready for independent re-review of the five corrected items; not release-ready.

## 14. Verdict
`V-T012_CODE_BLOCKERS_PARTIALLY_CORRECTED`
