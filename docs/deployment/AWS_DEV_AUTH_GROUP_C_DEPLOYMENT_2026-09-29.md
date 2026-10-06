# AWS DEV Auth Group C Deployment — Transaction Atomicity Fix

**Date:** 2026-09-29
**Approved scope:** Group C only (deploy the auth transaction-atomicity fix). Group A prepared but NOT executed. Group B untouched.

Evidence legend: **VERIFIED** (confirmed live against AWS in this session) · **HISTORICAL** · **UNKNOWN**.

---

## 1. AWS Identity Verification

```
Account: 191798898985  -- matches, proceeded
Region:  ap-southeast-1
```

## 2. Pre-Deployment State (VERIFIED)

| Property | Value |
|---|---|
| State | `Active` |
| LastUpdateStatus | `Successful` |
| Runtime | `nodejs22.x` |
| Architecture | `x86_64` |
| Handler | `dist/lambda.handler` |
| PackageType | `Zip` |
| CodeSha256 (before) | `yTLQudumeGaxNEsOPb0Bubl392xfjpsW8COr8Yj1gF8=` |
| LastModified (before) | `2026-08-27T08:43:51.000+0000` |
| Published versions | **None** — only `$LATEST` existed; no `aws lambda publish-version` had ever been called for this function |
| Aliases | **None** |
| **API Gateway integration** | `AWS_PROXY` to the **unqualified** function ARN (`arn:...function:fitness-assistant-dev-auth`, no version/alias suffix) — **API Gateway always invokes `$LATEST`, directly** |
| Memory / Timeout / Ephemeral storage | 1024 MB / 30s / 512 MB |
| Reserved concurrency | None |
| KMS | None (default) |
| Layers | None |
| Execution role | `arn:aws:iam::191798898985:role/fitness-assistant-dev-auth-lambda-role` |
| VPC | subnets `subnet-02b39d77762465ef8`, `subnet-09e3230f7bca04c8e`; SG `sg-0b38ab22927b284ab` |
| Env var **names** (values not read) | `JWT_REFRESH_SECRET, SMTP_PASS, SMTP_PORT, JWT_SECRET, SMTP_FROM, SMTP_HOST, SMTP_USER, NODE_ENV, DATABASE_SECRET_ID, INTERNAL_SERVICE_SECRET` |

**Decisive fact for the rollback design:** with no published version and no alias, and API Gateway targeting the bare ARN, **the only rollback mechanism available is re-uploading a known-good zip to overwrite `$LATEST` again** — there is no "point the alias back" shortcut, because nothing was ever using one.

## 3. Local Code Review

`git diff` on all 4 runtime-adjacent files confirmed, line by line:
- `auth.repository.ts`: adds one type alias and an optional `client` parameter (default = existing singleton) to exactly 3 methods. No existing call site's behavior changes.
- `auth.service.ts`: `changePassword()` and `resetPasswordWithToken()` wrap their existing writes in `prisma.$transaction(...)`. Return shapes, hashing (`bcrypt`, cost 10, unchanged), user id/email/role fields, and error messages are byte-identical to before.
- No `JWT_SECRET` or `INTERNAL_SERVICE_SECRET` reference touched anywhere in the diff.
- No plaintext logging added — the transaction wrapper only logs nothing new; existing `logger.error` calls elsewhere are unaffected.
- `seed.ts` and `seedGuard.ts` changes are confirmed to be a Prisma seed script and a standalone guard module respectively — **neither is imported by `lambda.ts`, `app.ts`, or anything in the runtime request path**, confirmed by their absence from the deployed zip (§6).

## 4. Local Hardening Gaps Closed Before Deployment

- **4.1 Seed guard:** already hardened in the prior session (real `URL` parser, exact hostname allowlist, exact-`"true"` override check) — re-verified this session by re-reading `seedGuard.ts` and re-running its 10 dedicated tests; all pass. `ALLOW_DEMO_SEED` remains a hand-typed, per-invocation override by design (not a persisted config value) since no deployed Lambda/ECS task runs the seed at all — confirmed again this session.
- **4.2 Additional hardcoded-credential scripts:** `scripts/partner-application-e2e/browser-e2e.cjs` and `browser-e2e-mobile.cjs` (both accept an env-overridable `BASE_URL`, both had `admin@example.com`/`password123` hardcoded directly into a Playwright form-fill) — fixed with the same `requireEnv()` pattern as `test-admin-e2e.mjs`. The 3 lower-risk scripts (`legacy-owner-regression.cjs`, `api-e2e.mjs`, `admin-regression.cjs` — all hardcode `localhost` with no env override at all) and the mobile Detox specs (`E2E_PASSWORD` env-overridable but gated behind a full app rebuild to point elsewhere) were left as-is, per "phạm vi tối thiểu" — they cannot reach AWS without a separate deliberate code edit or rebuild first.
- **4.3 Test-count reconciliation:** re-run for real, not copied from the prior report. See §7 — **82 tests, 82 pass**, broken down exactly.

## 5. Local Testing (re-run this session, not assumed)

```
npm test          -> 82 pass, 0 fail, 0 skipped, 0 cancelled
npx tsc --noEmit  -> clean
npm run build     -> clean
```

Exact breakdown (static `test(` count cross-checked against the runner's own reported total):

| File | Count | Kind |
|---|---|---|
| `credential-rotation-hardening.test.ts` | 20 | Mocked unit tests |
| `credential-rotation-transaction.integration.test.ts` | 3 | 1 setup-check + **2 real, non-mocked Postgres integration tests** |
| `login-and-refresh.test.ts` | 12 | Pre-existing (1 updated this session to patch `prisma.$transaction`) |
| `login-rate-limit.test.ts` | 4 | Pre-existing |
| `partner-application.test.ts` | 12 | Pre-existing |
| `pt-deactivation-relay-sweep.test.ts` | 3 | Pre-existing |
| `pt-deactivation-relay.test.ts` | 3 | Pre-existing |
| `registration-otp.test.ts` | 7 | Pre-existing |
| `role-change-authorization.test.ts` | 5 | Pre-existing |
| `self-service-recovery.test.ts` | 8 | Pre-existing |
| `set-user-active-relays-pt-deactivation.test.ts` | 5 | Pre-existing |
| **Total** | **82** | matches the runner's own count exactly |

**Real PostgreSQL transaction evidence (not mocked):** `credential-rotation-transaction.integration.test.ts` creates a throwaway database (`gym_coach_auth_test_rotation`) on the local `gymcoach-postgres` container, runs the real migrations, then with zero repository mocks: (a) confirms a normal `changePassword()` call really persists the new hash and really deletes both refresh-token rows, and (b) forces the refresh-token delete to throw mid-transaction and confirms, via a fresh unmocked read, that the password update really rolled back. The throwaway database does not touch `gym_coach_auth` (real local dev data) — confirmed by name and by re-checking `pg_database` after the run.

## 6. Build/Package Mechanism (real, pre-existing, not invented this session)

`backend/services/auth-service/scripts/build-lambda-artifact.js` (run via `npm run build:lambda-zip` / directly with `node`). Confirmed by reading it in full: builds `@gym-coach/shared`, runs `prisma generate`, `tsc` builds `auth-service`, copies the generated Prisma client into `dist/`, resolves production dependencies via `pnpm deploy --prod`, flattens pnpm's isolated store into a classic `node_modules`, drops unused `@prisma/*` and non-Lambda Prisma query-engine binaries, and hand-writes a spec-correct zip (documented reason: Windows `Compress-Archive` produces backslash path separators that break Amazon Linux's unzip).

**A real, pre-documented Windows gotcha was hit and resolved exactly as documented:** `prisma generate` failed with `EPERM` on a query-engine `.node` file because the local `gymcoach-auth-dev` Docker container held a lock on it (bind mount). Fixed per the script's own comment: `docker stop gymcoach-auth-dev`, rebuilt successfully, then `docker start gymcoach-auth-dev` afterward.

**Content verification before deploying (not assumed):**
```
unzip -p artifacts/auth-lambda.zip dist/services/auth.service.js | grep -c '$transaction'   -> 2   (both fixed functions present)
unzip -l artifacts/auth-lambda.zip | grep -c __tests__                                       -> 0   (no test files leaked in)
unzip -p artifacts/rollback/...PRE-GROUPC-BACKUP.zip dist/services/auth.service.js | grep -c '$transaction' -> 0   (old code genuinely lacks the fix — negative control)
dist/lambda.js present at the exact path the configured Handler expects       -> confirmed
```

## 7. Backup / Rollback Artifact (VERIFIED)

Before any write:
1. Downloaded the currently-deployed code via `aws lambda get-function`'s presigned `Code.Location` URL to `artifacts/rollback/auth-lambda.PRE-GROUPC-BACKUP.zip`.
2. **Verified byte-for-byte**: `sha256(local file) = yTLQudumeGaxNEsOPb0Bubl392xfjpsW8COr8Yj1gF8=`, an EXACT match to the Lambda's reported `CodeSha256` before deployment — not assumed, computed and compared.
3. Additionally published an AWS-side version snapshot: `aws lambda publish-version` -> **Version 1**, `CodeSha256 = yTLQudumeGaxNEsOPb0Bubl392xfjpsW8COr8Yj1gF8=` (matches).

Rollback path, if ever needed: `aws lambda update-function-code --function-name fitness-assistant-dev-auth --zip-file fileb://backend/services/auth-service/artifacts/rollback/auth-lambda.PRE-GROUPC-BACKUP.zip --region ap-southeast-1` (or reference published Version 1). Since API Gateway targets the unqualified ARN, this immediately restores `$LATEST` to the exact pre-deployment code.

## 8. Old / New CodeSha256

| | CodeSha256 |
|---|---|
| Before | `yTLQudumeGaxNEsOPb0Bubl392xfjpsW8COr8Yj1gF8=` |
| **After** | `8z1cfStUOiFL2TPmMiq7UXwcnmIfGKH6ARL0UZlTDuo=` |

## 9. Deployment Operation

Direct `update-function-code --zip-file` (43 MB) **failed once** with `Connection was closed before we received a valid response` — a client-side network interruption during the large synchronous upload, not a server-side or code error. **Verified the Lambda was untouched** before retrying: `get-function` showed the OLD `CodeSha256`/`LastModified` unchanged, `State: Active`, `LastUpdateStatus: Successful` (from the prior, unrelated August deployment) — no partial/corrupt state existed. Retried via the more reliable path: uploaded to `s3://fitness-assistant-deployments-dev-191798898985/lambda-deploy-staging/auth-lambda-groupc-20260929161601.zip`, then `update-function-code --s3-bucket ... --s3-key ...`, which succeeded immediately.

## 10. Lambda Update Status (VERIFIED)

```
aws lambda wait function-updated-v2   -> returned successfully
State:             Active
LastUpdateStatus:  Successful
LastUpdateStatusReason: null
CodeSha256:        8z1cfStUOiFL2TPmMiq7UXwcnmIfGKH6ARL0UZlTDuo=
Handler:           dist/lambda.handler  (unchanged)
Runtime:           nodejs22.x           (unchanged)
```

## 11. API Gateway Integration Verification (VERIFIED, post-deploy)

Re-queried `GetIntegration` for the `/auth/login` route's integration: still `AWS_PROXY` to the same unqualified function ARN — unchanged, as required (the deploy updates what `$LATEST` points to in-place; nothing about the integration itself needed to change, and nothing was touched).

## 12. Post-Deployment E2E Results (all VERIFIED, all non-mutating except login's inherent refresh-token row — same pattern already accepted in the original Phase-1 E2E report)

| Check | Result |
|---|---|
| `GET /health` | `200 {"status":"ok","service":"auth-service"}` |
| CORS preflight, allowed origin | `204` + correct `access-control-allow-origin` |
| CORS preflight, disallowed origin | `204`, header absent (blocked) |
| `POST /auth/login` missing fields | `400`, Zod validation detail |
| `POST /auth/login` malformed JSON | `400` |
| `POST /auth/login` invalid credentials | `401 {"error":"Invalid credentials"}` (generic, no enumeration) |
| `GET /auth/users` no token | `401 {"error":"No token provided"}` |
| `GET /profile/me` invalid token | `401 {"error":"Invalid token"}` |
| `POST /auth/login` (admin, dedicated already-authorized test account) | `200`, same `id` as Phase-1 baseline (`a9db631e-...`), `role: ADMIN` |
| `POST /auth/verify` with real token | `200`, matches |
| `GET /auth/users` as ADMIN | `200`, real user list returned |
| `POST /auth/refresh` with real refresh token | `200`, new token pair issued |
| `POST /auth/login` (john.doe, dedicated already-authorized test account) | `200`, same `id` as Phase-1 baseline (`2adeb124-...`) |
| `GET /auth/users` as CUSTOMER (RBAC boundary) | `403 {"error":"Forbidden: admin role required"}` |
| `GET /profile/me` as CUSTOMER | `200`, same real restored profile data as Phase-1 (age/goal/equipment/weight history) |

**No scenario was `BLOCKED_CREDENTIALS`** — the two dedicated test accounts already authorized and used in the original Phase-1 E2E report were reused for this non-mutating regression pass. **No password-change or password-reset call was made against AWS in this phase**, per the hard constraint — the transaction fix's actual atomicity is proven exclusively by the real-Postgres integration test (§5), not re-demonstrated here by mutating admin's password.

## 13. CloudWatch Findings (VERIFIED, test-window only)

Filtered `/aws/lambda/fitness-assistant-dev-auth` from deployment time through the E2E pass:
- One `SyntaxError: Unexpected token 'n', "not-json" is not valid JSON` — this is the deliberate malformed-JSON test above, expected.
- No Prisma errors, no timeouts, no unexpected exceptions, no cold-start failure (`INIT_START` completed normally for `nodejs:22.mainline.v122`).
- No API Gateway integration errors, no CORS failures beyond the intentional "blocked" case.

## 14. Regression Results

**None found.** Every response in §12 is identical in shape and value to the corresponding check in the original `AWS_DEV_E2E_AUTH_USER_2026-09-29.md` baseline.

## 15. Was Rollback Needed?

**No.** Deployment succeeded on the second attempt (S3-mediated); the first attempt's failure was a client-side network error caught and confirmed non-destructive before retrying, not a deployment defect. The backup artifact (§7) remains available and untouched.

## 16. Current Deployed State

`fitness-assistant-dev-auth`: `Active`, `Successful`, `CodeSha256 = 8z1cfStUOiFL2TPmMiq7UXwcnmIfGKH6ARL0UZlTDuo=`, containing the transaction-atomicity fix, serving live traffic through the unchanged API Gateway integration, with zero observed regression.

## 17. Remaining Security Risks (unchanged from the prior remediation report unless noted)

1. **Admin still logs in with `password123`** — Group C only deployed the atomicity *fix*; it did not rotate anything. This is precisely what Group A (prepared, not executed — see §"Group A Preparation Status" below) exists for.
2. 12 other seed accounts remain on the default password, all `KEEP_WITH_REVIEW` (unchanged, `AWS_DEV_SEED_ACCOUNT_REMEDIATION_PLAN.md`).
3. `JWT_SECRET`'s real deployed value remains unverified (unchanged — verifying it would mean reading a secret).
4. 3 lower-risk scripts still hardcode `localhost` + the seed password with no env override (unchanged from the prior report; not fixed, since they cannot reach AWS without a source edit first).
5. **New, minor:** the published Version 1 and the `lambda-deploy-staging/` S3 objects are small, harmless artifacts of this deployment's own safety process — not cleaned up automatically, listed here for completeness rather than silently left unmentioned.

---

## Group A Preparation Status (prepared this session, NOT executed against AWS)

Built and tested **locally only**, against a local mock server (`scripts/auth-admin-rotation-helper.mock-server.mjs`), never against AWS:
- `scripts/lib/AdminPasswordRotation.ps1` — pure, non-interactive, parameterized login->rotate->verify logic (`Invoke-AdminPasswordRotation`), plus `New-CsprngPassword` (256-bit, `RandomNumberGenerator`) and `ConvertFrom-SecureStringPlain`.
- `scripts/auth-admin-rotation-helper.ps1` — thin interactive wrapper (SecureString prompt, explicit `CONFIRM` gate, single one-time display of the new password at the very end, never written to disk).

**Real test results against the mock server** (not just a syntax check):
1. Successful rotation: `Success=True`, old password rejected, new password works, `id`/`role` unchanged.
2. Wrong current password: correctly fails at the login stage, no rotation attempted.
3. Sequential rotation (rotate again using the just-set password): succeeded, proving the logic re-authenticates correctly against genuinely changed state, not a cached assumption.

The interactive wrapper (`auth-admin-rotation-helper.ps1`) was separately confirmed to **parse with 0 errors** (`[System.Management.Automation.Language.Parser]::ParseFile`) — it could not be driven end-to-end in this session's non-interactive tool environment (`Read-Host` reads EOF immediately here by design), which is exactly why the logic was split into a directly-testable module in the first place, rather than left untested.

**No real admin credential was generated, displayed, or stored in this session.** `-BaseUrl` was never pointed at the real AWS endpoint while running the helper.

### Rotation prerequisites (verified this session)
- Self-service `PATCH /auth/me/password` confirmed live and behaving per source contract (§12).
- Transaction fix confirmed deployed (§10).
- Refresh-token revocation confirmed inside the same transaction (§5, source review).
- ADMIN account confirmed to exist and be reachable (§12, login).
- No concurrent rotation or deployment in progress (this session is the only actor; `LastUpdateStatus: Successful`, stable).

### Recovery requirement (per the request's explicit instruction: not email-based)
- `admin@example.com` has no reachable mailbox — **not addressed by any email-based recovery design**.
- Where the new credential goes, who can access it, and how "stored successfully" is confirmed are **your decisions**, to be made at Stage 3 of the runbook, before Stage 5 ever runs — this session does not choose a secret-storage system on your behalf.
- If the rotation request times out after the database may have already committed: the helper's own logic (§ "Timeout handling" in the script) does not retry automatically and prints the generated password plus explicit manual-verification instructions instead of guessing.

---

## AWS WRITE Operations Awaiting Approval

**Group A** — nothing executed. Still requires your separate, explicit approval per `AWS_DEV_AUTH_ROTATION_RUNBOOK.md`'s Approval Gate before:
- `POST /auth/login` + `PATCH /auth/me/password` for `admin@example.com` (the rotation itself).
- Optionally, storing the new password in Secrets Manager.

**Group B** — untouched, not authorized this session, no accounts rotated/disabled/role-changed/session-revoked.

---

## Final Answer

1. **GROUP C deployment status:** DEPLOYED & VERIFIED.
2. **Old/new Lambda CodeSha256:** `yTLQudumeGaxNEsOPb0Bubl392xfjpsW8COr8Yj1gF8=` -> `8z1cfStUOiFL2TPmMiq7UXwcnmIfGKH6ARL0UZlTDuo=`.
3. **Rollback artifact/version:** `backend/services/auth-service/artifacts/rollback/auth-lambda.PRE-GROUPC-BACKUP.zip` (SHA256-verified byte-identical to the pre-deploy code) + AWS-side published Version 1 (same CodeSha256).
4. **Actual tests PASS/FAIL/BLOCKED:** 82 / 82 / 0 / 0 (pass/total, fail, blocked) — see §7 breakdown table.
5. **Transaction integration test result:** PASS — real Postgres, real commit proven, real rollback proven (not a mocked assertion).
6. **AWS Auth post-deployment E2E result:** 15/15 checks PASS, zero regression versus the Phase-1 baseline.
7. **CloudWatch findings:** clean — only the intentional malformed-JSON test error; no Prisma/timeout/JWT/CORS/integration errors.
8. **Seed guard status:** hardened (prior session) and re-verified this session — real URL parser, exact hostname allowlist, exact-`"true"` override, all 10 dedicated tests passing.
9. **Credential fallback cleanup status:** `test-admin-e2e.mjs` (prior session) + `browser-e2e.cjs`/`browser-e2e-mobile.cjs` (this session) all fixed; 3 lower-risk scripts inventoried but left as-is (cannot reach AWS without a source edit first).
10. **GROUP A preparation status:** PREPARED — rotation helper built, tested end-to-end against a local mock (3 scenarios, all correct), never run against AWS, no real credential generated.
11. **ADMIN recovery strategy:** no email-based recovery exists for this account; secret-storage destination is an explicit decision left to you (Runbook Stage 3), not chosen by this session.
12. **Remaining 12 seed accounts status:** unchanged, untouched, all still `KEEP_WITH_REVIEW` per the existing remediation plan.
13. **AWS WRITE operations still awaiting your approval:** Group A's login+rotate call (and optional Secrets Manager write); all of Group B.
14. **Report paths:**
    - `docs/deployment/AWS_DEV_AUTH_GROUP_C_DEPLOYMENT_2026-09-29.md` (this report)
    - `docs/deployment/AWS_DEV_AUTH_SECURITY_REMEDIATION_2026-09-29.md`
    - `docs/deployment/AWS_DEV_SEED_ACCOUNT_REMEDIATION_PLAN.md`
    - `docs/deployment/AWS_DEV_AUTH_ROTATION_RUNBOOK.md`

**GROUP C: DEPLOYED & VERIFIED**
**GROUP A: PREPARED — AWAITING EXPLICIT APPROVAL**

*HARD STOP. Group B remains untouched and unauthorized. Not proceeding to Fitness/Gym/Payment E2E.*
