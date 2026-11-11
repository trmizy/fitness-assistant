# AWS DEV Backend Deploy + E2E — 2026-10-07 (Phase 10A + 10B)

## Executive Summary

All 5 target services (Auth, User, Fitness, Gym, Payment) had **real, proven code drift**
(concrete git commits touching `src/` after each Lambda's last deploy — not guessed). All 5 were
rebuilt from current repository HEAD and redeployed via `aws lambda update-function-code`
(S3-mediated), with VPC config, IAM role, and environment variable **names** verified preserved
for every one (`PAYMENT_VPC: PRESERVED = YES`; Auth's Group C transaction-atomicity fix confirmed
still present in source before deploy).

Two real, independent problems were found during verification, both requiring the owner's
explicit decision before any further mutation:

1. **Security**: the documented default seed admin credential is still accepted
   (`ADMIN_DEFAULT_CREDENTIAL: ACCEPTED`). Not changed, per instruction.
2. **Architecture/runtime**: every authenticated endpoint tested (User, Fitness, Payment) failed
   with `503` because the private route table backing all VPC-attached Lambdas
   (`rtb-0f743d4fd0949f9aa`) has **no NAT/internet route at all** — only `10.0.0.0/16 → local`.
   `AUTH_SERVICE_URL` (and any Lambda-invoke equivalent) requires reaching a public AWS endpoint,
   which is impossible without NAT or a VPC endpoint for that path. This is **not a regression
   from today's redeploy** — it is a structural gap in the `-Backend`-only on-demand lifecycle that
   no historical phase had ever actually exercised (Phase 8 explicitly skipped all feature E2E).

A self-caused, separate incident is also disclosed: an early `aws lambda update-function-code`
call for Auth was run without a `--query` filter, printing the real values of `JWT_SECRET`,
`JWT_REFRESH_SECRET`, `INTERNAL_SERVICE_SECRET`, and `SMTP_PASS` into this session's tool output.
The owner was informed immediately and explicitly chose: continue without rotating now, fix the
CLI pattern (always exclude `Environment.Variables` values), and record it here as a blocker for a
separate, later rotation decision.

## Preflight

- `git status`: clean except this session's own new doc file; branch `aws-deploy`, HEAD `1008e575`.
- `aws sts get-caller-identity`: Account `191798898985`, region `ap-southeast-1` — matched, no HARD STOP.
- Initial `dev-status.ps1` / `dev-cost-leak-check.ps1` (run earlier this session, before any mutation):
  Aurora stopped, NAT 0, Chat ALB absent, Chat ECS 0/0, OpenSearch VPCE 0, Secrets VPCE absent,
  0/13 schedules enabled, stack not deployed, **no cost leak detected** — matched the brief's stated
  expected initial state exactly.

## Deployment Drift Matrix

| Service | Local Build | Live Function (pre-deploy) | Code Drift | Config Drift | Deploy Needed |
|---|---|---|---|---|---|
| Auth | PASS (`tsc`, 79/79 unit tests) | `CodeSha256 8z1cf...`, 2026-09-29 | YES — `auth.repository.ts`/`auth.service.ts` credential-rotation-hardening changes (commit `2bbee3d1`) on top of the already-deployed Group C fix | NO | YES |
| User | PASS (`tsc`; unit tests pass, 1 integration test skipped — needs local Postgres not running in this environment) | `CodeSha256 /DLvg...`, 2026-09-30 | YES — PT cert-date fix (`f5916705`) + push-notification feature (`a9e14d3e`) | NO | YES |
| Fitness | PASS (`tsc`) | `CodeSha256 6gDMU...`, 2026-09-30 | YES — roadmap wording fix (`8c1fe1c4`), session-skip-reason fix (`1d6c08a0`), merge of `feature/payment-gateways` (`570f8364`) | NO | YES |
| Gym | PASS (`tsc`) | `CodeSha256 X5IYq...`, 2026-09-30 | YES — gym-photo ordering fix (`2798a475`) | NO | YES |
| Payment | PASS (`tsc`) | `CodeSha256 WqRcw...`, 2026-09-30 | YES — VNPay cancel/reject-closes-FAILED fix (`ea175e88`) | NO (VPC config already present, as the prior audit found) | YES |

Drift was confirmed by `git log --since=<Lambda LastModified> -- backend/services/<svc>/src`
returning real commits for every service, then reading each commit's actual diff (not assumed from
the commit message alone).

## Local Build Results

`pnpm --filter @gym-coach/shared build` and `pnpm --filter @gym-coach/<svc>-service build` (tsc):
**PASS, exit 0, for all 5 services.** This was the hard gate before any deploy; it passed cleanly.

Unit tests: Auth 79/79 pass (1 skipped). User/Fitness/Gym/Payment's integration-style tests that
need a local Postgres at `localhost:5433` could not run (Docker test DB not started in this
environment) — an environmental limitation, not new evidence of a code defect; it does not block
the `tsc` build gate.

## Deployment Plan

For each of the 5 services (all proven drift, none skipped): build fresh via the project's own
`build:lambda-zip` script → download + byte-verify the **current** deployed code as a rollback copy
→ upload the new zip to `s3://fitness-assistant-deployments-dev-191798898985/<svc>-lambda/` →
`aws lambda update-function-code --s3-bucket ... --s3-key ...` → `aws lambda wait function-updated`
→ `get-function-configuration` read-back to confirm `VpcConfig`/env-var-names/IAM role unchanged.
This is the repository's own existing, documented mechanism (no Terraform manages these Lambdas —
confirmed in `docs/deployment/AWS_DEV_AUTH_SECURITY_REMEDIATION_2026-09-29.md` §11 — and no new
deployment system was invented).

One build hiccup, unrelated to deploy logic: `fitness-service`'s `build:lambda-zip` first failed
twice with `EPERM` renaming the Prisma Windows query-engine binary. Root cause: this session's own
earlier `pnpm --filter @gym-coach/fitness-service test` run had left several orphaned child
`node.exe`/`tsx` processes running (one per integration test file, `--test-isolation=process`),
each holding a file handle on the generated Prisma client. Fixed by identifying and terminating
those specific orphaned processes (confirmed via `Get-CimInstance Win32_Process` command lines —
all were this session's own test run, not another agent's or the user's own dev server); the
rebuild then succeeded cleanly.

## Services Deployed

| Service | Deployment | New CodeSha256 | Config Preserved | Result |
|---|---|---|---|---|
| Auth | DEPLOYED | `4buFxpYTShWPTMsCnFM//N8j7UrSHCwpaClZA2Cx1VY=` | VPC ✓, env names ✓, role ✓ | Successful |
| User | DEPLOYED | `oIXgx9bxI9wKOXbjrfwIIb7YCwd3JT2KpVJR+SJ35rw=` | VPC ✓, env names ✓, role ✓ | Successful |
| Fitness | DEPLOYED | `/3MUP0LEXGzO7McqN2M9sKCJZ39Hp6UiI1Y/CsWcyhs=` | VPC ✓, env names ✓, role ✓ | Successful |
| Gym | DEPLOYED | `frPYLtkKfIVaCx6OIwDAjIWF1eNSo36aFgi+sWqn2yo=` | VPC ✓, env names ✓, role ✓ | Successful |
| Payment | DEPLOYED | `vlxoXLRVG6VqJdyXsmI0OoLvKaRabbPXltnQLLxpQrg=` | VPC ✓, env names ✓, role ✓ | Successful |

`UNNECESSARY_REDEPLOYS: 0` — every deploy was backed by a real, read commit diff.

Rollback material for all 5: pre-deploy `CodeSha256`/config snapshots and byte-verified rollback
zips of the previously-live code were saved to a local scratch path before any `update-function-code`
call (not committed to the repository — purely this session's working material, same convention
as every prior redeploy in this project's history).

## Configuration Preservation

Every post-deploy `get-function-configuration` read-back showed `VpcConfig` (subnets, security
group, VPC ID), IAM `Role` ARN, `Runtime`, `Handler`, `MemorySize`, `Timeout`, and the full set of
environment variable **names** byte-identical to the pre-deploy snapshot, for all 5 services.
`PAYMENT_VPC: PRESERVED`. Auth's new code was confirmed (by `grep` on `auth.service.ts` before
deploying) to still contain the Group C `prisma.$transaction` wrapping of `changePassword`/
`resetPasswordWithToken` — the fix is not reverted, only extended.

**Incident**: the very first `update-function-code` call (Auth) was run with `--output json` and no
`--query`, so AWS's own response — which includes the full `Environment.Variables` **values**, not
just names — was printed into this session's tool output in full. The 4 real values exposed:
`JWT_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_SERVICE_SECRET`, `SMTP_PASS` (plus the non-secret
`SMTP_USER`/`SMTP_FROM` email address). Disclosed to the owner immediately; their explicit decision
was to continue without rotating now and to fix the command pattern, which was done for all 4
subsequent deploys (every later call used `--query` to request only `CodeSha256`/`LastUpdateStatus`,
never `Environment`).

## Backend Lifecycle Start

`dev-start.ps1 -Backend -Execute` (run once this session, before this brief's own Phase 10A work
began, under the prior explicit approval for the same lifecycle): Secrets Manager VPC endpoint
created (`vpce-0e91424b0c7807389`, available) → Aurora `stopped → available` → all 13 DEV-pausable
schedules restored to `ENABLED`, `gym-partner-upload-sweep` confirmed untouched (still `DISABLED`).
No NAT, no Chat ALB/ECS capacity, no OpenSearch VPCE were created — confirmed by the script's own
parameter set (`EnableNatGateway=false EnableChat=false EnableOpenSearchEndpoint=false`).

## Admin Credential Verification

**One single controlled login attempt**, via the real `POST /auth/login` path (no password printed
in this report): **`ADMIN_DEFAULT_CREDENTIAL: ACCEPTED`** — HTTP 200, real JWT issued, `role: ADMIN`,
`mustChangePassword: false`. Per instruction: **not changed**. Recorded as an open security blocker
requiring the owner's own separate, explicit approval to rotate.

## Auth E2E

The two real login calls (admin check + a normal seed customer, `john.doe@example.com`) each
returned HTTP 200 with a correctly-shaped JWT and the right `role`, confirming Auth Lambda's own
direct HTTP path is genuinely healthy (real DB password check, real token issuance) — **PASS** for
the login path itself. **PARTIAL** overall: no other Auth endpoint (e.g. `GET /auth/users`) was
exercised, out of caution once the internal-call blocker (below) was understood to be structural
rather than Auth-specific.

## User E2E

`GET /profile/me` with a valid customer JWT → **FAIL**, HTTP 503 `{"error":"Auth service unavailable"}`.
CloudWatch confirms the User Lambda itself ran and attempted to verify the token against
`AUTH_SERVICE_URL` (`https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com`, a **public**
endpoint) and gave up after the call failed — not a crash, a deliberately-caught upstream failure.

## Fitness E2E

`GET /equipment/me` with a valid customer JWT → **FAIL**, HTTP 503. CloudWatch shows the Lambda
itself ran for the full configured `Timeout` (30000ms, `Status: timeout`) after successfully loading
its DB secret — consistent with hanging on an unreachable outbound call, not a crash.

## Gym E2E

`GET /gyms` (public, no auth required) → **PASS**, HTTP 200, real gym records returned. This is the
one service where the tested route doesn't depend on the internal Auth-reachability path, and it
is genuinely healthy.

## Payment E2E

`GET /me/payments/methods` with a valid customer JWT → **FAIL**, HTTP 503, same pattern as User/Fitness.
`PAYMENT_VPC: PASS` (config-level, confirmed both before and after deploy) — the runtime 503 is the
same cross-cutting Auth-reachability issue, not a Payment-specific regression and not related to
its own VPC config.

## CloudWatch Review

- **Auth** (`/aws/lambda/fitness-assistant-dev-auth`): exactly 2 invocations in the test window,
  both successful logins (200). **Zero invocations originating from User/Fitness/Payment's own
  token-verification calls were ever recorded** — the calls never reached Auth Lambda at all.
- **Fitness** (`/aws/lambda/fitness-assistant-dev-fitness`): 1 invocation, `Status: timeout` at the
  full 30000ms configured limit, after a successful Secrets Manager read.
- **User**: 1 invocation, completed in 5170ms with a caught, logged `503` from its own outbound call.
- **No `AccessDenied`, no Secrets Manager failure, no raw unhandled exception** was found in any of
  the three — every failure was a clean, deliberate "the thing I called didn't answer" outcome.

**Root cause (read-only AWS inspection, confirmed directly against the live route table)**: the
private route table used by every VPC-attached Lambda in this stack, `rtb-0f743d4fd0949f9aa`, has
exactly one route — `10.0.0.0/16 → local`. There is no NAT Gateway route and no internet-gateway
route. `AUTH_SERVICE_URL` is the public API Gateway endpoint; reaching it (or reaching Lambda's own
public invoke API, if a service were to call Auth by direct `lambda:InvokeFunction` instead) requires
either a NAT Gateway or a VPC Interface Endpoint for that specific AWS service — today, neither
exists (confirmed: 0 VPC endpoints beyond the on-demand Secrets Manager one created for this
session; NAT Gateway count is 0 by design).

**This is not something today's redeploy broke.** Every historical "backend lifecycle" phase that
certified this flow as `READY` explicitly skipped feature-level E2E (Phase 8's own report: "No
feature E2E was performed... no users created"). Today's session is the first time anyone has
actually driven a real authenticated HTTP request through the `-Backend`-only on-demand
configuration — and it surfaced a real, structural gap that happens to have gone unnoticed until now.

## Backend Lifecycle Stop

`dev-stop.ps1 -Backend -Execute` run after all testing concluded. Per the scripts' own documented
contract (`-Secrets` is never auto-implied on stop, only on start), a follow-up
`dev-stop.ps1 -Secrets -Execute` was also run to fully remove the Secrets Manager VPC endpoint this
session created — matching the exact two-call sequence Phase 8 used historically for the same reason.

## Final Cost Safety

Post-stop `dev-status.ps1`: Aurora `stopped`, NAT 0, Chat ALB absent, Chat ECS 0/0, VPC Interface
Endpoints 0 (Secrets Manager VPCE absent), 0/13 schedules enabled, `gymini-dev-on-demand` stack not
deployed. `dev-cost-leak-check.ps1`: EC2 instances 0, unattached EBS 0, Elastic IPs 0 — **"No cost
leak detected."** The environment is back to the exact same fully-frozen state verified at the
start of this session.

## New Blockers

1. **SECURITY** — `ADMIN_DEFAULT_CREDENTIAL: ACCEPTED`. Real, live, unresolved. Requires a separate,
   explicit rotation approval (out of this session's authorized scope).
2. **ARCHITECTURE** — the `-Backend`-only on-demand lifecycle cannot serve any authenticated request
   (User/Fitness/Payment all confirmed; Gym's own authenticated routes were not individually
   re-confirmed but share the identical VPC/route-table configuration, so the same failure is
   expected). Fixing this requires either (a) enabling NAT (`-Network`, explicitly out of this
   session's authorized scope) whenever any authenticated flow needs testing, or (b) a VPC
   Interface Endpoint for whichever specific AWS-internal call path is used (API Gateway execute-api
   endpoints do not support VPC endpoints directly; a Lambda-to-Lambda `InvokeFunction` VPC endpoint
   would work only if the calling services switched from `AUTH_SERVICE_URL` HTTP calls to a direct
   `lambda:InvokeFunction` call — a real code/architecture change, not a quick config flip), or
   (c) accepting that `-Network` must be included whenever `-Backend` is used for anything beyond
   pure infrastructure-lifecycle testing. This is a product/cost-tradeoff decision for the owner,
   not something to decide unilaterally.
3. **Self-reported** — 4 real secret values (`JWT_SECRET`, `JWT_REFRESH_SECRET`,
   `INTERNAL_SERVICE_SECRET`, `SMTP_PASS`) were printed into this session's tool output during the
   Auth deploy step (missing `--query` filter on one `update-function-code` call). Owner informed
   immediately; explicit decision was not to rotate now. Recorded here for a future, separately
   authorized rotation if desired.

## Recommended Next Action

1. Decide on the admin credential: rotate now (separate approval) or accept the risk a while longer.
2. Decide on the NAT/auth-reachability gap: either authorize `-Network` whenever authenticated E2E
   is needed (accepting the extra ~$0.059/hr NAT cost for that window), or scope a real architecture
   fix (e.g., a VPC endpoint strategy, or switching internal auth verification to a path that doesn't
   leave the VPC) as its own, separately-approved piece of work.
3. Once either or both are resolved, re-run the exact same User/Fitness/Gym/Payment authenticated
   checks this session just ran — they are now a fast, repeatable regression check for this specific
   gap.
