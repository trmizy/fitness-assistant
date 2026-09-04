# QA FIXED ISSUES

## BUG-FINANCE-IDEMPOTENCY-001

- Before: concurrent duplicate internal transfer/refund could repeat ledger mutations because wallet locks had no transaction-status compare-and-swap.
- Fix: atomically claim PENDING/PROCESSING transactions while wallets are locked; duplicate callers exit without ledger mutation; audit log reflects execute versus skip.
- Files: `backend/services/payment-service/src/services/wallet.service.ts`, `src/__tests__/wallet-financial-invariants.integration.test.ts`.
- Retest: payment build PASS; 18/18 suite PASS; concurrent payment/refund each produce exactly three ledger rows and balances/commission reconcile to baseline.

## BUG-CONFIG-LLM-DEFAULT-001

- Before: host runners defaulted to missing `llama3.2:3b` although production uses the fine-tuned Qwen model.
- Fix: aligned Ollama default with `fitness-coach-qwen2.5-1.5b:q4_K_M`.
- Retest: retrieval benchmark PASS at hit/recall@5 0.98 and MRR 0.81867.

## BUG-PRISMA-WINDOWS-EPERM-001

- Before: host generation failed renaming a Linux engine binary held through a Windows bind mount.
- Workflow fix: `docker exec gymcoach-ai-dev npm run db:generate` while the stack is active.
- Retest: container generation PASS in 1.95 seconds.

## BUG-AI-WORKOUT-001

- Before: the final equipment check could remain invalid or fail to execute and the worker still persisted `COMPLETED`; repair paths could choose globally allowed but wrong-day exercises.
- Root cause: final validation was best-effort/fail-open and candidate membership was not authoritative at persistence time.
- Fix: added a pure final semantic invariant validator, strict per-day candidate membership, constrained repair, fail-closed persistence and generation telemetry.
- Files: `src/services/workout-plan-invariant.service.ts`, `src/workers/ai.worker.ts`, `src/__tests__/workout-plan-invariant.test.ts`.
- Retest: AI TypeScript build PASS; invariant tests 6/6 PASS; live equipment-persona integration 3/3 PASS across five actual Ollama generations.
- Regression evidence: newest five DB plans have requested days = persisted days, `semanticPass=true`, `constraintPass=true`; repair counts 4–7 are now observable.
- Status: FIXED; current full `test:all` regression 402/402 PASS.

## BUG-AI-EVAL-HARNESS-001

- Before: evaluation runners used deterministic proxies/fixtures and could not compare the live production model with its base.
- Fix: added contract-specific live golden cases and an Ollama A/B runner with temperature 0, seed 42, finite timeout/retry, raw persistence and summary metrics.
- Files: `src/evaluation/live_golden_cases.ts`, `src/evaluation/run_live_model_evaluation.ts`, `package.json`.
- Retest: 24/24 model calls completed with no provider error against `qwen2.5:1.5b` and `fitness-coach-qwen2.5-1.5b:q4_K_M`.
- Result: harness works; model quality itself remains open because the fine-tuned model regressed safety and citation metrics.

## BUG-TEST-QUEUE-001

- Before: equipment integration completed its assertions but the process stayed open until the outer timeout.
- Root cause: the BullMQ queue opened by the test was not closed in teardown.
- Fix: call `closeAiQueue()` and resolve auth-service URL for host versus Docker execution.
- Retest: integration exits normally in 43.2 seconds, 3/3 PASS.

## BUG-TEST-DRIFT-002

- Before: live routing scripts hard-coded `2026-06-02`; marketplace fixtures used empty days, expected obsolete 402 behavior and omitted required adoption.
- Fix: compute relative dates at runtime; keep explicit-date cases fixed; update fixtures/assertions to current business contract; resolve host/container endpoints explicitly.
- Retest: intent routing PASS; live nutrition routing PASS; live workout schedule routing PASS; marketplace phase 8 tests 8/8 PASS; full AI suite 434/434 PASS.

## BUG-AI-NUTRITION-001

- Before: LLM returning fewer meals failed generation; deterministic expansion selected a protein-heavy catalog and could calculate roughly 400–550g protein/day; there was no final calorie/macro invariant.
- Root cause: catalog ordered only by protein, included powders/concentrates, composition allocated only protein/carb foods, and completion checked food IDs but not target arithmetic.
- Fix: accept a non-empty compact LLM template then deterministically expand the requested meal count; diversify/filter the food catalog; allocate protein/carb/fat foods deterministically; add final 7-day, meal-count, food-ID, nonnegative, calorie and macro validator; pass custom macro targets through the queue.
- Retest: AI and fitness TypeScript builds PASS; nutrition invariant tests 2/2 PASS; live plan `65a69792-d4ff-45e5-a667-5f64d3b1ae62` COMPLETED with 2003 kcal, 181.3g protein, 213.1g carbs and 48.9g fat against 2000/150/225/56 targets (within configured tolerance).
- Regression: invalid intermediate live generations were persisted as FAILED, proving fail-closed behavior.
