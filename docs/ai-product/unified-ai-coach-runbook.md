# Unified AI Coach — Operator Runbook (short)

Status: Batch 5 verdict is `UNIFIED_AI_READY_FOR_SHADOW_ONLY`. Do not enable `on` outside internal/dev. See
[phase3-batch5-rollout-readiness.md](phase3-batch5-rollout-readiness.md).

## Flags
| Variable | Values | Default | Use |
|---|---|---|---|
| `GYMINI_UNIFIED_AI_COACH` | `off` / `shadow` / `on` | `off` | `shadow` only in staging for diagnostics |
| `CONVERSATIONAL_INTELLIGENCE_V2` | `off` / `on` / `shadow` | `off` | deterministic router; required by several unified capabilities |
| `CONVERSATIONAL_INTELLIGENCE_V2_LLM` | `off` / `on` | `off` | typed Qwen fallback. Note: the orchestrator still calls the model on some paths when this is `off` |

## Model
- Approved tag only: `qwen3:4b-instruct-2507-q4_K_M` (verify with `ollama list`). Do not substitute.
- Smoke (not automated): `LLM_PROVIDER=ollama LLM_MODEL=qwen3:4b-instruct-2507-q4_K_M npx tsx src/scripts/unified-coach-qwen-smoke.ts`.
- Single observed latencies on the dev host: 8 s warm, 82 s cold, 170 s server timeout. Treat the 170 s timeout as a user-facing failure.

## Before changing any flag
1. Confirm `docker ps` shows `gymcoach-fitness-dev` healthy. A Redis socket error no longer crashes fitness-service (N1, closed in R2 — see below); if it is still unhealthy, that is a new issue, not N1 recurring.
2. Confirm the AI container has the current code (restart it after code changes; the dev container uses bind mounts with tsx watch).
3. Record the flag values in the release notes; a flag change is a deployment decision, not a code change.

## Rollback
Set `GYMINI_UNIFIED_AI_COACH=off` and `CONVERSATIONAL_INTELLIGENCE_V2_LLM=off`, then recreate the ai-service container. Behaviour returns to the
legacy path (verified by parity tests). No data migration is involved.

## Known symptoms
- "Tạm thời AI chưa sẵn sàng…": the model timed out or failed. No record was made; retry later.
- A revision answered with a status readback: this was the typed-route misclassification N2. **Closed in R1** (`routeAcceptance()` context-consistency guard in `llm-route.ts`) and still closed after the R1.1 re-baseline on current HEAD — if you see it again, it is a new defect, not N2 recurring; file it separately.
- "Mình chưa tạo được lịch tập…": a downstream fitness-service call failed. Check fitness-service health.

## R1 runtime changes (factual, 2026-10-06)
- Semantic routing has its own budget: `LLM_ROUTING_TIMEOUT_MS` (default 15000 ms), one attempt, no retry. It is no longer tied to `CYCLE_ANALYSIS_LLM_TIMEOUT_MS`.
- Chat generation budget: `AI_CHAT_LLM_TIMEOUT_MS` = 45000 in dev, prod and verification compose. Previously 300 s (dev/prod) or 170 s (verification).
- Ollama keeps the model resident: `OLLAMA_KEEP_ALIVE=30m` in the dev compose ollama service. The first request after a restart is still a cold load (about 60–82 s on the dev CPU host).
- Routing decisions are logged with `callPurpose` and `rejectionReason`. Look for `ci_global_llm_route` and `llm_call` lines.
- Known operational limits: general questions with the full RAG prompt do not finish within 45 s on the dev CPU host and return the truthful fallback text.
- ~~fitness-service can crash on a Redis socket timeout...~~ **Closed in R2** — see below.

## R1.1 runtime changes (factual, 2026-10-07/08)
- Recommendation narration (PT and Program) now has its own budget, separate from routing/QA/generation: `RECOMMENDATION_NARRATION_TIMEOUT_MS` (default 20000 ms), exactly one attempt, no retry. Previously unbounded at up to 2 × 80 s.
- Narration is presentation-only: on timeout/invalid-output/provider-unavailable it falls back to the deterministic claim renderer with the same candidate ids/order/scores — it never changes the structured recommendation and never blocks it. See `recommendation_narrator.ts` / `program_recommendation_narrator.ts`.
- Narration calls are logged as `narration_result` (`callPurpose`, `kind: pt|program`, `timeoutMs`, `attempts`, `latencyMs`, `outcome`, `fallbackUsed`) — never the prompt or answer text.
- Real-model evidence on the dev CPU host: a cold/contended `qwen3:4b-instruct-2507-q4_K_M` call did not finish inside 20 s (nor inside a 120 s evidence-only probe for the PT case) and correctly fell back; a warm call completed in ~16.7 s, inside budget, with a real structured selection (no fallback). See `docs/ai-product/phase3-rollout-r1-1-narration.md`.

## R2 runtime changes (factual, 2026-10-08)
- **N1 closed:** `repositories/redis.ts`'s client now has an `.on("error", ...)` listener (logs, does not crash). `exercise.repository.ts`'s cache reads/writes are wrapped and fail soft to the real DB. A real historical crash from this exact bug (`SocketClosedUnexpectedlyError`, unhandled `'error'` event) was found independently in this session's own logs before the fix, confirming the symptom was real.
- **N4 closed:** when draft-time equipment validation is unavailable, the workout preview still generates but now carries a truthful warning ("Mình chưa kiểm tra được lịch này có đúng thiết bị bạn có không...") instead of silently looking fully verified. Confirm-time validation (the real safety backstop) is unchanged.
- **New defect found and fixed via real HTTP verification (H1), not by any prior test:** `exercise-substitution.service.ts`'s candidate query had no `status: "PUBLISHED"` filter — a `STAGING` exercise could be offered as a draft-time substitute, which confirm-time persistence then always rejected (`Unable to map AI exercises to exercise master: ... (not_found)`), permanently failing that draft's confirmation. Fixed with a one-line filter.
- A reusable test-database safety guard now exists (`src/test-utils/safe-test-db.ts` in both ai-service and fitness-service) — throws `UNSAFE_TEST_DATABASE_TARGET` before any mutation if the target isn't the isolated `*_test` Postgres (`:55433`) under `NODE_ENV=test`.
- fitness-service's full test suite (run end-to-end for the first time this session) has 18 known, pre-existing seed-data-completeness failures in the shared `gymcoach_fitness_test` database (nutrition-substitution engine, cycle evaluation, a few catalog filters) — unrelated to any AI/platform code, see `docs/ai-product/phase3-rollout-r2-platform-verification.md` §9b/§19. Do not assume these are caused by any AI change.
- `test/ai-chat-full-verification/stack.mjs` now runs on `real port + 10000` (gateway `:13000`, etc.) — its old ports (3000-3007) collide with this host's actual dev Docker containers.
