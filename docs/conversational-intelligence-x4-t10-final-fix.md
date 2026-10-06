# Conversational Intelligence — X4-T10 Confirmation-Window Fix

Date: 2026-10-03. Owner: Claude Code (implementation). Input: `docs/codex-conversational-intelligence-final-signoff.md`
(Codex's independent final sign-off, "New Blocking Finding: X4-T10"), `docs/conversational-intelligence-final-x4-
runtime-closure.md` (the prior, narrower X4 ordering fix this builds on).
Scope: fix ONLY the demonstrated X4-T10 defect — a live `PENDING` `FitnessAgentAction` hidden by the confirmation
boundary's `take: 10` window when 10+ newer terminal rows exist in the same session. No architecture change, no
model-provider/prompt/routing-strategy change, no CI-V2 flag default change, no reopening of X1–X3, no X5/X6 work.

## Status: **COMPLETE** for X4-T10. Not self-signed-off.

Evidence labels: `REAL HTTP/API` (Docker gateway, real registration/login, isolated test DB), `BACKEND INTEGRATION`
(`node:test` inside `gymcoach-ai-dev`, real Postgres test DB), `CODE AUDIT`.

---

## 1. Codex's X4-T10 reproduction (before this fix)

`docs/codex-conversational-intelligence-final-signoff.md` — one user/session with:

- one live `PENDING` action (created/updated `2026-10-02T16:48:18.233Z`, expires `17:03:18.233Z`),
- ten newer `COMPLETED` actions, `updatedAt` from `16:52:18` through `17:01:18`.

11 total rows; the live pending row is **11th** by `updatedAt desc`. `tryConfirmationBoundary()` fetched only
`take: 10`, so the pending row was never in the fetched set at all. "Đã lưu thành công chưa?" answered as if the
latest (10th) `COMPLETED` row were the whole truth — a false positive while a real confirmation was still open.

**Independently reproduced as a new, permanent regression** (not a one-off script — Codex's own probe was ad hoc),
in `backend/services/ai-service/src/__tests__/x4-event-ordering.test.ts`, run against the **unmodified** production
code first, per the task's own requirement:

```
not ok — X4-T10 — Codex final sign-off: a live PENDING action ranked 11th by updatedAt must still be detected
  actual: 'Rồi — thao tác gần nhất trong cuộc trò chuyện này đã được xác nhận và lưu. Hiện không còn gì đang chờ xác nhận.'
not ok — X4-T10 — beyond ten: ... behind 25 newer terminal rows
not ok — X4-T10 — EXECUTING precedence: an older in-flight EXECUTING action ...
```

3 of 19 tests in the file failed before any production change — exactly the class of bug Codex reported (visibility,
not precedence: the live-PENDING/EXECUTING scan itself was always correct, it just never saw the row).

## 2. Root-cause analysis

`deriveConfirmationState`'s "any live PENDING/EXECUTING wins" check (`confirmation-boundary.ts`) scans **every row
in the array it is given** — that logic was never wrong. The bug was entirely in what `tryConfirmationBoundary`
fed it: a single `prisma.fitnessAgentAction.findMany({ orderBy: { updatedAt: "desc" }, take: 10 })`. Any `take: N`
window on an **unfiltered** query is unsafe by construction — a session that has accumulated more than `N` terminal
rows since the live one was created can always push it out of the fetched set, regardless of how large `N` is.

The confirmation boundary does not actually need "the 10 most recent rows." It needs the answer to two much
narrower, independent questions:

1. **Is there any row that is currently live** (in-flight `EXECUTING`, or `PENDING` with `expiresAt` still in the
   future)?
2. **If not, what is the single most-recently-updated row overall** (the latest terminal lifecycle event)?

## 3. Fix — query semantics, not a bigger window

`fitness-agent.service.ts::tryConfirmationBoundary`, replacing the one windowed `findMany` with two targeted
queries:

```ts
const now = new Date();
const liveAction = await prisma.fitnessAgentAction.findFirst({
  where: { userId: identity.userId, sessionId, OR: [{ status: "EXECUTING" }, { status: "PENDING", expiresAt: { gt: now } }] },
  orderBy: { updatedAt: "desc" }, select: { status: true, expiresAt: true, updatedAt: true },
});
const terminalAction = liveAction ? null : await prisma.fitnessAgentAction.findFirst({
  where: { userId: identity.userId, sessionId },
  orderBy: { updatedAt: "desc" }, select: { status: true, expiresAt: true, updatedAt: true },
});
const actions = liveAction ? [liveAction] : terminalAction ? [terminalAction] : [];
const actionState = deriveConfirmationState(actions, now);
```

### Why no arbitrary window is correctness-sensitive anymore

- **Query 1's `WHERE` clause itself is the bound** — it only ever matches rows that are actually live. However many
  terminal rows exist in the session, they never match this filter, so they can never crowd out a live row. No
  `take` is applied (and none is needed): the live subset is expected to be small (the architecture already limits
  concurrent pending drafts/workflows), and even if it were not, correctness here doesn't depend on a count.
- **Query 2 is `findFirst` — inherently `take: 1`.** Once we know (from query 1 returning nothing) that *no* row is
  live, the single most-recently-updated row overall is, by definition, the correct "latest terminal event" —
  there is no larger N that could ever change this answer, because we are not choosing among a truncated window,
  we are asking for the one true maximum.

This mirrors the exact fix already applied to `findLatestProfileConfirmation` for the profile-workflow side
(`workflow-state.repository.ts`, prior fix) — the same principle (filter to the semantically-relevant subset at the
database level, never window-then-filter) now applied symmetrically to the action side.

## 4. Event ordering preserved

Both queries order by `updatedAt`, never `createdAt` — the prior ordering fix
(`docs/conversational-intelligence-final-x4-runtime-closure.md`) is untouched and re-verified:

```
ok — X4 ordering — Codex final-audit Case C: action selection must follow updatedAt (latest EVENT), not createdAt
ok — X4 ordering — Case C reversed
```

## 5. TTL / expiry semantics

A `PENDING` row's `updatedAt` is set once, at creation, and never advances merely because `expiresAt` elapses
(expiry is computed at read time, never persisted as a status transition). Query 1's `expiresAt: { gt: now }`
clause — not an `updatedAt` comparison — is what correctly excludes a stale-but-literally-`PENDING` row from the
live set:

```
ok — X4-T10 — expired-by-time PENDING must not be treated as live even when it is the only/most-recent row
```

A persisted-`PENDING`-but-time-expired row still correctly falls through to query 2 (since query 1 excludes it)
and is reported as `EXPIRED` via `deriveConfirmationState`'s own existing `PENDING -> EXPIRED` fallback mapping —
unchanged behavior, now reached through the new query path.

## 6. Adversarial regression coverage (new, permanent)

Six new tests in `x4-event-ordering.test.ts` (BACKEND INTEGRATION, real test DB), asserting both the response
text's meaning and the authoritative DB state:

| test | scenario | result |
|---|---|---|
| X4-T10 exact | 1 live PENDING + 10 newer `COMPLETED` (Codex's exact shape) | pending detected — PASS (was FAIL) |
| X4-T10 beyond ten | 1 live PENDING + 25 newer `COMPLETED` | pending detected — PASS (was FAIL) |
| X4-T10 reverse | no live action, 15 terminal rows; newest is `CANCELLED` | latest terminal event (`CANCELLED`) governs — PASS |
| X4-T10 EXECUTING | 1 older in-flight `EXECUTING` + 12 newer terminal rows | `EXECUTING` remains authoritative — PASS (was FAIL) |
| X4-T10 expired-by-time | persisted `PENDING`, `expiresAt` in the past | reported `EXPIRED`, never live — PASS |
| X4-T10 cross-user | user A's live pending (behind 10 terminal rows) vs. user B's empty session | B sees nothing of A's — PASS |

**19/19** in `x4-event-ordering.test.ts` (13 pre-existing + 6 new). **23/23** in `x4-confirmation-followup.test.ts` +
`codex-x4-resolution-independent.test.ts` (unchanged, re-verified for regression). **42/42** combined.

## 7. Cross-source merge — unaffected, re-verified

`mergeConfirmationState` itself was not changed — only what feeds it on the action side. Precedence is unchanged
and re-verified: a live action still wins outright over any terminal profile-workflow state
(`X4 ordering — multiple action AND workflow events in one session`, PASS), and cross-source recency comparisons
for terminal states are unaffected (all prior event-ordering tests re-pass, §4, §6).

## 8. Real HTTP verification (after the fix)

New script `test/conversational-intelligence/x4-t10-repro.mjs` — real registration, a real workout-plan draft
(`PENDING` via the real HTTP path), 10 additional terminal rows (explicit TEST FIXTURE, same convention as prior
X4 matrices), then real status questions and a real confirmation:

```json
{
  "actionId": "1a489d5c-4d52-4869-aa0e-c25d8177934b",
  "totalRowsInSession": 11,
  "pendingDetectedBeforeResolution": true,
  "draftStillPendingBeforeResolution": true,
  "confirmHttp": 200,
  "draftStatusAfterConfirm": "COMPLETED",
  "statusAnswerAfterResolution": "Rồi — thao tác gần nhất trong cuộc trò chuyện này đã được xác nhận và lưu. Hiện không còn gì đang chờ xác nhận.",
  "noNewRowsCreated": true,
  "nowTruthfulPositive": true
}
```

Before resolution: "Đã lưu thành công chưa?" → `"Chưa — mình chưa lưu gì cả. Thay đổi vẫn đang chờ bạn bấm nút
**Xác nhận**..."` — truthfully detects the still-live pending draft despite the 10 newer terminal rows. The draft
is then resolved through the real `/ai/agent/actions/:id/confirm` endpoint (a bare "Xác nhận cập nhật." text message
does not confirm a draft action by design — only a profile workflow's text-confirmation step works that way; see
`confirmation-boundary.ts`'s own module doc comment). After that real write, the next status question changes
truthfully to a positive answer. Row count stays at 11 throughout — no duplicate or unauthorized write.

## 9. Regression — three configurations

| config | flags | result |
|---|---|---|
| A | `CONVERSATIONAL_INTELLIGENCE_V2=off`, `_LLM=off` | **260/260** |
| B | `CONVERSATIONAL_INTELLIGENCE_V2=on`, `_LLM=off` | **260/260** |
| C | `CONVERSATIONAL_INTELLIGENCE_V2=on`, `_LLM=on` | **260/260** |

260 = the prior closure's 254 + 6 new X4-T10 tests. Includes the dedicated X1/X2/X3 probes
(`codex-remediation-boundary.test.ts`), the prior X4 ordering/follow-up tests, and Codex's own independent closure
test — all pass unmodified in every configuration. **No X1/X2/X3 regression.**

**X4 confirmation matrix**: `node test/conversational-intelligence/x4-confirmation-matrix.mjs x4t10-final 1` →
`cells=57 claimWithoutWrite=0 expectationChecked=55 expectationFailed=0 errors=0 setupFailed=0`.

**CI-V2 golden conversation**: `node test/conversational-intelligence/live-golden.mjs` → **13/13**.

No existing test expectation was changed to force a pass — the two fixture-construction edits from the prior
closure task (explicit `updatedAt` on directly-inserted rows) remain as they were; nothing in this task required
touching any existing assertion.

## Production files changed

| file | change |
|---|---|
| `backend/services/ai-service/src/services/fitness-agent.service.ts` | `tryConfirmationBoundary`: replaced the single windowed `FitnessAgentAction` query (`take: 10`) with two targeted queries (live-action existence check; latest-terminal-event fallback) |

Test files: `backend/services/ai-service/src/__tests__/x4-event-ordering.test.ts` (6 new permanent tests),
`test/conversational-intelligence/x4-t10-repro.mjs` (new, independent REAL HTTP reproduction).

## Remaining limitations

Unchanged, out of this task's narrow scope, documented and not touched:

- X5 free-text draft exclusion.
- X6 local Qwen3 4B / browser latency (one `live-golden.mjs` step again took ~90s locally; assertions still passed).
- Profile-origin 401/403 → generic HTTP 500 controller mapping.
- Qwen3 4B frozen-corpus routing accuracy remains insufficient for default-on; Qwen3 30B remains unmeasured there.
- `live-global.mjs`'s full count was not re-attempted in this task (already documented as environment-latency-
  blocked in the prior closure report); nothing in this task's scope depends on it.
- The worktree remains broadly dirty with unrelated, pre-existing uncommitted work from earlier phases; this task
  touched only the two files listed above plus the one new test script.

## Final acceptance bar — self-check against the task's own seven criteria

1. A live pending action cannot be hidden by any number of newer terminal rows — confirmed (§3, §6: 25-row case).
2. Expired pending actions are not treated as live — confirmed (§5, §6).
3. Previous `updatedAt` event-ordering fixes remain correct — confirmed (§4).
4. Cross-user/session isolation remains intact — confirmed (§6, §9 matrix S6).
5. No duplicate or unauthorized write occurs — confirmed (§8: row count stays at 11 throughout).
6. X1–X3 remain green — confirmed (§9: 260/260 across all three configs).
7. No arbitrary `take: N` window determines correctness — confirmed (§3: query 1 has no `take` at all and is
   bounded by its `WHERE` clause; query 2 is `findFirst`, i.e. `take: 1`, which is never "too small" for a single-
   row answer).

## Status: COMPLETE — not self-signed-off

Codex should perform one final, narrow verification of X4-T10 only: rerun its own reproduction shape (or the new
permanent tests/script here) against the fixed query and confirm the live pending action is now detected correctly
at 10, 25, and any other row count, with no regression to X1–X3 or the prior event-ordering fix.
