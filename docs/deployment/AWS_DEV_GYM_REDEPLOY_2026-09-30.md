# AWS DEV — Gym Lambda Redeploy (Continuation, Phase 1)

Date: 2026-09-30. Builds on `AWS_DEV_GYM_API_GATEWAY_FIX_2026-09-30.md` (routing already fixed and confirmed reaching the Lambda for all 9 admin namespaces — this phase closes the remaining application-level gap for 3 of them).

## 1A — Source verification

Confirmed present and compiling (`npx tsc --noEmit`, clean) in `backend/services/gym-service/src/routes/admin.routes.ts`: all 9 namespaces (`gyms`, `brands`, `gym-memberships`, `partners`, `partner-accounts`, `commission-rate`, `complaints`, `complaint-photos`, `branch-documents`). Ran the gym-service unit tests that don't require a live DB (`partner-access.policy.test.ts`, `partner-application.state.test.ts`, `partner-s3.guard.test.ts`, `partner-s3.request-signing.test.ts`): 31/31 pass.

## 1B — Existing build process

`backend/services/gym-service/package.json`: `"build:lambda-zip": "node scripts/build-lambda-artifact.js"`. Uses the shared `scripts/lambda-package-lib.js` (same helpers gym-service already used: `flattenNodeModules`, `copyRhelQueryEngine`, `prunePrismaEngines`, `makeZip`). No new packaging method invented.

## 1C — Backup

Before touching anything:
- `backend/services/gym-service/artifacts/rollback/gym-lambda-config-BEFORE-20260930T053501Z.json`
- `backend/services/gym-service/artifacts/rollback/gym-lambda-BACKUP-20260930T053501Z.zip`

Byte-verified: `sha256sum` of the backup zip, base64-encoded, equals the Lambda's own reported `CodeSha256` (`IdLF7GOkBYiNKs8JfWS0JzcvNX4l1bprsMETbXndlPg=`) exactly.

## 1D — Build

`docker stop gymcoach-gym-dev` first (known Windows EPERM gotcha — a running dev container bind-mounting this directory can lock the Prisma query-engine `.node` file during `prisma generate`). Ran `node scripts/build-lambda-artifact.js`: shared package build → Prisma generate → gym-service `tsc` build → `pnpm deploy --prod` → flatten node_modules → copy dist+generated, prune non-RHEL Prisma engines → zip.

Result: `artifacts/gym-lambda.zip`, 3087 entries, 36.43 MB compressed. `docker start gymcoach-gym-dev` afterward, per the same established pattern.

**Artifact validation**: `dist/lambda.js` present; no `*.tmp*` stray engine files; `libquery_engine-rhel-openssl-3.0.x.so.node` present (both `dist/generated/prisma/` and `node_modules/.prisma/client/`); extracted and `require()`d `dist/lambda.js` locally — `handler` exports as a function with no import-time error.

## 1E — Deploy

Direct `aws lambda update-function-code --zip-file` failed once with "Connection was closed before we received a valid response" (network interruption — the same class of failure documented for the earlier auth-service Group C deployment). Verified via `get-function-configuration` that `CodeSha256`/`LastModified` were unchanged before retrying (no partial/corrupt state). Retried via S3-mediated upload (`aws s3 cp` to `s3://fitness-assistant-deployments-dev-191798898985/gym-lambda/...`, then `update-function-code --s3-bucket --s3-key`) — succeeded.

```
Old CodeSha256: IdLF7GOkBYiNKs8JfWS0JzcvNX4l1bprsMETbXndlPg=  (LastModified 2026-09-20T16:12:19Z)
New CodeSha256: X5IYqySn8ez1Z9hz1dgxUnyIWiNOw4F72TOlTK1POMg=  (LastModified 2026-09-30T05:43:47Z)
State: Active, LastUpdateStatus: Successful
```

## 1F — Live read-only test

| Endpoint | ADMIN | Before this deploy |
|---|---|---|
| GET /admin/partners | 200, real data | 404 `Cannot GET` |
| GET /admin/partners/queue | 200, real KPI object | 404 `Cannot GET` |
| GET /admin/partners/applications | 200, `{items:[],counts:{}}` | 404 `Cannot GET` |
| GET /admin/commission-rate | 200, `{rate:0.05}` | 404 `Cannot GET` |
| GET /admin/complaints | 200, `[]` | 404 `Cannot GET` |

CUSTOMER on `/admin/partners`: 403 (role gate still correct). Regression check on the 3 previously-working namespaces: `GET /admin/gyms` [ADMIN] 200, `GET /gyms` (public) 200 — unchanged. CloudWatch (`/aws/lambda/fitness-assistant-dev-gym`, 5-minute window covering these calls): 0 error-level log lines.

## Verdict

```
GYM_STALE_DEPLOYMENT:
FIXED
```

No rollback needed — no regression detected on any endpoint (old or new).
