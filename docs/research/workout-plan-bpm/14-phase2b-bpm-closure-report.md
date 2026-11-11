# 14 — Phase 2B: BPM Closure Report

**Implementation owner**: Claude Code. **Independent review**: pending, by Codex. **Date**: 2026-10-05.
Closes exactly the two gaps Phase 2's own verdict named as blocking (`13-phase2-ai-completion-report.md`).

## 1. Scope

Only GAP-A (CREATE_WORKOUT_PLAN-specific interruption/resume) and GAP-B (exactly-once persistence under
sequential/concurrent double confirmation), per the Phase 2B brief. No equipment-filtering changes, no Qwen
work, no CI semantic routing changes, no frozen-benchmark work. **Zero production code was changed** — see §10.

## 2. Starting gaps

Per `10-traceability-matrix.md` before this phase:
- **FR15/EX09/EX10/AC31/AC32**: "the mechanism is proven generically (X1–X4), not yet CREATE_WORKOUT_PLAN-specific." PARTIAL.
- **FR19/EX14/AC19/AC36**: "a direct 'two real confirm calls → one program row' test... was not found." PARTIAL.

## 3. Repository inspection

Read `03`, `04`, `05`, `06`, `10`, `13` first, then the real implementation:

- **Interruption mechanism**: `conversational-intelligence/global/global-turn.ts::runGlobalTurn`, called from
  `fitness-agent.service.ts`'s turn dispatcher (`tryTurnUnguarded`, line ~552) **only when
  `ciMode() === "on"`**. Confirmed `CONVERSATIONAL_INTELLIGENCE_V2` defaults to `"off"` in both code
  (`conversational-intelligence/index.ts:25`) and the production compose (not set) — `02-as-is-process.md:8-10`
  already documents this; the exception catalogue's own citation of `global-turn.ts` for EX09 describes the
  flag-gated mechanism, not what runs by default today. For `READ_STATE`/`GOAL` topic specifically,
  `runGlobalTurn` calls the purely deterministic `readers.ts::readGoal` (reads only via
  `deps.getUserFitnessContext`, no RAG/LLM), and returns its `result` directly — `fitness-agent.service.ts:556`
  (`if (g?.result) return g.result...`) returns **before** `runWorkflowTurn` (the slot orchestrator) is ever
  called, so the active `AgentWorkflowSession` row is provably never touched by that turn.
- **Orchestrator slot-reply path**: `agent-workflow/orchestrator.ts::runWorkflowTurn` (lines 85-137) — when
  `ciMode() !== "off"` and a slot is expected, calls `handleSemanticTurn` before `handleSlotReply`; with CI-V2
  off, goes straight to `handleSlotReply` (legacy mode has no interruption gate of its own at this point — this
  is exactly why the test below explicitly enables the flag, matching the convention
  `conversational-intelligence-remediation.test.ts`/`conversational-intelligence-v2.test.ts` already use for
  other workflows).
- **Confirmation/exactly-once mechanism**: two independent layers, inspected directly:
  1. **ai-service**: `fitness-agent.service.ts::execute` (lines 823-884) — an atomic conditional
     `prisma.fitnessAgentAction.updateMany({where: {id, status: "PENDING"}, data: {status: "EXECUTING", ...}})`;
     only the caller whose `updateMany` reports `count === 1` proceeds to the business write. A second concurrent
     call sees `claimed = false` and returns a 409 **without ever calling** `importAiPlanToSchedule`. A
     *sequential* second call after `COMPLETED` returns the stored result at line 828, also without calling it
     again.
  2. **fitness-service**: `workout.service.ts::importAiPlanToSchedule` (line 2353) — **real finding, corrects
     the matrix's prior assumption**: does a pre-transaction `findFirst({userId, sourcePlanId})`; if found,
     **updates** the existing `WorkoutProgram` in place (lines 2373-2460+); if not found, **creates** a new one
     (lines 2669-2752) with `sourcePlanId: input.sourcePlanId` set — but **`agentActionId` is never set anywhere
     in this function**. The schema's real backstop for this exact flow is `@@unique([userId, sourcePlanId])`
     (`prisma/schema.prisma:556`), not `WorkoutProgram.agentActionId @unique` (`:535`, real, but populated by a
     different caller — `createManualProgram`'s `agent` param, not this path).
- **X4/X4-T10 tests**: confirmed they exercise the confirmation-boundary's *truthfulness/event-ordering* layer
  (`confirmation-boundary.ts`), a different boundary than the persistence layer GAP-B is about — reused as
  evidence for FR16/FR20-22, not duplicated here.

## 4. Interruption/resume implementation findings

No code change needed or made. The existing `runGlobalTurn` → early-return-before-`runWorkflowTurn` design
already gives the exact safety property required (§3). The only reason this wasn't previously
`IMPLEMENTED_AND_VERIFIED` for this BPM is the absence of a CREATE_WORKOUT_PLAN-specific test — closed by §5.

## 5. Interruption/resume test

Added to `agent-workflow-create-workout-plan.test.ts` (real DB, same file/convention as Phase 2):

> "CREATE_WORKOUT_PLAN interruption/resume (real DB): an unrelated supported READ (goal question) while
> sessionMinutes is still pending does not corrupt workflow state, and the SAME workflow resumes afterward"

T1: `"Tạo lịch tập cho tôi"` with `sessionMinutes: null` → real `AgentWorkflowSession` row,
`COLLECTING_SLOTS`/`expectedSlot: "sessionMinutes"`. Snapshot captured: `id, workflowType, userId, sessionId,
status, expectedSlot, slotsJson`.

T2: `"Mục tiêu tập luyện hiện tại của tôi là gì?"` — an **already-existing, already-supported** READ_STATE/GOAL
route (no new feature). Asserted: answered from the real profile read (`/Mục tiêu hiện tại của bạn là/i`), carries
the pending-workflow reminder (`/vẫn đang.*dở/is`), zero response blocks. The workflow-row snapshot is asserted
**byte-identical** (`assert.deepEqual`) before vs. after — every semantic field, not just a loose "still exists"
check; row count still 1; zero premature `FitnessAgentAction` rows.

T3: `"1 tiếng"` resumes — asserted the completed row's `id` equals the pre-interruption `id` (same row, no
restart), row count still 1, status `COMPLETED`, and a real draft (`WORKOUT_PLAN_PREVIEW`) is produced.

T4: `fitnessAgent.execute(identity, actionId, true)` — the preserved draft confirms successfully end-to-end.

The flag `CONVERSATIONAL_INTELLIGENCE_V2` is set to `"on"` only for this test's duration (saved/restored in
`afterEach`), exercising a real, already-shipped, already-elsewhere-tested mechanism — not a new feature built
for the test.

## 6. Exactly-once mechanism found in current code

See §3. In one line: **ai-service's atomic claim prevents a double-dispatch in the normal confirm-API path; the
fitness-service `(userId, sourcePlanId)` DB unique constraint plus its check-then-act logic independently
guarantees at most one `WorkoutProgram` row even if that layer were called twice on its own.** No single
mechanism alone was assumed sufficient — both were tested directly (§7, §8).

## 7. Sequential double-confirm test

Added to `ai-workout-grounding.integration.test.ts` (fitness-service, real DB), calling
`workoutService.importAiPlanToSchedule` directly (bypassing ai-service's claim on purpose, to test
fitness-service's own independent defense — ai-service's claim-based defense is already covered by the existing,
pre-Phase-2B golden-flow test's stubbed double-confirm assertion):

- Confirm #1 on a fresh `sourcePlanId` → exactly 1 `WorkoutProgram` row.
- Confirm #2, same `sourcePlanId` → **updates the same row** (its own existing-program branch, not a fresh
  insert) → still exactly 1 row, same `id` both times.

## 8. Concurrent double-confirm test

Same file, `Promise.allSettled` with two genuinely simultaneous `importAiPlanToSchedule` calls on the same,
previously-nonexistent `sourcePlanId`:

- Asserted (not assumed): exactly one `WorkoutProgram` row exists for `(userId, sourcePlanId)` after both settle.
- Asserted: at least one of the two attempts succeeds (the race can never fail BOTH outright).
- If one settles rejected, asserted the rejection message actually names the real uniqueness constraint
  (`/unique|constraint|P2002/i`) — so a losing writer, if it occurs, fails for the *real*, intended reason, not
  an unrelated bug.
- **Outcome this run**: the test passed — the invariant (≤1 row) held. (Whether the two calls happened to
  serialize naturally or one hit the real DB constraint was not pinned down with an isolated micro-benchmark —
  an ad hoc probe script attempted this separately but failed on an unrelated module-resolution issue outside
  the real test harness; not worth further budget since the actual test, which is the real evidence, already
  passed and the row-count invariant is what matters, not which of the two legitimate paths produced it.)

## 9. Whether DB migration was necessary

**No — CASE A.** Both inspected mechanisms (ai-service's atomic claim; fitness-service's
`@@unique([userId, sourcePlanId])` + check-then-act) already exist and, per §7/§8's real DB evidence, already
guarantee the invariant. No schema change was made. (The traceability matrix's prior citation of
`agentActionId @unique` as the enforcing mechanism was corrected during inspection — see §3 — but the schema
itself required no change, only the documentation did.)

## 10. Any code/schema changes

**None.** This phase is test-and-documentation only:
- `backend/services/ai-service/src/__tests__/agent-workflow-create-workout-plan.test.ts` (+1 test, +1
  `afterEach` for the CI-V2 flag restore)
- `backend/services/fitness-service/src/__tests__/ai-workout-grounding.integration.test.ts` (+2 tests)
- `docs/research/workout-plan-bpm/10-traceability-matrix.md` (FR15/FR19 rows + summary updated; FR19's
  mechanism citation corrected)
- `docs/research/workout-plan-bpm/14-phase2b-bpm-closure-report.md` (this file)

## 11. Test commands

```
# GAP-A (ai-service)
cd backend/services/ai-service
NODE_ENV=test DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_test \
  INTERNAL_SERVICE_SECRET=test_internal_service_secret_32_chars_minimum \
  JWT_SECRET=test_jwt_secret_32_chars_minimum_value REDIS_URL=redis://localhost:56379 \
  npx tsx --test src/__tests__/agent-workflow-create-workout-plan.test.ts

# GAP-B (fitness-service)
cd backend/services/fitness-service
NODE_ENV=test DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_fitness_test \
  FITNESS_DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_fitness_test \
  INTERNAL_SERVICE_SECRET=test_internal_service_secret_32_chars_minimum REDIS_URL=redis://localhost:56379 \
  npx tsx --test src/__tests__/ai-workout-grounding.integration.test.ts

# Regression (ai-service full suite)
cd backend/services/ai-service
NODE_ENV=test DATABASE_URL=... INTERNAL_SERVICE_SECRET=... JWT_SECRET=... REDIS_URL=... LLM_PROVIDER=mock \
  npx tsx --test src/__tests__/*.test.ts
```

DB/Redis target (no secrets): `postgres-test` at `localhost:55433` (`gymcoach_ai_test` / `gymcoach_fitness_test`,
user `gymcoach_test`), `redis-test` at `localhost:56379`. Both containers (`gymcoach-test-postgres-test-1`,
`gymcoach-test-redis-test-1`) were already running from this session's Phase 2 work; not recreated. Dev/prod DB
(`gymcoach-postgres`, port 5433) was never touched. Git HEAD at time of testing: `81d9f432` (unchanged across
Phase 2/2B); working tree dirty with pre-existing, unrelated changes (confirmed via `git status`/`git diff`
before every edit, per this repo's parallel-agent-safety convention) — only the 4 files listed in §10 were
touched this phase. Feature flags: `CONVERSATIONAL_INTELLIGENCE_V2` explicitly toggled to `"on"` only inside the
one new interruption test (restored after); everything else ran with this repo's real defaults.

## 12. Exact pass/fail/skip counts

| Suite | Pass | Fail | Skipped |
|---|---|---|---|
| `agent-workflow-create-workout-plan.test.ts` (11 tests: 10 from Phase 2 + 1 new GAP-A) | 11 | 0 | 0 |
| `ai-workout-grounding.integration.test.ts` (5 tests: 3 from Phase 2 + 2 new GAP-B) | 5 | 0 | 0 |
| ai-service full suite (`*.test.ts`, 789 tests) | 779 | 6 | 4 |

The 6 full-suite failures are the **exact same 6** already documented as pre-existing/environmental in
`13-phase2-ai-completion-report.md` §13 (Ollama model-name drift ×2, Pipeline B telemetry/live-fitness-service
requirement ×3, the pre-existing weekday-selection test's own live-fitness-service requirement ×1) — confirmed by
name-for-name comparison against this phase's run; zero new failures, zero regressions. ENVIRONMENT_FAILURE (all
6, unchanged from Phase 2) vs CODE_REGRESSION (0).

## 13. DB row-count evidence

- GAP-B sequential: `WorkoutProgram` count for `(userId, sourcePlanId)` = 0 before either call, 1 after the
  first, **1 after the second** (same `id` both times — confirmed by direct `findMany`/assert, not inferred from
  HTTP status).
- GAP-B concurrent: `WorkoutProgram` count for `(userId, sourcePlanId)` = **1** after both `Promise.allSettled`
  branches resolve, regardless of which settled first.
- GAP-A: `AgentWorkflowSession` row count for the test user = **1** throughout T1→T3 (never 0, never 2);
  `FitnessAgentAction` (kind `CREATE_WORKOUT_PLAN`) count = 0 during the interruption, 1 after resume, still 1
  (now `COMPLETED`) after confirm.

## 14. User-isolation evidence

Not re-tested this phase — reused existing evidence (`agent-workflow-security-e2e.test.ts`,
`x4-event-ordering.test.ts` cross-user cases, `codex-security-http.mjs`), already `IMPLEMENTED_AND_VERIFIED`
(FR20) before Phase 2 began and unaffected by either GAP-A or GAP-B's changes (both are test-only; §10).

## 15. Equipment regression evidence

The 3 equipment-aware-draft-generation tests and the equipment-rejection-at-confirm test added in Phase 2 all
still pass in this phase's full-suite run (§12) — zero regression from the GAP-A/GAP-B test additions, which
touch neither `fitness-agent.service.ts`'s equipment pass nor `fitness-agent-tools.ts`.

## 16. X4/X4-T10 regression evidence

`x4-event-ordering.test.ts` (all cases, including X4-T10) still passes in the full-suite run (§12) — this phase
added no CI-V2/confirmation-boundary code, only enabled the existing flag for one test's duration, which does not
touch `confirmation-boundary.ts`.

## 17. Environment failures vs code regressions

See §12 — all 6 full-suite failures are the identical, previously-documented environmental gaps (missing local
Ollama model, missing live fitness-service for 3 Pipeline-B/legacy-mode tests). Zero code regressions attributable
to Phase 2B.

## 18. Updated FR/EX/AC traceability

`10-traceability-matrix.md`: FR15 (EX09/EX10/AC31/AC32) and FR19 (EX14/AC19/AC36) flipped from PARTIAL to
IMPLEMENTED_AND_VERIFIED; FR19's enforcing-mechanism citation corrected (§3); summary recomputed: **11
IMPLEMENTED_AND_VERIFIED, 8 IMPLEMENTED_NOT_VERIFIED_FOR_THIS_BPM, 3 PARTIAL (FR02, FR03, FR10), 0 MISSING**.

## 19. Remaining BPM gaps

- **FR02** (extraction-accuracy test for workout-plan phrasing specifically) and **FR03** (explicit
  "missing-profile short-circuits before generation" test) and **FR10** (ai-service-side unit test for the
  catalog-unmatched-count path) remain PARTIAL — none were in this phase's named scope (GAP-A/GAP-B only) and
  none were touched.
- Qwen3 4B dataset construction/execution (research doc `11`) — explicitly out of scope for both Phase 2 and
  Phase 2B; remains its own future phase.
- `trainingLocation`, `createManualProgram`'s equipment-validation asymmetry — unchanged, out of scope.

## 20. Benchmark readiness

Not assessed as "ready for the frozen benchmark" by this phase — that determination was never this phase's gate
(§17 of the brief: the next gate is independent Codex review, not the benchmark). See the verdict below.

---

## Final response (brief section 18)

**A. Why the two gaps were PARTIAL**: FR15 — the interruption-preserving mechanism exists and works, but had
never been exercised by a test specific to this workflow (only generically, for other workflows, and the
mechanism itself is gated behind a flag that defaults off, which the prior evidence didn't surface). FR19 — a
real "two confirms → one row" test at the actual persistence boundary had never been written; the matrix had
also mis-cited which DB constraint does the protecting.

**B. What was changed**: nothing in production code. Two new tests (GAP-A: 1, GAP-B: 2) plus traceability/report
updates.

**C. What did not need changing**: both underlying mechanisms (CI-V2's `runGlobalTurn` early-return; ai-service's
atomic claim; fitness-service's `(userId, sourcePlanId)` unique constraint + check-then-act) already existed and
already worked — confirmed by direct inspection and then by real tests, not assumed.

**D. New tests**: 1 in `agent-workflow-create-workout-plan.test.ts` (GAP-A); 2 in
`ai-workout-grounding.integration.test.ts` (GAP-B sequential + concurrent).

**E. Exact commands**: §11.

**F. Exact results**: §12 — 11/11, 5/5, and a full-suite 779/789 with the identical, already-documented 6
pre-existing environmental failures (zero new failures).

**G. Sequential double-confirm DB evidence**: §7, §13.

**H. Concurrent double-confirm DB evidence**: §8, §13.

**I. Interruption/resume state evidence**: §5, §13 (byte-identical workflow-row snapshot before/after).

**J. Regression results**: §15, §16, §17 — none found.

**K. Remaining limitations**: §19.

**L. Files changed**: §10 (2 test files, 2 docs — no production code).

**M. Verdict**: **READY_FOR_INDEPENDENT_CODEX_BPM_AUDIT**

Both gaps named in Phase 2's NOT_READY_FOR_FROZEN_BPM_BENCHMARK verdict (FR15, FR19) are now
IMPLEMENTED_AND_VERIFIED with real DB evidence. No production code was changed, so none of Phase 2's own
equipment-filtering work was put at risk. The Qwen3 4B frozen benchmark remains untouched and unscheduled by this
phase, as required — Codex's independent audit of this BPM's implementation is the next gate, not the benchmark.
