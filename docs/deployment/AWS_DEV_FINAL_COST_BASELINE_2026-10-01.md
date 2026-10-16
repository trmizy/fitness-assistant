# AWS DEV — Final Cost Baseline & Freeze Certification (Phase 6)

Date: 2026-10-01T12:51Z. Account `191798898985`, region `ap-southeast-1`. **Read-only audit — zero AWS mutations performed.** Builds on Phases 2-5 (NAT, Chat, Chat-frontend, OpenSearch, EBS). Later reports supersede earlier ones where they conflict, per instruction.

# Executive Summary

Gymini DEV is **genuinely in a frozen, low-cost state** — confirmed live, not assumed. `dev-cost-leak-check.ps1` returns **"No cost leak detected"** for the first time in this engagement. The three previously-identified on-demand infrastructure pieces (NAT, Chat ALB, OpenSearch VPCE) are all confirmed `0`, each individually proven to freeze/thaw correctly in its own phase. The one orphaned EBS volume is deleted. **The frozen state is not $0/month** — it carries a real, evidence-based fixed baseline of **≈$18-19/month**, dominated almost entirely by one resource: the Secrets Manager VPC Interface Endpoint (≈$14.60/month), which is deliberately `PERSISTENT_KEEP` because every Lambda-in-VPC needs it to reach Secrets Manager without NAT. This single resource alone is close to the account's own `fitness-assistant-monthly` $15/month budget — worth the owner's attention even though no action is proposed here. AI end-to-end remains blocked by Bedrock account authorization, a cause **entirely separate** from and unaffected by this cost-optimization work.

# Frozen State

Verified live (not from memory of prior phases):

| Resource | Expected | Live result |
|---|---|---|
| Aurora (`fitness-assistant-dev-aurora`) | stopped | **stopped** (AllocatedStorage 1 GiB) |
| NAT Gateways | 0 | **0** |
| Chat ALB (`fitness-assistant-dev-chat-alb` / `dev-chat-alb`) | absent | **absent** (both possible names checked) |
| Chat ECS (`fitness-assistant-dev-chat-service`) | 0/0 | **desired=0, running=0**, service `ACTIVE` (not deleted) |
| OpenSearch collection (`fitness-assistant-dev-ai-vectors`) | ACTIVE | **ACTIVE**, `standbyReplicas: ENABLED`, `deletionProtection: ENABLED` |
| OpenSearch on-demand VPCE | absent | **absent** (`list-vpc-endpoints` → empty) |
| OpenSearch public access | false | **false** |
| Secrets Manager VPCE | present | **present**, `available` |
| Unattached EBS | 0 | **0** |
| EC2 instances | 0 | **0** |

**FROZEN_STATE: PASS.**

# Live Billable Inventory

Exact current resources, not service-name generalities:

| Category | Current resources |
|---|---|
| RDS/Aurora | 1 cluster (`fitness-assistant-dev-aurora`, stopped, 1 GiB, `aurora-postgresql 17.7`, 7-day backup retention); 2 automated cluster snapshots |
| Secrets Manager | 9 secrets (`fitness-assistant/dev/{database,user-database,fitness-database,gym-database,payment-database,ai-database,chat-database,chat-database-url,internal-service-secret}`) |
| S3 | 6 buckets, ≈774 MB total (`deployments` 688.7 MB, `data-migration` 76.5 MB, `frontend` 6.5 MB, `uploads` 2.4 MB, `tfstate` 61 KB, `vectors` — 0 objects) |
| ECR | 2 repositories (`fitness-assistant-dev-db-migrator`, `fitness-assistant-dev-chat`) |
| CloudWatch Logs | 34 log groups total; 28 are Gymini's own (`/aws/lambda/fitness-assistant-dev-*`, `/ecs/fitness-assistant-dev-*`); several have **no retention policy set** (`RetentionDays: null` — never expires); 6 are unrelated (`/QuickStart/...`, `/aws/Quick_Start/HybridDNS-...` — a different AWS QuickStart deployment debris, out of scope) + 2 orphaned (`dc-common-lambda-auto-start/stop` — functions no longer exist, unrelated naming, negligible bytes) |
| Route 53 | **0 hosted zones** (September's $1.00 charge is historical only — zone no longer exists) |
| Elastic IPs | **0** |
| Interface VPC Endpoints | **1** (Secrets Manager only — OpenSearch's is correctly gone) |
| OpenSearch Serverless | 1 collection, `ACTIVE`, `VECTORSEARCH` type, `standbyReplicas: ENABLED`, `ServerlessVectorAcceleration: ENABLED`; **0 VPC endpoints** |
| EBS volumes/snapshots | **0 volumes, 0 snapshots** |
| ALBs/NLBs | **0** |
| NAT Gateways | **0** |
| ECS/Fargate | 1 cluster (`fitness-assistant-dev-cluster`), 1 service (`chat-service`, 0 running tasks) |
| EC2 | **0 instances** |
| CloudFront | **none** (confirmed, no distribution ever configured) |
| API Gateway | 1 HTTP API (`id1iz7upbl`, `fitness-assistant-dev-api`) |
| Lambda | 16 functions, all `fitness-assistant-dev-*`, 1024 MB each, **no provisioned concurrency anywhere** (checked) |
| SQS | 2 queues (`fitness-assistant-dev-ai-tasks` + its DLQ) |
| EventBridge Scheduler | **13 schedules** (12 `ENABLED`, 1 `DISABLED`), all targeting `fitness-assistant-dev-*-jobs` Lambdas — **these fire on a timer regardless of frozen state** (see Remaining Risks) |
| KMS | 3 keys, **all AWS-managed** (`aws/lambda`, `aws/secretsmanager`, `aws/rds`) — zero monthly key fee |

# Historical Cost vs Current Cost

**Historical (September, full month, actual billed — `RECORD_TYPE=Usage`):**

| Service | Sept cost |
|---|---|
| RDS (Aurora) | $57.92 |
| EC2 - Other (mostly NAT/data-transfer) | $45.51 |
| VPC (interface endpoints) | $34.13 |
| Elastic Load Balancing | $5.22 |
| Secrets Manager | $2.39 |
| ECS | $1.33 |
| Route 53 | $1.00 |
| Cost Explorer | $0.20 |
| ECR / API Gateway / S3 | $0.08 / $0.05 / $0.01 |
| **Total** | **$147.84** |

Top `USAGE_TYPE` drivers: `Aurora:ServerlessV2Usage` $55.60, `NatGateway-Hours` $42.42, `VpcEndpoint-Hours` $28.47, `PublicIPv4:InUseAddress` $5.66, `LoadBalancerUsage` $5.22, `EBS:VolumeUsage.gp2` $2.39.

**Daily trend (last 10 days, shows the real effect of this engagement's work):**
```
09-22  $6.60   (NAT+ALB+Aurora all running)
09-23  $6.65
09-24  $3.86   (drop after Chat ECS desiredCount set to 0 - BUG-C1 fix window)
09-25  $3.86
09-26  $3.86
09-27  $3.86
09-28  $3.86
09-29  $4.61   (remediation/retry work)
09-30  $4.78
10-01  $0.00   (today - NOT proof of zero cost; Cost Explorer has a 24-48h reporting lag)
```

**October month-to-date: $0.0000** — explicitly **not** interpreted as the frozen baseline. This is a data-latency artifact (today's usage hasn't been billed/reported by AWS yet), not evidence of anything. The real current-state cost is computed below from live inventory + published AWS rates instead.

# Frozen Monthly Baseline

Built from live resource inventory + standard AWS ap-southeast-1 published rates (not fabricated to false precision; ranges given where exact billing data isn't available).

| Item | Classification | Approx. monthly |
|---|---|---|
| **Secrets Manager VPC Interface Endpoint** (`vpce-063c1b646aa3de049`, 2 AZs) | FIXED_MONTHLY_APPROX | **≈$14.60** (2 AZs × ~$0.01/hr × 730hr) — matches September's per-endpoint math closely |
| Secrets Manager secrets (9 × $0.40) | FIXED_MONTHLY_APPROX | **≈$3.60** |
| Aurora storage (1 GiB, stopped — storage bills regardless of run state) | FIXED_MONTHLY_APPROX | ≈$0.10-0.15 |
| Aurora backup storage (within 7-day retention) | USAGE_BASED | LOW (likely near-$0 at this data size; September's $0.68 reflected a larger working set) |
| S3 (≈0.76 GB total) | USAGE_BASED | ≈$0.02 |
| ECR (2 repos) | USAGE_BASED | LOW (September: $0.08) |
| Lambda (16 functions, 13 scheduled triggers, no provisioned concurrency) | USAGE_BASED, effectively $0 in practice | Within free tier (1M req + 400K GB-s/month) given current trigger volume |
| API Gateway, SQS | USAGE_BASED | $0 when idle |
| **OpenSearch Serverless OCU compute** | **ZERO_WHEN_IDLE — confirmed via real Cost Explorer evidence, not assumed** | **$0** (`UsageQuantity: 0` for "Amazon OpenSearch Service" for the entire month of September, despite the collection existing with `standbyReplicas: ENABLED` the whole time — see note below) |
| KMS | N/A | $0 (all AWS-managed keys) |
| CloudWatch Logs storage | USAGE_BASED | Negligible today (~tens of MB total); **growing unbounded** on log groups with no retention policy (hygiene risk, not a cost risk yet) |
| VPC core, ECS cluster (no tasks), API Gateway base | N/A | $0 |

**CURRENT_FROZEN_MONTHLY_BASELINE ≈ $18-19/month**, driven almost entirely by the Secrets Manager VPCE + the 9 secrets themselves.

**Important note on OpenSearch Serverless** (explicitly required by this phase's instructions — not assumed free): queried Cost Explorer directly filtered to `SERVICE=Amazon OpenSearch Service` for all of September — **`UsageQuantity: 0`**, not just `$0` cost. This is real, direct evidence of zero billable OCU-hours, not a credit/free-tier offset masking nonzero usage. The most likely explanation is that a serverless collection with **zero actual indexing/query activity** doesn't accrue OCU charges in this account's current billing behavior, despite `standbyReplicas: ENABLED` existing since the collection's creation. This is evidence-based, but **not guaranteed to remain true once real AI/RAG traffic begins** — the commonly-cited AOSS minimum-capacity model (2 indexing + 2 search OCUs, ~$0.24/OCU-hr in most regions) would very plausibly start applying the moment real documents are indexed or searches are run. Flagged as a real unknown for future AI-active sessions, not fabricated into a specific number.

# On-Demand Cost Components

Approximate incremental **hourly** cost while each mode is active (standard published ap-southeast-1 rates; a 2024 AWS-wide change added a ~$0.005/hr charge per in-use public IPv4 address, included below):

| Mode | Script | Components | Approx. $/hr |
|---|---|---|---|
| **A — Backend/DB** | (Aurora start is print-only, never automated — see Phase 8) | Aurora Serverless v2, 0.5-2 ACU × ~$0.12/ACU-hr | ≈$0.06-0.24 |
| **B — Network** | `dev-start.ps1 -Network` | NAT Gateway (~$0.059/hr) + its EIP (~$0.005/hr) + data processing (usage-based, negligible for light dev) | ≈$0.064 |
| **C — AI infra** | `dev-start.ps1 -Ai` | OpenSearch Serverless VPC endpoint (2 AZs × ~$0.01/hr = $0.02/hr) + network-policy reconnect (free, API call only) | ≈$0.02 **+ VARIABLE_AI_USAGE if real indexing/search traffic occurs** (see note above — not assumed zero) |
| **D — Chat** | `dev-start.ps1 -Chat` | ALB base (~$0.0225/hr) + its public IPs (2 AZs × $0.005/hr) + LCU usage (negligible, light testing) | ≈$0.033 **+ Fargate only if Chat ECS is separately scaled to desiredCount>0** (≈$0.024/hr for a 0.5vCPU/1GB task — a deliberate, separate decision per Phase 3's own design) |
| **E — Full** | all of the above together | B+C+D (+A if Aurora also started) | ≈$0.21-0.28/hr (infra only, Chat ECS at 0 tasks, no OpenSearch traffic) |

`VARIABLE_AI_USAGE` (Bedrock token spend) is **not** included anywhere above — currently $0 regardless, since Bedrock authorization is blocked account-wide (see AI/Bedrock Status).

# 4-Hour/Day Scenarios

Frozen baseline (~$18.50/month) applies regardless of dev hours — it's what persistent resources cost running 24/7. Added to that: Mode E's hourly rate × active hours.

| Scenario | Active hours/month | Added cost | **Total/month** |
|---|---|---|---|
| 1: 4h × 20 days | 80h | 80 × ~$0.25 ≈ $20 | **≈$38-40** |
| 2: 4h × 30 days | 120h | 120 × ~$0.25 ≈ $30 | **≈$48-50** |
| 3: 5 billable h × 30 days (startup/shutdown/partial-hour/human delay) | 150h | 150 × ~$0.25 ≈ $37.50 | **≈$56-58** |

All figures are **ranges from standard published rates**, not promises. They exclude `VARIABLE_AI_USAGE` (currently $0, blocked) and assume light dev-session load (no sustained Aurora scale-up, no Chat ECS tasks running, no real OpenSearch indexing/query volume).

# Persistent Resources (never touched by any dev-start/dev-stop flag)

VPC, subnets, security groups, route tables, IAM roles, Secrets Manager (+ its VPCE), S3 (6 buckets), API Gateway base, 16 Lambda functions, SQS (2 queues), OpenSearch **collection** (data/indexes), ECS cluster/service/task-definition configuration, 13 EventBridge schedules, ECR (2 repos), 3 AWS-managed KMS keys, Aurora **data**.

# On-Demand Resources (created/deleted by dev-start/dev-stop)

NAT Gateway + its EIP + the private default route (`-Network`); Chat ALB + listener + target group (`-Chat`, ECS reconnect + API Gateway reconnect + frontend `runtime-config.json` push all run automatically); OpenSearch Serverless VPC endpoint + network-policy `SourceVPCEs` reconnect (`-Ai`).

# Stoppable Resources

Aurora (`stopped`/`available` — data and storage persist either way; **stop/start was never wired into the scripts**, done manually via direct AWS CLI in an earlier session).

# Script Readiness

| Lifecycle | Status | Evidence |
|---|---|---|
| `NETWORK_START_STOP` | **READY** | Real create→verify→delete→verify cycle executed and independently verified in Phase 2 |
| `CHAT_START_STOP` | **READY** | Real cycle executed in Phase 3 (+ frontend reconnect proven live in Phase 3.5) |
| `AI_INFRA_START_STOP` | **READY** | Real cycle executed in Phase 4, including 2 real bugs found and fixed before they affected any live resource |
| `AURORA_START_STOP` | **NOT WIRED** (not `READY` in the same sense) | By deliberate Phase 1 design, neither script automates Aurora start or stop — both remain print-only. Stop was done once manually via direct AWS CLI (not this script); **start has never been attempted at all in this entire engagement**, by script or manually. |

All 4 scripts re-parsed clean (0 syntax errors) and the CloudFormation template re-validated (`VALID`) this phase, with zero mutations. Dry-runs for `-Network`/`-Chat`/`-Ai` each show correctly isolated flags with no cross-contamination.

**`FULL_COMBINED_LIFECYCLE: NOT_TESTED`** — `-Network -Chat -Ai` together, or all 4 modes including Aurora, has never been run in a single pass. Each mode is **`INDIVIDUALLY_VERIFIED`** only.

# AI / Bedrock Status

Per `AWS_DEV_AI_READINESS_AUDIT_2026-10-01.md` (no new Bedrock call made this phase):

| Layer | Status |
|---|---|
| `AI_INFRASTRUCTURE` (Lambda, API Gateway, SQS, worker, frontend) | **READY** |
| `AI_PROVIDER_RUNTIME` (Bedrock Nova chat + Cohere embeddings) | **BLOCKED_EXTERNAL** — `authorizationStatus=NOT_AUTHORIZED` for both models, confirmed via real worker `ValidationException: Operation not allowed` failures in CloudTrail (`2026-09-30T06:52:22Z`, no successful Bedrock call ever found) |
| `AI_E2E` | **BLOCKED** — exact blocker `BEDROCK_ACCOUNT_AUTHORIZATION` |

This is an **account-level AWS authorization issue, entirely separate from and unaffected by** the cost-optimization work in Phases 2-6. Fixing the cost/freeze lifecycle does not and cannot unblock Bedrock.

# Remaining Risks

1. **Secrets Manager VPCE is, by itself, close to the project's own $15/month budget alarm.** Not a leak (it's deliberately persistent), but worth the owner knowing — making it on-demand too would be a much larger, riskier change (every Lambda-in-VPC's Secrets Manager access depends on it) and was explicitly out of scope everywhere in this engagement.
2. **13 EventBridge schedules keep firing Lambda jobs on a timer regardless of frozen state.** Several target `-jobs` Lambdas that may expect Aurora to be reachable; while Aurora is stopped, any job that queries the DB will fail on each scheduled run. Currently low-cost (within Lambda free tier) but worth a look if error-log noise matters.
3. **Several CloudWatch Log groups have no retention policy** (`RetentionDays: null`) and will grow unbounded. Negligible cost today; a hygiene item, not urgent.
4. **`AI_INFRA_START_STOP`'s "zero-cost-when-idle" OpenSearch finding may not hold once real indexing/search traffic exists** — flagged explicitly above, not assumed safe going forward.
5. **Aurora start has literally never been tested**, by script or manually, anywhere in this engagement.
6. Unrelated-to-Gymini CloudWatch log groups (AWS QuickStart HybridDNS debris, orphaned `dc-common-lambda-auto-*` logs) exist in the account; out of scope, not touched, noted for completeness only.

# Final Certification

| Item | Certified |
|---|---|
| A. Cost leaks resolved | **YES** — `dev-cost-leak-check.ps1` returns clean, 0 leaks |
| B. Frozen state reproducible | **YES** — same script, same checks, run twice now (Phase 5 and this phase), identical clean result |
| C. Individual thaw/freeze paths verified | **YES, individually** — Network, Chat, AI each proven live; **combined/full lifecycle and Aurora are explicitly NOT certified** (never tested) |
| D. Data preserved | **YES** — Aurora data, OpenSearch collection/indexes, all Secrets, all S3 content confirmed untouched across every phase |
| E. External AI blocker remains separate | **YES** — Bedrock authorization is accountable to AWS account-level approval, not to anything this engagement touched |

**Not certified**: `FULL COMBINED START/STOP VERIFIED` (never performed, per explicit instruction not to claim this).
