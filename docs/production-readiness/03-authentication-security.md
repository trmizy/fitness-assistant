# 03 — Authentication and Security

Evidence labels: `CODE_INSPECTION` (file and line), `LIVE_LOCAL` (local Docker stack), `TEST_FIXTURE` (test-only harness).

## Flow inventory

| Step | Endpoint | Implementation | Notes |
|---|---|---|---|
| Register | `POST /auth/register` | `auth.service.ts` (`register`), pending row in `email_verifications` with bcrypt password hash | Duplicate email returns 409 |
| OTP delivery | email service | `email.service.ts`; dev fallback logs OTP when SMTP absent | G-06 |
| Verify registration | `POST /auth/register/verify` | Compares `sha256(otp)` with `otpHash`; creates user; issues tokens | G-05 |
| Resend OTP | `POST /auth/register/resend` (name per route file) | Upsert resets `attempts` | G-05 |
| Login | `POST /auth/login` | `loginRateLimit` per (IP, email); bcrypt compare; issues access and refresh tokens | G-25 |
| Access token | JWT, 15 min default | `JWT_ACCESS_EXPIRY` | G-01 |
| Refresh | `POST /auth/refresh` | Verifies JWT, finds stored raw token, deletes and reissues | G-07 |
| Logout | `POST /auth/logout` | Deletes presented refresh token | Access token not revoked before expiry (accepted, state it) |
| Password change | `PATCH /auth/me/password` | bcrypt compare, bcrypt hash | Revokes sessions? not traced |
| Password reset | `POST /auth/password-reset/request`, `POST /auth/password-reset` | Random 32-byte token, SHA-256 at rest | Expiry and single use NOT_VERIFIED |
| Verify token (service) | `POST /auth/verify` | `jwt.verify` then `findUserById`; rejects `isActive === false` | G-16, G-02 |

## Findings summary (details in the register)

- **G-01 (P0)** JWT signing fallback to a public literal.
- **G-02 (P0)** Bearer tokens written to logs by request logging on `/auth/verify`. `LIVE_LOCAL`: 1,024 of the last 2,000 auth log lines
  contained an `Authorization` entry.
- **G-05 (P1)** OTP storage and reset.
- **G-06 (P1)** Debug OTP fail-open.
- **G-07 (P1)** Plaintext refresh tokens; no reuse detection.
- **G-25 (P2)** Login throttling is not per account.

## Password handling

- bcryptjs, cost factor 10, in registration, login, password change and reset (`auth.service.ts` lines 145, 394, 560–573, 663, 708).
  Acceptable for this release; raise to 12 or move to argon2id as P3 hardening.
- Password is never logged (grep for `password` keys in auth logs: 0 matches in the last 2,000 lines, `LIVE_LOCAL`).

## OTP — offline brute-force analysis

Storage: `EmailVerification.otpHash = sha256(otp)` (auth.service.ts lines 108–109). Space: `crypto.randomInt(100000, 1000000)`, i.e. 900,000 values.

- Measured on the audit host (Node 24.14.1, synthetic six-digit value, no real OTP used): hashing all 900,000 candidates takes about 1.3 s;
  the matching value was found after 634,220 hashes in about 1.0 s. A GPU or a compiled attacker is faster still. There is no salt, so one
  pass covers every row.
- Therefore **any read of `email_verifications` (backup, replica, SQL injection, support tooling) recovers every pending OTP.** The
  recovered code completes `POST /auth/register/verify` for that pending registration. Impact is limited to pending registrations: an
  attacker can complete a registration for an address whose owner never proved control of it (email squatting), but cannot log in as an
  existing user, because login still requires the password chosen at registration. Accounts that already exist are not affected.
- Online guessing: each code has five attempts; resend resets the counter; resend is limited to one per 60 s per email and IP-throttled
  (gateway `authRateLimiter`, code default 20 requests per 15 minutes per IP, shared with login and every other `/auth` call). At 20 guesses
  per 15 minutes from one IP, exhausting the 900,000-value space takes about 470 days (expected half that). Distributed attackers scale the
  rate linearly with the number of addresses. The per-IP limit is the only control that bounds the online attack; the per-email budget does not.

**Recommended production design (not implemented in this audit):**
1. Store `HMAC-SHA256(pepper, otp)` with the pepper in the secret manager (rotated, versioned). A DB read alone is then insufficient.
2. Do not reset the cumulative attempt counter on resend. Budget per email (for example 10 verification attempts per hour), with exponential back-off.
3. Keep per-IP and per-email throttling at issue and verify.
4. Invalidate the row on first success.
5. Consider a longer code (8 digits) or a verification link for email confirmation; a link with a 256-bit token avoids guessing entirely.

## Token design

- Access: JWT HS256 (or the default algorithm of `jsonwebtoken`; algorithm pinning not verified), 15 minutes, carries `userId`.
- Refresh: JWT with `jti` (random UUID), 7 days, stored raw in the database. Rotation on use.
- Verification re-reads the user from the database on every call (role and `isActive` come from the database, not the token). This limits
  the damage of a forged token to impersonating an existing user (G-01 impact description).
- Algorithm pinning and `none` rejection: NOT_VERIFIED (check `jwt.verify` options in production code).

## Session revocation

- Refresh-token deletion on logout and on rotation.
- `revokeAllSessions(userId)` exists (`auth.service.ts` around line 682). Callers not traced.
- Access tokens are not blacklisted; disabling a user takes effect on the next verify (`isActive` check).

## Brute-force resistance (summary)

| Surface | Control | Strength |
|---|---|---|
| Login | per (IP, email) throttle; gateway IP limit | Medium (G-25) |
| OTP verify | 5 attempts per code; reset on resend; IP throttle | Weak (G-05) |
| OTP resend | 60 s cooldown per email; IP limit | Medium |
| Password reset request | `createEmailActionRateLimit("password-reset-request")` | Present (strength not traced) |
| AI ask | 20 per minute per IP | Medium (G-33) |

## Logging and secrets

- Access tokens in logs (G-02). Remove before release.
- OTP in logs when SMTP absent (G-06).
- No password in logs (observed).

## Open questions for authentication

1. Does any production environment run without `NODE_ENV=production` on a public listener? (G-06)
2. Was the JWT literal ever in effect in a deployed environment? (G-01)
3. Are there OTP-only flows (no pre-set password) that would be exposed by the offline recovery? (G-05)
4. Is `jwt.verify` pinned to HS256 in every service? (`NOT_VERIFIED`)
