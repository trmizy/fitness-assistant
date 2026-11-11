# AWS DEV — NAT On-Demand Migration (Phase 2)

Date: 2026-10-01. Account `191798898985`, region `ap-southeast-1`. **Real AWS mutations performed — scoped strictly to NAT Gateway / EIP / private default route.** Chat, OpenSearch, Aurora, Lambda, API Gateway, S3, Secrets Manager, IAM, ECS, database content and Bedrock were never touched, per the task's explicit forbidden list — all independently re-verified unchanged at the end (Step 13 below).

Builds on `docs/deployment/AWS_DEV_ON_DEMAND_INFRA_DESIGN_2026-10-01.md` (Phase 1 design) and `docs/deployment/AWS_DEV_EMERGENCY_COST_AUDIT_2026-10-01.md`.

## Summary

The existing manually-created NAT Gateway was migrated into the `gymini-dev-on-demand` CloudFormation stack's lifecycle, proven once by a full create→verify→delete→verify cycle, then left in the **frozen** (deleted) state. Future sessions recreate it with `dev-start.ps1 -Network -Execute` and tear it down with `dev-stop.ps1 -Network -Execute`.

## Old NAT (removed)

| Field | Value |
|---|---|
| NAT Gateway ID | `nat-025b2c37935815d6d` |
| EIP allocation | `eipalloc-08694ce526e3345b8` (public IP `3.1.207.168`) |
| Subnet | `subnet-0f1a5fcd6ed0401ee` |
| Route (removed from) | `rtb-0f743d4fd0949f9aa`, `0.0.0.0/0` |
| Created | 2026-08-27T05:39:01Z (manually, outside CloudFormation) |
| Full pre-deletion capture | `docs/deployment/evidence/nat-pre-migration-2026-10-01.json` (NAT, EIP, ENI, route table, public subnet — all raw AWS CLI JSON, no secrets) |

## New (temporary, CloudFormation-managed) NAT — created and then deleted in this same session

| Field | Value |
|---|---|
| Stack | `gymini-dev-on-demand`, template `infra/cloudformation/dev-on-demand.yaml` |
| Parameters used | `EnableNatGateway=true`, `EnableChat=false`, `EnableOpenSearchEndpoint=false` |
| NAT Gateway ID | `nat-0afa42cd593423aed` (confirmed different from the old ID) |
| EIP allocation | `eipalloc-028401c892c126268` (public IP `54.255.74.91`) |
| Subnet | `subnet-0f1a5fcd6ed0401ee` (correct — same public subnet as before) |
| CloudFormation ownership | Confirmed via `describe-stack-resources`: `NatEip`/`NatGateway`/`PrivateDefaultRoute`, all `CREATE_COMPLETE`, tagged `aws:cloudformation:stack-name=gymini-dev-on-demand` |
| Create time | 2026-10-01, this session (stack reached `CREATE_COMPLETE`) |
| Delete time | 2026-10-01, this session (stack reached `DELETE_COMPLETE`) |

## CloudFormation stack lifecycle (this session)

1. `dev-start.ps1 -Network -Execute` → `aws cloudformation deploy` → **CREATE_COMPLETE**.
2. Outputs read: `NatGatewayId=nat-0afa42cd593423aed`, `NatPublicIp=54.255.74.91`.
3. `dev-status.ps1` run while thawed → `NAT Gateways (any): 1 available/pending`, `gymini-dev-on-demand stack: CREATE_COMPLETE`, Aurora/Chat/OpenSearch all unchanged.
4. `dev-stop.ps1 -Network -Execute` → `aws cloudformation delete-stack` + `wait stack-delete-complete` → **DELETE_COMPLETE**.
5. Post-delete `describe-stacks` on `gymini-dev-on-demand` returns `ValidationError: Stack ... does not exist` — fully removed.

## Route validation

- **Before:** `rtb-0f743d4fd0949f9aa` had `0.0.0.0/0 → nat-025b2c37935815d6d` (re-read immediately before deletion, matched the design report exactly).
- **During migration:** old route deleted (`aws ec2 delete-route`); route table verified to still exist with only the `10.0.0.0/16 → local` route; new stack's `PrivateDefaultRoute` resource then added `0.0.0.0/0 → nat-0afa42cd593423aed`; both private app subnets (`subnet-09e3230f7bca04c8e`, `subnet-02b39d77762465ef8`) confirmed still associated to this same route table throughout.
- **After final freeze:** `rtb-0f743d4fd0949f9aa` contains only the `10.0.0.0/16 → local` route — no NAT route, exactly as expected for the frozen state.

## Final frozen state (independently verified, not just via script output)

| Check | Result |
|---|---|
| Available/pending NAT Gateways | `0` |
| CFN-created NAT EIP (`eipalloc-028401c892c126268`) | Released — `DescribeAddresses` returns `InvalidAllocationID.NotFound` |
| Old NAT EIP (`eipalloc-08694ce526e3345b8`) | Released — `DescribeAddresses` returns `InvalidAllocationID.NotFound` |
| Private route table `rtb-0f743d4fd0949f9aa` | Only `10.0.0.0/16 → local`, no `0.0.0.0/0` route |
| Aurora | `stopped` (never started, never modified) |
| Chat ALB | `active` — **UNCHANGED**, not touched this phase (deferred cost item, documented in the Phase 1 cost audit) |
| Chat ECS | `desired=0 running=0` — **UNCHANGED** |
| OpenSearch Serverless VPC endpoint (`vpce-067d43742cdb6b4d4`) | `available` — **UNCHANGED** |
| Secrets Manager VPC endpoint (`vpce-063c1b646aa3de049`) | `available` — **UNCHANGED**, persistent as designed |
| 2 remaining Elastic IPs (`122.248.219.75`, `18.136.221.87`) | Both associated, untagged — confirmed to be the Chat ALB's own dual-AZ public addresses, pre-existing and unrelated to this NAT migration |

## Cost leak check (after freeze)

`dev-cost-leak-check.ps1` run after the freeze returned exit code 1 (leaks detected), but the leaks found are **all pre-existing, known, deferred items outside this phase's scope**, not regressions from this migration:

```
Aurora status:                    stopped          -> OK
NAT Gateways available/pending:   0                -> OK
Chat ALB state:                   active           -> KNOWN_DEFERRED_COST (unchanged by this phase)
Chat ECS desired/running:         0/0               -> OK
VPC Interface Endpoints:          2 (Secrets Manager expected; OpenSearch one flagged "verify intended" -> KNOWN_DEFERRED_COST, unchanged by this phase)
Unattached EBS volumes:           1 (vol-0c0a7abcb61186356) -> KNOWN_DEFERRED_ITEM, pre-existing, unrelated to NAT
```

This migration's own scope (NAT) shows zero leak. The script correctly does not distinguish "leak I just introduced" from "leak that was already there" — that interpretation is made here, consistent with the task's Step 14 instruction not to classify the whole migration as failed over later-phase cost items.

## Errors encountered

None. Every step (route delete, NAT delete, EIP release, stack deploy, stack delete) succeeded on the first attempt. No rollback was required.

## Rollback actions taken

**None required.** The CloudFormation NAT create path succeeded cleanly; the manual-recreation rollback procedure described in the original task was not invoked.

## Scripts changed

- `scripts/aws/dev-start.ps1` — real execution wired for `-Network -Execute` only (deploys the stack, reads outputs, verifies NAT/route). `-Execute` combined with `-Chat`/`-Ai` is refused with a hard stop. Aurora start remains print-only in every mode — never automated. Dry-run behavior (no `-Execute`) unchanged and re-verified.
- `scripts/aws/dev-stop.ps1` — real execution wired for `-Network -Execute` only (new `-Network` switch added; deletes the stack, waits for `DELETE_COMPLETE`, verifies NAT absence). `-Execute` without `-Network` is refused. The Chat-ECS-desiredCount precondition check now hard-stops (not just prints a warning) if nonzero. Aurora stop remains print-only in every mode.
- Both scripts re-parsed with `PSParser` (0 errors) and dry-run-tested before any real execution; both were then run for real in this session with verified correct behavior at every step.

## Evidence

- `docs/deployment/evidence/nat-pre-migration-2026-10-01.json` — full old NAT/EIP/ENI/route-table/subnet capture, taken immediately before deletion.

---

## Final response (as requested)

- **OLD_MANUAL_NAT_REMOVED: YES** (`nat-025b2c37935815d6d`, confirmed `deleted`)
- **OLD_EIP_RELEASED: YES** (`eipalloc-08694ce526e3345b8`, confirmed `NotFound` on describe)
- **CFN_NAT_CREATE_TEST: PASS** (stack reached `CREATE_COMPLETE`, new NAT `nat-0afa42cd593423aed` reached `available`, owned by CloudFormation, confirmed via `describe-stack-resources`)
- **NEW_ROUTE_TEST: PASS** (`rtb-0f743d4fd0949f9aa`'s `0.0.0.0/0` route correctly pointed at the new NAT while thawed; both private app subnets remained associated throughout)
- **CFN_NAT_DELETE_TEST: PASS** (stack reached `DELETE_COMPLETE`; NAT, route and EIP all independently confirmed absent/released afterward)
- **FINAL_AVAILABLE_NAT_COUNT: 0**
- **AURORA: STOPPED** (never started, never modified, as required)
- **CHAT: UNTOUCHED** (ALB `active`, ECS `0/0` — identical before and after this phase)
- **OPENSEARCH: UNTOUCHED** (VPC endpoint `available` throughout, policy never touched)
- **COST_LEAK_CHECK:** NAT-related leak = none (0 NAT gateways). 3 pre-existing, out-of-scope leaks remain and are expected: Chat ALB active, OpenSearch VPC endpoint present, 1 unattached EBS volume — all `KNOWN_DEFERRED_COST`/`KNOWN_DEFERRED_ITEM`, not caused by or part of this phase.
- **DEV_START_NETWORK: READY** (`dev-start.ps1 -Network -Execute` proven live, end-to-end, in this session)
- **DEV_STOP_NETWORK: READY** (`dev-stop.ps1 -Network -Execute` proven live, end-to-end, in this session)
- **ROLLBACK_REQUIRED: NO**

**NAT_ON_DEMAND: READY**

**NEXT_RECOMMENDED_PHASE: CHAT_RECONNECT** — the API Gateway integration re-point (`ebe69nj` → new ALB DNS) and the frontend's hardcoded `VITE_CHAT_WS_URL` are the next concrete, scoped piece of unfinished reconnect automation (per the Phase 1 completeness matrix), and are lower-risk to prove next than OpenSearch's network-policy update, since Chat has no vector-search data-availability concern — a failed reconnect just means Chat is briefly unreachable, not a silent data-access outage like OpenSearch's would be.

**HARD STOP after reporting. Not continuing into Chat or OpenSearch automatically.**
