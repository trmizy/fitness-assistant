# Gymini DEV — CI/CD Template Semantic Guard — 2026-10-12 (Phase 16A.3)

No credential, secret value, access key, or secret access key appears anywhere in this report.

## Executive Summary

Phase 16A.2R silently introduced a stack Output (`HttpApiIdOut`) that never appeared in any
`describe-change-set` `.Changes` array — a real, confirmed blind spot in every CI safety check built
so far, all of which only ever inspect `.Changes` (resource-level actions). This phase built a second,
complementary guard that reads the CloudFormation **template** itself — current deployed vs. proposed
— and classifies every section that can change stack behavior without ever showing up as a resource
action: `Outputs`, `Parameters`, `Conditions`, `Mappings`, `Transform`, `Rules`, with `Metadata`
tracked separately as informational. The guard fails closed on any template section it doesn't
recognize, blocks automatically on Output removal/Export-name changes/suspicious secret references,
and a new plan/apply binding proves APPLY always uses the exact template semantics PLAN reviewed. The
mandatory synthetic reproduction of the Phase 16A.2R incident (case 20) is reproduced and correctly
flagged as **not** a no-op. A real, read-only comparison of the live deployed template against the
local canonical template now reports `NO_SEMANTIC_CHANGE` with **identical semantic digests on both
sides** — confirming `HttpApiIdOut` is accepted baseline, not drift. 157/157 tests pass (134
pre-existing + 23 new), zero regressions. Both draft infra workflows were updated to wire the new
guard in; neither was activated. `TEMPLATE_SEMANTIC_GUARD_CERTIFIED: YES`.
`FINAL_DECISION: CICD_TEMPLATE_SEMANTIC_GUARD_VERIFIED`.

## Phase 16A.2R Output Finding

Recap (not re-investigated, taken as established fact per this phase's "Read First" instruction):
Phase 16A.2R's Chat-integration reconciliation used the full canonical `api-gateway-baseline.yaml`
(which has always included `HttpApiIdOut`) to build its CloudFormation `UPDATE`. CloudFormation
applies `Outputs` changes as part of any executed update, but **never** lists them in a change set's
own `.Changes` array (that array is resource-action-only) — so `HttpApiIdOut` was added to the live
stack without any existing safety check (API-ID guard, destructive-action scan, digest binding) ever
seeing it happen.

```
CHANGESET_CHANGES_BLIND_SPOT_CONFIRMED: YES
```

## Current HttpApiIdOut Baseline

Verified via the new guard itself (not re-asserted from the prior report):

```
HTTP_API_ID_OUTPUT_PRESENT_LOCAL: YES
HTTP_API_ID_OUTPUT_PRESENT_DEPLOYED: YES
HTTP_API_ID_OUTPUT_SEMANTIC_MATCH: YES
```

`HttpApiIdOut` is accepted baseline, per instruction — nothing in this phase removes, renames, or
alters it.

## Why ChangeSet.Changes Is Insufficient

Confirmed structurally, not just asserted: AWS's `DescribeChangeSet` API's `Changes` array is
documented and observed to contain only `ResourceChange` entries. `Outputs`/`Parameters` definition
changes/`Conditions`/`Mappings`/`Transform`/`Rules` are template-level constructs with no
corresponding "change" entry at all — they are applied silently as part of `ExecuteChangeSet`. Every
existing guard in this repository (`Test-ChangeSetSafety`, the destructive-action scan, the API-ID
check) operates exclusively on `.Changes` and was therefore structurally blind to this entire class of
change, regardless of how carefully each one was written.

## Template Semantic Model

New files:

- `scripts/ci/cfn-template-semantics.mjs` — a narrow, read-only Node adapter. Parses a template (YAML
  or JSON) and extracts a canonical, deterministically-sorted JSON model of every top-level section:
  `Transform`, `Parameters`, `Mappings`, `Conditions`, `Resources`, `Outputs`, `Rules`, `Metadata`,
  plus `UnknownTopLevelSections` (anything not in that known list — never silently dropped). Every CFN
  intrinsic function (`!Ref`, `!Sub`, `!GetAtt`, etc., and their JSON long-form equivalents `Ref`,
  `Fn::Sub`, …) is preserved as a structural placeholder (`{"__fn": "...", "value": ...}`), **never
  resolved or evaluated** — this is a diff input, not a CloudFormation evaluator.
- `scripts/ci/TemplateSemanticGuard.psm1` — the PowerShell policy layer (`Get-TemplateSemanticModel`,
  `Compare-TemplateOutputs`, `Compare-TemplateSemantics`, `Test-TemplateBindingMatch`). Reuses, never
  duplicates, `CiHelpers.psm1`'s `Find-SecretLikeOutput` for the Output-secret-reference check.

Classification produced by `Compare-TemplateSemantics`:

```
RESOURCE_CHANGE | PARAMETER_CHANGE | OUTPUT_CHANGE | CONDITION_CHANGE | MAPPING_CHANGE |
TRANSFORM_CHANGE | RULE_CHANGE | METADATA_ONLY_CHANGE | NO_SEMANTIC_CHANGE | FAIL_CLOSED | BLOCK
```

`RESOURCE_CHANGE` is reported here too (for visibility in the combined artifact) but remains
explicitly a **complement** to, never a replacement for, `Test-ChangeSetSafety`'s own authoritative
resource-action judgment — stated in the module's own synopsis, not left implicit.

```
TEMPLATE_SEMANTIC_COMPARATOR: PASS
OUTPUT_CHANGE_DETECTION: PASS
PARAMETER_CHANGE_DETECTION: PASS
CONDITION_CHANGE_DETECTION: PASS
MAPPING_CHANGE_DETECTION: PASS
TRANSFORM_CHANGE_DETECTION: PASS
UNKNOWN_CHANGE_FAIL_CLOSED: PASS
```

## Normalization

- Comments, YAML/JSON serialization form, and map-key ordering are all irrelevant (templates differing
  only in these ways produce `NO_SEMANTIC_CHANGE` — proven by real end-to-end tests, not asserted).
- JSON's long-form intrinsic keys (`{"Fn::Sub": ...}`, `{"Ref": ...}`) and YAML's short-form tags
  (`!Sub`, `!Ref`) are normalized to the identical structural shape.
- Intrinsic functions are never resolved (a `!Ref`/`!Sub` stays a tagged placeholder on both sides).
- **`Description` fields on individual `Parameters`/`Outputs` definitions are excluded from the
  comparison** — pure human documentation with zero functional effect, exactly the same principle
  already established for the template's own top-level `Description` (which CloudFormation itself
  never diffs). This exclusion also happened to be load-bearing for a real, independently-confirmed
  finding this phase (see "Secret Safety" below for why it isn't a secret-safety concern) — a live
  `get-template` read returns one Description field's em-dash (`—`) as `???`, a pre-existing Windows/
  AWS-CLI Unicode round-trip artifact seen since Phase 15B, confirmed this phase to occur even via
  `--output json` (not merely a `--output text` quirk). Excluding Description sidesteps this
  environment artifact at its root instead of fighting it, and is independently justified either way.
- No secret value is ever dereferenced; no dynamic reference (SSM/Secrets Manager) is resolved.

## Output Safety Policy

`Compare-TemplateOutputs` classifies every Output as `ADD`/`MODIFY`/`REMOVE` and applies:

```
REMOVE of any existing Output          -> always Blocked (OUTPUT_REMOVAL_BLOCKED)
MODIFY changing the Export name        -> always Blocked (EXPORT_NAME_CHANGE_BLOCKED)
ADD or MODIFY whose Value expression
  matches Find-SecretLikeOutput        -> always Blocked (SUSPICIOUS_SECRET_REFERENCE)
ADD or benign MODIFY (no Export change,
  no secret-shaped reference)          -> visible, not auto-blocked (OUTPUT_*_NEEDS_VISIBLE_APPROVAL)
```

A benign Output addition is never silently approved — it is always surfaced as an `OUTPUT_CHANGE`
finding in the comparator's `Overall` result and the plan artifact, satisfying "must be visible"
without over-blocking a legitimate, reviewed addition.

## Plan Artifact Binding

`ci/drafts/github-actions/infra-plan.yml`'s new `plan-artifact.json` (never only `.Changes`) carries:

```
STACK_NAME, STACK_ID, CHANGE_SET_ID, CHANGE_SET_NAME, CHANGE_SET_TYPE, CHANGE_SET_DIGEST,
CURRENT_TEMPLATE_SEMANTIC_DIGEST, PROPOSED_TEMPLATE_SEMANTIC_DIGEST, SOURCE_COMMIT_SHA,
RESOURCE_ACTION_SUMMARY, PARAMETER_DIFF, OUTPUT_DIFF, CONDITION_DIFF, MAPPING_DIFF,
TRANSFORM_DIFF, RULE_DIFF
```

No secret appears in this artifact — every field above is either an identifier, a digest, or a
structural (never-resolved) diff.

## Plan/Apply Template Binding

New `Test-TemplateBindingMatch` (parallel to the existing `Test-ChangeSetDigest`): compares the
proposed-template semantic digest the reviewer approved against the one computed from whatever
template is actually checked out at APPLY time, and optionally a source-commit SHA pair (not yet
wired into any draft workflow's commit tracking — correctly reported as `NOT_USED` rather than
invented). A missing digest on either side, or a mismatch, always blocks; this is independent of, and
additional to, the existing `Test-ChangeSetDigest` change-set binding — both must pass.

```
PLAN_TEMPLATE_DIGEST_BINDING: PASS
APPLY_TEMPLATE_DIGEST_BINDING: PASS
SOURCE_COMMIT_BINDING: NOT_USED
```

## Draft Workflow Changes

Both inactive drafts updated, neither activated or moved into `.github/workflows/`:

- **`ci/drafts/github-actions/infra-plan.yml`**: new "Template semantic diff" step — fetches the
  live deployed template (read-only `get-template`), computes both digests via
  `TemplateSemanticGuard.psm1`, fails the job on `FAIL_CLOSED`/`BLOCK`, and publishes a full
  `plan-artifact.json` (uploaded alongside the existing `changes.json`/`verdict.json`).
- **`ci/drafts/github-actions/infra-deploy.yml`**: new required input
  `reviewed_proposed_template_digest`; a new step re-derives the actual checked-out template's
  semantic digest and blocks via `Test-TemplateBindingMatch` before `execute-change-set` ever runs —
  closing exactly the "review plan from template A, modify template, apply template B" gap this phase
  was asked to close.

```
DRAFT_INFRA_PLAN_UPDATED: YES
DRAFT_INFRA_APPLY_UPDATED: YES
ACTIVE_GITHUB_WORKFLOWS_CREATED: 0
```

## Synthetic Output-Only Regression

The mandatory test (case 20): a `Current` model with no `Outputs` at all and a `Proposed` model
identical in every other respect except gaining `HttpApiIdOut` — reproducing exactly the Phase 16A.2R
shape (a change set with `Changes: []`).

```
PHASE_16A2R_OUTPUT_ONLY_REPRODUCTION: DETECTED
```

`Compare-TemplateSemantics` correctly returns `Overall != "NO_SEMANTIC_CHANGE"` (an `OUTPUT_CHANGE`
finding, `ChangeType: ADD`) — proving this guard would have caught the real Phase 16A.2R event had it
existed then.

## Full Test Results

20 of the 20 brief-mandated cases are covered (3 via real end-to-end YAML/JSON parsing against
on-disk fixtures, the rest via synthetic in-memory models — consistent with how every other guard in
this codebase is tested):

```
TemplateSemanticGuard.Tests.ps1: 23/23 PASS
  (identical templates, whitespace/comment-only, YAML-vs-JSON, Output added/modified/removed,
   Export-name-change block, Resource/Parameter/Condition/Mapping/Transform change detection,
   Metadata-only classification, unknown-section fail-closed, the mandatory 16A.2R reproduction,
   plan/apply template-digest binding + commit binding, a missing-digest-never-passes case, and two
   explicit regression checks proving the pre-existing Test-ChangeSetDigest/Test-ChangeSetSafety
   guards are untouched)
```

Combined with the pre-existing suites, re-run in full after every change this phase:

```
CiHelpers.Tests.ps1:              68/68
ApiRouteParity.Tests.ps1:         29/29
DevLifecycle.Tests.ps1:           19/19
ChatIntegrationSync.Tests.ps1:    18/18
TemplateSemanticGuard.Tests.ps1:  23/23
TOTAL: 157/157, 0 failed, 0 regressed
```

Two genuine test-authoring bugs were found and fixed **during** this phase (not production-code
defects): (1) every `($x | Where-Object ...).Count` in the new test file needed `@(...)` wrapping,
the same single-item-array-unwrap lesson from Phase 16A.1's own tests, not re-applied here on the
first pass; (2) a real bug inside `Compare-TemplateOutputs` itself — `Get-PropertyNames`'s own
internal `return @(...)` does not survive PowerShell's return-value unwrapping for a single-property
object, so `$currentNames + $proposedNames` silently became **string concatenation** instead of array
union when both sides had exactly one property name. Fixed by wrapping the call site
(`@(Get-PropertyNames ...)`), not just the function's own return statement — confirmed by direct,
isolated reproduction before and after the fix.

```
PREVIOUS_TEST_BASELINE: 134/134
FULL_SAFETY_TESTS: 157/157
PREVIOUS_TESTS_REGRESSED: 0
API_ID_GUARD_REGRESSION: 0
CHANGE_SET_DIGEST_GUARD_REGRESSION: 0
```

## Secret Safety

No semantic-diff output in this phase ever contains a resolved secret value — every CFN intrinsic
function is preserved as an unresolved structural placeholder (confirmed by direct inspection of real
parsed output: `{"__fn":"Ref","value":"HttpApiId"}`, never an actual dereferenced value). Any Output
whose `Value` expression text matches the existing, certified `Find-SecretLikeOutput` detector (JWTs,
AWS access-key patterns, named secret environment variables, a raw Lambda `Environment.Variables`
dump) is automatically classified `Blocked: true` with reason `SUSPICIOUS_SECRET_REFERENCE` — reusing
the Phase 16A.1 detector rather than re-implementing secret pattern-matching. The one Description-text
exclusion documented above removes pure prose, never a value expression, from the comparison surface.

## Remaining Phase 16B Preconditions

Unchanged from before this phase (this phase closed a specific CI-safety gap; it did not advance
activation readiness): OIDC roles not yet created, GitHub protected environments not yet created,
`infra-plan.yml`/`infra-deploy.yml` remain inactive drafts, the 10 `SOURCE_ONLY` routes remain pending
Phase 15C, and `SOURCE_COMMIT_BINDING` remains `NOT_USED` (a documented, not-yet-wired hardening for a
future phase to pick up if desired, not invented here beyond what's actually used).

## Final Response

```
PHASE: 16A.3
AWS_MUTATIONS: 0
RUNTIME_RESOURCE_MUTATIONS: 0
HTTP_API_ID_OUTPUT_BASELINE: VALID
CHANGESET_CHANGES_BLIND_SPOT_CONFIRMED: YES
TEMPLATE_SEMANTIC_COMPARATOR: PASS
OUTPUT_CHANGE_DETECTION: PASS
PARAMETER_CHANGE_DETECTION: PASS
CONDITION_CHANGE_DETECTION: PASS
MAPPING_CHANGE_DETECTION: PASS
TRANSFORM_CHANGE_DETECTION: PASS
UNKNOWN_CHANGE_FAIL_CLOSED: PASS
PLAN_TEMPLATE_DIGEST_BINDING: PASS
APPLY_TEMPLATE_DIGEST_BINDING: PASS
SOURCE_COMMIT_BINDING: NOT_USED
PHASE_16A2R_OUTPUT_ONLY_REPRODUCTION: DETECTED
API_ID_GUARD_REGRESSION: 0
CHANGE_SET_DIGEST_GUARD_REGRESSION: 0
PREVIOUS_TEST_BASELINE: 134/134
FULL_SAFETY_TESTS: 157/157
PREVIOUS_TESTS_REGRESSED: 0
DRAFT_INFRA_PLAN_UPDATED: YES
DRAFT_INFRA_APPLY_UPDATED: YES
ACTIVE_GITHUB_WORKFLOWS_CREATED: 0
AWS_OIDC_CHANGED: NO
API_GATEWAY_CHANGED: NO
SERVICES_REDEPLOYED: 0
SERVICES_STOPPED: 0
CFN_NORMAL_UPDATE_CERTIFIED: YES
CI_DEPLOYMENT_SAFETY_WRAPPER: CERTIFIED
TEMPLATE_SEMANTIC_GUARD_CERTIFIED: YES
CICD_PREPARATION_READY: YES
CI_ACTIVATION_AUTHORIZED: NO
READY_FOR_PHASE_16B: YES
REPORT: docs/deployment/AWS_DEV_CICD_TEMPLATE_SEMANTIC_GUARD_2026-10-12.md
FINAL_DECISION: CICD_TEMPLATE_SEMANTIC_GUARD_VERIFIED
```

HARD STOP. Did NOT activate any workflow. Did NOT create any CI deploy role. Did NOT execute
CloudFormation. Did NOT deploy any service. Did NOT add any SOURCE_ONLY route. Did NOT run any
migration. Did NOT change any lifecycle state.
