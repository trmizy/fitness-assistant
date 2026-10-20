# DEV CD unlock and first real Lambda artifact - 2026-10-16

## Authorized scope and current result

The owner authorized adoption unlock, PLAN and DEV release verification.
APIGW_ADOPTION_COMPLETE was set to the string true through the GitHub repository
variables API at 2026-10-16 14:47:02 UTC (21:47:02 Asia/Saigon).
The value was read back successfully. Protected environments were not weakened.

Infrastructure PLAN passed preflight and is WAITING for reviewer trmizy in
GitHub environment dev-infra-plan. No change set has been created by that run yet.
https://github.com/trmizy/fitness-assistant/actions/runs/38918565343

## Adoption evidence (REAL HTTP/API)

Fresh AWS reads confirmed account 191798898985, stack UPDATE_COMPLETE, and the
same-day drift result IN_SYNC at 2026-10-16 14:36:49 UTC. Filtering resource drifts
for MODIFIED or DELETED returned zero. This closes the stale-drift evidence gap in
the preceding activation report; it does not add the known out-of-baseline routes.

A fresh route-parity run returned 119 MATCH, 10 known SOURCE_ONLY, zero
GATEWAY_ONLY and zero MISMATCHED. The previous ownership check established
254/254 baseline resources managed by CloudFormation.

A fresh deployed-template read compared against the source template using the
existing semantic guard returned NO_SEMANTIC_CHANGE. A no-op PLAN is therefore
expected, but only the pending CloudFormation PLAN can establish its actual result.

Baseline HTTP /health returned 200. Auth Lambda state Active / last update Successful.
Chat ECS desiredCount=0 and runningCount=0; its intentionally OFF state is preserved.

## Real build defect and correction

The first explicitly requested auth build failed, unlike earlier successful
impact-only/no-artifact runs:
https://github.com/trmizy/fitness-assistant/actions/runs/38918569638

pnpm 8 computed its relative modulesDir across the Windows runner's C: temporary
directory and D: checkout. That produced an invalid absolute path joined inside
backend/services/auth-service and ENOENT during deploy dependency staging.
The pnpm implementation confirms modulesDir is derived using path.relative.

Commit ae7dfbaa sets TEMP and TMP to runner.temp only for the packaging step.
This keeps staging on the checkout drive without altering production service code
or broadening permissions. Repository hygiene and diff checks passed.
Node 20 was checked directly and supports the CRC32 function; no Node change was needed.

## Artifact evidence (REAL HTTP/API)

The corrected auth build completed successfully and uploaded its artifact:
https://github.com/trmizy/fitness-assistant/actions/runs/38919328412

- Source commit: ae7dfbaa94d2c67e90213659ab264f81802c8f39
- Artifact ID: 12053728827
- Inner Lambda ZIP size: 12858859 bytes
- ZIP SHA-256: a4621ff98b2dbbc859b2598cd2cefbf29b982654b8177a283c8e1e412ee11478
- Downloaded ZIP hash matches its manifest.
- Manifest service auth and sole target fitness-assistant-dev-auth checked.
- dist/lambda.js and the RHEL OpenSSL 3 Prisma engine present; no .env files packaged.

## Pending review and next execution

Lambda auth dry-run was dispatched with build_run_id=38919328412, services=auth,
dry_run=true. It queues behind PLAN under the shared gymini-dev-deploy lock:
https://github.com/trmizy/fitness-assistant/actions/runs/38919830068

The owner must review the PLAN run in GitHub (Review deployments, dev-infra-plan,
Approve and deploy). The environment requires reviewer trmizy and disables admin
bypass. No review was submitted automatically on the owner's behalf.
After PLAN completes, the queued Lambda dry-run requires the dev environment review.

No infrastructure APPLY or real Lambda/ECS code deployment has occurred in this
phase. No migration, scheduler mutation, secret change or lifecycle toggle occurred.
No APPLY should be dispatched for a confirmed no-op. Actual release smoke tests,
OIDC mutation permissions and Chat deployment remain unverified until those real
runs are reviewed and executed; activation/build success is not a full CD verification.
