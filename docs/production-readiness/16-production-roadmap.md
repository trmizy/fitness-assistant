# 16 — Production Roadmap

This roadmap is a plan only. The audit does not implement it. Each task references gap IDs from
[15-production-gap-register.md](15-production-gap-register.md).

Order: P0 security and integrity → P1 reliability → P2 AI hardening → P3 observability → P4 performance → P5 staging → P6 launch gate.
Phases are sequential for release gating; tasks inside a phase may run in parallel when dependencies allow.

Each task lists: ID · gaps · dependency · likely files · acceptance · tests · rollback.

---

## Phase P0 — Security and data-integrity blockers

### P0-T01 — Remove JWT literal fallbacks and add production boot guard
- **Gaps:** G-01.
- **Dependency:** none. Must precede key rotation and P0-T04.
- **Files:** `backend/services/auth-service/src/services/auth.service.ts`, `auth-service/src/config/lambda-runtime.ts`, a shared startup
  validation module (new, under `backend/shared/src`), `infra/compose/docker-compose.prod.yml`, `.env.example`.
- **Acceptance:** Production start without `JWT_SECRET` or `JWT_REFRESH_SECRET` exits non-zero. Secrets must differ and be at least 32 characters.
  No literal fallback remains in production code paths (grep gate).
- **Tests:** Boot tests for missing, default, short and equal secrets. Token test: forged literal-signed token returns 401.
- **Rollback:** Revert the code; keep the rotated secrets. Rollback must not reintroduce the literal.

### P0-T02 — Secret rotation and session revocation runbook
- **Gaps:** G-01, G-07.
- **Dependency:** P0-T01.
- **Files:** runbook under `docs/production-readiness/` (new); secret manager configuration.
- **Acceptance:** Access and refresh secrets rotated; all refresh tokens revoked; users re-authenticate. Evidence recorded in the release record.
  Determine from production configuration whether an empty secret was ever in effect.
- **Tests:** Old access and refresh tokens rejected after rotation.
- **Rollback:** Not applicable to revocation; rotate forward only.

### P0-T03 — Redact tokens and secrets from logs
- **Gaps:** G-02, G-32, G-06 (log part).
- **Dependency:** none (can run in parallel with P0-T01).
- **Files:** `auth-service/src/app.ts`, `user-service/src/app.ts`, `backend/shared/src/index.ts` (central `redact` paths), `email.service.ts`.
- **Acceptance:** Logs contain no `authorization`, `cookie`, `token`, `refreshToken`, `password`, `otp` values. `/auth/verify` and `/health` excluded from request logging.
- **Tests:** Logger unit test per forbidden key. Integration: after login and three authenticated calls, the captured log stream contains zero bearer tokens.
- **Rollback:** Disable redaction only in a local environment; never in staging or production.

### P0-T04 — TLS at the production edge
- **Gaps:** G-03.
- **Dependency:** P0-T06 (architecture decision) to know whether ALB/CloudFront or API Gateway is used.
- **Files:** Terraform production environment (new), `frontend/web/nginx.prod.conf`, `infra/compose/docker-compose.prod.yml`, gateway `trust proxy` setting in `backend/gateway/src/app.ts`.
- **Acceptance:** HTTPS only; HTTP redirects with 301; HSTS present; origin reachable only from the edge; `trust proxy` matches hop count.
- **Tests:** TLS scan; redirect check; direct origin request blocked.
- **Rollback:** Re-point DNS to the previous edge only if it is also TLS.

### P0-T05 — Migration safety gate and destructive-statement review
- **Gaps:** G-04, G-13 (partial), G-20 (partial).
- **Dependency:** none for policy; P0-T06 for the target database host.
- **Files:** `backend/services/*/prisma/migrations/**` (review only; no edits to historical migrations), CI workflow, a release runbook (new).
- **Acceptance:** Policy document approved. CI reports every `DROP`, `DELETE`, `UPDATE`, `TRUNCATE` in a migration and requires explicit sign-off.
  Production release requires a recorded snapshot. Historical InBody deletion evaluated for production impact (`NEEDS_RUNTIME_VERIFICATION`).
- **Tests:** CI job lists destructive statements; restore drill to staging applies pending migrations.
- **Rollback:** Restore snapshot (documented RTO).

### P0-T06 — Architecture decision: production deployment target
- **Gaps:** G-12, G-03, G-16.
- **Dependency:** none. This is a decision record, not code.
- **Files:** `docs/production-readiness/` decision note (new); removal or quarantine of the non-chosen deployment path.
- **Acceptance:** One deployment target chosen, owner named, and the other model marked `LEGACY_DEAD_CODE` or deleted in a separate change.
- **Tests:** Not applicable (decision). Subsequent IaC tests are in P5.
- **Rollback:** Decision reversal requires a new record.

---

## Phase P1 — Reliability and required production behaviour

### P1-T01 — Replace OTP storage and attempt policy
- **Gaps:** G-05.
- **Dependency:** P0-T01 (pepper stored with the same secret manager pattern).
- **Files:** `auth-service/src/services/auth.service.ts` (`hashOtp`, `generateOtp`, `resendRegistrationOtp`), `auth.repository.ts` (upsert), Prisma schema for `EmailVerification` (new column or migration if needed).
- **Acceptance:** Stored value is an HMAC or memory-hard hash. Resend does not reset attempts. Cumulative per-email budget with back-off.
- **Tests:** Unit: resend keeps the counter. Unit: stored value cannot be verified without the pepper. Integration: lockout after budget.
- **Rollback:** Old pending rows expire within `OTP_EXPIRY_MINUTES`; a cut-over can invalidate all pending OTPs safely.

### P1-T02 — Invert the debug-OTP gate and remove OTP logging
- **Gaps:** G-06.
- **Dependency:** none.
- **Files:** `auth.service.ts` (lines around 177 and 304), `email.service.ts` (lines 28–34).
- **Acceptance:** No `devOtp` in responses unless an explicit allow flag is set; flag refused in production configuration.
- **Tests:** Unit with `NODE_ENV` unset: no `devOtp`. Boot test with flag in production config fails.
- **Rollback:** Re-enable flag only in local development.

### P1-T03 — Hash refresh tokens and detect reuse
- **Gaps:** G-07.
- **Dependency:** P0-T02 (all existing refresh tokens are revoked at rotation).
- **Files:** `auth.service.ts` (refresh, logout, create), `auth.repository.ts`, `prisma/schema.prisma` (`RefreshToken`), a migration that hashes stored values (or truncates them).
- **Acceptance:** Stored values are hashes. Reuse of a rotated token revokes the user's token family and writes a security event.
- **Tests:** Rotation, replay and revocation integration tests; schema check.
- **Rollback:** Migration is one-way; rollback means re-login for all users.

### P1-T04 — Enforce admin role in auth-service and block internal paths at the gateway
- **Gaps:** G-08, G-09.
- **Dependency:** none.
- **Files:** `auth.routes.ts` and controllers (role check), `backend/gateway/src/routes/proxy.routes.ts` (block `/auth/internal` and `/internal` on the public proxy), `ai-service/src/routes/internal.routes.ts` (timing-safe compare).
- **Acceptance:** Public request to `/auth/internal/*` returns 404. Direct auth-service request without admin role returns 403.
- **Tests:** Gateway route tests; auth-service direct tests; timing-safe comparison unit test.
- **Rollback:** Re-open route only with a documented exception.

### P1-T05 — Unified internal-secret startup validation
- **Gaps:** G-10, G-09 (per-service secrets).
- **Dependency:** P0-T01 (shared validation module).
- **Files:** every service entrypoint (`src/server.ts`, `src/app.ts`) and client file listed in G-10.
- **Acceptance:** Each service fails fast in production when its internal secrets are missing or default. No literal fallback in any client.
- **Tests:** Boot test per service.
- **Rollback:** Not applicable (fail-fast only).

### P1-T06 — CI quality gates
- **Gaps:** G-11, G-22.
- **Dependency:** none.
- **Files:** `.github/workflows/docker-test.yml` (or a new workflow), per-package `package.json` scripts (`typecheck`), ESLint configuration, secret scanner configuration.
- **Acceptance:** Typecheck, lint, dependency audit, container scan and secret scan are required checks. Node version pinned to the production runtime.
- **Tests:** Canary PR failing each gate.
- **Rollback:** Gates may be temporarily set to advisory with an owner and an expiry date recorded.

### P1-T07 — Migration replay and schema-drift check
- **Gaps:** G-20, G-27.
- **Dependency:** P0-T05.
- **Files:** CI workflow; each service's `prisma` directory (no edits to history).
- **Acceptance:** From-zero replay succeeds for every service; `prisma migrate diff` against `schema.prisma` is empty, or differences are listed in an allow-list with rationale.
- **Tests:** The replay job itself.
- **Rollback:** Not applicable (read-only check).

### P1-T08 — Readiness probes and dependency-aware health
- **Gaps:** G-15, G-19 (partial).
- **Dependency:** none.
- **Files:** `app.ts` in each service; `infra/compose/docker-compose.prod.yml` healthchecks.
- **Acceptance:** `/live` and `/ready` exist; `/ready` checks PostgreSQL (and Redis when enabled); compose uses `/ready`.
- **Tests:** Stop the database; `/ready` returns 503.
- **Rollback:** Revert healthcheck target.

### P1-T09 — Gateway local JWT verification and status cache
- **Gaps:** G-16.
- **Dependency:** P0-T01 (same keys), P1-T03.
- **Files:** `backend/gateway/src/middleware/auth.middleware.ts`, auth-service disable event path.
- **Acceptance:** Gateway verifies signatures locally; disabled users rejected within the cache TTL; `/auth/verify` retained for explicit checks.
- **Tests:** Load test before and after; chaos test with auth-service down.
- **Rollback:** Feature flag to restore remote verification.

### P1-T10 — Failure-mode tests for Redis, vector store and LLM
- **Gaps:** G-19, G-18 (partial).
- **Dependency:** P1-T08.
- **Files:** fitness `exercise.repository.ts`, `redis.ts`; AI retrieval service; test harness under `test/`.
- **Acceptance:** Redis outage yields 200 with database data; vector store outage yields stated degraded behaviour; each outage is recorded in metrics.
- **Tests:** Container-stop drills in the local Docker stack; transcripts recorded as LIVE_LOCAL.
- **Rollback:** Not applicable.

### P1-T11 — Backup, restore and RPO/RTO
- **Gaps:** G-13.
- **Dependency:** P0-T06.
- **Files:** IaC (production environment), runbook.
- **Acceptance:** Automated backups with PITR; restore drill with checksum comparison and timed RTO.
- **Tests:** Restore drill transcript.
- **Rollback:** Not applicable.

### P1-T12 — Payment provider hardening
- **Gaps:** G-23.
- **Dependency:** none.
- **Files:** `payment-service/src/providers/payos.provider.ts`, `zalopay.provider.ts`, webhook routes, wallet and membership services; remove DEMO builders from production modules (G-36).
- **Acceptance:** Every provider verifies signatures and fails closed; idempotency keys enforced; reconciliation job exists.
- **Tests:** Forged, replayed and concurrent callbacks per provider.
- **Rollback:** Disable the provider in configuration (payments launch only with verified providers).

### P1-T13 — Cross-user authorization matrix and test suite
- **Gaps:** G-24.
- **Dependency:** none (can start immediately).
- **Files:** a generated matrix document under `docs/production-readiness/` (new), test suite under `test/` (new).
- **Acceptance:** Every user-owned route family listed with identity source and owner check; cross-user tests for each route family pass.
- **Tests:** The suite itself, run against the test databases in CI.
- **Rollback:** Not applicable.

---

## Phase P2 — AI and LLM production hardening

### P2-T01 — Single feature-flag contract for LLM entry points
- **Gaps:** G-17.
- **Dependency:** P1-T13 (matrix includes AI routes).
- **Files:** `conversational-intelligence/index.ts`, `llm/orchestrator.service.ts`, prod compose.
- **Acceptance:** One documented kill switch; with it off, zero model requests on chat endpoints (observed by a harness).
- **Tests:** Harness: count model requests across chat endpoints with the switch off.
- **Rollback:** Switch back to the previous contract (documented).

### P2-T02 — Latency budget, fallback and circuit breaker
- **Gaps:** G-18, G-19.
- **Dependency:** P2-T01.
- **Files:** `llm/orchestrator.service.ts` (timeouts), `llm/json_llm_call.util.ts`, a breaker utility under `backend/shared/src`, gateway proxy timeout.
- **Acceptance:** Turn budget below client timeout; deterministic fallback text on timeout; breaker opens and closes; inference concurrency capped.
- **Tests:** Fault injection (LLM delayed 60 s); breaker transitions; user-visible latency under the budget.
- **Rollback:** Raise the budget through configuration.

### P2-T03 — Per-user AI quotas and cost controls
- **Gaps:** G-33.
- **Dependency:** P1-T09.
- **Files:** gateway `rateLimit.middleware.ts`, AI expensive endpoints.
- **Acceptance:** Per-user daily and per-minute quotas for LLM and image endpoints; limits recorded in the environment contract.
- **Tests:** Quota test: one user limited, another unaffected.
- **Rollback:** Raise quotas.

### P2-T04 — Decide and enforce the live-action rule
- **Gaps:** G-26.
- **Dependency:** product decision.
- **Files:** `fitness-agent.service.ts`, migration (partial unique index, if chosen).
- **Acceptance:** One live draft per session, or explicit selection; superseded confirmation returns 409.
- **Tests:** Concurrent creation and stale confirmation tests.
- **Rollback:** Drop the index in a new migration.

### P2-T05 — Remove internal URL from public AI health
- **Gaps:** G-34.
- **Dependency:** P1-T08.
- **Files:** `ai-service/src/app.ts`.
- **Acceptance:** Public health exposes status only.
- **Tests:** Response contains no hostnames.
- **Rollback:** Not applicable.

---

## Phase P3 — Observability and operational readiness

### P3-T01 — Metrics collection and alert rules
- **Gaps:** G-14.
- **Dependency:** P1-T08.
- **Files:** `infra/monitoring/` (activate), production compose or IaC, alert rules (new).
- **Acceptance:** Alerts for 5xx rate, p95 latency, auth failures, LLM timeout and fallback rate, DB errors, certificate expiry. `/metrics` restricted.
- **Tests:** Injected faults fire alerts in staging.
- **Rollback:** Disable alerts with an owner notified.

### P3-T02 — Workflow and LLM dashboards
- **Gaps:** G-14, G-17.
- **Dependency:** P3-T01, P2-T02.
- **Files:** dashboard definitions (new), metric names in service code.
- **Acceptance:** Dashboards show LLM latency, timeouts, fallback acceptance, confirmation outcomes, duplicate-action rejections.
- **Tests:** Dashboard queries return data in staging.
- **Rollback:** Not applicable.

### P3-T03 — Runbooks and on-call basics
- **Gaps:** G-13, G-14.
- **Dependency:** P1-T11, P3-T01.
- **Files:** `docs/production-readiness/` runbooks (new).
- **Acceptance:** Runbooks for: secret rotation, restore, migration, LLM outage, auth outage, payment webhook failure.
- **Tests:** Tabletop exercise recorded.
- **Rollback:** Not applicable.

---

## Phase P4 — Performance and load testing

### P4-T01 — Baseline load test for gateway and core routes
- **Gaps:** G-16, G-18 (performance evidence).
- **Dependency:** P1-T09, P2-T02.
- **Files:** `test/` load scenarios (new), no product code change.
- **Acceptance:** Measured p50, p95, p99, error rate for login, profile, workout list, AI turn (with LLM on and off). No figures stated without measurement.
- **Tests:** Load run transcript (LIVE_LOCAL or staging).
- **Rollback:** Not applicable.

### P4-T02 — Database query review and indexes
- **Gaps:** (performance review, no specific gap yet).
- **Dependency:** P4-T01.
- **Files:** Prisma schemas and repositories; migrations (additive only).
- **Acceptance:** Slow-query log reviewed; N+1 patterns in the top ten routes eliminated or justified.
- **Tests:** Query-count tests on hot routes.
- **Rollback:** Drop additive index.

### P4-T03 — Concurrency tests for confirmation and bootstrap
- **Gaps:** G-24 (workflow), G-27.
- **Dependency:** P1-T07.
- **Files:** test suite under `test/` (new); fitness and ai services unchanged unless a defect appears.
- **Acceptance:** Double-confirm and concurrent bootstrap produce exactly one business write.
- **Tests:** Parallel requests against the test database.
- **Rollback:** Not applicable.

---

## Phase P5 — Staging deployment

### P5-T01 — Staging environment from IaC
- **Gaps:** G-12, G-03.
- **Dependency:** P0-T06, P0-T04, P1-T11.
- **Files:** Terraform staging environment (new).
- **Acceptance:** Staging provisioned from IaC with TLS, backups, monitoring, and separate secrets.
- **Tests:** Apply from empty account; smoke suite passes.
- **Rollback:** Destroy and recreate.

### P5-T02 — Staging release with migration gate
- **Gaps:** G-04, G-20.
- **Dependency:** P5-T01, P0-T05.
- **Files:** release pipeline (new job).
- **Acceptance:** Snapshot taken; migrations applied; smoke and cross-user suites pass.
- **Tests:** Full release rehearsal.
- **Rollback:** Snapshot restore.

### P5-T03 — End-to-end browser and mobile smoke on staging
- **Gaps:** G-11 (E2E missing in CI).
- **Dependency:** P5-T02.
- **Files:** E2E specs under `frontend/web` and `frontend/mobile` (existing specs: four Playwright specs found).
- **Acceptance:** Registration, login, logout, cross-account switch clears cached data, one AI turn, one confirmation.
- **Tests:** Browser run recorded as REAL BROWSER evidence on staging.
- **Rollback:** Not applicable.

---

## Phase P6 — Production launch gate

### P6-T01 — Go-live checklist sign-off
- **Gaps:** all open P0, P1 items.
- **Dependency:** P0–P5 complete.
- **Files:** [17-go-live-checklist.md](17-go-live-checklist.md).
- **Acceptance:** Every gate checked with evidence reference; no P0 open; P1 items either closed or accepted with owner and date.
- **Tests:** Checklist review.
- **Rollback:** Launch is reversible only if the migration gate and snapshot are proven.

### P6-T02 — Production release tag and rollout
- **Gaps:** G-21 (tagging discipline).
- **Dependency:** P6-T01.
- **Files:** git tag (see README §Research isolation).
- **Acceptance:** Release tag on the production branch; staged rollout with monitoring; rollback plan rehearsed.
- **Tests:** Post-deploy smoke.
- **Rollback:** Previous tag redeployed; migrations are forward-only, so rollback relies on snapshot.
