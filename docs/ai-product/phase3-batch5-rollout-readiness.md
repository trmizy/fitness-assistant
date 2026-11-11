# Phase 3 — Batch 5: Unified AI Coach E2E + Rollout Readiness

**Implementation owner**: Claude Code. **Date**: 2026-10-06. Engineering report. Written in English (matching Batches 1–4).

## 1. Executive verdict

**`UNIFIED_AI_READY_FOR_SHADOW_ONLY`**

- Safety invariants hold in every test we could run against them: no cross-user access, no confirmation bypass, no unauthorized authoritative
  mutation, and truthful downstream failure for the paths touched in this batch.
- Shadow mode is safe to run because it changes no user-visible output.
- Controlled rollout is **not** justified yet. Measured user-facing latency is poor, the typed Qwen fallback accepted a wrong route in both the
  smoke and the live probe, deterministic READ turns still invoked the model, and the live workout-creation journey could not be completed
  because fitness-service crashed during the probe (§10, §19).

Recommendations (§22):
- `CI_V2_DEFAULT_ON_RECOMMENDATION = NO`
- `GYMINI_UNIFIED_AI_COACH_DEFAULT_ON_RECOMMENDATION = NO`

No production default was changed in this batch (§35).

## 2. Feature / flag matrix

Defaults were read from code, not assumed:

| Flag | Code default | Production compose | Dev verification override | Meaning |
|---|---|---|---|---|
| `GYMINI_UNIFIED_AI_COACH` | `off` (`unifiedCoachMode()`, `conversational-intelligence/index.ts`) | not set → `off` | not set → `off` | `off` legacy; `shadow` diagnostics only; `on` enables Batch 3/4 behaviours |
| `CONVERSATIONAL_INTELLIGENCE_V2` | `off` (`ciMode()`) | not set → `off` | `on` | deterministic router and confirmation boundary |
| `CONVERSATIONAL_INTELLIGENCE_V2_LLM` | `off` (`ciLlmAllowed()`) | not set → `off` | `${CI_V2_LLM_FOR_VERIFICATION:-on}` | typed Qwen semantic fallback |

Important: **production currently runs with CI-V2 off** (`CONVERSATIONAL_INTELLIGENCE_V2` unset). The X1–X4 closures therefore do not apply in
production as deployed. See §19.

### Flag combinations exercised

| Combination | Covered by | Result |
|---|---|---|
| A. `UNIFIED=off` | parity tests `revision-route-parity.test.ts` ("flag OFF…"), `bounded-turn-route-parity.test.ts` | pass; byte-identical behaviour per Batch 3/4 reports, re-run in full suite |
| B. `UNIFIED=shadow` | `bounded-turn-route-parity.test.ts` (shadow sets) | pass; no route change, executor not called |
| C. `UNIFIED=on`, `CI-V2=off` | E2E J1, J7, J8, J9, J10 (CI-V2 not set in those tests) | pass; these journeys do not require CI-V2 |
| D. `UNIFIED=on`, `CI-V2=on` | E2E J2–J6 (CI-V2 explicitly on) | pass |

Capability-level dependency on CI-V2 is listed in §3.

## 3. Capability matrix

Evidence labels: **IP** = in-process E2E or unit test (real `fitnessAgent.tryTurn`, real isolated Postgres, external tools/LLM mocked at the
boundary). **LH** = live HTTP probe through the gateway (single run, §13). **SM** = real Qwen smoke (§12). **NT** = not tested in this batch.

| Capability | Works with `UNIFIED=on`? | Requires CI-V2? | Requires LLM? | Authoritative reads | Pending action | Authoritative mutation after confirmation | Fallback on failure | Known limitation |
|---|---|---|---|---|---|---|---|---|
| Workout creation (start) | Yes (IP J1) | No (IP J1 runs CI-V2 off) | Only for ambiguous turns | profile context | yes (draft) | yes via `importAiPlanToSchedule` (IP J1, exactly once) | slot question or honest "could not create" | LH probe: the start request returned "Mình chưa tạo được lịch tập phù hợp lúc này" because fitness-service was unhealthy at that moment (§10) |
| Workout revision | Yes (IP J1) | No | Routing LLM may be invoked (LH: 1 call; misroute, §10) | draft + profile | updates same pending draft | yes, only on confirmation | deterministic revision when clear | Live misroute to `READ_STATE` (LH and SM S3) |
| Workout interruption / resume | Yes (IP J2, CI-V2 on) | Yes (J2 requires CI-V2) | No for the nutrition READ | workflow state + nutrition | workflow state only | yes on confirmation | READ answered, workflow preserved | Depends on CI-V2 |
| Workout active-plan READ | Yes (IP J6, LH "Buổi chân…" returned "no active program" truthfully) | No | Routing LLM may run | `WorkoutProgram` read | no | no | honest "no program" | — |
| Nutrition READ | Yes (IP J5; LH returned degraded text) | Yes for NUTRITION_TARGET topic (J5 sets CI-V2 on) | LH: 1 Qwen call on a deterministic READ (§14) | ACTIVE `NutritionGoal` | no | no | "chưa đọc được" honest failure text | Budget violation (§14); LH read failed while fitness-service was down |
| Nutrition recommendation | NT | — | — | — | — | — | — | Not exercised in this batch |
| Nutrition hypothetical revision | Yes (IP J5) | Yes (J5) | No (deterministic comparison) | ACTIVE goal | no | none (asserted zero mutation) | — | — |
| PT READ | Yes (IP J3; LH "chưa có PT", no mutation) | Yes (J3) | LH: 1 Qwen call on a deterministic READ (§14) | PT relationship | no | none | honest "no PT" | budget violation (§14) |
| PT recommendation | Yes (IP J3) | Yes (J3) | narration only if enabled | candidates from user service | no | none | bounded shortlist | — |
| PT shortlist revision (price, exclusion) | Yes (IP J3) | Yes | no | snapshot | no | none (no PT hire path exists in this flow) | structured reasons | Direct PT hiring is not supported in this flow; batch did not invent it |
| Program recommendation | Yes (IP J4) | No | narration only | candidates | no | none | — | — |
| Program revision (constraint refine, exclusion) | Yes (IP J4) | No | no | candidates | no | none (asserted) | — | No program mutation path exists; not invented |
| General fitness QA | Yes, deferred to normal chat (IP J6) | — | yes, real generation (SM S2: 8.2 s, 173 chars) | none | no | none | **live: 181.9 s, degraded text** (§10) | Latency (§13) |
| Confirmation | Yes (IP J1, J10; remediation tests) | Boundary uses CI-V2 for STATUS/CONFIRM classification | no | `FitnessAgentAction` | consumes pending | yes, exactly once | — | Live confirmation not exercised (no live draft, §18) |
| Cancellation | Yes (remediation suite, dismiss path) | — | no | action | cancels | none | — | — |
| Status / readback | Yes (remediation STATUS assertions) | Yes | no | DB state | no | none | status wording covered by the remediation STATUS assertions | — |

## 4. E2E journey results (in-process, `src/__tests__/unified-ai-coach-e2e.test.ts`)

Ten journeys, all pass in the final run (`UNIFIED=on`, real `tryTurn`, real isolated Postgres, external tools and narration mocked at the
boundary; see the file header). The suite is in-process; **it is not an HTTP E2E**. The equipment-validation tool is a real HTTP call in this
environment; see §19 for the secret defect that made it fail silently in one earlier run.

| Journey | Assertion focus | Result |
|---|---|---|
| J1 workout coach: create → revision → revision → confirm | exactly one authoritative write; no write before confirm | pass |
| J2 cross-domain interruption (nutrition READ mid-workout slot) | workflow state preserved, resumes | pass (CI-V2 on) |
| J3 PT coach: current PT + recommendation → budget revision → exclusion | no PT assignment mutation | pass (CI-V2 on) |
| J4 program coach: recommendation → refine → exclusion | no program mutation | pass |
| J5 nutrition: READ → hypothetical → real-change request | zero mutation; honest "unsupported" for real change | pass (CI-V2 on) |
| J6 general QA + personal context | defers to normal chat; no fabricated facts | pass |
| J7 failure recovery (PT read fails; recommendation engine fails; narration fails) | truthful partial answer; no hallucinated candidates | pass |
| J8 cross-user isolation | B cannot resume/revise/confirm A's workflow or draft | pass |
| J9 stale / revised proposal | only the revised version is ever persisted | pass |
| J10 duplicate confirmation (sequential + `Promise.allSettled`) | one logical action → at most one authoritative mutation | pass |

Terminology (brief §2): all assertions use "zero authoritative business mutation before confirmation"; `fitnessRecommendation`,
`AgentWorkflowSession` and `FitnessAgentAction` rows are AI-internal persistence and are not described as "zero DB writes".

## 5. Cross-domain continuity

Covered by J2 (workout ↔ nutrition READ) and J3/J4 (PT and program interleaving). The workflow-state assertions are on the real `agent_workflow_sessions` row before and after the interruption. Live cross-domain continuity was **not** exercised end-to-end (§18).

## 6. Revision continuity

J1 exercises draft evolution across two revisions on the same pending draft. J9 asserts that a superseded version cannot be confirmed. Live
revision continuity is weaker: the live probe's revision turn was routed to `READ_STATE`, not to the pending revision path (§10).

## 7. Confirmation and persistence safety

- Confirmation endpoints require the real action id and user scope (`fitness-agent.service.ts`, owner-scoped conditional update; Batch 4 §12).
- Remediation suite: 35/35 pass after this batch's fix (§19). Confirmation and status classification are covered by the existing confirmation-boundary and remediation tests, which run in the full suite. They were not re-executed as a separate phrase matrix in this batch (the X4 matrix from earlier batches is the dedicated evidence). No change to confirmation semantics was made.
- Equipment gate: draft-time validation **fails open** (`fitness-agent.service.ts` `applyEquipmentFiltering`: a thrown validation call returns the unfiltered draft). Confirm-time validation (`importAiPlanToSchedule` → `validateAiPlanExerciseEquipment`, fitness-service `workout.service.ts` ~2395) is the hard backstop and was verified in code. Consequence: a preview can show equipment-incompatible exercises when the validator is down; nothing incompatible is persisted. Recorded as a known limitation, not changed (scope).

## 8. Cross-user isolation

J8 (in-process, real DB) and the remediation suite assert the cross-user invariants. Live cross-user HTTP testing with two authenticated users was **not** run in this batch (§18). Code evidence: every workflow, action and recommendation lookup is scoped by `userId` (Batch 4 §12; `tryConfirmationBoundary` findFirst by `userId` and `sessionId`).

## 9. Unsupported-capability UX

Tested in J5 (real NutritionGoal change → honest unsupported, no fake pending action, no silent mutation). Batch 4 §19 items (permanent exercise
swap, arbitrary calorie override, `ADD_EQUIPMENT` from chat) remain unsupported by design; no write path was added. Live evidence for these was
not collected.

## 10. Failure recovery (including live probe)

Live probe (`results/product/ai-phase3-batch5/live-turn-latency.json`, gateway → ai-service, real users, single run):

| Turn | HTTP | Outcome | Truthful? |
|---|---|---|---|
| Weight READ | 200, 1.27 s | "95kg (theo hồ sơ)" from the real profile | yes |
| Workout create (start) | 200, 249 ms | "Mình chưa tạo được lịch tập phù hợp lúc này" — fitness-service was returning 503 for exercise lookups at that moment | yes (honest failure), but the journey did not complete |
| Revision "Buổi chân hơi nặng." | 200, 3.97 s | "Hiện bạn chưa có chương trình tập nào…" — routed to `READ_STATE/PROGRAM_STATUS` by Qwen (accepted) | answer truthful; **route wrong** |
| PT READ | 200, 103 ms | "Hiện bạn chưa có PT nào… mình sẽ không tự đăng ký" | yes |
| Nutrition READ | 200, 63 ms | "Mình chưa đọc được mục tiêu dinh dưỡng của bạn lúc này" — read failed | yes (honest), not success |
| General QA | 200, **181.9 s** | Degraded fallback text — see defect D2 (§19) | yes after fix; wording was misleading before fix |

Failure classes exercised by tests: profile missing, upstream unavailable (503), authorization (401/403), unexpected error (500, non-HTTP).
Expected behaviour is implemented and tested; see §19 (D1) for the defect that broke it.

## 11. LLM call budget

Target (Batch 3/4 discipline): deterministic slot/correction/reference 0 semantic calls; revision planning 0 calls when deterministic; multi-intent
planning 0 calls; general QA expected.

Observed in the live probe (per-turn Ollama access-log count, `/api/chat` or `/api/generate`):

| Turn | Qwen calls | Target | Status |
|---|---|---|---|
| Weight READ | 0 | 0 | meets |
| Workout create (start) | 0 | 0 | meets |
| Revision "Buổi chân hơi nặng." | 1 | 0 when deterministic | **violation** (routing fallback ran; the phrase was not deterministically placed) |
| PT READ | 1 | 0 for deterministic read; narration only if enabled | **violation** (cause not isolated; one call) |
| Nutrition READ | 1 | 0 | **violation** (cause not isolated) |
| General QA | 2 (one 82 s cold load, one 170 s timeout) | expected | expected, but latency unacceptable |

Not added: no telemetry-only model calls were introduced in this batch.

## 12. Qwen3 4B smoke evidence

Script: `backend/services/ai-service/src/scripts/unified-coach-qwen-smoke.ts` (not part of the automated suite). Exact tag verified installed
(`qwen3:4b-instruct-2507-q4_K_M`, digest `0edcdef34593`). Run: `LLM_PROVIDER=ollama`, real Ollama on `localhost:11434`.

| Scenario | Latency (single run) | Calls | Result |
|---|---|---|---|
| S1 health | 65 ms | 0 | `llmAvailable: true` |
| S2 general QA | 8.2 s (warm; 82.8 s on the first, cold run) | 1 | real answer, 173 chars, 26 prompt / 43 completion tokens |
| S3 ambiguous revision through the typed semantic router | 2.5 s | 1 | **accepted route `READ_STATE/PROGRAM_STATUS`** for a revision utterance — wrong, and accepted |
| S4 malformed/timeout fallback | not run here (kept separate, per brief §30) | — | — |

Interpretation: the fallback pipeline accepts a plausible-but-wrong read route without a guard. The route is read-only, so no mutation resulted,
but it is a wrong answer. This is a model-quality and guard-design finding, not a claim about Qwen3 4B accuracy.

## 13. Latency measurements

Single run per turn, live stack (dev containers, CPU-only Ollama). No p50/p90 claim: repetitions were not run in this batch.

| Path | Latency | Qwen calls | Upstream calls |
|---|---|---|---|
| Deterministic READ (weight) | 1.27 s (includes first-turn warmup) | 0 | not counted |
| Workout start | 249 ms | 0 | not counted |
| Revision (routing fallback) | 3.97 s | 1 | not counted |
| PT READ | 103 ms | 1 | not counted |
| Nutrition READ | 63 ms | 1 | not counted |
| General QA (Qwen) | 181.9 s | 2 (1 timeout at 170 s) | not counted |
| Qwen smoke S2 (warm) | 8.2 s | 1 | — |

In-process E2E durations (mocked externals) are 80–360 ms per journey and are not product latency.

Upstream request counts were **not measured** (no per-turn counter exists). This is an observability gap (§15).

## 14. Request-count measurements

Qwen request counts are in §11. Upstream HTTP counts (user, fitness, PT) were not instrumented in this batch.

## 15. Observability coverage

Present: structured logs with a correlation id (`ci_global_trace`, `ci_global_llm_route`, `ci_v2_turn`, `ci_confirmation_boundary`), each with
route/topic/workflow fields and no message text or profile values (code comments). Missing for rollout: per-turn upstream call counts, a single
turn record linking route, bounded composition, revision target, reads used, model calls, pending action, confirmation outcome and latency, and
any metrics dashboard. Batch 5 did not add telemetry (§40 forbids telemetry-only model calls; adding log fields was not needed to answer the
questions above).

## 16. Off-mode parity

Covered by the parity suites (`revision-route-parity`, `bounded-turn-route-parity`, `ai-chat-full-verification` scripts from earlier batches).
All pass in the final full run. The defect fixes in §19 touch the profile-read error path only when a profile-read error occurs, and the
orchestrator fallback text only when the LLM is unavailable; neither changes the normal `off`-mode answer.

## 17. Shadow-mode behaviour

`shadow` computes the bounded-turn plan and logs it; the executor is never called, so the visible answer is identical to `off`
(`bounded-turn-route-parity.test.ts`, passing). Shadow mode does not invoke the executor (verified by the parity test). Whether it adds model calls was not measured in this batch. It is intended for staging diagnostics.

## 18. Full regression results

Command: `LLM_PROVIDER=mock`, `DATABASE_URL`/`AI_DATABASE_URL` pointed to the isolated test database `gymcoach_ai_test` (port 55433), `NODE_ENV=test`,
`DEBUG_AI_PLAN=true`, and `INTERNAL_SERVICE_SECRET` set to the value used by the running verification stack (not printed here).

| Run | Tests | Pass | Fail | Skip |
|---|---|---|---|---|
| Batch 4 baseline (as reported) | 892 | 882 | 6 | 4 |
| Batch 5 — initial run, default `.env` (dev DB) | 908 | 892 | 12 | 4 |
| Batch 5 — final run, isolated test DB | 910 | 901 | 5 | 4 |

Final failing tests and classification:

| Test | Classification |
|---|---|
| `ollama chat payload is unchanged` | Known drift: test pins `llama3.2:3b`; configured model is `qwen3:4b-instruct-2507-q4_K_M` (baseline failure) |
| `ollama health still requires both local models` | Same drift (baseline failure) |
| `adoptPlan: rejects … invents an exercise` | **Unexplained flip.** Mechanism: the test does not stub `validateMarketplaceSchedulesMappable`, so it calls live fitness-service to map exercise ids; the 422 comes from that check (`marketplace.service.ts` ~706) before customization is validated. Passed 11/11 once, failed afterwards with the same code. Not a Phase-3 change; not fixed (scope). |
| `adoptPlan: rejects … leaves a day with zero exercises` | same |
| `adoptPlan: rejects … wrong number of days` | same |

Baseline comparison: the three equipment persona tests and the `selection wording` test that failed under the Batch 4 run pass in this run,
but the runs used different environment settings (see §19), so this is not a like-for-like comparison.

## 19. Defects found and fixed / found and not fixed

### Fixed in this batch

**D1 — Reader catch-all turned authorization and unexpected failures into successful answers.**
- Reproduction: `conversational-intelligence-remediation.test.ts` — 401/403 and 500 from the profile read produced HTTP-successful text answers;
  five tests failed (`AUTHORIZATION failure`, `UNEXPECTED upstream failure`, `profile MISSING`, `upstream UNAVAILABLE`, `X1`).
- Cause: `readState()` in `conversational-intelligence/global/readers.ts` (uncommitted Batch 1 work) had `catch {}` returning a generic
  "Mình chưa đọc được dữ liệu…" answer for every rejection, including authorization failures and errors not produced by the profile read.
- Fix: 401/403 are rethrown; profile-read errors use `profileFailureAnswer` (guidance for known conditions, rethrow otherwise); for the
  `GOAL` / `PROFILE_FACT` topics any unclassified error is rethrown. Other readers keep the degraded text.
- Test: `conversational-intelligence-remediation.test.ts` — 35/35 pass.

**D2 — False "InBody" claim in the AI-unavailable fallback.**
- Reproduction: live probe, general question "Progressive overload là gì?" returned "…Tôi đã ghi nhận yêu cầu phân tích InBody của bạn…".
- Cause: `buildAiUnavailableFallback` (`llm/orchestrator.service.ts`) returned one fixed Vietnamese text for every unavailable turn.
- Fix: the text now says only what is true (no answer produced; nothing recorded or changed). The builder is exported for testing.
- Test: `unified-ai-fallback-truthful.test.ts` — 2/2 pass. Note: the running dev container must be restarted to serve this change.

### Found, not fixed (outside Phase-3 AI scope or requires a decision)

**N1 — fitness-service crashes on a Redis socket error (P1 reliability; gap G-19).** `backend/services/fitness-service/src/repositories/redis.ts`
creates a Redis client with no `error` listener. A Redis timeout (`ETIMEDOUT`) during the probe was an unhandled `error` event and the process
exited; fitness-dev reported `unhealthy` until restarted. Tracked, unmodified file. Outside the AI scope, so not changed here.

**N2 — Qwen routing accepts a wrong read route (AI quality).** Smoke S3 and live revision turn both accepted `READ_STATE/PROGRAM_STATUS` for a
pending-draft revision. Guard design (typed route acceptance) needs a decision.

**N3 — Deterministic READ turns invoke the model.** Live: PT READ and nutrition READ each made one Qwen call (§11). Cause not isolated in this batch.

**N4 — Draft-time equipment gate fails open** (§7). Confirm-time backstop holds.

**N5 — Test-environment safety defect (affects every local suite run before this batch).** `backend/services/ai-service/.env` sets
`DATABASE_URL` to `localhost:5433/gymcoach_ai`, which is the **dev** database (`gymcoach-postgres`), not the isolated test database. Suite runs that
load `.env` therefore connect to dev data. Read-only check of the dev database after the runs: no residual rows from test users were found, but
this does not prove that no writes occurred. The `.env` also has no `INTERNAL_SERVICE_SECRET`, so any test calling fitness-service sends an empty
secret and receives `401`; one run's equipment-tool calls failed this way silently. The equipment persona tests also need `DEBUG_AI_PLAN=true`
and `NODE_ENV=test`. Later runs in this batch used the isolated test database with all of these set.

**N6 — `adoptPlan` tests depend on live fitness-service** (§18).

**N7 — Ollama tests pin an obsolete model name** (§18).

## 20. Remaining limitations

- The E2E suite is in-process with boundary mocks. HTTP-level, browser-level and cross-user HTTP E2E were not run in this batch.
- Live workout creation did not complete (fitness-service outage during the probe); live confirmation and live duplicate-confirm were not exercised.
- Latency figures are single runs on a CPU-only host. No production SLA can be stated from them.
- Route accuracy of Qwen was observed on one utterance and one smoke prompt. It is not a benchmark result.
- Upstream request counts and a per-turn record are not instrumented.
- The equipment gate is fail-open at draft time (§7).

## 21. Controlled rollout plan (for later, not authorized by this batch)

Stage 0 — `off` (current production state).
Stage 1 — `UNIFIED=on` in internal/dev only, with CI-V2 explicitly configured; verify with the probe in `results/product/ai-phase3-batch5/`.
Stage 2 — `UNIFIED=shadow` in staging: collect diagnostics; no user-visible change.
Stage 3 — controlled, opt-in enablement for a small set of accounts (config-based, since no percentage rollout exists in this application).
Stage 4–5 — broader enablement and default-on only after the blockers below are closed.

Blockers before any controlled rollout (must all be closed):
1. N1 Redis error handling in fitness-service (no crash on Redis error).
2. N2 typed route acceptance guard for READ/WRITE mismatches on revision turns, or a product decision to accept them.
3. N3 root-cause and eliminate model calls on deterministic READ turns.
4. Latency: a turn budget below the client timeout with a deterministic fallback; current worst case is 181.9 s (§10). See the Qwen latency budget in the runbook.
5. Live HTTP evidence for J1 (workout create → revision → confirm), cross-user, and duplicate-confirm.
6. N5 test-environment isolation (test runs must not load dev `DATABASE_URL`).
7. Stale or environment-dependent tests (N6, N7) classified and fixed or quarantined.

## 22. Default-on recommendations

- `CI_V2_DEFAULT_ON_RECOMMENDATION = NO` — CI-V2's typed fallback produced a wrong accepted route in both the smoke and live probe, and deterministic
  READ turns invoke the model. Evidence: §10, §11, §12.
- `GYMINI_UNIFIED_AI_COACH_DEFAULT_ON_RECOMMENDATION = NO` — the unified path depends on CI-V2 for several capabilities (§3), the live workout
  journey did not complete, and latency is unacceptable on the measured host. Evidence: §3, §10, §13.

No default was changed in this batch (§35).

## Final response summary (per brief §41)

- **A. Architecture**: unchanged from Batches 1–4; no new router, orchestrator or framework was introduced.
- **B. Capability matrix**: §3.
- **C. Flag/dependency matrix**: §2.
- **D. E2E journeys executed**: §4 (in-process, 10 journeys) and §10 (live HTTP probe, six turns).
- **E. Exact results**: §18 (910 tests, 901 pass, 5 fail, 4 skip) and §10.
- **F. Confirmation safety**: §7.
- **G. Exactly-once**: J1 and J10 (in-process). Not verified live.
- **H. Cross-user**: J8 (in-process). Not verified over HTTP.
- **I. Failure recovery**: §10, §19 (D1 fixed).
- **J. Unsupported capabilities**: §9.
- **K. LLM call counts**: §11.
- **L. Qwen3 4B smoke**: §12.
- **M. Latency**: §13.
- **N. Observability**: §15.
- **O. Off-mode parity**: §16.
- **P. Shadow mode**: §17.
- **Q. Full regression**: §18.
- **R. Defects**: §19 (D1, D2 fixed; N1–N7 open).
- **S. Limitations**: §20.
- **T. Controlled rollout plan**: §21.
- **U. CI_V2_DEFAULT_ON_RECOMMENDATION**: NO.
- **V. GYMINI_UNIFIED_AI_COACH_DEFAULT_ON_RECOMMENDATION**: NO.
- **W. Final verdict**: `UNIFIED_AI_READY_FOR_SHADOW_ONLY`.

---

## Erratum (added during R1, 2026-10-06)

Historical sections above are kept as written. The following corrections apply:

1. **§11 and §13 per-turn Qwen counts for PT READ and Nutrition READ are wrong.** The probe attributed model calls by `--since` only, with no
   upper bound and a ±500 ms edge. A call that ended just before a turn was counted in that turn. Corrected attribution (call start time within
   the turn's own window) shows **0 model calls** for both PT READ and Nutrition READ. The revision-with-no-draft turn is the only deterministic-path
   turn that reached the model. See `phase3-rollout-r1-routing-llm.md` §3.
2. **N3 is a measurement error, not a routing gap.** The deterministic classifier already resolved those phrases to READ_STATE.
3. **N2 root cause (§19) is confirmed**: the topic-evidence rule for `PROGRAM_STATUS` matched the bare word `buổi`. Fixed in R1 (§5 there).
4. **General QA latency (§19)**: 181.9 s was measured with a 170 s verification timeout and a warm-up-dependent path. R1 bounds the same turn at ~47 s, but general
   QA then returns the fallback on this CPU host (R1 §15).
