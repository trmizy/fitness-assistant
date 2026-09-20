# AI Coach Production & Demo Readiness

Date: 2026-09-20. Scope: verify the SIGNED-OFF AI Coach core in a real environment. No core code was
changed in this pass (see §3). Executed evidence only; anything not executed is labelled.

## 1. Executive decision: **PARTIAL**

| Question | Answer | Why |
|---|---|---|
| AI Coach core ready | **YES** | 118/118 workflow, 30/30 foundation evaluator, 30/30 fitness DB, 175/175 PT/Program/memory on the OFFICIAL isolated test env; multi-process race/reclaim verified; live BullMQ journey works end to end. |
| Demo ready | **NO (not yet)** | Authenticated browser golden journey NOT executed (no browser tooling; full stack not brought up). Configured provider (qwen3:30b tunnel) unavailable, so the live happy path was proven only with a small local model. Release tree is not immutable (uncommitted). |
| Staging ready | **NO** | No deployment/health/CORS/auth-gateway verification; CI gates added but not yet run on a runner. |
| Production ready | **NO** | Needs the above plus rollback plan, observability review, multi-replica verification on the real deployment. |

## 2. Release candidate (Phase A)
`HEAD 96c1040f` (branch `aws-deploy`) + uncommitted changes. Commit policy: no commit was requested, so none
was made. Proposed commit set = the 35 files in the AI Coach product set (14 modified production/docs, 21 new
tests/production/docs; listing reproducible with `git status`), excluding unrelated concurrent work
(`scripts/data-migration-import-aws.mjs`, `docs/aws-*`, `infra/data-migration-importer/`, `test/inbody_duy/`),
Codex-owned evidence (`docs/codex-*`, `test/codex-*`) and the refreshed evaluator JSON artifact.
Fingerprints (temp index, repo untouched): tree `6c40f6409329c485ad549ea9a09b7f104452678d`, content sha256
prefix `5546b1e677e92c24`. The tree hash was recomputed at the end of this pass and is **identical** — no product
code changed while verifying. Verification was therefore against a **dirty working tree with a documented
fingerprint**, not an immutable SHA. `git diff --check` clean.

## 3. Production code changed: NONE
Files changed in this pass: `.github/workflows/docker-test.yml` (CI), `scripts/ci-check-foundation-evaluator.mjs`
(CI helper), `test/ai-coach-production-readiness/*` (verification harnesses), this document. No migration added.

## 4. Environment (Phase B)
Docker Desktop was down (restarted). Official env used: `docker-compose.test.yml` `postgres-test` (localhost:55433)
and `redis-test` (localhost:56379), `scripts/ci-create-test-databases.mjs`, `scripts/prisma-test.mjs`
(`prisma migrate deploy`, never `db push`; one pending migration applied). `migrate status`: ai, fitness, user
"up to date"; chat "No pending migrations" (its `status` output was inconclusive, `prisma-test` verified indexes:
"all required indexes present"). Constraints verified in the DB: `agent_workflow_sessions_one_active_per_session`
(partial unique), `workout_programs(user_id, source_plan_id)` + `agent_action_id` unique,
`nutrition_programs(user_id, source_plan_id)` unique, `client_journeys(contract_id)` unique. Dev Redis/Qdrant
containers start healthy. Provider: configured `qwen3:30b` via SSH tunnel on :11435 is **unreachable**; tunnel
credentials are outside the repo and I did not open one. Qdrant not exercised by this scenario.

## 5. Environment-backed regression (Phase C)
| Gate | Result |
|---|---|
| ai-service `agent-workflow-*` + `nutrition-food-exclusion` + slot parsers (incl. finalization race) | **118/118** |
| Codex conversational-workflow v2 evaluator (unchanged) | **30/30 PASS** |
| PT / Program v2 / narrator / claims / memory / invariants | **175/175** |
| fitness-service nutrition target + bootstrap + engine + equipment semantics + apply idempotency | **30/30** |
| user-service PT contract idempotency + ClientJourney idempotency | **6/6** |
| `plan-generation-equipment.integration.test.ts` | **STILL FAILING (3/3) — environment/harness**: with DB ports, Redis, seeded catalog and matching internal secret it still ends in "Failed to load exercise catalog"; it belongs to the workout LLM-generation pipeline, which this pass did not touch. Unresolved, not a proven product defect. |
| `tsc --noEmit` ai + fitness, frontend build | clean |

## 6. Live BullMQ + provider journey (Phase D) — `test/ai-coach-production-readiness/live-nutrition.ts`
REAL: AI-service `tryTurn/execute`, Redis+BullMQ, ai worker, nutrition processor, LLM HTTP call, fitness-service
(test server, isolated DB, real foods), AI test DB. STUBBED: user-service (routes stand-in; the real one needs an
auth-service JWT). PROVIDER: **local `qwen2.5:1.5b`, NOT the configured model** (env override only).
- Accumulation: "không ăn cá" -> "cũng không ăn thịt bò" -> "4 bữa": queued constraints `[fish, beef]`, target from
  the real fitness-service deterministic path **1992/128/246/55**.
- Run 3 (full pass): job 16 active -> completed (attempts 1), plan COMPLETED, preview target matches, 84 items,
  **0 fish/beef**; "không ăn cá và không ăn cay" refused with **no new job/plan row**; revision "Ít bữa hơn" ->
  same action, **new job 17**, meals 3, 63 items, 0 excluded; confirm persisted a **real NutritionProgram**
  (sourcePlanId = the revised plan id, 63 item rows); replay idempotent (1 program). Latency: queue ~0.13 s,
  generation ~8 s (small local model), save ~0.3-0.5 s.
- Reliability observation: with this small model 2 of 4 real generations (incl. the recovery test) ended honestly
  FAILED with invariant `fat_target_mismatch`; a no-LLM diagnosis (`processor-targets.ts`) shows the authoritative
  target + exclusions PASS with a lean template and FAIL with a fat-heavy one, and even the default (no target)
  fails with the fat-heavy one — i.e. model/template dependent and pre-existing, not caused by targets or
  exclusions. The generator is single-shot (no retry on invariant failure): **recommend evaluating with the real
  configured model before a demo**; not changed here (no speculative core edits).
- Provider unavailable (`--dead-provider`): honest "AI dinh dưỡng chưa sẵn sàng", **0 actions, 0 plan rows**.
- Failed job path: real `failReason` shown, no fake preview/program (runs 1 and recovery).

## 7. BullMQ recovery — `bullmq-recovery.ts`
Worker process SIGKILLed while the job was `active`; second worker started. BullMQ's stalled detection re-ran the
job (`stalledCounter=1`, attemptsMade 1) to completion ~72 s later; exactly **one** `NutritionPlan` row, no
duplicate program, no contradictory state (plan ended FAILED by the same model-quality invariant). Retry/backoff
attempts (>1) not exercised (validation failures are not re-thrown by design).

## 8. Multi-process finalization — `multiproc.ts` (two AI-service processes, one Postgres)
- confirm ‖ dismiss x30 (alternating replica): 15 confirm wins / 15 dismiss wins, **0 contradictions** (loser
  never reports success; business calls 1 vs 0).
- double confirm across processes x15: **≤1 business call**, COMPLETED.
- fresh EXECUTING claim: other replica rejected ("already being executed"); dismiss reports "đang được lưu".
- stale reclaim: replica A claimed then killed (SIGKILL) mid business call; claim aged 10 min; replica C
  reclaimed and completed -> COMPLETED, business attempted 2x, **1 business object** (downstream identity).
- **Late original owner**: A2 claimed and paused, B reclaimed + completed, A2 resumed: final COMPLETED with the
  reclaimer's result, both reported the same saved outcome, **1 business object**. Consistent *because the
  downstream write is idempotent by `sourcePlanId`* (verified unique indexes above); no fencing token was
  needed and none was added. If a non-idempotent downstream is ever added to this path, a fencing token would
  be required — noted, not built. Business layer was an idempotent recorder, not the real fitness-service, for
  this test; workout downstream idempotency is DB-verified by unique `(user_id, source_plan_id)`.
- Not run across processes: the nutrition kind (same generic claim code path; covered in single-process race
  tests).

## 9. CI (Phase G)
Existing `db-integration` job only covered 4 DB files. Added (same job; `redis-test` service, timeout 25 min):
AI Coach workflow/product/race/exclusion suites, the foundation evaluator gate (`scripts/ci-check-foundation-
evaluator.mjs`, requires all cases PASS), fitness target/bootstrap. Databases still come from the official
scripts. Linted with `actionlint` (no findings) but **not yet executed on a CI runner**. Live provider/BullMQ,
browser E2E and multi-process harness remain manual/nightly gates (`test/ai-coach-production-readiness/`).

## 10. NOT executed (blocked / out of reach)
Authenticated browser golden journey, mobile 360-412 px, two-tab UI test, stale-card UI, session/logout tests
(no Playwright/browser tooling; the dev stack containers were not brought up; real auth stack needed);
staging/deployment validation (startup, CORS, gateway, health, Qdrant/provider connectivity, secrets);
observability review; demo latency for roadmap/workout/PT/program search; ambiguous-remote-outcome with real
transport loss (code-audited: idempotent by `sourcePlanId`, NOT live-reproduced); real configured-model run.

## 11. Findings
CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 0.
INFO: plan-generation-equipment integration suite unresolved (env); generator single-shot vs small-model
invariant failures; verification on a dirty tree; user-service stubbed in the live journey.

## 12. Capability status
ROADMAP, ROADMAP REVISION, STANDALONE WORKOUT, WORKOUT REVISION, FIND_TRAINING_PROGRAM, PT SEARCH, PT HIRE:
CORE SIGNED OFF (regression re-verified on the official env; not live/browser verified).
STANDALONE NUTRITION, NUTRITION REVISION: CORE SIGNED OFF + LIVE VERIFIED at the BullMQ/worker/LLM/fitness-service
boundary with a stand-in model (not the configured provider, not through the browser).

## 13. Demo plan and fallback
Scripted flow: roadmap -> workout (revise, save) -> PT search (synthetic dataset, label as demo data) -> confirm
PT contract -> "Tạo thực đơn 4 bữa, tôi không ăn cá" (live) -> preview -> save. Preconditions: Docker up,
migrated DBs, Redis, worker running, provider reachable (health check first). Fallbacks (never fake a live
call): provider down -> the chat says so and the deterministic parts (roadmap/workout/PT/program) still run;
nutrition demo uses the recorded live evidence in §6; worker failure -> action shows honest FAILED and can be
retried; network outage -> show the recorded evidence and tests.

## 14. Commands executed
See `test/ai-coach-production-readiness/` (`live-nutrition.ts [--dead-provider]`, `multiproc.ts`,
`bullmq-recovery.ts`, `processor-targets.ts`, run with `npx tsx` from the repo root), plus the CI-equivalent
commands in the workflow file, with `DATABASE_URL` pointing at `gymcoach_ai_test` on localhost:55433.
