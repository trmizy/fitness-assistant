# AWS DEV Auth Security Hardening & Seed Credential Rotation

**Date:** 2026-09-29
**Session type:** Security audit + local code preparation. No AWS write performed, no Lambda deployed, nothing committed/pushed, no secret value printed anywhere in this document or in any command output.

Evidence legend: **VERIFIED** (confirmed live against AWS or by reading exact repo source, file:line cited) · **HISTORICAL** (from a prior session's report, not re-confirmed live here) · **UNKNOWN** (could not be determined with the access available in this session).

---

## 1. Root Cause

**VERIFIED.** `backend/services/auth-service/prisma/seed.ts` creates 13 demo accounts sharing one bcrypt-hashed plaintext password (`"password123"`, cost 10, `seed.ts:10`), including exactly one `ADMIN` account, `admin@example.com` (`seed.ts:48-58`). Every account uses `prisma.user.upsert({ where: { email }, update: {}, create: {...} })` — idempotent by design, `update: {}` never overwrites an existing row.

This is **not** an ongoing automated leak. Confirmed by reading every plausible trigger:
- `backend/services/auth-service/src/migrate-lambda.ts` (the code actually behind the deployed `fitness-assistant-dev-auth-migrate` Lambda) only runs `prisma migrate deploy` as a child process — it never calls `seed.ts` or equivalent logic.
- `.github/workflows/*` contain zero references to `seed`/`db:seed`/`prisma db seed`.
- `docs/aws-deployment/REFERENCE_DATA_BOOTSTRAP_AUDIT_2026-09-15.md` independently documents "AUTH BOOTSTRAP REQUIRED = NO" / "Do not run Auth seed [against AWS]" (HISTORICAL, a doc, not code — but consistent with the code finding).

**Root cause, stated precisely:** `seed.ts` was, at some point in the past, run manually against what later became the database that was dumped and restored to AWS Aurora DEV. Nothing in the codebase ever prevented `seed.ts` from being pointed at a real/shared `DATABASE_URL` — the only thing missing was a guard. Once restored, the account survived indefinitely because the seed's own idempotency (`update: {}`) never resets it, and API Gateway (`id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com`) is public, making the exposure directly exploitable by anyone who reads this public repo's seed file.

---

## 2. Files Involved

| File | Role |
|---|---|
| `backend/services/auth-service/prisma/seed.ts` | Creates the 13 seeded accounts + shared password (VERIFIED) |
| `scripts/test-admin-e2e.mjs:3-4` | Independent hardcoded fallback of the same `admin@example.com`/`password123` pair, for a test script — not a seed mechanism, but a second place the same credential is written down (VERIFIED) |
| `backend/services/auth-service/src/services/auth.service.ts` | Login, JWT issue/verify, refresh, change-password, reset-password, `mustChangePassword` logic (VERIFIED, read in full for this audit) |
| `backend/services/auth-service/src/repositories/auth.repository.ts` | `RefreshToken`/`PasswordResetToken` persistence, `deleteRefreshTokensByUserId` (VERIFIED) |
| `backend/services/auth-service/prisma/schema.prisma` + migrations | Real column names for `refresh_tokens` and `password_reset_tokens` (VERIFIED against migration SQL) |
| `infra/terraform/environments/dev/main.tf` | Confirmed: **no Lambda module for auth-service exists in this repo's Terraform** — the deployed `fitness-assistant-dev-auth` Lambda's actual environment configuration (JWT_SECRET value, etc.) is managed outside what this repo's Terraform shows (VERIFIED absence; UNKNOWN how/where it's actually managed) |

**Files changed in this session** (local only, nothing pushed):
- `backend/services/auth-service/src/scripts/seedGuard.ts` — **new**
- `backend/services/auth-service/prisma/seed.ts` — **modified** (2 lines: import + one guard call)
- `backend/services/auth-service/src/__tests__/credential-rotation-hardening.test.ts` — **new** (12 tests)

No other application file was touched. `scripts/test-admin-e2e.mjs` was **not** modified (flagged as a cleanup recommendation, not fixed, to keep this change minimal and directly scoped to the vulnerability).

---

## 3. Credential Exposure Assessment

**VERIFIED (this session's own Phase-1 E2E tests, `docs/deployment/AWS_DEV_E2E_AUTH_USER_2026-09-29.md`):** both `admin@example.com` (ADMIN) and `john.doe@example.com` (CUSTOMER) logged in successfully on public AWS DEV using `password123`. Since every one of the 13 seed accounts was created with the exact same hash and none has ever been individually changed (no evidence of any `changePassword`/`resetPasswordWithToken` call against them — those calls would produce a different hash), **all 13 seed accounts should be assumed equally exploitable**, not just the admin one. This report's approved scope is the ADMIN account only; see §11 for the remaining exposure on the other 12.

**VERIFIED (live AWS, this session):** `GET /auth/users` as the real admin returned exactly one role breakdown — `{"CUSTOMER":154,"PT":9,"GYM_OWNER":1}`, zero `ADMIN` entries (the endpoint excludes the caller's own record from its own listing) — no evidence of a second, different ADMIN account existing beyond `admin@example.com` itself.

**VERIFIED (live AWS, this session):** CloudWatch `/aws/lambda/fitness-assistant-dev-auth` for the preceding 6 hours shows `/auth/login` traffic from only 2 distinct source IPs, 6×200 / 4×401 / 1×400 — consistent with this session's own testing, no brute-force pattern.

---

## 4. Seed Initialization Behavior

**VERIFIED.** `upsert(... update: {} ...)` is a true no-op on an existing row — confirmed by direct source read and pinned down by a new regression test (`credential-rotation-hardening.test.ts`: *"seed.ts admin upsert still uses update: {}"*). Re-running the seed today, or as part of any future migration, **cannot** reset a password that has since been rotated. The risk was always "someone runs `prisma db seed` by hand with `DATABASE_URL` pointed at a real database," never "an automated process silently restores the default."

**Fix applied:** `seed.ts` now calls `assertSeedAllowed(process.env.DATABASE_URL, process.env.ALLOW_DEMO_SEED)` as the very first line of `main()`, before any user is created. `seedGuard.ts` refuses to proceed unless the URL looks local (`localhost`, `127.0.0.1`, `host.docker.internal`, `postgres-test`, or a `*_test` database name) or `ALLOW_DEMO_SEED=true` is explicitly set. This is dependency-free (no Prisma import) specifically so it's unit-testable without a database connection.

---

## 5. JWT & Refresh-Token Revocation Behavior

**VERIFIED**, all from `auth.service.ts`:

| | Access token | Refresh token |
|---|---|---|
| TTL | `JWT_ACCESS_EXPIRY`, default **15 minutes** (`auth.service.ts:41-42`) | **7 days**, hardcoded in `makeRefreshExpiry()` (`auth.service.ts:65-69`) — note: independent of the `JWT_REFRESH_EXPIRY` env var, which only affects the JWT's own signature claim, not the DB-enforced expiry |
| Storage | None — stateless JWT | Postgres table `refresh_tokens` (no `@map`, camelCase columns: `"id"`, `"token"`, `"userId"`, `"expiresAt"`, `"createdAt"` — confirmed against the original migration SQL) |
| Single-token revoke | **Not possible** — no blacklist exists (`verifyToken`, `auth.service.ts:521-535`, is pure `jwt.verify` + user lookup) | `logout()` **deletes the row outright** (`auth.repository.ts:147-148`) |
| Revoke-all-for-user | N/A | `deleteRefreshTokensByUserId()` (`auth.repository.ts:150-151`) — called automatically by both `changePassword` (`auth.service.ts:579`) and `resetPasswordWithToken` (`auth.service.ts:661`). A dedicated `revokeAllSessions()` also exists (`auth.service.ts:667-670`) but is only reachable via an internal, `x-service-secret`-gated route used by gym-service — there is no admin-facing "sign out everywhere" button wired to it. |

**Practical consequence for rotation:** using the existing self-service change-password endpoint (see §8) automatically revokes every outstanding refresh token for that account as a side effect — no extra step needed. Access tokens already issued cannot be revoked early; the exposure window after rotation is bounded by the 15-minute TTL.

---

## 6. Password Change / Reset — What Already Exists

**VERIFIED, already implemented, no code change needed for these:**
- **Self-service change (needs old password):** `PATCH /auth/me/password` → `authController.changePassword` → `authService.changePassword` (`auth.service.ts:555-590`). Verifies the old password, rejects new==old, hashes with bcrypt/10, updates only the password column, revokes all refresh tokens.
- **Forgot-password (email/OTP link):** `POST /auth/password-reset/request` → `authService.requestPasswordReset` (`auth.service.ts:326-388`) issues a 1-hour single-use token into `password_reset_tokens` (columns: `id, user_id, token_hash, expires_at, used_at, requested_by, created_at`); `POST /auth/password-reset` consumes it (`authService.resetPasswordWithToken`, `auth.service.ts:642-664`), same revoke-all-refresh-tokens side effect. **Answers identically for unknown/disabled/cooling-down accounts** — no email-enumeration leak (already covered by an existing test, `self-service-recovery.test.ts`).
- **`mustChangePassword` flag:** fully wired end-to-end — `login()` already returns it (`auth.service.ts:419`); frontend web (`AppShell.tsx:74`, `ForceChangePasswordScreen.tsx`) and mobile (`RequirePasswordChange.tsx`) both already block the app and force a change when it's `true`; every successful password update clears it back to `false`. The **only** gap is that nothing in the code can set it to `true` on an **already-existing** account (it's only ever set at invited-account creation time, and always to `false` there too). This gap is **not** a blocker for the admin rotation below, because the rotation sets a final strong password directly — it does not hand out a temporary one that would need a forced follow-up change.

---

## 7. Test Results

Run locally, `backend/services/auth-service`. No network call, no real database, no Aurora access — every `authRepository`/`authService` dependency is monkey-patched per test (matching this suite's existing style in `self-service-recovery.test.ts`).

```
npm test        → 71 pass, 0 fail   (12 new + 59 pre-existing, all green)
npx tsc --noEmit → clean
npm run build    → clean
npm run lint     → no "lint" script configured for this workspace (pre-existing; not something this task should add)
```

The 12 new tests (`credential-rotation-hardening.test.ts`), each tied to one of the task's required guarantees:

| Test | Proves |
|---|---|
| `assertSeedAllowed()` × 4 tests | Refuses a real-looking (e.g. `*.rds.amazonaws.com`) URL; allows local/docker/test URLs; honors an explicit override; treats a missing URL as unsafe |
| `seed.ts admin upsert still uses update: {}` | Seed cannot silently reset an existing password/role — regression guard on the exact vulnerability |
| `seed.ts calls assertSeedAllowed() before creating any user` | The guard actually runs first, not after users are already created |
| `changePassword()` rotates hash, **same id/email/role** | Rotation cannot change identity — direct requirement from the task |
| `changePassword()` revokes every refresh token for that user id | Automatic session invalidation after rotation |
| `changePassword()` rejects wrong current password, no writes | Fails closed |
| `refresh()` with a since-deleted token → 401 | A revoked refresh token is provably dead |
| `login()` — identical error for unknown email vs. wrong password | No account-existence leak |
| Deployment config scan (`infra/terraform`, `.github/workflows`) contains no `"password123"` | No hardcoded seed credential in deployment configuration (caught and fixed a real bug in this very test during development — see note below) |

**Note on test development:** the deployment-config scan test initially crashed (`ERR_STRING_TOO_LONG`) because it walked into `infra/terraform/environments/dev/.terraform/providers/...` and tried to read a multi-hundred-MB Terraform provider binary as UTF-8 text. Fixed by excluding `.terraform/`/`node_modules` and skipping files over 2MB — a real bug caught by actually running the test, not assumed away.

---

## 8. Credential Rotation Plan (designed, **not executed** — awaiting approval)

**Chosen mechanism: reuse the existing, already-audited self-service change-password endpoint.** No new endpoint, no code deploy required for the rotation itself.

1. **Generate the new password locally, CSPRNG, never typed into chat/logs/this report:**
   ```
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
   Capture its output directly into a secret store (e.g. `aws secretsmanager put-secret-value` piped straight from the generator, or a password manager) — never into a shell history file, an env var that gets logged, or a report.

2. **Two HTTP calls against the live API** (the same pattern already proven safe in Phase-1 E2E testing):
   ```
   POST /auth/login        { "email": "admin@example.com", "password": "password123" }
   PATCH /auth/me/password { "currentPassword": "password123", "newPassword": "<the CSPRNG value>" }
                            Authorization: Bearer <accessToken from step 1>
   ```
   Step 2 is the exact code path covered by §7's tests: same user id/email/role afterward, new bcrypt hash, and — as a built-in side effect of `changePassword()` — **every** outstanding refresh token for this user is deleted from `refresh_tokens` in the same operation. No separate revoke-all step is needed.

3. **Access-token exposure window:** any access token minted before step 2 remains a valid, unrevocable stateless JWT for up to its remaining TTL — **at most 15 minutes** from when it was issued. Mitigation: perform steps 1–2 back-to-back in one sitting (minutes apart, not hours), and watch CloudWatch `/aws/lambda/fitness-assistant-dev-auth` for any `admin`-authenticated write in the 15 minutes following rotation.

4. **Explicitly not done:** rotating `JWT_SECRET` (would invalidate every session for every user/role across every service that trusts it — out of scope and forbidden by this task).

5. **Recovery risk to flag before executing:** `admin@example.com` is not a real, monitored mailbox. If the new password is ever lost, the app's own self-service "forgot password" flow (`POST /auth/password-reset/request`) would email a reset link to that unreachable address — there is **no practical in-app recovery path** for this specific account today. Operational mitigation: confirm a successful login with the new password immediately after step 2, before considering the rotation complete.

---

## 9. Deployment Steps (for approval, none executed)

No Lambda redeploy is required — the rotation only calls existing, already-deployed endpoints. Steps, in order, each requiring your explicit go-ahead:

1. Generate the new password (local machine, CSPRNG) and place it in a secret store immediately — **AWS WRITE if using Secrets Manager**.
2. `POST /auth/login` with the current default credential — **read-only in effect (issues a token + one refresh-token row), but it is a real request against live AWS DEV**.
3. `PATCH /auth/me/password` with old+new password — **AWS WRITE: this changes the admin account's password hash and deletes its refresh-token rows.**
4. Verify: log in again with the **new** password only, confirm `role: "ADMIN"` and the same `id` as before, confirm the old password (`password123`) now returns `401 Invalid credentials`.
5. (Optional, recommended, separate approval) Apply the `seed.ts` guard + rename `scripts/test-admin-e2e.mjs`'s hardcoded fallback, in a normal code-review/merge process — no AWS action attached to this step at all, purely a repo change.

---

## 10. Rollback / Recovery Strategy

- **If step 3 fails partway** (e.g. network error after the DB write but before the confirmation response): the account's password has already changed and its old refresh tokens are gone. Recovery is simply step 4 (log in with the new password) — there is no partial/inconsistent state possible because `changePassword()` is a single Prisma call, not a multi-step transaction that could be left half-applied.
- **If the new password is lost before it's ever confirmed working:** there is no email-based recovery for this specific account (§8.5). The only path back would be a direct, explicit, human-approved database update of the `users.password` column for this one row (bcrypt hash of a freshly chosen password) — this is exactly the kind of one-off write this session's hard-safety rules require explicit approval for, and is **not** pre-approved by this report.
- **Nothing about this plan touches user ID, role, other users' data, or any migrated table** — the blast radius of a mistake is contained to one row in one table (`users.password`) and its associated `refresh_tokens` rows.

---

## 11. Risks Remaining (not fixed by this report's scope)

1. **The other 12 seed accounts** (`john.doe@example.com`, `jane.smith@example.com`, `pt@example.com`, and 9 `@example.test` accounts) still share `password123` and are equally reachable on public AWS DEV — this report's approved scope was the ADMIN account only. Recommend a follow-up rotation pass covering all 13, or disabling the ones that aren't needed for ongoing testing (`isActive: false` via `PATCH /auth/users/:id/disable`, itself audited and working in Phase 1).
2. **`JWT_SECRET` on the real deployed AWS Lambda was not, and could not safely be, verified in this session** (reading its value would mean printing a secret). The code shows no fail-fast check preventing it from silently running with the dev placeholder value (`auth.service.ts:37-38`), unlike `INTERNAL_SERVICE_SECRET` which does have one (`auth.controller.ts:27-34`). **UNKNOWN** whether AWS DEV's actual value is safe — recommend a human operator confirm this directly in the Lambda console, outside of any session that would echo it into logs.
3. **No Terraform module manages the auth Lambda in this repo** (`infra/terraform/environments/dev/main.tf` has no such module) — its real configuration is managed by some process outside what this repo's IaC shows. **UNKNOWN** what that process is; worth documenting so future credential/config changes go through a known path instead of ad hoc Console edits.
4. **`scripts/test-admin-e2e.mjs`** still hardcodes the same default fallback — low risk (it's a local test-runner script, not deployed), but should be cleaned up in the same pass that rotates the other 12 accounts, to avoid it silently "working" again against a rotated account and masking a real failure.
5. **API Gateway is, and is intended to be, public** (it fronts the real frontend) — this is not itself a defect, but pairs badly with any default-credential account. Defense-in-depth options (WAF, per-IP login throttling beyond the existing 5-attempts/15-min-per-email limiter) are a separate, larger follow-up, not evaluated here.

---

## Final Answer

- **Root cause thực tế:** `seed.ts` tạo 13 tài khoản demo dùng chung 1 mật khẩu (`password123`), trong đó có 1 tài khoản `admin@example.com` (ADMIN) — được ai đó chạy thủ công lên DB từ trước, dữ liệu đó sau này được restore lên Aurora AWS DEV. Không có cơ chế tự động nào (CI/CD, Lambda migrate) từng chạy seed này trên AWS — lỗ hổng nằm ở việc seed không có rào chắn ngăn nó chạy nhầm vào DB thật, không phải do bị "reset" định kỳ.
- **Tài khoản bị ảnh hưởng:** không chỉ `admin@example.com` — cả `john.doe@example.com` và (nhiều khả năng) 11 tài khoản `@example.test`/`@example.com` khác đều dùng chung `password123` (đã xác nhận thật với 2/13 tài khoản qua Phase 1 E2E).
- **File đã sửa:** `backend/services/auth-service/prisma/seed.ts` (thêm guard), `backend/services/auth-service/src/scripts/seedGuard.ts` (mới), `backend/services/auth-service/src/__tests__/credential-rotation-hardening.test.ts` (mới, 12 test). Không sửa gì ở `auth.service.ts`/controllers vì cơ chế đổi mật khẩu đã an toàn sẵn.
- **Test PASS/FAIL:** 71/71 PASS (12 mới + 59 cũ), typecheck sạch, build sạch. Không có script lint cho service này (từ trước, không thuộc phạm vi sửa).
- **Password rotation mechanism được chọn:** tái sử dụng `PATCH /auth/me/password` (đổi mật khẩu tự phục vụ, cần mật khẩu cũ) — không tạo endpoint mới, không cần deploy lại Lambda.
- **Refresh-token revocation strategy:** tự động — `changePassword()` đã sẵn có logic xóa toàn bộ `refresh_tokens` của user ngay trong cùng thao tác, không cần bước riêng.
- **Có cần redeploy Auth Lambda không?** Không, để thực hiện rotation. Việc sửa `seed.ts`/thêm guard là thay đổi code cục bộ, muốn có hiệu lực trên AWS thì cần redeploy sau — nhưng đó là việc phòng ngừa cho tương lai, không phải điều kiện để rotation admin hoạt động ngay.
- **Ảnh hưởng tới User/Fitness/Gym/Payment/AI/Chat?** Không — rotation chỉ đổi 1 cột `password` của đúng 1 user, không đổi role/id/email, không đụng service khác. Access token cũ (tối đa 15 phút) vẫn dùng được tới khi hết hạn tự nhiên — đây là rủi ro đã biết, chấp nhận được vì thời gian ngắn.
- **AWS WRITE operations cần phê duyệt:** (1) `POST /auth/login` + `PATCH /auth/me/password` thật trên admin@example.com (chính là hành động rotate), (2) tùy chọn: lưu mật khẩu mới vào Secrets Manager.
- **Report:** `docs/deployment/AWS_DEV_AUTH_SECURITY_HARDENING_2026-09-29.md`

*HARD STOP — chờ phê duyệt trước khi thực hiện bất kỳ AWS WRITE nào ở trên. Không tự chuyển sang Fitness/Gym/Payment E2E Testing.*
