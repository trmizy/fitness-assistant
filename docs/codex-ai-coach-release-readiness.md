# CODEX — AI COACH RELEASE READINESS

Independent verification: 2026-09-20, Asia/Saigon. Production files modified by Codex: **NONE**. No commit, reset, deployment, or production migration performed. Evidence is under `test/codex-ai-coach-release-readiness/`. Previous reports and unrelated concurrent work were preserved.

Read Claude's production/demo report, the previous Codex core sign-off, and finalization-race closure. This is release verification, not a redesign. One current database-backed bootstrap failure was reproduced; the action-lifecycle architecture was not reopened.

## Verified tree / SHA

**DIRTY TREE WITH VERIFIED FINGERPRINT**, not an immutable release SHA.

- HEAD: `96c1040f8420cc121fb10b8900b7da4c509133b0`.
- Reconstructed product tree: **`6c40f6409329c485ad549ea9a09b7f104452678d`**, exactly matching Claude's claim, both before and after verification.
- 35 selected changed/untracked product/test/doc files, staged only into a separate temporary Git index. The user's index was not changed.
- Independent raw-content SHA256: `b662aab39978b4f8af67e29d2d0dadc2a48090b4e7c05244342052e2462e5f97`, using sorted path + NUL + raw file bytes + NUL. Claude's `5546b1e677e92c24` prefix is **not independently reproduced**; its serialization recipe was not supplied. It is not interchangeable with this digest. The Git tree match is independently verified.
- `tree.json` records exact membership and classification: production TypeScript/React, tests, CI, docs, generated evaluator output, Codex evidence, and unrelated AWS/data-migration/InBody work.
- CI changes and `test/ai-coach-production-readiness/` are audited separately; they are not bound by the quoted 35-file product tree. They must be included in the eventual immutable release candidate.

Reproduce fingerprint: `node test/codex-ai-coach-release-readiness/verify.mjs --tree`.

## Core regression

Executed against the official isolated databases. Commands and exact suite membership are in `verify.mjs`; stdout/stderr are retained in the corresponding text files.

| Gate | Claude | Independent result |
|---|---:|---:|
| Workflow, exclusion, parser, finalization race | 118/118 | **118/118 PASS** |
| Foundation evaluator via actual CI helper | 30/30 | **30/30 PASS** |
| PT/Program, invariants, claims/narrator, memory selected globs | 175/175 | **172/172 PASS**; membership differs, not a claimed 175-case rerun |
| Fitness targets/bootstrap/engine/equipment/apply | 30/30 | **29/30**, bootstrap concurrency failure |
| User PT contract / ClientJourney idempotency | 6/6 | **6/6 PASS** |

**The zero-unexplained-failures requirement is not met.** The original fitness failure was not discarded after a passing rerun.

The bootstrap file alone subsequently passed 6/6. Independent `bootstrap-race.ts`, using the same profile fixture and the real production bootstrap/repository functions against the isolated migrated fitness DB, then reproduced **11 rejected calls out of 300 calls (30 rounds of 10)**. Errors are Prisma `P2010`, PostgreSQL `23505`, duplicate `user_id`. Every round retained one ACTIVE cycle and one ACTIVE goal; uniqueness protection worked, but some callers failed.

Root cause boundary: `nutrition-onboarding-bootstrap.service.ts:248` performs a race-check SELECT, then `:253` calls `upsertGoal`; `nutrition.repository.ts:168` updates the current ACTIVE goal and inserts another ACTIVE row in a transaction, without serializing/reconciling competing first-time creators. The partial unique index rejects a losing INSERT. `internal.controller.ts:507` invokes this same bootstrap function and catches failure as HTTP 500. The probe replaces profile/queue/notification dependencies, not the SQL, repository, or bootstrap control flow. It is not an authenticated HTTP test.

This is a **current reachable bootstrap runtime defect**, not merely provider downtime. There is no claim that the latest action-lifecycle patch introduced it; no historical clean-tree bisection was performed. Return only this narrow defect to the code owner, not the signed-off architecture.

## Environment DB

Actual running services: isolated Postgres `localhost:55433`, Redis `localhost:56379`, both healthy. No test was pointed at dev Postgres `5433`. Test schemas: `gymcoach_ai_test`, `gymcoach_fitness_test`, `gymcoach_user_test`.

Independently queried migration ledgers: AI **25 finished / 0 unfinished**, fitness **53 / 0**, user **43 / 0**, excluding rolled-back records. Verified live unique indexes described below. This corroborates the existing migrated test environment; it does not prove a fresh deployment or migration from every prior release. No `db push` used by this verification.

Fixtures use synthetic users and harness cleanup. The multiprocess harness uses its explicit test recorder tables. The unchanged evaluator refreshed its generated result JSON.

## Plan-generation-equipment finding

Claude's original **"Failed to load exercise catalog" did not reproduce** with isolated DBs, matching test internal secret, local Ollama, Redis 56379, and the suite launched from `backend/services/ai-service`.

First independent run: **0/3**, but all three worker jobs loaded the real fitness catalog and completed generation. All three assertions failed at test line 260 because `candidateExerciseIds` telemetry was absent. This reproduced failure is **HARNESS/CONFIG**, not an equipment-generation defect: the assertion requires `DEBUG_AI_PLAN=true`, and the worker emits this field only under that flag (`ai.worker.ts:1367`).

Second run, same suite with `DEBUG_AI_PLAN=true`: **3/3 PASS**. Jobs 23-25 exercised real catalog HTTP, generation, deterministic repair/final equipment validator, and persistence. Bodyweight, home gym, and commercial gym all passed. Evidence: `equipment.txt`, `equipment-debug.txt`.

The historical catalog failure's exact cause remains unproven; the current production path works in the tested configuration. Do not retrospectively invent its cause. The local small model needed format repair in some runs; this is not configured-provider certification.

## Live BullMQ

Audited and executed the existing live harness. REAL: `fitnessAgent.tryTurn/execute` code, isolated Redis/BullMQ, worker, processor, Ollama HTTP, real fitness Express test server/internal-secret middleware, real food catalog, AI DB and fitness DB.

STUBBED: user-service profile, agent context and InBody routes. The caller identity is injected directly into service methods. External AI HTTP/auth/gateway/session verification is bypassed. The nutrition worker is in-process in this harness, whereas recovery uses child worker processes. Optional profile data in recovery is unavailable because that harness does not launch the user stub.

The harness is an observation script, **not a reliable pass/fail gate**: a FAILED nutrition plan can produce exit code 0. Inspect emitted plan status, not just process status.

## Provider verification

**BLOCKED — CONFIGURED PROVIDER NOT VERIFIED.** `http://127.0.0.1:11435/api/tags` returned `ECONNREFUSED` again at the end of verification. No claim is made about remote model quality or availability beyond this failed tunnel endpoint.

Executed substitute: local Ollama `qwen2.5:1.5b` on 11434, hardcoded by the harness. It is not the intended qwen3:30b through 11435 and has not been accepted as a demo provider by the user.

Dead-provider test on deliberately closed port 11999: health unavailable; honest Vietnamese unavailable response; **0 nutrition actions, 0 nutrition plan rows**. No fake generation. Evidence: `dead-provider.txt`.

## Nutrition live journey

Two independent local-model attempts:

| Observation | Attempt 1, job 18 | Attempt 2, job 26 |
|---|---|---|
| Accumulated exclusions | fish + beef | fish + beef |
| Authoritative target | 1992 kcal / P128 / C246 / F55 | same |
| Queue latency | 157 ms | 145 ms |
| Generation observation interval | 16,076 ms | 8,043 ms |
| Total harness latency | 16,332 ms | 8,280 ms |
| Final plan / job | FAILED / completed | FAILED / completed |
| Invariants | fat and calorie mismatch | fat and calorie mismatch |
| Preview | not shown | not shown |

Polling interval affects these latency measurements; they are not precise model-only latency. Attempt 1 had fat around 87 g against 55 g; attempt 2 around 82 g. Invalid output was rejected with an honest failure response. **No successful final-plan exclusion proof, live revision, save, or replay was reached in these two attempts.** Claude's earlier successful journey remains prior evidence, not independently reproduced success.

Processor diagnosis: real catalog + deterministic processor, six combinations of exclusions and default/authoritative targets. Original food template: **1/6 invariant passes**; lean template: **6/6 passes**. Target metadata remained correct. This supports template/food-selection sensitivity rather than wrong target authority; it does not prove the processor is universally adequate or establish a historical baseline. Default and authoritative targets can both fail with fatty choices. No production generation changes made.

Unsupported constraint probe: first turn with fish + spicy exclusion asks the missing meal-count question; after supplying `4 bữa`, it explicitly refuses to guarantee the spicy exclusion. **0 plan rows, 0 nutrition actions, no change in any BullMQ job-count category** (active/waiting/delayed/completed/failed/etc.). Evidence: `unsupported-complete.txt`. Refusal occurs after slot completion, not on the initial incomplete turn.

## BullMQ recovery

Executed `bullmq-recovery.ts`. Job **19**, plan `ffdcd293-d153-4145-adec-573c31b044f2`:

- Before kill: plan PROCESSING, BullMQ active.
- Original worker killed; replacement worker launched.
- Recovery observed after **72,147 ms**, `stalledCounter=1`, `attemptsMade=1`.
- Final plan **FAILED**, job **completed**, one NutritionPlan row for the synthetic user.
- Failure: fat/calorie invariant mismatch, not duplicate recovery records.

Transport recovery is observed; successful meal generation is not. BullMQ completed means the handler returned, not that the business plan succeeded. No saved nutrition-program exactly-once claim follows from this run. Evidence: `recovery.txt`.

## Multi-process finalization

Executed inspected `multiproc.ts`/child harness against the real AI DB:

- 30 confirm-versus-dismiss races: **14 confirm wins, 16 dismiss wins, 0 contradictions**. Equal 15/15 distribution is not a correctness requirement.
- 15 double-confirm races: **at most one business invocation per action**.
- Fresh EXECUTING claim rejected; state remained EXECUTING.

External business boundary is an **IDEMPOTENT TEST RECORDER**, not a real fitness write. This harness exercises WORKOUT actions across Node processes; the passing core suite additionally covers nutrition action races in-process. Neither is browser/multi-replica deployment certification.

## Stale reclaim

Original owner claimed and was killed, claim marker backdated, successor reclaimed and completed. **2 attempted business calls, 1 business object, final COMPLETED**. The recorder's object primary key is the stable action ID. Evidence: `multiproc.txt`.

## Late original owner

Original owner paused after claim/business-attempt recording; marker aged; reclaimer completed; original resumed. Both returned successfully with final **COMPLETED**, result matching the reclaimer, **2 attempts / 1 object**.

This is explicitly **IDEMPOTENT TEST RECORDER** evidence: `race_business_objects.action_id` is unique and INSERT uses conflict handling. Do not relabel it REAL FITNESS BUSINESS WRITE or infer safety for every conceivable late-owner result/error interleaving.

## Downstream idempotency

Queried actual migrated fitness DB indexes:

- `workout_programs_user_id_source_plan_id_key`: unique `(user_id, source_plan_id)`.
- `workout_programs_agent_action_id_key`: unique `(agent_action_id)` where that identity is supplied.
- `nutrition_programs_user_id_source_plan_id_key`: unique `(user_id, source_plan_id)`.
- `nutrition_goals_user_id_active_unique`: unique `user_id` WHERE status = ACTIVE.

Code identity: workout draft/generated-workout retries use **`action.id` as sourcePlanId** (`fitness-agent.service.ts:867,889`); nutrition save uses **`plan.id`** (`:937`). Stable identities support retry after uncertain commit; a nutrition revision creates a new plan identity, while retry of that revision reuses it.

Passing downstream apply/PT/ClientJourney tests and equipment persistence corroborate their scoped writes. None proves exactly-once notifications, audits, or all other distributed side effects. The bootstrap failure demonstrates why a uniqueness constraint alone is not sufficient for a clean response to every concurrent caller.

## Browser E2E

Browser tooling **available and exercised**, not unavailable. Started local Vite on 5187 and opened an isolated Playwright browser session. The real frontend redirected to `/login` and rendered the login form. Snapshot: `.playwright-cli/page-2026-09-20T05-59-12-989Z.yml`.

**Authenticated golden journeys BLOCKED / NOT EXECUTED.** Auth, user, gateway and main application containers were stopped; no authenticated test-user session was established. No fake token, route interception, or mock login was used as certification. Roadmap/revise/save, workout/revise/save, PT choose/contract, and live nutrition preview/revise/save remain unverified in the browser.

The screenshot attempt timed out waiting for fonts; no successful screenshot is claimed. The browser and Codex-owned Vite process were closed after inspection. Existing dependency containers were left untouched.

## Two-tab test

**NOT EXECUTED**: authenticated confirm-vs-dismiss in both orders, contradictory UI messages, and stale-card confirm/dismiss after another tab changes state. Backend races are not substitutes for this UI evidence.

## Mobile

**NOT EXECUTED**: authenticated ROADMAP, WORKOUT_PLAN_PREVIEW, NUTRITION_PLAN_PREVIEW, PT_RECOMMENDATIONS and ACTION_CONFIRMATION at 360/375/390/412 px. Login rendering does not establish card/action visibility.

## Auth

Backend ownership regressions remain covered by passing workflow tests. Browser user-A/user-B confirm/dismiss denial, logout/login, expired session and refresh: **NOT EXECUTED**. Injected service identities/internal test secret are not end-user authentication certification.

## CI

**CONFIG AUDITED / RUNNER NOT EXECUTED.** Inspected `.github/workflows/docker-test.yml` and `scripts/ci-check-foundation-evaluator.mjs`. The DB job provisions Postgres/Redis, generates clients, applies canonical migrations, verifies migration status and runs explicit DB/workflow/foundation gates. Local actual helper execution returned 30/30 PASS.

No GitHub runner was dispatched, no commit pushed, and Claude's actionlint result was not independently rerun. `gh`/`actionlint` were not available on PATH. YAML/static audit and local helper execution are not a green CI run.

Two audit limitations: setup-node's pnpm cache step precedes corepack enable, so package-manager availability needs validation on the actual runner; the evaluator helper rejects non-PASS cases but does not enforce a nonempty/exactly-30 case count despite its comment. These are configuration/evidence concerns, not reproduced runner failures.

## Deployment

No staging/production deployment executed. For both target environments each of the following remains **NOT EXECUTED**: service startup, migrations, Postgres, Redis, Qdrant, provider, auth, CORS, gateway/proxy, workers, health endpoints, secrets, rollback/recovery and observability validation.

Local test dependencies and isolated fitness-server health were exercised. Development Qdrant was running. Neither fact proves target-environment health. Dirty product/CI files also prevent an immutable production artifact claim.

## Observability

Partial local correlation only. Queue/worker logs contain jobId, planId and userId; provider health/failure and final business-plan status are observable. Tool logs contain route/status/latency. The action route failure log (`fitness-agent.routes.ts:47`) lacks requestId/sessionId/actionId, and tool logs (`fitness-agent-tools.ts:91`) do not carry the full chain. Harness-emitted IDs are test instrumentation, not proof of deployed correlation.

No end-to-end deployed requestId -> sessionId -> actionId -> jobId -> business-write -> final-action-status trace was demonstrated.

Sensitive-log audit is **not certified clean**. The shared Pino configuration (`backend/shared/src/index.ts:3`) has no redaction policy; worker error paths pass raw errors (`ai.worker.ts:1130`), one invalid-input path logs `job.data` (`:1062`), and recovery logs can include model `rawSnippet`. The normal trace logger logs question length rather than full question, which is positive but not a complete guarantee. No real credential leak was reproduced or exposed by this report. Review and exercise error-path redaction with synthetic markers before production.

## Findings

**CRITICAL:** none demonstrated.

**HIGH:** none demonstrated within this verification; unexecuted gates are not assurance of absence.

**MEDIUM:**

1. **PRODUCT / DB bootstrap concurrency:** real bootstrap/repository calls reject under concurrency (`P2010/23505`, 11/300). Original release regression gate 29/30. Scope and code references above. Needs a narrow fix and stress rerun; passing a single retry is insufficient.
2. **PROVIDER / DEMO:** configured provider unreachable and unverified; substitute produced no valid plan in two fresh golden attempts. Required nutrition revision/save/replay was not reached. Do not approve a live-generation demo on this evidence.
3. **RELEASE / FRONTEND / AUTH:** no authenticated golden, two-tab/stale-card, cross-user or mobile-card proof. Blocks demo certification.
4. **RELEASE / CI / DEPLOYMENT:** dirty artifact, no CI runner result and no target deployment proof. Blocks staging/production certification; local test migrations do not close these gates.
5. **OBSERVABILITY:** full correlation and sensitive-error-log handling not verified; no centralized redaction seen in shared logger. Production gate remains open, without asserting an observed production leak.

**LOW:** readiness observation scripts can exit 0 for FAILED business plans; foundation helper does not enforce the advertised case count. Do not use exit code alone for release approval.

**INFO:** equipment suite now 3/3 with required telemetry flag; original historical catalog cause not established. Multiprocess results use an idempotent recorder. Provider/infra limitations do not reopen workflow architecture. Exact content-prefix recipe remains unspecified, while Git product tree matches.

## Decisions

| Scope | Decision | Basis |
|---|---|---|
| AI Coach core | **REGRESSED (current regression gate, narrowly bootstrap concurrency)** | Current production-function/real-DB reproduction defeats clean-regression requirement. This is not attribution to the latest patch or withdrawal of the passing action-lifecycle architecture. |
| Demo | **NOT READY** | Provider not verified, no successful independent nutrition golden, no authenticated browser, bootstrap failure. |
| Staging | **NOT READY** | Regression, CI runner, deployment/auth/gateway/provider gates open. |
| Production | **NOT READY** | Above plus dirty artifact, incomplete deployed observability/rollback/multi-replica evidence. |

## Next exact blockers

1. Return bootstrap concurrency reproduction to its owner; reconcile competing goal creators, then rerun the 30-case fitness gate and 300-call stress probe without suppressing rejected outcomes.
2. Restore configured tunnel/provider or explicitly select an accepted demo provider; prove repeated valid live nutrition generation, exclusions, same-action/new-plan revision, real persistence and replay, retaining failures and latency.
3. Bring up the real auth/gateway/application test stack and authenticated test users. Execute all golden browser paths, both two-tab race orders, stale cards, ownership/session checks and the four mobile widths.
4. Produce an immutable release candidate including CI/harness changes; execute actual CI, resolving any package-manager setup or gate failures. Do not rely on YAML lint alone.
5. Execute target deployment prerequisites/health/migrations and provider checks, then deployed correlation/redaction, recovery/rollback and representative multi-replica business-write verification before production approval.
