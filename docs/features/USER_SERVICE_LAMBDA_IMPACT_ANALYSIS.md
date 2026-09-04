# User Service — AWS Lambda Deployment Prep — Impact Analysis

Date: 2026-08-27. Scope: prepare `user-service` as a manually-uploadable AWS
Lambda artifact. No AWS CLI/Terraform/CDK/SAM actions taken — this document
and the code/artifact it describes are 100% local output.

## Why

`auth-service` is already deployed as a Lambda and passing end-to-end
(Lambda → Secrets Manager → Prisma → Aurora → migrations → API Gateway →
S3 frontend). `docs/aws-deployment/04-backend-migration-plan.md` named
`user-service` explicitly as "not first" because its upload/filesystem
adapter needed to be designed first. This pass does that design + the
Lambda plumbing, reusing auth-service's own proven pattern everywhere the
shapes match.

## Audit findings (real, file/function-cited)

1. **HTTP framework / entrypoint**: Express 4, already split into
   [`src/app.ts`](../../backend/services/user-service/src/app.ts) (builds/exports
   the app, no `listen`) and [`src/server.ts`](../../backend/services/user-service/src/server.ts)
   (`app.listen`, SIGTERM handler, starts the 3 background jobs). This split
   already existed — no restructuring needed, only a new `lambda.ts` sibling.
2. **`app.listen()`**: `server.ts:13`. Never reached by `lambda.ts`, which
   imports `app.ts` directly.
3. **`package.json`**: `main: dist/server.js`. New `build:lambda-zip` script
   added; `main` intentionally left pointing at `server.js` (local/Docker
   `pnpm start` must keep working) — the Lambda artifact's OWN
   `package.json` (written fresh by the build script) sets `main:
   dist/lambda.js` instead, so nothing here conflicts.
4. **TypeScript config**: `tsconfig.json` extends the repo's
   `tsconfig.base.json` — `module: commonjs`, `target: ES2022`. CommonJS
   output means no ESM-loader concerns for Lambda's Node 22.x runtime.
5. **Prisma schema**: `prisma/schema.prisma`. `binaryTargets` was `["native",
   "linux-musl-openssl-3.0.x"]` — missing `rhel-openssl-3.0.x` (Amazon Linux
   2023 / Node 22 x86_64's actual engine target). Added, matching
   auth-service's own schema exactly.
6. **Migrations**: `prisma/migrations/` — 25 migrations,
   `20260120003413_` through `20260824140000_add_pt_application_reviewed_by`,
   correctly timestamp-ordered. See "Migration compatibility" below for the
   real collision finding.
7. **`DATABASE_URL`**: read via `env("DATABASE_URL")` in the datasource
   block (unchanged); Lambda path resolves it at runtime from Secrets
   Manager via new `src/config/lambda-runtime.ts` (see below) — never
   hard-coded.
8. **Routes**: 13 route files (`src/routes/*.ts`), mounted in `app.ts`:
   `/profile`, `/inbody`, `/pt-applications`, `/contracts`, `/notifications`,
   `/sessions`, `/availability`, `/admin`, `/locations`,
   `/pt/training-locations`, `/internal` (service-secret gated, explicitly
   commented "NOT exposed via gateway public routing"), `/me/service-packages`,
   `/webhooks/dropbox-sign` (only registered when
   `REQUIRE_CONTRACT_ESIGN=true`, currently `false` in dev). 113 individual
   handlers total across these files (`grep -c router\. `).
9. **Auth middleware**: `src/middleware/auth.middleware.ts` — does **not**
   verify a JWT locally. Every authenticated request calls out over HTTP:
   `axios.post(`${AUTH_SERVICE_URL}/auth/verify`, ...)` (line 24). This is
   the single biggest network-dependency finding — see "Network
   dependencies / BLOCKERS" below.
10. **`INTERNAL_SERVICE_SECRET`**: read in 7 files (`gym.client.ts`,
    `payment.client.ts`, `contract.service.ts`, `profile.service.ts`,
    `pt-discovery.service.ts`, `pt_application.service.ts`,
    `ptDocumentUrl.util.ts`) plus enforced by
    `src/middleware/serviceSecret.middleware.ts` for inbound `/internal/*`
    calls. **Real load-time risk found**: that middleware file has a
    **top-level `process.exit(1)`** (line 37) if `NODE_ENV === "production"`
    and the secret is missing/weak/default — this runs at MODULE IMPORT
    time (via `app.ts` → `internal.routes.ts` → this file), so a Lambda
    cold start with `NODE_ENV=production` and no `INTERNAL_SERVICE_SECRET`
    configured would hard-crash on every single invocation, not just log an
    error. Left unchanged (it is correct, intentional fail-fast security
    behavior — weakening it would be a real business-logic change this task
    explicitly forbids) but flagged as a **must-configure-before-first-
    invoke** item in the environment contract below.
11. **Calls to auth-service**: 4 distinct call sites beyond `/auth/verify` —
    `contract.service.ts` (`/auth/internal/send-email`,
    `/auth/internal/users/:id` ×2), `pt_application.service.ts`
    (`/auth/internal/users/:id`, `/auth/internal/users/:id/role`). All via
    `AUTH_SERVICE_URL` (env, never hard-coded).
12. **File upload (current)**: 3 local-disk `multer` flows —
    `profile.routes.ts` (`dest: "uploads/profile-photos/"`),
    `pt_application.routes.ts` (`multer.diskStorage`, `uploads/pt-applications/`),
    `inbody.routes.ts` (`dest: "uploads/"`). A 4th, `dropboxSignWebhook.routes.ts`,
    already uses `multer.memoryStorage()` (no disk touch — already Lambda-safe).
13. **Filesystem dependency (real, load-time-crashing)**: `app.ts:38-45`
    unconditionally `fs.mkdirSync`'d 3 upload directories under
    `process.cwd()` **at module import time** — Lambda's deployment package
    is read-only outside `/tmp`, so this would `EROFS`-crash on every cold
    start, before any route (not just uploads) becomes reachable. **Fixed**
    (see "Changes made" below) — this is the one filesystem issue that was
    load-time-fatal rather than merely per-request-degraded.
14. **InBody logic**: `inbody.controller.ts:upload` →
    `inbody.service.ts:extractFromImage` → `inbody-vision.service.ts` —
    uses the **Anthropic SDK directly** (`@anthropic-ai/sdk`, vision tool-use
    against `claude-sonnet-4-6` by default) reading the uploaded file via
    `fs.readFileSync` (or similar) from local disk. The `inbody_extractor/`
    Python folder at the service root is **not invoked anywhere in the
    TypeScript source** (grep-verified — zero `spawn`/`execFile`/
    `child_process`/`python` references) — it is a standalone, unused-by-
    the-running-service prototype, not a runtime dependency. Real finding:
    the actual OCR path needs outbound HTTPS to `api.anthropic.com` — a
    second, separate network-egress BLOCKER from the auth-service one.
15. **Onboarding/profile routes**: `profile.routes.ts` — `/me` (get/put),
    onboarding fields folded into the same `profileSchema`
    (`hasCompletedOnboarding`, `safetyScreeningStatus`, etc.), no separate
    onboarding route family.
16. **External HTTP services**: `AUTH_SERVICE_URL`, `GYM_SERVICE_URL`,
    `PAYMENT_SERVICE_URL`, `AI_SERVICE_URL`, `CHAT_SERVICE_URL` — all
    env-var-based (never hard-coded), all currently point at other
    Docker-Compose service names/`localhost` in dev. None of these targets
    are confirmed reachable from a private-subnet-no-NAT Lambda.
17. **Background jobs/timers**: `session-autoconfirm.service.ts`,
    `reschedule-expiry.service.ts`, `session-settlement-sweep.service.ts` —
    all 3 use plain `setInterval`, all 3 started **only** from `server.ts`
    (never `app.ts`). Confirmed **already correctly excluded** from the
    Lambda path by the existing app/server split — no code change needed.
    Real, disclosed gap: these simply do not run at all in the Lambda
    deployment as it stands; migrating them to EventBridge-scheduled Lambda
    invocations is a separate, later piece of work, not part of "make the
    HTTP API Lambda-ready."
18. **Shared workspace dependency**: `@gym-coach/shared` — `logger` (pino),
    `register`/`metricsMiddleware` (prom-client), Zod schemas, error types.
    No Redis/network initialization at import time (read via
    `backend/shared/src/index.ts`) — confirmed Lambda-safe, same package
    auth-service already depends on successfully.
19. **Native binaries**: none beyond Prisma's own query-engine binary.
    `package.json` dependencies audited — no `bcrypt` (this service has no
    password hashing at all; auth-service owns that), no `sharp`/`canvas`/
    `sqlite3`/other native-addon packages. `pdfkit`/`fontkit` are pure JS.
20. **`process.exit` audit**: 6 hits total in `src/`; 5 are in one-off CLI
    scripts under `src/scripts/` (never imported by `app.ts`/`lambda.ts`)
    or `server.ts`'s own SIGTERM handler (never reached in Lambda). The one
    real one is `serviceSecret.middleware.ts` (finding #10 above).

## Database / Prisma audit

- Generator block already used a custom `output` path
  (`../src/generated/prisma`), matching auth-service's own self-contained-
  client convention (the generated client `require`s only its own
  `./runtime/library.js`, never `@prisma/client` — confirmed by re-using
  auth-service's build script, which drops `node_modules/@prisma`
  entirely and the client still loads and queries correctly, see Test
  Results).
- `binaryTargets`: added `rhel-openssl-3.0.x` (Task 5's exact target for
  Node 22 x86_64 Amazon Linux 2023). Verified present in the generated
  client output (`libquery_engine-rhel-openssl-3.0.x.so.node`, 16.16MB)
  after `prisma generate`.
- **Real, unrelated finding**: the committed `src/generated/prisma/`
  directory also had a **stale `libquery_engine-debian-openssl-3.0.x.so.node`**
  (16MB) that does not correspond to any of the 3 declared `binaryTargets`
  — a leftover from a prior `native` resolution on a different host.
  Pruned in the build script's artifact-assembly step (not deleted from
  the committed source tree — out of scope to touch a checked-in generated
  file beyond what the artifact needs).
- `prisma migrate dev/deploy`/`db push` are never invoked by `lambda.ts`,
  `app.ts`, or the build script — migrations are correctly left as a
  separate deployment step, per Task 6's own instruction.
- `PrismaClient` is instantiated once at module scope
  (`repositories/profile.repository.ts:4`, `export const prisma = new
  PrismaClient()`) and never explicitly `$disconnect()`'d anywhere `app.ts`
  reaches — correct for Lambda warm-invocation connection reuse. `lambda.ts`
  imports `app.ts` (and therefore constructs the client) lazily, AFTER
  `ensureDatabaseUrlConfigured()` has set `process.env.DATABASE_URL`, so the
  client is never constructed with a missing connection string.

## Migration compatibility with the Auth database — BLOCKER

**Hard evidence, not speculation**: both services define a model that maps
to the same physical table name.

```prisma
// auth-service/prisma/schema.prisma
model AuditLog {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  action    String
  ...
  @@map("audit_logs")
}

// user-service/prisma/schema.prisma
model AuditLog {
  id           String          @id @default(uuid())
  actorUserId  String          @map("actor_user_id")
  action       String
  entityType   AuditEntityType @map("entity_type")
  entityId     String          @map("entity_id")
  ...
  @@map("audit_logs")
}
```

Genuinely different column sets, different indexes, no shared FK. If
`user-service`'s migrations are ever run (`prisma migrate deploy`) against
the SAME physical database `auth-service` already migrated
(`fitness_assistant`), this **will** either fail outright (`CREATE TABLE
audit_logs` already exists) or, in some hypothetical partial-apply
scenario, corrupt whichever service's table survives. No enum-name
collision was found (auth has 3 enums — `Role`, `PtDeactivationAction`,
`PtDeactivationCallStatus` — none overlap user-service's 17).
`_prisma_migrations` itself is a per-DATABASE table Prisma uses to track
applied migration names+checksums — sharing it across two independently-
versioned histories is survivable IF there's no table-name collision, but
this repo has one.

**Per Task 6's own instruction: no migration was run. Recommendation
(decision for the owner, not executed here)**: give `user-service` its own
separate Aurora **database** (e.g. `fitness_assistant_user`) within the
same cluster — this exactly matches local dev's own already-working
convention (`gymcoach_user` vs `gymcoach_auth`, separate databases on one
Postgres server) and requires zero Prisma/schema changes on either service.
A same-database-different-Postgres-schema alternative exists
(`?schema=user_service` + Prisma's `multiSchema` preview feature) but is
more invasive (a datasource block change neither service currently has)
and was not pursued, per "ưu tiên không tự sửa architecture lớn."

Two migrations contain destructive SQL
(`20260324000000_add_booking_availability`: `DROP TABLE IF EXISTS
"notifications"` immediately followed by `CREATE TABLE "notifications"`;
`20260528_inbody_unique_per_day`: a dedup `DELETE FROM "inbody_entries"`).
Both are safe against a **fresh** Aurora database — the DROP removes a
table created moments earlier in the same historical migration sequence,
and the DELETE only removes duplicate rows that would otherwise fail a
same-migration unique-index creation. Neither is a risk to real
already-migrated data, since nothing has been migrated to Aurora for this
service yet.

## File upload audit

The 3 local-disk `multer` flows (finding #12) are **NOT LAMBDA SAFE** as
originally written — Lambda's deployment package is read-only outside
`/tmp`, and even `/tmp` never survives past the single invocation, so
nothing written there can ever be read back by a later request (unlike
Docker's bind-mounted `uploads/` volume). None of the 3 crash Lambda's
cold start (multer only touches disk per-request, not at import time) —
only `app.ts`'s directory-creation loop did that (fixed).

**Implemented this pass** (Task 8, "có thể implement tối thiểu"): an
additive S3 presigned-upload path for profile photos specifically — the
clearest, single-file "avatar" case Task 8 itself uses as the example.
New `src/services/s3-upload.service.ts` (`createProfilePhotoUploadUrl`,
`isOwnProfilePhotoKey`, `profilePhotoUrlForKey`), two new routes on the
existing `/profile` router (`POST /me/photo/presign`, `POST
/me/photo/confirm`), two new controller methods. Bucket name read from
`USER_UPLOAD_BUCKET` at call time (never hard-coded, never module-load
time — a missing env var fails one request with a clear 500, not a cold
start). The confirm step validates the returned `key` is actually
namespaced under `profile-photos/${callerUserId}/` before trusting it —
a client can never point their profile at another user's or an arbitrary
S3 object. The existing `POST /me/photo` (local disk) endpoint is
**completely untouched** — both coexist.

**Deliberately NOT converted this pass** (disclosed, not silently
dropped): PT application documents (multi-file, admin-review, longer
retention lifecycle) and InBody images (already blocked by the separate
Anthropic-API network-egress BLOCKER, so fixing only the disk-write half
would not make the feature actually work end-to-end). Both remain fully
functional on the existing Docker/EC2 deployment; migrating them to S3 is
real, disclosed follow-up work, not attempted here to stay within
"minimal changes."

## Network dependencies — BLOCKERS (per Task 7's own instruction: identify + report, do not silently re-architect)

The private app subnets have **no NAT Gateway** (per the AWS context given)
and only a **Secrets Manager** VPC endpoint is confirmed available — no
`execute-api` (API Gateway) VPC endpoint was mentioned. Every one of the
following is a genuine outbound call the current code makes that a
Lambda in that subnet cannot reach without either a NAT Gateway, a VPC
endpoint for the specific AWS/public service, or the target itself being
moved inside the same VPC:

1. **`auth.middleware.ts` → `AUTH_SERVICE_URL/auth/verify`** — every single
   authenticated request in this service depends on this call. This is the
   largest blocker: without it, essentially none of `/profile`, `/inbody`,
   `/contracts`, `/notifications`, `/sessions`, `/availability`,
   `/pt-applications` (their authenticated routes), or `/me/service-packages`
   can function.
2. **`contract.service.ts`/`pt_application.service.ts` → `AUTH_SERVICE_URL/auth/internal/*`**
   (send-email, get-user, set-role) — contract creation/payment flows and
   PT application review depend on these.
3. **`gym.client.ts` → `GYM_SERVICE_URL`**, **`payment.client.ts` →
   `PAYMENT_SERVICE_URL`**, **`pt-discovery.service.ts` → `GYM_SERVICE_URL`**
   — PT-gym-affiliated contracts and wallet payments.
4. **`profile.service.ts` → `AI_SERVICE_URL`**.
5. **`pt_application.service.ts` → `CHAT_SERVICE_URL/internal/push-notification`**.
6. **`inbody-vision.service.ts` → `api.anthropic.com`** (via the Anthropic
   SDK) — InBody OCR upload.
7. **`@dropbox/sign`** SDK (webhook route currently unregistered via
   `REQUIRE_CONTRACT_ESIGN=false`, so dormant, but the SDK itself would also
   need egress if re-enabled).

None of these were hard-coded (all already env-var-driven, which is
correct — the exact same code will work unmodified once connectivity
exists, whether via NAT Gateway, VPC PrivateLink/endpoints, or by those
target services also becoming VPC-resident Lambdas), so **no code change
was made here** — this is purely a deployment-topology decision for the
owner. **Auth Lambda itself never needed this** (its own audit trail shows
only Aurora dependency) — the moment `user-service` moves to Lambda, it is
the first service in this migration to actually hit this class of problem.

## Files changed

- `backend/services/user-service/prisma/schema.prisma` — added
  `rhel-openssl-3.0.x` to `binaryTargets`.
- `backend/services/user-service/src/config/lambda-runtime.ts` (new) —
  Secrets-Manager-backed `DATABASE_URL` construction + startup config
  validation. Structural port of auth-service's own file.
- `backend/services/user-service/src/lambda.ts` (new) — `serverless-http`
  adapter, structural port of auth-service's own file.
- `backend/services/user-service/src/app.ts` — wrapped the 3
  upload-directory `mkdirSync` calls in try/catch (prevents an `EROFS`
  crash on Lambda's read-only filesystem at module-import time; no
  observable change on local/Docker, where it always succeeds).
- `backend/services/user-service/src/services/s3-upload.service.ts` (new)
  — presigned S3 PUT URL generation for profile photos.
- `backend/services/user-service/src/controllers/profile.controller.ts` —
  added `presignPhotoUpload`, `confirmPhotoUpload`.
- `backend/services/user-service/src/routes/profile.routes.ts` — added
  `POST /me/photo/presign`, `POST /me/photo/confirm`.
- `backend/services/user-service/package.json` — added
  `@aws-sdk/client-secrets-manager`, `@aws-sdk/client-s3`,
  `@aws-sdk/s3-request-presigner`, `serverless-http` (prod deps);
  `build:lambda-zip` script.
- `backend/services/user-service/scripts/build-lambda-artifact.js` (new) —
  structural port of auth-service's own build script (paths/names only
  differ), plus one extra prune step for the stale debian engine binary
  unique to this service's committed generated client.
- `backend/services/user-service/src/__tests__/lambda-runtime.test.ts`
  (new) — 5 unit tests for the pure/local logic in `lambda-runtime.ts`
  (never calls real AWS).
- `pnpm-lock.yaml` — updated by `pnpm install` for the new deps.

## Test results

- `npx tsc --noEmit`: clean.
- `pnpm --filter @gym-coach/user-service build` (`tsc`): clean, produces
  `dist/lambda.js` + `dist/config/lambda-runtime.js`.
- Unit tests: **172/172 passing** (167 pre-existing + 5 new
  `lambda-runtime.test.ts`), zero regressions from the `app.ts`/
  `profile.controller.ts`/`profile.routes.ts` changes.
- Simulated API Gateway HTTP API v2.0 invocation of the COMPILED
  `dist/lambda.handler` (no AWS, no mocks beyond the event shape):
  - `GET /health` → `200 {"status":"ok","service":"user-service"}`.
  - `GET /locations/provinces` (real Prisma query, against the LOCAL
    Docker Postgres, never Aurora) → `200 []` — a real 78ms round trip
    through the generated Prisma client's native/rhel engine resolution,
    confirming the whole chain (serverless-http → Express → Prisma →
    Postgres) works end-to-end through the Lambda handler.
- Security grep across `src/` (excluding `generated/`/`__tests__/`) for
  `postgresql://user:pass@`, `sk-ant-api`, `AKIA...`: zero hits.
- Artifact inspection: zero `.env` files, zero `__tests__`/`scripts/`
  entries, zero hardcoded secrets in any compiled `dist/**/*.js`
  (recursive grep, zero hits).

## Known risks / disclosed gaps

- Network-dependency BLOCKERS above must be resolved (NAT Gateway, VPC
  endpoints, or migrating the called services too) before the deployed
  Lambda can actually serve authenticated traffic — `/health` and other
  fully-public, non-DB-dependent-on-other-services routes would work
  today; almost everything else needs `AUTH_SERVICE_URL` reachability at
  minimum.
- `serviceSecret.middleware.ts`'s `process.exit(1)` in production without
  a configured `INTERNAL_SERVICE_SECRET`/`INTERNAL_API_SECRET` — intentional,
  unchanged, but will crash EVERY cold start (not just log once) if hit.
  Must be set correctly in the Lambda's environment before first
  `NODE_ENV=production` invoke.
- 3 background jobs (session auto-confirm, reschedule expiry, settlement
  sweep) do not run at all in the Lambda deployment — `server.ts`-only,
  correctly excluded, but functionally absent until migrated to
  EventBridge-scheduled Lambda invocations separately.
- PT application documents and InBody images remain local-disk-only
  (NOT LAMBDA SAFE) — functional on the existing deployment, not migrated
  to S3 this pass.
- Database migration plan is a recommendation, not an executed decision —
  the owner must create a separate Aurora database for `user-service`
  before running `prisma migrate deploy` against it.

## Addendum — direct Lambda invoke replaces AUTH_SERVICE_URL for auth calls

Resolves item 1/2 of "Network dependencies — BLOCKERS" above, for the auth-service leg only
(the other targets — GYM_SERVICE_URL, PAYMENT_SERVICE_URL, AI_SERVICE_URL, CHAT_SERVICE_URL —
are unchanged and still the public-API-Gateway-or-unreachable state described above).

Both auth-service's Lambda (`fitness-assistant-dev-auth`) and user-service's Lambda
(`fitness-assistant-dev-user`) are now real deployed resources, and the User Lambda's execution
role already has `lambda:InvokeFunction` scoped to exactly the Auth Lambda. `/auth/verify` and
all `/auth/internal/*` calls (previously the 4 call sites listed in finding #11, plus 3 more in
`profile.service.ts` this doc's original audit pass didn't enumerate: the identity batch-fetch
and both `syncRole`/`syncRoleToPT` role-sync calls) now go through
`src/clients/auth-service.client.ts`, which invokes the Auth Lambda directly
(`@aws-sdk/client-lambda`, `InvocationType=RequestResponse`, a synthetic API Gateway HTTP API
v2.0 event) when `AUTH_LAMBDA_NAME` is set, falling back to the original `AUTH_SERVICE_URL` HTTP
call — byte-for-byte unchanged — otherwise. This is also what keeps `/auth/internal/*` off any
public API Gateway entirely: those routes are only ever reached by whatever can call
`lambda:InvokeFunction` on the Auth Lambda's ARN, never through a public URL.

### Environment contract (auth-related)

| Variable | Purpose | Required | Secret? | Example |
|---|---|---|---|---|
| `AUTH_LAMBDA_NAME` | Auth Lambda's function name — when set, user-service invokes it directly instead of calling `AUTH_SERVICE_URL` over HTTP | Required on the AWS Lambda deployment | No | `fitness-assistant-dev-auth` |
| `AUTH_SERVICE_URL` | HTTP fallback target, used only when `AUTH_LAMBDA_NAME` is unset | Required for local/Docker (unchanged); **not required** on AWS Lambda once `AUTH_LAMBDA_NAME` is set | No | `http://localhost:3001` (local) |
| `INTERNAL_SERVICE_SECRET` | Sent as `x-service-secret` on every `/auth/internal/*` call, over either transport | Required | **Yes** | must match auth-service's own `INTERNAL_SERVICE_SECRET` |
| `AWS_REGION` | Region for the Lambda SDK client used to invoke auth-service | Supplied automatically by the Lambda runtime | No | `ap-southeast-1` |

Currently still set on the User Lambda: `AUTH_SERVICE_URL=https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com` (the public API Gateway URL). It is **no longer read** once `AUTH_LAMBDA_NAME` is also set — safe to leave in place as an inert fallback value, or remove once the owner is confident the direct-invoke path is working, at their discretion (out of scope for this change to decide).
