# AWS DEV — Emergency Cost Audit

Date: 2026-10-01. Account `191798898985`, region `ap-southeast-1`. **Read-only audit — no AWS resource was started, stopped, deleted, or modified.**

## Executive Summary

This account is **PAID** with **$0.20 USD** remaining in promotional credits (confirmed via `aws freetier get-account-plan-state`). September 2026's real infrastructure usage cost **$147.84 gross**, almost entirely offset by credits (**-$147.84**, net ≈ $0.00) — exactly matching the "$0.00 shown after credits" the owner observed. AWS's own forecast for October (`aws ce get-cost-forecast`) is **$139.33**, matching the owner's console figure to the cent. With only $0.20 of credit left, **this $139+/month will become real out-of-pocket spend almost immediately.**

Three cost categories — **Aurora Serverless v2** ($57.92), **NAT Gateway** ($42.42 of $45.51 "EC2-Other"), and **VPC Interface Endpoints + public IPv4 fees** ($34.13) — account for **$137.56 of the $147.84 total (93%)**. None of these three scale with actual feature usage; they are flat, always-on infrastructure charges. A single unattached 20GB EBS volume ($2.39/mo) and a Chat ALB with zero healthy backend targets ($5.22/mo and rising) are pure waste with no functional benefit today.

## Account Plan State

```
aws freetier get-account-plan-state (us-east-1)
  accountId: 191798898985
  accountPlanType: PAID
  accountPlanStatus: ACTIVE
  accountPlanRemainingCredits: 0.20 USD
```

## Credits / Billing State

September 2026, `RECORD_TYPE` breakdown (1 Cost Explorer call):

| Record type | Amount (USD) |
|---|---|
| Usage | 147.8420075533 |
| Credit | -147.8420073087 |
| Tax | 0.00 |
| **Net** | **≈ 0.00** |

This is the exact mechanism behind the "$0.00 current charge" the console shows — credits are covering gross usage almost to the exact cent. With $0.20 left, that offset is about to end.

## Current Month Cost

September 2026 gross usage by service (`RECORD_TYPE=Usage` filter, 1 Cost Explorer call), **>$0.001 only**:

| Service | Cost (USD) | % of total |
|---|---|---|
| Amazon Relational Database Service (Aurora) | 57.9242 | 39.2% |
| EC2 - Other | 45.5126 | 30.8% |
| Amazon Virtual Private Cloud | 34.1326 | 23.1% |
| Amazon Elastic Load Balancing | 5.2168 | 3.5% |
| AWS Secrets Manager | 2.3871 | 1.6% |
| Amazon Elastic Container Service | 1.3312 | 0.9% |
| Amazon Route 53 | 1.0000 | 0.7% |
| AWS Cost Explorer | 0.2000 | 0.1% |
| Amazon ECR | 0.0776 | <0.1% |
| Amazon API Gateway | 0.0461 | <0.1% |
| Amazon S3 | 0.0138 | <0.1% |
| **Total** | **147.84** | **100%** |

Daily trend, last 14 days (gross Usage only): stabilized around **$3.86–4.78/day** recently (was $5.44–6.65/day earlier in the window, dropping after Aurora was stopped mid-period) — consistent with a steady fixed-infrastructure cost, not a one-time spike.

## Cost Forecast

```
aws ce get-cost-forecast (Oct 1 - Nov 1 2026, UNBLENDED_COST, MONTHLY)
  Total: $139.325695... ≈ $139.33
```

**Matches the owner's console figure exactly.** This forecast implicitly assumes current infrastructure keeps running and no further credits are applied — i.e., this is what will actually be billed in October if nothing changes and the $0.20 remaining credit is consumed almost immediately.

## Top Cost Drivers

1. **Aurora Serverless v2 (ACU-hours)**: $55.60 of the $57.92 RDS total — the cluster has been running (not stopped) for most of the month.
2. **NAT Gateway hourly charge**: $42.42 — a single NAT Gateway, running continuously since **2026-08-27** (confirmed `CreateTime`), at ~$0.059/hr × ~730hrs ≈ matches exactly.
3. **VPC Interface Endpoint hourly charges**: $28.47 — 2 endpoints × 2 AZs each, running most/all of the month.
4. **Public IPv4 "in use" address fees**: $5.66 — 3 Elastic IPs (AWS's Feb-2024 public-IPv4 pricing change applies regardless of whether the IP sits on a NAT Gateway or an ALB).
5. **Chat ALB**: $5.22 — created **2026-09-22**, so only ~9 days of this month's charge; a full month would be roughly 3x higher (~$15–18/mo) once it includes a full billing period.

Combined, **NAT Gateway + VPC Endpoints + their associated EIPs ≈ $76.5 (52% of total spend)** — pure "always-on networking," unrelated to how much the app is actually used.

## RDS / Aurora

```
aws rds describe-db-clusters fitness-assistant-dev-aurora
  Status: stopped                 (at time of this audit)
  Engine: aurora-postgresql, EngineMode: provisioned
  ServerlessV2ScalingConfiguration: MinCapacity 0.5, MaxCapacity 2.0
  AllocatedStorage: 1 GB
  BackupRetentionPeriod: 7 days
  DeletionProtection: false
  Members: fitness-assistant-dev-aurora-instance-1 (writer, db.serverless, status: stopped)
```

- **CURRENTLY_CHARGING? NO** (right now, at audit time) — but this is temporary. AWS Aurora auto-restarts a stopped cluster after **7 days** (observed directly in this engagement: it auto-restarted mid-session on a previous occasion). The $55.60 ACU-hour charge this month proves it was running for most of September before being stopped recently.
- **Can stop? YES** — manual stop is a normal, safe RDS operation.
- **Would stopping preserve data? YES** — stopping ≠ deleting; storage and all data persist; only compute (ACU-hours) stops billing.
- **Would AWS automatically restart it later? YES** — after 7 days of being stopped, confirmed from this engagement's own prior history. This means "stop Aurora" is not a one-time action; it requires a recurring manual re-stop (or a scheduled automation) every week to actually stay frozen.
- **Deletion protection: disabled** — a real risk if anyone ever runs a careless `delete-db-cluster`; recommend enabling this regardless of the cost-freeze decision (a safety setting, not a cost one — not actioned here, read-only audit).

## NAT Gateway

```
aws ec2 describe-nat-gateways
  nat-025b2c37935815d6d | available | subnet-0f1a5fcd6ed0401ee | vpc-010c13afd8920c8f1 | created 2026-08-27
  Associated EIP: eipalloc-08694ce526e3345b8
```

Exactly **1 NAT Gateway**, `AVAILABLE`, running continuously for the entire audit period.

Route table `rtb-0f743d4fd0949f9aa` routes through this NAT for 2 subnets: `subnet-02b39d77762465ef8` and `subnet-09e3230f7bca04c8e` — confirmed (cross-referenced against prior sessions' Lambda `VpcConfig`) to be the exact 2 subnets **every VPC-attached Lambda in this account uses** (all 16 `fitness-assistant-dev-*` functions). These Lambdas depend on this NAT Gateway for any outbound call to a service that does **not** have its own VPC endpoint — concretely, **Bedrock Runtime and the direct Anthropic API** (no VPC endpoint exists for either; only Secrets Manager and OpenSearch Serverless do — see VPC Endpoints below). Deleting this NAT Gateway today would break Bedrock/Anthropic connectivity for every AI Lambda.

- **HOURLY_COST_DRIVER: YES** — $42.42/month, the single largest non-Aurora line item.
- **SAFE_TO_DELETE_AFTER_TESTING: CONDITIONAL** — safe only after confirming nothing (now or in the near-term Bedrock-fallback plan) still needs outbound internet from inside the VPC. Given the just-completed Bedrock discovery work (`AWS_DEV_BEDROCK_MODEL_DISCOVERY_2026-09-30.md`) identified a possible Anthropic-direct-API fallback, **this NAT Gateway is a hard prerequisite for that exact fallback to work** — deleting it would block the one low-risk AI path currently available.

## ALB

```
aws elbv2 describe-load-balancers
  fitness-assistant-dev-chat-alb | active | internet-facing | application | created 2026-09-22
```

Target group: 0 registered targets expected given ECS below (not re-verified target-by-target in this pass since ECS `desiredCount=0` makes it structurally certain; see the September Phase-4 Chat audit for the explicit empty-target-group confirmation this exact engagement already captured).

- **CHAT_ALB: IDLE_BUT_CHARGING.** An Application Load Balancer bills a flat hourly rate **plus LCU usage** regardless of whether it has zero healthy targets — it is charging the full idle rate right now for a service that cannot serve a single real request.

## ECS

```
aws ecs describe-services fitness-assistant-dev-chat-service
  desiredCount: 0, runningCount: 0, pendingCount: 0, status: ACTIVE
```

**Zero running Fargate tasks.** No other ECS services exist in the account/region (`list-services` returned exactly this one ARN). Fargate itself is not currently accruing any compute charge — the $1.33 ECS line item this month is residual from whenever the service last actually ran a task (pre-dating the current `desiredCount=0` state). **No active Fargate billing right now.**

## EC2-Other

```
APS1-NatGateway-Hours          42.4210   (NAT Gateway hourly — see above)
APS1-EBS:VolumeUsage.gp2        2.3900   (the unattached 20GB volume — see below)
APS1-NatGateway-Bytes           0.6426   (NAT data processing)
APS1-DataTransfer-Regional-Bytes 0.0590
```

EC2-Other is **primarily NAT Gateway** (93% of this line), not EBS or data transfer — directly confirmed via `USAGE_TYPE`, not guessed.

**EC2 instances: 0.** **EBS volumes: 1**, `vol-0c0a7abcb61186356`, 20 GB gp2, **State: `available` (unattached to anything)** — pure waste, matching this engagement's own earlier-documented finding of an orphaned volume. **Elastic IPs: 3**, all currently associated (1 to the NAT Gateway's ENI, 2 to the ALB's ENIs based on creation-date/cost-timing correlation — $5.66 public-IPv4 charge for ~9 days of 2 EIPs + a full month of 1 EIP matches this split almost exactly).

| Resource | Classification |
|---|---|
| EBS `vol-0c0a7abcb61186356` (20GB, unattached) | **POTENTIALLY_WASTED** — attached to nothing, zero functional value |
| EIP on NAT Gateway | REQUIRED (while NAT exists) |
| 2 EIPs on Chat ALB | REQUIRED while ALB exists, otherwise WASTED (ALB itself is idle) |

## VPC Endpoints

```
aws ec2 describe-vpc-endpoints
  vpce-063c1b646aa3de049 | Interface | com.amazonaws.ap-southeast-1.secretsmanager | available
  vpce-067d43742cdb6b4d4 | Interface | com.amazonaws.vpce.ap-southeast-1.vpce-svc-02fb9435bff6076bb | available
```

The second endpoint's opaque service name was resolved via `opensearchserverless list-vpc-endpoints`: it is **`fitness-dev-opensearch-vpce`**, the OpenSearch Serverless VPC endpoint. **Exactly 2 Interface endpoints, both across 2 AZs (4 ENI-hours/hour billed)** — matches the measured $28.47/month almost exactly (2 endpoints × 2 AZs × ~$0.01/hr × ~730hrs ≈ $29.20).

| Endpoint | Classification |
|---|---|
| Secrets Manager (`vpce-063c1b646aa3de049`) | **REQUIRED** — every Lambda reads its DB credentials from Secrets Manager; without this endpoint, that traffic would need to route through the NAT Gateway instead (adds load/cost there, doesn't eliminate it) |
| OpenSearch Serverless (`vpce-067d43742cdb6b4d4`) | **OPTIONAL in the short term** — the collection behind it (`fitness-assistant-dev-ai-vectors`) shows **zero real usage this month** (see OpenSearch section) since Bedrock-backed RAG has never successfully run end-to-end yet. Removing this endpoint has no functional impact until AI/RAG features actually go live. |

**Side effect discovered**: both VPC endpoints auto-created a **private Route 53 hosted zone** each (`ap-southeast-1.opensearch.amazonaws.com.` and `ap-southeast-1.aoss.amazonaws.com.`), which is the exact, complete explanation for the **$1.00 Route 53 charge** (2 zones × $0.50/zone/month, AWS's standard hosted-zone fee) — there is **no custom application domain**, confirming this engagement's earlier finding that no Route53 zone for the app itself exists. These 2 zones are tied to and will disappear automatically with their owning VPC endpoints.

## OpenSearch

```
aws opensearch list-domain-names        → [] (no classic OpenSearch domains)
aws opensearchserverless list-collections → 1 collection: "fitness-assistant-dev-ai-vectors" (ACTIVE)
aws opensearchserverless list-vpc-endpoints → 1 endpoint: "fitness-dev-opensearch-vpce" (ACTIVE)
```

**NOT `NONE_FOUND`** — a real OpenSearch Serverless collection exists and is active. However, **it does not appear anywhere in the September cost breakdown** (searched explicitly for `opensearch`/`aoss` in the full 20-service list — zero matches). This is consistent with near-zero real indexing/query activity so far (matches the engagement-wide finding that the AI Worker/RAG pipeline has essentially never completed a real, successful run — Bedrock access has been `NOT_AUTHORIZED` this whole time). **Latent risk, not a current cost driver**: once Bedrock access is granted and real AI usage begins, OpenSearch Serverless OCU-based billing will start accruing and should be re-measured.

## Secrets Manager

9 secrets, metadata only (no values read):

```
fitness-assistant/dev/database, user-database, fitness-database, gym-database,
payment-database, ai-database, chat-database, chat-database-url,
internal-service-secret
```

$2.39/month — a small, real, flat-rate cost (~$0.40/secret/month, standard AWS pricing), not material to the overall picture. 2 of these (`chat-database`, `chat-database-url`) exist solely to support the currently-idle Chat feature.

## CloudWatch

34 log groups total; **27 have no retention policy set (logs never expire)**. Total stored data across all log groups: **38.3 MB** — negligible today (matches the $0.00 CloudWatch line in Cost Explorer). **Not currently material to cost**, but the lack of retention limits is a latent risk: unbounded growth over months/years would eventually become a real, avoidable storage+ingestion cost. (Not fixed here — this is a configuration recommendation, not a stop/delete action, and changing retention policy was not in this audit's read-only scope to execute regardless.)

## S3

6 buckets, all project-related, none inspected for sensitive object contents:
```
fitness-assistant-data-migration-dev-191798898985
fitness-assistant-deployments-dev-191798898985
fitness-assistant-frontend-dev-191798898985
fitness-assistant-tfstate-191798898985
fitness-assistant-uploads-dev-191798898985
fitness-assistant-vectors-dev-191798898985
```
$0.0138/month total across all 6 — **not material** to the current cost picture at this project's scale.

## Lambda

16 functions, all named `fitness-assistant-dev-*`, all **VPC-attached** (same VPC, same 2 subnets), 1024 MB memory uniformly, timeouts ranging 30s–900s depending on role (API handlers at 30s, migration/jobs Lambdas up to 900s). No reserved concurrency found on any (all share the account's small unreserved pool, per the prior Bedrock/AI audit's own finding of `UnreservedConcurrentExecutions: 10`). **Lambda itself shows $0.00 in the September cost breakdown** — idle/low-volume invocation cost is not material here, consistent with this being a DEV environment with light traffic. **Do not recommend deleting any Lambda to save cost** — there is no meaningful idle cost to save, and deleting one would require a full redeploy to recover.

## API Gateway

$0.0461/month — **not material**. The HTTP API itself has no fixed hourly charge; cost is purely per-request, and request volume this month has been light.

## SQS / EventBridge

2 SQS queues (`fitness-assistant-dev-ai-tasks` + its DLQ) — SQS has no fixed/idle charge, pay-per-request only, and shows no distinct line in the cost breakdown (bundled under negligible "free tier" usage). **Zero EventBridge rules exist in the account** — confirmed, not a cost item, and also confirms (consistent with prior audits in this engagement) that the architecture's documented "EventBridge Scheduler" component is not actually provisioned today.

## Bedrock Historical Cost

**$0.00.** No Bedrock line item appears anywhere in September's cost breakdown. This is fully consistent with the parallel finding (`AWS_DEV_BEDROCK_MODEL_DISCOVERY_2026-09-30.md`, same date) that every Bedrock model in this account is `NOT_AUTHORIZED` — no successful invocation has ever been billed, because none has ever been possible. **No inference credits were spent in this audit either** (none were invoked, per the hard rule).

## Safe Freeze Candidates

Resources with no identified functional dependency on keeping them running right now:
- Unattached EBS volume `vol-0c0a7abcb61186356` (20GB) — zero downside.
- Chat ALB + its 2 EIPs — zero real traffic possible (ECS desiredCount=0), pure cost with zero current benefit.
- OpenSearch Serverless VPC endpoint — zero real usage so far; AI/RAG is already blocked by Bedrock authorization regardless, so this endpoint currently serves no live traffic.
- Aurora, if actively and continuously kept stopped (requires a recurring manual/automated re-stop every ~7 days due to AWS's auto-restart behavior).

## Do Not Touch

- **Aurora cluster/instance itself (deletion)** — contains the full, previously-migrated production-like dataset (7 logical databases) that took substantial dedicated effort to restore earlier in this engagement. Only start/stop is reversible; deletion is not, without a very recent snapshot and significant restore effort.
- **Secrets Manager secret values** — required for every service to function at all; metadata-only was inspected, values never touched.
- **S3 `deployments`/`tfstate`/`frontend` bucket contents** — deployment artifacts and Terraform state (if used); deleting breaks the ability to redeploy or reconcile infrastructure state.
- **NAT Gateway, without a replacement plan** — deleting it today would break outbound Bedrock/Anthropic connectivity for every Lambda, including the one low-risk AI fallback path (`LLM_PROVIDER=anthropic`) identified in the parallel Bedrock discovery audit.
- **Secrets Manager VPC endpoint** — every Lambda's DB credential retrieval depends on it; removing it without keeping the NAT Gateway (as an alternative route) would break the entire application.
- **IAM roles/policies, VPC/subnets/route tables themselves** — all **free** (zero line-item cost); touching them has rebuild risk with zero cost-saving benefit.

## Cost Freeze Plan (PREPARED ONLY — NOT EXECUTED)

### Priority 0 — immediate, no functional loss, no dependency risk
1. **Delete unattached EBS volume** `vol-0c0a7abcb61186356`.
   `aws ec2 delete-volume --volume-id vol-0c0a7abcb61186356 --region ap-southeast-1` — **PREPARED_ONLY — DO NOT EXECUTE**
   Effect: -$2.39/mo. Dependency impact: none (confirmed unattached). Rollback: none possible once deleted (it's already empty/unattached, so there is nothing to "recover" — if this was meant to hold something, that intent is already lost, not caused by this action).

### Priority 1 — safe to STOP without data loss
2. **Keep Aurora stopped** (it already is, at audit time) and re-stop it every time it auto-restarts (AWS restarts it automatically after 7 days — this requires a recurring action, e.g. a scheduled check, not a one-time command):
   `aws rds stop-db-cluster --db-cluster-identifier fitness-assistant-dev-aurora --region ap-southeast-1` — **PREPARED_ONLY — DO NOT EXECUTE** (also note: it is already stopped as of this audit, so there is nothing to execute right now — this is a standing instruction for whenever it next auto-restarts)
   Effect: removes ~$55.60/mo in ACU-hour charges as long as it stays stopped. Data loss: none. Recovery: `start-db-cluster`, same data, same endpoint.

### Priority 2 — requires DELETE to eliminate hourly charges (real architecture decisions)
3. **Delete the Chat ALB** (and its listener/target group) if Chat remains deferred:
   `aws elbv2 delete-load-balancer --load-balancer-arn <arn-of-fitness-assistant-dev-chat-alb> --region ap-southeast-1` — **PREPARED_ONLY — DO NOT EXECUTE**
   Effect: -$5.22/mo (and rising to an estimated ~$15-18/mo at a full month's rate). Dependency: none while ECS desiredCount=0. Recovery: re-create ALB + listener + target group + re-point API Gateway's `/chat/{proxy+}` HTTP_PROXY integration at the new ALB DNS name (a real, non-trivial but well-documented rebuild from this engagement's own prior Chat deployment work).
4. **Delete the OpenSearch Serverless VPC endpoint** `vpce-067d43742cdb6b4d4` if AI/RAG stays paused:
   `aws opensearchserverless delete-vpc-endpoint --id vpce-067d43742cdb6b4d4 --region ap-southeast-1` — **PREPARED_ONLY — DO NOT EXECUTE**
   Effect: -~$14.2/mo (half of the $28.47 VPC endpoint total). Side effect: also removes the auto-created `ap-southeast-1.aoss.amazonaws.com.` private hosted zone (-$0.50/mo more). Dependency: the AI worker's RAG evidence retrieval would lose its OpenSearch connection entirely (it already cannot succeed today due to Bedrock being blocked, so no additional functional loss right now). Recovery: re-create the VPC endpoint; collection data itself is untouched (OpenSearch Serverless storage, not the endpoint, holds the actual indexed vectors).
5. **Delete the NAT Gateway** `nat-025b2c37935815d6d` — **only if** the Anthropic-direct fallback is also abandoned and no Lambda needs any internet-bound call that isn't covered by a VPC endpoint:
   `aws ec2 delete-nat-gateway --nat-gateway-id nat-025b2c37935815d6d --region ap-southeast-1` — **PREPARED_ONLY — DO NOT EXECUTE**
   Effect: -$42.42/mo + -$0.64/mo (NAT data) + releases its EIP once disassociated (-$3.65/mo more) ≈ **-$46.7/mo combined**, the single largest possible saving in this account. Dependency: **breaks all outbound internet from every VPC-attached Lambda** — including the Anthropic-direct Bedrock fallback, and any future external API integration. This is the highest-impact, highest-risk item in the entire plan; recommend deciding this only after the Bedrock/Anthropic-fallback path is itself decided.
6. **Release the 2 EIPs** currently on the Chat ALB, after step 3: `aws ec2 release-address --allocation-id <id> --region ap-southeast-1` (×2) — **PREPARED_ONLY — DO NOT EXECUTE**. Effect: included in step 3's estimate above (the $5.66 public-IPv4 line item is split across these + the NAT's EIP).

### Priority 3 — low-cost, worth keeping for easy resume
- All 16 Lambda functions (near-zero idle cost; deleting any saves nothing meaningful and costs real redeploy effort).
- API Gateway, SQS queues, S3 buckets, Secrets Manager secrets — all individually negligible; keep as-is.
- Recommend (config-only, not a stop/delete, not executed here): set an explicit retention period (e.g. 14-30 days) on the 27 no-retention CloudWatch log groups, to cap future growth before it becomes material.

### Priority 4 — do NOT touch (see "Do Not Touch" above)
- Aurora cluster deletion, Secrets Manager values, S3 artifact contents, IAM, VPC/subnet/route-table structures, the Secrets Manager VPC endpoint (unless NAT is kept as its replacement route).

## Three Cost Scenarios

### A. CURRENT STATE — everything remains running as today
Main cost sources: Aurora (if it auto-restarts and stays up) + NAT Gateway + both VPC endpoints + Chat ALB (now a full month) + Secrets Manager + Route 53.
**Approximate monthly impact: $139.33** (AWS's own forecast, directly observed — not fabricated).
Trade-off: zero operational effort, full feature availability (modulo the separate Bedrock authorization blocker), but the full fixed-infrastructure bill applies even though AI features can't function yet and Chat has zero real traffic.

### B. DEV FROZEN — keep Lambda / API Gateway / S3 / IAM / config; stop or delete the expensive, recoverable compute+network items
Removed: NAT Gateway + its EIP (-$46.7 using the precise figures above, pending the fallback-path decision in item 5), OpenSearch Serverless VPC endpoint (-$14.2), Chat ALB + its 2 EIPs (-$5.22 at current partial-month rate, more at a full month), unattached EBS (-$2.39), Aurora kept continuously stopped (-$55.60).
Kept: Secrets Manager (+2.39), Secrets Manager VPC endpoint (~$14.2, now load-bearing since NAT is gone — this one must stay if NAT goes, or Secrets retrieval breaks entirely), Route 53's remaining 1 zone tied to that endpoint (~$0.50), Lambda/API Gateway/S3/SQS (near $0).
**Approximate monthly impact: roughly $17-20**, calculated directly from the real per-item costs above (Secrets Manager $2.39 + its VPC endpoint ~$14.2 + Route 53 ~$0.50 + negligible remainder) — **an ~85-88% reduction from $139.33**.
Trade-off: **Bedrock/Anthropic connectivity is lost** (no NAT, no Bedrock VPC endpoint exists today) — the one viable AI fallback path identified in the parallel discovery audit would need its own VPC endpoint added first, or NAT kept specifically for it. Chat requires a full ALB+listener+target-group rebuild to resume. Aurora requires a manual/scheduled re-stop every ~7 days to actually stay frozen (AWS's own auto-restart behavior), and a `start-db-cluster` (single command, no data loss) whenever DEV work resumes.

### C. MINIMUM PRESERVATION — keep only what's needed to rebuild DEV later
Removed: everything in scenario B, **plus** the NAT Gateway (no fallback-path exception), the Secrets Manager VPC endpoint, and (after an explicit final snapshot — not taken in this audit, requires separate approval) the Aurora cluster itself.
Kept: S3 buckets (artifacts/config/uploads data), Secrets Manager secret *values* (small flat fee), IAM roles/policies (free), Lambda function code (already in S3 deployment artifacts + their own small storage), a final Aurora snapshot (storage-only billing, no compute).
**Approximate monthly impact: UNKNOWN precisely, but low — roughly $3-6**, dominated by Secrets Manager ($2.39) + S3 storage (negligible at this scale) + Aurora snapshot storage (depends on snapshot size, not measured — **UNKNOWN**, would need an actual snapshot to be created to know its exact storage cost).
Trade-off: **largest rebuild effort of the three** — resuming DEV requires re-creating the NAT Gateway, both VPC endpoints, the Aurora cluster (restore-from-snapshot), the Chat ALB stack, and re-verifying every Lambda's VPC networking end-to-end. This is a multi-hour, multi-step rebuild, not a single command, and was not rehearsed or scripted in this audit.

## Recovery Considerations

Actions that would be **destructive and require a real rebuild plan before being recommended as an immediate step**:
- Deleting the Aurora cluster (destroys the migrated dataset unless a verified-restorable snapshot exists first — not created in this audit).
- Deleting the NAT Gateway without first deciding the Bedrock/Anthropic fallback's networking needs (would silently break that one viable AI path along with everything else needing outbound internet).
- Deleting Secrets Manager secrets (breaks every Lambda's DB connectivity immediately, zero grace period).
- Deleting S3 bucket contents (loses deployment artifacts/Terraform state/uploaded user content depending on which bucket).
- Deleting the VPC/subnets/route tables themselves (would invalidate every Lambda's networking, the Aurora cluster's subnet group, and the ALB's subnet associations simultaneously — total architecture rebuild, zero cost benefit since these are free resources).

None of the above were performed or recommended as an immediate action in this report.

## Final Recommendation

Given $0.20 in credits remain and real spend will start accruing within the current billing cycle: **Priority 0 (delete the unattached EBS volume) and Priority 2's ALB removal (item 3) are the lowest-risk, highest-confidence actions** — both target resources with zero current functional value (nothing attached, zero healthy targets respectively). The NAT Gateway and OpenSearch VPC endpoint decisions (items 4-5) should wait for an explicit decision on the Anthropic-fallback plan from the parallel Bedrock audit, since deleting either forecloses that path. Aurora should be kept stopped as a standing policy, with awareness that it will silently auto-restart after 7 days and needs to be re-stopped (ideally via a small scheduled automation rather than manual tracking — not built in this audit).

---

## Final response (as requested)

**ACCOUNT PLAN: PAID**

**CREDITS: $0.20 USD remaining**

**MONTH-TO-DATE GROSS AWS USAGE (September): $147.84**

**MONTH-TO-DATE CREDITS (September): -$147.84**

**MONTH-TO-DATE NET (September): ≈ $0.00**

**FORECAST (October): $139.33**

**TOP 5 COST DRIVERS:**
1. Aurora Serverless v2 (ACU-hours) — $57.92
2. NAT Gateway (hourly + data) — $45.51 (incl. unattached EBS $2.39)
3. VPC Interface Endpoints + public IPv4 fees — $34.13
4. Chat ALB (idle, 0 healthy targets) — $5.22
5. Secrets Manager (9 secrets) — $2.39

**AURORA: STOPPED (at audit time) / MATERIAL_COST** (will auto-restart within 7 days per AWS's own documented behavior and this engagement's own prior observation)

**NAT: 1 active / MATERIAL_COST**

**ALB: 1 active / IDLE_BUT_CHARGING**

**ECS: 0 running tasks**

**OPENSEARCH: present** (1 Serverless collection, ACTIVE, $0 cost so far — no real usage yet)

**VPC INTERFACE ENDPOINTS: 2**

**SAFE TO STOP:**
- Aurora (as a standing policy — requires recurring re-stop every ~7 days)

**SAFE TO DELETE AFTER REVIEW:**
- Unattached EBS volume (20GB) — zero downside
- Chat ALB + its 2 Elastic IPs — zero functional loss while ECS stays at desiredCount=0
- OpenSearch Serverless VPC endpoint — zero functional loss while Bedrock access stays blocked

**KEEP:**
- Lambda functions, API Gateway, S3 buckets, SQS queues, Secrets Manager secrets (all individually negligible cost)
- Secrets Manager VPC endpoint (becomes load-bearing if NAT Gateway is ever removed)

**DO NOT TOUCH:**
- Aurora cluster deletion (data loss risk — only start/stop is safe)
- NAT Gateway, until the Anthropic/Bedrock fallback networking decision is made
- Secrets Manager values, S3 artifact/Terraform-state contents, IAM, VPC/subnet structure itself

**Ước tính hạ tầng chi phí cố định có thể loại bỏ/đóng băng MÀ KHÔNG mất dữ liệu người dùng/database**: khoảng **$46.7–60/tháng** (NAT Gateway + EIP liên quan, nếu quyết định bỏ fallback Anthropic) cộng thêm **~$14.2/tháng** (VPC endpoint OpenSearch) cộng **~$5.2+/tháng** (Chat ALB) cộng **$2.39** (EBS mồ côi) — tổng khoảng **$68–82/tháng có thể đóng băng ngay mà không đụng tới dữ liệu Aurora hay bất kỳ secret/S3 nào**, đưa chi phí từ **$139.33 xuống còn khoảng $57-70/tháng nếu CHỈ làm phần này** (chưa tính dừng hẳn Aurora). Nếu cộng thêm việc giữ Aurora ở trạng thái dừng liên tục (không mất dữ liệu, chỉ cần `start-db-cluster` khi cần dùng lại), tổng chi phí có thể giảm xuống còn khoảng **$17-20/tháng** (kịch bản B ở trên) — giảm **~85-88%** so với mức hiện tại, toàn bộ dữ liệu vẫn nguyên vẹn.

## Final verdict

```
AWS_DEV_COST_STATE:
URGENT_FREEZE_RECOMMENDED
```

($0.20 credit remaining + $139.33/month forecasted real spend = this will become actual out-of-pocket cost almost immediately. No AWS mutation was performed in this audit — all figures above are PREPARED_ONLY recommendations awaiting explicit owner approval.)
