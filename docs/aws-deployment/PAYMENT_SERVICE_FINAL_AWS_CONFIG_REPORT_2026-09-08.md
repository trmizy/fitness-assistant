# Payment Service — AWS Lambda Manual Deployment Readiness Report

Ngày kiểm tra: 2026-09-08  
Scope: `backend/services/payment-service` only  
AWS target: `ap-southeast-1`, Node.js `22.x`, `x86_64`

## 1. PAYMENT SERVICE RESPONSIBILITIES

Payment Service hiện chịu trách nhiệm:

- Transaction/payment history cho user qua `/me/payments`.
- Payment method catalogue và provider selection.
- Checkout nội bộ cho purchase flows qua `/internal/payments/checkout`.
- Payment webhook/IPN/return handling cho VNPay, MoMo, ZaloPay, PayOS.
- Wallet, ledger, commission, escrow, pending/available/locked buckets.
- Gym membership payment activation/refund cancellation callbacks.
- PT contract payment, release-session, no-show, late-arrival, termination, referral/clawback.
- Personalized service purchase release/refund/activation.
- Admin reconciliation, refund, commission read, withdrawal review/mark-paid.
- Background reconciliation sweep cho gateway confirmation, activation retry, refund-cancellation retry, stale processing cleanup.

## 2. MONEY SAFETY / IDEMPOTENCY AUDIT

Source-backed safety controls:

- `PaymentTransaction.idempotencyKey` is `@unique` in `prisma/schema.prisma`.
- `LedgerOperation.key` is `@unique` for non-transaction ledger operations.
- Webhook event idempotency uses `PaymentWebhookEvent @@unique([provider, providerEventId])`.
- Wallet rows are unique by `@@unique([ownerType, ownerId])`.
- Money fields use Prisma `Decimal` with PostgreSQL decimal columns, not floating persistence.
- `wallet.service.ts` locks wallets with `FOR UPDATE` before ledger movement.
- `wallet.service.ts` writes debit/credit ledger entries with balanceBefore/balanceAfter.
- Refund flow checks original transaction status is `PAID`, blocks double refund, checks refund amount does not exceed original, and checks affordability.
- Withdrawal payout is manual; ledger debit happens at `markPaid`, after admin confirms external transfer.
- `serviceSecret.middleware.ts` rejects weak/default internal secrets in production.
- `auth.middleware.ts` verifies JWT against Auth Service instead of trusting caller-provided user headers.

Remaining operational risk:

- Provider credentials and webhook URLs must be configured correctly in AWS; otherwise methods will be unavailable or webhooks will fail signature verification.
- Admin full-refund route generates a new random refund idempotency key per request, so external/manual repeated admin clicks should still be controlled operationally.

## 3. CODE / FRAMEWORK AUDIT

- Framework: Express + TypeScript.
- `src/app.ts` creates and exports Express app; it does not call `listen()`.
- `src/server.ts` is local/container runtime and starts `app.listen(PORT)`.
- `src/server.ts` starts `startReconciliationJob()` only after local/container listener starts.
- HTTP Lambda handler added at `src/lambda.ts`.
- Jobs Lambda handler added at `src/jobs-lambda.ts`.
- Migration Lambda handler added at `src/migrate-lambda.ts`.
- Webhook route is mounted before `express.json()` with `express.raw({ type: '*/*' })`, preserving raw body for signature verification.

## 4. DATABASE ARCHITECTURE

- ORM: Prisma.
- Datasource: PostgreSQL via `DATABASE_URL`.
- Prisma schema: `backend/services/payment-service/prisma/schema.prisma`.
- Generated Prisma client: `src/generated/prisma`.
- Main tables:
  - `wallets`
  - `wallet_ledger_entries`
  - `withdrawal_requests`
  - `payment_transactions`
  - `platform_commissions`
  - `partner_receivables`
  - `ledger_operations`
  - `payment_webhook_events`
- No DB-level foreign keys to Auth/User/Fitness/Gym schemas were found.

## 5. SEPARATE DATABASE REQUIRED — YES/NO

YES.

Recommended logical DB:

```text
fitness_assistant_payment
```

Do not reuse:

```text
fitness_assistant
fitness_assistant_user
fitness_assistant_fitness
fitness_assistant_gym
postgres
```

Reason:

- Payment Service has independent Prisma schema and migration history.
- It owns high-blast-radius money/ledger tables.
- No cross-service DB foreign key requires sharing another service database.
- Separate DB reduces migration blast radius and makes rollback/audit cleaner.

## 6. MIGRATION COUNT + RISKS

Migration count:

```text
11
```

Statement audit:

```text
CREATE=39
ALTER=18
DROP=1
DELETE=0
TRUNCATE=0
CREATE_TYPE=13
ALTER_TYPE=10
CREATE_INDEX=18
FOREIGN_KEY=4
UNIQUE=4
CONSTRAINT=12
```

Risk note:

- The single `DROP` is `DROP TYPE "PurposeType"` in `20260625000001_wallet_core`, part of an enum rebuild (`PurposeType_new` then rename), not a table/database drop.
- No AWS migration was run.
- No `prisma db push`.
- No `prisma migrate reset`.
- No `--accept-data-loss`.

## 7. PAYMENT PROVIDER

Current provider support in source:

- Default provider: `VNPAY`.
- Implemented provider files:
  - `momo.provider.ts`
  - `payos.provider.ts`
  - `vnpay.provider.ts`
  - `zalopay.provider.ts`
- `MOCK` provider is intentionally removed from usable providers, although it remains in DB enum for old data compatibility.
- Provider config status is exposed by `providerConfigStatus()` and `/me/payments/methods`.

Required real/sandbox credential groups:

- VNPay: `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, optional `VNPAY_URL`, `VNPAY_API_URL`, `VNPAY_RETURN_URL`, `PAYMENT_PUBLIC_URL`, `VNPAY_SIMULATE`.
- MoMo: `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY`, optional `MOMO_ENDPOINT`, `MOMO_IPN_URL`, `MOMO_REDIRECT_URL`.
- PayOS: `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`, optional `PAYOS_BASE_URL`.
- ZaloPay: `ZALOPAY_APP_ID`, `ZALOPAY_KEY1`, `ZALOPAY_KEY2`, optional `ZALOPAY_ENDPOINT`, `ZALOPAY_CALLBACK_URL`.

## 8. WEBHOOK AUDIT

Webhook/return routes:

- `GET /payments/webhook/vnpay`
- `POST /payments/webhook/:provider`
- `GET /payments/vnpay/return`
- `GET /payments/vnpay/sim` only when `VNPAY_SIMULATE=true`

Source-backed behavior:

- `app.ts` mounts `/payments/webhook` with raw body before JSON parser.
- VNPay IPN verifies signed query string and returns VNPay `RspCode`.
- MoMo pre-persists event identity before responding `204`, then processes fire-and-forget.
- ZaloPay/PayOS process synchronously and return provider-specific ack body.
- VNPay browser return verifies signature and uses the same idempotent `handleEvent()` path for PAID result.

AWS note:

- Webhook provider callback URLs must target the deployed API Gateway/CloudFront domain for Payment Service.

## 9. SERVICE COMMUNICATION

Prepared AWS Lambda communication:

- Auth verification now supports `AUTH_LAMBDA_NAME`, fallback `AUTH_SERVICE_URL`.
- Gym callbacks now support `GYM_LAMBDA_NAME`, fallback `GYM_SERVICE_URL`.
- User/PT contract callbacks now support `USER_LAMBDA_NAME`, fallback `USER_SERVICE_URL`.
- AI personalized-service callbacks now support `AI_LAMBDA_NAME`, fallback `AI_SERVICE_URL`.

Local Docker behavior remains supported through the existing HTTP URL fallback variables.

## 10. GYM INTEGRATION

Gym-related flows:

- `GYM_MEMBERSHIP` checkout and wallet transfer.
- Gym membership activation callback:
  - `/internal/gym-memberships/:id/activate`
- Gym membership cancel-after-refund callback:
  - `/internal/gym-memberships/:id/cancel-after-refund`
- Gym withdrawal proxy endpoints under Payment internal routes:
  - `POST /internal/withdrawals/gym/:gymId`
  - `GET /internal/withdrawals/gym/:gymId`
- Gym referral settlement/clawback and membership pending release ledger functions.

AWS target:

- Configure `GYM_LAMBDA_NAME=fitness-assistant-dev-gym` if Gym Lambda is deployed.
- Otherwise configure `GYM_SERVICE_URL` only if a reachable Gym HTTP endpoint exists.

## 11. USER/PT PAYMENT FLOWS

User/PT-related flows:

- `PT_CONTRACT` checkout activation:
  - `/internal/contracts/:id/activate-after-payment`
- PT contract cancel-after-refund:
  - `/internal/contracts/:id/cancel-after-refund`
- PT contract release/no-show/late-arrival/terminate money endpoints under `/internal/contracts/*`.
- PT wallet read and withdrawal request routes under `/me/pt-wallet`, `/me/withdrawals`.
- Personalized service purchase release/refund routes under `/internal/personalized-service/*`.

AWS target:

- Configure `USER_LAMBDA_NAME=fitness-assistant-dev-user`.
- Configure `AI_LAMBDA_NAME` only when AI Lambda/facade has the expected internal personalized-service endpoints.

## 12. REDIS / QUEUE AUDIT

No Redis/BullMQ dependency was found in Payment Service source.

Result:

- No ElastiCache required for current Payment HTTP Lambda.
- No queue is required for the existing reconciliation job.

## 13. BACKGROUND JOBS

Job found:

```text
reconciliation
```

Source:

- `src/services/reconciliation.service.ts`
- Local/container starter: `startReconciliationJob()` called by `src/server.ts`
- Default cadence: every `5 minutes`
- EventBridge recommendation: `rate(5 minutes)`
- Jobs Lambda handler: `dist/jobs-lambda.handler`
- Event payload:

```json
{ "job": "reconciliation" }
```

Reconciliation job actions:

- mark already-PAID webhook events as processed;
- poll gateway confirmations;
- retry pending activations;
- retry pending refund cancellations;
- sweep stale processing transactions.

## 14. FILES CHANGED

Changed/added for AWS Lambda readiness:

- `backend/services/payment-service/package.json`
- `pnpm-lock.yaml`
- `backend/services/payment-service/prisma/schema.prisma`
- `backend/services/payment-service/src/lambda.ts`
- `backend/services/payment-service/src/jobs-lambda.ts`
- `backend/services/payment-service/src/migrate-lambda.ts`
- `backend/services/payment-service/src/config/lambda-runtime.ts`
- `backend/services/payment-service/src/clients/lambda-http.client.ts`
- `backend/services/payment-service/src/clients/auth-service.client.ts`
- `backend/services/payment-service/src/clients/service-lambda.client.ts`
- `backend/services/payment-service/src/middleware/auth.middleware.ts`
- `backend/services/payment-service/src/routes/admin.routes.ts`
- `backend/services/payment-service/src/services/reconciliation.service.ts`
- `backend/services/payment-service/scripts/build-lambda-artifact.js`
- `backend/services/payment-service/scripts/build-migrate-lambda-artifact.js`
- `backend/services/payment-service/artifacts/payment-lambda.zip`
- `backend/services/payment-service/artifacts/payment-migrate-lambda.zip`

Build side-effect note:

- `prisma generate` on this Windows workspace hit `EPERM rename` for locked generated engine files. Artifact scripts continue and explicitly package required RHEL engines.

## 15. ENV VARIABLES

| VARIABLE | REQUIRED? | SECRET? | PURPOSE | AWS VALUE / PLACEHOLDER |
|---|---:|---:|---|---|
| `NODE_ENV` | Yes | No | Production runtime guard | `production` |
| `AWS_REGION` | Yes | No | AWS SDK region | `ap-southeast-1` |
| `AWS_DEFAULT_REGION` | Optional | No | SDK fallback | `ap-southeast-1` |
| `DATABASE_SECRET_ID` | Recommended | No | Load DB JSON from Secrets Manager | `fitness-assistant/dev/payment-database` |
| `DATABASE_URL` | Alternative/local | Yes | Direct Prisma DB URL fallback | Leave unset on AWS if using secret |
| `INTERNAL_SERVICE_SECRET` | Yes | Yes | Internal service auth header | Existing shared internal secret |
| `INTERNAL_API_SECRET` | Conditional | Yes | Secondary internal secret compatibility | Existing internal API secret if used |
| `AUTH_LAMBDA_NAME` | Recommended | No | Direct Auth Lambda invoke | `fitness-assistant-dev-auth` |
| `AUTH_SERVICE_URL` | Local/fallback | No | Auth HTTP fallback | local/API fallback only |
| `GYM_LAMBDA_NAME` | Recommended | No | Direct Gym Lambda invoke | `fitness-assistant-dev-gym` |
| `GYM_SERVICE_URL` | Local/fallback | No | Gym HTTP fallback | local/API fallback only |
| `USER_LAMBDA_NAME` | Recommended | No | Direct User Lambda invoke | `fitness-assistant-dev-user` |
| `USER_SERVICE_URL` | Local/fallback | No | User HTTP fallback | local/API fallback only |
| `AI_LAMBDA_NAME` | Conditional | No | Direct AI Lambda/facade invoke | only if deployed with required endpoints |
| `AI_SERVICE_URL` | Conditional/fallback | No | AI HTTP fallback | local/API fallback only |
| `FRONTEND_URL` | Yes for redirects | No | Browser return redirect base | deployed frontend URL |
| `PAYMENT_PUBLIC_URL` | Yes for provider callbacks | No | Public API base for provider callback URLs | deployed API/CloudFront base |
| `PAYMENT_PROVIDER` | Optional | No | Preferred provider | default `VNPAY` |
| `TOPUP_STALE_MINUTES` | Optional | No | Topup stale timeout | default `60` |
| `PLATFORM_COMMISSION_RATE` | Optional | No | Platform commission fallback | default `0.10` |
| `PORT` | Local only | No | Express local port | `3007` |
| `VNPAY_TMN_CODE` | Provider | Yes | VNPay merchant code | secret/config |
| `VNPAY_HASH_SECRET` | Provider | Yes | VNPay signature secret | secret/config |
| `VNPAY_URL` | Optional | No | VNPay payment URL | sandbox/prod |
| `VNPAY_API_URL` | Optional | No | VNPay query API URL | sandbox/prod |
| `VNPAY_RETURN_URL` | Provider | No | VNPay browser return URL | public `/payments/vnpay/return` |
| `VNPAY_SIMULATE` | Dev only | No | Demo simulator | `false` on real deployment |
| `MOMO_PARTNER_CODE` | Provider | Yes | MoMo partner code | secret/config |
| `MOMO_ACCESS_KEY` | Provider | Yes | MoMo access key | secret/config |
| `MOMO_SECRET_KEY` | Provider | Yes | MoMo signature secret | secret/config |
| `MOMO_ENDPOINT` | Optional | No | MoMo endpoint | sandbox/prod |
| `MOMO_IPN_URL` | Provider | No | MoMo webhook URL | public `/payments/webhook/momo` |
| `MOMO_REDIRECT_URL` | Provider | No | MoMo redirect URL | frontend result URL |
| `PAYOS_CLIENT_ID` | Provider | Yes | PayOS client id | secret/config |
| `PAYOS_API_KEY` | Provider | Yes | PayOS API key | secret/config |
| `PAYOS_CHECKSUM_KEY` | Provider | Yes | PayOS checksum key | secret/config |
| `PAYOS_BASE_URL` | Optional | No | PayOS base URL | sandbox/prod |
| `ZALOPAY_APP_ID` | Provider | Yes | ZaloPay app id | secret/config |
| `ZALOPAY_KEY1` | Provider | Yes | ZaloPay key1 | secret/config |
| `ZALOPAY_KEY2` | Provider | Yes | ZaloPay key2 | secret/config |
| `ZALOPAY_ENDPOINT` | Optional | No | ZaloPay endpoint | sandbox/prod |
| `ZALOPAY_CALLBACK_URL` | Provider | No | ZaloPay callback URL | public `/payments/webhook/zalopay` |

## 16. IAM REQUIREMENTS

Minimum Payment HTTP Lambda permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:ap-southeast-1:<account-id>:secret:fitness-assistant/dev/payment-database*"
    },
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": [
        "arn:aws:lambda:ap-southeast-1:<account-id>:function:fitness-assistant-dev-auth",
        "arn:aws:lambda:ap-southeast-1:<account-id>:function:fitness-assistant-dev-gym",
        "arn:aws:lambda:ap-southeast-1:<account-id>:function:fitness-assistant-dev-user",
        "arn:aws:lambda:ap-southeast-1:<account-id>:function:fitness-assistant-dev-ai"
      ]
    }
  ]
}
```

Notes:

- AI Lambda invoke permission is only needed if `AI_LAMBDA_NAME` is configured.
- Migration Lambda needs CloudWatch Logs + Secrets Manager read only, plus VPC network reachability to Aurora.

## 17. API GATEWAY ROUTES

Do not use:

```text
ANY /{proxy+}
```

Do not expose unrestricted internal access without service-secret control:

```text
/internal/*
```

Recommended route prefix pairs:

- `GET /health`
- `GET /metrics`
- `ANY /payments`
- `ANY /payments/{proxy+}`
- `ANY /me`
- `ANY /me/{proxy+}`
- `ANY /me/payments`
- `ANY /me/payments/{proxy+}`
- `ANY /admin/payments`
- `ANY /admin/payments/{proxy+}`
- Internal only if service-to-service access is explicitly needed:
  - `ANY /internal`
  - `ANY /internal/{proxy+}`

Route classification:

- PUBLIC/provider:
  - `GET /payments/webhook/vnpay`
  - `POST /payments/webhook/:provider`
  - `GET /payments/vnpay/return`
  - `GET /payments/vnpay/sim` only in demo mode
- AUTH user:
  - `GET /me/payments`
  - `GET /me/payments/methods`
  - `GET /me/payments/:id`
  - `POST /me/payments/:id/sync`
  - `GET /me/wallet`
  - `GET /me/wallet/transactions`
  - `GET /me/pt-wallet`
  - `GET /me/pt-wallet/transactions`
  - `POST /me/withdrawals`
  - `GET /me/withdrawals`
- ADMIN:
  - `GET /admin/payments`
  - `GET /admin/payments/reconciliation`
  - `GET /admin/payments/commissions`
  - `PATCH /admin/payments/commissions/:id/settle` returns `410`
  - `GET /admin/payments/withdrawals`
  - `POST /admin/payments/withdrawals/:id/approve`
  - `POST /admin/payments/withdrawals/:id/reject`
  - `POST /admin/payments/withdrawals/:id/mark-paid`
  - `POST /admin/payments/:id/refund`
  - `POST /admin/payments/:transactionId/retry-activation`
- INTERNAL:
  - `POST /internal/payments/wallet-transfer`
  - `POST /internal/payments/:id/refund`
  - `POST /internal/payments/checkout`
  - `POST /internal/contracts/release-session`
  - `POST /internal/contracts/no-show`
  - `POST /internal/contracts/late-arrival`
  - `POST /internal/contracts/terminate`
  - `POST /internal/contracts/money-breakdown`
  - `POST /internal/contracts/referral`
  - `POST /internal/contracts/referral/clawback`
  - `POST /internal/contracts/membership-release`
  - `POST /internal/contracts/membership-cancel-forfeit`
  - `POST /internal/payments/:transactionId/mark-activated`
  - `GET /internal/payments/:transactionId`
  - `GET /internal/wallets/:ownerType/:ownerId`
  - `POST /internal/withdrawals/gym/:gymId`
  - `GET /internal/withdrawals/gym/:gymId`
  - `POST /internal/personalized-service/release`
  - `POST /internal/personalized-service/refund`

## 18. HTTP HANDLER

```text
dist/lambda.handler
```

Source:

```text
backend/services/payment-service/src/lambda.ts
```

Jobs handler:

```text
dist/jobs-lambda.handler
```

## 19. MIGRATION HANDLER

```text
dist/migrate-lambda.handler
```

Source:

```text
backend/services/payment-service/src/migrate-lambda.ts
```

Safety guard:

```text
database === "fitness_assistant_payment"
```

Refusal error:

```text
Refusing to run Payment Service migrations against non-payment database.
```

Only migration command used by handler:

```text
prisma migrate deploy
```

The handler can create `fitness_assistant_payment` if absent by connecting to maintenance DB `postgres`, checking `pg_database`, then running `CREATE DATABASE`.

## 20. HTTP ARTIFACT PATH + SIZE

Path:

```text
backend/services/payment-service/artifacts/payment-lambda.zip
```

Size:

```text
37,766,772 bytes
≈ 36.02 MiB compressed
90,501,380 bytes
≈ 86.31 MiB uncompressed
```

ZIP content verification:

- `dist/lambda.js`: present
- `dist/jobs-lambda.js`: present
- `dist/generated/prisma/libquery_engine-rhel-openssl-3.0.x.so.node`: present
- `node_modules/serverless-http/package.json`: present
- `node_modules/@aws-sdk/client-lambda/package.json`: present
- `node_modules/@aws-sdk/client-secrets-manager/package.json`: present
- `.env`/`.git`/tests: not present by name scan
- Secret pattern scan: `0` hits

HTTP ZIP is under 50 MiB.

## 21. MIGRATION ARTIFACT PATH + SIZE

Path:

```text
backend/services/payment-service/artifacts/payment-migrate-lambda.zip
```

Size:

```text
72,417,988 bytes
≈ 69.06 MiB compressed
170,177,098 bytes
≈ 162.29 MiB uncompressed
```

ZIP content verification:

- `dist/migrate-lambda.js`: present
- `prisma/schema.prisma`: present
- `prisma/migrations/**/migration.sql`: `11`
- `node_modules/prisma/build/index.js`: present
- `node_modules/@prisma/engines/schema-engine-rhel-openssl-3.0.x`: present
- `node_modules/@prisma/engines/libquery_engine-rhel-openssl-3.0.x.so.node`: present
- `node_modules/prisma/libquery_engine-rhel-openssl-3.0.x.so.node`: present
- `.env`/`.git`/tests: not present by name scan
- Secret pattern scan: `0` hits

Migration ZIP is greater than 50 MiB. Upload through S3 when using AWS Console.

## 22. AWS MANUAL DEPLOYMENT ORDER

Recommended manual order:

1. Create/update Secrets Manager secret:
   - `fitness-assistant/dev/payment-database`
2. Secret JSON:

```json
{
  "username": "<aurora-master-or-migration-user>",
  "password": "<password>",
  "host": "fitness-assistant-dev-aurora.cluster-cda2u2ycivaj.ap-southeast-1.rds.amazonaws.com",
  "port": 5432,
  "database": "fitness_assistant_payment"
}
```

3. Create migration Lambda:
   - name: `fitness-assistant-dev-payment-migrate`
   - runtime: Node.js `22.x`
   - architecture: `x86_64`
   - handler: `dist/migrate-lambda.handler`
   - upload `payment-migrate-lambda.zip` through S3
   - timeout: `10–15 minutes`
   - memory: at least `1024 MB`
   - VPC/private app subnets if Aurora is private
   - SG allowed to reach Aurora PostgreSQL `5432`
4. Invoke migration Lambda manually once from AWS Console after re-checking secret database field.
5. Create/update HTTP Lambda:
   - name: `fitness-assistant-dev-payment`
   - runtime: Node.js `22.x`
   - architecture: `x86_64`
   - handler: `dist/lambda.handler`
   - upload `payment-lambda.zip`
   - same VPC/SG DB access if Aurora is private
6. Configure HTTP Lambda env from section 15.
7. Add API Gateway routes from section 17.
8. Create optional jobs Lambda:
   - name: `fitness-assistant-dev-payment-jobs`
   - same `payment-lambda.zip`
   - handler: `dist/jobs-lambda.handler`
   - EventBridge payload `{ "job": "reconciliation" }`
   - schedule `rate(5 minutes)`
9. Configure provider callback URLs in VNPay/MoMo/PayOS/ZaloPay dashboards to the deployed public URLs.

## 23. BLOCKERS

Code/artifact blockers:

- None found for manual AWS Console upload/configuration of Payment HTTP Lambda, migration Lambda, and reconciliation jobs Lambda.

Manual/external blockers:

- `fitness-assistant/dev/payment-database` secret must be created with exact database name `fitness_assistant_payment`.
- Payment migrations have not been run on AWS yet.
- Provider credentials and dashboard callback URLs are required for real payments.
- `AI_LAMBDA_NAME` should remain unset unless AI Lambda/facade has compatible internal personalized-service endpoints; otherwise use `AI_SERVICE_URL` only if reachable.
- `prisma generate` on this Windows workspace hits `EPERM rename` for locked generated engine files. Artifact scripts continue and package required RHEL engines explicitly.

Build verification:

```text
pnpm --filter @gym-coach/payment-service build
Result: PASS

pnpm --filter @gym-coach/payment-service run build:lambda-zip
Result: PASS

pnpm --filter @gym-coach/payment-service run build:migrate-lambda-zip
Result: PASS
```

No AWS deployment, AWS migration, AWS smoke test, local smoke test, mock resource, or test AWS resource was created.

## 24. FINAL VERDICT

PAYMENT SERVICE READY FOR REAL AWS DEPLOYMENT
