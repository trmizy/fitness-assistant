# AWS DEV SMTP Credential Remediation — Design + Checkpoint — 2026-10-07 (Phase 13D)

No credential value — old or new SMTP_PASS, any Gmail App Password — appears anywhere in this
report. Design + local tooling only so far; **zero AWS mutations were performed**. This phase stops
at the required human checkpoint before any live credential change.

## SMTP Architecture

Confirmed by reading source, not assumed: `backend/services/auth-service/src/services/email.service.ts`
is the **sole** SMTP consumer in this entire codebase — no other file anywhere imports `nodemailer`
or reads `SMTP_PASS`. Every other service that needs to notify a user by email calls **into**
auth-service's own `POST /auth/internal/send-email` route instead of holding its own credential.

- **SMTP_CONSUMER**: `fitness-assistant-dev-auth` (Lambda)
- **SMTP_RUNTIME**: AWS Lambda, VPC-attached (same subnets/SG as every other service Lambda)
- **Use cases**: `sendOtpEmail` (registration OTP) and `sendPlainEmail` (generic — contract
  confirmations, etc., triggered by other services via the internal route above)
- **SMTP_PASS_STORAGE**: plain Lambda environment variable (not Secrets Manager), same model as
  every other secret rotated this engagement

## Existing Credential Risk

The current `SMTP_PASS` value was printed in plaintext during Phase 10 (an `aws lambda
update-function-code` call missing a `--query` filter) and must be treated as compromised.

## Verify Google/Gmail App Password Model

Confirmed **live**, not from historical notes: `SMTP_HOST = smtp.gmail.com`, `SMTP_PORT = 465`,
`SMTP_USER = huytronh5@gmail.com` (all non-secret configuration, safe to read directly).
**`SMTP_EXTERNAL_ROTATION_REQUIRED: YES`** — this is genuinely Gmail SMTP with Google App Password
authentication. Per instruction: no attempt was made to log into Google, and no Gmail App Password
was generated programmatically — that is categorically a human action.

## Zero-Exposure Tooling

Same architecture as the JWT and INTERNAL_SERVICE_SECRET rotation helpers, scaled down to a single
target and a human-provided (not generated) new value:

- `scripts/aws/security/lib/SmtpRotation.psm1` — pure functions: `Test-SmtpRotationPreconditions`,
  `Merge-RotatedSmtpPassword`, `Test-SmtpConcurrencyToken`, `Get-SanitizedSmtpSummary`. Deliberately
  has **no** "generate a new value" function — a Gmail App Password cannot be synthesized here.
- `scripts/aws/security/lib/SmtpRotation.Tests.ps1` — Pester, fake values only.
- `scripts/aws/security/Invoke-SmtpCredentialRotation.ps1` — the orchestrator. Dry-run by default.

**Secure human input, enforced structurally, not just by convention**: the script has **no**
`-SmtpPassword`/`-Password`/`-Credential` string parameter at all — verified by an AST-level test
that parses the script's own parameter block and asserts no such parameter exists. The only way to
supply the new value is `Read-Host -Prompt "..." -AsSecureString` at `-Execute` time, which does not
echo to the terminal, is not visible in shell history, and is not exposed as a process argument. The
`SecureString` is converted to plain text only in local memory, consumed immediately by the merge
function, then explicitly cleared (`$plainNewPassword = $null`) before the AWS update call is even
made.

## Fake-Secret Tests

**16/16 pass**, zero AWS calls, fake values only:

1. SMTP_PASS replaced — PASS
2. Unrelated env vars preserved (`SMTP_HOST`, `SMTP_USER`, `JWT_SECRET`, `JWT_REFRESH_SECRET`,
   `INTERNAL_SERVICE_SECRET`, `NODE_ENV` all byte-identical) — PASS
3. Missing SMTP_PASS → fail — PASS
4/5. Wrong account/region → fail — PASS
6. RevisionId mismatch → fail — PASS
7. No plaintext in sanitized output (explicit whitelist) — PASS
8. No plaintext in error messages — PASS
9/10. `-Execute` is a `SwitchParameter`; dry-run is the unconditional default — PASS (verified via
   AST inspection of the real script, not just a convention)
11. No parameter named anything password/credential/secret-shaped accepts a plain string; the script
    body is confirmed to use `Read-Host ... -AsSecureString` — PASS (AST + source-text check)
12. The merge changes only `SMTP_PASS` — key set and every other value identical — PASS

A real (non-mutating) dry run was executed against the live Auth Lambda:

```
Preconditions OK: account=191798898985 region=ap-southeast-1 target=fitness-assistant-dev-auth
DRY RUN (default) - plan only, nothing was mutated, no prompt shown:
  TargetFunction: fitness-assistant-dev-auth
  SmtpPassPresent: True
  RotationReady: True
  RevisionId: 14c4ce33-4284-4840-b6a2-e4b5ea0387c1
  EnvironmentKeysFound: 10
```

No secret value appeared, and no prompt was shown (correct — dry-run must never prompt).

## Network Requirement (determined, not assumed)

Auth Lambda's `VpcConfig` places it in the same private subnets as every other service Lambda
(`subnet-02b39d77762465ef8`/`subnet-09e3230f7bca04c8e`). The private route table
(`rtb-0f743d4fd0949f9aa`) has been directly inspected multiple times already this engagement and,
whenever Network/NAT is off, contains only `10.0.0.0/16 → local` — no route to the public internet.
Gmail's SMTP endpoint (`smtp.gmail.com:465`) is a public internet host. **The AWS-side credential
UPDATE itself (`update-function-configuration`) is a control-plane API call and needs no NAT** — but
a real **email-send test** (Phase 13D.10) will need Network started temporarily, exactly as every
other cross-service test this engagement required.

## Human Rotation Step — STOP

Per the brief's own required checkpoint, this phase stops here.

```
HUMAN_ACTION_REQUIRED:

1. Open the Google Account that owns huytronh5@gmail.com's App Passwords settings.
2. Create a NEW App Password for "Gymini DEV SMTP" (or an equivalent clearly-labeled name).
3. Do NOT paste it into Claude, ChatGPT, GitHub, any Markdown file, or any terminal command
   argument.
4. Keep it available only long enough to type it directly into the secure prompt the local
   PowerShell helper will show you (Enter new SMTP credential (Gmail App Password):) - the
   terminal will not echo it.
5. Do NOT revoke the OLD Gmail App Password yet. We update AWS and verify the new one actually
   sends mail FIRST; only after that succeeds should the old one be revoked.
```

`READY_FOR_HUMAN_SMTP_PASSWORD: YES`

---

# Phase 13D-B — Live Execution

No credential value — old Gmail App Password, new Gmail App Password, `SMTP_PASS` plaintext, or the
one-time OTP code the owner used to confirm real-inbox delivery — appears anywhere below.

## AWS Credential Update

The owner ran `scripts\aws\security\Invoke-SmtpCredentialRotation.ps1 -Execute` **themselves, in
their own terminal** — Claude's own PowerShell tool runs with a non-interactive, null-device stdin,
so it structurally cannot host the script's `Read-Host -AsSecureString` prompt. This is the correct,
intended division of responsibility for this helper, not a workaround: the human types the Gmail App
Password directly into their own terminal session, and the model never has a code path through which
it could receive it.

Result reported back by the owner, sanitized metadata only: `UpdateStatus: Successful`, `RevisionId`
changed to `323f3e71-af17-4de3-864b-da6c42e1c2df`, `EnvironmentKeysFound: 10` (unchanged count),
`LastModified: 2026-10-07T13:59:02Z`. **`SMTP_PASS_UPDATED: YES`. `MODEL_SAW_NEW_SMTP_PASS: NO`**
throughout.

## Config Preservation

**PASS.** Verified via safe metadata-only queries against the live, post-rotation Lambda: all 10
environment variable **names** present and unchanged (`JWT_REFRESH_SECRET`, `SMTP_PASS`,
`SMTP_PORT`, `JWT_SECRET`, `SMTP_FROM`, `SMTP_HOST`, `SMTP_USER`, `NODE_ENV`, `DATABASE_SECRET_ID`,
`INTERNAL_SERVICE_SECRET`); `SMTP_USER`/`SMTP_HOST`/`SMTP_PORT` values unchanged (these are
non-secret configuration, confirmed safe to read directly: `huytronh5@gmail.com` /
`smtp.gmail.com` / `465`); `VpcConfig` (subnets, security group, VPC ID), IAM `Role` ARN, `Runtime`,
`Handler`, `MemorySize`, `Timeout`, `Layers` all byte-identical to the pre-rotation baseline.

## SMTP Connectivity

Network started temporarily (`dev-start.ps1 -Network -Execute`) — NAT `nat-0091bbddff064a504`
reached `available`, confirmed via direct route-table inspection
(`rtb-0f743d4fd0949f9aa`: `0.0.0.0/0 → nat-0091bbddff064a504`). Aurora, Secrets Manager VPCE, all 13
DEV-pausable schedules, and `gym-partner-upload-sweep` were independently re-confirmed untouched by
this Network cycle (the Phase 12A additive/subtractive lifecycle fix held correctly here too, as in
every prior phase).

**New finding, discovered as a side effect of testing, not fixed (out of this phase's scope)**:
`POST /auth/password-reset/request` — the safest, least-invasive existing email trigger, and the
one originally planned for this test — returns **HTTP 404**. A full live route listing confirmed it
is simply not provisioned in this DEV API Gateway, the same gap pattern already found for
`PATCH /auth/me/password` before Phase 13A. The application code (`requestPasswordReset`) exists and
is presumably correct; it is just unreachable from the public API today. Pivoted to the one live,
working email-triggering route instead: `POST /auth/register`.

## Test Email

Using a Gmail "+" plus-alias of the owner's own real inbox
(`<owner's address>+smtptest13d@gmail.com`) — this simultaneously satisfies "a genuinely new,
available registration" (the application's own de-duplication logic sees it as a distinct email) and
"delivery to a real, owner-controlled recipient" (Gmail routes plus-aliased mail to the same base
inbox). `POST /auth/register` → **HTTP 202, `{"message":"OTP sent"}`**.

Confirmed via Auth Lambda CloudWatch (not just the HTTP response): `{"level":30,"msg":"OTP email
sent"}` — the exact log line `email.service.ts`'s `sendOtpEmail` only emits *after* a successful
`transporter.sendMail()` call completes without throwing. **Zero error-level log entries** in the
same window. The owner independently confirmed real-world deliverability by reporting the actual
one-time code they received in their own inbox (not reproduced in this report).

**`SMTP_AUTH: PASS`. `EMAIL_SEND: PASS`.**

## Old Credential Revocation

Per the brief's own required checkpoint, execution stopped here pending explicit owner action. The
owner confirmed: **"OLD GMAIL APP PASSWORD REVOKED"** — the old Gmail App Password was revoked in
the Google Account, the new one left active.

## Final Test

One more `POST /auth/register` call, a second distinct plus-alias
(`<owner's address>+smtptest13d2@gmail.com`), performed *after* the old credential was already
revoked — **HTTP 202, `{"message":"OTP sent"}`**, confirmed again via CloudWatch
(`{"level":30,"msg":"OTP email sent"}`, zero error-level entries). Since the old credential no longer
exists at this point, a successful send here is only possible if the deployed Auth Lambda is
genuinely using the **new** credential — this is the strongest available proof the rotation fully
took effect, not merely that the update API call succeeded.

**`SMTP_AUTH_AFTER_OLD_REVOCATION: PASS`. `EMAIL_SEND_AFTER_OLD_REVOCATION: PASS`.
`NEW_RUNTIME_ERRORS: 0`** across both test windows.

## Continuous Test Session State (final)

Network stopped afterward (`NAT: 0`, independently reconfirmed). Final state, Backend never
stopped at any point in this phase:

| Resource | State |
|---|---|
| Aurora | `available` |
| Secrets Manager VPCE | `active` |
| NAT | `0` |
| 13 DEV-pausable schedules | `ENABLED` |
| `gym-partner-upload-sweep` | `DISABLED` (untouched) |

Not a cost leak — an explicitly owner-authorized continuous test session. Final frozen-state
certification remains deferred until the session is explicitly ended.
