# AWS DEV Admin Default Credential Remediation — 2026-10-07 (Phase 13A)

No old password, new password, JWT, refresh token, or secret value appears anywhere in this report
— only HTTP status codes, booleans, and the account's role name.

## Initial Security Risk

The seeded DEV admin account (`admin@example.com`) still accepted its historical default password
as of Phase 10/11 (`ADMIN_DEFAULT_CREDENTIAL: ACCEPTED`). The project's own supported remediation —
`PATCH /auth/me/password` — existed in source but could not be reached: the route was never
provisioned in this DEV environment's API Gateway.

## Password Route Source Review

Traced the full implementation chain, no behavior inferred:

- `auth.routes.ts:26` — `router.patch("/me/password", authController.changePassword)`. No
  `router.use(authMiddleware)` wraps this route; authentication is handled manually.
- `auth.controller.ts::changePassword` — extracts the bearer token via `getBearerToken(req)` (401 if
  absent), validates the body against `changePasswordSchema`, calls
  `authService.changePassword(token, body)`, writes a `PASSWORD_CHANGE` audit log row.
- `changePasswordSchema` (zod) — requires `currentPassword` (non-empty) and `newPassword` (minimum 8
  characters). No additional complexity rule.
- `auth.service.ts::changePassword` — re-verifies the token itself (`this.verifyToken(token)`,
  independent of any API Gateway authorizer), loads the user, `bcrypt.compare`s the current password
  (401 if wrong), rejects if the new password equals the old one, then in a single Prisma
  **transaction**: hashes and writes the new password, and deletes every refresh token row for that
  user (`authRepository.deleteRefreshTokensByUserId`). `updateUserPasswordById` also clears the
  `mustChangePassword` flag as part of that same write — confirmed by the code's own comment, not a
  separate step.

This is the exact, already-reviewed Group C transaction-atomicity pattern from earlier in this
engagement — reused here, not re-implemented.

## API Gateway Gap

A full listing of every `/auth/*` route actually provisioned on `fitness-assistant-dev-api`
(`id1iz7upbl`) confirmed `PATCH /auth/me/password` was absent (only `PATCH /auth/me` existed, with no
password-specific route anywhere, matching Phase 11's original finding).

## Infrastructure Change

Checked whether any infrastructure-as-code owns this API before touching anything: the repository's
only Terraform module that creates `aws_apigatewayv2_*` resources (`infra/terraform/modules/
lambda-http-api`) is instantiated in `infra/terraform/environments/dev/main.tf` **only** as a
`hello_world` bootstrap API — a different, unrelated API, not `fitness-assistant-dev-api`. No
`.tfstate` file exists for this environment. **This specific API has no managed infrastructure-as-
code source of truth.** The established, repeatedly-used precedent for modifying it is direct AWS
CLI (`apigatewayv2 create-route` + `lambda add-permission`) — the same mechanism used historically to
add the FitnessRoadmap and Gym admin-namespace routes. That precedent was followed here rather than
inventing a new deployment path.

## Route Deployment

- `aws apigatewayv2 create-route --route-key "PATCH /auth/me/password" --target integrations/mg2016a
  --authorization-type NONE` — the **same integration** already used by every other `/auth/*` route
  (including its direct sibling `PATCH /auth/me`), so no new integration was created. Result:
  `RouteId kglwdf4`, `AuthorizationType NONE` — byte-identical authorization shape to `PATCH /auth/me`.
- `aws lambda add-permission` — added one new, narrowly-scoped statement (`SourceArn: .../auth/me/
  password`) to the Auth Lambda's resource policy, matching the existing pattern of one dedicated
  permission statement per route (confirmed via `get-policy`: every other `/auth/*` route already had
  its own equivalent statement — no wildcard exists, so this one new statement was required).
- Verified live via `get-routes`, not assumed from CLI exit code: the new route resolves to the
  correct integration with the correct authorization type.
- Stage is `$default` with `AutoDeploy: true`, so no separate deploy step was needed — confirmed by
  the route working on the very next real request (see Password Change below).

## Password Change

Before touching AWS mutation for the password itself: `pnpm --filter @gym-coach/auth-service test` —
**79/79 pass** (unchanged; no source code was modified, this phase was infrastructure-only).

Backend was started (`dev-start.ps1 -Backend -Execute`) — Aurora reached `available`, Secrets Manager
VPCE active, all 13 DEV-pausable schedules `ENABLED`, `gym-partner-upload-sweep` confirmed untouched
(`DISABLED`). **Network/NAT was deliberately never started** — decided and documented *before*
execution: this flow is self-contained (client → public API Gateway → Auth Lambda → Aurora), unlike
User/Fitness/Payment's `authMiddleware`, which must reach Auth's `/auth/verify` over NAT. Phase 11
already proved `/auth/login` itself works with no NAT at all; this phase confirms the same holds for
`/auth/me/password`.

The rotation itself ran via a local-only script that never prints secret material: one login as the
account using its then-current (historical default) credential, one `PATCH /auth/me/password` call
with a freshly-generated random replacement (written only to a local scratch file, never to any
report/log/terminal output), then two verification logins. Result:

| Step | Outcome |
|---|---|
| Change request | HTTP `200` |
| Role before/after | `ADMIN` (unchanged) |

## Old Credential Verification

**One** controlled login attempt using the historical default credential, performed as part of the
same script run (not a separate uncontrolled retry):

**`OLD_DEFAULT_LOGIN: REJECTED`** (HTTP `401`).

## New Credential Verification

**One** controlled login attempt using the new credential:

**`NEW_ADMIN_LOGIN: PASS`** (HTTP `200`, `role: ADMIN`). Account remains usable; no other profile
field was touched by this change.

## Token/Session Behavior

Determined from source, not assumed:

- Access JWTs in this system are **stateless** — verified only by signature (`jwt.verify` against
  `JWT_SECRET`), with no database-backed revocation list. An access token issued *before* the
  password change therefore **remains valid until its own natural expiry** (observed ~15 minutes in
  earlier testing this engagement).
- `changePassword`'s own transaction calls `authRepository.deleteRefreshTokensByUserId`, so **every
  refresh token for this account was revoked atomically with the password hash update** — no new
  access token can be silently obtained via refresh after this point; the account's next real session
  must re-authenticate with the new password.

No token-handling redesign was performed or needed.

## CloudWatch Review

Auth Lambda (`/aws/lambda/fitness-assistant-dev-auth`), the test window: exactly 4 requests —
`/auth/login` (200), `/auth/me/password` (200), `/auth/login` with the old credential (401 — expected,
correct rejection, not an error), `/auth/login` with the new credential (200). **Zero 5xx responses,
zero error-level (level 50) log entries.**

## Shutdown

Network: never started (`NETWORK_STOP: NOT_STARTED`). `dev-stop.ps1 -Backend -Execute`: schedules
paused back to `DISABLED`, Aurora `available → stopped`. `dev-stop.ps1 -Secrets -Execute` (the
established two-call convention — `-Secrets` is never auto-implied by `-Backend` on stop): removed
the Secrets Manager VPCE, deleting the now-empty `gymini-dev-on-demand` stack.

## Cost Safety

Final `dev-status.ps1`: Aurora `stopped`, NAT `0`, Chat ALB absent, Chat ECS `0/0`, VPC Interface
Endpoints `0`, `0/13` schedules enabled, stack not deployed. `dev-cost-leak-check.ps1`: **"No cost
leak detected."** Identical to the state this environment started Phase 13A in.

## Remaining Security Risks

- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_SERVICE_SECRET`, and `SMTP_PASS` remain un-rotated —
  explicitly out of scope for this phase (Phase 13B+), per instruction.
- The other 12 non-admin seed accounts (Group B, from the earlier Phase 10/11 security review) remain
  untouched, still on their original seed password — not in this phase's scope (admin-only remediation).
- `PATCH /auth/me/password`'s new API Gateway route reuses `AuthorizationType: NONE`, matching every
  other `/auth/*` route (authentication is enforced application-side, not by API Gateway) — this is
  consistent with the existing architecture, not a new gap introduced by this change.
