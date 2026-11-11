# Qwen3 4B Live Recheck

Date: 2026-09-22. Model: `qwen3:4b-instruct-2507-q4_K_M`, local Ollama `127.0.0.1:11434`. No production-code changes in this testing pass. Evidence: `test/model-4b-recheck/`.

## Conclusion

The model is usable with the existing deterministic checks and fallbacks, but this run does **not** establish consistently good unassisted generation or release readiness. Nutrition and recommendation narration succeeded in the tested cases. Workout required fallback/repair in **all three** cases. Small-sample semantic interpretation still missed intents and entities. One independent mocked regression also fails.

Fine-tuning is not established as a prerequisite or the immediate fix. First investigate timeout/performance, incomplete workout output, and the deterministic regression; retain the semantic mistakes as evaluation cases. Repeat with a larger held-out set before deciding whether training is justified. No training was performed.

## Environment And Boundaries

- Official isolated test Postgres 55433 / Redis 56379 were started. Existing fitness catalog: 13,159 foods, 1,001 exercises. AI and fitness canonical migration deploy checks reported no pending migrations (25 and 53 migrations respectively).
- Model calls are real Ollama HTTP. `ollama ps` during narration showed context 8192 and mixed CPU/GPU placement (45%/55%); this is not a throughput benchmark or a precise utilization measurement.
- Nutrition/workout use real test DBs, queue/worker, fitness HTTP and catalogs. Synthetic users are cleaned by the harnesses. Real application accounts were not used.
- Nutrition profile/InBody/user-service responses are fixtures; direct AI service identity bypasses end-user authentication. Queue, processor and nutrition persistence are real.
- No authenticated browser, production-user end-to-end, broad safety, tool-calling adversarial or multi-user load certification is claimed.
- Existing scripts contain historical comments/labels about 30B or 1.5B. Explicit model overrides and emitted model names verify this execution used 4B; those comments are not runtime evidence.

## Results

| Test | Observed result | Interpretation |
|---|---|---|
| Live recommendation narrator | 4 scenarios / 5 candidates accepted, no fallback | Structured claim selection/rendering pipeline success, not unrestricted prose quality |
| Live semantic parser | 24/24 valid JSON; intent 6/9; recommendation intent 3/3; entities 20/23 | Small stratified sample, model-only reading rather than full merged router |
| Live nutrition | Initial and revised plans COMPLETED, saved, replay idempotent | One successful two-generation journey |
| Workout equipment integration | 3/3 PASS | All three needed repair/fallback; raw-model quality not 3/3 |
| Selected deterministic regressions | 41/42 PASS | One failure reproduced separately with mock provider |

## Recommendation Narrator

Executed unchanged `evaluateLiveNarrator.ts` with explicit local 4B environment. Cases: cold-start, real cohort, synthetic cohort, mixed multiple candidates. All `usedFallback:false`, five narrated candidates. Output is constrained/rendered from claims; this test is not evidence that arbitrary scientific prose is correct.

Latency by scenario: 37.214 s, 21.125 s, 19.770 s, 42.107 s. Total 120.216 s; mean 30.054 s/scenario. This is noticeably slow for synchronous chat even where validation succeeds. Evidence: `narrator.txt`.

## Semantic Interpretation

Used a copy of `test/conversational-intelligence/run-llm.ts` with only its results destination changed, retaining the original 30B artifact. Explicit environment selects 4B. Sample size 24 across the script's predefined categories.

- Invalid JSON: **0/24**.
- Intent accuracy on cases with explicit expected intent: **6/9 (66.7%)**, not 66.7% of all 24 cases.
- Recommendation-intent detection: **3/3**.
- Entity exact-match recall: **20/23 (87.0%)**, unchanged by validator; this is not an exhaustive entity precision metric.
- Forbidden entities checked by the sample: **0** before and after validator.
- Latency: median 6.574 s, p90 13.945 s, maximum 15.425 s, mean 6.580 s.

Misses include COR-067 `CONFIRM` instead of `CORRECT_INFORMATION`; GEN-138/139 `PROVIDE_INFORMATION` instead of `ANSWER_QUESTION`; missing ages 22 and 30 in multi-slot sentences; missing target weight 72 in "xuong 72 ky" (original Vietnamese text retained in JSON).

Evidence: `semantic.json`, `semantic.txt`, `semantic.ts`. These are model-only results; do not infer the same failure rate for the deterministic-first production router.

## Nutrition Journey

Executed existing `live-nutrition.ts` with `LIVE_LLM_MODEL=qwen3:4b-instruct-2507-q4_K_M` and local endpoint override.

1. Fish exclusion, then beef exclusion, then four meals: queue retained both exclusions and authoritative **1992 kcal / P128 / C246 / F55**.
2. Job 1: COMPLETED, preview displayed, 84 meal items; the harness name-based exclusion scan found zero prohibited matches. This limited regex scan supplements the processor's own exclusion/invariant checks, not an independent exhaustive food taxonomy audit.
3. Unsupported spicy-food exclusion: explicit refusal; plan-row count remained one. This harness did not separately measure queue-count delta for this turn.
4. Fewer-meals revision: same action path, new job 2 and new plan, three-meal preview, COMPLETED, no prohibited matches in the harness scan.
5. Real fitness persistence: **63 meal-item rows**, action COMPLETED, one nutrition program. Reconfirm returned the same result and program count stayed one.

Initial generation observation latency 120.754 s (8-second polling); queue 305 ms; save 606 ms; total journey 211.116 s. The revision worker ran approximately 87.6 s. These are not isolated model token-generation timings.

No `[nutrition-repair]` event appears in this run's captured log. That indicates the post-invariant quantity-repair branch was not observed; the standard deterministic portion construction and numeric validation still participate. Do not attribute all calorie/macro correctness to the LLM. Two successful generations are insufficient to establish a robust success rate.

Evidence: `nutrition.txt`. The observation harness can exit zero even if a plan fails; this conclusion is based on emitted COMPLETED/save/replay results, not exit status alone.

## Workout Journey

Executed real `plan-generation-equipment.integration.test.ts` with local 4B, isolated DBs/Redis, matching internal secret and `DEBUG_AI_PLAN=true`.

| Persona | Final result | Model/pipeline behavior |
|---|---|---|
| Bodyweight + pull-up bar | PASS, about 101.4 s test duration | LLM hit 65 s timeout; deterministic per-day catalog fallback |
| Home gym | PASS, about 24.3 s | LLM call 20.128 s, only 134 completion tokens; missing day/exercises repaired deterministically |
| Commercial gym | PASS, about 67.0 s | LLM hit 65 s timeout; catalog fallback; real persistence verified |

All final plans passed equipment/allowlist checks. Commercial-gym persisted exercise IDs exactly matched generated canonical IDs. However **2/3 calls timed out and the remaining output was incomplete**. This is successful defensive pipeline behavior, not successful complete model-authored workouts. The worker's 65-second call limit applies here despite the broader provider timeout configuration.

Evidence: `workout.txt`. No timeout or generation-policy settings were changed to force a pass.

## Independent Regression Failure

Selected conversational-intelligence and nutrition-repair suites: **41/42**, zero skipped. Failure reproduced when run alone:

`backend/services/ai-service/src/__tests__/conversational-intelligence-global.test.ts:293`

The test calls `fitnessAgent.tryTurn("Toi cao bao nhieu?", ...)` (accented original in source), expecting a height answer; it receives null and dereferences `.answer`. Provider was **mock**, not local 4B. Therefore this is a current deterministic path/test regression requiring investigation, not proof of a model defect or a fine-tuning need. No broader root cause or production endpoint failure is claimed from this assertion alone.

Evidence: `regression.txt`, `regression-isolated.txt`. The test was not edited or skipped to obtain a green result.

## Next Actions

1. Investigate the reproducible height-answer regression independently of model choice.
2. Profile workout prompt/output and local inference latency against the worker's timeout; address incomplete schedules without weakening validators.
3. Expand/repeat live semantic and plan evaluations, including held-out corrections and multi-slot Vietnamese utterances. Preserve raw-model versus repaired-output metrics separately.
4. Consider a targeted fine-tuning experiment only if systematic semantic/format mistakes persist after prompt/runtime adjustments and enough reviewed examples exist. Current evidence does not justify starting weight training as the first remedy.

This test pass is complete. Existing application services/configuration remain on 4B; no production logic was modified.
