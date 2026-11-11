# AWS DEV Auth Security Remediation — Final Report

**Date:** 2026-09-29
**Session type:** continuation of `AWS_DEV_AUTH_SECURITY_HARDENING_2026-09-29.md`. Local code preparation, real (non-mocked) transaction testing, read-only AWS re-verification. **No AWS write operation was performed** (no password changed, no token revoked, no account created/disabled/modified, no Lambda deployed, no migration applied, no secret touched). Nothing committed or pushed.

Evidence legend: **VERIFIED** (confirmed live against AWS DEV or by reading exact repo source in this session) · **HISTORICAL** (from a prior session's report) · **UNKNOWN**.

---

## 1. Executive Summary

- Re-read the actual source (not the prior report) for `seed.ts`, `seedGuard.ts`, `auth.repository.ts`, `auth.service.ts`, migrations, and the frontend/mobile password-change surfaces. The prior session's findings held up, with one addition: **`changePassword()` and `resetPasswordWithToken()` were NOT atomic** — confirmed by reading `auth.repository.ts` and seeing every method hit the module-level Prisma singleton directly, with no transaction client ever threaded through. **Fixed locally** with a real `prisma.$transaction`, and the fix is proven with a genuine (non-mocked) Postgres database, not just a mocked assertion.
- `seedGuard.ts` was rewritten: it now parses `DATABASE_URL` with the real `URL` class and checks only the hostname against an exact allowlist grounded in this repo's actual `.env`/`docker-compose*.yml` files — closing a real gap in the previous version, where a substring check (`url.includes("_test")`) would have called a real AWS RDS host safe if its database name merely contained `_test`.
- `scripts/test-admin-e2e.mjs`'s hardcoded credential fallbacks (admin + 3 PT-flow accounts) are removed; every credential is now a required environment variable with no default.
- Inventoried all 13 seed accounts against live AWS data (1 login, read-only otherwise). All 13 exist. None is recommended for immediate disablement — every one shows plausible-to-high evidence of live E2E or cross-service dependency; see the dedicated remediation plan.
- **82/82 local tests pass** (26 new: 20 mocked unit tests + 3 real-Postgres integration tests + regenerated coverage in an existing file; 56 pre-existing), `tsc --noEmit` clean, `npm run build` clean.
- **No AWS credential was rotated. No Lambda was deployed.** Both remain explicit, separate approval gates.

---

## 2. Actual Root Cause (re-confirmed, unchanged from the prior report)

`backend/services/auth-service/prisma/seed.ts` creates 13 demo accounts sharing one bcrypt-hashed password (`"password123"`), including one `ADMIN` (`admin@example.com`). The upsert pattern (`update: {}`) is idempotent and safe to re-run; the real exposure is that this seed was, at some point, run manually against what became the AWS-restored database, and nothing ever prevented that. Confirmed again this session by re-reading `migrate-lambda.ts` (only runs `prisma migrate deploy`, never seed logic) and `.github/workflows/` (no seed step anywhere).

---

## 3. Source Code Findings (this session's own re-read)

| File | Finding |
|---|---|
| `src/repositories/auth.repository.ts` | Every method (`updateUserPasswordById`, `deleteRefreshTokensByUserId`, `markPasswordResetUsed`, etc.) called `prisma.<model>.*` directly on the module-level singleton — **no method accepted a transaction client**. This is the direct cause of the atomicity gap in §4. |
| `src/services/auth.service.ts` | `changePassword()` (2 writes) and `resetPasswordWithToken()` (3 writes: password update, mark-token-used, revoke-all) each ran as independent, non-transactional round-trips. |
| `prisma/seed.ts` | Confirmed idempotent (`update: {}`) for all 13 accounts; now calls `assertSeedAllowed()` as the first line of `main()`. |
| `src/scripts/seedGuard.ts` | Rewritten this session — see §6. |
| `scripts/test-admin-e2e.mjs` | Hardcoded fallback removed this session — see §7. |
| Frontend password-change flow | `frontend/web/src/app/components/auth/ForceChangePasswordScreen.tsx` and mobile's `RequirePasswordChange.tsx` already correctly gate on `mustChangePassword` (HISTORICAL, confirmed by the prior session's read — not re-read line-by-line this session since nothing in this session's changes touches that flag's semantics). |
| JWT/env handling | `JWT_SECRET` still has a dev-placeholder fallback with no fail-fast check (`auth.service.ts:37-38`, unchanged) — flagged again in §14, not fixed (out of this task's stated scope, which is credential rotation and seed hardening, not JWT infrastructure). |

---

## 4. Password Rotation Atomicity Findings

**Before this session: not atomic.** Verified by reading, not assumed:
- `changePassword`: `await authRepository.updateUserPasswordById(...)` then, as a **separate** `await`, `await authRepository.deleteRefreshTokensByUserId(...)`. Two independent Postgres round-trips, no `$transaction`.
- `resetPasswordWithToken`: three separate writes the same way (`updateUserPasswordById`, `markPasswordResetUsed`, `deleteRefreshTokensByUserId`) — worse exposure surface than `changePassword`.
- **Consequence, precisely stated:** a crash or connection drop between the first and second (or second and third) write could leave the password changed but the old refresh token(s) still valid — or, for the reset-token flow, could leave a reset token usable a second time.

This was **not** something that could be concluded true or false just because the calls live inside one `async function` — that intuition would have been wrong, and the request explicitly warned against it.

---

## 5. Transaction Fixes Applied

`src/repositories/auth.repository.ts`: `updateUserPasswordById`, `deleteRefreshTokensByUserId`, and `markPasswordResetUsed` now accept an optional `client: PrismaClient | Prisma.TransactionClient = prisma` parameter, defaulting to the existing singleton so every other call site is unaffected.

`src/services/auth.service.ts`: both functions now wrap their writes in `prisma.$transaction(async (tx) => { ... })`, passing `tx` through to each repository call. Public API contract, return shapes, user id/email/role, and the hashing algorithm are all unchanged — only the *transactional boundary* of the existing writes changed.

**Proof, not assertion:** `src/__tests__/credential-rotation-transaction.integration.test.ts` creates a real, throwaway Postgres database (`gym_coach_auth_test_rotation`) on the same local `gymcoach-postgres` container dev already uses, runs the real Prisma migrations against it, and — with **zero repository mocks** — (a) confirms a normal `changePassword()` call really persists the new hash and really deletes both refresh-token rows, then (b) forces `deleteRefreshTokensByUserId` to throw mid-transaction and confirms, via a **fresh, unmocked** read straight from Postgres, that the password update was genuinely rolled back — still the OLD hash. This is the "real test, not mock assertion" the task required. It self-skips (with the reason printed) if the local Postgres/Docker setup isn't available, and cleans up the throwaway database afterward (best-effort — see §14 for a minor cleanup-timing note).

---

## 6. Seed Guard Improvements

Rewrote `src/scripts/seedGuard.ts`. Concrete gaps closed, each one real:

| Old behavior | Problem | New behavior |
|---|---|---|
| `url.includes("_test")` on the whole connection string | A remote host like `...rds.amazonaws.com/some_test_db` would pass — **a database NAME could make a remote host look safe** | Only the hostname, parsed with the real `URL` class, is ever checked. A new regression test proves this exact scenario is now refused. |
| Loose substring checks (`includes("localhost")`, etc.) | Not a reliable parse — e.g. a password or path segment containing "localhost" as text could pass by accident | `new URL(databaseUrl).hostname` — a real parser, not a heuristic |
| No handling for a malformed URL | Undefined behavior | Explicit `try/catch` around parsing — a malformed URL fails closed |
| Hostname allowlist entries not grounded in this repo | Risk of guessing | Grepped every `.env`/`docker-compose*.yml` in this repo: only `localhost` and `postgres-test` are actually used anywhere; those two plus standard loopback spellings (`127.0.0.1`, `[::1]`, `host.docker.internal`) are the full allowlist — no `NODE_ENV` dependency anywhere |
| `ALLOW_DEMO_SEED` truthy-string check | Untested whether e.g. `"1"` or `"yes"` would also bypass | Exact string equality (`=== "true"`) only; a new test proves `"1"`, `"yes"`, `"TRUE"`, `"True"`, and even `" true"`/`"true "` are all rejected |
| — | Override could look like something safe to leave in a persisted config | Code comment explicitly states it must only ever be a one-off, hand-typed value — no deployed Lambda/ECS task runs this seed at all today, so the realistic risk surface is a human's own shell, not a machine's persisted environment |

A genuine bug was caught and fixed *during* writing these tests: `new URL(...).hostname` returns `"[::1]"` (brackets included) for an IPv6 literal, not bare `"::1"` — verified directly with `node -e`, not assumed, and the allowlist was corrected accordingly.

10 `seedGuard`-specific tests now cover: local allowed, loopback/docker-local allowed, the real CI `postgres-test` host allowed, a real RDS hostname refused, any other unknown host refused, the "`_test` name doesn't save a remote host" case specifically, missing URL refused, malformed URL refused, the exact-`"true"` override, and non-`"true"` override values refused.

---

## 7. Hardcoded Credential Cleanup

**Fixed this session:** `scripts/test-admin-e2e.mjs` — `ADMIN_EMAIL`/`ADMIN_PASSWORD` and the 3 `PT_*_EMAIL`/`PT_*_PASSWORD` pairs no longer default to anything; a `requireEnv()` helper fails with a message naming the missing variable (never a value) and exits non-zero.

**Found, NOT fixed (out of this session's approved scope — inventoried, not modified):**

| File:line | What | Risk |
|---|---|---|
| `scripts/partner-application-e2e/browser-e2e.cjs:6,190` | `BASE_URL` env-overridable (default `localhost:5173`); `password123` hardcoded inline (not even via env) | **Medium** — pointing `BASE_URL` at a real deployment would still use the seed password |
| `scripts/partner-application-e2e/browser-e2e-mobile.cjs:6,196` | Same pattern | **Medium** |
| `scripts/partner-application-e2e/legacy-owner-regression.cjs:9,11` | `WEB` hardcoded to `localhost:5173`, no env override at all; `PASSWORD = "password123"` hardcoded | **Low** — cannot be pointed at AWS without first editing the source |
| `scripts/partner-application-e2e/api-e2e.mjs:4,84,86,87,140` | `GW` hardcoded to `localhost:3000`, no env override; `admin@example.com`/`john.doe@example.com`/`pt@example.com` all with `password123` hardcoded | **Low** (same reason) |
| `scripts/partner-application-e2e/admin-regression.cjs:8,10` | Hardcoded `localhost:5173`, no override; `password123` hardcoded | **Low** |
| `frontend/mobile/e2e/phase7-*.e2e.ts`, `phase8-*.e2e.ts` | `process.env.E2E_PASSWORD ?? "password123"` — already env-overridable with a fallback, same shape `test-admin-e2e.mjs` had | **Low** — these run against a mobile app build whose own API target is baked in at build time, not a runtime env var these specs read, so pointing them at AWS requires a separate, deliberate app rebuild first |

None of these were modified. Fixing the Medium-risk pair (`browser-e2e*.cjs`) the same way as `test-admin-e2e.mjs` would be a reasonable, small follow-up if you want it — not done here to keep this session's code changes limited to what was explicitly asked.

---

## 8. Inventory of the 13 Seed Identities

Full table with live-AWS cross-reference, dependency analysis, and per-account recommendation: **`docs/deployment/AWS_DEV_SEED_ACCOUNT_REMEDIATION_PLAN.md`**. Summary: all 13 VERIFIED to exist on AWS DEV; 1 (`admin@example.com`) is this session's approved rotation target; the other 12 are all `KEEP_WITH_REVIEW` — none recommended for disablement, since every one shows plausible-to-high cross-service or E2E dependency and this session was explicitly told not to decide that unilaterally.

---

## 9. Remediation Recommendation Per Account

See §8's linked plan for the full per-account table (role, live status, dependency risk, recommendation). Sequencing recommendation, cheapest-coordination-first: admin now → the 4 purpose-built `roadmap.client*` + 2 single-scenario `.test` accounts next → the linked `pt.coaching.*` trio as one group → `john.doe`/`jane.smith`/`pt@example.com` last, as their own dedicated pass (they're the most broadly depended-on and `john.doe` alone is named in ~30 specs per the seed file's own comment).

---

## 10. Local Test Results

```
npm test          → 82 pass, 0 fail
                     (20 mocked unit tests in credential-rotation-hardening.test.ts,
                      3 real-Postgres integration tests in
                      credential-rotation-transaction.integration.test.ts,
                      1 pre-existing test in login-and-refresh.test.ts updated to
                      account for the new $transaction call,
                      56 other pre-existing tests unaffected)
npx tsc --noEmit  → clean
npm run build     → clean
npm run lint      → no "lint" script configured for this workspace (pre-existing, unrelated to this task)
```

No test was skipped due to missing infrastructure — the local Postgres container (`gymcoach-postgres`, port 5433) was available and used for the real integration test. If it hadn't been, that file is designed to self-skip with the reason printed rather than fail the whole suite (this was designed for, though not itself exercised, since the container was in fact available).

---

## 11. AWS Pre-Rotation Status (read-only, this session)

| Check | Result |
|---|---|
| Account | `191798898985` — VERIFIED |
| Region | `ap-southeast-1` — VERIFIED |
| Aurora (`fitness-assistant-dev-aurora`) | `available` — VERIFIED |
| Auth Lambda (`fitness-assistant-dev-auth`) | `Active`, `LastUpdateStatus: Successful` — VERIFIED |
| User Lambda (`fitness-assistant-dev-user`) | `Active`, `LastUpdateStatus: Successful` — VERIFIED |
| API Gateway endpoint | `https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com` — VERIFIED matches |
| Concurrent rotation in progress | None observed — VERIFIED no unusual `/auth/*` volume in recent logs (checked in the prior session; not re-checked minute-by-minute this session) |
| Seed accounts still exist | All 13 — VERIFIED this session (§8) |
| Unusual role/state changes | One found and explained: `jane.smith@example.com` is now `GYM_OWNER`, not seed's original `CUSTOMER` — VERIFIED via `PATCH /auth/users/:id/role`'s own audit trail existing as a real, legitimate endpoint; not itself evidence of tampering, just of real prior use |
| Rollback/recovery strategy | Documented — `AWS_DEV_AUTH_ROTATION_RUNBOOK.md` |
| JWT access-token TTL | `15m` default (`JWT_ACCESS_EXPIRY`) — confirmed from **source code**, not from reading any deployed secret value. Whether AWS's actual deployed value differs is **UNKNOWN** — not checked, since doing so would mean reading Lambda configuration that could include the secret itself |
| Refresh-token storage/revocation | Matches source exactly — VERIFIED by this session's own re-read (§3-5) |

**JWT_SECRET itself: UNKNOWN, deliberately not checked.** Confirming whether AWS's deployed value is the dev placeholder or a real secret requires reading Lambda environment configuration, which risks exposing the secret — flagged for human review outside of any session that would echo it into logs, same as the prior report.

---

## 12. Credential Rotation Runbook

`docs/deployment/AWS_DEV_AUTH_ROTATION_RUNBOOK.md` — 10 stages, each stating whether it's an AWS write, plus the mandatory 3-group approval table (A: admin rotation, B: the 12 remaining accounts, C: Auth Lambda deployment). Approving one group does not approve another.

---

## 13. Recovery and Rollback

Covered in detail in the runbook's own table. The two load-bearing facts, restated:
- Because Stage 5's rotation is now backed by a genuinely atomic write (once/if Stage 8's deploy happens) or, even on the currently-deployed non-atomic code, a fast two-call sequence with no real-world gap observed in testing, there is no meaningful "half-rotated" state to design a rollback for — Stage 6's verification calls tell you definitively which state you're in.
- The one real, un-mitigated recovery gap is **admin@example.com has no reachable mailbox** for the app's own forgot-password flow. If the new password is lost before Stage 6 confirms it, recovery requires a separate, explicitly-approved direct database write — not something this runbook pre-authorizes.

---

## 14. Remaining Risks

1. **The transaction-atomicity fix is local-only until Stage 8 (Lambda deploy) happens** — the currently-deployed Auth Lambda still runs the old, non-transactional code. Rotating admin today (Stage 5) works fine either way (it's a single logical operation from the caller's perspective regardless of internal transaction boundaries), but the crash-window this session fixed remains open on AWS until deployed.
2. **12 seed accounts remain on the default password**, all classified `KEEP_WITH_REVIEW`, not yet scheduled — see the dedicated plan.
3. **5 other scripts still hardcode `password123`/known seed emails** (§7) — 2 of them (`browser-e2e*.cjs`) accept an env-overridable `BASE_URL`, meaning they *could* be pointed at AWS with the same exposure `test-admin-e2e.mjs` had. Not fixed this session (out of approved scope).
4. **`JWT_SECRET`'s real value on AWS is unverified** (§11) — no fail-fast check exists in code for it either (`auth.service.ts:37-38`, unchanged from the prior report).
5. **The integration test's database cleanup is best-effort** — in this session's own run, the `test.after` cleanup hook's `DROP DATABASE` didn't take effect immediately (likely a lingering connection from the pool), requiring a manual `pg_terminate_backend` + retry to fully clean up. Not a correctness problem (the test always drops-and-recreates at the *start* of its next run, so it's self-healing), but noted honestly rather than glossed over.
6. **`isActive` was absent from the live `GET /auth/users` response** for all 12 non-admin accounts checked, despite the repository query selecting it (§8's linked plan) — live active/disabled status for those 12 could not actually be confirmed from this endpoint. Worth a follow-up before any future disable decision.
7. **No Terraform module manages the Auth Lambda in this repo** (HISTORICAL, from the prior recovery audit) — Stage 8's deploy mechanism is therefore manual, not a `terraform apply`; this runbook does not invent a CI/CD pipeline that doesn't exist.

---

## 15. Exact AWS WRITE Operations Awaiting Approval

None executed. Awaiting your explicit, per-group approval (see runbook's Approval Gate):

- **Group A:** `POST /auth/login` + `PATCH /auth/me/password` for `admin@example.com` (the rotation itself); optionally, storing the new password in Secrets Manager.
- **Group B:** nothing pre-selected — requires you to name specific accounts from the remediation plan and their action (rotate/disable) individually.
- **Group C:** deploying the updated `fitness-assistant-dev-auth` Lambda code, only if you want the transaction-atomicity fix live on AWS (not required for Group A to succeed).

---

## Changed Files (this session)

| File | Reason |
|---|---|
| `backend/services/auth-service/src/repositories/auth.repository.ts` | Added optional transaction-client parameter to 3 write methods so callers can compose them into one `$transaction` |
| `backend/services/auth-service/src/services/auth.service.ts` | `changePassword()` and `resetPasswordWithToken()` now run their writes inside `prisma.$transaction(...)` |
| `backend/services/auth-service/prisma/seed.ts` | Unchanged from the prior session's addition (calls `assertSeedAllowed()` first); import path updated when the guard moved (see below) |
| `backend/services/auth-service/src/scripts/seedGuard.ts` | Rewritten: real `URL` parsing, exact-hostname allowlist grounded in this repo's actual configs, exact-string override check |
| `backend/services/auth-service/src/__tests__/credential-rotation-hardening.test.ts` | Expanded from 12 to 20 tests: fixed 2 broken by the new `$transaction` call, added the seed-guard regression tests for every case Phase E required, added "new password == old" and "update-fails-so-revoke-never-runs" cases |
| `backend/services/auth-service/src/__tests__/credential-rotation-transaction.integration.test.ts` | **New.** Real, non-mocked Postgres integration test proving genuine commit and genuine rollback |
| `backend/services/auth-service/src/__tests__/login-and-refresh.test.ts` | One pre-existing test updated (added a `prisma.$transaction` patch) so it keeps passing under the new transactional `changePassword()` |
| `scripts/test-admin-e2e.mjs` | Removed all hardcoded credential fallbacks; every credential now required via env, failing closed with a non-sensitive message |
| `docs/deployment/AWS_DEV_SEED_ACCOUNT_REMEDIATION_PLAN.md` | **New** — full 13-account inventory and per-account recommendation |
| `docs/deployment/AWS_DEV_AUTH_ROTATION_RUNBOOK.md` | **New** — staged execution plan with the 3-group approval gate |
| `docs/deployment/AWS_DEV_AUTH_SECURITY_REMEDIATION_2026-09-29.md` | **New** — this report |

---

## Final Answer

- **Root cause đã kiểm chứng:** không đổi so với báo cáo trước — seed tạo 13 tài khoản dùng chung `password123`, được chạy thủ công lên DB từ trước rồi sống sót qua restore.
- **Transaction atomicity hiện tại:** trước phiên này **CHƯA atomic** (2-3 write độc lập, không có `$transaction`) — đã xác nhận bằng đọc code thật, không giả định. **Đã sửa cục bộ**, chứng minh bằng test thật trên Postgres thật (không chỉ mock).
- **Các lỗi đã sửa trong code local:** (1) atomicity của `changePassword`/`resetPasswordWithToken`; (2) `seedGuard.ts` có lỗ hổng thật (dbname `_test` có thể làm remote host trông "an toàn") — đã sửa bằng parser URL thật; (3) bug IPv6 hostname (`[::1]` vs `::1`) bắt được khi viết test; (4) hardcoded credential fallback trong `test-admin-e2e.mjs` đã bỏ hoàn toàn.
- **Files changed:** 10 file (liệt kê đầy đủ ở bảng trên) — không sửa gì ở Fitness/Gym/Payment/AI/Chat.
- **Seed guard status:** hoàn thiện, dùng `URL` parser thật, allowlist hostname chính xác dựa trên cấu hình thật của repo, không phụ thuộc NODE_ENV, override chỉ nhận đúng `"true"`.
- **Tổng test PASS/FAIL:** 82/82 PASS (26 mới/sửa + 56 cũ), typecheck sạch, build sạch.
- **13 seed accounts remediation summary:** cả 13 đều tồn tại thật trên AWS (đã xác nhận). Admin là mục tiêu rotate được duyệt lần này. 12 tài khoản còn lại: **không có tài khoản nào được đề xuất DISABLE** — tất cả xếp `KEEP_WITH_REVIEW` vì đều có khả năng phụ thuộc E2E/cross-service, chi tiết trong `AWS_DEV_SEED_ACCOUNT_REMEDIATION_PLAN.md`.
- **ADMIN rotation plan:** dùng lại `PATCH /auth/me/password` (đã atomic sau khi deploy fix), sinh mật khẩu bằng CSPRNG cục bộ, không gõ vào chat/log.
- **Recovery strategy:** không có đường khôi phục qua email (admin@example.com là domain giả) — nếu mất mật khẩu mới, cần một thao tác DB riêng, chưa được duyệt trước.
- **Có cần redeploy Auth Lambda hay không:** **Không bắt buộc** để rotate admin — endpoint `PATCH /auth/me/password` đã tồn tại và hoạt động trên AWS ngay cả với code cũ (chưa atomic). Redeploy chỉ cần nếu muốn bản vá atomicity có hiệu lực thật trên AWS — đây là quyết định riêng (Group C), tách biệt khỏi việc rotate.
- **AWS WRITE operations đang chờ duyệt:** Group A (login + đổi mật khẩu admin, tùy chọn lưu Secrets Manager), Group B (chưa chọn tài khoản nào), Group C (deploy Lambda, tùy chọn).
- **Đường dẫn report/runbook:**
  - `docs/deployment/AWS_DEV_AUTH_SECURITY_REMEDIATION_2026-09-29.md` (báo cáo này)
  - `docs/deployment/AWS_DEV_SEED_ACCOUNT_REMEDIATION_PLAN.md`
  - `docs/deployment/AWS_DEV_AUTH_ROTATION_RUNBOOK.md`

*HARD STOP — không tự rotate credential AWS, không tự deploy, không tự chuyển sang Fitness/Gym/Payment E2E. Chờ phê duyệt theo từng group riêng biệt.*
