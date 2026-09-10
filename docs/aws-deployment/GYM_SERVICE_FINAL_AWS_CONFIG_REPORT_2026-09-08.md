# Gym Service — AWS Lambda Manual Deployment Readiness Report

Ngày kiểm tra: 2026-09-08  
Scope: `backend/services/gym-service` only  
AWS target: `ap-southeast-1`, Node.js `22.x`, `x86_64`

## 1. GYM SERVICE RESPONSIBILITIES

Gym Service hiện quản lý các domain sau, theo `src/app.ts`, route files và Prisma schema:

- Public gym discovery: gym list/detail, public plans, public trainers, reviews.
- Gym Owner operations: brand, branch/gym, plan, membership list, check-in QR, check-in log, trainer affiliation, PT collaboration, wallet/withdrawal proxy.
- Client operations: purchase/pay/cancel gym memberships, membership warning, membership list/detail, self check-in by QR scan, gym review.
- PT operations: gym invitations, affiliations, PT-initiated collaborations, accepted gyms for PT.
- Admin operations: gym moderation, brand rename approval, closed-gym review queue, membership refund/pending issue resolution.
- Internal service endpoints: membership activation/cancel-after-refund, collaboration active rates lookup.
- Background sweeps: membership payout/expiry/pending-payment cleanup and referral settlement retry.

## 2. GYM OWNER → BRAND → BRANCH BUSINESS RULE AUDIT

Target business rule:

```text
1 Gym Owner account
→ owns exactly 1 Gym Brand
→ Gym Brand can have many Gym Branch rows
```

Source findings:

- `GymBrand.ownerId` exists in `prisma/schema.prisma`.
- `Gym.branches` relation is represented as `Gym.brandId -> GymBrand.id`.
- `GymBrand.branches Gym[]` confirms brand → many branches.
- Existing DB constraint is only `@@index([ownerId])`, not `@@unique([ownerId])`.
- Before this pass, `POST /owner/brands` called `brandService.createBrand()` and could create multiple brands for the same owner.
- `gymService.createGym()` and `updateOwnedGym()` correctly check that a `brandId` belongs to the same owner before attaching/moving a branch.
- Branch ownership is enforced by `gymService.getOwnedGym()`.

Change made:

- `brandService.createBrand()` now checks `brandRepository.findByOwner(ownerId)` and returns `409` if the owner already has a brand.

Remaining note:

- API now prevents new multi-brand creation.
- DB still does not have a unique constraint on `gym_brands.owner_id`. Adding it should be a separate migration after checking existing data for duplicates.

## 3. CODE / FRAMEWORK AUDIT

- Framework: Express + TypeScript.
- Entrypoint local/container: `src/server.ts`.
- Express app: `src/app.ts`.
- `src/app.ts` exports `app` and does not call `listen()`.
- `src/server.ts` calls `app.listen(PORT)` and starts background sweeps.
- HTTP Lambda handler added at `src/lambda.ts`.
- Jobs Lambda handler added at `src/jobs-lambda.ts`.
- Error handling: async route handlers use `asyncHandler`, and `app.ts` has final error middleware.

## 4. DATABASE ARCHITECTURE

- ORM: Prisma.
- Datasource: PostgreSQL via `DATABASE_URL`.
- Prisma schema: `backend/services/gym-service/prisma/schema.prisma`.
- Generated Prisma client: `src/generated/prisma`.
- Main tables:
  - `gym_brands`
  - `gyms`
  - `gym_membership_plans`
  - `gym_membership_contracts`
  - `gym_trainer_affiliations`
  - `gym_check_ins`
  - `gym_reviews`
  - `gym_pt_collaborations`
  - `gym_membership_referrals`
- No DB-level cross-service foreign key to Auth/User/Fitness/Payment tables was found.

## 5. SEPARATE DATABASE REQUIRED — YES/NO

YES.

Recommended logical DB:

```text
fitness_assistant_gym
```

Do not reuse:

```text
fitness_assistant
fitness_assistant_user
fitness_assistant_fitness
```

Reason:

- Gym Service has independent Prisma schema/migrations.
- No cross-service FK requires sharing Auth/User/Fitness DB.
- Separate DB reduces migration blast radius.

## 6. MIGRATION AUDIT

Migration count:

```text
9
```

Statement audit:

```text
CREATE=40
ALTER=18
DROP=0
DELETE=0
TRUNCATE=0
CREATE_TYPE=9
ALTER_TYPE=1
CREATE_INDEX=22
FOREIGN_KEY=9
CONSTRAINT=18
```

Notes:

- No AWS migration was run.
- No `prisma db push`.
- No `prisma migrate reset`.
- No `--accept-data-loss`.
- Existing migrations include `ON DELETE` FK clauses, but no standalone destructive `DELETE` statement.

## 7. LAMBDA COMPATIBILITY

Prepared:

- `src/lambda.ts` exports `dist/lambda.handler`.
- `src/jobs-lambda.ts` exports `dist/jobs-lambda.handler`.
- `src/migrate-lambda.ts` exports `dist/migrate-lambda.handler`.
- Lambda runtime config supports `DATABASE_SECRET_ID`.
- Local/container `server.ts` remains unchanged as the listener runtime.
- Lambda handler does not call `app.listen()`.
- HTTP Lambda does not start `setInterval` background sweeps.
- Prisma binary target now includes `rhel-openssl-3.0.x`.
- Artifacts are flattened; they do not rely on pnpm symlinks.

## 8. AUTH / SERVICE COMMUNICATION

Auth:

- `auth.middleware.ts` now uses `authServiceClient.verifyToken()`.
- Preferred AWS transport: `AUTH_LAMBDA_NAME=fitness-assistant-dev-auth`.
- Local fallback: `AUTH_SERVICE_URL`.
- `checkin.service.ts` internal user lookup now also supports direct Auth Lambda invoke.

User:

- `profile.client.ts` supports `USER_LAMBDA_NAME=fitness-assistant-dev-user`.
- Local fallback: `USER_SERVICE_URL`.
- Used for referral-code lookup.

Payment:

- `payment.client.ts` supports `PAYMENT_LAMBDA_NAME` if/when Payment Lambda exists.
- Local fallback: `PAYMENT_SERVICE_URL`.
- Current AWS state in prompt did not list Payment Lambda as deployed, so this remains conditional.

Fitness:

- No real Gym Service call to Fitness Service was found in source, so `FITNESS_LAMBDA_NAME` support was not implemented.

## 9. FILE STORAGE AUDIT

Search scope included `fs`, `multer`, `uploads`, `writeFile`, `mkdir`, `createWriteStream`.

Findings:

- No runtime multipart upload flow found in Gym Service.
- No persistent local image/document storage path found.
- Gym logo/branch photo/document upload is not implemented in current Gym Service source.
- No S3 IAM permission is required for current Gym Service Lambda.

## 10. REDIS AUDIT

No Redis dependency found in `backend/services/gym-service/src`.

Result:

- Redis is not required for Gym Service Lambda.
- No ElastiCache needed for this service in current scope.

## 11. BACKGROUND JOB AUDIT

Jobs found:

1. `membership-payout-sweep`
   - Source: `src/services/membershipPayout.sweep.ts`
   - Local/container starter: `startMembershipPayoutSweep()` in `src/server.ts`
   - Default cadence: every `10 minutes`
   - Env override: `MEMBERSHIP_PAYOUT_SWEEP_INTERVAL_MS`
   - Additional stale-pending threshold: `GYM_MEMBERSHIP_PENDING_PAYMENT_STALE_MINUTES`, default `10`
   - Recommended EventBridge Scheduler expression: `rate(10 minutes)`

2. `referral-settlement-sweep`
   - Source: `src/services/referral-settlement-sweep.service.ts`
   - Local/container starter: `startReferralSettlementSweepJob()` in `src/server.ts`
   - Default cadence: every `10 minutes`
   - Env override: `REFERRAL_SETTLEMENT_SWEEP_INTERVAL_MS`
   - Recommended EventBridge Scheduler expression: `rate(10 minutes)`

Lambda:

- `src/jobs-lambda.ts` dispatches one job per invocation.
- HTTP Lambda must not run these intervals.

## 12. EXTERNAL DEPENDENCIES

- Auth Service: token verify and internal user lookup.
- User Service: referral code lookup.
- Payment Service: checkout, wallet transfer, mark activated, referral settlement/clawback, membership release, refund, wallet, withdrawal.
- Aurora/PostgreSQL: Gym DB.
- Secrets Manager: optional/strongly recommended for DB config.
- CloudWatch Logs: Lambda logging.

No Fitness Service dependency found.

## 13. FILES CHANGED

Changed/added for AWS Lambda readiness:

- `backend/services/gym-service/package.json`
- `pnpm-lock.yaml`
- `backend/services/gym-service/prisma/schema.prisma`
- `backend/services/gym-service/src/lambda.ts`
- `backend/services/gym-service/src/jobs-lambda.ts`
- `backend/services/gym-service/src/migrate-lambda.ts`
- `backend/services/gym-service/src/config/lambda-runtime.ts`
- `backend/services/gym-service/src/utils/runtime.util.ts`
- `backend/services/gym-service/src/clients/lambda-http.client.ts`
- `backend/services/gym-service/src/clients/auth-service.client.ts`
- `backend/services/gym-service/src/clients/profile.client.ts`
- `backend/services/gym-service/src/clients/payment.client.ts`
- `backend/services/gym-service/src/middleware/auth.middleware.ts`
- `backend/services/gym-service/src/services/checkin.service.ts`
- `backend/services/gym-service/src/services/brand.service.ts`
- `backend/services/gym-service/scripts/lambda-package-lib.js`
- `backend/services/gym-service/scripts/build-lambda-artifact.js`
- `backend/services/gym-service/scripts/build-migrate-lambda-artifact.js`
- `backend/services/gym-service/artifacts/gym-lambda.zip`
- `backend/services/gym-service/artifacts/gym-migrate-lambda.zip`

Build side-effect note:

- `prisma generate` on Windows hit `EPERM rename` because generated engine files appear locked. Build scripts continue and explicitly package the required RHEL engine.

## 14. ENVIRONMENT VARIABLES

| VARIABLE | REQUIRED? | SECRET? | PURPOSE | AWS VALUE / PLACEHOLDER |
|---|---:|---:|---|---|
| `NODE_ENV` | Yes | No | Production runtime guard | `production` |
| `AWS_REGION` | Yes | No | AWS SDK region | `ap-southeast-1` |
| `AWS_DEFAULT_REGION` | Optional | No | SDK fallback | `ap-southeast-1` |
| `DATABASE_SECRET_ID` | Recommended | No | Load DB JSON from Secrets Manager | `fitness-assistant/dev/gym-database` |
| `DATABASE_URL` | Alternative/local | Yes | Direct Prisma DB URL fallback | Leave unset on AWS if using secret |
| `INTERNAL_SERVICE_SECRET` | Yes | Yes | Internal service auth header | Existing shared internal secret |
| `INTERNAL_API_SECRET` | Conditional | Yes | Secondary internal secret compatibility | Existing internal API secret if used |
| `AUTH_LAMBDA_NAME` | Recommended | No | Direct Auth Lambda invoke | `fitness-assistant-dev-auth` |
| `AUTH_SERVICE_URL` | Local/fallback | No | Auth HTTP fallback | local/API fallback only |
| `USER_LAMBDA_NAME` | Recommended | No | Direct User Lambda invoke | `fitness-assistant-dev-user` |
| `USER_SERVICE_URL` | Local/fallback | No | User HTTP fallback | local/API fallback only |
| `PAYMENT_LAMBDA_NAME` | Conditional | No | Direct Payment Lambda invoke | unset until Payment Lambda exists |
| `PAYMENT_SERVICE_URL` | Conditional/fallback | No | Payment HTTP fallback | payment URL/API fallback |
| `FITNESS_LAMBDA_NAME` | No | No | Not used by current Gym source | unset |
| `FITNESS_SERVICE_URL` | No | No | Not used by current Gym source | unset |
| `PORT` | Local only | No | Express local port | `3006` |
| `CHECKIN_TOKEN_SECRET` | Recommended | Yes | Sign gym QR check-in token | Strong random secret |
| `GYM_QR_TTL_DAYS` | Optional | No | QR token TTL days | default `365` |
| `PLATFORM_COMMISSION_RATE` | Optional | No | Gym membership platform cut | default `0.10` |
| `GYM_MEMBERSHIP_REFERRAL_RATE` | Optional | No | PT referral cut | default `0.10` |
| `MAX_COLLABORATION_ROUNDS` | Optional | No | Collaboration negotiation cap | default `5` |
| `COLLABORATION_OFFER_TTL_DAYS` | Optional | No | Collaboration offer expiry | default `7` |
| `MIN_PLATFORM_RATE` | Optional | No | Minimum platform rate | default `0.10` |
| `MEMBERSHIP_PAYOUT_SWEEP_INTERVAL_MS` | Jobs optional | No | Payout sweep cadence | default `600000` |
| `GYM_MEMBERSHIP_PENDING_PAYMENT_STALE_MINUTES` | Jobs optional | No | Pending payment stale cutoff | default `10` |
| `REFERRAL_SETTLEMENT_SWEEP_INTERVAL_MS` | Jobs optional | No | Referral retry sweep cadence | default `600000` |

## 15. IAM REQUIREMENTS

Minimum Gym HTTP Lambda permissions:

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
      "Resource": "arn:aws:secretsmanager:ap-southeast-1:<account-id>:secret:fitness-assistant/dev/gym-database*"
    },
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": [
        "arn:aws:lambda:ap-southeast-1:<account-id>:function:fitness-assistant-dev-auth",
        "arn:aws:lambda:ap-southeast-1:<account-id>:function:fitness-assistant-dev-user",
        "arn:aws:lambda:ap-southeast-1:<account-id>:function:fitness-assistant-dev-payment"
      ]
    }
  ]
}
```

Notes:

- Payment Lambda permission is only needed if `PAYMENT_LAMBDA_NAME` is configured.
- No S3 permission required by current Gym Service source.
- Migration Lambda needs CloudWatch Logs + Secrets Manager only, plus VPC network reachability to Aurora.

## 16. API GATEWAY ROUTES

Do not use:

```text
ANY /{proxy+}
```

Do not expose:

```text
/internal/*
```

Recommended public route prefix pairs:

- `GET /health`
- `GET /metrics`
- `ANY /gyms`
- `ANY /gyms/{proxy+}`
- `ANY /pt`
- `ANY /pt/{proxy+}`
- `ANY /me`
- `ANY /me/{proxy+}`
- `ANY /owner`
- `ANY /owner/{proxy+}`
- `ANY /admin`
- `ANY /admin/{proxy+}`
- `ANY /collaborations`
- `ANY /collaborations/{proxy+}`

Route classification:

- PUBLIC:
  - `GET /gyms`
  - `GET /gyms/:id`
  - `GET /gyms/:gymId/plans`
  - `GET /gyms/:gymId/trainers`
  - `GET /gyms/:gymId/reviews`
  - `GET /pt/:ptUserId/gyms`
- CLIENT:
  - `POST /gyms/:gymId/memberships`
  - `POST /me/gym-memberships/:id/pay`
  - `POST /me/gym-memberships/:id/cancel`
  - `POST /me/gym-memberships/:id/cancel-membership`
  - `GET /gyms/:gymId/membership-warnings`
  - `GET /me/gym-memberships`
  - `GET /me/gym-memberships/:id`
  - `POST /me/gym-checkins`
  - `GET /me/gym-checkins`
  - `POST /gyms/:gymId/reviews`
  - `DELETE /gyms/:gymId/reviews`
- PT:
  - `GET /pt/gym-invitations`
  - `PATCH /pt/gym-invitations/:id`
  - `GET /pt/gym-affiliations`
  - `POST /gyms/:gymId/collaborations`
  - `PATCH /collaborations/:id`
  - `DELETE /collaborations/:id`
  - `GET /me/collaborations`
- GYM_OWNER:
  - `POST /owner/brands`
  - `GET /owner/brands`
  - `GET /owner/brands/:id`
  - `PATCH /owner/brands/:id`
  - `POST /owner/gyms`
  - `GET /owner/gyms`
  - `GET /owner/gyms/:id`
  - `PATCH /owner/gyms/:id`
  - `PATCH /owner/gyms/:id/operational-status`
  - `GET /owner/gyms/:gymId/wallet`
  - `POST /owner/gyms/:gymId/plans`
  - `GET /owner/gyms/:gymId/plans`
  - `PATCH /owner/gyms/:gymId/plans/:planId`
  - `GET /owner/gyms/:gymId/memberships`
  - `GET /owner/gyms/:gymId/checkin-qr`
  - `GET /owner/gyms/:gymId/checkins`
  - `POST /owner/gyms/:gymId/trainers`
  - `POST /owner/gyms/:gymId/collaborations`
  - `PATCH /owner/collaborations/:id`
  - `DELETE /owner/collaborations/:id`
  - `GET /owner/collaborations`
  - `POST /owner/gyms/:gymId/withdrawals`
  - `GET /owner/gyms/:gymId/withdrawals`
- ADMIN:
  - `GET /admin/gyms`
  - `PATCH /admin/gyms/:id/status`
  - `PATCH /admin/gyms/:id/approve-rename`
  - `GET /admin/gyms/permanently-closed`
  - `GET /admin/brands`
  - `PATCH /admin/brands/:id/approve-rename`
  - `POST /admin/gym-memberships/:id/refund`
  - `GET /admin/gym-memberships/pending-issues`
  - `POST /admin/gym-memberships/:id/resolve-pending-issue`
- INTERNAL ONLY:
  - `POST /internal/gym-memberships/:id/activate`
  - `POST /internal/gym-memberships/:id/cancel-after-refund`
  - `GET /internal/collaborations/active`

## 17. HTTP HANDLER

```text
dist/lambda.handler
```

Source:

```text
backend/services/gym-service/src/lambda.ts
```

## 18. MIGRATION HANDLER

```text
dist/migrate-lambda.handler
```

Source:

```text
backend/services/gym-service/src/migrate-lambda.ts
```

Safety guard:

```text
database === "fitness_assistant_gym"
```

Refusal error:

```text
Refusing to run Gym Service migrations against non-gym database.
```

Only migration command used by handler:

```text
prisma migrate deploy
```

## 19. BUILD COMMANDS

HTTP artifact:

```powershell
pnpm --filter @gym-coach/gym-service run build:lambda-zip
```

Migration artifact:

```powershell
pnpm --filter @gym-coach/gym-service run build:migrate-lambda-zip
```

Build verification:

```text
pnpm --filter @gym-coach/gym-service build
```

Result: PASS.

No test/smoke-test was run per instruction.

## 20. HTTP ARTIFACT PATH + SIZE

Path:

```text
backend/services/gym-service/artifacts/gym-lambda.zip
```

Size:

```text
37,766,144 bytes
≈ 36.02 MiB compressed
90,479,240 bytes
≈ 86.29 MiB uncompressed
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
backend/services/gym-service/artifacts/gym-migrate-lambda.zip
```

Size:

```text
72,419,965 bytes
≈ 69.07 MiB compressed
170,183,769 bytes
≈ 162.30 MiB uncompressed
```

ZIP content verification:

- `dist/migrate-lambda.js`: present
- `prisma/schema.prisma`: present
- `prisma/migrations/**/migration.sql`: `9`
- `node_modules/prisma/build/index.js`: present
- `node_modules/@prisma/engines/schema-engine-rhel-openssl-3.0.x`: present
- `node_modules/@prisma/engines/libquery_engine-rhel-openssl-3.0.x.so.node`: present
- `.env`/`.git`/tests: not present by name scan
- Secret pattern scan: `0` hits

Migration ZIP is greater than 50 MiB. Upload through S3 when using AWS Console.

## 22. DATABASE MIGRATION REQUIRED — YES/NO

YES.

Gym Service should be migrated into:

```text
fitness_assistant_gym
```

Migration Lambda supports:

- reading DB config from `DATABASE_SECRET_ID`;
- creating `fitness_assistant_gym` if absent;
- running `prisma migrate deploy`.

No AWS migration was executed in this pass.

## 23. AWS MANUAL CONFIG REQUIRED

HTTP Lambda:

1. Create/update Lambda `fitness-assistant-dev-gym`.
2. Runtime: Node.js `22.x`.
3. Architecture: `x86_64`.
4. Handler: `dist/lambda.handler`.
5. Upload `gym-lambda.zip`.
6. Env:
   - `NODE_ENV=production`
   - `AWS_REGION=ap-southeast-1`
   - `DATABASE_SECRET_ID=fitness-assistant/dev/gym-database`
   - `INTERNAL_SERVICE_SECRET=<secret>`
   - `AUTH_LAMBDA_NAME=fitness-assistant-dev-auth`
   - `USER_LAMBDA_NAME=fitness-assistant-dev-user`
   - `PAYMENT_LAMBDA_NAME=<only when payment lambda exists>`
   - fallback URLs only if needed
7. Attach VPC/private app subnets if Aurora is private.
8. Attach Lambda SG that can reach Aurora PostgreSQL `5432`.
9. Add API Gateway routes from section 16.
10. Do not expose `/internal`.

Migration Lambda:

1. Create Lambda `fitness-assistant-dev-gym-migrate`.
2. Runtime: Node.js `22.x`.
3. Architecture: `x86_64`.
4. Handler: `dist/migrate-lambda.handler`.
5. Upload `gym-migrate-lambda.zip` through S3.
6. Env:
   - `AWS_REGION=ap-southeast-1`
   - `DATABASE_SECRET_ID=fitness-assistant/dev/gym-database`
7. Secret JSON must include:

```json
{
  "username": "<aurora-master-or-migration-user>",
  "password": "<password>",
  "host": "fitness-assistant-dev-aurora.cluster-cda2u2ycivaj.ap-southeast-1.rds.amazonaws.com",
  "port": 5432,
  "database": "fitness_assistant_gym"
}
```

8. Timeout: `10–15 minutes`.
9. Memory: at least `1024 MB`.
10. Invoke manually once from AWS Console after checking the secret database field.

Jobs Lambda:

1. Use same HTTP artifact if desired.
2. Handler: `dist/jobs-lambda.handler`.
3. Event payloads:
   - `{ "job": "membership-payout-sweep" }`
   - `{ "job": "referral-settlement-sweep" }`
4. EventBridge schedule recommendation:
   - `rate(10 minutes)` for each job.

## 24. BLOCKERS

Code/artifact blockers:

- None for manual AWS Console upload/configuration of Gym HTTP Lambda and Gym migration Lambda.

Manual/external blockers:

- `fitness_assistant_gym` secret must be created with exact database name.
- Migrations have not been run on AWS yet.
- Payment Lambda was not listed as deployed in the provided AWS state. Payment-dependent flows need either `PAYMENT_LAMBDA_NAME` once deployed or a reachable `PAYMENT_SERVICE_URL`.
- DB unique constraint for `gym_brands.owner_id` is not yet present. API now blocks creating a second brand, but DB-level enforcement should be added later after duplicate-data audit.
- `prisma generate` on this Windows workspace hits `EPERM rename` for locked generated engine files. Build scripts continue and package required RHEL engines explicitly.

## 25. FINAL VERDICT

GYM SERVICE READY FOR REAL AWS DEPLOYMENT

