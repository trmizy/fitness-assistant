# Conversational Intelligence — X4 Event-Ordering Remediation

Date: 2026-09-27. Owner: Claude Code (implementation). Input: `docs/codex-conversational-intelligence-final-closure-signoff.md`
("Resumed Follow-up Evidence"), `docs/conversational-intelligence-x4-followup-fix.md` (the prior, narrower X4 fix this
builds on), `docs/conversational-intelligence-final-defect-closure.md`.
Scope: fix ONLY the two real edge-case failures Codex's resumed independent verification reproduced against the prior
X4 followup fix — no redesign of Conversational Intelligence, no change to the signed-off Enterprise Data Agent /
Fitness Recommendation Agent / HITL / action-finalization architecture, no new dependency, no model-provider change,
no new regex pattern, no CI-V2 flag default change.

## Status: **COMPLETE** for the two reported defects. Not self-signed-off.

Evidence labels: `REAL HTTP/API` (Docker gateway, real registration/login, isolated test DBs), `BACKEND INTEGRATION`
(`node:test` inside `gymcoach-ai-dev`, real Postgres test DB), `CODE AUDIT`.

---

## Original independent reproductions (Codex, before this fix)

`test/conversational-intelligence/results/codex-final-followup/ordering.log` — **6/8 PASS, 2 FAIL**
(`src/__tests__/codex-x4-resolution-independent.test.ts`, preserved unmodified as evidence except for one
schema-consistency fixture fix described below — no assertion changed):

- **`history-over-five`**: a real completed `UPDATE_GOAL` profile confirmation, followed by 6 newer, unrelated
  terminal `CREATE_WORKOUT_PLAN` workflows (never proposed any profile change). Expected `/^Rồi/` (truthful positive);
  actual `"Chưa có thay đổi nào được lưu trong cuộc trò chuyện này — hiện không có thao tác nào đang chờ xác nhận."`
  — a false denial of a real, still-relevant, saved change.
- **`action-cancelled-later`**: a `FitnessAgentAction` created at T1, a real profile confirmation completing at T2 (>T1),
  then the SAME action cancelled via the real `dismissDraft` path at T3 (>T2). Expected `/đã được bỏ qua/` (the newer
  cancellation governs); actual `"Rồi — thao tác gần nhất trong cuộc trò chuyện này đã được xác nhận và lưu..."` — the
  stale, older profile completion incorrectly won.

Also reproduced through real HTTP after an actual profile write in
`test/conversational-intelligence/results/codex-final-followup/x4-edge-http.json` (preserved unmodified): both cells
show `"truthful": false`; the action-cancelled-later record includes a real `dismissal` HTTP response
(`"Đã bỏ qua bản nháp này — chưa lưu gì vào hệ thống."`, `status: "CANCELLED"`) and — since this evidence predates the
fix — the `actions[0]` entry has no `updated_at` field at all (the column did not exist yet).

## Root cause

**Defect A — profile-history truncation.** `workflowStateRepository.findLatestProfileConfirmation` fetched only the
5 most recent **terminal** `AgentWorkflowSession` rows (`take: 5`, ordered by `updatedAt desc`) and *then* filtered in
JS for a non-null `pendingProfileUpdate`. Six newer, unrelated terminal workflows (any bare slot-collection that was
cancelled/expired without ever proposing a profile change) fill all 5 slots before the filter runs, so an older,
genuinely relevant completed confirmation is never even looked at.

**Defect B — wrong action timestamp.** The merge (`mergeConfirmationState`, from the prior followup fix) compared
`FitnessAgentAction.createdAt` — a column that **never changes** after the row is first written — against
`AgentWorkflowSession.updatedAt` (which already tracked real transitions). `FitnessAgentAction` had **no** column that
recorded when a status transition (confirm/cancel/execute) actually happened; `expiresAt` is a TTL, not a transition
marker. A real dismiss that happens after a profile confirmation therefore still compared as if it happened at the
action's original creation time — often long before the confirmation — so the stale, older event won.

## Production changes

| file | change |
|---|---|
| `prisma/schema.prisma` | `FitnessAgentAction` gains `updatedAt DateTime @updatedAt @map("updated_at")` (mirrors `AgentWorkflowSession`'s own, pre-existing column); `AgentWorkflowSession` gains `@@index([userId, sessionId, status, updatedAt])` |
| `prisma/migrations/20260927150000_fitness_agent_action_updated_at/migration.sql` (new) | `ALTER TABLE fitness_agent_actions ADD COLUMN updated_at`, backfilled to `created_at` for existing rows, `NOT NULL` + `DEFAULT CURRENT_TIMESTAMP`; `CREATE INDEX` on `agent_workflow_sessions(user_id, session_id, status, updated_at)` |
| `agent-workflow/workflow-state.repository.ts` | `findLatestProfileConfirmation` rewritten as a **single DB-level query** — `status IN (terminal) AND pendingProfileUpdate: { not: Prisma.DbNull }`, `ORDER BY updatedAt DESC`, no `take`/window at all |
| `services/fitness-agent.service.ts` | `tryConfirmationBoundary` now selects `updatedAt` (not `createdAt`) on the `FitnessAgentAction` query and passes `actions[0]?.updatedAt` into `mergeConfirmationState` — the same row whose status determines `actionState` in every non-PENDING/EXECUTING branch |

No change to `confirmation-boundary.ts`'s `mergeConfirmationState` logic itself (the precedence rule from the prior
fix was already correct) — both defects were purely in *what data* it was being fed, not its own logic.

### Query correctness and timestamp semantics

- **`Prisma.DbNull` vs `Prisma.JsonNull`, verified empirically, not assumed**: real production code
  (`workflowStateRepository.create()`) never sets `pendingProfileUpdate` for a bare slot-collection workflow — it
  *omits* the field, leaving a genuine SQL `NULL` (`DbNull`). A direct check (`pending_profile_update IS NULL` via
  raw SQL after a Prisma `create()` call) confirmed that an **explicit** `pendingProfileUpdate: null` instead stores a
  JSON `null` *literal* (`is_sql_null: false`) — a different on-disk state no real production row ever has, since no
  call site ever explicitly clears this field to `null` (verified by search — every write either omits it or sets a
  real array). `{ not: Prisma.DbNull }` is therefore the correct, DB-level filter for "genuinely never proposed a
  profile change," and requires no JS-side re-filtering or `take` workaround.
- **A real last-transition time, not creation time**: `FitnessAgentAction.updatedAt` uses the same `@updatedAt`
  mechanism `AgentWorkflowSession.updatedAt` already relied on — Prisma sets it automatically on every
  `update()`/`updateMany()` call (confirm-claim, confirm-complete, dismiss, revision-edit, etc.), so **no application
  call site needed to change** for existing writes to start producing a correct value going forward.
- **Backfill, not a blanket "now"**: existing rows are backfilled to their own `created_at` (the best available
  signal for a row written before this column existed) rather than the migration's own run time, which would have
  fabricated a false recency for already-settled historical rows.
- **Indexing**: `AgentWorkflowSession` already had `@@index([userId, sessionId, status])`; extended with `updatedAt`
  appended so `findLatestProfileConfirmation`'s `WHERE userId AND sessionId AND status IN (...) ORDER BY updatedAt
  DESC LIMIT 1` stays a single index-scan lookup regardless of how much unrelated terminal-workflow history a session
  accumulates — this was the actual fix for Defect A's performance concern, not a larger `take`.
- **No migration was added without evidence**: the need for `FitnessAgentAction.updatedAt` was established by first
  confirming, by direct code search, that no existing column tracks a real transition time (only `createdAt` and the
  TTL field `expiresAt` exist) — only then was the column added, mirroring an already-existing, proven pattern in the
  same schema (`AgentWorkflowSession.updatedAt`), not a novel design.

### Two test-fixture fixes (schema consistency, not expectation changes)

Adding a real `updatedAt` column surfaced that two `node:test` fixtures directly inserted rows via `prisma.*.create()`
with an artificially backdated `createdAt` but no explicit `updatedAt` — Prisma's own `@updatedAt` then defaulted
`updatedAt` to the fixture's actual wall-clock insert time (not the intended backdated value), producing an
inconsistent on-disk state no real row can have (a genuinely-just-created row always has `updatedAt === createdAt`;
they only diverge after a real, later `.update()`). Both were corrected by passing `updatedAt: createdAt` explicitly:

- `src/__tests__/codex-x4-resolution-independent.test.ts`'s `action()` fixture helper — this broke Codex's own
  previously-passing `newer-profile` scenario as a direct side effect of adding the column; fixed, re-verified 8/8.
- `src/__tests__/x4-confirmation-followup.test.ts`'s `seedAction()` helper — broke its own `X4-7b` precedence test the
  same way; fixed, re-verified 15/15.

**No assertion, expected value, or test description was changed in either file** — only the fixture's raw-row
construction, to keep it representative of a state real application code can actually produce.

## Golden sequence verification (after the fix)

Independent, freshly-authored REAL HTTP/API + DB script (`test/conversational-intelligence/x4-event-ordering-repro.mjs`,
saved evidence at `results/final-closure/x4-event-ordering-after.json` — does not overwrite Codex's own
`x4-edge-http.json`):

```
Defect A — confirmedAnswer: Đã cập nhật hồ sơ của bạn. Mục tiêu: giảm mỡ.
         | statusAnswer: Rồi — thao tác gần nhất trong cuộc trò chuyện này đã được xác nhận và lưu. Hiện không còn gì đang chờ xác nhận.
         | truthful: true
Defect B — confirmedAnswer: Đã cập nhật hồ sơ của bạn. Mục tiêu: giảm mỡ. | dismiss: 200
         | statusAnswer: Chưa — bản gần nhất đã được bỏ qua nên mình chưa lưu gì cả. Bạn nhắn lại yêu cầu nếu muốn mình soạn bản mới.
         | truthful: true

allTruthful=true
EXIT=0
```

Codex's own reproduction test file, rerun unmodified (except the one fixture fix above) in all three flag configurations:

```
# tests 8 / # pass 8 / # fail 0   (CI OFF/LLM OFF, CI ON/LLM OFF, CI ON/LLM ON — all three)
```

## Negative/precedence regression (new, permanent)

New file `src/__tests__/x4-event-ordering.test.ts` — **11/11 pass** — BACKEND INTEGRATION, real test DB, real
`fitnessAgent.tryConfirmationBoundary`/`dismissDraft`:

| scenario | assertion |
|---|---|
| Defect A: 6 newer unrelated terminal workflows | `findLatestProfileConfirmation` still returns the older relevant `COMPLETED` row; boundary answers `/^Rồi/` |
| Defect A: 8 unrelated terminal rows total (beyond the old `take:5`) | still correctly found, DB-level query, no truncation |
| Defect B: action cancelled via the REAL `dismissDraft` path after a profile confirmation | `updatedAt > createdAt` on the action row; boundary reports the newer cancellation; no extra action row created |
| Reverse of Defect B | a newer completed profile confirmation is not shadowed by an older cancelled action |
| Closely-spaced/equal timestamps | deterministic, DB-timestamp-grounded answer — never the old false "NONE" denial |
| Multiple action AND workflow events in one session | only the truly latest relevant event governs |
| Cross-user/session isolation | still holds after the ordering fix |
| Golden A/B/C/D (mandate) | all pass — discoverable-behind-6, real-dismiss-recognized-newer, reverse-order, repeated-question with no duplicate write/false success/false denial |

Every test asserts **both** the response text's meaning **and** the authoritative DB state (row counts, `status`,
`updatedAt` ordering) — never text alone.

## X4 confirmation matrix — extended with both reproduced cases

`test/conversational-intelligence/x4-confirmation-matrix.mjs` gains two new permanent states (in addition to the
prior fix's S0–S7):

- **S8** — a real completed profile confirmation followed by 6 newer unrelated terminal workflows (fixture rows,
  exactly mirroring Codex's own construction) — asserts the truthful positive answer for all 6 utterances.
- **S9** — a real draft action, a real profile confirmation completing after it, then the SAME action cancelled via
  the real dismiss API afterwards — asserts the honest "already dismissed" answer for all 6 utterances.

Run after the fix (`node test/conversational-intelligence/x4-confirmation-matrix.mjs after-ordering2 1`), REAL
HTTP/API + DB:

```
S8 U6 | Rồi — thao tác gần nhất trong cuộc trò chuyện này đã được xác nhận và lưu. Hiện không còn gì đang chờ xác nhận. (truthful)
S9 U6 | Chưa — bản gần nhất đã được bỏ qua nên mình chưa lưu gì cả. ... (the real, newer cancellation governs)

cells=57 claimWithoutWrite=0 expectationChecked=55 expectationFailed=0 errors=0 setupFailed=0
```
(full per-cell output at `test/conversational-intelligence/results/final-closure/x4-matrix-after-ordering2.json`; the
prior fix's `x4-matrix-after-followup.json` and the original closure's `x4-matrix-{before,after}.json` are unmodified.)

## Regression — REAL HTTP/API, BACKEND INTEGRATION

| suite | flags | evidence | result |
|---|---|---|---|
| `tsc --noEmit` | — | CODE AUDIT | clean, no new errors |
| Full set: conversational-intelligence + agent-workflow + fitness-agent + codex-remediation-boundary + `codex-x4-resolution-independent` + `x4-confirmation-followup` + `x4-event-ordering` | **OFF** | BACKEND INTEGRATION | **246/246** |
| same, **ON / LLM off** | BACKEND INTEGRATION | **246/246** |
| same, **ON / LLM on** | BACKEND INTEGRATION | **246/246** |
| CI-V2 golden conversation | REAL HTTP/API | **13/13** |
| Global golden (draft correction ✓, profile confirmation ✓, PT confirmation ✓, cross-user isolation ✓) | REAL HTTP/API | **23/23** |
| X4 confirmation matrix (incl. new S8/S9) | REAL HTTP/API + DB | **57/57 cells, 0 expectationFailed, 0 claimWithoutWrite, 0 errors, 0 setupFailed** |
| Codex security/IDOR HTTP probe (unmodified) | REAL HTTP/API + DB | **15/16** (I03 = X5, pre-existing, unrelated — unchanged) |
| X1/X2/X3 independent probes (`codex-remediation-boundary.test.ts`) | OFF & ON | BACKEND INTEGRATION | included in the 246/246 above, unmodified |

246 = the prior followup fix's 227 (212 original + 15 `x4-confirmation-followup`) + 8 (`codex-x4-resolution-independent`,
Codex's own file) + 11 (`x4-event-ordering`, new). No existing test's expectation was weakened to force a pass — the
two fixture edits described above are schema-consistency corrections required by the new `updatedAt` column, not
assertion changes, and both are called out explicitly with their reasoning in-file.

## Remaining limitations

- The new migration (`20260927150000_fitness_agent_action_updated_at`) was applied and verified against this stack's
  isolated test database (`gymcoach_ai_test`, the same database the `gymcoach-ai-dev` container's `DATABASE_URL`
  already points at for this verification stack). Deploying it to any other environment (a separate dev/prod
  database) is the standard `prisma migrate deploy` step already used for every other migration in this repo — not
  performed here, since this task's verification stack does not include one.
- An exact, simultaneous tie between an action's and a workflow's timestamps still resolves via the prior fix's
  documented, deterministic tie-break (profile workflow wins on `>=`) rather than a "clarify with the user" UX —
  unchanged from the prior fix's own documented limitation, and still not exercised by any of the required scenarios.
- All limitations already on record in `docs/conversational-intelligence-final-defect-closure.md` and
  `docs/conversational-intelligence-x4-followup-fix.md` (X5, X6, 401/403→500 mapping, Config B/C accuracy) are
  unchanged by this narrow follow-up and not re-verified here.
- Real-browser (Playwright) reruns were not repeated — this fix touches no client-facing route, template, or
  browser-observable timing behavior beyond the text of one deterministic answer, already covered above by REAL
  HTTP/API evidence at both the unit-scenario and matrix scale.

## Status: COMPLETE (for the two reported defects) — not self-signed-off

Both of Codex's original reproductions (`history-over-five`, `action-cancelled-later`) now pass in
`src/__tests__/codex-x4-resolution-independent.test.ts` **without modifying their expectations** — the acceptance
criterion this task set for itself. Handed back to Codex to independently verify both new cases and finish its own
already-running final sign-off (Full sets B/C, the strengthened matrix's own re-inspection, Golden/global-golden
reruns) under Codex's own evidence collection.

## Reproduce

```
MSYS_NO_PATHCONV=1 docker exec -e CONVERSATIONAL_INTELLIGENCE_V2=<off|on> -e CONVERSATIONAL_INTELLIGENCE_V2_LLM=<off|on> gymcoach-ai-dev \
  sh -c "cd /app/backend/services/ai-service && npx prisma migrate deploy && npx tsx --test src/__tests__/conversational-intelligence-*.test.ts \
  src/__tests__/codex-remediation-boundary.test.ts src/__tests__/codex-x4-resolution-independent.test.ts \
  src/__tests__/agent-workflow-*.test.ts src/__tests__/fitness-agent-*.test.ts \
  src/__tests__/x4-confirmation-followup.test.ts src/__tests__/x4-event-ordering.test.ts"
node test/conversational-intelligence/x4-event-ordering-repro.mjs
node test/conversational-intelligence/x4-confirmation-matrix.mjs <label> 1
node test/conversational-intelligence/live-golden.mjs
node test/conversational-intelligence/live-global.mjs
node test/conversational-intelligence/codex-security-http.mjs
```
Result files kept: `test/conversational-intelligence/results/final-closure/x4-event-ordering-after.json` (new),
`x4-matrix-after-ordering2.json` (new), all prior evidence (`x4-matrix-{before,after}.json`,
`x4-matrix-after-followup.json`, Codex's own `results/codex-final-followup/*`) unmodified.
