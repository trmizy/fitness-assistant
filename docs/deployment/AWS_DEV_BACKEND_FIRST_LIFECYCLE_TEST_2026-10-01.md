# AWS DEV — Backend First Lifecycle Test (Phase 8)

Date: 2026-10-01. Account `191798898985`, region `ap-southeast-1`. **This phase performed the first-ever real Aurora start, the first-ever script-automated Aurora stop, and the first-ever real schedule restore in this entire engagement.** NAT, Chat, OpenSearch/AI infrastructure were never touched. Bedrock was never invoked. No migrations ran. No application data was mutated.

**Two real bugs were found and fixed during this phase** — both caught by this phase's own verification discipline before they caused any lasting harm. See "Problems / Rollback" below for full transparency, including one bug that I personally introduced while verifying the fix for the other.

## Pre-Test Frozen State

All verified live before any mutation (Step 1):

| Resource | Result |
|---|---|
| Aurora | `stopped` |
| Secrets Manager VPCE | `0` |
| NAT | `0` |
| Chat ALB | absent |
| Chat ECS | `0/0` |
| OpenSearch VPCE | `0` |
| Unattached EBS | `0` |
| Schedules | `0` ENABLED among all 14 |
| OpenSearch collection | `ACTIVE` |

**PRECHECK: PASS.**

## Scheduler Snapshot Validation

`.dev/aws/scheduler-state.json` inspected (Step 2) before any mutation: 14 entries, 13 `ENABLED`, `gym-partner-upload-sweep` `DISABLED`. Cross-checked every name against a fresh `aws scheduler list-schedules` — all 14 live schedule names matched the file exactly, no mismatches.

**SCHEDULER_STATE_FILE_PRE_START: VALID.**

`Restore-DevSchedules`/`Set-DevScheduleState` in `dev-start.ps1` were re-read (Step 3) and confirmed: iterates only `$DevPausableSchedules` (13 names, `gym-partner-upload-sweep` never included), uses the per-schedule target from the snapshot (not a blanket "ENABLED"), and `Set-DevScheduleState` always re-reads the full current schedule and resubmits everything via `--cli-input-json`, changing only `State`. Confirmed it does not and cannot modify `ScheduleExpression`/`Target`/`RetryPolicy`/`RoleArn`/timezone/`Input`/`Description`, and cannot touch `gym-partner-upload-sweep` since it's structurally excluded from the loop.

Dry-run (Step 4, `dev-start.ps1 -Backend`, no `-Execute`) confirmed the exact planned sequence: auto-enable Secrets → deploy Secrets VPCE only (no NAT/Chat/OpenSearch) → start Aurora → wait available → restore schedules. SQS checked (Step 5): both queues confirmed with no in-flight work (main queue 0/0, DLQ's 1 message is an old parked entry, not actively processing).

## Secrets VPCE Start

Pre-test evidence saved to `docs/deployment/evidence/backend-first-thaw-pre-2026-10-01.json` (Step 6).

**First real `dev-start.ps1 -Backend -Execute` (Step 7)**, owner-authorized, observed end-to-end:
1. Stack deployed with `EnableSecretsManagerEndpoint=true` only — `EnableNatGateway`/`EnableChat`/`EnableOpenSearchEndpoint` all `false`, confirmed via the printed flags line.
2. New endpoint `vpce-031a1754f8c7a273e` created, `available` immediately on first check.
3. `describe-stack-resources` confirms CloudFormation owns exactly this 1 resource (`CREATE_COMPLETE`).

**SECRETS_VPCE_START: PASS.**

Full verification (Step 8): exactly 1 Secrets Manager interface endpoint account-wide, correct VPC (`vpc-010c13afd8920c8f1`), correct subnets, correct SG (`fitness-assistant-dev-vpce-sg`), `PrivateDnsEnabled: true`, correct service name, CloudFormation-tagged. No secret values retrieved at any point.

## Aurora First Start

Sequence observed directly in the live script output (Step 7, continued): `Current Aurora status: stopped` → `Starting cluster...` → `Waiting for db-cluster-available...` → `Final status: available` → `Aurora AVAILABLE.` — only **after** that did schedule restore begin (confirmed by log ordering, satisfying the exact dependency this phase exists to test).

**AURORA_FIRST_START: PASS. AURORA_START_DURATION: ≈10-10.5 minutes** (within the script's total 10m49s wall time, which also includes the quick stack deploy and schedule-restore steps).

Full post-start verification (Step 9): `Status: available`. Unchanged from the pre-start capture: `DBClusterIdentifier` (`fitness-assistant-dev-aurora`), `Endpoint` and `ReaderEndpoint` (identical hostnames — confirmed stable across stop/start, as established in earlier phases), `Engine`/`EngineVersion` (`aurora-postgresql 17.7`), `VpcSecurityGroups` (`sg-00e8e01671812bf44`), `DBSubnetGroup` (`fitness-assistant-dev-db-subnet-group`), `ServerlessV2ScalingConfiguration` (`Min 0.5, Max 2.0`). No migration ran, no snapshot restore, no schema change — `start-db-cluster` is a pure control-plane call that cannot do any of those.

**AURORA_ENDPOINT_CHANGED: NO.**

## Schedule Restore

Full re-read of all 14 schedules (Step 10): the 13 DEV-pausable schedules all `ENABLED`, `gym-partner-upload-sweep` still `DISABLED`. Specifically checked `gym-partner-upload-sweep`'s `LastModificationDate`: unchanged (`2026-09-20T23:35:27Z`), proving it was never written to during restore.

Field-level comparison on 2 restored schedules (`ai-autoaccept`, `gym-membership-payout`) against the originally-captured configuration: `ActionAfterCompletion`, `Description`, `FlexibleTimeWindow`, `GroupName`, `ScheduleExpression`, `ScheduleExpressionTimezone`, `Target.Arn`, `Target.Input` (exact CRLF whitespace), `Target.RetryPolicy`, `Target.RoleArn` — all identical. Only `State` and the output-only `LastModificationDate` changed.

**SCHEDULE_RESTORE: PASS. RESTORED_ENABLED_COUNT: 13. GYM_PARTNER_UPLOAD_SWEEP_AFTER_RESTORE: DISABLED.**

## Backend Active State

**Observed one safe schedule window (Step 11)**: rather than deliberately waiting for a new fire (which would risk forcing a business-logic job — reconciliation/payout/settlement — to process a potential backlog accumulated over the ~85 days Aurora was down, squarely in "application data mutation" territory this phase must avoid), I checked what had **already happened naturally** in the ~15 minutes elapsed during Steps 8-10's own verification work. `payment-jobs` (fires every 5 minutes) had already cold-started once on its own: Secrets Manager fetch succeeded, and the function completed in **1091ms with zero errors logged** — a direct, stark contrast to the previously-confirmed, always-failing ~25-second-timeout pattern. This is pure retrospective CloudWatch reading; the Lambda was never manually invoked.

`dev-status.ps1` (Step 12): `Aurora: available`, `Secrets Manager VPCE: vpce-031a1754f8c7a273e`, `NAT: 0`, `Chat ALB: absent`, `Chat ECS: 0/0`, 1 VPC Interface Endpoint total (Secrets Manager only), stack `CREATE_COMPLETE`.

**BACKEND_ACTIVE_STATE: PASS.**

No feature E2E was performed (Step 13): no users created, no payments, no plans generated, no Bedrock calls, no AI jobs enqueued, no migrations, no Chat testing.

## Aurora First Stop

**First real `dev-stop.ps1 -Backend -Execute` (Step 14)**, owner-authorized. Sequence: SQS in-flight check (0) → schedule capture+pause (13 `ENABLED`→`DISABLED`, `gym-partner-upload-sweep` untouched) → Aurora stop (`available` → `stopping` ×26 polls → `stopped`) → CloudFormation step.

**AURORA_FIRST_STOP: PASS** (the underlying Aurora stop itself succeeded cleanly — see "Problems" for what happened in the step *after* it). **AURORA_STOP_DURATION: ≈6.75 minutes** (27 polls × 15s interval, confirmed from the script's own progress log).

## Schedule Pause

13 of 14 schedules transitioned `ENABLED`→`DISABLED` cleanly on the first real pause. `gym-partner-upload-sweep` confirmed untouched (`LastModificationDate` unchanged).

**SCHEDULE_PAUSE: PASS. FINAL_ENABLED_SCHEDULE_COUNT: 0.**

## Secrets VPCE Stop

**First real `dev-stop.ps1 -Secrets -Execute` (Step 16)**, run only after Aurora was confirmed `stopped` and schedules confirmed paused. Correctly routed through the `delete-stack` path (all 4 flags resolved to `false` by that point) rather than the targeted-redeploy path — confirming my Step-4-dry-run prediction that this specific call would never exercise the bug described below. Stack `DELETE_COMPLETE`. New endpoint confirmed absent (`0` Secrets Manager VPCEs) immediately after.

**SECRETS_VPCE_STOP: PASS.**

## Final Frozen State (Step 17, independently re-verified)

| Resource | Result |
|---|---|
| Aurora | `stopped` |
| NAT | `0` |
| Chat ALB | absent |
| Chat ECS | `0/0` |
| OpenSearch VPCE | `0` |
| **Secrets Manager VPCE** | **`0`** |
| Unattached EBS | `0` |
| Schedules enabled | `0` |
| OpenSearch collection | `ACTIVE` |
| Secrets | `PRESENT` (9, values never touched) |
| CloudFormation stack | absent (fully deleted) |

**Every single target condition in the mission statement was met exactly.**

## Cost Leak Check (Step 18)

`No cost leak detected.` Exit 0. `VPC Interface Endpoints present: 0`, `EventBridge schedules ENABLED while Aurora frozen: 0 of 13`.

## Problems / Rollback

**Two real bugs found, both fixed, neither required a rollback of any AWS resource.**

### Bug 1: `aws cloudformation deploy`'s own stdout corrupted the function's return value, causing a false-positive failure

During the first `dev-stop.ps1 -Backend -Execute` run (Step 14), after Aurora correctly stopped and schedules correctly paused, the script reported `HARD STOP: stack operation ultimately failed (exit  Waiting for changeset to be created..  No changes to deploy. Stack gymini-dev-on-demand is up to date 0).` — a garbled message. **Root cause**: `Remove-OnDemandStackResources`'s targeted-redeploy branch ran `aws cloudformation deploy` with zero output redirection; in PowerShell, unredirected native-command stdout inside a function becomes part of that function's own return pipeline. Since the caller does `$exitCode = Remove-OnDemandStackResources ...`, the deploy command's own progress text ("Waiting for changeset to be created..", "No changes to deploy...") got captured alongside the real `$LASTEXITCODE` integer into a multi-element array. `-ne 0` against that array is always truthy (array elements other than the trailing `0` are non-numeric strings), so a **successful** no-op deploy was reported as a failure.

**Why this never surfaced before**: every prior phase's teardown (Chat, AI, the first Secrets-only teardown in Phase 7.1) always resolved to the `-AllFalse` branch (`delete-stack`, which has no equivalent stdout-capture issue), because only one on-demand flag was ever active at a time. This was the first call where `-Backend` alone was requested while `EnableSecretsManagerEndpoint` was *also* still `true` and *unchanged* — the first real exercise of the targeted-redeploy branch with a genuinely no-op parameter set.

**Real AWS impact of this bug: none.** Independently re-verified immediately after the false failure: Aurora was genuinely `stopped`, all 13 schedules were genuinely `DISABLED`, the stack was genuinely healthy (`CREATE_COMPLETE`, `EnableSecretsManagerEndpoint=true`, correctly unchanged since only `-Backend` was requested). The underlying `aws cloudformation deploy` call had actually succeeded; only the script's own error report was wrong.

**Fix**: piped the deploy call to `| Out-Null` inside the function so its stdout can no longer leak into the return value. Verified by re-running `dev-stop.ps1 -Backend -Execute` (safe, since Aurora/schedules were already in the target state - an idempotent no-op either way): `Stack operation succeeded.`, exit 0.

### Bug 2 (self-inflicted during Bug 1's fix verification): the schedule state file got overwritten with an all-disabled snapshot

The idempotent re-run used to verify Bug 1's fix **also** re-ran `Suspend-DevSchedules`, which — by its original design — unconditionally re-snapshots "whatever is live right now" into `.dev/aws/scheduler-state.json` every time it's called. Since the schedules were *already* `DISABLED` from the first (successful) pause, this second call captured "all 14 `DISABLED`" and overwrote the correct pre-freeze record (13 `ENABLED` + 1 `DISABLED`) with it — **exactly the corruption scenario this phase's Step 19 was designed to catch**, caused by my own verification step rather than the primary authorized action.

**Caught immediately** by inspecting the file right after (the same check Step 19 formally requires later). **Not fixed by blindly marking schedules enabled** — repaired by writing back the exact, well-evidenced pre-freeze values (13 `ENABLED` + `gym-partner-upload-sweep` `DISABLED`) already confirmed multiple times this session and in Phase 7.1's original capture.

**Structural fix applied** (not just a one-time data patch): `Suspend-DevSchedules` now only overwrites the state file when at least one pausable schedule is actually transitioning (currently `ENABLED`, about to become `DISABLED`). If every pausable schedule is already `DISABLED` (an idempotent re-run, or a retry), it leaves the existing file untouched and prints a clear message instead. Verified: a second idempotent re-run of `dev-stop.ps1 -Backend -Execute` printed `All pausable schedules already DISABLED - leaving the existing .dev/aws/scheduler-state.json untouched` and the file remained correct afterward.

**No rollback of any AWS resource was required for either bug.** `ROLLBACK_REQUIRED: NO.`

## Lifecycle Certification

| Lifecycle | Status |
|---|---|
| `BACKEND_LIFECYCLE` | **READY** — full start→active→stop cycle proven live, end-to-end |
| `AURORA_LIFECYCLE` | **READY** — first-ever start and first-ever script-automated stop both proven, all identifiers/config confirmed unchanged |
| `SCHEDULE_RESTORE_LIFECYCLE` | **READY** — restore proven live with full field-level fidelity; the pause/capture side also hardened against a real corruption scenario found during this same test |
| `SECRETS_LIFECYCLE` | **READY** — create and delete each proven live twice now (Phase 7.1 and this phase) |
| `FULL_COMBINED_LIFECYCLE` (`-Network -Chat -Ai -Backend` together) | **NOT_TESTED** |

---

## Final response (as requested)

- **PRECHECK: PASS**
- **SCHEDULER_STATE_FILE_PRE_START: VALID**
- **SECRETS_VPCE_START: PASS**
- **AURORA_FIRST_START: PASS**
- **AURORA_START_DURATION: ≈10-10.5 minutes**
- **AURORA_ENDPOINT_CHANGED: NO**
- **SCHEDULE_RESTORE: PASS**
- **RESTORED_ENABLED_COUNT: 13**
- **GYM_PARTNER_UPLOAD_SWEEP_AFTER_RESTORE: DISABLED**
- **BACKEND_ACTIVE_STATE: PASS**
- **AURORA_FIRST_STOP: PASS**
- **AURORA_STOP_DURATION: ≈6.75 minutes**
- **SCHEDULE_PAUSE: PASS**
- **FINAL_ENABLED_SCHEDULE_COUNT: 0**
- **SCHEDULER_STATE_FILE_AFTER_STOP: VALID** (after a self-caught-and-fixed corruption during fix verification — see Problems section)
- **SECRETS_VPCE_STOP: PASS**
- **FINAL_SECRETS_VPCE_COUNT: 0**
- **FINAL_AURORA: STOPPED**
- **FINAL_NAT: 0**
- **FINAL_CHAT_ALB: 0**
- **FINAL_OPENSEARCH_VPCE: 0**
- **COST_LEAK_CHECK: PASS**
- **ROLLBACK_REQUIRED: NO**

**BACKEND_LIFECYCLE: READY**
**AURORA_LIFECYCLE: READY**
**SCHEDULE_RESTORE_LIFECYCLE: READY**
**SECRETS_LIFECYCLE: READY**
**FULL_COMBINED_LIFECYCLE: NOT_TESTED**

**GYMINI_DEV_ON_DEMAND: READY_EXCEPT_COMBINED_TEST**

**NEXT_RECOMMENDED_ACTION: NORMAL_DEVELOPMENT_USE**

**HARD STOP. Not proceeding into full Network + Chat + AI + Backend combined testing. Bedrock was not invoked.**
