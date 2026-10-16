# 15 — Production Gap Register

Audience: Gymini engineering and the release owner. Written in English to match the audit request.

Scope: the whole deployable Gymini product (web, mobile, gateway, services, AI, payment, infra, CI). The workout BPM research
benchmark is out of scope; see README §Research isolation.

Evidence labels (see README §Method): `CODE_INSPECTION`, `LIVE_LOCAL`, `TEST_FIXTURE`, `NOT_VERIFIED`.

Status values: `VERIFIED_OK` · `OPEN` · `PARTIAL` · `NEEDS_RUNTIME_VERIFICATION` · `NOT_IMPLEMENTED` · `NOT_APPLICABLE`.

Severity: `P0` production blocker · `P1` required before public production · `P2` hardening · `P3` optional.
`RESEARCH_ONLY` and `LEGACY_DEAD_CODE` are used where appropriate.

## Summary

| ID | Sev | Status | Blocks public prod | Area | Title |
|---|---|---|---|---|---|
| G-01 | P0 | OPEN | Yes | Secrets / Auth | JWT signing secret falls back to a public literal |
| G-02 | P0 | OPEN | Yes | Logging / Auth | Bearer access tokens written to logs |
| G-03 | P0 | NOT_IMPLEMENTED | Yes | Transport | No TLS in the repository's production topology |
| G-04 | P0 | NEEDS_RUNTIME_VERIFICATION | Yes | Database | Destructive migrations with no enforced backup/rollback gate |
| G-05 | P1 | OPEN | Yes | Auth / OTP | OTP stored with unsalted fast hash; attempt counter reset on resend |
| G-06 | P1 | PARTIAL | Yes | Auth / Config | Debug OTP disclosure is fail-open on environment misconfiguration |
| G-07 | P1 | OPEN | Yes | Auth / Sessions | Refresh tokens stored in plaintext; no reuse detection |
| G-08 | P1 | PARTIAL | Yes | Authorization | Admin role/status mutations enforced only at the gateway |
| G-09 | P1 | OPEN | Yes | Authorization / Internal | `/auth/internal/*` reachable through the public proxy; one shared static secret |
| G-10 | P1 | OPEN | Yes | Secrets | Inconsistent fail-fast guards for internal secrets across services |
| G-11 | P1 | OPEN | Yes | CI/CD | CI does not typecheck, lint code, scan dependencies, or deploy |
| G-12 | P1 | OPEN | Yes | Deployment | Deployment target undefined; IaC covers dev only |
| G-13 | P1 | NOT_IMPLEMENTED | Yes | Backup | No automated backup or restore drill |
| G-14 | P1 | NOT_IMPLEMENTED | Yes | Observability | Monitoring and alerting are not part of the production deployment |
| G-15 | P1 | PARTIAL | Yes | Reliability | Health endpoints are liveness-only; no readiness gating |
| G-16 | P1 | OPEN | Yes | Reliability / Perf | Every authenticated request makes a synchronous call to auth-service |
| G-17 | P1 | OPEN | Yes (release decision) | AI / Flags | Conversational Intelligence flag does not govern all LLM use; ships off |
| G-18 | P1 | OPEN | Yes | AI / Latency | LLM timeout budget gives 170 s user-visible turns and degraded text |
| G-19 | P1 | NEEDS_RUNTIME_VERIFICATION | Yes | Reliability | Redis, vector store and LLM outage behaviour not verified |
| G-20 | P1 | PARTIAL | Yes | Database | Migration history contains drift catch-up; fresh replay not proven for all services |
| G-21 | P1 | OPEN | No (blocks research claims) | Provenance | Research artifacts and frozen dataset are untracked by git |
| G-22 | P1 | NOT_VERIFIED | Yes | Dependencies | No dependency vulnerability assessment completed |
| G-23 | P1 | PARTIAL | Yes if payments launch | Payments | Only MoMo and VNPay webhooks verified; PayOS/ZaloPay, refunds, reconciliation unverified |
| G-24 | P1 | NEEDS_RUNTIME_VERIFICATION | Yes | Authorization | Authorization audited by sampling; no complete owner-check matrix or isolation test suite |
| G-25 | P2 | PARTIAL | No | Auth | Login throttling per (IP, email) only; no account lockout |
| G-26 | P2 | PARTIAL | No | Workflow | Multiple live PENDING actions per session not constrained in the database |
| G-27 | P2 | VERIFIED_OK | No | Database | Nutrition single-active invariant lives only in SQL; Prisma schema does not express it |
| G-28 | P2 | OPEN | No | Database | Cross-service `user_id` references are soft (no FK across service databases) |
| G-29 | P2 | PARTIAL | No | Cache | Shared exercise cache depends on every caller applying visibility after the read |
| G-30 | P2 | OPEN | No | Secrets | Development credentials and a credential-bearing script are tracked in the repository |
| G-31 | P2 | OPEN | No | Container | Web container runs as root |
| G-32 | P2 | OPEN | No | Logging | No redaction policy in the shared logger; request logging only in two services |
| G-33 | P2 | PARTIAL | No | Rate limiting | Rate limits are per IP only; no per-user quota on expensive AI endpoints |
| G-34 | P2 | OPEN | No | Info disclosure | AI `/health` returns the internal LLM URL |
| G-35 | P3 | OPEN | No | Repo hygiene | Operational artifacts and reports are tracked under `reports/`, `training/`, and the repository root |
| G-36 | P3 | LEGACY_DEAD_CODE | No | Dead code | Demo-only code paths and Lambda entrypoints of unclear deployment status |

Counts (generated from this file by `docs/production-readiness/README.md` §Counting): see README.

---

## Details

### G-01 — JWT signing secret falls back to a public literal (P0)
- **Area:** Secrets / Authentication.
- **Finding:** `auth.service.ts` (about lines 37–40) signs and verifies access and refresh tokens with
  `process.env.JWT_SECRET || <literal>` and `process.env.JWT_REFRESH_SECRET || <literal>`. The literal is in tracked source.
  `infra/compose/docker-compose.prod.yml` (auth-service, about line 133) passes `JWT_SECRET: ${JWT_SECRET}`. When the host variable
  is unset, compose substitutes an empty string, and `||` selects the public literal. Unlike `INTERNAL_SERVICE_SECRET`, no
  production boot guard exists for the JWT secrets (`lambda-runtime.ts` checks them, but the compose path does not use that file).
- **Evidence:** `CODE_INSPECTION`. The compose substitution behaviour is standard compose semantics; no production container was inspected.
- **Exploit / failure scenario:** An attacker who reads the public source signs an access token with the literal. `verifyToken`
  (auth.service.ts about line 521) loads the user from the database by `userId`, so the forged token impersonates any existing user
  whose UUID the attacker knows. The forged `exp` can be far in the future. Every service trusts this verification through the gateway.
- **Affected components:** auth-service (token issue and verify), gateway `auth.middleware.ts`, every authenticated route.
- **Required fix:** Remove both literal fallbacks. Boot must refuse to start in production when either secret is missing, shorter than
  32 characters, or equal to a known default. Use distinct access and refresh secrets. Rotate both secrets and revoke all refresh
  tokens after deployment. Confirm from the production environment whether an empty secret was ever in effect.
- **Required test:** Boot test: production start with missing or default secret must exit non-zero. Token test: a token signed with the
  public literal must be rejected. Rotation test: refresh tokens issued before rotation must fail.
- **Production blocking?** Yes.
- **Status:** OPEN.

### G-02 — Bearer access tokens written to logs (P0)
- **Area:** Logging / Authentication.
- **Finding:** `services/auth-service/src/app.ts` line 21 mounts `pinoHttp({ logger })` with no redaction or serializer. The gateway
  `auth.middleware.ts` (line 34) calls auth-service `POST /auth/verify` with the user's `Authorization` header on every authenticated
  request. pino-http logs request headers, so each bearer token is written to the log.
- **Evidence:** `LIVE_LOCAL`. In the local stack, the last 2,000 auth-service log lines contained 1,024 `"authorization"` header entries,
  all on `/auth/verify`, each with a three-segment JWT. Values were counted, not copied into this report.
- **Exploit / failure scenario:** Anyone who can read logs (operators, log aggregator, backup, support tooling) can replay an
  access token for its lifetime (15 minutes by default) against any service. Refresh tokens are not in the header, but access tokens
  are sufficient for account impersonation.
- **Affected components:** auth-service request logging; every log sink receiving auth-service output.
- **Required fix:** Configure pino-http redaction for `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`, and
  any `password`, `otp`, `token`, `refreshToken` keys. Skip request logging for `/health`, `/metrics`, and `/auth/verify`. Purge existing
  logs that contain tokens according to the log retention policy.
- **Required test:** Unit test: a request with an `Authorization` header produces a log line with `[Redacted]` and no JWT pattern.
  Integration test: after a login and three authenticated calls, grep the captured log stream for the token and expect zero matches.
- **Production blocking?** Yes.
- **Status:** OPEN.

### G-03 — No TLS in the repository's production topology (P0)
- **Area:** Transport security.
- **Finding:** `infra/compose/docker-compose.prod.yml` publishes exactly one host port, `web` `80:80`. `frontend/web/nginx.prod.conf`
  line 2 is `listen 80`. No ACM certificate, ALB HTTPS listener, CloudFront viewer certificate, HSTS, or HTTP-to-HTTPS redirect exists in
  tracked configuration. `infra/terraform` covers only `environments/dev` and has no HTTPS listener.
- **Evidence:** `CODE_INSPECTION` (absence confirmed by grep across `infra/`, `frontend/web/`, `docker/`).
- **Exploit / failure scenario:** Passwords, OTPs, bearer tokens and refresh tokens are transmitted in cleartext on untrusted networks.
  Combined with G-02 and G-07, interception yields session takeover.
- **Affected components:** web nginx, gateway public exposure, load balancer (absent), `trust proxy` configuration in `gateway/src/app.ts`
  line 22 (assumes one proxy hop).
- **Required fix:** Choose the production edge (see G-12). Terminate TLS at a managed load balancer or CloudFront with an ACM certificate.
  Redirect HTTP to HTTPS. Send HSTS. Set `trust proxy` to match the real hop count. Restrict the security group so only the edge reaches
  the origin.
- **Required test:** TLS check (`openssl s_client` or SSL Labs equivalent) against staging. `curl -I http://` must return a 301 to HTTPS.
  Response must include `Strict-Transport-Security`. A direct request to the origin from outside the edge must fail.
- **Production blocking?** Yes.
- **Status:** NOT_IMPLEMENTED.

### G-04 — Destructive migrations and no enforced backup/rollback gate (P0)
- **Area:** Database / Migrations.
- **Finding:**
  - `backend/services/user-service/prisma/migrations/20260528_inbody_unique_per_day/migration.sql` lines 8–11 run
    `DELETE FROM "inbody_entries"` to keep only the latest row per user and day. The comment calls these rows "legacy duplicates
    (test-data)". InBody entries are measured body state, which the source-of-truth rules assign to measurements. On a database holding
    real measurements, this deletion is irreversible.
  - Across all services, `migration.sql` files contain 2 with `DROP TABLE`, 3 with `DROP COLUMN`, and 3 with `DELETE FROM`
    (one of the DELETEs is `ai-service/.../20260606001000_dedupe_pending_review_items`). The repository has 5 `rollback.sql` files,
    all in fitness-service; no other service ships a rollback.
  - `20260730020000_training_cycle_active_unique_constraint` runs `UPDATE "training_cycles"` (line 28) to resolve violations before adding
    a partial unique index. Its effect on real data depends on prior state.
  - No deployment step runs migrations, takes a snapshot first, or checks migration status. Production compose has no migration service.
- **Evidence:** `CODE_INSPECTION` (file contents above). Production database state was not inspected (`NEEDS_RUNTIME_VERIFICATION`).
- **Exploit / failure scenario:** A future deploy runs a destructive migration against production with no snapshot. Data loss is
  silent and unrecoverable. The InBody migration shows the pattern already exists.
- **Affected components:** every Prisma service; deployment pipeline (absent); RDS (not in IaC).
- **Required fix:** Adopt a migration policy: no data-deleting migration without a reviewed backfill and an explicit approval. Require a
  snapshot before any `migrate deploy` in production, recorded in the release record. Add a dry-run against a restored copy. Prefer
  additive, expand-then-contract migrations. Add rollback procedures for every destructive migration, or document why none is possible.
- **Required test:** CI job runs `prisma migrate deploy` from zero and reports every `DROP`/`DELETE` statement. Restore drill: a
  production snapshot restored to staging applies the pending migrations and passes smoke tests.
- **Production blocking?** Yes.
- **Status:** NEEDS_RUNTIME_VERIFICATION (production state unknown; deployment gate absent in repo, so `NOT_IMPLEMENTED` for the gate).

### G-05 — OTP stored with an unsalted fast hash; attempt counter reset on resend (P1)
- **Area:** Authentication / OTP.
- **Finding:**
  - `auth.service.ts` lines 108–113: `hashOtp` is `sha256(otp)` with no salt and no key. `generateOtp` draws from a 6-digit space
    (900,000 values).
  - `auth.repository.ts` upsert (about line 227): the `update` branch sets `attempts: 0`. `resendRegistrationOtp` calls it, so each
    resend (every `OTP_RESEND_SECONDS`, default 60) gives five new guesses. The lockout at `OTP_MAX_ATTEMPTS` (default 5) is therefore
    per code, not per email. The comment at `auth.service.ts` line 248 states this reset deliberately.
  - Online guessing is bounded only by the gateway `authRateLimiter` (code default 20 requests per 15 minutes per IP).
- **Evidence:**
  - `TEST_FIXTURE` + `LIVE_LOCAL`: the harness function `recoverOtpFromHash` (test/ai-chat-full-verification/lib.mjs) recovers a pending
    OTP from the real `email_verifications.otpHash` column by hashing candidates 100000–999999. Test-only use.
  - Measured in this audit (`CODE_INSPECTION` of the hash function plus a synthetic benchmark on the audit host, Node 24.14.1): hashing
    all 900,000 candidates takes about 1.3 s; a synthetic six-digit value was found after 634,220 hashes in about 1.0 s. No real OTP was used.
  - `CODE_INSPECTION` for the reset and the rate-limit default.
- **Exploit / failure scenario:**
  - Offline: anyone who reads `email_verifications` (backup, replica, SQL injection, operator) recovers every pending OTP in milliseconds.
  - Online: with resend and IP rotation, guessing is slow but not closed. Per-email exhaustion is not enforced.
- **Affected components:** auth-service OTP issue and verify; `email_verifications` table.
- **Required fix:** Store `HMAC-SHA256(serverPepper, otp)` with the pepper in the secret manager, or a memory-hard password hash with a cost
  appropriate for a short-lived code. Do not reset the attempt counter on resend; enforce a cumulative per-email budget with back-off.
  Keep per-IP throttling for both issue and verify. Invalidate the row after a successful verify. Consider a longer code or a link.
- **Required test:** Unit: resend does not reset `attempts`. Unit: verify with a stored hash computed without the pepper fails. Integration:
  repeated wrong codes across resends lock the email at the cumulative budget.
- **Production blocking?** Yes (public registration).
- **Status:** OPEN.

### G-06 — Debug OTP disclosure is fail-open on environment misconfiguration (P1)
- **Area:** Authentication / Configuration.
- **Finding:** `auth.service.ts` (about line 177 and line 304) returns `devOtp` in the HTTP response when email was not delivered and
  `NODE_ENV !== "production"`. `services/email.service.ts` lines 28–34 log the OTP in plaintext with
  "SMTP not configured. Using development OTP fallback." when SMTP is absent (it throws in production).
- **Evidence:** `CODE_INSPECTION`. `LIVE_LOCAL`: the local stack logged the OTP field 60 times in the last 2,000 lines (the stack has no SMTP).
  Prod compose sets `NODE_ENV: production` for auth-service (verified).
- **Exploit / failure scenario:** If a deployment's `NODE_ENV` is unset, misspelled, or set to `staging` while the service is public,
  `devOtp` is returned to the caller. The caller can verify any registration started with a victim's email and take over the pending
  account. The log path also exposes codes to anyone with log access.
- **Affected components:** auth-service register and resend; email service.
- **Required fix:** Invert the gate. Expose debug OTP only when an explicit allow-list flag (for example `AUTH_ALLOW_DEV_OTP=true`) is set,
  and refuse to boot in any environment where that flag and a public listener coexist. Remove OTP from logs entirely, including the fallback.
- **Required test:** Unit: with `NODE_ENV` unset and the allow flag off, the response never contains `devOtp`. Boot test: flag on in
  production configuration fails startup.
- **Production blocking?** Yes, until the gate is inverted.
- **Status:** PARTIAL (production compose sets `NODE_ENV`; the default is still fail-open).

### G-07 — Refresh tokens stored in plaintext; no reuse detection (P1)
- **Area:** Authentication / Sessions.
- **Finding:** `prisma/schema.prisma` `RefreshToken` (lines 101–111) stores the raw JWT in `token` (`@unique`).
  `auth.service.ts` line 85 writes the raw value. Refresh (around lines 467–506) deletes the presented token and creates a new one
  (rotation), but a replayed old token is simply not found. No token family is revoked when reuse is detected.
- **Evidence:** `CODE_INSPECTION`.
- **Exploit / failure scenario:** A database read yields working refresh tokens valid for seven days. A stolen token used after the
  legitimate user rotated it gives the attacker a session without alerting anyone.
- **Affected components:** auth-service sessions; `refresh_tokens` table.
- **Required fix:** Store `SHA-256(refreshToken)`; the value is high-entropy so no salt is needed. On refresh, if a presented token is
  already rotated, revoke all tokens for that user and record a security event. Add an index on the hash.
- **Required test:** Integration: rotate, replay the old token, expect 401 and revocation of the new token too. Schema test: no row
  contains a value that verifies as a JWT.
- **Production blocking?** Yes.
- **Status:** OPEN.

### G-08 — Admin mutations enforced only at the gateway (P1)
- **Area:** Authorization.
- **Finding:** `auth-service/src/routes/auth.routes.ts` lines 28–35 route `PATCH /users/:userId/role`, `/disable`, `/enable`, and `/name`
  to controllers with no role check. Only the gateway enforces ADMIN (`gateway/src/routes/proxy.routes.ts` lines 1589–1606, `requireRoles("ADMIN")`).
  The controller refuses to assign the ADMIN role (`auth.controller.ts`, about line 355), but not to other callers.
- **Evidence:** `CODE_INSPECTION`. Not tested by bypassing the gateway (`NEEDS_RUNTIME_VERIFICATION`). Production compose publishes no
  auth-service port, so the gateway is the only path in that topology.
- **Exploit / failure scenario:** Any future route, misconfigured network rule, or dev-compose port exposure that reaches auth-service
  directly lets any authenticated user change any user's role to PT, GYM_OWNER, or CUSTOMER, or disable other accounts.
- **Affected components:** auth-service user administration routes.
- **Required fix:** Enforce the caller's role in auth-service from the verified token (or a verified gateway identity header plus an
  internal secret). Keep the gateway check.
- **Required test:** Direct request to auth-service without an admin token returns 403 for each admin route.
- **Production blocking?** Yes (defense in depth), but currently mitigated by network topology.
- **Status:** PARTIAL.

### G-09 — `/auth/internal/*` reachable through the public proxy; one shared static secret (P1)
- **Area:** Authorization / internal APIs.
- **Finding:** The public catch-all `router.use("/auth", authRateLimiter, proxy)` (`proxy.routes.ts` lines 1617–1625) forwards every path,
  including `/auth/internal/*` (partner-auth, batch user lookup, user lookup, send-email, role). Each handler checks `x-service-secret`,
  but the comparison is `!==` (not constant-time), and one secret, `INTERNAL_SERVICE_SECRET`, is used by every service. The ai-service
  internal route compares the same way (`ai-service/src/routes/internal.routes.ts` around lines 28–33).
- **Evidence:** `CODE_INSPECTION`.
- **Exploit / failure scenario:** Anyone reaching the gateway can probe internal endpoints. A leaked shared secret grants internal
  privileges in every service: user lookup, email sending, role changes.
- **Affected components:** gateway proxy; auth-service and ai-service internal handlers; all service-to-service clients.
- **Required fix:** Block `/auth/internal` and `/internal` at the gateway with a 404. Use `crypto.timingSafeEqual`. Issue per-service secrets,
  or use network-level identity (VPC-only listeners, IAM/SigV4, or mTLS).
- **Required test:** Gateway test: `/auth/internal/users/x` returns 404 from the public origin. Unit: timing-safe comparison used.
- **Production blocking?** Yes.
- **Status:** OPEN.

### G-10 — Inconsistent fail-fast guards for internal secrets (P1)
- **Area:** Secrets.
- **Finding:** Production guards exist in gateway `utils/internal-secret.ts`, auth-service `controllers/auth.controller.ts` (about line 25),
  and the user, payment and gym `serviceSecret` middlewares. Outbound clients in other services fall back to dev literals:
  `ai-service/src/clients/fitness.client.ts` line 11, `ai-service/src/clients/user.client.ts` line 12,
  `fitness-service/src/clients/ai.client.ts` line 26, `chat-service/src/services/chat.policy.ts` line 7 (and others). The fitness-service
  inbound middleware is described as fail-fast (comment "M6"), but was not traced end to end.
- **Evidence:** `CODE_INSPECTION`.
- **Exploit / failure scenario:** A service missing its secret in production sends the public default in its outbound calls. Any
  receiver that does not boot-guard accepts them.
- **Affected components:** ai, fitness, chat, gym, payment, user, auth clients and middlewares.
- **Required fix:** One shared startup module that validates every internal secret (present, not default, length, distinct per purpose)
  and is imported by every service entrypoint. Remove all literal fallbacks.
- **Required test:** Each service's boot test in `NODE_ENV=production` with missing or default secret must fail.
- **Production blocking?** Yes.
- **Status:** OPEN.

### G-11 — CI does not typecheck, lint code, scan dependencies, or deploy (P1)
- **Area:** CI/CD.
- **Finding:** `.github/workflows/docker-test.yml` runs install, `pnpm run lint` (root script `node scripts/check-repo-hygiene.mjs`,
  which checks repository hygiene, not TypeScript or ESLint), build, unit tests, AI evaluation and policy tests, a fast Docker test, and a
  Postgres-only "critical DB integration" job covering four files. No `tsc --noEmit` appears in CI or any package script. CI uses Node 20;
  local development uses Node 24.14.1. No SAST, dependency audit, secret scan, container scan, end-to-end browser test, migration step,
  deployment, or smoke test runs in CI.
- **Evidence:** `CODE_INSPECTION`. Root `package.json` script list reviewed.
- **Exploit / failure scenario:** Type errors and vulnerable dependencies merge and ship. The release process has no automated gate
  beyond unit tests.
- **Affected components:** CI workflow, root and service `package.json` scripts.
- **Required fix:** Add per-package `typecheck`; add ESLint with a security plugin; run `pnpm audit` and a container scan; run a secret
  scanner; pin Node to the production runtime; add migration-from-zero and smoke stages; add an E2E stage against a staging deploy.
- **Required test:** CI fails on an intentional type error and on a known-vulnerable dependency in a canary branch.
- **Production blocking?** Yes.
- **Status:** OPEN.

### G-12 — Deployment target undefined; IaC covers dev only (P1)
- **Area:** Deployment.
- **Finding:** `infra/terraform/environments/` contains only `dev`. Modules: `cloudfront-spa`, `iam`, `lambda-http-api` (one generic
  Lambda with a log group and an API Gateway permission), `private-s3-bucket`. No RDS, ALB, WAF, ECS, EC2, backup, alarm, or production
  environment is defined. `infra/compose/docker-compose.prod.yml` runs services on one host and points `DATABASE_URL` at an RDS endpoint
  that is not provisioned in repo. Lambda entrypoints exist in ai-service (`lambda.ts`, `jobs-lambda.ts`, `worker-lambda.ts`,
  `migrate-lambda.ts`) and auth-service. Two deployment models coexist without a documented decision.
- **Evidence:** `CODE_INSPECTION`.
- **Exploit / failure scenario:** Production cannot be recreated from the repository. Security settings (TLS, WAF, backups, network
  isolation) depend on undocumented manual setup.
- **Affected components:** Terraform, compose prod file, Lambda handlers.
- **Required fix:** Record an architecture decision (EC2 compose or Lambda or ECS). Provision the chosen target entirely from IaC for a
  production environment. Delete or quarantine the other model.
- **Required test:** A fresh account can apply the IaC to a new environment and pass the staging smoke suite.
- **Production blocking?** Yes.
- **Status:** OPEN.

### G-13 — No automated backup or restore drill (P1)
- **Area:** Backup / restore.
- **Finding:** The repository has no backup configuration. The only backup-related material is documentation of one-off data migration
  (`docs/aws-full-local-data-migration-final-reconciliation.md`) and `pg_dump` references there. No RDS retention, PITR, or restore runbook exists.
- **Evidence:** `CODE_INSPECTION`.
- **Exploit / failure scenario:** Corruption, a destructive migration (G-04), or deletion cannot be recovered within a defined RPO/RTO.
- **Affected components:** RDS (or database host), Redis persistence (`appendonly yes` only), Qdrant volumes.
- **Required fix:** Enable automated backups with point-in-time recovery and retention. Document RPO/RTO. Run a restore drill to a new instance
  and verify row counts and smoke tests. Back up Qdrant and MinIO volumes or document them as rebuildable.
- **Required test:** Restore drill transcript with checksums and a timed RTO.
- **Production blocking?** Yes.
- **Status:** NOT_IMPLEMENTED.

### G-14 — Monitoring and alerting not part of production deployment (P1)
- **Area:** Observability.
- **Finding:** `infra/monitoring/prometheus.yml` and a Grafana directory exist, but `docker-compose.prod.yml` contains no Prometheus, Grafana,
  Alertmanager, Loki, or CloudWatch configuration (zero matches). Services expose `/metrics` (prom-client, `shared/src/metrics.ts`) without
  authentication (`app.get("/metrics", …)` is registered in every service `app.ts` with no auth middleware in front of it; `CODE_INSPECTION`).
  No alert rules exist in the repository. LLM latency, timeout, and fallback counters are not evidenced as dashboards.
- **Evidence:** `CODE_INSPECTION`.
- **Exploit / failure scenario:** Outages, LLM timeouts, error spikes, and token-log exposure go unnoticed.
- **Affected components:** production compose, all service `/metrics` endpoints.
- **Required fix:** Deploy metrics collection and alert rules for: 5xx rate, p95 latency per route, auth failures, LLM timeout and fallback
  rate, DB connection errors, queue or job failures, certificate expiry. Restrict `/metrics` to the internal network or require a token.
- **Required test:** Staging alert fires when a fault is injected (for example, stopping the LLM container).
- **Production blocking?** Yes.
- **Status:** NOT_IMPLEMENTED.

### G-15 — Health endpoints are liveness-only (P1)
- **Area:** Reliability / Health.
- **Finding:** `/health` in auth, chat, fitness, gym, payment and user services returns a static `status: "ok"` (for example
  `fitness-service/src/app.ts` lines 32–34). AI `/health` checks the LLM (`llmService.getHealthStatus()`) and reports retrieval availability,
  but does not gate on PostgreSQL or Redis. Compose health checks use these endpoints.
- **Evidence:** `CODE_INSPECTION`.
- **Exploit / failure scenario:** A service whose database connection is broken reports healthy, receives traffic, and returns 500s.
- **Affected components:** every service health handler; compose and orchestrator health checks.
- **Required fix:** Separate `/live` (process) from `/ready` (checks PostgreSQL with `SELECT 1`, Redis when enabled, required config present).
  Route traffic and rolling deploys on `/ready`.
- **Required test:** Stop the database container; `/ready` must return 503 and the service must leave the load balancer.
- **Production blocking?** Yes.
- **Status:** PARTIAL.

### G-16 — Synchronous auth round-trip on every authenticated request (P1)
- **Area:** Reliability / Performance.
- **Finding:** `gateway/src/middleware/auth.middleware.ts` line 34 calls auth-service `/auth/verify` for each request, and the downstream
  service calls `/auth/verify` again in some clients (`ai-service/src/clients/auth-service.client.ts`, `chat-service/.../auth-service.client.ts`,
  `fitness-service/.../auth-service.client.ts`). No caching or local signature verification is used at the gateway.
- **Evidence:** `CODE_INSPECTION`. `LIVE_LOCAL`: `/auth/verify` appeared in logs for requests through the stack.
- **Exploit / failure scenario:** Auth-service latency or outage becomes a platform-wide outage. Each request pays an extra network hop
  and a database read. Bearer tokens are logged (G-02) on every call.
- **Affected components:** gateway, ai/chat/fitness clients, auth-service verify route.
- **Required fix:** Verify the JWT signature locally at the gateway with the rotated secret (the same keys as G-01), with a short-lived
  user-status cache invalidated on disable. Keep `/auth/verify` for explicit checks. Remove the duplicate verification in downstream services
  where the gateway identity headers are trusted.
- **Required test:** Load test: p95 added latency per request before and after. Chaos test: auth-service stopped; cached-valid tokens still
  work for a bounded window; disabled users are rejected within the cache TTL.
- **Production blocking?** Yes (availability coupling).
- **Status:** OPEN.

### G-17 — Conversational Intelligence flag does not govern all LLM use; ships off (P1)
- **Area:** AI / Feature flags.
- **Finding:** `conversational-intelligence/index.ts` (lines 24–27): `ciMode()` defaults to `off`, `ciLlmAllowed()` defaults to `off`.
  Production compose sets no `CONVERSATIONAL_INTELLIGENCE_*` variable, so production runs with Conversational Intelligence off.
  `shadow` is an accepted third mode with no documented semantics. Separately, the orchestrator issues `/api/chat` requests to Qwen for
  UNKNOWN, WRITE_ACTION and KNOWLEDGE turns regardless of the CI LLM flag.
- **Evidence:** `CODE_INSPECTION` (defaults). `LIVE_LOCAL`: with `CONVERSATIONAL_INTELLIGENCE_V2_LLM=off`, three Qwen `/api/chat` calls
  occurred (one during a warmup turn, two during a benchmark turn), each ending in HTTP 500 after 170 seconds.
- **Exploit / failure scenario:** Operators believe "LLM off" disables the model. Users experience long waits and degraded text. The
  release that "ships CI-V2" actually ships the legacy path, so the X1–X4 closures do not apply in production.
- **Affected components:** `conversational-intelligence/index.ts`, `llm/orchestrator.service.ts`, prod compose.
- **Required fix:** Make one feature-flag contract for every LLM entry point with an explicit default and a single kill switch. Document
  `shadow`, or remove it. Decide whether CI-V2 ships in the first production release (product decision; see README §Decisions required).
- **Required test:** With the kill switch off, a test harness must observe zero model requests across the chat endpoints.
- **Production blocking?** Yes (release decision).
- **Status:** OPEN.

### G-18 — LLM timeout budget produces 170-second user-visible turns (P1)
- **Area:** AI / Latency.
- **Finding:** `LLM_TIMEOUT_MS=170000` (prod and verification compose). Observed turns took 171.6 s and 172.7 s before returning a degraded
  message "Tạm thời AI chưa sẵn sàng…". `llm/orchestrator.service.ts` (lines 84–86) defaults to 60,000 ms when the variable is absent, so the
  effective timeout depends on which variable is set. Client-side HTTP timeout in the benchmark harness was 240 s.
- **Evidence:** `LIVE_LOCAL` (research harness logs and Ollama access log, 500 responses after 2m50s). `CODE_INSPECTION` (defaults).
- **Exploit / failure scenario:** Users wait nearly three minutes and receive a generic failure. Retries multiply load. Under concurrency,
  queued CPU inference (no GPU in the observed host) starves other turns.
- **Affected components:** orchestrator, Ollama client, gateway proxy timeout, mobile and web clients.
- **Required fix:** Set a per-turn budget shorter than the client timeout (for example 20–30 s), with a deterministic fallback response
  when exceeded. Add a circuit breaker that opens after repeated timeouts. Cap concurrent inference requests. Unify the timeout variable.
- **Required test:** Fault injection (LLM delayed 60 s): user receives the fallback within the budget; breaker opens after N failures and
  closes after recovery.
- **Production blocking?** Yes.
- **Status:** OPEN.

### G-19 — Redis, vector store and LLM outage behaviour not verified (P1)
- **Area:** Reliability.
- **Finding:** `fitness-service/src/repositories/redis.ts` substitutes a no-op client when Redis is disabled, and the exercise repository
  depends on `redisClient.get/setEx` in the request path (for example `exercise.repository.ts` lines 85–92). The AI health endpoint reports
  `retrieval: degraded` when Qdrant is unavailable, but no test confirms user-facing behaviour. Redis is in the compose stack; no
  failure drill exists.
- **Evidence:** `CODE_INSPECTION`. Live outage tests were not run in this audit (`NEEDS_RUNTIME_VERIFICATION`).
- **Exploit / failure scenario:** A Redis outage raises exceptions in cache reads on request paths, or serves stale data after
  invalidation is skipped.
- **Affected components:** fitness exercise cache, training-cycle progress cache, AI retrieval, rate limiters that use Redis
  (`partnerApplicationRateLimit.middleware.ts` uses Redis when `REDIS_URL` is set).
- **Required fix:** Wrap cache calls in timeouts and treat errors as cache misses. Define degraded behaviour for each dependency. Add a
  readiness signal for each dependency.
- **Required test:** Stop Redis; request exercise list and detail; expect 200 with database data. Stop Qdrant; expect graceful retrieval
  degradation with a stated user message.
- **Production blocking?** Yes (reliability test is required before public release).
- **Status:** NEEDS_RUNTIME_VERIFICATION.

### G-20 — Migration history contains drift catch-up; fresh replay not proven for all services (P1)
- **Area:** Database / Migrations.
- **Finding:** Catch-up migrations exist in several services (for example `fitness-service/.../20260816000000_catch_up_db_push_drift`,
  `user-service/.../20260812000000_catch_up_db_push_drift`). Their headers state that tables were created with `prisma db push` and never
  had migrations. The fitness catch-up file also drops an index (`DROP INDEX IF EXISTS "workout_schedules_user_status_idx"`) "safe" by a
  comment. CI runs `prisma migrate deploy` only for the test databases used by the critical DB job.
- **Evidence:** `CODE_INSPECTION`.
- **Exploit / failure scenario:** A new environment built from migrations differs from the one that developers use. Production schema
  diverges silently.
- **Affected components:** Prisma migrations for all services.
- **Required fix:** Prove from-zero replay for every service in CI, then compare schema with `prisma migrate diff --from-migrations
  --to-schema-datamodel` and require an empty diff. Stop `db push` in any non-local environment.
- **Required test:** CI job: create an empty database, replay all migrations, diff against `schema.prisma`; diff must be empty.
- **Production blocking?** Yes.
- **Status:** PARTIAL.

### G-21 — Research artifacts and frozen dataset are untracked by git (P1, not product-blocking)
- **Area:** Provenance / separation.
- **Finding:** `git status` on `aws-deploy` (HEAD `81d9f432`) shows 171 modified or untracked entries before this audit. Research artifacts
  (`test/research/workout-plan-bpm/`, `results/research/workout-plan-bpm/`, `docs/research/workout-plan-bpm/`) are untracked. The frozen
  dataset `frozen-150.v1.jsonl` (SHA-256 `eedb1adb…cc849`) and the evaluator manifest exist only in the working tree.
- **Evidence:** `CODE_INSPECTION` (git status and ls-files). Hashes recorded in `results/research/workout-plan-bpm/20261003T054521Z/`.
- **Exploit / failure scenario:** The research claims cannot be re-derived from a commit. Product work can accidentally edit the frozen
  files, and the research snapshot cannot be proven unchanged.
- **Affected components:** research folders; git history.
- **Required fix:** See README §Research isolation (dedicated branch and annotated tag; no edits to frozen paths on production branches).
- **Required test:** `git tag -v` (or `git cat-file`) reproduces the dataset SHA-256 from the tagged commit.
- **Production blocking?** No (blocks publication of research claims).
- **Status:** OPEN.

### G-22 — No dependency vulnerability assessment completed (P1)
- **Area:** Dependencies.
- **Finding:** `pnpm audit --prod --json` produced no usable output in this environment (network or registry access not confirmed). CI does
  not run any audit. The repository has a large dependency surface (pnpm workspaces across 7 services, gateway, web, mobile).
- **Evidence:** `NOT_VERIFIED`.
- **Exploit / failure scenario:** Known vulnerable packages reach production (for example in Express, Prisma, axios, socket.io, jsonwebtoken).
- **Affected components:** every `package.json` and `pnpm-lock.yaml`.
- **Required fix:** Run `pnpm audit` with network access; triage findings; add the audit and a container image scan to CI with a severity
  threshold; pin and update the lockfile in a dedicated change.
- **Required test:** CI fails on a critical advisory in a canary.
- **Production blocking?** Yes until assessed.
- **Status:** NOT_VERIFIED.

### G-23 — Payment webhooks: MoMo and VNPay verified; other providers and money flows unverified (P1)
- **Area:** Payments.
- **Finding:** MoMo and VNPay webhook handlers call `verifyWebhookSignature`, and both fail closed when the signing key is empty
  (`momo.provider.ts` lines 94–100 and `vnpay.provider.ts` lines 150–154). PayOS and ZaloPay providers exist (`payos.provider.ts`,
  `zalopay.provider.ts`); their webhook verification was not traced. Refund idempotency, double-credit protection, reconciliation and
  provider timeout handling were not audited. `vnpay.provider.ts` (around line 53) contains a DEMO-only return-URL builder.
- **Evidence:** `CODE_INSPECTION` for MoMo and VNPay (verified). Others `NOT_VERIFIED`.
- **Exploit / failure scenario:** A forged PayOS or ZaloPay callback marks a payment as settled. A retried callback double-credits a wallet
  or membership.
- **Affected components:** payment-service providers, webhook routes, wallet and membership services.
- **Required fix:** Apply the same fail-closed signature check to every provider. Enforce idempotency keys per provider transaction. Add
  reconciliation against provider reports. Remove demo builders from production modules.
- **Required test:** Replayed callback test per provider; forged signature test; concurrent duplicate callback test.
- **Production blocking?** Yes, if payments launch in this release.
- **Status:** PARTIAL.

### G-24 — Authorization audited by sampling; no complete owner-check matrix or isolation suite (P1)
- **Area:** Authorization / User isolation.
- **Finding:** Sampled controls are sound (coach-client relationship, marketplace withdraw owner check, chat join participant check, AI
  action confirm scoped by `userId`, workflow lookups scoped by `userId` and `sessionId`). The repository has 43 `findUnique({ where: { id } })`
  call sites outside tests across fitness, user, payment and gym (most are scripts; not all were classified). Other marketplace mutations
  (republish, adopt, review) were not traced. No cross-service isolation test suite exists beyond the conversational verification harness.
- **Evidence:** `CODE_INSPECTION` (samples). `TEST_FIXTURE` (the conversational X4 matrix covers AI-chat isolation for specific cases).
- **Exploit / failure scenario:** An id-only lookup on a user-owned resource returns another user's data or allows mutation.
- **Affected components:** fitness, user, payment, gym, ai, chat services.
- **Required fix:** Produce a matrix of every user-owned route with its identity source and owner check. Add a cross-user test for each
  route family (user A reads, updates, deletes user B's id; expect 403 or 404).
- **Required test:** Generated cross-user test suite over the matrix, run in CI against the test databases.
- **Production blocking?** Yes.
- **Status:** NEEDS_RUNTIME_VERIFICATION.

### G-25 — Login throttling per (IP, email) only; no account lockout (P2)
- **Area:** Authentication.
- **Finding:** `auth.routes.ts` line 22 applies `loginRateLimit` keyed by IP and email (BUG-021). The gateway `authRateLimiter` is per IP.
  No account lockout or back-off exists. Shared NAT addresses can cause false positives.
- **Evidence:** `CODE_INSPECTION`.
- **Exploit / failure scenario:** Distributed password guessing against one account stays under the per-IP and per-pair limits.
- **Affected components:** auth-service login, gateway limiter.
- **Required fix:** Add per-account progressive back-off with an unlock path, and alerting on repeated failures.
- **Required test:** Twenty failed logins from twenty IPs produce a lock or back-off on the account.
- **Production blocking?** No.
- **Status:** PARTIAL.

### G-26 — Multiple live PENDING actions per session not constrained (P2)
- **Area:** Workflow state.
- **Finding:** `agent_workflow_sessions` has a partial unique index per (user, session) for active workflows (schema comment, migration
  `20260916090000_agent_workflow_session_active_unique`). `fitness_agent_actions` has no equivalent. `tryConfirmationBoundary` selects the
  most recent live action in code.
- **Evidence:** `CODE_INSPECTION`.
- **Exploit / failure scenario:** Two drafts can be pending at once. The user confirms the wrong one, or a stale draft is confirmed after a
  newer one was discarded in the UI.
- **Affected components:** fitness-agent action lifecycle; confirmation boundary.
- **Required fix:** Decide the product rule (one live draft per session, or explicit selection). Enforce it with a partial unique index if
  chosen.
- **Required test:** Concurrent draft creation test; confirmation of a superseded draft returns 409.
- **Production blocking?** No.
- **Status:** PARTIAL.

### G-27 — Nutrition single-active invariant lives only in SQL (P2)
- **Area:** Database.
- **Finding:** `nutrition_goals_user_id_active_unique` is created in migration `20260818020000_add_nutrition_goal_versioning`
  (a partial unique index). The Prisma model (`fitness-service/prisma/schema.prisma`, `NutritionGoal`) declares `userId` and `status` with no
  unique constraint. The initial migration `20260525122000` created a plain unique on `user_id`, which the versioning migration replaced.
- **Evidence:** `CODE_INSPECTION`. The invariant is present in the database for migrated environments.
- **Exploit / failure scenario:** `prisma migrate dev` or a schema-only comparison reports drift, and a future developer "fixes" the schema
  by dropping the index.
- **Affected components:** fitness-service Prisma schema and migrations.
- **Required fix:** Document the partial index in the schema comment (as done for workflow sessions) and add it to the drift allow-list.
- **Required test:** The G-20 replay-and-diff job recognises the partial index.
- **Production blocking?** No.
- **Status:** VERIFIED_OK (database enforces the invariant on migrated environments).

### G-28 — Cross-service `user_id` references are soft (P2)
- **Area:** Database.
- **Finding:** Each service owns its database, and `user_id` columns reference users in other services without foreign keys (the
  schema comment for `UserEquipment` confirms "FK-by-value"). Orphan rows can persist after a user is deleted in auth or user-service.
- **Evidence:** `CODE_INSPECTION`.
- **Exploit / failure scenario:** Deleted users keep data, and an id reused in another context can attach to old rows.
- **Affected components:** all service databases.
- **Required fix:** Define a deletion and anonymisation workflow across services (event or saga) and a periodic reconciliation job that
  reports orphans.
- **Required test:** Delete a user through the supported path; reconciliation reports zero orphans.
- **Production blocking?** No.
- **Status:** OPEN.

### G-29 — Shared exercise cache depends on every caller applying visibility after the read (P2)
- **Area:** Cache / Isolation.
- **Finding:** `fitness-service/src/repositories/exercise.repository.ts` caches by `exercise:${id}` and `exercise-detail:${id}` without user
  scope (lines 84–108). The repository returns the cached row for any caller, and visibility for `USER_CUSTOM` exercises is applied by the
  caller (`exercise-history.service.ts` documents this reuse). Cache entries are not invalidated on update (300-second staleness).
- **Evidence:** `CODE_INSPECTION`.
- **Exploit / failure scenario:** A future caller forgets the visibility check and exposes another user's custom exercise. Stale exercise
  data is served for up to five minutes.
- **Affected components:** exercise repository and its callers.
- **Required fix:** Move the visibility check into the repository layer for every read, cache only system exercises, and invalidate on update.
- **Required test:** Cross-user test: user B cannot read user A's `USER_CUSTOM` exercise by id via the cache.
- **Production blocking?** No.
- **Status:** PARTIAL.

### G-30 — Development credentials and a credential-bearing script are tracked (P2)
- **Area:** Secrets hygiene.
- **Finding:** `backend/services/ai-service/fix.js` (tracked) sets a `DATABASE_URL` with a development password. CI
  (`.github/workflows/docker-test.yml`) and `docker-compose.test.yml` use development database credentials. `.env.example` files contain
  placeholder values. No real production secret was found in tracked files (the check masked values; findings are locations only).
- **Evidence:** `CODE_INSPECTION`. Values deliberately not reproduced.
- **Exploit / failure scenario:** If the same credentials are reused in production, a public repository exposes the database.
- **Affected components:** `fix.js`, CI workflow, test compose, env examples.
- **Required fix:** Delete one-off scripts with credentials or move them to an ignored location. Use CI secrets for any non-local credential. Add
  a secret scanner (gitleaks or equivalent) as a required check.
- **Required test:** Secret scanner passes on the default branch; no literal match for the production secret naming pattern.
- **Production blocking?** No, but required before public release for hygiene.
- **Status:** OPEN.

### G-31 — Web container runs as root (P2)
- **Area:** Container security.
- **Finding:** `frontend/web/Dockerfile` has no `USER` directive. All backend service and gateway Dockerfiles do set `USER`.
- **Evidence:** `CODE_INSPECTION`.
- **Exploit / failure scenario:** A compromise of nginx gains root inside the container.
- **Affected components:** web image.
- **Required fix:** Use an unprivileged nginx image or add a `USER` directive and listen on a port above 1024.
- **Required test:** `docker run ... id -u` returns non-zero.
- **Production blocking?** No.
- **Status:** OPEN.

### G-32 — No redaction policy in the shared logger (P2)
- **Area:** Logging.
- **Finding:** `backend/shared/src/index.ts` creates `pino({ level })` with no `redact`. Only auth and user services mount `pino-http`.
  Business logs include `userId` and `sessionId` (acceptable), but no central list of forbidden keys exists.
- **Evidence:** `CODE_INSPECTION`.
- **Exploit / failure scenario:** A future log line includes a token, OTP, or raw profile payload.
- **Affected components:** shared logger and every service that imports it.
- **Required fix:** Central `redact` paths in the shared logger, plus a lint rule or test that flags forbidden keys.
- **Required test:** Logger unit test with each forbidden key.
- **Production blocking?** No (covered in part by G-02).
- **Status:** OPEN.

### G-33 — Rate limits are per IP only (P2)
- **Area:** Rate limiting.
- **Finding:** Gateway limiters (`rateLimit.middleware.ts`): general 100 requests per minute per IP by default, auth 20 per 15 minutes per IP,
  AI ask 20 per minute per IP. The live dev stack showed a general limit of 2,000 per minute, so production values are environment-dependent
  and unknown. No per-user quota exists for expensive AI endpoints (`/ai/agent/image-chat`, `/ai/agent/goal-image`).
- **Evidence:** `CODE_INSPECTION` (defaults). `LIVE_LOCAL` (header `RateLimit-Limit: 2000` observed on the dev gateway).
- **Exploit / failure scenario:** One authenticated user runs up model cost and starves other users behind the same NAT.
- **Affected components:** gateway limiters; AI expensive endpoints.
- **Required fix:** Add per-user quotas and cost budgets for LLM and image endpoints. Record production limit values in the environment
  contract.
- **Required test:** Single user exceeding quota gets 429 while another user is unaffected.
- **Production blocking?** No.
- **Status:** PARTIAL.

### G-34 — AI `/health` returns the internal LLM URL (P2)
- **Area:** Information disclosure.
- **Finding:** `ai-service/src/app.ts` lines 51–62 return `llmUrl` and the full `llm` status object from `/health`.
- **Evidence:** `CODE_INSPECTION`.
- **Exploit / failure scenario:** If the health route is reachable from outside, internal network topology is disclosed.
- **Affected components:** ai-service health route.
- **Required fix:** Return only `status` and coarse booleans on the public route. Move detail to an authenticated internal route.
- **Required test:** Public health response contains no internal hostnames.
- **Production blocking?** No.
- **Status:** OPEN.

### G-35 — Operational artifacts tracked in the repository (P3)
- **Area:** Repository hygiene.
- **Finding:** `reports/data/` (four tracked files), `training/` (18 tracked files), and root-level AWS cost-explorer JSON files
  (`ce-*.json`), `tmp-ai-request.json`, and `overrides-*.json` are present. `skills-main.zip` (about 3.7 MB) is in the working tree at the root.
- **Evidence:** `CODE_INSPECTION` (git ls-files).
- **Exploit / failure scenario:** Account identifiers or internal data leak through a public clone; the repository grows.
- **Affected components:** repository root and listed folders.
- **Required fix:** Review each artifact for sensitive content; move reproducible outputs to ignored directories.
- **Required test:** Repository hygiene script extended to reject these paths.
- **Production blocking?** No.
- **Status:** OPEN.

### G-36 — Demo-only code paths and Lambda entrypoints of unclear status (P3)
- **Area:** Dead code / legacy.
- **Finding:** Demo paths exist in production modules: `vnpay.provider.ts` (DEMO-only return URL builder), `fitness-service/src/services/agent-program.service.ts`
  line 14 and `user-service/src/services/agentic-fitness.service.ts` line 15 (demo guard keyed by `ENABLE_AGENTIC_DEMO`). Lambda entrypoints
  (`lambda.ts`, `jobs-lambda.ts`, `worker-lambda.ts`, `migrate-lambda.ts`, `lambda-runtime.ts`) exist in auth and ai services without a
  deployment decision (see G-12). `docs/` holds many historical reports that the audit treats as evidence only.
- **Evidence:** `CODE_INSPECTION`.
- **Exploit / failure scenario:** Demo branches are enabled by a stray environment variable; unused entrypoints drift out of sync.
- **Affected components:** payment and fitness/user demo code; Lambda files.
- **Required fix:** Mark `LEGACY_DEAD_CODE` or `RESEARCH_ONLY` after a deployment decision. Remove demo branches from production builds.
- **Required test:** Build without demo flags excludes the demo code paths (bundle check).
- **Production blocking?** No.
- **Status:** LEGACY_DEAD_CODE (pending decision).
