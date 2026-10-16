<#
.SYNOPSIS
  Gymini CI/CD pure helper logic (Phase 16A DRAFT). No AWS calls, no file
  writes, no network. Everything here takes plain data in and returns plain
  data out so it can be unit-tested with FAKE metadata only
  (scripts/ci/CiHelpers.Tests.ps1) and reused by the draft workflows.

  Reuses (does not duplicate) Find-DestructiveChangeSetActions from
  scripts/aws/api-gateway/lib/ApiRouteParity.psm1.
#>

Import-Module (Join-Path $PSScriptRoot "..\aws\api-gateway\lib\ApiRouteParity.psm1") -Force

function Get-Prop {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $null
    }
    $p = $Object.PSObject.Properties[$Name]
    if ($null -ne $p) { return $p.Value }
    return $null
}

# ---------------------------------------------------------------------------
# 16A.3 / 16A.23 - change impact
# ---------------------------------------------------------------------------
<#
.SYNOPSIS
  Maps changed repo paths to affected services/infra using ci/service-impact-map.json.
  Deterministic: sorted output, union of every matching rule. A file that
  matches no rule and no ignore suffix is UNCLASSIFIED -> DeployBlocked
  (validate everything, deploy nothing; never guess).
#>
function Get-CiImpact {
    param(
        [string[]]$ChangedFiles = @(),
        [Parameter(Mandatory)] $ImpactMap
    )
    $services = @{}; $infra = @{}; $validateOnly = @{}; $migration = @{}
    $unclassified = [System.Collections.Generic.List[string]]::new()
    $ignored = [System.Collections.Generic.List[string]]::new()

    foreach ($raw in $ChangedFiles) {
        if ([string]::IsNullOrWhiteSpace($raw)) { continue }
        $f = ($raw -replace '\\', '/').TrimStart('.', '/')

        if ($f -match '^backend/services/([a-z]+)-service/prisma/migrations/') { $migration[$Matches[1]] = $true }

        $isIgnoredSuffix = $false
        foreach ($s in @($ImpactMap.ignoreSuffixes)) { if ($f.EndsWith($s)) { $isIgnoredSuffix = $true } }
        if ($isIgnoredSuffix) { $ignored.Add($f); continue }

        $matched = $false; $onlyIgnore = $true
        foreach ($rule in @($ImpactMap.rules)) {
            $hit = $false
            foreach ($e in @(Get-Prop $rule 'exact'))    { if ($e -and $f -eq $e) { $hit = $true } }
            foreach ($p in @(Get-Prop $rule 'prefixes')) { if ($p -and $f.StartsWith($p)) { $hit = $true } }
            if (-not $hit) { continue }
            $matched = $true
            if (-not (Get-Prop $rule 'ignore')) { $onlyIgnore = $false }
            foreach ($t in @(Get-Prop $rule 'propagateTo')) { if ($t) { $services[$t] = $true } }
            foreach ($t in @(Get-Prop $rule 'infra'))       { if ($t) { $infra[$t] = $true } }
            foreach ($t in @(Get-Prop $rule 'validateOnly')) { if ($t) { $validateOnly[$t] = $true } }
        }
        if (-not $matched) { $unclassified.Add($f) }
        elseif ($onlyIgnore) { $ignored.Add($f) }
    }

    $lambda = @(); $ecs = @(); $valSvc = @()
    foreach ($name in ($services.Keys | Sort-Object)) {
        $kind = Get-Prop (Get-Prop $ImpactMap.services $name) 'kind'
        switch ($kind) {
            'lambda' { $lambda += $name }
            'ecs'    { $ecs += $name }
            default  { $valSvc += $name }
        }
    }
    [pscustomobject]@{
        Services             = @($services.Keys | Sort-Object)
        LambdaServices       = $lambda
        EcsServices          = $ecs
        ValidateOnlyServices = $valSvc
        Infra                = @($infra.Keys | Sort-Object)
        ValidateOnly         = @($validateOnly.Keys | Sort-Object)
        MigrationReview      = @($migration.Keys | Sort-Object)
        Unclassified         = @($unclassified | Sort-Object -Unique)
        Ignored              = @($ignored | Sort-Object -Unique)
        ValidateAll          = ($unclassified.Count -gt 0)
        DeployBlocked        = ($unclassified.Count -gt 0)
    }
}

# ---------------------------------------------------------------------------
# 16A.0 / 16A.15 - identity gate
# ---------------------------------------------------------------------------
<#
.SYNOPSIS
  Decides whether the current AWS identity may be used. Identity is a plain
  hashtable @{ Account = '...'; Arn = '...' } (from sts get-caller-identity).
  Context 'CI'    : only an assumed-role session of an allowed GyminiDev* role
                    (OIDC). Any IAM user - including gymini-admin - is blocked.
  Context 'Local' : only user/gymini-admin.
  Always blocked  : missing identity, wrong account, root, and vmimport-admin
                    for Mutate.
#>
function Test-AwsIdentityGate {
    param(
        $Identity,
        [string]$ExpectedAccount = '191798898985',
        [ValidateSet('Read', 'Mutate')] [string]$Mode = 'Read',
        [ValidateSet('CI', 'Local')] [string]$Context = 'CI',
        [string[]]$AllowedCiRoleNames = @('GyminiDevCiReadRole', 'GyminiDevAppDeployRole', 'GyminiDevInfraDeployRole')
    )
    $acct = Get-Prop $Identity 'Account'
    $arn  = Get-Prop $Identity 'Arn'
    $block = { param($c, $r) @{ Allowed = $false; Class = $c; Reason = $r } }

    if ([string]::IsNullOrWhiteSpace($acct) -or [string]::IsNullOrWhiteSpace($arn)) {
        return (& $block 'BLOCK_MISSING_IDENTITY' 'No AWS identity resolved (sts get-caller-identity returned nothing).')
    }
    if ($acct -ne $ExpectedAccount) {
        return (& $block 'BLOCK_WRONG_ACCOUNT' "Account $acct is not the expected $ExpectedAccount.")
    }
    if ($arn -match ':root$') {
        return (& $block 'BLOCK_ROOT' 'Root principal is never allowed.')
    }
    if ($Mode -eq 'Mutate' -and $arn -match 'vmimport-admin') {
        return (& $block 'BLOCK_VMIMPORT_MUTATION' 'vmimport-admin must never be used for mutation.')
    }
    if ($Context -eq 'CI') {
        if ($arn -match ':user/') {
            return (& $block 'BLOCK_STATIC_USER_IN_CI' 'CI must use OIDC-assumed roles, never an IAM user (incl. gymini-admin).')
        }
        $roleOk = $false
        foreach ($r in $AllowedCiRoleNames) { if ($arn -match (':assumed-role/' + [regex]::Escape($r) + '/')) { $roleOk = $true } }
        if (-not $roleOk) { return (& $block 'BLOCK_ROLE_NOT_ALLOWED' 'Assumed role is not one of the allowed Gymini CI roles.') }
    } else {
        if ($arn -notmatch ':user/gymini-admin$') {
            return (& $block 'BLOCK_PRINCIPAL_NOT_ALLOWED' 'Local runs must use user/gymini-admin via --profile gymini-admin.')
        }
    }
    @{ Allowed = $true; Class = 'OK'; Reason = 'Identity accepted.' }
}

# ---------------------------------------------------------------------------
# 16A.9 / 16A.10 - CloudFormation change-set guard
# ---------------------------------------------------------------------------
<#
.SYNOPSIS
  Classifies a CloudFormation change set for the Gymini API Gateway stack.
  Verdict: BLOCK | APPROVAL_REQUIRED | AUTO_OK.
  HARD_BLOCK (API creation/replacement/removal, API ID mismatch) can NEVER
  be allowlisted. BLOCK findings can be allowlisted per-resource with an
  unexpired entry that names ApprovedBy and Reason. APPROVAL findings are
  never blocking but force the manual-approval environment.
#>
function Test-ChangeSetSafety {
    param(
        [array]$Changes = @(),
        [string]$ProtectedApiId = 'id1iz7upbl',
        [hashtable]$ParameterValues = @{},
        [array]$AllowList = @(),
        [datetime]$Today = (Get-Date)
    )
    $norm = foreach ($c in $Changes) {
        $rc = Get-Prop $c 'ResourceChange'; if ($null -eq $rc) { $rc = $c }
        $repl = Get-Prop $rc 'Replacement'; if ($null -eq $repl) { $repl = 'N/A' }
        [ordered]@{
            Action            = Get-Prop $rc 'Action'
            ResourceType      = Get-Prop $rc 'ResourceType'
            Replacement       = [string]$repl
            LogicalResourceId = Get-Prop $rc 'LogicalResourceId'
        }
    }
    $norm = @($norm)
    $findings = [System.Collections.Generic.List[object]]::new()
    $add = {
        param($sev, $rule, $c)
        $findings.Add([pscustomobject]@{ Severity = $sev; Rule = $rule; LogicalResourceId = $c.LogicalResourceId; ResourceType = $c.ResourceType; Action = $c.Action; Replacement = $c.Replacement; Allowlisted = $false })
    }

    # Fail-closed, in this order: a missing/blank ProtectedApiId is a caller
    # configuration error; a missing/blank/ambiguous actual HttpApiId is never
    # treated as "no opinion" (an absent key must never silently pass); only
    # once both sides are known values do we compare them. Never guess, never
    # default the actual side to ProtectedApiId - that is the exact wrapper
    # bug this gate exists to catch (Phase 16A.1).
    if ([string]::IsNullOrWhiteSpace($ProtectedApiId)) {
        $findings.Add([pscustomobject]@{ Severity = 'HARD_BLOCK'; Rule = 'PROTECTED_API_ID_MISSING'; LogicalResourceId = 'HttpApiId'; ResourceType = 'Parameter'; Action = 'N/A'; Replacement = 'N/A'; Allowlisted = $false })
    }
    elseif (-not $ParameterValues.ContainsKey('HttpApiId') -or [string]::IsNullOrWhiteSpace([string]$ParameterValues['HttpApiId'])) {
        $findings.Add([pscustomobject]@{ Severity = 'HARD_BLOCK'; Rule = 'API_ID_MISSING'; LogicalResourceId = 'HttpApiId'; ResourceType = 'Parameter'; Action = 'N/A'; Replacement = 'N/A'; Allowlisted = $false })
    }
    elseif ($ParameterValues['HttpApiId'] -ne $ProtectedApiId) {
        $findings.Add([pscustomobject]@{ Severity = 'HARD_BLOCK'; Rule = 'API_ID_MISMATCH'; LogicalResourceId = 'HttpApiId'; ResourceType = 'Parameter'; Action = 'Modify'; Replacement = 'N/A'; Allowlisted = $false })
    }

    foreach ($c in $norm) {
        $replaced = $c.Replacement -in @('True', 'Conditional')
        switch ($c.ResourceType) {
            'AWS::ApiGatewayV2::Api' {
                if ($c.Action -in @('Add', 'Remove') -or $replaced) { & $add 'HARD_BLOCK' 'API_REPLACEMENT_OR_CREATE' $c }
                else { & $add 'APPROVAL' 'API_MODIFY' $c }
            }
            'AWS::ApiGatewayV2::Stage' {
                if ($c.Action -eq 'Remove' -or $replaced) { & $add 'BLOCK' 'STAGE_RECREATION' $c } else { & $add 'APPROVAL' 'STAGE_CHANGE' $c }
            }
            'AWS::ApiGatewayV2::Integration' {
                if ($c.Action -eq 'Remove' -or $replaced) { & $add 'BLOCK' 'INTEGRATION_REPLACEMENT' $c } else { & $add 'APPROVAL' 'INTEGRATION_CHANGE' $c }
            }
            'AWS::ApiGatewayV2::Route' {
                if ($c.Action -eq 'Remove') { & $add 'BLOCK' 'ROUTE_REMOVAL' $c }
                elseif ($replaced) { & $add 'BLOCK' 'ROUTE_REPLACEMENT' $c }
                elseif ($c.Action -eq 'Add') { & $add 'APPROVAL' 'ROUTE_ADD' $c }
                else { & $add 'APPROVAL' 'ROUTE_MODIFY' $c }
            }
            'AWS::Lambda::Permission' {
                if ($c.Action -eq 'Remove' -or $replaced) { & $add 'BLOCK' 'PERMISSION_REMOVAL_OR_REPLACEMENT' $c }
                else { & $add 'APPROVAL' 'PERMISSION_BROADENING_REVIEW' $c }
            }
            default {
                if ($c.Action -eq 'Import') { & $add 'APPROVAL' 'IMPORT' $c }
                elseif ($c.Action -eq 'Remove' -or $replaced) { & $add 'BLOCK' 'GENERIC_DESTRUCTIVE' $c }
                else { & $add 'APPROVAL' 'UNREVIEWED_RESOURCE_TYPE' $c }
            }
        }
    }

    # Defence in depth: the pre-existing guard must agree. Anything it flags
    # that we did not already treat as BLOCK/HARD_BLOCK is escalated.
    $legacyActions = @()
    if ($norm.Count -gt 0) { $legacyActions = (Find-DestructiveChangeSetActions -Changes $norm).DestructiveActions }
    foreach ($d in $legacyActions) {
        $already = $findings | Where-Object { $_.LogicalResourceId -eq $d.LogicalResourceId -and $_.Severity -in @('BLOCK', 'HARD_BLOCK') }
        if (-not $already) {
            $findings.Add([pscustomobject]@{ Severity = 'BLOCK'; Rule = 'LEGACY_GUARD'; LogicalResourceId = $d.LogicalResourceId; ResourceType = $d.ResourceType; Action = $d.Action; Replacement = $d.Replacement; Allowlisted = $false })
        }
    }

    foreach ($f in $findings) {
        if ($f.Severity -ne 'BLOCK') { continue }
        foreach ($a in $AllowList) {
            $exp = Get-Prop $a 'ExpiresOn'
            $ok = ((Get-Prop $a 'LogicalResourceId') -eq $f.LogicalResourceId) -and ((Get-Prop $a 'Action') -eq $f.Action) `
                -and (-not [string]::IsNullOrWhiteSpace((Get-Prop $a 'ApprovedBy'))) -and (-not [string]::IsNullOrWhiteSpace((Get-Prop $a 'Reason'))) `
                -and $exp -and ([datetime]$exp -ge $Today)
            if ($ok) { $f.Allowlisted = $true }
        }
    }

    $blocking = @($findings | Where-Object { $_.Severity -in @('BLOCK', 'HARD_BLOCK') -and -not $_.Allowlisted })
    $verdict = if ($blocking.Count -gt 0) { 'BLOCK' }
               elseif (@($findings | Where-Object { $_.Severity -eq 'APPROVAL' -or $_.Allowlisted }).Count -gt 0) { 'APPROVAL_REQUIRED' }
               else { 'AUTO_OK' }
    [pscustomobject]@{ Verdict = $verdict; HardBlock = (@($findings | Where-Object Severity -eq 'HARD_BLOCK').Count -gt 0); Findings = @($findings) }
}

# ---------------------------------------------------------------------------
# 16A.26 - failure classification
# ---------------------------------------------------------------------------
function Get-CiFailureClass {
    param(
        [ValidateSet('build', 'typecheck', 'unit', 'integration', 'deploy', 'smoke', 'external', 'approval', 'other')] [string]$Stage = 'other',
        [string]$Message = ''
    )
    $r = { param($c, $status, $blocking) [pscustomobject]@{ Class = $c; Status = $status; Blocking = $blocking } }
    if ($Message -match '(?i)BEDROCK_ACCOUNT_AUTHORIZATION|bedrock.{0,200}(AccessDenied|not authorized|authorizationStatus|model access)|(AccessDenied|not authorized).{0,200}bedrock') {
        return (& $r 'BEDROCK_ACCOUNT_AUTHORIZATION_BLOCKED' 'BLOCKED' $false)
    }
    if ($Message -match '(?i)ApprovalRequired|manual approval|awaiting approval' -or $Stage -eq 'approval') {
        return (& $r 'MANUAL_APPROVAL_REQUIRED' 'WAITING' $false)
    }
    if ($Stage -in @('integration', 'unit') -and $Message -match '(?i)ECONNREFUSED.{0,40}543\d|\bP1001\b|database fixture|postgres.{0,40}(unavailable|not running|refused)|Environment variable not found:\s*DATABASE_URL') {
        # The DATABASE_URL case (added 2026-10-16, real evidence): a Prisma
        # call inside a *.integration.test.ts file never even attempts a
        # connection when DATABASE_URL is unset - it fails at config-
        # validation time with this exact message, not ECONNREFUSED/P1001.
        # Confirmed via a real failing CI run + local reproduction: the
        # `unit` job's glob (src/__tests__/*.test.ts) also matches
        # *.integration.test.ts files, which were always meant to run only
        # in docker-test.yml's db-integration job (real Postgres), never
        # here - this is the exact "missing-DB failure, not a code
        # failure" case this function already exists to classify.
        return (& $r 'INTEGRATION_ENV_UNAVAILABLE' 'NOT_RUN' $false)
    }
    if ($Stage -eq 'external' -or $Message -match '(?i)(smtp|payos|momo|vnpay|zalopay|stripe|paypal).{0,60}(ETIMEDOUT|ECONNREFUSED|503|unavailable)') {
        return (& $r 'EXTERNAL_PROVIDER_UNAVAILABLE' 'NOT_RUN' $false)
    }
    switch ($Stage) {
        'build'       { return (& $r 'BUILD_FAIL' 'FAIL' $true) }
        'typecheck'   { return (& $r 'BUILD_FAIL' 'FAIL' $true) }
        'unit'        { return (& $r 'UNIT_TEST_FAIL' 'FAIL' $true) }
        'integration' { return (& $r 'INTEGRATION_TEST_FAIL' 'FAIL' $true) }
        'deploy'      { return (& $r 'DEPLOY_FAIL' 'FAIL' $true) }
        'smoke'       { return (& $r 'SMOKE_FAIL' 'FAIL' $true) }
        default       { return (& $r 'UNCLASSIFIED_FAIL' 'FAIL' $true) }
    }
}

# ---------------------------------------------------------------------------
# 16A.27 / 16A.8 - secret-like output detection (returns TYPES only, never values)
# ---------------------------------------------------------------------------
function Find-SecretLikeOutput {
    param([string]$Text)
    $found = [System.Collections.Generic.List[object]]::new()
    if ([string]::IsNullOrEmpty($Text)) { return @() }
    $checks = @(
        @{ Type = 'JWT';                 Rx = 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}' },
        @{ Type = 'AWS_ACCESS_KEY';      Rx = '\b(AKIA|ASIA)[A-Z0-9]{16}\b' },
        @{ Type = 'PRIVATE_KEY';         Rx = '-----BEGIN [A-Z ]*PRIVATE KEY-----' },
        @{ Type = 'LAMBDA_ENV_DUMP';     Rx = '(?s)"Environment"\s*:\s*\{\s*"Variables"\s*:\s*\{' }
    )
    foreach ($c in $checks) { if ($Text -match $c.Rx) { $found.Add([pscustomobject]@{ Type = $c.Type }) } }

    $named = '(?i)\b(JWT_SECRET|JWT_REFRESH_SECRET|INTERNAL_SERVICE_SECRET|INTERNAL_API_SECRET|SMTP_PASS|PT_DOCUMENT_URL_SECRET|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN)\b["'']?\s*[:=]\s*["'']?([^\s"'',}]+)'
    foreach ($m in [regex]::Matches($Text, $named)) {
        $v = $m.Groups[2].Value
        if ($v -match '^\*+$|^<?redacted>?$|^\$\{|^\$\(|^(null|none)$') { continue }
        $found.Add([pscustomobject]@{ Type = ('NAMED_SECRET:' + $m.Groups[1].Value.ToUpper()) })
    }
    @($found | Sort-Object Type -Unique)
}

# ---------------------------------------------------------------------------
# 16A.24 / 16A.13 / 16A.14 - smoke selection
# ---------------------------------------------------------------------------
function Get-SmokePlan {
    param(
        [Parameter(Mandatory)] $Matrix,
        [string[]]$Services,
        [bool]$ChatRunning = $false
    )
    $out = foreach ($e in @($Matrix.entries)) {
        if ($Services -and ($e.service -notin $Services)) { continue }
        if (-not $e.safeForCi) { continue }
        if ($e.mutation) { continue }
        if ($e.method -notin @('GET', 'HEAD', 'READ')) { continue }
        if ((Get-Prop $e 'onlyIfRunning') -and -not $ChatRunning) { continue }
        $e
    }
    @($out)
}

# ---------------------------------------------------------------------------
# 16A.8 / 16A.9 / 16A.28 / 16A.29 - planned-action guard
# ---------------------------------------------------------------------------
<#
.SYNOPSIS
  Static check of the commands a pipeline step intends to run. Mode:
  CodeDeploy (default) | ConfigDeploy | InfraApply. Lifecycle script calls,
  scheduler mutation, ad-hoc API Gateway mutation, secret rotation and
  migrations are NEVER part of a normal code deploy.
#>
function Test-DeployPlanSafety {
    param(
        [string[]]$PlannedActions = @(),
        [ValidateSet('CodeDeploy', 'ConfigDeploy', 'InfraApply')] [string]$Mode = 'CodeDeploy',
        [switch]$AllowChatPowerChange
    )
    $rules = @(
        @{ Rule = 'LIFECYCLE_SCRIPT';       Rx = 'dev-(start|stop)\.ps1|aws-dev-power\.ps1'; Always = $false },
        @{ Rule = 'SCHEDULER_MUTATION';     Rx = 'scheduler\s+(update|create|delete)-schedule|events\s+(enable|disable)-rule'; Always = $true },
        @{ Rule = 'CHAT_POWER_CHANGE';      Rx = 'ecs\s+update-service.*--desired-count'; Always = $false },
        @{ Rule = 'ADHOC_GATEWAY_MUTATION'; Rx = 'apigatewayv2\s+(create|update|delete)-(route|integration|stage|api|authorizer)'; Always = $true },
        @{ Rule = 'SECRET_ROTATION';        Rx = 'secretsmanager\s+(put-secret-value|update-secret|rotate-secret|create-secret)'; Always = $true },
        @{ Rule = 'DB_POWER_CHANGE';        Rx = 'rds\s+(stop|start)-db-cluster'; Always = $true },
        @{ Rule = 'MIGRATION_IN_CODE_DEPLOY'; Rx = 'prisma\s+migrate|-migrate\b.*lambda\s+invoke|lambda\s+invoke.*-migrate\b'; Always = $true },
        @{ Rule = 'LAMBDA_CONFIG_REWRITE';  Rx = 'lambda\s+update-function-configuration'; Always = $false },
        @{ Rule = 'CFN_EXECUTION';          Rx = 'cloudformation\s+(deploy|execute-change-set|delete-stack)'; Always = $false },
        @{ Rule = 'BROAD_CONFIG_DUMP';      Rx = 'lambda\s+get-function(-configuration)?\b(?!.*--query)'; Always = $true }
    )
    $violations = [System.Collections.Generic.List[object]]::new()
    foreach ($a in $PlannedActions) {
        foreach ($r in $rules) {
            if ($a -notmatch $r.Rx) { continue }
            $allowed = $false
            if (-not $r.Always) {
                if ($r.Rule -eq 'LAMBDA_CONFIG_REWRITE' -and $Mode -eq 'ConfigDeploy') { $allowed = $true }
                if ($r.Rule -eq 'CFN_EXECUTION' -and $Mode -eq 'InfraApply') { $allowed = $true }
                if ($r.Rule -in @('LIFECYCLE_SCRIPT', 'CHAT_POWER_CHANGE') -and $AllowChatPowerChange) { $allowed = $true }
            }
            if (-not $allowed) { $violations.Add([pscustomobject]@{ Rule = $r.Rule; Action = $a }) }
        }
    }
    [pscustomobject]@{ Safe = ($violations.Count -eq 0); Violations = @($violations) }
}

function Test-ScheduleStatePreserved {
    param([hashtable]$Before = @{}, [hashtable]$After = @{})
    $diff = foreach ($k in $Before.Keys) { if (-not $After.ContainsKey($k) -or $After[$k] -ne $Before[$k]) { $k } }
    foreach ($k in $After.Keys) { if (-not $Before.ContainsKey($k)) { $k } }
    [pscustomobject]@{ Preserved = (@($diff).Count -eq 0); Changed = @($diff | Sort-Object -Unique) }
}

# ---------------------------------------------------------------------------
# 16A.11 - Chat ECS behaviour under on-demand lifecycle
# ---------------------------------------------------------------------------
function Get-ChatDeployMode {
    # Never passes --desired-count unless -ForceOn: update-service without it
    # keeps the owner's current count, so a code deploy cannot power Chat on/off.
    param([int]$DesiredCount, [switch]$ForceOn)
    if ($DesiredCount -le 0 -and $ForceOn) {
        return [pscustomobject]@{ Mode = 'FORCE_ON_EXPLICIT'; RegisterTaskDef = $true; PinTaskDef = $true; PassDesiredCount = $true; TargetDesiredCount = 1; WaitStable = $true }
    }
    if ($DesiredCount -le 0) {
        # Chat is intentionally OFF: register the revision and pin it on the
        # (zero-task) service so the next dev-start -Chat runs the new code.
        return [pscustomobject]@{ Mode = 'REGISTER_AND_PIN_ONLY'; RegisterTaskDef = $true; PinTaskDef = $true; PassDesiredCount = $false; TargetDesiredCount = 0; WaitStable = $false }
    }
    [pscustomobject]@{ Mode = 'ROLLING_UPDATE'; RegisterTaskDef = $true; PinTaskDef = $true; PassDesiredCount = $false; TargetDesiredCount = $DesiredCount; WaitStable = $true }
}

# ---------------------------------------------------------------------------
# 16A.1 - plan/apply identity binding. infra-deploy.yml must execute the
# EXACT change set a human reviewed in infra-plan.yml, never a same-named but
# differently-ordered/differently-timed describe-change-set response. Both
# sides hash the full describe-change-set JSON (Changes + Parameters); a
# mismatch always blocks, and a missing digest on either side is never
# treated as a pass.
# ---------------------------------------------------------------------------
function Test-ChangeSetDigest {
    param(
        [Parameter(Mandatory)] [AllowEmptyString()] [string]$ActualDigest,
        [Parameter(Mandatory)] [AllowEmptyString()] [string]$ReviewedDigest
    )
    $a = [string]$ActualDigest; $r = [string]$ReviewedDigest
    if ([string]::IsNullOrWhiteSpace($a) -or [string]::IsNullOrWhiteSpace($r)) {
        return [pscustomobject]@{ Match = $false; Rule = 'DIGEST_MISSING' }
    }
    if ($a.Trim().ToLowerInvariant() -ne $r.Trim().ToLowerInvariant()) {
        return [pscustomobject]@{ Match = $false; Rule = 'CHANGESET_DIGEST_MISMATCH' }
    }
    [pscustomobject]@{ Match = $true; Rule = 'OK' }
}

Export-ModuleMember -Function @(
    'Get-CiImpact',
    'Test-AwsIdentityGate',
    'Test-ChangeSetSafety',
    'Get-CiFailureClass',
    'Find-SecretLikeOutput',
    'Get-SmokePlan',
    'Test-DeployPlanSafety',
    'Test-ScheduleStatePreserved',
    'Get-ChatDeployMode',
    'Test-ChangeSetDigest'
)
