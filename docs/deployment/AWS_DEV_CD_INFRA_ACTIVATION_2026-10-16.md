# DEV CD infrastructure workflow activation - 2026-10-16

## Outcome

Infrastructure PLAN and APPLY are registered, active and dispatchable. They remain
locked until API Gateway adoption is explicitly certified. This is workflow activation,
not a successful infrastructure deployment or certification of every CD runtime path.

Implementation: a5684e28 on aws-deploy. Default-branch registration: 135bc348 on master.
The two workflow files are byte-identical between these branches. The master commit
uses [skip ci] because it registers manual workflows only; it does not certify the
old master Docker workflow or merge application changes into master.

## Corrections before promotion (CODE AUDIT)

- Install pnpm/Node/dependencies before the YAML semantic guard runs.
- Preserve ChatAlbDnsName and Lambda ARN parameters using UsePreviousValue.
- Compare the reviewed template digest against the actual CloudFormation change-set
  template, not merely the current Git checkout. Handle both object and string bodies.
- Handle true no-op plans without trying to hash a nonexistent changes.json file.
- Reject non-ready/non-executable change sets before applying.
- Enforce aws-deploy branch and adoption in an unprivileged preflight job. Protected
  environment jobs depend on that job and retain their own adoption check.
- Keep the shared deployment concurrency lock, manual dispatch, reviewer environments,
  change-set digest check, destructive-change guard and post-apply checks.

## Evidence

TEST FIXTURE: node --test scripts/ci/infra-workflows.test.cjs: 6/6 passed.
The tests execute the real workflow gate shell in Linux with missing adoption,
wrong branch and accepted configuration; no AWS calls are made.

TEST FIXTURE: Invoke-Pester scripts/ci/CiHelpers.Tests.ps1,
scripts/ci/TemplateSemanticGuard.Tests.ps1,scripts/ci/IamPolicyGuard.Tests.ps1
-PassThru -Quiet: 174/174 passed. Repository hygiene passed.

REAL HTTP/API: GitHub lists both infrastructure workflows as active by their real names.
Actual workflow_dispatch requests on aws-deploy were accepted:

- PLAN: https://github.com/trmizy/fitness-assistant/actions/runs/38916099500
- APPLY: https://github.com/trmizy/fitness-assistant/actions/runs/38916103404

Both runs intentionally conclude FAILURE at preflight with CI_ACTIVATION_BLOCKED.
Their plan/apply jobs conclude SKIPPED. This proves the lock is enforced before
AWS credentials or reviewer-environment jobs; it is not an apply success claim.

REAL HTTP/API: DEV Build succeeded on the implementation commit:
https://github.com/trmizy/fitness-assistant/actions/runs/38915989283

REAL HTTP/API, read-only AWS inspection:

- Correct account 191798898985 and API id1iz7upbl.
- API Gateway stack UPDATE_COMPLETE.
- All 254 processed-template resources have corresponding CloudFormation ownership;
  254 managed resources, zero missing logical IDs.
- Route parity: 119 MATCH, 10 known SOURCE_ONLY, 0 GATEWAY_ONLY, 0 MISMATCHED.
- Last recorded drift result IN_SYNC is dated 2026-10-12, not a fresh certification.

## Remaining boundary and operating procedure

APIGW_ADOPTION_COMPLETE remains UNSET. It was not set just to unlock CD.
The ten SOURCE_ONLY routes were not silently introduced by this change.
No CloudFormation change set was created/executed and no service was deployed or stopped
by this infrastructure activation. No IAM, secrets, migrations or lifecycle state changed.

Before unlocking, finish and record fresh adoption/drift verification against the
accepted baseline. Only after that certification set the repository variable to true.
Then dispatch infra-plan.yml on aws-deploy, obtain the configured environment review,
review the full plan artifact (including semantic diff), and pass its change-set name,
change-set digest and proposed-template digest to infra-deploy.yml. APPLY still requires
its protected-environment review. A no-op PLAN has nothing to apply.

Lambda/ECS deployment workflows were already live; actual Lambda/ECS deployment and
positive infrastructure PLAN/APPLY through OIDC and reviewer gates were not exercised
in this phase. Do not describe the complete CD runtime as fully verified from these
negative gate tests.
