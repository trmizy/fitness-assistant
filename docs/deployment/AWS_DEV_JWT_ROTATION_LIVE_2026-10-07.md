# AWS DEV JWT Secret Rotation — Live Execution — 2026-10-07 (Phase 13B-B)

No password, JWT, refresh token, or secret value appears anywhere in this report — only HTTP status
codes, booleans, role names, and Lambda metadata (RevisionId, LastModified, key counts).

## Continuous Test Session State

This phase ran as part of an explicit continuous DEV security-test session: Backend/Aurora was
started once and is **intentionally left running** at the end of this phase for the next security
phase, per the owner's own instruction. No frozen-state cleanup was performed; one is deferred until
the owner explicitly ends the session.

## Pre-Rotation Verification

Preflight: `git status`/`HEAD` reviewed, account/region confirmed (`191798898985`/`ap-southeast-1`),
`JwtRotation.Tests.ps1` **18/18 PASS**, Auth unit tests **79/79 PASS**. Aurora was `stopped` at the
start of this phase (`BACKEND_REUSED: NO`), so `dev-start.ps1 -Backend -Execute` was run: Aurora
reached `available`, Secrets Manager VPCE active, all 13 DEV-pausable schedules `ENABLED`,
`gym-partner-upload-sweep` confirmed `DISABLED`.

A pre-rotation session was captured by logging in once with the (already Phase-13A-remediated) admin
account and saving the resulting access/refresh tokens to local scratch files only — never displayed.
Confirmed: `200`, `role: ADMIN`, token lengths logged (249/252 characters) as the only non-opaque
detail.

## Rotation Execution

The Phase 13B-A-reviewed helper (`scripts/aws/security/Invoke-JwtSecretRotation.ps1 -Execute`) found
a **real, previously-undetected bug** on its first two live attempts: Windows PowerShell 5.1's
`-Encoding UTF8` writes a byte-order mark, which the AWS CLI's JSON parser rejects outright
(`ParamValidation: Error parsing parameter 'cli-input-json': Invalid JSON received`). Both failed
attempts were independently confirmed to have caused **zero AWS mutation** — a narrow
`RevisionId`/`LastModified`/environment-key-count check showed all three completely unchanged after
each failure, proving the helper's atomic, fail-closed design worked exactly as intended: a failed
call leaves the Lambda provably untouched, never partially applied.

Fixed by switching to `-Encoding ASCII` (the payload is pure base64 + JSON structural characters, so
this is lossless) — the **same fix already used elsewhere in this exact codebase**, in
`dev-start.ps1`'s `Set-AossNetworkPolicyVpce`, for an identical BOM-related reason. Verified safe
first with a harmless no-op test call (re-submitting the *unchanged* current environment through the
same code path) before retrying the real helper.

The real rotation then succeeded cleanly:

```
ROTATION RESULT (sanitized - no secret values):
  TargetFunction: fitness-assistant-dev-auth
  EnvironmentKeysFound: 10
  JwtSecretPresent: True
  JwtRefreshSecretPresent: True
  RotationReady: True
  UpdateStatus: Successful
  NewLastModified: 2026-10-07T10:29:28.000+0000
  NewRevisionId: f456458d-bf09-46d7-ba96-f4f030464d9e
```

**No secret value — old or new — was ever displayed, logged, or written to any file other than
inside AWS's own Lambda configuration itself.** `JWT_SECRET_ROTATED: YES`, `JWT_REFRESH_SECRET_ROTATED:
YES`, both as one atomic operation (`ROTATION_ATOMIC: YES` — the merge logic refuses to produce any
result unless both new values are present, per Phase 13B-A's design and its 18 unit tests).

## Configuration Preservation

Narrow-query comparison against the known pre-rotation baseline — **byte-identical on every field**:
VPC (`vpc-010c13afd8920c8f1`, subnets `subnet-02b39d77762465ef8`/`subnet-09e3230f7bca04c8e`, SG
`sg-0b38ab22927b284ab`), IAM role (`.../fitness-assistant-dev-auth-lambda-role`), runtime
(`nodejs22.x`), memory (`1024`), timeout (`30`), handler (`dist/lambda.handler`), layers (`null`),
and environment key **count** (`10`, unchanged). **`CONFIG_PRESERVATION: PASS`.**

## Old Token Verification

Using the pre-rotation tokens held only in local scratch files:

- **`OLD_ACCESS_TOKEN: REJECTED`** — `POST /auth/verify` → HTTP `401`.
- **`OLD_REFRESH_TOKEN: REJECTED`** — `POST /auth/refresh` → HTTP `401`.

Both rejected on the **very first** post-rotation check — no bounded retry was even needed, despite
Phase 13B-A's own design doc flagging a real possibility of a warm-container delay (module-scope
secret caching). The two earlier failed-but-safe rotation attempts, plus the harmless no-op
verification call made while debugging the encoding issue, had each triggered a Lambda configuration
update — very plausibly cycling the execution environment(s) serving this function before the real
rotation ever ran, which would explain the unusually prompt cutover.

## New Login Verification

- **`NEW_LOGIN: PASS`** — HTTP `200`, `role: ADMIN` (preserved).
- **`NEW_ACCESS_TOKEN_VERIFY: PASS`** — the freshly issued access token passed `/auth/verify`
  (HTTP `200`), proving `JWT_SECRET`'s new value is live and correctly wired.

## Refresh Flow Verification

- **`NEW_REFRESH_FLOW: PASS`** — `POST /auth/refresh` with the freshly issued refresh token →
  HTTP `200`, returning a new access token.
- That new access token was itself verified (`/auth/verify` → `200`), proving `JWT_REFRESH_SECRET`'s
  new value is also live and correctly wired, end-to-end through a real refresh cycle.

## Optional Cross-Service Smoke Test

Network was started temporarily (`dev-start.ps1 -Network -Execute`, NAT reached `available`) for a
single, targeted check: `GET /profile/me` (User-service) with the post-rotation access token →
**HTTP `200`**, body `{"profile":null}` (correct/expected — the admin test account has no
User-service profile row; `null` here is the right answer, not an error). This proves User-service's
internal `/auth/verify` call chain validates tokens signed with the *newly rotated* `JWT_SECRET`
end-to-end, not just within Auth itself. **`CROSS_SERVICE_SMOKE_TEST: PASS`.**

Network was then stopped (`dev-stop.ps1 -Network -Execute`) — confirmed `NAT: 0`, with Backend/Aurora/
Secrets VPCE/schedules all independently re-verified untouched (the Phase 12A additive/subtractive
lifecycle fix, live-certified in Phase 12B, held correctly here too: the plan output showed
`Backend = ON (preserved)` / `Secrets = ON (preserved)` exactly as designed).

## CloudWatch Review

Auth Lambda (`/aws/lambda/fitness-assistant-dev-auth`), the full test window: **6× HTTP 200, 2× HTTP
401** (the two expected old-token rejections above — correct behavior, not errors). **Zero 5xx, zero
error-level (level 50) log entries.**

## Resources Left Intentionally Active

Per the continuous-test-session policy, **Backend was deliberately not stopped**:

| Resource | State |
|---|---|
| Aurora | `available` |
| Secrets Manager VPCE | `active` |
| 13 DEV-pausable schedules | `ENABLED` |
| `gym-partner-upload-sweep` | `DISABLED` (untouched, as always) |
| NAT | `0` (stopped after the one-time smoke test) |
| Chat / AI | untouched, never started |

This is **not** a cost leak — it is an explicitly owner-authorized continuous test session. Final
frozen-state certification is deferred until that session is explicitly ended.

## Remaining Security Work

- `INTERNAL_SERVICE_SECRET` and `SMTP_PASS` remain un-rotated — explicitly out of scope for this
  phase (Phase 13C+ or later, per instruction).
- A real, minor tooling defect (the PowerShell UTF8-BOM/AWS-CLI JSON incompatibility) was found and
  fixed in `scripts/aws/security/Invoke-JwtSecretRotation.ps1` during this phase's live run — the
  fix is now part of the committed helper, so Phase 13B-A's own design doc's eventual-consistency
  caveat about old-token lingering is noted as **better in practice than predicted** this run, but
  should not be assumed guaranteed on every future rotation (the prompt cutover here was plausibly
  incidental to the two earlier failed attempts cycling the Lambda's execution environment).
