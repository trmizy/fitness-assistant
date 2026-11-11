# AWS DEV On-Demand Lifecycle State Fix — 2026-10-07 (Phase 12A)

Local code fix + regression tests only. **Zero AWS mutations were performed** - every AWS call made
while validating this phase was a read-only `describe-*`/`get-*` call via dry-run (`dev-start.ps1`/
`dev-stop.ps1` without `-Execute`).

## Root Cause

`dev-start.ps1` and `dev-stop.ps1` each computed the CloudFormation parameter set to deploy from
**only the switches passed to that one invocation**, defaulting every unmentioned flag to `"false"`
(start) or deriving the target purely from the current call's own flags (stop). Confirmed by reading
the actual code (not assumed from any historical report): the old start-side logic was

```powershell
$enableNat = if ($Network) { "true" } else { "false" }
...
$enableSecrets = if ($Secrets -or $impliedSecrets) { "true" } else { "false" }
```

— every flag not explicitly true on *this* call resolved to `"false"`, regardless of what was
already live. Calling `dev-start.ps1 -Network -Execute` after an earlier, separate `-Backend -Execute`
call had turned `EnableSecretsManagerEndpoint` on therefore silently redeployed the stack with that
parameter back to `"false"`, deleting the Secrets Manager VPC endpoint Backend still needed — exactly
the bug Phase 11 discovered live.

## Previous Unsafe Behavior

- **START was not additive**: any single-flag start call reset every other CFN-tracked flag to its
  default-off value unless it happened to also be passed that same call.
- **STOP did read current parameters**, but only inside the one branch that already assumed the
  stack exists, and it never protected the Secrets dependency: requesting `-Secrets` alone while
  Backend/Chat/Ai were still live would have torn down a resource they still needed, with no refusal
  and no warning beyond whatever each dependent's own next cold start would fail with later.
- Mutating actions (`Suspend-DevSchedules`, `Stop-AuroraCluster`, the Chat runtime-config push) could
  begin **before** the CloudFormation target state was even computed, so an unsafe combination could
  get partway applied before anything would have caught it.

## Desired Semantics

- **START = set union.** `desired[flag] = current[flag] OR requested[flag] OR (implied by another
  requested flag's dependency)`.
- **STOP = set difference.** `desired[flag] = current[flag] AND NOT requestedOff[flag]` — nothing
  not explicitly requested off ever changes.
- **Secrets dependency preserved in both directions**: Backend/Chat/Ai requested-ON implies
  Secrets-ON (start, unchanged from before); Secrets is **never** auto-turned-off on stop just
  because its last dependent stopped in the same call (this matches the project's own pre-existing,
  deliberate design — `-Secrets` was already documented as "explicit only, never auto-implied on
  stop" — so the fix extends that same philosophy rather than inventing a new one). If `-Secrets` is
  explicitly requested off while Backend/Chat/Ai would still be on afterward, the whole operation is
  refused (Option A from the brief) rather than silently preserved (Option B) or silently applied —
  **no partial mutation happens at all** in that case.

## Implementation

New file `scripts/aws/lib/DevLifecycle.psm1` — a PowerShell module of **pure functions** (no AWS
calls inside the resolution logic itself, so they can be unit-tested without touching AWS):

- `Get-CurrentStackState` / `Get-CurrentAuroraState` — the only two functions that call AWS, each a
  single read-only `describe-*` call, returning the current ON/OFF state as plain booleans.
- `Resolve-DesiredStartState($Current, $Requested)` — pure set union + dependency implication.
- `Resolve-DesiredStopState($Current, $RequestedOff)` — pure set difference + dependency refusal,
  returns `{ Blocked, Reason, Desired }`.
- `Test-ShouldCaptureScheduleSnapshot` — extracted from `Suspend-DevSchedules`'s existing Phase-8 bug
  fix, now a pure, independently-testable function instead of inline logic.
- `Format-LifecyclePlan` — renders the CURRENT STATE / REQUESTED CHANGE / RESOLVED TARGET STATE block
  now printed by both scripts, in both dry-run and `-Execute` modes. Never touches secret values -
  every field is a subsystem name or a boolean.
- `Get-DevPausableSchedules` / `Get-DevIndependentSchedule` / `Get-DevAllKnownSchedules` — the 13/1/14
  schedule-name lists, previously duplicated verbatim in both scripts, now defined once.

`dev-start.ps1` and `dev-stop.ps1` were updated to import this module and call it instead of
re-deriving flags inline. **No other logic in either script changed** — `Start-AuroraCluster`,
`Stop-AuroraCluster`, `Set-DevScheduleState`, `Restore-DevSchedules`, `Suspend-DevSchedules`,
`Set-AossNetworkPolicyVpce`, the account/region/stack-name guards, the ECS/SQS precondition checks,
the Chat ALB/API-Gateway/runtime-config reconnect steps, and the final read-only verification steps
are byte-for-byte what they were before, just now fed resolved values instead of locally-recomputed
ones.

## Dependency Resolution

Confirmed directly from `infra/cloudformation/dev-on-demand.yaml` (not inferred from documentation):
only 4 real CloudFormation parameters exist — `EnableNatGateway`, `EnableChat`,
`EnableOpenSearchEndpoint`, `EnableSecretsManagerEndpoint` (Network/Chat/Ai/Secrets). **Backend/Aurora
has no CloudFormation parameter at all** — it is started/stopped directly via the RDS API, entirely
outside this stack. It still participates in the Secrets dependency calculation (Backend/Chat/Ai all
require Secrets), with its current value read from Aurora's own live cluster status instead of from
stack parameters.

| Dependent | Implies Secrets=ON when requested (start) | Protects Secrets from stop |
|---|---|---|
| Backend (Aurora) | YES | YES |
| Chat | YES | YES |
| AI | YES | YES |
| Network (NAT) | NO | NO |

## Stack Missing Behavior

`Get-CurrentStackState` returns `StackExists = $false` and every flag `$false` when the describe-stacks
call fails (the common, expected case for a frozen environment). Both scripts' resolution logic then
behaves correctly without any special-casing: on start, union-with-all-false is just "whatever was
requested"; on stop, there is nothing to tear down and the pre-existing short-circuit ("Stack does not
exist - nothing to tear down on the CloudFormation side") is preserved unchanged.

## Stack Existing Behavior

`Get-CurrentStackState` reads `Stacks[0].Parameters` and converts the 4 known keys to booleans. A
stack status outside `{CREATE_COMPLETE, UPDATE_COMPLETE, UPDATE_ROLLBACK_COMPLETE}` (e.g. a
transitional `*_IN_PROGRESS` state, `ROLLBACK_COMPLETE`, `DELETE_FAILED`, `REVIEW_IN_PROGRESS`) is
treated as **unsafe to read parameters from** — both scripts now `HARD STOP` and exit before touching
anything rather than guessing at a partially-failed stack's true parameter values.

## Scheduler Protection

No behavior change — the exact Phase-8-proven invariant (gym-partner-upload-sweep never touched; a
state-file snapshot is only re-captured when at least one pausable schedule is actually transitioning,
never overwritten with an idempotent all-disabled re-run) is preserved, now backed by the extracted,
independently-unit-tested `Test-ShouldCaptureScheduleSnapshot` function and the single shared
`Get-DevPausableSchedules`/`Get-DevIndependentSchedule` source of truth instead of two separately
hand-maintained copies.

## Regression Tests

`scripts/aws/lib/DevLifecycle.Tests.ps1` (Pester 3.4, the version bundled with this machine's Windows
PowerShell 5.1 - no v4/v5-only syntax used). **19/19 pass**, zero AWS calls, zero AWS resources
created. Covers all 10 cases from the brief plus 2 extra edge cases found worth locking down while
building this (a true no-op start/stop with no flags at all, and the "-Secrets requested while
already off" harmless-no-op refinement - see below):

| Case | Scenario | Result |
|---|---|---|
| 1 | Frozen + start Backend | Backend/Secrets ON, rest OFF — PASS |
| 2 | Backend ON (Secrets ON) + start Network | Secrets stays ON, Network ON — PASS (the originally reported bug) |
| 3 | Backend+Network ON + stop Network | Backend/Secrets stay ON, Network OFF — PASS |
| 4 | Backend+Network ON + stop Backend | Backend OFF, Network stays ON, Secrets preserved — PASS |
| 5 | AI ON + start Backend | AI remains ON — PASS |
| 6 | Backend+AI ON + stop Backend | AI remains ON, Secrets remains ON — PASS |
| 7 | No dependent + stop Secrets | Secrets OFF — PASS |
| 8 | Dependent ON + stop Secrets | Safe refusal, nothing changed — PASS |
| 9 | gym-partner-upload-sweep | Never in the pausable list — PASS |
| 10 | Repeated dev-stop | Snapshot not corrupted on an idempotent re-run — PASS |

One refinement found while writing Case 8's test: if `-Secrets` is passed but Secrets is **already**
off (e.g. the stack doesn't exist at all), refusing would be a false alarm over a harmless no-op —
the refusal now only fires when Secrets would actually transition from ON to OFF while a dependent
remains on.

## Dry Run Examples

Real (read-only) dry-run output against this account's actual current frozen state, confirming the
original bug scenario is fixed end-to-end, not just in the unit tests:

```
$ dev-start.ps1 -Backend -Network    (dry run)
CURRENT STATE:
  Backend = OFF   Network = OFF   Chat = OFF   Ai = OFF   Secrets = OFF
REQUESTED CHANGE (Start):
  Backend -> turn ON
  Network -> turn ON
RESOLVED TARGET STATE:
  Backend = ON (changed)   Network = ON (changed)   Chat = OFF   Ai = OFF   Secrets = ON (changed)
```

```
$ dev-stop.ps1 -Secrets    (dry run, Secrets already off)
CURRENT STATE:  ...all OFF...
REQUESTED CHANGE (Stop):  Secrets -> turn OFF
RESOLVED TARGET STATE:    ...all OFF...   (no refusal - nothing to actually stop)
```

(A live demonstration of the *refusal* path, and of start/stop preserving a truly-live dependent,
needs real AWS state - Backend or another subsystem actually running - and is explicitly deferred to
Phase 12B per this phase's "no AWS mutation" boundary.)

## Files Changed

- `scripts/aws/dev-start.ps1` — modified (flag computation replaced by module calls; no other logic changed)
- `scripts/aws/dev-stop.ps1` — modified (same; the resolution+refusal check also moved to run before any mutation)
- `scripts/aws/lib/DevLifecycle.psm1` — new
- `scripts/aws/lib/DevLifecycle.Tests.ps1` — new
- `docs/deployment/AWS_DEV_LIFECYCLE_STATE_FIX_2026-10-07.md` — this report

`git diff --stat -- scripts/aws` confirms exactly the 2 modified files above (93 insertions, 86
deletions combined) plus the new `scripts/aws/lib/` directory. No `backend/services/*/src` file was
touched by this phase. (Several Prisma-generated binary/client files and `.dev/aws/scheduler-state.json`
show as locally modified in `git status` - these are leftovers from Phase 10/11's real AWS/build
work earlier in this session, not from this phase; `git diff --stat -- scripts/aws` isolates this
phase's actual change set.)

## Remaining Risks

- The refusal behavior (Option A: refuse outright) was chosen over automatic preservation (Option B)
  for the Secrets-stop-while-dependent-on case, matching the project's existing "explicit only"
  philosophy for that flag. If a future operator wants `-Secrets` to simply be ignored/auto-preserved
  in that situation instead of refused, that would be a deliberate behavior change, not a bug.
- `Get-CurrentStackState`'s safe-status allowlist (`CREATE_COMPLETE`/`UPDATE_COMPLETE`/
  `UPDATE_ROLLBACK_COMPLETE`) has not been exercised against a real transitional or failed stack this
  phase (doing so would require either waiting for a real in-progress deploy or fabricating one, both
  out of scope for a no-mutation phase) - Phase 12B's live test should include triggering a dry-run
  while a real deploy is `*_IN_PROGRESS` if a natural opportunity arises, to confirm the HARD STOP
  fires as designed.
- The live demonstration of the refusal path and of preserving a genuinely-running dependent still
  needs Phase 12B's real AWS state.

## Phase 12B Live Test Plan

1. `dev-start.ps1 -Backend -Execute` (as before - Secrets auto-implied).
2. `dev-start.ps1 -Network -Execute` **alone** (the exact call that caused Phase 11's bug) → verify
   via direct `describe-stacks` that `EnableSecretsManagerEndpoint` is still `"true"` afterward (not
   reset to `"false"`) and that Aurora is untouched.
3. `dev-stop.ps1 -Secrets -Execute` **while Backend is still up** → expect a `HARD STOP` refusal with
   no AWS mutation (confirm via `dev-status.ps1` that nothing changed).
4. `dev-stop.ps1 -Network -Execute` → verify Secrets/Backend remain untouched, only NAT is removed.
5. `dev-stop.ps1 -Backend -Execute` then `dev-stop.ps1 -Secrets -Execute` → confirm the full, correct
   two-call teardown still works exactly as it did in Phase 10/11, ending in the same fully-frozen,
   zero-cost-leak state.
6. Full `dev-status.ps1` / `dev-cost-leak-check.ps1` final confirmation.
