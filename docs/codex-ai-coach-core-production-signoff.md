# CODEX - AI COACH CORE PRODUCTION SIGN-OFF

Verification: 2026-09-19, completed after resume on 2026-09-20 (Asia/Saigon). HEAD `96c1040f` plus the current uncommitted finalization changes. Scope is the requested action-lifecycle closure, not another architecture review or certification of a deployed environment.

## Decision

**GO WITH DOCUMENTED LIMITATIONS**

**CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 0** in the targeted verification. The previous confirm-versus-dismiss finding is closed. Core product sign-off is granted within the tested scope; live deployment/provider/browser verification remains outstanding.

Production files modified by Codex: **NONE**. Added this report and `test/codex-ai-coach-core-production-signoff/` evidence. Running the unchanged foundation evaluator refreshed its existing generated result JSON. Previous reports and unrelated worktree changes were preserved.

Read the previous core sign-off, final product remediation and finalization-race closure reports. Audited current execute/dismiss/claim/reclaim paths, pending routing, stable import identities and downstream uniqueness. Code and executed evidence take precedence over claimed test counts.

## Atomic action ownership

PASS. `fitness-agent.service.ts:734` claims confirmation with one `updateMany` constrained by action ID, user ID and PENDING, setting EXECUTING and `result.executingSince`. Ownership requires `count === 1` before invoking any business branch.

`dismissDraft` (`:1843`) competes on the same PENDING predicate, setting CANCELLED. It reports successful cancellation only after winning, or when the subsequent state is already cancelled. A losing request rereads state and truthfully reports EXECUTING or COMPLETED. The preliminary SELECT checks authorization/eligibility; it is not relied upon to win ownership.

No DB transaction is held open across the business HTTP call. The status column is String, so EXECUTING requires no enum migration. The foundation architecture was not reopened.

## Workout confirm-wins

PASS. The real-DB test pauses the controlled external import after confirmation claims EXECUTING. Dismiss reports that saving is in progress and cannot be cancelled; it does not say nothing was saved. One import invocation, final COMPLETED. Late dismissal reports already saved.

## Workout dismiss-wins

PASS. Dismiss first claims CANCELLED; subsequent confirm rejects before import. Zero import invocations, final CANCELLED.

## Nutrition confirm-wins

PASS. With the nutrition save response held in flight, status is EXECUTING, dismissal cannot cancel, one save invocation succeeds, final COMPLETED.

## Nutrition dismiss-wins

PASS. Dismiss first -> CANCELLED; confirmation rejects; zero save invocations.

## Stress race

PASS. Executed the inspected `agent-workflow-finalization-race.test.ts`: **25 concurrent confirm/dismiss rounds per kind, 50 total**. Each round asserts one ownership direction, zero or one downstream invocation, final state consistent with outcome, and no contradictory successful dismissal response.

These are concurrent requests in one Node process against real AI-service DB rows. External context/catalog/save boundaries are controlled fixtures. They are not multi-process deployment, real fitness writes, or browser race tests. The conditional DB transition, rather than a process-local lock, is the ownership mechanism.

## Double confirm

PASS for both kinds. While the first request owns EXECUTING, the second rejects as already executing. Only one downstream call occurs. Later completed replay succeeds without another call.

## Double dismiss

PASS for both kinds. Concurrent dismiss requests result in one cancellation with coherent idempotent responses. No resurrection.

## Completed replay

PASS. COMPLETED returns its stored result before claim or business execution. The independent reclaim probe also replayed completion and observed no new downstream invocation.

## Cancelled terminal

PASS. Both draft kinds reject stale confirmation before business calls. The failed-nutrition-job auto-CANCELLED case and cross-turn routing exclusion remain covered by the passing workflow suites.

## Expiry

PASS. Expired PENDING actions reject before claiming/executing. EXECUTING recovery follows its separate stale-marker policy; it is not blocked solely because the original PENDING expiry elapsed. COMPLETED replay retains existing idempotence semantics.

## Business failure recovery

PASS for both draft kinds. Forced external failure after claim returns a truthful failure response, restores PENDING and does not record fake COMPLETED. A subsequent retry succeeds and finishes COMPLETED. Pre-write exceptions also release the claim before propagating.

These fixtures model a definite failure, not an ambiguous remote timeout after a remote commit. Stable downstream identity is the recovery protection for retry after an uncertain result; no exactly-once distributed transaction is claimed.

## Stale execution reclaim

PASS for requested crash-recovery cases. Threshold is two minutes. Fresh EXECUTING is neither reclaimable nor dismissible. Reclaim uses one conditional update matching ID, user ID, EXECUTING and the exact JSON marker previously read (`fitness-agent.service.ts:745`), replacing the marker only when one row matches.

Added and executed an independent probe, `reclaim.ts`, for BOTH kinds: seed a fresh execution row, reject premature execution, age its marker, run two concurrent reclaimers, hold the winning business response until the other request rejects, then complete and replay. **One downstream invocation per kind**, one successful reclaimer, final COMPLETED. A foreign user's confirm/reclaim and dismiss are rejected before calls.

Stable identity was asserted at the tool boundary: workout uses the same action ID as sourcePlanId; nutrition uses the same backing nutrition-plan ID. Fitness-service checks existing `(userId, sourcePlanId)` programs, with database uniqueness for both WorkoutProgram (`schema.prisma:556`) and NutritionProgram (`:1297`). This pass audited downstream reuse/uniqueness; it did not repeat real fitness-DB import/replay after the database became unavailable.

Recovery evidence concerns a stale/crashed owner, not a full distributed lease proof under process suspension or large clock skew. Completion/release currently predicate on EXECUTING, not on the generation marker. A late original owner resuming after takeover was not tested; do not interpret these results as generation-fenced recovery or arbitrary-failure exactly-once guarantees. No reachable failure in the requested normal/reclaim cases was reproduced.

## Cross-user isolation

PASS. The existing ownership test rejects another user's confirm/dismiss on PENDING. The independent probe also rejects foreign confirm/reclaim and dismiss on stale EXECUTING. Claims/reclaims include userId and execute/dismiss validate session ownership. No ownership regression observed.

## Pending-routing exclusion

PASS. `routePendingDraftTurn` selects only PENDING rows. Existing revision lookups likewise select PENDING; an EXECUTING workout receives no revision in the test. Execution-owned rows are not picked as editable pending drafts.

## Foundation evaluator

**30/30 PASS**, unchanged evaluator executed before interruption on September 19. Evidence: `foundation.txt` and generated `conversational-workflow-evaluation-2.json` timestamp `2026-09-19T16:08:37.187Z`. Foundation remains SIGNED OFF. No foundation redesign performed.

## Workflow regression

**118/118 PASS, zero skips/failures**, completed before interruption. Includes all agent-workflow suites, 7 processor-exclusion tests and 20 slot-parser tests; the new race suite contributes 15 tests including 50 race iterations. Evidence: `workflows.txt`.

The prior accumulation, unsupported-exclusion, target validation, routing, injury warning, exercise exclusion and weekday sanity cases remain green in this executed set. Old probes that intentionally assert former defects were preserved as historical evidence, not rerun as current acceptance tests.

## Nutrition target regression

On resume, attempted all 20 target/bootstrap tests against configured isolated `gymcoach_fitness_test`. Actual result: **10 engine tests PASS, 10 DB integration tests FAIL due to unavailable localhost:5433**, not assertion mismatches in target calculations. Docker Desktop's Linux-engine pipe was also unavailable. Evidence: `targets.txt`.

This is an environment-blocked rerun, NOT a fresh 20/20 pass. The preceding targeted sign-off recorded 20/20 before the environment interruption; this closure changes action lifecycle, not target/bootstrap logic. The passing 118-test set independently retains the AI-side target forwarding/revalidation checks. Restore the local DB for the remaining target integration rerun in the next verification phase.

## PT regression

The foundation evaluator's PT flow passed before interruption. After resume, the broader focused invocation had DB-dependent fitness-agent failures because localhost:5433 was unavailable. It is not represented as a clean full PT integration run. No ranking changes or production PT transactions were performed.

## Program v2 regression

Focused offline scoring/claims/narrator/invariant/memory rerun: **136/136 PASS**. Evidence: `offline-regressions.txt`.

The broader invocation actually selected **172 tests**, not 175: **155 PASS / 17 FAIL**, with DB-dependent failures traced to the same unavailable PostgreSQL server. Evidence: `regressions.txt`. These failures are disclosed environment gaps, not claimed passes or evidence of a reproduced lifecycle regression.

## Memory regression

Memory extraction/policy passes in the 136-test offline set. Foundation provenance checks passed in 30/30 before interruption. No new durable-memory behavior was introduced by the lifecycle closure; provenance architecture remains signed off.

## Builds

Reran all builds after resume to obtain completed results:

- ai-service `npm run build` / tsc: PASS.
- fitness-service `npm run build` / tsc: PASS.
- frontend/web `npm run build` / Vite: PASS, 6122 modules. Non-blocking large-chunk warning remains.
- `git diff --check`: PASS.

No production edits were needed. All sessions started after resume finished. Pre-interruption test completion is backed by the saved workflow/foundation logs, not inferred from unavailable process handles.

## Remaining findings

CRITICAL: **0**

HIGH: **0**

MEDIUM: **0 reproduced in the targeted scope**

LOW: **0 counted**

INFO:

- PostgreSQL/Docker became unavailable across the interruption. Target integration and 17 focused DB tests need an environment-restored rerun; their failed attempts are preserved.
- Live BullMQ/provider generation, authenticated browser/mobile E2E, equipment integration environment and deployment rehearsal remain unexecuted here.
- Concurrency evidence is real-row, single-process with controlled business boundaries; multi-replica and uncertain remote outcomes remain deployment verification work.
- Stale-owner recovery limitations are explicitly bounded in the reclaim section. This is not a universal distributed-systems safety certification.
- Accepted prior product limits (workflow-local dietary preferences, generated-workout warnings, unsupported targeted meal/superset operations) are unchanged.

The prior medium confirm/dismiss defect is closed. Environment gaps do not initiate another core hardening cycle under the user's sign-off rule.

## Capability matrix

| Capability | Status |
|---|---|
| ROADMAP | SIGNED OFF |
| ROADMAP REVISION | SIGNED OFF |
| STANDALONE WORKOUT | SIGNED OFF |
| WORKOUT REVISION | SIGNED OFF |
| FIND_TRAINING_PROGRAM | SIGNED OFF |
| PT SEARCH | SIGNED OFF |
| PT HIRE | SIGNED OFF |
| STANDALONE NUTRITION | SIGNED OFF |
| NUTRITION REVISION | SIGNED OFF |

These are core capability decisions within previously accepted scope, not assertions that production/provider/browser deployment testing is complete.

## Original supervisor scenario

| Scenario | Verdict |
|---|---|
| Tạo lộ trình | YES |
| Tạo lịch tập | YES |
| Tìm PT | YES |
| Thuê PT | YES |
| Tạo kế hoạch dinh dưỡng | YES |

## Is Gymini now an end-to-end conversational AI Coach for the target scenario?

**YES at the core product level, with the documented verification limitations.** Do not describe this as a successful live authenticated deployment journey: that remains the next phase.

## Next phase

**STOP AI COACH CORE DEVELOPMENT.**

1. Restore local DB/runtime dependencies and rerun the environment-blocked regressions; verify live BullMQ/provider generation.
2. Run authenticated browser/mobile E2E.
3. Complete CI and deployment verification, including multi-replica recovery behavior where applicable.
4. Rehearse production/demo journeys.
5. Clean up documentation, preserving historical audit evidence.
