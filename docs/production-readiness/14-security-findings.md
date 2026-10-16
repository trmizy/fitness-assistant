# 14 — Security Findings

This file is the security view of the gap register. Every finding links to its gap ID. Secret values are never reproduced here;
secret-related findings name the file and location only.

Evidence labels: `CODE_INSPECTION`, `LIVE_LOCAL`, `TEST_FIXTURE`, `NOT_VERIFIED`.

## Critical path summary

| Gap | Severity | Attack in one line | Evidence |
|---|---|---|---|
| G-01 | P0 | Forge a JWT with the public literal and impersonate any user whose UUID is known | CODE_INSPECTION |
| G-02 | P0 | Read a valid 15-minute access token from auth-service logs and replay it | LIVE_LOCAL |
| G-03 | P0 | Intercept passwords, tokens and OTPs on the plaintext HTTP edge | CODE_INSPECTION |
| G-04 | P0 | Run a destructive migration with no snapshot; measured data is deleted | CODE_INSPECTION |
| G-05 | P1 | Recover pending OTPs from a database read; guess online across resends | TEST_FIXTURE + CODE_INSPECTION |
| G-06 | P1 | Read an OTP from an API response when `NODE_ENV` is misconfigured | CODE_INSPECTION |
| G-07 | P1 | Use a plaintext refresh token from a database read for seven days | CODE_INSPECTION |
| G-08 | P1 | Change any user's role if a request reaches auth-service without the gateway | CODE_INSPECTION |
| G-09 | P1 | Reach `/auth/internal/*` from the internet; one shared secret grants all internal calls | CODE_INSPECTION |

## Authentication

- **Passwords.** bcryptjs with cost 10 for registration, login, change and reset (`auth.service.ts`). Acceptable. Cost 10 is at the low end of
  current guidance; a higher cost or an argon2id migration is P3 (not in the register).
- **Reset tokens.** Random 32-byte values, stored as SHA-256 hashes (`auth.service.ts` lines 627–628). Acceptable because the value is
  high-entropy. Expiry and single-use were not traced in full (`NOT_VERIFIED`).
- **OTP.** Unsalted SHA-256 over a 6-digit space; attempt counter reset on resend. See G-05. Historical backlog item "OTP hardening" is
  still open.
- **Refresh tokens.** Stored raw; rotation without reuse detection. See G-07.
- **Access tokens.** Verified by signature and then by database lookup of the user (`verifyToken`, about line 521); disabled users are rejected
  through `isActive`. Good. Signing secret: G-01.
- **Logout.** Deletes the presented refresh token (`logout`, `auth.service.ts` around line 507). Access tokens are not revoked before expiry;
  with 15-minute lifetimes this is an accepted trade-off but must be stated.
- **Brute force.** Login throttled per (IP, email) and per IP at the gateway (G-25).

## Secrets and configuration

- Public literal fallbacks for `JWT_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_SERVICE_SECRET` and others (G-01, G-10).
- Shared static internal secret (G-09).
- Provider keys (MoMo, PayOS, VNPay) default to the empty string, not a literal. Verification refuses an empty key (verified: G-23).
- Development credentials and `fix.js` (G-30).
- Production compose takes secrets from the host environment through `${...}`. No secret value is written in the compose file.

## Transport and edge

- Plaintext HTTP only in the repository's production topology (G-03).
- Gateway: `helmet`, CORS allow-list from environment (`corsOrigins.ts`), `trust proxy` set to 1 (`app.ts` line 22). Verified in code; response
  headers were not captured at runtime (`NOT_VERIFIED`).
- Body limits: auth 1 MB, fitness 15 MB for imports, AI 6 MB for images, default 100 KB elsewhere. Reasonable. Gateway JSON limit exists for
  translate routes (16 KB).

## Authorization and isolation (summary of G-24)

Verified in code (sampled):
- Coach-client actions re-check the active PT-client relationship server-side (`coach.service.ts`, about line 41 returns 403).
- Marketplace withdraw checks `publisherId` (`PUBLISHED_PLAN_FORBIDDEN`).
- Chat socket join checks participant membership before `socket.join` (`chat.handler.ts` lines 30–34).
- Admin socket room is joined only when the verified role is ADMIN (`socket/index.ts` lines 61–63).
- AI admin router applies `requireAuth` and `requireRole(['ADMIN'])` (`admin.routes.ts` lines 15–16).
- AI confirm and dismiss scope the database update by `userId` (`fitness-agent.service.ts`, around lines 777–826).

Not verified: owner checks on every user-owned route; cross-user tests; marketplace republish, adopt and review; fitness id-only lookups
outside scripts.

## Injection and unsafe input

- No raw SQL with user input in production code. The only `$executeRawUnsafe` reference is a comment in a script (verified by grep).
- `ENABLE_TOOL_CALLING` defaults to off (`llm/orchestrator.service.ts` line 91; enabled only when the value is exactly `"true"`).
- Zod validation is used for auth update requests and other routes (`updateUserRoleSchema.parse`). Coverage across all routes is not verified.
- Prompt injection: an evaluation harness exists (`ai-service/src/evaluation/agentic`). Live prompt-injection results were not reproduced here.

## Logging and secrets in logs

- G-02 (live): bearer tokens in logs.
- G-06: OTP logged when SMTP is absent (dev path).
- G-32: no central redaction.
- Request logging only in auth and user services; business services log identifiers and error messages (acceptable).

## Payment security

- MoMo and VNPay webhook signatures verified; empty key rejected (verified). PayOS and ZaloPay not verified (G-23).

## Items that remain open security decisions

1. Whether production uses the EC2 compose topology or Lambda (affects G-03, G-12, G-16).
2. Whether any environment ever ran with the public JWT literal (G-01 rotation scope).
3. Whether production database contains rows deleted by historical migrations (G-04).
