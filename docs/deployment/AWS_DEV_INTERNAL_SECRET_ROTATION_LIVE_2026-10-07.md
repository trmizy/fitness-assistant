# AWS DEV INTERNAL_SERVICE_SECRET Coordinated Rotation — Live Execution — 2026-10-07 (Phase 13C-B)

No secret value — old or new, `INTERNAL_SERVICE_SECRET`, `INTERNAL_API_SECRET`, or
`PT_DOCUMENT_URL_SECRET` — appears anywhere in this report. Only resource names, status codes,
booleans, RevisionIds, and task-definition ARNs.

## Executive Summary

The full 13-resource coordinated rotation (12 Lambda functions' `INTERNAL_SERVICE_SECRET` + Chat's
ECS task definition's `INTERNAL_API_SECRET`) succeeded as a **controlled maintenance cutover** — not
claimed zero-downtime, per instruction, since no validator in this codebase accepts two valid values
at once. One real, pre-existing, unrelated AWS configuration issue (a stale ALB target-group
reference on the Chat ECS service) was found and fixed using an already-proven remediation already
present in this codebase's own `dev-stop.ps1`, not improvised. Functional verification passed
cleanly on the first attempt — no warm-execution-environment regression was observed. The continuous
test session remains active; Backend/Aurora was never stopped.

## Preflight

26/26 Pester unit tests (fake values) re-confirmed passing. Account `191798898985`, region
`ap-southeast-1` confirmed. Aurora was already `available` (continuous session, unchanged from
Phase 13C-A) — not restarted.

## PT Document Secret Bridge

**PASS.** Before touching the shared secret, User Lambda's `PT_DOCUMENT_URL_SECRET` was set to a
secure in-process copy of its own *pre-rotation* `INTERNAL_SERVICE_SECRET` value — read into a local
script variable, used immediately to build the update payload, and never printed, logged, or written
to any file on its own. Verified afterward via a key-presence-only query
(`contains(keys(@),'PT_DOCUMENT_URL_SECRET') = true`) — never a value comparison.
**`MODEL_SAW_PT_SECRET: NO`.** This freezes PT document link signing on the value that was valid
*before* this rotation, independent of the new shared value about to be generated — exactly the
hazard Phase 13C-A's design flagged.

## Maintenance Window

**PASS.** All 13 DEV-pausable schedules paused `ENABLED → DISABLED`, full schedule definitions
preserved field-for-field (same read-full/flip-`State`-only/resubmit pattern already proven in
`dev-start.ps1`/`dev-stop.ps1`). `gym-partner-upload-sweep` was never touched — confirmed throughout
this entire phase, see Schedule Restoration below.

## Target Inventory

Re-discovered live (not trusted from a stale hardcoded list): **12/12** expected Lambda functions
found, all with `INTERNAL_SERVICE_SECRET` present. **1/1** expected ECS task definition
(`fitness-assistant-dev-chat`) found, with `INTERNAL_API_SECRET` present, `desiredCount: 0`. Matched
Phase 13C-A's discovery exactly — no HARD STOP needed.

## Lambda Rotation

**12/12 succeeded**, one shared secret generated via `System.Security.Cryptography.RandomNumberGenerator`
inside the orchestrator's own process memory, never printed, used identically for every target:

| Function | LastUpdateStatus | EnvKeyCount | New RevisionId |
|---|---|---|---|
| auth | Successful | 10 | `14c4ce33-4284-4840-b6a2-e4b5ea0387c1` |
| user | Successful | 9 (reflects the earlier PT-bridge addition) | `8faec057-2088-445c-a6ff-4968143e3161` |
| fitness | Successful | 6 | `413b94dd-1bdb-4486-a4ac-23394c77bb04` |
| gym | Successful | 10 | `8e8ebe3c-e9ed-424e-91d5-ab0aee85d28c` |
| payment | Successful | 11 | `0ecf3f7f-3947-4260-b1a2-c22738ccf1b2` |
| ai | Successful | 22 | `00ef3e2d-ae0c-4e5a-a8fd-aa0dc382044e` |
| ai-worker | Successful | 22 | `9a6fec9b-6fe2-4248-ab73-aecf41a4d847` |
| fitness-jobs | Successful | 6 | `1b2f8d05-d938-4ecb-915f-4582da5200be` |
| ai-jobs | Successful | 13 | `877e1e81-2146-4857-987d-0440f00c60a9` |
| payment-jobs | Successful | 9 | `a3ffe890-cba8-4c8b-aea8-c26bde16d84a` |
| gym-jobs | Successful | 10 | `e27127da-7c87-4c6a-aab7-8330c2b6f9ca` |
| user-jobs | Successful | 6 | `dd82bf1e-d5da-48fb-ae54-cb9e8de9e56f` |

Every function's unrelated environment variables (VPC config, IAM role, etc. — not resent at all,
by construction) were preserved; only `INTERNAL_SERVICE_SECRET`'s value changed per function.

## Chat Task Definition Rotation

**PASS, after fixing one real, pre-existing, unrelated issue.** `register-task-definition` for a new
revision succeeded on the first try — correctly carrying over `runtimePlatform`
(`X86_64`/`LINUX`) and `ephemeralStorage` (`21 GiB`), two fields that a naive re-registration would
have silently dropped (AWS's `register-task-definition` does **not** inherit omitted fields from the
previous revision the way Lambda's `update-function-configuration` does) — caught and fixed during
this phase's own implementation, *before* running live, by inspecting the real task definition's
full field set first.

The follow-up `update-service` call (pointing the service at the new revision, `desiredCount`
untouched) **failed on its first attempt** with `InvalidParameterException: The target group
.../targetgroup/dev-chat-tg/3ef77da21c9e999d does not exist` — a stale ALB target-group reference
left over from an earlier Chat on-demand start/stop cycle, unrelated to this rotation. AWS validates
a service's **entire** existing configuration on any `update-service` call, not just the fields being
changed. Fixed using the exact "minimum safe detach" remediation **already documented and
implemented in `dev-stop.ps1`** for this identical scenario (`update-service --load-balancers "[]"`
first) — not a new workaround invented for this phase; the normal, unmodified `dev-start.ps1 -Chat`
flow already re-attaches the load balancer correctly whenever Chat is next properly started.

Confirmed after the fix (`describe-services`): `TaskDefinition = .../fitness-assistant-dev-chat:8`,
`DesiredCount = 0`, `RunningCount = 0`, `LoadBalancers = []`, `Status = ACTIVE`.

## Shared Value Consistency

**PASS.** Both `INTERNAL_SERVICE_SECRET` (12 Lambdas) and `INTERNAL_API_SECRET` (1 ECS task
definition) were set from the **exact same** single generated value in the same script run — never
independently generated per target. `MODEL_SAW_OLD_INTERNAL_SECRET: NO`,
`MODEL_SAW_NEW_INTERNAL_SECRET: NO` throughout every step.

## Functional Cross-Service Verification

Network started temporarily (NAT reached `available`) for this one verification pass, then stopped
immediately afterward. Fresh login + 4 reads, all clean:

| Test | Result |
|---|---|
| Login (admin) | PASS — HTTP 200, role `ADMIN` |
| User `GET /profile/me` | PASS — HTTP 200 |
| Fitness `GET /equipment/me` | PASS — HTTP 200 |
| Payment `GET /me/payments/methods` | PASS — HTTP 200 |
| Gym `GET /gyms` (public) | PASS — HTTP 200 |

**Honest scope note**: these prove each Lambda is healthy and the JWT-based end-user auth chain
(unaffected by this rotation) still works after each Lambda's environment-variable update — they are
general post-mutation regression/health checks, not a direct exercise of the
`x-internal-token`/`x-service-secret` code path itself. No safe way was found to trigger a genuine
internal-secret-gated call without starting AI/Chat or performing a mutating business flow (e.g. a
real PT application, payment completion, or chat message) — documented here as a real verification
gap for a future, more targeted test (e.g. a synthetic direct Lambda invoke carrying the header),
not glossed over as if it had been proven.

CloudWatch review (auth, user, fitness, payment, gym Lambda log groups, the test window): **zero
error-level (level 50) entries across all five.** `WARM_RUNTIME_REGRESSION: NO` — no stale-secret
mismatch was observed on the very first post-rotation attempt (unlike the JWT rotation's own
prediction of possible warm-container lingering, the two Lambda-side maintenance-window operations in
this same session had already cycled enough execution environments that no transition delay was
visible here either).

## AI Configuration Verification

`AI_INTERNAL_SECRET_CONFIG: PASS` — both `fitness-assistant-dev-ai` and `fitness-assistant-dev-ai-worker`
confirmed `LastUpdateStatus: Successful` as part of the 12-Lambda rotation above.
`AI_INTERNAL_SECRET_RUNTIME: NOT_RUN` — AI infrastructure was not started, per explicit instruction;
not required to certify this rotation.

## Chat Runtime Limitation

`CHAT_INTERNAL_SECRET_CONFIG: PASS` (new task-definition revision registered and the service now
points at it). `CHAT_RUNTIME_TEST: NOT_RUN` — `desiredCount` remained `0` throughout; Chat was never
started, per explicit instruction. The pre-existing, unrelated User/Fitness → Chat empty-secret
defect (found in Phase 13C-A) was **not** touched — `PREEXISTING_CHAT_CALLER_BUG_FIXED: NO`.

## PT Document Verification

`PT_DOCUMENT_RUNTIME_TEST: NOT_AVAILABLE` — no existing safe fixture or real PT document link was
available in this session to test against. Verified at the config/semantics level only:
`PT_DOCUMENT_URL_SECRET` is independently present on User Lambda and was frozen on its pre-rotation
value (decoupled from the newly-rotated shared secret) before the shared secret ever changed — the
essential safety property the bridge exists to guarantee.

## Schedule Restoration

All 13 DEV-pausable schedules confirmed `ENABLED` again. `gym-partner-upload-sweep` confirmed still
`DISABLED`, with its `LastModificationDate` **completely unchanged**
(`2026-09-20T23:35:27+07:00`) from before this entire phase began — proving it was never written to
at any point across the whole rotation, maintenance window, or restoration.

## Network Shutdown

Network was started once (for the functional test above) and stopped immediately afterward —
`NAT: 0` confirmed. Aurora/Secrets VPCE were never touched by this Network start/stop cycle (the
Phase 12A additive/subtractive lifecycle fix, live-certified in Phase 12B, held correctly here too).

## Continuous Test Session State

Backend was **not** stopped at any point. Final confirmed state:

| Resource | State |
|---|---|
| Aurora | `available` |
| Secrets Manager VPCE | `active` |
| NAT | `0` |
| 13 DEV-pausable schedules | `ENABLED` |
| `gym-partner-upload-sweep` | `DISABLED` (untouched) |
| Chat ECS | `desiredCount: 0`, points at the new task-definition revision `:8` |

Not a cost leak — an explicitly owner-authorized continuous test session. Final frozen-state
certification remains deferred until the session is explicitly ended.

## Pre-existing Findings

Carried over from Phase 13C-A, neither fixed nor newly caused by this phase:

- User/Fitness → Chat's `/internal/push-notification` calls still send an empty string as
  `x-internal-secret` (neither Lambda has `INTERNAL_API_SECRET` configured) — a pre-existing,
  best-effort, silently-caught failure, unrelated to this rotation.
- A newly-found, now-**fixed** issue (not pre-existing from a security standpoint, but a real
  operational gap): the Chat ECS service's stored config held a stale target-group reference from an
  earlier on-demand cycle. This is now cleared; the normal `dev-start.ps1 -Chat` flow will correctly
  re-attach a fresh target group the next time Chat is actually started.

## Remaining Security Work

- `INTERNAL_SERVICE_SECRET`/`INTERNAL_API_SECRET` are now rotated and verified — this specific
  exposure (from Phase 10) is closed.
- `JWT_SECRET`/`JWT_REFRESH_SECRET`: already rotated and verified in Phase 13B.
- `SMTP_PASS`: still un-rotated, still out of scope (requires an external Gmail app-password
  regeneration, not an AWS-side action).
- A genuinely direct, internal-secret-specific functional test (not just a general health check)
  remains a worthwhile future refinement — e.g. a synthetic Lambda-invoke event carrying the rotated
  header value directly against an internal route, bypassing the need for a full business-flow
  trigger or starting AI/Chat.
- The `INTERNAL_SERVICE_SECRET`/`INTERNAL_API_SECRET` naming split, and the broader duplicated-literal
  distribution model across 13 resources, remain open architectural debt — Phase 13C-A's Storage
  Hardening Analysis (Secrets Manager migration) is the recommended long-term direction, not
  implemented here (application code change, separately scoped).
