# AI Coach Finalization Race Closure

Date: 2026-09-19. Closes the last Codex finding (`codex-ai-coach-core-final-signoff.md`,
MEDIUM 1): concurrent CONFIRM vs DISMISS on one `FitnessAgentAction` could both report
success (dismiss: "chưa lưu gì"; confirm: "đã lưu"). Only `FitnessAgentAction` lifecycle
changed; the workflow foundation, nutrition/workout logic and routing are untouched.

## Root cause
`execute()` read PENDING, passed its guard, called the business service, then wrote
COMPLETED. `dismissDraft()` read/wrote independently. Nothing claimed the action before the
external call, so both saw PENDING and both "won".

## Design
One database row is the arbiter; each side takes it with ONE conditional UPDATE:

- confirm: `UPDATE ... SET status='EXECUTING', result={executingSince} WHERE id AND userId AND status='PENDING'` — must affect 1 row **before** any business call.
- dismiss: `UPDATE ... SET status='CANCELLED' WHERE id AND userId AND status='PENDING'`.

Exactly one can match. The loser re-reads and answers from the state that actually won:
dismiss losing -> "đang được lưu nên không thể bỏ qua" (EXECUTING) or "đã được lưu trước đó"
(COMPLETED); confirm losing -> 409 "already being executed" (EXECUTING), stored result
(COMPLETED), or rejection (CANCELLED). No DB transaction is held across the HTTP call
(short claim -> external call -> short finalize). Works across processes/replicas because the
arbiter is the row, not memory. `status` is a free `String` column, so `EXECUTING` needs no
enum/migration (verified in `schema.prisma`; no migration added).

Lifecycle: before `PENDING -> COMPLETED | CANCELLED`; after
`PENDING -> EXECUTING -> COMPLETED`, `PENDING -> CANCELLED`, `EXECUTING -> PENDING` (failure).

## Failure and crash semantics
- Business call throws or the write reports failure (`retryable`): the claim is handed back
  to PENDING (`updateMany ... WHERE status='EXECUTING'`) and the failure block is returned —
  no fake COMPLETED; the draft can be retried or dismissed. (Previously a failed workout/
  nutrition save was recorded COMPLETED.)
- Pre-write rejections after the claim (e.g. nutrition target changed -> 409) also release it.
- Crash after claim: an EXECUTING claim older than 2 min (`EXECUTION_STALE_MS`) may be
  reclaimed; reclaim is a conditional update on the exact stale marker, so two reclaimers
  cannot both win, and the retry is safe through the downstream idempotency
  (`importAiPlanToSchedule` `(userId, sourcePlanId)`; nutrition `sourcePlanId`). A fresh
  EXECUTING claim is never reclaimable and never dismissible.

## Preserved
COMPLETED replay returns the stored result (no second call); CANCELLED and expired stay
non-executable; ownership (`userId` in every `where`, plus `ownSession`) unchanged;
`routePendingDraftTurn` and the revise handlers select only `status='PENDING'`, so an
execution-owned action receives no revision turns. `execute()`'s per-kind branches moved
unchanged into `runActionBranch` (runs only after the claim) — common helper, no per-kind
race code.

## Evidence
`agent-workflow-finalization-race.test.ts` 15/15 — for BOTH workout and nutrition:
confirm-wins (barrier pauses the business call; dismiss must not say "chưa lưu gì" and must
not change state; one write; COMPLETED), dismiss-wins (confirm rejected, 0 writes,
CANCELLED), 25 truly concurrent confirm||dismiss rounds (exactly one winner and both
responses agree with it), double confirm (second honestly rejected while executing, replay
idempotent), concurrent double dismiss, failure after claim -> PENDING -> retry succeeds;
plus stale-claim reclaim vs fresh claim, EXECUTING not routed, cross-user 404.
All agent-workflow + exclusion + parser suites 118/118; unchanged Codex v2 foundation
evaluator 30/30; fitness-service target/bootstrap 20/20; PT/Program v2/memory/claims 175/175;
ai-service and fitness-service `tsc` clean; frontend build clean.

Limits: the in-process concurrency tests exercise the DB arbiter but not multiple Node
processes; a client-side (frontend) busy state is not relied on. Live BullMQ/Ollama and
browser journeys remain out of scope/ENVIRONMENT.
