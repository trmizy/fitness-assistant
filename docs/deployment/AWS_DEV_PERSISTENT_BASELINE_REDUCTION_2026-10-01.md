# AWS DEV — Persistent Baseline Reduction (Phase 7 + Phase 7.1)

Date: 2026-10-01. Account `191798898985`, region `ap-southeast-1`.

**Phase 7** (design/code) is complete. **Phase 7.1** (owner-authorized controlled execution, same day) **actually performed and verified live** the two authorized mutations: pausing the DEV-pausable EventBridge schedules, and migrating the Secrets Manager VPC endpoint into the CloudFormation on-demand lifecycle (create → verify → delete, proven once). Aurora start/stop and schedule restore remain untested by explicit instruction — see "Phase 7.1 — Realized Results" below for everything that is now real, not just designed.

**Correction from Phase 7's own reporting**: live re-verification in Phase 7.1 found **14 total EventBridge schedules** (13 `ENABLED` + 1 `DISABLED`), not 13 total as this document previously stated (and as even the Phase 7.1 task's own framing initially assumed, before live re-verification). The underlying implementation (`$DevPausableSchedules`, 13 names, correctly excluding `gym-partner-upload-sweep`) was always correct — only the prose summaries undercounted. Corrected throughout below.

## Executive Summary

Primary goal: reduce the ~$18-19/month frozen baseline (from `AWS_DEV_FINAL_COST_BASELINE_2026-10-01.md`) without changing data architecture or exposing secrets. The investigation produced three findings, each backed by direct evidence (not assumed):

1. **Secrets Manager VPCE on-demand is SAFE** — every Lambda only calls Secrets Manager on a cold start, caching the result for the container's lifetime (confirmed by reading the shared `config/lambda-runtime.ts` pattern across all 6 services). This is the biggest single cost item (~$14.60/month). **Now realized live — see Phase 7.1.**
2. **A real, already-happening problem, independent of the VPCE question**: all 13 of the DEV-pausable EventBridge schedules (of 14 total) have been firing against a stopped Aurora since it was first stopped (Phase 2), and **every single invocation has been failing** — confirmed live in CloudWatch Logs, not theorized. `payment-jobs` burns ~25 seconds of billed Lambda duration per failed attempt, every 5 minutes. **Now paused live — see Phase 7.1.**
3. **Aurora start/stop was never automated or tested anywhere in this engagement** — the design is sound (handles every transitional status safely) but remains unverified in practice, by explicit instruction (not attempted in Phase 7.1 either).

All CloudFormation and script changes are written, statically validated (template valid, 4/4 scripts parse clean, 7 dry-run combinations tested), and — as of Phase 7.1 — the Secrets VPCE and schedule-pause portions are **live-verified real**, not just designed.

## Phase 1 — Runbook wording correction

`docs/deployment/AWS_DEV_DAILY_START_STOP_RUNBOOK.md` referenced "direct Anthropic fallback" as part of the approved architecture. Current project configuration is `LLM_PROVIDER=bedrock` exclusively (confirmed via `AWS_DEV_AI_READINESS_AUDIT_2026-10-01.md`) — the Anthropic direct-API path exists in source as an unused capability, never adopted. Removed the reference from both the runbook and the CFN template's `EnableNatGateway` parameter description (same stale wording, same fix). Documentation-only; no runtime provider configuration touched.

## Secrets Manager Dependency Map

All 16 Lambda functions are VPC-attached, in the same 2 private subnets, same security group (`sg-0b38ab22927b284ab`) — confirmed via `list-functions` with VPC config, not assumed. Two functions referenced in CloudWatch Log groups (`auth-migrate`, `user-migrate`) turned out to be **orphaned log groups from already-deleted functions** — not part of the current 16.

Every service shares one pattern (`config/lambda-runtime.ts`, explicitly documented in `ai-service`'s file as "mirrors payment-service's config/lambda-runtime.ts"):

- `ensureDatabaseUrlConfigured()`: if `DATABASE_URL` env var is already set, returns immediately (no Secrets Manager call at all — this is the local-dev/docker-compose path). Otherwise, checks a **module-level cache** (`cachedDatabaseUrl`/`cachedDatabaseSecret`); only calls `GetSecretValueCommand` if the cache is empty.
- The cache is populated **once per Lambda execution environment** (cold start) and survives for that container's entire lifetime across however many invocations follow, until AWS recycles it.
- HTTP-triggered services (`auth`, `user`, `fitness`, `gym`, `payment`, `ai`) additionally wrap this in their own `cachedHandler` check in `lambda.ts`, so `ensureDatabaseUrlConfigured()` is called at most once per container regardless of request volume.
- SQS-triggered (`ai-worker`) and EventBridge-triggered (`*-jobs`) Lambdas call it on every invocation, but the underlying Secrets Manager call is still gated by the same module-level cache.
- **Failure behavior**: if Secrets Manager is unreachable, the call throws, is logged with host/port/database (never the password), and re-throws — the whole invocation fails cleanly. This happens **before** any Prisma/database connection is attempted, so a Secrets Manager failure can never reach or affect the actual database.

| Function group | VPC | Secrets fetch timing | On unreachable |
|---|---|---|---|
| `auth`, `user`, `fitness`, `gym`, `payment`, `ai`, `chat-migrate` | Yes | Cold start only (via `cachedHandler`) | Invocation fails, no DB touched |
| `ai-worker` (SQS) | Yes | Cold start only (module cache) | Invocation fails, message becomes visible again |
| `*-jobs` (EventBridge) | Yes | Cold start only (module cache) | Invocation fails - **confirmed actually happening live, see below** |
| `*-migrate` | Yes | Cold start only | Invocation fails |

## Secrets VPCE Assessment

Current endpoint (`vpce-063c1b646aa3de049`, saved to `docs/deployment/evidence/secrets-vpce-pre-phase7-2026-10-01.json`): Interface type, 2 AZs, SG `sg-0198527f052b3f386` (`fitness-assistant-dev-vpce-sg`), `PrivateDnsEnabled: true`, policy `{Action:"*", Effect:Allow, Principal:"*", Resource:"*"}` (already maximally open — nothing to "not broaden," preserved exactly as-is in the CFN definition).

**Alternate connectivity (Phase 4 of the task):**
- NAT ON: yes, reaches Secrets Manager's public regional endpoint over the internet (standard pre-VPC-endpoint pattern).
- NAT OFF + Secrets VPCE OFF: **no path at all** from any Lambda in the private subnets.
- While frozen, scheduled Lambdas DO currently wake up (see below) and DO currently call Secrets Manager successfully on each cold start (confirmed live in logs) — the VPCE being persistent has, until now, silently absorbed this.

**Decision: SAFE**, conditional on the schedule-pause mitigation (next section) and accepting one residual, non-destructive risk: a stray/unexpected HTTP request via API Gateway during a frozen window (e.g., a forgotten browser tab) would cold-start-fail if it landed on a container with no cached credential. This fails before any DB touch, costs nothing, and is the same risk category already accepted for Chat's dead-ALB-DNS self-healing behavior in Phase 3 — judged acceptable for a DEV-only environment.

## Scheduled Jobs Assessment

All **14** schedules inspected directly (`get-schedule`, not just `list-schedules` — and re-confirmed via server-side count queries in Phase 7.1: `length(Schedules)` = 14, `length(Schedules[?State=='ENABLED'])` = 13, `length(Schedules[?State=='DISABLED'])` = 1):

| Schedule | State | Expression | Requires DB | Safe to disable when frozen | Restore needed | Notes |
|---|---|---|---|---|---|---|
| ai-autoaccept | ENABLED | rate(15 min) | Yes | Yes | Yes | |
| ai-pubmed | ENABLED | cron(30 2 * * ? *) daily | Yes | Yes | Yes | |
| payment-reconciliation | ENABLED | rate(5 min) | Yes | Yes | Yes | **Confirmed failing live**, ~25s/attempt |
| user-session-auto-confirm | ENABLED | rate(10 min) | Yes | Yes | Yes | |
| user-session-settlement | ENABLED | rate(5 min) | Yes | Yes | Yes | |
| ai-rss | ENABLED | cron(0 3 * * ? *) daily | Yes | Yes | Yes | |
| gym-partner-upload-sweep | **DISABLED** | rate(1 day) | Yes | N/A | **Never touch** | Independently disabled for a product reason, unrelated to DEV freeze - excluded from this automation entirely |
| workout-unfinished-reminder | ENABLED | rate(30 min) | Yes | Yes | Yes | |
| ai-local-evidence | ENABLED | cron(0 2 * * ? *) daily | Yes | Yes | Yes | |
| user-reschedule-expiry | ENABLED | rate(10 min) | Yes | Yes | Yes | |
| ai-web | ENABLED | cron(30 3 * * ? *) daily | Yes | Yes | Yes | |
| gym-membership-payout | ENABLED | rate(10 min) | Yes | Yes | Yes | |
| gym-referral-settlement | ENABLED | rate(10 min) | Yes | Yes | Yes | |
| workout-upcoming-reminder | ENABLED | rate(30 min) | Yes | Yes | Yes | |

**Empirical confirmation, not theory**: read live CloudWatch Logs for `payment-jobs` (fires every 5 min) — every single invocation in the sampled window failed with `Can't reach database server at fitness-assistant-dev-aurora...`, each taking ~25 seconds (Prisma's connection timeout) before giving up. Confirmed the same pattern in `gym-jobs` (membership-payout, referral-settlement), including a log line showing the cold-start Secrets Manager fetch **succeeding** ("Gym Lambda database configuration loaded from Secrets Manager") immediately before the Aurora connection failed — proving the two failure modes are independent and the Secrets path currently works fine; it's Aurora being stopped that's been causing the failures.

**This has been happening since Aurora was first stopped (Phase 2), completely independent of anything in this phase** — pausing these schedules while frozen is a pure improvement (stops wasted Lambda compute, reduces log noise), not a new tradeoff being introduced.

**State preservation mechanism**: `.dev/aws/scheduler-state.json`, captured fresh on every `dev-stop.ps1 -Backend -Execute` (snapshotting **all 14** schedules, including the already-disabled one, for a complete record), consumed by `dev-start.ps1 -Backend -Execute` to restore exactly. If the file is missing, the restore function falls back to the *live current* state (a safe no-op) rather than guessing. `gym-partner-upload-sweep` is never in the "pausable" list the automation acts on, so it is never touched in either direction — its independent DISABLED state cannot be accidentally overridden. **This file now exists for real** (written by Phase 7.1's pause action) — see below.

**A real AWS API contract discovered and handled correctly**: `aws scheduler update-schedule` is a full-replace API — confirmed via `aws scheduler update-schedule help`: *"EventBridge Scheduler uses all values, including empty values... if you do not set an optional field, that field will be set to its system-default value."* A naive partial update would have silently wiped `Target.RetryPolicy`, `Target.RoleArn`, `ScheduleExpressionTimezone`, etc. The implemented `Set-DevScheduleState` function always reads the full current schedule, strips only the 3 output-only fields (`Arn`, `CreationDate`, `LastModificationDate`) that `update-schedule`'s own input skeleton doesn't accept, changes only `State`, and resubmits everything else unchanged via `--cli-input-json`. Verified by comparing the round-tripped JSON field-for-field against `aws scheduler update-schedule --generate-cli-skeleton`'s exact shape (local-only test, no AWS mutation) — every field matched.

## Aurora Lifecycle

`Start-AuroraCluster` / `Stop-AuroraCluster` handle every status explicitly: `available`/`stopped` (no-op), `stopped`→start / `available`→stop (act), `starting`/`stopping` (wait, never re-issue), anything else (`backing-up`, `modifying`, unknown) → refuse and report rather than guess. Start uses the real `db-cluster-available` waiter; stop uses manual polling since **no `db-cluster-stopped` waiter exists** (confirmed via `aws rds wait help` before relying on one). Never deletes the cluster, never restores a snapshot, never runs migrations — confirmed by reading the implementation, not just asserting it.

## Safe Start Order (implemented)

1. CloudFormation deploy (Secrets/NAT/Chat/AI resources created together, in whatever combination was requested, in one call — they have no ordering dependency on each other).
2. Stack reaches `CREATE_COMPLETE`/`UPDATE_COMPLETE` (the deploy call blocks until this).
3. Chat/AI reconnect steps (unchanged from Phases 3-4), if requested.
4. **Only if `-Backend`**: start Aurora, wait `available`.
5. **Only then**: restore schedules.

This guarantees no scheduled Lambda can wake up while Secrets Manager or Aurora connectivity is still unavailable - the dependency the task's Phase 10 specifically asked not to assume blindly. Derived here from the actual mechanics (CFN resources have no runtime ordering dependency; Aurora's start API is a pure control-plane call unrelated to the VPC; only the *schedule restore* step has a genuine "must come after" requirement) rather than copied from the task's own candidate order unexamined.

## Safe Stop Order (implemented)

1. Chat ECS precondition (0/0) - unchanged.
2. **Only if `-Backend`**: SQS in-flight check (no messages currently being processed) - refuses to stop Aurora underneath an active job.
3. **Only if `-Backend`**: suspend schedules (capture-then-disable) - before anything else, so no new invocation can start.
4. Chat graceful-disable push (unchanged), if requested.
5. **Only if `-Backend`**: stop Aurora, wait `stopped`.
6. CloudFormation teardown (generalized flag-based: delete-stack only if *all* flags including the new `EnableSecretsManagerEndpoint` resolve to false; otherwise a targeted redeploy preserving whatever else is still on).
7. Cost leak check (run separately, as before).

## CloudFormation Changes

`infra/cloudformation/dev-on-demand.yaml`: added `SecretsManagerVpceSecurityGroupId` parameter, `EnableSecretsManagerEndpoint` parameter + `CreateSecretsManagerEndpoint` condition, `SecretsManagerVpcEndpoint` resource (`AWS::EC2::VPCEndpoint`, Interface type, reusing the existing persistent subnets/SG, preserving the exact current wide-open policy document, `PrivateDnsEnabled: true`), and `SecretsManagerVpcEndpointId` output. Also fixed the stale "direct Anthropic API" wording in `EnableNatGateway`'s description (Phase 1). **Validated via `aws cloudformation validate-template` — VALID.** Never deployed.

## Script Changes

- `dev-start.ps1`: new `-Backend`/`-Secrets` switches; `-Chat`/`-Ai`/`-Backend` auto-imply `-Secrets` (printed clearly, never silent); `Start-AuroraCluster`, `Set-DevScheduleState`, `Restore-DevSchedules` functions added; `SecretsManagerVpceSecurityGroupId` added to the deploy call.
- `dev-stop.ps1`: new `-Backend`/`-Secrets` switches (both explicit-only on stop, never auto-implied — something else may still need Secrets connectivity even after Aurora stops); SQS in-flight precondition; `Stop-AuroraCluster`, `Set-DevScheduleState`, `Suspend-DevSchedules` functions; the generalized stack-flag teardown extended to include `EnableSecretsManagerEndpoint`.
- `dev-status.ps1`: reports the Secrets Manager VPCE's actual state (no longer assumed-persistent) and warns if any DEV-pausable schedule is `ENABLED` while Aurora is not `available`.
- `dev-cost-leak-check.ps1`: Secrets Manager VPCE is now a conditional leak (present + nothing needs it = leak; present + Chat/ECS active = expected); added the same schedule-while-frozen check as a leak condition.

All 4 scripts re-parsed clean (0 errors). 7 dry-run combinations tested (`-Backend`, `-Network`, `-Ai`, `-Chat`, `-Secrets`, full `-Network -Chat -Ai -Backend`, plus `dev-stop.ps1 -Backend`/`-Secrets`) — all correctly isolated, no cross-contamination, exit 0.

**Live validation of the updated scripts against real current state** (read-only, before Phase 7.1's mutations): `dev-status.ps1` correctly reported 13 of 14 schedules `ENABLED` while Aurora is `stopped`; `dev-cost-leak-check.ps1` correctly flagged both the Secrets VPCE (present, nothing currently needs it) and the 13 schedules as real, pre-existing leaks - exit code 1, matching the live evidence exactly. These were genuine, previously-undetected findings this phase's own tooling first correctly surfaced, then (Phase 7.1) actually fixed.

## Phase 7.1 — Realized Results (owner-authorized controlled execution, same day)

Owner explicitly authorized two specific mutations: pausing the verified DEV schedules, and the Secrets VPCE create/delete migration. Both were performed and verified live.

**Pre-execution gate (Step 9) — all confirmed PASS before any deletion**: Aurora `stopped`, 0 schedules `ENABLED` (after the pause step below), Chat ECS `0/0`, NAT `0`, SQS in-flight `0`.

**Schedule pause** (Steps 2-7): Re-read live state first (14 total, 13 `ENABLED`, 1 `DISABLED` - the correction noted at the top of this document). Captured the pre-freeze snapshot of **all 14** schedules to `.dev/aws/scheduler-state.json` *before* disabling anything, then paused exactly the 13 `ENABLED` DEV-pausable ones via the full-document-preserving `Set-DevScheduleState` (reused verbatim, not reimplemented, from `dev-stop.ps1`). **Round-trip fidelity independently verified**: re-read `ai-autoaccept` and `gym-membership-payout` in full afterward - `Target.Input` (exact CRLF whitespace), `RetryPolicy`, `RoleArn`, `ScheduleExpression`, `ScheduleExpressionTimezone`, `Description` all byte-for-byte unchanged; only `State` and the output-only `LastModificationDate` changed. **`gym-partner-upload-sweep` empirically confirmed untouched** - its `LastModificationDate` is still `2026-09-20T23:35:27Z`, identical to before this phase, proving (not just asserting via code review) that it was never written to. Final check: `length(Schedules[?State=='ENABLED'])` = **0**.

**Secrets VPCE migration** (Steps 8-13): Re-captured the old endpoint (`vpce-063c1b646aa3de049`) immediately before deletion, confirmed unchanged from the original evidence capture. Deleted it (`aws ec2 delete-vpc-endpoints`, accepted immediately, polled to `InvalidVpcEndpointId.NotFound`). Verified immediately after: 9 secrets still listed, VPC/both private subnets `available`, SG `fitness-assistant-dev-vpce-sg` intact - nothing else touched. Ran the real `dev-start.ps1 -Secrets -Execute`: stack `CREATE_COMPLETE`, new endpoint `vpce-027b809d2864e878a` (confirmed different from the old ID), `available` immediately, `describe-stack-resources` confirms CloudFormation owns exactly this 1 resource, full detail matches (same VPC/subnets/SG/`PrivateDnsEnabled:true`/service name, policy document semantically identical). Then ran the real `dev-stop.ps1 -Secrets -Execute`: stack deleted (all flags resolved false), independently confirmed `InvalidVpcEndpointId.NotFound` on the new ID and `Stack ... does not exist` on the stack itself.

**Final frozen-state verification (Step 14), every field independently re-read**: Aurora `stopped`, NAT `0`, Chat ALB absent, Chat ECS `0/0`, OpenSearch VPCE `0`, **Secrets Manager VPCE `0`** (confirmed via `describe-vpc-endpoints --filters service-name=...secretsmanager` returning zero results - not even the generic VPC-endpoint count, the *specific* Secrets Manager one), unattached EBS `0`, OpenSearch collection `ACTIVE`, 9 secrets present, **0 schedules `ENABLED`**, `gym-partner-upload-sweep` confirmed `DISABLED`. **Every single target condition in the mission statement was met exactly.**

**Cost leak check (Step 15)**: `No cost leak detected.` Exit 0. `VPC Interface Endpoints present: 0` (down from 1 - genuinely zero interface endpoints of any kind now, a first for this entire engagement). `EventBridge schedules ENABLED while Aurora frozen: 0 of 13`.

**Step 16 explicitly honored**: `dev-start.ps1 -Backend -Execute` was never run. Aurora was never started. Schedules were never restored.

## Final Frozen State (realized, independently re-verified — not projected)

| Resource | State |
|---|---|
| Aurora | `stopped` (never started) |
| NAT | `0` |
| Chat ALB | `0`/absent |
| Chat ECS | `0/0` |
| OpenSearch VPCE | `0` |
| **Secrets Manager VPCE** | **`0`** - realized, not projected |
| Unattached EBS | `0` |
| **Scheduled DEV jobs** | **0 `ENABLED`** (13 paused this phase + `gym-partner-upload-sweep` independently `DISABLED`, confirmed untouched) |
| OpenSearch collection | `ACTIVE` |
| Secrets | `PRESENT` (9, values never touched) |
| Lambda/API Gateway/S3/IAM | `PRESENT`, untouched |

## Previous Baseline → Realized New Baseline

**PREVIOUS_FROZEN_BASELINE (Phase 6): ≈$18-19/month.**

**REALIZED_NEW_FROZEN_BASELINE** (from the live inventory above, not projected):

| Item | Approx. monthly |
|---|---|
| 9 Secrets Manager secrets | ≈$3.60 |
| Aurora storage (1 GiB, stopped) | ≈$0.10-0.15 |
| S3 + ECR | ≈$0.10 |
| Everything else (Lambda, API Gateway, SQS, OpenSearch OCU-when-idle, KMS, VPC Interface Endpoints - now genuinely **zero** of them) | ~$0 |
| **Realized total** | **≈$3.80-3.85/month** |

**REALIZED_MONTHLY_FIXED_SAVING: ≈$14.15-15.20/month** (~78-80% reduction) - this figure now reflects a real, verified infrastructure state, not a projection.

A secondary, now-fully-resolved finding: the 13 schedules' wasted Lambda compute (confirmed ~25s per failed `payment-jobs` attempt alone, every 5 minutes) has **stopped entirely** as of this phase - every DEV-pausable schedule is now `DISABLED`.

## Budget Alignment (recommendation only — not changed)

Current `fitness-assistant-monthly` AWS Budget: **$15/month**. Against the now-REALIZED baseline (~$3.80-3.85/month), this budget is comfortably **`APPROPRIATE`** - roughly 4x headroom over the fixed baseline alone, leaving most of the $15 for actual active development hours. **No AWS Budget was modified** - this is a recommendation only, and the recommendation is: no change needed.

## Remaining Risks

1. The "stray HTTP request during a frozen window" residual risk (documented in the Secrets VPCE Assessment above) is now live, not theoretical - a cold-start Lambda invocation with no cached credential will fail cleanly (before any DB touch) until the next `-Secrets`/`-Chat`/`-Ai`/`-Backend` start. Accepted for this DEV-only environment.
2. Aurora start has still never been tested, by script or manually, anywhere in this engagement, and was explicitly not attempted in Phase 7.1 either - the first real attempt on the owner's next work session should be treated as a genuine first-time test.
3. Schedule restore (`dev-start.ps1 -Backend -Execute` consuming `.dev/aws/scheduler-state.json`) has also never been tested live - the file's correctness was verified by direct inspection (content matches live pre-freeze state exactly), but the *restore code path* itself remains `IMPLEMENTED_STATICALLY` / `NOT_LIVE_VERIFIED`.
4. `.dev/aws/scheduler-state.json` is local, untracked repo state - if it's lost or the repo is cloned fresh on another machine before the next `-Backend` start, the restore function falls back to live-current-state (a safe no-op, not a guess), but the *specific* pre-freeze record captured today would not travel with it.

## Decision Gate Answers (Phase 17/7.1, final)

- `SECRETS_VPCE_ON_DEMAND`: **READY** - live-verified (create, verify, delete, re-verify)
- `SCHEDULE_FREEZE`: **READY** - live-verified (pause, round-trip fidelity, exclusion correctness)
- `AURORA_AUTOMATION`: **READY** (design/evidence) - execution still `NOT_LIVE_TESTED`, by explicit instruction this phase
