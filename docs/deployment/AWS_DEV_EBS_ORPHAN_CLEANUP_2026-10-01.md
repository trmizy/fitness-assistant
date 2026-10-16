# AWS DEV — EBS Orphan Forensic Check + Cleanup (Phase 5)

Date: 2026-10-01. Account `191798898985`, region `ap-southeast-1`. One real AWS mutation performed: deletion of `vol-0c0a7abcb61186356`, after an exhaustive forensic investigation. Aurora, NAT, Chat, OpenSearch, Lambda, API Gateway, ECS, IAM, Secrets, S3, Bedrock, and database data were never touched — confirmed unaffected at the end (Step 14).

## Volume identity

| Field | Value |
|---|---|
| VolumeId | `vol-0c0a7abcb61186356` |
| State (before deletion) | `available` |
| Size / Type | 20 GiB / `gp2` (100 IOPS, no configurable throughput — gp2 has none) |
| AZ | `ap-southeast-1a` (`apse1-az2`) |
| CreateTime | `2026-07-08T09:15:20.444Z` |
| Encrypted | `false`, no KMS key |
| SnapshotId (origin) | `snap-0e8998fbd84787b5f` — **confirmed deleted**, `InvalidSnapshot.NotFound` |
| MultiAttachEnabled | `false` |
| Attachments | `[]` (none) |
| Tags | **none** (confirmed via `describe-tags`, zero tags) |

## Forensic reconstruction (full CloudTrail chain, timestamps UTC)

All events found via `aws cloudtrail lookup-events` (Event History, no dedicated Trail configured in this account — confirmed `describe-trails` returns empty, so this is the only available source, and it had full coverage for this date range).

| Time (UTC) | Event | Actor | Detail |
|---|---|---|---|
| 08:50:55 | `ImportImage` | IAM user `vmimport-admin` (console, this same AWS CLI/account) | Imports `Ubuntu-disk1.vmdk` from S3 bucket `import-bucket-2023-191798898985-ap-southeast-1-an`. Task `import-ami-3842cc4193e8abb4t`. |
| 08:50:54-09:11:17 | `CopySnapshot` (x2) | role `vmimport` (AWS VM Import service) | Internal conversion pipeline, produces `snap-0e8998fbd84787b5f`. |
| 09:11:24 | `RegisterImage` | role `vmimport` | Creates AMI `ami-0f7f7a0d1841cedca` ("Ubuntu 26.04 LTS"), root device `/dev/sda1` mapped to `snap-0e8998fbd84787b5f` with **`deleteOnTermination: false`** (the AMI's own default — this is the detail that explains everything that follows). |
| **09:15:19** | `RunInstances` | Root user (AWS Console, Chrome) | Launches `i-0e461d34f76b84b53`, tagged `Name: Import-Server`, from `ami-0f7f7a0d1841cedca`. Launch request does not override the block device mapping. |
| **09:15:20.444** | *(volume CreateTime)* | — | `vol-0c0a7abcb61186356` created as this instance's root volume — **1 second after** the `RunInstances` call above, from the exact same snapshot ID. |
| 09:29:39 | `TerminateInstances` | Root user (same console session) | Terminates `i-0e461d34f76b84b53`. Because the AMI's mapping said `deleteOnTermination: false` and the launch never overrode it, **the root volume survives termination** instead of being auto-deleted (the normal default behavior AWS uses for most AMIs). |
| 09:30:17 | `DeregisterImage` (`deleteAssociatedSnapshots: true`) → triggers `DeleteSnapshot` | Root user (same console session) | Deregisters `ami-0f7f7a0d1841cedca` and explicitly deletes `snap-0e8998fbd84787b5f` as part of the same action. |

**Narrative**: this was a one-time, manual Ubuntu VM-import experiment, run entirely by the account's root user via the AWS Console within a single ~15-minute session (08:50-09:30 UTC). The user imported a VM disk, registered it as an AMI, launched a test instance from it ("Import-Server"), then deliberately cleaned everything up — terminated the instance and deregistered the AMI with its snapshot. The **only** thing that survived this cleanup was the instance's root volume, purely because the imported AMI's block-device mapping had `deleteOnTermination: false` (a known AWS VM-Import default) and the launch request never changed it. It has sat unattached, untagged, and unused for the ~85 days since. **This has nothing to do with the Gymini/fitness-assistant application** — it is VM-import tooling debris.

## Step 2 — dependency check (exhaustive)

| Checked | Result |
|---|---|
| EC2 instances in account | **0** (`describe-instances` → empty) |
| Launch templates | **0** |
| Auto Scaling groups | **0** |
| AMIs owned by account | **0** |
| Snapshots owned by account | **0** |
| CloudFormation stacks | **0** (all on-demand stacks from Phases 2-4 are frozen/deleted) |
| Repo references | `docs/deployment/*.md` only — `DOC_ONLY` (this phase's own prior reports naming it as a known cost leak; zero `ACTIVE_CONFIG` references in any script, template, or source file) |

No active AWS resource of any kind references this volume. No HARD STOP triggered.

## Step 4 — root/data/temp classification

**ROOT_VOLUME** — confirmed directly: the AMI's block device mapping names it `rootDeviceName: /dev/sda1`, and the launched instance's `rootDeviceType: ebs` / `rootDeviceName: /dev/sda1` match exactly. Not a data volume (no evidence of application/database use — this was a generic freshly-imported OS disk that was running for only ~14 minutes before termination, with no indication any workload was ever deployed onto it).

## Step 5 — snapshot safety

**No snapshot exists for this volume.** Its *origin* snapshot (`snap-0e8998fbd84787b5f`) was itself deliberately deleted by the same user in the same cleanup session (see table above) — confirmed via `describe-snapshots` → `InvalidSnapshot.NotFound`. Per instruction, the absence of a snapshot alone doesn't make deletion unsafe, but raises the evidence bar — which this case clears by a wide margin given the complete, cross-confirmed CloudTrail chain.

## Step 6 — cost evidence (real Cost Explorer data, not fabricated)

Actual September 2026 billed amount for `APS1-EBS:VolumeUsage.gp2` (Cost Explorer, `UnblendedCost`): **effectively $0** (a `-0.0000002151` rounding artifact), consistent with this 20 GiB volume falling entirely within AWS's EBS free-tier allowance (30 GB-month of gp2/gp3 storage). It would cost approximately **$2/month** at standard ap-southeast-1 gp2 rates (~$0.10/GB-month) once/if free-tier coverage lapses. **Classification: LOW** — not material today, not exactly negligible as an ongoing liability either.

## Step 8 — classification gate

**SAFE_ORPHAN** — every required condition confirmed true:
- `State == available` ✓, zero attachments ✓
- No active AWS dependency of any kind (Step 2, exhaustive) ✓
- Previously-attached instance (`i-0e461d34f76b84b53`) confirmed terminated/gone (`InvalidInstanceID.NotFound`) ✓
- No CloudFormation ownership (0 stacks exist) ✓
- No active config references it (repo search: `DOC_ONLY` only) ✓
- Strong evidence of one-time/historical use (complete CloudTrail chain, same-session cleanup intent) ✓
- No unresolved indication of required data (generic OS test image, zero workload evidence) ✓

Confidence level: very high — not a marginal call. The full chain (`ImportImage → RegisterImage → RunInstances → [volume created 1s later from the same snapshot] → TerminateInstances → DeregisterImage+DeleteSnapshot`) is continuous, timestamped to the second, and entirely self-consistent. Per Step 10's instruction, a snapshot-approval pause is warranted only for "small residual uncertainty" — given the completeness of this evidence, no such uncertainty was judged to remain, so deletion proceeded without pausing for a snapshot decision (none was created).

## Deletion performed

- Pre-delete evidence saved: `docs/deployment/evidence/ebs-orphan-pre-delete-2026-10-01.json`
- Immediately before deletion, re-read state: `State: available`, `Attachments: []` — unchanged from Step 1.
- `aws ec2 delete-volume --volume-id vol-0c0a7abcb61186356` — exit 0.
- Polled `describe-volumes` — confirmed `InvalidVolume.NotFound` on the very first check (deletion was immediate).
- **Deletion timestamp**: 2026-10-01, this session.

## Final verification

| Check | Result |
|---|---|
| `dev-cost-leak-check.ps1` | **"No cost leak detected." exit 0** — the first fully clean result across this entire multi-phase engagement |
| NAT | `0` |
| Chat ALB | absent |
| Chat ECS | `0/0` |
| OpenSearch collection | `ACTIVE`, unaffected |
| OpenSearch public access | `false`, unaffected |
| Secrets Manager VPCE | `present` |
| Aurora | `stopped`, unaffected |
| Unattached EBS volumes | **0** |

No unexpected AWS resource changed. All prior phases (NAT/Chat/Chat-frontend/OpenSearch) confirmed exactly as they were left.

---

## Final response (as requested)

- **EBS_VOLUME: vol-0c0a7abcb61186356**
- **CURRENT_STATE: deleted** (was `available` before this phase)
- **SIZE: 20 GiB**
- **TYPE: gp2**
- **PREVIOUS_ATTACHMENT_FOUND: YES**
- **PREVIOUS_INSTANCE: i-0e461d34f76b84b53** (tagged `Name: Import-Server`)
- **PREVIOUS_INSTANCE_STATE: terminated** (confirmed gone, `InvalidInstanceID.NotFound`)
- **ROOT_OR_DATA_VOLUME: ROOT**
- **SNAPSHOT_EXISTS: NO** (origin snapshot deliberately deleted in the same cleanup session)
- **ACTIVE_DEPENDENCY: NO** (exhaustively checked: 0 instances, 0 launch templates, 0 ASGs, 0 AMIs, 0 snapshots, 0 CFN stacks, 0 active repo references)
- **CLASSIFICATION: SAFE_ORPHAN**
- **DELETION_PERFORMED: YES**
- **FINAL_UNATTACHED_EBS_COUNT: 0**
- **AURORA: STOPPED**
- **NAT: 0**
- **CHAT_ALB: 0**
- **OPENSEARCH_VPCE: 0**
- **SECRETS_MANAGER_VPCE: PRESENT**
- **COST_LEAK_CHECK: PASS** (clean, exit 0 — zero leaks of any kind)

**EBS_ORPHAN: CLEANED**

**NEXT_RECOMMENDED_PHASE: COST_BASELINE_FINALIZATION** — every known cost leak from the original `AWS_DEV_EMERGENCY_COST_AUDIT_2026-10-01.md` (NAT, Chat ALB, OpenSearch VPCE, this EBS volume) has now been resolved across Phases 2-5, each independently proven to freeze/thaw correctly. A clean, documented cost baseline snapshot is the natural close-out — more useful right now than a `FULL_DEV_START_STOP` combined-flags stress test (each flag has already been individually proven; combining them is lower-priority validation, not cost-recovery work) or `REVIEW_EBS` (nothing left to review — the volume is gone and the classification evidence is conclusive, not marginal).

**HARD STOP. Not automatically performing the combined full lifecycle test.**
