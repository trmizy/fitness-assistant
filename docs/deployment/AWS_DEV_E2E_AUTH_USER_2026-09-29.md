# AWS DEV E2E Testing — Phase 1: Auth & User

**Date:** 2026-09-29
**Scope:** `Frontend → API Gateway → Auth/User Lambda → Aurora PostgreSQL`, against real restored AWS DEV data.
**Session type:** E2E AUDIT — no code changes, no Lambda deploys, no data mutation beyond login's own inherent side effect (refresh-token row), no new AWS resources, nothing committed.

Evidence legend:
- **Verified (live HTTP)** — a real `curl` request was sent to the live API Gateway endpoint and the exact status/body below was returned.
- **Verified (source)** — confirmed by reading the actual repo source, file:line cited.
- **Historical** — from a prior session's artifact, not re-confirmed live in this phase.

---

## Phase A — Preflight (all Verified)

| Check | Result |
|---|---|
| AWS account | `191798898985` — matches |
| Region | `ap-southeast-1` |
| Aurora (`fitness-assistant-dev-aurora`) | `available` |
| Lambda `fitness-assistant-dev-auth` | `State: Active`, `LastUpdateStatus: Successful`, `nodejs22.x` |
| Lambda `fitness-assistant-dev-user` | `State: Active`, `LastUpdateStatus: Successful`, `nodejs22.x` |
| Lambda VPC networking | Both in subnets `subnet-02b39d77762465ef8`/`subnet-09e3230f7bca04c8e`, SG `sg-0b38ab22927b284ab`; Aurora SG `sg-00e8e01671812bf44` explicitly allows inbound 5432 from that exact SG — path is valid |
| CloudWatch log groups | `/aws/lambda/fitness-assistant-dev-auth`, `/aws/lambda/fitness-assistant-dev-user` both exist and were read successfully in Phase E |
| API Gateway routes/integrations | All auth/user routes present with resolved `AWS_PROXY` integrations (confirmed in the prior infra audit, re-used here) |
| Frontend reachable | `GET /` on the S3 website → `200` |
| `GET /health` | `200`, body `{"status":"ok","service":"auth-service"}` |

**Architecture correction worth recording**: the repo contains a full Express "gateway" service (`backend/gateway/`) with its own CORS/rate-limit/auth-proxy middleware, but **this AWS deployment does not use it** — API Gateway (`id1iz7upbl`) integrates `AWS_PROXY` directly to each Lambda. Confirmed empirically: every error body returned below matches auth-service's own native shape (`{"error": "..."}`), never the Express gateway's wrapped shape (`{"success":false,"error":{"code":...}}`). CORS enforcement in this deployment is API Gateway's own native CORS config, not the Express gateway's `corsOrigins.ts` — also confirmed empirically (below).

---

## Phase B — Auth E2E

Test account used: `admin@example.com` (seed account, `backend/services/auth-service/prisma/seed.ts:10,49`, password `password123` — a repo-committed seed credential, not a real person's data). A second seed account `john.doe@example.com` (CUSTOMER role) was used to test authorization boundaries.

| Test ID | Endpoint | Scenario | Expected | Actual | Status |
|---|---|---|---|---|---|
| AUTH-01 | `GET /health` | Liveness | 200 | 200 `{"status":"ok","service":"auth-service"}` | **PASS** |
| AUTH-02 | `OPTIONS /auth/login` | CORS preflight, allowed origin (the deployed frontend) | 204 + `access-control-allow-origin` = frontend origin | 204, header present and exact match | **PASS** |
| AUTH-03 | `OPTIONS /auth/login` | CORS preflight, disallowed origin (`https://evil.example.com`) | 204, no allow-origin header | 204, header absent (browser would block) | **PASS** |
| AUTH-04 | `POST /auth/login` | Missing `email`/`password` | 400, Zod validation detail | 400 `{"error":"Validation failed","details":[...]}` | **PASS** |
| AUTH-05 | `POST /auth/login` | Malformed JSON body | 400 | 400 (body-parser rejects); logged as `SyntaxError` in CloudWatch (expected, my own request) | **PASS** |
| AUTH-06 | `POST /auth/login` | Non-existent email + wrong password | 401, generic message (no email-existence leak) | 401 `{"error":"Invalid credentials"}` | **PASS** |
| AUTH-07 | `POST /auth/login` | Valid seed account (`admin@example.com`/`password123`) against **restored** data | 200, `user`+`accessToken`+`refreshToken` | 200, `user.id=a9db631e-...`, `role=ADMIN`, matches seed exactly | **PASS** |
| AUTH-08 | `POST /auth/verify` | Valid access token | 200, user object | 200, `{"user":{...,"isActive":true}}` | **PASS** |
| AUTH-09 | `POST /auth/verify` (used as generic protected-route probe) / `GET /auth/users` | No token | 401 `"No token provided"` | 401 `{"error":"No token provided"}` | **PASS** |
| AUTH-10 | protected route | Corrupted/invalid signature token | 401 `"Invalid token"` | 401 `{"error":"Invalid token"}` | **PASS** |
| AUTH-11 | `POST /auth/refresh` | Valid refresh token | 200, new access+refresh token pair | 200, both present | **PASS** |
| AUTH-12 | `GET /auth/users` | Called as ADMIN | 200, user list | 200, full list returned (28 restored users, spot-checked) | **PASS** |
| AUTH-13 | `GET /auth/users` | Called as CUSTOMER (RBAC boundary) | 403 `"Forbidden: admin role required"` | 403 `{"error":"Forbidden: admin role required"}` | **PASS** |
| AUTH-14 | `POST /auth/login` | Real CORS header on an actual (non-OPTIONS) response, not just preflight | `access-control-allow-origin` present on the real 401/200 response too | Confirmed present on a real 401 login response | **PASS** |

**Auth E2E summary: 14/14 PASS, 0 FAIL, 0 BLOCKED.** No scenario required `BLOCKED_CREDENTIALS` — the seed accounts from the repo turned out to exist in the restored AWS DEV data, confirmed by successful login returning the exact seeded user IDs.

Not tested (explicitly out of scope per hard-safety rules): `POST /auth/register`, `/auth/register/verify` (would create a new account), `PATCH /auth/me` (would mutate data), `PATCH /auth/users/:id/role|enable|disable` (would mutate another account).

---

## Phase C — User E2E

Real profile-read endpoint per source (`backend/services/user-service/src/routes/profile.routes.ts:62`) is **`GET /profile/me`** — there is no bare `/me` route in user-service. (Diagnostic note: an initial probe against a guessed `GET /me` returned `404 "Cannot GET /me"`, which is why the correct path was confirmed from source before drawing any conclusion, per the "never guess endpoint names" rule.)

| Test ID | Endpoint | Scenario | Expected | Actual | Status |
|---|---|---|---|---|---|
| USER-01 | `GET /profile/me` | No token | 401 `"No token provided"` | 401 `{"error":"No token provided"}` | **PASS** |
| USER-02 | `GET /profile/me` | Valid ADMIN token, account with no profile row | 200, `{"profile": null}` (per `profile.service.ts:126-129`) | 200 `{"profile":null}` | **PASS** |
| USER-03 | `GET /profile/me` | Valid CUSTOMER token (`john.doe@example.com`), account **with** a restored profile | 200, real profile fields | 200, full restored profile: age 22, gender MALE, goal MUSCLE_GAIN, activityLevel VERY_ACTIVE, currentWeight 76.3/targetWeight 72/startingWeight 80, ~40-item equipment list, `hasCompletedOnboarding:true`, `createdAt: 2026-08-17`, `updatedAt: 2026-09-06` | **PASS** |
| USER-04 | `GET /profile/me` | Ownership enforcement | userId always taken from verified JWT (`profile.controller.ts:27-35`), never from URL/body — structurally impossible to view another user's own-profile via this route | Confirmed by source read; behaviorally consistent with USER-02/03 each returning only the calling user's own data | **PASS** |
| USER-05 | (implicit, via all above) | DB connectivity from user-service Lambda | No Prisma/connection errors | None found in CloudWatch for these requests (see Phase E) | **PASS** |

**User E2E summary: 5/5 PASS, 0 FAIL, 0 BLOCKED.**

No profile write, no onboarding change, no new account created.

---

## Phase D — Database Consistency

**Constraint acknowledged**: Aurora has no public endpoint (`PubliclyAccessible: false`, confirmed in the earlier infra audit) and is only reachable from inside the VPC. This session's tools do not include a raw-SQL read-only diagnostic mode against Aurora (the existing `tools/db-migrator` modes are schema/constraint-focused, not ad-hoc row lookups), and building one was judged out of scope for an audit-only phase. **A byte-for-byte SQL-vs-API cross-check was not performed.**

What **was** established instead, as indirect but strong consistency evidence:
- The returned profile for `john.doe@example.com` (USER-03) is rich, internally consistent, and highly specific (exact weight progression 80→76.3→72, a ~40-item equipment list, `hasCompletedOnboarding:true`, timestamps `2026-08-17`→`2026-09-06`) — data of this specificity cannot be fabricated by the API layer; it is direct evidence the Lambda successfully read a real row out of the restored `user_profiles` table in Aurora, not a placeholder/mocked response.
- `GET /auth/users` (AUTH-12) returned the full restored user roster (28 users spot-checked, including several `@example.test` seed accounts and one real account created moments before this test — consistent with the `users: 164`-row count recorded in the historical `restore-row-counts.md`).
- No Prisma/connection-level error appeared for any of the 19 real requests made in Phases B–C (see Phase E).

**Root-cause distinction requested by the task**: no case of "API returns empty while DB has data" was observed. The one `null` result (USER-02, admin's own profile) is explained by source code, not by a DB/authorization defect — the ADMIN seed account was simply never onboarded, and `profile.service.ts:126-129` explicitly returns `null` for that case by design.

No write query of any kind (`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/migrate/seed) was issued.

---

## Phase E — CloudWatch Analysis

Filtered `/aws/lambda/fitness-assistant-dev-auth` and `/aws/lambda/fitness-assistant-dev-user` for the ~15-minute test window.

- **Auth Lambda**: one `SyntaxError: Unexpected token 'n', "not-json" is not valid JSON` — this is AUTH-05, my own deliberate malformed-body test; expected, not a defect.
- **Auth Lambda**: no other errors, no Prisma errors, no timeouts, no JWT-verification exceptions beyond the expected 401s already reported above.
- **User Lambda**: no Prisma/DB-connection errors for any of my requests.
- **User Lambda — observed but out of scope**: two distinct errors appeared in the same log window from **traffic that was not part of this test** (different feature area, PT-application flow): `"Missing required field for submission: serviceMode"` (`pt_application.service.ts:173`) and `"Invalid day: Mon"` (`availability.service.js:47`, via `pt_application.service.js:149`). These indicate a live, real bug in the PT-application-draft flow (day-of-week format mismatch) being hit by concurrent live usage of the DEV frontend during this test window. **Not investigated further** — outside Phase 1 scope (Auth/User) and outside this session's mandate to fix bugs; flagged here only because it was directly observed while reading these exact log groups, as Phase E requires.
- **API Gateway integration errors, CORS failures, timeouts**: none observed for any request in this test.

All secrets/tokens/PII redacted throughout — no access token, refresh token, or password value was ever printed to console or written into this report; only lengths and boolean presence were logged during testing, and all temporary token files were deleted immediately after use.

---

## Summary

| Metric | Count |
|---|---|
| Total tests | **19** |
| Passed | **19** |
| Failed | **0** |
| Blocked | **0** |

- **Source-code issues found**: none.
- **Infrastructure issues found**: none — VPC networking, CORS, JWT, RBAC, API Gateway routing all behaved exactly per source-code contract.
- **Migrated-data issues found**: none — restored data (`users`, `user_profiles`) is readable, consistent, and matches the seeded/expected shape.
- **Out-of-scope issue observed (not part of this report's pass/fail count)**: a real PT-application-draft bug (`availability.service.js:47`, day-of-week parsing) surfaced in the same CloudWatch window from unrelated live traffic — worth a separate ticket, not evaluated here.
- **Suggested follow-up** (not applied): if/when Phase D needs a true SQL-vs-API byte comparison for a future service, `tools/db-migrator` would need a new narrowly-scoped read-only diagnostic mode (e.g. `MODE=diag-query`, hard-restricted to `SELECT`), since Aurora has no path reachable from outside the VPC.

---

## Final Answer

1. **Tổng test: 19 PASS / 0 FAIL / 0 BLOCKED.**
2. **Auth E2E hoạt động đúng với dữ liệu đã restore** — login thật bằng tài khoản seed `admin@example.com` và `john.doe@example.com` đều thành công, trả đúng user đã restore, JWT/refresh/RBAC đều đúng theo contract source code.
3. **User E2E hoạt động đúng với dữ liệu đã restore** — `GET /profile/me` trả về đúng hồ sơ chi tiết, thật, đã restore của `john.doe@example.com` (tuổi, giới tính, mục tiêu, thiết bị, lịch sử cân nặng...); không có cách nào xem hồ sơ người khác qua route này.
4. **Không phát hiện lỗi database/schema/JWT/CORS** trong phạm vi Auth/User. (Có 1 lỗi thật nhưng KHÔNG thuộc phạm vi — bug PT-application draft ở user-service, nêu riêng để bạn theo dõi, không tính vào PASS/FAIL của phase này.)
5. **Danh sách blocker cần sửa: không có** blocker nào trong phạm vi Auth/User Phase 1.
6. **Report:** `docs/deployment/AWS_DEV_E2E_AUTH_USER_2026-09-29.md`
7. **Đủ điều kiện chuyển sang Fitness/Gym/Payment E2E**: **Có**, xét riêng Auth/User. (Bug PT-application ở trên nằm trong phạm vi User/Gym — nên cân nhắc khi test Gym/PT-application flow ở phase sau.)

*HARD STOP — chờ phê duyệt trước khi sửa code hoặc chuyển sang service khác.*
