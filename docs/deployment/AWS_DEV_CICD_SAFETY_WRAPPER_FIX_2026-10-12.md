# Gymini DEV — CI Deployment Safety Wrapper Remediation — 2026-10-12 (Phase 16A.1)

No credential, secret value, access key, or secret access key appears anywhere in this report.

## Executive Summary

Phase 16A's own audit found a real defect: `scripts/ci/Test-DeploymentSafety.ps1`'s `-ChangeSetFile`
branch hardcoded `-ParameterValues @{ HttpApiId = $ProtectedApiId }` when calling the pure safety
function, meaning the "real/planned" API ID was never actually read from the change set — it was
set to literally equal the protected ID, so `API_ID_MISMATCH` could never fire through the real
wrapper path even though the underlying pure function was correctly unit-tested in isolation. This
phase traced the full data flow, confirmed the root cause is a wrapper-level data-sourcing bug (not a
policy-logic bug), and fixed it surgically: the wrapper now independently derives the actual
`HttpApiId` from the real `.Parameters` array of a full `describe-change-set` JSON file, and the
underlying pure function (`Test-ChangeSetSafety`) was hardened to fail closed on a missing/blank
value instead of silently treating "no opinion" as a pass. A second, explicitly required gap —
"plan/apply identity mismatch" — was closed by moving the already-designed-but-untested bash
`sha256sum` comparison into a small, unit-tested pure function (`Test-ChangeSetDigest`) and a new
`-ReviewedDigest` wrapper option. Both of the two draft workflows that call `-ChangeSetFile`
(`infra-plan.yml`, `infra-deploy.yml`) were updated to the corrected contract; neither was activated.
16 new tests were added (3 pure-function, 3 digest, 10 real-wrapper-subprocess); all 68 tests
(52 original + 16 new) pass. Zero AWS mutations were performed this phase.
**`CI_DEPLOYMENT_SAFETY_WRAPPER: CERTIFIED`**.

## Confirmed Defect

`DEFECT_CONFIRMED: YES`. Exactly as Phase 16A's audit described: the wrapper's only call site for the
pure `Test-ChangeSetSafety` function was:

```powershell
$r = Test-ChangeSetSafety -Changes $changes -ProtectedApiId $ProtectedApiId `
       -ParameterValues @{ HttpApiId = $ProtectedApiId } -AllowList $allow
```

`$ProtectedApiId` on both sides of that hashtable means the internal check
(`$ParameterValues['HttpApiId'] -ne $ProtectedApiId`) was comparing a value against itself — it could
never be true, regardless of what the real CloudFormation change set actually contained. The pure
function's own Pester test ("7b) a HttpApiId other than the protected API is a HARD block") passed
because it calls `Test-ChangeSetSafety` directly with a genuinely different value — it never exercised
the wrapper at all, so the bypass was invisible to the existing 52-test baseline.

A second, structural layer of the same bug: the file the wrapper reads (`changes.json`) was produced
by both draft workflows via `aws cloudformation describe-change-set ... --query "Changes" --output
json`, which **discards** the `Parameters` field entirely. Even with the wrapper's hashtable fixed,
there would have been no real `HttpApiId` value anywhere in the file to read — the data simply never
reached the wrapper. Both the wrapper and its two callers needed fixing together.

## Real Workflow Execution Path

Traced end to end, confirmed by reading the two real call sites (`ci/drafts/github-actions/
infra-plan.yml`, `ci/drafts/github-actions/infra-deploy.yml` — the only two places in the repository
that pass `-ChangeSetFile`, confirmed via a full-repo grep):

```
infra-plan.yml:
  aws cloudformation create-change-set --parameters ParameterKey=HttpApiId,ParameterValue="$API_ID" ...
  -> aws cloudformation describe-change-set --query "Changes" --output json > changes.json   (BUG: drops Parameters)
  -> pwsh Test-DeploymentSafety.ps1 -ChangeSetFile changes.json -ProtectedApiId "$API_ID"
  -> Test-ChangeSetSafety -ParameterValues @{ HttpApiId = $ProtectedApiId }                   (BUG: self-comparison)

infra-deploy.yml:
  aws cloudformation describe-change-set --query Changes --output json > changes.json          (same BUG)
  -> same wrapper call, same self-comparison BUG
  -> (separately, in raw bash) sha256sum changes.json compared against $DIGEST                 (untested, not in the wrapper at all)
```

## Expected vs Actual API ID Sources

```
PROTECTED_API_ID_SOURCE:         scripts/ci/Test-DeploymentSafety.ps1's -ProtectedApiId parameter
                                  (trusted configuration, default "id1iz7upbl", passed explicitly by
                                  both workflows as "$API_ID" from their own `env:` block)
ACTUAL_API_ID_SOURCE_CURRENT (before this fix): literally copied from PROTECTED_API_ID_SOURCE - never
                                  independently read from anything
WHY_BYPASS_OCCURRED:             the wrapper never parsed the real change set's `.Parameters` array at
                                  all (and the file it was given didn't even contain that array, since
                                  both workflows captured only `--query Changes`)
CORRECT_ACTUAL_SOURCE (after this fix): the real `.Parameters` array of the FULL `aws cloudformation
                                  describe-change-set` JSON object for the change set actually being
                                  evaluated - specifically the single entry whose `ParameterKey` equals
                                  "HttpApiId", read fresh from that file every time
```

```
ACTUAL_API_ID_INDEPENDENTLY_DERIVED: YES
```

## Root Cause

Two independent bugs compounded: (1) both draft workflows discarded the `Parameters` field when
capturing the change set to a file (`--query Changes`), so the real planned `HttpApiId` value never
existed anywhere downstream; (2) the wrapper never attempted to read it even if it had been present —
it fabricated a `ParameterValues` hashtable from its own trusted configuration constant instead.
Neither bug alone would be obvious from the pure-function tests, which is exactly why Phase 16A's
instruction to add *wrapper-level* tests (not just pure-function tests) was the right diagnosis.

## Surgical Fix

**`scripts/ci/Test-DeploymentSafety.ps1`** (`-ChangeSetFile` branch rewritten):

```powershell
$full = Get-Content $ChangeSetFile -Raw | ConvertFrom-Json
$isBareChangesArray = $full -is [System.Array]
$changes = if ($isBareChangesArray) { @($full) } else { @($full.Changes) }
$parameters = if ($isBareChangesArray) { @() } else { @($full.Parameters) }

$apiIdEntries = @($parameters | Where-Object { $_.ParameterKey -eq 'HttpApiId' })
$paramValues = @{}
if ($apiIdEntries.Count -eq 1 -and -not [string]::IsNullOrWhiteSpace([string]$apiIdEntries[0].ParameterValue)) {
    $paramValues['HttpApiId'] = [string]$apiIdEntries[0].ParameterValue
}
# 0 entries (missing) or >1 (ambiguous) entries deliberately leave the key OUT
# of $paramValues - never guessed, never defaulted to -ProtectedApiId.
```

A bare `Changes`-only array (the old contract) is still accepted for destructive-action-only scanning
(backward compatible with that one use case), but then carries no `Parameters` at all, so the API-ID
check fails closed on it by design — callers must supply the full object to get a real API-ID check,
and both real callers now do.

**`scripts/ci/CiHelpers.psm1`** (`Test-ChangeSetSafety`, the single existing policy-logic owner — no
duplicate implementation was created):

```powershell
if ([string]::IsNullOrWhiteSpace($ProtectedApiId)) {
    # HARD_BLOCK: PROTECTED_API_ID_MISSING (configuration error)
}
elseif (-not $ParameterValues.ContainsKey('HttpApiId') -or [string]::IsNullOrWhiteSpace([string]$ParameterValues['HttpApiId'])) {
    # HARD_BLOCK: API_ID_MISSING (fail closed - was previously silently skipped)
}
elseif ($ParameterValues['HttpApiId'] -ne $ProtectedApiId) {
    # HARD_BLOCK: API_ID_MISMATCH (unchanged - this half was already correct)
}
```

Checked before making this change: every one of the 10 existing calls to `Test-ChangeSetSafety` in
`CiHelpers.Tests.ps1` already passes an explicit, non-blank `HttpApiId` in `-ParameterValues` (grep-
confirmed, zero exceptions) — so tightening the missing-key case to a hard block could not and did not
regress any of them.

**`scripts/ci/CiHelpers.psm1`** (new, small pure function — closes the explicitly-required
"plan/apply identity mismatch" test case without duplicating anything):

```powershell
function Test-ChangeSetDigest {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$ActualDigest,
          [Parameter(Mandatory)][AllowEmptyString()][string]$ReviewedDigest)
    # case/whitespace-insensitive compare; a missing digest on either side never passes
}
```

**`scripts/ci/Test-DeploymentSafety.ps1`** (new, optional `-ReviewedDigest` parameter): when supplied
alongside `-ChangeSetFile`, hashes the actual file and runs it through `Test-ChangeSetDigest` *before*
any change-set content is evaluated, blocking with `CHANGESET_DIGEST_MISMATCH` on any difference.

**`scripts/ci/Test-DeploymentSafety.ps1`** (new, test-only `-IdentityFile` parameter): lets the
`-Identity` branch be exercised with fixture JSON instead of a live `aws sts get-caller-identity`
call, satisfying 16A.1.3's dependency-injection requirement. The **default production path is
unchanged** — every real draft workflow still calls `aws sts get-caller-identity` with no override; a
grep across every workflow confirms `-IdentityFile` is never passed by any of them.

No duplicated API-safety implementation was created: `Test-ChangeSetSafety` remains the sole source of
the API-ID policy decision; the wrapper's job is strictly limited to sourcing real data for it.

## Fail-Closed Semantics

| Case | Behavior |
|---|---|
| actual == protected | PASS |
| actual != protected | BLOCK — `API_ID_MISMATCH` |
| actual missing (0 `.Parameters` entries for `HttpApiId`, or blank value) | BLOCK — `API_ID_MISSING` |
| actual ambiguous (>1 `.Parameters` entries for `HttpApiId`) | BLOCK — `API_ID_MISSING` (same rule; both are "cannot resolve a single trustworthy value") |
| protected missing/blank | BLOCK — `PROTECTED_API_ID_MISSING` (configuration error) |
| reviewed digest supplied and doesn't match the actual file | BLOCK — `CHANGESET_DIGEST_MISMATCH`, evaluated **before** any change-set content check |

Nowhere does an unresolved/unknown value get silently converted into a pass — verified both by code
reading and by the real-wrapper tests below.

## Real Wrapper Tests

Added `Describe "Test-DeploymentSafety.ps1 (16A.1 - real wrapper, not just pure functions)"` to
`scripts/ci/CiHelpers.Tests.ps1`. Each test spawns the actual `.ps1` file as a genuine child process
(`powershell.exe -NoProfile -File scripts/ci/Test-DeploymentSafety.ps1 ...` — the exact invocation
style every draft workflow uses) against a real fixture file on disk, and asserts on its real JSON
stdout and real process exit code (0 = safe, 2 = blocked) — not on the in-process pure function.

```
API_ID_MATCH_TEST:            PASS  (exit 0, Verdict != BLOCK)
API_ID_MISMATCH_TEST:         PASS  (exit 2, Rule=API_ID_MISMATCH)
API_ID_MISSING_TEST:          PASS  (exit 2, Rule=API_ID_MISSING, via a real change-set file with
                                     no HttpApiId parameter at all)
PROTECTED_ID_MISSING_TEST:    PASS  (exercised at the pure-function level - see note below)
DELETE_GUARD:                 PASS  (exit 2, Rule=ROUTE_REMOVAL, through the real wrapper)
REPLACEMENT_GUARD:            PASS  (exit 2, Rule=INTEGRATION_REPLACEMENT, through the real wrapper)
PLAN_APPLY_IDENTITY_GUARD:    PASS  (exit 2, Rule=CHANGESET_DIGEST_MISMATCH, through the real wrapper
                                     with a deliberately wrong -ReviewedDigest; a second test confirms
                                     the matching digest for the same file proceeds to exit 0)
```

**Note on `PROTECTED_ID_MISSING_TEST`**: a genuine attempt to exercise this through the real external
`powershell.exe -File` process failed — Windows PowerShell's own `-File` argument parser drops a
deliberately-blank `-ProtectedApiId ""` override before the script's parameter binder ever sees it
(confirmed by reproducing the exact same failure independent of this fix: reordering the argument,
and testing with other blank-string parameters, produces the identical `"Missing an argument for
parameter"` error — a pre-existing PowerShell CLI limitation, not a defect in this fix). This was
proven safe to characterize as a non-issue two ways: (1) the wrapper's `-ProtectedApiId` has a
non-blank default (`"id1iz7upbl"`) that every real draft workflow relies on and never overrides with
an empty string, so this path cannot occur in production; (2) the underlying policy was verified
directly via in-process dot-sourcing (bypassing the external-process argv limitation) and produced the
correct `PROTECTED_API_ID_MISSING` / `BLOCK` / exit 2 result, then formalized as a pure-function Pester
test ("16A.1) a missing/blank ProtectedApiId is a configuration-error HARD block") since that is where
the policy actually lives.

```
REAL_WRAPPER_SYNTHETIC_MISMATCH: BLOCKED
EXPECTED_MISMATCH_REASON: API_ID_MISMATCH
```

## Synthetic API ID Mismatch Proof

The core certification the brief required, run against the real script with real fixture files
(full transcript captured during this phase, not predicted):

```
Protected: id1iz7upbl   Planned (fixture .Parameters.HttpApiId): a deliberately different fake ID
  -> RESULT: BLOCKED, REASON: API_ID_MISMATCH, exit code 2

Protected: id1iz7upbl   Planned: id1iz7upbl   (otherwise-safe Lambda::Permission Add)
  -> API_ID_MISMATCH: NOT_TRIGGERED, Verdict: APPROVAL_REQUIRED, exit code 0
```

Formalized as Pester test "10) regression proof: the wrapper does NOT substitute ProtectedApiId for
the real actual value" — its own comment states explicitly that this exact fixture would have PASSED
before the fix (since the old code compared `ProtectedApiId` against itself) and now correctly BLOCKs.

## Full CI Helper Regression

```
PREVIOUS_TEST_BASELINE: 52/52
```

Re-ran the complete suite (`Invoke-Pester scripts/ci/CiHelpers.Tests.ps1`) after every change in this
phase:

```
TOTAL: 68
PASS:  68
FAIL:  0
SKIP:  0
```

All 52 original tests pass unchanged; 16 new tests added (3 pure-function fail-closed cases, 3
`Test-ChangeSetDigest` cases, 10 real-wrapper-subprocess cases) all pass. Two genuine test-authoring
bugs were found and fixed *during* this phase (not defects in the production code): PowerShell does
not wrap a single `Where-Object` match in an array, so `.Count` on an unwrapped single-object result
is empty rather than `1` — every new assertion of that shape was corrected to `@(... | Where-Object
...).Count`; and `Test-ChangeSetDigest`'s parameters needed `[AllowEmptyString()]` added since a bare
`[Parameter(Mandatory)]` string parameter rejects an explicit empty-string argument by default (needed
for the "missing digest" test case itself).

```
PREVIOUS_TESTS_REGRESSED: 0
```

## Draft Workflow Compatibility

Grepped every file under `ci/drafts/github-actions/` plus `scripts/ci/*.Tests.ps1` for every call to
`Test-DeploymentSafety.ps1`:

```
DRAFT_WORKFLOWS_USING_WRAPPER: 4  (chat-deploy.yml, dev-deploy.yml, infra-plan.yml, infra-deploy.yml)
DRAFT_WORKFLOWS_CHANGED: 2        (infra-plan.yml, infra-deploy.yml - the only two that ever pass
                                   -ChangeSetFile; chat-deploy.yml and dev-deploy.yml only use
                                   -Identity/-ScanLogFile, neither touched by this defect)
```

Both changed workflows: (1) now capture the full `describe-change-set` object (dropped `--query
Changes`) so `.Parameters` survives into the file the wrapper reads; (2) `infra-deploy.yml`'s digest
binding now goes through the wrapper's new `-ReviewedDigest` option (backed by the unit-tested
`Test-ChangeSetDigest`) instead of a bare, untested `sha256sum` shell comparison. Neither workflow was
moved into `.github/workflows/`, enabled, or otherwise activated — both remain inert drafts.

```
ACTIVE_GITHUB_WORKFLOWS_CREATED: 0
```

## Secret Output Audit

No AWS access key, secret key, session token, JWT, SMTP password, internal-service secret, or Lambda
environment value appears anywhere in this report, the new test fixtures (all synthetic:
`999999999999`/`arn:aws:iam::999999999999:user/someone`/`zzzzzzzzzz`/
`deadbeef...deadbeef`), or the code changes. The one place a real secret *name* (not value) appears is
`Find-SecretLikeOutput`'s own existing detector list and its own pre-existing fixture test strings
(`"JWT_SECRET=hunter2hunter2"`, `"AKIAABCDEFGHIJKLMNOP"`) — neither touched by this phase, both already
present before it and intentionally fake/illustrative. No new AWS CLI call was added to the wrapper
that could print broader state than before; the new logic operates entirely on local file content
already captured by the (unchanged in this respect) narrow `--query`/`--output json` calls in the two
workflows.

## Parallel-Agent Safety

`git status`/`git diff`/`git log -1` were run before any edit. `ci/` and `scripts/ci/` were, and
remain, entirely untracked (no commit exists for either). `git log -1` showed the latest commit
(`18774535`, a merge of `feature/payment-gateways` into `aws-deploy`) touches only user-service
error-handling and a frontend mobile calendar hook — unrelated to any file this phase touched. File
timestamps for every file in `scripts/ci/`/`ci/` were unchanged since Phase 16A concluded (2026-10-09),
confirming no other agent was mid-edit on these specific files when this phase began. No `git reset`,
`git clean`, or discard of any kind was performed; nothing was committed.

```
FILES_CHANGED:
  scripts/ci/Test-DeploymentSafety.ps1       (rewritten - the core fix)
  scripts/ci/CiHelpers.psm1                  (Test-ChangeSetSafety hardened; Test-ChangeSetDigest added)
  scripts/ci/CiHelpers.Tests.ps1             (16 new tests)
  ci/drafts/github-actions/infra-plan.yml    (capture full object, not just Changes)
  ci/drafts/github-actions/infra-deploy.yml  (capture full object; digest check via the wrapper)
```

## Remaining Activation Blockers

Unchanged from Phase 16A (this phase closed one specific defect, it did not advance activation
readiness): CloudFormation normal-update certification not yet performed; OIDC roles not yet created;
GitHub protected environments not yet created; PR validation workflow not yet active; 10
`SOURCE_ONLY` routes still pending Phase 15C. `CFN_NORMAL_UPDATE_CERTIFIED: NO`.

## Final Response

```
PHASE: 16A.1
AWS_MUTATIONS: 0
DEFECT_CONFIRMED: YES
DEFECT: API_ID_MISMATCH_WRAPPER_BYPASS
PROTECTED_API_ID: id1iz7upbl
PROTECTED_API_ID_SOURCE: Test-DeploymentSafety.ps1's -ProtectedApiId parameter (trusted config)
ACTUAL_API_ID_SOURCE: the real change-set's .Parameters array, entry ParameterKey=HttpApiId
ACTUAL_API_ID_INDEPENDENTLY_DERIVED: YES
WRAPPER_FAILS_CLOSED: YES
API_ID_MATCH_TEST: PASS
API_ID_MISMATCH_TEST: PASS
API_ID_MISSING_TEST: PASS
PROTECTED_ID_MISSING_TEST: PASS
DELETE_GUARD: PASS
REPLACEMENT_GUARD: PASS
PLAN_APPLY_IDENTITY_GUARD: PASS
REAL_WRAPPER_SYNTHETIC_MISMATCH: BLOCKED
EXPECTED_MISMATCH_REASON: API_ID_MISMATCH
PREVIOUS_TEST_BASELINE: 52/52
FULL_CI_HELPER_TESTS: 68/68
PREVIOUS_TESTS_REGRESSED: 0
DRAFT_WORKFLOWS_AUDITED: 4
DRAFT_WORKFLOWS_CHANGED: 2
ACTIVE_GITHUB_WORKFLOWS_CREATED: 0
AWS_OIDC_CHANGED: NO
API_GATEWAY_CHANGED: NO
SERVICES_REDEPLOYED: 0
SERVICES_STOPPED: 0
FILES_CHANGED: scripts/ci/Test-DeploymentSafety.ps1, scripts/ci/CiHelpers.psm1, scripts/ci/CiHelpers.Tests.ps1, ci/drafts/github-actions/infra-plan.yml, ci/drafts/github-actions/infra-deploy.yml
REPORT: docs/deployment/AWS_DEV_CICD_SAFETY_WRAPPER_FIX_2026-10-12.md
CI_DEPLOYMENT_SAFETY_WRAPPER: CERTIFIED
CFN_NORMAL_UPDATE_CERTIFIED: NO
CI_ACTIVATION_AUTHORIZED: NO
READY_FOR_PHASE_16A_2: YES
FINAL_DECISION: CICD_SAFETY_WRAPPER_VERIFIED
```

HARD STOP. Did NOT activate CI/CD. Did NOT execute CloudFormation. Did NOT create any OIDC role. Did
NOT deploy any service. Did NOT add any SOURCE_ONLY route. Did NOT stop any running service.
