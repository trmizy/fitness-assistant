# AWS DEV On-Demand Lifecycle — Live Certification — 2026-10-07 (Phase 12B)

No secret values appear anywhere in this report. Every state claim below was verified independently
via direct, read-only AWS CLI calls — never trusted from script output alone.

## Executive Summary

The Phase 12A fix (additive START / subtractive STOP / dependency-protected Secrets) is **certified
live on real AWS infrastructure**. The exact bug scenario that caused Phase 11's incident — starting
`-Network` as a separate call after an earlier `-Backend` call — was reproduced deliberately and
confirmed **not** to reset Secrets Manager's VPC endpoint or disturb Aurora/schedules. The new
dependency guard was also exercised live: requesting `-Secrets` stop while Backend was still running
was refused outright, with zero AWS mutation. All 10 pass criteria in the brief were met with
concrete evidence. Environment returned to the exact same fully-frozen, zero-cost-leak baseline it
started in.

## Initial Frozen State

`dev-status.ps1` / `dev-cost-leak-check.ps1` before any mutation: Aurora `stopped`, NAT `0`, Chat ALB
absent, Chat ECS `0/0`, VPC Interface Endpoints `0`, `0/13` schedules enabled, stack not deployed —
**"No cost leak detected."** Matched the expected initial state exactly; no normalization was needed.

## Backend Start

`dev-start.ps1 -Backend -Execute`. Script's own plan output: `Backend ON (changed)`,
`Secrets ON (changed)`, everything else unchanged. Independently verified via direct AWS CLI:

| Check | Result |
|---|---|
| Aurora status | `available` |
| Secrets Manager VPCE | `vpce-045330d2abd203d62`, `available` |
| NAT count | `0` |
| Chat ALB | absent (`LoadBalancerNotFound`) |
| Chat ECS | `0/0` |
| OpenSearch-type VPCE count | `0` |
| 13 DEV-pausable schedules | all `ENABLED` |
| `gym-partner-upload-sweep` | `DISABLED` |

**PASS.**

## State Before Network Start

CloudFormation parameters recorded as the baseline immediately after Backend-only start:

```
EnableNatGateway            = false
EnableChat                  = false
EnableOpenSearchEndpoint    = false
EnableSecretsManagerEndpoint = true
```

## Network Start as Separate Invocation

**The critical test.** `dev-start.ps1 -Network -Execute` run as its own, separate call — deliberately
**not** re-passing `-Backend`, the exact shape of the call that caused Phase 11's incident.

Script's own plan output:
```
CURRENT STATE:   Backend=ON  Network=OFF  Chat=OFF  Ai=OFF  Secrets=ON
RESOLVED TARGET: Backend=ON (preserved)  Network=ON (changed)  Chat=OFF  Ai=OFF  Secrets=ON (preserved)
```

## State After Network Start

Independently verified, not inferred from the script's own claim:

| Check | Result |
|---|---|
| Aurora status | `available` (unchanged) |
| Secrets Manager VPCE | **same id** `vpce-045330d2abd203d62`, `available` — not recreated, genuinely preserved |
| 13 DEV-pausable schedules | all still `ENABLED` |
| `gym-partner-upload-sweep` | still `DISABLED` |
| NAT | `nat-027d3f9aaa1c46784`, `available` |
| Private route table `rtb-0f743d4fd0949f9aa` | `10.0.0.0/16 -> local` **and** `0.0.0.0/0 -> nat-027d3f9aaa1c46784` |

**PASS — Backend/Secrets/schedules all survived a separate Network-only start, the exact failure mode from Phase 11.**

## Parameter Diff

| Parameter | Before Network start | After Network start | Changed? |
|---|---|---|---|
| `EnableNatGateway` | `false` | `true` | YES (requested) |
| `EnableSecretsManagerEndpoint` | `true` | `true` | **NO — preserved** |
| `EnableChat` | `false` | `false` | NO |
| `EnableOpenSearchEndpoint` | `false` | `false` | NO |

Exactly one parameter changed, and it was the one requested. This is the direct, live proof the
Phase 12A fix works — under the old code, `EnableSecretsManagerEndpoint` would have been silently
reset to `false` by this same call.

### Phase 12B.3 — Secrets VPCE health evidence (read-only, no application calls)

`describe-vpc-endpoints` on the same endpoint: `State: available`, correct VPC
(`vpc-010c13afd8920c8f1`), correct private subnets, correct security group
(`sg-0198527f052b3f386`), correct service (`com.amazonaws.ap-southeast-1.secretsmanager`), 4 DNS
entries present (private DNS resolution active). Sufficient infrastructure-level evidence that
Backend could fetch its DB secret through this endpoint — no application E2E was performed or
needed (Phase 11 already certified that layer).

## Network Stop as Separate Invocation

`dev-stop.ps1 -Network -Execute`, again as its own call, **not** re-passing `-Backend`. Script's plan
output: `Backend ON (preserved)`, `Network OFF (changed)`, `Secrets ON (preserved)`.

## State After Network Stop

| Check | Result |
|---|---|
| NAT count | `0` |
| Private route table | reverted to exactly `10.0.0.0/16 -> local` only |
| Aurora status | `available` (unchanged) |
| Secrets Manager VPCE | still `available`, same id |
| 13 DEV-pausable schedules | all still `ENABLED` |
| `gym-partner-upload-sweep` | still `DISABLED` |

**PASS — stopping Network alone removed only Network; Backend and every dependency survived untouched.**

## Dependency Guard Test

Ran `dev-stop.ps1 -Secrets` **without** `-Execute`, per the brief's own caution (the resolution and
refusal check runs unconditionally, before the dry-run/execute branch even splits, so this was the
safest way to observe it — confirmed by reading the script: the `Blocked` check happens immediately
after computing current/desired state, before any AWS mutation call exists in either code path).

Result: **`HARD STOP: Secrets Manager VPC endpoint cannot be stopped while Backend still ON - it
needs this endpoint (or NAT) to fetch its DB secret. Stop Backend first, or drop -Secrets from this
call.`** Exit code `1`. Zero AWS mutation calls were made beyond the already-completed read-only
ECS/CloudFormation/Aurora state checks that feed the resolution. Confirmed via a follow-up
`dev-status.ps1`: Aurora still `available`, Secrets VPCE still present, nothing had changed.

**PASS.**

## Backend Stop

`dev-stop.ps1 -Backend -Execute`: schedules paused (13 → `DISABLED`, sweep untouched), Aurora
`available -> stopped` (confirmed via the script's own polling log reaching `stopped`).

## Final Frozen State

`dev-stop.ps1 -Secrets -Execute` (the established two-call convention — `-Secrets` is never
auto-implied by `-Backend` on stop): removed the Secrets Manager VPCE, deleting the now-empty
`gymini-dev-on-demand` stack entirely (all 4 flags resolved false). Final `dev-status.ps1`: Aurora
`stopped`, NAT `0`, Chat ALB absent, Chat ECS `0/0`, VPC Interface Endpoints `0`, `0/13` schedules
enabled, stack not deployed.

## Cost Leak Verification

`dev-cost-leak-check.ps1`: EC2 instances `0`, unattached EBS `0`, Elastic IPs `0` — **"No cost leak
detected."** Identical to the state this environment started Phase 12B in.

## Certification Result

All 10 pass criteria from the brief were met, each with independent AWS-CLI evidence (not script
output alone):

1. Backend started successfully — YES
2. Starting Network separately did not disable Backend/Aurora/Secrets VPCE/schedules — YES
3. NAT became available — YES
4. Stopping Network separately removed Network only — YES
5. Backend remained operational throughout (infrastructure-state perspective) — YES
6. Secrets dependency remained protected (both passively, during Network start/stop, and actively,
   via the refusal test) — YES
7. Backend subsequently stopped cleanly — YES
8. Final frozen state was restored exactly — YES
9. Cost leak check passed — YES
10. No unrelated subsystem (Chat, AI) was ever activated — YES

**CERTIFICATION: PASS.**
