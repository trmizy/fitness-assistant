# V3 closure — scope frozen before architecture work

2026-11-01, base `e3a45b29`. Evidence: CODE AUDIT / TEST FIXTURE.
R-A–R-D implementation is closed within the authorized offline experiment;
this is not independent scientific validation or a production release.

| Finding | Status | Implemented boundary |
| --- | --- | --- |
| R-A | FIXED for supplied scope | kg/% deltas compare to server endpoints, including bounded comparator/difference language. Optional strict deltaAssertion is independently checked against the referenced fact. Undefined percentages and ambiguous scope flag. Input-wide numeric occurrence is never treated as delta entailment. |
| R-B | FIXED | Other-outcome question words produce ASSESSMENT_OUTCOME_AMBIGUITY when e1RM facts are present, rather than silently disabling assessment review. |
| R-C | FIXED | Preserve accented đo as measurement before causal accent folding; negative measurement questions/statements and actual do-causality are tested. Unaccented ambiguous language remains a limitation. |
| R-D | FIXED for bounded explicit directives | Personal prescriptions now include sets, session frequency and nutrition. Clear personal imperatives block; recognized uncertain/quoted statements do not. Ambiguous set/frequency prescriptions flag. |

Tests: six new regression groups in `advisory-v3-closure.test.ts`. All 11 advisory
test files: **131 pass / 0 fail / 0 skip** with the preserved artifact directory.
`pnpm exec tsc --noEmit`: exit 0. Frozen bytes/hash/history checks execute in
that suite. V2 code, evidence pack, integrity pin and all frozen outputs remain
unchanged. No Bedrock, embeddings, DB or vector-store calls.

## Remaining findings and the stopping boundary

The task mentions R-E through R-I but does not provide their descriptions. A
clarification was requested; the reply “OKE” did not add finding details. Each
of R-E, R-F, R-G, R-H and R-I is recorded as **DESCRIPTION_NOT_SUPPLIED**,
severity **UNKNOWN**, disposition **PENDING_CLASSIFICATION / KNOWN_INPUT_LIMITATION**.
No specific defect, severity or completion is invented for those labels.

Remaining known limits: bounded language coverage, source-ID validity without
entailment, numeric membership without full attribution, uncertain measured-vs-
estimated semantics, unknown future measurement kinds, and conservative blocking
of normative population statements. Structured assertions also remain untrusted
model output and require server validation; they do not certify free text.

Stop extending lexical coverage in this workstream. Further changes require a
verified hard invariant defect, or a separately evaluated architecture change.
The next workstream uses V3 as one deterministic guard and keeps semantic review
separate. No-rule-match remains explicitly not content/scientific approval.
