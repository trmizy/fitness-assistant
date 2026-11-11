# AWS DEV Recovery Audit — Gymini / Fitness Assistant

**Date:** 2026-09-29 (UTC times below are wall-clock at query time, ICT = UTC+7)
**Session type:** AUDIT-ONLY — no AWS write operations, no SQL executed, no builds/pushes, no commits.
**Auditor:** Claude Code, acting as Senior AWS DevOps/Backend Engineer for this session.

Evidence legend used throughout this report:
- **Verified** — confirmed just now by a real AWS CLI / `psql`-less read-only call, or by reading an actual file in this repo/S3.
- **Historical** — taken from a report artifact produced by a previous session (schema-drift-report.md, restore-row-counts.md, constraint-audit-report.md); not re-confirmed live because Aurora is stopped.
- **Unknown** — could not be determined with the access/tools available in this session; stated explicitly rather than guessed.

---

## 1. Executive Summary

- **AWS identity confirmed**: account `191798898985`, matches expected. No hard stop triggered.
- **Aurora**: `stopped` (Verified). **AWS will auto-restart it at `2026-09-30T15:07:48Z`** — about 24h from this audit — regardless of any action taken. This is standard RDS/Aurora behavior (auto-restart after 7 days stopped) and is the single most time-sensitive finding in this report.
- **Chat ECS service**: `desiredCount=0`, `runningCount=0`, `pendingCount=0` (Verified). No tasks running anywhere on the cluster, no crash loops, no stray migrator tasks.
- **Networking was never torn down**: NAT Gateway, 2 VPC Interface Endpoints, 3 Elastic IPs, and the Chat ALB are all still `available`/`active` (Verified) — this is exactly what the `sleep` action in `scripts/aws-dev-power.ps1` intentionally leaves running, and it is the majority of the ongoing cost.
- **New finding, not previously reported**: one **unattached 20 GB gp2 EBS volume** (`vol-0c0a7abcb61186356`, created 2026-07-08) is sitting idle and billing for storage with zero function. Safe to delete, not deleted (audit-only).
- **Database migration checkpoint holds up**: 7/7 databases restored, no MISSING tables, `_prisma_migrations` intact (Historical, from `restore-row-counts.md`, not re-verified live since Aurora is stopped).
- **Constraint audit was actually already completed** in a session after the checkpoint text you provided — the checkpoint's claim that "Constraint/orphan audit chưa được xác nhận hoàn thành" is now **stale**. Real result (Historical, `constraint-audit-report.md`, generated 2026-09-23T21:38 ICT): **23 foreign keys proven zero-orphan and safe to add, 0 blocked by orphans, 1 item needs a manual product decision** (`gym_membership_plans.brand_id SET NOT NULL`). None of the 23 safe FKs have been applied yet — there is no `apply-constraints` mode built.
- **Cost**: net cost shown on the bill is ~$0 because AWS credit is currently covering 100% of usage — **this does not mean the resources are free**. Real gross usage from 24/9 to today: **~$3.3–3.9/day**, driven almost entirely by NAT Gateway Hours, VPC Endpoint Hours, Public IPv4, and the ALB — none of which `sleep` mode stops. Could not determine the remaining credit balance via CLI/API (no such endpoint is exposed to this account) — must be read from Billing Console → Credits.
- **No end-to-end application testing has ever been run against the restored AWS DEV data** — every service (Auth/User/Fitness/Gym/Payment/AI/Chat) is infrastructure-verified but not request-verified since the restore.
- **CI/CD for deployment does not exist** — only a `docker-test.yml` workflow was found; nothing deploys Lambda/ECS/frontend automatically.

---

## 2. AWS Identity Verification

```
$ aws sts get-caller-identity
Account: 191798898985
Arn: arn:aws:iam::191798898985:user/vmimport-admin
```
**Verified.** Matches expected account. Proceeded.

---

## 3. Aurora Status

**Verified** via `aws rds describe-db-clusters` / `describe-db-instances`.

| Field | Value |
|---|---|
| Cluster identifier | `fitness-assistant-dev-aurora` |
| Cluster status | `stopped` |
| Instance status | `stopped` (`fitness-assistant-dev-aurora-instance-1`, `db.serverless`) |
| Engine | `aurora-postgresql` 17.7 |
| Serverless v2 scaling | min **0.5 ACU**, max **2.0 ACU** |
| Storage | 1 GB allocated, encrypted (SSE-KMS), `DeletionProtection: false` |
| **AutomaticRestartTime** | **`2026-09-30T15:07:48Z`** |
| Backup retention | 7 days; `LatestRestorableTime` 2026-09-23T15:02:59Z |
| VPC security group | `sg-00e8e01671812bf44` (`fitness-assistant-dev-aurora-sg`) |

**Compute charge while stopped:** none observed. Cost Explorer shows only **$0.106** total for "Amazon Relational Database Service" from 24/9–29/9, consistent with backup-storage retention only, not compute (Verified, see §7).

**Auto-restart risk (this is the key time-sensitive fact):** AWS force-restarts an RDS/Aurora cluster that has been stopped for 7 days — it cannot be stopped again immediately, only after it comes back up. `AutomaticRestartTime` is ~24h from this audit. **If nothing is done, Aurora will start billing compute again tomorrow regardless of your preference**, and ECS Chat will still be at `desiredCount=0` (disconnected from it) unless you explicitly scale it back up.

---

## 4. ECS Status

**Verified** via `aws ecs describe-clusters` / `describe-services` / `list-tasks`.

| Field | Value |
|---|---|
| Cluster | `fitness-assistant-dev-cluster`, status `ACTIVE` |
| Active services | 1 (`fitness-assistant-dev-chat-service`) |
| Chat service desired / running / pending | **0 / 0 / 0** |
| Chat service current task definition | `fitness-assistant-dev-chat:6` (image `...chat:dev-20260922-1`) |
| Running tasks (cluster-wide) | **0** |
| Stopped tasks (recent window) | **0** — no crash loop, no leftover migrator task |

No unexpected `db-migrator` task is running. The cluster is exactly as the `sleep` script left it.

---

## 5. Networking Status

**Verified**, all queried directly against `vpc-010c13afd8920c8f1`. **Nothing was deleted or modified.**

| Resource | State | Note |
|---|---|---|
| NAT Gateway `nat-025b2c37935815d6d` | `available` | Still running — billed hourly regardless of Aurora/ECS state |
| VPC Endpoint `vpce-063c1b646aa3de049` | `available` | `com.amazonaws.ap-southeast-1.secretsmanager` |
| VPC Endpoint `vpce-067d43742cdb6b4d4` | `available` | Service name `com.amazonaws.vpce.ap-southeast-1.vpce-svc-02fb9435bff6076bb` — a PrivateLink endpoint to a **third-party/custom endpoint service**, not a named AWS service. Could not identify its purpose from this API alone (Unknown — worth checking who/what created it) |
| Elastic IPs | 3, all allocated (`122.248.219.75`, `3.1.207.168`, `54.179.119.90`), each bound to an ENI | None are "spare" — all attached, but under 2024 AWS pricing every public IPv4 bills hourly regardless |
| ALB `fitness-assistant-dev-chat-alb` | `active`, internet-facing | Target group `fitness-assistant-dev-chat-tg` (HTTP:3005, `/health`) currently has **0 registered targets** (empty `TargetHealthDescriptions`) — expected, since Chat ECS is at 0 |
| Route tables | 4, unchanged | NAT route (`0.0.0.0/0 → nat-025b2c37935815d6d`) and IGW route both intact |
| Security groups | 6, unchanged | `fitness-assistant-dev-chat-sg`, `default`, `fitness-assistant-dev-lambda-sg`, `fitness-assistant-dev-chat-alb-sg`, `fitness-assistant-dev-aurora-sg`, `fitness-assistant-dev-vpce-sg` |

**New finding — not in the checkpoint:** an **unattached EBS volume** `vol-0c0a7abcb61186356` (20 GB, `gp2`, `state: available`, created 2026-07-08) has no instance attachment and no function. It is pure waste (~$1.60–2/month at gp2 Singapore pricing) and safe to delete, but **not deleted** in this audit-only session.

---

## 6. Deployment Components (Phase B)

### Frontend
- S3 bucket `fitness-assistant-frontend-dev-191798898985`: static website hosting **enabled** (`index.html` / error → `index.html`), **218 objects, 6.48 MB total**, last batch uploaded 2026-09-22 (Verified).
- Repo's active `frontend/web/.env.production` (Verified by reading the file):
  ```
  VITE_API_URL=https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com
  VITE_ENABLE_REALTIME=false
  VITE_ENABLE_CHAT=false
  VITE_ENABLE_CHAT_WS=true
  VITE_CHAT_WS_URL=http://fitness-assistant-dev-chat-alb-1556383256.ap-southeast-1.elb.amazonaws.com
  ```
  `VITE_API_URL` matches the live API Gateway endpoint exactly. `VITE_CHAT_WS_URL` matches the live ALB DNS exactly.
  **Inconsistency worth a product decision**: `VITE_ENABLE_CHAT=false` while `VITE_ENABLE_CHAT_WS=true` — the chat feature flag is off but the chat websocket flag is explicitly on. Not diagnosed further here (out of scope for an infra audit); flagging as NEEDS_VERIFICATION at the application level.

### API Gateway
- HTTP API `fitness-assistant-dev-api` (`id1iz7upbl`) exists (Verified).
- **~85 routes** enumerated; every route has a resolved integration target — **no route with a missing/broken integration was found** (Verified by cross-referencing every `GetRoutes` target against `GetIntegrations`).
- Integrations map to: `fitness-assistant-dev-auth`, `-user`, `-fitness`, `-gym`, `-payment`, `-ai` (all `AWS_PROXY` to Lambda), plus `ANY /chat/{proxy+}` → `HTTP_PROXY` straight to the Chat ALB (`.../chat/{proxy}`).

### Lambda
**Verified** — 16 functions found, all present, `nodejs22.x`, `State: Active` where sampled:

| Function | Present | Sampled config |
|---|---|---|
| `fitness-assistant-dev-auth` | ✅ | In VPC (`sg-0b38ab22927b284ab`, both AZ subnets), 1024 MB, 30s timeout, `LastUpdateStatus: Successful` |
| `fitness-assistant-dev-user`, `-user-jobs` | ✅ | not individually sampled |
| `fitness-assistant-dev-fitness`, `-fitness-jobs` | ✅ | not individually sampled |
| `fitness-assistant-dev-gym`, `-gym-jobs`, `-gym-migrate` | ✅ | not individually sampled |
| `fitness-assistant-dev-payment`, `-payment-jobs`, `-payment-migrate` | ✅ | not individually sampled |
| `fitness-assistant-dev-ai`, `-ai-worker`, `-ai-jobs`, `-ai-migrate` | ✅ | `-ai-worker` is wired to SQS `fitness-assistant-dev-ai-tasks` (+ DLQ `...-ai-tasks-dlq`), event source mapping **Enabled** (Verified) |
| `fitness-assistant-dev-chat-migrate` | ✅ | In VPC, same subnets/SG pattern, 1024 MB, 60s timeout, `Successful` |

No secret **values** were displayed anywhere — only secret/env-var **names** (per hard rule).

**Finding**: no EventBridge rule exists anywhere in this account (`aws events list-rules` returned empty for both the whole account and a name filter). This means `fitness-jobs`, `gym-jobs`, `payment-jobs`, `user-jobs`, `ai-jobs` have **no scheduled trigger** visible at the infra layer. They may be invoked some other way (application code, Step Functions, manual) that this audit did not check — flagged as **Unknown / NEEDS_VERIFICATION**, not concluded as broken.

### Chat
- ECS service + task definition (`fitness-assistant-dev-chat:6`) + ALB + Target Group all exist and are wired together correctly (Verified).
- ECR `fitness-assistant-dev-chat`: 1 tagged image (`dev-20260922-1`) + 2 untagged manifests (multi-arch layers of the same push), pushed 2026-09-22T11:58 ICT.
- Task definition secrets: only `CHAT_DATABASE_URL` referenced from Secrets Manager (value not displayed).

### Database Migrator
- **Checkpoint is stale here**: the task definition family is now at **revision 14**, not 13, and the last-used image is `...db-migrator:dev-20260923-constraint-audit-1`, not `...restore-enum-audit-2` (Verified via `describe-task-definition` + ECR `describe-images`). Both `restore-enum-audit-1`, `-2`, and `constraint-audit-1` exist in ECR.
- CloudWatch log group `/ecs/fitness-assistant-dev-db-migrator`: 14-day retention, 68.8 KB stored (Verified).
- S3 report prefix `full-local-migration/2026-09/db-migrator-output/` contains, dated 2026-09-23 21:16–21:38 ICT (Verified via `aws s3 ls`):
  - `reports/schema-drift-report.md`, `reports/restore-row-counts.md`, `reports/constraint-audit-report.md`
  - `generated/schema-prepatch*.sql`, `generated/needs-review*.sql`, `generated/safe-constraints*.sql`, `generated/blocked-constraints*.sql`, `generated/enum-data-drift.tsv`

---

## 7. AWS Cost Breakdown (Phase C)

**Method note**: all figures below use `RECORD_TYPE=Usage` (gross cost before any credit is netted out), per your explicit instruction not to conclude "free" from net cost.

### 7.1 This month so far

| Metric | Amount (USD) |
|---|---|
| Gross Usage, September (1/9–29/9) | **136.72** |
| Credit applied, September | **-136.72** |
| Net cost shown on bill | ≈ $0.0000002 (rounding) |

**Net ≈ $0 is a credit-coverage artifact, not evidence of free infrastructure** — $136.72 of real usage happened and was paid for by credit.

### 7.2 Since "sleep" (24/9 → today, gross Usage only)

| Day | Cost (USD) |
|---|---|
| 2026-09-24 | 3.86 |
| 2026-09-25 | 3.86 |
| 2026-09-26 | 3.86 |
| 2026-09-27 | 3.86 |
| 2026-09-28 | 2.12 |
| 2026-09-29 | 0.00 *(Cost Explorer has ~24–48h billing lag; not a real $0 day — Unknown until it finalizes)* |

Steady floor while "asleep": **≈ $3.86/day (~$116/month if sustained)**.

### 7.3 Per-service, 24/9 → today (gross Usage only)

| Service | Cost (USD) |
|---|---|
| Amazon Virtual Private Cloud | 7.36 |
| EC2 - Other | 6.79 |
| Amazon Elastic Load Balancing | 2.75 |
| AWS Secrets Manager | 0.55 |
| Amazon Relational Database Service | 0.11 |
| Amazon EC2 Container Registry | 0.007 |
| Amazon S3 | 0.002 |

### 7.4 Usage-type breakdown — what is actually billing during "sleep"

**EC2 - Other:**
| Usage type | Cost (USD) |
|---|---|
| `APS1-NatGateway-Hours` | **6.431** |
| `APS1-EBS:VolumeUsage.gp2` | 0.357 *(the orphaned volume, §5)* |
| `APS1-NatGateway-Bytes`, data transfer | ~0.000003 (negligible) |

**Amazon VPC:**
| Usage type | Cost (USD) |
|---|---|
| `APS1-VpcEndpoint-Hours` | **5.72** |
| `APS1-PublicIPv4:InUseAddress` | **1.635** |
| `APS1-VpcEndpoint-Bytes` | 0.0003 (negligible) |

**Conclusion for §7 (explicit, per instruction):** the resources still billing during "sleep" are the **NAT Gateway, the 2 VPC Interface Endpoints, the 3 Elastic IPs, the ALB, and the orphaned EBS volume** — none of these are stopped by the current `sleep` script, and none of them can be "stopped" (only deleted/released) since they aren't compute instances.

### 7.5 Remaining credit balance

**Could not be determined via any AWS CLI/API available to this account.** There is no Cost Explorer or Billing dimension that returns "remaining promotional credit balance" — only *credits applied* per period (§7.1), which is not the same number. **Check AWS Console → Billing and Cost Management → Credits** for the true remaining balance. Do not treat any number in this report as that balance.

---

## 8. Database Migration & Constraint Status (Phase D)

Read from `tools/db-migrator/` (repo) and the S3 report prefix. **Aurora is stopped, so nothing here was re-verified live** — everything in this section is **Historical**, from artifacts generated 2026-09-23.

### 8.1 Restore (`restore-row-counts.md`, Historical)
7/7 databases present with per-table row counts; every table is `OK` (has rows) or `EMPTY` (0 rows, table exists) — **zero `MISSING` tables**. `_prisma_migrations` row counts intact per DB (7/26/48/9/11/3/22). Matches the checkpoint exactly.

### 8.2 Schema drift (`schema-drift-report.md`, Historical)
At last run: `fitness_assistant` 0 safe/1 review, `fitness_assistant_user` 6 safe/5 review, `fitness_assistant_fitness` 0 safe/2 review, `fitness_assistant_gym` 0 safe/16 review, `payment`/`chat`/`ai` clean (0/0). All safe items were already applied in a prior `apply-prepatch` run (per the earlier session's confirmed exitCode=0).

### 8.3 Constraint audit (`constraint-audit-report.md`, Historical — **this directly answers your checkpoint's open question**)

| Status | Count |
|---|---|
| SAFE_FK (zero orphans, proven against live Aurora data) | **23** |
| BLOCKED_ORPHANS | **0** |
| SAFE_ENUM_ADD | 0 *(already applied earlier)* |
| ALREADY_APPLIED | 0 |
| MANUAL | **1** |
| INVALID_REFERENCE | 0 |

The 1 MANUAL item, not analyzed further by design (destructive statement, excluded from any safe file):
```
ALTER TABLE "gym_membership_plans" ALTER COLUMN "brand_id" SET NOT NULL;
```

**What this means concretely:** `generated/safe-constraints.sql` (and the 7 per-DB files) contain 23 `ADD CONSTRAINT ... FOREIGN KEY` statements that were mathematically proven to have zero orphan rows against the actual restored data. **They have never been applied** — no `apply-constraints` mode exists in `tools/db-migrator` yet; this was an explicit hard-stop in the session that produced them.

### 8.4 What could not be checked because Aurora is stopped
- Whether any new data has drifted since the audit (extremely unlikely — no write path exists while Aurora is stopped, so this is a formality, not a real risk).
- Any live `pg_enum`/`information_schema` re-confirmation.
- Actually applying and testing the 23 safe FKs.

---

## 9. Deployment Gap Analysis (Phase E)

| # | Subsystem | Status | Evidence |
|---|---|---|---|
| 1 | Frontend | **COMPLETE** (static hosting) | S3 website config + 218 objects Verified; end-to-end reachability depends on API Gateway → Lambda → Aurora chain, which is currently asleep |
| 2 | API Gateway | **COMPLETE** | All ~85 routes have resolved integrations, Verified |
| 3 | Auth Service | **NEEDS_VERIFICATION** | Lambda deployed & Active (Verified); zero HTTP requests made against restored data since restore — existence ≠ correctness |
| 4 | User Service | **NEEDS_VERIFICATION** | Same reasoning |
| 5 | Fitness Service | **NEEDS_VERIFICATION** | Same reasoning |
| 6 | Gym Service | **NEEDS_VERIFICATION** | Same reasoning; also has the 1 pending MANUAL constraint decision |
| 7 | Payment Service | **NEEDS_VERIFICATION** | Same reasoning |
| 8 | AI Service | **NEEDS_VERIFICATION** | Same reasoning |
| 9 | AI Worker/Jobs | **NEEDS_VERIFICATION** | SQS+DLQ wiring Verified and looks correct for `ai-worker`; the 5 `*-jobs` Lambdas have no EventBridge trigger found anywhere in the account — Unknown whether they're invoked another way |
| 10 | Chat REST | **DEPLOYED_BUT_SLEEPING** | ECS service exists, `desiredCount=0` right now (Verified); never load-tested against restored chat data |
| 11 | Chat Socket.IO | **DEPLOYED_BUT_SLEEPING** | Same infra, same caveat |
| 12 | Aurora Database | **DEPLOYED_BUT_SLEEPING** | `stopped`, auto-restarts 2026-09-30T15:07Z (Verified) |
| 13 | Database Migration | **COMPLETE** | 7/7 restored, 0 missing tables (Historical, matches checkpoint) |
| 14 | Database Constraint Audit | **INCOMPLETE** | Audit itself is COMPLETE (23 safe/0 blocked/1 manual, Historical); but *applying* the 23 safe FKs has never happened — no apply mode exists |
| 15 | E2E Integration Testing | **NOT_DEPLOYED** | No evidence anywhere (CloudWatch, S3, repo) of any application-level test run against the restored DEV stack |
| 16 | CI/CD | **NOT_DEPLOYED** | Only `.github/workflows/docker-test.yml` exists (Verified `ls`); no workflow deploys Lambda/ECS/frontend |

---

## 10. Recommended Next Actions (Phase F) — proposed, not executed

Priority order, matching your requested sequence:

1. **Decide on Aurora now vs. tomorrow.** It restarts automatically at `2026-09-30T15:07Z` regardless. Recommendation: **wake deliberately now** (`scripts/aws-dev-power.ps1 -Action wake`) so you control *when* Chat ECS also comes back up, rather than having Aurora silently start billing compute for ~24h with nothing using it.
2. **Apply the 23 audit-proven-safe foreign keys.** Needs a new `MODE=apply-constraints` in `tools/db-migrator` (does not exist yet) that executes exactly `generated/safe-constraints.<db>.sql`, nothing else. Decide separately on the 1 MANUAL item (`gym_membership_plans.brand_id SET NOT NULL`) — last known data (from the constraint audit run) showed 8/8 rows already non-null, but re-confirm live before applying.
3. **Run real E2E smoke tests against restored data** — Auth login with a real restored user, User profile fetch, a Fitness/Gym/Payment/AI read endpoint each, then Chat REST + a Socket.IO connection. None of this has ever been done against this restored dataset.
4. **Build the missing deploy CI/CD** if there's time this session — currently zero automation beyond `docker-test.yml`.
5. **Cost containment plan** (does not delete data or infra by itself):
   - Keep using `scripts/aws-dev-power.ps1 sleep/wake` for Aurora + Chat ECS around active work sessions — this is already the cheapest safe option for those two components.
   - For NAT Gateway / VPC Endpoints / Elastic IPs — these cannot be "slept," only deleted and recreated. If a pause of many days is expected, consider a "deep sleep" tier that deletes these (recreatable from `infra/terraform` if that's how they were provisioned — not confirmed in this audit) and releases the 3 EIPs. This trades ~$3.86/day savings against the effort of recreating networking on wake.
   - **Delete the orphaned EBS volume** `vol-0c0a7abcb61186356` — zero function, safe, small but pure waste.
   - **Commit `tools/db-migrator/` to git** — the entire toolchain (scripts, generated patches, reports) is currently untracked (`git status` shows `?? tools/db-migrator/`); it exists only in this working directory.
6. **Confirm remaining AWS credit balance** in Billing Console before deciding how much further testing/work to do this session.

### Exact AWS CLI commands for the next session (proposed only — none executed)

```bash
# 1. Wake Aurora + Chat ECS deliberately (WRITE — needs your approval)
powershell -File scripts/aws-dev-power.ps1 -Action wake

# 2. Once Aurora is available, re-run constraint audit's sibling (build first): apply the 23 safe FKs
#    (requires building MODE=apply-constraints in tools/db-migrator — not yet implemented)

# 3. Smoke test Auth (example, no real credentials/data shown here)
curl -s -X POST https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com/auth/login \
  -H "Content-Type: application/json" -d '{"email":"...","password":"..."}'

# 4. Check Chat health once ECS is scaled back up
curl -s http://fitness-assistant-dev-chat-alb-1556383256.ap-southeast-1.elb.amazonaws.com/health

# 5. Cost hygiene (WRITE — needs your approval, low risk, reversible via new allocation)
aws ec2 delete-volume --volume-id vol-0c0a7abcb61186356 --region ap-southeast-1
```

---

## 11. Risks and Blockers

- **Time-sensitive**: Aurora auto-restart in ~24h from this audit is not optional — plan around it rather than being surprised by it.
- **Unidentified VPC Endpoint** (`vpce-067d43742cdb6b4d4`, custom PrivateLink service) — purpose unknown from this audit; worth a quick manual check of what created it before ever considering deletion.
- **No E2E test has ever run** against the restored AWS DEV data — every "service is up" conclusion in §9 is an infrastructure fact, not a functional one.
- **`tools/db-migrator` is not in git** — a full week of migration/audit tooling work exists only on this machine's working tree.
- **1 unresolved schema decision** (`gym_membership_plans.brand_id SET NOT NULL`) blocks a fully clean constraint state, though it does not block anything else.
- **IAM/API access**: no `AccessDenied` was encountered on any read-only call made during this audit (Billing/Cost Explorer, EC2, ECS, RDS, Lambda, API Gateway, S3, ECR, CloudWatch Logs, SQS, EventBridge, Secrets Manager list — all succeeded).

---

*End of audit. No AWS write operation, SQL statement, build, push, or git commit was performed while producing this report.*
