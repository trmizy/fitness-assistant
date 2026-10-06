# 17 — Go-Live Checklist

Rules:
- `[x]` only when repository or runtime evidence supports the gate. Evidence is cited on the line.
- `[ ]` otherwise. The default is NOT VERIFIED.
- Gap IDs link to [15-production-gap-register.md](15-production-gap-register.md).

Overall state at the time of this audit: **NO-GO**.

## Security

- [ ] JWT signing secrets have no public fallback in production (G-01) — OPEN.
- [ ] Access and refresh secrets rotated after the fix (G-01) — NOT VERIFIED.
- [ ] Bearer tokens absent from all logs (G-02) — OPEN (LIVE_LOCAL evidence of failure).
- [ ] HTTPS only at the production edge, HSTS, HTTP redirect (G-03) — NOT IMPLEMENTED.
- [ ] Shared internal secret replaced by per-service secrets or network identity (G-09) — OPEN.
- [ ] Public `/auth/internal/*` and `/internal/*` blocked at the gateway (G-09) — OPEN.
- [ ] Constant-time comparison for every secret check (G-09) — OPEN.
- [ ] Production boot fails on any missing or default internal secret in every service (G-10) — PARTIAL.
- [ ] Dependency audit clean for critical and high advisories (G-22) — NOT VERIFIED.
- [ ] Secret scanner required in CI and passing (G-30) — NOT VERIFIED.
- [x] Payment webhook signatures verified and fail closed for MoMo and VNPay (G-23) — CODE_INSPECTION.
- [x] Tool calling disabled unless explicitly enabled (`ENABLE_TOOL_CALLING`) — CODE_INSPECTION.
- [x] No raw SQL with user input in production code (grep) — CODE_INSPECTION.

## Authentication

- [ ] OTP stored with a keyed hash (G-05) — OPEN.
- [ ] Resend does not reset the attempt budget (G-05) — OPEN.
- [ ] Debug OTP impossible in production by default (G-06) — PARTIAL.
- [ ] Refresh tokens hashed at rest (G-07) — OPEN.
- [ ] Refresh reuse detection revokes the token family (G-07) — OPEN.
- [ ] Account-level lockout or back-off (G-25) — PARTIAL.
- [x] Passwords hashed with bcrypt (cost 10) — CODE_INSPECTION.
- [x] Disabled users rejected at token verification (`isActive` check) — CODE_INSPECTION.

## Authorization and user isolation

- [ ] Every user-owned route has an owner check derived from the verified identity (G-24) — NEEDS_RUNTIME_VERIFICATION.
- [ ] Cross-user test suite passes for every route family (G-24) — NOT IMPLEMENTED.
- [ ] Admin role enforced in every service that exposes admin routes (G-08) — PARTIAL.
- [x] Coach-client actions re-check the active relationship on the server — CODE_INSPECTION (`coach.service.ts`).
- [x] Marketplace withdraw checks publisher ownership — CODE_INSPECTION.
- [x] Chat socket join checks participant membership — CODE_INSPECTION (`chat.handler.ts`).
- [x] Admin socket room joined only for verified ADMIN role — CODE_INSPECTION (`socket/index.ts`).
- [x] AI confirm and dismiss update scoped by `userId` — CODE_INSPECTION (`fitness-agent.service.ts`).
- [ ] Client cache cleared on logout and account switch (web and mobile) — PARTIAL: mobile calls `queryClient.clear()` (`AppContext.tsx` lines 85, 139, 160); web not traced (NOT VERIFIED).
- [ ] Shared caches cannot return another user's data (G-29) — PARTIAL.

## Database

- [x] Single active training cycle per user enforced in the database — CODE_INSPECTION (migration `20260730020000`).
- [x] Single active fitness roadmap per user enforced in the database — CODE_INSPECTION (migration `20260909090000`).
- [x] Single active nutrition goal per user enforced in the database (partial unique) — CODE_INSPECTION (migration `20260818020000`).
- [x] One workout program per AI action (`agent_action_id` unique) — CODE_INSPECTION (migration `20260907030000`).
- [ ] Prisma schema matches migrations (no drift) (G-20, G-27) — PARTIAL.
- [ ] From-zero migration replay passes for every service (G-20) — NOT VERIFIED.
- [ ] Destructive migrations reviewed and approved (G-04) — OPEN.
- [ ] Cross-service orphan reconciliation in place (G-28) — OPEN.

## Migrations

- [ ] Snapshot required before any production `migrate deploy` (G-04) — NOT IMPLEMENTED.
- [ ] Dry run against a restored snapshot in staging (G-04) — NOT IMPLEMENTED.
- [ ] Rollback procedure documented for each destructive migration (G-04) — OPEN.
- [ ] `db push` forbidden in non-local environments (G-20) — PARTIAL (CI test job uses `migrate deploy`; enforcement elsewhere not shown).

## Concurrency and idempotency

- [x] AI action confirmation claims PENDING → EXECUTING with a conditional update — CODE_INSPECTION (`fitness-agent.service.ts` lines 777–826).
- [x] Stale EXECUTING claims are reclaimable after a timeout — CODE_INSPECTION (`fitness-agent.service.ts` around line 430).
- [ ] Double confirm produces exactly one business write under load (P4-T03) — NEEDS_RUNTIME_VERIFICATION.
- [ ] Concurrent bootstrap of nutrition produces one goal (P4-T03) — NEEDS_RUNTIME_VERIFICATION.

## AI safety

- [x] No Prisma write calls in `llm/` or `conversational-intelligence/` modules — CODE_INSPECTION (grep).
- [ ] Conversational Intelligence default and kill switch documented and tested (G-17) — OPEN.
- [ ] With the LLM kill switch off, zero model requests on chat endpoints (G-17) — OPEN (LIVE_LOCAL counterexample).
- [ ] Turn latency budget below client timeout with deterministic fallback (G-18) — OPEN.
- [ ] Circuit breaker for the model endpoint (G-18) — NOT IMPLEMENTED.
- [ ] Prompt-injection evaluation rerun on the release candidate — NOT VERIFIED (harness exists; not executed in this audit).
- [ ] Per-user LLM quota (G-33) — NOT IMPLEMENTED.

## Workflow safety

- [ ] One live draft per session rule decided and enforced (G-26) — PARTIAL.
- [ ] Stale confirmation returns a conflict, never a write (G-26) — NEEDS_RUNTIME_VERIFICATION.

## Reliability

- [ ] `/ready` gates traffic on database and Redis (G-15) — NOT IMPLEMENTED.
- [ ] Redis outage behaviour verified (G-19) — NEEDS_RUNTIME_VERIFICATION.
- [ ] Vector store outage behaviour verified (G-19) — NEEDS_RUNTIME_VERIFICATION.
- [ ] Gateway survives auth-service slowness without total outage (G-16) — OPEN.
- [x] Every service exposes a `/health` endpoint — CODE_INSPECTION (existence). Liveness only.

## Logging

- [x] Structured logs with pino in shared and service code — CODE_INSPECTION.
- [ ] Central redaction of forbidden keys (G-32) — OPEN.
- [ ] Logs free of tokens, OTPs and credentials, verified by test (G-02, G-06) — OPEN (LIVE_LOCAL counterexample).

## Metrics and alerts

- [x] Prometheus-format `/metrics` on every service (prom-client) — CODE_INSPECTION (existence). Not restricted.
- [ ] Metrics collected in the production deployment (G-14) — NOT IMPLEMENTED.
- [ ] LLM latency, timeout and fallback metrics visible (G-14) — NOT VERIFIED.
- [ ] Alert rules for the agreed signals (G-14) — NOT IMPLEMENTED.

## Backups and restore

- [ ] Automated backups with PITR for every database (G-13) — NOT IMPLEMENTED.
- [ ] Restore drill with checksum and timed RTO (G-13) — NOT IMPLEMENTED.
- [ ] Redis and vector-store recovery documented (G-13) — NOT IMPLEMENTED.

## CI

- [x] Install with a frozen lockfile — CODE_INSPECTION (`pnpm install --frozen-lockfile`).
- [x] Unit tests run in CI — CODE_INSPECTION (`pnpm test`). Not executed in this audit.
- [ ] Typecheck in CI (G-11) — OPEN.
- [ ] Lint of TypeScript code in CI (G-11) — OPEN.
- [ ] Dependency and container scans (G-11, G-22) — OPEN.
- [x] Critical DB integration job runs against Postgres 15 — CODE_INSPECTION (`db-integration` job).
- [ ] End-to-end browser suite in CI or on staging (G-11) — OPEN.

## Staging

- [ ] Staging provisioned from IaC (G-12) — OPEN.
- [ ] Staging uses separate secrets (G-01, G-10) — NOT VERIFIED.
- [ ] Staging smoke suite passes after deploy — NOT VERIFIED.

## Load testing

- [ ] Baseline load test measured (P4-T01) — NOT VERIFIED.
- [ ] Capacity for LLM inference measured on target hardware (G-18) — NOT VERIFIED (research host observations only).

## Deployment

- [ ] Deployment target chosen and recorded (G-12) — OPEN.
- [ ] TLS at the edge (G-03) — NOT IMPLEMENTED.
- [ ] Non-root containers for every service (G-31) — PARTIAL (backend and gateway set `USER`; web does not).
- [ ] Health-gated rolling deploy (G-15) — NOT IMPLEMENTED.
- [ ] Production environment variables documented and validated at boot (G-01, G-10) — OPEN.

## Rollback

- [ ] Application rollback rehearsed (previous tag redeployed) — NOT VERIFIED.
- [ ] Database rollback rehearsed from snapshot — NOT VERIFIED.
- [ ] Feature kill switches for AI and payments tested — NOT VERIFIED (G-17, G-23).
