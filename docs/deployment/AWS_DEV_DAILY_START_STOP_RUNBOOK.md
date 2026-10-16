# Gymini AWS DEV — Daily Start/Stop Runbook

Account `191798898985`, region `ap-southeast-1`. All commands below use the exact flags that exist in `scripts/aws/dev-start.ps1` / `dev-stop.ps1` today — nothing invented. Run from the repo root.

**Status of each lifecycle:** `NETWORK`/`CHAT`/`AI_INFRA`/`SECRETS`/`BACKEND` (Aurora start+stop, schedule pause+restore) are all individually live-verified end-to-end (Phase 8, 2026-10-01). **Combined (`-Network -Chat -Ai -Backend` together in one pass) is the only remaining untested lifecycle** — run flags one at a time until that's explicitly authorized.

**Current live state as of 2026-10-01 (fully frozen)**: Aurora `stopped`, all 13 DEV-pausable schedules `DISABLED`, `gym-partner-upload-sweep` independently `DISABLED` (unchanged), Secrets Manager VPCE `0`. The pre-freeze snapshot in `.dev/aws/scheduler-state.json` is correct and ready for the next `-Backend` start to restore.

**Two real bugs were found and fixed in `dev-stop.ps1` during Phase 8** (see `AWS_DEV_BACKEND_FIRST_LIFECYCLE_TEST_2026-10-01.md` for full detail): (1) `aws cloudformation deploy`'s own stdout could corrupt a function's return value and report a false failure on a successful no-op redeploy - fixed by suppressing that output; (2) `Suspend-DevSchedules` now only overwrites the scheduler state file when a real pause transition is happening, not on every idempotent re-run. Both fixes are live in the script now.

---
## START OF WORK

**1. Check status (read-only):**
```powershell
scripts\aws\dev-status.ps1
```
This now also reports the Secrets Manager VPCE's real state and warns if any schedule is `ENABLED` while Aurora is not `available` (those will fail every cycle - confirmed, not theoretical).

**2. Decide what you actually need:**

| You need | Run |
|---|---|
| Backend/DB (Aurora + schedules) | `scripts\aws\dev-start.ps1 -Backend -Execute` (auto-enables Secrets Manager connectivity) |
| Outbound internet for Lambda (Bedrock) | `scripts\aws\dev-start.ps1 -Network -Execute` |
| AI/RAG infra (OpenSearch private endpoint) | `scripts\aws\dev-start.ps1 -Ai -Execute` (auto-enables Secrets) |
| Chat (ALB + reconnect ECS/API Gateway/frontend) | `scripts\aws\dev-start.ps1 -Chat -Execute` (auto-enables Secrets) |
| Secrets Manager connectivity alone (diagnostics only) | `scripts\aws\dev-start.ps1 -Secrets -Execute` |
| Everything | Run each flag separately, one `-Execute` at a time — not combined |

You never need to remember Secrets Manager yourself: `-Chat`, `-Ai`, and `-Backend` each print `Auto-enabling Secrets Manager connectivity` and include it automatically. Only `-Network` does not (NAT serves a different purpose).

**3. Wait until ready**, then re-run `dev-status.ps1` to confirm what came up.

**4. Work/test.**

---
## END OF WORK

**1. Confirm no critical job in progress.** `-Backend` stop checks this for you (SQS in-flight message count) and refuses if anything is actively processing.

**2. Stop whatever you started, one flag at a time:**
```powershell
scripts\aws\dev-stop.ps1 -Chat -Execute
scripts\aws\dev-stop.ps1 -Ai -Execute
scripts\aws\dev-stop.ps1 -Network -Execute
scripts\aws\dev-stop.ps1 -Backend -Execute    # pauses schedules first, then stops Aurora
```
(Order among these doesn't matter — each only turns off its own flag and preserves whatever else is still on.)

**3. Only once nothing else needs it, remove Secrets Manager connectivity:**
```powershell
scripts\aws\dev-stop.ps1 -Secrets -Execute
```
This is explicit-only, never auto-implied on stop — Chat/AI might still need it even after Aurora stops.

**4. Run the leak check:**
```powershell
scripts\aws\dev-cost-leak-check.ps1
```

**5. Require:** `No cost leak detected.` (exit code 0). The check now also flags a present-but-unneeded Secrets Manager VPCE and any schedule still `ENABLED` while Aurora is frozen. If it's not clean, see the failure runbook below — do not just walk away.

---
## FAILURE / INTERRUPTION RUNBOOK

Diagnose first. Do not auto-fix.

| Situation | Diagnostic command |
|---|---|
| Laptop shut down before `dev-stop` | `scripts\aws\dev-status.ps1` — shows exactly what's still up, including schedules and Secrets VPCE |
| CloudFormation delete failed | `aws cloudformation describe-stack-events --stack-name gymini-dev-on-demand --region ap-southeast-1 --max-items 20` |
| NAT still present | `aws ec2 describe-nat-gateways --filter "Name=state,Values=available,pending" --region ap-southeast-1` — then retry `dev-stop.ps1 -Network -Execute` |
| ALB still present | `aws elbv2 describe-load-balancers --names dev-chat-alb --region ap-southeast-1` — then retry `dev-stop.ps1 -Chat -Execute` |
| OpenSearch VPCE still present | `aws opensearchserverless list-vpc-endpoints --region ap-southeast-1` — then retry `dev-stop.ps1 -Ai -Execute` |
| Secrets Manager VPCE still present, nothing needs it | `aws ec2 describe-vpc-endpoints --filters "Name=service-name,Values=com.amazonaws.ap-southeast-1.secretsmanager"` — then retry `dev-stop.ps1 -Secrets -Execute` |
| Aurora stuck `available` | `aws rds describe-db-clusters --db-cluster-identifier fitness-assistant-dev-aurora --region ap-southeast-1 --query "DBClusters[0].Status"` — then `dev-stop.ps1 -Backend -Execute` |
| Schedules stuck `ENABLED` while Aurora frozen | `scripts\aws\dev-status.ps1` shows exactly which ones; they fail every cycle until paused or Aurora starts - confirmed real, not cosmetic |
| `scheduler-state.json` missing or looks wrong | `.dev/aws/scheduler-state.json` - if absent, `dev-start.ps1 -Backend` falls back to current live schedule state (a safe no-op), not a guess |
| `runtime-config.json` looks stale | `aws s3 cp s3://fitness-assistant-frontend-dev-191798898985/runtime-config.json -` — compare `chatWsUrl`/`chatEnabled` against current reality; re-run the relevant `dev-start`/`dev-stop -Chat -Execute` to refresh it |

**Reminder:** Aurora auto-restarts itself after 7 days of being stopped (AWS's own documented behavior, observed directly in this project). A stopped Aurora is not a permanent state — re-check periodically if DEV sits idle for more than a week.

---
## BILLING SAFETY (already configured — verify, don't recreate)

| Tool | Status |
|---|---|
| AWS Budgets | **PRESENT** — 4 budgets exist, including `fitness-assistant-monthly` ($15/month, Gymini-specific) |
| Cost Anomaly Monitor | **PRESENT** — `Default-Services-Monitor`, daily email to the account owner, triggers at ≥$100 or ≥40% anomaly |
| CloudWatch billing alarm | **ABSENT** (Budgets + Anomaly Detection already cover this role) |

Check these in the Billing console periodically — don't just trust the leak-check script alone for anomalies outside the known on-demand resources.

---
## QUICK REFERENCE — what each mode actually touches

- `-Network`: NAT Gateway + its EIP + private default route. Does not imply Secrets.
- `-Chat`: ALB + listener + target group, then auto-reconnects ECS's target group, the API Gateway integration, and pushes `runtime-config.json` to the frontend. Never scales ECS tasks. Implies Secrets.
- `-Ai`: OpenSearch Serverless VPC endpoint, then auto-reconnects the network policy's `SourceVPCEs`. Never touches the collection, its data, or the data-access/encryption policies. Implies Secrets.
- `-Backend`: starts Aurora (never deletes the cluster, never restores a snapshot, never runs migrations), then restores schedules from `.dev/aws/scheduler-state.json`. On stop, pauses schedules first (capturing their state), then stops Aurora. Implies Secrets on start only.
- `-Secrets`: Secrets Manager VPC Interface endpoint, on its own. Auto-implied by `-Chat`/`-Ai`/`-Backend` on start; always explicit on stop. **Create+delete live-verified standalone (Phase 7.1) and again in combination with `-Backend` (Phase 8)** - a real Lambda cold-start fetch through it was observed succeeding live (1091ms, zero errors, vs. the previously-confirmed ~25s guaranteed failure when Aurora was unreachable).
