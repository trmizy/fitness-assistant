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
1. Confirm `docker ps` shows `gymcoach-fitness-dev` healthy. A Redis error currently crashes fitness-service (open item N1); restart it if unhealthy.
2. Confirm the AI container has the current code (restart it after code changes; the dev container uses bind mounts with tsx watch).
3. Record the flag values in the release notes; a flag change is a deployment decision, not a code change.

## Rollback
Set `GYMINI_UNIFIED_AI_COACH=off` and `CONVERSATIONAL_INTELLIGENCE_V2_LLM=off`, then recreate the ai-service container. Behaviour returns to the
legacy path (verified by parity tests). No data migration is involved.

## Known symptoms
- "Tạm thời AI chưa sẵn sàng…": the model timed out or failed. No record was made; retry later.
- A revision answered with a status readback: the typed route was misclassified (open item N2). Rephrase or cancel and restart the draft.
- "Mình chưa tạo được lịch tập…": a downstream fitness-service call failed. Check fitness-service health.

## R1 runtime changes (factual, 2026-10-06)
- Semantic routing has its own budget: `LLM_ROUTING_TIMEOUT_MS` (default 15000 ms), one attempt, no retry. It is no longer tied to `CYCLE_ANALYSIS_LLM_TIMEOUT_MS`.
- Chat generation budget: `AI_CHAT_LLM_TIMEOUT_MS` = 45000 in dev, prod and verification compose. Previously 300 s (dev/prod) or 170 s (verification).
- Ollama keeps the model resident: `OLLAMA_KEEP_ALIVE=30m` in the dev compose ollama service. The first request after a restart is still a cold load (about 60–82 s on the dev CPU host).
- Routing decisions are logged with `callPurpose` and `rejectionReason`. Look for `ci_global_llm_route` and `llm_call` lines.
- Known operational limits: general questions with the full RAG prompt do not finish within 45 s on the dev CPU host and return the truthful fallback text. Recommendation narration can still take up to 2 × 80 s (not yet bounded).
- fitness-service can crash on a Redis socket timeout (`repositories/redis.ts` has no `error` listener). If the nutrition or workout reads return "chưa đọc được", check `docker ps` for fitness-dev and restart it if it is unhealthy.
