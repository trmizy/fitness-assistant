# 10 — Observability

## Current state

| Capability | Present? | Evidence |
|---|---|---|
| Structured logging | Yes (pino, JSON lines) | `backend/shared/src/index.ts`; live logs are JSON (`LIVE_LOCAL`) |
| Request logging | Only auth-service and user-service (`pino-http`) | `auth-service/src/app.ts` line 21; `user-service/src/app.ts` line 37 |
| Request or correlation ID | Partially: `traceId` in AI rag payloads (used as `correlationId` in CI logs); gateway request IDs not found | `orchestrator.service.ts`; `ci_global_trace` |
| Error logging | Yes; per-controller `logger.error(error, "…")` | `auth.controller.ts` (many) |
| Latency metrics | Histograms in `shared/src/metrics.ts` (`httpRequestDuration`, `dbQueryDuration`) | Code |
| LLM latency | Logged per call (`ci_global_llm_route.latencyMs`, `ci_v2_llm_interpretation.latencyMs`) | Code |
| LLM timeout metric | Not found as a metric; timeouts visible only in logs and outcomes | Code (absence) |
| Fallback metric | Not found as a metric (`ci_v2_llm_failed_fallback_to_deterministic` is a log line) | Code |
| Workflow metrics | Not found | Code (absence) |
| DB metrics | `dbQueryDuration` histogram defined; wiring not traced | Code |
| Health | `/health` on all services (liveness) | Code |
| Readiness | Not present | Code (absence) |
| Metrics endpoint | `/metrics` on all services, no auth middleware | Code (G-14) |
| Dashboards and alerts | Not in repository deployment | `infra/monitoring/` present; not in prod compose (G-14) |

## Sensitive data in logs

| Item | Observed | Gap |
|---|---|---|
| Bearer access tokens | Present in auth-service request logs (`LIVE_LOCAL`: 1,024 of last 2,000 lines) | G-02 (P0) |
| OTP values | Present when SMTP is absent (`LIVE_LOCAL`: 60 of last 2,000 lines, dev stack) | G-06 |
| Passwords | Not observed | — |
| Raw prompts | Not logged by grep of LLM modules | VERIFIED_OK (code) |
| User identifiers | Logged (`userId`, `sessionId`, `correlationId`) | Acceptable under the operations policy; state it |
| Profile values | Not logged in the CI trace lines (documented: "ids, types, statuses only") | VERIFIED_OK (code comment) |

## Required before public release

1. Redact tokens and OTPs; remove request logging of Authorization headers (P0-T03).
2. Correlation ID from the gateway propagated to every service and the LLM call (new; P3-T01).
3. Metrics for LLM latency, timeouts, fallback acceptance, confirmation outcomes, duplicate-action rejections (P3-T02).
4. Readiness endpoints (P1-T08).
5. Alert rules for error rate, latency, auth failure spikes, LLM timeout rate, certificate expiry, backup failure (P3-T01).
6. Restrict `/metrics` to the internal network or require a token.

## Log retention and access

Not defined in the repository. Logs containing tokens must be purged; retention and access control must be documented (owner: operations).
