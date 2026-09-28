# AI Coach Final Demo Readiness

Date: 2026-09-20. Decision: **BLOCKED — CONFIGURED PROVIDER CREDENTIALS. DEMO READY = NO (not certified).**
AI Coach core signed-off status is unchanged; no production code, test or CI file was changed in this phase.

## What was checked (CODE AUDIT / REAL HTTP)
- `backend/services/ai-service/.env`: `LLM_PROVIDER=ollama`, `LLM_BASE_URL/OLLAMA_BASE_URL=http://127.0.0.1:11435`,
  `LLM_MODEL=qwen3:30b-a3b-instruct-2507-q4_K_M`, embedding `nomic-embed-text`.
- `docs/ai-agent-hardening-fix-report.md` (Phase 3) and `docs/ai-service-operations.md`: port 11435 is a deliberate
  **private remote (RunPod) SSH tunnel**; "Keep SSH credentials and the tunnel process outside the repository."
- `GET http://127.0.0.1:11435/api/tags`: no response (nothing listening; no tunnel process running).
  `GET http://127.0.0.1:11434/api/tags` responds but only lists local `qwen2.5:1.5b` (not the configured model).
- The pod host/port/credentials are not in the repo or in `~/.ssh/config` (that file only defines an unrelated AWS deployment host,
  which was NOT used). RunPod pods are ephemeral, so the tunnel cannot be reconstructed from repo evidence.
- Root `.env` currently says `LLM_PROVIDER=anthropic` (`claude-sonnet-5`, key present) - a different, commented-as-experimental
  setting that conflicts with the ai-service `.env`. It was NOT used: switching provider would change configuration and send
  user data to an external service without authorisation, and the task forbids substituting another model.

## Consequence for the acceptance gates
Provider reliability (10-20 generations), configured-model exclusion fidelity, revision/save/replay on the configured model, provider-down
fallback, and every browser journey that depends on the LLM (roadmap, workout, program, PT narration, nutrition) cannot be certified.
Authenticated browser E2E was therefore not started: its acceptance is gated on the same provider, and the stack was not brought up
(dev containers were Exited; ai/fitness/chat/... died at start because Postgres was still starting - environment, now healthy).

## Status against the acceptance rule
| Gate | Status |
|---|---|
| Configured provider verified | **BLOCKED** (credentials/tunnel) |
| Repeated valid nutrition generation | NOT RUN (configured model); previous stand-in-model result stands: 2/4 |
| Authenticated browser golden journeys, two-tab, stale card, cross-user, session, mobile, screenshots, latency | NOT RUN |
| Release tree identified | Unchanged fingerprint from earlier passes + the bootstrap fix; not re-fingerprinted; nothing committed |
| Final regression | Last verified green: workflow 118, evaluator 30, fitness 30, focused 172, bootstrap 300/300 (Codex sign-off) |

## To unblock (owner action, outside the repo)
1. Start the RunPod pod and its SSH local-forward `127.0.0.1:11435 -> pod:11434` (credentials stay out of the repo).
2. Confirm `curl http://127.0.0.1:11435/api/tags` lists `qwen3:30b-a3b-instruct-2507-q4_K_M` and `nomic-embed-text`.
3. Or explicitly authorise an alternative provider (e.g. the Anthropic key already in root `.env`) for the demo. That is a product/config decision,
   not something to switch silently.
4. Then: `docker compose -f infra/compose/docker-compose.dev.yml up -d` (Postgres is healthy now), rerun
   `test/ai-coach-production-readiness/live-nutrition.ts` with the configured model 10-20 times, then the browser journeys
   (Playwright chromium is installed on this machine).
