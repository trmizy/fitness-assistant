# Conversational Intelligence — X4 Post-Confirmation Truthfulness Follow-up Fix

Date: 2026-09-27. Owner: Claude Code (implementation). Input: `docs/codex-conversational-intelligence-final-closure-signoff.md` (Codex's
independent, self-declared **INCOMPLETE** verification of `docs/conversational-intelligence-final-defect-closure.md`).
Scope: fix ONLY the one new gap Codex reported — a completed `UPDATE_GOAL` profile-workflow confirmation was invisible to
`tryConfirmationBoundary`'s authoritative status resolution, which derived state exclusively from `FitnessAgentAction` rows and never looked at
`AgentWorkflowSession`. No redesign of Conversational Intelligence, no change to the signed-off multi-agent workflow architecture, no new
dependency, no model-provider change, no CI-V2 flag default change. Not self-signed-off — handed back to Codex to independently repeat the golden
sequence and finish its own previously-pending sign-off executions (Full sets B/C, X4 matrix re-inspection, Golden/global-golden reruns were left
PENDING by Codex itself, per its own report).

## Status: **COMPLETE** for the one reported gap.

Evidence labels: `REAL HTTP/API` (through the Docker gateway, real registration/login, isolated test DBs), `BACKEND INTEGRATION` (`node:test`
inside the `gymcoach-ai-dev` container, real Postgres test DB, stubbed business services), `CODE AUDIT`.

---

## Exact reproduction (before the fix)

Independent script (`test/conversational-intelligence/x4-followup-repro.mjs`, Claude-authored — does not touch or overwrite Codex's own
`codex-final-confirmation-followup.mjs` / `results/codex-final-closure/profile-confirmation-followup.json`):

1. `"với tình trạng hiện tại tôi nên cut hay bulk?"` → recommendation.
2. `"ok đổi theo đề xuất đó"` → DB: `UPDATE_GOAL|AWAITING_SLOT_CONFIRMATION`, goal still `MUSCLE_GAIN`.
3. `"Xác nhận cập nhật."` → `200 "Đã cập nhật hồ sơ của bạn. Mục tiêu: giảm mỡ."` DB: goal now `WEIGHT_LOSS`, workflow now
   `UPDATE_GOAL|COMPLETED`, **`fitness_agent_actions` rows for this user: 0**.
4. `"Đã lưu thành công chưa?"` → **before the fix**: `"Chưa có thay đổi nào được lưu trong cuộc trò chuyện này — hiện không có thao tác nào
   đang chờ xác nhận."` — a false denial of a real, already-committed write.

```
confirmedWrite(goal really changed)= true  workflowCompleted= true  statusAnswerTruthful= false
```
(REAL HTTP/API + DB, before-fix run saved at `.tmp-stack/x4-followup-repro-before.out`.)

## Root cause

`tryConfirmationBoundary` (`services/fitness-agent.service.ts`) checks `workflowStateRepository.findActive(userId, sessionId)` up front and
defers (returns `null`, letting the real workflow machinery answer) **only while a workflow is currently active** (non-terminal). Once that
workflow completes, it becomes a `AgentWorkflowSession` row with a **terminal** status (`COMPLETED`/`CANCELLED`/`EXPIRED`) — a real, separate,
independently-timestamped table from `FitnessAgentAction`. The boundary's own history lookup queried `FitnessAgentAction` only
(`deriveConfirmationState(actions)`); a completed `UPDATE_GOAL` confirmation never creates a `FitnessAgentAction` row (it writes straight to
`UserProfile` via `updateProfileFields`), so it was structurally invisible to that lookup — `deriveConfirmationState([])` correctly returns
`NONE`, and `confirmationBoundaryAnswer(STATUS, NONE)` correctly-for-NONE (but wrongly for this case) says nothing was ever pending or saved.

This is a **read/derivation gap**, not a business-logic defect: the real write, and the real workflow completion, were always correct. Fixing it
requires making the boundary's status resolution look at BOTH independent state sources and reconcile them — never inventing a `FitnessAgentAction`
row as a workaround, and never inferring anything from the assistant's own prior text.

## Fix — authoritative status resolution across two independent state sources

- **`agent-workflow/workflow-state.repository.ts`** — new `findLatestProfileConfirmation(userId, sessionId)`: the most recent **terminal**
  `AgentWorkflowSession` row for this (userId, sessionId) that ever reached `AWAITING_SLOT_CONFIRMATION` (i.e. `pendingProfileUpdate` was
  genuinely set at some point — it proposed a real profile-fact change, not just slot-collection abandoned before anything was ever proposed).
  Only ever meaningful to call after `findActive()` has already returned `null`, so every row it can return is guaranteed terminal; the status
  filter (`status IN (COMPLETED, CANCELLED, EXPIRED)`) is kept explicit anyway. The `pendingProfileUpdate != null` filter is applied in JS (not a
  Prisma `where`) to sidestep the DbNull/JsonNull distinction for a nullable `Json` column entirely — the query fetches the 5 most recent
  terminal rows and picks the first with a non-null `pendingProfileUpdate`.
- **`services/confirmation-boundary.ts`** — new pure function `mergeConfirmationState(actionState, actionAt, profileWorkflow)`:
  - An **open/in-flight action** (`PENDING` with a live TTL, or `EXECUTING`) always wins outright — a real confirmation card in front of the
    user, or a write actually in progress, is never shadowed by an older completed profile confirmation. (A genuinely *pending* profile
    workflow is caught earlier and unaffected — `tryConfirmationBoundary` defers immediately whenever `findActive()` finds one, so this
    function only ever receives **terminal** profile-workflow rows.)
  - Otherwise, whichever of the two independent events happened **more recently** (`AgentWorkflowSession.updatedAt` vs.
    `FitnessAgentAction.createdAt`) is authoritative — this is the required precedence rule: a newer cancelled/expired action correctly shadows
    an older completed profile confirmation, and symmetrically a newer completed profile confirmation correctly shadows an older
    cancelled/completed action. Never guessed — always read from real timestamps.
- **`services/fitness-agent.service.ts`** — `tryConfirmationBoundary` now also calls `findLatestProfileConfirmation` and merges its result with
  the existing `FitnessAgentAction`-derived state via `mergeConfirmationState` before answering. The call-site placement (right after
  `ownSession(...)`, before intent dispatch) is unchanged; the pending-confirmation path (`findActive` early-return) is unchanged and untouched.

No new `FitnessAgentAction` row is ever created by this fix. No inference is made from the assistant's own prior text — every answer is derived
solely from the two authoritative tables' current rows.

### Ownership / precedence / correctness, addressed explicitly

- **Session/user isolation**: `findLatestProfileConfirmation` is scoped by `userId AND sessionId`, identically to the existing
  `FitnessAgentAction` query — the same scoping `ownSession(...)` already enforces at the entry point. A dedicated regression (X4-9, below)
  proves a second user's own empty session never sees the first user's completed profile workflow.
- **Precedence**: recency across the two independent sources decides which is authoritative (X4-7a/7b, below) — a historical completed action
  never incorrectly confirms a newer, unrelated pending/cancelled/expired event, in either direction.
- **No invented rows**: the fix is additive-read-only; `mergeConfirmationState` and `findLatestProfileConfirmation` perform no writes.
- **Existing pending-confirmation path preserved**: `findActive()`'s own early-return is untouched; a message during a genuinely active workflow
  still defers to the real workflow machinery exactly as before (verified by the unmodified S1 matrix rows, below).
- **Ambiguity**: none of the reported/tested scenarios produces a genuine tie between two comparably-recent, differently-owned events (the
  architecture's own "one active workflow + limited pending-action" invariants make this rare in practice); the merge rule's tie-break
  (recency, `>=` favoring the profile workflow) is deterministic and still grounded in real timestamps, never fabricated. This is documented
  here rather than built into a speculative disambiguation UI for a case none of the required scenarios exercises.

## Golden sequence verification (after the fix)

Same independent script, rerun after the fix, REAL HTTP/API + DB:

```
3) confirm: 200 Đã cập nhật hồ sơ của bạn. Mục tiêu: giảm mỡ.
   goal after confirm (DB): WEIGHT_LOSS
   workflow after confirm (DB): UPDATE_GOAL|COMPLETED
   fitness_agent_actions rows for this user: 0
4) status question: 200 -> Rồi — thao tác gần nhất trong cuộc trò chuyện này đã được xác nhận và lưu. Hiện không còn gì đang chờ xác nhận.

confirmedWrite(goal really changed)= true  workflowCompleted= true  statusAnswerTruthful= true
EXIT=0
```

The same golden sequence is additionally proven at `node:test` BACKEND INTEGRATION level (real test DB, real `fitnessAgent.tryTurn`, stubbed
business services) in the strengthened `conversational-intelligence-remediation.test.ts` "X4: a REAL pending confirmation still works" test: after
the confirmed write, (a) a repeated `"Xác nhận cập nhật."` truthfully says it was already saved (no second write — `writes.length` stays `1`),
and (b) `"Đã lưu thành công chưa?"` gets the truthful `/^Rồi/` positive answer, itself writes nothing (`writes.length` still `1`), and a
follow-up profile read (`profile.goal`) still shows the correct new goal `WEIGHT_LOSS`.

## Negative-test scenarios (11/11)

New permanent regression file: `backend/services/ai-service/src/__tests__/x4-confirmation-followup.test.ts` — BACKEND INTEGRATION, real test DB,
real `fitnessAgent.tryConfirmationBoundary`, plus 3 pure-function unit tests of `mergeConfirmationState`. This is a separate, independently
authored regression; it does not modify or replace Codex's own evidence file.

| # | Scenario | Test | Result |
|---|---|---|---|
| 1 | No history | X4-1 | honest `NONE`/"Chưa có thay đổi nào được lưu" |
| 2 | Pending unconfirmed | X4-2 | unaffected — defers to the real card |
| 3 | Completed `FitnessAgentAction` | X4-3 | truthful positive, as before |
| 4 | Completed `UPDATE_GOAL` workflow | X4-4 | **the reported defect** — now truthful positive |
| 5 | Cancelled action | X4-5 | honest CANCELLED |
| 6 | Expired action | X4-6 | honest EXPIRED |
| 7 | Completed-then-newer-cancelled precedence (both directions) | X4-7a, X4-7b | newer event governs in both directions |
| 8 | Pending draft, no saved program | X4-8 | honest PENDING; a bare abandoned slot-collection workflow carries no signal |
| 9 | Cross-user access | X4-9 | user B never sees user A's completed profile workflow |
| 10 | Repeated confirmation after completion | X4-10 | truthful "already saved", zero additional writes |
| 11 | Knowledge question about the confirmation mechanism | X4-11 | never intercepted, unaffected by any profile-workflow history |

**Result: 15/15** (11 named scenarios, 2 precedence sub-cases, 3 pure-function unit tests), `pass=15 fail=0`, all three flag configurations.

## X4 confirmation matrix — strengthened

Per Codex's own "Matrix Audit" critique (no per-cell truthful-answer assertion, no nonzero exit on failure, S1/U1-U5 legitimate writes
undocumented, the new defect absent from the matrix), `test/conversational-intelligence/x4-confirmation-matrix.mjs` was extended, not rewritten:

- Every cell now carries an explicit **expectation** (`expectationFor(state, utterance)`): whether a write is authorized for that exact
  state/utterance pair, and a `mustMatch`/`mustNotMatch` regex for the answer. S1/U1-U5 are now explicitly asserted as **authorized, expected**
  writes (`Đã cập nhật hồ sơ`) rather than silently counted only by the old `claimWithoutWrite` heuristic.
- New **S7 profile workflow COMPLETED (no `FitnessAgentAction` rows)** state — built via the real recommendation → accept → confirm HTTP
  sequence (not a fixture row) — reproduces the exact reported defect at matrix scale and asserts the truthful positive answer for `U6`
  (`/^Rồi/`, must NOT match `/Chưa có thay đổi nào được lưu/i`) and the "already saved" answer for `U1`-`U5` with **no additional write**.
  This is the exact Codex reproduction pattern, added as a **permanent, separate** matrix state — Codex's own evidence files are untouched.
- The runner now exits **non-zero** on any failed expectation, `claimWithoutWrite`, error, or setup failure — not just on the old heuristic.

Run after the fix (`node test/conversational-intelligence/x4-confirmation-matrix.mjs after-followup 1`), REAL HTTP/API + DB:

```
S7 U6 | http=200 | Rồi — thao tác gần nhất trong cuộc trò chuyện này đã được xác nhận và lưu. Hiện không còn gì đang chờ xác nhận... (truthful)
S7 U1-U5 | http=200 wrote=false | Thao tác gần nhất ... đã được xác nhận và lưu rồi ... (already-saved, no re-write)
S1 U1-U5 | wrote=true | Đã cập nhật hồ sơ của bạn ... (authorized real write, unaffected by this fix)
S6 cross-user | http=404 | A draft pending=true

cells=45 claimWithoutWrite=0 expectationChecked=43 expectationFailed=0 errors=0 setupFailed=0
EXIT=0
```
(full per-cell output recorded in `results/final-closure/x4-matrix-after-followup.json`; the original
`x4-matrix-before.json`/`x4-matrix-after.json` from the prior closure task are unmodified.)

## Regression — REAL HTTP/API, BACKEND INTEGRATION

| suite | flags | evidence | result |
|---|---|---|---|
| `tsc --noEmit` | — | CODE AUDIT | no new errors (1 pre-existing, unrelated error in Codex's own `codex-final-closure-independent.test.ts`, not touched) |
| conversational-intelligence + agent-workflow + fitness-agent + codex-remediation-boundary + x4-confirmation-followup (full set) | **OFF** | BACKEND INTEGRATION | **227/227** |
| same, **ON / LLM off** | BACKEND INTEGRATION | **227/227** |
| same, **ON / LLM on** (verification config) | BACKEND INTEGRATION | **227/227** |
| CI-V2 golden conversation | REAL HTTP/API | **13/13** |
| Global golden cases (draft correction ✓, profile confirmation ✓, PT confirmation ✓, cross-user isolation ✓) | REAL HTTP/API | **23/23** |
| X4 confirmation matrix (strengthened, incl. new S7) | REAL HTTP/API + DB | **45/45 cells, 43 expectations checked, 0 expectationFailed, 0 claimWithoutWrite, 0 errors, 0 setupFailed** |
| Codex security/IDOR HTTP probe (`codex-security-http.mjs`, unmodified) | REAL HTTP/API + DB | **15/16** (I03 = X5, pre-existing, unrelated to this fix — unchanged from the prior closure) |
| X1/X2/X3 regression probes (`codex-remediation-boundary.test.ts`) | OFF & ON | BACKEND INTEGRATION | included in the 227/227 above, unmodified |

227 = the prior closure's 212 + 15 new (`x4-confirmation-followup.test.ts`). No existing test's *expectation* was weakened to force a pass; the
one existing assertion that changed (`conversational-intelligence-remediation.test.ts`'s repeated-confirmation check) was corrected **because it
had encoded the reported bug's own wording as if it were correct** ("chưa có bản nháp hay thao tác nào đang chờ xác nhận" for a message
immediately after a real, completed profile write) — it now asserts the truthful "already saved" wording instead, with an explicit comment
recording why.

## Production files changed

| file | change |
|---|---|
| `agent-workflow/workflow-state.repository.ts` | new `findLatestProfileConfirmation(userId, sessionId)` |
| `services/confirmation-boundary.ts` | new `mergeConfirmationState(actionState, actionAt, profileWorkflow)` + `ProfileWorkflowConfirmation` type |
| `services/fitness-agent.service.ts` | `tryConfirmationBoundary` now also queries and merges the latest terminal profile-workflow confirmation |

Test/verification files: `__tests__/x4-confirmation-followup.test.ts` (new, permanent), `__tests__/conversational-intelligence-remediation.test.ts`
(one corrected assertion + one added truthful-status assertion in the existing golden-sequence test), `test/conversational-intelligence/
x4-confirmation-matrix.mjs` (extended: per-cell expectations, new S7 state, non-zero exit), `test/conversational-intelligence/
x4-followup-repro.mjs` (new, independent before/after reproduction — separate from Codex's own `codex-final-confirmation-followup.mjs` and
`results/codex-final-closure/profile-confirmation-followup.json`, neither of which was modified).

## Remaining limitations

- The genuinely-ambiguous "multiple comparably-recent, differently-owned artifacts" case is not built as a separate clarify-instead-of-guess
  path — none of the 11 required scenarios exercises it, and the architecture's own "one active workflow + limited pending-action" invariants
  make an exact, meaningful tie rare in practice. If real evidence of this occurring surfaces, it is a scoped follow-up, not a silent gap.
- All limitations already on record in `docs/conversational-intelligence-final-defect-closure.md` (X5, X6, 401/403→500 mapping, Config B/C
  accuracy) are unchanged by this narrow follow-up and not re-verified here — out of this task's scope.
- Real-browser (Playwright) reruns were not repeated for this narrow, backend-only fix; the change touches no client-facing route, template, or
  browser-observable timing behavior beyond the text of one deterministic answer already covered above by REAL HTTP/API evidence.

## Status: COMPLETE (for the one reported gap) — not self-signed-off

Handed back to Codex to independently repeat the new golden sequence and finish its own previously-pending sign-off executions (Full sets B/C,
the pre-existing X4 matrix's own re-inspection at the level Codex intended, and Golden/global-golden reruns under Codex's own evidence
collection), per Codex's own report.

## Reproduce

```
MSYS_NO_PATHCONV=1 docker exec -e CONVERSATIONAL_INTELLIGENCE_V2=<off|on> -e CONVERSATIONAL_INTELLIGENCE_V2_LLM=<off|on> gymcoach-ai-dev \
  sh -c "cd /app/backend/services/ai-service && npx tsx --test src/__tests__/conversational-intelligence-*.test.ts \
  src/__tests__/codex-remediation-boundary.test.ts src/__tests__/agent-workflow-*.test.ts src/__tests__/fitness-agent-*.test.ts \
  src/__tests__/x4-confirmation-followup.test.ts"
node test/conversational-intelligence/x4-followup-repro.mjs
node test/conversational-intelligence/x4-confirmation-matrix.mjs <label> 1
node test/conversational-intelligence/live-golden.mjs
node test/conversational-intelligence/live-global.mjs
node test/conversational-intelligence/codex-security-http.mjs
```
Result files kept: `test/conversational-intelligence/results/final-closure/x4-matrix-after-followup.json` (new), the prior task's
`x4-matrix-{before,after}.json` (unmodified), Codex's own `results/codex-final-closure/profile-confirmation-followup.json` (unmodified).
