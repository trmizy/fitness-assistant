# AWS DEV Security Containment + Networked Backend E2E — 2026-10-07 (Phase 11)

No plaintext secret values appear anywhere in this report.

## Security Incident

During Phase 10, one `aws lambda update-function-code` call for Auth was run without a `--query`
filter; AWS's own response included the full `Environment.Variables` map, printing the real values
of `JWT_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_SERVICE_SECRET`, and `SMTP_PASS` into that session's
tool output. Disclosed to the owner immediately; their explicit decision was to continue without
rotating at that time, fix the command pattern (done, confirmed for every later call), and revisit
rotation as its own phase — this phase.

## Secret Dependency Matrix

| Secret | Source | Consumers | Rotation Impact | Coordinated Deploy Needed |
|---|---|---|---|---|
| `JWT_SECRET` | Plain Lambda environment variable on `fitness-assistant-dev-auth` (not Secrets Manager) | **Auth Lambda only** — `auth.service.ts` (`jwt.sign`/`jwt.verify` for access tokens). Confirmed by grep: every hit is inside `auth-service/src` | All existing access tokens become invalid immediately; every logged-in user must re-login | NO — single service |
| `JWT_REFRESH_SECRET` | Same mechanism, same Lambda | **Auth Lambda only** — same file, refresh-token sign/verify | All existing refresh tokens invalid; no silent-refresh until next login | NO — single service |
| `INTERNAL_SERVICE_SECRET` | Plain Lambda environment variable, **identical value required on every consumer** | Confirmed real consumers via grep: Auth, User, Fitness, Gym, Payment, **AI-service**, **Chat-service**, plus `backend/gateway` (local/compose only, not deployed as its own Lambda in this AWS account) | Any service left on the old value while others move to the new one would reject/be rejected by every peer using it (e.g. `serviceSecret.middleware.ts`, `gatewayTrust.ts`, `fitness-service/clients/ai.client.ts`'s `x-internal-token` header) | **YES — all 7 live backend Lambdas simultaneously**, including AI and Chat |
| `SMTP_PASS` | External Gmail account app-password, configured as a plain Lambda environment variable (not Secrets Manager, not AWS-managed in any way) | Auth Lambda only (`email.service.ts`, `nodemailer` transport) | None app-side beyond Auth; the credential itself lives in a Google account this session has no access to | NO — single service, but the new value must come from the Gmail account owner |
| Admin credential (`admin@example.com` / seed default) | `bcrypt` hash in the Auth database (Aurora), set once by `prisma/seed.ts` | Auth DB row only; verified via normal login | Only the one account; supported rotation path is `PATCH /auth/me/password` (transaction-safe, confirmed in source: hashes new password, atomically revokes all existing refresh tokens for that user) | NO — single row, single service, but requires the route to exist in API Gateway (see below) |

## Rotation Actions

- **`JWT_SECRET_ROTATED: BLOCKED`** and **`JWT_REFRESH_SECRET_ROTATED: BLOCKED`** — even though the
  blast radius is a single Lambda, safely replacing just these two keys without erasing the other 8
  environment variables on `fitness-assistant-dev-auth` requires first reading the function's
  *current* full `Environment.Variables` (AWS's `update-function-configuration` call replaces the
  entire map, it does not merge). That read — even redirected straight to a local file and never
  displayed — was refused by this coding environment's own safety layer
  ("Credential Materialization"). Per the explicit instruction not to pursue a blocked outcome
  through another tool, encoding, or method, no workaround was attempted.
- **`INTERNAL_SERVICE_SECRET_ROTATED: BLOCKED`** — confirmed real, live consumers include
  `ai-service` and `chat-service`, both explicitly outside this phase's authorized scope ("This
  approval does NOT authorize: ... AI deployment; Chat deployment"). A rotation that updates 5 of 7
  consumers while leaving `ai-service`/`chat-service` on the old value would break every call
  between the "new" and "old" groups — exactly the unsafe partial-rotation state the brief's own
  Phase 11.2 instructs to avoid. Per "If coordinated update cannot be performed safely: STOP. Do not
  partially rotate it" — stopped, not attempted.
- **`SMTP_PASS_ROTATED: EXTERNAL_ACTION_REQUIRED`** — this is a third-party Gmail app-password; no
  AWS or repository mechanism can generate a replacement. The current (now-exposed) value was left
  in place rather than deleted, since removing it without a working replacement would simply break
  outbound email with no security benefit (the exposure already happened; disabling it doesn't undo
  that, it only adds an outage).

## Admin Credential Remediation

**`ADMIN_PASSWORD_ROTATED: BLOCKED`.** The project's own supported, safe mechanism exists in code —
`PATCH /auth/me/password` (`auth.controller.ts` → `auth.service.ts::changePassword`): requires the
caller's current password, hashes the new one, and atomically revokes every existing refresh token
for that user in the same DB transaction (the exact Group C hardening already verified earlier this
engagement). It was deliberately used instead of any direct database hash edit.

It could not be executed: a full listing of every `/auth/*` route actually provisioned in this
account's API Gateway (`id1iz7upbl`) confirms **no route exists for `PATCH /auth/me/password`** (nor
any password-reset route). The attempt returned HTTP 404 before reaching the application's own
logic. Verified this left no partial state: the old (known default) credential still logs in
(HTTP 200) and the freshly-generated candidate new password was correctly rejected (HTTP 401) — the
change truly never took effect.

**`ADMIN_DEFAULT_CREDENTIAL_AFTER: ACCEPTED`** — unchanged from Phase 10, since no rotation occurred.

**Proposed fix (not implemented — would need its own separate approval)**: add an API Gateway route
+ Lambda permission for `PATCH /auth/me/password` targeting `fitness-assistant-dev-auth`, the same
two-call pattern (`apigatewayv2 create-route` + `lambda add-permission`) already used historically to
add the FitnessRoadmap routes. Once that route exists, this phase's exact script
(`rotate-admin-password.mjs`, local-only, already written and tested against the 404 case) can
complete the rotation without any further investigation.

## Backend Start

`dev-start.ps1 -Backend -Execute`: Secrets Manager VPCE created → Aurora `stopped → available` → all
13 DEV-pausable schedules restored, `gym-partner-upload-sweep` confirmed untouched. **PASS.**

## Network Start

`dev-start.ps1 -Network -Execute`: NAT Gateway created (`nat-0a484b0cfa5a6c75a`), reported `available`.
**PASS.**

**Side-effect discovered and worth flagging** (not a security or cost issue, purely a script-design
note): `dev-start.ps1`/`dev-stop.ps1` compute the full desired parameter set from *only the flags
passed to that one invocation* — they never read the stack's current live parameters first. Calling
`-Network` alone, right after a separate earlier `-Backend` call had turned Secrets Manager's
endpoint on, silently redeployed the stack with `EnableSecretsManagerEndpoint=false` again (since
`-Network` doesn't imply `-Secrets`, and nothing preserved the prior `true`). The DB-touching Lambdas
kept working anyway purely because their execution environments were still warm and had already
cached their database secret in memory from an earlier invocation — had they cold-started instead,
they would have failed. This is a real, if currently harmless (this session), gap: **run `-Backend`
and `-Network` together as one `-Execute` call** (not two separate ones) whenever both are needed, or
teach the scripts to read+preserve current stack parameters before recomputing — a repository
improvement, not implemented here (no code change was in scope for this phase).

## Route Verification

Explicit `aws ec2 describe-route-tables` on `rtb-0f743d4fd0949f9aa` (not inferred from CloudFormation
success alone):

- **Before Network start**: `10.0.0.0/16 → local` only.
- **After Network start**: `10.0.0.0/16 → local` **and** `0.0.0.0/0 → nat-0a484b0cfa5a6c75a`.
- **After Network stop**: reverted to `10.0.0.0/16 → local` only.

**`PRIVATE_DEFAULT_ROUTE: PASS`** for both the creation and the reversion.

## E2E Results

| Service | API | Auth | DB | Logs | Result |
|---|---|---|---|---|---|
| Auth | `POST /auth/login` (x2, admin + customer) | n/a (issues tokens) | real password check against Aurora | 2 successful 200s, clean | **VERIFIED** |
| User | `GET /profile/me` | Bearer JWT, verified via internal `/auth/verify` call | real profile row returned | Auth Lambda shows the matching `/auth/verify` invocation | **VERIFIED** |
| Fitness | `GET /equipment/me` | same | real equipment ID list returned | same pattern | **VERIFIED** |
| Gym | `GET /gyms` (public) | none required | real gym records returned | n/a | **VERIFIED** |
| Payment | `GET /me/payments/methods` | Bearer JWT, verified via internal `/auth/verify` call | real provider-config response (VNPay/ZaloPay, each correctly marked `configured:false` with the missing-env-var reason) | same pattern | **VERIFIED** |

All 5: **PASS.**

## CloudWatch Evidence

Auth Lambda (`/aws/lambda/fitness-assistant-dev-auth`), same test window: **8 invocations total** —
4 `/auth/login`, **3 `/auth/verify`**, consistent with exactly one internal verification call each
from User, Fitness, and Payment. In Phase 10 (no NAT), the identical test sequence produced **zero**
`/auth/verify` invocations — the calls never left the calling Lambda's own private subnet.

**`INTERNAL_AUTH_REQUESTS_REACHED_AUTH: YES`** — directly evidenced by this invocation-count
comparison, not inferred.

## Network Stop

`dev-stop.ps1 -Network -Execute`: NAT Gateway removed, confirmed `0` available/pending. Because all
four on-demand flags (`EnableNatGateway`, `EnableChat`, `EnableOpenSearchEndpoint`,
`EnableSecretsManagerEndpoint`) resolved to `false` at this point (`EnableSecretsManagerEndpoint` had
already been silently reset to `false` by the earlier `-Network -Execute` *start* call — see the
side-effect note above), the script took its "all flags false" path and deleted the entire
`gymini-dev-on-demand` stack in this one step, rather than only removing the NAT resources. Net
effect on the account is identical to the originally planned sequence (fully torn down), just one
step earlier than expected. **PASS** (verified by route-table re-check: back to local-only).

## Backend Stop

`dev-stop.ps1 -Backend -Execute`: schedules paused (13 → `DISABLED`, `gym-partner-upload-sweep`
untouched), Aurora `available → stopped`. **PASS.**

A follow-up `dev-stop.ps1 -Secrets -Execute` was run per the Phase 10-established two-call
convention, and correctly reported "stack does not exist — nothing to tear down," confirming the
stack had already been fully removed during the Network-stop step above. Not a failure — the target
end state (fully frozen, zero on-demand resources) was already reached.

## Cost Safety

Final `dev-status.ps1`: Aurora `stopped`, NAT `0`, Chat ALB absent, Chat ECS `0/0`, VPC Interface
Endpoints `0` (Secrets Manager VPCE absent), `0/13` schedules enabled, `gymini-dev-on-demand` stack
not deployed. `dev-cost-leak-check.ps1`: EC2 instances `0`, unattached EBS `0`, Elastic IPs `0` —
**"No cost leak detected."** Identical to the frozen baseline this environment started and ended
Phase 10 in.

## Architecture Recommendation (documented only — not implemented this phase)

The root requirement driving today's NAT dependency: User/Fitness/Payment/Gym's `authMiddleware`
verifies a caller's JWT by making an outbound HTTP call to `AUTH_SERVICE_URL`
(`https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com/auth/verify`) — a **public** endpoint,
unreachable from a private VPC subnet without NAT or a dedicated VPC endpoint.

| Option | Security | Cost | Complexity | Failure Modes | Migration Risk |
|---|---|---|---|---|---|
| **A. Keep NAT-on-demand, enable only when authenticated E2E is needed** | Unchanged (today's model) | ~$0.059/hr NAT + ~$0.01/hr/AZ data processing only while the window is open; $0 otherwise | None — already built, already proven twice (Phase 10, Phase 11) | A forgotten "leave NAT on" window is the only real risk; `dev-cost-leak-check.ps1` already catches it | None — zero code change |
| **B. Local JWT validation** (each service verifies the token's signature itself, using `JWT_SECRET`, instead of calling Auth) | Slightly *weaker* in one respect (every service now needs the signing secret, widening `JWT_SECRET`'s blast radius exactly like `INTERNAL_SERVICE_SECRET` today) but removes a network hop entirely | Removes the NAT dependency for this path entirely — the cheapest option long-term | Real but bounded: add a shared JWT-verify helper (likely in `backend/shared`), update 4+ services' `authMiddleware`, and — critically — **coordinate a `JWT_SECRET` rollout to every consumer simultaneously**, the exact kind of multi-service rotation this phase just proved is hard to do safely | No live network call to fail; a *compromised* token is rejected everywhere the instant any one service updates, but *every* service needs the secret, so today's "rotate JWT_SECRET any time, single-service" property would be lost | Medium — real code change across every service's `authMiddleware`, needs a full regression pass (`auth-service`'s own token logic shouldn't change, just where it's checked) |
| **C. Private internal Auth endpoint** (e.g. a VPC Lambda-to-Lambda `InvokeFunction` call instead of an HTTP call to the public API Gateway URL, using a VPC interface endpoint for Lambda, or a private API Gateway endpoint) | Best of both — no network hop leaves the VPC, no secret widening | A Lambda VPC interface endpoint has its own persistent hourly charge (same category as the Secrets Manager VPCE already in this stack) — cheaper than NAT only if authenticated calls happen often enough that NAT's per-window cost would exceed it | Real: switch the 4 calling services from `AUTH_SERVICE_URL` HTTP calls to AWS SDK `lambda.invoke()` against `AUTH_LAMBDA_NAME` (already present as an env var on Fitness/Gym/Payment, interestingly — User currently uses the HTTP path instead), add the matching IAM `lambda:InvokeFunction` permissions, and provision the VPC endpoint via the existing on-demand CFN template's pattern | A misconfigured IAM permission fails closed (403), same operational shape as today's failures | Medium — touches 4 services' client code, but reuses an env var already provisioned for 3 of them |
| **D. Other (e.g. a private API Gateway endpoint)** | Comparable to C | Comparable to C (interface-endpoint pricing) | Higher — private API Gateway has its own DNS/resource-policy setup distinct from the Lambda-invoke path | Similar | Higher — a second gateway topology to maintain alongside the existing public one |

No implementation was performed for any option — this is a recommendation only, per instruction.
Option A (what this session already does) is the lowest-risk, zero-code path and is recommended as
the default until/unless authenticated E2E testing becomes frequent enough that NAT's per-session
cost outweighs a VPC-endpoint's flat monthly one.
