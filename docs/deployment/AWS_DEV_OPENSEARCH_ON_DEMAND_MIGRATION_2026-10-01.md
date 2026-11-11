# AWS DEV — OpenSearch Serverless VPC Endpoint On-Demand Migration (Phase 4)

Date: 2026-10-01. Account `191798898985`, region `ap-southeast-1`. Real AWS mutations performed, scoped strictly to the OpenSearch Serverless VPC endpoint and its network security policy's `SourceVPCEs` field. **The collection, its indexes/data, the data-access policy, the encryption policy, NAT, Chat, Aurora data, DB schema/data, Lambda code, API Gateway, IAM (read-only only), Secrets values, Bedrock, and SQS were never touched** — independently re-verified unchanged at the end (Step 20).

Builds on `docs/deployment/AWS_DEV_ON_DEMAND_INFRA_DESIGN_2026-10-01.md`, `docs/deployment/AWS_DEV_NAT_ON_DEMAND_MIGRATION_2026-10-01.md`, `docs/deployment/AWS_DEV_CHAT_ON_DEMAND_MIGRATION_2026-10-01.md`, and `docs/deployment/AWS_DEV_CHAT_FRONTEND_RUNTIME_CONFIG_DEPLOY_2026-10-01.md`.

## Summary

The OpenSearch Serverless VPC endpoint was migrated into the `gymini-dev-on-demand` CloudFormation stack's lifecycle. The network security policy now auto-reconnects to whatever endpoint ID currently exists via a reusable `Set-AossNetworkPolicyVpce` function built into both scripts. The cycle was proven once (create → verify → freeze → verify) and left frozen. **Two real bugs were found and fixed during this phase** (see below) — both caught by this phase's own verification discipline, neither left the account in an unsafe or corrupted state.

## Step 1-3 — live capture and dependency mapping

Full capture saved to `docs/deployment/evidence/opensearch-pre-migration-2026-10-01.json` (collection, VPC endpoint from both the EC2 and AOSS API perspectives, network/encryption/data-access policies in full). Policy backups also saved separately per instruction: `aoss-network-policy-before-2026-10-01.json`, `aoss-data-policy-before-2026-10-01.json`, `aoss-encryption-policy-before-2026-10-01.json`.

**Exhaustive, account-wide enumeration** (not scoped to the one collection — genuinely all policies in the account): exactly 1 network policy, 1 encryption policy, 1 data-access policy, 1 collection exist in this entire account/region. The old VPCE ID `vpce-067d43742cdb6b4d4` appears in **exactly one place**: `SourceVPCEs[0]` of the single network policy `auto-fitness-assistant-dev-ai-ve`.

| Reference | Location | Classification |
|---|---|---|
| `vpce-067d43742cdb6b4d4` in `SourceVPCEs` | AWS network security policy | `LIVE_AWS_POLICY` (the only one) |
| `OpenSearchCollectionName` default param | `infra/cloudformation/dev-on-demand.yaml`, `dev-start.ps1` | `SOURCE_CONFIG` (collection name label only, no VPCE ID) |
| Dry-run print placeholders | `dev-start.ps1`/`dev-stop.ps1` | `SOURCE_CONFIG` (no literal ID) |
| All other matches | `docs/deployment/*.md`, `docs/deployment/evidence/2026-10-01/*.json` | `DOC_ONLY` (historical reports/snapshots) |

No `STALE` or `UNKNOWN` references found. No VPC Link exists for this API (confirmed in Phase 3, unrelated to this phase but re-confirmed not to interact with OpenSearch at all).

## Step 2 — collection/data safety determination

Reasoned from AWS's actual resource model, then **empirically confirmed** (Step 14): `CreateCollection`/`DeleteCollection`, `CreateSecurityPolicy`/`DeleteSecurityPolicy`/`UpdateSecurityPolicy`, `CreateAccessPolicy`/`DeleteAccessPolicy`, and `CreateVpcEndpoint`/`DeleteVpcEndpoint` are 4 structurally independent AOSS API resource families with their own ARNs/IDs and no cascading-delete relationship. The collection (`t22tsiv3f1p8a9q5s1qi`) additionally has `deletionProtection: ENABLED` as an AWS-level safety net. The encryption policy (`AWSOwnedKey: true`) and the data-access policy (purely IAM-principal-based: 3 roles, zero VPCE references) have **zero** coupling to any VPC endpoint ID. **Conclusion: deleting the VPC endpoint cannot affect collection existence, indexes, stored vectors, or either of the other 2 policies.** No HARD STOP triggered. This was proven true in practice at Step 14 (collection stayed `ACTIVE`, same ID/ARN; data-access and encryption policy versions were bit-for-bit unchanged after the old endpoint's deletion).

## Step 4 — real AWS schema constraint discovered (changed the freeze design)

**Design intent going in**: Option B from the task's own list — delete the endpoint, then update the policy to remove the stale reference.

**What actually happened**: attempting `update-security-policy` with `SourceVPCEs: []` (and separately, with the whole top-level `policy` array empty `[]`) was **rejected by AWS's own schema validation**:
```
ValidationException: Policy json is invalid, error: [$[0].SourceVPCEs: there must be a minimum of 1 items in the array,
$[0].AllowFromPublic: must be a constant value true, ... ]
```
This is a real, previously-undocumented-in-this-project AWS constraint: a network policy rule-group requires **either** `SourceVPCEs` with ≥1 entry **or** `AllowFromPublic: true` — there is no valid "neither" state for an existing rule, and the top-level `policy` array itself also requires ≥1 rule-group.

**Decision, with the reasoning written down before acting**: the task explicitly forbids `AllowFromPublic=true` as a workaround. The only schema-valid alternative to "leave the stale reference" would be `delete-security-policy` + recreate on next thaw — a heavier, untested resource-lifecycle change that would briefly leave the collection with **zero** network policy coverage at all (not safer than the alternative) and require both scripts to grow a create-or-update branch. Given the stale reference is to an **already-deleted, inert** endpoint ID (confirmed: deletion itself caused zero issues, and a dangling ID that resolves to nothing is not a reachable path, public or private), leaving it in place is the lower-risk, schema-compliant choice. `Set-AossNetworkPolicyVpce` was changed to deliberately no-op (with a clear log message) when asked to remove an ID without providing a replacement, rather than attempt an update AWS would reject anyway. This is a transparent, reasoned deviation from Step 20's literal "no stale deleted VPCE ID" wording — documented here, not silently done.

The **thaw** path (always *replaces* the old ID with a new one in the same update, never leaving the array empty) was unaffected by this constraint and works exactly as originally designed.

## Step 5-6 — SG/subnet and CFN template verification

SG `sg-0b38ab22927b284ab` (`fitness-assistant-dev-lambda-sg`) and subnets `subnet-09e3230f7bca04c8e`/`subnet-02b39d77762465ef8` confirmed unchanged, already correctly referenced by the existing `LambdaSecurityGroupId`/`PrivateSubnetIds` CFN parameters (no SG rules loosened, no new rule added — none needed). `infra/cloudformation/dev-on-demand.yaml`'s `OpenSearchVpcEndpoint` resource (`AWS::OpenSearchServerless::VpcEndpoint`, properties `Name`/`VpcId`/`SubnetIds`/`SecurityGroupIds`) was already correct from Phase 1 — no template changes needed.

**Naming note** (same class of issue as Chat's ALB in Phase 3, caught proactively this time): the new endpoint's name is `dev-opensearch-vpce` (from `${EnvironmentName}-opensearch-vpce`), different from the old `fitness-dev-opensearch-vpce`. Checked in advance: neither `dev-status.ps1` nor `dev-cost-leak-check.ps1` reference the OpenSearch VPCE by name anywhere (both check by count/state only) — no stale-name bug exists here.

## Real bugs found and fixed during this phase

1. **Hardcoded `EnableOpenSearchEndpoint=false` in `dev-start.ps1`'s real `aws cloudformation deploy` call** — a leftover literal from Phase 2/3 (before `-Ai` was wired), never updated to the `$enableAi` variable. Caught immediately: the first real Step-15 attempt deployed a stack with `CREATE_COMPLETE` but **zero resources** (confirmed via `describe-stack-resources` returning `[]`), traced to `describe-stacks`'s `Parameters` showing `EnableOpenSearchEndpoint=false` despite `-Ai` being passed. No AWS resource was incorrectly created or left in a bad state — it was a no-op stack. Fixed, re-verified via regression dry-runs on `-Network`/`-Chat` (unaffected), retried successfully.
2. **`ConvertTo-Json` silently unwrapping a 1-element PowerShell array back into a bare object when piped**, producing `{...}` instead of the required `[{...}]` for the policy document — AWS rejected it (`"$: object found, array expected"`). Confirmed empirically in an isolated test (piping vs. `-InputObject` parameter passing) before fixing. Fixed in both scripts by passing the array via `-InputObject` instead of the pipeline. Neither bug caused any policy corruption — both were rejected cleanly by AWS/CloudFormation before taking effect, confirmed by re-reading the policy's `policyVersion` (unchanged) after each failed attempt.

## Real migration performed

| Resource | Old (removed) | New (CloudFormation-managed) |
|---|---|---|
| VPCE name | `fitness-dev-opensearch-vpce` | `dev-opensearch-vpce` |
| VPCE ID | `vpce-067d43742cdb6b4d4` | `vpce-0df04b684867df976` |
| VpcId/Subnets/SG | `vpc-010c13afd8920c8f1` / same 2 subnets / `sg-0b38ab22927b284ab` | identical (unchanged, reused by parameter) |

Create/delete timestamps: all within this session, 2026-10-01.

### Step 14 — old manual endpoint deletion
Re-verified live state immediately before mutation (endpoint `ACTIVE`, policy still referencing it — unchanged from Step 1's capture). `delete-vpc-endpoint` accepted immediately (`DELETING`), fully gone after ~110-120s (confirmed via polling until `RESOURCE_NOT_FOUND`). Immediately after, collection confirmed still `ACTIVE` with the same ID/ARN, and both the data-access and encryption policy versions confirmed bit-for-bit unchanged — Step 2's safety reasoning empirically proven, not just argued.

### Step 15-18 — real `dev-start.ps1 -Ai -Execute`
After the two bugfixes above, succeeded end-to-end: stack `CREATE_COMPLETE`, new VPCE `vpce-0df04b684867df976` reached `ACTIVE` on the very first poll, network policy updated (`policyVersion` changed from `MTc4OTQ2MTQxNTcyNF8x` to `MTc5MDg1Njg5OTUwNV8y`, confirming a real update happened) with `SourceVPCEs` now containing **only** the new ID (old ID fully removed, no duplication), `AllowFromPublic` confirmed still `false`, collection confirmed still `ACTIVE`. `describe-stack-resources` confirms CloudFormation owns exactly 1 resource (`OpenSearchVpcEndpoint`, `CREATE_COMPLETE`) — collection was never imported, remains external/persistent as designed. Re-running the same command a second time (after the first bug's no-op stack needed a retry) correctly reported **"No changes to deploy"** — idempotency confirmed in practice, not just by code inspection.

### Step 19 — first real AI infra freeze
`dev-stop.ps1 -Ai -Execute`: captured the current on-demand VPCE ID from the stack's own outputs before any teardown, deleted the whole stack (all flags resolved to false), then the policy-cleanup step correctly **skipped** with a clear explanation (the schema constraint from Step 4) instead of attempting an update AWS would reject. Collection re-confirmed `ACTIVE` immediately after.

### Step 20 — final frozen validation (independently re-verified)
| Check | Result |
|---|---|
| Aurora | `stopped` |
| NAT | `0` |
| Chat ALB | absent (`LoadBalancerNotFound`) |
| Chat ECS | `0/0` |
| OpenSearch collection | **PRESENT**, `ACTIVE`, same ID `t22tsiv3f1p8a9q5s1qi` |
| OpenSearch VPCE | **0** (`list-vpc-endpoints` → empty) |
| Secrets Manager VPCE | **PRESENT**, `available` |
| AOSS network policy | valid, queryable, `AllowFromPublic: false` confirmed — **does** still reference the now-deleted VPCE ID (accepted, documented exception; see Step 4) |
| Public OpenSearch access | **NOT ENABLED** (`AllowFromPublic` never touched from `false`) |

### Step 21 — cost leak check
```
Aurora status:                    stopped          -> OK
NAT Gateways available/pending:   0                -> OK
Chat ALB state:                   absent            -> OK
Chat ECS desired/running:         0/0               -> OK
VPC Interface Endpoints present:  1 (Secrets Manager only - down from 2 before this phase)
Unattached EBS volumes:           1 (vol-0c0a7abcb61186356) -> KNOWN_DEFERRED_ITEM, pre-existing, unrelated
```
Zero new leaks from this phase.

### Step 22 — second dry-run start
`dev-start.ps1 -Ai` (no `-Execute`) printed the correct recreate plan; independently confirmed no endpoint was recreated (`list-vpc-endpoints` → still empty). Exit code 0.

## Step 23 — rollback design (not needed, documented for completeness)

If a future recreation or policy update fails: (1) recreate a temporary AOSS VPC endpoint using the captured VPC/subnet/SG config from the evidence file; (2) wait `ACTIVE`; (3) run `Set-AossNetworkPolicyVpce` with the rollback endpoint's ID as `$NewVpceId` (re-reads the current `policyVersion` fresh, so this is safe regardless of how many updates happened in between); (4) verify `SourceVPCEs` contains the rollback ID and `AllowFromPublic` is still `false`. **Never** enable public access as a rollback step — if private reconnection genuinely cannot be restored, the correct escalation is to pause and ask the owner, not to open public access. **Not exercised this session** — every real step succeeded (after the 2 bugfixes above, both caught and fixed before any resource was left in a bad state).

## Files changed

- `scripts/aws/dev-start.ps1` — added `Set-AossNetworkPolicyVpce` function; wired real `-Ai -Execute` (deploy, wait `ACTIVE`, re-point policy, verify, verify collection); fixed the hardcoded `EnableOpenSearchEndpoint=false` bug; fixed the `ConvertTo-Json` array-unwrapping bug.
- `scripts/aws/dev-stop.ps1` — added the same `Set-AossNetworkPolicyVpce` function (consistent with this codebase's existing duplication-over-shared-module convention); added `-Ai` switch; captures the current VPCE ID before teardown; deliberately skips the (AWS-schema-invalid) empty-policy update with a clear explanation; verifies collection and endpoint-absence afterward.
- No changes needed to `infra/cloudformation/dev-on-demand.yaml` (already correct from Phase 1) or `dev-status.ps1`/`dev-cost-leak-check.ps1` (no stale-name issue existed).

## Evidence

- `docs/deployment/evidence/opensearch-pre-migration-2026-10-01.json`
- `docs/deployment/evidence/aoss-network-policy-before-2026-10-01.json`
- `docs/deployment/evidence/aoss-data-policy-before-2026-10-01.json`
- `docs/deployment/evidence/aoss-encryption-policy-before-2026-10-01.json`

---

## Final response (as requested)

- **OPENSEARCH_LIVE_CAPTURE: PASS**
- **COLLECTION_PRESERVED: YES** (same ID `t22tsiv3f1p8a9q5s1qi`, same ARN, `ACTIVE` throughout, confirmed independently at every stage)
- **OLD_VPCE_REMOVED: YES** (`vpce-067d43742cdb6b4d4`, confirmed `RESOURCE_NOT_FOUND`)
- **CFN_VPCE_CREATE_TEST: PASS**
- **NEW_VPCE_ID: vpce-0df04b684867df976**
- **NETWORK_POLICY_RECONNECT: PASS** (verified `SourceVPCEs` contains only the new ID, `AllowFromPublic` still `false`, `Rules`/`Resource` unchanged, `policyVersion` changed confirming a real update)
- **OLD_VPCE_REFERENCE_REMOVED: YES** (during thaw's reconnect) — **note**: during the subsequent *freeze*, the old-by-then reference (to the ID that was itself just deleted) is deliberately left in place due to the AWS schema constraint in Step 4; this is the one documented exception
- **PUBLIC_ACCESS_ENABLED: NO** (confirmed `AllowFromPublic: false` at every checkpoint, never touched)
- **CFN_VPCE_DELETE_TEST: PASS** (stack deleted, endpoint confirmed absent)
- **FINAL_OPENSEARCH_VPCE_COUNT: 0**
- **COLLECTION_STATUS: ACTIVE**
- **COLLECTION_ID_CHANGED: NO**
- **SECRETS_MANAGER_VPCE: PRESENT**
- **NAT: UNCHANGED_OFF**
- **CHAT: UNCHANGED_OFF**
- **AURORA: STOPPED**
- **DEV_START_AI: READY** (proven live, end-to-end, including a real idempotency check)
- **DEV_STOP_AI: READY** (proven live, end-to-end)
- **ROLLBACK_REQUIRED: NO** (2 bugs were caught and fixed before any mutation took effect — no AWS resource was ever left in an incorrect state requiring rollback)

**OPENSEARCH_ON_DEMAND: READY**

**NEXT_RECOMMENDED_PHASE: EBS_ORPHAN** — the one remaining known cost leak (`vol-0c0a7abcb61186356`, pre-existing since the original cost audit) is now the *only* open item across all 4 completed on-demand phases (NAT, Chat, Chat-frontend, OpenSearch). It's simple, well-isolated cleanup with no infrastructure-lifecycle risk, unlike a `FULL_DEV_START_STOP` combined-flags test (which would be reasonable but isn't urgent — each flag has already been proven individually).

**HARD STOP. Not continuing automatically into EBS or the full combined lifecycle.**
