# AWS DEV Deployment Continuation Audit — 2026-10-07

Scope executed this session: **Phases 0–4 + this Phase 9 report only.** No AWS mutation, no DB
migration, no IAM/schedule/secret change, no Word document touched, per the owner's explicit
"HARD STOP — FIRST EXECUTION" instruction. All findings below are either (a) a live, read-only
AWS CLI/console-equivalent check run today, or (b) a historical doc fact explicitly labeled as
such and cross-checked against (a) wherever possible. Historical docs under `docs/deployment/`
were all committed to git in a single batch on 2026-10-06 regardless of their internal filename
dates (2026-09-29 → 2026-10-01) — **git commit date is not evidence of verification recency** and
was never used as such here.

---

## A. Actual AWS State (live, 2026-10-07)

Checked via `scripts/aws/dev-status.ps1` + `scripts/aws/dev-cost-leak-check.ps1` (both confirmed
100% read-only — no `-Execute` switch exists in either) and cross-checked with direct `aws` CLI
calls.

| Resource | Live state (today) | Matches last historical record? |
|---|---|---|
| Aurora (`fitness-assistant-dev-aurora`, db.serverless) | `stopped` | Yes |
| NAT Gateways | `0` | Yes |
| Chat ALB | absent | Yes |
| Chat ECS (`fitness-assistant-dev-chat-service`) | desired=0 running=0 (service exists, task def intact) | Yes |
| VPC Interface Endpoints (any) | `0` (Secrets Manager + OpenSearch both absent) | Yes |
| EventBridge schedules | all 14 `DISABLED` (13 pausable + `gym-partner-upload-sweep`, independently disabled, untouched) | Yes |
| `gymini-dev-on-demand` CFN stack | **does not exist** (`ValidationError: Stack … does not exist`, not just the script's friendly string) | Yes |
| EC2 instances | `0` | Yes |
| Unattached EBS volumes | `0` | Yes |
| Elastic IPs | `0` | Yes |
| OpenSearch Serverless collection (`fitness-assistant-dev-ai-vectors`) | `ACTIVE` (persistent, correctly still alive) | Yes |
| Cost-leak check | **PASS** — "No cost leak detected" | Yes |

**Conclusion: nothing has drifted in the 6 days since the last historical snapshot (2026-10-01).
The environment is exactly in the fully-frozen state Phase 8 left it in.**

### New finding (in no historical doc)
A stray CloudFormation stack exists: `ECS-Console-V2-Service-fitness-assistant-dev-chat-service-fitness-assistant-dev-cluster-eb4b17f6`,
status `CREATE_FAILED`, created 2026-09-22, reason `"The following resource(s) failed to create: [ECSService]"`.
This is debris from an AWS-Console "Create Service" wizard attempt, unrelated to `gymini-dev-on-demand`.
**Zero cost impact** (a `CREATE_FAILED` stack holds no running resources) but it is console clutter.
Safe, trivial delete candidate — not deleted this session (see §E, proposal #2).

### Two historical findings updated by live evidence
- **Payment Lambda VPC config**: historical docs (`AWS_DEV_RECOVERY_AUDIT` et al.) reported `VpcConfig: null`
  (BUG-P1, P0 — every DB-touching payment endpoint would 500). **Live check today shows a real
  `VpcConfig` with 2 subnets + 1 security group**, `LastModified: 2026-09-30T02:59:43Z`. This appears
  **already fixed** by a redeploy no later doc explicitly confirmed — but it has never been
  re-tested end-to-end since. Status: infra blocker resolved, **runtime health still unverified**.
- **Auth Lambda ("Group C" fix)**: `CodeSha256` live today is `8z1cfStUOiFL2TPmMiq7UXwcnmIfGKH6ARL0UZlTDuo=`,
  exactly matching the hash historical docs recorded as the deployed, verified transaction-atomicity
  fix. **Confirmed still deployed, unchanged.**

### Bedrock (re-verified live, read-only `GetFoundationModelAvailability` — no model invoked)
Both of Gymini's configured models are **still `NOT_AUTHORIZED` today**, identical to every prior
finding:
- `amazon.nova-pro-v1` → `authorizationStatus: NOT_AUTHORIZED` (entitlement/region both `AVAILABLE` — purely an account-level gate)
- `cohere.embed-multilingual-v3` → `authorizationStatus: NOT_AUTHORIZED` (same)

No successful Bedrock call has ever been recorded in this account. **This blocker has not changed.**

### Cost (real Cost Explorer data, not estimated from resource existence)
- **October 1–7, 2026 (MTD, estimated)**: **$4.25** total unblended cost. Breakdown: VPC $0.83,
  EC2-Other $0.69, Secrets Manager $0.69, Route 53 $0.95, RDS $0.23, ELB $0.28, Tax $0.40, ECR $0.01,
  rest ≈ $0. This is almost entirely attributable to Oct 1's active lifecycle testing (NAT/Chat/Secrets-VPCE
  briefly created+deleted, Aurora started+stopped — Phases 7/7.1/8) plus small flat recurring fees
  (Route 53 hosted zone, Secrets Manager per-secret charge, OpenSearch Serverless base).
- **September 2026 total**, queried fresh via Cost Explorer: returned **$0.0000002446** — this
  contradicts the historical doc's claimed "$147.84 gross Sept usage" and could not be reconciled
  within this session (possibly a Cost Explorer credits/normalization artifact). **Flagged as
  UNKNOWN — needs a direct AWS Billing Console check, not resolved by CLI here.** Neither the
  $147.84 nor the $0.00 figure should be treated as settled.
- The user-supplied "historical ~$3.80–3.85/month" figure and the repo's own "$18-19/month" Phase 6
  figure are **both superseded** by this live, zero-cost-leak frozen state — going forward, daily
  run-rate while frozen should be materially below either prior estimate.

### Not verified (deliberately, out of this session's safe scope)
**Admin seed-account rotation** (`admin@example.com` / `password123`, "Group A"): last historical
record states this was *prepared but never executed*. I could **not** verify current status without
either (a) starting Aurora to query the DB directly — an AWS mutation requiring approval — or
(b) attempting a live HTTP login against the real running app — not a pure AWS-infrastructure
read, and risks consuming rate-limiter budget / leaving an audit trail on a security-sensitive
account. **Neither was attempted.** This remains an **open, unverified security risk** and should
be the first thing explicitly addressed (see §E, proposal #1).

---

## B. Service Deployment Matrix

Status vocabulary: `READY` / `PARTIAL` / `BLOCKED` / `NOT_TESTED` / `UNKNOWN`. Maturity levels
(`RESOURCE_EXISTS` → `CONFIGURED` → `DEPLOYED` → `RUNTIME_HEALTHY` → `E2E_VERIFIED`) are **not**
collapsed into each other.

| Service | Resource/Config/Deployed | Runtime-healthy (today) | Last E2E result | Overall |
|---|---|---|---|---|
| Auth | Y / Y / Y (hash confirmed current) | NOT_TESTED (Aurora down) | 19/19 PASS (2026-09-29) | **PARTIAL** — functionally fine, but Group A admin-credential risk open |
| User | Y / Y / Y | NOT_TESTED (Aurora down) | 19/19 PASS (combined w/ Auth) | **PARTIAL** |
| Fitness | Y / Y / Y (redeployed 2026-09-30, after FitnessRoadmap routes added) | NOT_TESTED | 18/19 PASS historically; FitnessRoadmap fix status **UNKNOWN** since last doc, no confirming re-test exists | **PARTIAL** |
| Gym | Y / Y / Y | NOT_TESTED | 5/10 → 6/9 fixed; 3/9 "later fixed too" per an unconfirmed doc reference | **PARTIAL** — needs live re-check |
| Payment | Y / Y / Y (VPC config now present, contradicting old P0) | NOT_TESTED | 1/8 PASS historically (pre-VPC-fix) — never re-run since | **PARTIAL** — infra blocker looks resolved, but zero confirming E2E exists |
| AI (non-LLM admin endpoints) | Y / Y / Y | historically fixed (2026-09-30 redeploy) | 8/10 → fixed to 10/10 per docs | **READY** (admin/ops surface only) |
| AI (LLM/embeddings — the actual product feature) | Y / Y / Y (Lambdas, SQS, IAM all correct) | **BLOCKED** — `BEDROCK_ACCOUNT_AUTHORIZATION`, confirmed live today | Never successfully run | **BLOCKED** (external dependency) |
| Chat | Y / Y / Y (ECS service + task def persistent) | BLOCKED by design — desired=0, on-demand, needs deliberate start | BLOCKED when last tested (ECS was 0 then too) | **BLOCKED** — intentional on-demand state, not a defect |
| Frontend | Y / Y / Y | config/HTTP-level checks passed | **real-browser UI never tested** — explicitly NOT_TESTED, not PASS | **NOT_TESTED** |

---

## C. Verified Blockers by Category

- **AWS_AUTHORIZATION_BLOCKER**: Bedrock (`amazon.nova-pro-v1`, `cohere.embed-multilingual-v3`) —
  account-wide, confirmed live today, no IAM/SCP/inference-profile cause. Nova Pro has no
  self-service fix (AWS Support case required). Cohere has a real, unaccepted self-service
  agreement offer (`offerId 3d9erkgsks1ebtlsm5j442rot`) — prepared, never executed.
- **CONFIGURATION_BLOCKER** (likely already resolved, unconfirmed by E2E): Payment Lambda VPC
  config — live evidence contradicts the old P0 finding.
- **UNKNOWN**: September Cost Explorer total; Lambda migrate-function asymmetry (no `auth-migrate`/
  `user-migrate`/`fitness-migrate` functions exist, unexplained); EventBridge trigger mechanism for
  the 5 `*-jobs` Lambdas (no EventBridge *rules* found anywhere in the account for them — undetermined
  in every historical doc that checked, and not re-investigated this session since it's non-blocking).
- **EXTERNAL_DEPENDENCY**: Bedrock account authorization (same as above — AWS Support-side).
- **Application-level unsafe state** (not an AWS infra category, but real): unresolved admin
  seed-account credential exposure.

---

## D. Remaining Work

**A — basic backend**
- A1. Live Aurora-up `RUNTIME_HEALTHY` retest for Auth/User/Fitness/Gym/Payment against current
  Lambda code (none has been E2E-verified since the last redeploys + the Phase 8 Aurora restart).
  Dependency: Aurora start. Cost impact: Aurora serverless v2 ACU-hours + schedule-restore window,
  bounded if stopped promptly afterward (proven idempotent in Phase 8). Risk: LOW.
- A2. Admin seed-account rotation status (Group A) — unverified, real exposure if unresolved. Risk: HIGH.
- A3. Delete the stray `CREATE_FAILED` CFN stack. Risk: LOW, zero cost.

**B — frontend-backend integration**
- B1. Confirm FitnessRoadmap route actually serves correctly post-redeploy (never re-tested).
- B2. Confirm all 9 Gym admin namespaces return 200 (status split across untracked docs).
- B3. Real-browser frontend E2E — never performed in this project's entire AWS DEV history.

**C — AI**
- C1. Bedrock account authorization — external, needs AWS Support case (Nova Pro) and an explicit
  decision on the Cohere self-service agreement (it would consume the live, unaccepted offer).
- C2. `LLM_PROVIDER=anthropic` fallback is fully coded but `ANTHROPIC_API_KEY` was never provisioned —
  one new secret + env flip, zero code change, available **now** as an interim chat-only path (not
  embeddings/RAG). Requires an owner decision (new paid third-party key).
- C3. No embeddings/RAG fallback exists besides `mock` (poor relevance) or Ollama (not deployed in AWS).

**D — Chat**
- D1. Full combined `-Network -Chat -Ai -Backend` lifecycle — the one lifecycle never tested, by design.
- D2. Chat ALB is HTTP-only; not a live problem today, but a landmine if HTTPS is ever added without
  a coordinated ALB + frontend env change.

**E — optional**
- E1. 23 proven-safe FK constraints never applied (zero orphans confirmed, no urgency).
- E2. EventBridge trigger mechanism for `*-jobs` Lambdas undetermined — worth a 10-minute read-only
  check, not blocking.
- E3. Lambda migrate-function asymmetry — likely by design, unconfirmed.

**F — deferred / externally blocked**
- F1. Same as D1.
- F2. `JWT_SECRET`'s deployed value has deliberately never been inspected — still unknown whether
  it's a safe generated value; can be checked for provenance/entropy metadata without ever printing it.

---

## E. Recommended Next Deployment Step

Given mandatory cost discipline (never activate everything at once) and the severity ordering above,
the highest-priority next action is **not** a new AWS resource — it's resolving the one real
open security risk, followed by the cheapest possible live-health retest:

### Proposal 1 — Resolve/verify the admin seed-account exposure
- **AWS resource / operation**: none directly — this requires either starting Aurora (to check the
  DB directly) or performing an authenticated action against the live app. **I am not proposing
  either method myself; I'm flagging that the owner must choose the method before I touch anything
  security-sensitive.**
- **Why**: last record states the Group A password rotation was prepared but never executed — if
  true, a known default admin credential may still be live on a public-facing deployment.
- **Expected result**: either confirmation the password was already rotated (no action needed) or
  execution of the already-prepared rotation (`PATCH /auth/me/password`).
- **Estimated incremental cost**: $0 if done via API call once Aurora/backend is already up for
  another reason; otherwise bundled into Proposal 2's Aurora window.
- **Expected active duration**: seconds (one API call).
- **Rollback**: none needed (password rotation is not destructive; old password simply stops working).
- **Verification**: confirm new password works, old one doesn't.

### Proposal 2 — Smallest-footprint live retest: `dev-start.ps1 -Backend -Execute` → verify → `dev-stop.ps1 -Backend -Execute`
- **AWS resource / operation**: Secrets Manager VPC endpoint (create) → Aurora (start) → EventBridge
  schedule restore (13 schedules → ENABLED, `gym-partner-upload-sweep` untouched) → live E2E retest
  of Auth/User/Fitness/Gym/Payment → Aurora (stop) → schedule pause → Secrets VPCE (delete).
- **Why**: this exact lifecycle was already proven live, twice, in Phase 7.1/Phase 8, including two
  bugs found and fixed. It's the cheapest way to get `RUNTIME_HEALTHY`/`E2E_VERIFIED` evidence for
  5 of 7 services without touching NAT, Chat, or AI (all of which stay at $0 and 0 resources).
- **Expected result**: either confirmation all 5 services are healthy against current code, or a
  narrow, evidenced defect to fix (same discipline used throughout this project's history).
- **Estimated incremental cost**: Aurora Serverless v2 ACU-hours for the active window
  (historically ≈17 minutes start+stop overhead plus however long the retest itself takes) +
  Secrets VPCE hourly charge for the same window — low single-digit dollars at most for one cycle.
- **Expected active duration**: as short as the retest requires; stopped immediately afterward
  (never left idle, per cost discipline).
- **Rollback**: `dev-stop.ps1 -Backend -Execute` (already proven idempotent and safe).
- **Verification**: `dev-status.ps1` + `dev-cost-leak-check.ps1` after stop, confirming return to
  today's exact frozen state.

### Proposal 3 (low priority, housekeeping) — delete the stray `CREATE_FAILED` CFN stack
- **AWS resource / operation**: `aws cloudformation delete-stack --stack-name ECS-Console-V2-Service-fitness-assistant-dev-chat-service-fitness-assistant-dev-cluster-eb4b17f6`
- **Why**: pure console clutter from an abandoned wizard attempt, zero running resources.
- **Expected result**: stack removed from the account's stack list.
- **Estimated incremental cost**: $0 (nothing is running under it).
- **Expected active duration**: N/A (one-time delete).
- **Rollback**: none needed/possible — nothing of value exists in a `CREATE_FAILED` stack.
- **Verification**: `describe-stacks` returns "does not exist."

**Explicitly not proposed yet**: NAT/Chat/AI on-demand activation, the full combined 4-flag lifecycle,
any Bedrock remediation action, any ANTHROPIC_API_KEY provisioning — all deferred until the above is
resolved and/or the owner makes the relevant product decisions (see §D).

---

## F. Repository Changes This Session

**One file added**: this report (`docs/deployment/AWS_DEV_CONTINUATION_AUDIT_2026-10-07.md`).
**Zero code changes.** No AWS mutation of any kind was performed — every AWS CLI call made this
session was a `describe-*`/`list-*`/`get-*` read (confirmed: `sts get-caller-identity`, `rds
describe-db-clusters/instances`, `ec2 describe-nat-gateways/vpc-endpoints/instances/volumes/addresses`,
`elbv2 describe-load-balancers`, `ecs list-clusters/list-services/describe-services`, `cloudformation
list-stacks/describe-stacks/validate-template`, `opensearchserverless list-collections`, `lambda
list-functions/get-function-configuration`, `sqs list-queues/get-queue-attributes`, `apigatewayv2
get-apis`, `secretsmanager list-secrets` (names only, no `get-secret-value` ever called), `scheduler
list-schedules`, `bedrock get-foundation-model-availability`, `ce get-cost-and-usage`).

---

## G. Final Decision

**BLOCKED_BY_UNSAFE_STATE**

Reasoning: the AWS infrastructure itself is in a safe, verified, cost-clean frozen state with no
drift from its last known-good snapshot — on pure infra hygiene grounds this could read as
"ready." But two real gating facts prevent recommending any further deployment action right now:

1. **An unresolved, unverified admin-credential exposure** (`admin@example.com` /
   `password123`) on a plan that was explicitly prepared but, per every available record, never
   executed — a genuine security risk on what would be a public-facing service once more of the
   backend comes up.
2. **Five of seven services have zero confirming runtime-health evidence against their current
   deployed code** — the last E2E runs predate later redeploys (VPC-config fix, route additions,
   gym admin-namespace fixes), so "deployed" is confirmed but "actually working" is not, for Auth/
   User/Fitness/Gym/Payment.

Bedrock's `BEDROCK_ACCOUNT_AUTHORIZATION` blocker is real and unchanged, but it gates only the AI
LLM/embeddings feature specifically — it does not, by itself, justify blocking the rest of the
stack, so it is reported under §C/§D rather than driving the top-level verdict.

**Recommended path, in order**: resolve/verify Proposal 1 (admin credential) → run Proposal 2
(backend-only retest, smallest footprint, already-proven lifecycle) → re-run `dev-cost-leak-check.ps1`
to confirm return to frozen state → only then revisit AI/Chat/NAT activation decisions, each
requiring its own explicit approval.

**STOP. Awaiting explicit approval for Proposal 1 and/or Proposal 2 before any AWS mutation is performed.**
