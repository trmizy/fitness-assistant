# 09 — Reliability and Failure Modes

For each failure, the table gives the observed or expected behaviour, the evidence, and the gap. "Expected" means derived from code and not run.

| Failure | Expected behaviour (from code) | Evidence | Gap / status |
|---|---|---|---|
| PostgreSQL unavailable | Requests fail with 500; `/health` still returns OK (liveness only) | Code (`/health` static) | G-15 (orchestrator keeps routing traffic) |
| Redis unavailable | fitness-service uses a no-op stub when disabled; enabled path raises on command failure in request path | Code (`repositories/redis.ts`; `exercise.repository.ts` lines 85–92) | G-19 (NEEDS_RUNTIME) |
| LLM unavailable | Degraded message after the server timeout; some paths return fallback text | LIVE_LOCAL (500 after 170 s; degraded text) | G-18 |
| LLM timeout | 170 s wait, then fallback; client may time out at 240 s (harness) | LIVE_LOCAL | G-18 |
| Malformed LLM JSON | Zod validation fails; JSON util retries; phase fallback | Code (`json_llm_call.util.ts`) | Verified by code; not fault-injected |
| Vector retrieval unavailable | AI `/health` reports `retrieval: degraded`; RAG answers without knowledge context (expected) | Code (`ai/app.ts`) | G-19 (NEEDS_RUNTIME) |
| Downstream service unavailable | Gateway `serviceUnavailable(...)` on proxy error | Code (`proxy.routes.ts` `onError`) | Verified by code; no circuit breaker (G-18, G-16) |
| Auth-service unavailable | Every authenticated request fails at the gateway | Code (`auth.middleware.ts` line 34) | G-16 (availability coupling) |
| Client retries a request | Non-idempotent POST may execute twice unless the endpoint is idempotent | Code (confirm 409 on completed; plan import idempotent) | See [06](06-workflow-concurrency-idempotency.md); mobile/web retry policy NOT VERIFIED |
| Server restart during a workflow | Action left EXECUTING is reclaimed after a stale threshold | Code (`fitness-agent.service.ts` ~430, ~793–806) | Threshold and crash test NEEDS_RUNTIME |
| Confirmation submitted twice | Second call returns 409 with status message | Code (~777) | VERIFIED_OK (code) |
| Confirmation requests race | One conditional claim wins; loser gets 409 "already being executed" | Code (~788–808) | Runtime NOT VERIFIED (P4-T03) |
| Email delivery failure | Dev OTP path if non-production; production throws 500 | Code (`email.service.ts` 28–30) | G-06 |
| Rate-limit store (Redis) unavailable | Partner-application limiter uses Redis when `REDIS_URL` is set; otherwise memory store | Code (`partnerApplicationRateLimit.middleware.ts` header) | Multi-instance behaviour not verified |

## Timeouts and budgets (summary)

- Gateway proxy timeout: default of `http-proxy-middleware` (not set explicitly in the proxy block reviewed). Needs explicit value (G-18).
- AI turn: 170 s server, 240 s harness.
- Auth verify call: no explicit timeout found in `auth.middleware.ts` (NOT VERIFIED). Add one (G-16).

## Retry policy

- Narrators: `attempts: 2`. JSON util: retries with fallback.
- Client-side retries: not verified in web and mobile.
- Server-side retries against downstream services: not found in the reviewed clients (NOT VERIFIED).

## Recovery

- Restart semantics: stateless services except Redis-dependent caches and in-flight LLM calls.
- Workflow state survives restart (DB-backed). Good.
- Backups: G-13.

## Required reliability tests (P1-T08, P1-T10)

1. Stop PostgreSQL: `/ready` returns 503; gateway stops routing to the instance.
2. Stop Redis: exercise list and detail return 200 with DB data.
3. Stop Qdrant: AI returns the degraded message without 500.
4. Delay LLM 60 s: user gets fallback within the budget; breaker opens after N failures.
5. Kill the AI process during confirmation: reclaim produces exactly one business row.
6. Stop auth-service: cached-valid tokens continue for a bounded window; new logins fail with a clear message.
