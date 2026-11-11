<#
.SYNOPSIS
  Gymini CI (Phase 16A DRAFT) - pre-deploy safety gates. Read-only.
  Subcommands (use exactly one):
    -Identity           sts get-caller-identity -> Test-AwsIdentityGate
    -ChangeSetFile      a FULL `describe-change-set` JSON (Changes + Parameters) -> Test-ChangeSetSafety
    -PlanFile           text file, one planned command per line -> Test-DeployPlanSafety
    -ScanLogFile        a log file -> Find-SecretLikeOutput (types only)
  Exit code: 0 = safe, 2 = blocked/violations (workflows classify the failure).

  AWS use: only `sts get-caller-identity` (no profile argument in CI - the
  OIDC credentials come from the environment). Locally pass -Profile
  gymini-admin together with -Context Local.

.PARAMETER ChangeSetFile
  Phase 16A.1 fix: this must be the FULL object `aws cloudformation
  describe-change-set` returns (both `.Changes` and `.Parameters`) - e.g.
  `aws cloudformation describe-change-set ... --output json > changes.json`
  with NO `--query Changes`. The real/planned HttpApiId is read from this
  file's own `.Parameters` array and is NEVER defaulted to -ProtectedApiId;
  a missing, blank, or ambiguous (>1 entry) HttpApiId fails closed inside
  Test-ChangeSetSafety (rule API_ID_MISSING), it is never silently treated
  as a pass. A bare `.Changes`-only array (the old, pre-16A.1 contract) is
  still accepted for destructive-action scanning, but then carries NO
  Parameters at all, so the API-ID check deliberately fails closed on it too
  - callers must supply the full object to get a real API-ID check.

.PARAMETER ReviewedDigest
  Optional, used together with -ChangeSetFile. The sha256 a human reviewer
  approved (infra-plan.yml's own output) for this exact change set's JSON.
  When supplied, the actual file's sha256 must match it exactly (case/
  whitespace-insensitive) or the run is blocked with CHANGESET_DIGEST_MISMATCH
  BEFORE the change-set content is even evaluated - this is the plan/apply
  identity binding that stops infra-deploy.yml from executing a different
  change set than the one a human approved.

.PARAMETER IdentityFile
  TEST-ONLY. Path to a JSON file shaped like `{"Account":"...","Arn":"..."}`
  to use INSTEAD of calling the real `aws sts get-caller-identity`. A file
  path (not inline JSON text) for the same reason every other subcommand here
  takes a file path: passing structured content as a raw CLI argument is
  fragile across shell/process boundaries (embedded quotes/colons get
  mangled). Production callers (every draft workflow) never pass this - the
  default path always queries live AWS. Exists solely so Pester can exercise
  the real -Identity branch (account/root/vmimport-admin/static-user
  rejection) without a live AWS call or mocking the `aws` binary.
#>
[CmdletBinding()]
param(
    [switch]$Identity,
    [string]$ChangeSetFile,
    [string]$PlanFile,
    [string]$ScanLogFile,
    [ValidateSet("Read", "Mutate")] [string]$Mode = "Read",
    [ValidateSet("CI", "Local")] [string]$Context = "CI",
    [string]$Profile,
    [string]$ExpectedAccount = "191798898985",
    [string]$ProtectedApiId = "id1iz7upbl",
    [string]$AllowListFile,
    [string]$ReviewedDigest,
    [string]$IdentityFile
)
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "CiHelpers.psm1") -Force

function Out-Result($obj, [bool]$ok) { $obj | ConvertTo-Json -Depth 6; if (-not $ok) { exit 2 } }

if ($Identity) {
    if ($IdentityFile) {
        # TEST-ONLY path - see .PARAMETER IdentityFile above. No AWS call.
        $id = Get-Content $IdentityFile -Raw | ConvertFrom-Json
    } else {
        $args2 = @("sts", "get-caller-identity", "--query", "{Account:Account,Arn:Arn}", "--output", "json")
        if ($Profile) { $args2 += @("--profile", $Profile) }
        $raw = & aws @args2
        $id = if ($LASTEXITCODE -eq 0 -and $raw) { $raw | ConvertFrom-Json } else { $null }
    }
    $r = Test-AwsIdentityGate -Identity $id -ExpectedAccount $ExpectedAccount -Mode $Mode -Context $Context
    Out-Result $r $r.Allowed
}
elseif ($ChangeSetFile) {
    $full = Get-Content $ChangeSetFile -Raw | ConvertFrom-Json
    if ($null -eq $full) { throw "ChangeSetFile '$ChangeSetFile' is empty or not valid JSON." }

    # Phase 16A.1 fix: independently derive the REAL/planned HttpApiId from
    # this file's own Parameters array. Never default/copy -ProtectedApiId
    # into it - that was the exact defect (the wrapper was effectively
    # comparing the protected ID against itself, so a real mismatch could
    # never be detected). Accept either the full describe-change-set object
    # (has .Changes and .Parameters) or a bare Changes array for backward
    # compatibility with destructive-action-only scanning - the latter has no
    # Parameters, so the API-ID check below fails closed on it by design.
    $isBareChangesArray = $full -is [System.Array]
    $changes = if ($isBareChangesArray) { @($full) } else { @($full.Changes) }
    $parameters = if ($isBareChangesArray) { @() } else { @($full.Parameters) }

    $apiIdEntries = @($parameters | Where-Object { $_.ParameterKey -eq 'HttpApiId' })
    $paramValues = @{}
    if ($apiIdEntries.Count -eq 1 -and -not [string]::IsNullOrWhiteSpace([string]$apiIdEntries[0].ParameterValue)) {
        # Exactly one unambiguous, non-blank entry - the only case where we
        # pass a real value through. 0 entries (missing) or >1 entries
        # (ambiguous) deliberately leave HttpApiId OUT of $paramValues so
        # Test-ChangeSetSafety's own fail-closed check (API_ID_MISSING) fires.
        $paramValues['HttpApiId'] = [string]$apiIdEntries[0].ParameterValue
    }

    if ($ReviewedDigest) {
        $actualDigest = (Get-FileHash $ChangeSetFile -Algorithm SHA256).Hash
        $d = Test-ChangeSetDigest -ActualDigest $actualDigest -ReviewedDigest $ReviewedDigest
        if (-not $d.Match) {
            Out-Result (@{ Verdict = 'BLOCK'; HardBlock = $true; Findings = @(@{ Severity = 'HARD_BLOCK'; Rule = $d.Rule; LogicalResourceId = 'ChangeSetFile'; ResourceType = 'PlanApplyBinding'; Action = 'N/A'; Replacement = 'N/A'; Allowlisted = $false }) }) $false
        }
    }

    $allow = if ($AllowListFile) { @(Get-Content $AllowListFile -Raw | ConvertFrom-Json) } else { @() }
    $r = Test-ChangeSetSafety -Changes $changes -ProtectedApiId $ProtectedApiId -ParameterValues $paramValues -AllowList $allow
    Out-Result $r ($r.Verdict -ne "BLOCK")
}
elseif ($PlanFile) {
    $r = Test-DeployPlanSafety -PlannedActions @(Get-Content $PlanFile)
    Out-Result $r $r.Safe
}
elseif ($ScanLogFile) {
    $f = @(Find-SecretLikeOutput -Text (Get-Content $ScanLogFile -Raw))
    Out-Result @{ SecretLikeFindings = $f } ($f.Count -eq 0)
}
else { throw "Choose one of -Identity / -ChangeSetFile / -PlanFile / -ScanLogFile." }
